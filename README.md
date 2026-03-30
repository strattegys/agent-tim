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

PostgreSQL (`crm-db`)        <- CRM data in the same Compose stack as the web app
Caddy                        <- TLS termination, reverse proxy (production)
```

**Server**: DigitalOcean droplet at `137.184.187.233`
**Domain**: `stratt-central.b2bcontentartist.com`
**Containers**: Docker Compose (`web`, `crm-db`, `caddy`)

## Directory Structure

```
agents/               <- System prompts (one folder per agent)
web/                  <- Next.js app (the main project)
  app/                <- Pages and API routes
  components/         <- React components
  lib/                <- Agent config, tools, cron, heartbeat
  public/             <- Static assets, avatars, sounds
tools/                <- Server-side CRM/LinkedIn shell scripts
scripts/              <- Deployment scripts; migrate-crm-postgres-from-legacy-container.sh (one-time DB cutover)
  deploy-web.sh       <- Manual fallback deploy
docs/                 <- Historical migration docs
docker-compose.yml    <- Production stack (Caddy + Next.js + crm-db Postgres)
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

1. Add **`CRM_DB_PASSWORD`** to **`web/.env.local`** (and keep **`CRM_DB_PORT=5432`** if you share the file with production — Docker dev overrides the port). See [`web/.env.local.example`](web/.env.local.example). Optional: render from **Bitwarden Secrets Manager** — [`docs/BITWARDEN-SECRETS.md`](docs/BITWARDEN-SECRETS.md) and [`scripts/bws-pull-env.ps1`](scripts/bws-pull-env.ps1).
2. **[`docker-compose.dev.yml`](docker-compose.dev.yml)** defaults to **`CRM_DB_HOST=host.docker.internal`** and **`CRM_DB_PORT`** from **`CC_DOCKER_CRM_DB_PORT`** / **`CRM_TUNNEL_LOCAL_PORT`** / **5433** so the dev container hits a forwarder on the Windows host, not production’s loopback-only **5432** on the droplet.

**Stable path (no SSH):** GitHub Actions (and manual **`scripts/deploy-web.sh`**) re-run **`tools/expose-crm-db-tailscale.sh`** after each deploy so a **droplet restart** does not drop Postgres on the tailnet. On your PC (Tailscale connected), run **`scripts\dev-docker-up.ps1`** — it **auto-starts the TCP bridge** when **`${CRM_DB_TAILSCALE_HOST:-100.74.54.12}:5432`** answers, otherwise it falls back to SSH. The bridge is [**`scripts/crm-db-tailscale-bridge.mjs`**](scripts/crm-db-tailscale-bridge.mjs) (**`0.0.0.0:5433`** → tailnet **:5432**). Reconnect after sleep or reboot: **`cd web && npm run db:reconnect`** (same auto logic) or **`npm run db:reconnect:bridge`** to force the bridge. **`dev-docker-up.ps1 -UseSshTunnel`** forces SSH. Optional: copy [**`.env.docker-dev.example`**](.env.docker-dev.example) to **`.env`** and set **`CC_DOCKER_CRM_DB_HOST`** / **`CC_DOCKER_CRM_DB_PORT`** if your Docker stack can reach the tailnet without a host forwarder.

**SSH tunnel (alternative):** Forward **`localhost:5432` on the droplet** (production **`crm-db`** publishes **`127.0.0.1:5432`**). Local port **5433** avoids clashes:

   ```bash
   # Tunnel scripts bind 0.0.0.0:5433 so Docker Desktop can reach Postgres via host.docker.internal
   ssh -L 0.0.0.0:5433:localhost:5432 root@<CC-host>
   ```

   **Scripts:** PowerShell **`scripts\dev-docker-up.ps1`** (starts tunnel then Compose), or **`scripts\crm-db-tunnel.ps1`** / Git Bash **`scripts/crm-db-tunnel.sh`**. Set **`CRM_SSH_HOST`** to the droplet **100.x** or MagicDNS when using Tailscale for SSH.

   You do **not** need **`CRM_DB_PORT=5433`** in **`.env.local`** for Docker dev — compose sets it. **`CRM_DB_HOST=127.0.0.1`** + **`CRM_DB_PORT=5433`** is for **`npm run dev` on the host** (no Docker) with the same forwarder.

3. Verify: **`cd web && npm run check-crm-db`** (from the host). From the dev container: **`docker compose -f docker-compose.dev.yml exec web npm run check-crm-db`**.

