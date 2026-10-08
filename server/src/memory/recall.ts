import { all, parseJson } from "../db/db";
import type { MemoryConfig } from "../lib/settings";
import { countTokens } from "../lib/tokens";
import type { AtomRow } from "./atoms";
import { deepSearch, RECALL_CUE } from "./deep";
import { chatVectors, cosine } from "./embed";
import { entityCard, entityFacts, norm, resolver, type EntityRow } from "./entities";
import type { RecallItem, TimeIndex } from "./format";
import type { SummaryRow } from "./store";
import { contentWords, ftsQuery, overlap } from "./text";

/**
 * Recall (Phase 3). Candidates are filtered by point of view before anything is ranked (MEM-16),
 * then scored from several queries at once (MEM-14): keywords, meaning, the entities in play,
 * importance, emotion and the current mood (MEM-18), and how often replies actually used a
 * memory (MEM-19). The librarian's verdict, when it's ready, sharpens the list (MEM-23).
 * Slots: pinned → entity cards (MEM-17) → recent → relevant with diversity (MEM-15) →
 * serendipity → quotes found by deep search (MEM-22).
 */

export interface QuerySpec {
  text: string;
  weight: number;
  label: string;
}

export interface PovFilter {
  /** Normalized names and aliases of the character whose point of view recall keeps. */
  names: Set<string>;
  label: string;
}

export interface LibrarianVerdict {
  keep: Set<string>;
  drop: Set<string>;
}

export interface RecallInput {
  chatId: string;
  evicted: number;
  budget: number;
  queries: QuerySpec[];
  /** One vector per query (null where the embedding isn't ready). */
  qvecs: (Float32Array | null)[];
  excludeSummaryIds: Set<string>;
  seed: string;
  cfg: MemoryConfig;
  pov: PovFilter | null;
  /** People and places in the scene, from the trackers. */
  present: string[];
  /** The point-of-view character's mood (trackers). */
  mood: string | null;
  librarian: LibrarianVerdict | null;
  times: TimeIndex;
  /** Names never given an entity card (the main character and you are already in the prompt). */
  skipCards: Set<string>;
  povName: string | null;
}

export interface RecallStats {
  candidates: number;
  filteredPov: number;
  signaled: number;
  queries: string[];
  librarian: "used" | "none";
  deep: number;
  entities: string[];
  diversity: number;
}

/** Rank fusion within one list: a small k keeps the best matches clearly ahead of the tenth. */
const rrf = (rank: number) => 1 / (12 + rank);
const EVERYONE = new Set(["everyone", "everybody", "all", "public", "common knowledge", "the town", "the world"]);

/** MEM-16: a memory with a known-by list is recalled only if the point-of-view character is on it. */
export function povAllows(a: Pick<AtomRow, "known_by">, pov: PovFilter | null) {
  if (!pov) return true;
  const kb = parseJson<string[]>(a.known_by, []).map(norm).filter(Boolean);
  if (!kb.length) return true;
  return kb.some((k) => EVERYONE.has(k) || pov.names.has(k) || [...pov.names].some((n) => n.length >= 3 && (k === n || k.split(" ").includes(n))));
}

/** MEM-19: what use has made of a memory. Core memories (pinned, edited, 9+) never fade. */
export function reinforcement(a: Pick<AtomRow, "importance" | "pinned" | "user_edited" | "recall_count" | "ref_count" | "max_seq">, nowSeq: number) {
  const core = a.pinned || a.user_edited || a.importance >= 9;
  let w = 1 + Math.min(0.5, 0.15 * Math.log2(1 + (a.ref_count ?? 0)));
  let note = (a.ref_count ?? 0) > 0 ? `used in ${a.ref_count} repl${a.ref_count === 1 ? "y" : "ies"}` : "";
  if (!core) {
    if ((a.recall_count ?? 0) >= 4 && !a.ref_count) {
      w *= 0.85;
      note = "recalled often, never used";
    }
    if (a.importance <= 4 && !a.ref_count) {
      const age = Math.max(0, nowSeq - (a.max_seq ?? nowSeq));
      const fade = Math.max(0.35, 1 - age / 1500);
      if (fade < 0.95) {
        w *= fade;
        note = note || "fading trivia";
      }
    }
  }
  return { weight: w, note };
}

