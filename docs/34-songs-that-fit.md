# Design: songs that fit the scene

**Written:** November 12, 2026 · **Base:** Mea `main` at b2cdbd7 · **Follows:** [lyric cues](18-lyric-cues.md)

The soundtrack already reads each song's lyrics and each scene's situation, and still plays songs that don't fit: a club song about sex over a family darts game, a breakup song under a quiet breakfast. This plan says why, from your own library and the last 262 scenes the soundtrack read, and what to change.

In short: Mea matches a song to a scene on **one shared word** ("celebration", "devotion") and ignores everything that disagrees. The fix is to know each song as a whole (who it's sung to, how the singer feels, how sexual and how loud it is), read the scene the same way, rule out the songs that would grate, and let the helper model choose among the few that are left, with "nothing fits" as an allowed answer.

Six parts. **Every part is its own PR.**

---

## 0. What's going wrong

### 0.1 What I looked at

- The code in `server/src/music/` (`director.ts`, `words.ts`, `situations.ts`).
- Your library, read-only: 368 songs, 359 with a lyric sheet, 347 with timed lyrics, 3 instrumentals. Words dial on *Lean in*, Land the line off.
- The 262 scene readings logged between October 25 and November 11 (the `story_moment` helper calls). I replayed each through the picker's scoring, without play history, thumbs or vectors, to see which songs come out on top.

There is no record of which songs actually played or were skipped, so the replay shows what the scoring prefers, not exactly what you heard. Part 1 fixes that.

### 0.2 What the replay shows

| Scene (as Mea read it) | Came out on top | Why it's wrong |
|---|---|---|
| "Family laughing over a darts tournament" | *Rush*, Troye Sivan | A song about sex. Matched on *celebration* |
| "A big sister waits in the pickup line at school… her kid comes running" | *Glue Song*, beabadoobee | A romantic love song. Matched on *devotion* |
| "A found family finishes dinner chores and heads out for a pool photo" | *claws*, Charli xcx | A song about desire. Matched on *celebration* |
| "Two lovers… she promises her answer will be yes" | *Perfect For You*, Peach PRC | About taking a friend's boyfriend. Matched on *desire, confession* in one chorus |
| "A game wraps up and everyone piles out for a car ride, warm and easy" | *I Wanna Get Better*, Bleachers | Mea's own sheet says it's about grief and heartbreak. Matched on *hope* |
| Playing right now, in a tender daytime scene | *Taken*, Hayley Williams, tagged tense, dread, bright | The chip says "fits: bright, celebration" |

### 0.3 The causes

| # | Cause | Where |
|---|---|---|
| 1 | **One shared word is a match; nothing counts against.** A song scores for each situation it shares with the scene. Its other situations cost nothing, so a song about desire, temptation and betrayal fits a proposal as well as a love song does | `wordsFit` in `words.ts` |
| 2 | **Situations don't say who or how.** *Devotion* is the same word for a lover, a sister and a dog. *Celebration* is the same for a family dinner and a night out. Nothing records whether a song is romantic, how sexual it is, or whether the singer is happy, bitter or joking | `situations.ts`, the lyric sheet |
| 3 | **Your stories ask for what the library has little of.** The 262 scenes asked for devotion 148 times, hope 102, peace 88, homecoming 77. The library has 12 songs about peace and 13 about homecoming, against 146 about heartbreak and 130 about desire. Most scenes have no good song, and Mea plays the nearest one with a confident "fits:" | library vs scenes |
| 4 | **Too many songs tie.** The words score stops at 3 and many songs reach it. In the latest 22 scenes, between 5 and 42 songs were "close enough" (usually about 18), and the pick among them is a dice roll | `pickTrack`, the `near` pool |
| 5 | **A verse is matched, but the whole song plays.** A passage counts three times what the whole song does. With Land the line off the song starts from the top, so the matched chorus may be a minute away and the first thing you hear is something else | `wordsFit` (×1.5 passage, ×0.5 song) |
| 6 | **Mea has never heard the songs.** Moods are guessed from the title and artist alone. *Roses/Lotus/Violet/Iris* is in the library twice, once as tender, melancholy, bright, calm and once as tender, bright. Nothing says how loud or fast a song is, so a club song can follow a quiet breakfast. The scene's intensity is worked out and then never used | `tagMoods`, `cueFrom` → `pickTrack` |
| 7 | **The scene is read thin.** The helper sees the last 1,200 characters of one reply. It isn't told who the people are to each other, and it must name one to three situations even when nothing is happening, so quiet scenes get "peace, hope" and the words always apply | `readMoment` |
| 8 | **A second and third mood can outvote the lead.** A song with two of the scene's minor moods beats one with only its lead mood, so a bright, tender song played in a dread scene (*Love Me Different* in "The Word in Her Throat"). The rule that stops this only works on a tie | `pickTrack`, `lead` |
| 9 | **Mea doesn't learn from you.** A skip records nothing. A thumbs-down is −1 against scores of 7 to 10. "Not for this scene" is forgotten when the scene's lead mood changes. In the long story: 60 songs in the history, 4 thumbs | `musicAction` |

---

## Principles

1. **Rule out first, then choose.** A song that would grate (too sexual for the room, romantic for a family scene, bitter over a happy one) is out before any scoring. The current design can only add points.
2. **The whole song counts, because the whole song plays.** A fitting verse matters only when the song will start there.
3. **"Nothing fits" is an answer.** Then Mea plays for the mood from songs that are safe in the background, and the chip says so.
4. **Lyrics still never reach the story,** and the judge sees Mea's notes on a song, never its words (docs/18, 0.3).
5. **Model calls only where one already happens:** the start, a big moment, and as a song ends. Never on ordinary replies.
6. **It still works with less.** No lyrics, no helper, embeddings off: each falls back a step, down to today's picker.
7. **One PR per part,** tests in `server/test/`, `bun run test`, `check` and `build` green, built in a worktree. Anything that calls a paid model on the real library waits for a yes with the total first.

---

## Part 1 · See what played, and a bench to test against

**What you get:** a history of what the soundtrack played and why, and a way to prove each later part helps.

- **1.1 Play log.** New table `song_plays`: chat, message, song, when, how it started (start, big moment, next song, your skip), the cue and scene reading, the score and its parts, the runners-up, and how it ended (played out, skipped at *n* seconds, thumbs, Not for this scene, Wrong words). Written by `play` and closed by `musicTick` and `musicAction`.
- **1.2 History on the chip.** The open card gets a short "Played in this story" list with each song's reason and how it ended.
- **1.3 Replay bench.** `bun run music:replay` runs logged scenes through the picker and prints the top picks, with no model calls for the scoring half. It works on a copy of the data.
- **1.4 A marked set.** About 40 of the logged scenes, each with the top songs marked *fits*, *fine* or *wrong*. Claude marks them from the songs' lyrics and the scenes' text; you check a sample on a small page under Settings › Music and change any mark you disagree with. Every later part reports its score on this set before and after.

**Done when:** a song that plays leaves a row that says why and how it ended; the bench reproduces the table in 0.2 on a copy of your data.

**Built** (`music/plays.ts`, migration 42, `music/bench.ts`, `scripts/music-replay.ts`, `MusicBench.svelte`):

- The bench reads a throwaway copy of the music settings and song sheets only, makes no model calls and runs in about 2 seconds. It matches words by situations alone, since live vectors would need a paid embedding call per scene, so its numbers are close to the live picker but not identical.
- The marked set is at `data/evals/music-bench.json`, never in the repository: 40 scenes, each scene's 10 likeliest songs (335 marks). The scenes are chosen to spread over the kinds of scene in your stories.
- **Baseline, today's picker on the marked set:** a 17% chance the song played fits, 44% fine, 29% wrong, 10% not marked. A wrong song is among the three likeliest in 26 of 40 scenes, and the likeliest song is wrong in 9. The roll holds about 13 songs on average. Part 4's target is 4 scenes or fewer with a wrong song in the top three.

## Part 2 · Song cards: know the song as a whole

**What you get:** each song in Settings › Music shows what Mea thinks it is: "*romantic · wanting · sexual · energy 4* — chasing the rush of a new lover's touch". You can correct any of it.

- **2.1 The card.** The lyric sheet gains a card, read from the full lyrics in the same helper call that writes the passages:

  | Field | Values | Fixes cause |
  |---|---|---|
  | `about` | one plain line on the whole song | 1 |
  | `bond` | romantic, family, friends, self, a crowd, anyone | 2 |
  | `stance` | happy in it, wanting, losing, mourning, angry, mocking, free, afraid | 2 |
  | `heat` | none, flirting, sexual | 2 |
  | `dark` | any of: death, drugs, violence, self-harm | 2 |
  | `main` / `passing` | one or two situations the song is about, up to three it only touches | 1 |
  | `opening` | what the first minute says, as situations | 5 |
  | `energy`, `pace` | 1 to 5; slow, mid, fast | 6 |

- **2.2 Sound is a guess, and says so.** Mea can't hear a song. The helper guesses energy, pace and moods from the title, artist *and* lyrics, which beats the title alone, and the card marks them as guessed until you confirm or a correction comes in (Part 5). Moods are re-guessed in the same call; moods you set by hand are kept.
- **2.3 One card per song.** Every copy of a song (the album cut, the explicit one, a remix) shares one card, keyed by `songKey`. That ends the two different *Roses/Lotus/Violet/Iris*.
- **2.4 A vector for the whole song.** With embeddings on, `about` plus bond and stance is embedded next to the passages.
- **2.5 Settings.** The song's words panel shows the card with each field editable. A filter finds songs by bond, heat and energy.

**Cost:** re-reading 359 songs at 4 per call is about 90 helper calls, once, in the background. This needs your yes with the total first.

**Done when:** on a copy of your library, *Rush* reads as romantic and sexual, *Glue Song* as romantic, *I Wanna Get Better* as mourning in its main situations; a hand edit survives a re-read.

**Built** (`music/cards.ts`, migration 43, `SongCard.svelte`):

- The card comes back in the lyric sheet's own call, so a song read for its words gets its card at no extra cost. Songs read before cards wait: Settings › Music says how many and about how many helper calls they take, and nothing is re-read until you press **Read them**.
- When a card is read, its guessed moods replace the library's moods on every copy of the song, unless you set those moods yourself. Moods you tapped, or picked when adding a song or playlist, count as yours from now on. The moods a guess replaced are kept on the card, and **Put them back** restores them.
- Energy and pace show as a guess until you change them or press **Sound is right**. A field you edit is kept through a re-read.
- With embeddings on, each card gets a whole-song vector (owner `song_card`, by song key).
- Not yet checked against your real library: that needs the paid re-read. On the dev copy the mock reads cards from word cues, and copies of a song (the live and Unplugged cuts) share one card.

## Part 3 · The scene brief: read the scene the same way

**What you get:** the chip's "The scene:" line reads like "*family · happy · no heat · energy 2* — dinner chores, then out to the pool" and stays empty-handed when nothing is going on.

- **3.1 From the records, free.** Who is present and what they are to each other (romance steps, bonds, roles on the cast), so the scene's `bond` is known without a model: two people on the romance ladder alone is romantic; the same two with a sister and a child in the car is family. A child present leans the scene's `heat` hard towards none: sexual songs drop far down the list instead of being ruled out, and a switch in Settings › Music (on by default) turns the lean off. A death, a fight and the rest stay as they are in `recordsSay`.
- **3.2 From the text, one helper call.** The helper now gets the people and their ties, the ends of the last three replies instead of one, and the records' reading. It returns `gist`, `bond`, `stance`, `heat`, `energy`, **zero** to three situations with a strength each, and `avoid`: a short list of what would grate here ("breakup songs", "anything sexual").
- **3.3 Quiet is allowed.** With no situation, or only slight ones, the words don't apply and the scene picks by sound and the gates (docs/18, 3.2, which the forced one-to-three broke).
- **3.4 Kept per scene.** The brief is reused for the next song unless three or more replies have come since, so most song changes cost no new reading.

**Done when:** the school pickup scene reads as family with no heat; a scene of two people making tea reads with no situations; tests feed fixed records and replies.

## Part 4 · Picking: gates, fit, then a judge

**What you get:** the song is chosen from a handful that all suit the room, and the chip's reason is a sentence, not a list of tags.

- **4.1 Gates.** Out before scoring, unless the scene itself is that thing:
  - heat above the scene's (when the scene's heat is low only because a child is present, this is a heavy cost in 4.2, not a gate);
  - a romantic song in a family or friends scene, and the reverse for a song plainly about family;
  - a stance the scene can't hold: losing, mourning or angry over a happy scene, happy over grief;
  - dark subjects in a light scene;
  - energy more than two steps from the scene's;
  - anything the brief's `avoid` names.

  A leitmotif still passes every gate: you pinned it.
