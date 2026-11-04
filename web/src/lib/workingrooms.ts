/**
 * The rest of a working castle (docs/25-rooms-of-the-keep.md Part 9): where its ladies sew and its
 * servants sleep, where it counts its money and keeps its arms, and how you get in.
 */
import { clamp, DARK, mix, rgb, TAU, WARM, type Ctx, type Env, type Place, type RGB } from "./places";
import { banner, candle, keepLook, keepRoom, opening, outsideOf, reveal, shaft, shell, shields, tapestry, tint, torch, torchlight, tracery, type Look, type Paint } from "./keepbits";
import { fill, fire, glowAt, hillView, poly, stroke, type Scene } from "./scenes";
import { ellipse, rr, shut, steam } from "./scenebits";

type G = CanvasRenderingContext2D;
const IRON: RGB = [52, 50, 56];

function poly2(g: G, ...pts: number[]) {
  const p = new Path2D();
  poly(p, ...pts);
  g.fill(p);
}
function windows(c: Ctx, L: Look, xs: number[], top: number, bottom: number, w: number) {
  const { u, r } = c;
  const win = new Path2D();
  const frame = new Path2D();
  for (const x of xs) {
    opening(win, L, x, top, w, bottom, u, r);
    tracery(frame, L, x, top, w, bottom, u);
  }
  const paint: Paint = (g, E) => {
    reveal(g, E, L, win, u);
    fill(g, frame, tint(E, mix(L.joint, IRON, 0.5), 0.26));
  };
  return { win, paint };
}
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
/** A curved drum of a wall, for a tower: bands narrowing and darkening towards the edges. */
function drum(c: Ctx, cx: number, floor: number) {
  const { W, u } = c;
  const rad = Math.max(W * 0.8, 500 * u);
  const bands: { x: number; w: number; d: number }[] = [];
  for (let t = -1; t < 1; t += 0.05) {
    const x = cx + Math.sin((t * Math.PI) / 2) * rad;
    const x2 = cx + Math.sin(((t + 0.05) * Math.PI) / 2) * rad;
    bands.push({ x, w: x2 - x + 1, d: Math.abs(t) });
  }
  const courses = new Path2D();
  for (let y = 0; y < floor + 30 * u; y += 26 * u) {
    courses.moveTo(0, y + 26 * u);
    courses.quadraticCurveTo(cx, y - 16 * u, W, y + 26 * u);
  }
  return (g: G, E: Env, L: Look) => {
    const stone = tint(E, L.wall, L.night);
    for (const b of bands) {
      g.fillStyle = rgb(mix(stone, DARK, b.d * b.d * 0.62));
      g.fillRect(b.x, 0, b.w, floor);
    }
    stroke(g, courses, tint(E, L.joint, 0.3), 1 * u, 0.5);
  };
}

/** The ladies' solar: a bright window seat with cushions, an embroidery frame on its trestles, a harp. */
function ladysolar(c: Ctx): Scene {
  const { H, u, F } = c;
  const L = keepLook(c);
  const floor = H * 0.84;
  const wx = F - 170 * u;
  const S = shell(c, L, { floor, spring: 0.14, busy: [[wx - 120 * u, wx + 120 * u], [F - 40 * u, F + 200 * u]] });
  const glass = windows(c, L, [wx - 50 * u, wx + 50 * u], H * 0.2, H * 0.6, 84 * u);
  const seat = new Path2D();
  seat.rect(wx - 108 * u, H * 0.6, 216 * u, 9 * u);
  seat.rect(wx - 100 * u, H * 0.63, 200 * u, floor - H * 0.63);
  const cushions = new Path2D();
  for (const d of [-76, -10, 56]) rr(cushions, wx + (d - 24) * u, H * 0.56, 58 * u, 13 * u, 6 * u);
  // The frame: a stretched cloth on two trestles, a pattern half worked.
  const fx = F + 70 * u;
  const fy = H * 0.5;
  const frame = new Path2D();
  frame.rect(fx - 112 * u, fy, 224 * u, 8 * u);
  frame.rect(fx - 112 * u, fy + 66 * u, 224 * u, 8 * u);
  for (const d of [-96, 88]) poly(frame, fx + d * u, fy, fx + (d + 8) * u, fy, fx + (d + 16) * u, H, fx + (d - 8) * u, H);
  const cloth = new Path2D();
  cloth.rect(fx - 100 * u, fy + 8 * u, 200 * u, 58 * u);
  const hx = F + 240 * u;
  const harp = new Path2D();
  harp.moveTo(hx - 26 * u, floor + 4 * u);
  harp.quadraticCurveTo(hx - 34 * u, floor - 70 * u, hx + 22 * u, floor - 120 * u);
  harp.quadraticCurveTo(hx + 34 * u, floor - 74 * u, hx - 18 * u, floor + 4 * u);
  harp.closePath();
  const strings = new Path2D();
  for (let k = 0; k < 7; k++) {
    strings.moveTo(hx - 22 * u + k * 1.8 * u, floor - k * 7 * u);
    strings.lineTo(hx + 22 * u - (6 - k) * 5 * u, floor - 112 * u + (6 - k) * 8 * u);
  }
  return keepRoom(
    c,
    L,
    glass.win,
    hillView(c),
    (g, E) => {
      S.under(g, E);
      glass.paint(g, E);
      for (const d of [-50, 50]) shaft(g, E, wx + (d - 42) * u, wx + (d + 42) * u, H * 0.6, H, 90 * u);
      fill(g, seat, mix(tint(E, L.wall, L.night), [255, 240, 214], 0.12));
      fill(g, cushions, tint(E, L.cloth, 0.42));
      fill(g, harp, tint(E, [176, 136, 76], 0.44));
      stroke(g, strings, tint(E, [226, 214, 180], 0.42), 0.7 * u);
      fill(g, cloth, tint(E, [226, 216, 196], 0.5));
      // The work so far: flowers, then bare linen.
      for (let k = 0; k < 9; k++) {
        g.fillStyle = rgb(tint(E, k % 3 === 2 ? [76, 122, 70] : L.cloth, 0.46));
        g.beginPath();
        g.arc(fx - 84 * u + k * 13 * u, fy + 37 * u + Math.sin(k * 1.4) * 15 * u, 4.4 * u, 0, TAU);
        g.fill();
      }
      fill(g, frame, tint(E, L.wood, 0.38));
      candle(g, E, fx + 112 * u, fy, u, 15, 0.8);
      S.over(g, E);
    },
    floor,
  );
}

