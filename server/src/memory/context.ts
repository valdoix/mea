import { type MemoryConfig, memoryConfig } from "../lib/settings";
import { countTokens, MESSAGE_OVERHEAD } from "../lib/tokens";
import type { HistoryMessage } from "../prompt/assemble";
import type { WorldState } from "../trackers/types";
import type { Reveal } from "../trackers/reveals";
import { AUTHORITY } from "./canon";
import { embeddingsEnabled, embedQueries, indexCoverage } from "./embed";
import { norm, placeName, resolver } from "./entities";
import { formatRecallBlock, type RecallItem, TimeIndex } from "./format";
import { journalText } from "./journals";
import { cachedRewrite, cachedVerdict, contextText } from "./librarian";
import { buildQueries, type LibrarianVerdict, type PovFilter, type QuerySpec, recall, type RecallStats } from "./recall";
import { levelRows, memState, storyRow, type SummaryRow } from "./store";
import { contentWords, hashText } from "./text";

/**
 * Builds the memory part of a prompt: which messages stay verbatim (CTX-05), the telescope of
 * summaries that stands in for everything older (MEM-02), and the recalled memories (Phase 3 recall).
 */

export type { RecallItem };

export interface TelescopeItem {
  id: string;
  level: "scene" | "chapter" | "arc" | "story";
  title: string;
  startSeq: number;
  endSeq: number;
  tokens: number;
  state: string;
}

export interface MemoryTrace {
  enabled: boolean;
  evictedThrough: number;
  window: { messages: number; tokens: number; budget: number; target: number; moved: "kept" | "advanced" | "restored"; unsafe: boolean };
  gaps: { startSeq: number; endSeq: number; reason: string }[];
  telescope: TelescopeItem[];
  telescopeTokens: number;
  telescopeBudget: number;
  dropped: number;
  recall: RecallItem[];
  recallTokens: number;
  recallBudget: number;
  query: string;
  vector: boolean;
  /** Phase 3: the queries, point of view, librarian, index readiness and formatter used. */
  queries?: { label: string; weight: number; vector: boolean }[];
  stats?: RecallStats;
  pov?: string | null;
  format?: MemoryConfig["format"];
  index?: MemoryInputs["index"];
  journalTokens?: number;
}

export interface MemoryContext {
  story: string;
  recall: string;
  history: HistoryMessage[];
  evictedThrough: number;
  trace: MemoryTrace;
}

const tok = (s: string) => countTokens(s) + MESSAGE_OVERHEAD;
const usable = (r: SummaryRow) => Boolean(r.content.trim()) && r.state !== "pending";

// ---------- Window (CTX-05) ----------

export interface WindowInput {
  msgs: { seq: number; tokens: number }[];
  /** Scene starts after the first scene, each with whether everything before it is summarized. */
  boundaries: { seq: number; safe: boolean }[];
  evicted: number;
  budget: number;
  lowWater: number;
}

/**
 * Chunked eviction: history is dropped in whole scenes, down to a low-water mark, so the
 * cached prefix survives many turns. Unsummarized scenes are evicted only when nothing else fits.
 */
export function chooseWindow(w: WindowInput): { evicted: number; moved: "kept" | "advanced" | "restored"; unsafe: boolean } {
  const lastSeq = w.msgs.at(-1)?.seq ?? 0;
  const after = (p: number) => w.msgs.reduce((n, m) => (m.seq > p ? n + m.tokens : n), 0);
  const low = w.budget * w.lowWater;
  const current = after(w.evicted);
  const cuts = [{ seq: 1, safe: true }, ...w.boundaries].map((b) => ({ p: b.seq - 1, safe: b.safe })).filter((c) => c.p < lastSeq);

  if (current <= w.budget) {
    // Lots of room (a bigger model, deleted messages): bring older scenes back verbatim.
    if (w.evicted > 0 && current < w.budget * 0.5) {
      const back = cuts.filter((c) => c.p < w.evicted && after(c.p) <= low).sort((a, b) => a.p - b.p)[0];
      if (back) return { evicted: back.p, moved: "restored", unsafe: false };
    }
    return { evicted: w.evicted, moved: "kept", unsafe: false };
  }
  const forward = cuts.filter((c) => c.p > w.evicted).sort((a, b) => a.p - b.p);
  const safeLow = forward.find((c) => c.safe && after(c.p) <= low);
  if (safeLow) return { evicted: safeLow.p, moved: "advanced", unsafe: false };
  const safeFit = [...forward].reverse().find((c) => c.safe && after(c.p) <= w.budget);
  if (safeFit) return { evicted: safeFit.p, moved: "advanced", unsafe: false };
  const anyFit = forward.find((c) => after(c.p) <= w.budget);
  if (anyFit) return { evicted: anyFit.p, moved: "advanced", unsafe: true };
  // Even the newest scene is too big: fall back to whole messages.
  let p = w.evicted;
  for (const m of w.msgs) {
    if (m.seq <= p) continue;
    if (after(p) <= low || m.seq >= lastSeq) break;
    p = m.seq;
  }
  return { evicted: p, moved: "advanced", unsafe: true };
}

