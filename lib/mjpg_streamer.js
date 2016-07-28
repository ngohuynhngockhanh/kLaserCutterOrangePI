var 	phpjs		=		require('phpjs'),
		fs			=		require('fs'),
		sh 			= 		require('sync-exec');
		
		
function MJPG_Streamer(device, options) {
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

MJPG_Streamer.prototype = {
    constructor: MJPG_Streamer,
	getOptions: function() {
		return this.options;
	},
	setOption: function(key, value) {
		this.options[key] = value;
	},
	setOptions: function(options) {
		for (var key in options)
			this.setOption(key, options[key]);
	},
	getSizeList: function() {
		console.log(this.device);
		var sizeList = phpjs.explode("\n", sh('v4l2-ctl --list-formats-ext --device ' + this.device + ' | grep Size | awk {\'print $3\'}').stdout);
		var res = [];
		for (var i = 0; i < sizeList.length - 1; i++)
			if (res.indexOf(sizeList[i]) == -1)
				res.push(sizeList[i]).stdout;
		return res;
	},
	setResolution: function(resolution) {
		this.options.resolution = resolution;
	},
	isAvailable: function() {
		var bool = fs.existsSync(this.device);	
		if (bool)
			return true;
		this.device = phpjs.trim(sh("ls /dev/video*").stdout);
		if (phpjs.strstr(this.device, "No such file or directory"))
			this.device = "/dev/video0";
		return fs.existsSync(this.device);	
	},
	isMjpgRunning: function() {
		command = "ps | grep mjpg_streame";
		var result = sh(command).stdout;
		return phpjs.strpos(result, 'mjpg_streamer') !== false;
	},
	shutdown: function() {
		sh('kill $(ps | grep -v grep |grep mjpg | grep -v sh | awk \'{print $1}\')');
	},
	tryRun: function(resetCamera) {
		resetCamera = resetCamera || false;
		if (resetCamera)
			this.shutdown();
		if (this.isAvailable()) {
			if (!this.isMjpgRunning() || resetCamera) {
				var format = '', command, result, quality = '',
					tmpfile = __dirname + '/../upload/mjpg_streamer.tmp';
				sh('echo "123" > ' + tmpfile);
				if (this.options.format == 'auto') {
					command = 'v4l2-ctl --list-formats --device ' + this.device;
					result = sh(command).stdout;
					if (result.indexOf('MJPEG') == -1)
						format = '-y';
				} else
					format = (this.options.format == 'yuyv') ? '-y' : '';
				if (format == '-y')
					quality = ' -quality ' + this.options.quality;
				
				this.formatName = (format == '-y') ? "YUVU" : "MJPEG";
				
				if (this.formatName == 'YUVU' && this.options.resolution == 'auto')
					this.options.resolution = '240x120';
				else if (this.formatName == 'MJPEG' && this.options.resolution == 'auto')
					this.options.resolution = '640x480';
				
				command = 'mjpg_streamer -i "/usr/local/lib/input_uvc.so ' + format + ' -d ' + this.device + ' ' + quality + ' -f ' + this.options.fps + ' -r ' + this.options.resolution + '" -o "/usr/local/lib/output_http.so -w /usr/local/www -p ' + this.options.port + '" > ' + tmpfile + ' 2>&1 &';
				result = sh(command).stdout;
				sh("sleep 0.05"); //wait 50ms to get tmpfile content
				result = fs.readFileSync(tmpfile).toString();
				
				if (phpjs.strpos(result, 'Unable to start capture: Input/output error') !== false) {
					return {
						ok: false,
						message: 'CHECK YOUR CAMERA CONNECTED. Error #1',
					}
				} 
				
				return {
					ok: true,
					message: 'MJPG STREAMER HAS JUST STARTED',
					port:	this.options.port,
					type: this.formatName,
					startAgain: true,
					resolution: this.options.resolution,
				}
			} else 
				return {
					ok: true,
					message: 'MJPG STREAMER IS RUNNING',
					port:	this.options.port,
					type: this.formatName,
					resolution: this.options.resolution,
				}
		} else {
			return {
				ok: false,
				message: 'NO USB DECTECTED'
			};
		}
	}
};

module.exports = MJPG_Streamer;