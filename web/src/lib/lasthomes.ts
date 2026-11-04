/**
 * The last wave of the house's rooms (docs/24-rooms-of-the-house.md §3): the specific and the
 * dramatic. Painted and dressed like homescenes.ts.
 */
import { after, candle, dress, windowAt } from "./homescenes";
import { DARK, FABRIC, mix, rgb, TAU, WARM, type Ctx, type Env, type Place, type RGB } from "./places";
import { ellipse, grid, lampsOn, none, pick, rr, shut, steam, time } from "./scenebits";
import { fill, fire, fireflies, glowAt, hillView, lamp, leafy, motes, panes, poly, room, SCENES, shade, skirting, spill, stroke, STONE, townView, wallDressing, water, WOOD, shims, type Scene } from "./scenes";

type G = CanvasRenderingContext2D;

const beachView = (c: Ctx) => {
  const s = SCENES.beach(c);
  return (g: G, E: Env) => s.draw(g, E);
};

// ---------- Leisure rooms ----------

function playroom(c: Ctx): Scene {
  const { H, u, F, r } = c;
  const d = dress(c);
  const floor = H * 0.8;
  const wall = mix(d.wall, pick(r, [[240, 214, 150], [190, 220, 180], [170, 206, 226]] as RGB[]), d.old ? 0.1 : 0.55);
  const { win, frame } = windowAt(F - 330 * u, H * 0.12, 100 * u, H * 0.38, u, d.old);
  // A low run of toy shelves, a chest, and a play tent in the middle of the floor.
  const shelf = new Path2D();
  shelf.rect(F + 130 * u, H * 0.5, 210 * u, 5 * u);
  shelf.rect(F + 130 * u, H * 0.65, 210 * u, 5 * u);
  for (const x of [F + 130 * u, F + 233 * u, F + 336 * u]) shelf.rect(x, H * 0.5, 5 * u, floor - H * 0.5);
  const toys: { x: number; y: number; s: number; c: RGB; round: boolean }[] = [];
  for (const y of [0.5, 0.65, 0.8]) for (let x = F + 140 * u; x < F + 326 * u; x += (26 + r() * 14) * u) toys.push({ x, y: H * y, s: (12 + r() * 12) * u, c: pick(r, FABRIC), round: r() < 0.45 });
  const tx = F - 60 * u;
  const tent = new Path2D();
  poly(tent, tx, H * 0.26, tx + 104 * u, floor + 6 * u, tx - 104 * u, floor + 6 * u);
  const flap = new Path2D();
  poly(flap, tx, H * 0.48, tx + 32 * u, floor + 6 * u, tx - 32 * u, floor + 6 * u);
  const poles = new Path2D();
  for (const dx of [-14, 14]) {
    poles.moveTo(tx + dx * u, H * 0.2);
    poles.lineTo(tx - dx * 7 * u, floor + 6 * u);
  }
  const chest = new Path2D();
  rr(chest, F - 250 * u, H * 0.62, 104 * u, floor - H * 0.62 + 4 * u, 8 * u);
  const scatter: { x: number; y: number; s: number; c: RGB }[] = Array.from({ length: 11 }, () => ({ x: F - 300 * u + r() * 620 * u, y: H * (0.86 + r() * 0.1), s: (6 + r() * 7) * u, c: pick(r, FABRIC) }));
  const rug = new Path2D();
  ellipse(rug, tx, H * 0.91, 230 * u, 16 * u);
  const view = townView(c);
  const hang = wallDressing(c, 0, F - 370 * u);
  return room(
    c,
    win,
    wall,
    view,
    (g, E) => {
      hang(g, E);
      skirting(g, E, c, floor);
      fill(g, frame, shade(E, d.trim, 0.6));
      spill(g, E, F - 330 * u, F - 230 * u, H * 0.5, floor, 70 * u);
      fill(g, shelf, shade(E, WOOD, 0.45));
      for (const t of toys) {
        g.fillStyle = rgb(shade(E, t.c, 0.6));
        if (t.round) {
          g.beginPath();
          g.arc(t.x + t.s / 2, t.y - t.s / 2, t.s / 2, 0, TAU);
          g.fill();
        } else g.fillRect(t.x, t.y - t.s, t.s, t.s);
      }
      fill(g, rug, shade(E, mix(d.fab, [230, 220, 200], 0.5), 0.42));
      fill(g, chest, shade(E, d.old ? WOOD : mix(d.fab, d.trim, 0.3), 0.5));
      stroke(g, poles, shade(E, WOOD, 0.5), 3 * u);
      fill(g, tent, shade(E, mix(d.fab, [240, 230, 210], 0.45), 0.55));
      fill(g, flap, mix(shade(E, [40, 34, 44], 0.3), [255, 214, 150], 0.5 * after(E)));
      for (const t of scatter) {
        g.fillStyle = rgb(shade(E, t.c, 0.6));
        g.fillRect(t.x, t.y, t.s, t.s);
      }
    },
    floor,
    { floorHue: d.floorHue },
  );
}

function craftroom(c: Ctx): Scene {
  const { H, u, F, r } = c;
  const d = dress(c);
  const floor = H * 0.82;
  const { win, frame } = windowAt(F - 150 * u, H * 0.1, 200 * u, H * 0.36, u, d.old);
  const table = new Path2D();
  table.rect(F - 190 * u, H * 0.6, 290 * u, 8 * u);
  for (const x of [F - 182 * u, F + 86 * u]) table.rect(x, H * 0.6, 6 * u, floor - H * 0.6);
  // The sewing machine, its arm and wheel.
  const mx = F - 60 * u;
  const machine = new Path2D();
  rr(machine, mx - 56 * u, H * 0.56, 112 * u, 14 * u, 3 * u);
  rr(machine, mx + 28 * u, H * 0.42, 26 * u, 44 * u, 4 * u);
  rr(machine, mx - 50 * u, H * 0.4, 104 * u, 18 * u, 6 * u);
  machine.rect(mx - 46 * u, H * 0.46, 8 * u, 24 * u);
  const cloth = new Path2D();
  poly(cloth, mx - 40 * u, H * 0.6, mx - 150 * u, H * 0.6, mx - 170 * u, H * 0.8, mx - 110 * u, H * 0.74);
  // The dress form, on its stand.
  const fx = F + 170 * u;
  const form = new Path2D();
  form.moveTo(fx - 30 * u, H * 0.24);
  form.quadraticCurveTo(fx, H * 0.2, fx + 30 * u, H * 0.24);
  form.quadraticCurveTo(fx + 40 * u, H * 0.34, fx + 22 * u, H * 0.42);
  form.quadraticCurveTo(fx + 44 * u, H * 0.54, fx + 34 * u, H * 0.62);
  form.lineTo(fx - 34 * u, H * 0.62);
  form.quadraticCurveTo(fx - 44 * u, H * 0.54, fx - 22 * u, H * 0.42);
  form.quadraticCurveTo(fx - 40 * u, H * 0.34, fx - 30 * u, H * 0.24);
  const stand = new Path2D();
  stand.rect(fx - 2.5 * u, H * 0.62, 5 * u, floor - H * 0.62);
  ellipse(stand, fx, floor, 26 * u, 4 * u);
  // Bolts of fabric on shelves.
  const sx = F + 240 * u;
  const shelf = new Path2D();
  for (const y of [0.3, 0.46, 0.62]) shelf.rect(sx, H * y, 140 * u, 4 * u);
  const bolts: { x: number; y: number; c: RGB }[] = [];
  for (const y of [0.3, 0.46, 0.62]) for (let x = sx + 4 * u; x < sx + 124 * u; x += 20 * u) bolts.push({ x, y: H * y, c: pick(r, [...FABRIC, d.fab, [230, 224, 210]] as RGB[]) });
  const view = r() < 0.5 ? townView(c) : hillView(c);
  const hang = wallDressing(c, 0, F - 240 * u);
  return room(
    c,
    win,
    d.wall,
    view,
    (g, E) => {
      hang(g, E);
      skirting(g, E, c, floor);
      fill(g, frame, shade(E, d.trim, 0.6));
      spill(g, E, F - 150 * u, F + 50 * u, H * 0.46, floor, 50 * u);
      fill(g, shelf, shade(E, WOOD, 0.45));
      for (const b of bolts) {
        g.fillStyle = rgb(shade(E, b.c, 0.5));
        g.fillRect(b.x, b.y - 30 * u, 17 * u, 30 * u);
      }
      fill(g, stand, shade(E, WOOD, 0.45));
      fill(g, form, shade(E, [212, 198, 170], 0.55));
      fill(g, table, shade(E, WOOD, 0.5));
      fill(g, cloth, shade(E, d.fab, 0.5));
      fill(g, machine, shade(E, d.old ? [40, 36, 38] : [226, 222, 212], 0.55));
      // A lamp over the needle.
      if (d.old) candle(g, E, mx + 72 * u, H * 0.6, u);
      else lamp(g, E, mx - 42 * u, H * 0.47, 110 * u, 2, WARM, 0.1);
    },
    floor,
    { floorHue: d.floorHue },
  );
}

