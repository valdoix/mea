/**
 * The rooms and yards every castle has (docs/25-rooms-of-the-keep.md Part 7). Each is painted once and
 * built of its castle's own stone, so the Red Keep's rookery and Harrenhal's differ without being drawn
 * twice.
 */
import { clamp, DARK, mix, rgb, TAU, WARM, type Ctx, type Env, type Place, type RGB } from "./places";
import { candle, keepLook, keepRoom, opening, outsideOf, reveal, shaft, shell, tint, torch, torchlight, tracery, type Look } from "./keepbits";
import { fill, fire, glowAt, GRASS, hillView, leafy, lit as sunlit, poly, ridge, stroke, tone, type Scene } from "./scenes";
import { ellipse, rr } from "./scenebits";

type G = CanvasRenderingContext2D;
const IRON: RGB = [52, 50, 56];
const lit = (E: Env, t: number, hue: RGB, amt?: number) => mix(sunlit(E, t, hue, amt), tint(E, hue, 0.3), E.night * 0.72);

function poly2(g: G, ...pts: number[]) {
  const p = new Path2D();
  poly(p, ...pts);
  g.fill(p);
}

/** A small hearth with its fire. */
function hearth(c: Ctx, L: Look, x: number, floor: number, w: number, h: number) {
  const { u } = c;
  const stone = new Path2D();
  stone.rect(x - w / 2, floor - h, w, h);
  stone.rect(x - w / 2 - 8 * u, floor - h - 7 * u, w + 16 * u, 8 * u);
  poly(stone, x - w / 2 + 6 * u, floor - h - 7 * u, x + w / 2 - 6 * u, floor - h - 7 * u, x + w * 0.2, floor - h - 54 * u, x - w * 0.2, floor - h - 54 * u);
  const mouth = new Path2D();
  mouth.moveTo(x - w * 0.34, floor);
  mouth.lineTo(x - w * 0.34, floor - h * 0.5);
  mouth.quadraticCurveTo(x, floor - h * 0.86, x + w * 0.34, floor - h * 0.5);
  mouth.lineTo(x + w * 0.34, floor);
  mouth.closePath();
  return (g: G, E: Env) => {
    fill(g, stone, mix(tint(E, L.wall, L.night), [255, 240, 214], 0.05));
    fill(g, mouth, [16, 10, 10]);
    glowAt(g, x, floor - 18 * u, (190 + 80 * torchlight(E)) * u, [255, 140, 62], 0.28 + 0.2 * torchlight(E));
    fire(g, E, x - w * 0.08, floor - 6 * u, 1.05 * u);
    fire(g, E, x + w * 0.08, floor - 6 * u, 1.3 * u);
  };
}

// ---------- Rooms ----------

/** A lord's solar: a wide oriel of three lights with a seat in it, the table before it, the fire to one side. */
function solar(c: Ctx): Scene {
  const { W, H, u, F, r } = c;
  const L = keepLook(c);
  const floor = H * 0.84;
  const ox = F - 150 * u;
  const hx = F + 210 * u;
  const S = shell(c, L, { floor, spring: 0.12, busy: [[ox - 180 * u, ox + 180 * u], [hx - 90 * u, hx + 90 * u]] });
  const win = new Path2D();
  const frame = new Path2D();
  const xs = [ox - 84 * u, ox, ox + 84 * u];
  for (const x of xs) {
    opening(win, L, x, H * 0.18, 70 * u, H * 0.62, u, r);
    tracery(frame, L, x, H * 0.18, 70 * u, H * 0.62, u);
  }
  // The bay stands out from the wall on two carved jambs, with a stone seat along its foot.
  const bay = new Path2D();
  bay.rect(ox - 140 * u, H * 0.13, 280 * u, 11 * u);
  bay.rect(ox - 140 * u, H * 0.13, 15 * u, H * 0.53);
  bay.rect(ox + 125 * u, H * 0.13, 15 * u, H * 0.53);
  const seat = new Path2D();
  seat.rect(ox - 136 * u, H * 0.62, 272 * u, 9 * u);
  seat.rect(ox - 128 * u, H * 0.65, 256 * u, floor - H * 0.65);
  const cushions = new Path2D();
  for (const d of [-90, -6, 78]) rr(cushions, ox + (d - 22) * u, H * 0.585, 56 * u, 13 * u, 6 * u);
  const fireplace = hearth(c, L, hx, floor, 112 * u, 86 * u);
  // A broad table before the window, its papers and a high chair behind it.
  const ty = H * 0.68;
  const tx = F - 20 * u;
  const table = new Path2D();
  table.rect(tx - 124 * u, ty, 248 * u, 8 * u);
  for (const d of [-112, 104]) poly(table, tx + d * u, ty + 8 * u, tx + (d + 8) * u, ty + 8 * u, tx + (d + 12) * u, H, tx + (d - 4) * u, H);
  const chair = new Path2D();
  chair.moveTo(tx - 22 * u, ty + 2 * u);
  chair.lineTo(tx - 22 * u, ty - 76 * u);
  chair.quadraticCurveTo(tx, ty - 104 * u, tx + 22 * u, ty - 76 * u);
  chair.lineTo(tx + 22 * u, ty + 2 * u);
  chair.closePath();
  const papers = new Path2D();
  poly(papers, tx - 100 * u, ty, tx - 58 * u, ty, tx - 52 * u, ty - 4 * u, tx - 94 * u, ty - 4 * u);
  poly(papers, tx + 42 * u, ty, tx + 86 * u, ty, tx + 90 * u, ty - 4 * u, tx + 46 * u, ty - 4 * u);
  const roll = new Path2D();
  rr(roll, tx - 40 * u, ty - 7 * u, 30 * u, 7 * u, 3.5 * u);
  return keepRoom(
    c,
    L,
    win,
    hillView(c),
    (g, E) => {
      S.under(g, E);
      reveal(g, E, L, win, u);
      fill(g, frame, tint(E, mix(L.joint, IRON, 0.5), 0.26));
      const stone = mix(tint(E, L.wall, L.night), [255, 240, 214], 0.1);
      fill(g, seat, mix(stone, DARK, 0.12));
      fill(g, cushions, tint(E, L.cloth, 0.38));
      fill(g, bay, stone);
      for (const x of xs) shaft(g, E, x - 35 * u, x + 35 * u, H * 0.62, H, 80 * u);
      fireplace(g, E);
      fill(g, chair, tint(E, mix(L.wood, L.cloth, 0.18), 0.34));
      stroke(g, chair, tint(E, L.cloth2, 0.38), 1.4 * u, 0.7);
      fill(g, table, tint(E, L.wood, 0.38));
      fill(g, papers, tint(E, [228, 216, 188], 0.48));
      fill(g, roll, tint(E, [214, 202, 170], 0.46));
      candle(g, E, tx + 106 * u, ty, u, 18);
      candle(g, E, tx - 112 * u, ty, u, 14);
      S.over(g, E);
    },
    floor,
  );
}

