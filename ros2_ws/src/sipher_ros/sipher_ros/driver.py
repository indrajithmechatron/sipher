"""sipher_ros.driver — native ROS 2 driver node for the Sipher Pico.

Owns the USB serial port and speaks the Pico's JSON protocol (unchanged
firmware). Replaces robot.pico_bridge as Layer 2 while keeping the legacy
surfaces alive during migration:

  Pico (USB serial, JSON lines) <--> sipher_driver <--> ROS 2 topics
                                   +-- TCP :5000  (broadcast + commands)
                                   +-- HTTP :5001 (/sensor /health /map)

Legacy consumers (command_endpoint, pi_logger, instincts, dashboard proxy)
keep working unchanged; they move to ROS 2 natively in later phases.

ROS 2 interfaces (see docs/plans/ros2-n8n-nodered.md section 5):
  pub  /sensors      sensor_msgs/JointState   ch0..ch15, position in rad
  pub  /imu          sensor_msgs/Imu          pitch/roll from accel, yaw from fw
  pub  /range        sensor_msgs/Range        VL53L0X, metres, +x forward
  pub  /battery      sensor_msgs/BatteryState INA219
  pub  /gps          sensor_msgs/NavSatFix    NMEA fix
  pub  /odom->base_link  tf2                  yaw-only, position held at origin
  pub  /estop        std_msgs/Bool            latched (transient_local)
  pub  /sipher/raw   std_msgs/String          raw Pico JSON (debug/migration)
  sub  /servo_cmd    sipher_msgs/ServoCmd
  sub  /servo_cmds   sipher_msgs/ServoCmdArray  (one gait frame)
  sub  /relax        std_msgs/Empty
  sub  /cmd_raw      std_msgs/String            JSON passthrough (all firmware cmds)

QoS note: telemetry is 1 Hz over a reliable link, so all topics use
RELIABLE/VOLATILE (not sensor-data best_effort) so rqt, echo, rosbridge and
PlotJuggler all work without QoS mismatch warnings.
"""

import json
import math
import os
import socket
import sys
import threading
import time
from collections import deque

import rclpy
from rclpy.node import Node
from rclpy.qos import DurabilityPolicy, QoSProfile, ReliabilityPolicy

from geometry_msgs.msg import TransformStamped
from nav_msgs.msg import Odometry
from sensor_msgs.msg import (
    BatteryState,
    Imu,
    JointState,
    NavSatFix,
    NavSatStatus,
    Range,
)
from std_msgs.msg import Bool, Empty, String
from tf2_ros import StaticTransformBroadcaster, TransformBroadcaster

from sipher_msgs.msg import ServoCmd, ServoCmdArray

try:
    import serial
except ImportError:  # pragma: no cover
    serial = None

# ---------------------------------------------------------------------------
# Legacy mapper import (occupancy grid for the dashboard /map endpoint).
# Works from the source tree and from the colcon install space.
# ---------------------------------------------------------------------------
def _find_software_dir():
    env = os.environ.get("SIPHER_SOFTWARE")
    if env and os.path.isdir(os.path.join(env, "robot")):
        return env
    here = os.path.abspath(__file__)
    for _ in range(8):
        here = os.path.dirname(here)
        cand = os.path.join(here, "software")
        if os.path.isdir(os.path.join(cand, "robot")):
            return cand
    return None


_SOFTWARE = _find_software_dir()
if _SOFTWARE and _SOFTWARE not in sys.path:
    sys.path.insert(0, _SOFTWARE)
try:
    from robot.tof_mapper import TofMapper, IDLE_INTERVAL_MS, MAP_INTERVAL_MS

    _MAPPER_AVAILABLE = True
except Exception:  # pragma: no cover
    TofMapper = None
    MAP_INTERVAL_MS = 400
    IDLE_INTERVAL_MS = 1000
    _MAPPER_AVAILABLE = False

