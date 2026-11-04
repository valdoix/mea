/**
 * The rooms of a house (docs/24-rooms-of-the-house.md). Painted the same way as scenes.ts, and each
 * dressed by its home (`c.home`): the house's own colours, and its style (a grand room has a
 * chandelier, an old-world one has candles and no electrics). Each must read at plate size from one
 * or two big shapes; finer things follow the hour and the weather.
 */
import { clamp, DARK, FABRIC, mix, PLASTER, rgb, TAU, WARM, type Ctx, type Env, type HomeStyle, type Place, type RGB } from "./places";
import { drapes, ellipse, grid, lampsOn, none, pick, rr, shut, steam, time } from "./scenebits";
import { circle, fill, fire, glowAt, hillView, lamp, leafy, motes, panes, poly, room, shade, skirting, spill, stroke, townView, wallDressing, WOOD, type Scene } from "./scenes";

type G = CanvasRenderingContext2D;

const SOFT: RGB[] = [
  [96, 110, 140],
  [150, 96, 80],
  [110, 130, 100],
  [176, 156, 124],
  [96, 84, 116],
];

/** A room's colours and style, from its home if it has one. */
function dress(c: Ctx) {
  const { home, r } = c;
  const style: HomeStyle = home?.style ?? "modern";
  return {
    style,
    old: style === "old",
    grand: style === "grand",
    plain: style === "humble",
    wall: home?.wall ?? pick(r, PLASTER),
    trim: home?.trim ?? ([226, 220, 210] as RGB),
    floorHue: home?.floor ?? ([120, 90, 66] as RGB),
    fab: home?.fabric ?? pick(r, FABRIC),
    soft: home?.soft ?? pick(r, SOFT),
  };
}
type Dress = ReturnType<typeof dress>;

const after = (E: Env) => clamp(E.glow * 1.3);

/** A candle on (x, y), lit after dark. */
function candle(g: G, E: Env, x: number, y: number, u: number) {
  g.fillStyle = rgb(shade(E, [236, 226, 204], 0.6));
  g.fillRect(x - 2 * u, y - 13 * u, 4 * u, 13 * u);
  if (after(E) > 0.15) lamp(g, E, x, y - 17 * u, 34 * u, x, WARM, 0.2);
}
/** What hangs from the ceiling at x: a chandelier, a ring of candles, or a plain pendant. */
function ceilingLight(g: G, E: Env, d: Dress, x: number, drop: number, u: number) {
  const on = lampsOn(E, 0.12);
  g.fillStyle = "rgb(30,26,26)";
  g.fillRect(x - 0.7 * u, 0, 1.4 * u, drop);
  if (d.grand || d.old) {
    const wide = d.grand ? 46 : 34;
    g.fillStyle = rgb(shade(E, d.grand ? [176, 146, 90] : [50, 44, 42], 0.5));
    g.fillRect(x - wide * u, drop, wide * 2 * u, 4 * u);
    for (const dx of d.grand ? [-40, -20, 0, 20, 40] : [-28, 0, 28]) lamp(g, E, x + dx * u, drop - 3 * u, 30 * u, dx, WARM, 0.15);
    glowAt(g, x, drop + 6 * u, 180 * u, WARM, 0.32 * on);
    return;
  }
  g.fillStyle = rgb(shade(E, d.trim, 0.5));
  g.beginPath();
  g.moveTo(x - 24 * u, drop + 18 * u);
  g.lineTo(x + 24 * u, drop + 18 * u);
  g.lineTo(x + 8 * u, drop);
  g.lineTo(x - 8 * u, drop);
  g.fill();
  lamp(g, E, x, drop + 18 * u, 150 * u, x, WARM, 0.1);
}
/** A window with its frame, for a room that needs an ordinary one. */
function windowAt(x: number, y: number, w: number, h: number, u: number, old: boolean) {
  const win = new Path2D();
  win.rect(x, y, w, h);
  const frame = new Path2D();
  panes(frame, x, y, w, h, old ? 4 : 2, old ? 4 : 2, 2.2 * u);
  frame.rect(x - 7 * u, y + h, w + 14 * u, 5 * u);
  return { win, frame };
}

// ---------- Gathering rooms ----------

function dining(c: Ctx): Scene {
  const { H, u, F, r } = c;
  const d = dress(c);
  const floor = H * 0.82;
  const top = H * 0.6;
  const half = d.plain ? 110 : d.grand ? 230 : 180;
  const { win, frame } = windowAt(F - 390 * u, H * 0.14, 100 * u, H * 0.46, u, d.old);
  const curt = new Path2D();
  drapes(curt, F - 390 * u, F - 290 * u, H * 0.14, floor, u);
  const table = new Path2D();
  table.rect(F - half * u, top, half * 2 * u, 7 * u);
  for (const x of [F - (half - 12) * u, F + (half - 18) * u]) table.rect(x, top + 7 * u, 6 * u, floor - top - 7 * u + 8 * u);
  const apron = new Path2D();
  apron.rect(F - (half - 8) * u, top + 7 * u, (half - 8) * 2 * u, 10 * u);
  const runner = new Path2D();
  runner.rect(F - half * 0.7 * u, top - 1 * u, half * 1.4 * u, 3 * u);
  const n = d.plain ? 3 : d.grand ? 7 : 5;
  const seatXs = Array.from({ length: n }, (_, i) => F + ((i - (n - 1) / 2) * (half * 2 - 40) * u) / Math.max(1, n - 1));
  const chairs = new Path2D();
  for (const x of seatXs) rr(chairs, x - 14 * u, top - (d.grand ? 66 : 52) * u, 28 * u, (d.grand ? 66 : 52) * u, 6 * u);
  const plates = new Path2D();
  for (const x of seatXs) ellipse(plates, x, top - 1 * u, 13 * u, 2.6 * u);
  const glasses = new Path2D();
  for (const x of seatXs) glasses.rect(x + 15 * u, top - 11 * u, 3 * u, 10 * u);
  const board = new Path2D();
  board.rect(F + (half + 40) * u, H * 0.56, 120 * u, floor - H * 0.56);
  const boardTop = new Path2D();
  boardTop.rect(F + (half + 34) * u, H * 0.55, 132 * u, 5 * u);
  const mirror = new Path2D();
  rr(mirror, F + (half + 66) * u, H * 0.2, 68 * u, H * 0.26, 8 * u);
  const rug = new Path2D();
  ellipse(rug, F, H * 0.91, (half + 70) * u, 15 * u);
  const candles = d.old ? [-40, 0, 40] : [-22, 22];
  const view = r() < 0.5 ? townView(c) : hillView(c);
  const hang = wallDressing(c, 0, F - 430 * u);
  return room(
    c,
    win,
    d.wall,
    view,
    (g, E) => {
      hang(g, E);
      skirting(g, E, c, floor);
      spill(g, E, F - 390 * u, F - 290 * u, H * 0.6, floor, 80 * u);
      fill(g, frame, shade(E, d.trim, 0.6));
      fill(g, curt, shade(E, d.fab, 0.45));
      fill(g, mirror, shade(E, mix(d.trim, [200, 214, 222], 0.6), 0.55));
      stroke(g, mirror, shade(E, d.grand ? [176, 146, 90] : WOOD, 0.5), 3 * u);
      fill(g, board, shade(E, WOOD, 0.45));
      fill(g, boardTop, shade(E, mix(WOOD, [255, 240, 210], 0.15), 0.55));
      fill(g, rug, shade(E, mix(d.fab, [120, 100, 90], 0.5), 0.4));
      fill(g, chairs, shade(E, mix(WOOD, d.soft, d.grand ? 0.5 : 0.2), 0.45));
      fill(g, table, shade(E, WOOD, 0.55));
      fill(g, apron, shade(E, mix(WOOD, DARK, 0.2), 0.5));
      fill(g, runner, shade(E, d.fab, 0.5));
      // Laid around noon and through the evening meal.
      if ((E.t >= 11.5 && E.t < 13.5) || (E.t >= 18 && E.t < 20.5)) {
        fill(g, plates, shade(E, [240, 236, 228], 0.65));
        fill(g, glasses, shade(E, [210, 224, 232], 0.65), 0.8);
      }
      for (const dx of candles) candle(g, E, F + dx * u, top - 1 * u, u);
      if (!d.old) ceilingLight(g, E, d, F, H * 0.2, u);
      else glowAt(g, F, top - 20 * u, 170 * u, WARM, 0.3 * after(E));
    },
    floor,
    { floorHue: d.floorHue },
  );
}

