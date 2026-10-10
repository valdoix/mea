import type { Action } from "svelte/action";
import type { TrackersResponse } from "./types";

/**
 * Speaker colours: who said each quoted line, read from the prose the way a reader would. The
 * renderer already wraps dialogue in <span class="dl">; this works out the speaker of each from
 * the tag beside it ("Wren said"), the action beat before it, a pronoun's last-named person, or the
 * back-and-forth of a two-person exchange. Each line is tinted in that person's colour, with a
 * texture for how it was said (whispered, shouted). Nothing is sent to the model.
 */

export type VoiceStyle = "ink" | "ribbon" | "halo" | "off";

export interface Voice {
  key: string;
  name: string;
  /** Every way the prose names them: "Wren Halloway", "Wren", aliases. */
  names: string[];
  color: string;
  isUser: boolean;
  isMain: boolean;
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
  const people: { key: string; name: string; aliases: string[]; color: string | null; isUser: boolean; isMain: boolean }[] = [];
  const seen = new Set<string>();
  const add = (key: string, name: string, aliases: string[], color: string | null, isUser: boolean, isMain: boolean) => {
    const k = name.toLowerCase();
    if (!name || seen.has(k)) return;
    seen.add(k);
    people.push({ key, name, aliases, color, isUser, isMain });
  };
  if (data) for (const p of castOf(data)) add(p.char.id, p.name, p.char.aliases ?? [], p.color, p.char.isUser, p.char.isMain);
  for (const e of extra) add(`x:${e.name}`, e.name, [], null, Boolean(e.isUser), !e.isUser);
  const colors = castColors(people);
  return people.map((p) => {
    const words = p.name.split(/\s+/);
    const first = words[0]!;
    const last = words.length > 1 ? words.at(-1)! : "";
    const titled = TITLE.test(first);
    const names = [p.name, ...p.aliases, titled ? "" : first, titled && last ? `${first} ${last}` : ""].filter((n) => n && n.length > 1);
    return { key: p.key, name: p.name, names: [...new Set(names)], color: colors.get(p.name.toLowerCase())!, isUser: p.isUser, isMain: p.isMain };
  });
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
type Token = { kind: "name"; v: Voice; at: number } | { kind: "you"; at: number } | { kind: "self"; at: number } | { kind: "pro"; g: Gender | null; at: number };

const HE = /^(he|him|his|himself)$/i;
const SHE = /^(she|her|hers|herself)$/i;

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

/**
 * Works out who says each quoted line and tints it in their colour (L-voices). In order of trust:
 * a speech tag after the line ("…," Wren said / she said / said Pell), the subject of the action
 * beat just before it, the subject of the beat right after it, the person already talking in the
 * paragraph, the back-and-forth of a two-person exchange, and last the message's own author.
 * "She" and "he" go to the most recent person the prose has called that.
 */
export function attribute(root: HTMLElement, voices: Voice[], style: VoiceStyle, author?: string) {
  root.dataset.voices = style;
  if (style === "off" || !voices.length) {
    for (const s of root.querySelectorAll<HTMLElement>(".dl[data-v]")) s.removeAttribute("data-v");
    return;
  }
  // Longest names first, so "Wren Halloway" wins over "Wren"; capitalised names only (avoid "rose", "will").
  const pairs = voices.flatMap((v) => v.names.map((n) => [n, v] as const)).sort((a, b) => b[0].length - a[0].length);
  const escaped = pairs.map(([n]) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const tokenRe = new RegExp(`\\b(${escaped.join("|") || "(?!)"})(?:['\u2019]s)?\\b|\\b([Yy]ou|[Yy]our|[Yy]ours|[Yy]ourself)\\b|\\b(I|me|my|myself)\\b|\\b([Hh]e|[Ss]he|[Tt]hey|[Hh]is|[Hh]er|[Tt]heir|[Hh]im|[Tt]hem|[Hh]imself|[Hh]erself|[Tt]hemselves)\\b`, "g");
  const byName = new Map(pairs.map(([n, v]) => [n, v]));
  const user = voices.find((v) => v.isUser);
  const self = (author && voices.find((v) => v.name.toLowerCase() === author.toLowerCase())) || voices.find((v) => v.isMain && !v.isUser) || voices.find((v) => !v.isUser);
  const own = self?.isUser ?? false;
  const known = genders();
  const genderOf = (v: Voice): Gender | null => {
    const g = known.get(v.name.toLowerCase());
    if (g) return g;
    const first = v.name.split(/\s+/)[0]!;
    return MALE_TITLE.test(first) ? "m" : FEMALE_TITLE.test(first) ? "f" : null;
  };

  const tokens = (text: string): Token[] => {
    const out: Token[] = [];
    for (const m of text.matchAll(tokenRe)) {
      const at = m.index!;
      if (m[1]) {
        const v = byName.get(m[1]);
        if (v) out.push(v.isUser ? { kind: "you", at } : { kind: "name", v, at });
      } else if (m[2]) out.push({ kind: "you", at });
      else if (m[3]) out.push({ kind: "self", at });
      else if (m[4]) out.push({ kind: "pro", g: HE.test(m[4]) ? "m" : SHE.test(m[4]) ? "f" : null, at });
    }
    return out;
  };

  /** People named in the narration so far, most recent last. */
  const recent: Voice[] = [];
  const mention = (v: Voice | undefined) => {
    if (!v || v.isUser) return;
    const i = recent.lastIndexOf(v);
    if (i >= 0) recent.splice(i, 1);
    recent.push(v);
  };
  /** Who the last sentence of narration was about: "she" leans to them first. */
  let subject: Voice | undefined;
  const resolve = (t: Token): Voice | undefined => {
    if (t.kind === "name") return t.v;
    if (t.kind === "you") return user;
    if (t.kind === "self") return self;
    if (subject && (!t.g || (genderOf(subject) ?? t.g) === t.g)) return subject;
    let unknown: Voice | undefined;
    for (let i = recent.length - 1; i >= 0; i--) {
      const v = recent[i]!;
      const g = genderOf(v);
      if (!t.g || g === t.g) return v;
      if (!g) unknown ??= v;
    }
    return unknown;
  };

  /**
   * Sentences that name exactly one person teach that person's pronoun: "he"/"she" and their
   * reflexives, "his", and "her" when it owns something ("her eyes", not "after her" or "gave her
   * the cup"). "Him" is left out: in a one-name sentence it's usually someone else.
   */
  const learn = (text: string) => {
    for (const sentence of text.split(/(?<=[.!?\u2026])\s+/)) {
      const ts = tokens(sentence);
      const names = new Set(ts.filter((t) => t.kind === "name").map((t) => (t as { v: Voice }).v));
      if (names.size !== 1) continue;
      const v = [...names][0]!;
      const from = ts.find((t) => t.kind === "name")!.at;
      for (const m of sentence.slice(from).matchAll(/\b(he|she|himself|herself|his|her)\b(\s+[a-z]+)?/gi)) {
        const word = m[1]!.toLowerCase();
        if (word === "her" && (!m[2] || /^\s+(the|a|an|to|and|in|on|at|up|out|back|down|off|over|away|with|for|from|into|as|that|this|go|be|is|was|again|close|now|then)$/i.test(m[2]))) continue;
        const g: Gender = word === "he" || word === "himself" || word === "his" ? "m" : "f";
        learnGender(`${v.name.toLowerCase()}\u0000${sentence.slice(0, 120)}`, v.name.toLowerCase(), g);
        break;
      }
    }
  };

  /** Who does the speaking in a tag after the line: ', Wren said' / ' she whispered' / ' said Pell'. */
  const tagSpeaker = (after: string): Voice | undefined => {
    const clause = after.split(/[.!?;:\u2026]\s|[.!?;:\u2026]$/)[0]!.slice(0, 120);
    const verb = clause.match(SPEECH);
    if (!verb || verb.index! > 60) return undefined;
    const ts = tokens(clause);
    const before = ts.filter((t) => t.at < verb.index!);
    // "…," Wren said / "…," she said softly to Pell: the subject comes before the verb.
    if (before.length) return resolve(before[0]!);
    // "…," said Pell / asked the girl beside Wren: the subject follows straight after.
    const afterVerb = ts.find((t) => t.at >= verb.index! + verb[0].length);
    if (afterVerb && afterVerb.at - (verb.index! + verb[0].length) < 4 && afterVerb.kind === "name") return afterVerb.v;
    return undefined;
  };

  /** The subject of a beat: the first person a sentence names, skipping you in a reply (you don't talk there). */
  const subjectOf = (sentence: string): Voice | undefined => {
    for (const t of tokens(sentence)) {
      const v = resolve(t);
      if (!v) continue;
      if (v.isUser && !own) continue;
      return v;
    }
    return undefined;
  };

  let lastSpeaker: Voice | undefined;
  let prevSpeaker: Voice | undefined;

  const blocks = Array.from(root.querySelectorAll("p, li, blockquote, td")).filter((b) => !b.closest(".art") && !b.querySelector("p, li"));
  for (const block of blocks) learn(segmentsOf(block).filter((x) => !x.span).map((x) => x.text).join(" "));
  const learned = genders();
  for (const [k, g] of learned) known.set(k, g);

  for (const block of blocks) {
    const segs = segmentsOf(block);
    let blockSpeaker: Voice | undefined;
    let leads: Voice | undefined;
    segs.forEach((seg, i) => {
      if (!seg.span) {
        for (const sentence of seg.text.split(/(?<=[.!?\u2026])\s+/)) {
          const ts = tokens(sentence);
          const lead = ts[0] ? resolve(ts[0]) : undefined;
          for (const t of ts) if (t.kind === "name") mention(t.v);
          if (lead && !lead.isUser) subject = lead;
        }
        return;
      }
      if (seg.span.closest(".art")) return;
      const before = (segs[i - 1] && !segs[i - 1]!.span ? segs[i - 1]!.text : "").trim();
      const after = (segs[i + 1] && !segs[i + 1]!.span ? segs[i + 1]!.text : "").trim();
      const head = before.split(/(?<=[.!?\u2026])\s+/).at(-1)!.slice(-200);
      const tail = after.split(/[.!?;:\u2026]\s|[.!?;:\u2026]$/)[0]!.slice(0, 120);
      // The tag says how it was said; failing that, the beat before it. A shared tag splits at
      // "then"/"and": "she muttered, then louder," gives the first line the muttering.
      const how = SPEECH.test(tail) ? tail.split(/,\s*(?:then|and|but|before)\b/i)[0]! : /[:,]$/.test(head) || SPEECH.test(head) ? head.split(/,\s*(?:then|and|but)\b/i).at(-1)! : "";
      let who = tagSpeaker(after);
      if (!who && head) who = subjectOf(head);
      // A beat right after a line that opens its paragraph: "“Fine.” Wren turned away."
      if (!who && !blockSpeaker && tail && !segs.slice(0, i).some((x) => x.span)) who = subjectOf(tail);
      if (!who && blockSpeaker) who = blockSpeaker;
      if (!who && lastSpeaker && prevSpeaker && lastSpeaker !== prevSpeaker) who = prevSpeaker; // back and forth
      if (!who) who = self;
      if (!who) return;
      const tex = texture(how);
      seg.span.dataset.v = who.key;
      seg.span.style.setProperty("--vc", who.color);
      seg.span.classList.toggle("v-whisper", tex === "whisper");
      seg.span.classList.toggle("v-loud", tex === "loud");
      seg.span.title = who.name;
      blockSpeaker = who;
      leads ??= who;
      mention(who);
      if (!who.isUser) subject = who;
    });
    if (blockSpeaker && blockSpeaker !== lastSpeaker) {
      prevSpeaker = lastSpeaker;
      lastSpeaker = blockSpeaker;
    }
    const el = block as HTMLElement;
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
