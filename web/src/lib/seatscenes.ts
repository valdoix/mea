/**
 * The rooms only one castle has, and how its castles look from outside (docs/25-rooms-of-the-keep.md
 * Part 6): the Red Keep's throne room, ballroom, Round Room, holdfast and dragon skulls; Harrenhal's
 * Hall of a Hundred Hearths, melted towers, Flowstone Yard, bear pit and ruined sept.
 */
import { clamp, DARK, mix, rgb, TAU, WARM, type Ctx, type Env, type Place, type RGB } from "./places";
import { banner, candle, keepLook, keepRoom, opening, outsideOf, reveal, shaft, shell, tint, torch, torchlight, tracery, type Look, type Paint } from "./keepbits";
import { fill, fire, glowAt, GRASS, haze, hillView, lit as sunlit, poly, ridge, ROCK, stroke, tone, type Scene } from "./scenes";
import { ellipse, rr, shut } from "./scenebits";

type G = CanvasRenderingContext2D;
const IRON: RGB = [52, 50, 56];
/** Stone in the open: the sun by day, and at night still its own colour under the moon and the torches. */
const lit = (E: Env, t: number, hue: RGB, amt?: number) => mix(sunlit(E, t, hue, amt), tint(E, hue, 0.3), E.night * 0.72);

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

/** A long black dragon's skull, side on, snout to the left or right. */
function dragonSkull(c: Ctx, x: number, y: number, s: number, flip: number) {
  const { u, r } = c;
  const k = s * u * flip;
  const v = s * u;
  const p = new Path2D();
  p.moveTo(x + 104 * k, y + 8 * v);
  p.quadraticCurveTo(x + 112 * k, y - 34 * v, x + 66 * k, y - 50 * v);
  p.quadraticCurveTo(x + 18 * k, y - 66 * v, x - 40 * k, y - 26 * v);
  p.quadraticCurveTo(x - 86 * k, y - 18 * v, x - 124 * k, y - 8 * v);
  p.lineTo(x - 132 * k, y + 8 * v);
  p.quadraticCurveTo(x - 60 * k, y + 2 * v, x + 22 * k, y + 8 * v);
  p.closePath();
  const jaw = new Path2D();
  jaw.moveTo(x + 76 * k, y + 8 * v);
  jaw.quadraticCurveTo(x + 70 * k, y + 42 * v, x + 28 * k, y + 42 * v);
  jaw.quadraticCurveTo(x - 50 * k, y + 42 * v, x - 112 * k, y + 28 * v);
  jaw.lineTo(x - 114 * k, y + 20 * v);
  jaw.quadraticCurveTo(x - 40 * k, y + 28 * v, x + 22 * k, y + 22 * v);
  jaw.closePath();
  const teeth = new Path2D();
  for (let d = -118; d < 20; d += 11 + r() * 5) {
    const t = (d + 118) / 138;
    const len = (10 + r() * 15) * (1 - t * 0.35);
    poly(teeth, x + d * k, y + 7 * v, x + (d + 7) * k, y + 7 * v, x + (d + 3) * k, y + (7 + len) * v);
    poly(teeth, x + d * k, y + (28 - t * 2) * v, x + (d + 6) * k, y + (28 - t * 2) * v, x + (d + 3) * k, y + (28 - t * 2 - len * 0.6) * v);
  }
  const eye = new Path2D();
  ellipse(eye, x + 34 * k, y - 22 * v, 14 * v, 10 * v);
  const nose = new Path2D();
  ellipse(nose, x - 104 * k, y - 4 * v, 6 * v, 3 * v);
  return (g: G, E: Env) => {
    const bone = tint(E, [46, 42, 46], 0.3);
    fill(g, jaw, bone);
    fill(g, teeth, tint(E, [120, 112, 100], 0.38));
    fill(g, p, bone);
    stroke(g, p, tint(E, [112, 104, 96], 0.36), 1.3 * u, 0.5);
    fill(g, eye, [6, 4, 8]);
    fill(g, nose, [6, 4, 8]);
    // A line of torchlight along the snout.
    g.strokeStyle = rgb(WARM, 0.2 * torchlight(E));
    g.lineWidth = 1.6 * u;
    g.beginPath();
    g.moveTo(x - 118 * k, y - 8 * v);
    g.quadraticCurveTo(x - 60 * k, y - 17 * v, x - 30 * k, y - 26 * v);
    g.stroke();
  };
}

// ---------- The Red Keep ----------

/** The Iron Throne: a heap of blades on steep iron steps, or at another castle a high carved seat. */
function throneroom(c: Ctx): Scene {
  const { W, H, u, F, r } = c;
  const L = keepLook(c);
  const floor = H * 0.86;
  const iron = L.masonry === "redstone";
  const winXs: number[] = [];
  for (let x = F - 285 * u; x > -60 * u; x -= 190 * u) winXs.push(x);
  if (W > F + 240 * u) winXs.push(F + 285 * u);
  const S = shell(c, L, { floor, spring: 0.1, busy: [[-W, W * 2]] });
  const glass = windows(c, L, winXs, H * 0.14, H * 0.66, 62 * u);
  const steps = new Path2D();
  const n = iron ? 7 : 3;
  for (let k = 0; k < n; k++) steps.rect(F - (150 - k * 17) * u, floor - (k + 1) * 11 * u, (300 - k * 34) * u, 11 * u);
  const sy = floor - n * 11 * u;
  const blades = new Path2D();
  const edges = new Path2D();
  const seat = new Path2D();
  if (iron) {
    // Hundreds of swords, fanned and jagged: dense at the seat, wild at the crown.
    for (let i = 0; i < 90; i++) {
      const t = i / 90;
      const a = -Math.PI / 2 + (r() - 0.5) * (1.1 + (1 - t) * 1.5);
      const len = (58 + r() * (t * 128 + 40)) * u;
      const bx = F + (r() - 0.5) * 74 * u;
      const by = sy - 12 * u - r() * 56 * u;
      const tipx = bx + Math.cos(a) * len;
      const tipy = by + Math.sin(a) * len;
      const nx = -Math.sin(a) * 2.7 * u;
      const ny = Math.cos(a) * 2.7 * u;
      poly(blades, bx + nx, by + ny, tipx, tipy, bx - nx, by - ny);
      edges.moveTo(bx + nx, by + ny);
      edges.lineTo(tipx, tipy);
    }
    rr(seat, F - 30 * u, sy - 66 * u, 60 * u, 68 * u, 3 * u);
    seat.rect(F - 40 * u, sy - 26 * u, 80 * u, 9 * u);
  } else {
    seat.moveTo(F - 24 * u, sy);
    seat.lineTo(F - 24 * u, sy - 104 * u);
    seat.quadraticCurveTo(F, sy - 150 * u, F + 24 * u, sy - 104 * u);
    seat.lineTo(F + 24 * u, sy);
    seat.closePath();
    seat.rect(F - 36 * u, sy - 40 * u, 72 * u, 8 * u);
  }
  // A long carpet of light down the middle of the floor.
  const walk = new Path2D();
  poly(walk, F - 60 * u, floor, F + 60 * u, floor, F + 140 * u, H + 2, F - 190 * u, H + 2);
  const year = c.home?.keep?.year ?? 298;
  const skulls = iron && year < 283 ? [F - 475, F - 855, F + 475].filter((x) => x * u > -300 * u).map((x, i) => dragonSkull(c, F + (x - F) * u, H * 0.32, 0.5, i % 2 ? 1 : -1)) : [];
  return keepRoom(
    c,
    L,
    glass.win,
    hillView(c),
    (g, E) => {
      S.under(g, E);
      glass.paint(g, E);
      for (const x of winXs) shaft(g, E, x - 31 * u, x + 31 * u, H * 0.66, H, 120 * u, [255, 226, 186]);
      for (const sk of skulls) sk(g, E);
      for (const d of [-214, 214]) banner(g, E, L, F + d * u, H * 0.13, 58 * u, H * 0.46, u, d > 0);
      fill(g, walk, tint(E, iron ? L.cloth : L.floor, 0.3), 0.75);
      fill(g, steps, tint(E, iron ? [64, 58, 62] : mix(L.floor, L.wall, 0.5), 0.3));
      if (iron) {
        glowAt(g, F, sy - 60 * u, 180 * u, WARM, 0.18 * torchlight(E));
        fill(g, blades, tint(E, IRON, 0.32));
        stroke(g, edges, tint(E, [168, 168, 180], 0.4), 0.8 * u, 0.7);
        fill(g, seat, [24, 22, 28]);
      } else {
        fill(g, seat, tint(E, mix(L.wood, L.cloth, 0.2), 0.36));
        stroke(g, seat, tint(E, L.cloth2, 0.4), 2 * u, 0.85);
      }
      S.over(g, E);
      for (const s of [-1, 1]) torch(g, E, F + s * 150 * u, H * 0.4, u, 1.2);
    },
    floor,
  );
}

