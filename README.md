# Sipher — Quadruped Robot

A four-legged (quadruped) spider-style robot built with Raspberry Pi 4 + Pico 2 W (RP2350).

## Hardware

| Component | Role |
|---|---|
| Raspberry Pi 4 | Main computer (Ubuntu 24.04, hostname `sipher`) |
| Pico 2 W | Real-time sensor/actuator controller (MicroPython 3.4) |
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
│   ├── robot/               # Layer 2 — serial bridge + instincts
│   ├── ros2/                # Layer 3 — ROS 2 middleware (planned)
│   ├── control/             # Layer 4 — command endpoint, gait/IK (planned)
│   ├── firmware/            # Layer 5 — Pico 2 W MicroPython
│   └── telemetry/           # Layer 6 — data logging
├── dashboard/               # React + Vite mission control UI
│   └── src/                 # React components, hooks, Tailwind styles
├── deploy/                  # Pi deployment
│   ├── systemd/             # Service + timer units
│   ├── sudoers.d/           # Narrow sudo rule used by auto-deploy
│   └── udev/                # Pico serial symlink rule
├── docs/                    # Architecture, setup, hardware, and reports
│   ├── hardware/            # Wiring diagram + circuit reference
│   └── reports/             # Inspection + daily development reports
├── README.md
├── .gitignore
└── .gitleaks.toml
```

## Quick Start

```bash
# Dashboard (dev)
cd dashboard && npm install && npm run dev

# Dashboard (build for Pi)
cd dashboard && npm run build
# Then copy dist/ to Pi

# Deploy to Pi
ssh sipher@192.168.1.35 "/home/sipher/deploy/update.sh"
```

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

## Key Documents

| Document | Location | Purpose |
|---|---|---|
| Architecture | `docs/ARCHITECTURE.md` | Layer boundaries, contracts, safety rules |
| Pi Setup | `docs/pi-setup.md` | Raspberry Pi 4 configuration |
| Wiring | `docs/hardware/pico-wiring.md` | Pico 2 W pin mapping and wiring |
| Deploy | `deploy/README.md` | Auto-deploy setup + systemd units |
| Dashboard | `dashboard/README.md` | Dashboard development guide |
| Desktop App | `dashboard/APPLICATION.md` | Install Sipher Dashboard on your PC |
| Reports | `docs/reports/` | Inspection report + daily development notes |
