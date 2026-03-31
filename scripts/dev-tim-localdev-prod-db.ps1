# LOCALDEV (hot reload) + production Command Central CRM Postgres.
# Run from COMMAND-CENTRAL:  .\scripts\dev-tim-localdev-prod-db.ps1
#
# Starts the same stack as:  .\scripts\dev-docker-up.ps1 -UseRemoteCrm
# - App: http://localhost:3010  (Next dev in Docker, webpack + polling)
# - Web container uses host.docker.internal:5433 -> droplet crm-db (via Tailscale bridge or SSH tunnel)
#
# Prerequisites:
# - web/.env.local with CRM_DB_* matching production (password, user, database name)
# - Tailscale on this PC, droplet Postgres exposed on tailnet (see PROJECT-MEMORY Tailscale table),
#   OR SSH access so the script can open -L 0.0.0.0:5433 -> droplet :5432
#
# Important: This is LIVE production data. In-app actions and direct SQL (npm run db:exec) affect prod.

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path $PSScriptRoot -Parent
Set-Location $RepoRoot

& (Join-Path $PSScriptRoot "dev-docker-up.ps1") -UseRemoteCrm
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host ""
Write-Host "Tim-focused URLs (bookmark one):" -ForegroundColor Cyan
Write-Host "  Work queues:  http://localhost:3010/?agent=tim&panel=messages"
Write-Host "  Tim lab UI:   http://localhost:3010/?timLab=1   (no sidebar, wider system rail, Unipile + Groq log dock)"
Write-Host "  Knowledge:    http://localhost:3010/?agent=tim&panel=knowledge"
Write-Host "Production SQL from this PC:" -ForegroundColor DarkGray
Write-Host "  - After this script, host port 5433 forwards to droplet Postgres. From web/:"
Write-Host "      `$env:CRM_DB_HOST='127.0.0.1'; `$env:CRM_DB_PORT='5433'; npm run db:exec -- -e `"SELECT 1`""
Write-Host "  - Or connect with any Postgres client to 127.0.0.1:5433 (same CRM_DB_* as .env.local)."
Write-Host ""
