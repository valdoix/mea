import { countTokens } from "../lib/tokens";
import type { Category } from "./format";
import { HIDDEN_PART, type Parts, termsOf, textGivesAway, voiceProblems } from "./shapes";

/**
 * Quality checks for drafted lore (the studio's review step). Deterministic and instant:
 * genericness (stock names and phrases), keys that can't fire or fire on everything, keys two
 * entries fight over, and entries too thin or too long for their budget. Mirrors CHAR-13 for lore.
 */

export interface QualityIssue {
  kind: "no-keys" | "generic-key" | "key-clash" | "duplicate-title" | "stock-name" | "stock-phrase" | "thin" | "long" | "no-essentials" | "secret-unknown" | "secret-in-text" | "leak" | "kind";
  severity: "info" | "warn";
  message: string;
}

export interface CheckedEntry {
  id: string;
  title: string;
  constant: boolean;
  content: string;
  keys: string[];
  aliases: string[];
  essentials: string;
  secrets: { text: string; knownBy: string[] }[];
}

/** Names models reach for again and again. Fine if you chose one; worth a second look if you didn't. */
export const STOCK_NAMES = [
  "Elara", "Lyra", "Kael", "Kaelen", "Kaelan", "Thorne", "Seraphina", "Zephyr", "Eldoria", "Aethelgard", "Lysandra", "Elysia", "Elowen", "Isolde", "Nyx", "Vex", "Silas",
  "Cassian", "Aurelia", "Evangeline", "Sable", "Valerius", "Malachar", "Vorlag", "Aria", "Lirael", "Eryndor", "Aelar", "Faelan", "Thalia", "Calloway", "Voss", "Blackwood",
  "Ravenwood", "Willowbrook", "Oakhaven", "Shadowmere", "Whisperwood", "Silverwood", "Eldergrove", "Mistvale", "Stormhaven", "Ironhold", "Thornwood", "Brightwater", "Moonshadow",
];
const STOCK_NAME_RE = new RegExp(`\\b(${STOCK_NAMES.join("|")})\\b`, "g");

/** Phrases that make lore read as filler. Each costs tokens and says nothing a scene can use. */
export const STOCK_PHRASES = [
  "tapestry", "testament to", "shrouded in mystery", "steeped in", "nestled", "bustling", "a beacon of", "whispers of", "delve", "ancient evil", "ever-changing", "the fabric of",
  "a blend of", "myriad", "plethora", "palpable", "enigmatic", "intertwined", "boasts", "rich history", "veil of", "a sense of", "stands as", "serves as a reminder", "untold",
];

/** Single words that would fire an entry on nearly every message. */
const GENERIC_KEYS = new Set(
  "the a an he she they him her them his it i you we me my your our city town village king queen prince princess lord lady magic war love man woman men women house home door room night day morning evening sword knife gun god gods people world school forest wood woods river sea ocean lake water fire light dark darkness shadow power time money food drink tea coffee car road street shop bar inn church temple castle palace tower mountain hill field sky sun moon star rain snow wind storm friend family mother father brother sister son daughter child children boy girl old new big small good bad".split(
    " ",
  ),
);

const LENGTH_LIMIT = { lean: 180, standard: 320, rich: 500 } as const;
export type EntryLength = keyof typeof LENGTH_LIMIT;

