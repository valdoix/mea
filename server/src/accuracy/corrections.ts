import { lane, registerLane } from "../prompt/lanes";
import { getCard } from "../services/characters";
import { type Reveal, revealsOf } from "../trackers/reveals";
import { contentWords } from "../memory/text";

/**
 * Reliable state 2.3 (docs/16): the card is written once, and a sentence like "She does not yet
 * know about Jeff and Shauna" stays in it after the story lets that out. The card is never
 * rewritten (it sits in the cached prefix, and other chats share it); instead this lane, in the
 * dynamic block, quotes the sentence and says what's true now. Worked out from the trackers as of
 * the message being written, so a swipe back before the reveal takes it away again.
 */

/** A sentence that says someone doesn't know something, or that something is hidden. */
export const HIDDEN = /\b(?:doesn['’]t (?:yet )?know|does not (?:yet )?know|don['’]t know|has no idea|no one knows|nobody knows|(?:has )?told no ?one|hasn['’]t told|known only to|keeps? (?:it )?(?:a )?secret|secret(?:ly)?|unaware)\b/i;
const MAX = 6;

const sentences = (text: string) => text.split(/(?<=[.!?…])\s+|\n+/).map((s) => s.trim()).filter((s) => s.length > 12);

/** The card sentences that still call a revealed secret hidden: they share most of its words (or its names, said as hidden). */
export function staleCardLines(card: string, reveals: Reveal[]): { sentence: string; reveal: Reveal }[] {
  if (!reveals.length || !card.trim()) return [];
  const out: { sentence: string; reveal: Reveal }[] = [];
  for (const s of sentences(card)) {
    if (!HIDDEN.test(s) || /no longer a secret|came out|found out/i.test(s)) continue;
    const T = contentWords(s);
    let best: { r: Reveal; score: number } | null = null;
    for (const r of reveals) {
      const S = contentWords(r.statement);
      const hits = [...S].filter((w) => T.has(w)).length;
      const score = hits / S.size;
      if (hits >= 2 && score >= 0.5 && score > (best?.score ?? 0)) best = { r, score };
    }
    if (best) out.push({ sentence: s, reveal: best.r });
  }
  return out;
}

const clip = (s: string, n = 220) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

registerLane("corrections", (ctx) => {
  if (ctx.kind !== "story" && ctx.kind !== "continue") return null;
  const reveals = revealsOf(ctx.state);
  if (!reveals.length) return null;
  const card = getCard(ctx.characterId);
  if (!card) return null;
  const text = [card.description, card.personality, card.scenario, card.system_prompt, card.post_history_instructions].filter(Boolean).join("\n");
  const stale = staleCardLines(text, reveals)
    .sort((a, b) => b.reveal.seq - a.reveal.seq)
    .slice(0, MAX);
  if (!stale.length) return null;
  const lines = stale.map(({ sentence, reveal: r }) => `- The card says: "${clip(sentence)}" — written before #${r.seq}. Now ${r.out ? `it's out, and ${r.to.join(", ")} know${r.to.length === 1 ? "s" : ""}` : `${r.to.join(", ")} know${r.to.length === 1 ? "s" : ""}`}: ${r.statement}.`);
  return lane("corrections", null, `Out of date since the card was written (what's true now wins):\n${lines.join("\n")}`);
});
