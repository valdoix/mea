import { all, parseJson } from "../db/db";
import { excerpt } from "../memory/deep";
import { norm } from "../memory/entities";
import { cleanText, namedTerms } from "../memory/text";
import type { WorldState } from "../trackers/types";
import { sentences } from "./rules";
import type { Found } from "./slips";

/**
 * Old news (docs/26 Part 1). At #792 the plan said "The 'Brongel' nickname is new information (nobody
 * knew before he said it)" and Buffy said "you never mentioned this?" He'd told her at #88, and Dawn had
 * asked about the banner at #638. No record is not the same as nobody knowing, so a claim that something
 * is new is looked up on the page. Rules only. The page is the record, and a word it holds this rarely
 * is the same thing each time.
 */

/** A word in more earlier messages than this is too common to say what a passage is about. */
const RARE_MESSAGES = 12;

export interface Mention {
  messageId: string;
  seq: number;
  speaker: string;
  passage: string;
}

export interface OldNews {
  term: string;
  mentions: Mention[];
  /** Who the memories holding the word have down as knowing it. Empty: the memories don't say. */
  knownBy: string[];
}

/** Where a rare word was used before this message, or null when it's new or too common to tell. */
export function oldNews(chatId: string, term: string, beforeSeq: number): OldNews | null {
  const fts = `"${term.replaceAll('"', "")}"`;
  const said = all<{ id: string; seq: number; name: string | null; role: string; content: string }>(
    `SELECT m.id, m.seq, m.name, m.role, s.content FROM swipes_fts f JOIN swipes s ON s.rowid = f.rowid JOIN messages m ON m.id = s.message_id AND s.idx = m.active_swipe
     WHERE swipes_fts MATCH ? AND m.chat_id = ? AND m.seq < ? AND m.deleted_at IS NULL AND m.hidden = 0 ORDER BY m.seq LIMIT ?`,
    fts,
    chatId,
    beforeSeq,
    RARE_MESSAGES + 1,
  );
  if (!said.length || said.length > RARE_MESSAGES) return null;
  const heard = all<{ known_by: string }>(
    "SELECT m.known_by FROM memories_fts f JOIN memories m ON m.id = f.id WHERE memories_fts MATCH ? AND f.chat_id = ? AND m.deleted_at IS NULL AND m.status IN ('active', 'disputed') AND COALESCE(m.max_seq, 0) < ?",
    fts,
    chatId,
    beforeSeq,
  );
  const knownBy = new Map<string, string>();
  for (const h of heard) for (const k of parseJson<string[]>(h.known_by, [])) if (!knownBy.has(norm(k))) knownBy.set(norm(k), k);
  const mentions = said.map((m): Mention => ({ messageId: m.id, seq: m.seq, speaker: m.name ?? (m.role === "user" ? "The player" : "The reply"), passage: excerpt(m.content, new Set([term]), 160) }));
  return { term, mentions, knownBy: [...knownBy.values()] };
}

const castNames = (st: WorldState | null | undefined) => new Set(Object.values(st?.chars ?? {}).flatMap((c) => [c.name, ...c.name.split(/\s+/), ...c.aliases]).map(norm));

/** Whether this person is on the list, by any of their names. */
function holds(knownBy: string[], names: string[]) {
  const held = new Set(knownBy.flatMap((k) => [k, ...k.split(/\s+/)]).map(norm));
  return names.some((n) => held.has(norm(n)));
}

const seqList = (n: OldNews) => {
  const seqs = n.mentions.map((m) => `#${m.seq}`);
  return seqs.length > 1 ? `${seqs.slice(0, -1).join(", ")} and ${seqs.at(-1)}` : seqs[0]!;
};

/** Where it came up, with the first time quoted. */
export function mentionText(n: OldNews) {
  const first = n.mentions[0]!;
  return `It came up at ${seqList(n)}. ${first.speaker} at #${first.seq}: "${first.passage}"`;
}

// ---------- a plan that calls it new ----------

/**
 * "Nobody knows" looks ahead as often as back ("Nobody knows Spike's ETA"), and hearing a word isn't
 * knowing every sentence with it in ("Buffy doesn't know William wrote poetry"), so these are narrow:
 * the plan says outright the thing is new, or that someone has never heard this very word.
 */
const NOBODY = /\bnew information\b|\bnew to (?:everyone|everybody|all of them|the (?:room|table|group))\b|\b(?:nobody|no one|none of them|neither of them)(?:\s+\w+){0,2}\s+(?:knew|had heard|has heard)\b/i;
const NOT_HEARD = String.raw`(?:hasn['’]t|has\s+not|has\s+never|never|hadn['’]t)\s+(?:heard|been\s+told)(?:\s+(?:of|about))?`;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export interface NewsClaim {
  claim: string;
  /** Who the plan says hasn't heard it; empty when it says nobody has. */
  who: string;
  news: OldNews;
}