function den(c: Ctx): Scene {
  const { W, H, u, F, r } = c;
  const d = dress(c);
  const floor = H * 0.8;
  const { win, frame } = windowAt(F - 430 * u, H * 0.16, 70 * u, H * 0.26, u, d.old);
  const panels = new Path2D();
  grid(panels, 0, H * 0.46, W, floor, 54 * u, floor - H * 0.46);
  const wood = new Path2D();
  wood.rect(0, H * 0.46, W, floor - H * 0.46);
  const stand = new Path2D();
  stand.rect(F - 120 * u, floor - 36 * u, 240 * u, 36 * u);
  const screen = new Path2D();
  rr(screen, F - 104 * u, floor - 36 * u - 112 * u, 208 * u, 110 * u, 3 * u);
  const surround = new Path2D();
  surround.rect(F - 80 * u, H * 0.34, 160 * u, floor - H * 0.34);
  const mouth = new Path2D();
  mouth.moveTo(F - 48 * u, floor);
  mouth.lineTo(F - 48 * u, H * 0.56);
  mouth.quadraticCurveTo(F, H * 0.46, F + 48 * u, H * 0.56);
  mouth.lineTo(F + 48 * u, floor);
  mouth.closePath();
  // The sectional's back, seen from behind, in the foreground.
  const back = new Path2D();
  rr(back, F - 230 * u, H * 0.68, 380 * u, H * 0.4, 18 * u);
  rr(back, F + 136 * u, H * 0.74, 170 * u, H * 0.3, 18 * u);
  const cush = new Path2D();
  for (let x = F - 210 * u; x < F + 130 * u; x += 112 * u) rr(cush, x, H * 0.635, 100 * u, 40 * u, 12 * u);
  const blanket = new Path2D();
  poly(blanket, F - 150 * u, H * 0.66, F - 60 * u, H * 0.66, F - 54 * u, H * 0.9, F - 158 * u, H * 0.86);
  const table = new Path2D();
  table.rect(F - 318 * u, H * 0.6, 56 * u, floor - H * 0.6 + 24 * u);
  const base = new Path2D();
  base.rect(F - 293 * u, H * 0.46, 6 * u, H * 0.14);
  const lshade = new Path2D();
  poly(lshade, F - 313 * u, H * 0.46, F - 267 * u, H * 0.46, F - 276 * u, H * 0.36, F - 304 * u, H * 0.36);
  const view = r() < 0.5 ? townView(c) : hillView(c);
  const hang = wallDressing(c, 0, F - 470 * u);
  return room(
    c,
    win,
    d.wall,
    view,
    (g, E) => {
      hang(g, E);
      fill(g, frame, shade(E, d.trim, 0.55));
      fill(g, wood, shade(E, mix(WOOD, d.floorHue, 0.3), 0.45));
      stroke(g, panels, [0, 0, 0], 1.2 * u, 0.25);
      const on = after(E);
      if (d.old) {
        fill(g, surround, shade(E, [120, 112, 104], 0.5));
        fill(g, mouth, [20, 12, 12]);
        glowAt(g, F, floor - 16 * u, 230 * u, [255, 140, 60], 0.45);
        fire(g, E, F, floor - 3 * u, u * 1.7);
      } else {
        fill(g, stand, shade(E, mix(WOOD, DARK, 0.3), 0.45));
        fill(g, screen, mix([16, 16, 20], [140, 176, 226], on * (E.still ? 0.85 : 0.75 + 0.1 * Math.sin(E.T * 2.7))));
        if (on > 0.05) glowAt(g, F, floor - 92 * u, 300 * u, [130, 170, 230], 0.36 * on);
      }
      fill(g, table, shade(E, WOOD, 0.45));
      if (d.old) candle(g, E, F - 290 * u, H * 0.6, u);
      else {
        fill(g, base, shade(E, [60, 50, 46]));
        fill(g, lshade, mix(shade(E, [236, 222, 196]), [255, 226, 176], on));
        glowAt(g, F - 290 * u, H * 0.42, 130 * u, WARM, 0.42 * on);
      }
      fill(g, cush, shade(E, mix(d.soft, [255, 255, 255], 0.1), 0.45));
      fill(g, back, shade(E, d.soft, 0.42));
      fill(g, blanket, shade(E, d.fab, 0.45));
    },
    floor,
    { floorHue: d.floorHue },
  );
}

// ---------- Leisure rooms ----------

const FILMS: RGB[] = [
  [206, 170, 120],
  [110, 150, 200],
  [180, 110, 120],
  [120, 170, 150],
];

function hometheater(c: Ctx): Scene {
  const { W, H, u, F, r } = c;
  const d = dress(c);
  const floor = H * 0.62;
  const sx = F - 240 * u;
  const sw = 480 * u;
  const sy = H * 0.07;
  const sh = H * 0.46;
  const screen = new Path2D();
  screen.rect(sx, sy, sw, sh);
  const film = [pick(r, FILMS), pick(r, FILMS)];
  const baffles = new Path2D();
  grid(baffles, 0, 0, W, floor, 66 * u, floor);
  const row = (y: number, n: number, w: number, h: number) => {
    const p = new Path2D();
    for (let i = 0; i < n; i++) {
      const x = F + (i - (n - 1) / 2) * (w + 10 * u);
      rr(p, x - w / 2, y, w, h, 14 * u);
    }
    return p;
  };
  const back = row(H * 0.62, 15, 76 * u, H * 0.3);
  const front = row(H * 0.78, 12, 92 * u, H * 0.3);
  const sconces = [F - 340 * u, F + 340 * u, F - 500 * u, F + 500 * u];
  const steps: number[] = [];
  for (let x = F - 310 * u; x >= 0; x -= 220 * u) steps.push(x);
  steps.push(F + 310 * u);
  return room(
    c,
    shut(),
    d.grand ? [70, 26, 34] : d.plain ? [46, 44, 50] : [30, 30, 40],
    none,
    (g, E) => {
      stroke(g, baffles, [0, 0, 0], 2 * u, 0.3);
      // The film's colour drifts; a still shows it mid-scene.
      const k = E.still ? 0.4 : 0.5 + 0.5 * Math.sin(E.T * 0.25);
      const col = mix(film[0]!, film[1]!, k);
      glowAt(g, F, sy + sh * 0.6, 520 * u, col, 0.42);
      const sg = g.createLinearGradient(sx, sy, sx, sy + sh);
      sg.addColorStop(0, rgb(mix(col, [255, 255, 255], 0.35)));
      sg.addColorStop(1, rgb(mix(col, [255, 240, 220], 0.1)));
      g.fillStyle = sg;
      g.fill(screen);
      stroke(g, screen, [10, 10, 14], 5 * u);
      for (const x of sconces) lamp(g, E, x, H * 0.3, 44 * u, x, WARM, 0.25);
      fill(g, back, mix(mix(d.soft, DARK, 0.84), col, 0.1));
      fill(g, front, mix(mix(d.soft, DARK, 0.92), col, 0.04));
      for (const x of steps) glowAt(g, x, H * 0.96, 18 * u, [255, 214, 150], 0.5);
    },
    floor,
    { lift: 0.14, space: true, floorHue: [34, 28, 34] },
  );
}

function homelibrary(c: Ctx): Scene {
  const { W, H, u, F, r } = c;
  const d = dress(c);
  const floor = H * 0.86;
  const wx = F - 210 * u;
  const ww = 96 * u;
  const wy = H * 0.08;
  const wb = H * 0.6;
  const { win, frame } = windowAt(wx, wy, ww, wb - wy, u, d.old);
  const shelves = new Path2D();
  const rows = 5;
  const rh = (floor - H * 0.04) / rows;
  for (let k = 0; k <= rows; k++) shelves.rect(0, H * 0.04 + k * rh - 3 * u, W, 5 * u);
  for (let x = F % (130 * u); x < W; x += 130 * u) shelves.rect(x, 0, 6 * u, floor);
  const seat = new Path2D();
  seat.rect(wx - 16 * u, wb, ww + 32 * u, floor - wb);
  const cushion = new Path2D();
  rr(cushion, wx - 12 * u, wb - 12 * u, ww + 24 * u, 14 * u, 5 * u);
  const hues = [...FABRIC, [150, 120, 90], [70, 66, 80]] as RGB[];
  const books = hues.map(() => new Path2D());
  for (let k = 0; k < rows; k++) {
    const y = H * 0.04 + (k + 1) * rh - 3 * u;
    for (let x = 0; x < W; ) {
      const w = (6 + r() * 8) * u;
      const inWindow = x + w > wx - 22 * u && x < wx + ww + 22 * u && y - rh < wb;
      if (!inWindow && r() < 0.9) {
        const h = rh * (0.6 + r() * 0.28);
        books[(r() * books.length) | 0]!.rect(x, y - h, w - 1 * u, h);
      }
      x += w;
    }
  }
  const rail = new Path2D();
  rail.rect(0, H * 0.16, W, 3 * u);
  const ladder = new Path2D();
  const lx = F - 40 * u;
  for (const dx of [0, 40]) {
    ladder.moveTo(lx + dx * u, H * 0.16);
    ladder.lineTo(lx + (dx + 70) * u, floor + 6 * u);
  }
  for (let t = 0.08; t < 1; t += 0.12) {
    const y = H * 0.16 + t * (floor + 6 * u - H * 0.16);
    ladder.moveTo(lx + t * 70 * u, y);
    ladder.lineTo(lx + (t * 70 + 40) * u, y);
  }
  // The wing chair, with a lamp to read by.
  const cx = F + 170 * u;
  const chair = new Path2D();
  rr(chair, cx - 42 * u, H * 0.5, 84 * u, floor - H * 0.5 - 8 * u, 16 * u);
  rr(chair, cx - 56 * u, H * 0.56, 22 * u, H * 0.2, 10 * u);
  rr(chair, cx + 34 * u, H * 0.56, 22 * u, H * 0.2, 10 * u);
  const seatTop = new Path2D();
  rr(seatTop, cx - 34 * u, H * 0.68, 68 * u, 22 * u, 7 * u);
  const lx2 = cx + 86 * u;
  const pole = new Path2D();
  pole.rect(lx2 - 1.5 * u, H * 0.34, 3 * u, floor - H * 0.34);
  const lshade = new Path2D();
  poly(lshade, lx2 - 22 * u, H * 0.34, lx2 + 22 * u, H * 0.34, lx2 + 13 * u, H * 0.25, lx2 - 13 * u, H * 0.25);
  const rug = new Path2D();
  ellipse(rug, cx - 30 * u, H * 0.93, 190 * u, 15 * u);
  const dust = motes(c, 18, wx, wx + 170 * u, wy, floor);
  const view = hillView(c);
  return room(
    c,
    win,
    mix(WOOD, DARK, 0.25),
    view,
    (g, E) => {
      books.forEach((p, i) => fill(g, p, shade(E, hues[i]!, 0.42)));
      fill(g, shelves, shade(E, WOOD, 0.42));
      fill(g, frame, shade(E, mix(d.trim, WOOD, 0.5), 0.55));
      spill(g, E, wx, wx + ww, wb, floor, 90 * u);
      fill(g, seat, shade(E, WOOD, 0.45));
      fill(g, cushion, shade(E, d.fab, 0.5));
      const a = E.day * (1 - E.c.cloud * 0.6);
      if (a > 0.05) {
        const T = time(E);
        for (const m of dust) {
          g.fillStyle = rgb([255, 240, 210], 0.45 * a * (0.5 + 0.5 * Math.sin(T + m.p)));
          g.fillRect(m.x + Math.sin(T * 0.2 + m.p) * 8 * u, m.y, 1.3 * u, 1.3 * u);
        }
      }
      fill(g, rail, shade(E, [150, 126, 90], 0.5));
      stroke(g, ladder, shade(E, mix(WOOD, [255, 230, 190], 0.2), 0.55), 3.5 * u);
      fill(g, rug, shade(E, mix(d.fab, [120, 100, 90], 0.5), 0.4));
      fill(g, chair, shade(E, d.soft, 0.45));
      fill(g, seatTop, shade(E, mix(d.soft, [255, 255, 255], 0.12), 0.5));
      const on = after(E);
      fill(g, pole, [30, 26, 26]);
      if (d.old) {
        if (on > 0.1) fire(g, E, lx2, H * 0.34, u * 0.5);
        glowAt(g, lx2, H * 0.32, 170 * u, WARM, 0.42 * on);
      } else {
        fill(g, lshade, mix(shade(E, [236, 222, 196]), [255, 226, 176], on));
        glowAt(g, lx2, H * 0.36, 220 * u, WARM, 0.5 * on);
      }
    },
    floor,
    { floorHue: d.floorHue },
  );
}

