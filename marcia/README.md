# Marcia — Software Lead Guide

This document tells you exactly what you own, what to touch, and what NOT to touch.

---

## Your Responsibilities

### 0. Desktop Application (install this first)

**Location:** `dashboard/` — see `dashboard/APPLICATION.md`

Hi Marcia — the dashboard is packaged as a Windows desktop application.
Please install it on your machine so you always have the mission control UI:

```powershell
# 1. Clone the repo, then:
cd sipher\dashboard
npm install
npm run build

# 2. Create the Desktop + Startup shortcuts (run once):
powershell -ExecutionPolicy Bypass -File .\Install-DesktopShortcut.ps1
```

After that you will see **Sipher Dashboard** on your Desktop.
Double-click it anytime — it starts the local server if needed and opens
the app in a standalone window (no browser tabs). The server also starts
automatically when you log in.

Full docs: `dashboard/APPLICATION.md`

---

### 1. Dashboard (React + Vite)

**Location:** `dashboard/`

You own the mission control dashboard. It's a React app with Tailwind CSS.

**To run locally:**
```bash
cd dashboard
npm install
npm run dev
# Opens at http://localhost:3000
```

**To build for Pi:**
```bash
npm run build
# Output goes to dashboard/dist/
```

**Desktop app install (recommended):**
```powershell
powershell -ExecutionPolicy Bypass -File .\Install-DesktopShortcut.ps1
# Details: dashboard/APPLICATION.md
```

**Key files to know:**
| File | What it does |
|---|---|
| `src/App.tsx` | Main layout — tabs, sidebar, panels |
| `src/components/mc/sipher.ts` | **Real data hook** — fetches from Pi API, maps to UI |
| `src/components/mc/data.ts` | Explorer tree, terminal data, presets |
| `src/components/mc/DigitalTwin.tsx` | Robot SVG visualization + attitude gauge |
| `src/components/mc/Inspector.tsx` | Right panel — sensor values, state |
| `src/components/mc/MenuBar.tsx` | Top menu bar |
| `src/components/mc/TerminalDock.tsx` | Bottom terminal tabs |
| `src/components/mc/HealthStrip.tsx` | Status bar with health metrics |
| `src/styles.css` | Tailwind v4 + oklch design tokens |
| `vite.config.ts` | Vite config — has proxy to Pi bridge API |

**To add a new sensor to the dashboard:**
1. Add the field to `Telemetry` type in `sipher.ts`
2. Map the API response to that field in `useSipherTelemetry()`
3. Use it in the relevant component (Inspector, DigitalTwin, etc.)

**To send commands from dashboard:**
```typescript
fetch("/api/bridge_cmd", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ cmd: "your_command" })
});
```

---

### 2. Pico Firmware (MicroPython)

**Location:** `software/firmware/pico_main.py`

This runs on the Pico 2 W. It:
- Polls sensors (MPU6050, INA219, VL53L0X, GPS) in a loop
- Sends JSON data to Pi over USB serial
- Receives commands from Pi
- Controls 12 servos via PCA9685
- Displays data on TFT

**To flash:**
```bash
# Connect Pico via USB, then:
mpremote connect /dev/ttyACM0 cp software/firmware/pico_main.py :main.py
mpremote connect /dev/ttyACM0 reset
```

**Sensor reading format (sent as JSON lines):**
```json
{
  "mpu": [ax, ay, az, gx, gy, gz],
  "ina": {"voltage_v": 12.4, "current_ma": 340},
  "vl53_mm": 287,
  "gps": {"lat": 12.34, "lon": 56.78},
  "pca": {"duty": 0.5, "pulse_ms": 1.5, "pulse_us": 1500},
  "i2c0": ["0x40", "0x41", "0x29"],
  "i2c1": ["0x68"],
  "uptime_s": 1234,
  "version": "3.0"
}
```

---

### 3. Pi-Side Python

**Location:** `software/control/` and `software/robot/`

- `command_endpoint.py` — HTTP server (port 5001) that serves the dashboard and proxies commands to Pico
- `pico_bridge.py` — USB-serial to TCP bridge (port 5000)

**To restart services on Pi:**
```bash
ssh sipher@192.168.1.35
sudo systemctl restart sipher-command-endpoint
```

---

## What NOT to Touch

| Area | Why |
|---|---|
| `docs/ARCHITECTURE.md` | Authoritative architecture doc — only Indra edits |
| `deploy/` | Deployment scripts — only Indra edits |
| `software/voice/` | Voice control — separate workstream |
| `.github/workflows/` | CI/CD — only Indra edits |

---

## Pi Access

| Method | Address |
|---|---|
| SSH | `ssh sipher@192.168.1.35` (password: `marin26`) |
| Tailscale | `ssh sipher@100.95.37.114` |
| Dashboard (when running) | `http://192.168.1.35:5001` |
| Bridge API | `http://192.168.1.35:5001/api/sensors` |

---

## Daily Workflow

1. `git pull origin main` — get latest
2. `cd dashboard && npm run dev` — start dashboard locally
3. Make changes
4. `npm run build` — verify it builds
5. `git add -A && git commit -m "your message" && git push origin main`

---

## Key Contacts

- **Indra** — Hardware, firmware, architecture, deployment
- **Pi hostname:** `sipher` (192.168.1.35)
- **Repo:** https://github.com/indrajithmechatron/sipher
