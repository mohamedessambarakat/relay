# Adds a shortcut to your Startup folder so Relay starts hidden at Windows login.
# Undo with scripts\uninstall-autostart.ps1 (or delete "Relay.lnk" from shell:startup).
$ErrorActionPreference = "Stop"
$startup = [Environment]::GetFolderPath("Startup")
$lnk = Join-Path $startup "Relay.lnk"
$script = Join-Path $PSScriptRoot "start-hidden.ps1"
$shell = New-Object -ComObject WScript.Shell
$s = $shell.CreateShortcut($lnk)
$s.TargetPath = (Get-Command powershell.exe).Source
$s.Arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$script`""
$s.WorkingDirectory = Split-Path -Parent $PSScriptRoot
$s.WindowStyle = 7
$s.Description = "Start Relay"
$s.Save()
Write-Output "Installed: $lnk"
