import { lane, type LaneExtra } from "../prompt/lanes";
import type { CardData } from "../cards/card";
import type { WorldState } from "../trackers/types";
import { type Finding, findOutdated } from "./promptcheck";

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
export const cardPieces = (card: CardData) => [card.description, card.personality, card.scenario, card.system_prompt, card.post_history_instructions].filter(Boolean).map((text) => ({ where: "card", text }));

/** The persona is written once too ("has never met her", "doesn't know about the letter"), and shared by every chat it plays in. */
export const personaPieces = (text: string) => (text.trim() ? [{ where: "persona", text }] : []);

/** One correction as the prompt says it. */
export const correctionLine = (f: Finding) => `- The ${f.where} says: "${clip(f.sentence)}" — written before #${f.seq}. ${f.now.charAt(0).toUpperCase()}${f.now.slice(1)}.`;

/** The lane, newest change first, at most six lines; and every finding, for the Inspector. */
export function correctionsLane(st: WorldState | null, pieces: { where: string; text: string }[]): { extra: LaneExtra | null; findings: Finding[] } {
  const findings = findOutdated(st, pieces);
  const lines = [...findings].sort((a, b) => b.seq - a.seq).slice(0, MAX).map(correctionLine);
  return { extra: lines.length ? lane("corrections", null, `Out of date since it was written (what's true now wins):\n${lines.join("\n")}`) : null, findings };
}

/** For memory (the Story So Far, recalled memories): the lines to add after the block they correct. */
export function correctMemory(st: WorldState | null, text: string, where: string): { text: string; findings: Finding[] } {
  const findings = findOutdated(st, [{ where, text }]);
  if (!findings.length) return { text, findings };
  const lines = findings.slice(0, MAX).map(correctionLine);
  return { text: `${text}\n\n### Out of date in the records above (what's true now wins)\n${lines.join("\n")}`, findings };
}
