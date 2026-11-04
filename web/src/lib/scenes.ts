/**
 * The places a scene window paints (scenery.ts draws the sky and weather around them). Each place
 * is built once per size and seed as paths, then filled every frame in the colours of the hour, so
 * a place always looks the same and still follows the clock. Sizes are in units of the window's
 * height (u), and the subject sits at the focus (F), so one place fits a card, an arch or a band.
 */
import { clamp, DARK, FABRIC, lerp, mix, PLASTER, rand, rgb, seedOf, TAU, WARM, type Ctx, type Env, type Place, type RGB } from "./places";

export interface Scene {
  draw(g: CanvasRenderingContext2D, E: Env): void;
  /** Indoors: the sky and weather show only through `win`; `draw` furnishes the room over them. */
  room?: { win: Path2D; draw(g: CanvasRenderingContext2D, E: Env): void };
  /** Paints its own sky and has no weather (space, or a room looking out on it). */
  space?: boolean;
}

// ---------- Colour ----------

export const GRASS: RGB = [88, 128, 72];
export const MEADOW: RGB = [128, 156, 82];
export const PINE: RGB = [40, 80, 64];
const JUNGLE: RGB = [38, 112, 70];
export const SAND: RGB = [228, 170, 108];
export const ROCK: RGB = [124, 114, 128];
const REDROCK: RGB = [200, 102, 66];
const EARTH: RGB = [134, 100, 72];
export const STONE: RGB = [156, 146, 140];
export const WOOD: RGB = [110, 72, 50];
export { FABRIC, PLASTER };

/** A colour for something at depth t (0 far, 1 near): the horizon's air, darkening, with its own hue by day. */
export function tone(E: Env, t: number, hue?: RGB, amt = 0.55): RGB {
  const c = mix(E.sky.bot, DARK, 0.2 + 0.72 * t);
  return hue ? mix(c, mix(hue, DARK, t * 0.45), amt * (0.12 + 0.88 * E.day) * (1 - E.c.fog * 0.4)) : c;
}
function snowTone(E: Env, t: number): RGB {
  return mix(tone(E, t), mix(mix([120, 132, 180], [236, 240, 250], E.day), [255, 210, 190], E.golden * 0.4), 0.78 - t * 0.35);
}
/** A painted surface (a wall, a sail) catches the daylight; at night it is only a silhouette. */
export function lit(E: Env, t: number, hue: RGB, amt = 0.75): RGB {
  return mix(tone(E, t), mix(hue, [255, 190, 150], E.golden * 0.25), amt * E.day * (1 - E.c.cloud * 0.25));
}
export function fill(g: CanvasRenderingContext2D, p: Path2D, c: RGB, a = 1) {
  g.fillStyle = rgb(c, a);
  g.fill(p);
}
export function stroke(g: CanvasRenderingContext2D, p: Path2D, c: RGB, w: number, a = 1) {
  g.strokeStyle = rgb(c, a);
  g.lineWidth = w;
  g.lineCap = "round";
  g.stroke(p);
}
export function glowAt(g: CanvasRenderingContext2D, x: number, y: number, r: number, c: RGB, a: number) {
  if (a <= 0.01 || r <= 0) return;
  const lg = g.createRadialGradient(x, y, 0, x, y, r);
  lg.addColorStop(0, rgb(c, a));
  lg.addColorStop(0.35, rgb(c, a * 0.35));
  lg.addColorStop(1, rgb(c, 0));
  g.fillStyle = lg;
  g.fillRect(x - r, y - r, r * 2, r * 2);
}
/** A band of the horizon's air, for depth between layers. */
export function haze(g: CanvasRenderingContext2D, E: Env, W: number, y0: number, y1: number, a = 0.4) {
  const hg = g.createLinearGradient(0, y0, 0, y1);
  const c = mix(E.sky.bot, [220, 224, 236], E.c.fog * 0.4);
  hg.addColorStop(0, rgb(c, 0));
  hg.addColorStop(1, rgb(c, a * (0.6 + E.c.fog * 0.6)));
  g.fillStyle = hg;
  g.fillRect(0, y0, W, y1 - y0);
}
export const flick = (E: Env, k: number) => (E.still ? 1 : 0.82 + 0.1 * Math.sin(E.T * 9 + k) + 0.08 * Math.sin(E.T * 23 + k * 3));
/** A lamp or lantern: its glow, scaled by how dark it is. */
export function lamp(g: CanvasRenderingContext2D, E: Env, x: number, y: number, r: number, k = 0, c: RGB = WARM, min = 0.15) {
  const a = clamp(Math.max(E.glow, min)) * flick(E, k);
  glowAt(g, x, y, r, c, 0.55 * a);
  g.fillStyle = rgb(mix(c, [255, 250, 230], 0.5), 0.95 * a + 0.05);
  g.beginPath();
  g.arc(x, y, r * 0.08, 0, TAU);
  g.fill();
}
export function fire(g: CanvasRenderingContext2D, E: Env, x: number, y: number, s: number) {
  const T = E.still ? 0 : E.T;
  const f = flick(E, x);
  glowAt(g, x, y - s * 6, s * 60 * f, [255, 150, 70], 0.55);
  for (const [dx, h, c] of [
    [-3, 16, [255, 120, 50]],
    [3, 13, [255, 150, 60]],
    [0, 20, [255, 200, 110]],
    [0, 10, [255, 240, 190]],
  ] as const) {
    const hh = h * s * (0.85 + 0.15 * Math.sin(T * 11 + dx));
    g.fillStyle = rgb(c as RGB, 0.9);
    g.beginPath();
    g.moveTo(x + dx * s - 4 * s, y);
    g.quadraticCurveTo(x + dx * s + Math.sin(T * 7 + dx) * 2 * s, y - hh * 1.3, x + dx * s + 4 * s, y);
    g.fill();
  }
}

// ---------- Shapes ----------

export function circle(p: Path2D, x: number, y: number, r: number) {
  p.moveTo(x + r, y);
  p.arc(x, y, r, 0, TAU);
}
export function poly(p: Path2D, ...pts: number[]) {
  p.moveTo(pts[0]!, pts[1]!);
  for (let i = 2; i < pts.length; i += 2) p.lineTo(pts[i]!, pts[i + 1]!);
  p.closePath();
}
interface Line {
  p: Path2D;
  y: (x: number) => number;
}
/** Rolling ground across the whole width. */
export function ridge(c: Ctx, base: number, amp: number, freq = 1): Line {
  const { W, H, u, r } = c;
  const a = r() * TAU;
  const b = r() * TAU;
  const d = r() * TAU;
  const y = (x: number) => base - amp * (0.6 * Math.sin((x / (u * 230)) * freq + a) + 0.28 * Math.sin((x / (u * 95)) * freq + b) + 0.12 * Math.sin(x / (u * 36) + d));
  const p = new Path2D();
  p.moveTo(0, H);
  for (let x = 0; x <= W + 6 * u; x += 6 * u) p.lineTo(x, y(x));
  p.lineTo(W, H);
  p.closePath();
  return { p, y };
}
/** A jagged range with its highest peak near the focus. */
export function peaks(c: Ctx, base: number, height: number, rough = 0.5, at = c.F): Line & { top: number } {
  const { W, H, u, r } = c;
  let pts: [number, number][] = [];
  let up = r() < 0.5;
  for (let x = -40 * u; x < W + 140 * u; x += (60 + r() * 110) * u) {
    if (Math.abs(x - at) > 50 * u) pts.push([x, base - height * (up ? 0.45 + 0.4 * r() : 0.08 + 0.25 * r())]);
    up = !up;
  }
  pts.push([at, base - height]);
  pts.sort((a, b) => a[0] - b[0]);
  for (let it = 0; it < 4; it++) {
    const nx: [number, number][] = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, y0] = pts[i]!;
      const [x1, y1] = pts[i + 1]!;
      nx.push([x0, y0], [(x0 + x1) / 2, (y0 + y1) / 2 + (r() - 0.5) * (x1 - x0) * rough * 0.5]);
    }
    nx.push(pts.at(-1)!);
    pts = nx;
  }
  const p = new Path2D();
  p.moveTo(pts[0]![0], H);
  for (const [x, y] of pts) p.lineTo(x, y);
  p.lineTo(pts.at(-1)![0], H);
  p.closePath();
  const y = (x: number) => {
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, y0] = pts[i]!;
      const [x1, y1] = pts[i + 1]!;
      if (x >= x0 && x <= x1) return lerp(y0, y1, (x - x0) / (x1 - x0 || 1));
    }
    return base;
  };
  return { p, y, top: base - height };
}
function snowcap(g: CanvasRenderingContext2D, E: Env, p: Path2D, top: number, line: number, a = 0.9) {
  const sc = mix(mix([140, 150, 200], [246, 248, 252], E.day), [255, 186, 168], E.golden * 0.6);
  const gr = g.createLinearGradient(0, top, 0, line);
  gr.addColorStop(0, rgb(sc, a));
  gr.addColorStop(0.5, rgb(sc, a * 0.55));
  gr.addColorStop(1, rgb(sc, 0));
  g.fillStyle = gr;
  g.fill(p);
}
export function pine(p: Path2D, x: number, by: number, h: number) {
  const w = h * 0.3;
  const n = 4;
  p.moveTo(x, by - h);
  for (let i = 1; i <= n; i++) {
    const y = by - h + (h * 0.9 * i) / n;
    const wi = (w * i) / n;
    p.lineTo(x + wi, y);
    if (i < n) p.lineTo(x + wi * 0.35, y - h * 0.03);
  }
  p.lineTo(x + h * 0.03, by - h * 0.1);
  p.lineTo(x + h * 0.03, by);
  p.lineTo(x - h * 0.03, by);
  p.lineTo(x - h * 0.03, by - h * 0.1);
  for (let i = n; i >= 1; i--) {
    const y = by - h + (h * 0.9 * i) / n;
    const wi = (w * i) / n;
    p.lineTo(x - wi, y);
    if (i > 1) p.lineTo(x - wi * 0.35 - (w / n) * 0.65, y - (h * 0.9) / n - h * 0.03);
  }
  p.closePath();
}
export function leafy(p: Path2D, x: number, by: number, h: number) {
  const r0 = h * 0.3;
  p.rect(x - h * 0.03, by - h * 0.5, h * 0.06, h * 0.5);
  for (const [dx, dy, k] of [
    [0, -0.7, 1],
    [-0.75, -0.55, 0.75],
    [0.75, -0.55, 0.78],
    [-0.35, -0.86, 0.72],
    [0.4, -0.84, 0.66],
  ] as const)
    circle(p, x + dx * r0, by + dy * h, r0 * k);
}
export function palm(p: Path2D, x: number, by: number, h: number, lean: number) {
  const tx = x + lean;
  const ty = by - h;
  const w = h * 0.025;
  p.moveTo(x - w * 1.4, by);
  p.quadraticCurveTo(x + lean * 0.2 - w, by - h * 0.55, tx - w, ty);
  p.lineTo(tx + w, ty);
  p.quadraticCurveTo(x + lean * 0.2 + w, by - h * 0.55, x + w * 1.4, by);
  p.closePath();
  for (const a of [-2.9, -2.4, -1.9, -1.2, -0.7, -0.2, 0.3]) {
    const L = h * (0.42 + 0.08 * Math.cos(a * 3));
    const ex = tx + Math.cos(a) * L;
    const ey = ty + Math.sin(a) * L * 0.45 + L * 0.35;
    const mx = tx + Math.cos(a) * L * 0.5;
    const my = ty + Math.sin(a) * L * 0.5 - L * 0.05;
    const nx = -Math.sin(a) * h * 0.04;
    const ny = Math.cos(a) * h * 0.04;
    p.moveTo(tx, ty);
    p.quadraticCurveTo(mx + nx, my + ny, ex, ey);
    p.quadraticCurveTo(mx - nx, my - ny, tx, ty);
  }
}
interface Win {
  x: number;
  y: number;
  w: number;
  h: number;
  lit: number;
  f: number;
}
/** A house: walls and roof as separate paths (walls catch the daylight), with its windows. Returns the chimney top. */
function house(walls: Path2D, roofs: Path2D, wins: Win[], r: () => number, x: number, gy: number, w: number, h: number, roof: "gable" | "steep" | "thatch" | "flat" = "gable", chimney = true): [number, number] | null {
  walls.rect(x, gy - h, w, h + 1);
  const rh = roof === "steep" ? w * 0.8 : roof === "flat" ? w * 0.06 : roof === "thatch" ? w * 0.42 : w * 0.42;
  if (roof === "thatch") {
    roofs.moveTo(x - w * 0.1, gy - h + w * 0.04);
    roofs.quadraticCurveTo(x + w * 0.5, gy - h - rh * 1.7, x + w * 1.1, gy - h + w * 0.04);
    roofs.closePath();
  } else if (roof === "flat") roofs.rect(x - w * 0.04, gy - h - rh, w * 1.08, rh);
  else poly(roofs, x - w * 0.07, gy - h, x + w / 2, gy - h - rh, x + w * 1.07, gy - h);
  let chim: [number, number] | null = null;
  if (chimney && roof !== "flat") {
    const cx = x + w * 0.68;
    roofs.rect(cx, gy - h - rh * 0.95, w * 0.1, rh * 0.7);
    chim = [cx + w * 0.05, gy - h - rh * 0.95];
  }
  const ww = Math.min(w * 0.16, h * 0.24);
  const rows = h > w * 1.3 ? Math.max(1, Math.floor(h / (ww * 2.6))) : 1;
  const cols = Math.max(1, Math.round(w / (ww * 2.8)));
  for (let ry = 0; ry < rows; ry++)
    for (let i = 0; i < cols; i++) wins.push({ x: x + (w * (i + 0.5)) / cols - ww / 2, y: gy - h + h * (rows === 1 ? 0.3 : 0.12 + (ry * 0.82) / rows), w: ww, h: ww * 1.35, lit: r(), f: r() * 50 });
  return chim;
}
function lights(g: CanvasRenderingContext2D, E: Env, wins: Win[], warm: RGB = WARM) {
  for (const w of wins) {
    if (w.lit < E.glow * 0.92) {
      const a = clamp(E.glow * 1.4) * (w.f > 40 ? flick(E, w.f) : 1);
      g.fillStyle = rgb(warm, 0.1 * a);
      g.fillRect(w.x - w.w, w.y - w.h * 0.6, w.w * 3, w.h * 2.2);
      g.fillStyle = rgb(warm, 0.92 * a);
      g.fillRect(w.x, w.y, w.w, w.h);
    } else {
      g.fillStyle = rgb(mix(E.sky.bot, DARK, 0.6), 0.6);
      g.fillRect(w.x, w.y, w.w, w.h);
    }
  }
}
export function smoke(g: CanvasRenderingContext2D, E: Env, x: number, y: number, u: number) {
  const T = E.still ? 4 : E.T;
  for (let i = 0; i < 6; i++) {
    const k = (T * 0.12 + i / 6 + x * 0.01) % 1;
    g.fillStyle = rgb(mix(E.sky.bot, [214, 214, 224], 0.45), 0.16 * (1 - k) * (0.4 + E.glow * 0.6));
    g.beginPath();
    g.arc(x + k * 26 * u * (1 + E.c.wind * 3), y - k * 46 * u, (2 + k * 11) * u, 0, TAU);
    g.fill();
  }
}
/** Fills a path drawn around (0,0) at (x,y), leaning in the wind. */
export function sway(g: CanvasRenderingContext2D, E: Env, p: Path2D, x: number, y: number, col: RGB, k = 1) {
  const s = E.still ? 0 : Math.sin(E.T * 1.4 + x * 0.01) * (0.012 + E.c.wind * 0.07) * k;
  g.save();
  g.translate(x, y);
  g.transform(1, 0, s, 1, 0, 0);
  fill(g, p, col);
  g.restore();
}
export interface Mote {
  x: number;
  y: number;
  p: number;
  s: number;
}
export function motes(c: Ctx, n: number, x0: number, x1: number, y0: number, y1: number): Mote[] {
  return Array.from({ length: c.mini ? Math.ceil(n / 2) : n }, () => ({ x: lerp(x0, x1, c.r()), y: lerp(y0, y1, c.r()), p: c.r() * TAU, s: 0.5 + c.r() }));
}
export function fireflies(g: CanvasRenderingContext2D, E: Env, list: Mote[], u: number, col: RGB = [230, 255, 150], min = 0) {
  const a = Math.max(min, E.night * (1 - E.c.rain) * (1 - E.c.snow) * (1 - E.c.wind * 0.8));
  if (a < 0.05) return;
  for (const f of list) {
    const x = f.x + Math.sin(E.T * 0.3 * f.s + f.p) * 14 * u;
    const y = f.y + Math.cos(E.T * 0.4 * f.s + f.p) * 8 * u;
    glowAt(g, x, y, 6 * u, col, a * (0.5 + 0.5 * Math.sin(E.T * 3 * f.s + f.p)));
  }
}
export function birds(g: CanvasRenderingContext2D, E: Env, c: Ctx, list: Mote[]) {
  if (E.day < 0.4 || E.c.rain > 0.3 || E.c.snow > 0.3) return;
  g.strokeStyle = rgb(mix(E.sky.bot, DARK, 0.7), 0.75 * E.day);
  g.lineWidth = Math.max(1, 1.1 * c.u);
  g.beginPath();
  for (const b of list) {
    const x = ((b.x + E.T * 9 * c.u * b.s) % (c.W + 60 * c.u)) - 30 * c.u;
    const y = b.y + Math.sin(E.T * 0.5 + b.p) * 4 * c.u;
    const s = 4 * c.u * b.s;
    const w = Math.sin(E.T * 5 * b.s + b.p) * s * 0.6;
    g.moveTo(x - s, y - w);
    g.quadraticCurveTo(x - s * 0.4, y - s * 0.2, x, y);
    g.quadraticCurveTo(x + s * 0.4, y - s * 0.2, x + s, y - w);
  }
  g.stroke();
}
export interface Shim {
  x: number;
  y: number;
  w: number;
  p: number;
}
export const shims = (c: Ctx, n = 90): Shim[] => Array.from({ length: n }, () => ({ x: c.r(), y: c.r(), w: 0.01 + c.r() * 0.04, p: c.r() * TAU }));
/** Water from y0 down, catching the sun or moon. */
export function water(g: CanvasRenderingContext2D, E: Env, c: Ctx, y0: number, sh: Shim[], tint?: RGB, y1 = c.H) {
  const { W } = c;
  const T = E.T;
  let a = mix(E.sky.bot, DARK, 0.2);
  let b = mix(E.sky.top, DARK, 0.72);
  if (tint) {
    a = mix(a, tint, 0.5 * E.day);
    b = mix(b, mix(tint, DARK, 0.45), 0.45 * E.day);
  }
  const sg = g.createLinearGradient(0, y0, 0, y1);
  sg.addColorStop(0, rgb(a));
  sg.addColorStop(1, rgb(b));
  g.fillStyle = sg;
  g.fillRect(0, y0, W, y1 - y0);
  const L = E.light;
  for (const s of sh) {
    const y = y0 + s.y * s.y * (y1 - y0);
    const dx = L ? Math.abs(s.x * W - L.x) / W : 1;
    const a2 = (0.07 + (L ? L.a * Math.max(0, 0.45 - dx * 2.4) * 1.6 : 0)) * (0.5 + 0.5 * Math.sin(T * 2 + s.p)) * (1 - E.c.fog * 0.5);
    g.fillStyle = rgb(L && dx < 0.2 ? L.c : mix(E.sky.bot, [235, 240, 255], 0.5), a2);
    g.fillRect(s.x * W + Math.sin(T * 0.8 + s.p) * 6 * c.u, y, s.w * W * (0.3 + s.y), Math.max(1, c.u * (0.6 + s.y)));
  }
}
/** Drifting mist low over the ground or water. */
export function mist(g: CanvasRenderingContext2D, E: Env, c: Ctx, y: number, a: number) {
  const { W, u } = c;
  const fc = mix(E.sky.bot, [214, 218, 230], 0.35 + E.day * 0.3);
  for (let i = 0; i < 4; i++) {
    const off = ((E.T * (0.008 + i * 0.004) + i * 0.27) % 1) * W;
    for (const dx of [-W, 0]) {
      g.save();
      g.translate(off + dx + W * 0.5, y + i * 9 * u);
      g.scale(4, 1);
      const fg = g.createRadialGradient(0, 0, 0, 0, 0, 40 * u + W * 0.06);
      fg.addColorStop(0, rgb(fc, a));
      fg.addColorStop(1, rgb(fc, 0));
      g.fillStyle = fg;
      g.fillRect(-(40 * u + W * 0.06), -(40 * u + W * 0.06), (40 * u + W * 0.06) * 2, (40 * u + W * 0.06) * 2);
      g.restore();
    }
  }
}
function aurora(g: CanvasRenderingContext2D, E: Env, c: Ctx, k: number, ph: number) {
  const a = E.night * (1 - E.c.cloud) * (1 - E.c.fog) * k;
  if (a < 0.03) return;
  const { W, H, u } = c;
  const T = E.still ? 0 : E.T;
  g.save();
  g.globalCompositeOperation = "lighter";
  for (let band = 0; band < 3; band++) {
    const yb = H * (0.14 + band * 0.07);
    const gr = g.createLinearGradient(0, yb - 30 * u, 0, yb + 60 * u);
    gr.addColorStop(0, rgb(band === 2 ? [190, 120, 255] : [120, 255, 190], 0));
    gr.addColorStop(0.35, rgb(band === 2 ? [190, 120, 255] : [120, 255, 190], 0.28 * a));
    gr.addColorStop(1, rgb([80, 220, 160], 0));
    g.fillStyle = gr;
    g.beginPath();
    const top = (x: number) => yb + Math.sin(x / (110 * u) + T * 0.15 + band + ph) * 16 * u + Math.sin(x / (37 * u) + T * 0.4 + ph) * 5 * u;
    g.moveTo(0, top(0));
    for (let x = 0; x <= W; x += 10 * u) g.lineTo(x, top(x));
    for (let x = W; x >= 0; x -= 10 * u) g.lineTo(x, top(x) + (46 + 22 * Math.sin(x / (60 * u) + band + T * 0.3)) * u);
    g.closePath();
    g.fill();
  }
  g.restore();
}
export function figure(p: Path2D, x: number, gy: number, h: number, k = 0) {
  circle(p, x, gy - h * 0.88, h * 0.1);
  p.moveTo(x - h * 0.13, gy - h * 0.76);
  p.quadraticCurveTo(x, gy - h * 0.82, x + h * 0.13, gy - h * 0.76);
  p.lineTo(x + h * (0.16 + k * 0.04), gy);
  p.lineTo(x - h * 0.16, gy);
  p.closePath();
}

// ---------- Out in the wild ----------

function hills(c: Ctx): Scene {
  const { W, H, u, F, r } = c;
  const far = ridge(c, H * 0.6, 12 * u, 0.7);
  const mid = ridge(c, H * 0.73, 13 * u);
  const near = ridge(c, H * 0.92, 9 * u, 1.3);
  const rows = new Path2D();
  for (let i = 0; i < 8; i++) {
    const x0 = F - 160 * u;
    rows.moveTo(x0, mid.y(x0) + (8 + i * 5.5) * u);
    for (let x = x0; x <= F + 150 * u; x += 10 * u) rows.lineTo(x, mid.y(x) + (8 + i * (5.5 + i * 0.4)) * u);
  }
  const walls = new Path2D();
  const roofs = new Path2D();
  const wins: Win[] = [];
  const hx = F - 40 * u;
  const chim = house(walls, roofs, wins, r, hx, mid.y(hx) + 5 * u, 28 * u, 16 * u);
  house(walls, roofs, wins, r, hx + 34 * u, mid.y(hx + 34 * u) + 5 * u, 30 * u, 22 * u, "steep", false);
  const tree = new Path2D();
  leafy(tree, 0, 0, 78 * u);
  const tx = F + 120 * u;
  const hedge = new Path2D();
  for (let x = F - 230 * u; x < F + 160 * u; x += 7 * u) circle(hedge, x, mid.y(x) + 46 * u + Math.sin(x) * 2 * u, (4 + r() * 3) * u);
  const fence = new Path2D();
  for (let x = F - 260 * u; x < W; x += 15 * u) fence.rect(x, near.y(x) - 13 * u, 1.8 * u, 13 * u);
  for (const k of [9, 4]) {
    fence.moveTo(F - 260 * u, near.y(F - 260 * u) - k * u);
    for (let x = F - 260 * u; x < W; x += 15 * u) fence.lineTo(x, near.y(x) - k * u);
  }
  const flock = motes(c, 5, F - 160 * u, F + 80 * u, H * 0.18, H * 0.32);
  return {
    draw(g, E) {
      fill(g, far.p, tone(E, 0.16, GRASS, 0.45));
      haze(g, E, W, H * 0.5, H * 0.76, 0.35);
      fill(g, mid.p, tone(E, 0.4, GRASS, 0.62));
      stroke(g, rows, tone(E, 0.5, [150, 130, 70], 0.6), 1.3 * u, 0.4);
      fill(g, hedge, tone(E, 0.55, PINE, 0.5));
      fill(g, walls, lit(E, 0.5, [226, 214, 196]));
      fill(g, roofs, tone(E, 0.62, [120, 60, 50], 0.5));
      lights(g, E, wins);
      if (chim) smoke(g, E, chim[0], chim[1], u);
      fill(g, near.p, tone(E, 0.76, GRASS, 0.55));
      sway(g, E, tree, tx, near.y(tx) + 6 * u, tone(E, 0.82, GRASS, 0.4));
      stroke(g, fence, tone(E, 0.85, WOOD, 0.3), 1.4 * u);
      birds(g, E, c, flock);
    },
  };
}

function meadow(c: Ctx): Scene {
  const { W, H, u, F, r } = c;
  const far = ridge(c, H * 0.62, 10 * u, 0.6);
  const treeline = new Path2D();
  for (let x = 0; x < W; x += (9 + r() * 14) * u) leafy(treeline, x, far.y(x) + 4 * u, (16 + r() * 16) * u);
  const mid = ridge(c, H * 0.76, 10 * u, 0.8);
  const near = ridge(c, H * 0.93, 7 * u, 1.2);
  const trunk = new Path2D();
  const bloom = new Path2D();
  const tx = F + 70 * u;
  const ty = mid.y(tx) + 30 * u;
  trunk.moveTo(tx - 5 * u, ty);
  trunk.quadraticCurveTo(tx - 2 * u, ty - 50 * u, tx - 18 * u, ty - 92 * u);
  trunk.lineTo(tx - 12 * u, ty - 94 * u);
  trunk.quadraticCurveTo(tx + 2 * u, ty - 60 * u, tx + 26 * u, ty - 88 * u);
  trunk.lineTo(tx + 30 * u, ty - 84 * u);
  trunk.quadraticCurveTo(tx + 6 * u, ty - 50 * u, tx + 6 * u, ty);
  trunk.closePath();
  for (let i = 0; i < 26; i++) {
    const a = r() * TAU;
    const d = Math.sqrt(r());
    circle(bloom, tx + Math.cos(a) * d * 70 * u, ty - 102 * u + Math.sin(a) * d * 34 * u, (12 + r() * 12) * u);
  }
  const hues: RGB[] = [
    [255, 214, 102],
    [250, 248, 240],
    [236, 140, 176],
    [176, 150, 236],
    [255, 160, 110],
  ];
  const flowers = Array.from({ length: c.mini ? 120 : 240 }, () => {
    const x = r() * W;
    return { x, y: lerp(near.y(x), H, r() * 0.9) + 2 * u, s: (0.9 + r() * 1.6) * u * (0.6 + (x / W) * 0.6), c: hues[(r() * hues.length) | 0]! };
  });
  const petals = motes(c, 18, tx - 80 * u, tx + 200 * u, ty - 120 * u, H);
  const flies = motes(c, 18, F - 200 * u, F + 200 * u, H * 0.7, H * 0.95);
  return {
    draw(g, E) {
      fill(g, far.p, tone(E, 0.16, GRASS, 0.4));
      fill(g, treeline, tone(E, 0.22, PINE, 0.45));
      haze(g, E, W, H * 0.52, H * 0.8, 0.4);
      fill(g, mid.p, tone(E, 0.42, MEADOW, 0.65));
      fill(g, trunk, tone(E, 0.7, WOOD, 0.3));
      fill(g, bloom, mix(tone(E, 0.6, GRASS, 0.3), [244, 184, 204], 0.15 + 0.6 * E.day));
      fill(g, near.p, tone(E, 0.72, MEADOW, 0.6));
      for (const f of flowers) {
        g.fillStyle = rgb(mix(tone(E, 0.7), f.c, 0.2 + 0.7 * E.day), 0.9);
        g.fillRect(f.x, f.y, f.s, f.s);
      }
      if (E.day > 0.3 && !E.still)
        for (const p of petals) {
          const k = (E.T * 0.04 * p.s + p.p) % 1;
          g.fillStyle = rgb([248, 200, 214], 0.7 * E.day);
          g.beginPath();
          g.ellipse(p.x + k * 160 * u * (1 + E.c.wind * 2), lerp(ty - 100 * u, H, k), 2 * u, 1.1 * u, E.T + p.p, 0, TAU);
          g.fill();
        }
      fireflies(g, E, flies, u);
    },
  };
}

