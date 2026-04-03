# Using the **bundled** local CRM Postgres (Command Central dev — optional)

**Default LOCALDEV** (`docker-compose.dev.yml`) uses **production droplet CRM** over Tailscale (`100.74.54.12:5432`). The bundled Postgres below is **opt-in**: start Compose with **`--profile bundled-crm-postgres`** and set **`COMMAND-CENTRAL/.env`** to **`CC_DOCKER_CRM_DB_HOST=crm-db`** so `web` uses this container instead.

This `crm-db` service is **not** the droplet. Use it when you want Tim’s queue, Kanban, migrations, and Unipile replay to hit **local data only**.

For how this fits next to **remote droplet CRM** and env layers, see [`LOCAL-ENV-LAYERS.md`](./LOCAL-ENV-LAYERS.md).

## What gets installed

| Item | Value |
|------|--------|
| Compose service | `crm-db` → container **`cc-localdev-crm-db`** |
| Image | `pgvector/pgvector:pg16` |
| Persistent volume | `cc_localdev_crm_data` |
| Init on first create | `docker/crm-db-init` (e.g. `vector` extension) |
| **From Windows (host tools)** | `127.0.0.1:25432` → Postgres port `5432` inside the container |

Credentials come from **`web/.env.local`**: **`CRM_DB_USER`** (default `postgres`), **`CRM_DB_NAME`** (default `default`), **`CRM_DB_PASSWORD`** (required — `docker compose` will error if it is missing).

## Start LOCALDEV with bundled CRM only

From the **COMMAND-CENTRAL** repo root (creates **`cc-localdev-crm-db`** and points `web` at it only if **`CC_DOCKER_CRM_DB_HOST=crm-db`** in **`COMMAND-CENTRAL/.env`**):

```powershell
cd COMMAND-CENTRAL
# In .env: CC_DOCKER_CRM_DB_HOST=crm-db  CC_DOCKER_CRM_DB_PORT=5432
docker compose --env-file web/.env.local -f docker-compose.dev.yml --profile bundled-crm-postgres up -d
```

**Important:** Do **not** use **`dev-docker-up.ps1 -UseRemoteCrm`** when you want this local database. That mode merges **`docker-compose.dev-remote-crm.yml`** and points the app at **`host.docker.internal`** (tunnel/bridge).

App URL: **http://localhost:3010** (LOCALDEV).

## How the Next.js container connects

**Default** `docker-compose.dev.yml` sets **`CRM_DB_HOST=100.74.54.12`** and **`CRM_DB_PORT=5432`** on **`web`** (droplet over Tailscale). **`CC_DOCKER_CRM_DB_*`** in **`COMMAND-CENTRAL/.env`** overrides that. Profile **`bundled-crm-postgres`** + **`CC_DOCKER_CRM_DB_HOST=crm-db`** uses bundled Postgres instead.

## Run SQL from your PC (`db:exec`, `psql`, backups)

**Droplet (default):** use `CRM_DB_*` from `web/.env.local` (e.g. `100.74.54.12:5432`). **Bundled DB:** `127.0.0.1:25432` only with profile `bundled-crm-postgres`.

```powershell
cd COMMAND-CENTRAL\web
npm run check-crm-db
npm run db:exec -- scripts/migrate-marni-kb.sql
```

See **`web/scripts/db-exec.mjs`** if env precedence is unclear for a given command.

## New volume = mostly empty

The first time the volume is created you do **not** get a full Twenty workspace (`person`, `_workflow_item`, Kanban boards, etc.) until you:

1. **Restore** a `pg_dump` / backup into this instance, and/or  
2. Run **checked-in migrations** / seeds your team relies on, and/or  
3. Use **`docker-compose.local-prod-desktop.yml`** for a fuller local stack (different ports — see [`LOCAL-ENV-LAYERS.md`](./LOCAL-ENV-LAYERS.md)).

Until then, empty boards or API errors are normal.

## Unipile replay against local CRM

Replay **writes** workflow rows. It is **allowed** when:

- `CRM_DB_HOST` is **loopback** (`127.0.0.1`, `localhost`, `::1`) — e.g. replay CLI on the host with port **25432**, or  
- `CRM_DB_HOST` is **`crm-db`** — e.g. replay running inside the LOCALDEV **web** container, or  
- You set **`UNIPILE_REPLAY_ALLOW_REMOTE_CRM=1`** for a deliberate non-production remote database (avoid on production servers).

It is **refused** for **`host.docker.internal`** and other remote-style hosts unless the override is set. See **`web/.env.local.example`** and **`web/lib/unipile-replay-crm-guard.ts`**.

**Host:** run replay with `CRM_DB_HOST=127.0.0.1` and `CRM_DB_PORT=25432` so mutations go to the bundled DB, not a tunnel to production.

## Verify connectivity

```powershell
docker compose --env-file web/.env.local -f docker-compose.dev.yml exec web npm run check-crm-db
```

(from **COMMAND-CENTRAL**, same compose file as above)
