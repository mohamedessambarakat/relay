# Puts a "Relay" shortcut on your desktop: starts Relay in the background if needed and opens the board.
# Undo: delete Relay.lnk from the desktop.
$ErrorActionPreference = "Stop"
$lnk = Join-Path ([Environment]::GetFolderPath("Desktop")) "Relay.lnk"
$shell = New-Object -ComObject WScript.Shell
$s = $shell.CreateShortcut($lnk)
$s.TargetPath = (Get-Command powershell.exe).Source
$s.Arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$(Join-Path $PSScriptRoot 'open-relay.ps1')`""
$s.WorkingDirectory = Split-Path -Parent $PSScriptRoot
$s.WindowStyle = 7
$s.IconLocation = "$env:SystemRoot\System32\shell32.dll,137"
$s.Description = "Open Relay (starts it in the background if needed)"
$s.Save()
Write-Output "Installed: $lnk"
