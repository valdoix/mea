import { z } from "zod";
import { cosine } from "../memory/embed";
import { callJson } from "../services/llm";
import { briefLine } from "./brief";
import { type Heat, type SongCard, type Stance, cardLine } from "./cards";
import type { Situation } from "./situations";
import type { Moment } from "./words";

/**
 * Picking (docs/34, Part 4): gates, then fit, then a judge. A song that would grate in the room
 * (too sexual, a love song at a family dinner, bitter over a happy scene, a club song over a quiet
 * breakfast, anything the scene brief says to avoid) is out before any scoring. The songs left are
 * scored on the whole song's card against the brief, and the helper picks among the best few, or
 * says none fit. Each step falls back a step: no card, no brief or no helper leaves the picker as it was.
 */

/** The parts of the scene brief the gates and the fit read. */
export type Brief = Pick<Moment, "situations" | "slight" | "gist" | "bond" | "stance" | "heat" | "energy" | "avoid" | "child">;

const HEAT_RANK: Record<Heat, number> = { none: 0, flirting: 1, sexual: 2 };
/** Stances that go with a happy scene, and the ones that sour it. */
const EASY: Stance[] = ["happy in it", "free"];
const SOUR: Stance[] = ["losing", "mourning", "angry", "afraid"];
/** What a song can be mainly about that sours a happy scene, unless it's what's happening. */
const SOURING: Situation[] = ["betrayal", "jealousy", "temptation", "revenge", "heartbreak", "grief", "guilt", "fear"];
/** Situations that make a scene heavy: dark subjects suit it then. */
const HEAVY: Situation[] = ["grief", "fear", "the fight", "revenge", "aftermath", "guilt", "betrayal"];
/** How far a song's energy may be from the scene's. */
const ENERGY_GAP = 2;

const isLight = (b: Brief) => Boolean(b.stance && EASY.includes(b.stance)) && !b.situations.some((s) => HEAVY.includes(s));
const isMourning = (b: Brief) => b.stance === "mourning" || b.situations.includes("grief");

/**
 * What a kind of song named in the brief's avoid list ("breakup songs", "anything sexual", "party
 * songs") catches on a card. Words it doesn't know match the card's situations by name.
 */
const AVOID: [RegExp, (c: SongCard) => boolean][] = [
  [/\b(sex|sexual|explicit|steamy|raunch)/, (c) => c.heat === "sexual"],
  [/\b(flirt|seduct)/, (c) => c.heat !== "none"],
  [/\b(love songs?|romantic|romance)\b/, (c) => c.bond === "romantic"],
  [/\b(break ?ups?|heartbreak|heartbroken)/, (c) => c.main.includes("heartbreak") || c.stance === "losing"],
  [/\b(party|club|dance|banger)/, (c) => c.energy >= 4 && (c.main.includes("celebration") || c.bond === "a crowd")],
  [/\b(sad|grief|mourn|funeral)/, (c) => c.stance === "mourning" || c.main.includes("grief")],
  [/\b(angry|rage|aggressive)/, (c) => c.stance === "angry"],
  [/\b(happy|upbeat|cheerful|celebrat)/, (c) => c.stance === "happy in it" && c.energy >= 3],
  [/\b(loud|intense|heavy)/, (c) => c.energy >= 4],
  [/\b(dark|violent|violence|drugs?|death)/, (c) => c.dark.length > 0],
];
function avoided(card: SongCard, avoid: string[]) {
  for (const a of avoid) {
    const s = a.toLowerCase();
    const rule = AVOID.find(([re]) => re.test(s));
    if (rule ? rule[1](card) : card.main.some((m) => s.includes(m))) return a;
  }
  return null;
}

/**
 * Why a song is out of this scene, or null if it may play (4.1). Each gate reads only what the brief
 * knows: a brief from the records alone (a bond, a child) gates on that and nothing else. Heat held
 * low only because a child is here is a heavy cost (the child lean), not a gate.
 */
export function gateOf(card: SongCard | null, b: Brief | null): string | null {
  if (!card || !b) return null;
  if (b.heat && !b.child && HEAT_RANK[card.heat] > HEAT_RANK[b.heat]) return card.heat === "sexual" ? "too sexual for the scene" : "too flirty for the scene";
  if (card.bond === "romantic" && (b.bond === "family" || b.bond === "friends")) return `a love song in a ${b.bond} scene`;
  if (card.bond === "family" && b.bond === "romantic") return "a family song in a romantic scene";
  if (isLight(b) && SOUR.includes(card.stance)) return `${card.stance} over a happy scene`;
  const souring = isLight(b) ? card.main.find((s) => SOURING.includes(s) && !b.situations.includes(s)) : undefined;
  if (souring) return `about ${souring} over a happy scene`;
  if (isMourning(b) && EASY.includes(card.stance)) return "happy over grief";
  if (isLight(b) && card.dark.length) return `${card.dark[0]} in a light scene`;
  if (b.energy && Math.abs(card.energy - b.energy) > ENERGY_GAP) return card.energy > b.energy ? "too loud for the scene" : "too quiet for the scene";
  const a = b.avoid?.length ? avoided(card, b.avoid) : null;
  if (a) return `the scene says no ${a}`;
  return null;
}

/** Above this, the brief's gist and the song's card mean the same thing. */
const VEC_FLOOR = 0.35;

export interface CardFit {
  score: number;
  /** The scene's situations the song is mainly about. */
  shared: Situation[];
}

