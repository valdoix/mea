# Build plan: reliable knowledge (who knows what, a plan that reads it, trackers that don't drift)

**Written:** October 24, 2026 · **Base:** Mea `main` after PR #163, with PR #164 (already knows)

In *Pretty Hands and Proving It*, Gabriel handed Dawn the socks at #322. Buffy had picked them with him in the sock aisle (#196–#199) and told Dawn about them on the phone (#267). The trackers had recorded both. Both takes still wrote the socks as news: Buffy surprised in the first, Dawn in the second. The plan behind them said "Dawn doesn't know Buffy picked the socks."

PR #164 fixed that one path: KNOWLEDGE now names what the people present already know about the player's message. This plan is about the class of bug. It comes from the repo's history, the production database (this chat, 148 replies), and your notes on replies.

---

## 0. Read this first

### 0.1 What the history shows

About 40 of the last 277 commits fix state that drifted from the story. They fall into five groups, and each fix was found by you, one symptom at a time.

| Root cause | Commits | What happened |
|---|---|---|
| **The ledger loses what the model meant** | f21509e, 3addbff, b0bd6a9, 15e5006, ef8751d, e4fcb67, aa18b78, 7e443e0 | Keepers dropped; "scene: X \| mode: y" lost 66 mode changes; "traits: lip ring" became a person; "mood Mari, Gen & Robin" became one person; "I swear to god if…" filed as a promise; "trust +4 → +2" read as no change |
| **The same truth in many places, and only one hears about a change** | 6ffc808, 427c233, 35aa987, 32753a0, 911c84b, 9e1dc68 | Lore, card, persona and summaries still saying "doesn't know" after a reveal; the card's "tonight" still the present 23 hours later; a returned jacket still in the look |
| **Inputs cut short** | a2854fc, 204df82, 76d9abd, cff641e, b14d6ec | Trackers read the first 6,000 characters of a reply; the planner read 1,200 characters of each message and staged played beats again |
| **The model's guess wins over the record** | 56db6c0, 721196b, b14d6ec, #164 | Checker without the story; your note never reaching the planner; drafts treated as played; known facts never shown |
| **Fixes that never reached a reply** | c857415 | The preset version stayed at 10, so #159's rule never shipped; the opening correction never fired |

The pattern: every one of these failed silently. Nothing measured it, so you found it in the prose.

### 0.2 What the live chat shows

Measured on a copy of the production database, as of #323.