function atelier(c: Ctx): Scene {
  const { W, H, u, F, r } = c;
  const d = dress(c);
  const floor = H * 0.82;
  // A slanted north skylight: all the weather a painter wants to know about.
  const win = new Path2D();
  poly(win, F - 280 * u, H * 0.02, F + 110 * u, H * 0.02, F + 70 * u, H * 0.3, F - 320 * u, H * 0.3);
  const frame = new Path2D();
  for (let k = 0; k <= 4; k++) {
    const t = k / 4;
    frame.moveTo(F - 280 * u + t * 390 * u, H * 0.02);
    frame.lineTo(F - 320 * u + t * 390 * u, H * 0.3);
  }
  frame.moveTo(F - 300 * u, H * 0.16);
  frame.lineTo(F + 90 * u, H * 0.16);
  // The easel, with work on it.
  const ex = F - 60 * u;
  const easel = new Path2D();
  easel.moveTo(ex, H * 0.32);
  easel.lineTo(ex - 60 * u, floor + 4 * u);
  easel.moveTo(ex, H * 0.32);
  easel.lineTo(ex + 60 * u, floor + 4 * u);
  easel.moveTo(ex, H * 0.32);
  easel.lineTo(ex, floor + 4 * u);
  easel.moveTo(ex - 44 * u, H * 0.72);
  easel.lineTo(ex + 44 * u, H * 0.72);
  const canvas = new Path2D();
  canvas.rect(ex - 58 * u, H * 0.38, 116 * u, H * 0.33);
  const dabs: { x: number; y: number; s: number; c: RGB }[] = Array.from({ length: 12 }, () => ({ x: ex - 50 * u + r() * 96 * u, y: H * 0.41 + r() * H * 0.26, s: (5 + r() * 12) * u, c: pick(r, FABRIC) }));
  const stool = new Path2D();
  rr(stool, ex - 140 * u, H * 0.68, 46 * u, 8 * u, 3 * u);
  for (const x of [ex - 136 * u, ex - 102 * u]) stool.rect(x, H * 0.68, 4 * u, floor - H * 0.68);
  // Canvases stacked against the wall, faces turned in.
  const stack: { x: number; w: number; h: number }[] = [];
  for (let x = F + 130 * u; x < F + 340 * u; x += (34 + r() * 18) * u) stack.push({ x, w: (68 + r() * 40) * u, h: (70 + r() * 60) * u });
  const bench = new Path2D();
  bench.rect(F - 390 * u, H * 0.62, 150 * u, 6 * u);
  for (const x of [F - 386 * u, F - 248 * u]) bench.rect(x, H * 0.62, 5 * u, floor - H * 0.62);
  const jars: { x: number; c: RGB }[] = [0, 26, 52, 78, 104].map((dx) => ({ x: F - 380 * u + dx * u, c: pick(r, FABRIC) }));
  const spatter = new Path2D();
  for (let k = 0; k < 18; k++) ellipse(spatter, ex - 200 * u + r() * 420 * u, H * (0.86 + r() * 0.11), (3 + r() * 5) * u, 1.5 * u);
  const view = hillView(c);
  void W;
  const hang = wallDressing(c, 0, F - 420 * u);
  return room(
    c,
    win,
    mix(d.wall, [228, 224, 214], 0.65),
    view,
    (g, E) => {
      hang(g, E);
      skirting(g, E, c, floor);
      stroke(g, frame, shade(E, [60, 56, 54], 0.45), 3.5 * u);
      spill(g, E, F - 300 * u, F + 80 * u, H * 0.3, floor, 30 * u);
      for (const s of stack) {
        g.fillStyle = rgb(shade(E, [190, 170, 136], 0.5));
        g.fillRect(s.x, floor - s.h, s.w, s.h);
        g.strokeStyle = rgb(shade(E, [120, 96, 70], 0.5));
        g.lineWidth = 3 * u;
        g.strokeRect(s.x, floor - s.h, s.w, s.h);
      }
      fill(g, bench, shade(E, WOOD, 0.45));
      for (const j of jars) {
        g.fillStyle = rgb(shade(E, j.c, 0.55));
        g.fillRect(j.x, H * 0.62 - 20 * u, 18 * u, 20 * u);
      }
      fill(g, spatter, shade(E, d.fab, 0.5), 0.6);
      stroke(g, easel, shade(E, WOOD, 0.5), 4.5 * u);
      fill(g, canvas, shade(E, [240, 236, 226], 0.6));
      for (const k of dabs) {
        g.fillStyle = rgb(shade(E, k.c, 0.6), 0.85);
        g.beginPath();
        g.ellipse(k.x, k.y, k.s, k.s * 0.6, k.s, 0, TAU);
        g.fill();
      }
      fill(g, stool, shade(E, WOOD, 0.45));
      if (d.old) candle(g, E, F - 250 * u, H * 0.62, u);
    },
    floor,
    { floorHue: mix(d.floorHue, [180, 170, 156], 0.4) },
  );
}

function trophyroom(c: Ctx): Scene {
  const { W, H, u, F, r } = c;
  const d = dress(c);
  const floor = H * 0.82;
  const wood = new Path2D();
  wood.rect(0, 0, W, floor);
  const panels = new Path2D();
  grid(panels, 0, H * 0.04, W, floor, 80 * u, floor - H * 0.04);
  // Mounted heads along the wall: the room's whole point.
  const heads: Path2D[] = [];
  for (let k = -2; k <= 2; k++) {
    const x = F + k * 130 * u;
    const y = H * 0.26;
    const p = new Path2D();
    rr(p, x - 22 * u, y - 8 * u, 44 * u, 28 * u, 6 * u);
    p.moveTo(x - 16 * u, y + 16 * u);
    p.lineTo(x + 16 * u, y + 16 * u);
    p.lineTo(x + 7 * u, y + 54 * u);
    p.lineTo(x - 7 * u, y + 54 * u);
    p.closePath();
    // Antlers.
    for (const s of [-1, 1]) {
      p.moveTo(x + s * 10 * u, y - 8 * u);
      p.lineTo(x + s * 42 * u, y - 44 * u);
      p.lineTo(x + s * 38 * u, y - 44 * u);
      p.lineTo(x + s * 26 * u, y - 30 * u);
      p.lineTo(x + s * 22 * u, y - 48 * u);
      p.lineTo(x + s * 18 * u, y - 46 * u);
      p.lineTo(x + s * 20 * u, y - 26 * u);
      p.lineTo(x + s * 6 * u, y - 10 * u);
      p.closePath();
    }
    heads.push(p);
  }
  const plaques = new Path2D();
  for (let k = -2; k <= 2; k++) rr(plaques, F + k * 130 * u - 30 * u, H * 0.2, 60 * u, 74 * u, 10 * u);
  // A glass case of silver, a leather chair.
  const cx = F - 400 * u;
  const case_ = new Path2D();
  case_.rect(cx, H * 0.46, 150 * u, H * 0.24);
  const base = new Path2D();
  base.rect(cx - 5 * u, H * 0.7, 160 * u, floor - H * 0.7);
  const cups: { x: number; h: number }[] = [];
  for (let x = cx + 12 * u; x < cx + 130 * u; x += (26 + r() * 12) * u) cups.push({ x, h: (20 + r() * 26) * u });
  const chair = new Path2D();
  rr(chair, F + 90 * u, H * 0.5, 120 * u, floor - H * 0.5 - 2 * u, 18 * u);
  rr(chair, F + 76 * u, H * 0.6, 28 * u, floor - H * 0.6 - 2 * u, 12 * u);
  rr(chair, F + 196 * u, H * 0.6, 28 * u, floor - H * 0.6 - 2 * u, 12 * u);
  const seat = new Path2D();
  rr(seat, F + 100 * u, H * 0.68, 100 * u, 22 * u, 8 * u);
  const rug = new Path2D();
  ellipse(rug, F, H * 0.92, 300 * u, 15 * u);
  return room(
    c,
    shut(),
    mix(WOOD, DARK, 0.25),
    none,
    (g, E) => {
      const on = lampsOn(E, 0.45);
      fill(g, wood, mix(mix(WOOD, DARK, 0.65), WOOD, 0.3 * on + 0.1));
      stroke(g, panels, [0, 0, 0], 1.5 * u, 0.32);
      fill(g, plaques, mix(mix([70, 44, 30], DARK, 0.5), [120, 80, 56], on * 0.6));
      for (const p of heads) fill(g, p, mix(mix([110, 80, 54], DARK, 0.6), [176, 140, 100], on * 0.7));
      fill(g, base, shade(E, WOOD, 0.42));
      fill(g, case_, mix([40, 44, 52], [150, 164, 170], on * 0.5), 0.75);
      for (const k of cups) {
        g.fillStyle = rgb(mix([120, 120, 124], [250, 244, 220], on));
        g.fillRect(k.x, H * 0.7 - k.h, 12 * u, k.h);
      }
      fill(g, rug, mix(mix(d.fab, DARK, 0.75), d.fab, 0.3 * on), 0.9);
      fill(g, chair, mix(mix([90, 50, 34], DARK, 0.6), [126, 74, 46], on * 0.7));
      fill(g, seat, mix(mix([110, 64, 42], DARK, 0.5), [146, 90, 58], on * 0.7));
      for (let k = -2; k <= 2; k++) glowAt(g, F + k * 130 * u, H * 0.14, 90 * u, WARM, 0.28 * on);
      if (d.old) candle(g, E, F + 250 * u, H * 0.8, u);
    },
    floor,
    { lift: 0.3, space: true, floorHue: d.floorHue },
  );
}

function winecellar(c: Ctx): Scene {
  const { W, H, u, F, r } = c;
  const floor = H * 0.86;
  const bricks = new Path2D();
  grid(bricks, 0, 0, W, floor, 30 * u, 13 * u, true);
  // Arched bays, floor to ceiling in bottle ends.
  const bays = [F - 400 * u, F - 170 * u, F + 170 * u];
  const arches: Path2D[] = [];
  const ends: { x: number; y: number; c: RGB }[] = [];
  for (const x of bays) {
    const a = new Path2D();
    a.moveTo(x, floor);
    a.lineTo(x, H * 0.3);
    a.quadraticCurveTo(x + 90 * u, H * 0.03, x + 180 * u, H * 0.3);
    a.lineTo(x + 180 * u, floor);
    a.closePath();
    arches.push(a);
    for (let y = H * 0.34; y < floor - 8 * u; y += 15 * u)
      for (let bx = x + 10 * u; bx < x + 172 * u; bx += 15 * u) {
        const lift = Math.abs(bx - (x + 90 * u)) / (90 * u);
        if (y > H * 0.15 + H * 0.18 * lift * lift) ends.push({ x: bx, y, c: pick(r, [[40, 60, 44], [30, 40, 30], [70, 40, 34], [56, 50, 30]] as RGB[]) });
      }
  }
  // A barrel and a tasting table under the one lamp.
  const tx = F - 20 * u;
  const barrel = new Path2D();
  rr(barrel, tx - 66 * u, H * 0.56, 132 * u, floor - H * 0.56, 42 * u);
  const hoops = new Path2D();
  for (const y of [0.64, 0.72, 0.8]) hoops.rect(tx - 64 * u, H * y, 128 * u, 3 * u);
  const top = new Path2D();
  ellipse(top, tx, H * 0.56, 50 * u, 6 * u);
  const bottle = new Path2D();
  rr(bottle, tx - 30 * u, H * 0.42, 12 * u, 38 * u, 3 * u);
  bottle.rect(tx - 27 * u, H * 0.37, 6 * u, 16 * u);
  const glass = new Path2D();
  ellipse(glass, tx + 18 * u, H * 0.48, 9 * u, 12 * u);
  glass.rect(tx + 17 * u, H * 0.5, 2 * u, 18 * u);
  return room(
    c,
    shut(),
    [120, 76, 62],
    none,
    (g, E) => {
      stroke(g, bricks, [24, 14, 12], 0.9 * u, 0.4);
      arches.forEach((a) => {
        fill(g, a, [18, 12, 12]);
        stroke(g, a, mix([70, 50, 44], [150, 110, 88], 0.4), 6 * u);
      });
      for (const e of ends) {
        g.fillStyle = rgb(e.c);
        g.beginPath();
        g.arc(e.x, e.y, 5 * u, 0, TAU);
        g.fill();
      }
      fill(g, barrel, shade(E, [110, 70, 44], 0.5));
      fill(g, hoops, shade(E, [60, 52, 48]));
      fill(g, top, shade(E, [130, 88, 58], 0.5));
      fill(g, bottle, [28, 48, 36]);
      fill(g, glass, [120, 30, 44], 0.85);
      lamp(g, E, tx, H * 0.1, 80 * u, 3, WARM, 0.85);
      glowAt(g, tx, H * 0.34, 340 * u, WARM, 0.42);
    },
    floor,
    { lift: 0.28, space: true, floorHue: [96, 84, 76] },
  );
}

