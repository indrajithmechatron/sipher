# Stable dashboard launcher — auto-restarts vite preview if it dies.
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
Free-Port 3000
Start-Sleep -Milliseconds 500

$env:NODE_ENV = "production"
Write-Host "[dashboard] building (if needed)..."
& "C:\Program Files\nodejs\npx.cmd" vite build 2>&1 | Out-Null

Write-Host "[dashboard] serving on http://localhost:3000 (auto-restart enabled)"
while ($true) {
  & "C:\Program Files\nodejs\npx.cmd" vite preview --port 3000 --strictPort 2>&1 |
    ForEach-Object { "$(Get-Date -Format o) $_" } |
    Out-File -Append -FilePath "$PSScriptRoot\preview.log"
  Write-Host "[dashboard] process exited, restarting in 2s..."
  Start-Sleep -Seconds 2
}
