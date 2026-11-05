import { z } from "zod";
import { pageText, searchWiki, type Wiki, wikisFor } from "../creator/research";
import { callJson } from "../services/llm";
import { type Direction, directionSchema, minorIn, statedAge } from "./compile";
import { emptyLook, getLook, type Look, LOOK_FIELDS, type LookField, type LookOwner, type LookSource, MEDIA, ownerText, setLine } from "./look";

/**
 * The prompt writer (docs/28 §3): your idea in your words → who that is and how they look (the
 * read-back, each line with where it came from) → three directions for the picture. The prompt
 * itself is put together by code (compile.ts), never rewritten by a model.
 */

// ---------- 1. reading the idea ----------

const ideaSchema = z.object({
  /** Who the idea is about: a name, or a short label for an original ("a lighthouse keeper"). */
  subject: z.string().max(160).default(""),
  /** The work a known character comes from ("" for an original). */
  work: z.string().max(160).default(""),
  medium: z.enum(MEDIA).catch("original").default("original"),
  /** Their usual age in that work, when it's known (the canon figure, not the idea's). */
  canonAge: z.number().nullable().catch(null).default(null),
  /** An era or point in the story the idea or the age points to ("the college years, seasons 4–5"). */
  era: z.string().max(200).default(""),
  /** What the idea itself says about how they look, by Look line, in the idea's own words. */
  stated: z.record(z.string(), z.union([z.string(), z.array(z.string())])).default({}),
  /** What the idea asks to change, for a person who already exists ("at 40", "in winter armour"). */
  change: z.string().max(300).default(""),
});
export type IdeaReading = z.infer<typeof ideaSchema>;

const IDEA_SYSTEM = `You read a short idea for a picture of a person, written by the author in their own words (often just a name and an age), and say who it is about.
- subject: the person's name, or a short label for someone original.
- work: if the subject is a known character from a film, series, book, comic, anime or game, the work's usual English title. Otherwise "".
- medium: "live-action" for characters played by actors on screen, "animated", "drawn" (comics, manga), "written" (books only), "game", or "original".
- canonAge: the character's usual age in the work, if known, else null.
- era: if the idea's age or wording points to a period of the work, name it briefly ("the college years, seasons 4–5"); else "".
- stated: only what the idea itself says about looks, keyed by these lines: ${LOOK_FIELDS.join(", ")}. Use the author's words. Leave out anything they didn't say.
- change: what the idea asks to change about someone who already exists, else "".
Never name the actors who played a character. Reply with JSON only: {"subject": "", "work": "", "medium": "original", "canonAge": null, "era": "", "stated": {}, "change": ""}`;

export async function readIdea(idea: string, opts: { known?: string; jobId?: string | null } = {}): Promise<IdeaReading> {
  const res = await callJson({
    task: "helper",
    kind: "portrait:idea",
    name: "portrait_idea",
    schema: ideaSchema,
    system: IDEA_SYSTEM,
    user: `${opts.known ? `THE PERSON ALREADY KNOWN: ${opts.known}\n\n` : ""}THE IDEA: ${idea}`,
    maxTokens: 600,
    jobId: opts.jobId,
  });
  return res.data;
}

// ---------- 2. the Look ----------

const lookLines = z.object({
  presentation: z.string().max(60).default(""),
  build: z.string().max(300).default(""),
  height: z.string().max(60).default(""),
  face: z.string().max(300).default(""),
  skin: z.string().max(300).default(""),
  hair: z.string().max(300).default(""),
  eyes: z.string().max(120).default(""),
  marks: z.array(z.string().max(160)).max(8).default([]),
  wears: z.string().max(400).default(""),
  signature: z.array(z.string().max(160)).max(6).default([]),
  expression: z.string().max(160).default(""),
});
const lookReplySchema = z.object({
  /** Lines the sources state, from the author's text, the card, or the canon page. */
  stated: lookLines.prefault({}),
  /** Lines nothing states, filled with a fitting guess. */
  guessed: lookLines.prefault({}),
  /** Real people tied to the character (actors, voice actors, models), to keep out of prompts. */
  realPeople: z.array(z.string().max(80)).max(12).default([]),
});

