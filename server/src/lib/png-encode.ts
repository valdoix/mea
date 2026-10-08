import { deflateSync } from "node:zlib";
import { writeChunks } from "../cards/png";

/** Encodes RGBA pixels as a PNG (used for placeholder avatars and app icons). */
export function encodePng(width: number, height: number, rgba: Uint8Array): Uint8Array {
  const stride = width * 4;
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    raw.set(rgba.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, width);
  v.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return writeChunks([
    { type: "IHDR", data: ihdr },
    { type: "IDAT", data: new Uint8Array(deflateSync(raw, { level: 9 })) },
    { type: "IEND", data: new Uint8Array(0) },
  ]);
}

const hex = (h: string): [number, number, number] => [
  parseInt(h.slice(1, 3), 16),
  parseInt(h.slice(3, 5), 16),
  parseInt(h.slice(5, 7), 16),
];

/** A soft pastel gradient placeholder, used when a card has no image. */
export function placeholderAvatar(width = 400, height = 600, from = "#F7CBB2", to = "#C7B8EC"): Uint8Array {
  const a = hex(from);
  const b = hex(to);
  const px = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const t = (x / width + y / height) / 2;
      const i = (y * width + x) * 4;
      px[i] = Math.round(a[0] + (b[0] - a[0]) * t);
      px[i + 1] = Math.round(a[1] + (b[1] - a[1]) * t);
      px[i + 2] = Math.round(a[2] + (b[2] - a[2]) * t);
      px[i + 3] = 255;
    }
  }
  return encodePng(width, height, px);
}
