# MEMORY

Running notes between sessions: what's been done, what's next, and things worth knowing.

## Lore Studio kinds (design: `docs/17-lore-studio-kinds.md`)

One PR per part. Build the next part while CI runs; merge only when green.

| Part | What | State |
|---|---|---|
| 1 | Kind registry (28 kinds, five shelves, grouped picker) | merged, PR #123 |
| 2 | Planning by kind (recipes, mix, satellites, Pack, shelf board) | merged, PR #124 |
| 3 | Writing by kind (`lore/shapes.ts`: briefs, parts, kept secrets, firing by kind) | merged, PR #125 |
| 4 | Voices that hold | merged, PR #126 |
| 5 | Kinds the story machinery reads (timeline boundary, sim-readable kinds, shared moments) | merged, PR #127 |
| 6 | Review by kind (per-kind checks, kind-aware critique, review by shelf) | merged, PR #128 |
| 7 | Cards and personas (companion/persona books, depth answers' kinds, entry ↔ card) | branch `claude/lore-kinds-writing-s57q65` |

### Part 4 (2026-10-20)

- `shapes.ts`: `voiceProblems` (under three sample lines, or lines that only describe), `onlyAdjectives`, `voiceSlotValues` (parts → voice slots; "swearing: none" → "doesn't swear").
- `studio.ts` `commitDraft`: a Voice's slots become facts with the new origin `"studio"`; a Voice with no subject gets `extra.entity` from its title (`voiceOwner`); every Character entry saved queues `lore.details` with `{ bookId, entryId }` (the card's own character keeps the old card job).
- `details.ts`: drafts from a card or a studio entry; skips slots another of the person's entries already holds; Inbox groups drafted details into one card per book (`lore-details:<bookId>`, lines "Name · Slot: value"). Keeping an unedited line no longer saves the "[likely, not confirmed]" tag into the value.
- Tests: `server/test/lorevoice.test.ts`.

### Part 5 (2026-10-20)

