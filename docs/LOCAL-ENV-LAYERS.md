# Local LOCALDEV vs LOCALPROD (Command Central)

Two **ports** and **labels** (sidebar + document title):

| Mode | Port | UI label | How to run |
|------|------|----------|------------|
| **LOCALDEV** | **3010** | `LOCALDEV` (sidebar + title) | `npm run dev` or **`docker-compose.dev.yml`** → **http://localhost:3010** |
| **LOCALPROD** | **3001** | `LOCALPROD` | `npm run local-prod` (build + `next start`) → **http://localhost:3001** |

Set by **`NEXT_PUBLIC_CC_RUNTIME_LABEL`** (`cross-env` in **`package.json`** scripts, or Docker dev compose). Production droplet **does not** set it — branding stays **Strattegys Command Central** / **Agent Team**.

## Env files

| File | Role |
|------|------|
| **`web/.env.local`** | Baseline secrets (e.g. Bitwarden pull). For **LOCALPROD** on the host, keep **`NEXTAUTH_URL` / `AUTH_URL`** as **`http://localhost:3001`**. |
| **`web/.env.development.local`** | Overrides for **`next dev` only**. For **LOCALDEV** on the host, set **`NEXTAUTH_URL`** and **`AUTH_URL`** to **`http://localhost:3010`** so cookies match the dev port. Docker dev overrides those via compose. |

## Docker dev (LOCALDEV in Docker Desktop)

**`docker-compose.dev.yml`** sets Compose project name **`cc-localdev`**, **`cc-localdev-p3010`** (Next), and **`cc-localdev-crm-db`** (Postgres). It publishes **3010**, sets auth URLs to **`http://localhost:3010`**, and **`NEXT_PUBLIC_CC_RUNTIME_LABEL=LOCALDEV`**.

### CRM / “data platform” strategy

| Approach | When to use | Stability |
|----------|-------------|-----------|
| **Bundled `crm-db` (default)** | Everyday UI and app work; run **`docker compose --env-file web/.env.local -f docker-compose.dev.yml up -d`** or **`.\scripts\dev-docker-up.ps1`**. Postgres is also on **`127.0.0.1:25432`** for host tools (`db:exec`, `pg_restore`). Compose caps DB RAM at **~1 GiB**. Step-by-step: **[`LOCAL-CRM-DATABASE.md`](./LOCAL-CRM-DATABASE.md)**. | High — no Tailscale/SSH for the default path. |
| **Remote droplet DB** | You need **live** production CRM data in LOCALDEV. | Lower — depends on tailnet, tunnel, and server expose script. Use **`.\scripts\dev-docker-up.ps1 -UseRemoteCrm`**. |

Bundled Postgres starts with an **empty** data directory (plus init scripts under **`docker/crm-db-init`**). Restore a **`pg_dump`** from production when you need real Kanban data, or run the **LOCALPROD** Docker stack for a second full local copy.

## Persistence: droplet vs laptop (architecture)

Treat the **Command Central droplet** as the **durable place** for **CRM Postgres** (workflows, Kanban, packages, human-tasks, Suzi reminder rows, **pgvector** tables such as `_memory`) and for **always-on** app + proxy (web, Caddy, webhooks, heartbeat). You can de-emphasize “full prod UI on the public URL” in your head if you want — the important part is **that Postgres volume and backups** keep existing.

| Data | Where it lives | LOCALPROD on your PC |
|------|----------------|----------------------|
| CRM + vector memory | **Postgres on the droplet** | Same DB via **SSH tunnel** → `host.docker.internal:5433` (see below). **`web/.env.local`** DB name/user/password must match the server. |
| Agent **chat transcripts** (JSONL) + **MEMORY.md** / daily summaries | **Disk** under **`COMMAND-CENTRAL/agents/`** (`.suzibot`, `.nanobot`, …) on **whichever machine runs the app** | Bind-mounted into Docker; **not** inside Postgres. The droplet has **its own** `agents/` tree — it is **not** auto-synced with your laptop. |
| NextAuth session cookies | Browser + **`AUTH_SECRET` / `NEXTAUTH_SECRET`** | Use **stable** secrets in **`web/.env.local`**; changing them **signs everyone out** (does not delete CRM data). |

