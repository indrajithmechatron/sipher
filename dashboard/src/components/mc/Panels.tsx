import { JOINTS, AGENT_EVENTS } from "./data";
import { Chip, Dot } from "./chrome";
import { cn } from "@/lib/utils";

function ViewportOverlay({ label, hud }: { label: string; hud: string[] }) {
  return (
    <>
      <div className="pointer-events-none absolute top-3 left-3 font-mono text-[10px] tracking-[0.2em] text-muted-foreground uppercase">
        {label}
      </div>
      <div className="pointer-events-none absolute top-3 right-3 space-y-1 text-right font-mono text-[10px] text-muted-foreground">
        {hud.map((h) => (
          <div key={h}>{h}</div>
        ))}
      </div>
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute top-1/2 left-4 h-px w-4 bg-signal/40" />
        <div className="absolute top-1/2 right-4 h-px w-4 bg-signal/40" />
        <div className="absolute top-4 left-1/2 h-4 w-px bg-signal/40" />
        <div className="absolute bottom-4 left-1/2 h-4 w-px bg-signal/40" />
      </div>
    </>
  );
}

function RobotFigure() {
  return (
    <svg viewBox="0 0 420 240" className="h-full w-full max-w-2xl">
      <defs>
        <linearGradient id="body" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="oklch(0.42 0.006 260)" />
          <stop offset="100%" stopColor="oklch(0.26 0.005 260)" />
        </linearGradient>
      </defs>
      <ellipse cx="210" cy="205" rx="120" ry="10" fill="oklch(0 0 0 / 40%)" />
      <g stroke="oklch(0.55 0.02 220)" strokeWidth="4" fill="none" strokeLinecap="round">
        <path d="M120 130 L104 168 L118 196" />
        <path d="M150 132 L138 170 L152 197" />
        <path d="M272 132 L288 170 L272 197" />
        <path d="M300 130 L316 168 L302 196" />
      </g>
      <rect x="118" y="96" width="184" height="40" rx="12" fill="url(#body)" />
      <rect
        x="118"
        y="96"
        width="184"
        height="40"
        rx="12"
        fill="none"
        stroke="oklch(0.5 0.01 260)"
      />
      <rect x="296" y="86" width="44" height="34" rx="8" fill="url(#body)" />
      <circle cx="332" cy="100" r="5" fill="oklch(0.82 0.115 200)" />
      <circle cx="332" cy="100" r="10" fill="none" stroke="oklch(0.82 0.115 200 / 30%)" />
      <rect x="150" y="80" width="60" height="12" rx="4" fill="oklch(0.3 0.005 260)" />
      <g fill="oklch(0.82 0.115 200)">
        {[120, 150, 272, 300].map((x) => (
          <circle key={x} cx={x} cy={131} r="3" />
        ))}
      </g>
      <g stroke="oklch(0.82 0.115 200 / 35%)" strokeDasharray="3 5" fill="none">
        <path d="M332 100 L410 60" />
        <path d="M332 100 L410 140" />
      </g>
    </svg>
  );
}