**Knowledge**
- 173 facts, 3 of them secrets, 206 stances: 183 *knows*, 6 *believes*, 3 *suspects*, 14 *unaware*. Before #164 the writer saw only the 17 that aren't *knows*. Everything people had learned on the page was invisible to it.
- **Stale unknowns.** "Dawn doesn't know: Gabriel Winters is with Buffy Summers" was set at #265, before Dawn met him. She has since watched them hold hands and asked if he's Buffy's boyfriend (#305–#317). It is still in every prompt. An *unaware* stance only changes when the tracker writes an explicit `know` line, and it writes those for being told, rarely for seeing.
- **Duplicates.** "Buffy was in heaven" (#265) sits beside the secret "she was in heaven, not hell", so Dawn is unaware twice. 6 near-duplicate pairs in all, such as two wordings of the blood purchases. Facts are matched by word overlap (≥ 0.6 / 0.75), which misses rewordings.
- **Wrong kind.** The socks were filed as `owe` and `promise` ("Debt: Gabriel Winters → Dawn: grey cat socks"). A gift Buffy chose became a debt Gabriel alone owed.
- **Presence.** PRESENT lists Amaya Ruiz in the Summers kitchen; she was only talked about. Ruth the cat has 5 "not here" / "place" flags.

**The planner**
- This chat uses the separate planner (637 calls). **The last 40 planner requests contained no KNOWLEDGE and no recalled memories.** `advisorInput` cuts STORY STATE at 2,000 characters (`steer/advisor.ts:212`); this chat's note runs 6,800, and KNOWLEDGE starts after 5,600, partway through Buffy's PRESENT line. The planner's KNOW step plans who knows what without the records of who knows what.
- It also calls `trackerPrompt` with no `excludeMessageId`. On a swipe it reads the state *after* the take being replaced. It passes no `focus` either, so #164 doesn't reach it.
- When the writer plans for itself, it has everything: 37k tokens, with the facts spread through a 25k memory block. Nothing checks KNOW against the records. At #323 it contradicted two memories and two tracker stances.
- Writer, planner, tracker, continuity checker and keep-up are all the same model (GLM 5.2). A mistake in the reply is read by the same model that made it, and comes back as state.

**Your corrections**
- 8 of your 29 notes on a reply fix state, not style:
  - "buffy doesn't know that giles has left"
  - "she doesn't know that he worked as a lifeguard and a barista"
  - "Buffy doesn't know those details about him"
  - "she already washed her mouth and used the toothbrush"
  - "buffy's nails have been cleaned by gabriel yesterday, and she just took a bath"
  - "the phone call is already ongoing"
  - "gabriel didn't say that buffy is his girlfriend - he thinks it, but doesn't say it"
  - "Gabriel bought the socks with Buffy - she's the one who told him Dawn's eyes color"
- None of them became a record. A note lasts one reply, so the next reply can make the same mistake. Some come back as **lessons** ("Dawn doesn't know that Buffy was in heaven…"), which are prose rules: a fourth copy of a truth the tracker already holds.
- Two of the eight are the same mistake. Buffy knowing what only the persona says about Gabriel (his jobs, his past). No stance covers that: nothing says Buffy has known Gabriel for one day and knows only what she's seen and been told.

### 0.3 Root causes

1. **Knowledge is modelled around secrets, not people.** There are stances for secrets and things someone was told. There's nothing for "what does Buffy know about Gabriel", so the card and the persona read as common knowledge.
2. **Stances change only when the model writes a line.** Nothing makes them expire, and nothing re-checks them. Seeing something happen teaches no one.
3. **Facts are free text.** No subject, no embedding, so rewordings make duplicates and matches miss.
4. **The plan is trusted unchecked**, and the separate planner is given less than the writer.
5. **Corrections don't stick.** Your note, a swiped-past take and a resolved flag each fix one reply.
6. **The kept reply is truth to the tracker**, slips and all.

### 0.4 Principles (kept from docs/16, two added)

1. The tracker is the truth for who knows what. Everything else links to it or is checked against it.
2. Correct at render time and follow the branch.
3. Keep the cache.
4. Reject loudly.
5. Rules first. A model call is added only where rules can't decide, and it never runs when the rules find nothing.
6. **New: the planner sees what the writer sees about knowledge, or more.**
7. **New: a correction you make once holds until you undo it.**

---

## Parts at a glance

| Step | What it adds | Needs |
|---|---|---|
| **Part 1 · The planner reads the records** | | |
| 1.1 | Planner gets the state by lane, not cut at 2,000 characters | — |
| 1.2 | Facts in play: one packet for the beat | #164 |
| 1.3 | The right fold on a swipe | — |
| **Part 2 · The plan check** | | |
| 2.1 | KNOW lines checked against the stances | 1.2 |
| 2.2 | One repair, or a correction to the writer | 2.1 |
| 2.3 | The reply checked before the tracker trusts it | 2.1 |
| **Part 3 · Knowledge per person** | | |
| 3.1 | Witnesses: who was there learns what happened | — |
| 3.2 | Acquaintance: card and persona facts aren't common knowledge | — |
| 3.3 | Unknowns that expire and get re-checked | 3.1 |
| **Part 4 · One fact, one key** | | |
| 4.1 | Facts with subjects and an embedding | — |
| 4.2 | Kinds that mean what they say (gifts, debts, presence) | — |
| **Part 5 · Your corrections stick** | | |
| 5.1 | A note that states a fact becomes a record | — |
| 5.2 | Lessons that are facts move to facts | 5.1 |
| **Part 6 · Measure it** | | |
| 6.1 | Knowledge golden scenarios from this chat | Parts 1–3 |
| 6.2 | State health in the planner's notebook | 2.1, 5.1 |
| 6.3 | A test that each lane reaches the prompt | — |

Suggested order: **1 → 2 → 5 → 3 → 4 → 6**. Part 1 is small and fixes the biggest gap. Parts 2 and 5 catch whatever the records still miss. Part 3 makes the records better, and Part 4 tidies them.

---

## Part 1 · The planner reads the records

### 1.1 The state by lane, not by length

**Seen:** `advisorInput` sends `note.slice(0, 2000)`, `story.slice(0, 3000)` and the lanes `slice(0, 5000)`. In this chat that keeps NOW and part of PRESENT, and drops STAKES, KNOWLEDGE and HOOKS.

**How it's built**
- `buildNote` already has lanes with priorities and token counts (`NoteResult.lanes`). Add `buildNote(…, { budget })` for the planner with the order NOW → KNOWLEDGE → STAKES → PRESENT → HOOKS. A long PRESENT gets trimmed per person (`has:` lists first, then `always:`), never cut mid-line.
- The planner gets the recalled memories the writer would get (CANON 4), capped by tokens, not characters.
- No raw `slice` anywhere on prompt text again: `scripts/check-budgets.ts` greps `steer/` and `prompt/` for `.slice(0, <number>)` on prompt parts.

**Done when:** the planner's request for #323 contains KNOWLEDGE and the sock memories.

*Built:* the note goes whole (it already fits its own token budget by lane), the Story So Far as its newest chapters by tokens (paragraphs in a story with no headings: this chat's has none), the lanes as whole lanes up to 2,500 tokens, and the recalled memories (2,500 tokens, the window as it stands, so recall searches what the writer's does). The `check-budgets` grep was left out; `plannerrecords.test.ts` checks the input instead. On #323 the planner's input grew from 27k to 43k characters.

### 1.2 Facts in play

**What you get:** the beat's facts in one place, for the planner and the writer:

```
[FACTS IN PLAY: what this beat touches]
- The socks: Buffy and Gabriel chose them together (#197–#199); Buffy told him Dawn's eyes are blue (#197).
  Dawn knows Gabriel bought them (Buffy told her on the call, #267). Spike: not told.
```

**How it's built**
- `trackers/inplay.ts`: from the focus (player message + note, as in #164), pick the facts, items and promises it touches. Use the #164 rarity weighting plus the embeddings (Part 4.1, when it lands). For each, list every present person's stance: *knows* with how and when, *not told* where nobody wrote a line.
- Recalled memories that touch the same thing go under it as "from the story", with their seq.
- One lane, priority above KNOWLEDGE. At most 4 things.

**Done when:** #322's prompt shows the socks block above, and a message about cards shows the card facts and nothing about socks.

*Built differently:* `inPlay` in `trackers/note.ts`, a lane of its own (FACTS IN PLAY, priority 1, after NOW) that replaces #164's "already knows" lines. Facts and things are scored together, by rarity among them times how often the message says the word, keeping hits within half the best. Someone with no stance isn't listed: no record isn't "not told" (Buffy picked the socks but has no stance on "Gabe bought Dawn socks"). The memories aren't under it; the planner gets them whole (1.1) and the writer already has them.

### 1.3 The right fold on a swipe

`advisorInput` calls `trackerPrompt(chatId, { kind: "story" })` with no `excludeMessageId`. On a swipe the planner reads the state *after* the take being replaced, including what that take invented. Pass the same `excludeMessageId` and `focus` the writer uses.

**Done when:** a golden swipe scenario's planner input has no line from the replaced take.

*Built:* `excludeMessageId` goes from `prepare` through `advisorExtra`, `runAdvisor` and `rescuePlan` to the note and the lanes; checked in `plannerrecords.test.ts`, not a golden scenario.

---

## Part 2 · The plan check

### 2.1 KNOW lines checked against the stances

**How it's built**
- `steer/plancheck.ts`, run on every plan (separate planner, the writer's pass, a rescue). The plan is already split into steps (`shared/` plan parser).
- From KNOW (and MINDS' "misreads"), read claims by rules: "X doesn't know Y", "X knows Y", "X hasn't been told", "X will see/learn Y". This is the same claim grammar as `accuracy/promptcheck.ts`, aimed at the plan.
- Match each claim to a fact (link, then rarity words, then embedding) and compare it with the stance as of the message being written.
- A contradiction is a finding: the claim, the fact, the stance, and its seq.

**Done when:** #323's plan gives one finding ("Dawn doesn't know Buffy picked the socks" ✕ "Dawn knows: Gabe bought Dawn cat socks — Buffy told her, #267"), and the 20 latest plans of two other chats give none that aren't real.

*Built:* `steer/plancheck.ts`, KNOW only (MINDS' misreads aren't claims about the records). A claim stops at the next one ("knows she's alive · does NOT know heaven" is two). The match uses `trackers/topics.ts`, now shared with FACTS IN PLAY. A claim that says most of the fact's own words is strong; one that only touches it ("the socks' origin" and "era of origin") counts only when the player's message is about that fact. Over the last 80 plans in Pretty Hands: #323 (the socks) and #213 ("Buffy doesn't know she loves him" ✕ she knows Gabriel almost said it, a true correction). The other chats weren't checked, because there's only this one in production.

### 2.2 One repair, or a correction to the writer

- With the separate planner and time left: one repair call. "The records say: … Fix KNOW and MOVE; keep everything else." It runs only when 2.1 found something.
- Otherwise the writer gets a `[PLAN CORRECTION]` line under the `<director-plan>`: "Where the plan says Dawn doesn't know about the socks, the records are right: she knows (Buffy told her on the call)."
- The plan drawer shows the finding next to KNOW, so you see it was caught.

**Done when:** a swipe of #323 never writes the socks as news to Dawn (golden 6.1).

*Built differently:* no repair call. The `[PLAN CORRECTION]` goes under the plan for every plan that reaches the writer before it writes: the separate planner's, the plan step's, and the rescue. It adds no wait and no cost, and the writer already follows the plan line by line. A plan the writer writes in its own reasoning can only be checked after the reply, so it's saved as found, not corrected. Each reply keeps its findings in `meta.planCheck` (with `corrected`). The drawer shows them under KNOW, and the summary gets a "checked" badge. Whether the swipe holds is for golden 6.1.

### 2.3 The reply checked before the tracker trusts it

**Seen:** at #323 the tracker read the kept take and wrote `bond Dawn>Gabriel: trust +5…` and `owe … paid` from it. A reply's slip becomes state.

**How it's built**
- The continuity checker's leak and fact slips are known before the tracker's lines are applied (the tracker job already waits on the reply). Lines that only follow from a flagged sentence (a `know` built on a leak, a bond move whose cause quotes it) are held as *pending* on the verdict, not applied.
- Fixing the sentence or dismissing the flag releases them. A swipe drops them.
- Bond moves above ±3 in one reply need a cause the reply supports. Otherwise they're clamped, with a verdict the model sees next turn.

**Done when:** a golden reply with a leak leaves the leaked fact *unaware* until you dismiss the flag.

*Built:* leaks only, the flag kind that names a person and a fact. `heldLeaks` (store.ts) reads the open leak flags on the showing takes into `FoldConfig.held`. A model `know` line in that reply that would teach the flagged person a fact like the flagged one is held, with the verdict "held: … counts once you dismiss the flag or fix the sentence". Every flag change folds again (`flagsChanged` in checker.ts). The bond clamp was already there (TRK-11: ±2, ±3 for a big cause), so nothing new is needed.

---

## Part 3 · Knowledge per person

### 3.1 Witnesses

**How it's built:** a fact first written in a reply (any `know`, `reveal`, `item … gift`, `promise` or `milestone`) is known to everyone present at that seq, as *saw it*, unless the line says otherwise ("whispered", "behind her back", an `unaware` stance). A reply that shows an *unaware* fact in front of its holder (subjects present, the fact's rarity words in the narration) raises an *exposure* finding for 3.3. It doesn't flip the stance by itself.

**Done when:** "Gabriel is with Buffy" is *knows (saw it)* for Dawn after #271's hand-holding, and a whisper stays secret.

### 3.2 Acquaintance

**What you get:** a line in KNOWLEDGE for each pair who met in the story: "Buffy has known Gabriel for one day: she knows only what she's seen and been told." The facts she was told are listed under it.

**How it's built**
- Each pair gets `met: seq` (the first scene they're both present in, or a `met` line). The persona's and card's details about a person are tagged *unknown to anyone who met them in-story*, until a `know` line or a witness (3.1) teaches them.
- The leak check (`accuracy/rules.ts`) gains a "persona detail" rule. A reply where Buffy names something only the persona says about Gabriel (his jobs, his ex, his family's firm) is a leak, unless a stance or memory says she learned it.

**Done when:** "lifeguard and barista" in Buffy's mouth is flagged in a golden scenario, and isn't once Gabriel has told her.

### 3.3 Unknowns that expire

- An *unaware* stance older than 3 scenes, whose holder has shared a scene with the fact's subjects since, goes on a re-check list.
- The re-check rides the next tracker call (no extra call): "Does Dawn still not know: Gabriel is with Buffy? Answer `know Dawn: … · knows|unaware — the line that shows it`." The answer must quote the story, or it's dropped.
- Stances you set (`set: true`) are never re-checked.

**Done when:** the stale Dawn line clears on its own in this chat's re-fold, and the heaven secret (never shown in front of her) stays.

---

## Part 4 · One fact, one key

### 4.1 Facts with subjects and an embedding

- `Fact.subjects: string[]`: the people and items it's about, resolved like `people()`. `Fact.vec`: an embedding of the statement (the `embeddings` table, owner `fact`).
- `fact()` without a key reuses a fact with the same subjects at embedding similarity ≥ 0.85, or a secret at ≥ 0.75, before falling back to words. Re-folding merges existing pairs, the way docs/16 1.4 did.
- #164 and 1.2 match on subjects first.

**Done when:** "Buffy was in heaven" folds into `#heaven` and Dawn has one stance on it; the two blood facts become one.

### 4.2 Kinds that mean what they say

- `owe` needs a debt in its line or cause (owes, borrowed, pay back, a price). Otherwise it's rejected with "a gift is `item X: A → B (gift)`". `promise` of a thing already in hand becomes the item move.
- A gift can have several givers: `item socks: → Dawn (gift from Gabriel, Buffy)`.
- **Presence:** `cast …@spot` needs the reply to put them in the scene, by the same "brings them in" test the not-here check uses. Someone only talked about is *mentioned*, not present. Animals that act get cast lines like anyone (Ruth).

**Done when:** this chat's re-fold has no "Debt: Gabriel → Dawn", the socks list both givers, and Amaya isn't in the kitchen.

---

## Part 5 · Your corrections stick

### 5.1 A note that states a fact becomes a record

**What you get:** when your note says something true about the story, a chip under the reply: **Saved: Buffy doesn't know Giles has left** · Undo · That's only for this reply.

**How it's built**
- Rules first. "X doesn't know …", "X already …", "X didn't say …", "… is already ongoing", "… yesterday" become ledger lines with source `user` and `set: true`: `know`, a `body` or `look` change, `scene`, or a SEAL note ("narration, not speech").
- Anything else that might be a fact goes to the helper once, with a schema, and must quote the note. Style notes ("make it warmer") are never touched.
- The note still goes to the planner and writer as now. The record makes it hold for every reply after, across swipes, and the plan check (2.1) checks the next plan against it.

**Done when:** six of the eight notes above, run as a golden scenario, each leave a record and the next reply holds it. (The other two describe this reply's moment, not a lasting fact.)

*Built:* `steer/notefacts.ts`, run as a reply starts with your note as you wrote it (before an angle adds to it). A clause that names its person ("buffy doesn't know that giles has left") becomes your `know` line by rules; a fact that names its people ("Gabriel bought the socks with Buffy") becomes a story truth. Clauses with "she" and "he" go to the helper once, which must quote the note. The record sits on the message the reply answers, so every take and every reply after reads it. Chips: **Saved: …** with Undo and **That's only for this reply**; either way the same note isn't saved again. Of the eight, five leave records (seven lines in all). "Buffy doesn't know those details about him" doesn't say which details, so it's left as a note; the phone call and "he thinks it" are this reply's moment. No SEAL note for "didn't say": it's a moment, and the note already reaches the writer.

### 5.2 Lessons that are facts move to facts

A lesson learned from a swipe that states knowledge ("Dawn doesn't know that Buffy was in heaven…") is offered as a stance instead, linked to the fact. The style lessons stay lessons.

**Done when:** this chat's knowledge lessons show as stances, with **Keep as a lesson** to undo.

*Built:* `lessonsToFacts` (notefacts.ts), rules only, before every reply. A story lesson (kept or suggested) that is one "X doesn't know / knows …" clause becomes a `know` line ("— a lesson you kept") and the lesson is switched off. The chip on its reply reads **Now a record: …** with Undo (the lesson back as it was) and **Keep as a lesson**. A lesson is moved only once.

---

## Part 6 · Measure it

### 6.1 Knowledge golden scenarios

From this chat, with names kept:

| Scenario | Checks |
|---|---|
| 15-told-on-the-call | #322's plan and prompt: Dawn knows about the socks; a reply writing them as news fails |
| 16-saw-it | Dawn after the hand-holding: knows (saw it) |
| 17-persona-details | Buffy naming Gabriel's jobs before he's told her: leak |
| 18-notes-stick | the eight notes: records, held on the next reply |
| 19-planner-input | the planner request contains KNOWLEDGE, FACTS IN PLAY and CANON 4 |

### 6.2 State health in the notebook

Three numbers next to the planner's notebook, for the last 20 replies against the ones before:
- notes of yours that correct state (5.1 counts them)
- plan contradictions caught (2.1)
- stale unknowns (3.3's list)

Story health (D3) gets them as a part. A rise shows up before you find it in the prose.

### 6.3 Each lane reaches the prompt

c857415 found a rule that never shipped. A test builds the writer's and the planner's requests for a golden chat and fails if a lane the trackers produced is missing from either: KNOWLEDGE, FACTS IN PLAY, CORRECTIONS, and the preset's rules by version. It's the same idea as the preset-version test, aimed at every lane.

---

## Not in this plan

- **Different models.** Writer, planner, tracker and checker are all GLM 5.2 here. A different model for the checker (or the tracker) would catch more, because it doesn't share the writer's blind spots. That's a routing choice in Settings › Routing, not code. It's worth trying once Part 2 can show the difference in numbers.
- **Rewriting the card or persona.** Still never edited to match a chat (docs/16 principle 1).
