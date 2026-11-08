# Stops a running Relay (the background copy started at login, or one started by hand).
$port = if ($env:RELAY_PORT) { [int]$env:RELAY_PORT } else { 8000 }
$stopped = $false
# Only the launcher itself: powershell started with -File ...start-hidden.ps1.
Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" |
  Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -match '-File\s+"?[^"]*start-hidden\.ps1' } | ForEach-Object {
  taskkill /PID $_.ProcessId /T /F | Out-Null; $stopped = $true
}
Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | ForEach-Object {
  taskkill /PID $_.OwningProcess /T /F | Out-Null; $stopped = $true
}
if ($stopped) { Write-Output "Relay stopped" } else { Write-Output "Relay wasn't running on port $port" }
