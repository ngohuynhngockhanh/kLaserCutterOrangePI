var 	phpjs		=		require('phpjs'),
		sh 			= 		require('sync-exec'),
		Deque 		= 		require("double-ended-queue");		
function receiveFuncExample(data) {
	this.log(data)
}
function SVGqueue(streamer, options) {
	options = options || {};
	this.streamer = streamer;
	this.gcodeQueue		= 	new Deque([]);
	this.gcodeDataQueue	= 	new Deque([]);
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
		this.gcodeQueue = new Deque(list);
		this.gcodeDataQueue = new Deque(list);
	},
	
	isEmpty: function() {
		return this.gcodeQueue.isEmpty()
	},
	
	revert: function() {
		this.gcodeQueue = new Deque(this.gcodeDataQueue.toArray());
	},
	
	checkBeforeStart: function() {
		if (this.gcodeQueue.isEmpty() && this.gcodeDataQueue.length > 0)
			this.gcodeQueue = new Deque(this.gcodeDataQueue.toArray());
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
	
	fixFeedRate: function(feedRate) {
		this.streamer.write(phpjs.sprintf("G01 F%.1f", phpjs.floatval(feedRate)));
	}
};

module.exports = SVGqueue;