/** The Queen's Ballroom: a bare polished floor, hammered bronze mirrors behind the sconces, a gallery above. */
function ballroom(c: Ctx): Scene {
  const { W, H, u, F } = c;
  const L = keepLook(c);
  const floor = H * 0.74;
  const S = shell(c, L, { floor, spring: 0.1, torches: false, busy: [[-W, W * 2]] });
  const bay = 190 * u;
  const mids: number[] = [];
  for (let k = -9; k < 9; k++) {
    const x = F + (k + 0.5) * bay;
    if (x > -bay && x < W + bay) mids.push(x);
  }
  const gallery = new Path2D();
  gallery.rect(-4, H * 0.3, W + 8, 8 * u);
  for (let x = F % (22 * u); x < W; x += 22 * u) gallery.rect(x, H * 0.33, 3.4 * u, 25 * u);
  gallery.rect(-4, H * 0.33 + 25 * u, W + 8, 5 * u);
  const dark = new Path2D();
  dark.rect(-4, 0, W + 8, H * 0.3);
  return keepRoom(
    c,
    L,
    shut(),
    () => {},
    (g, E) => {
      S.under(g, E);
      g.fillStyle = rgb(DARK, 0.3);
      g.fill(dark);
      const on = torchlight(E);
      for (const x of mids) {
        const y = H * 0.54;
        const lg = g.createRadialGradient(x - 8 * u, y - 16 * u, 2, x, y, 58 * u);
        lg.addColorStop(0, rgb(mix([214, 164, 96], [255, 226, 160], on)));
        lg.addColorStop(1, rgb(tint(E, [118, 76, 36], 0.42)));
        g.fillStyle = lg;
        g.beginPath();
        g.ellipse(x, y, 40 * u, 54 * u, 0, 0, TAU);
        g.fill();
        g.strokeStyle = rgb(tint(E, [84, 54, 28], 0.34));
        g.lineWidth = 4 * u;
        g.stroke();
        for (const s of [-1, 1]) torch(g, E, x + s * 62 * u, H * 0.5, u, 0.8);
        glowAt(g, x, y, 92 * u, WARM, 0.26 * on);
        // Its light again, in the polished floor.
        const rg = g.createLinearGradient(0, floor, 0, H);
        rg.addColorStop(0, rgb(WARM, 0.13 * on + 0.03));
        rg.addColorStop(1, rgb(WARM, 0));
        g.fillStyle = rg;
        g.fillRect(x - 40 * u, floor, 80 * u, H - floor);
      }
      fill(g, gallery, tint(E, L.wood, 0.34));
      S.over(g, E);
    },
    floor,
  );
}

/** The Round Room of the White Sword Tower: curved white walls, a round table with a white shield, a great book. */
function roundroom(c: Ctx): Scene {
  const { W, H, u, F, r } = c;
  const floor = H * 0.78;
  const L = keepLook(c);
  const white: RGB = [226, 224, 216];
  const panes: { x: number; w: number; d: number }[] = [];
  // Courses that narrow and darken as the wall curves away from the middle.
  for (let t = -1; t < 1; t += 0.052) {
    const x = F + Math.sin((t * Math.PI) / 2) * (W * 0.82);
    const x2 = F + Math.sin(((t + 0.052) * Math.PI) / 2) * (W * 0.82);
    panes.push({ x, w: x2 - x + 1, d: Math.abs(t) });
  }
  const curves = new Path2D();
  for (const k of [0.18, 0.34, 0.5, 0.66, 0.82]) {
    curves.moveTo(0, floor * k + 22 * u);
    curves.quadraticCurveTo(F, floor * k - 12 * u, W, floor * k + 22 * u);
  }
  const slit = new Path2D();
  const sxs = [F - 270 * u, F - 560 * u, F + 270 * u];
  for (const x of sxs) opening(slit, { ...L, masonry: "ashlar" }, x, H * 0.14, 34 * u, H * 0.5, u, r);
  const top = H * 0.66;
  const table = new Path2D();
  ellipse(table, F, top, 150 * u, 21 * u);
  const edge = new Path2D();
  edge.moveTo(F - 150 * u, top);
  edge.quadraticCurveTo(F, top + 40 * u, F + 150 * u, top);
  edge.lineTo(F + 150 * u, top + 9 * u);
  edge.quadraticCurveTo(F, top + 50 * u, F - 150 * u, top + 9 * u);
  edge.closePath();
  const shield = new Path2D();
  shield.moveTo(F - 42 * u, top - 10 * u);
  shield.lineTo(F + 42 * u, top - 10 * u);
  shield.quadraticCurveTo(F + 34 * u, top + 10 * u, F, top + 16 * u);
  shield.quadraticCurveTo(F - 34 * u, top + 10 * u, F - 42 * u, top - 10 * u);
  const chairs = new Path2D();
  for (const d of [-190, -128, 128, 190]) rr(chairs, F + (d - 13) * u, top - 74 * u, 26 * u, 90 * u, 3 * u);
  const legs = new Path2D();
  for (const d of [-96, 96]) legs.rect(F + (d - 5) * u, top + 22 * u, 10 * u, H - top);
  return keepRoom(
    c,
    { ...L, wall: white },
    slit,
    hillView(c),
    (g, E) => {
      for (const p of panes) {
        g.fillStyle = rgb(mix(tint(E, white, 0.38), DARK, p.d * p.d * 0.55));
        g.fillRect(p.x, 0, p.w, floor);
      }
      stroke(g, curves, tint(E, [146, 142, 136], 0.3), 1.1 * u, 0.55);
      g.fillStyle = rgb(tint(E, [146, 144, 150], 0.3));
      g.fillRect(0, floor, W, H - floor);
      reveal(g, E, { ...L, wall: white, joint: [130, 128, 124] }, slit, u);
      for (const x of sxs) shaft(g, E, x - 17 * u, x + 17 * u, H * 0.5, floor, 46 * u);
      fill(g, chairs, tint(E, [232, 230, 224], 0.42));
      fill(g, legs, tint(E, [210, 206, 198], 0.38));
      fill(g, edge, tint(E, [190, 186, 178], 0.4));
      fill(g, table, tint(E, [232, 228, 218], 0.46));
      fill(g, shield, tint(E, [250, 248, 244], 0.54));
      stroke(g, shield, tint(E, [170, 166, 158], 0.4), 1.6 * u);
      // The White Book, open before the Lord Commander's place.
      g.fillStyle = rgb(tint(E, [226, 222, 208], 0.5));
      poly2(g, F + 56 * u, top - 3 * u, F + 112 * u, top - 3 * u, F + 104 * u, top - 15 * u, F + 62 * u, top - 15 * u);
      g.fillStyle = rgb(tint(E, [184, 150, 84], 0.46));
      g.fillRect(F + 83 * u, top - 15 * u, 2 * u, 12 * u);
      candle(g, E, F - 76 * u, top - 3 * u, u, 18);
      candle(g, E, F + 34 * u, top - 3 * u, u, 14);
      for (const x of [F - 415 * u, F + 415 * u]) torch(g, E, x, H * 0.4, u);
    },
    floor,
  );
}
function poly2(g: G, ...pts: number[]) {
  const p = new Path2D();
  poly(p, ...pts);
  g.fill(p);
}

