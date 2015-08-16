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

		
				

				
var	gcodeQueue	= 	[],
	gcodeDataQueue= [],
	tokenDevice	=	[],
	SVGcontent	=	"",
	currentQueue=	0,
	currentDistance=0,
	maxDistance	=	8,							//queue has enough elements to run enough 8mm
	minQueue	=	4,							// queue has at least 5 elements
	maxQueue    =	20,							//queue has at maximum 20 elements
	timer1		=	phpjs.time(),
	timer2		=	phpjs.time(),
	timer2		=	0,
	timer3		=	phpjs.time(),
	socketClientCount	= 0,
	lcd,
	ipAddress,
	newConnection,								//implement
	sendLCDMessage,
	relayStepperVoltagePin	= 6,
	relayStepperStatus		= 1,
	machineRunning=	false,
	machinePause=	true,
	laserPos	=	new Vec2(0, 0),
	goalPos		=	laserPos,
	minDistance	=	7,							//7mm
	intervalTime1	=	argv.intervalTime1 || 10000,	//10s = 10000ms. Each 10s, we check grbl status once
	intervalTime2	=	argv.intervalTime2 || 10000,	//10s = 10000ms. Each 10s, we check camera status once
	intervalTime3	= 	argv.intervalTime3 || 800,		//check current laser after 800ms
	intervalTime4	=	argv.intervalTime4 || 30000,	//30s = 30000ms. Each 30s, we check server load once
	intervalTime5	=	argv.intervalTime5 || 60;		//60s. Each 1 minute, we check grbl status to change to power saving mode
//argv
	argv.maxFileSize = argv.maxFileSize || 1.5 * 1024 * 1024;
	argv.privateApiKey = argv.privateApiKey || '80f9f6fa60371b14d5237645b79a72f6e016b08831ce12a3';
	argv.ionicAppId	=	argv.ionicAppId || '46a9aa6b';
	argv.LCDcontroller = argv.LCDcontroller || "PCF8574";

	

board.on("ready", function() {
	board.digitalWrite(relayStepperVoltagePin, relayStepperStatus); // turn on relay to test 

	var lcdTimeout;
	
	var lcd = new five.LCD({
		controller: argv.LCDcontroller
	});
	ipAddress = "";
	do {
		ipAddress = sh.exec("ifconfig | grep -v 169.254.255.255 | grep -v 127.0.0.1 |  awk '/inet addr/{print substr($2,6)}'").stdout;
		if (phpjs.strlen(ipAddress) > 7) {
			lcd.clear();
			lcd.cursor(0, 0).print("IP Address:");
			lcd.cursor(1, 0).print(phpjs.str_replace("\n", "", ipAddress));
			lcd.backlight();
			setLCDTimeout(function() {
				lcd.noBacklight();
			}, 30000);
			break;
		} else {
			lcd.clear();
			for (var i = 5 ; i >= 1; i--) {
				lcd.cursor(0, 0).print("Wait for IP");
				lcd.cursor(1, 0).print(".............." + i + "s");
				sleep.sleep(1);
			}
		}
	} while (phpjs.strlen(ipAddress) > 7);
	
	function killLCDTimeout() {
		if (lcdTimeout)
			clearTimeout(lcdTimeout);
	}
	function setLCDTimeout(func, timeout) {
		killLCDTimeout();
		lcdTimeout = setTimeout(func, timeout);
	}
	newConnection = function(address) {
		lcd.clear();
		lcd.cursor(0, 0).print(phpjs.sprintf("Connection(s):%02d", socketClientCount));
		lcd.cursor(1, 0).print(phpjs.trim(address));
		lcd.backlight();
		setLCDTimeout(function() {
			lcd.noBacklight();
		}, 10000);
	}
	sendLCDMessage = function(message, timeout) {
		timeout = timeout || 20000;
		console.log(message);
		var length = phpjs.strlen(message);
		var tryDraw = function(idx, length) {
			lcd.clear();
			lcd.backlight();
			for (var i = 0; i < 16 * 2; i++) {
				var x = phpjs.intval(i / 16);
				var y = i % 16;
				lcd.cursor(x, y).print(message[idx]);
				idx++;
				
				if (idx == length) {
					setLCDTimeout(function() {
						lcd.noBacklight();
					}, timeout);
					return;
				}
			}
			setLCDTimeout(function() {
				tryDraw(idx, length);
			}, 1000);
		}
		tryDraw(0, length);
	}
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
	socket.on('start',function(){
		start();
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
		write2serial(cmd);
	});
	
	socket.on('token', function(token) {
		if (tokenDevice.indexOf(token) == -1) 
			tokenDevice.push(token);
		console.log(tokenDevice);
		if (sendLCDMessage)
			sendLCDMessage("New device (#" + tokenDevice.indexOf(token) + ")");
	});
	
	socket.emit("settings", argv);
});

