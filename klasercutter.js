#!/usr/bin/env node
const px2mm 	=	3.54328571429;
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
	Jimp		=	require('jimp'),
	svg2gcode	=	require('./lib/svg2gcode'),
	pic2gcode	=	require('./lib/pic2gcode'),
	Streamer	=	require('./lib/streamer'),
	Vec2		=	require('vec2'),
	sleep		=	require('sleep'),
	sh 			= 	require('sync-exec'),
	five		=	require("johnny-five"),
	Raspi		=	require("raspi-io"),
	board		=	new five.Board({
					io: new Raspi(),
					repl: false,
					debug: false,
				}),
	//wpi 		=	require('wiring-pi'),
	MJPG_Streamer=	require('./lib/mjpg_streamer'),
	
	Deque 		= 	require("double-ended-queue"),
	sizeOf 		= 	require('image-size');
//argv
	argv.serverPort		=	argv.serverPort		|| 9091;						//kLaserCutter Server nodejs port
	argv.maxLengthCmd	=	argv.maxLengthCmd	|| 127;							//maxLength of batch process, in grbl wiki, it is 127
	argv.minCPUTemp		=	argv.minCPUTemp		|| 36;							// if galileo temp <= this => turn the fan off
	argv.maxCPUTemp		=	argv.maxCPUTemp		|| 40;							// if galileo temp > this => turn the fan on
	argv.maxCoorX		=	argv.maxCoorX		|| 320;							// your max X coordinate 
	argv.maxCoorY		=	argv.maxCoorY		|| 315;							// your max Y coordinate
	argv.intervalTime1	=	argv.intervalTime1	|| 10000;						//10s = 10000ms. Each 10s, we check grbl status once
	argv.intervalTime2	=	argv.intervalTime2	|| 10000;						//10s = 10000ms. Each 10s, we check camera status once
	argv.intervalTime3	= 	argv.intervalTime3	|| 610;						//check current laser after 610ms
	argv.intervalTime4	=	argv.intervalTime4	|| 30000;						//60s. Each 1 minute, we check grbl status to change to power saving mode
	argv.intervalTime5	=	argv.intervalTime5	|| 10000;						//10s. Each 10 seconds, we update Server log/ Raspi temperature OR Laser position once.
	argv.maxFileSize 	= 	argv.maxFileSize	|| 5 * 1024 * 1024;			//unit: byte
	argv.privateApiKey 	= 	argv.privateApiKey 	|| '80f9f6fa60371b14d5237645b79a72f6e016b08831ce12a3';		//privateApiKey (Ionic App), create your own or use my own
	argv.ionicAppId		=	argv.ionicAppId 	|| '46a9aa6b';												//ionic app id (ionic app), create your own or use my own
	argv.feedRate		=	(argv.feedRate != undefined) ? argv.feedRate : -1;								//-1 means fetch from sdcard
	argv.maxLaserPower	= 	argv.maxLaserPower	|| 100;
	argv.resolution		=	argv.resolution		|| px2mm;				//pic2gcode (picture 2 gcode) resolution
	argv.mjpg			=	(argv.mjpg != undefined) ? JSON.parse(argv.mjpg) : {
								"port"			:	8080,
								"resolution"	:	"320x240",
								"fps"			:	"5",
								"quality"		:	"50",
								"format"		:	"auto"
							};

//mjpeg options log				
console.log("MJPG options: ");
console.log(argv.mjpg);
				
