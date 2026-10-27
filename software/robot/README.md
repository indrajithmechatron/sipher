# Robot Runtime Layer

**Layer 2** of the Sipher architecture. See `docs/ARCHITECTURE.md` for full spec.

## Key Files

| File | Purpose |
|---|---|
| `pico_bridge.py` | USB-serial ↔ TCP bridge. Owns `/dev/ttyACM0`. TCP on port 5000, HTTP on port 5001. |
| `instincts.py` | Reactive behaviours (flinch, balance, battery guard, idle life) with safety governor. |
| `tof_mapper.py` | 2D occupancy grid built from the VL53L0X ToF reading + IMU heading. |

## Critical Rule

Only `pico_bridge.py` may open `/dev/ttyACM0`. No other process touches the serial port.

## Interfaces

| Surface | Address | Purpose |
|---|---|---|
| JSON lines (TCP) | `:5000` | Sensor telemetry out, commands in |
| HTTP | `:5001` | `/sensor`, `/health`, `/map` for the dashboard |
| E-stop HTTP | `127.0.0.1:8899` | `GET /estop`, `GET /clear` — local only, never exposed |

The command endpoint polls `http://localhost:5001/sensor` and forwards operator
commands into the TCP stream, so Layer 4 never opens the serial port itself.

## Configuration

| Variable | Default | Used by |
|---|---|---|
| `SIPHER_BRIDGE_HOST` | `0.0.0.0` | Bridge bind address |
| `SIPHER_BRIDGE_PORT` | `5000` | TCP stream (HTTP uses `port + 1`) |
| `SIPHER_FLINCH_MM` | `300` | Instincts: obstacle distance that triggers a flinch |
| `SIPHER_BATT_FLOOR` | `7.2` | Instincts: voltage that pauses motion |
| `SIPHER_BATT_RESUME` | `7.8` | Instincts: voltage that resumes motion |

## Systemd

| Unit | Location |
|---|---|
| `sipher-instincts.service` | `deploy/systemd/` (installed on the Pi) |
| `sipher-bridge.service` | Installed directly on the Pi |

## Boundaries

- ❌ No kinematics or gait decisions — Layer 4 owns those.
- ❌ No raw sensor bytes leave this layer; everything is parsed JSON.
- ✅ Every command is validated against the current robot state before forwarding.
