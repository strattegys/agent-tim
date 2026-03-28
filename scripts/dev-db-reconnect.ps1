# Reconnect CRM Postgres tunnel for local dev (fixes Data platform after idle disconnect / sleep).
# Does not start Docker - only SSH :5433 -> droplet :5432.
#
#   From COMMAND-CENTRAL:  .\scripts\dev-db-reconnect.ps1
#   From web/:             npm run db:reconnect
#
# Optional: CRM_TUNNEL_LOCAL_PORT, CRM_SSH_HOST, SSH_IDENTITY_FILE (same as crm-db-tunnel.ps1)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path $PSScriptRoot -Parent
if (-not (Test-Path (Join-Path $RepoRoot "docker-compose.dev.yml"))) {
  Write-Error "Expected COMMAND-CENTRAL repo (docker-compose.dev.yml missing under $RepoRoot)"
  exit 1
}

$localPort = if ($env:CRM_TUNNEL_LOCAL_PORT) { $env:CRM_TUNNEL_LOCAL_PORT } else { "5433" }
$remoteHost = if ($env:CRM_SSH_HOST) { $env:CRM_SSH_HOST } else { "100.74.54.12" }

function Invoke-CrmDbCheck {
  Push-Location (Join-Path $RepoRoot "web")
  try {
    & node scripts/check-crm-db.mjs
    return $LASTEXITCODE
  } finally {
    Pop-Location
  }
}

Write-Host "Checking CRM DB (host 127.0.0.1:$localPort from check-crm-db)..."
if ((Invoke-CrmDbCheck) -eq 0) {
  Write-Host ""
  Write-Host "CRM DB already reachable - tunnel is fine. Hard-refresh the app if the status rail still shows down."
  exit 0
}

Write-Host ""
Write-Host "CRM DB unreachable - restarting SSH tunnel (port $localPort -> ${remoteHost}:5432)..."

$listeners = @(Get-NetTCPConnection -LocalPort $localPort -State Listen -ErrorAction SilentlyContinue)
foreach ($l in $listeners) {
  $proc = Get-Process -Id $l.OwningProcess -ErrorAction SilentlyContinue
  if ($proc -and $proc.ProcessName -eq "ssh") {
    Write-Host "  Stopping stale ssh (PID $($proc.Id))..."
    Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
  }
}
Start-Sleep -Seconds 1

$ssh = (Get-Command ssh -ErrorAction Stop).Source
$identity = $null
if ($env:SSH_IDENTITY_FILE -and (Test-Path -LiteralPath $env:SSH_IDENTITY_FILE)) {
  $identity = $env:SSH_IDENTITY_FILE
} else {
  foreach ($name in @("hetzner_ed25519", "id_ed25519", "id_rsa")) {
    $p = Join-Path $env:USERPROFILE ".ssh\$name"
    if (Test-Path -LiteralPath $p) { $identity = $p; break }
  }
}
$sshArgs = @("-o", "StrictHostKeyChecking=accept-new")
if ($identity) { $sshArgs += "-i", $identity }
$sshArgs += "-N", "-o", "ServerAliveInterval=30", "-o", "ServerAliveCountMax=4", "-o", "TCPKeepAlive=yes", "-L", "0.0.0.0:${localPort}:localhost:5432", "root@${remoteHost}"

Write-Host "  Starting background ssh..."
Start-Process -FilePath $ssh -ArgumentList $sshArgs -WindowStyle Hidden
# Wait for local listen (ssh can take a few seconds after process start)
for ($i = 0; $i -lt 15; $i++) {
  $up = Get-NetTCPConnection -LocalPort $localPort -State Listen -ErrorAction SilentlyContinue
  if ($up) { break }
  Start-Sleep -Seconds 1
}
Start-Sleep -Seconds 1

Write-Host ""
Write-Host "Verifying..."
if ((Invoke-CrmDbCheck) -ne 0) {
  Write-Host ""
  Write-Error "Still cannot reach CRM DB. Check: Tailscale, droplet up, web/.env.local CRM_DB_PASSWORD, and that nothing else blocks port $localPort."
  exit 1
}

Write-Host ""
Write-Host "Done. Data platform should show OK after a browser refresh (status rail polls about 60s, or reload the page)."
