/**
 * docs/22 0.1: the prompts behind any reply, rebuilt as of that moment. The story is rewound to just
 * before the message on a throwaway copy of the database, with every connection taken out, so nothing
 * here can reach a provider and the running app's data is only read. The prompts are built by today's
 * code from what the story knew then. Memory the copy keeps from later is what a rewind keeps.
 *
 * `--accept-backfill` says yes to every loop the rules find, for how the prompts read once a chat's card is approved.
 *
 *   bun scripts/replay.ts <chat id or part of its title> --seq 629 [--find "still unsaid"] [--out dir] [--db path/to/mea.db] [--accept-backfill]
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Database } from "bun:sqlite";

const args = process.argv.slice(2);
const opt = (f: string) => (args.includes(f) ? args[args.indexOf(f) + 1] : undefined);
const OPTIONS = new Set(["--seq", "--find", "--out", "--db"]);
const which = args.find((a, i) => !a.startsWith("--") && !OPTIONS.has(args[i - 1] ?? ""));
const acceptBackfill = args.includes("--accept-backfill");
const seq = Number(opt("--seq"));
if (!which || !Number.isInteger(seq) || seq < 1) {
  console.error('Usage: bun scripts/replay.ts <chat id or title> --seq 629 [--find "text"] [--out dir] [--db path/to/mea.db]');
  process.exit(2);
}

const source = resolve(opt("--db") ?? (process.env.MEA_DATA_DIR ? join(process.env.MEA_DATA_DIR, "mea.db") : join(import.meta.dir, "..", "data", "mea.db")));
if (!existsSync(source)) {
  console.error(`No database at ${source}`);
  process.exit(2);
}

const dir = mkdtempSync(join(tmpdir(), "mea-replay-"));
const copy = join(dir, "mea.db");
new Database(source, { readonly: true }).exec(`VACUUM INTO '${copy.replace(/'/g, "''")}'`);
{
  // Before any of the app loads: profiles stay, for their budgets, and go to the mock below.
  const db = new Database(copy);
  db.exec("DELETE FROM connections");
  db.close();
}
process.env.MEA_DATA_DIR = dir;
process.env.MEA_OFFLINE = "1";
// The mock provider, which is all this copy may use, is only there in development mode.
process.env.MEA_DEV = "1";

const { ensureDirs, paths } = await import("../server/src/config");
const { all, closeDb, one, openDb, run } = await import("../server/src/db/db");
const { loadMasterKey } = await import("../server/src/lib/crypto");
const { countTokens } = await import("../server/src/lib/tokens");
const { onRewind } = await import("../server/src/memory/scheduler");
const { setMemState, storyRow } = await import("../server/src/memory/store");
const { applyBackfill, loopCandidates } = await import("../server/src/accuracy/loopinbox");
const { historyForPrompt, rewindAfter } = await import("../server/src/services/chats");
const { createConnection, syncModels } = await import("../server/src/services/connections");
const { prepare } = await import("../server/src/services/generation");
const { pauseJobs } = await import("../server/src/services/jobs");
const { advisorInput, steerFor } = await import("../server/src/steer/advisor");
const { standing } = await import("../server/src/trackers/stands");
const { checkPlan, pendingDone, planCorrection } = await import("../server/src/steer/plancheck");
const { currentFold } = await import("../server/src/trackers/store");

/** The heading a position in a prompt falls under: "### Chapter: …", "[STAKES]", "STORY STATE:". */
function section(text: string, at: number) {
  const head = [...text.slice(0, at).matchAll(/^(#{2,3} .+|\[[A-Z][^\]\n]*\].*|[A-Z][A-Z' ]{3,}[:(].*)$/gm)].at(-1)?.[0];
  return head ? head.slice(0, 70) : "(top)";
}

function find(what: string, needle: string, text: string) {
  const low = text.toLowerCase();
  const hits: string[] = [];
  for (let i = low.indexOf(needle); i >= 0; i = low.indexOf(needle, i + needle.length)) hits.push(`  ${what} · ${section(text, i)}\n    …${text.slice(Math.max(0, i - 70), i + needle.length + 70).replace(/\s+/g, " ")}…`);
  return hits;
}

try {
  ensureDirs();
  openDb();
  loadMasterKey(paths.keyFile);
  pauseJobs(true);

  const chats = all<{ id: string; title: string }>("SELECT id, title FROM chats WHERE deleted_at IS NULL");
  const matches = chats.filter((c) => c.id === which || c.id.startsWith(which) || c.title.toLowerCase().includes(which.toLowerCase()));
  if (matches.length !== 1) {
    console.error(matches.length ? `"${which}" matches ${matches.length} chats:\n${matches.map((c) => `  ${c.id}  ${c.title}`).join("\n")}` : `No chat matches "${which}"`);
    process.exit(2);
  }
  const chat = matches[0]!;
  const target = one<{ id: string; created_at: number }>("SELECT id, created_at FROM messages WHERE chat_id = ? AND seq = ? AND deleted_at IS NULL", chat.id, seq);
  const before = one<{ id: string; seq: number }>("SELECT id, seq FROM messages WHERE chat_id = ? AND seq < ? AND deleted_at IS NULL ORDER BY seq DESC LIMIT 1", chat.id, seq);
  if (!target || !before) {
    console.error(`"${chat.title}" has no message #${seq} with one before it`);
    process.exit(2);
  }

  // The plan that message was written from, as it was stored.
  const wrote = one<{ s: number | null }>("SELECT MIN(started_at) AS s FROM generations WHERE message_id = ? AND task = 'story'", target.id)?.s ?? target.created_at;
  const stored = one<{ response: string | null }>("SELECT response FROM generations WHERE chat_id = ? AND kind = 'planner' AND status = 'done' AND started_at < ? ORDER BY started_at DESC LIMIT 1", chat.id, wrote)?.response;

  // Everything after is gone, as if the story had stopped here: an excluded message alone leaves what came after it in the fold.
  rewindAfter(before.id);
  onRewind(chat.id, before.seq);

  if (acceptBackfill) {
    setMemState(chat.id, { loopBackfill: { state: "review", at: Date.now(), ...loopCandidates(chat.id, currentFold(chat.id).result.state) } });
    applyBackfill(chat.id);
  }

  // `prepare` needs a model: the mock, on the profiles the chat's budgets come from.
  const mock = createConnection({ name: "Replay", kind: "mock", billing: "subscription" });
  await syncModels(mock);
  run("UPDATE profiles SET connection_id = ?, model_id = 'mock/storyteller'", mock);
  const live = one<{ n: number }>("SELECT COUNT(*) AS n FROM connections WHERE kind != 'mock'")?.n ?? 0;
  if (live) throw new Error("A real connection survived in the copy: stopping");

  const history = historyForPrompt(chat.id);
  const planner = await advisorInput(chat.id, history, undefined, { ...steerFor(chat.id), planner: true });
  const prepared = await prepare(chat.id, "story");
  const writer = prepared.assembled.messages.map((m) => `[${m.role}]\n${typeof m.content === "string" ? m.content : JSON.stringify(m.content)}`).join("\n\n");

  const st = currentFold(chat.id).result.state;
  const story = storyRow(chat.id);
  console.log(`Replay of "${chat.title}" at #${seq}: the story through #${before.seq}, ${st.time ? `story time ${st.time.minutes}` : "no clock"}`);
  console.log(`  Story So Far: ${story?.end_seq != null ? `through #${story.end_seq}, ${before.seq - story.end_seq} messages behind` : "none"}`);
  console.log(`  Planner input: ${planner.user.length.toLocaleString()} characters`);
  console.log(`  Writer prompt: ${writer.length.toLocaleString()} characters`);
  const { stands, happened } = standing(chat.id, st, history.slice(-4).map((m) => m.content).join("\n"));
  console.log(`\n[WHERE THINGS STAND] ${countTokens(stands)} tokens\n${stands}\n\n[ALREADY HAPPENED] ${countTokens(happened)} tokens\n${happened}`);

  if (stored) {
    let pass = "";
    let text = stored;
    try {
      const p = JSON.parse(stored.replace(/^[^{]*/, "").replace(/[^}]*$/, "")) as { pass?: string; direction?: string; beats?: string[]; threads?: string[] };
      pass = p.pass ?? "";
      text = [p.pass, p.direction, ...(p.beats ?? []), ...(p.threads ?? [])].filter(Boolean).join("\n");
    } catch {
      // A plan that isn't JSON is read as it stands.
    }
    const found = [...checkPlan(st, pass || text), ...pendingDone(chat.id, st, text)];
    console.log(`\nThe stored plan for #${seq}: ${found.length ? `${found.length} finding${found.length > 1 ? "s" : ""}` : "nothing found"}`);
    if (found.length) console.log(planCorrection(found));
  } else console.log(`\nNo stored plan for #${seq}.`);

  const needle = opt("--find")?.toLowerCase();
  if (needle) {
    const hits = [...find("planner", needle, planner.user), ...find("writer", needle, writer)];
    console.log(`\n"${opt("--find")}": ${hits.length} found`);
    if (hits.length) console.log(hits.join("\n"));
  }
  const out = opt("--out");
  if (out) {
    mkdirSync(resolve(out), { recursive: true });
    writeFileSync(join(resolve(out), "planner.txt"), `${planner.system}\n\n${planner.user}`);
    writeFileSync(join(resolve(out), "writer.txt"), writer);
    console.log(`\nWrote planner.txt and writer.txt to ${resolve(out)}`);
  }
} finally {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
}