/** Maegor's Holdfast from across its dry moat: a keep within a keep, spikes below, one drawbridge. */
function holdfast(c: Ctx): Scene {
  const { W, H, u, F, r } = c;
  const L = keepLook(c);
  const stone: RGB = L.masonry === "ashlar" ? [186, 172, 150] : L.masonry === "fused" ? [80, 74, 80] : [190, 104, 84];
  const wall = new Path2D();
  const baseY = H * 0.66;
  wall.rect(-4, H * 0.3, W + 8, baseY - H * 0.3);
  for (let x = -6 * u; x < W; x += 24 * u) wall.rect(x, H * 0.3 - 11 * u, 14 * u, 12 * u);
  const towers = new Path2D();
  const winLit: { x: number; y: number }[] = [];
  for (let x = F - 700 * u; x < W + 240 * u; x += 350 * u) {
    towers.rect(x - 56 * u, H * 0.12, 112 * u, baseY - H * 0.12);
    for (let k = -2; k <= 2; k++) towers.rect(x + k * 24 * u - 7 * u, H * 0.12 - 12 * u, 14 * u, 13 * u);
    for (const y of [0.24, 0.42]) winLit.push({ x: x + (r() - 0.5) * 30 * u, y: H * y });
  }
  const keepBody = new Path2D();
  keepBody.rect(F - 130 * u, H * 0.06, 260 * u, H * 0.3);
  for (let k = -5; k <= 5; k++) keepBody.rect(F + k * 24 * u - 7 * u, H * 0.06 - 12 * u, 14 * u, 13 * u);
  const gate = new Path2D();
  gate.moveTo(F - 44 * u, baseY);
  gate.lineTo(F - 44 * u, baseY - 60 * u);
  gate.arc(F, baseY - 60 * u, 44 * u, Math.PI, 0);
  gate.lineTo(F + 44 * u, baseY);
  gate.closePath();
  const pit = new Path2D();
  pit.rect(-4, baseY, W + 8, H * 0.12);
  const spikes = new Path2D();
  for (let x = -8 * u; x < W; x += 15 * u) if (Math.abs(x - F) > 58 * u) poly(spikes, x - 3 * u, H * 0.78, x + 3 * u, H * 0.78, x, H * 0.78 - (24 + r() * 16) * u);
  const near = new Path2D();
  near.rect(-4, H * 0.78, W + 8, H * 0.24);
  const bridge = new Path2D();
  poly(bridge, F - 44 * u, baseY, F + 44 * u, baseY, F + 104 * u, H * 0.8, F + 150 * u, H + 2, F - 150 * u, H + 2, F - 104 * u, H * 0.8);
  const chains = new Path2D();
  for (const s of [-1, 1]) {
    chains.moveTo(F + s * 40 * u, baseY - 66 * u);
    chains.lineTo(F + s * 96 * u, H * 0.8);
  }
  const planks = new Path2D();
  for (let k = 0; k < 8; k++) {
    const t = k / 8;
    const y = baseY + (H - baseY) * t * t;
    const hw = (44 + (t * t * 106)) * u;
    planks.moveTo(F - hw, y);
    planks.lineTo(F + hw, y);
  }
  return {
    draw(g, E) {
      const on = torchlight(E);
      fill(g, keepBody, lit(E, 0.6, mix(stone, DARK, 0.1), 0.72));
      fill(g, wall, lit(E, 0.5, stone, 0.82));
      fill(g, towers, lit(E, 0.44, mix(stone, [255, 240, 214], 0.06), 0.86));
      for (const w of winLit) {
        g.fillStyle = rgb(mix([20, 16, 20], [255, 200, 120], E.glow));
        g.fillRect(w.x - 3 * u, w.y, 6 * u, 15 * u);
        if (E.glow > 0.2) glowAt(g, w.x, w.y + 7 * u, 18 * u, WARM, 0.5 * E.glow);
      }
      fill(g, gate, [14, 10, 12]);
      stroke(g, gate, lit(E, 0.4, mix(stone, [255, 240, 214], 0.2), 0.9), 5 * u);
      glowAt(g, F, baseY - 30 * u, 90 * u, WARM, 0.3 * on);
      fill(g, pit, tone(E, 0.9));
      fill(g, spikes, tone(E, 0.92, IRON, 0.8));
      stroke(g, spikes, lit(E, 0.5, [176, 176, 186], 0.6), 0.6 * u, 0.6);
      fill(g, near, lit(E, 0.72, mix(stone, DARK, 0.25), 0.7));
      fill(g, bridge, lit(E, 0.68, [116, 82, 54], 0.8));
      stroke(g, planks, tone(E, 0.9), 1 * u, 0.5);
      stroke(g, chains, [24, 22, 26], 2 * u);
      for (const s of [-1, 1]) {
        const x = F + s * 118 * u;
        g.fillStyle = rgb(tone(E, 0.9));
        g.fillRect(x - 2 * u, H * 0.54, 4 * u, H * 0.26);
        if (E.glow > 0.12) fire(g, E, x, H * 0.54, 0.75 * u);
        if (E.glow > 0.12) glowAt(g, x, H * 0.54, 70 * u, WARM, 0.32 * on);
      }
    },
  };
}

