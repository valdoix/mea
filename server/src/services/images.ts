import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { pngSize } from "../cards/png";
import { paths } from "../config";
import { all, newId, now, one, parseJson, run } from "../db/db";
import { badRequest } from "../lib/http";

export interface ImageRow {
  id: string;
  file: string;
  mime: string;
  width: number | null;
  height: number | null;
  thumb_file: string | null;
  palette: string;
  bytes: number;
  created_at: number;
  /** PERF-08: extra sizes, { s: small (128 px), l: large (768 px) }; thumb_file is the medium (320 px) one. */
  variants?: string;
}

export type ImageSize = "s" | "m" | "l";

const MAX_BYTES = 25 * 1024 * 1024;
const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif", "image/avif": "avif" };

export function sniffMime(b: Uint8Array): string | null {
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return "image/gif";
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70 && b[8] === 0x61 && b[9] === 0x76 && b[10] === 0x69 && b[11] === 0x66) return "image/avif";
  return null;
}

export interface SaveImageOptions {
  width?: number;
  height?: number;
  palette?: string[];
  thumb?: Uint8Array;
  /** PERF-08: more sizes, made by the browser on upload. */
  variants?: Partial<Record<"s" | "l", Uint8Array>>;
}

/** Stores an image file. Images are immutable; edits create new images. */
export async function saveImage(bytes: Uint8Array, opts: SaveImageOptions = {}): Promise<string> {
  if (bytes.length > MAX_BYTES) throw badRequest("Image is too large (max 25 MB)");
  const mime = sniffMime(bytes);
  if (!mime) throw badRequest("Unsupported image format");
  const id = newId();
  const file = `${id}.${EXT[mime]}`;
  await Bun.write(join(paths.images, file), bytes);
  let thumbFile: string | null = null;
  if (opts.thumb && opts.thumb.length > 0) {
    const tm = sniffMime(opts.thumb);
    if (tm) {
      thumbFile = `${id}.thumb.${EXT[tm]}`;
      await Bun.write(join(paths.images, thumbFile), opts.thumb);
    }
  }
  const size = mime === "image/png" ? pngSize(bytes) : null;
  const variants = await writeVariants(id, opts.variants);
  run(
    `INSERT INTO images (id, file, mime, width, height, thumb_file, palette, bytes, created_at, variants) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    file,
    mime,
    opts.width ?? size?.width ?? null,
    opts.height ?? size?.height ?? null,
    thumbFile,
    JSON.stringify(opts.palette ?? []),
    bytes.length,
    now(),
    JSON.stringify(variants),
  );
  return id;
}

async function writeVariants(id: string, v: SaveImageOptions["variants"]) {
  const out: Record<string, string> = {};
  for (const [size, bytes] of Object.entries(v ?? {})) {
    const mime = bytes && bytes.length ? sniffMime(bytes) : null;
    if (!mime) continue;
    const file = `${id}.${size}.${EXT[mime]}`;
    await Bun.write(join(paths.images, file), bytes!);
    out[size] = file;
  }
  return out;
}

/** The file for a size: the variant when there is one, else the next size up, else the original. */
export function imageFileFor(img: ImageRow, size: ImageSize | null): { file: string; original: boolean } {
  const v = parseJson<Record<string, string>>(img.variants, {});
  if (size === "s") return v.s ? { file: v.s, original: false } : img.thumb_file ? { file: img.thumb_file, original: false } : { file: img.file, original: true };
  if (size === "m") return img.thumb_file ? { file: img.thumb_file, original: false } : { file: img.file, original: true };
  if (size === "l") return v.l ? { file: v.l, original: false } : { file: img.file, original: true };
  return { file: img.file, original: true };
}

export async function setThumbnail(id: string, thumb: Uint8Array, palette?: string[], variants?: SaveImageOptions["variants"]) {
  const img = getImage(id);
  if (!img) throw badRequest("No such image");
  const tm = sniffMime(thumb);
  if (!tm) throw badRequest("Unsupported thumbnail format");
  const thumbFile = `${id}.thumb.${EXT[tm]}`;
  await Bun.write(join(paths.images, thumbFile), thumb);
  const v = { ...parseJson<Record<string, string>>(img.variants, {}), ...(await writeVariants(id, variants)) };
  run("UPDATE images SET thumb_file = ?, variants = ?, palette = CASE WHEN ? IS NULL THEN palette ELSE ? END WHERE id = ?", thumbFile, JSON.stringify(v), palette ? 1 : null, JSON.stringify(palette ?? []), id);
}

export function getImage(id: string): ImageRow | undefined {
  return one<ImageRow>("SELECT * FROM images WHERE id = ?", id);
}

export function imagePath(file: string) {
  return join(paths.images, file);
}

export async function readImage(id: string): Promise<{ bytes: Uint8Array; mime: string } | undefined> {
  const img = getImage(id);
  if (!img) return undefined;
  const f = Bun.file(imagePath(img.file));
  if (!(await f.exists())) return undefined;
  return { bytes: new Uint8Array(await f.arrayBuffer()), mime: img.mime };
}

export function imagePalette(id: string | null | undefined): string[] {
  if (!id) return [];
  return parseJson(getImage(id)?.palette, []);
}

/** Deletes images no longer referenced anywhere (run by the trash purge job). */
export function purgeUnreferencedImages(): number {
  const rows = all<ImageRow>(`
    SELECT * FROM images i WHERE
      NOT EXISTS (SELECT 1 FROM characters c WHERE c.avatar_id = i.id OR c.gallery LIKE '%' || i.id || '%' OR c.settings LIKE '%' || i.id || '%')
      AND NOT EXISTS (SELECT 1 FROM personas p WHERE p.avatar_id = i.id)
      AND NOT EXISTS (SELECT 1 FROM chats ch WHERE ch.cover_image_id = i.id OR ch.settings LIKE '%' || i.id || '%')
      AND NOT EXISTS (SELECT 1 FROM variants v WHERE v.avatar_id = i.id)
      AND i.created_at < ?`, now() - 24 * 3600 * 1000);
  for (const r of rows) {
    for (const f of [r.file, r.thumb_file, ...Object.values(parseJson<Record<string, string>>(r.variants, {}))]) {
      if (!f) continue;
      const p = imagePath(f);
      if (existsSync(p)) unlinkSync(p);
    }
    run("DELETE FROM images WHERE id = ?", r.id);
  }
  return rows.length;
}
