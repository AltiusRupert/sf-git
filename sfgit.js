'use strict';
var git     = require('gift');
var fs      = require('fs');
var fstream = require('fstream');
var jsforce = require('jsforce');
var async   = require('async');
var AdmZip  = require('adm-zip');
var pg      = require('pg');

//mutes all logs
var MUTE = false;

/*
 * Creates the return object for the mainCallback
 */
function createReturnObject(err, msg){
    return {
        error: err,
        details: msg
    };
}

/*
 * Sync Deletes a folder recursively
 * @path: folder path
 * @exclude: exclude a certain folder's name
 * @doNotDeleteRoot: do not delete root folder
 */
var deleteFolderRecursive = function(path, exclude, doNotDeleteRoot) {
  if( fs.existsSync(path) ) {
    fs.readdirSync(path).forEach(function(file,index){
      var curPath = path + "/" + file;
      if(fs.lstatSync(curPath).isDirectory()) { // recurse
        if(!exclude || file != exclude){
            deleteFolderRecursive(curPath, exclude);
        }
      } else { // delete file
        fs.unlinkSync(curPath);
      }
    });
    if(!doNotDeleteRoot) fs.rmdirSync(path);
  }
};


module.exports = {
    doAll : function(mainCallback){
        var username = process.argv[2];
        if(!MUTE) console.log('### username = ', username);
        
        // Environment information
        var myenv = {
            SF_METADATA_POLL_TIMEOUT    : process.env.SF_METADATA_POLL_TIMEOUT,
            SF_USERNAME                 : process.env.SF_USERNAME,
            SF_PASSWORD                 : process.env.SF_PASSWORD,
            SF_API_VERSION              : process.env.SF_API_VERSION,
            EXCLUDE_METADATA            : process.env.EXCLUDE_METADATA,
            GIT_IGNORE                  : process.env.GIT_IGNORE,
            REPO_URL                    : process.env.REPO_URL,
            REPO_USER_NAME              : process.env.REPO_USER_NAME,
            REPO_USER_EMAIL             : process.env.REPO_USER_EMAIL,
            REPO_COMMIT_MESSAGE         : process.env.REPO_COMMIT_MESSAGE,
            REPO_README                 : process.env.REPO_README
        };
        if(!MUTE) console.log('### myenv = ', myenv);
        
        // Database OrgInfo
        if(!MUTE) console.log('### DATABASE_URL = ', process.env.DATABASE_URL);
        var pool = new pg.Pool();
        pool.connect(process.env.DATABASE_URL, function(err, client, done) {
            if (err) {
                console.log('### cannot connect to the DB : ' + err);
            } else  {
                client.query('SELECT * FROM SFOrgInfo__c', function(err, result) {
                    done();
                    if(err) {
                        console.error('### database error : ', err);
                    } else {
                        console.log('### database rows : ', result.rows);
                    }
                });
            }
        });
        pool.end();
        
        return;
        
        //status object
        var status = {
            tempPath        : '/tmp/',
            zipPath         : "zips/",
            repoPath        : "repos/",
            zipFile         : "_MyPackage"+Math.random()+".zip",
            sfConnection    : (new jsforce.Connection()),
            sfLoginResult   : null,
            types           : {},
        };
        //polling timeout of the SF connection
        //status.sfConnection.metadata.pollTimeout = process.env.SF_METADATA_POLL_TIMEOUT || 120000;
        status.sfConnection.metadata.pollTimeout = myenv.SF_METADATA_POLL_TIMEOUT || 120000;

        //creates all the main folders (temp folder, zip folder and git clone folder)
        try{
            if(!fs.existsSync(status.tempPath)){
                fs.mkdirSync(status.tempPath);
            }
            if (!fs.existsSync(status.tempPath+status.zipPath)){
                fs.mkdirSync(status.tempPath+status.zipPath);
            }
            if (!fs.existsSync(status.tempPath+status.repoPath)){
                fs.mkdirSync(status.tempPath+status.repoPath);
            }
        }catch(ex){
            return mainCallback && mainCallback(ex);
        }

        //asyncs jobs called sequentially (all the tasks to be done)
        async.series({
            //login to SF
            sfLogin : function(callback){
                if(!MUTE) console.log('SF LOGIN');
//                status.sfConnection.login(process.env.SF_USERNAME, process.env.SF_PASSWORD, function(err, lgnResult) {
                status.sfConnection.login(myenv.SF_USERNAME, myenv.SF_PASSWORD, function(err, lgnResult) {
                    status.sfLoginResult = lgnResult;
                    return callback((err)?createReturnObject(err, 'SF Login failed'):null);
                });
            },
            //Describes metadata items
            sfDescribeMetadata : function(callback){
                if(!MUTE) console.log('SF DESCRIBE METADATA');
//                status.sfConnection.metadata.describe(process.env.SF_API_VERSION+'.0', function(err, describe){
                status.sfConnection.metadata.describe(myenv.SF_API_VERSION+'.0', function(err, describe){
                    status.sfDescribe = describe;
                    return callback((err)?createReturnObject(err, 'SF Describe failed'):null);
                });
            },
            //Lists of all metadata details
            sfListMetadata : function(callback){
                if(!MUTE) console.log('SF LIST DESCRIBE METADATA ALL');
                var iterations =  parseInt(Math.ceil(status.sfDescribe.metadataObjects.length/3.0));
//                var excludeMetadata = process.env.EXCLUDE_METADATA || '';
                var excludeMetadata = myenv.EXCLUDE_METADATA || '';
                var excludeMetadataList = excludeMetadata.toLowerCase().split(',');

                var asyncObj = {};

                function listMetadataBatch(qr){
                    return function(cback){
                        if(!MUTE) console.log('SF LIST DESCRIBE METADATA: '+JSON.stringify(qr));
//                        status.sfConnection.metadata.list(qr,process.env.SF_API_VERSION+'.0', function(err, fileProperties){
                        status.sfConnection.metadata.list(qr,myenv.SF_API_VERSION+'.0', function(err, fileProperties){
                            if(!err && fileProperties){
                                for(var ft = 0; ft < fileProperties.length; ft++){
                                    if(!status.types[fileProperties[ft].type]){
                                        status.types[fileProperties[ft].type] = [];
                                    }
                                    status.types[fileProperties[ft].type].push(fileProperties[ft].fullName);
                                }
                            }
                            return cback(err);
                        });
                    }
                }

                for(var it = 0; it < iterations; it++){
                    var query = [];
                    for(var i = 0; i < 3; i++){
                        var index = it*3+i;
                        
                        if(status.sfDescribe.metadataObjects.length > index){
                            var metadata = status.sfDescribe.metadataObjects[index];
                            if(excludeMetadataList.indexOf((metadata.xmlName||'').toLowerCase()) <0){
                                query.push({type: metadata.xmlName, folder: metadata.folderName});
                            }
                        }
                    }
                    if(query.length>0){
                        asyncObj['fn'+it] = listMetadataBatch(query);
                    }
                }
                async.series(asyncObj, function(err, results){
                    return callback((err)?createReturnObject(err, 'SF Describe list metadata failed'):null);
                });
                
                
            },
            //Retrieving ZIP file of metadata
            sfRetrieveZip : function(callback){
                //should use describe
                //retrieve xml
                if(!MUTE) console.log('SF RETRIEVE ZIP');
                
                var _types = [];
                for(var t in status.types){
                    _types.push({
                        members: status.types[t],
                        name: t,
                    });
                }
                var stream = status.sfConnection.metadata.retrieve({ 
                unpackaged: {
                  types: _types,
//                  version: process.env.SF_API_VERSION,
                  version: myenv.SF_API_VERSION,
                }
                }).stream();
                stream.on('end', function() {
                    if(!MUTE) console.log('SF RETRIEVE ZIP - end');
                    return callback(null);
                });
                stream.on('error', function(err){
                    if(!MUTE) console.log('SF RETRIEVE ZIP - error');
                    return callback((err)?createReturnObject(err, 'SF Retrieving metadata ZIP file failed'):null);
                });
                if(!MUTE) console.log('SF RETRIEVE ZIP - next is pipe');
                stream.pipe(fs.createWriteStream(status.tempPath+status.zipPath+status.zipFile));
            },
            //Clones original repo
            gitClone : function(callback){
                if(!MUTE) console.log('GIT CLONE');
                var folderPath = status.tempPath+status.repoPath+status.zipFile;
                
//                git.clone(process.env.REPO_URL, folderPath, 
                git.clone(myenv.REPO_URL, folderPath, 
                function(err, _repo){
                    status.gitRepo = _repo;
                    //deletes all cloned files except the .git folder (the ZIP file will be the master)
                    deleteFolderRecursive(folderPath, '.git', true);
                    return callback((err)?createReturnObject(err, 'Git clone failed'):null);
                });
            },
            //Unzip metadata zip file
            unzipFile : function(callback){

                if(!MUTE) console.log('UNZIP FILE');
                
                //create .gitignore
                var fs = require('fs');

                var gitIgnoreBody = '#ignore files';
//                if(process.env.GIT_IGNORE){
//                    var spl = process.env.GIT_IGNORE.split(',');
                if(myenv.GIT_IGNORE){
                    var spl = myenv.GIT_IGNORE.split(',');
                    for(var i in spl){
                        if(spl[i]){
                            gitIgnoreBody+='\n'+spl[i];
                        }
                    }
                }

//                var readmeBody = process.env.REPO_README || "";
                var readmeBody = myenv.REPO_README || "";
                fs.writeFile(status.tempPath+status.repoPath+status.zipFile+'/README.md', readmeBody, function(err) {
                    if(err){
                        return callback(createReturnObject(err, 'README.md file creation failed'));
                    }
                    fs.writeFile(status.tempPath+status.repoPath+status.zipFile+'/.gitignore', gitIgnoreBody, function(err) {
                        if(err){
                            return callback(createReturnObject(err, '.gitignore file creation failed'));
                        }
                        try{
                            var zip = new AdmZip(status.tempPath+status.zipPath+status.zipFile);
                            zip.extractAllTo(status.tempPath+status.repoPath+status.zipFile+'/', true);
                            return callback(null);
                        }catch(ex){
                            return callback(createReturnObject(ex, 'Unzip failed'));
                        }
                    }); 
                });
                
                
            },
            //Git add new resources
            gitAdd : function(callback){
                if(!MUTE) console.log('GIT ADD');
                
                status.gitRepo.add("-A",function(err){
                    return callback((err)?createReturnObject(err, 'git add failed'):null);
                });
            },
            //Git commit
            gitCommit : function(callback){
                if(!MUTE) console.log('GIT COMMIT');
//                var userName = process.env.REPO_USER_NAME || "Heroku SFGit";
//                var userEmail = process.env.REPO_USER_EMAIL || "sfgit@heroku.com";
                var userName = myenv.REPO_USER_NAME || "Heroku SFGit";
                var userEmail = myenv.REPO_USER_EMAIL || "sfgit@heroku.com";
                status.gitRepo.identify({"name":userName, "email":userEmail}, function(err, oth){
//                    var commitMessage = process.env.REPO_COMMIT_MESSAGE || 'Automatic commit (sfgit)';
                    var commitMessage = myenv.REPO_COMMIT_MESSAGE || 'Automatic commit (sfgit)';
                    status.gitRepo.commit(commitMessage, function(err, oth){
                        if(err){
                            err.details = oth;
                        }
                        return callback((err)?createReturnObject(err, 'git commit failed'):null);
                    });
                });
            },
            //Git push
            gitPush : function(callback){
                if(!MUTE) console.log('GIT PUSH');
                
                status.gitRepo.remote_push("origin", "master", function(err, oth){
                    if(err){
                        err.details = oth;
                    }
                    return callback((err)?createReturnObject(err, 'git push failed'):null);
                });
            },
        },
        function(err, results){
            //deletes all temp files
            deleteFolderRecursive(status.tempPath+status.zipPath+'/');
            deleteFolderRecursive(status.tempPath+status.repoPath+'/');

            if(err 
                && err.error.details
                && (err.error.details.indexOf("up-to-date")>=0 || err.error.details.indexOf("nothing to commit") >=0)){
                console.log('Success', err.error.details);
                return mainCallback && mainCallback(null, err.error.details);
            }

            var details = (err && err.error && err.details) || null;
            if(err){
                console.log("Error occurred",err);
            }else{
                console.log('Success');
                details = 'Success';
            }
            return mainCallback && mainCallback(err, details);
        })
    },
}
