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
├── software/
│   ├── firmware/        # Pico 2 W MicroPython code
│   ├── control/         # Pi-side HTTP server + command endpoint
│   ├── robot/           # USB-serial bridge (pico_bridge.py)
│   ├── ros2/            # ROS 2 middleware (planned)
│   ├── voice/           # Voice control (planned)
│   └── telemetry/       # Data logging
├── dashboard/           # React + Vite mission control UI
│   ├── src/             # Source (React components, Tailwind)
│   └── dist/            # Built output (static files)
├── deploy/              # Auto-deploy scripts + systemd services
├── docs/                # Architecture, wiring, setup guides
├── marcia/              # Partner handoff docs
└── reports/             # Daily development reports
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

## Architecture

See `docs/ARCHITECTURE.md` for the full 6-layer architecture definition.

## Key Documents

| Document | Location | Purpose |
|---|---|---|
| Architecture | `docs/ARCHITECTURE.md` | Layer boundaries, contracts, safety rules |
| Pi Setup | `docs/pi-setup.md` | Raspberry Pi 4 configuration |
| Wiring | `docs/hardware/pico-wiring.md` | Pico 2 W pin mapping and wiring |
| Deploy | `deploy/README.md` | Auto-deploy setup |
| Dashboard | `dashboard/README.md` | Dashboard development guide |
| Marcia Guide | `marcia/README.md` | Partner responsibilities and setup |
