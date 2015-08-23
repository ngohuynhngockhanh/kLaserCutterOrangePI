#!/usr/bin/env node
//require
var	express		=	require('express'),
	siofu 		= 	require("socketio-file-upload")
	app        	= 	express(),
	fs         	= 	require('fs'),
	server		=	require('http').createServer(app),
    io			=	require('socket.io').listen(server),
	argv		=	require('optimist').argv,
	phpjs		= 	require('phpjs'),
	Infinity	=	1e90,
	exec 		=	require('child_process').exec,
	svg2gcode	=	require('./lib/svg2gcode'),
	serialport	=	require("serialport"),
	Vec2		=	require('vec2'),
	sleep		=	require('sleep'),
	sh 			= 	require('execSync'),
	five		=	require("johnny-five"),
	Galileo		=	require("galileo-io"),
	board		=	new five.Board({
					io: new Galileo(),
					repl: false,
					debug: false,
				}),
	MJPG_Streamer=	require('./lib/mjpg_streamer'),
	mjpg_streamer=  new MJPG_Streamer(),
	SerialPort	= 	serialport.SerialPort,	
	serialPort	= 	new SerialPort("/dev/ttyS0", {
					baudrate: 115200,
					parser: serialport.parsers.readline("\n")
				});


//argv
	argv.minDistance	=	argv.minDistance	|| 6;							//queue will set to empty if the distance from now laser position to goal position is less than 6em					
	argv.maxDistance	=	argv.maxDistance	|| 8;							//queue is full if the distance they went enough 8mm or more one comand
	argv.minQueue		=	argv.minQueue		|| 4;							//queue has at least 5 elements
	argv.maxQueue		=	argv.maxQueue		|| 20;							//queue has at maximum 20 elements
	argv.minCPUTemp		=	argv.minCPUTemp		|| 73;							// if galileo temp <= this => turn the fan off
	argv.maxCPUTemp		=	argv.maxCPUTemp		|| 88;							// if galileo temp > this => turn the fan on
	argv.intervalTime1	=	argv.intervalTime1	|| 10000;						//10s = 10000ms. Each 10s, we check grbl status once
	argv.intervalTime2	=	argv.intervalTime2	|| 10000;						//10s = 10000ms. Each 10s, we check camera status once
	argv.intervalTime3	= 	argv.intervalTime3	|| 800;							//check current laser after 800ms
	argv.intervalTime4	=	argv.intervalTime4	|| 30000;						//30s = 30000ms. Each 30s, we check server load once
	argv.intervalTime5	=	argv.intervalTime5	|| 60;							//60s. Each 1 minute, we check grbl status to change to power saving mode
	argv.intervalTime6	=	argv.intervalTime6	|| 10000;						//10s. Each 10 seconds, we update Server log/ Galileo temperature OR Laser position once.
	argv.maxFileSize 	= 	argv.maxFileSize	|| 1.5 * 1024 * 1024;			//unit: byte
	argv.privateApiKey 	= 	argv.privateApiKey 	|| '80f9f6fa60371b14d5237645b79a72f6e016b08831ce12a3';		//privateApiKey (Ionic App), create your own or use my own
	argv.ionicAppId		=	argv.ionicAppId 	|| '46a9aa6b';												//ionic app id (ionic app), create your own or use my own
	argv.LCDcontroller 	= 	argv.LCDcontroller 	|| "PCF8574";												//default I2C Controller
	argv.feedRate		=	(argv.feedRate != undefined) ? argv.feedRate : -1;								//-1 means fetch from sdcard
				

				
var	gcodeQueue	= 	[],
	gcodeDataQueue= [],
	tokenDevice	=	[],
	rememberTokenDevice = [],
	SVGcontent	=	"",
	currentQueue=	0,
	currentDistance=0,
	minDistance	=	phpjs.intval(argv.minDistance),		
	maxDistance	=	phpjs.intval(argv.maxDistance),							
	minQueue	=	phpjs.intval(argv.minQueue),							
	maxQueue    =	phpjs.intval(argv.maxQueue),							
	timer1		=	phpjs.time(),
	timer2		=	phpjs.time(),
	timer2		=	0,
	timer3		=	phpjs.time(),
	socketClientCount	= 0,
	copiesDrawing 		= 1,
	lcdBusy 	= false,
	//galileo pinout
	relayStepperPin		= 	6,
	fanPin				=	7,
	greenButtonPin		=	8,
	redButtonPin		=	9,
	minCPUTemp	=	phpjs.intval(argv.minCPUTemp),
	maxCPUTemp	=	phpjs.intval(argv.maxCPUTemp),
	machineRunning		=	false,
	machinePause		=	true,
	laserPos	=	new Vec2(0, 0),
	goalPos		=	new Vec2(0, 0),
	intervalTime1		=	phpjs.intval(argv.intervalTime1),
	intervalTime2		=	phpjs.intval(argv.intervalTime2),
	intervalTime3		= 	phpjs.intval(argv.intervalTime3),
	intervalTime4		=	phpjs.intval(argv.intervalTime4),
	intervalTime5		=	phpjs.intval(argv.intervalTime5),
	intervalTime6		=	phpjs.intval(argv.intervalTime6),
	//implement
	lcd,
	ipAddress,
	newConnection,								
	sendLCDMessage,
	serverLoad,
	tempGalileo,
	fan,
	relay,
	greenButton,
	redButton;