// ---------- Private rooms ----------

function masterbedroom(c: Ctx): Scene {
  const { H, u, F, r } = c;
  const d = dress(c);
  const floor = H * 0.8;
  const { win, frame } = windowAt(F - 390 * u, H * 0.1, 110 * u, H * 0.52, u, d.old);
  const curt = new Path2D();
  drapes(curt, F - 390 * u, F - 280 * u, H * 0.1, floor, u);
  // The bed head-on: a wide headboard, two pillows, the covers coming towards you.
  const head = new Path2D();
  rr(head, F - 136 * u, H * 0.26, 272 * u, floor - H * 0.26, 12 * u);
  const sheet = new Path2D();
  rr(sheet, F - 124 * u, H * 0.52, 248 * u, H * 0.18, 8 * u);
  const pillows = new Path2D();
  for (const dx of [-62, 62]) ellipse(pillows, F + dx * u, H * 0.52, 52 * u, 16 * u);
  const cover = new Path2D();
  cover.moveTo(F - 132 * u, H * 0.6);
  cover.quadraticCurveTo(F, H * 0.565, F + 132 * u, H * 0.6);
  cover.lineTo(F + 156 * u, H * 0.93);
  cover.lineTo(F - 156 * u, H * 0.93);
  cover.closePath();
  const fold = new Path2D();
  poly(fold, F - 134 * u, H * 0.6, F + 134 * u, H * 0.6, F + 138 * u, H * 0.65, F - 138 * u, H * 0.65);
  const stands = new Path2D();
  const lamps = [F - 182 * u, F + 182 * u];
  for (const x of lamps) stands.rect(x - 28 * u, H * 0.58, 56 * u, floor - H * 0.58);
  const shades = new Path2D();
  for (const x of lamps) poly(shades, x - 19 * u, H * 0.5, x + 19 * u, H * 0.5, x + 12 * u, H * 0.42, x - 12 * u, H * 0.42);
  const stems = new Path2D();
  for (const x of lamps) stems.rect(x - 1.5 * u, H * 0.5, 3 * u, H * 0.08);
  const posts = new Path2D();
  for (const x of [F - 146 * u, F + 140 * u]) posts.rect(x, H * 0.09, 6 * u, H * 0.85);
  const canopy = new Path2D();
  canopy.moveTo(F - 156 * u, H * 0.06);
  canopy.lineTo(F + 156 * u, H * 0.06);
  canopy.lineTo(F + 156 * u, H * 0.15);
  canopy.quadraticCurveTo(F, H * 0.23, F - 156 * u, H * 0.15);
  canopy.closePath();
  const bench = new Path2D();
  rr(bench, F - 90 * u, H * 0.9, 180 * u, 16 * u, 5 * u);
  const dresser = new Path2D();
  dresser.rect(F + 250 * u, H * 0.54, 120 * u, floor - H * 0.54);
  const lines = new Path2D();
  for (let k = 1; k < 3; k++) lines.rect(F + 254 * u, H * 0.54 + (k * (floor - H * 0.54)) / 3, 112 * u, 1.5 * u);
  const mirror = new Path2D();
  rr(mirror, F + 272 * u, H * 0.2, 76 * u, H * 0.3, 30 * u);
  const view = r() < 0.5 ? townView(c) : hillView(c);
  const hang = wallDressing(c, 0, F - 430 * u);
  return room(
    c,
    win,
    d.wall,
    view,
    (g, E) => {
      hang(g, E);
      skirting(g, E, c, floor);
      spill(g, E, F - 390 * u, F - 280 * u, H * 0.62, floor, 90 * u);
      fill(g, frame, shade(E, d.trim, 0.6));
      fill(g, curt, shade(E, d.fab, 0.45));
      fill(g, mirror, shade(E, mix(d.trim, [200, 214, 222], 0.6), 0.55));
      stroke(g, mirror, shade(E, d.grand ? [176, 146, 90] : WOOD, 0.5), 3 * u);
      fill(g, dresser, shade(E, WOOD, 0.45));
      fill(g, lines, [0, 0, 0], 0.35);
      fill(g, head, shade(E, d.grand || d.old ? WOOD : d.soft, 0.45));
      fill(g, sheet, shade(E, [232, 228, 222], 0.6));
      fill(g, pillows, shade(E, [244, 240, 236], 0.65));
      fill(g, cover, shade(E, d.fab, 0.45));
      fill(g, fold, shade(E, [232, 228, 222], 0.6));
      fill(g, stands, shade(E, WOOD, 0.45));
      const on = after(E);
      // Two lamps: one lit late on, the other side already asleep.
      if (d.old) {
        candle(g, E, lamps[0]!, H * 0.58, u);
        glowAt(g, lamps[0]!, H * 0.5, 150 * u, WARM, 0.32 * on);
      } else {
        fill(g, stems, [40, 34, 32]);
        fill(g, shades, shade(E, [236, 222, 196], 0.5));
        const l = new Path2D();
        poly(l, lamps[0]! - 19 * u, H * 0.5, lamps[0]! + 19 * u, H * 0.5, lamps[0]! + 12 * u, H * 0.42, lamps[0]! - 12 * u, H * 0.42);
        fill(g, l, [255, 226, 176], on);
        glowAt(g, lamps[0]!, H * 0.46, 170 * u, WARM, 0.5 * on);
      }
      if (d.old || d.grand) fill(g, posts, shade(E, mix(WOOD, DARK, 0.2), 0.5));
      if (d.grand) fill(g, canopy, shade(E, d.fab, 0.45));
      if (!d.plain) fill(g, bench, shade(E, d.soft, 0.42));
    },
    floor,
    { floorHue: d.floorHue },
  );
}