export function checkEntries(entries: CheckedEntry[], opts: { existing?: { title: string; keys: string[] }[]; length?: EntryLength; cast?: string[] } = {}) {
  const limit = LENGTH_LIMIT[opts.length ?? "standard"];
  const norm = (s: string) => s.trim().toLowerCase();
  // Who claims each key: drafted entries by id, existing entries by title.
  const claims = new Map<string, string[]>();
  const claim = (k: string, who: string) => {
    const n = norm(k);
    if (n) claims.set(n, [...new Set([...(claims.get(n) ?? []), who])]);
  };
  for (const e of entries) for (const k of [...e.keys, ...e.aliases]) claim(k, `draft:${e.id}`);
  for (const x of opts.existing ?? []) for (const k of x.keys) claim(k, `book:${x.title}`);
  const titleOf = (who: string) => (who.startsWith("draft:") ? (entries.find((e) => e.id === who.slice(6))?.title ?? "?") : who.slice(5));
  const existingTitles = new Set((opts.existing ?? []).map((x) => norm(x.title)));
  const known = new Set([...entries.map((e) => norm(e.title)), ...(opts.cast ?? []).map(norm)]);

  const out: Record<string, QualityIssue[]> = {};
  for (const e of entries) {
    const issues: QualityIssue[] = [];
    const keys = [...e.keys, ...e.aliases].map((k) => k.trim()).filter(Boolean);
    if (!e.constant && !keys.length) issues.push({ kind: "no-keys", severity: "warn", message: "No keywords, so it can only fire when its subject is in the scene." });
    for (const k of keys) {
      if (/^\/.*\/[a-z]*$/.test(k)) continue;
      if (k.length < 3 || GENERIC_KEYS.has(norm(k))) issues.push({ kind: "generic-key", severity: "warn", message: `"${k}" is so common it would fire on almost every message.` });
    }
    const clashes = [...new Set(keys.flatMap((k) => (claims.get(norm(k)) ?? []).filter((w) => w !== `draft:${e.id}`).map((w) => `"${k}" (also ${titleOf(w)})`)))];
    if (clashes.length) issues.push({ kind: "key-clash", severity: "info", message: `Shares keywords with other entries: ${clashes.slice(0, 3).join(", ")}.` });
    if (existingTitles.has(norm(e.title))) issues.push({ kind: "duplicate-title", severity: "warn", message: `The book already has an entry called "${e.title}".` });
    else if (entries.some((o) => o.id !== e.id && norm(o.title) === norm(e.title))) issues.push({ kind: "duplicate-title", severity: "warn", message: `Two drafted entries are called "${e.title}".` });
    const names = [...new Set([...(e.title + " " + e.content).matchAll(STOCK_NAME_RE)].map((m) => m[1]!))];
    if (names.length) issues.push({ kind: "stock-name", severity: "info", message: `${names.join(", ")}: ${names.length > 1 ? "names" : "a name"} models use a lot. Keep ${names.length > 1 ? "them" : "it"} if you chose ${names.length > 1 ? "them" : "it"}.` });
    const lower = e.content.toLowerCase();
    const phrases = STOCK_PHRASES.filter((p) => lower.includes(p));
    if (phrases.length) issues.push({ kind: "stock-phrase", severity: "info", message: `Stock phrasing: ${phrases.slice(0, 4).map((p) => `"${p}"`).join(", ")}. Concrete details serve a scene better.` });
    const tokens = countTokens(e.content);
    if (e.content.trim() && tokens < 25) issues.push({ kind: "thin", severity: "info", message: `Only ${tokens} tokens; a scene may need more to go on.` });
    if (tokens > limit) issues.push({ kind: "long", severity: e.constant ? "warn" : "info", message: `${tokens} tokens (the target is under ${limit})${e.constant ? ", and it's always on" : ""}. Condense it or split it.` });
    if (!e.essentials.trim() && tokens > 120) issues.push({ kind: "no-essentials", severity: "info", message: "No essentials line, so a tight budget or a child entry gets its first two sentences instead." });
    for (const s of e.secrets) {
      const unknown = s.knownBy.filter((k) => k.trim() && !known.has(norm(k)));
      if (!s.knownBy.length) issues.push({ kind: "secret-unknown", severity: "info", message: `A secret nobody knows ("${s.text.slice(0, 50)}…"): the leak guard will keep it from every character.` });
      else if (unknown.length && unknown.length === s.knownBy.length && known.size > 1) issues.push({ kind: "secret-unknown", severity: "info", message: `Known by ${unknown.join(", ")}, who ${unknown.length > 1 ? "have" : "has"} no entry here.` });
      // docs/17, 3.3: the open text mustn't say what the secret keeps.
      if (textGivesAway(e.content, s.text)) issues.push({ kind: "secret-in-text", severity: "warn", message: `The text gives away its own secret ("${s.text.slice(0, 60)}…"): every scene would know it. Keep it to the secret.` });
    }
    out[e.id] = issues;
  }
  return out;
}

