import { countTokens } from "../lib/tokens";
import type { LedgerRow } from "./store";
import { cleanText } from "./text";

/**
 * The rule-based scene digest (borrowed from Lumiverse's heuristic salience, the review of
 * 2026-10-12). When the helper model can't write a scene's record, the scene would otherwise be a
 * hole once it leaves the window. Instead its most telling sentences are kept, word for word and
 * in order, chosen by cheap rules: feelings and how strongly they're felt, things said aloud,
 * promises and decisions, firsts and lasts, turns ("suddenly"), and names. No model, no cost.
 * The record stays marked as failed, so a rebuild with the helper replaces it.
 */

const FEELING =
  /\b(love[ds]?|hate[ds]?|afraid|fear(ed|s)?|terrified|scared|angry|anger|furious|rage|cr(y|ied|ies|ying)|tears?|sob(bed|s)?|laugh(ed|s)?|smil(e|ed|es)|grief|griev\w*|mourn\w*|ashamed|shame|guilt\w*|jealous\w*|betray\w*|trust(ed|s)?|hope[ds]?|despair\w*|lonely|alone|miss(ed)?|hurt|pain|panic\w*|relie(f|ved)|joy|happy|sad|sorrow|regret\w*|forgive\w*|kiss(ed|es)?|embrac\w*|trembl\w*|shak(ing|e|es)|heart)\b/gi;
const INTENSE = /\b(deeply|utterly|completely|desperately|fiercely|painfully|unbearably|terribly|violently|wildly|bitterly|hopelessly|so much|never felt)\b/i;
const SOFT = /\b(slightly|barely|hardly|somewhat|a little|faintly|mildly|vaguely|sort of|kind of)\b/i;
const COMMITMENT = /\b(promise[ds]?|swear|swore|vow(ed|s)?|decid(e|ed|es)|will never|won't ever|I will|we will|agree[ds]?|deal|oath|plan(ned)? to|going to)\b/i;
const MILESTONE = /\b(first time|for the first|finally|never again|at last|for the last time|the last|forever|anymore|no longer|again)\b/i;
const TURN = /\b(suddenly|but then|without warning|all at once|instead|realiz(e|ed|es)|discover(ed|s)?|reveal(ed|s)?|secret|truth|confess(ed|es)?|admit(ted|s)?)\b/i;
const EVENT = /\b(died|dies|dead|kill(ed|s)?|murder\w*|born|married|marry|left|leav(e|es|ing)|arriv(e|ed|es)|escap\w*|attack\w*|fight|fought|wound(ed)?|bleed\w*|blood|lost|found|stole|gave|took|broke|burn(ed|t)?)\b/i;
const STOP_CAPS = new Set(["I", "The", "A", "An", "He", "She", "They", "We", "You", "It", "His", "Her", "Their", "My", "Your", "But", "And", "Then", "When", "What", "Why", "How", "Oh", "No", "Yes", "This", "That", "There"]);

/** How telling a sentence is, from 0 up. */
export function salience(sentence: string): number {
  const s = sentence.trim();
  const words = s.split(/\s+/).filter(Boolean).length;
  if (words < 4) return 0;
  let score = 0;
  const feelings = s.match(FEELING)?.length ?? 0;
  if (feelings) score += Math.min(3, feelings) * (INTENSE.test(s) ? 1.5 : SOFT.test(s) ? 0.6 : 1);
  if (/["“”«»]/.test(s)) score += 0.8;
  if (COMMITMENT.test(s)) score += 2;
  if (MILESTONE.test(s)) score += 1.5;
  if (TURN.test(s)) score += 1.5;
  if (EVENT.test(s)) score += 1.5;
  if (/[!?]/.test(s)) score += 0.4;
  // Information: names (capitalized words not opening the sentence) and numbers.
  const names = (s.match(/(?<=\s)[A-Z][a-z]{2,}/g) ?? []).filter((w) => !STOP_CAPS.has(w)).length;
  score += Math.min(2, names * 0.5) + (/\d/.test(s) ? 0.3 : 0);
  // Very long sentences are often description; very short ones rarely carry a whole fact.
  if (words > 45) score *= 0.8;
  return score;
}

function sentences(text: string): string[] {
  return (
    text
      .replace(/\s+/g, " ")
      .match(/[^.!?…]+(?:[.!?…]+["”’)]?|$)/g)
      ?.map((x) => x.trim())
      .filter(Boolean) ?? []
  );
}

export interface Digest {
  title: string;
  content: string;
  tokens: number;
}

/** The scene's most telling sentences, in story order, within `maxTokens` (or null when there's nothing to keep). */
export function sceneDigest(rows: LedgerRow[], names: { char: string; user: string }, opts: { maxTokens?: number } = {}): Digest | null {
  const all: { seq: number; who: string; text: string; score: number; order: number }[] = [];
  let order = 0;
  for (const m of rows) {
    const who = m.role === "user" ? names.user : m.role === "assistant" ? (m.name ?? names.char) : "Note";
    for (const text of sentences(cleanText(m.content))) all.push({ seq: m.seq, who, text, score: salience(text), order: order++ });
  }
  if (!all.length) return null;
  const source = rows.reduce((n, m) => n + countTokens(m.content), 0);
  const cap = Math.max(60, Math.min(opts.maxTokens ?? 260, Math.round(source * 0.2)));
  const picked: typeof all = [];
  let used = 0;
  for (const s of [...all].filter((x) => x.score > 0).sort((a, b) => b.score - a.score || a.order - b.order)) {
    const t = countTokens(s.text) + 4;
    if (used + t > cap) continue;
    picked.push(s);
    used += t;
  }
  // Nothing scored: the scene's opening and closing lines at least say where it began and ended.
  if (!picked.length) picked.push(all[0]!, ...(all.length > 1 ? [all.at(-1)!] : []));
  picked.sort((a, b) => a.order - b.order);
  const content = picked.map((s) => `${s.who} (#${s.seq}): ${s.text}`).join("\n");
  const first = rows[0]!.seq;
  const last = rows.at(-1)!.seq;
  return { title: `Scene #${first}–#${last} (kept by rules)`, content, tokens: countTokens(content) };
}