function forest(c: Ctx): Scene {
  const { W, H, u, F, r } = c;
  const autumn = r() < 0.35;
  const far = peaks(c, H * 0.55, 60 * u, 0.4, F - 120 * u);
  const rows = [0, 1, 2, 3].map((L) => {
    const base = H * (0.6 + L * 0.11);
    const ground = ridge(c, base + 6 * u, 3 * u);
    const trees = new Path2D();
    const leaves = new Path2D();
    for (let x = -10 * u; x < W + 10 * u; x += (L === 3 ? 34 : 12 + L * 8) * u * (0.6 + r() * 0.8)) {
      if (L === 2 && Math.abs(x - F) < 50 * u) continue;
      const h = (34 + L * 26) * u * (0.7 + r() * 0.5);
      if (autumn && r() < 0.45) leafy(leaves, x, ground.y(x) + 4 * u, h * 0.8);
      else pine(trees, x, ground.y(x) + 4 * u, h);
    }
    return { ground, trees, leaves };
  });
  const walls = new Path2D();
  const roofs = new Path2D();
  const wins: Win[] = [];
  const cy = rows[2]!.ground.y(F) + 6 * u;
  const chim = house(walls, roofs, wins, r, F - 22 * u, cy, 44 * u, 20 * u, "gable");
  const shafts = [0, 1, 2, 3].map(() => F - 200 * u + r() * 380 * u);
  const flies = motes(c, 24, F - 260 * u, F + 220 * u, H * 0.65, H * 0.95);
  const fall: RGB[] = [
    [214, 120, 50],
    [200, 70, 50],
    [226, 170, 60],
  ];
  return {
    draw(g, E) {
      fill(g, far.p, tone(E, 0.12, ROCK, 0.3));
      haze(g, E, W, H * 0.4, H * 0.66, 0.45);
      rows.forEach((row, L) => {
        const t = 0.25 + L * 0.2;
        fill(g, row.ground.p, tone(E, t, PINE, 0.5));
        fill(g, row.trees, tone(E, t, PINE, 0.5));
        if (autumn) fill(g, row.leaves, mix(tone(E, t), fall[L % 3]!, 0.65 * E.day * (1 - L * 0.15)));
        if (L === 2) {
          fill(g, walls, lit(E, 0.6, [150, 110, 80], 0.6));
          fill(g, roofs, tone(E, 0.72, WOOD, 0.4));
          lights(g, E, wins);
          if (chim) smoke(g, E, chim[0], chim[1], u);
          glowAt(g, F, cy - 4 * u, 70 * u, WARM, 0.25 * E.glow);
        }
        if (L < 3) haze(g, E, W, H * (0.56 + L * 0.11), H * (0.7 + L * 0.11), 0.22);
      });
      const sa = E.day * (1 - E.c.cloud) * 0.12;
      if (sa > 0.01)
        for (const sx of shafts) {
          const gr = g.createLinearGradient(sx, 0, sx - 90 * u, H);
          gr.addColorStop(0, rgb([255, 240, 200], sa));
          gr.addColorStop(1, rgb([255, 240, 200], 0));
          g.fillStyle = gr;
          g.beginPath();
          g.moveTo(sx, 0);
          g.lineTo(sx + 24 * u, 0);
          g.lineTo(sx - 60 * u, H);
          g.lineTo(sx - 120 * u, H);
          g.fill();
        }
      fireflies(g, E, flies, u);
    },
  };
}

function jungle(c: Ctx): Scene {
  const { W, H, u, F, r } = c;
  const far = ridge(c, H * 0.58, 22 * u, 1.4);
  const pyr = new Path2D();
  const py = far.y(F) + 8 * u;
  for (let i = 0; i < 6; i++) pyr.rect(F - (60 - i * 9) * u, py - (i + 1) * 13 * u, (120 - i * 18) * u, 13.5 * u);
  pyr.rect(F - 10 * u, py - 92 * u, 20 * u, 14 * u);
  poly(pyr, F - 14 * u, py - 92 * u, F, py - 100 * u, F + 14 * u, py - 92 * u);
  const canopy = (base: number, rr: number) => {
    const p = new Path2D();
    p.rect(0, base, W, H - base);
    for (let x = -rr; x < W + rr; x += rr * (0.7 + r() * 0.6)) circle(p, x, base + (r() - 0.5) * rr * 0.6, rr * (0.7 + r() * 0.6));
    return p;
  };
  const c1 = canopy(H * 0.72, 22 * u);
  const c2 = canopy(H * 0.86, 30 * u);
  const palms = new Path2D();
  for (const [dx, h, l] of [
    [-150, 120, -14],
    [120, 140, 20],
    [190, 110, 10],
  ] as const)
    palm(palms, F + dx * u, H * 0.8, h * u, l * u);
  const fronds = new Path2D();
  for (const [x0, a0] of [
    [W, -2.6],
    [W, -2.1],
    [W - 10 * u, -1.7],
  ] as const) {
    const L = 140 * u;
    const ex = x0 + Math.cos(a0) * L;
    const ey = H + Math.sin(a0) * L;
    fronds.moveTo(x0, H);
    fronds.quadraticCurveTo((x0 + ex) / 2 + 24 * u, (H + ey) / 2 - 10 * u, ex, ey);
    fronds.quadraticCurveTo((x0 + ex) / 2 - 10 * u, (H + ey) / 2 + 20 * u, x0, H);
  }
  const vines = Array.from({ length: 7 }, () => ({ x: F + (40 + r() * 200) * u, l: (60 + r() * 120) * u, p: r() * TAU }));
  const flock = motes(c, 4, F - 100 * u, F + 100 * u, H * 0.2, H * 0.35);
  return {
    draw(g, E) {
      fill(g, far.p, tone(E, 0.18, JUNGLE, 0.45));
      fill(g, pyr, tone(E, 0.24, STONE, 0.4));
      if (E.glow > 0.4) glowAt(g, F, py - 94 * u, 30 * u, [255, 160, 90], 0.6 * E.glow);
      mist(g, E, c, H * 0.62, 0.32);
      fill(g, c1, tone(E, 0.45, JUNGLE, 0.6));
      fill(g, palms, tone(E, 0.6, JUNGLE, 0.5));
      mist(g, E, c, H * 0.78, 0.2);
      fill(g, c2, tone(E, 0.72, JUNGLE, 0.55));
      fill(g, fronds, tone(E, 0.9, JUNGLE, 0.4));
      g.strokeStyle = rgb(tone(E, 0.88, JUNGLE, 0.4));
      g.lineWidth = 2 * u;
      for (const v of vines) {
        const s = E.still ? 0 : Math.sin(E.T * 0.8 + v.p) * 5 * u;
        g.beginPath();
        g.moveTo(v.x, 0);
        g.quadraticCurveTo(v.x + 12 * u + s, v.l * 0.5, v.x + s, v.l);
        g.stroke();
        g.fillStyle = rgb(tone(E, 0.88, JUNGLE, 0.5));
        for (let k = 0.2; k < 1; k += 0.18) {
          g.beginPath();
          g.ellipse(v.x + s * k + 5 * u * Math.sin(k * 9), v.l * k, 4 * u, 2 * u, k * 4, 0, TAU);
          g.fill();
        }
      }
      birds(g, E, c, flock);
    },
  };
}

function swamp(c: Ctx): Scene {
  const { W, H, u, F, r } = c;
  const y0 = H * 0.68;
  const far = ridge(c, H * 0.66, 4 * u);
  const cyp = (p: Path2D, x: number, by: number, h: number) => {
    p.moveTo(x - h * 0.12, by);
    p.quadraticCurveTo(x - h * 0.03, by - h * 0.2, x - h * 0.025, by - h * 0.8);
    p.lineTo(x + h * 0.025, by - h * 0.8);
    p.quadraticCurveTo(x + h * 0.03, by - h * 0.2, x + h * 0.12, by);
    p.closePath();
    for (const [dx, dy, k] of [
      [0, -0.86, 0.22],
      [-0.16, -0.78, 0.16],
      [0.17, -0.8, 0.15],
      [-0.06, -0.97, 0.13],
    ] as const) {
      p.moveTo(x + dx * h - k * h * 1.4, by + dy * h);
      p.ellipse(x + dx * h, by + dy * h, k * h * 1.4, k * h * 0.4, 0, 0, TAU);
    }
  };
  const trees = new Path2D();
  for (let x = 0; x < W; x += (30 + r() * 50) * u) if (Math.abs(x - F) > 40 * u) cyp(trees, x, y0, (50 + r() * 40) * u);
  const big = new Path2D();
  cyp(big, F + 140 * u, H * 0.92, 210 * u);
  const moss = Array.from({ length: 10 }, () => ({ x: F + 140 * u + (r() - 0.5) * 160 * u, y: H * 0.92 - 210 * u * (0.78 + r() * 0.12), l: (20 + r() * 40) * u, p: r() * TAU }));
  const hut = new Path2D();
  const roofs = new Path2D();
  const wins: Win[] = [];
  house(hut, roofs, wins, r, F - 40 * u, y0 - 16 * u, 46 * u, 22 * u, "thatch", false);
  hut.rect(F - 46 * u, y0 - 17 * u, 60 * u, 3 * u);
  for (const dx of [-42, -22, 0, 10]) hut.rect(F + dx * u, y0 - 16 * u, 2 * u, 22 * u);
  const reeds = new Path2D();
  for (let i = 0; i < 70; i++) {
    const x = r() * W;
    const h = (14 + r() * 26) * u;
    const by = H - r() * 16 * u;
    reeds.moveTo(x, by);
    reeds.quadraticCurveTo(x + 2 * u, by - h * 0.6, x + (r() - 0.3) * 8 * u, by - h);
  }
  const pads = Array.from({ length: 14 }, () => ({ x: r() * W, y: lerp(y0 + 20 * u, H, r()), w: (5 + r() * 8) * u }));
  const sh = shims(c, 50);
  const wisps = motes(c, 6, F - 220 * u, F + 220 * u, H * 0.62, H * 0.85);
  return {
    draw(g, E) {
      fill(g, far.p, tone(E, 0.2, PINE, 0.35));
      fill(g, trees, tone(E, 0.3, PINE, 0.4));
      mist(g, E, c, H * 0.6, 0.35);
      water(g, E, c, y0, sh, [70, 96, 70]);
      g.save();
      g.globalAlpha = 0.25;
      g.translate(0, y0 * 2);
      g.scale(1, -1);
      fill(g, trees, tone(E, 0.3, PINE, 0.4));
      g.restore();
      for (const p of pads) {
        g.fillStyle = rgb(tone(E, 0.55, GRASS, 0.6));
        g.beginPath();
        g.ellipse(p.x, p.y, p.w, p.w * 0.3, 0, 0.3, TAU);
        g.fill();
      }
      fill(g, roofs, tone(E, 0.5, [140, 120, 80], 0.4));
      fill(g, hut, tone(E, 0.55, WOOD, 0.35));
      lights(g, E, wins);
      lamp(g, E, F + 12 * u, y0 - 26 * u, 40 * u, 3, WARM, 0.1);
      g.fillStyle = rgb(WARM, 0.25 * E.glow);
      g.fillRect(F + 10 * u, y0 + 4 * u, 4 * u, 40 * u);
      mist(g, E, c, H * 0.74, 0.3);
      fill(g, big, tone(E, 0.82, PINE, 0.3));
      g.strokeStyle = rgb(tone(E, 0.65, [120, 130, 100], 0.5), 0.8);
      g.lineWidth = 1.5 * u;
      for (const m of moss) {
        const s = E.still ? 0 : Math.sin(E.T + m.p) * 3 * u;
        g.beginPath();
        g.moveTo(m.x, m.y);
        g.quadraticCurveTo(m.x + s, m.y + m.l * 0.6, m.x + s * 1.5, m.y + m.l);
        g.stroke();
      }
      stroke(g, reeds, tone(E, 0.86, [100, 120, 60], 0.4), 1.4 * u);
      fireflies(g, E, wisps, u * 1.6, [140, 255, 220], 0.25 * E.glow);
    },
  };
}

function mountains(c: Ctx): Scene {
  const { W, H, u, F, r } = c;
  const lights_ = r() < 0.55;
  const ph = r() * 6;
  const far = peaks(c, H * 0.58, 150 * u, 0.55, F + 30 * u);
  const mid = peaks(c, H * 0.74, 100 * u, 0.6, F - 140 * u);
  const foot = ridge(c, H * 0.88, 14 * u);
  const pines = new Path2D();
  for (let x = 0; x < W; x += (6 + r() * 10) * u) pine(pines, x, foot.y(x) + 6 * u, (14 + r() * 22) * u);
  const walls = new Path2D();
  const roofs = new Path2D();
  const wins: Win[] = [];
  const hx = F + 70 * u;
  const chim = house(walls, roofs, wins, r, hx, mid.y(hx + 10 * u) + 6 * u, 22 * u, 13 * u, "steep");
  const flock = motes(c, 2, F - 60 * u, F + 60 * u, H * 0.2, H * 0.3);
  return {
    draw(g, E) {
      if (lights_) aurora(g, E, c, 0.8, ph);
      fill(g, far.p, tone(E, 0.12, ROCK, 0.35));
      snowcap(g, E, far.p, far.top, far.top + 110 * u);
      haze(g, E, W, H * 0.35, H * 0.62, 0.4);
      fill(g, mid.p, tone(E, 0.38, ROCK, 0.4));
      snowcap(g, E, mid.p, mid.top, mid.top + 55 * u, 0.75);
      fill(g, walls, lit(E, 0.45, [200, 180, 160], 0.5));
      fill(g, roofs, tone(E, 0.5, WOOD, 0.4));
      lights(g, E, wins);
      if (chim) smoke(g, E, chim[0], chim[1], u * 0.8);
      haze(g, E, W, H * 0.6, H * 0.84, 0.3);
      fill(g, foot.p, tone(E, 0.7, PINE, 0.5));
      fill(g, pines, tone(E, 0.74, PINE, 0.5));
      birds(g, E, c, flock);
    },
  };
}

function tundra(c: Ctx): Scene {
  const { W, H, u, F, r } = c;
  const ph = r() * 6;
  const far = peaks(c, H * 0.62, 60 * u, 0.35, F - 160 * u);
  const f1 = ridge(c, H * 0.7, 5 * u, 0.6);
  const f2 = ridge(c, H * 0.86, 6 * u, 0.9);
  const spruce = new Path2D();
  for (let i = 0; i < 18; i++) {
    const x = r() * W;
    pine(spruce, x, f1.y(x) + 4 * u, (10 + r() * 16) * u);
  }
  const tent = new Path2D();
  const ty = f2.y(F) + 4 * u;
  poly(tent, F - 30 * u, ty, F, ty - 34 * u, F + 30 * u, ty);
  const door = new Path2D();
  poly(door, F - 7 * u, ty, F, ty - 22 * u, F + 7 * u, ty);
  const cairn = new Path2D();
  const kx = F + 110 * u;
  const ky = f2.y(kx) + 2 * u;
  for (const [dx, dy, w, h] of [
    [0, 0, 18, 7],
    [1, -7, 14, 6],
    [-1, -13, 11, 6],
    [0, -19, 7, 6],
  ] as const) {
    cairn.moveTo(kx + dx * u + w * u, ky + dy * u);
    cairn.ellipse(kx + dx * u, ky + dy * u, w * u, h * u * 0.6, 0, 0, TAU);
  }
  const sparkle = motes(c, 40, 0, W, H * 0.72, H);
  return {
    draw(g, E) {
      aurora(g, E, c, 1.15, ph);
      fill(g, far.p, snowTone(E, 0.16));
      haze(g, E, W, H * 0.5, H * 0.72, 0.35);
      fill(g, f1.p, snowTone(E, 0.4));
      fill(g, spruce, tone(E, 0.55, PINE, 0.4));
      fill(g, f2.p, snowTone(E, 0.62));
      fill(g, tent, lit(E, 0.7, [200, 100, 70], 0.7));
      if (E.glow > 0.2) fill(g, tent, WARM, 0.55 * E.glow * flick(E, 2));
      fill(g, door, mix(DARK, WARM, E.glow * 0.8));
      glowAt(g, F, ty - 10 * u, 60 * u, WARM, 0.35 * E.glow);
      fill(g, cairn, tone(E, 0.72, STONE, 0.3));
      for (const s of sparkle) {
        const a = Math.max(0, Math.sin(E.T * 2 * s.s + s.p)) * (0.3 + E.day * 0.5);
        g.fillStyle = rgb([255, 255, 255], a);
        g.fillRect(s.x, s.y, 1.2 * u, 1.2 * u);
      }
    },
  };
}

function dunes(c: Ctx, base: number, amp: number, n: number) {
  const { W, H, r } = c;
  const p = new Path2D();
  const lee = new Path2D();
  let x = -W * 0.05;
  let y = base;
  p.moveTo(x, H);
  p.lineTo(x, y);
  const step = W / n;
  const tops: [number, number][] = [];
  while (x < W * 1.05) {
    const cx = x + step * (0.45 + r() * 0.4);
    const cy = base - amp * (0.5 + r() * 0.5);
    const tx = cx + step * (0.18 + r() * 0.15);
    const ty = base + amp * 0.1 * r();
    p.quadraticCurveTo((x + cx) / 2, y - (y - cy) * 0.15, cx, cy);
    p.quadraticCurveTo(cx + (tx - cx) * 0.2, ty, tx, ty);
    lee.moveTo(cx, cy);
    lee.quadraticCurveTo(cx + (tx - cx) * 0.2, ty, tx, ty);
    lee.quadraticCurveTo(cx + (tx - cx) * 0.3, ty - (ty - cy) * 0.15, cx + (tx - cx) * 0.06, cy + (ty - cy) * 0.12);
    lee.closePath();
    tops.push([cx, cy]);
    x = tx;
    y = ty;
  }
  p.lineTo(x, H);
  p.closePath();
  return { p, lee, tops };
}

function desert(c: Ctx): Scene {
  const { W, H, u, F, r } = c;
  const oasis = r() < 0.4;
  const d1 = dunes(c, H * 0.66, 22 * u, 3);
  const d2 = dunes(c, H * 0.8, 30 * u, 2.4);
  const d3 = dunes(c, H * 0.98, 34 * u, 1.8);
  const crest = d2.tops.reduce((a, b) => (Math.abs(b[0] - F) < Math.abs(a[0] - F) ? b : a));
  const van = new Path2D();
  const palms = new Path2D();
  if (oasis) {
    for (const [dx, h, l] of [
      [-30, 70, -10],
      [-8, 90, 6],
      [24, 60, 14],
    ] as const)
      palm(palms, crest[0] + dx * u, crest[1] + 30 * u, h * u, l * u);
  } else
    for (let i = 0; i < 5; i++) {
      const x = crest[0] - 70 * u + i * 26 * u;
      const y = crest[1] + Math.abs(x - crest[0]) * 0.14 + 1 * u;
      const s = u * 0.9;
      van.moveTo(x + 9 * s, y - 13 * s);
      van.ellipse(x, y - 13 * s, 9 * s, 4.5 * s, 0, 0, TAU);
      circle(van, x - 1 * s, y - 17 * s, 4.5 * s);
      poly(van, x + 6 * s, y - 15 * s, x + 12 * s, y - 25 * s, x + 15 * s, y - 24 * s, x + 10 * s, y - 13 * s);
      van.rect(x + 11 * s, y - 27 * s, 6 * s, 3 * s);
      for (const lx of [-6, -3, 4, 7]) van.rect(x + lx * s, y - 10 * s, 1.3 * s, 10 * s);
      if (i % 2) circle(van, x - 2 * s, y - 24 * s, 2.6 * s);
    }
  const sh = shims(c, 20);
  return {
    draw(g, E) {
      const sand = (t: number, k = 0.85) => tone(E, t, SAND, k);
      fill(g, d1.p, sand(0.18, 0.7));
      fill(g, d1.lee, tone(E, 0.32), 0.5);
      haze(g, E, W, H * 0.5, H * 0.74, 0.3);
      fill(g, d2.p, sand(0.42));
      fill(g, d2.lee, tone(E, 0.6, [120, 70, 60], 0.4), 0.55);
      if (oasis) {
        g.save();
        g.beginPath();
        g.ellipse(crest[0], crest[1] + 30 * u, 60 * u, 6 * u, 0, 0, TAU);
        g.clip();
        water(g, E, c, crest[1] + 24 * u, sh, [60, 150, 140], crest[1] + 36 * u);
        g.restore();
        fill(g, palms, tone(E, 0.55, JUNGLE, 0.4));
      } else fill(g, van, tone(E, 0.62, WOOD, 0.2));
      fill(g, d3.p, sand(0.68, 0.8));
      fill(g, d3.lee, tone(E, 0.85, [110, 60, 60], 0.3), 0.55);
      if (E.glow > 0.3) fire(g, E, F + 150 * u, H * 0.93, u);
    },
  };
}

function canyon(c: Ctx): Scene {
  const { W, H, u, F, r } = c;
  const mesa = (p: Path2D, lines: Path2D, x0: number, x1: number, top: number, base: number) => {
    poly(p, x0 - 26 * u, base, x0 - 4 * u, top + 14 * u, x0, top, x1, top, x1 + 5 * u, top + 12 * u, x1 + 30 * u, base);
    for (let y = top + 9 * u; y < base - 6 * u; y += (7 + r() * 6) * u) {
      const k = (y - top) / (base - top);
      lines.moveTo(x0 - 26 * u * k, y);
      lines.lineTo(x1 + 30 * u * k, y);
    }
  };
  const far = new Path2D();
  const farL = new Path2D();
  for (let x = -40 * u; x < W; x += (100 + r() * 140) * u) mesa(far, farL, x, x + (40 + r() * 90) * u, H * (0.42 + r() * 0.12), H * 0.66);
  const plain = ridge(c, H * 0.68, 3 * u, 0.5);
  const mid = new Path2D();
  const midL = new Path2D();
  mesa(mid, midL, F - 70 * u, F + 40 * u, H * 0.28, H * 0.8);
  mesa(mid, midL, F - 230 * u, F - 170 * u, H * 0.45, H * 0.8);
  const floor = ridge(c, H * 0.84, 5 * u);
  const riverP = new Path2D();
  riverP.moveTo(F - 300 * u, H);
  riverP.quadraticCurveTo(F - 40 * u, H * 0.86, F + 120 * u, H * 0.84);
  riverP.lineTo(F + 140 * u, H * 0.845);
  riverP.quadraticCurveTo(F, H * 0.9, F - 200 * u, H);
  riverP.closePath();
  const rim = new Path2D();
  poly(rim, W, H, F + 150 * u, H, F + 160 * u, H * 0.6, F + 190 * u, H * 0.55, F + 196 * u, H * 0.3, F + 240 * u, H * 0.22, W, H * 0.2);
  const rimL = new Path2D();
  for (let y = H * 0.3; y < H; y += 9 * u) {
    rimL.moveTo(F + 180 * u, y);
    rimL.lineTo(W, y);
  }
  const sh = shims(c, 20);
  const flock = motes(c, 2, F - 100 * u, F, H * 0.2, H * 0.3);
  return {
    draw(g, E) {
      fill(g, far, tone(E, 0.2, REDROCK, 0.65));
      stroke(g, farL, tone(E, 0.3, REDROCK, 0.4), 1 * u, 0.25);
      fill(g, plain.p, tone(E, 0.32, [190, 130, 90], 0.6));
      haze(g, E, W, H * 0.45, H * 0.7, 0.3);
      fill(g, mid, tone(E, 0.45, REDROCK, 0.85));
      stroke(g, midL, tone(E, 0.58, [150, 60, 40], 0.6), 1.2 * u, 0.4);
      fill(g, floor.p, tone(E, 0.62, [170, 110, 70], 0.6));
      g.save();
      g.clip(riverP);
      water(g, E, c, H * 0.84, sh, [70, 130, 140]);
      g.restore();
      fill(g, rim, tone(E, 0.86, REDROCK, 0.5));
      g.save();
      g.clip(rim);
      stroke(g, rimL, tone(E, 0.92, [120, 50, 30], 0.5), 1.2 * u, 0.4);
      g.restore();
      birds(g, E, c, flock);
    },
  };
}

function volcano(c: Ctx): Scene {
  const { W, H, u, F, r } = c;
  const back = peaks(c, H * 0.66, 50 * u, 0.4, F - 220 * u);
  const cone = new Path2D();
  const cy = H * 0.32;
  cone.moveTo(F - 320 * u, H);
  cone.quadraticCurveTo(F - 100 * u, H * 0.75, F - 34 * u, cy + 6 * u);
  cone.lineTo(F - 26 * u, cy);
  cone.lineTo(F - 8 * u, cy + 5 * u);
  cone.lineTo(F + 14 * u, cy + 2 * u);
  cone.lineTo(F + 30 * u, cy + 7 * u);
  cone.quadraticCurveTo(F + 110 * u, H * 0.75, F + 340 * u, H);
  cone.closePath();
  const lava = [0, 1, 2].map((i) => {
    const p = new Path2D();
    let x = F + (i - 1) * 16 * u;
    let y = cy + 6 * u;
    p.moveTo(x, y);
    while (y < H) {
      y += 10 * u;
      x += (r() - 0.5 + (i - 1) * 0.7) * 10 * u;
      p.lineTo(x, y);
    }
    return p;
  });
  const near = ridge(c, H * 0.93, 6 * u, 1.4);
  const cracks = new Path2D();
  for (let i = 0; i < 8; i++) {
    let x = r() * W;
    let y = near.y(x) + 6 * u;
    cracks.moveTo(x, y);
    for (let k = 0; k < 5; k++) cracks.lineTo((x += (r() - 0.5) * 22 * u), (y += 5 * u));
  }
  const puffs = Array.from({ length: c.mini ? 10 : 18 }, (_, i) => ({ k: i / 18, p: r() * TAU, s: 0.7 + r() * 0.6 }));
  const embers = motes(c, 24, F - 40 * u, F + 40 * u, cy - 40 * u, cy);
  return {
    draw(g, E) {
      const T = E.still ? 3 : E.T;
      glowAt(g, F, cy, 260 * u, [255, 90, 40], 0.25);
      fill(g, back.p, tone(E, 0.25, ROCK, 0.2));
      for (const pf of puffs) {
        const k = (T * 0.02 * pf.s + pf.k) % 1;
        const x = F + k * 160 * u * (1 + E.c.wind) + Math.sin(k * 6 + pf.p) * 14 * u;
        const y = cy - k * H * 0.4;
        const rr = (16 + k * 60) * u * pf.s;
        const cg = g.createRadialGradient(x, y + rr * 0.6, 0, x, y, rr);
        cg.addColorStop(0, rgb(mix([90, 60, 60], [255, 120, 60], (1 - k) * 0.7), 0.7 * (1 - k * 0.6)));
        cg.addColorStop(1, rgb(mix(tone(E, 0.4), [60, 56, 64], 0.5), 0));
        g.fillStyle = cg;
        g.beginPath();
        g.arc(x, y, rr, 0, TAU);
        g.fill();
      }
      fill(g, cone, tone(E, 0.55, [70, 56, 56], 0.4));
      const pulse = 0.8 + 0.2 * Math.sin(T * 1.3);
      for (const p of lava) {
        stroke(g, p, [255, 90, 30], 7 * u, 0.25 * pulse);
        stroke(g, p, [255, 170, 70], 2 * u, 0.9 * pulse);
      }
      glowAt(g, F, cy + 4 * u, 70 * u, [255, 140, 60], 0.8 * pulse);
      for (const e of embers) {
        const k = (T * 0.25 * e.s + e.p) % 1;
        g.fillStyle = rgb([255, 190, 90], 1 - k);
        g.fillRect(e.x + Math.sin(e.p + k * 4) * 20 * u, e.y - k * 70 * u, 1.6 * u, 1.6 * u);
      }
      fill(g, near.p, tone(E, 0.9, [40, 30, 36], 0.4));
      stroke(g, cracks, [255, 110, 40], 1.4 * u, 0.6 * pulse);
    },
  };
}

