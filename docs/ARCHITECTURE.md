# Sipher Software Architecture

## Purpose

Sipher is a quadruped assistant robot.

The software architecture separates physical robot control, robot runtime, ROS 2 middleware, and higher-level intelligence.

The architecture must keep safety-critical physical control independent from AI decisions.

## Layer Structure

```text
software/
├── control/
├── robot/
└── ros2/
```

## 1. Control Layer

Location: `software/control/`

Purpose: Low-level and deterministic control of the physical robot.

Responsibilities:
- Servo control
- Joint control
- Gait generation
- Motion execution
- Sensor feedback processing
- Safety limits
- Emergency stop handling
- Pico 2 W communication
- Hardware timing

Rules:
- Must not depend on AI models.
- Must not directly depend on the dashboard.
- Must not contain conversational logic.
- Safety constraints must be enforced locally.
- High-level commands must be validated before physical execution.

## 2. Robot Runtime Layer

Location: `software/robot/`

Purpose: Pi-side runtime responsible for coordinating the physical robot.

Responsibilities:
- Robot hardware interfaces
- Pico 2 W communication
- Robot state management
- Command validation
- Safety coordination
- High-level robot actions
- Voice command integration
- Runtime configuration
- Hardware health monitoring

Rules:
- Acts as the controlled interface to the physical robot.
- AI systems must not directly control servos.
- AI-generated commands must pass through validation.
- The runtime may communicate with ROS 2, dashboard, voice, and AI systems.

## 3. ROS 2 Layer

Location: `software/ros2/`

Purpose: Robotics middleware connecting robot subsystems.

Responsibilities:
- ROS 2 nodes
- Topics
- Services
- Actions
- Sensor publishing
- Robot state publishing
- Motion command interfaces
- ROS 2 integration with perception and control

Rules:
- ROS 2 is middleware, not the safety authority.
- Safety-critical limits remain below ROS 2.
- ROS 2 interfaces must use clearly defined message contracts.

## High-Level System Flow

```text
AI / Voice / Dashboard
          |
          v
    Robot Runtime
          |
          v
        ROS 2
          |
          v
   Control Layer
          |
          v
     Pico 2 W
          |
          v
       Hardware
```

## AI Boundary

AI systems may interpret natural language, plan actions, generate high-level commands, explain robot state, assist with diagnostics, manage memory, and interact with the dashboard.

AI systems must not directly write servo PWM values, bypass safety limits, directly access motor drivers, override emergency-stop logic, or assume hardware state without validated state.

Example command flow:

```text
User: "Walk forward"
        ↓
AI: REQUEST_MOTION(forward)
        ↓
Robot Runtime: Validate request
        ↓
ROS 2: Publish motion command
        ↓
Control: Generate safe gait
        ↓
Pico 2 W: Execute servo commands
```

## Source of Truth

Git is the source of truth for the Sipher software architecture.

Rules:
- Changes must be committed.
- Architecture changes must be documented.
- Agents must inspect existing code before modifying it.
- Agents must not delete working functionality without explicit reason.
- Large migrations should be performed in small commits.
- `main` must remain stable.
- Experimental architecture work should occur on dedicated branches.

## Agent Rules

Antigravity, OpenCode, and other coding agents must:
1. Read this architecture document before modifying Sipher.
2. Inspect existing code before creating replacements.
3. Preserve working functionality unless migration requires change.
4. Keep changes within the appropriate software layer.
5. Never bypass safety boundaries.
6. Never make destructive changes without explicit approval.
7. Run relevant tests or validation after changes.
8. Report changed files and validation results.
9. Commit coherent changes with descriptive commit messages.
10. Never treat generated code as automatically correct.

## Migration Principle

Existing working Sipher functionality should be migrated gradually.

Do not perform a complete rewrite unless explicitly approved.

Preferred process:

```text
Inspect → Map → Define destination → Migrate → Validate → Commit → Repeat
```

## Current Architecture Status

Initial architecture directories have been created:
- `software/control/`
- `software/robot/`
- `software/ros2/`

The existing Sipher implementation has not yet been fully migrated.

Migration must preserve existing robot functionality.