/** A tower room: a curved wall, one slit, a narrow bed, a chest. */
function towerroom(c: Ctx): Scene {
  const { H, u, F, r } = c;
  const L = keepLook(c);
  const floor = H * 0.8;
  const cx = F - 100 * u;
  const wall = drum(c, cx, floor);
  const win = new Path2D();
  const sx = F - 40 * u;
  opening(win, L, sx, H * 0.16, 44 * u, H * 0.56, u, r);
  const bx = F + 40 * u;
  const by = floor - 22 * u;
  const bed = new Path2D();
  bed.rect(bx, by, 190 * u, 18 * u);
  bed.rect(bx + 4 * u, by + 18 * u, 8 * u, 30 * u);
  bed.rect(bx + 178 * u, by + 18 * u, 8 * u, 30 * u);
  bed.rect(bx + 176 * u, by - 48 * u, 14 * u, 70 * u);
  const blanket = new Path2D();
  rr(blanket, bx + 2 * u, by - 18 * u, 134 * u, 24 * u, 10 * u);
  const pillow = new Path2D();
  ellipse(pillow, bx + 158 * u, by - 8 * u, 18 * u, 8 * u);
  const chest = new Path2D();
  rr(chest, F - 240 * u, floor - 26 * u, 96 * u, 46 * u, 8 * u);
  const straps = new Path2D();
  for (const d of [-222, -166]) straps.rect(F + d * u, floor - 26 * u, 4 * u, 46 * u);
  const stool = new Path2D();
  stool.rect(F - 100 * u, floor - 20 * u, 34 * u, 5 * u);
  stool.rect(F - 96 * u, floor - 16 * u, 4 * u, 36 * u);
  stool.rect(F - 74 * u, floor - 16 * u, 4 * u, 36 * u);
  return keepRoom(
    c,
    L,
    win,
    hillView(c),
    (g, E) => {
      g.save();
      g.clip(outsideOf(c, win), "evenodd");
      wall(g, E, L);
      g.restore();
      g.fillStyle = rgb(tint(E, L.floor, 0.3));
      g.fillRect(0, floor, c.W, H - floor);
      reveal(g, E, L, win, u);
      shaft(g, E, sx - 22 * u, sx + 22 * u, H * 0.56, H, 60 * u, [226, 232, 255]);
      fill(g, chest, tint(E, L.wood, 0.36));
      fill(g, straps, tint(E, IRON, 0.3));
      fill(g, stool, tint(E, L.wood, 0.36));
      candle(g, E, F - 84 * u, floor - 20 * u, u, 15);
      fill(g, bed, tint(E, L.wood, 0.36));
      fill(g, pillow, tint(E, [222, 212, 190], 0.46));
      fill(g, blanket, tint(E, L.cloth, 0.42));
      torch(g, E, F - 390 * u, H * 0.36, u, 1.1);
    },
    floor,
  );
}

/** A bath chamber: a great wooden tub lined with linen, steam, pails, the fire that heats them. */
function bathchamber(c: Ctx): Scene {
  const { H, u, F } = c;
  const L = keepLook(c);
  const floor = H * 0.84;
  const hx = F + 210 * u;
  const S = shell(c, L, { floor, spring: 0.18, busy: [[F - 190 * u, F + 110 * u], [hx - 95 * u, hx + 95 * u]] });
  const fireplace = hearth(c, L, hx, floor, 120 * u, 88 * u);
  const tx = F - 40 * u;
  const y0 = H * 0.6;
  const tub = new Path2D();
  tub.moveTo(tx - 130 * u, y0);
  tub.lineTo(tx + 130 * u, y0);
  tub.lineTo(tx + 114 * u, H * 0.94);
  tub.lineTo(tx - 114 * u, H * 0.94);
  tub.closePath();
  const staves = new Path2D();
  for (let d = -110; d <= 110; d += 22) {
    staves.moveTo(tx + d * u, y0);
    staves.lineTo(tx + d * 0.88 * u, H * 0.94);
  }
  const hoops = new Path2D();
  hoops.rect(tx - 128 * u, H * 0.68, 256 * u, 5 * u);
  hoops.rect(tx - 120 * u, H * 0.86, 240 * u, 5 * u);
  const linen = new Path2D();
  linen.moveTo(tx - 136 * u, y0 - 3 * u);
  linen.lineTo(tx + 136 * u, y0 - 3 * u);
  linen.lineTo(tx + 132 * u, y0 + 12 * u);
  for (let d = 132; d > -132; d -= 44) linen.quadraticCurveTo(tx + (d - 22) * u, y0 + 26 * u, tx + (d - 44) * u, y0 + 12 * u);
  linen.closePath();
  const water = new Path2D();
  ellipse(water, tx, y0 - 2 * u, 124 * u, 8 * u);
  const pails = new Path2D();
  for (const x of [F + 120 * u, F - 240 * u, F - 300 * u]) poly(pails, x - 19 * u, H * 0.96, x + 19 * u, H * 0.96, x + 24 * u, H * 0.8, x - 24 * u, H * 0.8);
  return keepRoom(
    c,
    L,
    shut(),
    () => {},
    (g, E) => {
      S.under(g, E);
      fireplace(g, E);
      fill(g, water, tint(E, [150, 176, 190], 0.46));
      fill(g, tub, tint(E, L.wood, 0.42));
      stroke(g, staves, DARK, 1.2 * u, 0.3);
      fill(g, hoops, tint(E, IRON, 0.32));
      fill(g, linen, tint(E, [232, 226, 212], 0.54));
      steam(g, E, tx - 50 * u, y0 - 8 * u, u, 7, 26, 0.13);
      steam(g, E, tx + 54 * u, y0 - 8 * u, u, 7, 26, 0.13);
      fill(g, pails, tint(E, L.wood, 0.36));
      S.over(g, E);
      candle(g, E, tx + 134 * u, y0 - 2 * u, u, 14, 0.7);
    },
    floor,
  );
}