export function DigitalTwin() {
  return (
    <div className="flex h-full min-h-0">
      <div className="relative min-w-0 flex-1 grid-field bg-background">
        <ViewportOverlay
          label="Digital Twin · perspective"
          hud={["gait careful_trot", "v 0.62 m/s", "pitch 3.1° roll 0.8°", "contacts 3/4"]}
        />
        <div className="flex h-full items-center justify-center p-10">
          <RobotFigure />
        </div>
        <div className="absolute bottom-3 left-3 flex gap-1.5">
          {["Perspective", "Front", "Top", "Wireframe", "Collision"].map((v, i) => (
            <Chip key={v} active={i === 0}>
              {v}
            </Chip>
          ))}
        </div>
      </div>
      <div className="hairline-l w-64 shrink-0 overflow-y-auto bg-panel">
        <div className="hairline-b px-3 py-2 font-mono text-[10px] tracking-[0.18em] text-muted-foreground uppercase">
          Joint Telemetry
        </div>
        {JOINTS.map((j) => (
          <div key={j.name} className="hairline-b px-3 py-1.5">
            <div className="flex items-baseline justify-between">
              <span className="font-mono text-[11px] text-foreground/85">{j.name}</span>
              <span className="tabular font-mono text-[11px] text-muted-foreground">
                {j.value.toFixed(1)}°
              </span>
            </div>
            <div className="mt-1 h-[3px] w-full overflow-hidden rounded-full bg-rail">
              <div
                className={cn("h-full", j.load > 75 ? "bg-warn" : "bg-signal/70")}
                style={{ width: `${j.load}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const MISSION_STEPS = [
  { id: "01", label: "Undock", state: "done" },
  { id: "02", label: "Navigate → sector B", state: "done" },
  { id: "03", label: "Perimeter sweep (6 waypoints)", state: "active" },
  { id: "04", label: "Thermal capture @ panel rack", state: "queued" },
  { id: "05", label: "Stair traversal ↑ level 2", state: "queued" },
  { id: "06", label: "Return to dock & upload", state: "queued" },
];

export function MissionEditor() {
  return (
    <div className="flex h-full min-h-0">
      <div className="relative min-w-0 flex-1 grid-field overflow-auto bg-background p-8">
        <div className="mx-auto max-w-xl space-y-0">
          {MISSION_STEPS.map((s, i) => (
            <div key={s.id} className="flex gap-4">
              <div className="flex flex-col items-center">
                <span
                  className={cn(
                    "grid size-7 shrink-0 place-items-center rounded-sm border font-mono text-[10px]",
                    s.state === "active"
                      ? "border-signal bg-signal/10 text-signal"
                      : s.state === "done"
                        ? "border-hairline bg-panel text-muted-foreground"
                        : "border-dashed border-hairline text-muted-foreground/60",
                  )}
                >
                  {s.id}
                </span>
                {i < MISSION_STEPS.length - 1 && <span className="w-px flex-1 bg-hairline" />}
              </div>
              <div
                className={cn(
                  "mb-3 flex-1 rounded-sm border bg-panel px-3 py-2",
                  s.state === "active" ? "border-signal/40" : "border-hairline",
                )}
              >
                <div className="flex items-center gap-2">
                  <span className="text-[12px] text-foreground/90">{s.label}</span>
                  <span className="ml-auto font-mono text-[10px] text-muted-foreground uppercase">
                    {s.state}
                  </span>
                </div>
                <div className="mt-1 font-mono text-[10px] text-muted-foreground/70">
                  guard: safety-critic · retry 2 · timeout 180s
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="hairline-l w-60 shrink-0 bg-panel p-3">
        <div className="font-mono text-[10px] tracking-[0.18em] text-muted-foreground uppercase">
          Node Library
        </div>
        <div className="mt-2 space-y-1">
          {[
            "Navigate To",
            "Inspect Object",
            "Capture Thermal",
            "Manipulate",
            "Wait For Operator",
            "Branch On Confidence",
            "Call MCP Tool",
          ].map((n) => (
            <div
              key={n}
              className="cursor-grab rounded-sm border border-hairline bg-panel-raised px-2 py-1.5 font-mono text-[11px] text-foreground/80 hover:border-signal/40 hover:text-signal"
            >
              {n}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function CameraMap() {
  return (
    <div className="grid h-full min-h-0 grid-cols-2 grid-rows-2 gap-px bg-hairline">
      {["cam_front", "cam_rear", "depth_fusion"].map((c) => (
        <div key={c} className="relative bg-background">
          <div className="absolute inset-0 grid-field opacity-60" />
          <div className="absolute top-2 left-2 flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground">
            <Dot tone="ok" live /> {c} · 30fps
          </div>
          <div className="absolute inset-0 overflow-hidden">
            <div className="absolute top-0 h-full w-16 bg-gradient-to-r from-transparent via-signal/5 to-transparent sweep-line" />
          </div>
          <div className="absolute top-1/3 left-1/4 h-16 w-20 rounded-sm border border-signal/60">
            <span className="absolute -top-4 left-0 font-mono text-[9px] text-signal">
              pallet 0.94
            </span>
          </div>
          <div className="absolute right-1/4 bottom-1/4 h-10 w-10 rounded-sm border border-warn/60">
            <span className="absolute -top-4 left-0 font-mono text-[9px] text-warn">human 0.88</span>
          </div>
        </div>
      ))}
      <div className="relative bg-background">
        <div className="absolute inset-0 grid-field" />
        <div className="absolute top-2 left-2 font-mono text-[10px] text-muted-foreground">
          occupancy map · sector B
        </div>
        <svg viewBox="0 0 200 140" className="absolute inset-0 h-full w-full">
          <path
            d="M20 120 L20 30 L90 30 L90 70 L160 70 L160 120 Z"
            fill="oklch(0.22 0.004 260)"
            stroke="oklch(0.4 0.01 260)"
          />
          <path
            d="M30 110 L45 60 L100 55 L140 90"
            fill="none"
            stroke="oklch(0.82 0.115 200)"
            strokeWidth="1.4"
            strokeDasharray="4 3"
          />
          <circle cx="140" cy="90" r="4" fill="oklch(0.82 0.115 200)" />
          {[
            [45, 60],
            [100, 55],
          ].map(([x, y]) => (
            <circle
              key={x}
              cx={x}
              cy={y}
              r="2.5"
              fill="none"
              stroke="oklch(0.78 0.13 155)"
              strokeWidth="1.2"
            />
          ))}
        </svg>
      </div>
    </div>
  );
}

const NODES = [
  { id: "lidar_360", x: 12, y: 20 },
  { id: "depth_front", x: 12, y: 60 },
  { id: "fusion", x: 40, y: 40 },
  { id: "state_est", x: 40, y: 76 },
  { id: "planner", x: 66, y: 30 },
  { id: "locomotion_ctrl", x: 66, y: 66 },
  { id: "actuators", x: 88, y: 48 },
];
const EDGES: [string, string][] = [
  ["lidar_360", "fusion"],
  ["depth_front", "fusion"],
  ["fusion", "planner"],
  ["state_est", "locomotion_ctrl"],
  ["planner", "locomotion_ctrl"],
  ["locomotion_ctrl", "actuators"],
  ["fusion", "state_est"],
];

export function RosGraph() {
  const pos = Object.fromEntries(NODES.map((n) => [n.id, n])) as Record<
    string,
    { id: string; x: number; y: number }
  >;
  return (
    <div className="relative h-full min-h-0 grid-field bg-background">
      <svg className="absolute inset-0 h-full w-full">
        {EDGES.map(([a, b]) => {
          const pa = pos[a]!;
          const pb = pos[b]!;
          return (
            <line
              key={a + b}
              x1={`${pa.x + 6}%`}
              y1={`${pa.y}%`}
              x2={`${pb.x - 6}%`}
              y2={`${pb.y}%`}
              stroke="oklch(0.45 0.01 260)"
              strokeWidth="1"
            />
          );
        })}
      </svg>
      {NODES.map((n) => (
        <div
          key={n.id}
          className={cn(
            "absolute -translate-x-1/2 -translate-y-1/2 rounded-sm border bg-panel px-2.5 py-1.5",
            n.id === "locomotion_ctrl" ? "border-signal/60" : "border-hairline",
          )}
          style={{ left: `${n.x}%`, top: `${n.y}%` }}
        >
          <div className="flex items-center gap-1.5 font-mono text-[11px] text-foreground/85">
            <Dot tone={n.id === "locomotion_ctrl" ? "signal" : "ok"} live />/{n.id}
          </div>
          <div className="font-mono text-[9px] text-muted-foreground">
            {(n.x * 3).toFixed(0)} Hz · qos reliable
          </div>
        </div>
      ))}
    </div>
  );
}

const statusTone: Record<string, string> = {
  running: "text-signal",
  ok: "text-ok",
  escalated: "text-warn",
  queued: "text-muted-foreground",
  failed: "text-danger",
};

export function AiMonitor() {
  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="hairline-b flex items-center gap-2 bg-chrome px-3 py-1.5">
        <Chip active>Timeline</Chip>
        <Chip>Traces</Chip>
        <Chip>Escalations</Chip>
        <Chip>Cost</Chip>
        <span className="ml-auto font-mono text-[10px] text-muted-foreground">
          orchestrator · 4 agents · p95 412 ms
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {AGENT_EVENTS.map((e) => (
          <div
            key={e.id}
            className="group relative grid grid-cols-[92px_120px_1fr_78px_74px] items-center gap-3 border-b border-hairline/60 px-3 py-2 hover:bg-accent/30"
          >
            <span className="tabular font-mono text-[10px] text-muted-foreground/70">{e.t}</span>
            <span className="flex items-center gap-1.5 font-mono text-[11px] text-foreground/85">
              <Dot
                tone={e.status === "escalated" ? "warn" : e.status === "failed" ? "danger" : "signal"}
                live={e.status === "running"}
              />
              {e.agent}
            </span>
            <span className="truncate font-mono text-[11px] text-muted-foreground">
              <span className="text-foreground/80">{e.action}</span> — {e.detail}
            </span>
            <span className="tabular text-right font-mono text-[10px] text-muted-foreground">
              {e.latency}
            </span>
            <span
              className={cn(
                "text-right font-mono text-[10px] tracking-wider uppercase",
                statusTone[e.status],
              )}
            >
              {e.status}
            </span>
            <span className="absolute top-0 bottom-0 left-0 w-[2px] bg-signal opacity-0 group-hover:opacity-100" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function MemoryViewer() {
  const rows = [
    ["episodic", "loading_dock landmark", "0.94", "12:04:33"],
    ["semantic", "sector_b floorplan r14", "0.99", "12:03:58"],
    ["episodic", "slip event · wet concrete", "0.87", "12:01:12"],
    ["procedural", "stair_traversal policy v7", "1.00", "11:58:40"],
    ["semantic", "panel_rack thermal baseline", "0.91", "11:54:07"],
    ["episodic", "operator override · slope", "0.96", "11:49:22"],
  ];
  return (
    <div className="flex h-full min-h-0">
      <div className="min-w-0 flex-1 overflow-auto">
        <table className="w-full border-collapse">
          <thead className="sticky top-0 bg-chrome">
            <tr>
              {["Store", "Key", "Score", "Updated"].map((h) => (
                <th
                  key={h}
                  className="hairline-b px-3 py-1.5 text-left font-mono text-[10px] tracking-[0.16em] text-muted-foreground uppercase"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r[1]} className="border-b border-hairline/60 hover:bg-accent/30">
                {r.map((c, i) => (
                  <td
                    key={i}
                    className={cn(
                      "tabular px-3 py-2 font-mono text-[11px]",
                      i === 1 ? "text-foreground/85" : "text-muted-foreground",
                    )}
                  >
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="hairline-l w-64 shrink-0 bg-panel p-3 font-mono text-[11px] text-muted-foreground">
        <div className="tracking-[0.18em] uppercase">Embedding</div>
        <pre className="mt-2 leading-5 whitespace-pre-wrap text-foreground/70">
          {`dim   1536
norm  0.998
knn   dock_a  0.91
      ramp_b  0.84
      gate_c  0.77`}
        </pre>
      </div>
    </div>
  );
}
