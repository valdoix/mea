# Design: secrets that make sense

**Written:** November 14, 2026 · **Base:** Mea `main` at d94221e · **Follows:** [keeps up with itself](33-keeps-up-with-itself.md)

Mea flagged a line of Buffy's as a major slip: *"Buffy Summers doesn't know this: 'Buffy asks Gabriel not to tell Walter she is alive, not yet' (kept by Gabriel Winters)."* Buffy is the one who asked. The line it flagged ("And if she asks why you want it, tell her Dawn's running a background check!") has nothing to do with the secret.

This plan says why that happened, what is already fixed, and what to change so Mea can't say something like it again.

In short: Mea wrote the secret down as **something that happened** rather than **what is hidden from whom**, then treated **everyone not listed as a keeper** as not knowing it, then matched it against a reply on **two ordinary words** ("asks", "tell"). Each step was a guess, and nothing checked the result before it was shown as a major slip.

And the secret was already over. Walter found out at message 902, the tracker recorded it, and the secret stayed on the books as a secret with nobody left to keep it from.

Seven parts. **Every part is its own PR.**

---

## 0. What went wrong

### 0.1 What I looked at

- The leak check, `leakRule` in `server/src/accuracy/rules.ts`, and the code that writes a secret down, the `secret` case in `server/src/trackers/fold.ts`.
- Your stories, read-only: every continuity flag and every secret the trackers recorded.

### 0.2 What the data shows

The tracker line behind the flag, written by the model at message 57:

```
secret #alive: Buffy asks Gabriel not to tell Walter she is alive, not yet | kept by Gabriel Winters · from Walter
```

That one secret has raised five leak flags, against three different people:

| Flagged line | "Doesn't know" | Words that matched |
|---|---|---|
| "Don't tell him about the soup either," Buffy says to the cat | Buffy | *tell*, *asks* nearby |
| A memory of the pool "when … Joyce was alive" | Dawn | *alive*, *asks* |
| "Gabriel asking about Spike's blood the way Buffy asks Dawn about her homework" | Spike | *asks*, *tell* |
| "Gabriel loves you. I can tell." | Buffy | *tell* |
| "And if she asks why you want it, tell her Dawn's running a background check!" | Buffy | *asks*, *tell* |

Four were dismissed by hand; the fifth is the one in the screenshot. Across all stories the rule has raised ten leak flags. Seven were dismissed, three are open, and seven of the ten come from two secrets (this one, and "Gabriel Winters is with Buffy Summers", which docs/33 Part 7 patched for names only).

Of the 41 secrets the trackers have written, 14 name nobody they are kept from.

**The secret had ended.** I replayed the story's tracker events through the fold. What it holds for `#alive` today:

- Kept from: nobody. Walter was told at message 904 (`reveal #alive: to Walter`), after Buffy shouted it at 902, and he has been in the scene ever since.
- Recorded as knowing: Gabriel, Walter, Dawn, Spike, Xander, Willow, Tara, Anya, Chloe, Gabriel's mom.
- The only person in the cast with nothing recorded: Buffy.

So when the flag in the screenshot was raised, at message 956, the secret was kept from no one, and the one person the rule could still call ignorant was the person it is about.

The same replay shows three more things:

- The model wrote status notes as secrets: `secret #alive: open — Buffy must say the alive part now`, `secret #alive: risk — Walter glimpsed Buffy twice`, `secret #alive: revealed to Walter — Buffy shouted it`. None of these is a secret line and none changed anything.
- `reveal #alive: to Gabriel's mom (name "Buffy Summers" only, nothing else)` created two people who don't exist, "gabriels-mom-name-buffy-summers-only" and "nothing-else". Both are now in the cast and are listed among the people `#grave` is kept from.
- `#grave` ("Buffy clawed out of her own grave with bare hands", kept from everyone) still lists Walter as unaware. At 904 the tracker wrote `know Walter: Buffy died in May… clawed out of Restfield six days ago`. Same fact, other words, no link to the secret.

