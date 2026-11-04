/**
 * Recall against a test set (docs/26 Part 4, docs/27 Part 1): for real turns of a story, did the
 * memories (or old messages) that turn needed reach the recall block? Run it before changing how
 * recall ranks or shares its budget.
 *
 *   MEA_DATA_DIR=<a copy of the data folder> MEA_KEY_FILE=<the real mea.key> bun scripts/recall-eval.ts <cases.json> [--detail] [--displaced]
 *
 * Always point MEA_DATA_DIR at a copy holding only the embedding connection: query vectors are the one
 * thing this pays for (cached in the copy's folder, so each text is paid for once). The cases name a
 * story's turns and its memories, so they live outside the repo.
 *
 * A case's `expect` lists memory ids (or their first eight characters) and `msg:<seq>` for a message
 * no memory holds; it hits when any of them reaches the block, a message as a quote. Cases with a
 * `found` field were found without vectors or keyword search, so they're scored apart: a change that
 * only helps the cases it was tuned on shows up as a gain on the earlier set alone.
 *
 * Variants come from RECALL_VARIANTS (JSON). "as it stands" and "vectors off" always run first.
 * --displaced lists, per turn, what each variant added to the writer's block and what it pushed out.
 * The first variant also says how often deep search reached back; RECALL_SIGNALS=1 prints, per turn,
 * the signals that decide it (names found, rare words shared, how far the best match stands out).
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { all, openDb } from "../server/src/db/db";
import { loadMasterKey } from "../server/src/lib/crypto";
import { type MemoryConfig, memoryConfig } from "../server/src/lib/settings";
import { embedQueries } from "../server/src/memory/embed";
import { norm, placeName, resolver } from "../server/src/memory/entities";
import { type RecallItem, TimeIndex } from "../server/src/memory/format";
import { buildQueries, recall } from "../server/src/memory/recall";
import { hashText } from "../server/src/memory/text";
import { historyForPrompt } from "../server/src/services/chats";
import { foldAt } from "../server/src/trackers/store";

interface Case {
  kind: string;
  seq: number;
  expect: string[];
  why: string;
  /** How the case was found, when not from the earlier set: "callback" or "slip". */
  found?: string;
}

const dir = process.env.MEA_DATA_DIR;
const file = process.argv[2];
if (!dir || !file) throw new Error("Usage: MEA_DATA_DIR=<copy> MEA_KEY_FILE=<key> bun scripts/recall-eval.ts <cases.json> [--detail] [--displaced]");
if (process.env.MEA_KEY_FILE) loadMasterKey(process.env.MEA_KEY_FILE);
openDb(join(dir, "mea.db"));
const set = JSON.parse(readFileSync(file, "utf8")) as { chatId: string; pov?: string; cases: Case[] };
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

// Whose story it is, as the prompt builder sees it (memoryInputs): the character's names and aliases
// keep the point of view, and neither the character nor you gets an entity card.
const chat = all<{ char: string | null; user: string | null }>(
  "SELECT ch.name AS char, p.name AS user FROM chats c LEFT JOIN characters ch ON ch.id = c.character_id LEFT JOIN personas p ON p.id = c.persona_id WHERE c.id = ?",
  C,
)[0];
const povName = set.pov ?? chat?.char ?? "";
const res = resolver(C);
const me = res.find(povName);
const povNames = new Set([povName, ...(me ? res.namesOf(me) : [])].map(norm).filter(Boolean));
const skipCards = new Set([povName, chat?.user ?? ""].map(norm).filter(Boolean));

const memories = all<{ id: string; min_seq: number | null; scene_id: string | null }>("SELECT id, min_seq, scene_id FROM memories WHERE chat_id = ? AND deleted_at IS NULL AND status IN ('active', 'disputed')", C);
const messages = new Map(all<{ id: string; seq: number }>("SELECT id, seq FROM messages WHERE chat_id = ? AND deleted_at IS NULL", C).map((m) => [m.seq, m.id]));
const history = historyForPrompt(C);
const times = new TimeIndex(C);

/** What a case wants, resolved: a memory (with its scene, which may carry it in less detail) or a message. */
interface Want {
  id: string;
  scene: string | null;
  seq: number;
}
function resolveWant(e: string): Want | null {
  const msg = /^msg:(\d+)$/.exec(e);
  if (msg) {
    const id = messages.get(Number(msg[1]));
    return id ? { id, scene: null, seq: Number(msg[1]) } : null;
  }
  const m = memories.find((a) => a.id.startsWith(e));
  return m ? { id: m.id, scene: m.scene_id, seq: m.min_seq ?? 0 } : null;
}

