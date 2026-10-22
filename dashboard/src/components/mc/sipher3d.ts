// Hand-rolled SVG 3D renderer for the Sipher quadruped.
// No dependencies: small vector maths + painter's-algorithm projection.
// Units are millimetres. Frame: +X = robot front, +Y = robot left, +Z = up.

export type V3 = [number, number, number];
export type RGB = [number, number, number];

export type Poly = { id: number; p: V3[]; col: RGB; alpha?: number; tag?: number; layer?: number };
export type Seg = { id: number; pts: V3[]; col: RGB; alpha?: number; w?: number; tag?: number; layer?: number };
export type Ball = { id: number; c: V3; r: number; col: RGB; alpha?: number; tag?: number; layer?: number };

export type Scene = {
  polys: Poly[];
  segs: Seg[];
  balls: Ball[];
  ground: Seg[];
  groundZ: number;
  radius: number;
};

export type View = { az: number; el: number };
export type Shading = "solid" | "wireframe" | "xray";

/* ------------------------------------------------------------------ vectors */

const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const mag = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const unit = (a: V3): V3 => {
  const l = mag(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const crossZ = (v: V3, ang: number): V3 => {
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  return [v[0] * c - v[1] * s, v[0] * s + v[1] * c, v[2]];
};
const rx = (v: V3, ang: number): V3 => {
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  return [v[0], v[1] * c - v[2] * s, v[1] * s + v[2] * c];
};
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

const D2R = Math.PI / 180;

/* ------------------------------------------------------------------ palette */

const C = {
  plateTop: [46, 49, 57] as RGB,
  plateBot: [34, 37, 44] as RGB,
  metal: [118, 124, 136] as RGB,
  servo: [58, 60, 67] as RGB,
  hipservo: [14, 15, 19] as RGB,
  label: [178, 44, 40] as RGB,
  frame: [198, 186, 162] as RGB,
  frameDark: [176, 163, 138] as RGB,
  screen: [18, 20, 27] as RGB,
  pcb: [148, 45, 40] as RGB,
  blue: [46, 96, 176] as RGB,
  acrylic: [146, 206, 230] as RGB,
  slot: [14, 15, 20] as RGB,
  grille: [188, 191, 197] as RGB,
  slat: [40, 42, 49] as RGB,
  module: [64, 68, 76] as RGB,
  moduleTop: [98, 104, 116] as RGB,
  fan: [48, 50, 58] as RGB,
  fanBlade: [92, 96, 106] as RGB,
  hub: [96, 102, 114] as RGB,
  antenna: [34, 35, 42] as RGB,
  mic: [46, 48, 55] as RGB,
  sensor: [54, 57, 66] as RGB,
  lens: [70, 140, 170] as RGB,
  cable: [214, 110, 52] as RGB,
  accent: [90, 214, 196] as RGB,
  ground: [64, 82, 108] as RGB,
};

/* -------------------------------------------------------------- primitives */

let nextId = 1;

function boxAt(c: V3, d: V3, col: RGB, tag?: number, alpha?: number): Poly[] {
  const [cx, cy, cz] = c;
  const hx = d[0] / 2;
  const hy = d[1] / 2;
  const hz = d[2] / 2;
  const v: V3[] = [
    [cx - hx, cy - hy, cz - hz],
    [cx + hx, cy - hy, cz - hz],
    [cx + hx, cy + hy, cz - hz],
    [cx - hx, cy + hy, cz - hz],
    [cx - hx, cy - hy, cz + hz],
    [cx + hx, cy - hy, cz + hz],
    [cx + hx, cy + hy, cz + hz],
    [cx - hx, cy + hy, cz + hz],
  ];
  const idx = [
    [0, 3, 2, 1],
    [4, 5, 6, 7],
    [0, 1, 5, 4],
    [1, 2, 6, 5],
    [2, 3, 7, 6],
    [3, 0, 4, 7],
  ];
  return idx.map((i) => ({ id: nextId++, p: i.map((k) => v[k]), col, tag, alpha }));
}

function boxFrame(o: V3, ax: V3, ay: V3, az: V3, h: V3, col: RGB, tag?: number): Poly[] {
  const c = (sx: number, sy: number, sz: number): V3 =>
    add(add(add(o, mul(ax, sx * h[0])), mul(ay, sy * h[1])), mul(az, sz * h[2]));
  const v: V3[] = [
    c(-1, -1, -1),
    c(1, -1, -1),
    c(1, 1, -1),
    c(-1, 1, -1),
    c(-1, -1, 1),
    c(1, -1, 1),
    c(1, 1, 1),
    c(-1, 1, 1),
  ];
  const idx = [
    [0, 3, 2, 1],
    [4, 5, 6, 7],
    [0, 1, 5, 4],
    [1, 2, 6, 5],
    [2, 3, 7, 6],
    [3, 0, 4, 7],
  ];
  return idx.map((i) => ({ id: nextId++, p: i.map((k) => v[k]), col, tag }));
}

/** Rectangular bar between two points - used for coxa / femur / tibia / stalks. */
function bar(p0: V3, p1: V3, w: number, h: number, col: RGB, tag?: number): Poly[] {
  const d = unit(sub(p1, p0));
  const ref: V3 = Math.abs(d[2]) > 0.9 ? [1, 0, 0] : [0, 0, 1];
  const a = unit(cross(ref, d));
  const b = unit(cross(d, a));
  const ctr = mul(add(p0, p1), 0.5);
  return boxFrame(ctr, d, a, b, [mag(sub(p1, p0)) / 2, w / 2, h / 2], col, tag);
}

/** Emit a flat quad with its winding forced so the face normal points along
 *  `want` - removes the need to reason about vertex order by hand. */
function facing(out: Poly[], p: V3[], want: V3, col: RGB, tag?: number, layer?: number): void {
  const n = unit(cross(sub(p[1], p[0]), sub(p[2], p[0])));
  const q = dot(n, want) < 0 ? p.slice().reverse() : p;
  out.push({ id: nextId++, p: q, col, tag, layer });
}

/** Flat laser-cut style link: two side rails + end caps (+ optional cross rails
 *  and a diagonal brace) so the plate reads as a bracket with real cut-outs
 *  instead of a solid stick. `thick` is measured across the plate normal, `hgt`
 *  across the link's own plane. */
function linkPlate(
  p0: V3,
  p1: V3,
  thick: number,
  hgt: number,
  col: RGB,
  tag?: number,
  o: { rail?: number; mids?: number[]; diag?: [number, number]; n?: V3 } = {},
): Poly[] {
  const seg2 = sub(p1, p0);
  const d = unit(seg2);
  const n: V3 = o.n ?? (Math.abs(d[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0]);
  const hd = unit(cross(d, n));
  const rail = o.rail ?? hgt * 0.18;
  const hh = hgt / 2;
  const gi = hh - rail; // inner half-height (the open window)
  const out: Poly[] = [];

  const at = (c: V3, len: number, h: number) => out.push(...bar(sub(c, mul(d, len / 2)), add(c, mul(d, len / 2)), thick, h, col, tag));

  const mid = mul(add(p0, p1), 0.5);
  at(add(mid, mul(hd, hh - rail / 2)), mag(seg2), rail);
  at(add(mid, mul(hd, -(hh - rail / 2))), mag(seg2), rail);
  at(p0, Math.min(rail * 2, 14), hgt);
  at(p1, Math.min(rail * 2, 14), hgt);
  for (const t of o.mids ?? []) at(add(p0, mul(seg2, t)), Math.min(rail * 2, 14), gi * 2);
  if (o.diag) {
    const a = add(add(p0, mul(seg2, o.diag[0])), mul(hd, -gi));
    const b = add(add(p0, mul(seg2, o.diag[1])), mul(hd, gi));
    out.push(...bar(a, b, thick, rail * 1.15, col, tag));
  }
  return out;
}

function tube(p0: V3, p1: V3, r: number, seg: number, col: RGB, tag?: number): Poly[] {
  const d = unit(sub(p1, p0));
  const ref: V3 = Math.abs(d[2]) > 0.9 ? [1, 0, 0] : [0, 0, 1];
  const a = unit(cross(ref, d));
  const b = unit(cross(d, a));
  const ring = (p: V3) =>
    Array.from({ length: seg }, (_, i) => {
      const t = (i / seg) * Math.PI * 2;
      return add(add(p, mul(a, Math.cos(t) * r)), mul(b, Math.sin(t) * r));
    });
  const A = ring(p0);
  const B = ring(p1);
  const out: Poly[] = [];
  for (let i = 0; i < seg; i++) {
    const j = (i + 1) % seg;
    out.push({ id: nextId++, p: [A[i], A[j], B[j], B[i]], col, tag });
  }
  out.push({ id: nextId++, p: A.slice().reverse(), col, tag });
  out.push({ id: nextId++, p: B, col, tag });
  return out;
}

/** Scalloped plate outline - the real robot's top plate has a lobed edge
 *  rather than a clean octagon. Superellipse base + a radial ripple. */
function scallop(hx: number, hy: number, lobes: number, amp: number): [number, number][] {
  const N = 24;
  const p = 5;
  const out: [number, number][] = [];
  for (let i = 0; i < N; i++) {
    const t = (i / N) * Math.PI * 2;
    const c = Math.cos(t);
    const s = Math.sin(t);
    const k = Math.pow(Math.pow(Math.abs(c), p) + Math.pow(Math.abs(s), p), -1 / p);
    const b = 1 + amp * Math.sin(lobes * t);
    out.push([hx * c * k * b, hy * s * k * b]);
  }
  return out;
}

/** Octagonal (chamfered rectangle) profile, counter-clockwise in XY. */
function octagon(hx: number, hy: number, ch: number): [number, number][] {
  return [
    [hx - ch, -hy],
    [hx, -hy + ch],
    [hx, hy - ch],
    [hx - ch, hy],
    [-hx + ch, hy],
    [-hx, hy - ch],
    [-hx, -hy + ch],
    [-hx + ch, -hy],
  ];
}

/** Densify a polygon by subdividing each edge - used so the painter's sort
 *  has enough depth locality where objects rest on a surface. */
function refine(prof: [number, number][], sub: number): [number, number][] {
  if (sub <= 1) return prof;
  const out: [number, number][] = [];
  for (let i = 0; i < prof.length; i++) {
    const a = prof[i];
    const b = prof[(i + 1) % prof.length];
    for (let k = 0; k < sub; k++) {
      const t = k / sub;
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return out;
}

/** Extrude a polygon; caps are fan-triangulated from a densified ring so the
 *  painter's sort resolves objects resting on the surface correctly. */
function prism(prof: [number, number][], z0: number, z1: number, col: RGB, tag?: number, sub = 4): Poly[] {
  const out: Poly[] = [];
  const cap = refine(prof, sub);
  const n = cap.length;
  const ctrX = cap.reduce((s, p) => s + p[0], 0) / n;
  const ctrY = cap.reduce((s, p) => s + p[1], 0) / n;
  const top: V3[] = cap.map(([x, y]) => [x, y, z1]);
  const bot: V3[] = cap.map(([x, y]) => [x, y, z0]);
  const cTop: V3 = [ctrX, ctrY, z1];
  const cBot: V3 = [ctrX, ctrY, z0];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    out.push({ id: nextId++, p: [cTop, top[i], top[j]], col, tag });
    out.push({ id: nextId++, p: [cBot, bot[j], bot[i]], col, tag });
  }
  // walls stay on the coarse outline - they are only 6 mm tall
  const m = prof.length;
  const b0: V3[] = prof.map(([x, y]) => [x, y, z0]);
  const t0: V3[] = prof.map(([x, y]) => [x, y, z1]);
  for (let i = 0; i < m; i++) {
    const j = (i + 1) % m;
    out.push({ id: nextId++, p: [b0[i], b0[j], t0[j], t0[i]], col, tag });
  }
  return out;
}

function seg(pts: V3[], col: RGB, w?: number, tag?: number, alpha?: number, layer?: number): Seg {
  return { id: nextId++, pts, col, w, tag, alpha, layer };
}

/* ------------------------------------------------------------ leg kinematics */

export type LegAngles = { hip: number; thigh: number; calf: number };

export const NEUTRAL: LegAngles = { hip: 0, thigh: 60, calf: -60 };

const LEG_AX = 80; // |x| of the hip anchor (on belly platform corners)
const LEG_AY = 70; // |y| of the hip anchor (on belly platform corners)
const LEG_AZ = -20; // hip height: servo sits on belly platform top (-41)
const COXA = 30;
const FEMUR = 110;
const TIBIA = 132;

const LEG_CORNERS: [number, number][] = [
  [1, 1], // FL
  [1, -1], // FR
  [-1, 1], // RL
  [-1, -1], // RR
];

/** Horizontal splay direction of a leg: mostly outboard with a small fore/aft
 *  bias so the four legs read as an X (as on the real robot) instead of two
 *  parallel pairs. `hip` swings the leg toward the robot's front (+X). */
function legYaw(a: LegAngles, sx: number, sy: number): number {
  return Math.atan2(sy, sx * 0.45) - sx * a.hip * D2R;
}

/** Spider kinematics: the coxa swings in the horizontal plane about a vertical
 *  pin at the deck corner, so femur + tibia stay inside one vertical leg
 *  plane. That is what lets the tibia hang straight down while the leg is
 *  splayed wide - a roll-axis hip (the old `rx` form) caps the tibia's
 *  downward component at cos(hip) and always reads as a standing dog. */
function legPoints(a: LegAngles, sx: number, sy: number) {
  const A: V3 = [sx * LEG_AX, sy * LEG_AY, LEG_AZ];
  const th = legYaw(a, sx, sy);
  const B = add(A, crossZ([COXA, 0, 0], th));
  const t = a.thigh * D2R;
  const c = (a.thigh + a.calf) * D2R;
  const K = add(B, crossZ([Math.sin(t) * FEMUR, 0, -Math.cos(t) * FEMUR], th));
  const F = add(K, crossZ([Math.sin(c) * TIBIA, 0, -Math.cos(c) * TIBIA], th));
  return { A, B, K, F, th };
}

/** PCA9685 readback is servo degrees (500us=0, 1500us=90, 2500us=180);
 *  90 deg is mechanical centre, so kinematic angle = value - 90. */
export function legsFromJoints(values: (number | null)[]): LegAngles[] {
  const out: LegAngles[] = [];
  for (let i = 0; i < 4; i++) {
    const pick = (k: number) => {
      const v = values[i * 3 + k];
      return v == null || !Number.isFinite(v) ? null : clamp(v - 90, -130, 130);
    };
    const hip = pick(0);
    const thigh = pick(1);
    const calf = pick(2);
    out.push({
      hip: hip ?? NEUTRAL.hip,
      thigh: thigh ?? NEUTRAL.thigh,
      calf: calf ?? NEUTRAL.calf,
    });
  }
  return out;
}

export function footZ(a: LegAngles): number {
  return legPoints(a, 1, 1).F[2];
}

/* ------------------------------------------------------------- scene build */

const CORNER_XY = scallop(116, 92, 8, 0.038);
const CORNER_XY_LOW = octagon(106, 82, 24);

export function buildScene(legs: LegAngles[], pitch: number, roll: number): Scene {
  nextId = 1;
  const polys: Poly[] = [];
  const segs: Seg[] = [];
  const balls: Ball[] = [];

  const groundZ = Math.round(footZ(NEUTRAL));

  /* ---- decks ---- */
  polys.push(...prism(CORNER_XY, 44, 50, C.plateTop, undefined, 2));
  polys.push(...prism(CORNER_XY_LOW, -4, 2, C.plateBot, undefined, 2));
  for (const [sx, sy] of LEG_CORNERS) {
    polys.push(...bar([sx * 80, sy * 58, 2], [sx * 80, sy * 58, 44], 8, 8, C.metal));
  }

  /* ---- side display (red PCB + dark screen), kept inside the deck gap.
         Mirrored to the -Y face per the red markup (was +Y). ---- */
  polys.push(...boxAt([10, -86, 23], [74, 6, 38], C.pcb));
  polys.push(...boxAt([10, -90, 23], [58, 4, 34], C.screen));

  /* ---- flat belly platform slung under the body (green markup),
         hung off the lower deck on four standoffs. plateBot so it
         reads as part of the chassis ---- */
  polys.push(...boxAt([0, 0, -45], [195, 175, 8], C.plateBot));
  for (const [px, py] of [[80, 70], [80, -70], [-80, 70], [-80, -70]] as [number, number][]) {
    polys.push(...bar([px, py, -41], [px, py, -4], 8, 8, C.metal));
  }

  /* ---- top deck furniture (layer 1: always painted over the deck surface,
         which is correct for every camera elevation we allow) ---- */
  /* ---- cooling fan, standing vertical in the front of the deck gap
         (yellow markup): housing + recessed ring, five blades and hub
         on BOTH faces so it reads from either side.
         Layer 0: it lives in the gap, not on the top plate. ---- */
  {
    const FX = 80; // front of the deck gap, where the driver board was
    const FY = -14; // aligned with the driver board
    const FZ = 23; // mid-gap
    polys.push(...boxAt([FX, FY, FZ], [13, 44, 44], C.fan));
    // YZ-plane detail at x = FX +/- 6.6, mirrored on both faces
    for (const sxn of [-1, 1]) {
      const px = FX + sxn * 6.6;
      const ring: V3[] = [];
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * Math.PI * 2;
        ring.push([px, FY + Math.cos(a) * 17, FZ + Math.sin(a) * 17]);
      }
      facing(polys, ring, [sxn, 0, 0], C.slot);
      const bl = (r: number, a: number): V3 => [
        px + sxn * 0.4,
        FY + Math.cos(a) * r,
        FZ + Math.sin(a) * r,
      ];
      for (let i = 0; i < 5; i++) {
        const b = (i / 5) * Math.PI * 2;
        facing(
          polys,
          [bl(6, b), bl(16, b + 0.5), bl(16, b + 0.5 + 0.85), bl(6, b + 0.85)],
          [sxn, 0, 0],
          C.fanBlade,
        );
      }
      polys.push(...tube([px, FY, FZ], [px + sxn * 3.5, FY, FZ], 5.5, 8, C.hub));
    }
  }
  /* ---- vent grille + raised module (removed per red markup; blocks deleted) ---- */

  /* ---- front ToF sensor (removed per red markup; block deleted) ---- */

  /* ---- whip antenna + mic on a gooseneck (they stand on the top deck) ---- */
  const mastStart = polys.length;
  polys.push(...tube([-20, 85, 50], [-17, 88, 61], 8, 6, C.metal));
  polys.push(...tube([-17, 88, 61], [-10, 95, 118], 5.5, 6, C.antenna));
  polys.push(...tube([-38, 26, 50], [-43, 29, 59], 8, 6, C.metal));
  polys.push(...tube([-43, 29, 59], [-50, 33, 96], 4, 6, C.antenna));
  polys.push(...tube([-50, 33, 96], [-55, 35, 130], 3.6, 6, C.antenna));
  for (let i = mastStart; i < polys.length; i++) polys[i].layer = 1;
  balls.push({ id: nextId++, c: [-56, 36, 145], r: 15, col: C.mic, layer: 1 });

  /* ---- legs: black hip servo, tan cut-out plates, red-labelled thigh servo ---- */
  legs.forEach((a, li) => {
    const [sx, sy] = LEG_CORNERS[li];
    const t3 = li * 3;
    const { A, B, K, F, th } = legPoints(a, sx, sy);
    // leg-plane frame: outward = horizontal splay dir, tang = in-plane lateral
    const outward: V3 = [Math.cos(th), Math.sin(th), 0];
    const tang: V3 = [-Math.sin(th), Math.cos(th), 0];

    // hip servo block seated on the belly platform + the vertical yaw pin it swings on
    polys.push(...boxAt([sx * LEG_AX, sy * LEG_AY, LEG_AZ], [44, 34, 42], C.hipservo, t3));
    polys.push(...bar([A[0], A[1], LEG_AZ - 26], [A[0], A[1], LEG_AZ + 26], 14, 14, C.metal, t3));

    // coxa bracket from the hip to the thigh servo
    polys.push(...linkPlate(A, B, 24, 34, C.frame, t3, { mids: [0.5], n: tang }));

    // thigh servo with its red rating label facing outboard
    polys.push(...boxAt(B, [30, 32, 34], C.servo, t3 + 1));
    {
      const lo = add(B, mul(outward, 16.6));
      const c1 = add(lo, mul(tang, -11));
      const c2 = add(lo, mul(tang, 11));
      facing(
        polys,
        [
          [c1[0], c1[1], c1[2] + 9],
          [c2[0], c2[1], c2[2] + 9],
          [c2[0], c2[1], c2[2] - 9],
          [c1[0], c1[1], c1[2] - 9],
        ],
        outward,
        C.label,
        t3 + 1,
      );
    }

    // femur: flat plate with a punched window
    polys.push(...linkPlate(B, K, 8.5, 34, C.frame, t3 + 1, { mids: [0.5], n: tang }));

    // knee servo at K (black theme, matches hip) + drives tibia
    {
      const femDir = unit(sub(K, B));
      const lat = unit(cross(femDir, [0, 0, 1]));
      const side = dot(lat, outward) >= 0 ? lat : mul(lat, -1);
      const az = unit(cross(femDir, side));
      const kc = add(K, mul(femDir, -4));
      polys.push(...boxFrame(kc, femDir, side, az, [21, 18, 20], C.hipservo, t3 + 2));
    }

    // tibia: long plate with a triangular truss toward the foot + a foot pad
    // (outward, tang, z) is right-handed, so boxFrame winds the pad outward
    polys.push(...linkPlate(K, F, 7.5, 34, C.frame, t3 + 2, { mids: [0.26], diag: [0.34, 0.9], n: tang }));
    polys.push(...boxFrame(add(F, [0, 0, 4]), outward, tang, [0, 0, 1], [9.5, 5.5, 5], C.frameDark, t3 + 2));
  });

  /* ---- pitch / roll about the ground contact centre ---- */
  const p = pitch * D2R;
  const r = roll * D2R;
  const pivot: V3 = [0, 0, groundZ];
  const pose = (v: V3): V3 => add(pivot, crossZ(rx(sub(v, pivot), p), r));
  for (const q of polys) q.p = q.p.map(pose);
  for (const s of segs) s.pts = s.pts.map(pose);
  for (const b of balls) b.c = pose(b.c);

  /* ---- ground grid ---- */
  const ground: Seg[] = [];
  const G = 500;
  for (let i = -5; i <= 5; i++) {
    const k = i * 100;
    const edge = i === 0;
    ground.push(seg([[-G, k, groundZ], [G, k, groundZ]], edge ? C.accent : C.ground, edge ? 1 : 0.9, undefined, edge ? 0.5 : 1));
    ground.push(seg([[k, -G, groundZ], [k, G, groundZ]], edge ? C.accent : C.ground, edge ? 1 : 0.9, undefined, edge ? 0.5 : 1));
  }

  let radius = 0;
  for (const q of polys) for (const v of q.p) radius = Math.max(radius, mag(sub(v, pivot)));
  for (const b of balls) radius = Math.max(radius, mag(sub(b.c, pivot)) + b.r);

  return { polys, segs, balls, ground, groundZ, radius };
}

/* ------------------------------------------------------------------ camera */

export const VIEWBOX = { w: 460, h: 290 };
const CAM_DIST = 1150;
const TARGET: V3 = [0, 0, -60];
const FOCAL = 650;
const CX = VIEWBOX.w / 2;
const CY = VIEWBOX.h / 2;

export const VIEWS: Record<string, View> = {
  Perspective: { az: 48, el: 24 },
  Front: { az: 0, el: 10 },
  Top: { az: -90, el: 88 },
};

const L1 = unit([0.35, 0.55, 0.75]);
const L2 = unit([-0.55, -0.4, 0.3]);

type Cam = { pos: V3; right: V3; up: V3; fwd: V3 };

function cameraOf(v: View): Cam {
  const a = v.az * D2R;
  const e = v.el * D2R;
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  const ce = Math.cos(e);
  const se = Math.sin(e);
  const fwd: V3 = [ce * ca, ce * sa, se];
  const right: V3 = [-sa, ca, 0];
  const up: V3 = [-se * ca, -se * sa, ce];
  return { pos: add(TARGET, mul(fwd, CAM_DIST)), right, up, fwd };
}

function shade(base: RGB, n: V3, toCam: V3, depth: number): RGB {
  let nx = n[0];
  let ny = n[1];
  let nz = n[2];
  if (dot(n, toCam) < 0) {
    nx = -nx;
    ny = -ny;
    nz = -nz;
  }
  const nn: V3 = [nx, ny, nz];
  // hemisphere ambient (sky brighter from above) + key + cool fill from behind
  const hemi = 0.5 + 0.5 * clamp(nn[2], -1, 1);
  const s =
    0.34 +
    0.3 * hemi +
    0.52 * Math.max(0, dot(nn, L1)) +
    0.16 * Math.max(0, dot(nn, L2));
  const fog = 1 - 0.14 * clamp((depth - 900) / 540, 0, 1);
  const k = clamp(s * fog, 0.24, 1.5);
  return [
    clamp(Math.round(base[0] * k), 0, 255),
    clamp(Math.round(base[1] * k), 0, 255),
    clamp(Math.round(base[2] * k), 0, 255),
  ];
}

const rgb = (c: RGB) => `rgb(${c[0]},${c[1]},${c[2]})`;
const rgba = (c: RGB, a: number) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

const mix = (a: RGB, b: RGB, t: number): RGB => [
  Math.round(a[0] + (b[0] - a[0]) * t),
  Math.round(a[1] + (b[1] - a[1]) * t),
  Math.round(a[2] + (b[2] - a[2]) * t),
];

export type Drawn =
  | {
      k: "poly";
      key: string;
      d: string;
      pts: { x: number; y: number; d: number }[];
      fill: string;
      stroke: string;
      sw: number;
      depth: number;
      layer: number;
    }
  | {
      k: "seg";
      key: string;
      d: string;
      stroke: string;
      sw: number;
      depth: number;
      layer: number;
    }
  | {
      k: "ball";
      key: string;
      cx: number;
      cy: number;
      r: number;
      fill: string;
      stroke: string;
      sw: number;
      depth: number;
      layer: number;
    };

/** Liang-Barsky clip of a screen-space segment to the viewBox. */
function clipSeg(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  m: number,
): [number, number, number, number] | null {
  const x0 = m;
  const y0 = m;
  const x1 = VIEWBOX.w - m;
  const y1 = VIEWBOX.h - m;
  let t0 = 0;
  let t1 = 1;
  const dx = bx - ax;
  const dy = by - ay;
  const p = [-dx, dx, -dy, dy];
  const q = [ax - x0, x1 - ax, ay - y0, y1 - ay];
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i] < 0) return null;
    } else {
      const r = q[i] / p[i];
      if (p[i] < 0) {
        if (r > t1) return null;
        if (r > t0) t0 = r;
      } else {
        if (r < t0) return null;
        if (r < t1) t1 = r;
      }
    }
  }
  return [ax + dx * t0, ay + dy * t0, ax + dx * t1, ay + dy * t1];
}