- 5.1: `planOutline` adds "Timeline: where the story stands" when the book is based on an existing work (`wantsTimeline`: basedOn, and an empty mix or one with timeline). `kindGaps`/`planGaps` share `timelineItem`.
- 5.2: `sim/roster.ts` `routinesFrom` reads Routine schedule lines ("6–9: Tam Reed, at the quay", "noon — Tam — the Anchor", "18:00-21:00: Tam, home"); `buildRoster({ schedules })` gives people routines and places offstage ones by the clock. `sim/service.ts`: `loreSchedules`, `climateEntry` (a Climate entry beats the guessed climate), Hook entries go to `loreSituations` with `hook: true` and `tick` offers them as proposals (ground `hook:<title>`), never arcs.
- 5.3: subjects can be `card:<id>` (the companion book's card). `companionMoments` plans Shared moments from the card's scenario / first message / examples (only stated ones when faithful), with `cues` (trigger words, never a name) that the writer keeps as keys. A shared moment never keys on its people's names (`withFiring`).
- Tests: `server/test/lorestory.test.ts`.

### Part 6 (2026-10-20)

- 6.1: `quality.ts` `checkKinds` (issue kind `"kind"`, which replaced Part 4's `"voice"`): voice (3+ sample lines, no describing lines, no "never says" word used), current (present tense, ≤1 clause of backstory, who/where), upcoming (future, not already in History), relationship (names both, where it stands now), reaction (trigger, not keyed on the person), hidden-truth kinds (truth kept in secrets), mystery (3+ clues, a red herring unless lean), lexicon/money (5+, terms keyed), routine (3+ times, people known), timeline ("not yet" when based on canon), satellites (subject still exists). `reviewDraft` runs it and returns `shelves` (tokens and always-on by shelf; the overview counts as ground).
- 6.2: the critique sees each entry's kind and the plan's gaps; an "add" carries `kind` and `about` (item ids); "split" can split out a satellite. `applyCritique` treats a satellite as a duplicate only of one like it.
- 6.3: `StudioReview.svelte` groups by shelf with each shelf's cost; `StudioItemCard.svelte` shows the kind's parts above the text (sample lines as quotes, the truth marked "kept secret").
- Tests: `server/test/lorereview.test.ts`.

### Part 7 (2026-10-20)

- 7.1: a draft from a card starts with the Companion recipe, from a persona with the new Persona recipe (`mix.ts` `DEFAULT_RECIPE`, set in `createDraft` when no mix/types/recipe is given). `planOutline` adds the card as a virtual person (`card:<id>`) to the satellite pass (no voice or moment; moments come from `companionMoments`), and links outline-planned satellites titled for the card to it. The card's details job gets the draft's source text (the bible) as `extra`, so the card's/bible's pet names and catchphrases become voice facts on the details entry.
- 7.2: `ownerBlock` / `dropBlocked` (studio.ts): never the card's or persona's own Character or Voice entry; with the persona as subject (`about` only "user", or the first name in the title after the label is theirs), no Voice, Reaction, Belief or Secret (`PERSONA_BLOCKED`). Applied to the outline, the satellite pass, Pack and gaps; what's dropped goes to `draft.planNotes`, shown under the shelf board.
- 7.3: `composeOne` and "Draft from the bible" ask for a `kind` (`DEPTH_KINDS`: history, reaction, belief, secret, moment, relationship) and a secret's `truth`; `writeDepthBook(bookId, items, owner)` tags the kind (`withCategory`, no defaults: depth firing stays), keeps a secret's truth in `secrets` with the owner, keys a reaction on its topic, and never saves Current. `CreatorDepth.svelte` has a kind picker (and the secret's truth field).
- 7.4: `createCreatorDraft({ fromLore })` seeds the bible from the person's satellites (`seedBible`: Voice → voice section with sample lines, Relationships → relationships, Reactions → "if this, then that" (`tensions`)). On save, `promotedToCard` re-points satellites to `card:<id>` and blanks the Voice entry's text (kept in `extra.retiredText`; the entry stays on so its facts still reach the re-anchor). A Voice planned about a `card:` subject saves with no text.
- 7.5: `worldContext` orders by shelf (`shelfRank`: ground truth and always-on entries, Current, Lexicon, Customs, then people, world, time, scenes) and leaves out satellites.
- Tests: `server/test/lorecards.test.ts`.

## NanoGPT slow only in Mea (2026-10-21, merged, PR #135)

- Symptom: "Couldn't load models: HTTP 503", every time, and slow replies on NanoGPT.
- Cause: `NanoGPTProvider.listModels` needed both `/api/subscription/v1/models` and `/api/v1/models`; the subscription list answering 503 failed the whole sync (pay-as-you-go too). Without a catalog `applyReasoning` sees no reasoning caps, so it stops sending `reasoning_effort: "none"`: reasoning models (GLM, Kimi, DeepSeek) think at full default effort before every reply and every helper call.
- Fix (`providers/nanogpt.ts`): both lists are fetched in parallel and either may fail; catalog GETs retry once on 5xx or a dropped connection, with a 30 s timeout. Subscription flags come from the subscription list, or else from the catalog's own `subscription.included`. A subscription-only key with neither still fails, so it's never shown paid models. Tests: `server/test/providers.test.ts`.
- Ruled out by measuring against a fake NanoGPT: Mea's prep adds ~0.1 s; the story request doesn't wait on helpers; ~80% of the prompt is a stable prefix (cache-friendly); Bun streams gzip/brotli SSE fine.
- Still Mea-specific costs, by design: the mandatory planning pass (up to 400 words before the story), and a model that keeps skipping it costs 2–3 full-prompt requests per reply (plan step + write; `skipsPlans`). Helper calls after each reply share the NanoGPT key.
- Follow-up (PR #136): with `nano-gpt.com/api/v1` models loaded but all showed pay-as-you-go: the subscription list still failed and the catalog had no `subscription.included`, so #135 marked every model unincluded, silently. Now the provider leaves `subscription` undefined when it can't tell, `syncModels` keeps each model's saved flag (`CASE WHEN ? IS NULL`), and the connection shows `subscriptionProblem` as its lastError. Why the subscription list fails on both hosts is still unknown: needs the user's curl output.
- Not checked: the cloud container can't reach api.nano-gpt.com, so which NanoGPT endpoint really returns 503 wasn't confirmed live.

## Things worth knowing

- In the cloud container, 3 timing tests in `server/test/review.test.ts` fail in the full suite (they pass alone, and pass in CI). Not caused by lore work.
- The mock writer (`providers/mock.ts`, `studio_entry`) cuts a title at its first colon, so "Voice: Mira" parts read "greeting of Voice".
- Desktop leftovers (`.claude/launch.json`, `desktop/src-tauri/permissions/`, `mockups/mea-rooms-*.html`) went into main with PR #126, in their own commit.
