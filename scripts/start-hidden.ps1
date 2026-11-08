# Starts Relay in the background (used by the login shortcut). Output goes to data\relay.log.
# Calls node directly: at login the Windows PATH may not include pnpm.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
New-Item -ItemType Directory -Force "data" | Out-Null
$log = Join-Path $root "data\relay.log"
if (-not (Test-Path "dist\board\index.html")) {
  & node node_modules\vite\bin\vite.js build *>> $log
}
& node --import tsx src\server\main.ts *>> $log
