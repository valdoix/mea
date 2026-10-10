import { describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureDirs } from "../src/config";
import { all, closeDb, db, one, openDb, run } from "../src/db/db";
import { setMasterKey } from "../src/lib/crypto";

/** Inserts a row filling every required column the test doesn't name with a placeholder. */
function insert(table: string, values: Record<string, unknown>) {
  const cols = db().query<{ name: string; type: string; notnull: number; dflt_value: unknown; pk: number }, []>(`PRAGMA table_info(${table})`).all();
  const row: Record<string, unknown> = { ...values };
  for (const c of cols) if (!(c.name in row) && c.notnull && c.dflt_value == null && !c.pk) row[c.name] = /INT|REAL/i.test(c.type) ? 0 : "{}";
  const keys = Object.keys(row);
  run(`INSERT INTO ${table} (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`, ...(keys.map((k) => row[k]) as never[]));
}

describe("M31: migrations 15 and 16 on an older database", () => {
  test("keep live rows, drop orphans, mark tracker memories, and cascade from then on", () => {
    ensureDirs();
    setMasterKey(randomBytes(32));
    const dir = mkdtempSync(join(tmpdir(), "mea-mig-"));
    const file = join(dir, "old.db");
    try {
      openDb(file, { backupDir: dir, upTo: 14 });
      // The old schema had no foreign keys on these tables: orphans could pile up.
      db().exec("PRAGMA foreign_keys = OFF");
      insert("chats", { id: "c1" });
      insert("messages", { id: "m1", chat_id: "c1", seq: 1, role: "user" });
      insert("messages", { id: "m2", chat_id: "c1", seq: 2, role: "assistant", active_swipe: 1 });
      insert("memories", { id: "mem-ai", chat_id: "c1", type: "event", content: "Mira lit the lamp.", confidence: 1 });
      insert("memories", { id: "mem-tr", chat_id: "c1", type: "event", content: "Tom died.", confidence: 0.85 });
      insert("memories", { id: "mem-dead", chat_id: "c1", type: "event", content: "From a purged message.", confidence: 1 });
      insert("memory_sources", { memory_id: "mem-ai", message_id: "m1", seq: 1 });
      insert("memory_sources", { memory_id: "mem-tr", message_id: "m2", seq: 2 });
      insert("memory_sources", { memory_id: "mem-dead", message_id: "gone", seq: 3 });
      insert("tracker_events", { id: "ev-live", chat_id: "c1", message_id: "m2", swipe_idx: 1, source: "model", ord: 1, op: "{}" });
      insert("tracker_events", { id: "ev-orphan", chat_id: "c1", message_id: "gone", swipe_idx: 0, source: "model", ord: 1, op: "{}" });
      insert("memory_usage", { generation_id: "g1", chat_id: "c1", owner_type: "memory", owner_id: "mem-ai", slot: "recall" });
      insert("memory_usage", { generation_id: "g2", chat_id: "gone-chat", owner_type: "memory", owner_id: "x", slot: "recall" });
      insert("lore_hits", { entry_id: "e1", chat_id: "gone-chat", count: 1, last_at: 1 });
      insert("embeddings", { owner_type: "memory", owner_id: "mem-dead", chat_id: "c1" });
      closeDb();

      openDb(file, { backupDir: dir });
      expect(all<{ id: number }>("SELECT id FROM _migrations WHERE id IN (15, 16)")).toHaveLength(2);
      expect(all<{ id: string }>("SELECT id FROM tracker_events")).toEqual([{ id: "ev-live" }]);
      expect(all<{ generation_id: string }>("SELECT generation_id FROM memory_usage")).toEqual([{ generation_id: "g1" }]);
      expect(all("SELECT 1 FROM lore_hits")).toHaveLength(0);
      // A memory made only from a message that's gone goes, with its vector.
      expect(one("SELECT 1 FROM memories WHERE id = 'mem-dead'")).toBeFalsy();
      expect(all("SELECT 1 FROM embeddings WHERE owner_id = 'mem-dead'")).toHaveLength(0);
      // The tracker memory is marked by its columns now, on the swipe its message shows.
      expect(one<{ origin: string; swipe_idx: number | null }>("SELECT origin, swipe_idx FROM memories WHERE id = 'mem-tr'")).toEqual({ origin: "tracker", swipe_idx: 1 });
      expect(one<{ origin: string }>("SELECT origin FROM memories WHERE id = 'mem-ai'")?.origin).toBe("ai");

      // From now on a purged message takes its rows with it.
      run("DELETE FROM messages WHERE id = 'm2'");
      expect(all("SELECT 1 FROM tracker_events WHERE message_id = 'm2'")).toHaveLength(0);
      expect(all("SELECT 1 FROM memory_sources WHERE message_id = 'm2'")).toHaveLength(0);
      // And a purged chat its usage rows.
      run("DELETE FROM chats WHERE id = 'c1'");
      expect(all("SELECT 1 FROM memory_usage")).toHaveLength(0);
      expect(db().query("PRAGMA foreign_key_check").all()).toHaveLength(0);
      closeDb();

      // Running again changes nothing (already applied).
      openDb(file, { backupDir: dir });
      expect(db().query("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
      closeDb();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
