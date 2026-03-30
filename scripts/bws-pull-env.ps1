# Render a dotenv file from Bitwarden Secrets Manager (bws secret list … --output env).
# Usage:  $env:BWS_ACCESS_TOKEN = '…'
#         .\scripts\bws-pull-env.ps1 -ProjectId '<uuid>' -OutFile 'web\.env.local'
#
# Project Server (same workspace): -OutFile '..\PROJECT-SERVER\site\.env.local'
# Requires: bws on PATH — https://bitwarden.com/help/secrets-manager-cli/

param(
  [Parameter(Mandatory = $true)][string]$ProjectId,
  [Parameter(Mandatory = $true)][string]$OutFile
)

$ErrorActionPreference = "Stop"

if (-not $env:BWS_ACCESS_TOKEN) {
  Write-Error "BWS_ACCESS_TOKEN is not set."
  exit 1
}

$bws = Get-Command bws -ErrorAction SilentlyContinue
if (-not $bws) {
  Write-Error "bws CLI not found on PATH. Install: https://bitwarden.com/help/secrets-manager-cli/"
  exit 1
}

$dir = Split-Path -Parent $OutFile
if ($dir -and -not (Test-Path -LiteralPath $dir)) {
  New-Item -ItemType Directory -Path $dir -Force | Out-Null
}

$tmp = "$OutFile.tmp.$PID"
try {
  & bws secret list $ProjectId --output env | Set-Content -Path $tmp -Encoding utf8
  Move-Item -LiteralPath $tmp -Destination $OutFile -Force
} finally {
  if (Test-Path -LiteralPath $tmp) {
    Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
  }
}

Write-Host "Wrote $OutFile (from BWS project $ProjectId)"
