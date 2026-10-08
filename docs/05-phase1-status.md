# Phase 1 status

> Phase 1 goal: continuity at 1,000+ messages: long-term memory that fits the prompt budget, stays cache-friendly, and can be read and corrected by hand.
> IDs refer to [02-mea-ideas.md](02-mea-ideas.md). Detailed build notes (file by file) are in [04-phase1-progress.md](04-phase1-progress.md).

## Verified

- **Server tests:** 70 pass (`bun run test`). The 25 new memory tests in `server/test/memory.test.ts` cover:
  - Scene-break heuristics and chunked eviction
  - Anthropic Messages conversion
  - Quota shedding, calibration and the planner
  - Encryption of the backup mirror
  - The full mock pipeline: segmentation → scene records → verification → rollups → recall, plus a rebuild after an edit (MEM-10)
  - Proposals, merges and manual scene/chapter breaks
- **Type checks:** `tsc` (server) and `svelte-check` (web) report 0 errors and 0 warnings.
- **Bundle budget:** first load is 133 KB JS + 14 KB CSS gzipped (budgets: 250 KB / 60 KB).
- **Single-file build:** `bun run build:exe` cross-compiles `dist/mea.exe` (Windows x64, ~87 MB). A Linux build of the same binary was run from an empty folder. It served the web app (index, client-side routes, hashed assets, service worker), ran the migrations, and created `data/` next to itself.
- **Clicked through in a browser** with the mock provider (desktop 1280×860 and phone 390×844). The test chat had 28 messages, 6 scenes, 3 chapters, 1 arc and 16 memories. No console or page errors, and no sideways scrolling on any settings tab:
  - Chat with scene and chapter dividers; the Memory dock tab
  - Memory Inspector
  - The per-reply receipt, with the prompt squeezed so older messages move into memory: Story So Far chapters, recalled items with their slot and reason, the warning for messages not summarized yet, and the budget bar split by layer
  - Settings → Models (routing, embeddings, caching), Memory, Usage, Status, Backups & data
  - Prefetch requests fire while typing

## Delivered, by roadmap ID

| Area | IDs |
|---|---|
| Memory | MEM-01…13 (ledger, telescoping Story So Far, segmentation, manual breaks, one-pass scene records, supersession, lag, MEM-10 staleness/proposals, hybrid recall with slots), MEM-35 (anti-recitation framing), MEM-39 (Inspector), MEM-40 (per-reply receipts) |
| Summaries | SUM-01…09 (scene/chapter/arc/story, edits + versions, coverage map), SUM-12 (verification + one auto-repair), SUM-13 (cleaner) |
| Context | CTX-01…10 (layered budget, calibration, lore in the dynamic block, chunked eviction with low-water mark, old-message filter, overflow learn + retry, cache stats, typing prefetch) |
| Connections | CONN-05 (fallback chains + first-token timeout), CONN-12 (cache strategy per route), CONN-16, CONN-19…22 (planner, shed order, quota_exhausted with paid alternatives on tap, cached-token calibration), CONN-23 (Anthropic Messages format), CONN-24 (cache probe) |
| Architecture / data | ARCH-12 (embedding registry + re-embed), ARCH-14 (single-file exe), DATA-08 (off-machine backup copy, optional encryption) |
| Debug / perf | DBG-02 (request history with raw request/response), DBG-03 (job monitor with retry/cancel), PERF-06…07 (query-embedding cache, hash reuse) |

## Where to find things

- **Each chat:** the **Memory** dock tab (coverage, stats, review queue) and the full **Memory Inspector** (`/chat/<id>/memory`). The message menu has *End scene here*, *New chapter here* and *What memory knows*. The ⓘ button on a reply shows what that reply was given.
- **Settings → Memory:** on/off, review mode, verification, scene and chapter sizes, budget shares, the recall mix, cache lifetime, and the quota planner with its "save quota from" threshold.
- **Settings → Models:** per-profile prompt caching and cache check, the Anthropic format for custom connections, task routing (summaries, helpers), fallback chains, timeouts, and embeddings.
- **Settings → Usage:** prompt-cache hit rate and savings, and request history.
- **Settings → Status:** background jobs.
- **Settings → Backups & data:** a second folder for backup copies.

## Deviations (deliberate)

- **ARCH-14 data folder:** the exe keeps its data in `data/` next to itself, not in the repo's `./data`. If you switch an existing install to the exe, copy the folder over first. `install-service.ps1 -Exe` warns about this.
- **Macros `{{storySoFar}}` / `{{recall}}`** aren't wired up. Memory is computed after macros are expanded; the two preset blocks cover it.
- **Location-change scene breaks** wait for the scene tracker (Phase 2).

## Not verified yet (needs your real setup)

- **Real NanoGPT calls for memory helpers.** The scene/verify/rollup prompts were checked against the mock only. Watch the first real chapters in the Memory Inspector, and check **Settings → Usage → Request history** for what each one cost.
- **Caching on real routes:** NanoGPT's `prompt_caching` for paid Claude and `cache_control` on the Anthropic format. Use **Check caching** on a paid Claude profile.
- **`costOf`** guesses NanoGPT's pricing field names. Compare the cost in Request history with NanoGPT's dashboard.
- **Embeddings** with `text-embedding-3-large` on your pay-as-you-go key.
- **`mea.exe` on Windows:** cross-compiled and the same build tested on Linux, but not started on Windows yet, and `install-service.ps1 -Exe` hasn't been run (it needs admin rights).
- **Phone gestures** are still tested with mouse clicks only.

## Next: Phase 2 (trackers & chat tools)

TRK-01…13, TRK-16…22, TRK-26…32 (scene tracker, which also unlocks location-based scene breaks), CHAT-09…20, CHAT-26…27, CONN-07, CONN-09, CONN-14.
