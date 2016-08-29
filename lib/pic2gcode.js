const	px2mm	= 3.54328571429,
		eps		= 1e-3,
		defaultGCode = [
			'G90',	// Absolute coordinate mode. Oxyz
			'G21',	// Unit: mm
			'G17 G94 G54',
			'S0',	//set min power
		];
var Jimp = require("jimp"),
	phpjs= require('phpjs');

var pic2gcodeProcess;
module.exports = {
	clear		: function () {
		if (pic2gcodeProcess)
			clearTimeout(pic2gcodeProcess);
	},
	pic2gcode	: function(image, options, callback) {
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
		
		//scale
		var scale = options.resolution / px2mm;
		if (phpjs.abs(scale - 1) > eps)
			image = image.scale(scale);
		
		
		//get width, height
		var width	= image.bitmap.width,
			height	= image.bitmap.height
			t = _t	= 0;	//check how we cut
			
		//function check "for by width"
		var ok = function (j, t) {
			return (t == 0 && j < width) || (t == 1 && j >= 0);
		}
		var depth = function(color) {//1000/765/255/100 = 0.00005126233
			var dep = (765 - color.r - color.g - color.b) * color.a * options.maxLaserPower * 0.00005126233 ;
			return dep > 1000 ? 1000 : dep;
		}
		var getPixel = function(x, y) {
			var idx = (y * width + x) << 2;
			var color = {
				r: image.bitmap.data[idx],
				g: image.bitmap.data[idx + 1],
				b: image.bitmap.data[idx + 2],
				a: image.bitmap.data[idx + 3]
			};
			return color;
		}
			
		
		//default gcoe
		var gcode = defaultGCode.slice(0);
		gcode.push(phpjs.sprintf("G1 F%.1f", options.feedRate));
		var colorByCol = function(i) {
			var _ok = ok(j, _t),
				start	= (t == 0) ? 0 : width - 1,
				plus	= (t == 0) ? 1 : -1,
				y		= (height - i) / options.resolution, //real y
				wasPlus = false,
				_t		= t,
				cut 	= false,
				_S		= 0;
			if (callback.percent)
				callback.percent(i / height * 100);
			
			for (var j = start; ok(j, _t) ; j += plus) {
				var x = j / options.resolution, //real x
					dep	= depth(getPixel(j, i));
					
				if (dep > 50) {
					if (!cut) {
						cut = true;
						if (!wasPlus) { 
							t = (t + 1) % 2;
							wasPlus = true;
						}
						//start cutting
						gcode.push(phpjs.sprintf("G0 X%.3f Y%.3f", x, y));
						gcode.push("G1");
					}
					//change power
					var S = phpjs.round(dep);
					//if (dep != _S) {
						gcode.push("M03");
						gcode.push("S" + S);
						_S = dep;
						gcode.push("X" + phpjs.round(x, 3));
						gcode.push("M05");
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
				gcode.push("M05"); //make sure the laser is off
			i++;
			if (i == height) {
				gcode.push("G0 X0 Y0");
				console.log(";Time ext: " + (phpjs.microtime(true) - time));
				if (callback.complete)
					callback.complete(gcode);
				return;
			} else {			
				pic2gcodeProcess = setTimeout(function() {
					colorByCol(i);
				}, 0);
			}	
		}
		colorByCol(0);
	}
}