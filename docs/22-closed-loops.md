# Build plan: closed loops (one record of what's open, and a story that notices when it's done)

**Written:** October 31, 2026 · **Base:** Mea `main` with PR #201 (open lists answer to what later scenes closed)

In *Filed Under Stay*, Buffy said "I love you" at #542. At #629, 87 messages later, the plan set it for that night. The groceries were bought at #462, and at #599 Buffy said "Then groceries."

PR #201 fixed those paths: an open list now reads as of its message, and what later scenes closed comes off it. This plan is about why it could happen at all. It's at least the third fix of this shape: the card's "tonight" (PR #159), the two-day-old fridge (PR #200), and this one. Each fixed the path it was found on, and you found each one in the prose.

---

## 0. Read this first

### 0.1 What the live chat shows

Measured on a copy of the production database, as of #629.

**Nobody's job is noticing that something finished**

- **The tracker never saw it.** "Say the word tonight" was still open when Buffy said it. It was closed at #615, by you: the event reads "you marked it kept". The model wrote nothing at #542.
- **That's normal here.** Of the 25 times a promise was marked kept, **12 were you, by hand**. Half of Mea's promise-closing is you noticing it in a panel.
- **The groceries were never a promise.** "We'll buy you groceries tomorrow" (#320) has no obligation at all, so nothing could close it. They lived as words in 11 open-list items.
- **Scene records open three times what they close:** 313 items opened and 98 closed, across 90 scenes.
- **Calendar entries never finish.** `done` has never been set on any of the 8. "Pick up Dawn" (Wednesday) is still pending.

**The same thing lives in many places, with no link between them**

The three words were at once one promise, 17 open-list items across every summary level, 16 memories and several plan threads. Each has its own wording and none points at another, so closing one closes nothing. PR #201 connects them by matching words, which works but is a guess: on 558 real items, the true "the whole word, no takebacks" scored 0.35 and the false "the filing system" scored 0.37.

13 of the 82 active plan and promise memories are already finished, among them "Promise broken: the jealousy/Spike story at dinner", a promise Buffy kept.

**Records go stale for a long time**

- Story So Far only moves when an arc closes: #203, #354, #532. It lags by up to **178 messages**, and sits at 97 now.
- "Tonight" and "tomorrow" are stored as written. A line from Thursday reads the same on Friday.
- `st.milestones` never reaches the writer or the planner as a list. The first "I love you" isn't even a milestone: only "said it back" at #569 is.

**Errors feed themselves**

- 15 plan drafts for 6 replies treated a finished thing as pending, including every reply from #623 to #629. Each reply repeated it, and the repeats became new source material.
- #629 said "the grocery run", and the tracker filed `plan grocery run: tonight`. The mistake was in the records one reply later.

**Nothing raises a hand**

- The checker passed #599 and #629 as clean. It's told the facts "can lag behind the story", and nothing in them said the groceries were done.
- Since #540, **48 of 51 flags were dismissed**, so a new flag is easy to ignore.
- Story health has no line for any of this.

### 0.2 Root causes

1. **Closing isn't anyone's job.** Everything that opens a thing runs on every reply. Nothing asks "did this finish?"
2. **Open things have no identity.** One commitment is many strings, so a closure can't reach its copies.
3. **What's true now is stored as what was written then.** Summaries are history. Mea also reads them as the present.
4. **Relative time is stored raw.**
5. **A reply is trusted before it's checked**, so its mistakes become records, and records become plans.
6. **Fixes land on paths, not on the prompt.** Any new reader of a summary starts with the old bug. `memory/recap.ts` and `meus/brief.ts` still read raw summaries today.

### 0.3 Principles

Kept from docs/16, 19 and 20: the page is the record, correct at render time, keep the cache, rules first, reject loudly. Three added:

1. **Everything that can finish has an id.** Closing happens once, on the id, and every reader follows it.
2. **History says what happened; only the ledger says what's open.** A summary never answers "is this still to come?"
3. **The last gate looks at the prompt, not the paths.** However a stale claim got in, it's caught in what the model is actually sent.

---

## Parts at a glance

| Step | What it adds | New model calls |
|---|---|---|
| **Part 0 · Tools and quick wins** | | |
| 0.1 | `scripts/replay.ts`: any reply's prompts, rebuilt as of that moment | none |
| 0.2 | Story So Far rebuilds per chapter, not per arc | one rollup per chapter |
| 0.3 | "Tonight" says which night | none |
| 0.4 | Every summary reader goes through one door, and a test enforces it | none |
| **Part 1 · One record of what's open** | | |
| 1.1 | Loops: every commitment gets an id, in the ledger | none |
| 1.2 | Scenes close loops by id | none (the scene build already runs) |
| 1.3 | The tracker closes them reply by reply | none |
| 1.4 | Backfill, with your say on what it closed | one batch, per chat |
| **Part 2 · Where things stand** | | |
| 2.1 | WHERE THINGS STAND, built live from the ledger | none |
| 2.2 | ALREADY HAPPENED: the firsts, always in the prompt | none |
| **Part 3 · The gates** | | |
| 3.1 | The prompt lint: stale claims in the final prompt | none |
| 3.2 | A plan that revives a closed loop gets replanned once | only when it fires |
| 3.3 | A reply that revives one is flagged, and its new records wait | none |
| **Part 4 · Flags worth reading** | | |
| 4.1 | The checker cites loops | none |
| 4.2 | A kind you always dismiss stops interrupting | none |
| **Part 5 · You can see it** | | |
| 5.1 | The loops panel: one tap to close or reopen | none |
| 5.2 | A note that says "that already happened" closes the loop | existing `note_facts` |
| 5.3 | Story health: Open loops | none |
| 5.4 | Golden scenarios from this chat | none |

**Order:** 0 → 1 → 2 → 3 → 5 → 4. Part 0 is small and pays at once. Part 1 is what everything else reads. No step adds a model call to an ordinary reply.

---

## Part 0 · Tools and quick wins

### 0.1 Replay

Every investigation so far has been hand-written: copy the database, remove the connections, rebuild a prompt. It also misled this one: rebuilding #599 showed "grocery run at Fri 21:00", a calendar entry written at #629, because `excludeMessageId` leaves out one message and keeps everything after it.

As built: `bun scripts/replay.ts "Filed Under Stay" --seq 629` makes the safe copy itself (`VACUUM INTO`, connections deleted), rewinds the copy to just before that message through the app's own rewind, and rebuilds the planner input and the writer's prompt on the mock provider. It runs the plan checks on the plan stored for that reply. `--find "still unsaid"` says which block a line came from. `--out dir` writes both prompts, to diff two builds. It stops if any connection but the mock is left.

**Done when:** the #629 finding reproduces with one command. (It does, and its first run found something new: the writer's `### Scenario` block carries a "Milestone" line with the Thursday list on it. Part 3.1's lint is what catches that kind.)

### 0.2 Story So Far by chapter

`rollupInputs` already reads "arcs plus closed chapters after the last arc". Only the trigger waits for an arc: `storyNeedsRebuild` targets `arcs.at(-1).end_seq`. Target the last closed chapter instead. The lag drops from 178 messages at most to one chapter (24 to 60 here), for one extra rollup per chapter.

**Done when:** the Story So Far ends at #622 on this chat.

### 0.3 "Tonight" says which night

At render time, relative words in open lists and plan or promise memories get the day of their record: "tonight (Thursday)", "tomorrow (Friday)". `TimeIndex.at(seq)` already has the story minutes. The label is absolute, so the cached prefix doesn't change from one day to the next. A thread named for a day ("the Thursday list") is left as it is: Part 2 stops it reading as now.

**Done when:** no "tonight" or "tomorrow" reaches a prompt from a record more than a day old without its day.

### 0.4 One door

As built: `summaryText(row, lens)` is how a model reads a summary, and `memoryText` a plan or promise memory. The telescope, recall, the planner, the recap, Meus's brief and the Archivist all use them. A `Lens` (`lensOf(chatId, st)`) is what a record is read through: what's been done since, and which day a message fell on.

`server/test/doors.test.ts` fails on any file that reads summaries without the door or a written reason, and on a reason that has gone out of date.

**Done when:** a new raw reader fails the tests.

---

## Part 1 · One record of what's open

### 1.1 Loops

A **loop** is something the story expects to happen: a promise, a plan, an errand, a question someone owes an answer to.

```ts
interface Loop {
  id: string;            // "L12", stable
  what: string;
  kind: "promise" | "plan" | "errand" | "question";
  status: "open" | "done" | "dropped" | "lapsed";
  opened: number;        // seq
  closed?: number;       // the message it really happened at
  how?: string;          // the line that closes it, quoted
  due?: { minutes: number | null; text: string };
  repeats?: boolean;     // tacos every Friday: an instance closes, the loop stays open
  obligation?: string;   // the promise or calendar plan that is this loop
  calendar?: string;
  from: string[];        // every wording known to be this loop
}
```

As built: an id comes from a hash of the loop's first wording, so a swipe or an edit elsewhere can't renumber it. Loops live in the tracker ledger as `loop` events, so they follow swipes, edits and rewinds like everything else, and `st.loops` comes from the fold. An obligation or a calendar `plan` *is* a loop: it gets one automatically, so promises keep working as they do. Closing one keeps the promise and warms the bond once, at the message it happened; marking it kept later changes nothing. Scene-written events have their own source, `memory`, so a tracker reading a reply again leaves them alone. Threads stay as they are. Most of the 63 are motifs ("Joyce's light"), which is why 4 resolved isn't the bug it looks like. A thread only becomes a loop if it has an end.

A loop that's opened twice is one loop: the same matching as promise merging (docs/20 0.2), and the scene build can say so by id (1.2).

### 1.2 Scenes close loops by id

The scene build already runs and already writes `threadsClosed`. It now gets the loops open in the scene by id, as it already gets EXISTING MEMORIES for `supersedes`:

```
"loopsClosed": [{ "id": "L1a2b3", "seq": 542, "quote": "I love you" }]
"loopsOpened": [{ "what": "...", "kind": "errand", "seq": 320 }]
```

A closure must quote the scene, and the rule checks the quote is there, moving it to the message that really has it. What's checked becomes a `loop` event on that message, written again with each rebuild of the scene. This replaces guessing with a lookup: no word matching, and no extra call. A second wording of an open loop merges into it (word overlap of 0.7).

### 1.3 The tracker closes them too

Scenes close after the fact, and a scene can run 20 messages. The tracker update sees open loops in `stateForModel` and gets one line: `loop L1a2b3: done — <quote>`. Its prompt asks the question nothing asked before: **did anything open finish in this reply?** The quote has to be in the new messages, or the line is left out. A wrong close costs little, since anyone can reopen it (5.1), and the scene build can correct it.

### 1.4 Backfill

As built, once per chat, in one helper call after the next scene: PR #201's rules find what later records closed, what's still listed as open, and old loops that may be over. The helper reads where the story is now and says which are real. The closing record's own line is the evidence, not a message quote: it comes from a model that read the scene, and quoting every scene would mean sending them all. A closed loop is named after that record, because its wording while open was "still unsaid, due tonight". What comes back goes to the Inbox as one card ("23 things the story finished"), because it rewrites what the story thinks is open. You can take out any line, and nothing changes without your yes.

A line in a card that's a loop already and has no closing record reads "Over": old loops nobody closed, like Wednesday's "Pick up Dawn". The ledger has no `lapsed` rule for plans yet, so this is how they go for now.

**Done when:** on this chat, the three words and the groceries are done loops with the right message numbers, and the move to Gabriel's house is open. (On a copy with every candidate accepted: the words at #546, the groceries at #462, the move open. The helper's own answers haven't been seen yet.)

---

## Part 2 · Where things stand

### 2.1 WHERE THINGS STAND

A new lane built from `st.loops` at render time, never summarized. As built (`trackers/stands.ts`), it goes to the writer, the planner, the recap and Meus, and what's finished goes on the checker's fact sheet as `D` lines:

```
[WHERE THINGS STAND]
This is what's open now, from the record. Summaries and memories say what was open then, and lose to this.
Open: clothes-and-paint trip (due Sat 03:00) · Buffy Summers: full retaliation tonight (Fri) · and 32 quieter
Done lately: help pick paint at hardware store tomorrow (Fri) (#621) · pickup at three, then paint for her room (#619)
```

About 300 tokens. Loops due in the next day come first, then the ones the newest messages are about, then the newest, and the same thing worded twice shows once. Quiet ones fold into a count. "Tonight" and a due time read as a day, and a promise says whose it is. It sits outside the cached prefix, beside the story state, so it can change on every reply.

Ids stay out of it for now: nothing reads them until the plan's threads become ids in 3.2.

The "Still open" line then leaves every summary in a prompt, and `Left open` with it. They stay in the Inspector as history. This is the change that ends the class: a summary can no longer say what's open, right or wrong.

That happens per chat, once its backfill card is approved (or had nothing to ask). Until then, if you said "Not these", or with the trackers off, summaries keep their lists and PR #201's rules: the loops don't know everything yet, and nothing else would say. `Lens.ledger` is that switch, and the story header says which of the two a chat is on.

Measured on this chat at #629 with every candidate accepted: all 12 open lists leave the writer's prompt and all 6 leave the planner's. With both new blocks in, the writer's prompt is 781 characters shorter than before and the planner's 1,650 shorter. Until the card is approved, the two blocks are added on top: about 600 tokens more on this chat.

### 2.2 ALREADY HAPPENED

The other half of the question: a short, permanent list of the turning points, so "have they said it?" is answered by something other than recall's luck.

```
[ALREADY HAPPENED]
Never staged as a first again.
Gabriel asked Buffy to be his girlfriend; she said yes (#217) · first time making love (#239) · Buffy said 'I love you' (#541)
```

As built, it comes from four places, read as the fold and the scene records stand, so a rewind takes them with it:

- `st.milestones`. The tracker prompt now asks for a `milestone` line on any first between people, and the state it reads lists the last ten, so it can see what's there.
- The highest rung two people reached, from "Spoken" up, as one line.
- A vital promise kept. Loops have no turning-point mark, and `importance` already says this.
- The scene's `moments`, read at render time, so old chats have them without a backfill. A confession, a first kiss or a death needs a scene rated 9 or more, and a turning point a 10. On this chat 15 of the 301 moments pass, and #541 is one: the tracker never wrote it as a milestone.

An item is weighed by its scene's rating. What the tracker chose or a first-kind moment counts for one more, and so does anything that says "first" or "I love you". The first telling of a thing stands for the rest, by word overlap at 0.6: at 0.5, "Buffy realizes she is in love with Gabriel" (#211) swallowed "Buffy said 'I love you'" (#541). Capped at 20 lines and 250 tokens.

---

## Part 3 · The gates

### 3.1 The prompt lint

It extends `accuracy/promptcheck.ts`, which already does this for knowledge and deaths, with a new kind, `done`: a sentence that says most of a wording a done loop has had, with a word for what's coming ("tonight", "unsaid"). Card, persona and lore hits go in the CORRECTIONS lane, memory hits right under the block, and all of them to the request's trace, so the Inspector shows them.

As built, it's a check on each source, not one pass over the final messages. A last pass would have to tell Mea's own corrections and WHERE THINGS STAND from what it's checking, and it could only add a line after the fact. It reads the card, persona, lore, Story So Far and recall for the writer, the Story So Far and SINCE THEN for the planner, and the records the recap and Meus's brief read. An author's note and the chat's standing notes aren't read: you wrote those.

A card is timeless, so this is the strict test: "someone needs to laugh" in Gabriel's persona has a to-do's shape and isn't one.

### 3.2 Replan once

PR #201 puts a correction under a plan that waits for something done. That's weak: at #629 the claim was in KNOW, MOVE and threads, and the writer reads the plan first. So when `pendingDone` fires on a plan the separate planner wrote, it gets one retry with the finding. If the retry still fails, or still waits for it, the first plan stands with its correction. It costs a call only when there's something wrong, and it runs under the same wait as the planner, so a late retry leaves the first plan.

`Plan.replanned` is what makes it once: a prepare can run several times for one reply. A plan you edited has it set from the start, because your edit isn't second-guessed, and a preview never calls the model. The call's kind is `planner:replan`, which is what 5.3 counts.

The plan's `threads` become ids: the planner and the advisor see ids under WHERE THINGS STAND (the writer doesn't), an open loop's id reads as the loop, an open thread's title stays, and anything else is dropped. A plan can't carry a thread the ledger doesn't have. With the trackers off there's no ledger to ask, so a plan keeps what it wrote.

