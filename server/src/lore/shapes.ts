import { CATEGORY_INFO, type Category } from "./format";
import { slotDef, VOICE_SLOTS } from "./slots";
import type { LoreEntry } from "./types";

/**
 * Writing by kind (docs/17, Part 3). Each kind has a brief (what the writer is writing, and how),
 * and some have a shape: named parts the writer returns, so the checks can read them and a
 * re-write can steer one. The parts are joined into the entry's text with the kind's layout (prose
 * for most; short labelled lines where a list is clearer). Kinds with a hidden truth keep it in
 * the entry's secrets, never in the open text. On save, a kind sets what fires the entry.
 */

export type Parts = Record<string, string | string[]>;

/** One part of a kind's shape: its key, what goes in it, and whether it's a list. */
export interface PartSpec {
  key: string;
  ask: string;
  list?: boolean;
}

const P = (key: string, ask: string, list = false): PartSpec => ({ key, ask, ...(list ? { list: true } : {}) });

/** The kinds that return parts, and what each part holds. Other kinds are prose, covering their fields. */
export const SHAPES: Partial<Record<Category, PartSpec[]>> = {
  timeline: [P("as of", "the moment the story stands at, in one line"), P("already happened", "the named events that have happened, oldest first", true), P("not yet", "the named events that haven't happened yet and mustn't be treated as past", true)],
  power: [P("source", "where it comes from"), P("can", "what it can do, one each", true), P("cannot", "what it can't do, one each", true), P("cost", "what using it costs"), P("who", "who has it")],
  voice: [
    P("register", "formal, plain, street… in a few words"),
    P("rhythm", "how their sentences run, in a few words"),
    P("vocabulary", "the words they reach for"),
    P("pet names", "what they call {{user}}, one each (can be empty)", true),
    P("catchphrases", "things they say, one each (can be empty)", true),
    P("swearing", "how they swear, or that they don't"),
    P("greeting", "how they say hello, as they'd say it"),
    P("goodbye", "how they say goodbye, as they'd say it"),
    P("never says", "words they'd never use, one each", true),
    P("shifts", "how it changes with {{user}}, with strangers, angry, scared, lying: one line each", true),
    P("sample lines", "3–5 new lines of speech in their voice, each \"mood: the line\"", true),
  ],
  reaction: [P("trigger", "the topic or moment that sets it off"), P("does", "what they do"), P("says", "a line they might say, in their voice"), P("why", "why, in one clause")],
  belief: [P("who", "who believes it"), P("belief", "what they believe, as they'd put it"), P("strength", "how strongly"), P("truth", "what's actually true (kept from the open text)")],
  secret: [P("open", "what anyone can see or has heard"), P("truth", "the secret itself (kept from the open text)"), P("kept from", "who it's kept from", true), P("if out", "what happens if it comes out")],
  mystery: [P("question", "the open question, as the characters would ask it"), P("truth", "the answer (kept from the open text)"), P("clues", "clues a scene can find, one each", true), P("red herrings", "false leads, one each", true), P("hiding", "who's hiding what")],
  lexicon: [P("terms", "each term as \"term: what it means\"", true), P("who says them", "who uses these words")],
  money: [P("coins", "each coin or note as \"name: what it's worth\"", true), P("prices", "what common things cost, each \"thing: price\"", true), P("scarce", "what's scarce or dear"), P("markets", "where trade happens")],
  routine: [P("schedule", "each line \"time: who, where\"", true), P("breaks", "what breaks the routine")],
  current: [P("happening", "what's happening right now"), P("who", "who is doing it, and to whom"), P("where", "where"), P("wants", "what each side wants"), P("next", "what happens next if nobody steps in")],
};

/** Kinds whose truth is a kept secret: the part that holds it. */
export const HIDDEN_PART: Partial<Record<Category, string>> = { belief: "truth", secret: "truth", mystery: "truth" };