var _getIpAddress_idx = 0;
function getIpAddress() {
	var ip = phpjs.explode("\n", sh.exec("ifconfig | grep -v 169.254.255.255 | grep -v 127.0.0.1 |  awk '/inet addr/{print substr($2,6)}'").stdout);
	console.log(ip);
	var count = phpjs.count(ip) - 1;
	if (count == 0)
		return "";
	_getIpAddress_idx = (_getIpAddress_idx + 1) % count;
	return ip[_getIpAddress_idx];
}	

function shutdown() {
	sendPushNotification("The machine was shutted down!");
	sendLCDMessage("Shutting down...Wait 10 seconds!");
	relay.off();
	fan.off();
	console.log("shutdown");
	setTimeout(function() {
		sh.exec("shutdown -h now");	
	}, 1000);
}

board.on("ready", function() {
	//relay
	relay = new five.Relay(relayStepperPin);
	relay.on();
	
	//fan
	fan = new five.Relay(fanPin);
	fan.off();
	
	//buttons
	greenButton = new five.Button(greenButtonPin);
	redButton 	= new five.Button({
		pin: redButtonPin,
		holdtime: 3000
	});
	
	
	
	
	var lcdTimeout;
	
	var lcd = new five.LCD({
		controller: argv.LCDcontroller
	});
	
	
	function killLCDTimeout() {
		if (lcdTimeout)
			clearTimeout(lcdTimeout);
	}
	function setLCDTimeout(func, timeout) {
		killLCDTimeout();
		lcdBusy = true;
		lcdTimeout = setTimeout(function() {
			func();
			lcdBusy = false;
		}, timeout);
	}
	
	sendLCDMessage = function(message, options) {
		options = options || {};
		options.timeout = options.timeout || 20000;
		options.backlight = (options.backlight != undefined) ? options.backlight : true;
		console.log(message);
		var length = phpjs.strlen(message);
		var tryDraw = function(idx, length, options) {
			lcd.clear();
			if (options.backlight)
				lcd.backlight();
			for (var i = 0; i < 16 * 2; i++) {
				var x = phpjs.intval(i / 16);
				var y = i % 16;
				lcd.cursor(x, y).print(message[idx]);
				idx++;
				
				if (idx == length) {
					setLCDTimeout(function() {
						lcd.noBacklight();
					}, options.timeout);
					return;
				}
			}
			setLCDTimeout(function() {
				tryDraw(idx, length, options);
			}, 1000);
		}
		tryDraw(0, length, options);
	}
	newConnection = function(address) {
		sendLCDMessage(phpjs.sprintf("Connection(s):%02d%s", socketClientCount, phpjs.trim(address)));
	}
	
	
	ipAddress = "";
	do {
		ipAddress = getIpAddress();
		if (phpjs.strlen(ipAddress) > 7) {
			sendLCDMessage("IP Address:     " + ipAddress, {timeout: 30000});
			break;
		} else {
			lcd.clear();
			lcd.cursor(0, 0).print("Wait for IP");
			for (var i = 5 ; i >= 1; i--) {				
				lcd.cursor(1, 0).print(".............." + i + "s");
				sleep.sleep(1);
			}
		}
	} while (phpjs.strlen(ipAddress) > 7);
	
	greenButton.on("hold", function() {
		sendLCDMessage("IP Address:     " + getIpAddress(), {timeout: 5000});	
	});
	redButton.on("down", function() {
		if (machineRunning) {
			if (machinePause) {
				sendLCDMessage("Resuming...");
				unpause();
			} else {
				sendLCDMessage("Pause");
				pause();
			}
		}
	});
	redButton.on("hold", function() {
		if (!machineRunning) {
			if (machinePause)
				start();
			shutdown();
		} else {
			sendLCDMessage("Halt the machine");
			stop();
		}
	});
	
});

