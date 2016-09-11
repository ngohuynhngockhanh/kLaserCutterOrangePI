#!/usr/bin/env node
const px2mm 	=	3.54328571429;
//require
var	express		=	require('express'),
	app        	= 	express(),
	siofu 		= 	require("socketio-file-upload"),
	fs         	= 	require('fs'),
	server		=	require('http').createServer(app),
    io			=	require('socket.io').listen(server),
	argv		=	require('optimist').argv,
	phpjs		= 	require('phpjs'),
	Infinity	=	1e90,
	Render		=	require('./lib/Render'),
	Controller 	=	require('./lib/Controller'),
	five		=	require("johnny-five"),
	Raspi		=	require("raspi-io"),
	board		=	new five.Board({
					io: new Raspi(),
					repl: false,
					debug: false,
				}),
	MJPG_Streamer=	require('./lib/mjpg_streamer');
	
	var socket_client = require('socket.io-client')
	var socketUserID=	1
	var socketServer= socket_client('http://klasercutter.app.arduino.vn:8068/klasercutter/' + socketUserID);
	var socketSecretKey = "bd033ee630fa3673035e11376b2fcdca"
	var patch = require('socketio-wildcard')(socket_client.Manager)
	patch(socketServer)
	
	
	
//argv
	argv.serverPort		=	argv.serverPort		|| 9091;						//kLaserCutter Server nodejs port
	argv.maxLengthCmd	=	argv.maxLengthCmd	|| 80;							//maxLength of batch process, in grbl wiki, it is 127
	argv.minCPUTemp		=	argv.minCPUTemp		|| 36;							// if galileo temp <= this => turn the fan off
	argv.maxCPUTemp		=	argv.maxCPUTemp		|| 40;							// if galileo temp > this => turn the fan on
	argv.maxCoorX		=	argv.maxCoorX		|| 355;							// your max X coordinate 
	argv.maxCoorY		=	argv.maxCoorY		|| 355;							// your max Y coordinate
	argv.intervalTime1	=	argv.intervalTime1	|| 10000;						//10s = 10000ms. Each 10s, we check grbl status once
	argv.intervalTime2	=	argv.intervalTime2	|| 10000;						//10s = 10000ms. Each 10s, we check camera status once
	argv.intervalTime3	= 	argv.intervalTime3	|| 1500;						//check current laser position after 610ms
	argv.intervalTime4	=	argv.intervalTime4	|| 30000;						//60s. Each 1 minute, we check grbl status to change to power saving mode
	argv.intervalTime5	=	argv.intervalTime5	|| 10000;						//10s. Each 10 seconds, we update Server log/ Raspi temperature OR Laser position once.
	argv.maxFileSize 	= 	argv.maxFileSize	|| 5 * 1024 * 1024;			//unit: byte
	argv.AuthKey 		= 	argv.AuthKey 		|| 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiI2MzExNmRlNS01Yzk4LTQ3OWEtYmQ2NC0zMzc1MzgzODMxODEifQ.dsId9F6Vedb6xGsDzgC8-53Uq1smCcgfTUUJMnyi32s';		//privateApiKey (Ionic App), create your own or use my own
	
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
				
var	tokenDevice	=	[],
	rememberTokenDevice = [],
	SVGcontent	=	"",						
	timer1		=	phpjs.time(),
	timer2		=	phpjs.time(),
	timer2		=	0,
	timer3		=	phpjs.time(),
	socketClientCount	= 0,
	//galileo pinout
	
	minCPUTemp	=	phpjs.intval(argv.minCPUTemp),
	maxCPUTemp	=	phpjs.intval(argv.maxCPUTemp),
	
	canSendImage		=	false,
	imagePath			=	'',
	
	goalPos		=	new Vec2(0, 0),
	intervalTime1		=	phpjs.intval(argv.intervalTime1),
	intervalTime2		=	phpjs.intval(argv.intervalTime2),
	intervalTime3		= 	phpjs.intval(argv.intervalTime3),
	intervalTime4		=	phpjs.intval(argv.intervalTime4),
	intervalTime5		=	phpjs.intval(argv.intervalTime5),
	mjpg_streamer=  new MJPG_Streamer(false, argv.mjpg),
	
	controller =	new Controller({
		board: board,
		siofu: siofu,
		pins: {
			fanPin				:	1,
			greenButtonPin		:	4,
			redButtonPin		:	5,
			speakerPin			:	26,
			lcd					: {
				pins: [7, 21, 22, 23, 24, 25],
				backlight: 11,
				rows: 2,
				cols: 16,
				constrast: 13
			}
		},
		args: {
			buzzerUp	: 2000,
			buzzerDown	: 1000,
			bufferLength: argv.maxLengthCmd,
			maxFileSize	: argv.maxFileSize,
			feedRate	: argv.feedRate,
			resolution	: argv.resolution,
			minCPUTemp	: argv.minCPUTemp,
			maxCPUTemp	: argv.maxCPUTemp
		},
		interval: [phpjs.intval(argv.intervalTime1), phpjs.intval(argv.intervalTime2), phpjs.intval(argv.intervalTime3), phpjs.intval(argv.intervalTime4), phpjs.intval(argv.intervalTime5)],
		ionicKey: {
			AuthKey: argv.AuthKey
		}
	});
	






