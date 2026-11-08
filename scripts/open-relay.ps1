# Desktop shortcut target: starts Relay hidden in the background if it isn't running, then opens the board.
$root = Split-Path -Parent $PSScriptRoot
$port = 8000
$envFile = Join-Path $root ".env"
if (Test-Path $envFile) {
  $line = Get-Content $envFile | Where-Object { $_ -match '^\s*RELAY_PORT\s*=\s*(\d+)' } | Select-Object -First 1
  if ($line -and $line -match '(\d+)\s*$') { $port = [int]$Matches[1] }
}
$url = "http://localhost:$port"
# Relay listens on 127.0.0.1 only; PowerShell tries IPv6 for "localhost" first and stalls, so check via IPv4.
$api = "http://127.0.0.1:$port/api/system"

function Test-Relay {
  try { Invoke-RestMethod $api -TimeoutSec 2 | Out-Null; return $true } catch { return $false }
}

if (-not (Test-Relay)) {
  # Its own hidden process, so it keeps running after this script and any window close.
  Start-Process powershell.exe -WindowStyle Hidden -ArgumentList @(
    "-NoProfile", "-WindowStyle", "Hidden", "-ExecutionPolicy", "Bypass", "-File", "`"$(Join-Path $PSScriptRoot 'start-hidden.ps1')`""
  )
  for ($i = 0; $i -lt 30 -and -not (Test-Relay); $i++) { Start-Sleep -Seconds 1 }
  if (-not (Test-Relay)) {
    Add-Type -AssemblyName PresentationFramework
    [System.Windows.MessageBox]::Show("Relay didn't start. See data\relay.log in $root.", "Relay") | Out-Null
    exit 1
  }
}
Start-Process $url
