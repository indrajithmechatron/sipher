# Stable dashboard launcher - keeps the dev server (HMR, API proxy and the
# ConPTY PowerShell bridge at /api/pty) alive and self-healing.
# Run:  powershell -ExecutionPolicy Bypass -File start-dashboard.ps1
$ErrorActionPreference = "SilentlyContinue"
Set-Location $PSScriptRoot

# One launcher only: a second instance would fight this one for port 3000.
$mutex = New-Object System.Threading.Mutex($false, "Global\SipherDashboardLauncher")
if (-not $mutex.WaitOne(0)) {
  Write-Host "[dashboard] another launcher is already running - exiting."
  exit 1
}

function Free-Port($port) {
  $conns = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
  foreach ($c in $conns) {
    Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 300
  }
}

# Auto-update dependencies: `npm install` whenever package.json changes (or the
# native PTY module is missing). This is what makes a fresh checkout, or a new
# dependency such as node-pty/xterm, work on the next launch without manual steps.
function Sync-Dependencies {
  $pkg = Join-Path $PSScriptRoot "package.json"
  if (-not (Test-Path $pkg)) { return }
  $stamp = Join-Path $PSScriptRoot ".deps-stamp"
  $hash = (Get-FileHash -LiteralPath $pkg -Algorithm SHA256).Hash
  $old = if (Test-Path $stamp) { (Get-Content -LiteralPath $stamp -Raw).Trim() } else { "" }
  $needInstall = ($hash -ne $old) -or -not (Test-Path (Join-Path $PSScriptRoot "node_modules\node-pty"))
  if (-not $needInstall) { return }
  Write-Host "[dashboard] dependencies changed - npm install..."
  $npm = (Get-Command npm.cmd -ErrorAction SilentlyContinue).Source
  if (-not $npm) { $npm = "C:\Program Files\nodejs\npm.cmd" }
  & $npm install --no-audit --no-fund *>> "$PSScriptRoot\dev.log"
  if ($LASTEXITCODE -eq 0) {
    Set-Content -LiteralPath $stamp -Value $hash -NoNewline
    Write-Host "[dashboard] dependencies up to date."
  } else {
    Write-Host "[dashboard] npm install failed (exit $LASTEXITCODE) - continuing with installed modules."
  }
}

Write-Host "[dashboard] preparing..."
if (-not $env:SIPHER_API) { $env:SIPHER_API = "http://192.168.1.37:8888" }
Sync-Dependencies
Free-Port 3000
Start-Sleep -Milliseconds 500

Write-Host "[dashboard] serving on http://localhost:3000 (dev: proxy -> $env:SIPHER_API, PTY via ConPTY)"
while ($true) {
  & "C:\Program Files\nodejs\npx.cmd" vite --port 3000 --strictPort 2>&1 |
    ForEach-Object { "$(Get-Date -Format o) $_" } |
    Out-File -Append -FilePath "$PSScriptRoot\dev.log"
  Write-Host "[dashboard] process exited, restarting in 2s..."
  Start-Sleep -Seconds 2
}
