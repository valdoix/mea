import { all } from "../db/db";
import { badRequest } from "../lib/http";
import { getSetting, setSetting } from "../lib/settings";
import { enqueue } from "../services/jobs";
import { sceneFromReading } from "./bench";
import { allCards, type SongCard, saveReadCard } from "./cards";
import { addTrack, type Mood, MOODS, musicConfig, type Track } from "./director";
import { background, type Brief, cardFit, gateOf, NOTHING_FITS } from "./fit";
import { kindLine, sceneKind } from "./learn";
import { findLyrics, forgetLyrics, lyricsFor, sameArtist } from "./lyrics";
import { allPlays } from "./plays";
import { type Situation, situationsOf } from "./situations";
import { songKey } from "./versions";
import { type LyricSheet, linesHash, readSongs, SHEET_BATCH, saveSheet, sheetFor } from "./words";
import { publicSongs, type YtmSong } from "./ytmusic";

/**
 * What the library is missing (docs/34, Part 6). The kinds of scene your stories ask for most, next
 * to how many of your songs suit them, and which most often ended with nothing fitting or a skip.
 * For a gap, and only on your yes, Mea looks on YouTube Music for songs by your library's artists,
 * reads their words, and shows the ones whose cards fit; nothing joins the library until you add it.
 * The search sends an artist's name, never anything from the story.
 */

// ---------- 6.1 the gap list ----------

/** A scene your stories asked for music for: its kind, and what was happening. */
interface AskedScene {
  /** "family|happy in it|quiet", or "about:devotion" for a scene read before briefs said who and how. */
  kind: string;
  situations: Situation[];
  heat: string | null;
}

const SITUATION = "about:";
const ENERGY_OF = { quiet: 2, middling: 3, loud: 4 } as Record<string, number>;

/**
 * The kind a scene counts under: who it's about, where it stands and how loud (Part 5), or, for a
 * scene read before the brief said so, what was mainly happening in it.
 */
function kindOf(b: Partial<Brief> & { situations: Situation[] }): string | null {
  return sceneKind({ bond: b.bond ?? null, stance: b.stance ?? null, energy: b.energy ?? null }) ?? (b.situations[0] ? `${SITUATION}${b.situations[0]}` : null);
}

/** The scenes the soundtrack has read (each helper reading is one), newest last. */
function askedScenes(): AskedScene[] {
  const out: AskedScene[] = [];
  for (const row of all<{ id: string; chat_id: string | null; started_at: number; request: string; response: string | null }>(
    "SELECT id, chat_id, started_at, request, response FROM generations WHERE request LIKE '%You choose music for a story%' ORDER BY started_at",
  )) {
    const s = sceneFromReading(row);
    if (!s) continue;
    const kind = kindOf({ ...(s.brief ?? {}), situations: s.situations as Situation[] });
    if (kind) out.push({ kind, situations: s.situations as Situation[], heat: s.brief?.heat ?? null });
  }
  return out;
}

/** The brief a kind stands for, to ask which songs suit it. */
export function briefOfKind(kind: string, situations: Situation[] = [], heat: string | null = null): Brief {
  if (kind.startsWith(SITUATION)) return { situations: situationsOf([kind.slice(SITUATION.length), ...situations], 2), gist: "" };
  const [bond, stance, band] = kind.split("|");
  const known = <T>(x: string | undefined) => (x && x !== "?" ? (x as T) : null);
  return { situations: situations.slice(0, 2), gist: "", bond: known(bond), stance: known(stance), energy: ENERGY_OF[band ?? ""] ?? null, heat: known(heat ?? undefined) ?? "none" };
}

/** A song suits a kind of scene: past its gates, and its card fits well enough to be picked for it. */
const FITS = 1.5;
const suits = (card: SongCard, b: Brief) => !gateOf(card, b) && cardFit(card, b).score >= FITS;

export interface Gap {
  kind: string;
  /** "family · happy in it · quiet", or "about devotion". */
  line: string;
  /** Scenes that asked for it. */
  scenes: number;
  /** Plays in it that ended with nothing fitting, a skip, Not for this scene or a 👎. */
  misses: number;
  /** Songs in the library that suit it. */
  fit: number;
  /** A few of them. */
  examples: string[];
  /** What was most often happening in those scenes, and their usual heat: the brief a look for songs uses. */
  situations: Situation[];
  heat: string | null;
}

const MISSED = new Set(["skipped", "notFor", "down"]);
const most = <T>(xs: T[]) => [...xs.reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map<T, number>()).entries()].sort((a, b) => b[1] - a[1]).map(([x]) => x);

/**
 * The gaps, worst first: the kinds of scene that most often ended in "nothing fits" or a skip, then
 * the ones asked for most against the fewest songs that suit them. Only kinds asked for at least twice.
 */
