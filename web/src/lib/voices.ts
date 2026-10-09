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
const PALETTE = ["#7fe3d0", "#ffbf6b", "#c7b4ff", "#9cc4ff", "#b6f08a", "#f3e48c", "#8ad8ff"];
export const USER_COLOR = "#ff9ec0";

export function voiceColor(name: string, own?: string | null): string {
  if (own && /^#[0-9a-f]{6}$/i.test(own)) return own;
  let h = 0;
  for (const ch of name.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length]!;
}

/** The cast from the story state (plus whoever is speaking, when trackers are off). */
export function voicesFrom(data: TrackersResponse | null, extra: { name: string; isUser?: boolean }[] = []): Voice[] {
  const out: Voice[] = [];
  const seen = new Set<string>();
  const add = (key: string, name: string, aliases: string[], color: string | null | undefined, isUser: boolean, isMain: boolean) => {
    const k = name.toLowerCase();
    if (!name || seen.has(k)) return;
    seen.add(k);
    const first = name.split(/\s+/)[0]!;
    const last = name.split(/\s+/).length > 1 ? name.split(/\s+/).at(-1)! : "";
    const titled = /^(mr|mrs|ms|miss|dr|lady|lord|ser|sir|captain|old|maester|king|queen|prince|princess)\.?$/i.test(first);
    const names = [name, ...aliases, titled ? "" : first, titled && last ? `${first} ${last}` : ""].filter((n) => n && n.length > 1);
    out.push({ key, name, names: [...new Set(names)], color: isUser ? voiceColor(name, color ?? USER_COLOR) : voiceColor(name, color), isUser, isMain });
  };
  if (data) {
    for (const c of Object.values(data.state.chars)) {
      const prof = data.profiles[c.name.toLowerCase()];
      add(c.id, c.isUser ? data.userName : c.name, c.aliases ?? [], prof?.color, c.isUser, c.isMain);
    }
  }
  for (const e of extra) add(`x:${e.name}`, e.name, [], null, Boolean(e.isUser), !e.isUser);
  return out;
}

const WHISPER = /\b(whisper|murmur|mutter|breathe|hiss|mumble|sigh)\w*/i;
const LOUD = /\b(shout|yell|call(?:ed|s)? out|bellow|roar|scream|holler|bark|snap|louder|aloud)\w*/i;

/** Whichever manner word comes last wins: "she muttered, then louder, “…”" is loud. */
function texture(how: string): "whisper" | "loud" | null {
  const w = [...how.matchAll(new RegExp(WHISPER.source, "gi"))].at(-1)?.index ?? -1;
  const l = [...how.matchAll(new RegExp(LOUD.source, "gi"))].at(-1)?.index ?? -1;
  return w < 0 && l < 0 ? null : w > l ? "whisper" : "loud";
}
const SPEECH = /\b(said|says|say|ask(?:ed|s)?|repl(?:ied|ies|y)|answer(?:ed|s)?|whisper\w*|murmur\w*|mutter\w*|shout\w*|yell\w*|call(?:ed|s)?|bellow\w*|roar\w*|snap(?:ped|s)?|hiss\w*|breathe[sd]?|laugh(?:ed|s)?|sigh(?:ed|s)?|added|adds|continu\w+|insist\w*|told|tells|offer\w*|began|begins|went on|goes on)\b/i;
const PRONOUN = /^(he|she|they|it|his|her|their)\b/i;

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

export function attribute(root: HTMLElement, voices: Voice[], style: VoiceStyle) {
  root.dataset.voices = style;
  if (style === "off" || !voices.length) {
    for (const s of root.querySelectorAll<HTMLElement>(".dl[data-v]")) s.removeAttribute("data-v");
    return;
  }
  // Longest names first, so "Wren Halloway" wins over "Wren"; capitalised names only (avoid "rose", "will").
  const pairs = voices.flatMap((v) => v.names.map((n) => [n, v] as const)).sort((a, b) => b[0].length - a[0].length);
  const escaped = pairs.map(([n]) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const nameRe = new RegExp(`\\b(${escaped.join("|")})(?:'s)?\\b|\\b(you|You)\\b`, "g");
  const byName = new Map(pairs.map(([n, v]) => [n, v]));
  const user = voices.find((v) => v.isUser);
  const main = voices.find((v) => v.isMain && !v.isUser) ?? voices.find((v) => !v.isUser);

  const named = (text: string): Voice[] => {
    const out: Voice[] = [];
    for (const m of text.matchAll(nameRe)) {
      const v = m[1] ? byName.get(m[1]) : user;
      if (v) out.push(v);
    }
    return out;
  };

  let lastSpeaker: Voice | undefined;
  let prevSpeaker: Voice | undefined;
  let lastMentioned: Voice | undefined;

  const blocks = Array.from(root.querySelectorAll("p, li, blockquote, td")).filter((b) => !b.closest(".art") && !b.querySelector("p, li"));
  for (const block of blocks) {
    const segs = segmentsOf(block);
    let blockSpeaker: Voice | undefined;
    let leads: Voice | undefined;
    segs.forEach((seg, i) => {
      if (!seg.span) {
        const ns = named(seg.text).filter((v) => !v.isUser);
        if (ns.length) lastMentioned = ns.at(-1);
        return;
      }
      if (seg.span.closest(".art")) return;
      const before = (segs[i - 1] && !segs[i - 1]!.span ? segs[i - 1]!.text : "").trim();
      const after = (segs[i + 1] && !segs[i + 1]!.span ? segs[i + 1]!.text : "").trim();
      // The tag right after: ', Wren said' / ' she muttered' / ' said Pell'.
      const tail = after.split(/[.!?;:]\s/)[0]!.slice(0, 80);
      const head = before.split(/(?<=[.!?])\s+/).at(-1)!.slice(-160);
      let who: Voice | undefined;
      // The tag after the line says how it was said; failing that, the beat before it.
      // A shared tag splits at "then"/"and": "she muttered, then louder," gives the first line the
      // muttering and the next one the "louder".
      const how = SPEECH.test(tail) ? tail.split(/,\s*(?:then|and|but|before)\b/i)[0]! : /[:,]$/.test(head) || SPEECH.test(head) ? head.split(/,\s*(?:then|and|but)\b/i).at(-1)! : "";
      const tailNames = named(tail);
      if (tailNames.length && (SPEECH.test(tail) || tail.length < 30)) who = tailNames[0];
      else if (PRONOUN.test(tail) && SPEECH.test(tail)) who = /^they/i.test(tail) ? (lastMentioned ?? blockSpeaker) : (lastMentioned ?? blockSpeaker ?? lastSpeaker);
      if (!who) {
        // An action beat before the line: "Wren's hand stilled on the brass. “…”"
        const headNames = named(head);
        if (headNames.length) who = headNames.at(-1);
        else if (PRONOUN.test(head)) who = lastMentioned ?? blockSpeaker;
      }
      if (!who && blockSpeaker) who = blockSpeaker;
      if (!who && lastSpeaker && prevSpeaker && lastSpeaker !== prevSpeaker) who = prevSpeaker; // back and forth
      if (!who) who = main;
      if (!who) return;
      const tex = texture(how);
      seg.span.dataset.v = who.key;
      seg.span.style.setProperty("--vc", who.color);
      seg.span.classList.toggle("v-whisper", tex === "whisper");
      seg.span.classList.toggle("v-loud", tex === "loud");
      seg.span.title = who.name;
      blockSpeaker = who;
      leads ??= who;
      if (!who.isUser) lastMentioned = who;
    });
    if (blockSpeaker) {
      if (blockSpeaker !== lastSpeaker) {
        prevSpeaker = lastSpeaker;
        lastSpeaker = blockSpeaker;
      }
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

/** use:voices={{ html, voices, style }}: re-reads the speakers whenever the text changes. */
export const voices: Action<HTMLElement, { html: string; voices: Voice[]; style: VoiceStyle }> = (node, p) => {
  let last = "";
  const run = (q: typeof p) => {
    const key = `${q.html.length}:${q.html.slice(0, 64)}:${q.style}:${q.voices.map((v) => v.key + v.color).join()}`;
    if (key === last) return;
    last = key;
    // After Svelte has placed the new html (and the glossary pass has run).
    queueMicrotask(() => attribute(node, q.voices, q.style));
  };
  run(p);
  return { update: run };
};
