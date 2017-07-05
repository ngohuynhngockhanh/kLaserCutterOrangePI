const 	MAX_SIZE = 280 * 1024 * 1024

var 	phpjs		=		require('phpjs'),
		sh 			= 		require('sync-exec'),
		Deque 		= 		require("double-ended-queue");		
		Render		=		require('./Render'),
		Streamer	=		require('./streamer'),
		SVGqueue	=		require('./SVGqueue'),
		five		=		require("johnny-five"),
		fs         	= 		require('fs'),
		events 		= 		require('events'),
		IOUploader	= 		require('./IOUploader'),
		util 		= 		require('util'),
		Vec2		=		require('vec2'),
		Token		=		require('./token'),
		exec 		=		require('child_process').exec;
		
function Controller(options) {
	var self = this
	options = options || {};
	this.options = options;
	
	this.Queue		= 	new SVGqueue(this.streamer),
	this.render 	= 	new Render(this.options.pins.lcd, options.board),
	this.laserPos	=	new Vec2(0, 0);
	this.speaker;
	this.fan;
	this.timeoutOnRunning;
	this.copiesDrawing 		= 1;
	this.startTime = 0;
	this.version = fs.readFileSync(__dirname + '/../version.txt').toString() //version
	this.token = new Token(this.render, {
		AuthKey: options.ionicKey.AuthKey
		
	});
	this.__finishSentInterval;
	this.status = {
		machineRunning	:	false,
		machinePause	:	true,
	}
	this.streamer 	= 	new Streamer({
		freq: options.interval[2],
		receiveFunc: function(data) {
			self.receiveData(data);
		},
		bufferLength: options.args.bufferLength,
		debug: false
	} );
	
	this.uploader	=	new IOUploader(options.siofu, function(socket, file, content, filepath, isPic) {
		self.__upload_complete(socket, file, content, filepath, isPic);
	}, {
		maxFileSize: options.args.maxFileSize
		
	});
	
	this.uploader.on("error", function(msg) {
		console.log("Error catched");
		self.emit('emitToAllSocket', 'error', msg);
	});
	
	options.board.on('ready', function() {
		//fan
		self.fan = new five.Relay(self.options.pins.fanPin);
		self.speaker = new five.Relay(self.options.pins.speakerPin);
		
		self.buzzer(2); 
		self.fan.on();
		setTimeout(function() {
			self.fan.off();
		}, 6000);
		
		//buttons
		var greenButton = new five.Button({
			pin: self.options.pins.greenButtonPin,
			isPullup: true
		});
		var redButton 	= new five.Button({
			pin: self.options.pins.redButtonPin,
			holdtime: 3000,
			isPullup: true
		});
		
		
		greenButton.on("hold", function() {
			self.render.printIP();
		});
		
		greenButton.on("down", function() {
			self.render.lightOn();
		});
		redButton.on("down", function() {
			if (self.status.machineRunning) {
				if (self.status.machinePause) {
					self.render.sendLCDMessage("Resuming...");
					self.unpause();
				} else {
					self.render.sendLCDMessage("Pause");
					self.pause();
				}
			}
		});
		redButton.on("hold", function() {
			if (!self.status.machineRunning) {
				if (self.status.machinePause)
					self.unpause();
				self.shutdown();
			} else {
				self.unpause();
				self.render.sendLCDMessage("Halt the machine");
				self.stop();
			}
		});
		
		
		self.render.waitIPScreen();
		setTimeout(function() {
			self.token.sendPushNotification("The laser IOT box is running!");
		}, 2000);
	})
	
	if (phpjs.intval(this.options.args.feedRate) <= 0) 
		fs.readFile(__dirname + '/../data/feedRate', { encoding: 'utf8' }, function (err, data) {
			if (err) {
				console.log('can\'t read ./data/feedRate');
				self.options.args.feedRate = 300;
			} else {
				data = phpjs.str_replace("\n", "", data);
				console.log(data);
				self.options.args.feedRate = phpjs.intval(data);
				if (self.options.args.feedRate <= 1)
					self.options.args.feedRate = 100;
				self.emit("feedRate", self.options.args.feedRate);
			}
		});
	
	setTimeout(function() {
		var AT_interval1 = setInterval(function() {
			self.streamer.write("?");	
		}, options.interval[0]);

		
		self.serverLoad;
		self.tempRaspi;
		var AT_interval4 = setInterval(function() {
			self.serverLoad	= phpjs.trim(sh("uptime | awk '{ print $10 }' | cut -c1-4").stdout);
			self.tempRaspi	= phpjs.intval(sh("cat /sys/class/thermal/thermal_zone0/temp | cut -c1-2").stdout);
			exec("echo '" + self.serverLoad + "' >> ./upload/sl.log");
			if (self.fan) {
				if (self.fan.isOn) {
					if (self.tempRaspi <= self.options.args.minCPUTemp) {
						self.fan.off();
					}
				} else {
					if (self.tempRaspi > self.options.args.maxCPUTemp) {
						self.fan.on();
					}
				}
			}
			self.emit('emitToAllSocket', "system_log", {
				'serverLoad'	: self.serverLoad,
				'tempGalileo'	: self.tempRaspi
			});
		}, options.interval[3]);

		var AT_interval5 = setInterval(function() {
			if (!self.render.isBusy()) {
				var randomNumber = phpjs.rand(0, 1);
				switch (randomNumber) {
					case 0:
						self.render.sendLCDMessage(phpjs.sprintf("X:%14.5fY:%14.5f", self.laserPos.x, self.laserPos.y), {backlight: false});
						break;
					case 1:
						self.render.sendLCDMessage(phpjs.sprintf("Server Load:%4.2fRaspi   %2d oC", phpjs.floatval(self.serverLoad), self.tempRaspi), {backlight: false});
						break;
				}
				
			}
		}, options.interval[4]);
		
		setInterval(function() {
			var ram = process.memoryUsage().heapUsed
			if (ram > MAX_SIZE) {
				self.emit('emitToAllSocket', 'error', {id: 2, message: "Out of RAM"});
				setTimeout(function() {
					process.exit()
				})
			} else 
				console.log(ram / 1024 / 1024)
		}, 10000)
	}, 1000);
}
module.exports = Controller;

