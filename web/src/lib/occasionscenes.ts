/**
 * Occasions, painted (docs/25-rooms-of-the-keep.md §4–5). A dressing goes over any of the places, so it
 * only uses three bands that work on all of them: what hangs from the top, what stands in the
 * foreground left of the room's subject, and the light. A stage is a full scene: a place chosen to suit,
 * with the same dressing grown up at its centre, or one painted for the occasion. No people up close;
 * a crowd is a dark edge at the foot of the picture.
 */
import { clamp, DARK, mix, rgb, TAU, WARM, type Ctx, type Env, type Place, type RGB } from "./places";
import { candle, tint, torchlight } from "./keepbits";
import { fill, glowAt, hillView, lamp, leafy, poly, ridge, room, GRASS, type Scene, tone, lit, stroke } from "./scenes";
import type { Occasion } from "./occasions";

type G = CanvasRenderingContext2D;
type Paint = (g: G, E: Env) => void;

const BRIGHT: RGB[] = [
  [224, 74, 96],
  [244, 180, 62],
  [66, 156, 214],
  [116, 190, 110],
  [176, 110, 206],
];
const WHITE: RGB = [240, 234, 222];
const LEAF: RGB = [76, 122, 70];
const BLOOM: RGB[] = [
  [244, 232, 220],
  [232, 170, 180],
  [240, 206, 130],
];

/** Points along swags hung across the picture from anchors out to both edges. */
function swags(c: Ctx, y: number, sag: number, span: number, step: number) {
  const { W, u, F } = c;
  const out: { x: number; y: number; a: number }[] = [];
  const w = span * u;
  for (let x0 = F - w * Math.ceil(F / w + 1); x0 < W + w; x0 += w)
    for (let x = 0; x < w; x += step * u) {
      const t = x / w;
      const yy = y + 4 * sag * u * t * (1 - t);
      out.push({ x: x0 + x, y: yy, a: Math.atan2(4 * sag * u * (1 - 2 * t), w) });
    }
  return out;
}

function bunting(c: Ctx, hues: RGB[], y = c.H * 0.07): Paint {
  const { u } = c;
  const line = swags(c, y, 26, 280, 26);
  const flags = hues.map(() => new Path2D());
  line.forEach((p, i) => poly(flags[i % hues.length]!, p.x - 9 * u, p.y, p.x + 9 * u, p.y, p.x, p.y + 20 * u));
  const cord = new Path2D();
  swags(c, y, 26, 280, 10).forEach((p, i) => (i && p.x > 0 ? cord.lineTo(p.x, p.y) : cord.moveTo(p.x, p.y)));
  return (g, E) => {
    stroke(g, cord, tint(E, [60, 50, 46], 0.3), 1 * u);
    flags.forEach((f, i) => fill(g, f, tint(E, hues[i]!, 0.42)));
  };
}

function lights(c: Ctx, y = c.H * 0.06): Paint {
  const { u } = c;
  const bulbs = swags(c, y, 30, 300, 26);
  const cord = new Path2D();
  swags(c, y, 30, 300, 10).forEach((p, i) => (i ? cord.lineTo(p.x, p.y) : cord.moveTo(p.x, p.y)));
  return (g, E) => {
    const on = clamp(E.glow * 1.3 + 0.12);
    stroke(g, cord, [26, 22, 24], 0.9 * u);
    for (const b of bulbs) {
      glowAt(g, b.x, b.y + 4 * u, 20 * u, WARM, 0.5 * on);
      g.fillStyle = rgb(mix(tint(E, [230, 224, 200], 0.3), [255, 232, 170], on));
      g.beginPath();
      g.arc(b.x, b.y + 4 * u, 2.4 * u, 0, TAU);
      g.fill();
    }
  };
}

function garland(c: Ctx, blooms: RGB[] = BLOOM, y = c.H * 0.06): Paint {
  const { u, r } = c;
  const leaves = swags(c, y, 34, 260, 5).map((p) => ({ x: p.x + (r() - 0.5) * 7 * u, y: p.y + (r() - 0.5) * 8 * u, a: r() * TAU }));
  const flowers = swags(c, y, 34, 260, 21).map((p, i) => ({ x: p.x, y: p.y + (r() - 0.5) * 5 * u, c: blooms[i % blooms.length]! }));
  return (g, E) => {
    g.fillStyle = rgb(tint(E, LEAF, 0.36));
    for (const l of leaves) {
      g.beginPath();
      g.ellipse(l.x, l.y, 6 * u, 3 * u, l.a, 0, TAU);
      g.fill();
    }
    for (const f of flowers) {
      g.fillStyle = rgb(tint(E, f.c, 0.5));
      g.beginPath();
      g.arc(f.x, f.y, 5.2 * u, 0, TAU);
      g.fill();
      g.fillStyle = rgb(tint(E, [226, 184, 90], 0.5));
      g.beginPath();
      g.arc(f.x, f.y, 1.8 * u, 0, TAU);
      g.fill();
    }
  };
}

/** Balloons on strings, rising from x; they bob in the live window. */
function balloons(c: Ctx, x: number, y: number, n: number): Paint {
  const { u, r } = c;
  const set = Array.from({ length: n }, (_, i) => ({ dx: (r() - 0.5) * 70 * u, dy: -(r() * 62 + 46) * u, c: BRIGHT[i % BRIGHT.length]!, p: r() * TAU, s: (15 + r() * 5) * u }));
  return (g, E) => {
    const T = E.still ? 0 : E.T;
    for (const b of set) {
      const bx = x + b.dx + Math.sin(T * 0.8 + b.p) * 2.5 * u;
      const by = y + b.dy + Math.sin(T * 1.1 + b.p) * 3 * u;
      g.strokeStyle = rgb(tint(E, [220, 214, 204], 0.34), 0.7);
      g.lineWidth = 0.8 * u;
      g.beginPath();
      g.moveTo(bx, by + b.s * 1.15);
      g.quadraticCurveTo(bx + 3 * u, (by + y) / 2 + 12 * u, x, y);
      g.stroke();
      g.fillStyle = rgb(tint(E, b.c, 0.5));
      g.beginPath();
      g.ellipse(bx, by, b.s * 0.86, b.s, 0, 0, TAU);
      g.fill();
      g.fillStyle = rgb([255, 255, 255], 0.28);
      g.beginPath();
      g.ellipse(bx - b.s * 0.3, by - b.s * 0.36, b.s * 0.18, b.s * 0.28, 0.4, 0, TAU);
      g.fill();
    }
  };
}

/** Petals or confetti over the floor; they drift down in the live window. */
function scatter(c: Ctx, hues: RGB[], n: number, top: number, size = 2.4): Paint {
  const { W, H, u, r } = c;
  const bits = Array.from({ length: n }, () => ({ x: r() * W, y: top + r() * (H - top), a: r() * TAU, c: hues[(r() * hues.length) | 0]!, v: 6 + r() * 12 }));
  return (g, E) => {
    const T = E.still ? 0 : E.T;
    for (const b of bits) {
      g.fillStyle = rgb(tint(E, b.c, 0.5), 0.9);
      g.beginPath();
      const y = top + ((b.y - top + T * b.v * u) % (H - top));
      g.ellipse(b.x, y, size * u, size * 0.55 * u, b.a + T, 0, TAU);
      g.fill();
    }
  };
}