### 0.3 The causes

| # | Cause | Where |
|---|---|---|
| 1 | **"Not listed as knowing" was read as "doesn't know".** The rule checked every character who wasn't a keeper or a recorded knower. The secret is kept from Walter. It says nothing about Dawn or Spike, and Buffy is the person it is about | `leakRule`, the `knowers` set |
| 2 | **The secret is an event, not a hidden truth.** What's hidden is "Buffy is alive", from Walter. What was written is "Buffy asks Gabriel not to tell…", so the secret's own words are words about asking and telling | the model's `secret` line; nothing in `fold.ts` checks its shape |
| 3 | **Whoever asked for the secret isn't recorded as in on it.** Only "kept by" names get a "knows" stance. Buffy, the subject of the sentence, gets nothing | `fold.ts`, `case "secret"` |
| 4 | **Two ordinary words are a match.** After names are removed the secret has three words left: *asks*, *tell*, *alive*. Any sentence of Buffy's dialogue with two of them is a "leak". The rule has no idea which words carry the secret | `leakRule`, `secretWords` |
| 5 | **Nothing reads the flag before you do.** The message contradicts its own citation ("Buffy doesn't know: Buffy asks…") and is still shown as major. The "make it canon" button offers "Buffy Summers learned that Buffy asks Gabriel…" | `leakRule` output, `canon` |
| 6 | **Dismissing teaches nothing.** Four dismissals of the same secret did not stop the fifth flag | `dismissIssue` |
| 7 | **A wrong flag has side effects.** While a leak flag is open, the tracker refuses to record that the flagged person learned the thing ("held", docs/33 2.3), and the flag's fix line ("they must not reference it") is what a rewrite is told | `fold.ts` `held`; `fixNotes` |
| 8 | **A secret never ends.** A reveal takes the person off the "kept from" list, but when the list is empty the fact is still a secret: still on the Secrets card, still checked for leaks, still sent to the tracker model as a live secret | `fold.ts`, `case "reveal"`; every reader of `f.secret` |
| 9 | **Learning it in other words doesn't count.** A `know` line reaches a secret only when its words overlap enough. "Clawed out of Restfield" doesn't meet "clawed out of her own grave", so Walter is still "unaware" of something he was told to his face | `fold.ts`, `case "know"` |
| 10 | **Notes in brackets become people, and status notes become secrets.** "(name only, nothing else)" was read as two names. "secret #alive: risk — …" was accepted as a secret line | `fold.ts` `people()`; `dsl.ts` `case "secret"` |

### 0.4 What is already fixed

In the PR that carries this plan (`server/src/accuracy/rules.ts`, tests in `server/test/accuracy.test.ts`):

- **Only people a secret is kept from are checked** (the "from" list, or a recorded "unaware"). A secret kept from nobody by name still checks bystanders, as before, but never a person named in the secret itself.
- **Words about telling and knowing don't count** as a secret's content (*asks, tell, knows, kept, promised…*). A secret with fewer than two real content words is not matched at all.

- **A finished secret is not checked.** Once everyone it was kept from has been told, nobody is flagged for it.

With those three changes none of the five flags above is raised, and the existing leak tests (Mira and the harbour ledger) still pass. Causes 1 and 4 are closed for this rule, and cause 8 for this rule only. Causes 2, 3, 5, 6, 7, 9 and 10, and the rest of 8, are what the parts below are for.

The open flag in your story was raised before the fix and is stored, so it stays until you dismiss it. Part 4 makes Mea withdraw flags like it by itself.

---

## Principles