export function gapList(library: Track[] = musicConfig().library, limit = 8): Gap[] {
  const scenes = askedScenes();
  const plays = allPlays();
  const kinds = new Map<string, { scenes: AskedScene[]; misses: number }>();
  for (const s of scenes) kinds.set(s.kind, { scenes: [...(kinds.get(s.kind)?.scenes ?? []), s], misses: 0 });
  for (const p of plays) {
    const m = p.moment;
    const kind = m ? kindOf(m) : null;
    if (!kind) continue;
    const k = kinds.get(kind) ?? { scenes: [], misses: 0 };
    if (p.why === NOTHING_FITS || MISSED.has(p.ending ?? "")) k.misses += 1;
    kinds.set(kind, k);
  }
  const cards = allCards();
  const carded = library.map((t) => ({ t, card: cards.get(songKey(t))?.card ?? null }));
  const out: Gap[] = [];
  for (const [kind, k] of kinds) {
    if (k.scenes.length < 2 && !k.misses) continue;
    const situations = most(k.scenes.flatMap((s) => s.situations)).slice(0, 2);
    const heat = most(k.scenes.map((s) => s.heat).filter(Boolean))[0] ?? null;
    const brief = briefOfKind(kind, situations, heat);
    // A song read before cards existed counts by what its words are mainly about.
    const fitting = carded.filter(({ t, card }) => (card ? suits(card, brief) : kind.startsWith(SITUATION) && (sheetFor(t.videoId)?.situations.slice(0, 2) ?? []).includes(brief.situations[0]!)));
    out.push({ kind, line: kind.startsWith(SITUATION) ? `about ${kind.slice(SITUATION.length)}` : kindLine(kind), scenes: k.scenes.length, misses: k.misses, fit: fitting.length, examples: fitting.slice(0, 3).map(({ t }) => t.title), situations, heat });
  }
  return out.sort((a, b) => b.misses - a.misses || b.scenes / (b.fit + 1) - a.scenes / (a.fit + 1)).slice(0, limit);
}

/** 6.3: songs safe under anything (Part 4.4), and the instrumentals. */
export function backgroundSongs(library: Track[] = musicConfig().library) {
  const cards = allCards();
  const safe = library.filter((t) => background(cards.get(songKey(t))?.card ?? null, null));
  return { safe: safe.map((t) => ({ videoId: t.videoId, title: t.title, artist: t.artist })), instrumentals: library.filter((t) => t.instrumental).length };
}

// ---------- 6.2 suggestions, only on your yes ----------

export interface Suggested {
  videoId: string;
  title: string;
  artist: string;
  /** Null for an instrumental (it has no words to read). */
  card: SongCard | null;
  sheet: LyricSheet | null;
  moods: Mood[];
  instrumental: boolean;
  fit: number;
}
interface SuggestStore {
  /** By gap kind ("instrumentals" for 6.3's starter set). */
  byKind: Record<string, { at: number; looked: number; songs: Suggested[] }>;
  /** The gap being looked for now. */
  busy: string | null;
  /** Song keys you turned down: never suggested again. */
  declined: string[];
}
const store = (): SuggestStore => ({ byKind: {}, busy: null, declined: [], ...((getSetting("music.suggestions") as Partial<SuggestStore> | null) ?? {}) });
const saveStore = (s: SuggestStore) => setSetting("music.suggestions", s as unknown as Record<string, unknown>);

/** Songs looked at for one gap: their words are read in this many helper calls at most. */
export const LOOK_AT = 8;
const PER_ARTIST = 3;
export const INSTRUMENTALS = "instrumentals";
/** 6.3: the starter set's searches, and the moods each brings. Plain words only. */
const STARTER: [string, Mood[]][] = [
  ["solo piano instrumental", ["calm", "tender"]],
  ["ambient instrumental", ["calm", "mystery", "night"]],
  ["acoustic guitar instrumental", ["calm", "bright"]],
  ["string quartet instrumental", ["melancholy", "epic"]],
];

export function suggestionsView() {
  const s = store();
  return { byKind: s.byKind, busy: s.busy, calls: Math.ceil(LOOK_AT / SHEET_BATCH), lookAt: LOOK_AT };
}

/** Asks for a look for this gap, in the background. Needs Find lyrics online: the words are what's read. */
export function askSuggestions(kind: string) {
  const cfg = musicConfig();
  if (kind !== INSTRUMENTALS && !cfg.lyricsOnline) throw badRequest("Turn on Find lyrics online first: Mea reads a song's words to know if it fits");
  const s = store();
  if (s.busy) throw badRequest("Mea is already looking for songs");
  saveStore({ ...s, busy: kind });
  enqueue("music.suggest", { kind }, { dedupeKey: "music.suggest" });
  return suggestionsView();
}

/** Who to look under: your preferred artists, then those with the most songs that suit the gap. */
function artistsFor(brief: Brief, library: Track[]) {
  const cards = allCards();
  const fitting = library.filter((t) => {
    const c = cards.get(songKey(t))?.card;
    return c ? suits(c, brief) : false;
  });
  const lead = (a: string) => a.split(/\s*(?:&|,|\bfeat\.?|\bft\.?|\bwith\b)\s*/i)[0]!.trim();
  const ranked = most((fitting.length ? fitting : library).map((t) => lead(t.artist)).filter(Boolean));
  return [...new Set([...musicConfig().taste.preferred, ...ranked])].slice(0, 3);
}

