/**
 * The second wave of the house's rooms (docs/24-rooms-of-the-house.md §3). Painted and dressed like
 * homescenes.ts, and read the same way: one or two big shapes first, the hour and weather after.
 */
import { after, candle, ceilingLight, dress, windowAt } from "./homescenes";
import { DARK, FABRIC, mix, rgb, TAU, WARM, type Ctx, type Env, type Place, type RGB } from "./places";
import { clock, drapes, ellipse, grid, lampsOn, none, pick, rr, shut, steam } from "./scenebits";
import { fill, fire, glowAt, hillView, lamp, leafy, panes, poly, room, SCENES, shade, skirting, spill, stroke, STONE, townView, wallDressing, WOOD, type Scene } from "./scenes";

type G = CanvasRenderingContext2D;

const BOTTLES: RGB[] = [
  [60, 120, 70],
  [170, 110, 40],
  [120, 60, 50],
  [200, 200, 210],
  [90, 110, 150],
];
const cityView = (c: Ctx) => {
  const s = SCENES.city(c);
  return (g: G, E: Env) => s.draw(g, E);
};
/** A floor lamp, or a candle stand in an old-world house. */
function floorLamp(c: Ctx, x: number, floor: number) {
  const { H, u, home } = c;
  const pole = new Path2D();
  pole.rect(x - 1.5 * u, H * 0.3, 3 * u, floor - H * 0.3);
  ellipse(pole, x, floor, 14 * u, 3 * u);
  const sh = new Path2D();
  poly(sh, x - 20 * u, H * 0.3, x + 20 * u, H * 0.3, x + 12 * u, H * 0.21, x - 12 * u, H * 0.21);
  const old = home?.style === "old";
  return (g: G, E: Env) => {
    const on = after(E);
    fill(g, pole, [32, 28, 28]);
    if (old) {
      if (on > 0.1) fire(g, E, x, H * 0.3, u * 0.5);
      glowAt(g, x, H * 0.28, 130 * u, WARM, 0.36 * on);
    } else {
      fill(g, sh, mix(shade(E, [236, 222, 196]), [255, 226, 176], on));
      glowAt(g, x, H * 0.27, 170 * u, WARM, 0.48 * on);
    }
  };
}
/** Books filling a run of shelves. */
function bookRows(c: Ctx, x0: number, x1: number, rows: number[], tall = 34) {
  const { u, r } = c;
  const hues = [...FABRIC, [150, 120, 90]] as RGB[];
  const books = hues.map(() => new Path2D());
  for (const y of rows)
    for (let x = x0; x < x1; ) {
      const w = (6 + r() * 8) * u;
      if (r() < 0.85) {
        const h = (tall * 0.6 + r() * tall * 0.4) * u;
        books[(r() * books.length) | 0]!.rect(x, y - h, w - 1 * u, h);
      }
      x += w;
    }
  return (g: G, E: Env) => books.forEach((p, i) => fill(g, p, shade(E, hues[i]!, 0.42)));
}

// ---------- Gathering rooms ----------

function parlor(c: Ctx): Scene {
  const { H, u, F, r } = c;
  const d = dress(c);
  const floor = H * 0.82;
  const wx = F - 400 * u;
  const { win, frame } = windowAt(wx, H * 0.08, 110 * u, H * 0.56, u, d.old || d.grand);
  const curt = new Path2D();
  drapes(curt, wx, wx + 110 * u, H * 0.08, floor, u);
  // The mantel is the room's middle: a fire, a clock, a portrait over it.
  const mx = F - 120 * u;
  const surround = new Path2D();
  surround.rect(mx - 70 * u, H * 0.46, 140 * u, floor - H * 0.46);
  const shelf = new Path2D();
  shelf.rect(mx - 82 * u, H * 0.44, 164 * u, 8 * u);
  const mouth = new Path2D();
  mouth.moveTo(mx - 40 * u, floor);
  mouth.lineTo(mx - 40 * u, H * 0.62);
  mouth.quadraticCurveTo(mx, H * 0.53, mx + 40 * u, H * 0.62);
  mouth.lineTo(mx + 40 * u, floor);
  mouth.closePath();
  const portrait = new Path2D();
  rr(portrait, mx - 40 * u, H * 0.1, 80 * u, H * 0.3, 3 * u);
  const sitter = new Path2D();
  ellipse(sitter, mx, H * 0.2, 13 * u, 16 * u);
  poly(sitter, mx - 28 * u, H * 0.38, mx + 28 * u, H * 0.38, mx + 16 * u, H * 0.26, mx - 16 * u, H * 0.26);
  // The settee, with its curved back and thin legs.
  const sx = F + 30 * u;
  const settee = new Path2D();
  settee.moveTo(sx, H * 0.72);
  settee.bezierCurveTo(sx - 6 * u, H * 0.42, sx + 90 * u, H * 0.44, sx + 110 * u, H * 0.5);
  settee.bezierCurveTo(sx + 130 * u, H * 0.44, sx + 226 * u, H * 0.42, sx + 220 * u, H * 0.72);
  settee.closePath();
  const seat = new Path2D();
  rr(seat, sx - 6 * u, H * 0.68, 232 * u, 22 * u, 8 * u);
  const legs = new Path2D();
  for (const x of [sx + 6 * u, sx + 208 * u]) legs.rect(x, H * 0.74, 5 * u, floor - H * 0.74 + 4 * u);
  const table = new Path2D();
  ellipse(table, sx + 110 * u, H * 0.84, 54 * u, 7 * u);
  table.rect(sx + 108 * u, H * 0.84, 4 * u, H * 0.1);
  const rug = new Path2D();
  ellipse(rug, sx + 80 * u, H * 0.92, 230 * u, 15 * u);
  const view = r() < 0.5 ? townView(c) : hillView(c);
  const hang = wallDressing(c, 0, wx - 50 * u);
  const standLamp = floorLamp(c, sx + 280 * u, floor);
  return room(
    c,
    win,
    d.wall,
    view,
    (g, E) => {
      hang(g, E);
      skirting(g, E, c, floor);
      spill(g, E, wx, wx + 110 * u, H * 0.64, floor, 80 * u);
      fill(g, frame, shade(E, d.trim, 0.6));
      fill(g, curt, shade(E, d.fab, 0.45));
      fill(g, portrait, shade(E, mix(d.wall, DARK, 0.4), 0.45));
      fill(g, sitter, shade(E, mix(d.fab, DARK, 0.3), 0.45));
      stroke(g, portrait, shade(E, [176, 146, 90], 0.5), 5 * u);
      fill(g, surround, shade(E, d.old ? STONE : mix(d.trim, [160, 150, 140], 0.3), 0.5));
      fill(g, shelf, shade(E, d.old ? WOOD : d.trim, 0.55));
      fill(g, mouth, [20, 12, 12]);
      if (E.glow > 0.4 || E.c.snow > 0.2) {
        glowAt(g, mx, floor - 14 * u, 190 * u, [255, 140, 60], 0.42);
        fire(g, E, mx, floor - 3 * u, u * 1.4);
      }
      clock(g, E, mx, H * 0.415, 9 * u);
      fill(g, rug, shade(E, mix(d.fab, [120, 100, 90], 0.5), 0.4));
      fill(g, legs, shade(E, WOOD, 0.45));
      fill(g, settee, shade(E, d.soft, 0.45));
      fill(g, seat, shade(E, mix(d.soft, [255, 255, 255], 0.12), 0.5));
      fill(g, table, shade(E, WOOD, 0.5));
      standLamp(g, E);
    },
    floor,
    { floorHue: d.floorHue },
  );
}

function nook(c: Ctx): Scene {
  const { W, H, u, F, r } = c;
  const d = dress(c);
  const floor = H * 0.84;
  // A bay of three windows, with the bench built in under them.
  const win = new Path2D();
  const frame = new Path2D();
  const bays: [number, number][] = [
    [F - 210 * u, 110 * u],
    [F - 90 * u, 180 * u],
    [F + 100 * u, 110 * u],
  ];
  for (const [x, w] of bays) {
    win.rect(x, H * 0.1, w, H * 0.44);
    panes(frame, x, H * 0.1, w, H * 0.44, d.old ? 4 : 2, d.old ? 4 : 2, 2.2 * u);
  }
  const bench = new Path2D();
  bench.rect(F - 230 * u, H * 0.58, 460 * u, floor - H * 0.58);
  const pad = new Path2D();
  rr(pad, F - 226 * u, H * 0.55, 452 * u, 16 * u, 6 * u);
  const panels = new Path2D();
  grid(panels, F - 230 * u, H * 0.62, F + 230 * u, floor, 60 * u, floor - H * 0.62);
  const tx = F;
  const table = new Path2D();
  ellipse(table, tx, H * 0.7, 84 * u, 10 * u);
  table.rect(tx - 5 * u, H * 0.7, 10 * u, H * 0.9 - H * 0.7);
  ellipse(table, tx, H * 0.91, 36 * u, 6 * u);
  const mug = new Path2D();
  rr(mug, tx - 32 * u, H * 0.7 - 15 * u, 12 * u, 14 * u, 2 * u);
  const toast = new Path2D();
  ellipse(toast, tx + 22 * u, H * 0.69, 22 * u, 4 * u);
  const shelf = new Path2D();
  shelf.rect(F - 400 * u, H * 0.36, 130 * u, 4 * u);
  const pots: { x: number; c: RGB }[] = [0, 42, 84].map((dx) => ({ x: F - 392 * u + dx * u, c: pick(r, FABRIC) }));
  const view = r() < 0.6 ? hillView(c) : townView(c);
  const hang = wallDressing(c, 0, F - 430 * u);
  void W;
  return room(
    c,
    win,
    d.wall,
    view,
    (g, E) => {
      hang(g, E);
      skirting(g, E, c, floor);
      fill(g, frame, shade(E, d.trim, 0.6));
      // This is the room for morning: the sun comes in low across the table.
      const morning = E.t >= 6 && E.t < 11 ? 1.6 : 1;
      for (const [x, w] of bays) {
        g.save();
        g.globalAlpha = Math.min(1, morning * 0.8);
        spill(g, E, x, x + w, H * 0.54, floor, 60 * u);
        g.restore();
      }
      fill(g, shelf, shade(E, WOOD, 0.5));
      for (const p of pots) {
        g.fillStyle = rgb(shade(E, p.c, 0.5));
        g.fillRect(p.x, H * 0.36 - 22 * u, 24 * u, 22 * u);
      }
      fill(g, bench, shade(E, mix(d.trim, WOOD, 0.25), 0.5));
      stroke(g, panels, [0, 0, 0], 1 * u, 0.2);
      fill(g, pad, shade(E, d.fab, 0.5));
      fill(g, table, shade(E, WOOD, 0.55));
      if (E.t >= 6 && E.t < 11) {
        fill(g, mug, shade(E, [232, 228, 222], 0.6));
        fill(g, toast, shade(E, [236, 232, 224], 0.6));
        steam(g, E, tx - 26 * u, H * 0.7 - 16 * u, u, 3, 3, 0.08);
      }
      if (d.old) candle(g, E, tx + 30 * u, H * 0.7, u);
      else ceilingLight(g, E, d, tx, H * 0.08, u);
    },
    floor,
    { floorHue: d.floorHue },
  );
}

