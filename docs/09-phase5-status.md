# Phase 5 status

> Phase 5 goal: accuracy at 5,000+ messages, and the "wow" factor (guards and polish).
> IDs refer to [02-mea-ideas.md](02-mea-ideas.md).
> Phase 5 is complete. Guards and steering live in each chat's panel and in **Settings → Guards / Writing**; data tools in **Settings → Backups & data / Storage & privacy** and each chat's **Book & memory**; per-device switches in **Settings → Appearance → On this device**.

## Delivered, by roadmap ID

| Area | IDs |
|---|---|
| Accuracy guards | CON-03 (re-anchor block), CON-04 (point of view, tense, puppeting: flag, trim or retry), CON-05 (name registry: flag or fix), CON-09 (review inbox), CON-10 (drift detector, using the voice lab's kept lines), CON-12 (timeline sanity check) |
| Steering | STEER-01 (advisor pass, written while you type), STEER-02 (advisor memory), STEER-03 (post-pass editor as a diff, or applied with undo), STEER-04 (style profile per chat, over the character's) |
| Summaries | SUM-10 (Tight / Balanced / Detailed per level), SUM-11 (dramatic-moment tags that survive every level), SUM-13 (clean input), SUM-14 (chapter titles: dividers, scrubber, reading mode, book export), SUM-15 ("previously on…" card and `/recap`), SUM-16 (compression stats), SUM-17 (one voice for every summary), SUM-19 (rebuild from scratch with estimate, progress, pause and resume), SUM-20 (summarized ≠ hidden, with a marker in the chat). SUM-18 (editable helper prompts that survive updates) was delivered in Phase 4 as PROMPT-09 |
| Interface | UI-08 (per-chat ambience), UI-09 (chapter and scene dividers with in-story time; the scene header is the HUD line), UI-10 (timeline scrubber), UI-11 (who's-who popovers), UI-12 (command palette), UI-13 (motion, now off everywhere under reduced motion), UI-14 (Continue card with chapter and recap line), UI-15 (reading mode), UI-16 (typography), UI-17 (three-step onboarding, from Phase 0), UI-18 (one icon set: Lucide), UI-19 (labels, focus, font scaling, dyslexia-friendly font), UI-20 (discreet mode), UI-24 (small delights), UI-25 (friendly empty states) |
| Phone and offline | MOB-07 (symbol bar, from Phase 0), MOB-08 (HUD chips, from Phase 2), MOB-09 (haptics), MOB-10 (pull-up loading, jump-to-latest with an unread count), MOB-11 (app lock), MOB-12 (data-light mode), MOB-13 / ARCH-11 (offline reading and queued sends), ARCH-09 (Windows tray icon) |
| Data, performance, security | DATA-04 (book export: EPUB, HTML, PDF via print), DATA-05 (memory export/import), DATA-06 (storage dashboard), PERF-08 (image sizes), PERF-09 (code splitting; the spell checker loads only when on), PERF-10 (timing breakdown), PERF-11 (streamed memory import), SEC-05 (encryption at rest), SEC-06 (redacted request log, pruned) |
| Quality of life | QOL-01 (notebook), QOL-02 (bookmarks and highlights, best moments, memory weight), QOL-03 (@-mentions), QOL-04 (local spell and grammar check), QOL-05 (undo toasts) |

## Where things are

| You want to… | Go to |
|---|---|
| See why a reply was flagged (POV, puppeting, a misspelled name, a time jump) | The note under the reply; settings in **Settings → Guards**, per chat in the panel's **Guards and voice** |
| Approve or reject what Mea proposes to change in canon | **Inbox** in the sidebar |
| Turn on the advisor or the editor, set a style | Chat panel → **Steering** (defaults in **Settings → Writing**) |
| Export the story as a book, or move memory to another chat | Chat panel → Tools → **Book & memory** |
| Read the story without the chat around it | Chat header → book icon, or Chat panel → **Reading mode** (`/chat/:id/read`) |
| Find space, compact, empty the trash, encrypt | **Settings → Storage & privacy** |
| Keep notes, see your best moments | **Notebook** in the sidebar, or the chat dock's **Notes** tab |
| Jump anywhere | <kbd>Ctrl</kbd>/<kbd>Cmd</kbd>+<kbd>K</kbd>, or the search button at the top of the sidebar |
| Spell check, discreet mode, app lock, data-light, offline copies | **Settings → Appearance → On this device** (they differ per phone and computer) |

## How some of it works

### Accuracy guards

- **Re-anchor (CON-03):** a short "who this character is" block near the end of the prompt. On `auto` it starts once the chat is long (30 messages by default) and grows stronger while the drift detector says the voice has wandered.
- **Point of view, tense, puppeting (CON-04):** cheap rules over the narration (dialogue in quotes is left out), compared with the story settings or the last few replies. Puppeting can be flagged, trimmed off the end, or retried once.
- **Names (CON-05):** canonical spellings come from the card, persona, people and places in memory, trackers and lore. The same list feeds @-mentions, the spell checker's dictionary and the who's-who popovers.
- **Drift (CON-10):** the character's recent lines against their voice samples (the voice lab's kept lines first, then example dialogue): style statistics always, meaning through embeddings when they're on.
- **Timeline (CON-12):** the clock running backwards, or a big jump the reply never mentions, is flagged with the clock as the citation.
- **Review inbox (CON-09):** rebuilt summaries of things you edited, journal rewrites, story-born lore, likely duplicate people, contradicting memories and new subplots wait as diffs. Nothing changes canon until you approve.

### Steering

- **Advisor (STEER-01/02):** a helper writes a short private plan while you type; sending waits at most a few seconds for it (configurable). It sees its last few plans.
- **Editor (STEER-03):** minimal fixes for POV slips, writing for you, banned phrases and formatting, shown as a diff (or applied, with undo). It can run on every reply or only on flagged ones.

### Data and privacy

- **Encryption at rest (SEC-05):** with a passphrase the database lives on disk only as `mea.db.enc` (AES-256-GCM, scrypt). After a restart Mea shows an unlock screen until you type it. Trade-offs: up to ~30 s of changes can be lost on power loss, and a forgotten passphrase can't be recovered.
- **Request log (SEC-06):** keys, and anything shaped like one, are blanked before a request, response or error is stored. Full text is kept 30 days by default; daily log files 14 days.
- **Offline copies (ARCH-11):** the service worker keeps network-first copies of what reading a chat needs. They're on the device in plain form, also when the database on the computer is encrypted. Switch **Keep recent chats on this device** off to delete them and stop keeping new ones.
- **App lock (MOB-11):** a PIN (PBKDF2, kept on the device), plus fingerprint or face through WebAuthn where the page is secure (https, e.g. through Tailscale, or the computer itself). It's a privacy screen: pairing is still what keeps other devices out.

### Offline and queued sends

When Mea can't be reached, recent chats open from the saved copy with an "Offline: reading saved copies" banner. Messages you send wait on the device ("waiting to send") and go out in order when Mea is back; only the last waiting message of each chat asks for a reply. Screens you have never opened (the studios, for example) need Mea once before they work offline.

### Spell check (QOL-04)

Harper runs in the browser in WebAssembly; nothing is sent anywhere. It's off by default because its file is large (about 16 MB, ~8 MB as served gzipped), downloaded once the first time you switch it on. `*actions*` are checked, `{{macros}}` and `(OOC: …)` asides are skipped.

### The tray icon (ARCH-09)

`scripts\tray.ps1` (PowerShell, Windows' own tray API). `install-service.ps1 -Tray` adds it to your sign-in. It polls `http://127.0.0.1:<port>/api/health` every 15 s: running / jobs / last backup, "locked" while the encrypted database waits for its passphrase, and a balloon if Mea stops answering. Menu: Open Mea, Status and jobs, Restart (ends and runs the Scheduled Task), View logs (the data folder's `logs`), Hide this icon.

## Server changes the screens needed

- `GET /api/chats/:id/messages?after=<seq>` reads forward (reading mode); without it, pages still come backwards from the end.
- `GET /api/chats/:id/continue`: the Continue card's chapter and recap line, with no model call.
- The name registry carries each person or place's Codex id (who's-who).
- `appearance.typography` (synced setting) and the chat setting `ambience`.
- `.wasm` files are served gzipped (cached in memory after the first request).

## Fixes in this phase

- **Two backups in the same second clashed:** the second failed with "output file already exists" (for example, pressing Back up now twice). Backups now take a free name (`-2`, `-3`…). This also made the encryption test fail when the whole suite ran.
- **A new note didn't take the keyboard:** typing spaces then re-pressed "New note" and made empty notes. The text box now takes focus, and an empty note is dropped when closed.
- **The same passage highlighted twice** made two highlights. It's kept once.
- **Data-light mode never switched on:** images honoured it, but nothing set it. It now follows data saver and cellular connections, or your choice.
- **Reading mode** showed a scene break right under a chapter title that starts on the same message.
- **Names under portraits** were hard to read on dark chat art; they get a soft panel now.

## Not verified yet (needs your real setup)

- **The tray icon was not run:** there was no Windows machine to try it on. Check that it appears, that Restart works without admin rights for your Scheduled Task (if not, run the tray once as administrator), and that the icon greys out when Mea stops.
- **Guards and steering with real models:** the advisor, editor, drift detector and recaps were only checked against the mock. Watch the cost of the advisor and editor in **Settings → Usage**; both are off by default.
- **Fingerprint / face unlock** needs a secure page. Over plain `http://` on the LAN, only the PIN is offered. Try it through your Tailscale HTTPS address.
- **Offline on a real phone:** checked in Chromium with the server stopped (the chat reopened from saved copies, a message waited and was sent with a reply once the server was back). Try airplane mode on Android, including after the browser has been closed.
- **Spell check quality** on roleplay prose: it may flag stylistic choices. Use the × on a suggestion to ignore that word for the session.
- **Encryption at rest with a big database:** the database runs in memory while unlocked; a multi-GB database needs that much free RAM.
- **Book export of a very long story:** EPUB and HTML were checked on small chats only.

## Development notes

- `bun run test`: 233 tests pass. `bun run check` is clean. Initial JS is ~134 KB gzipped (budget 250 KB); the spell checker and every screen but Home and the chat load on demand.
- The single-file build (`bun run build:exe`) embeds the web app, so `mea.exe` is about 16 MB bigger with the spell checker inside.
- Browser automation note: Playwright's offline switch doesn't cover the service worker's own requests. To test offline reading, stop the server instead.

## Next: later

Every remaining `P2`/`P3` item from [02-mea-ideas.md](02-mea-ideas.md#23-suggested-roadmap), for example the agentic recall tool (MEM-24), sequels with memory (MEM-33), memory snapshots (MEM-45), fold in place (SUM-21) and self-update from the tray (ARCH-16).
