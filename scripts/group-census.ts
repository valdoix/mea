/**
 * docs/30 Part 1: the group census. Folds each chat (on a copy of the database: nothing is written to
 * yours, nothing is sent anywhere) and prints its factions as the Story page would show them: yours,
 * the lore's, the story's (adopted by themselves) and the engine's, who lives where, then the groups Mea would ask about.
 *
 *   bun scripts/group-census.ts [--db path/to/mea.db] [--chat <id or part of its title>] [--mode auto|ask|off] [--out groups.md]
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
const dir = mkdtempSync(join(tmpdir(), "mea-groups-"));
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
const { updateChat } = await import("../server/src/services/chats");
const { currentFold, invalidate } = await import("../server/src/trackers/store");
const { factionBook } = await import("../server/src/trackers/factions");

ensureDirs();
loadMasterKey();
openDb();
pauseJobs(true);

const which = opt("--chat");
const mode = opt("--mode") as "auto" | "ask" | "off" | undefined;
const chats = all<{ id: string; title: string }>("SELECT id, title FROM chats WHERE deleted_at IS NULL ORDER BY updated_at DESC").filter((c) => !which || c.id === which || c.title.toLowerCase().includes(which.toLowerCase()));
const L: string[] = [];
for (const c of chats) {
  if (mode) {
    updateChat(c.id, { settings: { groups: { mode } } });
    invalidate(c.id);
  }
  const st = currentFold(c.id).result.state;
  const book = factionBook(c.id, { prose: true, st });
  if (!book.factions.length && !book.suggested.length) continue;
  L.push(`## ${c.title}`, "");
  for (const f of book.factions) {
    const ms = f.members.map((m) => `${m.name}${m.dead ? " †" : ""}${m.left != null ? ` (left #${m.left})` : ""}${m.since ? ` #${m.since}` : ""}`);
    L.push(`- **${f.name}** · ${f.kind} · ${f.source}${f.found ? " (found)" : ""}${f.aliases.length ? ` · also ${f.aliases.join(", ")}` : ""} · lines in ${f.mentions} msgs, text in ${f.prose}`);
    if (ms.length) L.push(`  - members: ${ms.join(", ")}`);
    for (const x of f.facts.slice(0, 3)) L.push(`  - told #${x.seq}: ${x.text}`);
    const s = f.standing;
    if (s.clocks.length || s.rep.length || s.relations.length) L.push(`  - standing: ${[...s.clocks.map((k) => `${k.name} ${k.cur}/${k.max}`), ...s.rep.map((r) => `${r.who} ${r.score}`), ...s.relations.map((r) => `with ${r.with} ${r.score}`)].join(" · ")}`);
  }
  // docs/30 2.4: who lives where.
  const homes = Object.values(st.places).filter((p) => p.residents?.length);
  if (homes.length) {
    L.push("", "Who lives where:");
    for (const p of homes) L.push(`- ${p.path.join(" › ")}: ${p.residents!.map((id) => `${st.chars[id]?.name ?? id}${st.chars[id]?.dead ? " †" : ""}`).join(", ")}`);
  }
  if (book.suggested.length) {
    L.push("", "Mea thinks these are groups:");
    for (const g of book.suggested) L.push(`- ${g.name} · ${g.kind}${g.members.length ? ` (${g.members.join(", ")})` : ""} · lines in ${g.mentions} msgs, text in ${g.prose}`);
  }
  L.push("");
}
const text = L.join("\n");
const out = opt("--out");
if (out) writeFileSync(out, text);
else console.log(text);
closeDb();
