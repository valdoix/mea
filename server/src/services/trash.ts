import { all, now, run, tx } from "../db/db";
import { pruneMemoryMarks } from "../memory/entities";
import { pruneFoldMarks } from "../trackers/store";
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
    // H7: rows tied to purged messages go with them (none of these tables has a foreign key to messages),
    // so a purged message's tracker events can't come back at the start of the story.
    const gone = "SELECT id FROM messages WHERE deleted_at IS NOT NULL AND deleted_at < ?";
    // Memories made only from purged messages go too; ones you edited or pinned stay, without those sources.
    const orphaned = `SELECT m.id FROM memories m WHERE m.user_edited = 0 AND m.pinned = 0
      AND EXISTS (SELECT 1 FROM memory_sources s WHERE s.memory_id = m.id)
      AND NOT EXISTS (SELECT 1 FROM memory_sources s WHERE s.memory_id = m.id AND s.message_id NOT IN (${gone}))`;
    run(`DELETE FROM embeddings WHERE owner_type = 'memory' AND owner_id IN (${orphaned})`, olderThan);
    run(`DELETE FROM memories WHERE id IN (${orphaned})`, olderThan);
    for (const table of ["tracker_events", "memory_sources", "continuity_flags", "highlights"]) run(`DELETE FROM ${table} WHERE message_id IN (${gone})`, olderThan);
    run("DELETE FROM messages WHERE deleted_at IS NOT NULL AND deleted_at < ?", olderThan);
    // M31: tables keyed by chat without a foreign key.
    const chats = "SELECT id FROM chats WHERE deleted_at IS NOT NULL AND deleted_at < ?";
    for (const table of ["embeddings", "memory_usage", "lore_hits", "inbox_dismissed"]) run(`DELETE FROM ${table} WHERE chat_id IN (${chats})`, olderThan);
    run("DELETE FROM chats WHERE deleted_at IS NOT NULL AND deleted_at < ?", olderThan);
    // M34: a character or persona that a remaining chat (live or still in the trash) uses is kept.
    run("DELETE FROM characters WHERE deleted_at IS NOT NULL AND deleted_at < ? AND NOT EXISTS (SELECT 1 FROM chats c WHERE c.character_id = characters.id)", olderThan);
    run("DELETE FROM personas WHERE deleted_at IS NOT NULL AND deleted_at < ? AND NOT EXISTS (SELECT 1 FROM chats c WHERE c.persona_id = personas.id)", olderThan);
    run("DELETE FROM lorebooks WHERE deleted_at IS NOT NULL AND deleted_at < ?", olderThan);
    run("DELETE FROM notes WHERE deleted_at IS NOT NULL AND deleted_at < ?", olderThan);
  });
  sweepOrphans();
  return purgeUnreferencedImages();
}

/** Which memories each reply used is kept for the inspector and reinforcement this long (M31). */
const USAGE_MS = 180 * 24 * 3600_000;

/**
 * M31: rows whose owner is gone (these tables have no foreign keys), and reply-by-reply usage older
 * than half a year, which otherwise grows by dozens of rows a reply forever. Runs with the daily purge.
 */
export function sweepOrphans(usageOlderThan = now() - USAGE_MS) {
  tx(() => {
    run("DELETE FROM embeddings WHERE owner_type = 'memory' AND owner_id NOT IN (SELECT id FROM memories)");
    run("DELETE FROM embeddings WHERE owner_type = 'summary' AND owner_id NOT IN (SELECT id FROM summaries)");
    run("DELETE FROM memory_usage WHERE created_at < ? OR chat_id NOT IN (SELECT id FROM chats)", usageOlderThan);
    run("DELETE FROM lore_hits WHERE chat_id NOT IN (SELECT id FROM chats)");
  });
  // M20: change marks older than every fold snapshot and entity sync in memory.
  pruneFoldMarks();
  pruneMemoryMarks();
}
