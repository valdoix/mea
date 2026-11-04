/**
 * Thirty more places for the scene window: rooms at home, pools and baths, ways of travelling,
 * and the rooms Almanac's plates drew that Mea's didn't (theatre, casino, observatory…). Painted
 * the same way as scenes.ts (built once per size and seed as paths, filled every frame in the
 * colours of the hour), and with it they make the whole table `buildScene` reads.
 */
import { clamp, DARK, dressHome, lerp, mix, OLDER, rand, rgb, seedOf, TAU, WARM, type Ctx, type Env, type Home, type Place, type RGB } from "./places";
import {
  FABRIC,
  GRASS,
  PINE,
  PLASTER,
  ROCK,
  SCENES,
  STONE,
  WOOD,
  birds,
  circle,
  figure,
  fill,
  fire,
  fireflies,
  flick,
  glowAt,
  haze,
  hillView,
  lamp,
  leafy,
  lit,
  motes,
  palm,
  panes,
  peaks,
  skirting,
  wallDressing,
  pine,
  poly,
  ridge,
  room,
  shade,
  shims,
  smoke,
  spill,
  stroke,
  sway,
  tone,
  townView,
  water,
  type Scene,
  type Shim,
} from "./scenes";
import { HOME_SCENES } from "./homescenes";
import { LAST_HOMES } from "./lasthomes";
import { MORE_HOMES } from "./morehomes";
import { clock, drapes, ellipse, grid, lampsOn, none, pick, rr, shut, steam, time } from "./scenebits";

type G = CanvasRenderingContext2D;
type Paint = (g: G, E: Env) => void;

// ---------- Shared bits ----------

/** Swimming-pool water inside `p`: clear blue by day, lit from below at night, with light rippling on it. */
function poolWater(g: G, E: Env, p: Path2D, x0: number, x1: number, y0: number, y1: number, u: number, sh: Shim[], lights = 1) {
  const T = time(E);
  const day = clamp(E.day * (1 - E.c.cloud * 0.35));
  g.save();
  g.clip(p);
  const wg = g.createLinearGradient(0, y0, 0, y1);
  wg.addColorStop(0, rgb(mix(mix([16, 60, 96], [120, 214, 228], day), E.sky.bot, 0.25)));
  wg.addColorStop(1, rgb(mix([8, 34, 60], [36, 150, 186], day)));
  g.fillStyle = wg;
  g.fillRect(x0, y0, x1 - x0, y1 - y0);
  glowAt(g, (x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) * 0.55, [90, 230, 255], 0.55 * E.glow * lights);
  g.strokeStyle = rgb([255, 255, 255], 0.1 + 0.1 * day + 0.08 * E.glow * lights);
  g.lineWidth = Math.max(1, 0.9 * u);
  for (let k = 0; k < 10; k++) {
    const y = y0 + ((y1 - y0) * (k + 0.5)) / 10;
    g.beginPath();
    for (let x = x0; x <= x1; x += 8 * u) g.lineTo(x, y + Math.sin(x / (13 * u) + T * 1.6 + k * 1.7) * (1 + k * 0.25) * u);
    g.stroke();
  }
  for (const s of sh) {
    const a = (0.12 + (E.light ? E.light.a * 0.2 : 0)) * (0.5 + 0.5 * Math.sin(T * 2.4 + s.p));
    g.fillStyle = rgb([255, 255, 255], a * (0.4 + day * 0.6));
    g.fillRect(lerp(x0, x1, s.x), lerp(y0, y1, s.y), s.w * (x1 - x0) * 0.4, Math.max(1, u));
  }
  g.restore();
}
/** Under the sea (a porthole's view, or a tank's): light from above by day, and things swimming. */
function underwater(c: Ctx, bright = 0): Paint {
  const { W, H, u, r } = c;
  const fish = Array.from({ length: c.mini ? 7 : 16 }, () => ({ x: r() * W, y: H * (0.15 + r() * 0.6), v: (6 + r() * 14) * u, s: (0.7 + r() * 0.9) * u, d: r() < 0.5 ? 1 : -1, p: r() * TAU, c: pick(r, [[255, 160, 60], [250, 220, 90], [120, 200, 255], [230, 100, 120], [200, 210, 230]] as RGB[]) }));
  const bubbles = Array.from({ length: c.mini ? 12 : 30 }, () => ({ x: r() * W, p: r(), v: 0.04 + r() * 0.07, s: (1 + r() * 2.4) * u }));
  const kelp = Array.from({ length: 12 }, () => ({ x: r() * W, h: (50 + r() * 120) * u, p: r() * TAU }));
  const bed = ridge(c, H * 0.93, 8 * u);
  const jelly = Array.from({ length: 3 }, () => ({ x: r() * W, y: H * (0.2 + r() * 0.4), p: r() * TAU }));
  return (g, E) => {
    const T = time(E);
    const L = clamp(E.day * 0.7 + bright);
    const bg = g.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, rgb(mix([6, 20, 44], [52, 166, 186], L)));
    bg.addColorStop(1, rgb(mix([2, 6, 18], [10, 64, 96], L)));
    g.fillStyle = bg;
    g.fillRect(0, 0, W, H);
    if (L > 0.1) {
      g.save();
      g.globalCompositeOperation = "lighter";
      for (let k = 0; k < 6; k++) {
        const x = ((k + 0.5) / 6) * W + Math.sin(T * 0.3 + k) * 20 * u;
        const gr = g.createLinearGradient(0, 0, 0, H * 0.9);
        gr.addColorStop(0, rgb([180, 240, 255], 0.12 * L));
        gr.addColorStop(1, rgb([180, 240, 255], 0));
        g.fillStyle = gr;
        g.beginPath();
        g.moveTo(x - 10 * u, 0);
        g.lineTo(x + 10 * u, 0);
        g.lineTo(x + 60 * u, H * 0.9);
        g.lineTo(x + 20 * u, H * 0.9);
        g.fill();
      }
      g.restore();
    }
    g.lineCap = "round";
    for (const k of kelp) {
      g.strokeStyle = rgb(mix([10, 30, 24], [40, 110, 70], L * 0.7));
      g.lineWidth = 4 * u;
      g.beginPath();
      g.moveTo(k.x, H);
      const sw = Math.sin(T * 0.8 + k.p) * 14 * u;
      g.quadraticCurveTo(k.x + sw, H - k.h * 0.5, k.x + sw * 1.6, H - k.h);
      g.stroke();
    }
    for (const f of fish) {
      const span = W + 80 * u;
      const x = ((((f.x + T * f.v * f.d) % span) + span) % span) - 40 * u;
      const y = f.y + Math.sin(T * 0.9 + f.p) * 6 * u;
      g.fillStyle = rgb(mix(mix(f.c, DARK, 0.75), f.c, 0.25 + L * 0.6));
      g.beginPath();
      g.ellipse(x, y, 9 * f.s, 4 * f.s, 0, 0, TAU);
      g.moveTo(x - f.d * 7 * f.s, y);
      g.lineTo(x - f.d * 15 * f.s, y - 5 * f.s);
      g.lineTo(x - f.d * 15 * f.s, y + 5 * f.s);
      g.fill();
    }
    for (const j of jelly) {
      const y = j.y + Math.sin(T * 0.5 + j.p) * 10 * u;
      glowAt(g, j.x, y, 22 * u, [200, 150, 255], 0.35 * (1 - L * 0.6));
      g.fillStyle = rgb([220, 190, 255], 0.35);
      g.beginPath();
      g.arc(j.x, y, 7 * u, Math.PI, TAU);
      g.fill();
    }
    g.strokeStyle = rgb([220, 240, 255], 0.35);
    g.lineWidth = Math.max(1, 0.7 * u);
    for (const b of bubbles) {
      const y = H - ((b.p + T * b.v) % 1) * H;
      g.beginPath();
      g.arc(b.x + Math.sin(T * 2 + b.p * 9) * 3 * u, y, b.s, 0, TAU);
      g.stroke();
    }
    fill(g, bed.p, mix([4, 10, 16], [40, 60, 60], L * 0.6));
  };
}
const viewOf = (s: Scene): Paint => (g, E) => s.draw(g, E);

const SOFAS: RGB[] = [
  [96, 110, 140],
  [150, 96, 80],
  [110, 130, 100],
  [176, 156, 124],
  [96, 84, 116],
  [60, 64, 70],
];

// ---------- At home ----------

function living(c: Ctx): Scene {
  const { H, u, F, r, home } = c;
  const style = home?.style ?? "modern";
  const grand = style === "grand";
  const old = style === "old";
  const floor = H * 0.8;
  const wx = F - 280 * u;
  const wy = H * (grand ? 0.08 : 0.14);
  const ww = 150 * u;
  const wh = H * (grand ? 0.56 : 0.42);
  const win = new Path2D();
  win.rect(wx, wy, ww, wh);
  const frame = new Path2D();
  panes(frame, wx, wy, ww, wh, old ? 5 : 3, old ? 4 : 2, 2.2 * u);
  frame.rect(wx - 8 * u, wy + wh, ww + 16 * u, 5 * u);
  const curt = new Path2D();
  drapes(curt, wx, wx + ww, wy, floor, u);
  const fab = home?.fabric ?? pick(r, FABRIC);
  const hue = home?.soft ?? pick(r, SOFAS);
  const sx = F - 70 * u;
  const sw = 230 * u;
  const sy = H * 0.5;
  const back = new Path2D();
  rr(back, sx, sy, sw, H * 0.16, 12 * u);
  rr(back, sx - 24 * u, sy + H * 0.08, 32 * u, H * 0.17, 10 * u);
  rr(back, sx + sw - 8 * u, sy + H * 0.08, 32 * u, H * 0.17, 10 * u);
  const seat = new Path2D();
  rr(seat, sx + 4 * u, sy + H * 0.14, sw - 8 * u, H * 0.1, 6 * u);
  const legs = new Path2D();
  for (const x of [sx - 16 * u, sx + sw + 12 * u]) legs.rect(x, sy + H * 0.25, 4 * u, H * 0.05);
  const cush = new Path2D();
  for (const x of [sx + 18 * u, sx + sw - 70 * u]) rr(cush, x, sy + H * 0.05, 52 * u, 40 * u, 12 * u);
  const table = new Path2D();
  table.rect(sx + 40 * u, H * 0.84, 150 * u, 6 * u);
  table.rect(sx + 48 * u, H * 0.84, 5 * u, H * 0.12);
  table.rect(sx + 177 * u, H * 0.84, 5 * u, H * 0.12);
  const mug = new Path2D();
  rr(mug, sx + 70 * u, H * 0.84 - 13 * u, 10 * u, 13 * u, 2 * u);
  const book = new Path2D();
  book.rect(sx + 120 * u, H * 0.84 - 5 * u, 44 * u, 5 * u);
  const lx = sx + sw + 52 * u;
  const pole = new Path2D();
  pole.rect(lx - 1.5 * u, H * 0.28, 3 * u, floor - H * 0.28 + 6 * u);
  ellipse(pole, lx, floor + 6 * u, 16 * u, 3 * u);
  const lshade = new Path2D();
  poly(lshade, lx - 22 * u, H * 0.3, lx + 22 * u, H * 0.3, lx + 14 * u, H * 0.2, lx - 14 * u, H * 0.2);
  const bx = lx + 46 * u;
  const shelf = new Path2D();
  for (let k = 0; k < 4; k++) shelf.rect(bx, H * (0.22 + k * 0.17), 110 * u, 4 * u);
  shelf.rect(bx, H * 0.22, 4 * u, floor - H * 0.22);
  shelf.rect(bx + 106 * u, H * 0.22, 4 * u, floor - H * 0.22);
  const books: { x: number; y: number; w: number; h: number; c: RGB }[] = [];
  for (let k = 0; k < 3; k++)
    for (let x = bx + 6 * u; x < bx + 100 * u; ) {
      const w = (5 + r() * 6) * u;
      if (r() < 0.85) books.push({ x, y: H * (0.22 + (k + 1) * 0.17), w: w - 1, h: (18 + r() * 14) * u, c: pick(r, FABRIC) });
      x += w;
    }
  const pic = new Path2D();
  pic.rect(F - 6 * u, H * 0.18, 96 * u, 62 * u);
  const art = [pick(r, FABRIC), pick(r, PLASTER)];
  const plant = new Path2D();
  leafy(plant, wx - 40 * u, floor - 16 * u, 74 * u);
  const pot = new Path2D();
  poly(pot, wx - 54 * u, floor - 18 * u, wx - 26 * u, floor - 18 * u, wx - 30 * u, floor + 4 * u, wx - 50 * u, floor + 4 * u);
  const wall = home?.wall ?? pick(r, PLASTER);
  const view = r() < 0.5 ? townView(c) : hillView(c);
  // The far wall: a hearth or a screen. Drawn from `r` only after the rest, so the room's layout keeps its seed.
  const hx = F - 410 * u;
  const hearth = old || grand || (style === "modern" && r() < 0.5);
  const dressing = wallDressing(c, 0, hx - 90 * u);
  const surround = new Path2D();
  surround.rect(hx - 62 * u, H * 0.42, 124 * u, floor - H * 0.42);
  const mantel = new Path2D();
  mantel.rect(hx - 74 * u, H * 0.4, 148 * u, 8 * u);
  const mouth = new Path2D();
  mouth.moveTo(hx - 36 * u, floor);
  mouth.lineTo(hx - 36 * u, H * 0.6);
  mouth.quadraticCurveTo(hx, H * 0.5, hx + 36 * u, H * 0.6);
  mouth.lineTo(hx + 36 * u, floor);
  mouth.closePath();
  const stand = new Path2D();
  stand.rect(hx - 64 * u, floor - 34 * u, 128 * u, 34 * u);
  const screen = new Path2D();
  const sw2 = style === "humble" ? 70 : 118;
  rr(screen, hx - sw2 * 0.5 * u, floor - 34 * u - sw2 * 0.6 * u, sw2 * u, sw2 * 0.56 * u, 2 * u);
  // Old-world lamplight is a candle; a grand room has a chandelier over the sofa.
  const chx = sx + sw / 2;
  const wainscot = new Path2D();
  wainscot.rect(0, H * 0.62, c.W, floor - H * 0.62);
  wainscot.rect(0, H * 0.615, c.W, 3 * u);
  const radiator = new Path2D();
  for (let k = 0; k < 9; k++) rr(radiator, wx + 16 * u + k * 13 * u, floor - 46 * u, 9 * u, 42 * u, 3 * u);
  return room(
    c,
    win,
    wall,
    view,
    (g, E) => {
      dressing(g, E);
      if (grand || old) fill(g, wainscot, shade(E, home?.trim ?? [90, 66, 50], 0.45), old ? 0.8 : 0.45);
      skirting(g, E, c, floor);
      spill(g, E, wx, wx + ww, wy + wh, floor, 80 * u);
      fill(g, frame, shade(E, home?.trim ?? [232, 226, 216], 0.6));
      if (style === "humble") fill(g, radiator, shade(E, [226, 222, 214], 0.5));
      fill(g, curt, shade(E, fab, 0.45));
      if (hearth) {
        // Lit once the day's dark or there's snow to come in from.
        const burning = E.glow > 0.45 || E.c.snow > 0.2;
        fill(g, surround, shade(E, old ? [120, 112, 104] : mix(home?.trim ?? [216, 208, 196], [120, 110, 104], 0.3), 0.5));
        fill(g, mantel, shade(E, home?.trim ?? WOOD, 0.55));
        fill(g, mouth, [20, 12, 12]);
        if (burning) {
          glowAt(g, hx, floor - 14 * u, 180 * u, [255, 140, 60], 0.42);
          fire(g, E, hx, floor - 3 * u, u * 1.4);
        }
      } else {
        const on = clamp(E.glow * 1.4);
        fill(g, stand, shade(E, WOOD, 0.45));
        fill(g, screen, mix([18, 18, 22], [150, 180, 220], on * (E.still ? 0.8 : 0.72 + 0.1 * Math.sin(E.T * 3.1))));
        if (on > 0.05) glowAt(g, hx, floor - 34 * u - sw2 * 0.3 * u, 170 * u, [130, 170, 230], 0.28 * on);
      }
      // A grand room's chandelier hangs where the picture would be.
      if (!grand) {
        fill(g, pic, shade(E, [60, 40, 30]));
        g.fillStyle = rgb(shade(E, art[1]!, 0.55));
        g.fillRect(F, H * 0.18 + 6 * u, 84 * u, 50 * u);
        g.fillStyle = rgb(shade(E, art[0]!, 0.55));
        g.beginPath();
        g.arc(F + 52 * u, H * 0.18 + 30 * u, 13 * u, 0, TAU);
        g.fill();
      }
      fill(g, shelf, shade(E, WOOD));
      for (const b of books) {
        g.fillStyle = rgb(shade(E, b.c, 0.45));
        g.fillRect(b.x, b.y - b.h, b.w, b.h);
      }
      g.fillStyle = rgb(shade(E, mix(fab, [210, 190, 160], 0.55), 0.5), 0.7);
      g.beginPath();
      g.ellipse(F + 50 * u, H * 0.93, 220 * u, 18 * u, 0, 0, TAU);
      g.fill();
      fill(g, legs, [30, 22, 20]);
      fill(g, back, shade(E, hue, 0.5));
      fill(g, seat, shade(E, mix(hue, [255, 255, 255], 0.12), 0.5));
      fill(g, cush, shade(E, fab, 0.5));
      fill(g, table, shade(E, WOOD, 0.55));
      fill(g, mug, shade(E, [230, 226, 220], 0.6));
      fill(g, book, shade(E, pick(rand(7), FABRIC), 0.5));
      const on = clamp(E.glow * 1.3);
      fill(g, pole, [34, 30, 30]);
      if (old) {
        if (on > 0.1) fire(g, E, lx, H * 0.28, u * 0.5);
        glowAt(g, lx, H * 0.27, 120 * u, WARM, 0.35 * on);
      } else {
        fill(g, lshade, mix(shade(E, [236, 222, 196]), [255, 226, 176], on));
        glowAt(g, lx, H * 0.29, 170 * u, WARM, 0.5 * on);
      }
      if (grand) {
        g.fillStyle = rgb(shade(E, [176, 146, 90], 0.5));
        g.fillRect(chx - 0.8 * u, 0, 1.6 * u, H * 0.13);
        g.fillRect(chx - 42 * u, H * 0.13, 84 * u, 4 * u);
        for (const dx of [-38, -19, 0, 19, 38]) lamp(g, E, chx + dx * u, H * 0.125, 34 * u, dx, WARM, 0.2);
        glowAt(g, chx, H * 0.14, 180 * u, WARM, 0.32 * on);
      }
      fill(g, plant, shade(E, [70, 124, 74], 0.5));
      fill(g, pot, shade(E, [180, 110, 80], 0.5));
    },
    floor,
    { floorHue: home?.floor },
  );
}