function cave(c: Ctx): Scene {
  const { W, H, u, F, r } = c;
  const far = peaks(c, H * 0.62, 70 * u, 0.5, F);
  const near = ridge(c, H * 0.8, 10 * u);
  const win = new Path2D();
  const cx = F - 30 * u;
  const cy = H * 0.5;
  const rx = 150 * u;
  const ry = 112 * u;
  for (let a = 0; a <= TAU + 0.01; a += 0.2) {
    const k = 1 + (r() - 0.5) * 0.14;
    const x = cx + Math.cos(a) * rx * k;
    const y = Math.min(H * 0.86, cy + Math.sin(a) * ry * k);
    if (a === 0) win.moveTo(x, y);
    else win.lineTo(x, y);
  }
  win.closePath();
  const tites = new Path2D();
  for (let i = 0; i < 14; i++) {
    const x = cx + (r() - 0.5) * rx * 1.5;
    const top = cy - ry * Math.sqrt(Math.max(0, 1 - ((x - cx) / rx) ** 2)) - 6 * u;
    poly(tites, x - (3 + r() * 5) * u, top, x, top + (10 + r() * 30) * u, x + (3 + r() * 5) * u, top);
  }
  const crystals = new Path2D();
  const kx = F - 210 * u;
  for (let i = 0; i < 6; i++) {
    const a = -Math.PI / 2 + (r() - 0.5) * 1.2;
    const L = (14 + r() * 26) * u;
    const bx = kx + (r() - 0.5) * 30 * u;
    poly(crystals, bx - 4 * u, H * 0.95, bx + Math.cos(a) * L, H * 0.95 + Math.sin(a) * L, bx + 4 * u, H * 0.95);
  }
  return {
    draw(g, E) {
      fill(g, far.p, tone(E, 0.2, ROCK, 0.35));
      snowcap(g, E, far.p, far.top, far.top + 40 * u, 0.6);
      haze(g, E, W, H * 0.5, H * 0.78, 0.35);
      fill(g, near.p, tone(E, 0.5, GRASS, 0.5));
    },
    room: {
      win,
      draw(g, E) {
        const wall = new Path2D();
        wall.rect(0, 0, W, H);
        wall.addPath(win);
        const rg = g.createRadialGradient(cx, cy, rx * 0.8, cx, cy, W * 0.7);
        rg.addColorStop(0, rgb(mix([46, 38, 46], [96, 84, 86], E.day * 0.6)));
        rg.addColorStop(1, rgb([10, 8, 14]));
        g.fillStyle = rg;
        g.fill(wall, "evenodd");
        fill(g, tites, mix([40, 34, 42], [80, 70, 74], E.day * 0.5));
        glowAt(g, F + 150 * u, H * 0.9, 150 * u, [255, 150, 70], 0.4);
        fire(g, E, F + 150 * u, H * 0.94, u * 1.2);
        fill(g, crystals, [120, 230, 230], 0.75);
        glowAt(g, kx, H * 0.9, 60 * u, [120, 220, 255], 0.35 * flick(E, 5));
      },
    },
  };
}

// ---------- By the water ----------

function shore(c: Ctx): Scene {
  const { W, H, u, F, r } = c;
  const y0 = H * 0.6;
  const sh = shims(c);
  const far = new Path2D();
  far.moveTo(0, y0 + 1);
  far.quadraticCurveTo(F - 300 * u, y0 - 18 * u, F - 180 * u, y0 + 1);
  far.closePath();
  const cliff = new Path2D();
  const top = H * 0.48;
  cliff.moveTo(F - 30 * u, H);
  const edge: number[] = [F - 30 * u, H, F - 20 * u, H * 0.8, F - 6 * u, H * 0.66, F + 10 * u, H * 0.56, F + 30 * u, top + 6 * u];
  for (let x = F + 30 * u; x < W + 20 * u; x += 18 * u) edge.push(x, top + (r() - 0.5) * 6 * u - (x - F) * 0.02);
  edge.push(W + 20 * u, H);
  poly(cliff, ...edge);
  const lx = F + 80 * u;
  const base = top - 2 * u;
  const tall = 110 * u;
  const tower = new Path2D();
  poly(tower, lx - 13 * u, base, lx - 9 * u, base - tall, lx + 9 * u, base - tall, lx + 13 * u, base);
  const stripes = new Path2D();
  for (const [a, b] of [
    [0.18, 0.32],
    [0.52, 0.66],
  ] as const) {
    const w1 = lerp(13, 9, a) * u;
    const w2 = lerp(13, 9, b) * u;
    poly(stripes, lx - w1, base - tall * a, lx - w2, base - tall * b, lx + w2, base - tall * b, lx + w1, base - tall * a);
  }
  const cap = new Path2D();
  cap.rect(lx - 14 * u, base - tall - 2 * u, 28 * u, 3 * u);
  poly(cap, lx - 11 * u, base - tall - 16 * u, lx, base - tall - 26 * u, lx + 11 * u, base - tall - 16 * u);
  const walls = new Path2D();
  const roofs = new Path2D();
  const wins: Win[] = [];
  house(walls, roofs, wins, r, lx + 22 * u, base + 2 * u, 34 * u, 16 * u);
  const rocks = Array.from({ length: 5 }, () => ({ x: F - 200 * u + r() * 160 * u, w: (8 + r() * 14) * u, p: r() * TAU }));
  const flock = motes(c, 4, F - 200 * u, F, H * 0.2, H * 0.4);
  return {
    draw(g, E) {
      water(g, E, c, y0, sh);
      fill(g, far, tone(E, 0.2, GRASS, 0.3));
      for (const k of rocks) {
        const y = H * 0.82 + (k.x % 30) * 0.3;
        g.fillStyle = rgb(tone(E, 0.8, ROCK, 0.3));
        g.beginPath();
        g.ellipse(k.x, y, k.w, k.w * 0.55, 0, Math.PI, TAU);
        g.fill();
        const s = (Math.sin(E.T * 1.2 + k.p) + 1) / 2;
        g.strokeStyle = rgb([240, 244, 255], 0.35 + 0.35 * s);
        g.lineWidth = 1.4 * u;
        g.beginPath();
        g.ellipse(k.x, y, k.w * (1.15 + s * 0.3), k.w * 0.2, 0, 0, Math.PI);
        g.stroke();
      }
      fill(g, cliff, tone(E, 0.78, [90, 110, 70], 0.4));
      const surf = (Math.sin(E.T * 1.1) + 1) / 2;
      g.strokeStyle = rgb([240, 244, 255], 0.3 + surf * 0.3);
      g.lineWidth = 2 * u;
      g.beginPath();
      g.moveTo(F - 40 * u - surf * 8 * u, H);
      g.quadraticCurveTo(F - 30 * u, H * 0.85, F - 10 * u - surf * 6 * u, H * 0.68);
      g.stroke();
      fill(g, walls, lit(E, 0.7, [236, 230, 222]));
      fill(g, roofs, tone(E, 0.8, [160, 60, 60], 0.5));
      lights(g, E, wins);
      fill(g, tower, lit(E, 0.75, [236, 232, 226], 0.85));
      fill(g, stripes, lit(E, 0.75, [196, 64, 76], 0.85));
      fill(g, cap, tone(E, 0.85));
      const ly = base - tall - 9 * u;
      g.fillStyle = rgb(mix(tone(E, 0.8), [255, 240, 200], E.glow));
      g.fillRect(lx - 8 * u, base - tall - 15 * u, 16 * u, 12 * u);
      if (E.glow > 0.05) {
        glowAt(g, lx, ly, 50 * u, [255, 236, 190], 0.7 * E.glow);
        const ang = E.still ? 0.6 : E.T * 0.75;
        const L = Math.cos(ang) * W;
        const spread = (10 + 16 * Math.abs(Math.sin(ang))) * u;
        const a = E.glow * (0.25 + 0.45 * Math.abs(Math.cos(ang))) * (1 + E.c.fog * 0.9) * 0.6;
        const bg = g.createLinearGradient(lx, ly, lx + L, ly);
        bg.addColorStop(0, rgb([255, 240, 200], a));
        bg.addColorStop(1, rgb([255, 240, 200], 0));
        g.fillStyle = bg;
        g.beginPath();
        g.moveTo(lx, ly - 2 * u);
        g.lineTo(lx + L, ly - spread);
        g.lineTo(lx + L, ly + spread * 0.8);
        g.lineTo(lx, ly + 2 * u);
        g.fill();
      }
      birds(g, E, c, flock);
    },
  };
}

