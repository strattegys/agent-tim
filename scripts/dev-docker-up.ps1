# Start CRM SSH tunnel (Tailscale by default) if port 5433 is free, then docker compose dev stack.
# Run from repo root or anywhere:  .\scripts\dev-docker-up.ps1
#
# Requires: Tailscale connected on this PC, same tailnet as CC droplet. Optional: $env:CRM_SSH_HOST

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path $PSScriptRoot -Parent
if (-not (Test-Path (Join-Path $RepoRoot "docker-compose.dev.yml"))) {
  Write-Error "Run from COMMAND-CENTRAL (docker-compose.dev.yml not found under $RepoRoot)"
  exit 1
}
Set-Location $RepoRoot

$localPort = if ($env:CRM_TUNNEL_LOCAL_PORT) { $env:CRM_TUNNEL_LOCAL_PORT } else { "5433" }
$remoteHost = if ($env:CRM_SSH_HOST) { $env:CRM_SSH_HOST } else { "100.74.54.12" }

$already = Get-NetTCPConnection -LocalPort $localPort -State Listen -ErrorAction SilentlyContinue
if (-not $already) {
  $ssh = (Get-Command ssh -ErrorAction Stop).Source
  $identity = $null
  foreach ($name in @("hetzner_ed25519", "id_ed25519", "id_rsa")) {
    $p = Join-Path $env:USERPROFILE ".ssh\$name"
    if (Test-Path -LiteralPath $p) { $identity = $p; break }
  }
  $sshArgs = @()
  if ($identity) { $sshArgs += "-i", $identity }
  $sshArgs += "-N", "-o", "ServerAliveInterval=30", "-o", "ServerAliveCountMax=4", "-o", "TCPKeepAlive=yes", "-L", "0.0.0.0:${localPort}:localhost:5432", "root@${remoteHost}"
  Write-Host "Starting CRM tunnel: 0.0.0.0:${localPort} -> ${remoteHost}:5432 (localhost:5432 on server)"
  Start-Process -FilePath $ssh -ArgumentList $sshArgs -WindowStyle Hidden
  Start-Sleep -Seconds 2
} else {
  Write-Host "Port ${localPort} already listening (tunnel may already be running)."
}

docker compose -f docker-compose.dev.yml up -d
Write-Host "Dev web: http://localhost:3001  (logs: docker compose -f docker-compose.dev.yml logs -f web)"