export function renderScene(
  scene: Scene,
  view: View,
  mode: Shading,
  sel: number,
): { ground: Drawn[]; body: Drawn[] } {
  const cam = cameraOf(view);
  // The deck layers only make sense while the camera looks down onto the top
  // plate; from below, collapse them so plain depth order decides occlusion.
  const keepLayer = cam.pos[2] > 52;
  const lay = (l: number) => (keepLayer ? l : 0);
  const proj = (v: V3): { x: number; y: number; d: number } | null => {
    const q = sub(v, TARGET);
    const depth = CAM_DIST - dot(q, cam.fwd);
    if (depth < 60) return null;
    return {
      x: CX + (FOCAL * dot(q, cam.right)) / depth,
      y: CY - (FOCAL * dot(q, cam.up)) / depth,
      d: depth,
    };
  };

  const wire = mode !== "solid";
  const xray = mode === "xray";

  const ground: Drawn[] = [];
  for (const s of scene.ground) {
    const pts = s.pts.map(proj);
    if (pts.some((p) => p === null)) continue;
    const a = pts[0]!;
    const b = pts[pts.length - 1]!;
    const cl = clipSeg(a.x, a.y, b.x, b.y, 1);
    if (!cl) continue;
    const mid: V3 = s.pts.reduce((acc, v) => add(acc, v), [0, 0, 0]);
    const dist = mag(mul(mid, 1 / s.pts.length));
    const fade = clamp(1 - dist / 520, 0.06, 1);
    const alpha = (s.alpha ?? 1) * fade * (xray ? 0.7 : 1);
    ground.push({
      k: "seg",
      key: `g${s.id}`,
      d: `${cl[0].toFixed(1)},${cl[1].toFixed(1)} ${cl[2].toFixed(1)},${cl[3].toFixed(1)}`,
      stroke: rgba(s.col, alpha),
      sw: s.w ?? 1,
      depth: 0,
      layer: 0,
    });
  }

  const items: Drawn[] = [];

  const pushPoly = (q: Poly) => {
    const pts = q.p.map(proj);
    if (pts.some((p) => p === null)) return;
    const pp = pts as { x: number; y: number; d: number }[];
    const depth = pp.reduce((s, p) => s + p.d, 0) / pp.length;

    const c0 = q.p[0];
    const n = unit(cross(sub(q.p[1], c0), sub(q.p[2], c0)));
    const toCam = sub(cam.pos, c0);
    // Back-face culling: only meaningful in solid mode (wire/xray keep every face
    // so the structure stays readable). Requires consistent outward winding.
    if (!wire && dot(n, toCam) <= 0) return;

    let col = shade(q.col, n, toCam, depth);
    if (sel >= 0 && q.tag === sel) col = mix(col, C.accent, 0.5);

    let fill = rgb(col);
    let stroke = "rgba(0,0,0,0.5)";
    let sw = 0.55;
    if (wire) {
      fill = "none";
      stroke =
        sel >= 0 && q.tag === sel
          ? "rgba(90,214,196,0.95)"
          : "rgba(122,205,225,0.75)";
      sw = 0.9;
    } else if (xray) {
      fill = rgba(col, q.alpha != null ? q.alpha * 1.4 : 0.1);
      stroke = sel >= 0 && q.tag === sel ? "rgba(90,214,196,0.9)" : "rgba(122,205,225,0.5)";
      sw = 0.7;
    } else if (q.alpha != null) {
      fill = rgba(col, q.alpha);
      stroke = rgba(col, Math.min(1, q.alpha + 0.35));
    }

    items.push({
      k: "poly",
      key: `p${q.id}`,
      d: pp.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" "),
      pts: pp,
      fill,
      stroke,
      sw,
      depth,
      layer: lay(q.layer ?? 0),
    });
  };

  for (const q of scene.polys) pushPoly(q);

  for (const s of scene.segs) {
    const pts = s.pts.map(proj);
    if (pts.some((p) => p === null)) continue;
    const pp = pts as { x: number; y: number; d: number }[];
    const depth = pp.reduce((a, p) => a + p.d, 0) / pp.length;
    let col = s.col;
    if (sel >= 0 && s.tag === sel) col = C.accent;
    const alpha = (s.alpha ?? 1) * (xray ? 0.75 : 1);
    items.push({
      k: "seg",
      key: `s${s.id}`,
      d: pp.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" "),
      stroke: rgba(col, alpha),
      sw: (s.w ?? 1) * (wire ? 1.3 : 1),
      depth,
      layer: lay(s.layer ?? 0),
    });
  }

  for (const b of scene.balls) {
    const p = proj(b.c);
    if (!p) continue;
    let col = shade(b.col, unit(sub(cam.pos, b.c)), sub(cam.pos, b.c), p.d);
    if (sel >= 0 && b.tag === sel) col = mix(col, C.accent, 0.5);
    const fill = xray || wire ? "none" : rgb(col);
    const stroke =
      wire || xray ? "rgba(122,205,225,0.75)" : "rgba(0,0,0,0.5)";
    items.push({
      k: "ball",
      key: `b${b.id}`,
      cx: p.x,
      cy: p.y,
      r: Math.max(0.6, (FOCAL * b.r) / p.d),
      fill,
      stroke,
      sw: wire || xray ? 0.9 : 0.55,
      depth: p.d,
      layer: lay(b.layer ?? 0),
    });
  }

  items.sort((a, b) => a.layer - b.layer || b.depth - a.depth);
  return { ground, body: items };
}