//app.use(express.static(__dirname + '/upload'));
	
io.sockets.on('connection', function (socket) {
	socketClientCount++;
	//socket ip
	if (newConnection)
		newConnection(socket.handshake.address);
	
	var uploader = new siofu();
    uploader.dir = "./upload";
    uploader.listen(socket);
	uploader.on("start", function(event) {
		console.log("upload task starts");
		var file = event.file;
		var fileSize = file.size;
		if (fileSize > argv.maxFileSize) {
			socket.emit("error", {id: 3, message: "MAX FILE FILE is " + (settings.maxFileSize / 1024 / 1024) + "MB"});
			return false;
		}
	});
	 // Do something when a file is saved:
    uploader.on("complete", function(event){
		console.log("upload complete");
        var file = event.file;
		var filepath = './' + file.pathName;
		var re = /(?:\.([^.]+))?$/;
		var ext = re.exec(filepath)[1];
		if (ext)
			ext = phpjs.strtolower(ext);
		
		setTimeout(function() {
			var content = fs.readFileSync(filepath).toString();
			SVGcontent = content;
			var isGCODEfile = (ext == 'gcode' || ext == 'sd' || ext == 'txt');
			var options = argv;
			socket.emit("percent");	
			console.log(filepath);
			if (!isGCODEfile)
				content = svg2gcode.svg2gcode(content, options);
			
			if (ext != 'svg')
				SVGcontent = "";
			addQueue(content);
			sendQueue();
			fs.unlink(filepath);
			if (sendLCDMessage)
				sendLCDMessage("Upload completed" + file.name);
		}, file.size / 1024 / 2);
		
    });
	// Error handler:
    uploader.on("error", function(event){
        console.log("Error from uploader", event);
    });
	socket.on('disconnect', function() {
		socketClientCount--;
	});
	socket.on('start',function(copies){
		copies = copies || 1;
		start(copies);
		if (sendLCDMessage)
			sendLCDMessage("It's running ^^!Yeah, so cool.");
	});
	socket.on('requestQueue', function() {
		sendQueue(socket);
	});
	socket.on('pause', function() {
		pause();
		if (sendLCDMessage)
			sendLCDMessage("Pause");		
	});
	socket.on('unpause', function() {
		unpause();
		if (sendLCDMessage)
			sendLCDMessage("Resuming...");		
	});
	socket.on('softReset', function() {
		softReset();
	});
	socket.on('stop', function() {
		stop();
		if (sendLCDMessage)
			sendLCDMessage("Stopped!");		
	});
	socket.on('cmd', function(cmd) {
		cmd = cmd || "";
		cmd = phpjs.str_replace(['"', "'"], '', cmd);
		write2serial(cmd);
	});
	socket.on('feedRate', function(feedRate) {
		feedRate = phpjs.intval(feedRate);
		if (feedRate <= 1) feedRate = 1;
		if (feedRate == argv.feedRate)
			return;
		fs.writeFile('./data/feedRate', feedRate);
		
		var replaceFeedRate = function(queue) { 
			var oldF = 'F' + argv.feedRate;
			var newF = 'F' + feedRate;
			for (var i = 0; i < queue.length; i++)
				queue[i] = phpjs.str_replace(oldF, newF, queue[i]);
		}
		replaceFeedRate(gcodeQueue);
		replaceFeedRate(gcodeDataQueue);
		argv.feedRate = feedRate;
		io.sockets.emit("settings", argv);
	});
	socket.on('token', function(token, remember) {
		tokenIndexOf = tokenDevice.indexOf(token);
		if (tokenIndexOf == -1) 
			tokenDevice.push(token);
		console.log(tokenDevice);
		console.log(remember);
		var rtdIndex = rememberTokenDevice.indexOf(token);
		if (rtdIndex == -1 && remember) {
			rememberTokenDevice.push(token);
			saveRememberDevice();
		} else if (!remember && rtdIndex > -1) {
			rememberTokenDevice.slice(rtdIndex, 1);
			saveRememberDevice();
		}
		if (sendLCDMessage)
			sendLCDMessage((tokenIndexOf == -1 ? "New" : "Old") + " device (#" + tokenDevice.indexOf(token) + ")");
	});
	
	socket.emit("settings", argv);
});

server.listen(9090);
siofu.listen(server);


//set token from sdcard
fs.readFile('./data/rememberDevice.json', function (err, data) {
	if (err)
		saveRememberDevice();
	else {
		rememberTokenDevice = JSON.parse(data);
		tokenDevice = rememberTokenDevice.slice(0);
	}
});
if (argv.feedRate == -1) 
	fs.readFile('./data/feedRate', function (err, data) {
		if (err)
			argv.feedRate = 300;
		else {
			data = phpjs.str_replace("\n", "", data);
			console.log(data);
			argv.feedRate = phpjs.intval(data);
			if (argv.feedRate <= 1)
				argv.feedRate = 1;
		}
	});



