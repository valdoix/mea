import { z } from "zod";
import { all, now, one, parseJson, run, tx } from "../db/db";
import { cosine, embeddingTarget, noteEmbedFailure } from "../memory/embed";
import { hashText } from "../memory/text";
import { callJson } from "../services/llm";
import { finishRequest, startRequest } from "../services/requests";
import type { Change, WorldState } from "../trackers/types";
import type { LyricLine } from "./lyrics";
import { type Situation, SITUATIONS, situationsOf } from "./situations";

/**
 * Reading the songs and the story (docs/18, Part 2). A song's **lyric sheet** is what the helper
 * model reads out of its words once: what it's about, who sings to whom, and its passages (verse,
 * chorus, bridge) each with a plain gist. The story's **moment** is what's happening at a beat: the
 * tracker records say most of it for free; a helper call reads the reply only when they don't. The
 * words themselves never reach the story: only gists and situations leave this file.
 */

export type Voice = "to-you" | "about-them" | "we" | "self";
export type PassageKind = "verse" | "chorus" | "bridge" | "intro" | "outro";
export interface Passage {
  /** Line indexes into the song's lyrics, inclusive. */
  from: number;
  to: number;
  kind: PassageKind;
  gist: string;
  situations: Situation[];
  peak: boolean;
}
export interface LyricSheet {
  situations: Situation[];
  themes: string[];
  voice: Voice;
  passages: Passage[];
}

const VOICES: Voice[] = ["to-you", "about-them", "we", "self"];
const KINDS: PassageKind[] = ["verse", "chorus", "bridge", "intro", "outro"];
/** Lines of one song sent to the helper; past this the rest repeats anyway. */
const MAX_LINES = 120;
/** Songs per helper call. */
export const SHEET_BATCH = 4;

export const linesHash = (lines: LyricLine[]) => hashText(JSON.stringify(lines));

// ---------- lyric sheets ----------

const sheetReply = z.object({
  songs: z.array(
    z.object({
      id: z.string(),
      situations: z.array(z.string()).default([]),
      themes: z.array(z.string()).default([]),
      voice: z.string().default("to-you"),
      passages: z.array(z.object({ from: z.number(), to: z.number(), kind: z.string().default("verse"), gist: z.string().default(""), situations: z.array(z.string()).default([]), peak: z.boolean().default(false) })).default([]),
      mood: z.string().nullish(),
    }),
  ),
});

/** A sheet as the model gave it, made safe: known situations only, passages inside the song, in order, not overlapping. */
export function cleanSheet(raw: z.infer<typeof sheetReply>["songs"][number], lineCount: number): LyricSheet {
  const passages: Passage[] = [];
  for (const p of [...raw.passages].sort((a, b) => a.from - b.from)) {
    const from = Math.max(0, Math.floor(p.from), passages.length ? passages.at(-1)!.to + 1 : 0);
    const to = Math.min(lineCount - 1, Math.floor(p.to));
    if (to < from) continue;
    passages.push({ from, to, kind: KINDS.includes(p.kind as PassageKind) ? (p.kind as PassageKind) : "verse", gist: p.gist.trim().slice(0, 160), situations: situationsOf(p.situations, 3), peak: p.peak });
  }
  // One peak at most: the first the model marked.
  let peaked = false;
  for (const p of passages) if (p.peak) (p.peak = !peaked), (peaked = true);
  return { situations: situationsOf(raw.situations), themes: raw.themes.map((t) => t.trim().toLowerCase().slice(0, 40)).filter(Boolean).slice(0, 6), voice: VOICES.includes(raw.voice as Voice) ? (raw.voice as Voice) : "to-you", passages };
}

/** A pause this long between timed lines is a break between sections (timed lyrics rarely have blank lines). */
const SECTION_GAP = 4.5;

/**
 * The lines as the helper sees them: numbered, blank lines kept as a break (they mark where a verse
 * ends), and a bare "—" where timed lyrics pause long enough to be a new section.
 */
export function numbered(lines: LyricLine[]) {
  const out: string[] = [];
  lines.slice(0, MAX_LINES).forEach((l, i) => {
    const prev = lines[i - 1];
    if (l.text && prev?.text && l.t != null && prev.t != null && l.t - prev.t > SECTION_GAP) out.push("—");
    out.push(l.text ? `${i}: ${l.text}` : `${i}: —`);
  });
  return out.join("\n");
}

