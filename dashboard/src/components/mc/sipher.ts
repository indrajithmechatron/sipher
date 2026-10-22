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

export type Joint = {
  name: string;
  value: number | null;
  load: number | null;
  pulse_us: number | null;
};

export type PiStats = {
  cpu_pct?: number | null;
  cpu_temp_c?: number | null;
  load1?: number | null;
  load5?: number | null;
  load15?: number | null;
  mem_used_pct?: number | null;
  mem_free_mb?: number | null;
  disk_used_pct?: number | null;
  uptime_s?: number | null;
  cores?: number | null;
  ts?: number;
};

export type Telemetry = {
  clock: string;
  battery: number | null;
  minutes: number | null;
  tempCore: number | null;
  tempMotor: number | null;
  bus: number | null;
  currentMa: number | null;
  powerMw: number | null;
  loopHz: number | null;
  linkMs: number | null;
  cpu: number | null;
  gpu: number | null;
  inferenceMs: number | null;
  pitch: number;
  roll: number;
  yaw: number;
  velocity: number;
  contacts: number;
  joints: Joint[];
  history: (number | null)[][];
  ros: "connected" | "degraded";
  piOnline: boolean;
  picoOnline: boolean;
  picoAgeMs: number | null;
  picoVersion: string | null;
  picoUptimeS: number | null;
  piStats: PiStats;
  raw: SensorPayload | null;
  mcp: { total: number; up: number };
  mission: { name: string; step: number; total: number; state: string };
  agents: Agent[];
  events: LiveEvent[];
};

export type SensorPayload = {
  cmd?: string;
  mpu?: number[];
  mpu_temp_c?: number | null;
  yaw_deg?: number | null;
  gps?: {
    lat?: number;
    lon?: number;
    raw?: string;
    fix?: boolean;
    speed_knots?: number;
    satellites?: number;
  };
  vl53_mm?: number | null;
  ina?: {
    voltage_v?: number;
    current_ma?: number;
    power_mw?: number;
    shunt_uv?: number;
    shunt_ohm?: number;
  } | null;
  pca?: {
    present?: boolean;
    pulse_us?: number[];
    /** null = channel not driven (pulse_us 0), so no meaningful angle */
    deg?: (number | null)[];
  } | null;
  i2c0?: string[];
  i2c1?: string[];
  uptime_s?: number;
  version?: string;
  dt_ms?: number | null;
  _meta?: {
    pi?: boolean;
    pico?: boolean;
    pico_age_ms?: number | null;
    bridge?: boolean;
    pi_stats?: PiStats;
    ts?: number;
  };
};

const API = typeof window !== "undefined" ? window.location.origin : "";
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

// INA219 measures the pack voltage; % needs a chemistry assumption. These are the
// documented 2-cell Li-ion endpoints. Outside that window the UI shows "-" instead
// of inventing a number.
const BATT_FULL_V = 8.4;
const BATT_EMPTY_V = 6.0;
const BATT_MIN_VALID_V = 5.0;
const BATT_MAX_VALID_V = 9.5;
const HISTORY_LEN = 60;

function fmtClock(d: Date) {
  return d.toISOString().slice(11, 23);
}

function computePitchRoll(mpu: number[]) {
  if (!mpu || mpu.length < 3) return { pitch: 0, roll: 0 };
  const [ax, ay, az] = mpu;
  const pitch = Math.atan2(ay, Math.sqrt(ax * ax + az * az)) * (180 / Math.PI);
  const roll = Math.atan2(-ax, Math.sqrt(ay * ay + az * az)) * (180 / Math.PI);
  return { pitch, roll };
}

function batteryPct(v: number | null | undefined): number | null {
  if (v == null || v < BATT_MIN_VALID_V || v > BATT_MAX_VALID_V) return null;
  return clamp(((v - BATT_EMPTY_V) / (BATT_FULL_V - BATT_EMPTY_V)) * 100, 0, 100);
}