- **4.2 Fit.** Of the songs left:
  - the song's `main` situations count most, `passing` a little;
  - a `main` situation the scene doesn't share costs points (today it's free);
  - the whole-song vector against the brief's gist;
  - bond and stance agreeing with the scene's;
  - energy closeness;
  - a passage counts in full only when the song will land on it; played from the top, the `opening` counts instead;
  - the lead mood rule is made real: a song without the lead mood never stands in for one with it.
- **4.3 The judge.** The top eight go to the helper with the brief and each song's card (never lyrics). It ranks them, gives one line of reason for the first, and may answer that none fit. One call per song change, on top of the brief when that was re-read. The ranking is kept with the reply, so a swipe keeps the song. Songs played lately still sit out, and the roll is now among the judge's top three only.
- **4.4 When none fit.** Mea plays for the mood from songs marked safe in the background (no heat, an easy stance, energy near the scene's), and the chip says "Nothing about this in your library. Playing for the mood." It never claims a fit it doesn't have.
- **4.5 Without the helper.** If the call fails or the helper is off, the fit score picks, as today.
- **4.6 `stillFits`** uses the same gates, so a big moment cuts a song that now grates and holds one that doesn't.

**Done when:** on the marked set, songs marked *wrong* fall out of the top three in at least 9 scenes of 10, and none of the six in 0.2 can be picked for its scene; a failed judge call still plays a song.

## Part 5 · Learning from you

**What you get:** a skip teaches Mea something, and one tap says what was wrong.

- **5.1 Skips count.** A song skipped in its first 30 seconds is a soft no for that kind of scene (its bond, stance and energy band), in this story and, more weakly, everywhere. Three such skips and the song sits out of that kind of scene.
- **5.2 "Not for this scene" asks why,** in one tap: *Wrong words*, *Wrong sound*, *Too much*, *Just not now*. It holds for the whole scene whatever the mood does. Two of the same answer correct the card (energy down a step, heat up a step) and show as a suggested edit in Settings.
- **5.3 Thumbs matter on the new scale.** 👎 twice in a story means never again in that story. 👍 raises the song for that kind of scene, not everywhere.
- **5.4 The chip shows the judge's reason** and, on the open card, the runners-up, so a wrong pick is easy to see through.

**Done when:** a song skipped early three times in family scenes stops being picked for them and still plays in others; tests cover each button.

## Part 6 · What the library is missing

**What you get:** Settings › Music shows what your stories ask for next to what you have: "*Home, family, quiet company: asked for in 165 scenes, 25 songs fit.*"

- **6.1 The gap list,** from the play log and the cards: the kinds of scene (bond, stance, energy) that most often ended in "nothing fits" or a skip.
- **6.2 Suggestions, only on your yes.** For a gap, Mea searches YouTube Music (the public search it already uses for explicit versions, so it works with either app) for songs by your library's artists and ones like them, reads their words, and shows the ones whose cards fit. Nothing joins the library until you add it. The search sends a song or artist name, never anything from the story.
- **6.3 Background songs.** The same page lists songs that are safe under anything (4.4), and offers a short starter set of instrumentals; your library has three.

**Done when:** the page names your real gaps on a copy of the data; a suggestion you decline never comes back.

---

## What this costs

| When | Model calls |
|---|---|
| Once | About 90 helper calls to write the cards (Part 2). Paid, so it waits for a yes |
| Per song change (every three to four minutes of music) | One judge call, plus one brief call when the scene has moved on. Today it is one reading per song change |
| Ordinary replies | None, as today |

## What this isn't

- **Not audio analysis.** Songs stream in the YouTube Music app and Mea never has the sound. Energy and pace are informed guesses that you and your skips correct.
- **Not a new library.** Part 6 only suggests.
- **No lyrics in the story,** and none shown to the judge.

## Decisions (November 12, 2026)

1. **The judge runs on every song change,** not only at the start and on big moments.
2. **A child in the scene is a strong lean against heat, not a hard cap,** and you can turn it off (a switch in Settings › Music, on by default).
3. **Suggestions from outside your library are wanted** (Part 6.2), still added only on your yes.
4. **Claude marks the set of about 40 scenes** (1.4); you check a sample.
5. **Order as written:** Parts 1 to 4 first, as the fix, then 5 and 6. Part 4 ships as one PR, gates and judge together.