/** The cellars below the Red Keep: great black skulls fading away into the vault, one torch. */
function skullcellar(c: Ctx): Scene {
  const { W, H, u, F } = c;
  const L = keepLook(c);
  const floor = H * 0.86;
  const S = shell(c, L, { floor, spring: 0.3, bay: 280, arches: true, torches: false, dressed: false });
  const skulls: Paint[] = [];
  const near = [F + 110 * u, F - 470 * u, F - 1030 * u].filter((x) => x > -400 * u && x < W + 400 * u);
  near.forEach((x, i) => skulls.push(dragonSkull(c, x, H * 0.55, 1.05 - i * 0.12, i % 2 ? 1 : -1)));
  return keepRoom(
    c,
    L,
    shut(),
    () => {},
    (g, E) => {
      S.under(g, E);
      for (const sk of skulls) sk(g, E);
      // Dark closes in round the torch.
      const vg = g.createRadialGradient(F - 130 * u, H * 0.42, 40 * u, F - 130 * u, H * 0.42, W * 0.7);
      vg.addColorStop(0, rgb(DARK, 0));
      vg.addColorStop(1, rgb(DARK, 0.62));
      g.fillStyle = vg;
      g.fillRect(0, 0, W, H);
      S.over(g, E);
      torch(g, E, F - 130 * u, H * 0.42, u, 1.5);
    },
    floor,
  );
}

// ---------- Harrenhal ----------

/** The Hall of a Hundred Hearths: hearth after vast hearth into the dark, the tables small beneath them, few of the fires lit. */
function hundredhearths(c: Ctx): Scene {
  const { W, H, u, F, r } = c;
  const L = keepLook(c);
  const floor = H * 0.88;
  const S = shell(c, L, { floor, spring: 0.12, bay: 250, torches: false, busy: [[-W, W * 2]] });
  const bay = 250 * u;
  const hearths: { x: number; lit: boolean }[] = [];
  for (let k = -8; k < 8; k++) {
    const x = F + (k + 0.5) * bay;
    if (x > -bay && x < W + bay) hearths.push({ x, lit: k === 0 || k === -3 });
  }
  const stone = new Path2D();
  const mouths = new Path2D();
  for (const h of hearths) {
    stone.rect(h.x - 96 * u, H * 0.3, 192 * u, floor - H * 0.3);
    stone.rect(h.x - 108 * u, H * 0.3 - 9 * u, 216 * u, 10 * u);
    poly(stone, h.x - 92 * u, H * 0.3 - 9 * u, h.x + 92 * u, H * 0.3 - 9 * u, h.x + 34 * u, H * 0.13, h.x - 34 * u, H * 0.13);
    mouths.moveTo(h.x - 72 * u, floor);
    mouths.lineTo(h.x - 72 * u, H * 0.56);
    mouths.quadraticCurveTo(h.x, H * 0.36, h.x + 72 * u, H * 0.56);
    mouths.lineTo(h.x + 72 * u, floor);
    mouths.closePath();
  }
  const benches = new Path2D();
  const ty = floor - 14 * u;
  for (let x = -30 * u; x < W + 30 * u; x += 196 * u) {
    benches.rect(x, ty, 150 * u, 3.6 * u);
    benches.rect(x + 12 * u, ty, 3.6 * u, H - ty);
    benches.rect(x + 134 * u, ty, 3.6 * u, H - ty);
    benches.rect(x + 6 * u, floor + 7 * u, 138 * u, 2.4 * u);
  }
  const cups: number[] = [];
  for (let x = 0; x < W; x += (64 + r() * 90) * u) cups.push(x);
  return keepRoom(
    c,
    L,
    shut(),
    () => {},
    (g, E) => {
      S.under(g, E);
      fill(g, stone, mix(tint(E, L.wall, L.night), [255, 240, 214], 0.04));
      fill(g, mouths, [12, 9, 11]);
      for (const h of hearths) {
        if (!h.lit) continue;
        glowAt(g, h.x, floor - 40 * u, 420 * u, [255, 130, 56], 0.42);
        for (const d of [-40, -16, 12, 38]) fire(g, E, h.x + d * u, floor - 3 * u, 1.9 * u);
      }
      fill(g, benches, tint(E, L.wood, 0.36));
      for (const x of cups) candle(g, E, x, ty, u, 7, 0.34);
      S.over(g, E);
    },
    floor,
  );
}

/** Inside a tower that ran like wax: walls slumped into folds, one warped window, a split open on the sky. */
function meltedtower(c: Ctx): Scene {
  const { W, H, u, F, r } = c;
  const L = keepLook(c);
  const floor = H * 0.86;
  const S = shell(c, L, { floor, arches: false, torches: false, dressed: false });
  const win = new Path2D();
  opening(win, L, F - 90 * u, H * 0.2, 86 * u, H * 0.6, u, r);
  // The split where the wall gave way, from the vault down.
  const sx = F + 170 * u;
  win.moveTo(sx - 46 * u, -2);
  win.lineTo(sx + 66 * u, -2);
  win.lineTo(sx + 42 * u, H * 0.14);
  win.lineTo(sx + 28 * u, H * 0.2);
  win.lineTo(sx + 26 * u, H * 0.36);
  win.lineTo(sx + 8 * u, H * 0.46);
  win.lineTo(sx - 4 * u, H * 0.34);
  win.lineTo(sx - 18 * u, H * 0.22);
  win.lineTo(sx - 26 * u, H * 0.1);
  win.closePath();
  const folds: { x: number; len: number; w: number }[] = [];
  for (let x = -30 * u; x < W + 30 * u; x += (34 + r() * 56) * u) folds.push({ x, len: floor * (0.45 + r() * 0.5), w: (28 + r() * 44) * u });
  const rubble = new Path2D();
  for (let i = 0; i < 30; i++) {
    const x = sx - 90 * u + r() * 210 * u;
    const y = floor + r() * 26 * u - 4 * u;
    const s = (5 + r() * 12) * u;
    poly(rubble, x - s, y + s * 0.5, x - s * 0.5, y - s * 0.7, x + s * 0.7, y - s * 0.4, x + s, y + s * 0.5);
  }
  const pallet = new Path2D();
  rr(pallet, F - 340 * u, floor - 8 * u, 136 * u, 18 * u, 6 * u);
  return keepRoom(
    c,
    L,
    win,
    hillView(c),
    (g, E) => {
      S.under(g, E);
      g.save();
      g.clip(outsideOf(c, win), "evenodd");
      for (const f of folds) {
        const lg = g.createLinearGradient(f.x, 0, f.x + f.w, 0);
        const body = tint(E, mix(L.wall, [176, 166, 172], 0.2), L.night);
        lg.addColorStop(0, rgb(mix(body, DARK, 0.5), 0.5));
        lg.addColorStop(0.42, rgb(mix(body, [220, 208, 214], 0.2), 0.55));
        lg.addColorStop(1, rgb(mix(body, DARK, 0.65), 0.5));
        g.fillStyle = lg;
        g.beginPath();
        g.moveTo(f.x, 0);
        g.lineTo(f.x, f.len * 0.72);
        g.quadraticCurveTo(f.x + f.w * 0.5, f.len + 18 * u, f.x + f.w, f.len * 0.72);
        g.lineTo(f.x + f.w, 0);
        g.closePath();
        g.fill();
      }
      g.restore();
      reveal(g, E, L, win, u);
      shaft(g, E, F - 130 * u, F - 50 * u, H * 0.6, H, 70 * u, [226, 232, 255]);
      fill(g, rubble, tint(E, [84, 78, 84], 0.32));
      fill(g, pallet, tint(E, [112, 92, 62], 0.34));
      S.over(g, E);
      // One small brazier, in all that dark.
      const bx = F - 150 * u;
      g.fillStyle = rgb(tint(E, IRON, 0.32));
      poly2(g, bx - 18 * u, floor - 26 * u, bx + 18 * u, floor - 26 * u, bx + 12 * u, floor - 8 * u, bx - 12 * u, floor - 8 * u);
      g.fillRect(bx - 2 * u, floor - 8 * u, 4 * u, 20 * u);
      glowAt(g, bx, floor - 40 * u, 220 * u, [255, 130, 56], 0.42);
      fire(g, E, bx, floor - 24 * u, 1.05 * u);
    },
    floor,
  );
}

