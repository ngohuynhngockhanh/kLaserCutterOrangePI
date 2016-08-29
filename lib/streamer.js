var 	phpjs		=		require('phpjs'),
		fs			=		require('fs'),
		sh 			= 		require('sync-exec');
		
		
function Streamer(device, options) {
	device = device || sh("ls /dev/video*").stdout;
	options = options || {};
	options.resolution	= options.resolution	|| 'auto';
	options.fps			= options.fps 			|| '10';
	options.quality		= options.quality		|| '50';
	options.port 		= options.port			|| '8080';
	options.format		= options.format		|| 'auto';
	this.options = options;
	this.device = (phpjs.is_numeric(device)) ? ('/dev/video' + phpjs.strval(device)) : phpjs.trim(device);
	this.formatName = 'auto';
	console.log("init webcam at device video0");
}

Streamer.prototype = {
    constructor: MJPG_Streamer,
	getOptions: function() {
		return this.options;
	}
};

module.exports = MJPG_Streamer;