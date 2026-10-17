# Build plan: living lore (continuity across thousands of messages)

**Written:** October 17, 2026 · **Base:** Mea `main` after PR #96

Today a companion lorebook (CHAR-18) is drafted once, from the card, and then stays as it was. **Add lore** only adds entries, and the Chronicle (LORE-12) only proposes entries for *new* people, places and things. So when the story changes something the book already describes (a scar at message 800, a move at message 2,000, a nickname that sticks), the entry keeps saying what was true before. The memory layer knows the change; the lore doesn't.

This plan makes lore **live**. An entry keeps its written core and gains **facts**: small, exact, dated statements that come from the card, from you, or from the story, and that follow swipes and branches. The story proposes changes to those facts, the checker holds replies to them, activation sends only what's true *now*, and upkeep jobs keep the books tidy as they grow.

The plan has 8 parts. **Every part is its own PR.** The numbered steps (1.1, 1.2…) are the pieces inside a part's PR, listed so each one has its own tests and a clear "done when".

---

## 0. Read this first

### 0.1 What's already in Mea (found while planning)

These were checked in the code, so the plan builds on them instead of duplicating them:

| Piece | Already in Mea | So this plan… |
|---|---|---|
| Companion lorebook | CHAR-18: the Lore Studio (`lore/studio.ts`) drafts it from the card's bible and links it to the character | adds a detail sheet to the draft (3.2) and lets the story keep it current (Part 2) |
| Story-born lore | `lore/chronicle.ts`: entities with 3+ mentions and no entry get a proposal; accepted ones go into the chat's Chronicle book | adds *update* proposals for entries that already exist, in any linked book (Part 2) |
| Growing a book | `lore/grow.ts`: one question at a time, each answer a new entry; never touches existing entries | stays as it is |
| The entity graph | `memory/entities.ts`: aliases, status, first/last seen, `entityFacts`, `entityCard`; consolidation refreshes descriptions | is where update proposals find what changed (2.1, 2.2) |
| Memories that change | Atoms have `superseded_by`, `story_time`, `known_by`, `min_seq`/`max_seq`, and tracker memories follow their swipe (`swipe_idx`) | facts copy the same model, so lore follows branches like memory does (1.1) |
| Entity-linked firing | LORE-06 in `lore/activate.ts`: an entry fires when its entity is in the scene, even unnamed | gets tiers: essentials for who's around, the full entry for the focus (6.1) |
| Tracker conditions | TRK-12 (`trackers/condition.ts`), `extra.trackerWhen` on entries | stays; facts can also expire on the clock (5.2) |
| Short form of an entry | `extra.essentials`, `essentialsOf` | becomes the "around" tier (6.1) |
| Lore secrets | LORE-09: `extra.secrets` with `knownBy` | a fact can be a secret too, with the same keepers (1.2) |
| Categories | `lore/format.ts` (Almanac I1): Relationship, Voice, Current and the rest | the bond entry is a Relationship entry, voice slots live on Voice entries (3.5, Part 4) |
| Reply checks | The slip registry (`accuracy/slips.ts`); `checker.ts` already checks eye and hair colour against the trackers and the card | adds a slot check and a "never" check (3.3, 3.4) |
| Running bits | Tracker motifs (`motifs.*` in `trackers/fold.ts`), filed from the selection menu (`accuracy/asides.ts`) | show up as the bond's inside jokes with where they started (4.1) |
| Promises and secrets | `memory/ledgers.ts` (MEM-30, MEM-31) | the bond links its open threads to them (4.1) |
| Belongings and rooms | Almanac E2, `trackers/belongings.ts` | place slots read rooms from it instead of copying (3.1) |
| Calendars | TRK-10, `trackers/calendars.ts` | names the dates for anniversaries (5.1) |
| Lore health | LORE-13, `lore/health.ts`, with hits from `recordLoreHits` | gets the coverage checks (7.1) |
| The memory quiz | MEM-46, `accuracy/quiz.ts` | gets questions from slots, with exact answers (8.3) |
| Out-of-date tracking | `basisOf` fingerprints in the Lore Studio | marks a fact whose source changed (2.3) |

