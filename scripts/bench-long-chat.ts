/**
 * The long-chat benchmark (the review of 2026-10-12): Mea's recall and trackers had only ever met
 * short chats for real. This builds a synthetic story far longer than any so far (5,000 messages,
 * 3,000 memories with vectors, 125 scene records, a tracker ledger on every other message) in a
 * throwaway database on the mock provider, then times preparing the next reply the way a send
 * does. Over budget fails (CI runs it with the other budgets).
 *
 *   bun run bench
 *
 * Vectors are 256 numbers here (the mock's size); a real 1024-size model makes the vector part of
 * recall about four times dearer, which the budgets leave room for.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.MEA_DATA_DIR = mkdtempSync(join(tmpdir(), "mea-bench-"));
process.env.MEA_DEV = "1";
process.env.MEA_MOCK_DELAY = "0";
process.env.MEA_OFFLINE = "1";

const MESSAGES = 5000;
const MEMORIES = 3000;
const SCENE_SIZE = 40;
const DIMS = 256;
/**
 * Budgets in ms, for the median of the warm runs (a send after the first). About twice what a
 * desktop PC takes, for slower CI runners. The story's small vocabulary makes every memory match
 * every keyword query, so recall here is a worst case.
 */
const BUDGET = { totalMs: 1200, retrievalMs: 600, trackersMs: 300, assemblyMs: 250 };
/** The first preparation after opening the chat (caches cold) gets more room. */
const COLD_BUDGET_MS = 3000;

const { randomBytes } = await import("node:crypto");
const { ensureDirs } = await import("../server/src/config");
const { newId, now, openDb, run, tx } = await import("../server/src/db/db");
const { setMasterKey } = await import("../server/src/lib/crypto");
const { defaultMemoryConfig, setSetting } = await import("../server/src/lib/settings");
const { normalizeCard } = await import("../server/src/cards/card");
const { createCharacter } = await import("../server/src/services/characters");
const { addMessage, createChat, updateChat } = await import("../server/src/services/chats");
const { createConnection, createProfile, syncModels } = await import("../server/src/services/connections");
const { pauseJobs } = await import("../server/src/services/jobs");
const { previewPrompt } = await import("../server/src/services/generation");
const { insertAtom } = await import("../server/src/memory/atoms");
const { setMemState } = await import("../server/src/memory/store");
const { linesToOps, writeEvents } = await import("../server/src/trackers/store");

ensureDirs();
setMasterKey(randomBytes(32));
openDb(":memory:");
pauseJobs(true);

// A seeded generator, so every run builds the same story.
let seed = 0x9e3779b9;
const rand = () => {
  seed = Math.imul(seed ^ (seed >>> 15), 2246822507);
  seed = Math.imul(seed ^ (seed >>> 13), 3266489909);
  return ((seed ^= seed >>> 16) >>> 0) / 4294967296;
};
const pick = <T>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)]!;
const PEOPLE = ["Mira", "Kael", "Joss", "Alder", "Wren", "Tamsin", "Corvin", "Isolde", "Bram", "Seren"] as const;
const PLACES = ["the harbor", "the lighthouse", "the tavern", "the old mill", "the cliffs", "the market", "the chapel", "the forge"] as const;
const THINGS = ["the brass lantern", "a silver locket", "the logbook", "a sealed letter", "the rusted key", "a map of the reef", "the captain's coat"] as const;
const FEELINGS = ["afraid", "relieved", "furious", "tender", "ashamed", "hopeful", "jealous", "grieving"] as const;
const VERBS = ["found", "hid", "argued over", "promised to return", "broke", "lost", "mended", "stole"] as const;
const sentence = () => {
  const a = pick(PEOPLE);
  const b = pick(PEOPLE);
  return pick([
    () => `${a} ${pick(VERBS)} ${pick(THINGS)} near ${pick(PLACES)} while ${b} watched.`,
    () => `"I never meant for this," ${a} said, ${pick(FEELINGS)} and quiet.`,
    () => `The wind came off ${pick(PLACES)} and carried the smell of salt and tar.`,
    () => `${a} felt ${pick(FEELINGS)} when ${b} mentioned ${pick(THINGS)}.`,
    () => `They walked toward ${pick(PLACES)}, saying little, counting the lamps.`,
  ])();
};
const paragraph = (n: number) => Array.from({ length: n }, sentence).join(" ");
const vector = () => {
  const v = new Float32Array(DIMS);
  let n = 0;
  for (let i = 0; i < DIMS; i++) n += (v[i] = rand() * 2 - 1) ** 2;
  n = Math.sqrt(n);
  for (let i = 0; i < DIMS; i++) v[i]! /= n;
  return new Uint8Array(v.buffer);
};

// ---------- the story ----------
const t0 = performance.now();
const conn = createConnection({ name: "Mock", kind: "mock", billing: "subscription" });
await syncModels(conn);
createProfile({ name: "Story", connectionId: conn, modelId: "mock/storyteller", params: { context_target: 16000, max_tokens: 600 } });
setSetting("memory.config", { ...defaultMemoryConfig, checkerModel: false, librarian: false, rewriteQuery: false });
setSetting("routing.embeddings", { connectionId: conn, model: "mock/embed", dims: DIMS });
const { data: card } = normalizeCard({ spec: "chara_card_v2", data: { name: "Mira", description: "Keeper of the lighthouse at Port Ellis.", first_mes: "The lamp is lit, {{user}}." } });
const chatId = createChat({ characterId: createCharacter(card) }).id;
updateChat(chatId, { settings: { trackers: { mode: "helper" } } });

