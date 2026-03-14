# Cloud Nanobot Tim

Lightweight, cloud-ready AI assistant powered by the [Nanobot](https://github.com/HKUDS/nanobot) framework. This is Tim stripped down to just the nanobot - no legacy infrastructure, no droplet dependencies.

## Quick Start

```bash
# 1. Copy environment template
cp .env.example .env

# 2. Fill in your API keys in .env

# 3. Run with Docker Compose
docker compose up -d
```

## What's Included

```
cloud-nanobot-tim/
├── .nanobot/
│   ├── config.json          # Nanobot configuration (providers, channels, agents)
│   ├── system-prompt.md     # Tim's personality and instructions
│   └── tools/
│       ├── twenty_crm.sh    # Twenty CRM integration (full CRUD)
│       └── linkedin.sh      # LinkedIn via ConnectSafely API
├── Dockerfile               # Container image
├── docker-compose.yml       # One-command deployment
├── entrypoint.sh            # Env var substitution + startup
├── .env.example             # Required environment variables
└── README.md
```

## Required Environment Variables

| Variable | Description | Source |
|----------|-------------|--------|
| `GEMINI_API_KEY` | Google Gemini API key (primary LLM) | [Google AI](https://ai.google.dev/) |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token | [@BotFather](https://t.me/BotFather) |
| `TWENTY_CRM_API_KEY` | Twenty CRM API key | Your Twenty CRM instance |
| `TWENTY_CRM_URL` | Twenty CRM base URL | Default: `http://localhost:3000` |

### Optional

| Variable | Description | Source |
|----------|-------------|--------|
| `GROQ_API_KEY` | Groq API key (backup LLM) | [Groq Console](https://console.groq.com/) |
| `CONNECTSAFELY_API_KEY` | LinkedIn integration | ConnectSafely |
| `CONNECTSAFELY_ACCOUNT_ID` | LinkedIn account ID | ConnectSafely |
| `BRAVE_SEARCH_API_KEY` | Web search | [Brave Search API](https://brave.com/search/api/) |

## Deploy to Cloud

### DigitalOcean App Platform

```bash
doctl apps create --spec app-spec.yaml
```

### Any Docker Host

```bash
docker compose up -d
```

### Manual (No Docker)

```bash
pip install nanobot-ai
cp -r .nanobot/ ~/.nanobot/
# Set env vars, then:
nanobot gateway
```

## Switching LLM Models

Edit `.nanobot/config.json` and change the model:

```json
"model": "gemini/gemini-2.5-flash"     // Google Gemini (free tier)
"model": "groq/llama-3.1-70b-versatile" // Groq (free tier)
```

## Cost

- **Gemini 2.5 Flash**: Free tier (1500 req/day)
- **Groq**: Free tier (14,400 req/day)
- **Container**: ~140MB RAM
