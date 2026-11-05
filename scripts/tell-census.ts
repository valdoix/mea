/**
 * docs/29 Part 2: the tell census. Which habits each model family leans on, counted over the story
 * replies already in your chats, and how often each family's plan drafted the story it then wrote.
 * The database is only read (opened read-only); nothing is sent anywhere. A take you edited counts
 * as the model first wrote it.
 *
 * Families are fairest compared inside one story (`--chat`), where the card, the cast and the
 * player are the same and only the model differs.
 *
 *   bun scripts/tell-census.ts [--db path/to/mea.db] [--chat <id or part of its title>] [--since 2026-11-05] [--out report.md] [--min 20]
 */
import { existsSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Database } from "bun:sqlite";
import { census, censusReport, type CensusRow } from "../server/src/steer/census";

const args = process.argv.slice(2);
const opt = (f: string) => (args.includes(f) ? args[args.indexOf(f) + 1] : undefined);

const source = resolve(opt("--db") ?? (process.env.MEA_DATA_DIR ? join(process.env.MEA_DATA_DIR, "mea.db") : join(import.meta.dir, "..", "data", "mea.db")));
if (!existsSync(source)) {
  console.error(`No database at ${source}`);
  process.exit(2);
}
const since = opt("--since") ? Date.parse(opt("--since")!) : 0;
if (Number.isNaN(since)) {
  console.error("--since takes a date, e.g. 2026-11-05");
  process.exit(2);
}

const db = new Database(source, { readonly: true });
let chat: { id: string; title: string } | null = null;
const which = opt("--chat");
if (which) {
  const found = db.query<{ id: string; title: string }, [string, string]>("SELECT id, title FROM chats WHERE id = ? OR title LIKE ? ORDER BY updated_at DESC").all(which, `%${which}%`);
  if (found.length !== 1) {
    console.error(found.length ? `"${which}" matches ${found.length} chats: ${found.map((c) => `${c.title} (${c.id})`).join(", ")}` : `No chat matches "${which}"`);
    process.exit(2);
  }
  chat = found[0]!;
}
// Every story take Mea wrote names its model in its meta; a take edited since keeps its first version in swipe_edits.
const rows = db
  .query<{ chat_id: string; model_id: string; content: string; reasoning: string | null; original: string | null }, [number, string | null, string | null]>(
    `SELECT m.chat_id, json_extract(s.meta, '$.model') AS model_id, s.content, s.reasoning,
            (SELECT e.previous FROM swipe_edits e WHERE e.swipe_id = s.id ORDER BY e.created_at LIMIT 1) AS original
       FROM swipes s
       JOIN messages m ON m.id = s.message_id
      WHERE m.role = 'assistant' AND s.status = 'done' AND s.content != ''
        AND json_extract(s.meta, '$.model') IS NOT NULL AND s.created_at >= ?
        AND (? IS NULL OR m.chat_id = ?)`,
  )
  .all(since, chat?.id ?? null, chat?.id ?? null);
db.close();

const replies: CensusRow[] = rows.map((r) => ({ chatId: r.chat_id, modelId: r.model_id, content: r.original ?? r.content, reasoning: r.reasoning ?? "" }));
const scope = [chat ? `in “${chat.title}”` : "", since ? `since ${opt("--since")}` : ""].filter(Boolean).join(" ");
const report = censusReport(census(replies), { minReplies: Number(opt("--min") ?? 20), title: `Tell census — ${replies.length} replies${scope ? ` ${scope}` : ""}` });
const out = opt("--out");
if (out) {
  writeFileSync(out, `${report}\n`);
  console.log(`Wrote ${out}`);
} else console.log(report);
