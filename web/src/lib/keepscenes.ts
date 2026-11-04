/**
 * The old rooms of a castle, painted again in its own stone (docs/25-rooms-of-the-keep.md Part 2):
 * no plaster, no framed pictures, no sash windows. Each is built on the shell in keepbits.ts, so the
 * bays either side of the room's subject are dressed out to the plate's edges.
 */
import { clamp, DARK, mix, rgb, TAU, type Ctx, type Env, type Place, type RGB } from "./places";
import { banner, candle, keepLook, keepRoom, opening, reveal, shaft, shell, tapestry, tint, torch, torchlight, tracery, type Look, type Paint } from "./keepbits";
import { fill, fire, glowAt, hillView, poly, stroke, type Scene } from "./scenes";
import { ellipse, rr, shut, steam } from "./scenebits";

type G = CanvasRenderingContext2D;
const BLACK_IRON: RGB = [44, 40, 42];

/** Windows at each x, with the sky behind them and light falling in. */
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
    fill(g, frame, tint(E, mix(L.joint, BLACK_IRON, 0.5), 0.26));
  };
  const light = (g: G, E: Env, floor: number) => {
    for (const x of xs) shaft(g, E, x - w / 2, x + w / 2, bottom, floor, 54 * c.u);
  };
  return { win, paint, light };
}

/** A great stone hearth with its fire. */
function hearth(c: Ctx, L: Look, x: number, floor: number, w: number, h: number) {
  const { u } = c;
  const stone = new Path2D();
  stone.rect(x - w / 2, floor - h, w, h);
  stone.rect(x - w / 2 - 9 * u, floor - h - 8 * u, w + 18 * u, 9 * u);
  poly(stone, x - w / 2 + 6 * u, floor - h - 8 * u, x + w / 2 - 6 * u, floor - h - 8 * u, x + w * 0.22, floor - h - 62 * u, x - w * 0.22, floor - h - 62 * u);
  const mouth = new Path2D();
  mouth.moveTo(x - w * 0.34, floor);
  mouth.lineTo(x - w * 0.34, floor - h * 0.5);
  mouth.quadraticCurveTo(x, floor - h * 0.86, x + w * 0.34, floor - h * 0.5);
  mouth.lineTo(x + w * 0.34, floor);
  mouth.closePath();
  const logs = new Path2D();
  rr(logs, x - w * 0.24, floor - 8 * u, w * 0.48, 6 * u, 3 * u);
  rr(logs, x - w * 0.2, floor - 13 * u, w * 0.4, 6 * u, 3 * u);
  return (g: G, E: Env, big = 1) => {
    fill(g, stone, mix(tint(E, L.wall, L.night), [255, 240, 214], 0.05));
    fill(g, mouth, [16, 10, 10]);
    fill(g, logs, [34, 22, 18]);
    glowAt(g, x, floor - 18 * u, (210 + 90 * torchlight(E)) * u * big, [255, 140, 62], 0.3 + 0.22 * torchlight(E));
    fire(g, E, x - w * 0.09, floor - 8 * u, 1.3 * u * big);
    fire(g, E, x + w * 0.09, floor - 8 * u, 1.05 * u * big);
    fire(g, E, x, floor - 8 * u, 1.6 * u * big);
  };
}

/** Meals are laid at dinner and at supper. */
const mealtime = (E: Env) => (E.t >= 11 && E.t < 14) || (E.t >= 17 && E.t < 22);

// ---------- The great hall ----------

function hall(c: Ctx): Scene {
  const { W, H, u, F, r } = c;
  const L = keepLook(c);
  const floor = H * 0.84;
  const dx = F;
  const hx = F - 475 * u;
  const winXs = [F + 285 * u, F - 285 * u, F - 665 * u, F - 1045 * u].filter((x) => x > -60 * u && x < W + 60 * u);
  const S = shell(c, L, { floor, busy: [[F - 190 * u, F + 190 * u], [hx - 95 * u, hx + 95 * u], ...winXs.map((x) => [x - 60 * u, x + 60 * u] as [number, number])] });
  const glass = windows(c, L, winXs, H * 0.24, H * 0.62, 52 * u);
  const fireplace = hearth(c, L, hx, floor, 130 * u, 96 * u);
  // A dais, the high table in cloth, the seat behind it under two banners.
  const dais = new Path2D();
  for (let k = 0; k < 3; k++) dais.rect(dx - (178 - k * 13) * u, floor - (k + 1) * 8 * u + 8 * u, (356 - k * 26) * u, 8 * u);
  const dt = floor - 16 * u;
  const seat = new Path2D();
  seat.moveTo(dx - 21 * u, dt);
  seat.lineTo(dx - 21 * u, dt - 104 * u);
  seat.quadraticCurveTo(dx - 16 * u, dt - 128 * u, dx, dt - 136 * u);
  seat.quadraticCurveTo(dx + 16 * u, dt - 128 * u, dx + 21 * u, dt - 104 * u);
  seat.lineTo(dx + 21 * u, dt);
  seat.closePath();
  const chairs = new Path2D();
  for (const s of [-100, -58, 58, 100]) rr(chairs, dx + (s - 11) * u, dt - 72 * u, 22 * u, 72 * u, 3 * u);
  const board = new Path2D();
  board.rect(dx - 150 * u, dt - 46 * u, 300 * u, 6 * u);
  const cloth = new Path2D();
  cloth.moveTo(dx - 150 * u, dt - 40 * u);
  cloth.lineTo(dx + 150 * u, dt - 40 * u);
  cloth.lineTo(dx + 150 * u, dt - 14 * u);
  for (let x = 150; x > -150; x -= 25) cloth.quadraticCurveTo(dx + (x - 12.5) * u, dt - 8 * u, dx + (x - 25) * u, dt - 14 * u);
  cloth.closePath();
  const legs = new Path2D();
  for (const s of [-138, 132]) legs.rect(dx + s * u, dt - 14 * u, 6 * u, 14 * u);
  // Long trestles down the hall, side on, out to the plate's edge.
  const ty = floor - 34 * u;
  const trestles = new Path2D();
  const benches = new Path2D();
  const settings: number[] = [];
  const x0 = F - 196 * u;
  for (let x = x0; x > -160 * u; x -= 330 * u) {
    const from = x - 300 * u;
    trestles.rect(from, ty, 300 * u, 6.5 * u);
    for (const lx of [from + 22 * u, from + 266 * u]) poly(trestles, lx, ty + 6 * u, lx + 12 * u, ty + 6 * u, lx + 18 * u, floor + 12 * u, lx - 6 * u, floor + 12 * u);
    benches.rect(from + 10 * u, floor - 3 * u, 280 * u, 5 * u);
    for (const bx of [from + 28 * u, from + 262 * u]) benches.rect(bx, floor + 2 * u, 5 * u, 14 * u);
    for (let s = from + 26 * u; s < x - 20 * u; s += (34 + r() * 16) * u) settings.push(s);
  }
  const view = hillView(c);
  return keepRoom(
    c,
    L,
    glass.win,
    view,
    (g, E) => {
      S.under(g, E);
      glass.paint(g, E);
      for (const s of [-72, 72]) banner(g, E, L, dx + s * u, H * 0.13, 56 * u, H * 0.42, u);
      fireplace(g, E);
      glass.light(g, E, floor);
      fill(g, dais, tint(E, mix(L.floor, L.wall, 0.5), 0.32));
      fill(g, chairs, tint(E, L.wood, 0.32));
      fill(g, seat, tint(E, mix(L.wood, L.cloth, 0.3), 0.36));
      stroke(g, seat, tint(E, L.cloth2, 0.36), 1.8 * u, 0.85);
      fill(g, legs, tint(E, L.wood, 0.3));
      fill(g, board, tint(E, L.wood, 0.36));
      fill(g, cloth, tint(E, [226, 216, 196], 0.42));
      const laid = mealtime(E);
      fill(g, trestles, tint(E, L.wood, 0.34));
      fill(g, benches, tint(E, mix(L.wood, DARK, 0.2), 0.3));
      if (laid) {
        for (const x of settings) {
          g.fillStyle = rgb(tint(E, [186, 176, 158], 0.42));
          g.beginPath();
          g.ellipse(x, ty - 1 * u, 9 * u, 2.2 * u, 0, 0, TAU);
          g.fill();
          g.fillStyle = rgb(tint(E, [190, 150, 80], 0.46));
          g.fillRect(x + 12 * u, ty - 11 * u, 3.5 * u, 11 * u);
        }
        for (const s of [-110, -40, 40, 110]) {
          g.fillStyle = rgb(tint(E, [200, 164, 92], 0.5));
          g.fillRect(dx + s * u - 2 * u, dt - 58 * u, 4 * u, 12 * u);
        }
        // The roast on the high table.
        g.fillStyle = rgb(tint(E, [150, 96, 50], 0.5));
        g.beginPath();
        g.ellipse(dx, dt - 54 * u, 20 * u, 9 * u, 0, 0, TAU);
        g.fill();
      }
      for (const s of [-130, 130]) candle(g, E, dx + s * u, dt - 46 * u, u, 16);
      if (laid) for (let i = 0; i < settings.length; i += 4) candle(g, E, settings[i]! - 12 * u, ty, u, 11);
      S.over(g, E);
      for (const s of [-172, 172]) torch(g, E, dx + s * u, H * 0.44, u, 1.1);
    },
    floor,
  );
}

