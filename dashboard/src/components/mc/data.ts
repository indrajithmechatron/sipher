export type PresetId =
  | "robot-control"
  | "development"
  | "ai-engineering"
  | "vision"
  | "debug"
  | "mission-planning";

export const PRESETS: { id: PresetId; label: string; short: string; tabs: string[] }[] = [
  {
    id: "robot-control",
    label: "Robot Control",
    short: "CTL",
    tabs: ["digital-twin", "camera-map", "ai-monitor"],
  },
  {
    id: "development",
    label: "Development",
    short: "DEV",
    tabs: ["mission-editor", "ros-graph", "digital-twin"],
  },
  {
    id: "ai-engineering",
    label: "AI Engineering",
    short: "AIE",
    tabs: ["ai-monitor", "memory-viewer", "mission-editor"],
  },
  { id: "vision", label: "Vision", short: "VIS", tabs: ["camera-map", "digital-twin"] },
  { id: "debug", label: "Debug", short: "DBG", tabs: ["ros-graph", "ai-monitor", "memory-viewer"] },
  {
    id: "mission-planning",
    label: "Mission Planning",
    short: "MSN",
    tabs: ["mission-editor", "camera-map", "memory-viewer"],
  },
];

export const TABS: Record<string, { title: string; kind: string }> = {
  "digital-twin": { title: "Digital Twin", kind: "viewport" },
  "mission-editor": { title: "Mission Editor", kind: "graph" },
  "camera-map": { title: "Camera / Map", kind: "vision" },
  "ros-graph": { title: "ROS 2 Graph", kind: "graph" },
  "ai-monitor": { title: "AI Monitor", kind: "agent" },
  "memory-viewer": { title: "Memory Viewer", kind: "data" },
};

export type TreeNode = {
  id: string;
  label: string;
  meta?: string;
  tone?: "ok" | "warn" | "danger" | "signal";
  children?: TreeNode[];
};

export const EXPLORER: TreeNode[] = [
  {
    id: "robot",
    label: "Robot",
    children: [
      { id: "r-pico", label: "Pico 2 W", meta: "MicroPython 3.4", tone: "ok" },
      { id: "r-pi", label: "Raspberry Pi 4", meta: "sipher", tone: "ok" },
      { id: "r-gait", label: "Gait Controller", meta: "12 DoF", tone: "signal" },
      { id: "r-safety", label: "Safety Envelope", meta: "armed", tone: "warn" },
    ],
  },
  {
    id: "sensors",
    label: "Sensors",
    children: [
      { id: "s-mpu", label: "MPU6050", meta: "I2C1 0x68", tone: "ok" },
      { id: "s-ina", label: "INA219", meta: "I2C0 0x41", tone: "ok" },
      { id: "s-pca", label: "PCA9685", meta: "I2C0 0x40", tone: "ok" },
      { id: "s-vl", label: "VL53L0X", meta: "I2C0 0x29", tone: "ok" },
      { id: "s-gps", label: "NEO-6M GPS", meta: "UART GP0/1", tone: "muted" },
    ],
  },
  {
    id: "peripherals",
    label: "Peripherals",
    children: [
      { id: "p-tft", label: "ILI9341 TFT", meta: "SPI0 240x320", tone: "ok" },
      { id: "p-nrf", label: "nRF24L01+", meta: "SPI0 CSN:GP20", tone: "muted" },
      { id: "p-servo", label: "12x Servos", meta: "PCA9685 PWM" },
    ],
  },
  {
    id: "missions",
    label: "Missions",
    children: [
      { id: "m-1", label: "sensor_sweep.mission", meta: "running", tone: "ok" },
      { id: "m-2", label: "walk_test.mission" },
      { id: "m-3", label: "calibrate.servo" },
      { id: "m-4", label: "tft_demo.mission" },
    ],
  },
  {
    id: "agents",
    label: "Sensor Agents",
    children: [
      { id: "a-mpu", label: "imu-reader", meta: "active", tone: "signal" },
      { id: "a-ina", label: "power-monitor", meta: "active", tone: "signal" },
      { id: "a-vl", label: "tof-scanner", meta: "active", tone: "signal" },
      { id: "a-gps", label: "gps-parser", meta: "idle" },
      { id: "a-pca", label: "servo-controller", meta: "active", tone: "signal" },
    ],
  },
  {
    id: "buses",
    label: "I2C Buses",
    children: [
      { id: "b-0", label: "I2C0 (GP8/GP9)", meta: "PCA INA VL53", tone: "ok" },
      { id: "b-1", label: "I2C1 (GP2/GP3)", meta: "MPU6050", tone: "ok" },
    ],
  },
];

