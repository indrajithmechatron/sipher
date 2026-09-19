# Robot Runtime Layer

**Layer 2** of the Sipher architecture.

## Responsibility

Single-owner access to `/dev/ttyACM0`, command validation, safety state machine, and telemetry publishing to ROS 2.

## Contract

- **Inbound:** Structured action requests from `software/voice/` (Layer 1)
- **Outbound:** Parsed sensor telemetry to ROS 2 topics; acknowledgments to Layer 1
- **Serial:** Owns `/dev/ttyACM0` exclusively — no other process may open it
- **Safety:** Validates every command against robot state before forwarding

## Files

- `pico_bridge.py` — hardware bridge (serial owner, JSON transport)
- `state_machine.py` — robot state (idle / moving / stopped / e-stop)
- `command_validator.py` — validates incoming requests

## Interface

| Direction | Protocol | Endpoint |
|---|---|---|
| Layer 1 → Layer 2 | Structured request (dataclass / JSON) | Local socket or ROS 2 topic |
| Layer 2 → Layer 3 | ROS 2 pub/sub | `/sensor/imu`, `/sensor/gps`, `/sensor/power` |
| Layer 2 → Layer 5 | JSON serial | `/dev/ttyACM0` (owned) |

## Status

Scaffolding — see `docs/ARCHITECTURE.md` for migration phases.