board.on("ready", function() {
	console.log("board is ready");
});



app.use('/upload', express.static(__dirname + '/upload'));


controller.on('emitToAllSocket', function(msg, args) {
	if (msg == "position") {
		io.sockets.emit(msg, args[0], args[1], args[2], args[3]);
	} else if (msg == "gcode") {
		io.sockets.emit(msg, args[0], args[1]);
	} else {
		
		io.sockets.emit(msg, args);
	}	
});

controller.on('emitToSocketOrAll', function (socket, msg, args) {
	var socket = socket || io.sockets;
	if (msg == "AllGcode") {
		socket.emit(msg, args[0], args[1]);
	} else if (msg == "sendImage") {
		socket.emit(msg, args[0], args[1], args[2]);
	} else 
		socket.emit(msg, args);
});

controller.on('feedRate', function(feedRate) {
	argv.feedRate = feedRate;
})

io.sockets.on('connection', function (socket) {
	socketClientCount++;
	//socket ip
	controller.newConnection(socketClientCount, phpjs.str_replace("::ffff:", "", socket.handshake.address));
	controller.uploader.listen(socket);
	
    socket.emit("Say Hello")
	
	
	socket.on('disconnect', function() {
		socketClientCount--;
	});
	socket.on('start',function(copies){
		copies = copies || 1;
		controller.start(copies);
	});
	socket.on('requestQueue', function() {
		if (!controller.uploader.canSendImage)
			controller.sendQueue(socket);
		else
			controller.sendImage(socket);		
	});
	socket.on('pause', function() {
		controller.pause();
	});
	socket.on('unpause', function() {
		controller.unpause();		
	});
	socket.on('softReset', function() {
		controller.softReset();
	});
	socket.on('stop', function() {
		controller.stop();	
	});
	socket.on('cmd', function(cmd) {
		controller.sendCommand(cmd);
	});
	socket.on('resolution', function(resolution) {
		argv.resolution = resolution;
		controller.uploader.resolution(resolution);
		io.sockets.emit("settings", argv);
	});
	socket.on('maxLaserPower', function(power) {
		power = phpjs.intval(power);
		if (power < 0)
			power = 1;
		else if (power > 100)
			power = 100;
		
		argv.maxLaserPower = power;
		controller.uploader.maxLaserPower(power);
		console.log("change laser power to " + power + " %")
		io.sockets.emit("settings", argv);
	});
	socket.on('feedRate', function(feedRate) {
		feedRate = phpjs.intval(feedRate);
		if (feedRate <= 1) feedRate = 1;
		if (feedRate == argv.feedRate)
			return;
		fs.writeFile('./upload/feedRate', feedRate);
		
		controller.fixFeedRate(feedRate);
		
		argv.feedRate = feedRate;
		if (argv.feedRate == 1)
			argv.feedRate = 50;
		io.sockets.emit("settings", argv);
		
	});
	socket.on('token', function(token, remember) {
		controller.token.add(token, remember);
		console.log("token");
		console.log(token);
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
}.bind(this));

var localSocketClient = socket_client('http://127.0.0.1:'+argv.serverPort);
patch(localSocketClient)


localSocketClient.on('connect', function() {
	console.log("Connect den localhost thanh cong!")
});


localSocketClient.on('disconnect', function() {
	console.log("Disconnect den localhost!")
});

socketServer.on('connect', function(){
	console.log("Connected to server Socket")
	
	socketServer.emit('authentication', {uid: socketUserID, secretKey: socketSecretKey});
});

socketServer.on('authenticated', function() {
	console.log("Authenticated!");
});

socketServer.on('disconnect', function(){
	console.log("Disconnected to server Socket")
});

socketServer.on('*', function(info){
	var arg = info.data;
	localSocketClient.emit.apply(localSocketClient, arg)
});

localSocketClient.on('*', function(info){
	var arg = info.data;
	socketServer.emit.apply(socketServer, arg)
});

server.listen(argv.serverPort);
siofu.listen(server);
 


var AT_interval2 = setInterval(function() {
	var log = mjpg_streamer.tryRun();
	io.sockets.emit("mjpg_log", log);
}, intervalTime2);



console.log('Server runing port ' + argv.serverPort);
