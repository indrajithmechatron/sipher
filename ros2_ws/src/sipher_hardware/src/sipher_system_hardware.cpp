// SipherSystemHardware — ros2_control SystemInterface for the Sipher quadruped.
//
// Design: the serial port stays single-owner (sipher_driver). This hardware
// component talks to it over ROS 2 topics instead of opening /dev itself:
//
//   read()  <- /sensors   (JointState, rad, published by sipher_driver)
//   write() -> /servo_cmds (ServoCmdArray, one gait frame; the driver applies
//                           the e-stop gate and forwards to the Pico)
//
// This keeps controller_manager fully decoupled from serial reconnection
// logic (the proven EIO reopen loop lives only in the driver) and means the
// e-stop has exactly one enforcement point.

#include <atomic>
#include <cmath>
#include <memory>
#include <mutex>
#include <string>
#include <vector>

#include "hardware_interface/handle.hpp"
#include "hardware_interface/hardware_component_interface.hpp"
#include "hardware_interface/system_interface.hpp"
#include "hardware_interface/types/hardware_interface_return_values.hpp"
#include "rclcpp/rclcpp.hpp"
#include "sensor_msgs/msg/joint_state.hpp"
#include "sipher_msgs/msg/servo_cmd.hpp"
#include "sipher_msgs/msg/servo_cmd_array.hpp"

namespace sipher_hardware
{

namespace
{
constexpr double kRad2Deg = 180.0 / M_PI;
}  // namespace

class SipherSystemHardware : public hardware_interface::SystemInterface
{
public:
  hardware_interface::CallbackReturn on_init(
    const hardware_interface::HardwareComponentInterfaceParams & params) override
  {
    info_ = params.hardware_info;

    joint_names_.clear();
    for (const auto & joint : info_.joints) {
      joint_names_.push_back(joint.name);
    }
    if (joint_names_.empty()) {
      RCLCPP_FATAL(rclcpp::get_logger("sipher_hardware"), "no joints in URDF <ros2_control>");
      return hardware_interface::CallbackReturn::ERROR;
    }

    states_rad_.assign(joint_names_.size(), std::nan(""));
    commands_rad_.assign(joint_names_.size(), std::nan(""));

    // Internal node on the controller_manager's executor (Jazzy params API).
    node_ = std::make_shared<rclcpp::Node>(
      "sipher_hardware_node",
      rclcpp::NodeOptions().automatically_declare_parameters_from_overrides(true));

    sensors_sub_ = node_->create_subscription<sensor_msgs::msg::JointState>(
      "/sensors", rclcpp::QoS(10),
      [this](sensor_msgs::msg::JointState::ConstSharedPtr msg) {
        std::lock_guard<std::mutex> lock(mutex_);
        for (size_t i = 0; i < joint_names_.size(); ++i) {
          for (size_t j = 0; j < msg->name.size() && j < msg->position.size(); ++j) {
            if (msg->name[j] == joint_names_[i]) {
              states_rad_[i] = msg->position[j];
              if (!seeded_) {
                commands_rad_[i] = states_rad_[i];  // hold initial pose
              }
              break;
            }
          }
        }
        have_sensors_ = true;
        seeded_ = true;
      });

    cmds_pub_ = node_->create_publisher<sipher_msgs::msg::ServoCmdArray>(
      "/servo_cmds", rclcpp::QoS(10));

    if (auto executor = params.executor.lock()) {
      executor->add_node(node_);
      RCLCPP_INFO(node_->get_logger(),
                  "SipherSystemHardware: %zu joints, node attached to controller_manager executor",
                  joint_names_.size());
    } else {
      RCLCPP_ERROR(node_->get_logger(),
                   "SipherSystemHardware: could not lock controller_manager executor!");
      return hardware_interface::CallbackReturn::ERROR;
    }

    return hardware_interface::CallbackReturn::SUCCESS;
  }

  std::vector<hardware_interface::StateInterface::ConstSharedPtr>
  on_export_state_interfaces() override
  {
    std::vector<hardware_interface::StateInterface::ConstSharedPtr> out;
    out.reserve(joint_names_.size());
    for (size_t i = 0; i < joint_names_.size(); ++i) {
      out.push_back(std::make_shared<hardware_interface::StateInterface>(
        joint_names_[i], "position", &states_rad_[i]));
    }
    return out;
  }

  std::vector<hardware_interface::CommandInterface::SharedPtr>
  on_export_command_interfaces() override
  {
    std::vector<hardware_interface::CommandInterface::SharedPtr> out;
    out.reserve(joint_names_.size());
    for (size_t i = 0; i < joint_names_.size(); ++i) {
      out.push_back(std::make_shared<hardware_interface::CommandInterface>(
        joint_names_[i], "position", &commands_rad_[i]));
    }
    return out;
  }

  hardware_interface::return_type read(
    const rclcpp::Time &, const rclcpp::Duration &) override
  {
    // State is refreshed by the /sensors callback; nothing to do here.
    return hardware_interface::return_type::OK;
  }

  hardware_interface::return_type write(
    const rclcpp::Time &, const rclcpp::Duration &) override
  {
    if (!have_sensors_) {
      return hardware_interface::return_type::OK;  // don't command blind
    }
    sipher_msgs::msg::ServoCmdArray frame;
    frame.commands.reserve(joint_names_.size());
    {
      std::lock_guard<std::mutex> lock(mutex_);
      for (size_t i = 0; i < joint_names_.size(); ++i) {
        const double rad = commands_rad_[i];
        if (!std::isfinite(rad)) {
          continue;  // uncommanded channel: leave it where it is
        }
        sipher_msgs::msg::ServoCmd cmd;
        cmd.ch = static_cast<uint8_t>(i);
        cmd.deg = static_cast<float>(rad * kRad2Deg);
        frame.commands.push_back(cmd);
      }
    }
    if (!frame.commands.empty()) {
      cmds_pub_->publish(frame);
    }
    return hardware_interface::return_type::OK;
  }

  hardware_interface::CallbackReturn on_cleanup(const rclcpp::Time &) override
  {
    return hardware_interface::CallbackReturn::SUCCESS;
  }

private:
  hardware_interface::HardwareInfo info_;
  std::vector<std::string> joint_names_;
  std::vector<double> states_rad_;    // exported state interfaces (pointers)
  std::vector<double> commands_rad_;  // exported command interfaces (pointers)
  std::mutex mutex_;
  std::atomic<bool> have_sensors_{false};
  bool seeded_{false};

  rclcpp::Node::SharedPtr node_;
  rclcpp::Subscription<sensor_msgs::msg::JointState>::SharedPtr sensors_sub_;
  rclcpp::Publisher<sipher_msgs::msg::ServoCmdArray>::SharedPtr cmds_pub_;
};

}  // namespace sipher_hardware

#include "pluginlib/class_list_macros.hpp"
PLUGINLIB_EXPORT_CLASS(sipher_hardware::SipherSystemHardware, hardware_interface::SystemInterface)
