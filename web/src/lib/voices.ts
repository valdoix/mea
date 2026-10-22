import type { Action } from "svelte/action";
import type { TrackerCharacter, TrackersResponse } from "./types";

/**
 * Speaker colours: who said each quoted line. Replies name the speaker of each line themselves
 * (speaker marks, after ALMANAC's [spk]); the renderer turns those into <span class="dl"
 * data-spk="Name">, and they are taken as written. Older messages and yours, with no marks, are
 * read from the prose the way a reader would: the tag beside a line ("Wren said"), the action beat
 * before it, a pronoun's last-named person, or the back-and-forth of a two-person exchange. Each
 * line is tinted in that person's colour, with a texture for how it was said (whispered, shouted).
 * Blocks and Script (from ALMANAC) also turn a paragraph that opens on someone's line into their
 * voice card or screenplay line.
 */

export type VoiceStyle = "ink" | "blocks" | "chips" | "tint" | "script" | "ribbon" | "halo" | "off";

/** Styles that dress a whole paragraph after the person whose line opens it. */
const CARDS = new Set<VoiceStyle>(["blocks", "script"]);
const TONE_TEXTURE: Record<string, "whisper" | "loud"> = { whisper: "whisper", murmur: "whisper", breathless: "whisper", shout: "loud" };

export interface Voice {
  key: string;
  name: string;
  /** Every way the prose names them: "Wren Halloway", "Wren", aliases. */
  names: string[];
  color: string;
  isUser: boolean;
  isMain: boolean;
  /** "he" or "she", when the story state's own notes on them say so. */
  g?: "m" | "f" | null;
}

/** Hues tuned to read on both dark and light pages once mixed with the text colour. */
// Nothing near the user's rose, so your own lines always stand apart.
const PALETTE = ["#7fe3d0", "#ffbf6b", "#c7b4ff", "#9cc4ff", "#b6f08a", "#f3e48c", "#8ad8ff", "#ffa38a", "#e0a6ff", "#6fd39a", "#d9c8a0", "#a3b8ff"];
export const USER_COLOR = "#ff9ec0";

