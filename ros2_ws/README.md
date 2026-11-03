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

## Ops notes (learned the hard way)

### Never run `ros2` CLI as root

FastDDS puts shared-memory transport files in `/dev/shm/fastrtps_*` owned by the
user who first creates them (mode 644). If any `ros2` command ever runs under
`sudo`, root creates those files first — and then **the driver (user `sipher`)
silently loses all data exchange**: publishers/subscribers/services still appear
in the graph (discovery trickles over UDP), but no topic data, no service
replies and no node name cross the boundary. Debugging this cost hours.

Symptoms: `ros2 node list` empty, `ros2 topic echo` hangs, `ros2 service call`
never returns, but legacy HTTP/TCP endpoints work fine.

Recovery:

```bash
sudo pkill -f ros2_daemon
sudo rm -f /dev/shm/fastrtps_*
sudo systemctl restart sipher-ros     # driver recreates SHM as sipher
ros2 daemon stop; ros2 daemon start   # CLI daemon as sipher, then warm up ~5 s
```

All CLI usage in scripts/docs assumes user `sipher`. The systemd unit already
runs the driver as `sipher` (`User=sipher`).

### CLI needs `ROS_LOCALHOST_ONLY=1` to match the unit

The `sipher-ros` unit exports `ROS_LOCALHOST_ONLY=1`; the CLI must set the same
or it won't see the driver's topics (deprecated warning is benign).

### Daemon warm-up

After `ros2 daemon stop`, the first `ros2 node list` may return empty until the
daemon has rediscovered (~5 s). Direct queries (`--no-daemon`, or a scratch
rclpy node) confirm liveness meanwhile.