# JointState names are PCA9685 channels (URDF joint names arrive with the
# gait/URDF phase). deg -> rad for ROS; firmware commands stay in degrees.
_JOINT_NAMES = [f"ch{i}" for i in range(16)]
_DEG2RAD = math.pi / 180.0
_ACCEL_LSB_PER_G = 16384.0       # MPU6050 +/-2 g
_GYRO_LSB_PER_DPS = 131.0        # MPU6050 +/-250 dps
_G = 9.80665


def _now():
    return time.time()


class SipherDriver(Node):
    def __init__(self):
        super().__init__("sipher_driver")

        self.declare_parameter("serial_port", "/dev/sipher-pico")
        self.declare_parameter("baud", 115200)
        self.declare_parameter("dashboard_interval_ms", 1000)
        self.declare_parameter("bind_host", "0.0.0.0")
        self.declare_parameter("tcp_port", 5000)
        self.declare_parameter("enable_compat", True)
        self.declare_parameter("heartbeat_s", 5.0)
        self.declare_parameter("frame_base", "base_link")
        self.declare_parameter("frame_odom", "odom")
        self.declare_parameter("frame_imu", "imu_link")
        self.declare_parameter("frame_tof", "tof_link")
        self.declare_parameter("frame_gps", "gps_link")
        # Approximate mounting offsets; adjust to the real robot.
        self.declare_parameter("imu_xyz", [0.0, 0.0, 0.03])
        self.declare_parameter("tof_xyz", [0.08, 0.0, 0.02])
        self.declare_parameter("gps_xyz", [0.0, 0.0, 0.06])

        self._port = str(self.get_parameter("serial_port").value)
        self._baud = int(self.get_parameter("baud").value)
        self._dash_ms = int(self.get_parameter("dashboard_interval_ms").value)
        self._host = str(self.get_parameter("bind_host").value)
        self._tcp_port = int(self.get_parameter("tcp_port").value)
        self._compat = bool(self.get_parameter("enable_compat").value)
        self._heartbeat_s = float(self.get_parameter("heartbeat_s").value)

        # --- shared state -------------------------------------------------
        self._ser = None
        self._ser_lock = threading.Lock()
        self._latest = {}          # last full sensor snapshot
        self._latest_raw = ""      # last raw JSON line (any kind)
        self._state_lock = threading.Lock()
        self._last_rx = 0.0
        self._pending = deque(maxlen=64)   # parsed lines awaiting ROS publish
        # NB: must NOT be called _clients — that name belongs to rclpy's
        # Node (service clients) and the executor iterates it.
        self._tcp_clients = []
        self._tcp_clients_lock = threading.Lock()
        # Effective e-stop = firmware OR software (see _update_estop).
        self._estop = False          # effective, gates motion
        self._estop_fw = False       # from Pico firmware tick
        self._estop_sw = False       # from /estop_cmd (sipher_control, latched)
        self._estop_pub_state = None

        # --- ROS 2 interfaces ---------------------------------------------
        tele_qos = QoSProfile(
            history=1, depth=10,
            reliability=ReliabilityPolicy.RELIABLE,
            durability=DurabilityPolicy.VOLATILE,
        )
        latched_qos = QoSProfile(
            history=1, depth=1,
            reliability=ReliabilityPolicy.RELIABLE,
            durability=DurabilityPolicy.TRANSIENT_LOCAL,
        )
        self._pub_sensors = self.create_publisher(JointState, "/sensors", tele_qos)
        self._pub_imu = self.create_publisher(Imu, "/imu", tele_qos)
        self._pub_range = self.create_publisher(Range, "/range", tele_qos)
        self._pub_battery = self.create_publisher(BatteryState, "/battery", tele_qos)
        self._pub_gps = self.create_publisher(NavSatFix, "/gps", tele_qos)
        self._pub_odom = self.create_publisher(Odometry, "/odom", tele_qos)
        self._pub_estop = self.create_publisher(Bool, "/estop", latched_qos)
        self._pub_raw = self.create_publisher(String, "/sipher/raw", tele_qos)
        self._tf_dyn = TransformBroadcaster(self)
        self._tf_static = StaticTransformBroadcaster(self)

        self.create_subscription(ServoCmd, "/servo_cmd", self._on_servo_cmd, 10)
        self.create_subscription(ServoCmdArray, "/servo_cmds", self._on_servo_cmds, 10)
        self.create_subscription(Empty, "/relax", self._on_relax, 10)
        self.create_subscription(String, "/cmd_raw", self._on_cmd_raw, 10)
        # Latched software e-stop from sipher_control (survives restarts).
        self.create_subscription(Bool, "/estop_cmd", self._on_estop_cmd, latched_qos)

        self._publish_static_tf()
        # Drain parsed telemetry into ROS topics (keeps rclpy calls on the
        # executor thread; the serial reader only enqueues).
        self.create_timer(0.05, self._drain_pending)

        # --- legacy compat servers ----------------------------------------
        if self._compat:
            threading.Thread(target=self._tcp_server, daemon=True).start()
            threading.Thread(target=self._http_server, daemon=True).start()

        # --- serial reader (proven reopen logic from pico_bridge) ----------
        threading.Thread(target=self._serial_loop, daemon=True).start()
        if self._heartbeat_s > 0:
            threading.Thread(target=self._heartbeat_loop, daemon=True).start()

        self._mapper = TofMapper() if _MAPPER_AVAILABLE else None
        self.get_logger().info(
            f"sipher_driver up: serial={self._port}@{self._baud} "
            f"compat_tcp=:{self._tcp_port} mapper={_MAPPER_AVAILABLE}"
        )

    # ------------------------------------------------------------------
    # Static TF (sensor mounting frames)
    # ------------------------------------------------------------------
    def _publish_static_tf(self):
        base = str(self.get_parameter("frame_base").value)
        pairs = [
            (str(self.get_parameter("frame_imu").value),
             [float(v) for v in self.get_parameter("imu_xyz").value]),
            (str(self.get_parameter("frame_tof").value),
             [float(v) for v in self.get_parameter("tof_xyz").value]),
            (str(self.get_parameter("frame_gps").value),
             [float(v) for v in self.get_parameter("gps_xyz").value]),
        ]
        msgs = []
        for child, xyz in pairs:
            t = TransformStamped()
            t.header.stamp = self.get_clock().now().to_msg()
            t.header.frame_id = base
            t.child_frame_id = child
            t.transform.translation.x, t.transform.translation.y, t.transform.translation.z = xyz
            t.transform.rotation.w = 1.0
            msgs.append(t)
        self._tf_static.sendTransform(msgs)

    # ------------------------------------------------------------------
    # Serial — open/read/forward, ported from pico_bridge (EIO-safe)
    # ------------------------------------------------------------------
    def _open_serial(self):
        """Open the Pico port and enable dashboard mode, retrying forever.

        The port is reopened from scratch every time: a Pico that is unplugged
        and replugged comes back as a new ttyACM node, while an already-dead
        file descriptor keeps failing with EIO (OSError 5) however long we wait.
        """
        while rclpy.ok():
            ser = None
            try:
                ser = serial.Serial(self._port, self._baud, timeout=2)
                time.sleep(2)  # CDC settles right after open
                ser.reset_input_buffer()
                ser.write(json.dumps(
                    {"cmd": "dashboard", "interval_ms": self._dash_ms}
                ).encode() + b"\n")
                self.get_logger().info(f"connected to {self._port}@{self._baud}")
                return ser
            except Exception as e:
                self.get_logger().warn(
                    f"error opening {self._port}: {e}; retrying in 3s", throttle_duration_sec=10
                )
                try:
                    if ser is not None:
                        ser.close()
                except Exception:
                    pass
                time.sleep(3)
        return None

    def _serial_loop(self):
        while rclpy.ok():
            self._ser = self._open_serial()
            if self._ser is None:
                return
            buf = b""
            try:
                while rclpy.ok():
                    with self._ser_lock:
                        waiting = self._ser.in_waiting
                        chunk = self._ser.read(waiting) if waiting > 0 else b""
                    if not chunk:
                        time.sleep(0.05)
                        continue
                    buf += chunk
                    while b"\n" in buf:
                        raw, buf = buf.split(b"\n", 1)
                        line = raw.decode(errors="replace").strip()
                        if not line:
                            continue
                        try:
                            data = json.loads(line)
                        except json.JSONDecodeError:
                            self.get_logger().debug(f"rx non-json: {line[:160]}")
                            continue
                        self._on_pico_line(line, data)
            except (serial.SerialException, OSError) as e:
                # Includes errno 5 (EIO) from a stale fd after re-enumeration.
                self.get_logger().warn(f"serial lost ({e}); reopening {self._port}")
                self._close_serial()
                time.sleep(2)
            except Exception as e:
                self.get_logger().error(f"read error: {e}")
                time.sleep(1)

    def _close_serial(self):
        with self._ser_lock:
            try:
                if self._ser is not None and self._ser.is_open:
                    self._ser.close()
            except Exception:
                pass
            self._ser = None
        self._last_rx = 0.0

    def forward(self, cmd):
        """Send one JSON command to the Pico. Thread-safe."""
        if not isinstance(cmd, dict):
            return False
        try:
            with self._ser_lock:
                if self._ser and self._ser.is_open:
                    self._ser.write((json.dumps(cmd) + "\n").encode())
                    return True
        except Exception as e:
            self.get_logger().error(f"forward failed: {e}")
        return False

    def _on_pico_line(self, line, data):
        """Handle one parsed JSON line from the Pico (any kind)."""
        self._last_rx = _now()
        is_tick = isinstance(data, dict) and (
            data.get("cmd") == "dashboard_tick"
            or any(k in data for k in ("mpu", "vl53_mm", "ina", "gps", "i2c0", "i2c1"))
        )
        with self._state_lock:
            if is_tick:
                self._latest = data
            self._latest_raw = line
            self._pending.append(data)
        if self._mapper is not None and is_tick:
            try:
                self._mapper.feed(data)
            except Exception as e:
                self.get_logger().warn(f"mapper feed error: {e}")
        # Legacy TCP broadcast (identical to pico_bridge behaviour).
        self._broadcast(data)

    # ------------------------------------------------------------------
    # ROS publishing — executor thread only (timer-driven drain)
    # ------------------------------------------------------------------
    def _drain_pending(self):
        data = None
        raw = ""
        while True:
            with self._state_lock:
                if not self._pending:
                    break
                data = self._pending.popleft()
                raw = self._latest_raw
        if not isinstance(data, dict):
            return
        try:
            self._publish_tick(data, raw)
        except Exception as e:
            # Never let one malformed payload kill the driver (it owns the
            # serial port and the legacy endpoints).
            self.get_logger().error(f"publish failed: {e}", throttle_duration_sec=5)

    def _publish_tick(self, data, raw):
        stamp = self.get_clock().now().to_msg()

        if "pca" in data or "mpu" in data or "vl53_mm" in data:
            self._pub_raw.publish(String(data=raw))

        if "pca" in data:
            self._pub_sensors.publish(self._make_joint_state(data, stamp))
        if data.get("mpu") is not None or data.get("yaw_deg") is not None:
            msg = self._make_imu(data, stamp)
            if msg is not None:
                self._pub_imu.publish(msg)
                self._publish_odom(data, stamp)
        if data.get("vl53_mm") is not None:
            self._pub_range.publish(self._make_range(data, stamp))
        if isinstance(data.get("ina"), dict):
            self._pub_battery.publish(self._make_battery(data, stamp))
        if isinstance(data.get("gps"), dict):
            self._pub_gps.publish(self._make_gps(data, stamp))

        # Firmware e-stop from the tick (authoritative hardware side).
        self._estop_fw = bool(data.get("estop", False))
        self._update_estop("firmware")

    # ------------------------------------------------------------------
    # E-stop chain: effective = firmware OR software
    # ------------------------------------------------------------------
    def _update_estop(self, source):
        """Recompute effective e-stop and publish on change (latched)."""
        effective = self._estop_fw or self._estop_sw
        if effective == self._estop_pub_state:
            self._estop = effective
            return
        self._estop_pub_state = effective
        self._estop = effective
        self._pub_estop.publish(Bool(data=effective))
        if effective:
            self.get_logger().error(
                f"E-STOP active ({source}) — motion refused, servos relaxed"
            )
        else:
            self.get_logger().info(f"E-STOP cleared ({source}) — motion allowed")

    def _on_estop_cmd(self, msg: Bool):
        """Software e-stop from sipher_control (latched /estop_cmd)."""
        self._estop_sw = bool(msg.data)
        self._update_estop("software")

    @staticmethod
    def _make_joint_state(data, stamp):
        msg = JointState()
        msg.header.stamp = stamp
        msg.header.frame_id = "base_link"
        msg.name = list(_JOINT_NAMES)
        pca = data.get("pca") or {}
        degs = pca.get("deg") or []
        pulses = pca.get("pulse_us") or []
        pos = []
        for i in range(16):
            d = degs[i] if i < len(degs) else None
            pos.append(float(d) * _DEG2RAD if isinstance(d, (int, float)) else float("nan"))
        msg.position = pos
        # effort carries the raw pulse width (µs) when known — handy for
        # calibration in rqt/PlotJuggler; NaN when the channel is undriven.
        msg.effort = [
            float(pulses[i]) if i < len(pulses) and isinstance(pulses[i], (int, float)) and pulses[i]
            else float("nan")
            for i in range(16)
        ]
        msg.velocity = [float("nan")] * 16
        return msg

    @staticmethod
    def _make_imu(data, stamp):
        mpu = data.get("mpu")
        msg = Imu()
        msg.header.stamp = stamp
        msg.header.frame_id = "imu_link"
        yaw_deg = data.get("yaw_deg")
        roll = pitch = None
        if isinstance(mpu, (list, tuple)) and len(mpu) >= 6:
            ax, ay, az, gx, gy, gz = (float(v) for v in mpu[:6])
            ax *= _G / _ACCEL_LSB_PER_G
            ay *= _G / _ACCEL_LSB_PER_G
            az *= _G / _ACCEL_LSB_PER_G
            msg.linear_acceleration.x = ax
            msg.linear_acceleration.y = ay
            msg.linear_acceleration.z = az
            msg.angular_velocity.x = gx * math.pi / (180.0 * _GYRO_LSB_PER_DPS)
            msg.angular_velocity.y = gy * math.pi / (180.0 * _GYRO_LSB_PER_DPS)
            msg.angular_velocity.z = gz * math.pi / (180.0 * _GYRO_LSB_PER_DPS)
            roll = math.atan2(ay, az)
            pitch = math.atan2(-ax, math.sqrt(ay * ay + az * az))
        if roll is None and not isinstance(yaw_deg, (int, float)):
            return None
        # Orientation: tilt from accel + heading from firmware integration.
        roll = roll or 0.0
        pitch = pitch or 0.0
        yaw = math.radians(float(yaw_deg) % 360.0) if isinstance(yaw_deg, (int, float)) else 0.0
        cr, sr = math.cos(roll / 2), math.sin(roll / 2)
        cp, sp = math.cos(pitch / 2), math.sin(pitch / 2)
        cy, sy = math.cos(yaw / 2), math.sin(yaw / 2)
        msg.orientation.w = cr * cp * cy + sr * sp * sy
        msg.orientation.x = sr * cp * cy - cr * sp * sy
        msg.orientation.y = cr * sp * cy + sr * cp * sy
        msg.orientation.z = cr * cp * sy - sr * sp * cy
        for i in range(9):
            msg.orientation_covariance[i] = 0.0
            msg.angular_velocity_covariance[i] = 0.0
            msg.linear_acceleration_covariance[i] = 0.0
        msg.orientation_covariance[0] = msg.orientation_covariance[4] = 0.05
        msg.orientation_covariance[8] = 0.2   # yaw drifts (integrated gyro)
        msg.angular_velocity_covariance[8] = 0.01
        msg.linear_acceleration_covariance[0] = msg.linear_acceleration_covariance[4] = 0.04
        msg.linear_acceleration_covariance[8] = 0.08
        return msg

    @staticmethod
    def _make_range(data, stamp):
        msg = Range()
        msg.header.stamp = stamp
        msg.header.frame_id = "tof_link"
        msg.radiation_type = Range.INFRARED
        msg.field_of_view = 0.47  # ~27 deg, VL53L0X
        msg.min_range = 0.03
        msg.max_range = 2.0
        msg.range = float(data["vl53_mm"]) / 1000.0
        return msg

    @staticmethod
    def _make_battery(data, stamp):
        ina = data["ina"]
        msg = BatteryState()
        msg.header.stamp = stamp
        msg.header.frame_id = "base_link"
        msg.voltage = float(ina.get("voltage_v") or 0.0)
        msg.current = float(ina.get("current_ma") or 0.0) / 1000.0
        msg.percentage = float("nan")  # no fuel gauge — voltage only
        msg.temperature = float("nan")
        msg.present = True
        msg.power_supply_status = BatteryState.POWER_SUPPLY_STATUS_DISCHARGING
        msg.power_supply_health = BatteryState.POWER_SUPPLY_HEALTH_GOOD
        msg.power_supply_technology = BatteryState.POWER_SUPPLY_TECHNOLOGY_UNKNOWN
        return msg

    @staticmethod
    def _make_gps(data, stamp):
        gps = data["gps"]
        msg = NavSatFix()
        msg.header.stamp = stamp
        msg.header.frame_id = "gps_link"
        msg.status.status = (
            NavSatStatus.STATUS_FIX if gps.get("fix") else NavSatStatus.STATUS_NO_FIX
        )
        msg.status.service = NavSatStatus.SERVICE_GPS
        if gps.get("lat") is not None:
            msg.latitude = float(gps["lat"])
        if gps.get("lon") is not None:
            msg.longitude = float(gps["lon"])
        msg.altitude = float("nan")
        for i in range(9):
            msg.position_covariance[i] = 0.0
        msg.position_covariance_type = NavSatFix.COVARIANCE_TYPE_UNKNOWN
        return msg

    def _publish_odom(self, data, stamp):
        yaw_deg = data.get("yaw_deg")
        yaw = math.radians(float(yaw_deg) % 360.0) if isinstance(yaw_deg, (int, float)) else 0.0
        odom = Odometry()
        odom.header.stamp = stamp
        odom.header.frame_id = str(self.get_parameter("frame_odom").value)
        odom.child_frame_id = str(self.get_parameter("frame_base").value)
        odom.pose.pose.orientation.z = math.sin(yaw / 2)
        odom.pose.pose.orientation.w = math.cos(yaw / 2)
        for i in range(36):
            odom.pose.covariance[i] = 0.0
        # x/y uncertain (no wheel/leg odometry yet), yaw from firmware.
        odom.pose.covariance[0] = odom.pose.covariance[7] = 1e6
        odom.pose.covariance[35] = 0.1
        self._pub_odom.publish(odom)

        t = TransformStamped()
        t.header.stamp = stamp
        t.header.frame_id = odom.header.frame_id
        t.child_frame_id = odom.child_frame_id
        t.transform.rotation.z = odom.pose.pose.orientation.z
        t.transform.rotation.w = odom.pose.pose.orientation.w
        self._tf_dyn.sendTransform(t)

    # ------------------------------------------------------------------
    # Command subscriptions
    # ------------------------------------------------------------------
    def _motion_allowed(self, what):
        if self._estop:
            self.get_logger().warn(f"dropping {what}: E-STOP active")
            return False
        return True

    def _on_servo_cmd(self, msg):
        if not self._motion_allowed("servo_cmd"):
            return
        if msg.ch > 15:
            self.get_logger().warn(f"servo_cmd bad channel {msg.ch}")
            return
        self.forward({"cmd": "servo", "ch": int(msg.ch), "deg": float(msg.deg)})

    def _on_servo_cmds(self, msg):
        if not self._motion_allowed("servo_cmds"):
            return
        # One firmware "servos" frame: positional list indexed by channel,
        # null for channels this frame does not command.
        positions = [None] * 16
        for c in msg.commands:
            if c.ch <= 15:
                positions[c.ch] = float(c.deg)
        self.forward({"cmd": "servos", "positions": positions})

    def _on_relax(self, _msg):
        self.forward({"cmd": "relax_all"})

    def _on_cmd_raw(self, msg):
        try:
            cmd = json.loads(msg.data)
        except json.JSONDecodeError:
            self.get_logger().warn("cmd_raw: invalid JSON")
            return
        self.forward(cmd)

    # ------------------------------------------------------------------
    # Legacy TCP :5000 — broadcast + commands (pico_bridge protocol)
    # ------------------------------------------------------------------
    def _broadcast(self, data):
        if not data:
            return
        payload = json.dumps(data) + "\n"
        with self._tcp_clients_lock:
            clients = list(self._tcp_clients)
        dead = []
        for sock in clients:
            try:
                sock.settimeout(1.0)
                sock.sendall(payload.encode())
            except Exception:
                dead.append(sock)
        if dead:
            with self._tcp_clients_lock:
                for sock in dead:
                    if sock in self._tcp_clients:
                        self._tcp_clients.remove(sock)
                    try:
                        sock.close()
                    except Exception:
                        pass

    def _tcp_server(self):
        server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        server.bind((self._host, self._tcp_port))
        server.listen(5)
        self.get_logger().info(f"compat TCP on {self._host}:{self._tcp_port}")
        while True:
            try:
                sock, addr = server.accept()
                with self._tcp_clients_lock:
                    self._tcp_clients.append(sock)
                threading.Thread(target=self._tcp_client, args=(sock,), daemon=True).start()
            except Exception as e:
                self.get_logger().error(f"tcp accept error: {e}")
                time.sleep(1)

    def _tcp_client(self, sock):
        buf = b""
        try:
            while True:
                ch = sock.recv(1)
                if not ch:
                    break
                buf += ch
                if ch == b"\n":
                    line = buf.decode(errors="replace").strip()
                    buf = b""
                    if not line:
                        continue
                    try:
                        req = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    ok = self.forward(req)
                    try:
                        ack = json.dumps({
                            "bridge_ack": True,
                            "forwarded": ok,
                            "cmd": req.get("cmd") if isinstance(req, dict) else None,
                            "ts": _now(),
                        }) + "\n"
                        sock.settimeout(1.0)
                        sock.sendall(ack.encode())
                    except Exception:
                        pass
        except Exception:
            pass
        finally:
            with self._tcp_clients_lock:
                if sock in self._tcp_clients:
                    self._tcp_clients.remove(sock)
            try:
                sock.close()
            except Exception:
                pass

    # ------------------------------------------------------------------
    # Legacy HTTP :5001 — /sensor /health /map (pico_bridge protocol)
    # ------------------------------------------------------------------
    @staticmethod
    def _http_json(conn, payload, status="200 OK"):
        body = json.dumps(payload).encode()
        head = (
            f"HTTP/1.1 {status}\r\n"
            "Content-Type: application/json\r\n"
            f"Content-Length: {len(body)}\r\n"
            "Access-Control-Allow-Origin: *\r\n"
            "\r\n"
        )
        try:
            conn.sendall(head.encode() + body)
        except Exception:
            pass

    def _pico_status(self):
        age = (_now() - self._last_rx) if self._last_rx else None
        return {
            "live": age is not None and age < 5.0,
            "age_ms": int(age * 1000) if age is not None else None,
        }

    def _map_action(self, action):
        if self._mapper is None:
            return {"error": "mapper unavailable"}
        action = (action or "").lower()
        if action == "start":
            result = self._mapper.start(MAP_INTERVAL_MS)
            self.forward({"cmd": "dashboard", "interval_ms": MAP_INTERVAL_MS})
        elif action == "stop":
            result = self._mapper.stop()
            self.forward({"cmd": "dashboard", "interval_ms": IDLE_INTERVAL_MS})
        elif action == "reset":
            result = self._mapper.reset()
        else:
            return {"error": f"unknown action: {action}",
                    "valid": ["start", "stop", "reset"]}
        result["tick_interval_ms"] = (
            MAP_INTERVAL_MS if self._mapper.is_running() else IDLE_INTERVAL_MS
        )
        return result

    def _http_handler(self, conn):
        try:
            data = conn.recv(4096).decode(errors="replace")
        except Exception:
            conn.close()
            return
        request_line = data.split("\r\n")[0] if data else ""
        try:
            path = request_line.split(" ")[1] if " " in request_line else ""
        except Exception:
            path = ""
        try:
            if path.startswith("/map"):
                if self._mapper is None:
                    self._http_json(conn, {"error": "mapper unavailable"}, "503 Service Unavailable")
                    return
                query = path.split("?", 1)[1] if "?" in path else ""
                action = None
                for part in query.split("&"):
                    if part.startswith("action="):
                        action = part.split("=", 1)[1]
                if action:
                    self._http_json(conn, self._map_action(action))
                else:
                    self._http_json(conn, self._mapper.state(include_grid="nogrid" not in query))
            elif path.startswith("/sensor"):
                with self._state_lock:
                    snapshot = dict(self._latest)
                meta = snapshot.get("_meta", {})
                pico_data = meta.get("pico")
                if isinstance(pico_data, dict):
                    meta["pico"] = pico_data.get("live", False)
                elif not isinstance(pico_data, bool):
                    meta["pico"] = False
                meta.setdefault("pico_age_ms", None)
                meta["pico"] = self._pico_status()["live"]
                meta["pico_age_ms"] = self._pico_status()["age_ms"]
                meta["bridge"] = True
                meta["ts"] = meta.get("ts", _now())
                snapshot["_meta"] = meta
                self._http_json(conn, snapshot)
            elif path.startswith("/health"):
                self._http_json(conn, {
                    "status": "ok",
                    "pico_serial": self._port,
                    "pico": self._pico_status(),
                    "mapping": bool(self._mapper and self._mapper.is_running()),
                })
            else:
                self._http_json(conn, {"error": "not found"}, "404 Not Found")
        finally:
            try:
                conn.close()
            except Exception:
                pass

    def _http_server(self):
        server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        server.bind((self._host, self._tcp_port + 1))
        server.listen(5)
        self.get_logger().info(f"compat HTTP on {self._host}:{self._tcp_port + 1}")
        while True:
            try:
                conn, _addr = server.accept()
                threading.Thread(target=self._http_handler, args=(conn,), daemon=True).start()
            except Exception as e:
                self.get_logger().error(f"http accept error: {e}")
                time.sleep(1)

    # ------------------------------------------------------------------
    # Heartbeat (keeps the firmware bridge-connection LED solid)
    # ------------------------------------------------------------------
    def _heartbeat_loop(self):
        while rclpy.ok():
            try:
                self.forward({"cmd": "heartbeat"})
            except Exception:
                pass
            time.sleep(self._heartbeat_s)


def main(args=None):
    if serial is None:
        raise SystemExit("pyserial is required: apt install python3-serial")
    rclpy.init(args=args)
    node = SipherDriver()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node._close_serial()
        node.destroy_node()
        rclpy.shutdown()


if __name__ == "__main__":
    main()
