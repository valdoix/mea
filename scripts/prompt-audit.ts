/**
 * Reliable state 4.1 (docs/16): the prompt the next reply in a chat would get, and for every tracker
 * secret, what the tracker says and every prompt line that mentions it. Lines that still call a
 * secret hidden after it came out are marked. It works on a copy of the database (`VACUUM INTO`),
 * so the running app's data is only read.
 *
 *   bun scripts/prompt-audit.ts <chat id or part of its title> [--full] [--json] [--db path/to/mea.db]
 */
import { copyFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { Database } from "bun:sqlite";

const args = process.argv.slice(2);
const flag = (f: string) => args.includes(f);
const opt = (f: string) => (args.includes(f) ? args[args.indexOf(f) + 1] : undefined);
const which = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--db");
if (!which) {
  console.error("Usage: bun scripts/prompt-audit.ts <chat id or title> [--full] [--json] [--db path/to/mea.db]");
  process.exit(2);
}

const source = resolve(opt("--db") ?? (process.env.MEA_DATA_DIR ? join(process.env.MEA_DATA_DIR, "mea.db") : join(import.meta.dir, "..", "data", "mea.db")));
if (!existsSync(source)) {
  console.error(`No database at ${source}`);
  process.exit(2);
}
const dir = mkdtempSync(join(tmpdir(), "mea-audit-"));
new Database(source, { readonly: true }).exec(`VACUUM INTO '${join(dir, "mea.db").replace(/'/g, "''")}'`);
if (existsSync(join(dirname(source), "mea.key"))) copyFileSync(join(dirname(source), "mea.key"), join(dir, "mea.key"));
process.env.MEA_DATA_DIR = dir;
process.env.MEA_OFFLINE = "1";

const { ensureDirs, paths } = await import("../server/src/config");
const { all, closeDb, openDb } = await import("../server/src/db/db");
const { loadMasterKey } = await import("../server/src/lib/crypto");
const { pauseJobs } = await import("../server/src/services/jobs");
const { prepare } = await import("../server/src/services/generation");
const { currentFold } = await import("../server/src/trackers/store");
const { contentWords } = await import("../server/src/memory/text");

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
  const p = await prepare(chat.id, "story");
  const prompt = p.assembled.messages.map((m) => `[${m.role}]\n${typeof m.content === "string" ? m.content : JSON.stringify(m.content)}`).join("\n\n");
  const lines = prompt.split("\n").map((text, i) => ({ n: i + 1, text })).filter((l) => l.text.trim());

  const st = currentFold(chat.id).result.state;
  const nm = (id: string) => st.chars[id]?.name ?? id;
  // A line that says someone doesn't know, or that only some do.
  const HIDDEN = /\b(?:doesn['’]t know|does not (?:yet )?know|has no idea|told no one|has told no ?one|known only to|secret(?:ly)?)\b/i;
  const about = (statement: string, text: string) => {
    const S = contentWords(statement);
    const T = contentWords(text);
    const hits = [...S].filter((w) => T.has(w)).length;
    // Most of the secret's own words, so a short line that only names its people doesn't count.
    return hits >= 2 && hits / S.size >= 0.75;
  };
  // Sentences the [CORRECTIONS] lane already answers ("The card says: "…" — written before #67").
  const answered = [...prompt.matchAll(/The card says: "(.{20,60})/g)].map((m) => m[1]!.replace(/^- /, ""));
  const secrets = Object.values(st.facts)
    .filter((f) => f.secret || f.revealed.length)
    .map((f) => {
      const revealedTo = [...new Set(f.revealed.flatMap((r) => r.to))].map(nm);
      const out = Boolean(f.revealed.length) && !f.secret?.from.length;
      return {
        key: f.key,
        statement: f.statement,
        keepers: (f.secret?.keepers ?? []).map(nm),
        hiddenFrom: (f.secret?.from ?? []).map(nm),
        everyone: Boolean(f.secret?.everyone),
        revealedTo,
        out,
        lines: lines
          .filter((l) => about(f.statement, l.text))
          .map((l) => ({ n: l.n, text: l.text.trim().slice(0, 240), answered: answered.some((a) => l.text.includes(a)), stale: Boolean(revealedTo.length) && HIDDEN.test(l.text) && !/no longer a secret|since revealed|came out|written before #\d+|since then \(#/i.test(l.text) })),
      };
    });

  if (flag("--json")) {
    console.log(JSON.stringify({ chat, tokens: p.assembled.estPromptTokens, secrets, outdated: p.assembled.trace.outdated ?? [], ...(flag("--full") ? { prompt } : {}) }, null, 2));
  } else {
    console.log(`${chat.title || "Untitled story"} (${chat.id}) · about ${p.assembled.estPromptTokens} tokens\n`);
    for (const s of secrets) {
      const state = s.out ? `out (revealed to ${s.revealedTo.join(", ")})` : `kept by ${s.keepers.join(", ") || "?"} from ${s.everyone ? "everyone else" : s.hiddenFrom.join(", ") || "nobody"}${s.revealedTo.length ? `; revealed to ${s.revealedTo.join(", ")}` : ""}`;
      console.log(`#${s.key}: ${s.statement}\n  ${state}`);
      for (const l of s.lines) console.log(`  ${l.stale ? (l.answered ? "fixed" : "STALE") : "     "} ${String(l.n).padStart(5)}  ${l.text}`);
      if (!s.lines.length) console.log("        (not in the prompt)");
      console.log();
    }
    const stale = secrets.reduce((n, s) => n + s.lines.filter((l) => l.stale && !l.answered).length, 0);
    const fixed = secrets.reduce((n, s) => n + s.lines.filter((l) => l.stale && l.answered).length, 0);
    console.log(`${stale ? `${stale} line${stale === 1 ? "" : "s"} still call a revealed secret hidden.` : "No line calls a revealed secret hidden unanswered."}${fixed ? ` ${fixed} more ${fixed === 1 ? "is" : "are"} answered by [CORRECTIONS].` : ""}`);
    // Part 3: what the prompt check found and answered (the Inspector's "Out of date").
    const outdated = p.assembled.trace.outdated ?? [];
    console.log(`\nOut of date, answered in the prompt: ${outdated.length || "nothing"}`);
    for (const o of outdated) console.log(`  ${o.where} · #${o.seq} · "${o.sentence.slice(0, 120)}"\n    → ${o.now.slice(0, 160)}`);
    if (flag("--full")) console.log(`\n${"─".repeat(60)}\n${prompt}`);
  }
} finally {
  pauseJobs(false);
  closeDb();
  if (!flag("--keep")) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      console.error(`(left the copy at ${dir})`);
    }
  }
}
process.exit(0);
