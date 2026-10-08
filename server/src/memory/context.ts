import { all, parseJson } from "../db/db";
import { type MemoryConfig, memoryConfig } from "../lib/settings";
import { countTokens, MESSAGE_OVERHEAD } from "../lib/tokens";
import type { HistoryMessage } from "../prompt/assemble";
import type { AtomRow } from "./atoms";
import { chatVectors, cosine } from "./embed";
import { levelRows, memState, storyRow, type SummaryRow } from "./store";
import { ftsQuery, hashText } from "./text";

/**
 * Builds the memory part of a prompt: which messages stay verbatim (CTX-05), the telescope of
 * summaries that stands in for everything older (MEM-02), and the recalled memories (MEM-11, MEM-12).
 */

export interface RecallItem {
  ownerType: "memory" | "summary";
  id: string;
  type: string;
  content: string;
  slot: "pinned" | "recent" | "relevant" | "serendipity";
  score: number;
  reasons: string[];
  tokens: number;
  seq: number | null;
}

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
export function telescope(chatId: string, evicted: number, budget: number) {
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
  const text = parts.map((it) => `${heading(it.row, it)}\n${it.row.content.trim()}`).join("\n\n");
  return {
    text,
    items: parts.map((it) => ({ id: it.row.id, level: it.row.level, title: it.row.title, startSeq: it.start, endSeq: it.end, tokens: it.tokens, state: it.row.state })) as TelescopeItem[],
    tokens: parts.reduce((n, i) => n + i.tokens, 0),
    dropped,
    gaps,
  };
}

// ---------- Recall (MEM-11, MEM-12, MEM-13) ----------

/** Query text for retrieval: the newest messages (or the last two plus your draft). */
export function queryText(history: HistoryMessage[], draft?: string) {
  const recent = draft?.trim() ? [...history.slice(-2).map((m) => m.content), draft] : history.slice(-3).map((m) => m.content);
  return recent.join("\n").slice(-2400);
}

