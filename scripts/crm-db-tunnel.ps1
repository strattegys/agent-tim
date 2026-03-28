# Forward local Postgres port to CRM Postgres on the Command Central droplet.
# Leave this window open while using Docker dev: web/.env.local needs CRM_DB_PASSWORD and CRM_DB_PORT (default 5433).
#
# If Data platform shows ECONNREFUSED :5433 — the tunnel died (idle NAT/Tailscale/sleep), not the droplet DB.
# This script sends SSH keepalives so idle tunnels stay up longer. For auto-reconnect use crm-db-tunnel-watch.ps1.
#
# Optional environment variables:
#   $env:CRM_TUNNEL_LOCAL_PORT  (default 5433)
#   $env:CRM_TUNNEL_BIND        (default 0.0.0.0 - Docker Desktop reaches tunnel via host.docker.internal)
#   $env:CRM_SSH_HOST           (default: CC droplet Tailscale IP 100.74.54.12 — see PROJECT-MEMORY).
#                               Override with public IP if Tailscale is down: 137.184.187.233
#   $env:CRM_SSH_USER           (default root)
#   $env:SSH_IDENTITY_FILE      explicit key path (overrides auto-detect)

$ErrorActionPreference = "Stop"

$tunnelBind = if ($env:CRM_TUNNEL_BIND) { $env:CRM_TUNNEL_BIND } else { "0.0.0.0" }
$localPort = if ($env:CRM_TUNNEL_LOCAL_PORT) { $env:CRM_TUNNEL_LOCAL_PORT } else { "5433" }
$remoteHost = if ($env:CRM_SSH_HOST) { $env:CRM_SSH_HOST } else { "100.74.54.12" }
$remoteUser = if ($env:CRM_SSH_USER) { $env:CRM_SSH_USER } else { "root" }

$identity = $null
if ($env:SSH_IDENTITY_FILE -and (Test-Path -LiteralPath $env:SSH_IDENTITY_FILE)) {
  $identity = $env:SSH_IDENTITY_FILE
} else {
  $sshDir = Join-Path $env:USERPROFILE ".ssh"
  foreach ($name in @("hetzner_ed25519", "id_ed25519", "id_rsa")) {
    $p = Join-Path $sshDir $name
    if (Test-Path -LiteralPath $p) {
      $identity = $p
      break
    }
  }
}

Write-Host "CRM DB tunnel: ${tunnelBind}:$localPort -> ${remoteHost}:5432 (Postgres on server)"
Write-Host "Keep this window open. In web/.env.local: CRM_DB_PORT=$localPort  (+ CRM_DB_PASSWORD)"
if ($identity) {
  Write-Host "SSH identity: $identity"
} else {
  Write-Host "SSH identity: (none - using ssh default / agent)"
}
Write-Host ""

# Do not use $args - it is a PowerShell automatic variable and breaks some callers.
$sshArguments = @()
if ($identity) {
  $sshArguments += "-i", $identity
}
# Keep NAT / Tailscale / routers from silently closing idle SSH (common cause of "dev DB dropped").
$sshArguments += "-o", "ServerAliveInterval=30", "-o", "ServerAliveCountMax=4", "-o", "TCPKeepAlive=yes"
$sshArguments += "-N", "-L", "${tunnelBind}:${localPort}:localhost:5432", "${remoteUser}@${remoteHost}"

& ssh @sshArguments
