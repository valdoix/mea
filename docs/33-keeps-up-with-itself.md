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
- **1.5** A line can be pinned so it stays as the card wrote it, through later readings too. Routes: `GET /api/chats/:id/brief`, `POST …/brief/pin`, `POST …/brief/read`. *The panel that shows them is not built yet;* it goes with Part 7's open-flags work.
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

Split in two. **5a**, the people lines, is built; **5b** is the rest of the state block.

### 5a: what someone wears, feels and carries (built)

- **5.1** `trackers/fold.ts`: a look and the body meters now carry the message they were written at (`lookSeq`, `bodySeq`). `trackers/note.ts`: clothes, and meters and flags like arousal, hunger or "asleep", print only within the scene they were written in; a later scene shows them again only when restated. Injuries and conditions keep their own endings.
- **5.2** `carried`: food from an earlier scene is gone; a thing set down elsewhere in an earlier scene (the cart, a plate, the sofa arm, by the door, not yet paid for) isn't listed; one pair of footwear is on someone's feet, the latest; at most eight things print, latest first.
- **5.3** `cleanBit`: a bracket a model never closed loses its brackets, and a bit that is another ledger line run in ("body Buffy Summers: arousal 5") is dropped.

**Seen on a copy of the real data:** at message 926 Buffy's line no longer has the car scene's "jeans unbuttoned", the morning's arousal, the cream soup, the wrapped toothbrush or the cart; she has one pair of boots on, and eight things. "Pale" and the day-zero wants stay until Part 1's reading runs at the next chapter.

**Done when:** a later scene doesn't show an earlier scene's clothes, body state, eaten food or set-down things, and a broken bracket or a run-in line never reaches the prompt. *(In `expires.test.ts`.)*

### 5b: the rest of the state block (not built)

- **5.4** `trackers/today.ts`: starts at the day's first message, never clips mid-clause, and breaks a block when the place changes.
- **5.5** `memory/openlist.ts`: open items ranked by weight (promises with a date, conflicts, secrets first); solved errands closed.
- **5.6** `memory/named.ts`: facts in play chosen by the scene's people and place, not by any name match.
- **5.7** `accuracy/corrections.ts`: a correction only from a real supersession, with the pair shown.
- **5.8** `lore/activate.ts`: an entry with no text is not sent.
- **5.9** `trackers/places.ts`: a room cannot be filed under another room; the current room follows the cast.
- **5.10** A test that every reader of the state ignores ledger lines of takes that aren't the active one.
- Moved here from Part 2: an item bought, fixed or lost, or a promise kept, retiring the memories it overturns.

## Part 6: the word-fixer only suggests  [6]

- **6.1** `accuracy/names.ts` / `guards.ts`: nothing is rewritten in a reply. A slip becomes a quiet suggestion, and only when the target is a person or place name, the word is not in the dictionary, and it is not in italics or inside a quoted mispronunciation.
- **6.2** The same rule for the "name" continuity flag.
- **6.3** *Moved to Part 14:* the repair of past rewrites still in the text (this story: 135, 151, 269), from each reply's stored original. It changes real replies, so it waits with the other repairs.
- **As built:** a slip's target must be a word of a person's or place's name that isn't an ordinary word; the slip keeps the name's first letter; words are read whole in any script; italics are skipped. The "Correct it" choice is gone from Settings and from the story's guards; a stored "fix" reads as "note".

**Done when:** "Gruyère", "Hugh", "Flour" and "Slower" pass untouched in a test, and "Rovello" in italics is left alone.

## Part 7: the checker says less and catches more  [8–12]

Split in two. **7a**, the rule checks' false alarms, is built; **7b** is not.

### 7a: fewer false alarms (built)

