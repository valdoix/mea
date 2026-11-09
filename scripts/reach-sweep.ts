/**
 * docs/31 4.1: which older tracker lines reached people who weren't there, story by story. Read-only:
 * it runs on a throwaway copy of the database (VACUUM INTO) with every connection taken out, so the
 * running app's data is only read and nothing can reach a provider.
 *
 *   bun scripts/reach-sweep.ts [chat id or part of its title] [--db path/to/mea.db] [--all] [--json out.json]
 *
 * Without a chat it reports every story with tracker lines; `--all` lists every finding instead of the first 15.
 */
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Database } from "bun:sqlite";

const args = process.argv.slice(2);
const opt = (f: string) => (args.includes(f) ? args[args.indexOf(f) + 1] : undefined);
const OPTIONS = new Set(["--db", "--json"]);
const which = args.find((a, i) => !a.startsWith("--") && !OPTIONS.has(args[i - 1] ?? ""));
const source = resolve(opt("--db") ?? (process.env.MEA_DATA_DIR ? join(process.env.MEA_DATA_DIR, "mea.db") : join(import.meta.dir, "..", "data", "mea.db")));
if (!existsSync(source)) {
  console.error(`No database at ${source}`);
  process.exit(2);
}

const dir = mkdtempSync(join(tmpdir(), "mea-sweep-"));
const copy = join(dir, "mea.db");
console.error(`Copying ${source}…`);
new Database(source, { readonly: true }).exec(`VACUUM INTO '${copy.replace(/'/g, "''")}'`);
{
  const db = new Database(copy);
  db.exec("DELETE FROM connections");
  db.close();
}
process.env.MEA_DATA_DIR = dir;

try {
  const { ensureDirs } = await import("../server/src/config");
  const { all, openDb } = await import("../server/src/db/db");
  const { reachSweep } = await import("../server/src/trackers/sweep");
  ensureDirs();
  openDb(copy);
  const chats = all<{ id: string; title: string }>(
    "SELECT c.id, c.title FROM chats c WHERE c.deleted_at IS NULL AND EXISTS (SELECT 1 FROM tracker_events e WHERE e.chat_id = c.id AND e.source IN ('model', 'inline')) ORDER BY c.last_message_at DESC",
  ).filter((c) => !which || c.id === which || c.title.toLowerCase().includes(which.toLowerCase()));
  if (!chats.length) {
    console.error(`No story matches "${which}"`);
    process.exit(2);
  }
  const report: Record<string, unknown> = {};
  for (const c of chats) {
    const t = performance.now();
    const found = reachSweep(c.id);
    const ms = Math.round(performance.now() - t);
    report[c.id] = { title: c.title, ms, findings: found };
    const people = found.reduce((n, x) => n + x.away.length + x.unsure.length, 0);
    console.log(`\n${c.title || c.id} · ${found.length} line${found.length === 1 ? "" : "s"}, ${people} stance${people === 1 ? "" : "s"} · ${(ms / 1000).toFixed(1)}s`);
    for (const x of args.includes("--all") ? found : found.slice(0, 15)) {
      console.log(`  #${x.seq}  ${x.line.slice(0, 140)}`);
      if (x.away.length) console.log(`        not reached: ${x.away.join(", ")}`);
      if (x.unsure.length) console.log(`        named, not there: ${x.unsure.join(", ")}`);
    }
    if (!args.includes("--all") && found.length > 15) console.log(`  … and ${found.length - 15} more (--all)`);
  }
  const out = opt("--json");
  if (out) writeFileSync(out, JSON.stringify(report, null, 1));
} finally {
  const { closeDb } = await import("../server/src/db/db");
  closeDb();
  rmSync(dir, { recursive: true, force: true });
}
