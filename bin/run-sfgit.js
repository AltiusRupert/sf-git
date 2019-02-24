'use strict';
/*
 * Use this script with:
 * $ heroku run node bin/run-sfgit.js
 * Or add the "Heroku Scheduler" add-on and schedule the "node bin/run-sfgit.js" 
 * command
 */

/*
 var sfgit = require('../sfgit');
sfgit.doAll(function(err, details){
	// Already traced in sfgit
	//console.log(err, details);
	
        //console.log("END : ", err ? err.error.message : '', details);
});
*/


var exec = require('flex-exec');

exec(['sfdx-project.sh'], function(err, out, code) {
	if (err instanceof Error)
	  throw err;
	process.stderr.write(err);
	process.stdout.write(out);
	process.exit(code);
      });