function sauna(c: Ctx): Scene {
  const { W, H, u, F } = c;
  const floor = H * 0.86;
  const slats = new Path2D();
  grid(slats, 0, 0, W, floor, 0, 19 * u);
  // Two tiers of slatted bench, and the stove with its stones.
  const tiers = new Path2D();
  tiers.rect(0, H * 0.46, F + 170 * u, 14 * u);
  tiers.rect(0, H * 0.68, F + 170 * u, 14 * u);
  const fronts = new Path2D();
  for (let x = 8 * u; x < F + 170 * u; x += 22 * u) {
    fronts.rect(x, H * 0.5, 16 * u, H * 0.18);
    fronts.rect(x, H * 0.72, 16 * u, floor - H * 0.72);
  }
  const sx = F + 280 * u;
  const stove = new Path2D();
  rr(stove, sx - 54 * u, H * 0.54, 108 * u, floor - H * 0.54, 7 * u);
  const stones: [number, number, number][] = [];
  for (let k = 0; k < 11; k++) stones.push([sx - 46 * u + (k % 6) * 19 * u, H * 0.53 - (k > 5 ? 13 * u : 0), (9 + (k % 3) * 2) * u]);
  const door = new Path2D();
  rr(door, F - 150 * u, H * 0.08, 96 * u, H * 0.34, 4 * u);
  const bucket = new Path2D();
  poly(bucket, F + 90 * u, H * 0.68 - 34 * u, F + 134 * u, H * 0.68 - 34 * u, F + 128 * u, H * 0.68, F + 96 * u, H * 0.68);
  const towel = new Path2D();
  rr(towel, F - 360 * u, H * 0.42, 130 * u, 8 * u, 3 * u);
  towel.rect(F - 348 * u, H * 0.46, 56 * u, 46 * u);
  return room(
    c,
    shut(),
    [176, 120, 76],
    none,
    (g, E) => {
      stroke(g, slats, [50, 26, 14], 1.4 * u, 0.42);
      fill(g, door, [50, 44, 40]);
      fill(g, door, [255, 200, 140], 0.12);
      stroke(g, door, [70, 44, 28], 5 * u);
      fill(g, tiers, shade(E, [206, 156, 104], 0.55));
      fill(g, fronts, shade(E, [150, 100, 62], 0.5));
      fill(g, towel, shade(E, [232, 228, 222], 0.6));
      fill(g, bucket, shade(E, WOOD, 0.5));
      fill(g, stove, [30, 28, 30]);
      for (const [x, y, s] of stones) {
        g.fillStyle = rgb([92, 88, 88]);
        g.beginPath();
        g.arc(x, y, s, 0, TAU);
        g.fill();
      }
      glowAt(g, sx, floor - 40 * u, 260 * u, [255, 110, 50], 0.5);
      g.fillStyle = rgb([255, 120, 50]);
      g.fillRect(sx - 30 * u, floor - 56 * u, 60 * u, 22 * u);
      steam(g, E, sx, H * 0.46, u, 9, 26, 0.12);
      g.fillStyle = "rgba(240,240,244,.08)";
      g.fillRect(0, 0, W, H);
      lamp(g, E, F - 90 * u, H * 0.05, 90 * u, 3, WARM, 0.5);
    },
    floor,
    { lift: 0.5, space: true, floorHue: [120, 84, 60] },
  );
}

// ---------- Private rooms ----------

function dressing(c: Ctx): Scene {
  const { H, u, F, r } = c;
  const d = dress(c);
  const floor = H * 0.82;
  // The vanity: a mirror ringed with bulbs is the whole silhouette.
  const vx = F - 40 * u;
  const mirror = new Path2D();
  rr(mirror, vx - 76 * u, H * 0.14, 152 * u, H * 0.36, 8 * u);
  const top = new Path2D();
  top.rect(vx - 112 * u, H * 0.54, 224 * u, 7 * u);
  const base = new Path2D();
  base.rect(vx - 108 * u, H * 0.54 + 7 * u, 60 * u, floor - H * 0.54 - 7 * u);
  base.rect(vx + 48 * u, H * 0.54 + 7 * u, 60 * u, floor - H * 0.54 - 7 * u);
  const bulbs: [number, number][] = [];
  for (let k = 0; k < 6; k++) {
    bulbs.push([vx - 86 * u, H * 0.17 + k * 20 * u]);
    bulbs.push([vx + 86 * u, H * 0.17 + k * 20 * u]);
  }
  const stool = new Path2D();
  rr(stool, vx - 36 * u, H * 0.72, 72 * u, 16 * u, 7 * u);
  for (const dx of [-24, 20]) stool.rect(vx + dx * u, H * 0.74, 4 * u, floor - H * 0.74);
  const bottles: { x: number; h: number; c: RGB }[] = [];
  for (let x = vx - 96 * u; x < vx + 90 * u; x += (22 + r() * 18) * u) bottles.push({ x, h: (11 + r() * 16) * u, c: pick(r, [[220, 170, 150], [190, 150, 210], [230, 220, 190], [120, 60, 80]] as RGB[]) });
  // A folding screen, with a robe thrown over it.
  const sx = F + 170 * u;
  const screen = new Path2D();
  for (let k = 0; k < 3; k++) poly(screen, sx + k * 58 * u, H * (k % 2 ? 0.2 : 0.17), sx + (k + 1) * 58 * u, H * (k % 2 ? 0.17 : 0.2), sx + (k + 1) * 58 * u, floor + (k % 2 ? 2 : 6) * u, sx + k * 58 * u, floor + (k % 2 ? 6 : 2) * u);
  const robe = new Path2D();
  poly(robe, sx + 42 * u, H * 0.17, sx + 96 * u, H * 0.18, sx + 92 * u, H * 0.6, sx + 50 * u, H * 0.56);
  const { win, frame } = windowAt(F - 360 * u, H * 0.14, 90 * u, H * 0.42, u, d.old);
  const view = townView(c);
  const hang = wallDressing(c, 0, F - 400 * u);
  return room(
    c,
    win,
    d.wall,
    view,
    (g, E) => {
      hang(g, E);
      skirting(g, E, c, floor);
      fill(g, frame, shade(E, d.trim, 0.6));
      fill(g, screen, shade(E, mix(d.fab, [230, 214, 190], 0.6), 0.48));
      stroke(g, screen, shade(E, WOOD, 0.45), 2 * u);
      fill(g, robe, shade(E, d.fab, 0.5));
      const mg = g.createLinearGradient(vx - 76 * u, H * 0.14, vx + 76 * u, H * 0.5);
      mg.addColorStop(0, rgb(shade(E, [190, 204, 214], 0.7)));
      mg.addColorStop(0.5, rgb(shade(E, [236, 240, 244], 0.7)));
      mg.addColorStop(1, rgb(shade(E, [170, 186, 196], 0.7)));
      g.fillStyle = mg;
      g.fill(mirror);
      stroke(g, mirror, shade(E, d.grand ? [176, 146, 90] : d.trim, 0.55), 5 * u);
      fill(g, base, shade(E, d.old ? WOOD : d.trim, 0.5));
      fill(g, top, shade(E, d.old ? WOOD : mix(d.trim, [255, 255, 255], 0.3), 0.55));
      for (const b of bottles) {
        g.fillStyle = rgb(shade(E, b.c, 0.6));
        g.fillRect(b.x, H * 0.54 - b.h, 9 * u, b.h);
      }
      fill(g, stool, shade(E, d.soft, 0.45));
      if (d.old) {
        candle(g, E, vx - 96 * u, H * 0.54, u);
        candle(g, E, vx + 96 * u, H * 0.54, u);
      } else for (const [x, y] of bulbs) lamp(g, E, x, y, 26 * u, x + y, WARM, 0.45);
    },
    floor,
    { floorHue: d.floorHue },
  );
}

