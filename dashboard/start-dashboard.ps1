# Stable dashboard launcher — auto-restarts vite dev if it dies.
# Dev mode: HMR + SIPHER_API proxy + local PowerShell runner (/api/ps).
# Run:  powershell -ExecutionPolicy Bypass -File start-dashboard.ps1
$ErrorActionPreference = "SilentlyContinue"
Set-Location $PSScriptRoot

function Free-Port($port) {
  $conns = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
  foreach ($c in $conns) {
    Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 300
  }
}

Write-Host "[dashboard] preparing..."
if (-not $env:SIPHER_API) { $env:SIPHER_API = "http://192.168.1.37:8888" }
Free-Port 3000
Start-Sleep -Milliseconds 500

Write-Host "[dashboard] serving on http://localhost:3000 (dev: proxy -> $env:SIPHER_API)"
while ($true) {
  & "C:\Program Files\nodejs\npx.cmd" vite --port 3000 --strictPort 2>&1 |
    ForEach-Object { "$(Get-Date -Format o) $_" } |
    Out-File -Append -FilePath "$PSScriptRoot\dev.log"
  Write-Host "[dashboard] process exited, restarting in 2s..."
  Start-Sleep -Seconds 2
}