### 0.2 Words used in this plan

| Word | Means |
|---|---|
| **Core** | An entry's written text, as it is today. The story never rewrites it on its own |
| **Fact** | One small, exact statement on an entry: *Eyes: grey*, *Can't swim*, *Lives at the inn at Saltpans (since 0300-02-11)* |
| **Slot** | A named kind of fact for a type of entry (eyes, scar, birthday, handedness…). A slot holds one value at a time |
| **Now** | The facts that are true at the current message, on the current branch |
| **Canon fact** | A fact from the card or from you, true in every chat with the character |
| **Story fact** | A fact the story made, true in one chat (and its forks from after that message) |
| **Invented** | A fact Mea drafted to fill a gap the card leaves open, waiting for your yes |

### 0.3 Principles

1. **Your words win.** The core is never rewritten by a job, and a fact you wrote or locked is never changed without your yes. Same rule as MEM-27.
2. **Propose, don't impose.** Story changes arrive as Inbox cards with a diff. Per book, you can let the plain ones (straight from the trackers) apply on their own, always with an Undo chip.
3. **Branch-safe.** Every story fact carries its message and swipe. Swipe, edit, delete or fork, and the facts from the gone branch disappear with it.
4. **Exact beats pretty.** Facts keep names, numbers, sides and colours word for word. Compaction may shorten the prose, never the facts.
5. **Rules first, model second.** Tracker changes become facts with no model call. Model passes are optional, routed, and respect `shouldShed`.
6. **Visible in the Inspector.** What lore sent, which facts, and why each entry fired (in the scene, the focus, recalled, sticky), with tokens.
7. **Inside Mea only.** Facts live in Mea's database. Nothing in this plan touches lorebook export to other apps.
8. **Meus can do it.** Steps that add an action add its Meus change kind (`meus/changes.ts`), with the usual tick-to-apply card and Undo.
9. **One PR per part,** with tests in `server/test/` for each of its steps, and `bun run test`, `bun run check` and `bun run build` passing. A part lands on `main` before the next part starts.

### 0.4 Where things live

| Surface | What goes there |
|---|---|
| **Lorebook editor** (an entry) | A **Facts** list under the core: slot, value, since, source, lock, and **Add a fact** |
| **Codex** › an entity page | The same facts for this chat, with **Now / History** and a timeline |
| **Inbox** | Update proposals, invented details to confirm, coverage findings |
| **Side dock** › **Story** | The **Bond** section for companion chats |
| **Selection menu** (a reply) | **Remember as a fact**, **That's never true** |
| **Reply flags** | Slot and "never" slips, with the fact as the citation |
| **Inspector** | The `[LORE]` lane split by tier, and the facts it sent |
| **Settings › Memory** | Defaults: who applies story facts, tier budgets |

---

## Parts at a glance

Each part is one PR. The steps are what goes into it, and **Needs** says which earlier step a step builds on.

| Step | What it adds | Needs |
|---|---|---|
| **Part 1 · Facts on entries** | | |
| 1.1 | Facts table and branch-safe reads | — |
| 1.2 | Facts in the prompt | 1.1 |
| 1.3 | Facts in the editor and the Codex | 1.1 |
| 1.4 | Remember as a fact | 1.3 |
| **Part 2 · Entries that keep up** | | |
| 2.1 | Proposals from tracker changes | 1.1 |
| 2.2 | Proposals from memories | 2.1 |
| 2.3 | Trust levels, locks and re-checks | 2.1 |
| 2.4 | Rewrite the core | 2.1 |
| **Part 3 · The detail sheet** | | |
| 3.1 | Slots | 1.3 |
| 3.2 | Invented details at build time | 3.1 |
| 3.3 | The slot check | 3.1 |
| 3.4 | "Never" facts and their check | 3.1 |
| 3.5 | Voice slots in the re-anchor | 3.1 |
| **Part 4 · The bond** | | |
| 4.1 | The Bond entry and page | 1.2 |
| 4.2 | Milestones | 4.1, 2.2 |
| 4.3 | What {{char}} knows about {{user}} | 4.1 |
| **Part 5 · Time** | | |
| 5.1 | Anniversaries | 1.2 |
| 5.2 | Things that wear off | 2.1 |
| 5.3 | Facts as of any message | 1.3 |
| **Part 6 · Smarter firing** | | |
| 6.1 | Tiers | 1.2 |
| 6.2 | "Remember when…" | 1.2 |
| 6.3 | Budget by need, and why it fired | 6.1 |
| **Part 7 · Upkeep** | | |
| 7.1 | Coverage findings | 1.1 |
| 7.2 | Merge across books | 1.1 |
| 7.3 | Compaction with history | 1.1 |
| **Part 8 · Across chats, and the quiz** | | |
| 8.1 | Make it canon / Only in this chat | 1.1 |
| 8.2 | Persona lore | 2.3 |
| 8.3 | The continuity quiz | 3.1 |
| 8.4 | The golden test | 2.3, 3.3 |

