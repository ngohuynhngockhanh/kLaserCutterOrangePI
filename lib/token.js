var 	phpjs		=		require('phpjs'),
		exec 		=		require('child_process').exec,
		fs         	= 		require('fs');
function Token(render, options) {
	this.render = render;
	options = options || {};
	this.options = options;
	this.tokenDevice = [];
	this.rememberTokenDevice = [];
	
	
	
	//set token from sdcard
	fs.readFile('./data/rememberDevice.json', { encoding: 'utf8' }, function (err, data) {
		if (err)
			this.saveRememberDevice();
		else {
			this.rememberTokenDevice = JSON.parse(data);
			this.tokenDevice = this.rememberTokenDevice.slice(0);
		}
	}.bind(this));
}

Token.prototype = {
    constructor: Token,
	getOptions: function() {
		return this.options;
	},
	
	sendPushNotification: function(message) {
	
		var post_data = {
			"tokens": this.tokenDevice,
			"notification":{
				"alert": message 
			}
		};
		var command = "curl -u " + this.options.privateApiKey + ": -H \"Content-Type: application/json\" -H \"X-Ionic-Application-Id: " + this.options.ionicAppId + "\" https://push.ionic.io/api/v1/push -d '" + JSON.stringify(post_data) + "'";
		exec(command);
	},
	
	saveRememberDevice: function(list) {
		list = list || this.rememberTokenDevice;
		fs.writeFile('./upload/rememberDevice.json', JSON.stringify(list));
	},
	add: function(token, remember) {
		console.log("try to add token");
		console.log(token);
		var tokenIndexOf = tokenDevice.indexOf(token);
		if (tokenIndexOf == -1) 
			this.tokenDevice.push(token);
		console.log(tokenDevice);
		console.log(remember);
		var rtdIndex = this.rememberTokenDevice.indexOf(token);
		if (rtdIndex == -1 && remember) {
			this.rememberTokenDevice.push(token);
			this.saveRememberDevice();
		} else if (!remember && rtdIndex > -1) {
			this.rememberTokenDevice.slice(rtdIndex, 1);
			this.saveRememberDevice();
		}
		this.render.sendLCDMessage((tokenIndexOf == -1 ? "New" : "Old") + " device (#" + tokenDevice.indexOf(token) + ")");
	}
};

module.exports = Token;