function sickroom(c: Ctx): Scene {
  const { H, u, F, r } = c;
  const d = dress(c);
  const floor = H * 0.82;
  const wx = F - 320 * u;
  const { win, frame } = windowAt(wx, H * 0.12, 110 * u, H * 0.42, u, d.old);
  // Curtains half drawn.
  const curt = new Path2D();
  poly(curt, wx - 16 * u, H * 0.1, wx + 62 * u, H * 0.1, wx + 44 * u, H * 0.58, wx - 16 * u, H * 0.58);
  poly(curt, wx + 126 * u, H * 0.1, wx + 74 * u, H * 0.1, wx + 90 * u, H * 0.58, wx + 126 * u, H * 0.58);
  // The bed, head on the left, someone's shape under the covers.
  const bx = F - 100 * u;
  const head = new Path2D();
  head.rect(bx, H * 0.4, 12 * u, floor - H * 0.4);
  head.rect(bx + 268 * u, H * 0.58, 10 * u, floor - H * 0.58);
  head.rect(bx, H * 0.72, 278 * u, 10 * u);
  const pillow = new Path2D();
  ellipse(pillow, bx + 52 * u, H * 0.58, 40 * u, 13 * u);
  const covers = new Path2D();
  covers.moveTo(bx + 62 * u, H * 0.64);
  covers.bezierCurveTo(bx + 110 * u, H * 0.52, bx + 170 * u, H * 0.54, bx + 278 * u, H * 0.62);
  covers.lineTo(bx + 278 * u, H * 0.78);
  covers.lineTo(bx + 12 * u, H * 0.78);
  covers.lineTo(bx + 12 * u, H * 0.66);
  covers.closePath();
  // The bedside: a tray of bottles, a basin, a chair pulled up close.
  const tx = bx - 60 * u;
  const table = new Path2D();
  table.rect(tx - 40 * u, H * 0.6, 80 * u, 6 * u);
  for (const dx of [-36, 32]) table.rect(tx + dx * u, H * 0.6, 4 * u, floor - H * 0.6);
  const bottles: { x: number; h: number; c: RGB }[] = [-28, -12, 6].map((dx) => ({ x: tx + dx * u, h: (18 + r() * 14) * u, c: pick(r, [[120, 80, 50], [60, 100, 90], [200, 200, 210]] as RGB[]) }));
  const basin = new Path2D();
  ellipse(basin, tx + 24 * u, H * 0.6, 14 * u, 4 * u);
  const chair = new Path2D();
  rr(chair, tx - 90 * u, H * 0.42, 40 * u, H * 0.26, 6 * u);
  chair.rect(tx - 94 * u, H * 0.66, 56 * u, 7 * u);
  for (const x of [tx - 92 * u, tx - 44 * u]) chair.rect(x, H * 0.66, 4 * u, floor - H * 0.66);
  const view = hillView(c);
  const hang = wallDressing(c, 0, wx - 50 * u);
  return room(
    c,
    win,
    d.wall,
    view,
    (g, E) => {
      hang(g, E);
      skirting(g, E, c, floor);
      fill(g, frame, shade(E, d.trim, 0.6));
      fill(g, curt, shade(E, mix(d.fab, [80, 76, 80], 0.45), 0.4));
      fill(g, chair, shade(E, WOOD, 0.45));
      fill(g, head, shade(E, d.old ? WOOD : [120, 118, 118], 0.45));
      fill(g, pillow, shade(E, [240, 236, 230], 0.6));
      fill(g, covers, shade(E, mix(d.soft, [232, 226, 216], 0.5), 0.45));
      fill(g, table, shade(E, WOOD, 0.45));
      for (const b of bottles) {
        g.fillStyle = rgb(shade(E, b.c, 0.55));
        g.fillRect(b.x, H * 0.6 - b.h, 10 * u, b.h);
      }
      fill(g, basin, shade(E, [226, 226, 222], 0.6));
      // One shaded lamp, kept low.
      if (d.old) candle(g, E, tx + 34 * u, H * 0.6, u);
      else lamp(g, E, tx + 30 * u, H * 0.48, 100 * u, 2, WARM, 0.35);
      glowAt(g, tx, H * 0.5, 240 * u, WARM, 0.28);
    },
    floor,
    { lift: 0.3, floorHue: d.floorHue },
  );
}

// ---------- Between rooms ----------

function longgallery(c: Ctx): Scene {
  const { W, H, u, F, r } = c;
  const d = dress(c);
  const floor = H * 0.84;
  // Tall windows down one side would be lost at this size, so the portraits face you, between them.
  const win = new Path2D();
  const frame = new Path2D();
  const step = 210 * u;
  const xs: number[] = [];
  for (let x = F % step; x < W; x += step) xs.push(x);
  for (const x of xs) {
    win.moveTo(x, H * 0.7);
    win.lineTo(x, H * 0.22);
    win.quadraticCurveTo(x + 32 * u, H * 0.06, x + 64 * u, H * 0.22);
    win.lineTo(x + 64 * u, H * 0.7);
    win.closePath();
    frame.rect(x + 31 * u, H * 0.12, 2.4 * u, H * 0.58);
    for (const y of [0.3, 0.46, 0.6]) frame.rect(x, H * y, 64 * u, 2 * u);
  }
  const portraits: { p: Path2D; s: Path2D; c: RGB }[] = [];
  for (const x of xs) {
    const px = x + 106 * u;
    const p = new Path2D();
    rr(p, px, H * 0.2, 80 * u, H * 0.42, 3 * u);
    const s = new Path2D();
    ellipse(s, px + 40 * u, H * 0.32, 13 * u, 16 * u);
    poly(s, px + 12 * u, H * 0.6, px + 68 * u, H * 0.6, px + 56 * u, H * 0.4, px + 24 * u, H * 0.4);
    portraits.push({ p, s, c: pick(r, FABRIC) });
  }
  const runner = new Path2D();
  poly(runner, 0, H * 0.9, W, H * 0.9, W, H * 0.98, 0, H * 0.98);
  const bars = new Path2D();
  for (const x of xs) poly(bars, x, floor, x + 64 * u, floor, x + 104 * u, H, x + 30 * u, H);
  const view = hillView(c);
  return room(
    c,
    win,
    d.wall,
    view,
    (g, E) => {
      skirting(g, E, c, floor);
      fill(g, frame, shade(E, d.old ? WOOD : d.trim, 0.55));
      for (const k of portraits) {
        fill(g, k.p, shade(E, mix(k.c, DARK, 0.55), 0.45));
        fill(g, k.s, shade(E, mix(k.c, [230, 206, 170], 0.3), 0.45));
        stroke(g, k.p, shade(E, [176, 146, 90], 0.5), 5 * u);
      }
      fill(g, runner, shade(E, d.fab, 0.42));
      // Moon or sun lying in bars across the floor.
      const light: RGB = E.day > 0.3 ? [255, 240, 210] : [190, 205, 255];
      fill(g, bars, light, (E.day * 0.2 + E.night * 0.14) * (1 - E.c.cloud * 0.6));
    },
    floor,
    { floorHue: d.floorHue },
  );
}

function crawlspace(c: Ctx): Scene {
  const { W, H, u, F, r } = c;
  const floor = H * 0.84;
  // The ceiling comes down hard: a slope of bare joists overhead.
  const roofP = new Path2D();
  poly(roofP, 0, 0, W, 0, W, H * 0.34, 0, H * 0.54);
  const joists = new Path2D();
  for (let x = F % (68 * u); x < W; x += 68 * u) {
    const y = H * 0.54 - (x / W) * H * 0.2;
    joists.rect(x, 0, 16 * u, y);
  }
  const insulation = new Path2D();
  for (let x = F % (68 * u) + 16 * u; x < W; x += 68 * u) {
    const y = H * 0.54 - (x / W) * H * 0.2;
    insulation.rect(x, 0, 52 * u, y - 8 * u);
  }
  const boxes: { x: number; w: number; h: number; c: RGB }[] = [];
  for (let x = 16 * u; x < W; x += (70 + r() * 90) * u) if (r() < 0.75) boxes.push({ x, w: (54 + r() * 40) * u, h: (28 + r() * 40) * u, c: pick(r, [[160, 128, 90], [130, 104, 76], [90, 88, 92]] as RGB[]) });
  const hx = F + 60 * u;
  const hatch = new Path2D();
  rr(hatch, hx - 40 * u, H * 0.6, 80 * u, floor - H * 0.6, 2 * u);
  const dust = motes(c, 16, F - 180 * u, F + 200 * u, H * 0.4, floor);
  return room(
    c,
    shut(),
    [72, 62, 54],
    none,
    (g, E) => {
      fill(g, roofP, [36, 30, 28]);
      fill(g, insulation, [120, 104, 80], 0.7);
      fill(g, joists, [84, 62, 44]);
      fill(g, hatch, [255, 224, 170], 0.8);
      stroke(g, hatch, [50, 38, 30], 5 * u);
      for (const b of boxes) {
        g.fillStyle = rgb(mix(b.c, DARK, 0.42));
        g.fillRect(b.x, floor + 4 * u - b.h, b.w, b.h);
        g.fillStyle = rgb(mix(b.c, [220, 200, 160], 0.1));
        g.fillRect(b.x + b.w / 2 - 4 * u, floor + 4 * u - b.h, 8 * u, b.h * 0.3);
      }
      // What light there is comes in through the hatch.
      glowAt(g, hx, H * 0.72, 300 * u, WARM, 0.38);
      const T = time(E);
      for (const m of dust) {
        g.fillStyle = rgb([255, 230, 190], 0.4 * (0.5 + 0.5 * Math.sin(T + m.p)));
        g.fillRect(m.x + Math.sin(T * 0.2 + m.p) * 8 * u, m.y, 1.3 * u, 1.3 * u);
      }
    },
    floor,
    { lift: 0.14, space: true, floorHue: [60, 52, 46] },
  );
}

// ---------- Hidden rooms ----------

