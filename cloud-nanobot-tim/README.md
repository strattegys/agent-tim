# Cloud Nanobot Tim

Lightweight AI assistant powered by the [Nanobot](https://github.com/HKUDS/nanobot) framework. Tim stripped down to just the nanobot - no legacy infrastructure.

## Deploy on Droplet (alongside Twenty CRM)

```bash
# 1. SSH into the droplet
ssh root@137.184.187.233

# 2. Clone the repo (or pull latest)
cd /opt
git clone https://github.com/strattegys/agent-tim.git
cd agent-tim/cloud-nanobot-tim

# 3. Stop the old systemd nanobot service
systemctl stop nanobot
systemctl disable nanobot

# 4. Configure environment
cp .env.example .env
nano .env   # Fill in your API keys

# 5. Build and start
docker compose up -d

# 6. Check logs
docker compose logs -f
```

## Connectivity

| Service | Protocol | Endpoint | Direction |
|---------|----------|----------|-----------|
| **Telegram** | Long-polling | `api.telegram.org` | Outbound only |
| **Twenty CRM** | REST API | `localhost:3000` | Local (host network) |
| **Gemini LLM** | HTTPS | `generativelanguage.googleapis.com` | Outbound |
| **LinkedIn** | HTTPS | `api.connectsafely.ai` | Outbound |
| **Brave Search** | HTTPS | `api.search.brave.com` | Outbound |

Uses `network_mode: host` so the container shares the droplet's network stack - CRM at `localhost:3000` is accessible directly.

## Required Environment Variables

| Variable | Description | Source |
|----------|-------------|--------|
| `GEMINI_API_KEY` | Google Gemini API key (primary LLM) | [Google AI](https://ai.google.dev/) |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token | [@BotFather](https://t.me/BotFather) |
| `TWENTY_CRM_API_KEY` | Twenty CRM API key | Your Twenty CRM instance |
| `TWENTY_CRM_URL` | CRM base URL | Default: `http://localhost:3000` |

### Optional

| Variable | Description | Source |
|----------|-------------|--------|
| `GROQ_API_KEY` | Groq API key (backup LLM) | [Groq Console](https://console.groq.com/) |
| `CONNECTSAFELY_API_KEY` | LinkedIn integration | ConnectSafely |
| `CONNECTSAFELY_ACCOUNT_ID` | LinkedIn account ID | ConnectSafely |
| `BRAVE_SEARCH_API_KEY` | Web search | [Brave Search API](https://brave.com/search/api/) |

## What's Included

```
cloud-nanobot-tim/
├── .nanobot/
│   ├── config.json          # Nanobot config (providers, channels, agents)
│   ├── system-prompt.md     # Tim's personality and instructions
│   └── tools/
│       ├── twenty_crm.sh    # Twenty CRM (full CRUD)
│       └── linkedin.sh      # LinkedIn via ConnectSafely API
├── Dockerfile               # Python 3.12 + nanobot-ai
├── docker-compose.yml       # Host networking for CRM access
├── entrypoint.sh            # Env var injection + connectivity checks
└── .env.example             # Environment template
```

## Management

```bash
# View logs
docker compose logs -f

# Restart
docker compose restart

# Stop
docker compose down

# Rebuild after config changes
docker compose up -d --build
```

## Switching LLM Models

Edit `.nanobot/config.json` and rebuild:

```
gemini/gemini-2.5-flash       - Google Gemini (free tier, 1500 req/day)
groq/llama-3.1-70b-versatile  - Groq (free tier, 14,400 req/day)
```

## Moving to a Separate Host

If you move Tim off the CRM droplet, change `TWENTY_CRM_URL` in `.env`:

```
TWENTY_CRM_URL=https://stratt-central.b2bcontentartist.com
```

Everything else (Telegram, LinkedIn, Search, LLM) works from anywhere - all outbound HTTPS.