function sendQueue(socket) {
	socket = socket || io.sockets;
	console.log('sendQueue');
	socket.emit('AllGcode', gcodeDataQueue, machineRunning);
	if (SVGcontent != "") {
		sendSVG(SVGcontent);
	}
}

function sendSVG(content, socket) {
	socket = socket || io.sockets;
	console.log('sendSVG');
	socket.emit('sendSVG', content);
}

function finish() {
	console.log('finish');
	io.sockets.emit('finish');
	sendPushNotification("I have just finished my job! ^-^");
	if (sendLCDMessage)
		sendLCDMessage("I have just     finished my job!");
	stop(false);
}

function stop(sendPush) {
	write2serial("M5");
	write2serial("g0x0y0z0");
	sendPush = (sendPush != undefined) ? sendPush : true;
	machineRunning	= false;
	machinePause	= true;
	timer2			= 0;
	gcodeQueue 		= gcodeDataQueue.slice(0);
	currentQueue 	= 0;
	currentDistance = 0;
	stopCountingTime();
	console.log('stop!');
	if (sendPush)
		sendPushNotification("The machine was stopped");
}

function sendPushNotification(message) {
	var post_data = {
		"tokens": tokenDevice,
		"notification":{
			"alert": message 
		}
	};
	var command = "curl -u " + argv.privateApiKey + ": -H \"Content-Type: application/json\" -H \"X-Ionic-Application-Id: " + argv.ionicAppId + "\" https://push.ionic.io/api/v1/push -d '" + JSON.stringify(post_data) + "'";
	exec(command);
}

function start(copies) {	
	machineRunning	= true;
	machinePause	= false;
	console.log("machine is running!");
	timer2 = phpjs.time();
	copies = phpjs.intval(copies);
	if (copies <= 1)
		copies = 1;
	copiesDrawing = copies;
	if (gcodeQueue.length == 0 && gcodeDataQueue.length > 0)
		gcodeQueue = gcodeDataQueue.slice(0);
	write2serial("~");
	sendPushNotification("The machine has just been started!");
}

function pause() {
	machinePause = true;
	write2serial("!");
	console.log("pause");
}

function unpause() {
	machinePause = false;
	write2serial("~");
	console.log("unpause");
}

function stopCountingTime() {
	io.sockets.emit("stopCountingTime");
}

function is_running() {
	return machineRunning && !machinePause;
}

function softReset() {
	console.log("reset");
	write2serial("\030");
}

function sendCommand(command) {
	if (is_running())
		console.log("this machine is running, so you can't execute any command");
	else {
		command = phpjs.strval(command);
		console.log("send command " + command);
		write2serial((command));
	}
}

function getPosFromCommand(which, command) {
	var tmp = phpjs.explode(which, command);
	if (tmp.length == 1)
		return undefined;
	return phpjs.floatval(tmp[1]);
}
function sendFirstGCodeLine() {
	if (gcodeQueue.length == 0) {	// is empty list
		if (copiesDrawing <= 1) {
			finish();
			return false;
		} else {
			gcodeQueue = gcodeDataQueue.slice(0);
			copiesDrawing--;
		}
	}
	
	
	//get the last command.
	var command = gcodeQueue.shift();
	//comment filter
	command = command.split(';');
	command = command[0];
	
	//if command is just a command, we check again
	if (phpjs.strlen(command) <= 1 || command.indexOf(";") == 0)   //igrone comment line
		return sendFirstGCodeLine();
	
	//write command to grbl
	write2serial(command);
	
	//convert command to upper style
	command = phpjs.strtoupper(command);
	
	// send gcode command to client
	io.sockets.emit("gcode", {command: command, length: gcodeQueue.length}, timer2);
	
	//get X and Y position from the command to count the length that the machine has run
	var commandX = getPosFromCommand('X', command);
	var commandY = getPosFromCommand('Y', command);
	if (commandX != undefined && commandY != undefined) { //if exist x or y coordinate.
		var newPos = new Vec2(phpjs.floatval(commandX), phpjs.floatval(commandY));
		currentDistance += newPos.distance(goalPos);
		goalPos.set(newPos);
	}
	
	currentQueue++;	
	
	
		
	return true;
}

function sendGcodeFromQueue() {
	if ((currentDistance < maxDistance || currentQueue < minQueue) && currentQueue < maxQueue)
		sendFirstGCodeLine();
}

