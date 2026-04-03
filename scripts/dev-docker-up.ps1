# Start Command Central LOCALDEV in Docker Desktop (project **cc-localdev**).
# Run from COMMAND-CENTRAL:  .\scripts\dev-docker-up.ps1
#
# Default: **production droplet CRM** over Tailscale (web container CRM_DB_HOST=100.74.54.12:5432).
# Requires Tailscale + droplet expose-crm-db-tailscale.sh. web/.env.local must set CRM_DB_PASSWORD
# (same as production). Override host: COMMAND-CENTRAL/.env with CC_DOCKER_CRM_DB_* (see .env.docker-dev.example).
#
# Optional empty local Postgres: docker compose ... --profile bundled-crm-postgres up -d
# and set .env CC_DOCKER_CRM_DB_HOST=crm-db CC_DOCKER_CRM_DB_PORT=5432 — see docker-compose.dev.yml header.
# Test from Docker: docker run --rm alpine sh -c "apk add --no-cache postgresql16-client && pg_isready -h YOUR_IP -p 5432"
#
# Remote droplet CRM (fallback):  .\scripts\dev-docker-up.ps1 -UseRemoteCrm
#   Starts Tailscale TCP bridge or SSH tunnel on host 0.0.0.0:5433 -> droplet :5432, then
#   compose with docker-compose.dev-remote-crm.yml so web uses host.docker.internal:5433.
#
#   -UseSshTunnel        With -UseRemoteCrm: always SSH (even if tailnet Postgres responds).
#   -UseTailscaleBridge  With -UseRemoteCrm: always TCP bridge (even if tailnet check fails).
#
# Optional: CRM_SSH_HOST, CRM_DB_TAILSCALE_HOST, CC_TAILSCALE_IP, CRM_TUNNEL_LOCAL_PORT

param(
  [switch]$UseRemoteCrm,
  [switch]$UseSshTunnel,
  [switch]$UseTailscaleBridge
)

$ErrorActionPreference = "Stop"

