# Plan: ROS 2 (full rewrite) + n8n + Node-RED for Sipher

Status: **APPROVED — path: full native ROS 2 rewrite (owner decision, 2026-11-03)**
Target host: Raspberry Pi 4B (4 GB), Ubuntu 24.04.5 LTS aarch64, `192.168.1.37`
Date: 2026-11-03

## 0. Owner decisions (2026-11-03)

| Decision | Choice |
|---|---|
| ROS 2 integration | **Full native rewrite** (phased, robot stays working at each cutover) |
| n8n / Node-RED install | Docker containers (ROS 2 stays native apt) |
| n8n vs Node-RED split | Node-RED = robot glue (real-time), n8n = apps (alerts/reports/AI) |
| **Fast locomotion loop** | **Hybrid, two-step** — Step 1: gait engine as ROS 2 node on Pi (50 Hz ros2_control stream); Step 2: later phase ports proven gait loop into Pico firmware as primitives + serial watchdog (Pi silent >200 ms → hold stance/relax). E-stop + command watchdog already offline in firmware. |
| **Offline voice** | **Local only** — faster-whisper tiny on the Pi (already in repo) + espeak/piper replies; Groq is an optional online upgrade, never required |

**Governing rule:** nothing in the safety or locomotion loop leaves the robot.
Cloud (Groq/n8n) handles only non-critical jobs: alerts, reports, optional voice boost.

---

## 1. Goal

Rebuild the Pi-side robot stack as **native ROS 2 (Jazzy)** nodes, and add an
automation layer:

- **ROS 2 Jazzy** — native driver/control/diagnostic nodes, ros2_control, rosbag2,
  TF, lifecycle + launch management, ecosystem tooling (rqt, PlotJuggler, RViz2).
- **Node-RED** — robot-side flow glue (real-time decisions, sensor triggers).
- **n8n** — application automation (alerts, scheduled reports, AI/Groq calls).

Owner decision: the full rewrite is preferred over the bridge-layer approach because
**the completed end state is strictly better** (ros2_control, rosbag2, QoS, uniform
node graph). Executed in phases with cutover points so the robot stays operational.

## 2. Inherent constraints (shape the whole design)

1. **The Pico cannot run ROS 2** — MicroPython, 264 KB RAM. A serial link to the Pi
   always exists. The rewrite makes the Pi-side endpoint of that link a *native ROS 2
   driver node* instead of a TCP JSON forwarder. **The firmware protocol is unchanged**
   (pico_main.py CMD_MAP stays; it is already a clean request/response JSON contract).
2. **The web layer cannot become ROS 2** — ROS 2 has no auth/sessions/RAG.
   `command_endpoint` survives as an **HTTP gateway**, but its backend is re-implemented
   over rclpy so `/api/*` keeps the same shape → dashboard stays working through the
   entire migration.
3. **Exclusive serial ownership** — `/dev/sipher-pico` can be owned by only one
   process. Cutover = stop `sipher-bridge`, start `sipher_driver` (robot at rest,
   servos relaxed — safe, seconds long).

## 3. Target architecture

```
                   ┌──────────────────── Pi 4B (Ubuntu 24.04) ────────────────────┐
                   │                                                              │
 Pico (MicroPython)│   ┌─────────────────────── ROS 2 Jazzy ───────────────────┐  │
 sensors, servos,  │   │  sipher_driver   serial /dev/sipher-pico              │  │
 I2C, nRF, GPS ◄───┼──►│   ├─ pub /sensors /imu /range /battery /tf            │  │
 (USB serial,      │   │   └─ sub /servo_cmd /servo_cmds /relax                │  │
  protocol kept)   │   │  sipher_control  /estop (latched) services, relax      │  │
                   │   │  sipher_diagnostics  pub /diagnostics 1 Hz             │  │
                   │   │  sipher_voice / sipher_instincts  (nodes, later phase) │  │
                   │   │  ros2_control (SystemInterface) + joint_state_broadcaster│ │
                   │   │  rosbag2 recorder  ── replaces sipher-logger           │  │
                   │   │  launch + lifecycle  ── one systemd unit               │  │
                   │   └──────────┬─────────────────────────┬───────────────────┘  │
                   │              │ rclpy                   │ rosbridge :9090      │
                   │   ┌──────────▼──────────┐              │                      │
                   │   │ command_endpoint     │              │                      │
                   │   │ :8888 HTTP gateway   │              │                      │
                   │   │ (auth, sessions, RAG │              │                      │
                   │   │  unchanged outside)  │              │                      │
                   │   └──────────┬───────────┘              │                      │
                   │              │ /api (same shape)        │                      │
                   │              ▼                          ▼                      │
                   │         dashboard ◄── roslib/WebSocket (final phase)           │
                   │                                                              │
                   │   ┌────────────── Docker ──────────────┐                     │
                   │   │ Node-RED :1880  (robot glue)       │◄── rosbridge/HTTP    │
                   │   │ n8n       :5678 (apps, alerts)     │◄── webhook           │
                   │   └────────────────────────────────────┘                     │
                   └──────────────────────────────────────────────────────────────┘
```