const MOOD_FAMILY: string[][] = [
  ["sad", "grief", "sorrow", "wistful", "melancholy", "lonely", "heartbroken", "mourning", "tearful"],
  ["happy", "joy", "delight", "warm", "content", "amused", "playful", "cheerful", "giddy"],
  ["angry", "anger", "furious", "rage", "resentful", "bitter", "irritated", "annoyed"],
  ["afraid", "fear", "scared", "anxious", "nervous", "dread", "terrified", "uneasy", "wary"],
  ["love", "tender", "affection", "longing", "desire", "romantic", "fond", "yearning"],
  ["guilt", "shame", "regret", "remorse", "embarrassed"],
  ["hope", "hopeful", "relief", "relieved", "grateful", "gratitude"],
];
/** MEM-18: does an emotion fit the current mood? */
export function moodMatches(mood: string | null, emotions: string[]) {
  if (!mood || !emotions.length) return false;
  const m = mood.toLowerCase();
  const fam = MOOD_FAMILY.find((f) => f.some((w) => m.includes(w)));
  return emotions.some((e) => {
    const x = e.toLowerCase();
    return m.includes(x) || x.includes(m) || Boolean(fam?.some((w) => x.includes(w)));
  });
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

export function recall(input: RecallInput) {
  const { chatId, evicted, budget, cfg } = input;
  const stats: RecallStats = { candidates: 0, filteredPov: 0, signaled: 0, queries: input.queries.map((q) => q.label), librarian: "none", deep: 0, entities: [], diversity: cfg.diversity };
  const res = resolver(chatId);

  const pinnedRows = all<AtomRow>("SELECT * FROM memories WHERE chat_id = ? AND pinned = 1 AND deleted_at IS NULL AND status IN ('active', 'disputed') ORDER BY COALESCE(min_seq, 0)", chatId);
  const pinned: RecallItem[] = pinnedRows.map((a) => ({
    ownerType: "memory",
    id: a.id,
    type: a.type,
    content: a.content,
    slot: "pinned",
    score: 1,
    reasons: ["pinned"],
    tokens: countTokens(a.content) + 3,
    seq: a.max_seq,
    confirmed: Boolean(a.user_edited),
  }));
  const pinnedTokens = pinned.reduce((n, p) => n + p.tokens, 0);

  // MEM-13: never recall what is already verbatim in the window. MEM-16: filter before ranking.
  const allAtoms = all<AtomRow>(
    "SELECT * FROM memories WHERE chat_id = ? AND pinned = 0 AND deleted_at IS NULL AND status IN ('active', 'disputed') AND COALESCE(min_seq, 0) <= ?",
    chatId,
    evicted,
  );
  const atoms = allAtoms.filter((a) => povAllows(a, input.pov));
  stats.filteredPov = allAtoms.length - atoms.length;
  const sums = all<SummaryRow>("SELECT * FROM summaries WHERE chat_id = ? AND level IN ('scene', 'chapter') AND state = 'ready' AND closed = 1 AND end_seq <= ?", chatId, evicted).filter(
    (s) => !input.excludeSummaryIds.has(s.id),
  );
  stats.candidates = atoms.length + sums.length;
  const atomById = new Map(atoms.map((a) => [a.id, a]));
  const sumById = new Map(sums.map((s) => [s.id, s]));
  const scores = new Map<string, { score: number; reasons: string[]; signal: boolean }>();
  const bump = (key: string, add: number, reason?: string, signal = false) => {
    const cur = scores.get(key) ?? { score: 0, reasons: [], signal: false };
    cur.score += add;
    if (reason && !cur.reasons.includes(reason)) cur.reasons.push(reason);
    if (signal) cur.signal = true;
    scores.set(key, cur);
  };

  // ---- signals, per query (MEM-14) ----
  const vectors = new Map<string, Float32Array>();
  if (input.qvecs.some(Boolean)) for (const v of chatVectors(chatId)) vectors.set(`${v.ownerType}:${v.ownerId}`, v.vector);
  input.queries.forEach((q, qi) => {
    const fts = ftsQuery(q.text);
    const tag = input.queries.length > 1 ? ` (${q.label})` : "";
    if (fts && atoms.length) {
      all<{ id: string }>("SELECT id FROM memories_fts WHERE memories_fts MATCH ? AND chat_id = ? ORDER BY bm25(memories_fts) LIMIT 80", fts, chatId)
        .filter((h) => atomById.has(h.id))
        .forEach((h, i) => bump(`memory:${h.id}`, rrf(i) * q.weight, `keywords${tag}`, true));
    }
    if (fts && sums.length) {
      all<{ id: string }>("SELECT id FROM summaries_fts WHERE summaries_fts MATCH ? AND chat_id = ? ORDER BY bm25(summaries_fts) LIMIT 30", fts, chatId)
        .filter((h) => sumById.has(h.id))
        .forEach((h, i) => bump(`summary:${h.id}`, rrf(i) * q.weight, `keywords${tag}`, true));
    }
    const qv = input.qvecs[qi];
    if (qv) {
      const sims: { key: string; sim: number }[] = [];
      for (const [key, v] of vectors) {
        const [type, id] = key.split(":") as [string, string];
        if (type === "memory" ? !atomById.has(id) : type === "summary" ? !sumById.has(id) : true) continue;
        const sim = cosine(qv, v);
        if (sim > 0.2) sims.push({ key, sim });
      }
      sims.sort((a, b) => b.sim - a.sim);
      sims.slice(0, 80).forEach((s, i) => bump(s.key, rrf(i) * 1.2 * q.weight, `similar meaning ${s.sim.toFixed(2)}${tag}`, true));
    }
  });

  // Entities named in the newest lines, resolved through aliases (MEM-28).
  const strongText = input.queries.filter((q) => q.weight >= 0.6).map((q) => q.text).join("\n");
  const mentioned = res.mentionedIn(strongText);
  const mentionedIds = new Set(mentioned.map((e) => e.id));
  const lowerQ = ` ${strongText.toLowerCase()} `;
  for (const a of atoms) {
    const names = parseJson<string[]>(a.entities, []);
    const hits = names.filter((n) => {
      const e = res.find(n);
      if (e && mentionedIds.has(e.id)) return true;
      return n.length >= 3 && new RegExp(`[^\\p{L}]${n.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^\\p{L}]`, "u").test(lowerQ);
    });
    if (hits.length) bump(`memory:${a.id}`, rrf(0) * 0.8 * Math.min(2, hits.length), `mentions ${hits.slice(0, 2).join(", ")}`, true);
  }
  // Recency and importance break ties among matches.
  [...atoms].sort((a, b) => (b.max_seq ?? 0) - (a.max_seq ?? 0)).forEach((a, i) => scores.has(`memory:${a.id}`) && bump(`memory:${a.id}`, rrf(i) * 0.3));
  [...atoms].sort((a, b) => b.importance - a.importance).forEach((a, i) => scores.has(`memory:${a.id}`) && bump(`memory:${a.id}`, rrf(i) * 0.3));

  // ---- weights: salience, mood, reinforcement, canon, librarian ----
  if (input.librarian) stats.librarian = "used";
  for (const [key, s] of scores) {
    const [type, id] = key.split(":") as [string, string];
    if (type === "memory") {
      const a = atomById.get(id)!;
      const emotions = parseJson<string[]>(a.emotions, []);
      let w = 1 + 0.04 * (a.importance - 5) + (emotions.length ? 0.06 : 0);
      if (moodMatches(input.mood, emotions)) {
        w *= 1.15;
        s.reasons.push(`fits the mood (${input.mood})`);
      }
      if (cfg.reinforcement) {
        const r = reinforcement(a, evicted);
        w *= r.weight;
        if (r.note) s.reasons.push(r.note);
      }
      if (a.status === "disputed") w *= 0.6;
      if (a.user_edited) w *= 1.15;
      s.score *= w;
    }
    if (input.librarian?.keep.has(key)) {
      s.score *= 1.6;
      s.reasons.push("the librarian picked it");
    } else if (input.librarian?.drop.has(key)) {
      s.score *= 0.4;
      s.reasons.push("the librarian passed on it");
    }
  }
  // Child to parent: a matching atom lifts its scene's summary.
  for (const a of atoms) {
    const s = scores.get(`memory:${a.id}`);
    if (s?.signal && a.scene_id && sumById.has(a.scene_id)) bump(`summary:${a.scene_id}`, s.score * 0.5, "its details match");
  }
  stats.signaled = [...scores.values()].filter((s) => s.signal).length;

  // ---- items ----
  const chosen = new Set<string>();
  const out: RecallItem[] = [...pinned];
  const decorate = (it: RecallItem, sceneId: string | null, who: string[] = []): RecallItem => ({
    ...it,
    when: input.times.when(it.seq, sceneId),
    where: input.times.where(sceneId),
    who: who.length ? who : undefined,
  });
  const itemFor = (key: string, slot: RecallItem["slot"], extraReason?: string): RecallItem | null => {
    const [type, id] = key.split(":") as ["memory" | "summary", string];
    const s = scores.get(key);
    const reasons = [...(s?.reasons ?? []), ...(extraReason ? [extraReason] : [])];
    if (type === "memory") {
      const a = atomById.get(id);
      if (!a) return null;
      if (a.importance >= 8) reasons.push(`important (${a.importance}/10)`);
      return decorate(
        { ownerType: "memory", id, type: a.type, content: a.content, slot, score: s?.score ?? 0, reasons, tokens: countTokens(a.content) + 9, seq: a.max_seq, confirmed: Boolean(a.user_edited), disputed: a.status === "disputed" },
        a.scene_id,
        parseJson<string[]>(a.known_by, []),
      );
    }
    const r = sumById.get(id);
    if (!r) return null;
    const content = `Earlier, ${r.level} "${r.title}" (#${r.start_seq}–#${r.end_seq}): ${r.content}`;
    return decorate({ ownerType: "summary", id, type: r.level, content, slot, score: s?.score ?? 0, reasons, tokens: countTokens(content) + 9, seq: r.end_seq }, r.level === "scene" ? r.id : null);
  };
  const take = (keys: string[], slot: RecallItem["slot"], cap: number, reason?: string) => {
    let used = 0;
    for (const key of keys) {
      if (chosen.has(key)) continue;
      const it = itemFor(key, slot, reason);
      if (!it || used + it.tokens > cap) continue;
      chosen.add(key);
      out.push(it);
      used += it.tokens;
      if (cap - used < 20) break;
    }
    return used;
  };

  const rest = Math.max(0, budget - pinnedTokens);
  let carry = 0;

  // Entity slot (MEM-17): who and what is in play, with their top facts.
  if (cfg.entityRecall && rest > 60) {
    const cap = rest * 0.2;
    let used = 0;
    const presentRows = input.present.map((n) => res.find(n)).filter((e): e is EntityRow => Boolean(e));
    const seenIds = new Set<string>();
    const targets = [...presentRows.map((e) => ({ e, why: "in the scene" })), ...mentioned.map((e) => ({ e, why: "just mentioned" }))].filter(
      ({ e }) => !seenIds.has(e.id) && seenIds.add(e.id) && !res.namesOf(e).some((n) => input.skipCards.has(norm(n))) && (e.kind === "person" || e.kind === "group" || e.kind === "object" || e.kind === "place"),
    );
    for (const { e, why } of targets.slice(0, 4)) {
      const facts = entityFacts(chatId, e, 8).filter((f) => atomById.has(f.id));
      const card = entityCard(e);
      if (card.length > e.name.length + 2) {
        const tokens = countTokens(card) + 4;
        if (used + tokens <= cap) {
          out.push({ ownerType: "entity", id: e.id, type: e.kind, content: card, slot: "entity", score: 1, reasons: [`${e.name} is ${why}`], tokens, seq: e.last_seq });
          used += tokens;
          stats.entities.push(e.name);
        }
      }
      const ranked = facts.sort((a, b) => (scores.get(`memory:${b.id}`)?.score ?? 0) - (scores.get(`memory:${a.id}`)?.score ?? 0) || b.importance - a.importance);
      used += take(
        ranked.slice(0, 2).map((f) => `memory:${f.id}`),
        "entity",
        cap - used,
        `about ${e.name} (${why})`,
      );
    }
    carry = cap - used;
  }

  const share = cfg.slots;
  const totalShare = share.recent + share.relevant + share.serendipity || 1;
  const after = Math.max(0, rest - (rest * (cfg.entityRecall ? 0.2 : 0)) + carry);
  carry = 0;
  const recentKeys = atoms
    .filter((a) => a.importance >= 3)
    .sort((a, b) => (b.max_seq ?? 0) - (a.max_seq ?? 0) || b.importance - a.importance)
    .map((a) => `memory:${a.id}`);
  const recentCap = (after * share.recent) / totalShare;
  carry = recentCap - take(recentKeys, "recent", recentCap, "recent");

  // Relevant, with diversity (MEM-15): maximal marginal relevance over meaning or shared words.
  const relevant = [...scores.entries()].filter(([, s]) => s.signal).sort((a, b) => b[1].score - a[1].score);
  const relevantCap = (after * share.relevant) / totalShare + carry;
  const words = new Map<string, Set<string>>();
  const wordsOf = (key: string) => {
    let w = words.get(key);
    if (!w) {
      const [type, id] = key.split(":") as [string, string];
      w = contentWords(type === "memory" ? (atomById.get(id)?.content ?? "") : (sumById.get(id)?.content ?? ""));
      words.set(key, w);
    }
    return w;
  };
  const sim = (a: string, b: string) => {
    const va = vectors.get(a);
    const vb = vectors.get(b);
    if (va && vb) return Math.max(0, cosine(va, vb));
    return Math.min(1, overlap(wordsOf(a), wordsOf(b)) * 1.6);
  };
  const lambda = 1 - Math.max(0, Math.min(1, cfg.diversity));
  const top = relevant[0]?.[1].score || 1;
  const pool = relevant.map(([k]) => k).filter((k) => !chosen.has(k)).slice(0, 60);
  const picked: string[] = [];
  const already = [...chosen].filter((k) => k.startsWith("memory:") || k.startsWith("summary:"));
  let usedRel = 0;
  while (pool.length && relevantCap - usedRel >= 20) {
    let best = -1;
    let bestVal = -Infinity;
    pool.forEach((k, i) => {
      const rel = (scores.get(k)?.score ?? 0) / top;
      const red = lambda < 1 ? Math.max(0, ...[...picked, ...already].map((p) => sim(k, p))) : 0;
      const val = lambda * rel - (1 - lambda) * red;
      if (val > bestVal) {
        bestVal = val;
        best = i;
      }
    });
    const key = pool.splice(best, 1)[0]!;
    const it = itemFor(key, "relevant");
    if (!it || usedRel + it.tokens > relevantCap) continue;
    chosen.add(key);
    out.push(it);
    picked.push(key);
    usedRel += it.tokens;
  }
  carry = relevantCap - usedRel;

  const rand = seededRandom(input.seed);
  const old = atoms.filter((a) => a.importance >= 6 && (a.max_seq ?? 0) < evicted - 40 && !chosen.has(`memory:${a.id}`));
  const serPool = old.map((a) => ({ k: `memory:${a.id}`, r: rand() * (cfg.reinforcement ? reinforcement(a, evicted).weight : 1) })).sort((a, b) => b.r - a.r).map((x) => x.k);
  const serCap = (after * share.serendipity) / totalShare + carry;
  carry = serCap - take(serPool, "serendipity", serCap, "a callback from long ago");

  // Deep search (MEM-22): when the story reaches far back, quote the old messages themselves.
  const primary = input.queries[0]?.text ?? "";
  const weak = (relevant[0]?.[1].score ?? 0) < 0.03;
  if (cfg.deepSearch && evicted > 0 && (RECALL_CUE.test(primary) || (weak && evicted > 200))) {
    const hits = deepSearch(chatId, { query: input.queries.map((q) => q.text).join("\n"), qvec: input.qvecs[0] ?? null, beforeSeq: evicted, quotes: 3, excerptSize: 240 });
    const cap = Math.max(carry, rest * 0.3);
    let used = 0;
    for (const [i, h] of hits.entries()) {
      let content = `${h.speaker} (#${h.seq}): "${h.excerpt}"`;
      let tokens = countTokens(content) + 8;
      // The best quote always gets in, shortened to fit if it must.
      if (i === 0 && tokens > cap && cap > 30) {
        content = `${h.speaker} (#${h.seq}): "${h.excerpt.slice(0, Math.floor((cap - 14) * 3.2))}…"`;
        tokens = countTokens(content) + 8;
      }
      if (used + tokens > cap) continue;
      out.push({
        ownerType: "quote",
        id: h.messageId,
        type: "quote",
        content,
        slot: "deep",
        score: h.score,
        reasons: ["deep search", ...h.reasons],
        tokens,
        seq: h.seq,
        when: input.times.when(h.seq, h.sceneId),
        where: input.times.where(h.sceneId),
      });
      used += tokens;
      stats.deep++;
    }
    carry -= used;
  }
  if (carry > 30) take(relevant.map(([k]) => k), "relevant", carry);

  return { items: out, pinnedTokens, tokens: out.reduce((n, i) => n + i.tokens, 0), stats };
}

/**
 * The queries for this turn (MEM-14): your draft or newest message weighs most, older lines less,
 * plus the people and places in the scene and, when the librarian has one, a rewritten query.
 */
export function buildQueries(recent: { role: string; content: string }[], opts: { draft?: string; present?: string[]; rewritten?: string | null } = {}): QuerySpec[] {
  const out: QuerySpec[] = [];
  const msgs = recent.filter((m) => m.content.trim()).slice(-3);
  const draft = opts.draft?.trim();
  const clip = (s: string) => s.slice(-1600);
  if (draft) out.push({ text: clip(draft), weight: 1, label: "your draft" });
  const weights = draft ? [0.35, 0.6] : [0.35, 0.6, 1];
  msgs.slice(draft ? -2 : -3).forEach((m, i, arr) => out.push({ text: clip(m.content), weight: weights[weights.length - arr.length + i] ?? 0.35, label: i === arr.length - 1 && !draft ? "newest message" : "earlier message" }));
  if (opts.present?.length) out.push({ text: opts.present.join(", "), weight: 0.45, label: "who's in the scene" });
  if (opts.rewritten?.trim()) out.push({ text: opts.rewritten.trim(), weight: 0.9, label: "librarian's query" });
  // The strongest query first (deep search and cue words read it).
  return out.sort((a, b) => b.weight - a.weight);
}