// ---------- checks by kind (docs/17, 6.1) ----------

export interface KindChecked {
  id: string;
  title: string;
  kind: Category | null;
  content: string;
  keys: string[];
  parts: Parts;
  secrets: { text: string; knownBy: string[] }[];
  /** The names of who it's about (resolved), and how many of its subjects couldn't be found. */
  subjects: string[];
  missingSubjects: number;
}

const listOf = (v: string | string[] | undefined) => (Array.isArray(v) ? v : v ? [v] : []).map((x) => String(x).trim()).filter(Boolean);
const PAST = /\b(was|were|had|did|went|came|took|made|said|began|became|fled|died|left)\b/gi;
const PRESENT = /\b(is|are|has|have|does|goes|comes|takes|makes|says|keeps|holds|wants|stands|waits|burns|hides|runs)\b/gi;
const BACKSTORY = /\b(years ago|long ago|once,|used to|had been|as a child|in the past|decades? ago|generations? ago)\b/gi;
const FUTURE = /\b(will|would|soon|coming|about to|going to|may|might|shall|when|before|until|at (?:midwinter|dawn|dusk)|next|by the)\b/i;
const NOW = /\b(now|currently|these days|still|today|lately|at present|since then|no longer)\b/i;

/**
 * What each kind needs (docs/17, 6.1): a voice's sample lines, a Current entry in the present, an
 * Upcoming one in the future, a relationship naming both and where it stands, a reaction's trigger,
 * a kept truth, a mystery's clues, a lexicon's terms, a routine's times, a canon book's "not yet",
 * and a satellite's subject that exists. Same severities as the rest of the checks.
 */
