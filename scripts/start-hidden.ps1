# Starts Relay in the background (used by the login shortcut). Output goes to data\relay.log.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
New-Item -ItemType Directory -Force "data" | Out-Null
$log = Join-Path $root "data\relay.log"
if (-not (Test-Path "dist\board\index.html")) { pnpm build *>> $log }
pnpm start *>> $log
