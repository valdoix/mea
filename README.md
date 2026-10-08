# Mea ✿

A personal AI roleplay frontend for Windows and Android, served from an always-on host and powered by NanoGPT. Its focus is memory, continuity, and a cozy reading experience.

**Status:** Phase 0 (foundations) and Phase 1 (memory core) are built. See [docs/05-phase1-status.md](docs/05-phase1-status.md).

## Planning docs

| Doc | What's inside |
|---|---|
| [docs/01-frontend-analysis.md](docs/01-frontend-analysis.md) | Analysis of the 45 frontends on Tavernary (plus Lumiverse `staging` and the memory-extension ecosystem) |
| [docs/02-mea-ideas.md](docs/02-mea-ideas.md) | The full idea list with IDs and priorities, your decisions (§0.1), NanoGPT specifics, the cozy pastel theme, and the roadmap |
| [docs/03-phase0-status.md](docs/03-phase0-status.md) | What Phase 0 delivered, deviations, and what still needs a real-world check |
| [docs/04-phase1-progress.md](docs/04-phase1-progress.md) | Phase 1 build notes, file by file (schema, memory engine, routes, UI) |
| [docs/05-phase1-status.md](docs/05-phase1-status.md) | What Phase 1 delivered, where to find it, and what still needs a real-world check |

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

To remove it: `scripts\uninstall-service.ps1` (your data stays).

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

This starts the API (with the mock provider enabled) on :7766 and Vite on http://localhost:5173. Dev data goes to `./data-dev`, so your real stories are never touched.

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
  lore/       lorebook model, SillyTavern conversion, activation engine
  memory/     scenes, summaries, memories, recall, telescoping budget, inspector
  prompt/     macros, presets, prompt assembly
  providers/  OpenAI-compatible + Anthropic streaming, NanoGPT catalog & quota, mock
  services/   characters, chats, generation, connections, backups, auth, jobs…
  routes/     HTTP API
web/src
  views/      Home, Chat, Character, Personas, Lorebooks, Presets, Settings…
  components/ chat, memory, settings, lore, shared UI
  lib/        api, events (live stream), router, rendering, gestures, images
scripts/      dev runner, icons, budgets, exe build, Windows service install
```