- **7.1** `accuracy/moreslips.ts` clock check: a time counts only when the reply states it as now ("It's seven", "the clock reads 6:40 a.m.", "Eleven-oh-eight a.m., Sunnydale Mall."), not when it mentions one ("the sofa where she slept at seven a.m."); habits ("after bad patrols", "every night at two") are skipped; just past midnight is later, not earlier; spoken times are read whole ("seven forty-two a.m." is 7:42, not "two a.m.").
- **7.2** `accuracy/rules.ts`: a leak needs the verb to be the person's ("Joss leans in and says…", not any verb in a sentence that names Ruth), and the words of people's names are never a secret's words. An eye or hair colour that someone else in the story has is theirs ("ocean-blue eyes" are Gabriel's, not Dawn's). The time-of-day check skips memories ("the floorboard Joyce stepped over at midnight").
- **7.3** Not here: anyone the player's own turn names is in the scene.

**Seen on a copy of the real data:** replaying the rule checks over all 429 replies, findings fell from 63 to 17: clock 34 → 5, not here 17 → 9, wrong-person colours 4 → 0, leaks 3 → 0, memories read as the time of day 3 → 1. Nothing new was flagged. (The model's own checks, "fact" and "past", weren't replayed: they call a model.)

**Done when:** the clock, leak, colour and not-here families fall by most of their false alarms on the replay, and the existing golden scenarios (a real leak, a real clock slip) are still caught. *(Both hold; `checkerquiet.test.ts`, `checks.test.ts`, the golden suite.)*

### 7b: not built

