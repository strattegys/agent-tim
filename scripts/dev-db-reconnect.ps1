# Reconnect CRM Postgres forwarder for local dev (fixes Data platform after idle disconnect / sleep).
# Does not start Docker — only restarts the process listening on CRM_TUNNEL_LOCAL_PORT (default 5433).
#
#   From COMMAND-CENTRAL:  .\scripts\dev-db-reconnect.ps1
#   Tailscale bridge:      .\scripts\dev-db-reconnect.ps1 -UseTailscaleBridge
#   From web/:             npm run db:reconnect   |   npm run db:reconnect:bridge
#
# Optional: CRM_TUNNEL_LOCAL_PORT, CRM_SSH_HOST, CRM_DB_TAILSCALE_HOST, CC_TAILSCALE_IP, SSH_IDENTITY_FILE

param(
  [switch]$UseTailscaleBridge
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path $PSScriptRoot -Parent
if (-not (Test-Path (Join-Path $RepoRoot "docker-compose.dev.yml"))) {
  Write-Error "Expected COMMAND-CENTRAL repo (docker-compose.dev.yml missing under $RepoRoot)"
  exit 1
}

$localPort = if ($env:CRM_TUNNEL_LOCAL_PORT) { $env:CRM_TUNNEL_LOCAL_PORT } else { "5433" }
$remoteSsh = if ($env:CRM_SSH_HOST) { $env:CRM_SSH_HOST } else { "100.74.54.12" }
$tsHost = if ($env:CRM_DB_TAILSCALE_HOST) { $env:CRM_DB_TAILSCALE_HOST.Trim() } elseif ($env:CC_TAILSCALE_IP) { $env:CC_TAILSCALE_IP.Trim() } else { "100.74.54.12" }
if ($env:CC_CRM_USE_TAILSCALE_BRIDGE -eq "1") { $UseTailscaleBridge = $true }

function Stop-CrmForwardersOnPort([string]$Port) {
  $listeners = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
  foreach ($l in $listeners) {
    $proc = Get-Process -Id $l.OwningProcess -ErrorAction SilentlyContinue
    if (-not $proc) { continue }
    if ($proc.ProcessName -eq "ssh") {
      Write-Host "  Stopping ssh (PID $($proc.Id))..."
      Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
      continue
    }
    if ($proc.ProcessName -eq "node") {
      $cim = Get-CimInstance Win32_Process -Filter "ProcessId = $($proc.Id)" -ErrorAction SilentlyContinue
      $cmd = $cim.CommandLine
      if ($cmd -and $cmd -match 'crm-db-tailscale-bridge') {
        Write-Host "  Stopping Tailscale bridge node (PID $($proc.Id))..."
        Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
      }
    }
  }
}

function Invoke-CrmDbCheck {
  $saveHost = $env:CRM_DB_HOST
  $savePort = $env:CRM_DB_PORT
  try {
    $env:CRM_DB_HOST = "127.0.0.1"
    $env:CRM_DB_PORT = "$localPort"
    Push-Location (Join-Path $RepoRoot "web")
    & node scripts/check-crm-db.mjs --no-tailscale-fallback
    return $LASTEXITCODE
  } finally {
    Pop-Location
    if ($null -eq $saveHost) { Remove-Item Env:\CRM_DB_HOST -ErrorAction SilentlyContinue } else { $env:CRM_DB_HOST = $saveHost }
    if ($null -eq $savePort) { Remove-Item Env:\CRM_DB_PORT -ErrorAction SilentlyContinue } else { $env:CRM_DB_PORT = $savePort }
  }
}

Write-Host "Checking CRM DB (host 127.0.0.1:$localPort)..."
if ((Invoke-CrmDbCheck) -eq 0) {
  Write-Host ""
  Write-Host "CRM DB already reachable. Hard-refresh the app if the status rail still shows down."
  exit 0
}

Write-Host ""
if ($UseTailscaleBridge) {
  Write-Host "CRM DB unreachable - restarting Tailscale TCP bridge (port $localPort -> ${tsHost}:5432)..."
} else {
  Write-Host "CRM DB unreachable - restarting SSH tunnel (port $localPort -> ${remoteSsh}:5432)..."
}

Stop-CrmForwardersOnPort $localPort
Start-Sleep -Seconds 1

if ($UseTailscaleBridge) {
  $bridgeScript = Join-Path $RepoRoot "scripts\crm-db-tailscale-bridge.mjs"
  if (-not (Test-Path -LiteralPath $bridgeScript)) {
    Write-Error "Missing $bridgeScript"
    exit 1
  }
  $node = (Get-Command node -ErrorAction Stop).Source
  $env:CRM_DB_TAILSCALE_HOST = $tsHost
  $env:CRM_TUNNEL_LOCAL_PORT = "$localPort"
  Write-Host "  Starting background Tailscale bridge..."
  Start-Process -FilePath $node -ArgumentList @($bridgeScript) -WorkingDirectory $RepoRoot -WindowStyle Hidden
} else {
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
  $sshArgs += "-N", "-o", "ServerAliveInterval=30", "-o", "ServerAliveCountMax=4", "-o", "TCPKeepAlive=yes", "-L", "0.0.0.0:${localPort}:localhost:5432", "root@${remoteSsh}"
  Write-Host "  Starting background ssh..."
  Start-Process -FilePath $ssh -ArgumentList $sshArgs -WindowStyle Hidden
}

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
  if ($UseTailscaleBridge) {
    Write-Error "Still cannot reach CRM DB. On the droplet run: cd /opt/agent-tim && bash tools/expose-crm-db-tailscale.sh  (Tailscale + CRM password in web/.env.local)."
  } else {
    Write-Error "Still cannot reach CRM DB. Check: Tailscale, droplet up, web/.env.local CRM_DB_PASSWORD, SSH key, nothing else on port $localPort."
  }
  exit 1
}

Write-Host ""
Write-Host "Done. Data platform should show OK after a browser refresh (status rail polls about 60s, or reload the page)."
