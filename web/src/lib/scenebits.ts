/**
 * Small parts the painted rooms share.
 */
import { clamp, rgb, TAU, type Env, type RGB } from "./places";
import { shade } from "./scenes";

type G = CanvasRenderingContext2D;
type Paint = (g: G, E: Env) => void;

export const pick = <T>(r: () => number, a: readonly T[]): T => a[(r() * a.length) | 0]!;
export const time = (E: Env) => (E.still ? 0 : E.T);
export const none: Paint = () => {};
/** A room with no window: lit by its own lamps, no sky and no weather. */
export const shut = () => new Path2D();

export function rr(p: Path2D, x: number, y: number, w: number, h: number, k: number) {
  k = Math.max(0, Math.min(k, w / 2, h / 2));
  p.moveTo(x + k, y);
  p.arcTo(x + w, y, x + w, y + h, k);
  p.arcTo(x + w, y + h, x, y + h, k);
  p.arcTo(x, y + h, x, y, k);
  p.arcTo(x, y, x + w, y, k);
  p.closePath();
}
export function ellipse(p: Path2D, x: number, y: number, rx: number, ry: number) {
  p.moveTo(x + rx, y);
  p.ellipse(x, y, rx, ry, 0, 0, TAU);
}
/** Curtains either side of a window, on a rail. */
export function drapes(p: Path2D, x0: number, x1: number, top: number, floor: number, u: number) {
  for (const s of [-1, 1]) {
    const x = s < 0 ? x0 - 14 * u : x1 + 14 * u;
    p.moveTo(x, top - 16 * u);
    p.lineTo(x + s * 34 * u, top - 16 * u);
    p.quadraticCurveTo(x + s * 30 * u, floor * 0.7, x + s * 40 * u, floor);
    p.lineTo(x - s * 4 * u, floor);
    p.quadraticCurveTo(x + s * 18 * u, (top + floor) / 2, x - s * 8 * u, top + 20 * u);
    p.closePath();
  }
  p.rect(x0 - 60 * u, top - 20 * u, x1 - x0 + 120 * u, 4 * u);
}
/** Lines across and down a box (tiles, planks, panels). */
export function grid(p: Path2D, x0: number, y0: number, x1: number, y1: number, sx: number, sy: number, stagger = false) {
  for (let y = y0, row = 0; y <= y1 + 0.1; y += sy, row++) {
    p.moveTo(x0, y);
    p.lineTo(x1, y);
    if (sx > 0 && y < y1)
      for (let x = x0 + (stagger && row % 2 ? sx / 2 : 0); x < x1; x += sx) {
        p.moveTo(x, y);
        p.lineTo(x, Math.min(y + sy, y1));
      }
  }
}
/** A wall clock showing the story's own hour. */
export function clock(g: G, E: Env, x: number, y: number, rad: number, face: RGB = [240, 236, 226]) {
  g.fillStyle = rgb(shade(E, face, 0.6));
  g.beginPath();
  g.arc(x, y, rad, 0, TAU);
  g.fill();
  g.strokeStyle = rgb([34, 28, 30]);
  g.lineWidth = rad * 0.14;
  g.stroke();
  g.lineCap = "round";
  const hand = (a: number, l: number, w: number) => {
    g.lineWidth = w;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
    g.stroke();
  };
  hand(((E.t % 12) / 12) * TAU - Math.PI / 2, rad * 0.5, rad * 0.13);
  hand((E.t % 1) * TAU - Math.PI / 2, rad * 0.78, rad * 0.08);
}
/** Steam or vapour rising from (x, y). */
export function steam(g: G, E: Env, x: number, y: number, u: number, n = 6, w = 20, a = 0.1) {
  const T = E.still ? 3 : E.T;
  for (let i = 0; i < n; i++) {
    const k = (T * 0.09 + i / n + x * 0.003) % 1;
    g.fillStyle = rgb([236, 238, 244], a * Math.sin(k * Math.PI));
    g.beginPath();
    g.arc(x + Math.sin(T * 0.7 + i * 2.1) * w * u + (i - n / 2) * w * 0.3 * u, y - k * 70 * u, (8 + k * 22) * u, 0, TAU);
    g.fill();
  }
}
/** Lamps that are always on (indoor lights): stronger in the dark. */
export const lampsOn = (E: Env, min = 0.35) => clamp(Math.max(E.glow, min));