- **7.4** "No record of X": search the transcript before raising it (this is the model checker's "past" family).
- **7.5** New rules: a vampire outdoors in daylight; weekday against date; a period list for the story's year; one value per person for facts like blood type.
- **7.6** Open flags: a count on the story, one-click fix per flag, "fix all open" (with "apply all" for edits left as proposed), and the panel for Part 1's brief.

## Part 8: plan once, and send less  [7, 14, 37–39]

Split in two. **8a**, the plan watch, is built; **8b**, sending less, is not.

### 8a: the plan watch stops flip-flopping (built)

The watch already made a plan-skipping model plan in its own step (two calls a reply). But after six replies planned that way it let the model try its own pass again, and when the model skipped again that reply cost a wasted try or a planner rescue (three calls). In one story that happened about every eighth reply: 109 "asked again", 90 rescues, 102 planned first in 429 replies.

- **8.1** `services/generation.ts` `skipsPlans`: the model tries its own pass again only after 30 replies in a row planned first (`PROBE_AFTER`), not six.
- **8.1b** In a story where this model skipped its plan twice in its last ten replies, it never tries again: it plans first there for good, whatever its record elsewhere.

**Done when:** a long run of planned-first replies earns a probe only at 30, and a story with two recent skips never probes. *(In `review.test.ts`.)*

### 8b: send less (not built)

- **8.2** The plan step is sent a reduced prompt: state, today, the last few messages and the long threads, without the full canon and transcript.
- **8.3** `memory/canon.ts`: canon splits into a short core and passages recalled by the scene. Target: under a quarter of today's 84k characters.
- **8.4** A ceiling on the story prompt with a logged reason; find why messages 461–685 reached 150k–510k tokens.
- **8.5** Librarian, lore keep-up, continuity and journal once per closed scene, not per reply.
- *Dropped:* **8.6**, retrying failed embedding jobs. The embedding job embeds whatever lacks a vector each time it runs, so the 14 failed runs caught up: one active memory in the story has no vector.

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

## Part 11: cast, places and memory tidy  [13, 15, 18]

- **11.1** `memory/entities.ts`: bracketed stage notes are stripped from names before matching; organisations, streets, schools and film characters are not people; role names ("Gabriel's mom") attach to the named person once known.
- **11.2** Places merge by address and by "X's kitchen" = "kitchen at X". A one-time merge proposal for existing stories.
- **11.3** A profile is built for anyone past about 20 mentions (`memory/profiles.ts`).
- **11.4** Memory importance: small physical beats decay unless recalled; near-duplicates merge on write.
- **11.5** Lore entries can say who knows them; narration in someone's head only uses what they know (`lore/activate.ts`, checked by `accuracy/checker.ts`).
- Builds on docs/32 Part 3; nothing there is redone.

**Done when:** this story (on a copy) folds to under 120 places and no person entry is a street, a school or a company.

## Part 12: subplots and the world  [29–32]

- **12.1** `sim/roster.ts`: leads are people the story has named who could act; never a place, a shop, or a pet unless you add them.
- **12.2** `sim/storyteller.ts`: the fixed sentence goes. A proposal needs a live thread (touched in the last two chapters), a concrete want, and what would change on the page; one that can't say so isn't offered.
- **12.3** Seeds from what the story set up: an unanswered person (Giles), a promised arrival (the parents), a wronged party (Willow), a pending result (the audit).
- **12.4** A kind you decline several times running stops being offered for a while.
- **12.5** `trackers/pressures.ts`: no deck draws for pets or for people with no profile; a drawn pressure must not contradict what's recorded about them.
- **12.6** Incidents come from the setting and year, and each has a route onto the page (the radio, the drive, someone mentions it).

**Done when:** proposals generated for this story on a copy have no non-person leads and none built on a thread older than two chapters.

## Part 13: weather  [33–36]  (built)

- **13.1** `trackers/weather.ts` `wxKind`: a `wx` line is weather (sky, rain, wind, a temperature outdoors), the air of a room ("cold clean air off the ice", "sixty-two degrees in the house"), or light and mood ("first thin gold on the kitchen tile", "kitchen half-dark, fridge hum"). Only weather becomes the story's weather. Light is kept for its scene and shown in `NOW`; a room's air is kept as `indoors:` while the scene stays in that room. The tracker is told the same in its grammar.
- **13.2** `sim/sky.ts` `outOfClimate`: a weather line the climate can't have at that time of year (frost where the coldest autumn night is 14°C, a stated temperature far outside the season's range) is not taken as the sky's anchor; the forecast stands, and the World panel says which line was turned down and why. The fold stays free of the climate, so the check sits where the sky is put together (`sim/service.ts` `storyWeather`).
- **13.3** One plain `SKY:` line in every state block: the weather, the temperature, sunrise or sunset, the season, and `indoors:` when there is one. The story's own words stand for three story hours after they were written, then the sky's take over. *The fault behind "cold clean air off the ice" all day was here too:* the anchor was always "half an hour ago", so a weather line never aged. It is now anchored to the story minute it was written at (`weather.at`), and fronts move on from it.
- **13.4** The season already came from the date when the setting is blank (the `SKY:` line and the clock both work it out); nothing needed changing.
- **13.5** `accuracy/worldslips.ts` `weatherRule` (check "Weather"): a reply that writes frost, snow or a heatwave the climate can't have at this date is flagged, skipping memories, wishes and comparisons. A reply making ordinary weather (rain arriving) is the story's right and is not flagged.

**Seen on a copy of the real data:** the story's weather at 926 was "silver-and-cold October morning, frost on the car"; it is turned down (a mediterranean autumn night is about 14°C at its coldest). The line now reads `SKY: overcast, 25°C · sunset 17:38 · autumn`. "Cold clean air off the ice" is held as the rink's air and isn't shown at the house.

**Done when:** a mock reply writing "kitchen half-dark, fridge hum" as weather leaves the forecast in place, and the 926 state line on a copy reads as an October afternoon in Sunnydale. *(Both hold; `weather.test.ts`.)*

## Part 14: repairs for this story  (needs a go-ahead; touches real data)

- Run the truth check (Part 2.3) over the truths the story already has, the Part 6 repair list and the Part 11 merges on the real story, after a backup. (The Part 2 retirement and the Part 4 relabel run by themselves on the next reply.)
- Settle by hand, as truths: Spike's blood type, Dawn's supplier, whether Spike can be out by day here.
- Fix "Clara (William's son)" in the Winters Family group.
- Apply the open true flags: 443, 593, 736, 742, 279.

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