/** A table in the foreground: its cloth falls past the foot of the picture. */
function table(c: Ctx, x: number, half: number, top: number, cloth: RGB): Paint {
  const { H, u } = c;
  const shape = new Path2D();
  shape.moveTo(x - half, top);
  shape.lineTo(x + half, top);
  shape.lineTo(x + half + 5 * u, H + 2);
  shape.lineTo(x - half - 5 * u, H + 2);
  shape.closePath();
  const folds = new Path2D();
  for (let fx = x - half + 20 * u; fx < x + half; fx += 34 * u) {
    folds.moveTo(fx, top + 7 * u);
    folds.lineTo(fx + (fx - x) * 0.04, H);
  }
  const swag = new Path2D();
  const n = Math.max(3, Math.round((half * 2) / (52 * u)));
  const sw = (half * 2) / n;
  swag.moveTo(x - half, top);
  for (let i = 0; i < n; i++) swag.quadraticCurveTo(x - half + sw * (i + 0.5), top + 30 * u, x - half + sw * (i + 1), top);
  swag.closePath();
  const pins: number[] = [];
  for (let i = 0; i <= n; i++) pins.push(x - half + sw * i);
  return (g, E) => {
    glowAt(g, x, top + 20 * u, half * 1.5, WARM, 0.14 * clamp(E.glow * 1.2));
    const base = tint(E, cloth, 0.36);
    const fall = g.createLinearGradient(0, top, 0, H);
    fall.addColorStop(0, rgb(base));
    fall.addColorStop(1, rgb(mix(base, DARK, 0.52)));
    g.fillStyle = fall;
    g.fill(shape);
    stroke(g, folds, DARK, 2.4 * u, 0.13);
    // The swagged top cloth, a deeper tone of the room's own colour.
    fill(g, swag, tint(E, mix(cloth, c.home?.fabric ?? [176, 70, 92], 0.55), 0.4));
    stroke(g, swag, tint(E, [226, 196, 130], 0.42), 1.2 * u, 0.7);
    g.fillStyle = rgb(mix(tint(E, cloth, 0.48), [255, 250, 240], 0.2));
    g.fillRect(x - half, top - 0.5 * u, half * 2, 3 * u);
    g.fillStyle = rgb(tint(E, [226, 196, 130], 0.46));
    for (const px of pins) {
      g.beginPath();
      g.arc(px, top + 1.5 * u, 2.6 * u, 0, TAU);
      g.fill();
    }
  };
}

/** A cake of some tiers with candles on top. */
function cake(g: G, E: Env, x: number, y: number, u: number, tiers: number, icing: RGB, trim: RGB, candles = 5) {
  let w = 34 + tiers * 10;
  let yy = y;
  g.fillStyle = rgb(tint(E, [196, 190, 182], 0.42));
  g.fillRect(x - (w + 8) * u, y - 2 * u, (w + 8) * 2 * u, 2.4 * u);
  for (let i = 0; i < tiers; i++) {
    const h = 19 * u;
    g.fillStyle = rgb(tint(E, icing, 0.5));
    g.fillRect(x - w * u, yy - h, w * 2 * u, h);
    g.fillStyle = rgb(tint(E, trim, 0.5));
    for (let d = -w + 5; d < w; d += 9) {
      g.beginPath();
      g.arc(x + d * u, yy - h + 1 * u, 3.3 * u, 0, Math.PI);
      g.fill();
    }
    g.fillStyle = rgb(DARK, 0.1);
    g.fillRect(x + w * 0.45 * u, yy - h, w * 0.55 * u, h);
    yy -= h;
    w *= 0.68;
  }
  for (let i = 0; i < candles; i++) candle(g, E, x + (i - (candles - 1) / 2) * ((w * 1.9) / Math.max(1, candles)) * u, yy, u, 8, 0.5);
}

function gift(g: G, E: Env, x: number, y: number, s: number, box: RGB, ribbon: RGB) {
  g.fillStyle = rgb(tint(E, box, 0.44));
  g.fillRect(x - s, y - s * 1.5, s * 2, s * 1.5);
  g.fillStyle = rgb(tint(E, ribbon, 0.5));
  g.fillRect(x - s * 0.14, y - s * 1.5, s * 0.28, s * 1.5);
  g.fillRect(x - s, y - s * 0.86, s * 2, s * 0.24);
  g.beginPath();
  g.ellipse(x - s * 0.28, y - s * 1.6, s * 0.3, s * 0.15, 0.4, 0, TAU);
  g.ellipse(x + s * 0.28, y - s * 1.6, s * 0.3, s * 0.15, -0.4, 0, TAU);
  g.fill();
}

function setting(g: G, E: Env, x: number, y: number, u: number, old: boolean) {
  g.fillStyle = rgb(tint(E, old ? [176, 166, 148] : [238, 234, 226], 0.46));
  g.beginPath();
  g.ellipse(x, y - 1 * u, 13 * u, 3 * u, 0, 0, TAU);
  g.fill();
  if (old) {
    g.fillStyle = rgb(tint(E, [196, 156, 84], 0.5));
    poly2(g, x + 18 * u, y, x + 24 * u, y, x + 23 * u, y - 5 * u, x + 26 * u, y - 16 * u, x + 16 * u, y - 16 * u, x + 19 * u, y - 5 * u);
  } else {
    g.strokeStyle = rgb(tint(E, [220, 226, 232], 0.5));
    g.lineWidth = 1 * u;
    g.beginPath();
    g.moveTo(x + 20 * u, y);
    g.lineTo(x + 20 * u, y - 9 * u);
    g.stroke();
    g.fillStyle = rgb(tint(E, [136, 34, 56], 0.5));
    g.beginPath();
    g.ellipse(x + 20 * u, y - 13 * u, 4 * u, 5 * u, 0, 0, TAU);
    g.fill();
  }
}
function poly2(g: G, ...pts: number[]) {
  const p = new Path2D();
  poly(p, ...pts);
  g.fill(p);
}

function lilies(g: G, E: Env, x: number, y: number, u: number) {
  g.fillStyle = rgb(tint(E, [74, 76, 90], 0.36));
  poly2(g, x - 11 * u, y, x + 11 * u, y, x + 15 * u, y - 34 * u, x - 15 * u, y - 34 * u);
  g.strokeStyle = rgb(tint(E, LEAF, 0.36));
  g.lineWidth = 1.5 * u;
  const heads = [[-26, -74], [-12, -92], [4, -100], [18, -84], [30, -66], [-4, -70]];
  g.beginPath();
  for (const [dx, dy] of heads) {
    g.moveTo(x, y - 34 * u);
    g.quadraticCurveTo(x + dx! * 0.3 * u, y + dy! * 0.7 * u, x + dx! * u, y + dy! * u);
  }
  g.stroke();
  for (const [dx, dy] of heads) {
    const hx = x + dx! * u;
    const hy = y + dy! * u;
    g.fillStyle = rgb(tint(E, WHITE, 0.52));
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * TAU;
      g.beginPath();
      g.ellipse(hx + Math.cos(a) * 5 * u, hy + Math.sin(a) * 5 * u, 5.4 * u, 2.4 * u, a, 0, TAU);
      g.fill();
    }
    g.fillStyle = rgb(tint(E, [226, 178, 80], 0.5));
    g.beginPath();
    g.arc(hx, hy, 1.8 * u, 0, TAU);
    g.fill();
  }
}

