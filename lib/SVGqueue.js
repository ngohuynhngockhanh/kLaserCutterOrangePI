var 	phpjs		=		require('phpjs'),
		Deque 		= 		require("double-ended-queue");		

function SVGqueue(streamer, options) {
	options = options || {};
	this.streamer = streamer;
	this.gcodeQueue		= 	new Deque(0);
	this.gcodeDataQueue	= 	new Deque(0);
}

SVGqueue.prototype = {
    constructor: SVGqueue,
	getOptions: function() {
		return this.options;
	},
	set: function(list) {
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
		this.gcodeQueue.clear()
		this.gcodeDataQueue.clear()
		for (var i = 0; i < list.length; i++) {
			var cmd = list[i]
			this.gcodeQueue.push(cmd);
			this.gcodeDataQueue.push(cmd)
		}
	},
	
	isEmpty: function() {
		return this.gcodeQueue.isEmpty()
	},
	
	revert: function() {
		this.gcodeQueue = null
		this.gcodeQueue = new Deque(this.gcodeDataQueue.toArray());
	},
	
	checkBeforeStart: function() {
		if (this.gcodeQueue.isEmpty() && this.gcodeDataQueue.length > 0) {
			this.gcodeQueue = null
			this.gcodeQueue = new Deque(this.gcodeDataQueue.toArray());
		}
	},
	
	shift: function() {
		return this.gcodeQueue.shift();
	},
	
	length: function() {
		return this.gcodeQueue.length;
	},
	
	getAllGCode: function() {
		return this.gcodeDataQueue;
	},
	
	getAllGCodeLength: function() {
		return this.gcodeDataQueue.length;
	},
	
	fixFeedRate: function(oldFeedrate, feedRate) {
		for (var i = 0; i < phpjs.min(20, this.length()); i++) {
			this.gcodeQueue[i] = phpjs.str_replace("F" + oldFeedrate, "F" + feedRate, this.gcodeQueue[i])
		}
		
		for (var i = 0; i < phpjs.min(20, this.getAllGCodeLength()); i++) {
			this.gcodeDataQueue[i] = phpjs.str_replace("F" + oldFeedrate, "F" + feedRate, this.gcodeDataQueue[i])
		}
	}
};

module.exports = SVGqueue;