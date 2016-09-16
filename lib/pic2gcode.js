const	px2mm	= 3.54328571429,
		eps		= 1e-3,
		defaultGCode = [
			'G90',	// Absolute coordinate mode. Oxyz
			'G21',	// Unit: mm
			'G17 G94 G54',
			'S0',	//set min power
		];
var sharp 		= 	require('sharp'),
	phpjs		= 	require('phpjs'),
	Deque 		= 	require("double-ended-queue");


function Pic() {
	this.gcode = new Deque(0)
	this.image = null
}
Pic.prototype = {
	constructor: Pic,
	clear		: function () {
		if (this.pic2gcodeProcess)
			clearTimeout(this.pic2gcodeProcess);
	},
	convert: function(filepath, options, callback) {
		//options
		options = options || {};
		options.feedRate	= options.feedRate 		|| 1000;
		options.resolution	= options.resolution	|| px2mm;
		options.maxCoorX	= options.maxCoorX		|| 320;
		options.maxCoorY	= options.maxCoorY		|| 315;
		options.maxLaserPower = options.maxLaserPower || 100;
		callback			= callback || {};
		callback.percent	= callback.percent		|| null;
		callback.complete	= callback.complete		|| function () {
			console.log("'pic to gcode' was complete");
		};
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
		//var gcode = new Deque(defaultGCode);
		this.gcode.clear()
		for (var i = 0; i < defaultGCode.length; i++)
			this.gcode.push(defaultGCode[i])
		this.gcode.push(phpjs.sprintf("G1 F%.1f", options.feedRate));
			
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
			
				
			
			
			self.pic2gcodeProcess = null;
			
			var t = _t	= j = 0;	//check how we cut
			var colorByCol = function(i) {
				var _ok = ok(j, _t),
					start	= (t == 0) ? 0 : width - 1,
					plus	= (t == 0) ? 1 : -1,
					y		= (height - i) / options.resolution, //real y
					wasPlus = false,
					_t		= t,
					cut 	= false,
					_S		= 0
				if (callback.percent)
					callback.percent(i / height * 100);
				for (j = start; ok(j, _t) ; j += plus) {
					var x = j / options.resolution, //real x
					dep = depth(getPixel(j, i));
						
					if (dep > 50) {
						if (!cut) {
							cut = true;
							if (!wasPlus) { 
								t = (t + 1) % 2;
								wasPlus = true;
							}
							//start cutting
							self.gcode.push(phpjs.sprintf("G0 X%.3f Y%.3f", x, y));
							self.gcode.push("G1");
						}
						//change power
						var S = phpjs.round(dep);
						//if (dep != _S) {
							self.gcode.push("M03");
							self.gcode.push("S" + S);
							_S = dep;
							self.gcode.push("X" + phpjs.round(x, 3));
							self.gcode.push("M05");
						//}
					} else {
						if (cut) {
							//stop cutting
							_S = 0;
							cut = false;
						}
					}	
				}
				if (cut)
					self.gcode.push("M05"); //make sure the laser is off
				i++;
				if (i == height) {
					self.gcode.push("G0 X0 Y0");
					console.log(";Time ext: " + (phpjs.microtime(true) - time));		
					outputBuffer = null
					clearTimeout(self.pic2gcodeProcess)
					self.pic2gcodeProcess = null;
					delete self.image
					imageSource = null
					if (callback.complete)
						setTimeout(function() {
							var array = self.gcode.toArray()
							self.gcode.clear()
							callback.complete(array);
						}, 1000);
					
					return;
				} else {		
					clearTimeout(self.pic2gcodeProcess)
					self.pic2gcodeProcess = null
					self.pic2gcodeProcess = setTimeout(function() {
						colorByCol(i);
					}, 1);
				}	
			}
			colorByCol(0);
			return;
			// outputBuffer contains 200px high progressive JPEG image data,
			// auto-rotated using EXIF Orientation tag
			// info.width and info.height contain the dimensions of the resized image
		});
		return;
		/*	
		
		return;*/
	}
}

module.exports = Pic