function sunroom(c: Ctx): Scene {
  const { W, H, u, F, r } = c;
  const d = dress(c);
  const floor = H * 0.84;
  const top = H * 0.08;
  const sill = H * 0.6;
  const win = new Path2D();
  win.rect(0, top, W, sill - top);
  const frame = new Path2D();
  for (let x = F % (88 * u); x < W; x += 88 * u) frame.rect(x - 2 * u, top, 4 * u, sill - top);
  frame.rect(0, top + (sill - top) * 0.32, W, 2.5 * u);
  frame.rect(0, top - 3 * u, W, 6 * u);
  const low = new Path2D();
  low.rect(0, sill, W, floor - sill);
  const ledge = new Path2D();
  ledge.rect(0, sill - 3 * u, W, 7 * u);
  const wicker = (x: number) => {
    const p = new Path2D();
    p.moveTo(x - 46 * u, floor);
    p.lineTo(x - 42 * u, H * 0.62);
    p.bezierCurveTo(x - 56 * u, H * 0.36, x + 56 * u, H * 0.36, x + 42 * u, H * 0.62);
    p.lineTo(x + 46 * u, floor);
    p.closePath();
    return p;
  };
  const chairs = [wicker(F - 150 * u), wicker(F + 110 * u)];
  const weave = new Path2D();
  for (const cx of [F - 150 * u, F + 110 * u]) grid(weave, cx - 36 * u, H * 0.48, cx + 36 * u, floor - 6 * u, 10 * u, 10 * u);
  const pads = new Path2D();
  for (const cx of [F - 150 * u, F + 110 * u]) rr(pads, cx - 38 * u, H * 0.68, 76 * u, 18 * u, 7 * u);
  const table = new Path2D();
  ellipse(table, F - 20 * u, H * 0.74, 40 * u, 6 * u);
  table.rect(F - 22 * u, H * 0.74, 4 * u, floor - H * 0.74);
  const hanging = [F - 300 * u, F - 40 * u, F + 240 * u, F - 500 * u].map((x) => {
    const p = new Path2D();
    leafy(p, x, H * 0.34, 54 * u);
    return { x, p };
  });
  const pots = new Path2D();
  for (const { x } of hanging) poly(pots, x - 14 * u, H * 0.32, x + 14 * u, H * 0.32, x + 9 * u, H * 0.37, x - 9 * u, H * 0.37);
  const fern = new Path2D();
  leafy(fern, F + 280 * u, floor - 30 * u, 90 * u);
  const urn = new Path2D();
  poly(urn, F + 262 * u, floor - 32 * u, F + 298 * u, floor - 32 * u, F + 290 * u, floor, F + 270 * u, floor);
  const view = r() < 0.6 ? hillView(c) : townView(c);
  return room(
    c,
    win,
    d.trim,
    view,
    (g, E) => {
      fill(g, frame, shade(E, d.old ? WOOD : d.trim, 0.65));
      fill(g, low, shade(E, mix(d.wall, d.trim, 0.3), 0.5));
      fill(g, ledge, shade(E, d.trim, 0.6));
      spill(g, E, F - 300 * u, F + 240 * u, sill, floor, 60 * u);
      for (const { x, p } of hanging) {
        g.fillStyle = "rgba(40,36,36,.7)";
        g.fillRect(x - 0.5 * u, top, 1 * u, H * 0.32 - top);
        fill(g, p, shade(E, [70, 130, 74], 0.55));
      }
      fill(g, pots, shade(E, [180, 110, 80], 0.5));
      for (const p of chairs) fill(g, p, shade(E, [188, 150, 100], 0.55));
      stroke(g, weave, shade(E, [120, 90, 56], 0.5), 0.8 * u, 0.5);
      fill(g, pads, shade(E, d.fab, 0.5));
      fill(g, table, shade(E, WOOD, 0.5));
      fill(g, urn, shade(E, [180, 110, 80], 0.5));
      fill(g, fern, shade(E, [70, 130, 74], 0.5));
    },
    floor,
    { floorHue: mix(d.floorHue, [190, 180, 165], 0.4) },
  );
}

function greatroom(c: Ctx): Scene {
  const { W, H, u, F, r } = c;
  const d = dress(c);
  const floor = H * 0.86;
  // A wall of glass the full height of the house.
  const gx = F - 240 * u;
  const gw = 360 * u;
  const win = new Path2D();
  win.rect(gx, H * 0.03, gw, floor - H * 0.03 - 8 * u);
  const frame = new Path2D();
  panes(frame, gx, H * 0.03, gw, floor - H * 0.03 - 8 * u, 5, 4, 2.6 * u);
  // The gallery along the upper floor, to the left.
  const gallery = new Path2D();
  gallery.rect(0, H * 0.46, gx - 14 * u, 12 * u);
  const rails = new Path2D();
  rails.rect(0, H * 0.26, gx - 14 * u, 4 * u);
  for (let x = 8 * u; x < gx - 14 * u; x += 16 * u) rails.rect(x, H * 0.26, 2.2 * u, H * 0.2);
  // The chimney breast, right up to the roof.
  const hx = F + 240 * u;
  const stone = new Path2D();
  stone.rect(hx - 90 * u, 0, 180 * u, floor);
  const courses = new Path2D();
  grid(courses, hx - 90 * u, 0, hx + 90 * u, floor, 34 * u, 20 * u, true);
  const mouth = new Path2D();
  mouth.moveTo(hx - 56 * u, floor);
  mouth.lineTo(hx - 56 * u, H * 0.6);
  mouth.quadraticCurveTo(hx, H * 0.48, hx + 56 * u, H * 0.6);
  mouth.lineTo(hx + 56 * u, floor);
  mouth.closePath();
  const beam = new Path2D();
  beam.rect(hx - 104 * u, H * 0.46, 208 * u, 12 * u);
  // A long low sofa, its back to you.
  const sofa = new Path2D();
  rr(sofa, F - 200 * u, H * 0.76, 330 * u, H * 0.3, 16 * u);
  const view = r() < 0.6 ? hillView(c) : townView(c);
  void W;
  return room(
    c,
    win,
    d.wall,
    view,
    (g, E) => {
      fill(g, frame, shade(E, d.old ? WOOD : mix(d.trim, DARK, 0.2), 0.55));
      spill(g, E, gx, gx + gw, floor - 10 * u, floor, 70 * u);
      fill(g, gallery, shade(E, WOOD, 0.45));
      fill(g, rails, shade(E, WOOD, 0.5));
      fill(g, stone, shade(E, STONE, 0.45));
      stroke(g, courses, [0, 0, 0], 1 * u, 0.25);
      fill(g, mouth, [20, 12, 12]);
      fill(g, beam, shade(E, WOOD, 0.5));
      if (E.glow > 0.35 || E.c.snow > 0.2) {
        glowAt(g, hx, floor - 18 * u, 280 * u, [255, 140, 60], 0.45);
        fire(g, E, hx, floor - 3 * u, u * 2);
      }
      fill(g, sofa, shade(E, d.soft, 0.42));
      if (!d.old) ceilingLight(g, E, d, F - 60 * u, H * 0.1, u);
    },
    floor,
    { floorHue: d.floorHue },
  );
}

// ---------- Leisure rooms ----------

function gameroom(c: Ctx): Scene {
  const { H, u, F, r } = c;
  const d = dress(c);
  const floor = H * 0.72;
  const wall = mix(d.wall, [70, 44, 40], 0.6);
  const tx = F - 40 * u;
  // The table is the room: green baize, seen a little from above.
  const baize = new Path2D();
  poly(baize, tx - 200 * u, H * 0.56, tx + 200 * u, H * 0.56, tx + 244 * u, H * 0.76, tx - 244 * u, H * 0.76);
  const rim = new Path2D();
  poly(rim, tx - 212 * u, H * 0.54, tx + 212 * u, H * 0.54, tx + 262 * u, H * 0.78, tx - 262 * u, H * 0.78);
  const body = new Path2D();
  body.rect(tx - 262 * u, H * 0.78, 524 * u, 24 * u);
  for (const x of [tx - 250 * u, tx + 222 * u]) body.rect(x, H * 0.78, 28 * u, H * 0.2);
  const balls: { x: number; y: number; c: RGB }[] = Array.from({ length: 9 }, () => ({ x: tx + (r() * 2 - 1) * 170 * u, y: H * (0.6 + r() * 0.13), c: pick(r, [...FABRIC, [240, 236, 226], [24, 24, 26]] as RGB[]) }));
  const cue = new Path2D();
  cue.moveTo(tx - 150 * u, H * 0.72);
  cue.lineTo(tx + 50 * u, H * 0.63);
  // The long lamp, low over the table.
  const lampP = new Path2D();
  rr(lampP, tx - 150 * u, H * 0.27, 300 * u, 22 * u, 6 * u);
  const rods = new Path2D();
  for (const dx of [-110, 110]) rods.rect(tx + dx * u, 0, 2 * u, H * 0.27);
  const rack = new Path2D();
  rack.rect(F - 420 * u, H * 0.2, 90 * u, 8 * u);
  for (let k = 0; k < 5; k++) rack.rect(F - 412 * u + k * 18 * u, H * 0.2, 3 * u, H * 0.42);
  const bx = F + 280 * u;
  const rings: [number, RGB][] = [
    [36, [24, 22, 22]],
    [28, [190, 50, 44]],
    [18, [226, 214, 180]],
    [9, [40, 110, 70]],
    [3, [190, 50, 44]],
  ];
  const sign = new Path2D();
  rr(sign, F - 300 * u, H * 0.1, 100 * u, 34 * u, 15 * u);
  const hang = wallDressing(c, 0, F - 450 * u);
  return room(
    c,
    shut(),
    wall,
    none,
    (g, E) => {
      hang(g, E);
      fill(g, rack, shade(E, WOOD, 0.45));
      for (const [rad, col] of rings) {
        g.fillStyle = rgb(shade(E, col, 0.55));
        g.beginPath();
        g.arc(bx, H * 0.32, rad * u, 0, TAU);
        g.fill();
      }
      if (!d.old) {
        stroke(g, sign, [255, 90, 120], 3 * u, 0.9);
        glowAt(g, F - 250 * u, H * 0.16, 110 * u, [255, 90, 120], 0.3);
      }
      fill(g, rim, shade(E, WOOD, 0.5));
      fill(g, body, shade(E, mix(WOOD, DARK, 0.25), 0.45));
      const on = lampsOn(E, 0.6);
      fill(g, baize, mix([20, 60, 40], [46, 130, 84], on));
      for (const b of balls) {
        g.fillStyle = rgb(mix(b.c, DARK, 0.1));
        g.beginPath();
        g.arc(b.x, b.y, 6 * u, 0, TAU);
        g.fill();
      }
      stroke(g, cue, shade(E, [220, 190, 140], 0.8), 2.4 * u);
      fill(g, rods, [30, 26, 26]);
      fill(g, lampP, shade(E, d.fab, 0.45));
      glowAt(g, tx, H * 0.42, 320 * u, WARM, 0.32 * on);
    },
    floor,
    { lift: 0.32, space: true, floorHue: d.floorHue },
  );
}