/** Servants' quarters: straw pallets in a row under the rafters, and one rushlight in the dark. */
function servantsloft(c: Ctx): Scene {
  const { W, H, u, F, r } = c;
  const L = keepLook(c);
  const floor = H * 0.84;
  const S = shell(c, L, { floor, arches: false, torches: false, dressed: false });
  const rafters = new Path2D();
  const step = 86 * u;
  for (let x = (F % step) - step; x < W + step; x += step) {
    poly(rafters, x - 6 * u, -2, x + 6 * u, -2, x + 74 * u, H * 0.3, x + 62 * u, H * 0.3);
    poly(rafters, x + 6 * u, -2, x - 6 * u, -2, x - 74 * u, H * 0.3, x - 62 * u, H * 0.3);
  }
  const tie = new Path2D();
  tie.rect(-4, H * 0.3, W + 8, 10 * u);
  const roof = new Path2D();
  roof.rect(-4, -2, W + 8, H * 0.3);
  const pallets: { x: number; on: boolean; hue: RGB }[] = [];
  const blankets: RGB[] = [[120, 96, 76], [96, 104, 116], [130, 88, 70], [104, 112, 90]];
  for (let x = F - 40 * u; x > -160 * u; x -= 164 * u) pallets.push({ x, on: r() < 0.6, hue: blankets[(r() * 4) | 0]! });
  for (let x = F + 124 * u; x < W + 80 * u; x += 164 * u) pallets.push({ x, on: r() < 0.6, hue: blankets[(r() * 4) | 0]! });
  const straw = new Path2D();
  for (const p of pallets)
    for (let i = 0; i < 24; i++) {
      const x = p.x - 66 * u + r() * 132 * u;
      const y = H * 0.9 + r() * 12 * u;
      straw.moveTo(x, y);
      straw.lineTo(x + (r() - 0.5) * 14 * u, y + (r() - 0.5) * 4 * u);
    }
  const rx = F - 122 * u;
  const hooks = new Path2D();
  for (let x = (F % (140 * u)) - 140 * u; x < W; x += 140 * u) rr(hooks, x, H * 0.44, 28 * u, 60 * u, 9 * u);
  return keepRoom(
    c,
    L,
    shut(),
    () => {},
    (g, E) => {
      S.under(g, E);
      fill(g, hooks, tint(E, [100, 88, 76], 0.28));
      fill(g, roof, tint(E, mix(L.wood, DARK, 0.55), 0.22));
      fill(g, rafters, tint(E, L.wood, 0.3));
      fill(g, tie, tint(E, L.wood, 0.32));
      for (const p of pallets) {
        g.fillStyle = rgb(tint(E, [168, 142, 88], 0.34));
        const shape = new Path2D();
        rr(shape, p.x - 72 * u, H * 0.88, 144 * u, 24 * u, 11 * u);
        g.fill(shape);
        if (p.on) {
          g.fillStyle = rgb(tint(E, p.hue, 0.34));
          const b = new Path2D();
          rr(b, p.x - 66 * u, H * 0.87, 96 * u, 17 * u, 8 * u);
          g.fill(b);
        }
      }
      stroke(g, straw, tint(E, [186, 160, 96], 0.36), 1.1 * u, 0.7);
      S.over(g, E);
      // One rushlight on a stone.
      const on = torchlight(E);
      g.fillStyle = rgb(tint(E, [120, 110, 100], 0.32));
      g.fillRect(rx - 12 * u, H * 0.82, 24 * u, 14 * u);
      glowAt(g, rx, H * 0.72, 240 * u, WARM, 0.38 * on + 0.1);
      candle(g, E, rx, H * 0.82, u, 20);
    },
    floor,
  );
}

