const px2mm 	=	3.54328571429;

var 	sh 			= 		require('sync-exec'),
		phpjs		=		require('phpjs'),
		pic2gcode	=		require('./pic2gcode'),
		svg2gcode	=		require('./svg2gcode'),
		sleep		=		require('sleep'),
		argv		=		require('optimist').argv,
		exec 		=		require('child_process').exec,
		sizeOf 		= 		require('image-size'),
		events 		= 		require('events'),
		util 		= 		require('util'),
		Jimp		=		require('jimp');
function IOUploader(siofu, upload_complete_func, options) {
	options = options || {};
	options.maxFileSize = options.maxFileSize || 5 * 1024 * 1024;
	this.options = options;
	this.uploader = new siofu();
	this.uploader.dir = "./upload";
	this.socket;
	this.canSendImage = false;
	this.uploader.on("start", function(event) {
		console.log("upload task starts");
		pic2gcode.clear();
		event.file.name = phpjs.str_replace("'", "", event.file.name);
		var file = event.file;
		var fileSize = file.size;
		if (fileSize > options.maxFileSize) {
			socket.emit("error", {id: 3, message: "MAX FILE FILE is " + (settings.maxFileSize / 1024 / 1024) + "MB"});
			return false;
		}
	});
	
	
    this.uploader.on("complete", function(event){
		console.log("upload complete");
        var file = event.file;
		sh("cd ./upload && find ! -name '" + phpjs.str_replace(['\\', "'", 'upload/'], '', file.pathName) + "' -type f -exec rm -f {} +");		
		var filepath = './' + file.pathName;
		var re = /(?:\.([^.]+))?$/;
		var ext = re.exec(filepath)[1];
		if (ext)
			ext = phpjs.strtolower(ext);
		
		setTimeout(function() {
			SVGcontent = "";
			var isGCODEfile = (ext == 'gcode' || ext == 'sd' || ext == 'txt');
			var isPICfile = (ext == 'jpg' || ext == 'jpeg' || ext == 'bmp' || ext == 'png');
			this.canSendImage = isPICfile;
			var opts = {
				feedRate: this.options.feedRate,
				resolution: this.options.resolution,
				maxCoorX: argv.maxCoorX,
				maxCoorY: argv.maxCoorY,
				maxLaserPower: this.options.maxLaserPower
			};
			console.log(filepath);
			if (isPICfile) {
				var imageSize = sizeOf(filepath);
				var width = imageSize.width / px2mm;
				var height = imageSize.height / px2mm;
				console.log(width);
				console.log(height);
				if (width > argv.maxCoorX || height > argv.maxCoorY || width == 0 || height == 0) {
					console.log('size error');
					this.emit('error', {
						id: 4,
						message: phpjs.sprintf('Only accept size less than %d x %d (px x px)', argv.maxCoorX * px2mm, argv.maxCoorY * px2mm)
					});
				} else {
					var image = new Jimp(filepath, function(e, image) {
						if (e) {
							return false;
							fs.unlink(filepath);
						}
						var check = pic2gcode.pic2gcode(image, opts, {
							percent:	function(percent) {
								this.socket.emit("percent", percent);
							}.bind(this),
							complete: function(gcode) {
								upload_complete_func(this.socket, file, gcode, filepath, true);
							}.bind(this)
						});
					}.bind(this));
				}
			} else {
				var content = fs.readFileSync(filepath);
				this.socket.emit("percent");	
				if (!isGCODEfile) {
					SVGcontent = content.toString();
					content = svg2gcode.svg2gcode(SVGcontent, opts, function(percent) {
						
					});
				} else 
					content = content.toString();
				if (ext != 'svg')
					SVGcontent = "";
				
				upload_complete_func(this.socket, file, content, filepath);
			}
		}.bind(this), file.size / 1024 / 2);
		
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