/** A maester's chambers: a wall of pigeonholes full of scrolls, jars, a long bench, a lens on its stand. */
function maester(c: Ctx): Scene {
  const { W, H, u, F, r } = c;
  const L = keepLook(c);
  const floor = H * 0.84;
  const S = shell(c, L, { floor, spring: 0.12, busy: [[-W, W * 2]] });
  const wx = F + 40 * u;
  const win = new Path2D();
  opening(win, L, wx, H * 0.2, 64 * u, H * 0.56, u, r);
  const frame = new Path2D();
  tracery(frame, L, wx, H * 0.2, 64 * u, H * 0.56, u);
  // Pigeonholes in every other bay, jars on shelves in the rest.
  const grids = new Path2D();
  const backs = new Path2D();
  const scrolls: { x: number; y: number; s: number; c: RGB }[] = [];
  const jars: { x: number; y: number; h: number; c: RGB }[] = [];
  const shelves = new Path2D();
  const bay = 190 * u;
  const glassHues: RGB[] = [[90, 130, 96], [150, 96, 60], [80, 96, 150], [186, 160, 80], [120, 70, 100], [190, 186, 170]];
  for (let k = -9, n = 0; k < 9; k++, n++) {
    const mid = F + (k + 0.5) * bay;
    if (mid < -bay || mid > W + bay || Math.abs(mid - wx) < bay * 0.72) continue;
    const x0 = mid - bay / 2 + 14 * u;
    const x1 = mid + bay / 2 - 14 * u;
    if (n % 2 === 0) {
      const top = H * 0.22;
      backs.rect(x0, top, x1 - x0, floor * 0.64 - top + 20 * u);
      const cell = 21 * u;
      for (let y = top; y < floor * 0.64 + 20 * u; y += cell) {
        grids.rect(x0, y - 1 * u, x1 - x0, 2 * u);
        for (let x = x0; x < x1 - cell / 2; x += cell) {
          grids.rect(x - 1 * u, y, 2 * u, cell);
          if (r() < 0.82) scrolls.push({ x: x + cell / 2, y: y + cell / 2, s: (5 + r() * 2.6) * u, c: r() < 0.84 ? [222, 208, 176] : [176, 140, 96] });
        }
      }
    } else {
      for (const y of [H * 0.3, H * 0.44, H * 0.58]) {
        shelves.rect(x0, y, x1 - x0, 4 * u);
        for (let x = x0 + 5 * u; x < x1 - 8 * u; ) {
          const w = (9 + r() * 8) * u;
          jars.push({ x: x + w / 2, y, h: (15 + r() * 20) * u, c: glassHues[(r() * glassHues.length) | 0]! });
          x += w + (3 + r() * 6) * u;
        }
      }
    }
  }
  // The long bench, with its books, mortar, and the lens.
  const ty = H * 0.68;
  const bench = new Path2D();
  const bx0 = F - 420 * u;
  const bx1 = F + 190 * u;
  bench.rect(bx0, ty, bx1 - bx0, 8 * u);
  for (let x = bx0 + 18 * u; x < bx1; x += 150 * u) bench.rect(x, ty + 8 * u, 9 * u, H - ty);
  const mortar = new Path2D();
  poly(mortar, F - 130 * u, ty, F - 96 * u, ty, F - 88 * u, ty - 20 * u, F - 138 * u, ty - 20 * u);
  const books = new Path2D();
  books.rect(F - 318 * u, ty - 8 * u, 56 * u, 8 * u);
  books.rect(F - 312 * u, ty - 15 * u, 46 * u, 7 * u);
  const lx = F + 118 * u;
  const stand = new Path2D();
  stand.rect(lx - 2 * u, ty - 62 * u, 4 * u, 62 * u);
  stand.rect(lx - 16 * u, ty - 4 * u, 32 * u, 4 * u);
  return keepRoom(
    c,
    L,
    win,
    hillView(c),
    (g, E) => {
      S.under(g, E);
      reveal(g, E, L, win, u);
      fill(g, frame, tint(E, mix(L.joint, IRON, 0.5), 0.26));
      shaft(g, E, wx - 32 * u, wx + 32 * u, H * 0.56, H, -70 * u);
      fill(g, backs, tint(E, mix(L.wood, DARK, 0.5), 0.26));
      for (const s of scrolls) {
        g.fillStyle = rgb(tint(E, s.c, 0.38));
        g.beginPath();
        g.arc(s.x, s.y, s.s, 0, TAU);
        g.fill();
        g.fillStyle = rgb(DARK, 0.26);
        g.beginPath();
        g.arc(s.x, s.y, s.s * 0.36, 0, TAU);
        g.fill();
      }
      fill(g, grids, tint(E, L.wood, 0.34));
      for (const j of jars) {
        g.fillStyle = rgb(tint(E, j.c, 0.38));
        rrFill(g, j.x - 5.5 * u, j.y - j.h, 11 * u, j.h, 3 * u);
        g.fillStyle = rgb(tint(E, [108, 80, 54], 0.34));
        g.fillRect(j.x - 3.4 * u, j.y - j.h - 3 * u, 6.8 * u, 3.4 * u);
      }
      fill(g, shelves, tint(E, L.wood, 0.36));
      fill(g, bench, tint(E, L.wood, 0.38));
      fill(g, mortar, tint(E, [146, 140, 134], 0.42));
      fill(g, books, tint(E, L.cloth, 0.4));
      fill(g, stand, tint(E, [186, 150, 80], 0.46));
      // The lens, catching the candle.
      const on = torchlight(E);
      g.strokeStyle = rgb(tint(E, [196, 160, 90], 0.5));
      g.lineWidth = 3 * u;
      g.fillStyle = rgb(mix([190, 214, 226], [255, 226, 160], on), 0.46);
      g.beginPath();
      g.arc(lx, ty - 76 * u, 16 * u, 0, TAU);
      g.fill();
      g.stroke();
      candle(g, E, lx - 34 * u, ty, u, 19);
      candle(g, E, F - 204 * u, ty, u, 16);
      S.over(g, E);
    },
    floor,
  );
}
function rrFill(g: G, x: number, y: number, w: number, h: number, k: number) {
  const p = new Path2D();
  rr(p, x, y, w, h, k);
  g.fill(p);
}