function homekitchen(c: Ctx): Scene {
  const { W, H, u, F, r } = c;
  const floor = H * 0.88;
  const wx = F - 60 * u;
  const wy = H * 0.15;
  const ww = 120 * u;
  const wh = H * 0.25;
  const win = new Path2D();
  win.rect(wx, wy, ww, wh);
  const frame = new Path2D();
  panes(frame, wx, wy, ww, wh, 2, 1, 2.4 * u);
  frame.rect(wx - 8 * u, wy + wh, ww + 16 * u, 5 * u);
  const top = H * 0.6;
  const fx = F + 200 * u;
  const ups = new Path2D();
  const doors = new Path2D();
  const knobs = new Path2D();
  const cab = (x: number, y: number, w: number, h: number, kx: number, ky: number) => {
    ups.rect(x + 1.5 * u, y, w - 3 * u, h);
    doors.rect(x + 5 * u, y + 4 * u, w - 10 * u, h - 8 * u);
    knobs.rect(kx - 1.2 * u, ky - 5 * u, 2.4 * u, 10 * u);
  };
  for (let x = wx - 12 * u - 56 * u; x > -56 * u; x -= 56 * u) if (x + 56 * u < F - 290 * u || x > F - 150 * u) cab(x, H * 0.06, 56 * u, H * 0.25, x + 46 * u, H * 0.27);
  for (let x = wx + ww + 12 * u; x < W; x += 56 * u) if (x + 56 * u <= fx - 4 * u || x >= fx + 80 * u) cab(x, H * 0.06, 56 * u, H * 0.25, x + 10 * u, H * 0.27);
  const base = new Path2D();
  const bdoors = new Path2D();
  const bknobs = new Path2D();
  for (let x = F - 600 * u; x < W; x += 60 * u) {
    if (x + 60 * u > fx && x < fx + 76 * u) continue;
    base.rect(x, top + 6 * u, 60 * u, floor - top - 6 * u);
    bdoors.rect(x + 5 * u, top + 26 * u, 50 * u, floor - top - 34 * u);
    bdoors.rect(x + 5 * u, top + 10 * u, 50 * u, 12 * u);
    bknobs.rect(x + 22 * u, top + 15 * u, 16 * u, 2 * u);
  }
  const counter = new Path2D();
  counter.rect(0, top, fx - 2 * u, 7 * u);
  counter.rect(fx + 76 * u, top, W, 7 * u);
  const tiles = new Path2D();
  tiles.rect(0, H * 0.31, wx - 8 * u, top - H * 0.31);
  tiles.rect(wx + ww + 8 * u, H * 0.31, fx - 10 * u - (wx + ww + 8 * u), top - H * 0.31);
  tiles.rect(wx - 8 * u, wy + wh + 5 * u, ww + 16 * u, top - wy - wh - 5 * u);
  const tileLines = new Path2D();
  grid(tileLines, 0, H * 0.31, fx, top, 14 * u, 8 * u, true);
  const sink = new Path2D();
  sink.rect(wx + 20 * u, top - 1 * u, 80 * u, 3 * u);
  const tap = new Path2D();
  tap.moveTo(F, top);
  tap.lineTo(F, top - 30 * u);
  tap.quadraticCurveTo(F, top - 42 * u, F + 16 * u, top - 36 * u);
  const hx = F - 220 * u;
  const hob = new Path2D();
  hob.rect(hx - 45 * u, top - 3 * u, 90 * u, 4 * u);
  const oven = new Path2D();
  rr(oven, hx - 40 * u, top + 30 * u, 80 * u, 56 * u, 3 * u);
  const hood = new Path2D();
  poly(hood, hx - 56 * u, H * 0.31, hx + 56 * u, H * 0.31, hx + 26 * u, H * 0.2, hx - 26 * u, H * 0.2);
  hood.rect(hx - 18 * u, 0, 36 * u, H * 0.2);
  const pan = new Path2D();
  pan.moveTo(hx - 4 * u + 26 * u, top - 3 * u);
  pan.lineTo(hx - 4 * u + 26 * u, top - 22 * u);
  pan.lineTo(hx - 4 * u - 26 * u, top - 22 * u);
  pan.lineTo(hx - 4 * u - 26 * u, top - 3 * u);
  pan.closePath();
  pan.rect(hx - 34 * u, top - 24 * u, 60 * u, 3 * u);
  const fridge = new Path2D();
  rr(fridge, fx, H * 0.08, 74 * u, floor - H * 0.08, 6 * u);
  const fseam = new Path2D();
  fseam.rect(fx, H * 0.36, 74 * u, 1.5 * u);
  fseam.rect(fx + 8 * u, H * 0.2, 3 * u, 30 * u);
  fseam.rect(fx + 8 * u, H * 0.42, 3 * u, 40 * u);
  const bowl = new Path2D();
  bowl.moveTo(F + 140 * u, top);
  bowl.arc(F + 120 * u, top - 10 * u, 20 * u, 0.4, Math.PI - 0.4);
  bowl.closePath();
  const fruit: [number, number, RGB][] = [
    [F + 110 * u, top - 16 * u, [240, 150, 40]],
    [F + 126 * u, top - 18 * u, [200, 40, 40]],
    [F + 118 * u, top - 26 * u, [140, 190, 60]],
  ];
  const sillPot = new Path2D();
  leafy(sillPot, wx + 22 * u, wy + wh - 6 * u, 26 * u);
  const home = c.home;
  const cabHue = home ? mix(home.trim, home.wall, 0.25) : pick(r, [[236, 232, 224], [120, 150, 140], [62, 72, 94], [204, 172, 132], [168, 190, 210]] as RGB[]);
  const topHue = home?.style === "grand" ? ([232, 228, 222] as RGB) : pick(r, [[64, 64, 70], [222, 216, 206], [150, 110, 76]] as RGB[]);
  const tileHue = home ? mix(home.wall, [250, 248, 244], 0.6) : pick(r, [[214, 228, 232], [240, 238, 232], [226, 206, 176], [180, 210, 196]] as RGB[]);
  const wall = home?.wall ?? pick(r, PLASTER);
  const view = r() < 0.5 ? townView(c) : hillView(c);
  const mug = new Path2D();
  rr(mug, F + 60 * u, top - 13 * u, 11 * u, 13 * u, 2 * u);
  const pendants = home?.style === "grand" ? [F - 120 * u, F + 40 * u, F + 150 * u] : [];
  const plain = home?.style === "humble";
  return room(
    c,
    win,
    wall,
    view,
    (g, E) => {
      fill(g, tiles, shade(E, tileHue, 0.55));
      g.save();
      g.clip(tiles);
      stroke(g, tileLines, shade(E, mix(tileHue, DARK, 0.25)), 0.8 * u, 0.6);
      g.restore();
      spill(g, E, wx, wx + ww, wy + wh, floor, 50 * u);
      fill(g, frame, shade(E, [240, 236, 228], 0.6));
      fill(g, sillPot, shade(E, [70, 130, 70], 0.5));
      fill(g, ups, shade(E, cabHue, 0.5));
      stroke(g, doors, shade(E, mix(cabHue, DARK, 0.3)), 0.8 * u);
      fill(g, knobs, shade(E, [180, 176, 170]));
      const on = lampsOn(E, 0.15);
      for (let x = 30 * u; x < W; x += 70 * u) if (x < hx - 60 * u || x > hx + 60 * u) glowAt(g, x, H * 0.32, 60 * u, WARM, 0.28 * on);
      fill(g, hood, shade(E, [170, 172, 176], 0.5));
      glowAt(g, hx, H * 0.32, 60 * u, WARM, 0.35 * on);
      fill(g, base, shade(E, cabHue, 0.45));
      stroke(g, bdoors, shade(E, mix(cabHue, DARK, 0.3)), 0.8 * u);
      fill(g, bknobs, shade(E, [180, 176, 170]));
      fill(g, oven, [24, 22, 24]);
      glowAt(g, hx, top + 58 * u, 40 * u, [255, 160, 80], 0.25 * on);
      fill(g, counter, shade(E, topHue, 0.5));
      fill(g, sink, [40, 40, 44]);
      stroke(g, tap, shade(E, [190, 190, 196]), 3 * u);
      fill(g, hob, [20, 20, 22]);
      fill(g, pan, [40, 38, 40]);
      steam(g, E, hx - 4 * u, top - 26 * u, u, 5, 8, 0.08);
      if (!plain) {
        fill(g, bowl, shade(E, [220, 214, 200], 0.6));
        for (const [x, y, col] of fruit) {
          g.fillStyle = rgb(shade(E, col, 0.6));
          g.beginPath();
          g.arc(x, y, 8 * u, 0, TAU);
          g.fill();
        }
      }
      // Someone's had their coffee.
      if (E.t >= 6 && E.t < 10.5) {
        fill(g, mug, shade(E, [232, 228, 222], 0.6));
        steam(g, E, F + 65 * u, top - 14 * u, u, 3, 3, 0.08);
      }
      fill(g, fridge, shade(E, [226, 228, 230], 0.55));
      fill(g, fseam, shade(E, [150, 152, 156]));
      for (const x of pendants) {
        g.fillStyle = rgb([34, 30, 30]);
        g.fillRect(x - 0.6 * u, 0, 1.2 * u, H * 0.36);
        lamp(g, E, x, H * 0.37, 70 * u, x, WARM, 0.2);
      }
      clock(g, E, F, H * 0.075, 11 * u);
    },
    floor,
    { floorHue: home?.floor },
  );
}

function bathroom(c: Ctx): Scene {
  const { W, H, u, F, r } = c;
  const floor = H * 0.84;
  const wx = F + 80 * u;
  const wy = H * 0.1;
  const ww = 70 * u;
  const wh = H * 0.24;
  const win = new Path2D();
  win.rect(wx, wy, ww, wh);
  const frame = new Path2D();
  panes(frame, wx, wy, ww, wh, 1, 2, 2.2 * u);
  frame.rect(wx - 6 * u, wy + wh, ww + 12 * u, 4 * u);
  const home = c.home;
  const old = home?.style === "old";
  const grand = home?.style === "grand";
  const plain = home?.style === "humble";
  const tileHue = home ? mix(home.wall, [250, 250, 248], 0.55) : pick(r, [[228, 236, 236], [190, 222, 216], [238, 212, 208], [202, 210, 228], [236, 230, 210]] as RGB[]);
  const tileArea = new Path2D();
  tileArea.rect(0, 0, W, floor);
  tileArea.addPath(win);
  const tileLines = new Path2D();
  grid(tileLines, 0, H * 0.44, W, floor, 16 * u, 16 * u);
  grid(tileLines, 0, floor, W, H, 26 * u, 14 * u, true);
  const trim = new Path2D();
  trim.rect(0, H * 0.43, W, 3 * u);
  const tx = F - 20 * u;
  const tw = 240 * u;
  const ty = H * 0.6;
  const tub = new Path2D();
  tub.moveTo(tx, ty);
  tub.lineTo(tx + tw, ty);
  tub.quadraticCurveTo(tx + tw - 4 * u, ty + 54 * u, tx + tw - 34 * u, ty + 62 * u);
  tub.lineTo(tx + 34 * u, ty + 62 * u);
  tub.quadraticCurveTo(tx + 4 * u, ty + 54 * u, tx, ty);
  tub.closePath();
  const rim = new Path2D();
  rr(rim, tx - 5 * u, ty - 4 * u, tw + 10 * u, 7 * u, 3 * u);
  const feet = new Path2D();
  for (const x of [tx + 40 * u, tx + tw - 40 * u]) poly(feet, x - 6 * u, ty + 58 * u, x + 6 * u, ty + 58 * u, x + 9 * u, ty + 72 * u, x - 9 * u, ty + 72 * u);
  const foam = new Path2D();
  for (let k = 0; k < 9; k++) circle(foam, tx + 30 * u + r() * (tw - 60 * u), ty - 2 * u - r() * 4 * u, (5 + r() * 7) * u);
  const tap = new Path2D();
  tap.moveTo(tx + tw - 18 * u, ty - 4 * u);
  tap.lineTo(tx + tw - 18 * u, ty - 22 * u);
  tap.quadraticCurveTo(tx + tw - 18 * u, ty - 30 * u, tx + tw - 32 * u, ty - 26 * u);
  const rail = new Path2D();
  rail.rect(tx - 10 * u, H * 0.06, tw + 20 * u, 2.5 * u);
  const curtain = new Path2D();
  curtain.moveTo(tx + tw - 4 * u, H * 0.07);
  for (let k = 0; k <= 4; k++) curtain.lineTo(tx + tw + 8 * u - (k % 2) * 8 * u, H * 0.07 + (k * (ty - H * 0.07)) / 4);
  curtain.lineTo(tx + tw - 38 * u, ty - 4 * u);
  curtain.quadraticCurveTo(tx + tw - 26 * u, H * 0.3, tx + tw - 44 * u, H * 0.07);
  curtain.closePath();
  const sx = F - 180 * u;
  const sink = new Path2D();
  sink.moveTo(sx - 40 * u, H * 0.55);
  sink.lineTo(sx + 40 * u, H * 0.55);
  sink.quadraticCurveTo(sx + 36 * u, H * 0.64, sx, H * 0.645);
  sink.quadraticCurveTo(sx - 36 * u, H * 0.64, sx - 40 * u, H * 0.55);
  poly(sink, sx - 10 * u, H * 0.64, sx + 10 * u, H * 0.64, sx + 14 * u, floor + 4 * u, sx - 14 * u, floor + 4 * u);
  const mirror = new Path2D();
  rr(mirror, sx - 34 * u, H * 0.17, 68 * u, 84 * u, 30 * u);
  const mframe = new Path2D();
  rr(mframe, sx - 38 * u, H * 0.17 - 4 * u, 76 * u, 92 * u, 34 * u);
  const towel = new Path2D();
  towel.rect(F - 300 * u, H * 0.34, 64 * u, 3 * u);
  rr(towel, F - 296 * u, H * 0.345, 56 * u, 70 * u, 3 * u);
  const fab = home?.fabric ?? pick(r, FABRIC);
  const mat = new Path2D();
  rr(mat, tx + 50 * u, H * 0.9, 120 * u, 18 * u, 6 * u);
  const fittings: RGB = grand ? [214, 176, 96] : [200, 200, 206];
  const bath: RGB = old ? [176, 118, 78] : [246, 246, 242];
  return room(
    c,
    win,
    tileHue,
    hillView(c),
    (g, E) => {
      // Plaster in an old-world house; everywhere else, tile.
      if (!old) {
        g.save();
        g.clip(tileArea, "evenodd");
        stroke(g, tileLines, shade(E, mix(tileHue, DARK, 0.3)), 0.8 * u, 0.55);
        g.restore();
      }
      // frosted glass
      g.fillStyle = rgb(mix([150, 160, 180], [246, 248, 250], E.day), 0.5);
      g.fill(win);
      fill(g, frame, shade(E, home?.trim ?? [240, 240, 236], 0.6));
      fill(g, trim, shade(E, mix(tileHue, DARK, 0.2)));
      spill(g, E, wx, wx + ww, wy + wh, floor, -40 * u);
      fill(g, towel, shade(E, fab, 0.5));
      fill(g, mframe, shade(E, grand ? [214, 176, 96] : [200, 180, 140], 0.55));
      const mg = g.createLinearGradient(sx - 34 * u, H * 0.17, sx + 34 * u, H * 0.17 + 84 * u);
      mg.addColorStop(0, rgb(shade(E, [200, 214, 222], 0.6)));
      mg.addColorStop(0.5, rgb(shade(E, [236, 244, 248], 0.6)));
      mg.addColorStop(1, rgb(shade(E, [170, 186, 196], 0.6)));
      g.fillStyle = mg;
      g.fill(mirror);
      const on = lampsOn(E, 0.1);
      if (!old) for (const dx of [-24, 0, 24]) lamp(g, E, sx + dx * u, H * 0.13, 50 * u, dx, WARM, 0.1);
      fill(g, sink, shade(E, [244, 244, 240], 0.6));
      if (!old) {
        fill(g, rail, shade(E, [190, 190, 196]));
        fill(g, curtain, shade(E, mix(fab, [255, 255, 255], 0.5), 0.5));
      }
      if (!plain) fill(g, feet, shade(E, grand ? [214, 176, 96] : [200, 170, 90]));
      fill(g, tub, shade(E, bath, 0.6));
      fill(g, rim, shade(E, mix(bath, [255, 255, 255], 0.3), 0.6));
      fill(g, foam, shade(E, [255, 255, 255], 0.7), 0.9);
      if (!old) stroke(g, tap, shade(E, fittings), 2.6 * u);
      steam(g, E, tx + tw / 2, ty - 6 * u, u, 7, 30, 0.07 + E.night * 0.04);
      if (!plain)
        for (const x of [tx + 14 * u, tx + 26 * u]) {
          g.fillStyle = rgb(shade(E, [240, 230, 210]));
          g.fillRect(x - 2.5 * u, ty - 16 * u, 5 * u, 12 * u);
          lamp(g, E, x, ty - 19 * u, 40 * u * on, x, WARM, 0.3);
        }
      fill(g, mat, shade(E, fab, 0.45));
    },
    floor,
    { floorHue: home?.floor },
  );
}

function attic(c: Ctx): Scene {
  const { W, H, u, F, r } = c;
  const floor = H * 0.84;
  const ax = F - 40 * u;
  const eave = H * 0.66;
  const lx = F - 320 * u;
  const rx = F + 240 * u;
  const wy = H * 0.34;
  const wr = 34 * u;
  const win = new Path2D();
  circle(win, ax, wy, wr);
  const frame = new Path2D();
  frame.moveTo(ax + wr + 6 * u, wy);
  frame.arc(ax, wy, wr + 6 * u, 0, TAU);
  frame.moveTo(ax + wr, wy);
  frame.arc(ax, wy, wr, 0, TAU, true);
  frame.rect(ax - 1.5 * u, wy - wr, 3 * u, wr * 2);
  frame.rect(ax - wr, wy - 1.5 * u, wr * 2, 3 * u);
  const slopes = new Path2D();
  poly(slopes, 0, 0, ax, 0, ax, -1, lx, eave, 0, eave);
  poly(slopes, ax, 0, W, 0, W, eave, rx, eave);
  const rafters = new Path2D();
  for (let k = 0; k <= 6; k++) {
    const t = k / 6;
    rafters.moveTo(lerp(ax, 0, t), 0);
    rafters.lineTo(lerp(lx, 0, t), eave);
    rafters.moveTo(lerp(ax, W, t), 0);
    rafters.lineTo(lerp(rx, W, t), eave);
  }
  rafters.moveTo(lx, eave);
  rafters.lineTo(ax, 0);
  rafters.lineTo(rx, eave);
  const boards = new Path2D();
  for (let x = -W; x < W * 2; x += 40 * u) {
    boards.moveTo(ax + (x - ax) * 0.5, floor);
    boards.lineTo(x, H);
  }
  const boxes = new Path2D();
  const tape = new Path2D();
  for (const [x, y, w, h] of [
    [F - 270 * u, floor - 50 * u, 70 * u, 54 * u],
    [F - 200 * u, floor - 40 * u, 56 * u, 44 * u],
    [F - 258 * u, floor - 90 * u, 54 * u, 40 * u],
  ] as const) {
    boxes.rect(x, y, w, h);
    tape.rect(x + w / 2 - 4 * u, y, 8 * u, h * 0.3);
  }
  const trunk = new Path2D();
  rr(trunk, F + 50 * u, floor - 46 * u, 100 * u, 54 * u, 6 * u);
  const bands = new Path2D();
  for (const x of [F + 68 * u, F + 126 * u]) bands.rect(x, floor - 46 * u, 6 * u, 54 * u);
  bands.rect(F + 50 * u, floor - 30 * u, 100 * u, 3 * u);
  const ghost = new Path2D();
  ghost.moveTo(F + 160 * u, floor + 6 * u);
  ghost.quadraticCurveTo(F + 158 * u, floor - 70 * u, F + 190 * u, floor - 96 * u);
  ghost.quadraticCurveTo(F + 220 * u, floor - 110 * u, F + 236 * u, floor - 70 * u);
  ghost.quadraticCurveTo(F + 250 * u, floor - 30 * u, F + 262 * u, floor + 6 * u);
  ghost.closePath();
  const bulbX = F + 100 * u;
  const cord = new Path2D();
  cord.rect(bulbX - 0.5 * u, 0, 1 * u, H * 0.3);
  const dust = motes(c, 26, ax - 40 * u, ax + 140 * u, wy, floor);
  return room(
    c,
    win,
    [150, 118, 88],
    hillView(c),
    (g, E) => {
      fill(g, slopes, shade(E, [110, 80, 58], 0.4));
      stroke(g, rafters, shade(E, [70, 48, 34]), 5 * u);
      stroke(g, boards, [0, 0, 0], 1 * u, 0.25);
      fill(g, frame, shade(E, [90, 64, 46]));
      const a = E.day * (1 - E.c.cloud * 0.6);
      if (a > 0.05) {
        const bg = g.createLinearGradient(ax, wy, ax + 120 * u, floor);
        bg.addColorStop(0, rgb([255, 236, 200], 0.18 * a));
        bg.addColorStop(1, rgb([255, 236, 200], 0.03 * a));
        g.fillStyle = bg;
        g.beginPath();
        g.moveTo(ax - wr, wy);
        g.lineTo(ax + wr, wy);
        g.lineTo(ax + 180 * u, floor + 10 * u);
        g.lineTo(ax + 40 * u, floor + 10 * u);
        g.fill();
        const T = time(E);
        for (const m of dust) {
          g.fillStyle = rgb([255, 240, 210], 0.5 * a * (0.5 + 0.5 * Math.sin(T + m.p)));
          g.fillRect(m.x + Math.sin(T * 0.2 + m.p) * 10 * u, m.y + Math.cos(T * 0.15 + m.p) * 8 * u, 1.3 * u, 1.3 * u);
        }
      }
      fill(g, boxes, shade(E, [176, 140, 96], 0.45));
      fill(g, tape, shade(E, [200, 176, 130], 0.45));
      fill(g, trunk, shade(E, [110, 60, 44], 0.45));
      fill(g, bands, shade(E, [60, 50, 46]));
      fill(g, ghost, shade(E, [222, 216, 204], 0.5));
      if (c.home?.style === "old") {
        // A lantern on a hook rather than a bulb on a cord.
        g.fillStyle = rgb([30, 24, 20]);
        g.fillRect(bulbX - 5 * u, H * 0.27, 10 * u, 14 * u);
        lamp(g, E, bulbX, H * 0.28, 100 * u, 3, WARM, 0.1);
      } else {
        fill(g, cord, [30, 24, 20]);
        lamp(g, E, bulbX, H * 0.31, 120 * u, 3, WARM, 0);
      }
    },
    floor,
    { floorHue: c.home?.floor },
  );
}