/** The dark edge of a crowd along the foot of the picture. */
function crowd(c: Ctx, cups: boolean): Paint {
  const { W, H, u, r } = c;
  const p = new Path2D();
  const back = new Path2D();
  const person = (q: Path2D, x: number, h: number, s: number) => {
    const y = H - h;
    q.moveTo(x + 8 * s * u, y);
    q.arc(x, y, 8 * s * u, 0, TAU);
    q.moveTo(x - 17 * s * u, H + 2);
    q.quadraticCurveTo(x - 19 * s * u, y + 15 * s * u, x, y + 11 * s * u);
    q.quadraticCurveTo(x + 19 * s * u, y + 15 * s * u, x + 17 * s * u, H + 2);
    q.closePath();
    if (r() < 0.22) {
      const hand = (r() < 0.5 ? -1 : 1) * 20 * s * u;
      poly(q, x + hand * 0.45, y + 16 * s * u, x + hand, y - 15 * s * u, x + hand * 1.22, y - 14 * s * u, x + hand * 0.85, y + 20 * s * u);
      if (cups) q.rect(x + hand - 2 * s * u, y - 23 * s * u, 6 * s * u, 8 * s * u);
    }
  };
  for (let x = -10 * u; x < W + 20 * u; x += (36 + r() * 40) * u) person(back, x, (44 + r() * 22) * u, 0.86);
  for (let x = -24 * u; x < W + 20 * u; x += (52 + r() * 70) * u) person(p, x, (24 + r() * 18) * u, 1.12);
  return (g) => {
    fill(g, back, [34, 26, 40], 0.86);
    fill(g, p, [12, 9, 16], 0.96);
  };
}

function wash(c: Ctx, hue: RGB, a: number): Paint {
  return (g) => {
    g.fillStyle = rgb(hue, a);
    g.fillRect(0, 0, c.W, c.H);
  };
}

/** Pools of coloured party light; they wander in the live window. */
function discoLights(c: Ctx): Paint {
  const { W, H, u, r } = c;
  const spots = Array.from({ length: Math.ceil(W / (150 * u)) }, (_, i) => ({ x: r() * W, y: H * (0.2 + r() * 0.5), c: BRIGHT[i % BRIGHT.length]!, p: r() * TAU }));
  return (g, E) => {
    const T = E.still ? 0 : E.T;
    const a = 0.2 + 0.2 * clamp(E.glow);
    g.save();
    g.globalCompositeOperation = "screen";
    for (const s of spots) glowAt(g, s.x + Math.sin(T * 0.7 + s.p) * 60 * u, s.y + Math.cos(T * 0.5 + s.p) * 24 * u, 150 * u, s.c, a);
    g.restore();
  };
}

/** A many-candled ring on its chain. */
function chandelier(g: G, E: Env, x: number, y: number, u: number, n = 5) {
  const on = torchlight(E);
  g.strokeStyle = "rgb(30,26,26)";
  g.lineWidth = 1.2 * u;
  g.beginPath();
  g.moveTo(x, 0);
  g.lineTo(x, y);
  g.stroke();
  g.fillStyle = rgb(tint(E, [176, 146, 90], 0.42));
  g.beginPath();
  g.ellipse(x, y, (n * 8 + 6) * u, 5 * u, 0, 0, TAU);
  g.fill();
  glowAt(g, x, y, 170 * u, WARM, 0.36 * on);
  for (let i = 0; i < n; i++) {
    const cx = x + (i - (n - 1) / 2) * 15 * u;
    g.fillStyle = rgb([255, 226, 150], 0.5 + on * 0.5);
    g.beginPath();
    g.ellipse(cx, y - 8 * u, 1.6 * u, 3.8 * u, 0, 0, TAU);
    g.fill();
  }
}

/** A mirror ball, and the flecks of light it throws round the room. */
function mirrorBall(c: Ctx, x: number, y: number): Paint {
  const { W, H, u, r } = c;
  const flecks = Array.from({ length: Math.round(W / (9 * u)) }, () => ({ a: r() * W, b: r() * H * 0.82, p: r() * TAU, s: (1 + r() * 1.6) * u }));
  const rad = 18 * u;
  return (g, E) => {
    const T = E.still ? 0 : E.T;
    for (const f of flecks) {
      g.fillStyle = rgb([255, 250, 236], (0.28 + E.glow * 0.42) * (0.5 + 0.5 * Math.sin(T * 1.4 + f.p)));
      g.fillRect((f.a + T * 14 * u) % W, f.b, f.s, f.s);
    }
    g.strokeStyle = "rgb(40,36,40)";
    g.lineWidth = 1 * u;
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, y - rad);
    g.stroke();
    const lg = g.createRadialGradient(x - 5 * u, y - 6 * u, 1, x, y, rad);
    lg.addColorStop(0, "rgb(246,246,252)");
    lg.addColorStop(1, "rgb(96,100,124)");
    g.fillStyle = lg;
    g.beginPath();
    g.arc(x, y, rad, 0, TAU);
    g.fill();
    g.strokeStyle = "rgba(20,20,40,.32)";
    g.lineWidth = 0.7 * u;
    g.beginPath();
    for (let k = -3; k <= 3; k++) {
      const half = Math.sqrt(Math.max(0, rad * rad - (k * 5 * u) ** 2));
      g.moveTo(x - half, y + k * 5 * u);
      g.lineTo(x + half, y + k * 5 * u);
    }
    g.stroke();
  };
}

/** Long swagged drapes of cloth from the top of the picture. */
function drapery(c: Ctx, hue: RGB): Paint {
  const { W, H, u, F } = c;
  const shape = new Path2D();
  const span = 240 * u;
  for (let x = F - span * Math.ceil(F / span + 1); x < W + span; x += span) {
    shape.moveTo(x, -2);
    shape.lineTo(x, H * 0.14);
    shape.quadraticCurveTo(x + span / 2, H * 0.34, x + span, H * 0.14);
    shape.lineTo(x + span, -2);
    shape.closePath();
  }
  return (g, E) => {
    fill(g, shape, tint(E, hue, 0.36));
    stroke(g, shape, tint(E, [214, 176, 96], 0.4), 1.6 * u, 0.8);
  };
}

/** A paper lantern on a line. */
function lanterns(c: Ctx, y = c.H * 0.12): Paint {
  const { u } = c;
  const at = swags(c, y, 22, 240, 42);
  return (g, E) => {
    const on = clamp(E.glow * 1.3);
    at.forEach((p, i) => {
      const hue = BRIGHT[i % BRIGHT.length]!;
      glowAt(g, p.x, p.y + 12 * u, 34 * u, hue, 0.36 * on);
      g.fillStyle = rgb(mix(tint(E, hue, 0.42), mix(hue, [255, 236, 190], 0.5), on));
      g.beginPath();
      g.ellipse(p.x, p.y + 12 * u, 9 * u, 11 * u, 0, 0, TAU);
      g.fill();
    });
  };
}

/** A striped stall with goods on its counter. */
function stall(g: G, E: Env, x: number, y: number, u: number, hue: RGB) {
  g.fillStyle = rgb(tint(E, [106, 78, 54], 0.34));
  g.fillRect(x - 52 * u, y - 64 * u, 4 * u, 70 * u);
  g.fillRect(x + 48 * u, y - 64 * u, 4 * u, 70 * u);
  for (let k = 0; k < 6; k++) {
    g.fillStyle = rgb(tint(E, k % 2 ? [236, 230, 216] : hue, 0.44));
    const a = x - 60 * u + k * 20 * u;
    poly2(g, a, y - 62 * u, a + 20 * u, y - 62 * u, a + 16 * u, y - 86 * u, a + 4 * u, y - 86 * u);
  }
  g.fillStyle = rgb(tint(E, [132, 96, 66], 0.38));
  g.fillRect(x - 56 * u, y - 18 * u, 112 * u, 24 * u);
  for (let k = 0; k < 5; k++) {
    g.fillStyle = rgb(tint(E, BRIGHT[(k * 3) % BRIGHT.length]!, 0.46));
    g.beginPath();
    g.arc(x - 38 * u + k * 19 * u, y - 23 * u, 6 * u, 0, TAU);
    g.fill();
  }
}

