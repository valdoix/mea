import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, utimesSync, writeFileSync } from "node:fs";
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

/** M36: purged files wait here for a grace period before they are really deleted. */
export const deletedImagesDir = () => join(paths.images, "deleted");
export const IMAGE_GRACE_MS = 30 * 24 * 3600_000;

/** The path of an image file, moving it back from deleted/ if it was purged but is wanted again. */
export function liveImagePath(file: string) {
  const p = imagePath(file);
  if (!existsSync(p)) {
    const parked = join(deletedImagesDir(), file);
    if (existsSync(parked)) renameSync(parked, p);
  }
  return p;
}

export async function readImage(id: string): Promise<{ bytes: Uint8Array; mime: string } | undefined> {
  const img = getImage(id);
  if (!img) return undefined;
  const f = Bun.file(liveImagePath(img.file));
  if (!(await f.exists())) return undefined;
  return { bytes: new Uint8Array(await f.arrayBuffer()), mime: img.mime };
}

export function imagePalette(id: string | null | undefined): string[] {
  if (!id) return [];
  return parseJson(getImage(id)?.palette, []);
}

/**
 * H12: the one place that knows where image ids are stored. An SQL condition, true when image `i`
 * is used by nothing: characters (portrait, gallery, settings), personas, chats (cover, settings such
 * as the ambience background), variants, and cast portraits (cast_profiles.data.avatarId).
 * Used by both the purge and the storage report.
 */
export const IMAGE_UNREFERENCED = `
      NOT EXISTS (SELECT 1 FROM characters c WHERE c.avatar_id = i.id OR c.gallery LIKE '%' || i.id || '%' OR c.settings LIKE '%' || i.id || '%')
      AND NOT EXISTS (SELECT 1 FROM personas p WHERE p.avatar_id = i.id OR p.data LIKE '%' || i.id || '%')
      AND NOT EXISTS (SELECT 1 FROM chats ch WHERE ch.cover_image_id = i.id OR ch.settings LIKE '%' || i.id || '%')
      AND NOT EXISTS (SELECT 1 FROM variants v WHERE v.avatar_id = i.id)
      AND NOT EXISTS (SELECT 1 FROM cast_profiles cp WHERE cp.data LIKE '%' || i.id || '%')`;

const filesOf = (r: Pick<ImageRow, "file" | "thumb_file" | "variants">) =>
  [r.file, r.thumb_file, ...Object.values(parseJson<Record<string, string>>(r.variants, {}))].filter(Boolean) as string[];

/**
 * Removes images no longer referenced anywhere (run by the trash purge job). M36: the files move to
 * images/deleted/ and are only unlinked after IMAGE_GRACE_MS, so a restored backup gets them back.
 */
export function purgeUnreferencedImages(): number {
  const rows = all<ImageRow>(`SELECT * FROM images i WHERE ${IMAGE_UNREFERENCED} AND i.created_at < ?`, now() - 24 * 3600 * 1000);
  if (rows.length) mkdirSync(deletedImagesDir(), { recursive: true });
  const t = new Date();
  for (const r of rows) {
    for (const f of filesOf(r)) {
      const p = imagePath(f);
      if (!existsSync(p)) continue;
      const parked = join(deletedImagesDir(), f);
      renameSync(p, parked);
      utimesSync(parked, t, t); // the grace period starts now
    }
    run("DELETE FROM images WHERE id = ?", r.id);
  }
  sweepDeletedImages();
  return rows.length;
}

/**
 * M36: files in images/deleted/ whose image row exists again (after a backup restore) go back;
 * the rest are unlinked once their grace period is over.
 */
export function sweepDeletedImages(grace = IMAGE_GRACE_MS) {
  const dir = deletedImagesDir();
  if (!existsSync(dir)) return { revived: 0, removed: 0 };
  const known = new Set(all<{ id: string }>("SELECT id FROM images").map((r) => r.id));
  let revived = 0;
  let removed = 0;
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    try {
      if (known.has(f.split(".")[0]!)) {
        if (!existsSync(imagePath(f))) renameSync(p, imagePath(f));
        else unlinkSync(p);
        revived++;
      } else if (statSync(p).mtimeMs <= now() - grace) {
        unlinkSync(p);
        removed++;
      }
    } catch {
      // vanished or locked: the next sweep tries again
    }
  }
  return { revived, removed };
}

/**
 * M36: copies the image files the mirror folder doesn't have yet into `<dir>/images`. Images are
 * immutable and named by id, so a file already there is never copied again. With `seal`, each file
 * is encrypted and the copy is named `<file>.enc`.
 */
export function mirrorImages(dir: string, seal?: (bytes: Buffer) => Buffer) {
  const target = join(dir, "images");
  mkdirSync(target, { recursive: true });
  const have = new Set(readdirSync(target));
  let copied = 0;
  for (const f of readdirSync(paths.images)) {
    const name = seal ? `${f}.enc` : f;
    if (have.has(name)) continue;
    const source = imagePath(f);
    try {
      if (!statSync(source).isFile()) continue;
      if (seal) writeFileSync(join(target, name), seal(readFileSync(source)));
      else copyFileSync(source, join(target, name));
      copied++;
    } catch {
      // vanished: the next run copies what's left
    }
  }
  return { copied };
}
