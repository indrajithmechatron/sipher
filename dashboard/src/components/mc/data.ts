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
      { id: "r-kine", label: "Kinematics", meta: "12 DoF" },
      { id: "r-imu", label: "IMU / State Estimator", meta: "400 Hz", tone: "ok" },
      { id: "r-gait", label: "Gait Controller", meta: "trot", tone: "signal" },
      { id: "r-power", label: "Power Bus", meta: "58.2 V" },
      { id: "r-safety", label: "Safety Envelope", meta: "armed", tone: "warn" },
    ],
  },
  {
    id: "missions",
    label: "Missions",
    children: [
      { id: "m-1", label: "perimeter_sweep.mission", meta: "running", tone: "ok" },
      { id: "m-2", label: "stair_traversal.mission" },
      { id: "m-3", label: "thermal_inspect.mission" },
      { id: "m-4", label: "dock_return.mission" },
    ],
  },
  {
    id: "agents",
    label: "AI Agents",
    children: [
      { id: "a-nav", label: "navigator", meta: "active", tone: "signal" },
      { id: "a-per", label: "perception", meta: "active", tone: "signal" },
      { id: "a-pln", label: "task-planner", meta: "idle" },
      { id: "a-saf", label: "safety-critic", meta: "watching", tone: "warn" },
    ],
  },
  {
    id: "ros2",
    label: "ROS 2 Graph",
    children: [
      { id: "n-1", label: "/locomotion_ctrl", meta: "42 topics" },
      { id: "n-2", label: "/depth_front", meta: "30 fps" },
      { id: "n-3", label: "/lidar_360", meta: "10 Hz" },
      { id: "n-4", label: "/tf_broadcaster" },
    ],
  },
  {
    id: "mcp",
    label: "MCP Servers",
    children: [
      { id: "s-1", label: "fleet-telemetry", meta: "connected", tone: "ok" },
      { id: "s-2", label: "site-maps", meta: "connected", tone: "ok" },
      { id: "s-3", label: "maintenance-log", meta: "degraded", tone: "warn" },
    ],
  },
  {
    id: "logs",
    label: "Recordings",
    children: [
      { id: "l-1", label: "2026-08-15_sweep.mcap", meta: "1.8 GB" },
      { id: "l-2", label: "2026-08-14_stairs.mcap", meta: "740 MB" },
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
  { id: "ros", title: "ros2 · bash", host: "spot-alpha" },
  { id: "agent", title: "agent-trace", host: "orchestrator" },
  { id: "build", title: "colcon build", host: "workstation" },
  { id: "problems", title: "Problems", host: "" },
];

export const TERMINAL_LINES: Record<string, { c: string; text: string }[]> = {
  ros: [
    { c: "muted", text: "$ ros2 topic hz /locomotion_ctrl/state" },
    { c: "fg", text: "average rate: 399.812" },
    { c: "fg", text: "  min: 0.002s max: 0.003s std dev: 0.00011s window: 400" },
    { c: "muted", text: "$ ros2 node list --namespace /perception" },
    { c: "fg", text: "/perception/depth_front  /perception/lidar_360  /perception/fusion" },
    { c: "warn", text: "[WARN] [1755331481.0] tf lookup 'odom'→'base_link' 42ms behind" },
    { c: "muted", text: "$ _" },
  ],
  agent: [
    { c: "signal", text: "▸ navigator  plan_path        312ms   ok" },
    { c: "signal", text: "▸ perception segment_frame    88ms    ok" },
    { c: "warn", text: "▸ safety-critic slope_limit    41ms    ESCALATED → operator" },
    { c: "fg", text: "  context 18,204 tok · cache hit 71% · $0.0042" },
    { c: "muted", text: "  awaiting operator acknowledgement…" },
  ],
  build: [
    { c: "fg", text: "Starting >>> quad_locomotion" },
    { c: "fg", text: "Finished <<< quad_locomotion [4.12s]" },
    { c: "fg", text: "Starting >>> quad_perception" },
    { c: "ok", text: "Summary: 12 packages finished [18.4s]" },
  ],
  problems: [
    { c: "warn", text: "⚠ gait_controller.cpp:214  unchecked slip recovery return value" },
    { c: "danger", text: "✕ mcp/maintenance-log  handshake timeout (3 retries)" },
    { c: "muted", text: "ℹ mission perimeter_sweep: 2 waypoints outside mapped area" },
  ],
};
