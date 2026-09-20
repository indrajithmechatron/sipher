# Control Layer

**Layer 4** of the Sipher architecture.

## Responsibility

Inverse kinematics, gait generation, joint limit enforcement, posture stabilization, and emergency-stop logic.

## Contract

- **Inbound:** Validated motion commands from ROS 2 (`/cmd_vel` → `geometry_msgs/Twist`)
- **Outbound:** Joint angle targets (12 servos) to firmware via `software/robot/pico_bridge.py`
- **Safety:** Every angle must pass through limit validation before being sent to firmware
- **IMU feedback:** Uses MPU6050 data for real-time posture correction
- **Obstacle avoidance:** Uses VL53L0X range data to halt or redirect

## Files

- `joint_limits.py` — min/max angles per servo, rate-of-change limits
- `inverse_kinematics.py` — foot trajectory from body velocity/rotation
- `gait_generator.py` — tripod, wave, trot patterns
- `emergency_stop.py` — software E-Stop (250 ms heartbeat timeout)
- `posture_stabilizer.py` — IMU-based gait adjustment
- `command_endpoint.py` — Pi-side HTTP server (port 8888): command execution for Hermes, live sensor dashboard, bridge command forwarder

## Interface

|| Direction | Protocol | Endpoint |
||---|---|---|
|| Layer 3 → Layer 4 | ROS 2 subscription | `/cmd_vel` (`geometry_msgs/Twist`) |
|| Layer 4 → Layer 2 | Validated joint targets | Through `pico_bridge.py` |
|| Layer 4 → Layer 5 | Joint angle array | JSON serial → Pico |
|| Hermes → Control | HTTP POST | `/command` (restricted shell) |
|| Dashboard → Control | HTTP GET | `/api/sensors` (live sensor snapshot) |
|| Dashboard → Control | HTTP POST | `/api/bridge_cmd` (forward to bridge) |

## Status

Scaffolding — see `docs/architecture.md` for migration phases.

## Command Endpoint

`control/command_endpoint.py` — single HTTP server on port 8888:

**POST /command** — run a restricted shell command (whitelist only):
```json
{"command": "python3 -c \"...\"", "timeout": 30}
```
Response: `{"rc": 0, "stdout": "...", "stderr": ""}`

**GET /api/sensors** — latest sensor snapshot from Pico serial:
```json
{"mpu": [ax,ay,az,gx,gy,gz], "vl53_mm": 1234, "ina": {...}, "gps": "...", "i2c_scan": ["0x40","0x68","0x29","0x41"]}
```

**GET /dashboard** — live sensor dashboard (HTML).

**POST /api/bridge_cmd** — forward command to `pico_bridge` TCP server (port 5000).

Run: `PYTHONPATH=/home/sipher/sipher/software python3 -m control.command_endpoint`

Systemd service: `deploy/systemd/sipher-command-endpoint.service`