// ---------- The study ----------

function study(c: Ctx): Scene {
  const { W, H, u, F, r } = c;
  const L = keepLook(c);
  const floor = H * 0.84;
  const wx = F - 95 * u;
  const hx = F + 225 * u;
  const S = shell(c, L, { floor, busy: [[F - 190 * u, F + 76 * u], [hx - 95 * u, hx + 95 * u]] });
  const glass = windows(c, L, [wx], H * 0.22, H * 0.58, 92 * u);
  const fireplace = hearth(c, L, hx, floor, 110 * u, 84 * u);
  // A shelf of rolled letters and ledgers.
  const shelf = new Path2D();
  const scrolls: { x: number; y: number; hue: RGB }[] = [];
  const bx = F + 12 * u;
  for (const y of [H * 0.3, H * 0.42]) {
    shelf.rect(bx - 14 * u, y, 92 * u, 4 * u);
    for (let x = bx - 8 * u; x < bx + 74 * u; x += (9 + r() * 5) * u) scrolls.push({ x, y, hue: r() < 0.6 ? [216, 202, 170] : L.cloth });
  }
  // The table, a tall chair, letters, ink and a stool of ledgers.
  const ty = H * 0.62;
  const table = new Path2D();
  table.rect(F - 158 * u, ty, 232 * u, 8 * u);
  for (const x of [F - 148 * u, F + 58 * u]) poly(table, x, ty + 8 * u, x + 8 * u, ty + 8 * u, x + 12 * u, floor + 6 * u, x - 4 * u, floor + 6 * u);
  table.rect(F - 146 * u, ty + 40 * u, 210 * u, 4 * u);
  const chair = new Path2D();
  rr(chair, F - 62 * u, ty - 58 * u, 30 * u, floor - ty + 62 * u, 4 * u);
  const papers = new Path2D();
  poly(papers, F - 130 * u, ty, F - 96 * u, ty, F - 90 * u, ty - 3 * u, F - 124 * u, ty - 3 * u);
  poly(papers, F - 20 * u, ty, F + 22 * u, ty, F + 26 * u, ty - 3 * u, F - 16 * u, ty - 3 * u);
  const chest = new Path2D();
  rr(chest, F - 340 * u, floor - 40 * u, 92 * u, 42 * u, 8 * u);
  const straps = new Path2D();
  for (const x of [F - 322 * u, F - 272 * u]) straps.rect(x, floor - 40 * u, 4 * u, 42 * u);
  const view = hillView(c);
  return keepRoom(
    c,
    L,
    glass.win,
    view,
    (g, E) => {
      S.under(g, E);
      glass.paint(g, E);
      glass.light(g, E, floor);
      fireplace(g, E, 0.85);
      fill(g, shelf, tint(E, L.wood, 0.3));
      for (const s of scrolls) {
        g.fillStyle = rgb(tint(E, s.hue, 0.34));
        g.fillRect(s.x, s.y - 16 * u, 6 * u, 16 * u);
      }
      fill(g, chest, tint(E, L.wood, 0.32));
      fill(g, straps, tint(E, BLACK_IRON, 0.3));
      fill(g, chair, tint(E, mix(L.wood, DARK, 0.15), 0.3));
      fill(g, table, tint(E, L.wood, 0.36));
      fill(g, papers, tint(E, [226, 214, 186], 0.46));
      g.fillStyle = rgb(tint(E, [36, 32, 44], 0.3));
      g.fillRect(F - 8 * u, ty - 9 * u, 7 * u, 9 * u);
      g.strokeStyle = rgb(tint(E, [226, 220, 210], 0.45));
      g.lineWidth = 1 * u;
      g.beginPath();
      g.moveTo(F - 4 * u, ty - 8 * u);
      g.lineTo(F + 4 * u, ty - 26 * u);
      g.stroke();
      candle(g, E, F + 46 * u, ty, u, 18);
      candle(g, E, F - 74 * u, ty, u, 14);
      S.over(g, E);
    },
    floor,
  );
}

// ---------- The dungeon ----------