const ids: { id: string; seq: number }[] = [];
tx(() => {
  for (let i = 0; i < MESSAGES; i++) {
    const id = addMessage(chatId, i % 2 ? "assistant" : "user", paragraph(i % 2 ? 6 : 2));
    ids.push({ id, seq: i + 1 });
  }
});
const seqOf = (i: number) => ids[i]!.seq;

// Tracker ledger: the clock on every other message, the place, the cast and bonds now and then.
tx(() => {
  writeEvents(chatId, { messageId: ids[1]!.id, swipeIdx: -1 }, linesToOps(["clock: Day 1 08:00", "at: Port Ellis › Harbor", "cast: Mira@spot · Kael@spot"]).ops, "model");
  for (let i = 3; i < MESSAGES; i += 2) {
    const lines = ["clock: +20m"];
    if (i % 40 === 1) lines.push(`at: Port Ellis › ${pick(["Harbor", "Lighthouse", "Tavern", "Market", "Cliffs"])}`);
    if (i % 30 === 1) lines.push(`cast: Mira@spot · ${pick(PEOPLE.slice(1))}@spot`);
    if (i % 50 === 1) lines.push(`bond Mira>${pick(PEOPLE.slice(1))}: trust ${rand() < 0.5 ? "+1" : "-1"} — what was said at the ${pick(["harbor", "forge", "chapel"])}`);
    if (i % 70 === 1) lines.push(`item ${pick(["Silver locket", "Rusted key", "Logbook", "Brass lantern"])}: +${pick(PEOPLE)} — passed hand to hand`);
    writeEvents(chatId, { messageId: ids[i]!.id, swipeIdx: -1 }, linesToOps(lines).ops, "model");
  }
});

// Scene records (every SCENE_SIZE messages), memories spread across them, and their vectors.
const t = now();
const scenes: string[] = [];
tx(() => {
  for (let s = 0; s * SCENE_SIZE < MESSAGES; s++) {
    const id = newId();
    const start = s * SCENE_SIZE + 1;
    const end = Math.min(MESSAGES, start + SCENE_SIZE - 1);
    const content = paragraph(8);
    run(
      `INSERT INTO summaries (id, chat_id, level, start_seq, end_seq, closed, title, content, data, state, importance, tokens, source_tokens, created_at, updated_at)
       VALUES (?, ?, 'scene', ?, ?, 1, ?, ?, '{}', 'ready', 5, ?, 4000, ?, ?)`,
      id,
      chatId,
      start,
      end,
      `At ${pick(PLACES)}`,
      content,
      Math.ceil(content.length / 4),
      t,
      t,
    );
    run("INSERT INTO embeddings (owner_type, owner_id, chat_id, model, dims, hash, vector, created_at) VALUES ('summary', ?, ?, 'mock/embed', ?, ?, ?, ?)", id, chatId, DIMS, id, vector(), t);
    scenes.push(id);
  }
  for (let i = 0; i < MEMORIES; i++) {
    const at = Math.floor(rand() * (MESSAGES - 1));
    const scene = scenes[Math.floor(at / SCENE_SIZE)]!;
    const a = pick(PEOPLE);
    const id = insertAtom(
      chatId,
      scene,
      { type: pick(["event", "fact", "relationship", "promise"]), content: `${a} ${pick(VERBS)} ${pick(THINGS)} at ${pick(PLACES)}; ${pick(PEOPLE)} was ${pick(FEELINGS)}.`, entities: [a], importance: 1 + Math.floor(rand() * 10), emotions: [pick(FEELINGS)] },
      [ids[at]!],
    );
    run("INSERT INTO embeddings (owner_type, owner_id, chat_id, model, dims, hash, vector, created_at) VALUES ('memory', ?, ?, 'mock/embed', ?, ?, ?, ?)", id, chatId, DIMS, id, vector(), t);
  }
});
// Most of the story has left the window, so recall has the whole past to search.
setMemState(chatId, { segmentedThrough: seqOf(MESSAGES - 1), evictedThrough: seqOf(MESSAGES - 120) });
console.log(`Built ${MESSAGES} messages, ${MEMORIES} memories, ${scenes.length} scenes in ${Math.round(performance.now() - t0)} ms\n`);

// ---------- timing ----------
type Timing = { totalMs: number; trackersMs: number; retrievalMs: number; loreMs: number; advisorMs: number; assemblyMs: number };
const runs: Timing[] = [];
for (let i = 0; i < 6; i++) {
  // A new user message each time, as a send would bring: the queries (and their vectors) change.
  addMessage(chatId, "user", paragraph(2));
  const p = await previewPrompt(chatId);
  runs.push(p.trace.timing as Timing);
}
const [cold, ...warm] = runs;
const median = (k: keyof Timing) => {
  const xs = warm.map((r) => r[k]).sort((a, b) => a - b);
  return xs[Math.floor(xs.length / 2)]!;
};
const fmt = (n: number) => `${n.toFixed(1).padStart(7)} ms`;
let over = false;
console.log(`First (cold):  ${fmt(cold!.totalMs)}   budget ${COLD_BUDGET_MS} ms${cold!.totalMs > COLD_BUDGET_MS ? "  ✗" : ""}`);
if (cold!.totalMs > COLD_BUDGET_MS) over = true;
for (const k of ["totalMs", "trackersMs", "retrievalMs", "loreMs", "assemblyMs"] as const) {
  const m = median(k);
  const b = (BUDGET as Record<string, number>)[k];
  const bad = b != null && m > b;
  if (bad) over = true;
  console.log(`${k.replace("Ms", "").padEnd(14)} ${fmt(m)}${b != null ? `   budget ${b} ms` : ""}${bad ? "  ✗" : ""}`);
}
if (over) {
  console.error("\nOver budget ✗");
  process.exit(1);
}
console.log("\nWithin budget ✿");
