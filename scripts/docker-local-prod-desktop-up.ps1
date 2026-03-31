# Start full Command Central LOCALPROD stack: project **cc-localprod**, Next production build, Caddy.
# CRM data comes from the **DigitalOcean Command Central droplet** via a host tunnel — not bundled Postgres.
#
# Before first up: in another window run  .\scripts\localprod-crm-tunnel.ps1  (or any SSH -L to 127.0.0.1:5433).
#
# Run from COMMAND-CENTRAL:  .\scripts\docker-local-prod-desktop-up.ps1

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path $PSScriptRoot -Parent
Set-Location $RepoRoot

if (-not (Test-Path (Join-Path $RepoRoot "web\.env.local"))) {
  Write-Error "Missing web\.env.local - create it first (see web\.env.local.example)."
  exit 1
}

$tunnelPort = if ($env:CRM_LOCALPROD_DB_PORT) { [int]$env:CRM_LOCALPROD_DB_PORT } else { 5433 }
try {
  $tcp = Test-NetConnection -ComputerName 127.0.0.1 -Port $tunnelPort -WarningAction SilentlyContinue -ErrorAction SilentlyContinue
  if (-not $tcp.TcpTestSucceeded) {
    Write-Warning "Nothing is listening on 127.0.0.1:$tunnelPort - the app will fail DB checks until a tunnel is up."
    Write-Host "  Start:  .\scripts\localprod-crm-tunnel.ps1" -ForegroundColor Yellow
    Write-Host '  (Uses CRM_LOCALPROD_DB_PORT if set; default 5433.)' -ForegroundColor Gray
  }
} catch {
  Write-Warning "Could not probe 127.0.0.1:$tunnelPort - ensure a droplet CRM tunnel is running if the app errors on DB."
}

docker compose --env-file web/.env.local -f docker-compose.yml -f docker-compose.local-prod-desktop.yml up -d --build
Write-Host ""
Write-Host 'LOCALPROD (Docker Desktop project cc-localprod):'
Write-Host '  Web: cc-localprod-p3001  ->  http://localhost:3001'
Write-Host "  CRM: droplet Postgres via host tunnel 127.0.0.1:$tunnelPort -> web uses host.docker.internal:$tunnelPort"
Write-Host '  Tunnel: .\scripts\localprod-crm-tunnel.ps1  (separate window)'
Write-Host '  Check DB: docker compose --env-file web/.env.local -f docker-compose.yml -f docker-compose.local-prod-desktop.yml exec web npm run check-crm-db'
Write-Host '  Also: http://localhost (Caddy)  |  Proxy: cc-localprod-caddy'
Write-Host ('Stop: ' + (Join-Path $RepoRoot 'scripts\docker-local-prod-desktop-down.ps1'))
