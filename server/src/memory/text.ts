/**
 * Text cleaning for memory and old prompt messages (SUM-13, CTX-07): removes reasoning,
 * collapsible blocks, styling, comments, and markup while keeping the story's words.
 */
export function cleanText(text: string): string {
  if (!text) return "";
  let t = text
    .replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, "")
    .replace(/<details[\s\S]*?<\/details>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    // Status / tracker blocks some cards append, e.g. ```status … ``` or [STATUS] … [/STATUS]
    .replace(/```(?:status|stats|tracker|info|hud)[\s\S]*?```/gi, "")
    .replace(/\[(status|stats|tracker)\][\s\S]*?\[\/\1\]/gi, "")
    // Speaker marks a save cut short left in the text (lib/speakers.ts).
    .replace(/\[spk=[^\]\n]{0,80}\]|\[\/spk\]/gi, "");
  if (/<[a-z][\s\S]*?>/i.test(t)) {
    t = t
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
      .replace(/<[^>]+>/g, "");
  }
  return t
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** True when cleaning would change the text (so untouched messages keep their exact bytes for caching). */
export function needsCleaning(text: string): boolean {
  return /<[a-z!/][\s\S]*?>|```(?:status|stats|tracker|info|hud)|\[(?:status|stats|tracker)\]|\[\/?spk\b/i.test(text);
}

const STOP = new Set(
  "the a an and or but if then than that this these those with from into onto over under about after before while when where what which who whom whose why how is are was were be been being have has had do does did not no yes you your yours i me my mine we us our ours he him his she her hers they them their theirs it its as at by for in of on to up down out so too very can could would should will shall may might must just also only even still yet again ever never more most much many some any all each every both few other such own same here there now then said says say like get got".split(
    " ",
  ),
);

/** Search terms for FTS5: content words, quoted, OR-ed (MEM-11). */
export function ftsQuery(text: string, max = 24): string | null {
  const counts = new Map<string, number>();
  for (const w of text.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'-]{2,}/gu) ?? []) {
    const word = w.replace(/'s$/, "").replace(/['-]+$/, "");
    if (word.length < 3 || STOP.has(word)) continue;
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  const words = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .slice(0, max)
    .map(([w]) => `"${w.replaceAll('"', "")}"`);
  return words.length ? words.join(" OR ") : null;
}

/** Stable short hash for change detection (PERF-07). */
export function hashText(text: string): string {
  return new Bun.CryptoHasher("sha1").update(text).digest("hex");
}

/** Content words of a text (lowercased, no stop words), for overlap checks: MMR, reinforcement, excerpts. */
export function contentWords(text: string, min = 3): Set<string> {
  const out = new Set<string>();
  for (const w of text.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'-]*/gu) ?? []) {
    const word = w.replace(/'s$/, "").replace(/['-]+$/, "");
    if (word.length >= min && !STOP.has(word)) out.add(word);
  }
  return out;
}

/** Jaccard overlap of two word sets. */
export function overlap(a: Set<string>, b: Set<string>) {
  if (!a.size || !b.size) return 0;
  let n = 0;
  for (const w of a) if (b.has(w)) n++;
  return n / (a.size + b.size - n);
}
