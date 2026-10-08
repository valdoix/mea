/**
 * Generates Mea's app icons (cream heart on a rose→lavender gradient) as PNGs,
 * with no image libraries. `--check` only generates when icons are missing.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { encodePng } from "../server/src/lib/png-encode";

const outDirs = [resolve(import.meta.dir, "../web/public/icons")];
const checkOnly = process.argv.includes("--check");

type RGB = [number, number, number];
const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const ROSE = hex("#F0AFC3");
const LAVENDER = hex("#C4B3EC");
const CREAM = hex("#FFF8F1");
const BUTTER = hex("#F7E3A1");

function inHeart(x: number, y: number) {
  // (x² + y² − 1)³ − x²y³ ≤ 0, y up
  const a = x * x + y * y - 1;
  return a * a * a - x * x * y * y * y <= 0;
}

function inSparkle(x: number, y: number, cx: number, cy: number, r: number) {
  const dx = Math.abs(x - cx);
  const dy = Math.abs(y - cy);
  return Math.pow(dx / r, 0.5) + Math.pow(dy / r, 0.5) <= 1;
}

function render(size: number, opts: { rounded: boolean; heartScale: number }) {
  const px = new Uint8Array(size * size * 4);
  const ss = 4;
  const radius = opts.rounded ? size * 0.22 : 0;
  for (let py = 0; py < size; py++) {
    for (let pxl = 0; pxl < size; pxl++) {
      let r = 0,
        g = 0,
        b = 0,
        a = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const x = pxl + (sx + 0.5) / ss;
          const y = py + (sy + 0.5) / ss;
          // rounded-square mask
          if (radius) {
            const qx = Math.max(radius - x, 0, x - (size - radius));
            const qy = Math.max(radius - y, 0, y - (size - radius));
            if (qx * qx + qy * qy > radius * radius) continue;
          }
          const t = (x + y) / (2 * size);
          let col: RGB = [ROSE[0] + (LAVENDER[0] - ROSE[0]) * t, ROSE[1] + (LAVENDER[1] - ROSE[1]) * t, ROSE[2] + (LAVENDER[2] - ROSE[2]) * t];
          // heart in normalized coordinates
          const s = (size * opts.heartScale) / 4.1;
          const hx = (x - size / 2) / s;
          const hy = -((y - size * 0.535) / s) + 0.12;
          if (inHeart(hx, hy)) col = CREAM;
          const sc = opts.heartScale;
          if (inSparkle(x, y, size * (0.5 + 0.27 * sc), size * (0.5 - 0.26 * sc), size * 0.065 * sc)) col = BUTTER;
          r += col[0];
          g += col[1];
          b += col[2];
          a += 255;
        }
      }
      const n = ss * ss;
      const i = (py * size + pxl) * 4;
      const cover = a / n;
      px[i] = cover ? Math.round((r / n) * (255 / cover)) : 0;
      px[i + 1] = cover ? Math.round((g / n) * (255 / cover)) : 0;
      px[i + 2] = cover ? Math.round((b / n) * (255 / cover)) : 0;
      px[i + 3] = Math.round(cover);
    }
  }
  return encodePng(size, size, px);
}

const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#F0AFC3"/><stop offset="1" stop-color="#C4B3EC"/></linearGradient></defs>
<rect width="64" height="64" rx="14" fill="url(#g)"/>
<path d="M32 50 C14 38 12 26 18.5 20.5 C24 16 29.5 18.5 32 23 C34.5 18.5 40 16 45.5 20.5 C52 26 50 38 32 50 Z" fill="#FFF8F1"/>
<path d="M47 11 L48.6 15.4 L53 17 L48.6 18.6 L47 23 L45.4 18.6 L41 17 L45.4 15.4 Z" fill="#F7E3A1"/>
</svg>`;

for (const dir of outDirs) {
  if (checkOnly && existsSync(join(dir, "icon-512.png"))) continue;
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "icon-192.png"), render(192, { rounded: true, heartScale: 1 }));
  writeFileSync(join(dir, "icon-512.png"), render(512, { rounded: true, heartScale: 1 }));
  writeFileSync(join(dir, "maskable-512.png"), render(512, { rounded: false, heartScale: 0.72 }));
  writeFileSync(join(dir, "favicon-32.png"), render(32, { rounded: true, heartScale: 1 }));
  writeFileSync(join(dir, "badge-96.png"), render(96, { rounded: true, heartScale: 1 }));
  writeFileSync(join(dir, "favicon.svg"), FAVICON_SVG);
  console.log(`icons written to ${dir}`);
}