export function checkKinds(entries: KindChecked[], opts: { basedOn?: string; length?: EntryLength; known?: string[]; history?: string[] } = {}) {
  const norm = (s: string) => s.trim().toLowerCase();
  const known = (opts.known ?? []).map(norm);
  const isKnown = (name: string) => known.some((k) => k === norm(name) || k.includes(norm(name)) || norm(name).includes(k));
  const out: Record<string, QualityIssue[]> = {};
  for (const e of entries) {
    const issues: QualityIssue[] = [];
    const warn = (message: string) => issues.push({ kind: "kind", severity: "warn", message });
    const info = (message: string) => issues.push({ kind: "kind", severity: "info", message });
    const p = e.parts;
    if (e.missingSubjects) warn(`It's about someone who isn't in the plan or the book any more. Pick who it's about, or leave it out.`);
    switch (e.kind) {
      case "voice": {
        for (const m of voiceProblems(p)) warn(m);
        // A sample line using a word they'd never use contradicts the voice.
        const never = listOf(p["never says"]).map(norm).filter((w) => w.length >= 2);
        const said = listOf(p["sample lines"]).filter((l) => never.some((w) => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(l)));
        if (said.length) warn(`A sample line uses a word they'd never use: “${said[0]}”.`);
        break;
      }
      case "current": {
        const past = e.content.match(PAST)?.length ?? 0;
        const present = e.content.match(PRESENT)?.length ?? 0;
        if (past > present && past >= 3) warn("Mostly in the past tense: a Current entry is what's happening now, written to be played.");
        if ((e.content.match(BACKSTORY)?.length ?? 0) > 1) info("More than a clause of backstory: keep why it started to one clause.");
        if (Object.keys(p).length && (!p.who || !p.where)) info(`It doesn't say ${!p.who ? "who is doing it" : "where it's happening"}.`);
        break;
      }
      case "upcoming": {
        if (!FUTURE.test(e.content)) warn("It reads as if it already happened: say what's coming, roughly when, and the signs.");
        const past = (opts.history ?? []).find((h) => norm(h) && (norm(e.title).includes(norm(h)) || norm(h).includes(norm(e.title).replace(/^upcoming\s*[:—-]\s*/, ""))));
        if (past) warn(`“${past}” is already in History: it can't be both coming and past.`);
        break;
      }
      case "relationship": {
        const missing = e.subjects.filter((n) => !new RegExp(`\\b${(n.split(/\s+/)[0] ?? n).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(e.content));
        if (missing.length) warn(`It never names ${missing.join(" or ")}.`);
        if (!NOW.test(e.content)) info("It doesn't say where things stand between them now.");
        break;
      }
      case "reaction": {
        if (!p.trigger && !e.keys.length) warn("No trigger: say what sets it off, and key it on those words.");
        const own = new Set(e.subjects.flatMap((n) => [n, ...n.split(/\s+/)]).map(norm));
        const named = e.keys.filter((k) => own.has(norm(k)));
        if (named.length) warn(`Keyed on ${named.map((k) => `“${k}”`).join(", ")}: it would fire whenever they're mentioned, not when the topic comes up.`);
        break;
      }
      case "lexicon": {
        const terms = termsOf(p);
        if (terms.length < 5) warn(`Only ${terms.length} term${terms.length === 1 ? "" : "s"}: five or more give a scene words to use.`);
        const keys = new Set(e.keys.map(norm));
        const unkeyed = terms.filter((t) => !keys.has(norm(t)));
        if (unkeyed.length) info(`Not keyed: ${unkeyed.slice(0, 5).map((t) => `“${t}”`).join(", ")}, so the entry won't come up when they're said.`);
        break;
      }
      case "money": {
        const n = listOf(p.prices).length + listOf(p.coins).length;
        if (n < 5) warn(`Only ${n} coin${n === 1 ? "" : "s"} or price${n === 1 ? "" : "s"}: five or more let a scene haggle.`);
        break;
      }
      case "routine": {
        const lines = listOf(p.schedule);
        if (lines.length < 3) warn(`Only ${lines.length} time${lines.length === 1 ? "" : "s"} in the schedule: three or more place people through a day.`);
        const who = lines.flatMap((l) => (l.split(/:\s+/).slice(1).join(": ").split(/,|\s[—–-]\s/)[0] ?? "").match(/\b[A-Z][a-z]+(?: [A-Z][a-z]+)*/g) ?? []).filter((n) => !/^(The|A|An|At|In|On)$/.test(n));
        const strangers = [...new Set(who.filter((n) => !isKnown(n)))];
        if (strangers.length && known.length) info(`${strangers.slice(0, 3).join(", ")} ${strangers.length > 1 ? "aren't" : "isn't"} in the plan or the book.`);
        break;
      }
      case "timeline":
        if (opts.basedOn && !listOf(p["not yet"]).length) warn(`No “not yet” list: name the events of ${opts.basedOn} that haven't happened, so the story neither spoils nor skips them.`);
        break;
    }
    if (e.kind === "mystery") {
      const clues = listOf(p.clues).length;
      if (clues < 3) warn(`Only ${clues} clue${clues === 1 ? "" : "s"}: three or more give a scene something to find.`);
      if ((opts.length ?? "standard") !== "lean" && !listOf(p["red herrings"]).length) info("No false lead: one red herring keeps the answer from being obvious.");
    }
    if (e.kind && HIDDEN_PART[e.kind] && !e.secrets.length) warn("Its truth isn't kept as a secret: write it into the secrets, with who knows it, never into the open text.");
    if (issues.length) out[e.id] = issues;
  }
  return out;
}