### 3.3 A reply can't reopen what's closed

A new checker kind, `undone`, by rules: a sentence in the reply, thoughts and dialogue included, that looks ahead at a done loop. It's flagged with the quote and the message it closed at, and it offers "regenerate with fix". Plans use the same test, so a plan's "the grocery run" goes to 3.2.

Sharing words doesn't work for this. A list says one word ("Then groceries."), and prose shares words all the time ("the groceries wait in the fridge"). Measured on this chat's 145 replies from #300 on, with every backfill candidate accepted:

| Rule | Flags | Right |
|---|---|---|
| Three shared words and a word for later, as plans use | 2 | 0, and it missed both real ones |
| A word only that loop has, and a word for later | 175 | Few: nearly every one read was wrong |
| That word inside a to-do ("then X", "needs X", "the X run") | 6 | 2 |
| The same, on a loop worded at least twice, closer to the word | 2 | 2: #599 and #629 |

So it has two tests: most of a wording, with a word for what's coming, or a to-do around what the loop goes by. What a loop goes by is a word only it has, in at least two of its wordings and most of them. That means a thing the records only mentioned once can't be flagged this way, which is the price of not crying wolf. These rules were tuned on this one chat, so another chat may need them loosened or tightened, and 5.4's goldens only pin this one.

While that flag is open, what the reply wrote that matches the loop is held, as `heldLeaks` does for leaks (docs/19 2.3): a promise, a plan or a loop, by the loop id on the flag. `plan grocery run: tonight` would have waited for your word, and everything else the reply filed stands. A `repeats` loop never fires. Dismissing a flag waves that loop through for good: someone lying or misremembering (docs/20 5.2), or a thing that really does come round again. The groceries are the case in point: a second grocery run is a real thing to want, and one tap says so.