function beach(c: Ctx): Scene {
  const { W, H, u, F, r } = c;
  const y0 = H * 0.58;
  const sh = shims(c);
  const isle = new Path2D();
  isle.moveTo(F - 220 * u, y0 + 1);
  isle.quadraticCurveTo(F - 170 * u, y0 - 22 * u, F - 110 * u, y0 + 1);
  isle.closePath();
  palm(isle, F - 170 * u, y0 - 12 * u, 34 * u, 6 * u);
  palm(isle, F - 150 * u, y0 - 8 * u, 26 * u, -4 * u);
  const sand = ridge(c, H * 0.84, 5 * u, 0.6);
  const palms = new Path2D();
  palm(palms, F + 100 * u, H * 0.9, 190 * u, -60 * u);
  palm(palms, F + 160 * u, H * 0.95, 150 * u, -20 * u);
  palm(palms, F + 40 * u, H * 0.88, 110 * u, -36 * u);
  const boat = new Path2D();
  const bx = F - 90 * u;
  poly(boat, -20 * u, 0, 20 * u, 0, 15 * u, 7 * u, -16 * u, 7 * u);
  boat.rect(-1 * u, -38 * u, 2 * u, 38 * u);
  poly(boat, 2 * u, -36 * u, 22 * u, -4 * u, 2 * u, -4 * u);
  const foamPh = r() * TAU;
  const dry = ridge(c, H * 0.9, 4 * u, 0.5);
  return {
    draw(g, E) {
      water(g, E, c, y0, sh, [60, 190, 200]);
      fill(g, isle, tone(E, 0.3, JUNGLE, 0.4));
      g.save();
      g.translate(bx, H * 0.7 + (E.still ? 0 : Math.sin(E.T * 1.3) * 2 * u));
      g.rotate(E.still ? 0 : Math.sin(E.T) * 0.03);
      fill(g, boat, tone(E, 0.7, WOOD, 0.3));
      g.restore();
      const k = E.still ? 0.5 : (Math.sin(E.T * 0.7 + foamPh) + 1) / 2;
      g.fillStyle = rgb(tone(E, 0.5, [200, 170, 120], 0.6));
      g.fill(sand.p);
      g.save();
      g.translate(0, -k * 6 * u);
      g.fillStyle = rgb(mix(tone(E, 0.35, [120, 200, 200], 0.5), [240, 248, 255], 0.3), 0.55);
      g.fill(sand.p);
      g.restore();
      g.strokeStyle = rgb([248, 250, 255], 0.5 + 0.3 * E.day);
      g.lineWidth = 1.6 * u;
      g.beginPath();
      for (let x = 0; x <= W; x += 6 * u) {
        const y = sand.y(x) - k * 6 * u + Math.sin(x / (14 * u) + E.T) * 1.2 * u;
        if (x === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();
      fill(g, dry.p, tone(E, 0.55, SAND, 0.85));
      sway(g, E, palms, 0, 0, tone(E, 0.86, JUNGLE, 0.35), 0.3);
    },
  };
}

function ship(p: Path2D, sails: Path2D, s: number, furled = false) {
  p.moveTo(-60 * s, -8 * s);
  p.quadraticCurveTo(-58 * s, 10 * s, -40 * s, 12 * s);
  p.lineTo(46 * s, 12 * s);
  p.quadraticCurveTo(62 * s, 4 * s, 70 * s, -10 * s);
  p.lineTo(52 * s, -6 * s);
  p.lineTo(-50 * s, -6 * s);
  p.lineTo(-56 * s, -16 * s);
  p.closePath();
  p.moveTo(68 * s, -9 * s);
  p.lineTo(98 * s, -26 * s);
  p.lineTo(99 * s, -24 * s);
  p.closePath();
  for (const [mx, mh] of [
    [-32, 100],
    [6, 124],
    [40, 96],
  ] as const) {
    p.rect((mx - 1) * s, -6 * s - mh * s, 2.4 * s, mh * s);
    poly(p, (mx + 1) * s, -6 * s - mh * s, (mx + 14) * s, (-2 - mh) * s, (mx + 1) * s, (2 - mh) * s);
    for (let k = 0; k < 3; k++) {
      const y = -6 * s - mh * s * (0.88 - k * 0.3);
      const w = (24 - k * 5) * s;
      if (furled) sails.rect(mx * s - w, y, w * 2, 3 * s);
      else {
        sails.moveTo(mx * s - w, y);
        sails.lineTo(mx * s + w, y);
        sails.quadraticCurveTo(mx * s + w + 6 * s, y + mh * s * 0.14, mx * s + w * 0.9, y + mh * s * 0.26);
        sails.lineTo(mx * s - w * 0.9, y + mh * s * 0.26);
        sails.quadraticCurveTo(mx * s - w + 4 * s, y + mh * s * 0.14, mx * s - w, y);
      }
    }
  }
  sails.moveTo(66 * s, -10 * s);
  sails.lineTo(96 * s, -24 * s);
  sails.lineTo(42 * s, -90 * s);
  sails.closePath();
}

function harbor(c: Ctx): Scene {
  const { W, H, u, F, r } = c;
  const y0 = H * 0.68;
  const sh = shims(c);
  const hill = new Path2D();
  const hy = (x: number) => H * 0.5 + ((x - (F - 300 * u)) / (260 * u)) ** 2 * H * 0.08;
  hill.moveTo(0, H);
  hill.lineTo(0, hy(0));
  for (let x = 0; x <= F - 20 * u; x += 8 * u) hill.lineTo(x, Math.min(y0, hy(x)));
  hill.lineTo(F - 20 * u, y0);
  hill.lineTo(0, y0);
  hill.closePath();
  const walls = new Path2D();
  const roofs = new Path2D();
  const wins: Win[] = [];
  const chims: [number, number][] = [];
  for (let x = 0; x < F - 40 * u; x += (16 + r() * 8) * u) {
    const w = (14 + r() * 8) * u;
    const ch = house(walls, roofs, wins, r, x, Math.min(y0, hy(x)) + 6 * u, w, (12 + r() * 14) * u, r() < 0.3 ? "steep" : "gable", r() < 0.3);
    if (ch) chims.push(ch);
  }
  const quay = new Path2D();
  quay.rect(F - 200 * u, y0, 230 * u, 7 * u);
  for (let x = F - 196 * u; x < F + 30 * u; x += 20 * u) quay.rect(x, y0 + 7 * u, 3 * u, 22 * u);
  const ships = [F + 70 * u, F + 230 * u].map((x, i) => {
    const p = new Path2D();
    const sl = new Path2D();
    ship(p, sl, u * (i ? 0.75 : 0.95), true);
    return { x, p, sl, k: i };
  });
  const posts = [F - 160 * u, F - 60 * u, F + 20 * u];
  return {
    draw(g, E) {
      water(g, E, c, y0, sh);
      fill(g, hill, tone(E, 0.4, GRASS, 0.4));
      fill(g, walls, lit(E, 0.5, PLASTER[0]!, 0.6));
      fill(g, roofs, tone(E, 0.62, [150, 70, 60], 0.45));
      lights(g, E, wins);
      for (const ch of chims) smoke(g, E, ch[0], ch[1], u * 0.6);
      fill(g, quay, tone(E, 0.72, STONE, 0.3));
      for (const x of posts) {
        g.fillStyle = rgb(tone(E, 0.8));
        g.fillRect(x, y0 - 22 * u, 2 * u, 22 * u);
        lamp(g, E, x + 1 * u, y0 - 24 * u, 30 * u, x, WARM, 0);
        g.fillStyle = rgb(WARM, 0.18 * E.glow);
        g.fillRect(x - 1 * u, y0 + 8 * u, 4 * u, 50 * u);
      }
      for (const s of ships) {
        const bob = E.still ? 0 : Math.sin(E.T * 1.2 + s.k * 2) * (1.5 + E.c.wind * 4) * u;
        const tilt = E.still ? 0 : Math.sin(E.T * 0.9 + s.k) * 0.02 * (1 + E.c.wind * 3);
        g.save();
        g.translate(s.x, H * (0.8 + s.k * 0.08) + bob);
        g.save();
        g.scale(1, -0.6);
        g.globalAlpha = 0.18;
        fill(g, s.p, tone(E, 0.8));
        g.restore();
        g.rotate(tilt);
        fill(g, s.sl, lit(E, 0.75, [230, 222, 206], 0.7));
        fill(g, s.p, tone(E, 0.85, WOOD, 0.3));
        lamp(g, E, -56 * u, -22 * u, 26 * u, s.k * 7, WARM, 0);
        g.restore();
      }
    },
  };
}

function sea(c: Ctx): Scene {
  const { W, H, u, F, r } = c;
  const y0 = H * 0.55;
  const sh = shims(c);
  const p = new Path2D();
  const sl = new Path2D();
  ship(p, sl, u * 1.15);
  const p2 = new Path2D();
  const sl2 = new Path2D();
  ship(p2, sl2, u * 0.35);
  const second = r() < 0.6;
  const rows = Array.from({ length: 8 }, (_, i) => ({ y: y0 + (i + 1) ** 1.6 * 3.2 * u, a: (2 + i * 1.3) * u, l: (40 + i * 18) * u, p: r() * TAU }));
  const flock = motes(c, 3, F - 120 * u, F + 40 * u, H * 0.18, H * 0.3);
  return {
    draw(g, E) {
      water(g, E, c, y0, sh);
      if (second) {
        g.save();
        g.translate(F - 220 * u, y0 + 4 * u);
        fill(g, sl2, tone(E, 0.3), 0.8);
        fill(g, p2, tone(E, 0.35));
        g.restore();
      }
      const big = 1 + E.c.storm * 1.8 + E.c.wind * 0.8;
      const T = E.still ? 0 : E.T;
      rows.forEach((w, i) => {
        if (i === 5) {
          const bob = Math.sin(T * 1.1) * 3 * u * big;
          g.save();
          g.translate(F, H * 0.765 + bob);
          g.rotate(Math.sin(T * 0.8) * 0.03 * big);
          fill(g, sl, lit(E, 0.65, [236, 228, 210], 0.85));
          fill(g, p, tone(E, 0.85, WOOD, 0.35));
          lamp(g, E, -54 * u, -22 * u, 30 * u, 1, WARM, 0);
          g.restore();
        }
        g.fillStyle = rgb(mix(E.sky.bot, DARK, 0.3 + i * 0.07), 0.55);
        g.strokeStyle = rgb(mix(E.sky.bot, [240, 246, 255], 0.35 + E.day * 0.3), 0.35);
        g.lineWidth = Math.max(1, (0.6 + i * 0.2) * u);
        g.beginPath();
        g.moveTo(0, w.y + w.a * big);
        for (let x = 0; x <= W; x += 8 * u) g.lineTo(x, w.y + Math.sin(x / w.l + T * (0.8 + i * 0.1) + w.p) * w.a * big);
        g.lineTo(W, H);
        g.lineTo(0, H);
        g.closePath();
        g.fill();
        g.stroke();
      });
      birds(g, E, c, flock);
    },
  };
}

function lake(c: Ctx): Scene {
  const { W, H, u, F, r } = c;
  const y0 = H * 0.64;
  const sh = shims(c, 70);
  const mts = peaks(c, y0 - 4 * u, 120 * u, 0.5, F - 60 * u);
  const shore_ = new Path2D();
  shore_.rect(0, y0 - 6 * u, W, 7 * u);
  for (let x = 0; x < W; x += (5 + r() * 8) * u) pine(shore_, x, y0, (10 + r() * 18) * u);
  const dock = new Path2D();
  poly(dock, F + 30 * u, H * 0.76, F + 60 * u, H * 0.76, W, H * 0.98, W, H, F + 200 * u, H);
  for (const k of [0, 0.3, 0.6]) dock.rect(F + 40 * u + k * 260 * u, H * 0.76 + k * 60 * u, 3 * u, 20 * u + k * 30 * u);
  dock.rect(F + 40 * u, H * 0.76 - 26 * u, 2.5 * u, 26 * u);
  const boat = new Path2D();
  poly(boat, -24 * u, 0, 24 * u, 0, 18 * u, 6 * u, -18 * u, 6 * u);
  return {
    draw(g, E) {
      fill(g, mts.p, tone(E, 0.15, ROCK, 0.35));
      snowcap(g, E, mts.p, mts.top, mts.top + 80 * u);
      haze(g, E, W, H * 0.4, y0, 0.35);
      fill(g, shore_, tone(E, 0.4, PINE, 0.45));
      water(g, E, c, y0, sh);
      g.save();
      g.beginPath();
      g.rect(0, y0, W, H - y0);
      g.clip();
      g.translate(0, y0 * 2);
      g.scale(1, -1);
      g.globalAlpha = 0.32 * (1 - E.c.wind * 0.6) * (1 - E.c.rain * 0.5);
      fill(g, mts.p, tone(E, 0.15, ROCK, 0.35));
      snowcap(g, E, mts.p, mts.top, mts.top + 80 * u);
      fill(g, shore_, tone(E, 0.4, PINE, 0.45));
      g.restore();
      mist(g, E, c, y0 + 4 * u, 0.25);
      g.save();
      g.translate(F - 70 * u, H * 0.84 + (E.still ? 0 : Math.sin(E.T) * 1.5 * u));
      fill(g, boat, tone(E, 0.75, WOOD, 0.35));
      g.restore();
      fill(g, dock, tone(E, 0.8, WOOD, 0.4));
      lamp(g, E, F + 41 * u, H * 0.76 - 28 * u, 36 * u, 2, WARM, 0);
      g.fillStyle = rgb(WARM, 0.2 * E.glow);
      g.fillRect(F + 39 * u, H * 0.78, 5 * u, 60 * u);
    },
  };
}

function river(c: Ctx): Scene {
  const { W, H, u, F, r } = c;
  const far = ridge(c, H * 0.6, 10 * u, 0.8);
  const trees = new Path2D();
  for (let x = 0; x < W; x += (10 + r() * 14) * u) leafy(trees, x, far.y(x) + 4 * u, (14 + r() * 16) * u);
  const bank = ridge(c, H * 0.7, 4 * u);
  const riv = new Path2D();
  const rx = F - 30 * u;
  riv.moveTo(rx - 12 * u, H * 0.66);
  riv.lineTo(rx + 12 * u, H * 0.66);
  riv.quadraticCurveTo(rx + 70 * u, H * 0.8, rx + 160 * u, H);
  riv.lineTo(rx - 220 * u, H);
  riv.quadraticCurveTo(rx - 40 * u, H * 0.8, rx - 12 * u, H * 0.66);
  riv.closePath();
  const by = H * 0.68;
  const bridge = new Path2D();
  bridge.rect(rx - 130 * u, by - 26 * u, 260 * u, 12 * u);
  poly(bridge, rx - 130 * u, by - 26 * u, rx - 170 * u, by - 6 * u, rx - 130 * u, by - 14 * u);
  poly(bridge, rx + 130 * u, by - 26 * u, rx + 170 * u, by - 6 * u, rx + 130 * u, by - 14 * u);
  bridge.rect(rx - 130 * u, by - 32 * u, 260 * u, 3 * u);
  for (const dx of [-130, -40, 40, 120]) bridge.rect(rx + dx * u, by - 16 * u, 10 * u, 22 * u);
  const arch = new Path2D();
  arch.rect(rx - 130 * u, by - 14 * u, 260 * u, 24 * u);
  for (const dx of [-85, 0, 80]) {
    arch.moveTo(rx + dx * u + 38 * u, by + 10 * u);
    arch.arc(rx + dx * u, by + 10 * u, 38 * u, 0, Math.PI, true);
    arch.closePath();
  }
  const sh = shims(c, 60);
  const willow = new Path2D();
  const wx = F + 160 * u;
  willow.moveTo(wx - 5 * u, H * 0.92);
  willow.quadraticCurveTo(wx, H * 0.6, wx - 10 * u, H * 0.35);
  willow.lineTo(wx, H * 0.35);
  willow.quadraticCurveTo(wx + 8 * u, H * 0.6, wx + 6 * u, H * 0.92);
  willow.closePath();
  circle(willow, wx, H * 0.33, 40 * u);
  circle(willow, wx - 35 * u, H * 0.38, 30 * u);
  circle(willow, wx + 35 * u, H * 0.4, 30 * u);
  const strands = Array.from({ length: 26 }, () => ({ x: wx + (r() - 0.5) * 140 * u, y: H * (0.33 + r() * 0.1), l: (60 + r() * 90) * u, p: r() * TAU }));
  const reeds = new Path2D();
  for (let i = 0; i < 30; i++) {
    const x = rx - 200 * u + r() * 60 * u;
    const h = (14 + r() * 24) * u;
    reeds.moveTo(x, H);
    reeds.quadraticCurveTo(x + 3 * u, H - h * 0.6, x + (r() - 0.5) * 8 * u, H - h);
  }
  return {
    draw(g, E) {
      fill(g, far.p, tone(E, 0.18, GRASS, 0.4));
      fill(g, trees, tone(E, 0.25, PINE, 0.4));
      haze(g, E, W, H * 0.5, H * 0.7, 0.35);
      fill(g, bank.p, tone(E, 0.5, GRASS, 0.55));
      g.save();
      g.clip(riv);
      water(g, E, c, H * 0.66, sh);
      g.translate(0, by * 2 + 20 * u);
      g.scale(1, -1);
      g.globalAlpha = 0.25;
      fill(g, bridge, tone(E, 0.6));
      g.restore();
      g.save();
      g.fillStyle = rgb(lit(E, 0.6, STONE, 0.6));
      g.fill(arch, "evenodd");
      g.restore();
      fill(g, bridge, lit(E, 0.62, STONE, 0.55));
      lamp(g, E, rx - 4 * u, by - 42 * u, 40 * u, 4, WARM, 0);
      g.fillStyle = rgb(tone(E, 0.7));
      g.fillRect(rx - 5 * u, by - 40 * u, 2 * u, 9 * u);
      fill(g, willow, tone(E, 0.8, GRASS, 0.4));
      g.strokeStyle = rgb(tone(E, 0.78, [120, 150, 80], 0.5), 0.85);
      g.lineWidth = 1.6 * u;
      for (const s of strands) {
        const sw = E.still ? 0 : Math.sin(E.T * 1.2 + s.p) * (2 + E.c.wind * 10) * u;
        g.beginPath();
        g.moveTo(s.x, s.y);
        g.quadraticCurveTo(s.x + sw * 0.5, s.y + s.l * 0.5, s.x + sw, s.y + s.l);
        g.stroke();
      }
      stroke(g, reeds, tone(E, 0.86, [100, 120, 60], 0.4), 1.4 * u);
    },
  };
}

// ---------- Where people live ----------

function village(c: Ctx): Scene {
  const { W, H, u, F, r } = c;
  const far = ridge(c, H * 0.58, 12 * u, 0.7);
  const mid = ridge(c, H * 0.76, 8 * u, 0.6);
  const near = ridge(c, H * 0.93, 5 * u);
  const church = new Path2D();
  const cx = F + 130 * u;
  const cy = far.y(cx) + 6 * u;
  church.rect(cx - 30 * u, cy - 22 * u, 44 * u, 22 * u);
  poly(church, cx - 33 * u, cy - 22 * u, cx - 8 * u, cy - 38 * u, cx + 17 * u, cy - 22 * u);
  church.rect(cx + 14 * u, cy - 50 * u, 14 * u, 50 * u);
  poly(church, cx + 12 * u, cy - 50 * u, cx + 21 * u, cy - 88 * u, cx + 30 * u, cy - 50 * u);
  const walls = new Path2D();
  const roofs = new Path2D();
  const wins: Win[] = [];
  const chims: [number, number][] = [];
  const trees = new Path2D();
  for (let i = 0; i < 9; i++) {
    const x = F - 250 * u + i * 44 * u + r() * 12 * u;
    if (r() < 0.25) {
      leafy(trees, x + 14 * u, mid.y(x) + 8 * u, (40 + r() * 20) * u);
      continue;
    }
    const ch = house(walls, roofs, wins, r, x, mid.y(x) + 10 * u, (30 + r() * 12) * u, (16 + r() * 8) * u, r() < 0.5 ? "thatch" : "gable");
    if (ch) chims.push(ch);
  }
  const wallP = new Path2D();
  for (let x = 0; x < W; x += 9 * u) {
    wallP.moveTo(x + 6 * u, near.y(x) - 4 * u);
    wallP.ellipse(x, near.y(x) - 4 * u, 6 * u, 4 * u, 0, 0, TAU);
  }
  const path = new Path2D();
  path.moveTo(F - 40 * u, mid.y(F) + 14 * u);
  path.quadraticCurveTo(F - 10 * u, H * 0.88, F - 120 * u, H);
  path.lineTo(F - 40 * u, H);
  path.quadraticCurveTo(F + 10 * u, H * 0.88, F - 30 * u, mid.y(F) + 14 * u);
  path.closePath();
  const flock = motes(c, 4, F - 120 * u, F + 120 * u, H * 0.15, H * 0.3);
  return {
    draw(g, E) {
      fill(g, far.p, tone(E, 0.18, GRASS, 0.5));
      fill(g, church, lit(E, 0.28, STONE, 0.5));
      if (E.glow > 0.3) glowAt(g, cx - 8 * u, cy - 12 * u, 24 * u, WARM, 0.5 * E.glow);
      haze(g, E, W, H * 0.5, H * 0.78, 0.3);
      fill(g, mid.p, tone(E, 0.42, MEADOW, 0.6));
      fill(g, trees, tone(E, 0.55, GRASS, 0.45));
      fill(g, walls, lit(E, 0.55, [232, 220, 196]));
      fill(g, roofs, tone(E, 0.6, [150, 120, 70], 0.55));
      lights(g, E, wins);
      for (const ch of chims) smoke(g, E, ch[0], ch[1], u * 0.8);
      fill(g, near.p, tone(E, 0.74, GRASS, 0.55));
      fill(g, path, tone(E, 0.6, [196, 170, 130], 0.6));
      fill(g, wallP, lit(E, 0.82, STONE, 0.35));
      birds(g, E, c, flock);
    },
  };
}

function road(c: Ctx): Scene {
  const { W, H, u, F, r } = c;
  const mts = peaks(c, H * 0.52, 70 * u, 0.4, F + 120 * u);
  const far = ridge(c, H * 0.62, 10 * u, 0.7);
  const town: Win[] = [];
  for (let i = 0; i < 14; i++) town.push({ x: F - 160 * u + r() * 80 * u, y: far.y(F - 120 * u) - r() * 10 * u, w: 1.6 * u, h: 1.6 * u, lit: r() * 0.8, f: 0 });
  const ground = ridge(c, H * 0.7, 6 * u, 0.6);
  const vx = F + 30 * u;
  const vy = H * 0.66;
  const rd = new Path2D();
  rd.moveTo(vx - 3 * u, vy);
  rd.quadraticCurveTo(vx - 120 * u, H * 0.78, vx - 60 * u, H * 0.86);
  rd.quadraticCurveTo(vx + 20 * u, H * 0.94, vx - 80 * u, H);
  rd.lineTo(vx + 140 * u, H);
  rd.quadraticCurveTo(vx + 100 * u, H * 0.92, vx + 10 * u, H * 0.84);
  rd.quadraticCurveTo(vx - 70 * u, H * 0.76, vx + 3 * u, vy);
  rd.closePath();
  const trees = new Path2D();
  for (const [dx, h] of [
    [-260, 90],
    [-200, 60],
    [170, 120],
    [230, 80],
    [-120, 40],
    [110, 46],
  ] as const)
    leafy(trees, F + dx * u, ground.y(F + dx * u) + (h > 70 ? 70 : 20) * u, h * u);
  const wag = new Path2D();
  const cover = new Path2D();
  const wx = vx - 40 * u;
  const wy = H * 0.84;
  wag.rect(wx - 22 * u, wy - 14 * u, 44 * u, 6 * u);
  for (const dx of [-14, 14]) {
    wag.moveTo(wx + dx * u + 7 * u, wy - 4 * u);
    wag.arc(wx + dx * u, wy - 4 * u, 7 * u, 0, TAU);
  }
  cover.moveTo(wx - 22 * u, wy - 14 * u);
  cover.bezierCurveTo(wx - 24 * u, wy - 44 * u, wx + 24 * u, wy - 44 * u, wx + 22 * u, wy - 14 * u);
  cover.closePath();
  wag.moveTo(wx + 34 * u + 12 * u, wy - 20 * u);
  wag.ellipse(wx + 34 * u, wy - 20 * u, 12 * u, 6 * u, 0, 0, TAU);
  poly(wag, wx + 42 * u, wy - 24 * u, wx + 52 * u, wy - 36 * u, wx + 57 * u, wy - 34 * u, wx + 48 * u, wy - 20 * u);
  for (const lx of [26, 30, 38, 42]) wag.rect(wx + lx * u, wy - 16 * u, 1.6 * u, 16 * u);
  wag.rect(wx + 22 * u, wy - 13 * u, 14 * u, 1.5 * u);
  const sign = new Path2D();
  const sx = F + 150 * u;
  sign.rect(sx, H * 0.6, 3 * u, H * 0.32);
  poly(sign, sx - 34 * u, H * 0.62, sx + 2 * u, H * 0.62, sx + 2 * u, H * 0.66, sx - 34 * u, H * 0.66, sx - 40 * u, H * 0.64);
  poly(sign, sx + 1 * u, H * 0.68, sx + 36 * u, H * 0.68, sx + 42 * u, H * 0.70, sx + 36 * u, H * 0.72, sx + 1 * u, H * 0.72);
  const flock = motes(c, 3, F - 100 * u, F + 60 * u, H * 0.18, H * 0.3);
  return {
    draw(g, E) {
      fill(g, mts.p, tone(E, 0.1, ROCK, 0.3));
      snowcap(g, E, mts.p, mts.top, mts.top + 40 * u, 0.6);
      haze(g, E, W, H * 0.35, H * 0.62, 0.4);
      fill(g, far.p, tone(E, 0.25, GRASS, 0.45));
      lights(g, E, town);
      fill(g, ground.p, tone(E, 0.55, MEADOW, 0.6));
      fill(g, rd, tone(E, 0.55, [196, 160, 120], 0.6));
      fill(g, trees, tone(E, 0.7, GRASS, 0.45));
      fill(g, cover, lit(E, 0.65, [236, 226, 204], 0.8));
      fill(g, wag, tone(E, 0.82, WOOD, 0.3));
      lamp(g, E, wx + 24 * u, wy - 30 * u, 30 * u, 6, WARM, 0);
      fill(g, sign, tone(E, 0.85, WOOD, 0.45));
      birds(g, E, c, flock);
    },
  };
}

interface Facade {
  walls: Path2D;
  roofs: Path2D;
  trim: Path2D;
  wins: Win[];
  hues: { p: Path2D; c: RGB }[];
}
function facades(c: Ctx, gy: number, hmin: number, hmax: number, scale = 1): Facade {
  const { W, u, r } = c;
  const roofs = new Path2D();
  const walls = new Path2D();
  const trim = new Path2D();
  const wins: Win[] = [];
  const hues = PLASTER.map((col) => ({ p: new Path2D(), c: col }));
  for (let x = -10 * u; x < W; ) {
    const w = (44 + r() * 34) * u * scale;
    const h = (hmin + r() * (hmax - hmin)) * u * scale;
    const hp = hues[(r() * hues.length) | 0]!;
    hp.p.rect(x, gy - h, w - 1.5 * u, h);
    const style = r();
    if (style < 0.4) poly(roofs, x - 2 * u, gy - h, x + w / 2, gy - h - w * 0.6, x + w + 0.5 * u, gy - h);
    else if (style < 0.7) {
      const s = w / 5;
      poly(roofs, x, gy - h, x, gy - h - s, x + s, gy - h - s, x + s, gy - h - 2 * s, x + 2 * s, gy - h - 2 * s, x + 2 * s, gy - h - 3 * s, x + 3 * s, gy - h - 3 * s, x + 3 * s, gy - h - 2 * s, x + 4 * s, gy - h - 2 * s, x + 4 * s, gy - h - s, x + w - 1.5 * u, gy - h - s, x + w - 1.5 * u, gy - h);
    } else roofs.rect(x - 2 * u, gy - h - 5 * u, w + 2 * u, 5 * u);
    if (r() < 0.4)
      for (let k = 0; k < 3; k++) {
        trim.moveTo(x, gy - h + (h * (k + 1)) / 3.5);
        trim.lineTo(x + w - 1.5 * u, gy - h + (h * (k + 1)) / 3.5);
        trim.moveTo(x + (w * (k + 0.5)) / 3, gy - h);
        trim.lineTo(x + (w * (k + 1)) / 3, gy - h + h * 0.6);
      }
    const cols = Math.max(2, Math.round(w / (16 * u * scale)));
    for (let row = 0; row < Math.floor(h / (24 * u * scale)) - 1; row++)
      for (let k = 0; k < cols; k++) wins.push({ x: x + (w * (k + 0.5)) / cols - 3 * u * scale, y: gy - h + (10 + row * 24) * u * scale, w: 6 * u * scale, h: 10 * u * scale, lit: r(), f: r() * 50 });
    walls.rect(x + w / 2 - 6 * u * scale, gy - 18 * u * scale, 12 * u * scale, 18 * u * scale);
    x += w;
  }
  return { walls, roofs, trim, wins, hues };
}
function drawFacade(g: CanvasRenderingContext2D, E: Env, f: Facade, t: number, k = 0.7) {
  for (const h of f.hues) fill(g, h.p, lit(E, t, h.c, k));
  fill(g, f.roofs, tone(E, t + 0.12, [110, 70, 64], 0.4));
  stroke(g, f.trim, tone(E, t + 0.15, WOOD, 0.4), 1.4, 0.8);
  fill(g, f.walls, tone(E, t + 0.2, WOOD, 0.3));
  lights(g, E, f.wins);
}

function street(c: Ctx): Scene {
  const { W, H, u, F, r } = c;
  const gy = H * 0.86;
  const skyline = new Path2D();
  for (let x = 0; x < W; x += (30 + r() * 40) * u) {
    const h = (40 + r() * 50) * u;
    skyline.rect(x, gy - 90 * u - h * 0.4, (20 + r() * 20) * u, h);
    if (r() < 0.3) poly(skyline, x, gy - 90 * u - h * 0.4, x + 10 * u, gy - 130 * u - h * 0.5, x + 20 * u, gy - 90 * u - h * 0.4);
  }
  const clock = new Path2D();
  const kx = F + 60 * u;
  clock.rect(kx - 16 * u, gy - 220 * u, 32 * u, 220 * u);
  poly(clock, kx - 20 * u, gy - 220 * u, kx, gy - 270 * u, kx + 20 * u, gy - 220 * u);
  const f = facades(c, gy, 80, 135);
  const ground = new Path2D();
  ground.rect(0, gy, W, H - gy);
  const cobbles = new Path2D();
  for (let y = gy + 4 * u; y < H; y += 5 * u) for (let x = (y % 10) * u; x < W; x += 9 * u) cobbles.rect(x, y, 6 * u, 0.8 * u);
  const posts = [F - 150 * u, F + 10 * u, F + 170 * u];
  const people = new Path2D();
  figure(people, F - 60 * u, H * 0.97, 44 * u);
  figure(people, F - 40 * u, H * 0.97, 40 * u, 1);
  figure(people, F + 110 * u, H * 0.96, 30 * u);
  const signs = new Path2D();
  for (const x of [F - 210 * u, F - 20 * u, F + 140 * u]) {
    signs.rect(x, gy - 76 * u, 22 * u, 2 * u);
    signs.rect(x + 6 * u, gy - 72 * u, 14 * u, 12 * u);
  }
  return {
    draw(g, E) {
      fill(g, skyline, tone(E, 0.25, STONE, 0.3));
      fill(g, clock, tone(E, 0.35, STONE, 0.4));
      const face = mix([220, 214, 200], [255, 220, 150], E.glow);
      g.fillStyle = rgb(face, 0.9);
      g.beginPath();
      g.arc(kx, gy - 196 * u, 9 * u, 0, TAU);
      g.fill();
      glowAt(g, kx, gy - 196 * u, 30 * u, WARM, 0.5 * E.glow);
      haze(g, E, W, H * 0.3, gy, 0.25);
      drawFacade(g, E, f, 0.55);
      fill(g, signs, tone(E, 0.75, WOOD, 0.4));
      fill(g, ground, tone(E, 0.78, STONE, 0.25));
      fill(g, cobbles, tone(E, 0.6, STONE, 0.3), 0.5);
      for (const x of posts) {
        g.fillStyle = rgb(tone(E, 0.9));
        g.fillRect(x - 1.2 * u, gy - 50 * u, 2.4 * u, 50 * u + 16 * u);
        g.fillRect(x - 5 * u, gy - 60 * u, 10 * u, 10 * u);
        lamp(g, E, x, gy - 55 * u, 60 * u, x, WARM, 0);
        g.fillStyle = rgb(WARM, 0.18 * E.glow);
        g.beginPath();
        g.ellipse(x, H * 0.95, 40 * u, 7 * u, 0, 0, TAU);
        g.fill();
      }
      fill(g, people, tone(E, 0.92));
    },
  };
}

function market(c: Ctx): Scene {
  const { W, H, u, F, r } = c;
  const gy = H * 0.84;
  const back = facades(c, gy - 20 * u, 70, 120, 0.8);
  const ground = new Path2D();
  ground.rect(0, gy - 20 * u, W, H);
  const stalls = [-200, -95, 10, 115].map((dx, i) => {
    const x = F + dx * u;
    const w = 90 * u;
    const aw = new Path2D();
    const stripe = new Path2D();
    const body = new Path2D();
    const top = gy - 70 * u;
    poly(aw, x - 6 * u, top + 16 * u, x + 6 * u, top, x + w - 6 * u, top, x + w + 6 * u, top + 16 * u);
    for (let k = 0; k < 6; k += 2) {
      const a = x + (w * k) / 6;
      const b = x + (w * (k + 1)) / 6;
      poly(stripe, a + 6 * u * (1 - k / 3), top, b + 6 * u * (1 - (k + 1) / 3) - 6 * u * 0, top, b - 6 * u + 12 * u * ((k + 1) / 6), top + 16 * u, a - 6 * u + 12 * u * (k / 6), top + 16 * u);
    }
    for (let k = 0; k < 6; k++) {
      aw.moveTo(x - 6 * u + (w + 12 * u) * (k / 6), top + 16 * u);
      aw.arc(x - 6 * u + (w + 12 * u) * ((k + 0.5) / 6), top + 16 * u, (w + 12 * u) / 12, Math.PI, 0, true);
    }
    body.rect(x + 2 * u, top + 16 * u, 2.5 * u, 54 * u);
    body.rect(x + w - 4.5 * u, top + 16 * u, 2.5 * u, 54 * u);
    body.rect(x, gy - 26 * u, w, 26 * u);
    const goods = Array.from({ length: 12 }, () => ({ x: x + 6 * u + r() * (w - 12 * u), y: gy - 28 * u - r() * 6 * u, r: (2.5 + r() * 2.5) * u, c: ([[220, 70, 60], [240, 170, 50], [120, 170, 60], [200, 120, 180]] as RGB[])[(r() * 4) | 0]! }));
    return { aw, stripe, body, goods, c: FABRIC[(i + ((r() * 6) | 0)) % FABRIC.length]!, lx: x + w / 2, ly: top + 22 * u };
  });
  const lines = [0, 1].map((k) => {
    const p = new Path2D();
    const flags: { x: number; y: number; c: RGB }[] = [];
    const x0 = -20 * u;
    const y0 = H * (0.18 + k * 0.1);
    p.moveTo(x0, y0);
    for (let x = x0; x <= W + 20 * u; x += 6 * u) {
      const ph = ((x - x0) % (160 * u)) / (160 * u);
      const y = y0 + Math.sin(ph * Math.PI) * 26 * u;
      p.lineTo(x, y);
      if (((x / (6 * u)) | 0) % 3 === 0) flags.push({ x, y, c: FABRIC[Math.abs((x / (18 * u)) | 0) % FABRIC.length]! });
    }
    return { p, flags };
  });
  const people = new Path2D();
  for (let i = 0; i < 6; i++) figure(people, F - 220 * u + r() * 400 * u, H * (0.95 + r() * 0.05), (38 + r() * 12) * u, i % 2);
  return {
    draw(g, E) {
      drawFacade(g, E, back, 0.42, 0.5);
      fill(g, ground, tone(E, 0.72, STONE, 0.3));
      for (const L of lines) {
        stroke(g, L.p, tone(E, 0.7), 0.8 * u);
        for (const f of L.flags) {
          g.fillStyle = rgb(lit(E, 0.6, f.c, 0.85));
          g.beginPath();
          g.moveTo(f.x - 4 * u, f.y);
          g.lineTo(f.x + 4 * u, f.y);
          g.lineTo(f.x, f.y + 9 * u);
          g.fill();
          if (E.glow > 0.3) glowAt(g, f.x, f.y + 1 * u, 8 * u, WARM, 0.7 * E.glow * flick(E, f.x));
        }
      }
      for (const s of stalls) {
        fill(g, s.body, tone(E, 0.75, WOOD, 0.45));
        for (const it of s.goods) {
          g.fillStyle = rgb(mix(tone(E, 0.7), it.c, 0.25 + 0.6 * E.day + 0.3 * E.glow));
          g.beginPath();
          g.arc(it.x, it.y, it.r, 0, TAU);
          g.fill();
        }
        fill(g, s.aw, lit(E, 0.6, [240, 234, 220], 0.85));
        fill(g, s.stripe, lit(E, 0.65, s.c, 0.9));
        lamp(g, E, s.lx, s.ly, 46 * u, s.lx, WARM, 0);
      }
      fill(g, people, tone(E, 0.92));
    },
  };
}

function rooftops(c: Ctx): Scene {
  const { W, H, u, F, r } = c;
  const far = new Path2D();
  for (let x = 0; x < W; x += (24 + r() * 30) * u) {
    const h = (20 + r() * 40) * u;
    const w = (18 + r() * 22) * u;
    far.rect(x, H * 0.62 - h, w, h + 40 * u);
    const k = r();
    if (k < 0.25) {
      far.moveTo(x + w, H * 0.62 - h);
      far.arc(x + w / 2, H * 0.62 - h, w / 2, 0, Math.PI, true);
    } else if (k < 0.45) poly(far, x + w * 0.3, H * 0.62 - h, x + w / 2, H * 0.62 - h - 40 * u, x + w * 0.7, H * 0.62 - h);
  }
  const rows = [0, 1].map((L) => {
    const walls = new Path2D();
    const roofs = new Path2D();
    const wins: Win[] = [];
    const chims: [number, number][] = [];
    for (let x = -10 * u; x < W; x += (30 + r() * 20) * u) {
      const ch = house(walls, roofs, wins, r, x, H * (0.76 + L * 0.1), (28 + r() * 18) * u, (18 + r() * 20) * u, r() < 0.5 ? "steep" : "gable", r() < 0.5);
      if (ch) chims.push(ch);
    }
    return { walls, roofs, wins, chims };
  });
  const roof = new Path2D();
  const ry = (x: number) => H * 0.78 - (x - (F - 100 * u)) * 0.06;
  poly(roof, F - 120 * u, H, F - 100 * u, ry(F - 100 * u), W + 20 * u, ry(W + 20 * u), W + 20 * u, H);
  const tiles = new Path2D();
  for (let k = 1; k < 8; k++) {
    tiles.moveTo(F - 100 * u - k * 3 * u, ry(F - 100 * u) + k * 9 * u);
    tiles.lineTo(W, ry(W) + k * 9 * u);
  }
  const chim = new Path2D();
  const cx = F + 110 * u;
  chim.rect(cx, ry(cx) - 40 * u, 26 * u, 46 * u);
  chim.rect(cx - 2 * u, ry(cx) - 44 * u, 30 * u, 5 * u);
  chim.rect(cx + 4 * u, ry(cx) - 52 * u, 6 * u, 9 * u);
  chim.rect(cx + 15 * u, ry(cx) - 50 * u, 6 * u, 7 * u);
  const cat = new Path2D();
  const kx = F + 10 * u;
  const ky = ry(kx) + 1 * u;
  cat.moveTo(kx + 9 * u, ky - 9 * u);
  cat.ellipse(kx, ky - 9 * u, 9 * u, 9.5 * u, 0, 0, TAU);
  circle(cat, kx + 2 * u, ky - 22 * u, 6 * u);
  poly(cat, kx - 3 * u, ky - 25 * u, kx - 2 * u, ky - 33 * u, kx + 2 * u, ky - 27 * u);
  poly(cat, kx + 3 * u, ky - 27 * u, kx + 7 * u, ky - 33 * u, kx + 8 * u, ky - 24 * u);
  return {
    draw(g, E) {
      fill(g, far, tone(E, 0.22, STONE, 0.35));
      haze(g, E, W, H * 0.45, H * 0.7, 0.35);
      rows.forEach((row, L) => {
        fill(g, row.walls, lit(E, 0.45 + L * 0.15, PLASTER[L * 2]!, 0.5));
        fill(g, row.roofs, tone(E, 0.55 + L * 0.15, [140, 80, 70], 0.5));
        lights(g, E, row.wins);
        for (const ch of row.chims) smoke(g, E, ch[0], ch[1], u * 0.7);
      });
      fill(g, roof, tone(E, 0.86, [140, 70, 60], 0.45));
      stroke(g, tiles, tone(E, 0.92), 1 * u, 0.6);
      fill(g, chim, tone(E, 0.9, [140, 80, 70], 0.4));
      smoke(g, E, cx + 7 * u, ry(cx) - 52 * u, u * 1.4);
      fill(g, cat, [8, 6, 12]);
      const tw = E.still ? 0 : Math.sin(E.T * 1.3) * 6 * u;
      g.strokeStyle = rgb([8, 6, 12]);
      g.lineWidth = 2.6 * u;
      g.beginPath();
      g.moveTo(kx - 7 * u, ky - 3 * u);
      g.quadraticCurveTo(kx - 26 * u, ky, kx - 22 * u + tw, ky + 16 * u);
      g.stroke();
    },
  };
}

function city(c: Ctx): Scene {
  const { W, H, u, F, r } = c;
  const towers = [0, 1].map((L) => {
    const a: { x: number; w: number; h: number; win: number[] }[] = [];
    for (let x = -10 * u; x < W + 10 * u; ) {
      const w = (14 + r() * 30) * u * (L ? 1.3 : 1);
      const near = Math.abs(x - F) < 60 * u;
      a.push({ x, w, h: (60 + r() * 110 + (near && L ? 80 : 0)) * u * (L ? 1.2 : 1), win: Array.from({ length: 80 }, () => r()) });
      x += w + r() * 4 * u;
    }
    return a;
  });
  const neon = Array.from({ length: 6 }, () => ({ x: r() * W, y: H * (0.8 + r() * 0.08), c: r() < 0.5 ? ([255, 70, 180] as RGB) : ([70, 220, 255] as RGB), w: (10 + r() * 20) * u }));
  const cars = Array.from({ length: c.mini ? 10 : 20 }, () => ({ x: r(), v: 0.04 + r() * 0.06, d: r() < 0.5 ? 1 : -1 }));
  return {
    draw(g, E) {
      const T = E.still ? 0 : E.T;
      towers.forEach((row, L) => {
        const col = tone(E, L ? 0.75 : 0.42, [110, 120, 140], 0.4);
        const gy = H * (L ? 0.9 : 0.8);
        for (const b of row) {
          g.fillStyle = rgb(col);
          g.fillRect(b.x, gy - b.h, b.w, b.h + H);
          const cols = Math.max(2, Math.floor(b.w / (6 * u)));
          const rows = Math.floor(b.h / (8 * u));
          const cw = b.w / cols;
          let n = 0;
          for (let r2 = 1; r2 < rows; r2++)
            for (let k = 0; k < cols; k++) {
              const lt = b.win[n++ % 80]!;
              if (lt < E.glow * (L ? 0.55 : 0.4)) {
                g.fillStyle = rgb(lt < 0.08 ? [170, 210, 255] : WARM, (L ? 0.85 : 0.55) * clamp(E.glow * 1.5));
                g.fillRect(b.x + k * cw + cw * 0.3, gy - b.h + r2 * 8 * u, cw * 0.4, 3.5 * u);
              } else if (E.day > 0.4 && lt > 0.7) {
                g.fillStyle = rgb(mix(E.sky.bot, [255, 255, 255], 0.3), 0.18 * E.day);
                g.fillRect(b.x + k * cw + cw * 0.3, gy - b.h + r2 * 8 * u, cw * 0.4, 3.5 * u);
              }
            }
        }
        if (L) {
          const tb = row.reduce((a, b) => (b.h > a.h ? b : a));
          const ax = tb.x + tb.w / 2;
          const ay = gy - tb.h;
          g.fillStyle = rgb(col);
          g.fillRect(ax - 1 * u, ay - 30 * u, 2 * u, 30 * u);
          if (E.still || Math.sin(T * 3) > 0) glowAt(g, ax, ay - 30 * u, 10 * u, [255, 70, 80], 0.95);
        } else haze(g, E, W, H * 0.4, H * 0.85, 0.3);
      });
      for (const n of neon) glowAt(g, n.x, n.y, n.w * 2, n.c, 0.6 * E.glow * flick(E, n.x));
      g.fillStyle = rgb(tone(E, 0.92));
      g.fillRect(0, H * 0.9, W, H * 0.1);
      for (const car of cars) {
        const x = (((car.x + T * car.v * car.d) % 1) + 1) % 1;
        const y = car.d > 0 ? H * 0.935 : H * 0.965;
        const col: RGB = car.d > 0 ? [255, 60, 60] : [255, 240, 210];
        g.fillStyle = rgb(col, 0.25 + 0.65 * E.glow);
        g.fillRect(x * W, y, (car.d > 0 ? -1 : 1) * 30 * u * (0.3 + E.glow), 1.8 * u);
        g.fillRect(x * W, y - 0.5 * u, 3 * u, 2.6 * u);
      }
      const st = g.createLinearGradient(0, H, 0, H * 0.7);
      st.addColorStop(0, rgb(WARM, 0.2 * E.glow));
      st.addColorStop(1, rgb(WARM, 0));
      g.fillStyle = st;
      g.fillRect(0, H * 0.7, W, H * 0.3);
    },
  };
}

function castle(c: Ctx): Scene {
  const { W, H, u, F, r } = c;
  const mts = peaks(c, H * 0.56, 70 * u, 0.4, F - 200 * u);
  const crag = new Path2D();
  const gy = H * 0.62;
  crag.moveTo(F - 300 * u, H);
  crag.quadraticCurveTo(F - 160 * u, gy + 10 * u, F - 110 * u, gy);
  crag.lineTo(F + 120 * u, gy);
  crag.quadraticCurveTo(F + 200 * u, gy + 20 * u, F + 320 * u, H);
  crag.closePath();
  const keep = new Path2D();
  const wins: Win[] = [];
  keep.rect(F - 110 * u, gy - 34 * u, 230 * u, 36 * u);
  for (let x = F - 110 * u; x < F + 120 * u; x += 8 * u) keep.rect(x, gy - 39 * u, 4.5 * u, 5 * u);
  const banners: { x: number; y: number }[] = [];
  const towers: [number, number, number, boolean][] = [
    [-110, 70, 26, true],
    [-50, 110, 30, false],
    [10, 150, 40, false],
    [70, 100, 28, true],
    [120, 76, 24, true],
  ];
  const cones = new Path2D();
  for (const [dx, h, w, round] of towers) {
    const x = F + dx * u - (w * u) / 2;
    const top = gy - h * u;
    keep.rect(x, top, w * u, h * u);
    if (round) {
      poly(cones, x - 3 * u, top, x + (w * u) / 2, top - w * 1.4 * u, x + w * u + 3 * u, top);
      banners.push({ x: x + (w * u) / 2, y: top - w * 1.4 * u });
    } else {
      for (let k = 0; k < 4; k++) keep.rect(x + (k * w * u) / 3.5 - 1 * u, top - 6 * u, (w * u) / 6, 6 * u);
      banners.push({ x: x + (w * u) / 2, y: top - 6 * u });
    }
    for (let k = 0; k < Math.floor(h / 30); k++) wins.push({ x: x + w * u * 0.4, y: top + (12 + k * 28) * u, w: w * u * 0.2, h: 8 * u, lit: r() * 0.9, f: r() * 50 });
  }
  const gate = { x: F + 40 * u, y: gy - 2 * u };
  const rd = new Path2D();
  rd.moveTo(gate.x - 8 * u, gy);
  rd.quadraticCurveTo(F + 160 * u, H * 0.78, F + 40 * u, H * 0.88);
  rd.quadraticCurveTo(F - 80 * u, H * 0.96, F - 40 * u, H);
  rd.lineTo(F - 10 * u, H);
  rd.quadraticCurveTo(F - 50 * u, H * 0.96, F + 60 * u, H * 0.88);
  rd.quadraticCurveTo(F + 180 * u, H * 0.78, gate.x + 8 * u, gy);
  rd.closePath();
  const torches = [0.3, 0.55, 0.8].map((k) => ({ x: lerp(F + 150 * u, F - 30 * u, k), y: lerp(H * 0.76, H * 0.97, k) }));
  const fab = FABRIC[(r() * FABRIC.length) | 0]!;
  const vil: Win[] = [];
  for (let i = 0; i < 20; i++) vil.push({ x: F - 300 * u + r() * 600 * u, y: H * (0.84 + r() * 0.12), w: 2 * u, h: 2 * u, lit: r() * 0.9, f: 0 });
  return {
    draw(g, E) {
      fill(g, mts.p, tone(E, 0.12, ROCK, 0.3));
      snowcap(g, E, mts.p, mts.top, mts.top + 40 * u, 0.6);
      haze(g, E, W, H * 0.4, H * 0.66, 0.4);
      fill(g, crag, tone(E, 0.62, GRASS, 0.4));
      fill(g, rd, tone(E, 0.55, [180, 150, 110], 0.5));
      fill(g, keep, lit(E, 0.6, STONE, 0.5));
      fill(g, cones, tone(E, 0.68, [70, 70, 100], 0.5));
      lights(g, E, wins);
      lamp(g, E, gate.x, gate.y - 8 * u, 40 * u, 9, WARM, 0);
      g.fillStyle = rgb(mix(DARK, WARM, E.glow * 0.8));
      g.beginPath();
      g.moveTo(gate.x - 9 * u, gate.y);
      g.lineTo(gate.x - 9 * u, gate.y - 14 * u);
      g.arc(gate.x, gate.y - 14 * u, 9 * u, Math.PI, 0);
      g.lineTo(gate.x + 9 * u, gate.y);
      g.fill();
      for (const b of banners) {
        g.fillStyle = rgb(tone(E, 0.7));
        g.fillRect(b.x - 0.6 * u, b.y - 20 * u, 1.2 * u, 20 * u);
        const flap = E.still ? 0 : Math.sin(E.T * (2 + E.c.wind * 4) + b.x) * (2 + E.c.wind * 5) * u;
        g.fillStyle = rgb(lit(E, 0.6, fab, 0.85));
        g.beginPath();
        g.moveTo(b.x + 0.6 * u, b.y - 20 * u);
        g.quadraticCurveTo(b.x + 8 * u, b.y - 19 * u + flap * 0.3, b.x + 16 * u, b.y - 17 * u + flap);
        g.lineTo(b.x + 0.6 * u, b.y - 12 * u);
        g.fill();
      }
      for (const t of torches) lamp(g, E, t.x, t.y, 22 * u, t.x, WARM, 0);
      lights(g, E, vil);
    },
  };
}

function temple(c: Ctx): Scene {
  const { W, H, u, F, r } = c;
  const gothic = r() < 0.5;
  const far = ridge(c, H * 0.66, 10 * u, 0.6);
  const gy = H * 0.8;
  const body = new Path2D();
  const glass = { x: F, y: gy - 120 * u, r: 22 * u };
  const doors = new Path2D();
  if (gothic) {
    body.rect(F - 70 * u, gy - 150 * u, 140 * u, 150 * u);
    poly(body, F - 70 * u, gy - 150 * u, F, gy - 210 * u, F + 70 * u, gy - 150 * u);
    for (const s of [-1, 1]) {
      const x = F + s * 92 * u;
      body.rect(x - 22 * u, gy - 210 * u, 44 * u, 210 * u);
      poly(body, x - 24 * u, gy - 210 * u, x, gy - 300 * u, x + 24 * u, gy - 210 * u);
      for (const dx of [-26, 26]) poly(body, x + dx * u - 3 * u, gy - 210 * u, x + dx * u, gy - 232 * u, x + dx * u + 3 * u, gy - 210 * u);
    }
    doors.moveTo(F - 18 * u, gy);
    doors.lineTo(F - 18 * u, gy - 40 * u);
    doors.quadraticCurveTo(F, gy - 72 * u, F + 18 * u, gy - 40 * u);
    doors.lineTo(F + 18 * u, gy);
    doors.closePath();
  } else {
    glass.y = gy - 150 * u;
    glass.r = 14 * u;
    body.moveTo(F + 70 * u, gy - 120 * u);
    body.ellipse(F, gy - 120 * u, 70 * u, 70 * u, 0, Math.PI, TAU);
    body.rect(F - 76 * u, gy - 124 * u, 152 * u, 10 * u);
    body.rect(F - 8 * u, gy - 214 * u, 16 * u, 26 * u);
    poly(body, F - 10 * u, gy - 214 * u, F, gy - 236 * u, F + 10 * u, gy - 214 * u);
    poly(body, F - 130 * u, gy - 76 * u, F, gy - 112 * u, F + 130 * u, gy - 76 * u);
    body.rect(F - 130 * u, gy - 82 * u, 260 * u, 8 * u);
    for (let k = 0; k < 8; k++) body.rect(F - 122 * u + k * 34 * u, gy - 74 * u, 9 * u, 64 * u);
    body.rect(F - 140 * u, gy - 10 * u, 280 * u, 10 * u);
    doors.rect(F - 14 * u, gy - 50 * u, 28 * u, 40 * u);
  }
  const steps = new Path2D();
  for (let k = 0; k < 6; k++) steps.rect(F - (150 + k * 14) * u, gy + k * 6 * u, (300 + k * 28) * u, 6 * u);
  const cyp = new Path2D();
  for (const dx of [-200, -170, 170, 205]) {
    const x = F + dx * u;
    const h = (110 + r() * 50) * u;
    cyp.moveTo(x, gy - h);
    cyp.quadraticCurveTo(x + 18 * u, gy - h * 0.4, x + 2 * u, gy + 30 * u);
    cyp.lineTo(x - 2 * u, gy + 30 * u);
    cyp.quadraticCurveTo(x - 18 * u, gy - h * 0.4, x, gy - h);
  }
  const ground = ridge(c, H * 0.94, 4 * u);
  const panes: RGB[] = [
    [220, 60, 80],
    [60, 120, 230],
    [240, 190, 60],
    [80, 190, 120],
    [170, 80, 210],
  ];
  return {
    draw(g, E) {
      fill(g, far.p, tone(E, 0.2, GRASS, 0.4));
      haze(g, E, W, H * 0.5, H * 0.75, 0.3);
      fill(g, body, lit(E, 0.55, gothic ? STONE : [232, 224, 210], 0.6));
      const lt = clamp(E.glow * 1.2);
      for (let k = 0; k < 10; k++) {
        g.fillStyle = rgb(mix(tone(E, 0.7), panes[k % 5]!, 0.25 + lt * 0.7));
        g.beginPath();
        g.moveTo(glass.x, glass.y);
        g.arc(glass.x, glass.y, glass.r, (k / 10) * TAU, ((k + 1) / 10) * TAU);
        g.fill();
      }
      g.strokeStyle = rgb(tone(E, 0.75));
      g.lineWidth = 1.6 * u;
      g.beginPath();
      g.arc(glass.x, glass.y, glass.r, 0, TAU);
      g.arc(glass.x, glass.y, glass.r * 0.35, 0, TAU);
      g.stroke();
      glowAt(g, glass.x, glass.y, glass.r * 3.5, [255, 210, 160], 0.35 * lt);
      fill(g, doors, mix(tone(E, 0.85), WARM, lt * 0.8));
      fill(g, steps, lit(E, 0.65, STONE, 0.5));
      fill(g, ground.p, tone(E, 0.8, GRASS, 0.45));
      fill(g, cyp, tone(E, 0.82, PINE, 0.4));
      for (const s of [-1, 1]) {
        g.fillStyle = rgb(tone(E, 0.88));
        g.fillRect(F + s * 150 * u - 3 * u, gy - 20 * u, 6 * u, 26 * u);
        fire(g, E, F + s * 150 * u, gy - 20 * u, 0.6 * u);
      }
    },
  };
}

function ruins(c: Ctx): Scene {
  const { W, H, u, F, r } = c;
  const far = ridge(c, H * 0.64, 14 * u, 0.7);
  const gy = H * 0.84;
  const stone = new Path2D();
  const xs = [-210, -150, -90, -30, 30, 90];
  const ivy: Mote[] = [];
  xs.forEach((dx, i) => {
    const x = F + dx * u;
    const h = (i === 2 || i === 3 ? 150 : 50 + r() * 100) * u;
    stone.rect(x - 9 * u, gy - h, 18 * u, h);
    stone.rect(x - 12 * u, gy - 6 * u, 24 * u, 6 * u);
    if (h > 140 * u) stone.rect(x - 13 * u, gy - h - 6 * u, 26 * u, 6 * u);
    else poly(stone, x - 9 * u, gy - h, x - 4 * u, gy - h - 8 * u, x + 1 * u, gy - h - 2 * u, x + 6 * u, gy - h - 10 * u, x + 9 * u, gy - h);
    for (let k = 0; k < 10; k++) ivy.push({ x: x + (r() - 0.5) * 20 * u, y: gy - r() * h * 0.7, p: r() * TAU, s: (2 + r() * 2.5) * u });
  });
  stone.rect(F - 100 * u, gy - 162 * u, 82 * u, 14 * u);
  const ax = F + 160 * u;
  stone.moveTo(ax - 50 * u, gy);
  stone.lineTo(ax - 50 * u, gy - 120 * u);
  stone.quadraticCurveTo(ax - 50 * u, gy - 175 * u, ax + 6 * u, gy - 178 * u);
  stone.lineTo(ax + 4 * u, gy - 160 * u);
  stone.quadraticCurveTo(ax - 30 * u, gy - 156 * u, ax - 30 * u, gy - 110 * u);
  stone.lineTo(ax - 30 * u, gy);
  stone.closePath();
  stone.rect(ax + 30 * u, gy - 70 * u, 20 * u, 70 * u);
  for (let k = 0; k < 4; k++) {
    const x = F - 40 * u + k * 34 * u + r() * 10 * u;
    stone.moveTo(x + 14 * u, gy + 8 * u + k * 2 * u);
    stone.ellipse(x, gy + 8 * u + k * 2 * u, 14 * u, 8 * u, r() * 0.4, 0, TAU);
  }
  const ground = ridge(c, gy + 4 * u, 4 * u);
  const grass = new Path2D();
  for (let i = 0; i < 90; i++) {
    const x = r() * W;
    const y = ground.y(x) + r() * 30 * u;
    grass.moveTo(x, y);
    grass.lineTo(x + (r() - 0.5) * 6 * u, y - (5 + r() * 9) * u);
  }
  return {
    draw(g, E) {
      fill(g, far.p, tone(E, 0.2, GRASS, 0.4));
      haze(g, E, W, H * 0.5, H * 0.8, 0.35);
      fill(g, ground.p, tone(E, 0.7, GRASS, 0.5));
      fill(g, stone, lit(E, 0.6, [214, 204, 186], 0.55));
      for (const v of ivy) {
        g.fillStyle = rgb(tone(E, 0.65, [80, 130, 60], 0.75), 0.9);
        g.beginPath();
        g.arc(v.x, v.y, v.s, 0, TAU);
        g.fill();
      }
      stroke(g, grass, tone(E, 0.8, GRASS, 0.5), 1.2 * u);
    },
  };
}

function graveyard(c: Ctx): Scene {
  const { W, H, u, F, r } = c;
  const far = ridge(c, H * 0.62, 10 * u, 0.7);
  const ch = new Path2D();
  const cx = F - 140 * u;
  const cy = far.y(cx) + 4 * u;
  ch.rect(cx - 26 * u, cy - 26 * u, 52 * u, 26 * u);
  poly(ch, cx - 30 * u, cy - 26 * u, cx, cy - 46 * u, cx + 30 * u, cy - 26 * u);
  ch.rect(cx + 14 * u, cy - 60 * u, 12 * u, 36 * u);
  poly(ch, cx + 12 * u, cy - 60 * u, cx + 20 * u, cy - 80 * u, cx + 28 * u, cy - 60 * u);
  const ground = ridge(c, H * 0.8, 5 * u);
  const stones = [0, 1].map((row) => {
    const p = new Path2D();
    for (let x = F - 280 * u + row * 20 * u; x < F + 200 * u; x += (34 + r() * 20) * u) {
      const y = ground.y(x) + (8 + row * 26) * u;
      const s = (1 + row * 0.4) * u;
      const k = r();
      if (k < 0.45) {
        p.moveTo(x - 8 * s, y);
        p.lineTo(x - 8 * s, y - 16 * s);
        p.arc(x, y - 16 * s, 8 * s, Math.PI, 0);
        p.lineTo(x + 8 * s, y);
        p.closePath();
      } else if (k < 0.75) {
        p.rect(x - 2 * s, y - 26 * s, 4 * s, 26 * s);
        p.rect(x - 9 * s, y - 20 * s, 18 * s, 4 * s);
      } else poly(p, x - 5 * s, y, x - 3 * s, y - 30 * s, x, y - 34 * s, x + 3 * s, y - 30 * s, x + 5 * s, y);
    }
    return p;
  });
  const tree = new Path2D();
  const tx = F + 130 * u;
  const branch = (x: number, y: number, a: number, L: number, w: number, d: number) => {
    const x2 = x + Math.cos(a) * L;
    const y2 = y + Math.sin(a) * L;
    tree.moveTo(x - Math.sin(a) * w, y + Math.cos(a) * w);
    tree.quadraticCurveTo((x + x2) / 2 + (r() - 0.5) * L * 0.3, (y + y2) / 2, x2, y2);
    tree.quadraticCurveTo((x + x2) / 2 + (r() - 0.5) * L * 0.3, (y + y2) / 2, x + Math.sin(a) * w, y - Math.cos(a) * w);
    tree.closePath();
    if (d > 0) {
      branch(x2, y2, a - 0.35 - r() * 0.4, L * (0.6 + r() * 0.2), w * 0.6, d - 1);
      branch(x2, y2, a + 0.3 + r() * 0.4, L * (0.6 + r() * 0.2), w * 0.6, d - 1);
    }
  };
  branch(tx, H * 0.98, -Math.PI / 2 - 0.08, 70 * u, 7 * u, 5);
  const crows = new Path2D();
  for (const [dx, dy] of [
    [-30, -150],
    [42, -170],
  ] as const) {
    crows.moveTo(tx + dx * u + 5 * u, H * 0.98 + dy * u);
    crows.ellipse(tx + dx * u, H * 0.98 + dy * u, 5 * u, 3.5 * u, 0, 0, TAU);
    circle(crows, tx + dx * u + 4 * u, H * 0.98 + dy * u - 4 * u, 2.5 * u);
  }
  const fence = new Path2D();
  for (let x = 0; x < W; x += 8 * u) {
    const y = H * 0.93;
    fence.rect(x, y - 24 * u, 1.6 * u, 34 * u);
    poly(fence, x - 1.5 * u, y - 24 * u, x + 0.8 * u, y - 30 * u, x + 3.1 * u, y - 24 * u);
  }
  fence.rect(0, H * 0.93 - 20 * u, W, 1.6 * u);
  fence.rect(0, H * 0.93 - 4 * u, W, 1.6 * u);
  return {
    draw(g, E) {
      fill(g, far.p, tone(E, 0.22, GRASS, 0.3));
      fill(g, ch, tone(E, 0.3, STONE, 0.3));
      if (E.glow > 0.2) {
        g.fillStyle = rgb(WARM, 0.85 * E.glow);
        g.fillRect(cx - 4 * u, cy - 18 * u, 8 * u, 12 * u);
        glowAt(g, cx, cy - 12 * u, 30 * u, WARM, 0.4 * E.glow);
      }
      mist(g, E, c, H * 0.66, 0.3);
      fill(g, ground.p, tone(E, 0.6, GRASS, 0.4));
      fill(g, stones[0]!, lit(E, 0.55, STONE, 0.4));
      mist(g, E, c, H * 0.82, 0.25);
      fill(g, stones[1]!, lit(E, 0.72, STONE, 0.4));
      fill(g, tree, tone(E, 0.88));
      fill(g, crows, [10, 8, 14]);
      g.fillStyle = rgb(tone(E, 0.9));
      g.fillRect(F - 60 * u, H * 0.66, 2.4 * u, H * 0.3);
      lamp(g, E, F - 59 * u, H * 0.66, 40 * u, 2, WARM, 0.2);
      stroke(g, fence, tone(E, 0.95), 0.5 * u);
      fill(g, fence, tone(E, 0.95));
    },
  };
}

// ---------- Indoors ----------

/** A room: the sky shows through `win`, the wall goes round it, then the furniture. */
export function room(c: Ctx, win: Path2D, wallHue: RGB, outside: (g: CanvasRenderingContext2D, E: Env) => void, furnish: (g: CanvasRenderingContext2D, E: Env) => void, floorY: number, opts: { lift?: number; space?: boolean; floorHue?: RGB } = {}): Scene {
  const { W, H } = c;
  const wall = new Path2D();
  wall.rect(0, 0, W, H);
  wall.addPath(win);
  return {
    draw: outside,
    space: opts.space,
    room: {
      win,
      draw(g, E) {
        const lift = opts.lift ?? 0.15 + E.day * 0.55 * (1 - E.c.cloud * 0.4);
        const base = mix(mix(wallHue, DARK, 0.82), wallHue, lift);
        const wg = g.createLinearGradient(0, 0, 0, floorY);
        wg.addColorStop(0, rgb(mix(base, DARK, 0.45)));
        wg.addColorStop(0.6, rgb(base));
        wg.addColorStop(1, rgb(mix(base, DARK, 0.2)));
        g.fillStyle = wg;
        g.fill(wall, "evenodd");
        const fbase = opts.floorHue ? mix(mix(opts.floorHue, DARK, 0.82), opts.floorHue, lift) : base;
        const fg = g.createLinearGradient(0, floorY, 0, H);
        fg.addColorStop(0, rgb(mix(fbase, DARK, opts.floorHue ? 0.15 : 0.5)));
        fg.addColorStop(1, rgb(mix(fbase, DARK, opts.floorHue ? 0.45 : 0.75)));
        g.fillStyle = fg;
        g.fillRect(0, floorY, W, H - floorY);
        furnish(g, E);
        const vg = g.createRadialGradient(c.F, H * 0.5, H * 0.2, c.F, H * 0.5, W * 0.8);
        vg.addColorStop(0, "rgba(0,0,0,0)");
        vg.addColorStop(1, rgb(DARK, 0.45));
        g.fillStyle = vg;
        g.fillRect(0, 0, W, H);
      },
    },
  };
}
/** Pictures along a stretch of bare wall, so a room still looks lived in at a wide plate's edges. */
export function wallDressing(c: Ctx, x0: number, x1: number) {
  const { H, u, r } = c;
  const hung: { x: number; y: number; w: number; h: number; art: RGB }[] = [];
  for (let x = x0 + 30 * u; x + 60 * u < x1; ) {
    const w = (50 + r() * 50) * u;
    const h = (36 + r() * 34) * u;
    if (x + w < x1) hung.push({ x, y: H * 0.34 - h / 2 + r() * 16 * u, w, h, art: FABRIC[(r() * FABRIC.length) | 0]! });
    x += w + (70 + r() * 110) * u;
  }
  const edge = c.home?.trim ?? [60, 40, 30];
  return (g: CanvasRenderingContext2D, E: Env) => {
    for (const p of hung) {
      g.fillStyle = rgb(shade(E, edge, 0.5));
      g.fillRect(p.x, p.y, p.w, p.h);
      g.fillStyle = rgb(shade(E, mix(p.art, [220, 210, 190], 0.45), 0.5));
      g.fillRect(p.x + 4 * u, p.y + 4 * u, p.w - 8 * u, p.h - 8 * u);
    }
  };
}
/** The floor strip that ties a home's rooms together. */
export function skirting(g: CanvasRenderingContext2D, E: Env, c: Ctx, floor: number) {
  if (!c.home) return;
  g.fillStyle = rgb(shade(E, c.home.trim, 0.5));
  g.fillRect(0, floor - 8 * c.u, c.W, 8 * c.u);
}
export function townView(c: Ctx) {
  const far = ridge(c, c.H * 0.62, 10 * c.u, 0.7);
  const f = facades(c, c.H * 0.78, 40, 90, 0.7);
  return (g: CanvasRenderingContext2D, E: Env) => {
    fill(g, far.p, tone(E, 0.2, GRASS, 0.4));
    drawFacade(g, E, f, 0.45, 0.5);
  };
}
export function hillView(c: Ctx) {
  const far = peaks(c, c.H * 0.62, 50 * c.u, 0.4);
  const near = ridge(c, c.H * 0.74, 10 * c.u);
  return (g: CanvasRenderingContext2D, E: Env) => {
    fill(g, far.p, tone(E, 0.18, ROCK, 0.35));
    haze(g, E, c.W, c.H * 0.45, c.H * 0.7, 0.3);
    fill(g, near.p, tone(E, 0.45, GRASS, 0.5));
  };
}
export function panes(p: Path2D, x: number, y: number, w: number, h: number, nx: number, ny: number, t: number) {
  p.rect(x - t, y - t, w + t * 2, t * 2);
  p.rect(x - t, y + h - t, w + t * 2, t * 2);
  p.rect(x - t, y - t, t * 2, h + t * 2);
  p.rect(x + w - t, y - t, t * 2, h + t * 2);
  for (let i = 1; i < nx; i++) p.rect(x + (w * i) / nx - t * 0.4, y, t * 0.8, h);
  for (let i = 1; i < ny; i++) p.rect(x, y + (h * i) / ny - t * 0.4, w, t * 0.8);
}
/** Daylight through a window, spilling across the floor. */
export function spill(g: CanvasRenderingContext2D, E: Env, x0: number, x1: number, y: number, floor: number, dx: number) {
  const a = (E.day * 0.16 + (E.light && E.light.a > 0 && E.day < 0.3 ? 0.06 : 0)) * (1 - E.c.cloud * 0.5);
  if (a < 0.01) return;
  const c = E.day > 0.3 ? mix([255, 240, 210], [255, 190, 140], E.golden) : ([200, 210, 255] as RGB);
  const gr = g.createLinearGradient(0, y, 0, floor);
  gr.addColorStop(0, rgb(c, a));
  gr.addColorStop(1, rgb(c, a * 0.4));
  g.fillStyle = gr;
  g.beginPath();
  g.moveTo(x0, y);
  g.lineTo(x1, y);
  g.lineTo(x1 + dx, floor);
  g.lineTo(x0 + dx, floor);
  g.fill();
}

function tavern(c: Ctx): Scene {
  const { W, H, u, F, r } = c;
  const floor = H * 0.86;
  const win = new Path2D();
  const ws = [F - 170 * u, F - 60 * u];
  for (const x of ws) win.rect(x, H * 0.18, 72 * u, 96 * u);
  const frame = new Path2D();
  for (const x of ws) panes(frame, x, H * 0.18, 72 * u, 96 * u, 3, 4, 2 * u);
  const wood = new Path2D();
  wood.rect(0, 0, W, 12 * u);
  for (let x = -20 * u; x < W; x += 120 * u) wood.rect(x, 0, 10 * u, 14 * u);
  for (const x of [F - 200 * u, F + 30 * u]) wood.rect(x, 0, 12 * u, floor);
  const bar = new Path2D();
  bar.rect(F - 280 * u, H * 0.72, 330 * u, H * 0.28);
  const barTop = new Path2D();
  barTop.rect(F - 286 * u, H * 0.7, 342 * u, 7 * u);
  const glass: { x: number; h: number; c: RGB }[] = [];
  for (let x = F - 260 * u; x < F + 30 * u; x += (12 + r() * 30) * u) glass.push({ x, h: (12 + r() * 14) * u, c: ([[60, 120, 70], [170, 110, 40], [120, 60, 50], [200, 200, 210]] as RGB[])[(r() * 4) | 0]! });
  const hearth = new Path2D();
  const hx = F + 120 * u;
  hearth.rect(hx - 60 * u, H * 0.42, 120 * u, floor - H * 0.42);
  hearth.rect(hx - 70 * u, H * 0.4, 140 * u, 10 * u);
  const mouth = new Path2D();
  mouth.moveTo(hx - 38 * u, floor);
  mouth.lineTo(hx - 38 * u, H * 0.62);
  mouth.quadraticCurveTo(hx, H * 0.5, hx + 38 * u, H * 0.62);
  mouth.lineTo(hx + 38 * u, floor);
  mouth.closePath();
  const lanterns = [F - 240 * u, F - 25 * u, F + 220 * u];
  const view = townView(c);
  return room(
    c,
    win,
    [150, 104, 78],
    view,
    (g, E) => {
      spill(g, E, ws[0]!, ws[1]! + 72 * u, H * 0.18 + 96 * u, floor, 60 * u);
      fill(g, frame, mix([40, 26, 22], [110, 76, 54], E.day * 0.6));
      fill(g, wood, mix([30, 20, 18], [96, 64, 46], E.day * 0.6));
      fill(g, hearth, mix([50, 44, 46], [140, 128, 120], E.day * 0.5));
      fill(g, mouth, [20, 12, 12]);
      glowAt(g, hx, floor - 20 * u, 200 * u, [255, 140, 60], 0.45);
      fire(g, E, hx, floor - 4 * u, u * 1.6);
      for (const s of glass) {
        g.fillStyle = rgb(mix(s.c, DARK, 0.5 - 0.3 * E.day), 0.9);
        g.fillRect(s.x, H * 0.7 - s.h, 6 * u, s.h);
        g.fillRect(s.x + 1.8 * u, H * 0.7 - s.h - 6 * u, 2.4 * u, 6 * u);
        g.fillStyle = rgb([255, 230, 190], 0.4);
        g.fillRect(s.x + 1 * u, H * 0.7 - s.h + 2 * u, 1 * u, s.h - 4 * u);
      }
      fill(g, bar, mix([36, 22, 18], [104, 66, 44], E.day * 0.55));
      fill(g, barTop, mix([70, 46, 34], [150, 100, 66], E.day * 0.55));
      for (const x of lanterns) {
        g.strokeStyle = rgb([20, 14, 12]);
        g.lineWidth = 1.2 * u;
        g.beginPath();
        g.moveTo(x, 12 * u);
        g.lineTo(x, H * 0.22);
        g.stroke();
        g.fillStyle = rgb([30, 20, 16]);
        g.fillRect(x - 6 * u, H * 0.22, 12 * u, 16 * u);
        lamp(g, E, x, H * 0.22 + 9 * u, 90 * u, x, WARM, 0.55);
      }
    },
    floor,
  );
}

// bedroom() has a lampshade called shade.
const shadeOf = (E: Env, hue: RGB, k?: number) => shade(E, hue, k);

function bedroom(c: Ctx): Scene {
  const { W, H, u, F, r } = c;
  const floor = H * 0.82;
  const win = new Path2D();
  const wx = F - 130 * u;
  const ww = 100 * u;
  const wt = H * 0.14;
  const wb = H * 0.66;
  win.moveTo(wx, wb);
  win.lineTo(wx, wt + ww / 2);
  win.arc(wx + ww / 2, wt + ww / 2, ww / 2, Math.PI, 0);
  win.lineTo(wx + ww, wb);
  win.closePath();
  const frame = new Path2D();
  frame.rect(wx + ww / 2 - 1.5 * u, wt, 3 * u, wb - wt);
  frame.rect(wx, H * 0.4, ww, 3 * u);
  frame.rect(wx - 8 * u, wb, ww + 16 * u, 6 * u);
  const curt = new Path2D();
  for (const s of [-1, 1]) {
    const x = s < 0 ? wx - 14 * u : wx + ww + 14 * u;
    curt.moveTo(x, wt - 16 * u);
    curt.lineTo(x + s * 34 * u, wt - 16 * u);
    curt.quadraticCurveTo(x + s * 30 * u, floor * 0.7, x + s * 40 * u, floor);
    curt.lineTo(x - s * 4 * u, floor);
    curt.quadraticCurveTo(x + s * 18 * u, H * 0.48, x - s * 8 * u, wt + 20 * u);
    curt.closePath();
  }
  curt.rect(wx - 60 * u, wt - 20 * u, ww + 120 * u, 4 * u);
  const home = c.home;
  const fab = home?.fabric ?? FABRIC[(r() * FABRIC.length) | 0]!;
  const bed = new Path2D();
  const bx = F;
  bed.rect(bx, H * 0.36, 12 * u, floor - H * 0.36);
  bed.moveTo(bx, H * 0.36);
  bed.quadraticCurveTo(bx + 6 * u, H * 0.3, bx + 12 * u, H * 0.36);
  bed.rect(bx + 190 * u, H * 0.56, 10 * u, floor - H * 0.56);
  bed.rect(bx, H * 0.66, 200 * u, 14 * u);
  const sheet = new Path2D();
  sheet.moveTo(bx + 12 * u, H * 0.6);
  sheet.lineTo(bx + 192 * u, H * 0.6);
  sheet.lineTo(bx + 196 * u, H * 0.74);
  sheet.lineTo(bx + 12 * u, H * 0.74);
  sheet.closePath();
  const blanket = new Path2D();
  blanket.moveTo(bx + 70 * u, H * 0.58);
  blanket.quadraticCurveTo(bx + 130 * u, H * 0.55, bx + 196 * u, H * 0.58);
  blanket.lineTo(bx + 200 * u, H * 0.8);
  blanket.lineTo(bx + 66 * u, H * 0.8);
  blanket.closePath();
  const pillow = new Path2D();
  pillow.ellipse(bx + 40 * u, H * 0.57, 28 * u, 9 * u, 0, 0, TAU);
  const stand = new Path2D();
  stand.rect(F - 60 * u, H * 0.66, 40 * u, floor - H * 0.66);
  stand.rect(F - 46 * u, H * 0.6, 12 * u, 3 * u);
  stand.rect(F - 41 * u, H * 0.5, 2.5 * u, H * 0.1);
  const shade = new Path2D();
  poly(shade, F - 54 * u, H * 0.5, F - 26 * u, H * 0.5, F - 32 * u, H * 0.42, F - 48 * u, H * 0.42);
  const pic = new Path2D();
  pic.rect(F + 70 * u, H * 0.18, 70 * u, 50 * u);
  const view = hillView(c);
  const wall = home?.wall ?? PLASTER[(r() * PLASTER.length) | 0]!;
  const dressing = wallDressing(c, 0, wx - 70 * u);
  const old = home?.style === "old";
  const grand = home?.style === "grand";
  const plain = home?.style === "humble";
  // Grand and old-world beds have posts, and the grand one a canopy over them.
  const posts = new Path2D();
  for (const x of [bx + 2 * u, bx + 192 * u]) posts.rect(x, H * 0.14, 6 * u, floor - H * 0.14);
  const canopy = new Path2D();
  canopy.moveTo(bx - 10 * u, H * 0.12);
  canopy.lineTo(bx + 210 * u, H * 0.12);
  canopy.lineTo(bx + 210 * u, H * 0.2);
  canopy.quadraticCurveTo(bx + 100 * u, H * 0.27, bx - 10 * u, H * 0.2);
  canopy.closePath();
  const radiator = new Path2D();
  for (let k = 0; k < 7; k++) radiator.rect(wx + 8 * u + k * 13 * u, floor - 40 * u, 9 * u, 38 * u);
  return room(
    c,
    win,
    wall,
    view,
    (g, E) => {
      dressing(g, E);
      skirting(g, E, c, floor);
      spill(g, E, wx, wx + ww, wb, floor, 70 * u);
      fill(g, frame, home ? shadeOf(E, home.trim, 0.6) : mix([40, 30, 34], [214, 204, 196], E.day * 0.6));
      if (plain) fill(g, radiator, shadeOf(E, [226, 222, 214], 0.5));
      fill(g, curt, mix(mix(fab, DARK, 0.8), fab, 0.25 + E.day * 0.5));
      fill(g, pic, mix([40, 28, 26], [120, 90, 60], E.day * 0.5));
      g.fillStyle = rgb(mix(E.sky.bot, DARK, 0.5));
      g.fillRect(F + 75 * u, H * 0.18 + 5 * u, 60 * u, 40 * u);
      fill(g, bed, mix([30, 20, 22], [104, 70, 54], E.day * 0.5));
      fill(g, sheet, mix([50, 50, 64], [232, 228, 222], E.day * 0.7));
      fill(g, pillow, mix([60, 60, 74], [244, 240, 236], E.day * 0.7));
      fill(g, blanket, mix(mix(fab, DARK, 0.75), fab, 0.3 + E.day * 0.45));
      g.fillStyle = rgb([80, 40, 50], 0.35);
      g.beginPath();
      g.ellipse(F - 40 * u, H * 0.93, 140 * u, 12 * u, 0, 0, TAU);
      g.fill();
      fill(g, stand, mix([30, 20, 22], [104, 70, 54], E.day * 0.5));
      const on = clamp(E.glow * 1.3);
      if (old) {
        if (on > 0.1) fire(g, E, F - 40 * u, H * 0.5, u * 0.5);
        glowAt(g, F - 40 * u, H * 0.48, 110 * u, WARM, 0.35 * on);
      } else {
        fill(g, shade, mix([60, 50, 50], [255, 220, 170], 0.3 + on * 0.7));
        glowAt(g, F - 40 * u, H * 0.48, 130 * u, WARM, 0.45 * on);
      }
      if (old || grand) fill(g, posts, mix([30, 20, 22], [104, 70, 54], E.day * 0.5));
      if (grand) fill(g, canopy, mix(mix(fab, DARK, 0.75), fab, 0.3 + E.day * 0.45));
    },
    floor,
    { floorHue: home?.floor },
  );
}

function hall(c: Ctx): Scene {
  const { W, H, u, F, r } = c;
  const floor = H * 0.84;
  const win = new Path2D();
  const xs = [F - 230 * u, F - 120 * u, F - 10 * u];
  for (const x of xs) {
    win.moveTo(x, H * 0.7);
    win.lineTo(x, H * 0.3);
    win.quadraticCurveTo(x, H * 0.14, x + 25 * u, H * 0.08);
    win.quadraticCurveTo(x + 50 * u, H * 0.14, x + 50 * u, H * 0.3);
    win.lineTo(x + 50 * u, H * 0.7);
    win.closePath();
  }
  const frame = new Path2D();
  for (const x of xs) {
    frame.rect(x + 23.5 * u, H * 0.1, 3 * u, H * 0.6);
    for (const y of [0.32, 0.5]) frame.rect(x, H * y, 50 * u, 2.5 * u);
  }
  const cols = new Path2D();
  for (const x of [...xs.map((x) => x - 30 * u), xs[2]! + 80 * u]) {
    cols.rect(x - 9 * u, 0, 18 * u, floor);
    cols.rect(x - 13 * u, floor - 10 * u, 26 * u, 10 * u);
    cols.rect(x - 13 * u, H * 0.06, 26 * u, 8 * u);
  }
  const fab = FABRIC[(r() * FABRIC.length) | 0]!;
  const banners = new Path2D();
  for (const x of [xs[0]! + 80 * u, xs[1]! + 80 * u]) {
    banners.moveTo(x - 12 * u, H * 0.1);
    banners.lineTo(x + 12 * u, H * 0.1);
    banners.lineTo(x + 12 * u, H * 0.52);
    banners.lineTo(x, H * 0.46);
    banners.lineTo(x - 12 * u, H * 0.52);
    banners.closePath();
  }
  const dais = new Path2D();
  const tx = F + 140 * u;
  for (let k = 0; k < 3; k++) dais.rect(tx - (70 - k * 14) * u, floor - (k + 1) * 8 * u, (140 - k * 28) * u, 8 * u);
  const throne = new Path2D();
  const ty = floor - 24 * u;
  throne.rect(tx - 18 * u, ty - 90 * u, 36 * u, 90 * u);
  poly(throne, tx - 22 * u, ty - 90 * u, tx - 14 * u, ty - 110 * u, tx - 6 * u, ty - 94 * u, tx, ty - 118 * u, tx + 6 * u, ty - 94 * u, tx + 14 * u, ty - 110 * u, tx + 22 * u, ty - 90 * u);
  throne.rect(tx - 30 * u, ty - 40 * u, 60 * u, 10 * u);
  throne.rect(tx - 30 * u, ty - 40 * u, 8 * u, 40 * u);
  throne.rect(tx + 22 * u, ty - 40 * u, 8 * u, 40 * u);
  const carpet = new Path2D();
  poly(carpet, tx - 20 * u, floor - 24 * u, tx + 20 * u, floor - 24 * u, tx + 90 * u, H, tx - 150 * u, H);
  const view = hillView(c);
  return room(
    c,
    win,
    STONE,
    view,
    (g, E) => {
      for (const x of xs) spill(g, E, x, x + 50 * u, H * 0.7, floor, 50 * u);
      fill(g, frame, mix([30, 26, 30], [90, 84, 86], E.day * 0.5));
      fill(g, cols, mix([40, 36, 40], [168, 158, 150], E.day * 0.5));
      fill(g, banners, mix(mix(fab, DARK, 0.75), fab, 0.3 + E.day * 0.45));
      for (const x of [xs[0]! + 80 * u, xs[1]! + 80 * u]) {
        g.fillStyle = rgb([230, 190, 90], 0.3 + E.day * 0.5);
        g.beginPath();
        g.arc(x, H * 0.26, 6 * u, 0, TAU);
        g.fill();
      }
      fill(g, carpet, mix([60, 16, 24], [160, 40, 50], 0.2 + E.day * 0.5));
      fill(g, dais, mix([40, 36, 40], [150, 140, 134], E.day * 0.5));
      fill(g, throne, mix([40, 30, 20], [150, 116, 60], 0.2 + E.day * 0.4));
      for (const x of [tx - 90 * u, tx + 90 * u]) {
        g.fillStyle = rgb([30, 24, 22]);
        g.fillRect(x - 3 * u, floor - 40 * u, 6 * u, 40 * u);
        g.fillRect(x - 10 * u, floor - 44 * u, 20 * u, 5 * u);
        fire(g, E, x, floor - 44 * u, 0.9 * u);
      }
    },
    floor,
  );
}

function library(c: Ctx): Scene {
  const { W, H, u, F, r } = c;
  const floor = H * 0.88;
  const wcx = F - 40 * u;
  const wcy = H * 0.38;
  const wr = 62 * u;
  const win = new Path2D();
  circle(win, wcx, wcy, wr);
  const frame = new Path2D();
  frame.moveTo(wcx + wr + 4 * u, wcy);
  frame.arc(wcx, wcy, wr + 4 * u, 0, TAU);
  frame.moveTo(wcx + wr, wcy);
  frame.arc(wcx, wcy, wr, 0, TAU, true);
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * TAU;
    frame.moveTo(wcx + Math.cos(a) * 14 * u, wcy + Math.sin(a) * 14 * u);
    frame.lineTo(wcx + Math.cos(a) * wr, wcy + Math.sin(a) * wr);
    frame.lineTo(wcx + Math.cos(a + 0.03) * wr, wcy + Math.sin(a + 0.03) * wr);
    frame.closePath();
  }
  frame.moveTo(wcx + 14 * u, wcy);
  frame.arc(wcx, wcy, 14 * u, 0, TAU);
  frame.moveTo(wcx + 11 * u, wcy);
  frame.arc(wcx, wcy, 11 * u, 0, TAU, true);
  const shelves = new Path2D();
  const books: { x: number; y: number; w: number; h: number; c: RGB }[] = [];
  const spines: RGB[] = [
    [120, 36, 40],
    [36, 70, 56],
    [34, 50, 96],
    [150, 110, 50],
    [90, 50, 96],
    [140, 120, 100],
  ];
  for (let y = H * 0.06; y < floor - 20 * u; y += 40 * u) {
    shelves.rect(0, y + 34 * u, W, 5 * u);
    for (let x = 0; x < W; ) {
      const w = (5 + r() * 7) * u;
      const h = (22 + r() * 10) * u;
      const cx = x + w / 2;
      if (Math.hypot(cx - wcx, y + 34 * u - h / 2 - wcy) > wr + 18 * u) books.push({ x, y: y + 34 * u - h, w: w - 0.8 * u, h, c: spines[(r() * spines.length) | 0]! });
      x += w + (r() < 0.06 ? 14 * u : 0);
    }
  }
  const ladder = new Path2D();
  const lx = F + 110 * u;
  for (const dx of [0, 34]) {
    ladder.moveTo(lx + dx * u, floor);
    ladder.lineTo(lx + dx * u + 40 * u, H * 0.04);
  }
  for (let k = 1; k < 10; k++) {
    const t = k / 10;
    ladder.moveTo(lx + 40 * u * t, lerp(floor, H * 0.04, t));
    ladder.lineTo(lx + 34 * u + 40 * u * t, lerp(floor, H * 0.04, t));
  }
  const desk = new Path2D();
  desk.rect(F - 230 * u, H * 0.68, 120 * u, 6 * u);
  desk.rect(F - 226 * u, H * 0.68, 6 * u, floor - H * 0.68);
  desk.rect(F - 120 * u, H * 0.68, 6 * u, floor - H * 0.68);
  desk.rect(F - 170 * u, H * 0.6, 2 * u, H * 0.08);
  const shade = new Path2D();
  poly(shade, F - 186 * u, H * 0.6, F - 152 * u, H * 0.6, F - 158 * u, H * 0.56, F - 180 * u, H * 0.56);
  const dust = motes(c, 30, wcx - 20 * u, wcx + 160 * u, wcy, floor);
  const view = hillView(c);
  return room(
    c,
    win,
    [90, 60, 44],
    view,
    (g, E) => {
      const k = 0.18 + E.day * 0.5;
      for (const b of books) {
        g.fillStyle = rgb(mix(DARK, b.c, k + 0.15 * E.glow));
        g.fillRect(b.x, b.y, b.w, b.h);
      }
      fill(g, shelves, mix([30, 20, 16], [110, 76, 50], k));
      fill(g, frame, mix([30, 22, 20], [110, 80, 56], k));
      const sa = E.day * (1 - E.c.cloud) * 0.12;
      if (sa > 0.01) {
        const gr = g.createLinearGradient(wcx, wcy, wcx + 150 * u, floor);
        gr.addColorStop(0, rgb([255, 236, 200], sa));
        gr.addColorStop(1, rgb([255, 236, 200], 0));
        g.fillStyle = gr;
        g.beginPath();
        g.moveTo(wcx - wr * 0.6, wcy - wr * 0.6);
        g.lineTo(wcx + wr * 0.7, wcy - wr * 0.5);
        g.lineTo(wcx + 220 * u, floor);
        g.lineTo(wcx + 40 * u, floor);
        g.fill();
        for (const d of dust) {
          g.fillStyle = rgb([255, 240, 210], sa * 4 * (0.5 + 0.5 * Math.sin(E.T + d.p)));
          g.fillRect(d.x + Math.sin(E.T * 0.2 + d.p) * 10 * u, d.y + Math.cos(E.T * 0.15 + d.p) * 10 * u, 1.4 * u, 1.4 * u);
        }
      }
      stroke(g, ladder, mix([40, 26, 20], [130, 90, 60], k), 3 * u);
      fill(g, desk, mix([30, 20, 16], [110, 76, 50], k));
      fill(g, shade, mix([30, 70, 50], [60, 160, 100], 0.3 + E.glow * 0.5));
      glowAt(g, F - 169 * u, H * 0.64, 110 * u, WARM, 0.5 * clamp(E.glow + 0.2));
    },
    floor,
  );
}

function study(c: Ctx): Scene {
  const { W, H, u, F, r } = c;
  const floor = H * 0.86;
  const wx = F - 200 * u;
  const ww = 120 * u;
  const wt = H * 0.16;
  const wb = H * 0.56;
  const win = new Path2D();
  win.rect(wx, wt, ww, wb - wt);
  const slats = new Path2D();
  for (let y = wt + 4 * u; y < wb; y += 9 * u) slats.rect(wx, y, ww, 3.6 * u);
  slats.rect(wx - 6 * u, wt - 6 * u, ww + 12 * u, 6 * u);
  slats.rect(wx - 8 * u, wb, ww + 16 * u, 5 * u);
  const desk = new Path2D();
  desk.rect(F - 40 * u, H * 0.66, 220 * u, 7 * u);
  desk.rect(F - 34 * u, H * 0.66, 60 * u, floor - H * 0.66);
  desk.rect(F + 160 * u, H * 0.66, 7 * u, floor - H * 0.66);
  const lampP = new Path2D();
  const lx = F + 130 * u;
  lampP.ellipse(lx, H * 0.655, 14 * u, 3 * u, 0, 0, TAU);
  lampP.moveTo(lx - 1 * u, H * 0.655);
  lampP.lineTo(lx - 20 * u, H * 0.5);
  lampP.lineTo(lx - 17 * u, H * 0.5);
  lampP.lineTo(lx + 2 * u, H * 0.655);
  lampP.closePath();
  poly(lampP, lx - 22 * u, H * 0.48, lx - 6 * u, H * 0.42, lx + 4 * u, H * 0.5, lx - 6 * u, H * 0.54);
  const papers = new Path2D();
  for (let k = 0; k < 4; k++) papers.rect(F + (10 + k * 14) * u, H * 0.66 - (k + 1) * 2 * u, 40 * u, 2 * u);
  const board = { x: F - 40 * u, y: H * 0.12, w: 130 * u, h: 80 * u };
  const notes = Array.from({ length: 7 }, () => ({ x: board.x + 8 * u + r() * (board.w - 30 * u), y: board.y + 8 * u + r() * (board.h - 28 * u), w: (12 + r() * 10) * u, h: (12 + r() * 6) * u, c: ([[250, 240, 200], [250, 220, 140], [230, 236, 250], [250, 200, 200]] as RGB[])[(r() * 4) | 0]!, a: (r() - 0.5) * 0.2 }));
  const plant = new Path2D();
  const px = F + 210 * u;
  poly(plant, px - 12 * u, floor, px - 15 * u, floor - 26 * u, px + 15 * u, floor - 26 * u, px + 12 * u, floor);
  for (let k = 0; k < 9; k++) {
    const a = -Math.PI / 2 + (k - 4) * 0.28;
    const L = (30 + r() * 30) * u;
    plant.moveTo(px, floor - 26 * u);
    plant.ellipse(px + Math.cos(a) * L * 0.5, floor - 26 * u + Math.sin(a) * L * 0.5, L * 0.5, 4 * u, a, 0, TAU);
  }
  const city_ = city({ ...c, r: rand(5) });
  return room(
    c,
    win,
    [120, 130, 120],
    (g, E) => city_.draw(g, E),
    (g, E) => {
      const sa = E.day * (1 - E.c.cloud) * 0.12;
      if (sa > 0.01)
        for (let y = wt + 4 * u; y < wb; y += 9 * u) {
          g.fillStyle = rgb([255, 236, 200], sa);
          g.beginPath();
          g.moveTo(wx + ww + 10 * u, y + 30 * u);
          g.lineTo(wx + ww + 180 * u, y + 60 * u);
          g.lineTo(wx + ww + 180 * u, y + 63 * u);
          g.lineTo(wx + ww + 10 * u, y + 33 * u);
          g.fill();
        }
      fill(g, slats, mix([40, 38, 40], [210, 206, 196], E.day * 0.6));
      g.fillStyle = rgb(mix([40, 30, 24], [168, 130, 90], E.day * 0.5));
      g.fillRect(board.x, board.y, board.w, board.h);
      for (const n of notes) {
        g.save();
        g.translate(n.x, n.y);
        g.rotate(n.a);
        g.fillStyle = rgb(mix(DARK, n.c, 0.3 + E.day * 0.5 + E.glow * 0.2));
        g.fillRect(0, 0, n.w, n.h);
        g.restore();
      }
      g.strokeStyle = rgb([200, 40, 40], 0.4 + E.day * 0.4);
      g.lineWidth = 0.9 * u;
      g.beginPath();
      notes.forEach((n, i) => (i ? g.lineTo(n.x + n.w / 2, n.y + 2 * u) : g.moveTo(n.x + n.w / 2, n.y + 2 * u)));
      g.stroke();
      fill(g, desk, mix([30, 20, 16], [120, 84, 56], E.day * 0.5));
      fill(g, papers, mix([60, 60, 70], [240, 236, 226], E.day * 0.6 + E.glow * 0.3));
      const on = clamp(E.glow * 1.2 + 0.1);
      g.fillStyle = rgb(WARM, 0.14 * on);
      g.beginPath();
      g.moveTo(lx - 20 * u, H * 0.5);
      g.lineTo(lx - 2 * u, H * 0.52);
      g.lineTo(lx + 20 * u, H * 0.66);
      g.lineTo(lx - 80 * u, H * 0.66);
      g.fill();
      fill(g, lampP, mix([30, 30, 34], [80, 90, 80], E.day * 0.5));
      glowAt(g, lx - 10 * u, H * 0.6, 110 * u, WARM, 0.4 * on);
      fill(g, plant, mix([20, 30, 24], [60, 120, 70], E.day * 0.6));
      if (!E.still)
        for (let i = 0; i < 3; i++) {
          const k = (E.T * 0.25 + i / 3) % 1;
          g.fillStyle = rgb([230, 230, 240], 0.18 * (1 - k));
          g.beginPath();
          g.arc(F + 90 * u + Math.sin(k * 6 + i) * 3 * u, H * 0.62 - k * 30 * u, (2 + k * 4) * u, 0, TAU);
          g.fill();
        }
      g.fillStyle = rgb(mix([40, 30, 30], [200, 190, 180], E.day * 0.5));
      g.fillRect(F + 84 * u, H * 0.62, 12 * u, 13 * u);
    },
    floor,
  );
}

function dungeon(c: Ctx): Scene {
  const { W, H, u, F, r } = c;
  const floor = H * 0.88;
  const wx = F - 50 * u;
  const wy = H * 0.12;
  const ww = 70 * u;
  const wh = 44 * u;
  const win = new Path2D();
  win.rect(wx, wy, ww, wh);
  const bars = new Path2D();
  for (let x = wx + 10 * u; x < wx + ww; x += 12 * u) bars.rect(x, wy, 3 * u, wh);
  bars.rect(wx, wy + wh / 2, ww, 3 * u);
  const blocks = new Path2D();
  for (let y = 0, row = 0; y < floor; y += 22 * u, row++) {
    blocks.moveTo(0, y);
    blocks.lineTo(W, y);
    for (let x = row % 2 ? 0 : 22 * u; x < W; x += (36 + r() * 16) * u) {
      blocks.moveTo(x, y);
      blocks.lineTo(x, y + 22 * u);
    }
  }
  const chain = new Path2D();
  for (const cx of [F + 80 * u, F + 116 * u]) {
    for (let y = H * 0.1; y < H * 0.5; y += 7 * u) {
      chain.moveTo(cx + 2.5 * u, y);
      chain.ellipse(cx, y, 2.5 * u, 4 * u, 0, 0, TAU);
    }
    chain.moveTo(cx + 7 * u, H * 0.54);
    chain.ellipse(cx, H * 0.54, 7 * u, 5 * u, 0, 0, TAU);
  }
  const door = new Path2D();
  const dx = F - 230 * u;
  door.moveTo(dx, floor);
  door.lineTo(dx, H * 0.36);
  door.quadraticCurveTo(dx + 40 * u, H * 0.24, dx + 80 * u, H * 0.36);
  door.lineTo(dx + 80 * u, floor);
  door.closePath();
  const bands = new Path2D();
  for (const y of [0.46, 0.7]) bands.rect(dx, H * y, 80 * u, 5 * u);
  const straw = new Path2D();
  for (let i = 0; i < 60; i++) {
    const x = F + 30 * u + r() * 140 * u;
    const y = floor - r() * 8 * u + 6 * u;
    straw.moveTo(x, y);
    straw.lineTo(x + (r() - 0.5) * 20 * u, y - r() * 6 * u);
  }
  const tx = F + 190 * u;
  return room(
    c,
    win,
    [118, 110, 104],
    (g, E) => fill(g, ridge(c, H * 0.3, 4 * u).p, tone(E, 0.4, GRASS, 0.4)),
    (g, E) => {
      stroke(g, blocks, DARK, 1.2 * u, 0.45);
      const L = E.day > 0.3 ? mix([255, 240, 210], [255, 190, 140], E.golden) : ([190, 205, 255] as RGB);
      const a = (E.day * 0.2 + E.night * 0.1) * (1 - E.c.cloud * 0.5);
      const gr = g.createLinearGradient(wx, wy, wx + 120 * u, floor);
      gr.addColorStop(0, rgb(L, a));
      gr.addColorStop(1, rgb(L, a * 0.25));
      g.fillStyle = gr;
      g.beginPath();
      g.moveTo(wx, wy + wh);
      g.lineTo(wx + ww, wy + wh);
      g.lineTo(wx + ww + 150 * u, floor + 4 * u);
      g.lineTo(wx + 90 * u, floor + 4 * u);
      g.fill();
      fill(g, bars, [20, 18, 20]);
      fill(g, door, mix([30, 20, 16], [90, 62, 44], 0.4));
      fill(g, bands, [24, 22, 24]);
      stroke(g, chain, [40, 38, 42], 1.4 * u);
      stroke(g, straw, [150, 130, 80], 1 * u, 0.6);
      g.fillStyle = rgb([24, 22, 24]);
      g.fillRect(tx - 3 * u, H * 0.42, 6 * u, 24 * u);
      glowAt(g, tx, H * 0.4, 180 * u, [255, 140, 60], 0.35);
      fire(g, E, tx, H * 0.42, u);
    },
    floor,
  );
}

function space(c: Ctx): Scene {
  const { W, H, u, F, r } = c;
  const stars = Array.from({ length: c.mini ? 160 : 320 }, () => ({ x: r() * W, y: r() * H, s: (0.4 + r() * 1.3) * u * 0.8, p: r() * TAU, c: r() < 0.15 ? ([255, 210, 180] as RGB) : r() < 0.3 ? ([180, 210, 255] as RGB) : ([255, 255, 255] as RGB) }));
  const neb = Array.from({ length: 6 }, () => ({ x: r() * W, y: r() * H * 0.8, rr: (80 + r() * 160) * u, c: ([[200, 60, 160], [60, 140, 220], [120, 70, 220], [40, 190, 170]] as RGB[])[(r() * 4) | 0]! }));
  const px = F + 60 * u;
  const py = H * 1.08;
  const pr = 200 * u;
  const hue: RGB = ([[70, 120, 200], [200, 120, 70], [90, 170, 130], [170, 100, 180]] as RGB[])[(r() * 4) | 0]!;
  const bands = Array.from({ length: 8 }, () => ({ y: (r() - 0.5) * 1.6, h: (4 + r() * 14) * u, a: 0.08 + r() * 0.15 }));
  const ringed = r() < 0.5;
  return {
    space: true,
    draw(g, E) {
      const bg = g.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, "rgb(4,5,16)");
      bg.addColorStop(1, "rgb(14,8,30)");
      g.fillStyle = bg;
      g.fillRect(0, 0, W, H);
      g.save();
      g.globalCompositeOperation = "lighter";
      for (const n of neb) glowAt(g, n.x, n.y, n.rr, n.c, 0.16);
      g.restore();
      for (const s of stars) {
        g.fillStyle = rgb(s.c, 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(E.T * 1.5 + s.p)) ** 2);
        g.fillRect(s.x, s.y, s.s, s.s);
      }
      glowAt(g, px, py, pr * 1.25, mix(hue, [255, 255, 255], 0.3), 0.35);
      if (ringed) {
        g.strokeStyle = rgb(mix(hue, [255, 240, 220], 0.6), 0.35);
        g.lineWidth = 6 * u;
        g.beginPath();
        g.ellipse(px, py, pr * 1.7, pr * 0.28, -0.12, Math.PI, TAU);
        g.stroke();
      }
      g.save();
      g.beginPath();
      g.arc(px, py, pr, 0, TAU);
      g.clip();
      const pg = g.createRadialGradient(px - pr * 0.4, py - pr * 0.5, pr * 0.1, px, py, pr);
      pg.addColorStop(0, rgb(mix(hue, [255, 255, 255], 0.35)));
      pg.addColorStop(0.7, rgb(hue));
      pg.addColorStop(1, rgb(mix(hue, DARK, 0.7)));
      g.fillStyle = pg;
      g.fillRect(px - pr, py - pr, pr * 2, pr * 2);
      for (const b of bands) {
        g.fillStyle = rgb(mix(hue, [255, 255, 255], 0.4), b.a);
        g.fillRect(px - pr, py + b.y * pr, pr * 2, b.h);
      }
      const sh = g.createLinearGradient(px - pr, 0, px + pr, 0);
      sh.addColorStop(0, rgb(DARK, 0));
      sh.addColorStop(0.55, rgb(DARK, 0.1));
      sh.addColorStop(1, rgb(DARK, 0.85));
      g.fillStyle = sh;
      g.fillRect(px - pr, py - pr, pr * 2, pr * 2);
      g.restore();
      if (ringed) {
        g.strokeStyle = rgb(mix(hue, [255, 240, 220], 0.6), 0.5);
        g.lineWidth = 6 * u;
        g.beginPath();
        g.ellipse(px, py, pr * 1.7, pr * 0.28, -0.12, 0, Math.PI);
        g.stroke();
      }
      g.fillStyle = "rgb(200,196,210)";
      g.beginPath();
      g.arc(F - 150 * u, H * 0.28, 12 * u, 0, TAU);
      g.fill();
      g.fillStyle = rgb([4, 5, 16], 0.85);
      g.beginPath();
      g.arc(F - 154 * u, H * 0.28 - 2 * u, 11 * u, 0, TAU);
      g.fill();
      const sx = ((F - 60 * u + (E.still ? 0 : E.T * 6 * u)) % (W + 40 * u)) - 20 * u;
      const sy = H * 0.42;
      g.fillStyle = "rgb(30,30,40)";
      g.beginPath();
      g.moveTo(sx + 16 * u, sy);
      g.lineTo(sx - 10 * u, sy - 5 * u);
      g.lineTo(sx - 14 * u, sy);
      g.lineTo(sx - 10 * u, sy + 5 * u);
      g.closePath();
      g.fill();
      glowAt(g, sx - 15 * u, sy, 14 * u, [120, 200, 255], 0.9 * flick(E, 3));
    },
  };
}

