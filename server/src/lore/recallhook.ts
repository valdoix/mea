import { cosine } from "../memory/embed";
import { contentWords } from "../memory/text";
import type { ScanEntry } from "./activate";
import { factsNowFor } from "./facts";
import { loreVectors } from "./semantic";

/**
 * "Remember when…" (docs/15, 6.2). When your message reaches back ("remember the night at the
 * mill?"), the lore and the facts of that past scene come with the reply even if no keyword
 * matched: rules spot the cue, then the cue's words are matched against event facts and entries,
 * and (with embeddings) against the entries' vectors.
 */

const CUE =
  /\b(?:do you |you )?(?:remember|recall)(?: when| the| that| how| what)?\b|\bback when\b|\bthat (?:night|day|time|morning|evening|winter|summer) (?:at|in|on|when|we)\b|\b(?:the|that) time (?:we|you|I|when)\b|\blast time (?:we|you|I)\b|\blike (?:the|that) time\b/i;

/** The words that follow the cue: what's being remembered ("the night at the mill"). */
export function reachBack(text: string): string | null {
  const m = text.match(CUE);
  if (!m) return null;
  const after = text.slice(m.index! + m[0].length).split(/[?!.\n]/)[0]!.trim();
  // "remember?" alone reaches back to nothing in particular.
  return after.length >= 3 ? after.slice(0, 200) : null;
}

/**
 * The entries a "remember when…" in your message reaches back for, with what matched. Event facts
 * count most; an entry's own words count too; similar meaning (when the entries have vectors).
 */
export function recallLore(chatId: string, text: string, entries: ScanEntry[], qvec?: Float32Array | null): Map<string, string> {
  const out = new Map<string, string>();
  const cue = reachBack(text);
  if (!cue || !entries.length) return out;
  const want = contentWords(cue);
  if (!want.size) return out;
  const need = Math.min(2, want.size);
  const hits = (s: string) => [...contentWords(s)].filter((w) => want.has(w));
  const facts = factsNowFor(entries.map((e) => e.id), chatId);
  const scored: { id: string; score: number; why: string }[] = [];
  for (const e of entries) {
    if (!e.enabled) continue;
    let best = { score: 0, why: "" };
    for (const f of facts.get(e.id) ?? []) {
      const h = hits(f.value);
      const s = h.length + (f.kind === "event" ? 1 : 0);
      if (h.length >= need && s > best.score) best = { score: s, why: `“${f.value.slice(0, 80)}”` };
    }
    const own = hits(`${e.comment} ${e.content}`);
    if (own.length >= need && own.length > best.score) best = { score: own.length, why: own.slice(0, 3).join(", ") };
    if (best.score) scored.push({ id: e.id, ...best });
  }
  // Similar meaning, for what the words miss (the entries' own vectors, LORE-05).
  if (qvec) {
    const vecs = loreVectors();
    for (const e of entries) {
      const v = vecs.get(e.id);
      if (!v || scored.some((s) => s.id === e.id)) continue;
      const sim = cosine(qvec, v);
      if (sim >= 0.55) scored.push({ id: e.id, score: 1 + sim, why: `similar meaning (${sim.toFixed(2)})` });
    }
  }
  for (const s of scored.sort((a, b) => b.score - a.score).slice(0, 3)) out.set(s.id, s.why);
  return out;
}
