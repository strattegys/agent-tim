# Start full Command Central LOCALPROD stack: project **cc-localprod**, Next production build, Caddy.
# CRM data comes from the **DigitalOcean Command Central droplet** — default path is direct Tailscale
# (container routes to 100.74.54.12:5432, no bridge/tunnel needed).
#
# Fallback: set CRM_LOCALPROD_DB_HOST=host.docker.internal / CRM_LOCALPROD_DB_PORT=5433 and run
# .\scripts\localprod-crm-tunnel.ps1 in another window.
#
# Run from COMMAND-CENTRAL:  .\scripts\docker-local-prod-desktop-up.ps1

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path $PSScriptRoot -Parent
Set-Location $RepoRoot

if (-not (Test-Path (Join-Path $RepoRoot "web\.env.local"))) {
  Write-Error "Missing web\.env.local - create it first (see web\.env.local.example)."
  exit 1
}

function Test-TcpOpen([string]$Hostname, [int]$Port, [int]$TimeoutMs = 5000) {
  try {
    $client = New-Object System.Net.Sockets.TcpClient
    $iar = $client.BeginConnect($Hostname, $Port, $null, $null)
    if (-not $iar.AsyncWaitHandle.WaitOne($TimeoutMs, $false)) {
      try { $client.Close() } catch { }
      return $false
    }
    $client.EndConnect($iar)
    $client.Close()
    return $true
  } catch {
    return $false
  }
}

$crmHost = if ($env:CRM_LOCALPROD_DB_HOST) { $env:CRM_LOCALPROD_DB_HOST.Trim() } else { "100.74.54.12" }
$crmPort = if ($env:CRM_LOCALPROD_DB_PORT) { [int]$env:CRM_LOCALPROD_DB_PORT } else { 5432 }
$usingTailscale = ($crmHost -match '^100\.')

if ($usingTailscale) {
  Write-Host "Checking Tailscale CRM at $($crmHost):$crmPort..." -ForegroundColor Gray
  if (Test-TcpOpen $crmHost $crmPort) {
    Write-Host "Tailscale CRM reachable ($($crmHost):$crmPort) - direct connection (no bridge/tunnel)." -ForegroundColor Cyan
  } else {
    Write-Warning "Tailscale CRM at $($crmHost):$crmPort is not reachable."
    Write-Host "  Check: Is Tailscale running? Has expose-crm-db-tailscale.sh been run on the server?" -ForegroundColor Yellow
    Write-Host "  Fallback: set CRM_LOCALPROD_DB_HOST=host.docker.internal CRM_LOCALPROD_DB_PORT=5433 and run:" -ForegroundColor Yellow
    Write-Host "    .\scripts\localprod-crm-tunnel.ps1  (separate window)" -ForegroundColor Yellow
  }
} else {
  Write-Host "CRM target: $($crmHost):$crmPort (custom/bridge mode)" -ForegroundColor Cyan
  if (-not (Test-TcpOpen $crmHost $crmPort)) {
    Write-Warning "Nothing reachable at $($crmHost):$crmPort - the app will fail DB checks until a tunnel/bridge is up."
  }
}

docker compose --env-file web/.env.local -f docker-compose.yml -f docker-compose.local-prod-desktop.yml up -d --build
Write-Host ""
Write-Host 'LOCALPROD (Docker Desktop project cc-localprod):'
Write-Host "  Web: cc-localprod-p3001  ->  http://localhost:3001"
Write-Host "  CRM: droplet Postgres at $($crmHost):$crmPort$(if ($usingTailscale) { ' (direct Tailscale)' } else { '' })"
Write-Host '  Check DB: docker compose --env-file web/.env.local -f docker-compose.yml -f docker-compose.local-prod-desktop.yml exec web npm run check-crm-db'
Write-Host '  Also: http://localhost (Caddy)  |  Proxy: cc-localprod-caddy'
Write-Host ('Stop: ' + (Join-Path $RepoRoot 'scripts\docker-local-prod-desktop-down.ps1'))