---

## Part 4 · Flags worth reading

### 4.1 The checker cites loops

Its fact sheet says the facts "can lag behind the story", which is why #599 passed. Done loops and ALREADY HAPPENED are on the sheet since Part 2, as `D` entries, so "Then groceries" contradicts something it can cite. What's left is telling it those don't lag.

As built, the prompt says the `D` lines don't lag, and that they hold even against a recent message with the same thing still to come, since that's the mistake repeated: from #623 to #629 the recent messages all had it wrong. A flag citing a `D` line also skips the pass that lets the story's own words settle a flag, for the same reason. A loop you've waved through (3.3) leaves the sheet, so the model can't raise it again. "Fix this sentence" isn't waving it through, which it was until now: fixing an `undone` flag's sentence used to wave its loop through for good.

It's untested with a real model: the mock answers for the checker.

### 4.2 A kind you always dismiss stops interrupting

48 of 51 flags were dismissed, and `past` alone was 16 of 17. A flag nobody trusts hides the one that matters. Story health tracks dismissals per kind. A kind dismissed more than 80% of the time over at least 20 flags stops showing on the reply, and stays in the panel with the reason. Undoing that is one tap. Rules that cite a closed record, like `undone`, are measured apart from the model's guesses.

**Those numbers were wrong, and it changes what's counted.** `dismissed` is also what "Fix this sentence" and "Accept" set, so it can't tell a flag you waved off from one that worked. Of the 110 `fact` flags marked dismissed on this chat, 82 were on a reply you edited and 21 had their canon accepted. Counted as written, five kinds would have gone quiet on the first run, `fact` at 96%. So what counts here is a flag waved off with the reply left as it was: not `settled` (new, set by the fix and accept routes), not on a take with edits, and its canon not in a memory you confirmed. An edit that had nothing to do with the flag counts as acting on it too, so this errs toward showing a flag.

