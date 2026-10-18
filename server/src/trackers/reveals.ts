import { contentWords } from "../memory/text";
import type { WorldState } from "./types";

/**
 * Secrets the story has let out. Cards and lore write a secret down once ("known only to Jeff and
 * Shauna") and never hear that it came out; these let the prompt and the checks read the reveal.
 */
export interface Reveal {
  key: string;
  statement: string;
  keepers: string[];
  /** Who found out, in the order they did. */
  to: string[];
  /** Kept from nobody any more. */
  out: boolean;
  how?: string;
}

export function revealsOf(st: WorldState | null | undefined): Reveal[] {
  if (!st) return [];
  const nm = (id: string) => st.chars[id]?.name ?? id;
  return Object.values(st.facts)
    .filter((f) => f.revealed.length)
    .map((f) => ({
      key: f.key,
      statement: f.statement,
      keepers: (f.secret?.keepers ?? []).map(nm),
      to: [...new Set(f.revealed.flatMap((r) => r.to))].map(nm),
      out: !f.secret?.from.length,
      how: f.revealed.at(-1)?.how,
    }));
}

/** The reveal a secret written elsewhere (a lore entry, a card) is about: most of its words are in the text. */
export function revealFor(text: string, reveals: Reveal[] | undefined): Reveal | undefined {
  if (!reveals?.length) return undefined;
  const T = contentWords(text);
  let best: Reveal | undefined;
  let score = 0.6;
  for (const r of reveals) {
    const S = contentWords(r.statement);
    const hits = [...S].filter((w) => T.has(w)).length;
    const s = hits >= 2 ? hits / Math.min(S.size, T.size) : 0;
    if (s >= score) [best, score] = [r, s];
  }
  return best;
}
