import { all, now, one, parseJson, run } from "../db/db";
import { YtmError } from "./ytmusic";

/**
 * The words of the soundtrack's songs (docs/18, Part 1), kept on this PC in `song_lyrics`. They come
 * from words you paste, then (only with "Find lyrics online" on) LRCLIB, which often has them timed
 * line by line, then YouTube Music's own lyrics tab (plain). Only a song's title, artist and length
 * are sent, never anything from the story. A match more than a few seconds off the song's length, or
 * by someone else, is dropped: a live version's timing would land the wrong line.
 */

export interface LyricLine {
  /** Seconds into the song, for timed lyrics. */
  t: number | null;
  text: string;
}
export type LyricSource = "lrclib" | "ytmusic" | "pasted" | "none";
export interface Lyrics {
  videoId: string;
  source: LyricSource;
  timed: boolean;
  lines: LyricLine[];
  duration: number | null;
  /** LRCLIB says the song has no words. */
  instrumental?: boolean;
  fetchedAt: number;
}

/** A miss is looked for again after this long (lyrics often turn up on LRCLIB later). */
export const MISS_TTL = 30 * 24 * 3600_000;
/** How far a match's length may be from the song's. */
const LENGTH_SLACK = 5;
const LRCLIB = "https://lrclib.net/api";
const USER_AGENT = "Mea soundtrack (https://github.com/valdoix/Mea)";
const RETRY_MS = 1_500;

// ---------- reading words ----------

const STAMP = /\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\]/g;

/**
 * Words as pasted or fetched: LRC ("[01:23.45] line", several stamps on a line meaning it repeats,
 * "[ar: …]" tags skipped) or plain text. Timed when every line with words has a stamp.
 */
