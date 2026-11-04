/**
 * Recall against a test set (docs/26 Part 4): for real turns of a story, did the memories that
 * turn needed reach the recall block? Run it before changing how recall ranks or shares its budget.
 *
 *   MEA_DATA_DIR=<a copy of the data folder> MEA_KEY_FILE=<the real mea.key> bun scripts/recall-eval.ts <cases.json> [--detail]
 *
 * Always point MEA_DATA_DIR at a copy holding only the embedding connection: query vectors are the one
 * thing this pays for (cached in the copy's folder, so each text is paid for once). The cases name a
 * story's turns and its memories, so they live outside the repo.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { all, openDb } from "../server/src/db/db";
import { loadMasterKey } from "../server/src/lib/crypto";
import { type MemoryConfig, memoryConfig } from "../server/src/lib/settings";
import { embedQueries } from "../server/src/memory/embed";
import { norm } from "../server/src/memory/entities";
import { TimeIndex } from "../server/src/memory/format";
import { buildQueries, recall } from "../server/src/memory/recall";
import { hashText } from "../server/src/memory/text";
import { historyForPrompt } from "../server/src/services/chats";
import { foldAt } from "../server/src/trackers/store";

interface Case {
  kind: string;
  seq: number;
  expect: string[];
  why: string;
}

const dir = process.env.MEA_DATA_DIR;
const file = process.argv[2];
if (!dir || !file) throw new Error("Usage: MEA_DATA_DIR=<copy> MEA_KEY_FILE=<key> bun scripts/recall-eval.ts <cases.json> [--detail]");
if (process.env.MEA_KEY_FILE) loadMasterKey(process.env.MEA_KEY_FILE);
openDb(join(dir, "mea.db"));
const set = JSON.parse(readFileSync(file, "utf8")) as { chatId: string; pov: string; cases: Case[] };
const C = set.chatId;

const cachePath = join(dir, "recall-eval-vectors.json");
const cache: Record<string, number[]> = existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, "utf8")) : {};
async function vectors(texts: string[]) {
  const missing = [...new Set(texts)].filter((t) => !cache[hashText(t)]);
  for (let i = 0; i < missing.length; i += 16) {
    const batch = missing.slice(i, i + 16);
    const got = await embedQueries(batch, 30000);
    batch.forEach((t, n) => {
      const v = got[n];
      if (v) cache[hashText(t)] = [...v];
    });
  }
  if (missing.length) {
    writeFileSync(cachePath, JSON.stringify(cache));
    console.log(`embedded ${missing.length} texts, about ${Math.round(missing.reduce((n, t) => n + t.length, 0) / 4)} tokens`);
  }
  return texts.map((t) => (cache[hashText(t)] ? Float32Array.from(cache[hashText(t)]!) : null));
}

const memories = all<{ id: string; min_seq: number | null; scene_id: string | null; known_by: string }>("SELECT id, min_seq, scene_id, known_by FROM memories WHERE chat_id = ? AND deleted_at IS NULL AND status IN ('active', 'disputed')", C);
const full = (short: string) => memories.find((m) => m.id.startsWith(short));
const history = historyForPrompt(C);
const times = new TimeIndex(C);
const povNames = new Set([set.pov, ...set.pov.split(/\s+/)].map(norm));

interface Turn {
  c: Case;
  evicted: number;
  budget: number;
  telescope: Set<string>;
  queries: ReturnType<typeof buildQueries>;
  qvecs: (Float32Array | null)[];
  present: string[];
  mood: string | null;
  want: { id: string; scene: string | null }[];
}

async function prepareTurns(): Promise<{ turns: Turn[]; dropped: string[] }> {
  const turns: Turn[] = [];
  const dropped: string[] = [];
  for (const c of set.cases) {
    const g = all<{ trace: string }>(
      `SELECT g.trace FROM generations g JOIN messages m ON m.id = g.message_id WHERE g.chat_id = ? AND m.seq = ? AND g.task = 'story' AND g.kind IN ('new', 'swipe') AND g.status = 'done' AND g.trace IS NOT NULL ORDER BY g.started_at DESC LIMIT 1`,
      C,
      c.seq,
    )[0];
    const m = g ? (JSON.parse(g.trace) as { memory?: { evictedThrough: number; recallBudget: number; telescope: { id: string }[] } }).memory : undefined;
    if (!m?.evictedThrough) {
      dropped.push(`#${c.seq} ${c.why}: no stored request`);
      continue;
    }
    // A memory still in the window that turn was on the page: not recall's to find.
    const want = c.expect.map(full).filter((a): a is NonNullable<typeof a> => Boolean(a) && (a!.min_seq ?? 0) <= m.evictedThrough);
    if (!want.length) {
      dropped.push(`#${c.seq} ${c.why}: still in the window, or gone`);
      continue;
    }
    const st = foldAt(C, { uptoSeq: c.seq - 1 }).state;
    const present = [...Object.values(st.chars).filter((x) => !x.isUser && !x.dead && (x.tier === "spot" || x.tier === "peri")).map((x) => x.name)];
    const main = Object.values(st.chars).find((x) => povNames.has(norm(x.name)));
    const queries = buildQueries(history.filter((x) => x.seq! < c.seq), { present });
    turns.push({ c, evicted: m.evictedThrough, budget: m.recallBudget, telescope: new Set(m.telescope.map((t) => t.id)), queries, qvecs: await vectors(queries.map((q) => q.text)), present, mood: main?.mood?.name ?? null, want: want.map((a) => ({ id: a.id, scene: a.scene_id })) });
  }
  return { turns, dropped };
}

/** One way of sharing the budget: settings to change, and how much of the prompt target recall gets. */
interface Variant {
  name: string;
  cfg?: Partial<MemoryConfig>;
  scale?: number;
}

