var 	phpjs		=		require('phpjs'),
		fs			=		require('fs'),
		sh 			= 		require('sync-exec'),
		SerialPort	=		require("serialport"),
		Deque 		= 		require("double-ended-queue");		
function receiveFuncExample(data) {
	console.log(data)
}
function Streamer(options) {
	options = options || {};
	options.freq = options.freq || 1000;
	options.receiveFunc = options.receiveFunc || receiveFuncExample;
	options.bufferLength = options.bufferLength || 100;
	this.options = options;
	this.serial_free	= true;
	this.sent_count	= 0; 
	this.sent_count_direct = 0;
	this.serial_queue	= [];
	this.preProcessQueue = {command: ""};
	this.lastCommand = "";
	this.lenInQueue = new Deque([]);
	this.totalLength = 0;
	this.serialPort = new SerialPort("/dev/ttyUSB0", {
		baudrate: 115200,
		parser: SerialPort.parsers.readline("\n")
	}),
	this.serialPort.on("open", function (error) {
		if (error) {
			console.log(error);
			io.sockets.emit("error", {id: 0, message: "Can't open Serial port", error: error});
		} else {
			console.log('open serial port');
			var interval = setInterval(function() {
				this.serialPort.write("?");
					
			}.bind(this), this.options.freq);
			this.serialPort.on('data', function(data) {
				//console.log(data);
				this.options.receiveFunc(data);
			}.bind(this));
		}
	}.bind(this));
}

Streamer.prototype = {
    constructor: Streamer,
	getOptions: function() {
		return this.options;
	},
	
	
	
	
	//public
	receive: function() {
		if (this.sent_count_direct > 0)
			this.sent_count_direct--;
		else {
			if (!this.lenInQueue.isEmpty()) {
				var l = this.lenInQueue.shift();
				console.log("remove " + l);
				this.totalLength -= l
			}
			this.sent_count--;
		}			
	},
	receiveOk: function() {
		this.receive();
			
		if (this.preProcessQueue.command == "") 
			this.preProcessQueue = this.__preProcessWrite2Serial();
	},
	
	receiveError: function() {
		this.receive();
	},
	
	getCurrentSentCountCommand: function() {
		return this.sent_count;
	},
	
	update: function() {
		console.log("total length " + this.totalLength);
		if (this.totalLength <= this.options.bufferLength) {
			this.serial_free = true;
			this.__write2serial();
		}
	},
	
	isFree: function () {
		return this.sent_count == 0;
	},
	
	writeDirect: function(command) {
		this.sent_count_direct++;
		this.serialPort.write(command);
	},
	write: function(command, func) {
	
		if (this.lastCommand != command || phpjs.strlen(command) < 5) {
			//add command to serial queue		
			this.serial_queue.push({
				'command'	: command + "\n",
				'func'		: func
			});
			//console.log(command);
			if (this.serial_free)
				this.__write2serial();
		}
	},
	
	
	//public event:
	stop: function() {
		this.serial_queue = [];
		this.sent_count = 0;
		this.preProcessQueue.command = "";
		this.totalLength = 0;
		while (!this.lenInQueue.isEmpty())
			this.lenInQueue.shift();
		this.writeDirect("~\n");
		this.writeDirect("M5\n");
		this.writeDirect("g0x0y0\n");
	},
	//private
	__preProcessWrite2Serial: function() {
		var command = [];
		var func;
		var i = 0;
		var length = 0;
		
		do {
			//process check serial queue is empty
			if (this.serial_queue.length == 0)
				break;
			
			//check the length of command batch
			if (length + phpjs.strlen(this.serial_queue[0].command) > this.options.bufferLength - this.totalLength)
				break;
				
			//add command to batch
			var ele = this.serial_queue.shift();
			command.push(ele.command);
			var l = phpjs.strlen(ele.command);
			length += l
			this.totalLength += l
			console.log("current command " + l);
			this.lenInQueue.push(l)
			func	= ele.func;
			
			i++;
		} while (!func);
		
		command = command.join('');
		
		return {
			sent_count: i,
			command		: command,
			length		: length,
			func		: func
		};
	},
	
	__write2serial: function(free) {
		if ((!this.serial_free && free != true) || this.serial_queue.length == 0) return;
		this.serial_free = false;
		
		if (this.preProcessQueue.command == "") 
			this.preProcessQueue = this.__preProcessWrite2Serial();
			
		
		this.sent_count += this.preProcessQueue.sent_count;
		var length = this.preProcessQueue.length;
		var func = this.preProcessQueue.func;
		var command = this.preProcessQueue.command;
		
		//console.log("Send " + this.sent_count + " with length " + length + " ; con " + this.serial_queue.length );
		//console.log(command);
		this.preProcessQueue.command = "";
		console.log(command);
		
		
		this.serialPort.write(command, function (e, d) {
			this.serialPort.drain(function() {
				if (func)
					func(e, d);
			});
				
		}.bind(this));
	}
};

module.exports = Streamer;