/** What the writer is writing, by kind: specific instructions beyond the fields. */
export const KIND_BRIEF: Partial<Record<Category, string>> = {
  timeline: "This entry is the timeline boundary: always in the prompt, so keep it tight. Say where the story stands and list the named events that haven't happened yet, so the storyteller neither spoils nor skips them.",
  rule: "This entry is a rule that must always hold: state it plainly, why it holds, and its exceptions. Short.",
  power: "This entry is a power (a magic, technology or ability): how it works in a scene, what it costs, and the limits a storyteller must respect.",
  ooc: "This entry is a note to the writer, out of character: style, pacing, point of view, limits. Imperative, short, no story content.",
  voice: "This entry is how one person talks, written to be imitated. \"content\" is two sentences on the sound of them (rhythm, register, what they reach for), not adjectives about them; the sample lines carry the rest. Don't repeat the pet names, catchphrases, greeting or goodbye in the content: they go to the storyteller on their own. The sample lines are new lines in their voice, never quotes from a source.",
  relationship: "This entry is what's between two people: how they met, what each is to the other, the tension, and where it stands right now. Name both by their exact titles.",
  family: "This entry is a household or bloodline: its members with their roles, who leads it, how they get on, and the feuds.",
  moment: "This entry is one remembered moment two people share: when, where, what happened and what was said, and what it means to each of them now. Write it so mentioning it brings it all back.",
  reaction: "This entry is one reaction: when the trigger comes up, what the person does and says, and why. One trigger, one behaviour. Keys are the trigger's words, never the person's name.",
  belief: "This entry is a belief: who holds it and how strongly. The open text says what they believe and how it shows; what's actually true goes only into \"secrets\".",
  secret: "This entry is a secret. The open text says only what can be seen or has been heard; the secret itself goes only into \"secrets\", with who keeps it.",
  location: "This entry is a place: what it looks, sounds and smells like, who's there, what can happen there.",
  faction: "This entry is a group: who they are, what they want, who leads, how they work, and who they're against.",
  species: "This entry is a people or creature: body, mind, culture, how others see them, what's dangerous about them.",
  item: "This entry is an object: how it looks, what it does, where it came from, who has it now.",
  faith: "This entry is a faith: what's worshipped, its clergy and rites, the oaths and curses people actually say.",
  customs: "This entry is a custom: what people do, when, who, and what breaking it means.",
  lexicon: "This entry is the world's words: terms a scene can use, each with its meaning, and who says them. Keys are the terms themselves.",
  money: "This entry is money and trade: the coins and what they're worth, what common things cost, what's scarce.",
  climate: "This entry is the climate here: the seasons, the weather now, and what the weather changes about daily life.",
  history: "This entry is history: what happened, when, who was involved, and what it left behind that a scene can still touch.",
  current:
    "This entry is a situation under way right now, at the story's opening: say what is happening, who is doing it and to whom, where, what it looks and sounds like, what each side wants, and what happens next if nobody steps in. Present tense throughout; no backstory beyond one clause of why. The storyteller keeps it in every scene until the story moves past it, so write it to be played: things people can run from, fight or walk into.",
  upcoming: "This entry is something coming: what, roughly when, the signs a storyteller can drop, and who knows. Never as if it has happened.",
  hook: "This entry is a hook: an opening a scene can pick up. The setup, who offers it, what's at stake, and where it could lead.",
  mystery: "This entry is a mystery. The open text asks the question and lays out what can be found (the clues, and a false lead or two); the answer goes only into \"secrets\", with who knows it.",
  routine: "This entry is a routine: who is where, when, as a schedule a storyteller can place people by, and what breaks it.",
  scene: "This entry guides one kind of scene while it lasts: when it applies, how to write it, what to keep track of, and how it ends.",
};

/** The writer's word target for a kind: the chosen length, scaled ("90–170" × 0.5 → "45–85"). */
export function wordsFor(range: string, kind: Category | null): string {
  const scale = kind ? CATEGORY_INFO[kind].lengthScale : 1;
  if (scale === 1) return range;
  const [lo, hi] = range.split("–").map(Number);
  return `${Math.round((lo! * scale) / 5) * 5}–${Math.round((hi! * scale) / 5) * 5}`;
}

/** The writer's line asking for a kind's parts. */
export function partsAsk(kind: Category): string {
  const spec = SHAPES[kind];
  if (!spec) return "";
  return `"parts": an object with these keys${spec.some((s) => s.list) ? " (a list where it says so)" : ""}: ${spec.map((s) => `"${s.key}"${s.list ? " [list]" : ""} (${s.ask})`).join("; ")}.`;
}

const list = (v: string | string[] | undefined) => (Array.isArray(v) ? v : v ? [v] : []).map((x) => String(x).trim()).filter(Boolean);
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v.join("; ") : (v ?? "")).trim();

/** Only the kind's parts, cleaned (lists as lists, the rest as text). */
export function cleanParts(kind: Category | null, raw: unknown): Parts {
  const spec = kind ? SHAPES[kind] : undefined;
  if (!spec || !raw || typeof raw !== "object") return {};
  const r = raw as Record<string, string | string[]>;
  const out: Parts = {};
  for (const s of spec) {
    const v = r[s.key];
    if (s.list) {
      const xs = list(v);
      if (xs.length) out[s.key] = xs;
    } else if (one(v)) out[s.key] = one(v);
  }
  return out;
}