function cabin(c: Ctx): Scene {
  const { W, H, u, F, r } = c;
  const floor = H * 0.84;
  const wx = F - 280 * u;
  const wy = H * 0.2;
  const ww = 110 * u;
  const wh = H * 0.32;
  const win = new Path2D();
  win.rect(wx, wy, ww, wh);
  const frame = new Path2D();
  panes(frame, wx, wy, ww, wh, 2, 2, 3 * u);
  frame.rect(wx - 8 * u, wy + wh, ww + 16 * u, 6 * u);
  const logs = new Path2D();
  for (let y = 8 * u; y < floor; y += 17 * u) {
    logs.moveTo(0, y);
    logs.lineTo(W, y);
  }
  const hx = F + 140 * u;
  const chim = new Path2D();
  chim.rect(hx - 70 * u, 0, 140 * u, floor - 0);
  const stones = new Path2D();
  for (let y = 0, row = 0; y < floor; y += 18 * u, row++)
    for (let x = hx - 70 * u + (row % 2 ? -12 * u : 0); x < hx + 70 * u; x += (22 + r() * 10) * u) rr(stones, Math.max(hx - 70 * u, x) + 1.5 * u, y + 1.5 * u, Math.min(26 * u, hx + 70 * u - x) - 3 * u, 15 * u, 5 * u);
  const mouth = new Path2D();
  mouth.moveTo(hx - 44 * u, floor);
  mouth.lineTo(hx - 44 * u, H * 0.6);
  mouth.quadraticCurveTo(hx, H * 0.5, hx + 44 * u, H * 0.6);
  mouth.lineTo(hx + 44 * u, floor);
  mouth.closePath();
  const mantel = new Path2D();
  mantel.rect(hx - 84 * u, H * 0.44, 168 * u, 9 * u);
  const antlers = new Path2D();
  for (const s of [-1, 1]) {
    antlers.moveTo(hx, H * 0.3);
    antlers.quadraticCurveTo(hx + s * 30 * u, H * 0.3, hx + s * 40 * u, H * 0.16);
    for (const t of [0.4, 0.7]) {
      antlers.moveTo(hx + s * 30 * t * 1.2 * u + s * 4 * u, H * (0.3 - 0.14 * t));
      antlers.lineTo(hx + s * 30 * t * 1.2 * u + s * 2 * u, H * (0.3 - 0.14 * t) - 14 * u);
    }
  }
  const wood = new Path2D();
  for (let row = 0; row < 3; row++) for (let k = 0; k < 4 - row; k++) circle(wood, hx + 92 * u + k * 13 * u + row * 6.5 * u, floor - 6 * u - row * 12 * u, 6 * u);
  const chair = new Path2D();
  const cx = F - 110 * u;
  rr(chair, cx - 50 * u, H * 0.48, 100 * u, H * 0.3, 16 * u);
  rr(chair, cx - 66 * u, H * 0.62, 30 * u, H * 0.2, 10 * u);
  rr(chair, cx + 36 * u, H * 0.62, 30 * u, H * 0.2, 10 * u);
  const plaid = new Path2D();
  poly(plaid, cx - 30 * u, H * 0.5, cx + 10 * u, H * 0.5, cx + 20 * u, H * 0.74, cx - 34 * u, H * 0.78);
  const table = new Path2D();
  table.rect(F - 10 * u, H * 0.7, 60 * u, 5 * u);
  table.rect(F + 16 * u, H * 0.7, 6 * u, floor - H * 0.7 + 6 * u);
  const fab = pick(r, FABRIC);
  const out = SCENES.forest({ ...c, F: wx + ww / 2, r: rand(seedOf("cabin") + Math.floor(r() * 99)) });
  return room(
    c,
    win,
    [150, 100, 64],
    viewOf(out),
    (g, E) => {
      stroke(g, logs, shade(E, [70, 44, 28]), 3 * u, 0.8);
      spill(g, E, wx, wx + ww, wy + wh, floor, 50 * u);
      fill(g, frame, shade(E, [90, 60, 40]));
      fill(g, chim, shade(E, [70, 64, 62], 0.4));
      fill(g, stones, shade(E, [140, 130, 122], 0.45));
      fill(g, mouth, [20, 12, 10]);
      glowAt(g, hx, floor - 16 * u, 260 * u, [255, 140, 60], 0.4);
      fire(g, E, hx, floor - 4 * u, u * 1.5);
      fill(g, mantel, shade(E, [110, 70, 44]));
      stroke(g, antlers, shade(E, [220, 206, 180], 0.5), 3 * u);
      fill(g, wood, shade(E, [150, 110, 70], 0.5));
      g.fillStyle = rgb(shade(E, [200, 186, 160], 0.5), 0.9);
      g.beginPath();
      g.ellipse(F + 40 * u, H * 0.93, 150 * u, 16 * u, 0, 0, TAU);
      g.fill();
      fill(g, chair, shade(E, [120, 62, 40], 0.5));
      fill(g, plaid, shade(E, fab, 0.5));
      fill(g, table, shade(E, [100, 66, 40]));
      lamp(g, E, F + 20 * u, H * 0.66, 90 * u, 5, WARM, 0.4);
      g.fillStyle = rgb([40, 30, 24]);
      g.fillRect(F + 13 * u, H * 0.62, 14 * u, 3 * u);
      g.fillRect(F + 13 * u, H * 0.69, 14 * u, 2 * u);
    },
    floor,
  );
}

function treehouse(c: Ctx): Scene {
  const { W, H, u, F, r } = c;
  const floor = H * 0.84;
  const wx = F - 220 * u;
  const wy = H * 0.18;
  const ww = 170 * u;
  const wh = H * 0.38;
  const win = new Path2D();
  win.rect(wx, wy, ww, wh);
  const round = new Path2D();
  circle(round, F + 160 * u, H * 0.3, 26 * u);
  win.addPath(round);
  const frame = new Path2D();
  frame.rect(wx - 10 * u, wy - 10 * u, ww + 20 * u, 10 * u);
  frame.rect(wx - 10 * u, wy + wh, ww + 20 * u, 10 * u);
  frame.rect(wx - 10 * u, wy, 10 * u, wh);
  frame.rect(wx + ww, wy, 10 * u, wh);
  frame.moveTo(F + 190 * u, H * 0.3);
  frame.arc(F + 160 * u, H * 0.3, 30 * u, 0, TAU);
  frame.moveTo(F + 186 * u, H * 0.3);
  frame.arc(F + 160 * u, H * 0.3, 26 * u, 0, TAU, true);
  const planks = new Path2D();
  for (let x = (F % (18 * u)) - 18 * u; x < W; x += 18 * u) {
    planks.moveTo(x, 0);
    planks.lineTo(x, floor);
  }
  const roof = new Path2D();
  poly(roof, 0, 0, W, 0, W, H * 0.06, 0, H * 0.06);
  const leaves = new Path2D();
  for (let k = 0; k < 9; k++) circle(leaves, wx + r() * ww, wy + r() * wh * 0.4, (14 + r() * 18) * u);
  const branch = new Path2D();
  poly(branch, wx, wy + wh * 0.62, wx + ww * 0.7, wy + wh * 0.5, wx + ww * 0.72, wy + wh * 0.54, wx, wy + wh * 0.7);
  const bag = new Path2D();
  bag.moveTo(F - 10 * u, floor + 10 * u);
  bag.quadraticCurveTo(F - 30 * u, H * 0.6, F + 30 * u, H * 0.62);
  bag.quadraticCurveTo(F + 90 * u, H * 0.66, F + 80 * u, floor + 10 * u);
  bag.closePath();
  const hole = new Path2D();
  hole.rect(F + 130 * u, H * 0.9, 70 * u, 20 * u);
  const rope = new Path2D();
  for (const x of [F + 145 * u, F + 185 * u]) rope.rect(x, H * 0.9, 2 * u, 20 * u);
  const crate = new Path2D();
  crate.rect(F - 140 * u, H * 0.68, 60 * u, floor - H * 0.68 + 6 * u);
  const jar = new Path2D();
  rr(jar, F - 124 * u, H * 0.68 - 30 * u, 26 * u, 30 * u, 5 * u);
  const flies = motes(c, 6, F - 120 * u, F - 102 * u, H * 0.68 - 26 * u, H * 0.68 - 6 * u);
  const bulbs = Array.from({ length: 22 }, (_, k) => {
    const t = k / 21;
    return { x: lerp(F - 300 * u, F + 260 * u, t), y: H * 0.1 + Math.sin(t * Math.PI) * 26 * u, c: pick(r, [[255, 200, 120], [255, 120, 140], [140, 220, 255], [180, 255, 160]] as RGB[]) };
  });
  const fab = pick(r, FABRIC);
  const out = SCENES.forest({ ...c, F: wx + ww / 2, r: rand(seedOf("treehouse") + Math.floor(r() * 99)) });
  return room(
    c,
    win,
    [160, 118, 76],
    (g, E) => {
      out.draw(g, E);
      fill(g, branch, tone(E, 0.8, WOOD, 0.5));
      sway(g, E, leaves, 0, 0, tone(E, 0.7, [70, 140, 60], 0.6), 0.3);
    },
    (g, E) => {
      stroke(g, planks, shade(E, [90, 60, 36]), 1.4 * u, 0.7);
      fill(g, roof, shade(E, [100, 70, 44], 0.4));
      spill(g, E, wx, wx + ww, wy + wh, floor, 60 * u);
      fill(g, frame, shade(E, [110, 76, 48]));
      g.strokeStyle = rgb([30, 24, 20]);
      g.lineWidth = 1 * u;
      g.beginPath();
      for (const b of bulbs) g.lineTo(b.x, b.y);
      g.stroke();
      const on = lampsOn(E, 0.25);
      for (const b of bulbs) {
        glowAt(g, b.x, b.y + 3 * u, 16 * u, b.c, 0.5 * on * flick(E, b.x));
        g.fillStyle = rgb(mix(b.c, [255, 255, 255], 0.4), 0.4 + 0.6 * on);
        g.beginPath();
        g.arc(b.x, b.y + 3 * u, 2.4 * u, 0, TAU);
        g.fill();
      }
      fill(g, hole, [16, 12, 10]);
      fill(g, rope, shade(E, [200, 170, 110]));
      fill(g, bag, shade(E, fab, 0.5));
      fill(g, crate, shade(E, [170, 130, 80], 0.45));
      fill(g, jar, shade(E, [200, 230, 220], 0.3), 0.5);
      fireflies(g, E, flies, u * 0.35, [230, 255, 150], 0.6);
    },
    floor,
  );
}

function tent(c: Ctx): Scene {
  const { W, H, u, F, r } = c;
  const floor = H * 0.86;
  const dx = F - 60 * u;
  const win = new Path2D();
  win.moveTo(dx, H * 0.2);
  win.quadraticCurveTo(dx - 40 * u, H * 0.6, dx - 80 * u, floor);
  win.lineTo(dx + 80 * u, floor);
  win.quadraticCurveTo(dx + 40 * u, H * 0.6, dx, H * 0.2);
  win.closePath();
  const flaps = new Path2D();
  for (const s of [-1, 1]) {
    flaps.moveTo(dx, H * 0.2);
    flaps.quadraticCurveTo(dx + s * 40 * u, H * 0.6, dx + s * 80 * u, floor);
    flaps.lineTo(dx + s * 120 * u, floor);
    flaps.quadraticCurveTo(dx + s * 96 * u, H * 0.56, dx + s * 110 * u, H * 0.5);
    flaps.quadraticCurveTo(dx + s * 50 * u, H * 0.42, dx, H * 0.2);
    flaps.closePath();
  }
  const ties = new Path2D();
  for (const s of [-1, 1]) ties.rect(dx + s * 104 * u - 2 * u, H * 0.5, 4 * u, 10 * u);
  const seams = new Path2D();
  for (let k = -5; k <= 5; k++) {
    seams.moveTo(dx + 60 * u, -10 * u);
    seams.lineTo(dx + 60 * u + k * W * 0.18, floor);
  }
  const sides = new Path2D();
  poly(sides, 0, 0, F - 200 * u, 0, 0, floor);
  poly(sides, F + 260 * u, 0, W, 0, W, floor);
  const roll = new Path2D();
  rr(roll, F + 40 * u, H * 0.8, 210 * u, 30 * u, 14 * u);
  const pillow = new Path2D();
  rr(pillow, F + 200 * u, H * 0.77, 50 * u, 18 * u, 8 * u);
  const pack = new Path2D();
  rr(pack, F - 240 * u, H * 0.62, 60 * u, 84 * u, 14 * u);
  const straps = new Path2D();
  for (const x of [F - 228 * u, F - 196 * u]) straps.rect(x, H * 0.62, 5 * u, 84 * u);
  const lx = F + 90 * u;
  const hook = new Path2D();
  hook.rect(lx - 0.6 * u, 0, 1.2 * u, H * 0.2);
  const lantern = new Path2D();
  rr(lantern, lx - 8 * u, H * 0.2, 16 * u, 22 * u, 3 * u);
  const fab = pick(r, FABRIC);
  const canvas: RGB = pick(r, [[200, 176, 128], [150, 160, 120], [176, 120, 96], [130, 150, 170]] as RGB[]);
  const out = camp({ ...c, F: dx, r: rand(seedOf("tent") + Math.floor(r() * 99)) });
  return room(
    c,
    win,
    canvas,
    viewOf(out),
    (g, E) => {
      fill(g, sides, shade(E, mix(canvas, DARK, 0.3), 0.4));
      stroke(g, seams, mix(canvas, DARK, 0.6), 1.2 * u, 0.5);
      fill(g, flaps, shade(E, mix(canvas, DARK, 0.15), 0.45));
      fill(g, ties, shade(E, [90, 70, 50]));
      const on = clamp(Math.max(E.glow, 0.3)) * flick(E, 2);
      glowAt(g, lx, H * 0.3, 380 * u, [255, 190, 110], 0.38 * on);
      fill(g, roll, shade(E, fab, 0.45));
      fill(g, pillow, shade(E, [210, 200, 180], 0.5));
      fill(g, pack, shade(E, [90, 96, 70], 0.45));
      fill(g, straps, shade(E, [60, 46, 36]));
      fill(g, hook, [40, 30, 24]);
      fill(g, lantern, [40, 34, 28]);
      lamp(g, E, lx, H * 0.22 + 11 * u, 120 * u, 2, WARM, 0.5);
    },
    floor,
  );
}

// ---------- Pools and baths ----------

function pool(c: Ctx): Scene {
  const { W, H, u, F, r } = c;
  const hy = H * 0.6;
  const trees = new Path2D();
  const palms = new Path2D();
  const tropical = r() < 0.5;
  for (let x = -20 * u; x < W + 20 * u; x += (40 + r() * 40) * u) {
    if (tropical && r() < 0.35) palm(palms, x, hy, (90 + r() * 50) * u, (r() - 0.5) * 40 * u);
    else leafy(trees, x, hy + 4 * u, (50 + r() * 50) * u);
  }
  const hedge = ridge(c, hy - 14 * u, 4 * u, 3);
  const house = new Path2D();
  house.rect(F - 420 * u, H * 0.3, 230 * u, hy - H * 0.3 + 2 * u);
  const roof = new Path2D();
  roof.rect(F - 430 * u, H * 0.28, 250 * u, 8 * u);
  const glass = new Path2D();
  for (let k = 0; k < 3; k++) glass.rect(F - 400 * u + k * 64 * u, H * 0.38, 56 * u, hy - H * 0.38);
  const deck = new Path2D();
  deck.rect(0, hy, W, H - hy);
  const fx0 = F - 210 * u;
  const fx1 = F + 170 * u;
  const nx0 = F - 330 * u;
  const nx1 = F + 260 * u;
  const py0 = H * 0.66;
  const py1 = H * 0.97;
  const water_ = new Path2D();
  poly(water_, fx0, py0, fx1, py0, nx1, py1, nx0, py1);
  const coping = new Path2D();
  poly(coping, fx0 - 8 * u, py0 - 4 * u, fx1 + 8 * u, py0 - 4 * u, nx1 + 12 * u, py1 + 5 * u, nx0 - 12 * u, py1 + 5 * u);
  const ladder = new Path2D();
  for (const x of [fx1 - 40 * u, fx1 - 22 * u]) {
    ladder.moveTo(x, py0 + 10 * u);
    ladder.lineTo(x, py0 - 14 * u);
    ladder.quadraticCurveTo(x, py0 - 22 * u, x - 10 * u, py0 - 18 * u);
  }
  const lounge = new Path2D();
  for (const x of [F + 230 * u, F + 320 * u]) {
    poly(lounge, x, H * 0.72, x + 70 * u, H * 0.72, x + 70 * u, H * 0.74, x, H * 0.74);
    poly(lounge, x, H * 0.72, x - 26 * u, H * 0.64, x - 22 * u, H * 0.63, x + 4 * u, H * 0.71);
    lounge.rect(x + 4 * u, H * 0.74, 3 * u, 12 * u);
    lounge.rect(x + 63 * u, H * 0.74, 3 * u, 12 * u);
  }
  const ux = F + 290 * u;
  const pole = new Path2D();
  pole.rect(ux - 1.2 * u, H * 0.42, 2.4 * u, H * 0.34);
  const brolly = new Path2D();
  brolly.moveTo(ux - 64 * u, H * 0.46);
  brolly.quadraticCurveTo(ux, H * 0.32, ux + 64 * u, H * 0.46);
  for (let k = 4; k >= 0; k--) brolly.quadraticCurveTo(ux - 64 * u + (k + 0.5) * 25.6 * u, H * 0.49, ux - 64 * u + k * 25.6 * u, H * 0.46);
  brolly.closePath();
  const fab = pick(r, FABRIC);
  const sh = shims(c, 50);
  const fl = motes(c, 8, 0, W, H * 0.4, hy);
  const bl = motes(c, 5, 0, W, H * 0.08, H * 0.3);
  return {
    draw(g, E) {
      fill(g, trees, tone(E, 0.45, [60, 120, 70], 0.55));
      fill(g, palms, tone(E, 0.5, [50, 110, 70], 0.55));
      fill(g, hedge.p, tone(E, 0.6, [50, 100, 56], 0.6));
      fill(g, house, lit(E, 0.5, [236, 230, 218], 0.7));
      fill(g, roof, tone(E, 0.7, [90, 90, 96], 0.4));
      fill(g, glass, mix(E.sky.bot, DARK, 0.45));
      g.fillStyle = rgb(WARM, 0.75 * clamp(E.glow * 1.3));
      g.fill(glass);
      birds(g, E, c, bl);
      fill(g, deck, lit(E, 0.75, [222, 210, 190], 0.65));
      fill(g, coping, lit(E, 0.7, [244, 240, 232], 0.7));
      poolWater(g, E, water_, nx0, nx1, py0, py1, u, sh);
      stroke(g, ladder, lit(E, 0.8, [210, 214, 220], 0.7), 2.4 * u);
      fill(g, lounge, lit(E, 0.85, [240, 236, 228], 0.7));
      fill(g, pole, tone(E, 0.85));
      fill(g, brolly, lit(E, 0.8, fab, 0.7));
      for (const x of [F - 380 * u, F - 100 * u, F + 200 * u]) lamp(g, E, x, py0 - 8 * u, 40 * u, x, [180, 240, 255], 0);
      fireflies(g, E, fl, u, [255, 240, 180]);
    },
  };
}

function indoorpool(c: Ctx): Scene {
  const { W, H, u, F, r } = c;
  const floor = H * 0.62;
  const win = new Path2D();
  const frame = new Path2D();
  const start = F - 420 * u;
  for (let x = start - Math.ceil(start / (72 * u)) * 72 * u; x < W; x += 72 * u) {
    win.rect(x, H * 0.1, 66 * u, H * 0.36);
    frame.rect(x - 3 * u, H * 0.1, 6 * u, H * 0.36);
  }
  frame.rect(0, H * 0.08, W, 6 * u);
  frame.rect(0, H * 0.27, W, 3 * u);
  frame.rect(0, H * 0.46, W, 6 * u);
  const tiles = new Path2D();
  grid(tiles, 0, H * 0.48, W, floor, 12 * u, 12 * u);
  const ceiling = new Path2D();
  ceiling.rect(0, 0, W, H * 0.08);
  const beams = new Path2D();
  for (let x = F % (140 * u); x < W; x += 140 * u) beams.rect(x - 4 * u, 0, 8 * u, H * 0.1);
  const fx0 = F - 380 * u;
  const fx1 = F + 320 * u;
  const py0 = H * 0.68;
  const py1 = H * 1.02;
  const nx0 = F - 700 * u;
  const nx1 = F + 640 * u;
  const water_ = new Path2D();
  poly(water_, fx0, py0, fx1, py0, nx1, py1, nx0, py1);
  const lanes = new Path2D();
  const n = 6;
  for (let k = 1; k < n; k++) {
    lanes.moveTo(lerp(fx0, fx1, k / n), py0);
    lanes.lineTo(lerp(nx0, nx1, k / n), py1);
  }
  const blocks = new Path2D();
  for (let k = 0; k < n; k++) rr(blocks, lerp(fx0, fx1, (k + 0.5) / n) - 9 * u, py0 - 14 * u, 18 * u, 10 * u, 2 * u);
  const sh = shims(c, 70);
  const out = r() < 0.5 ? hillView(c) : viewOf(SCENES.city(c));
  return room(
    c,
    win,
    [196, 220, 226],
    out,
    (g, E) => {
      fill(g, frame, shade(E, [200, 206, 212], 0.55));
      stroke(g, tiles, shade(E, [150, 176, 186]), 0.8 * u, 0.6);
      fill(g, ceiling, shade(E, [150, 156, 164], 0.4));
      fill(g, beams, shade(E, [120, 126, 134], 0.4));
      const on = lampsOn(E, 0.3);
      for (let x = (F % (140 * u)) + 70 * u; x < W; x += 140 * u) glowAt(g, x, H * 0.07, 70 * u, [230, 240, 255], 0.5 * on);
      fill(g, blocks, shade(E, [230, 232, 236], 0.6));
      poolWater(g, E, water_, nx0, nx1, py0, py1, u, sh, 0.6);
      g.save();
      g.setLineDash([3 * u, 3 * u]);
      stroke(g, lanes, [220, 60, 60], 2 * u, 0.85);
      g.lineDashOffset = 3 * u;
      stroke(g, lanes, [240, 240, 240], 2 * u, 0.85);
      g.restore();
    },
    floor,
  );
}