/** An infirmary: a row of plain cots under a vault, herbs hung to dry, a lamp at the far end. */
function infirmary(c: Ctx): Scene {
  const { W, H, u, F, r } = c;
  const L = keepLook(c);
  const floor = H * 0.84;
  const winXs: number[] = [];
  for (let x = F - 95 * u; x > -60 * u; x -= 380 * u) winXs.push(x);
  const S = shell(c, L, { floor, spring: 0.14, torches: false, dressed: false, busy: winXs.map((x) => [x - 60 * u, x + 60 * u] as [number, number]) });
  const glass = windows(c, L, winXs, H * 0.2, H * 0.54, 56 * u);
  const cots: number[] = [];
  for (let x = F + 96 * u; x > -160 * u; x -= 210 * u) cots.push(x);
  if (W > F + 300 * u) cots.push(F + 306 * u);
  const frames = new Path2D();
  const sheets = new Path2D();
  const pillows = new Path2D();
  for (const x of cots) {
    const y = H * 0.78;
    frames.rect(x - 84 * u, y, 168 * u, 7 * u);
    for (const d of [-80, 74]) frames.rect(x + d * u, y, 6 * u, H - y);
    frames.rect(x + 76 * u, y - 36 * u, 8 * u, 40 * u);
    rr(sheets, x - 82 * u, y - 13 * u, 126 * u, 19 * u, 8 * u);
    ellipse(pillows, x + 60 * u, y - 7 * u, 16 * u, 7 * u);
  }
  const pole = new Path2D();
  pole.rect(-4, H * 0.27, W + 8, 3 * u);
  const herbs: { x: number; len: number; c: RGB }[] = [];
  for (let x = 0; x < W; x += (22 + r() * 30) * u) herbs.push({ x, len: (20 + r() * 26) * u, c: r() < 0.7 ? [102, 130, 76] : [160, 120, 130] });
  return keepRoom(
    c,
    L,
    glass.win,
    hillView(c),
    (g, E) => {
      S.under(g, E);
      glass.paint(g, E);
      for (const x of winXs) shaft(g, E, x - 28 * u, x + 28 * u, H * 0.54, H, 66 * u);
      fill(g, pole, tint(E, L.wood, 0.3));
      for (const h of herbs) {
        g.fillStyle = rgb(tint(E, h.c, 0.32));
        poly2(g, h.x - 5 * u, H * 0.28, h.x + 5 * u, H * 0.28, h.x + 1.4 * u, H * 0.28 + h.len, h.x - 1.4 * u, H * 0.28 + h.len);
      }
      fill(g, frames, tint(E, L.wood, 0.38));
      fill(g, sheets, tint(E, [222, 214, 196], 0.46));
      fill(g, pillows, tint(E, [236, 230, 216], 0.5));
      S.over(g, E);
      const lx = F + 190 * u;
      g.fillStyle = rgb(tint(E, L.wood, 0.34));
      g.fillRect(lx - 16 * u, H * 0.66, 32 * u, H * 0.34);
      candle(g, E, lx, H * 0.66, u, 18);
      glowAt(g, lx, H * 0.6, 200 * u, WARM, 0.3 * torchlight(E));
    },
    floor,
  );
}

/** A council chamber: a long table, a row of high-backed chairs, one great chair at its middle. */
function councilroom(c: Ctx): Scene {
  const { H, u, F, r } = c;
  const L = keepLook(c);
  const floor = H * 0.84;
  const S = shell(c, L, { floor, spring: 0.14, busy: [[F - 300 * u, F + 300 * u]] });
  const glass = windows(c, L, [F - 95 * u, F + 95 * u], H * 0.18, H * 0.5, 56 * u);
  const ty = H * 0.66;
  const half = 270 * u;
  const table = new Path2D();
  table.rect(F - half, ty, half * 2, 9 * u);
  for (let d = -240; d <= 240; d += 160) table.rect(F + d * u - 6 * u, ty + 9 * u, 12 * u, H - ty);
  const chairs = new Path2D();
  for (const d of [-224, -152, -80, 80, 152, 224]) {
    chairs.moveTo(F + (d - 19) * u, ty);
    chairs.lineTo(F + (d - 19) * u, ty - 62 * u);
    chairs.quadraticCurveTo(F + d * u, ty - 80 * u, F + (d + 19) * u, ty - 62 * u);
    chairs.lineTo(F + (d + 19) * u, ty);
    chairs.closePath();
  }
  const great = new Path2D();
  great.moveTo(F - 28 * u, ty);
  great.lineTo(F - 28 * u, ty - 98 * u);
  great.quadraticCurveTo(F, ty - 132 * u, F + 28 * u, ty - 98 * u);
  great.lineTo(F + 28 * u, ty);
  great.closePath();
  const papers: { x: number; w: number }[] = [];
  for (const d of [-224, -152, -80, 0, 80, 152, 224]) papers.push({ x: F + d * u + (r() - 0.5) * 12 * u, w: (24 + r() * 12) * u });
  return keepRoom(
    c,
    L,
    glass.win,
    hillView(c),
    (g, E) => {
      S.under(g, E);
      glass.paint(g, E);
      for (const x of [F - 95 * u, F + 95 * u]) shaft(g, E, x - 28 * u, x + 28 * u, H * 0.5, H, 50 * u);
      banner(g, E, L, F, H * 0.1, 66 * u, H * 0.34, u);
      for (const d of [-282, 282]) tapestry(g, E, L, F + d * u, H * 0.17, 74 * u, H * 0.34, u);
      fill(g, chairs, tint(E, L.wood, 0.36));
      fill(g, great, tint(E, mix(L.wood, L.cloth, 0.28), 0.4));
      stroke(g, great, tint(E, L.cloth2, 0.42), 1.8 * u, 0.85);
      fill(g, table, tint(E, L.wood, 0.42));
      for (const p of papers) {
        g.fillStyle = rgb(tint(E, [228, 216, 188], 0.5));
        poly2(g, p.x - p.w / 2, ty, p.x + p.w / 2, ty, p.x + p.w / 2 + 3 * u, ty - 4 * u, p.x - p.w / 2 + 3 * u, ty - 4 * u);
      }
      for (const d of [-188, -116, -40, 40, 116, 188]) candle(g, E, F + d * u, ty, u, 16, 0.7);
      S.over(g, E);
    },
    floor,
  );
}

