import { z } from "zod";
import { all, now, one, parseJson, run } from "../db/db";
import { badRequest } from "../lib/http";
import { type Situation, SITUATIONS, situationsOf } from "./situations";
import { songKey } from "./versions";

/**
 * Song cards (docs/34, Part 2): what Mea thinks a song is as a whole, read from its full words in the
 * same helper call that writes its lyric sheet. Who it's about (bond), where the singer stands in it
 * (stance), how sexual it is (heat), any dark subjects, the situations it's mainly about and the ones
 * it only touches, what its first minute says, and a guess at how it sounds (energy, pace, moods).
 *
 * One card per song, keyed by `songKey`, so the album cut, the explicit copy and a remix share it.
 * Fields you edit are kept through a re-read. Sound is a guess (Mea never hears the song) and says so
 * until you confirm it.
 */

export const BONDS = ["romantic", "family", "friends", "self", "a crowd", "anyone"] as const;
export const STANCES = ["happy in it", "wanting", "losing", "mourning", "angry", "mocking", "free", "afraid"] as const;
export const HEATS = ["none", "flirting", "sexual"] as const;
export const DARKS = ["death", "drugs", "violence", "self-harm"] as const;
export const PACES = ["slow", "mid", "fast"] as const;
export type Bond = (typeof BONDS)[number];
export type Stance = (typeof STANCES)[number];
export type Heat = (typeof HEATS)[number];
export type Dark = (typeof DARKS)[number];
export type Pace = (typeof PACES)[number];

export interface SongCard {
  about: string;
  bond: Bond;
  stance: Stance;
  heat: Heat;
  dark: Dark[];
  /** One or two situations the song is about. */
  main: Situation[];
  /** Up to three it only touches. */
  passing: Situation[];
  /** What the first minute says. */
  opening: Situation[];
  /** 1 (hushed) to 5 (full tilt). A guess. */
  energy: number;
  pace: Pace;
  /** The moods the words and name suggest. A guess; the library's own tags are what plays. */
  moods: string[];
}
export const CARD_FIELDS = ["about", "bond", "stance", "heat", "dark", "main", "passing", "opening", "energy", "pace"] as const;
export type CardField = (typeof CARD_FIELDS)[number];
/** Fields that are guesses at how the song sounds, until you confirm them. */
export const SOUND_FIELDS: CardField[] = ["energy", "pace"];

export interface StoredCard {
  key: string;
  card: SongCard;
  /** Fields you set by hand: a re-read leaves them alone. */
  edited: CardField[];
  /** The library's moods before the card's guess replaced them, so they can be put back. */
  oldMoods: string[] | null;
  readAt: number;
}

/** The card part of the lyric sheet reply, as loose as a model writes it. */
export const cardReply = z
  .object({
    about: z.string().default(""),
    bond: z.string().default("anyone"),
    stance: z.string().default("wanting"),
    heat: z.string().default("none"),
    dark: z.array(z.string()).default([]),
    main: z.array(z.string()).default([]),
    passing: z.array(z.string()).default([]),
    opening: z.array(z.string()).default([]),
    energy: z.coerce.number().default(3),
    pace: z.string().default("mid"),
    moods: z.array(z.string()).default([]),
  })
  .partial()
  .nullish();

const oneOf = <T extends string>(xs: readonly T[], v: unknown, dflt: T): T => {
  const s = String(v ?? "").trim().toLowerCase();
  return (xs as readonly string[]).includes(s) ? (s as T) : dflt;
};
const someOf = <T extends string>(xs: readonly T[], v: readonly unknown[] | undefined) => [...new Set((v ?? []).map((x) => String(x).trim().toLowerCase()))].filter((x): x is T => (xs as readonly string[]).includes(x));
const level = (n: unknown) => Math.min(5, Math.max(1, Math.round(Number(n) || 3)));

/** A card as the model gave it, made safe: known values only, main never repeated in passing. */
export function cleanCard(raw: NonNullable<z.infer<typeof cardReply>>, moods: readonly string[]): SongCard {
  const main = situationsOf(raw.main, 2);
  return {
    about: String(raw.about ?? "").trim().replace(/\s+/g, " ").slice(0, 160),
    bond: oneOf(BONDS, raw.bond, "anyone"),
    stance: oneOf(STANCES, raw.stance, "wanting"),
    heat: oneOf(HEATS, raw.heat, "none"),
    dark: someOf(DARKS, raw.dark),
    main,
    passing: situationsOf(raw.passing, 6).filter((s) => !main.includes(s)).slice(0, 3),
    opening: situationsOf(raw.opening, 3),
    energy: level(raw.energy),
    pace: oneOf(PACES, raw.pace, "mid"),
    moods: someOf(moods, raw.moods).slice(0, 3),
  };
}

