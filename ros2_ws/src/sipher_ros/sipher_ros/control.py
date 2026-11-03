"""sipher_ros.control — e-stop authority + safety services (R3).

Owns the *software* side of the e-stop chain; the firmware IRQ stays
authoritative on the Pico (it relaxes servos in hardware by itself).

  services:
    /sipher_control/set_estop   std_srvs/SetBool   true=assert, false=clear
    /sipher_control/clear_estop std_srvs/Trigger   convenience for dashboards
    /sipher_control/relax       std_srvs/Trigger   relax all servos now
  topics:
    pub /estop_cmd   std_msgs/Bool   latched (TRANSIENT_LOCAL) -> driver
                                      gates motion on it; a restarted driver
                                      picks the last state back up
    pub /relax       std_msgs/Empty
    pub /sipher/events  sipher_msgs/SipherEvent  "estop" / "estop_clear"
    sub /estop       std_msgs/Bool   latched firmware+software state (for UI)

Effective e-stop = firmware OR software, computed in the driver; this node
never asserts motion, it only gates it.
"""

import rclpy
from rclpy.node import Node
from rclpy.qos import DurabilityPolicy, QoSProfile, ReliabilityPolicy

from std_msgs.msg import Bool, Empty
from std_srvs.srv import SetBool, Trigger

from sipher_msgs.msg import SipherEvent


class SipherControl(Node):
    def __init__(self):
        super().__init__("sipher_control")

        latched_qos = QoSProfile(
            history=1, depth=1,
            reliability=ReliabilityPolicy.RELIABLE,
            durability=DurabilityPolicy.TRANSIENT_LOCAL,
        )
        tele_qos = QoSProfile(
            history=1, depth=10,
            reliability=ReliabilityPolicy.RELIABLE,
            durability=DurabilityPolicy.VOLATILE,
        )

        self._estop = False          # software e-stop state
        self._firmware_estop = False # last state seen on /estop

        # Latched so a driver restart re-reads the last commanded state.
        self._pub_estop_cmd = self.create_publisher(Bool, "/estop_cmd", latched_qos)
        self._pub_relax = self.create_publisher(Empty, "/relax", tele_qos)
        self._pub_event = self.create_publisher(SipherEvent, "/sipher/events", tele_qos)
        self.create_subscription(Bool, "/estop", self._on_estop, latched_qos)

        self.create_service(SetBool, "~/set_estop", self._handle_set_estop)
        self.create_service(Trigger, "~/clear_estop", self._handle_clear_estop)
        self.create_service(Trigger, "~/relax", self._handle_relax)

        # Announce current state at startup (latched; drivers match late).
        self._pub_estop_cmd.publish(Bool(data=self._estop))
        self.get_logger().info(
            "sipher_control up: set_estop/clear_estop/relax services ready"
        )

    # ------------------------------------------------------------------
    def _on_estop(self, msg: Bool):
        self._firmware_estop = bool(msg.data)

    def _set_estop(self, active: bool, source: str) -> str:
        active = bool(active)
        if active == self._estop:
            return f"e-stop already {'ACTIVE' if active else 'clear'}"
        self._estop = active
        self._pub_estop_cmd.publish(Bool(data=active))
        self._pub_event.publish(SipherEvent(
            type="estop" if active else "estop_clear",
            level="error" if active else "info",
            data='{"source": "%s"}' % source,
        ))
        if active:
            self.get_logger().error(f"E-STOP asserted via {source} — motion gated")
        else:
            self.get_logger().info(f"E-STOP cleared via {source}")
        return f"e-stop {'ACTIVE' if active else 'clear'}"

    # ------------------------------------------------------------------
    def _handle_set_estop(self, request, response):
        response.success = True
        response.message = self._set_estop(request.data, "set_estop")
        return response

    def _handle_clear_estop(self, _request, response):
        response.success = True
        response.message = self._set_estop(False, "clear_estop")
        return response

    def _handle_relax(self, _request, response):
        # Relax is allowed even without e-stop (park/safe pose).
        self._pub_relax.publish(Empty())
        response.success = True
        estop_on = self._estop or self._firmware_estop
        response.message = "relax sent (%s)" % (
            "e-stop active" if estop_on else "no e-stop — parking"
        )
        return response


def main(args=None):
    rclpy.init(args=args)
    node = SipherControl()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.shutdown()


if __name__ == "__main__":
    main()
