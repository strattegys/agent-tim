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
scripts/              <- Deployment scripts; setup-crm-shared-network.sh (prod Option A)
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

**Local dev (Docker on your PC)**

1. Add **`CRM_DB_PASSWORD`** (and **`CRM_DB_PORT`**) to **`web/.env.local`**. See [`web/.env.local.example`](web/.env.local.example).
2. **[`docker-compose.dev.yml`](docker-compose.dev.yml)** sets **`CRM_DB_HOST=host.docker.internal`** so the dev container reaches Postgres on your machine.
3. **SSH tunnel** to Postgres on the droplet (port **5433** avoids local clashes):

   ```bash
   ssh -L 5433:localhost:5432 root@137.184.187.233
   ```

   **Scripts:** PowerShell `scripts\crm-db-tunnel.ps1` or Git Bash `scripts/crm-db-tunnel.sh` (auto-detects `~/.ssh/` keys; override with **`SSH_IDENTITY_FILE`**).

   In **`.env.local`**: **`CRM_DB_HOST=127.0.0.1`**, **`CRM_DB_PORT=5433`**, plus **`CRM_DB_PASSWORD`**.

4. Recreate the dev stack: `docker compose -f docker-compose.dev.yml up -d --force-recreate`

**Production (droplet) — shared Docker network (Option A, default)**

Twenty/CRM Postgres often runs **only inside Docker** (not published on the host). Then **`CRM_DB_HOST=host.docker.internal`** hits **`172.17.0.1:5432`** and fails with **ECONNREFUSED**. **Option A** puts Command Central’s `web` container on the same user-defined network as Postgres.

1. SSH to the droplet and run **[`scripts/setup-crm-shared-network.sh`](scripts/setup-crm-shared-network.sh)** from the repo (prints exact next steps):

   ```bash
   cd /opt/agent-tim && git pull && bash scripts/setup-crm-shared-network.sh
   ```

2. **`docker network connect crm_shared <postgres_container_name>`** (name from `docker ps`).

3. In **`/opt/agent-tim/web/.env.local`**: **`CRM_DB_HOST=<postgres_container_name>`**, **`CRM_DB_PORT=5432`**, correct **`CRM_DB_NAME`** / user / password. Verify DB with:

   `docker exec -it <postgres_container_name> psql -U postgres -d default -c 'select 1'`

4. Redeploy: **`docker compose -f docker-compose.yml -f docker-compose.crm-network.yml up -d`**.  
   If the **`crm_shared`** network exists, **GitHub Actions** and **[`scripts/deploy-web.sh`](scripts/deploy-web.sh)** use that overlay automatically.

See **[`docker-compose.crm-network.yml`](docker-compose.crm-network.yml)** for details.

**Alternative (Option B):** publish Postgres **`ports: ["5432:5432"]`** on the host and keep **`CRM_DB_HOST=host.docker.internal`** — only if you accept host-bound 5432.

**Which agent has Kanban?** In this codebase, **Suzi** has **no** Kanban tab (`workflowTypes` is empty). Boards are tied to agents that own workflows — e.g. **Tim** (LinkedIn outreach), **Scout** (research pipeline), **Ghost** (content pipeline), **Marni** (content distribution). Open **Tim** (or the agent that matches your workflow) and use the **pipeline / Kanban** icon, or **`/kanban`**.

### Suzi chat + voice (local)

- **Ephemeral chat (no production memory / vector RAG):** in **`web/.env.local`** set `CHAT_EPHEMERAL_AGENTS=suzi`. Session + memory-tool files go under **`web/.dev-ephemeral-chat/suzi/`** (gitignored); delete that folder to reset. Session consolidation to long-term memory is skipped for listed agents.
- **Inworld TTS (same as Rainbow Bot):** set **`INWORLD_TTS_KEY`** in **`web/.env.local`** (same value as Rainbow’s `INWORLD_TTS_KEY` on the Project Server). Optional **`INWORLD_VOICE_ID`** (default **Olivia** matches Suzi’s registry). Run **`npm run check-tts`** from **`web/`** to verify the key is non-empty. Restart Docker after editing env. The **Status** rail shows **Inworld TTS** as OK when the key is present. If chat works but you hear nothing, open the browser **developer console** — failed `/api/tts` and autoplay blocks are logged — and **click the page once** before the reply finishes (autoplay policy).

## Key Integrations

- **Twenty CRM** -- Contact management, workflows, notes (PostgreSQL via Docker)
- **LinkedIn (Unipile)** -- Message sync, connection polling, inbound webhooks
- **Google Gemini** -- LLM for all agents
- **NextAuth** -- Authentication (credentials provider)
