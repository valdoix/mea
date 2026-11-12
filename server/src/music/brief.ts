import { z } from "zod";
import { callJson } from "../services/llm";
import { LADDER, type WorldState } from "../trackers/types";
import { type Bond, BONDS, type Heat, HEATS, type Stance, STANCES } from "./cards";
import { type Situation, SITUATIONS, situationsOf } from "./situations";

/**
 * The scene brief (docs/34, Part 3): the scene read the same way a song's card reads a song, so the
 * two can be laid side by side. Who the people here are to each other (bond), where the scene stands
 * (stance), how much heat it has, its energy, what's happening (zero to three situations, each strong
 * or slight), and what would grate here. The records say who and how they're tied for free; one
 * helper call reads the last few replies for the rest.
 */

export interface RecordsBrief {
  /** The bond the records settle, or null when they don't. */
  bond: Bond | null;
  /** Someone here is a child (their look, a trait, their role in a family, what they're called). */
  child: boolean;
  /** The ties between the people here, one line each, for the helper. */
  ties: string[];
}

const KIN = /\b(sister|brother|sibling|mother|father|mom|mum|dad|mama|papa|daughter|son|aunt|uncle|cousin|niece|nephew|grand(?:ma|pa|mother|father|daughter|son|child)|stepmother|stepfather|stepdaughter|stepson|half-sister|half-brother|parent|kid sister|kid brother|family)\b/i;
const CHILD_WORDS = "child|kid|toddler|baby|infant|little (?:girl|boy|one)|schoolgirl|schoolboy|grade-?schooler|preschooler";
const AGE_WORDS = "one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve";
/** A child, by the words used of them: "the kid", "a little girl", "seven-year-old", "age 9". */
const CHILD = new RegExp(`\\b(?:${CHILD_WORDS})\\b|\\b(?:[1-9]|1[0-2]|${AGE_WORDS})[- ]years?[- ]old\\b|\\baged? (?:[1-9]|1[0-2])\\b`, "i");
/** "Her daughter" is a role, not an age: only these group roles say child. */
const CHILD_ROLE = new RegExp(`\\b(?:${CHILD_WORDS})\\b`, "i");

const pairKey = (a: string, b: string) => [a, b].sort().join("|");

/**
 * What the records say about the people here, free: couples on the romance ladder, family by a family
 * group or a kin word in a bond's label, a child by how they're described. Two people on the romance
 * ladder alone are romantic; the same two with a sister or a child along are family. One person alone
 * is a scene about themself.
 */
export function recordsBrief(st: WorldState, present: string[]): RecordsBrief {
  const here = [...new Set(present)].slice(0, 8);
  const byName = new Map(Object.values(st.chars ?? {}).map((c) => [c.name.toLowerCase(), c]));
  const idOf = (name: string) => byName.get(name.toLowerCase())?.id ?? name;
  const ids = new Map(here.map((n) => [idOf(n), n]));
  const nameOf = (id: string) => ids.get(id) ?? st.chars?.[id]?.name ?? id;
  const ties: string[] = [];
  const romance = new Set<string>();
  const kin = new Set<string>();
  for (const l of Object.values(st.ladders ?? {})) {
    if (!ids.has(l.from) || !ids.has(l.to) || l.tier < 3) continue;
    const k = pairKey(l.from, l.to);
    if (romance.has(k)) continue;
    romance.add(k);
    ties.push(`${nameOf(l.from)} & ${nameOf(l.to)}: romance, ${LADDER[l.tier] ?? l.tier}`);
  }
  for (const b of Object.values(st.bonds ?? {})) {
    if (!ids.has(b.from) || !ids.has(b.to)) continue;
    const said = [b.label ?? "", ...(b.tags ?? [])].join(" ");
    if (KIN.test(said)) kin.add(pairKey(b.from, b.to));
    if (b.label) ties.push(`${nameOf(b.from)} → ${nameOf(b.to)}: "${b.label}"`);
  }
  let child = false;
  const lower = new Set(here.map((n) => n.toLowerCase()));
  for (const g of Object.values(st.groups ?? {})) {
    const members = (g.members ?? []).filter((m) => m.left == null && lower.has(m.name.toLowerCase()));
    if (members.some((m) => m.role && CHILD_ROLE.test(m.role))) child = true;
    if (members.length < 2) continue;
    const family = g.kind === "family";
    if (family) for (let i = 0; i < members.length; i++) for (let j = i + 1; j < members.length; j++) kin.add(pairKey(idOf(members[i]!.name), idOf(members[j]!.name)));
    if (family || g.kind === "circle") ties.push(`${members.map((m) => (m.role ? `${m.name} (${m.role})` : m.name)).join(", ")}: ${family ? "family" : "friends"}, ${g.name ?? "a group"}`);
  }
  for (const name of here) {
    const c = byName.get(name.toLowerCase());
    const said = [name, ...(c?.aliases ?? []), c?.look ?? "", ...(c?.traits ?? []).map((t) => t.text)].join(" · ");
    if (CHILD.test(said)) child = true;
  }
  const circle = ties.some((t) => t.includes(": friends,"));
  let bond: Bond | null = null;
  if (here.length === 1) bond = "self";
  else if (kin.size && (child || !romance.size || here.length > 2)) bond = "family";
  else if (child && here.length > 1) bond = "family";
  else if (romance.size && here.length === 2) bond = "romantic";
  else if (circle && !romance.size) bond = "friends";
  return { bond, child, ties: ties.slice(0, 10) };
}

