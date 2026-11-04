/**
 * What every castle room is made of (docs/25-rooms-of-the-keep.md §2.3): coursed stone, or Harrenhal's
 * melted rock; arches and piers across the whole width, so a wide plate has no bare dark end; flagged
 * floors and rushes; torches that never quite go out; tapestries, shields and banners in whatever bays
 * a room leaves free.
 */
import { clamp, DARK, mix, rgb, TAU, WARM, type Ctx, type Env, type Masonry, type RGB } from "./places";
import { fill, fire, glowAt, poly, room, stroke, type Scene } from "./scenes";

type G = CanvasRenderingContext2D;
export type Paint = (g: G, E: Env) => void;

export interface Look {
  masonry: Masonry;
  /** Stone, and the darker line between its courses. */
  wall: RGB;
  joint: RGB;
  floor: RGB;
  /** Timber and ironwork. */
  wood: RGB;
  /** The room's cloth: field and charge. */
  cloth: RGB;
  cloth2: RGB;
  /** How lit the stone stays when the sun has gone. */
  night: number;
}

const LOOKS: Record<Masonry, Omit<Look, "masonry" | "cloth" | "cloth2">> = {
  ashlar: { wall: [176, 162, 140], joint: [84, 74, 64], floor: [132, 118, 100], wood: [84, 56, 38], night: 0.36 },
  redstone: { wall: [176, 98, 82], joint: [86, 40, 36], floor: [128, 78, 68], wood: [72, 36, 28], night: 0.38 },
  fused: { wall: [72, 66, 74], joint: [24, 20, 26], floor: [66, 60, 62], wood: [58, 42, 34], night: 0.5 },
};

/** A castle room's materials: the castle's own if it has them, else plain pale stone. */
export function keepLook(c: Ctx): Look {
  const keep = c.home?.keep;
  const masonry: Masonry = keep?.masonry ?? "ashlar";
  const base = LOOKS[masonry];
  const fallback: [RGB, RGB] = masonry === "redstone" ? [[150, 28, 40], [214, 170, 80]] : masonry === "fused" ? [[44, 62, 84], [176, 160, 120]] : [c.home?.fabric ?? [46, 84, 120], [214, 196, 150]];
  const [cloth, cloth2] = keep?.banners ?? fallback;
  return { ...base, masonry, cloth, cloth2 };
}

/** A surface in the room's light: day through the windows, or the torches at night. */
export function tint(E: Env, hue: RGB, min = 0.34): RGB {
  return mix(mix(hue, DARK, 0.82), hue, Math.max(min, 0.28 + E.day * 0.58 * (1 - E.c.cloud * 0.35)));
}
/** How strongly the castle's fires and candles show. */
export const torchlight = (E: Env) => clamp(Math.max(E.glow * 1.15, 0.3));

// ---------- Light ----------

/** A torch in an iron bracket, with the pool of light it throws on the stone. */
export function torch(g: G, E: Env, x: number, y: number, u: number, big = 1) {
  const on = torchlight(E);
  glowAt(g, x, y, 170 * u * big, WARM, 0.42 * on);
  g.fillStyle = "rgb(26,20,18)";
  g.fillRect(x - 1.6 * u, y - 2 * u, 3.2 * u, 22 * u);
  g.fillRect(x - 5 * u, y + 13 * u, 10 * u, 2.4 * u);
  g.fillStyle = rgb(mix([60, 34, 20], [120, 70, 34], on));
  g.fillRect(x - 3 * u, y - 7 * u, 6 * u, 7 * u);
  fire(g, E, x, y - 6 * u, 0.62 * u);
}
/** A candle standing on y. */
export function candle(g: G, E: Env, x: number, y: number, u: number, h = 13, glow = 1) {
  const on = torchlight(E);
  g.fillStyle = rgb(tint(E, [232, 220, 196], 0.45));
  g.fillRect(x - 1.8 * u, y - h * u, 3.6 * u, h * u);
  if (E.glow < 0.08) return;
  glowAt(g, x, y - (h + 4) * u, 56 * u * glow, WARM, 0.5 * on * glow);
  g.fillStyle = rgb([255, 226, 150], 0.95);
  g.beginPath();
  g.ellipse(x, y - (h + 3.4) * u, 1.5 * u, 3.4 * u, 0, 0, TAU);
  g.fill();
}
/** Daylight falling through a window into the room. */
export function shaft(g: G, E: Env, x0: number, x1: number, top: number, floor: number, dx: number, hue: RGB = [255, 238, 205]) {
  const a = E.day * 0.17 * (1 - E.c.cloud * 0.6);
  const moon = E.light && E.day < 0.25 ? E.light.a * 0.07 : 0;
  if (a + moon < 0.01) return;
  const c = E.day > 0.25 ? mix(hue, [255, 186, 130], E.golden * 0.7) : ([190, 204, 255] as RGB);
  const gr = g.createLinearGradient(0, top, 0, floor);
  gr.addColorStop(0, rgb(c, (a + moon) * 1.2));
  gr.addColorStop(1, rgb(c, (a + moon) * 0.25));
  g.fillStyle = gr;
  g.beginPath();
  g.moveTo(x0, top);
  g.lineTo(x1, top);
  g.lineTo(x1 + dx, floor);
  g.lineTo(x0 + dx, floor);
  g.closePath();
  g.fill();
}

