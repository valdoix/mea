import { TOOLKIT_TAGS } from "../prompt/mea";

/**
 * A no-model tidy pass on every reply (docs/33 10.5), after the quote style and before the
 * speaker marks come out. What it fixes, from Buffy × Gabriel: a toolkit closer written with its
 * attributes ("</mind of mood="love">", #547), which the page can't read and shows as text; a
 * sentence said twice back to back (#111); and a stray word from another script in an English
 * reply ("祈祷", #876). Curly quotes are the style's (steer/style.ts), and stray speaker-mark
 * closers ("[//spk]", "[c/spk]") are mended where the marks are read (lib/speakers.ts mendMarks).
 */

const KINDS = TOOLKIT_TAGS.join("|");
const BAD_CLOSER = new RegExp(`<\\/(${KINDS})\\b[^>]+>`, "gi");
const TOOLKIT_BODY = new RegExp(
  `<(${KINDS})\\b[^>]*>[\\s\\S]*?<\\/\\1\\s*>`,
  "gi",
);
/** Scripts that turn up as a stray word in English prose (kaomoji and emoji are Common, and stay). */
const FOREIGN =
  /[\p{Script=Han}\p{Script=Hangul}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Cyrillic}\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Thai}\p{Script=Devanagari}]+/gu;
const LATIN = /\p{Script=Latin}/gu;

export interface Tidied {
  text: string;
  /** What changed, for the take's meta. */
  fixes: string[];
}

export function tidyReply(text: string): Tidied {
  const fixes: string[] = [];
  let t = text;

  const closers = t.replace(BAD_CLOSER, (_m, k: string) => `</${k}>`);
  if (closers !== t) fixes.push("closer");
  t = closers;

  // The same sentence twice in a row (20 characters or more, from a sentence start).
  const twice = t.replace(
    /(?<=^|[.!?…]["”’)]*\s+)([^.!?…\n]{20,}[.!?…]+["”’]?)(\s+)\1(?=\s|$)/gu,
    "$1",
  );
  if (twice !== t) fixes.push("repeat");
  t = twice;

  // A stray word from another script, in a reply that is otherwise all Latin letters: never inside
  // a toolkit tag (a <mind> may use any script) or in brackets (a kaomoji).
  const latin = t.match(LATIN)?.length ?? 0;
  const foreign = (t.match(FOREIGN) ?? []).join("").length;
  if (
    foreign &&
    foreign <= 12 &&
    latin >= 200 &&
    foreign / (latin + foreign) <= 0.03
  ) {
    const keep = new Uint8Array(t.length);
    for (const m of t.matchAll(TOOLKIT_BODY))
      keep.fill(1, m.index!, m.index! + m[0].length);
    for (const m of t.matchAll(/\([^()\n]{0,30}\)/g))
      keep.fill(1, m.index!, m.index! + m[0].length);
    const out = t.replace(FOREIGN, (m, at: number) =>
      keep[at] || m.length > 8 ? m : "\u0000",
    );
    if (out !== t) {
      fixes.push("script");
      t = out.replace(/[ \t]*\u0000+[ \t]*/g, (m) =>
        /^[ \t]/.test(m) && /[ \t]$/.test(m) ? " " : m.replace(/\u0000+/g, ""),
      );
    }
  }
  return { text: t, fixes };
}
