import type { EntryExtra } from "./activate";

/**
 * Import from documents (LORE-16): Markdown split by headings (nesting becomes folders and
 * parents), a "Name: definition" glossary, or plain prose in chunks. No model calls, so a whole
 * setting bible turns into draft entries instantly; the studio can polish any of them later.
 */

export type EntryType = NonNullable<EntryExtra["type"]>;

export interface ParsedSection {
  title: string;
  type: EntryType | null;
  folder: string;
  /** Index of the parent section in the list, or -1. */
  parent: number;
  source: string;
}

export interface ParsedDocument {
  title: string;
  overview: string;
  shape: "headings" | "glossary" | "prose";
  sections: ParsedSection[];
}

const MAX_SECTIONS = 200;

/** Words in a heading (or its folder) that say what kind of entry lives under it. */
const TYPE_HINTS: [RegExp, EntryType][] = [
  [/\b(characters?|people|persons?|npcs?|cast|who'?s who|figures|residents|villagers|crew|family|dramatis)\b/i, "character"],
  [/\b(places?|locations?|geography|regions?|cities|towns?|districts?|realms?|lands?|map|landmarks?|buildings?|rooms?|kingdoms?|provinces?|planets?|worlds?)\b/i, "location"],
  [/\b(factions?|organi[sz]ations?|guilds?|houses?|clans?|orders?|groups?|companies|corporations?|gangs?|cults?|nations?|tribes?|families)\b/i, "faction"],
  [/\b(items?|objects?|artifacts?|artefacts?|relics?|weapons?|equipment|gear|treasures?|possessions?)\b/i, "item"],
  [/\b(history|events?|timeline|wars?|eras?|ages?|chronology|battles?|incidents?)\b/i, "event"],
  [/\b(rules?|laws?|customs?|taboos?|constraints?|tenets?)\b/i, "rule"],
  [/\b(magic|religions?|beliefs?|gods?|deities|technology|tech|science|culture|concepts?|lore|systems?|languages?|economy|creatures?|species|races?|bestiary)\b/i, "concept"],
];

export function guessType(...titles: string[]): EntryType | null {
  // The heading itself wins over its folders; folders are checked nearest first.
  for (const t of titles) for (const [re, type] of TYPE_HINTS) if (re.test(t)) return type;
  return null;
}

const clean = (s: string) =>
  s
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

/** "**The Gull Inn**" → "The Gull Inn"; trailing colons and heading hashes go too. */
export const cleanTitle = (s: string) =>
  s
    .replace(/^[#\s]+|[#\s]+$/g, "")
    .replace(/^\*\*(.+)\*\*$/, "$1")
    .replace(/^__(.+)__$/, "$1")
    .replace(/[:：]\s*$/, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);

function stripFrontMatter(text: string) {
  return text.replace(/^---\n[\s\S]*?\n---\n/, "");
}

export function parseDocument(raw: string, fileName = ""): ParsedDocument {
  const text = clean(stripFrontMatter(raw.replace(/\r\n?/g, "\n")));
  const fallbackTitle = cleanTitle(fileName.replace(/\.(md|markdown|txt|text)$/i, "").replace(/[_-]+/g, " ")) || "Imported notes";
  const lines = text.split("\n");
  const headingRe = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
  let inFence = false;
  const headings: { line: number; level: number; title: string }[] = [];
  lines.forEach((l, i) => {
    if (/^\s*```/.test(l)) inFence = !inFence;
    const m = !inFence && l.match(headingRe);
    if (m) headings.push({ line: i, level: m[1]!.length, title: cleanTitle(m[2]!) });
  });
  if (headings.length) return fromHeadings(lines, headings, fallbackTitle);
  const glossary = fromGlossary(lines, fallbackTitle);
  if (glossary) return glossary;
  return fromProse(text, fallbackTitle);
}

function fromHeadings(lines: string[], headings: { line: number; level: number; title: string }[], fallbackTitle: string): ParsedDocument {
  const bodyOf = (k: number) => clean(lines.slice(headings[k]!.line + 1, headings[k + 1]?.line ?? lines.length).join("\n"));
  const intro = clean(lines.slice(0, headings[0]!.line).join("\n"));
  // A single top-level heading at the start is the document's title; its text is the overview.
  const h1s = headings.filter((h) => h.level === 1);
  let start = 0;
  let title = fallbackTitle;
  let overview = intro;
  if (h1s.length === 1 && headings[0]!.level === 1 && !intro) {
    title = headings[0]!.title || fallbackTitle;
    overview = bodyOf(0);
    start = 1;
  }
  const sections: ParsedSection[] = [];
  // The open headings above the current one, each with the section it became (or -1 for a group).
  const stack: { level: number; title: string; section: number }[] = [];
  for (let k = start; k < headings.length && sections.length < MAX_SECTIONS; k++) {
    const h = headings[k]!;
    while (stack.length && stack.at(-1)!.level >= h.level) stack.pop();
    const body = bodyOf(k);
    const hasChildren = headings[k + 1] !== undefined && headings[k + 1]!.level > h.level;
    const ancestors = stack.map((s) => s.title);
    let index = -1;
    // A heading with no text of its own but with sub-headings is a folder, not an entry.
    if (body || !hasChildren) {
      const parent = [...stack].reverse().find((s) => s.section >= 0)?.section ?? -1;
      sections.push({ title: h.title || "Untitled", type: guessType(h.title, ...[...ancestors].reverse()), folder: ancestors.join(" › "), parent, source: body });
      index = sections.length - 1;
    }
    stack.push({ level: h.level, title: h.title, section: index });
  }
  return { title, overview, shape: "headings", sections };
}

/** "Name: what it is" lines (optionally bulleted or bold), with continuation lines folded in. */
function fromGlossary(lines: string[], fallbackTitle: string): ParsedDocument | null {
  const termRe = /^\s*(?:[-*•]\s+)?(?:\*\*|__)?([A-Z0-9][^:\n]{0,60}?)(?:\*\*|__)?\s*(?::|—|–| - )\s+(\S.*)$/;
  const nonEmpty = lines.filter((l) => l.trim());
  const terms = nonEmpty.filter((l) => termRe.test(l));
  if (terms.length < 3 || terms.length < nonEmpty.length * 0.4) return null;
  const sections: ParsedSection[] = [];
  const intro: string[] = [];
  for (const l of lines) {
    const m = l.match(termRe);
    if (m && m[1]!.split(/\s+/).length <= 7) {
      if (sections.length >= MAX_SECTIONS) break;
      const title = cleanTitle(m[1]!);
      sections.push({ title, type: guessType(title), folder: "", parent: -1, source: m[2]!.trim() });
    } else if (l.trim()) {
      if (sections.length) sections.at(-1)!.source += `\n${l.trim()}`;
      else intro.push(l.trim());
    }
  }
  return { title: fallbackTitle, overview: intro.join("\n"), shape: "glossary", sections };
}

/** Plain notes: paragraphs grouped into chunks of about 180 words, each titled by its first name. */
function fromProse(text: string, fallbackTitle: string): ParsedDocument {
  const paras = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const chunks: string[] = [];
  let cur: string[] = [];
  let words = 0;
  for (const p of paras) {
    const n = p.split(/\s+/).length;
    if (cur.length && words + n > 180) {
      chunks.push(cur.join("\n\n"));
      cur = [];
      words = 0;
    }
    cur.push(p);
    words += n;
  }
  if (cur.length) chunks.push(cur.join("\n\n"));
  const sections = chunks.slice(0, MAX_SECTIONS).map((c, i) => {
    const title = proseTitle(c) || `Notes ${i + 1}`;
    return { title, type: guessType(title), folder: "", parent: -1, source: c };
  });
  return { title: fallbackTitle, overview: "", shape: "prose", sections };
}

const SENTENCE_STARTERS = new Set(["The", "A", "An", "In", "On", "At", "It", "He", "She", "They", "We", "I", "This", "That", "There", "When", "After", "Before", "Once", "Every", "Most", "Some", "Many"]);

/** The first proper name in a chunk ("Port Ellis is…" → "Port Ellis"), else its first few words. */
function proseTitle(chunk: string) {
  const first = chunk.replace(/[*_#>`]/g, "").split(/(?<=[.!?])\s+/)[0] ?? "";
  const names = first.match(/\b[A-Z][\p{L}'’-]+(?:\s+(?:of|the|de|van|von)?\s*[A-Z][\p{L}'’-]+)*/gu) ?? [];
  const name = names.find((n) => !SENTENCE_STARTERS.has(n));
  if (name) return name.slice(0, 60);
  return first.split(/\s+/).slice(0, 5).join(" ").replace(/[,.;:!?]+$/, "");
}

// ---------- a draft entry straight from the source text ----------

/** Names the text gives itself: "also called the Gull", "known as Old Joss", "(aka the Gull)". */
export function aliasesIn(title: string, text: string) {
  const out = new Set<string>();
  const paren = title.match(/^(.*?)\s*\((?:aka |a\.k\.a\. )?([^)]+)\)\s*$/i);
  if (paren) out.add(paren[2]!.trim());
  for (const m of text.matchAll(/\b(?:also (?:called|known as)|known as|a\.?k\.?a\.?|nicknamed|called)\s+(?:the\s+)?["“']?([A-Z][\p{L}'’-]+(?:\s+[A-Z][\p{L}'’-]+){0,3})["”']?/gu)) out.add(m[1]!.trim());
  return [...out].filter((a) => a.toLowerCase() !== title.toLowerCase() && a.length >= 2 && a.length <= 40).slice(0, 5);
}

export const baseTitle = (title: string) => title.replace(/\s*\([^)]*\)\s*$/, "").trim() || title;

export function firstSentences(text: string, max = 240) {
  const flat = text.replace(/^[-*•]\s+/gm, "").replace(/[*_`#>]/g, "").replace(/\s+/g, " ").trim();
  const sents = flat.split(/(?<=[.!?])\s+/);
  let out = "";
  for (const s of sents) {
    if (out && (out + " " + s).length > max) break;
    out = out ? `${out} ${s}` : s;
  }
  return out.slice(0, max);
}

export function entryFromSource(title: string, source: string) {
  const name = baseTitle(title);
  return {
    content: source.trim(),
    keys: [name],
    aliases: aliasesIn(title, source),
    essentials: firstSentences(source),
    secrets: [] as { text: string; knownBy: string[] }[],
  };
}
