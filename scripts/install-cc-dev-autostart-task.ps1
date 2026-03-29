# Register a Windows Scheduled Task: at logon, wait for Docker, run dev-docker-up.ps1 (CRM bridge + compose).
# Run once in PowerShell (no admin required for "run only when user is logged on"):
#   cd COMMAND-CENTRAL
#   powershell -ExecutionPolicy Bypass -File .\scripts\install-cc-dev-autostart-task.ps1
#
# Remove:  Unregister-ScheduledTask -TaskName "CommandCentralDevAutostart" -Confirm:$false

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path $PSScriptRoot -Parent
$scriptPath = Join-Path $RepoRoot "scripts\cc-dev-autostart.ps1"
if (-not (Test-Path -LiteralPath $scriptPath)) {
  Write-Error "Missing $scriptPath"
  exit 1
}

$taskName = "CommandCentralDevAutostart"
$arg = "-NoProfile -ExecutionPolicy Bypass -File `"$scriptPath`""
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $arg
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal | Out-Null

Write-Host "Registered scheduled task '$taskName' (runs cc-dev-autostart.ps1 at logon)."
Write-Host "Log file: $env:LOCALAPPDATA\CommandCentralDev\autostart.log"