/** What an occasion lays over a place. At a stage it stands at the centre, larger. */
function dressing(c: Ctx, id: Occasion, old: boolean, stage: boolean, indoors: boolean): Paint {
  const { H, u, F } = c;
  const tx = stage ? F : F - 250 * u;
  const top = H * 0.72;
  const half = (stage ? 170 : 118) * u;
  const parts: Paint[] = [];
  const add = (p: Paint) => parts.push(p);
  // Outdoors, something has to hold up what hangs.
  if (!indoors && !stage && id !== "funeral") {
    const poles = new Path2D();
    for (let x = F - 840 * u; x < c.W + 280 * u; x += 280 * u) poles.rect(x, H * 0.05, 3 * u, H);
    add((g, E) => fill(g, poles, tint(E, [86, 66, 50], 0.3)));
  }
  switch (id) {
    case "birthday": {
      if (old) {
        add(garland(c));
        add(table(c, tx, half, top, [122, 74, 58]));
        add(scatter(c, BLOOM, 26, H * 0.82));
        add((g, E) => {
          cake(g, E, tx, top, u, 2, [214, 170, 96], [232, 214, 170], 5);
          gift(g, E, tx - half * 0.7, top, 15 * u, [96, 60, 44], [214, 182, 110]);
          gift(g, E, tx + half * 0.68, top, 13 * u, [66, 84, 110], [224, 206, 164]);
          candle(g, E, tx - half * 0.34, top, u, 15);
          candle(g, E, tx + half * 0.34, top, u, 15);
        });
      } else {
        add(bunting(c, BRIGHT));
        add(balloons(c, tx - half - 34 * u, top + 6 * u, 5));
        add(balloons(c, tx + half + 34 * u, top + 6 * u, 4));
        add(scatter(c, BRIGHT, stage ? 70 : 42, H * 0.18, 1.6));
        add(table(c, tx, half, top, [236, 226, 216]));
        add((g, E) => {
          cake(g, E, tx, top, u, 2, [240, 202, 214], [226, 94, 124], 7);
          gift(g, E, tx - half * 0.66, top, 17 * u, [66, 156, 214], [244, 226, 120]);
          gift(g, E, tx - half * 0.38, top, 11 * u, [224, 74, 96], [250, 240, 230]);
          gift(g, E, tx + half * 0.66, top, 15 * u, [116, 190, 110], [224, 74, 96]);
        });
      }
      break;
    }
    case "wedding": {
      add(garland(c, [[244, 238, 226], [246, 226, 226], [240, 226, 180]]));
      add(scatter(c, [[246, 236, 232], [238, 196, 204]], stage ? 90 : 50, H * 0.8, 3));
      if (!stage || old) {
        const cloak = new Path2D();
        poly(cloak, tx - 54 * u, H * 0.8, tx + 54 * u, H * 0.8, tx + 66 * u, H + 2, tx - 66 * u, H + 2);
        add((g, E) => {
          if (old) {
            fill(g, cloak, tint(E, c.home?.keep?.banners?.[0] ?? [214, 196, 150], 0.44));
            g.fillStyle = rgb(tint(E, [230, 210, 160], 0.5));
            g.fillRect(tx - 54 * u, H * 0.8, 108 * u, 3 * u);
          }
          for (const s of [-1, 1]) {
            const x = tx + s * (stage ? 160 : 96) * u;
            g.fillStyle = rgb(tint(E, old ? [40, 34, 34] : [226, 220, 208], 0.34));
            g.fillRect(x - 2 * u, H * 0.56, 4 * u, H * 0.44);
            g.fillRect(x - 13 * u, H * 0.55, 26 * u, 4 * u);
            if (old) {
              for (const d of [-9, 0, 9]) candle(g, E, x + d * u, H * 0.55, u, 12, 0.6);
            } else {
              for (let k = 0; k < 9; k++) {
                g.fillStyle = rgb(tint(E, k % 3 ? [244, 236, 226] : [236, 190, 200], 0.52));
                g.beginPath();
                g.arc(x + Math.cos(k * 2.4) * 15 * u * ((k % 3) / 2.5 + 0.2), H * 0.5 + Math.sin(k * 2.4) * 15 * u * ((k % 3) / 2.5 + 0.2), 5.6 * u, 0, TAU);
                g.fill();
              }
            }
          }
        });
      }
      break;
    }
    case "reception": {
      if (old) {
        add(garland(c));
        add(table(c, tx, half * 1.3, top, [226, 214, 190]));
        add((g, E) => {
          // The great pie, a whole bird's worth.
          g.fillStyle = rgb(tint(E, [186, 132, 70], 0.54));
          g.beginPath();
          g.ellipse(tx, top - 12 * u, 48 * u, 21 * u, 0, Math.PI, TAU);
          g.fill();
          g.fillRect(tx - 48 * u, top - 12 * u, 96 * u, 12 * u);
          g.strokeStyle = rgb(tint(E, [120, 78, 40], 0.46));
          g.lineWidth = 1.4 * u;
          g.beginPath();
          for (let d = -36; d <= 36; d += 18) {
            g.moveTo(tx + d * u, top - 30 * u + Math.abs(d) * 0.3 * u);
            g.lineTo(tx + d * 1.2 * u, top - 10 * u);
          }
          g.stroke();
          for (const d of [-1, 1]) {
            setting(g, E, tx + d * half * 0.86, top, u, true);
            candle(g, E, tx + d * half * 0.56, top, u, 18);
            setting(g, E, tx + d * half * 1.1, top, u, true);
          }
        });
      } else {
        add(lights(c));
        add(garland(c, [[244, 238, 226], [246, 226, 226]], H * 0.14));
        add(table(c, tx, half, top, [240, 236, 228]));
        add((g, E) => {
          cake(g, E, tx, top, u, 3, [246, 240, 232], [214, 196, 170], 0);
          for (const d of [-1, 1]) {
            setting(g, E, tx + d * half * 0.7, top, u, false);
            candle(g, E, tx + d * half * 0.44, top, u, 14, 0.7);
          }
        });
      }
      break;
    }
    case "party": {
      if (old) {
        add(wash(c, [255, 150, 70], 0.07));
        add(bunting(c, [c.home?.keep?.banners?.[0] ?? [150, 60, 50], [214, 186, 120]]));
        add(crowd(c, true));
      } else {
        add(wash(c, [20, 12, 40], indoors ? 0.3 : 0.12));
        add(discoLights(c));
        add(lights(c));
        add(crowd(c, true));
      }
      break;
    }
    case "dinnerparty": {
      add(table(c, tx, half * (stage ? 1.5 : 1.15), top, old ? [170, 150, 120] : [238, 232, 222]));
      const n = stage ? 7 : 4;
      const seats = Array.from({ length: n }, (_, i) => tx + ((i - (n - 1) / 2) * (half * 2.3)) / n);
      add((g, E) => {
        for (const x of seats) setting(g, E, x, top, u, old);
        for (const x of seats.slice(0, -1)) candle(g, E, x + (seats[1]! - seats[0]!) / 2, top, u, 17, 0.72);
        if (old) {
          g.fillStyle = rgb(tint(E, [150, 96, 50], 0.56));
          g.beginPath();
          g.ellipse(tx, top - 11 * u, 32 * u, 13 * u, 0, 0, TAU);
          g.fill();
        }
      });
      break;
    }
    case "anniversary": {
      add(table(c, tx, (stage ? 96 : 76) * u, top, old ? [150, 90, 74] : [236, 226, 218]));
      if (!old) add(lights(c));
      add(scatter(c, [[190, 40, 60], [214, 70, 84]], 16, H * 0.84, 2.8));
      add((g, E) => {
        for (const d of [-1, 1]) setting(g, E, tx + d * 40 * u, top, u, old);
        candle(g, E, tx - 9 * u, top, u, 22);
        // Roses in a little jar.
        g.fillStyle = rgb(tint(E, [150, 170, 190], 0.42));
        poly2(g, tx + 6 * u, top, tx + 18 * u, top, tx + 20 * u, top - 16 * u, tx + 4 * u, top - 16 * u);
        for (let k = 0; k < 6; k++) {
          g.fillStyle = rgb(tint(E, [186, 34, 56], 0.5));
          g.beginPath();
          g.arc(tx + 12 * u + Math.cos(k * 2.4) * 8 * u, top - 24 * u + Math.sin(k * 2.4) * 6 * u, 4.6 * u, 0, TAU);
          g.fill();
        }
      });
      break;
    }
    case "ball": {
      add(drapery(c, c.home?.keep?.banners?.[0] ?? (old ? [120, 40, 56] : [90, 60, 130])));
      if (old) {
        add(wash(c, [255, 170, 90], 0.05));
        const at: number[] = [];
        for (let x = F - 360 * u * Math.ceil(F / (360 * u)); x < c.W; x += 360 * u) at.push(x);
        add((g, E) => {
          for (const x of at) chandelier(g, E, x, H * 0.2, u);
        });
        add(table(c, F - 300 * u, 78 * u, H * 0.8, [86, 60, 90]));
        add((g, E) => {
          for (const d of [-44, 0, 44]) {
            const mx = F - 300 * u + d * u;
            g.fillStyle = rgb(tint(E, BLOOM[Math.abs(d) % 3]!, 0.5));
            g.beginPath();
            g.ellipse(mx, H * 0.8 - 7 * u, 15 * u, 8 * u, 0, 0, TAU);
            g.fill();
            g.fillStyle = "rgb(20,16,22)";
            for (const s of [-1, 1]) {
              g.beginPath();
              g.ellipse(mx + s * 6.5 * u, H * 0.8 - 8 * u, 3.8 * u, 2.4 * u, 0, 0, TAU);
              g.fill();
            }
          }
        });
      } else {
        add(wash(c, [28, 18, 60], indoors ? 0.26 : 0.1));
        add(discoLights(c));
        add(mirrorBall(c, F, H * 0.24));
        add(balloons(c, F - 300 * u, H * 0.92, 5));
        add(balloons(c, F + 170 * u, H * 0.92, 4));
      }
      if (stage) add(crowd(c, false));
      break;
    }
    case "festival": {
      add(bunting(c, BRIGHT));
      add(lanterns(c));
      if (stage && !old) {
        // A wheel turning over the town, lit from dusk.
        const wx = F - 420 * u;
        const wy = H * 0.42;
        const R = 92 * u;
        add((g, E) => {
          const T = E.still ? 0 : E.T * 0.08;
          g.strokeStyle = rgb(mix(tint(E, [150, 150, 176], 0.4), [255, 214, 150], clamp(E.glow) * 0.7));
          g.lineWidth = 2.4 * u;
          g.beginPath();
          g.arc(wx, wy, R, 0, TAU);
          g.moveTo(wx - 50 * u, H * 0.84);
          g.lineTo(wx, wy);
          g.lineTo(wx + 50 * u, H * 0.84);
          for (let k = 0; k < 12; k++) {
            const a = T + (k / 12) * TAU;
            g.moveTo(wx, wy);
            g.lineTo(wx + Math.cos(a) * R, wy + Math.sin(a) * R);
          }
          g.stroke();
          for (let k = 0; k < 12; k++) {
            const a = T + (k / 12) * TAU;
            const x = wx + Math.cos(a) * R;
            const y = wy + Math.sin(a) * R;
            g.fillStyle = rgb(mix(tint(E, BRIGHT[k % BRIGHT.length]!, 0.42), [255, 226, 150], clamp(E.glow) * 0.55));
            g.fillRect(x - 6 * u, y, 12 * u, 11 * u);
            if (E.glow > 0.2) glowAt(g, x, y, 15 * u, WARM, 0.4 * E.glow);
          }
        });
      }
      if (old && stage) {
        const mx = F - 330 * u;
        add((g, E) => {
          g.fillStyle = rgb(tint(E, [150, 118, 80], 0.36));
          g.fillRect(mx - 3 * u, H * 0.1, 6 * u, H * 0.9);
          g.lineWidth = 1.8 * u;
          BRIGHT.forEach((hue, i) => {
            g.strokeStyle = rgb(tint(E, hue, 0.46));
            g.beginPath();
            g.moveTo(mx, H * 0.1);
            g.quadraticCurveTo(mx + (i - 2) * 22 * u, H * 0.24, mx + (i - 2) * 62 * u, H * 0.6);
            g.stroke();
          });
          g.fillStyle = rgb(tint(E, LEAF, 0.38));
          g.beginPath();
          g.ellipse(mx, H * 0.1, 16 * u, 8 * u, 0, 0, TAU);
          g.fill();
        });
      }
      add((g, E) => {
        const y = H * 0.96;
        stall(g, E, F - (stage ? 170 : 250) * u, y, u, [196, 60, 66]);
        stall(g, E, F - (stage ? 640 : 520) * u, y, u, [60, 120, 170]);
        if (stage) stall(g, E, F + 150 * u, y, u, [214, 150, 50]);
      });
      break;
    }
    case "coronation": {
      add(drapery(c, c.home?.keep?.banners?.[0] ?? (old ? [120, 26, 44] : [34, 58, 110])));
      add(scatter(c, [[230, 190, 90], [236, 226, 200]], stage ? 40 : 22, H * 0.84, 2.2));
      const cx = stage ? F : F - 250 * u;
      add((g, E) => {
        // A plinth, a cushion, a crown; for an inauguration a lectern with a seal.
        g.fillStyle = rgb(tint(E, old ? [120, 106, 92] : [76, 56, 44], 0.38));
        g.fillRect(cx - 34 * u, H * 0.76, 68 * u, H * 0.26);
        g.fillStyle = rgb(tint(E, old ? [150, 134, 116] : [108, 80, 60], 0.42));
        g.fillRect(cx - 42 * u, H * 0.74, 84 * u, 6 * u);
        if (old) {
          g.fillStyle = rgb(tint(E, [150, 28, 44], 0.46));
          g.beginPath();
          g.ellipse(cx, H * 0.72, 40 * u, 11 * u, 0, 0, TAU);
          g.fill();
          g.fillStyle = rgb(tint(E, [226, 180, 80], 0.6));
          poly2(g, cx - 22 * u, H * 0.7, cx + 22 * u, H * 0.7, cx + 26 * u, H * 0.7 - 30 * u, cx + 13 * u, H * 0.7 - 13 * u, cx + 7 * u, H * 0.7 - 34 * u, cx, H * 0.7 - 15 * u, cx - 7 * u, H * 0.7 - 34 * u, cx - 13 * u, H * 0.7 - 13 * u, cx - 26 * u, H * 0.7 - 30 * u);
          for (const d of [-14, 0, 14]) {
            g.fillStyle = rgb(tint(E, BRIGHT[Math.abs(d) % 3]!, 0.6));
            g.beginPath();
            g.arc(cx + d * u, H * 0.7 - 5 * u, 2.4 * u, 0, TAU);
            g.fill();
          }
          glowAt(g, cx, H * 0.66, 80 * u, [255, 214, 130], 0.22);
        } else {
          g.fillStyle = rgb(tint(E, [226, 190, 110], 0.56));
          g.beginPath();
          g.arc(cx, H * 0.86, 16 * u, 0, TAU);
          g.fill();
          for (const s of [-1, 1]) {
            const fx = cx + s * 96 * u;
            g.fillStyle = rgb(tint(E, [200, 196, 190], 0.44));
            g.fillRect(fx - 1.4 * u, H * 0.22, 2.8 * u, H * 0.8);
            g.fillStyle = rgb(tint(E, s < 0 ? [176, 40, 56] : [40, 70, 140], 0.46));
            poly2(g, fx, H * 0.24, fx + s * 56 * u, H * 0.3, fx + s * 50 * u, H * 0.5, fx, H * 0.52);
          }
        }
        for (const s of [-1, 1]) for (let k = 0; k < 4; k++) candle(g, E, cx + s * (66 + k * 13) * u, H - (k % 2) * 9 * u, u, 16 + k * 6, 0.5);
      });
      if (stage) add(crowd(c, false));
      break;
    }
    case "contest": {
      const hues: RGB[] = old ? [[176, 40, 52], [226, 196, 110], [40, 84, 140]] : [[30, 90, 176], [240, 236, 226]];
      add(bunting(c, hues));
      if (old) {
        // The tilt: a long striped rail across the ground, with pennants on its posts.
        const y = H * 0.74;
        const rail = new Path2D();
        rail.rect(-10 * u, y, c.W + 20 * u, 6 * u);
        rail.rect(-10 * u, y + 22 * u, c.W + 20 * u, 4 * u);
        const stripes = new Path2D();
        for (let x = -10 * u; x < c.W; x += 44 * u) stripes.rect(x, y, 22 * u, 6 * u);
        const posts: number[] = [];
        for (let x = F - 880 * u; x < c.W; x += 176 * u) if (x > -10 * u) posts.push(x);
        add((g, E) => {
          fill(g, rail, tint(E, [226, 214, 186], 0.42));
          fill(g, stripes, tint(E, hues[0]!, 0.44));
          for (const x of posts) {
            g.fillStyle = rgb(tint(E, [106, 78, 54], 0.36));
            g.fillRect(x - 2 * u, y - 72 * u, 4 * u, 112 * u);
            const T = E.still ? 0 : E.T;
            const flap = Math.sin(T * 3 + x) * 4 * u * (0.4 + E.c.wind);
            g.fillStyle = rgb(tint(E, hues[Math.round(x / u) % 3 === 0 ? 2 : 1]!, 0.46));
            poly2(g, x + 2 * u, y - 72 * u, x + 36 * u, y - 62 * u + flap, x + 2 * u, y - 52 * u);
          }
        });
      }
      if (stage && old) add(crowd(c, false));
      break;
    }
    case "execution": {
      add(wash(c, [34, 34, 44], 0.2));
      if (indoors) {
        add(drapery(c, [24, 20, 26]));
        break;
      }
      const sx = stage ? F : F - 260 * u;
      const y = H * 0.68;
      const deck = new Path2D();
      deck.rect(sx - 130 * u, y, 260 * u, 9 * u);
      for (const d of [-122, -44, 36, 114]) deck.rect(sx + d * u, y + 9 * u, 8 * u, H);
      const brace = new Path2D();
      brace.moveTo(sx - 118 * u, H);
      brace.lineTo(sx - 40 * u, y + 9 * u);
      brace.moveTo(sx + 118 * u, H);
      brace.lineTo(sx + 40 * u, y + 9 * u);
      const crows = new Path2D();
      for (const [dx, dy] of [[-150, -130], [-126, -148], [140, -112]] as const) {
        crows.moveTo(sx + (dx + 7) * u, y + dy * u);
        crows.ellipse(sx + dx * u, y + dy * u, 7 * u, 2.6 * u, 0, 0, TAU);
      }
      add((g, E) => {
        fill(g, crows, [14, 12, 16]);
        for (const s of [-1, 1]) {
          const bx = sx + s * 106 * u;
          g.fillStyle = rgb(tint(E, [70, 56, 44], 0.3));
          g.fillRect(bx - 2 * u, y - 112 * u, 4 * u, 114 * u);
          const shape = new Path2D();
          poly(shape, bx - 19 * u, y - 112 * u, bx + 19 * u, y - 112 * u, bx + 19 * u, y - 44 * u, bx, y - 56 * u, bx - 19 * u, y - 44 * u);
          fill(g, shape, tint(E, c.home?.keep?.banners?.[0] ?? [60, 26, 34], 0.34));
        }
        stroke(g, brace, tint(E, [60, 46, 36], 0.28), 5 * u);
        fill(g, deck, tint(E, [78, 60, 46], 0.32));
        // The block, standing empty.
        g.fillStyle = rgb(tint(E, [62, 46, 38], 0.32));
        poly2(g, sx - 21 * u, y, sx + 21 * u, y, sx + 18 * u, y - 25 * u, sx - 18 * u, y - 25 * u);
        g.fillStyle = rgb(DARK, 0.24);
        g.fillRect(sx - 18 * u, y - 25 * u, 36 * u, 3 * u);
      });
      add(crowd(c, false));
      break;
    }
    case "funeral": {
      add(wash(c, [22, 26, 38], 0.2));
      const drape = new Path2D();
      swags(c, -6 * u, 22, 240, 8).forEach((p, i) => (i ? drape.lineTo(p.x, p.y) : drape.moveTo(p.x, p.y)));
      drape.lineTo(c.W + 40 * u, -10 * u);
      drape.lineTo(-40 * u, -10 * u);
      drape.closePath();
      if (indoors) add((g) => fill(g, drape, [14, 12, 18]));
      const bx = stage ? F : F - 250 * u;
      if (stage) {
        const box = new Path2D();
        if (old) {
          poly(box, bx - 120 * u, H * 0.82, bx + 120 * u, H * 0.82, bx + 138 * u, H + 2, bx - 138 * u, H + 2);
          add((g, E) => {
            fill(g, box, tint(E, c.home?.keep?.banners?.[0] ?? [50, 46, 66], 0.42));
            g.fillStyle = rgb(tint(E, c.home?.keep?.banners?.[1] ?? [200, 180, 130], 0.46));
            g.fillRect(bx - 16 * u, H * 0.82, 32 * u, H * 0.2);
            g.fillStyle = rgb(tint(E, [70, 58, 54], 0.34));
            g.fillRect(bx - 120 * u, H * 0.8, 240 * u, 5 * u);
          });
        } else {
          box.moveTo(bx - 116 * u, H * 0.76);
          box.lineTo(bx + 116 * u, H * 0.76);
          box.quadraticCurveTo(bx + 126 * u, H * 0.83, bx + 116 * u, H * 0.9);
          box.lineTo(bx - 116 * u, H * 0.9);
          box.quadraticCurveTo(bx - 126 * u, H * 0.83, bx - 116 * u, H * 0.76);
          box.closePath();
          add((g, E) => {
            g.fillStyle = rgb(tint(E, [40, 36, 42], 0.3));
            g.fillRect(bx - 102 * u, H * 0.9, 8 * u, H * 0.12);
            g.fillRect(bx + 94 * u, H * 0.9, 8 * u, H * 0.12);
            fill(g, box, tint(E, [78, 50, 38], 0.46));
            g.fillStyle = rgb(tint(E, [186, 170, 130], 0.44));
            g.fillRect(bx - 116 * u, H * 0.825, 232 * u, 2.4 * u);
            lilies(g, E, bx, H * 0.77, u * 0.62);
          });
        }
      }
      add((g, E) => {
        const y = H + 4 * u;
        if (old) {
          for (const s of [-1, 1])
            for (let k = 0; k < 7; k++) {
              const x = bx + s * ((stage ? 146 : 50) + k * 11) * u;
              candle(g, E, x, H - (k % 2 ? 0 : 8) * u, u, 12 + (k % 3) * 8, 0.52);
            }
        } else {
          lilies(g, E, bx - (stage ? 170 : 62) * u, y, u);
          lilies(g, E, bx + (stage ? 170 : 62) * u, y, u);
        }
      });
      break;
    }
  }
  return (g, E) => {
    for (const p of parts) p(g, E);
  };
}

