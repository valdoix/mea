# Build plan: a story that keeps up with itself

**Written:** November 10, 2026 · **Base:** Mea `main` at 65a0dd3 · **From:** [the Buffy × Gabriel audit](audits/buffy-gabriel-audit-2026-11-10.md)

*Clawed Out Into October* is six story days and 857 messages long. Mea still briefs the writer as if it were the first night, keeps facts the story overturned, has stopped checking tense, and spends about 44 model calls a reply doing it. This plan covers all 39 fixes from the audit, in 14 parts, most valuable first.

**Flow:** one PR per part, merged when test, check and build are green; the next part starts while CI runs. Work happens in a worktree, not the shared folder. Anything that calls a paid model on real data (golden runs, the sweep in Part 14) waits for a yes with the total first. Production needs a rebuild and restart after each merge.

**Fix numbers** in brackets are the audit's section 8.

---

## 0. What went wrong, in one table

| Symptom in the chat | Where it comes from |
|---|---|
| Wrist-rubbing and a grieving Buffy at message 926 | The card's own after-history instructions ("show her tells…", "don't rush her recovery") and the day-zero `drive` / `mask` / fixed traits are sent unchanged forever. `lore/sincecard.ts` only corrects the card's *opening scene*, not its standing orders |
| "Dawn doesn't know Buffy is alive" drives a reply | Memories are superseded only when a later memory restates the same thing (`memory/reconcile.ts`); an event that overturns one doesn't touch it |
| 300 replies in past tense, no flags | The tense check (`accuracy/guards.ts` `tenseGuard`) is a setting, and it is off (`guards.config.tense: false`); the flags stop at message 400. When it was on it only flagged, and most flags were dismissed. The lesson's `last_broken_seq` (`steer/lessons.ts`) is only moved by that check |
| Summaries call one Wednesday Day 1, 2 and 3 | A record's time label is the summarizer's guess; the clock (`memory/reconcile.ts`) only fills it when the guess is empty |
| Stale clothes, bodies and inventories | `trackers/note.ts` prints `look`, `body` and belongings as last written, with no scene boundary and no validation |
| Gruyère → "(grey" | `accuracy/names.ts` / `guards.ts` `applyGuards` rewrites any capitalised word within a letter or two of a known name or item, in `services/generation.ts` after every reply |
| Checker noise | `accuracy/moreslips.ts` `clockBackRule` reads any stated time as "now"; `statedTimes` drops the minutes of spoken times; name, leak, trait and not-here rules match without a subject |
| Four prompt sends per reply | `services/generation.ts` plan watch: the first try is sent whole, found to have skipped its plan, then planned and sent again. "Planned first" is decided from the model's last three replies, so it flips back |
| "Powell has their own stake in…" | `sim/storyteller.ts:787` builds a proposal for anyone on the roster × any open thread from a fixed sentence; `sim/roster.ts` takes people from the cast, which had streets in it |
| "Ruth is being blackmailed" | `trackers/pressures.ts` draws from a deck for every cast member, pets included |
| "Cold clean air off the ice" all day | `trackers/fold.ts` `case "wx"` takes whatever the model writes as the weather, and `sim/service.ts` anchors the sky engine to it |

---

## Part 1: the brief ages with the story  [1, 28]

*Changed from the first draft.* The story already keeps a "Since the card" note (an always-on Chronicle entry of who the character has become, kept up from memories). What it never touched were the card's standing orders: its post-history instructions ("Show her tells…", "no more than one crack per exchange") and the starting want, fear, tell and looks on the trackers. Those are what this part ages.

