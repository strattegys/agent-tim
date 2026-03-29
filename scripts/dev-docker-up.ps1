# Start CRM path to droplet Postgres, then docker compose dev stack.
# Run from COMMAND-CENTRAL:  .\scripts\dev-docker-up.ps1
#   -UseTailscaleBridge   Stable dev without SSH: TCP bridge 0.0.0.0:PORT -> tailnet :5432
#   (default)             SSH tunnel if port free (same as before)
#
# Requires: Tailscale on this PC. Droplet must expose CRM DB on tailnet for -UseTailscaleBridge:
#   ssh root@<100.x> 'cd /opt/agent-tim && bash tools/expose-crm-db-tailscale.sh'
# Optional: CRM_SSH_HOST, CRM_DB_TAILSCALE_HOST, CC_TAILSCALE_IP, CRM_TUNNEL_LOCAL_PORT

param(
  [switch]$UseTailscaleBridge
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path $PSScriptRoot -Parent
if (-not (Test-Path (Join-Path $RepoRoot "docker-compose.dev.yml"))) {
  Write-Error "Run from COMMAND-CENTRAL (docker-compose.dev.yml not found under $RepoRoot)"
  exit 1
}
Set-Location $RepoRoot

$localPort = if ($env:CRM_TUNNEL_LOCAL_PORT) { $env:CRM_TUNNEL_LOCAL_PORT } else { "5433" }
$tsHost = if ($env:CRM_DB_TAILSCALE_HOST) { $env:CRM_DB_TAILSCALE_HOST.Trim() } elseif ($env:CC_TAILSCALE_IP) { $env:CC_TAILSCALE_IP.Trim() } else { "100.74.54.12" }
$remoteSsh = if ($env:CRM_SSH_HOST) { $env:CRM_SSH_HOST } else { $tsHost }

$already = Get-NetTCPConnection -LocalPort $localPort -State Listen -ErrorAction SilentlyContinue
if (-not $already) {
  if ($UseTailscaleBridge) {
    $bridgeScript = Join-Path $RepoRoot "scripts\crm-db-tailscale-bridge.mjs"
    if (-not (Test-Path -LiteralPath $bridgeScript)) {
      Write-Error "Missing $bridgeScript"
      exit 1
    }
    $node = (Get-Command node -ErrorAction Stop).Source
    $env:CRM_DB_TAILSCALE_HOST = $tsHost
    $env:CRM_TUNNEL_LOCAL_PORT = "$localPort"
    Write-Host "Starting CRM Tailscale bridge: 0.0.0.0:${localPort} -> ${tsHost}:5432 (no SSH)"
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
    $sshArgs += "-N", "-o", "ServerAliveInterval=30", "-o", "ServerAliveCountMax=4", "-o", "TCPKeepAlive=yes", "-L", "0.0.0.0:${localPort}:localhost:5432", "root@${remoteSsh}"
    Write-Host "Starting CRM SSH tunnel: 0.0.0.0:${localPort} -> ${remoteSsh}:5432 (server localhost:5432)"
    Start-Process -FilePath $ssh -ArgumentList $sshArgs -WindowStyle Hidden
    Start-Sleep -Seconds 2
  }
} else {
  Write-Host "Port ${localPort} already listening (bridge or tunnel may already be running)."
}

docker compose -f docker-compose.dev.yml up -d
Write-Host "Dev web: http://localhost:3001  (logs: docker compose -f docker-compose.dev.yml logs -f web)"
