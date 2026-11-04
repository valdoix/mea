# Build plan: details that stay (what was said once is still known later)

**Written:** November 4, 2026 · **Base:** Mea `main` at d079550, with branch `claude/named-recall` (Part 0)

In *Filed Under Forever*, Gabriel told Buffy his frat called him "The Brongel" (#88). Dawn saw the banner and asked about it, with Buffy at the table (#638). At #792 Buffy said: "You had a frat nickname and it was a portmanteau and you never mentioned this?"

---

## 0. What went wrong at #792

Measured on a copy of the production database. Five layers failed, and none raised a flag.

| # | Where | What happened |
|---|---|---|
| 1 | Tracker, #89 and #639 | No `know` or `trait` line for the nickname. #89 filed it as `thread Brongel: new`, and that thread then carried the romance until #217 ("Resolved: Brongel (girlfriend…)"). |
| 2 | Memory | **Worked.** Two facts held it, with who knew: #88 (Buffy, Gabriel) and #638 (Buffy, Gabriel, Dawn). |
| 3 | Recall | Neither fact reached the planner or the writer. The word the player had just used counted for little against broad matches, and scene summaries took most of the relevant slot. |
| 4 | Plan | KNOW said "The 'Brongel' nickname is new information (nobody knew before he said it)". A missing record was read as proof nobody knew, and nothing checks that kind of claim. |
| 5 | Checker | It had both facts (M16, M17) and the line in front of it, and flagged only the emoji and the group chat. |

A separate bug made it worse. A stopped try's words stay on the take, so the next request can read them as the story's newest message. The final #792 request ended with `"The fuck is a 'Brongel'?" Spike said`, and that fragment became the main recall query. 17 of the chat's last 120 writer requests carried a fragment like this.

The damage is now on record: #792's beat says Gabriel "reveals" the nickname, and `know everyone` dates it to that moment.

### Root causes

1. **Absence reads as ignorance.** No reader separates "no record" from "they don't know".
2. **Recall has no sense of rarity.** A word in 3 of 1,567 memories scores like any other match.
3. **Told things aren't filed as knowledge.** Stances depend on the tracker writing a line, and it often doesn't for small personal details.
4. **Memory's "who knows" is not used by knowledge.** `known_by` is filed on memories, but FACTS IN PLAY reads only tracker facts.
5. **Nothing checks a claim of newness**, in a plan or in a reply.

---

## Part 0 · The fix (on `claude/named-recall`, not merged)

- **Names just used come first** (`memory/recall.ts`, `namedTerms` in `memory/text.ts`). A word written as a name and held by 8 memories or fewer brings back its first and latest fact, within 15% of the recall budget. The point-of-view filter still applies. A capitalised name no memory holds gets the message it first appears in, quoted.
- **A stopped try is cleared from the take** before the next request (`discardTry` in `services/generation.ts`).

Replayed offline over the last 126 turns (keywords only, no query embeddings): rare names recalled went from **9 of 27 to 22 of 27**, and both Brongel turns now hit.

**Known gaps:**
- No reply has been regenerated with a live model.
- First-mention quotes can repeat: "Dawn-o" quotes #360 every turn it's used.

---

## Parts at a glance

| Step | What it adds | Needs |
|---|---|---|
| **Part 1 · Absence isn't ignorance** | | |
| 1.1 | Planner and writer are told: no record doesn't mean nobody knows | — |
| 1.2 | Plan check: a claim that something is new is looked up on the page | — |
| 1.3 | Reply check: "you never mentioned" is looked up on the page | — |
| **Part 2 · Knowledge reads memory** | | |
| 2.1 | FACTS IN PLAY lists memories that name the thing, with who knows | Part 0 |
| 2.2 | Told details get a `know` line | — |
| 2.3 | Thread names must describe the thread | — |
| **Part 3 · Names as records** | | |
| 3.1 | A ledger of nicknames and in-jokes: what, whose, who's heard it, since when | 2.2 |
| 3.2 | The lane shows the ones in play | 3.1 |
| **Part 4 · Recall balance** | | |
| 4.1 | A recall test set from this chat | — |
| 4.2 | Scene lift by best match, not sum | 4.1 |
| 4.3 | Review the recent slot and the budget | 4.1 |
| **Part 5 · Measure and repair** | | |
| 5.1 | Golden scenarios | Parts 1–2 |
| 5.2 | "Names remembered" in Story health | Part 0 |
| 5.3 | Repair tool for a wrong "first time" | 2.1 |

**Order:** 1 → 2 → 5.1 → 4 → 3 → 5.2, 5.3. Part 1 catches the failure even when recall misses, and costs no model calls.

---

## Part 1 · Absence isn't ignorance

**1.1** One line in the planner's KNOW step and the writer's rules: people have lived through everything on the page; "new" needs proof, and missing records aren't proof.

**1.2** `steer/plancheck.ts` gains a claim type: "new information", "nobody knew", "first time", "hasn't heard". Take the rare words in the claim and search `swipes_fts` for messages before the player's newest. A hit adds a `[PLAN CORRECTION]`: "Not new: Gabriel told Buffy at #88; Dawn saw it at #638." Rules only.

*Done when:* the stored #792 plan gets that correction, and the last 80 plans give no false ones.

**1.3** A rules-first checker kind, `known`. It looks for "you never mentioned / told me", "first I've heard", "since when do you", or "what's a X" from someone who has heard X. It searches the page for the term and whether the speaker was present. A flag quotes the source. This doesn't rely on the helper model, which missed #792 with both facts in hand.

*Done when:* #792 is flagged citing #88 and #638, and Spike's "The fuck is a 'Brongel'?" is not (he hadn't heard it).

*Built differently:* `accuracy/notnews.ts`. 1.1 is one sentence in KNOW (preset 23), which the separate planner shares. 1.2 is narrower than written: "nobody knows" looks ahead as often as back, and hearing a word isn't knowing every sentence with it in, so a plan is corrected only when it says outright that the thing is new or that someone has never heard this very word, and for a named person only when the memories have them knowing it. 1.3 reads "you never mentioned / told", not "since when" or "what's a X", which would need to know who's speaking. Over every plan and reply in both real chats (390 plans, 417 replies): one plan and one reply found, both #792. Spike's question at #792 isn't flagged.

---

## Part 2 · Knowledge reads memory

**2.1** `inPlay` (`trackers/note.ts`) also takes memories holding a rare term from the message, and prints their `known_by` and seq: "Brongel: Buffy, Gabriel knew (#88); Dawn too (#638)". This puts it in the state lane, which every reader gets, so it doesn't depend on recall's budget.

**2.2** The tracker prompt gets a rule with this chat's example: when someone tells a personal detail, write a `know` line for each listener, and a `trait` if it's lasting. Part 1 of docs/19 3.1 (witnesses) can fill the same gap by rule: a fact stated in a scene is known to those present.

**2.3** `thread` lines are rejected when a nickname or item names a thread whose details are about something else, or at least flagged in the ledger. "Resolved: Brongel (girlfriend)" is a wrong record in its own right.

*Built differently:* 2.1 is `memory/named.ts`. Only a word written as a name, and only that very word, since this lane is read as true over any guess: over the last 150 turns it adds 23 lines, and #791's reads "Gabriel's Sigma Chi frat brothers called him 'Brongel'…: Buffy Summers, Gabriel Winters, Dawn Summers know it". 2.2 and 2.3 are rules in the tracker prompt, not checks, so nothing yet proves the model follows them, and the witness rule from docs/19 3.1 is still open. Old chats keep the records they have.

---

## Part 3 · Names as records

This story runs on them: Brongel, Dawn-o, facefriend, the filing alphabet. Each is a small fact with an owner, an origin and an audience.

**3.1** A `name` ledger line: `name Gabriel: Brongel — frat nickname, brother-angel`, with who has heard it, kept by the fold so swipes and rewinds follow. Backfill by the tracker's existing backfill pattern.

**3.2** A lane shows only names used in the newest messages, with origin and who knows. Decide after Part 2 whether this still adds enough: 2.1 may cover most of it.

---

## Part 4 · Recall balance

Deliberately left out of Part 0. Tried on the replay, the scene-lift change moved the relevant slot from about 5 summaries and 2 memories to 2 and 42, with no query embeddings to judge it fairly.

**4.1** A test set: questions from this chat with known source messages, scored with embeddings on. Costs a small embedding spend, so it needs your go-ahead.

**4.2** A scene's lift is its best memory's score rather than the sum of all of them.

**4.3** Check whether the recent slot (about 70 memories at #792, such as the pool's loungers) earns its 35%, and whether 6% for recall is still right for a chat this long. Compare both with the test set.

*Built:* `scripts/recall-eval.ts` scores 39 turns of *Filed Under Forever*, each with the memories it should have had: names, shared words, meaning, and real slips. Each was judged by reading it. The cases stay in `data/evals/`, since the repo is public. The query embeddings came to about 12,000 tokens, a fraction of a cent at OpenAI's list price.

| Writer, a memory reaching the recall block | Hit | Hit, or its scene's summary | Memory / summary tokens |
|---|---|---|---|
| As it stood | 17 of 39 | 22 of 39 | 52% / 44% |
| Budget up by a third | 18 | | 53% / 44% |
| Recent slot down to 20% | 20 | | 40% / 56% |
| No serendipity | 19 | | 41% / 55% |
| Scene lift by best match | 22 | | 70% / 26% |
| Lift, and summaries capped at half the relevant slot | 25 | 29 | 77% / 19% |
| **Those, and rare words shared (shipped)** | **32** | **34** | 76% / 20% |

The budget wasn't the problem, so it stays at 6%, and the recent and serendipity slots stay too. The planner, on its 2,500 tokens, goes from 16 to 28 of 39, with summaries down to 4% of its recall; it also reads the chapters and scenes since the Story So Far separately.

**How far to trust this:** the "shared words" cases were found by looking for shared rare words, so their 14 of 14 is partly circular, and of 62 turns that signal found, about a quarter were real callbacks. It fires on about one turn in six and costs a memory or two, so that's cheap, but it isn't free. The set also counts memories, which favours memories over summaries; the second column guards against that, and it rose too. What fewer summaries does to the prose can only be seen in live replies. The three real slips still miss: where an object is now (the album, the mug) and who picked the socks aren't a ranking problem, and need the records.

---

## Part 5 · Measure and repair

**5.1** Golden scenarios:

| Scenario | Checks |
|---|---|
| #791 → #792, Brongel | planner and writer both get #88 and #638; the plan isn't called new; the original reply is flagged |
| Spike hears it for the first time | no flag |
| A truly new name | no correction, no invented history |
| A stopped try, then a retry | the fragment isn't in any later request |

**5.2** Story health gets "Names remembered": rare names used, and how many had their records reach the prompt. Worked out from the stored traces, so a drop shows up before the prose does.

**5.3** A way to fix a wrong "first time" after the fact: edit the beat and the stance date, not only the reply's words. Today this takes editing #792 and then its ledger lines by hand.

*Built:* 5.1 as `golden/26-old-news` and `27-truly-new` (a stopped try is `genlayer.test.ts`, the plan's correction is `notnews.test.ts`). 5.2 as `namesStats` in `memory/named.ts`, from `memory_usage` on the kept try. On the real chat's last 20 replies, before these fixes: 0 of 3, the latest "brongel" at #792. It counts memories only, not the FACTS IN PLAY line, so it measures recall. 5.3 isn't built.

---

## Not in this plan

- **Editing #792 in the live chat.** That's your story and your call. A swipe or an edit of Buffy's line works once Part 0 is running.
- **A different model for the checker.** Still worth trying (docs/19), but Part 1.3 doesn't wait for it.
