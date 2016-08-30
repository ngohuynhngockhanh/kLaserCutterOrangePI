var 	phpjs		=		require('phpjs'),
		sh 			= 		require('sync-exec'),
		Deque 		= 		require("double-ended-queue");		
function receiveFuncExample(data) {
	this.log(data)
}
function SVGqueue(options) {
	options = options || {};
}

SVGqueue.prototype = {
    constructor: SVGqueue,
	getOptions: function() {
		return this.options;
	},
};

module.exports = SVGqueue;