function dungeon(c: Ctx): Scene {
  const { W, H, u, F, r } = c;
  const L = keepLook(c);
  const floor = H * 0.86;
  const wx = F + 40 * u;
  const dx = F - 170 * u;
  const S = shell(c, L, { floor, arches: false, torches: false, dressed: false, busy: [[dx - 60 * u, dx + 60 * u], [wx - 40 * u, wx + 40 * u]] });
  // A hatch of barred sky up in the wall.
  const win = new Path2D();
  win.rect(wx - 26 * u, H * 0.15, 52 * u, 34 * u);
  const bars = new Path2D();
  for (let x = wx - 18 * u; x < wx + 24 * u; x += 11 * u) bars.rect(x, H * 0.15, 3 * u, 34 * u);
  bars.rect(wx - 26 * u, H * 0.15 + 15 * u, 52 * u, 3 * u);
  // An iron-bound door.
  const door = new Path2D();
  door.moveTo(dx - 40 * u, floor);
  door.lineTo(dx - 40 * u, floor - 118 * u);
  door.quadraticCurveTo(dx - 38 * u, floor - 152 * u, dx, floor - 160 * u);
  door.quadraticCurveTo(dx + 38 * u, floor - 152 * u, dx + 40 * u, floor - 118 * u);
  door.lineTo(dx + 40 * u, floor);
  door.closePath();
  const planks = new Path2D();
  for (let x = dx - 26 * u; x < dx + 34 * u; x += 16 * u) {
    planks.moveTo(x, floor);
    planks.lineTo(x, floor - 150 * u);
  }
  const iron = new Path2D();
  for (const y of [floor - 30 * u, floor - 92 * u]) iron.rect(dx - 40 * u, y, 80 * u, 7 * u);
  iron.rect(dx - 15 * u, floor - 130 * u, 30 * u, 17 * u);
  const hatch = new Path2D();
  for (let x = dx - 10 * u; x < dx + 12 * u; x += 7 * u) hatch.rect(x, floor - 130 * u, 2.4 * u, 17 * u);
  // Chains and a ring on the wall, a heap of straw, a bucket and a stone bench.
  const chains = new Path2D();
  for (const x of [F + 150 * u, F - 420 * u]) {
    for (let k = 0; k < 8; k++) {
      chains.moveTo(x + 3 * u + Math.sin(k) * 2 * u, H * 0.3 + k * 11 * u);
      chains.ellipse(x + Math.sin(k) * 2 * u, H * 0.3 + k * 11 * u, 3 * u, 5.5 * u, 0, 0, TAU);
    }
  }
  const straw = new Path2D();
  for (let i = 0; i < 80; i++) {
    const x = F + 40 * u + r() * 150 * u;
    const y = floor + 2 * u + r() * 16 * u;
    straw.moveTo(x, y);
    straw.lineTo(x + (r() - 0.5) * 20 * u, y - r() * 8 * u);
  }
  const bucket = new Path2D();
  poly(bucket, F - 60 * u, floor + 12 * u, F - 26 * u, floor + 12 * u, F - 30 * u, floor - 18 * u, F - 56 * u, floor - 18 * u);
  const bench = new Path2D();
  for (let x = F - 280 * u; x > -200 * u; x -= 340 * u) {
    bench.rect(x - 120 * u, floor - 34 * u, 120 * u, 11 * u);
    bench.rect(x - 112 * u, floor - 24 * u, 14 * u, 26 * u);
    bench.rect(x - 22 * u, floor - 24 * u, 14 * u, 26 * u);
  }
  const torchX = dx + 74 * u;
  return keepRoom(
    c,
    L,
    win,
    hillView(c),
    (g, E) => {
      S.under(g, E);
      reveal(g, E, L, win, u);
      fill(g, bars, BLACK_IRON);
      shaft(g, E, wx - 26 * u, wx + 26 * u, H * 0.15 + 34 * u, floor + 10 * u, -94 * u, [224, 232, 255]);
      fill(g, bench, tint(E, mix(L.floor, L.wall, 0.5), 0.32));
      fill(g, door, tint(E, L.wood, 0.3));
      stroke(g, planks, DARK, 1.4 * u, 0.55);
      fill(g, iron, tint(E, BLACK_IRON, 0.3));
      fill(g, hatch, [10, 8, 10]);
      stroke(g, door, tint(E, mix(L.wall, [255, 240, 214], 0.12), L.night), 7 * u);
      stroke(g, chains, tint(E, [96, 92, 96], 0.32), 1.3 * u);
      fill(g, bucket, tint(E, L.wood, 0.28));
      g.fillStyle = rgb(tint(E, BLACK_IRON, 0.3));
      g.fillRect(F - 58 * u, floor - 8 * u, 32 * u, 2.6 * u);
      stroke(g, straw, tint(E, [186, 160, 90], 0.34), 1.3 * u, 0.7);
      S.over(g, E);
      torch(g, E, torchX, H * 0.44, u);
      torch(g, E, F - 320 * u, H * 0.42, u, 0.9);
      if (W > F + 300 * u) torch(g, E, F + 280 * u, H * 0.42, u, 0.9);
    },
    floor,
  );
}

// ---------- The kitchen ----------

