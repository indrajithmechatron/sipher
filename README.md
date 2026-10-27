# Sipher — Quadruped Robot

A four-legged (quadruped) spider-style robot built with Raspberry Pi 4 + Pico 2 W (RP2350).

## Hardware

| Component | Role |
|---|---|
| Raspberry Pi 4 | Main computer (Ubuntu 24.04, hostname `sipher`) |
| Pico 2 W | Real-time sensor/actuator controller (MicroPython 1.28, RP2350) |
| 12x Servos | 4 legs x 3 DoF (hip, thigh, calf) via PCA9685 |
| MPU6050 | IMU — accelerometer + gyroscope (I2C1 @ 0x68) |
| INA219 | Current/voltage sensor (I2C0 @ 0x41) |
| VL53L0X | Time-of-flight distance sensor (I2C0 @ 0x29) |
| NEO-6M GPS | GPS module (UART0) |
| ILI9341 TFT | 240x320 display (SPI0) |
| nRF24L01+ | 2.4 GHz radio (SPI0) |

## Repository Structure

```
sipher/
├── software/                # Robot software, one folder per architecture layer
│   ├── voice/               # Layer 1 — always-on voice control
│   ├── rag/                 # Layer 1 — BM25 retrieval (/api/rag), stdlib only
│   ├── robot/               # Layer 2 — serial bridge + instincts
│   ├── ros2/                # Layer 3 — ROS 2 middleware (planned)
│   ├── control/             # Layer 4 — command endpoint, gait/IK (planned)
│   ├── firmware/            # Layer 5 — Pico 2 W MicroPython
│   └── telemetry/           # Layer 6 — data logging
├── dashboard/               # React + Vite mission control UI
│   └── src/                 # React components, hooks, Tailwind styles
├── deploy/                  # Pi deployment
│   ├── update.sh            # Auto-deploy: pull main + restart services
│   ├── ssh-key-setup.ps1    # One-time key-only SSH setup from Windows
│   ├── systemd/             # Service + timer units
│   ├── sudoers.d/           # Narrow sudo rule used by auto-deploy
│   └── udev/                # Pico serial symlink rule
├── docs/                    # Architecture, setup, hardware, and reports
│   ├── hardware/            # Wiring diagram + circuit reference
│   └── reports/             # Inspection + daily development reports
├── .github/workflows/       # Gitleaks / Semgrep / OSV security scans
├── README.md
├── .gitignore
└── .gitleaks.toml
```

Runtime-only, gitignored: `.rag/` (retrieval index, rebuilt on demand) and
`.secrets/` (local credentials).

## Quick Start

```bash
# Dashboard (dev)
cd dashboard && npm install && npm run dev      # http://localhost:3000

# Dashboard bundle for the Pi
cd dashboard && npm run build                   # static bundle in dashboard/dist/

# Retrieval (RAG) — build the index, then query it
cd software && python -m rag.cli index
python -m rag.cli search "watchdog timeout" -k 3

# Tests
PYTHONPATH=software python -m unittest discover -s software/rag/tests -t software

# Deploy to the Pi
ssh sipher "/home/sipher/deploy/update.sh"
```

## Retrieval (RAG)

Layer 1 support service answering "what does the repo say about X" with cited
passages. Offline Okapi BM25 over `README`/`docs`/`software`/`dashboard/src`/
`deploy`, `docs/reports`, the telemetry log and ingested manuals — standard
library only, no model downloads, safe on the Pi 4.

```bash
curl "http://<pi>:8888/api/rag/search?q=watchdog%20timeout&k=3"
curl "http://<pi>:8888/api/rag/context?q=how%20does%20deploy%20restart"
curl -X POST "http://<pi>:8888/api/rag/ingest" -H "Content-Type: application/json" \
     -d '{"name":"hip-servo.pdf","text":"Stall torque 15 kg-cm at 6 V ..."}'
```

Full API, corpus rules, CLI and configuration: `software/rag/README.md`.

## Security

- **No credentials in this repository.** The dashboard's AI backend password is
  generated per user and stored outside the tree (`%LOCALAPPDATA%\Sipher\` on
  Windows, `~/.config/sipher/` elsewhere), DPAPI-encrypted or `0600`.
- **AI backend is loopback-only** (`127.0.0.1:4096`); the Vite proxy injects
  Basic auth, so the password never reaches the browser.
- **Key-only SSH** to the Pi: run `deploy/ssh-key-setup.ps1`, then re-run with
  `-DisablePasswordAuth`. The OS password stays valid on the physical console.
- **`/command` is not a shell.** Requests are parsed with `shlex` and matched to
  an argv table (`systemctl` on `sipher-*` units, read-only `git`, `cat` inside
  the repo/log dir, `tailscale`), executed with `shell=False`. Set
  `SIPHER_COMMAND_TOKEN` to require `X-Sipher-Token`; without it only
  loopback/private clients are accepted.
- **CI scans** (`.github/workflows/security.yml`) run Gitleaks over full
  history, Semgrep SAST and the OSV dependency scan on every push.
- Leaked values were purged from history with `git filter-repo`; rotate any
  credential that was ever committed, since force-pushing does not revoke it.

## Desktop Application

The dashboard installs as a Windows desktop app (standalone Edge window,
auto-restarting server, startup entry). See **`dashboard/APPLICATION.md`**.

```powershell
cd dashboard
npm install
npm run build
powershell -ExecutionPolicy Bypass -File .\Install-DesktopShortcut.ps1
```

> **New machine / partner setup:** after cloning, run the install script above
> once to put **Sipher Dashboard** on your Desktop. Full steps are in
> `dashboard/APPLICATION.md`.

## Architecture

See `docs/ARCHITECTURE.md` for the full 6-layer architecture definition.

| Layer | Folder | State |
|---|---|---|
| 1 — AI / Voice / Dashboard | `software/voice/`, `software/rag/`, `dashboard/` | Active (voice still actuates directly; Phase 4) |
| 2 — Robot Runtime | `software/robot/` | Active — sole owner of `/dev/ttyACM0` |
| 3 — ROS 2 Middleware | `software/ros2/` | Scaffold — `sipher_hardware` package not created |
| 4 — Control | `software/control/` | Command endpoint active; gait, IK and E-stop planned |
| 5 — Firmware | `software/firmware/` | Active — Pico 2 W watchdog + sensor loop |
| 6 — Telemetry | `software/telemetry/` | Active — logs to `/home/sipher/sipher.log` |

## Key Documents

| Document | Location | Purpose |
|---|---|---|
| Docs index | `docs/README.md` | Map of every document in the tree |
| Architecture | `docs/ARCHITECTURE.md` | Layer boundaries, contracts, safety rules |
| Pi Setup | `docs/pi-setup.md` | Raspberry Pi 4 configuration |
| Wiring | `docs/hardware/pico-wiring.md` | Pico 2 W pin mapping and wiring |
| Deploy | `deploy/README.md` | Auto-deploy setup + systemd units |
| RAG | `software/rag/README.md` | Retrieval API, corpus, CLI |
| Dashboard | `dashboard/README.md` | Dashboard development guide |
| Desktop App | `dashboard/APPLICATION.md` | Install Sipher Dashboard on your PC |
| Reports | `docs/reports/` | Inspection report + daily development notes |