export interface SheetSong {
  videoId: string;
  title: string;
  artist: string;
  lines: LyricLine[];
}

/**
 * Sheets for a few songs in one helper call. A song the reply leaves out gets an empty sheet (kept,
 * so it isn't asked about again until its words change). Returns a mood the words suggest, if any.
 */
export async function readSongs(songs: SheetSong[], moods: readonly string[]): Promise<Map<string, { sheet: LyricSheet; mood: string | null }>> {
  const r = await callJson({
    task: "helper",
    kind: "soundtrack",
    name: "lyric_sheet",
    schema: sheetReply,
    system: `You read song lyrics for a story's soundtrack, so a scene can be matched to a song whose words fit it. For each song:
- situations: 1-4 of what the song is about, only from: ${SITUATIONS.join(", ")}.
- themes: up to 6 plain words or short phrases (images, places, objects: "dawn", "the sea", "a promise").
- voice: who sings to whom: "to-you" (to someone), "about-them" (about someone not there), "we" (about us), "self" (inward).
- passages: split the numbered lines into its verses, choruses, bridge, intro and outro (blank lines and repeats show where; the chorus is the block that repeats). Each: from and to (line numbers, inclusive), kind, a one-line gist in your own plain words (never quote the lyrics), 1-3 situations from the same list, and peak: true for the one passage the song builds to.
- mood: the one mood the words carry most, from: ${moods.join(", ")} (or null).
Reply with JSON only: {"songs": [{"id": "…", "situations": [], "themes": [], "voice": "to-you", "passages": [{"from": 0, "to": 3, "kind": "verse", "gist": "…", "situations": [], "peak": false}], "mood": null}]}`,
    user: songs.map((s) => `### ${s.videoId}: "${s.title}" by ${s.artist || "?"}\n${numbered(s.lines)}`).join("\n\n"),
    maxTokens: 900 * songs.length + 200,
  });
  const by = new Map(r.data.songs.map((x) => [x.id, x]));
  const out = new Map<string, { sheet: LyricSheet; mood: string | null }>();
  for (const s of songs) {
    const raw = by.get(s.videoId);
    const lineCount = Math.min(s.lines.length, MAX_LINES);
    out.set(s.videoId, raw ? { sheet: cleanSheet(raw, lineCount), mood: raw.mood && moods.includes(raw.mood) ? raw.mood : null } : { sheet: { situations: [], themes: [], voice: "to-you", passages: [] }, mood: null });
  }
  return out;
}

export function saveSheet(videoId: string, sheet: LyricSheet, hash: string) {
  run("UPDATE song_lyrics SET sheet = ?, sheet_hash = ? WHERE video_id = ?", JSON.stringify(sheet), hash, videoId);
}

export function sheetFor(videoId: string): LyricSheet | null {
  const r = one<{ sheet: string | null; sheet_hash: string | null; lines: string }>("SELECT sheet, sheet_hash, lines FROM song_lyrics WHERE video_id = ?", videoId);
  if (!r?.sheet || r.sheet_hash !== linesHash(parseJson<LyricLine[]>(r.lines, []))) return null;
  return parseJson<LyricSheet | null>(r.sheet, null);
}

/** Songs with words and no sheet for them (or a sheet of older words), among these. */
export function songsToRead(videoIds: string[]): { videoId: string; lines: LyricLine[] }[] {
  const want = new Set(videoIds);
  return all<{ video_id: string; lines: string; sheet_hash: string | null }>("SELECT video_id, lines, sheet_hash FROM song_lyrics WHERE source != 'none'")
    .filter((r) => want.has(r.video_id))
    .map((r) => ({ videoId: r.video_id, lines: parseJson<LyricLine[]>(r.lines, []), hash: r.sheet_hash }))
    .filter((r) => r.lines.some((l) => l.text) && r.hash !== linesHash(r.lines))
    .map(({ videoId, lines }) => ({ videoId, lines }));
}

// ---------- passage vectors ----------

