/**
 * King's Landing beyond the Keep (docs/25-rooms-of-the-keep.md Part 8): Flea Bottom, the Great Sept
 * inside and out, the Dragonpit, and the tourney ground.
 */
import { clamp, DARK, mix, rgb, TAU, WARM, type Ctx, type Env, type Place, type RGB } from "./places";
import { candle, keepLook, keepRoom, tint, torchlight } from "./keepbits";
import { fill, fire, glowAt, GRASS, leafy, lit as sunlit, poly, ridge, stroke, tone, type Scene } from "./scenes";
import { ellipse } from "./scenebits";

type G = CanvasRenderingContext2D;
const lit = (E: Env, t: number, hue: RGB, amt?: number) => mix(sunlit(E, t, hue, amt), tint(E, hue, 0.3), E.night * 0.7);
function poly2(g: G, ...pts: number[]) {
  const p = new Path2D();
  poly(p, ...pts);
  g.fill(p);
}

/** Flea Bottom: crooked houses leaning on each other over a mud lane, washing overhead, pot-shop fires, the Red Keep far above. */
function fleabottom(c: Ctx): Scene {
  const { W, H, u, F, r } = c;
  const ground = H * 0.74;
  const keep = new Path2D();
  const kx = F + 60 * u;
  keep.rect(kx - 60 * u, H * 0.04, 120 * u, H * 0.3);
  for (const d of [-60, -20, 20, 60]) {
    keep.rect(kx + d * u - 10 * u, H * 0.01, 20 * u, H * 0.2);
    for (let k = -1; k <= 1; k++) keep.rect(kx + d * u + k * 8 * u - 2.4 * u, H * 0.01 - 5 * u, 4.8 * u, 6 * u);
  }
  const walls: { p: Path2D; c: RGB }[] = [];
  const beams = new Path2D();
  const roofs = new Path2D();
  const panes: { x: number; y: number; on: boolean }[] = [];
  const plaster: RGB[] = [[150, 124, 94], [132, 112, 90], [168, 142, 106], [120, 100, 84]];
  for (let x = -40 * u; x < W + 40 * u; ) {
    const w = (70 + r() * 54) * u;
    const h = (118 + r() * 76) * u;
    const lean = (r() - 0.5) * 30 * u;
    const over = (6 + r() * 12) * u;
    const top = ground - h;
    const mid = ground - h * 0.48;
    const p = new Path2D();
    p.moveTo(x, ground);
    p.lineTo(x + lean * 0.3, mid);
    p.lineTo(x + lean * 0.3 - over, mid - 4 * u);
    p.lineTo(x + lean - over * 0.5, top);
    p.lineTo(x + w + lean + over * 0.5, top);
    p.lineTo(x + w + lean * 0.3 + over, mid - 4 * u);
    p.lineTo(x + w + lean * 0.3, mid);
    p.lineTo(x + w, ground);
    p.closePath();
    walls.push({ p, c: plaster[(r() * plaster.length) | 0]! });
    beams.moveTo(x + lean * 0.3 - over, mid - 4 * u);
    beams.lineTo(x + w + lean * 0.3 + over, mid - 4 * u);
    beams.moveTo(x + w * 0.5 + lean * 0.5, top);
    beams.lineTo(x + w * 0.5 + lean * 0.1, ground);
    beams.moveTo(x + lean * 0.7, top);
    beams.lineTo(x + w * 0.46 + lean * 0.3, mid - 4 * u);
    poly(roofs, x + lean - over - 6 * u, top + 2 * u, x + w * (0.34 + r() * 0.3) + lean, top - (34 + r() * 30) * u, x + w + lean + over + 6 * u, top + 2 * u);
    for (const ny of [mid - 34 * u, ground - 44 * u]) panes.push({ x: x + w * (0.25 + r() * 0.5), y: ny, on: r() < 0.55 });
    x += w * (0.86 + r() * 0.1);
  }
  const mud = new Path2D();
  mud.rect(-4, ground, W + 8, H - ground);
  const ruts = new Path2D();
  for (let i = 0; i < Math.round(W / (7 * u)); i++) {
    const x = r() * W;
    const y = ground + 6 * u + r() * (H - ground - 8 * u);
    ruts.moveTo(x, y);
    ruts.quadraticCurveTo(x + 16 * u, y + (r() - 0.5) * 4 * u, x + (r() * 50 + 10) * u, y + (r() - 0.5) * 3 * u);
  }
  const lines = new Path2D();
  const wash: { x: number; y: number; w: number; h: number; c: RGB; a: number }[] = [];
  for (let x = F - 780 * u; x < W; x += 260 * u) {
    const y = H * (0.2 + r() * 0.16);
    lines.moveTo(x, y);
    lines.quadraticCurveTo(x + 110 * u, y + 28 * u, x + 220 * u, y);
    for (let t = 0.12; t < 0.9; t += 0.18) {
      const wx = x + 220 * u * t;
      const wy = y + 4 * 28 * u * t * (1 - t) * 0.5;
      wash.push({ x: wx, y: wy, w: (12 + r() * 14) * u, h: (18 + r() * 22) * u, c: ([[210, 202, 180], [150, 110, 90], [120, 130, 140], [196, 170, 120]] as RGB[])[(r() * 4) | 0]!, a: (r() - 0.5) * 0.08 });
    }
  }
  // Two pot shops: an awning over a fire and a great pot of brown.
  const shops = [F - 170 * u, F - 660 * u].filter((x) => x > -60 * u);
  const puddles = new Path2D();
  for (const x of [F - 330 * u, F + 110 * u, F - 800 * u]) ellipse(puddles, x, H * 0.92, 54 * u, 7 * u);
  return {
    draw(g, E) {
      fill(g, keep, lit(E, 0.34, [176, 106, 90], 0.6));
      for (const w of walls) fill(g, w.p, lit(E, 0.56, w.c, 0.82));
      fill(g, roofs, lit(E, 0.66, [96, 74, 58], 0.8));
      stroke(g, beams, lit(E, 0.8, [62, 44, 32], 0.76), 3 * u);
      for (const p of panes) {
        g.fillStyle = rgb(p.on ? mix([24, 18, 18], [255, 190, 110], E.glow) : [16, 12, 14]);
        g.fillRect(p.x - 6 * u, p.y, 12 * u, 15 * u);
        if (p.on && E.glow > 0.2) glowAt(g, p.x, p.y + 7 * u, 26 * u, WARM, 0.44 * E.glow);
      }
      stroke(g, lines, tone(E, 0.9), 0.9 * u, 0.7);
      const T = E.still ? 0 : E.T;
      for (const w of wash) {
        g.save();
        g.translate(w.x, w.y);
        g.rotate(w.a + Math.sin(T * 1.2 + w.x) * 0.05 * (0.4 + E.c.wind));
        g.fillStyle = rgb(lit(E, 0.44, w.c, 0.84));
        g.fillRect(-w.w / 2, 0, w.w, w.h);
        g.restore();
      }
      fill(g, mud, lit(E, 0.8, [92, 74, 56], 0.76));
      stroke(g, ruts, tone(E, 0.96), 1.5 * u, 0.42);
      fill(g, puddles, mix(E.sky.bot, DARK, 0.45), 0.5 + E.c.rain * 0.3);
      for (const x of shops) {
        const y = H * 0.84;
        g.fillStyle = rgb(lit(E, 0.66, [150, 76, 58], 0.76));
        poly2(g, x - 76 * u, y - 112 * u, x + 76 * u, y - 112 * u, x + 92 * u, y - 80 * u, x - 92 * u, y - 80 * u);
        g.fillStyle = rgb(lit(E, 0.76, [76, 56, 40], 0.8));
        g.fillRect(x - 76 * u, y - 80 * u, 4 * u, 90 * u);
        g.fillRect(x + 72 * u, y - 80 * u, 4 * u, 90 * u);
        const on = torchlight(E);
        glowAt(g, x, y - 8 * u, 150 * u, [255, 130, 56], 0.3 + 0.24 * on);
        fire(g, E, x - 12 * u, y + 7 * u, 1 * u);
        fire(g, E, x + 12 * u, y + 7 * u, 1.1 * u);
        g.fillStyle = "rgb(20,18,20)";
        g.beginPath();
        g.moveTo(x - 30 * u, y - 18 * u);
        g.lineTo(x + 30 * u, y - 18 * u);
        g.quadraticCurveTo(x + 32 * u, y + 6 * u, x, y + 6 * u);
        g.quadraticCurveTo(x - 32 * u, y + 6 * u, x - 30 * u, y - 18 * u);
        g.fill();
        for (let i = 0; i < 4; i++) {
          const k = ((E.still ? 2 : E.T) * 0.09 + i / 4) % 1;
          g.fillStyle = rgb([224, 224, 230], 0.12 * Math.sin(k * Math.PI));
          g.beginPath();
          g.arc(x + Math.sin(i * 2.1) * 12 * u, y - 24 * u - k * 56 * u, (6 + k * 16) * u, 0, TAU);
          g.fill();
        }
      }
    },
  };
}

