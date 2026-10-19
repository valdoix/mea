# Build plan: reliable state (lore, trackers and the prompt agree)

**Written:** October 19, 2026 · **Base:** Mea `main` after PR #111

In the Yellowjackets chat, Jeff and Shauna's secret was revealed to Jackie at message 67, and the tracker recorded it correctly. The model kept writing as if she didn't know, because the same fact was written in four places and only one of them heard about the reveal:

| Where | What it still said after #67 |
|---|---|
| Tracker (`#jeff-shauna`) | Revealed to Jackie, kept from nobody ✔ |
| Lore secrets (`extra.secrets`) | `[Secret — known only to Jeff Sadecki, Shauna Shipman: Jackie does not know…]` ✘ |
| Jackie's card | "She does not yet know about Jeff and Shauna" ✘ |
| Summaries | "Shauna's pregnancy — Jeff doesn't know" (true, but written before the reveal) |

The event log also showed the model's ledger lines losing their meaning before they reached the tracker: keepers and status in the wrong place, names that don't resolve, the same fact stored twice.

PR #111 fixed the symptom: lore secrets that match a revealed tracker fact (by word overlap) say so, the knowledge note names who found out, and the leak check counts them as knowing. This plan makes that dependable. The tracker stays the one source of truth. Everything else either links to it or is checked against it before the prompt goes out.

The plan has 4 parts. **Every part is its own PR.** The numbered steps are the pieces inside a part's PR, each with its own tests and "done when".

---

## 0. Read this first

### 0.1 What's already in Mea (found while planning)