function hueIndex(name: string) {
  let h = 0;
  for (const ch of name.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % PALETTE.length;
}

/** One person's colour on its own: their pick, else their usual hue (castColors keeps a cast apart). */
export function voiceColor(name: string, own?: string | null): string {
  if (own && /^#[0-9a-f]{6}$/i.test(own)) return own;
  return PALETTE[hueIndex(name)]!;
}

/**
 * Colours for a whole cast, so no two people share one (L-voices): picks made in the Cast come
 * first, then each person takes their usual hue, or the next free one when someone already has it.
 * Pass people in a stable order (the main character, then by first appearance) and a newcomer
 * never moves anyone else's colour.
 */
export function castColors(people: { name: string; color?: string | null; isUser?: boolean }[]): Map<string, string> {
  const out = new Map<string, string>();
  const taken = new Set<string>();
  for (const p of people) {
    const own = p.color && /^#[0-9a-f]{6}$/i.test(p.color) ? p.color.toLowerCase() : p.isUser ? USER_COLOR : null;
    if (own) {
      out.set(p.name.toLowerCase(), own);
      taken.add(own);
    }
  }
  for (const p of people) {
    const k = p.name.toLowerCase();
    if (!p.name || out.has(k)) continue;
    const start = hueIndex(p.name);
    let pick = PALETTE[start]!;
    for (let i = 0; i < PALETTE.length; i++) {
      const c = PALETTE[(start + i) % PALETTE.length]!;
      if (!taken.has(c)) {
        pick = c;
        break;
      }
    }
    out.set(k, pick);
    taken.add(pick);
  }
  return out;
}

/** The story state's cast in a stable order: the main character, then by first appearance. */
function castOf(data: TrackersResponse) {
  return Object.values(data.state.chars)
    .slice()
    .sort((a, b) => Number(b.isMain) - Number(a.isMain) || (a.firstSeq ?? 0) - (b.firstSeq ?? 0) || a.name.localeCompare(b.name))
    .map((c) => ({ char: c, name: c.isUser ? data.userName : c.name, color: data.profiles[c.name.toLowerCase()]?.color ?? null }));
}

/** Everyone's colour in this story, keyed by lower-cased name (the Almanac and thoughts use it too). */
export function storyColors(data: TrackersResponse | null): Map<string, string> {
  if (!data) return new Map();
  return castColors(castOf(data).map((p) => ({ name: p.name, color: p.color, isUser: p.char.isUser })));
}

/** The cast from the story state (plus whoever is speaking, when trackers are off). */
export function voicesFrom(data: TrackersResponse | null, extra: { name: string; isUser?: boolean }[] = []): Voice[] {
  const people: { key: string; name: string; aliases: string[]; color: string | null; isUser: boolean; isMain: boolean; g: "m" | "f" | null }[] = [];
  const seen = new Set<string>();
  const add = (key: string, name: string, aliases: string[], color: string | null, isUser: boolean, isMain: boolean, g: "m" | "f" | null = null) => {
    const k = name.toLowerCase();
    if (!name || seen.has(k)) return;
    seen.add(k);
    people.push({ key, name, aliases, color, isUser, isMain, g });
  };
  if (data) for (const p of castOf(data)) add(p.char.id, p.name, p.char.aliases ?? [], p.color, p.char.isUser, p.char.isMain, notedGender(p.char));
  for (const e of extra) add(`x:${e.name}`, e.name, [], null, Boolean(e.isUser), !e.isUser);
  const colors = castColors(people);
  return people.map((p) => {
    const words = p.name.split(/\s+/);
    const first = words[0]!;
    const last = words.length > 1 ? words.at(-1)! : "";
    const titled = TITLE.test(first);
    const names = [p.name, ...p.aliases, titled ? "" : first, titled && last ? `${first} ${last}` : ""].filter((n) => n && n.length > 1);
    return { key: p.key, name: p.name, names: [...new Set(names)], color: colors.get(p.name.toLowerCase())!, isUser: p.isUser, isMain: p.isMain, g: p.g };
  });
}

/** He or she from what the story state notes about someone (their look, traits, thoughts), if it leans clearly. */
function notedGender(c: TrackerCharacter): "m" | "f" | null {
  const text = [c.look, c.activity, ...(c.traits ?? []).map((t) => t.text)].filter(Boolean).join(" ");
  const m = text.match(/\b(he|him|his|himself)\b/gi)?.length ?? 0;
  const f = text.match(/\b(she|her|hers|herself)\b/gi)?.length ?? 0;
  return m > f * 2 ? "m" : f > m * 2 ? "f" : null;
}

const TITLE = /^(mr|mrs|ms|miss|dr|lady|lord|ser|sir|captain|old|maester|king|queen|prince|princess|madam|madame|master|mistress|father|mother|brother|sister|aunt|uncle)\.?$/i;
const MALE_TITLE = /^(mr|lord|ser|sir|king|prince|master|father|brother|uncle)\.?$/i;
const FEMALE_TITLE = /^(mrs|ms|miss|lady|queen|princess|madam|madame|mistress|mother|sister|aunt)\.?$/i;

const WHISPER = /\b(whisper|murmur|mutter|breathe|hiss|mumble|sigh)\w*/i;
const LOUD = /\b(shout|yell|call(?:ed|s)? out|bellow|roar|scream|holler|bark|snap|louder|aloud)\w*/i;

/** Whichever manner word comes last wins: "she muttered, then louder, “…”" is loud. */
function texture(how: string): "whisper" | "loud" | null {
  const w = [...how.matchAll(new RegExp(WHISPER.source, "gi"))].at(-1)?.index ?? -1;
  const l = [...how.matchAll(new RegExp(LOUD.source, "gi"))].at(-1)?.index ?? -1;
  return w < 0 && l < 0 ? null : w > l ? "whisper" : "loud";
}
const SPEECH = /\b(said|says|say|ask(?:ed|s)?|repl(?:ied|ies|y)|answer(?:ed|s)?|whisper\w*|murmur\w*|mutter\w*|shout\w*|yell\w*|call(?:ed|s)?|bellow\w*|roar\w*|snap(?:ped|s)?|hiss\w*|breathe[sd]?|laugh(?:ed|s)?|sigh(?:ed|s)?|added|adds|continu\w+|insist\w*|told|tells|offer\w*|began|begins|went on|goes on|growl\w*|purr\w*|drawl\w*|admit\w*|agree[sd]?|repeat\w*|demand\w*|warn\w*|whimper\w*|sob\w*|gasp\w*|groan\w*|scoff\w*|chuckl\w*|grumbl\w*|stammer\w*|stutter\w*|exclaim\w*|cr(?:y|ies|ied)|plead\w*|beg(?:s|ged)?|tease[sd]?|teasing|prompt\w*|counter\w*|retort\w*|corrects?|corrected|interrupt\w*|announc\w*|declar\w*|explain\w*|mus(?:e|es|ed|ing)|wonder\w*|manag\w*|choke[sd]? out|gets? out|got out|bites? out|bit out|spits? out|spat)\b/i;

type Gender = "m" | "f";
/** A person the prose refers to. `obj` marks one who's acted on, not acting ("behind her", "at Wren"). */
type Token = ({ kind: "name"; v: Voice } | { kind: "you" } | { kind: "self" } | { kind: "pro"; g: Gender | null }) & { at: number; obj: boolean };

const HE = /^(he|him|his|himself)$/i;
const SHE = /^(she|her|hers|herself)$/i;
/** A word before a person that makes them the object of the sentence, not its subject. */
const PREP = /\b(at|to|toward|towards|behind|beside|besides|with|from|for|of|on|onto|into|past|around|near|after|before|under|over|between|like|than|about|against|without|across|through|by|beneath|above|below|among|upon|unlike|despite|watching|watch|watches|watched|see|sees|saw|seeing|eyeing|eyed|glancing|hugging|kissing|holding|pulling|pushing|grabbing|helping|leaving|meeting|facing|ignoring|letting|making|telling|asking|following|regarding)\s+$/i;
/** "her" that owns nothing ("after her", "gave her the cup"). */
const BARE_HER = /^\s+(the|a|an|to|and|in|on|at|up|out|back|down|off|over|away|with|for|from|into|as|that|this|go|be|is|was|again|close|now|then|but|or|so|if|when|until)\b|^\s*[^\s\w]|^\s*$/i;
/** Verbs that answer someone: "he answered" leans to whoever was just spoken to. */
const REPLY = /^(repl|answer|retort|counter|respond|shot back|fire[sd]? back|echo)/i;
/** Capitalised words that are not people, even mid-sentence. */
const NOT_NAME = /^(I|I'm|I'd|I'll|I've|OK|Okay|God|Gods|Heaven|Hell|Mr|Mrs|Ms|Dr|Sir|Lady|Lord|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|January|February|March|April|May|June|July|August|September|October|November|December|Christmas|English|North|South|East|West|Mom|Dad|Mum|Mama|Papa|You|Your|Yours|He|She|They|It|We|Us|Our|My|Me|Him|Her|His|Hers|Their|Them|Its|The|A|An|And|But|Or|Then|So|Yes|No|Oh|Ah|Hey|Hi|Hello|This|That|These|Those|There|Here|What|When|Where|Why|How|Who|Something|Nothing|Everything|Someone|Everyone|Nobody)$/;
/** Someone the tag names without a name: "the guard said", "said a voice". */
const NAMELESS = /^(?:[\s,\u2014\u2013-]*(?:and|then|but)\s+)?(?:the|a|an|someone|somebody|one|another|everyone|nobody|no one)\b/i;
const STRANGER: Voice = { key: "", name: "", names: [], color: "", isUser: false, isMain: false };

/**
 * How the prose refers to each person, learned as messages are read: a sentence that names one
 * person and then says "she" or "his" counts toward that person. It carries across messages, so a
 * "she said" in one reply can lean on what an earlier one showed. Nothing is stored.
 */
const genderSeen = new Map<string, { name: string; g: Gender }>();
function learnGender(key: string, name: string, g: Gender) {
  if (genderSeen.has(key)) return;
  genderSeen.set(key, { name, g });
  if (genderSeen.size > 4000) genderSeen.delete(genderSeen.keys().next().value!);
}
function genders(): Map<string, Gender> {
  const tally = new Map<string, { m: number; f: number }>();
  for (const { name, g } of genderSeen.values()) {
    const t = tally.get(name) ?? { m: 0, f: 0 };
    t[g]++;
    tally.set(name, t);
  }
  const out = new Map<string, Gender>();
  for (const [name, t] of tally) if (t.m !== t.f) out.set(name, t.m > t.f ? "m" : "f");
  return out;
}

interface Seg {
  text: string;
  span?: HTMLElement;
}

function segmentsOf(block: Element): Seg[] {
  const segs: Seg[] = [];
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const n = walker.currentNode as Text;
    const span = n.parentElement?.closest<HTMLElement>(".dl") ?? undefined;
    const last = segs.at(-1);
    if (span && last?.span === span) last.text += n.data;
    else if (!span && last && !last.span) last.text += n.data;
    else segs.push({ text: n.data, span });
  }
  return segs;
}

/** A person's monogram: the first letter of their name past any title ("Ser Arlan" → A). */
function initial(name: string) {
  const words = name.split(/\s+/);
  return ((words.length > 1 && TITLE.test(words[0]!) ? words[1] : words[0]) ?? "?").slice(0, 1).toUpperCase();
}

const sentences = (text: string) => text.split(/(?<=[.!?\u2026])\s+/);

/**
 * People the narration names who aren't in the cast yet ("Kael stepped forward", "Captain Reyes's
 * hand"), so their lines get their own colour instead of someone else's. A capitalised word counts
 * when it shows up mid-sentence, or opens one with 's or a speech verb straight after it.
 */
function strangersIn(narration: { text: string; open: boolean }[], known: Set<string>): string[] {
  const mid = new Set<string>();
  const starts = new Map<string, number>();
  const tagged = new RegExp(`^,?\\s+(?:${SPEECH.source})`, "i");
  for (const { text, open } of narration) {
    for (const m of text.matchAll(/[A-Z][a-z]+(?:['\u2019-][A-Za-z]+)*(?:\s+[A-Z][a-z]+(?:['\u2019-][A-Za-z]+)*)*/g)) {
      // "Then Kael" is Kael, mid-sentence.
      const words = m[0].replace(/['\u2019]s$/, "").split(/\s+/);
      let lead = 0;
      while (lead < words.length && NOT_NAME.test(words[lead]!)) lead++;
      const name = words.slice(lead).join(" ");
      if (!name || name.length < 2 || known.has(name) || words.slice(lead).some((w) => known.has(w) || NOT_NAME.test(w))) continue;
      const before = text.slice(0, m.index).trimEnd();
      const start = !lead && (before ? /[.!?\u2026:"\u201c\u201d\u2014]$/.test(before) : open);
      const rest = text.slice(m.index! + m[0].length);
      if (!start || /['\u2019]s$/.test(m[0]) || tagged.test(rest)) mid.add(name);
      else starts.set(name, (starts.get(name) ?? 0) + 1);
    }
  }
  // Opening two sentences is something a name does and a word like "Silence" rarely does.
  return [...new Set([...mid, ...[...starts].filter(([, n]) => n >= 2).map(([w]) => w)])];
}

/**
 * Works out who says each quoted line and tints it in their colour (L-voices). In order of trust:
 * a speech tag after the line ("…," Wren said / she said / said Pell), the subject of the action
 * beat just before it, the subject of the beat right after it, the person already talking in the
 * paragraph, whoever was just spoken to, the back-and-forth of a two-person exchange, and last the
 * message's own author. "She" and "he" go to the person the prose last made the subject, unless
 * someone else plainly fits better. Lines the prose gives to someone unnamed ("the guard said")
 * stay untinted rather than borrow a cast member's colour.
 */
export function attribute(root: HTMLElement, voices: Voice[], style: VoiceStyle, author?: string) {
  root.dataset.voices = style;
  // What an earlier pass dressed (a style change re-reads the same html).
  for (const el of root.querySelectorAll(".v-ui")) el.remove();
  for (const el of root.querySelectorAll<HTMLElement>(".v-say")) {
    el.classList.remove("v-say", "v-user", "v-follow", "v-unknown");
    delete el.dataset.say;
    delete el.dataset.tone;
    el.style.removeProperty("--vc");
  }
  for (const el of root.querySelectorAll(".dl.v-other")) el.classList.remove("v-other");
  if (style === "off" || !voices.length) {
    for (const s of root.querySelectorAll<HTMLElement>(".dl[data-v]")) s.removeAttribute("data-v");
    return;
  }
  const blocks = Array.from(root.querySelectorAll("p, li, blockquote, td")).filter((b) => !b.closest(".art") && !b.querySelector("p, li"));
  /** The reply marked its speakers: those lines are taken as written, and unmarked ones aren't guessed. */
  const marked = root.querySelector(".dl[data-spk]") !== null;
  const segsOf = new Map(blocks.map((b) => [b, segmentsOf(b)] as const));

  // Surnames on their own ("Halloway"), when only one person has that surname.
  const extra = new Map<string, Voice | null>();
  for (const v of voices) {
    const words = v.name.split(/\s+/);
    if (words.length < 2 || TITLE.test(words[0]!)) continue;
    const last = words.at(-1)!;
    extra.set(last, extra.has(last) ? null : v);
  }
  let pairs = [...voices.flatMap((v) => v.names.map((n) => [n, v] as const)), ...[...extra].filter(([n, v]) => v && !voices.some((o) => o.names.includes(n))).map(([n, v]) => [n, v!] as const)];

  // Narration (not dialogue), and whether each piece opens a sentence.
  const narration: { text: string; open: boolean }[] = [];
  for (const segs of segsOf.values())
    segs.forEach((s, i) => {
      if (s.span) return;
      const prev = segs[i - 1]?.span ? segs[i - 1]!.text.replace(/[\s"\u201d\u2019']+$/, "") : "";
      narration.push({ text: s.text, open: i === 0 || /[.!?\u2026]$/.test(prev) || !prev });
    });
  const known = new Set(pairs.flatMap(([n]) => [n, ...n.split(/\s+/)]));
  const strangers = strangersIn(narration, known);
  if (strangers.length) {
    const colors = castColors([...voices.map((v) => ({ name: v.name, color: v.color })), ...strangers.map((name) => ({ name }))]);
    const added = strangers.map((name) => ({ key: `s:${name}`, name, names: [name], color: colors.get(name.toLowerCase())!, isUser: false, isMain: false }));
    pairs = [...pairs, ...added.map((v) => [v.name, v] as const)];
  }
  // Longest names first, so "Wren Halloway" wins over "Wren"; capitalised names only (avoid "rose", "will").
  pairs.sort((a, b) => b[0].length - a[0].length);
  const escaped = pairs.map(([n]) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const tokenRe = new RegExp(`\\b(${escaped.join("|") || "(?!)"})(?:['\u2019]s)?\\b|\\b([Yy]ou|[Yy]our|[Yy]ours|[Yy]ourself)\\b|\\b(I|me|my|myself)\\b|\\b([Hh]e|[Ss]he|[Tt]hey|[Hh]is|[Hh]er|[Tt]heir|[Hh]im|[Tt]hem|[Hh]imself|[Hh]erself|[Tt]hemselves)\\b`, "g");
  const byName = new Map(pairs.map(([n, v]) => [n, v]));

  // Names the marks give: someone in the cast (any name or alias, then a first name), else a new
  // person with a colour of their own.
  const tagged = new Map<string, Voice>();
  if (marked) {
    const lower = new Map(pairs.map(([n, v]) => [n.toLowerCase(), v] as const));
    const firstOf = (n: string) => n.toLowerCase().split(/\s+/)[0]!;
    // Every word of a marked name, nicknames out of their quotes: "Jacqueline ‘Jackie’ Taylor".
    const wordsOf = (n: string) => n.toLowerCase().split(/[\s"“”‘’'()]+/).filter((w) => w.length > 2);
    const fresh: string[] = [];
    for (const s of root.querySelectorAll<HTMLElement>(".dl[data-spk]")) {
      const name = s.dataset.spk!.trim();
      const k = name.toLowerCase();
      if (!name || name === "?" || tagged.has(k) || fresh.includes(name)) continue;
      const own = wordsOf(name);
      const byWord = voices.filter((o) => o.names.some((n) => own.includes(firstOf(n))));
      const v = lower.get(k) ?? voices.find((o) => o.names.some((n) => firstOf(n) === firstOf(name))) ?? (byWord.length === 1 ? byWord[0] : undefined);
      if (v) tagged.set(k, v);
      else fresh.push(name);
    }
    if (fresh.length) {
      const colors = castColors([...voices.map((v) => ({ name: v.name, color: v.color })), ...fresh.map((name) => ({ name }))]);
      for (const name of fresh) tagged.set(name.toLowerCase(), { key: `t:${name}`, name, names: [name], color: colors.get(name.toLowerCase())!, isUser: false, isMain: false });
    }
  }
  const user = voices.find((v) => v.isUser);
  const self = (author && voices.find((v) => v.name.toLowerCase() === author.toLowerCase())) || voices.find((v) => v.isMain && !v.isUser) || voices.find((v) => !v.isUser);
  const own = self?.isUser ?? false;
  const known_g = genders();
  const genderOf = (v: Voice): Gender | null => {
    const g = known_g.get(v.name.toLowerCase()) ?? v.g;
    if (g) return g;
    const first = v.name.split(/\s+/)[0]!;
    return MALE_TITLE.test(first) ? "m" : FEMALE_TITLE.test(first) ? "f" : null;
  };

  const tokens = (text: string): Token[] => {
    const out: Token[] = [];
    for (const m of text.matchAll(tokenRe)) {
      const at = m.index!;
      const obj = PREP.test(text.slice(Math.max(0, at - 24), at));
      if (m[1]) {
        const v = byName.get(m[1]);
        // "Shauna's." on its own points at her things, not at her doing something.
        const owns = /^['\u2019]s\b/.test(text.slice(at + m[1].length)) && /^['\u2019]s\s*[.,;!?\u2026\u2014]/.test(text.slice(at + m[1].length));
        if (v) out.push(v.isUser ? { kind: "you", at, obj: obj || owns } : { kind: "name", v, at, obj: obj || owns });
      } else if (m[2]) out.push({ kind: "you", at, obj });
      else if (m[3]) out.push({ kind: "self", at, obj: obj || m[3] === "me" });
      else if (m[4]) {
        const w = m[4].toLowerCase();
        const bare = /^(him|them|himself|herself|themselves)$/.test(w) || (w === "her" && BARE_HER.test(text.slice(at + 3)));
        out.push({ kind: "pro", g: HE.test(w) ? "m" : SHE.test(w) ? "f" : null, at, obj: obj || bare });
      }
    }
    return out;
  };

  /** People named in the narration so far, most recent last. */
  const recent: Voice[] = [];
  const mention = (v: Voice | undefined) => {
    if (!v || v.isUser || v === STRANGER) return;
    const i = recent.lastIndexOf(v);
    if (i >= 0) recent.splice(i, 1);
    recent.push(v);
  };
  /** Who the last sentence of narration was about: "she" leans to them first. */
  let subject: Voice | undefined;
  /** People the line being read talks about ("Have you seen Shauna?"): whoever says it, it isn't them. */
  let notThem = new Set<Voice>();
  /**
   * "She" or "he": a person the prose has called that beats one it hasn't; among equals the last
   * subject wins, or `prefer` (whoever was just spoken to) when the caller says a reply is likelier.
   */
  const resolve = (t: Token, prefer?: Voice): Voice | undefined => {
    if (t.kind === "name") return t.v;
    if (t.kind === "you") return user;
    if (t.kind === "self") return self;
    const order = [...(subject ? [subject] : []), ...recent.slice().reverse()].filter((v, i, a) => a.indexOf(v) === i);
    const fit = (v: Voice) => (!t.g ? 1 : genderOf(v) === t.g ? 2 : genderOf(v) ? 0 : 1);
    let best: Voice | undefined;
    for (const v of order) if (fit(v) && !notThem.has(v) && (!best || fit(v) > fit(best))) best = v;
    if (best && prefer && prefer !== best && fit(prefer) === fit(best) && order.includes(prefer)) return prefer;
    return best;
  };

  /**
   * Sentences that name exactly one person teach that person's pronoun: "he"/"she" and their
   * reflexives, "his", and "her" when it owns something ("her eyes", not "after her" or "gave her
   * the cup"). "Him" is left out: in a one-name sentence it's usually someone else.
   */
  const learn = (text: string) => {
    for (const sentence of sentences(text)) {
      const ts = tokens(sentence);
      const names = new Set(ts.filter((t) => t.kind === "name").map((t) => (t as { v: Voice }).v));
      if (names.size !== 1) continue;
      const v = [...names][0]!;
      const from = ts.find((t) => t.kind === "name")!.at;
      for (const m of sentence.slice(from).matchAll(/\b(he|she|himself|herself|his|her)\b(\s+[a-z]+)?/gi)) {
        const word = m[1]!.toLowerCase();
        if (word === "her" && (!m[2] || BARE_HER.test(m[2]))) continue;
        const g: Gender = word === "he" || word === "himself" || word === "his" ? "m" : "f";
        learnGender(`${v.name.toLowerCase()}\u0000${sentence.slice(0, 120)}`, v.name.toLowerCase(), g);
        break;
      }
    }
  };

  /** A person acted on in a tag or beat: "said to Pell", "asked Doran", "turned to Mara". */
  const addresseeIn = (text: string, speaker: Voice): Voice | undefined => {
    for (const t of tokens(text)) {
      if (t.kind !== "name" && t.kind !== "pro") continue;
      const before = text.slice(Math.max(0, t.at - 30), t.at);
      if (!/\b(to|at|toward|towards)\s+$/i.test(before) && !new RegExp(`(?:${SPEECH.source})\\s+$`, "i").test(before)) continue;
      const v = t.kind === "name" ? t.v : undefined;
      if (v && v !== speaker) return v;
    }
    return undefined;
  };
  /** A name called out in the line itself: "Pell, stop." / "…all of you, Doran." */
  const vocativeIn = (line: string): Voice | undefined => {
    const inner = line.replace(/^[\s"\u201c\u2018']+|[\s"\u201d\u2019']+$/g, "");
    for (const [n, v] of pairs) {
      const e = n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (new RegExp(`(?:^|,\\s*)${e}\\s*(?:[,!?\u2014]|[.\u2026]*$)`).test(inner)) return v;
    }
    return undefined;
  };

  /** Who does the speaking in a tag after the line: ', Wren said' / ' she whispered' / ' said Pell'. */
  const tagSpeaker = (after: string, prefer: Voice | undefined): { who?: Voice; verb?: string } => {
    const clause = after.split(/[.!?;:\u2026]\s|[.!?;:\u2026]$/)[0]!.slice(0, 120);
    const verb = clause.match(SPEECH);
    if (!verb || verb.index! > 60) return {};
    const ts = tokens(clause);
    const before = ts.filter((t) => t.at < verb.index! && !t.obj);
    const reply = REPLY.test(verb[0]) ? prefer : undefined;
    // "…," Wren said / "…," she said softly to Pell: the subject comes before the verb.
    if (before.length) return { who: resolve(before[0]!, reply), verb: verb[0] };
    if (NAMELESS.test(clause.slice(0, verb.index))) return { who: STRANGER, verb: verb[0] };
    // "…," said Pell / asked the girl beside Wren: the subject follows straight after.
    const rest = clause.slice(verb.index! + verb[0].length);
    const afterVerb = ts.find((t) => t.at >= verb.index! + verb[0].length);
    if (afterVerb && afterVerb.at - (verb.index! + verb[0].length) < 4 && afterVerb.kind === "name") return { who: afterVerb.v, verb: verb[0] };
    if (/^\s+(?:the|a|an|someone|somebody|another)\b/i.test(rest) && verb.index! < 3) return { who: STRANGER, verb: verb[0] };
    return {};
  };

  /**
   * The subject of a beat: the first person the sentence has acting, skipping anyone acted on
   * ("Behind her, Pell…", "Glancing at Wren, Pell…") and you in a reply (you don't talk there).
   * In "Mara said, and Doran was already moving" the last clause with its own subject wins, and
   * in "tossed it to Wren, who caught it" so does the person "who" points back to.
   */
  const subjectOf = (sentence: string, prefer?: Voice): Voice | undefined => {
    const who = sentence.match(/,\s+who\s+[^,]*$/);
    if (who) {
      const ts = tokens(sentence.slice(0, who.index));
      const t = ts.at(-1);
      if (t && t.kind === "name" && t.at + 1 >= who.index! - 40 && sentence.slice(t.at, who.index).match(/^[\w\s'\u2019]+$/)) return t.v;
    }
    const clauses = sentence.split(/,\s*(?=(?:and|but|while|as|so|yet|then)\s)|;\s*/);
    for (let c = clauses.length - 1; c >= 0; c--) {
      const clause = clauses[c]!.replace(/^(?:and|but|while|as|so|yet|then)\s+/i, "");
      const ts = tokens(clause);
      const first = ts.find((t) => !t.obj);
      // A later clause only counts when it opens with its own subject.
      if (c > 0 && (!first || first.at > 2)) continue;
      for (const t of ts) {
        if (t.obj) continue;
        const v = resolve(t, prefer);
        if (!v || notThem.has(v)) continue;
        if (v.isUser && !own) continue;
        return v;
      }
      if (c === 0) return undefined;
    }
    return undefined;
  };

  let lastSpeaker: Voice | undefined;
  let prevSpeaker: Voice | undefined;
  /** People spoken to who haven't answered yet, most recent last. */
  const owed: Voice[] = [];
  const owe = (v: Voice | undefined) => {
    if (!v || v === STRANGER) return;
    const i = owed.indexOf(v);
    if (i >= 0) owed.splice(i, 1);
    owed.push(v);
  };
  const owedBy = (not: (Voice | undefined)[]) => [...owed].reverse().find((v) => !not.includes(v));

  /** Tints one line in its speaker's colour (a nameless speaker stays plain). */
  const paint = (span: HTMLElement, who: Voice, tex: "whisper" | "loud" | null) => {
    if (who === STRANGER) {
      span.removeAttribute("data-v");
      span.style.removeProperty("--vc");
      span.removeAttribute("title");
      delete span.dataset.initial;
    } else {
      span.dataset.v = who.key;
      span.style.setProperty("--vc", who.color);
      span.title = who.name;
      span.dataset.initial = initial(who.name);
    }
    span.classList.toggle("v-whisper", tex === "whisper");
    span.classList.toggle("v-loud", tex === "loud");
  };
  /** A voice card (Blocks) or screenplay line (Script): a medallion and a nameplate, painted by voices.css. */
  const dress = (el: HTMLElement, who: Voice, tone?: string) => {
    const known = who !== STRANGER;
    el.classList.add("v-say");
    el.classList.toggle("v-user", who.isUser);
    el.classList.toggle("v-unknown", !known);
    el.dataset.say = known ? who.key : "?";
    if (tone) el.dataset.tone = tone;
    if (known) el.style.setProperty("--vc", who.color);
    const prev = el.previousElementSibling as HTMLElement | null;
    if (known && prev?.classList.contains("v-say") && prev.dataset.say === el.dataset.say) el.classList.add("v-follow");
    const medal = document.createElement("span");
    medal.className = "v-ui v-medal";
    medal.textContent = known ? initial(who.name) : "?";
    const plate = document.createElement("span");
    plate.className = "v-ui v-plate";
    plate.textContent = known ? who.name : "Someone";
    if (tone) {
      const t = document.createElement("em");
      t.textContent = tone;
      plate.appendChild(t);
    }
    for (const x of [medal, plate]) {
      x.setAttribute("aria-hidden", "true");
      x.contentEditable = "false";
    }
    el.prepend(medal, plate);
  };

  for (const block of blocks) learn(segsOf.get(block)!.filter((x) => !x.span).map((x) => x.text).join(" "));
  for (const [k, g] of genders()) known_g.set(k, g);

  for (const block of blocks) {
    const segs = segsOf.get(block)!;
    let blockSpeaker: Voice | undefined;
    let leads: Voice | undefined;
    /** The first line in the paragraph with a speaker (Blocks and Script dress the paragraph after it). */
    let opener: { who: Voice; tone?: string; at: number } | undefined;
    /** Whether this paragraph has named who it's about: then "she" means them, not whoever was spoken to. */
    let named = false;
    segs.forEach((seg, i) => {
      if (!seg.span) {
        for (const sentence of sentences(seg.text)) {
          const ts = tokens(sentence);
          const first = ts.find((t) => !t.obj);
          const lead = first ? resolve(first) : undefined;
          for (const t of ts) if (t.kind === "name") mention(t.v);
          if (lead && !lead.isUser) {
            subject = lead;
            if (first!.kind === "name") named = true;
          }
        }
        return;
      }
      if (seg.span.closest(".art")) return;
      if (marked) {
        const spk = seg.span.dataset.spk?.trim();
        const who = spk && spk !== "?" ? (tagged.get(spk.toLowerCase()) ?? STRANGER) : STRANGER;
        paint(seg.span, who, TONE_TEXTURE[seg.span.dataset.tone ?? ""] ?? null);
        if (spk !== undefined) opener ??= { who, tone: seg.span.dataset.tone, at: i };
        if (who !== STRANGER) {
          if (opener && opener.who !== who) seg.span.classList.add("v-other");
          blockSpeaker ??= who;
          leads ??= who;
          mention(who);
          if (!who.isUser) subject = who;
        }
        return;
      }
      const first = !segs.slice(0, i).some((x) => x.span);
      const before = (segs[i - 1] && !segs[i - 1]!.span ? segs[i - 1]!.text : "").trim();
      const after = (segs[i + 1] && !segs[i + 1]!.span ? segs[i + 1]!.text : "").trim();
      const head = sentences(before).at(-1)!.slice(-200);
      const tail = after.split(/[.!?;:\u2026]\s|[.!?;:\u2026]$/)[0]!.slice(0, 120);
      const line = seg.span.textContent ?? "";
      const called = vocativeIn(line);
      notThem = new Set(tokens(line).flatMap((t) => (t.kind === "name" ? [t.v] : [])));
      // Whoever was just spoken to is the likelier speaker when a new paragraph or a reply verb is ambiguous.
      const answers = owedBy([lastSpeaker, ...notThem]);
      const prefer = named ? undefined : answers;
      // The tag says how it was said; failing that, the beat before it. A shared tag splits at
      // "then"/"and": "she muttered, then louder," gives the first line the muttering.
      const how = SPEECH.test(tail) ? tail.split(/,\s*(?:then|and|but|before)\b/i)[0]! : /[:,]$/.test(head) || SPEECH.test(head) ? head.split(/,\s*(?:then|and|but)\b/i).at(-1)! : "";
      const tag = tagSpeaker(after, answers);
      let who = tag.who;
      let cue = who ? tail : "";
      // The beat just before; when it's only about someone the line mentions, the sentence before that.
      for (const beat of sentences(before).slice(-3).reverse()) {
        if (who || !beat.trim()) break;
        who = subjectOf(beat.slice(-200), first ? prefer : undefined);
        if (who) cue = beat;
        if (!notThem.size) break;
      }
      // A beat right after a line that opens its paragraph: "“Fine.” Wren turned away."
      if (!who && !blockSpeaker && tail && first) {
        who = subjectOf(tail, prefer);
        if (who) cue = tail;
      }
      // Nobody calls their own name or asks where they are, unless a tag plainly says so.
      if (who && !tag.who && notThem.has(who)) who = undefined;
      if (who && who === called && who !== STRANGER) who = undefined;
      if (!who && blockSpeaker && !notThem.has(blockSpeaker)) who = blockSpeaker;
      if (!who && first && answers) who = answers; // answering whoever was just spoken to
      if (!who && lastSpeaker && prevSpeaker && lastSpeaker !== prevSpeaker && !notThem.has(prevSpeaker)) who = prevSpeaker; // back and forth
      if (!who && self && !notThem.has(self)) who = self;
      notThem = new Set();
      if (!who) return;
      paint(seg.span, who, texture(how));
      if (who !== STRANGER) opener ??= { who, at: i };
      if (opener && opener.who !== who) seg.span.classList.add("v-other");
      // Who this line is said to: someone named in its tag or beat, a name it calls out, or else
      // the person who just spoke to this speaker (an answer goes back to them).
      const to = called ?? (cue ? addresseeIn(cue, who) : undefined) ?? (owed.includes(who) && lastSpeaker !== who ? lastSpeaker : undefined);
      const j = owed.indexOf(who);
      if (j >= 0) owed.splice(j, 1);
      if (to && to !== who) owe(to);
      blockSpeaker = who;
      if (who !== STRANGER) leads ??= who;
      mention(who);
      if (!who.isUser && who !== STRANGER) subject = who;
    });
    if (blockSpeaker && blockSpeaker !== lastSpeaker) {
      prevSpeaker = lastSpeaker;
      lastSpeaker = blockSpeaker;
    }
    const el = block as HTMLElement;
    // Blocks / Script: a paragraph that opens on a line becomes that person's card; a line in the
    // middle of narration stays inline (a chip), so sentences never break mid-flow.
    if (CARDS.has(style) && opener && !segs.slice(0, opener.at).some((x) => x.text.trim()) && (opener.who !== STRANGER || marked)) dress(el, opener.who, opener.tone);
    if (leads) {
      el.dataset.lead = leads.key;
      el.dataset.initial = leads.name.slice(0, 1);
      el.style.setProperty("--lc", leads.color);
    } else {
      delete el.dataset.lead;
      delete el.dataset.initial;
    }
  }
}

/** Text as both the saved reply and the page read it: no quote marks, Markdown or extra spaces. */
const plain = (s: string) => s.replace(/[*_~`\\]+/g, "").replace(/[\s"“”„'‘’]+/g, " ").trim().toLowerCase();

const SPACE = /[\s"“”„'‘’]/;
const MARKDOWN = /[*_~`\\]/;
const MARK = /["“”„«»*_~]/;
const QUOTE = /["“”„«»]/;

/** The page's dialogue spans grouped into lines: a line split by italics shows as several spans. */
function spokenGroups(root: HTMLElement): HTMLElement[][] {
  const groups: HTMLElement[][] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement?.closest(".art, .v-ui") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  let open: { spans: HTMLElement[]; block: Element | null } | null = null;
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    const span = node.parentElement?.closest<HTMLElement>(".dl") ?? null;
    if (!span) {
      if (node.data.length) open = null;
      continue;
    }
    const block = span.closest("p, li, blockquote, td, th, h1, h2, h3, h4, div");
    if (open && open.block === block) {
      if (!open.spans.includes(span)) open.spans.push(span);
    } else {
      open = { spans: [span], block };
      groups.push(open.spans);
    }
  }
  return groups;
}

/**
 * Every quoted line of a message with who says it as the page reads it now, `line` given to `name`
 * instead: what a tap on a line saves, so the lines you didn't touch keep their colour. Each line
 * is the stretch of the saved text that its dialogue spans show, found in order, so it pairs the
 * quotes exactly the way the page did (a stray “ closing a line, a ” opening one). Null when the
 * tapped line can't be found in the text.
 */
export function respoken(root: HTMLElement, content: string, line: HTMLElement, name: string | null): { text: string; name: string | null; tone?: string }[] | null {
  // The text as plain() reads it, with where each of its characters sits in the original.
  let norm = "";
  const at: number[] = [];
  for (let i = 0; i < content.length; i++) {
    const ch = content[i]!;
    if (MARKDOWN.test(ch)) continue;
    if (SPACE.test(ch)) {
      if (norm && !norm.endsWith(" ")) (norm += " "), at.push(i);
    } else (norm += ch.toLowerCase()), at.push(i);
  }
  const out: { text: string; name: string | null; tone?: string }[] = [];
  let cursor = 0;
  let found = false;
  for (const group of spokenGroups(root)) {
    const want = plain(group.map((s) => s.textContent ?? "").join(""));
    if (!want) continue;
    // The first place it stands between quote marks; narration that says the same words doesn't count.
    let hit: { start: number; end: number } | null = null;
    let first: { start: number; end: number } | null = null;
    for (let k = norm.indexOf(want, cursor); k >= 0; k = norm.indexOf(want, k + 1)) {
      let start = at[k]!;
      let end = at[k + want.length - 1]! + 1;
      let s = start;
      let e = end;
      while (s > 0 && MARK.test(content[s - 1]!)) s--;
      while (e < content.length && MARK.test(content[e]!)) e++;
      const quoted = QUOTE.test(content.slice(s, start) + content.slice(end, e));
      if (quoted) (start = s), (end = e);
      first ??= { start, end };
      if (quoted) {
        hit = { start, end };
        break;
      }
    }
    hit ??= first;
    if (!hit) continue;
    const { end } = hit;
    const next = at.findIndex((i) => i >= end);
    cursor = next < 0 ? norm.length : next;
    const lead = group[0]!;
    const mine = group.includes(line);
    if (mine) found = true;
    const tone = lead.dataset.tone;
    out.push({ text: content.slice(hit.start, hit.end), name: mine ? name : lead.dataset.v ? lead.title || null : null, ...(tone ? { tone } : {}) });
  }
  return found ? out : null;
}

/** use:voices={{ html, voices, style, author }}: re-reads the speakers whenever the text changes. */
export const voices: Action<HTMLElement, { html: string; voices: Voice[]; style: VoiceStyle; author?: string }> = (node, p) => {
  let last = "";
  const run = (q: typeof p) => {
    const key = `${q.html.length}:${q.html.slice(0, 64)}:${q.html.slice(-64)}:${q.style}:${q.author ?? ""}:${q.voices.map((v) => v.key + v.color).join()}`;
    if (key === last) return;
    last = key;
    // After Svelte has placed the new html (and the glossary pass has run).
    queueMicrotask(() => attribute(node, q.voices, q.style, q.author));
  };
  run(p);
  return { update: run };
};
