const	px2mm	= 3.54328571429,
		eps		= 1e-3,
		defaultGCode = [
			'G90',	// Absolute coordinate mode. Oxyz
			'G21',	// Unit: mm
			'G17 G94 G54',
			'm8',
			'S0',	//set min power
		];
var sharp 		= 	require('sharp'),
	phpjs		= 	require('phpjs'),
	Deque 		= 	require("double-ended-queue"),
	events 		= 	require('events'),
	util 		= 	require('util');

function Pic() {
	this.gcode = new Deque(0)
	this.image = null
}

module.exports = Pic

util.inherits(module.exports, events.EventEmitter);

Pic.prototype.clear	= function () {
	if (this.pic2gcodeProcess)
		clearTimeout(this.pic2gcodeProcess);
}
Pic.prototype.convert = function(filepath, options) {
	//options
	options = options || {};
	options.feedRate	= options.feedRate 		|| 1000;
	options.resolution	= options.resolution	|| px2mm;
	options.maxCoorX	= options.maxCoorX		|| 320;
	options.maxCoorY	= options.maxCoorY		|| 315;
	options.maxLaserPower = options.maxLaserPower || 100;
	var time = phpjs.microtime(true);
	var width = options.width
	var height = options.height
	delete image
	this.image = sharp(filepath)
	
	//scale
	var scale = options.resolution / px2mm;
	
	if (phpjs.abs(scale - 1) > eps) {
		width *= scale
		height *= scale
		width = phpjs.intval(width)
		height = phpjs.intval(height)
		this.image = this.image.resize(width, height);
	}
	
	//default gcoe
	var gcode = new Deque(defaultGCode);
	//gcode.clear()
	for (var i = 0; i < defaultGCode.length; i++)
		gcode.push(defaultGCode[i])
	gcode.push(phpjs.sprintf("G1 F%.1f", options.feedRate));
		
	this.pic2gcodeProcess = null
	var self = this
	this.image.raw().toBuffer(function(err, outputBuffer, info) {
		if (err) {
		  throw err;
		}
		//console.log(info)
		
		var depth = function(color) {//1000/765/100 = 0.01307189542
			var dep = (756 - color.r - color.g - color.b) * options.maxLaserPower * 0.01307189542;
			return dep > 1000 ? 1000 : dep;
		}
		var getPixel = function(x, y) {
			var idx = (y * width + x) * 3;
			var color = {
				r: outputBuffer[idx],
				g: outputBuffer[idx + 1],
				b: outputBuffer[idx + 2]
			};
			return color;
		}
		
		//function check "for by width"
		var ok = function (j, t) {
			return (t == 0 && j < width) || (t == 1 && j >= 0);
		}
		
			
		
		var t = _t	= j = 0;	//check how we cut
		self.on('colorByCol', function(i) {
			var _ok = ok(j, _t),
				 //real y
				_t		= t,
				cut 	= false,
				_S		= 0
			
			self.emit("percent", (i / height * 100));
			var __i = 0;
			_y = -1;
			while (__i++ <= 5 && i < height) {
				var  start	= (t == 0) ? 0 : width - 1,
						plus	= (t == 0) ? 1 : -1,
						y		= (height - i) / options.resolution;
				for (j = start; ok(j, _t) ; j += plus) {
					var x = j / options.resolution, //real x
					dep = depth(getPixel(j, i));
						
					if (dep > 50) {
						if (!cut) {
							cut = true;
							if (_y != y) { 
								_t = t;
								t = (t + 1) % 2;
								_y = y;
							}
							//start cutting
							gcode.push("G0 X" + phpjs.round(x, 5) + " Y" + phpjs.round(y, 5));
							gcode.push("G1");
							gcode.push("M3");
						}
						//change power
						var S = phpjs.round(dep);
						gcode.push("S" + S + " X" + phpjs.round(x, 5));
					} else {
						if (cut) {
							//stop cutting
							gcode.push("M5");
							cut = false;
						}
					}	
				}
				if (cut) {
					gcode.push("M05"); //make sure the laser is off
					cut = false;
				}
				i++;
			}
			if (i == height) {
				gcode.push("G0 X0 Y0");
				console.log(";Time ext: " + (phpjs.microtime(true) - time));		
				outputBuffer = null
				delete self.image
				imageSource = null
				setTimeout(function() {
					var array = gcode.toArray()
					gcode.clear()
					self.emit("complete", array);
				}, 1000);
				
				return;
			} else {		
				setTimeout(function() {
					self.emit('colorByCol', i)
				}, 5)
			}	
		})
		self.emit('colorByCol', 0)
		// outputBuffer contains 200px high progressive JPEG image data,
		// auto-rotated using EXIF Orientation tag
		// info.width and info.height contain the dimensions of the resized image
	});
	return;
	/*	
	
	return;*/
}

