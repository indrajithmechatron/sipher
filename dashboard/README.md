# Sipher Dashboard

React + Vite mission control UI for the Sipher quadruped robot.

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

## Adding a New Panel

1. Create component in `src/components/mc/`
2. Add to `renderPanel()` in `src/App.tsx`
3. Add tab entry in `src/components/mc/data.ts`

## API Endpoints (Pi Bridge)

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/sensors` | GET | Latest sensor snapshot from Pico |
| `/api/bridge_cmd` | POST | Forward command to Pico |
| `/command` | POST | Run restricted shell command |