/** Stone drips drawn across a stretch of wall, near-black, each with a pale wet edge. */
function runningStone(c: Ctx, top: number, bottom: number) {
  const { W, u, r } = c;
  const body = new Path2D();
  body.rect(-4, top, W + 8, bottom - top);
  const tongues = new Path2D();
  for (let x = -30 * u; x < W + 30 * u; ) {
    const w = (30 + r() * 80) * u;
    const end = bottom + (10 + r() * 62) * u;
    tongues.moveTo(x, bottom - 60 * u);
    tongues.lineTo(x, end - w * 0.36);
    tongues.quadraticCurveTo(x + w / 2, end + w * 0.3, x + w, end - w * 0.36);
    tongues.lineTo(x + w, bottom - 60 * u);
    tongues.closePath();
    x += w * (0.7 + r() * 0.5);
  }
  const lobes = new Path2D();
  for (let x = -30 * u; x < W + 30 * u; ) {
    const w = (44 + r() * 80) * u;
    const end = top + (30 + r() * (bottom - top) * 0.7);
    lobes.moveTo(x, top - 2);
    lobes.lineTo(x, end - w * 0.3);
    lobes.quadraticCurveTo(x + w / 2, end + w * 0.3, x + w, end - w * 0.3);
    lobes.lineTo(x + w, top - 2);
    lobes.closePath();
    x += w * (0.6 + r() * 0.5);
  }
  return { body, tongues, lobes };
}

/** The Flowstone Yard: flags in the shadow of walls whose stone ran down and set across them. */
function flowstoneyard(c: Ctx): Scene {
  const { W, H, u, F } = c;
  const ground = H * 0.68;
  const S = runningStone(c, H * 0.24, ground);
  const tower = new Path2D();
  tower.moveTo(F - 230 * u, H * 0.3);
  tower.lineTo(F - 230 * u, H * 0.05);
  tower.quadraticCurveTo(F - 196 * u, H * 0.13, F - 164 * u, H * 0.02);
  tower.quadraticCurveTo(F - 122 * u, H * 0.12, F - 92 * u, H * 0.05);
  tower.lineTo(F - 92 * u, H * 0.3);
  tower.closePath();
  const flags = new Path2D();
  for (let i = -24; i <= 24; i++) {
    flags.moveTo(F + i * 34 * u, ground);
    flags.lineTo(F + i * 96 * u, H);
  }
  for (const t of [0.22, 0.46, 0.72]) {
    flags.moveTo(0, ground + (H - ground) * t);
    flags.lineTo(W, ground + (H - ground) * t);
  }
  const yard = new Path2D();
  yard.rect(-4, ground, W + 8, H - ground);
  return {
    draw(g, E) {
      const stone: RGB = [78, 72, 80];
      fill(g, tower, lit(E, 0.74, stone, 0.6));
      fill(g, S.body, lit(E, 0.8, stone, 0.62));
      fill(g, S.lobes, lit(E, 0.6, [136, 126, 132], 0.62), 0.72);
      stroke(g, S.lobes, lit(E, 0.36, [196, 186, 192], 0.6), 1.4 * u, 0.6);
      fill(g, yard, lit(E, 0.74, [106, 98, 92], 0.66));
      stroke(g, flags, tone(E, 0.94), 1 * u, 0.5);
      fill(g, S.tongues, lit(E, 0.8, [84, 78, 84], 0.62));
      stroke(g, S.tongues, lit(E, 0.5, [176, 168, 176], 0.5), 1.1 * u, 0.5);
      // Rain lies in the runs, snow softens them.
      if (E.c.rain > 0.2) {
        g.fillStyle = rgb(mix(E.sky.bot, [190, 200, 220], 0.4), 0.3 * E.c.rain);
        for (let x = F % (130 * u); x < W; x += 130 * u) {
          g.beginPath();
          g.ellipse(x, H * 0.86, 46 * u, 8 * u, 0, 0, TAU);
          g.fill();
        }
      }
      if (E.c.snow > 0.2) {
        fill(g, S.tongues, [230, 234, 244], 0.3 * E.c.snow);
        fill(g, yard, [230, 234, 244], 0.25 * E.c.snow);
      }
      for (const x of [F - 330 * u, F + 110 * u]) {
        g.fillStyle = "rgb(24,20,22)";
        g.fillRect(x - 2 * u, H * 0.4, 4 * u, 28 * u);
        if (E.glow > 0.12) {
          glowAt(g, x, H * 0.4, 150 * u, WARM, 0.4 * torchlight(E));
          fire(g, E, x, H * 0.4, 0.7 * u);
        }
      }
    },
  };
}