function homebar(c: Ctx): Scene {
  const { H, u, F, r } = c;
  const d = dress(c);
  const floor = H * 0.84;
  const wall = mix(d.wall, [52, 40, 44], 0.7);
  // Lit shelves of bottles behind, a counter and stools in front.
  const bx0 = F - 280 * u;
  const bw = 480 * u;
  const back = new Path2D();
  back.rect(bx0, H * 0.1, bw, H * 0.44);
  const shelf = new Path2D();
  for (const y of [0.26, 0.42, 0.54]) shelf.rect(bx0, H * y, bw, 4 * u);
  const bottles: { x: number; y: number; h: number; c: RGB }[] = [];
  for (const y of [0.26, 0.42, 0.54])
    for (let x = bx0 + 10 * u; x < bx0 + bw - 14 * u; x += (16 + r() * 16) * u) if (r() < 0.82) bottles.push({ x, y: H * y, h: (22 + r() * 16) * u, c: pick(r, BOTTLES) });
  const counter = new Path2D();
  counter.rect(F - 320 * u, H * 0.68, 560 * u, 10 * u);
  const front = new Path2D();
  front.rect(F - 310 * u, H * 0.68 + 10 * u, 540 * u, H - H * 0.68);
  const panels = new Path2D();
  grid(panels, F - 310 * u, H * 0.68 + 10 * u, F + 230 * u, H, 90 * u, H);
  const stools = [F - 220 * u, F - 70 * u, F + 80 * u];
  const seats = new Path2D();
  for (const x of stools) {
    rr(seats, x - 30 * u, H * 0.8, 60 * u, 14 * u, 6 * u);
    seats.rect(x - 3 * u, H * 0.8, 6 * u, H * 0.3);
  }
  const glasses = new Path2D();
  for (const dx of [-120, -96, 40]) glasses.rect(F + dx * u, H * 0.68 - 18 * u, 11 * u, 18 * u);
  const pendants = [F - 200 * u, F - 40 * u, F + 120 * u];
  const hang = wallDressing(c, 0, F - 360 * u);
  return room(
    c,
    shut(),
    wall,
    none,
    (g, E) => {
      hang(g, E);
      // The backlight comes up as the day goes.
      const on = lampsOn(E, 0.3);
      fill(g, back, mix(shade(E, [90, 70, 56], 0.45), [240, 190, 120], on * 0.7));
      for (const b of bottles) {
        g.fillStyle = rgb(mix(mix(b.c, DARK, 0.5), b.c, 0.3 + on * 0.6), 0.95);
        g.fillRect(b.x, b.y - b.h, 9 * u, b.h);
        g.fillRect(b.x + 3 * u, b.y - b.h - 7 * u, 3 * u, 7 * u);
      }
      fill(g, shelf, shade(E, WOOD, 0.45));
      fill(g, front, shade(E, mix(WOOD, DARK, 0.2), 0.45));
      stroke(g, panels, [0, 0, 0], 1.2 * u, 0.3);
      fill(g, counter, shade(E, mix(WOOD, [255, 230, 190], 0.15), 0.55));
      fill(g, glasses, shade(E, [210, 224, 232], 0.65), 0.75);
      fill(g, seats, shade(E, d.soft, 0.42));
      if (d.old) for (const x of pendants) candle(g, E, x, H * 0.68, u);
      else for (const x of pendants) ceilingLight(g, E, { ...d, grand: false }, x, H * 0.14, u);
    },
    floor,
    { lift: 0.3, space: true, floorHue: d.floorHue },
  );
}

function recroom(c: Ctx): Scene {
  const { W, H, u, F, r } = c;
  const d = dress(c);
  const floor = H * 0.76;
  // A low ceiling of tiles, high slits of window, old carpet.
  const win = new Path2D();
  const frame = new Path2D();
  for (const x of [F - 340 * u, F + 100 * u]) {
    win.rect(x, H * 0.2, 90 * u, 26 * u);
    panes(frame, x, H * 0.2, 90 * u, 26 * u, 2, 1, 1.6 * u);
  }
  const ceil = new Path2D();
  ceil.rect(0, 0, W, H * 0.16);
  const tiles = new Path2D();
  grid(tiles, 0, 0, W, H * 0.16, 54 * u, 22 * u);
  const panels = new Path2D();
  grid(panels, 0, H * 0.16, W, floor, 60 * u, floor - H * 0.16);
  // The ping-pong table.
  const tx = F;
  const top = new Path2D();
  poly(top, tx - 130 * u, H * 0.56, tx + 130 * u, H * 0.56, tx + 180 * u, H * 0.74, tx - 180 * u, H * 0.74);
  const white = new Path2D();
  white.moveTo(tx, H * 0.56);
  white.lineTo(tx, H * 0.74);
  white.moveTo(tx - 130 * u, H * 0.56);
  white.lineTo(tx + 130 * u, H * 0.56);
  white.lineTo(tx + 180 * u, H * 0.74);
  white.lineTo(tx - 180 * u, H * 0.74);
  white.closePath();
  const net = new Path2D();
  net.rect(tx - 150 * u, H * 0.6, 300 * u, 15 * u);
  const legs = new Path2D();
  for (const x of [tx - 170 * u, tx + 160 * u]) legs.rect(x, H * 0.74, 10 * u, H * 0.2);
  // The old couch, and the heater on the wall.
  const couch = new Path2D();
  rr(couch, F - 480 * u, H * 0.48, 210 * u, H * 0.4, 16 * u);
  const cush = new Path2D();
  for (const dx of [-470, -405, -340]) rr(cush, F + dx * u, H * 0.62, 60 * u, 22 * u, 8 * u);
  const heater = new Path2D();
  heater.rect(F + 250 * u, H * 0.56, 120 * u, 40 * u);
  const fins = new Path2D();
  for (let k = 0; k < 10; k++) fins.rect(F + 256 * u + k * 11 * u, H * 0.58, 4 * u, 28 * u);
  const poster = new Path2D();
  poster.rect(F - 180 * u, H * 0.24, 70 * u, 90 * u);
  const art = pick(r, FABRIC);
  const view = hillView(c);
  return room(
    c,
    win,
    mix(WOOD, d.wall, 0.3),
    view,
    (g, E) => {
      stroke(g, panels, [0, 0, 0], 1.2 * u, 0.28);
      fill(g, frame, shade(E, d.trim, 0.5));
      fill(g, ceil, shade(E, [216, 212, 202], 0.42));
      stroke(g, tiles, [0, 0, 0], 1 * u, 0.2);
      fill(g, poster, shade(E, mix(art, [220, 210, 190], 0.35), 0.5));
      fill(g, heater, shade(E, [190, 186, 176], 0.45));
      fill(g, fins, [0, 0, 0], 0.3);
      fill(g, couch, shade(E, d.soft, 0.4));
      fill(g, cush, shade(E, mix(d.soft, [255, 255, 255], 0.1), 0.45));
      fill(g, legs, [30, 28, 30]);
      fill(g, top, shade(E, [40, 96, 80], 0.5));
      stroke(g, white, shade(E, [240, 240, 236], 0.6), 1.6 * u);
      fill(g, net, shade(E, [230, 230, 226], 0.5), 0.45);
      const on = lampsOn(E, 0.45);
      for (const x of [F - 260 * u, F + 200 * u]) {
        g.fillStyle = rgb(mix([190, 190, 180], [255, 250, 230], on));
        g.fillRect(x - 40 * u, H * 0.145, 80 * u, 6 * u);
        glowAt(g, x, H * 0.2, 220 * u, [240, 240, 220], 0.2 * on);
      }
    },
    floor,
    { floorHue: mix(d.fab, [110, 100, 90], 0.65) },
  );
}

