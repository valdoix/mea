/** Minimal PNG chunk reader/writer for character card metadata (tEXt "chara" / "ccv3"). */

const SIGNATURE = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);

export interface PngChunk {
  type: string;
  data: Uint8Array;
}

export function isPng(bytes: Uint8Array): boolean {
  return bytes.length > 8 && SIGNATURE.every((b, i) => bytes[i] === b);
}

export function readChunks(bytes: Uint8Array): PngChunk[] {
  if (!isPng(bytes)) throw new Error("Not a PNG file");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunks: PngChunk[] = [];
  let offset = 8;
  while (offset + 8 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    const start = offset + 8;
    if (start + length + 4 > bytes.length) throw new Error("Truncated PNG chunk");
    chunks.push({ type, data: bytes.subarray(start, start + length) });
    offset = start + length + 4; // skip CRC
    if (type === "IEND") break;
  }
  return chunks;
}

export function writeChunks(chunks: PngChunk[]): Uint8Array {
  const size = 8 + chunks.reduce((n, c) => n + 12 + c.data.length, 0);
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  out.set(SIGNATURE, 0);
  let offset = 8;
  for (const chunk of chunks) {
    view.setUint32(offset, chunk.data.length);
    const typeBytes = new TextEncoder().encode(chunk.type);
    out.set(typeBytes, offset + 4);
    out.set(chunk.data, offset + 8);
    const crcInput = new Uint8Array(4 + chunk.data.length);
    crcInput.set(typeBytes, 0);
    crcInput.set(chunk.data, 4);
    view.setUint32(offset + 8 + chunk.data.length, crc32(crcInput));
    offset += 12 + chunk.data.length;
  }
  return out;
}

/** Reads all tEXt chunks as keyword → text (latin1). */
export function readTextChunks(bytes: Uint8Array): Record<string, string> {
  const out: Record<string, string> = {};
  for (const chunk of readChunks(bytes)) {
    if (chunk.type !== "tEXt") continue;
    const nul = chunk.data.indexOf(0);
    if (nul < 0) continue;
    const keyword = latin1(chunk.data.subarray(0, nul));
    out[keyword.toLowerCase()] = latin1(chunk.data.subarray(nul + 1));
  }
  return out;
}

/** Replaces the given tEXt keywords (removing old copies) and inserts them before IEND. */
export function setTextChunks(bytes: Uint8Array, entries: Record<string, string>): Uint8Array {
  const keys = new Set(Object.keys(entries).map((k) => k.toLowerCase()));
  const chunks = readChunks(bytes).filter((c) => {
    if (c.type !== "tEXt") return true;
    const nul = c.data.indexOf(0);
    return !keys.has(latin1(c.data.subarray(0, nul < 0 ? 0 : nul)).toLowerCase());
  });
  const iend = chunks.findIndex((c) => c.type === "IEND");
  const text = Object.entries(entries).map(([k, v]) => ({ type: "tEXt", data: fromLatin1(`${k}\0${v}`) }));
  chunks.splice(iend < 0 ? chunks.length : iend, 0, ...text);
  return writeChunks(chunks);
}

export function pngSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (!isPng(bytes) || bytes.length < 24) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

const latin1 = (b: Uint8Array) => {
  let s = "";
  for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode(...b.subarray(i, i + 8192));
  return s;
};

const fromLatin1 = (s: string) => {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
};

let crcTable: Uint32Array | null = null;
function crc32(data: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) crc = crcTable[(crc ^ data[i]!) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** Base64 helpers that handle UTF-8 JSON correctly. */
export const utf8ToBase64 = (s: string) => Buffer.from(s, "utf8").toString("base64");
export const base64ToUtf8 = (s: string) => Buffer.from(s, "base64").toString("utf8");