function hotspring(c: Ctx): Scene {
  const { W, H, u, F, r } = c;
  const far = peaks(c, H * 0.5, 100 * u, 0.5, F + 80 * u);
  const woods = new Path2D();
  for (let x = -10 * u; x < W + 10 * u; x += (14 + r() * 16) * u) pine(woods, x, H * 0.64, (40 + r() * 40) * u);
  const bank = ridge(c, H * 0.66, 4 * u);
  const px = F - 20 * u;
  const py = H * 0.8;
  const prx = 240 * u;
  const pry = 42 * u;
  const pond = new Path2D();
  ellipse(pond, px, py, prx, pry);
  const backRocks = new Path2D();
  const frontRocks = new Path2D();
  for (let a = 0; a < TAU; a += 0.16 + r() * 0.12) {
    const x = px + Math.cos(a) * (prx + 8 * u);
    const y = py + Math.sin(a) * (pry + 6 * u);
    ellipse(Math.sin(a) < 0 ? backRocks : frontRocks, x, y, (14 + r() * 16) * u, (8 + r() * 7) * u);
  }
  const big = new Path2D();
  ellipse(big, px + prx * 0.9, py - 18 * u, 40 * u, 26 * u);
  ellipse(big, px - prx * 0.95, py - 10 * u, 34 * u, 20 * u);
  const tx = F + 290 * u;
  const toro = new Path2D();
  toro.rect(tx - 4 * u, H * 0.66, 8 * u, 40 * u);
  poly(toro, tx - 22 * u, H * 0.64, tx + 22 * u, H * 0.64, tx + 14 * u, H * 0.6, tx - 14 * u, H * 0.6);
  toro.rect(tx - 12 * u, H * 0.52, 24 * u, 18 * u);
  poly(toro, tx - 26 * u, H * 0.53, tx + 26 * u, H * 0.53, tx + 4 * u, H * 0.45, tx - 4 * u, H * 0.45);
  toro.rect(tx - 16 * u, H * 0.75, 32 * u, 6 * u);
  const fence = new Path2D();
  for (let x = F - 460 * u; x < F - 270 * u; x += 9 * u) fence.rect(x, H * 0.5 + Math.sin(x) * 2 * u, 7 * u, H * 0.26);
  const ties = new Path2D();
  for (const y of [0.56, 0.68]) ties.rect(F - 460 * u, H * y, 190 * u, 3 * u);
  const maple = new Path2D();
  leafy(maple, F - 250 * u, H * 0.68, 110 * u);
  const sh = shims(c, 40);
  return {
    draw(g, E) {
      fill(g, far.p, tone(E, 0.25, ROCK, 0.35));
      haze(g, E, W, H * 0.4, H * 0.62, 0.35);
      fill(g, woods, tone(E, 0.55, PINE, 0.5));
      fill(g, bank.p, tone(E, 0.7, [90, 96, 70], 0.4));
      fill(g, maple, tone(E, 0.6, [200, 70, 40], 0.7));
      fill(g, fence, tone(E, 0.75, [190, 170, 110], 0.55));
      fill(g, ties, tone(E, 0.85, [90, 70, 50], 0.4));
      fill(g, backRocks, tone(E, 0.7, STONE, 0.45));
      g.save();
      g.clip(pond);
      water(g, E, c, py - pry, sh, [90, 170, 160], py + pry);
      g.restore();
      fill(g, big, tone(E, 0.78, STONE, 0.45));
      fill(g, frontRocks, tone(E, 0.85, STONE, 0.45));
      for (let k = 0; k < 5; k++) steam(g, E, px - prx * 0.8 + k * prx * 0.4, py - 4 * u, u, 6, 26, 0.045 + 0.025 * E.night + 0.04 * E.c.snow);
      fill(g, toro, tone(E, 0.82, STONE, 0.45));
      lamp(g, E, tx, H * 0.61, 70 * u, 9, WARM, 0);
    },
  };
}

// ---------- Out in the wild ----------

function camp(c: Ctx): Scene {
  const { W, H, u, F, r } = c;
  const hills_ = ridge(c, H * 0.58, 16 * u, 0.8);
  const woods = new Path2D();
  for (let x = -10 * u; x < W + 10 * u; x += (12 + r() * 14) * u) pine(woods, x, H * 0.68 + r() * 6 * u, (50 + r() * 50) * u);
  const ground = ridge(c, H * 0.74, 5 * u);
  const tents: { p: Path2D; door: Path2D; c: RGB; x: number }[] = [];
  for (const [x, s] of [
    [F - 220 * u, 1],
    [F + 170 * u, 0.85],
    [F - 360 * u, 0.7],
  ] as const) {
    const p = new Path2D();
    const gy = H * 0.82 - (1 - s) * 30 * u;
    const w = 90 * u * s;
    const h = 70 * u * s;
    poly(p, x - w / 2, gy, x, gy - h, x + w / 2, gy);
    poly(p, x, gy - h, x + w / 2, gy, x + w * 1.1, gy - 4 * u * s, x + w * 0.62, gy - h - 4 * u * s);
    const door = new Path2D();
    poly(door, x - w * 0.12, gy, x, gy - h * 0.7, x + w * 0.12, gy);
    tents.push({ p, door, c: pick(r, [[200, 170, 120], [150, 70, 60], [80, 110, 90], [190, 140, 70]] as RGB[]), x });
  }
  const fx = F;
  const fy = H * 0.86;
  const ring = new Path2D();
  for (let k = 0; k < 9; k++) {
    const a = (k / 9) * TAU;
    ellipse(ring, fx + Math.cos(a) * 26 * u, fy + Math.sin(a) * 7 * u, 7 * u, 4 * u);
  }
  const logs = new Path2D();
  poly(logs, fx - 120 * u, fy + 6 * u, fx - 50 * u, fy - 2 * u, fx - 48 * u, fy + 8 * u, fx - 118 * u, fy + 16 * u);
  poly(logs, fx + 60 * u, fy + 14 * u, fx + 130 * u, fy + 4 * u, fx + 132 * u, fy + 14 * u, fx + 62 * u, fy + 24 * u);
  const sitter = new Path2D();
  figure(sitter, fx + 92 * u, fy + 8 * u, 52 * u);
  const sparks = motes(c, 14, fx - 20 * u, fx + 20 * u, fy - 120 * u, fy - 20 * u);
  const fl = motes(c, 12, 0, W, H * 0.6, H * 0.8);
  return {
    draw(g, E) {
      const T = time(E);
      fill(g, hills_.p, tone(E, 0.3, GRASS, 0.4));
      haze(g, E, W, H * 0.45, H * 0.7, 0.3);
      fill(g, woods, tone(E, 0.6, PINE, 0.5));
      fill(g, ground.p, tone(E, 0.75, [110, 100, 64], 0.5));
      glowAt(g, fx, fy - 10 * u, 300 * u, [255, 150, 70], 0.3 * (0.4 + E.glow));
      for (const t of tents) {
        fill(g, t.p, lit(E, 0.8, t.c, 0.6));
        g.fillStyle = rgb([255, 190, 110], 0.25 * E.glow * flick(E, t.x));
        g.fill(t.p);
        fill(g, t.door, tone(E, 0.95));
      }
      fill(g, logs, tone(E, 0.9, WOOD, 0.5));
      fill(g, ring, tone(E, 0.85, STONE, 0.4));
      fire(g, E, fx, fy, u * 1.6);
      smoke(g, E, fx, fy - 40 * u, u);
      for (const s of sparks) {
        const k = (T * 0.4 * s.s + s.p) % 1;
        g.fillStyle = rgb([255, 200, 120], 0.8 * (1 - k));
        g.fillRect(s.x + Math.sin(T * 2 + s.p) * 8 * u, fy - 20 * u - k * 110 * u, 1.6 * u, 1.6 * u);
      }
      fill(g, sitter, tone(E, 0.96));
      fireflies(g, E, fl, u);
    },
  };
}

// ---------- On the move ----------

function deck(c: Ctx): Scene {
  const { W, H, u, F, r } = c;
  const hy = H * 0.5;
  const sh = shims(c, 110);
  const wide = { ...c, W: W * 1.3 };
  const isle = new Path2D();
  if (r() < 0.6) {
    const ix = r() * W;
    isle.moveTo(ix - 120 * u, hy);
    isle.quadraticCurveTo(ix - 40 * u, hy - 26 * u, ix, hy - 30 * u);
    isle.quadraticCurveTo(ix + 50 * u, hy - 20 * u, ix + 140 * u, hy);
    isle.closePath();
  }
  const planks = new Path2D();
  for (let k = -14; k <= 14; k++) {
    planks.moveTo(F + k * 26 * u, H * 0.78);
    planks.lineTo(F + k * 70 * u, H);
  }
  const boards = new Path2D();
  boards.rect(0, H * 0.78, W, H * 0.22);
  const bulwark = new Path2D();
  bulwark.rect(0, H * 0.7, W, H * 0.08);
  const rail = new Path2D();
  rail.rect(0, H * 0.615, W, 7 * u);
  for (let x = (F % (26 * u)) - 26 * u; x < W; x += 26 * u) rail.rect(x, H * 0.62, 5 * u, H * 0.08);
  const mx = F - 150 * u;
  const mast = new Path2D();
  mast.rect(mx - 8 * u, -10 * u, 16 * u, H * 0.8);
  mast.rect(mx - 120 * u, H * 0.1, 240 * u, 6 * u);
  const sail = new Path2D();
  sail.moveTo(mx - 112 * u, H * 0.13);
  sail.lineTo(mx + 112 * u, H * 0.13);
  sail.quadraticCurveTo(mx + 124 * u, H * 0.3, mx + 104 * u, H * 0.44);
  sail.quadraticCurveTo(mx, H * 0.48, mx - 104 * u, H * 0.44);
  sail.quadraticCurveTo(mx - 124 * u, H * 0.3, mx - 112 * u, H * 0.13);
  const rigging = new Path2D();
  for (const s of [-1, 1])
    for (let k = 0; k < 4; k++) {
      rigging.moveTo(mx, H * 0.05);
      rigging.lineTo(mx + s * (40 + k * 30) * u, H * 0.62);
    }
  for (let y = 0.2; y < 0.6; y += 0.06) {
    rigging.moveTo(mx + 40 * u * ((y - 0.05) / 0.57), H * y);
    rigging.lineTo(mx + 130 * u * ((y - 0.05) / 0.57), H * y);
  }
  const wx = F + 170 * u;
  const wy = H * 0.66;
  const wheel = new Path2D();
  wheel.moveTo(wx + 40 * u, wy);
  wheel.arc(wx, wy, 40 * u, 0, TAU);
  wheel.moveTo(wx + 33 * u, wy);
  wheel.arc(wx, wy, 33 * u, 0, TAU, true);
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * TAU;
    wheel.moveTo(wx + Math.cos(a) * 6 * u, wy + Math.sin(a) * 6 * u);
    wheel.lineTo(wx + Math.cos(a) * 52 * u, wy + Math.sin(a) * 52 * u);
  }
  const post = new Path2D();
  post.rect(wx - 10 * u, wy, 20 * u, H * 0.22);
  const barrels = new Path2D();
  const hoops = new Path2D();
  for (const x of [F - 320 * u, F - 270 * u]) {
    rr(barrels, x - 22 * u, H * 0.74, 44 * u, 60 * u, 14 * u);
    for (const y of [0.77, 0.86]) hoops.rect(x - 22 * u, H * y, 44 * u, 3 * u);
  }
  const rope = new Path2D();
  for (let k = 0; k < 4; k++) ellipse(rope, F + 30 * u, H * 0.9, (30 - k * 6) * u, (10 - k * 2) * u);
  const bl = motes(c, 6, 0, W, H * 0.12, H * 0.4);
  return {
    draw(g, E) {
      const T = time(E);
      const roll = Math.sin(T * 0.6) * 0.025 + Math.sin(T * 0.23) * 0.01;
      g.save();
      g.translate(F, H * 0.7);
      g.rotate(roll);
      g.translate(-F - W * 0.15, -H * 0.7);
      fill(g, isle, tone(E, 0.3, [70, 100, 80], 0.4));
      water(g, E, wide, hy, sh);
      g.restore();
      birds(g, E, c, bl);
      stroke(g, rigging, tone(E, 0.9), 1 * u);
      fill(g, sail, lit(E, 0.75, [236, 226, 204], 0.75));
      fill(g, mast, tone(E, 0.9, WOOD, 0.45));
      lamp(g, E, mx + 14 * u, H * 0.5, 80 * u, 4, WARM, 0.1);
      fill(g, rail, tone(E, 0.88, WOOD, 0.5));
      fill(g, bulwark, tone(E, 0.86, WOOD, 0.5));
      fill(g, boards, lit(E, 0.75, [176, 134, 90], 0.6));
      stroke(g, planks, tone(E, 0.95), 1 * u, 0.6);
      fill(g, barrels, tone(E, 0.85, [140, 96, 60], 0.55));
      fill(g, hoops, tone(E, 0.95));
      stroke(g, rope, tone(E, 0.85, [200, 170, 120], 0.5), 3 * u);
      fill(g, post, tone(E, 0.92, WOOD, 0.45));
      g.save();
      g.translate(wx, wy);
      g.rotate(E.still ? 0 : Math.sin(T * 0.3) * 0.3);
      g.translate(-wx, -wy);
      stroke(g, wheel, tone(E, 0.9, WOOD, 0.5), 4 * u);
      fill(g, wheel, tone(E, 0.9, WOOD, 0.5));
      g.restore();
    },
  };
}

/** A road ahead, rushing past (the view through a windscreen). */
function highway(c: Ctx): Paint {
  const { W, H, u, F, r } = c;
  const vx = F - 30 * u;
  const hy = H * 0.42;
  const far = ridge(c, hy + 2 * u, 10 * u, 0.8);
  const side = Array.from({ length: c.mini ? 12 : 22 }, () => ({ s: r() < 0.5 ? -1 : 1, z: r(), h: 0.8 + r() * 0.6, pole: r() < 0.3 }));
  const cars = Array.from({ length: 3 }, () => ({ z: r(), v: 0.08 + r() * 0.08 }));
  const town = r() < 0.4;
  return (g, E) => {
    const T = time(E);
    fill(g, far.p, tone(E, 0.35, town ? [120, 120, 130] : GRASS, 0.45));
    const road = g.createLinearGradient(0, hy, 0, H);
    road.addColorStop(0, rgb(tone(E, 0.5, [100, 100, 106], 0.4)));
    road.addColorStop(1, rgb(tone(E, 0.85, [70, 70, 76], 0.4)));
    g.fillStyle = road;
    g.beginPath();
    g.moveTo(vx - 2 * u, hy);
    g.lineTo(vx + 2 * u, hy);
    g.lineTo(vx + W * 0.8, H);
    g.lineTo(vx - W * 0.8, H);
    g.fill();
    const at = (z: number) => hy + (H - hy) * z * z;
    g.fillStyle = rgb([240, 236, 200], 0.55 + 0.3 * E.glow);
    for (let i = 0; i < 8; i++) {
      const z0 = (i / 8 + T * 0.5) % 1;
      const z1 = Math.min(1, z0 + 0.05);
      const y0 = at(z0);
      const y1 = at(z1);
      g.beginPath();
      g.moveTo(vx - z0 * 3 * u, y0);
      g.lineTo(vx + z0 * 3 * u, y0);
      g.lineTo(vx + z1 * 3 * u, y1);
      g.lineTo(vx - z1 * 3 * u, y1);
      g.fill();
    }
    const items = side.map((t) => ({ ...t, z: (t.z + T * 0.18) % 1 })).sort((a, b) => a.z - b.z);
    for (const t of items) {
      const k = t.z * t.z;
      const x = vx + t.s * (16 * u + k * W * 0.95);
      const y = at(t.z);
      const h = (6 + k * 220) * u * t.h;
      if (t.pole || town) {
        g.fillStyle = rgb(tone(E, 0.5 + t.z * 0.45));
        g.fillRect(x - h * 0.02, y - h, Math.max(1, h * 0.04), h);
        lamp(g, E, x - t.s * h * 0.1, y - h, h * 0.8, x, WARM, 0);
      } else {
        const p = new Path2D();
        pine(p, x, y, h);
        fill(g, p, tone(E, 0.45 + t.z * 0.5, PINE, 0.5));
      }
    }
    for (const car of cars) {
      const z = (car.z + T * car.v) % 1;
      const y = at(z);
      const x = vx - (6 * u + z * z * W * 0.3);
      const s = (1 + z * z * 40) * u;
      glowAt(g, x - s, y - s * 0.4, s * 4, [255, 246, 220], 0.6 * E.glow);
      glowAt(g, x + s, y - s * 0.4, s * 4, [255, 246, 220], 0.6 * E.glow);
    }
  };
}

function car(c: Ctx): Scene {
  const { W, H, u, F, r } = c;
  const floor = H;
  const win = new Path2D();
  win.moveTo(F - 340 * u, H * 0.6);
  win.lineTo(F - 290 * u, H * 0.14);
  win.quadraticCurveTo(F - 30 * u, H * 0.08, F + 250 * u, H * 0.14);
  win.lineTo(F + 300 * u, H * 0.6);
  win.quadraticCurveTo(F - 20 * u, H * 0.66, F - 340 * u, H * 0.6);
  win.closePath();
  const dash = new Path2D();
  dash.moveTo(0, H * 0.62);
  dash.quadraticCurveTo(F - 20 * u, H * 0.54, W, H * 0.62);
  dash.lineTo(W, H);
  dash.lineTo(0, H);
  dash.closePath();
  const hood = new Path2D();
  hood.moveTo(F - 340 * u, H * 0.6);
  hood.quadraticCurveTo(F - 20 * u, H * 0.52, F + 300 * u, H * 0.6);
  hood.quadraticCurveTo(F - 20 * u, H * 0.66, F - 340 * u, H * 0.6);
  const sx = F - 190 * u;
  const sy = H * 0.86;
  const wheel = new Path2D();
  wheel.moveTo(sx + 74 * u, sy);
  wheel.arc(sx, sy, 74 * u, 0, TAU);
  wheel.moveTo(sx + 63 * u, sy);
  wheel.arc(sx, sy, 63 * u, 0, TAU, true);
  rr(wheel, sx - 62 * u, sy - 6 * u, 124 * u, 14 * u, 6 * u);
  rr(wheel, sx - 20 * u, sy - 12 * u, 40 * u, 30 * u, 8 * u);
  const dials = [sx - 26 * u, sx + 26 * u];
  const screen = new Path2D();
  rr(screen, F + 10 * u, H * 0.66, 76 * u, 46 * u, 6 * u);
  const mirror = new Path2D();
  mirror.rect(F - 31 * u, H * 0.06, 2 * u, H * 0.09);
  rr(mirror, F - 60 * u, H * 0.14, 60 * u, 18 * u, 6 * u);
  const tree = new Path2D();
  poly(tree, 0, 0, 6 * u, 12 * u, 3 * u, 12 * u, 7 * u, 20 * u, -7 * u, 20 * u, -3 * u, 12 * u, -6 * u, 12 * u);
  tree.rect(-0.4 * u, -18 * u, 0.8 * u, 18 * u);
  const treeHue = pick(r, [[90, 200, 110], [240, 200, 60], [230, 90, 120]] as RGB[]);
  const paint = pick(r, [[160, 30, 40], [30, 60, 120], [220, 220, 224], [30, 30, 34], [60, 110, 80]] as RGB[]);
  return room(
    c,
    win,
    [56, 54, 58],
    highway(c),
    (g, E) => {
      fill(g, hood, lit(E, 0.7, paint, 0.6));
      fill(g, dash, [22, 22, 26]);
      g.strokeStyle = rgb([60, 60, 66]);
      g.lineWidth = 1.2 * u;
      g.beginPath();
      g.moveTo(0, H * 0.625);
      g.quadraticCurveTo(F - 20 * u, H * 0.545, W, H * 0.625);
      g.stroke();
      const on = clamp(E.glow * 1.2 + 0.25);
      for (const x of dials) {
        glowAt(g, x, H * 0.7, 28 * u, [120, 200, 255], 0.3 * on);
        g.strokeStyle = rgb([140, 210, 255], 0.5 + 0.4 * on);
        g.lineWidth = 1.4 * u;
        g.beginPath();
        g.arc(x, H * 0.7, 16 * u, Math.PI * 0.8, Math.PI * 2.2);
        g.stroke();
        g.strokeStyle = rgb([255, 120, 60], 0.9);
        g.beginPath();
        g.moveTo(x, H * 0.7);
        g.lineTo(x + Math.cos(Math.PI * 1.3) * 13 * u, H * 0.7 + Math.sin(Math.PI * 1.3) * 13 * u);
        g.stroke();
      }
      fill(g, screen, [10, 14, 20]);
      g.fillStyle = rgb([60, 140, 200], 0.4 + 0.3 * on);
      g.fillRect(F + 16 * u, H * 0.68, 64 * u, 38 * u);
      g.strokeStyle = rgb([255, 220, 120], 0.8);
      g.lineWidth = 1.6 * u;
      g.beginPath();
      g.moveTo(F + 24 * u, H * 0.66 + 40 * u);
      g.lineTo(F + 44 * u, H * 0.66 + 22 * u);
      g.lineTo(F + 70 * u, H * 0.66 + 14 * u);
      g.stroke();
      fill(g, wheel, [18, 18, 20]);
      fill(g, mirror, [30, 30, 34]);
      g.fillStyle = rgb(mix(E.sky.bot, DARK, 0.5));
      g.fillRect(F - 56 * u, H * 0.14 + 4 * u, 52 * u, 10 * u);
      sway(g, E, tree, F - 30 * u, H * 0.23 + 18 * u, shade(E, treeHue, 0.6), 4);
    },
    floor,
  );
}

