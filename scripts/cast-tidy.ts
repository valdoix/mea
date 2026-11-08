/**
 * docs/30 0.6: the cast tidy report. Folds every chat (on a copy of the database: nothing is written
 * to yours, nothing is sent anywhere) and lists who is in each cast, and the names the fold kept off
 * it: places, groups, factions and field names, with who they stood for.
 *
 * Run it once on the old code with `--json before.json`, then on the new code with `--before
 * before.json`, to see who left each cast and where their lines went.
 *
 *   bun scripts/cast-tidy.ts [--db path/to/mea.db] [--chat <id or part of its title>] [--json out.json] [--before before.json] [--out report.md]
 */
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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
const dir = mkdtempSync(join(tmpdir(), "mea-tidy-"));
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
const { castProfiles, currentFold } = await import("../server/src/trackers/store");

ensureDirs();
loadMasterKey();
openDb();
pauseJobs(true);

interface Row {
  id: string;
  title: string;
  people: string[];
  profiles: string[];
  notPeople: { name: string; as: string; members?: string[]; lines: number; firstSeq: number; lastSeq: number }[];
}

const which = opt("--chat");
const chats = all<{ id: string; title: string }>("SELECT id, title FROM chats WHERE deleted_at IS NULL ORDER BY updated_at DESC").filter(
  (c) => !which || c.id === which || c.title.toLowerCase().includes(which.toLowerCase()),
);
const rows: Row[] = [];
for (const c of chats) {
  try {
    const st = currentFold(c.id).result.state as { chars: Record<string, { name: string; isUser: boolean }>; notPeople?: Record<string, Row["notPeople"][number]> };
    rows.push({
      id: c.id,
      title: c.title,
      people: Object.values(st.chars)
        .filter((x) => !x.isUser)
        .map((x) => x.name)
        .sort(),
      profiles: Object.values(castProfiles(c.id)).map((p) => p.name),
      notPeople: Object.values(st.notPeople ?? {}),
    });
  } catch (e) {
    console.error(`${c.title}: ${(e as Error).message}`);
  }
}
closeDb();

if (opt("--json")) writeFileSync(opt("--json")!, JSON.stringify(rows, null, 2));

const before = opt("--before") ? new Map((JSON.parse(readFileSync(opt("--before")!, "utf8")) as Row[]).map((r) => [r.id, r])) : null;
const L: string[] = ["# Cast tidy", ""];
let gone = 0;
for (const r of rows) {
  const was = before?.get(r.id);
  const left = was ? was.people.filter((n) => !r.people.includes(n)) : [];
  const came = was ? r.people.filter((n) => !was.people.includes(n)) : [];
  if (!r.notPeople.length && !left.length && !came.length) continue;
  gone += left.length;
  L.push(`## ${r.title}`, "", `${r.people.length} people${was ? ` (was ${was.people.length})` : ""}`, "");
  if (left.length) L.push(`**Left the cast:** ${left.join(" · ")}`, "");
  if (came.length) L.push(`**New in the cast** (named inside a group): ${came.join(" · ")}`, "");
  const orphans = r.profiles.filter((p) => r.notPeople.some((n) => n.name.toLowerCase() === p.toLowerCase()));
  if (orphans.length) L.push(`**Profiles kept, now without a person:** ${orphans.join(" · ")}`, "");
  if (r.notPeople.length) {
    L.push("| Name | As | Lines | Messages | Stood for |", "|---|---|---|---|---|");
    for (const n of r.notPeople.sort((a, b) => b.lines - a.lines)) L.push(`| ${n.name} | ${n.as} | ${n.lines} | #${n.firstSeq}–#${n.lastSeq} | ${n.members?.join(", ") || "nobody"} |`);
    L.push("");
  }
}
if (before) L.splice(2, 0, `${gone} names left casts across ${rows.length} chats.`, "");
const text = L.join("\n");
if (opt("--out")) writeFileSync(opt("--out")!, text);
else console.log(text);
