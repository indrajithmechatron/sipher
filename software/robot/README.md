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

## Systemd

| Unit | Location |
|---|---|
| `sipher-instincts.service` | `deploy/systemd/` (installed on the Pi) |
| `sipher-bridge.service` | Installed directly on the Pi |