function panicroom(c: Ctx): Scene {
  const { W, H, u, F, r } = c;
  const floor = H * 0.84;
  const plates = new Path2D();
  grid(plates, 0, 0, W, floor, 120 * u, 90 * u);
  // The bank of monitors, each on a different corner of the house.
  const mx = F - 210 * u;
  const screens: { x: number; y: number; k: number }[] = [];
  for (let row = 0; row < 3; row++) for (let col = 0; col < 4; col++) screens.push({ x: mx + col * 78 * u, y: H * 0.1 + row * 54 * u, k: r() });
  const desk = new Path2D();
  desk.rect(mx - 16 * u, H * 0.66, 340 * u, 8 * u);
  desk.rect(mx - 10 * u, H * 0.66, 8 * u, floor - H * 0.66);
  desk.rect(mx + 306 * u, H * 0.66, 8 * u, floor - H * 0.66);
  const chair = new Path2D();
  rr(chair, mx + 110 * u, H * 0.68, 90 * u, 80 * u, 12 * u);
  // The door: thick steel, its wheel in the middle.
  const dx = F + 200 * u;
  const door = new Path2D();
  rr(door, dx, H * 0.1, 140 * u, floor - H * 0.1, 6 * u);
  const bolts = new Path2D();
  for (const y of [0.16, 0.8]) for (const bx of [12, 128]) bolts.arc(dx + bx * u, H * y, 4 * u, 0, TAU);
  const cot = new Path2D();
  rr(cot, F - 500 * u, H * 0.7, 230 * u, 22 * u, 5 * u);
  for (const x of [F - 490 * u, F - 290 * u]) cot.rect(x, H * 0.74, 5 * u, floor - H * 0.74);
  const supplies: { x: number; h: number; c: RGB }[] = [];
  for (let x = F - 500 * u; x < F - 270 * u; x += 36 * u) supplies.push({ x, h: (20 + r() * 26) * u, c: pick(r, [[70, 84, 60], [90, 90, 96], [120, 100, 60]] as RGB[]) });
  return room(
    c,
    shut(),
    [70, 74, 80],
    none,
    (g, E) => {
      stroke(g, plates, [0, 0, 0], 1.4 * u, 0.32);
      g.fillStyle = "rgb(20,22,26)";
      g.fillRect(mx - 8 * u, H * 0.08, 322 * u, 172 * u);
      const T = time(E);
      for (const s of screens) {
        const flick = E.still ? 0 : Math.sin(T * 3 + s.k * 9) * 0.05;
        const hue = mix([150, 190, 170], [190, 210, 230], s.k);
        g.fillStyle = rgb(mix(DARK, hue, 0.55 + s.k * 0.25 + flick));
        g.fillRect(s.x, s.y, 70 * u, 46 * u);
        g.fillStyle = rgb(DARK, 0.5);
        g.fillRect(s.x + 8 * u + s.k * 30 * u, s.y + 26 * u, 18 * u, 20 * u);
      }
      glowAt(g, mx + 150 * u, H * 0.4, 360 * u, [170, 210, 220], 0.28);
      fill(g, desk, [50, 52, 58]);
      fill(g, chair, [28, 28, 32]);
      fill(g, door, [110, 114, 120]);
      stroke(g, door, [40, 42, 46], 5 * u);
      fill(g, bolts, [60, 62, 66]);
      g.strokeStyle = "rgb(50,52,56)";
      g.lineWidth = 7 * u;
      g.beginPath();
      g.arc(dx + 70 * u, H * 0.47, 32 * u, 0, TAU);
      for (let a = 0; a < 3; a++) {
        g.moveTo(dx + 70 * u, H * 0.47);
        g.lineTo(dx + 70 * u + Math.cos(a * 2.1) * 32 * u, H * 0.47 + Math.sin(a * 2.1) * 32 * u);
      }
      g.stroke();
      fill(g, cot, [70, 76, 66]);
      for (const k of supplies) {
        g.fillStyle = rgb(mix(k.c, DARK, 0.3));
        g.fillRect(k.x, H * 0.56 - k.h, 30 * u, k.h);
      }
      g.fillStyle = "rgb(60,62,66)";
      g.fillRect(F - 508 * u, H * 0.56, 246 * u, 4 * u);
      // The red standby light that never goes off.
      glowAt(g, dx - 18 * u, H * 0.3, 40 * u, [255, 50, 40], 0.8);
    },
    floor,
    { lift: 0.3, space: true, floorHue: [64, 66, 70] },
  );
}

function hiddenroom(c: Ctx): Scene {
  const { W, H, u, F, r } = c;
  const d = dress(c);
  const floor = H * 0.86;
  // You're looking from inside the dark: stone walls, one candle, the bookcase swung open on the room beyond.
  const courses = new Path2D();
  grid(courses, 0, 0, W, floor, 62 * u, 32 * u, true);
  const gx = F + 110 * u;
  const gap = new Path2D();
  gap.rect(gx, H * 0.08, 130 * u, floor - H * 0.08);
  const hinge = new Path2D();
  poly(hinge, gx + 130 * u, H * 0.08, gx + 230 * u, H * 0.02, gx + 230 * u, floor + 8 * u, gx + 130 * u, floor);
  const hues = [...FABRIC, [150, 120, 90]] as RGB[];
  const spines = hues.map(() => new Path2D());
  for (let k = 0; k < 5; k++) {
    const t0 = k / 5;
    const yTop = H * 0.1 + t0 * (floor - H * 0.14);
    for (let x = gx + 136 * u; x < gx + 226 * u; x += 9 * u) spines[(r() * spines.length) | 0]!.rect(x, yTop + (x - gx - 130 * u) * -0.05, 7 * u, (floor - H * 0.14) / 5 - 14 * u);
  }
  const table = new Path2D();
  table.rect(F - 240 * u, H * 0.62, 190 * u, 8 * u);
  for (const x of [F - 232 * u, F - 66 * u]) table.rect(x, H * 0.62, 7 * u, floor - H * 0.62);
  const papers: { x: number; y: number; a: number }[] = Array.from({ length: 7 }, () => ({ x: F - 216 * u + r() * 150 * u, y: H * 0.615, a: r() }));
  const chest = new Path2D();
  rr(chest, F - 40 * u, H * 0.68, 104 * u, floor - H * 0.68, 7 * u);
  const band = new Path2D();
  for (const dx of [-24, 40]) band.rect(F + dx * u, H * 0.68, 6 * u, floor - H * 0.68);
  const dust = motes(c, 22, gx - 120 * u, gx + 130 * u, H * 0.1, floor);
  return room(
    c,
    shut(),
    STONE,
    none,
    (g, E) => {
      stroke(g, courses, [0, 0, 0], 1.3 * u, 0.32);
      // The lit room beyond, whatever the hour.
      fill(g, gap, mix(shade(E, d.wall, 0.6), [255, 216, 150], 0.35));
      glowAt(g, gx + 40 * u, H * 0.5, 280 * u, [255, 214, 150], 0.28);
      fill(g, hinge, [46, 30, 24]);
      spines.forEach((p, i) => fill(g, p, mix(hues[i]!, DARK, 0.45)));
      fill(g, table, [52, 38, 30]);
      for (const p of papers) {
        g.fillStyle = rgb([190, 176, 140]);
        g.fillRect(p.x, p.y - 2 * u, 26 * u, 2 * u);
      }
      fill(g, chest, [70, 46, 34]);
      fill(g, band, [40, 34, 32]);
      candle(g, E, F - 140 * u, H * 0.62, u);
      lamp(g, E, F - 140 * u, H * 0.56, 60 * u, 3, WARM, 0.9);
      glowAt(g, F - 140 * u, H * 0.54, 240 * u, WARM, 0.4);
      const T = time(E);
      for (const m of dust) {
        g.fillStyle = rgb([255, 232, 190], 0.5 * (0.5 + 0.5 * Math.sin(T + m.p)));
        g.fillRect(m.x + Math.sin(T * 0.2 + m.p) * 8 * u, m.y, 1.3 * u, 1.3 * u);
      }
    },
    floor,
    { lift: 0.14, space: true, floorHue: [54, 48, 46] },
  );
}

// ---------- Whole homes ----------

function dorm(c: Ctx): Scene {
  const { H, u, F, r } = c;
  const d = dress(c);
  const floor = H * 0.82;
  const wall = mix(d.wall, [214, 210, 196], 0.6);
  const { win, frame } = windowAt(F - 60 * u, H * 0.12, 120 * u, H * 0.34, u, false);
  const beds: { x: number; hue: RGB }[] = [
    { x: F - 340 * u, hue: d.fab },
    { x: F + 100 * u, hue: pick(r, FABRIC) },
  ];
  const parts = beds.map((b) => {
    const p = new Path2D();
    p.rect(b.x, H * 0.72, 220 * u, 7 * u);
    for (const dx of [0, 214]) p.rect(b.x + dx * u, H * 0.54, 6 * u, floor - H * 0.54);
    const sheet = new Path2D();
    rr(sheet, b.x + 6 * u, H * 0.64, 208 * u, 22 * u, 5 * u);
    const pillow = new Path2D();
    ellipse(pillow, b.x + 38 * u, H * 0.64, 26 * u, 8 * u);
    return { p, sheet, pillow, hue: b.hue };
  });
  const desks = new Path2D();
  desks.rect(F - 96 * u, H * 0.62, 192 * u, 6 * u);
  for (const x of [F - 92 * u, F + 86 * u, F - 3 * u]) desks.rect(x, H * 0.62, 5 * u, floor - H * 0.62);
  const stacks: { x: number; h: number; c: RGB }[] = [];
  for (let x = F - 86 * u; x < F - 30 * u; x += 12 * u) stacks.push({ x, h: (18 + r() * 26) * u, c: pick(r, FABRIC) });
  const laptop = new Path2D();
  poly(laptop, F + 16 * u, H * 0.62, F + 76 * u, H * 0.62, F + 70 * u, H * 0.52, F + 22 * u, H * 0.52);
  const posters: { x: number; w: number; h: number; c: RGB }[] = [];
  for (const x of [F - 300, F - 210, F + 130, F + 210]) posters.push({ x: x * 1, w: (46 + r() * 20) * u, h: (56 + r() * 20) * u, c: pick(r, FABRIC) });
  const posterXs = [F - 300 * u, F - 200 * u, F + 130 * u, F + 230 * u];
  const view = townView(c);
  const hang = wallDressing(c, 0, F - 380 * u);
  return room(
    c,
    win,
    wall,
    view,
    (g, E) => {
      hang(g, E);
      skirting(g, E, c, floor);
      fill(g, frame, shade(E, [90, 90, 96], 0.5));
      spill(g, E, F - 60 * u, F + 60 * u, H * 0.46, floor, 40 * u);
      posters.forEach((p, i) => {
        g.fillStyle = rgb(shade(E, mix(p.c, [230, 220, 200], 0.2), 0.55));
        g.fillRect(posterXs[i]!, H * 0.16, p.w, p.h);
      });
      for (const k of parts) {
        fill(g, k.p, shade(E, [120, 120, 124], 0.45));
        fill(g, k.sheet, shade(E, k.hue, 0.45));
        fill(g, k.pillow, shade(E, [240, 236, 230], 0.6));
      }
      fill(g, desks, shade(E, [150, 124, 96], 0.45));
      for (const s of stacks) {
        g.fillStyle = rgb(shade(E, s.c, 0.5));
        g.fillRect(s.x, H * 0.62 - s.h, 10 * u, s.h);
      }
      // One side's up late; the other isn't.
      const on = after(E);
      fill(g, laptop, mix([20, 22, 30], [170, 200, 236], 0.25 + on * 0.6));
      glowAt(g, F + 46 * u, H * 0.54, 140 * u, [150, 190, 240], 0.3 * on);
      if (d.old) candle(g, E, F - 20 * u, H * 0.62, u);
      else lamp(g, E, F - 20 * u, H * 0.52, 100 * u, 3, WARM, 0.05);
    },
    floor,
    { floorHue: mix(d.floorHue, [130, 130, 126], 0.5) },
  );
}

