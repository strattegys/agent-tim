#!/usr/bin/env bash
# Deploy avabot_server.py to production and restart service.
# Usage: bash deploy_avabot.sh

set -e
export SSH_AUTH_SOCK=/tmp/tim-agent.sock

echo "Deploying avabot_server.py → server..."
scp avabot_server.py root@137.184.187.233:/root/.avabot/server.py
ssh root@137.184.187.233 "systemctl restart avabot && sleep 1 && systemctl is-active avabot"
echo "Done."