| Filed Under Stay | `dismissed` | Waved off |
|---|---|---|
| `fact` | 110 of 114 (96%) | 15 (13%) |
| `lesson` | 41 of 44 (93%) | 7 (16%) |
| `tense` | 37 of 40 (93%) | 2 (5%) |
| `past` | 29 of 29 (100%) | 8 (28%) |
| `clockback` | 23 of 24 (96%) | 9 (38%) |

So nothing goes quiet on either real chat today, and the premise that flags are mostly ignored doesn't hold on this data. Most of them got acted on. 4.2 is a guard for a kind that goes bad, not a fix for one that already has.

As built, in `accuracy/quiet.ts`. It's worked out from the flags, per chat; the only thing stored is when you asked to see a kind again. What's measured together is a kind and a source: `record` for a flag citing a closed record (`undone`, or a model flag citing a `D` line), else `rules` or `model`. So a model that guesses badly can't silence its own flags that cite the ledger. Once a kind is quiet its count stops, because a flag nobody sees can't be waved off, and counting those would bring the kind back by itself. "Show on replies again" starts the count over.

A quiet flag is hidden everywhere it would act on you or the model, not just on the reply: "regenerate with fix", "Dismiss all", the slips and retold lanes, Meus's checks, the plan stats, and the health score, since nobody's going to dismiss what they can't see. It also stops holding records back (3.3, docs/19 2.3): what holds a record has to be where you can see it and say no. Asking to see the kind again holds them again.

