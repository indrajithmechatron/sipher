import { useEffect, useRef, useState } from "react";
import { JOINTS, AGENT_EVENTS } from "./data";
import { Chip, Dot } from "./chrome";
import type { Telemetry } from "./sipher";
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

const MAP_API = typeof window !== "undefined" ? window.location.origin : "";

type MapRay = { x: number; y: number; d_mm: number; yaw: number; gx: number; gy: number };

type MapState = {
  mapping: boolean;
  rev: number;
  samples: number;
  hits: number;
  free_cells: number;
  dropped: number;
  cell_m: number;
  grid: { w: number; h: number; ox: number; oy: number };
  bounds: { x0: number; y0: number; x1: number; y1: number };
  pose: { x: number; y: number; yaw_deg: number; source: string };
  moving: boolean;
  last: { yaw_deg?: number; dist_mm?: number | null; ok?: boolean } | null;
  rays: MapRay[];
  data_b64?: string;
  ts?: number;
};

const CELL_UNKNOWN = 0;
const CELL_FREE = 1;
const CELL_OCC = 2;

function decodeGrid(b64: string): Uint8Array | null {
  try {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

function prep(canvas?: HTMLCanvasElement | null) {
  if (!canvas) return null;
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth;
  const cssH = canvas.clientHeight;
  if (!cssW || !cssH) return null;
  const pw = Math.round(cssW * dpr);
  const ph = Math.round(cssH * dpr);
  if (canvas.width !== pw) canvas.width = pw;
  if (canvas.height !== ph) canvas.height = ph;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = "#0b0d11";
  ctx.fillRect(0, 0, cssW, cssH);
  return { ctx, w: cssW, h: cssH };
}

const normPi = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** Robot-relative bearing of every mapper ray, in radians (0 = straight ahead).
 *  Endpoints are stored in world frame, so they are referenced to the robot's
 *  *current* heading — the sweep then reads as a live panorama. (`r.yaw` is the
 *  heading in degrees at capture time, not the reference.) */
function relativeRays(m: MapState) {
  const now = ((m.pose.yaw_deg ?? 0) * Math.PI) / 180;
  return (m.rays ?? []).map((r) => ({
    a: normPi(Math.atan2(r.y - r.gy, r.x - r.gx) - now),
    d: (r.d_mm ?? 0) / 1000,
    r,
  }));
}

/** Top-view robot glyph — deliberately not a play triangle. */
function drawGlyph(ctx: CanvasRenderingContext2D, x: number, y: number, yaw: number, s: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-yaw);
  ctx.fillStyle = "rgba(245,165,36,0.22)";
  ctx.strokeStyle = "#f5a524";
  ctx.lineWidth = 1.4;
  const bw = 20 * s;
  const bh = 14 * s;
  ctx.beginPath();
  ctx.rect(-bw / 2, -bh / 2, bw, bh);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#f5a524";
  for (const [lx, ly] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ] as [number, number][]) {
    ctx.fillRect(lx * (bw / 2 + 3 * s) - 2.5 * s, ly * (bh / 2 + 3 * s) - 2.5 * s, 5 * s, 5 * s);
  }
  ctx.strokeStyle = "rgba(245,165,36,0.95)";
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(bw / 2, 0);
  ctx.lineTo(bw / 2 + 14 * s, 0);
  ctx.stroke();
  ctx.restore();
}

function drawRangeRings(ctx: CanvasRenderingContext2D, cx: number, cy: number, px: number, dMax: number, label: boolean) {
  ctx.save();
  ctx.strokeStyle = "rgba(120,140,170,0.32)";
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 5]);
  for (let d = 1; d <= Math.floor(dMax); d++) {
    ctx.beginPath();
    ctx.arc(cx, cy, (d / dMax) * px, 0, Math.PI * 2);
    ctx.stroke();
    if (label) {
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(150,168,196,0.75)";
      ctx.font = "9px monospace";
      ctx.fillText(`${d}m`, cx + 4, cy - (d / dMax) * px - 3);
      ctx.setLineDash([3, 5]);
    }
  }
  ctx.restore();
}