type Deps = { search: (q: string) => Promise<YtmSong[]>; lyrics: typeof findLyrics; read: typeof readSongs };
const realDeps: Deps = { search: publicSongs, lyrics: findLyrics, read: readSongs };

/**
 * The look (a job): search by artist, find the words of a few songs you don't have, read them in at
 * most two helper calls, and keep the ones whose cards suit the gap. The instrumentals' look reads
 * nothing: a few plain searches. Words of songs not kept are forgotten.
 */
export async function suggestStep(kind: string, deps: Deps = realDeps) {
  try {
    const cfg = musicConfig();
    const s0 = store();
    const have = new Set(cfg.library.map((t) => songKey(t)));
    const declined = new Set(s0.declined);
    const shown = new Set(Object.values(s0.byKind).flatMap((g) => g.songs.map((x) => songKey(x))));
    const fresh = (r: YtmSong) => !have.has(songKey(r)) && !declined.has(songKey(r)) && !shown.has(songKey(r));
    if (kind === INSTRUMENTALS) {
      const songs: Suggested[] = [];
      for (const [q, moods] of STARTER) {
        const rows = (await deps.search(q).catch(() => [])).filter(fresh).slice(0, 2);
        for (const r of rows) {
          songs.push({ videoId: r.videoId, title: r.title, artist: r.artist, card: null, sheet: null, moods, instrumental: true, fit: 0 });
          shown.add(songKey(r));
        }
      }
      return void keep(kind, songs, songs.length);
    }
    const gap = gapList(cfg.library, 50).find((g) => g.kind === kind);
    const brief = briefOfKind(kind, gap?.situations ?? [], gap?.heat ?? null);
    const picked: YtmSong[] = [];
    for (const artist of artistsFor(brief, cfg.library)) {
      const rows = (await deps.search(artist).catch(() => [])).filter((r) => fresh(r) && sameArtist(r.artist, artist));
      for (const r of rows.slice(0, PER_ARTIST)) {
        if (picked.length < LOOK_AT && !picked.some((p) => songKey(p) === songKey(r))) picked.push(r);
      }
    }
    const withWords: { song: YtmSong; lines: NonNullable<ReturnType<typeof lyricsFor>>["lines"] }[] = [];
    for (const song of picked) {
      const l = await deps.lyrics(song).catch(() => null);
      if (l?.lines.length) withWords.push({ song, lines: l.lines });
    }
    const songs: Suggested[] = [];
    for (let i = 0; i < withWords.length; i += SHEET_BATCH) {
      const batch = withWords.slice(i, i + SHEET_BATCH);
      const read = await deps.read(batch.map((x) => ({ videoId: x.song.videoId, title: x.song.title, artist: x.song.artist, lines: x.lines })), MOODS);
      for (const { song } of batch) {
        const r = read.get(song.videoId);
        if (!r?.card || !suits(r.card, brief)) continue;
        songs.push({ videoId: song.videoId, title: song.title, artist: song.artist, card: r.card, sheet: r.sheet, moods: r.card.moods.filter((m): m is Mood => (MOODS as readonly string[]).includes(m)), instrumental: false, fit: cardFit(r.card, brief).score });
      }
    }
    forgetLyrics(picked.map((p) => p.videoId).filter((v) => !songs.some((x) => x.videoId === v)));
    keep(kind, songs.sort((a, b) => b.fit - a.fit), picked.length);
  } finally {
    const s = store();
    if (s.busy === kind) saveStore({ ...s, busy: null });
  }
}

function keep(kind: string, songs: Suggested[], looked: number) {
  const s = store();
  const before = s.byKind[kind]?.songs ?? [];
  saveStore({ ...s, byKind: { ...s.byKind, [kind]: { at: Date.now(), looked, songs: [...before, ...songs] } } });
}

function takeOut(kind: string, videoId: string) {
  const s = store();
  const song = s.byKind[kind]?.songs.find((x) => x.videoId === videoId);
  if (!song) throw badRequest("That suggestion is gone");
  const left = s.byKind[kind]!.songs.filter((x) => x.videoId !== videoId);
  const byKind = { ...s.byKind };
  if (left.length) byKind[kind] = { ...byKind[kind]!, songs: left };
  else delete byKind[kind];
  return { s: { ...s, byKind }, song };
}

/** Add: the song joins the library with what Mea read of it (its words, sheet and card), so it isn't read twice. */
export async function addSuggestion(kind: string, videoId: string) {
  const { s, song } = takeOut(kind, videoId);
  saveStore(s);
  await addTrack({ link: song.videoId, title: song.title, artist: song.artist, moods: song.moods, instrumental: song.instrumental });
  const words = lyricsFor(song.videoId);
  if (song.sheet && words?.lines.length) saveSheet(song.videoId, song.sheet, linesHash(words.lines));
  if (song.card) saveReadCard(songKey(song), song.card);
  return suggestionsView();
}

/** No thanks: never suggested again, and its words are forgotten. */
export function declineSuggestion(kind: string, videoId: string) {
  const { s, song } = takeOut(kind, videoId);
  saveStore({ ...s, declined: [...new Set([...s.declined, songKey(song)])] });
  forgetLyrics([song.videoId]);
  return suggestionsView();
}