function musicroom(c: Ctx): Scene {
  const { H, u, F, r } = c;
  const d = dress(c);
  const floor = H * 0.8;
  const wx = F - 410 * u;
  const { win, frame } = windowAt(wx, H * 0.1, 120 * u, H * 0.5, u, d.old);
  const curt = new Path2D();
  drapes(curt, wx, wx + 120 * u, H * 0.1, floor, u);
  // The grand piano, side on, with its lid up.
  const px = F - 120 * u;
  const pw = 300 * u;
  const case_ = new Path2D();
  case_.moveTo(px, H * 0.56);
  case_.lineTo(px + pw * 0.46, H * 0.56);
  case_.bezierCurveTo(px + pw * 0.6, H * 0.56, px + pw * 0.66, H * 0.64, px + pw, H * 0.6);
  case_.lineTo(px + pw, H * 0.7);
  case_.lineTo(px, H * 0.7);
  case_.closePath();
  const lid = new Path2D();
  poly(lid, px + 30 * u, H * 0.55, px + pw * 0.98, H * 0.59, px + pw * 0.86, H * 0.22, px + 60 * u, H * 0.31);
  const prop = new Path2D();
  prop.rect(px + pw * 0.62, H * 0.32, 3 * u, H * 0.26);
  const legs = new Path2D();
  for (const x of [px + 22 * u, px + pw - 40 * u, px + pw * 0.5]) poly(legs, x, H * 0.7, x + 18 * u, H * 0.7, x + 13 * u, floor + 4 * u, x + 5 * u, floor + 4 * u);
  const keys = new Path2D();
  keys.rect(px - 18 * u, H * 0.61, 34 * u, 9 * u);
  const stoolP = new Path2D();
  rr(stoolP, px - 86 * u, H * 0.68, 60 * u, 12 * u, 4 * u);
  for (const x of [px - 80 * u, px - 40 * u]) stoolP.rect(x, H * 0.68, 4 * u, floor - H * 0.68);
  const sheet = new Path2D();
  sheet.rect(px - 4 * u, H * 0.47, 38 * u, 26 * u);
  // Instruments on the far wall, and a stand.
  const gx = F + 260 * u;
  const guitars = [gx, gx + 62 * u].map((x) => {
    const p = new Path2D();
    ellipse(p, x, H * 0.48, 22 * u, 28 * u);
    ellipse(p, x, H * 0.38, 15 * u, 18 * u);
    p.rect(x - 3 * u, H * 0.13, 6 * u, H * 0.26);
    return p;
  });
  const view = r() < 0.5 ? townView(c) : hillView(c);
  const hang = wallDressing(c, 0, wx - 50 * u);
  return room(
    c,
    win,
    d.wall,
    view,
    (g, E) => {
      hang(g, E);
      skirting(g, E, c, floor);
      spill(g, E, wx, wx + 120 * u, H * 0.6, floor, 90 * u);
      fill(g, frame, shade(E, d.trim, 0.6));
      fill(g, curt, shade(E, d.fab, 0.45));
      guitars.forEach((p, i) => fill(g, p, shade(E, i ? [150, 86, 48] : [190, 140, 80], 0.5)));
      fill(g, legs, [18, 16, 18]);
      fill(g, prop, [40, 36, 38]);
      fill(g, lid, shade(E, [36, 32, 36], 0.4));
      fill(g, case_, shade(E, [28, 24, 28], 0.35));
      fill(g, keys, shade(E, [240, 236, 226], 0.6));
      fill(g, sheet, shade(E, [240, 236, 226], 0.65));
      fill(g, stoolP, shade(E, mix(d.soft, DARK, 0.4), 0.4));
      const on = after(E);
      // A lamp on the keys.
      if (d.old) candle(g, E, px + 46 * u, H * 0.56, u);
      else lamp(g, E, px + 16 * u, H * 0.47, 130 * u, 2, WARM, 0.05);
      glowAt(g, px + 16 * u, H * 0.56, 150 * u, WARM, 0.25 * on);
    },
    floor,
    { floorHue: d.floorHue },
  );
}

function homegym(c: Ctx): Scene {
  const { H, u, F, r } = c;
  const d = dress(c);
  const floor = H * 0.84;
  const { win, frame } = windowAt(F - 430 * u, H * 0.12, 110 * u, H * 0.42, u, false);
  // The mirror wall holds the morning.
  const mx = F - 270 * u;
  const mirror = new Path2D();
  mirror.rect(mx, H * 0.08, 380 * u, floor - H * 0.08);
  const seams = new Path2D();
  for (let x = mx + 95 * u; x < mx + 380 * u; x += 95 * u) seams.rect(x, H * 0.08, 2 * u, floor - H * 0.08);
  const rack = new Path2D();
  const rx = F + 150 * u;
  rack.rect(rx, H * 0.3, 8 * u, floor - H * 0.3);
  rack.rect(rx + 150 * u, H * 0.3, 8 * u, floor - H * 0.3);
  for (const y of [0.42, 0.6, 0.76]) rack.rect(rx, H * y, 158 * u, 6 * u);
  const weights: { x: number; y: number; s: number }[] = [];
  for (const y of [0.42, 0.6, 0.76]) for (let k = 0; k < 4; k++) weights.push({ x: rx + 26 * u + k * 36 * u, y: H * y, s: (y === 0.76 ? 14 : y === 0.6 ? 11 : 8) * u });
  // A bench with a bar over it, a treadmill.
  const bench = new Path2D();
  rr(bench, F - 110 * u, H * 0.68, 180 * u, 16 * u, 6 * u);
  for (const x of [F - 90 * u, F + 40 * u]) bench.rect(x, H * 0.7, 8 * u, floor - H * 0.7);
  const bar = new Path2D();
  bar.rect(F - 200 * u, H * 0.48, 360 * u, 5 * u);
  const plates = new Path2D();
  for (const x of [F - 190 * u, F + 140 * u]) rr(plates, x, H * 0.48 - 34 * u, 16 * u, 72 * u, 4 * u);
  const uprights = new Path2D();
  for (const x of [F - 120 * u, F + 80 * u]) uprights.rect(x, H * 0.46, 6 * u, floor - H * 0.46);
  const mat = new Path2D();
  poly(mat, F - 250 * u, H * 0.92, F + 120 * u, H * 0.92, F + 150 * u, H, F - 280 * u, H);
  const hue = pick(r, FABRIC);
  const view = hillView(c);
  const hang = wallDressing(c, 0, F - 470 * u);
  return room(
    c,
    win,
    mix(d.wall, [200, 200, 198], 0.4),
    view,
    (g, E) => {
      hang(g, E);
      fill(g, frame, shade(E, d.trim, 0.6));
      const mg = g.createLinearGradient(mx, H * 0.08, mx + 380 * u, floor);
      mg.addColorStop(0, rgb(shade(E, [190, 204, 214], 0.6)));
      mg.addColorStop(0.5, rgb(shade(E, [226, 234, 240], 0.6)));
      mg.addColorStop(1, rgb(shade(E, [170, 186, 196], 0.6)));
      g.fillStyle = mg;
      g.fill(mirror);
      fill(g, seams, [255, 255, 255], 0.25);
      fill(g, rack, shade(E, [60, 60, 66], 0.45));
      for (const w of weights) {
        g.fillStyle = rgb(shade(E, [44, 44, 50], 0.45));
        g.fillRect(w.x - w.s, w.y - w.s * 1.3, w.s * 0.6, w.s * 1.3);
        g.fillRect(w.x + w.s * 0.4, w.y - w.s * 1.3, w.s * 0.6, w.s * 1.3);
        g.fillRect(w.x - w.s, w.y - w.s * 0.8, w.s * 2, w.s * 0.25);
      }
      fill(g, mat, shade(E, [50, 54, 60], 0.42));
      fill(g, uprights, shade(E, [60, 60, 66], 0.45));
      fill(g, bench, shade(E, hue, 0.45));
      fill(g, bar, shade(E, [180, 182, 188], 0.55));
      fill(g, plates, shade(E, [36, 36, 42], 0.42));
      if (!d.old) ceilingLight(g, E, { ...d, grand: false }, F - 40 * u, H * 0.04, u);
    },
    floor,
    { floorHue: [120, 112, 104] },
  );
}

// ---------- Private rooms ----------

/** A bed seen side-on, for the smaller rooms. */
function sideBed(c: Ctx, x: number, w: number, floor: number) {
  const { H, u } = c;
  const frameP = new Path2D();
  frameP.rect(x, H * 0.46, 10 * u, floor - H * 0.46);
  frameP.rect(x + w - 8 * u, H * 0.6, 8 * u, floor - H * 0.6);
  frameP.rect(x, H * 0.7, w, 10 * u);
  const sheet = new Path2D();
  rr(sheet, x + 8 * u, H * 0.62, w - 12 * u, H * 0.1, 5 * u);
  const pillow = new Path2D();
  ellipse(pillow, x + 40 * u, H * 0.6, 28 * u, 9 * u);
  const cover = new Path2D();
  cover.moveTo(x + 64 * u, H * 0.6);
  cover.quadraticCurveTo(x + w * 0.6, H * 0.57, x + w - 4 * u, H * 0.6);
  cover.lineTo(x + w, H * 0.8);
  cover.lineTo(x + 60 * u, H * 0.8);
  cover.closePath();
  return (g: G, E: Env, hue: RGB) => {
    fill(g, frameP, shade(E, WOOD, 0.45));
    fill(g, sheet, shade(E, [232, 228, 222], 0.6));
    fill(g, pillow, shade(E, [244, 240, 236], 0.65));
    fill(g, cover, shade(E, hue, 0.45));
  };
}

