# ROS 2 Middleware Layer

**Layer 3** of the Sipher architecture.

## Responsibility

ROS 2 node lifecycle, sensor message publishing, and command topic subscription. Pure middleware — no hardware access, no kinematics.

## Contract

- **Publishes:**
  - `/imu/data` — `sensor_msgs/Imu` (from MPU6050)
  - `/gps/fix` — `sensor_msgs/NavSatFix` (from NEO-6M)
  - `/battery/status` — custom message (from INA219)
  - `/scan` — `sensor_msgs/LaserScan` (from VL53L0X, when driver ready)
- **Subscribes:**
  - `/cmd_vel` — `geometry_msgs/Twist` → translated to joint targets for Control Layer
- **Parameter server:** Runtime configuration (PID gains, gait parameters, limits)

## Package: `sipher_hardware`

ROS 2 package structure (to be created under `software/ros2/sipher_hardware/`):

```
sipher_hardware/
├── package.xml
├── CMakeLists.txt
├── sipher_hardware/
│   ├── __init__.py
│   ├── imu_publisher.py
│   ├── gps_publisher.py
│   ├── battery_publisher.py
│   └── cmd_vel_subscriber.py
```

## Dependency

- ROS 2 Jazzy Jalisco (LTS for Ubuntu 24.04 `noble`)
- Required: `rclpy`, `std_msgs`, `geometry_msgs`, `sensor_msgs`, `robot_state_publisher`

## Status

Scaffolding — see `docs/ARCHITECTURE.md` for migration phases.
