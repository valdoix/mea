# Design: lyric cues (songs whose words fit the scene)

**Written:** October 22, 2026 · **Base:** Mea `main` after PR #144

The soundtrack (Almanac J3, `server/src/music/`) picks songs by **mood**: the cue reads the story's moods, intensity, hour, weather, place and genre, and the picker scores library tracks by nine mood tags. It never knows what a song is *about*. A breakup song can play over a reunion because both are "tender", and a song about leaving can't be told from one about coming home.

This design gives the soundtrack the songs' **words**. Mea learns what each song in your library says, verse by verse. On a story beat it reads what's happening ("she leaves before he wakes", "the friend was the traitor all along"), picks the song whose words fit it, and, when the lyrics are timed, starts the song at the passage that fits, so the right line lands on the moment. The chip shows the line it matched.

Four parts. **Every part is its own PR.** The numbered steps are the pieces inside a part's PR.

---

## 0. Read this first

### 0.1 What's already in Mea (found while designing)

| Piece | Already in Mea | So this design… |
|---|---|---|
| Library | `music.config.library`: up to 500 tracks (`videoId`, title, artist, moods, instrumental); preferred artists' songs join it by themselves (`refreshTaste`) | adds lyrics and a lyric sheet per track, kept in their own table so the settings blob stays small (1.1) |
| Mood tags | `tagMoods`: the helper model tags songs it knows, 40 per call | the lyric sheet is written the same way, but from the real words (2.1) |
| The cue | `cueFrom(WorldState, genre)`: moods, intensity, hour, weather, place, present people, beat key | gains a **moment**: situation tags and a one-line gist, made on beats only (2.3) |
| Beats | `musicAfterReply` (an `onTrackerUpdate` hook): cuts on a new scene or a `bigMoment` (secret revealed, death, romance ladder, promise kept/broken), only if the song playing doesn't still fit | unchanged rules; the words become part of "fits" and of the pick (3.1) |
| Picker | `pickTrack`: mood overlap, leitmotif (+6, wins), votes, preferred artists, play history, weighted roll | adds a words score and a passage (3.1) |
| Player | `ytmusic.ts`: th-ch's API Server (`pear`) and the Companion Server (`ytmd`). th-ch's app has `POST /api/v1/seek-to {seconds}` (checked on this PC's `/doc`), and a WebSocket at `/api/v1/ws`. Neither app gives lyrics | seeks to the passage on a cut (Part 4); lyrics come from elsewhere (1.2) |
| Network | The soundtrack talks to the app on this PC, and to music.youtube.com only for a pasted playlist | LRCLIB is a new host, so it's a separate switch, off until you turn it on (1.2) |
| Embeddings | `memory/embed.ts` `embeddingTarget()`, used by recall and `lore/semantic.ts`; off or blocked means keywords | passages and moments are embedded when embeddings are on; tags carry it when they're off (2.2) |
| Chip | `NowPlaying.svelte` shows title, artist and `why` | `why` quotes the matched line; a short lyric strip during the passage (4.3) |
| Seeded dice | `sim/dice.ts` `seeded(chatId, seq, salt)` | the pick's roll uses it, so a swipe of the same reply doesn't change the song (3.1) |

### 0.2 Words used in this design

| Word | Means |
|---|---|
| **Lyrics** | A song's words, from LRCLIB, YouTube Music, or pasted by you. **Timed** when each line has a start time (LRC), **plain** when not |
| **Passage** | A verse, chorus or bridge: a few lines that belong together, with a start time when the lyrics are timed |
| **Lyric sheet** | What the helper model reads out of the lyrics: the song's situations and themes, who sings to whom, and a one-line gist plus tags per passage |
| **Situation** | What's happening, from a fixed list both sides use: *leaving*, *reunion*, *betrayal*, *first love*, *longing*, *grief*, *defiance*, *temptation*, *confession*, *homecoming*, *the road*, *the fight*, *aftermath*, *hope*, *guilt*, *jealousy*, *devotion*, *goodbye*, *celebration*, *alone*… (about 30, in `music/situations.ts`) |
| **Moment** | The story side: the situations and a one-line gist of where the story is, made on a beat |
| **Landing** | Starting a song at the passage that fits, so its line comes in on the moment |

### 0.3 Principles

1. **Words refine mood; they don't replace it.** A song whose words fit but whose sound doesn't (an upbeat song about grief over a funeral) loses to one that fits both. Words are a score next to mood, never a gate.
2. **Beats only.** The moment is read, and the words matched, only when the director would already consider a cut (a new scene, a big moment, the start, the next song as one ends). No helper call on ordinary replies.
3. **Lyrics never reach the story.** They aren't put in the storyteller's prompt, the lore or memory. The helper sees them only when writing a sheet, once per song. The story can't start quoting songs.
4. **Your library, your words.** Lyrics are kept on this PC, for songs in your library only. Mea fetches them only with the switch on, sending a title, an artist and a length, nothing about the story.
5. **Never jump mid-song.** Landing happens only on a cut that was going to happen anyway, or on the first song. A song already playing is never scrubbed to a better line.
6. **It always works without words.** No lyrics, plain lyrics, an instrumental, embeddings off, LRCLIB off, the Companion Server (no seek): each degrades to today's picker, one step at a time.
7. **One PR per part,** with tests in `server/test/` for each step, and `bun run test`, `bun run check` and `bun run build` passing. Build the next part while CI runs; merge only when green.

### 0.4 Where things live

| What | Where |
|---|---|
| Lyrics fetch and cache | `server/src/music/lyrics.ts` (new) |
| Situations list | `server/src/music/situations.ts` (new), mirrored in `web/src/lib/situations.ts` |
| Lyric sheets, passages, matching | `server/src/music/words.ts` (new) |
| Moment | `cueFrom` + `momentFrom` in `server/src/music/director.ts` |
| Seek | `seekTo` in `server/src/music/ytmusic.ts` |
| Table | migration 32: `song_lyrics` |
| Settings | `Music.svelte` (lyrics switch, per-song words), `NowPlaying.svelte` (the line) |

---

## Part 1 · Lyrics in the library

**What you get:** each song in Settings › Music shows whether Mea has its words (*timed*, *plain*, *none*, *instrumental*). You can paste words for a song Mea can't find.

### 1.1 The `song_lyrics` table

Migration 32:

```sql
CREATE TABLE song_lyrics (
  video_id   TEXT PRIMARY KEY,
  source     TEXT NOT NULL,          -- 'lrclib' | 'ytmusic' | 'pasted' | 'none'
  timed      INTEGER NOT NULL,       -- 1 when every line has a start time
  lines      TEXT NOT NULL,          -- JSON [{ t: number | null, text: string }]
  duration   REAL,                   -- the length the lyrics were matched to
  sheet      TEXT,                   -- JSON lyric sheet (Part 2), null until read
  sheet_hash TEXT,                   -- hash of `lines` the sheet was made from
  fetched_at INTEGER NOT NULL
);
```

`source = 'none'` remembers a miss, retried after 30 days (a song's lyrics often appear on LRCLIB later). Removing a song from the library removes its row; `music.removed` keeps it from coming back as today.

### 1.2 Where the words come from, in order

1. **Pasted** by you: plain text or LRC (`[01:23.45] line`). Always wins, never refetched.
2. **LRCLIB** (`lrclib.net`, free, no key), when *Settings › Music › Find lyrics online* is on. `GET /api/get?track_name&artist_name&duration` first (exact, ±2 s), then `/api/search` with the title cleaned of "(Official Video)", "- Remastered 2011", "feat. …". Prefers `syncedLyrics` (timed); takes `plainLyrics` if that's all; `instrumental: true` sets the track's `instrumental`. The length comes from th-ch's `/api/v1/song-info` when the song has played, else is left out.
3. **YouTube Music's own lyrics tab** (plain), through the same public page data the playlist reader already uses (`next` → lyrics `browseId` → `browse`). Same switch, since it's still a request about your songs.

A match that's more than 5 s off the song's length, or by a different artist, is dropped rather than risked (a live version's timing would land the wrong line).

Fetching runs as a background job (`music.lyrics`, low priority, one song every 2 s), for songs added to the library and, once, for the library as it is when you turn the switch on.

### 1.3 Settings › Music

- **Find lyrics online** switch, with one line saying it asks LRCLIB and YouTube Music for your library's lyrics by title and artist.
- Each song row gets a small words badge (*timed* · *plain* · *none* · *instrumental*). Tapping it opens the song's words: a **Paste words** box, **Find again**, and the sheet once Part 2 lands.
- A count at the top: "Words for 214 of 260 songs (180 timed)".

**Done when:** a library of known songs fills its words in the background; a miss is remembered; pasted LRC parses with times; turning the switch off stops all fetches; tests cover title cleaning, the length check and LRC parsing (`server/test/music-lyrics.test.ts`).

---

## Part 2 · Reading the songs, reading the moment

**What you get:** each song has a sheet ("*leaving, goodbye · sung to someone left behind* · chorus: she won't be there when he wakes"), and the soundtrack knows what's happening in the story at each beat. Nothing plays differently yet.

### 2.1 Lyric sheets

A helper call per song (`callJson`, task `helper`, kind `soundtrack`, name `lyric_sheet`), batched 4 songs per call. The model splits the lines into passages (using blank lines and repeats; the chorus is the most repeated block) and returns:

```ts
interface LyricSheet {
  situations: Situation[];     // 1–4, from the fixed list
  themes: string[];            // up to 6 free words ("dawn", "the sea", "a promise")
  voice: "to-you" | "about-them" | "we" | "self";  // who sings to whom
  passages: {
    from: number; to: number;  // line indexes
    kind: "verse" | "chorus" | "bridge" | "intro" | "outro";
    gist: string;              // one plain line, no quoting
    situations: Situation[];
    peak: boolean;             // the passage the song builds to
  }[];
}
```

Lines go in numbered; in timed lyrics, a pause of more than 4.5 s between two lines is marked as a break, since LRC files rarely have blank lines between verses. Gists come out. The sheet keeps line indexes, not text, so a passage's words are read from `song_lyrics.lines` when shown. A sheet is remade only when `lines` change (`sheet_hash`). With moods already tagged, the sheet may also correct them (a "bright" song that's about grief keeps *bright* but gains *melancholy* as a second mood).

Cost: a 300-song library is about 75 helper calls, once, spread over the background queue.

### 2.2 Vectors (when embeddings are on)

Each passage's gist plus its song's situations is embedded (`memory/embed.ts`, same model rules and dedupe as recall). With embeddings off or blocked, matching uses situation and theme overlap only (2.4). A model change re-embeds lazily, as lore does.

### 2.3 The moment

`momentFrom(chatId, messageId, cue)` runs only when the director is about to pick (a beat, the start, the next song as one ends). It has two layers:

1. **From the records, free.** This reply's tracker changes map to situations by rules: `dead` → *grief*; `secret` revealed → *confession* or *betrayal* (betrayal when the secret was kept from someone present); `ladder` up → *first love* / *devotion*, down → *goodbye*; `promise` broken → *betrayal*, kept → *devotion*; a scene change with someone leaving the present list → *leaving*, someone returning after 3+ scenes → *reunion*; `mode` travel → *the road*, conflict → *the fight*; the scene right after a fight → *aftermath*.
2. **From the text, one helper call, on a cut only.** The last reply (cut to its last 1,200 characters) and the cue go to the helper: `{ gist: "one plain line of what's happening", situations: [...] }`. Its situations join the records' ones (records first). Skipped when the records already gave two or more situations, and when the soundtrack is only lining up the next song inside the same scene (the last moment is reused).

The moment is kept on `ChatMusic` (`moment`, with the beat key it was made for), so a swipe of the same reply and the next song in the same scene reuse it.

### 2.4 How well a song fits a moment

`wordsFit(sheet, moment)` returns the best passage and a score 0–3:

- situation overlap with the passage (×1.5) and with the song as a whole (×0.5);
- with vectors, the cosine of the moment's gist against the passage, added when above 0.35;
- *voice* matters for companions: a "to-you" song fits a scene between two people; an "about-them" song fits one alone with thoughts of someone (that someone being offstage);
- a chorus or the peak passage gets +0.25 (it's the line people remember).

**Done when:** sheets are written for songs with words and kept until the words change; the moment comes from records alone when they're enough; at most one helper call per cut; tests feed fixed sheets and tracker changes and check situations and the best passage (`server/test/music-words.test.ts`).

---

## Part 3 · Picking by the words

**What you get:** the song that plays on a beat is one whose words fit what just happened, when your library has one. The chip says why: *"fits: leaving — 'I'll be gone before the morning'"*.

### 3.1 The picker

`pickTrack` adds `wordsFit` to each track's score: up to +3, so a song with the lead mood and the right words beats one with the lead mood alone, but the right words can't drag in a song in the wrong mood (it still has to be within 2 of the top to be in the roll). The leitmotif still wins, and with words its best passage is the one used. Instrumentals and songs with no words score 0 and stay in the pool as today.

`stillFits` (the "don't cut" test on a beat) also counts the words: a song whose words fit the new moment holds even if its mood tag doesn't match, and a song whose words go against it (a *celebration* song over *grief*) no longer counts as fitting just by its mood.

The roll uses `seeded(chatId, seq, "music")` instead of `Math.random`, so the same reply picks the same song on every swipe until the beat changes.

### 3.2 Not every beat needs words

The words score applies only when the moment has a situation (Part 2 found one). A quiet new scene (a morning at home) picks by mood as today. This keeps the music from feeling like it's commenting on everything.

A **Words** dial in Settings › Music: *Off* (today), *A little* (words score ×0.5; the default), *Lean in* (×1, and a peak passage within its song gets a further +0.5).

### 3.3 Your hand

- The chip's menu gains **Wrong words**: the song stays liked, but this passage stops counting for this situation in this story (`ChatMusic.wordsNo[situation]`).
- 👍 on a song picked by its words also raises that passage for that situation (+1), the same way votes work today.

**Done when:** on a scene where someone leaves, a library with a leaving song and a same-mood love song plays the leaving song most of the time; a quiet scene picks as before; swipes keep the song; tests in `server/test/music.test.ts` extend the existing picker cases.

---

## Part 4 · Landing the line

**What you get:** when a beat cuts to a new song with timed lyrics, the song starts a few seconds before the passage that fits, so the line comes in on the moment. The chip shows the words as they're sung.

### 4.1 Seek

`seekTo(conn, seconds)` in `ytmusic.ts`: th-ch's app `POST /api/v1/seek-to { seconds }`; the Companion Server's `seekTo` command (to confirm against its docs while building; without it, the Companion Server never lands, rule 6).

### 4.2 When it lands

On a cut (`musicAfterReply` playing a new pick), when all hold:

- the lyrics are timed and the best passage scored at least 1.5;
- the passage starts after 0:20 (earlier means just play from the top) and ends at least 40 s before the song does;
- *Land the line* is on (Settings › Music, under Words; default on when Words is *Lean in*, off otherwise).

Then Mea plays the song, waits until the player reports it (the same wait `pearPlay` uses), and seeks to **the start of the section before the passage**, or to 8 s before the passage when the sections are long, landing on a line start, never mid-word. Starting cold on the chorus sounds like a skip; a bar or two of run-up sounds like a choice.

Never landed: the next song lined up as one ends (it plays from the top, as a song following a song should), a song you skipped to yourself, or the leitmotif when it was already the last song played (it's a return, from the top).

After a landed song ends, the next pick avoids landing again for that scene, so a scene isn't a run of choruses.

### 4.3 The chip

- `why` quotes the matched line, cut to 60 characters.
- While the passage plays (timed lyrics only), the chip's open card shows the current line and the next, from `elapsed` (the 4 s player watch already reads it; while the card is open it reads every second instead).
- A small **Words** toggle on the card shows or hides the strip. It's only the lines of the matched passage, not a full lyrics view.

**Done when:** on th-ch's app a cut to a timed song starts just before its fitting passage; untimed songs, the Companion Server without seek, and the next song in a scene play from the top; tests cover the seek point (section start, 8 s rule, line boundary) with fake timings.

---

## What this isn't

- **No new songs from the words.** It picks from your library. Finding songs about a situation through th-ch's search is a good follow-up, but it adds songs you didn't choose.
- **No lyrics in the story.** The storyteller never sees them (0.3, rule 3).
- **No full lyrics viewer.** th-ch's app has its own synced-lyrics plugin for that.

## Open questions

1. **LRCLIB and YouTube Music lyrics behind one switch, or two?** One is simpler; two lets you keep requests to YouTube only.
2. **Default Words dial:** *A little* (proposed) or *Lean in*?
3. **Land the line** default off, or on with *Lean in* (proposed)?
4. **Situations list:** the ~30 in 0.2, or a shorter one tuned to the genres you play most?
