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
| 5 | Kinds the story machinery reads (timeline boundary, sim-readable kinds, shared moments) | branch `claude/lore-kinds-writing-s57q65` |
| 6 | Review by kind (per-kind checks, kind-aware critique, review by shelf) | todo |
| 7 | Cards and personas (companion/persona books, depth answers' kinds, entry ↔ card) | todo; needs 4 |

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

## Things worth knowing

- In the cloud container, 3 timing tests in `server/test/review.test.ts` fail in the full suite (they pass alone, and pass in CI). Not caused by lore work.
- The mock writer (`providers/mock.ts`, `studio_entry`) cuts a title at its first colon, so "Voice: Mira" parts read "greeting of Voice".
- Desktop leftovers (`.claude/launch.json`, `desktop/src-tauri/permissions/`, `mockups/mea-rooms-*.html`) went into main with PR #126, in their own commit.
