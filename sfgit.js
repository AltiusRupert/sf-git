'use strict';

var git     = require('gift');
var fs      = require('fs');
var fstream = require('fstream');
var jsforce = require('jsforce');
var async   = require('async');
var AdmZip  = require('adm-zip');

var exec    = require('flex-exec');
var pg      = require('pg');

var username = process.argv[2];     // Which SF org username do we want to work with ?
var status = {}

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
 * Update Heroku Connect database : work status, message, last commit date
 */
function updateWorkInfo(pool, status, message){
    var query = ['UPDATE salesforce.sforginfo__c'];    
    
    query.push('SET');
    query.push(" Work_LastCommitDate__c     = '" +now()                          + "'");
    query.push(",Work_LastCommitMessage__c  = '" +(message+'').replace(/\'/g, '')+ "'");
    query.push(",Work_LastCommitStatus__c   = '" + (status+'').replace(/\'/g, '')+ "'");

    query.push("WHERE sf_username__c = '" +username+ "'");
    
    var q = query.join(' ');
    //console.log('### updateWorkInfo : query = '+q);
    pool.query(q)
        .catch(err => { console.log('Failed to update SF OrgInfo HC database : query = '+q+' - err = ', err);  });
}

function now() {
    var d = new Date();
    var offset = (new Date().getTimezoneOffset() / 60) * -1;
    return new Date(d.getTime() + offset).toISOString();
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
    doAll2 : function(mainCallback){        
        // Environment information
        var allenv = [];
        var myenv = {};
                        
        //status object
        var DATABASE_URL = "postgres://qrgegoiddbkngv:3a2115f67912945baa640bde32220b28f88f4bcb64a29d236e788cce2751ce2c@ec2-54-217-250-0.eu-west-1.compute.amazonaws.com:5432/d5qhvdi2aam7d9"
        status = {
            selectedUsername : username      // Which SF org username do we want to work with ?
            ,REPO_COMMIT_MESSAGE : process.env.REPO_COMMIT_MESSAGE

            ,hcPool          : null
            ,sfConnection    : null
            ,sfLoginResult   : null
        };        
        //console.log('Working on org of selected username : ', status.selectedUsername);


        async.series({
                        
            // connect to Heroku Connect SFOrgInfo DB
            hcPoolConnect : function(callback){
                if(!MUTE) console.log('HC CONNECT');
                status.hcPool = (new pg.Pool({ connectionString: DATABASE_URL, ssl: true }));     // Heroku Connect db for sfOrgInfo
                status.hcPool.connect()
                    .catch(err      => { return callback(createReturnObject(err, 'Failed to connect to SF OrgInfo HC database'));   })
                    .then((result)  => { return callback(null);     });
            },

            // connect to Heroku Connect SFOrgInfo DB
            hcPoolQuery : function(callback) {
                if(!MUTE) console.log('HC QUERY');
                var query = "SELECT * FROM salesforce.SFOrgInfo__c WHERE sf_username__c='"+ status.selectedUsername +"'";
                status.hcPool.query(query)
                    .catch(err      => { return callback(createReturnObject(err, 'Failed to query SF OrgInfo HC database : query = '+query));  })
                    .then((result)  => {
                        var res = result.rows[0];

                        myenv = {}
                        myenv.SF_METADATA_POLL_TIMEOUT  = res.sf_metadata_poll_timeout__c;
                            myenv.SF_LOGIN_URL              = res.sf_login_url__c;
                            myenv.SF_USERNAME               = res.sf_username__c;
                        myenv.SF_PASSWORD               = res.sf_password__c;
                        myenv.SF_API_VERSION            = res.sf_api_version__c;
                        myenv.EXCLUDE_METADATA          = res.exclude_metadata__c;
                        myenv.GIT_IGNORE                = res.git_ignore__c;
                            myenv.REPO_URL                  = res.repo_url__c;
                            myenv.REPO_BRANCH               = res.repo_branch__c || "master";
                            myenv.REPO_USER_NAME            = res.repo_user_name__c;
                            myenv.REPO_PASSWORD             = res.repo_password__c;
                        myenv.REPO_USER_EMAIL           = res.repo_user_email__c;
                        myenv.REPO_README               = res.repo_readme__c;
                        //myenv.REPO_COMMIT_MESSAGE

                        allenv[status.selectedUsername] = myenv;

                        //console.log('### From HC : allenv : ', allenv);
                        return callback(null);
                    });      
            },

            // connect to Heroku Connect SFOrgInfo DB
            doTheJob : function(callback) {
                exec(['sfdx-project.sh'
                            ,myenv.SF_USERNAME
                            ,myenv.SF_LOGIN_URL
                            ,myenv.REPO_USER_NAME
                            ,myenv.REPO_PASSWORD
                            ,myenv.REPO_URL
                            ,myenv.REPO_BRANCH
                        ], function(err, out, code) {
                    if (err instanceof Error) {
                      throw err;
                    }
        
                    process.stderr.write(err);
                    process.stdout.write(out);
                    process.exit(code);
                });
                return callback(null);
            },
        },


        function(err, results){
            var details;

            if(err){
                details = err.details;
                console.log("Error occurred : ", err.error, err.details);
                updateWorkInfo(status.hcPool, err.error, err.details);
            } else {
                console.log("Success");
                details = "Success";
                updateWorkInfo(status.hcPool, "Success", "");
            }

            return mainCallback && mainCallback(err, details);
        })


    },




    ///////////////////////////////////////////////////////////////////////////////////////:
    /*
    doAll : function(mainCallback){        
        // Environment information
        var allenv = [];
        var myenv = {};
                        
        //status object
        var DATABASE_URL = "postgres://qrgegoiddbkngv:3a2115f67912945baa640bde32220b28f88f4bcb64a29d236e788cce2751ce2c@ec2-54-217-250-0.eu-west-1.compute.amazonaws.com:5432/d5qhvdi2aam7d9"
        status = {
            selectedUsername : username      // Which SF org username do we want to work with ?
            ,REPO_COMMIT_MESSAGE : process.env.REPO_COMMIT_MESSAGE

            ,hcPool          : (new pg.Pool({ connectionString: DATABASE_URL, ssl: true }))     // Heroku Connect db for sfOrgInfo
            ,tempPath         : '/tmp/'
            ,zipPath          : "zips/"
            ,repoPath         : "repos/"
            ,zipFile          : "_MyPackage"+Math.random()+".zip"
            ,sfConnection    : null
            ,sfLoginResult   : null
            ,types           : {}
        };        
        console.log('Working on org of selected username : ', status.selectedUsername);

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
                        
            // connect to Heroku Connect SFOrgInfo DB
            hcPoolConnect : function(callback){
                if(!MUTE) console.log('HC CONNECT');
                status.hcPool.connect()
                    .catch(err => { return callback(createReturnObject(err, 'Failed to connect to SF OrgInfo HC database'));   })
                    .then((result) => {
                        return callback(null);
                });
            },

            // connect to Heroku Connect SFOrgInfo DB
            hcPoolQuery : function(callback) {
                if(!MUTE) console.log('HC QUERY');
                var query = "SELECT * FROM salesforce.SFOrgInfo__c WHERE sf_username__c='"+ status.selectedUsername +"'";
                status.hcPool.query(query)
                    .catch(err      => { return callback(createReturnObject(err, 'Failed to query SF OrgInfo HC database : query = '+query));  })
                    .then((result)  => {
                        var res = result.rows[0];

                        myenv = {}
                        myenv.SF_METADATA_POLL_TIMEOUT  = res.sf_metadata_poll_timeout__c;
                        myenv.SF_LOGIN_URL              = res.sf_login_url__c;
                        myenv.SF_USERNAME               = res.sf_username__c;
                        myenv.SF_PASSWORD               = res.sf_password__c;
                        myenv.SF_API_VERSION            = res.sf_api_version__c;
                        myenv.EXCLUDE_METADATA          = res.exclude_metadata__c;
                        myenv.GIT_IGNORE                = res.git_ignore__c;
                        myenv.REPO_URL                  = res.repo_url__c;
                        myenv.REPO_BRANCH               = res.repo_branch__c;
                        myenv.REPO_USER_NAME            = res.repo_user_name__c;
                        myenv.REPO_PASSWORD             = res.repo_password__c;
                        myenv.REPO_USER_EMAIL           = res.repo_user_email__c;
                        myenv.REPO_README               = res.repo_readme__c;
                        //myenv.REPO_COMMIT_MESSAGE

                        allenv[status.selectedUsername] = myenv;

                        console.log('### From HC : allenv : ', allenv);
                        return callback(null);
                    });      
            },

            //login to SF
            sfLogin : function(callback){
                if(!MUTE) console.log('SF LOGIN');
                myenv = allenv[status.selectedUsername];
                status.sfConnection = new jsforce.Connection({ loginUrl: myenv.SF_LOGIN_URL });
                status.sfConnection.metadata.pollTimeout = myenv.SF_METADATA_POLL_TIMEOUT || 600000;
                status.sfConnection.login(myenv.SF_USERNAME, myenv.SF_PASSWORD, function(err, lgnResult) {
                    status.sfLoginResult = lgnResult;
                    return callback((err)?createReturnObject(err, 'SF Login failed ('+myenv.SF_LOGIN_URL+', '+myenv.SF_USERNAME+', '+myenv.SF_PASSWORD+')'):null);
                });
            },
            //Describes metadata items
            sfDescribeMetadata : function(callback){
                if(!MUTE) console.log('SF DESCRIBE METADATA');
                myenv = allenv[status.selectedUsername];
                status.sfConnection.metadata.describe(myenv.SF_API_VERSION+'.0', function(err, describe){
                    status.sfDescribe = describe;
                    return callback((err)?createReturnObject(err, 'SF Describe failed'):null);
                });
            },
            //Lists of all metadata details
            sfListMetadata : function(callback){
                if(!MUTE) console.log('SF LIST DESCRIBE METADATA');
                myenv = allenv[status.selectedUsername];
                var iterations =  parseInt(Math.ceil(status.sfDescribe.metadataObjects.length/3.0));
                var excludeMetadata = myenv.EXCLUDE_METADATA || '';
                var excludeMetadataList = excludeMetadata.toLowerCase().split(',');

                var asyncObj = {};

                function listMetadataBatch(qr){
                    return function(cback){
                        //if(!MUTE) console.log('SF LIST DESCRIBE METADATA: '+JSON.stringify(qr));
                        status.sfConnection.metadata.list(qr, myenv.SF_API_VERSION+'.0', function(err, fileProperties){
                            if(!err && fileProperties){
                                for(var ft = 0; ft < fileProperties.length; ft++){
                                    if(!status.types[fileProperties[ft].type]){
                                        status.types[fileProperties[ft].type] = [];
                                    }
                                    status.types[fileProperties[ft].type].push(fileProperties[ft].fullName);
                                    //console.log('# type = ', fileProperties[ft].type+' : '+fileProperties[ft].fullName);
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
                    return callback((err)?createReturnObject(err, 'SF Describe list metadata failed : '+JSON.stringify(err)):null);
                });
                
                
            },
            
            //Retrieving ZIP file of metadata
            sfRetrieveZip : function(callback){
                //should use describe
                //retrieve xml
                if(!MUTE) console.log('SF RETRIEVE ZIP');
                myenv = allenv[status.selectedUsername];
                
                // Va chercher tous les types stockés dans status.types ...
                var _types = [];
                for(var t in status.types){
                    if(t=='ApexClass') {
                        _types.push({
                            members: status.types[t],
                            name: t,
                        });
                    }
                }
                var stream = status.sfConnection.metadata.retrieve({ 
                    unpackaged: {
                        types   : _types,
                        version : myenv.SF_API_VERSION,
                    }
                }).stream();
                
                // ... et les "pipe" dans le fichier Zip
                stream.on('end', function() {
                    if(!MUTE) console.log('SF RETRIEVE ZIP - end');
                    return callback(null);
                });
                stream.on('error', function(err){
                    if(!MUTE) console.log('SF RETRIEVE ZIP - error ', err);
                    return callback((err)?createReturnObject(err, 'SF Retrieving metadata ZIP file failed'):null);
                });
                
                stream.pipe(fs.createWriteStream(status.tempPath+status.zipPath+status.zipFile));
                if(!MUTE) console.log('SF RETRIEVE ZIP - getting Metadata from SF ...');
                
                // le retour se fait dans 'stream.on()'
            },
                        
            gitClone : function(callback){
                myenv = allenv[status.selectedUsername];
                var url = "https://"+myenv.REPO_USER_NAME+":"+myenv.REPO_PASSWORD+"@"+myenv.REPO_URL;
                var folderPath = status.tempPath+status.repoPath+status.zipFile;
                var branch = myenv.REPO_BRANCH || "master";
            
                if(!MUTE) console.log('GIT CLONE '+url+' '+folderPath+' '+branch);
                git.clone(url, folderPath, 1, branch, function(err, _repo){
                    status.gitRepo = _repo;
                    //deletes all cloned files except the .git folder (the ZIP file will be the master)
                    deleteFolderRecursive(folderPath, '.git', true);
                    return callback((err)?createReturnObject(err, 'Git clone failed : '+JSON.stringify(err)):null);
                });
            },
            
            //Unzip metadata zip file
            unzipFile : function(callback){
                if(!MUTE) console.log('UNZIP FILE');
                myenv = allenv[status.selectedUsername];
                
                //create .gitignore
                var fs = require('fs');

                var gitIgnoreBody = '#ignore files';
                if(myenv.GIT_IGNORE){
                    var spl = myenv.GIT_IGNORE.split(',');
                    for(var i in spl){
                        if(spl[i]){
                            gitIgnoreBody+='\n'+spl[i];
                        }
                    }
                }

                // Create README file
                var readmeBody = process.env.REPO_README || "";
                fs.writeFile(status.tempPath+status.repoPath+status.zipFile+'/README.md', readmeBody, function(err) {
                    if(err){
                        return callback(createReturnObject(err, 'README.md file creation failed'));
                    }
                    
                    // Create .gitignore file file
                    fs.writeFile(status.tempPath+status.repoPath+status.zipFile+'/.gitignore', gitIgnoreBody, function(err) {
                        if(err){
                            return callback(createReturnObject(err, '.gitignore file creation failed'));
                        }
                        
                        // On ouvre le zip ...
                        var zip = null;
                        try {
                            if(!MUTE) console.log('UNZIP FILE - creating AdmZip('+status.tempPath+status.zipPath+status.zipFile+')');
                            zip = new AdmZip(status.tempPath+status.zipPath+status.zipFile);
                        } catch(ex) {
                            return callback(createReturnObject(ex, 'AdmZip failed : '+JSON.stringify(ex)));
                        }
                        
                        // ... et on extrait tous les fichiers du zip
                        try {
                            zip.extractAllTo(status.tempPath+status.repoPath+status.zipFile+'/', true);
                        } catch(ex) {
                            return callback(createReturnObject(ex, 'Unzip failed : '+JSON.stringify(ex)));
                        }
                        
                        return callback(null);
                    }); 
                });
            },
            
            //Git add new resources
            gitAdd : function(callback){
                if(!MUTE) console.log('GIT ADD');
                myenv = allenv[status.selectedUsername];
                
                // git -A : on ajoute tout au repo
                status.gitRepo.add("-A", function(err){
                    return callback((err)?createReturnObject(err, 'git add failed : '+JSON.stringify(err)):null);
                });
            },
            
            //Git commit
            gitCommit : function(callback){
                if(!MUTE) console.log('GIT COMMIT');
                myenv = allenv[status.selectedUsername];
                var userName  = myenv.REPO_USER_NAME  || "Heroku SFGit";
                var userEmail = myenv.REPO_USER_EMAIL || "sfgit@heroku.com";

                status.gitRepo.identify({"name":userName, "email":userEmail}, function(err, oth){
                    var commitMessage = status.REPO_COMMIT_MESSAGE || 'Automatic commit (sfgit)';
                    status.gitRepo.commit(commitMessage, function(err, oth){
                        if(err){
                            err.details = oth;
                        }
                        return callback((err)?createReturnObject(err, 'git commit failed : '+JSON.stringify(err)):null);
                    });
                });
            },
            
            //Git push
            gitPush : function(callback){
                if(!MUTE) console.log('GIT PUSH');
                myenv = allenv[status.selectedUsername];
                var branch = myenv.REPO_BRANCH || "master";
                
                status.gitRepo.remote_push("origin", branch, function(err, oth){
                    if(err){
                        err.details = oth;
                    }
                    return callback((err)?createReturnObject(err, 'git push failed : '+JSON.stringify(err)):null);
                });
            },
        },
                     
        function(err, results){
            // deletes all temp files
            //deleteFolderRecursive(status.tempPath+status.zipPath+'/');
            //deleteFolderRecursive(status.tempPath+status.repoPath+'/');

            if(err 
                && err.error.details
                && (err.error.details.indexOf("up-to-date")>=0 || err.error.details.indexOf("nothing to commit") >=0)){
                console.log('Success', err.error.details);
                updateWorkInfo(status.hcPool, 'Success', err.error.details);
                return mainCallback && mainCallback(null, err.error.details);
            }

            var details = (err && err.error && err.error.details) || null;
            if(err){
                details = err.details + (details==null ? '' : ' '+details);
                console.log("Error occurred : ", err.error, details);
                updateWorkInfo(status.hcPool, err.error, details);
            } else {
                console.log('Success');
                details = 'Success';
                updateWorkInfo(status.hcPool, 'Success', '');
            }
            return mainCallback && mainCallback(err, details);
        })

    },
    */
}