function seededRandom(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

const rrf = (rank: number) => 1 / (60 + rank);

export function recall(chatId: string, opts: { evicted: number; budget: number; query: string; qvec: Float32Array | null; excludeSummaryIds: Set<string>; seed: string; cfg: MemoryConfig }) {
  const { evicted, budget, query, qvec, cfg } = opts;
  const pinnedRows = all<AtomRow>("SELECT * FROM memories WHERE chat_id = ? AND pinned = 1 AND deleted_at IS NULL AND status IN ('active', 'disputed') ORDER BY COALESCE(min_seq, 0)", chatId);
  const pinned: RecallItem[] = pinnedRows.map((a) => ({ ownerType: "memory", id: a.id, type: a.type, content: a.content, slot: "pinned", score: 1, reasons: ["pinned"], tokens: countTokens(a.content) + 3, seq: a.max_seq }));
  const pinnedTokens = pinned.reduce((n, p) => n + p.tokens, 0);

  // MEM-13: never recall what is already verbatim in the window.
  const atoms = all<AtomRow>(
    "SELECT * FROM memories WHERE chat_id = ? AND pinned = 0 AND deleted_at IS NULL AND status IN ('active', 'disputed') AND COALESCE(min_seq, 0) <= ?",
    chatId,
    evicted,
  );
  const sums = all<SummaryRow>("SELECT * FROM summaries WHERE chat_id = ? AND level IN ('scene', 'chapter') AND state = 'ready' AND closed = 1 AND end_seq <= ?", chatId, evicted).filter(
    (s) => !opts.excludeSummaryIds.has(s.id),
  );
  const atomById = new Map(atoms.map((a) => [a.id, a]));
  const sumById = new Map(sums.map((s) => [s.id, s]));
  const scores = new Map<string, { score: number; reasons: string[]; signal: boolean }>();
  const bump = (key: string, add: number, reason?: string, signal = false) => {
    const cur = scores.get(key) ?? { score: 0, reasons: [], signal: false };
    cur.score += add;
    if (reason) cur.reasons.push(reason);
    if (signal) cur.signal = true;
    scores.set(key, cur);
  };

  const fts = ftsQuery(query);
  if (fts && atoms.length) {
    const hits = all<{ id: string }>("SELECT id FROM memories_fts WHERE memories_fts MATCH ? AND chat_id = ? ORDER BY bm25(memories_fts) LIMIT 80", fts, chatId).filter((h) => atomById.has(h.id));
    hits.forEach((h, i) => bump(`memory:${h.id}`, rrf(i), i < 5 ? `keyword match #${i + 1}` : "keyword match", true));
  }
  if (fts && sums.length) {
    const hits = all<{ id: string }>("SELECT id FROM summaries_fts WHERE summaries_fts MATCH ? AND chat_id = ? ORDER BY bm25(summaries_fts) LIMIT 30", fts, chatId).filter((h) => sumById.has(h.id));
    hits.forEach((h, i) => bump(`summary:${h.id}`, rrf(i), "keyword match", true));
  }
  if (qvec) {
    const sims = chatVectors(chatId)
      .filter((v) => (v.ownerType === "memory" ? atomById.has(v.ownerId) : sumById.has(v.ownerId)))
      .map((v) => ({ key: `${v.ownerType}:${v.ownerId}`, sim: cosine(qvec, v.vector) }))
      .filter((s) => s.sim > 0.2)
      .sort((a, b) => b.sim - a.sim)
      .slice(0, 80);
    sims.forEach((s, i) => bump(s.key, rrf(i) * 1.2, `similar meaning (${s.sim.toFixed(2)})`, true));
  }
  // Entity overlap: memories about someone or something named in the latest messages.
  const lowerQ = ` ${query.toLowerCase()} `;
  for (const a of atoms) {
    const hits = parseJson<string[]>(a.entities, []).filter((e) => e.length >= 3 && new RegExp(`[^\\p{L}]${e.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^\\p{L}]`, "u").test(lowerQ));
    if (hits.length) bump(`memory:${a.id}`, rrf(0) * 0.8 * Math.min(2, hits.length), `mentions ${hits.slice(0, 2).join(", ")}`, true);
  }
  // Recency and importance break ties among matches.
  [...atoms].sort((a, b) => (b.max_seq ?? 0) - (a.max_seq ?? 0)).forEach((a, i) => scores.has(`memory:${a.id}`) && bump(`memory:${a.id}`, rrf(i) * 0.3));
  [...atoms].sort((a, b) => b.importance - a.importance).forEach((a, i) => scores.has(`memory:${a.id}`) && bump(`memory:${a.id}`, rrf(i) * 0.3));
  // Child-to-parent: a matching atom lifts its scene's summary.
  for (const a of atoms) {
    const s = scores.get(`memory:${a.id}`);
    if (s?.signal && a.scene_id && sumById.has(a.scene_id)) bump(`summary:${a.scene_id}`, s.score * 0.5, "its details match");
  }

  const chosen = new Set<string>();
  const out: RecallItem[] = [...pinned];
  const itemFor = (key: string, slot: RecallItem["slot"], extraReason?: string): RecallItem | null => {
    const [type, id] = key.split(":") as ["memory" | "summary", string];
    const s = scores.get(key);
    if (type === "memory") {
      const a = atomById.get(id);
      if (!a) return null;
      const reasons = [...(s?.reasons ?? []), ...(extraReason ? [extraReason] : [])];
      if (a.importance >= 8) reasons.push(`important (${a.importance}/10)`);
      return { ownerType: "memory", id, type: a.type, content: a.content, slot, score: s?.score ?? 0, reasons, tokens: countTokens(a.content) + 3, seq: a.max_seq };
    }
    const r = sumById.get(id);
    if (!r) return null;
    const content = `Earlier, ${r.level} "${r.title}" (#${r.start_seq}–#${r.end_seq}): ${r.content}`;
    return { ownerType: "summary", id, type: r.level, content, slot, score: s?.score ?? 0, reasons: [...(s?.reasons ?? []), ...(extraReason ? [extraReason] : [])], tokens: countTokens(content) + 3, seq: r.end_seq };
  };
  const take = (keys: string[], slot: RecallItem["slot"], cap: number, reason?: string) => {
    let used = 0;
    for (const key of keys) {
      if (chosen.has(key)) continue;
      const it = itemFor(key, slot, reason);
      if (!it) continue;
      if (used + it.tokens > cap) continue;
      chosen.add(key);
      out.push(it);
      used += it.tokens;
      if (cap - used < 20) break;
    }
    return used;
  };

  const rest = Math.max(0, budget - pinnedTokens);
  const share = cfg.slots;
  const totalShare = share.recent + share.relevant + share.serendipity || 1;
  let carry = 0;
  const recentKeys = atoms.filter((a) => a.importance >= 3).sort((a, b) => (b.max_seq ?? 0) - (a.max_seq ?? 0) || b.importance - a.importance).map((a) => `memory:${a.id}`);
  const recentCap = (rest * share.recent) / totalShare;
  carry = recentCap - take(recentKeys, "recent", recentCap, "recent");
  const relevantKeys = [...scores.entries()].filter(([, s]) => s.signal).sort((a, b) => b[1].score - a[1].score).map(([k]) => k);
  const relevantCap = (rest * share.relevant) / totalShare + carry;
  carry = relevantCap - take(relevantKeys, "relevant", relevantCap);
  const rand = seededRandom(opts.seed);
  const old = atoms.filter((a) => a.importance >= 6 && (a.max_seq ?? 0) < evicted - 40 && !chosen.has(`memory:${a.id}`));
  const pool = old.map((a) => ({ k: `memory:${a.id}`, r: rand() })).sort((a, b) => a.r - b.r).map((x) => x.k);
  const serCap = (rest * share.serendipity) / totalShare + carry;
  carry = serCap - take(pool, "serendipity", serCap, "a callback from long ago");
  if (carry > 30) take(relevantKeys, "relevant", carry);

  return { items: out, pinnedTokens, tokens: out.reduce((n, i) => n + i.tokens, 0) };
}

const STORY_HEADER =
  "[STORY SO FAR — a record of what happened earlier in this story, oldest first. It is canon: keep every reply consistent with it. Use it as background knowledge; don't retell it, quote it, or mention that it exists.]";
const CORE_HEADER = "### Core memories (always true unless the story changes them)";
const RECALL_HEADER =
  "[Memory notes — details from earlier in the story that may matter right now. Use them to stay consistent and weave them in only where they fit naturally. Don't quote them, list them, or say that you remember.]";

export function formatStory(telescopeText: string, pinned: RecallItem[]) {
  const parts: string[] = [];
  if (telescopeText.trim()) parts.push(telescopeText);
  if (pinned.length) parts.push(`${CORE_HEADER}\n${pinned.map((p) => `- ${p.content}`).join("\n")}`);
  return parts.length ? `${STORY_HEADER}\n\n${parts.join("\n\n")}` : "";
}

export function formatRecall(items: RecallItem[]) {
  const list = items.filter((i) => i.slot !== "pinned").sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
  return list.length ? `${RECALL_HEADER}\n${list.map((i) => `- ${i.content}`).join("\n")}` : "";
}

// ---------- Putting it together ----------

const recallCache = new Map<string, ReturnType<typeof recall>>();

export interface BuildContextInput {
  chatId: string;
  history: HistoryMessage[];
  /** Tokens available for memory + history, after the fixed blocks and the reply reserve. */
  available: number;
  /** The prompt size target (CTX-01), for the memory layer shares. */
  target: number;
  query: string;
  qvec: Float32Array | null;
  seed: string;
}

export function buildMemoryContext(input: BuildContextInput): MemoryContext {
  const cfg = memoryConfig();
  const state = memState(input.chatId);
  const storyBudget = Math.round(cfg.budget.summaries * input.target);
  const recallBudget = Math.round(cfg.budget.recall * input.target);
  const msgs = input.history.map((m) => ({ seq: m.seq ?? 0, tokens: tok(m.content) }));

  if (!cfg.enabled) {
    const w = chooseWindow({ msgs, boundaries: [], evicted: state.evictedThrough, budget: input.available, lowWater: cfg.lowWater });
    const history = input.history.filter((m) => (m.seq ?? 0) > w.evicted);
    return {
      story: "",
      recall: "",
      history,
      evictedThrough: w.evicted,
      trace: emptyTrace(w, history, input.available, input.query),
    };
  }

  const scenes = levelRows(input.chatId, "scene");
  let allSafe = true;
  const boundaries = scenes.slice(1).map((s, i) => {
    const before = scenes[i]!;
    allSafe = allSafe && (usable(before) || before.state === "error");
    return { seq: s.start_seq, safe: allSafe };
  });

  const compute = (evicted: number) => {
    const t = telescope(input.chatId, evicted, storyBudget);
    const key = `${input.chatId}:${state.version}:${evicted}:${recallBudget}:${hashText(input.query)}:${input.qvec ? 1 : 0}`;
    let r = recallCache.get(key);
    if (!r) {
      r = recall(input.chatId, { evicted, budget: recallBudget, query: input.query, qvec: input.qvec, excludeSummaryIds: new Set(t.items.map((i) => i.id)), seed: input.seed, cfg });
      recallCache.set(key, r);
      if (recallCache.size > 60) recallCache.delete(recallCache.keys().next().value!);
    }
    const story = formatStory(t.text, r.items.filter((i) => i.slot === "pinned"));
    const recallText = formatRecall(r.items);
    return { t, r, story, recallText, tokens: (story ? tok(story) : 0) + (recallText ? tok(recallText) : 0) };
  };

  let c = compute(state.evictedThrough);
  let w = chooseWindow({ msgs, boundaries, evicted: state.evictedThrough, budget: Math.max(0, input.available - c.tokens), lowWater: cfg.lowWater });
  if (w.evicted !== state.evictedThrough) {
    c = compute(w.evicted);
    // The memory block grew with the move; make sure the window still fits.
    const w2 = chooseWindow({ msgs, boundaries, evicted: w.evicted, budget: Math.max(0, input.available - c.tokens), lowWater: cfg.lowWater });
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
      window: { messages: history.length, tokens: windowTokens, budget: Math.max(0, input.available - c.tokens), target: input.target, moved: w.moved, unsafe: w.unsafe },
      gaps: c.t.gaps,
      telescope: c.t.items,
      telescopeTokens: c.t.tokens,
      telescopeBudget: storyBudget,
      dropped: c.t.dropped,
      recall: c.r.items,
      recallTokens: c.r.tokens,
      recallBudget,
      query: input.query.slice(0, 400),
      vector: Boolean(input.qvec),
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
