/**
 * docs/34 1.3: the soundtrack's replay bench. Scenes the soundtrack read (its logged scene readings,
 * and logged plays once there are some) go back through today's picker, on a throwaway copy of the
 * library, and it prints what would play and how likely each song was. With a marked set
 * (`data/evals/music-bench.json`) it also scores the picker: the chance the song played is one
 * marked fits, fine or wrong.
 *
 * No model calls and no network: the copy has no connections, so the words are matched by what the
 * songs and scenes are about, without vectors.
 *
 *   bun run music:replay                      score the marked set (or show the latest scenes without one)
 *   bun run music:replay --show 20            the latest 20 scenes and their likeliest songs
 *   bun run music:replay --pick 40 [--top 6]  choose scenes for the marked set and add their likeliest songs, unmarked (keeps marks)
 *   bun run music:replay --cards out.json     the marked set's scenes and songs (with what the songs are about), for marking
 *   bun run music:replay --json out.json      the scores, as JSON
 *   [--db path/to/mea.db] [--marked path/to/music-bench.json]
 */
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { Database } from "bun:sqlite";

const args = process.argv.slice(2);
const opt = (f: string) => (args.includes(f) ? args[args.indexOf(f) + 1] : undefined);
const num = (f: string, d: number) => (opt(f) != null ? Math.max(1, Number(opt(f)) || d) : d);

const source = resolve(opt("--db") ?? (process.env.MEA_DATA_DIR ? join(process.env.MEA_DATA_DIR, "mea.db") : join(import.meta.dir, "..", "data", "mea.db")));
if (!existsSync(source)) {
  console.error(`No database at ${source}`);
  process.exit(2);
}
const sourceDir = dirname(source);

// Only what the picker reads: the music settings and the songs' words and sheets.
const src = new Database(source, { readonly: true });
const settings = src.query<{ key: string; value: string }, []>("SELECT key, value FROM settings WHERE key LIKE 'music.%'").all();
const lyrics = src.query<Record<string, unknown>, []>("SELECT * FROM song_lyrics").all();
const readings = src
  .query<{ id: string; chat_id: string | null; started_at: number; request: string; response: string | null }, []>("SELECT id, chat_id, started_at, request, response FROM generations WHERE kind = 'soundtrack' AND status = 'done' AND request LIKE '%You choose music for a story%' ORDER BY started_at")
  .all();