// ---------- Telescope (MEM-02) ----------

interface TItem {
  row: SummaryRow;
  start: number;
  end: number;
  tokens: number;
}

/**
 * Everything up to `evicted` at decreasing resolution: scenes, folded into their chapter,
 * arc, and finally the Story So Far, oldest first, until it fits the budget.
 */
export function telescope(chatId: string, evicted: number, budget: number, reveals: Reveal[] = []) {
  const scenes = levelRows(chatId, "scene").filter((s) => s.closed && (s.end_seq ?? 0) <= evicted);
  const chapters = levelRows(chatId, "chapter");
  const arcs = levelRows(chatId, "arc");
  const story = storyRow(chatId);
  const gaps: MemoryTrace["gaps"] = [];

  let items: TItem[] = scenes.map((s) => ({ row: s, start: s.start_seq, end: s.end_seq!, tokens: usable(s) ? tok(s.content) + 12 : 0 }));
  const lastCovered = scenes.at(-1)?.end_seq ?? 0;

  const total = () => items.reduce((n, i) => n + i.tokens, 0);
  const parentOf = (it: TItem): SummaryRow | null => {
    if (it.row.level === "story") return null;
    if (it.row.level === "arc") return story && usable(story) && story.end_seq != null && story.end_seq <= evicted && story.end_seq >= it.end ? story : null;
    const list = it.row.level === "scene" ? chapters : arcs;
    const p = [...list].reverse().find((r) => r.start_seq <= it.start);
    return p && p.closed && (p.end_seq ?? Infinity) <= evicted && usable(p) ? p : null;
  };

  let dropped = 0;
  while (total() > budget && items.length) {
    let changed = false;
    for (const it of items) {
      const parent = parentOf(it);
      if (!parent) continue;
      const pStart = parent.level === "story" ? -Infinity : parent.start_seq;
      const pEnd = parent.end_seq!;
      const inside = items.filter((x) => x.start >= pStart && x.end <= pEnd);
      const pTokens = tok(parent.content) + 12;
      if (inside.reduce((n, x) => n + x.tokens, 0) <= pTokens) continue;
      items = [...items.filter((x) => !inside.includes(x)), { row: parent, start: parent.level === "story" ? (inside[0]?.start ?? parent.start_seq) : pStart, end: pEnd, tokens: pTokens }].sort(
        (a, b) => a.start - b.start,
      );
      changed = true;
      break;
    }
    if (!changed) {
      // Nothing left to fold: drop the oldest detail rather than overflow (the trace says so).
      const i = items.findIndex((x) => x.row.level !== "story" && x.tokens > 0);
      if (i < 0) break;
      items.splice(i, 1);
      dropped++;
    }
  }

  for (const it of items) {
    if (it.tokens === 0) gaps.push({ startSeq: it.start, endSeq: it.end, reason: it.row.state === "error" ? "summary failed" : "not summarized yet" });
  }
  if (evicted > lastCovered) gaps.push({ startSeq: lastCovered + 1, endSeq: evicted, reason: "not segmented yet" });
  const parts = items.filter((i) => i.tokens > 0);
  const heading = (r: SummaryRow, it: TItem) => {
    const range = `#${it.start}–#${it.end}`;
    const time = r.story_time ? ` · ${r.story_time}` : "";
    if (r.level === "story") return `### The story so far (through message #${it.end})`;
    const kind = r.level === "scene" ? "Scene" : r.level === "chapter" ? "Chapter" : "Arc";
    return `### ${kind}: ${r.title || "Untitled"} (${range}${time})`;
  };
  const text = parts.map((it) => `${heading(it.row, it)}\n${it.row.content.trim()}${sinceThen(it, parts, reveals)}`).join("\n\n");
  return {
    text,
    items: parts.map((it) => ({ id: it.row.id, level: it.row.level, title: it.row.title, startSeq: it.start, endSeq: it.end, tokens: it.tokens, state: it.row.state })) as TelescopeItem[],
    tokens: parts.reduce((n, i) => n + i.tokens, 0),
    dropped,
    gaps,
  };
}