const SEVEN: RGB[] = [[210, 70, 80], [230, 150, 60], [236, 214, 96], [90, 170, 110], [76, 130, 214], [106, 86, 200], [176, 96, 196]];

/** Inside the Great Sept: a seven-sided dome rising out of sight, crystal lanterns, seven altars, the floor taking the colours. */
function greatsept(c: Ctx): Scene {
  const { W, H, u, F, r } = c;
  const L = { ...keepLook(c), wall: [214, 204, 186] as RGB, floor: [186, 176, 160] as RGB };
  const floor = H * 0.8;
  const cx = F - 100 * u;
  // Tall slender windows round the drum, in the seven colours.
  const win = new Path2D();
  const lights: { x: number; c: RGB; w: number }[] = [];
  for (let i = -7; i <= 7; i++) {
    const x = cx + Math.sin((i / 8) * (Math.PI / 2)) * Math.max(W * 0.86, 640 * u);
    const w = (46 - Math.abs(i) * 3.6) * u;
    if (x < -40 * u || x > W + 40 * u) continue;
    win.moveTo(x - w / 2, H * 0.56);
    win.lineTo(x - w / 2, H * 0.2);
    win.quadraticCurveTo(x, H * 0.08, x + w / 2, H * 0.2);
    win.lineTo(x + w / 2, H * 0.56);
    win.closePath();
    lights.push({ x, c: SEVEN[(i + 14) % 7]!, w });
  }
  // Vault ribs fanning up to the crown.
  const ribs = new Path2D();
  for (let i = -8; i <= 8; i++) {
    const x = cx + Math.sin(((i + 0.5) / 8) * (Math.PI / 2)) * Math.max(W * 0.86, 640 * u);
    ribs.moveTo(x, floor);
    ribs.lineTo(x, H * 0.2);
    ribs.quadraticCurveTo(x, -6 * u, cx + (x - cx) * 0.2, -40 * u);
  }
  const band = new Path2D();
  band.rect(-4, H * 0.57, W + 8, H * 0.03);
  band.rect(-4, H * 0.68, W + 8, H * 0.02);
  const altars: { x: number; c: RGB }[] = [];
  for (let i = 0; i < 7; i++) altars.push({ x: cx + (i - 3) * 118 * u, c: SEVEN[i]! });
  const lanterns = Array.from({ length: 9 }, (_, i) => ({ x: cx + (i - 4) * 138 * u + (r() - 0.5) * 12 * u, y: H * (0.14 + (i % 3) * 0.05) }));
  const tiles = new Path2D();
  for (let k = -24; k <= 24; k++) {
    tiles.moveTo(cx + k * 38 * u, floor);
    tiles.lineTo(cx + k * 110 * u, H);
  }
  for (const t of [0.2, 0.42, 0.68]) {
    tiles.moveTo(0, floor + (H - floor) * t);
    tiles.lineTo(W, floor + (H - floor) * t);
  }
  return keepRoom(
    c,
    L,
    win,
    () => {},
    (g, E) => {
      const stone = tint(E, L.wall, 0.42);
      const b = clamp(0.26 + E.day * 0.66 * (1 - E.c.cloud * 0.3));
      g.save();
      g.clip(win);
      for (const l of lights) {
        const lg = g.createLinearGradient(0, H * 0.1, 0, H * 0.56);
        lg.addColorStop(0, rgb(mix(DARK, mix(l.c, [255, 255, 255], 0.3), b)));
        lg.addColorStop(1, rgb(mix(DARK, l.c, b)));
        g.fillStyle = lg;
        g.fillRect(l.x - l.w, 0, l.w * 2, H * 0.57);
      }
      g.restore();
      stroke(g, win, tint(E, [226, 200, 130], 0.42), 2.4 * u);
      stroke(g, ribs, mix(stone, [255, 246, 226], 0.1), 7 * u);
      stroke(g, ribs, tint(E, [160, 148, 128], 0.32), 1 * u, 0.6);
      fill(g, band, tint(E, [214, 184, 116], 0.46));
      // The colours fall on the floor by day.
      if (E.day > 0.12)
        for (const l of lights) {
          g.fillStyle = rgb(l.c, 0.15 * E.day * (1 - E.c.cloud * 0.6));
          g.beginPath();
          g.moveTo(l.x - l.w / 2, H * 0.56);
          g.lineTo(l.x + l.w / 2, H * 0.56);
          g.lineTo(l.x + l.w * 2 + (l.x - cx) * 0.2, H);
          g.lineTo(l.x - l.w * 1.4 + (l.x - cx) * 0.2, H);
          g.fill();
        }
      stroke(g, tiles, tint(E, [146, 136, 120], 0.3), 1 * u, 0.42);
      for (const a of altars) {
        g.fillStyle = rgb(tint(E, [226, 218, 202], 0.46));
        g.fillRect(a.x - 40 * u, floor - 40 * u, 80 * u, 44 * u);
        g.fillRect(a.x - 46 * u, floor - 44 * u, 92 * u, 5 * u);
        g.fillStyle = rgb(tint(E, a.c, 0.46));
        g.fillRect(a.x - 18 * u, floor - 40 * u, 36 * u, 44 * u);
        for (const d of [-32, -16, 0, 16, 32]) candle(g, E, a.x + d * u, floor - 44 * u, u, 11 + (Math.abs(d) % 3) * 3, 0.44);
      }
      for (const l of lanterns) {
        const on = torchlight(E);
        g.strokeStyle = "rgba(40,34,30,.8)";
        g.lineWidth = 0.9 * u;
        g.beginPath();
        g.moveTo(l.x, 0);
        g.lineTo(l.x, l.y - 12 * u);
        g.stroke();
        glowAt(g, l.x, l.y, 70 * u, [255, 248, 226], 0.28 * on + 0.06);
        g.fillStyle = rgb(mix([206, 222, 236], [255, 246, 214], on));
        poly2(g, l.x, l.y - 13 * u, l.x + 9 * u, l.y, l.x, l.y + 13 * u, l.x - 9 * u, l.y);
      }
    },
    floor,
  );
}

