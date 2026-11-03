cmake_minimum_required(VERSION 3.8)
project(sipher_hardware)

if(NOT CMAKE_CXX_STANDARD)
  set(CMAKE_CXX_STANDARD 17)
endif()
if(CMAKE_COMPILER_IS_GNUCXX OR CMAKE_CXX_COMPILER_ID MATCHES "Clang")
  add_compile_options(-Wall -Wextra -Wpedantic)
endif()

find_package(ament_cmake REQUIRED)
find_package(hardware_interface REQUIRED)
find_package(pluginlib REQUIRED)
find_package(rclcpp REQUIRED)
find_package(sensor_msgs REQUIRED)
find_package(sipher_msgs REQUIRED)

add_library(sipher_system_hardware SHARED
  src/sipher_system_hardware.cpp
)
ament_target_dependencies(sipher_system_hardware
  hardware_interface
  pluginlib
  rclcpp
  sensor_msgs
  sipher_msgs
)

pluginlib_export_plugin_description_file(hardware_interface plugins.xml)

install(TARGETS sipher_system_hardware
  LIBRARY DESTINATION lib
  ARCHIVE DESTINATION lib
  RUNTIME DESTINATION bin
)
install(FILES plugins.xml DESTINATION share/${PROJECT_NAME})
install(DIRECTORY urdf config launch DESTINATION share/${PROJECT_NAME})

ament_package()
