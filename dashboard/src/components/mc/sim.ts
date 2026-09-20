import { useEffect, useRef, useState } from "react";
import { JOINTS } from "./data";

export type AgentState = "running" | "idle" | "escalated" | "failed" | "blocked";

export type Agent = {
  id: string;
  name: string;
  role: string;
  state: AgentState;
  task: string;
  tool: string;
  latency: number;
  tokens: number;
  cost: number;
  steps: number;
  reason?: string | undefined;
  escalateTo?: string | undefined;
};

export type LiveEvent = {
  id: number;
  t: string;
  agent: string;
  action: string;
  detail: string;
  status: "running" | "ok" | "escalated" | "queued" | "failed";
  latency: string;
  tokens: number;
};

export type Joint = { name: string; value: number; load: number; target: number };

export type Telemetry = {
  clock: string;
  battery: number;
  minutes: number;
  tempCore: number;
  tempMotor: number;
  bus: number;
  loopHz: number;
  linkMs: number;
  cpu: number;
  gpu: number;
  inferenceMs: number;
  pitch: number;
  roll: number;
  yaw: number;
  velocity: number;
  contacts: number;
  joints: Joint[];
  history: number[][];
  ros: "connected" | "degraded";
  mcp: { total: number; up: number };
  mission: { name: string; step: number; total: number; state: string };
  agents: Agent[];
  events: LiveEvent[];
};

const AGENT_SEEDS: Omit<Agent, "state" | "latency" | "tokens" | "cost" | "steps">[] = [
  { id: "a-nav", name: "navigator", role: "path planning", task: "waypoint W-07 → W-08", tool: "plan_path" },
  { id: "a-per", name: "perception", role: "scene understanding", task: "cam_front segmentation", tool: "segment_frame" },
  { id: "a-pln", name: "task-planner", role: "goal decomposition", task: "perimeter_sweep → 6 subtasks", tool: "mcp.site-maps.query" },
  { id: "a-saf", name: "safety-critic", role: "envelope enforcement", task: "slope + torque assertions", tool: "assert:slope_limit" },
  { id: "a-mem", name: "memory", role: "episodic recall", task: "landmark embedding", tool: "write:episodic" },
];

const TASKS: Record<string, string[]> = {
  navigator: ["waypoint W-07 → W-08", "replan around obstacle #4", "gait switch careful_trot", "recover footing RL"],
  perception: ["cam_front segmentation", "lidar cluster 1.2M pts", "thermal delta @ panel rack", "depth fusion 30 fps"],
  "task-planner": ["decompose perimeter_sweep", "query sector B floorplan r14", "schedule thermal capture", "dock return budget"],
  "safety-critic": ["slope + torque assertions", "geofence sector_b check", "battery reserve audit", "e-stop readiness"],
  memory: ["landmark embedding", "slip event write", "policy recall v7", "semantic index compact"],
};

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

function fmtClock(d: Date) {
  return d.toISOString().slice(11, 23);
}