export type AgentEvent = {
  id: number;
  t: string;
  agent: string;
  action: string;
  detail: string;
  status: "running" | "ok" | "escalated" | "queued" | "failed";
  latency: string;
};

export const AGENT_EVENTS: AgentEvent[] = [
  {
    id: 1,
    t: "12:04:41.118",
    agent: "navigator",
    action: "tool:plan_path",
    detail: "waypoint W-07 → W-08, cost 12.4",
    status: "running",
    latency: "312 ms",
  },
  {
    id: 2,
    t: "12:04:40.902",
    agent: "perception",
    action: "tool:segment_frame",
    detail: "cam_front · 4 obstacles · conf 0.94",
    status: "ok",
    latency: "88 ms",
  },
  {
    id: 3,
    t: "12:04:39.640",
    agent: "safety-critic",
    action: "assert:slope_limit",
    detail: "pitch 21.4° > soft limit 18° — operator ack requested",
    status: "escalated",
    latency: "41 ms",
  },
  {
    id: 4,
    t: "12:04:38.271",
    agent: "task-planner",
    action: "tool:mcp.site-maps.query",
    detail: "sector B floorplan revision 14",
    status: "ok",
    latency: "402 ms",
  },
  {
    id: 5,
    t: "12:04:36.010",
    agent: "navigator",
    action: "tool:set_gait",
    detail: "trot → careful_trot (0.6 m/s)",
    status: "ok",
    latency: "27 ms",
  },
  {
    id: 6,
    t: "12:04:34.884",
    agent: "perception",
    action: "tool:lidar_cluster",
    detail: "1.2M pts · 9 clusters",
    status: "ok",
    latency: "173 ms",
  },
  {
    id: 7,
    t: "12:04:33.115",
    agent: "memory",
    action: "write:episodic",
    detail: "landmark 'loading_dock' embedded",
    status: "ok",
    latency: "64 ms",
  },
  {
    id: 8,
    t: "12:04:31.702",
    agent: "task-planner",
    action: "tool:decompose_goal",
    detail: "perimeter_sweep → 6 subtasks",
    status: "queued",
    latency: "—",
  },
  {
    id: 9,
    t: "12:04:29.441",
    agent: "navigator",
    action: "tool:recover_footing",
    detail: "RL foot slip detected, retry 1/3",
    status: "failed",
    latency: "220 ms",
  },
];

export const JOINTS = [
  { name: "FL_hip", value: -4.2, load: 34 },
  { name: "FL_thigh", value: 41.8, load: 62 },
  { name: "FL_calf", value: -78.3, load: 71 },
  { name: "FR_hip", value: 3.9, load: 31 },
  { name: "FR_thigh", value: 40.6, load: 58 },
  { name: "FR_calf", value: -77.1, load: 69 },
  { name: "RL_hip", value: -5.1, load: 39 },
  { name: "RL_thigh", value: 44.2, load: 74 },
  { name: "RL_calf", value: -80.6, load: 81 },
  { name: "RR_hip", value: 4.4, load: 36 },
  { name: "RR_thigh", value: 43.7, load: 66 },
  { name: "RR_calf", value: -79.9, load: 77 },
];

export const TERMINALS = [
  { id: "sensors", title: "sensors", host: "pico-2w" },
  { id: "commands", title: "commands", host: "pi-bridge" },
  { id: "agent", title: "agent-trace", host: "sipher" },
  { id: "problems", title: "Problems", host: "" },
];

export const TERMINAL_LINES: Record<string, { c: string; text: string }[]> = {
  sensors: [
    { c: "muted", text: "$ GET /api/sensors" },
    { c: "fg", text: "mpu: [0.12, -0.98, 9.78, 0.5, -1.2, 0.3]" },
    { c: "fg", text: "ina: { voltage_v: 12.4, current_ma: 340 }" },
    { c: "fg", text: "vl53_mm: 287" },
    { c: "muted", text: "$ _" },
  ],
  commands: [
    { c: "muted", text: "$ {\"cmd\":\"sensors\"}" },
    { c: "signal", text: "polling sensors at 1 Hz..." },
    { c: "muted", text: "$ _" },
  ],
  agent: [
    { c: "signal", text: "▸ imu-reader   i2c.read       22ms    ok" },
    { c: "signal", text: "▸ power-monitor i2c.read       18ms    ok" },
    { c: "signal", text: "▸ tof-scanner  i2c.read       35ms    ok" },
    { c: "signal", text: "▸ gps-parser   uart.read       —  idle" },
    { c: "signal", text: "▸ servo-ctrl   i2c.write      12ms    ok" },
    { c: "muted", text: "  5 agents · 0 alerts" },
  ],
  problems: [
    { c: "muted", text: "No active problems" },
  ],
};
