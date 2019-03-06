#!/bin/bash

set -e
set -u
set -x

# Don't auto-update SFDX CLI and its plugins
export SFDX_AUTOUPDATE_DISABLE=true



###############################################################
## PARAMÈTRES

# Dossier de travail
export PROJDIR='/tmp/zipdir'
rm -rf $PROJDIR
mkdir -p $PROJDIR

export USERNAME='barrow@altius-services.com'


export sf_username__c=$1
export sf_login_url__c=$2
export repo_user_name__c=$3
export repo_password__c=$4
export repo_url__c=$5
export repo_branch__c=$6

echo "sf_username__c = $1"
echo "sf_login_url__c = $2"
echo "repo_user_name__c = $3"
echo "repo_password__c = $4"
echo "repo_url__c = $5"
echo "repo_branch__c = $6"




###############################################################
## TRAITEMENT
## Boucle sur toustes les orgs Salesforce gérées par Opera

#heroku pg:psql  -c "SELECT * FROM salesforce.sforginfo__c  WHERE sf_username__c='$USERNAME'" -a rbw-deli
##heroku pg:psql  -c "SELECT sf_username__c, sf_password__c, sf_login_url__c, repo_url__c, repo_user_name__c, repo_password__c, repo_branch__c  FROM salesforce.sforginfo__c  WHERE sf_username__c='$USERNAME'" -a rbw-deli | grep -v "sf_username__c" | grep -v "+---" | sed 's/ //g' | while IFS="|" read -r sf_username__c sf_password__c sf_login_url__c repo_url__c repo_user_name__c repo_password__c repo_branch__c; do

    # Default value of branch is 'master'
    repo_branch__c=${repo_branch__c:-master}


	###############################################################
	## LOGIN

    # On se connecte à Salesforce
    # sf_username__c
    # sf_password__s
    #echo "sfdx force:auth:web:login --instanceurl $sf_login_url__c --setdefaultusername"
    #      sfdx force:auth:web:login --instanceurl $sf_login_url__c --setdefaultusername

    # On se connecte à Salesforce
    # sf_username__c
    # sf_login_url__c
    echo "sfdx force:auth:jwt:grant -s -u $sf_username__c --instanceurl $sf_login_url__c -f ./.config/opera.key -i $CLIENTID_OPERA"
          sfdx force:auth:jwt:grant -s -u $sf_username__c --instanceurl $sf_login_url__c -f ./.config/opera.key -i $CLIENTID_OPERA


	###############################################################
	## CREATE PROJECT FOLDERS

    # Crée la structure de dossiers pour accueillir les metadata du projet
    echo "sfdx force:project:create --projectname proj --outputdir $PROJDIR --manifest --defaultpackagedir force-app"
          sfdx force:project:create --projectname proj --outputdir $PROJDIR --manifest --defaultpackagedir force-app
          # Une 2e fois pour qu'il prenne bien en compte force-app (bug ?)
          sfdx force:project:create --projectname proj --outputdir $PROJDIR --manifest --defaultpackagedir force-app


	###############################################################
	## CLONE GIT REPO LOCALLY

    # Git clone le repo dans le dossier prévu (MD API format)
    # Delete folders aura and lwc
    cd $PROJDIR/proj/force-app/main/default
    rm -rf *
    echo "git clone https://$repo_user_name__c:$repo_password__c@$repo_url__c $PROJDIR/proj/force-app/main/default --depth 1 --branch $repo_branch__c"
    	  git clone https://$repo_user_name__c:$repo_password__c@$repo_url__c $PROJDIR/proj/force-app/main/default --depth 1 --branch $repo_branch__c
    # Supprime tout à l'intérieur (sauf dossier .git), le contenu sera écrasé par ce qui vient de l'org
    cd $PROJDIR/proj/force-app/main/default
    rm -rf *


	###############################################################
	## PULL METADATA FROM SALESFORCE ORG

    # Retrieve source code from org (MD API format)
    cd $PROJDIR/proj
    echo "sfdx shane:mdapi:pull --all --loglevel=info"
	sfdx force:user:display
	sfdx shane:mdapi:pull --all --loglevel=info


	###############################################################
	## COMMIT TO GOT REPO

    # Commit stuff
    cd $PROJDIR/proj/force-app/main/default
    pwd
    ls -al
    echo "git add -A"
          git add -A
    echo 'git commit -m "Message de commit"'
          git commit -m "Message de commit"
    echo 'git push "origin" '+$repo_branch__c
          git push "origin" $repo_branch__c


    # Ménage
    rm -rf $PROJDIR

#done