function plane(c: Ctx): Scene {
  const { W, H, u, F, r } = c;
  const floor = H * 0.96;
  const ws: number[] = [];
  for (let x = F - 220 * u - Math.ceil((F - 220 * u) / (130 * u)) * 130 * u; x < W; x += 130 * u) ws.push(x);
  const win = new Path2D();
  const bezel = new Path2D();
  for (const x of ws) {
    rr(win, x, H * 0.2, 46 * u, 72 * u, 22 * u);
    rr(bezel, x - 8 * u, H * 0.2 - 8 * u, 62 * u, 88 * u, 30 * u);
  }
  const blinds = ws.map(() => (r() < 0.4 ? 0.2 + r() * 0.5 : 0));
  const bins = new Path2D();
  bins.moveTo(0, 0);
  bins.lineTo(W, 0);
  bins.lineTo(W, H * 0.1);
  bins.quadraticCurveTo(W / 2, H * 0.14, 0, H * 0.1);
  bins.closePath();
  const seams = new Path2D();
  for (let x = F % (130 * u); x < W; x += 130 * u) {
    seams.moveTo(x, 0);
    seams.lineTo(x, H * 0.12);
  }
  const seats = new Path2D();
  const heads = new Path2D();
  const trays = new Path2D();
  for (const x of [F - 260 * u, F - 150 * u, F + 30 * u, F + 140 * u]) {
    rr(seats, x, H * 0.5, 100 * u, H * 0.6, 22 * u);
    rr(heads, x + 14 * u, H * 0.52, 72 * u, 26 * u, 8 * u);
    trays.rect(x + 16 * u, H * 0.72, 68 * u, 34 * u);
  }
  const clouds = Array.from({ length: 30 }, () => ({ x: r() * W * 1.2, y: H * (0.42 + r() * 0.12), rr: (16 + r() * 30) * u }));
  const wing = new Path2D();
  const wx = ws.find((x) => x > F - 40 * u) ?? F;
  poly(wing, wx - 90 * u, H * 0.46, wx + 50 * u, H * 0.38, wx + 60 * u, H * 0.4, wx - 90 * u, H * 0.52);
  const seat = pick(r, [[40, 56, 96], [70, 70, 80], [110, 40, 50], [40, 80, 90]] as RGB[]);
  return room(
    c,
    win,
    [214, 210, 202],
    (g, E) => {
      const T = time(E);
      for (const cl of clouds) {
        const x = ((cl.x - T * 8 * u) % (W * 1.2) + W * 1.2) % (W * 1.2) - W * 0.1;
        g.fillStyle = rgb(mix(mix(E.sky.bot, [255, 255, 255], 0.5 * E.day), DARK, 0.3 * E.night));
        g.beginPath();
        g.arc(x, cl.y, cl.rr, 0, TAU);
        g.fill();
      }
      g.fillStyle = rgb(mix(mix(E.sky.bot, [255, 255, 255], 0.45 * E.day), DARK, 0.35 * E.night));
      g.fillRect(0, H * 0.5, W, H * 0.5);
      fill(g, wing, tone(E, 0.5, [200, 204, 212], 0.6));
      if (E.night > 0.5 && (E.still || Math.sin(T * 4) > 0.6)) glowAt(g, wx + 56 * u, H * 0.39, 10 * u, [255, 60, 60], 0.9);
    },
    (g, E) => {
      ws.forEach((x, i) => {
        if (!blinds[i]) return;
        g.save();
        const p = new Path2D();
        rr(p, x, H * 0.2, 46 * u, 72 * u, 22 * u);
        g.clip(p);
        g.fillStyle = rgb(shade(E, [226, 222, 214], 0.6));
        g.fillRect(x, H * 0.2, 46 * u, 72 * u * blinds[i]!);
        g.restore();
      });
      g.save();
      const ring = new Path2D();
      ring.addPath(bezel);
      ring.addPath(win);
      g.fillStyle = rgb(shade(E, [236, 234, 228], 0.6));
      g.fill(ring, "evenodd");
      g.restore();
      fill(g, bins, shade(E, [226, 224, 218], 0.5));
      stroke(g, seams, shade(E, [170, 168, 160]), 1 * u);
      const mood: RGB = E.night > 0.5 ? [150, 110, 255] : [255, 230, 200];
      for (let x = 60 * u; x < W; x += 120 * u) glowAt(g, x, H * 0.12, 90 * u, mood, 0.25 * lampsOn(E, 0.2));
      fill(g, seats, shade(E, seat, 0.45));
      fill(g, heads, shade(E, [236, 234, 230], 0.55));
      stroke(g, trays, shade(E, mix(seat, DARK, 0.4)), 1.2 * u);
    },
    floor,
  );
}

function submarine(c: Ctx): Scene {
  const { W, H, u, F, r } = c;
  const floor = H * 0.9;
  const ports: [number, number, number][] = [
    [F - 150 * u, H * 0.38, 46 * u],
    [F + 60 * u, H * 0.36, 34 * u],
  ];
  const win = new Path2D();
  const rings = new Path2D();
  const bolts = new Path2D();
  for (const [x, y, rad] of ports) {
    circle(win, x, y, rad);
    rings.moveTo(x + rad + 12 * u, y);
    rings.arc(x, y, rad + 12 * u, 0, TAU);
    rings.moveTo(x + rad, y);
    rings.arc(x, y, rad, 0, TAU, true);
    for (let k = 0; k < 10; k++) circle(bolts, x + Math.cos((k / 10) * TAU) * (rad + 6 * u), y + Math.sin((k / 10) * TAU) * (rad + 6 * u), 2 * u);
  }
  const pipes = new Path2D();
  rr(pipes, -10 * u, H * 0.06, W + 20 * u, 10 * u, 5 * u);
  rr(pipes, -10 * u, H * 0.12, W + 20 * u, 7 * u, 3.5 * u);
  rr(pipes, F + 200 * u, -10 * u, 12 * u, floor + 10 * u, 6 * u);
  const flanges = new Path2D();
  for (let x = F % (90 * u); x < W; x += 90 * u) flanges.rect(x - 3 * u, H * 0.055, 6 * u, 12 * u);
  const seams = new Path2D();
  for (let x = F % (120 * u); x < W; x += 120 * u) {
    seams.moveTo(x, H * 0.16);
    seams.lineTo(x, floor);
  }
  const vx = F + 206 * u;
  const vy = H * 0.5;
  const valve = new Path2D();
  valve.moveTo(vx + 26 * u, vy);
  valve.arc(vx, vy, 26 * u, 0, TAU);
  valve.moveTo(vx + 21 * u, vy);
  valve.arc(vx, vy, 21 * u, 0, TAU, true);
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * TAU + 0.4;
    valve.moveTo(vx, vy);
    valve.lineTo(vx + Math.cos(a) * 22 * u, vy + Math.sin(a) * 22 * u);
  }
  const gauges = [F - 300 * u, F - 250 * u, F - 40 * u].map((x, i) => ({ x, y: H * (i === 2 ? 0.62 : 0.58), p: r() * TAU }));
  const panel = new Path2D();
  rr(panel, F - 320 * u, H * 0.7, 400 * u, floor - H * 0.7 + 10 * u, 6 * u);
  const blinks = Array.from({ length: 18 }, () => ({ x: F - 300 * u + r() * 360 * u, y: H * (0.74 + r() * 0.1), p: r() * TAU, c: pick(r, [[255, 80, 80], [80, 255, 160], [255, 200, 80]] as RGB[]) }));
  const out = underwater({ ...c, r: rand(seedOf("submarine") + Math.floor(r() * 99)) });
  return room(
    c,
    win,
    [76, 92, 90],
    out,
    (g, E) => {
      stroke(g, seams, DARK, 1.2 * u, 0.5);
      fill(g, pipes, [60, 70, 70]);
      fill(g, flanges, [40, 46, 46]);
      fill(g, rings, [90, 100, 100]);
      fill(g, bolts, [50, 56, 56]);
      fill(g, panel, [40, 46, 48]);
      for (const b of blinks) {
        g.fillStyle = rgb(b.c, E.still || Math.sin(time(E) * 2 + b.p) > 0 ? 0.95 : 0.2);
        g.fillRect(b.x, b.y, 3 * u, 3 * u);
      }
      for (const ga of gauges) {
        g.fillStyle = rgb([220, 214, 190]);
        g.beginPath();
        g.arc(ga.x, ga.y, 14 * u, 0, TAU);
        g.fill();
        g.strokeStyle = rgb([40, 40, 40]);
        g.lineWidth = 3 * u;
        g.stroke();
        const a = -0.5 + Math.sin(time(E) * 1.3 + ga.p) * 0.15 + ga.p * 0.2;
        g.strokeStyle = rgb([180, 30, 30]);
        g.lineWidth = 1.4 * u;
        g.beginPath();
        g.moveTo(ga.x, ga.y);
        g.lineTo(ga.x + Math.cos(a) * 11 * u, ga.y + Math.sin(a) * 11 * u);
        g.stroke();
      }
      fill(g, valve, [170, 40, 36]);
      const red = 0.3 + 0.25 * E.night;
      glowAt(g, F - 40 * u, H * 0.05, 260 * u, [255, 50, 40], red * (E.still ? 1 : 0.85 + 0.15 * Math.sin(time(E) * 2)));
      lamp(g, E, F + 120 * u, H * 0.2, 90 * u, 1, [255, 220, 170], 0.4);
    },
    floor,
    { lift: 0.3, space: true },
  );
}

// ---------- Indoors, out and about ----------

function office(c: Ctx): Scene {
  const { W, H, u, F, r } = c;
  const floor = H * 0.84;
  const win = new Path2D();
  const mull = new Path2D();
  const x0 = F - 340 * u;
  const x1 = F + 110 * u;
  for (let x = x0; x < x1; x += 112 * u) win.rect(x, H * 0.06, 106 * u, floor - H * 0.06);
  for (let x = x0 - 6 * u; x <= x1; x += 112 * u) mull.rect(x, H * 0.06, 6 * u, floor - H * 0.06);
  mull.rect(x0 - 6 * u, H * 0.05, x1 - x0 + 6 * u, 5 * u);
  const desk = new Path2D();
  desk.rect(F - 170 * u, H * 0.66, 280 * u, 7 * u);
  desk.rect(F - 162 * u, H * 0.67, 8 * u, floor - H * 0.67 + 8 * u);
  desk.rect(F + 92 * u, H * 0.67, 8 * u, floor - H * 0.67 + 8 * u);
  const mon = new Path2D();
  rr(mon, F - 100 * u, H * 0.42, 110 * u, 64 * u, 4 * u);
  const stand = new Path2D();
  stand.rect(F - 48 * u, H * 0.42 + 64 * u, 6 * u, H * 0.66 - H * 0.42 - 64 * u);
  stand.rect(F - 64 * u, H * 0.66 - 3 * u, 38 * u, 3 * u);
  const kb = new Path2D();
  kb.rect(F - 80 * u, H * 0.66 - 3 * u, 70 * u, 3 * u);
  const chair = new Path2D();
  rr(chair, F - 90 * u, H * 0.6, 84 * u, 96 * u, 18 * u);
  chair.rect(F - 52 * u, H * 0.6 + 96 * u, 8 * u, 26 * u);
  poly(chair, F - 96 * u, H, F + 4 * u, H, F - 44 * u, H * 0.6 + 116 * u);
  const dl = new Path2D();
  dl.moveTo(F + 60 * u, H * 0.66);
  dl.lineTo(F + 70 * u, H * 0.54);
  dl.lineTo(F + 46 * u, H * 0.48);
  const plant = new Path2D();
  leafy(plant, F + 170 * u, floor - 24 * u, 120 * u);
  const pot = new Path2D();
  rr(pot, F + 150 * u, floor - 30 * u, 40 * u, 36 * u, 4 * u);
  const board = new Path2D();
  board.rect(F + 140 * u, H * 0.16, 150 * u, 90 * u);
  const marks = new Path2D();
  for (let k = 0; k < 5; k++) {
    const y = H * 0.16 + (16 + k * 15) * u;
    marks.moveTo(F + 152 * u, y);
    for (let x = 0; x < (60 + r() * 60) * u; x += 6 * u) marks.lineTo(F + 152 * u + x, y + Math.sin(x * 0.7) * 2 * u);
  }
  const lines = Array.from({ length: 7 }, () => 20 + r() * 70);
  return room(
    c,
    win,
    [204, 204, 200],
    viewOf(SCENES.city({ ...c, r: rand(seedOf("office") + Math.floor(r() * 99)) })),
    (g, E) => {
      fill(g, mull, shade(E, [90, 94, 100]));
      spill(g, E, x0, x1, floor, floor, 30 * u);
      fill(g, board, shade(E, [244, 244, 240], 0.6));
      stroke(g, marks, [40, 80, 160], 1.2 * u, 0.7);
      clock(g, E, F + 330 * u, H * 0.14, 12 * u);
      const on = lampsOn(E, 0.25);
      for (let x = F % (160 * u); x < W; x += 160 * u) glowAt(g, x, 0, 80 * u, [240, 246, 255], 0.45 * on);
      fill(g, desk, shade(E, [180, 160, 130], 0.5));
      fill(g, stand, [40, 40, 44]);
      fill(g, mon, [24, 24, 28]);
      g.fillStyle = rgb([200, 220, 250], 0.85);
      g.fillRect(F - 96 * u, H * 0.42 + 4 * u, 102 * u, 56 * u);
      g.fillStyle = rgb([90, 120, 170], 0.7);
      lines.forEach((w, k) => g.fillRect(F - 90 * u, H * 0.42 + (9 + k * 7) * u, w * u, 2.4 * u));
      glowAt(g, F - 45 * u, H * 0.48, 90 * u, [180, 210, 255], 0.25 * E.glow);
      fill(g, kb, [50, 50, 56]);
      stroke(g, dl, [50, 50, 56], 3 * u);
      lamp(g, E, F + 46 * u, H * 0.49, 80 * u, 2, WARM, 0);
      g.fillStyle = rgb(shade(E, [230, 90, 70], 0.6));
      g.fillRect(F + 20 * u, H * 0.66 - 14 * u, 11 * u, 14 * u);
      fill(g, chair, [30, 32, 38]);
      fill(g, pot, shade(E, [230, 230, 226], 0.6));
      fill(g, plant, shade(E, [60, 120, 70], 0.5));
    },
    floor,
  );
}

function classroom(c: Ctx): Scene {
  const { W, H, u, F, r } = c;
  const floor = H * 0.8;
  const win = new Path2D();
  const frame = new Path2D();
  for (const x of [F - 360 * u, F - 250 * u]) {
    win.rect(x, H * 0.16, 90 * u, H * 0.42);
    panes(frame, x, H * 0.16, 90 * u, H * 0.42, 2, 3, 2.2 * u);
  }
  const bx = F - 120 * u;
  const bw = 270 * u;
  const by = H * 0.18;
  const bh = 110 * u;
  const board = new Path2D();
  board.rect(bx, by, bw, bh);
  const trimB = new Path2D();
  trimB.rect(bx - 6 * u, by - 6 * u, bw + 12 * u, 6 * u);
  trimB.rect(bx - 6 * u, by + bh, bw + 12 * u, 8 * u);
  trimB.rect(bx - 6 * u, by, 6 * u, bh);
  trimB.rect(bx + bw, by, 6 * u, bh);
  const chalk = new Path2D();
  for (let k = 0; k < 4; k++) {
    const y = by + (20 + k * 20) * u;
    const x = bx + 16 * u;
    chalk.moveTo(x, y);
    for (let d = 0; d < (90 + r() * 70) * u; d += 5 * u) chalk.lineTo(x + d, y + Math.sin(d * 0.5 + k) * 2.5 * u);
  }
  chalk.moveTo(bx + 230 * u + 22 * u, by + 50 * u);
  chalk.arc(bx + 230 * u, by + 50 * u, 22 * u, 0, TAU);
  chalk.moveTo(bx + 208 * u, by + 50 * u);
  chalk.lineTo(bx + 252 * u, by + 50 * u);
  const green = r() < 0.6;
  const desks = new Path2D();
  const chairs = new Path2D();
  for (const [row, y, s] of [
    [0, H * 0.74, 0.8],
    [1, H * 0.9, 1],
  ] as const)
    for (let x = F - 330 * u + row * 50 * u; x < W; x += 150 * u * s) {
      desks.rect(x, y, 100 * u * s, 6 * u * s);
      desks.rect(x + 6 * u, y, 4 * u * s, (H - y) * 0.7);
      desks.rect(x + 90 * u * s, y, 4 * u * s, (H - y) * 0.7);
      rr(chairs, x + 26 * u * s, y + 10 * u * s, 48 * u * s, 30 * u * s, 6 * u * s);
    }
  const tdesk = new Path2D();
  tdesk.rect(F + 180 * u, H * 0.6, 120 * u, 6 * u);
  tdesk.rect(F + 186 * u, H * 0.61, 108 * u, floor - H * 0.61);
  const map = new Path2D();
  map.rect(F + 190 * u, H * 0.16, 120 * u, 76 * u);
  const land = new Path2D();
  for (let k = 0; k < 5; k++) ellipse(land, F + 200 * u + r() * 100 * u, H * 0.16 + (12 + r() * 52) * u, (8 + r() * 16) * u, (5 + r() * 10) * u);
  return room(
    c,
    win,
    pick(r, [[226, 214, 180], [196, 214, 200], [214, 206, 220]] as RGB[]),
    r() < 0.5 ? townView(c) : hillView(c),
    (g, E) => {
      spill(g, E, F - 360 * u, F - 160 * u, H * 0.58, floor, 80 * u);
      fill(g, frame, shade(E, [236, 232, 220], 0.6));
      fill(g, trimB, shade(E, [150, 110, 70]));
      fill(g, board, shade(E, green ? [40, 76, 56] : [36, 38, 42], 0.35));
      stroke(g, chalk, [236, 236, 230], 1.2 * u, 0.65);
      clock(g, E, bx + bw / 2, H * 0.08, 12 * u);
      fill(g, map, shade(E, [150, 190, 220], 0.55));
      fill(g, land, shade(E, [150, 190, 110], 0.55));
      const on = lampsOn(E, 0.2);
      for (let x = F % (180 * u); x < W; x += 180 * u) glowAt(g, x, 0, 90 * u, [244, 248, 255], 0.4 * on);
      fill(g, tdesk, shade(E, [140, 100, 64]));
      g.fillStyle = rgb(shade(E, [200, 40, 40], 0.6));
      g.beginPath();
      g.arc(F + 280 * u, H * 0.6 - 7 * u, 7 * u, 0, TAU);
      g.fill();
      fill(g, chairs, shade(E, [70, 90, 120], 0.45));
      fill(g, desks, shade(E, [170, 130, 84], 0.5));
    },
    floor,
  );
}

function lab(c: Ctx): Scene {
  const { W, H, u, F, r } = c;
  const floor = H * 0.86;
  const win = new Path2D();
  win.rect(F + 150 * u, H * 0.12, 120 * u, H * 0.26);
  const frame = new Path2D();
  panes(frame, F + 150 * u, H * 0.12, 120 * u, H * 0.26, 3, 1, 2 * u);
  const top = H * 0.64;
  const bench = new Path2D();
  bench.rect(0, top, W, 8 * u);
  const base = new Path2D();
  base.rect(0, top + 8 * u, W, floor - top);
  const doors = new Path2D();
  for (let x = F % (64 * u); x < W; x += 64 * u) doors.rect(x + 4 * u, top + 14 * u, 56 * u, floor - top - 16 * u);
  const hood = new Path2D();
  rr(hood, F - 330 * u, H * 0.1, 140 * u, top - H * 0.1, 4 * u);
  const hglass = new Path2D();
  hglass.rect(F - 320 * u, H * 0.22, 120 * u, top - H * 0.22 - 4 * u);
  const shelf = new Path2D();
  shelf.rect(F - 170 * u, H * 0.3, 300 * u, 4 * u);
  const bottles = Array.from({ length: 10 }, (_, k) => ({ x: F - 160 * u + k * 28 * u + r() * 6 * u, h: (16 + r() * 16) * u, c: pick(r, [[120, 70, 40], [60, 120, 160], [200, 200, 210], [60, 140, 80]] as RGB[]) }));
  const glass: { p: Path2D; liq: Path2D; c: RGB; x: number; y: number }[] = [];
  for (const [x, kind] of [
    [F - 150 * u, 0],
    [F - 110 * u, 1],
    [F - 80 * u, 0],
    [F + 120 * u, 1],
  ] as const) {
    const p = new Path2D();
    const liq = new Path2D();
    if (kind === 0) {
      poly(p, x - 4 * u, top - 34 * u, x + 4 * u, top - 34 * u, x + 4 * u, top - 22 * u, x + 16 * u, top, x - 16 * u, top, x - 4 * u, top - 22 * u);
      poly(liq, x - 10 * u, top - 10 * u, x + 10 * u, top - 10 * u, x + 16 * u, top, x - 16 * u, top);
    } else {
      p.rect(x - 10 * u, top - 26 * u, 20 * u, 26 * u);
      liq.rect(x - 10 * u, top - 14 * u, 20 * u, 14 * u);
    }
    glass.push({ p, liq, c: pick(r, [[90, 220, 140], [240, 90, 160], [90, 170, 255], [255, 200, 70]] as RGB[]), x, y: top - 10 * u });
  }
  const scope = new Path2D();
  scope.rect(F + 40 * u, top - 4 * u, 34 * u, 4 * u);
  scope.rect(F + 62 * u, top - 50 * u, 6 * u, 46 * u);
  poly(scope, F + 40 * u, top - 50 * u, F + 50 * u, top - 56 * u, F + 70 * u, top - 22 * u, F + 62 * u, top - 18 * u);
  const mon = new Path2D();
  rr(mon, F - 40 * u, top - 54 * u, 70 * u, 46 * u, 3 * u);
  mon.rect(F - 8 * u, top - 8 * u, 6 * u, 8 * u);
  const rack = new Path2D();
  rr(rack, F + 290 * u, H * 0.1, 70 * u, floor - H * 0.1, 3 * u);
  const leds = Array.from({ length: 30 }, () => ({ x: F + 298 * u + r() * 54 * u, y: H * (0.14 + r() * 0.66), p: r() * TAU, c: pick(r, [[90, 255, 140], [90, 200, 255], [255, 190, 70]] as RGB[]) }));
  return room(
    c,
    win,
    [214, 224, 230],
    viewOf(SCENES.city({ ...c, F: F + 210 * u, r: rand(seedOf("lab") + Math.floor(r() * 99)) })),
    (g, E) => {
      const T = time(E);
      fill(g, frame, shade(E, [180, 186, 196]));
      const on = lampsOn(E, 0.35);
      for (let x = F % (150 * u); x < W; x += 150 * u) glowAt(g, x, 0, 90 * u, [230, 244, 255], 0.5 * on);
      fill(g, hood, shade(E, [200, 204, 210], 0.5));
      fill(g, hglass, [150, 190, 210], 0.35);
      glowAt(g, F - 260 * u, H * 0.26, 70 * u, [220, 240, 255], 0.4 * on);
      fill(g, shelf, shade(E, [150, 156, 166]));
      for (const b of bottles) {
        g.fillStyle = rgb(shade(E, b.c, 0.5), 0.9);
        g.fillRect(b.x, H * 0.3 - b.h, 12 * u, b.h);
      }
      fill(g, base, shade(E, [180, 190, 200], 0.45));
      stroke(g, doors, shade(E, [140, 150, 160]), 0.8 * u);
      fill(g, bench, [40, 44, 50]);
      fill(g, mon, [20, 22, 26]);
      g.strokeStyle = rgb([90, 255, 160], 0.85);
      g.lineWidth = 1.4 * u;
      g.beginPath();
      for (let x = 0; x <= 62 * u; x += 3 * u) g.lineTo(F - 36 * u + x, top - 30 * u + Math.sin(x / (5 * u) + T * 2) * 8 * u * Math.sin(x / (30 * u)));
      g.stroke();
      fill(g, scope, [40, 44, 50]);
      for (const gl of glass) {
        fill(g, gl.liq, gl.c, 0.75);
        glowAt(g, gl.x, gl.y, 30 * u, gl.c, 0.25 * E.glow);
        fill(g, gl.p, [220, 240, 250], 0.25);
        stroke(g, gl.p, [230, 245, 255], 1 * u, 0.6);
      }
      for (let k = 0; k < 4; k++) {
        const kk = (T * 0.6 + k / 4) % 1;
        g.fillStyle = rgb([255, 255, 255], 0.6 * (1 - kk));
        g.beginPath();
        g.arc(glass[0]!.x + Math.sin(k * 3) * 4 * u, top - 4 * u - kk * 26 * u, 1.6 * u, 0, TAU);
        g.fill();
      }
      fill(g, rack, [26, 28, 34]);
      for (const l of leds) {
        g.fillStyle = rgb(l.c, E.still || Math.sin(T * 3 + l.p) > -0.3 ? 0.9 : 0.15);
        g.fillRect(l.x, l.y, 2.4 * u, 2.4 * u);
      }
    },
    floor,
  );
}