1. **Three answers, not two.** For any person and any fact Mea says *knows*, *doesn't know* or *nothing recorded*. Only "doesn't know", written down by the tracker or by you, can raise a leak.
2. **A secret is a hidden truth and who it's hidden from.** How it came to be hidden (who asked whom) is the reason, not the secret.
3. **A flag has to survive being read.** Before a flag is shown, Mea checks it against its own citation. A flag that contradicts its evidence is dropped, and logged.
4. **A wrong flag costs more than a missed one.** Every false major teaches you to dismiss without reading. When Mea isn't sure, it says less, or says it quieter.
5. **Your answer sticks.** Dismissing a flag is information about the story and is kept as such.
6. **No new model calls on ordinary replies.** Everything here is rules and tracker state, except where a helper call already happens.
7. **One PR per part,** tests in `server/test/`, `bun run test`, `check` and `build` green, built in a worktree.

---

## Part 1. Write a secret down as what it is

**Problem:** causes 2 and 3.

**1.1 Tell the model the shape.** The tracker prompt (`server/src/trackers/prompts.ts`) gives one line of syntax for `secret`. Add one line of meaning and one example pair: the fact is the hidden truth in a plain sentence ("Buffy is alive"), "kept by" is everyone who is in on it, "from" is who must not find out. Wrong: `Buffy asks Gabriel not to tell Walter she is alive | kept by Gabriel`. Right: `Buffy is alive | kept by Buffy, Gabriel · from Walter — Buffy asked`.

**1.2 Repair the shape when it comes in wrong.** In `fold.ts`, before a secret is stored, recognise the "request" form: *A asks/tells/makes B promise not to tell C (that) X*, *A hides X from C*, *A hasn't told C X*. `unawareOf` in `server/src/memory/overturn.ts` already parses the "doesn't know / hasn't told" family and can be extended. From a match: the statement becomes X (with "she/he/they" resolved to A when the clause has no other subject), A and B join the keepers, C joins "from", and the original sentence is kept as the reason. If the pattern doesn't match cleanly, the secret is stored as written.

**1.3 Whoever a secret is about, or who said it, is in on it.** When a secret is stored, each person named in the statement who isn't in "from" gets a "knows" stance with the route "it's about them", unless you set their stance yourself. This closes cause 3 at the source, so every reader of the tracker (the story note, the plan check, the sim) sees Buffy as knowing.

**1.4 Existing stories.** The fold replays stored events, so 1.2 and 1.3 apply to old secrets on the next re-fold. A test replays the `#alive` line and checks the result: statement "Buffy is alive", keepers Buffy and Gabriel, from Walter.

**Done when:** the `#alive` line folds to the right secret; a secret already in the right shape is unchanged; a user-set stance is never overwritten.

## Part 2. One answer to "does this person know?"

**Problem:** cause 1, in every place that asks the question. The leak rule, the prompt check (`promptcheck.ts`), the plan check (`plancheck.ts`), the story note (`note.ts`), the sim's reach (`sim/reach.ts`) and the journals each work it out for themselves from keepers, stances and reveals, and they don't agree on what a missing entry means.

