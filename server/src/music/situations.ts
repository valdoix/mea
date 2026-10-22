/**
 * What's happening, in words both sides use (docs/18, 0.2): a song's lyric sheet says which of these
 * its words are about, and the story's moment says which of these is going on. Mirrored in
 * `web/src/lib/situations.ts`.
 */
export const SITUATIONS = [
  "leaving",
  "goodbye",
  "reunion",
  "homecoming",
  "the road",
  "first love",
  "desire",
  "devotion",
  "longing",
  "heartbreak",
  "betrayal",
  "jealousy",
  "temptation",
  "confession",
  "secrets",
  "guilt",
  "grief",
  "fear",
  "the fight",
  "aftermath",
  "defiance",
  "revenge",
  "sacrifice",
  "freedom",
  "hope",
  "wonder",
  "nostalgia",
  "celebration",
  "peace",
  "alone",
] as const;
export type Situation = (typeof SITUATIONS)[number];

const known = new Set<string>(SITUATIONS);
/** Only situations from the list, each once, in the order given; a model's "Leaving " still counts. */
export function situationsOf(xs: readonly unknown[] | undefined, max = 4): Situation[] {
  const out: Situation[] = [];
  for (const x of xs ?? []) {
    const s = String(x).trim().toLowerCase();
    if (known.has(s) && !out.includes(s as Situation)) out.push(s as Situation);
  }
  return out.slice(0, max);
}
