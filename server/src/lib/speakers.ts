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

/** One person the marks may name, with the voice number the reply writes after the name (ALMANAC's #N). */
export interface RosterVoice {
  name: string;
  slot: number;
  aliases: string[];
  isUser?: boolean;
  /** In the scene now (the story state's spotlight or edge). */
  here?: boolean;
}

interface CastMember {
  name: string;
  aliases?: string[];
  isUser?: boolean;
  isMain?: boolean;
  firstSeq?: number;
  lastSeq?: number;
  tier?: string;
}

/**
 * The cast as numbered voices: {{user}} is 0, the main character 1, then everyone else in the order
 * they arrived, so a person keeps their number for the whole story.
 */
export function voiceRoster(main: string, userName: string, chars: CastMember[]): RosterVoice[] {
  const key = (n: string) => n.trim().toLowerCase();
  const user = chars.find((c) => c.isUser);
  const lead = chars.find((c) => c.isMain && !c.isUser);
  const out: RosterVoice[] = [{ name: userName, slot: 0, aliases: user ? [user.name, ...(user.aliases ?? [])].filter((a) => key(a) !== key(userName)) : [], isUser: true, here: true }];
  const seen = new Set([key(userName)]);
  const add = (c: CastMember | undefined, name: string) => {
    if (!name.trim() || seen.has(key(name))) return;
    seen.add(key(name));
    out.push({ name, slot: out.length, aliases: (c?.aliases ?? []).filter((a) => key(a) !== key(name)), here: !c || c.tier === "spot" || c.tier === "peri" || Boolean(c.isMain) });
  };
  add(lead, lead?.name ?? main);
  for (const c of chars.filter((c) => !c.isUser && !c.isMain).sort((a, b) => (a.firstSeq ?? 0) - (b.firstSeq ?? 0) || a.name.localeCompare(b.name))) add(c, c.name);
  return out;
}

/** The roster as the prompt lists it: who is here first, then the latest of the rest, up to 16 people. */
export function rosterLine(roster: RosterVoice[], userSealed: boolean): string {
  const others = roster.filter((v) => !v.isUser);
  const shown = [...others.filter((v) => v.here), ...others.filter((v) => !v.here).reverse()].slice(0, 16).sort((a, b) => a.slot - b.slot);
  return [...(userSealed ? [] : roster.filter((v) => v.isUser)), ...shown].map((v) => `${v.name}#${v.slot}`).join(", ");
}

/** The rule, for a preset without Mea's own Speaker marks block (the default preset words it the same way). */
export function speakerRule(userName: string, roster: string, userSealed: boolean, dropped = false): string {
  return `[SPEAKER MARKS — the page colours each line by its mark; write them exactly]
Wrap every line of speech in a mark naming who says it, short replies too: [spk=Name#N]"Words."[/spk] — the mark first, the quoted words inside, then exactly [/spk]. Narration and dialogue tags stay outside the mark: [spk=Name#N]"Words,"[/spk] she said.
Name and number from this roster, written exactly as listed${roster ? `: ${roster}` : ""}. Anyone new: the name the prose gives them and the next unused number, kept from then on.${userSealed ? ` ${userName} has no lines in your reply, so no mark is ever theirs.` : ` ${userName} is 0.`}
Check each mark against the prose around it: the speaker is the person whose tag or action sits beside the line, not the last name mentioned. An unseen or uncertain speaker is [spk=?].
When delivery matters, add a tone after a bar: [spk=Name#N|whisper] — whisper, murmur, shout, sing, sob, cold, tender, sly, breathless, flat. Thoughts, signs, letters and words only remembered get no mark. The mark is the only speaker label: never "Name:" in front of a line.${dropped ? `
Your last reply left its lines unmarked, so the page couldn't tell who spoke: mark every line in this one.` : ""}`;
}

const words = (s: string) =>
  s
    .toLowerCase()
    .replace(/['’]s\b/g, "")
    .split(/[\s"“”‘’'()]+/)
    .filter((w) => w.length > 1);
const flat = (s: string) => words(s).join(" ");

/**
 * Who a mark means, as the cast knows them: an exact name or alias, then a name sharing a word with
 * one person only ("Misty" for Misty Quigley, "Jacqueline ‘Jackie’ Taylor" for Jackie Taylor), with
 * the voice number settling a shared family name. Someone the cast doesn't know keeps the name the
 * reply gave.
 */
export function resolveSpeaker(name: string, slot: number | undefined, roster: RosterVoice[]): string {
  if (!roster.length) return name;
  const n = flat(name);
  const exact = roster.find((v) => [v.name, ...v.aliases].some((x) => flat(x) === n));
  if (exact) return exact.name;
  const mine = new Set(words(name));
  const share = roster.filter((v) => [v.name, ...v.aliases].some((x) => words(x).some((w) => w.length > 2 && mine.has(w))));
  const bySlot = slot === undefined ? undefined : roster.find((v) => v.slot === slot);
  if (share.length === 1) return share[0]!.name;
  if (share.length > 1) {
    // Several share a word (a family name): the number decides, then a first name.
    if (bySlot && share.includes(bySlot)) return bySlot.name;
    const first = share.filter((v) => [v.name, ...v.aliases].some((x) => mine.has(words(x)[0] ?? "")));
    if (first.length === 1) return first[0]!.name;
    return name;
  }
  // A name the cast doesn't share is someone new, whatever number came with it.
  return !n && bySlot ? bySlot.name : name;
}

const OPEN = /\[spk=([^\]\n]{0,80})\]/gi;

function readMark(raw: string, roster: RosterVoice[]): { name: string | null; tone?: Tone } {
  const [who = "", how = ""] = raw.split("|");
  const num = /#\s*(\d{1,2})\s*$/.exec(who);
  const written = who.replace(/#\s*\d{1,2}\s*$/, "").trim();
  const tone = how.trim().toLowerCase() as Tone;
  const name = written === "?" || (!written && !num) ? null : resolveSpeaker(written, num ? Number(num[1]) : undefined, roster) || null;
  return { name, ...(TONES.includes(tone) ? { tone } : {}) };
}

/**
 * Takes the marks out of a reply. A mark's line runs to its [/spk], or (when the model forgot to
 * close it) to the end of the quote it opens on. Stray closers and marks with no line are dropped.
 * With the cast's roster, each name is the cast's own (lib resolveSpeaker), so a person keeps one colour.
 */
export function extractSpeakers(input: string, roster: RosterVoice[] = []): { text: string; lines: SpokenLine[] } {
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
    if (text) lines.push({ text, ...readMark(m[1]!, roster) });
  }
  out += input.slice(at);
  return { text: out.replace(/\[\/spk\]/gi, "").replace(/\[spk=[^\]\n]{0,80}\]/gi, ""), lines };
}

/** The text with marks taken out (memory and old prompt messages: a save cut short can leave them). */
export function withoutSpeakerMarks(text: string): string {
  return /\[\/?spk\b/i.test(text) ? text.replace(/\[spk=[^\]\n]{0,80}\]|\[\/spk\]/gi, "") : text;
}
