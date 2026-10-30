# Sipher Dashboard

React + Vite mission control UI for the Sipher quadruped robot.

## Desktop Application

Install as a desktop app (standalone window + auto-start server):
see **[APPLICATION.md](./APPLICATION.md)**.

```powershell
npm install
npm run build
powershell -ExecutionPolicy Bypass -File .\Install-DesktopShortcut.ps1
```

## Setup

```bash
cd dashboard
npm install
npm run dev
# http://localhost:3000
```

## Build

```bash
npm run build
# Output: dist/
```

`command_endpoint.py` serves `dashboard/dist/index.html` when it exists (falling
back to `dashboard/index.html`), so on the Pi:

```bash
git pull && (cd dashboard && npm install && npm run build)
sudo systemctl restart sipher-command-endpoint
```

## Scripts

| Command / file | Purpose |
|---|---|
| `npm run dev` | Vite dev server on `:3000` (HMR, API proxy, PTY bridge) |
| `npm run build` | Static bundle into `dist/` |
| `npm run preview` | Serve the built bundle on `:3000` |
| `Launch-SipherDashboard.ps1` | Start the server if needed, open the app window (`-ServerOnly` skips the window) |
| `start-dashboard.ps1` | Hidden auto-restart loop: `npm install` when `package.json` changes, then `vite --port 3000 --strictPort` |
| `Install-DesktopShortcut.ps1` | Create Desktop + Startup shortcuts |

`start-dashboard.ps1` proxies `/api` and `/command` to `SIPHER_API`, default
`http://192.168.1.37:8888` (the Pi). Point it elsewhere with:

```powershell
$env:SIPHER_API = "http://192.168.1.40:8888"   # e.g. after the Pi changes address
```

## Architecture

- **Framework:** React 19 + Vite 6
- **Styling:** Tailwind CSS v4 + oklch design tokens
- **UI Components:** shadcn/ui (Radix UI primitives)
- **Icons:** lucide-react
- **Data:** `sipher.ts` hook polls Pi bridge API `/api/sensors`

## AI Backend & Secrets

`vite.config.ts` supervises a headless `opencode serve` and proxies it at
`/api/ai`. The backend listens on `127.0.0.1:4096` only, and the proxy injects
Basic auth — the password never reaches the browser.

No password is stored in this repository. It is generated once per user:

| OS | Location |
|---|---|
| Windows | `%LOCALAPPDATA%\Sipher\opencode-password` (DPAPI-encrypted) |
| Linux/macOS | `~/.config/sipher/opencode-password` (mode 0600) |

Overrides: `SIPHER_AI_PASSWORD`, `SIPHER_AI_PASSWORD_FILE`, `SIPHER_AI_PORT`,
`SIPHER_OPENCODE_BIN`. Delete the secret file to rotate it — the next start
generates a new one.

## Adding a New Panel

1. Create component in `src/components/mc/`
2. Add to `renderPanel()` in `src/App.tsx`
3. Add tab entry in `src/components/mc/data.ts`

## API Endpoints (Pi Bridge)

Everything below is served by `software/control/command_endpoint.py` on the Pi
(`:8888`) and reached in dev through the Vite proxy.

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/sensors` | GET | Latest sensor snapshot from Pico |
| `/api/pi` | GET | Pi CPU, temperature, disk and uptime |
| `/api/info` | GET | Static build/host info |
| `/api/map` | GET | ToF occupancy grid (`/api/map?action=reset` to clear) |
| `/api/rag/health` | GET | Retrieval service liveness + index stats |
| `/api/rag/search` | GET | BM25 search over docs, reports and manuals |
| `/api/rag/context` | GET | Cited excerpts as an LLM prompt block |
| `/api/rag/ingest` | POST | Add a manual (JSON `{name,text}`, raw PDF or text) |
| `/api/rag/reindex` | POST | Rebuild the index from disk |
| `/api/bridge_cmd` | POST | Forward command to Pico |
| `/command` | POST | Run an allowlisted argv (no shell) |
| `/health` | GET | Command endpoint liveness |

## Tests

No JavaScript test runner is configured. The Python layers have stdlib suites:

```bash
PYTHONPATH=software python -m unittest discover -s software/rag/tests -t software
PYTHONPATH=software python -m unittest discover -s software/control/tests -t software
```