util.inherits(module.exports, events.EventEmitter);
var p = Controller.prototype;

p.getOptions = function() {
	return this.options;
};
	
p.getFeedRate = function() {
	return this.options.args.feedRate
}
	
p.newConnection = function(count, ip) {
	this.render.newConnection(count, ip);
};
	
p.buzzer = function(times, nowStatus) {
	var self = this
	if (!this.speaker)
		return;
	if (times == 0) {
		this.speaker.off();
		return;
	}
	if (nowStatus != true) {
		this.speaker.on();
	} else {
		this.speaker.off();
	}
	
	setTimeout(function() {
		if (nowStatus == true)
			times--;
		self.buzzer(times, ((nowStatus == true) ? false : true));
	}, ((nowStatus != true) ? self.options.args.buzzerUp : self.options.args.buzzerDown));
};

p.isMachineRunning = function() {
	return this.status.machineRunning;
};
	
p.isMachinePause = function() {
	return this.status.machinePause;
};
	
p.isRunning = function() {
	return this.isMachineRunning() && !this.isMachinePause();
};

p.shutdown = function() {
	if (fs.existsSync(__dirname + '/../upload/rememberDevice.json'))
		fs.writeFileSync(__dirname + '/../data/rememberDevice.json', fs.readFileSync(__dirname + '/../upload/rememberDevice.json'));
	if (fs.existsSync(__dirname + '/../upload/feedRate'))
		fs.writeFileSync(__dirname + '/../data/feedRate', fs.readFileSync(__dirname + '/../upload/feedRate'));
	this.token.sendPushNotification("The machine was shutted down!");
	this.render.sendLCDMessage("Shutting down...Wait 10 seconds!");
	
	this.fan.off();
	console.log("shutdown");
	setTimeout(function() {
		sh("shutdown -h now");	
	}, 1000);
};

p.sendFirstGCodeLine = function() {
	if (this.Queue.isEmpty()) {	// is empty list
		if (this.copiesDrawing <= 1) {
			this.finishSent();
			return false;
		} else {
			this.Queue.revert();
			this.copiesDrawing--;
		}
	}
	
	
	//get the last command.
	var command = this.Queue.shift();
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
	this.emit('emitToAllSocket', "gcode", [{command: command, length: this.Queue.length()}, startTime]);
	
	command = phpjs.str_replace(" ", "", command);
	this.streamer.write(command);
	return true;
}


p.finishSent = function() {
	if (this.__finishSentInterval == undefined) {
		console.log("finish 'Sent gcode process'");
		var self = this
		self.__finishSentInterval = setInterval(function() {
			if (self.streamer.totalLength < 9) {
				clearInterval(self.__finishSentInterval);				
				self.finish();
				self.__finishSentInterval = undefined;
			} else 
				console.log("Just only length " + self.streamer.totalLength);
		}, 50);
	}
}

p.pause = function() {
	this.status.machinePause = true;
	this.streamer.writeDirect("!\n");
	console.log("pause");
	this.render.sendLCDMessage("Pause");	
};

p.unpause = function() {
	this.status.machinePause = false;
	this.streamer.writeDirect("~\n");
	console.log("unpause");
	this.render.sendLCDMessage("Resuming...");
};


p.start = function(copies) {	
	this.status.machineRunning	= true;
	this.status.machinePause	= false;
	console.log("machine is running!");
	startTime = phpjs.time();
	copies = phpjs.intval(copies);
	if (copies <= 1)
		copies = 1;
	this.copiesDrawing = copies;
	this.Queue.checkBeforeStart();
	this.streamer.writeDirect("~\n");
	this.token.sendPushNotification("The machine has just been started!");
	this.render.sendLCDMessage("It's running ^^!Yeah, so cool.");
	for(var i = 0; i < phpjs.min(phpjs.rand(5, 10), this.Queue.length()); i++)
		this.sendFirstGCodeLine();
}