---

## Part 1 · Facts on entries

The foundation. Nothing proposes anything yet; this part makes facts exist, show, fire and survive branches.

### 1.1 Facts table and branch-safe reads

**What you get:** nothing visible yet. Facts can be stored and read back as of any message, on the current branch.

**How it's built**
- **Migration 26:** `lore_facts` table.
  - `id`, `entry_id`, `chat_id` (null for a canon fact)
  - `slot` (null for free text), `value`, `kind`: `attribute | never | state | event | habit | voice | bond`
  - `since_seq`, `until_seq`, `since_time`, `until_time` (story clock)
  - `message_id`, `swipe_idx`, `origin`: `card | you | story | tracker | invented`
  - `locked`, `status`: `active | superseded | disputed | invented`, `superseded_by`
  - `known_by` (JSON, for secret facts), `created_at`, `updated_at`, `deleted_at`
  - Indexed by `(entry_id, chat_id)` and `message_id`.
- `lore/facts.ts`: create, update, retire, supersede, and `factsNow(entryId, chatId, seq)`. `factsNow` drops facts whose message or swipe isn't on the current path, using the same check as tracker-origin atoms, so the two never disagree.
- Undo through `services/undo.ts`. Routes under `routes/lore.ts`.

**Done when:** a fact made from message 40 is returned at message 41; swiping message 40 hides it; swiping back restores it; deleting the message drops it. Tests cover all four.

### 1.2 Facts in the prompt

**What you get:** an entry that fires carries a `Now:` block of its active facts after its core.

**How it's built:** `lore/activate.ts` appends `factsNow` for each fired entry. Secret facts go through `withSecrets` with their keepers. The Inspector's lore section lists the facts it sent.

**Done when:** a fired entry's prompt text includes its facts; a superseded fact is left out; a secret fact names its keepers.

### 1.3 Facts in the editor and the Codex

**What you get:** under any entry's text, a short list of facts. Each says what it is, since when, where it came from (the card, you, or a message you can click), and whether it's locked.

**Buttons**
- Lorebook editor › an entry › **Facts**: **Add a fact** (free text for now; slots come in 3.1), the lock toggle, **Source** (jumps to the message), **Retire** (sets *until* to now, keeps it in History).
- Codex › an entity with an entry › its facts in this chat, with a **Now / History** toggle.

**How it's built:** `FactsList.svelte` under `web/src/components/lore/`, used by `LorebookEditor.svelte` and `codex/EntityPage.svelte`.

**Done when:** adding, locking and retiring a fact works from both places, with Undo.

### 1.4 Remember as a fact

**What you get:** select text in a reply and press **Remember as a fact**. It picks the entry from the entities in the selection and pre-fills the fact, with the message as its source.

**How it's built:** a new selection-menu action next to the existing asides (`accuracy/asides.ts`). Meus kind `lore_fact` (add, change, retire).

**Done when:** selecting "the scar on her left hand" offers Wren's entry with the fact pre-filled; Meus can add the same fact from a sentence.

---

## Part 2 · Entries that keep up

When the story changes something an entry describes, a card in the Inbox shows the change as a diff on the entry's facts: *Lives in: Riverrun → the inn at Saltpans*, with the message it came from. **Apply**, **Edit**, or **Not this**.