function kidsroom(c: Ctx): Scene {
  const { H, u, F, r } = c;
  const d = dress(c);
  const floor = H * 0.82;
  const wall = mix(d.wall, pick(r, [[170, 206, 226], [240, 214, 150], [190, 220, 180]] as RGB[]), d.old ? 0.1 : 0.6);
  const { win, frame } = windowAt(F - 300 * u, H * 0.14, 90 * u, H * 0.36, u, d.old);
  const stripe = new Path2D();
  stripe.rect(0, H * 0.56, c.W, 10 * u);
  const bed = sideBed(c, F - 30 * u, 210 * u, floor);
  const shelfP = new Path2D();
  for (const y of [0.42, 0.6, 0.78]) shelfP.rect(F + 210 * u, H * y, 120 * u, 4 * u);
  shelfP.rect(F + 210 * u, H * 0.3, 4 * u, floor - H * 0.3);
  shelfP.rect(F + 326 * u, H * 0.3, 4 * u, floor - H * 0.3);
  const toys: { x: number; y: number; s: number; c: RGB; round: boolean }[] = [];
  for (const y of [0.42, 0.6, 0.78]) for (let x = F + 224 * u; x < F + 310 * u; x += (26 + r() * 10) * u) toys.push({ x, y: H * y, s: (11 + r() * 8) * u, c: pick(r, FABRIC), round: r() < 0.5 });
  const drawings: { x: number; y: number; c: RGB }[] = Array.from({ length: 5 }, (_, k) => ({ x: F - 170 * u + k * 26 * u, y: H * 0.2 + (k % 2) * 34 * u, c: pick(r, FABRIC) }));
  const rug = new Path2D();
  ellipse(rug, F - 130 * u, H * 0.91, 120 * u, 13 * u);
  const blocks: { x: number; c: RGB }[] = [-170, -146, -122].map((dx) => ({ x: F + dx * u, c: pick(r, FABRIC) }));
  const view = r() < 0.5 ? townView(c) : hillView(c);
  const hang = wallDressing(c, 0, F - 340 * u);
  return room(
    c,
    win,
    wall,
    view,
    (g, E) => {
      hang(g, E);
      skirting(g, E, c, floor);
      fill(g, stripe, shade(E, d.fab, 0.5), 0.6);
      fill(g, frame, shade(E, d.trim, 0.6));
      spill(g, E, F - 300 * u, F - 210 * u, H * 0.5, floor, 70 * u);
      for (const p of drawings) {
        g.fillStyle = rgb(shade(E, [240, 238, 230], 0.55));
        g.fillRect(p.x, p.y, 22 * u, 28 * u);
        g.fillStyle = rgb(shade(E, p.c, 0.6));
        g.beginPath();
        g.arc(p.x + 11 * u, p.y + 14 * u, 6 * u, 0, TAU);
        g.fill();
      }
      bed(g, E, d.fab);
      fill(g, shelfP, shade(E, WOOD, 0.45));
      for (const t of toys) {
        g.fillStyle = rgb(shade(E, t.c, 0.6));
        if (t.round) {
          g.beginPath();
          g.arc(t.x + t.s / 2, t.y - t.s / 2, t.s / 2, 0, TAU);
          g.fill();
        } else g.fillRect(t.x, t.y - t.s, t.s, t.s);
      }
      fill(g, rug, shade(E, mix(d.fab, [230, 220, 200], 0.5), 0.42));
      for (const b of blocks) {
        g.fillStyle = rgb(shade(E, b.c, 0.6));
        g.fillRect(b.x, floor + 8 * u, 20 * u, 20 * u);
      }
      if (d.old) candle(g, E, F - 56 * u, H * 0.72, u);
      else lamp(g, E, F - 56 * u, floor - 8 * u, 90 * u, 4, [255, 200, 140], 0.04);
    },
    floor,
    { floorHue: d.floorHue },
  );
}

function teenroom(c: Ctx): Scene {
  const { W, H, u, F, r } = c;
  const d = dress(c);
  const floor = H * 0.82;
  const wall = mix(d.wall, pick(r, [[70, 66, 96], [64, 90, 96], [120, 70, 90]] as RGB[]), 0.55);
  const { win, frame } = windowAt(F - 260 * u, H * 0.14, 86 * u, H * 0.34, u, false);
  const bed = sideBed(c, F + 40 * u, 220 * u, floor);
  // Unmade: a rumpled heap where the cover should be flat.
  const rumple = new Path2D();
  ellipse(rumple, F + 170 * u, H * 0.6, 70 * u, 18 * u);
  const posters: { x: number; y: number; w: number; h: number; c: RGB; k: RGB }[] = [];
  for (let x = F - 150 * u; x < F + 330 * u; x += (70 + r() * 30) * u) posters.push({ x, y: H * (0.12 + r() * 0.1), w: (46 + r() * 16) * u, h: (64 + r() * 20) * u, c: pick(r, FABRIC), k: pick(r, FABRIC) });
  // A string of fairy lights along the top of the wall.
  const bulbs: { x: number; y: number }[] = [];
  for (let x = 0; x < W; x += 26 * u) bulbs.push({ x, y: H * 0.07 + Math.abs(Math.sin((x - F) / (70 * u))) * 12 * u });
  const string = new Path2D();
  bulbs.forEach((b, i) => (i ? string.lineTo(b.x, b.y) : string.moveTo(b.x, b.y)));
  const desk = new Path2D();
  desk.rect(F - 180 * u, H * 0.62, 180 * u, 6 * u);
  for (const x of [F - 176 * u, F - 10 * u]) desk.rect(x, H * 0.62, 5 * u, floor - H * 0.62);
  const laptop = new Path2D();
  poly(laptop, F - 130 * u, H * 0.62, F - 56 * u, H * 0.62, F - 62 * u, H * 0.5, F - 124 * u, H * 0.5);
  const clothes: { x: number; rx: number; c: RGB }[] = [
    { x: F - 40 * u, rx: 38 * u, c: pick(r, FABRIC) },
    { x: F + 10 * u, rx: 26 * u, c: pick(r, FABRIC) },
    { x: F - 110 * u, rx: 30 * u, c: [70, 70, 80] },
  ];
  const view = townView(c);
  const hang = wallDressing(c, 0, F - 300 * u);
  return room(
    c,
    win,
    wall,
    view,
    (g, E) => {
      hang(g, E);
      skirting(g, E, c, floor);
      fill(g, frame, shade(E, d.trim, 0.55));
      for (const p of posters) {
        g.fillStyle = rgb(shade(E, mix(p.c, DARK, 0.25), 0.55));
        g.fillRect(p.x, p.y, p.w, p.h);
        g.fillStyle = rgb(shade(E, mix(p.k, [240, 230, 210], 0.4), 0.6));
        g.beginPath();
        g.arc(p.x + p.w / 2, p.y + p.h * 0.45, p.w * 0.27, 0, TAU);
        g.fill();
      }
      bed(g, E, d.fab);
      fill(g, rumple, shade(E, mix(d.fab, [255, 255, 255], 0.1), 0.45));
      fill(g, desk, shade(E, [150, 124, 96], 0.45));
      const on = after(E);
      fill(g, laptop, mix([20, 22, 30], [170, 200, 236], 0.25 + on * 0.6));
      glowAt(g, F - 92 * u, H * 0.54, 130 * u, [150, 190, 240], 0.3 * on);
      for (const k of clothes) {
        g.fillStyle = rgb(shade(E, k.c, 0.45));
        g.beginPath();
        g.ellipse(k.x, H * 0.9, k.rx, 8 * u, 0, 0, TAU);
        g.fill();
      }
      stroke(g, string, [30, 28, 30], 0.8 * u, 0.6);
      for (const b of bulbs) {
        g.fillStyle = rgb(mix([120, 110, 90], [255, 226, 160], Math.max(on, 0.25)));
        g.beginPath();
        g.arc(b.x, b.y + 2 * u, 2.4 * u, 0, TAU);
        g.fill();
        if (on > 0.2) glowAt(g, b.x, b.y + 2 * u, 16 * u, [255, 214, 140], 0.4 * on);
      }
    },
    floor,
    { floorHue: d.floorHue },
  );
}

function guestroom(c: Ctx): Scene {
  const { H, u, F, r } = c;
  const d = dress(c);
  const floor = H * 0.82;
  const { win, frame } = windowAt(F - 250 * u, H * 0.14, 96 * u, H * 0.4, u, d.old);
  const curt = new Path2D();
  drapes(curt, F - 250 * u, F - 154 * u, H * 0.14, H * 0.62, u);
  const bed = sideBed(c, F - 40 * u, 200 * u, floor);
  const stand = new Path2D();
  stand.rect(F + 200 * u, H * 0.66, 90 * u, 5 * u);
  for (const x of [F + 206 * u, F + 280 * u]) stand.rect(x, H * 0.66, 4 * u, floor - H * 0.66);
  const case_ = new Path2D();
  rr(case_, F + 208 * u, H * 0.5, 76 * u, H * 0.16, 7 * u);
  const handle = new Path2D();
  handle.rect(F + 236 * u, H * 0.47, 20 * u, 4 * u);
  // It's half a store room, really: boxes in the corner.
  const boxes: [number, number, number, number][] = [
    [F - 130 * u, floor - 56 * u, 74 * u, 58 * u],
    [F - 124 * u, floor - 94 * u, 54 * u, 40 * u],
  ];
  const towels = new Path2D();
  rr(towels, F + 120 * u, H * 0.56, 40 * u, 12 * u, 4 * u);
  const hue = mix(d.soft, [230, 226, 220], 0.45);
  const view = r() < 0.5 ? townView(c) : hillView(c);
  const hang = wallDressing(c, 0, F - 300 * u);
  return room(
    c,
    win,
    d.wall,
    view,
    (g, E) => {
      hang(g, E);
      skirting(g, E, c, floor);
      spill(g, E, F - 250 * u, F - 154 * u, H * 0.54, floor, 70 * u);
      fill(g, frame, shade(E, d.trim, 0.6));
      fill(g, curt, shade(E, mix(d.fab, [255, 255, 255], 0.55), 0.5));
      for (const [x, y, w, h] of boxes) {
        g.fillStyle = rgb(shade(E, [176, 140, 96], 0.45));
        g.fillRect(x, y, w, h);
        g.fillStyle = rgb(shade(E, [200, 176, 130], 0.45));
        g.fillRect(x + w / 2 - 4 * u, y, 8 * u, h * 0.3);
      }
      bed(g, E, hue);
      fill(g, towels, shade(E, [240, 238, 232], 0.6));
      fill(g, stand, shade(E, WOOD, 0.45));
      fill(g, case_, shade(E, mix(d.fab, [70, 60, 56], 0.6), 0.45));
      fill(g, handle, shade(E, [60, 54, 50], 0.45));
      ceilingLight(g, E, { ...d, grand: false }, F + 70 * u, H * 0.05, u);
    },
    floor,
    { floorHue: d.floorHue },
  );
}