/** The steps of the Great Sept: broad marble climbing to a great dome and its towers, the statue of Baelor before them. */
function septsteps(c: Ctx): Scene {
  const { W, H, u, F, r } = c;
  const marble: RGB = [226, 218, 202];
  const baseY = H * 0.6;
  const cx = F - 60 * u;
  const body = new Path2D();
  body.rect(cx - 280 * u, H * 0.3, 560 * u, baseY - H * 0.3);
  const dome = new Path2D();
  dome.moveTo(cx - 220 * u, H * 0.3);
  dome.quadraticCurveTo(cx - 200 * u, -H * 0.26, cx, -H * 0.3);
  dome.quadraticCurveTo(cx + 200 * u, -H * 0.26, cx + 220 * u, H * 0.3);
  dome.closePath();
  const ribs = new Path2D();
  for (const d of [-0.72, -0.44, -0.16, 0.16, 0.44, 0.72]) {
    ribs.moveTo(cx + d * 220 * u, H * 0.3);
    ribs.quadraticCurveTo(cx + d * 190 * u, -H * 0.04, cx + d * 30 * u, -H * 0.2);
  }
  const towers = new Path2D();
  for (const d of [-310, 310]) {
    towers.rect(cx + (d - 26) * u, H * 0.08, 52 * u, baseY - H * 0.08);
    poly(towers, cx + (d - 32) * u, H * 0.08, cx + d * u, -H * 0.04, cx + (d + 32) * u, H * 0.08);
  }
  const portal = new Path2D();
  for (const d of [-180, -60, 60, 180]) {
    portal.moveTo(cx + (d - 22) * u, baseY);
    portal.lineTo(cx + (d - 22) * u, H * 0.44);
    portal.quadraticCurveTo(cx + d * u, H * 0.34, cx + (d + 22) * u, H * 0.44);
    portal.lineTo(cx + (d + 22) * u, baseY);
    portal.closePath();
  }
  const steps: Path2D[] = [];
  for (let k = 0; k < 7; k++) {
    const p = new Path2D();
    p.rect(-4, baseY + k * 14 * u, W + 8, 14 * u);
    steps.push(p);
  }
  const plaza = new Path2D();
  plaza.rect(-4, baseY + 98 * u, W + 8, H);
  const sx = F - 400 * u;
  const statue = new Path2D();
  statue.rect(sx - 34 * u, H * 0.68, 68 * u, H * 0.32);
  statue.rect(sx - 42 * u, H * 0.66, 84 * u, 7 * u);
  statue.moveTo(sx - 25 * u, H * 0.66);
  statue.quadraticCurveTo(sx - 25 * u, H * 0.36, sx - 13 * u, H * 0.3);
  statue.quadraticCurveTo(sx, H * 0.26, sx + 13 * u, H * 0.3);
  statue.quadraticCurveTo(sx + 25 * u, H * 0.36, sx + 25 * u, H * 0.66);
  statue.closePath();
  ellipse(statue, sx, H * 0.24, 13 * u, 16 * u);
  poly(statue, sx + 20 * u, H * 0.42, sx + 58 * u, H * 0.26, sx + 62 * u, H * 0.29, sx + 24 * u, H * 0.48);
  const birds = Array.from({ length: 22 }, () => ({ x: r() * W, y: H * (0.72 + r() * 0.26), f: r() < 0.5 ? 1 : -1 }));
  return {
    draw(g, E) {
      fill(g, dome, lit(E, 0.42, [222, 204, 150], 0.82));
      stroke(g, ribs, lit(E, 0.32, [250, 236, 190], 0.76), 2.4 * u, 0.7);
      fill(g, towers, lit(E, 0.42, marble, 0.86));
      fill(g, body, lit(E, 0.4, marble, 0.9));
      fill(g, portal, mix([20, 16, 18], [255, 196, 120], E.glow * 0.7));
      stroke(g, portal, lit(E, 0.34, [226, 196, 130], 0.8), 2 * u);
      if (E.glow > 0.2) glowAt(g, cx, baseY - 30 * u, 240 * u, WARM, 0.24 * E.glow);
      steps.forEach((s, k) => {
        fill(g, s, lit(E, 0.38 + k * 0.03, k % 2 ? mix(marble, DARK, 0.08) : marble, 0.88));
        g.fillStyle = rgb(DARK, 0.12);
        g.fillRect(0, baseY + k * 14 * u + 11 * u, W, 3 * u);
      });
      fill(g, plaza, lit(E, 0.56, [196, 186, 170], 0.82));
      fill(g, statue, lit(E, 0.56, mix(marble, [120, 112, 100], 0.4), 0.84));
      if (E.c.snow > 0.2) for (const s of steps) fill(g, s, [236, 240, 250], 0.42 * E.c.snow);
      if (E.day > 0.3)
        for (const b of birds) {
          g.fillStyle = "rgb(60,60,70)";
          g.beginPath();
          g.ellipse(b.x, b.y, 5 * u, 3 * u, 0, 0, TAU);
          g.fill();
          g.beginPath();
          g.arc(b.x + b.f * 5 * u, b.y - 3 * u, 2.2 * u, 0, TAU);
          g.fill();
        }
      for (const x of [cx - 330 * u, cx + 330 * u, cx - 140 * u, cx + 140 * u]) {
        if (E.glow < 0.15 || x < -20 * u || x > W + 20 * u) continue;
        g.fillStyle = "rgb(26,22,22)";
        g.fillRect(x - 2 * u, baseY - 30 * u, 4 * u, 30 * u);
        glowAt(g, x, baseY - 30 * u, 110 * u, WARM, 0.36 * torchlight(E));
        fire(g, E, x, baseY - 30 * u, 0.74 * u);
      }
    },
  };
}