function laundromat(c: Ctx): Scene {
  const { W, H, u, F, r } = c;
  const floor = H * 0.88;
  const win = new Path2D();
  const mull = new Path2D();
  for (let x = F - 340 * u; x < F + 240 * u; x += 100 * u) {
    win.rect(x, H * 0.08, 94 * u, H * 0.32);
    mull.rect(x - 6 * u, H * 0.08, 6 * u, H * 0.32);
  }
  mull.rect(F + 254 * u - 6 * u, H * 0.08, 6 * u, H * 0.32);
  const units: { x: number; c: RGB; run: boolean; p: number }[] = [];
  for (let x = F - 340 * u; x < F + 250 * u; x += 66 * u) units.push({ x, c: pick(r, FABRIC), run: r() < 0.6, p: r() * TAU });
  const bodies = new Path2D();
  const tops = new Path2D();
  for (const m of units) {
    rr(bodies, m.x, H * 0.48, 62 * u, floor - H * 0.48, 4 * u);
    tops.rect(m.x + 4 * u, H * 0.49, 54 * u, 10 * u);
  }
  const bench = new Path2D();
  for (const x of [F - 260 * u, F - 180 * u, F + 140 * u]) {
    rr(bench, x, H * 0.84, 60 * u, 30 * u, 8 * u);
    bench.rect(x + 28 * u, H * 0.84 + 30 * u, 4 * u, 30 * u);
  }
  const basket = new Path2D();
  poly(basket, F + 20 * u, H * 0.92, F + 90 * u, H * 0.92, F + 84 * u, H, F + 26 * u, H);
  const vend = new Path2D();
  rr(vend, F + 270 * u, H * 0.2, 80 * u, floor - H * 0.2, 4 * u);
  const street = r() < 0.5 ? townView(c) : viewOf(SCENES.city({ ...c, r: rand(seedOf("laundromat") + Math.floor(r() * 99)) }));
  // The window is high on the wall: raise the street into it.
  const out: Paint = (g, E) => {
    g.save();
    g.translate(0, -H * 0.36);
    street(g, E);
    g.restore();
  };
  return room(
    c,
    win,
    pick(r, [[214, 226, 220], [236, 226, 196], [200, 214, 232]] as RGB[]),
    out,
    (g, E) => {
      const T = time(E);
      fill(g, mull, shade(E, [70, 80, 90]));
      const on = lampsOn(E, 0.4);
      for (let x = F % (140 * u); x < W; x += 140 * u) glowAt(g, x, H * 0.02, 90 * u, [230, 250, 255], 0.5 * on * (x > F && !E.still && Math.sin(T * 13) > 0.92 ? 0.4 : 1));
      fill(g, bodies, shade(E, [236, 238, 240], 0.55));
      fill(g, tops, shade(E, [200, 204, 210], 0.5));
      for (const m of units) {
        const cx = m.x + 31 * u;
        const cy = H * 0.68;
        g.fillStyle = rgb([150, 156, 162]);
        g.beginPath();
        g.arc(cx, cy, 22 * u, 0, TAU);
        g.fill();
        g.save();
        g.beginPath();
        g.arc(cx, cy, 18 * u, 0, TAU);
        g.clip();
        g.fillStyle = rgb([40, 50, 60]);
        g.fillRect(cx - 18 * u, cy - 18 * u, 36 * u, 36 * u);
        if (m.run) {
          const a = T * 3 + m.p;
          for (let k = 0; k < 3; k++) {
            g.fillStyle = rgb(k ? mix(m.c, [255, 255, 255], 0.3 * k) : m.c);
            g.beginPath();
            g.arc(cx + Math.cos(a + k * 2.1) * 8 * u, cy + Math.sin(a + k * 2.1) * 8 * u + 5 * u, 9 * u, 0, TAU);
            g.fill();
          }
          g.fillStyle = rgb([200, 220, 255], 0.25);
          g.fillRect(cx - 18 * u, cy + 6 * u + Math.sin(T * 5 + m.p) * 2 * u, 36 * u, 14 * u);
        }
        g.restore();
        g.fillStyle = rgb(m.run ? [90, 255, 140] : [255, 90, 70], 0.9);
        g.fillRect(m.x + 48 * u, H * 0.52, 4 * u, 3 * u);
      }
      fill(g, vend, shade(E, [200, 50, 50], 0.5));
      g.fillStyle = rgb([255, 250, 220], 0.4 + 0.4 * on);
      g.fillRect(F + 278 * u, H * 0.24, 50 * u, 80 * u);
      fill(g, bench, shade(E, [240, 150, 50], 0.5));
      fill(g, basket, shade(E, [90, 150, 210], 0.5));
    },
    floor,
  );
}

function gallery(c: Ctx): Scene {
  const { W, H, u, F, r } = c;
  const floor = H * 0.82;
  const win = new Path2D();
  const mull = new Path2D();
  for (let x = F - 360 * u; x < F + 320 * u; x += 44 * u) {
    win.rect(x, H * 0.03, 40 * u, H * 0.08);
    mull.rect(x - 4 * u, H * 0.03, 4 * u, H * 0.08);
  }
  const arts = [
    [F - 300 * u, H * 0.26, 110 * u, 80 * u],
    [F - 140 * u, H * 0.2, 150 * u, 110 * u],
    [F + 60 * u, H * 0.28, 70 * u, 90 * u],
    [F + 200 * u, H * 0.24, 120 * u, 86 * u],
  ].map(([x, y, w, h]) => ({ x: x!, y: y!, w: w!, h: h!, kind: (r() * 3) | 0, a: pick(r, FABRIC), b: pick(r, PLASTER), cc: pick(r, FABRIC) }));
  const frames = new Path2D();
  for (const a of arts) frames.rect(a.x - 5 * u, a.y - 5 * u, a.w + 10 * u, a.h + 10 * u);
  const bench = new Path2D();
  rr(bench, F - 120 * u, H * 0.8, 180 * u, 12 * u, 4 * u);
  for (const x of [F - 110 * u, F + 40 * u]) bench.rect(x, H * 0.8 + 12 * u, 10 * u, 22 * u);
  const plinth = new Path2D();
  plinth.rect(F + 250 * u, H * 0.62, 60 * u, floor - H * 0.62 + 10 * u);
  const sculpt = new Path2D();
  sculpt.moveTo(F + 280 * u, H * 0.62);
  sculpt.bezierCurveTo(F + 230 * u, H * 0.5, F + 320 * u, H * 0.44, F + 270 * u, H * 0.34);
  sculpt.bezierCurveTo(F + 300 * u, H * 0.42, F + 310 * u, H * 0.52, F + 290 * u, H * 0.62);
  sculpt.closePath();
  const viewer = new Path2D();
  figure(viewer, F - 200 * u, H * 0.96, 120 * u);
  const ropes = new Path2D();
  for (const x of [F - 330 * u, F - 170 * u, F - 10 * u]) {
    ropes.rect(x, H * 0.7, 3 * u, 24 * u);
    ropes.moveTo(x + 1.5 * u, H * 0.7);
    ropes.quadraticCurveTo(x + 80 * u, H * 0.74, x + 161.5 * u, H * 0.7);
  }
  const wall = pick(r, [[238, 234, 226], [226, 226, 230], [120, 40, 46], [44, 60, 70]] as RGB[]);
  return room(
    c,
    win,
    wall,
    none,
    (g, E) => {
      fill(g, mull, shade(E, [200, 200, 200]));
      const on = lampsOn(E, 0.4);
      for (const a of arts) {
        const cx = a.x + a.w / 2;
        const cg = g.createLinearGradient(0, H * 0.12, 0, a.y + a.h);
        cg.addColorStop(0, rgb([255, 240, 210], 0.22 * on));
        cg.addColorStop(1, rgb([255, 240, 210], 0));
        g.fillStyle = cg;
        g.beginPath();
        g.moveTo(cx - 6 * u, H * 0.13);
        g.lineTo(cx + 6 * u, H * 0.13);
        g.lineTo(cx + a.w * 0.7, a.y + a.h + 20 * u);
        g.lineTo(cx - a.w * 0.7, a.y + a.h + 20 * u);
        g.fill();
        g.fillStyle = rgb([30, 30, 34]);
        g.fillRect(cx - 4 * u, H * 0.12, 8 * u, 6 * u);
      }
      fill(g, frames, shade(E, [170, 130, 60], 0.6));
      for (const a of arts) {
        g.save();
        g.beginPath();
        g.rect(a.x, a.y, a.w, a.h);
        g.clip();
        g.fillStyle = rgb(shade(E, a.b, 0.6));
        g.fillRect(a.x, a.y, a.w, a.h);
        g.fillStyle = rgb(shade(E, a.a, 0.6));
        if (a.kind === 0) {
          g.beginPath();
          g.moveTo(a.x, a.y + a.h);
          g.quadraticCurveTo(a.x + a.w * 0.4, a.y + a.h * 0.4, a.x + a.w, a.y + a.h * 0.7);
          g.lineTo(a.x + a.w, a.y + a.h);
          g.fill();
          g.fillStyle = rgb(shade(E, [255, 230, 160], 0.6));
          g.beginPath();
          g.arc(a.x + a.w * 0.7, a.y + a.h * 0.3, a.h * 0.12, 0, TAU);
          g.fill();
        } else if (a.kind === 1) {
          g.fillRect(a.x + a.w * 0.1, a.y + a.h * 0.15, a.w * 0.45, a.h * 0.5);
          g.fillStyle = rgb(shade(E, a.cc, 0.6));
          g.fillRect(a.x + a.w * 0.5, a.y + a.h * 0.45, a.w * 0.4, a.h * 0.42);
        } else {
          g.beginPath();
          g.ellipse(a.x + a.w / 2, a.y + a.h * 0.45, a.w * 0.22, a.h * 0.26, 0, 0, TAU);
          g.fill();
          g.fillRect(a.x + a.w * 0.2, a.y + a.h * 0.75, a.w * 0.6, a.h * 0.3);
        }
        g.restore();
      }
      stroke(g, ropes, shade(E, [150, 30, 40]), 2.4 * u);
      fill(g, plinth, shade(E, [244, 244, 240], 0.6));
      fill(g, sculpt, shade(E, [190, 150, 90], 0.6));
      g.fillStyle = rgb([255, 255, 255], 0.06 + 0.05 * E.day);
      g.fillRect(0, floor + 6 * u, W, 10 * u);
      fill(g, bench, shade(E, [90, 64, 44]));
      fill(g, viewer, [24, 22, 28]);
    },
    floor,
  );
}

function theater(c: Ctx): Scene {
  const { W, H, u, F, r } = c;
  const floor = H * 0.7;
  const cinema = r() < 0.4;
  const sx0 = F - 250 * u;
  const sx1 = F + 210 * u;
  const st = H * 0.1;
  const sb = H * 0.62;
  const gilt = new Path2D();
  gilt.moveTo(sx0 - 14 * u, sb);
  gilt.lineTo(sx0 - 14 * u, st + 26 * u);
  gilt.quadraticCurveTo((sx0 + sx1) / 2, st - 46 * u, sx1 + 14 * u, st + 26 * u);
  gilt.lineTo(sx1 + 14 * u, sb);
  gilt.lineTo(sx1, sb);
  gilt.lineTo(sx1, st + 30 * u);
  gilt.quadraticCurveTo((sx0 + sx1) / 2, st - 30 * u, sx0, st + 30 * u);
  gilt.lineTo(sx0, sb);
  gilt.closePath();
  const curt = new Path2D();
  for (const s of [-1, 1]) {
    const x = s < 0 ? sx0 : sx1;
    curt.moveTo(x, st);
    curt.lineTo(x - s * 80 * u, st);
    curt.quadraticCurveTo(x - s * 50 * u, H * 0.4, x - s * 70 * u, sb);
    curt.lineTo(x, sb);
    curt.closePath();
  }
  const val = new Path2D();
  val.moveTo(sx0, st - 10 * u);
  val.lineTo(sx1, st - 10 * u);
  for (let k = 8; k >= 0; k--) val.quadraticCurveTo(sx0 + ((k + 0.5) * (sx1 - sx0)) / 9, st + 34 * u, sx0 + (k * (sx1 - sx0)) / 9, st + 14 * u);
  val.closePath();
  const folds = new Path2D();
  for (let x = sx0 - 80 * u; x < sx1 + 80 * u; x += 12 * u) {
    if (x > sx0 && x < sx1) continue;
    folds.moveTo(x, st);
    folds.lineTo(x + (x < sx0 ? 6 : -6) * u, sb);
  }
  const stage = new Path2D();
  poly(stage, sx0 - 30 * u, sb, sx1 + 30 * u, sb, sx1 + 60 * u, floor, sx0 - 60 * u, floor);
  const seats = new Path2D();
  const heads = new Path2D();
  for (const [y, s] of [
    [H * 0.8, 0.8],
    [H * 0.89, 0.9],
    [H * 0.98, 1],
  ] as const)
    for (let x = ((F + y) % (36 * u * s)) - 36 * u; x < W + 36 * u; x += 36 * u * s) {
      rr(seats, x, y - 24 * u * s, 32 * u * s, 60 * u * s, 10 * u * s);
      if (r() < 0.3) circle(heads, x + 16 * u * s, y - 34 * u * s, 9 * u * s);
    }
  const props = new Path2D();
  if (!cinema) {
    rr(props, F - 60 * u, sb - 60 * u, 50 * u, 60 * u, 4 * u);
    poly(props, F + 60 * u, sb, F + 80 * u, sb - 70 * u, F + 100 * u, sb);
  }
  const red = pick(r, [[150, 24, 36], [120, 20, 60], [40, 60, 120]] as RGB[]);
  return room(
    c,
    shut(),
    [60, 22, 30],
    none,
    (g, E) => {
      const T = time(E);
      g.fillStyle = rgb([10, 8, 12]);
      g.fillRect(sx0, st - 40 * u, sx1 - sx0, sb - st + 40 * u);
      if (cinema) {
        const k = E.still ? 0.5 : 0.5 + 0.5 * Math.sin(T * 0.7);
        const sc = mix(mix([120, 170, 230], [240, 180, 120], k), [255, 255, 255], 0.3 + 0.15 * Math.sin(T * 3.1));
        g.fillStyle = rgb(sc, 0.9);
        g.fillRect(sx0 + 20 * u, st + 30 * u, sx1 - sx0 - 40 * u, sb - st - 50 * u);
        glowAt(g, (sx0 + sx1) / 2, H * 0.4, 360 * u, sc, 0.25);
        g.save();
        g.globalCompositeOperation = "lighter";
        const bg = g.createLinearGradient(F, H, F, st);
        bg.addColorStop(0, rgb([220, 230, 255], 0.14));
        bg.addColorStop(1, rgb([220, 230, 255], 0.02));
        g.fillStyle = bg;
        g.beginPath();
        g.moveTo(F + 300 * u, -20 * u);
        g.lineTo(sx0 + 20 * u, st + 30 * u);
        g.lineTo(sx0 + 20 * u, sb - 20 * u);
        g.closePath();
        g.fill();
        g.restore();
      } else {
        g.save();
        g.globalCompositeOperation = "lighter";
        const sp = g.createLinearGradient(0, st, 0, sb);
        sp.addColorStop(0, rgb([255, 240, 200], 0.03));
        sp.addColorStop(1, rgb([255, 240, 200], 0.22));
        g.fillStyle = sp;
        g.beginPath();
        g.moveTo(F - 10 * u, st);
        g.lineTo(F + 30 * u, st);
        g.lineTo(F + 90 * u, sb);
        g.lineTo(F - 70 * u, sb);
        g.fill();
        g.restore();
        fill(g, props, [40, 32, 40]);
        glowAt(g, F + 10 * u, sb, 90 * u, [255, 230, 180], 0.4);
      }
      fill(g, curt, mix(red, DARK, 0.3));
      stroke(g, folds, mix(red, DARK, 0.6), 2 * u, 0.6);
      fill(g, val, mix(red, DARK, 0.2));
      fill(g, gilt, [170, 130, 60]);
      fill(g, stage, [70, 46, 36]);
      for (let x = sx0; x <= sx1; x += 30 * u) glowAt(g, x, sb + 2 * u, 26 * u, [255, 210, 140], 0.35);
      glowAt(g, F + 330 * u, H * 0.2, 24 * u, [80, 255, 120], 0.6);
      g.fillStyle = rgb([80, 255, 120], 0.9);
      g.fillRect(F + 318 * u, H * 0.19, 24 * u, 8 * u);
      fill(g, seats, mix(red, DARK, 0.55));
      fill(g, heads, [14, 10, 16]);
    },
    floor,
    { lift: 0.18, space: true },
  );
}

function club(c: Ctx): Scene {
  const { W, H, u, F, r } = c;
  const floor = H * 0.7;
  const HUES: RGB[] = [
    [255, 60, 180],
    [80, 200, 255],
    [180, 90, 255],
    [255, 200, 60],
    [60, 255, 170],
  ];
  const tiles: { p: Path2D; k: number }[] = [];
  for (let row = 0; row < 4; row++) {
    const y0 = floor + ((H - floor) * row) / 4;
    const y1 = floor + ((H - floor) * (row + 1)) / 4;
    const s0 = 0.5 + row * 0.25;
    const s1 = s0 + 0.25;
    for (let k = -10; k <= 10; k++) {
      const p = new Path2D();
      poly(p, F + k * 60 * u * s0, y0, F + (k + 1) * 60 * u * s0, y0, F + (k + 1) * 60 * u * s1, y1, F + k * 60 * u * s1, y1);
      tiles.push({ p, k: (k + row * 3 + 40) % 5 });
    }
  }
  const booth = new Path2D();
  rr(booth, F - 110 * u, H * 0.5, 180 * u, H * 0.2, 6 * u);
  const dj = new Path2D();
  figure(dj, F - 20 * u, H * 0.52, 90 * u);
  const crowd = Array.from({ length: c.mini ? 10 : 18 }, () => ({ x: r() * W, h: (90 + r() * 40) * u, p: r() * TAU }));
  const spots = Array.from({ length: 12 }, () => ({ x: r(), y: 0.1 + r() * 0.5, c: pick(r, HUES), p: r() }));
  const bx = F - 20 * u;
  const by = H * 0.1;
  return room(
    c,
    shut(),
    [34, 22, 54],
    none,
    (g, E) => {
      const T = time(E);
      for (const s of spots) glowAt(g, (((s.x + T * 0.03 * (s.p - 0.5)) % 1) + 1) % 1 * W, H * s.y, 18 * u, s.c, 0.5);
      const beat = Math.floor(T * 2.2);
      for (const t of tiles) fill(g, t.p, HUES[(t.k + beat) % 5]!, 0.45);
      g.save();
      g.globalCompositeOperation = "lighter";
      g.lineWidth = 1.4 * u;
      for (let k = 0; k < 8; k++) {
        const a = Math.PI / 2 + Math.sin(T * 0.8 + k * 0.8) * 0.9;
        g.strokeStyle = rgb(k % 2 ? [80, 255, 140] : [255, 80, 200], 0.4);
        g.beginPath();
        g.moveTo(bx, by);
        g.lineTo(bx + Math.cos(a) * H * 1.4, by + Math.sin(a) * H * 1.4);
        g.stroke();
      }
      g.restore();
      g.strokeStyle = rgb([60, 60, 70]);
      g.lineWidth = 1 * u;
      g.beginPath();
      g.moveTo(bx, 0);
      g.lineTo(bx, by);
      g.stroke();
      const ball = g.createRadialGradient(bx - 4 * u, by - 4 * u, 1, bx, by, 14 * u);
      ball.addColorStop(0, "rgb(250,250,255)");
      ball.addColorStop(1, "rgb(110,110,130)");
      g.fillStyle = ball;
      g.beginPath();
      g.arc(bx, by, 14 * u, 0, TAU);
      g.fill();
      glowAt(g, bx, by, 40 * u, [255, 255, 255], 0.2 + 0.1 * Math.sin(T * 6));
      fill(g, dj, [14, 10, 20]);
      fill(g, booth, [20, 16, 30]);
      g.fillStyle = rgb(HUES[beat % 5]!, 0.8);
      g.fillRect(F - 106 * u, H * 0.52, 172 * u, 3 * u);
      g.fillStyle = rgb([200, 200, 210], 0.3);
      for (let k = 0; k < 4; k++) g.fillRect(F - 96 * u + k * 42 * u, H * 0.5 - 3 * u, 30 * u, 3 * u);
      const hz = g.createLinearGradient(0, H * 0.3, 0, H * 0.8);
      hz.addColorStop(0, "rgba(160,120,220,0)");
      hz.addColorStop(1, "rgba(160,120,220,0.12)");
      g.fillStyle = hz;
      g.fillRect(0, H * 0.3, W, H * 0.5);
      for (const p of crowd) {
        const f = new Path2D();
        figure(f, p.x, H * 1.04 + Math.abs(Math.sin(T * 4.4 + p.p)) * -6 * u, p.h);
        fill(g, f, [10, 8, 16]);
      }
    },
    floor,
    { lift: 0.12, space: true },
  );
}