function closet(c: Ctx): Scene {
  const { W, H, u, F, r } = c;
  const d = dress(c);
  const floor = H * 0.86;
  const rail = H * 0.18;
  // A long mirror in the middle; everything else is clothes.
  const mx = F - 60 * u;
  const mirror = new Path2D();
  rr(mirror, mx, H * 0.1, 120 * u, floor - H * 0.1, 6 * u);
  const rails = new Path2D();
  rails.rect(0, rail, mx - 16 * u, 4 * u);
  rails.rect(mx + 136 * u, rail, W, 4 * u);
  const shelfTop = new Path2D();
  shelfTop.rect(0, H * 0.1, W, 5 * u);
  const clothes: { x: number; w: number; l: number; c: RGB }[] = [];
  for (let x = 6 * u; x < W; ) {
    const w = (14 + r() * 18) * u;
    if (x + w < mx - 18 * u || x > mx + 138 * u) clothes.push({ x, w, l: H * (0.2 + r() * 0.3), c: pick(r, [...FABRIC, d.fab, d.soft, [60, 60, 66], [230, 226, 216]] as RGB[]) });
    x += w + 2 * u;
  }
  const hats: { x: number; c: RGB }[] = [];
  for (let x = 20 * u; x < W; x += (54 + r() * 50) * u) hats.push({ x, c: pick(r, [[176, 140, 96], [120, 90, 70], [70, 66, 72]] as RGB[]) });
  const shoes: { x: number; c: RGB }[] = [];
  for (let x = 10 * u; x < W; x += 30 * u) if (x < mx - 16 * u || x > mx + 134 * u) shoes.push({ x, c: pick(r, [[50, 40, 36], [150, 40, 44], [190, 170, 140], [30, 30, 36]] as RGB[]) });
  const pouf = new Path2D();
  rr(pouf, F + 170 * u, H * 0.76, 90 * u, floor - H * 0.76 + 6 * u, 18 * u);
  const hang = none;
  return room(
    c,
    shut(),
    mix(d.wall, [230, 224, 214], 0.4),
    hang,
    (g, E) => {
      const on = lampsOn(E, 0.6);
      fill(g, shelfTop, shade(E, mix(d.trim, WOOD, 0.3), 0.6));
      for (const k of hats) {
        g.fillStyle = rgb(shade(E, k.c, 0.6));
        g.fillRect(k.x, H * 0.06, 40 * u, H * 0.04);
      }
      fill(g, rails, shade(E, [190, 180, 150], 0.6));
      for (const k of clothes) {
        g.fillStyle = rgb(shade(E, k.c, 0.6));
        g.fillRect(k.x, rail + 3 * u, k.w, k.l);
      }
      for (const s of shoes) {
        g.fillStyle = rgb(shade(E, s.c, 0.6));
        g.fillRect(s.x, floor - 12 * u, 22 * u, 12 * u);
      }
      const mg = g.createLinearGradient(mx, H * 0.1, mx + 120 * u, floor);
      mg.addColorStop(0, rgb(shade(E, [190, 204, 214], 0.7)));
      mg.addColorStop(0.5, rgb(shade(E, [226, 234, 240], 0.7)));
      mg.addColorStop(1, rgb(shade(E, [170, 186, 196], 0.7)));
      g.fillStyle = mg;
      g.fill(mirror);
      stroke(g, mirror, shade(E, d.grand ? [176, 146, 90] : d.trim, 0.6), 4 * u);
      fill(g, pouf, shade(E, d.soft, 0.55));
      // Its own light, and no window at all.
      if (d.old) candle(g, E, F + 215 * u, H * 0.76, u);
      else {
        g.fillStyle = rgb([255, 248, 226]);
        g.fillRect(F - 140 * u, H * 0.02, 280 * u, 4 * u);
      }
      glowAt(g, F, H * 0.1, 420 * u, WARM, 0.32 * on);
    },
    floor,
    { lift: 0.62, space: true, floorHue: d.floorHue },
  );
}

function spabath(c: Ctx): Scene {
  const { H, u, F, r } = c;
  const d = dress(c);
  const floor = H * 0.84;
  const wx = F - 200 * u;
  const ww = 230 * u;
  const { win, frame } = windowAt(wx, H * 0.08, ww, H * 0.4, u, d.old);
  const tile = mix(d.wall, [244, 242, 238], 0.65);
  const lines = new Path2D();
  grid(lines, 0, H * 0.56, c.W, floor, 40 * u, 26 * u, true);
  // The tub stands free under the window.
  const tx = F - 196 * u;
  const tw = 222 * u;
  const ty = H * 0.6;
  const tub = new Path2D();
  tub.moveTo(tx, ty);
  tub.lineTo(tx + tw, ty);
  tub.bezierCurveTo(tx + tw, ty + 70 * u, tx + tw - 30 * u, ty + 74 * u, tx + tw - 46 * u, ty + 74 * u);
  tub.lineTo(tx + 46 * u, ty + 74 * u);
  tub.bezierCurveTo(tx + 30 * u, ty + 74 * u, tx, ty + 70 * u, tx, ty);
  tub.closePath();
  const rim = new Path2D();
  rr(rim, tx - 7 * u, ty - 5 * u, tw + 14 * u, 9 * u, 4 * u);
  const filler = new Path2D();
  filler.rect(tx + tw + 20 * u, ty - 50 * u, 4 * u, floor - ty + 50 * u);
  filler.moveTo(tx + tw + 22 * u, ty - 50 * u);
  filler.lineTo(tx + tw - 18 * u, ty - 44 * u);
  // Two sinks in a long vanity, a mirror over each.
  const vx = F + 120 * u;
  const vanity = new Path2D();
  vanity.rect(vx, H * 0.58, 230 * u, floor - H * 0.58);
  const top = new Path2D();
  top.rect(vx - 6 * u, H * 0.56, 242 * u, 7 * u);
  const doors = new Path2D();
  grid(doors, vx + 6 * u, H * 0.61, vx + 224 * u, floor - 4 * u, 54 * u, floor);
  const basins = new Path2D();
  const mirrors = new Path2D();
  for (const x of [vx + 58 * u, vx + 172 * u]) {
    ellipse(basins, x, H * 0.555, 34 * u, 5 * u);
    rr(mirrors, x - 38 * u, H * 0.14, 76 * u, H * 0.32, 30 * u);
  }
  const plant = new Path2D();
  leafy(plant, F - 260 * u, floor - 38 * u, 80 * u);
  const pot = new Path2D();
  poly(pot, F - 276 * u, floor - 40 * u, F - 244 * u, floor - 40 * u, F - 250 * u, floor, F - 270 * u, floor);
  const towel = new Path2D();
  rr(towel, tx + tw - 70 * u, ty - 2 * u, 34 * u, 56 * u, 3 * u);
  const view = r() < 0.5 ? hillView(c) : townView(c);
  const metal: RGB = d.grand ? [214, 176, 96] : [200, 200, 206];
  return room(
    c,
    win,
    tile,
    view,
    (g, E) => {
      if (!d.old) stroke(g, lines, shade(E, mix(tile, DARK, 0.3)), 0.8 * u, 0.5);
      fill(g, frame, shade(E, d.trim, 0.6));
      spill(g, E, wx, wx + ww, H * 0.48, floor, 40 * u);
      fill(g, mirrors, shade(E, [216, 226, 232], 0.65));
      stroke(g, mirrors, shade(E, metal, 0.55), 3 * u);
      fill(g, vanity, shade(E, d.old ? WOOD : mix(d.trim, WOOD, 0.35), 0.5));
      stroke(g, doors, [0, 0, 0], 1 * u, 0.25);
      fill(g, top, shade(E, [232, 228, 222], 0.6));
      fill(g, basins, shade(E, [250, 250, 246], 0.65));
      fill(g, pot, shade(E, [180, 110, 80], 0.5));
      fill(g, plant, shade(E, [70, 130, 74], 0.5));
      stroke(g, filler, shade(E, metal, 0.55), 3 * u);
      fill(g, tub, shade(E, d.old ? [176, 118, 78] : [248, 248, 244], 0.65));
      fill(g, rim, shade(E, d.old ? [196, 138, 96] : [254, 254, 252], 0.65));
      fill(g, towel, shade(E, d.fab, 0.5));
      steam(g, E, tx + tw / 2, ty - 8 * u, u, 7, 30, 0.06 + E.night * 0.05);
      candle(g, E, tx + 16 * u, ty - 5 * u, u);
      candle(g, E, tx + 30 * u, ty - 5 * u, u);
    },
    floor,
    { floorHue: mix(d.floorHue, [190, 186, 180], 0.55) },
  );
}

// ---------- Between and working rooms ----------