/**
 * How well the whole song suits the scene (4.2), from its card: what it's mainly about counts most
 * and what it only touches a little, and a main subject the scene doesn't share now costs. Played
 * from the top, what the first minute says counts too. Then the meaning of the card against the
 * brief's gist, and bond, stance and energy agreeing. Roughly -2 to 6.
 */
export function cardFit(card: SongCard | null, b: Brief | null, opts: { fromTop?: boolean; cardVec?: Float32Array | null; gistVec?: Float32Array | null } = {}): CardFit {
  if (!card || !b) return { score: 0, shared: [] };
  const strong = new Set(b.situations);
  const any = new Set([...b.situations, ...(b.slight ?? [])]);
  const shared = card.main.filter((s) => strong.has(s));
  let s = shared.length * 1.5 + card.main.filter((x) => !strong.has(x) && any.has(x)).length * 0.5;
  s += card.passing.filter((x) => strong.has(x)).length * 0.5;
  // Something the scene isn't: free until now, so a song about desire fit a proposal as well as a love song.
  s -= card.main.filter((x) => !any.has(x)).length * 0.5;
  if (opts.fromTop) s += card.opening.filter((x) => strong.has(x)).length * 0.5;
  if (opts.cardVec && opts.gistVec) {
    const c = cosine(opts.cardVec, opts.gistVec);
    if (c > VEC_FLOOR) s += (c - VEC_FLOOR) * 3;
  }
  if (b.bond && card.bond === b.bond) s += 1;
  if (b.stance && card.stance === b.stance) s += 1;
  else if (b.stance && EASY.includes(b.stance) && EASY.includes(card.stance)) s += 0.5;
  if (b.energy) s += 1 - 0.5 * Math.abs(card.energy - b.energy);
  return { score: Math.round(s * 100) / 100, shared };
}

/**
 * Safe under anything with this mood (4.4): sung to anyone (not a love song, not a family one), no
 * heat, an easy stance, nothing dark, and an energy near the scene's. What plays when nothing in the
 * library is about the scene.
 */
export function background(card: SongCard | null, b: Brief | null) {
  if (!card) return false;
  return (card.bond === "anyone" || card.bond === "self") && card.heat === "none" && EASY.includes(card.stance) && !card.dark.length && (!b?.energy || Math.abs(card.energy - b.energy) <= 1);
}

export const NOTHING_FITS = "Nothing about this in your library. Playing for the mood.";

// ---------- the judge (4.3) ----------

/** How many songs the judge sees. */
export const JUDGE_TOP = 8;

export interface JudgeSong {
  videoId: string;
  title: string;
  artist: string;
  card: SongCard | null;
}
export interface Verdict {
  /** The songs that fit, best first (video ids); empty when none do. */
  order: string[];
  reason: string;
  none: boolean;
}

const judgeReply = z.object({
  none: z.boolean().default(false),
  ranking: z.array(z.coerce.number()).default([]),
  reason: z.string().default(""),
});

/** One song as the judge sees it: Mea's notes on it, never its words. */
const songLines = (s: JudgeSong, i: number) =>
  `${i + 1}. ${s.title}${s.artist ? ` — ${s.artist}` : ""}\n   ${s.card ? `${cardLine(s.card)}; about: ${s.card.about || "?"}${s.card.main.length ? `; mainly ${s.card.main.join(", ")}` : ""}${s.card.dark.length ? `; touches ${s.card.dark.join(", ")}` : ""}` : "no notes on this song"}`;

/** The judge's verdict made safe: only songs it was shown, each once. */
export function cleanVerdict(raw: z.infer<typeof judgeReply>, songs: JudgeSong[]): Verdict {
  const order: string[] = [];
  for (const n of raw.ranking) {
    const s = Number.isInteger(n) ? songs[n - 1] : undefined;
    if (s && !order.includes(s.videoId)) order.push(s.videoId);
  }
  const reason = raw.reason.trim().replace(/\s+/g, " ").slice(0, 160);
  return raw.none || !order.length ? { order: [], reason, none: true } : { order, reason, none: false };
}

/**
 * The helper picks among the best few songs (4.3), from the brief and each song's card (never its
 * lyrics, docs/18 0.3): it ranks the ones that fit, says in one line why the first, or answers that
 * none do. Throws on failure; the fit score picks then (4.5).
 */
export async function judgeSongs(b: Brief, moods: string[], songs: JudgeSong[], chatId: string): Promise<Verdict> {
  const line = briefLine(b);
  const r = await callJson({
    task: "helper",
    kind: "soundtrack",
    name: "song_judge",
    chatId,
    schema: judgeReply,
    system: `You judge songs for a story's soundtrack. Given the scene and a few songs (Mea's notes on each, not the lyrics), choose which could play under it without grating: a love song doesn't suit a family dinner, a breakup song a happy morning, a club song a quiet breakfast.
- ranking: the numbers of the songs that fit, best first. Leave out any that would grate.
- reason: one short plain sentence on why the first one suits the scene, no names from the story.
- none: true if no song fits; then ranking is [].
Reply with JSON only: {"ranking": [3, 1], "reason": "…", "none": false}`,
    user: [
      `The scene: ${b.gist || "?"}`,
      line ? `It is: ${line}` : "",
      `Mood: ${moods.join(", ")}`,
      b.situations.length ? `Happening: ${b.situations.join(", ")}` : "Nothing much is happening.",
      b.child ? "A child is here." : "",
      b.avoid?.length ? `Would grate: ${b.avoid.join(", ")}` : "",
      "",
      "The songs:",
      ...songs.map(songLines),
    ]
      .filter((x, i, xs) => x || xs[i - 1])
      .join("\n"),
    maxTokens: 200,
  });
  return cleanVerdict(r.data, songs);
}
