/**
 * docs/30 2.2: the place census. Folds a chat (on a copy of the database: nothing is written to
 * yours, nothing is sent anywhere) and prints its place tree: each place with the other names it was
 * written as, and how many different paths the story wrote against how many places they came to.
 *
 *   bun scripts/place-census.ts [--db path/to/mea.db] --chat <id or part of its title> [--out tree.md]
 */
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
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
const dir = mkdtempSync(join(tmpdir(), "mea-places-"));
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

const { ensureDirs } = await import("../server/src/config");
const { all, closeDb, openDb } = await import("../server/src/db/db");
const { loadMasterKey } = await import("../server/src/lib/crypto");
const { pauseJobs } = await import("../server/src/services/jobs");
const { currentFold } = await import("../server/src/trackers/store");
const { currentNotes } = await import("../server/src/trackers/places");

ensureDirs();
loadMasterKey();
openDb();
pauseJobs(true);

const which = opt("--chat");
const chats = all<{ id: string; title: string }>("SELECT id, title FROM chats WHERE deleted_at IS NULL ORDER BY updated_at DESC").filter((c) => !which || c.id === which || c.title.toLowerCase().includes(which.toLowerCase()));
const L: string[] = [];
for (const c of chats) {
  const st = currentFold(c.id).result.state;
  const written = new Set(
    all<{ to: string }>("SELECT lower(json_extract(op, '$.args.to')) AS \"to\" FROM tracker_events WHERE chat_id = ? AND json_extract(op, '$.op') = 'at'", c.id)
      .map((r) => r.to)
      .filter(Boolean),
  );
  const places = Object.values(st.places);
  if (!places.length) continue;
  L.push(`## ${c.title}`, "", `${written.size} different paths written → ${places.length} places (${places.filter((p) => !p.parent).length} at the top)`, "");
  const kids = (id: string | undefined) => places.filter((p) => p.parent === id).sort((a, b) => b.visits - a.visits);
  const walk = (id: string | undefined, depth: number) => {
    for (const p of kids(id)) {
      const notes = currentNotes(p).length;
      L.push(`${"  ".repeat(depth)}- **${p.name}** (${p.kind ?? "?"}, ${p.visits} visits${p.aliases?.length ? `; also ${p.aliases.join(" · ")}` : ""}${p.address ? `; on ${p.address}` : ""}${notes ? `; ${notes} notes` : ""})`);
      walk(p.id, depth + 1);
    }
  };
  walk(undefined, 0);
  L.push("");
}
closeDb();
const text = L.join("\n");
if (opt("--out")) writeFileSync(opt("--out")!, text);
else console.log(text);