const hasPlays = Boolean(src.query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'song_plays'").get());
const playRows = hasPlays ? src.query<Record<string, unknown>, []>("SELECT * FROM song_plays ORDER BY started_at").all() : [];
src.close();

const dir = mkdtempSync(join(tmpdir(), "mea-music-bench-"));
process.env.MEA_DATA_DIR = dir;
process.env.MEA_OFFLINE = "1";

const { closeDb, openDb, run } = await import("../server/src/db/db");
const { allPlays } = await import("../server/src/music/plays");
const { benchFile, chooseScenes, rankScene, readMarked, sceneFromPlay, sceneFromReading, scoreScene, summarize, writeMarked } = await import("../server/src/music/bench");
const { musicConfig } = await import("../server/src/music/director");
const { sheetFor } = await import("../server/src/music/words");
type MarkedSet = import("../server/src/music/bench").MarkedSet;

const marked = resolve(opt("--marked") ?? benchFile(sourceDir));

try {
  openDb();
  for (const s of settings) run("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", s.key, s.value);
  for (const l of lyrics) {
    const cols = Object.keys(l);
    run(`INSERT INTO song_lyrics (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`, ...(cols.map((c) => l[c]) as never[]));
  }
  // Plays are read through the app's own reader, so they go in too (their chats don't, so no keys).
  run("PRAGMA foreign_keys = OFF");
  for (const p of playRows) {
    const cols = Object.keys(p);
    run(`INSERT INTO song_plays (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`, ...(cols.map((c) => p[c]) as never[]));
  }

  const cfg = musicConfig();
  const scenes = [...readings.map(sceneFromReading), ...allPlays().map(sceneFromPlay)].filter((s) => s != null);
  console.log(`Library: ${cfg.library.length} songs (${cfg.library.filter((t) => sheetFor(t.videoId)).length} read). Scenes logged: ${scenes.length}. Words dial: ${cfg.wordsDial}. No vectors, no history, no thumbs.`);
  const name = (id: string) => {
    const t = cfg.library.find((x) => x.videoId === id);
    return t ? `${t.title} — ${t.artist}` : id;
  };

  if (opt("--pick") != null) {
    const n = num("--pick", 40);
    const top = num("--top", 6);
    const set: MarkedSet = readMarked(marked) ?? { version: 1, made: Date.now(), scenes: [] };
    const have = new Set(set.scenes.map((s) => s.id));
    const fresh = chooseScenes(scenes.filter((s) => !have.has(s.id) && s.from === "reading"), Math.max(0, n - set.scenes.length));
    set.scenes.push(...fresh.map((s) => ({ ...s, songs: {} })));
    // Every scene's likeliest songs, today, are in its list (marks already there are kept).
    for (const s of set.scenes) {
      for (const r of (await rankScene(cfg, s)).slice(0, top)) s.songs[r.track.videoId] ??= { mark: null, by: null, title: r.track.title, artist: r.track.artist };
    }
    writeMarked(set, marked);
    const open = set.scenes.reduce((n, s) => n + Object.values(s.songs).filter((x) => !x.mark).length, 0);
    console.log(`Marked set: ${set.scenes.length} scenes (${fresh.length} new), ${open} songs to mark. Written to ${marked}`);
  } else if (opt("--cards") != null) {
    const set = readMarked(marked);
    if (!set) throw new Error(`No marked set at ${marked}; run with --pick first`);
    const ids = new Set(set.scenes.flatMap((s) => Object.keys(s.songs)));
    const songs = Object.fromEntries(
      [...ids].map((id) => {
        const t = cfg.library.find((x) => x.videoId === id);
        const sh = sheetFor(id);
        return [id, { title: t?.title, artist: t?.artist, moods: t?.moods, about: sh?.situations, themes: sh?.themes, voice: sh?.voice, passages: sh?.passages.map((p) => `${p.kind}${p.peak ? "*" : ""}: ${p.gist}`) }];
      }),
    );
    writeFileSync(resolve(opt("--cards")!), JSON.stringify({ scenes: set.scenes.map((s) => ({ id: s.id, moods: s.moods, present: s.present, situations: s.situations, gist: s.gist, excerpt: s.excerpt.slice(-900), songs: s.songs })), songs }, null, 1));
    console.log(`${set.scenes.length} scenes, ${ids.size} songs, written to ${opt("--cards")}`);
  } else {
    const set = readMarked(marked);
    if (set && opt("--show") == null) {
      const scores = [];
      for (const s of set.scenes) {
        const ranked = await rankScene(cfg, s);
        const sc = scoreScene(s, ranked);
        scores.push(sc);
        const top3 = ranked.slice(0, 3).map((r) => `${s.songs[r.track.videoId]?.mark ?? "?"} ${Math.round(r.chance * 100)}% ${name(r.track.videoId)}`);
        console.log(`\n${s.gist}\n  wrong ${Math.round(sc.wrong * 100)}% · fits ${Math.round(sc.fits * 100)}% · unmarked ${Math.round(sc.unmarked * 100)}%\n  ${top3.join("\n  ")}`);
      }
      const sum = summarize(scores);
      console.log(`\n== ${sum.scenes} marked scenes ==\nChance the song played fits: ${Math.round(sum.fits * 100)}%, fine: ${Math.round(sum.fine * 100)}%, wrong: ${Math.round(sum.wrong * 100)}%, not marked: ${Math.round(sum.unmarked * 100)}%\nA wrong song in the three likeliest: ${sum.wrongInTop3} of ${sum.scenes}. Likeliest song wrong: ${sum.topWrong}. Songs in the roll: ${sum.roll} on average.`);
      if (sum.unmarked > 0.1) console.log("Many picks aren't marked yet: run with --pick to add them, and mark them.");
      if (opt("--json")) writeFileSync(resolve(opt("--json")!), JSON.stringify({ summary: sum, scenes: scores }, null, 1));
    } else {
      if (!set) console.log(`No marked set at ${marked} (run with --pick 40 to start one).`);
      for (const s of scenes.slice(-num("--show", 10)).reverse()) {
        const ranked = await rankScene(cfg, s);
        console.log(`\n${new Date(s.at).toISOString().slice(0, 16)} [${s.moods.join(", ")}] {${s.situations.join(", ")}} ${s.gist}  (${ranked.length} in the roll)`);
        for (const r of ranked.slice(0, 4)) console.log(`  ${Math.round(r.chance * 100)}%  ${r.score.toFixed(2)} (mood ${r.parts.mood}, words ${r.parts.words})  ${name(r.track.videoId)}  ${r.why}`);
      }
    }
  }
} finally {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
}