function nursery(c: Ctx): Scene {
  const { H, u, F, r } = c;
  const d = dress(c);
  const floor = H * 0.82;
  const wall = mix(d.wall, [240, 232, 226], 0.55);
  const { win, frame } = windowAt(F - 290 * u, H * 0.14, 96 * u, H * 0.4, u, d.old);
  const curt = new Path2D();
  drapes(curt, F - 290 * u, F - 194 * u, H * 0.14, H * 0.6, u);
  const cx = F;
  const rail = new Path2D();
  rail.rect(cx - 104 * u, H * 0.47, 208 * u, 6 * u);
  rail.rect(cx - 104 * u, H * 0.74, 208 * u, 6 * u);
  for (const x of [cx - 108 * u, cx + 100 * u]) rail.rect(x, H * 0.42, 8 * u, floor + 4 * u - H * 0.42);
  const bars = new Path2D();
  for (let x = cx - 90 * u; x < cx + 96 * u; x += 18 * u) bars.rect(x, H * 0.47, 3 * u, H * 0.27);
  const mattress = new Path2D();
  rr(mattress, cx - 98 * u, H * 0.68, 196 * u, 16 * u, 5 * u);
  const arm = new Path2D();
  arm.moveTo(cx + 60 * u, H * 0.42);
  arm.lineTo(cx + 60 * u, H * 0.14);
  arm.lineTo(cx, H * 0.14);
  const toys: { x: number; c: RGB }[] = [-34, -12, 12, 34].map((dx) => ({ x: cx + dx * u, c: pick(r, FABRIC) }));
  // The rocking chair.
  const rx = F + 230 * u;
  const rock = new Path2D();
  rr(rock, rx - 34 * u, H * 0.44, 68 * u, H * 0.3, 10 * u);
  rock.rect(rx - 44 * u, H * 0.62, 88 * u, 10 * u);
  for (const dx of [-30, 26]) rock.rect(rx + dx * u, H * 0.68, 5 * u, floor - H * 0.68);
  const rockers = new Path2D();
  rockers.moveTo(rx - 56 * u, floor - 5 * u);
  rockers.quadraticCurveTo(rx, floor + 8 * u, rx + 56 * u, floor - 5 * u);
  const cubes: { x: number; y: number; c: RGB }[] = [
    { x: F - 170 * u, y: floor + 12 * u, c: pick(r, FABRIC) },
    { x: F - 144 * u, y: floor + 12 * u, c: pick(r, FABRIC) },
    { x: F - 157 * u, y: floor - 12 * u, c: pick(r, FABRIC) },
  ];
  const bunting: { x: number; y: number; c: RGB }[] = [];
  for (let x = F - 170 * u; x < F + 320 * u; x += 34 * u) bunting.push({ x, y: H * 0.06 + Math.sin((x - F) / (140 * u)) * 7 * u, c: pick(r, FABRIC) });
  const stars = Array.from({ length: 40 }, () => ({ x: F - 400 * u + r() * 800 * u, y: r() * H * 0.34, s: 1 + r() * 2 }));
  const view = hillView(c);
  const hang = wallDressing(c, 0, F - 340 * u);
  return room(
    c,
    win,
    wall,
    view,
    (g, E) => {
      hang(g, E);
      skirting(g, E, c, floor);
      fill(g, frame, shade(E, d.trim, 0.6));
      fill(g, curt, shade(E, mix(d.fab, [255, 255, 255], 0.5), 0.5));
      spill(g, E, F - 290 * u, F - 194 * u, H * 0.54, floor, 70 * u);
      const on = after(E);
      // Glow stars on the ceiling, once the lamp's off.
      if (!d.old && on > 0.2) {
        g.fillStyle = rgb([200, 255, 200], 0.65 * on);
        for (const s of stars) g.fillRect(s.x, s.y, s.s * u, s.s * u);
      }
      for (const b of bunting) {
        g.fillStyle = rgb(shade(E, b.c, 0.55));
        g.beginPath();
        g.moveTo(b.x - 11 * u, b.y);
        g.lineTo(b.x + 11 * u, b.y);
        g.lineTo(b.x, b.y + 20 * u);
        g.fill();
      }
      stroke(g, arm, shade(E, [220, 214, 206], 0.55), 3 * u);
      for (const t of toys) {
        g.strokeStyle = rgb([40, 36, 36], 0.6);
        g.lineWidth = 0.8 * u;
        g.beginPath();
        g.moveTo(t.x, H * 0.14);
        g.lineTo(t.x, H * 0.24);
        g.stroke();
        g.fillStyle = rgb(shade(E, t.c, 0.6));
        g.beginPath();
        g.arc(t.x, H * 0.255, 8 * u, 0, TAU);
        g.fill();
      }
      fill(g, mattress, shade(E, [236, 232, 226], 0.6));
      fill(g, rail, shade(E, d.old ? WOOD : [240, 234, 226], 0.55));
      fill(g, bars, shade(E, d.old ? WOOD : [240, 234, 226], 0.55));
      fill(g, rock, shade(E, WOOD, 0.45));
      stroke(g, rockers, shade(E, WOOD, 0.45), 4 * u);
      for (const k of cubes) {
        g.fillStyle = rgb(shade(E, k.c, 0.6));
        g.fillRect(k.x, k.y - 24 * u, 24 * u, 24 * u);
      }
      if (d.old) candle(g, E, F + 150 * u, floor, u);
      else lamp(g, E, F + 150 * u, floor - 8 * u, 90 * u, 5, [255, 200, 140], 0.05);
    },
    floor,
    { floorHue: d.floorHue },
  );
}

// ---------- Between rooms ----------

function foyer(c: Ctx): Scene {
  const { H, u, F, r } = c;
  const d = dress(c);
  const floor = H * 0.84;
  // The front door: its glass shows the weather and the hour.
  const dx = F + 120 * u;
  const dw = 110 * u;
  const dtop = H * 0.2;
  const glass = new Path2D();
  rr(glass, dx + 22 * u, dtop + 16 * u, dw - 44 * u, H * 0.28, 4 * u);
  const fan = new Path2D();
  fan.moveTo(dx, dtop - 10 * u);
  fan.arc(dx + dw / 2, dtop - 10 * u, dw / 2, Math.PI, 0);
  fan.closePath();
  const win = new Path2D();
  win.addPath(glass);
  win.addPath(fan);
  const spokes = new Path2D();
  for (const a of [0.25, 0.5, 0.75]) {
    spokes.moveTo(dx + dw / 2, dtop - 10 * u);
    spokes.lineTo(dx + dw / 2 + Math.cos(Math.PI * (1 + a)) * (dw / 2), dtop - 10 * u + Math.sin(Math.PI * (1 + a)) * (dw / 2));
  }
  const door = new Path2D();
  door.rect(dx, dtop, dw, floor - dtop);
  const lower = new Path2D();
  lower.rect(dx + 14 * u, H * 0.56, dw - 28 * u, floor - H * 0.56 - 16 * u);
  const knob = new Path2D();
  circle(knob, dx + dw - 15 * u, H * 0.55, 4 * u);
  const case_ = new Path2D();
  case_.rect(dx - 10 * u, dtop - 10 * u, 10 * u, floor - dtop + 10 * u);
  case_.rect(dx + dw, dtop - 10 * u, 10 * u, floor - dtop + 10 * u);
  // Stairs climbing away to the left, with a banister.
  const x0 = F + 40 * u;
  const x1 = F - 330 * u;
  const n = 12;
  const flight = new Path2D();
  flight.moveTo(x0, floor);
  for (let i = 0; i < n; i++) {
    const ax = x0 + ((x1 - x0) * i) / n;
    const y2 = floor - ((i + 1) * (floor - H * 0.16)) / n;
    flight.lineTo(ax, y2);
    flight.lineTo(x0 + ((x1 - x0) * (i + 1)) / n, y2);
  }
  flight.lineTo(x1, floor);
  flight.closePath();
  const rail = new Path2D();
  rail.moveTo(x0, floor - 86 * u);
  rail.lineTo(x1, H * 0.16 - 86 * u);
  const balusters = new Path2D();
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = x0 + (x1 - x0) * t;
    const y = floor + (H * 0.16 - floor) * t;
    balusters.rect(x - 1.2 * u, y - 84 * u, 2.4 * u, 84 * u);
  }
  const newel = new Path2D();
  newel.rect(x0 - 5 * u, floor - 94 * u, 10 * u, 94 * u);
  circle(newel, x0, floor - 98 * u, 7 * u);
  // Coats on hooks, a console with a mirror over it.
  const hooks = new Path2D();
  hooks.rect(F + 250 * u, H * 0.34, 110 * u, 6 * u);
  const coats: { x: number; c: RGB; l: number }[] = [
    { x: F + 266 * u, c: pick(r, FABRIC), l: 92 },
    { x: F + 306 * u, c: d.soft, l: 70 },
    { x: F + 342 * u, c: [70, 66, 72], l: 104 },
  ];
  const console_ = new Path2D();
  console_.rect(F - 430 * u, H * 0.58, 90 * u, 5 * u);
  for (const x of [F - 426 * u, F - 348 * u]) console_.rect(x, H * 0.58, 4 * u, floor - H * 0.58);
  const mirror = new Path2D();
  rr(mirror, F - 415 * u, H * 0.24, 60 * u, H * 0.28, 26 * u);
  const rug = new Path2D();
  poly(rug, dx - 26 * u, floor + 4 * u, dx + dw + 26 * u, floor + 4 * u, dx + dw + 60 * u, H * 0.95, dx - 60 * u, H * 0.95);
  const view = r() < 0.5 ? townView(c) : hillView(c);
  const hang = wallDressing(c, 0, F - 450 * u);
  return room(
    c,
    win,
    d.wall,
    view,
    (g, E) => {
      hang(g, E);
      skirting(g, E, c, floor);
      const doorHue = d.old ? WOOD : mix(d.fab, d.trim, 0.25);
      const hole = new Path2D();
      hole.addPath(door);
      hole.addPath(glass);
      g.fillStyle = rgb(shade(E, doorHue, 0.5));
      g.fill(hole, "evenodd");
      fill(g, lower, shade(E, mix(doorHue, DARK, 0.2), 0.5));
      fill(g, case_, shade(E, d.trim, 0.55));
      stroke(g, fan, shade(E, d.trim, 0.55), 5 * u);
      stroke(g, spokes, shade(E, d.trim, 0.55), 2 * u);
      fill(g, knob, shade(E, [214, 180, 110], 0.7));
      spill(g, E, dx + 22 * u, dx + dw - 22 * u, H * 0.56, floor, -40 * u);
      fill(g, flight, shade(E, mix(WOOD, d.floorHue, 0.4), 0.48));
      fill(g, balusters, shade(E, d.trim, 0.5));
      stroke(g, rail, shade(E, WOOD, 0.5), 5 * u);
      fill(g, newel, shade(E, WOOD, 0.5));
      fill(g, mirror, shade(E, mix(d.trim, [200, 214, 222], 0.6), 0.55));
      fill(g, console_, shade(E, WOOD, 0.5));
      fill(g, hooks, shade(E, WOOD, 0.5));
      for (const k of coats) {
        g.fillStyle = rgb(shade(E, k.c, 0.45));
        g.beginPath();
        g.moveTo(k.x - 8 * u, H * 0.35);
        g.lineTo(k.x + 8 * u, H * 0.35);
        g.lineTo(k.x + 15 * u, H * 0.35 + k.l * u);
        g.lineTo(k.x - 15 * u, H * 0.35 + k.l * u);
        g.fill();
      }
      fill(g, rug, shade(E, mix(d.fab, [120, 100, 90], 0.5), 0.42));
      ceilingLight(g, E, d, F - 50 * u, H * 0.14, u);
    },
    floor,
    { floorHue: d.floorHue },
  );
}