export type Strength = "strong" | "slight";
export interface BriefReading {
  gist: string;
  bond: Bond | null;
  stance: Stance | null;
  heat: Heat;
  energy: number | null;
  strong: Situation[];
  slight: Situation[];
  avoid: string[];
  child: boolean;
}

const briefReply = z.object({
  gist: z.string().default(""),
  bond: z.string().nullish(),
  stance: z.string().nullish(),
  heat: z.string().nullish(),
  energy: z.coerce.number().nullish(),
  situations: z.array(z.union([z.string(), z.object({ s: z.string().default(""), strength: z.string().default("strong") })])).default([]),
  avoid: z.array(z.string()).default([]),
  child: z.boolean().default(false),
});

const oneOf = <T extends string>(xs: readonly T[], v: unknown): T | null => {
  const s = String(v ?? "").trim().toLowerCase();
  return (xs as readonly string[]).includes(s) ? (s as T) : null;
};

/** A brief as the model gave it, made safe: known values only, at most three situations, a plain avoid list. */
export function cleanBrief(raw: z.infer<typeof briefReply>): BriefReading {
  const strong: unknown[] = [];
  const slight: unknown[] = [];
  for (const x of raw.situations) {
    if (typeof x === "string") strong.push(x);
    else (/slight/i.test(x.strength) ? slight : strong).push(x.s);
  }
  const st = situationsOf(strong, 3);
  const energy = raw.energy == null || !Number.isFinite(raw.energy) ? null : Math.min(5, Math.max(1, Math.round(raw.energy)));
  return {
    gist: raw.gist.trim().replace(/\s+/g, " ").slice(0, 160),
    bond: oneOf(BONDS, raw.bond),
    stance: oneOf(STANCES, raw.stance),
    heat: oneOf(HEATS, raw.heat) ?? "none",
    energy,
    strong: st,
    slight: situationsOf(slight, 3).filter((s) => !st.includes(s)).slice(0, Math.max(0, 3 - st.length)),
    avoid: [...new Set(raw.avoid.map((a) => a.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 60)).filter(Boolean))].slice(0, 4),
    child: raw.child,
  };
}

/** Characters of each reply's end the helper sees: three replies, the newest last. */
const TAIL = 700;

/** The lines above the replies: place, who's here and their ties, the mood, and what the records say. */
function briefHeader(input: { moods: string[]; place: string; present: string[]; records: RecordsBrief; recordsSay: { firm: Situation[]; hints: Situation[] } }) {
  const say = [
    input.records.bond ? `the scene is ${input.records.bond}` : "",
    input.records.child ? "a child is here" : "",
    input.recordsSay.firm.length ? `happening: ${input.recordsSay.firm.join(", ")}` : "",
    input.recordsSay.hints.length ? `maybe: ${input.recordsSay.hints.join(", ")}` : "",
  ].filter(Boolean);
  return [
    `Place: ${input.place || "?"}`,
    `Here: ${input.present.join(", ") || "?"}`,
    input.records.ties.length ? `Ties:\n${input.records.ties.map((t) => `- ${t}`).join("\n")}` : "",
    `Mood: ${input.moods.join(", ")}`,
    say.length ? `The records say: ${say.join("; ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * The scene read by the helper (3.2): the place, who's here and their ties, the mood, what the
 * records already say, and the ends of the last three replies. Quiet is an answer: no situations
 * when nothing much is happening.
 */
export async function readBrief(input: { replies: string[]; moods: string[]; place: string; present: string[]; records: RecordsBrief; recordsSay: { firm: Situation[]; hints: Situation[] } }, chatId: string): Promise<BriefReading> {
  const r = await callJson({
    task: "helper",
    kind: "soundtrack",
    name: "story_moment",
    chatId,
    schema: briefReply,
    system: `You choose music for a story. Read where this scene is right now, so a song that suits it can play. Judge the scene as it stands at the end of the last reply.
- gist: one plain line of what's happening, no names.
- bond: who the scene is about: ${BONDS.map((b) => `"${b}"`).join(", ")}. Two lovers alone are "romantic"; the same pair with a sister or a child is "family".
- stance: where it stands: ${STANCES.map((s) => `"${s}"`).join(", ")}.
- heat: "none", "flirting" or "sexual". With a child here, "none".
- energy: 1 (hushed) to 5 (full tilt).
- situations: 0-3 of what's happening, each {"s": "…", "strength": "strong" or "slight"}, only from: ${SITUATIONS.join(", ")}. None when nothing much is going on (making tea, small talk, a drive): quiet is an answer.
- avoid: up to 4 short kinds of song that would grate here ("breakup songs", "anything sexual", "party songs"), or [].
- child: true if a child is in the scene.
Reply with JSON only: {"gist": "…", "bond": "family", "stance": "happy in it", "heat": "none", "energy": 2, "situations": [{"s": "peace", "strength": "slight"}], "avoid": [], "child": false}`,
    user: `${briefHeader(input)}\n\n${input.replies.map((t, i) => `--- ${i === input.replies.length - 1 ? "The last reply" : "Before it"} (its end):\n${t.slice(-TAIL)}`).join("\n\n")}`,
    maxTokens: 300,
  });
  return cleanBrief(r.data);
}

/** The chip's line: "family · happy in it · no heat · energy 2". Empty until the brief says something. */
export function briefLine(m: { bond?: Bond | null; stance?: Stance | null; heat?: Heat | null; energy?: number | null }) {
  return [m.bond, m.stance, m.heat ? (m.heat === "none" ? "no heat" : m.heat) : null, m.energy ? `energy ${m.energy}` : null].filter(Boolean).join(" · ");
}
