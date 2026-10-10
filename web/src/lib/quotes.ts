const OPEN_CLOSE: Record<string, string> = { "“": "”", "«": "»", "„": "“" };

/**
 * Which characters of a paragraph are dialogue: 0 for narration, else the number of the quote it
 * belongs to (so two lines side by side stay two lines). Forgiving of the marks models get wrong.
 */
export function quoteIds(text: string): Uint16Array {
  const ids = new Uint16Array(text.length);
  let n = 0;
  let inQuote = false;
  let closer = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    const prev = text[i - 1] ?? "";
    const next = text[i + 1] ?? "";
    if (!inQuote && (ch === '"' || ch in OPEN_CLOSE)) {
      // A straight quote hugging the word before it, then a space, is a stray closer, not an opener.
      if (ch === '"' && /[\p{L}\p{N}.,!?…—–-]/u.test(prev) && (!next || /\s/.test(next))) continue;
      inQuote = true;
      closer = ch === '"' ? '"' : OPEN_CLOSE[ch]!;
      ids[i] = ++n;
    } else if (inQuote && (ch === closer || (closer === '"' && ch === "”") || (closer === "”" && ch === '"'))) {
      ids[i] = n;
      inQuote = false;
    } else if (inQuote && ch === "“" && closer === "”") {
      // Another opener before the closer. Models often type “ where they mean ”: followed by a
      // space, punctuation or the end, it closes the line ("why didn't you — “ She grabs…").
      // Followed by a word, the earlier line simply ran unclosed and a new one starts here.
      if (!next || /[\s.,;:!?)\]…—–-]/.test(next)) {
        ids[i] = n;
        inQuote = false;
      } else ids[i] = ++n;
    } else if (inQuote) ids[i] = n;
  }
  return ids;
}
