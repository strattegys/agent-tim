# Stop whatever is listening on CRM_TUNNEL_LOCAL_PORT (default 5433) — ssh or node bridge.
$port = if ($env:CRM_TUNNEL_LOCAL_PORT) { $env:CRM_TUNNEL_LOCAL_PORT } else { "5433" }
Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | ForEach-Object {
  Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue
}
