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

$crmHost = if ($env:CC_LOCALPROD_CRM_HOST) { $env:CC_LOCALPROD_CRM_HOST.Trim() }
  elseif ($env:CRM_LOCALPROD_DB_HOST) { $env:CRM_LOCALPROD_DB_HOST.Trim() }
  else { "100.74.54.12" }
$crmPort = if ($env:CC_LOCALPROD_CRM_PORT) { [int]$env:CC_LOCALPROD_CRM_PORT }
  elseif ($env:CRM_LOCALPROD_DB_PORT) { [int]$env:CRM_LOCALPROD_DB_PORT }
  else { 5432 }
$usingTailscale = ($crmHost -match '^100\.')

if ($usingTailscale) {
  Write-Host "Checking Tailscale CRM at $($crmHost):$crmPort..." -ForegroundColor Gray
  $ok = $false
  for ($i = 0; $i -lt 4; $i++) {
    if (Test-TcpOpen $crmHost $crmPort 6000) { $ok = $true; break }
    if ($i -lt 3) {
      Write-Host "  Retry $($i + 1)/3 in 5s (tailnet or droplet may still be settling)..." -ForegroundColor DarkGray
      Start-Sleep -Seconds 5
    }
  }
  if ($ok) {
    Write-Host "Tailscale CRM reachable ($($crmHost):$crmPort) - direct connection (no bridge/tunnel)." -ForegroundColor Cyan
  } else {
    Write-Warning "Tailscale CRM at $($crmHost):$crmPort is not reachable after retries."
    Write-Host "  Server: cd /opt/agent-tim && bash tools/expose-crm-db-tailscale.sh" -ForegroundColor Yellow
    Write-Host "  Server (long-term): sudo bash tools/install-crm-db-tailscale-refresh-timer.sh" -ForegroundColor Yellow
    Write-Host "  This PC: Tailscale connected? Fallback: CRM_LOCALPROD_DB_HOST=host.docker.internal CRM_LOCALPROD_DB_PORT=5433 + .\scripts\localprod-crm-tunnel.ps1" -ForegroundColor Yellow
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