## 4. Resource budget (4 GB / 25 GB free)

| Component | RAM (idle→active) | Disk |
|---|---|---|
| ROS 2 `ros-base` + sipher nodes + rosbag2 | 300 → 550 MB | ~2.2 GB |
| Docker Engine | ~70 MB | ~500 MB |
| Node-RED container (`mem_limit 256m`) | 80 → 150 MB | ~150 MB |
| n8n container (`mem_limit 512m`) | 200 → 400 MB | ~400 MB |
| command endpoint + dashboard proxy | ~120 MB | — |
| **Total** | **~0.8 → 1.3 GB** of 3.7 Gi | ~3.3 GB of 25 GB |

Safety: 2 GB swapfile (phase R0), container memory limits, `ros-base` not `desktop`.

## 5. ROS 2 design

### Distro & install
- **ROS 2 Jazzy Jalisco** — official pairing for Ubuntu 24.04, aarch64 apt binaries.
- Packages: `ros-jazzy-ros-base`, `ros-jazzy-diagnostic-msgs`, `ros-jazzy-tf2-ros`,
  `ros-jazzy-sensor-msgs`, `ros-jazzy-ros2-control`, `ros-jazzy-ros2-controllers`,
  `ros-jazzy-rosbridge-suite`, `ros-jazzy-rosbag2`, `python3-colcon-common-extensions`.
- RMW: Fast DDS default; all nodes on one host → `ROS_LOCALHOST_ONLY=1` (removes
  multicast/WiFi discovery risk entirely).

### Package layout (new, in repo)

```
ros2_ws/src/sipher_ros/
├── package.xml / setup.py / setup.cfg
├── sipher_ros/
│   ├── driver.py             # serial driver node (replaces pico_bridge TCP path)
│   ├── control.py            # /servo_cmd, /estop (latched), relax, services
│   ├── diagnostics.py        # diagnostic_msgs/DiagnosticArray @1 Hz
│   └── hw_interface.py       # ros2_control SystemInterface (phase R3b)
├── config/
│   ├── sipher.params.yaml    # serial port, baud, rates, channel map
│   └── ros2_controllers.yaml
└── launch/
    ├── sipher.launch.py      # driver + control + diagnostics + rosbag2
    └── bringup.launch.py     # + ros2_control + controllers
```

### Topic contract (stable across all phases — nothing built on it rechanges)

| Topic / service | Type | QoS | Content |
|---|---|---|---|
| `/sensors` | `sensor_msgs/JointState` | sensor (best-effort, d1) | 12 joints + readback pulses |
| `/imu` | `sensor_msgs/Imu` | sensor | MPU6050 pitch/roll/yaw |
| `/range` | `sensor_msgs/Range` | sensor | VL53L0X mm |
| `/battery` | `sensor_msgs/BatteryState` | reliable, 1 Hz | INA219 V/I/P |
| `/gps` | `sensor_msgs/NavSatFix` | reliable | GPS when fix |
| `/tf`, `/tf_static` | `tf2_msgs/TFMessage` | dynamic + static | odom → base_link → 4×(hip,knee,ankle) |
| `/servo_cmd` | `sipher_msgs/ServoCmd` (ch, deg) | reliable, d10 | single command |
| `/servo_cmds` | `sipher_msgs/ServoCmd[]` | reliable, d1 | gait frame batch |
| `/relax` | `std_msgs/Empty` | reliable, d1 | relax all servos |
| `/estop` | `std_msgs/Bool` | **transient_local**, d1 | latched; any node asserts; driver refuses motion while true |
| `/diagnostics` | `diagnostic_msgs/DiagnosticArray` | reliable, 1 Hz | bus health, device presence, ages |
| `/sipher/heartbeat` | `std_msgs/Heartbeat` | reliable, 1 Hz | node liveness |
| `~/set_estop`, `~/clear_estop` | `std_srvs/SetBool` | — | services for gateway/Node-RED |

