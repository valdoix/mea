/**
 * Speaker marks (after ALMANAC's [spk]): the story model says who speaks each line, so the page
 * never has to guess. It writes [spk=Name|tone]"Words."[/spk]; the marks come out of the reply
 * before it's saved and wait in the swipe's meta as `speakers`, so every other reader (memory,
 * search, export, the editor) sees plain prose. The page puts them back to colour the lines.
 */

export const TONES = ["whisper", "murmur", "shout", "sing", "sob", "cold", "tender", "sly", "breathless", "flat"] as const;
export type Tone = (typeof TONES)[number];

export interface SpokenLine {
  /** The line exactly as it stands in the saved text, quote marks included. */
  text: string;
  /** Who says it; null when the reply marked it [spk=?]. */
  name: string | null;
  tone?: Tone;
}

export function speakerRule(userName: string, cast: string[], userSealed: boolean, dropped = false): string {
  const names = cast.filter(Boolean).slice(0, 16);
  const nudge = dropped ? ` Your last reply left its lines unmarked, so the page couldn't tell who spoke: mark every line in this one.` : "";
  return `[SPEAKER MARKS] Wrap every line of speech in a mark naming who says it, short replies too: [spk=Name]"Words."[/spk] — the mark first, the quoted words inside, then exactly [/spk]. Narration and dialogue tags stay outside the mark: [spk=Name]"Words,"[/spk] she said. Name exactly as established${names.length ? ` (${names.join(", ")})` : ""}; anyone new by the name the prose gives them. When delivery matters, add a tone after a bar: [spk=Name|whisper] — whisper, murmur, shout, sing, sob, cold, tender, sly, breathless, flat. An unseen or uncertain speaker is [spk=?]. Thoughts, signs, letters and words only remembered get no mark.${userSealed ? ` ${userName} has no lines in your reply, so never mark one as theirs.` : ` ${userName}'s lines are marked [spk=${userName}].`} The marks are the only speaker labels: no "Name:" script lines.${nudge}`;
}

const OPEN = /\[spk=([^\]\n]{0,80})\]/gi;

function readMark(raw: string): { name: string | null; tone?: Tone } {
  const [who = "", how = ""] = raw.split("|");
  const name = who.replace(/#\d{1,2}\s*$/, "").trim();
  const tone = how.trim().toLowerCase() as Tone;
  return { name: !name || name === "?" ? null : name, ...(TONES.includes(tone) ? { tone } : {}) };
}

/**
 * Takes the marks out of a reply. A mark's line runs to its [/spk], or (when the model forgot to
 * close it) to the end of the quote it opens on. Stray closers and marks with no line are dropped.
 */
export function extractSpeakers(input: string): { text: string; lines: SpokenLine[] } {
  if (!/\[\/?spk\b/i.test(input)) return { text: input, lines: [] };
  const lines: SpokenLine[] = [];
  let out = "";
  let at = 0;
  for (const m of input.matchAll(OPEN)) {
    if (m.index! < at) continue;
    out += input.slice(at, m.index);
    const start = m.index! + m[0].length;
    const rest = input.slice(start);
    const close = /\[\/spk\]/i.exec(rest);
    const next = rest.search(/\[spk=|\n[ \t]*\n/i);
    let inner: string;
    if (close && (next < 0 || close.index < next)) {
      inner = rest.slice(0, close.index);
      at = start + close.index + close[0].length;
    } else {
      const q = /^\s*["“][^"“”\n]*["”]/.exec(rest);
      inner = q ? q[0] : "";
      at = start + inner.length;
    }
    out += inner;
    // A mark that also wraps the narration after its quote keeps only the quote as the line.
    const text = (/^\s*["“][^"“”\n]*["”]/.exec(inner)?.[0] ?? inner).trim();
    if (text) lines.push({ text, ...readMark(m[1]!) });
  }
  out += input.slice(at);
  return { text: out.replace(/\[\/spk\]/gi, "").replace(/\[spk=[^\]\n]{0,80}\]/gi, ""), lines };
}

/** The text with marks taken out (memory and old prompt messages: a save cut short can leave them). */
export function withoutSpeakerMarks(text: string): string {
  return /\[\/?spk\b/i.test(text) ? text.replace(/\[spk=[^\]\n]{0,80}\]|\[\/spk\]/gi, "") : text;
}
