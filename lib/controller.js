var 	phpjs		=		require('phpjs'),
		sh 			= 		require('sync-exec'),
		Deque 		= 		require("double-ended-queue");		

function Controller(options) {
	options = options || {};
}

Controller.prototype = {
    constructor: Controller,
	getOptions: function() {
		return this.options;
	},
};

module.exports = Controller;