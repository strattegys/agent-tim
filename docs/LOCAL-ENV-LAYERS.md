# Local “dev” vs “local prod” (Command Central)

Use two files under **`web/`** so day-to-day work does not fight a stable baseline you pull from Bitwarden or copy from production.

## How it works (Next.js)

| File | When it loads | Role |
|------|----------------|------|
| **`web/.env.local`** | All modes | **Baseline** — shared keys, BWS pull target, parity with droplet-ish values. Treat as “do not break my demo / partner test.” |
| **`web/.env.development.local`** | **`next dev` only** | **Playground** — overrides **`.env.local`** for the same variable names. Not loaded by **`next build`** / **`next start`** (production mode). Gitignored. |

Next merges env files so **`development.local` wins over `.local` in dev**. See [Next.js environment variables](https://nextjs.org/docs/app/building-your-application/configuring/environment-variables).

## Typical workflow

1. Keep **`web/.env.local`** as your **stable** file (`bws-pull-env` → here, or one good manual copy).
2. Create **`web/.env.development.local`** (start from **`web/.env.development.local.example`**) only for things you want **different while coding**: experimental model IDs, temporary feature flags, a separate CRM tunnel port, `CHAT_EPHEMERAL_AGENTS`, etc.
3. When **`web/`** is bind-mounted (**`docker-compose.dev.yml`**), both files are visible to **`next dev`** inside the container — no compose change required.

## “Local prod” (sanity check)

**Production mode on your PC** (no `.env.development.local`):

```bash
cd web
npm run build:local-prod
npm run start:local-prod
```

Open **http://localhost:3001**. This approximates a production Node process; it is **not** identical to the full Docker stack (**`docker-compose.yml`** + Caddy + **`crm-db`**). For the closest match to the droplet, run compose locally with **`docker compose --env-file web/.env.local -f docker-compose.yml up`** when you need it.

## Bitwarden

- Pull **baseline** secrets into **`web/.env.local`**.
- Optional second SM project for dev-only keys → pull into **`web/.env.development.local`**:

```powershell
.\scripts\bws-pull-env.ps1 -ProjectId '<dev-project-uuid>' -OutFile 'web\.env.development.local'
```

## Project Server

Same idea under **`site/`**: **`site/.env.local`** + **`site/.env.development.local`** (see **`site/.env.development.local.example`**).