// ---------- Openings ----------

/** A window of the castle's own kind: lancet, tall red-keep light, or a warped slit in melted stone. */
export function opening(p: Path2D, L: Look, x: number, top: number, w: number, bottom: number, u: number, r: () => number) {
  if (L.masonry === "fused") {
    p.moveTo(x - w * 0.4, bottom);
    p.quadraticCurveTo(x - w * (0.3 + r() * 0.3), (top + bottom) / 2, x - w * 0.25, top + 14 * u);
    p.quadraticCurveTo(x + (r() - 0.5) * w * 0.4, top - 8 * u, x + w * 0.28, top + 10 * u);
    p.quadraticCurveTo(x + w * (0.3 + r() * 0.3), (top + bottom) / 2, x + w * 0.42, bottom);
    p.closePath();
    return;
  }
  const hw = w / 2;
  const sp = top + w * (L.masonry === "redstone" ? 0.55 : 0.95);
  p.moveTo(x - hw, bottom);
  p.lineTo(x - hw, sp);
  if (L.masonry === "redstone") p.arc(x, sp, hw, Math.PI, 0);
  else {
    p.quadraticCurveTo(x - hw, top + w * 0.3, x, top);
    p.quadraticCurveTo(x + hw, top + w * 0.3, x + hw, sp);
  }
  p.lineTo(x + hw, bottom);
  p.closePath();
}
/** A stone mullion and leads across a window. */
export function tracery(p: Path2D, L: Look, x: number, top: number, w: number, bottom: number, u: number) {
  if (L.masonry === "fused") return;
  p.rect(x - 1.5 * u, top, 3 * u, bottom - top);
  for (let y = top + w * 1.1; y < bottom - 6 * u; y += 26 * u) p.rect(x - w / 2, y, w, 1.8 * u);
}
/** The thickness of the wall round a window. */
export function reveal(g: G, E: Env, L: Look, win: Path2D, u: number) {
  g.lineJoin = "round";
  stroke(g, win, tint(E, mix(L.joint, L.wall, 0.15), 0.3), 12 * u);
  stroke(g, win, tint(E, mix(L.wall, [240, 230, 214], 0.25), 0.34), 3.5 * u);
}

// ---------- The shell ----------

interface ShellOpts {
  floor: number;
  /** Stretches of wall the room is using itself; the other bays get dressed. */
  busy?: [number, number][];
  /** Piers and arches. A cell or a passage goes without. */
  arches?: boolean;
  /** Where the arches spring from, as a share of the height. */
  spring?: number;
  /** Width of a bay. */
  bay?: number;
  /** Torches on the piers. */
  torches?: boolean;
  /** Tapestries, banners and shields in the free bays. A cell has none. */
  dressed?: boolean;
}

/**
 * The room round the furniture. `under` paints the stone, arches, dressing and floor, `over` paints the
 * torches and rushes in front of it all.
 */