/**
 * Reliable state 2.4 (docs/16): a summary written before a secret came out still reads as it did
 * then ("Shauna's pregnancy — Jackie doesn't know"). The last summary that mentions it, if it ends
 * before the reveal, gets one line after it saying what's true since.
 */
function sinceThen(it: TItem, parts: TItem[], reveals: Reveal[]) {
  const mentions = (r: Reveal, x: TItem) => {
    const S = contentWords(r.statement);
    const T = contentWords(x.row.content);
    const hits = [...S].filter((w) => T.has(w)).length;
    return hits >= 2 && hits / S.size >= 0.75;
  };
  const lines: string[] = [];
  for (const r of reveals) {
    if (r.seq <= it.end || !mentions(r, it)) continue;
    // Only after the last summary before the reveal that mentions it.
    if (parts.some((x) => x !== it && x.end > it.end && x.end < r.seq && mentions(r, x))) continue;
    lines.push(`Since then (#${r.seq}): ${r.to.join(", ")} found out that ${r.statement.replace(/\.$/, "")}${r.out ? "; it's no longer a secret" : ""}.`);
  }
  return lines.length ? `\n${lines.join("\n")}` : "";
}

// ---------- Recall inputs (MEM-14, MEM-16, MEM-17, MEM-18, MEM-21, MEM-23) ----------

/** Query text for the trace and for older callers: the newest messages (or the last two plus your draft). */
export function queryText(history: HistoryMessage[], draft?: string) {
  const recent = draft?.trim() ? [...history.slice(-2).map((m) => m.content), draft] : history.slice(-3).map((m) => m.content);
  return recent.join("\n").slice(-2400);
}

export interface MemoryInputs {
  queries: QuerySpec[];
  qvecs: (Float32Array | null)[];
  pov: PovFilter | null;
  povName: string | null;
  present: string[];
  mood: string | null;
  librarian: LibrarianVerdict | null;
  skipCards: Set<string>;
  /** MEM-21: how much of the vector index is ready, and whether this turn waited for it. */
  index: { coverage: number; vectors: number; of: number };
  journal: string;
}

/** Inputs when memory is off: the window still moves in whole scenes, nothing is recalled. */
export function emptyInputs(): MemoryInputs {
  return { queries: [], qvecs: [], pov: null, povName: null, present: [], mood: null, librarian: null, skipCards: new Set(), index: { coverage: 0, vectors: 0, of: 0 }, journal: "" };
}

/** MEM-16: whose point of view recall keeps. Companion chats remember as the character; Narrator sees everything. */
export function povMode(cfg: MemoryConfig, chatMode: string): "character" | "narrator" {
  if (cfg.pov !== "auto") return cfg.pov;
  return chatMode === "narrator" ? "narrator" : "character";
}