Across all four steps:
- It covers **every linked book**: the companion book, the world book and the Chronicle, not just entities with no entry.
- **Supersede, don't pile up.** A new value for a slot retires the old one (kept in History), so the entry never says two things.
- **Story facts belong to the chat.** A change made in one chat stays a story fact (with its `chat_id`) even when the entry lives in the companion book, so the book stays clean for your next chat. 8.1 lets you promote one.

### 2.1 Proposals from tracker changes

**What you get:** moves, injuries, belongings changing hands and people gone become update cards, with no model call.

**How it's built**
- `lore/keepup.ts`, a job after scene records next to `runChronicle`. For each entity in the scene that has an entry, tracker changes since the entry's last check (location, condition, belongings, status *gone*) map to fact operations.
- A `lore_keepup` cursor per entry and chat (the last `seq` checked), so nothing is read twice.
- Proposals reuse `chronicle_proposals` with a new `kind` column (`new | update`) and a JSON diff (migration in this step). An Inbox provider shows them. One card per entry per scene, with the changes batched.
- Meus kind `lore_update` (apply or reject a proposal).

**Done when:** a tracker move proposes a location change; applying it supersedes the old fact; a rejected proposal is never asked again for the same change.

### 2.2 Proposals from memories

**What you get:** changes that only the story text shows (a new nickname, a confession, a habit) become cards too.

**How it's built:** in `keepup.ts`, new and superseding atoms about the entity since the last check, plus the entry's *now* facts, go into one `callJson` that returns `add / supersede / retire` operations. Each operation must cite an atom, and anything uncited is dropped. The step is routed and skipped under `shouldShed`.

**Done when:** an atom "Wren now goes by Wrennie at the inn" proposes a nickname fact citing it; an operation with no citation is dropped (tested with a stub model).

### 2.3 Trust levels, locks and re-checks

**What you get**
- **Three trust levels per book:** *Ask me* (default for the companion book), *Apply tracker facts, ask the rest*, *Apply all*. Applied changes show an Undo chip under the reply that caused them.
- **Locked facts** get a "the story contradicts this" card instead of a change, with **Keep mine** or **Update it**.
- When a fact's source message is edited, the fact is marked for a re-check.

**How it's built:** a `keepup` setting in `LorebookSettings`; a picker in the lorebook's settings; change chips through `ChangeChips.svelte`. Re-checks compare the message's `basis` fingerprint.

**Done when:** the middle level applies a tracker move with an Undo chip and still asks about a memory change; a locked fact gets a contradiction card; editing the source message marks its fact.

### 2.4 Rewrite the core

**What you get:** when the core itself now reads wrong (it still says "lives in Riverrun" in prose), the card says so and offers **Rewrite the core**. You see a diff and press **Keep**, **Edit** or **Not now**.

**How it's built:** a check in `keepup.ts` for core sentences that contradict superseded facts (rules on the old value's words), plus a reviewed rewrite through the existing Studio diff view.

**Done when:** a core sentence that names an old value is flagged, and a rewrite is only saved after you keep it.

---

## Part 3 · The detail sheet

Each entry type gets slots for the small things that slip. They're filled from the card at build time and from the story later, and the checker holds replies to them.

### 3.1 Slots

**What you get:** **Add a fact** offers the slots for the entry's type, and a slot holds one value at a time.

| Type | Slots |
|---|---|
| Character | eyes, hair, height, build, skin, scars and marks (with side), handedness, voice, age, birthday, clothing habits, likes, dislikes, fears, habits, **never** (can't / doesn't / has never) |
| Voice (on the character) | pet names for {{user}}, catchphrases, swearing, how they greet and say goodbye, words they'd never use |
| Location | layout, rooms (read from E2), notable objects and where they sit, who lives there, sounds and smells, the routine there |
| Item | look, where it is, who holds it (from E2), what it can and can't do, where it came from |
| Group | leader, colours, rules, enemies |

**How it's built:** `lore/slots.ts` holds the slot definitions, a type → slots map, and a value normaliser (colours, sides, heights) that the checks reuse. The facts list gets a slot picker.