const toBlob = (v: Float32Array) => new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
const fromBlob = (b: Uint8Array) => new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
/** What a passage is embedded as: its gist and what it's about, never its words. */
export const passageText = (p: Passage, sheet: LyricSheet) => `${p.gist} (${[...new Set([...p.situations, ...sheet.situations])].join(", ")})`;

/**
 * Embeds passages that have no vector for this model yet (owner "song", id "videoId#index"), with
 * the same rules as lore: nothing when embeddings are off, identical text never twice.
 */
export async function embedPassages(sheets: { videoId: string; sheet: LyricSheet }[]) {
  const t = embeddingTarget();
  if (!t) return 0;
  const want = sheets.flatMap(({ videoId, sheet }) => sheet.passages.map((p, i) => ({ id: `${videoId}#${i}`, text: passageText(p, sheet) })));
  const have = new Map(all<{ owner_id: string; hash: string; model: string; dims: number }>("SELECT owner_id, hash, model, dims FROM embeddings WHERE owner_type = 'song'").map((r) => [r.owner_id, r]));
  const todo = want.filter((w) => {
    const h = have.get(w.id);
    return !h || h.hash !== hashText(w.text) || h.model !== t.model || h.dims !== t.dims;
  });
  for (let i = 0; i < todo.length; i += 64) {
    const batch = todo.slice(i, i + 64);
    const reqId = startRequest({ chatId: null, kind: "embed", task: "embeddings", resolved: { connection: { id: t.connectionId }, modelId: t.model, billing: t.billing, profile: { id: "embeddings" } }, request: { model: t.model, inputs: batch.length, songs: true } });
    try {
      const res = await t.provider.embed!(
        batch.map((b) => b.text),
        t.model,
        t.dims,
      );
      tx(() =>
        batch.forEach((b, j) => {
          const v = res.vectors[j]!;
          let n = 0;
          for (let k = 0; k < v.length; k++) n += v[k]! * v[k]!;
          n = Math.sqrt(n) || 1;
          for (let k = 0; k < v.length; k++) v[k]! /= n;
          run(
            `INSERT INTO embeddings (owner_type, owner_id, chat_id, model, dims, hash, vector, created_at) VALUES ('song', ?, '', ?, ?, ?, ?, ?)
             ON CONFLICT(owner_type, owner_id) DO UPDATE SET model = excluded.model, dims = excluded.dims, hash = excluded.hash, vector = excluded.vector, created_at = excluded.created_at`,
            b.id,
            t.model,
            t.dims,
            hashText(b.text),
            toBlob(v),
            now(),
          );
        }),
      );
      finishRequest(reqId, { status: "done", usage: { promptTokens: res.promptTokens } });
    } catch (e) {
      finishRequest(reqId, { status: "error", error: (e as Error).message });
      noteEmbedFailure(e);
      throw e;
    }
  }
  return todo.length;
}

/** A song's passage vectors for the current model, by passage index. */
export function passageVectors(videoId: string): Map<number, Float32Array> {
  const t = embeddingTarget();
  if (!t) return new Map();
  return new Map(
    all<{ owner_id: string; vector: Uint8Array }>("SELECT owner_id, vector FROM embeddings WHERE owner_type = 'song' AND owner_id LIKE ? AND model = ? AND dims = ?", `${videoId}#%`, t.model, t.dims).map((r) => [Number(r.owner_id.split("#")[1]), fromBlob(r.vector)]),
  );
}

/** A removed song's vectors go with it. */
export function forgetPassageVectors(videoIds: string[]) {
  for (const id of videoIds) run("DELETE FROM embeddings WHERE owner_type = 'song' AND owner_id LIKE ?", `${id}#%`);
}

// ---------- the moment ----------

export interface Moment {
  situations: Situation[];
  /** One plain line of what's happening (from the helper; empty when the records said enough). */
  gist: string;
  /** The cue key it was made for: the same beat reuses it. */
  key: string;
  /** Where the situations came from. */
  from: "records" | "reply" | "both";
  at: number;
}

const GRIEF_MOOD = /\b(grief|griev|mourn|bereft|heartbroken)/i;
const FEAR_MOOD = /\b(terrif|panic|horrif)/i;