/**
 * The plan's sentences that call a rare word new. "Nobody knew" needs only an earlier mention. "Spike
 * hasn't heard of Brongel" needs the memories to have Spike down as knowing, since a word can be said in
 * front of some of the cast and not others, and at #792 he really hadn't heard it.
 */
export function newsClaims(chatId: string, st: WorldState | null | undefined, plan: string, beforeSeq: number): NewsClaim[] {
  const people = Object.values(st?.chars ?? {}).filter((c) => !c.isUser);
  const namesOf = (c: (typeof people)[number]) => [...new Set([c.name, c.name.split(/\s+/)[0]!, ...c.aliases].filter((n) => n.length >= 3))];
  const alt = people.flatMap(namesOf).sort((a, b) => b.length - a.length).map(esc).join("|");
  const them = alt ? new RegExp(String.raw`\b(${alt})\s+${NOT_HEARD}\s+(?:the\s+)?["'“‘*]*(\p{L}[\p{L}\p{N}'’-]{2,})`, "iu") : null;
  const cast = castNames(st);
  const out: NewsClaim[] = [];
  const add = (claim: string, who: string, term: string, news: OldNews | null) => {
    if (news && !cast.has(norm(term)) && !out.some((o) => o.news.term === term)) out.push({ claim, who, news });
  };
  for (const s of plan.split(/\n+/).flatMap((line) => line.split(/(?<=[.!?…])\s+|;\s+/)).map((x) => x.trim())) {
    if (s.length <= 12) continue;
    if (NOBODY.test(s)) for (const { term } of namedTerms(s)) add(s, "", term, oldNews(chatId, term, beforeSeq));
    const named = them ? s.match(them) : null;
    const person = named ? people.find((c) => namesOf(c).some((n) => n.toLowerCase() === named[1]!.toLowerCase())) : undefined;
    if (!named || !person) continue;
    const term = named[2]!.toLowerCase().replace(/['’]s$/, "");
    const news = oldNews(chatId, term, beforeSeq);
    if (news && holds(news.knownBy, namesOf(person))) add(s, person.name, term, news);
  }
  return out.slice(0, 2);
}

// ---------- a reply that calls it new ----------

/** A character saying this is the first they've heard of something. */
const NEVER_TOLD = /\byou (?:never|didn['’]t|did not|never once) (?:mention(?:ed)?|told?|tell)\b|\bwhy didn['’]t you (?:tell|say|mention)\b|\bfirst (?:time )?I['’]ve (?:ever )?heard\b|\bnews to me\b|\bI (?:never|didn['’]t) know (?:about|you had|you were|you did)\b/i;

/**
 * "You had a frat nickname and you never mentioned this?" against the page. What it's about is a rare
 * word capitalised in the same paragraph. The messages that said it go in the flag, so you can see
 * whether the person speaking was there; a character can truly not have heard, so it's a flag to read,
 * not a verdict.
 */
export function alreadyToldRule(chatId: string, text: string, seq: number, st: WorldState | null): Found[] {
  if (!NEVER_TOLD.test(text)) return [];
  const cast = castNames(st);
  const out: Found[] = [];
  for (const para of cleanText(text).split(/\n+/)) {
    if (out.length >= 2 || !NEVER_TOLD.test(para)) continue;
    const claim = sentences(para).find((s) => NEVER_TOLD.test(s))?.trim() ?? para.trim();
    // Written as a name, or capitalised alone at the start of a line ("Brongel. *Brongel*.").
    const words = new Set(namedTerms(para).map((t) => t.term));
    for (const m of para.matchAll(/(?:^|[\s"“‘*_])(\p{Lu}[\p{L}\p{N}'’-]{3,})(?=[.,!?…*_"”’\s]|$)/gu)) words.add(m[1]!.toLowerCase().replace(/['’]s$/, ""));
    for (const term of words) {
      if (cast.has(norm(term))) continue;
      const news = oldNews(chatId, term, seq - 1);
      if (!news) continue;
      out.push({
        kind: "known",
        severity: "minor",
        claim,
        conflict: `"${term}" isn't new. ${mentionText(news)}${news.knownBy.length ? ` Known to ${news.knownBy.join(", ")}.` : ""}`,
        citations: news.mentions.slice(0, 4).map((m) => ({ ref: `S${m.seq}`, type: "message" as const, label: `#${m.seq}, ${m.speaker}`, messageId: m.messageId, seq: m.seq })),
        fix: `Whoever was there at ${seqList(news)} already knows this: write them remembering it, not finding out.`,
        by: "rules",
      });
      break;
    }
  }
  return out;
}