/** Everything recall needs for this turn, built from the history, your draft, and the story state. */
export async function memoryInputs(
  chatId: string,
  o: { history: HistoryMessage[]; draft?: string; chatMode: string; state: WorldState | null; names: { char: string; user: string }; waitMs?: number },
): Promise<MemoryInputs> {
  const cfg = memoryConfig();
  const st = o.state;
  const present = st
    ? [
        ...Object.values(st.chars)
          .filter((c) => !c.isUser && !c.dead && (c.tier === "spot" || c.tier === "peri"))
          .map((c) => c.name),
        ...(st.place.length ? [placeName(st.place).name] : []),
      ]
    : [];
  const contexts = [contextText(o.history.slice(0, -1)), contextText(o.history)];
  const rewritten = cfg.rewriteQuery ? cachedRewrite(chatId, contexts) : null;
  const queries = buildQueries(o.history, { draft: o.draft, present, rewritten });
  // Recall only searches what has left the window. Until something has, query vectors would buy
  // nothing, so no reply waits for them (the turn the window first moves runs on keywords, MEM-21).
  const searchable = memState(chatId).evictedThrough > 0;
  const qvecs = searchable && embeddingsEnabled() ? await embedQueries(queries.map((q) => q.text), o.waitMs ?? 1500) : queries.map(() => null);
  const mode = povMode(cfg, o.chatMode);
  let pov: PovFilter | null = null;
  const res = resolver(chatId);
  if (mode === "character") {
    const me = res.find(o.names.char);
    pov = { names: new Set([o.names.char, ...(me ? res.namesOf(me) : [])].map(norm).filter(Boolean)), label: o.names.char };
  }
  const main = st ? Object.values(st.chars).find((c) => c.isMain || norm(c.name) === norm(o.names.char)) : undefined;
  const coverage = embeddingsEnabled() ? indexCoverage(chatId) : 0;
  return {
    queries,
    qvecs,
    pov,
    povName: o.names.char,
    present,
    mood: main?.mood?.name ?? null,
    librarian: cfg.librarian ? cachedVerdict(chatId, contexts) : null,
    skipCards: new Set([o.names.char, o.names.user].map(norm)),
    index: { coverage, vectors: qvecs.filter(Boolean).length, of: queries.length },
    journal: cfg.journals ? journalText(chatId, o.names.char) : "",
  };
}

const STORY_HEADER = `[${AUTHORITY.summary} a record of what happened earlier in this story, oldest first. It is canon: keep every reply consistent with it. Use it as background knowledge; don't retell it, quote it, or mention that it exists.]`;
const CORE_HEADER = `### ${AUTHORITY.user} core memories (always true unless the story changes them)`;

export function formatStory(telescopeText: string, pinned: RecallItem[], journal = "", povName: string | null = null) {
  const parts: string[] = [];
  if (telescopeText.trim()) parts.push(telescopeText);
  if (journal.trim() && povName) parts.push(`### ${povName}'s own memory (first person, ${povName}'s view; what ${povName} feels and keeps private)\n${journal.trim()}`);
  if (pinned.length) parts.push(`${CORE_HEADER}\n${pinned.map((p) => `- ${p.content}`).join("\n")}`);
  return parts.length ? `${STORY_HEADER}\n\n${parts.join("\n\n")}` : "";
}

// ---------- Putting it together ----------

const recallCache = new Map<string, ReturnType<typeof recall>>();

export interface BuildContextInput {
  chatId: string;
  history: HistoryMessage[];
  /** Tokens available for memory + history, after the fixed blocks and the reply reserve. */
  available: number;
  /** The prompt size target (CTX-01), for the memory layer shares (MEM-38: everything scales with it). */
  target: number;
  /** Tokens the verbatim window keeps even when the memory blocks would take them. */
  floor?: number;
  inputs: MemoryInputs;
  seed: string;
  /** Secrets that came out (trackers, as of the message being written), for the summaries written before (2.4). */
  reveals?: Reveal[];
}

