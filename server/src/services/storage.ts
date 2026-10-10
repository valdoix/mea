import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { paths } from "../config";
import { all, db, now, one, run } from "../db/db";
import { HttpError } from "../lib/http";
import { activeGenerations } from "./generation";
import { purgeTrash } from "./trash";
import { deletedImagesDir, IMAGE_UNREFERENCED, purgeUnreferencedImages } from "./images";

/**
 * The storage dashboard (DATA-06): what takes space (per chat and per character), what can be
 * reclaimed (old request bodies, the trash, unused images, free pages), and a one-click vacuum.
 */

function dirSize(dir: string, filter: (f: string) => boolean = () => true) {
  if (!existsSync(dir)) return { bytes: 0, files: 0 };
  let bytes = 0;
  let files = 0;
  for (const f of readdirSync(dir)) {
    if (!filter(f)) continue;
    try {
      const st = statSync(join(dir, f));
      if (st.isFile()) {
        bytes += st.size;
        files++;
      }
    } catch {
      // vanished
    }
  }
  return { bytes, files };
}

const fileBytes = (f: string) => (existsSync(f) ? statSync(f).size : 0);

export function storageReport() {
  const page = one<{ page_size: number }>("PRAGMA page_size")?.page_size ?? 4096;
  const pages = one<{ page_count: number }>("PRAGMA page_count")?.page_count ?? 0;
  const free = one<{ freelist_count: number }>("PRAGMA freelist_count")?.freelist_count ?? 0;
  const dbBytes = pages * page;

  // Text a chat holds: messages and swipes, request bodies, memory, vectors.
  const chats = all<{ id: string; title: string; character: string | null; deleted: number | null; messages: number; text: number; requests: number; memory: number; vectors: number }>(`
    SELECT c.id, c.title, ch.name AS character, c.deleted_at AS deleted,
      (SELECT COUNT(*) FROM messages m WHERE m.chat_id = c.id) AS messages,
      COALESCE((SELECT SUM(LENGTH(s.content) + COALESCE(LENGTH(s.reasoning), 0) + LENGTH(s.meta)) FROM swipes s JOIN messages m ON m.id = s.message_id WHERE m.chat_id = c.id), 0) AS text,
      COALESCE((SELECT SUM(COALESCE(LENGTH(g.request), 0) + COALESCE(LENGTH(g.response), 0) + COALESCE(LENGTH(g.trace), 0)) FROM generations g WHERE g.chat_id = c.id), 0) AS requests,
      COALESCE((SELECT SUM(LENGTH(content) + LENGTH(data)) FROM summaries WHERE chat_id = c.id), 0) + COALESCE((SELECT SUM(LENGTH(content)) FROM memories WHERE chat_id = c.id), 0) AS memory,
      COALESCE((SELECT SUM(LENGTH(vector)) FROM embeddings WHERE chat_id = c.id), 0) AS vectors
    FROM chats c LEFT JOIN characters ch ON ch.id = c.character_id`);
  const images = all<{ id: string; bytes: number; file: string; thumb_file: string | null }>("SELECT id, bytes, file, thumb_file FROM images");
  const imageBytes = new Map(images.map((i) => [i.id, i.bytes]));
  const characters = all<{ id: string; name: string; avatar_id: string | null; gallery: string; deleted_at: number | null }>("SELECT id, name, avatar_id, gallery, deleted_at FROM characters").map((c) => {
    const ids = new Set([c.avatar_id, ...(JSON.parse(c.gallery || "[]") as string[])].filter(Boolean) as string[]);
    for (const v of all<{ avatar_id: string | null }>("SELECT avatar_id FROM variants WHERE owner_type = 'character' AND owner_id = ?", c.id)) if (v.avatar_id) ids.add(v.avatar_id);
    const own = chats.filter((x) => x.character === c.name);
    return {
      id: c.id,
      name: c.name,
      deleted: Boolean(c.deleted_at),
      images: [...ids].reduce((n, id) => n + (imageBytes.get(id) ?? 0), 0),
      chats: own.length,
      chatBytes: own.reduce((n, x) => n + x.text + x.requests + x.memory + x.vectors, 0),
    };
  });

  const day = 24 * 3600_000;
  const oldBodies = one<{ n: number; bytes: number }>(
    "SELECT COUNT(*) AS n, COALESCE(SUM(COALESCE(LENGTH(request), 0) + COALESCE(LENGTH(response), 0) + COALESCE(LENGTH(trace), 0)), 0) AS bytes FROM generations WHERE started_at < ? AND (request IS NOT NULL OR response IS NOT NULL)",
    now() - 7 * day,
  )!;
  const trashed = chats.filter((c) => c.deleted);
  // H12: the same reference check the purge uses.
  const orphanImages = one<{ n: number; bytes: number }>(`SELECT COUNT(*) AS n, COALESCE(SUM(bytes), 0) AS bytes FROM images i WHERE ${IMAGE_UNREFERENCED}`)!;

  return {
    database: { bytes: dbBytes, wal: fileBytes(`${paths.db}-wal`), freeBytes: free * page },
    images: dirSize(paths.images),
    // M36: purged images waiting out their grace period.
    imagesDeleted: dirSize(deletedImagesDir()),
    backups: dirSize(paths.backups),
    logs: dirSize(paths.logs),
    chats: chats
      .map((c) => ({ id: c.id, title: c.title || "Untitled", character: c.character, deleted: Boolean(c.deleted), messages: c.messages, text: c.text, requests: c.requests, memory: c.memory, vectors: c.vectors, total: c.text + c.requests + c.memory + c.vectors }))
      .sort((a, b) => b.total - a.total),
    characters: characters.sort((a, b) => b.images + b.chatBytes - (a.images + a.chatBytes)),
    reclaimable: {
      freePages: free * page,
      requestBodies: { count: oldBodies.n, bytes: oldBodies.bytes },
      trash: { chats: trashed.length, bytes: trashed.reduce((n, c) => n + c.text + c.requests + c.memory + c.vectors, 0) },
      images: { count: orphanImages.n, bytes: orphanImages.bytes },
    },
  };
}

/** Compacts the database file (and folds the write-ahead log back in). */
export function vacuum() {
  // L5: VACUUM holds the server until it's done, so not in the middle of a reply.
  if (activeGenerations().length) throw new HttpError(409, "A reply is being written. Compact the database once it's done.");
  const before = fileBytes(paths.db) + fileBytes(`${paths.db}-wal`);
  db().exec("PRAGMA wal_checkpoint(TRUNCATE)");
  db().exec("VACUUM");
  db().exec("PRAGMA wal_checkpoint(TRUNCATE)");
  const after = fileBytes(paths.db) + fileBytes(`${paths.db}-wal`);
  return { before, after, saved: Math.max(0, before - after) };
}

/** One-click clean-ups. Only the trash is permanent, and only for what you already deleted. */
export function clean(what: "requestBodies" | "trash" | "images") {
  if (what === "requestBodies") {
    const r = run("UPDATE generations SET request = NULL, response = NULL, trace = NULL WHERE started_at < ? AND (request IS NOT NULL OR response IS NOT NULL)", now() - 7 * 24 * 3600_000);
    return { removed: r.changes };
  }
  if (what === "trash") return { removed: purgeTrash(now() + 1) };
  return { removed: purgeUnreferencedImages() };
}
