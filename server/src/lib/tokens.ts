import { countTokens as countO200k } from "gpt-tokenizer";

/**
 * Token estimates. GLM and Claude use their own tokenizers, so this is an
 * o200k-based estimate; real counts come back in provider usage and are
 * stored per generation (CTX-03 calibrates against them in Phase 1).
 */
const cache = new Map<string, number>();
const MAX_CACHE = 20_000;

export function countTokens(text: string): number {
  if (!text) return 0;
  const hit = cache.get(text);
  if (hit !== undefined) {
    // refresh LRU position
    cache.delete(text);
    cache.set(text, hit);
    return hit;
  }
  const n = countO200k(text);
  cache.set(text, n);
  if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value!);
  return n;
}

/** Per-message overhead for chat formatting (role markers etc.). */
export const MESSAGE_OVERHEAD = 4;
