# Robot Runtime Layer

**Layer 2** of the Sipher architecture. See `docs/ARCHITECTURE.md` for full spec.

## Key Files

- `pico_bridge.py` — USB-serial ↔ TCP bridge. Owns `/dev/ttyACM0`. TCP on port 5000, HTTP on port 5001.

## Critical Rule

Only `pico_bridge.py` may open `/dev/ttyACM0`. No other process touches the serial port.
