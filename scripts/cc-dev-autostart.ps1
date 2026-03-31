# Start Command Central Docker dev after login (default: bundled crm-db; use dev-docker-up.ps1 -UseRemoteCrm for tunnel).
# Intended for a Scheduled Task at logon. Waits for Docker Desktop, then runs dev-docker-up.ps1.
#
# Install once (current user):  powershell -ExecutionPolicy Bypass -File scripts\install-cc-dev-autostart-task.ps1
#
# Logs: %LOCALAPPDATA%\CommandCentralDev\autostart.log

$ErrorActionPreference = "Continue"
$RepoRoot = Split-Path $PSScriptRoot -Parent
$logDir = Join-Path $env:LOCALAPPDATA "CommandCentralDev"
$logFile = Join-Path $logDir "autostart.log"

function Write-Log([string]$Line) {
  try {
    if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }
    $ts = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
    Add-Content -Path $logFile -Value "[$ts] $Line" -Encoding utf8
  } catch { }
}

Write-Log "cc-dev-autostart: begin (repo $RepoRoot)"
Start-Sleep -Seconds 45

$dockerReady = $false
for ($i = 0; $i -lt 36; $i++) {
  & docker info 2>&1 | Out-Null
  if ($LASTEXITCODE -eq 0) {
    $dockerReady = $true
    break
  }
  Start-Sleep -Seconds 5
}

if (-not $dockerReady) {
  Write-Log "cc-dev-autostart: docker not ready after ~3 min — exit"
  exit 0
}

Write-Log "cc-dev-autostart: docker OK, running dev-docker-up.ps1"
try {
  Set-Location $RepoRoot
  & (Join-Path $RepoRoot "scripts\dev-docker-up.ps1") 2>&1 | ForEach-Object { Write-Log $_ }
  Write-Log "cc-dev-autostart: dev-docker-up.ps1 finished exit=$LASTEXITCODE"
} catch {
  Write-Log "cc-dev-autostart: error $($_.Exception.Message)"
}

exit 0