var	gcodeQueue	= 	new Deque([]),
	gcodeDataQueue= new Deque([]),
	tokenDevice	=	[],
	rememberTokenDevice = [],
	SVGcontent	=	"",						
	timer1		=	phpjs.time(),
	timer2		=	phpjs.time(),
	timer2		=	0,
	timer3		=	phpjs.time(),
	socketClientCount	= 0,
	copiesDrawing 		= 1,
	lcdBusy 	= false,
	//galileo pinout
	fanPin				=	1,
	greenButtonPin		=	4,
	redButtonPin		=	5,
	speakerPin			=	26,
	lcdPowerPin		=	14,
	lcdContrastPin		=	13,
	minCPUTemp	=	phpjs.intval(argv.minCPUTemp),
	maxCPUTemp	=	phpjs.intval(argv.maxCPUTemp),
	machineRunning		=	false,
	machinePause		=	true,
	canSendImage		=	false,
	imagePath			=	'',
	laserPos	=	new Vec2(0, 0),
	goalPos		=	new Vec2(0, 0),
	intervalTime1		=	phpjs.intval(argv.intervalTime1),
	intervalTime2		=	phpjs.intval(argv.intervalTime2),
	intervalTime3		= 	phpjs.intval(argv.intervalTime3),
	intervalTime4		=	phpjs.intval(argv.intervalTime4),
	intervalTime5		=	phpjs.intval(argv.intervalTime5),
	mjpg_streamer=  new MJPG_Streamer(false, argv.mjpg),
	streamer	=	new Streamer({
		freq: intervalTime3,
		receiveFunc: receiveData,
		bufferLength: argv.maxLengthCmd
	}),
	//implement	
	lcd,
	ipAddress,
	newConnection,								
	sendLCDMessage,
	serverLoad,
	tempRaspi,
	fan,
	greenButton,
	speaker,
	redButton,
	buzzerUp = 2000,
	buzzerDown = 1000;



var _getIpAddress_idx = 0;
function getIpAddress() {
	var ip = sh("ifconfig | grep -v 169.254.255.255 | grep -v 127.0.0.1 |  awk '/inet addr/{print substr($2,6)}'");	
	console.log(JSON.stringify(ip, null, 4));
	ip = ip.stdout;
	console.log(ip);
	ip = phpjs.explode("\n", ip);
	console.log(ip);
	var count = phpjs.count(ip) - 1;
	if (count <= 0)
		return "";
	_getIpAddress_idx = (_getIpAddress_idx + 1) % count;
	return ip[_getIpAddress_idx];
}	

function shutdown() {
	if (fs.existsSync('./upload/rememberDevice.json'))
		fs.writeFileSync('./data/rememberDevice.json', fs.readFileSync('./upload/rememberDevice.json'));
	if (fs.existsSync('./upload/feedRate'))
		fs.writeFileSync('./data/feedRate', fs.readFileSync('./upload/feedRate'));
	sendPushNotification("The machine was shutted down!");
	if (sendLCDMessage)
		sendLCDMessage("Shutting down...Wait 10 seconds!");
	
	fan.off();
	console.log("shutdown");
	setTimeout(function() {
		sh("shutdown -h now");	
	}, 1000);
}

//BUZZER RINGS!
var buzzer = function(times, nowStatus) {
	if (!speaker)
		return;
	if (times == 0) {
		speaker.off();
		return;
	}
	if (nowStatus != true) {
		speaker.on();
	} else {
		speaker.off();
	}
	
	setTimeout(function() {
		if (nowStatus == true)
			times--;
		buzzer(times, ((nowStatus == true) ? false : true));
	}, ((nowStatus != true) ? buzzerUp : buzzerDown));
}

board.on("ready", function() {
	//lcdContrast
	
	
	console.log("board is ready");
	var lcdPower = new five.Relay(lcdPowerPin);
	lcdPower.off();
	
	lcdPower.on();
	
	var lcdContrast = new five.Relay(lcdContrastPin);
	lcdContrast.on();
	
	//fan
	fan = new five.Relay(fanPin);
	speaker = new five.Relay(speakerPin);
	
	buzzer(2); 
	fan.on();
	setTimeout(function() {fan.off();}, 6000);
	
	//buttons
	greenButton = new five.Button({
		pin: greenButtonPin,
		isPullup: true
	});
	redButton 	= new five.Button({
		pin: redButtonPin,
		holdtime: 3000,
		isPullup: true
	});
	
	
	
	
	var lcdTimeout;
	
	var lcd = new five.LCD({
		pins: [7, 21, 22, 23, 24, 25],
		backlight: 11,
		rows: 2,
		cols: 16
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
	
	
	
	getTheFirstIp = function () {
		var ipAddress = getIpAddress();
		if (phpjs.strlen(ipAddress) > 7) {
			sendLCDMessage("IP Address:     " + ipAddress, {timeout: 30000});
		} else {
			lcd.clear();
			lcd.cursor(0, 0).print("Wait for IP");
			for (var i = 5 ; i >= 1; i--) {				
				lcd.cursor(1, 0).print(".............." + i + "s");
				sleep.sleep(1);
			}
			setTimeout(function() {
				getTheFirstIp();
			}, 5000);
		}			
	}
	
	getTheFirstIp();
	
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
				unpause();
			shutdown();
		} else {
			unpause();
			sendLCDMessage("Halt the machine");
			stop();
		}
	});
	
});



