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
}

export interface ActivatedEntry {
  entry: ScanEntry;
  tokens: number;
  reason: string;
  level: number;
  content: string;
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

  const match = (e: ScanEntry, text: string): MatchResult => {
    if (e.constant) return { ok: true, reason: "constant", score: 0 };
    if (e.keys.length === 0) return { ok: false, reason: "no keys", score: 0 };
    const cs = e.caseSensitive ?? e.book.caseSensitive ?? defaults.caseSensitive;
    const ww = e.matchWholeWords ?? e.book.matchWholeWords ?? defaults.matchWholeWords;
    const primary = e.keys.filter((k) => keyMatches(sub(k), text, cs, ww));
    if (primary.length === 0) return { ok: false, reason: "no key matched", score: 0 };
    let secondaryHits = 0;
    if (e.secondaryKeys.length > 0) {
      secondaryHits = e.secondaryKeys.filter((k) => keyMatches(sub(k), text, cs, ww)).length;
      const total = e.secondaryKeys.length;
      const ok =
        e.logic === "and_any" ? secondaryHits > 0 : e.logic === "and_all" ? secondaryHits === total : e.logic === "not_any" ? secondaryHits === 0 : secondaryHits < total;
      if (!ok) return { ok: false, reason: `secondary keys failed (${e.logic.replace("_", " ")})`, score: 0 };
    }
    return { ok: true, reason: `key "${primary[0]}"`, score: primary.length + secondaryHits };
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
      active.set(e.id, { entry: e, tokens: 0, reason: `sticky (${st.stickyUntil - messageCount} more)`, level: 0, content: e.content });
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
      const m = match(e, text);
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
      fresh.push({ entry: e, tokens: 0, reason: level > 0 ? `${m.reason} (recursion)` : m.reason, level, content: e.content, score: m.score });
    }
    const winners = applyGroups(fresh);
    if (winners.length === 0) break;
    for (const w of winners) {
      active.set(w.entry.id, { entry: w.entry, tokens: 0, reason: w.reason, level: w.level, content: w.content });
      if (!w.entry.preventRecursion) recursionBuffer += `\n${w.entry.content}`;
    }
  }

  // Budget: higher order = higher priority (LORE-14 refines this later).
  const sorted = [...active.values()].sort((a, b) => b.entry.order - a.entry.order || Number(b.entry.constant) - Number(a.entry.constant));
  const accepted: ActivatedEntry[] = [];
  let used = 0;
  for (const a of sorted) {
    const content = sub(a.content);
    const tokens = input.countTokens(content);
    if (defaults.tokenBudget > 0 && used + tokens > defaults.tokenBudget) {
      setTrace(a.entry, "inactive", `over token budget (${tokens} tokens, ${defaults.tokenBudget - used} left)`, { level: a.level, tokens });
      continue;
    }
    used += tokens;
    const done = { ...a, content, tokens };
    accepted.push(done);
    setTrace(a.entry, "active", a.reason, { level: a.level, tokens });
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