/** A surface indoors: dim at night, its own colour by day, a little warmer by lamplight. */
export function shade(E: Env, hue: RGB, k = 0.5): RGB {
  return mix(mix(hue, DARK, 0.8), hue, clamp(0.2 + E.day * k + E.glow * 0.12));
}

function kitchen(c: Ctx): Scene {
  const { H, u, F, r } = c;
  const floor = H * 0.86;
  const wx = F - 30 * u;
  const wy = H * 0.16;
  const ww = 90 * u;
  const wh = H * 0.34;
  const win = new Path2D();
  win.rect(wx, wy, ww, wh);
  const frame = new Path2D();
  panes(frame, wx, wy, ww, wh, 2, 2, 2.5 * u);
  frame.rect(wx - 8 * u, wy + wh, ww + 16 * u, 5 * u);
  const hx = F - 190 * u;
  const hearth = new Path2D();
  hearth.rect(hx - 70 * u, H * 0.3, 140 * u, floor - H * 0.3);
  hearth.rect(hx - 80 * u, H * 0.28, 160 * u, 9 * u);
  const mouth = new Path2D();
  mouth.moveTo(hx - 48 * u, floor);
  mouth.lineTo(hx - 48 * u, H * 0.56);
  mouth.quadraticCurveTo(hx, H * 0.44, hx + 48 * u, H * 0.56);
  mouth.lineTo(hx + 48 * u, floor);
  mouth.closePath();
  const pot = new Path2D();
  pot.moveTo(hx + 22 * u, H * 0.66);
  pot.arc(hx, H * 0.66, 22 * u, 0, Math.PI);
  pot.closePath();
  pot.rect(hx - 25 * u, H * 0.645, 50 * u, 4 * u);
  pot.rect(hx - 0.8 * u, H * 0.48, 1.6 * u, H * 0.17);
  const ware = new Path2D();
  ware.rect(F - 70 * u, H * 0.07, 290 * u, 4 * u);
  for (let k = 0; k < 6; k++) {
    const x = F - 50 * u + k * 50 * u;
    ware.rect(x - 0.6 * u, H * 0.07, 1.2 * u, 14 * u);
    const y = H * 0.07 + 14 * u;
    if (k % 2) {
      circle(ware, x, y + 15 * u, 14 * u);
    } else {
      ware.moveTo(x + 13 * u, y + 6 * u);
      ware.arc(x, y + 6 * u, 13 * u, 0, Math.PI);
      ware.closePath();
      ware.rect(x - 14 * u, y + 4 * u, 28 * u, 3 * u);
    }
  }
  const herbs = new Path2D();
  for (let k = 0; k < 5; k++) {
    const x = wx + 6 * u + k * 19 * u;
    herbs.rect(x - 0.5 * u, wy - 14 * u, 1 * u, 6 * u);
    poly(herbs, x - 5 * u, wy - 8 * u, x + 5 * u, wy - 8 * u, x + 1 * u, wy + (8 + r() * 10) * u, x - 1 * u, wy + (8 + r() * 10) * u);
  }
  const shelf = new Path2D();
  shelf.rect(F + 100 * u, H * 0.4, 120 * u, 4 * u);
  const plates = new Path2D();
  for (let k = 0; k < 5; k++) {
    plates.moveTo(F + 116 * u + k * 22 * u + 3 * u, H * 0.4 - 10 * u);
    plates.ellipse(F + 116 * u + k * 22 * u, H * 0.4 - 10 * u, 3 * u, 10 * u, 0, 0, TAU);
  }
  const table = new Path2D();
  table.rect(F - 70 * u, H * 0.68, 270 * u, 7 * u);
  table.rect(F - 62 * u, H * 0.68, 6 * u, floor - H * 0.68);
  table.rect(F + 186 * u, H * 0.68, 6 * u, floor - H * 0.68);
  const bread = new Path2D();
  bread.moveTo(F + 32 * u, H * 0.68);
  bread.ellipse(F + 10 * u, H * 0.68, 22 * u, 11 * u, 0, Math.PI, TAU);
  circle(bread, F + 70 * u, H * 0.68 - 9 * u, 9 * u);
  const jug = new Path2D();
  jug.moveTo(F + 120 * u, H * 0.68);
  jug.quadraticCurveTo(F + 108 * u, H * 0.6, F + 116 * u, H * 0.56);
  jug.lineTo(F + 132 * u, H * 0.56);
  jug.quadraticCurveTo(F + 142 * u, H * 0.6, F + 132 * u, H * 0.68);
  jug.closePath();
  return room(
    c,
    win,
    [214, 186, 146],
    hillView(c),
    (g, E) => {
      spill(g, E, wx, wx + ww, wy + wh, floor, 60 * u);
      fill(g, frame, shade(E, [120, 90, 64]));
      fill(g, herbs, shade(E, [110, 140, 70]));
      fill(g, hearth, shade(E, [150, 110, 90], 0.4));
      fill(g, mouth, [20, 12, 12]);
      glowAt(g, hx, floor - 10 * u, 170 * u, [255, 140, 60], 0.45);
      fire(g, E, hx, floor - 4 * u, u * 1.3);
      fill(g, pot, [26, 22, 24]);
      smoke(g, E, hx, H * 0.6, u * 0.7);
      fill(g, ware, shade(E, [150, 110, 80], 0.45));
      fill(g, shelf, shade(E, [120, 84, 56]));
      fill(g, plates, shade(E, [220, 220, 210], 0.6));
      fill(g, table, shade(E, [130, 92, 60]));
      fill(g, bread, shade(E, [210, 150, 80], 0.7));
      fill(g, jug, shade(E, [90, 120, 160], 0.6));
      g.fillStyle = rgb(shade(E, [240, 230, 210]));
      g.fillRect(F + 160 * u, H * 0.6, 5 * u, 16 * u);
      lamp(g, E, F + 162 * u, H * 0.585, 70 * u, 4, WARM, 0.35);
    },
    floor,
  );
}

