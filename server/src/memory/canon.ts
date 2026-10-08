/**
 * Canon hierarchy (CON-01). When sources disagree, the order of authority is:
 * your edits > authored canon (card, lorebook) > tracker state > memory atoms > summaries > improvisation.
 * Every memory block in the prompt carries its level, and one stable rule explains the order.
 */

export const AUTHORITY = {
  user: "CANON 1 · the player's own edits —",
  authored: "CANON 2 · authored lore —",
  tracker: "CANON 3 · story state —",
  memory: "CANON 4 · memories —",
  summary: "CANON 5 · story so far —",
} as const;

export const CANON_RULE =
  "[Canon order. When sources disagree, trust them in this order: (1) the player's own edits and confirmed memories, (2) the character card and the lorebook, (3) the story state, (4) memory notes, (5) the story-so-far summaries, (6) your own improvisation. Never contradict a higher source to follow a lower one; if something seems off, follow the higher source quietly.]";

/** Ranks a source for conflict resolution in checkers and the codex (lower wins). */
export function authorityRank(source: "user" | "card" | "lore" | "tracker" | "memory" | "summary" | "model") {
  return { user: 1, card: 2, lore: 2, tracker: 3, memory: 4, summary: 5, model: 6 }[source];
}