interface Turn {
  c: Case;
  evicted: number;
  budget: number;
  telescope: Set<string>;
  queries: ReturnType<typeof buildQueries>;
  qvecs: (Float32Array | null)[];
  present: string[];
  mood: string | null;
  want: Want[];
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
    // What was still in the window that turn was on the page: not recall's to find.
    const want = c.expect.map(resolveWant).filter((w): w is Want => Boolean(w) && w!.seq <= m.evictedThrough);
    if (!want.length) {
      dropped.push(`#${c.seq} ${c.why}: still in the window, or gone`);
      continue;
    }
    const st = foldAt(C, { uptoSeq: c.seq - 1 }).state;
    const present = [
      ...Object.values(st.chars)
        .filter((x) => !x.isUser && !x.dead && (x.tier === "spot" || x.tier === "peri"))
        .map((x) => x.name),
      ...(st.place.length ? [placeName(st.place).name] : []),
    ];
    const main = Object.values(st.chars).find((x) => x.isMain || povNames.has(norm(x.name)));
    const queries = buildQueries(history.filter((x) => x.seq! < c.seq), { present });
    turns.push({ c, evicted: m.evictedThrough, budget: m.recallBudget, telescope: new Set(m.telescope.map((t) => t.id)), queries, qvecs: await vectors(queries.map((q) => q.text)), present, mood: main?.mood?.name ?? null, want });
  }
  return { turns, dropped };
}

/** One way of running recall: settings to change, how much of the prompt target it gets, and whether it has vectors. */
interface Variant {
  name: string;
  cfg?: Partial<MemoryConfig>;
  scale?: number;
  vectors?: boolean;
  /** How many closest-in-meaning memories get a slot of their own (recall's default when unset). */
  closest?: number;
  /** Below this standout recall counts as weak and deep search reaches back (recall's default when unset). */
  weakStandout?: number;
  reachBackFrom?: number;
}

function run(t: Turn, v: Variant, budget?: number) {
  const cfg = { ...memoryConfig(), ...v.cfg } as MemoryConfig;
  return recall({
    chatId: C,
    evicted: t.evicted,
    budget: Math.round((budget ?? t.budget) * (v.scale ?? 1)),
    queries: t.queries,
    qvecs: v.vectors === false ? t.qvecs.map(() => null) : t.qvecs,
    excludeSummaryIds: t.telescope,
    seed: `${C}:${t.c.seq}`,
    cfg: { ...cfg, librarian: false },
    pov: { names: povNames, label: povName },
    present: t.present,
    mood: t.mood,
    librarian: null,
    times,
    skipCards,
    povName,
    closest: v.closest,
    weakStandout: v.weakStandout,
    reachBackFrom: v.reachBackFrom,
  });
}

const groupOf = (c: Case) => (c.found ? "independent" : "earlier");

function score(turns: Turn[], v: Variant, budget?: number) {
  const kinds = new Map<string, { n: number; hit: number }>();
  const groups = new Map<string, { n: number; hit: number; covered: number }>();
  const missed: string[] = [];
  const tokens = { memory: 0, summary: 0, other: 0 };
  const blocks: RecallItem[][] = [];
  const standouts: number[] = [];
  const reached = { "cue words": 0, "weak recall": 0, quoted: 0 };
  for (const t of turns) {
    const { items, stats } = run(t, v, budget);
    blocks.push(items);
    if (stats.standout !== null) standouts.push(stats.standout);
    if (stats.reachedBack) reached[stats.reachedBack]++;
    if (items.some((i) => i.slot === "deep")) reached.quoted++;
    if (process.env.RECALL_SIGNALS && budget === undefined) console.log(`    signals #${t.c.seq}: named ${stats.named}, rare ${stats.rareWords}, standout ${stats.standout?.toFixed(2)}, evicted ${t.evicted}`);
    const ids = new Set(items.map((i) => i.id));
    const hit = t.want.some((w) => ids.has(w.id));
    // Its scene's summary or the telescope may carry the same thing, in less detail.
    const covered = hit || t.want.some((w) => w.scene && (ids.has(w.scene) || t.telescope.has(w.scene)));
    const k = kinds.get(t.c.kind) ?? { n: 0, hit: 0 };
    k.n++;
    if (hit) k.hit++;
    kinds.set(t.c.kind, k);
    const g = groups.get(groupOf(t.c)) ?? { n: 0, hit: 0, covered: 0 };
    g.n++;
    if (hit) g.hit++;
    if (covered) g.covered++;
    groups.set(groupOf(t.c), g);
    if (!hit) missed.push(`#${t.c.seq} ${t.c.why}${t.c.found ? ` [${t.c.found}]` : ""}`);
    for (const i of items) tokens[i.ownerType === "memory" ? "memory" : i.ownerType === "summary" ? "summary" : "other"] += i.tokens;
  }
  return { kinds, groups, missed, tokens, blocks, standouts, reached };
}

