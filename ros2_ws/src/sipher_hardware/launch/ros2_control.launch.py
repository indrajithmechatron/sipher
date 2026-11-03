"""Bring up ros2_control for the Sipher quadruped (R3b)."""

import os

from ament_index_python.packages import get_package_share_directory
from launch import LaunchDescription
from launch.actions import DeclareLaunchArgument
from launch.substitutions import Command, LaunchConfiguration, PathJoinSubstitution
from launch_ros.actions import Node


def generate_launch_description():
    share = get_package_share_directory("sipher_hardware")
    urdf_file = os.path.join(share, "urdf", "sipher.urdf")
    controllers = os.path.join(share, "config", "controllers.yaml")

    with open(urdf_file, "r") as f:
        robot_description = f.read()

    robot_state_publisher = Node(
        package="robot_state_publisher",
        executable="robot_state_publisher",
        output="screen",
        parameters=[{"robot_description": robot_description}],
    )

    control_node = Node(
        package="controller_manager",
        executable="ros2_control_node",
        output="screen",
        parameters=[{"robot_description": robot_description}, controllers],
        remappings=[("~/robot_description", "/robot_description")],
    )

    spawner_jsb = Node(
        package="controller_manager",
        executable="spawner",
        arguments=["joint_state_broadcaster", "--controller-manager", "/controller_manager"],
        output="screen",
    )

    spawner_fwd = Node(
        package="controller_manager",
        executable="spawner",
        arguments=["forward_controller", "--controller-manager", "/controller_manager",
                   "--inactive"],
        output="screen",
    )

    return LaunchDescription([
        robot_state_publisher,
        control_node,
        spawner_jsb,
        spawner_fwd,
    ])