export function parseLyrics(text: string): { timed: boolean; lines: LyricLine[] } {
  const raw = text.replace(/\r\n?/g, "\n").split("\n");
  const stamped: LyricLine[] = [];
  let plainWords = 0;
  for (const line of raw) {
    if (/^\s*\[[a-z#]+:[^\]]*\]\s*$/i.test(line)) continue;
    const stamps = [...line.matchAll(STAMP)].map((m) => Number(m[1]) * 60 + Number(m[2]!.replace(":", ".")));
    const words = line.replace(STAMP, "").trim();
    if (stamps.length) for (const t of stamps) stamped.push({ t: Math.round(t * 100) / 100, text: words });
    else if (words) plainWords++;
  }
  if (stamped.some((l) => l.text) && !plainWords) return { timed: true, lines: stamped.sort((a, b) => a.t! - b.t!) };
  // Plain: blank lines kept (one at most in a row), since they mark where a verse ends.
  const lines: LyricLine[] = [];
  for (const line of raw) {
    const words = line.replace(STAMP, "").trim();
    if (/^\[[a-z#]+:[^\]]*\]$/i.test(words)) continue;
    if (!words && (!lines.length || !lines.at(-1)!.text)) continue;
    lines.push({ t: null, text: words });
  }
  while (lines.length && !lines.at(-1)!.text) lines.pop();
  return { timed: false, lines };
}

/** A YouTube title as a lyrics site knows it: no "(Official Video)", "- Remastered 2011", "feat. …". */
export function cleanTitle(title: string) {
  return title
    .replace(/[([]\s*(?:official|lyrics?|audio|video|visuali[sz]er|hd|hq|4k|mv|m\/v|explicit|clean|live|color coded)\b[^)\]]*[)\]]/gi, "")
    .replace(/[([]\s*(?:feat\.?|ft\.?|featuring|with)\s[^)\]]*[)\]]/gi, "")
    .replace(/\s(?:feat\.?|ft\.?|featuring)\s.*$/i, "")
    .replace(/\s[-–—]\s*(?:\d{4}\s*)?(?:remaster(?:ed)?|re-?mastered|single version|radio edit|mono|stereo)\b.*$/i, "")
    .replace(/\s*\|.*$/, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** The first artist: "Hozier & Bear McCreary", "Hozier, Bear McCreary" and "Hozier - Topic" are Hozier. */
export function leadArtist(artist: string) {
  return artist
    .replace(/\s*-\s*Topic$/i, "")
    .replace(/VEVO$/i, "")
    .split(/\s*(?:,|&|\bfeat\.?|\bft\.?|\bfeaturing\b|\bx\b|\band\b)\s*/i)[0]!
    .trim();
}

const fold = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
/** The same artist, give or take spelling: one name holds the other. */
export function sameArtist(a: string, b: string) {
  const x = fold(leadArtist(a));
  const y = fold(b);
  return Boolean(x && y && (y.includes(x) || x.includes(fold(leadArtist(b)))));
}

// ---------- the store ----------

interface Row {
  video_id: string;
  source: LyricSource;
  timed: number;
  lines: string;
  duration: number | null;
  fetched_at: number;
}
const fromRow = (r: Row): Lyrics => ({ videoId: r.video_id, source: r.source, timed: Boolean(r.timed), lines: parseJson<LyricLine[]>(r.lines, []), duration: r.duration, fetchedAt: r.fetched_at });

export function lyricsFor(videoId: string): Lyrics | null {
  const r = one<Row>("SELECT * FROM song_lyrics WHERE video_id = ?", videoId);
  return r ? fromRow(r) : null;
}

/** Per song with a row: where its words came from, whether they're timed, and when. */
export function lyricsIndex(): Map<string, { source: LyricSource; timed: boolean; fetchedAt: number }> {
  return new Map(all<Row>("SELECT video_id, source, timed, fetched_at FROM song_lyrics").map((r) => [r.video_id, { source: r.source, timed: Boolean(r.timed), fetchedAt: r.fetched_at }]));
}

export function saveLyrics(l: Omit<Lyrics, "fetchedAt" | "instrumental">) {
  run(
    `INSERT INTO song_lyrics (video_id, source, timed, lines, duration, sheet, sheet_hash, fetched_at) VALUES (?, ?, ?, ?, ?, NULL, NULL, ?)
     ON CONFLICT(video_id) DO UPDATE SET source = excluded.source, timed = excluded.timed, lines = excluded.lines, duration = excluded.duration, fetched_at = excluded.fetched_at,
       sheet = CASE WHEN song_lyrics.lines = excluded.lines THEN song_lyrics.sheet END, sheet_hash = CASE WHEN song_lyrics.lines = excluded.lines THEN song_lyrics.sheet_hash END`,
    l.videoId,
    l.source,
    l.timed ? 1 : 0,
    JSON.stringify(l.lines),
    l.duration,
    now(),
  );
}

/** Words you paste: they win over anything found online, and are never looked up again. Empty text forgets them. */
export function pasteLyrics(videoId: string, text: string) {
  if (!text.trim()) return void forgetLyrics([videoId]);
  const { timed, lines } = parseLyrics(text);
  saveLyrics({ videoId, source: "pasted", timed, lines, duration: null });
}

export function forgetLyrics(videoIds: string[]) {
  for (const id of videoIds) run("DELETE FROM song_lyrics WHERE video_id = ?", id);
}

// ---------- finding words ----------

/** A 5xx or a dropped connection is tried once more after a moment: LRCLIB sometimes blips. */
async function getJson<T>(url: string, init: RequestInit = {}, again = true): Promise<T | null> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(15_000) });
  } catch {
    if (again) return Bun.sleep(RETRY_MS).then(() => getJson<T>(url, init, false));
    throw new YtmError(`${new URL(url).hostname} isn't answering`);
  }
  if (res.status >= 500 && again) return Bun.sleep(RETRY_MS).then(() => getJson<T>(url, init, false));
  if (res.status === 404) return null;
  if (!res.ok) throw new YtmError(`${new URL(url).hostname} said ${res.status}`, res.status);
  return (await res.json()) as T;
}

interface LrclibHit {
  trackName?: string;
  artistName?: string;
  duration?: number;
  instrumental?: boolean;
  plainLyrics?: string | null;
  syncedLyrics?: string | null;
}

/** LRCLIB's best match: the artist's, within a few seconds of the length when it's known, timed before plain. */
export function bestLrclib(hits: LrclibHit[], artist: string, duration: number | null): LrclibHit | null {
  const fits = hits.filter((h) => sameArtist(artist, h.artistName ?? "") && (duration == null || h.duration == null || Math.abs(h.duration - duration) <= LENGTH_SLACK) && (h.instrumental || h.syncedLyrics || h.plainLyrics));
  const rank = (h: LrclibHit) => (h.syncedLyrics ? 0 : h.instrumental ? 1 : 2) * 1000 + (duration != null && h.duration != null ? Math.abs(h.duration - duration) : 0);
  return fits.sort((a, b) => rank(a) - rank(b))[0] ?? null;
}

