# Quadruped Spider Robot

A four-legged (quadruped) spider-style robot. This is Project 1 — currently at
idea/scaffolding stage.

## Ideas (Draft)

- Leg kinematics: 4 legs x 3 DOF (hip, thigh, knee) — 12 servos total.
- Walking gaits: tripod, wave, trot for both flat and rough terrain.
- Control: inverse kinematics for foot trajectories.
- Telemetry: IMU + feedback for posture stabilization.
- Firmware target: ESP32 class MCU (ESP-IDF toolchain present on this machine).

## Folder Layout

```text
QuadrupedSpider/
├── hardware/
│   ├── mechanics/    # CAD, 3D-printable parts, leg links, body frame
│   └── electronics/  # PCB/schematic, wiring, power budget
├── software/
│   ├── firmware/     # MCU code (servo control, IK, gait)
│   ├── control/      # Higher-level control / simulation
│   └── telemetry/    # Logging, tuning, remote interface
├── docs/             # Design notes and references
└── assets/           # Images, videos, renders
```

## Current Status

- **Idea / scaffolding**: in progress
- **CAD**: not started
- **Firmware**: not started
- **RAG reference**: this file and project docs are indexed by the local
  RAGSystem.