/** The rookery: tall arches open on the sky, rows of wicker cages, ravens along the sills. */
function rookery(c: Ctx): Scene {
  const { W, H, u, F, r } = c;
  const L = keepLook(c);
  const floor = H * 0.86;
  const S = shell(c, L, { floor, spring: 0.09, bay: 240, torches: false, busy: [[-W, W * 2]] });
  const bay = 240 * u;
  const win = new Path2D();
  const arches: number[] = [];
  const cages: { x: number; y: number; s: number }[] = [];
  const birds: { x: number; y: number; s: number; f: number }[] = [];
  const beams = new Path2D();
  for (let k = -8; k < 8; k++) {
    const mid = F + (k + 0.5) * bay;
    if (mid < -bay || mid > W + bay) continue;
    if (k % 2 === 0) {
      arches.push(mid);
      opening(win, { ...L, masonry: L.masonry === "fused" ? "fused" : "redstone" }, mid, H * 0.18, 124 * u, H * 0.6, u, r);
      birds.push({ x: mid + (r() - 0.5) * 70 * u, y: H * 0.6, s: 1, f: r() < 0.5 ? 1 : -1 });
      birds.push({ x: mid + (r() - 0.5) * 70 * u, y: H * 0.6, s: 0.9, f: r() < 0.5 ? 1 : -1 });
    } else {
      for (const y of [H * 0.27, H * 0.47, H * 0.67]) {
        beams.rect(mid - bay * 0.42, y + 24 * u, bay * 0.84, 4 * u);
        for (const d of [-64, 0, 64]) {
          cages.push({ x: mid + d * u, y, s: 25 * u });
          if (r() < 0.7) birds.push({ x: mid + d * u, y: y + 22 * u, s: 0.72, f: r() < 0.5 ? 1 : -1 });
        }
      }
    }
  }
  const sill = new Path2D();
  for (const x of arches) sill.rect(x - 70 * u, H * 0.6, 140 * u, 7 * u);
  // Droppings streak the stone below the cages and whiten the floor.
  const streaks = new Path2D();
  for (let i = 0; i < 90; i++) {
    const x = r() * W;
    const y = H * (0.34 + r() * 0.5);
    streaks.moveTo(x, y);
    streaks.lineTo(x + (r() - 0.5) * 2 * u, y + (6 + r() * 22) * u);
  }
  const feathers = new Path2D();
  for (let i = 0; i < 40; i++) {
    const x = r() * W;
    const y = floor + r() * (H - floor);
    feathers.moveTo(x, y);
    feathers.lineTo(x + (r() - 0.5) * 12 * u, y + (r() - 0.5) * 3 * u);
  }
  return keepRoom(
    c,
    L,
    win,
    hillView(c),
    (g, E) => {
      S.under(g, E);
      reveal(g, E, L, win, u);
      fill(g, sill, tint(E, mix(L.wall, [240, 230, 214], 0.2), L.night));
      g.save();
      g.clip(outsideOf(c, win), "evenodd");
      stroke(g, streaks, tint(E, [226, 222, 212], 0.34), 1 * u, 0.5);
      g.restore();
      for (const x of arches) shaft(g, E, x - 60 * u, x + 60 * u, H * 0.6, H, 90 * u, [226, 232, 244]);
      fill(g, beams, tint(E, L.wood, 0.34));
      for (const k of cages) {
        g.fillStyle = rgb(tint(E, mix(L.wood, DARK, 0.4), 0.26));
        g.beginPath();
        g.arc(k.x, k.y, k.s, Math.PI, 0);
        g.lineTo(k.x + k.s, k.y + k.s * 0.92);
        g.lineTo(k.x - k.s, k.y + k.s * 0.92);
        g.fill();
        g.strokeStyle = rgb(tint(E, [176, 146, 92], 0.36));
        g.lineWidth = 1.2 * u;
        g.beginPath();
        for (let d = -0.76; d <= 0.8; d += 0.38) {
          g.moveTo(k.x + d * k.s, k.y + k.s * 0.92);
          g.lineTo(k.x + d * k.s, k.y - Math.sqrt(Math.max(0, 1 - d * d)) * k.s);
        }
        g.moveTo(k.x - k.s, k.y + k.s * 0.2);
        g.lineTo(k.x + k.s, k.y + k.s * 0.2);
        g.stroke();
      }
      // Ravens, heads up by day and tucked at night.
      const asleep = clamp(E.night * 1.4);
      for (const b of birds) {
        const s = b.s * u;
        g.fillStyle = "rgb(16,14,20)";
        g.beginPath();
        g.ellipse(b.x, b.y - 11 * s, 13 * s, 8.5 * s, -0.25 * b.f, 0, TAU);
        g.fill();
        poly2(g, b.x - b.f * 8 * s, b.y - 9 * s, b.x - b.f * 26 * s, b.y - 3 * s, b.x - b.f * 8 * s, b.y - 15 * s);
        const hy = b.y - (17 + (1 - asleep) * 8) * s;
        const hx = b.x + b.f * (9 - asleep * 4) * s;
        g.beginPath();
        g.arc(hx, hy, 5.5 * s, 0, TAU);
        g.fill();
        if (asleep < 0.6) poly2(g, hx + b.f * 4 * s, hy - 2 * s, hx + b.f * 14 * s, hy + 1 * s, hx + b.f * 4 * s, hy + 3 * s);
      }
      stroke(g, feathers, tint(E, [40, 36, 44], 0.3), 1.2 * u, 0.7);
      S.over(g, E);
      for (let i = 0; i < arches.length; i++) torch(g, E, arches[i]! + bay * 0.5, H * 0.14 + 46 * u, u, 0.9);
    },
    floor,
  );
}

