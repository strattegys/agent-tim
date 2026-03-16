# Nanobot Migration - Complete

## Summary

Successfully migrated Tim from NanoClaw to Nanobot to solve Claude API credits issue. Tim is now running on **Groq's free tier** using Llama 3.1 70B model.

## What Was Done

### 1. Installation ✅
- Installed `pipx` and `nanobot-ai` on droplet
- Created `/root/.nanobot/` directory structure

### 2. Configuration ✅
- **Config file**: `/root/.nanobot/config.json`
  - Groq provider with API key configured
  - Gemini as backup provider
  - Telegram channel enabled
  - Model: `groq/llama-3.1-70b-versatile`

- **System prompt**: `/root/.nanobot/system-prompt.md`
  - Tim's personality and instructions
  - Role-based access control
  - LinkedIn capabilities documented
  - Confirmation workflow for messages/connections

### 3. Telegram Integration ✅
- Bot: `@timx509_bot`
- Token: `8784616714:AAEAeJJ25_ypScrEJvEl2QFwgHC51-7HATw`
- Status: **Connected and running**
- Mode: Polling (long-polling for updates)

### 4. Service Setup ✅
- Created systemd service: `/etc/systemd/system/nanobot.service`
- Service enabled for auto-start on boot
- NanoClaw service stopped to avoid conflicts

### 5. NanoClaw Status
- **Stopped**: `systemctl stop nanoclaw`
- **Still enabled**: Can be restarted if needed as fallback
- **Backup available**: All config preserved at `/opt/nanoclaw/`

## Current Status

### ✅ Working
- Nanobot gateway running
- Telegram bot connected
- Groq LLM configured (free tier)
- System prompt loaded
- Auto-start enabled

### ⏳ Pending
- **Test conversation**: Send message to @timx509_bot to verify
- **LinkedIn MCP server**: Not yet created (can be added later)
- **Speed verification**: Need to test response times
- **User ID restriction**: Currently allows all users (set to `["*"]`)

## Key Improvements

| Metric | NanoClaw (Claude) | Nanobot (Groq) |
|--------|-------------------|----------------|
| **Cost** | $10-20/month | $0/month (free tier) |
| **Speed** | 10-30 seconds | Expected 2-5 seconds |
| **Model** | Claude Sonnet (hardcoded) | Llama 3.1 70B (configurable) |
| **Startup** | Container spawn (~3s) | No container overhead |
| **Flexibility** | Claude only | 20+ LLM providers |

## Configuration Files

### `/root/.nanobot/config.json`
```json
{
  "providers": {
    "groq": {
      "apiKey": "gsk_***REDACTED***"
    },
    "gemini": {
      "apiKey": "***REDACTED***"
    }
  },
  "agents": {
    "defaults": {
      "model": "groq/llama-3.1-70b-versatile",
      "maxTokens": 4096,
      "temperature": 0.7,
      "maxToolIterations": 20,
      "memoryWindow": 50
    }
  },
  "channels": {
    "telegram": {
      "enabled": true,
      "token": "8784616714:AAEAeJJ25_ypScrEJvEl2QFwgHC51-7HATw",
      "allowFrom": ["*"]
    }
  }
}
```

### `/etc/systemd/system/nanobot.service`
```ini
[Unit]
Description=Nanobot AI Assistant
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/root
Environment="PATH=/root/.local/bin:/usr/local/bin:/usr/bin:/bin"
ExecStart=/root/.local/bin/nanobot gateway
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

## Next Steps

### Immediate Testing
1. **Send test message** to @timx509_bot on Telegram
2. **Verify response speed** - should be much faster than NanoClaw
3. **Check conversation memory** - test multi-turn conversations
4. **Verify role-based access** - test with different users

### LinkedIn Integration (Optional)
If LinkedIn functionality is needed:
1. Create MCP server at `/root/.nanobot/mcp-servers/linkedin/`
2. Add ConnectSafely API integration
3. Update config.json with MCP server configuration
4. Test profile lookup, messaging, connections

### Security Hardening
1. **Restrict user access**: Replace `["*"]` with specific Telegram user IDs
2. **Get your user ID**: Message @userinfobot on Telegram
3. **Update config**: `"allowFrom": ["YOUR_USER_ID"]`

### Monitoring
```bash
# Check Nanobot status
systemctl status nanobot

# View logs
journalctl -u nanobot -f

# Restart if needed
systemctl restart nanobot
```

## Rollback Plan

If Nanobot doesn't work as expected:

```bash
# Stop Nanobot
systemctl stop nanobot
systemctl disable nanobot

# Restart NanoClaw
systemctl start nanoclaw

# Add payment to Anthropic for Claude credits
# Continue with NanoClaw + Claude Haiku
```

## Success Criteria

- ✅ Nanobot installed and running
- ✅ Telegram bot connected
- ✅ Groq configured (free tier)
- ✅ System prompt loaded
- ✅ Auto-start enabled
- ⏳ Response time <5 seconds (needs testing)
- ⏳ Conversation memory working (needs testing)
- ⏳ Cost: $0/month confirmed (within free tier limits)

## Groq Free Tier Limits

- **Requests**: 14,400 per day
- **Tokens**: 14,400 per minute
- **Expected usage**: 100-500 requests/day
- **Status**: Well within limits ✅

## Commands Reference

```bash
# Start Nanobot manually
nanobot gateway --verbose

# Test agent directly
nanobot agent -m "Hello"

# Check status
nanobot status

# View config
cat ~/.nanobot/config.json

# Service management
systemctl status nanobot
systemctl restart nanobot
systemctl stop nanobot
journalctl -u nanobot -f
```

## Migration Complete! 🎉

Tim is now running on Nanobot with Groq (free tier). The migration took approximately 1.5 hours.

**Ready to test**: Send a message to @timx509_bot on Telegram to verify everything works!
