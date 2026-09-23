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
  piOnline: boolean;
  picoOnline: boolean;
  picoAgeMs: number | null;
  raw: SensorPayload | null;
  mcp: { total: number; up: number };
  mission: { name: string; step: number; total: number; state: string };
  agents: Agent[];
  events: LiveEvent[];
};

export type SensorPayload = {
  cmd?: string;
  mpu?: number[];
  gps?: {
    lat?: number;
    lon?: number;
    raw?: string;
    fix?: boolean;
    speed_knots?: number;
    satellites?: number;
  };
  vl53_mm?: number | null;
  ina?: { voltage_v?: number; current_ma?: number; shunt_uv?: number } | null;
  pca?: { duty?: number; pulse_ms?: number; pulse_us?: number };
  i2c0?: string[];
  i2c1?: string[];
  uptime_s?: number;
  version?: string;
  _meta?: {
    pi?: boolean;
    pico?: boolean;
    pico_age_ms?: number | null;
    bridge?: boolean;
    ts?: number;
  };
};

const API = typeof window !== "undefined" ? window.location.origin : "";
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const pick = <T>(a: T[]): T => a[Math.floor(Math.random() * a.length)]!;

function fmtClock(d: Date) {
  return d.toISOString().slice(11, 23);
}

function computePitchRoll(mpu: number[]) {
  if (!mpu || mpu.length < 3) return { pitch: 0, roll: 0, yaw: 0 };
  const [ax, ay, az] = mpu;
  const pitch = Math.atan2(ay, Math.sqrt(ax * ax + az * az)) * (180 / Math.PI);
  const roll = Math.atan2(-ax, Math.sqrt(ay * ay + az * az)) * (180 / Math.PI);
  const yaw = mpu.length >= 6 ? Math.atan2(mpu[4], mpu[3]) * (180 / Math.PI) : 0;
  return { pitch, roll, yaw };
}

const AGENT_SEEDS: Omit<Agent, "state" | "latency" | "tokens" | "cost" | "steps">[] = [
  { id: "a-mpu", name: "imu-reader", role: "sensor polling", task: "MPU6050 @ 50 Hz", tool: "i2c.read" },
  { id: "a-ina", name: "power-monitor", role: "power management", task: "INA219 bus current", tool: "i2c.read" },
  { id: "a-vl", name: "tof-scanner", role: "distance sensing", task: "VL53L0X single-shot", tool: "i2c.read" },
  { id: "a-gps", name: "gps-parser", role: "positioning", task: "NMEA GGA parse", tool: "uart.read" },
  { id: "a-pca", name: "servo-controller", role: "joint actuation", task: "PCA9685 PWM output", tool: "i2c.write" },
];

const TASKS: Record<string, string[]> = {
  "imu-reader": ["MPU6050 accel poll", "gyro drift comp", "temp compensation", "filter update"],
  "power-monitor": ["INA219 voltage read", "current sample", "power budget check", "low-batt alert"],
  "tof-scanner": ["VL53L0X single-shot", "range filter", "noise reject", "calibration offset"],
  "gps-parser": ["NMEA GGA parse", "fix quality check", "sat count monitor", "PPS sync"],
  "servo-controller": ["PCA9685 pulse write", "joint homing", "torque limit check", "interpolation step"],
};

