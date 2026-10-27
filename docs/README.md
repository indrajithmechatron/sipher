# Sipher Documentation

Everything written down about the robot, grouped by purpose. Start with the
root [`README.md`](../README.md) for the map of the repository; this page is the
index behind it.

## Design

| Document | What it covers |
|---|---|
| [`ARCHITECTURE.md`](./ARCHITECTURE.md) | The six layers, their hard boundaries, interfaces, safety rules and migration phases |
| [`../software/rag/README.md`](../software/rag/README.md) | Retrieval service: corpus, BM25 scoring, `/api/rag/*`, CLI, limits |
| [`../dashboard/README.md`](../dashboard/README.md) | Dashboard stack, build steps, AI backend, endpoint list |
| [`../dashboard/APPLICATION.md`](../dashboard/APPLICATION.md) | Installing the dashboard as a Windows desktop app |

## Operation

| Document | What it covers |
|---|---|
| [`pi-setup.md`](./pi-setup.md) | Pi 4 network, audio, Pico, SSH access |
| [`hardware/pico-wiring.md`](./hardware/pico-wiring.md) | Pin mapping and wiring for the Pico 2 W |
| [`../deploy/README.md`](../deploy/README.md) | Auto-deploy, systemd units, SSH key setup |

## Layer notes

Each `software/<layer>/README.md` documents that layer's files, rules and how to
run it: [`voice`](../software/voice/README.md), [`rag`](../software/rag/README.md),
[`robot`](../software/robot/README.md), [`ros2`](../software/ros2/README.md),
[`control`](../software/control/README.md), [`firmware`](../software/firmware/README.md),
[`telemetry`](../software/telemetry/README.md).

## Reports

`reports/` holds dated snapshots. They describe the tree **as it was on that
date** and are not edited afterwards; treat later changes as authoritative.

| Report | Date |
|---|---|
| [`reports/architecture-inspection-report.md`](./reports/architecture-inspection-report.md) | Layer-by-layer inspection of the original layout |
| [`reports/2026-09-20.md`](./reports/2026-09-20.md) | Daily development notes |

## Conventions

- Layer rules are normative in `ARCHITECTURE.md`; a README must not contradict
  it. If code changes a boundary, change the architecture document in the same
  commit.
- Commands are written as runnable blocks with the working directory implied by
  the file's location.
- Nothing secret is recorded here: passwords, keys and tokens live outside the
  repository (see *Security* in the root README).