function casino(c: Ctx): Scene {
  const { W, H, u, F, r } = c;
  const floor = H * 0.72;
  const slots: { x: number; p: number; c: RGB }[] = [];
  for (let x = (F % (52 * u)) - 52 * u; x < W; x += 52 * u) slots.push({ x, p: r() * TAU, c: pick(r, [[255, 70, 90], [255, 200, 60], [80, 200, 255], [180, 90, 255]] as RGB[]) });
  const cabs = new Path2D();
  for (const s of slots) rr(cabs, s.x, H * 0.36, 46 * u, floor - H * 0.36 + 6 * u, 6 * u);
  const reels = new Path2D();
  for (const s of slots) for (let k = 0; k < 3; k++) reels.rect(s.x + 6 * u + k * 12 * u, H * 0.46, 10 * u, 16 * u);
  const pat = new Path2D();
  for (let y = floor + 10 * u; y < H; y += 18 * u)
    for (let x = ((y / u) % 2) * 9 * u; x < W; x += 36 * u) poly(pat, x, y - 5 * u, x + 6 * u, y, x, y + 5 * u, x - 6 * u, y);
  const tx = F - 30 * u;
  const ty = H * 0.92;
  const rim = new Path2D();
  ellipse(rim, tx, ty, 270 * u, 62 * u);
  const felt = new Path2D();
  ellipse(felt, tx, ty, 254 * u, 52 * u);
  const chips: { x: number; y: number; n: number; c: RGB }[] = Array.from({ length: 8 }, () => ({ x: tx + (r() - 0.5) * 360 * u, y: ty + (r() - 0.6) * 50 * u, n: 2 + ((r() * 6) | 0), c: pick(r, [[200, 40, 40], [40, 80, 200], [30, 30, 30], [240, 240, 240], [40, 160, 80]] as RGB[]) }));
  const cards = Array.from({ length: 5 }, (_, k) => ({ x: tx - 60 * u + k * 30 * u, y: ty - 10 * u, a: (r() - 0.5) * 0.3 }));
  const dealer = new Path2D();
  figure(dealer, tx, ty - 40 * u, 110 * u);
  const chand = [F - 200 * u, F + 140 * u];
  return room(
    c,
    shut(),
    [90, 24, 34],
    none,
    (g, E) => {
      const T = time(E);
      for (const x of chand) {
        glowAt(g, x, H * 0.12, 160 * u, [255, 220, 150], 0.45);
        g.fillStyle = rgb([255, 236, 190], 0.8);
        for (let k = 0; k < 9; k++) {
          const a = (k / 9) * TAU;
          g.fillRect(x + Math.cos(a) * 26 * u, H * 0.12 + Math.sin(a) * 6 * u, 2 * u, 6 * u + (k % 3) * 3 * u);
        }
      }
      fill(g, cabs, [30, 22, 40]);
      for (const s of slots) {
        const on = E.still || Math.sin(T * 5 + s.p) > 0;
        g.fillStyle = rgb(s.c, on ? 0.95 : 0.4);
        g.fillRect(s.x + 4 * u, H * 0.37, 38 * u, 6 * u);
        glowAt(g, s.x + 23 * u, H * 0.4, 30 * u, s.c, on ? 0.35 : 0.15);
      }
      fill(g, reels, [250, 246, 230]);
      fill(g, pat, [200, 160, 60], 0.18);
      fill(g, dealer, [18, 14, 18]);
      fill(g, rim, [80, 44, 26]);
      fill(g, felt, [30, 110, 60]);
      glowAt(g, tx, ty, 220 * u, [255, 240, 200], 0.2);
      for (const cd of cards) {
        g.save();
        g.translate(cd.x, cd.y);
        g.rotate(cd.a);
        g.fillStyle = "rgb(246,244,238)";
        g.fillRect(-7 * u, -10 * u, 14 * u, 20 * u);
        g.fillStyle = "rgb(190,30,40)";
        g.fillRect(-3 * u, -4 * u, 6 * u, 6 * u);
        g.restore();
      }
      for (const ch of chips)
        for (let k = 0; k < ch.n; k++) {
          g.fillStyle = rgb(mix(ch.c, DARK, k % 2 ? 0.15 : 0));
          g.beginPath();
          g.ellipse(ch.x, ch.y - k * 2.4 * u, 8 * u, 3 * u, 0, 0, TAU);
          g.fill();
        }
    },
    floor,
    { lift: 0.28, space: true },
  );
}

function arcade(c: Ctx): Scene {
  const { W, H, u, F, r } = c;
  const floor = H * 0.8;
  const cabs: { x: number; c: RGB; p: number; px: number[][] }[] = [];
  for (let x = (F % (70 * u)) - 70 * u; x < W; x += 70 * u) cabs.push({ x, c: pick(r, [[255, 60, 160], [60, 200, 255], [255, 210, 60], [140, 90, 255], [60, 255, 140]] as RGB[]), p: r() * TAU, px: Array.from({ length: 6 }, () => [r(), r(), r()]) });
  const bodies = new Path2D();
  const ledges = new Path2D();
  for (const k of cabs) {
    bodies.moveTo(k.x, floor + 6 * u);
    bodies.lineTo(k.x, H * 0.3);
    bodies.lineTo(k.x + 62 * u, H * 0.3);
    bodies.lineTo(k.x + 62 * u, H * 0.5);
    bodies.lineTo(k.x + 56 * u, H * 0.56);
    bodies.lineTo(k.x + 62 * u, H * 0.6);
    bodies.lineTo(k.x + 62 * u, floor + 6 * u);
    bodies.closePath();
    ledges.rect(k.x - 4 * u, H * 0.56, 70 * u, 8 * u);
  }
  const confetti = Array.from({ length: c.mini ? 30 : 70 }, () => ({ x: r() * W, y: floor + r() * (H - floor), c: pick(r, [[255, 60, 160], [60, 200, 255], [255, 210, 60]] as RGB[]), a: r() * TAU }));
  const sign = new Path2D();
  const sx = F - 20 * u;
  for (let k = 0; k <= 10; k++) {
    const a = -Math.PI / 2 + (k / 10) * TAU;
    const rad = k % 2 ? 12 * u : 28 * u;
    if (k) sign.lineTo(sx + Math.cos(a) * rad, H * 0.13 + Math.sin(a) * rad);
    else sign.moveTo(sx + Math.cos(a) * rad, H * 0.13 + Math.sin(a) * rad);
  }
  return room(
    c,
    shut(),
    [28, 20, 46],
    none,
    (g, E) => {
      const T = time(E);
      g.save();
      g.globalCompositeOperation = "lighter";
      stroke(g, sign, [255, 80, 200], 3 * u, 0.9);
      g.restore();
      glowAt(g, sx, H * 0.13, 70 * u, [255, 80, 200], 0.45);
      for (const p of confetti) {
        g.fillStyle = rgb(p.c, 0.35);
        g.save();
        g.translate(p.x, p.y);
        g.rotate(p.a);
        g.fillRect(-3 * u, -1 * u, 6 * u, 2 * u);
        g.restore();
      }
      fill(g, bodies, [42, 34, 60]);
      for (const k of cabs) {
        g.fillStyle = rgb(k.c, 0.9);
        g.fillRect(k.x + 4 * u, H * 0.31, 54 * u, 12 * u);
        glowAt(g, k.x + 31 * u, H * 0.32, 44 * u, k.c, 0.3);
        g.fillStyle = "rgb(8,10,20)";
        g.fillRect(k.x + 8 * u, H * 0.36, 46 * u, H * 0.17);
        for (const [a, b, d] of k.px) {
          g.fillStyle = rgb(d! < 0.5 ? k.c : [255, 255, 255], 0.9);
          const xx = k.x + 10 * u + ((((a! + T * 0.2 * (d! - 0.5)) % 1) + 1) % 1) * 40 * u;
          g.fillRect(xx, H * 0.37 + b! * H * 0.14, 4 * u, 4 * u);
        }
        glowAt(g, k.x + 31 * u, H * 0.44, 40 * u, k.c, 0.2);
      }
      fill(g, ledges, [40, 34, 56]);
      for (const k of cabs) {
        g.fillStyle = "rgb(20,20,24)";
        g.fillRect(k.x + 18 * u, H * 0.535, 3 * u, 10 * u);
        g.fillStyle = rgb([255, 60, 60]);
        g.beginPath();
        g.arc(k.x + 19.5 * u, H * 0.535, 4 * u, 0, TAU);
        g.fill();
        for (let b = 0; b < 3; b++) {
          g.fillStyle = rgb(pick(rand(b + 3), [[255, 220, 60], [60, 200, 255], [60, 255, 140]] as RGB[]));
          g.beginPath();
          g.arc(k.x + 34 * u + b * 8 * u, H * 0.57, 2.6 * u, 0, TAU);
          g.fill();
        }
      }
    },
    floor,
    { lift: 0.12, space: true },
  );
}

function studio(c: Ctx): Scene {
  const { W, H, u, F, r } = c;
  const floor = H * 0.86;
  const foam = new Path2D();
  for (let y = H * 0.06; y < H * 0.62; y += 30 * u)
    for (let x = (F % (30 * u)) - 30 * u; x < W; x += 30 * u) {
      const horiz = ((x / (30 * u)) | 0) % 2 === ((y / (30 * u)) | 0) % 2;
      for (let k = 1; k < 4; k++) {
        if (horiz) {
          foam.moveTo(x + 2 * u, y + k * 7.5 * u);
          foam.lineTo(x + 28 * u, y + k * 7.5 * u);
        } else {
          foam.moveTo(x + k * 7.5 * u, y + 2 * u);
          foam.lineTo(x + k * 7.5 * u, y + 28 * u);
        }
      }
    }
  const desk = new Path2D();
  poly(desk, F - 340 * u, H * 0.72, F + 260 * u, H * 0.72, F + 300 * u, H, F - 380 * u, H);
  const faders = Array.from({ length: 22 }, (_, k) => ({ x: F - 320 * u + k * 25 * u, v: r(), p: r() * TAU }));
  const spk = new Path2D();
  const cones = new Path2D();
  for (const x of [F - 280 * u, F + 180 * u]) {
    rr(spk, x, H * 0.48, 50 * u, 70 * u, 4 * u);
    spk.rect(x + 22 * u, H * 0.48 + 70 * u, 6 * u, H * 0.72 - H * 0.48 - 70 * u);
    circle(cones, x + 25 * u, H * 0.48 + 46 * u, 15 * u);
    circle(cones, x + 25 * u, H * 0.48 + 16 * u, 7 * u);
  }
  const mic = new Path2D();
  mic.moveTo(F + 80 * u, floor);
  mic.lineTo(F + 80 * u, H * 0.42);
  mic.lineTo(F + 20 * u, H * 0.3);
  const capsule = new Path2D();
  rr(capsule, F + 10 * u, H * 0.3, 20 * u, 40 * u, 10 * u);
  const pop = new Path2D();
  pop.moveTo(F - 4 * u + 22 * u, H * 0.37);
  pop.arc(F - 4 * u, H * 0.37, 22 * u, 0, TAU);
  const screen = new Path2D();
  rr(screen, F - 90 * u, H * 0.54, 120 * u, 66 * u, 4 * u);
  const leds: RGB = pick(r, [[150, 90, 255], [60, 140, 255], [255, 80, 120]] as RGB[]);
  return room(
    c,
    shut(),
    [56, 50, 66],
    none,
    (g, E) => {
      const T = time(E);
      stroke(g, foam, [20, 18, 26], 1.6 * u, 0.6);
      for (let x = 0; x < W; x += 90 * u) glowAt(g, x, 0, 70 * u, leds, 0.35);
      for (let x = 0; x < W; x += 90 * u) glowAt(g, x, floor, 60 * u, leds, 0.2);
      const live = E.still || Math.sin(T * 0.4) > -0.6;
      g.fillStyle = rgb([40, 10, 10]);
      g.fillRect(F + 130 * u, H * 0.08, 70 * u, 22 * u);
      g.fillStyle = rgb([255, 50, 40], live ? 0.95 : 0.3);
      g.fillRect(F + 134 * u, H * 0.08 + 4 * u, 62 * u, 14 * u);
      if (live) glowAt(g, F + 165 * u, H * 0.1, 70 * u, [255, 40, 30], 0.45);
      g.fillStyle = "rgb(60,10,10)";
      for (let k = 0; k < 5; k++) g.fillRect(F + 142 * u + k * 10 * u, H * 0.08 + 8 * u, 6 * u, 6 * u);
      stroke(g, mic, [24, 22, 28], 3 * u);
      fill(g, capsule, [70, 70, 80]);
      stroke(g, pop, [30, 30, 36], 2 * u);
      fill(g, pop, [40, 40, 50], 0.4);
      fill(g, spk, [26, 24, 30]);
      fill(g, cones, [60, 58, 66]);
      fill(g, screen, [16, 18, 24]);
      g.strokeStyle = rgb([120, 220, 255], 0.85);
      g.lineWidth = 1 * u;
      g.beginPath();
      for (let x = 0; x <= 110 * u; x += 2 * u) g.lineTo(F - 85 * u + x, H * 0.54 + 33 * u + Math.sin(x * 0.9 + T * 6) * Math.sin(x / (18 * u) + T) * 18 * u);
      g.stroke();
      fill(g, desk, [34, 32, 40]);
      for (const f of faders) {
        const y0 = H * 0.78;
        g.fillStyle = "rgb(16,16,20)";
        g.fillRect(f.x + 8 * u, y0, 2 * u, 34 * u);
        g.fillStyle = "rgb(200,200,210)";
        g.fillRect(f.x + 4 * u, y0 + f.v * 26 * u, 10 * u, 6 * u);
        const lv = E.still ? f.v : 0.5 + 0.5 * Math.sin(T * 7 + f.p) * Math.sin(T * 2.3 + f.p * 2);
        for (let k = 0; k < 6; k++) {
          const lit_ = k / 6 < lv;
          g.fillStyle = rgb(k > 4 ? [255, 60, 60] : k > 3 ? [255, 210, 60] : [80, 255, 120], lit_ ? 0.9 : 0.12);
          g.fillRect(f.x + 15 * u, y0 + 30 * u - k * 6 * u, 4 * u, 4 * u);
        }
      }
    },
    floor,
    { lift: 0.22, space: true },
  );
}

function shrine(c: Ctx): Scene {
  const { W, H, u, F, r } = c;
  const floor = H * 0.8;
  const ox0 = F - 140 * u;
  const ox1 = F + 40 * u;
  const win = new Path2D();
  win.rect(ox0, H * 0.1, ox1 - ox0, floor - H * 0.1);
  const paper = new Path2D();
  const lattice = new Path2D();
  const px0 = F - 380 * u;
  const px1 = F + 200 * u;
  for (const [a, b] of [
    [px0, ox0],
    [ox1, px1],
  ] as const) {
    paper.rect(a, H * 0.1, b - a, floor - H * 0.1);
    for (let x = a; x <= b; x += 30 * u) lattice.rect(x - 1.2 * u, H * 0.1, 2.4 * u, floor - H * 0.1);
    for (let y = H * 0.1; y <= floor; y += 26 * u) lattice.rect(a, y - 1.2 * u, b - a, 2.4 * u);
    for (let x = a; x <= b + 1; x += 90 * u) lattice.rect(x - 3 * u, H * 0.1, 6 * u, floor - H * 0.1);
  }
  const beam = new Path2D();
  beam.rect(0, H * 0.07, W, 8 * u);
  beam.rect(0, floor, W, 5 * u);
  const toko = new Path2D();
  toko.rect(px1 + 20 * u, H * 0.1, 140 * u, floor - H * 0.1);
  const scroll = new Path2D();
  scroll.rect(px1 + 70 * u, H * 0.16, 40 * u, 110 * u);
  const ink = new Path2D();
  ink.moveTo(px1 + 90 * u, H * 0.2);
  ink.quadraticCurveTo(px1 + 80 * u, H * 0.3, px1 + 94 * u, H * 0.4);
  ink.moveTo(px1 + 84 * u, H * 0.26);
  ink.lineTo(px1 + 98 * u, H * 0.28);
  const vase = new Path2D();
  rr(vase, px1 + 80 * u, floor - 30 * u, 20 * u, 30 * u, 8 * u);
  const branch = new Path2D();
  branch.moveTo(px1 + 90 * u, floor - 30 * u);
  branch.quadraticCurveTo(px1 + 110 * u, floor - 80 * u, px1 + 140 * u, floor - 90 * u);
  const blossoms = new Path2D();
  for (let k = 0; k < 6; k++) circle(blossoms, px1 + 100 * u + k * 7 * u, floor - 60 * u - k * 5 * u, 3.5 * u);
  const mats = new Path2D();
  for (let row = 0; row < 3; row++) {
    const y0 = floor + 5 * u + ((H - floor) * row) / 3;
    const off = row % 2 ? 90 * u : 0;
    for (let x = (F % (180 * u)) - 180 * u + off; x < W; x += 180 * u) mats.rect(x, y0, 180 * u, (H - floor) / 3);
  }
  const table = new Path2D();
  rr(table, F + 60 * u, H * 0.84, 140 * u, 10 * u, 3 * u);
  table.rect(F + 70 * u, H * 0.84 + 10 * u, 8 * u, 20 * u);
  table.rect(F + 182 * u, H * 0.84 + 10 * u, 8 * u, 20 * u);
  const tea = new Path2D();
  ellipse(tea, F + 110 * u, H * 0.84 - 10 * u, 14 * u, 11 * u);
  tea.rect(F + 104 * u, H * 0.84 - 24 * u, 12 * u, 4 * u);
  poly(tea, F + 122 * u, H * 0.84 - 12 * u, F + 134 * u, H * 0.84 - 20 * u, F + 134 * u, H * 0.84 - 16 * u, F + 124 * u, H * 0.84 - 6 * u);
  for (const x of [F + 150 * u, F + 172 * u]) rr(tea, x, H * 0.84 - 10 * u, 12 * u, 10 * u, 3 * u);
  const andon = new Path2D();
  andon.rect(F - 230 * u, H * 0.66, 34 * u, 56 * u);
  const garden = (() => {
    const moss = ridge(c, H * 0.62, 6 * u);
    const maple = new Path2D();
    leafy(maple, F - 60 * u, H * 0.64, 140 * u);
    const stones = new Path2D();
    for (const [x, rx] of [
      [F - 110 * u, 22 * u],
      [F - 20 * u, 14 * u],
      [F + 10 * u, 9 * u],
    ] as const)
      ellipse(stones, x, H * 0.72, rx, rx * 0.55);
    const rakes = new Path2D();
    for (let y = H * 0.66; y < floor; y += 5 * u) {
      rakes.moveTo(0, y);
      rakes.lineTo(W, y);
    }
    const hue = pick(r, [[200, 60, 40], [220, 120, 40], [80, 140, 70]] as RGB[]);
    return (g: G, E: Env) => {
      fill(g, moss.p, tone(E, 0.5, [80, 120, 60], 0.5));
      g.fillStyle = rgb(lit(E, 0.6, [220, 214, 196], 0.6));
      g.fillRect(0, H * 0.65, W, H * 0.35);
      stroke(g, rakes, tone(E, 0.7, [180, 170, 150], 0.4), 0.8 * u, 0.6);
      fill(g, maple, tone(E, 0.6, hue, 0.7));
      fill(g, stones, tone(E, 0.75, STONE, 0.4));
    };
  })();
  return room(
    c,
    win,
    [200, 176, 136],
    garden,
    (g, E) => {
      const on = lampsOn(E, 0.15);
      fill(g, paper, mix(mix([60, 56, 60], [246, 240, 224], clamp(E.day * 0.9 + 0.05)), [255, 210, 150], on * 0.45));
      fill(g, lattice, shade(E, [90, 60, 40]));
      fill(g, beam, shade(E, [80, 54, 36]));
      fill(g, toko, shade(E, [170, 150, 116], 0.4));
      fill(g, scroll, shade(E, [236, 228, 206], 0.55));
      stroke(g, ink, [30, 26, 24], 2.2 * u);
      fill(g, vase, shade(E, [60, 90, 110]));
      stroke(g, branch, shade(E, [70, 50, 36]), 1.6 * u);
      fill(g, blossoms, shade(E, [240, 170, 190], 0.6));
      fill(g, mats, shade(E, [196, 190, 130], 0.5));
      stroke(g, mats, shade(E, [70, 80, 50]), 2 * u, 0.7);
      fill(g, table, shade(E, [70, 40, 30]));
      fill(g, tea, shade(E, [90, 110, 90], 0.55));
      steam(g, E, F + 110 * u, H * 0.84 - 26 * u, u * 0.6, 4, 6, 0.1);
      fill(g, andon, mix([200, 190, 170], [255, 220, 160], on));
      glowAt(g, F - 213 * u, H * 0.7, 140 * u, WARM, 0.45 * on);
    },
    floor,
  );
}