function hallway(c: Ctx): Scene {
  const { W, H, u, F, r } = c;
  const d = dress(c);
  // One-point perspective on a far wall at F, with a window in it.
  const vx = F;
  const bw = 66 * u;
  const by0 = H * 0.24;
  const by1 = H * 0.64;
  const win = new Path2D();
  win.rect(vx - 26 * u, by0 + 12 * u, 52 * u, 62 * u);
  const frame = new Path2D();
  panes(frame, vx - 26 * u, by0 + 12 * u, 52 * u, 62 * u, 2, d.old ? 3 : 2, 1.6 * u);
  const reach = Math.max(vx, W - vx);
  const left = new Path2D();
  poly(left, vx - bw, by0, vx - bw, by1, vx - reach * 1.2, H * 1.3, vx - reach * 1.2, -H * 0.4);
  const right = new Path2D();
  poly(right, vx + bw, by0, vx + bw, by1, vx + reach * 1.2, H * 1.3, vx + reach * 1.2, -H * 0.4);
  const ceiling = new Path2D();
  poly(ceiling, vx - bw, by0, vx + bw, by0, vx + reach * 1.2, -H * 0.4, vx - reach * 1.2, -H * 0.4);
  const floorP = new Path2D();
  poly(floorP, vx - bw, by1, vx + bw, by1, vx + reach * 1.2, H * 1.3, vx - reach * 1.2, H * 1.3);
  const runner = new Path2D();
  poly(runner, vx - bw * 0.5, by1, vx + bw * 0.5, by1, vx + reach * 0.5, H * 1.3, vx - reach * 0.5, H * 1.3);
  // A point on a side wall: `t` from the far wall outwards, `y` from 0 (ceiling) to 1 (floor).
  const at = (s: number, t: number, y: number) => {
    const k = t * t * 3.2 + t * 0.6;
    const x = vx + s * (bw + (reach * 1.2 - bw) * Math.min(1, k * 0.42));
    const top = by0 + (-H * 0.4 - by0) * Math.min(1, k * 0.42);
    const bot = by1 + (H * 1.3 - by1) * Math.min(1, k * 0.42);
    return [x, top + (bot - top) * y] as const;
  };
  const quad = (p: Path2D, s: number, t0: number, t1: number, y0: number, y1: number) => {
    const [a, b] = at(s, t0, y0);
    const [e, f] = at(s, t1, y0);
    const [h, i] = at(s, t1, y1);
    const [j, k] = at(s, t0, y1);
    poly(p, a, b, e, f, h, i, j, k);
  };
  const doors = new Path2D();
  const jambs = new Path2D();
  for (const s of [-1, 1])
    for (const t of [0.1, 0.32, 0.52]) {
      quad(jambs, s, t - 0.008, t + 0.088, 0.14, 1);
      quad(doors, s, t, t + 0.08, 0.17, 1);
    }
  const photos: { p: Path2D; art: RGB }[] = [];
  for (const s of [-1, 1])
    for (const t of [0.22, 0.42]) {
      const p = new Path2D();
      quad(p, s, t, t + 0.05, 0.28, 0.48);
      photos.push({ p, art: pick(r, FABRIC) });
    }
  const under = new Path2D();
  quad(under, r() < 0.5 ? -1 : 1, 0.32, 0.4, 0.985, 1.02);
  const skirt = new Path2D();
  for (const s of [-1, 1]) quad(skirt, s, 0, 0.9, 0.95, 1);
  return room(
    c,
    win,
    d.wall,
    hillView(c),
    (g, E) => {
      fill(g, frame, shade(E, d.trim, 0.6));
      fill(g, ceiling, shade(E, mix(d.wall, [255, 255, 255], 0.35), 0.4));
      for (const p of [left, right]) fill(g, p, shade(E, d.wall, 0.42));
      fill(g, skirt, shade(E, d.trim, 0.45));
      fill(g, floorP, shade(E, d.floorHue, 0.42));
      fill(g, runner, shade(E, mix(d.fab, [120, 100, 90], 0.35), 0.42));
      fill(g, jambs, shade(E, d.trim, 0.5));
      fill(g, doors, shade(E, d.old ? WOOD : mix(d.trim, WOOD, 0.3), 0.45));
      for (const k of photos) {
        fill(g, k.p, shade(E, mix(k.art, [220, 210, 190], 0.5), 0.5));
        stroke(g, k.p, shade(E, [50, 36, 30], 0.5), 2 * u);
      }
      const on = after(E);
      // Late on: a night-light low down, and a line of light under one door.
      if (on > 0.4) {
        fill(g, under, [255, 214, 150], 0.85 * on);
        if (!d.old) glowAt(g, vx - bw * 0.7, by1 + 2 * u, 46 * u, [255, 190, 130], 0.5 * on);
      }
      ceilingLight(g, E, d, vx, H * 0.1, u);
    },
    H,
    { floorHue: d.floorHue },
  );
}

function staircase(c: Ctx): Scene {
  const { H, u, F, r } = c;
  const d = dress(c);
  const floor = H * 0.9;
  // The window on the half-landing, up where the stairs turn.
  const wx = F + 70 * u;
  const wy = H * 0.05;
  const ww = 88 * u;
  const wh = H * 0.42;
  const win = new Path2D();
  win.moveTo(wx, wy + wh);
  win.lineTo(wx, wy + ww / 2);
  win.arc(wx + ww / 2, wy + ww / 2, ww / 2, Math.PI, 0);
  win.lineTo(wx + ww, wy + wh);
  win.closePath();
  const frame = new Path2D();
  frame.rect(wx + ww / 2 - 1.5 * u, wy, 3 * u, wh);
  frame.rect(wx, wy + wh * 0.5, ww, 2.5 * u);
  frame.rect(wx - 7 * u, wy + wh, ww + 14 * u, 5 * u);
  const x0 = F - 340 * u;
  const x1 = F + 40 * u;
  const y1 = H * 0.5;
  const n = 11;
  const flight = new Path2D();
  const treads = new Path2D();
  flight.moveTo(x0, floor);
  for (let i = 0; i < n; i++) {
    const y = floor - ((i + 1) * (floor - y1)) / n;
    const ax = x0 + ((x1 - x0) * i) / n;
    const bx = x0 + ((x1 - x0) * (i + 1)) / n;
    flight.lineTo(ax, y);
    flight.lineTo(bx, y);
    treads.rect(ax, y, bx - ax + 2 * u, 4 * u);
  }
  const lx = F + 210 * u;
  flight.lineTo(lx, y1);
  flight.lineTo(lx, floor);
  flight.closePath();
  // A second flight going on up to the right from the landing.
  const flight2 = new Path2D();
  const x2 = F + 370 * u;
  const y2 = -H * 0.02;
  flight2.moveTo(lx, y1);
  for (let i = 0; i < 7; i++) {
    const y = y1 - ((i + 1) * (y1 - y2)) / 7;
    flight2.lineTo(lx + ((x2 - lx) * i) / 7, y);
    flight2.lineTo(lx + ((x2 - lx) * (i + 1)) / 7, y);
  }
  flight2.lineTo(x2, y1 + 12 * u);
  flight2.closePath();
  const under = new Path2D();
  rr(under, F - 120 * u, H * 0.68, 64 * u, floor - H * 0.68, 2 * u);
  const rail = new Path2D();
  rail.moveTo(x0, floor - 76 * u);
  rail.lineTo(x1, y1 - 76 * u);
  rail.lineTo(lx, y1 - 76 * u);
  rail.lineTo(x2, y2 - 76 * u);
  const balusters = new Path2D();
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = x0 + (x1 - x0) * t;
    const y = floor + (y1 - floor) * t;
    balusters.rect(x - 1.2 * u, y - 74 * u, 2.4 * u, 74 * u);
  }
  for (let x = x1 + 18 * u; x < lx; x += 18 * u) balusters.rect(x - 1.2 * u, y1 - 74 * u, 2.4 * u, 74 * u);
  for (let i = 0; i <= 7; i++) {
    const t = i / 7;
    balusters.rect(lx + (x2 - lx) * t - 1.2 * u, y1 + (y2 - y1) * t - 74 * u, 2.4 * u, 74 * u);
  }
  const newel = new Path2D();
  newel.rect(x0 - 6 * u, floor - 90 * u, 12 * u, 90 * u);
  circle(newel, x0, floor - 94 * u, 8 * u);
  const frames: { x: number; y: number; w: number; h: number; c: RGB }[] = [];
  for (let k = 0; k < 4; k++) {
    const x = F - 300 * u + k * 88 * u;
    const y = H * 0.44 - k * 30 * u - (k % 2) * 8 * u;
    frames.push({ x, y, w: (38 + r() * 18) * u, h: (30 + r() * 16) * u, c: pick(r, FABRIC) });
  }
  const view = hillView(c);
  const hang = wallDressing(c, 0, F - 380 * u);
  return room(
    c,
    win,
    d.wall,
    view,
    (g, E) => {
      hang(g, E);
      fill(g, frame, shade(E, d.trim, 0.6));
      spill(g, E, wx, wx + ww, wy + wh, y1, 26 * u);
      for (const p of frames) {
        g.fillStyle = rgb(shade(E, [50, 36, 30], 0.5));
        g.fillRect(p.x, p.y, p.w, p.h);
        g.fillStyle = rgb(shade(E, mix(p.c, [220, 210, 190], 0.5), 0.5));
        g.fillRect(p.x + 3 * u, p.y + 3 * u, p.w - 6 * u, p.h - 6 * u);
      }
      fill(g, flight2, shade(E, mix(WOOD, d.floorHue, 0.4), 0.42));
      fill(g, flight, shade(E, mix(WOOD, d.floorHue, 0.4), 0.48));
      fill(g, treads, shade(E, d.old ? WOOD : mix(d.fab, WOOD, 0.3), 0.5));
      fill(g, under, shade(E, mix(d.trim, WOOD, 0.4), 0.45));
      fill(g, balusters, shade(E, d.trim, 0.5));
      stroke(g, rail, shade(E, WOOD, 0.5), 5 * u);
      fill(g, newel, shade(E, WOOD, 0.5));
      if (d.old) {
        const on = after(E);
        candle(g, E, x0, floor - 102 * u, u);
        glowAt(g, x0, floor - 110 * u, 150 * u, WARM, 0.3 * on);
      } else ceilingLight(g, E, d, F - 130 * u, H * 0.12, u);
    },
    floor,
    { floorHue: d.floorHue },
  );
}