function mudroom(c: Ctx): Scene {
  const { H, u, F, r } = c;
  const d = dress(c);
  const floor = H * 0.84;
  // The back door: its glass shows what you're coming in from.
  const dx = F - 300 * u;
  const dw = 100 * u;
  const glass = new Path2D();
  rr(glass, dx + 16 * u, H * 0.2, dw - 32 * u, H * 0.26, 3 * u);
  const door = new Path2D();
  door.rect(dx, H * 0.14, dw, floor - H * 0.14);
  const jamb = new Path2D();
  jamb.rect(dx - 8 * u, H * 0.12, dw + 16 * u, 8 * u);
  jamb.rect(dx - 8 * u, H * 0.14, 8 * u, floor - H * 0.14);
  jamb.rect(dx + dw, H * 0.14, 8 * u, floor - H * 0.14);
  // Cubbies and a bench, the length of the wall.
  const cx = F - 150 * u;
  const cw = 420 * u;
  const cubbies = new Path2D();
  cubbies.rect(cx, H * 0.1, cw, 6 * u);
  cubbies.rect(cx, H * 0.26, cw, 5 * u);
  for (let x = cx; x <= cx + cw + 1; x += cw / 4) cubbies.rect(x - 3 * u, H * 0.1, 6 * u, floor - H * 0.1);
  const benchTop = new Path2D();
  benchTop.rect(cx, H * 0.66, cw, 9 * u);
  const baskets: { x: number; c: RGB }[] = [0, 1, 2, 3].map((k) => ({ x: cx + 16 * u + (k * cw) / 4, c: pick(r, [[190, 160, 110], [150, 120, 90]] as RGB[]) }));
  const coats: { x: number; l: number; c: RGB }[] = [];
  for (let x = cx + 28 * u; x < cx + cw - 20 * u; x += (46 + r() * 26) * u) coats.push({ x, l: (70 + r() * 30) * u, c: pick(r, [d.fab, d.soft, [70, 66, 72], [120, 100, 70]] as RGB[]) });
  const boots: { x: number; c: RGB }[] = [];
  for (let x = cx + 14 * u; x < cx + cw - 30 * u; x += (40 + r() * 34) * u) boots.push({ x, c: pick(r, [[50, 40, 36], [60, 90, 70], [120, 40, 40]] as RGB[]) });
  const view = r() < 0.6 ? hillView(c) : townView(c);
  const hang = wallDressing(c, 0, dx - 40 * u);
  return room(
    c,
    glass,
    mix(d.wall, [200, 196, 186], 0.3),
    view,
    (g, E) => {
      hang(g, E);
      skirting(g, E, c, floor);
      const hole = new Path2D();
      hole.addPath(door);
      hole.addPath(glass);
      g.fillStyle = rgb(shade(E, d.old ? WOOD : mix(d.fab, d.trim, 0.3), 0.5));
      g.fill(hole, "evenodd");
      fill(g, jamb, shade(E, d.trim, 0.55));
      fill(g, cubbies, shade(E, d.old ? WOOD : d.trim, 0.5));
      for (const k of coats) {
        g.fillStyle = rgb(shade(E, k.c, 0.45));
        g.beginPath();
        g.moveTo(k.x - 8 * u, H * 0.3);
        g.lineTo(k.x + 8 * u, H * 0.3);
        g.lineTo(k.x + 15 * u, H * 0.3 + k.l);
        g.lineTo(k.x - 15 * u, H * 0.3 + k.l);
        g.fill();
      }
      fill(g, benchTop, shade(E, WOOD, 0.55));
      for (const b of baskets) {
        g.fillStyle = rgb(shade(E, b.c, 0.5));
        g.fillRect(b.x, H * 0.7, 72 * u, 36 * u);
      }
      // Boots, and a wet floor under them when it's coming down outside.
      if (E.c.rain > 0.2 || E.c.snow > 0.2) {
        g.fillStyle = rgb([200, 220, 240], 0.22);
        g.beginPath();
        g.ellipse(cx + cw / 2, H * 0.92, cw * 0.5, 9 * u, 0, 0, TAU);
        g.fill();
      }
      for (const b of boots) {
        g.fillStyle = rgb(shade(E, b.c, 0.5));
        g.fillRect(b.x, H * 0.84, 15 * u, 28 * u);
        g.fillRect(b.x, H * 0.84 + 20 * u, 24 * u, 8 * u);
      }
      if (d.old) candle(g, E, cx + 40 * u, H * 0.66, u);
      else ceilingLight(g, E, { ...d, grand: false }, F + 40 * u, H * 0.03, u);
    },
    floor,
    { floorHue: [120, 112, 104] },
  );
}

function pantry(c: Ctx): Scene {
  const { W, H, u, F, r } = c;
  const d = dress(c);
  const floor = H * 0.86;
  const { win, frame } = windowAt(F - 40 * u, H * 0.05, 66 * u, 44 * u, u, false);
  const rows = [0.3, 0.46, 0.62, 0.78];
  const shelves = new Path2D();
  for (const y of rows) shelves.rect(0, H * y, W, 5 * u);
  for (let x = F % (170 * u); x < W; x += 170 * u) shelves.rect(x, H * 0.22, 6 * u, floor - H * 0.22);
  const stock: { x: number; y: number; w: number; h: number; c: RGB; jar: boolean; lid: RGB }[] = [];
  for (const y of rows)
    for (let x = 8 * u; x < W; ) {
      const w = (14 + r() * 16) * u;
      if (r() < 0.84)
        stock.push({
          x,
          y: H * y,
          w,
          h: (22 + r() * 18) * u,
          c: pick(r, [[176, 60, 50], [210, 150, 60], [90, 130, 70], [190, 180, 150], [150, 80, 110], [90, 110, 150]] as RGB[]),
          jar: r() < 0.5,
          lid: pick(r, [[190, 180, 150], [60, 54, 50]] as RGB[]),
        });
      x += w + (3 + r() * 6) * u;
    }
  const sack = new Path2D();
  rr(sack, F + 140 * u, floor - 74 * u, 80 * u, 78 * u, 20 * u);
  const sack2 = new Path2D();
  rr(sack2, F + 230 * u, floor - 52 * u, 64 * u, 56 * u, 16 * u);
  const bulbX = F - 150 * u;
  const cord = new Path2D();
  cord.moveTo(bulbX + 10 * u, 0);
  cord.lineTo(bulbX + 10 * u, H * 0.2);
  return room(
    c,
    win,
    mix(d.wall, [208, 196, 170], 0.5),
    hillView(c),
    (g, E) => {
      fill(g, frame, shade(E, d.trim, 0.55));
      for (const k of stock) {
        const col = shade(E, k.c, 0.5);
        if (k.jar) {
          g.fillStyle = rgb(col, 0.82);
          g.fillRect(k.x, k.y - k.h, k.w, k.h);
          g.fillStyle = rgb(shade(E, k.lid, 0.5));
          g.fillRect(k.x + 1.5 * u, k.y - k.h - 4 * u, k.w - 3 * u, 4 * u);
          g.fillStyle = rgb([255, 255, 255], 0.14);
          g.fillRect(k.x + 2 * u, k.y - k.h + 2 * u, 2 * u, k.h - 4 * u);
        } else {
          g.fillStyle = rgb(col);
          g.fillRect(k.x, k.y - k.h, k.w, k.h);
          g.fillStyle = rgb(shade(E, [236, 230, 214], 0.5));
          g.fillRect(k.x, k.y - k.h * 0.68, k.w, k.h * 0.34);
        }
      }
      fill(g, shelves, shade(E, WOOD, 0.45));
      fill(g, sack, shade(E, [186, 164, 124], 0.45));
      fill(g, sack2, shade(E, [170, 146, 110], 0.45));
      stroke(g, cord, [30, 26, 24], 0.8 * u);
      if (d.old) candle(g, E, bulbX, H * 0.46, u);
      else {
        g.strokeStyle = "rgb(24,20,18)";
        g.lineWidth = 1 * u;
        g.beginPath();
        g.moveTo(bulbX, 0);
        g.lineTo(bulbX, H * 0.12);
        g.stroke();
        lamp(g, E, bulbX, H * 0.14, 90 * u, 3, WARM, 0.7);
        glowAt(g, bulbX, H * 0.2, 280 * u, WARM, 0.28);
      }
    },
    floor,
    { lift: 0.28, floorHue: d.floorHue },
  );
}

// ---------- Whole homes ----------

function studioapt(c: Ctx): Scene {
  const { H, u, F, r } = c;
  const d = dress(c);
  const floor = H * 0.82;
  const { win, frame } = windowAt(F - 60 * u, H * 0.1, 170 * u, H * 0.44, u, false);
  // One room: the bed on the left, the sofa under the window, the kitchenette on the right.
  const bed = sideBed(c, F - 390 * u, 210 * u, floor);
  const sofa = new Path2D();
  rr(sofa, F - 90 * u, H * 0.56, 220 * u, floor - H * 0.56, 12 * u);
  const cush = new Path2D();
  for (const dx of [-80, 26]) rr(cush, F + dx * u, H * 0.65, 94 * u, 28 * u, 8 * u);
  const kx = F + 170 * u;
  const counter = new Path2D();
  counter.rect(kx, H * 0.58, 180 * u, 6 * u);
  const base = new Path2D();
  base.rect(kx, H * 0.58 + 6 * u, 180 * u, floor - H * 0.58 - 6 * u);
  const doors = new Path2D();
  grid(doors, kx, H * 0.62, kx + 180 * u, floor, 60 * u, floor);
  const shelf = new Path2D();
  shelf.rect(kx, H * 0.34, 180 * u, 4 * u);
  const crocks: { x: number; h: number; c: RGB }[] = [];
  for (let x = kx + 10 * u; x < kx + 170 * u; x += (22 + r() * 16) * u) crocks.push({ x, h: (14 + r() * 18) * u, c: pick(r, [[232, 228, 222], [170, 60, 50], [90, 130, 150]] as RGB[]) });
  const ring = new Path2D();
  ellipse(ring, kx + 40 * u, H * 0.575, 26 * u, 3 * u);
  const radiator = new Path2D();
  for (let k = 0; k < 8; k++) radiator.rect(F - 170 * u + k * 12 * u, floor - 44 * u, 8 * u, 40 * u);
  const clothesRail = new Path2D();
  clothesRail.rect(F - 490 * u, H * 0.24, 90 * u, 3 * u);
  const view = cityView(c);
  const hang = wallDressing(c, 0, F - 500 * u);
  return room(
    c,
    win,
    d.wall,
    view,
    (g, E) => {
      hang(g, E);
      skirting(g, E, c, floor);
      fill(g, frame, shade(E, d.trim, 0.55));
      spill(g, E, F - 60 * u, F + 110 * u, H * 0.54, floor, 60 * u);
      fill(g, radiator, shade(E, [226, 222, 214], 0.45));
      bed(g, E, d.fab);
      fill(g, sofa, shade(E, d.soft, 0.42));
      fill(g, cush, shade(E, mix(d.soft, [255, 255, 255], 0.1), 0.46));
      fill(g, shelf, shade(E, WOOD, 0.45));
      for (const k of crocks) {
        g.fillStyle = rgb(shade(E, k.c, 0.5));
        g.fillRect(k.x, H * 0.34 - k.h, 15 * u, k.h);
      }
      fill(g, base, shade(E, mix(d.trim, WOOD, 0.25), 0.45));
      stroke(g, doors, [0, 0, 0], 1 * u, 0.25);
      fill(g, counter, shade(E, [150, 146, 140], 0.5));
      fill(g, ring, [24, 22, 24]);
      // A reading light on the wall over the bed.
      g.fillStyle = rgb(shade(E, [60, 54, 50]));
      g.fillRect(F - 390 * u, H * 0.34, 34 * u, 3 * u);
      lamp(g, E, F - 358 * u, H * 0.36, 130 * u, 9, WARM, 0.05);
    },
    floor,
    { floorHue: d.floorHue },
  );
}