function trailer(c: Ctx): Scene {
  const { W, H, u, F, r } = c;
  const d = dress(c);
  const floor = H * 0.82;
  // Narrow, panelled, curved at the top: the low ceiling's the giveaway.
  const win = new Path2D();
  const frame = new Path2D();
  for (const x of [F - 300 * u, F + 70 * u]) {
    rr(win, x, H * 0.26, 120 * u, H * 0.26, 18 * u);
    rr(frame, x - 4 * u, H * 0.26 - 4 * u, 128 * u, H * 0.26 + 8 * u, 20 * u);
  }
  const ceil = new Path2D();
  ceil.moveTo(0, 0);
  ceil.lineTo(W, 0);
  ceil.lineTo(W, H * 0.14);
  ceil.lineTo(0, H * 0.14);
  ceil.closePath();
  const panels = new Path2D();
  grid(panels, 0, H * 0.14, W, floor, 38 * u, floor);
  // The dinette: a table, a bench either side.
  const tx = F - 240 * u;
  const dinette = new Path2D();
  dinette.rect(tx - 30 * u, H * 0.6, 140 * u, 6 * u);
  dinette.rect(tx + 34 * u, H * 0.6, 8 * u, floor - H * 0.6);
  const benches = new Path2D();
  rr(benches, tx - 106 * u, H * 0.46, 56 * u, floor - H * 0.46, 8 * u);
  rr(benches, tx + 130 * u, H * 0.46, 56 * u, floor - H * 0.46, 8 * u);
  // Kitchenette on the right: hob, small sink, overhead lockers.
  const kx = F + 20 * u;
  const lockers = new Path2D();
  for (let x = kx - 100 * u; x < kx + 300 * u; x += 72 * u) if (x + 66 * u < F + 60 * u || x > F + 200 * u) rr(lockers, x, H * 0.14, 66 * u, 48 * u, 6 * u);
  const counter = new Path2D();
  counter.rect(F + 50 * u, H * 0.62, 280 * u, 6 * u);
  const base = new Path2D();
  base.rect(F + 50 * u, H * 0.62 + 6 * u, 280 * u, floor - H * 0.62);
  const doors = new Path2D();
  grid(doors, F + 50 * u, H * 0.66, F + 330 * u, floor, 70 * u, floor);
  const hob = new Path2D();
  ellipse(hob, F + 250 * u, H * 0.615, 24 * u, 3 * u);
  const mugs: { x: number; c: RGB }[] = [0, 20, 40].map((dx) => ({ x: F + 80 * u + dx * u, c: pick(r, FABRIC) }));
  const view = r() < 0.5 ? hillView(c) : townView(c);
  return room(
    c,
    win,
    mix(WOOD, [190, 170, 130], 0.3),
    view,
    (g, E) => {
      stroke(g, panels, [0, 0, 0], 1 * u, 0.2);
      stroke(g, frame, shade(E, [190, 186, 176], 0.5), 5 * u);
      for (const x of [F - 300 * u, F + 70 * u]) spill(g, E, x, x + 120 * u, H * 0.52, floor, 40 * u);
      fill(g, ceil, shade(E, [226, 222, 210], 0.42));
      fill(g, lockers, shade(E, mix(WOOD, [230, 210, 170], 0.3), 0.45));
      fill(g, benches, shade(E, d.fab, 0.42));
      fill(g, dinette, shade(E, [200, 190, 170], 0.5));
      fill(g, base, shade(E, mix(WOOD, [230, 210, 170], 0.3), 0.42));
      stroke(g, doors, [0, 0, 0], 1 * u, 0.25);
      fill(g, counter, shade(E, [190, 186, 176], 0.5));
      fill(g, hob, [24, 22, 24]);
      for (const m of mugs) {
        g.fillStyle = rgb(shade(E, m.c, 0.55));
        g.fillRect(m.x, H * 0.62 - 13 * u, 11 * u, 13 * u);
      }
      const on = lampsOn(E, 0.15);
      for (const x of [F - 170 * u, F + 200 * u]) {
        g.fillStyle = rgb(mix([210, 206, 196], [255, 240, 200], on));
        g.fillRect(x - 40 * u, H * 0.135, 80 * u, 5 * u);
        glowAt(g, x, H * 0.17, 200 * u, WARM, 0.32 * on);
      }
    },
    floor,
    { floorHue: mix(d.floorHue, [110, 100, 92], 0.5) },
  );
}

function houseboat(c: Ctx): Scene {
  const { W, H, u, F, r } = c;
  const d = dress(c);
  const floor = H * 0.82;
  // Round windows, low on the wall, with water right outside.
  const win = new Path2D();
  const frame = new Path2D();
  const ports = [F - 300 * u, F - 130 * u, F + 40 * u];
  for (const x of ports) {
    win.moveTo(x + 52 * u, H * 0.44);
    win.arc(x, H * 0.44, 52 * u, 0, TAU);
    frame.moveTo(x + 58 * u, H * 0.44);
    frame.arc(x, H * 0.44, 58 * u, 0, TAU);
    frame.moveTo(x + 52 * u, H * 0.44);
    frame.arc(x, H * 0.44, 52 * u, 0, TAU, true);
  }
  const planks = new Path2D();
  grid(planks, 0, H * 0.06, W, floor, 0, 24 * u);
  const beams = new Path2D();
  beams.rect(0, 0, W, H * 0.06);
  for (let x = F % (130 * u); x < W; x += 130 * u) beams.rect(x, H * 0.06, 12 * u, 26 * u);
  // A wood stove with its pipe, a bench, a coil of rope.
  const sx = F + 180 * u;
  const stove = new Path2D();
  rr(stove, sx - 40 * u, H * 0.54, 80 * u, floor - H * 0.54, 6 * u);
  stove.rect(sx - 8 * u, 0, 16 * u, H * 0.54);
  const hatch = new Path2D();
  hatch.rect(sx - 22 * u, H * 0.62, 44 * u, 28 * u);
  const bench = new Path2D();
  rr(bench, F - 370 * u, H * 0.66, 320 * u, 16 * u, 6 * u);
  bench.rect(F - 366 * u, H * 0.68, 310 * u, floor - H * 0.68);
  const pads = new Path2D();
  for (let x = F - 366 * u; x < F - 70 * u; x += 104 * u) rr(pads, x, H * 0.625, 98 * u, 18 * u, 6 * u);
  const rope = new Path2D();
  ellipse(rope, F + 300 * u, floor - 8 * u, 38 * u, 11 * u);
  ellipse(rope, F + 300 * u, floor - 16 * u, 32 * u, 9 * u);
  const shelf = new Path2D();
  shelf.rect(F + 240 * u, H * 0.3, 120 * u, 4 * u);
  const tins: { x: number; c: RGB }[] = [0, 26, 52, 78].map((dx) => ({ x: F + 246 * u + dx * u, c: pick(r, FABRIC) }));
  const sh = shims(c, 40);
  const seaLine = H * 0.46;
  const view = hillView(c);
  return room(
    c,
    win,
    mix(WOOD, [216, 190, 150], 0.45),
    (g, E) => {
      view(g, E);
      water(g, E, c, seaLine, sh);
    },
    (g, E) => {
      stroke(g, planks, [0, 0, 0], 1 * u, 0.25);
      g.fillStyle = rgb(shade(E, [190, 150, 80], 0.55));
      g.fill(frame, "evenodd");
      // Light off the water, moving on the ceiling.
      const T = time(E);
      const a = 0.08 + E.day * 0.1;
      g.fillStyle = rgb([220, 236, 255], a);
      for (let k = 0; k < 9; k++) {
        const x = F - 420 * u + k * 88 * u + Math.sin(T * 0.8 + k) * 16 * u;
        g.beginPath();
        g.ellipse(x, H * 0.1, 34 * u, 5 * u, 0, 0, TAU);
        g.fill();
      }
      fill(g, beams, shade(E, WOOD, 0.42));
      fill(g, shelf, shade(E, WOOD, 0.45));
      for (const t of tins) {
        g.fillStyle = rgb(shade(E, t.c, 0.5));
        g.fillRect(t.x, H * 0.3 - 24 * u, 20 * u, 24 * u);
      }
      fill(g, bench, shade(E, WOOD, 0.45));
      fill(g, pads, shade(E, d.fab, 0.45));
      fill(g, stove, [30, 28, 30]);
      fill(g, hatch, [24, 14, 12]);
      if (E.glow > 0.3 || E.c.snow > 0.2) {
        glowAt(g, sx, H * 0.66, 180 * u, [255, 140, 60], 0.45);
        fire(g, E, sx, H * 0.66 + 12 * u, u * 0.9);
      }
      stroke(g, rope, shade(E, [190, 170, 130], 0.5), 5 * u);
      lamp(g, E, F - 390 * u, H * 0.26, 110 * u, 3, WARM, 0.05);
    },
    floor,
    { floorHue: mix(WOOD, DARK, 0.2) },
  );
}