export function useSimulation(running = true): Telemetry {
  const tick = useRef(0);
  const eventId = useRef(100);
  const [state, setState] = useState<Telemetry>(() => ({
    clock: "12:04:41.118",
    battery: 78,
    minutes: 41,
    tempCore: 47.3,
    tempMotor: 52.1,
    bus: 58.2,
    loopHz: 400,
    linkMs: 6,
    cpu: 41,
    gpu: 63,
    inferenceMs: 18.4,
    pitch: 21.4,
    roll: 0.8,
    yaw: 128.4,
    velocity: 0.62,
    contacts: 3,
    joints: JOINTS.map((j) => ({ ...j, target: j.value })),
    history: JOINTS.map((j) => Array.from({ length: 60 }, () => j.value)),
    ros: "connected",
    mcp: { total: 4, up: 3 },
    mission: { name: "perimeter_sweep", step: 3, total: 6, state: "RUNNING" },
    agents: AGENT_SEEDS.map((a, i) => ({
      ...a,
      state: i === 3 ? "escalated" : i === 2 ? "idle" : "running",
      latency: 120 + i * 60,
      tokens: 3200 + i * 1800,
      cost: 0.0012 * (i + 1),
      steps: 4 + i,
      ...(i === 3
        ? { reason: "pitch 21.4° exceeds soft slope limit 18.0°", escalateTo: "operator · console-1" }
        : {}),
    })),
    events: [],
  }));

  useEffect(() => {
    if (!running) return;
    const iv = setInterval(() => {
      tick.current += 1;
      const n = tick.current;
      setState((s) => {
        const joints = s.joints.map((j, i) => {
          const target = j.value + Math.sin(n / 6 + i) * 1.6;
          const value = j.value + (target - j.value) * 0.4 + rnd(-0.35, 0.35);
          return {
            ...j,
            value,
            target,
            load: clamp(j.load + rnd(-3, 3), 12, 96),
          };
        });
        const history = s.history.map((h, i) => [...h.slice(1), joints[i]!.value]);

        const pitch = clamp(s.pitch + rnd(-0.6, 0.6), 12, 24);
        const agents = s.agents.map((a) => {
          const roll = Math.random();
          let next: Agent = {
            ...a,
            latency: Math.round(clamp(a.latency + rnd(-45, 45), 22, 900)),
            tokens: a.tokens + Math.round(rnd(0, 260)),
            cost: a.cost + rnd(0, 0.0006),
          };
          if (a.name === "safety-critic") {
            next = pitch > 18
              ? {
                  ...next,
                  state: "escalated",
                  reason: `pitch ${pitch.toFixed(1)}° exceeds soft slope limit 18.0°`,
                  escalateTo: "operator · console-1",
                }
              : { ...next, state: "running", reason: undefined, escalateTo: undefined };
            return next;
          }
          if (roll < 0.05) {
            const pool = TASKS[a.name] ?? [a.task];
            next.task = pool[Math.floor(Math.random() * pool.length)]!;
            next.steps = a.steps + 1;
          }
          if (roll > 0.975) {
            next.state = "failed";
            next.reason = "tool call timeout after 3 retries";
            next.escalateTo = "orchestrator · auto-retry";
          } else if (roll > 0.93) {
            next.state = "idle";
            next.reason = undefined;
            next.escalateTo = undefined;
          } else {
            next.state = "running";
            next.reason = undefined;
            next.escalateTo = undefined;
          }
          return next;
        });

        let events = s.events;
        if (n % 3 === 0) {
          const a = agents[Math.floor(Math.random() * agents.length)]!;
          eventId.current += 1;
          const status: LiveEvent["status"] =
            a.state === "escalated"
              ? "escalated"
              : a.state === "failed"
                ? "failed"
                : Math.random() > 0.75
                  ? "running"
                  : "ok";
          events = [
            {
              id: eventId.current,
              t: fmtClock(new Date()),
              agent: a.name,
              action: `tool:${a.tool}`,
              detail: a.reason ?? a.task,
              status,
              latency: `${a.latency} ms`,
              tokens: Math.round(rnd(120, 1400)),
            },
            ...s.events,
          ].slice(0, 60);
        }

        const battery = clamp(s.battery - 0.004, 4, 100);
        return {
          ...s,
          clock: fmtClock(new Date()),
          joints,
          history,
          pitch,
          roll: clamp(s.roll + rnd(-0.3, 0.3), -6, 6),
          yaw: (s.yaw + rnd(-0.4, 0.6) + 360) % 360,
          velocity: clamp(s.velocity + rnd(-0.04, 0.04), 0, 1.4),
          contacts: Math.random() > 0.9 ? 2 : Math.random() > 0.5 ? 3 : 4,
          battery,
          minutes: Math.round(battery * 0.52),
          tempCore: clamp(s.tempCore + rnd(-0.4, 0.45), 38, 74),
          tempMotor: clamp(s.tempMotor + rnd(-0.5, 0.55), 40, 88),
          bus: clamp(s.bus + rnd(-0.15, 0.15), 46, 60),
          loopHz: Math.round(clamp(s.loopHz + rnd(-6, 6), 360, 405)),
          linkMs: Math.round(clamp(s.linkMs + rnd(-1.5, 1.5), 3, 28)),
          cpu: Math.round(clamp(s.cpu + rnd(-4, 4), 12, 96)),
          gpu: Math.round(clamp(s.gpu + rnd(-4, 4), 15, 98)),
          inferenceMs: clamp(s.inferenceMs + rnd(-1.6, 1.6), 6, 48),
          agents,
          events,
        };
      });
    }, 700);
    return () => clearInterval(iv);
  }, [running]);

  return state;
}