function chapel(c: Ctx): Scene {
  const { H, u, F, r } = c;
  const floor = H * 0.8;
  const lancet = (p: Path2D, x: number, w: number, top: number, bot: number) => {
    p.moveTo(x, bot);
    p.lineTo(x, top + w * 0.6);
    p.quadraticCurveTo(x, top + w * 0.1, x + w / 2, top);
    p.quadraticCurveTo(x + w, top + w * 0.1, x + w, top + w * 0.6);
    p.lineTo(x + w, bot);
    p.closePath();
  };
  const wins = [
    [F - 190 * u, 46 * u, H * 0.14],
    [F - 34 * u, 68 * u, H * 0.06],
    [F + 140 * u, 46 * u, H * 0.14],
  ] as const;
  const win = new Path2D();
  for (const [x, w, t] of wins) lancet(win, x, w, t, H * 0.56);
  const glassC: RGB[] = [
    [200, 50, 70],
    [50, 100, 210],
    [230, 180, 50],
    [60, 170, 110],
    [150, 70, 190],
  ];
  const tiles = wins.flatMap(([x, w, t]) => {
    const out: { x: number; y: number; w: number; h: number; c: RGB }[] = [];
    for (let y = t; y < H * 0.56; y += 11 * u) for (let k = 0; k < 3; k++) out.push({ x: x + (w * k) / 3, y, w: w / 3, h: 11 * u, c: glassC[(r() * glassC.length) | 0]! });
    return out;
  });
  const lead = new Path2D();
  for (const [x, w, t] of wins) {
    for (let k = 1; k < 3; k++) lead.rect(x + (w * k) / 3 - 0.7 * u, t, 1.4 * u, H * 0.56 - t);
    for (let y = t + 11 * u; y < H * 0.56; y += 11 * u) lead.rect(x, y - 0.6 * u, w, 1.2 * u);
  }
  const arches = new Path2D();
  for (const [x, w, t] of wins) {
    arches.moveTo(x - 8 * u, H * 0.58);
    arches.lineTo(x - 8 * u, t + w * 0.6);
    arches.quadraticCurveTo(x - 8 * u, t - 6 * u, x + w / 2, t - 14 * u);
    arches.quadraticCurveTo(x + w + 8 * u, t - 6 * u, x + w + 8 * u, t + w * 0.6);
    arches.lineTo(x + w + 8 * u, H * 0.58);
  }
  const altar = new Path2D();
  altar.rect(F - 40 * u, H * 0.66, 80 * u, floor - H * 0.66);
  altar.rect(F - 46 * u, H * 0.65, 92 * u, 5 * u);
  for (let k = 0; k < 2; k++) altar.rect(F - 60 * u - k * 14 * u, floor + k * 5 * u, 120 * u + k * 28 * u, 5 * u);
  const cloth = new Path2D();
  cloth.rect(F - 14 * u, H * 0.655, 28 * u, 46 * u);
  const pews = new Path2D();
  for (let k = 0; k < 4; k++) {
    const y = floor + 14 * u + k * k * 6 * u + k * 10 * u;
    const s = 1 + k * 0.35;
    for (const side of [-1, 1]) {
      const x0 = side < 0 ? F - (30 + 190 * s) * u : F + 30 * u;
      pews.rect(x0, y - 18 * u * s, 190 * s * u, 4 * u * s);
      pews.rect(x0, y - 6 * u * s, 190 * s * u, 6 * u * s);
    }
  }
  const candles = [-26, -14, 14, 26].map((dx) => F + dx * u);
  const stand = [F - 120 * u, F + 110 * u];
  return room(
    c,
    win,
    [176, 166, 156],
    (g, E) => fill(g, ridge(c, H * 0.5, 6 * u).p, tone(E, 0.4, GRASS, 0.4)),
    (g, E) => {
      const lt = 0.18 + E.day * 0.55 * (1 - E.c.cloud * 0.4);
      for (const t of tiles) {
        g.fillStyle = rgb(mix(DARK, t.c, lt + 0.15), 0.85);
        g.fillRect(t.x, t.y, t.w, t.h);
      }
      fill(g, lead, [20, 18, 22]);
      stroke(g, arches, shade(E, [150, 140, 130], 0.35), 3 * u);
      if (E.day > 0.3)
        wins.forEach(([x, w], i) => {
          g.fillStyle = rgb(glassC[i * 2]!, 0.1 * E.day * (1 - E.c.cloud * 0.5));
          g.beginPath();
          g.moveTo(x, H * 0.56);
          g.lineTo(x + w, H * 0.56);
          g.lineTo(x + w + 60 * u, H);
          g.lineTo(x + 30 * u, H);
          g.fill();
        });
      fill(g, altar, shade(E, [180, 170, 160], 0.4));
      fill(g, cloth, shade(E, [170, 40, 50], 0.5));
      for (const x of candles) {
        g.fillStyle = rgb([236, 226, 200], 0.9);
        g.fillRect(x - 1.5 * u, H * 0.6, 3 * u, 12 * u);
        lamp(g, E, x, H * 0.595, 30 * u, x, WARM, 0.6);
      }
      for (const x of stand) {
        g.fillStyle = rgb([30, 26, 24]);
        g.fillRect(x - 1.5 * u, H * 0.5, 3 * u, floor - H * 0.5);
        for (let k = -2; k <= 2; k++) lamp(g, E, x + k * 6 * u, H * 0.49 - Math.abs(k) * -2 * u, 18 * u, x + k, WARM, 0.6);
      }
      fill(g, pews, shade(E, [110, 70, 46], 0.35));
    },
    floor,
  );
}

