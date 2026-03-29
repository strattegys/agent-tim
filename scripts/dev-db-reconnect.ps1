# Reconnect CRM Postgres forwarder for local dev (fixes Data platform after idle disconnect / sleep / reboot).
# Does not start Docker — only restarts the process listening on CRM_TUNNEL_LOCAL_PORT (default 5433).
#
#   From COMMAND-CENTRAL:  .\scripts\dev-db-reconnect.ps1
#   From web/:             npm run db:reconnect
#   Force bridge:           .\scripts\dev-db-reconnect.ps1 -UseTailscaleBridge   |   npm run db:reconnect:bridge
#   Force SSH:              .\scripts\dev-db-reconnect.ps1 -UseSshTunnel
#
# Auto (default npm run db:reconnect): if ${tsHost}:5432 answers, restart Tailscale TCP bridge; else SSH tunnel.
# Optional env: CC_CRM_USE_TAILSCALE_BRIDGE=1 to always use bridge path.
#
# Optional: CRM_TUNNEL_LOCAL_PORT, CRM_SSH_HOST, CRM_DB_TAILSCALE_HOST, CC_TAILSCALE_IP, SSH_IDENTITY_FILE

param(
  [switch]$UseTailscaleBridge,
  [switch]$UseSshTunnel
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
  Write-Error "Expected COMMAND-CENTRAL repo (docker-compose.dev.yml missing under $RepoRoot)"
  exit 1
}

$localPort = if ($env:CRM_TUNNEL_LOCAL_PORT) { $env:CRM_TUNNEL_LOCAL_PORT } else { "5433" }
$tsHost = if ($env:CRM_DB_TAILSCALE_HOST) { $env:CRM_DB_TAILSCALE_HOST.Trim() } elseif ($env:CC_TAILSCALE_IP) { $env:CC_TAILSCALE_IP.Trim() } else { "100.74.54.12" }
$remoteSsh = if ($env:CRM_SSH_HOST) { $env:CRM_SSH_HOST } else { $tsHost }
if ($env:CC_CRM_USE_TAILSCALE_BRIDGE -eq "1") { $UseTailscaleBridge = $true }

$tsCrmOpen = Test-TcpOpen $tsHost 5432
$useBridge = $false
if ($UseSshTunnel) {
  $useBridge = $false
} elseif ($UseTailscaleBridge) {
  $useBridge = $true
} elseif ($tsCrmOpen) {
  $useBridge = $true
}

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
if ($useBridge) {
  Write-Host "CRM DB unreachable - restarting Tailscale TCP bridge (port $localPort -> ${tsHost}:5432)..."
} else {
  Write-Host "CRM DB unreachable - restarting SSH tunnel (port $localPort -> ${remoteSsh}:5432)..."
}

Stop-CrmForwardersOnPort $localPort
Start-Sleep -Seconds 3

if ($useBridge) {
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
  $sshArgs = @("-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=accept-new")
  if ($identity) { $sshArgs += "-i", $identity }
  $sshArgs += "-N", "-o", "ServerAliveInterval=30", "-o", "ServerAliveCountMax=4", "-o", "TCPKeepAlive=yes", "-L", "0.0.0.0:${localPort}:127.0.0.1:5432", "root@${remoteSsh}"
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
  Write-Host "If the droplet was restarted before the latest deploy: push master so CI re-runs expose-crm-db-tailscale.sh, or SSH and run:" -ForegroundColor Yellow
  Write-Host "  cd /opt/agent-tim && bash tools/expose-crm-db-tailscale.sh" -ForegroundColor Yellow
  Write-Host ""
  if ($useBridge) {
    Write-Error "Still cannot reach CRM DB via bridge. Confirm Tailscale on this PC, CRM_DB_PASSWORD in web/.env.local, and that ${tsHost}:5432 is open (diagnose: .\scripts\diagnose-crm-db-connection.ps1)."
  } else {
    Write-Error "Still cannot reach CRM DB via SSH tunnel. Try: npm run db:reconnect:bridge if ${tsHost}:5432 is open, or fix SSH keys and droplet access."
  }
  exit 1
}

Write-Host ""
Write-Host "Done. Data platform should show OK after a browser refresh (status rail polls about 60s, or reload the page)."