// ---------- Scenes painted for the occasion ----------

function chairRow(p: Path2D, x: number, y: number, u: number) {
  poly(p, x - 10 * u, y, x - 9 * u, y - 30 * u, x + 9 * u, y - 30 * u, x + 10 * u, y);
  p.rect(x - 11 * u, y, 22 * u, 4 * u);
  p.rect(x - 10 * u, y + 4 * u, 2.4 * u, 13 * u);
  p.rect(x + 7.6 * u, y + 4 * u, 2.4 * u, 13 * u);
}

/** A garden laid out for a wedding: a flowered arch at the end of a pale aisle, white chairs either side. */
function weddingGarden(c: Ctx): Scene {
  const { W, H, u, F, r } = c;
  const far = ridge(c, H * 0.58, 16 * u, 0.7);
  const trees = new Path2D();
  for (let x = -20 * u; x < W + 40 * u; x += (46 + r() * 50) * u) leafy(trees, x, H * 0.66, (56 + r() * 44) * u);
  const ground = ridge(c, H * 0.66, 3 * u);
  const aisle = new Path2D();
  poly(aisle, F - 26 * u, H * 0.68, F + 26 * u, H * 0.68, F + 96 * u, H + 2, F - 96 * u, H + 2);
  const ax = F;
  const arch = new Path2D();
  arch.moveTo(ax - 68 * u, H * 0.7);
  arch.lineTo(ax - 68 * u, H * 0.3);
  arch.quadraticCurveTo(ax - 66 * u, H * 0.08, ax, H * 0.06);
  arch.quadraticCurveTo(ax + 66 * u, H * 0.08, ax + 68 * u, H * 0.3);
  arch.lineTo(ax + 68 * u, H * 0.7);
  const blooms: { x: number; y: number; s: number; c: RGB }[] = [];
  for (let t = 0; t < 1; t += 0.012) {
    const a = Math.PI * (1 - t);
    const x = ax + Math.cos(a) * 68 * u + (r() - 0.5) * 14 * u;
    const y = t < 0.2 || t > 0.8 ? H * 0.7 - (t < 0.2 ? t / 0.2 : (1 - t) / 0.2) * H * 0.4 : H * 0.3 - Math.sin(a) * H * 0.24 + (r() - 0.5) * 12 * u;
    blooms.push({ x, y, s: (4 + r() * 5) * u, c: r() < 0.3 ? LEAF : BLOOM[(r() * BLOOM.length) | 0]! });
  }
  const chairs = [new Path2D(), new Path2D()];
  for (let row = 0; row < 2; row++)
    for (const s of [-1, 1])
      for (let x = F + s * (96 + row * 22) * u; s < 0 ? x > -40 * u : x < W + 40 * u; x += s * 36 * u) chairRow(chairs[row]!, x, H * (0.72 + row * 0.12), u * (1 + row * 0.2));
  const dress = dressing(c, "wedding", false, true, false);
  const string = lights(c);
  return {
    draw(g, E) {
      fill(g, far.p, tone(E, 0.26, GRASS, 0.44));
      fill(g, trees, tone(E, 0.64, [64, 104, 66], 0.66));
      fill(g, ground.p, tone(E, 0.55, [108, 158, 88], 0.72));
      fill(g, aisle, lit(E, 0.5, [240, 232, 218], 0.86));
      stroke(g, arch, lit(E, 0.5, [240, 232, 218], 0.8), 5 * u);
      for (const b of blooms) {
        g.fillStyle = rgb(mix(tone(E, 0.5), b.c, 0.3 + E.day * 0.65));
        g.beginPath();
        g.arc(b.x, b.y, b.s, 0, TAU);
        g.fill();
      }
      fill(g, chairs[0]!, lit(E, 0.55, [240, 236, 228], 0.8));
      fill(g, chairs[1]!, lit(E, 0.42, [248, 244, 238], 0.9));
      string(g, E);
      dress(g, E);
    },
  };
}

