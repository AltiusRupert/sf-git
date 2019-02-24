'use strict';
/*
 * Use this script with:
 * $ heroku run node bin/run-sfgit.js
 * Or add the "Heroku Scheduler" add-on and schedule the "node bin/run-sfgit.js" 
 * command
 */

var sfgit = require('../sfgit');
sfgit.doAll2(function(err, details){
	// Already traced in sfgit
	//console.log(err, details);
	
        console.log("END : ", err, details);
});
