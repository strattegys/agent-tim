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

## Docker dev

**`docker-compose.dev.yml`** publishes **3010**, sets **`AUTH_URL` / `NEXTAUTH_URL`** to **`http://localhost:3010`**, and **`NEXT_PUBLIC_CC_RUNTIME_LABEL=LOCALDEV`**.

## Full stack locally

**`docker compose --env-file web/.env.local -f docker-compose.yml up`** still matches the droplet (Caddy + **`crm-db`**, internal port **3001**). That is not the same as **LOCALPROD** `npm run local-prod` (no Caddy in that command).

## Bitwarden

Pull baseline into **`web/.env.local`**. Optional dev-only SM project → **`web/.env.development.local`**.

## Project Server

Strattegys **site** is unchanged (still **3002** for dev). This doc is Command Central only.
