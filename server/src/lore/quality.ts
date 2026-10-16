import { countTokens } from "../lib/tokens";

/**
 * Quality checks for drafted lore (the studio's review step). Deterministic and instant:
 * genericness (stock names and phrases), keys that can't fire or fire on everything, keys two
 * entries fight over, and entries too thin or too long for their budget. Mirrors CHAR-13 for lore.
 */

export interface QualityIssue {
  kind: "no-keys" | "generic-key" | "key-clash" | "duplicate-title" | "stock-name" | "stock-phrase" | "thin" | "long" | "no-essentials" | "secret-unknown" | "leak";
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
    }
    out[e.id] = issues;
  }
  return out;
}
