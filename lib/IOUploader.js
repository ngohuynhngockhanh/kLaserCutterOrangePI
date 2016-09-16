const px2mm 	=	3.54328571429;

var 	sh 			= 		require('sync-exec'),
		phpjs		=		require('phpjs'),
		pic2gcode_lib=		require('./pic2gcode'),
		svg2gcode	=		require('./svg2gcode'),
		sleep		=		require('sleep'),
		argv		=		require('optimist').argv,
		exec 		=		require('child_process').exec,
		sizeOf 		= 		require('image-size'),
		events 		= 		require('events'),
		util 		= 		require('util');

function IOUploader(siofu, upload_complete_func, options) {
	this.pic2gcode = new pic2gcode_lib();
	options = options || {};
	options.maxFileSize = options.maxFileSize || 5 * 1024 * 1024;
	this.options = options;
	this.uploader = new siofu();
	this.uploader.dir = "./upload";
	this.socket;
	this.canSendImage = false;
	var self = this;
	this.uploader.on("start", function(event) {
		console.log("upload task starts");
		self.pic2gcode.clear();
		event.file.name = phpjs.str_replace("'", "", event.file.name);
		var file = event.file;
		var fileSize = file.size;
		if (fileSize > options.maxFileSize) {
			socket.emit("error", {id: 3, message: "MAX FILE FILE is " + (settings.maxFileSize / 1024 / 1024) + "MB"});
			return false;
		}
	});
	this.SVGcontent = ""
	var self = this
    this.uploader.on("complete", function(event){
		console.log("upload complete");
        var file = event.file;
		sh("cd ./upload && find ! -name '" + phpjs.str_replace(['\\', "'", 'upload/'], '', file.pathName) + "' -a ! -name 'rememberDevice.json' -a ! -name 'feedRate'  -type f -exec rm -f {} +");		
		var filepath = './' + file.pathName;
		var re = /(?:\.([^.]+))?$/;
		var ext = re.exec(filepath)[1];
		if (ext)
			ext = phpjs.strtolower(ext);
		
		setTimeout(function() {
			self.SVGcontent = "";
			var isGCODEfile = (ext == 'gcode' || ext == 'sd' || ext == 'txt');
			var isPICfile = (ext == 'jpg' || ext == 'jpeg' || ext == 'bmp' || ext == 'png');
			self.canSendImage = isPICfile;
			var opts = {
				feedRate: self.options.feedRate,
				resolution: self.options.resolution,
				maxCoorX: argv.maxCoorX,
				maxCoorY: argv.maxCoorY,
				maxLaserPower: self.options.maxLaserPower
			};
			console.log(filepath);
			if (isPICfile) {
				var imageSize = sizeOf(filepath);
				var width = imageSize.width / px2mm;
				var height = imageSize.height / px2mm;
				opts.width = imageSize.width
				opts.height = imageSize.height
				console.log(width);
				console.log(height);
				if (width > argv.maxCoorX || height > argv.maxCoorY || width == 0 || height == 0) {
					console.log('size error');
					self.emit('error', {
						id: 4,
						message: phpjs.sprintf('Only accept size less than %d x %d (px x px)', argv.maxCoorX * px2mm, argv.maxCoorY * px2mm)
					});
				} else {
					setTimeout(function() {
						self.pic2gcode.convert(filepath, opts, {
							percent:	function(percent) {
								return self.socket.emit("percent", percent);
							},
							complete: function(gcode) {
								return upload_complete_func(self.socket, file, gcode, filepath, true);
							}
						});
					}, 1000)
				}
			} else {
				var content = fs.readFileSync(filepath);
				self.socket.emit("percent");	
				if (!isGCODEfile) {
					self.SVGcontent = content.toString();
					content = svg2gcode.svg2gcode(self.SVGcontent, opts, function(percent) {
						
					});
				} else 
					content = content.toString();
				if (ext != 'svg')
					self.SVGcontent = "";
				
				return upload_complete_func(self.socket, file, content, filepath);
			}
		}, file.size / 1024 / 2);
		
    }.bind(this));
	// Error handler:
    this.uploader.on("error", function(event){
        console.log("Error from uploader", event);
		this.emit("error", JSON.stringify(event));
    }.bind(this));
}
module.exports = IOUploader;
util.inherits(module.exports, events.EventEmitter);
IOUploader.prototype.getOptions = function() {
	return this.options;
};
IOUploader.prototype.listen = function(socket) {
	this.socket = socket;
	console.log("uploader listening!");
	return this.uploader.listen(socket);
};
IOUploader.prototype.resolution = function(resolution) {
	this.options.resolution = resolution;
};
IOUploader.prototype.maxLaserPower = function(maxLaserPower) {
	this.options.maxLaserPower = maxLaserPower;
};
IOUploader.prototype.feedRate = function(feedRate) {
	this.options.feedRate = feedRate;
};
IOUploader.prototype.getFeedRate = function() {
	return this.options.feedRate
}

IOUploader.prototype.getSVGcontent = function() {
	return this.SVGcontent
}