/** A counting room: shelves of ledgers, a table with scales and stacks of coin, an iron-bound strongbox. */
function countingroom(c: Ctx): Scene {
  const { H, u, F, r } = c;
  const L = keepLook(c);
  const floor = H * 0.84;
  const S = shell(c, L, { floor, spring: 0.14, busy: [[F - 300 * u, F + 200 * u]] });
  const glass = windows(c, L, [F - 240 * u], H * 0.22, H * 0.56, 48 * u);
  const shelves = new Path2D();
  const books: { x: number; y: number; w: number; h: number; c: RGB }[] = [];
  const hues: RGB[] = [[120, 44, 40], [96, 70, 44], [60, 72, 96], [150, 126, 86]];
  for (const y of [H * 0.3, H * 0.44, H * 0.58]) {
    shelves.rect(F - 150 * u, y, 320 * u, 4.4 * u);
    for (let x = F - 146 * u; x < F + 160 * u; ) {
      const w = (9 + r() * 11) * u;
      if (r() > 0.14) books.push({ x, y, w, h: (22 + r() * 16) * u, c: hues[(r() * 4) | 0]! });
      x += w + 1 * u;
    }
  }
  const ty = H * 0.72;
  const table = new Path2D();
  table.rect(F - 170 * u, ty, 330 * u, 8 * u);
  for (const d of [-158, 146]) table.rect(F + d * u, ty + 8 * u, 9 * u, H - ty);
  const box = new Path2D();
  rr(box, F + 190 * u, H * 0.8, 112 * u, 62 * u, 9 * u);
  const straps = new Path2D();
  for (const d of [214, 276]) straps.rect(F + d * u, H * 0.8, 5 * u, 62 * u);
  straps.rect(F + 190 * u, H * 0.84, 112 * u, 4.4 * u);
  straps.rect(F + 238 * u, H * 0.83, 16 * u, 17 * u);
  const stacks = [[-96, 5], [-66, 3], [-44, 7], [-20, 2]] as const;
  const sx = F + 86 * u;
  return keepRoom(
    c,
    L,
    glass.win,
    hillView(c),
    (g, E) => {
      S.under(g, E);
      glass.paint(g, E);
      shaft(g, E, F - 264 * u, F - 216 * u, H * 0.56, H, 60 * u);
      for (const b of books) {
        g.fillStyle = rgb(tint(E, b.c, 0.36));
        g.fillRect(b.x, b.y - b.h, b.w, b.h);
      }
      fill(g, shelves, tint(E, L.wood, 0.38));
      fill(g, table, tint(E, L.wood, 0.42));
      fill(g, box, tint(E, L.wood, 0.4));
      fill(g, straps, tint(E, IRON, 0.32));
      // An open ledger, stacks of coin that catch the light, the scales.
      g.fillStyle = rgb(tint(E, [230, 220, 196], 0.54));
      poly2(g, F - 150 * u, ty, F - 106 * u, ty, F - 102 * u, ty - 7 * u, F - 146 * u, ty - 7 * u);
      for (const [d, n] of stacks)
        for (let k = 0; k < n; k++) {
          g.fillStyle = rgb(mix(tint(E, [206, 166, 80], 0.56), [255, 226, 130], clamp(E.glow) * (k % 2 ? 0.5 : 0.2)));
          g.beginPath();
          g.ellipse(F + d * u, ty - 2 * u - k * 3 * u, 11 * u, 3 * u, 0, 0, TAU);
          g.fill();
        }
      g.strokeStyle = rgb(tint(E, [196, 160, 90], 0.54));
      g.lineWidth = 1.8 * u;
      g.beginPath();
      g.moveTo(sx, ty);
      g.lineTo(sx, ty - 66 * u);
      g.moveTo(sx - 36 * u, ty - 60 * u);
      g.lineTo(sx + 36 * u, ty - 60 * u);
      for (const s of [-1, 1]) {
        g.moveTo(sx + s * 36 * u, ty - 60 * u);
        g.lineTo(sx + s * 36 * u, ty - 30 * u);
      }
      g.stroke();
      for (const s of [-1, 1]) {
        g.fillStyle = rgb(tint(E, [196, 160, 90], 0.54));
        g.beginPath();
        g.ellipse(sx + s * 36 * u, ty - 30 * u, 15 * u, 5 * u, 0, 0, Math.PI);
        g.fill();
      }
      candle(g, E, F + 22 * u, ty, u, 19);
      S.over(g, E);
    },
    floor,
  );
}