function penthouse(c: Ctx): Scene {
  const { W, H, u, F, r } = c;
  const d = dress(c);
  const floor = H * 0.72;
  // The whole far wall is glass, and the city's on the other side of it.
  const win = new Path2D();
  win.rect(0, H * 0.05, W, floor - H * 0.05);
  const frame = new Path2D();
  for (let x = F % (160 * u); x < W; x += 160 * u) frame.rect(x - 2 * u, H * 0.05, 4 * u, floor - H * 0.05);
  frame.rect(0, H * 0.05 - 4 * u, W, 8 * u);
  frame.rect(0, floor - 4 * u, W, 6 * u);
  const ceiling = new Path2D();
  ceiling.rect(0, 0, W, H * 0.05);
  // Down two steps into the lounge.
  const step = new Path2D();
  step.rect(0, H * 0.78, W, 3 * u);
  step.rect(0, H * 0.84, W, 3 * u);
  const sofa = new Path2D();
  rr(sofa, F - 240 * u, H * 0.62, 330 * u, H * 0.3, 12 * u);
  rr(sofa, F + 96 * u, H * 0.72, 160 * u, H * 0.26, 12 * u);
  const cush = new Path2D();
  for (let x = F - 226 * u; x < F + 60 * u; x += 96 * u) rr(cush, x, H * 0.58, 86 * u, 34 * u, 9 * u);
  const table = new Path2D();
  rr(table, F + 270 * u, H * 0.8, 140 * u, 7 * u, 3 * u);
  for (const x of [F + 284 * u, F + 390 * u]) table.rect(x, H * 0.8, 5 * u, H * 0.14);
  const pendants = [F - 160 * u, F - 80 * u, F, F + 80 * u].map((x, i) => ({ x, drop: H * (0.12 + (i % 2) * 0.08) }));
  const plant = new Path2D();
  leafy(plant, F - 340 * u, H * 0.76, 120 * u);
  const pot = new Path2D();
  poly(pot, F - 368 * u, H * 0.76, F - 312 * u, H * 0.76, F - 322 * u, H * 0.88, F - 358 * u, H * 0.88);
  const view = cityView(c);
  void r;
  return room(
    c,
    win,
    d.wall,
    view,
    (g, E) => {
      fill(g, ceiling, shade(E, [226, 222, 216], 0.4));
      fill(g, frame, shade(E, [40, 40, 46], 0.4));
      spill(g, E, F - 400 * u, F + 240 * u, floor, H, 70 * u);
      fill(g, step, [0, 0, 0], 0.3);
      fill(g, pot, shade(E, [226, 224, 220], 0.5));
      fill(g, plant, shade(E, [62, 118, 70], 0.5));
      fill(g, cush, shade(E, mix(d.soft, [255, 255, 255], 0.1), 0.48));
      fill(g, sofa, shade(E, d.soft, 0.44));
      fill(g, table, shade(E, [40, 38, 42], 0.45));
      for (const p of pendants) {
        g.fillStyle = "rgb(24,22,24)";
        g.fillRect(p.x - 0.5 * u, 0, 1 * u, p.drop);
        lamp(g, E, p.x, p.drop + 3 * u, 80 * u, p.x, WARM, 0.08);
      }
    },
    floor,
    { floorHue: mix(d.floorHue, [60, 54, 52], 0.5) },
  );
}

function loft(c: Ctx): Scene {
  const { W, H, u, F, r } = c;
  const d = dress(c);
  const floor = H * 0.84;
  // Tall steel windows, a brick wall, the building's own bones overhead.
  const win = new Path2D();
  const frame = new Path2D();
  const ws = [F - 330 * u, F - 170 * u, F - 10 * u];
  for (const x of ws) {
    win.rect(x, H * 0.14, 124 * u, H * 0.6);
    panes(frame, x, H * 0.14, 124 * u, H * 0.6, 4, 6, 1.8 * u);
  }
  const bricks = new Path2D();
  grid(bricks, 0, H * 0.08, W, floor, 30 * u, 13 * u, true);
  const beams = new Path2D();
  beams.rect(0, 0, W, H * 0.07);
  for (let x = F % (250 * u); x < W; x += 250 * u) beams.rect(x, H * 0.07, 16 * u, floor - H * 0.07);
  const duct = new Path2D();
  rr(duct, 0, H * 0.075, W, 16 * u, 8 * u);
  const sofa = new Path2D();
  rr(sofa, F + 90 * u, H * 0.56, 220 * u, floor - H * 0.56, 12 * u);
  const cush = new Path2D();
  for (const dx of [100, 200]) rr(cush, F + dx * u, H * 0.64, 90 * u, 26 * u, 8 * u);
  const rug = new Path2D();
  poly(rug, F - 60 * u, H * 0.88, F + 390 * u, H * 0.88, F + 440 * u, H * 0.99, F - 110 * u, H * 0.99);
  const table = new Path2D();
  table.rect(F - 30 * u, H * 0.76, 100 * u, 5 * u);
  for (const x of [F - 24 * u, F + 60 * u]) table.rect(x, H * 0.76, 4 * u, H * 0.12);
  const plant = new Path2D();
  leafy(plant, F - 390 * u, floor - 40 * u, 120 * u);
  const pot = new Path2D();
  poly(pot, F - 412 * u, floor - 42 * u, F - 368 * u, floor - 42 * u, F - 376 * u, floor, F - 404 * u, floor);
  const canvas = new Path2D();
  canvas.rect(F + 180 * u, H * 0.15, 120 * u, 96 * u);
  const art = pick(r, FABRIC);
  const stand = floorLamp(c, F + 322 * u, floor);
  const view = cityView(c);
  return room(
    c,
    win,
    mix([150, 86, 66], d.wall, 0.12),
    view,
    (g, E) => {
      stroke(g, bricks, [30, 18, 16], 0.9 * u, 0.4);
      fill(g, frame, shade(E, [36, 36, 40], 0.3));
      for (const x of ws) spill(g, E, x, x + 124 * u, H * 0.74, floor, 60 * u);
      fill(g, beams, shade(E, WOOD, 0.4));
      fill(g, duct, shade(E, [170, 172, 176], 0.45));
      fill(g, canvas, shade(E, mix(art, [230, 220, 200], 0.3), 0.5));
      fill(g, rug, shade(E, mix(d.fab, [150, 130, 110], 0.5), 0.42));
      fill(g, pot, shade(E, [90, 84, 80], 0.45));
      fill(g, plant, shade(E, [62, 118, 70], 0.5));
      fill(g, sofa, shade(E, d.soft, 0.42));
      fill(g, cush, shade(E, mix(d.soft, [255, 255, 255], 0.1), 0.46));
      fill(g, table, shade(E, WOOD, 0.5));
      stand(g, E);
    },
    floor,
    { floorHue: d.floorHue },
  );
}

// ---------- At the door ----------

function balcony(c: Ctx): Scene {
  const { W, H, u, F, r } = c;
  const d = dress(c);
  const floor = H * 0.8;
  const edge = F - 310 * u;
  // Open air from the wall outwards: the view is the point of the place.
  const win = new Path2D();
  win.rect(edge, 0, W - edge, floor);
  const wall = new Path2D();
  wall.rect(0, 0, edge, floor);
  const dx = edge - 130 * u;
  const door = new Path2D();
  door.rect(dx, H * 0.1, 100 * u, floor - H * 0.1);
  const divider = new Path2D();
  divider.rect(dx + 48 * u, H * 0.1, 4 * u, floor - H * 0.1);
  const rail = new Path2D();
  rail.rect(edge, H * 0.5, W - edge, 7 * u);
  rail.rect(edge, floor - 8 * u, W - edge, 4 * u);
  for (let x = edge; x < W; x += 16 * u) rail.rect(x, H * 0.5, 2.6 * u, floor - H * 0.5);
  const chair = (x: number) => {
    const p = new Path2D();
    rr(p, x - 30 * u, H * 0.56, 60 * u, 44 * u, 8 * u);
    p.rect(x - 34 * u, H * 0.72, 68 * u, 7 * u);
    p.rect(x - 30 * u, H * 0.72, 4 * u, H * 0.2);
    p.rect(x + 26 * u, H * 0.72, 4 * u, H * 0.2);
    return p;
  };
  const chairs = [chair(F - 170 * u), chair(F + 60 * u)];
  const table = new Path2D();
  ellipse(table, F - 55 * u, H * 0.74, 44 * u, 6 * u);
  table.rect(F - 57 * u, H * 0.74, 4 * u, H * 0.18);
  const cup = new Path2D();
  rr(cup, F - 66 * u, H * 0.74 - 12 * u, 10 * u, 11 * u, 2 * u);
  const planter = new Path2D();
  planter.rect(F + 170 * u, H * 0.42, 150 * u, 22 * u);
  const leaves = new Path2D();
  for (let x = F + 186 * u; x < F + 310 * u; x += 32 * u) leafy(leaves, x, H * 0.43, 34 * u);
  const useCity = d.grand || d.plain || r() < 0.4;
  const view = useCity ? cityView(c) : townView(c);
  return room(
    c,
    win,
    d.wall,
    view,
    (g, E) => {
      fill(g, wall, shade(E, d.wall, 0.5));
      const on = after(E);
      fill(g, door, mix(shade(E, [60, 70, 84], 0.45), [255, 214, 150], 0.7 * on));
      stroke(g, door, shade(E, d.trim, 0.55), 5 * u);
      fill(g, divider, shade(E, d.trim, 0.55));
      fill(g, rail, shade(E, d.old ? [50, 44, 42] : [60, 60, 66], 0.42));
      fill(g, planter, shade(E, [150, 96, 70], 0.45));
      fill(g, leaves, shade(E, [70, 130, 74], 0.5));
      for (const p of chairs) fill(g, p, shade(E, d.old ? WOOD : mix(d.soft, [190, 186, 180], 0.3), 0.5));
      fill(g, table, shade(E, d.old ? WOOD : [200, 198, 194], 0.5));
      fill(g, cup, shade(E, [232, 228, 222], 0.6));
      if (on > 0.2) glowAt(g, dx + 50 * u, H * 0.5, 170 * u, WARM, 0.3 * on);
    },
    floor,
    { floorHue: mix(d.floorHue, [170, 166, 160], 0.5) },
  );
}

export const MORE_HOMES = {
  parlor,
  nook,
  sunroom,
  greatroom,
  gameroom,
  homebar,
  recroom,
  musicroom,
  homegym,
  kidsroom,
  teenroom,
  guestroom,
  closet,
  spabath,
  mudroom,
  pantry,
  studioapt,
  penthouse,
  loft,
  balcony,
} satisfies Partial<Record<Place, (c: Ctx) => Scene>>;
