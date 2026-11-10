import { all, parseJson } from "../db/db";
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

/** docs/33 9.3: why the take before this one was passed over, as it was asked for (startStory). */
export interface PassedOver {
  /** Your note with the new take, as you wrote it. */
  note?: string;
  /** The angle you picked ("Quieter"). */
  angle?: string;
  /** Mea asked for it itself ("guard": a check the take failed). */
  auto?: string;
}

export interface Take {
  opening: string;
  beat: string;
  /** docs/33 9.3: why it was passed over, when Mea knows. */
  why?: string[];
}

/** What the checks found wrong with each take of a reply and nobody dismissed, by take. */
function checksOf(messageId: string): Map<number, string[]> {
  const out = new Map<number, string[]>();
  for (const r of all<{ swipe_idx: number; issues: string }>("SELECT swipe_idx, issues FROM continuity_flags WHERE message_id = ? AND status = 'open'", messageId)) {
    const found = parseJson<{ claim?: string; conflict?: string; dismissed?: boolean }[]>(r.issues, [])
      .filter((i) => !i.dismissed && i.claim?.trim())
      .slice(0, 2)
      .map((i) => `the check found «${clip(i.claim!.trim(), 120)}»${i.conflict?.trim() ? ` against the record: ${clip(i.conflict.trim(), 140)}` : ""}`);
    if (found.length) out.set(r.swipe_idx, found);
  }
  return out;
}

/**
 * Every earlier take of a reply being swiped, oldest first (A2's `rejectedDigest`): what each
 * opened with and its main beat, and (docs/33 9.3) why it was passed over when Mea knows: the note
 * you asked for the next take with, or what a check found wrong with it. Empty when there's
 * nothing to compare with.
 */
export function rejectedDigest(messageId: string): Take[] {
  const m = getMessageRow(messageId);
  if (!m) return [];
  const swipes = getSwipes(messageId);
  const checks = checksOf(messageId);
  return swipes
    .filter((s) => s.status !== "streaming" && s.content.trim())
    .slice(-6)
    .map((s) => {
      const t: Take = takeShape(s.content);
      // The take that came next says why this one was passed over; one still being written is this
      // very request, whose note the prompt carries already.
      const next = swipes.find((x) => x.idx > s.idx && x.status !== "streaming");
      const p = next ? parseJson<{ passedOver?: PassedOver }>(next.meta, {}).passedOver : undefined;
      const why = [
        p?.note && p.auto !== "guard" ? `the player said «${clip(p.note, 200)}»` : "",
        p?.auto === "guard" && p.note ? `it failed a check: ${clip(p.note, 200)}` : "",
        p?.angle ? `the player asked for ${p.angle.toLowerCase()}` : "",
        ...(checks.get(s.idx) ?? []),
      ].filter(Boolean);
      return why.length ? { ...t, why } : t;
    })
    .filter((t) => t.opening);
}

/** The note a swipe carries: what the earlier takes did, why they were passed over when known, and "do something else". */
export function digestNote(takes: Take[]): string {
  if (!takes.length) return "";
  const lines = takes.map((t, i) => `${takes.length > 1 ? `${i + 1}. ` : ""}Opened «${t.opening}»${t.beat ? `; main beat: «${t.beat}»` : ""}${t.why?.length ? `\n   Passed over because ${t.why.join("; ")}.` : ""}`);
  const why = takes.some((t) => t.why?.length) ? " Whatever made a take wrong stays out of this one." : "";
  return `[A new take of this reply. The player passed over ${takes.length === 1 ? "an earlier take" : `${takes.length} earlier takes`}:\n${lines.join("\n")}\nDo something else: a different opening and a different main beat${takes.length > 1 ? ", and don't drift back to any of them" : ""}.${why}]`;
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