/** A spiral stair: the curve of the drum, wedge steps winding up round the newel, one torch above. */
function spiralstair(c: Ctx): Scene {
  const { W, H, u, F, r } = c;
  const L = keepLook(c);
  const floor = H * 0.9;
  const cx = F - 40 * u;
  const rad = Math.max(W * 0.74, 520 * u);
  // Vertical bands that narrow and darken towards the edges, like the inside of a drum.
  const bands: { x: number; w: number; d: number }[] = [];
  for (let t = -1; t < 1; t += 0.05) {
    const x = cx + Math.sin((t * Math.PI) / 2) * rad;
    const x2 = cx + Math.sin(((t + 0.05) * Math.PI) / 2) * rad;
    bands.push({ x, w: x2 - x + 1, d: Math.abs(t) });
  }
  const courses = new Path2D();
  for (let y = 0; y < H; y += 26 * u) {
    courses.moveTo(0, y + 28 * u);
    courses.quadraticCurveTo(cx, y - 18 * u, W, y + 28 * u);
  }
  const win = new Path2D();
  opening(win, L, cx + 160 * u, H * 0.16, 28 * u, H * 0.46, u, r);
  // Steps climbing from the lower left, winding behind the newel at the top right.
  const steps: { p: Path2D; t: number }[] = [];
  const n = 12;
  for (let i = 0; i < n; i++) {
    const t = i / n;
    const x0 = -40 * u + t * (cx + 40 * u);
    const x1 = x0 + (rad * 2) / n + 44 * u;
    const y = floor - t * H * 0.56;
    const p = new Path2D();
    poly(p, x0, y, x1, y - 2 * u, x1 + 12 * u, H + 40 * u, x0 - 12 * u, H + 40 * u);
    steps.push({ p, t });
  }
  const lips = new Path2D();
  for (let i = 0; i < n; i++) {
    const t = i / n;
    const x0 = -40 * u + t * (cx + 40 * u);
    const x1 = x0 + (rad * 2) / n + 44 * u;
    const y = floor - t * H * 0.56;
    lips.rect(x0, y, x1 - x0, 3 * u);
  }
  const newel = new Path2D();
  newel.rect(cx - 30 * u, -4, 60 * u, H + 8);
  return keepRoom(
    c,
    L,
    win,
    hillView(c),
    (g, E) => {
      const stone = tint(E, L.wall, L.night);
      g.save();
      g.clip(outsideOf(c, win), "evenodd");
      for (const b of bands) {
        g.fillStyle = rgb(mix(stone, DARK, b.d * b.d * 0.6));
        g.fillRect(b.x, 0, b.w, H);
      }
      stroke(g, courses, tint(E, L.joint, 0.3), 1 * u, 0.5);
      g.restore();
      reveal(g, E, L, win, u);
      shaft(g, E, cx + 146 * u, cx + 174 * u, H * 0.46, H, -130 * u, [226, 232, 255]);
      for (const s of steps) {
        fill(g, s.p, mix(tint(E, mix(L.floor, L.wall, 0.4), L.night), DARK, 0.22 + s.t * 0.3));
      }
      fill(g, lips, mix(stone, [255, 240, 214], 0.2));
      const lg = g.createLinearGradient(cx - 30 * u, 0, cx + 30 * u, 0);
      lg.addColorStop(0, rgb(mix(stone, DARK, 0.5)));
      lg.addColorStop(0.42, rgb(mix(stone, [255, 240, 214], 0.08)));
      lg.addColorStop(1, rgb(mix(stone, DARK, 0.6)));
      g.fillStyle = lg;
      g.fill(newel);
      torch(g, E, cx - 180 * u, H * 0.26, u, 1.3);
      torch(g, E, cx - 500 * u, H * 0.46, u, 1.1);
      if (W > cx + 300 * u) torch(g, E, cx + 280 * u, H * 0.3, u, 1);
    },
    floor,
  );
}

/** A sept in a castle: seven figures in their niches, a great crystal hung over them, the candles of the faithful. */
function sept(c: Ctx): Scene {
  const { W, H, u, F, r } = c;
  const L = keepLook(c);
  const floor = H * 0.84;
  const S = shell(c, L, { floor, spring: 0.18, bay: 150, torches: false, busy: [[-W, W * 2]] });
  const bay = 150 * u;
  const mids: number[] = [];
  for (let k = -4; k < 3; k++) mids.push(F - 150 * u + (k + 0.5) * bay + 75 * u);
  const niches = new Path2D();
  const figures: Path2D[] = [];
  mids.forEach((x, i) => {
    niches.moveTo(x - 46 * u, floor);
    niches.lineTo(x - 46 * u, H * 0.4);
    niches.quadraticCurveTo(x - 44 * u, H * 0.27, x, H * 0.24);
    niches.quadraticCurveTo(x + 44 * u, H * 0.27, x + 46 * u, H * 0.4);
    niches.lineTo(x + 46 * u, floor);
    niches.closePath();
    const p = new Path2D();
    const top = floor - 134 * u - (i % 2) * 6 * u;
    p.moveTo(x - 29 * u, floor - 12 * u);
    p.quadraticCurveTo(x - 28 * u, floor - 72 * u, x - 15 * u, top + 30 * u);
    p.quadraticCurveTo(x, top + 22 * u, x + 15 * u, top + 30 * u);
    p.quadraticCurveTo(x + 28 * u, floor - 72 * u, x + 29 * u, floor - 12 * u);
    p.closePath();
    ellipse(p, x, top + 13 * u, 13 * u, 16 * u);
    p.rect(x - 33 * u, floor - 12 * u, 66 * u, 12 * u);
    figures.push(p);
  });
  // Glass in the bays beyond the seven.
  const win = new Path2D();
  const glassXs: number[] = [];
  for (let x = mids[0]! - bay * 1.2; x > -60 * u; x -= bay * 1.5) glassXs.push(x);
  for (const x of glassXs) opening(win, { ...L, masonry: "ashlar" }, x, H * 0.24, 56 * u, H * 0.62, u, r);
  const frame = new Path2D();
  for (const x of glassXs) tracery(frame, { ...L, masonry: "ashlar" }, x, H * 0.24, 56 * u, H * 0.62, u);
  const racks = new Path2D();
  const flames: { x: number; y: number; h: number }[] = [];
  mids.forEach((x) => {
    racks.rect(x - 30 * u, floor + 3 * u, 60 * u, 5 * u);
    for (let d = -24; d <= 24; d += 12) flames.push({ x: x + d * u, y: floor + 3 * u, h: 6 + r() * 7 });
  });
  const hues: RGB[] = [[230, 90, 90], [240, 170, 70], [240, 226, 110], [106, 190, 120], [90, 150, 230], [120, 100, 220], [190, 110, 210]];
  return keepRoom(
    c,
    L,
    win,
    hillView(c),
    (g, E) => {
      S.under(g, E);
      reveal(g, E, L, win, u);
      fill(g, frame, [24, 20, 24]);
      fill(g, niches, mix(tint(E, L.joint, 0.28), DARK, 0.25));
      stroke(g, niches, tint(E, mix(L.wall, [255, 240, 214], 0.2), L.night), 4 * u);
      figures.forEach((f, i) => {
        const hue = mix(mix(L.wall, [226, 218, 202], 0.6), hues[i]!, 0.1);
        fill(g, f, tint(E, hue, 0.42));
      });
      fill(g, racks, tint(E, IRON, 0.3));
      for (const f of flames) candle(g, E, f.x, f.y, u, f.h, 0.34);
      // The crystal, with its colours on the air and the floor by day.
      const cy = H * 0.15;
      g.strokeStyle = "rgb(30,26,26)";
      g.lineWidth = 1.2 * u;
      g.beginPath();
      g.moveTo(F - 150 * u, 0);
      g.lineTo(F - 150 * u, cy - 20 * u);
      g.stroke();
      const b = clamp(0.3 + E.day * 0.6);
      hues.forEach((hue, i) => {
        const a = (i / 7) * Math.PI + Math.PI * 0.04;
        const tx = F - 150 * u + Math.cos(a) * 440 * u;
        g.fillStyle = rgb(hue, 0.06 + 0.08 * E.day);
        g.beginPath();
        g.moveTo(F - 150 * u, cy);
        g.lineTo(tx - 34 * u, floor + 26 * u);
        g.lineTo(tx + 34 * u, floor + 26 * u);
        g.fill();
        g.fillStyle = rgb(mix(DARK, hue, b));
        poly2(g, F - 150 * u, cy - 19 * u, F - 150 * u + Math.cos(a) * 16 * u, cy + 3 * u, F - 150 * u, cy + 26 * u, F - 150 * u + Math.cos(a + 0.4) * 9 * u, cy + 3 * u);
      });
      glowAt(g, F - 150 * u, cy, 70 * u, [255, 250, 240], 0.3);
      S.over(g, E);
    },
    floor,
  );
}

