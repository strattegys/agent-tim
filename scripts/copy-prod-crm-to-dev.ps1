# Copy Command Central CRM Postgres from production (droplet crm-db) into a local Docker CRM DB.
# Requires: SSH to CC node (Tailscale default), Docker Desktop, web/.env.local with CRM_DB_PASSWORD.
#
#   .\scripts\copy-prod-crm-to-dev.ps1                          # LOCALDEV (cc-localdev)
#   .\scripts\copy-prod-crm-to-dev.ps1 -Target LocalProd        # LOCALPROD (cc-localprod)
#   .\scripts\copy-prod-crm-to-dev.ps1 -Target Both             # same dump into both stacks
#   .\scripts\copy-prod-crm-to-dev.ps1 -SshHost 137.184.187.233
#
# Stops the matching web container(s) briefly during restore.

param(
  [ValidateSet("LocalDev", "LocalProd", "Both")]
  [string] $Target = "LocalDev",
  [string] $SshHost = $(if ($env:CRM_SSH_HOST) { $env:CRM_SSH_HOST } else { "100.74.54.12" }),
  [string] $SshUser = $(if ($env:CRM_SSH_USER) { $env:CRM_SSH_USER } else { "root" })
)

$ErrorActionPreference = "Stop"

$ProdCrmContainer = "agent-tim-crm-db-1"
$RemoteDump = "/tmp/cc-crm-prod-snapshot.dump"
$dataDir = Join-Path $PSScriptRoot "..\docker-data"
if (-not (Test-Path -LiteralPath $dataDir)) {
  New-Item -ItemType Directory -Force -Path $dataDir | Out-Null
}
$LocalDump = [System.IO.Path]::GetFullPath((Join-Path $dataDir "crm-prod-snapshot.dump"))

$targets = @()
if ($Target -eq "Both") {
  $targets = @(
    @{ Db = "cc-localdev-crm-db"; Web = "cc-localdev-p3010"; Label = "LOCALDEV" },
    @{ Db = "cc-localprod-crm-db"; Web = "cc-localprod-p3001"; Label = "LOCALPROD" }
  )
} elseif ($Target -eq "LocalProd") {
  $targets = @( @{ Db = "cc-localprod-crm-db"; Web = "cc-localprod-p3001"; Label = "LOCALPROD" } )
} else {
  $targets = @( @{ Db = "cc-localdev-crm-db"; Web = "cc-localdev-p3010"; Label = "LOCALDEV" } )
}

Write-Host ("1/5  pg_dump on server ({0}@{1}: {2}) -> {3}" -f $SshUser, $SshHost, $ProdCrmContainer, $RemoteDump)
ssh "${SshUser}@${SshHost}" "docker exec $ProdCrmContainer pg_dump -U postgres -Fc default > $RemoteDump && du -h $RemoteDump"

Write-Host "2/5  scp -> $LocalDump"
scp "${SshUser}@${SshHost}:$RemoteDump" $LocalDump

Write-Host "3/5  remove remote dump"
ssh "${SshUser}@${SshHost}" "rm -f $RemoteDump"

Write-Host "4/5  stop web + pg_restore for: $($targets.Label -join ', ')"
foreach ($t in $targets) {
  docker stop $t.Web 2>$null | Out-Null
}
foreach ($t in $targets) {
  Write-Host "  -> $($t.Label) $($t.Db)"
  docker cp $LocalDump "$($t.Db):/tmp/crm-restore.dump"
  docker exec $t.Db pg_restore -U postgres -d default --clean --if-exists --no-owner --role=postgres /tmp/crm-restore.dump
  if ($LASTEXITCODE -ne 0) {
    Write-Warning "pg_restore exited $LASTEXITCODE for $($t.Label) - often harmless on first restore; check output above."
  }
  docker exec $t.Db rm -f /tmp/crm-restore.dump
}

Write-Host "5/5  start web container(s)"
foreach ($t in $targets) {
  docker start $t.Web | Out-Null
  Write-Host "  started $($t.Web)"
}

$verify = $targets[0].Web
Write-Host "Done. Verify: docker exec $verify npm run check-crm-db"
