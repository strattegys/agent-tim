# Stop full Command Central LOCALPROD stack (Docker Desktop project **cc-localprod**).
# Run from COMMAND-CENTRAL:  .\scripts\docker-local-prod-desktop-down.ps1

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path $PSScriptRoot -Parent
Set-Location $RepoRoot

if (-not (Test-Path (Join-Path $RepoRoot "web\.env.local"))) {
  Write-Error "Missing web\.env.local — create it first (see web\.env.local.example)."
  exit 1
}

docker compose --env-file web/.env.local -f docker-compose.yml -f docker-compose.local-prod-desktop.yml down
Write-Host "cc-localprod stack stopped."
