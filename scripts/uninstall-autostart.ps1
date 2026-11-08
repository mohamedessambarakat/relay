# Removes the Relay login shortcut.
$lnk = Join-Path ([Environment]::GetFolderPath("Startup")) "Relay.lnk"
if (Test-Path $lnk) { Remove-Item $lnk; Write-Output "Removed: $lnk" } else { Write-Output "Not installed" }
