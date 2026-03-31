# Copy Command Central CRM Postgres from LOCALDEV bundled crm-db into production (droplet).
# This replaces whatever is in production CRM today (pg_restore --clean). Web is stopped briefly.
#
# Your dev data must live in the local Docker DB (container cc-localdev-crm-db, port 127.0.0.1:25432).
# If you only ever used -UseRemoteCrm, the app was already talking to production - there is nothing
# extra on the laptop to push; use copy-prod-crm-to-dev.ps1 for the opposite direction.
#
#   .\scripts\copy-dev-crm-to-prod.ps1
#   .\scripts\copy-dev-crm-to-prod.ps1 -Force
#
# Optional: -SshHost, -SshUser, -DevDbContainer, -ProdCrmContainer, -ProdWebContainer
# Default SSH host is Tailscale (see PROJECT-MEMORY). Use public IP if Tailscale is down.

param(
  [switch] $Force,
  [string] $DevDbContainer = "cc-localdev-crm-db",
  [string] $ProdCrmContainer = "agent-tim-crm-db-1",
  [string] $ProdWebContainer = "agent-tim-web-1",
  [string] $SshHost = $(if ($env:CRM_SSH_HOST) { $env:CRM_SSH_HOST } else { "100.74.54.12" }),
  [string] $SshUser = $(if ($env:CRM_SSH_USER) { $env:CRM_SSH_USER } else { "root" })
)

$ErrorActionPreference = "Stop"

$dataDir = Join-Path $PSScriptRoot "..\docker-data"
if (-not (Test-Path -LiteralPath $dataDir)) {
  New-Item -ItemType Directory -Force -Path $dataDir | Out-Null
}
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$LocalDump = [System.IO.Path]::GetFullPath((Join-Path $dataDir "crm-dev-to-prod-$stamp.dump"))
$RemoteDump = "/tmp/cc-crm-dev-to-prod-$stamp.dump"
$sshTarget = "${SshUser}@${SshHost}"

Write-Host ""
Write-Host "This will REPLACE production CRM data with a dump from LOCALDEV ($DevDbContainer)." -ForegroundColor Yellow
Write-Host "Production containers: web=$ProdWebContainer  crm-db=$ProdCrmContainer  SSH=$sshTarget"
Write-Host ""

if (-not $Force) {
  $confirm = Read-Host "Type RESTORE-PROD to continue, or Enter to cancel"
  if ($confirm -cne "RESTORE-PROD") {
    Write-Host "Cancelled."
    exit 0
  }
}

$running = docker inspect -f "{{.State.Running}}" $DevDbContainer 2>$null
if ($running -ne "true") {
  Write-Error "Local CRM container '$DevDbContainer' is not running. Start LOCALDEV: .\scripts\dev-docker-up.ps1 (without -UseRemoteCrm if you want the bundled DB)."
}

$tmpInDev = "/tmp/cc-dev-export-$stamp.dump"
Write-Host "1/6  pg_dump in $DevDbContainer -> container path, then docker cp to $LocalDump"
docker exec $DevDbContainer pg_dump -U postgres -Fc default -f $tmpInDev
if ($LASTEXITCODE -ne 0) {
  Write-Error "pg_dump failed inside $DevDbContainer"
}
docker cp "${DevDbContainer}:${tmpInDev}" $LocalDump
docker exec $DevDbContainer rm -f $tmpInDev

$size = (Get-Item -LiteralPath $LocalDump).Length
if ($size -lt 2048) {
  Write-Warning "Dump is very small ($size bytes). If you expected Kanban/workflows, confirm data is in LOCALDEV bundled DB, not only remote CRM."
}

Write-Host "2/6  stop production web ($ProdWebContainer)"
ssh $sshTarget "docker stop $ProdWebContainer"

try {
  Write-Host "3/6  scp -> ${sshTarget}:$RemoteDump"
  scp $LocalDump "${sshTarget}:$RemoteDump"

  Write-Host "4/6  pg_restore into $ProdCrmContainer (may show harmless errors on first objects)"
  $restoreCmd = @"
docker cp $RemoteDump ${ProdCrmContainer}:/tmp/crm-restore.dump && docker exec $ProdCrmContainer pg_restore -U postgres -d default --clean --if-exists --no-owner --role=postgres /tmp/crm-restore.dump; EC=`$?; docker exec $ProdCrmContainer rm -f /tmp/crm-restore.dump; rm -f $RemoteDump; exit `$EC
"@
  ssh $sshTarget $restoreCmd
  if ($LASTEXITCODE -ne 0) {
    Write-Warning "pg_restore exited $LASTEXITCODE - often partly OK; check SSH output. Re-run migrate SQL on server if app errors."
  }
}
finally {
  Write-Host "5/6  start production web ($ProdWebContainer)"
  ssh $sshTarget "docker start $ProdWebContainer"
}

Write-Host "6/6  done. Local dump kept at: $LocalDump"
Write-Host "Verify: open production UI and Data platform, or SSH and: docker compose --env-file web/.env.local -f docker-compose.yml exec web npm run check-crm-db"
