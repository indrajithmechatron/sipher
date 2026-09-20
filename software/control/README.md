# Control Layer

**Layer 4** of the Sipher architecture. See `docs/ARCHITECTURE.md` for full spec.

## Key Files

- `command_endpoint.py` — HTTP server on port 5001: serves dashboard, `/api/sensors`, `/api/bridge_cmd`, `/command`
- `joint_limits.py` — (planned) min/max angles per servo
- `inverse_kinematics.py` — (planned) foot trajectory from body velocity
- `gait_generator.py` — (planned) tripod, wave, trot patterns
- `emergency_stop.py` — (planned) software E-Stop

## Running

```bash
PYTHONPATH=/home/sipher/sipher/software python3 -m control.command_endpoint
```

Systemd: `deploy/systemd/sipher-command-endpoint.service`