/** A guardroom: a rough table with dice, a rack of arms, a low brazier, bunks along the wall. */
function guardroom(c: Ctx): Scene {
  const { W, H, u, F, r } = c;
  const L = keepLook(c);
  const floor = H * 0.84;
  const S = shell(c, L, { floor, spring: 0.24, bay: 210, torches: false, busy: [[F - 340 * u, F + 240 * u]] });
  const ty = H * 0.7;
  const table = new Path2D();
  table.rect(F - 90 * u, ty, 200 * u, 8 * u);
  for (const d of [-78, 90]) poly(table, F + d * u, ty + 8 * u, F + (d + 8) * u, ty + 8 * u, F + (d + 14) * u, H, F + (d - 6) * u, H);
  const benches = new Path2D();
  benches.rect(F - 76 * u, H * 0.84, 172 * u, 6 * u);
  benches.rect(F - 66 * u, H * 0.86, 6 * u, H);
  benches.rect(F + 80 * u, H * 0.86, 6 * u, H);
  const rack = new Path2D();
  const rx = F - 240 * u;
  rack.rect(rx - 86 * u, H * 0.34, 172 * u, 5 * u);
  rack.rect(rx - 86 * u, H * 0.62, 172 * u, 5 * u);
  const spears = new Path2D();
  for (let d = -74; d <= 74; d += 21) {
    spears.rect(rx + d * u - 1.4 * u, H * 0.26, 2.8 * u, floor - H * 0.26);
    poly(spears, rx + d * u - 3.4 * u, H * 0.26, rx + d * u + 3.4 * u, H * 0.26, rx + d * u, H * 0.2);
  }
  const bunks = new Path2D();
  const blankets = new Path2D();
  for (let x = F - 420 * u; x > -200 * u; x -= 230 * u) {
    for (const y of [H * 0.5, H * 0.72]) {
      bunks.rect(x - 96 * u, y, 192 * u, 7 * u);
      rr(blankets, x - 92 * u, y - 13 * u, 130 * u, 15 * u, 6 * u);
    }
    for (const d of [-96, 90]) bunks.rect(x + d * u, H * 0.42, 6 * u, H);
  }
  const dice = Array.from({ length: 3 }, () => ({ x: F - 30 * u + r() * 60 * u, a: r() }));
  const bx = F + 210 * u;
  const brazier = new Path2D();
  poly(brazier, bx - 30 * u, floor - 40 * u, bx + 30 * u, floor - 40 * u, bx + 20 * u, floor - 14 * u, bx - 20 * u, floor - 14 * u);
  brazier.rect(bx - 2.4 * u, floor - 14 * u, 4.8 * u, 28 * u);
  poly(brazier, bx - 22 * u, floor + 14 * u, bx + 22 * u, floor + 14 * u, bx + 4 * u, floor + 4 * u, bx - 4 * u, floor + 4 * u);
  const tankard = new Path2D();
  for (const d of [-64, 76]) rr(tankard, F + d * u, ty - 16 * u, 13 * u, 16 * u, 2 * u);
  return keepRoom(
    c,
    L,
    shut(),
    () => {},
    (g, E) => {
      S.under(g, E);
      shields(g, E, L, F + 20 * u, H * 0.34, u * 1.3);
      fill(g, bunks, tint(E, L.wood, 0.36));
      fill(g, blankets, tint(E, [106, 96, 84], 0.34));
      fill(g, spears, tint(E, [150, 148, 152], 0.36));
      fill(g, rack, tint(E, L.wood, 0.38));
      fill(g, benches, tint(E, L.wood, 0.34));
      fill(g, table, tint(E, L.wood, 0.42));
      fill(g, tankard, tint(E, [146, 140, 134], 0.42));
      for (const d of dice) {
        g.fillStyle = rgb(tint(E, [226, 220, 204], 0.54));
        g.save();
        g.translate(d.x, ty - 3 * u);
        g.rotate(d.a);
        g.fillRect(-3 * u, -3 * u, 6 * u, 6 * u);
        g.restore();
      }
      candle(g, E, F + 96 * u, ty, u, 13, 0.7);
      S.over(g, E);
      fill(g, brazier, tint(E, IRON, 0.32));
      glowAt(g, bx, floor - 50 * u, 230 * u, [255, 130, 56], 0.44);
      fire(g, E, bx - 9 * u, floor - 38 * u, 1 * u);
      fire(g, E, bx + 9 * u, floor - 38 * u, 1.1 * u);
      torch(g, E, F - 370 * u, H * 0.34, u);
      if (W > F + 300 * u) torch(g, E, F + 300 * u, H * 0.34, u);
    },
    floor,
  );
}

/** An armory: spears in their racks, mail on stands, a wall of shields, light down a row of steel. */
function armory(c: Ctx): Scene {
  const { W, H, u, F, r } = c;
  const L = keepLook(c);
  const floor = H * 0.86;
  const S = shell(c, L, { floor, spring: 0.14, bay: 200, torches: false, busy: [[-W, W * 2]] });
  const bay = 200 * u;
  const spears = new Path2D();
  const racks = new Path2D();
  const stands: number[] = [];
  const shieldAt: { x: number; y: number; a: RGB; b: RGB }[] = [];
  const hues: RGB[] = [L.cloth, L.cloth2, [120, 118, 122], [130, 60, 50], [60, 80, 110]];
  for (let k = -8; k < 8; k++) {
    const mid = F + (k + 0.5) * bay;
    if (mid < -bay || mid > W + bay) continue;
    const kind = ((k % 3) + 3) % 3;
    if (kind === 0) {
      racks.rect(mid - 82 * u, H * 0.34, 164 * u, 5 * u);
      racks.rect(mid - 82 * u, floor - 44 * u, 164 * u, 5 * u);
      for (let d = -70; d <= 70; d += 14) {
        spears.rect(mid + d * u - 1.3 * u, H * 0.26, 2.6 * u, floor - H * 0.26);
        poly(spears, mid + d * u - 3.4 * u, H * 0.26, mid + d * u + 3.4 * u, H * 0.26, mid + d * u, H * 0.19);
      }
    } else if (kind === 1) {
      for (const d of [-54, 54]) stands.push(mid + d * u);
    } else {
      for (const row of [0.3, 0.46, 0.62])
        for (const d of [-62, 0, 62]) shieldAt.push({ x: mid + d * u, y: H * row, a: hues[(r() * hues.length) | 0]!, b: hues[(r() * hues.length) | 0]! });
    }
  }
  return keepRoom(
    c,
    L,
    shut(),
    () => {},
    (g, E) => {
      S.under(g, E);
      fill(g, spears, tint(E, [168, 168, 176], 0.4));
      fill(g, racks, tint(E, L.wood, 0.38));
      for (const s of shieldAt) {
        const q = new Path2D();
        q.moveTo(s.x - 22 * u, s.y - 16 * u);
        q.lineTo(s.x + 22 * u, s.y - 16 * u);
        q.lineTo(s.x + 22 * u, s.y + 2 * u);
        q.quadraticCurveTo(s.x + 22 * u, s.y + 15 * u, s.x, s.y + 26 * u);
        q.quadraticCurveTo(s.x - 22 * u, s.y + 15 * u, s.x - 22 * u, s.y + 2 * u);
        q.closePath();
        fill(g, q, tint(E, s.a, 0.38));
        g.save();
        g.clip(q);
        g.fillStyle = rgb(tint(E, s.b, 0.38));
        g.fillRect(s.x, s.y - 18 * u, 24 * u, 46 * u);
        g.restore();
        stroke(g, q, tint(E, [130, 128, 134], 0.34), 2 * u);
      }
      // Hauberks of mail on their crosses, each with a coif.
      for (const x of stands) {
        const y = H * 0.32;
        g.fillStyle = rgb(tint(E, L.wood, 0.34));
        g.fillRect(x - 2.4 * u, y, 4.8 * u, floor - y);
        g.fillRect(x - 42 * u, y + 28 * u, 84 * u, 5 * u);
        const mail = new Path2D();
        mail.moveTo(x - 46 * u, y + 34 * u);
        mail.lineTo(x - 30 * u, y + 24 * u);
        mail.lineTo(x + 30 * u, y + 24 * u);
        mail.lineTo(x + 46 * u, y + 34 * u);
        mail.lineTo(x + 34 * u, y + 66 * u);
        mail.lineTo(x + 30 * u, y + 142 * u);
        mail.lineTo(x - 30 * u, y + 142 * u);
        mail.lineTo(x - 34 * u, y + 66 * u);
        mail.closePath();
        fill(g, mail, tint(E, [136, 136, 146], 0.38));
        g.fillStyle = rgb(tint(E, [136, 136, 146], 0.4));
        g.beginPath();
        g.arc(x, y + 8 * u, 16 * u, 0, TAU);
        g.fill();
        g.strokeStyle = rgb(DARK, 0.26);
        g.lineWidth = 0.8 * u;
        g.beginPath();
        for (let ly = y + 36 * u; ly < y + 142 * u; ly += 7 * u) {
          g.moveTo(x - 30 * u, ly);
          g.lineTo(x + 30 * u, ly);
        }
        g.stroke();
      }
      S.over(g, E);
      for (let k = -8; k < 8; k += 2) {
        const x = F + k * bay;
        if (x > -20 * u && x < W + 20 * u) torch(g, E, x, H * 0.42, u, 1.1);
      }
    },
    floor,
  );
}