async function fromLrclib(title: string, artist: string, duration: number | null) {
  const headers = { "User-Agent": USER_AGENT, "Lrclib-Client": USER_AGENT };
  const track = cleanTitle(title) || title;
  const lead = leadArtist(artist);
  const q = new URLSearchParams({ track_name: track, ...(lead ? { artist_name: lead } : {}) });
  let hits = (await getJson<LrclibHit[]>(`${LRCLIB}/search?${q}`, { headers })) ?? [];
  if (!hits.length && lead) hits = (await getJson<LrclibHit[]>(`${LRCLIB}/search?${new URLSearchParams({ q: `${track} ${lead}` })}`, { headers })) ?? [];
  return bestLrclib(hits, artist, duration);
}

const WEB_REMIX = { clientName: "WEB_REMIX", clientVersion: "1.20241023.01.00", hl: "en" };
const ytm = (path: string, body: Record<string, unknown>) =>
  getJson<unknown>(`https://music.youtube.com/youtubei/v1/${path}?prettyPrint=false`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://music.youtube.com" },
    body: JSON.stringify({ ...body, context: { client: WEB_REMIX } }),
  });

type Node = Record<string, unknown>;
function* walk(o: unknown): Generator<Node> {
  if (Array.isArray(o)) for (const x of o) yield* walk(x);
  else if (o && typeof o === "object") {
    yield o as Node;
    for (const v of Object.values(o)) yield* walk(v);
  }
}
const runsText = (t: unknown) => ((t as { runs?: { text?: string }[] } | undefined)?.runs ?? []).map((x) => x.text ?? "").join("");
const seconds = (s: string) => (/^\d+(?::\d{1,2}){1,2}$/.test(s) ? s.split(":").reduce((n, x) => n * 60 + Number(x), 0) : null);

/** YouTube Music's watch page for a song: its length, and where its lyrics tab points. */
export function readNext(data: unknown, videoId: string): { duration: number | null; lyricsId: string | null } {
  let duration: number | null = null;
  let lyricsId: string | null = null;
  for (const n of walk(data)) {
    if (duration == null && n.videoId === videoId && n.lengthText) duration = seconds(runsText(n.lengthText));
    const b = n.browseEndpoint as { browseId?: string } | undefined;
    if (!lyricsId && b?.browseId?.startsWith("MPLY")) lyricsId = b.browseId;
  }
  return { duration, lyricsId };
}

/** The words on a lyrics tab, without the "Source: …" line under them. */
export function readLyricsTab(data: unknown): string | null {
  for (const n of walk(data)) {
    const shelf = n.musicDescriptionShelfRenderer as { description?: unknown } | undefined;
    const text = shelf && runsText(shelf.description).trim();
    if (text) return text;
  }
  return null;
}

/**
 * Looks for a song's words online and keeps what it finds (or that it found none). Throws a
 * YtmError when a site isn't answering, so the miss isn't remembered and it's tried again later.
 */
export async function findLyrics(track: { videoId: string; title: string; artist: string }, opts: { duration?: number | null } = {}): Promise<Lyrics> {
  const page = await ytm("next", { videoId: track.videoId }).then((d) => readNext(d, track.videoId));
  const duration = opts.duration ?? page.duration;
  const hit = track.artist ? await fromLrclib(track.title, track.artist, duration) : null;
  let found: Omit<Lyrics, "fetchedAt"> | null = null;
  if (hit?.instrumental && !hit.syncedLyrics && !hit.plainLyrics) found = { videoId: track.videoId, source: "lrclib", timed: false, lines: [], duration: hit.duration ?? duration, instrumental: true };
  else if (hit) found = { videoId: track.videoId, source: "lrclib", ...parseLyrics(hit.syncedLyrics || hit.plainLyrics || ""), duration: hit.duration ?? duration };
  if (!found?.lines.length && !found?.instrumental && page.lyricsId) {
    const text = readLyricsTab(await ytm("browse", { browseId: page.lyricsId }));
    if (text) found = { videoId: track.videoId, source: "ytmusic", ...parseLyrics(text), duration };
  }
  const out = found && (found.lines.length || found.instrumental) ? found : { videoId: track.videoId, source: "none" as const, timed: false, lines: [], duration };
  saveLyrics(out);
  return { ...out, fetchedAt: now() };
}
