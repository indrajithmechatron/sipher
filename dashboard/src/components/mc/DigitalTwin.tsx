import { useCallback, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { Chip } from "./chrome";
import type { Telemetry } from "./sipher";
import { VIEWBOX, VIEWS, buildScene, legsFromJoints, renderScene } from "./sipher3d";
import type { Shading, View } from "./sipher3d";

const VIEW_NAMES = ["Perspective", "Front", "Top"];

function RobotFigure({
  shading,
  pitch,
  roll,
  joints,
  sel,
  orbit,
  onDown,
  onMove,
  onUp,
}: {
  shading: Shading;
  pitch: number;
  roll: number;
  joints: string;
  sel: number;
  orbit: View;
  onDown: (e: React.PointerEvent<SVGSVGElement>) => void;
  onMove: (e: React.PointerEvent<SVGSVGElement>) => void;
  onUp: (e: React.PointerEvent<SVGSVGElement>) => void;
}) {
  const { ground, body } = useMemo(() => {
    const values = joints.length
      ? joints.split(",").map((v) => (v === "-" ? null : Number(v)))
      : [];
    return renderScene(buildScene(legsFromJoints(values), pitch, roll), orbit, shading, sel);
  }, [joints, pitch, roll, orbit, shading, sel]);

  return (
    <svg
      viewBox={`0 0 ${VIEWBOX.w} ${VIEWBOX.h}`}
      className="h-full w-full max-w-3xl select-none touch-none cursor-grab active:cursor-grabbing"
      role="img"
      aria-label="Sipher digital twin"
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
    >
      {ground.map((g) =>
        g.k === "seg" ? (
          <polyline key={g.key} points={g.d} fill="none" stroke={g.stroke} strokeWidth={g.sw} />
        ) : null,
      )}
      {body.map((it) =>
        it.k === "poly" ? (
          <polygon
            key={it.key}
            points={it.d}
            fill={it.fill}
            stroke={it.stroke}
            strokeWidth={it.sw}
            strokeLinejoin="round"
          />
        ) : it.k === "ball" ? (
          <circle
            key={it.key}
            cx={it.cx}
            cy={it.cy}
            r={it.r}
            fill={it.fill}
            stroke={it.stroke}
            strokeWidth={it.sw}
          />
        ) : (
          <polyline key={it.key} points={it.d} fill="none" stroke={it.stroke} strokeWidth={it.sw} strokeLinecap="round" />
        ),
      )}
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

function Sparkline({ data }: { data: (number | null)[] }) {
  const finite = data.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (finite.length < 2) {
    return (
      <svg viewBox="0 0 100 28" preserveAspectRatio="none" className="h-6 w-full">
        <text x="50" y="17" textAnchor="middle" fontSize="7" fill="currentColor" opacity="0.5">
          no samples yet
        </text>
      </svg>
    );
  }
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  const span = max - min || 1;
  const pts = finite
    .map((v, i) => `${(i / (finite.length - 1)) * 100},${28 - ((v - min) / span) * 26}`)
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
  const [orbit, setOrbit] = useState<View>(VIEWS.Perspective);

  const drag = useRef<{ x: number; y: number; az: number; el: number } | null>(null);
  const queued = useRef<{ x: number; y: number } | null>(null);
  const raf = useRef(0);

  const flush = useCallback(() => {
    raf.current = 0;
    const d = drag.current;
    const m = queued.current;
    if (!d || !m) return;
    queued.current = null;
    setOrbit({
      az: d.az + (m.x - d.x) * 0.5,
      el: Math.max(2, Math.min(88, d.el - (m.y - d.y) * 0.4)),
    });
  }, []);

  const onDown = (e: React.PointerEvent<SVGSVGElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, az: orbit.az, el: orbit.el };
  };
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!drag.current) return;
    queued.current = { x: e.clientX, y: e.clientY };
    setView("Orbit");
    if (!raf.current) raf.current = requestAnimationFrame(flush);
  };
  const onUp = () => {
    drag.current = null;
    queued.current = null;
    if (raf.current) {
      cancelAnimationFrame(raf.current);
      raf.current = 0;
    }
  };

  const pickView = (v: string) => {
    setView(v);
    setOrbit(VIEWS[v] ?? VIEWS.Perspective);
  };

  const jointKey = tele.joints.map((j) => (j.value == null ? "-" : j.value.toFixed(1))).join(",");

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
          <div>/joint_states {tele.loopHz != null ? `${tele.loopHz} Hz` : "—"}</div>
        </div>
        <div className="flex h-full items-center justify-center p-8">
          <RobotFigure
            shading={shading}
            pitch={tele.pitch}
            roll={tele.roll}
            joints={jointKey}
            sel={sel}
            orbit={orbit}
            onDown={onDown}
            onMove={onMove}
            onUp={onUp}
          />
        </div>
        <div className="pointer-events-none absolute inset-x-0 bottom-14 text-center font-mono text-[9px] tracking-[0.16em] text-muted-foreground/60 uppercase">
          drag to orbit
        </div>
        <AttitudeGauge pitch={tele.pitch} roll={tele.roll} yaw={tele.yaw} />
        <div className="absolute bottom-3 left-3 flex flex-wrap gap-1.5">
          {VIEW_NAMES.map((v) => (
            <Chip key={v} active={view === v} onClick={() => pickView(v)}>
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
                  {j.value != null ? `${j.value.toFixed(1)}°` : "—"}
                </span>
              </div>
              <div className="mt-1 h-[3px] w-full overflow-hidden rounded-full bg-rail">
                <div
                  className={cn("h-full transition-all", (j.load ?? 0) > 75 ? "bg-warn" : "bg-signal/70")}
                  style={{ width: `${j.load ?? 0}%` }}
                />
              </div>
            </button>
          ))}
        </div>
        <div className="hairline-t bg-chrome px-3 py-2">
          <div className="flex items-baseline justify-between font-mono text-[10px] text-muted-foreground">
            <span>{tele.joints[sel]?.name} · {tele.history[sel]?.length ?? 0} samples</span>
            <span className="tabular">
              load {tele.joints[sel]?.load != null ? `${tele.joints[sel]!.load.toFixed(0)}%` : "—"}
              {tele.joints[sel]?.pulse_us != null ? ` · ${tele.joints[sel]!.pulse_us} us` : ""}
            </span>
          </div>
          <Sparkline data={tele.history[sel] ?? []} />
        </div>
      </div>
    </div>
  );
}
