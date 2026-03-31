# One-time recovery: older LOCALPROD used CC_AGENT_CHAT_PROFILE=localprod, so chat lived under
#   agents/**/sessions/localprod/*.jsonl
# Current LOCALPROD uses the same paths as production: agents/**/sessions/*.jsonl
# This script appends each localprod/*.jsonl into the sibling file one directory up (canonical path)
# if the canonical file is missing or smaller than the source. If canonical is larger, skips with a message.
#
# Run from COMMAND-CENTRAL:  .\scripts\merge-localprod-profile-sessions.ps1
# Optional: -WhatIf to only list actions.

param([switch]$WhatIf)

$ErrorActionPreference = "Stop"
$Root = Split-Path $PSScriptRoot -Parent
$Agents = Join-Path $Root "agents"
if (-not (Test-Path $Agents)) {
  Write-Host "No agents/ folder at $Agents"
  exit 0
}

$files = Get-ChildItem -Path $Agents -Recurse -File -Filter "*.jsonl" -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -match '[\\/]sessions[\\/]localprod[\\/]' }

if (-not $files) {
  Write-Host 'No files under agents/**/sessions/localprod/*.jsonl - nothing to merge.'
  exit 0
}

foreach ($src in $files) {
  $parent = Split-Path (Split-Path $src.FullName -Parent) -Parent
  $name = $src.Name
  $dest = Join-Path $parent $name
  $srcLen = $src.Length
  $destExists = Test-Path $dest
  $destLen = if ($destExists) { (Get-Item $dest).Length } else { 0 }

  if ($destExists -and $destLen -ge $srcLen -and $srcLen -gt 0) {
    Write-Host "SKIP (canonical already >= source): $($src.FullName)"
    continue
  }

  $action = if ($destExists) { "APPEND" } else { "COPY" }
  Write-Host ($action + ' : ' + $src.FullName + ' -> ' + $dest)

  if ($WhatIf) { continue }

  if (-not $destExists) {
    Copy-Item -LiteralPath $src.FullName -Destination $dest -Force
    continue
  }

  $bytes = [System.IO.File]::ReadAllBytes($src.FullName)
  $stream = [System.IO.FileStream]::new($dest, [System.IO.FileMode]::Append, [System.IO.FileAccess]::Write)
  try { $stream.Write($bytes, 0, $bytes.Length) }
  finally { $stream.Dispose() }
}

Write-Host 'Done. Review agents/**/sessions/*.jsonl; you may delete localprod/ subfolders after backup.'
