import type { LoreEntry, LorebookSettings, LorePosition, Role } from "./types";

export interface ScanEntry extends LoreEntry {
  id: string;
  bookId: string;
  bookName: string;
  book: LorebookSettings;
}

export interface ActivationDefaults {
  scanDepth: number;
  tokenBudget: number;
  recursive: boolean;
  maxRecursion: number;
  caseSensitive: boolean;
  matchWholeWords: boolean;
}

export interface TimedState {
  stickyUntil?: number | null;
  cooldownUntil?: number | null;
}

export interface ActivationInput {
  entries: ScanEntry[];
  /** Chat messages, oldest first. Usually formatted "Name: text". */
  history: string[];
  /** Number of messages in the chat; the clock for sticky/cooldown/delay. */
  messageCount: number;
  state: Record<string, TimedState>;
  defaults: ActivationDefaults;
  countTokens: (text: string) => number;
  /** Macro substitution for keys ({{char}} etc.). */
  substitute?: (text: string) => string;
  random?: () => number;
  /**
   * Cache-friendly placement (CTX-04): entries that fire on keywords change from turn to turn,
   * so before/after-character ones go to the dynamic block instead of the stable prefix.
   */
  splitTriggered?: boolean;
  /** LORE-06: people, places and things in the scene (trackers) or just named; their entries fire. */
  present?: string[];
  /** LORE-05: similarity of an entry to the recent context, for entries that opt in (null = not semantic). */
  semantic?: (e: ScanEntry) => number | null;
  semanticThreshold?: number;
  /** Every entry by id, so a child can pull in its parent's essentials (LORE-10). */
  all?: ScanEntry[];
}

/** Phase 3 entry fields, kept in `extra` so SillyTavern imports and exports carry them (LORE-09, LORE-10). */
export interface EntryExtra {
  type?: "character" | "location" | "item" | "faction" | "concept" | "event" | "rule";
  aliases?: string[];
  secrets?: { text: string; knownBy: string[] }[];
  parent?: string;
  folder?: string;
  essentials?: string;
  semantic?: boolean;
  entity?: string;
  trackerWhen?: string;
}

export const extraOf = (e: { extra: Record<string, unknown> }) => (e.extra ?? {}) as EntryExtra;
const normName = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, " ").replace(/\s+/g, " ").trim();

/** The few words of an entry that matter most: its essentials, else its first two sentences. */
export function essentialsOf(e: ScanEntry | LoreEntryLike) {
  const x = extraOf(e).essentials?.trim();
  if (x) return x;
  const sents = e.content.replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s+/);
  return sents.slice(0, 2).join(" ").slice(0, 320);
}
type LoreEntryLike = { content: string; extra: Record<string, unknown> };

/** Lore secrets are told to the model with who knows them, so it keeps them in the right mouths (LORE-09). */
function withSecrets(e: ScanEntry, content: string) {
  const secrets = extraOf(e).secrets?.filter((s) => s.text?.trim()) ?? [];
  if (!secrets.length) return content;
  return `${content}\n${secrets.map((s) => `[Secret${s.knownBy?.length ? ` — known only to ${s.knownBy.join(", ")}` : ""}: ${s.text.trim()}]`).join("\n")}`;
}

export interface TraceItem {
  id: string;
  bookName: string;
  comment: string;
  status: "active" | "inactive";
  reason: string;
  level?: number;
  tokens?: number;
  position?: LorePosition;
  order: number;
  /** LORE-14: how much this entry mattered when the budget was tight. */
  priority?: number;
}

export interface ActivatedEntry {
  entry: ScanEntry;
  tokens: number;
  reason: string;
  level: number;
  content: string;
  /** LORE-14 priority inputs. */
  score?: number;
  kind?: "key" | "constant" | "entity" | "semantic" | "sticky" | "recursion" | "parent";
}

export interface Placements {
  before_char: string[];
  after_char: string[];
  an_top: string[];
  an_bottom: string[];
  ex_top: string[];
  ex_bottom: string[];
  depth: { depth: number; role: Role; content: string; order: number }[];
  /** Keyword-triggered before/after-character entries, moved out of the cached prefix (CTX-04). */
  triggered: string[];
}