const AGENT_SEEDS: Omit<Agent, "state" | "latency" | "tokens" | "cost" | "steps">[] = [
  { id: "a-mpu", name: "imu-reader", role: "sensor polling", task: "MPU6050 accel poll", tool: "i2c.read" },
  { id: "a-ina", name: "power-monitor", role: "power management", task: "INA219 bus read", tool: "i2c.read" },
  { id: "a-vl", name: "tof-scanner", role: "distance sensing", task: "VL53L0X single-shot", tool: "i2c.read" },
  { id: "a-gps", name: "gps-parser", role: "positioning", task: "NMEA parse", tool: "uart.read" },
  { id: "a-pca", name: "servo-controller", role: "joint actuation", task: "PCA9685 PWM readback", tool: "i2c.write" },
];

const AGENT_SENSOR: Record<string, (s: SensorPayload, bus: string[]) => boolean> = {
  "imu-reader": (_s, bus) => bus.includes("0x68"),
  "power-monitor": (_s, bus) => bus.includes("0x41"),
  "tof-scanner": (_s, bus) => bus.includes("0x29"),
  "gps-parser": (s) => Boolean(s.gps?.raw),
  "servo-controller": (_s, bus) => bus.includes("0x40"),
};

export function useSipherTelemetry(): Telemetry {
  const pollCount = useRef(0);
  const eventId = useRef(100);
  const sensorRef = useRef<SensorPayload>({});
  const piOkRef = useRef(false);
  const historyRef = useRef<Record<string, (number | null)[]>>({});
  const latencyRef = useRef(0);
  const lastAgentRef = useRef<Agent[]>(AGENT_SEEDS.map((a) => ({
    ...a, state: "idle" as AgentState, latency: 0, tokens: 0, cost: 0, steps: 0,
  })));
  const lastEventsRef = useRef<LiveEvent[]>([]);
  const flagsRef = useRef<Record<string, boolean | number>>({});
  // Blackbox storage for last good data when offline
  const blackboxRef = useRef({
    timestamp: 0,
    sensorData: null as SensorPayload | null,
    piOnline: false,
    picoOnline: false,
    errors: [] as string[],
  });

  const [state, setState] = useState<Telemetry>(() => ({
    clock: fmtClock(new Date()),
    battery: null, minutes: null, tempCore: null, tempMotor: null,
    bus: null, currentMa: null, powerMw: null,
    loopHz: null, linkMs: null, cpu: null, gpu: null, inferenceMs: null,
    pitch: 0, roll: 0, yaw: 0, velocity: 0, contacts: 0,
    joints: JOINTS.map((j) => ({ name: j.name, value: null, load: null, pulse_us: null })),
    history: JOINTS.map(() => []),
    ros: "degraded", piOnline: false, picoOnline: false, picoAgeMs: null,
    picoVersion: null, picoUptimeS: null, piStats: {}, raw: null,
    mcp: { total: 5, up: 0 },
    mission: { name: "sensor_sweep", step: 0, total: 5, state: "INIT" },
    agents: lastAgentRef.current,
    events: [],
  }));

  useEffect(() => {
    let alive = true;

    const pushEvent = (
      agent: string,
      action: string,
      detail: string,
      status: LiveEvent["status"],
      latency: string,
    ) => {
      eventId.current += 1;
      lastEventsRef.current = [
        { id: eventId.current, t: fmtClock(new Date()), agent, action, detail, status, latency, tokens: 0 },
        ...lastEventsRef.current,
      ].slice(0, 60);
    };

    const note = (key: string, value: boolean, agent: string, detail: string) => {
      const prev = flagsRef.current[key];
      if (prev === value) return;
      flagsRef.current[key] = value;
      pushEvent(agent, value ? "link:up" : "link:down", detail, value ? "ok" : "failed", "—");
    };

    const pollSensors = async () => {
      const t0 = performance.now();
      try {
        const r = await fetch(`${API}/api/sensors`);
        const ms = Math.round(performance.now() - t0);
        latencyRef.current = ms;
        if (r.ok) {
          sensorRef.current = await r.json();
          piOkRef.current = true;
          pollCount.current += 1;
          const prev = flagsRef.current["latency"];
          flagsRef.current["latency"] = ms;
          if (typeof prev === "number" && Math.abs(prev - ms) > 400) {
            pushEvent("bridge", "http:poll", `/api/sensors ${ms} ms (was ${prev} ms)`,
              ms > 1500 ? "failed" : "ok", `${ms} ms`);
          }
          // Update blackbox with new good data
          blackboxRef.current.timestamp = Date.now();
          blackboxRef.current.sensorData = sensorRef.current;
          blackboxRef.current.piOnline = true;
          blackboxRef.current.picoOnline = !!(sensorRef.current?._meta?.pico);
        } else {
          piOkRef.current = false;
          // Store offline timestamp in blackbox
          blackboxRef.current.timestamp = Date.now();
          // Add error log
          blackboxRef.current.errors.push(`Sensor poll failed: ${ms}ms`);
          // Keep only last 10 errors
          blackboxRef.current.errors = blackboxRef.current.errors.slice(-10);
        }
      } catch {
        piOkRef.current = false;
        // Store offline timestamp in blackbox
        blackboxRef.current.timestamp = Date.now();
        // Add error log
        blackboxRef.current.errors.push("Sensor poll connection error");
        // Keep only last 10 errors
        blackboxRef.current.errors = blackboxRef.current.errors.slice(-10);
      }
    };

    const iv = setInterval(() => {
      if (!alive) return;
      const s = sensorRef.current;
      pollSensors();

      const meta = s._meta ?? {};
      const piStats = meta?.pi_stats ?? {};
      const piOnline = piOkRef.current;
      const bridgeOk = meta?.bridge ?? false;
      // Prefer explicit meta.pico from firmware; fall back to MPU presence + piOnline
      const explicitPico = meta?.pico;
      const mpuPresent = (s.mpu?.length ?? 0) > 0;
      const picoOnline = explicitPico !== undefined ? explicitPico : mpuPresent && piOnline;
      // Use explicit pico_age_ms from firmware; fall back to link latency
      const explicitPicoAge = meta?.pico_age_ms;
      const picoAgeMs = explicitPicoAge !== undefined ? explicitPicoAge : null;
      const { pitch, roll } = computePitchRoll(s.mpu ?? []);
      const yaw = s.yaw_deg ?? 0;

      const voltageV = s.ina?.voltage_v ?? null;
      const currentMa = s.ina?.current_ma ?? null;
      const battery = batteryPct(voltageV);
      const speedMs = s.gps?.fix && s.gps?.speed_knots != null
        ? s.gps.speed_knots * 0.514444
        : 0;

      const bus = [...(s.i2c0 ?? []), ...(s.i2c1 ?? [])];
      const present: Record<string, boolean> = {
        mpu: bus.includes("0x68"),
        ina: bus.includes("0x41"),
        tof: bus.includes("0x29"),
        pca: bus.includes("0x40"),
        gps: Boolean(s.gps?.raw),
      };
      const sensorUp = Object.values(present).filter(Boolean).length;

      note("bridge", bridgeOk && piOnline, "bridge", "serial bridge :5001");
      note("pico", picoOnline, "pico", "Pico USB link");
      note("imu-reader", present.mpu! && picoOnline, "imu-reader", "MPU6050 @ 0x68");
      note("power-monitor", present.ina! && picoOnline, "power-monitor", "INA219 @ 0x41");
      note("tof-scanner", present.tof! && picoOnline, "tof-scanner", "VL53L0X @ 0x29");
      note("gps-parser", present.gps! && picoOnline, "gps-parser", "NMEA on UART0");
      note("servo-controller", present.pca! && picoOnline, "servo-controller", "PCA9685 @ 0x40");

      // ---- joints: PCA9685 register readback (exact commanded pulse -> degrees)
      const deg = s.pca?.present ? (s.pca.deg ?? []) : [];
      const pulses = s.pca?.present ? (s.pca.pulse_us ?? []) : [];
      const joints: Joint[] = deg.length
        ? deg.map((d, i) => ({
            name: JOINTS[i]?.name ?? `ch${i}`,
            value: d,
            load: null,
            pulse_us: pulses[i] ?? null,
          }))
        : JOINTS.map((j) => ({ name: j.name, value: null, load: null, pulse_us: null }));

      const hist = historyRef.current;
      const history = joints.map((j) => {
        const arr = hist[j.name] ?? [];
        if (j.value != null) {
          const next = [...arr, j.value];
          hist[j.name] = next.slice(-HISTORY_LEN);
        }
        return hist[j.name] ?? [];
      });

      // ---- real control-loop rate: firmware reports dt between sensor ticks
      const loopHz = s.dt_ms && s.dt_ms > 0
        ? Math.round((1000 / s.dt_ms) * 100) / 100
        : null;

      const agents: Agent[] = lastAgentRef.current.map((a) => {
        const next: Agent = {
          ...a,
          latency: latencyRef.current,
          tokens: 0,
          cost: 0,
          steps: a.steps,
        };
        if (!AGENT_SENSOR[a.name]) return next;
        const up = AGENT_SENSOR[a.name](s, bus) && picoOnline;
        if (up) {
          const overLimit = pitch > 25 && a.name === "imu-reader";
          next.state = overLimit ? "escalated" : "running";
          next.reason = overLimit ? `pitch ${pitch.toFixed(1)} deg exceeds limit` : undefined;
          next.escalateTo = overLimit ? "operator" : undefined;
          next.task = a.task;
        } else {
          next.state = "idle";
          next.reason = undefined;
          next.escalateTo = undefined;
          next.task = "waiting for link";
        }
        return next;
      });
      lastAgentRef.current = agents;

      setState({
        clock: fmtClock(new Date()),
        battery,
        minutes: null,
        tempCore: piStats.cpu_temp_c ?? null,
        tempMotor: null,
        bus: piOkRef.current ? voltageV : null,
        currentMa: piOkRef.current ? currentMa : null,
        powerMw: piOkRef.current ? s.ina?.power_mw ?? null : null,
        loopHz: piOkRef.current ? loopHz : null,
        linkMs: picoAgeMs,
        cpu: piOkRef.current ? piStats.cpu_pct ?? null : null,
        gpu: null,
        inferenceMs: null,
        pitch: piOkRef.current ? pitch : 0,
        roll: piOkRef.current ? roll : 0,
        yaw: piOkRef.current ? yaw : 0,
        velocity: piOkRef.current ? clamp(speedMs, 0, 30) : 0,
        contacts: piOkRef.current ? (s.vl53_mm != null
          ? (s.vl53_mm < 500 ? 4 : s.vl53_mm < 1000 ? 3 : 2)
            : 0) : 0,
        joints: piOkRef.current ? joints : JOINTS.map((j) => ({ name: j.name, value: null, load: null, pulse_us: null })),
        history: piOkRef.current ? history : JOINTS.map(() => []),
        ros: piOkRef.current && picoOnline ? "connected" : "degraded",
        piOnline: piOkRef.current, picoOnline: piOkRef.current ? (picoOnline ?? false) : false, picoAgeMs: piOkRef.current ? picoAgeMs : null,
        picoVersion: piOkRef.current ? s.version ?? null : null,
        picoUptimeS: piOkRef.current ? s.uptime_s ?? null : null,
        piStats: piOkRef.current ? piStats : {},
        raw: piOkRef.current ? (piOkRef.current ? s : null) : null,
        mcp: { total: 5, up: piOkRef.current ? sensorUp : 0 },
        mission: {
          name: "sensor_sweep",
          step: piOkRef.current ? sensorUp : 0,
          total: 5,
          state: piOkRef.current ? (picoOnline ? "RUNNING" : piOnline ? "DEGRADED" : "OFFLINE") : "OFFLINE",
        },
        agents,
        events: [...lastEventsRef.current],
      });
    }, 700);

    pollSensors();
    return () => { alive = false; clearInterval(iv); };
  }, []);

  return state;
}