function aquarium(c: Ctx): Scene {
  const { W, H, u, F, r } = c;
  const floor = H * 0.84;
  const x0 = F - 320 * u;
  const x1 = F + 260 * u;
  const win = new Path2D();
  win.moveTo(x0, H * 0.82);
  win.lineTo(x0, H * 0.24);
  win.quadraticCurveTo((x0 + x1) / 2, -H * 0.12, x1, H * 0.24);
  win.lineTo(x1, H * 0.82);
  win.closePath();
  const frame = new Path2D();
  frame.moveTo(x0 - 10 * u, H * 0.84);
  frame.lineTo(x0 - 10 * u, H * 0.23);
  frame.quadraticCurveTo((x0 + x1) / 2, -H * 0.16, x1 + 10 * u, H * 0.23);
  frame.lineTo(x1 + 10 * u, H * 0.84);
  frame.closePath();
  frame.addPath(win);
  const people = new Path2D();
  figure(people, F - 160 * u, H * 1.02, 150 * u);
  figure(people, F - 120 * u, H * 1.04, 110 * u);
  figure(people, F + 150 * u, H * 1.03, 160 * u);
  const bench = new Path2D();
  rr(bench, F - 40 * u, H * 0.9, 130 * u, 14 * u, 4 * u);
  const out = underwater({ ...c, r: rand(seedOf("aquarium") + Math.floor(r() * 99)) }, 0.55);
  return room(
    c,
    win,
    [24, 40, 76],
    out,
    (g, E) => {
      const T = time(E);
      g.fillStyle = "rgb(14,20,34)";
      g.fill(frame, "evenodd");
      glowAt(g, F - 30 * u, H * 0.5, 420 * u, [60, 180, 220], 0.22);
      g.save();
      g.beginPath();
      g.rect(0, floor, W, H - floor);
      g.clip();
      g.globalCompositeOperation = "lighter";
      for (let k = 0; k < 18; k++) {
        const x = ((k * 97) % 100) / 100 * W + Math.sin(T * 0.7 + k) * 20 * u;
        const y = floor + ((k * 37) % 100) / 100 * (H - floor);
        g.fillStyle = rgb([100, 220, 255], 0.08 + 0.05 * Math.sin(T * 1.3 + k));
        g.beginPath();
        g.ellipse(x, y, 30 * u, 4 * u, 0, 0, TAU);
        g.fill();
      }
      g.restore();
      fill(g, bench, [16, 22, 36]);
      fill(g, people, [8, 12, 22]);
    },
    floor,
    { lift: 0.14, space: true },
  );
}

function observatory(c: Ctx): Scene {
  const { W, H, u, F, r } = c;
  const floor = H * 0.86;
  const sx = F - 60 * u;
  const win = new Path2D();
  win.rect(sx - 48 * u, -10 * u, 96 * u, H * 0.6);
  const shutters = new Path2D();
  shutters.rect(sx - 60 * u, -10 * u, 12 * u, H * 0.62);
  shutters.rect(sx + 48 * u, -10 * u, 12 * u, H * 0.62);
  shutters.rect(sx - 60 * u, H * 0.6, 120 * u, 10 * u);
  const ribs = new Path2D();
  for (let k = 1; k <= 5; k++) {
    for (const s of [-1, 1]) {
      ribs.moveTo(sx + s * 60 * u, 0);
      ribs.quadraticCurveTo(sx + s * (60 + k * 70) * u, H * 0.1, sx + s * (60 + k * 90) * u, floor);
    }
  }
  ribs.moveTo(0, H * 0.62);
  ribs.lineTo(W, H * 0.62);
  const px = F + 40 * u;
  const py = H * 0.62;
  const pier = new Path2D();
  pier.rect(px - 14 * u, py, 28 * u, floor - py + 6 * u);
  pier.rect(px - 34 * u, floor - 6 * u, 68 * u, 12 * u);
  const tube = new Path2D();
  rr(tube, -16 * u, -200 * u, 32 * u, 240 * u, 8 * u);
  rr(tube, -20 * u, -206 * u, 40 * u, 14 * u, 4 * u);
  rr(tube, 18 * u, -120 * u, 10 * u, 60 * u, 4 * u);
  const desk = new Path2D();
  desk.rect(F + 160 * u, H * 0.7, 140 * u, 6 * u);
  desk.rect(F + 170 * u, H * 0.7, 6 * u, floor - H * 0.7);
  desk.rect(F + 284 * u, H * 0.7, 6 * u, floor - H * 0.7);
  const laptop = new Path2D();
  poly(laptop, F + 200 * u, H * 0.7, F + 250 * u, H * 0.7, F + 246 * u, H * 0.62, F + 204 * u, H * 0.62);
  const chart = new Path2D();
  chart.rect(F + 180 * u, H * 0.2, 100 * u, 70 * u);
  const dots = Array.from({ length: 16 }, () => [F + 186 * u + r() * 88 * u, H * 0.2 + 6 * u + r() * 58 * u] as const);
  const steps = new Path2D();
  for (let k = 0; k < 4; k++) steps.rect(F - 260 * u + k * 12 * u, floor - (k + 1) * 26 * u, 40 * u, 5 * u);
  steps.moveTo(F - 260 * u, floor);
  steps.lineTo(F - 212 * u, floor - 104 * u);
  return room(
    c,
    win,
    [70, 76, 96],
    none,
    (g, E) => {
      stroke(g, ribs, [30, 32, 44], 2 * u, 0.6);
      fill(g, shutters, [40, 44, 58]);
      fill(g, chart, [20, 26, 50]);
      for (const [x, y] of dots) {
        g.fillStyle = "rgba(230,240,255,0.85)";
        g.fillRect(x, y, 1.6 * u, 1.6 * u);
      }
      g.save();
      g.translate(px, py);
      g.rotate(-0.5);
      fill(g, tube, shade(E, [210, 214, 222], 0.5));
      g.restore();
      fill(g, pier, [50, 54, 66]);
      glowAt(g, F + 225 * u, H * 0.66, 120 * u, [255, 50, 40], 0.25 + 0.15 * E.night);
      fill(g, desk, [40, 34, 34]);
      fill(g, laptop, [20, 20, 26]);
      g.fillStyle = "rgba(255,80,60,0.6)";
      g.fillRect(F + 208 * u, H * 0.63, 34 * u, H * 0.06);
      stroke(g, steps, [60, 60, 70], 2 * u);
      fill(g, steps, [60, 60, 70]);
    },
    floor,
    { lift: 0.18 },
  );
}

// ---------- Old halls and keeps ----------

function stable(c: Ctx): Scene {
  const { W, H, u, F, r } = c;
  const floor = H * 0.84;
  const dx0 = F - 340 * u;
  const dx1 = F - 210 * u;
  const win = new Path2D();
  win.rect(dx0, H * 0.14, dx1 - dx0, floor - H * 0.14);
  const planks = new Path2D();
  for (let x = (F % (20 * u)) - 20 * u; x < W; x += 20 * u) {
    planks.moveTo(x, 0);
    planks.lineTo(x, floor);
  }
  const door = new Path2D();
  door.rect(dx0 - 130 * u, H * 0.14, 120 * u, floor - H * 0.14);
  const brace = new Path2D();
  brace.moveTo(dx0 - 128 * u, H * 0.16);
  brace.lineTo(dx0 - 12 * u, floor - 2 * u);
  brace.moveTo(dx0 - 12 * u, H * 0.16);
  brace.lineTo(dx0 - 128 * u, floor - 2 * u);
  const jamb = new Path2D();
  jamb.rect(dx0 - 8 * u, H * 0.12, 8 * u, floor - H * 0.12);
  jamb.rect(dx1, H * 0.12, 8 * u, floor - H * 0.12);
  jamb.rect(dx0 - 8 * u, H * 0.12, dx1 - dx0 + 16 * u, 8 * u);
  const stalls = new Path2D();
  const gates = new Path2D();
  for (const x of [F - 140 * u, F + 40 * u]) {
    stalls.rect(x, H * 0.52, 170 * u, floor - H * 0.52);
    stalls.rect(x - 6 * u, H * 0.2, 8 * u, floor - H * 0.2);
    gates.moveTo(x + 4 * u, H * 0.52);
    gates.lineTo(x + 166 * u, floor);
    gates.moveTo(x + 166 * u, H * 0.52);
    gates.lineTo(x + 4 * u, floor);
  }
  stalls.rect(F + 210 * u, H * 0.2, 8 * u, floor - H * 0.2);
  const hx = F - 50 * u;
  const horse = new Path2D();
  horse.moveTo(hx - 30 * u, H * 0.56);
  horse.quadraticCurveTo(hx - 34 * u, H * 0.36, hx - 4 * u, H * 0.3);
  horse.lineTo(hx + 2 * u, H * 0.24);
  horse.lineTo(hx + 8 * u, H * 0.3);
  horse.quadraticCurveTo(hx + 30 * u, H * 0.32, hx + 50 * u, H * 0.42);
  horse.quadraticCurveTo(hx + 58 * u, H * 0.47, hx + 48 * u, H * 0.5);
  horse.quadraticCurveTo(hx + 30 * u, H * 0.48, hx + 14 * u, H * 0.44);
  horse.quadraticCurveTo(hx + 10 * u, H * 0.5, hx + 16 * u, H * 0.56);
  horse.closePath();
  const coat = pick(r, [[110, 70, 44], [40, 30, 28], [190, 180, 170], [150, 100, 60]] as RGB[]);
  const bales = new Path2D();
  const straps = new Path2D();
  for (const [x, y] of [
    [F + 230 * u, floor - 40 * u],
    [F + 300 * u, floor - 40 * u],
    [F + 262 * u, floor - 80 * u],
  ] as const) {
    rr(bales, x, y, 66 * u, 42 * u, 4 * u);
    straps.rect(x + 18 * u, y, 3 * u, 42 * u);
    straps.rect(x + 46 * u, y, 3 * u, 42 * u);
  }
  const straw = new Path2D();
  for (let k = 0; k < (c.mini ? 60 : 140); k++) {
    const x = r() * W;
    const y = floor + r() * (H - floor);
    const a = (r() - 0.5) * 1.2;
    straw.moveTo(x, y);
    straw.lineTo(x + Math.cos(a) * 9 * u, y + Math.sin(a) * 3 * u);
  }
  const fork = new Path2D();
  fork.moveTo(F + 220 * u, floor);
  fork.lineTo(F + 196 * u, H * 0.34);
  for (const d of [-5, 0, 5]) {
    fork.moveTo(F + 196 * u + d * u, H * 0.34);
    fork.lineTo(F + 194 * u + d * 1.4 * u, H * 0.26);
  }
  const dust = motes(c, 20, dx0, dx1 + 150 * u, H * 0.2, floor);
  const out = SCENES.meadow({ ...c, F: (dx0 + dx1) / 2, r: rand(seedOf("stable") + Math.floor(r() * 99)) });
  return room(
    c,
    win,
    [140, 98, 62],
    viewOf(out),
    (g, E) => {
      stroke(g, planks, shade(E, [80, 54, 34]), 1.4 * u, 0.7);
      spill(g, E, dx0, dx1, floor, floor, 120 * u);
      fill(g, door, shade(E, [150, 50, 40], 0.45));
      stroke(g, brace, shade(E, [220, 210, 190], 0.4), 5 * u);
      fill(g, jamb, shade(E, [90, 60, 40]));
      fill(g, horse, shade(E, coat, 0.5));
      g.fillStyle = rgb([10, 8, 8]);
      g.beginPath();
      g.arc(hx + 18 * u, H * 0.36, 2.2 * u, 0, TAU);
      g.fill();
      fill(g, stalls, shade(E, [120, 82, 52], 0.5));
      stroke(g, gates, shade(E, [80, 54, 34]), 4 * u);
      stroke(g, fork, shade(E, [110, 90, 70]), 2 * u);
      fill(g, bales, shade(E, [214, 180, 96], 0.55));
      fill(g, straps, shade(E, [150, 110, 60]));
      stroke(g, straw, shade(E, [214, 184, 100], 0.55), 1 * u, 0.8);
      const a = E.day * (1 - E.c.cloud * 0.5);
      const T = time(E);
      for (const m of dust) {
        g.fillStyle = rgb([255, 236, 190], 0.5 * a * (0.5 + 0.5 * Math.sin(T + m.p)));
        g.fillRect(m.x + Math.sin(T * 0.2 + m.p) * 10 * u, m.y, 1.3 * u, 1.3 * u);
      }
      g.fillStyle = rgb([30, 24, 20]);
      g.fillRect(F + 205 * u, H * 0.26, 18 * u, 22 * u);
      lamp(g, E, F + 214 * u, H * 0.28, 120 * u, 6, WARM, 0.25);
    },
    floor,
  );
}

function alchemy(c: Ctx): Scene {
  const { W, H, u, F, r } = c;
  const floor = H * 0.86;
  const wx = F - 240 * u;
  const ww = 60 * u;
  const win = new Path2D();
  win.moveTo(wx, H * 0.56);
  win.lineTo(wx, H * 0.24);
  win.quadraticCurveTo(wx, H * 0.1, wx + ww / 2, H * 0.06);
  win.quadraticCurveTo(wx + ww, H * 0.1, wx + ww, H * 0.24);
  win.lineTo(wx + ww, H * 0.56);
  win.closePath();
  const frame = new Path2D();
  frame.rect(wx + ww / 2 - 1.5 * u, H * 0.06, 3 * u, H * 0.5);
  frame.rect(wx - 8 * u, H * 0.56, ww + 16 * u, 6 * u);
  const blocks = new Path2D();
  for (let y = 0, row = 0; y < floor; y += 22 * u, row++)
    for (let x = (row % 2 ? -18 : 0) * u; x < W; x += (32 + ((row * 7 + x / u) % 9)) * u) rr(blocks, x + 1.5 * u, y + 1.5 * u, 30 * u, 19 * u, 4 * u);
  const shelves = new Path2D();
  const jars: { x: number; y: number; h: number; c: RGB }[] = [];
  for (let k = 0; k < 3; k++) {
    const y = H * (0.24 + k * 0.16);
    shelves.rect(F + 130 * u, y, 170 * u, 5 * u);
    for (let x = F + 136 * u; x < F + 290 * u; x += (16 + r() * 10) * u) jars.push({ x, y, h: (14 + r() * 16) * u, c: pick(r, [[120, 255, 160], [255, 120, 220], [120, 180, 255], [255, 200, 90], [200, 120, 255]] as RGB[]) });
  }
  const cx = F - 60 * u;
  const cy = H * 0.72;
  const pot = new Path2D();
  pot.moveTo(cx + 46 * u, cy);
  pot.arc(cx, cy, 46 * u, 0, Math.PI);
  pot.closePath();
  rr(pot, cx - 52 * u, cy - 8 * u, 104 * u, 10 * u, 4 * u);
  for (const s of [-1, 1]) pot.rect(cx + s * 30 * u - 3 * u, cy + 36 * u, 6 * u, 26 * u);
  const brew = pick(r, [[110, 255, 120], [180, 110, 255], [255, 120, 80]] as RGB[]);
  const table = new Path2D();
  table.rect(F + 40 * u, H * 0.66, 130 * u, 6 * u);
  table.rect(F + 50 * u, H * 0.66, 6 * u, floor - H * 0.66);
  table.rect(F + 154 * u, H * 0.66, 6 * u, floor - H * 0.66);
  const books = new Path2D();
  for (let k = 0; k < 4; k++) rr(books, F + 50 * u + k * 2 * u, H * 0.66 - (k + 1) * 8 * u, 50 * u - k * 4 * u, 7 * u, 1 * u);
  const herbs = new Path2D();
  for (let k = 0; k < 6; k++) {
    const x = F - 200 * u + k * 34 * u;
    herbs.rect(x - 0.5 * u, 0, 1 * u, H * 0.08);
    poly(herbs, x - 6 * u, H * 0.08, x + 6 * u, H * 0.08, x + 1 * u, H * (0.16 + r() * 0.05), x - 1 * u, H * (0.16 + r() * 0.05));
  }
  const moon = new Path2D();
  moon.moveTo(F + 80 * u + 26 * u, H * 0.22);
  moon.arc(F + 80 * u, H * 0.22, 26 * u, 0, TAU);
  moon.moveTo(F + 90 * u + 20 * u, H * 0.2);
  moon.arc(F + 90 * u, H * 0.2, 20 * u, 0, TAU);
  return room(
    c,
    win,
    [120, 110, 124],
    hillView(c),
    (g, E) => {
      const T = time(E);
      stroke(g, blocks, [40, 34, 44], 1.4 * u, 0.55);
      fill(g, frame, shade(E, [70, 60, 60]));
      spill(g, E, wx, wx + ww, H * 0.56, floor, 60 * u);
      stroke(g, moon, [220, 190, 120], 1.6 * u, 0.6);
      fill(g, herbs, shade(E, [110, 130, 70]));
      fill(g, shelves, shade(E, [90, 60, 40]));
      for (const j of jars) {
        g.fillStyle = rgb(mix(shade(E, j.c, 0.4), j.c, 0.35));
        g.fillRect(j.x, j.y - j.h, 11 * u, j.h);
        glowAt(g, j.x + 5 * u, j.y - j.h / 2, 16 * u, j.c, 0.22 * (0.4 + E.glow));
      }
      glowAt(g, cx, cy - 10 * u, 220 * u, brew, 0.3);
      fire(g, E, cx, cy + 62 * u, u * 1.1);
      fill(g, pot, [22, 20, 24]);
      g.fillStyle = rgb(brew, 0.9);
      g.beginPath();
      g.ellipse(cx, cy - 5 * u, 46 * u, 6 * u, 0, 0, TAU);
      g.fill();
      for (let k = 0; k < 7; k++) {
        const kk = (T * 0.5 + k / 7) % 1;
        g.fillStyle = rgb(mix(brew, [255, 255, 255], 0.4), 0.7 * (1 - kk));
        g.beginPath();
        g.arc(cx + Math.sin(k * 2.3) * 30 * u + Math.sin(T + k) * 4 * u, cy - 8 * u - kk * 70 * u, (2 + kk * 4) * u, 0, TAU);
        g.fill();
      }
      fill(g, table, shade(E, [90, 60, 40]));
      fill(g, books, shade(E, [120, 40, 50], 0.5));
      g.fillStyle = rgb([30, 24, 30]);
      g.fillRect(F + 126 * u, H * 0.66 - 6 * u, 20 * u, 6 * u);
      const orb = g.createRadialGradient(F + 136 * u, H * 0.66 - 22 * u, 1, F + 136 * u, H * 0.66 - 18 * u, 15 * u);
      orb.addColorStop(0, "rgba(240,220,255,0.95)");
      orb.addColorStop(1, "rgba(140,90,220,0.7)");
      g.fillStyle = orb;
      g.beginPath();
      g.arc(F + 136 * u, H * 0.66 - 18 * u, 14 * u, 0, TAU);
      g.fill();
      glowAt(g, F + 136 * u, H * 0.66 - 18 * u, 70 * u, [190, 140, 255], 0.35 + 0.1 * Math.sin(T * 1.5));
      for (const x of [F + 70 * u, F + 110 * u]) {
        g.fillStyle = rgb(shade(E, [236, 226, 200]));
        g.fillRect(x - 2.5 * u, H * 0.66 - 50 * u, 5 * u, 16 * u);
        lamp(g, E, x, H * 0.66 - 53 * u, 50 * u, x, WARM, 0.4);
      }
    },
    floor,
  );
}

/** The thirty places this file paints. */
const MORE = {
  living,
  homekitchen,
  bathroom,
  attic,
  cabin,
  treehouse,
  tent,
  pool,
  indoorpool,
  hotspring,
  camp,
  deck,
  car,
  plane,
  submarine,
  office,
  classroom,
  lab,
  laundromat,
  gallery,
  theater,
  club,
  casino,
  arcade,
  studio,
  shrine,
  aquarium,
  observatory,
  stable,
  alchemy,
} satisfies Partial<Record<Place, (c: Ctx) => Scene>>;

const BUILD: Record<Place, (c: Ctx) => Scene> = { ...SCENES, ...MORE, ...HOME_SCENES, ...MORE_HOMES, ...LAST_HOMES };

export function buildScene(place: Place, seed: string, W: number, H: number, focus: number, mini: boolean, home: Home | null = null): Scene {
  const dress = home ? dressHome(home) : null;
  // An old-world house has no fitted kitchen, whatever its room is called.
  const kind = (dress?.style === "old" && OLDER[place]) || place;
  // Two houses' "kitchen" differ, and a place outside any home keeps the look it always had.
  const r = rand(seedOf(dress ? `${kind}:${dress.house}:${seed}` : `${kind}:${seed}`));
  return (BUILD[kind] ?? SCENES.hills)({ W, H, u: H / 300, F: W * focus, r, mini, home: dress });
}
