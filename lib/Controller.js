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
	this.status = {
		machineRunning	:	false,
		machinePause	:	true,
	}
	this.streamer 	= 	new Streamer({
		freq: options.interval[2],
		receiveFunc: function(data) {
			this.receiveData(data);
		}.bind(this),
		bufferLength: options.args.bufferLength,
		debug: false
	} );
	
	this.uploader	=	new IOUploader(options.siofu, function(socket, file, content, filepath, isPic) {
		this.__upload_complete(socket, file, content, filepath, isPic);
	}.bind(this), {
		maxFileSize: options.args.maxFileSize
		
	});
	
	this.uploader.on("error", function(msg) {
		console.log("Error catched");
		this.emit('emitToAllSocket', 'error', msg);
	}.bind(this));
	
	options.board.on('ready', function() {
		//fan
		this.fan = new five.Relay(this.options.pins.fanPin);
		this.speaker = new five.Relay(this.options.pins.speakerPin);
		
		this.buzzer(2); 
		this.fan.on();
		setTimeout(function() {
			this.fan.off();
		}.bind(this), 6000);
		
		//buttons
		var greenButton = new five.Button({
			pin: this.options.pins.greenButtonPin,
			isPullup: true
		});
		var redButton 	= new five.Button({
			pin: this.options.pins.redButtonPin,
			holdtime: 3000,
			isPullup: true
		});
		
		
		greenButton.on("hold", function() {
			this.render.printIP();
		}.bind(this));
		
		greenButton.on("down", function() {
			this.render.lightOn();
		}.bind(this));
		redButton.on("down", function() {
			if (this.status.machineRunning) {
				if (this.status.machinePause) {
					this.render.sendLCDMessage("Resuming...");
					this.unpause();
				} else {
					this.render.sendLCDMessage("Pause");
					this.pause();
				}
			}
		}.bind(this));
		redButton.on("hold", function() {
			if (!this.status.machineRunning) {
				if (this.status.machinePause)
					this.unpause();
				this.shutdown();
			} else {
				this.unpause();
				this.render.sendLCDMessage("Halt the machine");
				this.stop();
			}
		}.bind(this));
		
		
		this.render.waitIPScreen();
		setTimeout(function() {
			this.token.sendPushNotification("The laser IOT box is running!");
		}.bind(this), 2000);
	}.bind(this))
	
	if (phpjs.intval(this.options.args.feedRate) <= 0) 
		fs.readFile(__dirname + '/../data/feedRate', { encoding: 'utf8' }, function (err, data) {
			if (err) {
				console.log('can\'t read ./data/feedRate');
				this.options.args.feedRate = 300;
			} else {
				data = phpjs.str_replace("\n", "", data);
				console.log(data);
				this.options.args.feedRate = phpjs.intval(data);
				if (this.options.args.feedRate <= 1)
					this.options.args.feedRate = 100;
				this.emit("feedRate", this.options.args.feedRate);
			}
		}.bind(this));
	
	
	
	
	var self = this;
	var AT_interval1 = setInterval(function() {
		self.streamer.write("?");	
	}, options.interval[0]);

	
	this.serverLoad;
	this.tempRaspi;
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
		this.buzzer(times, ((nowStatus == true) ? false : true));
	}.bind(this), ((nowStatus != true) ? this.options.args.buzzerUp : this.options.args.buzzerDown));
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


var __finishSentInterval = undefined;
p.finishSent = function() {
	if (__finishSentInterval == undefined) {
		console.log("finish 'Sent gcode process'");
		var self = this
		__finishSentInterval = setInterval(function() {
			if (self.streamer.totalLength < 9) {
				clearInterval(__finishSentInterval);				
				self.finish();
				__finishSentInterval = undefined;
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
	this.streamer.stop();
	sendPush = (sendPush != undefined) ? sendPush : true;
	this.status.machineRunning	= false;
	this.status.machinePause	= true;
	startTime			= 0;
	
	currentDistance = 0;
	this.emit('emitToAllSocket', 'stopCountingTime');
	console.log('stop!');
	setTimeout(function() {
		this.streamer.write("~");
	}.bind(this), 400);
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
		var image = fs.readFileSync(filepath); 
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
p.__upload_complete = function(socket, file, content, filepath, isPic) {
	this.Queue.set(content);
	if (!isPic) {
		this.sendQueue();
		console.log("remove ");
		console.log(filepath);
		fs.unlink(filepath);
	} else
		this.sendImage(socket, filepath);
	this.render.sendLCDMessage("Upload completed" + file.name);
}

p.getVersion = function(){
	return this.version
}

p.updateVersion = function(newVersion) {
	this.version = newVersion 
	fs.writeFileSync(__dirname + '/../version.txt', newVersion)
}
