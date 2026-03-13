# Agent Tim - Nanobot AI Assistant

AI assistant deployed on DigitalOcean using Nanobot framework with Telegram integration and Twenty CRM access.

## Overview

- **Framework**: Nanobot (MCP-native AI agent framework)
- **Platform**: DigitalOcean Droplet (Ubuntu 24.04, 8GB RAM)
- **Messaging**: Telegram (@timx509_bot)
- **AI Model**: Gemini 2.5 Flash (via Google AI)
- **Deployment**: Systemd service (nanobot gateway)

## Deployment Information

### Server Details
- **Droplet IP**: 137.184.187.233
- **OS**: Ubuntu 24.04 LTS (8GB RAM, 2 vCPU, 90GB disk)
- **User**: `root`
- **Installation Path**: `/root/.nanobot`

### Bot Details
- **Telegram Bot**: @timx509_bot
- **Assistant Name**: Tim
- **Chat Mode**: Main chat (responds to all messages, no trigger required)
- **Chat ID**: tg:5289013326

## Architecture

```
┌─────────────────────────────────────────┐
│         Telegram Bot API                │
│         (@timx509_bot)                  │
└──────┬──────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────────┐
│      Nanobot Gateway                    │
│      (Python, systemd service)          │
│                                         │
│  ├─ Telegram Channel Handler           │
│  ├─ Agent Loop & Sessions              │
│  ├─ Custom Tools (bash scripts)        │
│  └─ Gemini 2.5 Flash LLM               │
└──────┬──────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────────┐
│      Google AI API                      │
│      (Gemini 2.5 Flash)                 │
└─────────────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────────┐
│      Twenty CRM (localhost:3000)        │
│      (via custom bash tools)            │
└─────────────────────────────────────────┘
```

## Key Features

- **MCP-Native**: Built on Model Context Protocol for tool integration
- **Fast Responses**: Gemini 2.5 Flash provides sub-second response times
- **CRM Integration**: Full access to Twenty CRM via custom tools
- **Auto-restart**: Systemd service ensures bot restarts on failure or reboot
- **Multi-Tool Support**: LinkedIn, web search, summarization, and CRM tools
- **Workspace Integration**: Google Drive mounted at `/mnt/gdrive`

## Directory Structure on Droplet

```
/root/.nanobot/
├── config.json                  # Nanobot configuration
├── system-prompt.md             # Tim's personality and instructions
├── tools/
│   ├── linkedin.sh              # LinkedIn integration tool
│   ├── twenty_crm.sh            # Twenty CRM integration tool
│   └── [custom tools]           # Other bash-based tools
├── sessions/                    # Conversation sessions
├── media/                       # Media files
├── cron/                        # Scheduled tasks
└── workspace/                   # Agent workspace

/etc/systemd/system/
└── nanobot.service              # Systemd service definition

/mnt/gdrive/                     # Google Drive mount
└── backups/                     # Backup storage
```

## Configuration

The `/root/.nanobot/config.json` file contains:

```json
{
  "providers": {
    "groq": { "apiKey": "..." },
    "gemini": { "apiKey": "..." }
  },
  "agents": {
    "defaults": {
      "model": "gemini/gemini-2.5-flash",
      "workspace": "/mnt/gdrive"
    }
  },
  "channels": {
    "telegram": {
      "enabled": true,
      "token": "..."
    }
  }
}
```

## Service Management

### View Logs
```bash
ssh root@137.184.187.233 'journalctl -u nanobot -f'
```

### Restart Service
```bash
ssh root@137.184.187.233 'systemctl restart nanobot'
```

### Check Status
```bash
ssh root@137.184.187.233 'systemctl status nanobot'
```

### Stop Service
```bash
ssh root@137.184.187.233 'systemctl stop nanobot'
```

### Start Service
```bash
ssh root@137.184.187.233 'systemctl start nanobot'
```

## Deployment Steps (Reference)

Complete deployment process documented in `DEPLOYMENT.md`.

## Troubleshooting

See `TROUBLESHOOTING.md` for common issues and solutions.

## Cost Considerations

- **DigitalOcean Droplet**: ~$48/month (8GB RAM droplet)
- **Google AI API**: Free tier (Gemini 2.5 Flash)
  - 1500 requests per day (free)
  - Very low cost beyond free tier
- **Twenty CRM**: Self-hosted (no additional cost)

## Security Notes

- API keys stored in `/root/.nanobot/config.json`
- Twenty CRM API key in custom tools (not exposed to LLM)
- Service runs as root but tools are sandboxed
- CRM data access restricted to private chat only
- Delete operations require explicit confirmation

## Current Integrations

- [x] Telegram channel
- [x] Twenty CRM (full CRUD access)
- [x] LinkedIn (via ConnectSafely API)
- [x] Web search (via Brave Search)
- [x] Content summarization (via summarize CLI)
- [x] Google Drive workspace

## Future Enhancements

- [ ] Automated CRM data enrichment
- [ ] Workflow automation triggers
- [ ] Scheduled CRM reports
- [ ] Multi-channel support (WhatsApp, Discord)

## References

- [Nanobot GitHub](https://github.com/nanobot-ai/nanobot)
- [Nanobot Documentation](https://www.nanobot.ai/)
- [Twenty CRM Documentation](https://docs.twenty.com/)
- [Telegram Bot API](https://core.telegram.org/bots/api)
- [Google AI Documentation](https://ai.google.dev/)
