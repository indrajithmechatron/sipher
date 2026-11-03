# Sipher: review and ROS 2 rewrite suggestions

Date: 2026-11-03

---

## 1. Repository review (from the README)

- **Two ROS 2 locations.** The repo has a root-level `ros2_ws/` and also `software/ros2/`, which the README calls a scaffold with no `sipher_hardware` package yet. Pick one home for the rewrite so the layer docs and the code agree.
- **Safety ordering.** E-stop, gait and IK are marked "planned", while voice still actuates the servos directly. With 12 servos on a legged robot, build the E-stop and a single command gate before adding more input paths.
- **`/command` auth is optional.** Without `SIPHER_COMMAND_TOKEN`, any loopback or private-network client is accepted. Make the token mandatory. The argv-table and `shell=False` design is already solid.
- **Auto-deploy from `main`.** A broken commit gets pulled onto the robot. A `release` branch or tags, with a rollback step in `update.sh`, would be safer.
- **CI covers security scans only.** Add a dashboard build, lint, and the `rag` unit tests to catch regressions before deploy.
- **README drift.** The structure tree omits `ros2_ws/` and `tailscale-acl.json`. Also check that the ACL file doesn't expose emails or node details in a public repo.
- **Housekeeping.** There is no LICENSE file, and the repo is public with no releases or tags.

---

## 2. ROS 2 rewrite plan

Target architecture:

```
Pico (MicroPython) <-serial-> pico_bridge <-TCP-> ROS 2 layer <-> dashboard / automations
                                        ^
                    +-------------------+-------------------+
              ros2_bridge node     Node-RED flows         n8n workflows
              (topics: /sensors,    (robot logic glue,     (notifications,
               /servo_cmd, /tf,      MQTT/HTTP flows)       logging, AI,
               /estop)                                     calendar, email)
```

- ROS 2 Jazzy: a `sipher_ros` package with a bridge node translating the existing Pico JSON protocol to ROS topics (`/sensors`, `/joint_states`, `/servo_cmd`, `/estop`, `/tf`). Existing services keep running; ROS layers on top.
- Node-RED: robot-side flow logic (lightweight, IoT-native, flows live in git).
- n8n: heavier app automation (alerts via email/Telegram, scheduled reports, AI/Groq calls).

### Key concerns

1. **RAM (4 GB total).** n8n is the real cost, often well over 200 MB once workflows are active. Run n8n on the Windows PC or another always-on machine and reach it over Tailscale; keep only ROS 2 and (optionally) Node-RED on the Pi. Use zram rather than swap on the SD card, which is slow and wears the card.
2. **Overlap between n8n and Node-RED.** Split by where a flow runs. Node-RED handles local, real-time reactions with no internet. n8n handles anything that leaves the robot (Telegram or email alerts, reports, Groq calls). Node-RED never calls external APIs, and n8n never subscribes to high-rate topics; it only receives low-rate events like `battery_low` or `estop_triggered` via webhook or MQTT. Consider whether Node-RED is needed at all: small Python ROS nodes may cover the local logic. Start with ROS + n8n and add Node-RED once a flow justifies it.
3. **Install method.** ROS 2 Jazzy native (`ros-jazzy-ros-base`, not desktop) fits Ubuntu 24.04. Node-RED works native via npm. Docker would mainly be for n8n, another reason to move n8n off the Pi.

### Changes to the ROS design

- **One owner of the serial port.** The README says `software/robot` is the sole owner of `/dev/ttyACM0`, so `sipher_ros` connects over TCP and never opens the serial device itself.
- **Standard message types instead of one `/sensors` topic.** `sensor_msgs/Imu` for the MPU6050, `BatteryState` for the INA219, `Range` for the VL53L0X, `NavSatFix` for the GPS.
- **`/tf` does not come from the bridge.** `robot_state_publisher` produces it from `/joint_states` plus a URDF with 12 joints (4 legs x hip/thigh/calf), so a URDF is part of the work.
- **`/joint_states` will be commanded positions.** PCA9685 hobby servos have no position feedback, so the topic reports where the servos were told to go, not where they are.
- **`/estop` needs latched QoS** (reliable, transient_local). The bridge stops forwarding `/servo_cmd` when the e-stop is active or when commands go stale. The Pico-side watchdog and any hardware e-stop stay authoritative, independent of ROS.
- **Only the bridge writes joint-level commands.** Node-RED and n8n call high-level actions (stand, sit, stop) and never publish `/servo_cmd`. Otherwise there are three writers on 12 servos.
- **Set `ROS_AUTOMATIC_DISCOVERY_RANGE=LOCALHOST`** on the Pi to stop DDS discovery chatter over Wi-Fi and Tailscale.
- **Pick one home for the code.** Choose either `ros2_ws/src/sipher_ros` or `software/ros2`, then delete the other so the docs match.

### Next step

Provide the `software/robot` bridge file and one example each of the Pico's JSON messages (sensor out, servo command in, estop). Then write the `sipher_ros` package: bridge node, launch file, URDF skeleton and a systemd unit.

Open question: which servo joint ordering and channel mapping does the PCA9685 use?
