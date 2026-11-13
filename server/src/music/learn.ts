import { getSetting, setSetting } from "../lib/settings";
import { type CardField, HEATS, type SongCard } from "./cards";
import type { Brief } from "./fit";

/**
 * Learning from you (docs/34, Part 5). A skip in a song's first 30 seconds is a soft no for that
 * kind of scene (its bond, its stance and how loud it is), in the story and, more weakly,
 * everywhere; three and the song sits out of that kind of scene. "Not for this scene" says why in one
 * tap, and two of the same answer suggest a change to the song's card in Settings › Music.
 */

/** A skip this early in a song is a no to it, not just "next". */
export const EARLY_SKIP = 30;
/** Early skips in one kind of scene (all stories) before a song sits out of it. */
export const SIT_OUT = 3;
/** A 👍 raises a song for its kind of scene by this, up to twice. */
export const UP_LIFT = 1.5;

export type NotWhy = "words" | "sound" | "much" | "now";
export const NOT_WHYS: NotWhy[] = ["words", "sound", "much", "now"];

const band = (e: number | null | undefined) => (e == null ? "?" : e <= 2 ? "quiet" : e === 3 ? "middling" : "loud");

/**
 * The kind of scene, for what you've taught Mea: "family|happy in it|quiet". Null when the brief
 * says neither who the scene is about nor where it stands (a skip there teaches nothing).
 */
export function sceneKind(b: Pick<Brief, "bond" | "stance" | "energy"> | null | undefined): string | null {
  if (!b || (!b.bond && !b.stance)) return null;
  return `${b.bond ?? "?"}|${b.stance ?? "?"}|${band(b.energy)}`;
}
/** "family · happy in it · quiet", for the chip. */
export const kindLine = (kind: string) => kind.split("|").filter((x) => x !== "?").join(" · ");

interface WhyTally {
  sound: number;
  much: number;
  words: number;
  now: number;
  /** The scenes' energies when you said Wrong sound. */
  energies: number[];
}
interface Learned {
  /** Early skips by kind of scene, then by song (its key: every copy counts). */
  skips: Record<string, Record<string, number>>;
  /** Your answers to "Not for this scene", by song. */
  why: Record<string, WhyTally>;
}
const learned = (): Learned => ({ skips: {}, why: {}, ...((getSetting("music.learned") as Partial<Learned> | null) ?? {}) });
const saveLearned = (l: Learned) => setSetting("music.learned", l as unknown as Record<string, unknown>);

/** A skip early in the song, everywhere (the story keeps its own count too). */
export function noteEarlySkip(kind: string, key: string) {
  const l = learned();
  l.skips[kind] = { ...(l.skips[kind] ?? {}), [key]: (l.skips[kind]?.[key] ?? 0) + 1 };
  saveLearned(l);
}
/** Early skips in this kind of scene, by song, across every story. */
export const skipsIn = (kind: string | null): Record<string, number> => (kind ? (learned().skips[kind] ?? {}) : {});

/** Your answer to "Not for this scene", for the card's suggestions. */
export function noteWhy(key: string, why: NotWhy, sceneEnergy: number | null) {
  const l = learned();
  const t: WhyTally = { sound: 0, much: 0, words: 0, now: 0, energies: [], ...(l.why[key] ?? {}) };
  t[why] += 1;
  if (why === "sound" && sceneEnergy != null) t.energies = [...t.energies, sceneEnergy].slice(-6);
  l.why[key] = t;
  saveLearned(l);
}

export interface Suggestion {
  field: Extract<CardField, "energy" | "heat">;
  value: number | string;
  why: string;
}

/**
 * What two of the same answer say about the card. Too much twice: it's hotter than the card says
 * (heat up a step; already sexual, then louder). Wrong sound twice: Mea's guess at how loud it is was
 * off, away from the scenes it was played in (louder if it guessed above them, quieter if below). A
 * sound you confirmed yourself isn't second-guessed.
 */
export function suggestionFor(key: string, card: SongCard, edited: CardField[] = []): Suggestion | null {
  const t = learned().why[key];
  if (!t) return null;
  if (t.much >= 2) {
    const i = HEATS.indexOf(card.heat);
    if (i < HEATS.length - 1 && !edited.includes("heat")) return { field: "heat", value: HEATS[i + 1]!, why: `you said Too much ${t.much} times` };
    if (card.energy < 5 && !edited.includes("energy")) return { field: "energy", value: card.energy + 1, why: `you said Too much ${t.much} times` };
  }
  if (t.sound >= 2 && !edited.includes("energy")) {
    const avg = t.energies.length ? t.energies.reduce((a, b) => a + b, 0) / t.energies.length : card.energy;
    const value = Math.min(5, Math.max(1, card.energy + (card.energy >= avg ? 1 : -1)));
    if (value !== card.energy) return { field: "energy", value, why: `you said Wrong sound ${t.sound} times` };
  }
  return null;
}

/** A suggestion taken or turned down: the answers behind it are spent. */
export function spendSuggestion(key: string, field: Suggestion["field"]) {
  const l = learned();
  const t = l.why[key];
  if (!t) return;
  if (field === "heat") t.much = 0;
  else {
    t.sound = 0;
    t.much = 0;
    t.energies = [];
  }
  saveLearned(l);
}
