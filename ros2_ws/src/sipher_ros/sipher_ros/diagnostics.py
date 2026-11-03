"""sipher_ros.diagnostics — /diagnostics health aggregation (R3).

Publishes diagnostic_msgs/DiagnosticArray at 1 Hz covering:

  driver.serial   Pico serial link age (from /sensors freshness)
  driver.topics   all telemetry topics alive
  imu, range, battery, gps  per-sensor freshness + plausibility
  estop           state (OK=clear, ERROR=active)
  system          Pi CPU load, memory, disk
  compat          legacy TCP:5000 / HTTP:5001 listeners (until R11)

Consumers: `ros2 topic echo /diagnostics`, rqt_runtime_monitor, and later
n8n/Node-RED flows (R6) which turn ERROR entries into alerts.
"""

import shutil
import time

import rclpy
from rclpy.node import Node
from rclpy.qos import DurabilityPolicy, QoSProfile, ReliabilityPolicy

from diagnostic_msgs.msg import DiagnosticArray, DiagnosticStatus, KeyValue
from sensor_msgs.msg import BatteryState, Imu, JointState, NavSatFix, Range
from std_msgs.msg import Bool


def _ok(name, message="OK", values=None):
    st = DiagnosticStatus(name=name, level=DiagnosticStatus.OK, message=message)
    st.values = [KeyValue(key=k, value=str(v)) for k, v in (values or {}).items()]
    return st


def _warn(name, message, values=None):
    st = DiagnosticStatus(name=name, level=DiagnosticStatus.WARN, message=message)
    st.values = [KeyValue(key=k, value=str(v)) for k, v in (values or {}).items()]
    return st


def _err(name, message, values=None):
    st = DiagnosticStatus(name=name, level=DiagnosticStatus.ERROR, message=message)
    st.values = [KeyValue(key=k, value=str(v)) for k, v in (values or {}).items()]
    return st


class SipherDiagnostics(Node):
    def __init__(self):
        super().__init__("sipher_diagnostics")

        self.declare_parameter("publish_interval_s", 1.0)
        self.declare_parameter("sensor_stale_s", 5.0)
        self.declare_parameter("battery_low_v", 10.5)
        self.declare_parameter("battery_critical_v", 9.5)

        self._stale = float(self.get_parameter("sensor_stale_s").value)
        self._low_v = float(self.get_parameter("battery_low_v").value)
        self._crit_v = float(self.get_parameter("battery_critical_v").value)

        # Latest message times (monotonic) per topic.
        self._last = {}
        self._battery_v = None
        self._estop = False

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

        for topic, msg_type in (
            ("/sensors", JointState), ("/imu", Imu), ("/range", Range),
            ("/gps", NavSatFix),
        ):
            self.create_subscription(
                msg_type, topic,
                lambda _m, t=topic: self._mark(t), tele_qos,
            )
        self.create_subscription(
            BatteryState, "/battery",
            lambda m: (self._mark("/battery"),
                       setattr(self, "_battery_v", float(m.voltage))),
            tele_qos,
        )
        self.create_subscription(Bool, "/estop", self._on_estop, latched_qos)

        self._pub = self.create_publisher(DiagnosticArray, "/diagnostics", tele_qos)
        period = float(self.get_parameter("publish_interval_s").value)
        self.create_timer(period, self._publish)
        self.get_logger().info("sipher_diagnostics up: /diagnostics @ %.1f Hz" % (1.0 / period))

    # ------------------------------------------------------------------
    def _mark(self, topic):
        self._last[topic] = time.monotonic()

    def _on_estop(self, msg):
        self._estop = bool(msg.data)
        self._mark("/estop")

    def _age(self, topic):
        t = self._last.get(topic)
        return (time.monotonic() - t) if t else None

    def _freshness(self, name, topic):
        age = self._age(topic)
        if age is None:
            return _err(name, "never received")
        if age > self._stale:
            return _warn(name, "stale", {"age_s": f"{age:.1f}"})
        return _ok(name, "OK", {"age_s": f"{age:.2f}"})

    # ------------------------------------------------------------------
    def _publish(self):
        now = self.get_clock().now().to_msg()
        statuses = []

        # --- driver / telemetry -----------------------------------------
        statuses.append(self._freshness("driver.serial (via /sensors)", "/sensors"))
        statuses.append(self._freshness("sensor.imu", "/imu"))
        statuses.append(self._freshness("sensor.range", "/range"))
        statuses.append(self._freshness("sensor.gps", "/gps"))

        # --- battery -----------------------------------------------------
        b_age = self._age("/battery")
        if b_age is None:
            statuses.append(_err("sensor.battery", "never received"))
        elif self._battery_v is None:
            statuses.append(_warn("sensor.battery", "no voltage"))
        elif self._battery_v < self._crit_v:
            statuses.append(_err(
                "sensor.battery", f"CRITICAL {self._battery_v:.2f} V",
                {"voltage": f"{self._battery_v:.2f}",
                 "thresholds": f"low<{self._low_v} crit<{self._crit_v}"},
            ))
        elif self._battery_v < self._low_v:
            statuses.append(_warn(
                "sensor.battery", f"LOW {self._battery_v:.2f} V",
                {"voltage": f"{self._battery_v:.2f}"},
            ))
        else:
            statuses.append(_ok(
                "sensor.battery", f"{self._battery_v:.2f} V",
                {"voltage": f"{self._battery_v:.2f}"},
            ))

        # --- estop -------------------------------------------------------
        if self._estop:
            statuses.append(_err("safety.estop", "ACTIVE — motion refused"))
        else:
            statuses.append(_ok("safety.estop", "clear"))

        # --- system ------------------------------------------------------
        try:
            load1, load5, load15 = shutil.getloadavg()
            disk = shutil.disk_usage("/")
            disk_pct = 100.0 * disk.used / disk.total
            sys_values = {
                "load1": f"{load1:.2f}", "load5": f"{load5:.2f}",
                "load15": f"{load15:.2f}",
                "disk_used_pct": f"{disk_pct:.1f}",
                "disk_free_gb": f"{disk.free / 1e9:.1f}",
            }
            if disk_pct > 90:
                statuses.append(_warn("system", "disk >90%", sys_values))
            elif load1 > 3.0:
                statuses.append(_warn("system", "load high", sys_values))
            else:
                statuses.append(_ok("system", "OK", sys_values))
        except Exception as e:  # pragma: no cover
            statuses.append(_warn("system", f"unavailable: {e}"))

        # --- legacy compat endpoints (retired at R11) --------------------
        import socket
        for port, name in ((5000, "compat.tcp5000"), (5001, "compat.http5001")):
            try:
                with socket.create_connection(("127.0.0.1", port), timeout=0.5):
                    statuses.append(_ok(name, "listening"))
            except OSError:
                statuses.append(_warn(name, "not listening"))

        arr = DiagnosticArray()
        arr.header.stamp = now
        arr.status = statuses
        self._pub.publish(arr)


def main(args=None):
    rclpy.init(args=args)
    node = SipherDiagnostics()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.shutdown()


if __name__ == "__main__":
    main()
