# Phase 1 progress (memory core) — handoff notes

> Living document: updated as work lands so a new session can pick up from here.
> IDs refer to [02-mea-ideas.md](02-mea-ideas.md). Phase 0 is in [03-phase0-status.md](03-phase0-status.md).
> Work is on branch **`phase-1-memory-6g4jph`** (PR #1 into `main`). **Phase 1 is feature-complete**; the summary is in [05-phase1-status.md](05-phase1-status.md). This file keeps the detailed build notes.

## State at a glance

| Area | State |
|---|---|
| Server: schema, providers, memory engine, routes | **Done: type-checks, 70/70 tests pass** (`bun run test`) |
| Server: tests for the new memory code | **Done:** `server/test/memory.test.ts` (25 tests: heuristics, eviction, Anthropic conversion, quota shed/calibration/planner, mirror crypto, full mock pipeline incl. MEM-10 rebuild, proposals, merge, manual breaks) |
| Mock provider: canned JSON for helper calls + fake embeddings | **Done** (`providers/mock.ts`; also lists a `mock/embed` model) |
| Web UI | **Done:** Memory dock tab + Memory Inspector, chat dividers, message memory menu, per-reply receipt with layered budget bar, composer prefetch, `quota_exhausted` choice; Settings → Memory (config + quota planner), Models (task routing, fallbacks, timeouts, embeddings, cache toggle + probe, Anthropic format), Usage (cache stats, request history), Status (job monitor), Backups (mirror) |
| Single-file `mea.exe` build (ARCH-14) | **Done:** `bun run build:exe` (`scripts/build-exe.ts`, `server/src/exe.ts`, `lib/embedded.ts`), `install-service.ps1 -Exe` |
| Docs | **Done:** [05-phase1-status.md](05-phase1-status.md), README |

## What's built (server)

**Schema — migration 2** ([server/src/db/migrations.ts](../server/src/db/migrations.ts)):
`summaries` (scene/chapter/arc rows + one `story` row per chat; each level's rows ordered by `start_seq`, a row ends where the next starts, the last is open), `summary_versions`, `memories` (atoms) + `memory_sources` (source links) + FTS5 tables kept by triggers, `embeddings` (model + dims recorded per vector), `memory_usage` (which reply used what), `quota_samples`, and new columns: `chats.memory` (JSON state: `segmentedThrough`, `evictedThrough`, `version`, `paused`), `generations.response/profile_id/cache_write_tokens/cost/job_id`, `jobs.chat_id/meta`, `models.learned_context/calibration/cache_probe`.

**Memory engine** (`server/src/memory/`):
| File | What |
|---|---|
| `text.ts` | Markup/reasoning cleaner (SUM-13, CTX-07), FTS query builder, hashing |
| `segment.ts` | Scene-break heuristics (MEM-03): markers, chapter headings, time skips (strong/weak, must open a sentence), long pauses |
| `store.ts` | Summary rows, per-chat memory state, ledger queries, `settledThrough` (lag K, SUM-06/MEM-09), split/merge boundaries (`startAt`, `removeBoundary`), versions |
| `prompts.ts` | Helper prompts + zod schemas: one-pass scene record (MEM-05, SUM-04/05), verification (SUM-12), chapter/arc/story rollups (SUM-01/02), boundary gate |
| `atoms.ts` | Atom CRUD, supersession (MEM-07), duplicate check, user edits lock (principle 4), merge/split, usage lookup |
| `build.ts` | Scene pass → verify → one auto-repair on "major"; rollups; proposals for review when `onEdit = ask` or the summary was user-edited (MEM-10); accept/reject; edit + version restore (SUM-08) |
| `scheduler.ts` | `memory.segment` job (incremental segmentation, optional LLM gate for weak signals, chapter/arc closing by size), build cascade, `onLedgerChange` (MEM-10 staleness), manual "end scene after" / "new chapter here" (MEM-04) |
| `embed.ts` | Embeddings via the routed connection (pay-as-you-go key), hash reuse (PERF-07), registry + re-embed (ARCH-12), query-embedding cache (PERF-06) |
| `context.ts` | `chooseWindow` chunked eviction with low-water mark (CTX-05), `telescope` (fold oldest scenes → chapter → arc → Story So Far until within budget, MEM-02), `recall` (BM25 + vectors + entity overlap + recency/importance, RRF, child-to-parent, slots recent/relevant/serendipity with rollover, pinned first; MEM-11/12/13), anti-recitation framing (MEM-35) |
| `inspect.ts` | Inspector overview + coverage map (SUM-09), summary/atom detail, chat dividers, per-message memory |

**Other server changes:**
- `prompt/assemble.ts`: new block kinds `memory_story` (inline, before history → cached prefix) and `memory_recall` (depth 1, dynamic). Keyword-triggered lore moves to the dynamic block (CTX-04, `splitTriggered`). Budget trace has per-layer sizes (CTX-01/02). Old-message filter (CTX-07). Returns `cacheMarks` (prefix end, history end) and `evictedThrough`. Targets divided by the per-model calibration ratio (CTX-03).
- `prompt/preset.ts` + `services/presets.ts`: presets gain the two memory blocks automatically (`ensureMemoryBlocks`).
- `services/generation.ts`: `prepare`/`startStory`/`previewPrompt` are now **async** (query embedding). Story fallback chain + first-token timeout (CONN-05), overflow → learn limit, shrink, retry once (CTX-08), quota check with paid alternatives on tap (CONN-20, HTTP 429 `quota_exhausted`), calibration recording, memory-usage receipts (MEM-40), `prefetch` (CTX-10). Persists `evictedThrough` when a reply starts.
- `services/llm.ts`: structured helper calls with fallback chain, timeouts, JSON repair retry, quota deferral.
- `services/connections.ts`: generic connections can use **Anthropic Messages format** (`format: "anthropic"`, CONN-23); cache strategy per model (CONN-12: never on subscription; NanoGPT `prompt_caching` for paid Claude; `cache_control` for Anthropic format); learned context limits; calibration; `resolveTaskChain` (CONN-03/05, never subscription → paid).
- `providers/anthropic.ts` (new), `providers/openai.ts` (embeddings, `response_format`, `prompt_caching`, cache-write usage), `providers/types.ts` (error classification, context-limit parsing).
- `services/quota.ts`: quota state, shed order (CONN-20), samples + cached-token calibration (CONN-22), planner with turns/day, per-feature costs, swipe ratio, weekly pacing (CONN-19).
- `services/requests.ts`: request log + history (DBG-02), cost estimate. `services/jobs.ts`: `Deferred`, job monitor list/retry/cancel (DBG-03). `services/probe.ts`: cache probe (CONN-24). `services/mirror.ts`: off-machine backup copy with optional passphrase encryption (DATA-08). `services/usage.ts`: `cacheStats` (CTX-09).
- New settings keys (`lib/settings.ts`): `routing.tasks`, `routing.fallbacks`, `routing.timeouts`, `routing.embeddings`, `memory.config`, `quota.degradeAt`, `quota.calibration`, `backup.mirror`.

**New API routes:** `routes/memory.ts` (overview, run/rebuild/pause, boundaries, summaries CRUD/rebuild/accept/reject/versions/merge, end-scene/new-chapter, atoms CRUD/merge/split, message memory, embeddings registry); in `routes/models.ts`: `/connections/:id/probe`, `/quota/planner`, `/cache-stats`, `/requests`, `/requests/:id`, `/jobs`, `/jobs/:id/retry|cancel`; in `routes/system.ts`: `/backups/mirror` (GET/PUT), `/backups/mirror/run`; in `routes/chats.ts`: `/chats/:id/prefetch`, `profileId` on send/swipe/continue.

## What's built (web)

| Where | What |
|---|---|
| `views/MemoryInspector.svelte`, `components/memory/*` | Story/chapters/scenes with edit, versions, rebuild, proposals; atoms with search/filter/edit/pin/merge/split/sources/usage; coverage map |
| `views/ChatView.svelte`, `components/chat/MessageItem.svelte` | Scene/chapter dividers, End scene / New chapter / What memory knows, Memory dock tab, paid-alternative dialog on `quota_exhausted` |
| `components/chat/Inspector.svelte` | Receipt: budget bar (setup / Story So Far / recall / history / reply), window state, gaps, telescope rows, recalled items with slot + reasons |
| `components/chat/Composer.svelte` | Debounced `prefetch` (900 ms, drafts ≥ 12 chars) |
| `components/settings/Memory.svelte` | `memory.config`, recall mix (slots rebalance to 100%), `quota.degradeAt`, planner |
| `components/settings/Routing.svelte` (inside Models) | `routing.tasks`, `routing.fallbacks` (ordered chips), `routing.timeouts`, `routing.embeddings` + re-embed |
| `components/settings/Models.svelte` | Connection request format, per-profile `cache` + cache probe badge, learned context limit |
| `components/settings/Usage.svelte`, `Status.svelte`, `Data.svelte` | Cache stats + request history/detail; job monitor; backup mirror |

## Follow-ups worth doing (not blocking)

- Tests still worth adding: verification auto-repair via `MOCK_MAJOR`, story fallback chain, overflow retry, cache probe with the mock.
- Start `mea.exe` on Windows once and run `install-service.ps1 -Exe`.
- First real-key session: check memory helper output quality and cost (see "Not verified yet" in 05).

## Known gaps / decisions to revisit

- Macros `{{storySoFar}}` / `{{recall}}` aren't wired (memory is computed after block expansion); the blocks cover it.
- Location-change scene breaks need the scene tracker (Phase 2).
- Scene token cap counts raw tokens of the open scene; a single huge message can still exceed it.
- `costOf` guesses NanoGPT's pricing field names; verify against a real `/models?detailed=true` response.
- NanoGPT's `prompt_caching.cut_after_message_index` is set to the history end; confirm hits with the probe on a real key.