Custom msgs in `sipher_msgs` package (ServoCmd, ServoCmdArray, SipherEvent).

### ros2_control (phase R3b)
- `SystemInterface` implementation wrapping the serial protocol (write: pulse widths;
  read: PCA9685 readback).
- Controllers: `joint_state_broadcaster` → `/joint_states`, `forward_command_controller`
  → `/servo_cmds`. Gait/trajectory controllers plug in later without touching the driver.

### Process management
- One systemd unit `sipher-ros.service` → `ros2 launch sipher_ros bringup.launch.py`,
  `Restart=always`, `After=` nothing (it now *owns* the serial port; `sipher-bridge`
  is stopped and disabled at cutover).
- rosbag2 record baked into launch (`--all` topics, 7-day rotation via
  `rosbag2_storage` split + cron cleanup).

## 6. Migration sequence — robot stays working at every step

The existing stack (`sipher-bridge` TCP, `command_endpoint` HTTP API, dashboard)
runs until each piece is cut over. HTTP API shape is preserved throughout, so the
dashboard only changes in its own dedicated final phase.

| Cutover | Old | New | Downtime |
|---|---|---|---|
| R2 | `sipher-bridge` owns serial | `sipher_driver` owns serial | ~10 s (servos relaxed) |
| R4 | endpoint → TCP :5000 | endpoint → rclpy | endpoint restart, ~5 s |
| R6 | `sipher-logger` | rosbag2 | none (both run briefly) |
| R8 | `sipher-bridge` unit disabled | retired | none (already stopped) |
| R7 | dashboard `/api` polling | roslib/rosbridge | dashboard-only deploy |

## 7. Automation layer (n8n + Node-RED) — unchanged from v1

- Docker Engine via official repo; compose at `deploy/docker/stack.yml`.
- **Node-RED :1880** (robot glue) — flows in git at `deploy/nodered/flows.json`,
  bind-mounted read-only. Initial flows: e-stop fan-out, battery <5.5 V watch,
  sensor watchdog, presence events. Talks to ROS via rosbridge `ws://localhost:9090`
  and/or gateway webhooks.
- **n8n :5678** (apps) — SQLite volume, owner account on first run, credentials in
  n8n store + `0600` `.env` (Telegram/SMTP/Groq), never in git. Initial workflows:
  alert relay (Telegram/email), daily telemetry report (cron), optional Groq log
  summarization.
- **Division rule:** real-time *decisions* in Node-RED; human *notification/scheduling*
  in n8n; exactly one webhook between them (`POST /webhook/sipher-event`).

## 8. Security & network

| Port | Service | UFW scope |
|---|---|---|
| 1880/tcp | Node-RED | LAN + `100.64.0.0/10` |
| 5678/tcp | n8n | LAN + Tailscale |
| 9090/tcp | rosbridge | LAN + Tailscale |
| 7400–7500/udp+tcp | DDS | LAN only (largely moot with `ROS_LOCALHOST_ONLY=1`) |
| 22, 8888 | unchanged | as deployed |

- No `--privileged` containers; Node-RED/n8n get no device access.
- n8n: owner account + strong password at first run, public signup disabled.
- Node-RED: admin password set (`credentialSecret` + HTTP auth) before exposure.
- Dashboard remains behind existing session auth; rosbridge is not exposed to WAN.

### Owner non-negotiables (directives, 2026-11-03)

These override schedule pressure — no phase ships without all three.

**1. Encryption, safety, security** — "don't compremise in encryption, safety and security"
- Remote access only over **Tailscale (WireGuard)** or LAN — never plain Internet.
- n8n + Node-RED get **HTTPS before their ports open** (R5 gate): n8n via TLS env,
  Node-RED via `settings.js` https, or `tailscale serve` (valid certs on tailnet).
