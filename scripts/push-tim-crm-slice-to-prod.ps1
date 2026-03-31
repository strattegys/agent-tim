# Push Tim-owned CRM rows from LOCALDEV bundled Postgres (cc-localdev-crm-db) to production.
# Does NOT replace the whole database - only workflows where ownerAgent = tim, plus their boards,
# packages, pipeline people, items, and artifacts. See web/scripts/migrate-tim-crm-slice.mjs
#
# Requires: LOCALDEV crm-db up (127.0.0.1:25432), Tailscale (or set CRM_MIGRATE_TARGET_HOST),
# matching passwords in web/.env.local or set CRM_MIGRATE_SOURCE_PASSWORD / CRM_MIGRATE_TARGET_PASSWORD.
#
#   .\scripts\push-tim-crm-slice-to-prod.ps1           # dry-run
#   .\scripts\push-tim-crm-slice-to-prod.ps1 -Apply

param([switch] $Apply)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path $PSScriptRoot -Parent
Set-Location (Join-Path $RepoRoot "web")

$env:CRM_MIGRATE_SOURCE_HOST = "127.0.0.1"
$env:CRM_MIGRATE_SOURCE_PORT = if ($env:CRM_DB_LOCAL_PORT) { $env:CRM_DB_LOCAL_PORT } else { "25432" }
$env:CRM_MIGRATE_TARGET_HOST = if ($env:CRM_DB_TAILSCALE_HOST) { $env:CRM_DB_TAILSCALE_HOST.Trim() } elseif ($env:CC_TAILSCALE_IP) { $env:CC_TAILSCALE_IP.Trim() } else { "100.74.54.12" }
$env:CRM_MIGRATE_TARGET_PORT = "5432"

$npmArgs = @("run", "migrate:tim-crm-slice", "--")
if (-not $Apply) {
  $npmArgs += "--dry-run"
}

& npm @npmArgs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
if (-not $Apply) {
  Write-Host ""
  Write-Host "Dry-run only. Re-run with -Apply to write to production." -ForegroundColor Cyan
}
