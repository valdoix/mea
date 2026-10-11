import { cleanText } from "../memory/text";
import { getMessageRow, getSwipes } from "../services/chats";

/**
 * Swipe with an angle (Almanac plan A2). A swipe tells the model what the earlier takes did (each
 * one's opening and main beat), so the fifth take doesn't drift back to the first, and can carry a
 * one-shot angle ("quieter", "more tension"…).
 */

export const ANGLES = {
  another: { label: "Another direction", text: "Take this moment in another direction: a different choice, a different turn of events." },
  quieter: { label: "Quieter", text: "Quieter: a softer, more intimate take with less happening; let the moment breathe." },
  tension: { label: "More tension", text: "More tension: raise the stakes or the friction in this moment, without leaping ahead." },
  dialogue: { label: "More dialogue", text: "More dialogue: let people talk to each other; keep narration light." },
  shorter: { label: "Shorter", text: "Shorter: about half the length; only what matters." },
  side: { label: "From their side", text: "Tell this take from {{char}}'s side: what {{char}} notices, wants and keeps to themselves." },
  surprise: { label: "Surprise me", text: "Surprise the player: something unexpected that is still true to these people and this world." },
} as const;
export type Angle = keyof typeof ANGLES;
export const isAngle = (a: unknown): a is Angle => typeof a === "string" && a in ANGLES;

export function angleNote(angle: Angle, charName: string) {
  return ANGLES[angle].text.replaceAll("{{char}}", charName);
}

const sentences = (t: string) => t.split(/(?<=[.!?…]["”')\]*]*)\s+|\n+/).map((s) => s.trim()).filter(Boolean);
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** A take's opening (its first words) and main beat: the line that carries the most (speech and action win). */
export function takeShape(text: string): { opening: string; beat: string } {
  const sents = sentences(cleanText(text));
  const opening = clip(sents[0] ?? "", 110);
  let best = "";
  let score = -1;
  for (const s of sents.slice(1)) {
    const words = s.split(/\s+/).length;
    const sc = words + (/["“]/.test(s) ? 8 : 0) + (/\b(?:suddenly|then|finally|grabs?|kiss(?:es)?|turns?|reveals?|takes?|says?|asks?|steps?|draws?|opens?|leaves?)\b/i.test(s) ? 5 : 0);
    if (words >= 5 && sc > score) {
      score = sc;
      best = s;
    }
  }
  return { opening, beat: clip(best, 150) };
}

/**
 * Every earlier take of a reply being swiped, oldest first (A2's `rejectedDigest`): what each
 * opened with and its main beat. Empty when there's nothing to compare with.
 */
export function rejectedDigest(messageId: string): { opening: string; beat: string }[] {
  const m = getMessageRow(messageId);
  if (!m) return [];
  return getSwipes(messageId)
    .filter((s) => s.status !== "streaming" && s.content.trim())
    .slice(-6)
    .map((s) => takeShape(s.content))
    .filter((t) => t.opening);
}

/** The note a swipe carries: what the earlier takes did, and "do something else". */
export function digestNote(takes: { opening: string; beat: string }[]): string {
  if (!takes.length) return "";
  const lines = takes.map((t, i) => `${takes.length > 1 ? `${i + 1}. ` : ""}Opened «${t.opening}»${t.beat ? `; main beat: «${t.beat}»` : ""}`);
  return `[A new take of this reply. The player passed over ${takes.length === 1 ? "an earlier take" : `${takes.length} earlier takes`}:\n${lines.join("\n")}\nDo something else: a different opening and a different main beat${takes.length > 1 ? ", and don't drift back to any of them" : ""}.]`;
}

/**
 * "Keep this, redo the rest": the take up to and including the sentence the selection ends in.
 * Null when the selection isn't in the text.
 */
export function keptPrefix(content: string, selected: string): string | null {
  const sel = selected.replace(/\s+/g, " ").trim();
  if (!sel) return null;
  // Match across any whitespace (the selection's line breaks are folded to spaces).
  const pattern = sel.split(" ").map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+");
  const m = new RegExp(pattern).exec(content);
  if (!m) return null;
  const end = m.index + m[0].length;
  // The end of the sentence the selection ends in (or its paragraph); a selection that ends a sentence is kept as it is.
  if (/[.!?…]["”')\]*]*$/.test(m[0])) return content.slice(0, end).trimEnd();
  const rest = content.slice(end);
  const stop = rest.search(/(?<=[.!?…]["”')\]*]*)(?:\s|$)|\n/);
  const cut = stop < 0 ? content.length : end + stop;
  const prefix = content.slice(0, cut).trimEnd();
  return prefix.length >= 2 ? prefix : null;
}
