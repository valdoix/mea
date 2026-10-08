import { all, now, run, tx } from "../db/db";
import { purgeUnreferencedImages } from "./images";

const RETENTION_MS = 30 * 24 * 3600_000;

/** Lists everything in the trash (LIB-03). */
export function listTrash() {
  return {
    characters: all<{ id: string; name: string; deleted_at: number }>("SELECT id, name, deleted_at FROM characters WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC"),
    chats: all<{ id: string; title: string; deleted_at: number }>("SELECT id, title, deleted_at FROM chats WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC"),
    personas: all<{ id: string; name: string; deleted_at: number }>("SELECT id, name, deleted_at FROM personas WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC"),
    lorebooks: all<{ id: string; name: string; deleted_at: number }>("SELECT id, name, deleted_at FROM lorebooks WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC"),
    retentionDays: RETENTION_MS / (24 * 3600_000),
  };
}

/** Permanently removes items trashed more than 30 days ago, then unreferenced images. */
export function purgeTrash(olderThan = now() - RETENTION_MS) {
  tx(() => {
    run("DELETE FROM messages WHERE deleted_at IS NOT NULL AND deleted_at < ?", olderThan);
    run("DELETE FROM chats WHERE deleted_at IS NOT NULL AND deleted_at < ?", olderThan);
    run("DELETE FROM characters WHERE deleted_at IS NOT NULL AND deleted_at < ?", olderThan);
    run("DELETE FROM personas WHERE deleted_at IS NOT NULL AND deleted_at < ?", olderThan);
    run("DELETE FROM lorebooks WHERE deleted_at IS NOT NULL AND deleted_at < ?", olderThan);
  });
  return purgeUnreferencedImages();
}
