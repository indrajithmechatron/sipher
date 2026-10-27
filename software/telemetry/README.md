# Telemetry Layer

**Layer 6** of the Sipher architecture. See `docs/ARCHITECTURE.md` for full spec.

## Key Files

| File | Purpose |
|---|---|
| `pi_logger.py` | Subscribes to the Layer 2 bridge TCP stream (`:5000`) and appends JSON lines to `/home/sipher/sipher.log`. |

## Rules

- Never opens `/dev/ttyACM0` — Layer 2 (`software/robot/pico_bridge.py`) owns the serial port.
- Log path and bridge host/port are configurable via `SIPHER_LOG_FILE`,
  `SIPHER_BRIDGE_HOST`, and `SIPHER_BRIDGE_PORT`.