function beachhouse(c: Ctx): Scene {
  const { W, H, u, F, r } = c;
  const d = dress(c);
  const floor = H * 0.82;
  // French doors open on the sea.
  const dx = F - 250 * u;
  const dw = 300 * u;
  const win = new Path2D();
  win.rect(dx, H * 0.08, dw, floor - H * 0.08);
  const frame = new Path2D();
  frame.rect(dx - 8 * u, H * 0.05, dw + 16 * u, 8 * u);
  frame.rect(dx - 8 * u, H * 0.05, 8 * u, floor - H * 0.05);
  frame.rect(dx + dw, H * 0.05, 8 * u, floor - H * 0.05);
  // The doors, folded back to either side.
  const leaves = new Path2D();
  poly(leaves, dx, H * 0.08, dx + 44 * u, H * 0.13, dx + 44 * u, floor - 8 * u, dx, floor);
  poly(leaves, dx + dw, H * 0.08, dx + dw - 44 * u, H * 0.13, dx + dw - 44 * u, floor - 8 * u, dx + dw, floor);
  const boards = new Path2D();
  grid(boards, 0, 0, W, floor, 34 * u, floor);
  // Sheer curtains that lift in the wind, a low white sofa, driftwood.
  const curtain = (s: number) => {
    const x = s < 0 ? dx + 8 * u : dx + dw - 8 * u;
    const p = new Path2D();
    p.moveTo(x, H * 0.08);
    p.lineTo(x - s * -40 * u, H * 0.08);
    p.quadraticCurveTo(x - s * -70 * u, H * 0.5, x - s * -30 * u, floor);
    p.lineTo(x, floor);
    p.closePath();
    return p;
  };
  const sheers = [curtain(-1), curtain(1)];
  const sofa = new Path2D();
  rr(sofa, F + 90 * u, H * 0.54, 230 * u, floor - H * 0.54, 14 * u);
  const cush = new Path2D();
  for (const x of [F + 104 * u, F + 200 * u]) rr(cush, x, H * 0.6, 86 * u, 28 * u, 9 * u);
  const log = new Path2D();
  log.moveTo(F - 340 * u, floor);
  log.bezierCurveTo(F - 390 * u, H * 0.6, F - 300 * u, H * 0.56, F - 340 * u, H * 0.3);
  const shells: [number, number][] = [
    [F + 348 * u, H * 0.42],
    [F + 372 * u, H * 0.42],
  ];
  const view = beachView(c);
  void r;
  return room(
    c,
    win,
    [236, 232, 222],
    view,
    (g, E) => {
      stroke(g, boards, [0, 0, 0], 1 * u, 0.12);
      spill(g, E, dx, dx + dw, floor - 2 * u, H, 40 * u);
      fill(g, frame, shade(E, [244, 240, 232], 0.6));
      fill(g, leaves, shade(E, [240, 236, 228], 0.55));
      for (const p of sheers) {
        g.save();
        if (!E.still) g.translate(Math.sin(E.T * 0.9) * 6 * u * (0.3 + E.c.wind), 0);
        fill(g, p, shade(E, [248, 246, 240], 0.7), 0.5);
        g.restore();
      }
      stroke(g, log, shade(E, [170, 150, 124], 0.5), 9 * u);
      fill(g, sofa, shade(E, mix(d.soft, [240, 236, 226], 0.7), 0.5));
      fill(g, cush, shade(E, mix(d.fab, [200, 220, 226], 0.5), 0.5));
      for (const [x, y] of shells) {
        g.fillStyle = rgb(shade(E, [226, 200, 170], 0.6));
        g.beginPath();
        g.arc(x, y, 9 * u, 0, TAU);
        g.fill();
      }
      g.fillStyle = rgb(shade(E, [200, 180, 150], 0.5));
      g.fillRect(F + 330 * u, H * 0.44, 70 * u, 4 * u);
      lamp(g, E, F + 340 * u, H * 0.3, 120 * u, 2, WARM, 0.03);
    },
    floor,
    { floorHue: [196, 180, 150] },
  );
}

function cottage(c: Ctx): Scene {
  const { W, H, u, F, r } = c;
  const d = dress(c);
  const floor = H * 0.84;
  const { win, frame } = windowAt(F - 290 * u, H * 0.3, 70 * u, H * 0.26, u, true);
  // Low beams, and a big inglenook you could sit inside.
  const beams = new Path2D();
  beams.rect(0, 0, W, H * 0.06);
  for (const y of [0.12]) beams.rect(0, H * y, W, 16 * u);
  for (let x = F % (160 * u); x < W; x += 160 * u) beams.rect(x, 0, 13 * u, H * 0.2);
  const ix = F + 40 * u;
  const nook = new Path2D();
  nook.rect(ix - 130 * u, H * 0.26, 260 * u, floor - H * 0.26);
  const mouth = new Path2D();
  mouth.moveTo(ix - 92 * u, floor);
  mouth.lineTo(ix - 92 * u, H * 0.5);
  mouth.quadraticCurveTo(ix, H * 0.38, ix + 92 * u, H * 0.5);
  mouth.lineTo(ix + 92 * u, floor);
  mouth.closePath();
  const lintel = new Path2D();
  lintel.rect(ix - 136 * u, H * 0.26, 272 * u, 16 * u);
  const courses = new Path2D();
  grid(courses, ix - 130 * u, H * 0.3, ix + 130 * u, floor, 44 * u, 22 * u, true);
  const pot = new Path2D();
  pot.rect(ix - 1 * u, H * 0.42, 2 * u, H * 0.26);
  pot.moveTo(ix + 26 * u, H * 0.7);
  pot.arc(ix, H * 0.7, 26 * u, 0, Math.PI);
  pot.closePath();
  // Herbs drying from the beam.
  const herbs: { x: number; c: RGB; l: number }[] = [];
  for (let x = 30 * u; x < W; x += (44 + r() * 50) * u) if (Math.abs(x - ix) > 150 * u) herbs.push({ x, c: pick(r, [[110, 130, 70], [150, 110, 90], [170, 140, 70]] as RGB[]), l: (22 + r() * 20) * u });
  const table = new Path2D();
  table.rect(F - 220 * u, H * 0.66, 150 * u, 8 * u);
  for (const x of [F - 212 * u, F - 86 * u]) table.rect(x, H * 0.66, 7 * u, floor - H * 0.66);
  const loaf = new Path2D();
  ellipse(loaf, F - 150 * u, H * 0.65, 28 * u, 11 * u);
  const dresser = new Path2D();
  dresser.rect(F + 210 * u, H * 0.3, 130 * u, floor - H * 0.3);
  const plates: { x: number; y: number; c: RGB }[] = [];
  for (const y of [0.4, 0.54]) for (const dx of [234, 276, 316]) plates.push({ x: F + dx * u, y: H * y, c: pick(r, [[220, 220, 214], [90, 120, 160]] as RGB[]) });
  const rug = new Path2D();
  ellipse(rug, ix, H * 0.93, 170 * u, 13 * u);
  const view = hillView(c);
  return room(
    c,
    win,
    d.old ? d.wall : mix(d.wall, [236, 226, 204], 0.65),
    view,
    (g, E) => {
      fill(g, frame, shade(E, WOOD, 0.45));
      spill(g, E, F - 290 * u, F - 220 * u, H * 0.56, floor, 50 * u);
      fill(g, nook, shade(E, STONE, 0.45));
      stroke(g, courses, [0, 0, 0], 1 * u, 0.25);
      fill(g, mouth, [20, 12, 12]);
      fill(g, lintel, shade(E, WOOD, 0.45));
      // The fire's always in.
      glowAt(g, ix, floor - 20 * u, 300 * u, [255, 140, 60], 0.48);
      fire(g, E, ix, floor - 3 * u, u * 1.8);
      fill(g, pot, [24, 20, 22]);
      fill(g, dresser, shade(E, WOOD, 0.42));
      for (const p of plates) {
        g.fillStyle = rgb(shade(E, p.c, 0.55));
        g.beginPath();
        g.arc(p.x, p.y, 15 * u, 0, TAU);
        g.fill();
      }
      fill(g, rug, shade(E, d.fab, 0.42));
      fill(g, table, shade(E, WOOD, 0.5));
      fill(g, loaf, shade(E, [190, 140, 86], 0.55));
      candle(g, E, F - 104 * u, H * 0.66, u);
      fill(g, beams, shade(E, mix(WOOD, DARK, 0.2), 0.42));
      for (const k of herbs) {
        g.fillStyle = rgb(shade(E, k.c, 0.5));
        g.beginPath();
        g.moveTo(k.x - 8 * u, H * 0.17);
        g.lineTo(k.x + 8 * u, H * 0.17);
        g.lineTo(k.x + 3 * u, H * 0.17 + k.l);
        g.lineTo(k.x - 3 * u, H * 0.17 + k.l);
        g.fill();
      }
    },
    floor,
    { floorHue: mix(d.floorHue, [120, 110, 100], 0.4) },
  );
}

// ---------- At the door ----------

function screenporch(c: Ctx): Scene {
  const { W, H, u, F, r } = c;
  const d = dress(c);
  const floor = H * 0.82;
  const roofY = H * 0.11;
  const win = new Path2D();
  win.rect(0, roofY, W, floor - roofY);
  const frames = new Path2D();
  for (let x = F % (150 * u); x < W; x += 150 * u) frames.rect(x - 4 * u, roofY, 8 * u, floor - roofY);
  frames.rect(0, H * 0.58, W, 6 * u);
  frames.rect(0, roofY - 3 * u, W, 8 * u);
  frames.rect(0, floor - 6 * u, W, 6 * u);
  const roofP = new Path2D();
  roofP.rect(0, 0, W, roofY);
  // A daybed and the ceiling fan.
  const bedP = new Path2D();
  rr(bedP, F - 280 * u, H * 0.58, 280 * u, 36 * u, 10 * u);
  bedP.rect(F - 270 * u, H * 0.66, 7 * u, floor - H * 0.66);
  bedP.rect(F - 20 * u, H * 0.66, 7 * u, floor - H * 0.66);
  const bolster = new Path2D();
  rr(bolster, F - 272 * u, H * 0.51, 66 * u, 28 * u, 12 * u);
  rr(bolster, F - 76 * u, H * 0.51, 66 * u, 28 * u, 12 * u);
  const fx = F + 120 * u;
  const table = new Path2D();
  ellipse(table, fx, H * 0.66, 44 * u, 6 * u);
  table.rect(fx - 2 * u, H * 0.66, 4 * u, floor - H * 0.66);
  const jug = new Path2D();
  rr(jug, fx - 12 * u, H * 0.66 - 30 * u, 24 * u, 30 * u, 6 * u);
  const fern = new Path2D();
  leafy(fern, F + 280 * u, floor - 34 * u, 90 * u);
  const urn = new Path2D();
  poly(urn, F + 262 * u, floor - 36 * u, F + 298 * u, floor - 36 * u, F + 292 * u, floor, F + 268 * u, floor);
  const flies = motes(c, 16, 0, W, H * 0.2, H * 0.56);
  const view = r() < 0.6 ? hillView(c) : townView(c);
  return room(
    c,
    win,
    d.trim,
    (g, E) => {
      view(g, E);
      fireflies(g, E, flies, u);
      // The mesh softens everything beyond it.
      g.fillStyle = "rgba(40,44,52,.18)";
      g.fillRect(0, 0, W, H);
    },
    (g, E) => {
      fill(g, roofP, shade(E, mix(d.trim, DARK, 0.25), 0.4));
      fill(g, frames, shade(E, d.old ? WOOD : d.trim, 0.55));
      fill(g, bedP, shade(E, d.old ? WOOD : mix(d.soft, [230, 226, 216], 0.4), 0.5));
      fill(g, bolster, shade(E, d.fab, 0.5));
      fill(g, table, shade(E, WOOD, 0.5));
      fill(g, jug, shade(E, [226, 214, 190], 0.55));
      fill(g, urn, shade(E, [180, 110, 80], 0.5));
      fill(g, fern, shade(E, [70, 130, 74], 0.5));
      // The fan turns slowly; a still catches it mid-turn.
      const a = E.still ? 0.5 : E.T * 1.2;
      g.save();
      g.translate(F - 120 * u, roofY + 4 * u);
      g.scale(1, 0.12);
      g.fillStyle = rgb(shade(E, WOOD, 0.5));
      for (let k = 0; k < 4; k++) {
        g.rotate(a + (k * TAU) / 4 - (k ? a : 0));
        g.fillRect(0, -7 * u, 64 * u, 14 * u);
      }
      g.restore();
      if (d.old) lamp(g, E, F + 40 * u, H * 0.24, 80 * u, 2, WARM, 0.03);
    },
    floor,
    { floorHue: mix(d.floorHue, d.trim, 0.3) },
  );
}

