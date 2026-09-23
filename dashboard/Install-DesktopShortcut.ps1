# Creates Desktop + Startup shortcuts for Sipher Mission Control.
# Run once after npm install && npm run build:
#   powershell -ExecutionPolicy Bypass -File .\Install-DesktopShortcut.ps1

$ErrorActionPreference = "Stop"
$DashDir = $PSScriptRoot
$Launch = Join-Path $DashDir "Launch-SipherDashboard.ps1"

if (-not (Test-Path $Launch)) {
    Write-Error "Launch-SipherDashboard.ps1 not found in $DashDir"
    exit 1
}

$ws = New-Object -ComObject WScript.Shell

# Desktop shortcut
$desktop = [Environment]::GetFolderPath("Desktop")
$deskLnk = Join-Path $desktop "Sipher Dashboard.lnk"
$d = $ws.CreateShortcut($deskLnk)
$d.TargetPath = "powershell.exe"
$d.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$Launch`""
$d.WorkingDirectory = $DashDir
$d.WindowStyle = 7
$d.Description = "Sipher Mission Control — robot dashboard"
$d.Save()
Write-Host "Desktop shortcut: $deskLnk"

# Startup shortcut (server only, hidden)
$startup = [Environment]::GetFolderPath("Startup")
$stLnk = Join-Path $startup "Sipher Dashboard Server.lnk"
$s = $ws.CreateShortcut($stLnk)
$s.TargetPath = "powershell.exe"
$s.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$Launch`" -ServerOnly"
$s.WorkingDirectory = $DashDir
$s.WindowStyle = 7
$s.Description = "Starts Sipher dashboard server at login"
$s.Save()
Write-Host "Startup shortcut: $stLnk"

Write-Host "Done. Double-click 'Sipher Dashboard' on your Desktop to open the app."