// ---------- Out in the walls ----------

const stoneOf = (L: Look): RGB => (L.masonry === "redstone" ? [190, 104, 84] : L.masonry === "fused" ? [86, 80, 86] : [186, 172, 150]);

/** A curtain wall right across the back of a yard, with towers and their lit windows. */
function curtain(c: Ctx, L: Look, top: number, bottom: number) {
  const { W, u, F, r } = c;
  const hue = stoneOf(L);
  const wall = new Path2D();
  wall.rect(-4, top, W + 8, bottom - top);
  for (let x = -6 * u; x < W; x += 22 * u) wall.rect(x, top - 10 * u, 13 * u, 11 * u);
  const towers = new Path2D();
  const lights: { x: number; y: number }[] = [];
  for (let x = F - 880 * u; x < W + 200 * u; x += 440 * u) {
    if (x < -120 * u) continue;
    towers.rect(x - 50 * u, top - 66 * u, 100 * u, bottom - top + 66 * u);
    for (let k = -2; k <= 2; k++) towers.rect(x + k * 21 * u - 6 * u, top - 77 * u, 12 * u, 12 * u);
    lights.push({ x: x + (r() - 0.5) * 34 * u, y: top - 30 * u });
  }
  const joints = new Path2D();
  for (let y = top; y < bottom; y += 16 * u) {
    joints.moveTo(0, y);
    joints.lineTo(W, y);
  }
  return (g: G, E: Env) => {
    fill(g, wall, lit(E, 0.62, hue, 0.74));
    stroke(g, joints, tone(E, 0.86), 0.7 * u, 0.3);
    fill(g, towers, lit(E, 0.5, hue, 0.82));
    for (const l of lights) {
      g.fillStyle = rgb(mix([20, 16, 18], [255, 196, 110], E.glow));
      g.fillRect(l.x - 3 * u, l.y, 6 * u, 14 * u);
      if (E.glow > 0.2) glowAt(g, l.x, l.y + 7 * u, 22 * u, WARM, 0.5 * E.glow);
    }
  };
}

function cobbles(c: Ctx, top: number) {
  const { W, H, u, r } = c;
  const ground = new Path2D();
  ground.rect(-4, top, W + 8, H - top);
  const stones = new Path2D();
  for (let i = 0; i < Math.round(W / (2 * u)); i++) {
    const x = r() * W;
    const t = r();
    const y = top + t * t * (H - top);
    ellipse(stones, x, y, (3 + t * 8) * u, (1.2 + t * 3.2) * u);
  }
  return (g: G, E: Env, hue: RGB) => {
    fill(g, ground, lit(E, 0.72, hue, 0.7));
    fill(g, stones, lit(E, 0.6, mix(hue, [255, 244, 224], 0.14), 0.7), 0.7);
    if (E.c.snow > 0.2) fill(g, ground, [232, 236, 246], 0.5 * E.c.snow);
    if (E.c.rain > 0.2) {
      g.fillStyle = rgb(mix(E.sky.bot, [200, 210, 228], 0.4), 0.14 * E.c.rain);
      g.fill(stones);
    }
  };
}

/** A castle yard: cobbles between the walls, the well, a cart, the keep rising behind. */
function bailey(c: Ctx): Scene {
  const { W, H, u, F } = c;
  const L = keepLook(c);
  const ground = H * 0.66;
  const wall = curtain(c, L, H * 0.34, ground);
  const floor = cobbles(c, ground);
  const gx = F - 60 * u;
  const keepBody = new Path2D();
  keepBody.rect(gx - 120 * u, H * 0.04, 240 * u, ground - H * 0.04);
  for (let k = -5; k <= 5; k++) keepBody.rect(gx + k * 22 * u - 7 * u, H * 0.04 - 12 * u, 14 * u, 13 * u);
  const door = new Path2D();
  door.moveTo(gx - 28 * u, ground);
  door.lineTo(gx - 28 * u, ground - 44 * u);
  door.arc(gx, ground - 44 * u, 28 * u, Math.PI, 0);
  door.lineTo(gx + 28 * u, ground);
  door.closePath();
  const well = new Path2D();
  const wx = F + 130 * u;
  const wy = H * 0.86;
  ellipse(well, wx, wy - 26 * u, 37 * u, 9 * u);
  well.rect(wx - 37 * u, wy - 26 * u, 74 * u, 32 * u);
  const roof = new Path2D();
  roof.rect(wx - 32 * u, wy - 88 * u, 5 * u, 62 * u);
  roof.rect(wx + 27 * u, wy - 88 * u, 5 * u, 62 * u);
  poly(roof, wx - 46 * u, wy - 84 * u, wx, wy - 112 * u, wx + 46 * u, wy - 84 * u);
  // A cart at rest, shafts down.
  const cx = F - 380 * u;
  const cy = H * 0.86;
  const cart = new Path2D();
  cart.rect(cx - 70 * u, cy - 40 * u, 130 * u, 28 * u);
  poly(cart, cx + 60 * u, cy - 22 * u, cx + 138 * u, cy + 14 * u, cx + 134 * u, cy + 18 * u, cx + 58 * u, cy - 14 * u);
  const wheel = new Path2D();
  wheel.arc(cx - 24 * u, cy, 20 * u, 0, TAU);
  const sacks = new Path2D();
  for (const d of [-54, -22, 8]) ellipse(sacks, cx + d * u, cy - 50 * u, 19 * u, 13 * u);
  const hue = stoneOf(L);
  return {
    draw(g, E) {
      fill(g, keepBody, lit(E, 0.56, mix(hue, DARK, 0.06), 0.8));
      wall(g, E);
      fill(g, keepBody, lit(E, 0.5, hue, 0.84));
      fill(g, door, [14, 10, 12]);
      stroke(g, door, lit(E, 0.4, mix(hue, [255, 240, 214], 0.2), 0.9), 4 * u);
      floor(g, E, mix(hue, [120, 110, 100], 0.6));
      fill(g, sacks, lit(E, 0.5, [178, 160, 120], 0.76));
      fill(g, cart, lit(E, 0.64, [110, 76, 50], 0.8));
      stroke(g, wheel, lit(E, 0.7, [86, 60, 40], 0.8), 4 * u);
      fill(g, well, lit(E, 0.52, mix(hue, [150, 140, 130], 0.6), 0.8));
      fill(g, roof, lit(E, 0.66, [100, 70, 48], 0.8));
      for (const x of [gx - 54 * u, gx + 54 * u, F - 620 * u]) {
        if (x < -20 * u) continue;
        g.fillStyle = "rgb(24,20,22)";
        g.fillRect(x - 2 * u, ground - 76 * u, 4 * u, 22 * u);
        if (E.glow > 0.1) {
          glowAt(g, x, ground - 76 * u, 130 * u, WARM, 0.4 * torchlight(E));
          fire(g, E, x, ground - 76 * u, 0.7 * u);
        }
      }
    },
  };
}

