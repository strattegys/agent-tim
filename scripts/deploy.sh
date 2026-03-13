#!/bin/bash
# NanoClaw Deployment Script
# Run this on your DigitalOcean droplet as root

set -e

echo "==================================="
echo "NanoClaw Deployment Script"
echo "==================================="
echo ""

# Check if running as root
if [ "$EUID" -ne 0 ]; then 
   echo "Please run as root (use sudo)"
   exit 1
fi

# Get configuration from user
read -p "Enter your Anthropic API key: " ANTHROPIC_KEY
read -p "Enter your Telegram bot token: " TELEGRAM_TOKEN
read -p "Enter assistant name (default: Tim): " ASSISTANT_NAME
ASSISTANT_NAME=${ASSISTANT_NAME:-Tim}

echo ""
echo "==================================="
echo "Step 1: Update System"
echo "==================================="
apt-get update && apt-get upgrade -y

echo ""
echo "==================================="
echo "Step 2: Install Node.js 20.x"
echo "==================================="
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs build-essential python3 git curl ca-certificates gnupg

echo ""
echo "==================================="
echo "Step 3: Install Docker"
echo "==================================="
curl -fsSL https://get.docker.com | sh
systemctl enable docker
systemctl start docker

echo ""
echo "==================================="
echo "Step 4: Create NanoClaw User"
echo "==================================="
if ! id -u nanoclaw > /dev/null 2>&1; then
    useradd -m -s /bin/bash nanoclaw
    usermod -aG docker nanoclaw
    echo "User 'nanoclaw' created"
else
    echo "User 'nanoclaw' already exists"
fi

echo ""
echo "==================================="
echo "Step 5: Clone NanoClaw Repository"
echo "==================================="
mkdir -p /opt/nanoclaw
chown nanoclaw:nanoclaw /opt/nanoclaw

if [ ! -d "/opt/nanoclaw/.git" ]; then
    su - nanoclaw -c "cd /opt && git clone https://github.com/qwibitai/nanoclaw.git nanoclaw"
else
    echo "NanoClaw already cloned, pulling latest..."
    su - nanoclaw -c "cd /opt/nanoclaw && git pull"
fi

echo ""
echo "==================================="
echo "Step 6: Install Dependencies"
echo "==================================="
su - nanoclaw -c "cd /opt/nanoclaw && npm ci && npm run build"

echo ""
echo "==================================="
echo "Step 7: Add Telegram Channel"
echo "==================================="
su - nanoclaw -c "cd /opt/nanoclaw && \
    git remote add telegram https://github.com/qwibitai/nanoclaw-telegram.git 2>/dev/null || true && \
    git fetch telegram main && \
    git config user.email 'nanoclaw@localhost' && \
    git config user.name 'NanoClaw' && \
    git merge telegram/main --no-edit || \
    (git checkout --theirs repo-tokens/badge.svg && \
     git add repo-tokens/badge.svg && \
     git commit -m 'Merge telegram channel support')"

su - nanoclaw -c "cd /opt/nanoclaw && npm install && npm run build"

echo ""
echo "==================================="
echo "Step 8: Build Docker Container"
echo "==================================="
su - nanoclaw -c "cd /opt/nanoclaw/container && docker build -t nanoclaw-agent:latest ."

echo ""
echo "==================================="
echo "Step 9: Configure Environment"
echo "==================================="
su - nanoclaw -c "cat > /opt/nanoclaw/.env << EOF
ANTHROPIC_API_KEY=$ANTHROPIC_KEY
ASSISTANT_NAME=$ASSISTANT_NAME
TELEGRAM_BOT_TOKEN=$TELEGRAM_TOKEN
EOF"

su - nanoclaw -c "mkdir -p /opt/nanoclaw/data/env && cp /opt/nanoclaw/.env /opt/nanoclaw/data/env/env"
su - nanoclaw -c "mkdir -p /opt/nanoclaw/logs"

echo ""
echo "==================================="
echo "Step 10: Create Systemd Service"
echo "==================================="
cat > /etc/systemd/system/nanoclaw.service << 'EOF'
[Unit]
Description=NanoClaw AI Assistant
After=network.target docker.service
Requires=docker.service

[Service]
Type=simple
User=nanoclaw
WorkingDirectory=/opt/nanoclaw
ExecStart=/usr/bin/node /opt/nanoclaw/dist/index.js
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=nanoclaw

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable nanoclaw
systemctl start nanoclaw

echo ""
echo "==================================="
echo "Deployment Complete!"
echo "==================================="
echo ""
echo "Next steps:"
echo "1. Open Telegram and search for your bot"
echo "2. Send /chatid to get your chat ID"
echo "3. Register your chat with:"
echo ""
echo "   su - nanoclaw"
echo "   cd /opt/nanoclaw"
echo "   npx tsx setup/index.ts --step register -- \\"
echo "     --jid \"tg:YOUR_CHAT_ID\" \\"
echo "     --name \"$ASSISTANT_NAME Main\" \\"
echo "     --folder \"telegram_main\" \\"
echo "     --trigger \"@$ASSISTANT_NAME\" \\"
echo "     --channel telegram \\"
echo "     --no-trigger-required \\"
echo "     --is-main"
echo ""
echo "4. Restart the service:"
echo "   exit"
echo "   systemctl restart nanoclaw"
echo ""
echo "Check status with: systemctl status nanoclaw"
echo "View logs with: journalctl -u nanoclaw -f"
echo ""