function shipcabin(c: Ctx): Scene {
  const { W, H, u, F, r } = c;
  const floor = H * 0.86;
  const ports = [F - 160 * u, F - 40 * u];
  const pr = 32 * u;
  const py = H * 0.34;
  const win = new Path2D();
  for (const x of ports) circle(win, x, py, pr);
  const sh = shims(c, 50);
  const rims = new Path2D();
  for (const x of ports) {
    rims.moveTo(x + pr + 7 * u, py);
    rims.arc(x, py, pr + 7 * u, 0, TAU);
    rims.moveTo(x + pr, py);
    rims.arc(x, py, pr, 0, TAU, true);
    for (let k = 0; k < 6; k++) circle(rims, x + Math.cos((k / 6) * TAU) * (pr + 3.5 * u), py + Math.sin((k / 6) * TAU) * (pr + 3.5 * u), 1.4 * u);
  }
  const planks = new Path2D();
  for (let y = 10 * u; y < floor; y += 16 * u) {
    planks.moveTo(0, y);
    planks.lineTo(W, y);
  }
  const beams = new Path2D();
  beams.moveTo(0, 0);
  beams.lineTo(W, 0);
  beams.lineTo(W, 10 * u);
  beams.quadraticCurveTo(W / 2, 22 * u, 0, 10 * u);
  beams.closePath();
  for (const x of [F - 250 * u, F + 30 * u, F + 250 * u]) beams.rect(x, 0, 12 * u, floor);
  const table = new Path2D();
  table.rect(F + 60 * u, H * 0.66, 170 * u, 7 * u);
  table.rect(F + 70 * u, H * 0.66, 7 * u, floor - H * 0.66);
  table.rect(F + 212 * u, H * 0.66, 7 * u, floor - H * 0.66);
  const chart = new Path2D();
  poly(chart, F + 80 * u, H * 0.655, F + 190 * u, H * 0.655, F + 196 * u, H * 0.635, F + 86 * u, H * 0.635);
  const lines = new Path2D();
  for (let k = 0; k < 5; k++) {
    lines.moveTo(F + (90 + r() * 30) * u, H * 0.65);
    lines.lineTo(F + (140 + r() * 50) * u, H * 0.64);
  }
  const ham = new Path2D();
  ham.moveTo(F - 260 * u, H * 0.52);
  ham.quadraticCurveTo(F - 170 * u, H * 0.82, F - 80 * u, H * 0.52);
  ham.quadraticCurveTo(F - 170 * u, H * 0.74, F - 260 * u, H * 0.52);
  const lx = F + 120 * u;
  return room(
    c,
    win,
    [130, 90, 60],
    (g, E) => {
      const tilt = E.still ? 0.03 : Math.sin(E.T * 0.6) * 0.06;
      g.save();
      g.translate(F - 100 * u, py);
      g.rotate(tilt);
      g.translate(-(F - 100 * u), -py);
      g.fillStyle = rgb(E.sky.bot);
      g.fillRect(F - 300 * u, py - 80 * u, 400 * u, 30 * u);
      water(g, E, { ...c, W: W + 200 * u }, py + 4 * u, sh, undefined, py + 120 * u);
      g.restore();
    },
    (g, E) => {
      stroke(g, planks, DARK, 1 * u, 0.35);
      fill(g, beams, shade(E, [90, 60, 40], 0.4));
      fill(g, rims, shade(E, [200, 160, 70], 0.6));
      stroke(g, ham, shade(E, [200, 180, 140], 0.5), 2 * u);
      g.fillStyle = rgb(shade(E, [190, 170, 130], 0.5), 0.9);
      g.fill(ham);
      fill(g, table, shade(E, [120, 80, 50]));
      fill(g, chart, shade(E, [230, 210, 170], 0.7));
      stroke(g, lines, [120, 70, 40], 0.8 * u, 0.6);
      const sw = E.still ? 0.1 : Math.sin(E.T * 1.2) * 0.18;
      g.save();
      g.translate(lx, 16 * u);
      g.rotate(sw);
      g.strokeStyle = rgb([30, 22, 18]);
      g.lineWidth = 1.2 * u;
      g.beginPath();
      g.moveTo(0, 0);
      g.lineTo(0, H * 0.24);
      g.stroke();
      g.fillStyle = rgb([40, 30, 22]);
      g.fillRect(-7 * u, H * 0.24, 14 * u, 18 * u);
      lamp(g, E, 0, H * 0.24 + 9 * u, 110 * u, 2, WARM, 0.5);
      g.restore();
    },
    floor,
  );
}

function starship(c: Ctx): Scene {
  const { W, H, u, F, r } = c;
  const floor = H * 0.9;
  const win = new Path2D();
  win.moveTo(F - 250 * u, H * 0.58);
  win.lineTo(F - 230 * u, H * 0.12);
  win.quadraticCurveTo(F - 40 * u, H * 0.04, F + 150 * u, H * 0.12);
  win.lineTo(F + 170 * u, H * 0.58);
  win.quadraticCurveTo(F - 40 * u, H * 0.64, F - 250 * u, H * 0.58);
  win.closePath();
  const out = space({ ...c, r: rand(seedOf("bridge") + Math.floor(r() * 99)), F: F - 60 * u });
  const struts = new Path2D();
  for (const x of [F - 140 * u, F - 40 * u, F + 60 * u]) poly(struts, x - 3 * u, H * 0.08, x + 3 * u, H * 0.08, x + 4 * u, H * 0.64, x - 4 * u, H * 0.64);
  const seams = new Path2D();
  for (let x = 0; x < W; x += 60 * u) {
    seams.moveTo(x, 0);
    seams.lineTo(x, floor);
  }
  for (const y of [0.7, 0.8]) {
    seams.moveTo(0, H * y);
    seams.lineTo(W, H * y);
  }
  const desk = new Path2D();
  desk.moveTo(F - 300 * u, H);
  desk.lineTo(F - 290 * u, H * 0.74);
  desk.quadraticCurveTo(F - 40 * u, H * 0.66, F + 220 * u, H * 0.74);
  desk.lineTo(F + 230 * u, H);
  desk.closePath();
  const screens = Array.from({ length: 6 }, (_, k) => ({ x: F - 250 * u + k * 78 * u, y: H * 0.715 + Math.abs(k - 2.5) * 4 * u, c: k % 3 === 1 ? ([255, 180, 80] as RGB) : ([90, 220, 255] as RGB), p: r() * TAU }));
  const chair = new Path2D();
  chair.moveTo(F - 70 * u, H);
  chair.lineTo(F - 66 * u, H * 0.66);
  chair.quadraticCurveTo(F - 40 * u, H * 0.58, F - 14 * u, H * 0.66);
  chair.lineTo(F - 10 * u, H);
  chair.closePath();
  chair.rect(F - 86 * u, H * 0.8, 16 * u, 6 * u);
  chair.rect(F - 10 * u, H * 0.8, 16 * u, 6 * u);
  const blinks = Array.from({ length: 24 }, () => ({ x: F - 270 * u + r() * 480 * u, y: H * (0.8 + r() * 0.12), p: r() * TAU, c: ([[255, 80, 80], [80, 255, 160], [90, 200, 255], [255, 200, 80]] as RGB[])[(r() * 4) | 0]! }));
  return room(
    c,
    win,
    [90, 100, 124],
    (g, E) => out.draw(g, E),
    (g, E) => {
      stroke(g, seams, DARK, 1 * u, 0.4);
      fill(g, struts, [40, 46, 60]);
      const strip = g.createLinearGradient(0, 0, 0, 14 * u);
      strip.addColorStop(0, "rgba(150,220,255,0.5)");
      strip.addColorStop(1, "rgba(150,220,255,0)");
      g.fillStyle = strip;
      g.fillRect(0, 0, W, 14 * u);
      fill(g, desk, [34, 38, 52]);
      for (const s of screens) {
        g.fillStyle = rgb(s.c, 0.25);
        g.fillRect(s.x, s.y, 56 * u, 14 * u);
        g.strokeStyle = rgb(s.c, 0.8);
        g.lineWidth = 1 * u;
        g.beginPath();
        for (let x = 0; x <= 56 * u; x += 4 * u) g.lineTo(s.x + x, s.y + 7 * u + Math.sin(x / (6 * u) + E.T * 2 + s.p) * 4 * u);
        g.stroke();
        glowAt(g, s.x + 28 * u, s.y + 7 * u, 50 * u, s.c, 0.18);
      }
      for (const b of blinks) {
        const on = E.still || Math.sin(E.T * 2.5 + b.p) > 0;
        g.fillStyle = rgb(b.c, on ? 0.95 : 0.2);
        g.fillRect(b.x, b.y, 2.4 * u, 2.4 * u);
      }
      fill(g, chair, [22, 24, 32]);
    },
    floor,
    { lift: 0.32, space: true },
  );
}

function train(c: Ctx): Scene {
  const { W, H, u, F, r } = c;
  const floor = H * 0.88;
  const xs = [F - 260 * u, F - 120 * u, F + 20 * u, F + 160 * u];
  const win = new Path2D();
  for (const x of xs) win.roundRect(x, H * 0.2, 110 * u, H * 0.36, 12 * u);
  const ph = [r() * TAU, r() * TAU];
  const posts = Array.from({ length: 6 }, () => r());
  const trees = Array.from({ length: 14 }, () => ({ x: r(), h: (20 + r() * 30) * u }));
  const seats = new Path2D();
  for (const x of xs) {
    seats.roundRect(x + 4 * u, H * 0.6, 46 * u, H * 0.26, 8 * u);
    seats.roundRect(x + 60 * u, H * 0.6, 46 * u, H * 0.26, 8 * u);
  }
  seats.rect(0, H * 0.78, W, 8 * u);
  const rack = new Path2D();
  rack.rect(0, H * 0.12, W, 2 * u);
  rack.rect(0, H * 0.155, W, 2 * u);
  for (let x = 0; x < W; x += 14 * u) rack.rect(x, H * 0.12, 1 * u, H * 0.037);
  const bags = new Path2D();
  for (let i = 0; i < 4; i++) bags.roundRect(F - 220 * u + i * 110 * u + r() * 30 * u, H * 0.06, (36 + r() * 30) * u, H * 0.06, 3 * u);
  const sconces = [F - 135 * u, F + 5 * u, F + 145 * u];
  return room(
    c,
    win,
    [128, 60, 54],
    (g, E) => {
      const T = E.still ? 0 : E.T;
      g.fillStyle = rgb(tone(E, 0.2, GRASS, 0.4));
      g.beginPath();
      g.moveTo(0, H);
      for (let x = 0; x <= W; x += 8 * u) g.lineTo(x, H * 0.42 - Math.sin((x + T * 20 * u) / (120 * u) + ph[0]!) * 12 * u - Math.sin((x + T * 20 * u) / (47 * u) + ph[1]!) * 5 * u);
      g.lineTo(W, H);
      g.fill();
      g.fillStyle = rgb(tone(E, 0.5, GRASS, 0.5));
      for (const t of trees) {
        const x = ((((t.x * W * 1.4 - T * 90 * u) % (W * 1.4)) + W * 1.4) % (W * 1.4)) - W * 0.2;
        g.beginPath();
        g.arc(x, H * 0.5 - t.h * 0.5, t.h * 0.45, 0, TAU);
        g.fill();
      }
      g.fillStyle = rgb(tone(E, 0.65, GRASS, 0.5));
      g.fillRect(0, H * 0.5, W, H * 0.5);
      g.fillStyle = rgb(tone(E, 0.85));
      for (const p of posts) {
        const x = ((((p * W * 1.5 - T * 340 * u) % (W * 1.5)) + W * 1.5) % (W * 1.5)) - W * 0.25;
        g.fillRect(x, H * 0.18, 3 * u, H * 0.4);
        g.fillRect(x - 8 * u, H * 0.21, 19 * u, 2 * u);
      }
    },
    (g, E) => {
      fill(g, rack, shade(E, [200, 170, 100], 0.4));
      fill(g, bags, shade(E, [120, 80, 50]));
      fill(g, seats, shade(E, [60, 80, 70], 0.45));
      for (const x of sconces) lamp(g, E, x, H * 0.28, 50 * u, x, WARM, 0.4);
    },
    floor,
  );
}