/** A training yard: straw men and pells, butts for the archers, a rack of blunted arms, a rail. */
function trainingyard(c: Ctx): Scene {
  const { W, H, u, F, r } = c;
  const L = keepLook(c);
  const ground = H * 0.64;
  const wall = curtain(c, L, H * 0.32, ground);
  const dirt = new Path2D();
  dirt.rect(-4, ground, W + 8, H - ground);
  const scuffs = new Path2D();
  for (let i = 0; i < Math.round(W / (4 * u)); i++) {
    const x = r() * W;
    const t = r();
    const y = ground + t * (H - ground);
    scuffs.moveTo(x, y);
    scuffs.lineTo(x + (r() - 0.5) * 26 * u, y + (r() - 0.5) * 3 * u);
  }
  const men: { x: number; lean: number }[] = [];
  for (let x = F - 40 * u; x > -60 * u; x -= 174 * u) men.push({ x, lean: (r() - 0.5) * 0.22 });
  const rail = new Path2D();
  rail.rect(-4, H * 0.74, W + 8, 4 * u);
  rail.rect(-4, H * 0.82, W + 8, 3.4 * u);
  for (let x = F % (130 * u); x < W; x += 130 * u) rail.rect(x, H * 0.72, 6 * u, H);
  const bx = F + 130 * u;
  const by = H * 0.72;
  const rack = new Path2D();
  const rx = F - 110 * u;
  rack.rect(rx - 50 * u, H * 0.5, 100 * u, 4 * u);
  rack.rect(rx - 50 * u, H * 0.62, 100 * u, 4 * u);
  rack.rect(rx - 50 * u, H * 0.44, 5 * u, H * 0.26);
  rack.rect(rx + 45 * u, H * 0.44, 5 * u, H * 0.26);
  const staves = new Path2D();
  for (let d = -38; d <= 38; d += 15) staves.rect(rx + d * u - 1.4 * u, H * 0.36 + (Math.abs(d) % 4) * u, 2.8 * u, H * 0.3);
  return {
    draw(g, E) {
      wall(g, E);
      fill(g, dirt, lit(E, 0.7, [150, 126, 92], 0.76));
      stroke(g, scuffs, tone(E, 0.8), 1.2 * u, 0.3);
      if (E.c.snow > 0.2) fill(g, dirt, [232, 236, 246], 0.5 * E.c.snow);
      fill(g, staves, lit(E, 0.6, [148, 112, 74], 0.8));
      fill(g, rack, lit(E, 0.66, [102, 72, 48], 0.8));
      // The butt, its rings faded by the weather, with arrows in it.
      const rings: [number, RGB][] = [[38, [226, 214, 186]], [28, [176, 50, 50]], [18, [226, 214, 186]], [9, [214, 170, 60]]];
      g.fillStyle = rgb(lit(E, 0.66, [124, 92, 54], 0.8));
      poly2(g, bx - 8 * u, by + 40 * u, bx - 2 * u, by + 40 * u, bx - 26 * u, H, bx - 34 * u, H);
      poly2(g, bx + 2 * u, by + 40 * u, bx + 8 * u, by + 40 * u, bx + 34 * u, H, bx + 26 * u, H);
      for (const [rad, col] of rings) {
        g.fillStyle = rgb(lit(E, 0.5, col, 0.86));
        g.beginPath();
        g.arc(bx, by, rad * u, 0, TAU);
        g.fill();
      }
      g.strokeStyle = rgb(lit(E, 0.76, [70, 50, 40], 0.8));
      g.lineWidth = 1.4 * u;
      g.beginPath();
      for (const [dx, dy] of [[6, -8], [-12, 4], [15, 12]] as const) {
        g.moveTo(bx + dx * u, by + dy * u);
        g.lineTo(bx + (dx + 16) * u, by + (dy + 8) * u);
      }
      g.stroke();
      // Straw men on their posts, leaning from the blows.
      for (const m of men) {
        g.save();
        g.translate(m.x, H * 0.92);
        g.rotate(m.lean);
        g.fillStyle = rgb(lit(E, 0.68, [106, 76, 50], 0.8));
        g.fillRect(-3.4 * u, -128 * u, 6.8 * u, 136 * u);
        g.fillRect(-46 * u, -96 * u, 92 * u, 6 * u);
        g.fillStyle = rgb(lit(E, 0.5, [204, 174, 104], 0.86));
        g.beginPath();
        g.ellipse(0, -72 * u, 25 * u, 37 * u, 0, 0, TAU);
        g.fill();
        g.beginPath();
        g.arc(0, -128 * u, 14 * u, 0, TAU);
        g.fill();
        g.strokeStyle = rgb(lit(E, 0.7, [140, 112, 66], 0.8));
        g.lineWidth = 1.5 * u;
        g.beginPath();
        for (const y of [-92, -74, -56]) {
          g.moveTo(-23 * u, y * u);
          g.lineTo(23 * u, y * u);
        }
        g.stroke();
        g.restore();
      }
      fill(g, rail, lit(E, 0.6, [116, 86, 58], 0.8));
      if (E.glow > 0.12) for (const x of [F - 500 * u, F + 40 * u]) {
        if (x < -20 * u) continue;
        g.fillStyle = "rgb(26,22,22)";
        g.fillRect(x - 2 * u, H * 0.5, 4 * u, 28 * u);
        glowAt(g, x, H * 0.5, 130 * u, WARM, 0.38 * torchlight(E));
        fire(g, E, x, H * 0.5, 0.7 * u);
      }
    },
  };
}

