/**
 * docs/32 5.2: who is in a cast without the story ever naming them. Folds every chat (on a copy of the
 * database: nothing is written to yours, nothing is sent anywhere) and lists, per story:
 *   - people in the cast whose name the story's text, card, persona and lore never have (it should
 *     list nobody but people you added yourself),
 *   - names the tracker wrote that Mea read as someone else, or as nobody.
 *
 *   bun scripts/unnamed-people.ts [--db path/to/mea.db] [--chat <id or part of its title>]
 *
 * Exits 1 when a story has someone unnamed that you didn't add.
 */
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Database } from "bun:sqlite";

const args = process.argv.slice(2);
const opt = (f: string) => (args.includes(f) ? args[args.indexOf(f) + 1] : undefined);

const source = resolve(opt("--db") ?? (process.env.MEA_DATA_DIR ? join(process.env.MEA_DATA_DIR, "mea.db") : join(import.meta.dir, "..", "data", "mea.db")));
if (!existsSync(source)) {
  console.error(`No database at ${source}`);
  process.exit(2);
}
const dir = mkdtempSync(join(tmpdir(), "mea-names-"));
const copy = join(dir, "mea.db");
new Database(source, { readonly: true }).exec(`VACUUM INTO '${copy.replace(/'/g, "''")}'`);
{
  const db = new Database(copy);
  db.exec("DELETE FROM connections");
  db.close();
}
process.env.MEA_DATA_DIR = dir;
process.env.MEA_OFFLINE = "1";
process.env.MEA_DEV = "1";
process.env.MEA_STORY_NAMES = "on";

const { ensureDirs } = await import("../server/src/config");
const { all, closeDb, openDb } = await import("../server/src/db/db");
const { loadMasterKey } = await import("../server/src/lib/crypto");
const { pauseJobs } = await import("../server/src/services/jobs");
const { currentFold, foldConfigFor } = await import("../server/src/trackers/store");
const { passingName } = await import("../server/src/trackers/whois");

ensureDirs();
loadMasterKey();
openDb();
pauseJobs(true);

const want = opt("--chat")?.toLowerCase();
const chats = all<{ id: string; title: string }>("SELECT c.id, c.title FROM chats c WHERE c.deleted_at IS NULL AND EXISTS (SELECT 1 FROM tracker_events t WHERE t.chat_id = c.id) ORDER BY c.updated_at DESC").filter(
  (c) => !want || c.id === want || c.title.toLowerCase().includes(want),
);
let bad = 0;
for (const chat of chats) {
  const cfg = foldConfigFor(chat.id);
  const st = currentFold(chat.id).result.state;
  const yours = new Set((cfg.people ?? []).map((n) => n.trim().toLowerCase()));
  const has = (phrase: string) => cfg.inStory?.(phrase, Number.MAX_SAFE_INTEGER) ?? true;
  const unnamed = Object.values(st.chars).filter((c) => {
    if (c.isUser || c.isMain || passingName(c.name)) return false;
    const names = [c.name, ...c.aliases];
    return !names.some((n) => has(n) || n.split(/\s+/).some((w) => w.length >= 3 && /^\p{Lu}/u.test(w) && has(w)));
  });
  const reread = Object.values(st.reread ?? {});
  console.log(`\n${chat.title || chat.id}: ${Object.keys(st.chars).length} people`);
  if (!unnamed.length) console.log("  everyone in the cast is named by the story");
  for (const c of unnamed) {
    const mine = yours.has(c.name.trim().toLowerCase());
    if (!mine) bad++;
    console.log(`  never named: ${c.name} (#${c.firstSeq}–#${c.lastSeq})${mine ? ", added by you" : ""}`);
  }
  for (const r of reread) console.log(`  ${r.name}: ${r.as ? `read as ${r.as}` : "nobody was added"} (${r.lines} ${r.lines === 1 ? "line" : "lines"}, last at #${r.lastSeq})`);
}
closeDb();
try {
  rmSync(dir, { recursive: true, force: true });
} catch {
  // Windows may still hold the copy; it's in the temp folder.
}
process.exit(bad ? 1 : 0);
