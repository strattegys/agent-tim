# Start full Command Central stack locally with Docker Desktop labels: project **cc-localprod**, containers **cc-localprod-web**, etc.
# Run from COMMAND-CENTRAL:  .\scripts\docker-local-prod-desktop-up.ps1
#
# Uses docker-compose.local-prod-desktop.yml (do not deploy that file to the droplet). Rebuilds **web** with LOCALPROD branding.
# Open http://localhost:3001 (via Caddy http://localhost if Caddyfile includes localhost).

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path $PSScriptRoot -Parent
Set-Location $RepoRoot

if (-not (Test-Path (Join-Path $RepoRoot "web\.env.local"))) {
  Write-Error "Missing web\.env.local — create it first (see web\.env.local.example)."
  exit 1
}

docker compose --env-file web/.env.local -f docker-compose.yml -f docker-compose.local-prod-desktop.yml up -d --build
Write-Host ""
Write-Host "Docker Desktop: project **cc-localprod** — containers cc-localprod-web, cc-localprod-crm-db, cc-localprod-caddy"
Write-Host "App: http://localhost:3001 (or via Caddy on :80 per Caddyfile)"