export function shell(c: Ctx, L: Look, o: ShellOpts) {
  const { W, H, u, F, r } = c;
  const floor = o.floor;
  const bay = (o.bay ?? 190) * u;
  const spring = H * (o.spring ?? 0.22);
  const busy = o.busy ?? [];
  const free = (x0: number, x1: number) => !busy.some(([a, b]) => x1 > a && x0 < b);

  // Courses of stone, cut by hand: no two quite alike.
  const joints = new Path2D();
  const blocks: { x: number; y: number; w: number; h: number; d: number }[] = [];
  const melt: { p: Path2D; a: number }[] = [];
  const cracks = new Path2D();
  if (L.masonry === "fused") {
    for (const layer of [0.55, 0.85, 1]) {
      const p = new Path2D();
      for (let x = -30 * u; x < W + 30 * u; ) {
        const w = (40 + r() * 90) * u;
        const len = floor * (0.25 + r() * 0.65) * layer;
        p.moveTo(x, 0);
        p.lineTo(x, len * 0.55);
        p.bezierCurveTo(x, len * 0.9, x + w * 0.3, len + 8 * u, x + w * 0.5, len);
        p.bezierCurveTo(x + w * 0.72, len - 10 * u, x + w, len * 0.8, x + w, len * 0.45);
        p.lineTo(x + w, 0);
        p.closePath();
        x += w * (0.55 + r() * 0.4);
      }
      melt.push({ p, a: 0.1 + layer * 0.14 });
    }
    for (let i = 0; i < 12; i++) {
      let x = r() * W;
      let y = floor * (0.2 + r() * 0.5);
      cracks.moveTo(x, y);
      for (let k = 0; k < 5; k++) {
        x += (r() - 0.5) * 22 * u;
        y += (6 + r() * 16) * u;
        cracks.lineTo(x, Math.min(y, floor));
      }
    }
  } else {
    const course = (L.masonry === "redstone" ? 20 : 24) * u;
    for (let y = 0, row = 0; y < floor; y += course, row++) {
      joints.moveTo(0, y);
      joints.lineTo(W, y);
      for (let x = (row % 2 ? 0 : 26 * u) + r() * 14 * u; x < W; ) {
        const w = (38 + r() * 34) * u;
        joints.moveTo(x, y);
        joints.lineTo(x, y + course);
        if (r() < 0.24) blocks.push({ x, y, w, h: course, d: r() < 0.5 ? -1 : 1 });
        x += w;
      }
    }
  }

  // Piers and arches, spaced from the room's subject out to both edges.
  const piers: number[] = [];
  for (let x = F - bay * Math.ceil(F / bay + 1); x < W + bay; x += bay) piers.push(x);
  const arches = o.arches !== false;
  const ceil = new Path2D();
  const ribs = new Path2D();
  const pier = new Path2D();
  const caps = new Path2D();
  if (arches) {
    for (const x of piers) {
      const x1 = x + bay;
      const crown = H * 0.012;
      ceil.moveTo(x, -2);
      ceil.lineTo(x, spring);
      ribs.moveTo(x, spring);
      if (L.masonry === "ashlar") {
        const m = x + bay / 2;
        ceil.quadraticCurveTo(x + bay * 0.05, crown + (spring - crown) * 0.28, m, crown);
        ceil.quadraticCurveTo(x1 - bay * 0.05, crown + (spring - crown) * 0.28, x1, spring);
        ribs.quadraticCurveTo(x + bay * 0.05, crown + (spring - crown) * 0.28, m, crown);
        ribs.quadraticCurveTo(x1 - bay * 0.05, crown + (spring - crown) * 0.28, x1, spring);
      } else {
        const sag = L.masonry === "fused" ? (r() - 0.5) * 16 * u : 0;
        ceil.bezierCurveTo(x, crown + sag, x1, crown - sag, x1, spring);
        ribs.bezierCurveTo(x, crown + sag, x1, crown - sag, x1, spring);
      }
      ceil.lineTo(x1, -2);
      ceil.closePath();
      pier.rect(x - 10 * u, spring - 4 * u, 20 * u, floor - spring + 4 * u);
      caps.rect(x - 15 * u, spring - 8 * u, 30 * u, 7 * u);
      caps.rect(x - 15 * u, floor - 11 * u, 30 * u, 11 * u);
    }
  }

  // What hangs in the free bays.
  const hung: { kind: "tapestry" | "banner" | "shields" | "torch"; x: number; w: number }[] = [];
  const hooks: number[] = [];
  for (let i = 0; i < piers.length; i++) {
    const x = piers[i]!;
    const mid = x + bay / 2;
    if (x > 0 && x < W && free(x - 12 * u, x + 12 * u) && i % 2 === 0) hooks.push(x);
    if (mid < -bay / 2 || mid > W + bay / 2 || !free(mid - bay * 0.38, mid + bay * 0.38)) continue;
    const k = r();
    if (o.dressed === false) continue;
    hung.push({ kind: k < 0.42 ? "tapestry" : k < 0.68 ? "banner" : k < 0.85 ? "shields" : "torch", x: mid, w: bay });
  }
  if (!arches) for (let x = F - 280 * u; x > -40 * u; x -= 300 * u) if (free(x - 20 * u, x + 20 * u)) hooks.push(x);

  // Flagstones run towards the room's subject, and rushes lie over them.
  const flags = new Path2D();
  const vx = F;
  for (let i = -28; i <= 28; i++) {
    flags.moveTo(vx + i * 26 * u, floor);
    flags.lineTo(vx + i * 110 * u, H);
  }
  for (let t = 0.22; t < 1; t = t * 1.5 + 0.08) {
    flags.moveTo(0, floor + (H - floor) * t);
    flags.lineTo(W, floor + (H - floor) * t);
  }
  const rushes = new Path2D();
  const n = Math.min(260, Math.round((W / u) * 0.22));
  for (let i = 0; i < n; i++) {
    const x = r() * W;
    const y = floor + 4 * u + r() * (H - floor - 4 * u);
    const a = (r() - 0.5) * 1.2;
    const len = (7 + r() * 14) * u;
    rushes.moveTo(x, y);
    rushes.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len * 0.3);
  }

  const under: Paint = (g, E) => {
    const stone = tint(E, L.wall, L.night);
    for (const b of blocks) {
      g.fillStyle = b.d < 0 ? rgb(DARK, 0.09) : rgb([255, 240, 214], 0.04 + E.day * 0.035);
      g.fillRect(b.x, b.y, b.w, b.h);
    }
    if (L.masonry === "fused") {
      for (const m of melt) {
        fill(g, m.p, mix(stone, [190, 180, 186], 0.5), m.a);
        stroke(g, m.p, DARK, 1.6 * u, 0.3);
      }
      stroke(g, cracks, DARK, 1.5 * u, 0.55);
    } else stroke(g, joints, tint(E, L.joint, 0.3), 1 * u, 0.5);
    if (arches) {
      fill(g, ceil, mix(tint(E, L.joint, 0.24), DARK, 0.25));
      stroke(g, ribs, mix(stone, [255, 240, 214], 0.1), 6.5 * u);
      stroke(g, ribs, tint(E, L.joint, 0.28), 1.2 * u, 0.7);
      fill(g, pier, mix(stone, [255, 240, 214], 0.06));
      for (const x of piers) {
        g.fillStyle = rgb(DARK, 0.2);
        g.fillRect(x + 4 * u, spring, 6 * u, floor - spring);
      }
      fill(g, caps, mix(stone, [255, 240, 214], 0.14));
    }
    for (const h of hung) {
      if (h.kind === "tapestry") tapestry(g, E, L, h.x, spring + 10 * u, h.w * 0.56, floor - spring - 60 * u, u);
      else if (h.kind === "banner") banner(g, E, L, h.x, spring + 6 * u, 46 * u, floor - spring - 100 * u, u);
      else if (h.kind === "shields") shields(g, E, L, h.x, (spring + floor) * 0.47, u);
    }
    // The stone meets the floor in shadow.
    const fg = g.createLinearGradient(0, floor - 26 * u, 0, floor);
    fg.addColorStop(0, rgb(DARK, 0));
    fg.addColorStop(1, rgb(DARK, 0.32));
    g.fillStyle = fg;
    g.fillRect(0, floor - 26 * u, W, 26 * u);
    stroke(g, flags, tint(E, mix(L.floor, DARK, 0.6), 0.28), 1 * u, 0.5);
  };
  const over: Paint = (g, E) => {
    if (L.masonry !== "fused") stroke(g, rushes, tint(E, [176, 150, 88], 0.34), 1.1 * u, 0.42);
    else stroke(g, rushes, tint(E, [60, 54, 56], 0.3), 1.6 * u, 0.5);
    if (o.torches !== false) {
      for (const x of hooks) torch(g, E, x, H * 0.42, u);
      for (const h of hung) if (h.kind === "torch") torch(g, E, h.x, H * 0.42, u);
    }
  };
  return { under, over, spring };
}

