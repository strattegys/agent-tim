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
Next.js (LOCALDEV **3010** / LOCALPROD **3001**)  <- Command Central web UI (sole interface)
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

**Recommended (Docker LOCALDEV, hot reload on port 3010):**

```bash
cd COMMAND-CENTRAL   # repo root containing docker-compose.dev.yml
docker compose --env-file web/.env.local -f docker-compose.dev.yml up -d
```

Or **`.\scripts\dev-docker-up.ps1`** (same thing; bundled CRM Postgres, no tunnel). Then open **http://localhost:3010** (LOCALDEV; hot reload via mounted `web/`). Docker Desktop shows project **`cc-localdev`**, **`cc-localdev-p3010`**, and **`cc-localdev-crm-db`**. Uses **`web/.env.local`** + optional **`web/.env.development.local`**. **Using the installed local CRM Postgres** (ports, `db:exec`, Unipile replay): [`docs/LOCAL-CRM-DATABASE.md`](docs/LOCAL-CRM-DATABASE.md). **LOCALPROD:** from **`web/`** run **`npm run local-prod`** (Node on **3001**), or full Docker stack (Next + Postgres + Caddy): **`.\scripts\docker-local-prod-desktop-up.ps1`** → **http://localhost:3001** (project **`cc-localprod`**, container **`cc-localprod-p3001`**). Stop: **`.\scripts\docker-local-prod-desktop-down.ps1`**. See [`docs/LOCAL-ENV-LAYERS.md`](docs/LOCAL-ENV-LAYERS.md).

**Optional (Node on the host, same port as Docker):**

```bash
cd web
npm install
cp .env.local.example .env.local  # Fill in API keys
npm run dev                        # LOCALDEV http://localhost:3010
npm run local-prod                 # LOCALPROD http://localhost:3001 (build + start)
```

Do **not** run two servers on the **same** port (e.g. LOCALPROD on 3001 vs anything else on 3001). LOCALDEV uses **3010** so it can run alongside LOCALPROD on **3001** if needed.

### LOCALPROD after pushing to GitHub

GitHub Actions updates the **droplet**; your **Docker LOCALPROD** image on this PC does **not** update until you rebuild. **Restart** in Docker Desktop is **not** sufficient (same image layers).

From the **`COMMAND-CENTRAL`** repo root:

```powershell
.\scripts\pull-master-and-localprod-up.ps1
```

That **fast-forwards `master`** from **`origin`** and runs **`docker-local-prod-desktop-up.ps1`** (includes **`docker compose ... up -d --build`**). Use this after merges to **`master`** when you want **http://localhost:3001** to match what you shipped.

### CRM Postgres (Kanban, workflow builder, real CRM data)

Workflows and Kanban read/write **PostgreSQL** via [`web/lib/db.ts`](web/lib/db.ts). If **`CRM_DB_PASSWORD`** is missing, the app uses an in-memory **`.dev-store/`** — fine for UI experiments, but **pipelines will be empty or fake**.

**Local dev (Docker on your PC) — default: bundled Postgres**

1. Add **`CRM_DB_PASSWORD`** (and other **`CRM_DB_*`** as in production) to **`web/.env.local`**. The same password is used for the bundled **`crm-db`** container. See [`web/.env.local.example`](web/.env.local.example). Optional: Bitwarden — [`docs/BITWARDEN-SECRETS.md`](docs/BITWARDEN-SECRETS.md) and [`scripts/bws-pull-env.ps1`](scripts/bws-pull-env.ps1).
2. **[`docker-compose.dev.yml`](docker-compose.dev.yml)** starts **`crm-db`** (pgvector, same image as production). **`web`** uses **`CRM_DB_HOST=crm-db`** and **`CRM_DB_PORT=5432`**. For host-side **`pg_restore`** / **`npm run db:exec`**, Postgres is on **`127.0.0.1:25432`** (compose also caps DB memory ~**1 GiB**). This default path does **not** use Tailscale or SSH. **LOCALPROD Docker** ([`docker-compose.local-prod-desktop.yml`](docker-compose.local-prod-desktop.yml)) does **not** use bundled CRM data: **`web`** talks to the **droplet** Postgres via **`host.docker.internal`** and a host tunnel (default **`127.0.0.1:5433`**). Start **`scripts/localprod-crm-tunnel.ps1`**, then **`scripts/docker-local-prod-desktop-up.ps1`**. See [`docs/LOCAL-ENV-LAYERS.md`](docs/LOCAL-ENV-LAYERS.md).
3. **Empty database:** a new volume only runs `docker/crm-db-init` (e.g. `vector` extension). The Twenty **workspace** schema and rows come from a **`pg_dump` / `pg_restore`** of production, or use **`.\scripts\docker-local-prod-desktop-up.ps1`** for another full local stack that shares the same pattern. Until you restore, Kanban/APIs that expect tables may error — that is a data issue, not a flaky tunnel.
4. **Live droplet CRM (optional):** **`.\scripts\dev-docker-up.ps1 -UseRemoteCrm`** starts the Tailscale TCP bridge or SSH tunnel (**`0.0.0.0:5433`** → server **:5432**) and merges **[`docker-compose.dev-remote-crm.yml`](docker-compose.dev-remote-crm.yml)** so **`web`** uses **`host.docker.internal:5433`**. Flags **`-UseSshTunnel`** / **`-UseTailscaleBridge`** apply together with **`-UseRemoteCrm`**. On the server, **`tools/expose-crm-db-tailscale.sh`** (re-run from deploy) keeps Postgres reachable on the tailnet. Reconnect after sleep: **`cd web && npm run db:reconnect`** (forwarder only — irrelevant if you use bundled **`crm-db`** only). Optional: set **`CC_DOCKER_CRM_DB_HOST`** / **`CC_DOCKER_CRM_DB_PORT`** when running compose if the container can reach the tailnet directly.
5. **SSH tunnel (manual alternative for remote CRM):** **`ssh -L 0.0.0.0:5433:localhost:5432 root@<CC-host>`** then **`-UseRemoteCrm`** or **`scripts/crm-db-tunnel.ps1`**. **`CRM_DB_HOST=127.0.0.1`** + **`CRM_DB_PORT=5433`** in **`.env.local`** is for **`npm run dev` on the host** (no Docker) with that forwarder.
6. Verify: **`cd web && npm run check-crm-db`**. From the dev container: **`docker compose --env-file web/.env.local -f docker-compose.dev.yml exec web npm run check-crm-db`**.
7. Recreate after env changes: **`docker compose --env-file web/.env.local -f docker-compose.dev.yml up -d --force-recreate`**

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
