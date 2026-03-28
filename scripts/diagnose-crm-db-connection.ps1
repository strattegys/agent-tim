# Quick TCP checks for Command Central CRM Postgres (Windows).
# Does not use your password — only sees if something accepts connections on the ports.
#
#   cd COMMAND-CENTRAL
#   .\scripts\diagnose-crm-db-connection.ps1
#
# Optional: $env:CC_TAILSCALE_IP = "100.74.54.12"  (confirm with PROJECT-MEMORY.md §3 / tailscale status)

$ErrorActionPreference = "Continue"

$ts = if ($env:CC_TAILSCALE_IP) { $env:CC_TAILSCALE_IP.Trim() } else { "100.74.54.12" }
$tunnelPort = if ($env:CRM_TUNNEL_LOCAL_PORT) { $env:CRM_TUNNEL_LOCAL_PORT } else { "5433" }

Write-Host "=== CRM DB connectivity (Command Central) ===" -ForegroundColor Cyan
Write-Host "Tailscale CC node (default): ${ts}:5432"
Write-Host "Local tunnel target:         127.0.0.1:${tunnelPort}"
Write-Host ""

function Test-Port($name, $computer, $port) {
  Write-Host -NoNewline "  $name ($computer`:$port) ... "
  try {
    $r = Test-NetConnection -ComputerName $computer -Port $port -WarningAction SilentlyContinue -ErrorAction SilentlyContinue
    if ($r.TcpTestSucceeded) {
      Write-Host "OPEN" -ForegroundColor Green
      return $true
    }
  } catch { }
  Write-Host "closed or unreachable" -ForegroundColor Yellow
  return $false
}

$tsOk = Test-Port "Tailscale Postgres" $ts "5432"
$localOk = Test-Port "Tunnel / local" "127.0.0.1" $tunnelPort

Write-Host ""
if ($tsOk) {
  Write-Host "Recommendation: use Tailscale direct in web/.env.local (no SSH tunnel needed):" -ForegroundColor Green
  Write-Host "  CRM_DB_HOST=$ts"
  Write-Host "  CRM_DB_PORT=5432"
  Write-Host ""
  Write-Host "If the server was rebuilt, ensure Postgres is bound on the tailnet:" -ForegroundColor Gray
  Write-Host "  ssh root@$ts 'cd /opt/agent-tim && bash tools/expose-crm-db-tailscale.sh'"
} elseif ($localOk) {
  Write-Host "Recommendation: tunnel is up — keep CRM_DB_HOST=127.0.0.1 and CRM_DB_PORT=$tunnelPort" -ForegroundColor Green
  Write-Host "  (or host.docker.internal for Docker dev per docker-compose.dev.yml)"
} else {
  Write-Host "Neither path responded. Next steps:" -ForegroundColor Yellow
  Write-Host "  1) tailscale status   # confirm CC node and IP (update CC_TAILSCALE_IP if different)"
  Write-Host "  2) ssh root@$ts 'cd /opt/agent-tim && bash tools/expose-crm-db-tailscale.sh'"
  Write-Host "  3) Or start:  .\scripts\crm-db-tunnel.ps1   (uses CRM_SSH_HOST, default $ts)"
}
Write-Host ""
Write-Host "Then:  cd web && npm run check-crm-db" -ForegroundColor Cyan
