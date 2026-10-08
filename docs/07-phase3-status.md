# Phase 3 status

> Phase 3 goal: precise recall of old details, no knowledge leaks, contradictions caught.
> IDs refer to [02-mea-ideas.md](02-mea-ideas.md).

## Verified

- **Server tests:** 158 pass (`bun run test`). There are 45 new tests in five files:
  - `retrieval.test.ts`:
    - queries, point-of-view filtering, diversity, entity recall, mood, reinforcement, the librarian
    - deep search, story time, entities and merges, ledgers, corrections, reconcile
    - journals, sleep, profiles, and duplicate memories
  - `accuracy.test.ts`: continuity rules, leaks (tracker, memory and lore secrets), stored flags, accept/regenerate/dismiss, the Archivist, the Codex, the quiz
  - `lore3.test.ts`: aliases, entity and semantic activation, parents, secrets, priority budget, health check, vectors, templates, assist, preview, glossary, Chronicle
  - `library3.test.ts`: auto titles, collections, stats, global search, and a smoke call to every new endpoint
  - `trackers.test.ts`: a regression test for `dead` lines (see Fixes)
- **Type checks:** `tsc` (server) and `svelte-check` (web) report 0 errors and 0 warnings.
- **Bundle budget:** first load is 195 KB JS + 18 KB CSS gzipped (budgets: 250 KB / 60 KB).
- **Clicked through in a browser** with the mock provider, at desktop 1280×860 and phone 390×844:
  - **Setup:** a seeded chat with lore, trackers, built memory, a planted continuity slip, an Archivist question and a quiz run.
  - **What was tested:**
    - chat with continuity notes, glossary popover, the selection bar, and the Ask tab
    - Codex tabs and an entity page
    - Settings → Memory
    - the lore editor with its health check
    - Home with Stories
    - search across everything
  - **What happened:** after the fixes below, there were no console or page errors and no sideways scrolling.

## Fixes found while verifying