// ---------- Working rooms ----------

function homeoffice(c: Ctx): Scene {
  const { H, u, F, r } = c;
  const d = dress(c);
  const floor = H * 0.84;
  const { win, frame } = windowAt(F - 130 * u, H * 0.1, 220 * u, H * 0.38, u, false);
  const blind = new Path2D();
  for (let y = H * 0.1; y < H * 0.2; y += 7 * u) blind.rect(F - 130 * u, y, 220 * u, 4 * u);
  const desk = new Path2D();
  desk.rect(F - 190 * u, H * 0.62, 340 * u, 8 * u);
  desk.rect(F - 184 * u, H * 0.62, 90 * u, floor - H * 0.62);
  desk.rect(F + 136 * u, H * 0.62, 8 * u, floor - H * 0.62);
  const drawers = new Path2D();
  for (const y of [0.7, 0.78]) drawers.rect(F - 180 * u, H * y, 82 * u, 1.5 * u);
  const screen = new Path2D();
  rr(screen, F - 66 * u, H * 0.36, 136 * u, 80 * u, 4 * u);
  const stem = new Path2D();
  stem.rect(F - 4 * u, H * 0.36 + 80 * u, 8 * u, H * 0.62 - H * 0.36 - 80 * u);
  stem.rect(F - 26 * u, H * 0.61, 52 * u, 3 * u);
  const mug = new Path2D();
  rr(mug, F + 90 * u, H * 0.62 - 14 * u, 11 * u, 14 * u, 2 * u);
  const chair = new Path2D();
  rr(chair, F - 54 * u, H * 0.64, 108 * u, 92 * u, 16 * u);
  chair.rect(F - 5 * u, H * 0.64 + 92 * u, 10 * u, H);
  const shelf = new Path2D();
  const sx = F + 190 * u;
  for (let k = 0; k < 5; k++) shelf.rect(sx, H * (0.14 + k * 0.17), 150 * u, 4 * u);
  shelf.rect(sx, H * 0.14, 4 * u, floor - H * 0.14);
  shelf.rect(sx + 146 * u, H * 0.14, 4 * u, floor - H * 0.14);
  const hues = [...FABRIC, [150, 120, 90]] as RGB[];
  const books = hues.map(() => new Path2D());
  for (let k = 0; k < 4; k++)
    for (let x = sx + 7 * u; x < sx + 140 * u; ) {
      const w = (6 + r() * 7) * u;
      if (r() < 0.8) {
        const h = (24 + r() * 16) * u;
        books[(r() * books.length) | 0]!.rect(x, H * (0.14 + (k + 1) * 0.17) - h, w - 1 * u, h);
      }
      x += w;
    }
  const board = new Path2D();
  board.rect(F - 300 * u, H * 0.2, 120 * u, 84 * u);
  const notes: { x: number; y: number; c: RGB }[] = Array.from({ length: 6 }, () => ({ x: F - 294 * u + r() * 86 * u, y: H * 0.2 + 6 * u + r() * 56 * u, c: pick(r, [[240, 224, 130], [240, 170, 170], [170, 220, 200]] as RGB[]) }));
  const plant = new Path2D();
  leafy(plant, F - 170 * u, H * 0.62, 60 * u);
  const view = townView(c);
  const hang = wallDressing(c, 0, F - 330 * u);
  return room(
    c,
    win,
    d.wall,
    view,
    (g, E) => {
      hang(g, E);
      skirting(g, E, c, floor);
      fill(g, frame, shade(E, d.trim, 0.6));
      fill(g, blind, shade(E, d.trim, 0.55));
      spill(g, E, F - 130 * u, F + 90 * u, H * 0.48, floor, 50 * u);
      fill(g, board, shade(E, [170, 134, 96], 0.45));
      for (const n of notes) {
        g.fillStyle = rgb(shade(E, n.c, 0.55));
        g.fillRect(n.x, n.y, 24 * u, 20 * u);
      }
      fill(g, shelf, shade(E, WOOD, 0.45));
      books.forEach((p, i) => fill(g, p, shade(E, hues[i]!, 0.42)));
      fill(g, plant, shade(E, [70, 124, 74], 0.5));
      fill(g, stem, [30, 28, 30]);
      // The screen stays on, and by night it's most of the light in the room.
      const on = after(E);
      fill(g, screen, mix([22, 24, 30], [170, 200, 236], 0.35 + on * 0.55));
      stroke(g, screen, [14, 14, 18], 3 * u);
      glowAt(g, F, H * 0.46, 240 * u, [150, 190, 240], 0.08 + 0.34 * on);
      fill(g, desk, shade(E, d.plain ? [150, 124, 96] : WOOD, 0.5));
      fill(g, drawers, [0, 0, 0], 0.35);
      fill(g, mug, shade(E, [232, 228, 222], 0.6));
      if (E.t >= 6 && E.t < 11) steam(g, E, F + 95 * u, H * 0.62 - 15 * u, u, 3, 3, 0.08);
      fill(g, chair, shade(E, mix(d.soft, DARK, 0.3), 0.4));
    },
    floor,
    { floorHue: d.floorHue },
  );
}

