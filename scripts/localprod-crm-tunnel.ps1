# Forward droplet Command Central Postgres to the host so LOCALPROD Docker web can use
# host.docker.internal:CRM_LOCALPROD_DB_PORT (default 5433).
#
# Run in a **separate** PowerShell window and leave it open, then start:
#   .\scripts\docker-local-prod-desktop-up.ps1
#
# Env (optional):
#   CRM_SSH_HOST, CRM_DB_TAILSCALE_HOST — droplet SSH target (default: Tailscale CC node)
#   CRM_LOCALPROD_DB_PORT — local listen port (default 5433; same default as dev remote CRM)

$ErrorActionPreference = "Stop"

$localPort = if ($env:CRM_LOCALPROD_DB_PORT) { [int]$env:CRM_LOCALPROD_DB_PORT } else { 5433 }
$remote = if ($env:CRM_SSH_HOST) { $env:CRM_SSH_HOST.Trim() } elseif ($env:CRM_DB_TAILSCALE_HOST) { $env:CRM_DB_TAILSCALE_HOST.Trim() } else { "100.74.54.12" }

$key = if ($env:CRM_SSH_KEY) { $env:CRM_SSH_KEY } else { Join-Path $env:USERPROFILE ".ssh\hetzner_ed25519" }

Write-Host "LOCALPROD CRM tunnel: 127.0.0.1:$localPort -> $remote :5432 (server loopback crm-db)" -ForegroundColor Cyan
Write-Host "Leave this window open. Ctrl+C stops the tunnel." -ForegroundColor Gray

$sshArgs = @(
  "-o", "BatchMode=no",
  "-o", "ServerAliveInterval=30",
  "-N",
  "-L", "127.0.0.1:${localPort}:127.0.0.1:5432",
  "root@$remote"
)
if (Test-Path $key) {
  $sshArgs = @("-i", $key) + $sshArgs
}

& ssh @sshArgs