**2.1** One function in `server/src/trackers/`: `knowledgeOf(fact, personId)` returns `knows`, `suspects`, `unaware` or `unsaid`, with the reason (keeper, told at message N, kept from them, it's about them, nothing recorded).

**2.2** Move each of the six callers onto it. `unsaid` never raises a major flag and is never written into the prompt as "doesn't know".

**2.3** The leak rule keeps its fallback for secrets kept from nobody by name (14 of 41), but those flags are **minor** and worded as a question: "Does Dawn know this?".

**Done when:** no code outside that function reads `secret.keepers` or `stances` to decide knowledge; a test table covers keeper, told, kept from, about them, unsaid, dead and the user.

## Part 3. Match the secret, not its vocabulary

**Problem:** cause 4. Even with the telling words removed, two shared words is a low bar: "Buffy clawed out of her own grave with bare hands" flagged Ruth once.

**3.1 Weigh words by how rare they are in this story.** A word that appears in a hundred messages (*alive*, *house*) says little; *ledger* says a lot. Use the counts the memory search already keeps. A match needs enough weight, not a count of two.

**3.2 Match word forms.** *asks/asked*, *steal/stole/stolen* should meet. Use the stemmer already in `server/src/accuracy/promptcheck.ts` (`stems`).

**3.3 The sentence has to state it.** A question ("Is she alive?"), a negation, or a memory of something else is not a leak. Reuse the memory test from the time rule and add question and negation tests.

**3.4 Short secrets.** A secret with one real content word ("Buffy is alive") can't be matched on words at all. For those, the rule looks for the statement itself: the subject's name or pronoun in the flagged person's own speech, with the predicate ("alive", "back", "not dead"). If that can't be done reliably the secret is left to the model check that already runs after a reply, which is given the kept-from list from Part 2.

**Done when:** the fixture set in Part 6 raises no false flag, and the true leaks in it are still caught.

## Part 4. A flag must survive being read

**Problem:** causes 5 and 7.

**4.1 A sense check on every rule flag,** run in `ruleCheck` before flags are stored. For a leak: the person isn't the grammatical subject of the secret; `knowledgeOf` says `unaware`; the flagged sentence and the secret share weighted content. General checks for every kind: the citation exists, the person named in the conflict is in the story, the claim is in the reply. A flag that fails is dropped and counted in the log, so a rule that fails often shows up.

**4.2 The words fit the certainty.** "Doesn't know this" only when the tracker says so. Otherwise "may not know this". The "make it canon" line is built from the repaired secret ("Buffy told Walter she is alive"), and is left out when it can't be said sensibly.

**4.3 Withdraw flags when the rules change.** Each stored flag records the rule version that raised it. When the server starts with a newer version, open rule flags are re-run against their reply; those the rule no longer raises are closed as "withdrawn" (not dismissed, so the counts in Part 5 stay honest). This clears the open flag from the screenshot without anyone touching it.

**4.4 An unsure flag holds nothing.** Only a major leak with an explicit "kept from" holds back what the tracker records (docs/33 2.3) or goes into a rewrite's fix notes. Minor and "may not know" flags are shown and do nothing else.

**Done when:** the screenshot's flag can't be produced from its tracker state by any path; old open flags from the two secrets in 0.2 are withdrawn on start.

## Part 5. Dismissing teaches Mea something

**Problem:** cause 6.

**5.1 Say why, in one tap.** Dismissing a leak offers: *They do know* · *It isn't about that* · *Just dismiss*. "They do know" writes the `know` line for that person. "It isn't about that" records the pair (secret, sentence) so the same words don't match that secret again.

**5.2 Two strikes.** A secret dismissed twice as "it isn't about that", or dismissed for two different people, stops raising rule flags, and the Secrets card shows "leak check off for this secret" with a switch to turn it back on.

**5.3 Show the rule's record.** In the continuity settings, each rule shows how many flags it raised and how many were dismissed. A rule dismissed nearly every time is one to fix or turn off, and you can see which.

**Done when:** after "They do know" for Buffy, no path flags Buffy for that secret; after two dismissals the secret is quiet.

## Part 6. A standing set of real mistakes

**Problem:** docs/33 Part 7 fixed this rule for one secret and the next one broke it the same week. Fixes are checked against invented examples, not against what actually went wrong.

**6.1 Fixtures from your own flags.** `server/test/fixtures/leaks.json`: the ten real leak flags (tracker lines, sentence, speaker, whether it was a true leak), plus the true-leak cases from the existing tests. The test asserts none of the false ones fires and all of the true ones do. Every later false flag you report is added here first, then fixed.

**6.2 A replay report.** `bun run replay` gets a `--flags` mode: run the current rules over every stored flagged reply in a copy of the data and print, per rule, how many flags would still be raised and how many of those you had dismissed. Run before merging any change to a rule. Read-only, no model calls.

**Done when:** the fixture test is in CI and the replay report runs on a copy of the real data.

## Part 7. A secret ends, and the tracker keeps up with who knows

**Problem:** causes 8, 9 and 10. Walter spent a day in the same room as Buffy and Mea still had a secret about hiding her from him.

**7.1 A secret that's out is closed.** When a reveal or a `know` line empties the "kept from" list of a secret that isn't kept from everyone or from a group, the fold marks it `out` at that message, with who learned it last and how. A secret kept from everyone is out when the tracker says so (`reveal #key: to everyone`) or when you close it. A closed secret:

- moves to a "came out" list on the Secrets card, with the message where it ended;
- is not checked for leaks, has no exposure clock, and is no longer sent to the tracker model as a live secret (it gets one line: "#alive came out at 904");
- stays in memory as a fact everyone concerned knows.

Because the fold replays, `#alive` closes at 904 on the next re-fold with no migration.

**7.2 Being there counts.** If someone a secret is kept from is in the scene, on the spot, with the person the secret is about, and the secret is that this person is alive, present or in town, they know. The fold records the stance with the route "saw them". This is a short list of statement shapes (*X is alive / is back / is here / is in town / exists*), matched by rule, not a general inference. For other secrets, a kept-from person who shares three scenes with the subject raises an Inbox question, "Does Walter still not know this?", instead of a silent assumption either way.

**7.3 A `know` line in other words reaches the secret.** When the tracker writes that someone learned something, compare it to the open secrets kept from that person using the same weighted, stemmed match as Part 3, with the secret's subject required in both. A strong match is a reveal. A middling one raises the same Inbox question as 7.2. The tracker prompt also gets one line: when someone learns a secret, write `reveal #key`, not a new `know` line.

**7.4 Status notes aren't secrets.** A `secret #key:` line for an existing key whose body starts with *open, risk, revealed, safe, still, exposed* and has no "kept by / from" part is not stored as a secret. "revealed to X" is read as a reveal to X. The others are kept as a note on the secret's history. The tracker prompt names the three lines that exist (`secret`, `reveal`, and the clock, which the engine moves).

**7.5 Brackets aren't names.** In a list of people, text in brackets is a note on the name before it, and a part with no capital letter and no known name ("nothing else") is dropped. The two invented people in this story are removed by the re-fold, since they only exist because of that one line.

**Done when:** replaying this story's events gives `#alive` closed at 902 (the model's own note "revealed to Walter — Buffy shouted it" now counts as the reveal), an Inbox question about Walter and `#grave`, and no "nothing-else" in the cast; a secret kept from two people stays open when only one is told.