---

## Part 5 · You can see it

### 5.1 The loops panel

In the story dock: open loops, newest first, then done ones with the quote that closed them. One tap closes, reopens or drops, and it holds (docs/19 principle 7). Today's "mark as kept" keeps working and becomes the same action. It should be needed rarely, and 5.3 counts how often it is.

As built, what holds is this. A loop you closed or called off stays that way: a model's line about it is refused, and only you can reopen it. A loop you reopened can't be closed by anything up to the message you reopened it at, so a rebuilt scene can't put the same close back, but a later reply that really does it still can. Otherwise a reopened loop could only ever be closed by hand, and it would sit in WHERE THINGS STAND as open after it happened, which is the bug this plan is about.

A hand close lands on the newest message, not the one it happened at: the panel doesn't know which that was. So the "(#N)" on a loop you closed is when you said so.

Both "mark as kept" routes already write a `promise` line, so the fold does the joining: a promise you settle marks its loop as yours and by hand. Calling a loop off now settles what it stands for, which it didn't before: its promise goes to `excused`, so it can't break later and hurt the bond, and its plan comes off the calendar.

### 5.2 A note closes the loop

"We already did the grocery run" on a reply goes through `fileNoteFacts` (docs/19 5.1) and closes the loop. A note then fixes the record, not just one take.

