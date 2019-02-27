## From : https://github.com/wadewegner/deploy-to-sfdx/blob/master/.profile#L10


echo "Installing SFDX"
npm install --global sfdx-cli

echo "Installing SFDX plugin shane"
sfdx plugins:install shane-sfdx-plugins

echo "Installing JQ for JSON parsing ..."

wget -O jq https://github.com/stedolan/jq/releases/download/jq-1.5/jq-linux64
chmod +x ./jq

echo "Updating PATH to include jq ..."
export PATH=$PATH:/app

echo "Updating PATH to include Salesforce CLI ..."
export PATH=$PATH:/app/.local/share/sfdx/cli/bin/

echo "Updating Salesforce CLI plugin ..."
sfdx update

echo "Return version info ..."
sfdx version
sfdx plugins --core

echo "Creating local resources ..."
mkdir /app/tmp

echo "env and NODE_PATH ?"
which sfdx


echo "Completed!"