export function useSipherTelemetry(): Telemetry {
  const tick = useRef(0);
  const eventId = useRef(100);
  const sensorRef = useRef<SensorPayload>({});
  const piOkRef = useRef(false);

  const [state, setState] = useState<Telemetry>(() => ({
    clock: fmtClock(new Date()),
    battery: 0, minutes: 0, tempCore: 0, tempMotor: 0, bus: 0,
    loopHz: 0, linkMs: 0, cpu: 0, gpu: 0, inferenceMs: 0,
    pitch: 0, roll: 0, yaw: 0, velocity: 0, contacts: 0,
    joints: JOINTS.map((j) => ({ ...j, target: j.value })),
    history: JOINTS.map(() => Array.from({ length: 60 }, () => 90)),
    ros: "degraded", piOnline: false, picoOnline: false, picoAgeMs: null, raw: null,
    mcp: { total: 5, up: 0 },
    mission: { name: "sensor_init", step: 0, total: 5, state: "INIT" },
    agents: AGENT_SEEDS.map((a) => ({
      ...a, state: "idle" as AgentState, latency: 0, tokens: 0, cost: 0, steps: 0,
    })),
    events: [],
  }));

  useEffect(() => {
    let alive = true;

    const pollSensors = async () => {
      try {
        const r = await fetch(`${API}/api/sensors`);
        if (r.ok) {
          sensorRef.current = await r.json();
          piOkRef.current = true;
        } else {
          piOkRef.current = false;
        }
      } catch {
        piOkRef.current = false;
      }
    };

    const iv = setInterval(() => {
      if (!alive) return;
      tick.current += 1;
      const n = tick.current;
      const s = sensorRef.current;
      pollSensors();

      const meta = s._meta;
      const piOnline = piOkRef.current;
      const picoOnline = meta?.pico ?? ((s.mpu?.length ?? 0) > 0 && piOnline);
      const picoAgeMs = meta?.pico_age_ms ?? null;
      const { pitch, roll, yaw } = computePitchRoll(s.mpu ?? []);
      const voltageV = s.ina?.voltage_v ?? 0;
      const battery = voltageV > 0 ? clamp(voltageV / 12.6 * 100, 0, 100) : 0;
      const contacts = s.vl53_mm != null ? (s.vl53_mm < 500 ? 4 : s.vl53_mm < 1000 ? 3 : 2) : 0;
      const speedMs = s.gps?.speed_knots != null ? s.gps.speed_knots * 0.514444 : 0;

      const sensorUp = [
        (s.mpu?.length ?? 0) > 0,
        s.ina != null,
        s.vl53_mm != null,
        s.gps?.raw != null,
        (s.i2c0?.length ?? 0) > 0 || (s.i2c1?.length ?? 0) > 0,
      ].filter(Boolean).length;

      const joints = JOINTS.map((j, i) => {
        const target = j.value + Math.sin(n / 6 + i) * 1.2;
        const value = j.value + (target - j.value) * 0.3 + rnd(-0.2, 0.2);
        const load = clamp(30 + Math.sin(n / 4 + i) * 15 + rnd(-5, 5), 10, 95);
        return { ...j, value, target, load };
      });
      const history = state.history.map((h, i) => [...h.slice(1), joints[i]!.value]);

      const agents = state.agents.map((a) => {
        const next: Agent = {
          ...a,
          latency: Math.round(clamp(20 + Math.sin(n / 3) * 30 + rnd(-5, 5), 5, 200)),
          tokens: a.tokens + Math.round(rnd(10, 80)),
          cost: a.cost + rnd(0, 0.0001),
          steps: a.steps,
        };
        if (Math.random() < 0.03) { next.task = pick(TASKS[a.name] ?? [a.task]); next.steps = a.steps + 1; }
        if (pitch > 25 && a.name === "imu-reader") {
          next.state = "escalated"; next.reason = `pitch ${pitch.toFixed(1)} deg exceeds limit`;
          next.escalateTo = "operator"; next.steps = a.steps + 1;
        } else { next.state = picoOnline ? "running" : "idle"; next.reason = undefined; next.escalateTo = undefined; }
        return next;
      });

      let events = state.events;
      if (n % 3 === 0 && piOnline) {
        const a = pick(agents);
        eventId.current += 1;
        const status = a.state === "escalated" ? "escalated" as const : picoOnline ? "ok" as const : "running" as const;
        events = [
          { id: eventId.current, t: fmtClock(new Date()), agent: a.name, action: `tool:${a.tool}`,
            detail: a.reason ?? a.task, status, latency: `${a.latency} ms`, tokens: Math.round(rnd(20, 200)) },
          ...state.events,
        ].slice(0, 60);
      }

      setState({
        clock: fmtClock(new Date()),
        battery, minutes: battery > 0 ? Math.round(battery * 0.5) : 0,
        tempCore: s.mpu && s.mpu.length >= 6 ? clamp(42 + (s.mpu[2] ?? 0) % 3, 35, 80) : 0,
        tempMotor: 0,
        bus: voltageV,
        loopHz: picoOnline ? 1 : 0,
        linkMs: piOnline ? Math.round(clamp(15 + rnd(-3, 3), 0, 200)) : 0,
        cpu: 0, gpu: 0, inferenceMs: 0,
        pitch, roll, yaw,
        velocity: clamp(speedMs, 0, 30),
        contacts, joints, history,
        ros: picoOnline && piOnline ? "connected" : "degraded",
        piOnline, picoOnline, picoAgeMs, raw: piOnline ? s : null,
        mcp: { total: 5, up: sensorUp },
        mission: {
          name: "sensor_sweep",
          step: sensorUp,
          total: 5,
          state: picoOnline ? "RUNNING" : piOnline ? "DEGRADED" : "OFFLINE",
        },
        agents, events,
      });
    }, 700);

    pollSensors();
    return () => { alive = false; clearInterval(iv); };
  }, []);

  return state;
}
