from setuptools import find_packages, setup

package_name = "sipher_ros"

setup(
    name=package_name,
    version="0.1.0",
    packages=find_packages(exclude=["test"]),
    data_files=[
        ("share/ament_index/resource_index/packages", [f"resource/{package_name}"]),
        (f"share/{package_name}", ["package.xml"]),
        (f"share/{package_name}/launch", ["launch/sipher.launch.py"]),
        (f"share/{package_name}/config", ["config/sipher.params.yaml"]),
    ],
    install_requires=["setuptools"],
    zip_safe=True,
    maintainer="indrajithmechatron",
    maintainer_email="indrajithmechatron@gmail.com",
    description="Native ROS 2 driver/control/diagnostics for the Sipher quadruped.",
    license="MIT",
    entry_points={
        "console_scripts": [
            "driver = sipher_ros.driver:main",
            "control = sipher_ros.control:main",
            "diagnostics = sipher_ros.diagnostics:main",
        ],
    },
)