export function buildMemoryContext(input: BuildContextInput): MemoryContext {
  const cfg = memoryConfig();
  const state = memState(input.chatId);
  const storyBudget = Math.round(cfg.budget.summaries * input.target);
  const recallBudget = Math.round(cfg.budget.recall * input.target);
  const msgs = input.history.map((m) => ({ seq: m.seq ?? 0, tokens: tok(m.content) }));
  const primary = input.inputs.queries[0]?.text ?? "";
  const floor = input.floor ?? 0;
  const room = (memoryTokens: number) => Math.max(floor, input.available - memoryTokens);

  if (!cfg.enabled) {
    const w = chooseWindow({ msgs, boundaries: [], evicted: state.evictedThrough, budget: room(0), lowWater: cfg.lowWater });
    const history = input.history.filter((m) => (m.seq ?? 0) > w.evicted);
    return { story: "", recall: "", history, evictedThrough: w.evicted, trace: emptyTrace(w, history, room(0), primary) };
  }

  const scenes = levelRows(input.chatId, "scene");
  let allSafe = true;
  const boundaries = scenes.slice(1).map((s, i) => {
    const before = scenes[i]!;
    allSafe = allSafe && (usable(before) || before.state === "error");
    return { seq: s.start_seq, safe: allSafe };
  });
  const times = new TimeIndex(input.chatId);
  const inp = input.inputs;
  // MEM-29: the character's journal rides with the Story So Far, capped at a share of its budget.
  const journal = inp.journal && tok(inp.journal) <= storyBudget * 0.35 ? inp.journal : inp.journal.slice(0, Math.max(0, Math.floor(storyBudget * 0.35 * 3.5)));
  const journalTokens = journal ? tok(journal) : 0;

  const compute = (evicted: number) => {
    const t = telescope(input.chatId, evicted, Math.max(0, storyBudget - journalTokens), input.reveals);
    const key = [
      input.chatId,
      state.version,
      evicted,
      recallBudget,
      hashText(inp.queries.map((q) => `${q.weight}:${q.text}`).join("|")),
      inp.qvecs.map((v) => (v ? 1 : 0)).join(""),
      inp.librarian ? inp.librarian.keep.size : -1,
      inp.pov?.label ?? "",
      inp.mood ?? "",
      cfg.format,
      cfg.diversity,
    ].join(":");
    let r = recallCache.get(key);
    if (!r) {
      r = recall({
        chatId: input.chatId,
        evicted,
        budget: recallBudget,
        queries: inp.queries,
        qvecs: inp.qvecs,
        excludeSummaryIds: new Set(t.items.map((i) => i.id)),
        seed: input.seed,
        cfg,
        pov: inp.pov,
        present: inp.present,
        mood: inp.mood,
        librarian: inp.librarian,
        times,
        skipCards: inp.skipCards,
        povName: inp.povName,
      });
      recallCache.set(key, r);
      if (recallCache.size > 60) recallCache.delete(recallCache.keys().next().value!);
    }
    const story = formatStory(t.text, r.items.filter((i) => i.slot === "pinned"), journal, inp.povName);
    const recallText = formatRecallBlock(r.items, cfg.format, inp.pov ? inp.povName : null);
    return { t, r, story, recallText, tokens: (story ? tok(story) : 0) + (recallText ? tok(recallText) : 0) };
  };

  let c = compute(state.evictedThrough);
  let w = chooseWindow({ msgs, boundaries, evicted: state.evictedThrough, budget: room(c.tokens), lowWater: cfg.lowWater });
  if (w.evicted !== state.evictedThrough) {
    c = compute(w.evicted);
    // The memory block grew with the move; make sure the window still fits.
    const w2 = chooseWindow({ msgs, boundaries, evicted: w.evicted, budget: room(c.tokens), lowWater: cfg.lowWater });
    if (w2.evicted > w.evicted) {
      w = { ...w2, moved: "advanced" };
      c = compute(w.evicted);
    }
  }
  const history = input.history.filter((m) => (m.seq ?? 0) > w.evicted);
  const windowTokens = history.reduce((n, m) => n + tok(m.content), 0);
  return {
    story: c.story,
    recall: c.recallText,
    history,
    evictedThrough: w.evicted,
    trace: {
      enabled: true,
      evictedThrough: w.evicted,
      window: { messages: history.length, tokens: windowTokens, budget: room(c.tokens), target: input.target, moved: w.moved, unsafe: w.unsafe },
      gaps: c.t.gaps,
      telescope: c.t.items,
      telescopeTokens: c.t.tokens,
      telescopeBudget: storyBudget,
      dropped: c.t.dropped,
      recall: c.r.items,
      recallTokens: c.r.tokens,
      recallBudget,
      query: primary.slice(0, 400),
      vector: inp.qvecs.some(Boolean),
      queries: inp.queries.map((q, i) => ({ label: q.label, weight: q.weight, vector: Boolean(inp.qvecs[i]) })),
      stats: c.r.stats,
      pov: inp.pov?.label ?? null,
      format: cfg.format,
      index: inp.index,
      journalTokens,
    },
  };
}

function emptyTrace(w: ReturnType<typeof chooseWindow>, history: HistoryMessage[], budget: number, query: string): MemoryTrace {
  return {
    enabled: false,
    evictedThrough: w.evicted,
    window: { messages: history.length, tokens: history.reduce((n, m) => n + tok(m.content), 0), budget, target: budget, moved: w.moved, unsafe: w.unsafe },
    gaps: [],
    telescope: [],
    telescopeTokens: 0,
    telescopeBudget: 0,
    dropped: 0,
    recall: [],
    recallTokens: 0,
    recallBudget: 0,
    query: query.slice(0, 400),
    vector: false,
  };
}
