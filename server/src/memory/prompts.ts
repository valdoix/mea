import { z } from "zod";

/**
 * Service prompts and output schemas for the memory helpers. Outputs are validated (ARCH-05)
 * and lenient about missing lists so a slightly short reply still parses.
 */

export const ATOM_TYPES = ["event", "fact", "trait", "preference", "promise", "secret", "quote", "plan", "relationship"] as const;
export type AtomType = (typeof ATOM_TYPES)[number];

const list = z.array(z.string()).default([]);

export const sceneSchema = z.object({
  title: z.string().min(1),
  summary: z.string().min(1),
  events: list,
  decisions: list,
  stateChanges: list,
  relationshipShifts: list,
  threadsOpened: list,
  threadsClosed: list,
  quotes: z.array(z.object({ speaker: z.string(), text: z.string(), seq: z.coerce.number().optional() })).default([]),
  storyTime: z.string().default(""),
  locations: list,
  participants: list,
  importance: z.coerce.number().default(5),
  memories: z
    .array(
      z.object({
        type: z.string().default("fact"),
        content: z.string().min(1),
        entities: list,
        importance: z.coerce.number().default(5),
        emotions: list,
        sources: z.array(z.coerce.number()).default([]),
        knownBy: list,
        supersedes: list,
        confidence: z.coerce.number().default(0.9),
      }),
    )
    .default([]),
});
export type SceneOutput = z.infer<typeof sceneSchema>;

export const verifySchema = z.object({
  verdict: z.enum(["ok", "minor", "major"]).catch("minor"),
  unsupported: z.array(z.object({ claim: z.string(), reason: z.string().default("") })).default([]),
  omissions: z.array(z.object({ what: z.string(), seq: z.coerce.number().optional() })).default([]),
});
export type VerifyOutput = z.infer<typeof verifySchema>;

export const rollupSchema = z.object({
  title: z.string().min(1),
  summary: z.string().min(1),
  keyQuotes: z.array(z.object({ speaker: z.string(), text: z.string() })).default([]),
  openThreads: list,
  storyTime: z.string().default(""),
  importance: z.coerce.number().default(5),
});
export type RollupOutput = z.infer<typeof rollupSchema>;

export const boundarySchema = z.object({ newScene: z.boolean(), reason: z.string().default("") });

const VOICE = "Write in past tense, third person, as a neutral record. Use names, never \"you\" or \"I\".";
const PRESERVE = "Preserve exactly, never paraphrased: names, nicknames, numbers, dates, times, amounts, codes, addresses, promises, and key lines of dialogue.";

export function sceneSystem(names: { char: string; user: string }) {
  return `You are the archivist of an ongoing roleplay story between ${names.char} and ${names.user} (${names.user} is the player's character). You read one finished scene and record it precisely, so the story can be remembered thousands of messages later.

Rules:
- ${VOICE}
- ${PRESERVE}
- Record only what the scene actually shows. Don't guess motives or add events.
- "summary": one compact paragraph (60–160 words) of what happened, in order.
- "events", "decisions", "stateChanges" (injuries, outfits, possessions, location, time), "relationshipShifts", "threadsOpened" (new mysteries, plans, promises), "threadsClosed": short phrases, empty lists when nothing applies.
- "quotes": up to 4 lines worth remembering, copied word for word, each with the [#number] it comes from as "seq".
- "storyTime": the in-story time span if the scene shows it (e.g. "Day 3, evening → night"), else "".
- "memories": atomic, self-contained notes that will matter later, one idea each, written so they make sense alone (use names). Types: ${["event", "fact", "trait", "preference", "promise", "secret", "quote", "plan", "relationship"].join(", ")}. Each cites the [#numbers] it comes from in "sources". "importance" 1–10 (10 = life-changing, 1 = trivia); skip small talk. "knownBy": who knows it (important for secrets). "entities": the people, places, and things involved.
- If a new memory updates or contradicts one of the EXISTING MEMORIES you're shown, put that memory's id (like "A3") in its "supersedes" list.
- "importance": how much this scene matters to the whole story, 1–10.

Reply with one JSON object only, shaped like:
{"title":"…","summary":"…","events":[],"decisions":[],"stateChanges":[],"relationshipShifts":[],"threadsOpened":[],"threadsClosed":[],"quotes":[{"speaker":"…","text":"…","seq":0}],"storyTime":"","locations":[],"participants":[],"importance":5,"memories":[{"type":"fact","content":"…","entities":[],"importance":5,"emotions":[],"sources":[0],"knownBy":[],"supersedes":[],"confidence":0.9}]}`;
}