/** The Dragonpit on Rhaenys's Hill: a huge dome, whole until the riot in 130 AC, a broken shell since, with weeds in its bronze doors. */
function dragonpit(c: Ctx): Scene {
  const { W, H, u, F, r } = c;
  const whole = (c.home?.year ?? c.home?.keep?.year ?? 298) < 130;
  const cx = F - 80 * u;
  const rad = 330 * u;
  const base = H * 0.72;
  const domeTop = H * 0.04;
  const shape = new Path2D();
  shape.moveTo(cx - rad, base);
  if (whole) {
    shape.quadraticCurveTo(cx - rad * 0.94, domeTop, cx, domeTop);
    shape.quadraticCurveTo(cx + rad * 0.94, domeTop, cx + rad, base);
  } else {
    // A jagged line where the roof fell in.
    shape.quadraticCurveTo(cx - rad * 0.98, H * 0.22, cx - rad * 0.74, H * 0.14);
    const pts: [number, number][] = [[-0.6, 0.26], [-0.48, 0.1], [-0.32, 0.34], [-0.18, 0.2], [-0.02, 0.42], [0.12, 0.24], [0.28, 0.4], [0.42, 0.2], [0.58, 0.32], [0.72, 0.18]];
    for (const [t, y] of pts) shape.lineTo(cx + t * rad, H * y);
    shape.quadraticCurveTo(cx + rad * 0.98, H * 0.26, cx + rad, base);
  }
  shape.closePath();
  // Rows of arches round the drum.
  const arches = new Path2D();
  const n = 14;
  for (const row of [0.6, 0.44]) {
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const x = cx - rad * 0.92 + t * rad * 1.84;
      const y = H * row;
      if (!whole && y < H * (0.38 + Math.abs(t - 0.5) * -0.1)) continue;
      arches.moveTo(x - 12 * u, y + 30 * u);
      arches.lineTo(x - 12 * u, y);
      arches.quadraticCurveTo(x, y - 18 * u, x + 12 * u, y);
      arches.lineTo(x + 12 * u, y + 30 * u);
      arches.closePath();
    }
  }
  const ribs = new Path2D();
  if (whole)
    for (const d of [-0.66, -0.33, 0, 0.33, 0.66]) {
      ribs.moveTo(cx + d * rad, base);
      ribs.quadraticCurveTo(cx + d * rad * 0.9, H * 0.14, cx + d * 30 * u, domeTop);
    }
  const doors = new Path2D();
  doors.moveTo(cx - 58 * u, base);
  doors.lineTo(cx - 58 * u, base - 66 * u);
  doors.arc(cx, base - 66 * u, 58 * u, Math.PI, 0);
  doors.lineTo(cx + 58 * u, base);
  doors.closePath();
  const hill = ridge(c, base - 2 * u, 7 * u, 0.7);
  const weeds = new Path2D();
  for (let i = 0; i < Math.round(W / (3 * u)); i++) {
    const x = r() * W;
    const y = hill.y(x) + r() * (H - hill.y(x));
    weeds.moveTo(x, y);
    weeds.lineTo(x + (r() - 0.5) * 7 * u, y - (5 + r() * 12) * u);
  }
  const rubble = new Path2D();
  if (!whole)
    for (let i = 0; i < 26; i++) {
      const x = cx + (r() - 0.5) * rad * 2.2;
      const y = base + r() * 28 * u;
      const s = (6 + r() * 15) * u;
      poly(rubble, x - s, y + s * 0.5, x - s * 0.5, y - s * 0.7, x + s * 0.7, y - s * 0.4, x + s, y + s * 0.5);
    }
  const trees = new Path2D();
  if (!whole) for (const d of [-0.28, 0.2, 0.42]) leafy(trees, cx + d * rad, base - 30 * u, 54 * u);
  return {
    draw(g, E) {
      const stone: RGB = [176, 166, 150];
      fill(g, shape, lit(E, 0.54, stone, 0.82));
      stroke(g, ribs, lit(E, 0.4, mix(stone, [255, 240, 214], 0.2), 0.8), 3 * u, 0.7);
      if (!whole) stroke(g, shape, lit(E, 0.72, mix(stone, DARK, 0.3), 0.7), 2 * u, 0.5);
      fill(g, arches, tone(E, 0.96));
      fill(g, trees, tone(E, 0.66, [66, 104, 66], 0.7));
      // The bronze doors, green with age.
      fill(g, doors, lit(E, 0.58, [84, 110, 92], 0.8));
      stroke(g, doors, lit(E, 0.44, stone, 0.84), 6 * u);
      g.fillStyle = rgb(DARK, 0.5);
      g.fillRect(cx - 1.5 * u, base - 122 * u, 3 * u, 122 * u);
      fill(g, hill.p, tone(E, 0.72, [100, 118, 74], 0.62));
      fill(g, rubble, lit(E, 0.6, stone, 0.76));
      stroke(g, weeds, tone(E, 0.74, GRASS, 0.56), 1.2 * u, 0.7);
      if (E.c.snow > 0.2) fill(g, hill.p, [230, 234, 244], 0.5 * E.c.snow);
    },
  };
}

