#!/bin/bash
# NanoClaw Restore Script
# Restores NanoClaw data from a backup

set -e

BACKUP_DIR="/root/nanoclaw-backups"

echo "==================================="
echo "NanoClaw Restore Script"
echo "==================================="
echo ""

# Check if backup directory exists
if [ ! -d "$BACKUP_DIR" ]; then
    echo "Error: Backup directory not found: $BACKUP_DIR"
    exit 1
fi

# List available backups
echo "Available backups:"
ls -lh "$BACKUP_DIR"/nanoclaw-backup-*.tar.gz 2>/dev/null || {
    echo "No backups found!"
    exit 1
}
echo ""

# Get backup file from user
read -p "Enter backup filename (or full path): " BACKUP_FILE

# If just filename provided, prepend backup directory
if [[ "$BACKUP_FILE" != /* ]]; then
    BACKUP_FILE="$BACKUP_DIR/$BACKUP_FILE"
fi

# Check if backup file exists
if [ ! -f "$BACKUP_FILE" ]; then
    echo "Error: Backup file not found: $BACKUP_FILE"
    exit 1
fi

echo ""
echo "WARNING: This will overwrite current NanoClaw data!"
read -p "Are you sure you want to restore from $BACKUP_FILE? (yes/no): " CONFIRM

if [ "$CONFIRM" != "yes" ]; then
    echo "Restore cancelled."
    exit 0
fi

echo ""
echo "Stopping NanoClaw service..."
systemctl stop nanoclaw

echo "Creating safety backup of current data..."
SAFETY_BACKUP="/root/nanoclaw-pre-restore-$(date +%Y%m%d-%H%M%S).tar.gz"
tar -czf "$SAFETY_BACKUP" \
  /opt/nanoclaw/.env \
  /opt/nanoclaw/store \
  /opt/nanoclaw/groups \
  /opt/nanoclaw/data/sessions \
  2>/dev/null || true
echo "Safety backup created: $SAFETY_BACKUP"

echo ""
echo "Restoring from backup..."
tar -xzf "$BACKUP_FILE" -C /

echo "Setting permissions..."
chown -R nanoclaw:nanoclaw /opt/nanoclaw

echo "Starting NanoClaw service..."
systemctl start nanoclaw

echo ""
echo "==================================="
echo "Restore Complete!"
echo "==================================="
echo ""
echo "Check status with: systemctl status nanoclaw"
echo "View logs with: journalctl -u nanoclaw -f"
echo ""
