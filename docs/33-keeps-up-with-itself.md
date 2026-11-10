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

- **5.1** `trackers/note.ts` / `condition.ts`: `look` and transient `body` lines carry the scene they were written in. In a later scene they print only if restated, or as "last seen wearing" when nothing newer exists. Arousal, aches and "asleep" end with the scene.
- **5.2** `trackers/belongings.ts`: food and drink end when eaten or when the scene ends; "on her feet" holds one pair; things marked "cart", "not yet purchased", "on X's plate" close when the place is left. At most about eight items print, by recency and use.
- **5.3** A validator on every state line before it enters a prompt: balanced brackets, one person per line, no contradicting needs ("hungry; belly full"). A line that fails is rebuilt from the fold, and the failure is logged.
- **5.4** `trackers/today.ts`: starts at the day's first message, never clips mid-clause, and breaks a block when the place changes.
- **5.5** `memory/openlist.ts`: open items ranked by weight (promises with a date, conflicts, secrets first), with solved errands closed by the Part 2 rules.
- **5.6** `memory/named.ts`: facts in play chosen by the scene's people and place, not by any name match.
- **5.7** `accuracy/corrections.ts`: a correction is only written from a real supersession (Part 2), with the pair shown.
- **5.8** `lore/activate.ts`: an entry with no text is not sent.
- **5.9** `trackers/places.ts`: a room cannot be filed under another room; the current room follows the cast.
- **5.10** A test that the fold ignores ledger lines of takes that aren't the active one, for every reader of the state.

**Done when:** the state block for message 926 (on a copy) shows what people are wearing and holding in that scene, and passes the validator.

## Part 6: the word-fixer only suggests  [6]

- **6.1** `accuracy/names.ts` / `guards.ts`: nothing is rewritten in a reply. A slip becomes a quiet suggestion, and only when the target is a person or place name, the word is not in the dictionary, and it is not in italics or inside a quoted mispronunciation.
- **6.2** The same rule for the "name" continuity flag.
- **6.3** *Moved to Part 14:* the repair of past rewrites still in the text (this story: 135, 151, 269), from each reply's stored original. It changes real replies, so it waits with the other repairs.
- **As built:** a slip's target must be a word of a person's or place's name that isn't an ordinary word; the slip keeps the name's first letter; words are read whole in any script; italics are skipped. The "Correct it" choice is gone from Settings and from the story's guards; a stored "fix" reads as "note".

**Done when:** "Gruyère", "Hugh", "Flour" and "Slower" pass untouched in a test, and "Rovello" in italics is left alone.

## Part 7: the checker says less and catches more  [8–12]

- **7.1** `clockBackRule`: skip a sentence when the time sits in a simile, a memory, reported speech or a habit ("at two a.m. after bad patrols"). Fix `statedTimes` for spoken times with minutes ("seven forty-two", "eleven-oh-eight").
- **7.2** Leak: a secret is only matched when the sentence is about what the secret is about, and its holder is not the one speaking.
- **7.3** Not-here: anyone named in the latest user message is present. Trait: checked against the sentence's subject.
- **7.4** "No record of X": search the transcript (full-text) before raising it.
- **7.5** New rules, no model calls: a vampire outdoors in daylight (from cast kind, the clock and the sky's sun times); weekday against date; a period list for the story's year; one value per person for facts like blood type, profession and kinship.
- **7.6** Open flags: a count on the story, one-click fix per flag, and "fix all open" (including an "apply all" for edits left as proposed).
- **Golden:** the checker run over this story's replies on a copy, comparing flag counts before and after. Needs a yes.

**Done when:** on the copy, the clock, name, leak, trait and not-here families fall by at least four in five, and the audit's open true catches are still caught.

## Part 8: plan once, and send less  [7, 14, 37–39]

- **8.1** `services/generation.ts`: once a model has skipped its plan twice in a story, that story plans in its own step from then on (stored on the chat), so a reply is two sends. The first whole try is not sent at all in that mode.
- **8.2** The plan step is sent a reduced prompt: state, today, the last few messages and the long threads, without the full canon and transcript.
- **8.3** `memory/canon.ts`: canon splits into a short core (always) and passages recalled by the scene's people and topics. Target: under a quarter of today's 84k characters on an ordinary turn.
- **8.4** A ceiling on the story prompt with a logged reason when hit; find why messages 461–685 reached 150k–510k tokens and add a test for it.
- **8.5** Librarian, lore keep-up, continuity and journal run once per closed scene (or every few replies), not per reply.
- **8.6** `memory/embed.ts`: failed embedding jobs are retried with backoff; the story's health shows how many memories can't be searched.

**Done when:** a mock story of 30 replies with a plan-skipping model averages no more than two story sends per reply, and total calls per reply fall below 15.

## Part 9: long threads stay in view  [20, 22]

- **9.1** A "long threads" list beside the errands: promises with a date ("rings this week", "parents next week"), open conflicts, secrets, and anything you pin. Kept from `promise`, `plan`, `secret` and `thread` lines, closed by Part 2.
- **9.2** `steer/advisor.ts` and the planner get the list every turn and are told to surface one when its date arrives or the scene gives room. The state block shows the top few.
- **9.3** `steer/swipes.ts`: a new take is told why the last was passed over when Mea knows (your note, a failed check, a fact it got wrong).

**Done when:** in a fixture, a promise dated "this week" appears in the plan's threads on the last day of that week.

## Part 10: prose habits cool on their own  [24–27]

- **10.1** `steer/craft.ts`: a rolling window over the last 20 replies. A phrase, opening shape or word *family* over a set share goes on a cooling list by itself and comes off when it fades. Families are lists (filing: file, filed, drawer, docket; court: ruling, overruled, counselor, gavel, exhibit…), and new ones are found by counting, not hand-written.
- **10.2** A running bit belongs to its owner: the cooling line names who may still use it, so Buffy's courtroom doesn't become Dawn's and Spike's.
- **10.3** `memory/journals.ts`: each journal is written from that character's own lines and only scenes they were in; quoting another character's speech at length is out.
- **10.4** Length follows the turn, and a reply ends on something the player can answer (a line, a look, a question) more often than on atmosphere.
- **10.5** A no-model tidy pass on every reply: curly quotes, balanced tags, stray speaker marks, a sentence repeated back to back, stray characters from another script.

**Done when:** in a mock run where every reply uses "ruling" and "docket", the family is cooling by reply 12 and absent from the instructions' allowed list for everyone but its owner.

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

## Part 13: weather  [33–36]

- **13.1** Split light from weather. `wx` accepts only sky, temperature, wind and precipitation words; light and mood lines go to the scene. The sun's position comes from `sim/sky.ts`.
- **13.2** `trackers/fold.ts` `case "wx"`: a written weather line becomes the anchor only if it is weather and within the climate's range for the season; otherwise the forecast stands and the line is flagged ("frost" at a 14°C low).
- **13.3** The state block always carries one plain line: sky, temperature, wind, and "indoors" with any standing indoor note (a cold house, a rink).
- **13.4** Season is filled from the date when blank. Fronts actually pass, so a week isn't one sky.
- **13.5** A checker rule: weather stated in a reply against the state's weather.

**Done when:** a mock reply writing "kitchen half-dark, fridge hum" as weather leaves the forecast in place, and the 926 state line on a copy reads as an October afternoon in Sunnydale.

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