function laundryroom(c: Ctx): Scene {
  const { H, u, F, r } = c;
  const d = dress(c);
  const floor = H * 0.82;
  const wall = mix(d.wall, [228, 228, 224], 0.5);
  const { win, frame } = windowAt(F - 280 * u, H * 0.1, 80 * u, H * 0.22, u, false);
  const machines = new Path2D();
  const xs = [F - 110 * u, F + 16 * u];
  for (const x of xs) rr(machines, x, H * 0.42, 118 * u, floor - H * 0.42 + 4 * u, 5 * u);
  const panels = new Path2D();
  for (const x of xs) panels.rect(x + 6 * u, H * 0.44, 106 * u, 14 * u);
  const shelf = new Path2D();
  shelf.rect(F - 130 * u, H * 0.26, 290 * u, 5 * u);
  const bottles: { x: number; w: number; h: number; c: RGB }[] = [];
  for (let x = F - 118 * u; x < F + 140 * u; x += (26 + r() * 22) * u) bottles.push({ x, w: (16 + r() * 8) * u, h: (26 + r() * 22) * u, c: pick(r, [[70, 130, 190], [230, 230, 226], [220, 120, 70], [110, 170, 140]] as RGB[]) });
  // A drying rack with the washing on it.
  const rx = F + 220 * u;
  const rack = new Path2D();
  rack.moveTo(rx - 60 * u, floor + 6 * u);
  rack.lineTo(rx + 34 * u, H * 0.34);
  rack.moveTo(rx + 60 * u, floor + 6 * u);
  rack.lineTo(rx - 34 * u, H * 0.34);
  rack.moveTo(rx - 42 * u, H * 0.4);
  rack.lineTo(rx + 42 * u, H * 0.4);
  const clothes: { x: number; w: number; h: number; c: RGB }[] = [
    { x: rx - 40 * u, w: 28 * u, h: 66 * u, c: d.fab },
    { x: rx - 8 * u, w: 22 * u, h: 44 * u, c: pick(r, FABRIC) },
    { x: rx + 16 * u, w: 24 * u, h: 58 * u, c: [232, 230, 224] },
  ];
  // The ironing board, on the left.
  const board = new Path2D();
  rr(board, F - 330 * u, H * 0.58, 170 * u, 9 * u, 4 * u);
  const legs = new Path2D();
  legs.moveTo(F - 290 * u, H * 0.6);
  legs.lineTo(F - 220 * u, floor + 4 * u);
  legs.moveTo(F - 220 * u, H * 0.6);
  legs.lineTo(F - 290 * u, floor + 4 * u);
  const sock = new Path2D();
  rr(sock, F - 60 * u, H * 0.9, 26 * u, 10 * u, 4 * u);
  const view = r() < 0.5 ? townView(c) : hillView(c);
  const hang = wallDressing(c, 0, F - 360 * u);
  return room(
    c,
    win,
    wall,
    view,
    (g, E) => {
      hang(g, E);
      skirting(g, E, c, floor);
      fill(g, frame, shade(E, d.trim, 0.6));
      fill(g, shelf, shade(E, WOOD, 0.5));
      for (const b of bottles) {
        g.fillStyle = rgb(shade(E, b.c, 0.55));
        g.fillRect(b.x, H * 0.26 - b.h, b.w, b.h);
      }
      fill(g, machines, shade(E, [232, 232, 230], 0.55));
      fill(g, panels, shade(E, [190, 192, 196], 0.5));
      const T = time(E);
      xs.forEach((x, i) => {
        const cx = x + 59 * u;
        const cy = H * 0.66;
        g.fillStyle = rgb([34, 40, 50]);
        g.beginPath();
        g.arc(cx, cy, 36 * u, 0, TAU);
        g.fill();
        g.strokeStyle = rgb(shade(E, [190, 192, 196], 0.55));
        g.lineWidth = 5 * u;
        g.stroke();
        // The washer's running: its load turns behind the glass.
        if (i === 0) {
          g.fillStyle = rgb(shade(E, d.fab, 0.65), 0.9);
          g.beginPath();
          g.arc(cx + Math.cos(T * 2) * 10 * u, cy + Math.sin(T * 2) * 10 * u + 6 * u, 20 * u, 0, TAU);
          g.fill();
        }
        glowAt(g, x + 100 * u, H * 0.51, 10 * u, i === 0 ? [120, 255, 160] : [255, 120, 110], 0.9);
      });
      stroke(g, rack, shade(E, [190, 190, 196], 0.5), 2.2 * u);
      for (const k of clothes) {
        g.fillStyle = rgb(shade(E, k.c, 0.5));
        g.fillRect(k.x, H * 0.4, k.w, k.h);
      }
      stroke(g, legs, shade(E, [150, 150, 156], 0.5), 2.5 * u);
      fill(g, board, shade(E, mix(d.fab, [230, 228, 224], 0.6), 0.55));
      fill(g, sock, shade(E, [232, 230, 224], 0.55));
      ceilingLight(g, E, { ...d, grand: false, old: false }, F - 190 * u, H * 0.05, u);
    },
    floor,
    { floorHue: mix(d.floorHue, [160, 160, 164], 0.5) },
  );
}

function basement(c: Ctx): Scene {
  const { W, H, u, F, r } = c;
  const floor = H * 0.84;
  // Two slits up at ground level: all the daylight there is.
  const win = new Path2D();
  const slits = [F - 360 * u, F - 80 * u];
  for (const x of slits) win.rect(x, H * 0.09, 84 * u, 26 * u);
  const frame = new Path2D();
  for (const x of slits) panes(frame, x, H * 0.09, 84 * u, 26 * u, 2, 1, 1.6 * u);
  const blocks = new Path2D();
  grid(blocks, 0, H * 0.02, W, floor, 54 * u, 24 * u, true);
  const pipes = new Path2D();
  pipes.rect(0, H * 0.02, W, 8 * u);
  pipes.rect(0, H * 0.05, W, 5 * u);
  pipes.rect(F + 150 * u, H * 0.05, 7 * u, H * 0.25);
  // The furnace.
  const bx = F - 250 * u;
  const furnace = new Path2D();
  rr(furnace, bx - 60 * u, H * 0.34, 120 * u, floor - H * 0.34, 8 * u);
  furnace.rect(bx - 12 * u, H * 0.05, 24 * u, H * 0.3);
  const hatch = new Path2D();
  hatch.rect(bx - 24 * u, H * 0.62, 48 * u, 30 * u);
  // Bare stairs down from the right.
  const x0 = F + 110 * u;
  const x1 = F + 370 * u;
  const stairs = new Path2D();
  const n = 9;
  for (let i = 0; i < n; i++) {
    const t = i / n;
    const x = x0 + (x1 - x0) * t;
    const y = floor - (floor - H * 0.1) * t;
    stairs.rect(x, y - 6 * u, 48 * u, 6 * u);
  }
  const stringer = new Path2D();
  stringer.moveTo(x0, floor + 2 * u);
  stringer.lineTo(x1 + 30 * u, H * 0.08);
  const rail = new Path2D();
  rail.moveTo(x0 + 4 * u, floor - 70 * u);
  rail.lineTo(x1 + 30 * u, H * 0.08 - 70 * u);
  const shelf = new Path2D();
  for (const y of [0.42, 0.62]) shelf.rect(F - 120 * u, H * y, 170 * u, 4 * u);
  for (const x of [F - 120 * u, F + 46 * u]) shelf.rect(x, H * 0.42, 4 * u, floor - H * 0.42);
  const boxes: { x: number; y: number; w: number; h: number; c: RGB }[] = [];
  for (const y of [0.42, 0.62, 0.84])
    for (let x = F - 112 * u; x < F + 24 * u; x += (44 + r() * 20) * u) if (r() < 0.8) boxes.push({ x, y: H * y, w: (34 + r() * 8) * u, h: (22 + r() * 18) * u, c: pick(r, [[176, 140, 96], [150, 120, 90], [90, 100, 110]] as RGB[]) });
  const bulbX = F - 20 * u;
  const stain = new Path2D();
  ellipse(stain, bx + 80 * u, H * 0.92, 80 * u, 8 * u);
  const view = hillView(c);
  return room(
    c,
    win,
    [132, 130, 126],
    view,
    (g, E) => {
      stroke(g, blocks, [0, 0, 0], 1 * u, 0.22);
      fill(g, frame, shade(E, [90, 88, 84], 0.5));
      fill(g, pipes, shade(E, [120, 96, 74], 0.42));
      fill(g, furnace, shade(E, [100, 100, 104], 0.42));
      fill(g, hatch, [20, 14, 12]);
      // The pilot light, and the bulb swinging a little on its cord.
      glowAt(g, bx, H * 0.66, 70 * u, [255, 130, 50], 0.55);
      fill(g, stain, [0, 0, 0], 0.25);
      fill(g, shelf, shade(E, [90, 84, 80], 0.42));
      for (const b of boxes) {
        g.fillStyle = rgb(shade(E, b.c, 0.42));
        g.fillRect(b.x, b.y - b.h, b.w, b.h);
      }
      stroke(g, stringer, shade(E, WOOD, 0.42), 9 * u);
      fill(g, stairs, shade(E, mix(WOOD, [190, 170, 140], 0.25), 0.45));
      stroke(g, rail, shade(E, WOOD, 0.42), 3.5 * u);
      const swing = E.still ? 0 : Math.sin(E.T * 0.9) * 6 * u;
      g.strokeStyle = "rgb(24,20,18)";
      g.lineWidth = 1 * u;
      g.beginPath();
      g.moveTo(bulbX, H * 0.05);
      g.lineTo(bulbX + swing, H * 0.28);
      g.stroke();
      lamp(g, E, bulbX + swing, H * 0.3, 90 * u, 3, WARM, 0.8);
      glowAt(g, bulbX + swing, H * 0.3, 300 * u, WARM, 0.34);
    },
    floor,
    { lift: 0.1, floorHue: [96, 94, 92] },
  );
}