/** A marquee at dusk: pale canopy, poles, a dance floor, round tables with flowers, the cake at the centre. */
function receptionTent(c: Ctx): Scene {
  const { W, H, u, F, r } = c;
  const floor = H * 0.72;
  const win = new Path2D();
  win.rect(0, H * 0.26, W, floor - H * 0.26);
  const swagP = new Path2D();
  const seam = new Path2D();
  const poles = new Path2D();
  for (let x = F - 1020 * u; x < W + 340 * u; x += 340 * u) {
    swagP.moveTo(x, H * 0.02);
    swagP.lineTo(x, H * 0.28);
    swagP.quadraticCurveTo(x + 170 * u, H * 0.46, x + 340 * u, H * 0.28);
    swagP.lineTo(x + 340 * u, H * 0.02);
    swagP.closePath();
    poles.rect(x - 4 * u, H * 0.05, 8 * u, H);
    for (const k of [0.25, 0.5, 0.75]) {
      seam.moveTo(x + 340 * u * k, 0);
      seam.lineTo(x + 340 * u * k, H * 0.3 + Math.sin(k * Math.PI) * H * 0.1);
    }
  }
  const tables: { x: number; hue: RGB }[] = [];
  for (let x = F - 280 * u; x > -120 * u; x -= 240 * u) tables.push({ x, hue: BLOOM[(r() * BLOOM.length) | 0]! });
  if (W > F + 250 * u) tables.push({ x: F + 270 * u, hue: BLOOM[1]! });
  const view = hillView(c);
  const dance = new Path2D();
  dance.rect(F - 170 * u, floor + 4 * u, 340 * u, H - floor);
  const dress = dressing(c, "reception", false, true, true);
  return room(
    c,
    win,
    [238, 232, 220],
    view,
    (g, E) => {
      const canvas = tint(E, [240, 234, 222], 0.42);
      fill(g, swagP, canvas);
      stroke(g, seam, DARK, 1 * u, 0.14);
      g.fillStyle = rgb(tint(E, [100, 136, 86], 0.3));
      g.fillRect(0, floor - 26 * u, W, 26 * u);
      fill(g, dance, tint(E, [150, 110, 76], 0.42));
      for (let x = F - 170 * u; x < F + 170 * u; x += 34 * u) {
        g.fillStyle = rgb(DARK, 0.14);
        g.fillRect(x, floor + 4 * u, 1 * u, H - floor);
      }
      for (const t of tables) {
        const y = floor + 2 * u;
        g.fillStyle = rgb(tint(E, [242, 238, 230], 0.46));
        g.beginPath();
        g.moveTo(t.x - 66 * u, y);
        g.lineTo(t.x + 66 * u, y);
        g.lineTo(t.x + 78 * u, H * 0.96);
        g.lineTo(t.x - 78 * u, H * 0.96);
        g.fill();
        g.beginPath();
        g.ellipse(t.x, y, 66 * u, 9 * u, 0, 0, TAU);
        g.fill();
        for (let k = 0; k < 7; k++) {
          g.fillStyle = rgb(tint(E, k % 3 === 0 ? LEAF : t.hue, 0.5));
          g.beginPath();
          g.arc(t.x + Math.cos(k * 2.4) * 11 * u, y - 16 * u + Math.sin(k * 2.4) * 8 * u, 4.6 * u, 0, TAU);
          g.fill();
        }
        g.fillStyle = rgb(tint(E, [200, 200, 206], 0.46));
        g.fillRect(t.x - 1.2 * u, y - 12 * u, 2.4 * u, 12 * u);
        lamp(g, E, t.x + 38 * u, y - 7 * u, 40 * u, t.x, WARM, 0.2);
      }
      fill(g, poles, tint(E, [226, 218, 204], 0.4));
      dress(g, E);
    },
    floor,
    { floorHue: [98, 138, 82], vignette: 0.2 },
  );
}

