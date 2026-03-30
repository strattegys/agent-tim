# Bitwarden Secrets Manager

Use [Bitwarden Secrets Manager](https://bitwarden.com/products/secrets-manager/) as the **source of truth** for secrets. Apps still read **`web/.env.local`** (Command Central) or **`site/.env.local`** (Project Server) on disk; BWS **renders** those files from SM projects.

**Do not** commit tokens, rendered env files, or secret values. Variable **names** only in git.

This guide covers **both** Command Central and Project Server. The pull scripts live in **this repo** (`scripts/bws-pull-env.*`); use **`-OutFile`** to point at any path (including a sibling **`PROJECT-SERVER/site/.env.local`** in the DEV-MASTER workspace).

## Prerequisites

1. Bitwarden **organization** with **Secrets Manager**.
2. [Secrets Manager CLI (`bws`)](https://bitwarden.com/help/secrets-manager-cli/) on your PATH — [releases](https://github.com/bitwarden/sdk-sm/releases) or `docker run ghcr.io/bitwarden/bws`.
3. **Machine accounts** (recommended — least privilege):
   - Laptop dev: read **local** SM projects only.
   - Command Central droplet: read **CC production** project only.
   - Project Server droplet: read **PS production** project only.

Set **`BWS_ACCESS_TOKEN`** (or **`bws ... --access-token`**). See [Access tokens](https://bitwarden.com/help/access-tokens/) and [Machine accounts](https://bitwarden.com/help/machine-accounts/).

**EU / self-hosted:** Configure identity/API URLs per [server geographies](https://bitwarden.com/help/server-geographies/) (check `bws --help` for env var names on your CLI version).

## Projects (recommended)

| SM project (name) | Purpose | Typical `-OutFile` |
|-------------------|---------|---------------------|
| `command-central-local` | CC laptop / Docker dev | `web\.env.local` (from this repo root) |
| `command-central-production` | CC droplet `/opt/agent-tim` | `/opt/agent-tim/web/.env.local` |
| `project-server-local` | PS laptop | `..\PROJECT-SERVER\site\.env.local` (sibling folder) or absolute path |
| `project-server-production` | PS droplet | **`/opt/project-server/.env`** (root — see **PROJECT-SERVER/docs/BITWARDEN-SECRETS.md**; prod Compose does not use `site/.env.local`) |

Store UUIDs in **`bws.secret-projects.json`** on each machine (see **`bws.secret-projects.json.example`** in this repo). Copy to **`bws.secret-projects.json`** and gitignore it (already ignored here).

## Secret keys

Each secret **key** in Bitwarden must be the **exact** env var name (`CRM_DB_PASSWORD`, `AUTH_SECRET`, …). Use **ASCII letters, digits, `_`**; start with a letter or `_`. See [CLI `run`](https://bitwarden.com/help/secrets-manager-cli/).

Use **`web/.env.local.example`** (Command Central) and **`PROJECT-SERVER/site/.env.local.example`** as checklists. Non-secret defaults (e.g. `CRM_DB_HOST` for Docker dev) can live in a gitignored fragment or as separate SM secrets.

## Render `.env.local` (PowerShell)

From **COMMAND-CENTRAL** repo root:

```powershell
$env:BWS_ACCESS_TOKEN = '<machine-account-token>'
.\scripts\bws-pull-env.ps1 -ProjectId '<uuid>' -OutFile 'web\.env.local'
.\scripts\bws-pull-env.ps1 -ProjectId '<uuid>' -OutFile '..\PROJECT-SERVER\site\.env.local'
```

## Render `.env.local` (Bash)

```bash
export BWS_ACCESS_TOKEN='...'
./scripts/bws-pull-env.sh '<uuid>' web/.env.local
./scripts/bws-pull-env.sh '<uuid>' ../PROJECT-SERVER/site/.env.local
```

Scripts run:

`bws secret list <PROJECT_ID> --output env`

If that argument order fails, run `bws secret list --help` and adjust flag placement. Invalid key names are **commented out** in `env` output — fix names in Bitwarden to match **`.env.local.example`**.

## `bws run` (no file on disk)

Only run trusted commands:

```bash
bws run --project-id '<uuid>' -- 'docker compose -f docker-compose.dev.yml up'
```

On Windows, `bws run` defaults to PowerShell.

## Droplets

1. Install **`bws`** on the host.
2. Store token in e.g. **`/root/.config/bws/access_token`** mode **600**.
3. Before or after deploy, render env and restart:

```bash
export BWS_ACCESS_TOKEN=$(cat /root/.config/bws/access_token)
/opt/agent-tim/scripts/bws-pull-env.sh '<uuid>' /opt/agent-tim/web/.env.local
cd /opt/agent-tim && docker compose --env-file web/.env.local -f docker-compose.yml up -d
```

Project Server: use **`/opt/project-server/scripts/bws-pull-env.sh`** and target **repo-root** **`/opt/project-server/.env`** on the droplet (production Compose + Postgres substitution). See **`PROJECT-SERVER/docs/BITWARDEN-SECRETS.md`**.

## GitHub Actions (optional)

Add **`BWS_ACCESS_TOKEN`** as a GitHub Actions secret and run **`bws-pull-env`** before build, using a **narrow** machine account. Prefer placeholders for pure `tsc`/`next build` unless you need real keys in CI.

## Rotation

1. Update the value in Bitwarden (same key).
2. Re-run **`bws-pull-env`** on each machine that materializes `.env.local`.
3. **`docker compose restart web`** (and other consumers).

## References

- [Secrets Manager CLI](https://bitwarden.com/help/secrets-manager-cli/)
- [Access tokens](https://bitwarden.com/help/access-tokens/)
- [Projects](https://bitwarden.com/help/projects/)
