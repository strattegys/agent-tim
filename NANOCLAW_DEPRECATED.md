# NanoClaw Migration Notice

## Status: DEPRECATED ⚠️

Agent Tim has been migrated from **NanoClaw** to **Nanobot** as of March 2026.

## Why the Migration?

1. **Cost**: NanoClaw used Claude API ($10-20/month) → Nanobot uses Gemini (free tier)
2. **Speed**: NanoClaw had 10-30s response times → Nanobot has 2-5s response times
3. **Flexibility**: NanoClaw was Claude-only → Nanobot supports 20+ LLM providers
4. **Architecture**: NanoClaw used Docker containers → Nanobot is lightweight Python gateway

## What Changed?

### Before (NanoClaw)
- **Framework**: NanoClaw (Node.js + Docker)
- **LLM**: Claude 3.5 Sonnet (hardcoded)
- **Architecture**: Docker containers per conversation
- **Installation**: `/opt/nanoclaw/`
- **Service**: `nanoclaw.service`
- **User**: `nanoclaw`

### After (Nanobot)
- **Framework**: Nanobot (Python)
- **LLM**: Gemini 2.5 Flash (configurable)
- **Architecture**: Single gateway process
- **Installation**: `/root/.nanobot/`
- **Service**: `nanobot.service`
- **User**: `root`

## NanoClaw Installation Status

The NanoClaw installation at `/opt/nanoclaw/` has been:
- ✅ **Stopped**: Service disabled
- ✅ **Preserved**: Files archived for reference
- ⚠️ **Not Deleted**: Available for rollback if needed

### To Completely Remove NanoClaw (Optional)

```bash
# Stop and disable service
systemctl stop nanoclaw
systemctl disable nanoclaw
rm /etc/systemd/system/nanoclaw.service
systemctl daemon-reload

# Archive the installation
tar -czf /root/nanoclaw-archive-$(date +%Y%m%d).tar.gz /opt/nanoclaw

# Remove installation (ONLY after confirming Nanobot works)
rm -rf /opt/nanoclaw
userdel -r nanoclaw  # Remove nanoclaw user
```

## Migration Complete

See `NANOBOT_MIGRATION_COMPLETE.md` for full migration details.

## Documentation Updates

All documentation has been updated to reflect Nanobot:
- ✅ `README.md` - Updated architecture and references
- ⚠️ `TROUBLESHOOTING.md` - Still contains NanoClaw references (to be updated)
- ⚠️ `ARCHITECTURE.md` - Still describes NanoClaw (to be updated)
- ⚠️ `DEPLOYMENT.md` - Still describes NanoClaw deployment (to be updated)

## References

- [NanoClaw GitHub](https://github.com/qwibitai/nanoclaw) - Original framework
- [Nanobot GitHub](https://github.com/nanobot-ai/nanobot) - Current framework
- Migration completed: March 12-13, 2026