/** Tile 1 - forward ToF depth curtain (synthesized from mapper rays). */
function drawFront(canvas: HTMLCanvasElement | null, m: MapState, liveTof: number | null) {
  const p = prep(canvas);
  if (!p) return;
  const { ctx, w, h } = p;
  const FOV = 0.44 * Math.PI;
  const dMax = 4;
  const yTop = 42;
  const yBot = h - 34;
  const cx = w / 2;
  const xOf = (a: number) => cx + (Math.tan(a) / Math.tan(FOV / 2)) * (w * 0.46);
  const yOf = (d: number) => yBot - (Math.min(d, dMax) / dMax) * (yBot - yTop);

  // horizon + range ladder
  ctx.strokeStyle = "rgba(120,140,170,0.4)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(8, yTop);
  ctx.lineTo(w - 8, yTop);
  ctx.stroke();
  for (let d = 1; d <= 3; d++) {
    const y = yOf(d);
    ctx.strokeStyle = "rgba(120,140,170,0.18)";
    ctx.setLineDash([4, 6]);
    ctx.beginPath();
    ctx.moveTo(8, y);
    ctx.lineTo(w - 8, y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "rgba(150,168,196,0.7)";
    ctx.font = "9px monospace";
    ctx.fillText(`${d} m`, 10, y - 3);
  }
  // windshield frame
  ctx.strokeStyle = "rgba(74,196,255,0.25)";
  ctx.lineWidth = 1;
  ctx.strokeRect(8, yTop - 14, w - 16, yBot - yTop + 24);

  const pts = relativeRays(m).filter((q) => Math.abs(q.a) < FOV / 2);
  pts.sort((a, b) => a.a - b.a);

  if (pts.length > 1) {
    ctx.beginPath();
    ctx.moveTo(xOf(pts[0].a), yOf(pts[0].d));
    for (const q of pts) ctx.lineTo(xOf(q.a), yOf(q.d));
    ctx.lineTo(xOf(pts[pts.length - 1].a), yBot);
    ctx.lineTo(xOf(pts[0].a), yBot);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, yTop, 0, yBot);
    grad.addColorStop(0, "rgba(74,196,255,0.05)");
    grad.addColorStop(1, "rgba(74,196,255,0.28)");
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.strokeStyle = "rgba(120,225,255,0.95)";
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(xOf(pts[0].a), yOf(pts[0].d));
    for (const q of pts) ctx.lineTo(xOf(q.a), yOf(q.d));
    ctx.stroke();
    ctx.fillStyle = "rgba(150,235,255,0.95)";
    for (const q of pts) {
      ctx.beginPath();
      ctx.arc(xOf(q.a), yOf(q.d), 1.7, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // live single-point ToF readout as a centre scan bar
  if (liveTof != null && liveTof > 0) {
    const d = liveTof / 1000;
    const y = yOf(d);
    ctx.strokeStyle = "rgba(245,165,36,0.95)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx - 34, y);
    ctx.lineTo(cx + 34, y);
    ctx.stroke();
    ctx.fillStyle = "rgba(245,165,36,0.95)";
    ctx.font = "10px monospace";
    ctx.textAlign = "center";
    ctx.fillText(`${liveTof} mm`, cx, y - 6);
    ctx.textAlign = "left";
  }

  ctx.fillStyle = "rgba(160,175,200,0.75)";
  ctx.font = "9px monospace";
  ctx.fillText(pts.length ? `${pts.length} rays` : "no sweep yet", 12, h - 12);
}

/** Tile 3 - bird's-eye: the occupancy grid through a tilted pinhole camera. */
function drawBird(canvas: HTMLCanvasElement | null, m: MapState, cells: Uint8Array | null) {
  const p = prep(canvas);
  if (!p) return;
  const { ctx, w, h } = p;
  const cam = m.pose;
  const yaw = (cam.yaw_deg * Math.PI) / 180;
  // metres, not millimetres: eye sits BACK behind the robot at HGT above the
  // floor, aimed just past it so the map falls into the lower half of the tile.
  const BACK = 3.0;
  const HGT = 8.5;
  const F = 470;
  const dx = Math.cos(yaw);
  const dy = Math.sin(yaw);
  const eye: [number, number, number] = [cam.x - dx * BACK, cam.y - dy * BACK, HGT];
  const aim: [number, number, number] = [cam.x + dx * 1.5, cam.y + dy * 1.5, 0];
  const fwd = unit3([aim[0] - eye[0], aim[1] - eye[1], aim[2] - eye[2]]);
  // camera +X must be the robot's true right (dy,-dx): the previous (-dy,dx)
  // mirrored the view and flipped the up vector with it.
  const right = unit3([fwd[1], -fwd[0], 0]);
  const up = [
    right[1] * fwd[2] - right[2] * fwd[1],
    right[2] * fwd[0] - right[0] * fwd[2],
    right[0] * fwd[1] - right[1] * fwd[0],
  ];
  const cx = w / 2;
  const cy = h * 0.26;
  const proj = (mx: number, my: number) => {
    const q = [mx - eye[0], my - eye[1], -eye[2]];
    const a = q[0] * fwd[0] + q[1] * fwd[1] + q[2] * fwd[2];
    if (a < 0.2) return null;
    return {
      x: cx + (F * (q[0] * right[0] + q[1] * right[1] + q[2] * right[2])) / a,
      y: cy - (F * (q[0] * up[0] + q[1] * up[1] + q[2] * up[2])) / a,
    };
  };

  // floor lattice
  ctx.strokeStyle = "rgba(90,110,140,0.28)";
  ctx.lineWidth = 1;
  for (let i = -6; i <= 6; i++) {
    const a = proj(i, -7);
    const b = proj(i, 9);
    if (a && b) {
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    const c = proj(-7, i);
    const d = proj(9, i);
    if (c && d) {
      ctx.beginPath();
      ctx.moveTo(c.x, c.y);
      ctx.lineTo(d.x, d.y);
      ctx.stroke();
    }
  }

  const gw = m.grid.w;
  const gh = m.grid.h;
  if (cells && cells.length === gw * gh) {
    const stride = Math.max(1, Math.ceil(Math.sqrt((gw * gh) / 2600)));
    const half = m.cell_m / 2;
    for (let r = 0; r < gh; r++) {
      for (let c = 0; c < gw; c++) {
        const v = cells[r * gw + c];
        const mx = m.bounds.x0 + c * m.cell_m;
        const my = m.bounds.y1 - r * m.cell_m;
        if (v === CELL_OCC) {
          const pts = [
            proj(mx - half, my + half),
            proj(mx + half, my + half),
            proj(mx + half, my - half),
            proj(mx - half, my - half),
          ];
          if (pts.some((q) => q === null)) continue;
          ctx.beginPath();
          ctx.moveTo(pts[0]!.x, pts[0]!.y);
          for (let i = 1; i < 4; i++) ctx.lineTo(pts[i]!.x, pts[i]!.y);
          ctx.closePath();
          ctx.fillStyle = "rgba(74,196,255,0.9)";
          ctx.fill();
        } else if (v === CELL_FREE && (c % stride === 0) && (r % stride === 0)) {
          const q = proj(mx, my);
          if (!q) continue;
          ctx.fillStyle = "rgba(52,74,116,0.75)";
          ctx.fillRect(q.x - 1, q.y - 1, 2, 2);
        }
      }
    }
  }

  const g = proj(cam.x, cam.y);
  const ahead = proj(cam.x + dx * 0.6, cam.y + dy * 0.6);
  if (g && ahead) {
    const screenYaw = -Math.atan2(ahead.y - g.y, ahead.x - g.x);
    drawGlyph(ctx, g.x, g.y, screenYaw, 0.75);
  }

  ctx.fillStyle = "rgba(160,175,200,0.75)";
  ctx.font = "9px monospace";
  ctx.fillText("tilted pinhole · 62° down", 10, h - 10);
}

function unit3(v: number[]): number[] {
  const n = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / n, v[1] / n, v[2] / n];
}

/** Tile 4 - extreme wide angle: 360 polar sweep with barrel distortion. */
function drawWide(canvas: HTMLCanvasElement | null, m: MapState) {
  const p = prep(canvas);
  if (!p) return;
  const { ctx, w, h } = p;
  const cx = w / 2;
  const cy = h / 2;
  const R = Math.min(w, h) * 0.42;
  const dMax = 4;
  const yaw = (m.pose.yaw_deg * Math.PI) / 180;
  const at = (a: number, rr: number) => [cx + Math.sin(a) * rr, cy - Math.cos(a) * rr];

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.clip();

  // spokes
  ctx.strokeStyle = "rgba(120,140,170,0.22)";
  ctx.lineWidth = 1;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const [x1, y1] = at(a, 0);
    const [x2, y2] = at(a, R);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }
  drawRangeRings(ctx, cx, cy, R, dMax, true);

  const rays = relativeRays(m);
  for (const q of rays) {
    // barrel falloff on radius + mild angular squash toward the rim
    const rr = R * Math.pow(Math.min(q.d / dMax, 1), 0.72);
    const aa = q.a - 0.1 * (q.a * q.a * q.a) / (Math.PI * Math.PI);
    const [x1, y1] = at(aa, R * 0.06);
    const [x2, y2] = at(aa, rr);
    ctx.strokeStyle = "rgba(74,196,255,0.34)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.fillStyle = "rgba(150,235,255,0.95)";
    ctx.beginPath();
    ctx.arc(x2, y2, 2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // lens barrel
  ctx.strokeStyle = "rgba(74,196,255,0.35)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.stroke();
  const vig = ctx.createRadialGradient(cx, cy, R * 0.55, cx, cy, R);
  vig.addColorStop(0, "rgba(0,0,0,0)");
  vig.addColorStop(1, "rgba(0,0,0,0.75)");
  ctx.fillStyle = vig;
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fill();

  drawGlyph(ctx, cx, cy, yaw, 0.5);

  ctx.fillStyle = "rgba(160,175,200,0.8)";
  ctx.font = "9px monospace";
  ctx.textAlign = "center";
  ctx.fillText("FWD", cx, cy - R + 12);
  ctx.fillText("REAR", cx, cy + R - 5);
  ctx.textAlign = "left";
  ctx.fillText(`${rays.length} rays`, 10, h - 10);
}

function drawOccupancy(canvas: HTMLCanvasElement | null, m: MapState, cells: Uint8Array | null) {
  const p = prep(canvas);
  if (!p) return;
  const { ctx, w, h } = p;

  const spanX = Math.max(m.bounds.x1 - m.bounds.x0, 0.1);
  const spanY = Math.max(m.bounds.y1 - m.bounds.y0, 0.1);
  const scale = Math.min(w / spanX, h / spanY) * 0.96;
  const cx = w / 2;
  const cy = h / 2;
  const sx = (x: number) => cx + x * scale;
  const sy = (y: number) => cy - y * scale;

  const gw = m.grid.w;
  const gh = m.grid.h;

  if (cells && cells.length === gw * gh) {
    const off = document.createElement("canvas");
    off.width = gw;
    off.height = gh;
    const octx = off.getContext("2d");
    if (octx) {
      const img = octx.createImageData(gw, gh);
      const d = img.data;
      for (let i = 0; i < cells.length; i++) {
        const v = cells[i];
        const o = i * 4;
        if (v === CELL_OCC) {
          d[o] = 74; d[o + 1] = 196; d[o + 2] = 255; d[o + 3] = 255;
        } else if (v === CELL_FREE) {
          d[o] = 34; d[o + 1] = 48; d[o + 2] = 74; d[o + 3] = 235;
        } else {
          d[o] = 13; d[o + 1] = 15; d[o + 2] = 20; d[o + 3] = 255;
        }
      }
      octx.putImageData(img, 0, 0);
      ctx.imageSmoothingEnabled = false;
      const left = sx(m.bounds.x0 - m.cell_m / 2);
      const top = sy(m.bounds.y1 + m.cell_m / 2);
      ctx.drawImage(off, left, top, gw * m.cell_m * scale, gh * m.cell_m * scale);
    }
  }

  // map frame + origin crosshair
  ctx.strokeStyle = "rgba(120,140,170,0.35)";
  ctx.lineWidth = 1;
  ctx.strokeRect(
    sx(m.bounds.x0 - m.cell_m / 2),
    sy(m.bounds.y1 + m.cell_m / 2),
    gw * m.cell_m * scale,
    gh * m.cell_m * scale,
  );
  ctx.strokeStyle = "rgba(140,160,190,0.45)";
  ctx.beginPath();
  ctx.moveTo(sx(-0.4), sy(0));
  ctx.lineTo(sx(0.4), sy(0));
  ctx.moveTo(sx(0), sy(-0.4));
  ctx.lineTo(sx(0), sy(0.4));
  ctx.stroke();

  // rays the mapper actually consumed
  ctx.lineWidth = 1;
  for (const r of m.rays) {
    ctx.strokeStyle = "rgba(74,196,255,0.35)";
    ctx.beginPath();
    ctx.moveTo(sx(r.gx), sy(r.gy));
    ctx.lineTo(sx(r.x), sy(r.y));
    ctx.stroke();
    ctx.fillStyle = "rgba(74,196,255,0.9)";
    ctx.beginPath();
    ctx.arc(sx(r.x), sy(r.y), 1.6, 0, Math.PI * 2);
    ctx.fill();
  }

  // robot glyph: yaw 0 = +X (east), counter-clockwise positive — matches firmware
  drawGlyph(ctx, sx(m.pose.x), sy(m.pose.y), (m.pose.yaw_deg * Math.PI) / 180, 1);

  // scale bar (1 m)
  const bar = scale;
  const bx = 16;
  const by = h - 18;
  ctx.strokeStyle = "rgba(200,215,235,0.85)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(bx, by - 4);
  ctx.lineTo(bx, by);
  ctx.lineTo(bx + bar, by);
  ctx.lineTo(bx + bar, by - 4);
  ctx.stroke();
  ctx.fillStyle = "rgba(200,215,235,0.85)";
  ctx.font = "10px monospace";
  ctx.fillText("1 m", bx + bar + 6, by);

  ctx.fillStyle = "rgba(160,175,200,0.8)";
  ctx.fillText("E", w - 14, sy(0) - 6);
  ctx.fillText("N", sx(0) + 6, 14);
}

function Tile({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="relative min-h-0 min-w-0 overflow-hidden bg-[#0b0d11]">
      {children}
      <div className="pointer-events-none absolute top-1.5 left-2 rounded-sm bg-background/75 px-1 font-mono text-[9px] tracking-[0.16em] text-muted-foreground/85 uppercase">
        {label}
      </div>
    </div>
  );
}

export function CameraMap({ tele }: { tele?: Telemetry }) {
  const [map, setMap] = useState<MapState | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const frontRef = useRef<HTMLCanvasElement>(null);
  const topRef = useRef<HTMLCanvasElement>(null);
  const birdRef = useRef<HTMLCanvasElement>(null);
  const wideRef = useRef<HTMLCanvasElement>(null);
  const cellsRef = useRef<Uint8Array | null>(null);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const r = await fetch(`${MAP_API}/api/map`);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j: MapState = await r.json();
        if (!alive) return;
        if (j.data_b64) cellsRef.current = decodeGrid(j.data_b64);
        setMap(j);
        setErr(null);
      } catch (e) {
        if (alive) setErr(e instanceof Error ? e.message : String(e));
      }
    };
    poll();
    const iv = setInterval(poll, 1000);
    return () => { alive = false; clearInterval(iv); };
  }, []);

  useEffect(() => {
    if (!map) return;
    const cells = cellsRef.current;
    const tof = tele?.raw?.vl53_mm ?? null;
    const drawAll = () => {
      drawFront(frontRef.current, map, tof);
      drawOccupancy(topRef.current, map, cells);
      drawBird(birdRef.current, map, cells);
      drawWide(wideRef.current, map);
    };
    drawAll();
    window.addEventListener("resize", drawAll);
    return () => window.removeEventListener("resize", drawAll);
  }, [map, tele]);

  const act = async (action: "start" | "stop" | "reset") => {
    setBusy(action);
    try {
      const r = await fetch(`${MAP_API}/api/map?action=${action}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      if (j.error) throw new Error(String(j.error));
      if (action === "reset") { cellsRef.current = null; setMap(null); }
      const fresh = await fetch(`${MAP_API}/api/map`);
      if (fresh.ok) {
        const s: MapState = await fresh.json();
        if (s.data_b64) cellsRef.current = decodeGrid(s.data_b64);
        setMap(s);
      }
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const rows: [string, string][] = map
    ? [
        ["state", map.mapping ? "SWEEPING" : "IDLE"],
        ["samples", String(map.samples)],
        ["occupied", String(map.hits)],
        ["free", String(map.free_cells)],
        ["dropped", String(map.dropped)],
        ["revision", String(map.rev)],
        ["cell", `${map.cell_m.toFixed(3)} m`],
        ["grid", `${map.grid.w} x ${map.grid.h}`],
        ["pose x/y", `${map.pose.x.toFixed(2)} / ${map.pose.y.toFixed(2)} m`],
        ["heading", `${map.pose.yaw_deg.toFixed(1)} deg`],
        ["pose source", map.pose.source],
        ["frame", map.moving ? "moving (untracked)" : "stationary"],
        ["tof", map.last?.dist_mm != null ? `${map.last.dist_mm} mm` : "—"],
        ["yaw", map.last?.yaw_deg != null ? `${map.last.yaw_deg.toFixed(1)} deg` : "—"],
      ]
    : [["state", "no data"]];

  return (
    <div className="grid h-full min-h-0 grid-cols-[1fr_240px] gap-px bg-hairline">
      <div className="relative min-w-0 bg-background">
        <div className="grid h-full grid-cols-2 grid-rows-2 gap-px bg-hairline">
          <Tile label="front · tof curtain">
            <canvas ref={frontRef} className="absolute inset-0 h-full w-full" />
          </Tile>
          <Tile label="top · occupancy grid">
            <canvas ref={topRef} className="absolute inset-0 h-full w-full" />
          </Tile>
          <Tile label={"bird's eye · tilted"}>
            <canvas ref={birdRef} className="absolute inset-0 h-full w-full" />
          </Tile>
          <Tile label="wide · 360 barrel">
            <canvas ref={wideRef} className="absolute inset-0 h-full w-full" />
          </Tile>
        </div>
        {tele && (
          <div className="pointer-events-none absolute top-2 right-3 space-y-1 text-right font-mono text-[10px] text-muted-foreground">
            <div>tof {tele.raw?.vl53_mm != null ? `${tele.raw.vl53_mm} mm` : "—"}</div>
            <div>yaw {tele.yaw.toFixed(1)}°</div>
            <div>loop {tele.loopHz != null ? `${tele.loopHz} Hz` : "—"}</div>
          </div>
        )}
        {err && (
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-sm border border-danger/50 bg-background/95 px-4 py-3 text-center font-mono text-[11px] text-danger">
            map endpoint unreachable
            <div className="mt-1 text-[10px] text-muted-foreground">{err}</div>
          </div>
        )}
        {!err && (!map || map.samples === 0) && (
          <div className="pointer-events-none absolute bottom-16 left-1/2 -translate-x-1/2 rounded-sm border border-hairline bg-background/90 px-3 py-2 text-center font-mono text-[11px] text-muted-foreground">
            start a sweep, then rotate the robot in place
          </div>
        )}
        <div className="pointer-events-none absolute bottom-2 right-3 flex items-center gap-3 rounded-sm bg-background/70 px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground">
          <span className="flex items-center gap-1"><span className="inline-block size-2 bg-[rgb(74,196,255)]" /> occupied</span>
          <span className="flex items-center gap-1"><span className="inline-block size-2 bg-[rgb(34,48,74)]" /> free</span>
          <span className="flex items-center gap-1"><span className="inline-block size-2 bg-[rgb(13,15,20)] ring-1 ring-hairline" /> unknown</span>
        </div>
      </div>

      <aside className="flex min-h-0 flex-col bg-panel">
        <div className="hairline-b px-3 py-2 font-mono text-[10px] tracking-[0.18em] text-muted-foreground uppercase">
          ToF occupancy
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {rows.map(([k, v]) => (
            <div key={k} className="flex items-baseline justify-between border-b border-hairline/60 px-3 py-1.5 font-mono text-[11px]">
              <span className="text-muted-foreground">{k}</span>
              <span className="tabular text-foreground/85">{v}</span>
            </div>
          ))}
          <div className="px-3 py-2 font-mono text-[10px] leading-relaxed text-muted-foreground">
            heading = integrated MPU6050 gyro-z.
            {" "}position = GPS when fixed, otherwise held at origin — without a
            fix the map is only correct while rotating in place.
          </div>
        </div>
        <div className="hairline-t space-y-1.5 p-3">
          <button
            onClick={() => void act("start")}
            disabled={busy !== null || Boolean(map?.mapping)}
            className="w-full rounded-sm bg-signal/15 px-2 py-1.5 font-mono text-[11px] text-signal hover:bg-signal/25 disabled:opacity-40"
          >
            {busy === "start" ? "starting…" : "Start sweep"}
          </button>
          <div className="flex gap-1.5">
            <button
              onClick={() => void act("stop")}
              disabled={busy !== null || !map?.mapping}
              className="flex-1 rounded-sm border border-hairline px-2 py-1.5 font-mono text-[11px] text-foreground/80 hover:border-warn/50 hover:text-warn disabled:opacity-40"
            >
              {busy === "stop" ? "stopping…" : "Stop"}
            </button>
            <button
              onClick={() => void act("reset")}
              disabled={busy !== null}
              className="flex-1 rounded-sm border border-hairline px-2 py-1.5 font-mono text-[11px] text-foreground/80 hover:border-danger/50 hover:text-danger disabled:opacity-40"
            >
              {busy === "reset" ? "clearing…" : "Clear"}
            </button>
          </div>
        </div>
      </aside>
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
