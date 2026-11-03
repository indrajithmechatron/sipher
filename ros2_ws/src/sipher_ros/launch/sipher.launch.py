"""Bring up the Sipher driver + control + diagnostics nodes."""

import os

from ament_index_python.packages import get_package_share_directory
from launch import LaunchDescription
from launch_ros.actions import Node


def generate_launch_description():
    params = os.path.join(
        get_package_share_directory("sipher_ros"), "config", "sipher.params.yaml"
    )
    return LaunchDescription([
        Node(
            package="sipher_ros",
            executable="driver",
            name="sipher_driver",
            output="screen",
            parameters=[params],
        ),
        Node(
            package="sipher_ros",
            executable="control",
            name="sipher_control",
            output="screen",
        ),
        Node(
            package="sipher_ros",
            executable="diagnostics",
            name="sipher_diagnostics",
            output="screen",
            parameters=[params],
        ),
    ])
