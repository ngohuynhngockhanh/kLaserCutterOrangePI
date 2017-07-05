var 	phpjs		=		require('phpjs'),
		sh 			= 		require('sync-exec'),
		Deque 		= 		require("double-ended-queue"),
		five		=		require("johnny-five"),
		sleep		=		require('sleep');
function Render(lcdOptions, board) {
	this.lcd = undefined;
	var self = this
	board.on('ready', function() {
		self.lcd = new five.LCD(lcdOptions);
		var constrastLCD = new five.Relay(lcdOptions.constrast);
		constrastLCD.on();
	});
	
	this._getIpAddress_idx = 0;
	this.lcdTimeout = undefined;
	this.lcdBusy = false;
}

Render.prototype = {
    constructor: Render,
	getOptions: function() {
		return this.options;
	},
	
	getIpAddress: function() {
		var ip = sh("ifconfig | grep -v 192.168.42.1 | grep -v 169.254.255.255 | grep -v 127.0.0.1 |  awk '/inet addr/{print substr($2,6)}'");	
		console.log(JSON.stringify(ip, null, 4));
		ip = ip.stdout;
		console.log(ip);
		ip = phpjs.explode("\n", ip);
		console.log(ip);
		var count = phpjs.count(ip) - 1;
		if (count <= 0)
			return "";
		this._getIpAddress_idx = (this._getIpAddress_idx + 1) % count;
		return ip[this._getIpAddress_idx];
	},
	sendLCDMessage: function(message, options) {
		var self = this
		if (!this.lcd)
			return;
		options = options || {};
		options.timeout = options.timeout || 20000;
		options.backlight = (options.backlight != undefined) ? options.backlight : true;
		var setLCDTimeout = function(func, timeout) {
			if (self.lcdTimeout)
				clearTimeout(self.lcdTimeout);
			self.lcdBusy = true;
			lcdTimeout = setTimeout(function() {
				func();
				self.lcdBusy = false;
			}, timeout);
		}
		console.log(message);
		var length = phpjs.strlen(message);
		var tryDraw = function(idx, length, options) {
			self.lcd.clear();
			if (options.backlight)
				self.lcd.backlight();
			for (var i = 0; i < 16 * 2; i++) {
				var x = phpjs.intval(i / 16);
				var y = i % 16;
				self.lcd.cursor(x, y).print(message[idx]);
				idx++;
				
				if (idx == length) {
					setLCDTimeout(function() {
						self.lcd.noBacklight();
					}, options.timeout);
					return;
				}
			}
			setLCDTimeout(function() {
				tryDraw(idx, length, options);
			}, 1000);
		}
		tryDraw(0, length, options);
	},
	
	isBusy: function() {
		return this.lcdBusy;
	},
	
	printIP: function() {
		this.sendLCDMessage("IP Address:     " + this.getIpAddress(), {timeout: 5000});	
	},
	
	waitIPScreen: function() {
		var self = this
		var ipAddress = this.getIpAddress();
		if (phpjs.strlen(ipAddress) > 7) {
			this.sendLCDMessage("IP Address:     " + ipAddress, {timeout: 30000});
		} else {
			this.lcd.clear();
			this.lcd.cursor(0, 0).print("Wait for IP");
			for (var i = 5 ; i >= 1; i--) {				
				this.lcd.cursor(1, 0).print(".............." + i + "s");
				sleep.sleep(1);
			}
			setTimeout(function() {
				self.waitIPScreen();
			}, 5000);
		}	
	},
	
	newConnection: function(count, ip) {
		this.sendLCDMessage(phpjs.sprintf("Connection(s):%02d%s", count, phpjs.trim(ip)));
	},
	
	lightOn: function() {
		if (this.lcd)
			this.lcd.backlight();
	},
	lightOff: function() {
		if (this.lcd)
			this.lcd.noBacklight();
	}
	
};

module.exports = Render;