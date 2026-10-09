# Mea ✿

A personal AI roleplay frontend for Windows and Android, served from an always-on host and powered by NanoGPT. Its focus is memory, continuity, and a cozy reading experience.

**Status:** Phases 0–5 are built: foundations, memory core, trackers and the world off the page, retrieval, facts and accuracy, the creator studio, and guards and polish. Phase 5 brought accuracy guards (re-anchor, point of view and puppeting, names, drift, timeline, a review inbox), steering (advisor, post-pass editor, style profiles), summary controls, book and memory export, a storage dashboard, encryption at rest, a notebook and best moments, a command palette, reading mode, a timeline scrubber, offline reading with queued sends, an app lock, and a Windows tray icon. See [docs/09-phase5-status.md](docs/09-phase5-status.md).

## Planning docs

| Doc | What's inside |
|---|---|
| [docs/01-frontend-analysis.md](docs/01-frontend-analysis.md) | Analysis of the 45 frontends on Tavernary (plus Lumiverse `staging` and the memory-extension ecosystem) |
| [docs/02-mea-ideas.md](docs/02-mea-ideas.md) | The full idea list with IDs and priorities, your decisions (§0.1), NanoGPT specifics, the cozy pastel theme, and the roadmap |
| [docs/03-phase0-status.md](docs/03-phase0-status.md) | What Phase 0 delivered, deviations, and what still needs a real-world check |
| [docs/04-phase1-progress.md](docs/04-phase1-progress.md) | Phase 1 build notes, file by file (schema, memory engine, routes, UI) |
| [docs/05-phase1-status.md](docs/05-phase1-status.md) | What Phase 1 delivered, where to find it, and what still needs a real-world check |
| [docs/06-phase2-status.md](docs/06-phase2-status.md) | What Phase 2 delivered (trackers, world simulation, chat tools), build notes, and what still needs a real-world check |
| [docs/07-phase3-status.md](docs/07-phase3-status.md) | What Phase 3 delivered (retrieval, entities, accuracy guards, lore, library), fixes, and what still needs a real-world check |
| [docs/08-phase4-status.md](docs/08-phase4-status.md) | What Phase 4 delivered (the studios, card tools, variants, prompt layers, controls, regex, helper prompts), fixes, and what still needs a real-world check |
| [docs/09-phase5-status.md](docs/09-phase5-status.md) | What Phase 5 delivered (guards, steering, summaries, data and security, interface, phone and offline), fixes, and what still needs a real-world check |

## Running Mea

Requirements: [Bun](https://bun.sh) 1.4+, and Tailscale for phone access.

```bash
bun install
```

**Everyday use (production):**

```bash
bun run build
```

```bash
bun run start
```

Then open http://127.0.0.1:7766. Data lives in `./data` (database, images, backups, and the key file that encrypts your API keys).

**As an always-on Windows service** (starts at boot and restarts if it crashes). Run this in PowerShell opened as administrator:

```bash
powershell -ExecutionPolicy Bypass -File scripts\install-service.ps1
```

Add `-Tray` to also put Mea's icon in the notification area at every sign-in (ARCH-09): whether it's running, background jobs and the last backup, with Open, Restart and View logs. To remove it: `scripts\uninstall-service.ps1` (your data stays).

**As a single file** (ARCH-14): `bun run build:exe` makes `dist\mea.exe` with the web app inside. Run it anywhere; its data goes in a `data` folder next to it. To run the exe as the service, add `-Exe` to the install command above (copy your existing `data` folder to `dist\data` first).

**Phone access:**
1. Install Tailscale on the PC and the phone, signed in to the same account.
2. Once, on the PC, run `tailscale serve --bg 7766`. This gives Mea a private `https://<pc>.<tailnet>.ts.net` address.
3. In Mea on the PC, open **Settings → Devices → New pairing code** and scan the QR code with the phone.
4. In Chrome on the phone, choose **Install app**, then turn on **Settings → Notifications**.

## Development

```bash
bun run dev
```

This starts the API (with the mock provider enabled) on :7766 and Vite on http://localhost:5173. Dev data goes to `./data-dev`, so your real stories are never touched. If the Mea service is already running on :7766, set `MEA_PORT` (for example `7767`) for the dev run; both the API and Vite's proxy follow it.

| Command | What it does |
|---|---|
| `bun run test` | Server tests (cards, lorebooks, macros, prompts, providers, API end-to-end) |
| `bun run check` | TypeScript + Svelte type checks |
| `bun run build` | Builds the web app into `web/dist` |
| `bun run budgets` | Checks the bundle-size budgets (PERF-01) |
| `bun run build:exe` | Builds `dist/mea.exe` (add `-- --target host` for a binary for this machine) |

## Layout

```
server/src
  cards/      character card PNG/JSON/CHARX parsing and writing
  lore/       lorebook model, SillyTavern conversion, activation engine, the Lore Studio
  creator/    expand my idea, the character and persona creator, card checks, world context
  memory/     scenes, summaries, memories, recall, entities, journals, ledgers, telescoping budget
  accuracy/   continuity checker and leak guard, Archivist, Codex, memory quiz
  prompt/     macros, presets, prompt assembly
  providers/  OpenAI-compatible + Anthropic streaming, NanoGPT catalog & quota, mock
  trackers/   story state: ledger grammar, event fold, rules, drift, clock, templates, prompt note
  sim/        the world off the page: roster, subplots, director, news, crossings, sky
  services/   characters, chats, generation, chat tools, connections, backups, auth, jobs…
  routes/     HTTP API
web/src
  views/      Home, Chat, Story, World, Search, Character, Personas, Lorebooks, Presets, Settings…
  components/ chat, memory, trackers, world, settings, lore, shared UI
  lib/        api, events (live stream), router, rendering, gestures, images
scripts/      dev runner, icons, budgets, exe build, Windows service install
```
