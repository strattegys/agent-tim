#!/bin/bash
# NanoClaw Backup Script
# Creates a backup of important NanoClaw data

set -e

BACKUP_DIR="/root/nanoclaw-backups"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_FILE="$BACKUP_DIR/nanoclaw-backup-$TIMESTAMP.tar.gz"

echo "==================================="
echo "NanoClaw Backup Script"
echo "==================================="
echo ""

# Create backup directory if it doesn't exist
mkdir -p "$BACKUP_DIR"

echo "Creating backup: $BACKUP_FILE"
echo ""

# Create backup
tar -czf "$BACKUP_FILE" \
  /opt/nanoclaw/.env \
  /opt/nanoclaw/store \
  /opt/nanoclaw/groups \
  /opt/nanoclaw/data/sessions \
  2>/dev/null || true

# Check if backup was created successfully
if [ -f "$BACKUP_FILE" ]; then
    BACKUP_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
    echo "Backup created successfully!"
    echo "File: $BACKUP_FILE"
    echo "Size: $BACKUP_SIZE"
    echo ""
    
    # List all backups
    echo "All backups:"
    ls -lh "$BACKUP_DIR"
    echo ""
    
    # Clean up old backups (keep last 7)
    echo "Cleaning up old backups (keeping last 7)..."
    cd "$BACKUP_DIR"
    ls -t nanoclaw-backup-*.tar.gz | tail -n +8 | xargs -r rm
    echo "Done!"
else
    echo "Error: Backup failed!"
    exit 1
fi