p.finish = function() {
	console.log('finish');
	this.emit('emitToAllSocket', 'finish');
	this.token.sendPushNotification("I have just finished my job! ^-^");
	this.buzzer(3); 
	this.render.sendLCDMessage("I have just     finished my job!");
	this.stop(false);
}

p.stop = function(sendPush) {
	var self = this
	this.streamer.stop();
	sendPush = (sendPush != undefined) ? sendPush : true;
	this.status.machineRunning	= false;
	this.status.machinePause	= true;
	startTime			= 0;
	
	currentDistance = 0;
	this.emit('emitToAllSocket', 'stopCountingTime');
	console.log('stop!');
	setTimeout(function() {
		self.streamer.write("~");
	}, 400);
	if (sendPush)
		this.token.sendPushNotification("The machine was stopped");
	
	this.Queue.revert();
	this.render.sendLCDMessage("Stopped!");	
}




p.softReset = function() {
	console.log("reset");
	this.streamer.write("\030");
};

p.sendCommand = function(command) {
	if (this.isRunning())
		console.log("this machine is running, so you can't execute any command");
	else {
		command = phpjs.strval(command);
		console.log("send command " + command);
		this.streamer.write(command);
	}
};

p.receiveData = function(data) {
	if (data.indexOf('<') == 0) {	//type <status,...>
		//console.log(data);
		data = phpjs.str_replace(['<', '>', 'WPos', 'MPos', ':', "", "\n"], '', data);
		var data_array = phpjs.explode(',', data);
		this.laserPos.set(phpjs.floatval(data_array[1]), phpjs.floatval(data_array[2]));
		
		
		this.emit('emitToAllSocket', 'position', [data_array, this.status.machineRunning, this.status.machinePause, this.copiesDrawing]);
		
		
		if (!this.isMachinePause() && data_array[0] == 'Hold') {
			this.unpause();
		}
		
	} else if (data.indexOf('ok') == 0) {
		this.streamer.receiveOk();
		
		
		timer1 = phpjs.time();
		if (this.isRunning()) {
			this.sendFirstGCodeLine();
		}
	} else if (data.indexOf('error') > -1) {
		this.streamer.receiveError();
		this.emit('emitToAllSocket', 'error', {id: 2, message: data});
	} else {
		this.emit('emitToAllSocket', 'data', data);
	}
	this.streamer.update(); //try to send new command
	
}

p.getQueue = function() {
	return this.Queue;
}


p.sendQueue = function(socket) {
	this.emit('emitToSocketOrAll', socket, 'AllGcode', [this.getQueue().getAllGCode(), this.isMachineRunning()]);

	if (this.uploader.getSVGcontent() != "") {
		this.sendSVG(this.uploader.getSVGcontent());
	}
}

p.sendSVG = function(SVGContent, socket) {
	this.emit('emitToSocketOrAll', socket, 'sendSVG', SVGContent);
	console.log('send SVG');
}

p.sendImage = function(socket, filepath) {
	var imagePath;
	console.log("this.Queue.getAllGCodeLength() " + this.Queue.getAllGCodeLength());
	var __sendQueue = this.Queue.getAllGCodeLength() < 22696;
	if (__sendQueue)
		this.sendQueue();
	var queueLength = this.Queue.getAllGCodeLength();
	
	
	if (filepath) {
		imagePath = filepath;
		
		var image = fs.readFileSync(filepath, 'utf-8'); 
		imagePath = "data:image/jpeg;charset=utf-8;base64," + image.toString("base64")
		image = null
	}
	
	this.emit('emitToSocketOrAll', socket, 'sendImage', [imagePath, __sendQueue, queueLength]);
}

p.fixFeedRate = function(feedRate) {
	console.log("fix feedRate " + feedRate);
	this.streamer.write(phpjs.sprintf("G01 F%.1f", phpjs.floatval(feedRate)));
	this.Queue.fixFeedRate(this.uploader.getFeedRate(), feedRate);
	this.uploader.feedRate(feedRate);
} 

p.sendCommand = function(cmd) {
	cmd = cmd || "";
	cmd = phpjs.str_replace(['"', "'"], '', cmd);
	this.streamer.writeDirect(cmd + "\n");
}

//private
// Do something when a file is saved:
p.__upload_complete = function(socket, filename, content, filepath, isPic) {
	this.Queue.set(content);
	if (!isPic) {
		this.sendQueue();
		console.log("remove ");
		console.log(filepath);
		fs.unlink(filepath);
	} else
		this.sendImage(socket, filepath);
	this.render.sendLCDMessage("Upload completed" + filename);

}

p.getVersion = function(){
	return this.version
}

p.updateVersion = function(newVersion) {
	this.version = newVersion 
	fs.writeFileSync(__dirname + '/../version.txt', newVersion)
}