Rules first: a clause that says it's over (already, did, done, happened, finished), doesn't say it isn't, and has every word of one of the loop's wordings. Every word, because "she already moved the boxes to the house" mustn't close the move to Gabriel's house. "Was" isn't enough: a thing called off "was" too. The rest goes to the note's helper, which now sees the open loops by id and can answer `closes`. That's how "Buffy already said I love you" reaches "say the word tonight", which shares none of its words. A plain fact that names its people used to skip the helper; one that says something's over now goes to it first, but only while something is open, and it stands as a story truth if the helper doesn't close anything. That's the one new call, and it's on a call that already existed.

It closes at the message before the reply, as a note's other records do. The chip has Undo and "That's only for this reply", and either opens the loop again. It's untested with a real model: the mock answers for the helper.

### 5.3 Story health: Open loops

A new part of Story health, worked out from the ledger, with nothing new stored:

| Number | What it warns about |
|---|---|
| Loops you closed by hand | The target. 12 of 25 kept marks today; it should be near zero |
| Messages between closing and the record | Slow noticing |
| Age of the Story So Far | A rollup that stopped |
| Prompt lint hits, plans replanned | Stale claims still getting in, and from where |
| Open loops past due | Something nobody closed or dropped |

It opens the worst one.

As built, in `accuracy/loophealth.ts`, on the live score only (the weekly trend and Home's dots don't count it). "By hand" is of the last 25 closes, since they're rare and 20 replies would say nothing; a card you approved doesn't count as by hand. The age of the Story So Far is closed chapters it hasn't taken in, which says a rollup stopped better than a number of messages does: a chapter's worth behind is normal. Lag counts the messages between a loop's message and a model's record of it. A rebuilt scene rewrites its events, so it can read high. The stale lines are `trace.outdated` of kind `done` on those replies, by where they were.