function score(turns: Turn[], v: Variant, budget?: number) {
  const cfg = { ...memoryConfig(), ...v.cfg } as MemoryConfig;
  const kinds = new Map<string, { n: number; hit: number; covered: number }>();
  const missed: string[] = [];
  const tokens = { memory: 0, summary: 0, other: 0 };
  let items = 0;
  for (const t of turns) {
    const r = recall({
      chatId: C,
      evicted: t.evicted,
      budget: Math.round((budget ?? t.budget) * (v.scale ?? 1)),
      queries: t.queries,
      qvecs: t.qvecs,
      excludeSummaryIds: t.telescope,
      seed: `${C}:${t.c.seq}`,
      cfg: { ...cfg, librarian: false },
      pov: { names: povNames, label: set.pov },
      present: t.present,
      mood: t.mood,
      librarian: null,
      times,
      skipCards: new Set([norm(set.pov), "gabriel winters"]),
      povName: set.pov,
    });
    const ids = new Set(r.items.map((i) => i.id));
    const hit = t.want.some((w) => ids.has(w.id));
    // Its scene's summary or the telescope may carry the same thing, in less detail.
    const covered = hit || t.want.some((w) => w.scene && (ids.has(w.scene) || t.telescope.has(w.scene)));
    const k = kinds.get(t.c.kind) ?? { n: 0, hit: 0, covered: 0 };
    k.n++;
    if (hit) k.hit++;
    if (covered) k.covered++;
    kinds.set(t.c.kind, k);
    if (!hit) missed.push(`#${t.c.seq} ${t.c.why}`);
    for (const i of r.items) {
      tokens[i.ownerType === "memory" ? "memory" : i.ownerType === "summary" ? "summary" : "other"] += i.tokens;
      items++;
    }
  }
  return { kinds, missed, tokens, items };
}

const VARIANTS: Variant[] = JSON.parse(process.env.RECALL_VARIANTS ?? '[{"name":"as it stands"}]');
const detail = process.argv.includes("--detail");
const { turns, dropped } = await prepareTurns();
console.log(`${turns.length} cases${dropped.length ? `, ${dropped.length} set aside:\n  ${dropped.join("\n  ")}` : ""}`);
for (const [label, budget] of [["writer", undefined], ["planner (2,500 tokens)", 2500]] as const) {
  console.log(`\n== ${label}`);
  const kindNames = [...new Set(turns.map((t) => t.c.kind))];
  console.log(`${"variant".padEnd(26)}${"hit".padEnd(9)}${"covered".padEnd(9)}${kindNames.map((k) => k.padEnd(10)).join("")}${"memory/summary tokens".padEnd(24)}`);
  for (const v of VARIANTS) {
    const s = score(turns, v, budget);
    const total = [...s.kinds.values()].reduce((n, k) => n + k.hit, 0);
    const covered = [...s.kinds.values()].reduce((n, k) => n + k.covered, 0);
    const n = turns.length;
    const count = s.tokens.memory + s.tokens.summary + s.tokens.other || 1;
    console.log(`${v.name.padEnd(26)}${`${total}/${n}`.padEnd(9)}${`${covered}/${n}`.padEnd(9)}${kindNames.map((k) => `${s.kinds.get(k)?.hit ?? 0}/${s.kinds.get(k)?.n ?? 0}`.padEnd(10)).join("")}${`${Math.round((100 * s.tokens.memory) / count)}% / ${Math.round((100 * s.tokens.summary) / count)}%`.padEnd(24)}`);
    if (detail) for (const m of s.missed) console.log(`    missed ${m}`);
  }
}