/** The battlements: merlons across the foreground, a walk of worn stone, the land falling away, banners streaming. */
function battlements(c: Ctx): Scene {
  const { W, H, u, F } = c;
  const L = keepLook(c);
  const hue = stoneOf(L);
  const far = ridge(c, H * 0.5, 24 * u, 0.5);
  const near = ridge(c, H * 0.62, 12 * u, 0.9);
  const trees = new Path2D();
  for (let x = 0; x < W; x += 36 * u) {
    const y = near.y(x);
    if ((Math.sin(x * 0.03) + 1) * 0.5 > 0.45) leafy(trees, x, y + 4 * u, 34 * u);
  }
  const top = H * 0.66;
  const parapet = new Path2D();
  parapet.rect(-4, top + 40 * u, W + 8, H);
  const merlons = new Path2D();
  const step = 118 * u;
  for (let x = (F % step) - step; x < W + step; x += step) merlons.rect(x, top - 40 * u, 74 * u, 84 * u);
  const caps = new Path2D();
  for (let x = (F % step) - step; x < W + step; x += step) caps.rect(x - 4 * u, top - 46 * u, 82 * u, 8 * u);
  caps.rect(-4, top + 38 * u, W + 8, 6 * u);
  const joints = new Path2D();
  for (let y = top + 56 * u; y < H; y += 18 * u) {
    joints.moveTo(0, y);
    joints.lineTo(W, y);
  }
  for (let y = top - 22 * u; y < top + 40 * u; y += 18 * u) {
    for (let x = (F % step) - step; x < W + step; x += step) {
      joints.moveTo(x, y);
      joints.lineTo(x + 74 * u, y);
    }
  }
  const flagXs = [F - 380 * u, F + 90 * u, F - 850 * u].filter((x) => x > -40 * u && x < W + 40 * u);
  return {
    draw(g, E) {
      fill(g, far.p, tone(E, 0.28, GRASS, 0.5));
      fill(g, near.p, tone(E, 0.5, GRASS, 0.6));
      fill(g, trees, tone(E, 0.64, [62, 100, 66], 0.66));
      // Banners on the wall stream with the wind.
      const T = E.still ? 0 : E.T;
      for (const [i, x] of flagXs.entries()) {
        g.fillStyle = rgb(tone(E, 0.9));
        g.fillRect(x - 2 * u, H * 0.04, 4 * u, top - H * 0.04);
        const pair = i % 2 && L.second ? L.second : ([L.cloth, L.cloth2] as [RGB, RGB]);
        const flap = 6 + E.c.wind * 22;
        const y0 = H * 0.05;
        const len = (70 + E.c.wind * 40) * u;
        const p = new Path2D();
        p.moveTo(x, y0);
        p.quadraticCurveTo(x + len * 0.5, y0 + Math.sin(T * 3 + i) * flap * 0.5 * u, x + len, y0 + 10 * u + Math.sin(T * 3 + i + 1) * flap * u);
        p.lineTo(x + len * 0.84, y0 + 25 * u + Math.sin(T * 3 + i + 1) * flap * u);
        p.lineTo(x + len, y0 + 40 * u + Math.sin(T * 3 + i + 1) * flap * u);
        p.quadraticCurveTo(x + len * 0.5, y0 + 46 * u + Math.sin(T * 3 + i) * flap * 0.5 * u, x, y0 + 46 * u);
        p.closePath();
        fill(g, p, lit(E, 0.42, pair[0], 0.86));
        stroke(g, p, lit(E, 0.34, pair[1], 0.86), 2 * u);
      }
      fill(g, merlons, lit(E, 0.5, hue, 0.86));
      fill(g, parapet, lit(E, 0.56, mix(hue, DARK, 0.1), 0.82));
      stroke(g, joints, tone(E, 0.86), 0.9 * u, 0.32);
      fill(g, caps, lit(E, 0.36, mix(hue, [255, 244, 224], 0.2), 0.9));
      if (E.c.snow > 0.2) fill(g, caps, [236, 240, 250], 0.82 * E.c.snow);
      for (const x of [F - 230 * u, F - 700 * u, F + 240 * u]) {
        if (x < -20 * u || x > W + 20 * u) continue;
        g.fillStyle = "rgb(26,22,22)";
        g.fillRect(x - 2 * u, top + 8 * u, 4 * u, 30 * u);
        if (E.glow > 0.12) {
          glowAt(g, x, top + 8 * u, 120 * u, WARM, 0.4 * torchlight(E));
          fire(g, E, x, top + 8 * u, 0.75 * u);
        }
      }
    },
  };
}

/**
 * A godswood: the heart tree white with red leaves and a face cut in its trunk, by a black pool, the
 * castle wall glimpsed behind. In the Red Keep the heart tree is a great oak, and it has no face.
 */
