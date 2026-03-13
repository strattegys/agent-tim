# NanoClaw Deployment Guide

Complete step-by-step guide for deploying NanoClaw on DigitalOcean with Telegram integration.

## Prerequisites

- DigitalOcean account
- Anthropic API key (from https://console.anthropic.com/settings/keys)
- Telegram account (to create bot via BotFather)
- SSH access to your local machine

## Step 1: Create DigitalOcean Droplet

1. Log in to DigitalOcean
2. Create a new Droplet:
   - **Image**: Ubuntu 24.04 LTS
   - **Plan**: Basic ($18/month - 2GB RAM, 2 vCPU, 85GB disk)
   - **Datacenter**: Choose closest to you
   - **Authentication**: SSH keys (recommended) or password
   - **Hostname**: `nanoclaw-bot` or similar

3. Note the droplet IP address once created

## Step 2: Initial Server Setup

SSH into your droplet:

```bash
ssh root@YOUR_DROPLET_IP
```

Update system packages:

```bash
apt-get update && apt-get upgrade -y
```

## Step 3: Install Dependencies

### Install Node.js 20.x

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs build-essential python3 git curl ca-certificates gnupg
```

Verify installation:

```bash
node --version  # Should show v20.x.x
npm --version   # Should show 10.x.x
```

### Install Docker

```bash
curl -fsSL https://get.docker.com | sh
systemctl enable docker
systemctl start docker
docker --version  # Verify installation
```

## Step 4: Create NanoClaw User

```bash
useradd -m -s /bin/bash nanoclaw
usermod -aG docker nanoclaw
```

## Step 5: Clone and Build NanoClaw

### Clone Repository

```bash
mkdir -p /opt/nanoclaw
chown nanoclaw:nanoclaw /opt/nanoclaw
su - nanoclaw
cd /opt
git clone https://github.com/qwibitai/nanoclaw.git nanoclaw
cd nanoclaw
```

### Install Dependencies and Build

```bash
npm ci
npm run build
```

## Step 6: Add Telegram Channel Support

```bash
git remote add telegram https://github.com/qwibitai/nanoclaw-telegram.git
git fetch telegram main
git config user.email "nanoclaw@localhost"
git config user.name "NanoClaw"
git merge telegram/main --no-edit
```

If there are conflicts with `repo-tokens/badge.svg`:

```bash
git checkout --theirs repo-tokens/badge.svg
git add repo-tokens/badge.svg
git commit -m "Merge telegram channel support"
```

Install new dependencies and rebuild:

```bash
npm install
npm run build
```

## Step 7: Build Docker Container Image

```bash
cd /opt/nanoclaw/container
docker build -t nanoclaw-agent:latest .
```

This will take several minutes. Verify the image was created:

```bash
docker images | grep nanoclaw-agent
```

## Step 8: Create Telegram Bot

1. Open Telegram and search for `@BotFather`
2. Send `/newbot` command
3. Follow prompts:
   - **Bot name**: Choose a friendly name (e.g., "Tim Assistant")
   - **Bot username**: Must end with "bot" (e.g., "tim_ai_bot")
4. Copy the bot token (format: `123456789:ABCdefGHIjklMNOpqrsTUVwxyz`)
5. Note your bot's username (e.g., @tim_ai_bot)

## Step 9: Configure Environment

Create `.env` file:

```bash
cd /opt/nanoclaw
cat > .env << 'EOF'
ANTHROPIC_API_KEY=YOUR_ANTHROPIC_API_KEY_HERE
ASSISTANT_NAME=Tim
TELEGRAM_BOT_TOKEN=YOUR_TELEGRAM_BOT_TOKEN_HERE
EOF
```

Replace the placeholders with your actual values.

Sync environment to container:

```bash
mkdir -p data/env
cp .env data/env/env
```

## Step 10: Create Systemd Service

Exit from nanoclaw user back to root:

```bash
exit  # Back to root user
```

Create service file:

```bash
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
```

Enable and start the service:

```bash
systemctl daemon-reload
systemctl enable nanoclaw
systemctl start nanoclaw
```

Check status:

```bash
systemctl status nanoclaw
```

View logs:

```bash
journalctl -u nanoclaw -f
```

You should see output indicating the Telegram bot connected successfully.

## Step 11: Get Your Telegram Chat ID

1. Open Telegram and search for your bot (e.g., @tim_ai_bot)
2. Start a chat with the bot
3. Send the command: `/chatid`
4. The bot will reply with your chat ID (format: `tg:123456789`)
5. Copy this chat ID

## Step 12: Register Your Chat as Main Chat

```bash
su - nanoclaw
cd /opt/nanoclaw
npx tsx setup/index.ts --step register -- \
  --jid "tg:YOUR_CHAT_ID" \
  --name "Tim Main" \
  --folder "telegram_main" \
  --trigger "@Tim" \
  --channel telegram \
  --no-trigger-required \
  --is-main
```

Replace `YOUR_CHAT_ID` with the chat ID from step 11.

## Step 13: Restart and Test

Restart the service to pick up the registration:

```bash
exit  # Back to root
systemctl restart nanoclaw
```

Test the bot:

1. Open your Telegram chat with the bot
2. Send any message (e.g., "hello")
3. The bot should respond within a few seconds

## Verification Checklist

- [ ] Droplet created and accessible via SSH
- [ ] Node.js 20+ installed
- [ ] Docker installed and running
- [ ] NanoClaw cloned and built
- [ ] Telegram channel code merged
- [ ] Docker container image built
- [ ] Telegram bot created via BotFather
- [ ] `.env` file configured with API key and bot token
- [ ] Systemd service created and enabled
- [ ] Service running (check with `systemctl status nanoclaw`)
- [ ] Telegram bot connected (check logs)
- [ ] Chat registered as main chat
- [ ] Bot responds to test messages

## Post-Deployment

### Monitor Logs

```bash
ssh root@YOUR_DROPLET_IP 'journalctl -u nanoclaw -f'
```

### Restart Service

```bash
ssh root@YOUR_DROPLET_IP 'systemctl restart nanoclaw'
```

### Check Service Status

```bash
ssh root@YOUR_DROPLET_IP 'systemctl status nanoclaw'
```

### View Conversation Data

```bash
ssh root@YOUR_DROPLET_IP 'ls -la /opt/nanoclaw/groups/telegram_main/'
```

## Security Recommendations

1. **Set up a firewall** (UFW):
   ```bash
   ufw allow OpenSSH
   ufw enable
   ```

2. **Disable password authentication** (use SSH keys only):
   ```bash
   nano /etc/ssh/sshd_config
   # Set: PasswordAuthentication no
   systemctl restart sshd
   ```

3. **Regular updates**:
   ```bash
   apt-get update && apt-get upgrade -y
   ```

4. **Monitor API usage** at https://console.anthropic.com/

## Backup Recommendations

Important directories to backup:

- `/opt/nanoclaw/.env` - Environment configuration
- `/opt/nanoclaw/store/` - SQLite database
- `/opt/nanoclaw/groups/` - Conversation data
- `/opt/nanoclaw/data/sessions/` - Session data

Example backup command:

```bash
tar -czf nanoclaw-backup-$(date +%Y%m%d).tar.gz \
  /opt/nanoclaw/.env \
  /opt/nanoclaw/store \
  /opt/nanoclaw/groups \
  /opt/nanoclaw/data/sessions
```

## Updating NanoClaw

To update to the latest version:

```bash
su - nanoclaw
cd /opt/nanoclaw
git pull origin main
npm install
npm run build
exit
systemctl restart nanoclaw
```

## Cost Estimate

- **DigitalOcean Droplet**: $18/month (2GB RAM)
- **Anthropic API**: Variable based on usage
  - Claude 3.5 Sonnet: $3/million input tokens, $15/million output tokens
  - Typical conversation: ~1,000-5,000 tokens
  - Estimated: $10-50/month for moderate usage

**Total estimated cost**: $28-68/month

## Next Steps

- Customize assistant behavior via CLAUDE.md files
- Add scheduled tasks
- Integrate additional channels (Discord, Slack, etc.)
- Set up monitoring and alerts