/** A gatehouse from within: a great arch, the outside and its weather through a half-raised portcullis, murder holes above. */
function gatehouse(c: Ctx): Scene {
  const { W, H, u, F } = c;
  const L = keepLook(c);
  const floor = H * 0.86;
  const S = shell(c, L, { floor, arches: false, torches: false, dressed: false });
  const hw = 120 * u;
  const spring = H * 0.34;
  const win = new Path2D();
  win.moveTo(F - hw, floor);
  win.lineTo(F - hw, spring);
  win.quadraticCurveTo(F - hw, H * 0.02, F, H * 0.02);
  win.quadraticCurveTo(F + hw, H * 0.02, F + hw, spring);
  win.lineTo(F + hw, floor);
  win.closePath();
  const dropped = H * 0.34;
  const bars = new Path2D();
  for (let x = F - hw + 10 * u; x < F + hw; x += 26 * u) {
    bars.rect(x - 2.4 * u, 0, 4.8 * u, dropped);
    poly(bars, x - 3.6 * u, dropped, x + 3.6 * u, dropped, x, dropped + 15 * u);
  }
  for (let y = H * 0.06; y < dropped; y += 26 * u) bars.rect(F - hw, y, hw * 2, 4 * u);
  const ring = new Path2D();
  ring.addPath(win);
  const road = new Path2D();
  poly(road, F - hw + 6 * u, floor, F + hw - 6 * u, floor, F + hw * 1.9, H + 2, F - hw * 1.9, H + 2);
  const blocks = new Path2D();
  for (let a = Math.PI; a < TAU + 0.01; a += 0.2) {
    blocks.moveTo(F + Math.cos(a) * hw, spring + Math.sin(a) * (spring - H * 0.02));
    blocks.lineTo(F + Math.cos(a) * (hw + 22 * u), spring + Math.sin(a) * (spring - H * 0.02 + 22 * u));
  }
  const niches: number[] = [];
  for (let x = F - 280 * u; x > -40 * u; x -= 230 * u) niches.push(x);
  const slits = new Path2D();
  for (const x of niches) slits.rect(x - 6 * u, H * 0.26, 12 * u, H * 0.26);
  return keepRoom(
    c,
    L,
    win,
    hillView(c),
    (g, E) => {
      S.under(g, E);
      fill(g, road, tint(E, mix(L.floor, [150, 130, 100], 0.4), 0.34));
      g.save();
      g.clip(win);
      fill(g, bars, [28, 26, 30]);
      g.restore();
      stroke(g, ring, mix(tint(E, L.wall, L.night), [255, 240, 214], 0.12), 22 * u);
      stroke(g, blocks, tint(E, L.joint, 0.3), 1.2 * u, 0.55);
      stroke(g, ring, mix(tint(E, L.joint, 0.28), DARK, 0.2), 3 * u);
      fill(g, slits, [12, 10, 12]);
      S.over(g, E);
      for (const s of [-1, 1]) torch(g, E, F + s * (hw + 54 * u), H * 0.44, u, 1.25);
      for (const x of niches) torch(g, E, x + 112 * u, H * 0.42, u);
    },
    floor,
  );
}