**Done when:** a character entry offers its slots; a second value for *eyes* supersedes the first; the normaliser maps "steel-grey" and "gray" to the same colour.

### 3.2 Invented details at build time

**What you get:** when the companion book is built, the Lore Studio drafts the slots the card leaves open, marked *invented*. You confirm, edit or clear them in one card with **Keep all**. That way the model doesn't invent a different childhood home in every chat. Unconfirmed invented facts are sent as "likely", not as fact.

**How it's built:** a `details` stage in the studio's companion plan; an Inbox card for unconfirmed ones; the "likely" wording in 1.2's `Now:` block. Meus kind `lore_detail` (confirm, edit, clear).

**Done when:** a sparse card's book build proposes invented slots; confirming one sends it as fact; an unconfirmed one is sent as "likely".

### 3.3 The slot check

**What you get:** a reply that gives grey eyes brown, or puts the scar on the wrong hand, is flagged, with the fact as the citation. **Accept and update** on the flag supersedes the fact (with the message as source), so the fix and the lore stay one action.

**How it's built:** `accuracy/loreslots.ts`, registered as `lore-slot` in `slips.ts`. It compares colour words, left/right, numbers and names in the reply with the slots of the people and things in the scene. This generalises the eye and hair rule in `checker.ts`, which then reads slots too.

**Done when:** the brown-eyes reply is flagged; accepting it updates the slot; the check can be switched off in Chat › Guards.

### 3.4 "Never" facts and their check

**What you get:** *never* facts are sent as plain statements ("Wren can't swim. Wren has never met Arya.") so the model doesn't fill gaps with the opposite. A reply that breaks one is flagged. **That's never true** in the selection menu files one straight from a reply.

**How it's built:** `lore-never` in the slip registry: simple verb rules ("swims", "met Arya") against *never* facts, with an optional model read. The selection action reuses 1.4.

**Done when:** a reply where Wren swims is flagged with the fact; the selection action creates a *never* fact.

### 3.5 Voice slots in the re-anchor

**What you get:** pet names, catchphrases and goodbyes feed the re-anchor block, so long chats keep the voice. A drift alert points at the voice slot it's furthest from.

**How it's built:** `accuracy/anchor.ts` reads voice slots, and `accuracy/drift.ts` names the slot in its alert.

**Done when:** the re-anchor includes the voice slots; a drift alert names one.

---

## Part 4 · The bond

For companion chats (CHAT-25), where the relationship itself is the story.

### 4.1 The Bond entry and page

**What you get:** a **Bond** entry for {{char}} and {{user}} in the chat's Chronicle, always on and kept short. Side dock › **Story** › **Bond** shows it as a page:
- **Where things stand:** from the tracker's bond and ladder, in a sentence.
- **What they call each other.**
- **Inside jokes:** running bits (tracker motifs) with where each began, so callbacks land.
- **Open threads:** pending promises and kept secrets between the two, linked to the ledgers.

Each line has **Edit** and **Retire**.

**How it's built:** `lore/bond.ts` builds and refreshes the entry from the trackers, motifs and ledgers. Each line is a fact of kind `bond`, so branches and Undo work like everywhere else. It's constant in companion mode, with a small budget. Meus kind `bond`.

**Done when:** a new companion chat's first scene creates the Bond; a running bit shows with its source message; swiping the scene removes what it added.

### 4.2 Milestones

**What you get:** first meeting, first fight, first confession and the like, each with its story date and message, under **Milestones** on the Bond page. **Mark as a milestone** in the message ⋯ menu adds one yourself.

**How it's built:** milestones are `event` facts. 2.2's job proposes one when an important atom is about the pair. A new message action is added.

**Done when:** a confession scene proposes a milestone; the menu action adds one with the right date.

### 4.3 What {{char}} knows about {{user}}

**What you get:** a **Knows about you** section: persona facts revealed in this chat, so {{char}} remembers what they were told and nothing they weren't. A **Persona facts** toggle in Chat › Memory, on by default in companion mode.

