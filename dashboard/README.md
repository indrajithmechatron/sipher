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
# Output: dist/ (static files)
```

Copy `dist/` to Pi and serve via `command_endpoint.py`.

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

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/sensors` | GET | Latest sensor snapshot from Pico |
| `/api/bridge_cmd` | POST | Forward command to Pico |
| `/api/rag/search` | GET | BM25 search over docs, reports and manuals |
| `/api/rag/context` | GET | Cited excerpts as an LLM prompt block |
| `/command` | POST | Run an allowlisted argv (no shell) |