/**
 * Situations the tracker records already say, for free (2.3, layer 1). Firm ones mean it: a death is
 * grief, a secret coming out a confession (a betrayal when trust fell with it), romance moving up
 * first love or devotion and down a goodbye, a promise broken a betrayal, a fight, the road, and the
 * scene after a fight. Hints only might: someone walking off or turning up, a grieving or frightened
 * mood. A hint alone is often wrong (a friend wandering to the next rack isn't a farewell), so the
 * reply decides when it's read. Someone who stayed behind when the scene moved isn't anyone leaving.
 */
export function recordsSay(changes: Change[], st: WorldState, prev?: Moment | null): { firm: Situation[]; hints: Situation[] } {
  const firm: Situation[] = [];
  const hints: Situation[] = [];
  const add = (s: Situation, to = firm) => !firm.includes(s) && !to.includes(s) && to.push(s);
  const trustFell = changes.some((c) => c.kind === "bond" && /\.trust$/.test(c.path) && c.tone === "down");
  for (const c of changes) {
    if (c.kind === "death") add("grief");
    else if (c.kind === "secret" && /^revealed/i.test(c.text)) add(trustFell ? "betrayal" : "confession");
    else if (c.kind === "romance") {
      const tier = Number(/\((\d)\/7\)/.exec(c.text)?.[1] ?? 0);
      if (c.tone === "down") add("goodbye");
      else add(tier >= 5 ? "devotion" : "first love");
    } else if (c.kind === "promise") add(/kept/i.test(c.text) ? "devotion" : "betrayal");
    else if (c.kind === "cast" && /\bleft\b/.test(c.text)) add("leaving", hints);
    else if (c.kind === "cast" && /\barrived\b/.test(c.text)) add("reunion", hints);
    else if (c.kind === "mood" && GRIEF_MOOD.test(String(c.to ?? ""))) add("grief", hints);
    else if (c.kind === "mood" && FEAR_MOOD.test(String(c.to ?? ""))) add("fear", hints);
  }
  if (trustFell) add("betrayal");
  const mode = (st.mode ?? "").toLowerCase();
  if (/conflict|fight|combat|battle/.test(mode)) add("the fight");
  else if (prev?.situations.includes("the fight")) add("aftermath");
  if (/travel|journey/.test(mode)) add("the road");
  return { firm, hints: hints.filter((s) => !firm.includes(s)) };
}

/** Everything the records say, firm first. */
export function situationsFromRecords(changes: Change[], st: WorldState, prev?: Moment | null): Situation[] {
  const { firm, hints } = recordsSay(changes, st, prev);
  return [...firm, ...hints].slice(0, 4);
}

const momentReply = z.object({ gist: z.string().default(""), situations: z.array(z.string()).default([]) });

/** What's happening, read from the end of the reply (2.3, layer 2): one helper call, on a cut only. */
export async function readMoment(text: string, cue: { moods: string[]; place: string; present: string[] }, chatId: string) {
  const r = await callJson({
    task: "helper",
    kind: "soundtrack",
    name: "story_moment",
    chatId,
    schema: momentReply,
    system: `You choose music for a story. Say what is happening in this scene right now, so a song about the same thing can play. Reply with JSON only: {"gist": "one plain line, no names", "situations": ["…"]}, with 1-3 situations only from: ${SITUATIONS.join(", ")}.`,
    user: `Place: ${cue.place || "?"}\nHere: ${cue.present.join(", ") || "?"}\nMood: ${cue.moods.join(", ")}\n\n${text.slice(-1200)}`,
    maxTokens: 200,
  });
  return { gist: r.data.gist.trim().slice(0, 160), situations: situationsOf(r.data.situations, 3) };
}

// ---------- how well a song fits ----------

export interface Fit {
  score: number;
  /** The passage that fits best (index into the sheet), or null when none does. */
  passage: number | null;
}

/** Above this, a gist and a passage mean the same thing. */
const VEC_FLOOR = 0.35;

/**
 * How well a song's words fit the moment, 0-3, and its best passage (2.4): situations shared with
 * the passage (x1.5) and with the song (x0.5), the meaning of the moment's gist against the passage
 * (with vectors), who the song sings to (a "to-you" song fits two people together; an "about-them"
 * song one person alone), and a little for the chorus or the passage the song builds to.
 */