/** A tourney ground: the tilt rail, a covered stand in the colours, striped pavilions, pennants. */
function tiltyard(c: Ctx): Scene {
  const { W, H, u, F, r } = c;
  const far = ridge(c, H * 0.5, 13 * u, 0.6);
  const ground = ridge(c, H * 0.6, 3 * u);
  const hues: RGB[] = [[176, 40, 52], [40, 84, 140], [214, 170, 60], [46, 110, 80], [120, 60, 130]];
  // Pavilions along the far side of the field.
  const tents: { x: number; w: number; h: number; a: RGB; b: RGB; flag: RGB }[] = [];
  for (let x = F + 60 * u; x < W + 60 * u; x += (116 + r() * 46) * u) tents.push({ x, w: (50 + r() * 16) * u, h: (66 + r() * 22) * u, a: hues[(r() * hues.length) | 0]!, b: [232, 222, 200], flag: hues[(r() * hues.length) | 0]! });
  for (let x = F - 530 * u; x > -70 * u; x -= (116 + r() * 46) * u) tents.push({ x, w: (50 + r() * 16) * u, h: (66 + r() * 22) * u, a: hues[(r() * hues.length) | 0]!, b: [232, 222, 200], flag: hues[(r() * hues.length) | 0]! });
  // The lords' stand: tiers of benches under a striped canopy.
  const sx = F - 240 * u;
  const stand = new Path2D();
  for (let k = 0; k < 4; k++) stand.rect(sx - 210 * u, H * 0.56 - k * 15 * u, 420 * u, 12 * u);
  for (const d of [-204, -68, 68, 204]) stand.rect(sx + d * u - 3 * u, H * 0.18, 6 * u, H * 0.42);
  const canopy = [new Path2D(), new Path2D()];
  for (let i = 0; i < 12; i++) {
    const a = sx - 216 * u + i * 36 * u;
    poly(canopy[i % 2]!, a, H * 0.2, a + 36 * u, H * 0.2, a + 36 * u, H * 0.25, a + 18 * u, H * 0.28, a, H * 0.25);
    poly(canopy[i % 2]!, a + 8 * u, H * 0.1, a + 36 * u + 4 * u, H * 0.1, a + 36 * u, H * 0.2, a, H * 0.2);
  }
  const seats = Array.from({ length: 70 }, () => ({ x: sx + (r() - 0.5) * 400 * u, y: H * 0.56 - ((r() * 4) | 0) * 15 * u - 7 * u, c: hues[(r() * hues.length) | 0]! }));
  const y = H * 0.76;
  const rail = new Path2D();
  rail.rect(-10 * u, y, W + 20 * u, 7 * u);
  rail.rect(-10 * u, y + 24 * u, W + 20 * u, 4 * u);
  const stripes = new Path2D();
  for (let x = -10 * u; x < W; x += 46 * u) stripes.rect(x, y, 23 * u, 7 * u);
  const posts: number[] = [];
  for (let x = (F % (174 * u)) - 174 * u; x < W + 40 * u; x += 174 * u) posts.push(x);
  return {
    draw(g, E) {
      fill(g, far.p, tone(E, 0.26, GRASS, 0.44));
      fill(g, ground.p, tone(E, 0.55, [108, 150, 82], 0.76));
      const T = E.still ? 0 : E.T;
      for (const t of tents) {
        const by = H * 0.62;
        const cone = new Path2D();
        poly(cone, t.x - t.w, by, t.x, by - t.h, t.x + t.w, by);
        fill(g, cone, lit(E, 0.5, t.b, 0.86));
        g.save();
        g.clip(cone);
        g.fillStyle = rgb(lit(E, 0.5, t.a, 0.86));
        for (let k = -3; k <= 3; k += 2) {
          g.beginPath();
          g.moveTo(t.x, by - t.h);
          g.lineTo(t.x + (k * t.w) / 3, by);
          g.lineTo(t.x + ((k + 1) * t.w) / 3, by);
          g.fill();
        }
        g.restore();
        g.fillStyle = rgb(tone(E, 0.9));
        g.fillRect(t.x - 1 * u, by - t.h - 20 * u, 2 * u, 20 * u);
        g.fillStyle = rgb(lit(E, 0.44, t.flag, 0.88));
        poly2(g, t.x + 1 * u, by - t.h - 20 * u, t.x + 24 * u, by - t.h - 14 * u + Math.sin(T * 3 + t.x) * 2 * u, t.x + 1 * u, by - t.h - 8 * u);
        if (E.glow > 0.2) glowAt(g, t.x, by - 10 * u, 56 * u, WARM, 0.3 * E.glow);
      }
      fill(g, stand, lit(E, 0.62, [116, 86, 58], 0.82));
      for (const s of seats) {
        g.fillStyle = rgb(lit(E, 0.5, s.c, 0.8));
        g.beginPath();
        g.arc(s.x, s.y, 3.8 * u, 0, TAU);
        g.fill();
      }
      fill(g, canopy[0]!, lit(E, 0.4, [176, 40, 52], 0.88));
      fill(g, canopy[1]!, lit(E, 0.38, [232, 216, 180], 0.9));
      fill(g, rail, lit(E, 0.42, [232, 222, 196], 0.88));
      fill(g, stripes, lit(E, 0.46, [176, 40, 52], 0.88));
      for (const x of posts) {
        g.fillStyle = rgb(lit(E, 0.66, [106, 78, 54], 0.8));
        g.fillRect(x - 2.4 * u, y - 16 * u, 4.8 * u, 60 * u);
      }
    },
  };
}

export const CITY_SCENES = { fleabottom, greatsept, septsteps, dragonpit, tiltyard } satisfies Partial<Record<Place, (c: Ctx) => Scene>>;
