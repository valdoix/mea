# Phase 2 status

> Phase 2 goal: living state you can see, plus richer steering.
> IDs refer to [02-mea-ideas.md](02-mea-ideas.md). The trackers learn from [valdoix/almanac](https://github.com/valdoix/almanac) (ledger grammar, rules, Elsewhere) and go further: event-sourced history, clock-driven drift, custom templates, and a world simulation with a subplot grammar and a drama director.

## Verified

- **Server tests:** 113 pass (`bun run test`). There are 43 new tests in four files:
  - `trackers.test.ts`: the ledger DSL, the fold, drift and the rules
  - `trackerflow.test.ts`: helper and inline modes, swipes, edits and deletes, timeskip, and tracker conditions
  - `world.test.ts`: the subplot grammar, the roster, the storyteller, news, crossings, the telling validator, the director and the sky
  - `tools.test.ts`: rewind, drafts, search, `/ask`, `/recap`, banned phrases, cut-off and retry

  A test in `memory.test.ts` checks that memory scenes follow the scene tracker.
- **Type checks:** `tsc` (server) and `svelte-check` (web) report 0 errors and 0 warnings.
- **Bundle budget:** first load is 171 KB JS + 16 KB CSS gzipped (budgets: 250 KB / 60 KB).
- **Clicked through in a browser** with the mock provider, at desktop 1280×860 and phone 390×844:
  - **What was tested:**
    - the chat with change chips and the HUD
    - the Story and World dock tabs
    - the Story page (timeline, relationships, cast)
    - the World page
    - the slash palette
    - search across chats
    - Settings → Trackers, Writing and Models
  - **What happened:** after the fixes below, there were no console or page errors and no sideways scrolling.
  - **Found and fixed during the click-through:**
    - a world step forced twice in one story hour rolled the same dice
    - a subplot could move "off the page" while its lead was in the scene
    - the phone composer overflowed by 30px
    - meter changes showed raw fractions
    - the timeline said "You" in its charts but the persona's name in its rows

## Delivered, by roadmap ID

| Area | IDs |
|---|---|
| Tracker engine | TRK-01 (schema templates: 11 field types, tables, a patch engine, 3 starters), TRK-02 (delta ledger lines with causes, checked line by line), TRK-03 (helper model after each reply, never blocking), TRK-04 (event-sourced, tied to message + swipe, so edits, swipes and deletes roll back), TRK-05 (edit and lock any field), TRK-06 (budgeted note in lanes, with meters sent as words), TRK-07 (change chips), TRK-08 (cadence, plus a quota-saving gate), TRK-09 (starting state from the card, reviewable), TRK-10 (code-owned clock with flashbacks), TRK-11 (change caps of ±2, or ±3 with a big cause), TRK-12 (conditions drive lore entries and guidance chips), TRK-13 (big changes become memories) |
| What's tracked | TRK-16 (scene, with place as a hierarchy and weather), TRK-17 (mood, body meters with drift, injuries and illness, outfit, drives, private thoughts), TRK-18 (bonds on several axes, plus a romance ladder with pace gates), TRK-19 (threads, promises, debts, deadlines, plants and payoffs), TRK-20 (calendar and plans), TRK-21 (your status, with your inner life sealed by default), TRK-22 (items and gifts) |
| Tracker UI | TRK-26 (Story dock tab, and a bottom sheet on the phone), TRK-27 (HUD line), TRK-28 (timeline with sparklines and "when did…"), TRK-29 (relationship web with a time scrubber), TRK-30 (spoiler blur for thoughts and hidden fields), TRK-31 (quiet threads offered back as hooks), TRK-32 (template library: duplicate, share as JSON, defaults per character) |
| Chat tools | CHAT-09 (director mode), CHAT-10 (`/ooc` standing notes vs `/cue` once), CHAT-11 (guidance chips, once or persistent, which can switch on by tracker condition), CHAT-12 (length and pace switches), CHAT-13 (story settings and truths per chat), CHAT-14 (auto-continue or trim on cut-off), CHAT-15 (slash palette), CHAT-16 (rewind, with undo), CHAT-17 (drafts sync), CHAT-18 (search in a chat and across chats), CHAT-19 (banned phrases: replace, regenerate or flag, starting from a "slop" list), CHAT-20 (real and story timestamps, plus word count) |
| Cast | CHAT-26 (cast page with standing, place and ties), CHAT-27 (NPC voice notes, sent only when that NPC is present) |
| Connections | CONN-07 (model switcher in the header with billing badges), CONN-09 (smart retry: empty reply, refusal, 5xx with backoff, then fallback), CONN-14 (cheap yes/no gate before tracker updates) |
| Beyond the plan | The world off the page (it also covers TRK-23, a P2 item): a roster of people with rings, reach and travel times; news that travels along ties; 20 kinds of subplot with stages (hook → rising → reversal → crisis → climax) on seeded 2d6; twists, endings, consequences and follow-on subplots; fates that wait on you; a drama director (steady, rising, chaotic or gentle) with a tension target; crossings where off-page events reach the scene (letters, signals, rumours, traces, entrances, omens), confirmed only when used; seeded weather, sun, moon and season. Memory scene breaks now also follow the scene tracker. |

## Where to find things

- **In a chat:**
  - **HUD line** above the composer.
  - **Chips** under each reply.
  - **Story** dock tab: every field, with edit, lock, timeskip, start over, and settings for the chat.
  - **World** dock tab: subplots, arrivals, proposals and fates.
  - **Header:** model switcher and search.
  - **Composer:** `/` opens the slash palette. The sliders button holds length, pace, guidance and cue. The clapperboard is director mode. On the phone, director mode is reached with `/director`.
  - **Message menu:** *Rewind to here*.
- **Story page** (`/chat/<id>/story`): timeline, relationship web, and the cast editor (voice notes, standing, routines).
- **World page** (`/chat/<id>/world`): how lively the world is, the director, subplot controls (hold, nudge, bring in, drop, author your own), people controls, the sky, news.
- **Chat dock → Chat tab:** story settings (genre, tone, POV, tense, intensity, language, style), length and pace, truths, standing OOC notes.
- **Settings → Trackers:** defaults for every chat, plus custom tracker templates with a field editor, import and export.
- **Settings → Writing:** guidance chips, banned phrases, cut-off handling, smart retry, and world defaults.
- **Settings → Models → Routing:** two new tasks:
  - *Trackers* uses the helper model unless you set one.
  - *The world off the page* uses the summarizer unless you set one.
- **Lorebook entry → advanced:** "Only when the story state matches" (a tracker condition).

## Build notes (file by file)

- **Server, trackers** (`server/src/trackers/`):
  - `dsl.ts`: ledger grammar
  - `fold.ts`: event fold and rules
  - `drift.ts`: needs, sleep, meals, healing, illness
  - `clock.ts`: story clock
  - `schema.ts` and `patch.ts`: custom templates
  - `note.ts`: prompt note and HUD
  - `prompts.ts`: prompts
  - `condition.ts`: tracker conditions
  - `store.ts`: events, config, cast, templates, fold cache
  - `service.ts`: jobs, inline ledgers, edits, timeskip
- **Server, world** (`server/src/sim/`):
  - `types.ts` and `fold.ts`
  - `dice.ts`: seeded dice
  - `grammar.ts`: 20 subplot kinds
  - `roster.ts`
  - `news.ts`
  - `director.ts`
  - `storyteller.ts`: tick, beats, endings, seeding, incidents
  - `crossings.ts`
  - `sky.ts`
  - `telling.ts`: prose and its validator
  - `service.ts`
  - Sim ops are stored as tracker events (op `sim`), so the world rolls back with swipes and edits.
- **Server, chat tools:**
  - `services/chattools.ts`: extras, banned phrases, cut-off trim, refusal check, guidance
  - `routes/tools.ts`: rewind, drafts, search, `/ask`, `/recap`, locate
  - `routes/trackers.ts` and `routes/world.ts`
- **Server, schema:** migration 3 adds `tracker_events`, `tracker_templates`, `cast_profiles`, `drafts`, and `characters.trackers`.
- **Server, settings:** new keys are `trackers.defaults`, `world.defaults`, `chat.guidance`, `chat.banned`, `chat.cutoff` and `chat.retry`. The routing tasks `tracker` and `world` borrow `helper` and `summarizer`.
- **Server, memory:** `memory/scheduler.ts` reads the tracker's scene changes. A new scene is a strong break. A move to another building is a weak break, confirmed by the boundary check.
- **Web, trackers and world:**
  - `components/trackers/*`: ChangeChips, Hud, TrackerPanel, TrackerSettings
  - `components/world/WorldPanel.svelte`
  - `views/StoryView.svelte`, `WorldView.svelte`, `SearchView.svelte`
- **Web, chat:** `components/chat/ModelSwitcher.svelte` and `ChatSearch.svelte`; `Composer.svelte` (slash palette, steering, director, drafts); `ChatPanel.svelte` (story settings).
- **Web, settings:** `components/settings/Trackers.svelte` and `Writing.svelte`.

## Deviations (deliberate)

- **Trackers are a world model, not only schemas.** Scene, people, bonds, knowledge, items, threads and stakes are built in, because they need rules (clock, caps, ladder, sealing) that a generic schema can't express. TRK-01 templates add anything else on top.
- **The ledger is line-based, not JSON.** Models write it more reliably, each line is checked on its own, and a bad line never sinks the rest.
- **Helper mode is the default** (maximum accuracy). Inline mode (`<ledger>` inside the reply) is one switch away and costs no extra request.
- **TRK-23 (World)** is a P2 item, delivered early as part of the world simulation.

## Not verified yet (needs your real setup)

- **Real tracker models.** Ledger quality and cost were checked with the mock only. Watch the chips and the Story tab in the first real chats. Check **Settings → Usage → Request history** for the cost of each `tracker` call, and switch on the gate if it's too much.
- **World telling** with a real model. The validator rejects prose that speaks for you or invents facts, and falls back to the engine's sentence. See how often that happens.
- **Refusal detection** is a phrase list. Tune it against real refusals.
- **Phone gestures** are still tested with mouse clicks only.

## Next: Phase 3 (retrieval, facts & accuracy)

MEM-14…23, MEM-26…31, MEM-36…38, MEM-41…42, MEM-44, MEM-46, CON-01, CON-02, CON-06…08, LORE-05…15, LIB-04…07, SUM-22. The tracker's knowledge model (who knows, believes or suspects what) is a head start on CON-06 (knowledge guard). **Built:** see [07-phase3-status.md](07-phase3-status.md).
