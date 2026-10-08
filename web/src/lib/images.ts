import { api } from "./api";

/** Client-side image work (CHAR-05): crop, thumbnail, palette. The server never needs an image library. */

export function loadImage(src: string | Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = typeof src === "string" ? src : URL.createObjectURL(src);
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Couldn't load that image"));
    img.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Image encoding failed"))), type, quality));
}

export interface Crop {
  x: number;
  y: number;
  w: number;
  h: number;
}

export async function renderCrop(img: HTMLImageElement, crop: Crop, outW: number, outH: number, type = "image/png", quality?: number): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, crop.x, crop.y, crop.w, crop.h, 0, 0, outW, outH);
  return canvasToBlob(canvas, type, quality);
}

export async function makeThumb(img: HTMLImageElement, maxSide = 320): Promise<Blob> {
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  return renderCrop(img, { x: 0, y: 0, w: img.naturalWidth, h: img.naturalHeight }, w, h, "image/webp", 0.86);
}

const toHex = (r: number, g: number, b: number) => `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;

/** A few representative colors, used for per-character accents (UI-08). */
export function extractPalette(img: HTMLImageElement, count = 5): string[] {
  const size = 40;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, size, size);
  const data = ctx.getImageData(0, 0, size, size).data;
  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>();
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3]! < 200) continue;
    const r = data[i]!,
      g = data[i + 1]!,
      b = data[i + 2]!;
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const cur = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    cur.n++;
    cur.r += r;
    cur.g += g;
    cur.b += b;
    buckets.set(key, cur);
  }
  const colors = [...buckets.values()]
    .map((c) => ({ n: c.n, r: Math.round(c.r / c.n), g: Math.round(c.g / c.n), b: Math.round(c.b / c.n) }))
    .sort((a, b) => b.n - a.n);
  const picked: typeof colors = [];
  for (const c of colors) {
    if (picked.every((p) => Math.abs(p.r - c.r) + Math.abs(p.g - c.g) + Math.abs(p.b - c.b) > 90)) picked.push(c);
    if (picked.length >= count) break;
  }
  return picked.map((c) => toHex(c.r, c.g, c.b));
}

/** Uploads an image plus thumbnail and palette; returns the image id. */
/** PERF-08: the small and large sizes next to the medium thumbnail (only when the image is bigger). */
async function appendSizes(form: FormData, image: HTMLImageElement) {
  const side = Math.max(image.naturalWidth, image.naturalHeight);
  form.append("thumb", await makeThumb(image), "thumb.webp");
  if (side > 160) form.append("thumb_s", await makeThumb(image, 128), "s.webp");
  if (side > 900) form.append("thumb_l", await makeThumb(image, 768), "l.webp");
}

export async function uploadImage(blob: Blob, img?: HTMLImageElement): Promise<string> {
  const image = img ?? (await loadImage(blob));
  const form = new FormData();
  form.append("file", blob, "image.png");
  await appendSizes(form, image);
  form.append("palette", JSON.stringify(extractPalette(image)));
  form.append("width", String(image.naturalWidth));
  form.append("height", String(image.naturalHeight));
  const r = await api<{ id: string }>("POST", "/api/images", form);
  return r.id;
}

const backfilled = new Set<string>();
/** Imported cards arrive without thumbnails; make one the first time the full image is shown (PERF-08 lite). */
export async function backfillThumb(id: string, img: HTMLImageElement) {
  if (backfilled.has(id) || img.naturalWidth <= 400) return;
  backfilled.add(id);
  try {
    const form = new FormData();
    await appendSizes(form, img);
    form.append("palette", JSON.stringify(extractPalette(img)));
    await api("POST", `/api/images/${id}/thumb`, form);
  } catch {
    // best effort
  }
}

/** Mixes a palette color with the theme surface for a soft accent. */
export function softAccent(palette: string[] | undefined): string | undefined {
  const c = palette?.find((h) => {
    const r = parseInt(h.slice(1, 3), 16),
      g = parseInt(h.slice(3, 5), 16),
      b = parseInt(h.slice(5, 7), 16);
    const max = Math.max(r, g, b),
      min = Math.min(r, g, b);
    return max - min > 40 && max > 70; // skip greys and near-black
  });
  return c;
}