/** A stage's place, for an occasion with no real one to stand in. */
const STAGE_PLACE: Record<Occasion, { old: Place; modern: Place }> = {
  birthday: { old: "hall", modern: "living" },
  wedding: { old: "chapel", modern: "meadow" },
  reception: { old: "hall", modern: "dining" },
  party: { old: "hall", modern: "living" },
  dinnerparty: { old: "hall", modern: "dining" },
  funeral: { old: "chapel", modern: "graveyard" },
  anniversary: { old: "study", modern: "dining" },
  ball: { old: "hall", modern: "greatroom" },
  festival: { old: "market", modern: "city" },
  coronation: { old: "hall", modern: "temple" },
  contest: { old: "camp", modern: "city" },
  execution: { old: "street", modern: "street" },
};
/** A stadium under its floodlights: tiers of crowd, a green pitch, a scoreboard. */
function stadium(c: Ctx): Scene {
  const { W, H, u, F, r } = c;
  const top = H * 0.26;
  const pitchY = H * 0.68;
  const tiers = new Path2D();
  for (let k = 0; k < 3; k++) {
    const y = top + (k * (pitchY - top)) / 3;
    tiers.rect(-4, y, W + 8, (pitchY - top) / 3 - 3 * u);
  }
  const fans: { x: number; y: number; c: RGB }[] = [];
  const shirts: RGB[] = [[30, 90, 176], [240, 236, 226], [176, 40, 52], [226, 196, 110], [70, 70, 84]];
  for (let y = top + 5 * u; y < pitchY - 3 * u; y += 6.5 * u) for (let x = (y % 2) * u; x < W; x += (5 + r() * 2) * u) if (r() > 0.1) fans.push({ x, y, c: shirts[(r() * shirts.length) | 0]! });
  const roof = new Path2D();
  poly(roof, -4, H * 0.24, W + 4, H * 0.24, W + 4, H * 0.19, -4, H * 0.19);
  const pitch = new Path2D();
  pitch.rect(-4, pitchY, W + 8, H - pitchY);
  const lines = new Path2D();
  lines.rect(-4, pitchY + 7 * u, W + 8, 2 * u);
  lines.rect(F - 1 * u, pitchY + 7 * u, 2 * u, H);
  lines.moveTo(F + 40 * u, H * 0.88);
  lines.ellipse(F, H * 0.88, 40 * u, 11 * u, 0, 0, TAU);
  const towers: number[] = [];
  for (let x = F - 620 * u; x < W + 40 * u; x += 310 * u) if (x > -20 * u) towers.push(x);
  const dress = dressing(c, "contest", false, true, false);
  return {
    draw(g, E) {
      const flood = clamp(E.glow * 1.5 + 0.2);
      fill(g, roof, tone(E, 0.72, [120, 122, 134], 0.7));
      fill(g, tiers, tone(E, 0.78, [96, 98, 110], 0.6));
      for (const f of fans) {
        g.fillStyle = rgb(mix(tone(E, 0.6), f.c, 0.28 + 0.6 * Math.max(E.day, flood * 0.8)));
        g.fillRect(f.x, f.y, 3 * u, 3.6 * u);
      }
      for (const x of towers) {
        g.fillStyle = rgb(tone(E, 0.88));
        g.fillRect(x - 3 * u, H * 0.02, 6 * u, H * 0.22);
        g.fillRect(x - 24 * u, H * 0.015, 48 * u, 11 * u);
        for (let k = -2; k <= 2; k++) {
          g.fillStyle = rgb([255, 252, 232], 0.45 + flood * 0.55);
          g.fillRect(x + k * 9 * u - 3 * u, H * 0.015 + 3 * u, 6 * u, 5 * u);
        }
        glowAt(g, x, H * 0.04, 180 * u, [240, 244, 255], 0.3 * flood);
      }
      const gr = g.createLinearGradient(0, pitchY, 0, H);
      const lawn = mix(tone(E, 0.6, [60, 130, 66], 0.8), [62, 138, 72], flood * 0.75);
      gr.addColorStop(0, rgb(lawn));
      gr.addColorStop(1, rgb(mix(lawn, DARK, 0.3)));
      g.fillStyle = gr;
      g.fill(pitch);
      for (let x = (F % (120 * u)) - 120 * u; x < W; x += 120 * u) {
        g.fillStyle = rgb([255, 255, 255], 0.03);
        g.fillRect(x, pitchY, 60 * u, H - pitchY);
      }
      stroke(g, lines, [240, 244, 240], 1.4 * u, 0.62);
      // The board, up over the near end.
      const bx = F - 150 * u;
      g.fillStyle = rgb(tone(E, 0.92));
      g.fillRect(bx - 56 * u, H * 0.03, 112 * u, 40 * u);
      g.fillStyle = rgb([255, 190, 80], 0.5 + flood * 0.5);
      for (const d of [-36, -18, 18, 36]) g.fillRect(bx + d * u - 6 * u, H * 0.03 + 9 * u, 12 * u, 22 * u);
      dress(g, E);
    },
  };
}

const STAGES_PAINTED: Partial<Record<Occasion, (c: Ctx) => Scene>> = { wedding: weddingGarden, reception: receptionTent, contest: stadium };

export const stagePlace = (id: Occasion, old: boolean): Place => STAGE_PLACE[id][old ? "old" : "modern"];
/** An occasion painted whole, if it has one in this era. */
export const stagePainted = (id: Occasion, old: boolean) => (old ? undefined : STAGES_PAINTED[id]);

/** A place with an occasion over it. The scene keeps its own light and weather; the dressing goes last. */
export function dressScene(scene: Scene, c: Ctx, id: Occasion, old: boolean, stage: boolean): Scene {
  const indoors = Boolean(scene.room);
  const paint = dressing(c, id, old, stage, indoors);
  if (scene.room) {
    const inner = scene.room.draw;
    return { ...scene, room: { ...scene.room, draw: (g, E) => (inner(g, E), paint(g, E)) } };
  }
  const inner = scene.draw;
  return { ...scene, draw: (g, E) => (inner(g, E), paint(g, E)) };
}
