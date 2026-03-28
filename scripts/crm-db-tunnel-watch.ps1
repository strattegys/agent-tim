# CRM SSH tunnel with auto-reconnect (same forwards as crm-db-tunnel.ps1).
# Use when idle NAT/Tailscale keeps killing the tunnel — restarts ssh after exit/sleep/network flap.
#
#   .\scripts\crm-db-tunnel-watch.ps1
#
# Optional: same env vars as crm-db-tunnel.ps1 (CRM_TUNNEL_*, CRM_SSH_*, SSH_IDENTITY_FILE).

$ErrorActionPreference = "Stop"
$here = $PSScriptRoot
while ($true) {
  Write-Host "$(Get-Date -Format o) Starting CRM tunnel (Ctrl+C to stop)..."
  try {
    & (Join-Path $here "crm-db-tunnel.ps1")
  } catch {
    Write-Warning $_
  }
  Write-Host "$(Get-Date -Format o) Tunnel exited — reconnecting in 5s..."
  Start-Sleep -Seconds 5
}