On *Filed Under Stay*, on a copy: 54 out of 100 with the card approved, 28 without. Worst is a real find: the Story So Far ends at #532, three chapters behind. Without the card it's 11 of the last 21 closes by hand, with it 8 of the last 25, and "Pick up Dawn" and the tacos are past due until the card drops them. Neither lag nor the stale lines have anything to count yet: no reply has been written with those parts in place. The weights are a first guess.

### 5.4 Golden scenarios

| Scenario | Checks |
|---|---|
| *Filed Under Stay* #629 | the planner's input has no pending "I love you"; ALREADY HAPPENED has it; the original plan is replanned |
| The same chat at #599 | the groceries are done; "Then groceries" is flagged `undone` |
| #629's tracker lines | `plan grocery run` is held |
| Tacos every Friday | a `repeats` loop closes an instance and stays open; a plan for this Friday's tacos isn't flagged |
| The move to Gabriel's house | stays open through "offer him the hills house" |
| A rewind past #542 | the loop reopens, and the three words are pending again |
| A deliberate lie about the past, dismissed | no flag again |

As built, `19` to `25` in `server/test/golden/`, on the mock, and each one was seen to fail with what it guards switched off. They're small scenes in this chat's words, not the chat itself, so they pin the rules and not your real ledger. In the first, the mock's retry still waits for it, so the check is that the plan went back once; `gates.test.ts` has the retry that comes back clean.

---

## What this plan doesn't do

- **No rewriting of stored summaries.** They're history, and they stay true as history.
- **No model check on every reply.** Each gate is a rule or a field in a call that already runs.
- **No merging threads into loops.** Threads carry mood and motifs, and most never end, which is fine.
- **No promise that nothing slips.** A loop the scene build misses stays open until you or a later scene closes it. What changes is that it's visible and counted.

## Risks

- **A wrong close hides a live thread.** That's why closures must quote, a backfill waits for you, and a closed loop is one tap from open. The golden for the move guards the worst case seen so far.
- **Repeating things read as finished.** `repeats` has to be set when a loop opens ("every Friday"). The tracker prompt asks for it, and `undone` skips those loops.
- **The note grows.** Parts 2.1 and 2.2 add about 550 tokens to every reply. On this chat, taking the open lists out of summaries gives it all back (2.1 has the numbers), but only once the backfill is approved.
- **Loop ids on an old chat.** Until a chat is backfilled, PR #201's rules keep working, so nothing gets worse on the way.