**Built:** the matching in 7.3 is a first version (shared stems, the secret's subject in both, "some" = two words or one of six letters or more). Part 3 replaces it with weighted matching. 7.2 asks about one person per secret at a time, so a secret kept from everyone doesn't fill the Inbox.

---

## Order and size

| Part | What | Size | Needs |
|---|---|---|---|
| 0.4 | Leak rule checks only who it's kept from; telling words don't count; finished secrets skipped | done | |
| 6 | Fixtures and replay report | small | |
| 7 | Secrets end; who knows keeps up | medium, has UI | |
| 1 | Secrets written as hidden truths | medium | |
| 2 | One "does this person know?" | medium | 1 |
| 4 | Sense check, wording, withdrawal | medium | 2 |
| 3 | Weighted matching | medium | 6 |
| 5 | Dismissing teaches | medium, has UI | 2 |

Part 6 goes first so that every later part is measured against the real mistakes. Nothing here calls a paid model.

## Not in this plan

- The model check's own false flags (176 of 204 "fact" flags dismissed). The sense check in 4.1 covers rule flags only. The model check deserves its own look with the Part 6 replay report in hand.
- Lorebook secrets and secret memories with a known-by list. They use an explicit list already ("only X knows"), so cause 1 doesn't apply, but they share the two-word matching and get Part 3.