const BASE: Variant[] = [{ name: "as it stands" }, { name: "vectors off", vectors: false }];
const extra: Variant[] = JSON.parse(process.env.RECALL_VARIANTS ?? "[]");
const VARIANTS = [...BASE, ...extra.filter((v) => !BASE.some((b) => b.name === v.name))];
const detail = process.argv.includes("--detail");
const displaced = process.argv.includes("--displaced");
const { turns, dropped } = await prepareTurns();
console.log(`${set.chatId.slice(0, 8)} as ${povName}: ${turns.length} cases${dropped.length ? `, ${dropped.length} set aside:\n  ${dropped.join("\n  ")}` : ""}`);
const kindNames = [...new Set(turns.map((t) => t.c.kind))];
const groupNames = ["earlier", "independent"].filter((g) => turns.some((t) => groupOf(t.c) === g));
const pct = (a: number, b: number) => `${Math.round((100 * a) / (b || 1))}%`;
const short = (i: RecallItem) => `[${i.slot}] ${i.ownerType === "memory" ? i.id.slice(0, 8) : i.ownerType}: ${i.content.replace(/\s+/g, " ").slice(0, 110)}`;

for (const [label, budget] of [["writer", undefined], ["planner (2,500 tokens)", 2500]] as const) {
  console.log(`\n== ${label}`);
  console.log(`${"variant".padEnd(26)}${"hit".padEnd(9)}${groupNames.map((g) => g.padEnd(13)).join("")}${kindNames.map((k) => k.padEnd(10)).join("")}${"memory/summary tokens".padEnd(24)}`);
  let baseBlocks: RecallItem[][] | null = null;
  for (const v of VARIANTS) {
    const s = score(turns, v, budget);
    baseBlocks ??= s.blocks;
    const total = [...s.groups.values()].reduce((n, g) => n + g.hit, 0);
    const count = s.tokens.memory + s.tokens.summary + s.tokens.other;
    console.log(
      `${v.name.padEnd(26)}${`${total}/${turns.length}`.padEnd(9)}${groupNames.map((g) => `${s.groups.get(g)?.hit ?? 0}/${s.groups.get(g)?.n ?? 0}`.padEnd(13)).join("")}${kindNames.map((k) => `${s.kinds.get(k)?.hit ?? 0}/${s.kinds.get(k)?.n ?? 0}`.padEnd(10)).join("")}${`${pct(s.tokens.memory, count)} / ${pct(s.tokens.summary, count)}`.padEnd(24)}`,
    );
    if (detail) for (const m of s.missed) console.log(`    missed ${m}`);
    if (detail || v === VARIANTS[0]) {
      const z = [...s.standouts].sort((a, b) => a - b);
      const at = (p: number) => z[Math.min(z.length - 1, Math.floor(p * z.length))]?.toFixed(2) ?? "-";
      console.log(`    reached back on ${s.reached["cue words"] + s.reached["weak recall"]} of ${turns.length} turns (cue words ${s.reached["cue words"]}, weak recall ${s.reached["weak recall"]}), quoted on ${s.reached.quoted}; best match stands out by ${at(0.1)} / ${at(0.2)} / ${at(0.5)} sd (10th / 20th / 50th percentile)`);
    }
    // What a change costs is what it pushes out, and the hit count can't see that: read it by hand.
    if (displaced && budget === undefined && s.blocks !== baseBlocks) {
      turns.forEach((t, n) => {
        const before = new Map(baseBlocks![n]!.map((i) => [i.id, i]));
        const after = new Map(s.blocks[n]!.map((i) => [i.id, i]));
        const added = [...after.values()].filter((i) => !before.has(i.id));
        const out = [...before.values()].filter((i) => !after.has(i.id));
        if (!added.length && !out.length) return;
        console.log(`    #${t.c.seq} ${t.c.why} (${baseBlocks![n]!.length} items, now ${s.blocks[n]!.length})`);
        for (const i of added) console.log(`      + ${short(i)}`);
        for (const i of out) console.log(`      - ${short(i)}`);
      });
    }
  }
}