function Test-TcpOpen([string]$Hostname, [int]$Port, [int]$TimeoutMs = 4000) {
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

$RepoRoot = Split-Path $PSScriptRoot -Parent
if (-not (Test-Path (Join-Path $RepoRoot "docker-compose.dev.yml"))) {
  Write-Error "Run from COMMAND-CENTRAL (docker-compose.dev.yml not found under $RepoRoot)"
  exit 1
}
Set-Location $RepoRoot

# Compose interpolation: when you pass --env-file web/.env.local alone, Docker Compose does not load
# project .env for ${CC_DOCKER_CRM_DB_*:-defaults}. Prepend .env when present so direct tailnet CRM works.
$composeEnvFileArgs = @()
$dotEnv = Join-Path $RepoRoot ".env"
if (Test-Path -LiteralPath $dotEnv) {
  $composeEnvFileArgs += "--env-file", ".env"
}
$composeEnvFileArgs += "--env-file", "web/.env.local"

$envLocal = Join-Path $RepoRoot "web\.env.local"
if (-not (Test-Path -LiteralPath $envLocal)) {
  Write-Error "Missing web\.env.local - create it first (see web\.env.local.example)."
  exit 1
}

if ($UseRemoteCrm) {
  $localPort = if ($env:CRM_TUNNEL_LOCAL_PORT) { $env:CRM_TUNNEL_LOCAL_PORT } else { "5433" }
  $tsHost = if ($env:CRM_DB_TAILSCALE_HOST) { $env:CRM_DB_TAILSCALE_HOST.Trim() } elseif ($env:CC_TAILSCALE_IP) { $env:CC_TAILSCALE_IP.Trim() } else { "100.74.54.12" }
  $remoteSsh = if ($env:CRM_SSH_HOST) { $env:CRM_SSH_HOST } else { $tsHost }

  $tsCrmOpen = Test-TcpOpen $tsHost 5432
  $useBridge = $false
  if ($UseSshTunnel) {
    $useBridge = $false
  } elseif ($UseTailscaleBridge) {
    $useBridge = $true
    if (-not $tsCrmOpen) {
      Write-Host "WARN: $($tsHost):5432 did not respond - bridge may fail until expose-crm-db-tailscale.sh has been run on the server." -ForegroundColor Yellow
    }
  } elseif ($tsCrmOpen) {
    $useBridge = $true
    Write-Host "Tailscale CRM at $($tsHost):5432 is reachable - using TCP bridge (no SSH)." -ForegroundColor Cyan
  } else {
    Write-Host "Tailscale CRM at $($tsHost):5432 not reachable - using SSH tunnel (need key + droplet SSH)." -ForegroundColor Yellow
  }

  $already = Get-NetTCPConnection -LocalPort $localPort -State Listen -ErrorAction SilentlyContinue
  if (-not $already) {
    if ($useBridge) {
      $bridgeScript = Join-Path $RepoRoot "scripts\crm-db-tailscale-bridge.mjs"
      if (-not (Test-Path -LiteralPath $bridgeScript)) {
        Write-Error "Missing $bridgeScript"
        exit 1
      }
      $node = (Get-Command node -ErrorAction Stop).Source
      $env:CRM_DB_TAILSCALE_HOST = $tsHost
      $env:CRM_TUNNEL_LOCAL_PORT = "$localPort"
      Write-Host "Starting CRM Tailscale bridge: 0.0.0.0:$localPort -> $($tsHost):5432"
      Start-Process -FilePath $node -ArgumentList @($bridgeScript) -WorkingDirectory $RepoRoot -WindowStyle Hidden
      Start-Sleep -Seconds 2
    } else {
      $ssh = (Get-Command ssh -ErrorAction Stop).Source
      $identity = $null
      foreach ($name in @("hetzner_ed25519", "id_ed25519", "id_rsa")) {
        $p = Join-Path $env:USERPROFILE ".ssh\$name"
        if (Test-Path -LiteralPath $p) { $identity = $p; break }
      }
      $sshArgs = @()
      if ($identity) { $sshArgs += "-i", $identity }
      $sshArgs += "-N", "-o", "ServerAliveInterval=30", "-o", "ServerAliveCountMax=4", "-o", "TCPKeepAlive=yes", "-L", "0.0.0.0:$($localPort):127.0.0.1:5432", "root@$remoteSsh"
      Write-Host "Starting CRM SSH tunnel: 0.0.0.0:$localPort -> $($remoteSsh):5432 (server 127.0.0.1:5432)"
      Start-Process -FilePath $ssh -ArgumentList $sshArgs -WindowStyle Hidden
      Start-Sleep -Seconds 2
    }
  } else {
    Write-Host ('Port ' + $localPort + ' already listening (bridge or tunnel may already be running).')
  }

} else {
  if (Test-Path -LiteralPath $dotEnv) {
    Write-Host "LOCALDEV: COMMAND-CENTRAL/.env present - CC_DOCKER_CRM_DB_* overrides droplet CRM host/port for the web container." -ForegroundColor Cyan
  } else {
    Write-Host "LOCALDEV: web -> droplet CRM at 100.74.54.12:5432 (Tailscale). Add .env to override CC_DOCKER_CRM_DB_* ; use --profile bundled-crm-postgres for local empty Postgres." -ForegroundColor Cyan
  }
}

if ($UseRemoteCrm) {
  docker compose @composeEnvFileArgs -f docker-compose.dev.yml -f docker-compose.dev-remote-crm.yml up -d
} else {
  docker compose @composeEnvFileArgs -f docker-compose.dev.yml up -d
}
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host 'LOCALDEV (Docker Desktop project cc-localdev):'
Write-Host '  Next:  cc-localdev-p3010  ->  http://localhost:3010'
Write-Host '  CRM: production droplet Postgres (Tailscale 100.74.54.12:5432) unless .env sets CC_DOCKER_CRM_DB_* or you use -UseRemoteCrm'
Write-Host '  No cc-localdev-crm-db by default (UI dev uses droplet). Old local DB still running?  docker rm -f cc-localdev-crm-db'
Write-Host '  Optional empty local Postgres only: --profile bundled-crm-postgres (see docker-compose.dev.yml)'
$downLogs = if (Test-Path -LiteralPath $dotEnv) {
  'docker compose --env-file .env --env-file web/.env.local -f docker-compose.dev.yml'
} else {
  'docker compose --env-file web/.env.local -f docker-compose.dev.yml'
}
Write-Host "If an old stack still appears (e.g. command-central), run: $downLogs down  then up again."
Write-Host "Logs: $downLogs logs --follow web"