server.listen(9090);
siofu.listen(server);


function sendQueue(socket) {
	socket = socket || io.sockets;
	console.log('sendQueue');
	socket.emit('AllGcode', gcodeDataQueue);
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

function start() {	
	machineRunning	= true;
	machinePause	= false;
	console.log("machine is running!");
	timer2 = phpjs.time();
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
		console.log("send command " + command);
		write2serial(command + "");
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
		finish();
		return false;
	}
	
	
	//get the last command.
	var command = gcodeQueue.shift();
	//comment filter
	command = command.split(';');
	command = command[0];
	
	//if command is just a command, we check again
	if (phpjs.strlen(command) <= 1 || command.indexOf(";") == 0)   //igrone comment line
		return sendFirstGCodeLine();
		
	//convert command to upper style
	command = phpjs.strtoupper(command);
	
	
	
	
	//write command to grbl
	write2serial(command + "");
	
	
	// send gcode command to client
	io.sockets.emit("gcode", {command: command, length: gcodeQueue.length}, timer2);
	
	//get X and Y position from the command to count the length that the machine has run
	var commandX = getPosFromCommand('X', command);
	var commandY = getPosFromCommand('Y', command);
	if (commandX != undefined && commandY != undefined) { //if exist x or y coordinate.
		var newPos = new Vec2(phpjs.floatval(commandX), phpjs.floatval(commandY));
		goalPos = newPos;
		currentDistance += newPos.distance(goalPos);
	}
	
	currentQueue++;	
	
	
		
	return true;
}

function sendGcodeFromQueue() {
	if ((currentDistance < maxDistance || currentQueue < minQueue) && currentQueue <= maxQueue)
		sendFirstGCodeLine();
}

function receiveData(data) {
	if (data.indexOf('<') == 0) {	//type <status,...>
		data = phpjs.str_replace(['<', '>', 'WPos', 'MPos', ':', "", "\n"], '', data);
		var data_array = phpjs.explode(',', data);
		laserPos = new Vec2(phpjs.floatval(data_array[1]), phpjs.floatval(data_array[2]));
		
		
		io.sockets.emit('position', data_array, machineRunning, machinePause);
		
		if (laserPos.distance(goalPos) < minDistance) {
			currentQueue = 0;
			currentDistance = 0;
		}
		if (phpjs.time() - timer3 > intervalTime5) {
			relayStepperStatus = (data_array[0] == 'Idle') ? 0 : 1;
			board.digitalWrite(relayStepperVoltagePin, relayStepperStatus);
			timer3 = phpjs.time();
		}
	} else if (data.indexOf('ok') == 0) {
		timer1 = phpjs.time();
		if (is_running())
			sendGcodeFromQueue();
	} else if (data.indexOf('error') > -1) {
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

function write2serial(command, func) {
	if (relayStepperStatus == 0 && command.length > 1) {
		relayStepperStatus = 1;
		board.digitalWrite(relayStepperVoltagePin, relayStepperStatus);
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
	var serverLoad	= sh.exec("uptime | awk '{ print $10 }' | cut -c1-4").stdout;
	var tempGalileo	= sh.exec("cat /sys/class/thermal/thermal_zone0/temp | cut -c1-2").stdout;
	io.sockets.emit("system_log", {
		'serverLoad'	: serverLoad,
		'tempGalileo'	: tempGalileo
	});
}, intervalTime4);

console.log('Server runing port 9090');