4. Recreate the dev stack after env changes: **`docker compose -f docker-compose.dev.yml up -d --force-recreate`**

**Automatic startup (Windows):** To bring the bridge + Compose up after each login, register a scheduled task once:

`powershell -ExecutionPolicy Bypass -File scripts\install-cc-dev-autostart-task.ps1`

Logs: **`%LOCALAPPDATA%\CommandCentralDev\autostart.log`**. Remove the task: **`Unregister-ScheduledTask -TaskName CommandCentralDevAutostart -Confirm:$false`**.

**Production (droplet) — CRM Postgres in Compose**

CRM data lives in the **`crm-db`** service in **`docker-compose.yml`** (same Docker network as **`web`** — no manual `docker network connect`, no dependency on a separate Twenty stack).

1. **`/opt/agent-tim/web/.env.local`** must set **`CRM_DB_PASSWORD`** (and **`CRM_DB_NAME`** / **`CRM_DB_USER`** if not `default` / `postgres`). Compose reads these for Postgres init and for the app.

2. Deploy (CI does this): **`docker compose --env-file web/.env.local -f docker-compose.yml up -d`**

3. **Cutover from an old container** (e.g. legacy **`twenty-db-1`**): after pulling code, run **`bash scripts/migrate-crm-postgres-from-legacy-container.sh`** on the server (see script header). Prefer stopping **`web`** first to avoid dual-writes.

4. Admin shell: **`docker compose --env-file web/.env.local -f docker-compose.yml exec crm-db psql -U postgres -d default`**

**Note:** **`crm-db`** publishes **`127.0.0.1:5432`** on the droplet (not on the public interface) so **SSH tunnel** + Docker dev work. From the internet the DB is still not exposed. **`docker compose exec crm-db psql`** works for admin on the server.

**Which agent has Kanban?** In this codebase, **Suzi** has **no** Kanban tab (`workflowTypes` is empty). Boards are tied to agents that own workflows — e.g. **Tim** (LinkedIn outreach), **Scout** (research pipeline), **Ghost** (content pipeline), **Marni** (content distribution). Open **Tim** (or the agent that matches your workflow) and use the **pipeline / Kanban** icon, or **`/kanban`**.

### Suzi chat + voice (local)

- **Ephemeral chat (no production memory / vector RAG):** in **`web/.env.local`** set `CHAT_EPHEMERAL_AGENTS=suzi`. Session + memory-tool files go under **`web/.dev-ephemeral-chat/suzi/`** (gitignored); delete that folder to reset. Session consolidation to long-term memory is skipped for listed agents.
- **Inworld TTS (same as Rainbow Bot):** set **`INWORLD_TTS_KEY`** in **`web/.env.local`** (same value as Rainbow’s `INWORLD_TTS_KEY` on the Project Server). Optional **`INWORLD_VOICE_ID`** (default **Olivia** matches Suzi’s registry). Run **`npm run check-tts`** from **`web/`** to verify the key is non-empty. Restart Docker after editing env. The **Status** rail shows **Inworld TTS** as OK when the key is present. If chat works but you hear nothing, open the browser **developer console** — failed `/api/tts` and autoplay blocks are logged — and **click the page once** before the reply finishes (autoplay policy).

## Key Integrations

- **CRM database** -- Kanban, workflows, packages, human-tasks (PostgreSQL service **`crm-db`** in Compose)
- **LinkedIn (Unipile)** -- Message sync, connection polling, inbound webhooks. The Next.js app reads **`UNIPILE_API_KEY`**, **`UNIPILE_DSN`** (host:port, e.g. `api32.unipile.com:16299`), and **`UNIPILE_ACCOUNT_ID`** from **`web/.env.local`** (production Docker already uses that file via `env_file`). Without them, warm-outreach enrichment shows “Unipile is not configured”. Restart **`web`** after editing.
- **Brave Search** -- **`BRAVE_SEARCH_API_KEY`** in **`web/.env.local`** powers **Marni Knowledge Studio** web research (Brave Search API). **Production:** add the same variable to **`/opt/agent-tim/web/.env.local`** on the Command Central droplet (CI does not inject per-key secrets; the file on the server is the source of truth). Restart **`web`** after editing.
- **Google Gemini** -- Embeddings (vector memory, Marni KB) and optional Gemini chat for configured agents; **`GEMINI_API_KEY`** in **`web/.env.local`**
- **NextAuth** -- Authentication (credentials provider)