/** A wash house: tubs and a stone trough, lines of linen across the room, steam. */
function washhouse(c: Ctx): Scene {
  const { W, H, u, F, r } = c;
  const L = keepLook(c);
  const floor = H * 0.84;
  const S = shell(c, L, { floor, spring: 0.2, bay: 210, torches: false, dressed: false });
  const lines = new Path2D();
  const sheets: { x: number; y: number; w: number; h: number; a: number; c: RGB }[] = [];
  const cloths: RGB[] = [[232, 226, 212], [214, 206, 190], [196, 190, 200], [226, 214, 196]];
  for (const y of [H * 0.2, H * 0.32]) {
    for (let x = -30 * u; x < W + 30 * u; x += 300 * u) {
      lines.moveTo(x, y);
      lines.quadraticCurveTo(x + 150 * u, y + 24 * u, x + 300 * u, y);
      for (let t = 0.08; t < 0.94; t += 0.17 + r() * 0.08) {
        sheets.push({ x: x + 300 * u * t, y: y + 4 * 24 * u * t * (1 - t) * 0.5, w: (24 + r() * 22) * u, h: (44 + r() * 42) * u, a: (r() - 0.5) * 0.05, c: cloths[(r() * 4) | 0]! });
      }
    }
  }
  const tubs: number[] = [];
  for (let x = F - 40 * u; x > -120 * u; x -= 196 * u) tubs.push(x);
  if (W > F + 180 * u) tubs.push(F + 170 * u);
  return keepRoom(
    c,
    L,
    shut(),
    () => {},
    (g, E) => {
      S.under(g, E);
      stroke(g, lines, tint(E, [86, 72, 60], 0.3), 1 * u);
      const T = E.still ? 0 : E.T;
      for (const s of sheets) {
        g.save();
        g.translate(s.x, s.y);
        g.rotate(s.a + Math.sin(T * 0.9 + s.x) * 0.03);
        g.fillStyle = rgb(tint(E, s.c, 0.4));
        g.fillRect(-s.w / 2, 0, s.w, s.h);
        g.fillStyle = rgb(DARK, 0.09);
        g.fillRect(s.w * 0.12, 0, s.w * 0.38, s.h);
        g.restore();
      }
      for (const x of tubs) {
        const y0 = H * 0.76;
        g.fillStyle = rgb(tint(E, L.wood, 0.42));
        poly2(g, x - 62 * u, y0, x + 62 * u, y0, x + 50 * u, H + 2, x - 50 * u, H + 2);
        g.fillStyle = rgb(tint(E, IRON, 0.32));
        g.fillRect(x - 58 * u, H * 0.82, 116 * u, 4 * u);
        g.fillStyle = rgb(tint(E, [156, 176, 186], 0.46));
        g.beginPath();
        g.ellipse(x, y0, 58 * u, 7 * u, 0, 0, TAU);
        g.fill();
        steam(g, E, x, y0 - 6 * u, u, 5, 18, 0.11);
      }
      S.over(g, E);
      torch(g, E, F - 130 * u, H * 0.5, u);
      if (W > F + 260 * u) torch(g, E, F + 270 * u, H * 0.5, u);
      torch(g, E, F - 530 * u, H * 0.5, u);
    },
    floor,
  );
}

/** A buttery: tapped casks on their trestles along the wall, tankards on a shelf, one rushlight. */
function buttery(c: Ctx): Scene {
  const { W, H, u, F, r } = c;
  const L = keepLook(c);
  const floor = H * 0.86;
  const S = shell(c, L, { floor, spring: 0.3, bay: 170, torches: false, dressed: false, busy: [[-W, W * 2]] });
  const casks: { x: number; y: number; s: number }[] = [];
  for (let x = F - 52 * u; x > -120 * u; x -= 104 * u) casks.push({ x, y: H * 0.72, s: 46 * u });
  for (let x = F + 52 * u; x < W + 100 * u; x += 104 * u) casks.push({ x, y: H * 0.72, s: 46 * u });
  const trestle = new Path2D();
  trestle.rect(-4, floor - 8 * u, W + 8, 7 * u);
  for (let x = (F % (104 * u)) - 104 * u; x < W; x += 104 * u) trestle.rect(x, floor - 2 * u, 7 * u, H);
  const shelf = new Path2D();
  shelf.rect(-4, H * 0.32, W + 8, 5 * u);
  const mugs: { x: number; h: number; c: RGB }[] = [];
  for (let x = 6 * u; x < W; x += (18 + r() * 24) * u) mugs.push({ x, h: (14 + r() * 9) * u, c: r() < 0.5 ? [146, 140, 134] : [150, 104, 66] });
  return keepRoom(
    c,
    L,
    shut(),
    () => {},
    (g, E) => {
      S.under(g, E);
      fill(g, shelf, tint(E, L.wood, 0.36));
      for (const m of mugs) {
        g.fillStyle = rgb(tint(E, m.c, 0.42));
        const q = new Path2D();
        rr(q, m.x, H * 0.32 - m.h, 11 * u, m.h, 2 * u);
        g.fill(q);
      }
      fill(g, trestle, tint(E, L.wood, 0.36));
      for (const k of casks) {
        g.fillStyle = rgb(tint(E, L.wood, 0.42));
        g.beginPath();
        g.arc(k.x, k.y, k.s, 0, TAU);
        g.fill();
        g.strokeStyle = rgb(tint(E, IRON, 0.32));
        g.lineWidth = 3.4 * u;
        g.stroke();
        g.lineWidth = 2.4 * u;
        g.beginPath();
        g.arc(k.x, k.y, k.s * 0.68, 0, TAU);
        g.stroke();
        g.fillStyle = rgb(tint(E, [150, 118, 76], 0.46));
        g.fillRect(k.x - 3.4 * u, k.y + k.s * 0.3, 6.8 * u, 11 * u);
        g.fillRect(k.x - 7 * u, k.y + k.s * 0.3 + 3 * u, 14 * u, 3 * u);
      }
      S.over(g, E);
      torch(g, E, F, H * 0.44, u, 1.2);
      torch(g, E, F - 420 * u, H * 0.44, u, 1);
    },
    floor,
  );
}

export const WORKING_ROOMS = { ladysolar, towerroom, bathchamber, servantsloft, infirmary, councilroom, countingroom, guardroom, armory, gatehouse, washhouse, buttery } satisfies Partial<Record<Place, (c: Ctx) => Scene>>;