export interface ActivationResult {
  activated: ActivatedEntry[];
  placements: Placements;
  trace: TraceItem[];
  stateUpdates: Record<string, TimedState>;
  totalTokens: number;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function parseRegexKey(key: string): RegExp | null {
  const m = key.match(/^\/([\s\S]+)\/([dgimsuvy]*)$/);
  if (!m) return null;
  try {
    return new RegExp(m[1]!, m[2]!.replace("g", ""));
  } catch {
    return null;
  }
}

export function keyMatches(key: string, text: string, caseSensitive: boolean, wholeWords: boolean): boolean {
  const k = key.trim();
  if (!k) return false;
  const rx = parseRegexKey(k);
  if (rx) return rx.test(text);
  const needle = caseSensitive ? k : k.toLowerCase();
  const hay = caseSensitive ? text : text.toLowerCase();
  if (!wholeWords) return hay.includes(needle);
  return new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRe(needle)}(?![\\p{L}\\p{N}_])`, "u").test(hay);
}

interface MatchResult {
  ok: boolean;
  reason: string;
  score: number;
}

/** Runs SillyTavern-compatible World Info activation (LORE-01) and explains every decision (LORE-04). */
export function activateLore(input: ActivationInput): ActivationResult {
  const { defaults, messageCount } = input;
  const random = input.random ?? Math.random;
  const sub = input.substitute ?? ((s: string) => s);
  const trace = new Map<string, TraceItem>();
  const active = new Map<string, ActivatedEntry>();
  const excluded = new Set<string>();

  const setTrace = (e: ScanEntry, status: TraceItem["status"], reason: string, extra: Partial<TraceItem> = {}) =>
    trace.set(e.id, { id: e.id, bookName: e.bookName, comment: e.comment || e.keys.slice(0, 3).join(", ") || "(untitled)", status, reason, order: e.order, position: e.position, ...extra });

  const scanCache = new Map<number, string>();
  const scanText = (e: ScanEntry) => {
    const depth = Math.max(0, e.scanDepth ?? e.book.scanDepth ?? defaults.scanDepth);
    let text = scanCache.get(depth);
    if (text === undefined) {
      text = depth === 0 ? "" : input.history.slice(-depth).join("\n");
      scanCache.set(depth, text);
    }
    return text;
  };

  const present = new Set((input.present ?? []).map(normName).filter(Boolean));
  const match = (e: ScanEntry, text: string, level: number): MatchResult & { kind?: ActivatedEntry["kind"] } => {
    if (e.constant) return { ok: true, reason: "constant", score: 0, kind: "constant" };
    const x = extraOf(e);
    const keys = [...e.keys, ...(x.aliases ?? [])].filter((k) => k.trim());
    const cs = e.caseSensitive ?? e.book.caseSensitive ?? defaults.caseSensitive;
    const ww = e.matchWholeWords ?? e.book.matchWholeWords ?? defaults.matchWholeWords;
    const primary = keys.filter((k) => keyMatches(sub(k), text, cs, ww));
    if (primary.length === 0) {
      if (level === 0) {
        // LORE-06: the entry's entity is in the scene, even if nobody said its name.
        const names = [x.entity, ...keys.filter((k) => !/^\/.*\/[a-z]*$/.test(k)), ...(x.type && e.comment ? [e.comment] : [])].filter((n): n is string => Boolean(n?.trim()));
        const here = names.find((n) => present.has(normName(sub(n))));
        if (here) return { ok: true, reason: `"${here}" is in the scene`, score: 2, kind: "entity" };
        // LORE-05: close enough in meaning to what's happening.
        const sim = input.semantic?.(e);
        if (sim != null && sim >= (input.semanticThreshold ?? 0.45)) return { ok: true, reason: `similar meaning (${sim.toFixed(2)})`, score: 1 + sim, kind: "semantic" };
      }
      return { ok: false, reason: keys.length ? "no key matched" : "no keys", score: 0 };
    }
    let secondaryHits = 0;
    if (e.secondaryKeys.length > 0) {
      secondaryHits = e.secondaryKeys.filter((k) => keyMatches(sub(k), text, cs, ww)).length;
      const total = e.secondaryKeys.length;
      const ok =
        e.logic === "and_any" ? secondaryHits > 0 : e.logic === "and_all" ? secondaryHits === total : e.logic === "not_any" ? secondaryHits === 0 : secondaryHits < total;
      if (!ok) return { ok: false, reason: `secondary keys failed (${e.logic.replace("_", " ")})`, score: 0 };
    }
    return { ok: true, reason: `key "${primary[0]}"`, score: primary.length + secondaryHits, kind: "key" };
  };

  const candidates: ScanEntry[] = [];
  for (const e of input.entries) {
    if (!e.enabled) {
      setTrace(e, "inactive", "disabled");
      continue;
    }
    if (!e.content.trim()) {
      setTrace(e, "inactive", "empty content");
      continue;
    }
    const st = input.state[e.id];
    if (e.delay > 0 && messageCount < e.delay) {
      setTrace(e, "inactive", `delayed until message ${e.delay}`);
      continue;
    }
    if (st?.stickyUntil != null && st.stickyUntil > messageCount) {
      active.set(e.id, { entry: e, tokens: 0, reason: `sticky (${st.stickyUntil - messageCount} more)`, level: 0, content: e.content, kind: "sticky", score: 1 });
      continue;
    }
    if (st?.cooldownUntil != null && st.cooldownUntil > messageCount) {
      setTrace(e, "inactive", `cooldown (${st.cooldownUntil - messageCount} more)`);
      continue;
    }
    candidates.push(e);
  }

  const applyGroups = (fresh: (ActivatedEntry & { score: number })[]) => {
    const losers = new Set<ActivatedEntry>();
    const groups = new Map<string, (ActivatedEntry & { score: number })[]>();
    for (const a of fresh) {
      for (const g of a.entry.group.split(",").map((s) => s.trim()).filter(Boolean)) {
        if (!groups.has(g)) groups.set(g, []);
        groups.get(g)!.push(a);
      }
    }
    for (const [g, members] of groups) {
      const holder = [...active.values()].find((a) => a.entry.group.split(",").map((s) => s.trim()).includes(g));
      if (holder) {
        for (const m of members) losers.add(m);
        continue;
      }
      let pool = members.filter((m) => !losers.has(m));
      if (pool.length <= 1) continue;
      if (pool.some((m) => m.entry.useGroupScoring)) {
        const best = Math.max(...pool.map((m) => m.score));
        for (const m of pool) if (m.score < best) losers.add(m);
        pool = pool.filter((m) => m.score === best);
      }
      let winner: ActivatedEntry;
      const overrides = pool.filter((m) => m.entry.groupOverride);
      if (overrides.length) {
        winner = overrides.reduce((a, b) => (b.entry.order > a.entry.order ? b : a));
      } else {
        const total = pool.reduce((n, m) => n + Math.max(0, m.entry.groupWeight), 0);
        let roll = random() * (total || pool.length);
        winner = pool[pool.length - 1]!;
        for (const m of pool) {
          roll -= total ? Math.max(0, m.entry.groupWeight) : 1;
          if (roll < 0) {
            winner = m;
            break;
          }
        }
      }
      for (const m of pool) if (m !== winner) losers.add(m);
    }
    for (const l of losers) setTrace(l.entry, "inactive", `lost inclusion group "${l.entry.group}"`, { level: l.level });
    return fresh.filter((a) => !losers.has(a));
  };

  let recursionBuffer = "";
  for (const a of active.values()) if (!a.entry.preventRecursion) recursionBuffer += `\n${a.entry.content}`;
  const maxLevel = defaults.recursive ? Math.max(0, defaults.maxRecursion) : 0;
  for (let level = 0; level <= maxLevel; level++) {
    const fresh: (ActivatedEntry & { score: number })[] = [];
    for (const e of candidates) {
      if (active.has(e.id) || excluded.has(e.id)) continue;
      if (level === 0 && e.delayUntilRecursion && !e.constant) {
        if (!trace.has(e.id)) setTrace(e, "inactive", "waits for recursion");
        continue;
      }
      if (level > 0 && e.excludeRecursion) continue;
      const text = level === 0 ? scanText(e) : `${scanText(e)}\n${recursionBuffer}`;
      const m = match(e, text, level);
      if (!m.ok) {
        setTrace(e, "inactive", m.reason);
        continue;
      }
      if (e.useProbability && e.probability < 100) {
        const roll = random() * 100;
        if (roll >= e.probability) {
          excluded.add(e.id);
          setTrace(e, "inactive", `probability ${e.probability}% (rolled ${Math.floor(roll)})`);
          continue;
        }
      }
      fresh.push({ entry: e, tokens: 0, reason: level > 0 ? `${m.reason} (recursion)` : m.reason, level, content: e.content, score: m.score, kind: level > 0 ? "recursion" : m.kind });
    }
    const winners = applyGroups(fresh);
    if (winners.length === 0) break;
    for (const w of winners) {
      active.set(w.entry.id, { entry: w.entry, tokens: 0, reason: w.reason, level: w.level, content: w.content, score: w.score, kind: w.kind });
      if (!w.entry.preventRecursion) recursionBuffer += `\n${w.entry.content}`;
    }
  }

  // LORE-10: a child that fires brings its parent's essentials (world › region › city › building).
  const byId = new Map((input.all ?? input.entries).map((e) => [e.id, e]));
  for (const a of [...active.values()]) {
    let parentId = extraOf(a.entry).parent;
    for (let depth = 0; parentId && depth < 4; depth++) {
      const p = byId.get(parentId);
      if (!p || !p.enabled || active.has(p.id)) break;
      active.set(p.id, { entry: { ...p, position: a.entry.position, depth: a.entry.depth, role: a.entry.role }, tokens: 0, reason: `essentials, as the parent of ${a.entry.comment || a.entry.keys[0] || "an entry"}`, level: a.level, content: essentialsOf(p), kind: "parent", score: 0.5 });
      parentId = extraOf(p).parent;
    }
  }

  // LORE-14: priority decides what stays when the budget is tight; long entries are trimmed
  // to their essentials before they are dropped.
  const priority = (a: ActivatedEntry) =>
    a.entry.order +
    (a.kind === "constant" ? 60 : a.kind === "sticky" ? 30 : a.kind === "entity" ? 35 : a.kind === "semantic" ? 15 : a.kind === "parent" ? 10 : 25) +
    Math.min(20, (a.score ?? 0) * 5) -
    a.level * 10;
  const sorted = [...active.values()].sort((a, b) => priority(b) - priority(a) || b.entry.order - a.entry.order);
  const accepted: ActivatedEntry[] = [];
  let used = 0;
  for (const a of sorted) {
    let content = withSecrets(a.entry, sub(a.content));
    let tokens = input.countTokens(content);
    let reason = a.reason;
    const p = Math.round(priority(a));
    if (defaults.tokenBudget > 0 && used + tokens > defaults.tokenBudget) {
      const short = withSecrets(a.entry, sub(essentialsOf(a.entry)));
      const st = input.countTokens(short);
      if (a.kind !== "parent" && short.length < content.length && used + st <= defaults.tokenBudget) {
        content = short;
        tokens = st;
        reason = `${a.reason} · trimmed to its essentials to fit the budget`;
      } else {
        setTrace(a.entry, "inactive", `over token budget (${tokens} tokens, ${defaults.tokenBudget - used} left; priority ${p})`, { level: a.level, tokens, priority: p });
        continue;
      }
    }
    used += tokens;
    accepted.push({ ...a, content, tokens, reason });
    setTrace(a.entry, "active", reason, { level: a.level, tokens, priority: p });
  }

  accepted.sort((a, b) => a.entry.order - b.entry.order);
  const placements: Placements = { before_char: [], after_char: [], an_top: [], an_bottom: [], ex_top: [], ex_bottom: [], depth: [], triggered: [] };
  const stateUpdates: Record<string, TimedState> = {};
  for (const a of accepted) {
    if (a.entry.position === "depth") placements.depth.push({ depth: a.entry.depth, role: a.entry.role, content: a.content, order: a.entry.order });
    else if (input.splitTriggered && !a.entry.constant && (a.entry.position === "before_char" || a.entry.position === "after_char")) placements.triggered.push(a.content);
    else placements[a.entry.position].push(a.content);
    const fresh = !a.reason.startsWith("sticky");
    if (fresh && (a.entry.sticky > 0 || a.entry.cooldown > 0)) {
      const stickyUntil = a.entry.sticky > 0 ? messageCount + a.entry.sticky : null;
      const cooldownUntil = a.entry.cooldown > 0 ? (stickyUntil ?? messageCount) + a.entry.cooldown : null;
      stateUpdates[a.entry.id] = { stickyUntil, cooldownUntil };
    }
  }

  const traceList = input.entries.map((e) => trace.get(e.id)).filter((t): t is TraceItem => Boolean(t));
  return { activated: accepted, placements, trace: traceList, stateUpdates, totalTokens: used };
}
