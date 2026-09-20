import { useState } from "react";
import { cn } from "@/lib/utils";
import { Chip } from "./chrome";
import type { Telemetry } from "./sim";

type Shading = "solid" | "wireframe" | "xray";

function RobotFigure({ shading, pitch, roll }: { shading: Shading; pitch: number; roll: number }) {
  const wire = shading !== "solid";
  const bodyFill = shading === "solid" ? "url(#body)" : shading === "xray" ? "oklch(0.82 0.115 200 / 8%)" : "none";
  const stroke = wire ? "oklch(0.82 0.115 200 / 70%)" : "oklch(0.5 0.01 260)";
  return (
    <svg
      viewBox="0 0 420 240"
      className="h-full w-full max-w-2xl transition-transform duration-200"
      style={{ transform: `rotate(${(-pitch / 4).toFixed(2)}deg) skewY(${(roll / 3).toFixed(2)}deg)` }}
    >
      <defs>
        <linearGradient id="body" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="oklch(0.42 0.006 260)" />
          <stop offset="100%" stopColor="oklch(0.26 0.005 260)" />
        </linearGradient>
      </defs>
      <ellipse cx="210" cy="205" rx="120" ry="10" fill="oklch(0 0 0 / 40%)" />
      <g stroke={wire ? "oklch(0.82 0.115 200 / 60%)" : "oklch(0.55 0.02 220)"} strokeWidth={wire ? 1.4 : 4} fill="none" strokeLinecap="round">
        <path d="M120 130 L104 168 L118 196" />
        <path d="M150 132 L138 170 L152 197" />
        <path d="M272 132 L288 170 L272 197" />
        <path d="M300 130 L316 168 L302 196" />
      </g>
      <rect x="118" y="96" width="184" height="40" rx="12" fill={bodyFill} stroke={stroke} strokeWidth={wire ? 1.2 : 1} />
      <rect x="296" y="86" width="44" height="34" rx="8" fill={bodyFill} stroke={stroke} strokeWidth={wire ? 1.2 : 1} />
      {wire && (
        <g stroke="oklch(0.82 0.115 200 / 25%)" strokeWidth="0.8">
          {[130, 160, 190, 220, 250, 280].map((x) => (
            <line key={x} x1={x} y1="96" x2={x} y2="136" />
          ))}
          <line x1="118" y1="116" x2="302" y2="116" />
        </g>
      )}
      <circle cx="332" cy="100" r="5" fill="oklch(0.82 0.115 200)" />
      <circle cx="332" cy="100" r="10" fill="none" stroke="oklch(0.82 0.115 200 / 30%)" />
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

function AttitudeGauge({ pitch, roll, yaw }: { pitch: number; roll: number; yaw: number }) {
  return (
    <div className="absolute right-3 bottom-3 size-28 rounded-full border border-hairline bg-panel/70 backdrop-blur-sm">
      <svg viewBox="0 0 100 100" className="size-full">
        <circle cx="50" cy="50" r="44" fill="none" stroke="oklch(0.35 0.005 260)" />
        <circle cx="50" cy="50" r="30" fill="none" stroke="oklch(0.3 0.005 260)" strokeDasharray="2 4" />
        <g transform={`rotate(${roll * 3} 50 50) translate(0 ${pitch - 18})`}>
          <line x1="14" y1="50" x2="86" y2="50" stroke="oklch(0.82 0.115 200)" strokeWidth="1.4" />
          <line x1="34" y1="58" x2="66" y2="58" stroke="oklch(0.82 0.115 200 / 40%)" strokeWidth="1" />
        </g>
        <g transform={`rotate(${yaw} 50 50)`}>
          <path d="M50 12 L54 22 L46 22 Z" fill="oklch(0.78 0.13 155)" />
        </g>
        <circle cx="50" cy="50" r="2" fill="oklch(0.9 0 0)" />
      </svg>
      <div className="absolute inset-x-0 -bottom-4 text-center font-mono text-[9px] text-muted-foreground">
        IMU attitude
      </div>
    </div>
  );
}

function Sparkline({ data }: { data: number[] }) {
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const pts = data
    .map((v, i) => `${(i / (data.length - 1)) * 100},${28 - ((v - min) / span) * 26}`)
    .join(" ");
  return (
    <svg viewBox="0 0 100 28" preserveAspectRatio="none" className="h-6 w-full">
      <polyline points={pts} fill="none" stroke="oklch(0.82 0.115 200 / 70%)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function DigitalTwin({ tele }: { tele: Telemetry }) {
  const [shading, setShading] = useState<Shading>("solid");
  const [view, setView] = useState("Perspective");
  const [sel, setSel] = useState(0);

  return (
    <div className="flex h-full min-h-0">
      <div className="relative min-w-0 flex-1 grid-field bg-background">
        <div className="pointer-events-none absolute top-3 left-3 font-mono text-[10px] tracking-[0.2em] text-muted-foreground uppercase">
          Digital Twin · {view.toLowerCase()} · {shading}
        </div>
        <div className="pointer-events-none absolute top-3 right-3 space-y-1 text-right font-mono text-[10px] text-muted-foreground">
          <div>v {tele.velocity.toFixed(2)} m/s</div>
          <div className={tele.pitch > 18 ? "text-warn" : ""}>pitch {tele.pitch.toFixed(1)}°</div>
          <div>roll {tele.roll.toFixed(1)}° · yaw {tele.yaw.toFixed(0)}°</div>
          <div>contacts {tele.contacts}/4</div>
          <div>/joint_states {tele.loopHz} Hz</div>
        </div>
        <div className="flex h-full items-center justify-center p-10">
          <RobotFigure shading={shading} pitch={tele.pitch} roll={tele.roll} />
        </div>
        <AttitudeGauge pitch={tele.pitch} roll={tele.roll} yaw={tele.yaw} />
        <div className="absolute bottom-3 left-3 flex flex-wrap gap-1.5">
          {["Perspective", "Front", "Top"].map((v) => (
            <Chip key={v} active={view === v} onClick={() => setView(v)}>
              {v}
            </Chip>
          ))}
          <span className="mx-1 w-px bg-hairline" />
          {(["solid", "wireframe", "xray"] as Shading[]).map((s) => (
            <Chip key={s} active={shading === s} onClick={() => setShading(s)}>
              {s}
            </Chip>
          ))}
        </div>
      </div>

      <div className="hairline-l flex w-72 shrink-0 flex-col bg-panel">
        <div className="hairline-b px-3 py-2 font-mono text-[10px] tracking-[0.18em] text-muted-foreground uppercase">
          Joint states · /joint_states
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {tele.joints.map((j, i) => (
            <button
              key={j.name}
              onClick={() => setSel(i)}
              className={cn(
                "block w-full border-b border-hairline/60 px-3 py-1.5 text-left hover:bg-accent/30",
                sel === i && "bg-signal/5",
              )}
            >
              <div className="flex items-baseline justify-between">
                <span className="font-mono text-[11px] text-foreground/85">{j.name}</span>
                <span className="tabular font-mono text-[11px] text-muted-foreground">
                  {j.value.toFixed(1)}°
                </span>
              </div>
              <div className="mt-1 h-[3px] w-full overflow-hidden rounded-full bg-rail">
                <div
                  className={cn("h-full transition-all", j.load > 75 ? "bg-warn" : "bg-signal/70")}
                  style={{ width: `${j.load}%` }}
                />
              </div>
            </button>
          ))}
        </div>
        <div className="hairline-t bg-chrome px-3 py-2">
          <div className="flex items-baseline justify-between font-mono text-[10px] text-muted-foreground">
            <span>{tele.joints[sel]?.name} · 60 samples</span>
            <span className="tabular">load {tele.joints[sel]?.load.toFixed(0)}%</span>
          </div>
          <Sparkline data={tele.history[sel] ?? []} />
        </div>
      </div>
    </div>
  );
}