app.use('/upload', express.static(__dirname + '/upload'));
	
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
		pic2gcode.clear();
		event.file.name = phpjs.str_replace("'", "", event.file.name);
		var file = event.file;
		var fileSize = file.size;
		if (fileSize > argv.maxFileSize) {
			socket.emit("error", {id: 3, message: "MAX FILE FILE is " + (settings.maxFileSize / 1024 / 1024) + "MB"});
			return false;
		}
	});
	 // Do something when a file is saved:
	var __upload_complete = function(file, content, filepath, isPic) {
		addQueue(content);
		if (!isPic) {
			sendQueue();
			fs.unlink(filepath);
		} else
			sendImage(socket, filepath);
		if (sendLCDMessage)
			sendLCDMessage("Upload completed" + file.name);
	}
    uploader.on("complete", function(event){
		console.log("upload complete");
        var file = event.file;
		sh("cd ./upload && find ! -name '" + phpjs.str_replace(['\\', "'", 'upload/'], '', file.pathName) + "' -type f -exec rm -f {} +");		
		var filepath = './' + file.pathName;
		var re = /(?:\.([^.]+))?$/;
		var ext = re.exec(filepath)[1];
		if (ext)
			ext = phpjs.strtolower(ext);
		
		setTimeout(function() {
			SVGcontent = "";
			var isGCODEfile = (ext == 'gcode' || ext == 'sd' || ext == 'txt');
			var isPICfile = (ext == 'jpg' || ext == 'jpeg' || ext == 'bmp' || ext == 'png');
			canSendImage = isPICfile;
			var options = argv;			
			console.log(filepath);
			if (isPICfile) {
				var imageSize = sizeOf(filepath);
				var width = imageSize.width / px2mm;
				var height = imageSize.height / px2mm;
				console.log(width);
				console.log(height);
				if (width > argv.maxCoorX || height > argv.maxCoorY || width == 0 || height == 0) {
					io.sockets.emit('error', {
						id: 4,
						message: phpjs.sprintf('Only accept size less than %d x %d (px x px)', argv.maxCoorX * px2mm, argv.maxCoorY * px2mm)
					});
				} else {
					var image = new Jimp(filepath, function(e, image) {
						if (e) {
							return false;
							fs.unlink(filepath);
						}
						var check = pic2gcode.pic2gcode(image, options, {
							percent:	function(percent) {
								socket.emit("percent", percent);
							},
							complete: function(gcode) {
								__upload_complete(file, gcode, filepath, true);
							}
						});
					});
				}
			} else {
				var content = fs.readFileSync(filepath);
				socket.emit("percent");	
				if (!isGCODEfile) {
					SVGcontent = content.toString();
					content = svg2gcode.svg2gcode(SVGcontent, options, function(percent) {
						
					});
				} else 
					content = content.toString();
				if (ext != 'svg')
					SVGcontent = "";
				
				__upload_complete(file, content, filepath);
			}
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
		if (!canSendImage)
			sendQueue(socket);
		else
			sendImage(socket);		
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
		streamer.writeDirect(cmd + "\n");
	});
	socket.on('resolution', function(resolution) {
		argv.resolution = resolution;
		io.sockets.emit("settings", argv);
	});
	socket.on('maxLaserPower', function(power) {
		power = phpjs.intval(power);
		if (power < 0)
			power = 1;
		else if (power > 100)
			power = 100;
		
		argv.maxLaserPower = power;
		console.log("change laser power to " + power + " %")
		io.sockets.emit("settings", argv);
	});
	socket.on('feedRate', function(feedRate) {
		feedRate = phpjs.intval(feedRate);
		if (feedRate <= 1) feedRate = 1;
		if (feedRate == argv.feedRate)
			return;
		fs.writeFile('./upload/feedRate', feedRate);
		
		var replaceFeedRate = function(queue, start) { 
			var oldF = 'F' + argv.feedRate;
			var newF = 'F' + feedRate;
			var i = start;
			for (; i < phpjs.min(queue.length / 100 + start, queue.length); i++)
				queue[i] = phpjs.str_replace(oldF, newF, queue[i]);
			console.log("replace Feed rate");
			if (start == 0)
				streamer.write(phpjs.sprintf("G01 F%.1f", phpjs.floatval(feedRate)));
			if (i < queue.length)	
				setTimeout(function() {replaceFeedRate(queue, i);}, 5);
			
		}
		replaceFeedRate(gcodeQueue, 0);
		replaceFeedRate(gcodeDataQueue, 0);
		argv.feedRate = feedRate;
		if (argv.feedRate == 1)
			argv.feedRate = 50;
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
	socket.on('webcamChangeResolution', function(resolution) {
		var list = mjpg_streamer.getSizeList();
		var index = list.indexOf(resolution);
		if (index == -1)
			resolution = 'auto';
		console.log("webcam change to " + resolution);
		mjpg_streamer.setResolution(resolution);
		io.sockets.emit("mjpg_log", mjpg_streamer.tryRun(true)); // try to reset (if we can)
	});
	
	socket.emit("settings", argv);
	socket.emit("webcamSizeList", mjpg_streamer.getSizeList());
});

server.listen(argv.serverPort);
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

function sendImage(socket, filepath) {
	if (filepath)
		imagePath = filepath;
	var __sendQueue = gcodeDataQueue.length < 22696;
	if (__sendQueue)
		sendQueue();
	var queueLength = gcodeDataQueue.length;
	if (socket)
		socket.emit("sendImage", imagePath, __sendQueue, queueLength);
	else
		io.sockets.emit("sendImage", imagePath, __sendQueue, queueLength);
}

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

var __finishSentInterval;
function finishSent() {
	if (__finishSentInterval == undefined) {
		console.log("finish 'Sent gcode process'");
		__finishSentInterval = setInterval(function() {
			if (streamer.isFree()) {
				clearInterval(__finishSentInterval);				
				finish();
				__finishSentInterval = undefined;
			}
		}, 50);
	}
}

function finish() {
	console.log('finish');
	io.sockets.emit('finish');
	sendPushNotification("I have just finished my job! ^-^");
	buzzer(3); 
	if (sendLCDMessage)
		sendLCDMessage("I have just     finished my job!");
	stop(false);
}

function stop(sendPush) {
	streamer.stop();
	//goalPos.set(0, 0);
	sendPush = (sendPush != undefined) ? sendPush : true;
	machineRunning	= false;
	machinePause	= true;
	timer2			= 0;
	gcodeQueue 		= new Deque(gcodeDataQueue);
	currentDistance = 0;
	stopCountingTime();
	console.log('stop!');
	setTimeout(function() {
		streamer.write("~");
	}, 400);
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
	if (gcodeQueue.isEmpty() && gcodeDataQueue.length > 0)
		gcodeQueue = new Deque(gcodeDataQueue.toArray());
	streamer.writeDirect("~\n");
	sendPushNotification("The machine has just been started!");
	
	for(var i = 0; i < phpjs.min(phpjs.rand(5, 10), gcodeQueue.length); i++)
		sendGcodeFromQueue();
}

function pause() {
	machinePause = true;
	streamer.writeDirect("!\n");
	console.log("pause");
}

function unpause() {
	machinePause = false;
	streamer.writeDirect("~\n");
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
	streamer.write("\030");
}

function sendCommand(command) {
	if (is_running())
		console.log("this machine is running, so you can't execute any command");
	else {
		command = phpjs.strval(command);
		console.log("send command " + command);
		streamer.write(command);
	}
}

function getPosFromCommand(which, command) {
	var tmp = phpjs.explode(which, command);
	if (tmp.length == 1)
		return undefined;
	return phpjs.floatval(tmp[1]);
}
function sendFirstGCodeLine() {
	if (gcodeQueue.isEmpty()) {	// is empty list
		if (copiesDrawing <= 1) {
			finishSent();
			return false;
		} else {
			gcodeQueue = new Deque(gcodeDataQueue.toArray());
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
	command = phpjs.trim(command.replace(/[^a-zA-Z0-9-.$ ]/g, ''));
	//write command to grbl
	
	
	//convert command to upper style
	command = phpjs.strtoupper(command);
	
	// send gcode command to client
	io.sockets.emit("gcode", {command: command, length: gcodeQueue.length}, timer2);
	
	command = phpjs.str_replace(" ", "", command);
	streamer.write(command);
	return true;
}


function sendGcodeFromQueue() {
	sendFirstGCodeLine();
}

var timeoutRunningPeriod = 2000;

var timeoutOnRunning = undefined;

function receiveData(data) {
	//console.log(data);
	if (data.indexOf('<') == 0) {	//type <status,...>
		//console.log(data);
		data = phpjs.str_replace(['<', '>', 'WPos', 'MPos', ':', "", "\n"], '', data);
		var data_array = phpjs.explode(',', data);
		laserPos.set(phpjs.floatval(data_array[1]), phpjs.floatval(data_array[2]));
		
		
		io.sockets.emit('position', data_array, machineRunning, machinePause, copiesDrawing);
		
		
		if (!machinePause && data_array[0] == 'Hold') {
			unpause();
		}
		
	} else if (data.indexOf('ok') == 0) {
		streamer.receiveOk();
		
		
		timer1 = phpjs.time();
		if (is_running()) {
			sendGcodeFromQueue();
		}
	} else if (data.indexOf('error') > -1) {
		streamer.receiveError();
		io.sockets.emit('error', {id: 2, message: data});
	} else {
		io.sockets.emit('data', data);
	}
	console.log(streamer.getCurrentSentCountCommand());
	if (timeoutOnRunning)
		clearTimeout(timeoutOnRunning);
	if (is_running()) {
		timeoutOnRunning = setTimeout(function() {
			if (is_running())
				receiveData('ok');
		}, timeoutRunningPeriod);
	}
	streamer.update(); //try to send new command
	
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
	gcodeQueue = new Deque(list);
	gcodeDataQueue = new Deque(list);
}
function saveRememberDevice(list) {
	list = list || rememberTokenDevice;
	fs.writeFile('./upload/rememberDevice.json', JSON.stringify(list));
}








var AT_interval1 = setInterval(function() {
	streamer.write("?");	
	if (is_running() && phpjs.time() - timer1 > intervalTime1) 
		io.sockets.emit("error", {id: 0, message: 'Long time to wait ok response'});
}, intervalTime1);

var AT_interval2 = setInterval(function() {
	var log = mjpg_streamer.tryRun();
	io.sockets.emit("mjpg_log", log);
}, intervalTime2);

var AT_interval4 = setInterval(function() {
	serverLoad	= phpjs.trim(sh("uptime | awk '{ print $10 }' | cut -c1-4").stdout);
	tempRaspi	= phpjs.intval(sh("cat /sys/class/thermal/thermal_zone0/temp | cut -c1-2").stdout);
	exec("echo '" + serverLoad + "' >> ./upload/sl.log");
	if (fan) {
		if (fan.isOn) {
			if (tempRaspi <= minCPUTemp) {
				fan.off();
			}
		} else {
			if (tempRaspi > maxCPUTemp) {
				fan.on();
			}
		}
	}
	io.sockets.emit("system_log", {
		'serverLoad'	: serverLoad,
		'tempGalileo'	: tempRaspi
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
				sendLCDMessage(phpjs.sprintf("Server Load:%4.2fRaspi   %2d oC", phpjs.floatval(serverLoad), tempRaspi), {backlight: false});
				break;
		}
		
	}
}, intervalTime5);

console.log('Server runing port ' + argv.serverPort);