/** The bear pit: a ring of stone tiers round a sand floor, an iron grate let into the wall. */
function bearpit(c: Ctx): Scene {
  const { W, H, u, F, r } = c;
  const cy = H * 0.86;
  const rx = Math.max(W * 0.74, 560 * u);
  const tiers = [0, 1, 2, 3].map((k) => {
    const p = new Path2D();
    p.ellipse(F, cy, rx + (3 - k) * 60 * u, (88 + (3 - k) * 46) * u, 0, Math.PI, TAU);
    p.lineTo(F + rx + (3 - k) * 60 * u, H + 2);
    p.lineTo(F - rx - (3 - k) * 60 * u, H + 2);
    p.closePath();
    return p;
  });
  const sand = new Path2D();
  sand.ellipse(F, H * 0.96, rx * 0.78, 56 * u, 0, 0, TAU);
  const marks = new Path2D();
  for (let i = 0; i < 46; i++) {
    const x = F + (r() - 0.5) * rx * 1.3;
    const y = H * 0.9 + r() * 34 * u;
    marks.moveTo(x, y);
    marks.quadraticCurveTo(x + (r() - 0.5) * 16 * u, y + 2 * u, x + (r() - 0.5) * 30 * u, y + (r() - 0.5) * 4 * u);
  }
  const gx = F - 150 * u;
  const gy = H * 0.82;
  const grate = new Path2D();
  grate.moveTo(gx - 44 * u, gy + 28 * u);
  grate.lineTo(gx - 44 * u, gy - 30 * u);
  grate.arc(gx, gy - 30 * u, 44 * u, Math.PI, 0);
  grate.lineTo(gx + 44 * u, gy + 28 * u);
  grate.closePath();
  const bars = new Path2D();
  for (let x = gx - 34 * u; x < gx + 40 * u; x += 13 * u) bars.rect(x, gy - 62 * u, 3.6 * u, 92 * u);
  bars.rect(gx - 44 * u, gy - 22 * u, 88 * u, 3.6 * u);
  bars.rect(gx - 44 * u, gy + 6 * u, 88 * u, 3.6 * u);
  const far = ridge(c, H * 0.3, 8 * u, 0.7);
  return {
    draw(g, E) {
      fill(g, far.p, tone(E, 0.3, ROCK, 0.4));
      const shades: RGB[] = [[120, 112, 104], [106, 98, 92], [94, 86, 82], [82, 76, 74]];
      tiers.forEach((t, i) => {
        fill(g, t, lit(E, 0.5 + i * 0.09, shades[i]!, 0.76));
        stroke(g, t, tone(E, 0.92), 1.6 * u, 0.6);
      });
      fill(g, sand, lit(E, 0.5, [190, 164, 116], 0.86));
      stroke(g, marks, tone(E, 0.76), 1.2 * u, 0.3);
      fill(g, grate, [12, 9, 11]);
      stroke(g, grate, lit(E, 0.5, [150, 140, 134], 0.78), 5 * u);
      fill(g, bars, lit(E, 0.8, IRON, 0.7));
      for (const x of [gx - 270 * u, gx + 150 * u, gx + 400 * u, gx - 580 * u]) {
        if (x < -30 * u || x > W + 30 * u) continue;
        g.fillStyle = rgb(tone(E, 0.9));
        g.fillRect(x - 2 * u, H * 0.5, 4 * u, 30 * u);
        if (E.glow > 0.12) {
          glowAt(g, x, H * 0.5, 110 * u, WARM, 0.36 * torchlight(E));
          fire(g, E, x, H * 0.5, 0.72 * u);
        }
      }
    },
  };
}

/** A sept with its roof fallen in: seven worn figures in a row, rubble and weeds, the sky coming down on them. */
function ruinsept(c: Ctx): Scene {
  const { W, H, u, F, r } = c;
  const L = keepLook(c);
  const floor = H * 0.84;
  const S = shell(c, L, { floor, arches: false, torches: false, dressed: false, busy: [[-W, W * 2]] });
  // The whole upper wall is gone, in a jagged line.
  const win = new Path2D();
  win.moveTo(-4, -4);
  let x = -4;
  const pts: [number, number][] = [];
  while (x < W + 40 * u) {
    pts.push([x, H * (0.2 + r() * 0.2)]);
    x += (34 + r() * 62) * u;
  }
  for (const [px, py] of pts) win.lineTo(px, py);
  win.lineTo(W + 8, H * 0.28);
  win.lineTo(W + 8, -4);
  win.closePath();
  const n = 7;
  const figures: Path2D[] = [];
  const gap = 104 * u;
  for (let i = 0; i < n; i++) {
    const fx = F + (i - 3) * gap - 120 * u;
    const p = new Path2D();
    const top = floor - (112 + r() * 20) * u;
    p.moveTo(fx - 27 * u, floor - 12 * u);
    p.quadraticCurveTo(fx - 25 * u, floor - 66 * u, fx - 15 * u, top + 28 * u);
    p.quadraticCurveTo(fx, top + 18 * u, fx + 15 * u, top + 28 * u);
    p.quadraticCurveTo(fx + 25 * u, floor - 66 * u, fx + 27 * u, floor - 12 * u);
    p.closePath();
    ellipse(p, fx, top + 12 * u, 13 * u, 15 * u);
    p.rect(fx - 33 * u, floor - 12 * u, 66 * u, 12 * u);
    figures.push(p);
  }
  const rubble = new Path2D();
  for (let i = 0; i < 50; i++) {
    const rx = r() * W;
    const ry = floor + r() * 32 * u - 6 * u;
    const s = (5 + r() * 14) * u;
    poly(rubble, rx - s, ry + s * 0.5, rx - s * 0.5, ry - s * 0.7, rx + s * 0.7, ry - s * 0.4, rx + s, ry + s * 0.5);
  }
  const weeds = new Path2D();
  for (let i = 0; i < 90; i++) {
    const wx = r() * W;
    const wy = floor + r() * 40 * u;
    weeds.moveTo(wx, wy);
    weeds.lineTo(wx + (r() - 0.5) * 8 * u, wy - (6 + r() * 14) * u);
  }
  return keepRoom(
    c,
    L,
    win,
    hillView(c),
    (g, E) => {
      S.under(g, E);
      shaft(g, E, 0, W, H * 0.3, H, 0);
      for (const f of figures) {
        fill(g, f, tint(E, mix(L.wall, [200, 192, 180], 0.55), L.night + 0.04));
        stroke(g, f, DARK, 1.2 * u, 0.3);
      }
      fill(g, rubble, tint(E, mix(L.floor, L.wall, 0.5), 0.3));
      stroke(g, weeds, tint(E, GRASS, 0.32), 1.1 * u, 0.8);
      if (E.c.snow > 0.2) {
        fill(g, rubble, [226, 232, 244], 0.4 * E.c.snow);
      }
      const on = torchlight(E);
      for (const d of [-260, 0, 240]) candle(g, E, F - 120 * u + d * u, floor - 12 * u, u, 12, 0.5 + on * 0.3);
    },
    floor,
  );
}

// ---------- From outside ----------

function towerTop(p: Path2D, x: number, w: number, top: number, bottom: number, melt: number[]) {
  p.moveTo(x - w / 2, bottom);
  p.lineTo(x - w / 2, top + melt[0]!);
  const n = melt.length;
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    p.quadraticCurveTo(x - w / 2 + w * (t - 0.5 / n), top + (melt[i - 1]! + (melt[i % n] ?? 0)) * 0.3, x - w / 2 + w * t, top + (melt[i] ?? melt[0]!));
  }
  p.lineTo(x + w / 2, bottom);
  p.closePath();
}

