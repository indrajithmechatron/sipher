# Sipher Mission Control — Desktop Application

Install the dashboard as a desktop application on Windows. It runs as a
standalone Edge/Chrome app window (no browser tabs) with an auto-restarting
local server.

## Requirements

- Windows 10/11
- Node.js 18+ (https://nodejs.org)
- Microsoft Edge or Google Chrome (preinstalled on most systems)
- Network access to the robot Pi — `SIPHER_API`, default
  `http://192.168.1.37:8888` (set `SIPHER_API` for a different address)

## Install (one time)

```powershell
cd <repo>\dashboard
npm install
npm run build
```

Then create the desktop shortcut (run once):

```powershell
powershell -ExecutionPolicy Bypass -File .\Install-DesktopShortcut.ps1
```

This places **Sipher Dashboard** on your Desktop and registers a
startup entry so the server starts automatically at login.

## Launch

| Method | What happens |
|---|---|
| Desktop icon **Sipher Dashboard** | Starts server if needed, opens app window |
| `dashboard\Sipher Dashboard.cmd` | Same launcher from the repo |
| Startup entry | Server only (hidden) at Windows login |

## Files

| File | Purpose |
|---|---|
| `Launch-SipherDashboard.ps1` | Health-check server, open app window |
| `start-dashboard.ps1` | Sync dependencies, then keep the dev server alive (auto-restart) |
| `Sipher Dashboard.cmd` | Double-click entry point |
| `Install-DesktopShortcut.ps1` | Creates Desktop + Startup shortcuts |
| `dev.log` | Vite output, appended across restarts |
| `launcher.log`, `launcher.err.log` | Launcher stdout/stderr |

## Server details

- URL: `http://localhost:3000`
- Proxy: `/api` and `/command` → `SIPHER_API` (default `http://192.168.1.37:8888`)
- AI backend: `127.0.0.1:4096` (loopback only) with a per-user secret generated
  on first run — see `dashboard/README.md`
- Auto-restart: if the Vite process exits, it restarts after 2 seconds
- Dependencies: `start-dashboard.ps1` runs `npm install` whenever
  `package.json` changes (tracked by `.deps-stamp`)

## Troubleshooting

| Symptom | Fix |
|---|---|
| Blank page | Wait 5s; server may be rebuilding. Check `dev.log` |
| Port already in use | Launcher kills the old listener automatically |
| No live sensor data | Ensure the Pi answers: `ping 192.168.1.37` (or your `SIPHER_API` host) |
| Want a full browser tab | Open `http://localhost:3000` manually |