- **`dead Name — cause`** (the ledger grammar's own form) was rejected by the tracker fold. This was a Phase 2 bug.
- **Duplicate memories:** one scene record could store the same memory several times. Duplicate detection skipped atoms from the same scene. This was a Phase 1 gap.
- **Edits on the newest reply:** the continuity checker ignored tracker edits anchored to the reply being checked (a trait or secret you set "now"). It now checks against canon: the state before the reply, plus your and the card's traits, deaths, people and secrets.
- **Ranking:** relevance was too flat (rank fusion with k=60). Small importance bonuses could outrank the best matches; it now uses k=12 within each list.
- **Deep-search quotes** never fit a small model's recall budget. They now get a share of the budget, and the best one is shortened to fit.
- **`/ask`** lost the recent messages and story state when it moved to the Archivist. They are sources again.
- **Phone layout:** the continuity note and the lore editor overflowed on phones.

## Delivered, by roadmap ID

| Area | IDs |
|---|---|
| Retrieval | MEM-14 (several weighted queries: your draft, newest lines, scene cast, a helper-rewritten query), MEM-15 (diversity through maximal marginal relevance), MEM-16 (point-of-view filter before ranking; follows the chat mode), MEM-17 (entity cards and top facts for who's in the scene or just named), MEM-18 (importance, emotion, mood match), MEM-19 (recalled vs used counts; used memories rise, unused trivia fades, core never), MEM-20/21 (warm on open and while typing; short embedding deadline with keyword fallback; index readiness in the receipt), MEM-22 (chapter → scene → quoted message, with direct fallback), MEM-23 (librarian during prefetch, cached by conversation), MEM-36 (every memory labeled "3 days ago, at the harbor" from the story clock), MEM-37 (prose / attributed / clinical / minimal), MEM-38 (every budget is a share of the model's context) |
| Knowledge | MEM-26 (entity graph from trackers, memories, scene records and lore; bonds over time), MEM-27 (your edits are locked everywhere), MEM-28 (aliases, one-click merge and unmerge, duplicate suggestions), MEM-29 (first-person journals, condensed after scenes, proposals when you edited them), MEM-30/31 (promise and secret ledgers you can mark, reaching trackers and memory), MEM-41 (select text → Remember / Pin / That's wrong), MEM-42 (sleep: merge duplicates, fold trivia, refresh descriptions, join names), MEM-44 (Light / Balanced / Deep), MEM-46 (memory quiz: retrieval and answer scores, kept with the settings used) |
| Accuracy | CON-01 (canon order rule; every memory block labeled with its authority), CON-02 (continuity checker after each reply: rules plus a cited helper pass; accept and update canon, regenerate with fix, dismiss), CON-06 (leak guard for tracker, memory and lore secrets), CON-07 (the Archivist, with citations and jump links, pushable as a note or a pinned memory), CON-08 (the Codex), SUM-22 (records get the tracker's time span; "Time passing" added when days passed; time and place conflicts flagged) |
| Lore | LORE-05 (fires on meaning, per entry or per book; vectors by content hash), LORE-06 (fires when its entity is in the scene or named), LORE-07 (tracker conditions, from Phase 2), LORE-08 (live preview while typing), LORE-09 (types with templates, aliases, secrets with known-by), LORE-10 (folders, parents bring essentials), LORE-11 (draft / keys / condense / tidy, shown before and after), LORE-12 (Chronicle book per chat, proposals for review), LORE-13 (health check with cost report), LORE-14 (priority budget; trims to essentials before dropping), LORE-15 (glossary underlines with a popover) |
| Library | LIB-04 (auto titles from the Story So Far until you rename; covers), LIB-05 (search across messages, characters, lore, memories and summaries), LIB-06 (collections: Ongoing, Finished, Favorites, your own), LIB-07 (stats per chat and overall) |

## Where to find things

- **In a chat:**
  - continuity notes under replies
  - select any text to remember, pin or correct it
  - underlined lore terms
  - the **Ask** dock tab (Archivist)
  - the Codex button in the header
  - the lore preview above the composer
- **Codex** (`/chat/<id>/codex`):
  - people, places, things, timeline, threads
  - promises & secrets, journals
  - Chronicle (review proposals)
  - Checks: quiz, sleep, records vs the clock, likely duplicates
  - entity pages for editing and merging
- **Receipt (ⓘ on a reply):** queries used, point of view, librarian, quotes, index readiness, when and where for each memory.
- **Settings:**
  - **Memory:** profiles, plus recall and accuracy switches
  - **Appearance:** the glossary toggle
- **Lorebook editor:**
  - **Per entry:** type and templates, aliases, essentials, parent/folder, secrets, meaning and entity links, AI assist.
  - **Per book:** "fires on meaning" (under scanning settings), and the health check at the bottom.
- **Home:** Stories with collections and stats. **Search:** "Everything".

## Build notes

- **Server, memory** (`server/src/memory/`):
  - `recall.ts`, `deep.ts`, `format.ts`, `librarian.ts`, `warm.ts`, `reinforce.ts`
  - `entities.ts`, `journals.ts`, `ledgers.ts`, `remember.ts`
  - `consolidate.ts`, `profiles.ts`, `reconcile.ts`, `canon.ts`
  - `context.ts` now builds the per-turn inputs and the journal block
- **Server, accuracy** (`server/src/accuracy/`): `checker.ts`, `archivist.ts`, `codex.ts`, `quiz.ts`.
- **Server, lore:** `activate.ts` gains aliases, entity and semantic activation, parents, secrets and priority eviction. New: `semantic.ts`, `health.ts`, `chronicle.ts`, `assist.ts`.
- **Server, library:** `services/stories.ts`.
- **Routes:** `routes/knowledge.ts`, `accuracy.ts`, `stories.ts`, plus additions to `lore.ts`.
- **Jobs:** `memory.journal`, `memory.consolidate`, `lore.chronicle`, `lore.embed`, `accuracy.check`.
- **Migration 4** adds:
  - reinforcement and ledger columns on memories
  - `entities`, `journals`, `continuity_flags`, `archivist`, `quiz_runs`
  - `lore_hits`, `chronicle_proposals`, `collections`, `collection_chats`
  - `chats.title_locked`, `chats.cover_image_id`
  - an external-content FTS5 index over swipes
- **Web:**
  - `views/CodexView.svelte`, `components/codex/EntityPage.svelte`, `components/library/Stories.svelte`
  - `components/chat/ArchivistPanel.svelte`, `ContinuityNote.svelte`, `SelectionMenu.svelte`
  - `lib/glossary.ts`
  - updates to Composer, MessageItem, Inspector, ChatPanel, MemoryPanel, EntryEditor, LorebookEditor, SearchView, Settings → Memory and Appearance

## Deviations (deliberate)

- **Lore fields live in `extra`:** type, aliases, secrets, parent, folder, essentials, semantic and entity. SillyTavern imports and exports carry them unchanged.
- **The librarian and the rewritten query are keyed by the conversation, not the draft.** Typing refreshes them at most every 6 seconds, and a send uses whatever is ready (never waits).
- **Corrections supersede; they never delete.** "That's wrong" keeps the old memories in history.
- **The checker's helper pass drops issues without a citation.** An unsourced "contradiction" is a guess.

## Not verified yet (needs your real setup)

- **Quality with real models:** librarian picks, rewritten queries, journals, Chronicle drafts, checker issues, Archivist answers. All were checked against the mock only. Check the cost of `helper` and `summarizer` calls in Settings → Usage, and use the Light or Balanced profile if they cost too much.
- **Semantic lore and recall with real embeddings**, at `text-embedding-3-large` sizes.
- **Tuning:** the similarity threshold for meaning-based lore (0.45) and the diversity default (30%) may need adjusting. Run the memory quiz before and after.
- **Phone gestures:** text selection on a real phone (the selection bar) was tested with a mouse.

## Next: Phase 4 (creator studio)

CHAR-06…18, PER-03…07, PROMPT-06…10.
