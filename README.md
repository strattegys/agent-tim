# Strattegys Command Central

Multi-agent web platform for business operations. Each agent has a specialized role and operates through a unified chat interface with contextual side panels.

## Agents

| Agent | Role | LLM |
|-------|------|-----|
| **Tim** | Business development, LinkedIn outreach, CRM | Gemini 2.5 Flash |
| **Suzi** | Personal assistant, reminders, scheduling | Gemini 2.5 Flash |
| **Friday** | Agent architect, workflow management | Gemini 2.5 Pro |
| **Scout** | Research, web search, market intelligence | Gemini 2.5 Flash |
| **Rainbow** | Child-friendly AI companion | Gemini (via Python server) |

## Architecture

```
Next.js (port 3001)          <- Command Central web UI (sole interface)
  |-- Chat with all agents
  |-- Kanban workflow boards
  |-- Reminders panel
  |-- Notification system

Twenty CRM (port 3000)       <- Contact/company/workflow data (Docker)
RainbowBot (port 18792)      <- Standalone Python server (systemd)
Nginx                        <- TLS termination, reverse proxy
```

**Server**: DigitalOcean droplet at `137.184.187.233`
**Domain**: `stratt-central.b2bcontentartist.com`
**Process manager**: PM2 (`command-central`)

## Directory Structure

```
agents/               <- System prompts (one folder per agent)
web/                  <- Next.js app (the main project)
  app/                <- Pages and API routes
  components/         <- React components
  lib/                <- Agent config, tools, cron, heartbeat
  public/             <- Static assets, avatars, sounds
tools/                <- Server-side CRM/LinkedIn shell scripts
scripts/              <- Deployment scripts
  deploy-web.sh       <- Manual fallback deploy
docs/                 <- Historical migration docs
docker-compose.yml    <- Production stack (Caddy + Next.js)
docker-compose.dev.yml <- Local dev stack (Docker)
Caddyfile             <- Reverse proxy config
```

## Deployment

```bash
# One-command deploy (validates locally, pushes, builds on server)
bash scripts/deploy-web.sh
```

Requires SSH agent setup:
```bash
# In Git Bash (one-time per session)
export SSH_AUTH_SOCK=/tmp/tim-agent.sock
ssh-add C:/Users/USER1/.ssh/hetzner_ed25519
```

Auto-deploys via GitHub Actions on push to `master` (web/ changes only).

## Local Development

**Recommended (Docker, matches production-style env and port 3001):**

```bash
cd COMMAND-CENTRAL   # repo root containing docker-compose.dev.yml
docker compose -f docker-compose.dev.yml up
```

Then open **http://localhost:3001** (hot reload via mounted `web/`). Uses `web/.env.local` and `host.docker.internal` for CRM DB — see comments in [`docker-compose.dev.yml`](docker-compose.dev.yml).

**Optional (Node on the host, same port as Docker):**

```bash
cd web
npm install
cp .env.local.example .env.local  # Fill in API keys
npm run dev                        # http://localhost:3001 (see package.json)
```

Do **not** run both Docker and `npm run dev` on **3001** at the same time — pick one.

### CRM Postgres (Kanban, workflow builder, real CRM data)

Workflows and Kanban read/write **PostgreSQL** via [`web/lib/db.ts`](web/lib/db.ts). If **`CRM_DB_PASSWORD`** is missing, the app uses an in-memory **`.dev-store/`** — fine for UI experiments, but **pipelines will be empty or fake**.

1. Add **`CRM_DB_PASSWORD`** (and usually **`CRM_DB_PORT`**) to **`web/.env.local`**. See [`web/.env.local.example`](web/.env.local.example).
2. **[`docker-compose.dev.yml`](docker-compose.dev.yml)** sets **`CRM_DB_HOST=host.docker.internal`** so the **container** reaches Postgres that is listening on **your Windows host** (not `127.0.0.1` inside the container).
3. **SSH tunnel** (common): forward a local port to Postgres on the Command Central droplet. **5433** avoids clashing with other tunnels on your PC.

   **One-liner (Git Bash / WSL / macOS):**

   ```bash
   ssh -L 5433:localhost:5432 root@137.184.187.233
   ```

   **Scripts (same effect):**

   - PowerShell (from `COMMAND-CENTRAL`):  
     `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\crm-db-tunnel.ps1`  
     Uses `%USERPROFILE%\.ssh\hetzner_ed25519` (or `id_ed25519` / `id_rsa`) when present. Override with env **`SSH_IDENTITY_FILE`**.
   - Git Bash: `bash scripts/crm-db-tunnel.sh` — same auto-detect under `~/.ssh/`, or set **`SSH_IDENTITY_FILE`**.

   Leave that session open. In **`.env.local`**: `CRM_DB_PORT=5433` plus the real **`CRM_DB_PASSWORD`**.

4. Recreate or restart the stack so env is picked up:  
   `docker compose -f docker-compose.dev.yml up -d --force-recreate`

**Which agent has Kanban?** In this codebase, **Suzi** has **no** Kanban tab (`workflowTypes` is empty). Boards are tied to agents that own workflows — e.g. **Tim** (LinkedIn outreach), **Scout** (research pipeline), **Ghost** (content pipeline), **Marni** (content distribution). Open **Tim** (or the agent that matches your workflow) and use the **pipeline / Kanban** icon, or **`/kanban`**.

### Suzi chat + voice (local)

- **Ephemeral chat (no production memory / vector RAG):** in **`web/.env.local`** set `CHAT_EPHEMERAL_AGENTS=suzi`. Session + memory-tool files go under **`web/.dev-ephemeral-chat/suzi/`** (gitignored); delete that folder to reset. Session consolidation to long-term memory is skipped for listed agents.
- **Inworld TTS (same as Rainbow Bot):** set **`INWORLD_TTS_KEY`** in **`web/.env.local`** (same value as Rainbow’s `INWORLD_TTS_KEY` on the Project Server). Optional **`INWORLD_VOICE_ID`** (default **Olivia** matches Suzi’s registry). Run **`npm run check-tts`** from **`web/`** to verify the key is non-empty. Restart Docker after editing env. The **Status** rail shows **Inworld TTS** as OK when the key is present. If chat works but you hear nothing, open the browser **developer console** — failed `/api/tts` and autoplay blocks are logged — and **click the page once** before the reply finishes (autoplay policy).

## Key Integrations

- **Twenty CRM** -- Contact management, workflows, notes (PostgreSQL via Docker)
- **LinkedIn (Unipile)** -- Message sync, connection polling, inbound webhooks
- **Google Gemini** -- LLM for all agents
- **NextAuth** -- Authentication (credentials provider)
