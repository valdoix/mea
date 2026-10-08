# Phase 0 status

> Phase 0 goal: a fast, cozy, reliable chat on Windows and Android, always on.
> IDs refer to [02-mea-ideas.md](02-mea-ideas.md).

## Verified

- **Server tests:** 45 tests pass (`bun run test`). They cover:
  - Card PNG/JSON/CHARX round trips, including unknown fields
  - Lorebook conversion and activation: keys, regex, secondary logic, recursion, groups, probability, budget, sticky/cooldown/delay
  - Macros and prompt assembly, plus SillyTavern preset import
  - OpenAI-compatible streaming, usage, and errors
  - NanoGPT catalog, subscription flag, and quota parsing (against a fake local server)
  - Full API flows with the mock provider: import → chat → streamed reply → swipe with feedback → continue → edit/hide/delete/restore → impersonate → exports → usage
  - Device pairing and auth, cross-site write blocking, trash, encrypted secrets, job retries, backup and restore
- **Type checks:** `tsc` (server) and `svelte-check` (web) report 0 errors and 0 warnings.
- **Bundle budget:** first load is 109 KB JS + 12 KB CSS gzipped (budgets: 250 KB / 60 KB).
- **Clicked through in a browser** (desktop 1280×800 and phone 375×812) with the mock provider:
  - Onboarding
  - Home and library
  - Chat: live streaming, the stop button, regenerate as a new swipe, the prompt inspector (blocks, lorebook trace)
  - Character editor: per-field tokens, save, version history
  - Lorebook editor
  - Settings → Models

## Delivered, by roadmap ID

| Area | IDs |
|---|---|
| Architecture | ARCH-01…08, ARCH-10 (Scheduled Task service script), ARCH-15 |
| Connections | CONN-01…04, CONN-06, CONN-08, CONN-11, CONN-13, CONN-17 (two-key setup supported in UI) |
| Chat | CHAT-01…08, CHAT-25 (mode + heuristic detection) |
| Characters / personas | CHAR-01…05, PER-01…02 |
| Lorebooks | LORE-01…04 (+ a test-activation box) |
| Prompts | PROMPT-01…05 |
| UI / phone | UI-01…07, MOB-01…06, MOB-14 |
| Library, perf, data, security, debug | LIB-01…03, PERF-01…05, DATA-01…03, SEC-01…04, DBG-01 |

**Bonus items from later phases:**
- MOB-07: roleplay symbol bar on the phone
- CHAT-09-lite: Enter makes a new line; send with the button or Ctrl+Enter
- CON-adjacent: Regen feedback notes (CHAT-03)
- Chat export to HTML/Markdown/JSONL, a lorebook test box, swipe comparison, usage charts

**Per your requests during the build:**
- Enter adds a new line; it never sends. Ctrl+Enter sends on a computer.
- Message portraits are centered above each message box and bigger (2:3, 76×114 on desktop, 64×96 on the phone).

## Deviations (deliberate)

- **CHAR-02:** two editor modes, *Form* and *Document* (Markdown with pinned headings). The "single freeform document" is covered by Document mode.
- **PERF-02:** "virtualization" is paginated loading (60 messages at a time, older ones on scroll) plus CSS `content-visibility`. That's simpler than a virtual list and meets the 10k-message open target.
- **ARCH-04:** no worker threads yet. Token counting is fast (~14 ms per 40k tokens) and cached, so it stays on the request thread for now.
- **Thumbnails (PERF-08, P1):** made by the browser when you upload. Imported cards get one the first time they're shown.
- **Drafts:** saved per device (localStorage). Syncing drafts between devices is CHAT-17 (P1).

## Not verified yet (needs your real setup)

- **Real NanoGPT / LinkAPI calls.** I can't use your keys, so streaming, the catalog, and quota were tested against a fake server that follows NanoGPT's documented formats. First real check: add your subscription key in Settings → Models and send a message.
- **Claude caching (CONN-12, CONN-23/24):** Phase 1. Claude currently works through the OpenAI-compatible path without cache markers.
- **The Windows service script:** syntax-checked, not run (it needs admin rights and changes system scheduling).
- **Push notifications on the phone:** needs the Tailscale HTTPS address and an installed PWA.
- **Phone gestures:** swipe and long-press were written for touch, and the browser tests used mouse clicks.

## Next: Phase 1 (memory core)

Message ledger extensions, scene segmentation, hierarchical summaries, the Story-So-Far, the telescoping budget, the Memory Inspector, cache-friendly assembly with chunked eviction, quota planner (CONN-19…22), Anthropic Messages format + cache probe (CONN-23/24).