function shop(c: Ctx): Scene {
  const { H, u, F, r } = c;
  const floor = H * 0.88;
  const wx = F - 60 * u;
  const ww = 130 * u;
  const win = new Path2D();
  win.rect(wx, H * 0.14, ww, H * 0.4);
  const frame = new Path2D();
  panes(frame, wx, H * 0.14, ww, H * 0.4, 3, 3, 2.2 * u);
  const shelves = new Path2D();
  const jars: { x: number; y: number; w: number; h: number; c: RGB; glow: boolean }[] = [];
  const brews: RGB[] = [
    [120, 220, 140],
    [230, 90, 120],
    [110, 150, 255],
    [250, 200, 90],
    [190, 120, 240],
  ];
  for (const [x0, x1] of [
    [F - 270 * u, F - 80 * u],
    [F + 90 * u, F + 280 * u],
  ] as const)
    for (let y = H * 0.18; y < H * 0.66; y += 40 * u) {
      shelves.rect(x0, y + 30 * u, x1 - x0, 4 * u);
      for (let x = x0 + 4 * u; x < x1 - 14 * u; x += (16 + r() * 8) * u) jars.push({ x, y: y + 30 * u, w: (9 + r() * 6) * u, h: (14 + r() * 12) * u, c: brews[(r() * brews.length) | 0]!, glow: r() < 0.25 });
    }
  const counter = new Path2D();
  counter.rect(F - 140 * u, H * 0.7, 300 * u, floor - H * 0.7);
  counter.rect(F - 146 * u, H * 0.68, 312 * u, 7 * u);
  const scale = new Path2D();
  const sx = F + 80 * u;
  scale.rect(sx - 1 * u, H * 0.56, 2 * u, H * 0.12);
  scale.rect(sx - 26 * u, H * 0.56, 52 * u, 1.6 * u);
  for (const d of [-22, 22]) {
    scale.moveTo(sx + d * u + 9 * u, H * 0.6);
    scale.arc(sx + d * u, H * 0.6, 9 * u, 0, Math.PI);
    scale.closePath();
  }
  const dried = new Path2D();
  for (let k = 0; k < 8; k++) {
    const x = F - 200 * u + k * 48 * u;
    dried.rect(x - 0.5 * u, 0, 1 * u, 12 * u);
    poly(dried, x - 6 * u, 12 * u, x + 6 * u, 12 * u, x + 1 * u, (40 + r() * 14) * u, x - 1 * u, (40 + r() * 14) * u);
  }
  return room(
    c,
    win,
    [120, 96, 120],
    townView(c),
    (g, E) => {
      spill(g, E, wx, wx + ww, H * 0.54, floor, 50 * u);
      fill(g, frame, shade(E, [90, 60, 40]));
      fill(g, shelves, shade(E, [110, 76, 50]));
      for (const j of jars) {
        g.fillStyle = rgb(mix(shade(E, [200, 210, 220], 0.4), j.c, 0.55), 0.85);
        g.beginPath();
        g.roundRect(j.x, j.y - j.h, j.w, j.h, 3 * u);
        g.fill();
        g.fillStyle = rgb([40, 30, 26]);
        g.fillRect(j.x + j.w * 0.25, j.y - j.h - 3 * u, j.w * 0.5, 3 * u);
        if (j.glow) glowAt(g, j.x + j.w / 2, j.y - j.h / 2, 26 * u, j.c, 0.25 + 0.4 * E.glow * flick(E, j.x));
      }
      fill(g, dried, shade(E, [140, 130, 70], 0.45));
      fill(g, counter, shade(E, [100, 66, 44]));
      fill(g, scale, shade(E, [210, 170, 80], 0.6));
      lamp(g, E, F - 90 * u, H * 0.62, 80 * u, 1, WARM, 0.4);
      g.fillStyle = rgb([236, 226, 200]);
      g.fillRect(F - 92 * u, H * 0.635, 4 * u, 12 * u);
    },
    floor,
  );
}

function forge(c: Ctx): Scene {
  const { H, u, F, r } = c;
  const floor = H * 0.86;
  const wx = F - 210 * u;
  const win = new Path2D();
  win.rect(wx, H * 0.14, 60 * u, H * 0.26);
  const frame = new Path2D();
  panes(frame, wx, H * 0.14, 60 * u, H * 0.26, 2, 2, 2 * u);
  const fx = F + 110 * u;
  const hood = new Path2D();
  poly(hood, fx - 30 * u, 0, fx + 30 * u, 0, fx + 80 * u, H * 0.4, fx - 80 * u, H * 0.4);
  const hearth = new Path2D();
  hearth.rect(fx - 84 * u, H * 0.56, 168 * u, floor - H * 0.56);
  const coals = new Path2D();
  coals.moveTo(fx - 60 * u, H * 0.6);
  coals.quadraticCurveTo(fx, H * 0.5, fx + 60 * u, H * 0.6);
  coals.closePath();
  const anvil = new Path2D();
  const ax = F - 40 * u;
  const ay = H * 0.66;
  anvil.rect(ax - 20 * u, ay + 20 * u, 40 * u, floor - ay - 20 * u);
  anvil.moveTo(ax - 50 * u, ay);
  anvil.quadraticCurveTo(ax - 30 * u, ay + 2 * u, ax - 26 * u, ay + 12 * u);
  anvil.lineTo(ax - 12 * u, ay + 12 * u);
  anvil.lineTo(ax - 16 * u, ay + 22 * u);
  anvil.lineTo(ax + 16 * u, ay + 22 * u);
  anvil.lineTo(ax + 12 * u, ay + 12 * u);
  anvil.lineTo(ax + 34 * u, ay + 12 * u);
  anvil.lineTo(ax + 34 * u, ay);
  anvil.closePath();
  const tools = new Path2D();
  tools.rect(F - 260 * u, H * 0.5, 120 * u, 3 * u);
  for (let k = 0; k < 6; k++) {
    const x = F - 252 * u + k * 20 * u;
    tools.rect(x, H * 0.5, 2.4 * u, (40 + r() * 30) * u);
    if (k % 2) tools.rect(x - 5 * u, H * 0.5 + (36 + r() * 20) * u, 12 * u, 7 * u);
    else poly(tools, x - 4 * u, H * 0.5 + 40 * u, x + 1.2 * u, H * 0.5 + 34 * u, x + 6 * u, H * 0.5 + 40 * u);
  }
  const barrel = new Path2D();
  barrel.roundRect(F + 220 * u, H * 0.7, 46 * u, floor - H * 0.7, 6 * u);
  const sparks = Array.from({ length: c.mini ? 14 : 28 }, () => ({ a: -Math.PI / 2 + (r() - 0.5) * 2.4, v: (40 + r() * 80) * u, p: r() }));
  return room(
    c,
    win,
    [120, 100, 90],
    hillView(c),
    (g, E) => {
      fill(g, frame, [30, 24, 22]);
      fill(g, tools, [36, 30, 30]);
      fill(g, hood, shade(E, [90, 80, 76], 0.3));
      fill(g, hearth, shade(E, [120, 100, 90], 0.35));
      const pulse = flick(E, 7);
      glowAt(g, fx, H * 0.56, 260 * u * pulse, [255, 120, 40], 0.5);
      const cg = g.createLinearGradient(0, H * 0.5, 0, H * 0.6);
      cg.addColorStop(0, rgb([255, 230, 140]));
      cg.addColorStop(1, rgb([220, 60, 20]));
      g.fillStyle = cg;
      g.fill(coals);
      fill(g, anvil, [28, 26, 30]);
      g.fillStyle = rgb([255, 150, 70], 0.9);
      g.fillRect(ax - 30 * u, ay - 2 * u, 26 * u, 3 * u);
      glowAt(g, ax - 18 * u, ay, 40 * u, [255, 140, 60], 0.5);
      const T = E.still ? 0.3 : E.T;
      for (const s of sparks) {
        const k = (T * 0.9 + s.p) % 1;
        const x = ax - 18 * u + Math.cos(s.a) * s.v * k;
        const y = ay + Math.sin(s.a) * s.v * k + k * k * 60 * u;
        g.fillStyle = rgb([255, 200, 100], 1 - k);
        g.fillRect(x, y, 1.6 * u, 1.6 * u);
      }
      fill(g, barrel, shade(E, [110, 76, 50]));
    },
    floor,
  );
}

function cafe(c: Ctx): Scene {
  const { W, H, u, F, r } = c;
  const floor = H * 0.86;
  const wx = F - 270 * u;
  const ww = 290 * u;
  const win = new Path2D();
  win.rect(wx, H * 0.1, ww, H * 0.5);
  const frame = new Path2D();
  panes(frame, wx, H * 0.1, ww, H * 0.5, 3, 1, 2.4 * u);
  const city_ = city({ ...c, r: rand(seedOf("cafe") + Math.floor(r() * 99)) });
  const neon = new Path2D();
  const nx = wx + 50 * u;
  const ny = H * 0.3;
  neon.moveTo(nx, ny);
  neon.lineTo(nx + 30 * u, ny);
  neon.quadraticCurveTo(nx + 30 * u, ny + 26 * u, nx + 15 * u, ny + 26 * u);
  neon.quadraticCurveTo(nx, ny + 26 * u, nx, ny);
  neon.moveTo(nx + 30 * u, ny + 6 * u);
  neon.quadraticCurveTo(nx + 42 * u, ny + 8 * u, nx + 30 * u, ny + 16 * u);
  for (const d of [8, 16, 24]) {
    neon.moveTo(nx + d * u, ny - 4 * u);
    neon.quadraticCurveTo(nx + d * u - 4 * u, ny - 10 * u, nx + d * u, ny - 16 * u);
  }
  const counter = new Path2D();
  counter.rect(F + 60 * u, H * 0.66, W, floor - H * 0.66);
  counter.rect(F + 54 * u, H * 0.64, W, 7 * u);
  const machine = new Path2D();
  machine.roundRect(F + 120 * u, H * 0.48, 60 * u, H * 0.16, 4 * u);
  machine.rect(F + 130 * u, H * 0.6, 4 * u, 8 * u);
  machine.rect(F + 160 * u, H * 0.6, 4 * u, 8 * u);
  const dome = new Path2D();
  dome.moveTo(F + 240 * u, H * 0.64);
  dome.arc(F + 220 * u, H * 0.64, 20 * u, 0, Math.PI, true);
  dome.closePath();
  const table = new Path2D();
  table.ellipse(F - 120 * u, H * 0.66, 40 * u, 6 * u, 0, 0, TAU);
  table.rect(F - 122 * u, H * 0.66, 4 * u, floor - H * 0.66);
  for (const d of [-60, 60]) {
    table.rect(F - 120 * u + d * u - 14 * u, H * 0.68, 28 * u, 5 * u);
    table.rect(F - 120 * u + d * u + (d < 0 ? -14 : 10) * u, H * 0.52, 4 * u, H * 0.34);
  }
  const cups = new Path2D();
  for (const d of [-14, 12]) cups.roundRect(F - 120 * u + d * u, H * 0.635, 9 * u, 9 * u, 2 * u);
  const pend = [F - 150 * u, F - 60 * u, F + 150 * u];
  const hue = ([[60, 110, 100], [170, 90, 70], [80, 80, 130]] as RGB[])[(r() * 3) | 0]!;
  return room(
    c,
    win,
    hue,
    (g, E) => city_.draw(g, E),
    (g, E) => {
      fill(g, frame, [30, 26, 28]);
      g.save();
      g.strokeStyle = rgb([255, 90, 170], 0.95);
      g.lineWidth = 2.2 * u;
      g.shadowColor = "rgb(255,90,170)";
      g.shadowBlur = 12 * u;
      g.stroke(neon);
      g.restore();
      glowAt(g, nx + 18 * u, ny + 8 * u, 60 * u, [255, 90, 170], 0.3 * flick(E, 9));
      fill(g, counter, shade(E, [120, 80, 56]));
      fill(g, machine, shade(E, [190, 196, 204], 0.6));
      g.fillStyle = rgb([255, 255, 255], 0.25);
      g.fill(dome);
      fill(g, table, shade(E, [60, 44, 36], 0.4));
      fill(g, cups, shade(E, [240, 236, 228], 0.6));
      if (!E.still)
        for (let i = 0; i < 3; i++) {
          const k = (E.T * 0.25 + i / 3) % 1;
          g.fillStyle = rgb([230, 230, 240], 0.16 * (1 - k));
          g.beginPath();
          g.arc(F - 130 * u + Math.sin(k * 6 + i) * 3 * u, H * 0.62 - k * 30 * u, (2 + k * 4) * u, 0, TAU);
          g.fill();
        }
      for (const x of pend) {
        g.strokeStyle = rgb([20, 18, 20]);
        g.lineWidth = 1 * u;
        g.beginPath();
        g.moveTo(x, 0);
        g.lineTo(x, H * 0.3);
        g.stroke();
        g.fillStyle = rgb([30, 28, 30]);
        g.beginPath();
        g.moveTo(x - 14 * u, H * 0.36);
        g.lineTo(x - 5 * u, H * 0.3);
        g.lineTo(x + 5 * u, H * 0.3);
        g.lineTo(x + 14 * u, H * 0.36);
        g.fill();
        lamp(g, E, x, H * 0.365, 80 * u, x, WARM, 0.55);
      }
    },
    floor,
  );
}

function greenhouse(c: Ctx): Scene {
  const { W, H, u, F, r } = c;
  const floor = H * 0.84;
  const win = new Path2D();
  const pw = 34 * u;
  for (let x = -pw; x < W + pw; x += pw)
    for (let y = 6 * u; y < floor - 30 * u; y += 44 * u) {
      const k = Math.abs(x + pw / 2 - F) / (W * 0.9);
      const top = H * 0.04 + k * k * H * 0.3;
      if (y + 40 * u < top) continue;
      win.rect(x + 1.5 * u, Math.max(y, top) + 1.5 * u, pw - 3 * u, Math.min(41 * u, y + 44 * u - Math.max(y, top)) - 3 * u);
    }
  const pots = new Path2D();
  const greens = new Path2D();
  const blooms: { x: number; y: number; c: RGB }[] = [];
  for (const [dx, h, kind] of [
    [-230, 110, 0],
    [-120, 70, 1],
    [-30, 130, 0],
    [90, 80, 1],
    [190, 120, 0],
  ] as const) {
    const x = F + dx * u;
    poly(pots, x - 18 * u, floor - 30 * u, x + 18 * u, floor - 30 * u, x + 13 * u, floor, x - 13 * u, floor);
    if (kind === 0) palm(greens, x, floor - 30 * u, h * u, (r() - 0.5) * 20 * u);
    else {
      leafy(greens, x, floor - 30 * u, h * u);
      for (let k = 0; k < 8; k++) blooms.push({ x: x + (r() - 0.5) * h * 0.6 * u, y: floor - 30 * u - h * u * (0.5 + r() * 0.4), c: ([[240, 120, 150], [250, 210, 90], [200, 140, 240]] as RGB[])[k % 3]! });
    }
  }
  const ferns = Array.from({ length: 3 }, (_, i) => ({ x: F - 180 * u + i * 160 * u, p: r() * TAU }));
  const bench = new Path2D();
  bench.rect(F - 300 * u, floor - 4 * u, W + 300 * u, 4 * u);
  return room(
    c,
    win,
    [236, 238, 232],
    hillView(c),
    (g, E) => {
      const hz = g.createLinearGradient(0, 0, 0, floor);
      hz.addColorStop(0, rgb([255, 255, 255], 0));
      hz.addColorStop(1, rgb(mix([200, 230, 210], E.sky.bot, 0.4), 0.25));
      g.fillStyle = hz;
      g.fillRect(0, 0, W, floor);
      fill(g, greens, shade(E, [60, 120, 70], 0.55));
      for (const b of blooms) {
        g.fillStyle = rgb(shade(E, b.c, 0.6));
        g.beginPath();
        g.arc(b.x, b.y, 3.5 * u, 0, TAU);
        g.fill();
      }
      fill(g, pots, shade(E, [190, 110, 80], 0.55));
      fill(g, bench, shade(E, [150, 150, 140]));
      for (const f of ferns) {
        g.strokeStyle = rgb([30, 26, 24]);
        g.lineWidth = 1 * u;
        g.beginPath();
        g.moveTo(f.x, 0);
        g.lineTo(f.x, H * 0.16);
        g.stroke();
        g.fillStyle = rgb(shade(E, [140, 100, 70]));
        g.beginPath();
        g.arc(f.x, H * 0.16, 12 * u, 0, Math.PI);
        g.fill();
        g.strokeStyle = rgb(shade(E, [70, 140, 80], 0.55));
        g.lineWidth = 2 * u;
        for (let k = -3; k <= 3; k++) {
          const s = E.still ? 0 : Math.sin(E.T + f.p + k) * 2 * u;
          g.beginPath();
          g.moveTo(f.x, H * 0.17);
          g.quadraticCurveTo(f.x + k * 9 * u, H * 0.2, f.x + k * 7 * u + s, H * (0.28 + Math.abs(k) * -0.01 + 0.04));
          g.stroke();
        }
      }
      if (E.glow > 0.4) for (const x of [F - 80 * u, F + 140 * u]) lamp(g, E, x, H * 0.12, 70 * u, x, WARM, 0);
    },
    floor,
  );
}

function cellar(c: Ctx): Scene {
  const { W, H, u, F, r } = c;
  const floor = H * 0.88;
  const gx = F + 120 * u;
  const win = new Path2D();
  win.rect(gx, H * 0.06, 54 * u, 20 * u);
  const grate = new Path2D();
  for (let x = gx + 8 * u; x < gx + 54 * u; x += 10 * u) grate.rect(x, H * 0.06, 2 * u, 20 * u);
  const bricks = new Path2D();
  for (let y = 0, row = 0; y < floor; y += 12 * u, row++) {
    bricks.moveTo(0, y);
    bricks.lineTo(W, y);
    for (let x = row % 2 ? 0 : 13 * u; x < W; x += 26 * u) {
      bricks.moveTo(x, y);
      bricks.lineTo(x, y + 12 * u);
    }
  }
  const vault = new Path2D();
  for (const x of [F - 210 * u, F + 10 * u]) {
    vault.moveTo(x - 100 * u, floor);
    vault.lineTo(x - 100 * u, H * 0.4);
    vault.quadraticCurveTo(x - 100 * u, H * 0.06, x, H * 0.06);
    vault.quadraticCurveTo(x + 100 * u, H * 0.06, x + 100 * u, H * 0.4);
    vault.lineTo(x + 100 * u, floor);
    vault.lineTo(x + 84 * u, floor);
    vault.lineTo(x + 84 * u, H * 0.42);
    vault.quadraticCurveTo(x + 84 * u, H * 0.14, x, H * 0.14);
    vault.quadraticCurveTo(x - 84 * u, H * 0.14, x - 84 * u, H * 0.42);
    vault.lineTo(x - 84 * u, floor);
    vault.closePath();
  }
  const barrels: { x: number; y: number; r: number }[] = [];
  for (let row = 0; row < 2; row++) for (let k = 0; k < 5 - row; k++) barrels.push({ x: F - 280 * u + k * 46 * u + row * 23 * u, y: floor - 22 * u - row * 40 * u, r: 22 * u });
  const rack = new Path2D();
  const rx = F + 40 * u;
  for (let k = 0; k <= 6; k++) {
    rack.moveTo(rx + k * 20 * u, H * 0.42);
    rack.lineTo(rx + k * 20 * u - 60 * u, floor);
    rack.moveTo(rx + k * 20 * u - 60 * u, H * 0.42);
    rack.lineTo(rx + k * 20 * u, floor);
  }
  const bottles = Array.from({ length: 22 }, () => ({ x: rx - 50 * u + r() * 160 * u, y: H * 0.46 + r() * (floor - H * 0.5) }));
  return room(
    c,
    win,
    [140, 90, 70],
    (g, E) => fill(g, ridge(c, H * 0.2, 2 * u).p, tone(E, 0.3, GRASS, 0.4)),
    (g, E) => {
      stroke(g, bricks, DARK, 1 * u, 0.4);
      fill(g, vault, [30, 20, 18], 0.55);
      const a = (E.day * 0.2 + 0.03) * (1 - E.c.cloud * 0.5);
      g.fillStyle = rgb(E.day > 0.3 ? [255, 236, 200] : [190, 205, 255], a);
      g.beginPath();
      g.moveTo(gx, H * 0.06 + 20 * u);
      g.lineTo(gx + 54 * u, H * 0.06 + 20 * u);
      g.lineTo(gx + 10 * u, floor);
      g.lineTo(gx - 60 * u, floor);
      g.fill();
      fill(g, grate, [20, 18, 20]);
      for (const b of barrels) {
        g.fillStyle = rgb(shade(E, [110, 70, 44], 0.3));
        g.beginPath();
        g.arc(b.x, b.y, b.r, 0, TAU);
        g.fill();
        g.strokeStyle = rgb([30, 26, 26]);
        g.lineWidth = 2 * u;
        g.beginPath();
        g.arc(b.x, b.y, b.r * 0.92, 0, TAU);
        g.arc(b.x, b.y, b.r * 0.55, 0, TAU);
        g.stroke();
        g.fillStyle = rgb([30, 26, 26]);
        g.fillRect(b.x - 2 * u, b.y - 2 * u, 4 * u, 4 * u);
      }
      stroke(g, rack, shade(E, [110, 76, 50], 0.3), 3 * u);
      for (const b of bottles) {
        g.fillStyle = rgb([30, 60, 40]);
        g.beginPath();
        g.arc(b.x, b.y, 4 * u, 0, TAU);
        g.fill();
        g.fillStyle = rgb([255, 230, 190], 0.25);
        g.fillRect(b.x - 1 * u, b.y - 2 * u, 1.4 * u, 1.4 * u);
      }
      const cb = barrels.at(-1)!;
      g.fillStyle = rgb([236, 226, 200]);
      g.fillRect(cb.x - 2 * u, cb.y - cb.r - 14 * u, 4 * u, 14 * u);
      lamp(g, E, cb.x, cb.y - cb.r - 16 * u, 130 * u, 3, WARM, 0.7);
    },
    floor,
  );
}

function hospital(c: Ctx): Scene {
  const { W, H, u, F, r } = c;
  const floor = H * 0.86;
  const wx = F + 60 * u;
  const ww = 140 * u;
  const win = new Path2D();
  win.rect(wx, H * 0.14, ww, H * 0.4);
  const blinds = new Path2D();
  for (let y = H * 0.14 + 4 * u; y < H * 0.4; y += 8 * u) blinds.rect(wx, y, ww, 3.4 * u);
  blinds.rect(wx - 6 * u, H * 0.13, ww + 12 * u, 5 * u);
  const city_ = city({ ...c, r: rand(seedOf("ward") + Math.floor(r() * 99)) });
  const bed = new Path2D();
  const bx = F - 220 * u;
  bed.rect(bx, H * 0.66, 200 * u, 10 * u);
  bed.rect(bx + 4 * u, H * 0.66, 4 * u, floor - H * 0.66);
  bed.rect(bx + 190 * u, H * 0.66, 4 * u, floor - H * 0.66);
  bed.rect(bx - 4 * u, H * 0.46, 6 * u, H * 0.3);
  bed.rect(bx + 60 * u, H * 0.6, 120 * u, 2.4 * u);
  for (let k = 0; k < 6; k++) bed.rect(bx + 64 * u + k * 22 * u, H * 0.6, 2 * u, H * 0.06);
  const sheet = new Path2D();
  sheet.moveTo(bx + 4 * u, H * 0.66);
  sheet.lineTo(bx + 4 * u, H * 0.52);
  sheet.quadraticCurveTo(bx + 30 * u, H * 0.5, bx + 60 * u, H * 0.62);
  sheet.quadraticCurveTo(bx + 130 * u, H * 0.58, bx + 196 * u, H * 0.63);
  sheet.lineTo(bx + 198 * u, H * 0.7);
  sheet.lineTo(bx + 4 * u, H * 0.7);
  sheet.closePath();
  const iv = new Path2D();
  const ix = F + 10 * u;
  iv.rect(ix - 1 * u, H * 0.18, 2 * u, floor - H * 0.18);
  iv.rect(ix - 16 * u, floor - 2 * u, 32 * u, 2 * u);
  iv.rect(ix - 12 * u, H * 0.18, 24 * u, 1.6 * u);
  const bag = new Path2D();
  bag.roundRect(ix - 16 * u, H * 0.19, 12 * u, 20 * u, 3 * u);
  const mon = { x: F - 60 * u, y: H * 0.26, w: 66 * u, h: 40 * u };
  const curtain = new Path2D();
  curtain.rect(0, H * 0.04, F - 230 * u, 2 * u);
  for (let x = 0; x < F - 240 * u; x += 18 * u) {
    curtain.moveTo(x, H * 0.05);
    curtain.quadraticCurveTo(x + 9 * u, H * 0.45, x + 2 * u, floor);
    curtain.lineTo(x + 16 * u, floor);
    curtain.quadraticCurveTo(x + 20 * u, H * 0.45, x + 16 * u, H * 0.05);
    curtain.closePath();
  }
  return room(
    c,
    win,
    [196, 214, 212],
    (g, E) => city_.draw(g, E),
    (g, E) => {
      fill(g, blinds, shade(E, [220, 224, 224], 0.6));
      fill(g, curtain, shade(E, [150, 196, 190], 0.55));
      fill(g, bed, shade(E, [170, 176, 184], 0.5));
      fill(g, sheet, shade(E, [226, 232, 236], 0.65));
      fill(g, iv, shade(E, [180, 184, 190], 0.5));
      g.fillStyle = rgb([200, 230, 255], 0.5);
      g.fill(bag);
      g.fillStyle = rgb([16, 20, 22]);
      g.fillRect(mon.x, mon.y, mon.w, mon.h);
      g.strokeStyle = rgb([90, 255, 150]);
      g.lineWidth = 1.4 * u;
      g.beginPath();
      const T = E.still ? 0 : E.T;
      for (let x = 0; x <= mon.w - 8 * u; x += 1.5 * u) {
        const ph = ((x / mon.w - T * 0.6) % 1 + 1) % 1;
        const beat = ph < 0.05 ? Math.sin((ph / 0.05) * Math.PI * 2) * 14 * u : 0;
        g.lineTo(mon.x + 4 * u + x, mon.y + mon.h * 0.6 - beat);
      }
      g.stroke();
      glowAt(g, mon.x + mon.w / 2, mon.y + mon.h / 2, 60 * u, [90, 255, 150], 0.15);
      g.fillStyle = rgb([255, 255, 255], 0.06 + E.night * 0.04);
      g.fillRect(0, 0, W, 6 * u);
    },
    floor,
  );
}

/** The first 45 places; morescenes.ts adds the rest and builds them. */
export const SCENES = {
  hills,
  meadow,
  forest,
  jungle,
  swamp,
  mountains,
  tundra,
  desert,
  canyon,
  volcano,
  cave,
  shore,
  beach,
  harbor,
  sea,
  lake,
  river,
  village,
  road,
  street,
  market,
  rooftops,
  city,
  castle,
  temple,
  ruins,
  graveyard,
  tavern,
  bedroom,
  hall,
  library,
  study,
  dungeon,
  kitchen,
  chapel,
  greenhouse,
  cellar,
  cafe,
  shop,
  forge,
  hospital,
  train,
  shipcabin,
  starship,
  space,
} satisfies Partial<Record<Place, (c: Ctx) => Scene>>;