- **DDS never leaves the Pi** (`ROS_LOCALHOST_ONLY=1`). Any future remote ROS access
  requires **SROS2 enclaves** (signed keys) + authenticated rosbridge — R7 gate.
  rosbridge binds tailscale/LAN only, never open to a hostile network.
- Nothing secret in git, ever. Keys live in `0600` files or systemd
  `EnvironmentFile=` (root/sipher-only), loaded at runtime — never inline, never
  committed. Windows side: DPAPI (already used for the AI password).
- Safety interlocks: firmware e-stop IRQ authoritative (relax_all in hardware);
  driver refuses motion while `/estop` asserted; serial watchdog (Pi silent
  >200 ms → hold stance, R12); every inbound path validates JSON object, size
  cap (4 KB), channel 0–15, degrees clamped 0–180 — no blind passthrough.
- systemd hardening on `sipher-ros`: `NoNewPrivileges`, `PrivateTmp`,
  `Restart=always`; extend with `ProtectControlGroups`/`RestrictAddressFamilies`
  once serial+DDS verified stable.
- **Gate rule:** a phase's ports are firewall-opened only after its auth is verified
  (R5 UIs, R7 rosbridge each have a security checkpoint).

**2. Efficiency & productivity** — "don't compremise in effeciency and productivuty"
- Locomotion loop stays low-latency: gait engine at **50 Hz** on the Pi (R8),
  then Pico-side primitives + 200 ms serial watchdog (R12) so walking never
  depends on Pi scheduling jitter.
- No chatty bridges in the hot path — once R4 lands, commands go
  `endpoint → rclpy → /servo_cmd → driver → serial` (single hop fewer than the
  old TCP:5000 relay).
- Build/test automation stays one-command (`colcon build`, unittest discover,
  `update.sh`) so iteration time stays short; phases are checkpointed so no work
  is redone.

**3. Unique UI/GI** — "don't compremise in UI and GI, let it be the unique one"
- Dashboard visuals are a **signature asset**: the DigitalTwin/estop/admin-gate
  work continues and gets *richer* in R7 (roslib live data), not flattened into
  a generic ROS panel.
- n8n/Node-RED styling (R5–R6) follows the existing dark/amber Sipher identity;
  no stock default theme ships to the owner.
- No layout regressions: existing dashboard layout is frozen except for additive
  live-data improvements.

## 9. Execution phases

Each phase ends with a verifiable checkpoint and is individually revertible.

