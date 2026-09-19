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

## Interface

| Direction | Protocol | Endpoint |
|---|---|---|
| Layer 3 → Layer 4 | ROS 2 subscription | `/cmd_vel` (`geometry_msgs/Twist`) |
| Layer 4 → Layer 2 | Validated joint targets | Through `pico_bridge.py` |
| Layer 4 → Layer 5 | Joint angle array | JSON serial → Pico |

## Status

Scaffolding — see `docs/ARCHITECTURE.md` for migration phases.
