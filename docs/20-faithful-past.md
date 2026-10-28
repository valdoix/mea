# Build plan: a faithful past (what happened stays where, when and how it happened)

**Written:** October 28, 2026 · **Base:** Mea `main` after PR #174, with PR #175 (a promise comes with the moment it was made)

In *Filed Under Stay*, Gabriel asked Buffy "Have you ever had romantic feelings towards Spike?" in the car outside Revello Drive (#466). Buffy promised to tell Dawn at dinner (#467). Then he fixed the faucet (#468–#471). At #509, Buffy tells Dawn the story: "This morning. Kitchen. He's fixing the faucet… and then he says — and I quote — 'Should I be jealous of Spike?'" The place, the time and the line are all wrong.

PR #175 fixed one path: the advisor now reads the moment each open promise was made. This plan is about the class of bug: **the story's own past, told back wrong**.

---

## 0. Read this first

### 0.1 How #509 went wrong

Measured on a copy of the production database, as of #509. Six things failed, and none of them raised a flag.

| # | Where | What happened |
|---|---|---|
| 1 | The writer, at #501 | Buffy says "a question he asked me this morning". Nothing checks a character's recollection, so the slip stays on the page and becomes a source. |
| 2 | The promise | Filed as "throw him under the bus, tell Dawn about the jealousy question at dinner" (seq 467). It names the question but not the moment, so whoever reads it has to guess. |
| 3 | The advisor | It reads the last 8 messages. The car scene was 40 messages back. With only the promise and #501 to go on, it planned "Buffy reenacts the morning" and wrote under *Keep straight*: "The jealousy question happened 'this morning' per the promise". |
| 4 | The writer, at #509 | The car scene was **in its context** (prompt messages 14–15). It followed the plan anyway. |
| 5 | Memory | The scene was still open, so nothing about the car question had been written to memory. The scene's facts were labelled "This morning, at Gabriel's kitchen", including "Buffy listed the full Thursday file on her fingers *in the car*". A memory's place comes from where its scene started (`memory/format.ts` `TimeIndex`), not from where the message happened. |
| 6 | The checker | It had a `past` kind for exactly this. But its facts held no record of the question, so it flagged the harmless "new model" line instead, and the verifier rightly cleared that. #509 went down as **clean**. |

### 0.2 What else turned up

- **A promise broken in the first second.** At #501, Buffy promised Dawn "the jealousy/Spike story at dinner, 15:05". Its due date was stored as `{ minutes: 905, text: "Day 1 15:05" }`: minute 905 of the story's day 1. The clock reads 1,052,307,180, so `promiseChecks` found it about two thousand years late and marked it broken. **Dawn's trust went −1 and her resentment +1**, and the memory "Promise broken: the jealousy/Spike story at dinner" went to the checker as a fact. Buffy kept that promise at #509.
- **The same promise twice.** The #467 promise (to Gabriel) and the #501 one (to Dawn) are the same commitment. One stayed open and the other broke, so the record contradicts itself.
- **The slip spreads.** #487 has "asking if I had feelings for Spike while making tacos this good". That's another wrong setting, three replies after the event.

### 0.3 Root causes

1. **No spine of the day.** Mea knows the story time of every message (the clock) and where everyone is (the fold), but no one can see the day in order: "13:10 car outside Revello Drive: the Spike question → 13:20 kitchen: the faucet → 13:50 tacos". Each reader gets either a few recent messages whole or summaries that come later.
2. **Records without their moment.** Promises, facts, memories and threads say *what*. They rarely say *where* and *when* it happened, and when they do, the place is the scene's.
3. **Retelling isn't checked.** The checker compares a reply with facts. When a character tells back something from the page, nothing finds the passage it came from and compares the two.
4. **The plan outranks the page.** The writer treats the plan's *Keep straight* as truth, even where the transcript in its own context disagrees.
5. **Talk becomes record.** A character's "this morning" is a claim, not a fact, but it reaches the next reader just as an event would.

### 0.4 Principles

- **The page is the record.** Messages outrank trackers, memories, plans and characters' recollections, in that order. Every helper is told so, and every claim it passes on says which message it came from.
- **Every past thing carries its moment:** message, story time and place. Nothing is filed without them.
- **Fail loudly.** A retelling that doesn't match its source is a flag with the source quoted, never "clean".
- **Cheap first.** Rules and the ledger before a model call. A model only judges what the rules found.

---

## Parts at a glance

| Step | What it adds | Needs |
|---|---|---|
| **Part 0 · Stop the bleeding** | | |
| 0.1 | "Day 1 15:05" resolves to today, not to story day 1 | — |
| 0.2 | One promise, one record: a repeat merges into the first | — |
| 0.3 | The clock never breaks a promise sooner than its window after it was made | 0.1 |
| **Part 1 · The day in order** | | |
| 1.1 | A beat per reply: time · place · who · what happened | — |
| 1.2 | TODAY SO FAR for the writer, advisor and checker | 1.1 |
| 1.3 | Memories take their place and time from the message, not the scene | 1.1 |
| **Part 2 · Records carry their moment** | | |
| 2.1 | The advisor reads where open promises were made | PR #175 |
| 2.2 | STAKES says where and when: "(made in the car, 13:10)" | 1.1 |
| 2.3 | Facts, threads and stances keep their source message | — |
| **Part 3 · Retellings checked** | | |
| 3.1 | Find the retellings in a reply | — |
| 3.2 | Find each one's source on the page | 1.1, 3.1 |
| 3.3 | Compare when, where, who and the quoted words; flag with the source | 3.2 |
| **Part 4 · The plan answers to the page** | | |
| 4.1 | A plan's claims about the past cite a beat or a message | 1.2 |
| 4.2 | The writer is told: the transcript outranks the plan | — |
| **Part 5 · Talk isn't record** | | |
| 5.1 | What a character says happened is stored as said, not as happened | — |
| 5.2 | A wrong recollection gets a correction line | 3.3, 5.1 |
| **Part 6 · Measure it** | | |
| 6.1 | Golden scenarios from this chat | Parts 1–4 |
| 6.2 | Retelling accuracy on the Accuracy page | 3.3 |

**Order:** 0 → 1 → 3 → 2 → 4 → 5 → 6. Part 0 is live damage. Part 1 is what everything else reads.

---

## Part 0 · Stop the bleeding

### 0.1 "Day 1" is today

`spokenDue` and the tracker's `due` lines can name a day by the story calendar's own counter ("Day 1 15:05"). The clock resolves that counter from the story's start, so a same-day promise lands years before the current time. Resolve "Day N" against the day the clock is on when that day's number matches; otherwise drop the day and keep the time.

- Test: a promise due "Day 1 15:05" at story time 14:58 is open, not broken.
- Repair: `promiseChecks` re-runs on a fold rebuild, so the fix also undoes the trust −1 / resentment +1 in this chat (the `moves` are recorded, so an override can take them back).

### 0.2 One promise, one record

A new promise with the same promiser and nearly the same *what* (content words, as in `promiseOrigins`) as an open one becomes a re-statement: it may add a due time or a second person promised, but it keeps the first one's id and seq. "Tell Dawn the jealousy story at dinner" (#501, to Dawn) joins "tell Dawn about the jealousy question at dinner" (#467, to Gabriel).

### 0.3 The clock waits

A promise records the story time it was made (`made`). The clock never breaks it sooner than its window after that, even when its due time was already behind the clock when it was promised ("at dinner, 15:05", said at 15:10). A later "kept" in either wording still overturns a clock verdict and takes its bond moves back, as it already did.

Not built in Part 0: keeping a broken verdict out of memory until it's settled. Once Part 1's beats exist, a verdict can wait for the scene a promise names ("at dinner") instead of the clock.

---

## Part 1 · The day in order

### 1.1 A beat per reply

The tracker update already reads every reply. It writes one more line: `beat: <who> <did what>`, at most 20 words, about what happened, never how it read. The fold stamps each beat with the message's story time and the place of the people in it. Example:

`#466–467 · 13:10 · Gabriel's car, outside Revello Drive · Gabriel asks Buffy whether she's had feelings for Spike; she says no; promises to tell Dawn at dinner`

A user message and the reply to it share a beat. A beat is part of the ledger, so it moves with swipes, edits and rewinds like every other tracker event.

Today's replies the trackers read before beats existed get theirs from a backfill (`tracker.beats`). It runs after a tracker update, takes 30 replies per helper call, and does each reply once. (Built in PR #178.)

### 1.2 TODAY SO FAR

A new lane: the story day's beats, oldest first, within a budget (about 600 tokens; on a long day the oldest beats fold into one line per hour). It goes to:

- **the writer**, after the story state;
- **the advisor and planner**, before the recent messages;
- **the checker**, as facts with `B` ids it can cite.

The open scene is never invisible again: what happened an hour ago today is always in front of whoever is writing about it.

### 1.3 Memories in the right place

`TimeIndex` takes the place for a memory from the beat at its source message, falling back to the scene. "Buffy listed the Thursday file in the car" is filed in the car.

---

## Part 2 · Records carry their moment

### 2.1 Where the open promises were made (done, PR #175)

For up to three open promises older than the recent window, the advisor reads the message that led to each one and the reply it was made in. The ones the latest messages are about come first.

### 2.2 STAKES with the moment

The STAKES lane adds the beat's time and place: "Promise: Buffy promised Gabriel: tell Dawn about the jealousy question at dinner (made in the car, 13:10; due tonight, dinner)". The writer gets the moment without the whole passage.

### 2.3 Source messages on every record

Facts, threads and stances keep the seq they came from (most already have it in the ledger; make it part of the record), and the note prints it where a reader might retell it: KNOWLEDGE and OPEN THREADS.

---

## Part 3 · Retellings checked

### 3.1 Find the retellings

In a new reply, a retelling is a sentence that:

- names a past moment: "this morning", "earlier", "last night", "when you…", "remember when", "back at the…", or a past day;
- quotes someone with a frame: "and I quote", "he said", "you asked me"; or
- appears in a reply that keeps a promise to tell a story (the obligation goes kept and its *what* has "tell" or "story" in it).

Rules first, and no model call when there are none.

### 3.2 Find the source

For each retelling, find the passage it's about. Look in this order: TODAY SO FAR beats (by content words), the source of a promise it keeps (Part 2), then a full-text and embedding search of the ledger (`swipes_fts`, already used by the checker). Keep the best one or two passages.

### 3.3 Compare and flag

A new checker kind, `retell`. Checked by rules where the record decides:

- **when**: the retelling's time words against the source beat's story time (`relativeTime` already says "this morning" or "earlier today");
- **where**: a place named in the retelling against the beat's place;
- **who**: the person credited with a line against the one who said it.

Then one model call compares the quoted words and the order of events, citing the passages. A flag quotes the source with its message number ("Asked in the car outside Revello Drive, #466: 'Have you ever had romantic feelings towards Spike?'") and offers a fix. #509 would have been flagged on *when*, *where* and the quote.

---

## Part 4 · The plan answers to the page

### 4.1 Claims about the past cite something

The plan check (docs/19 Part 2) gains one rule. A *Keep straight* line, or a beat that says when or where something happened, needs a beat id or a message number. A claim with no source is dropped and the writer is told to look in the transcript. "The jealousy question happened 'this morning' per the promise" fails: the promise names no time.

### 4.2 The transcript outranks the plan

The plan block's header says: where the plan and the story so far disagree about what happened, the story is right. The writer's planning pass (KNOW) gets the same line.

---

## Part 5 · Talk isn't record

### 5.1 Said, not happened

When memory or the tracker turns a character's line about the past into a record ("a question he asked me this morning"), it's stored as said, with the speaker: "Buffy said the question came 'this morning'". It's never stored as when the event happened. Readers see that it's a recollection, and the beat stays the authority.

### 5.2 Correct the slip

When 3.3 flags a wrong recollection and you leave the flag up, the correction goes into CORRECTIONS for the next few replies: "The Spike question was asked in the car before the faucet, not this morning". That way the next reply doesn't build on it. If you dismiss the flag, it's a deliberate retelling (a lie, a joke, a faulty memory) and stays as written.

---

## Part 6 · Measure it

### 6.1 Golden scenarios

| Scenario | Checks |
|---|---|
| *Filed Under Stay* #466–#509: the jealousy story at dinner | TODAY SO FAR has the car beat; the advisor's plan doesn't say "morning" or "faucet"; 3.3 flags the original #509 on when, where and quote |
| The same chat at #501: "Day 1 15:05" | the promise stays open; no bond move |
| A deliberate lie about the past, dismissed | no correction line; no repeat flag |
| A recollection with the right time and place | no flag (no false alarms on retellings that are right) |

### 6.2 Retelling accuracy

The Accuracy page counts retellings found, matched, flagged and dismissed per chat, so a rise shows up before you find it in the prose.
