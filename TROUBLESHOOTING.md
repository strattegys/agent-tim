# NanoClaw Troubleshooting Guide

Common issues and solutions for NanoClaw deployment.

## Service Issues

### Service Won't Start

**Symptom**: `systemctl start nanoclaw` fails or service shows as "failed"

**Check logs**:
```bash
journalctl -u nanoclaw -n 50 --no-pager
```

**Common causes**:

1. **Missing dependencies**:
   ```bash
   su - nanoclaw
   cd /opt/nanoclaw
   npm install
   npm run build
   ```

2. **Permission issues**:
   ```bash
   chown -R nanoclaw:nanoclaw /opt/nanoclaw
   ```

3. **Port already in use** (credential proxy on port 3001):
   ```bash
   lsof -i :3001
   # Kill the process if needed
   ```

### Service Keeps Restarting

**Check logs for errors**:
```bash
journalctl -u nanoclaw -f
```

**Common causes**:

1. **Invalid API key**:
   - Check `/opt/nanoclaw/.env` for correct `ANTHROPIC_API_KEY`
   - Verify key at https://console.anthropic.com/settings/keys

2. **Invalid Telegram bot token**:
   - Verify `TELEGRAM_BOT_TOKEN` in `.env`
   - Test token with: `curl https://api.telegram.org/bot<TOKEN>/getMe`

3. **Missing Docker image**:
   ```bash
   docker images | grep nanoclaw-agent
   # If missing, rebuild:
   su - nanoclaw
   cd /opt/nanoclaw/container
   docker build -t nanoclaw-agent:latest .
   ```

## Telegram Issues

### Bot Not Responding

**Symptom**: Messages sent to bot receive no response

**Check if service is running**:
```bash
systemctl status nanoclaw
```

**Check logs for errors**:
```bash
journalctl -u nanoclaw -f
```

**Common causes**:

1. **Chat not registered**:
   ```bash
   su - nanoclaw
   cd /opt/nanoclaw
   # Get your chat ID first by sending /chatid to the bot
   npx tsx setup/index.ts --step register -- \
     --jid "tg:YOUR_CHAT_ID" \
     --name "Tim Main" \
     --folder "telegram_main" \
     --trigger "@Tim" \
     --channel telegram \
     --no-trigger-required \
     --is-main
   ```

2. **Container failed to start**:
   - Check logs for "Container exited with error"
   - Look for Docker-related errors
   - Verify Docker is running: `systemctl status docker`

3. **API rate limiting**:
   - Check Anthropic console for rate limit errors
   - Wait a few minutes and try again

### Bot Shows Typing Indicator But No Response

**Symptom**: Bot shows "typing..." but never sends a message

**Check container logs**:
```bash
journalctl -u nanoclaw -n 100 | grep -A 10 "Container exited"
```

**Common causes**:

1. **Container timeout** (default 30 minutes):
   - Check if query is taking too long
   - Look for "Container timeout" in logs

2. **API errors**:
   - Check for Anthropic API errors in logs
   - Verify API key is valid and has credits

3. **Out of memory**:
   ```bash
   free -h
   docker stats
   ```
   - Consider upgrading droplet if consistently low on memory

### Can't Get Chat ID

**Symptom**: `/chatid` command doesn't work

**Solutions**:

1. **Restart the service**:
   ```bash
   systemctl restart nanoclaw
   ```

2. **Check if Telegram channel is loaded**:
   ```bash
   journalctl -u nanoclaw | grep "Telegram bot connected"
   ```

3. **Verify bot token**:
   ```bash
   curl https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getMe
   ```

## Docker Issues

### Container Image Missing

**Symptom**: Error "Unable to find image 'nanoclaw-agent:latest'"

**Solution**:
```bash
su - nanoclaw
cd /opt/nanoclaw/container
docker build -t nanoclaw-agent:latest .
```

### Docker Daemon Not Running

**Symptom**: "Cannot connect to the Docker daemon"

**Solution**:
```bash
systemctl start docker
systemctl enable docker
systemctl status docker
```

### Container Build Fails

**Check Docker logs**:
```bash
docker logs <container_id>
```

**Common causes**:

1. **Out of disk space**:
   ```bash
   df -h
   # Clean up if needed:
   docker system prune -a
   ```

2. **Network issues during build**:
   - Retry the build
   - Check internet connectivity

## Database Issues

### Conversation History Lost

**Check if database exists**:
```bash
ls -la /opt/nanoclaw/store/
```

**Restore from backup** (if available):
```bash
tar -xzf nanoclaw-backup-YYYYMMDD.tar.gz -C /
chown -R nanoclaw:nanoclaw /opt/nanoclaw/store
systemctl restart nanoclaw
```

### Database Corruption

**Symptom**: SQLite errors in logs

**Solution**:
```bash
su - nanoclaw
cd /opt/nanoclaw
# Backup current database
cp -r store store.backup
# Remove corrupted database
rm -rf store/*
# Restart service (will create new database)
exit
systemctl restart nanoclaw
```

**Note**: This will lose conversation history

## Performance Issues

### Slow Response Times

**Check system resources**:
```bash
top
free -h
df -h
```

**Common causes**:

1. **Low memory**:
   - Upgrade droplet to 4GB RAM
   - Reduce concurrent containers in config

2. **High CPU usage**:
   - Check for runaway containers: `docker ps`
   - Kill stuck containers: `docker kill <container_id>`

3. **Slow API responses**:
   - Check Anthropic status page
   - Try again later

### High API Costs

**Monitor usage**:
- Check https://console.anthropic.com/

**Reduce costs**:

1. **Limit conversation length**:
   - Conversations accumulate context over time
   - Consider periodic conversation resets

2. **Use more concise prompts**:
   - Avoid sending very long messages

3. **Monitor token usage in logs**:
   ```bash
   journalctl -u nanoclaw | grep tokens
   ```

## Environment Issues

### Environment Variables Not Loading

**Check .env file**:
```bash
cat /opt/nanoclaw/.env
```

**Verify sync to container**:
```bash
cat /opt/nanoclaw/data/env/env
```

**Re-sync if needed**:
```bash
su - nanoclaw
cd /opt/nanoclaw
cp .env data/env/env
exit
systemctl restart nanoclaw
```

### Wrong Assistant Name

**Update .env**:
```bash
nano /opt/nanoclaw/.env
# Change ASSISTANT_NAME=YourName
```

**Sync and restart**:
```bash
cp /opt/nanoclaw/.env /opt/nanoclaw/data/env/env
systemctl restart nanoclaw
```

## Network Issues

### Can't SSH to Droplet

**Check droplet status** in DigitalOcean console

**Try recovery console** from DigitalOcean dashboard

**Verify firewall rules**:
```bash
ufw status
# If SSH is blocked:
ufw allow OpenSSH
```

### Telegram API Unreachable

**Check internet connectivity**:
```bash
ping -c 4 api.telegram.org
```

**Check DNS**:
```bash
nslookup api.telegram.org
```

**Verify no firewall blocking**:
```bash
curl https://api.telegram.org/
```

## Logs and Debugging

### View Real-time Logs

```bash
journalctl -u nanoclaw -f
```

### View Last N Lines

```bash
journalctl -u nanoclaw -n 100 --no-pager
```

### View Logs Since Time

```bash
journalctl -u nanoclaw --since "1 hour ago"
```

### View Logs for Specific Date

```bash
journalctl -u nanoclaw --since "2026-03-12" --until "2026-03-13"
```

### Search Logs

```bash
journalctl -u nanoclaw | grep "error"
journalctl -u nanoclaw | grep "Container exited"
```

### Container-specific Logs

```bash
ls -la /opt/nanoclaw/groups/telegram_main/logs/
cat /opt/nanoclaw/groups/telegram_main/logs/container-*.log
```

## Emergency Recovery

### Complete Service Reset

**Stop service**:
```bash
systemctl stop nanoclaw
```

**Backup data**:
```bash
tar -czf /root/nanoclaw-emergency-backup.tar.gz /opt/nanoclaw
```

**Clean restart**:
```bash
su - nanoclaw
cd /opt/nanoclaw
git reset --hard origin/main
npm install
npm run build
exit
systemctl start nanoclaw
```

### Factory Reset (Nuclear Option)

**⚠️ WARNING: This deletes all conversation history**

```bash
systemctl stop nanoclaw
rm -rf /opt/nanoclaw/store/*
rm -rf /opt/nanoclaw/groups/*
rm -rf /opt/nanoclaw/data/sessions/*
systemctl start nanoclaw
```

You'll need to re-register your Telegram chat.

## Getting Help

### Collect Diagnostic Information

```bash
# System info
uname -a
cat /etc/os-release

# Service status
systemctl status nanoclaw

# Recent logs
journalctl -u nanoclaw -n 100 --no-pager

# Docker status
docker ps -a
docker images

# Disk space
df -h

# Memory
free -h

# NanoClaw version
cd /opt/nanoclaw && git log -1 --oneline
```

### NanoClaw Resources

- [GitHub Issues](https://github.com/qwibitai/nanoclaw/issues)
- [Documentation](https://github.com/qwibitai/nanoclaw/tree/main/docs)
- [Telegram Channel Code](https://github.com/qwibitai/nanoclaw-telegram)

### Anthropic Support

- [API Status](https://status.anthropic.com/)
- [Support](https://support.anthropic.com/)
- [Documentation](https://docs.anthropic.com/)

## Common Error Messages

### "ENOENT: no such file or directory"

**Cause**: Missing file or directory

**Solution**: Create the missing directory
```bash
mkdir -p /opt/nanoclaw/logs
mkdir -p /opt/nanoclaw/data/env
```

### "EADDRINUSE: address already in use"

**Cause**: Port 3001 already in use

**Solution**: Find and kill the process
```bash
lsof -i :3001
kill -9 <PID>
```

### "Authentication failed"

**Cause**: Invalid API key or bot token

**Solution**: Verify credentials in `.env` file

### "Container exited with code 125"

**Cause**: Docker image not found or failed to start

**Solution**: Rebuild Docker image
```bash
cd /opt/nanoclaw/container
docker build -t nanoclaw-agent:latest .
```

### "Rate limit exceeded"

**Cause**: Too many API requests

**Solution**: Wait a few minutes, check Anthropic console for limits