/** Harrenhal: five colossal towers, melted at their tops, over a wall too long to see the end of, the Gods Eye behind. */
function harrenhalView(c: Ctx): Scene {
  const { W, H, u, F, r } = c;
  const lake = H * 0.62;
  const towers = [
    { x: F - 330, w: 92, top: 0.1, m: [6, 22, 2, 30, 10] },
    { x: F - 170, w: 104, top: 0.04, m: [14, 2, 26, 8, 20] },
    { x: F, w: 118, top: 0.0, m: [10, 28, 4, 18, 8] },
    { x: F + 160, w: 100, top: 0.16, m: [30, 54, 12, 44, 20] }, // Kingspyre, its crown gone
    { x: F + 318, w: 88, top: 0.08, m: [4, 18, 8, 24, 2] },
  ].map((t) => ({ ...t, x: F + (t.x - F) * u, w: t.w * u }));
  const shapes = new Path2D();
  const seams = new Path2D();
  for (const t of towers) {
    towerTop(shapes, t.x, t.w, H * t.top, H * 0.74, t.m.map((v) => v * u));
    // Runs of stone from the rim.
    for (let k = 0; k < 5; k++) {
      const x = t.x - t.w / 2 + r() * t.w;
      const y = H * t.top + r() * 24 * u;
      seams.moveTo(x, y);
      seams.quadraticCurveTo(x + (r() - 0.5) * 8 * u, y + 40 * u, x + (r() - 0.5) * 6 * u, y + (50 + r() * 90) * u);
    }
  }
  const wall = new Path2D();
  wall.rect(-4, H * 0.5, W + 8, H * 0.26);
  for (let x = -8 * u; x < W; x += 22 * u) wall.rect(x, H * 0.5 - 9 * u, 13 * u, 10 * u);
  const shore = ridge(c, H * 0.74, 5 * u);
  const far = ridge(c, lake - 12 * u, 8 * u, 0.6);
  const lits = towers.flatMap((t, i) => (i === 3 ? [] : [{ x: t.x, y: H * (0.3 + i * 0.03) }]));
  return {
    draw(g, E) {
      fill(g, far.p, tone(E, 0.2, GRASS, 0.3));
      haze(g, E, W, H * 0.46, H * 0.66, 0.32);
      const stone: RGB = [78, 72, 80];
      fill(g, shapes, lit(E, 0.74, stone, 0.6));
      stroke(g, shapes, lit(E, 0.5, [170, 160, 166], 0.4), 1.2 * u, 0.5);
      stroke(g, seams, tone(E, 0.96), 1.3 * u, 0.5);
      fill(g, wall, lit(E, 0.8, stone, 0.62));
      for (const l of lits) {
        g.fillStyle = rgb(mix([20, 16, 18], [255, 190, 110], E.glow));
        g.fillRect(l.x - 3 * u, l.y, 6 * u, 14 * u);
        if (E.glow > 0.2) glowAt(g, l.x, l.y + 7 * u, 22 * u, WARM, 0.5 * E.glow);
      }
      fill(g, shore.p, tone(E, 0.86, GRASS, 0.42));
    },
  };
}

/** The Red Keep: seven drum towers and thick battlements in red stone, high on its hill above the bay. */
function redKeepView(c: Ctx): Scene {
  const { W, H, u, F } = c;
  const hill = new Path2D();
  hill.moveTo(-4, H + 2);
  hill.lineTo(-4, H * 0.86);
  hill.quadraticCurveTo(F - 320 * u, H * 0.8, F - 240 * u, H * 0.62);
  hill.lineTo(F + 240 * u, H * 0.62);
  hill.quadraticCurveTo(F + 310 * u, H * 0.84, W + 4, H * 0.92);
  hill.lineTo(W + 4, H + 2);
  hill.closePath();
  const bay = new Path2D();
  bay.rect(-4, H * 0.66, W + 8, H * 0.34);
  const glints = new Path2D();
  for (let i = 0; i < 40; i++) {
    const x = ((i * 137) % 100) / 100 * W;
    const y = H * 0.72 + (i % 7) * 7 * u;
    glints.moveTo(x, y);
    glints.lineTo(x + 18 * u, y);
  }
  const wall = new Path2D();
  wall.rect(F - 240 * u, H * 0.38, 480 * u, H * 0.26);
  for (let x = F - 240 * u; x < F + 236 * u; x += 18 * u) wall.rect(x, H * 0.38 - 8 * u, 11 * u, 9 * u);
  const xs = [-230, -150, -74, 0, 74, 150, 230];
  const tops = [0.26, 0.2, 0.14, 0.06, 0.14, 0.2, 0.26];
  const drums: { x: number; top: number; w: number }[] = xs.map((d, i) => ({ x: F + d * u, top: H * tops[i]!, w: (i === 3 ? 62 : 46) * u }));
  const hold = new Path2D();
  hold.rect(F - 50 * u, H * 0.14, 100 * u, H * 0.3);
  const merlons = new Path2D();
  for (const d of drums) for (let k = -2; k <= 2; k++) merlons.rect(d.x + k * (d.w / 5) - (d.w / 14), d.top - 8 * u, d.w / 7, 9 * u);
  return {
    draw(g, E) {
      fill(g, bay, tone(E, 0.45, [66, 110, 150], 0.7));
      stroke(g, glints, mix(E.sky.bot, [255, 255, 255], 0.3), 1 * u, 0.25 + E.day * 0.15);
      const red: RGB = [190, 96, 78];
      fill(g, hold, lit(E, 0.58, mix(red, DARK, 0.1), 0.78));
      fill(g, wall, lit(E, 0.5, red, 0.84));
      for (const d of drums) {
        const lg = g.createLinearGradient(d.x - d.w / 2, 0, d.x + d.w / 2, 0);
        const b = lit(E, 0.42, red, 0.9);
        lg.addColorStop(0, rgb(mix(b, DARK, 0.38)));
        lg.addColorStop(0.35, rgb(mix(b, [255, 220, 196], 0.14)));
        lg.addColorStop(1, rgb(mix(b, DARK, 0.5)));
        g.fillStyle = lg;
        g.fillRect(d.x - d.w / 2, d.top, d.w, H * 0.64 - d.top);
        g.fillStyle = rgb(mix([20, 12, 12], [255, 196, 110], E.glow));
        g.fillRect(d.x - 2.4 * u, d.top + 22 * u, 4.8 * u, 11 * u);
        if (E.glow > 0.2) glowAt(g, d.x, d.top + 27 * u, 18 * u, WARM, 0.5 * E.glow);
      }
      fill(g, merlons, lit(E, 0.42, red, 0.9));
      fill(g, hill, tone(E, 0.74, [106, 112, 76], 0.62));
    },
  };
}

