/**
 * docs/35 Part 6.2: today's rules over every reply a rule ever flagged. Per rule: how many flags are
 * stored, how many you dismissed, how many today's rules would still raise, and how many of those
 * you had dismissed (the ones still wrong). Read-only: a throwaway copy, no connections, no model calls.
 *
 *   bun scripts/replay.ts --flags [--kind leak] [--show] [--db path/to/mea.db]
 */
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Database } from "bun:sqlite";

export async function replayFlags(args: string[]) {
  const opt = (f: string) => (args.includes(f) ? args[args.indexOf(f) + 1] : undefined);
  const only = opt("--kind");
  const show = args.includes("--show");
  const source = resolve(opt("--db") ?? (process.env.MEA_DATA_DIR ? join(process.env.MEA_DATA_DIR, "mea.db") : join(import.meta.dir, "..", "data", "mea.db")));
  if (!existsSync(source)) {
    console.error(`No database at ${source}`);
    process.exit(2);
  }
  const dir = mkdtempSync(join(tmpdir(), "mea-flags-"));
  const copy = join(dir, "mea.db");
  new Database(source, { readonly: true }).exec(`VACUUM INTO '${copy.replace(/'/g, "''")}'`);
  {
    const db = new Database(copy);
    db.exec("DELETE FROM connections");
    db.close();
  }
  const key = join(dirname(source), "mea.key");
  if (existsSync(key)) await Bun.write(join(dir, "mea.key"), Bun.file(key));
  process.env.MEA_DATA_DIR = dir;
  process.env.MEA_OFFLINE = "1";

  const { ensureDirs, paths } = await import("../server/src/config");
  const { all, closeDb, one, openDb, parseJson } = await import("../server/src/db/db");
  const { loadMasterKey } = await import("../server/src/lib/crypto");
  const { pauseJobs } = await import("../server/src/services/jobs");
  const { canonFor, leakGuardOn } = await import("../server/src/accuracy/checker");
  const { guardsFor } = await import("../server/src/accuracy/guards");
  const { SLIPS, runSlips, slipContext } = await import("../server/src/accuracy/slips");
  const { chatNames } = await import("../server/src/memory/build");
  const { memoryConfig } = await import("../server/src/lib/settings");

  type Row = { message_id: string; swipe_idx: number; chat_id: string; issues: string };
  type Tally = { stored: number; dismissed: number; still: number; stillDismissed: number; fresh: number };
  const tally = new Map<string, Tally>();
  const t = (k: string) => tally.get(k) ?? (tally.set(k, { stored: 0, dismissed: 0, still: 0, stillDismissed: 0, fresh: 0 }), tally.get(k)!);
  try {
    ensureDirs();
    openDb();
    loadMasterKey(paths.keyFile);
    pauseJobs(true);
    const cfg = memoryConfig();
    const rows = all<Row>("SELECT message_id, swipe_idx, chat_id, issues FROM continuity_flags");
    let replies = 0;
    // A kind counts only where its check ran (on in that chat, and a reply check, not a tracker or plan one).
    const ran = new Set<string>();
    for (const r of rows) {
      const stored = parseJson<{ kind: string; by?: string; claim: string; conflict: string; dismissed?: boolean }[]>(r.issues, []).filter((i) => i.by === "rules" && (!only || i.kind === only));
      if (!stored.length) continue;
      const m = one<{ seq: number; role: string; name: string | null }>("SELECT seq, role, name FROM messages WHERE id = ? AND deleted_at IS NULL", r.message_id);
      const sw = one<{ content: string }>("SELECT content FROM swipes WHERE message_id = ? AND idx = ?", r.message_id, r.swipe_idx);
      if (!m || !sw) continue;
      replies++;
      let st = null;
      try {
        st = canonFor(r.chat_id, m.seq);
      } catch {
        st = null;
      }
      const ctx = slipContext({ chatId: r.chat_id, text: sw.content, seq: m.seq, messageId: r.message_id, role: m.role, speaker: m.name ?? chatNames(r.chat_id).char, state: st, guards: guardsFor(r.chat_id), continuity: cfg.continuity, leaks: leakGuardOn(r.chat_id) });
      for (const s of SLIPS) if (s.phase === "reply" && s.on(ctx)) ran.add(s.id);
      const now = runSlips(ctx, "reply").filter((i) => i.by === "rules" && (!only || i.kind === only));
      for (const i of stored) {
        const k = t(i.kind);
        k.stored++;
        if (i.dismissed) k.dismissed++;
        const again = now.find((n) => n.kind === i.kind && n.claim === i.claim);
        if (again) {
          k.still++;
          if (i.dismissed) k.stillDismissed++;
          if (show && i.dismissed) console.log(`  still raised, you dismissed it · ${i.kind} · #${m.seq}\n    ${i.claim.slice(0, 140)}\n    ${again.conflict.slice(0, 160)}`);
        }
      }
      for (const n of now) if (!stored.some((i) => i.kind === n.kind && i.claim === n.claim)) {
        t(n.kind).fresh++;
        if (show) console.log(`  new · ${n.kind} · #${m.seq}\n    ${n.claim.slice(0, 140)}\n    ${n.conflict.slice(0, 160)}`);
      }
    }
    console.log(`\nToday's rules over ${replies} flagged replies${only ? ` (${only} only)` : ""}:\n`);
    console.log("rule".padEnd(14) + "stored".padStart(8) + "dismissed".padStart(11) + "still".padStart(8) + "still,dismissed".padStart(17) + "new".padStart(6));
    const skipped = [...tally.keys()].filter((k) => !ran.has(k));
    for (const [k, v] of [...tally].sort((a, b) => b[1].stored - a[1].stored)) if (ran.has(k)) console.log(k.padEnd(14) + String(v.stored).padStart(8) + String(v.dismissed).padStart(11) + String(v.still).padStart(8) + String(v.stillDismissed).padStart(17) + String(v.fresh).padStart(6));
    console.log("\n\"still, dismissed\" is what today's rules still get wrong. \"new\" are flags those replies would now get (they only run on replies that were flagged before).");
  } finally {
    closeDb();
    rmSync(dir, { recursive: true, force: true });
  }
}

function dirname(p: string) {
  return p.replace(/[\\/][^\\/]*$/, "");
}