/** "mood: the line" → a quoted line with its mood. */
const sample = (s: string) => {
  const m = s.match(/^\s*([a-z][\w ,'-]{0,24}):\s*(.+)$/i);
  const line = (m ? m[2]! : s).trim().replace(/^["“]|["”]$/g, "");
  return m ? `“${line}” (${m[1]!.trim().toLowerCase()})` : `“${line}”`;
};

/**
 * The entry's text from its prose and its parts, by kind. Prose kinds keep the prose; kinds where
 * a list reads better add short labelled lines. A hidden part (a secret's truth) is never added.
 */
export function joinParts(kind: Category | null, content: string, parts: Parts): string {
  const prose = content.trim();
  if (!kind || !Object.keys(parts).length) return prose;
  const lines = (label: string, key: string) => (list(parts[key]).length ? `${label}: ${list(parts[key]).join("; ")}.` : "");
  const add = (...xs: string[]) => [prose, ...xs].filter(Boolean).join("\n");
  switch (kind) {
    case "voice":
      return add(list(parts["sample lines"]).length ? `Sounds like: ${list(parts["sample lines"]).map(sample).join(" ")}` : "");
    case "timeline":
      return [one(parts["as of"]) ? `As of: ${one(parts["as of"])}` : prose, lines("Already happened", "already happened"), lines("Not yet (don't treat as past)", "not yet")].filter(Boolean).join("\n");
    case "lexicon":
      return add(...list(parts.terms).map((t) => `- ${t}`));
    case "money":
      return add(lines("Coins", "coins"), lines("Prices", "prices"));
    case "routine":
      return add(...list(parts.schedule).map((t) => `- ${t}`), one(parts.breaks) ? `What breaks it: ${one(parts.breaks)}` : "");
    case "mystery":
      return add(lines("Clues", "clues"), lines("False leads", "red herrings"));
    case "power":
      return add(lines("Can", "can"), lines("Can't", "cannot"));
    default:
      return prose;
  }
}

/** A kind's hidden truth from its parts, as a secret with its keepers (when the writer didn't give one). */
export function hiddenSecret(kind: Category | null, parts: Parts, keepers: string[]): { text: string; knownBy: string[] } | null {
  const key = kind ? HIDDEN_PART[kind] : undefined;
  const text = key ? one(parts[key]) : "";
  return text ? { text, knownBy: keepers } : null;
}

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, " ").replace(/\s+/g, " ").trim();

/** Whether the open text gives away a secret (most of its words, in it). */
export function textGivesAway(content: string, secret: string): boolean {
  const words = [...new Set(norm(secret).split(" ").filter((w) => w.length >= 4))];
  if (words.length < 3) return false;
  const text = ` ${norm(content)} `;
  return words.filter((w) => text.includes(` ${w} `)).length / words.length >= 0.75;
}

/** Lexicon terms (the part before ":" or a dash). */
export const termsOf = (parts: Parts) => list(parts.terms).map((t) => t.split(/\s*(?::|—|–| - )\s*/)[0]!.trim()).filter((t) => t.length >= 2 && t.length <= 40);

/**
 * What fires a saved entry of this kind (docs/17, 3.4): always on; its names; its meaning too; its
 * subject being in the scene (a voice, keyed and linked to the person); its topic's words, only
 * with its subject (a reaction); a lexicon's terms; a relationship's two names together.
 */
export function withFiring(e: LoreEntry, kind: Category, subjects: { name: string; aliases: string[] }[], parts: Parts): LoreEntry {
  const info = CATEGORY_INFO[kind];
  const extra: Record<string, unknown> = { ...e.extra };
  const namesOf = (s: { name: string; aliases: string[] }) => [s.name, ...s.aliases];
  const lower = (xs: string[]) => new Set(xs.map((x) => x.toLowerCase()));
  const [a, b] = subjects;
  let keys = e.keys;
  let secondaryKeys = e.secondaryKeys;
  let logic = e.logic;
  let constant = e.constant;
  if (info.fires === "always" && kind !== "current") constant = true;
  if (info.fires === "meaning") extra.semantic = true;
  if (info.fires === "subject" && a) {
    keys = [...new Set(namesOf(a))];
    extra.entity = a.name;
  }
  if (kind === "relationship" && a && b) {
    keys = [...new Set(namesOf(a))];
    secondaryKeys = [...new Set(namesOf(b))];
    logic = "and_any";
  }
  if (info.fires === "topic" && a && info.subject === "one") {
    // The topic's words, and only with its person around: never the person's own name as a key.
    const own = lower(namesOf(a));
    keys = keys.filter((k) => !own.has(k.toLowerCase()));
    secondaryKeys = [...new Set(namesOf(a))];
    logic = "and_any";
    extra.entity = a.name;
  }
  if (info.fires === "topic" && info.subject === "two" && subjects.length) {
    // A shared moment fires on its own words ("the dark lamp"), never on a name that's in every scene.
    const own = lower(subjects.flatMap((x) => [...namesOf(x), ...x.name.split(/\s+/)]));
    const kept = keys.filter((k) => !own.has(k.toLowerCase()));
    if (kept.length) keys = kept;
  }
  if (kind === "lexicon") {
    const terms = termsOf(parts);
    if (terms.length) keys = [...new Set([...terms, ...keys])].slice(0, 30);
  }
  return { ...e, keys, secondaryKeys, logic, constant, extra };
}

// ---------- voices that hold (docs/17, Part 4) ----------

/** A value that says there's nothing ("none", "-", "n/a"). */
const EMPTY = /^(?:none|nothing|n\/?a|-+|—|no|\(none\)|not applicable|doesn't|does not)\.?$/i;
const PRONOUN = /\b(?:i|i'm|i'll|i've|i'd|me|my|mine|we|us|our|you|you're|you'll|your|yours|it|it's|that|this|there|here|let's|don't|can't|won't)\b/i;

/** Words that describe a voice: adjective endings, and the plain ones people use for voices. */
const DESCRIBING = /(?:y|ly|ful|ous|ive|ish|ed|ing|al|ic|less|ent|ant|able|ible)$|^(?:warm|soft|low|gruff|dry|flat|sharp|cold|quiet|loud|slow|fast|terse|curt|harsh|gentle|calm|rough|smooth|sweet|blunt|crisp|deep|high|kind|bold|shy|proud|stern|wry|arch|coy)$/i;

/** The words of a sample line, its mood dropped ("teasing: You'll want boots" → "You'll want boots"). */
const lineOf = (s: string) => (s.match(/^\s*[a-z][\w ,'-]{0,24}:\s*(.+)$/i)?.[1] ?? s).trim().replace(/^["“]|["”]$/g, "");

/** A line that's only describing words ("warm, gruff and teasing"), not something anyone would say. */
export function onlyAdjectives(line: string): boolean {
  const t = lineOf(line);
  if (!t || /[?!]/.test(t) || PRONOUN.test(t)) return false;
  const words = t.replace(/[.,;]/g, " ").split(/\s+/).filter(Boolean);
  const bits = t.replace(/\.$/, "").split(/\s*(?:,|;|\band\b|\bbut\b)\s*/i).filter(Boolean);
  const describing = bits.filter((b) => DESCRIBING.test(b.split(/\s+/).pop()!));
  return words.length <= 8 && bits.length >= 2 && bits.every((b) => b.split(/\s+/).length <= 2) && describing.length * 2 >= bits.length;
}

/** What a Voice draft is missing: three sample lines, and lines that are speech, not adjectives. */
export function voiceProblems(parts: Parts): string[] {
  const lines = list(parts["sample lines"]);
  const out: string[] = [];
  if (lines.length < 3) out.push(lines.length ? `Only ${lines.length} sample line${lines.length > 1 ? "s" : ""}; three or more, in different moods, make the voice hold.` : "No sample lines: the storyteller needs three or more to imitate.");
  const flat = lines.filter(onlyAdjectives);
  if (flat.length) out.push(`${flat.map((l) => `“${lineOf(l)}”`).join(", ")} describe${flat.length > 1 ? "" : "s"} the voice instead of using it. Write what they'd say.`);
  return out;
}

/**
 * The voice slots a Voice entry's parts fill (4.2): pet names, catchphrases, swearing, greeting,
 * goodbye and words they'd never use, one value each (a list slot gets one per item).
 */
export function voiceSlotValues(parts: Parts): { slot: string; value: string }[] {
  const out: { slot: string; value: string }[] = [];
  for (const slot of VOICE_SLOTS) {
    const values = slotDef(slot)?.list ? list(parts[slot]) : [one(parts[slot])];
    for (const v of values) {
      let value = v.replace(/^["“]|["”]$/g, "").replace(/\s+/g, " ").trim().slice(0, 200);
      // "Swearing: none" says something (they don't); an empty pet name says nothing.
      if (slot === "swearing" && EMPTY.test(value)) value = "doesn't swear";
      if (value && !EMPTY.test(value) && !out.some((x) => x.slot === slot && x.value.toLowerCase() === value.toLowerCase())) out.push({ slot, value });
    }
  }
  return out;
}