function godswood(c: Ctx): Scene {
  const { W, H, u, F, r } = c;
  const L = keepLook(c);
  const oak = L.masonry === "redstone";
  const wall = curtain(c, L, H * 0.24, H * 0.5);
  const ground = ridge(c, H * 0.72, 6 * u);
  const back = new Path2D();
  const near = new Path2D();
  // Old trees close together: a dark wall of them behind, and nearer trunks that rise out of the picture.
  back.rect(-4, H * 0.3, W + 8, H * 0.46);
  for (let x = -30 * u; x < W + 40 * u; x += (26 + r() * 30) * u) leafy(back, x, H * 0.74, (130 + r() * 70) * u);
  for (let x = -30 * u; x < W + 40 * u; x += (92 + r() * 90) * u) {
    if (Math.abs(x - F) < 200 * u) continue;
    const w = (7 + r() * 8) * u;
    poly(near, x - w * 1.3, H * 0.9, x + w * 1.3, H * 0.9, x + w * 0.7, -2, x - w * 0.7, -2);
  }
  const canopy = new Path2D();
  for (let x = -30 * u; x < W + 40 * u; x += (56 + r() * 40) * u) {
    if (Math.abs(x - F) < 150 * u) continue;
    ellipse(canopy, x, (r() * 18 - 6) * u, (60 + r() * 34) * u, (24 + r() * 16) * u);
  }
  const tx = F;
  const by = H * 0.8;
  const trunk = new Path2D();
  trunk.moveTo(tx - 42 * u, by);
  trunk.quadraticCurveTo(tx - 24 * u, H * 0.56, tx - 28 * u, H * 0.24);
  trunk.lineTo(tx + 28 * u, H * 0.24);
  trunk.quadraticCurveTo(tx + 24 * u, H * 0.56, tx + 42 * u, by);
  trunk.quadraticCurveTo(tx + 62 * u, by + 13 * u, tx + 74 * u, by + 22 * u);
  trunk.lineTo(tx - 74 * u, by + 22 * u);
  trunk.quadraticCurveTo(tx - 62 * u, by + 13 * u, tx - 42 * u, by);
  trunk.closePath();
  const limbs = new Path2D();
  const limb = (x: number, y: number, a: number, L0: number, w: number, d: number) => {
    const x2 = x + Math.cos(a) * L0;
    const y2 = y + Math.sin(a) * L0;
    poly(limbs, x - w, y, x2, y2, x + w, y);
    if (d > 0) {
      limb(x2, y2, a - 0.3 - r() * 0.4, L0 * 0.7, w * 0.6, d - 1);
      limb(x2, y2, a + 0.3 + r() * 0.4, L0 * 0.7, w * 0.6, d - 1);
    }
  };
  limb(tx - 12 * u, H * 0.3, -Math.PI / 2 - 0.5, 56 * u, 13 * u, 3);
  limb(tx + 12 * u, H * 0.3, -Math.PI / 2 + 0.5, 56 * u, 13 * u, 3);
  limb(tx, H * 0.26, -Math.PI / 2, 48 * u, 12 * u, 3);
  const leaves: { x: number; y: number; s: number; d: number }[] = [];
  for (let i = 0; i < 230; i++) {
    const a = r() * TAU;
    const rad = Math.sqrt(r());
    leaves.push({ x: tx + Math.cos(a) * rad * 170 * u, y: H * 0.13 + Math.sin(a) * rad * 58 * u, s: (4 + r() * 6) * u, d: r() });
  }
  const pool = new Path2D();
  ellipse(pool, tx - 180 * u, H * 0.92, 170 * u, 21 * u);
  const fallen: { x: number; y: number }[] = [];
  for (let i = 0; i < 44; i++) fallen.push({ x: tx + (r() - 0.5) * 460 * u, y: H * (0.8 + r() * 0.18) });
  const paleBark: RGB = oak ? [106, 80, 58] : [226, 220, 208];
  return {
    draw(g, E) {
      wall(g, E);
      fill(g, back, tone(E, 0.66, [46, 76, 58], 0.6));
      fill(g, ground.p, tone(E, 0.72, [66, 86, 58], 0.62));
      if (E.c.snow > 0.2) fill(g, ground.p, [228, 232, 244], 0.6 * E.c.snow);
      fill(g, pool, [10, 10, 16]);
      stroke(g, pool, tone(E, 0.9), 1 * u, 0.5);
      // Mist off the pool.
      for (let i = 0; i < 4; i++) glowAt(g, tx - 240 * u + i * 44 * u, H * 0.88, 70 * u, [216, 220, 230], 0.09);
      fill(g, limbs, lit(E, 0.44, paleBark, 0.92));
      fill(g, trunk, lit(E, 0.32, paleBark, 0.96));
      const on = clamp(E.glow);
      for (const l of leaves) {
        const hue: RGB = oak ? (l.d < 0.5 ? [72, 106, 58] : [96, 124, 66]) : l.d < 0.5 ? [150, 26, 34] : [196, 44, 40];
        g.fillStyle = rgb(mix(tone(E, 0.5), hue, 0.54 + 0.42 * Math.max(E.day, on * 0.5)));
        g.beginPath();
        g.ellipse(l.x, l.y, l.s, l.s * 0.72, l.d * 3, 0, TAU);
        g.fill();
      }
      if (E.c.snow > 0.2) for (let i = 0; i < leaves.length; i += 3) {
        g.fillStyle = rgb([236, 240, 250], 0.76 * E.c.snow);
        g.beginPath();
        g.arc(leaves[i]!.x, leaves[i]!.y - 2 * u, leaves[i]!.s * 0.7, 0, TAU);
        g.fill();
      }
      if (!oak) {
        // The face: deep sad eyes and a long mouth, weeping red sap.
        const fy = H * 0.44;
        g.fillStyle = rgb(mix(tone(E, 0.86), [84, 40, 36], 0.4 + E.day * 0.4));
        for (const s of [-1, 1]) {
          g.beginPath();
          g.ellipse(tx + s * 10 * u, fy, 6 * u, 3 * u, s * 0.28, 0, TAU);
          g.fill();
        }
        g.beginPath();
        g.ellipse(tx, fy + 28 * u, 11 * u, 4.4 * u, 0, 0, TAU);
        g.fill();
        g.strokeStyle = rgb(mix(tone(E, 0.8), [150, 36, 36], 0.5 + E.day * 0.4));
        g.lineWidth = 2 * u;
        g.beginPath();
        for (const s of [-1, 1]) {
          g.moveTo(tx + s * 10 * u, fy + 3 * u);
          g.lineTo(tx + s * 11 * u, fy + 20 * u);
        }
        g.moveTo(tx, fy + 3 * u);
        g.lineTo(tx, fy + 16 * u);
        g.stroke();
      }
      for (const f of fallen) {
        g.fillStyle = rgb(mix(tone(E, 0.7), oak ? [110, 92, 50] : [176, 40, 40], 0.5 + E.day * 0.4), 0.9);
        g.beginPath();
        g.ellipse(f.x, f.y, 4 * u, 2 * u, f.x, 0, TAU);
        g.fill();
      }
      fill(g, near, tone(E, 0.88, [44, 38, 34], 0.5));
      fill(g, canopy, tone(E, 0.84, [36, 62, 48], 0.58));
    },
  };
}

export const CASTLE_ROOMS = { solar, maester, rookery, sept, godswood, bailey, trainingyard, battlements } satisfies Partial<Record<Place, (c: Ctx) => Scene>>;
export const CASTLE_STAIR = spiralstair;
