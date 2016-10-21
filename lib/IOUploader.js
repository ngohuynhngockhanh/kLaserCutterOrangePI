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
	
	var maxCoorX = argv.maxCoorX;
	var maxCoorY = argv.maxCoorY 
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
		event.file.name = phpjs.str_replace("'", "", event.file.name);
		var file = event.file;
		var fileSize = file.size;
		if (fileSize > options.maxFileSize) {
			socket.emit("error", {id: 3, message: "MAX FILE FILE is " + (settings.maxFileSize / 1024 / 1024) + "MB"});
			return false;
		}
	});
	this.SVGcontent = ""
	this.on("processPicture", function(filename, filepath, opts) {
		var options = opts
		var imageSize = sizeOf(filepath);
		var width = imageSize.width / px2mm;
		var height = imageSize.height / px2mm;
		opts.width = imageSize.width
		opts.height = imageSize.height
		console.log(width);
		console.log(height);
		if (width > maxCoorX || height > maxCoorY|| width == 0 || height == 0) {
			console.log('size error');
			self.emit('error', {
				id: 4,
				message: phpjs.sprintf('Only accept size less than %d x %d (px x px)', maxCoorX * px2mm, maxCoorY* px2mm)
			});
		} else {
			
			var pic2gcode = new pic2gcode_lib();
			pic2gcode.convert(filepath, opts);
			pic2gcode.on('percent', function(percent) {
				self.socket.emit("percent", percent);
			})
			
			pic2gcode.on('complete', function(gcode) {
				upload_complete_func(self.socket, filename, gcode, filepath, true);
			})
		}
	})
    this.uploader.on("complete", function(event){
		console.log("upload complete");
        var file = event.file;
		sh("cd ./upload && find ! -name '" + phpjs.str_replace(['\\', "'", 'upload/'], '', file.pathName) + "' -a ! -name 'rememberDevice.json' -a ! -name 'feedRate'  -type f -exec rm -f {} +");		
		var filepath = './' + file.pathName;
		var re = /(?:\.([^.]+))?$/;
		var ext = re.exec(filepath)[1];
		if (ext)
			ext = phpjs.strtolower(ext);
		
		self.SVGcontent = "";
		var isGCODEfile = (ext == 'gcode' || ext == 'sd' || ext == 'txt');
		var isPICfile = (ext == 'jpg' || ext == 'jpeg' || ext == 'bmp' || ext == 'png');
		self.canSendImage = isPICfile;
		var opts = {
			feedRate: self.options.feedRate,
			resolution: self.options.resolution,
			maxCoorX: maxCoorX,
			maxCoorY: argv.maxCoorY,
			maxLaserPower: self.options.maxLaserPower
		};
		console.log(filepath);
		if (isPICfile) {
			self.emit('processPicture', file.name, filepath, opts);
		} else {
			var content = fs.readFileSync(filepath);
			self.socket.emit("percent");	
			if (!isGCODEfile) {
				self.SVGcontent = content.toString();
				content = svg2gcode.svg2gcode(self.SVGcontent, opts, function(percent) {
					self.socket.emit("percent", percent);
				});
			} else 
				content = content.toString();
			if (ext != 'svg')
				self.SVGcontent = "";
			
			return upload_complete_func(self.socket, file.name, content, filepath);
		}
		
    });
	// Error handler:
    this.uploader.on("error", function(event){
        console.log("Error from uploader", event);
		self.emit("error", JSON.stringify(event));
    });
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