function patio(c: Ctx): Scene {
  const { W, H, u, F, r } = c;
  const d = dress(c);
  const floor = H * 0.72;
  // It's all sky here: nothing between you and the weather but a fence.
  const win = new Path2D();
  win.rect(0, 0, W, floor);
  const fence = new Path2D();
  for (let x = 0; x < W; x += 24 * u) rr(fence, x, H * 0.44, 20 * u, floor - H * 0.44, 2 * u);
  fence.rect(0, H * 0.5, W, 4 * u);
  const pavers = new Path2D();
  grid(pavers, 0, floor, W, H, 62 * u, 24 * u, true);
  // A table with its umbrella.
  const tx = F - 110 * u;
  const table = new Path2D();
  ellipse(table, tx, H * 0.7, 88 * u, 11 * u);
  table.rect(tx - 2.5 * u, H * 0.22, 5 * u, H * 0.7);
  const canopy = new Path2D();
  canopy.moveTo(tx - 130 * u, H * 0.3);
  canopy.quadraticCurveTo(tx, H * 0.08, tx + 130 * u, H * 0.3);
  canopy.closePath();
  const seats = new Path2D();
  for (const dx of [-120, 120]) {
    rr(seats, tx + dx * u - 26 * u, H * 0.56, 52 * u, 42 * u, 6 * u);
    seats.rect(tx + dx * u - 28 * u, H * 0.72, 56 * u, 6 * u);
    seats.rect(tx + dx * u - 24 * u, H * 0.72, 4 * u, H * 0.2);
    seats.rect(tx + dx * u + 20 * u, H * 0.72, 4 * u, H * 0.2);
  }
  // The grill, with its lid on.
  const gx = F + 240 * u;
  const grill = new Path2D();
  grill.moveTo(gx - 50 * u, H * 0.58);
  grill.quadraticCurveTo(gx, H * 0.36, gx + 50 * u, H * 0.58);
  grill.closePath();
  grill.rect(gx - 54 * u, H * 0.58, 108 * u, 26 * u);
  for (const dx of [-44, 38]) grill.rect(gx + dx * u, H * 0.66, 6 * u, H * 0.28);
  // String lights from one side to the other.
  const bulbs: { x: number; y: number }[] = [];
  for (let x = 0; x < W; x += 32 * u) bulbs.push({ x, y: H * 0.08 + Math.abs(Math.sin((x - F) / (140 * u))) * 22 * u });
  const string = new Path2D();
  bulbs.forEach((b, i) => (i ? string.lineTo(b.x, b.y) : string.moveTo(b.x, b.y)));
  const pots: { x: number; p: Path2D }[] = [F - 390 * u, F + 120 * u].map((x) => {
    const p = new Path2D();
    leafy(p, x, floor + 4 * u, 56 * u);
    return { x, p };
  });
  const view = r() < 0.5 ? hillView(c) : townView(c);
  return room(
    c,
    win,
    d.trim,
    view,
    (g, E) => {
      fill(g, fence, shade(E, mix(WOOD, [200, 180, 150], 0.3), 0.5));
      stroke(g, pavers, [0, 0, 0], 1.2 * u, 0.22);
      for (const k of pots) {
        fill(g, k.p, shade(E, [70, 130, 74], 0.5));
        g.fillStyle = rgb(shade(E, [180, 110, 80], 0.5));
        g.fillRect(k.x - 18 * u, floor + 2 * u, 36 * u, 28 * u);
      }
      fill(g, seats, shade(E, d.old ? WOOD : [80, 76, 74], 0.45));
      fill(g, table, shade(E, d.old ? WOOD : [216, 212, 204], 0.5));
      fill(g, canopy, shade(E, d.fab, 0.55));
      fill(g, grill, [38, 36, 38]);
      const on = after(E);
      if (d.old) candle(g, E, tx, H * 0.7, u);
      else {
        stroke(g, string, [30, 28, 30], 0.8 * u, 0.7);
        for (const b of bulbs) {
          g.fillStyle = rgb(mix([120, 110, 90], [255, 226, 160], Math.max(on, 0.2)));
          g.beginPath();
          g.arc(b.x, b.y + 3 * u, 3 * u, 0, TAU);
          g.fill();
          if (on > 0.2) glowAt(g, b.x, b.y + 3 * u, 30 * u, [255, 214, 140], 0.5 * on);
        }
      }
    },
    floor,
    { floorHue: mix(STONE, d.floorHue, 0.3) },
  );
}

function atrium(c: Ctx): Scene {
  const { W, H, u, F, r } = c;
  const d = dress(c);
  const floor = H * 0.84;
  // A glass roof high overhead: the sky is the room's ceiling.
  const win = new Path2D();
  poly(win, F - 300 * u, 0, F + 300 * u, 0, F + 170 * u, H * 0.26, F - 170 * u, H * 0.26);
  const ribs = new Path2D();
  for (let k = 0; k <= 6; k++) {
    const t = k / 6;
    ribs.moveTo(F - 300 * u + t * 600 * u, 0);
    ribs.lineTo(F - 170 * u + t * 340 * u, H * 0.26);
  }
  ribs.moveTo(F - 235 * u, H * 0.13);
  ribs.lineTo(F + 235 * u, H * 0.13);
  ribs.moveTo(F - 170 * u, H * 0.26);
  ribs.lineTo(F + 170 * u, H * 0.26);
  // Two storeys of walkway round it.
  const floors = new Path2D();
  for (const y of [0.3, 0.56]) floors.rect(0, H * y, W, 8 * u);
  const rails = new Path2D();
  for (const y of [0.3, 0.56]) {
    rails.rect(0, H * y - 34 * u, W, 3 * u);
    for (let x = 0; x < W; x += 16 * u) rails.rect(x, H * y - 34 * u, 2 * u, 34 * u);
  }
  const pillars = new Path2D();
  for (let x = F % (170 * u); x < W; x += 170 * u) pillars.rect(x, H * 0.26, 14 * u, floor - H * 0.26);
  const arches = new Path2D();
  for (let x = F % (170 * u); x < W; x += 170 * u) {
    arches.moveTo(x + 14 * u, H * 0.56);
    arches.quadraticCurveTo(x + 85 * u, H * 0.34, x + 170 * u, H * 0.56);
  }
  // The tree in the middle, and a ring of stone round it.
  const trunk = new Path2D();
  trunk.moveTo(F - 14 * u, floor);
  trunk.quadraticCurveTo(F - 6 * u, H * 0.5, F - 20 * u, H * 0.3);
  trunk.lineTo(F + 18 * u, H * 0.3);
  trunk.quadraticCurveTo(F + 6 * u, H * 0.5, F + 16 * u, floor);
  trunk.closePath();
  const crown = new Path2D();
  leafy(crown, F, H * 0.5, 190 * u);
  const ring = new Path2D();
  ellipse(ring, F, floor + 2 * u, 86 * u, 14 * u);
  const benches = new Path2D();
  for (const dx of [-220, 140]) rr(benches, F + dx * u, H * 0.8, 80 * u, 12 * u, 4 * u);
  void r;
  return room(
    c,
    win,
    d.wall,
    hillView(c),
    (g, E) => {
      stroke(g, ribs, shade(E, d.old ? WOOD : [60, 60, 66], 0.45), 3 * u);
      fill(g, pillars, shade(E, mix(d.wall, STONE, 0.5), 0.5));
      stroke(g, arches, shade(E, d.trim, 0.5), 4 * u);
      fill(g, floors, shade(E, d.trim, 0.5));
      fill(g, rails, shade(E, d.old ? WOOD : [80, 76, 74], 0.45));
      // Daylight falling straight down from the roof.
      const a = E.day * (1 - E.c.cloud * 0.5) * 0.18;
      if (a > 0.01) {
        const lg = g.createLinearGradient(0, H * 0.26, 0, floor);
        lg.addColorStop(0, rgb([255, 244, 216], a));
        lg.addColorStop(1, rgb([255, 244, 216], a * 0.2));
        g.fillStyle = lg;
        g.beginPath();
        g.moveTo(F - 170 * u, H * 0.26);
        g.lineTo(F + 170 * u, H * 0.26);
        g.lineTo(F + 240 * u, floor);
        g.lineTo(F - 240 * u, floor);
        g.fill();
      }
      fill(g, trunk, shade(E, WOOD, 0.45));
      fill(g, crown, shade(E, [66, 124, 70], 0.55));
      fill(g, ring, shade(E, STONE, 0.5));
      fill(g, benches, shade(E, WOOD, 0.45));
      if (d.old) for (const x of [F - 170 * u, F + 170 * u]) candle(g, E, x, H * 0.3, u);
      else for (const x of [F - 170 * u, F + 170 * u]) lamp(g, E, x, H * 0.5, 80 * u, x, WARM, 0.04);
    },
    floor,
    { floorHue: mix(d.floorHue, STONE, 0.4) },
  );
}

export const LAST_HOMES = {
  playroom,
  craftroom,
  atelier,
  trophyroom,
  winecellar,
  sauna,
  dressing,
  sickroom,
  longgallery,
  crawlspace,
  panicroom,
  hiddenroom,
  dorm,
  trailer,
  houseboat,
  beachhouse,
  cottage,
  screenporch,
  patio,
  atrium,
} satisfies Partial<Record<Place, (c: Ctx) => Scene>>;
