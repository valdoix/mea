import { lane, type LaneExtra } from "../prompt/lanes";
import type { CardData } from "../cards/card";
import type { WorldState } from "../trackers/types";
import { type Finding, findOpening, findOutdated } from "./promptcheck";

/**
 * Reliable state 2.3 and 3.2 (docs/16): the card and the lore are written once, and a sentence
 * like "She does not yet know about Jeff and Shauna" stays in them after the story lets that out.
 * Neither is rewritten (the card sits in the cached prefix, and other chats share both); instead
 * the [CORRECTIONS] lane, in the dynamic block, quotes the sentence and says what's true now.
 * Worked out from the trackers as of the message being written, so a swipe back before the change
 * takes it away again.
 */
const MAX = 6;
const clip = (s: string, n = 220) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** The card fields that describe the world as it was when the card was written. */
export const cardPieces = (card: CardData) =>
  [card.description, card.personality, card.scenario, card.system_prompt, card.post_history_instructions].map((text, i) => ({ where: "card", text, ...(i === 2 ? { scenario: true } : {}) })).filter((p) => p.text);

/** The persona is written once too ("has never met her", "doesn't know about the letter"), and shared by every chat it plays in. */
export const personaPieces = (text: string) => (text.trim() ? [{ where: "persona", text }] : []);

/** One correction as the prompt says it. */
export const correctionLine = (f: Finding) => {
  if (f.kind === "time") return `- The ${f.where} says: "${clip(f.sentence)}" — ${f.now}.`;
  if (f.kind === "done") return `- The ${f.where} says: "${clip(f.sentence)}" — that's over. ${f.now} (#${f.seq}).`;
  return `- The ${f.where} says: "${clip(f.sentence)}" — written before #${f.seq}. ${f.now.charAt(0).toUpperCase()}${f.now.slice(1)}.`;
};

/** Said once under the opening's lines: the moment is past, and so is what it says people look like. */
const OPENING_AFTER = "What the card says of that moment (where people are, what they wear, what is on their hands) is the past: the story since has changed it, and anyone who speaks of it says when it really was.";

const ROLE =
  "mother|mom|mum|father|dad|sister|brother|nanny|nurse|aunt|uncle|cousin|son|daughter|wife|husband|girlfriend|boyfriend|grandmother|grandma|grandfather|grandpa|stepmother|stepfather|stepmom|stepdad|fiancée|fiance|fiancé|tutor|governess|watcher|maid|butler|housekeeper|best friend|ex";
/** "Gabriel's nanny Maria" and "Maria, Gabriel's mother": who a name is to whom, by name. */
export function rolesIn(text: string): Map<string, string> {
  const out = new Map<string, string>();
  const name = "([A-Z][a-z]+(?: [A-Z][a-z]+)?)";
  const owner = "([A-Z][a-z]+)['’]s";
  for (const m of text.matchAll(new RegExp(`${owner} (?:late |dead |old )?(${ROLE}),? ${name}`, "g"))) out.set(`${m[3]}|${m[1]}`, m[2]!.toLowerCase());
  for (const m of text.matchAll(new RegExp(`${name}(?:,| \\()\\s*${owner} (?:late |dead |old )?(${ROLE})\\b`, "g"))) out.set(`${m[1]}|${m[2]}`, m[3]!.toLowerCase());
  return out;
}

/**
 * A "correction" that says someone is a different relation than the lore does is the tracker's
 * misreading, not news: the lore said "Gabriel's nanny Maria", the tracker heard "Maria, Gabriel's
 * mother", and every prompt then told the writer his mother was dead. On who someone is, the lore
 * wins: the line is dropped (it stays in the findings, for the Inspector).
 */
export function clashesOnWho(f: Finding): boolean {
  const before = rolesIn(f.sentence);
  if (!before.size) return false;
  for (const [who, role] of rolesIn(f.now)) {
    const was = before.get(who);
    if (was && was !== role) return true;
  }
  return false;
}

/** The lane, newest change first, at most six lines; and every finding, for the Inspector. */
export function correctionsLane(st: WorldState | null, pieces: { where: string; text: string; scenario?: boolean }[]): { extra: LaneExtra | null; findings: Finding[] } {
  const every = findOutdated(st, pieces);
  const outdated = every.filter((f) => !clashesOnWho(f));
  const opening = findOpening(st, pieces);
  const findings = [...every, ...opening];
  const lines = [...outdated].sort((a, b) => b.seq - a.seq).slice(0, MAX).map(correctionLine);
  if (opening.length) lines.push(...opening.map(correctionLine), OPENING_AFTER);
  return { extra: lines.length ? lane("corrections", null, `Out of date since it was written (what's true now wins):\n${lines.join("\n")}`) : null, findings };
}

/** For memory (the Story So Far, recalled memories): the lines to add after the block they correct. */
export function correctMemory(st: WorldState | null, text: string, where: string): { text: string; findings: Finding[] } {
  const findings = findOutdated(st, [{ where, text }]).filter((f) => !clashesOnWho(f));
  if (!findings.length) return { text, findings };
  const lines = findings.slice(0, MAX).map(correctionLine);
  return { text: `${text}\n\n### Out of date in the records above (what's true now wins)\n${lines.join("\n")}`, findings };
}