**Why Suzi “lost” chat after a change:** CRM reminders may have come back from a different Postgres; **chat history is the JSONL files**. Older LOCALPROD used a separate folder **`sessions/localprod/`**; production-shaped paths are **`sessions/web_govind.jsonl`** (no extra segment). Current LOCALPROD matches production paths. If you still have files under **`agents/**/sessions/localprod/`**, run **`.\scripts\merge-localprod-profile-sessions.ps1`** (use **`-WhatIf`** first to preview).

## Full stack locally (LOCALPROD in Docker Desktop)

On your **PC only**, add the overlay so Docker Desktop shows project **`cc-localprod`** and containers **`cc-localprod-p3001`** (Next app), **`cc-localprod-crm-stub`** (no Postgres data — satisfies Compose only), **`cc-localprod-caddy`**.

**LOCALPROD uses the same CRM database as the Command Central droplet**, not a second Postgres on your laptop. Before `up`, start a forwarder on the host (default **`127.0.0.1:5433`** → server **`127.0.0.1:5432`**):

```powershell
.\scripts\localprod-crm-tunnel.ps1
```

Leave that window open, then **`.\scripts\docker-local-prod-desktop-up.ps1`**. The **web** container uses **`CRM_DB_HOST=host.docker.internal`** and **`CRM_DB_PORT`** (default **5433**, overridable with **`CRM_LOCALPROD_DB_PORT`**). **`CRM_DB_PASSWORD`** / **`CRM_DB_NAME`** / **`CRM_DB_USER`** in **`web/.env.local`** must match the **droplet** CRM (same as production).

From the host, **`npm run db:exec`** with **`CRM_DB_HOST=127.0.0.1`** and **`CRM_DB_PORT=5433`** (or your tunnel port) hits the same data. Caddy still serves **http://localhost** on port **80**.

**Local dev** ( **`docker-compose.dev.yml`** ) continues to use **bundled** Postgres on **`127.0.0.1:25432`** — that is the laptop-only database.

```powershell
cd COMMAND-CENTRAL
.\scripts\docker-local-prod-desktop-up.ps1
```

Stop:

```powershell
.\scripts\docker-local-prod-desktop-down.ps1
```

Or manually:

```bash
docker compose --env-file web/.env.local -f docker-compose.yml -f docker-compose.local-prod-desktop.yml up -d --build
```

The overlay sets **localhost** auth URLs and bakes **LOCALPROD** into the **web** image. **Do not** copy **`docker-compose.local-prod-desktop.yml`** to the droplet — production uses **`docker-compose.yml`** only.

**If chat history looks empty in LOCALPROD:** (1) Open the app at **`http://localhost:3001`** (not **`127.0.0.1`**) so session cookies match **`NEXTAUTH_URL`**. (2) Rebuild the web image after compose changes: **`.\scripts\docker-local-prod-desktop-down.ps1`** then **`.\scripts\docker-local-prod-desktop-up.ps1`**. (3) If **`web/.env.local`** sets **`CC_AGENT_CHAT_PROFILE`** (e.g. from a shared Bitwarden pull for dev), the overlay now forces it **empty** for LOCALPROD so paths match **`agents/.suzibot/.../sessions/web_govind.jsonl`**.

**`npm run local-prod`** (no Docker) is still valid for a quick production-mode check without Caddy or the bundled Postgres.

## Bitwarden

Pull baseline into **`web/.env.local`**. Optional dev-only SM project → **`web/.env.development.local`**.

## Project Server

Strattegys **site** is unchanged (still **3002** for dev). This doc is Command Central only.