function garage(c: Ctx): Scene {
  const { H, u, F, r } = c;
  const d = dress(c);
  const floor = H * 0.84;
  const open = r() < 0.6;
  const dx = F - 400 * u;
  const dw = 290 * u;
  const dy = H * 0.16;
  const win = new Path2D();
  if (open) win.rect(dx, dy + H * 0.2, dw, floor - dy - H * 0.2);
  else for (let k = 0; k < 4; k++) win.rect(dx + 16 * u + k * 68 * u, dy + 14 * u, 54 * u, 22 * u);
  const door = new Path2D();
  door.rect(dx, dy, dw, open ? H * 0.2 : floor - dy);
  const ribs = new Path2D();
  for (let y = dy + (open ? 18 : 48) * u; y < (open ? dy + H * 0.2 : floor); y += 30 * u) ribs.rect(dx, y, dw, 1.5 * u);
  const jamb = new Path2D();
  jamb.rect(dx - 8 * u, dy - 8 * u, dw + 16 * u, 8 * u);
  jamb.rect(dx - 8 * u, dy, 8 * u, floor - dy);
  jamb.rect(dx + dw, dy, 8 * u, floor - dy);
  // The car, side on.
  const cx = F - 10 * u;
  const car = new Path2D();
  car.moveTo(cx - 170 * u, floor - 18 * u);
  car.lineTo(cx - 170 * u, floor - 50 * u);
  car.quadraticCurveTo(cx - 168 * u, floor - 62 * u, cx - 120 * u, floor - 68 * u);
  car.lineTo(cx - 70 * u, floor - 112 * u);
  car.quadraticCurveTo(cx - 60 * u, floor - 118 * u, cx + 56 * u, floor - 116 * u);
  car.lineTo(cx + 110 * u, floor - 72 * u);
  car.quadraticCurveTo(cx + 166 * u, floor - 66 * u, cx + 176 * u, floor - 48 * u);
  car.lineTo(cx + 176 * u, floor - 18 * u);
  car.closePath();
  const glass = new Path2D();
  poly(glass, cx - 100 * u, floor - 70 * u, cx - 62 * u, floor - 108 * u, cx - 6 * u, floor - 108 * u, cx - 6 * u, floor - 70 * u);
  poly(glass, cx + 4 * u, floor - 70 * u, cx + 4 * u, floor - 108 * u, cx + 50 * u, floor - 108 * u, cx + 90 * u, floor - 70 * u);
  const wheels = new Path2D();
  for (const x of [cx - 104 * u, cx + 112 * u]) circle(wheels, x, floor - 16 * u, 26 * u);
  const hubs = new Path2D();
  for (const x of [cx - 104 * u, cx + 112 * u]) circle(hubs, x, floor - 16 * u, 11 * u);
  // The bench and its tools.
  const bx = F + 210 * u;
  const bench = new Path2D();
  bench.rect(bx, H * 0.6, 170 * u, 8 * u);
  for (const x of [bx + 6 * u, bx + 156 * u]) bench.rect(x, H * 0.6, 8 * u, floor - H * 0.6);
  const peg = new Path2D();
  peg.rect(bx, H * 0.22, 170 * u, H * 0.3);
  const tools: { x: number; h: number }[] = [];
  for (let x = bx + 14 * u; x < bx + 158 * u; x += (22 + r() * 12) * u) tools.push({ x, h: (26 + r() * 38) * u });
  const can = new Path2D();
  rr(can, bx + 40 * u, H * 0.6 - 30 * u, 26 * u, 30 * u, 3 * u);
  const strip = new Path2D();
  strip.rect(cx - 90 * u, H * 0.06, 180 * u, 6 * u);
  const oil = new Path2D();
  ellipse(oil, cx + 30 * u, H * 0.9, 50 * u, 6 * u);
  const hue = pick(r, [[150, 40, 44], [40, 70, 110], [200, 196, 190], [60, 64, 70], [190, 140, 60]] as RGB[]);
  const view = r() < 0.5 ? townView(c) : hillView(c);
  return room(
    c,
    win,
    mix(d.wall, [170, 170, 168], 0.6),
    view,
    (g, E) => {
      const hole = new Path2D();
      hole.addPath(door);
      if (!open) hole.addPath(win);
      g.fillStyle = rgb(shade(E, d.trim, 0.5));
      g.fill(hole, "evenodd");
      fill(g, ribs, [0, 0, 0], 0.18);
      fill(g, jamb, shade(E, mix(d.trim, DARK, 0.2), 0.45));
      if (open) spill(g, E, dx, dx + dw, floor, H, 60 * u);
      fill(g, peg, shade(E, [170, 134, 96], 0.42));
      g.fillStyle = rgb(shade(E, [70, 70, 76], 0.45));
      for (const t of tools) {
        g.fillRect(t.x, H * 0.24, 4 * u, t.h);
        g.fillRect(t.x - 5 * u, H * 0.24, 14 * u, 7 * u);
      }
      fill(g, bench, shade(E, WOOD, 0.5));
      fill(g, can, shade(E, [170, 50, 44], 0.5));
      fill(g, oil, [0, 0, 0], 0.3);
      fill(g, car, shade(E, hue, 0.55));
      fill(g, glass, mix(shade(E, [90, 110, 130], 0.5), E.sky.bot, 0.2));
      fill(g, wheels, [20, 20, 22]);
      fill(g, hubs, shade(E, [170, 172, 176], 0.5));
      const on = lampsOn(E, 0.2);
      fill(g, strip, mix([200, 204, 210], [255, 255, 240], on));
      glowAt(g, cx, H * 0.14, 300 * u, [235, 240, 255], 0.3 * on);
    },
    floor,
    { floorHue: [122, 122, 124] },
  );
}

// ---------- At the door ----------

function porch(c: Ctx): Scene {
  const { W, H, u, F, r } = c;
  const d = dress(c);
  const floor = H * 0.78;
  const roof = H * 0.13;
  const edge = F + 150 * u;
  // Everything out past the house wall is open air, so the sky and the weather come right in.
  const win = new Path2D();
  win.rect(0, roof, edge, floor - roof);
  const roofP = new Path2D();
  roofP.rect(0, 0, W, roof);
  const beam = new Path2D();
  beam.rect(0, roof - 6 * u, edge, 12 * u);
  const posts = new Path2D();
  for (let x = F - 620 * u; x < edge - 20 * u; x += 230 * u) posts.rect(x, roof, 13 * u, floor - roof);
  const railing = new Path2D();
  railing.rect(0, H * 0.54, edge, 5 * u);
  railing.rect(0, floor - 10 * u, edge, 5 * u);
  for (let x = 6 * u; x < edge; x += 15 * u) railing.rect(x, H * 0.54, 3 * u, floor - H * 0.54);
  const boards = new Path2D();
  for (let y = floor + 8 * u; y < H; y += 12 * u) boards.rect(0, y, W, 1.2 * u);
  // The house wall, with the screen door.
  const wall = new Path2D();
  wall.rect(edge, roof - 6 * u, W - edge, floor - roof + 6 * u);
  const clap = new Path2D();
  for (let y = roof + 8 * u; y < floor; y += 13 * u) clap.rect(edge, y, W - edge, 1.2 * u);
  const dx = edge + 54 * u;
  const door = new Path2D();
  door.rect(dx, H * 0.2, 86 * u, floor - H * 0.2);
  const mesh = new Path2D();
  mesh.rect(dx + 8 * u, H * 0.23, 70 * u, H * 0.24);
  mesh.rect(dx + 8 * u, H * 0.5, 70 * u, floor - H * 0.5 - 8 * u);
  // The swing, hung on two chains.
  const sx = F - 250 * u;
  const seat = new Path2D();
  rr(seat, sx - 74 * u, H * 0.42, 148 * u, 42 * u, 7 * u);
  seat.rect(sx - 74 * u, H * 0.54, 148 * u, 10 * u);
  const chains = new Path2D();
  for (const dx2 of [-68, 68]) {
    chains.moveTo(sx + dx2 * u, roof);
    chains.lineTo(sx + dx2 * u, H * 0.55);
  }
  const fern = new Path2D();
  leafy(fern, F + 40 * u, floor - 40 * u, 58 * u);
  const pot = new Path2D();
  poly(pot, F + 24 * u, floor - 42 * u, F + 56 * u, floor - 42 * u, F + 50 * u, floor, F + 30 * u, floor);
  const mat = new Path2D();
  poly(mat, dx - 8 * u, floor + 4 * u, dx + 94 * u, floor + 4 * u, dx + 106 * u, floor + 24 * u, dx - 20 * u, floor + 24 * u);
  const view = r() < 0.5 ? townView(c) : hillView(c);
  return room(
    c,
    win,
    d.trim,
    view,
    (g, E) => {
      fill(g, roofP, shade(E, mix(d.trim, DARK, 0.25), 0.4));
      fill(g, wall, shade(E, d.wall, 0.5));
      fill(g, clap, [0, 0, 0], 0.16);
      fill(g, boards, [0, 0, 0], 0.2);
      fill(g, beam, shade(E, d.trim, 0.5));
      fill(g, railing, shade(E, d.trim, 0.55));
      fill(g, posts, shade(E, d.trim, 0.55));
      stroke(g, chains, shade(E, [90, 90, 96], 0.5), 1.4 * u);
      fill(g, seat, shade(E, d.old ? WOOD : mix(d.trim, WOOD, 0.4), 0.5));
      fill(g, pot, shade(E, [180, 110, 80], 0.5));
      fill(g, fern, shade(E, [70, 124, 74], 0.5));
      fill(g, door, shade(E, d.old ? WOOD : mix(d.fab, d.trim, 0.3), 0.5));
      // Lamplight from inside, through the screen, and the porch light once it's getting dark.
      const on = after(E);
      fill(g, mesh, mix(shade(E, [40, 42, 48], 0.4), [255, 214, 150], 0.65 * on), 0.9);
      fill(g, mat, shade(E, [150, 120, 90], 0.45));
      if (d.old) {
        lamp(g, E, dx - 30 * u, H * 0.26, 90 * u, 7, WARM, 0.05);
      } else {
        g.fillStyle = rgb(shade(E, [60, 54, 50]));
        g.fillRect(dx - 36 * u, H * 0.22, 12 * u, 22 * u);
        lamp(g, E, dx - 30 * u, H * 0.24, 200 * u, 7, WARM, 0);
      }
    },
    floor,
    { floorHue: mix(d.floorHue, d.trim, 0.3) },
  );
}

export const HOME_SCENES = {
  dining,
  den,
  hometheater,
  homelibrary,
  masterbedroom,
  nursery,
  foyer,
  hallway,
  staircase,
  homeoffice,
  laundryroom,
  basement,
  garage,
  porch,
} satisfies Partial<Record<Place, (c: Ctx) => Scene>>;