| Piece | Already in Mea | So this plan… |
|---|---|---|
| Ledger parsing | `trackers/dsl.ts` `parseLine`: `know` reads `· status · truth` after a `\|`; `secret` reads `kept by` / `from` after a `\|`; the cause is everything after ` — ` | recovers the fields when the model puts them in the cause (1.1) |
| Name lists | `secret` splits keepers/from on `&` and `and` only | splits on commas too, and reads "known to X" asides (1.2) |
| Group words | `GROUP_WORD` in `trackers/fold.ts` expands "the group", "everyone"… to who's present | stops other collective words ("general public") from becoming people (1.3) |
| Fact keys | `fact()` reuses a fact at overlap ≥ 0.75 only when no `#key` is given | folds a near-duplicate into an existing secret (1.4) |
| Re-declaring a secret | `secret` adds the new `from` to the old list | no longer hides it again from someone who found out (1.5) |
| Reveals | `reveal` op: stances → knows, `from` shrinks, `revealed[]` grows; `trackers/reveals.ts` (#111) lists them and fuzzy-matches text to them | gets an exact link instead of the fuzzy match (2.1) |
| Lore secrets | LORE-09 `extra.secrets` `{text, knownBy}`; living-lore facts with `known_by` (`lore/facts.ts`) | link to tracker facts (2.1), and the facts follow reveals too (2.2) |
| Keep-up | `lore/keepup.ts` (docs/15 part 2): tracker changes become fact proposals | proposes knownBy changes for secret facts (2.2) |
| Off-page filter | B1 `offpageFilter`: rewords lore and memory before the prompt | is where the prompt check (Part 3) runs, after it |
| Golden scenarios | K1 `golden/run.ts`: card, ledger, history; checks prompt `contains`/`lacks`, `bad` replies, `ledgerShape`, `after` paths | gets lore entries and a reveal scenario (4.2) |

### 0.2 Principles

1. **The tracker is the truth for who knows what.** Lore, cards and summaries describe what was true when they were written. They are never edited to match a chat, because a companion book is shared across chats and branches.
2. **Correct at render time, follow the branch.** Corrections are computed from the tracker as of the message being written, so a swipe back before the reveal brings the secret back.
3. **Keep the cache.** The card and constant lore sit in the stable prefix (CTX-04). A correction goes in the dynamic block, never into the card text itself.
4. **Reject loudly, don't guess quietly.** A ledger line that can't be understood gets a verdict the model sees next turn ("whose secret? 'general public' isn't a person"), not a made-up character.
5. **Rules first.** Nothing in this plan adds a model call.

---

## Parts at a glance

| Step | What it adds | Needs |
|---|---|---|
| **Part 1 · Clean ledger lines** | | |
| 1.1 | Fields recovered from the cause | — |
| 1.2 | Name lists and "known to" asides | — |
| 1.3 | No people from collective words | — |
| 1.4 | One fact, not two | — |
| 1.5 | A re-declared secret stays revealed | — |
| **Part 2 · Linked secrets** | | |
| 2.1 | Lore secrets link to tracker facts | #111 |
| 2.2 | Lore facts follow reveals | 2.1 |
| 2.3 | Card sentences tied to their secret | 2.1 |
| 2.4 | Summaries written before a reveal | — |
| **Part 3 · The prompt check** | | |
| 3.1 | Find claims that contradict the tracker | 2.1 |
| 3.2 | Corrections lane and Inspector | 3.1 |
| **Part 4 · Testing on real chats** | | |
| 4.1 | `prompt-audit` script | 3.1 |
| 4.2 | Golden scenarios for reveals and ledger shape | Part 1, 2.1 |
| 4.3 | Local chat fixtures | 4.1 |

---

## Part 1 · Clean ledger lines

Bad state comes in through the ledger. This part makes each line say what the model meant, or fail where the model can see it.

### 1.1 Fields recovered from the cause

**Seen:** `secret #jeff-shauna: … — kept by Shauna · from Jackie — Jackie now knows pregnancy but not the father` parsed with no keepers or `from`. `know Jackie: Shauna is pregnant — heard Shauna confirm · knows · true` parsed with no status (the fold defaulted it to `knows`, by luck).

**How it's built**
- `dsl.ts`: after splitting off the cause, `know` and `secret` scan the cause's `·`-separated parts with the same patterns as the `|` meta: a status word, a truth word, `kept by …`, `from …`. A matched part moves into args, and the rest stays as the cause.
- Only bare tokens match (`knows`, `true`, `kept by X`), so a cause like "she knows it's true" is left alone.

**Done when:** both lines above parse to the same args as their `|` forms; `ledgerShape` cases cover them (4.2).

### 1.2 Name lists and "known to" asides

**Seen:** the card's `kept by Jeff, Shauna` produced keepers `[Jeff]`. `from general public; known to James, suspected by Shauna` produced a person named "general public; known to James".

**How it's built**
- `dsl.ts` splits name lists on `,`, `;`, `&`, `and`.
- In `from`, a `known to X` part adds X as a keeper-side knower (a `knows` stance), and `suspected by X` adds a `suspects` stance. Neither goes into `from`.

**Done when:** the card's line gives keepers `[Jeff, Shauna]`; the aside line gives `from: []`, James knows and Shauna suspects.

### 1.3 No people from collective words

**Seen:** "Group" and "general public" became characters. Once one exists, `findChar` keeps finding it.

**How it's built**
- `fold.ts`: a second list, `NOBODY_WORD` (public, people, town, school, world, nobody, no one, anyone…). In `people()`, these resolve to no one. For `secret … from`, "everyone"/"the public" mean "everyone but the keepers": store `from: ["*"]`, and read `*` as "anyone not a keeper and not told". `exposure`, `leakRule` and `note.ts` learn the wildcard.
- A line whose only names resolve to nobody is rejected with a reason ("from whom? name the people").
- *Built:* no cleanup card was needed. The fold reads `know` and `secret` lines the model wrote again from their text (`op.raw`), so older chats get the new parser and rules on the next fold, and the "Group" and "general public" people stop existing. The engine's own lines keep their stored args.

**Done when:** a new chat's ledger can't create "Group"; the Yellowjackets chat shows a finding for "Group" and "general-public".

### 1.4 One fact, not two

**Seen:** `know Jackie: Jeff is sleeping with Shauna, Shauna is pregnant` (no key) made `#jeff-is-sleeping-with-shauna-shauna-is-pregnant` next to `#jeff-shauna`. Jackie "knowing" the copy never touched the secret.

**How it's built**
- `fact()` without a key: look for an existing **secret** first, at overlap ≥ 0.6 (the threshold `reveal` uses), then any fact at ≥ 0.75 as today.
- A `know` stance of `knows`/`believes`/`suspects` on a secret already drops that person from `from` (fold line ~943), so the dedup alone fixes the reveal.
- A `#key` given to a fact first written without one (the card's `know` line before its `secret` line) takes that fact over, stances and all. *Built:* the re-fold merges existing pairs, so no **Merge** card.

**Done when:** a keyless `know` on a secret's statement updates the secret; the Yellowjackets chat shows the pair as a finding.

### 1.5 A re-declared secret stays revealed

**How it's built:** in `case "secret"`, a name in the new `from` that already has a `knows` stance from a `reveal` (or a later `know`) is left out, with a note on the verdict ("Jackie already found out at #67"). Only a user-sourced `secret` line can put them back.

**Done when:** `secret` → `reveal to Jackie` → `secret … from Jackie` leaves `from` empty.

---

## Part 2 · Linked secrets

#111 matches lore text to tracker facts by word overlap on every prompt. That works on this chat, but it's a guess. This part replaces the guess with a link you can see and fix.

### 2.1 Lore secrets link to tracker facts

**What you get:** in the lorebook editor, each secret shows a chip: **Tracked as #jeff-shauna** (click: the Codex ledger entry), or **Not tracked** with **Link…**. In a chat where it has come out, the chip says **Revealed to Jackie at #67**.

**How it's built**
- `extra.secrets[i].fact?: string`: a tracker key. No migration (it's JSON in `extra`).
- Set when the tracker starts from the card: the init pass that writes `secret #key … — from the card` records which lore secret each came from. A backfill on first open uses `revealFor` (#111) and links only matches ≥ 0.75; the rest stay unlinked for you.
- `withSecrets` and `leakRule` use the link when there is one, and fall back to `revealFor` when there isn't.

**Done when:** the three Jeff/Shauna lore secrets link to `#jeff-shauna`, the journal secret doesn't, and unlinking one stops its "No longer a secret" line.

*Built differently:* tracker init is written by the model from the card text only, never from lore, and a fact's key is that chat's own. So the link can't live on the shared lore entry. It lives with the chat instead (`lore/secretlinks.ts`): matched by words (≥ 0.6), offered as **Link** when close (≥ 0.4), and overridden by you in `settings.secretLinks`. The chips are in **Codex › Promises & secrets**, under each tracker secret ("Also in lore: Shauna", **Unlink** / **Link**), not in the lorebook editor, which has no chat.

### 2.2 Lore facts follow reveals

Living-lore facts can be secret too (`known_by`). They render `secret — known only to …` in `factLine` (`lore/facts.ts`) and ignore reveals.

**How it's built**
- `factLine` takes the same reveals as `withSecrets`. A secret fact that matches (or links to) a revealed tracker fact renders "since revealed to …".
- Keep-up 2.1 gets one more rule: a `reveal` event proposes a **chat-scoped** fact change, adding the person to `known_by`. It's branch-safe like every story fact, and it never touches the canon fact.

**Done when:** a secret fact on Shauna's entry renders as revealed in the Yellowjackets chat and as secret in a fresh chat with the same book.

*Built:* the rendering only. The keep-up proposal was left out: the rendering already comes from the tracker as of the message being written, so it follows swipes, and a stored change would only be a second copy of the same state.

### 2.3 Card sentences tied to their secret

**Seen:** "She does not yet know about Jeff and Shauna; when either surfaces, it hits her abruptly…" stays in the card. #111's knowledge-note line only answers it while Jackie is in the scene.

**How it's built**
- At tracker init, for each card secret, record the card sentences that state it: sentences whose words match the secret (the `revealFor` test), stored on the fact as `fact.cardLines: string[]`. Re-run when the card changes (the `basisOf` fingerprint).
- When the fact is revealed, the dynamic block gets: `The card was written before this came out: "She does not yet know about Jeff and Shauna…" — Jackie knows now (#67).` The card text itself is unchanged (principle 3).

**Done when:** the Yellowjackets prompt carries that line with Jackie out of the scene too, and the stable prefix's hash is the same before and after the reveal.

*Built differently:* the sentences are found when the prompt is built, not stored at init (`accuracy/corrections.ts`, the `[CORRECTIONS]` lane). The card is a few thousand words, so this is cheap, and it follows card edits without a fingerprint. Only card fields are read. Lore entry *content* that says the same thing (a constant world entry, say) is left for Part 3.

### 2.4 Summaries written before a reveal

**How it's built**
- A summary has `end_seq`. When building the Story So Far, any reveal at a seq after a summary's `end_seq` whose statement matches the summary text (`revealFor`) adds one line after it: `Since then: Jackie found out that Jeff is sleeping with Shauna (#67).`
- The summarizer prompt gets the current reveals, so summaries written afterwards don't repeat "X doesn't know".

**Done when:** a summary ending at #60 that says "Jackie doesn't know" gets the "Since then" line at #70, and not at #65.

---

## Part 3 · The prompt check

Parts 1 and 2 fix the sources we know about. This part catches the ones we don't: any text in the assembled prompt that says something the tracker says is no longer true.

### 3.1 Find claims that contradict the tracker

**How it's built**
- `accuracy/promptcheck.ts`, run in `prepare()` after the off-page filter, over every piece: card, lore placements, Story So Far, recall, journals.
- Claim patterns, rules only:
  - **Knowledge:** "X doesn't know / does not (yet) know / has no idea / has told no one / known only to A, B" + a statement. Compared with the matching tracker fact's stances (link first, then `revealFor`).
  - **Deaths:** "X is alive / waiting at home" against `dead`; "X died" against a living, present character.
- Each finding has the source piece, the sentence, the tracker fact, and the seq the tracker changed it.
- Budget: one pass of regexes over text already in memory, capped at 300 findings; measured with `scripts/check-budgets.ts`.

**Done when:** on the Yellowjackets prompt it finds the card sentence, the three lore secrets (if 2.1 were off) and the Shauna "Still open" line, and nothing in the 20 latest prompts of two other chats (no false alarms).

### 3.2 Corrections lane and Inspector

**What you get**
- A `CORRECTIONS` lane in the dynamic block: at most 6 lines, newest change first, each "Written before #67: … — now Jackie knows."
- Inspector › the prompt › **Out of date** section: each finding with its source and a **Go to** button (the lore entry, the card field, the summary).
- Settings › Memory › **Correct out-of-date text** (on by default).

**How it's built:** `registerLane("corrections", …)`, priority just under knowledge, so it survives a tight budget. Findings that 2.1–2.4 already corrected are skipped, so nothing is said twice.

**Done when:** the lane appears only when there's a finding, and turning the setting off removes it.

---

## Part 4 · Testing on real chats

### 4.1 `prompt-audit` script

**What you get:** `bun scripts/prompt-audit.ts <chatId>` prints the prompt the next reply would get and, for every tracker secret, its state and every prompt line that mentions it, with Part 3's findings marked.

**How it's built**
- Reads only. Copies `data/mea.db` with `VACUUM INTO` to a temp folder, sets `MEA_DATA_DIR` there and opens it, so the production server on :7766 is never touched.
- Builds the prompt with `prepare()` without `advise` (the way previews do: no waiting on the planner, nothing sent) and with jobs paused.
- `--json` for diffing two runs.

**Done when:** it reproduces the #111 diagnosis in one command.

### 4.2 Golden scenarios for reveals and ledger shape

- `golden/run.ts`: scenarios get `lore: [{ keys, content, secrets }]`.
- `14-revealed-secret.json`: a card that says "Mira doesn't know Ash took the ledger", a lore secret "known only to Ash", `secret` then `reveal to Mira`. `prompt.lacks` "known only to Ash:", `prompt.contains` "No longer a secret". A Mira line naming the ledger is **not** flagged as a leak.
- `10-ledger-shape.json` grows the Part 1 lines: fields in the cause, comma lists, "known to" asides, "Group", "general public".

**Done when:** both run in `bun run test`, and each fails if its fix is reverted.

### 4.3 Local chat fixtures

**How it's built:** `prompt-audit --save <name>` writes the chat's events, cards, lore and summaries to `test/local/<name>.json` (gitignored: these are your stories). `bun run audit` replays every saved fixture and compares its findings and secret states with the last saved run.

**Done when:** saving the Yellowjackets chat and replaying it after a change shows "no change", or the lines that changed.

---

## Build order

| PR | Part | Steps in it |
|---|---|---|
| 1 | Part 1 · Clean ledger lines | 1.1 → 1.2 → 1.3 → 1.4 → 1.5 |
| 2 | Part 4 (first half) · Audit and golden | 4.1 → 4.2 |
| 3 | Part 2 · Linked secrets | 2.1 → 2.2 → 2.3 → 2.4 |
| 4 | Part 3 · The prompt check | 3.1 → 3.2 |
| 5 | Part 4 (rest) · Local fixtures | 4.3 |

The audit script moves up so Parts 2 and 3 can be measured on real chats while they're built. 4.1 runs before 3.1 exists and leaves the findings column empty.

## Risks and how they're handled

| Risk | Handling |
|---|---|
| Parser recovers a "field" that was really prose | Only bare `·` tokens match (1.1), and `ledgerShape` keeps prose causes in the tests |
| Fuzzy matching links the wrong secret | Links (2.1) replace matching; backfill links only ≥ 0.75, and the chip shows every link so a wrong one is easy to fix |
| A correction leaks into a branch before the reveal | Everything is computed from the tracker as of the message being written (principle 2); golden 14 swipes back |
| Cache misses | Cards and constant lore are never rewritten; corrections go in the dynamic block (2.3, 3.2) |
| Too many correction lines | Capped at 6, deduped against 2.1–2.4, newest first |
| Touching production data | `prompt-audit` works on a `VACUUM INTO` copy; fixtures are gitignored |

## What you'll do

1. After Part 1, nothing: existing chats are re-read on their next fold.
2. After Part 2, glance at the secret chips on the Yellowjackets lorebook and link or unlink any that look wrong.
3. When a reply gets something wrong, run `prompt-audit` on that chat (or ask me to) and save it as a fixture if it's worth keeping.