export function verifySystem() {
  return `You check a scene record against the scene's source messages.
List:
1. "unsupported": statements in the record (summary or memories) that the source doesn't support: wrong names or numbers, invented events, wrong person doing something, wrong order. Quote the claim and say why.
2. "omissions": important things in the source the record leaves out: promises, secrets, decisions, injuries, gifts, names, revealed facts. Give the [#number] where it happens.
Be strict about facts and relaxed about wording and style.
"verdict": "ok" (no problems), "minor" (small omissions only), or "major" (any unsupported claim, or an important omission).
Reply with one JSON object only: {"verdict":"ok","unsupported":[{"claim":"…","reason":"…"}],"omissions":[{"what":"…","seq":0}]}`;
}

const WORDS: Record<string, number> = { chapter: 260, arc: 380, story: 650 };

export function rollupSystem(level: "chapter" | "arc" | "story", names: { char: string; user: string }) {
  const what = level === "story" ? "the whole story so far" : `one ${level} of the story`;
  return `You condense ${what} — an ongoing roleplay between ${names.char} and ${names.user} — from the records of its parts, given oldest first.
Rules:
- Keep the through-line: what happened, what changed, who wants what, what was promised, and what is still unresolved.
- ${VOICE}
- ${PRESERVE}
- Don't add anything the records don't say. Later records win over earlier ones where they differ.
- "summary": about ${WORDS[level]} words.${level === "story" ? " Open with the premise, then tell the story in order, then where things stand now." : ""}
- "title": a short, evocative ${level === "story" ? "title for the story" : `${level} title`} (2–6 words).
- "keyQuotes": up to 3 lines that define this part, word for word from the records.
- "openThreads": unresolved threads, promises, and mysteries still alive at the end.
- "storyTime": the in-story time span covered, if known.
- "importance": 1–10.
Reply with one JSON object only: {"title":"…","summary":"…","keyQuotes":[{"speaker":"…","text":"…"}],"openThreads":[],"storyTime":"","importance":5}`;
}

export function boundarySystem() {
  return `You help split a roleplay story into scenes. Decide whether the NEW message starts a new scene — a jump in time or place, or a clearly new situation — rather than continuing the current one. A pause in the conversation alone is not a new scene. Reply with JSON only: {"newScene":true,"reason":"…"}`;
}

export function normalizeType(t: string): AtomType {
  const x = t.toLowerCase().trim();
  return (ATOM_TYPES as readonly string[]).includes(x) ? (x as AtomType) : x.startsWith("relat") ? "relationship" : x.startsWith("prom") ? "promise" : "fact";
}

export const clampInt = (n: unknown, lo: number, hi: number, fallback: number) => {
  const v = Math.round(Number(n));
  return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : fallback;
};

/** Renders a scene record to compact prose for the prompt (SUM-04). */
export function renderScene(s: SceneOutput) {
  const parts = [s.summary.trim()];
  if (s.quotes.length) parts.push(`Key lines: ${s.quotes.map((q) => `"${q.text.trim()}" (${q.speaker})`).join(" · ")}`);
  if (s.threadsOpened.length) parts.push(`Left open: ${s.threadsOpened.join("; ")}`);
  return parts.join("\n");
}

export function renderRollup(r: RollupOutput) {
  const parts = [r.summary.trim()];
  if (r.keyQuotes.length) parts.push(`Key lines: ${r.keyQuotes.map((q) => `"${q.text.trim()}" (${q.speaker})`).join(" · ")}`);
  if (r.openThreads.length) parts.push(`Still open: ${r.openThreads.join("; ")}`);
  return parts.join("\n");
}