**How it's built:** persona-related atoms filtered by `known_by` (MEM-16) become `bond` facts on the Bond entry.

**Done when:** a persona secret told to {{char}} shows under "knows"; one never told stays out.

---

## Part 5 · Time

### 5.1 Anniversaries

**What you get:** event facts with story dates fire on the date again ("a year since the wedding", "her name day"), named by the chat's calendar. This includes birthdays from the detail sheet.

**How it's built:** a date trigger in `lore/activate.ts`, using `trackers/calendars.ts` for names.

**Done when:** a birthday fires on the day in a test clock and not the day before.

### 5.2 Things that wear off

**What you get:** a state fact can carry a duration ("arm in a sling, about six weeks"). When the story clock passes it, Part 2 proposes "healed?" instead of the sling lasting forever. The same goes for haircuts, a moon's mourning, a journey's length.

**How it's built:** migration 27 adds `expects_minutes` to `lore_facts`. `lore/timefacts.ts` checks after the clock moves and queues proposals through `keepup.ts`.

**Done when:** a six-week injury proposes healing after six story weeks.

### 5.3 Facts as of any message

**What you get:** Codex › entity › a timeline slider shows every fact as it was at any message.

**How it's built:** `factsNow` at a chosen `seq`, plus a slider on the entity page.

**Done when:** moving the slider before a change shows the earlier value.

---

## Part 6 · Smarter firing

### 6.1 Tiers

