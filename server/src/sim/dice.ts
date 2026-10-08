/**
 * Seeded chance (ALMANAC 09 §6.7): the same chat and stretch of story time always rolls the same
 * dice, so a swipe, a regenerate or a rebuild sees the same world.
 */
export function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** mulberry32 */
export function rng(seed: string): () => number {
  let a = hash(seed) || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const d6 = (r: () => number) => 1 + Math.floor(r() * 6);
export const pick = <T>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;

/** Chance something with `rate` per hour happens in `hours` (a Poisson process). */
export const chanceIn = (rate: number, hours: number) => 1 - Math.exp(-Math.max(0, rate) * Math.max(0, hours));

export function weighted<T>(r: () => number, items: { item: T; w: number }[]): T | undefined {
  const total = items.reduce((n, x) => n + Math.max(0, x.w), 0);
  if (total <= 0) return undefined;
  let x = r() * total;
  for (const it of items) {
    x -= Math.max(0, it.w);
    if (x <= 0) return it.item;
  }
  return items.at(-1)?.item;
}