function receiveData(data) {
	if (data.indexOf('<') == 0) {	//type <status,...>
		data = phpjs.str_replace(['<', '>', 'WPos', 'MPos', ':', "", "\n"], '', data);
		var data_array = phpjs.explode(',', data);
		laserPos.set(phpjs.floatval(data_array[1]), phpjs.floatval(data_array[2]));
		
		
		io.sockets.emit('position', data_array, machineRunning, machinePause, copiesDrawing);
		
		if ((laserPos.distance(goalPos) < minDistance) || (data_array[0] == 'Idle' && gcodeQueue.length > 0)) {
			currentQueue = 0;
			currentDistance = 0;
		}
		if (phpjs.time() - timer3 > intervalTime5) {
			if (relay) {
				if (data_array[0] == 'Idle')
					relay.off();
				else 
					relay.on();
			}
			
			timer3 = phpjs.time();
		}
	} else if (data.indexOf('ok') == 0) {
		timer1 = phpjs.time();
		if (is_running())
			sendGcodeFromQueue();
	} else if (data.indexOf('error') > -1) {
		currentQueue--;
		if (data.indexOf(':24') == -1)
			io.sockets.emit('error', {id: 2, message: data});
	} else {
		io.sockets.emit('data', data);
	}
		
}

function addQueue(list) {
	if (phpjs.is_string(list)) {
		//200% make sure list is a string :D
		list = list.toString();
		var commas = ["\r\n", "\r", "\n"];
		for (var i = 0; i < commas.length; i++)
			if (list.indexOf(commas[i]) > 0) {
				list = phpjs.explode(commas[i], list);
				break;
			}				
	}
	
	//new queue
	gcodeQueue = list;
	gcodeDataQueue = list.slice(0);
}
function saveRememberDevice(list) {
	list = list || rememberTokenDevice;
	fs.writeFile('./data/rememberDevice.json', JSON.stringify(list));
}
function write2serial(command, func) {
	if (relay && !relay.isOn && command.length > 1) {
		relay.on();
		sleep.sleep(1); //sleep 1 s
	}
	command += "\r";
	if (func) 
		serialPort.write(command, func);
	else 
		serialPort.write(command);
}

serialPort.on("open", function (error) {
	if (error) {
		console.log(error);
		io.sockets.emit("error", {id: 0, message: "Can't open Serial port", error: error});
	} else {
		console.log('open serial port');
		var interval = setInterval(function() {
			write2serial("?", function (e) {
				if (e != undefined)
					io.sockets.emit('error');
			});
		}, intervalTime3);
		serialPort.on('data', function(data) {
			 receiveData(data);
		});
	}
});

var AT_interval1 = setInterval(function() {
	write2serial("?");
	if (is_running() && phpjs.time() - timer1 > intervalTime1) 
		io.sockets.emit("error", {id: 0, message: 'Long time to wait ok response'});
}, intervalTime1);

var AT_interval2 = setInterval(function() {
	var log = mjpg_streamer.tryRun();
	io.sockets.emit("mjpg_log", log);
}, intervalTime2);

var AT_interval4 = setInterval(function() {
	serverLoad	= phpjs.trim(sh.exec("uptime | awk '{ print $10 }' | cut -c1-4").stdout);
	tempGalileo	= phpjs.intval(sh.exec("cat /sys/class/thermal/thermal_zone0/temp | cut -c1-2").stdout);
	exec("echo '" + serverLoad + "' >> ./upload/sl.log");
	if (fan) {
		if (fan.isOn) {
			if (tempGalileo <= minCPUTemp) {
				fan.off();
			}
		} else {
			if (tempGalileo > maxCPUTemp) {
				fan.on();
			}
		}
	}
	io.sockets.emit("system_log", {
		'serverLoad'	: serverLoad,
		'tempGalileo'	: tempGalileo
	});
}, intervalTime4);

var AT_interval6 = setInterval(function() {
	if (ipAddress && ipAddress != "" && sendLCDMessage && !lcdBusy) {
		var randomNumber = phpjs.rand(0, 1);
		switch (randomNumber) {
			case 0:
				sendLCDMessage(phpjs.sprintf("X:%14.5fY:%14.5f", laserPos.x, laserPos.y), {backlight: false});
				break;
			case 1:
				sendLCDMessage(phpjs.sprintf("Server Load:%4.2fGalileo   %2d oC", phpjs.floatval(serverLoad), tempGalileo), {backlight: false});
				break;
		}
		
	}
}, intervalTime6);

console.log('Server runing port 9090');
