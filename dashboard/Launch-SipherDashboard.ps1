# Sipher Mission Control — desktop launcher
# Ensures the dashboard server is running, then opens it as an app window.
param(
    [switch]$ServerOnly,
    [switch]$NoOpen
)

$ErrorActionPreference = "SilentlyContinue"
$DashDir = $PSScriptRoot
$Port = 3000

function Test-DashUp {
    try {
        $r = Invoke-WebRequest -Uri "http://localhost:$Port" -UseBasicParsing -TimeoutSec 3
        return $r.StatusCode -eq 200
    } catch { return $false }
}

function Start-DashServer {
    # Kill any stale listener on the port
    Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | ForEach-Object {
        Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue
        Start-Sleep -Milliseconds 300
    }
    # Detached auto-restart server (hidden window)
    Start-Process -FilePath "powershell.exe" `
        -ArgumentList "-NoProfile","-ExecutionPolicy","Bypass","-File","$DashDir\start-dashboard.ps1" `
        -WindowStyle Hidden `
        -RedirectStandardOutput "$DashDir\launcher.log" `
        -RedirectStandardError "$DashDir\launcher.err.log"
    # Wait for ready
    $deadline = (Get-Date).AddSeconds(30)
    while ((Get-Date) -lt $deadline) {
        if (Test-DashUp) { return $true }
        Start-Sleep -Milliseconds 500
    }
    return (Test-DashUp)
}

function Open-AppWindow {
    $url = "http://localhost:$Port"
    $size = "--window-size=1600,1000"

    # Prefer Edge app mode (standalone window, no tabs/UI)
    $edgePaths = @(
        "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
        "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
    )
    foreach ($p in $edgePaths) {
        if (Test-Path $p) {
            Start-Process -FilePath $p -ArgumentList "--app=$url",$size
            return "edge-app"
        }
    }
    # Chrome app mode
    $chromePaths = @(
        "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
        "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
        "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
    )
    foreach ($p in $chromePaths) {
        if (Test-Path $p) {
            Start-Process -FilePath $p -ArgumentList "--app=$url",$size
            return "chrome-app"
        }
    }
    # Fallback: default browser
    Start-Process $url
    return "browser"
}

# --- main ---
if (-not (Test-DashUp)) {
    Write-Host "[sipher] starting server..."
    if (-not (Start-DashServer)) {
        Write-Host "[sipher] ERROR: server failed to start. Check preview.log / launcher.err.log"
        exit 1
    }
}
Write-Host "[sipher] server ready on http://localhost:$Port"

if ($ServerOnly -or $NoOpen) {
    exit 0
}

$mode = Open-AppWindow
Write-Host "[sipher] opened as $mode"