/** A castle room: the shell's light and materials round what `furnish` paints. */
export function keepRoom(c: Ctx, L: Look, win: Path2D, outside: Paint, furnish: Paint, floor: number): Scene {
  return room(c, win, L.wall, outside, furnish, floor, { floorHue: L.floor, lift: (E) => Math.max(L.night, 0.2 + E.day * 0.55 * (1 - E.c.cloud * 0.4)), vignette: 0.2 });
}

// ---------- What hangs on the walls ----------

/** A hanging with a border, a lozenge field and a fringe. */
export function tapestry(g: G, E: Env, L: Look, x: number, y: number, w: number, h: number, u: number) {
  const a = tint(E, L.cloth, 0.3);
  const b = tint(E, L.cloth2, 0.32);
  const x0 = x - w / 2;
  g.fillStyle = rgb(DARK, 0.28);
  g.fillRect(x0 + 3 * u, y + 3 * u, w, h);
  g.fillStyle = rgb(b);
  g.fillRect(x0, y, w, h);
  g.fillStyle = rgb(a);
  const inset = Math.max(4 * u, w * 0.07);
  g.fillRect(x0 + inset, y + inset, w - inset * 2, h - inset * 2);
  g.fillStyle = rgb(b, 0.75);
  const sx = (w - inset * 2) / 3;
  const rows = Math.max(1, Math.floor((h - inset * 2) / (sx * 1.25)));
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < 3; i++) {
      const cx = x0 + inset + sx * (i + 0.5);
      const cy = y + inset + ((h - inset * 2) / rows) * (j + 0.5);
      g.beginPath();
      g.moveTo(cx, cy - sx * 0.36);
      g.lineTo(cx + sx * 0.24, cy);
      g.lineTo(cx, cy + sx * 0.36);
      g.lineTo(cx - sx * 0.24, cy);
      g.fill();
    }
  g.fillStyle = "rgb(30,22,18)";
  g.fillRect(x0 - 5 * u, y - 3 * u, w + 10 * u, 3.5 * u);
  g.fillStyle = rgb(b);
  for (let fx = x0 + 2 * u; fx < x0 + w; fx += 5 * u) g.fillRect(fx, y + h, 1.8 * u, 5 * u);
}
/** A long swallow-tailed banner of the castle's colours. */
export function banner(g: G, E: Env, L: Look, x: number, y: number, w: number, h: number, u: number) {
  const a = tint(E, L.cloth, 0.32);
  const b = tint(E, L.cloth2, 0.34);
  const shape = new Path2D();
  poly(shape, x - w / 2, y, x + w / 2, y, x + w / 2, y + h, x, y + h - w * 0.42, x - w / 2, y + h);
  g.fillStyle = rgb(DARK, 0.26);
  g.save();
  g.translate(3 * u, 3 * u);
  g.fill(shape);
  g.restore();
  fill(g, shape, a);
  g.save();
  g.clip(shape);
  g.fillStyle = rgb(b);
  g.fillRect(x - w / 2, y + h * 0.1, w, 3.4 * u);
  g.fillRect(x - w * 0.11, y, w * 0.22, h);
  // One long fold.
  const fold = g.createLinearGradient(x - w / 2, 0, x + w / 2, 0);
  fold.addColorStop(0, rgb(DARK, 0.22));
  fold.addColorStop(0.4, rgb(DARK, 0));
  fold.addColorStop(1, rgb(DARK, 0.3));
  g.fillStyle = fold;
  g.fillRect(x - w / 2, y, w, h);
  g.restore();
  g.fillStyle = "rgb(30,22,18)";
  g.fillRect(x - w / 2 - 4 * u, y - 3 * u, w + 8 * u, 3.4 * u);
}
/** Two shields over crossed spears. */
export function shields(g: G, E: Env, L: Look, x: number, y: number, u: number) {
  const steel = tint(E, [160, 160, 168], 0.36);
  g.strokeStyle = rgb(tint(E, L.wood, 0.34));
  g.lineWidth = 2.4 * u;
  g.beginPath();
  g.moveTo(x - 46 * u, y - 44 * u);
  g.lineTo(x + 46 * u, y + 44 * u);
  g.moveTo(x + 46 * u, y - 44 * u);
  g.lineTo(x - 46 * u, y + 44 * u);
  g.stroke();
  g.fillStyle = rgb(steel);
  for (const [sx, sy] of [[-46, -44], [46, -44]] as const) {
    g.beginPath();
    g.moveTo(x + sx * u, y + sy * u);
    g.lineTo(x + (sx + (sx < 0 ? -5 : 5)) * u, y + (sy - 13) * u);
    g.lineTo(x + (sx + (sx < 0 ? 4 : -4)) * u, y + (sy - 4) * u);
    g.fill();
  }
  shield(g, E, L, x - 19 * u, y, 19 * u);
  shield(g, E, L, x + 19 * u, y, 19 * u, true);
}
function shield(g: G, E: Env, L: Look, x: number, y: number, s: number, flip = false) {
  const shape = new Path2D();
  shape.moveTo(x - s, y - s);
  shape.lineTo(x + s, y - s);
  shape.lineTo(x + s, y + s * 0.2);
  shape.quadraticCurveTo(x + s, y + s, x, y + s * 1.5);
  shape.quadraticCurveTo(x - s, y + s, x - s, y + s * 0.2);
  shape.closePath();
  fill(g, shape, tint(E, flip ? L.cloth2 : L.cloth, 0.34));
  g.save();
  g.clip(shape);
  g.fillStyle = rgb(tint(E, flip ? L.cloth : L.cloth2, 0.34));
  g.fillRect(x, y - s, s, s * 3);
  g.restore();
  stroke(g, shape, tint(E, [120, 118, 122], 0.3), s * 0.12);
}