export function wordsFit(sheet: LyricSheet | null, moment: Pick<Moment, "situations"> | null, opts: { vectors?: Map<number, Float32Array>; momentVec?: Float32Array | null; present?: number; /** Passages that don't count (Wrong words). */ skip?: Set<number> } = {}): Fit {
  if (!sheet || !moment?.situations.length || !sheet.passages.length) return { score: 0, passage: null };
  const want = new Set(moment.situations);
  const whole = sheet.situations.filter((s) => want.has(s)).length * 0.5;
  const voice = opts.present == null ? 0 : (sheet.voice === "to-you" || sheet.voice === "we") === opts.present >= 2 ? 0.25 : 0;
  let best: Fit = { score: 0, passage: null };
  sheet.passages.forEach((p, i) => {
    if (opts.skip?.has(i)) return;
    let s = p.situations.filter((x) => want.has(x)).length * 1.5 + whole;
    const v = opts.vectors?.get(i);
    if (v && opts.momentVec) {
      const c = cosine(v, opts.momentVec);
      if (c > VEC_FLOOR) s += (c - VEC_FLOOR) * 3;
    }
    if (s <= 0) return;
    s += voice + (p.kind === "chorus" || p.peak ? 0.25 : 0);
    if (s > best.score) best = { score: s, passage: i };
  });
  return { score: Math.min(3, Math.round(best.score * 100) / 100), passage: best.passage };
}

/** Situations a song can't play over: a celebration at a funeral, a homecoming as someone leaves. */
const CLASH: [Situation, Situation][] = [
  ["grief", "celebration"],
  ["the fight", "peace"],
  ["leaving", "homecoming"],
  ["leaving", "reunion"],
  ["goodbye", "reunion"],
  ["heartbreak", "first love"],
  ["betrayal", "devotion"],
  ["alone", "reunion"],
];

/** The song's words go against the moment: one of its situations clashes with one of the moment's, and none is shared. */
export function clashes(sheet: LyricSheet | null, moment: Pick<Moment, "situations"> | null) {
  if (!sheet || !moment?.situations.length || sheet.situations.some((s) => moment.situations.includes(s))) return false;
  return CLASH.some(([a, b]) => (sheet.situations.includes(a) && moment.situations.includes(b)) || (sheet.situations.includes(b) && moment.situations.includes(a)));
}

// ---------- landing the line (docs/18, Part 4) ----------

/** A passage this early plays from the top anyway; one this close to the end has no song left after it. */
const LAND_AFTER = 20;
const LAND_TAIL = 40;
/** The run-up before the passage when the section before it is long. */
const RUN_UP = 8;
/** The section before the passage is short enough to play whole as the run-up. */
const SHORT_SECTION = 25;

/** Where a timed passage starts and ends, in seconds. */
export function passageTimes(sheet: LyricSheet, lines: LyricLine[], index: number): { start: number; end: number } | null {
  const p = sheet.passages[index];
  if (!p) return null;
  const times = lines.slice(p.from, p.to + 1).map((l) => l.t).filter((t): t is number => t != null);
  if (!times.length) return null;
  return { start: Math.min(...times), end: Math.max(...times) };
}

/**
 * Where to start a song so its passage lands on the moment (4.2), or null to play from the top: the
 * start of the section before the passage when that section is short, otherwise the last line that
 * starts at least 8 s before it (a bar or two of run-up, never mid-word). Not for a passage in the
 * first 20 s, nor one ending less than 40 s before the song does.
 */
export function landingPoint(sheet: LyricSheet, lines: LyricLine[], index: number, duration: number | null): number | null {
  const at = passageTimes(sheet, lines, index);
  if (!at || at.start < LAND_AFTER) return null;
  if (duration != null && duration - at.end < LAND_TAIL) return null;
  const before = index > 0 ? passageTimes(sheet, lines, index - 1) : null;
  if (before && at.start - before.start <= SHORT_SECTION) return before.start;
  const starts = lines.map((l) => l.t).filter((t): t is number => t != null && t <= at.start - RUN_UP);
  const point = starts.length ? Math.max(...starts) : at.start - RUN_UP;
  return point < 5 ? null : point;
}