function kitchen(c: Ctx): Scene {
  const { H, u, F, r } = c;
  const L = keepLook(c);
  const floor = H * 0.86;
  const hx = F - 95 * u;
  const wx = F + 180 * u;
  const hx2 = F - 665 * u;
  const S = shell(c, L, { floor, busy: [[F - 285 * u, F + 95 * u], [wx - 60 * u, wx + 60 * u], [hx2 - 110 * u, hx2 + 110 * u], [F - 475 * u - 95 * u, F - 475 * u + 95 * u]] });
  const glass = windows(c, L, [wx], H * 0.24, H * 0.54, 56 * u);
  const fireplace = hearth(c, L, hx, floor, 196 * u, 124 * u);
  const fireplace2 = hearth(c, L, hx2, floor, 150 * u, 100 * u);
  // A spit across the fire with a roast turning, and a cauldron on its chain.
  const spit = new Path2D();
  spit.rect(hx - 88 * u, floor - 52 * u, 176 * u, 2.6 * u);
  spit.rect(hx - 90 * u, floor - 56 * u, 5 * u, 56 * u);
  spit.rect(hx + 85 * u, floor - 56 * u, 5 * u, 56 * u);
  const roast = new Path2D();
  roast.ellipse(hx - 30 * u, floor - 51 * u, 32 * u, 15 * u, 0.04, 0, TAU);
  const pot = new Path2D();
  pot.moveTo(hx + 62 * u, floor - 34 * u);
  pot.arc(hx + 40 * u, floor - 34 * u, 22 * u, 0, Math.PI);
  pot.closePath();
  pot.rect(hx + 16 * u, floor - 37 * u, 48 * u, 4 * u);
  pot.rect(hx + 39 * u, floor - 96 * u, 2 * u, 60 * u);
  // Game and herbs hung from a pole under the vault.
  const pole = new Path2D();
  pole.rect(F - 470 * u, H * 0.17, 330 * u, 3.6 * u);
  const game: { x: number; len: number; hue: RGB; w: number }[] = [];
  for (let x = F - 454 * u; x < F - 150 * u; x += (24 + r() * 26) * u) {
    const herb = r() < 0.5;
    game.push({ x, len: (herb ? 26 + r() * 18 : 46 + r() * 22) * u, hue: herb ? [100, 136, 68] : r() < 0.5 ? [132, 92, 58] : [172, 148, 110], w: (herb ? 5 : 8) * u });
  }
  // A long board with loaves, a jug, a cleaver; barrels and sacks along the wall.
  const ty = H * 0.68;
  const board = new Path2D();
  board.rect(F - 500 * u, ty, 300 * u, 9 * u);
  for (const x of [F - 486 * u, F - 226 * u]) board.rect(x, ty + 9 * u, 10 * u, floor - ty - 3 * u);
  const breads: { x: number; w: number }[] = [-470, -430, -392].map((x) => ({ x: F + x * u, w: (16 + r() * 5) * u }));
  const barrels = new Path2D();
  for (const x of [F + 104 * u, F + 150 * u]) {
    barrels.moveTo(x - 17 * u, floor + 4 * u);
    barrels.quadraticCurveTo(x - 25 * u, floor - 26 * u, x - 17 * u, floor - 56 * u);
    barrels.lineTo(x + 17 * u, floor - 56 * u);
    barrels.quadraticCurveTo(x + 25 * u, floor - 26 * u, x + 17 * u, floor + 4 * u);
    barrels.closePath();
  }
  const hoops = new Path2D();
  for (const x of [F + 104 * u, F + 150 * u]) for (const y of [floor - 44 * u, floor - 8 * u]) hoops.rect(x - 22 * u, y, 44 * u, 3 * u);
  return keepRoom(
    c,
    L,
    glass.win,
    hillView(c),
    (g, E) => {
      S.under(g, E);
      glass.paint(g, E);
      glass.light(g, E, floor);
      fireplace(g, E, 1.1);
      fireplace2(g, E, 0.9);
      fill(g, roast, tint(E, [146, 88, 44], 0.62));
      fill(g, spit, BLACK_IRON);
      fill(g, pot, [22, 20, 22]);
      steam(g, E, hx + 40 * u, floor - 44 * u, u, 4, 12, 0.08);
      fill(g, pole, tint(E, L.wood, 0.32));
      for (const h of game) {
        g.fillStyle = rgb(tint(E, h.hue, 0.34));
        g.fillRect(h.x - 0.6 * u, H * 0.17, 1.2 * u, 12 * u);
        g.beginPath();
        g.ellipse(h.x, H * 0.17 + 12 * u + h.len / 2, h.w, h.len / 2, 0, 0, TAU);
        g.fill();
      }
      fill(g, barrels, tint(E, L.wood, 0.34));
      fill(g, hoops, tint(E, BLACK_IRON, 0.3));
      fill(g, board, tint(E, L.wood, 0.38));
      g.fillStyle = rgb(tint(E, [206, 148, 80], 0.56));
      for (const b of breads) {
        g.beginPath();
        g.ellipse(b.x, ty, b.w, 11 * u, 0, Math.PI, TAU);
        g.fill();
      }
      g.fillStyle = rgb(tint(E, [150, 110, 72], 0.46));
      rrFill(g, F - 330 * u, ty - 28 * u, 22 * u, 28 * u, 5 * u);
      candle(g, E, F - 268 * u, ty, u, 15);
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

// ---------- The chapel ----------

const GLASS: RGB[] = [
  [190, 40, 56],
  [42, 84, 180],
  [214, 164, 50],
  [46, 130, 92],
  [130, 60, 150],
];

function chapel(c: Ctx): Scene {
  const { W, H, u, F, r } = c;
  const L = keepLook(c);
  const floor = H * 0.84;
  const xs = [F - 95 * u, F + 95 * u];
  const others: number[] = [];
  for (let x = F - 475 * u; x > -60 * u; x -= 380 * u) others.push(x);
  if (W > F + 300 * u) others.push(F + 285 * u);
  const S = shell(c, L, { floor, spring: 0.16, busy: [[F - 190 * u, F + 190 * u], ...others.map((x) => [x - 60 * u, x + 60 * u] as [number, number])] });
  const win = new Path2D();
  const panesOf: { x: number; y: number; w: number; h: number; hue: RGB }[] = [];
  const lead = new Path2D();
  for (const [i, x] of [...xs, ...others].entries()) {
    const w = 64 * u;
    const top = H * 0.2;
    const bot = H * 0.62;
    opening(win, { ...L, masonry: "ashlar" }, x, top, w, bot, u, r);
    for (let y = top; y < bot; y += 21 * u) for (let px = x - w / 2; px < x + w / 2; px += 16 * u) panesOf.push({ x: px, y, w: 16 * u, h: 21 * u, hue: GLASS[(r() * GLASS.length + i) % GLASS.length | 0]! });
    tracery(lead, { ...L, masonry: "ashlar" }, x, top, w, bot, u);
    for (let lx = x - w / 2 + 16 * u; lx < x + w / 2; lx += 16 * u) lead.rect(lx - 0.5 * u, top, 1 * u, bot - top);
  }
  // An altar on two steps, candles banked either side, and rows of benches out to the left.
  const steps = new Path2D();
  steps.rect(F - 124 * u, floor - 8 * u, 248 * u, 8 * u);
  steps.rect(F - 100 * u, floor - 16 * u, 200 * u, 8 * u);
  const altar = new Path2D();
  altar.rect(F - 62 * u, floor - 58 * u, 124 * u, 42 * u);
  altar.rect(F - 70 * u, floor - 62 * u, 140 * u, 5 * u);
  const cloth = new Path2D();
  cloth.rect(F - 30 * u, floor - 58 * u, 60 * u, 42 * u);
  const pews = new Path2D();
  for (let x = F - 180 * u; x > -120 * u; x -= 86 * u) {
    pews.rect(x - 72 * u, floor - 18 * u, 72 * u, 5 * u);
    pews.rect(x - 72 * u, floor - 38 * u, 72 * u, 14 * u);
    pews.rect(x - 8 * u, floor - 42 * u, 7 * u, 48 * u);
    pews.rect(x - 72 * u, floor - 42 * u, 7 * u, 48 * u);
  }
  return keepRoom(
    c,
    L,
    win,
    hillView(c),
    (g, E) => {
      S.under(g, E);
      reveal(g, E, L, win, u);
      // Coloured glass, brightest with the sun behind it, a glimmer of the fires at night.
      const b = clamp(0.28 + E.day * 0.62 * (1 - E.c.cloud * 0.35));
      g.save();
      g.clip(win);
      for (const p of panesOf) {
        g.fillStyle = rgb(mix(DARK, p.hue, b), 0.92);
        g.fillRect(p.x, p.y, p.w, p.h);
      }
      fill(g, lead, [24, 20, 24]);
      g.restore();
      // Its colours on the air and the floor.
      if (E.day > 0.15)
        for (const [i, x] of xs.entries()) {
          g.fillStyle = rgb(GLASS[i * 2]!, 0.1 * E.day * (1 - E.c.cloud * 0.6));
          g.beginPath();
          g.moveTo(x - 32 * u, H * 0.62);
          g.lineTo(x + 32 * u, H * 0.62);
          g.lineTo(x + 90 * u, H);
          g.lineTo(x + 10 * u, H);
          g.fill();
        }
      fill(g, pews, tint(E, L.wood, 0.32));
      fill(g, steps, tint(E, mix(L.floor, L.wall, 0.5), 0.34));
      fill(g, altar, tint(E, mix(L.wall, [240, 230, 214], 0.3), 0.4));
      fill(g, cloth, tint(E, L.cloth, 0.36));
      g.fillStyle = rgb(tint(E, L.cloth2, 0.42));
      g.fillRect(F - 30 * u, floor - 52 * u, 60 * u, 3 * u);
      for (const [dx, h] of [[-52, 16], [-30, 20], [30, 20], [52, 16]] as const) candle(g, E, F + dx * u, floor - 62 * u, u, h);
      for (const s of [-1, 1])
        for (let k = 0; k < 5; k++) {
          const x = F + s * (84 + k * 11) * u;
          const y = floor - 16 * u + (k % 2 ? 8 * u : 0);
          candle(g, E, x, y, u, 7 + (k % 3) * 4, 0.42);
        }
      S.over(g, E);
    },
    floor,
  );
}

// ---------- The cellar ----------

function cellar(c: Ctx): Scene {
  const { W, H, u, F, r } = c;
  const L = keepLook(c);
  const floor = H * 0.84;
  const S = shell(c, L, { floor, spring: 0.34, bay: 230, torches: false, busy: [[-W, W * 2]] });
  // Great tuns on cradles in each bay, stacked casks between them.
  const tuns: { x: number; rad: number }[] = [];
  const casks: { x: number; y: number; rad: number }[] = [];
  for (let x = F - 115 * u; x > -200 * u; x -= 230 * u) tuns.push({ x, rad: 72 * u });
  for (let x = F + 115 * u; x < W + 200 * u; x += 230 * u) tuns.push({ x, rad: 72 * u });
  for (const t of tuns)
    for (const s of [-1, 1]) {
      casks.push({ x: t.x + s * 92 * u, y: floor - 13 * u, rad: 15 * u });
    }
  const win = shut();
  const draw = (g: G, E: Env, t: { x: number; rad: number }) => {
    const y = floor - t.rad - 12 * u;
    const wood = tint(E, L.wood, 0.36);
    g.fillStyle = rgb(tint(E, mix(L.wood, DARK, 0.25), 0.3));
    g.fillRect(t.x - t.rad * 0.72, floor - 22 * u, t.rad * 1.44, 24 * u);
    g.fillStyle = rgb(wood);
    g.beginPath();
    g.arc(t.x, y, t.rad, 0, TAU);
    g.fill();
    g.strokeStyle = rgb(tint(E, BLACK_IRON, 0.3));
    g.lineWidth = 4 * u;
    g.beginPath();
    g.arc(t.x, y, t.rad - 2 * u, 0, TAU);
    g.stroke();
    g.lineWidth = 1.2 * u;
    g.strokeStyle = rgb(DARK, 0.4);
    g.beginPath();
    for (const dy of [-44, -22, 0, 22, 44]) {
      const half = Math.sqrt(Math.max(0, (t.rad - 4 * u) ** 2 - (dy * u) ** 2));
      g.moveTo(t.x - half, y + dy * u);
      g.lineTo(t.x + half, y + dy * u);
    }
    g.stroke();
    g.fillStyle = rgb(tint(E, [150, 118, 76], 0.4));
    g.fillRect(t.x - 4 * u, y + t.rad - 20 * u, 8 * u, 13 * u);
  };
  const torches = tuns.filter((_, i) => i % 2 === 0).map((t) => t.x + 115 * u);
  return keepRoom(
    c,
    L,
    win,
    () => {},
    (g, E) => {
      S.under(g, E);
      for (const k of casks) {
        g.fillStyle = rgb(tint(E, L.wood, 0.32));
        g.beginPath();
        g.arc(k.x, k.y, k.rad, 0, TAU);
        g.fill();
        g.strokeStyle = rgb(tint(E, BLACK_IRON, 0.3));
        g.lineWidth = 2 * u;
        g.stroke();
      }
      for (const t of tuns) draw(g, E, t);
      S.over(g, E);
      for (const x of torches) torch(g, E, x, H * 0.44, u, 1.1);
      torch(g, E, F, H * 0.44, u, 1.15);
    },
    floor,
  );
}

// ---------- Bedchambers ----------

/** A stone window seat with shutters thrown back. */
function shutters(g: G, E: Env, L: Look, x: number, top: number, w: number, bottom: number, u: number) {
  const wood = tint(E, L.wood, 0.34);
  g.fillStyle = rgb(wood);
  g.fillRect(x - w / 2 - 22 * u, top + 12 * u, 18 * u, bottom - top - 12 * u);
  g.fillRect(x + w / 2 + 4 * u, top + 12 * u, 18 * u, bottom - top - 12 * u);
  g.fillStyle = rgb(tint(E, mix(L.wall, [240, 230, 214], 0.2), 0.36));
  g.fillRect(x - w / 2 - 8 * u, bottom, w + 16 * u, 7 * u);
}

function bedroom(c: Ctx): Scene {
  const { H, u, F } = c;
  const L = keepLook(c);
  const floor = H * 0.84;
  const wx = F - 150 * u;
  const S = shell(c, L, { floor, spring: 0.18, busy: [[F - 285 * u, F + 150 * u]] });
  const glass = windows(c, L, [wx], H * 0.24, H * 0.58, 58 * u);
  const by = floor - 36 * u;
  const frame = new Path2D();
  frame.rect(F - 70 * u, by, 196 * u, 22 * u);
  frame.rect(F - 66 * u, by + 22 * u, 10 * u, floor - by - 18 * u);
  frame.rect(F + 110 * u, by + 22 * u, 10 * u, floor - by - 18 * u);
  frame.rect(F + 108 * u, by - 56 * u, 16 * u, floor - by + 60 * u);
  const blanket = new Path2D();
  blanket.moveTo(F - 76 * u, by + 26 * u);
  blanket.quadraticCurveTo(F - 80 * u, by - 12 * u, F - 40 * u, by - 14 * u);
  blanket.lineTo(F + 66 * u, by - 12 * u);
  blanket.lineTo(F + 66 * u, by + 28 * u);
  blanket.closePath();
  const pillow = new Path2D();
  pillow.ellipse(F + 84 * u, by - 8 * u, 24 * u, 10 * u, 0, 0, TAU);
  const fold = new Path2D();
  fold.moveTo(F + 66 * u, by - 12 * u);
  fold.lineTo(F + 66 * u, by + 28 * u);
  fold.lineTo(F + 42 * u, by + 28 * u);
  fold.lineTo(F + 42 * u, by - 13 * u);
  fold.closePath();
  const chest = new Path2D();
  rr(chest, F - 176 * u, floor - 34 * u, 80 * u, 36 * u, 7 * u);
  const stool = new Path2D();
  stool.rect(F + 130 * u, by + 2 * u, 28 * u, 5 * u);
  for (const x of [F + 132 * u, F + 150 * u]) stool.rect(x, by + 7 * u, 5 * u, floor - by - 4 * u);
  return keepRoom(
    c,
    L,
    glass.win,
    hillView(c),
    (g, E) => {
      S.under(g, E);
      tapestry(g, E, L, F + 28 * u, H * 0.17, 150 * u, H * 0.34, u);
      glass.paint(g, E);
      shutters(g, E, L, wx, H * 0.24, 58 * u, H * 0.58, u);
      glass.light(g, E, floor);
      fill(g, chest, tint(E, L.wood, 0.34));
      fill(g, frame, tint(E, L.wood, 0.34));
      fill(g, pillow, tint(E, [222, 212, 190], 0.46));
      fill(g, blanket, tint(E, L.cloth, 0.38));
      fill(g, fold, tint(E, [214, 204, 180], 0.42));
      g.fillStyle = rgb(tint(E, L.wood, 0.34));
      g.fill(stool);
      candle(g, E, F + 144 * u, by + 2 * u, u, 14);
      S.over(g, E);
    },
    floor,
  );
}

function masterbedroom(c: Ctx): Scene {
  const { H, u, F, r } = c;
  const L = keepLook(c);
  const floor = H * 0.84;
  const hx = F - 285 * u;
  const wx = F - 475 * u;
  const S = shell(c, L, { floor, spring: 0.16, busy: [[F - 190 * u, F + 190 * u], [hx - 95 * u, hx + 95 * u], [wx - 60 * u, wx + 60 * u]] });
  const glass = windows(c, L, [wx], H * 0.22, H * 0.58, 70 * u);
  const fireplace = hearth(c, L, hx, floor, 120 * u, 88 * u);
  // A great curtained bed, seen from its side: posts, a tester, furs and a long bolster.
  const bx0 = F - 136 * u;
  const bx1 = F + 136 * u;
  const by = floor - 44 * u;
  const test = H * 0.14;
  const posts = new Path2D();
  for (const x of [bx0, bx1 - 11 * u]) posts.rect(x, test, 11 * u, floor - test + 4 * u);
  const canopy = new Path2D();
  canopy.rect(bx0 - 8 * u, test - 7 * u, bx1 - bx0 + 16 * u, 18 * u);
  const valance = new Path2D();
  valance.moveTo(bx0, test + 11 * u);
  for (let x = bx0; x < bx1; x += 34 * u) valance.quadraticCurveTo(x + 17 * u, test + 36 * u, x + 34 * u, test + 11 * u);
  valance.lineTo(bx1, test);
  valance.lineTo(bx0, test);
  valance.closePath();
  const drape = new Path2D();
  for (const [x, s] of [[bx0 + 11 * u, 1], [bx1 - 11 * u, -1]] as const) {
    drape.moveTo(x, test + 8 * u);
    drape.lineTo(x + s * 52 * u, test + 8 * u);
    drape.quadraticCurveTo(x + s * 46 * u, by - 50 * u, x + s * 22 * u, by - 6 * u);
    drape.quadraticCurveTo(x + s * 10 * u, by + 20 * u, x + s * 22 * u, floor);
    drape.lineTo(x, floor);
    drape.closePath();
  }
  const head = new Path2D();
  rr(head, bx0 + 54 * u, test + 26 * u, bx1 - bx0 - 108 * u, by - test - 22 * u, 5 * u);
  const frame = new Path2D();
  frame.rect(bx0 + 2 * u, by + 14 * u, bx1 - bx0 - 4 * u, floor - by - 12 * u);
  const covers = new Path2D();
  covers.moveTo(bx0 + 22 * u, by + 26 * u);
  covers.quadraticCurveTo(bx0 + 16 * u, by - 18 * u, bx0 + 60 * u, by - 20 * u);
  covers.lineTo(bx1 - 60 * u, by - 20 * u);
  covers.quadraticCurveTo(bx1 - 16 * u, by - 18 * u, bx1 - 22 * u, by + 26 * u);
  covers.closePath();
  const fur = new Path2D();
  const tufts = new Path2D();
  fur.moveTo(bx0 + 20 * u, by + 28 * u);
  fur.lineTo(bx0 + 34 * u, by - 6 * u);
  fur.lineTo(bx1 - 34 * u, by - 6 * u);
  fur.lineTo(bx1 - 20 * u, by + 28 * u);
  fur.closePath();
  for (let i = 0; i < 80; i++) {
    const x = bx0 + 26 * u + r() * (bx1 - bx0 - 52 * u);
    const y = by - 2 * u + r() * 28 * u;
    tufts.moveTo(x, y);
    tufts.lineTo(x + (r() - 0.5) * 6 * u, y + (5 + r() * 6) * u);
  }
  const bolster = new Path2D();
  ellipse(bolster, F - 44 * u, by - 26 * u, 46 * u, 12 * u);
  ellipse(bolster, F + 44 * u, by - 26 * u, 46 * u, 12 * u);
  const chest = new Path2D();
  rr(chest, bx0 + 34 * u, floor - 8 * u, bx1 - bx0 - 68 * u, 26 * u, 6 * u);
  const skin = new Path2D();
  skin.moveTo(hx - 80 * u, H);
  skin.quadraticCurveTo(hx - 92 * u, floor + 18 * u, hx - 46 * u, floor + 14 * u);
  skin.lineTo(hx + 46 * u, floor + 14 * u);
  skin.quadraticCurveTo(hx + 92 * u, floor + 18 * u, hx + 80 * u, H);
  skin.closePath();
  return keepRoom(
    c,
    L,
    glass.win,
    hillView(c),
    (g, E) => {
      S.under(g, E);
      glass.paint(g, E);
      shutters(g, E, L, wx, H * 0.22, 70 * u, H * 0.58, u);
      glass.light(g, E, floor);
      fireplace(g, E);
      fill(g, skin, tint(E, [110, 84, 62], 0.36));
      fill(g, head, tint(E, mix(L.cloth, DARK, 0.25), 0.34));
      stroke(g, head, tint(E, L.cloth2, 0.36), 2.4 * u);
      fill(g, frame, tint(E, L.wood, 0.34));
      fill(g, bolster, tint(E, [226, 216, 196], 0.46));
      fill(g, covers, tint(E, L.cloth, 0.42));
      fill(g, fur, tint(E, [120, 100, 80], 0.42));
      stroke(g, tufts, tint(E, [168, 146, 118], 0.42), 1.3 * u, 0.8);
      fill(g, drape, tint(E, mix(L.cloth, DARK, 0.1), 0.38));
      fill(g, posts, tint(E, L.wood, 0.36));
      fill(g, canopy, tint(E, L.wood, 0.34));
      fill(g, valance, tint(E, L.cloth, 0.38));
      stroke(g, valance, tint(E, L.cloth2, 0.42), 1.6 * u, 0.85);
      fill(g, chest, tint(E, L.wood, 0.4));
      g.fillStyle = rgb(tint(E, L.wood, 0.3));
      g.fillRect(bx1 + 12 * u, floor - 40 * u, 42 * u, 42 * u);
      candle(g, E, bx1 + 33 * u, floor - 40 * u, u, 18);
      S.over(g, E);
    },
    floor,
  );
}

// ---------- The passage ----------

/** A stone passage running away from the viewer: rib after rib, torches on the piers, a slit of sky at the end. */
function hallway(c: Ctx): Scene {
  const { W, H, u, F } = c;
  const L = keepLook(c);
  const vx = F - 30 * u;
  const vy = H * 0.5;
  const depths = [0.86, 0.66, 0.5, 0.38, 0.29, 0.22, 0.17, 0.13];
  const half = Math.max(W * 0.5, H * 1.05);
  // The nearest rib stands just beyond both edges of the picture, however wide it is.
  const reachL = (vx + 30 * u) / 0.8;
  const reachR = (W - vx + 30 * u) / 0.8;
  const frameAt = (d: number) => {
    const top = vy - H * 0.62 * d;
    const bot = vy + H * 0.52 * d;
    return { x0: vx - reachL * d, x1: vx + reachR * d, top, bot };
  };
  // The sky through a slit at the far end.
  const far = frameAt(0.09);
  const win = new Path2D();
  opening(win, { ...L, masonry: L.masonry === "fused" ? "fused" : "ashlar" }, vx, far.top + 2 * u, far.x1 - far.x0 - 8 * u, far.bot - 3 * u, u, c.r);
  // The walls and floor between each pair of frames, and courses of stone along them.
  const joints = new Path2D();
  for (const t of [-0.8, -0.5, -0.2, 0.1, 0.4, 0.7]) {
    for (const s of [-1, 1]) {
      const a = frameAt(1);
      const b = frameAt(0.09);
      const y = (f: typeof a) => vy + (t < 0 ? (f.top - vy) * -t : (f.bot - vy) * t);
      joints.moveTo(s < 0 ? a.x0 : a.x1, y(a));
      joints.lineTo(s < 0 ? b.x0 : b.x1, y(b));
    }
  }
  const flagsAlong = new Path2D();
  for (let i = -5; i <= 5; i++) {
    flagsAlong.moveTo(vx + (i * half) / 2.6, H * 1.1);
    flagsAlong.lineTo(vx + (i * half * 0.09) / 2.6, frameAt(0.09).bot);
  }
  return keepRoom(
    c,
    L,
    win,
    hillView(c),
    (g, E) => {
      // Stone, darker with depth, lit in steps by the torches.
      const stone = tint(E, L.wall, L.night);
      const floorHue = tint(E, L.floor, L.night * 0.9);
      const ceil = mix(stone, DARK, 0.55);
      const a = frameAt(1.2);
      const b = frameAt(0.09);
      const wedge = (pts: number[], col: RGB) => {
        const p = new Path2D();
        poly(p, ...pts);
        fill(g, p, col);
      };
      wedge([a.x0, a.top, a.x0, a.bot, b.x0, b.bot, b.x0, b.top], mix(stone, DARK, 0.3));
      wedge([a.x1, a.top, a.x1, a.bot, b.x1, b.bot, b.x1, b.top], mix(stone, DARK, 0.38));
      wedge([a.x0, a.top, a.x1, a.top, b.x1, b.top, b.x0, b.top], ceil);
      wedge([a.x0, a.bot, a.x1, a.bot, b.x1, b.bot, b.x0, b.bot], floorHue);
      stroke(g, joints, tint(E, L.joint, 0.3), 0.9 * u, 0.5);
      stroke(g, flagsAlong, tint(E, mix(L.floor, DARK, 0.6), 0.28), 0.9 * u, 0.5);
      // The end wall round the slit, and its deep dark.
      const end = new Path2D();
      end.rect(b.x0, b.top, b.x1 - b.x0, b.bot - b.top);
      end.addPath(win);
      g.fillStyle = rgb(mix(stone, DARK, 0.5));
      g.fill(end, "evenodd");
      // Ribs, far to near, each a lit arch with shadow behind it.
      for (let i = depths.length - 1; i >= 0; i--) {
        const d = depths[i]!;
        const f = frameAt(d);
        const w = 15 * u * d * 2;
        const rib = new Path2D();
        rib.moveTo(f.x0, f.bot);
        rib.lineTo(f.x0, vy - (vy - f.top) * 0.5);
        rib.quadraticCurveTo(f.x0, f.top, vx, f.top - 8 * u * d);
        rib.quadraticCurveTo(f.x1, f.top, f.x1, vy - (vy - f.top) * 0.5);
        rib.lineTo(f.x1, f.bot);
        stroke(g, rib, DARK, w * 2.2, 0.22);
        stroke(g, rib, mix(stone, DARK, 0.1 + 0.25 * (1 - d)), w);
        stroke(g, rib, tint(E, L.joint, 0.3), Math.max(0.7, 1.2 * d) * u, 0.5);
      }
      // Torches down both walls, shrinking away.
      for (const [i, d] of depths.entries()) {
        if (i === 0) continue;
        const f = frameAt(d * 0.86);
        const y = vy - H * 0.14 * d;
        const s = Math.max(0.3, d * 1.7);
        torch(g, E, f.x0 + 8 * u * d, y, u * s);
        torch(g, E, f.x1 - 8 * u * d, y, u * s);
      }
      // A runner of moonlight or day from the far slit.
      const lt = (E.day * 0.09 + (E.light ? E.light.a * 0.05 : 0)) * (1 - E.c.cloud * 0.5);
      if (lt > 0.01) {
        const p = new Path2D();
        poly(p, vx - 8 * u, b.bot, vx + 8 * u, b.bot, vx + H * 0.34, H, vx - H * 0.3, H);
        fill(g, p, E.day > 0.25 ? [255, 234, 196] : [196, 208, 255], lt);
      }
    },
    H,
  );
}

// ---------- The library ----------

function library(c: Ctx): Scene {
  const { W, H, u, F, r } = c;
  const L = keepLook(c);
  const floor = H * 0.86;
  const wx = F;
  const S = shell(c, L, { floor, spring: 0.16, busy: [[-W, W * 2]] });
  const glass = windows(c, L, [wx], H * 0.2, H * 0.56, 96 * u);
  // Shelved alcoves in every bay but the window's; books spine out, some chained, some lying flat.
  const bay = 190 * u;
  const books: { x: number; y: number; w: number; h: number; hue: RGB }[] = [];
  const shelves = new Path2D();
  const backs = new Path2D();
  const hues: RGB[] = [[120, 44, 40], [60, 84, 110], [120, 96, 56], [66, 96, 72], [86, 60, 96], [160, 136, 96], [L.cloth[0], L.cloth[1], L.cloth[2]]];
  for (let k = -8; k < 8; k++) {
    const mid = F + (k + 0.5) * bay;
    if (Math.abs(mid - wx) < bay * 0.9 || mid < -bay || mid > W + bay) continue;
    const x0 = mid - bay / 2 + 14 * u;
    const x1 = mid + bay / 2 - 14 * u;
    backs.rect(x0, H * 0.24, x1 - x0, floor - H * 0.24);
    for (let y = H * 0.24 + 40 * u; y < floor - 4 * u; y += 40 * u) {
      shelves.rect(x0, y, x1 - x0, 3.6 * u);
      for (let x = x0 + 2 * u; x < x1 - 8 * u; ) {
        const w = (6 + r() * 7) * u;
        const h = (22 + r() * 13) * u;
        if (r() > 0.1) books.push({ x, y: y - h, w, h, hue: hues[(r() * hues.length) | 0]! });
        x += w + 0.8 * u;
      }
    }
  }
  // A lectern with a great open book under the window, and a reading bench.
  const lectern = new Path2D();
  poly(lectern, F - 6 * u, floor, F + 6 * u, floor, F + 5 * u, floor - 62 * u, F - 5 * u, floor - 62 * u);
  lectern.rect(F - 26 * u, floor - 3 * u, 52 * u, 6 * u);
  const leaf = new Path2D();
  poly(leaf, F - 40 * u, floor - 62 * u, F + 40 * u, floor - 62 * u, F + 32 * u, floor - 76 * u, F - 32 * u, floor - 76 * u);
  const pages = new Path2D();
  poly(pages, F - 34 * u, floor - 66 * u, F, floor - 62 * u, F, floor - 75 * u, F - 28 * u, floor - 78 * u);
  poly(pages, F + 34 * u, floor - 66 * u, F, floor - 62 * u, F, floor - 75 * u, F + 28 * u, floor - 78 * u);
  return keepRoom(
    c,
    L,
    glass.win,
    hillView(c),
    (g, E) => {
      S.under(g, E);
      glass.paint(g, E);
      glass.light(g, E, floor);
      fill(g, backs, tint(E, mix(L.wood, DARK, 0.4), 0.26));
      for (const b of books) {
        g.fillStyle = rgb(tint(E, b.hue, 0.34));
        g.fillRect(b.x, b.y, b.w, b.h);
      }
      fill(g, shelves, tint(E, L.wood, 0.36));
      fill(g, leaf, tint(E, L.wood, 0.38));
      fill(g, lectern, tint(E, L.wood, 0.36));
      fill(g, pages, tint(E, [232, 222, 196], 0.52));
      candle(g, E, F - 44 * u, floor - 62 * u, u, 16);
      S.over(g, E);
      for (let k = -6; k < 6; k += 2) {
        const x = F + (k + 1) * bay;
        if (x > 0 && x < W && Math.abs(x - wx) > bay * 0.4) torch(g, E, x, H * 0.46, u, 1.05);
      }
    },
    floor,
  );
}

// ---------- The forge ----------

function forge(c: Ctx): Scene {
  const { W, H, u, F, r } = c;
  const L = keepLook(c);
  const floor = H * 0.84;
  const S = shell(c, L, { floor, busy: [[F - 190 * u, F + 190 * u], [F - 380 * u, F - 190 * u]] });
  const wx = F - 285 * u;
  const glass = windows(c, L, [wx], H * 0.26, H * 0.56, 54 * u);
  // A stone forge under its hood, the anvil on a stump, the quench tub, bellows.
  const bx = F + 44 * u;
  const hood = new Path2D();
  poly(hood, bx - 112 * u, H * 0.42, bx + 112 * u, H * 0.42, bx + 36 * u, -2, bx - 36 * u, -2);
  const bed = new Path2D();
  bed.rect(bx - 100 * u, floor - 56 * u, 200 * u, 58 * u);
  const rim = new Path2D();
  rim.rect(bx - 108 * u, floor - 62 * u, 216 * u, 8 * u);
  const ember = new Path2D();
  ember.ellipse(bx, floor - 62 * u, 72 * u, 9 * u, 0, Math.PI, TAU);
  const ax = F - 108 * u;
  const stump = new Path2D();
  stump.rect(ax - 22 * u, floor - 44 * u, 44 * u, 48 * u);
  const anvil = new Path2D();
  anvil.moveTo(ax - 40 * u, floor - 72 * u);
  anvil.quadraticCurveTo(ax - 30 * u, floor - 64 * u, ax - 22 * u, floor - 62 * u);
  anvil.lineTo(ax - 12 * u, floor - 62 * u);
  anvil.lineTo(ax - 16 * u, floor - 48 * u);
  anvil.lineTo(ax - 24 * u, floor - 44 * u);
  anvil.lineTo(ax + 24 * u, floor - 44 * u);
  anvil.lineTo(ax + 16 * u, floor - 48 * u);
  anvil.lineTo(ax + 12 * u, floor - 62 * u);
  anvil.lineTo(ax + 28 * u, floor - 62 * u);
  anvil.lineTo(ax + 28 * u, floor - 72 * u);
  anvil.closePath();
  const tub = new Path2D();
  poly(tub, bx + 122 * u, floor + 4 * u, bx + 178 * u, floor + 4 * u, bx + 184 * u, floor - 38 * u, bx + 116 * u, floor - 38 * u);
  // Blades, hammers and tongs racked along the wall out to the left.
  const rack = new Path2D();
  const blades = new Path2D();
  for (let x = F - 400 * u; x > -160 * u; x -= 380 * u) {
    rack.rect(x - 300 * u, H * 0.34, 300 * u, 5 * u);
    rack.rect(x - 300 * u, H * 0.64, 300 * u, 5 * u);
    for (let bxx = x - 286 * u; bxx < x - 10 * u; bxx += (22 + r() * 12) * u) {
      const len = (66 + r() * 16) * u;
      poly(blades, bxx - 2.6 * u, H * 0.36, bxx + 2.6 * u, H * 0.36, bxx + 2.6 * u, H * 0.36 + len, bxx, H * 0.36 + len + 8 * u, bxx - 2.6 * u, H * 0.36 + len);
      blades.rect(bxx - 8 * u, H * 0.36 + 2 * u, 16 * u, 3 * u);
    }
  }
  return keepRoom(
    c,
    L,
    glass.win,
    hillView(c),
    (g, E) => {
      S.under(g, E);
      glass.paint(g, E);
      glass.light(g, E, floor);
      const stone = tint(E, mix(L.wall, DARK, 0.15), L.night);
      fill(g, rack, tint(E, L.wood, 0.32));
      fill(g, blades, tint(E, [186, 186, 196], 0.42));
      fill(g, hood, mix(tint(E, L.joint, 0.3), stone, 0.4));
      fill(g, bed, stone);
      fill(g, rim, mix(stone, [255, 236, 206], 0.12));
      // The fire: it is the room's sun.
      glowAt(g, bx, floor - 74 * u, 360 * u, [255, 118, 44], 0.52);
      fill(g, ember, [255, 136, 46]);
      for (const s of [-46, -14, 18, 46]) fire(g, E, bx + s * u, floor - 62 * u, 1.25 * u);
      glowAt(g, bx, floor - 70 * u, 130 * u, [255, 214, 130], 0.5);
      fill(g, stump, tint(E, L.wood, 0.36));
      fill(g, anvil, tint(E, BLACK_IRON, 0.32));
      g.fillStyle = rgb([255, 150, 70], 0.55);
      g.fillRect(ax - 40 * u, floor - 72 * u, 68 * u, 1.6 * u);
      fill(g, tub, tint(E, L.wood, 0.36));
      g.fillStyle = rgb([255, 150, 80], 0.32);
      g.fillRect(bx + 120 * u, floor - 37 * u, 60 * u, 4 * u);
      S.over(g, E);
      if (!E.still)
        for (let i = 0; i < 8; i++) {
          const k = (E.T * 0.3 + i / 8) % 1;
          g.fillStyle = rgb([255, 190, 90], 1 - k);
          g.beginPath();
          g.arc(bx + Math.sin(i * 7 + k * 5) * 54 * u, floor - 70 * u - k * 100 * u, 1.2 * u, 0, TAU);
          g.fill();
        }
    },
    floor,
  );
}

// ---------- The stable ----------

function stable(c: Ctx): Scene {
  const { W, H, u, F, r } = c;
  const L = keepLook(c);
  const floor = H * 0.86;
  const dx = F - 160 * u;
  const S = shell(c, L, { floor, spring: 0.2, bay: 210, torches: false, busy: [[-W, W * 2]] });
  // An arched door standing open on the yard.
  const win = new Path2D();
  opening(win, { ...L, masonry: L.masonry === "fused" ? "redstone" : L.masonry }, dx, H * 0.26, 104 * u, floor, u, r);
  const leaf = new Path2D();
  leaf.rect(dx - 92 * u, H * 0.42, 38 * u, floor - H * 0.42);
  leaf.rect(dx + 54 * u, H * 0.42, 38 * u, floor - H * 0.42);
  // Stalls in every other bay: partitions, a half door, a horse looking out, hay behind it.
  const stalls: { x: number; hue: RGB; flip: number; blaze: boolean }[] = [];
  const horses: RGB[] = [[92, 62, 44], [44, 36, 34], [150, 120, 92], [120, 74, 46], [170, 166, 158]];
  const bay = 210 * u;
  for (let k = -8; k < 8; k++) {
    const x = F + (k + 0.5) * bay + 30 * u;
    if (Math.abs(x - dx) < bay * 0.72 || x < -bay || x > W + bay) continue;
    stalls.push({ x, hue: horses[(r() * horses.length) | 0]!, flip: r() < 0.5 ? -1 : 1, blaze: r() < 0.5 });
  }
  const horse = (g: G, E: Env, s: (typeof stalls)[number]) => {
    const t = floor - 88 * u;
    const hue = tint(E, s.hue, 0.38);
    const f = s.flip;
    const neck = new Path2D();
    neck.moveTo(s.x - f * 34 * u, t + 6 * u);
    neck.quadraticCurveTo(s.x - f * 30 * u, t - 62 * u, s.x + f * 4 * u, t - 72 * u);
    neck.lineTo(s.x + f * 18 * u, t - 40 * u);
    neck.quadraticCurveTo(s.x + f * 8 * u, t - 20 * u, s.x + f * 16 * u, t + 6 * u);
    neck.closePath();
    fill(g, neck, hue);
    const head = new Path2D();
    head.moveTo(s.x - f * 6 * u, t - 78 * u);
    head.quadraticCurveTo(s.x + f * 8 * u, t - 86 * u, s.x + f * 20 * u, t - 70 * u);
    head.lineTo(s.x + f * 46 * u, t - 38 * u);
    head.quadraticCurveTo(s.x + f * 50 * u, t - 24 * u, s.x + f * 36 * u, t - 22 * u);
    head.quadraticCurveTo(s.x + f * 20 * u, t - 30 * u, s.x + f * 4 * u, t - 44 * u);
    head.closePath();
    poly(head, s.x - f * 3 * u, t - 76 * u, s.x - f * 0 * u, t - 94 * u, s.x + f * 7 * u, t - 78 * u);
    fill(g, head, hue);
    if (s.blaze) {
      const b = new Path2D();
      poly(b, s.x + f * 16 * u, t - 72 * u, s.x + f * 24 * u, t - 66 * u, s.x + f * 44 * u, t - 36 * u, s.x + f * 38 * u, t - 34 * u);
      fill(g, b, tint(E, [226, 220, 208], 0.44));
    }
    const mane = new Path2D();
    mane.moveTo(s.x - f * 6 * u, t - 76 * u);
    mane.quadraticCurveTo(s.x - f * 46 * u, t - 50 * u, s.x - f * 40 * u, t + 6 * u);
    mane.lineTo(s.x - f * 30 * u, t + 6 * u);
    mane.quadraticCurveTo(s.x - f * 30 * u, t - 50 * u, s.x + f * 2 * u, t - 72 * u);
    mane.closePath();
    fill(g, mane, tint(E, mix(s.hue, DARK, 0.6), 0.3));
    g.fillStyle = "rgb(16,12,14)";
    g.beginPath();
    g.arc(s.x + f * 18 * u, t - 62 * u, 2.2 * u, 0, TAU);
    g.fill();
  };
  const hay = new Path2D();
  for (let i = 0; i < 200; i++) {
    const x = r() * W;
    const y = floor + r() * (H - floor);
    hay.moveTo(x, y);
    hay.lineTo(x + (r() - 0.5) * 22 * u, y + (r() - 0.5) * 5 * u);
  }
  const lintel = new Path2D();
  const parts = new Path2D();
  const doors = new Path2D();
  const strap = new Path2D();
  for (const s of stalls) {
    parts.rect(s.x - 94 * u, floor - 152 * u, 9 * u, 156 * u);
    parts.rect(s.x + 85 * u, floor - 152 * u, 9 * u, 156 * u);
    lintel.rect(s.x - 98 * u, floor - 160 * u, 196 * u, 10 * u);
    doors.rect(s.x - 85 * u, floor - 86 * u, 170 * u, 90 * u);
    strap.rect(s.x - 85 * u, floor - 68 * u, 170 * u, 4 * u);
    strap.rect(s.x - 85 * u, floor - 24 * u, 170 * u, 4 * u);
  }
  const darks = new Path2D();
  for (const s of stalls) darks.rect(s.x - 85 * u, floor - 150 * u, 170 * u, 66 * u);
  return keepRoom(
    c,
    L,
    win,
    hillView(c),
    (g, E) => {
      S.under(g, E);
      stroke(g, win, tint(E, mix(L.wall, [255, 240, 214], 0.15), L.night), 9 * u);
      shaft(g, E, dx - 52 * u, dx + 52 * u, H * 0.3, H, 90 * u);
      fill(g, leaf, tint(E, L.wood, 0.36));
      fill(g, darks, [20, 14, 14], 0.82);
      for (const s of stalls) horse(g, E, s);
      fill(g, doors, tint(E, L.wood, 0.36));
      fill(g, strap, tint(E, BLACK_IRON, 0.3));
      fill(g, parts, tint(E, L.wood, 0.34));
      fill(g, lintel, tint(E, L.wood, 0.3));
      stroke(g, hay, tint(E, [192, 164, 88], 0.38), 1.2 * u, 0.62);
      S.over(g, E);
      torch(g, E, dx + 78 * u, H * 0.36, u, 1.05);
      for (const s of stalls.filter((_, i) => i % 2 === 0)) torch(g, E, s.x + 100 * u, H * 0.3, u, 1);
    },
    floor,
  );
}

/** Used for a castle in place of the plainer room of the same kind. */
export const KEEP_SCENES: Partial<Record<Place, (c: Ctx) => Scene>> = { hall, study, dungeon, kitchen, chapel, cellar, bedroom, masterbedroom, hallway, library, forge, stable };

