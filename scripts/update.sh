#!/bin/bash
# NanoClaw Update Script
# Updates NanoClaw to the latest version

set -e

echo "==================================="
echo "NanoClaw Update Script"
echo "==================================="
echo ""

# Check if running as root
if [ "$EUID" -ne 0 ]; then 
   echo "Please run as root (use sudo)"
   exit 1
fi

echo "Creating backup before update..."
BACKUP_FILE="/root/nanoclaw-pre-update-$(date +%Y%m%d-%H%M%S).tar.gz"
tar -czf "$BACKUP_FILE" \
  /opt/nanoclaw/.env \
  /opt/nanoclaw/store \
  /opt/nanoclaw/groups \
  /opt/nanoclaw/data/sessions \
  2>/dev/null || true
echo "Backup created: $BACKUP_FILE"
echo ""

echo "Stopping NanoClaw service..."
systemctl stop nanoclaw

echo ""
echo "Updating NanoClaw code..."
su - nanoclaw -c "cd /opt/nanoclaw && git pull origin main"

echo ""
echo "Installing dependencies..."
su - nanoclaw -c "cd /opt/nanoclaw && npm install"

echo ""
echo "Building..."
su - nanoclaw -c "cd /opt/nanoclaw && npm run build"

echo ""
echo "Rebuilding Docker container..."
su - nanoclaw -c "cd /opt/nanoclaw/container && docker build -t nanoclaw-agent:latest ."

echo ""
echo "Starting NanoClaw service..."
systemctl start nanoclaw

echo ""
echo "==================================="
echo "Update Complete!"
echo "==================================="
echo ""
echo "Check status with: systemctl status nanoclaw"
echo "View logs with: journalctl -u nanoclaw -f"
echo ""
