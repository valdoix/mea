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

const OPENER_BEFORE = /[\s([{“‘]/;
const CLOSER_AFTER = /[\s.,;:!?)\]}…*_”’]/;
const WORDISH = /[\p{L}\p{N}]/u;
/** Words that start with an apostrophe rather than a single quote: 'em, 'tis, '90s. */
const ELISION = /^(?:em|tis|twas|cause|cos|til|bout|round|n|kay|scuse|nother)\b|^\d/i;

/**
 * Curly quotes, read from each straight mark's neighbours the way a typesetter would (mirrors
 * server/src/steer/style.ts). A space or an opening bracket before it and a word after: it opens.
 * Punctuation or a space after it: it closes. So "I was—" closes and —"wait" opens. Between two
 * letters a ' is an apostrophe. The result is always the same length as the text.
 */
export function smartQuotes(text: string) {
  const at = (i: number) => (i >= 0 && i < text.length ? text[i]! : " ");
  let open = false;
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === "\n") open = false;
    if (ch !== '"' && ch !== "'") {
      out += ch;
      continue;
    }
    const prev = at(i - 1);
    const next = at(i + 1);
    if (ch === "'") {
      if (WORDISH.test(prev) && WORDISH.test(next)) out += "’";
      else if (/[\s([{“—–-]/.test(prev) && WORDISH.test(next) && !ELISION.test(text.slice(i + 1, i + 9))) out += "‘";
      else out += "’";
      continue;
    }
    let opening: boolean;
    const spaceBefore = OPENER_BEFORE.test(prev);
    const spaceAfter = /\s/.test(next);
    if (spaceBefore && !spaceAfter) opening = true;
    else if (spaceBefore && spaceAfter) opening = !open;
    else if (CLOSER_AFTER.test(next)) opening = false;
    else if (/[—–\-*_]/.test(prev)) opening = true;
    else opening = !open;
    open = opening;
    out += opening ? "“" : "”";
  }
  return out;
}

/** Straight quotes back: curly double marks become ", apostrophes stay as written. */
export function straightQuotes(text: string) {
  return text.replace(/[“”„]/g, '"');
}