- **1.1** `lore/brief.ts` `runBriefJob` (job `lore.brief`), when a chapter closes and at least 40 messages have passed (or the card's instructions changed): a helper reads each line of the card's instructions against the story so far, the latest chapters and the Since the card note, and marks it kept, revised (with new words) or retired, with why. It never adds instructions.
- **1.2** `briefCard`: generation sends the card with its instructions as they stand in this story. Retired lines are left out, revised ones replaced. The card itself is never edited, and a card whose instructions changed since the reading is sent as written until it is read again.
- **1.3** The same reading gives a new want, fear or tell where the story has moved past the card's, written to the trackers after the last message, and names the card's looks that were only the opening's ("pale", "voice hoarse from disuse"), which the trackers drop (`trait X: -pale`; a look you gave is never dropped).
- **1.4** `accuracy/anchor.ts`: the "Who she is: keep to this" anchor adds the story's own newest temperament and wants lines from Since the card, "true where the card disagrees".
- **1.5** A line can be pinned so it stays as the card wrote it, through later readings too. Routes: `GET /api/chats/:id/brief`, `POST …/brief/pin`, `POST …/brief/read`. The panel that shows them is on the trackers (Part 7c, `BriefPanel.svelte`).
- *Dropped:* drift comparing against recent kept replies (Part 10's rolling window covers the voice).

**Not yet seen on real data:** the reading calls a model, so it wasn't run on the copy. It runs by itself at this story's next closed chapter.

**Done when:** a card line about the opening's tells is left out of the story's prompt after a reading, a revised one is in its new words, the card is unchanged, and the starting want and the opening's pallor are gone from the trackers. *(In `brief.test.ts`, through the real prompt preview.)*

## Part 2: facts retire when the story overturns them  [2, 17]

Built in two halves; the rest moves to later parts.

- **2.1** `memory/overturn.ts` `retireUnaware`, after every tracker update: a memory that says someone doesn't know something ("Dawn … does not know Buffy is alive", "Buffy has not told her family she is alive") is superseded once the trackers record that person knowing it, later on the story's branch. One "Dawn Summers knows now: Buffy is alive (#265)" memory replaces however many it retires. It needs most of the memory's words in the fact, never counts a fact that is itself someone not knowing, and for "hasn't told her family" never counts the teller. No model calls.
- **2.2** `restoreUnaware`: when that knowing leaves the branch (a swipe, a delete), the replacement goes and the old memories are active again.
- **2.3** A story truth you add (`settings.truths`, from the panel or an aside) is checked against the 25 memories with the most words in common; a helper names the ones it contradicts, and they are superseded by the truth, kept as a pinned memory of yours (job `memory.truths`). Removing a truth does nothing.
- *Moved:* events other than knowing (an item bought, fixed or lost; a promise kept) to Part 5, where the inventory rules live. Truths retiring inventory lines too. Checking the truths a story already had (one helper call per truth) goes to Part 14, since it calls a model on existing stories.
- Memories you edited or pinned are never touched.

**Seen on a copy of the real data:** 2 memories retired in 66 ms, both by Dawn learning Buffy is alive at #265. The other wrong memories in the audit (the debit-card boots, Buffy's "concussions", "since February") aren't overturned by an event; the boots go when the existing truth is checked (Part 14), the rest are plain mistakes for Part 11's memory tidy.

**Done when:** "Dawn does not know Buffy is alive" is superseded at the reunion and comes back if that take is swiped away; a truth retires the memory it contradicts and leaves the others. *(In `overturn.test.ts`; the first holds on the copy.)*

## Part 3: tense holds  [3, 11]

- **3.1** `accuracy/guards.ts`: when the story's settings name a tense, the tense check runs whatever the guard switch says. The switch now only governs stories with no stated tense, and the "switches between tenses" note.
- **3.2** `steer/editor.ts` `runTenseJob` (job `steer.tense`): a reply plainly in the other tense gets one rewrite of its narration's verbs, before the editor and whatever the editor setting. The rewrite is kept only if every quoted line is word for word the same, every tag is the same, the length is within 15%, and the result reads in the right tense; otherwise it is thrown away and the flag stands. It is applied with the original kept, so Undo works as for the editor.
- **3.3** `steer/lessons.ts`: a broken tense lesson still grows stronger, but no longer raises a second flag beside the tense flag on the same reply.
- *Dropped:* "write for me" already writes present tense on purpose, and "expand" already follows the story's tense; neither needed a change. *Moved to Part 7:* "apply all" for the 25 old proposed edits in this story (with the other open-flag tools).

**Done when:** a past-tense mock reply in a present-tense story arrives in present tense with its speech untouched, and a rewrite that changes a spoken line is discarded. *(Both in `steer.test.ts`.)*

## Part 4: records take their time from the clock  [4, 16]

*Changed from the first draft.* The tracker already keeps a story time for every message (the page shows it under each one); the `messages.story_time` column is simply unused, and stamping it would only duplicate that. The fault was narrower: a record's time label was the summarizer's guess, and the clock only filled it in when the guess was empty.

- **4.1** `trackers/clock.ts` `spanLabel`: "Wed 2001-10-10 08:04 → 09:25", or both days when a span crosses midnight.
- **4.2** `memory/reconcile.ts` `clockSpan` and `reconcileScene`: the clock's label replaces the guess on every scene record. Chapters, arcs and the story take theirs from the same clock when they are built (`memory/build.ts`), and a roll-up is shown its parts' clock labels, not their guesses.
- **4.3** `relabelTimes`, run once per story after its next scene record: every older label is rewritten from the clock. No model calls. Your own edited records are left alone.
- **4.4** The summarizer is told not to count days or guess the month (`memory/prompts.ts`).
- *Dropped:* refreshing the recap each chapter. The recap is written when you ask for it or come back after a break, from the story as it stands then; the stored copy is only a cache.

**Seen on a copy of the real data:** 185 labels changed in 2.2 s. The six arcs now read Tue 9 Oct 21:54 through Mon 15 Oct, and nothing says "Day 3", "late October" or "night" for a morning.

**Done when:** no summary of this story says "Day 3" for 10 October or "late October". *(Holds on the copy; in `retrieval.test.ts`.)*

## Part 5: state that expires  [5, 19, 21, 23]

Built in two halves: **5a**, the people lines, and **5b**, the rest of the state block.

### 5a: what someone wears, feels and carries (built)

- **5.1** `trackers/fold.ts`: a look and the body meters now carry the message they were written at (`lookSeq`, `bodySeq`). `trackers/note.ts`: clothes, and meters and flags like arousal, hunger or "asleep", print only within the scene they were written in; a later scene shows them again only when restated. Injuries and conditions keep their own endings.
- **5.2** `carried`: food from an earlier scene is gone; a thing set down elsewhere in an earlier scene (the cart, a plate, the sofa arm, by the door, not yet paid for) isn't listed; one pair of footwear is on someone's feet, the latest; at most eight things print, latest first.
- **5.3** `cleanBit`: a bracket a model never closed loses its brackets, and a bit that is another ledger line run in ("body Buffy Summers: arousal 5") is dropped.

**Seen on a copy of the real data:** at message 926 Buffy's line no longer has the car scene's "jeans unbuttoned", the morning's arousal, the cream soup, the wrapped toothbrush or the cart; she has one pair of boots on, and eight things. "Pale" and the day-zero wants stay until Part 1's reading runs at the next chapter.

**Done when:** a later scene doesn't show an earlier scene's clothes, body state, eaten food or set-down things, and a broken bracket or a run-in line never reaches the prompt. *(In `expires.test.ts`.)*

### 5b: the rest of the state block (built)

- **5.4** `trackers/today.ts`: TODAY SO FAR starts at the day's first message (last night shows only while today has fewer than three beats). A folded line is one stretch in one place, so a move starts a new line. A folded beat keeps its first clause whole, cut at a comma and marked "…" only when it runs past 14 words; before the morning is dropped, the oldest long lines tighten to eight words a beat.
- **5.5** `trackers/stands.ts`: with nothing due and nothing being talked about, open items rank by weight (a vital promise, a promise, a plan or question, an errand), then newest. A loop whose day has gone by (its due time by 12 hours, or the day its words name, "today", "tonight", "Saturday night", by six hours into the next) leaves `Open:` for a short `Their day went by` line that says it is never still to come.
- **5.6** Facts in play: a fact older than 40 messages needs two words in common with the turn and a stronger match, unless it names the room the scene is in (`trackers/note.ts` `inPlay`). A name the page has said in more than a dozen messages ("Spike-o") is a regular, not news (`memory/named.ts`).
- **5.7** `accuracy/promptcheck.ts`: a "they know now" correction needs the fact to be what the sentence is about: two of the sentence's own words (names and words of telling aside) and a fifth of it, or a third of it. Sharing one word no longer answers a sentence.
- **5.8** `lore/activate.ts`: an entry whose text is only its own name isn't sent, and "essentials" that are only the name fall back to the entry's first two sentences. *(The "empty" entries were these: an entry trimmed to essentials that were just its title.)*
- **5.9** A shared room (kitchen, living room, hall, garage, pool…) is the household's: a model's `room` line can't make it one person's, and the `ROOM:` line skips one that was already filed so. A room is found by its last part only inside the same house.
- **5.10** `stateblock.test.ts`: a take that wasn't kept leaves its ledger lines in the table and none in the state, the note, where things stand, today, or the long threads.
- Also in the note: a pet has no "doesn't know" line and is never "closest" to a secret (`trackers/whois.ts` `isAnimal`); a secret that already came out to everyone near it isn't "close to coming out"; a deadline 12 story hours past is history; what's under someone's clothes prints in an intimate scene only.
- From Part 2: a memory that something is still broken, missing or not yet done says what a closed loop did since ("the faucet still drips … since then: Promise kept: fix the faucet"), where a model reads it (`memory/openlist.ts` `memoryText`). An item bought or lost needed nothing new: 5a's inventory rules cover it.

**Seen on a copy of the real data (the prompt for the next reply):** today runs 06:50 to now in twelve lines, each in its own place; "writing the house constitution today" and the Saturday suit are under `Their day went by`; facts in play are the eyelashes, the darts league and the fridge scoreboard; the two non-sequitur corrections are gone and the true ones remain; the lore block no longer opens on a bare title; `ROOM: Dawn's room` is gone from the kitchen; "Ruth doesn't know" and the three passed deadlines are gone.

**Done when:** the state block for message 926 (on a copy) shows what people are wearing and holding in that scene, starts today at today, and files nothing under the wrong place. *(Holds; `stateblock.test.ts`, 14 tests.)*

## Part 6: the word-fixer only suggests  [6]

- **6.1** `accuracy/names.ts` / `guards.ts`: nothing is rewritten in a reply. A slip becomes a quiet suggestion, and only when the target is a person or place name, the word is not in the dictionary, and it is not in italics or inside a quoted mispronunciation.
- **6.2** The same rule for the "name" continuity flag.
- **6.3** *Moved to Part 14:* the repair of past rewrites still in the text (this story: 135, 151, 269), from each reply's stored original. It changes real replies, so it waits with the other repairs.
- **As built:** a slip's target must be a word of a person's or place's name that isn't an ordinary word; the slip keeps the name's first letter; words are read whole in any script; italics are skipped. The "Correct it" choice is gone from Settings and from the story's guards; a stored "fix" reads as "note".

**Done when:** "Gruyère", "Hugh", "Flour" and "Slower" pass untouched in a test, and "Rovello" in italics is left alone.

## Part 7: the checker says less and catches more  [8–12]

Built in parts: **7a**, the false alarms; **7b**, the page search and the new checks; **7c**, the open-flag tools.

### 7a: fewer false alarms (built)

- **7.1** `accuracy/moreslips.ts` clock check: a time counts only when the reply states it as now ("It's seven", "the clock reads 6:40 a.m.", "Eleven-oh-eight a.m., Sunnydale Mall."), not when it mentions one ("the sofa where she slept at seven a.m."); habits ("after bad patrols", "every night at two") are skipped; just past midnight is later, not earlier; spoken times are read whole ("seven forty-two a.m." is 7:42, not "two a.m.").
- **7.2** `accuracy/rules.ts`: a leak needs the verb to be the person's ("Joss leans in and says…", not any verb in a sentence that names Ruth), and the words of people's names are never a secret's words. An eye or hair colour that someone else in the story has is theirs ("ocean-blue eyes" are Gabriel's, not Dawn's). The time-of-day check skips memories ("the floorboard Joyce stepped over at midnight").
- **7.3** Not here: anyone the player's own turn names is in the scene.

**Seen on a copy of the real data:** replaying the rule checks over all 429 replies, findings fell from 63 to 17: clock 34 → 5, not here 17 → 9, wrong-person colours 4 → 0, leaks 3 → 0, memories read as the time of day 3 → 1. Nothing new was flagged. (The model's own checks, "fact" and "past", weren't replayed: they call a model.)

**Done when:** the clock, leak, colour and not-here families fall by most of their false alarms on the replay, and the existing golden scenarios (a real leak, a real clock slip) are still caught. *(Both hold; `checkerquiet.test.ts`, `checks.test.ts`, the golden suite.)*

### 7b: the page is searched, and four new checks (built)

- **7.4** `accuracy/checker.ts` `onThePage`: before an invented-past flag ("no record of X") is kept, the transcript is searched. One earlier message holding most of the claim's own words (three at least, 60% of them, the cast's names aside) is the record, and the flag is dropped. No model. *(The helper's own re-reading of the story, `settledByStory`, was already there for what this doesn't settle.)*
- **7.5** `accuracy/worldslips.ts`, four checks in the catalog, none calling a model:
  - **Daylight**: a vampire (by trait or Codex page) walking out of doors while the story clock is between sunrise and sunset, with nothing covering them. A truth of yours that they can be out by day turns it off.
  - **The date**: a weekday said as today that the date contradicts ("a Thursday morning" on Wednesday 10 October), and a part of the month that doesn't fit ("late October" on the 12th). A day used as a figure of speech ("a Tuesday problem"), a habit or a plan is left alone.
  - **The year**: things the story's year didn't have yet (emoji in 2001), from a list of about thirty with the year each could first turn up. Only for a dated clock, and never for something your own turns brought in.
  - **One value per person**: a blood type, a surgeon's specialty or a place in the family tree said differently from your truths, or from every memory that gives that person one. Records that disagree with each other settle nothing until a truth does.
- Part 13's weather check learned what isn't weather: a frost-crusted freezer, snow on a screen, parmesan "in a snowfall".

**Seen on a copy of the real data** (the rule checks replayed over all 429 replies, no model): nine findings from the new checks, all real and none false: "a Thursday morning" on Wednesday (#63), "the wrong end of October" on the 10th (#55), "late October" on the 12th (#619), a Saturday on Friday (#657), the emoji (#784, #786), frost in a mediterranean October (#874, #878), and Spike walking out at midday (#926). Spike's blood type isn't flagged: the memories hold both O positive and O negative, so it needs the truth that Part 14 sets.

**Done when:** the audit's true catches of these kinds are found on the replay with no false alarm beside them. *(Holds; `worldslips.test.ts`, 13 tests.)*

### 7c: the open-flag tools (built)

- **7.6** `accuracy/opennotes.ts`, shown at the top of the story's health panel (`OpenNotes.svelte`):
  - **A count**: open notes on the replies that are showing (waved-off and quiet ones aside), and editor suggestions left as "proposed".
  - **Fix all**: every open note that carries a fix has its sentence rewritten in its reply, oldest first, one helper call a note, at most 20 a press (`FIX_ALL_MAX`), in the background (`accuracy.fixall` job). It asks first with the count. Each change keeps the reply's own Undo. A note whose sentence is gone is left.
  - **Apply all**: every editor suggestion still waiting is applied, no model. One whose reply changed since is left and counted.
  - The one-click fix on a single note was already there; it is the same call.
- **Part 1's brief panel** (`BriefPanel.svelte`, on the trackers): each of the card's standing instructions as it stands in this story (kept, reworded with the new words, or retired), the reason for each change, the want/fear/tell and traits the read moved, and how far it has read. "Keep as written" pins a line so the story doesn't reword it again; "Read again now" runs the read (one helper call) without waiting for a chapter to close.

**Done when:** a story's open notes and waiting suggestions are one number on its health panel, and one press clears each. *(Holds; `opennotes.test.ts`.)*

## Part 8: plan once, and send less  [7, 14, 37–39]

Split in two, both built: **8a**, the plan watch, and **8b**, sending less.

### 8a: the plan watch stops flip-flopping (built)

The watch already made a plan-skipping model plan in its own step (two calls a reply). But after six replies planned that way it let the model try its own pass again, and when the model skipped again that reply cost a wasted try or a planner rescue (three calls). In one story that happened about every eighth reply: 109 "asked again", 90 rescues, 102 planned first in 429 replies.

- **8.1** `services/generation.ts` `skipsPlans`: the model tries its own pass again only after 30 replies in a row planned first (`PROBE_AFTER`), not six.
- **8.1b** In a story where this model skipped its plan twice in its last ten replies, it never tries again: it plans first there for good, whatever its record elsewhere.

**Done when:** a long run of planned-first replies earns a probe only at 30, and a story with two recent skips never probes. *(In `review.test.ts`.)*

### 8b: send less (built)

What was measured first, on a copy of the real data (no model calls):

- The next reply's prompt is 77k tokens, and its system part 111k characters. The largest single piece was the Bond entry, 17.5k characters: all 78 milestones you had kept from keep-up's cards, sent on every call. The arc, chapter and scene summaries are another 45k characters (11k tokens, the story's memory from #1).
- **Why #461–685 reached 150k–510k tokens** (8.4): two things on top of each other. The Claude profile's context target was 200k for #383–796 (100k before and after), so Mea sent 100k–135k tokens a call, history alone averaging 67k. And that stretch ran on a relay's "[SP]" models, which counted 2–3× what was sent (14–22× on small calls). The same models by name on the same relay counted 1.1× (Opus 4.6) and 1.6× (the 5.5 tokenizer). Mea keeps the provider's last usage figure; it doesn't add them up. So the 510k was the relay's count of a 128k request.

Built:

- **8.3** `lore/facts.ts` `forScene`: a list that only grows (milestones, running bits, what someone knows; facts of kind event or bond) rides with its newest 8 (`NOW_SHOWN`) and up to 3 older ones the scene is about (`NOW_RECALLED`): two of their own words in the last four messages or yours, leaving aside words a third of the list shares (the leads' names). Standing facts are never cut. The Bond went from 17.5k characters to 4.9k, and the system part from 111k to 99k.
- **8.2** `services/generation.ts` `planScale`: where the provider keeps no prompt cache, the plan step is sent the story prompt at 0.6 of the target (77k → 43k tokens, the last 29 messages, half the recalled memory). With a cache it gets the same prompt as the reply, since the shared prefix is then read back cheaply.
- **8.4** `accuracy/health.ts` `overBilled`: the health panel's Cost line names a model when most of its last 20 story calls were counted at more than the prompt could hold (under 1.8 characters a token) or at 2.2× Mea's estimate or more: "[SP]claude-opus-5-5 counts about 3.2× what Mea sends". Replayed over the story it names the "[SP]" stretches (#485–661, #780–796) and nothing else. *The context target is the ceiling on what Mea sends; it's yours to set, and it isn't overridden.*
- **8.5** The helpers:
  - `steer/advisor.ts`: a plan made while you type is used only if you send the very words it was made for. Typing plans again only once the draft has 6 new words (`DRAFT_NEW_WORDS`), at most 3 times a turn (`DRAFT_PLANS`). Before, it planned every 15 seconds of typing: about five planner calls a reply, 2,179 calls and 19 million tokens over 429 replies.
  - `lore/keepup.ts`: an entry with fewer than 3 new memories waits for more (`KEEPUP_BATCH`), unless 30 messages have passed since it was read (`KEEPUP_WAIT`) or a tracker change is waiting. "Draft facts" on an entry reads it at once. Keep-up made 1,838 calls over 277 scenes, most of them one entry with one memory.
  - Journal and keep-up already ran once per closed scene. The continuity check stays per reply, since its notes are about the reply you're reading. The librarian was cut to once per new note in docs/27 6.3.
- *Dropped:* **8.6**, retrying failed embedding jobs. The embedding job embeds whatever lacks a vector each time it runs, so the 14 failed runs caught up: one active memory in the story has no vector.

**Done when:** a long list no longer rides whole on every call, the plan step is smaller where nothing is cached, a route that over-counts is named on the story, and typing and keep-up make fewer calls. *(`sendless.test.ts`, 8 tests; `keepup.test.ts`.)*

## Part 9: long threads stay in view  [20, 22]  (built)

- **9.1** `trackers/longthreads.ts`: a "Long threads" list, in the Story panel just above Open loops. It holds promises and plans with a day, open conflicts, secrets still kept from someone, and what you pin (with an optional "when"). Days are read from the loop's own due time, or else from its words, counted from the story time when it was said: tonight, tomorrow, a weekday ("Saturday night", "Monday after school", "next Thursday"), this week, next week, this or next weekend, "in three days". A routine ("every Friday") gets no day. A week comes due on its last day, not all week. Once its day is over, a thread stays two more days as "its day passed and nothing on the page closed it", then drops off. One thing said three ways on one day is one thread, and so are two lines about one conflict. No one kind fills the list (three conflicts, two secrets, two passed at most), a secret kept from more people ranks higher, and there are ten lines at most. A thread leaves when its loop closes or its secret comes out.
- **9.2** The planner and advisor get the whole list every turn (`LONG THREADS`), and may name any of its ids in a plan's threads (`ledgerThreads` takes the `S…` and `P…` ids too). On its day, a dated thread goes into the plan's threads whether the planner picked it or not. The state block shows the top three (the planner reads the whole list once, not again in the state block). A separate planner's threads now reach the writer in `<director-plan>`.
- **9.3** `steer/swipes.ts`: each earlier take in the swipe digest says why it was passed over when Mea knows: the note you gave with the next take, the angle you picked, a check it failed (the guard's retry), or what an open continuity flag found. `startStory` stores that on the new take as `passedOver`.

**Seen on a copy of the real data** (story time Mon 2001-10-15 14:06): the list is today's 3 o'clock pickup and the Monday cooking lesson (due today), the suit on Saturday night (passed), Eleanor's shopping trip "next week" (coming up), Willow's apology, the audit and the Council (conflicts), the grave and heaven secrets (kept from Willow, Xander, Tara, Anya, Dawn…), and Friday's film. "The rings this week" never became a loop, so it needs a pin. In the browser, pinning and unpinning work.

**Done when:** in a fixture, a promise dated "this week" appears in the plan's threads on the last day of that week. *(It does, and not on the Thursday before; `longthreads.test.ts`.)*

## Part 10: prose habits cool on their own  [24–27]  (built)

- **10.1** `steer/cooling.ts`: the cooling list, by counting over the last 20 replies (eight at least), with no model. What goes on it: a word family in 35% of them (filing: filed, file, drawer, folder…; courtroom: ruling, docket, counselor, overruled, for the record…); a sentence shape in 35% ("Not X. Not Y.", "the kind of…", "a whole thing", lines built of false starts, opening on the house's own noise); a coined, hyphenated word in 30% that was rare before and spans three scenes ("load-bearing", "anchor-grip"); and, while the coach is paused or off, a 3–5 word phrase in 30% ("her hand finds", "filed under ours"). It comes off by itself when it fades. It runs whether or not the coach is paused, with its own switch in the Craft panel ("Cooling on/off"), and "It's fine" takes one off for good. *Plain words were tried and dropped: on the real story they were the scene's props (toast, the table, Saturday).*
- **10.2** A family, word or shape that one person says (60% of the hits in the lines Mea knows the speaker of) is theirs: the line says only they may use it, in their own lines, at most once, and nobody else, nor the narration. Otherwise it rests for everyone.
- **10.3** `memory/journals.ts`: each journal gets that person's own lines from the scenes it covers (`ownLines`) as the voice to write in, and is told not to borrow anyone else's running bits and to quote others only in passing.
- **10.4** A `THIS REPLY` lane: after a turn of 40 words or fewer, "answer in kind, about 150/250 words at most, unless something turns" (your length setting wins); when 70% or more of the last ten replies ended on the room, "end this one on something {user} can answer: a line, a look, a question".
- **10.5** `steer/tidy.ts`, on every reply after the quote style: a toolkit closer written with its attributes becomes a closer; a sentence said twice back to back (20+ characters) is said once; a stray word from another script in an otherwise Latin reply goes (never inside a toolkit tag or brackets, so kaomoji stay). `mendMarks` now reads `[//spk]` and `[c/spk]` as closers. Curly quotes were already the style's job. What it fixed is kept on the take as `tidied`.

**Seen on a copy of the real data:** before #365 the list is filing words (Buffy's), "the raw ring", "Not X. Not Y.", "the filing system", "anchor-grip"; before #589 filing words, "her hand finds", "filed under ours"; before #795 and now, courtroom words (Buffy's) lead. The ending line fires through most of the story (8–10 of every 10 replies ended on the room). The tidy pass, run over all 429 replies, mends the stray marks at 115, 117, 123 and 756 and the broken closer at 547. The repeat at 111 and the stray "祈祷" at 876 aren't in the current takes (the audit's numbering, or an edit since), so they're covered by tests only. In the browser, the Craft panel shows the list with the coach paused.

**Done when:** in a mock run where every reply uses "ruling" and "docket", the family is cooling by reply 12 and absent from the instructions' allowed list for everyone but its owner. *(Cooling from reply 8, with Buffy as the only one allowed; `cooling.test.ts`.)*

## Part 11: cast, places and memory tidy  [13, 15, 18]  (built)

The tracker's own cast was already tidy after docs/30 and docs/32 (27 people, no stage notes). What was left came from memories and scene records, which name whatever a sentence mentions, and from pages older syncs had made.

- **11.1** Names that aren't people (`trackers/whois.ts`, `memory/casttidy.ts`, used by the fold and by the cast sync):
  - a ledger word ("unchanged", "Co."), a company ("Winters Holdings" is a group), a school or hospital ("Sunnydale High", "Sunnydale General" are places), several people under one description ("board members", "two delivery men in grey shirts"), a group the story already has ("Hellions"), and the first word of a street the story has ("Powell" is Powell Street);
  - someone the story only mentions as part of a film or a poem (Mulan, and Li Shang, who is only ever mentioned with her) is a reference, kept as a concept. Only for names with six memories or fewer that were never in a scene;
  - other names lose stage directions ("Spike (offscreen, approaching)"), sentences ("Frank charges $12-14"), slips one letter off a name already kept ("Gupert Giles"), and the possessor of a role ("Gabriel" was another name for "Gabriel's father", and took 149 of Gabriel's mentions);
  - a role name is the person a group's roster gives that role to: "Gabriel's mom" and "Gabriel's mother" are Eleanor Winters, "Gabriel's father" is Jonathan.
- **11.2** Places are read against the tracker's own tree (`placeAs`): "Gabriel's kitchen (darkening)", "The hills house kitchen" and "Kitchen of the hills house" are the Winters Residence kitchen; "1630 Revello Drive kitchen" and "Summers kitchen, 1630 Revello Drive" are the Summers Residence kitchen. A seat, a counter, a bare "hallway" with no house and a trip ("driving to Revello Drive", anything with an arrow) are not places of their own. A page whose name moved is merged into the page it became; one nothing names any more is put away, and comes back if the story names it again. Pages you edited or locked are never touched. *Changed from the plan:* this runs with every sync instead of as a one-time proposal, since both steps can be undone from the page.
- **11.3** `memory/consolidate.ts`: a person past 20 mentions with no written profile is first in line at the next consolidation (eight a run, up from six). The profile itself is the helper call that was already there.
- **11.4** `memory/atoms.ts`: a small physical beat (one sentence, a thing moves or makes a sound, nothing said, decided or learned) is stored at importance 3 at most, so it fades and folds into a digest unless a reply uses it. The same thing in nearly the same words (85% of its words) is a duplicate on write.
- **11.5** A lore entry can say who knows it ("Who knows this" in the entry editor). It is sent with a line saying nobody else saw it or was told, so it stays out of other people's heads. *Not built:* the checker reading that line; the leak check already covers secrets, and Part 7 adds the transcript search.

**Seen on a copy of the real data:** people 133 → 43, none of them a street, a school or a company; places 455 → 117; Spike's and Ruth's other names are clean; Eleanor carries "Gabriel's mom" and "Gabriel's mother", Jonathan "Gabriel's father". A second sync changes nothing. Left as it is: "Joyce's kitchen" beside the Summers kitchen (nothing says Joyce lived there), and "Gabriel's bedroom" beside the "upstairs bedroom".

**Done when:** this story (on a copy) folds to under 120 places and no person entry is a street, a school or a company. *(Holds; `casttidy.test.ts`, 15 tests.)*

## Part 12: subplots and the world  [29–32]  (built)

- **12.1** A pet leads no subplot (`sim/storyteller.ts`, by `isAnimal`). Streets, shops and companies stopped being people in Part 11, so they can't lead one either.
- **12.2** The fixed sentence ("X has their own stake in …") is gone. A thread seeds a subplot only when it was touched in the last two chapters (`liveFrom`, or 150 messages back before there are chapters) and its lead has a want on record or the thread's words say what kind of subplot it is. The premise is the thread's own latest line and what the lead wants; the reason shown says when the thread was last touched.
- **12.3** What the story set up and left open is a seed (`long`, from Part 9's long threads): an open conflict, a promise with a day, a secret still kept. Its lead is the first person it names who is off the page ("Willow must return and apologize" is Willow's move), and it outranks the other seeds.
- **12.4** A kind of subplot turned down three times among your last six answers rests until newer answers push those out.
- **12.5** `trackers/pressures.ts`: a pet draws no pressure, and one drawn before this is never played. The deck is only for people the story has said something about (a trait, a want, a page). Someone settled with a partner doesn't draw a romance card. Redraw says so when there is nothing to draw from.
- **12.6** Incidents are made from the story's own places (a street, a mall, a school, a hospital, a cemetery it has actually named), each with a way onto the page ("it was on the car radio", "someone mentions it in passing"; other words for other eras). The general pool lost its harbour, high street and market prices, and is used only for storms, fog and named days, or before the story has places.

**Seen on a copy of the real data:** the candidates now are Eleanor's shopping trip next week (Eleanor), Willow's apology (Willow), the audit of Joyce's accounts (Eleanor), and four people the lore gives a story of their own (Drusilla, Quentin Travers, Cordelia, Rack the warlock). Nothing is led by a place, a shop or the cat, and nothing is built on "first day back". *Not changed:* the wording helper that turns a premise into prose (it wrote Walter's "family expecting reports"); it now starts from a truer premise.

**Done when:** proposals generated for this story on a copy have no non-person leads and none built on a thread older than two chapters. *(Holds; `subplots.test.ts`, 7 tests.)*

## Part 13: weather  [33–36]  (built)

- **13.1** `trackers/weather.ts` `wxKind`: a `wx` line is weather (sky, rain, wind, a temperature outdoors), the air of a room ("cold clean air off the ice", "sixty-two degrees in the house"), or light and mood ("first thin gold on the kitchen tile", "kitchen half-dark, fridge hum"). Only weather becomes the story's weather. Light is kept for its scene and shown in `NOW`; a room's air is kept as `indoors:` while the scene stays in that room. The tracker is told the same in its grammar.
- **13.2** `sim/sky.ts` `outOfClimate`: a weather line the climate can't have at that time of year (frost where the coldest autumn night is 14°C, a stated temperature far outside the season's range) is not taken as the sky's anchor; the forecast stands, and the World panel says which line was turned down and why. The fold stays free of the climate, so the check sits where the sky is put together (`sim/service.ts` `storyWeather`).
- **13.3** One plain `SKY:` line in every state block: the weather, the temperature, sunrise or sunset, the season, and `indoors:` when there is one. The story's own words stand for three story hours after they were written, then the sky's take over. *The fault behind "cold clean air off the ice" all day was here too:* the anchor was always "half an hour ago", so a weather line never aged. It is now anchored to the story minute it was written at (`weather.at`), and fronts move on from it.
- **13.4** The season already came from the date when the setting is blank (the `SKY:` line and the clock both work it out); nothing needed changing.
- **13.5** `accuracy/worldslips.ts` `weatherRule` (check "Weather"): a reply that writes frost, snow or a heatwave the climate can't have at this date is flagged, skipping memories, wishes and comparisons. A reply making ordinary weather (rain arriving) is the story's right and is not flagged.

**Seen on a copy of the real data:** the story's weather at 926 was "silver-and-cold October morning, frost on the car"; it is turned down (a mediterranean autumn night is about 14°C at its coldest). The line now reads `SKY: overcast, 25°C · sunset 17:38 · autumn`. "Cold clean air off the ice" is held as the rink's air and isn't shown at the house.

**Done when:** a mock reply writing "kitchen half-dark, fridge hum" as weather leaves the forecast in place, and the 926 state line on a copy reads as an October afternoon in Sunnydale. *(Both hold; `weather.test.ts`.)*

## Part 14: repairs for this story  (done 2026-11-11, on the real data)

Run after a backup (`data/backups/mea-before-part14-2026-11-11.db`), with production stopped while it ran. Rehearsed first on a copy, the mock model answering. Nine helper calls on GLM 5.3: about 18k tokens in, 2.5k out.

- **Text, kept for Undo on each reply:** 135 "Racks on three walls", 151 "Looser.", 269 "Gruyère" (twice). The plan and the model's thinking came off the top of #287, which now opens "The mug is Joyce's." The BALLET! album (#736) and the daisy mug (#742) left the Winters kitchen, a helper call each, and their notes are marked fixed. These edits don't mark the scenes' records stale. With rebuilding on edit set to auto, they would have rebuilt every scene, chapter and arc above them (about 40 calls) and rewritten their memories.
- **Not repaired, because they aren't in the story:** #279 (Ruth at Revello) and #593 (the faucet) are replies deleted in October. Their notes sit on deleted messages. The heart surgeon at #443 is in a take that isn't showing.
- **Memories superseded** (Undo from the memory inspector): the debit-card boots (two), Gabriel's injuries stored as Buffy's, "since February", and "Gabriel never fed Buffy soup". Part 2's retirement took "Dawn… does not know Buffy is alive" and "Buffy has not told her family". Part 4's relabel put the clock's labels on the summaries.
- **Truths:** "Spike likes O positive (O+) blood best", from your turn at #716. Then all six truths were checked against the memories. The helper superseded six; three were wrong and are active again (the car "I lo—", Eleanor asking after Dawn, the blue tee), as is the one about Dawn's neglect, whose O-negative is what Dawn bought. The two that stand are both stale: "neither has said the word love aloud yet", and "'Gabe' carries the weight of 'I love you'…".
- **Cast:** Part 11's sync (people 44, places 121), then four places merged: Gabriel's kitchen (both names) into the Winters Residence kitchen, Joyce's kitchen into the Summers kitchen, "Gabriel Winters' bedroom" into Gabriel's bedroom, Buffy's childhood bedroom into Buffy's Bedroom. Clara is "William's daughter" in the Winters Family group.
- **The second chapter** called "The Whole Word, No Takebacks" (#533) is now "Wifey, Filed Under Forever".
- **Your two decisions, the same day:** Spike can't be out by day, and Dawn buys his blood from a dealer on Powell Street, not the butcher on Third. Both are story truths now (after a second backup, `data/backups/mea-before-truths-2026-11-11.db`). The truth check, two helper calls, retired one memory: "Dawn bought two pints of O negative from the butcher on Third every Tuesday". Nothing in the memories had Spike out in daylight.

## The audit, checked (2026-11-11)

Every finding in the audit, against what was built, checked on a copy of the real data. "Repair" means Part 14.

| Audit finding | Where it stands |
|---|---|
| **1.1** Day-zero brief at 926 | Part 1; the panel is 7c |
| **1.2** Facts never retired | Part 2; #197 retires on the next reply (seen on a copy); the rest is a repair |
| **1.3** Tense; 25 editor fixes left "proposed" | Part 3; "Apply all" in 7c |
| **1.4** No story time on messages; guessed labels | Part 4 |
| **1.5** Stale, garbled state | Parts 5a and 5b. At 926 on a copy: no car-scene clothes, no "hungry, thirsty; belly full", brackets balanced |
| **1.6** Word-fixer | Part 6; 135, 151 and 269 are a repair |
| **1.7** Checker noise; true catches left open | Parts 7a and 7b; "Fix all" in 7c; the five flags are a repair |
| **1.8** 44 calls a reply; 150k–510k tokens | Parts 8a and 8b. The 510k was a relay's count of a 128k request, now named on the Cost line |
| **1.9** Weather | Part 13 |
| **1.10** Subplot filler | Part 12 |
| **2** Dates: wrong weekday, "late October" | 7b date check |
| **2** "Since February" | A repair (#149) |
| **2** "Known for six hours", "seven in the morning" after "almost nine", wet hair at 7 a.m. | The clock check (7a) catches a time going backwards. *A wrong length of time since an event has no check.* |
| **2** Toothbrush, slippers, henley, the grey tee, three pairs of shoes | 5a: clothes and belongings expire, one pair on a pair of feet |
| **2** Album, mug, faucet, Ruth at Revello | Repair (flags 736, 742, 593, 279) |
| **2** Foot Locker in a strip mall described without one | *No check: a place's contents aren't recorded.* |
| **2** Place names fork | Part 11 |
| **2** The cat's name and Giles at the airport known too early | 11.5 "who knows this" on lore; the leak rule (7a) |
| **2** The soup "his dead nanny's recipe" a message early | The leak rule and the people block. *No check for a guess that turns out right.* |
| **2** Two Merrick stories, "fired from a coffee shop" | *No check: two tellings of one past event aren't compared.* |
| **2** Heart surgeon, great-grandfather, Dawn as a sister | 7b one-value check (a surgeon's specialty, a place in the family tree) |
| **2** Gabriel's injuries stored as Buffy's | A repair (#583) |
| **2** Boots and the debit card | A repair (#391, #419) |
| **2** Blood: supplier, pints, type | Type: 7b, once the truth is set (repair). Supplier: a repair. *"Two pints" against "21 pints" has no check.* |
| **2** "Tara told me about the Powell guy" | 7b: the page is searched before "no record of X" |
| **2** Spike in daylight | 7b daylight check; the truth is a repair |
| **2** Dawn "the small child" | *No check: an age said against a description.* |
| **2** Period slips | 7b year check |
| **3** Memories wrong and still active | Part 2, then a repair |
| **3** Trivia at full confidence | 11: small beats stay small |
| **3** Failed embedding runs | They caught up (8.6). Memories that can't be found by meaning are counted on Story records |
| **3** Recap never refreshed | Written when asked for or after a break; the stored copy is a cache (Part 4) |
| **3** Places duplicated, non-people, polluted aliases, unlinked parents | Part 11; two duplicates left are a repair |
| **3** "Clara (William's son)" | A repair |
| **3** Four cast profiles | 11: profiles once someone has 20 memories |
| **3** Two chapters with one title | Chapters and arcs are told the titles taken; the second is a repair |
| **3** Verifier "major" with nothing done | Already rewritten: all 29 "major" scenes were rewritten on the spot |
| **3** Scenes skipped for quota | Counted on Story records; rebuilding one checks it. *The verifier's own mistakes have no check.* |
| **3** State block at 926 | 5b: facts in play, open items, today, corrections, pets, traits, empty entries; 12: pressures |
| **3** Events from rejected takes | The fold reads the takes showing only (`trackers/store.ts`), so they're ignored |
| **3** The checker's families | 7a |
| **4** Plan skipping, the flip-flop | 8a |
| **4** Plan leaked into 287, `</think>` into 501 | New replies: the plan router catches both shapes. #287's take is a repair; #501 is clean now |
| **4** Plans carry wrong facts | Part 2 (the plan reads the same records) |
| **4** Advisor's 2,165 calls | 8b: typing plans only on 6 new words, three a turn |
| **4** Long arcs missing from plans | Part 9 |
| **4** A new take isn't told why | Already built: each passed-over take says why (your note, a failed check, the angle asked) |
| **5** Tics replaced, courtroom voice spreading, journals | Part 10 |
| **5** Long replies to short turns, ending on the room | 10.4 |
| **5** Stutter-built lines, "for the record", echoing | 10.1 cooling; echoing had already faded (3 of 172) |
| **5** Props | 10.1 cooling, and 5a expiring belongings |
| **5** Repeated sentence, a stray script, straight quotes, tags, speaker marks | 10.5 tidy; curly quotes are the style's job |
| **5** Late dialogue with no speaker | *Not built: nothing asks for a speaker when a line has none.* |
| **5** Your turns in the model's voice, past tense | Part 3: "write for me" already writes present tense, and the tense check now holds for the whole chat |
| **5** Voice drift read against day-zero lines | Part 1 (the brief) and 10's rolling window |
| **6** Subplots, non-people, dead threads, British incidents | Part 12 |
| **6** Opening arcs on dice | *Not changed:* the openings were before Part 12's grounding; new ones need a live thread and a want |
| **7** Weather, frost, the season | Part 13 |

**Not covered** (in italics above): a wrong length of time since an event, a place's contents, two tellings of one past event, a quantity said two ways, an age against a description, the verifier's own mistakes, and a speaker for unattributed lines. None of them is in the audit's 39 fixes. Most need a record Mea doesn't keep yet (how long since an event, what a place holds, the details of a past event), and the speaker one needs a rule for when a line may go unattributed. They're for a later plan.

---

## Order and size

| Part | Size | Depends on |
|---|---|---|
| 1 brief ages | large | — |
| 2 facts retire | large | — |
| 3 tense holds | small | — |
| 4 clock labels | small | — |
| 5 state expires | large | 2 |
| 6 word-fixer | small | — |
| 7 checker | medium | 4 |
| 8 plan once | medium | — |
| 9 long threads | medium | 2 |
| 10 prose | medium | — |
| 11 tidy | medium | — |
| 12 subplots | medium | 11 |
| 13 weather | small | 4 |
| 14 repairs | small | 2, 4, 6, 11 |

Parts 3, 4 and 6 are quick and independent, so they go first while Parts 1 and 2 are built.

## Not in this plan

- Changing the card itself. The card stays as written; the brief is a layer over it.
- Rewriting old replies beyond the listed repairs.
- A new writer model or preset changes (docs/29 covers those).