| # | Phase | Checkpoint |
|---|---|---|
| **R0** | 2 GB swapfile + Docker Engine | `swapon --show`; `docker run hello-world` |
| **R1** | ROS 2 Jazzy `ros-base` + deps apt install | `ros2 doctor` pass; `ros2 pkg list` works |
| **R2** ✅ 2026-11-03 | `sipher_msgs` + `sipher_driver` node; **serial cutover** | `ros2 topic echo /sensors` streams live Pico data ✅ (0.99 Hz); `ros2 topic pub /servo_cmd` moved ch0 90→70→90° ✅; rosbag2 `bags/r2_checkpoint_bag` ✅; bridge stopped/disabled, `sipher-ros` active; legacy TCP:5000 + HTTP:5001 verified. *Gotcha fixed: never run `ros2` as root (FastDDS `/dev/shm` ownership) — see `ros2_ws/README.md`* |
| **R3** ✅ 2026-11-03 | `sipher_control` (/estop latched, relax, services) + `sipher_diagnostics` | `/estop` asserted via `set_estop` → driver refuses motion (dropped servo_cmd, ch0 held at 90°) ✅; `clear_estop` → servo moved ✅; `/diagnostics` all devices OK @1 Hz ✅; latched `/estop_cmd` survives driver restart |
| **R3b** ✅ 2026-11-03 | ros2_control `SystemInterface` + `joint_state_broadcaster` | `/joint_states` streams 16 ch ✅; joint_state_broadcaster + forward_controller switch via `ros2 control` ✅; full chain verified: `forward_controller/commands` (BEST_EFFORT) → hardware `write()` → `/servo_cmds` (50 Hz) → driver → servo moved 88→70→90° ✅. *Caveats: forward controller rejects NaN (full 16-element arrays required); controller_manager overrun ~23-50 ms write time flagged for R8 perf; serial stays single-owner* |
| **R4** ✅ 2026-11-03 | `command_endpoint` backend → rclpy gateway (**HTTP API unchanged**) | `/api/bridge_cmd` returns `{bridge_ack, forwarded, cmd, ts}` ✅; servo moved via ROS ✅; inbound validation: JSON/4KB/ch 0-15/deg clamped 0-180 ✅; 12 unit tests green ✅; systemd unit sources ROS setup + ros2_ws install |
| **R5** | Node-RED + n8n Docker stack + UFW rules | both UIs login via LAN; containers healthy |
| **R6** | Initial flows/workflows (estop, battery, watchdog, report) | simulated event → alert received (or console fallback if no Telegram/SMTP yet) |
| **R7** | Dashboard → roslib/rosbridge (phases R5–R6 usable meanwhile) | twin renders from `/sensors`; servo input over ROS |
| **R8** | **Gait engine v1 (Step 1 of hybrid): ROS 2 node on Pi** — creep/trot gait generator → `/servo_cmds` @50 Hz, best-effort QoS; commands `walk_forward/turn/stand/sit` as ROS services | robot walks a commanded step count in open space; PlotJuggler shows stable 50 Hz stream; `/estop` mid-walk → relax within one cycle |
| **R9** | **Offline voice: faster-whisper tiny local** — voice node on ROS (STT → intent → same walk/stand services); espeak/piper replies | spoken "walk forward" → gait runs, with no network |
| **R10** | voice + instincts → ROS nodes; `sipher-logger` → rosbag2 | `rqt_graph` shows full graph; bags rotating |
| **R11** | `sipher-bridge` disabled/retired; launch + lifecycle hardening | reboot → full stack up via one unit |
| **R12** | **Gait Step 2 (hardening): port proven gait loop to Pico primitives** — firmware `walk/turn/stand/sit` + serial watchdog (Pi silent >200 ms → hold stance) | gait continues if Pi rebooted mid-walk; watchdog test: yank Ethernet → robot holds stance |
| **R13** | Docs, README, tests, commit/push, Pi deploy | `update.sh` clean; tests green |

Estimated: **~1.5–2 weeks** of focused work with hardware iteration (R2–R4 are the
critical path; R5–R6 are independent and can interleave).

## 10. Risks & mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Serial cutover conflict | Driver + bridge both open port | Bridge stopped *before* driver starts; systemd drop-in ordering; single-owner rule documented |
| Serial reopen after USB re-enumeration (known EIO bug, fixed in bridge f3f6c24) | Driver dies on Pico reset | Port the reopen/retry logic from `pico_bridge.py` into `driver.py` — it's proven |
| RAM spike | OOM | swapfile + `mem_limit` + `ros-base`; rosbag2 buffer capped |
| DDS discovery issues | Nodes don't see each other | `ROS_LOCALHOST_ONLY=1` (all nodes on one host) |
| Dashboard regression | UI breaks | HTTP API shape frozen until R7; R7 is dashboard-only deploy, revertible |
| Two-week migration drift | Robot unavailable | Every phase checkpointed; old stack alive until its cutover; rollback = restart old unit |
| ros2_control hw interface bugs | Servo misbehavior | R3b is additive; forward_command_controller path works without it |

## 11. Out of scope (this iteration)

- Nav2 / SLAM / MoveIt — topic contract and ros2_control prepare for these.
- RT kernel / hard real-time guarantees — soft-real-time is fine for current rates.
- Rewriting the **Pico firmware** in C/C++ with micro-ROS — explicitly not now
  (MicroPython firmware is stable and tested; micro-ROS on RP2040 is a separate project).
- n8n/Node-RED HA or multi-host.
- GitHub-side purge of cached pre-rewrite git objects (separate task).

## 12. Approval

- [x] Owner approves full ROS 2 rewrite path (2026-11-03) — "if ROS2 successfully done
      is better than the bridge, then lets go with ROS2"
- [x] Owner approves plan (2026-11-03) — "approved both"
- [x] Notifications: **no Telegram/SMTP yet** → R6 uses console/webhook-only alert
      fallback; Telegram/SMTP wired later when creds are supplied
