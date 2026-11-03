# ROS 2 workspace — Sipher

Native ROS 2 (Jazzy) layer for the Sipher quadruped. See
`docs/plans/ros2-n8n-nodered.md` for the full migration plan.

```
src/
├── sipher_msgs/   custom messages: ServoCmd, ServoCmdArray, SipherEvent
└── sipher_ros/    driver node (owns Pico serial, publishes topics,
                   keeps legacy TCP:5000 / HTTP:5001 alive during migration)
```

## Build (on the Pi)

```bash
source /opt/ros/jazzy/setup.bash
cd ros2_ws
colcon build --symlink-install
source install/setup.bash
ros2 launch sipher_ros sipher.launch.py
```

## Key topics

| Topic | Type | Notes |
|---|---|---|
| `/sensors` | `sensor_msgs/JointState` | ch0..ch15, position in **rad**, effort = pulse µs |
| `/imu` | `sensor_msgs/Imu` | tilt from accel, yaw from firmware |
| `/range` | `sensor_msgs/Range` | VL53L0X, metres |
| `/battery` | `sensor_msgs/BatteryState` | INA219 (percentage = NaN, no gauge) |
| `/gps` | `sensor_msgs/NavSatFix` | NMEA fix |
| `/odom` + TF | `nav_msgs/Odometry` | yaw-only |
| `/estop` | `std_msgs/Bool` | **latched** (transient_local) |
| `/servo_cmd` | `sipher_msgs/ServoCmd` | ch + deg |
| `/servo_cmds` | `sipher_msgs/ServoCmdArray` | one gait frame |
| `/cmd_raw` | `std_msgs/String` | JSON passthrough (any firmware cmd) |

`build/`, `install/`, `log/` are gitignored.