**What you get:** the right amount of lore for the moment. Present but not the focus: essentials plus *now* facts. The focus of the scene (named in your message, speaking, or the place you're in): the full entry. Off scene: nothing, unless recalled. **Lore tiers** in Settings › Memory, on by default for Deep.

**How it's built:** tier selection after the scan in `lore/activate.ts`; the focus comes from the scene tracker and the entities in the user message.

**Done when:** a character in the room but silent costs only their essentials; naming them sends the full entry.

### 6.2 "Remember when…"

**What you get:** when your message reaches back ("remember the night at the mill?"), the lore and facts of that past scene come with the reply, even with no keyword match.

**How it's built:** `lore/recallhook.ts`: rules for the cue first, then a search over event facts and entries with the same embeddings as recall (`memory/embed.ts`).

**Done when:** a "remember when" message pulls an event fact that no keyword matched.

### 6.3 Budget by need, and why it fired

**What you get:** when lore runs over its budget, entries are cut by relevance × time since they last fired, not by order alone. The Inspector's `[LORE]` lane groups entries by tier and gives each its reason (in the scene, focus, recalled, sticky, date, constant), plus the cut list.

**How it's built:** the existing scoring at `activate.ts:349` gains the time-since-fired term; the lane shows reasons and cuts.

**Done when:** over budget, a long-unfired entry is cut before a fresh one of the same score; the Inspector lists both with reasons.

---

## Part 7 · Upkeep

### 7.1 Coverage findings

**What you get:** lore health also lists:
- busy entities with thin entries
- entries whose entity is active but that haven't fired in N messages
- facts that conflict across books (companion vs world vs Chronicle)
- the same alias in two books
- invented facts still unconfirmed

Each finding has a fix button (**Draft facts**, **Add key**, **Confirm**).

**How it's built:** `loreHealth` takes a chat (to see activity), and a cross-book scan runs over `scanEntriesFor`. Inbox provider `lore-health`.

**Done when:** each finding appears in a test fixture and its button fixes it.

### 7.2 Merge across books

**What you get:** two entries for one entity merge into the book you choose, facts and history included, with Undo. The conflict and alias findings from 7.1 offer **Merge**.

**How it's built:** `mergeEntries` in `lore/service.ts` moves facts (keeping provenance) and joins keys and aliases.

**Done when:** a merge keeps every fact and is undone cleanly.

### 7.3 Compaction with history

**What you get:** books that stay readable at message 5,000. An idle job rewrites a long core into a shorter one. Names and numbers stay exact, the facts are untouched, and superseded facts move into a collapsed **History** section. Anything you wrote is offered as a diff; Mea-written cores just get an Undo chip.

**How it's built:** `lore/compact.ts`, scheduled by `memory/scheduler.ts` beside consolidation, respecting `shouldShed`. The names-and-numbers check rejects a rewrite that drops one.

**Done when:** a 1,500-token core compacts with every name and number kept; a rewrite that drops a number is rejected.

---

## Part 8 · Across chats, and the quiz

### 8.1 Make it canon / Only in this chat

**What you get:** on any story fact, **Make it canon** moves it to the companion book for every future chat (or to the world book, for world facts). On a canon fact, **Only in this chat** makes a chat-local override.

**How it's built:** promotion sets `chat_id` to null and moves the fact's `entry_id`, keeping its source message as provenance. Overrides use a `(entry_id, slot, chat_id)` precedence in `factsNow`.

**Done when:** a promoted fact shows in a new chat; an override wins in its chat only.

### 8.2 Persona lore

**What you get:** the same facts, keep-up cards and trust levels for persona lorebooks (PER-03), so your character stays consistent too.

**How it's built:** `keepup.ts` and the facts list accept persona-linked books; persona slots reuse the character slots.

**Done when:** a tracker change to your persona proposes an update on its book.

### 8.3 The continuity quiz

**What you get:** the memory quiz (MEM-46) gets questions from slots and facts, with exact answers ("What colour are Wren's eyes?" → *grey*). Run it after switching models or presets to see if continuity got worse. Scores sit next to the current quiz scores, with the settings they ran on.

**How it's built:** `makeQuestions` in `accuracy/quiz.ts` gets a facts source; grading uses the slot normaliser from 3.1.

**Done when:** the quiz reports a slot score, and "gray" is graded right for *grey*.

### 8.4 The golden test

**What you get:** a long fixture chat with known facts at known messages, run against activation, keep-up and the checks. It catches regressions in CI, not just in your chats.

**How it's built:** `server/test/livinglore.test.ts` with a fixture that swipes, edits and forks.

**Done when:** it runs in `bun run test` and fails if a branch leaks a fact.

---

## Build order

One PR per part, in this order:

| PR | Part | Steps in it |
|---|---|---|
| 1 | Part 1 · Facts on entries | 1.1 → 1.2 → 1.3 → 1.4 |
| 2 | Part 2 · Entries that keep up | 2.1 → 2.3 → 2.2 → 2.4 |
| 3 | Part 3 · The detail sheet | 3.1 → 3.3 → 3.4 → 3.2 → 3.5 |
| 4 | Part 6 · Smarter firing | 6.1 → 6.3 → 6.2 |
| 5 | Part 4 · The bond | 4.1 → 4.3 → 4.2 |
| 6 | Part 5 · Time | 5.1 → 5.2 → 5.3 |
| 7 | Part 7 · Upkeep | 7.1 → 7.2 → 7.3 |
| 8 | Part 8 · Across chats, and the quiz | 8.1 → 8.2 → 8.3 → 8.4 |

Every step's **Needs** is in its own part or an earlier PR. Part 6 moves up because tiers keep the token cost of Parts 4 and 5 down.

## Risks and how they're handled

| Risk | Handling |
|---|---|
| Too many cards | Rules-only proposals first (2.1), the trust levels (2.3), one card per entry per scene, and **Not this** remembered per change |
| Wrong facts from the model | Every model operation must cite an atom; uncited ones are dropped. Story facts never override locked or canon facts without a card |
| Branch bugs | Facts use the same path check as tracker atoms (1.1), and the golden test (8.4) swipes, edits and forks |
| Token cost | Tiers (6.1), essentials for the bond, and *now* facts only; History is never sent |
| Thousands of facts | Indexed by entry and chat; `factsNow` is one query per scan, cached per message |
| Invented details passing as canon | Sent as "likely" until confirmed (3.2), and listed in lore health (7.1) |

## What you'll do

1. Build or rebuild a companion lorebook, and confirm or clear the invented details.
2. Pick a trust level for the companion book (*Ask me* is the default).
3. Play. Answer update cards in the Inbox when they come, or let the plain ones apply.
4. Now and then, open lore health and press the fix buttons.
5. After changing models, run the continuity quiz.
