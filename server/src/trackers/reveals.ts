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
  /** The message it came out at (the latest reveal). */
  seq: number;
}

export function revealsOf(st: WorldState | null | undefined): Reveal[] {
  if (!st) return [];
  return Object.values(st.facts)
    .filter((f) => f.revealed.length)
    .map((f) => revealOf(st, f.key)!);
}

/** The reveal of one fact, if it has come out to anyone. */
export function revealOf(st: WorldState, key: string): Reveal | undefined {
  const f = st.facts[key];
  if (!f?.revealed.length) return undefined;
  const nm = (id: string) => st.chars[id]?.name ?? id;
  return {
    key: f.key,
    statement: f.statement,
    keepers: (f.secret?.keepers ?? []).map(nm),
    to: [...new Set(f.revealed.flatMap((r) => r.to))].map(nm),
    out: !f.secret?.from.length,
    how: f.revealed.at(-1)?.how,
    seq: f.revealed.at(-1)!.seq,
  };
}

/** How much of a statement a text says (possessives stripped), from 0 to 1; under two words in common is 0. */
export function said(statement: string, text: string) {
  const S = contentWords(statement);
  const T = contentWords(text);
  const hits = [...S].filter((w) => T.has(w)).length;
  return hits >= 2 ? hits / Math.min(S.size, T.size) : 0;
}

/** The item a secret written elsewhere (a lore entry, a card) is about: most of its words are in the text. */
export function bestMatch<T extends { statement: string }>(text: string, items: T[], min = 0.6): { item: T; score: number } | undefined {
  let best: { item: T; score: number } | undefined;
  for (const item of items) {
    const score = said(item.statement, text);
    if (score >= min && score > (best?.score ?? 0)) best = { item, score };
  }
  return best;
}

/** The reveal a secret written elsewhere is about, if any. */
export function revealFor(text: string, reveals: Reveal[] | undefined): Reveal | undefined {
  return reveals?.length ? bestMatch(text, reveals)?.item : undefined;
}