/** King's Landing: a city climbing three hills, the Red Keep on one, the Great Sept's dome on the next, the broken Dragonpit on the last, walls and the river below. */
function kingsLandingView(c: Ctx): Scene {
  const { W, H, u, F, r } = c;
  const river = H * 0.86;
  const peak = (cx: number, top: number, half: number) => (x: number) => {
    const t = Math.min(1, Math.abs(x - cx) / half);
    return top + (H * 0.74 - top) * t * t;
  };
  const hills = [peak(F, H * 0.34, 300 * u), peak(F - 400 * u, H * 0.42, 280 * u), peak(F - 790 * u, H * 0.46, 280 * u)];
  const yAt = (x: number) => Math.min(H * 0.74, ...hills.map((h) => h(x)));
  // The ground the city stands on, right along the picture.
  const ground = new Path2D();
  ground.moveTo(-4, H);
  for (let x = -4; x <= W + 8; x += 10 * u) ground.lineTo(x, yAt(x) + 3 * u);
  ground.lineTo(W + 8, H);
  ground.closePath();
  // Roofs packed up the hills, near ones larger.
  const roofs = [new Path2D(), new Path2D(), new Path2D()];
  const walls = [new Path2D(), new Path2D(), new Path2D()];
  for (let i = 0; i < Math.round(W / (1.5 * u)); i++) {
    const x = r() * W;
    const top = yAt(x);
    const y = top + 4 * u + r() * (H * 0.78 - top);
    const t = (y - H * 0.34) / (H * 0.44);
    const s = (5 + t * 9) * u;
    const band = t < 0.34 ? 0 : t < 0.68 ? 1 : 2;
    walls[band]!.rect(x - s, y, s * 2, s * 1.1);
    poly(roofs[band]!, x - s * 1.25, y, x, y - s, x + s * 1.25, y);
  }
  const lits = Array.from({ length: Math.round(W / (9 * u)) }, () => {
    const x = r() * W;
    const top = yAt(x);
    return { x, y: top + r() * (H * 0.78 - top) };
  });
  // The Red Keep on Aegon's High Hill.
  const keep = new Path2D();
  keep.rect(F - 92 * u, H * 0.2, 184 * u, H * 0.16);
  for (const d of [-92, -46, 0, 46, 92]) {
    keep.rect(F + d * u - 16 * u, H * (d === 0 ? 0.08 : 0.14), 32 * u, H * 0.24);
    for (let k = -1; k <= 1; k++) keep.rect(F + d * u + k * 12 * u - 3.5 * u, H * (d === 0 ? 0.08 : 0.14) - 6 * u, 7 * u, 7 * u);
  }
  // The Great Sept's dome and its crystal crowns on Visenya's Hill.
  const sx = F - 400 * u;
  const sept = new Path2D();
  sept.rect(sx - 54 * u, H * 0.32, 108 * u, H * 0.14);
  sept.moveTo(sx - 42 * u, H * 0.32);
  sept.quadraticCurveTo(sx - 38 * u, H * 0.16, sx, H * 0.14);
  sept.quadraticCurveTo(sx + 38 * u, H * 0.16, sx + 42 * u, H * 0.32);
  sept.closePath();
  for (const d of [-54, 54]) sept.rect(sx + d * u - 5 * u, H * 0.2, 10 * u, H * 0.14);
  // The Dragonpit's broken dome on Rhaenys's Hill.
  const px = F - 790 * u;
  const pit = new Path2D();
  pit.moveTo(px - 74 * u, H * 0.5);
  pit.quadraticCurveTo(px - 68 * u, H * 0.27, px - 12 * u, H * 0.26);
  pit.lineTo(px - 6 * u, H * 0.34);
  pit.lineTo(px + 14 * u, H * 0.29);
  pit.lineTo(px + 22 * u, H * 0.38);
  pit.lineTo(px + 38 * u, H * 0.33);
  pit.quadraticCurveTo(px + 66 * u, H * 0.38, px + 74 * u, H * 0.5);
  pit.closePath();
  const cityWall = new Path2D();
  cityWall.rect(-4, H * 0.76, W + 8, 18 * u);
  for (let x = -6 * u; x < W; x += 15 * u) cityWall.rect(x, H * 0.76 - 6 * u, 9 * u, 7 * u);
  for (let x = F - 900 * u; x < W; x += 300 * u) if (x > -40 * u) cityWall.rect(x - 16 * u, H * 0.72, 32 * u, 30 * u);
  const water = new Path2D();
  water.rect(-4, river - 8 * u, W + 8, H - river + 10 * u);
  const sails = new Path2D();
  for (let x = F - 700 * u; x < W; x += 260 * u) {
    if (x < -20 * u) continue;
    poly(sails, x, river + 8 * u, x, river - 22 * u, x + 14 * u, river + 2 * u);
    poly(sails, x - 16 * u, river + 8 * u, x + 20 * u, river + 8 * u, x + 13 * u, river + 14 * u, x - 9 * u, river + 14 * u);
  }
  return {
    draw(g, E) {
      const hue: RGB[] = [[150, 128, 110], [162, 134, 110], [170, 138, 110]];
      const roofHue: RGB = [150, 86, 62];
      fill(g, sept, lit(E, 0.42, [224, 216, 200], 0.82));
      fill(g, pit, lit(E, 0.5, [150, 142, 130], 0.72));
      fill(g, keep, lit(E, 0.44, [190, 96, 78], 0.88));
      fill(g, ground, lit(E, 0.7, [118, 92, 76], 0.74));
      for (const b of [0, 1, 2]) {
        fill(g, walls[b]!, lit(E, 0.5 + b * 0.1, hue[b]!, 0.72));
        fill(g, roofs[b]!, lit(E, 0.56 + b * 0.1, roofHue, 0.76));
      }
      if (E.glow > 0.1)
        for (const l of lits) {
          g.fillStyle = rgb([255, 204, 130], 0.8 * clamp(E.glow * 1.1));
          g.fillRect(l.x, l.y, 2.2 * u, 2.2 * u);
        }
      fill(g, cityWall, lit(E, 0.7, [150, 136, 122], 0.7));
      fill(g, water, tone(E, 0.5, [70, 92, 110], 0.7));
      fill(g, sails, lit(E, 0.8, [216, 206, 186], 0.6));
    },
  };
}

/** A castle's own portrait, if the gazetteer has one. */
export function seatView(kind: Place, house: string | null | undefined, seed: string): ((c: Ctx) => Scene) | undefined {
  const name = seed.toLowerCase();
  if (kind === "rooftops" && /king['’]?s landing/.test(name)) return kingsLandingView;
  if (kind === "castle" && /harrenhal/.test(house ?? name)) return harrenhalView;
  if (kind === "castle" && /red keep/.test(house ?? name)) return redKeepView;
  return undefined;
}

export const SEAT_SCENES = { throneroom, ballroom, roundroom, holdfast, skullcellar, hundredhearths, meltedtower, flowstoneyard, bearpit, ruinsept } satisfies Partial<Record<Place, (c: Ctx) => Scene>>;
