# After GitHub Actions finishes deploying: sync THIS clone to origin/master and rebuild LOCALPROD Docker.
#
# GitHub cannot start Docker on your Windows PC by itself. Typical flow:
#   1) Push -> Actions deploys the droplet
#   2) Run this script on your machine -> pull + docker compose ... up -d --build
#
# Run from COMMAND-CENTRAL:  .\scripts\pull-master-and-localprod-up.ps1

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path $PSScriptRoot -Parent
Set-Location $RepoRoot

Write-Host "Fetching and fast-forwarding to origin/master..." -ForegroundColor Cyan
git fetch origin master
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
git merge --ff-only FETCH_HEAD
if ($LASTEXITCODE -ne 0) {
  Write-Error "Fast-forward merge failed. You have local commits or diverged history. Resolve in git, then re-run."
  exit 1
}

Write-Host "Starting LOCALPROD stack with rebuild..." -ForegroundColor Cyan
$up = Join-Path $PSScriptRoot "docker-local-prod-desktop-up.ps1"
& $up