/** What the helper is asked for, in the lyric sheet's prompt. */
export const CARD_PROMPT = (moods: readonly string[]) => `- card: the song as a whole, read from all its words (and what you know of the song):
  - about: one plain line on what the whole song is about, in your own words (never quote it).
  - bond: who it's about: ${BONDS.map((b) => `"${b}"`).join(", ")} ("anyone": could be sung to anyone).
  - stance: where the singer stands: ${STANCES.map((s) => `"${s}"`).join(", ")}.
  - heat: "none", "flirting" or "sexual" (sexual: it's about sex, plainly or by clear innuendo).
  - dark: any of ${DARKS.map((d) => `"${d}"`).join(", ")} the song is really about (not a passing word), or [].
  - main: the 1-2 situations the song is about; passing: up to 3 it only touches. Both from the list above.
  - opening: 1-3 situations the first minute (the first verse and chorus) is about.
  - energy: 1 (hushed) to 5 (full tilt), and pace: "slow", "mid" or "fast": your best guess at how it sounds.
  - moods: 1-3 moods it suits, from: ${moods.join(", ")}.`;

// ---------- storage ----------

interface Row {
  song_key: string;
  card: string;
  edited: string;
  old_moods: string | null;
  read_at: number;
}
const fromRow = (r: Row): StoredCard => ({ key: r.song_key, card: parseJson<SongCard>(r.card, null as never), edited: parseJson<CardField[]>(r.edited, []), oldMoods: parseJson<string[] | null>(r.old_moods, null), readAt: r.read_at });

export const keyOf = songKey;

export function storedCard(key: string): StoredCard | null {
  const r = one<Row>("SELECT * FROM song_cards WHERE song_key = ?", key);
  return r ? fromRow(r) : null;
}
export const cardOf = (t: { title: string; artist: string }) => storedCard(songKey(t));

/** Every card, by song key. */
export function allCards(): Map<string, StoredCard> {
  return new Map(all<Row>("SELECT * FROM song_cards").map((r) => [r.song_key, fromRow(r)]));
}

/**
 * A fresh reading saved: fields you edited stay as you left them. `oldMoods` is kept from the
 * first time a card's moods replaced the library's.
 */
export function saveReadCard(key: string, card: SongCard, oldMoods?: string[] | null) {
  const had = storedCard(key);
  const edited = had?.edited ?? [];
  const merged = { ...card } as Record<string, unknown>;
  for (const f of edited) merged[f] = (had!.card as unknown as Record<string, unknown>)[f];
  run(
    `INSERT INTO song_cards (song_key, card, edited, old_moods, read_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(song_key) DO UPDATE SET card = excluded.card, read_at = excluded.read_at, old_moods = COALESCE(song_cards.old_moods, excluded.old_moods)`,
    key,
    JSON.stringify(merged),
    JSON.stringify(edited),
    oldMoods ? JSON.stringify(oldMoods) : null,
    now(),
  );
  return storedCard(key)!;
}

const situationList = z.array(z.enum(SITUATIONS));
export const cardPatch = z
  .object({
    about: z.string().max(160),
    bond: z.enum(BONDS),
    stance: z.enum(STANCES),
    heat: z.enum(HEATS),
    dark: z.array(z.enum(DARKS)).max(DARKS.length),
    main: situationList.max(2),
    passing: situationList.max(3),
    opening: situationList.max(3),
    energy: z.number().int().min(1).max(5),
    pace: z.enum(PACES),
    /** Fields confirmed as they are (sound guesses you agree with). */
    confirm: z.array(z.enum(CARD_FIELDS)).max(CARD_FIELDS.length),
  })
  .partial()
  .strict();

/** Your edit to a card: the fields you set (or confirm) are yours from now on. */
export function editCard(key: string, patch: z.infer<typeof cardPatch>) {
  const had = storedCard(key);
  if (!had) throw badRequest("That song has no card yet");
  const { confirm = [], ...fields } = patch;
  const card = { ...had.card, ...fields } as SongCard;
  card.about = card.about.trim();
  card.passing = card.passing.filter((s) => !card.main.includes(s));
  const edited = [...new Set([...had.edited, ...(Object.keys(fields) as CardField[]), ...confirm])];
  run("UPDATE song_cards SET card = ?, edited = ? WHERE song_key = ?", JSON.stringify(card), JSON.stringify(edited), key);
  return storedCard(key)!;
}

/** The old moods are back: they don't need keeping any more. */
export function dropOldMoods(key: string) {
  run("UPDATE song_cards SET old_moods = NULL WHERE song_key = ?", key);
}

/** What the whole song is embedded as: its line, bond and stance, never its words. */
export const cardText = (c: SongCard) => `${c.about} (${c.bond}, ${c.stance}${c.main.length ? `; ${c.main.join(", ")}` : ""})`;

/** The short line the library shows: "romantic · wanting · sexual · energy 4". */
export const cardLine = (c: SongCard) => [c.bond, c.stance, c.heat === "none" ? "no heat" : c.heat, `energy ${c.energy}`].join(" · ");