const LOOK_SYSTEM = `You work out how a person looks, for a portrait. Read the sources and fill these lines briefly, as an illustrator's notes: presentation (one word, e.g. "woman", "man", "androgynous person"), build, height, face, skin, hair (colour, length, style), eyes, marks (scars, tattoos, freckles), wears (their usual clothes, of the era asked for), signature (things always on them), expression (their usual look).
- "stated": only lines the sources say or clearly show. Prefer the canon page over memory, and the author's text over both.
- "guessed": the lines nothing states, filled with what suits the person, so the picture is complete.
- Describe; never name a real person in a line. List in "realPeople" the actors, voice actors or models tied to the character, so they can be kept out.
- Never describe anyone as under 18, and nothing sexual.
Reply with JSON only: {"stated": {...}, "guessed": {...}, "realPeople": []}`;

async function lookFromSources(input: { subject: string; work: string; era: string; age: number | null; idea: string; own: string; canonPage: string; jobId?: string | null }) {
  const user = [
    `THE PERSON: ${input.subject}${input.work ? ` (${input.work})` : ""}`,
    input.age != null ? `AGE IN THE PICTURE: ${input.age}` : "",
    input.era ? `ERA: ${input.era}` : "",
    `THE AUTHOR'S IDEA: ${input.idea}`,
    input.own ? `WHAT THE AUTHOR'S CARD SAYS:\n${input.own}` : "",
    input.canonPage ? `THE CANON PAGE:\n${input.canonPage}` : input.work ? "No canon page was found: use what you know of the work, and put anything unsure in \"guessed\"." : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  const res = await callJson({ task: "helper", kind: "portrait:look", name: "portrait_look", schema: lookReplySchema, system: LOOK_SYSTEM, user, maxTokens: 1200, jobId: input.jobId });
  return res.data;
}

/** The part of a wiki page about looks, when it has one, plus the opening. */
export function appearanceExcerpt(text: string, max = 6000): string {
  // A heading on its own line ("## Appearance", "Physical appearance", "Appearance and Character"),
  // wherever it sits in a long article, up to the next heading. "Appearances" (the episode list) doesn't count.
  const m = text.match(/(?:^|\n)[ \t]*(?:#{1,4}[ \t]*)?(?:Physical[ \t]+)?(?:Appearance|Description|Looks)(?:[ \t]+and[ \t]+[^\n]{1,30})?[ \t]*\n([\s\S]{40,5000}?)(?=\n[ \t]*#{1,4}[ \t]|\n[ \t]*(?:Personality|Biography|History|Powers(?: and abilities)?|Abilities|Relationships|Background|Skills)[ \t]*\n|$)/i);
  const head = text.slice(0, 2000);
  if (m) return `${head}\n\n[Appearance]\n${m[1]!.trim()}`.slice(0, max);
  // No such section: the paragraphs that describe how they look, from anywhere in the page.
  // Hair, eyes or skin with a word describing them ("her violet eyes", "silver-gold hair"), not "in his eyes".
  const LOOKS =
    /\b(?:(?:her|his|their)\s+(?:[\w-]+,?\s+){1,3}(?:hair|eyes|complexion|skin|beard)|(?:silver|golden|gold|blonde?|red|auburn|copper|black|brown|grey|gray|white|dark|fair|pale|olive|violet|blue|green|hazel)[\w-]*\s+(?:[\w-]+\s+)?(?:hair|eyes|skin|complexion))\b/i;
  const described: string[] = [];
  let room = 3500;
  for (const para of text.slice(2000).split(/\n{2,}/)) {
    const p = para.trim();
    if (p.length < 60 || p.length > 1200 || p.startsWith("#") || !LOOKS.test(p) || p.length > room) continue;
    described.push(p);
    room -= p.length;
    if (room < 200) break;
  }
  return (described.length ? `${head}\n\n[How they look, from the page]\n${described.join("\n\n")}` : text).slice(0, max);
}

/**
 * Which search hit is the character's own page: their exact title, else one without a qualifier
 * ("Buffy Summers", not "Buffy Summers (Wishverse)"), else the first that names them.
 */
export function pickCanonTitle(subject: string, hits: string[]): string | null {
  const q = subject.trim().toLowerCase();
  const bare = (h: string) => h.replace(/\s*\([^)]*\)\s*$/, "").trim().toLowerCase();
  return hits.find((h) => h.toLowerCase() === q) ?? hits.find((h) => h.toLowerCase().startsWith(q) && !/\(/.test(h)) ?? hits.find((h) => bare(h) === q) ?? hits.find((h) => h.toLowerCase().includes(q)) ?? null;
}

export interface Question {
  id: string;
  text: string;
  why: string;
  suggestions: string[];
}

export interface ReadBack {
  look: Look;
  reading: IdeaReading;
  /** Canon pages the Look was read from. */
  sources: { title: string; url: string }[];
  realPeople: string[];
  /** At most two, and only when the answer changes the picture. */
  questions: Question[];
  /** Set when the idea can't be drawn (§5): nothing else is filled. */
  refused: string | null;
}

export interface ReadBackDeps {
  /** The canon page for a character; the default looks it up on the work's wiki. */
  canonPage?: (subject: string, work: string) => Promise<{ title: string; url: string; text: string } | null>;
}

/** A long article's description can sit far down (Buffy's is 94,000 characters in). */
const CANON_PAGE_MAX = 250_000;
/** A list of pages sharing a name. A hatnote ("For other uses, see X (disambiguation)") isn't one. */
const isDisambiguation = (text: string) => /\b(?:may|can) (?:also )?refer to\b/i.test(text.slice(0, 800));
const pageUrlOf = (wiki: Wiki, title: string) => `${wiki.base}${encodeURIComponent(title.replace(/ /g, "_"))}`;

/**
 * The character's page: their exact title first (a wiki's search can leave the main page out: on
 * the Buffyverse Wiki, "Buffy Summers" only finds her alternate versions), then the best search hit.
 */
export async function canonPageOn(wikis: Wiki[], subject: string): Promise<{ title: string; url: string; text: string } | null> {
  for (const wiki of wikis) {
    const text = await pageText(wiki, subject, CANON_PAGE_MAX).catch(() => "");
    if (text.length > 400 && !isDisambiguation(text)) return { title: `${subject} (${wiki.name})`, url: pageUrlOf(wiki, subject), text };
    const hit = pickCanonTitle(subject, await searchWiki(wiki, subject, 8).catch(() => []));
    if (!hit) continue;
    const found = await pageText(wiki, hit, CANON_PAGE_MAX).catch(() => "");
    if (found.length > 400 && !isDisambiguation(found)) return { title: `${hit} (${wiki.name})`, url: pageUrlOf(wiki, hit), text: found };
  }
  return null;
}

const defaultCanonPage: NonNullable<ReadBackDeps["canonPage"]> = async (subject, work) => {
  const wikis = await wikisFor(null, work).catch(() => []);
  return wikis.length ? canonPageOn(wikis, subject) : null;
};

/**
 * The read-back (docs/28 §3.2): the Look from, in order, your words, the person's own records
 * (card or persona, then lore slots), canon, and guesses. Your earlier fixes (a saved Look) count
 * as your words.
 */
export async function readBack(input: { idea: string; ownerType?: LookOwner | null; ownerId?: string | null; jobId?: string | null }, deps: ReadBackDeps = {}): Promise<ReadBack> {
  const idea = input.idea.trim();
  const blank = (refused: string): ReadBack => ({ look: emptyLook(), reading: ideaSchema.parse({}), sources: [], realPeople: [], questions: [], refused });
  const minor = minorIn(idea);
  if (minor) return blank(minor);

  const owner = input.ownerType && input.ownerId ? ownerText(input.ownerType, input.ownerId) : null;
  const saved = input.ownerType && input.ownerId ? getLook(input.ownerType, input.ownerId) : null;
  const reading = await readIdea(idea || "just draw them", { known: owner ? `${owner.name}. ${owner.text.slice(0, 600)}` : undefined, jobId: input.jobId });

  const look: Look = saved ? structuredClone(saved) : emptyLook();
  look.name = owner?.name || reading.subject || look.name;
  if (reading.work && reading.medium !== "original") look.canon = { work: reading.work, medium: reading.medium };

  // The age: yours, else the saved one, else canon's when it's an adult one.
  const said = statedAge(idea);
  if (said != null) setLine(look, "age", said, "you");
  // Your words in the idea.
  for (const [k, v] of Object.entries(reading.stated)) if ((LOOK_FIELDS as readonly string[]).includes(k) && k !== "age") setLine(look, k as LookField, v, "you");
  // The person's own records: lore slots are the most exact, then the card's text (read below).
  for (const [k, v] of Object.entries(owner?.lore ?? {})) setLine(look, k as LookField, v, "lore");

  // Canon, for a known character without a card of their own.
  let canon: { title: string; url: string; text: string } | null = null;
  if (look.canon && !owner) canon = await (deps.canonPage ?? defaultCanonPage)(reading.subject, look.canon.work).catch(() => null);

  const ageForLook = look.age ?? (reading.canonAge != null && reading.canonAge >= 18 ? reading.canonAge : null);
  const lines = await lookFromSources({
    subject: look.name || reading.subject,
    work: look.canon?.work ?? "",
    era: reading.era,
    age: ageForLook,
    idea,
    own: owner?.text ?? "",
    canonPage: canon ? appearanceExcerpt(canon.text) : "",
    jobId: input.jobId,
  });
  const statedSource: LookSource = owner ? owner.source : look.canon ? "canon" : "guess";
  for (const [k, v] of Object.entries(lines.stated)) setLine(look, k as LookField, v, statedSource);
  for (const [k, v] of Object.entries(lines.guessed)) setLine(look, k as LookField, v, "guess");

  const questions: Question[] = [];
  if (look.age == null) {
    if (reading.canonAge != null && reading.canonAge >= 18) setLine(look, "age", reading.canonAge, look.canon ? "canon" : "guess");
    else
      questions.push({
        id: "age",
        text: reading.canonAge != null ? `${look.name || "They"} ${reading.canonAge < 18 ? "is under 18 in canon" : "has no clear age"}. How old should they be in the picture?` : `How old should ${look.name || "they"} be?`,
        why: "Mea only draws adults, and the age shapes the face.",
        suggestions: ["18", "21", "25", "30"],
      });
  }
  if (look.canon && !reading.era && said == null && questions.length < 2) {
    questions.push({ id: "era", text: "Which point in the story?", why: "Clothes and hair change across a long-running work.", suggestions: [] });
  }

  const realPeople = [...new Set(lines.realPeople.map((p) => p.trim()).filter(Boolean))];
  return { look, reading, sources: canon ? [{ title: canon.title, url: canon.url }] : [], realPeople, questions, refused: null };
}

// ---------- 3. directions ----------

const directionsSchema = z.object({ directions: z.array(directionSchema).min(1).max(4) });

const DIRECTIONS_SYSTEM = `You offer three genuinely different directions for a portrait of the person described. The person's looks are fixed: don't restate or change them. Each direction sets:
- title (2–5 words), setting (where, one sentence), light (one phrase), framing (e.g. "Waist-up, three-quarter view"), mood (expression and feeling), outfit (only if this picture needs other clothes than their usual ones, else ""), action (what they hold or do, else "").
Make the three differ in place, light and mood; one can be quiet, one dramatic, one candid. If the author gives a steer, follow it in all three.
Never use a person's name, never anyone under 18, nothing sexual.
Reply with JSON only: {"directions": [{"title": "", "setting": "", "light": "", "framing": "", "mood": "", "outfit": "", "action": ""}]}`;

export async function directions(input: { look: Look; idea: string; era?: string; steer?: string; jobId?: string | null }): Promise<Direction[]> {
  const l = input.look;
  const summary = [
    l.age != null ? `${l.age}-year-old ${l.presentation || "person"}` : l.presentation,
    l.build,
    l.hair && `hair: ${l.hair}`,
    l.wears && `usually wears: ${l.wears}`,
    l.signature.length ? `always has: ${l.signature.join(", ")}` : "",
    l.canon ? `from ${l.canon.work}` : "",
  ]
    .filter(Boolean)
    .join("; ");
  const res = await callJson({
    task: "helper",
    kind: "portrait:directions",
    name: "portrait_directions",
    schema: directionsSchema,
    system: DIRECTIONS_SYSTEM,
    user: [`THE PERSON: ${summary}`, `THE IDEA: ${input.idea}`, input.era ? `ERA: ${input.era}` : "", input.steer ? `THE AUTHOR'S STEER: ${input.steer}` : ""].filter(Boolean).join("\n"),
    maxTokens: 900,
    temperature: 0.9,
    jobId: input.jobId,
  });
  return res.data.directions.slice(0, 3);
}
