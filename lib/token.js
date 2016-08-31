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
	fs.readFile(__dirname + '/../data/rememberDevice.json', { encoding: 'utf8' }, function (err, data) {
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
			"profile": "android",
			"notification":{
				"message": message 
			}
		};
		//curl -H "Content-Type: application/json" -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiI2MzExNmRlNS01Yzk4LTQ3OWEtYmQ2NC0zMzc1MzgzODMxODEifQ.dsId9F6Vedb6xGsDzgC8-53Uq1smCcgfTUUJMnyi32s" https://api.ionic.io/push/notifications -d '{"tokens":["e8kNdPhlxto:APA91bENpvCxJLNb9_MihSlXXLOIGTyVwiPWfge_7o0VKDKHCnwlOTtClSp0z8jn4sXWlkOXWFjEcdUM9k9PbMrmGKKIJ17OEVaF142QMdd0njZCLjGqvoSbNPrvbhc42EDHoBagxGst"],"profile":"android","notification":{"message":"I have just finished my job! ^-^"}}'

		var command = "curl -H \"Content-Type: application/json\" -H \"Authorization: Bearer " + this.options.AuthKey + "\" https://api.ionic.io/push/notifications -d '" + JSON.stringify(post_data) + "'";
		console.log(command);
		exec(command);
	},
	
	saveRememberDevice: function(list) {
		list = list || this.rememberTokenDevice;
		fs.writeFile(__dirname + '/../upload/rememberDevice.json', JSON.stringify(list));
	},
	add: function(token, remember) {
		console.log("try to add token");
		console.log(token);
		var tokenIndexOf = this.tokenDevice.indexOf(token);
		if (tokenIndexOf == -1) 
			this.tokenDevice.push(token);
		console.log(this.tokenDevice);
		console.log(remember);
		var rtdIndex = this.rememberTokenDevice.indexOf(token);
		if (rtdIndex == -1 && remember) {
			this.rememberTokenDevice.push(token);
			this.saveRememberDevice();
		} else if (!remember && rtdIndex > -1) {
			this.rememberTokenDevice.slice(rtdIndex, 1);
			this.saveRememberDevice();
		}
		this.render.sendLCDMessage((tokenIndexOf == -1 ? "New" : "Old") + " device (#" + this.tokenDevice.indexOf(token) + ")");
	}
};

module.exports = Token;