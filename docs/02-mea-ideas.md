# Mea: Ideas & Design Directions

> *Mea* is Latin for "mine": a personal roleplay frontend for one person, on a Windows PC and an Android phone.
> This is the complete idea list, built from the analysis in [01-frontend-analysis.md](01-frontend-analysis.md).
> Every idea has an ID (so you can say "do MEM-08") and a priority:
>
> | Tag | Meaning |
> |---|---|
> | `P0` | Core. Mea isn't Mea without it (MVP) |
> | `P1` | v1. Strongly wanted soon after the core |
> | `P2` | Later. Valuable polish or depth |
> | `P3` | Experimental. Try it if there's time, cut it if it doesn't pay off |
>
> *(↳ Name)* marks where an idea was seen in the research. No mark means it's new for Mea.
>
> **Your decisions from 2026-10-08 are in [§0.1](#01-decisions-2026-10-08) and are already reflected in the priorities below.**

---

## Contents

0. [Vision & principles](#0-vision--principles) · [Decisions](#01-decisions-2026-10-08)
1. [Platform & architecture](#1-platform--architecture-arch)
2. [Memory system](#2-memory-system-mem)
3. [Summarizer](#3-summarizer-sum)
4. [Trackers](#4-trackers-trk)
5. [Continuity & accuracy safeguards](#5-continuity--accuracy-safeguards-con)
6. [Context assembly & token budget](#6-context-assembly--token-budget-ctx)
7. [Lorebooks](#7-lorebooks-lore)
8. [Character creator](#8-character-creator-char)
9. [Persona creator](#9-persona-creator-per)
10. [Chat & generation](#10-chat--generation-chat)
11. [Steering & writing quality](#11-steering--writing-quality-steer)
12. [Prompts & presets](#12-prompts--presets-prompt)
13. [Models & connections](#13-models--connections-conn)
14. [UI design & aesthetics](#14-ui-design--aesthetics-ui)
15. [Phone experience](#15-phone-experience-mob)
16. [Library & organization](#16-library--organization-lib)
17. [Performance](#17-performance-perf)
18. [Data, backup, import/export](#18-data-backup-importexport-data)
19. [Privacy & security](#19-privacy--security-sec)
20. [Transparency & debugging](#20-transparency--debugging-dbg)
21. [Quality-of-life extras](#21-quality-of-life-extras-qol)
22. [Explicitly out of scope](#22-explicitly-out-of-scope)
23. [Suggested roadmap](#23-suggested-roadmap)
24. [Remaining questions](#24-remaining-questions)

---

## 0. Vision & principles

**One sentence:** Mea remembers everything about your story, shows you exactly what it remembers, feels cozy and lovely to read, and is instant on both your Windows PC and your Android phone.

1. **Memory is the product.** Every feature serves long-term continuity. Thousands of messages in, the character should still remember the scar, the promise, and the name of the dog.
2. **Every fact has a source.** Every summary, fact, and tracker change links back to the messages it came from. Nothing in memory is unexplained.
3. **Never block the reply.** Summarizing, extraction, tracking, and embedding run in the background, are cached, and are computed lazily. The user waits only for the story.
4. **Inspectable and editable.** You can see, search, fix, pin, or delete anything Mea "remembers", and your edits always win over the AI's.
5. **Calm by default, deep on demand.** Simple mode has good defaults. Advanced mode exposes every knob. No walls of settings.
6. **One person, two screens.** Windows and Android. The phone is designed separately, not shrunk down from desktop.
7. **Light.** One small server, one SQLite file, a small frontend bundle. No Docker, Python, or vector database required.
8. **Compatible in, portable out.** Imports SillyTavern/Risu cards, lorebooks, and presets. Exports open formats.
9. **NanoGPT-first, cache-aware.** Built around NanoGPT and any OpenAI-compatible API. The prompt is laid out to get the most out of prompt caching.
10. **Accuracy within the quota.** Defaults favor maximum continuity accuracy. The subscription's input-token quota is the real budget, and Mea spends it where it buys the most accuracy, keeping prompts lean so long stories fit comfortably.

### 0.1 Decisions (2026-10-08)

| # | Decision | What it changes in Mea |
|---|---|---|
| 1 | **Always-on server; clients are Windows + Android** | The server runs 24/7 on one host (Windows first-class, as a background service). Both devices use the installed PWA over **Tailscale with HTTPS** (Tailscale Serve), which Android needs for app install and push notifications. No iOS/macOS work. Always-on means heavier accuracy work can run in idle time. See ARCH-08, ARCH-10, ARCH-15, MOB-*. |
| 2 | **Cloud APIs: NanoGPT + generic OpenAI-compatible** | NanoGPT is the first-class provider: model catalog with context sizes, capabilities, and pricing; embeddings; caching rules; subscription quotas; cheap "decision" models; exact per-request cost. There's no Gemini adapter. An Anthropic Messages format adapter exists only for Claude on LinkAPI (#13). Embeddings come from the API, so there's **no local embedding model**. See CONN-01, CONN-11…18, ARCH table. |
| 3 | **Start fresh** (no chat import) | Chat import and memory backfill drop to `P3`. Importing **cards, lorebooks, personas, and presets** stays `P0`. See DATA-01, MEM-43. |
| 4 | **English only** | No i18n work. English-tuned embeddings, heuristics (time-skip phrases, name detection), spell check, and "slop" lists. See UI-21. |
| 5 | **Mostly 1-on-1, also narrator cards** | A per-chat **mode**: *Companion* (1-on-1) or *Narrator*, auto-detected from the card. Each mode sets its own memory, tracker, and knowledge defaults. The NPC side (entity graph, cast panel, knowledge guard) matters in Narrator mode. See CHAT-25…27, MEM-16, CON-06. |
| 6 | **Maximum accuracy** | The *Deep* memory profile is the default. Trackers update every message. Summary verification and the continuity checker are **on by default**. Deep search, the librarian pass, the drift detector, timeline checks, and the memory quiz move up to `P1`. *(Refined by #9: accuracy is maximized **within your quota**. On a subscription, quota counts input tokens regardless of model, so helpers use the **strongest** subscription model where speed doesn't matter.)* |
| 7 | **Cozy / pastel default look** | The design direction changes from "ink & lamplight" to **cozy pastel**: soft rounded shapes, warm cream and plum, pastel accents, gentle motion. More themes come later. See §14. |
| 8 | **Host: a Windows machine at home** | Mea runs as a Windows service on that machine, and your story data never leaves your house except as model requests. Linux/VPS support is no longer a goal. |
| 9 | **NanoGPT subscription only** for chat and helpers | **Your daily/weekly input-token quota is now the real budget, not money.** Story and helper calls must stay subscription-covered: only subscription-included models, and no request options that switch to pay-as-you-go (explicit Claude caching, forced provider, `caching: true`). This needs a **two-key setup** (a "Subscription only" key + a pay-as-you-go key), a **quota planner**, **compact helper inputs**, and **graceful degradation** near the quota. See CONN-13, CONN-17, CONN-19…22. |
| 10 | **Embeddings are paid** (pay-as-you-go, about $0.13 per 1M tokens) | Embeddings go through the pay-as-you-go key. Everything else uses the subscription-only key. |
| 11 | **Main models: GLM and Claude** | GLM 5.x is in the subscription (1M context, structured output, implicit caching). **Claude is not in NanoGPT's subscription:** as of 2026-10-08 the subscription catalog has only Claude-*distilled* open models. Claude via NanoGPT is therefore pay-as-you-go, which makes explicit caching a pure win for it (up to ~90% off input). See §24, Q1. |
| 12 | **No spending alerts** | Budget alerts are removed. Mea tracks **quota** usage instead, and shows pay-as-you-go spend (embeddings, Claude) for information only. |
| 13 | **Claude via NanoGPT (pay-as-you-go) and via LinkAPI** | Two Claude paths, both paid per use, so **caching matters for money** there. NanoGPT Claude goes through Key B with NanoGPT's `prompt_caching` helper. LinkAPI appears to run *New API*, a gateway that offers both OpenAI and Anthropic (`/v1/messages`) formats. Mea talks to Claude on LinkAPI in **Anthropic Messages format** with native `cache_control`, and **verifies caching with a probe** instead of assuming. See CONN-12, CONN-23, CONN-24. |
| 14 | **Subscription quota: 60M input tokens/week** | That's ~8.5M/day on average, which comfortably fits maximum accuracy (about **140 turns/day** at the default settings). The default story prompt target rises to **~48k tokens**. Swipes are the main quota cost (each one resends the full story prompt). See CONN-19, CTX-01. |

---

## 1. Platform & architecture (ARCH)

**Shape:** a small **single-user server** running 24/7 as a background service on a **Windows machine at home**, plus an installable **PWA** on your Windows PC and Android phone. They connect over **Tailscale**.
Why: generation and background memory work happen on the server, so they **finish even when the phone locks or loses signal** (↳ PocketRisu, Neconyan). One database means **no sync conflicts**. A PWA keeps one codebase for both screens.

```
 Android phone (PWA, Chrome) ─┐                         ┌─► NanoGPT API (chat · embeddings · decisions)
                              ├─ Tailscale (HTTPS) ─► Mea server (always-on) ─┤
 Windows PC (PWA, Edge/Chrome)┘     mea.<tailnet>.ts.net   Bun · SQLite · jobs  └─► any OpenAI-compatible API
```

| Layer | Recommendation | Why |
|---|---|---|
| Runtime | **Bun** | Fast startup, built-in SQLite, compiles to a single executable (↳ Lumiverse, vibe_tavern, ChungusHub) |
| HTTP | **Hono** | Tiny, fast, typed |
| Database | **SQLite** (WAL) + **FTS5** for keyword search + vectors stored as BLOBs | One file. At personal scale, brute-force cosine over a chat's vectors in a worker takes milliseconds, so no vector index is needed (↳ Sonder). Add `sqlite-vec` only if needed |
| Frontend | **Svelte 5 + Vite + TypeScript** | Small bundles and fine-grained updates during streaming (↳ RisuAI, Aventuras, RyokanApp, ChungusHub) |
| Embeddings | **NanoGPT embeddings API**: `text-embedding-3-large`, reduced to 1024 dimensions, on the **pay-as-you-go key** | Top-quality English retrieval at about $0.13 per 1M tokens (embedding an entire long story costs cents). 1024 dims keep brute-force search fast and memory small. No local model to install or run |
| Host process | **Windows service** on the home machine (auto-start at boot, restart on crash, no console window) + a small tray icon | Always-on without babysitting |
| Remote access | **Tailscale** + **Tailscale Serve** for a real HTTPS address | Android only allows PWA install, service workers, and push on HTTPS. Nothing is exposed to the public internet |

- **ARCH-01** `P0` **Single-user server + PWA client.** As described above. One codebase, two layouts.
- **ARCH-02** `P0` **Server-side generation & jobs.** Every generation runs on the server and is saved as it streams. If the client disconnects, the reply keeps going and is restored on reconnect. *(↳ PocketRisu)*
- **ARCH-03** `P0` **Persistent job queue.** A SQLite table holds background jobs (summaries, extraction, trackers, embeddings, consolidation). Jobs are idempotent, survive restarts, are rate-limited, and are prioritized so user-facing work goes first.
- **ARCH-04** `P0` **Worker threads for CPU work.** Embedding, tokenizing, ranking, and heavy prompt assembly run off the request thread. *(↳ Lumiverse prompt-assembly worker)*
- **ARCH-05** `P0` **Typed schemas end-to-end.** Zod/TypeBox schemas shared by DB, API, and LLM structured outputs. Every model output that feeds state is validated.
- **ARCH-06** `P0` **Live event stream.** SSE/WebSocket for tokens, job progress, and tracker updates, with automatic reconnect and resume.
- **ARCH-07** `P0` **Migrations with auto-backup.** Versioned schema; the DB is backed up before every migration. *(↳ charon, otaku)*
- **ARCH-08** `P0` **Remote access done right.** Localhost-only by default. Remote access goes through Tailscale, using Tailscale Serve's HTTPS address (`https://mea.<tailnet>.ts.net`), which Android needs for PWA install and push. A **QR code pairs each device**, with per-device tokens you can revoke. *(↳ vibe_tavern, PocketRisu)*
- **ARCH-09** `P1` **Host tray icon** (Windows). Shows status (running, jobs, last backup), with "open Mea", "restart", and "view logs".
- **ARCH-10** `P0` **Always-on host setup.** Mea installs as a Windows service that starts at boot and restarts on crash. A setup checklist covers power settings (no sleep or hibernate), Windows Update active hours (so restarts happen overnight), Tailscale, and firewall.
- **ARCH-11** `P1` **Offline-tolerant PWA.** Cached app shell, read-only access to recent chats offline, and sends queued until the connection returns.
- **ARCH-12** `P1` **Embedding model registry.** Each vector records the model and dimension size that made it. If the model changes, Mea detects the mismatch and offers a background re-embed. *(↳ Sonder)*
- **ARCH-13** `P2` **Headless core.** The memory/prompt engine is a separate package from the UI. It can be tested on its own, and could later power a CLI or another UI. *(↳ waidrin)*
- **ARCH-14** `P1` **Single-file distribution.** `bun build --compile` produces one `mea.exe`, which keeps service setup trivial. *(↳ ChungusHub)*
- **ARCH-15** `P0` **Health & reachability.** A `/health` endpoint and a host status page (uptime, disk space, job queue, last backup, NanoGPT reachability). If the server can't be reached, clients show a clear "Mea is unreachable" state with what's cached, instead of failing silently.
- **ARCH-16** `P2` **Self-update** from the tray icon or settings, with an automatic backup first and rollback if the new version fails its health check.

---

## 2. Memory system (MEM)

### 2.1 The Mea Memory Stack

```
                    ┌──────────────────────────────────────────────┐
 AUTHORED CANON     │ Character card · Persona · Lorebooks         │  written by you
                    └──────────────────────────────────────────────┘
                    ┌──────────────────────────────────────────────┐
 L0 LEDGER          │ Every message, every swipe, edits, timestamps│  ground truth, lossless
                    └──────────────────────────────────────────────┘
                                │ derived from (with source links) ▼
 L1 WORKING WINDOW   recent messages, verbatim
 L2 SCENES           one summary per scene (closed scenes only)
 L3 CHAPTERS         one summary per chapter (groups of scenes)
 L4 ARCS + STORY     arc summaries + "Story So Far" (rewritten from L3, not rolled forever)
 L5 MEMORY ATOMS     facts · events · quotes · promises · secrets · preferences (typed, scored)
 L6 ENTITY GRAPH     people · places · things · groups + relationships over time
 ── STATE ──         trackers (scene, characters, relationships, time, threads)
```

**The telescope:** each turn, the prompt holds the *whole story* at decreasing resolution: the Story So Far, the current arc, the current chapter's scenes, the recent messages verbatim, plus a handful of **retrieved** older details and the **current state**. Older material is more compressed, and the total stays within a fixed budget whether the chat has 200 or 20,000 messages.

### 2.2 Foundations

- **MEM-01** `P0` **Message ledger is ground truth.** Stable IDs, real timestamps, in-story timestamps, all swipe variants, and edit history. Nothing derived is stored without a link back to its source message IDs. *(↳ Narrative Engine lossless archive)*
- **MEM-02** `P0` **Telescoping context.** As described above: the whole story is always represented, with older parts more compressed, within a bounded token budget.
- **MEM-03** `P0` **Automatic scene segmentation.** Scene boundaries come from explicit markers (`---`, `***`), time-skip phrases ("three days later"), a location change in the scene tracker, a long real-world pause, or a token cap per scene. An optional LLM check confirms ambiguous boundaries. *(↳ Lumiverse split rules, Narrative Engine timeskip detection)*
- **MEM-04** `P0` **Manual structure controls.** "End scene here", "New chapter", rename chapter, merge/split scenes. Each shows as a divider in the chat.
- **MEM-05** `P0` **One pass, many outputs.** When a scene closes, **one** structured call returns: summary, facts, entities, relationship changes, threads opened/closed, notable quotes (verbatim), importance, and the in-story time span. This is cheaper and more consistent than five separate calls.
- **MEM-06** `P0` **Memory atoms.** Typed records: `event · fact · trait · preference · promise · secret · quote · plan · relationship`. Fields: content, entities involved, importance (1–10), emotion tags, in-story time, source message IDs, witnesses/knownBy, status (`active / superseded / resolved / disputed`), confidence, pinned, user-edited.
- **MEM-07** `P0` **Supersession, not deletion.** A new fact that contradicts an old one *supersedes* it and keeps the history ("Mira's hair: long → short since msg #1834"). This prevents stale facts and makes "what changed?" answerable. *(↳ Narrative Engine semantic dedup)*
- **MEM-08** `P0` **Pinned core memories.** Always included, protected from decay. One tap from any message or memory. *(↳ Narrative Engine pins, HypaV3 `isImportant`)*
- **MEM-09** `P0` **Swipe-aware extraction.** Memory extraction only uses the *accepted* variant. A message is "settled" once you reply after it or after an idle timeout. Swiping never pollutes memory. *(↳ vibe_tavern, Narrative Engine lazy swipes)*
- **MEM-10** `P0` **Edits update memory.** Editing or deleting message #500 marks its scene summary, chapter, Story So Far, and any facts sourced from it as **stale**. Mea re-derives them in the background, or asks first, with a diff preview. *(New. The closest thing in the research is Narrative Engine's rollback cascade.)*

### 2.3 Retrieval

- **MEM-11** `P0` **Hybrid search.** BM25 keyword search (FTS5) + vector similarity + entity overlap + recency + importance, fused with Reciprocal Rank Fusion. Chunk hits lift their parent summary (child-to-parent fusion). *(↳ HypaV3, Sonder, VectFox)*
- **MEM-12** `P0` **Budget slots with rollover.** Pinned memories are taken first. The rest of the memory budget is split into **recent → relevant → serendipity** (default roughly 35 / 50 / 15%), and unused budget rolls over to the next slot. The serendipity slot occasionally surfaces an old memory for a natural callback. *(↳ HypaV3 important/recent/similar/random)*
- **MEM-13** `P0` **Exclusion synced to the window.** Never retrieve what's already verbatim in context. The exclusion window updates automatically with the real window size. *(Improves on ↳ Lumiverse, where it's a separate manual setting.)*
- **MEM-14** `P1` **Smart query building.** The query combines your draft, the last few messages (weighted toward the newest), active entities from the scene tracker, and optionally an LLM-rewritten query. Multiple queries run in one batch. *(↳ Lumiverse query strategies, HypaV3 similarity correction)*
- **MEM-15** `P1` **Diversity (MMR).** Avoid filling the budget with five near-identical memories. *(↳ Lumiverse Cortex)*
- **MEM-16** `P1` **Filter before ranking (POV).** Memories carry witnesses. In *character-bound* mode, things the character never perceived are filtered out *before* ranking, so they can't leak. Defaults follow the chat mode (CHAT-25). **Companion:** the character doesn't recall your persona's private thoughts or off-screen events. **Narrator:** the narrator sees everything, but each NPC's lines are checked against what *that NPC* knows (CON-06). Per-chat toggle. *(↳ Sonder, alex-tavern, Narrative Engine `knownBy`, openvault)*
- **MEM-17** `P1` **Entity-triggered recall.** When an entity is present in the scene or mentioned, its entity card and top facts are pulled in. *(↳ Lumiverse entity context)*
- **MEM-18** `P1` **Salience & emotion.** Emotionally significant moments rank higher. Memories whose emotion matches the current mood get a small boost. *(↳ Lumiverse Cortex, front-porch)*
- **MEM-19** `P1` **Reinforcement & decay.** Memories that are recalled and actually referenced gain weight. Trivial unreferenced ones fade in ranking but are never deleted. Core memories never decay.
- **MEM-20** `P1` **Prefetch while typing.** Retrieval runs speculatively as you type, so pressing Send costs nothing extra. *(↳ Lumiverse prompt-assembly prefetch)*
- **MEM-21** `P1` **Warm on open, never block.** Recall caches are prepared when a chat opens. If an index isn't ready, Mea falls back to recent + pinned memories rather than waiting. *(↳ Lumiverse warmup and fallback)*
- **MEM-22** `P1` **Two-phase deep search.** For very old material: search chapter summaries first, then retrieve specific scenes *verbatim* from the matching chapters. *(↳ Narrative Engine)*
- **MEM-23** `P1` **Librarian pass.** A small, fast model filters retrieved candidates down to what actually matters for this turn. A cheap gate (CONN-14) can score each candidate's relevance. It runs during prefetch so it adds no latency. *(↳ Marinara decision models, Narrative Engine reranking)*
- **MEM-24** `P2` **Agentic recall tool.** With tool-capable models, the main model can call `recall(query)` or `lookup(entity)` mid-generation, with a capped number of calls. *(↳ TunnelVision, timeline-memory)*
- **MEM-25** `P3` **Contrastive recall.** When the story is looping, retrieve *contrasting* material to break the rut. *(↳ Sonder perturbation)*

### 2.4 Entities, relationships, and perspective

- **MEM-26** `P1` **Entity graph.** Auto-extracted people, places, objects, groups, and concepts, each with aliases, description, facts, status (alive/missing/…), and first/last seen. Relationships are directed edges with a label and strength **over time**.
- **MEM-27** `P1` **User edits are protected.** Anything you edit is locked against AI rewrites and "grading". *(↳ Lumiverse Cortex)*
- **MEM-28** `P1` **Alias resolution.** "The stranger" → later named "Kael": aliases link to one entity. One-click merge for duplicates. *(↳ alex-tavern perceived names, Aventuras dedup)*
- **MEM-29** `P1` **Character journals.** A first-person, subjective memory per main character (and important NPCs), condensed over time, with secrets, numbers, and names kept verbatim. *(↳ otaku, alex-tavern, front-porch)*
- **MEM-30** `P1` **Promises ledger.** Promises and commitments made by either side, with status `pending / kept / broken` that you can mark. *(↳ front-porch Promises, Narrative Engine promises & debts)*
- **MEM-31** `P1` **Secrets ledger.** Who knows what, and when it was revealed (linked to the message).
- **MEM-32** `P2` **Growth rings.** Receipt-backed records of how a character has changed (beliefs, traits, the relationship). They form a living overlay on top of the static card. *(↳ front-porch Growth Rings)*
- **MEM-33** `P2` **Sequels with memory.** Start a new chat that inherits a **frozen snapshot** of the previous chat's memory ("Book 2"). This is a continuation, not a branch. *(↳ Lumiverse Vaults)*
- **MEM-34** `P3` **Character-level memory across chats.** Optionally, a character remembers *you* across separate stories (opt-in per character). *(↳ Lumiverse Interlinks, Marinara cross-mode memory)*

### 2.5 Presentation to the model

- **MEM-35** `P0` **Anti-recitation framing.** The memory block tells the model to use memories for consistency, without quoting them or announcing "I remember…".
- **MEM-36** `P1` **Temporal grounding.** Each memory is labeled with its relative in-story time ("3 days ago, at the harbor"). This helps the model with tense, pacing, and callbacks. *(↳ Horae time anchors, Lumiverse Attributed formatter)*
- **MEM-37** `P1` **Formatter styles.** *Prose notes* (continuity briefing), *Attributed* (who remembers, how long ago), *Clinical* bullets, or *Minimal*. Pick per model; some models do better with bullets. *(↳ Lumiverse formatters)*
- **MEM-38** `P1` **Scales with the model.** Budgets are ratios of the model's context. Switching from a 200k to a 32k model collapses the telescope automatically.

### 2.6 Maintenance and tooling

- **MEM-39** `P0` **Memory Inspector.** Browse all layers with search and filters. Edit, pin, delete, merge, or split anything. Click a source to jump to the message. See which replies used each memory.
- **MEM-40** `P0` **Per-reply memory receipt.** An ⓘ on each AI message shows exactly which memories, summaries, lore, and tracker state were in context, with scores and reasons. *(↳ vibe_tavern Prompt Trace)*
- **MEM-41** `P1` **"Remember this" / "That's wrong".** Select text in any message to create, pin, or correct a memory atom in two taps.
- **MEM-42** `P1` **Consolidation ("sleep").** A periodic idle job merges duplicates, compresses low-importance atoms, refreshes entity descriptions, and recomputes arcs. *(↳ Lumiverse consolidation, Aventuras lorebook agent)*
- **MEM-43** `P3` **Backfill imported chats** *(you're starting fresh, so this is only for later)*. Import a 5,000-message SillyTavern chat and Mea builds the whole memory stack in resumable batches, with progress and a **cost estimate before starting**.
- **MEM-44** `P1` **Memory profiles.** *Light / Balanced / Deep* presets, which set extraction frequency, budget sizes, and which helpers run. **Deep is the default.** Advanced mode exposes everything.
- **MEM-45** `P2` **Memory snapshots.** Memory state is versioned at chapter boundaries, so you can roll back if a consolidation goes wrong.
- **MEM-46** `P1` **Memory quiz (personal benchmark).** Mea generates Q&A pairs from the fact ledger and tests whether the current settings and model actually recall them. Gives a score so you can tune settings with data instead of guesswork.

---

## 3. Summarizer (SUM)

- **SUM-01** `P0` **Hierarchical summaries.** Scene → chapter → arc → Story So Far. Each level is built from the level below. *(↳ Aventuras, Narrative Engine sealed chapters, MemoryBooks, timeline-memory)*
- **SUM-02** `P0` **Rebuild, don't roll forever.** The Story So Far is periodically **rewritten from the chapter/arc summaries**, not edited incrementally forever. This prevents the drift that rolling summaries accumulate.
- **SUM-03** `P0` **Dedicated summarizer model** with a fallback chain and timeout. It can be cheaper or faster than the main model. *(↳ vibe_tavern utility models, Lumiverse fallback chains)*
- **SUM-04** `P0` **Structured schema.** What happened · decisions · state changes · relationship shifts · threads opened/closed · **verbatim notable quotes** · in-story time span · location(s) · participants. Stored as structured data and rendered to prose for the prompt. *(↳ Lumiverse Loom Summary categories)*
- **SUM-05** `P0` **Preservation rules.** Names, numbers, codes, promises, and key lines are never paraphrased. *(↳ Narrative Engine, alex-tavern)*
- **SUM-06** `P0` **Settling / message lag.** Only closed scenes are summarized, and the newest K messages are never touched. *(↳ Lumiverse message lag)*
- **SUM-07** `P0` **Background and idle-aware.** Summaries run between turns or when you're idle, never delaying a reply. *(↳ otaku idle trigger, vibe_tavern)*
- **SUM-08** `P0` **Editable and versioned.** Every summary can be edited by hand, has a history with diffs, and can be regenerated with an instruction ("include the argument about the ring").
- **SUM-09** `P0` **Coverage map.** A bar showing which message ranges are covered at which level, with **gaps highlighted**. *(↳ ste_summary_editor gap detection)*
- **SUM-10** `P1` **Compression levels.** *Tight / Balanced / Detailed* per layer. *(↳ Narrative Engine Tight/Smart/Deep)*
- **SUM-11** `P1` **Dramatic-moment tags** that survive re-compression into higher levels. *(↳ Narrative Engine)*
- **SUM-12** `P1` **Verification pass** (on by default). A checker compares the summary against its source messages, flags claims the source doesn't support, and flags high-importance events the summary left out. *(↳ Lore Check, Glaze Studio fact-check)*
- **SUM-13** `P1` **Clean input.** Before summarizing, strip HTML/CSS, status blocks, tracker blocks, and reasoning from the source text. *(↳ Lumiverse context filters)*
- **SUM-14** `P1` **Chapter titles.** Auto-generated, editable, and shown as dividers, in the timeline, and in book export.
- **SUM-15** `P1` **"Previously on…" recap.** When you reopen a chat after a while (configurable, e.g. 6 hours), a short recap card appears. Also available on demand with `/recap`.
- **SUM-16** `P1` **Compression stats.** "1,240 messages · 610k tokens → 9.8k tokens of memory". *(↳ vibe_tavern recovered-context display)*
- **SUM-17** `P1` **Consistent voice.** Summaries use a configurable tense and person (default: past tense, third person, neutral record).
- **SUM-18** `P1` **Editable service prompts** with restore-to-default. Your edits survive app updates. *(↳ otaku, vibe_tavern)*
- **SUM-19** `P1` **Rebuild from scratch** in batches, with a cost estimate, progress, and resume.
- **SUM-20** `P1` **Summarized ≠ hidden.** Summarized messages leave the prompt but stay fully readable in the chat.
- **SUM-21** `P2` **Fold in place.** Select any range of messages and fold it into a summary that sits where the messages were, as a collapsible block. *(↳ Tavern-Doors)*
- **SUM-22** `P1` **Reconcile with trackers.** If the tracker says two days passed, the summary must say so too, and mismatches get flagged.
- **SUM-23** `P2` **Perspective variants.** The same scene pass can also produce per-character journal entries (MEM-29).

---

## 4. Trackers (TRK)

### 4.1 Engine

- **TRK-01** `P0` **Schema-driven trackers.** Trackers are schemas you can define, with typed fields: text, long text, number (min/max), meter (0–100), enum, tags/list, boolean, date/time, duration, entity reference, nested object, and table (list of objects).
- **TRK-02** `P0` **Delta updates.** The tracker model returns only the fields that changed, each with a short reason. Mea validates the patch against the schema and applies it. This is cheaper and avoids hallucinated full rewrites. *(↳ WorldLines Plan→Diff→Validate→Apply)*
- **TRK-03** `P0` **Cheap model, never in the way.** Trackers run on a utility model in parallel with or right after the reply, and never delay reading. *(↳ vibe_tavern, Tracker extension)*
- **TRK-04** `P0` **History tied to message and swipe.** Each snapshot belongs to a message ID and swipe variant. Swiping switches tracker state; editing or deleting rolls it back. *(↳ vibe_tavern variant binding, alex-tavern turn snapshots)*
- **TRK-05** `P0` **Manual edit and lock.** Edit any field. Locked fields are never overwritten by the AI.
- **TRK-06** `P0` **Compact injection.** Only the latest snapshot is injected, as a terse block at a shallow depth. Each field can be set *prompt-visible*, *UI-only*, or *hidden*. *(↳ StatSuite depth-1 injection)*
- **TRK-07** `P0` **Change chips.** Small chips under each AI message: `Trust +5 · kept the promise` · `21:40 → 23:10` · `Harbor → Lighthouse`. Tap for detail. *(↳ front-porch delta chips)*
- **TRK-08** `P1` **Update cadence.** Every message (**default**) / every N / only on scene change / manual. An optional quota-saving gate (CONN-14) skips updates when nothing changed (e.g. pure banter). It's off under maximum accuracy.
- **TRK-09** `P1` **Initial state from the card.** At chat start, the tracker model reads the card and greeting to initialize state. You review it in one sheet.
- **TRK-10** `P1` **Code-owned clock.** In-story time only moves forward unless a flashback is flagged. The model proposes how much time passes; rules clamp it. `/timeskip 3 days` updates the clock, summarizes the gap, and nudges trackers. *(↳ alex-tavern clock, front-porch story clock)*
- **TRK-11** `P1` **Change limits.** Optional caps on how much a meter can move per message ("slow burn"). Big jumps need a clear reason or get flagged. *(↳ AI RPG slow-changing dispositions)*
- **TRK-12** `P1` **Tracker-driven triggers.** Conditions on tracker fields can activate lorebook entries, author's notes, or guidance. Examples: `time_of_day = night`, `trust ≥ 70`, `location = "Mira's house"`. *(↳ Marinara decision gates)*
- **TRK-13** `P1` **Significant changes become memories.** "Relationship status → dating (msg #2210)" is recorded as a memory atom.
- **TRK-14** `P2` **Derived fields.** Computed values such as "days since first meeting" or "time until the wedding".
- **TRK-15** `P2` **Custom render templates.** Sanitized HTML/Markdown templates for how a tracker looks in the panel. *(↳ Tracker extension HTML templates)*

### 4.2 Built-in templates (all optional, toggle per chat or per character)

- **TRK-16** `P0` **Scene.** In-story date and time, time of day, location (hierarchical: city › district › building › room), weather, who is present, positions/posture, ambience.
- **TRK-17** `P0` **Character status** (per present character). Mood and emotions, physical state, outfit/clothing, appearance changes, current goal/intent, and **hidden thoughts** (revealable).
- **TRK-18** `P0` **Relationship** (character ↔ you, plus notable pairs). Affection, trust, respect, attraction, tension, a status label ("strangers → friends → …"), and a milestones log.
- **TRK-19** `P1` **Threads.** Open plot threads, mysteries, foreshadowing, promises, and deadlines, each with a status and an **age** ("opened 340 messages ago").
- **TRK-20** `P1` **Calendar.** Upcoming planned events and appointments, days elapsed, anniversaries.
- **TRK-21** `P1` **Persona status.** Your character's outfit, injuries, mood, and what they carry.
- **TRK-22** `P1` **Possessions & gifts.** Notable items and who has them. *Narrative only, not an inventory game.*
- **TRK-23** `P2` **World.** Season, ongoing events, news, public mood.
- **TRK-24** `P2` **Wardrobe.** Clothes each character owns and wears, with simple day rules ("changes at morning"). *(↳ front-porch wardrobe)*
- **TRK-25** `P2` **Likes & dislikes.** Character tastes that make related events move relationship meters more. *(↳ front-porch)*

### 4.3 Display

- **TRK-26** `P0` **Tracker dock.** A side panel on desktop and a bottom sheet on the phone. Fields are grouped and collapsible.
- **TRK-27** `P1` **HUD strip.** One compact line above the composer showing key fields (`Thu 23:10 · Lighthouse · Mira: wistful`). Tap to expand. *(↳ Marinara HUD)*
- **TRK-28** `P1` **Timeline view.** Sparklines for meters (affection over time), a change log for text fields, and "when did X change?" with jumps to the message.
- **TRK-29** `P1` **Relationship graph view.** Nodes are entities; edges are labeled relationships with strength. *(↳ serene-pub narrative graph)*
- **TRK-30** `P1` **Spoiler mode for hidden fields.** The character's hidden thoughts stay blurred until you tap.
- **TRK-31** `P1` **Thread nudges.** Threads that have gone quiet are offered to the model as *optional* hooks, so forgotten Chekhov's guns resurface naturally. *(↳ Marinara Memory Nag, Loom foreshadowing)*
- **TRK-32** `P1` **Template library.** Duplicate, edit, share as JSON, and set default tracker sets per character (a romance card ships with relationship meters).

---

## 5. Continuity & accuracy safeguards (CON)

- **CON-01** `P0` **Canon hierarchy.** When sources disagree, the order of authority is: your edits > authored canon (card, lorebook) > tracker state > memory atoms > summaries > model improvisation. The prompt marks each block's authority level.
- **CON-02** `P1` **Continuity checker** (post-pass, **on by default**; it flags issues and never auto-rewrites unless you ask). Checks each new reply against trackers and facts: names, eye color, location, time, who knows what. Contradictions are flagged inline **with citations**, with one-click *regenerate with fix* or *accept and update canon*. *(↳ Narrative Engine Lore Check, Marinara Continuity Checker)*
- **CON-03** `P1` **Re-anchor block.** A short constant reminder of who the character is, placed near the end of the prompt, to resist drift in long sessions. *(↳ Lumiverse Weaver re-anchor)*
- **CON-04** `P1` **POV, tense & puppeting guard.** Detects POV/tense switches and the model writing *your* character's actions or dialogue. Flag, auto-trim, or regenerate. *(↳ Lumiverse POV Enforcer, front-porch Anti-Puppet)*
- **CON-05** `P1` **Name registry.** Canonical spellings come from entities and lore. Misspelled names in output are flagged (optional auto-correct).
- **CON-06** `P1` **Knowledge-leak guard.** Flags when a character or NPC references a secret their `knownBy` says they don't know. On by default in Narrator mode, where many NPCs share one voice. *(↳ Narrative Engine, alex-tavern output guard)*
- **CON-07** `P1` **Ask the Archivist.** An OOC side panel where you ask questions about your story ("What did Mira promise in chapter 3?"). Answers come from memory with **citations and jump links**, and never enter the roleplay unless you push them in. *(↳ Narrative Engine Ask GM)*
- **CON-08** `P1` **Story Codex.** An auto-maintained, wiki-like view built from entities, facts, and summaries: cast, places, timeline, threads, relationships. Editable, and edits flow back into memory.
- **CON-09** `P1` **Review inbox.** AI-proposed changes to canon (new lore entries, entity merges, card evolution) arrive in an inbox as diffs you approve, edit, or reject. *(↳ Aventuras diff-before-apply, Story-Editor)*
- **CON-10** `P1` **Drift detector.** Compares the character's recent lines to the card's voice samples (embedding similarity + style stats). Warns when drifting and strengthens the re-anchor automatically.
- **CON-11** `P2` **Repetition watchdog.** Detects recycled phrases and plot beats over the last N messages, then adds a variety nudge or flags them. *(↳ Aventuras style analysis)*
- **CON-12** `P1` **Timeline sanity check.** Flags impossible time jumps relative to the clock.

---

## 6. Context assembly & token budget (CTX)

**Cache-friendly prompt layout** (stable parts first, so a long prefix stays cached across turns):

```
1. System / style rules                         ── changes ~never     ┐
2. Character card + persona + re-anchor          ── changes ~never     │  cached
3. Constant lore                                 ── changes rarely     │  prefix
4. Story So Far + arc + chapter summaries        ── changes per chapter│
5. Chat history (append-only, evicted in chunks) ── appends per turn   ┘
6. ▼ dynamic block at shallow depth ▼
   recalled memories · triggered lore · tracker snapshot · threads · guidance
7. Last user message (+ author's note / directives)
```

- **CTX-01** `P0` **Token budget planner.** Budgets per layer (fixed, story, summaries, recall, lore, trackers, history, response reserve). Simple mode auto-balances; Advanced shows a stacked bar you can drag. **The budget is a target, not the model's maximum.** GLM 5.3 accepts 1M tokens, but filling it would burn your quota and blur the model's attention. The default story prompt target is **~48k tokens**: generous room for the telescope, and with your 60M/week quota it allows ~140 maximum-accuracy turns a day (CONN-19). The planner shows the quota cost of any change. Claude chats are paid per token instead, so their target is set separately (default also 48k, with caching on).
- **CTX-02** `P0` **Context meter** in the composer, with a per-source breakdown on tap. *(↳ vibe_tavern, AstraProjecta)*
- **CTX-03** `P0` **Exact token counts** using the provider's tokenizer where available. Mea also learns each model's real context limit from overflow errors. *(↳ Pyre, ChungusHub corrected counts)*
- **CTX-04** `P0` **Cache-friendly order.** The layout above. Per-turn content goes at shallow depth, after the history, so the long prefix stays cacheable. On NanoGPT, OpenAI, Gemini, and many open-source routes cache **implicitly**, so a stable prefix is all it takes. Claude needs explicit markers (CONN-12).
- **CTX-05** `P0` **Chunked eviction.** When history overflows, drop it in large chunks aligned to already-summarized scenes, not one message per turn. The cached prefix then survives many turns. *(↳ ST-Message-Chunker, Chunk-Dropper)*
- **CTX-06** `P0` **Reasoning handling.** Thinking blocks are collapsed in the UI and never sent back unless the model requires it. *(↳ Glaze, Pyre)*
- **CTX-07** `P1` **Old-message filters.** Strip HTML/CSS, `<details>`, tracker blocks, and reasoning from messages older than depth N. *(↳ Lumiverse context filters)*
- **CTX-08** `P1` **Overflow recovery.** If the provider rejects for length, trim the lowest-priority blocks and retry automatically. *(↳ Pyre)*
- **CTX-09** `P1` **Cache stats.** Hit rate, cached tokens, and money/time saved per chat. Provider-specific cache toggles. *(↳ Sonder per-provider caching)*
- **CTX-10** `P1` **Speculative assembly.** The static prefix plus retrieval are prepared while you type. *(↳ Lumiverse prefetch)*

---

## 7. Lorebooks (LORE)

- **LORE-01** `P0` **SillyTavern World Info compatibility.** Import/export, including books embedded in V2/V3 cards. Supports keys, secondary keys with AND/NOT logic, regex, case and whole-word options, constant entries, order, position/depth, probability, scan depth, recursion, inclusion groups, and sticky/cooldown/delay.
- **LORE-02** `P0` **Scopes.** Global, character, persona, and chat; multiple books per scope. *(↳ NeoTavern, vibe_tavern)*
- **LORE-03** `P0` **Simple vs full editor.** Simple mode is keys + content; full mode has every option. *(↳ vibe_tavern)*
- **LORE-04** `P0` **Activation trace.** Why each entry fired, or why it didn't (no key match, budget exceeded, cooldown…). *(↳ vibe_tavern Prompt Trace)*
- **LORE-05** `P1` **Semantic activation.** Entries can also fire on embedding similarity to the recent context, so lore works without exact trigger words. *(↳ Lumiverse vector ranking, DeepLore)*
- **LORE-06** `P1` **Entity-linked activation.** An entry tied to an entity fires when that entity is present in the scene tracker or recalled, not only when its name appears in text.
- **LORE-07** `P1` **Tracker-conditional activation.** See TRK-12.
- **LORE-08** `P1` **Live typing preview.** As you type, subtle hints show which entries your draft would trigger. *(↳ Loretips)*
- **LORE-09** `P1` **Entry types & templates.** Character, location, item, faction, concept, event, rule, each with suggested fields, aliases, and **secrets with knownBy**. *(↳ Aventuras)*
- **LORE-10** `P1` **Hierarchy.** Folders and nested places (world › region › city › building); a child entry can pull in its parent's essentials. *(↳ Simulith region tree)*
- **LORE-11** `P1` **AI-assisted writing.** Draft an entry from a one-line idea, suggest keys and aliases, condense for token efficiency, rewrite in a consistent style. All changes shown as diffs. *(↳ vibe_tavern)*
- **LORE-12** `P1` **Story-born lore (Chronicle book).** Each chat gets its own auto-maintained book for NPCs, places, and objects *introduced in the story*. Proposals go to the review inbox (CON-09). *(↳ Aventuras lorebook agent, MemoryBooks)*
- **LORE-13** `P1` **Health check.** Flags duplicate keys, overlapping or contradictory entries, entries that never fire, oversized entries, and recursion loops, plus a token cost report.
- **LORE-14** `P1` **Lore budget with priority eviction.** *(↳ vibe_tavern)*
- **LORE-15** `P1` **Glossary highlighting.** Lore terms in messages are subtly underlined; tap one to see its entry.
- **LORE-16** `P2` **Import from documents.** Markdown (split by headings), plain text, PDF, or a wiki URL is chunked into draft entries for review. *(↳ Narrative Engine ingestion, front-porch RAG-lite)*
- **LORE-17** `P2` **Per-chat overrides.** "Always on in this chat" / "muted in this chat" for any entry.
- **LORE-18** `P2` **Version history and undo** for books and entries.
- **LORE-19** `P2` **Reference documents.** Long documents (a novel chapter, a setting bible) are retrieved by meaning or summoned with `#name`, separately from short lore entries. *(↳ Lumiverse Databank)*
- **LORE-20** `P3` **Tool-based lore browsing** for models that support tools. *(↳ TheLibrarian)*

---

## 8. Character creator (CHAR)

### 8.1 Editing
- **CHAR-01** `P0` **Card I/O.** V1/V2/V3 PNG and JSON, plus CHARX. Unknown extension data round-trips untouched. *(↳ Pyre)*
- **CHAR-02** `P0` **Three editor modes.** Structured fields, a single freeform document, or Markdown with **pinned canonical headings** that keep prompt parsing reliable. *(↳ vibe_tavern)*
- **CHAR-03** `P0` **Token counter.** Per field, plus the total of *permanent* tokens (always in the prompt) vs *temporary* (greetings, examples).
- **CHAR-04** `P0` **Edit history.** Undo and restore any earlier version of a card.
- **CHAR-05** `P0` **Images.** Upload, crop, multiple avatars/outfits in a gallery, and an automatically extracted accent palette for theming. *(No generation.)*
- **CHAR-06** `P1` **Versions & variants.** Base / alternate outfit / AU versions of one character, without duplicating the card. *(↳ vibe_tavern, ChungusHub)*
- **CHAR-07** `P1` **Tags, folders, favorites, notes, source link, creator notes.**

### 8.2 AI Co-Author Studio
- **CHAR-08** `P1` **Interview-first creation.** *Dream* (your idea in your own words) → *Read-back* (what the AI understood, and what it still needs) → *Interview* (one pointed question at a time, each with a note on *why* it's asking) → *Bible* (one source of truth, checked for genericness, coherence, and tension) → *Render* (each field written from the Bible) → *Review* (accept, edit, or re-render each field). *(↳ Lumiverse Dream Weaver)*
- **CHAR-09** `P1` **Your words first.** Mea tracks whose words each fact came from. Phrases you typed verbatim carry the most weight. *(↳ Weaver)*
- **CHAR-10** `P1` **Stuck helpers.** *Show me directions* (three genuinely different options you can steer: "darker", "stranger") and *Extend my answer* (pushes your draft further while keeping your words). *(↳ Weaver)*
- **CHAR-11** `P1` **Field-level AI actions.** Expand, condense, rewrite in a style, convert W++/brackets to prose, fix POV/tense, or a **surgical edit** from an instruction. Always shown as a diff you accept fully or in parts. *(↳ Pyre, NeoTavern Magic Rewrite, vibe_tavern Co-Author)*
- **CHAR-12** `P1` **Import messy notes.** Paste notes and the AI sorts them into fields, explaining where each piece went. *(↳ vibe_tavern AI parser)*

### 8.3 Quality
- **CHAR-13** `P1` **Quality checks.** Genericness detector (overused names, tropes, purple-prose phrases), contradictions between fields, missing essentials (voice, motivation, flaw, what they want from {{user}}), anti-puppet check on greetings (no writing {{user}}'s actions), POV/tense consistency. *(↳ front-porch editor passes, Weaver quality gate)*
- **CHAR-14** `P1` **Voice lab.** Generate sample lines across situations (calm, angry, flirting, scared, lying). You keep the ones that sound right; they become example dialogue and a "voice fingerprint" used by the drift detector (CON-10).
- **CHAR-15** `P1` **Greeting workshop.** Multiple alternate greetings, a rewrite into a consistent POV/tense, and scenario variants. *(↳ writers-guild greeting rewrite)*
- **CHAR-16** `P1` **Test bench.** A temporary sandbox chat (not saved, not a branch) with quick probes ("introduce yourself", "react to bad news") to check the voice before playing.
- **CHAR-17** `P1` **Built-in governance.** A card can carry its own small rules/re-anchor block, so it plays well without a special preset. *(↳ Weaver rules book)*
- **CHAR-18** `P1` **Companion lorebook builder.** From the card, draft a linked lorebook: backstory, people in their life, places they know. *(↳ front-porch three-stage lorebook, Weaver depth book)*
- **CHAR-19** `P2` **Evolution proposals.** After a long story, Mea proposes card updates (or an overlay) based on growth rings, as a diff. The original card is never overwritten. *(↳ front-porch AI Enhance, Marinara Card Evolution Auditor)*
- **CHAR-20** `P2` **Profile page.** A beautiful read-only page: portrait, signature quote, traits, relationships, stories played.
- **CHAR-21** `P2` **Import by URL.** Paste a card-site link to import directly.

---

## 9. Persona creator (PER)

- **PER-01** `P0` **Multiple personas.** Name, avatar, pronouns, appearance, personality, background.
- **PER-02** `P0` **Smart defaults.** A global default persona, a per-character default, and a per-chat override.
- **PER-03** `P1` **Persona lorebooks.** *(↳ TipsyTavern, Lumiverse)*
- **PER-04** `P1` **Same studio and tools as characters.** Interview mode, field AI actions, quality checks. *(↳ Weaver persona build)*
- **PER-05** `P1` **Persona variants.** Outfits, eras, alternate selves.
- **PER-06** `P1` **Character → persona** in one tap. *(↳ Pyre, Mignon)*
- **PER-07** `P1` **Persona state tracker** (TRK-21).
- **PER-08** `P2` **Pair notes.** Per persona × character: "how they know each other", carried into every chat with that pair.
- **PER-09** `P2` **Your writing voice.** A short sample of how *you* write, so Impersonate and "Expand my message" sound like you.

---

## 10. Chat & generation (CHAT)

- **CHAT-01** `P0` **Streaming** with smooth rendering, stop, and continue.
- **CHAT-02** `P0` **Swipes.** Alternatives for the latest AI message, each with metadata (model, preset, tokens, time). Gesture on the phone, arrow keys on desktop. **Side-by-side compare.** *(↳ AstraProjecta revision compare)* Not branches.
- **CHAT-03** `P0` **Regenerate with feedback.** An optional one-line note explaining why ("more dialogue", "slower", "she wouldn't say that") is injected as OOC for that attempt. *(↳ Lumiverse Regen Feedback)*
- **CHAT-04** `P0` **Edit, delete, hide-from-context** (stays visible but isn't sent).
- **CHAT-05** `P0` **Impersonate** (drafts your message in your persona's voice) and **Expand my message** (turns shorthand into prose before sending).
- **CHAT-06** `P0` **Survives disconnects** (ARCH-02), with a **push notification** when a reply is ready. *(↳ PocketRisu, Glaze)*
- **CHAT-07** `P0` **Rendering.** Markdown and dialogue highlighting: "speech" in a dialogue color, *actions* in italics, thoughts styled distinctly. Sanitized, scoped HTML/CSS for cards that use it. *(↳ front-porch, charon)*
- **CHAT-08** `P0` **Message action menu.** Copy, edit, delete, hide, bookmark, remember (MEM-41), ask about this (CON-07), view context (MEM-40).
- **CHAT-09** `P1` **Director mode.** Your message is a stage direction, not in-character text ("She hesitates. Focus on the scratches on the door."). Auto-continue mode when the character spoke last. *(↳ Lumiverse Sovereign Hand)*
- **CHAT-10** `P1` **OOC notes vs cues.** `/ooc` = a standing note that persists; `/cue` = a one-time nudge for the next reply. *(↳ otaku)*
- **CHAT-11** `P1` **Guidance chips.** Reusable instructions toggled from the composer, one-shot or persistent, that can auto-activate per chat or character. *(↳ Lumiverse Guided Generation)*
- **CHAT-12** `P1` **Length & pacing toggles.** Short / normal / long; slow / normal / fast. Quick switches, no preset editing.
- **CHAT-13** `P1` **Story settings per chat.** Genre, tone, POV, tense, narration style, content intensity, response length, language, compiled into the prompt. *(↳ Aventuras narrative settings)*
- **CHAT-14** `P1` **Auto-continue on cut-off** and trimming of an unfinished last sentence.
- **CHAT-15** `P1` **Slash commands** with a palette: `/ooc /cue /scene /chapter /timeskip /recap /remember /ask /pin`.
- **CHAT-16** `P1` **Rewind.** "Delete everything after this message." The deleted messages go to the trash and can be undone. A linear alternative to branches.
- **CHAT-17** `P1` **Drafts sync across devices.** Start a message on the PC, finish it on the phone. *(↳ ChungusHub)*
- **CHAT-18** `P1` **Search** within a chat and across all chats, with jump-to and highlight.
- **CHAT-19** `P1` **Banned phrases.** A personal list with auto-replace or auto-regenerate, starting from a sensible "slop" list.
- **CHAT-20** `P1` **Timestamps.** Real and in-story, plus word count, on hover or long-press.
- **CHAT-21** `P2` **Image attachments for vision models.** Show the character a photo. For non-vision models, Mea falls back to a caption. *(Uploads, not generation.)* *(↳ SweetrollLM, Narrative Engine)*
- **CHAT-22** `P2` **Narrator on demand.** A one-off environmental or narrator message without adding a narrator character. *(↳ serene-pub)*
- **CHAT-23** `P2` **Private message notes.** Annotations on a message that are never sent to the model.
- **CHAT-24** `P2` **Generation queue.** Queue multiple requests. *(↳ vibe_tavern)*

### Chat modes: Companion & Narrator

- **CHAT-25** `P0` **Per-chat mode.** *Companion* (1-on-1 with one character) or *Narrator* (the card narrates a world with many NPCs). The mode is auto-detected when the chat is created, using card heuristics plus a cheap gate (CONN-14), and can be switched anytime. Each mode sets its own defaults:

  | | Companion (default) | Narrator |
  |---|---|---|
  | Memory perspective (MEM-16) | Character-bound: no knowledge of your private thoughts or off-screen events | Omniscient narrator + per-NPC knowledge |
  | Trackers | Scene, Character status (one character), **Relationship**, Persona status | Scene with full **present-characters** list, per-NPC mini status, Threads, Calendar |
  | Entity graph & Chronicle lorebook (LORE-12) | On, quiet | On, prominent: new NPCs/places are proposed automatically |
  | Journals (MEM-29) | The character's journal | Journals for recurring NPCs |
  | Knowledge-leak guard (CON-06) | On | On, stricter |
  | Re-anchor (CON-03) | The character's identity | The narrator's voice & rules + the world's tone |

- **CHAT-26** `P1` **Cast panel** (Narrator mode). A roster of NPCs met so far: portrait (if uploaded), one-line description, status, location, relationship to your persona, and last seen (with a jump link). Tap to open the entity card; pin an NPC to keep them in context.
- **CHAT-27** `P1` **NPC voice notes.** Each NPC entity can hold speech notes (accent, verbal tics, formality). They're injected only when that NPC is present, so 20 NPCs don't blur into one voice.

---

## 11. Steering & writing quality (STEER)

- **STEER-01** `P1` **Advisor pass ("council-lite").** Before generating, a cheap model writes a short private plan: the direction, beats to hit, threads worth touching, continuity reminders. The plan is injected as guidance. Opt-in per chat, and run during typing prefetch so it adds no wait. *(↳ Lumiverse Council, Marinara Narrative Director)*
- **STEER-02** `P1` **Advisor memory.** The advisor sees its own last few plans, so long-term plotting stays coherent. *(↳ Lumiverse historical deliberations)*
- **STEER-03** `P1` **Post-pass editor** (opt-in). Minimal fixes for POV slips, puppeting, banned phrases, and formatting, shown as a diff. *(↳ SillyBunny post-generation, Prose Guardian)*
- **STEER-04** `P1` **Style profile per chat.** A prose style guide, banned words, formatting preferences (asterisks or plain), and dialogue punctuation.
- **STEER-05** `P2` **Pacing awareness.** The advisor knows when tension has been flat for many messages and which threads are dormant.
- **STEER-06** `P2` **Writing stats.** Repetition rate, average length, dialogue/narration ratio per model, kept locally for your own tuning.
- **STEER-07** `P2` **Minimal hook framework.** Three fixed hook points (pre-generation, post-generation, background), each with its own model, prompt, schema, and budget. Off by default, and *not* a plugin marketplace. *(↳ SillyBunny's 4 stages, Marinara custom agents)*

---

## 12. Prompts & presets (PROMPT)

- **PROMPT-01** `P0` **Block-based prompt builder.** Ordered blocks (system, card fields, persona, lore, memory layers, trackers, history, author's note, post-history, prefill). Drag to reorder, toggle on/off, set role/position/depth per block.
- **PROMPT-02** `P0` **Simple vs Advanced.** Simple mode is a few curated presets and sliders. Advanced mode is the full builder.
- **PROMPT-03** `P0` **Macros.** Standard ones (`{{char}} {{user}} {{time}} {{random}} {{roll}} {{if}}…{{/if}}`, variables) plus Mea's own: `{{storySoFar}} {{chapter}} {{scenes}} {{recall}} {{tracker::Scene}} {{threads}} {{entities}} {{promises}}`.
- **PROMPT-04** `P0` **Author's note** per chat (depth, frequency).
- **PROMPT-05** `P0` **Import SillyTavern presets.** Best-effort, with a report of anything unsupported.
- **PROMPT-06** `P1` **Layered overrides.** Global → character → chat.
- **PROMPT-07** `P1` **Preset controls.** A preset can expose a few friendly switches ("More dialogue", "NSFW allowed", "Slow burn") without opening the builder. *(↳ ChungusHub Preset Controls, Focus preset variables)*
- **PROMPT-08** `P1` **Regex scripts.** Display-only, prompt-only, or persistent, with a live tester. *(↳ vibe_tavern)*
- **PROMPT-09** `P1` **Service prompt profiles.** Every helper prompt (summarizer, extractor, tracker, checker, advisor) is editable, restorable, and switchable as a set. Your edits survive updates. *(↳ vibe_tavern, otaku)*
- **PROMPT-10** `P1` **Per-model settings.** Prefill and reasoning effort per model.
- **PROMPT-11** `P2` **Preset cards.** Export presets as shareable PNGs with art. *(↳ ChungusHub)*

---

## 13. Models & connections (CONN)

- **CONN-01** `P0` **Providers.** **NanoGPT** as the first-class provider (`https://api.nano-gpt.com/api/v1`), plus generic connections for anything else. Your **LinkAPI** is the first of these. Generic connections speak OpenAI Chat Completions, or Anthropic Messages for Claude (CONN-23). No Gemini adapter.
- **CONN-02** `P0` **Connection profiles.** Model, samplers, context size, reasoning, and caching per profile.
- **CONN-03** `P0` **Per-task routing.** *Main · Summarizer · Extractor · Tracker · Checker/Advisor · Embeddings*, each with its own profile. *(↳ Narrative Engine roles, Aventuras Agent Profiles, serene-pub)* **On a subscription, quota counts input tokens whatever the model, so a weaker helper saves nothing.** Mea uses the *strongest* subscription model where speed doesn't matter and a *fast* one where it does. Defaults (all in your subscription as of 2026-10-08, all with structured output):

  | Task | Default | Why |
  |---|---|---|
  | Story | **GLM 5.3** (subscription), or **Claude** via NanoGPT or LinkAPI (pay-as-you-go, cached; CONN-12) | Your choice per chat |
  | Summarizer · verification · consolidation · Codex | **GLM 5.3 (thinking)** | Runs in the background, so accuracy beats speed |
  | Tracker · extractor · gates · librarian · checker | **GLM 5.3 Flash** | Runs right after each reply, so speed matters; 1M context |
  | Fallback | **DeepSeek V4 Flash** | A different model family, in case GLM routes have an outage |
  | Embeddings | `text-embedding-3-large` @1024 | Pay-as-you-go key |
- **CONN-04** `P0` **Encrypted keys.** Keys are encrypted at rest, masked in the UI, and never sent back to the client. *(↳ SweetrollLM, Lumiverse)*
- **CONN-05** `P1` **Fallback chains** per task, with timeouts. *(↳ Lumiverse)*
- **CONN-06** `P0` **Capability registry.** Context length, caching type, tool support, vision, and reasoning format, auto-detected or taken from provider metadata. *(↳ Lumiverse capability metadata)*
- **CONN-07** `P1` **Quick model switcher** in the chat header, with starred favorites. Each model shows a small billing badge: *subscription* · *NanoGPT pay-as-you-go* · *LinkAPI*. Switching models mid-chat is safe because memory is model-agnostic. *(↳ Marinara, vibe_tavern)*
- **CONN-08** `P0` **Usage tracking.** Input/output tokens per chat, per task, and per day, measured against your subscription quota (CONN-19). Pay-as-you-go spend (embeddings, Claude) is shown for information only. **No spending alerts.** *(↳ NeoTavern usage tracker, Glaze stats)*
- **CONN-09** `P1` **Smart retry.** Handles empty outputs, refusals, and 5xx errors with backoff and an optional fallback model. *(↳ Pyre)*
- **CONN-10** `P2` **Sampler preset library** per model family.

### NanoGPT specifics

From NanoGPT's API docs (checked 2026-10-08):

- **CONN-11** `P0` **Model catalog sync.** `GET /api/v1/models?detailed=true` returns each model's context length, max output tokens, capability flags (`vision`, `reasoning`, `tool_calling`, `structured_output`), and per-million-token pricing. This feeds the capability registry (CONN-06), budget planner (CTX-01), and cost tracking. The helper-model pickers only list models with `structured_output`.
- **CONN-12** `P1` **Caching strategy per model.**
  - *GLM and other subscription models* (implicit caching): no flags at all. Mea keeps the prefix stable (CTX-04/05), and NanoGPT's cache-affinity routing keeps you on the same upstream provider. Mea **never** adds explicit cache controls, `caching: true`, or a forced provider to subscription requests, because NanoGPT bills those as pay-as-you-go. (On a "Subscription only" key they would simply fail.)
  - *Claude on NanoGPT* (not in the subscription, so always pay-as-you-go): Mea sends NanoGPT's `prompt_caching` helper (`enabled`, `ttl` 5m or 1h, `cutAfterMessageIndex` at the end of the stable prefix) through Key B. Cached input costs up to ~90% less, and there's no subscription coverage to lose.
  - *Claude on LinkAPI:* Mea uses the Anthropic Messages format (CONN-23) with native `cache_control` breakpoints: one after the stable prefix (system + card + summaries) and one at the end of the history. The 1h TTL is used when you tend to pause between turns. Whether the gateway really honors this is checked by the cache probe (CONN-24).
  - Price-based routing (`:price`, `provider.sort: "price"`) overrides cache affinity, so Mea never uses it for the story model.
  - Cache writes and reads are checked from the response usage fields, not assumed.
- **CONN-13** `P0` **Subscription-first operation.** Every story and helper call goes to a **subscription-included** model, picked from `GET /api/subscription/v1/models?detailed=true` (the model pickers only show these unless you choose otherwise). Mea reads `GET /api/subscription/v1/usage` for daily/weekly input-token quotas, reset times, and `routing.recommendedMode`, and shows a small quota ring in the header.
- **CONN-14** `P1` **Cheap gates.** Small yes/no checks run as tiny structured prompts on **GLM 5.3 Flash** (subscription, a few hundred input tokens each). NanoGPT's dedicated decision models (`POST /api/v1/decisions`, calibrated probabilities) are *not* in the subscription, so they're an optional upgrade on the pay-as-you-go key (fractions of a cent). The gates:
  - Did this message end the scene? (MEM-03)
  - Did any tracked state change? (TRK-08)
  - Is this memory candidate relevant? (MEM-23)
  - Does this reply contradict fact X? A quick screen before the full continuity checker (CON-02).
  - Was the reply cut off, or is it a refusal? (CHAT-14, CONN-09)
  - Is this card a narrator card? (CHAT-25)
- **CONN-15** `P2` **Pay-as-you-go spend view.** Per-request cost for the pay-as-you-go parts (embeddings, Claude), plus your NanoGPT balance, shown quietly in settings. Informational only, no alerts.
- **CONN-16** `P1` **Reasoning controls per task.** `reasoning_effort` per profile, e.g. high for the main story and low for helpers. `reasoning.exclude` hides reasoning output when you don't want to see it. (NanoGPT returns an error if you try to turn reasoning *off* on models that require it, so Mea hides it instead.)
- **CONN-17** `P0` **Two-key setup.** In NanoGPT's dashboard you create two API keys:
  - **Key A, billing mode "Subscription only":** used for the story (GLM) and all helpers. NanoGPT guarantees it **can never spend your balance**, so a bug or a wrong setting can't cost money; it fails instead.
  - **Key B, pay-as-you-go:** used only for embeddings (and Claude, if you use it through NanoGPT).

  Mea assigns a key per task and labels every request in the request history with its billing path.
- **CONN-18** `P2` **Compressed requests.** Send long prompts gzip-compressed (`Content-Encoding: gzip`) for faster uploads from the host.
- **CONN-19** `P0` **Quota planner.** Reads your quota from NanoGPT: **60M input tokens/week** (≈ 8.5M/day on average), plus any daily limit if your plan has one. It measures the input tokens of an average turn (story prompt + every helper) and shows **"≈ N turns/day at current settings"**, broken down by feature. Estimates for maximum-accuracy mode with GLM as the story model:

  | Per turn | 32k story target | **48k (default)** | 64k |
  |---|---:|---:|---:|
  | Story prompt | 32k | 48k | 64k |
  | Tracker + gates + librarian + checker | ~11.5k | ~11.5k | ~11.5k |
  | Scene summaries, extraction, verification, consolidation (spread across turns) | ~1.5k | ~1.5k | ~1.5k |
  | **Total input per turn** | **~45k** | **~61k** | **~77k** |
  | **Turns per week (60M)** | **~1,330** | **~980** | **~780** |
  | **≈ per day** | ~190 | **~140** | ~110 |

  Each **swipe** costs another full story prompt, so a heavy-swipe day uses quota faster. The planner counts swipes separately. **Weekly pacing:** a gentle hint appears if you're well ahead of an even pace (e.g. 70% used by day 3), with the reset time. If cached tokens turn out not to count (CONN-22), these numbers improve.
- **CONN-20** `P0` **Graceful quota degradation.** As the weekly quota (or a daily one, if present) nears its limit (default: 90% used, configurable), Mea sheds optional helpers in a fixed, visible order: advisor → librarian → drift detector → continuity checker → summary verification. Trackers, the summarizer, and the story reply are kept to the end. If the quota is exhausted, Mea says so plainly, with the reset time. It offers to continue on Claude/Key B **only if you tap**, and never switches billing silently.
- **CONN-21** `P0` **Compact helper inputs.** Helpers never receive the full story prompt. Each gets a purpose-built minimal context, and its input size is shown in the job monitor:

  | Helper | Gets | Typical input |
  |---|---|---|
  | Tracker | Current state + the last exchange | ~2–4k |
  | Gates | One question + the relevant snippet | ~0.3–1k |
  | Continuity checker | The new reply + the facts it touches | ~3–5k |
  | Librarian | The draft + candidate memory snippets | ~2–4k |
  | Scene summary + extraction | One closed scene + the entity list (once per scene) | ~5–10k |

- **CONN-22** `P1` **Quota calibration.** NanoGPT's docs don't say whether cached input tokens count toward the subscription quota. Mea measures it on your account (quota change vs. reported cached tokens) and adjusts its estimates. If cache hits are discounted, Mea can afford a larger story prompt.
- **CONN-23** `P1` **Anthropic Messages format** for generic connections. Sends `/v1/messages` requests with native system blocks, `cache_control` breakpoints, and thinking parameters, for Claude on LinkAPI (whose *New API* gateway exposes this endpoint). OpenAI-format conversion inside gateways can drop Claude-specific fields, so the native format is the reliable path.
- **CONN-24** `P1` **Cache probe.** When a connection and model is added, and again weekly, Mea sends the same long prefix twice and reads the usage fields (`cache_read_input_tokens`, `cache_creation_input_tokens`, or `prompt_tokens_details.cached_tokens`). It records whether caching works, which format and marker placement achieved it, and the observed hit rate. The model picker shows ✓ *caching verified* or ⚠ *no caching detected*.

> Not used, on purpose: NanoGPT's own *Context Memory* (`:memory`), because Mea's memory must stay the inspectable source of truth and double compression would hide what the model sees. Also not used: web-search suffixes (`:online`), image/video/TTS endpoints, the `X-Billing-Mode: paygo` override, and `X-Provider` on subscription requests.

---

## 14. UI design & aesthetics (UI)

**Design direction: cozy pastel.** Warm, soft, and comforting, like a reading nook with tea. Cream paper, plum-cocoa ink, and pastel accents (rose, lavender, mint, peach, butter, sky). Rounded shapes, soft shadows, gentle motion. The story text stays the hero: pastels go on surfaces and accents, never on body text, so readability holds.

**Default themes (contrast-checked, all text pairs pass WCAG AA):**

| Token | **Mea Cozy** (light) | **Cozy Night** (dark) | Notes |
|---|---|---|---|
| `--bg` | `#FBF6F1` warm cream | `#231E2A` plum night | |
| `--surface` / `--surface-2` | `#FFFDFB` / `#F6EDE7` | `#2D2635` / `#362E40` | cards / panels |
| `--border` | `#EADDD5` | `#463C52` | |
| `--text` | `#43363D` plum-cocoa (10.7:1) | `#F2E8EE` (13.6:1) | never pure black/white |
| `--text-muted` | `#76646D` (5.1:1) | `#B9AAB4` (7.3:1) | narration/actions |
| `--dialogue` | `#9C3F63` deep rose (5.7:1 on tint) | `#F2A7BF` (7.7:1) | "speech" |
| `--thought` | `#6650A8` lavender ink (5.7:1) | `#C9B9F2` (8.1:1) | inner thoughts |
| `--accent` | `#E7A1B5` rose (dark text on it: 5.5:1) | `#F0B3C5` | buttons, highlights |
| pastels | lavender `#C7B8EC` · mint `#B5E0CF` · peach `#F7CBB2` · butter `#F5E3A6` · sky `#B7D3EE` | slightly deeper variants | tracker chips, tags, meters |
| speaker tints | character `#FDF0F3` (rose) · you `#F4F0FC` (lavender) | `#33293A` · `#2E2A3D` | message card backgrounds |

**Type:** *Nunito* for the UI (rounded, friendly, very legible), *Lora* or *Literata* for story text (warm and readable at length), *Fraunces* with its "soft" setting for headings and chapter titles. All fonts are self-hosted, with no font CDN. **Shape:** 16px card radius, pill buttons, rounded-square avatars, soft diffuse shadows.

- **UI-01** `P0` **Typography first.** The type stack above, with generous line height (~1.65), a comfortable reading width (~65–75 characters), and slightly larger default text on the phone.
- **UI-02** `P0` **Design tokens.** All color, type, spacing, radius, and motion values are CSS variables. A theme is just a token set. Light and dark follow the system setting.
- **UI-03** `P0` **Two polished defaults first.** *Mea Cozy* and *Cozy Night*, following the system light/dark setting, each with a contrast check in CI. Then a theme editor with live preview and JSON import/export (`P1`). *(↳ Glaze shareable themes)*
- **UI-04** `P0` **Three-pane desktop.** Library/Chats (left) · Story (center) · Context dock (right: Trackers / Memory / Lore / Notes). All panes are collapsible and resizable, and the layout is remembered.
- **UI-05** `P0` **Chat display styles.** *Cards* (**default**: soft rounded blocks tinted per speaker, with a rounded avatar), *Book* (flowing prose, small portrait in the margin), and *Bubbles* (messenger-style).
- **UI-06** `P0` **Calm status indicators.** The context meter, plus one small activity pulse for background work ("weaving memories…"). Nothing blinks or nags.
- **UI-07** `P0` **Keyboard shortcuts.** Send, swipe (← →), regenerate, edit last, stop, search, command palette.
- **UI-08** `P1` **Per-character ambience.** Accent color taken from the avatar's palette; optional chat background with blur, dim, and vignette controls; separate opacity for text panels so art never hurts readability. *(↳ AstraProjecta per-session appearance, SweetrollLM)*
- **UI-09** `P1` **Chapter & scene dividers.** Elegant dividers with chapter titles and in-story time. A small scene header (location · time · who's present) comes from the tracker.
- **UI-10** `P1` **Timeline scrubber.** A thin minimap on the chat's edge with chapter marks, bookmarks, and key moments. Drag to jump anywhere in a 10,000-message story.
- **UI-11** `P1` **Who's-who popovers.** Tap or hover a name in a message to see the entity card: portrait, key facts, relationship, last seen.
- **UI-12** `P1` **Command palette** (Ctrl/Cmd+K) for chats, characters, settings, and actions. *(↳ charon, SillyBunny global search)*
- **UI-13** `P1` **Meaningful motion.** Messages fade in, drawers move with springs, tokens stream in smoothly. 60 fps, and it respects reduced-motion settings. *(↳ charon streaming fade)*
- **UI-14** `P1` **Home screen.** A *Continue* hero card (portrait, chapter title, recap line, last message), recent stories, favorites, and quick start.
- **UI-15** `P1` **Reading mode.** All chrome hidden, book-like pages, adjustable size and width. For rereading your story.
- **UI-16** `P1` **Typography controls.** Story and UI fonts, size, line height, paragraph spacing, text width, and dialogue color.
- **UI-17** `P1` **Onboarding in three steps:** connect a model → import or create a character → start. Every empty screen explains itself.
- **UI-18** `P1` **One icon set** (e.g. Lucide/Tabler), consistently sized.
- **UI-19** `P1` **Accessibility.** Contrast-checked themes, visible focus, screen-reader labels, font scaling, and an optional dyslexia-friendly font. *(↳ serene-pub Document View)*
- **UI-20** `P1` **Discreet mode.** One tap blurs avatars, chat previews, and notification text, for privacy in public.
- **UI-21** ~~i18n-ready strings~~ **Dropped:** Mea is English-only.
- **UI-22** `P2` **Cozy touches.** Optional paper grain, little doodle dividers between chapters, and a drop cap in Fraunces at chapter starts.
- **UI-23** `P2` **Custom CSS** for power users, safely scoped, with snippets.
- **UI-24** `P1` **Small delights.** Optional and subtle: a tiny sparkle when a memory is saved, a heart pop on bookmark, a soft "page turn" at chapter dividers, a gentle breathing dot while the character "thinks". All of them respect reduced motion.
- **UI-25** `P1` **Friendly empty states.** Simple pastel illustrations with one helpful line ("No stories yet. Let's meet someone ✿").
- **UI-26** `P2` **More themes later.** For example *Ink & Lamplight* (literary), *Sakura*, *Matcha*, *Midnight*, *OLED Black*. Each is just a token set.

---

## 15. Phone experience (MOB)

- **MOB-01** `P0` **Designed for the phone,** not shrunk from desktop. *(↳ Neconyan, Pyre thumb-first, vibe_tavern)*
- **MOB-02** `P0` **Bottom composer.** Keyboard-aware and safe-area-aware, with the send button within thumb reach.
- **MOB-03** `P0` **Gestures.** Swipe the last AI message sideways for alternatives; swipe from the edges to open Library or the Context dock; long-press a message for its action sheet.
- **MOB-04** `P0` **Bottom sheets** for trackers, memory, and lore, with snap points. *(↳ AstraProjecta Vaul drawers)*
- **MOB-05** `P0` **Installable PWA.** App icon, splash screen, standalone mode, and share-target support (share a card PNG to Mea to import it).
- **MOB-06** `P0` **Push notifications** when a reply or a long job finishes. *(↳ Lumiverse push, Glaze)*
- **MOB-07** `P1` **Roleplay symbol bar** above the keyboard: `" "` · `* *` · `( )` · `—` · `…` · OOC. *(↳ Synapse Engine)*
- **MOB-08** `P1` **HUD chips** above the composer (TRK-27).
- **MOB-09** `P1` **Haptics** for swipe ticks and send (Android).
- **MOB-10** `P1` **Smooth long-chat scrolling.** Pull up to load older messages; a jump-to-latest button with an unread count.
- **MOB-11** `P1` **App lock.** PIN, or biometrics via WebAuthn.
- **MOB-12** `P1` **Data-light mode** on cellular: small thumbnails, avatars loaded lazily.
- **MOB-13** `P1` **Offline reading and queued send** (ARCH-11).
- **MOB-14** `P0` **Android-first details.** Installed from Chrome as a PWA (with a proper maskable icon and theme color), with Web Push, share-target, and vibration, all over the Tailscale HTTPS address (ARCH-08). Test on a real mid-range Android phone, not just desktop emulation. *(iOS isn't a target.)*

---

## 16. Library & organization (LIB)

- **LIB-01** `P0` **Character library.** Grid and list views, search, tags, folders, favorites, and sorting (recent, name, created).
- **LIB-02** `P0` **Chats per character.** Title, last-line snippet, message count, current chapter, last played.
- **LIB-03** `P0` **Archive & trash.** Soft delete with ~30-day retention and restore, so nothing is lost by accident.
- **LIB-04** `P1` **Auto-titled chats** from the Story So Far (editable), with an optional cover image.
- **LIB-05** `P1` **Global search** across chats, characters, lore, and memories (FTS5).
- **LIB-06** `P1` **Collections** ("Ongoing", "Finished", "Favorites", or your own).
- **LIB-07** `P1` **Story stats.** Messages, words, tokens, cost, time spent, days active. *(↳ Glaze statistics)*
- **LIB-08** `P2` **Bulk actions.** Tag, export, archive.

---

## 17. Performance (PERF)

- **PERF-01** `P0` **Budgets, checked in CI.** Targets: cold start under 1.5 s on a mid-range phone; open a 10k-message chat to first paint under 300 ms; input latency under 50 ms; chat route JS under ~250 KB gzipped.
- **PERF-02** `P0` **Virtualized message list** with dynamic heights and paginated database reads. Only what's visible is rendered. *(↳ TauriTavern virtualized DOM, Lumiverse react-virtual)*
- **PERF-03** `P0` **Cheap streaming render.** Tokens append only to the active message, batched per animation frame, with incremental Markdown parsing.
- **PERF-04** `P0` **SQLite done right.** WAL mode, prepared statements, proper indexes, and no heavy ORM. *(↳ Lumiverse)*
- **PERF-05** `P0` **Request path never waits on background jobs.** Heavy CPU work runs in workers (ARCH-04).
- **PERF-06** `P1` **Caches.** Static prompt prefix, embeddings keyed by content hash, tokenizer results, and recall results. *(↳ Lumiverse embedding/tokenizer caches)*
- **PERF-07** `P1` **Incremental indexing.** Only new or changed chunks are embedded.
- **PERF-08** `P1` **Image pipeline.** WebP thumbnails at a few sizes, loaded lazily. *(↳ Lumiverse sharp thumbnails)*
- **PERF-09** `P1` **Code splitting.** Editors (CodeMirror etc.) load only when opened.
- **PERF-10** `P1` **Timing breakdown** for every generation: assembly ms, retrieval ms, time to first token, tokens/s, cache hit.
- **PERF-11** `P1` **Streamed bulk import.** Importing 5k messages never freezes the UI.
- **PERF-12** `P2` **Low-power mode** for small servers (e.g. a Raspberry Pi): API embeddings instead of local, fewer background helpers.

---

## 18. Data, backup, import/export (DATA)

- **DATA-01** `P0` **Import content.** Character cards (SillyTavern/Chub V1–V3, RisuAI best-effort), lorebooks, personas, and presets. *Chat import is `P3`, since you're starting fresh.*
- **DATA-02** `P0` **Export.** Chats as ST-compatible JSONL, Markdown, or styled HTML; the whole library as a backup zip.
- **DATA-03** `P0` **Automatic rolling backups.** For example hourly ×24 and daily ×14, plus a backup before every migration. One-click restore. *(↳ front-porch two-tier backups, otaku daily snapshots)*
- **DATA-04** `P1` **Book export.** Your story compiled into chapters, as EPUB, PDF, or HTML, using chapter titles and optionally cleaned-up prose.
- **DATA-05** `P1` **Memory export/import** as JSON (summaries, facts, entities, trackers).
- **DATA-06** `P1` **Storage dashboard.** Size per chat and character, reclaimable space, and a one-click vacuum. *(↳ PocketRisu)*
- **DATA-07** `P2` **Integrity check** at startup, with automatic restore from the last good backup if the database is damaged. *(↳ front-porch)*
- **DATA-08** `P1` **Off-machine backup copy.** With one always-on host, that machine is a single point of failure. Mea also copies its daily backup to a second location: a OneDrive/Google Drive-synced folder, another drive, or another device. Optionally encrypted with a passphrase.

---

## 19. Privacy & security (SEC)

- **SEC-01** `P0` **Local-first.** Zero telemetry, no accounts, no cloud services except the model APIs you choose.
- **SEC-02** `P0` **Localhost by default.** Remote access needs explicit enabling plus device tokens. Tailscale is the recommended route.
- **SEC-03** `P0` **Sanitized rendering.** DOMPurify on all HTML, scoped CSS, and no script execution from cards or messages.
- **SEC-04** `P0` **Encrypted API keys** (CONN-04).
- **SEC-05** `P1` **Optional database encryption at rest** with a passphrase. *(↳ otaku)*
- **SEC-06** `P1` **Local request log** with keys redacted, pruned automatically.

---

## 20. Transparency & debugging (DBG)

- **DBG-01** `P0` **Prompt Inspector.** The exact final request: messages, roles, tokens per block, which lore and memories were included and why. Copy as JSON. *(↳ TipsyTavern Inspector, TavernAI Final Prompt Preview, Lumiverse dry-run)*
- **DBG-02** `P1` **Request history.** The last N requests and responses, with timing, tokens, cost, and cache hits. *(↳ Lumiverse request history, ChungusHub debug panel)*
- **DBG-03** `P1` **Job monitor.** Queued, running, and failed background jobs, with retry and per-job cost.
- **DBG-04** `P2` **Replay.** Re-run a past request with a different model or settings and compare the results. *(↳ STARmem replayable traces)*

---

## 21. Quality-of-life extras (QOL)

- **QOL-01** `P1` **Notebook.** Notes per chat and global (plans, ideas, what-ifs) that can link to entities and lore. *(↳ Neconyan notebooks)*
- **QOL-02** `P1` **Bookmarks & highlights.** Mark favorite moments, browse them as a "best moments" reel, and they also count as importance signals for memory (MEM-19).
- **QOL-03** `P1` **Mention autocomplete.** Type `@` in the composer to insert names with their canonical spelling.
- **QOL-04** `P1` **Local English spell and grammar check** in the composer (e.g. Harper via WASM), with names from your entities and lore added to its dictionary automatically. *(↳ Aventuras)*
- **QOL-05** `P1` **Undo toasts** for every destructive action.
- **QOL-06** `P2` **In-story anniversaries** surfaced to the model ("It's been a year since they met").
- **QOL-07** `P2` **Fun stats.** Words written together, longest story, streaks.

---

## 22. Explicitly out of scope

Not building these, as you asked:

- **Group chats** / multi-character turn-taking. *A narrator-style card with many NPCs still works: entity memory and trackers handle NPCs.*
- **RPG systems:** dice, stats, combat, XP, inventory/quests as game mechanics. *The narrative trackers (time, place, outfit, mood, relationships, threads) are optional and have no game rules.*
- **Forks / branches / story trees.** *Swipes are alternatives for the latest AI message. Rewind (CHAT-16) is linear and undoable. Sequels (MEM-33) are new chats, not branches.*
- **Multiplayer**, accounts, and multi-user.
- **Image generation.** *Uploaded avatars, galleries, and backgrounds are fine.*
- **Visual novel presentation:** sprites, stage backgrounds, expression packs.
- **TTS** (and speech-to-text: phone keyboards already have dictation).

Also out, following your decisions:
- **iOS and macOS** clients. *Windows + Android only.*
- **Multiple languages / i18n.** *English only.*
- **A Gemini adapter** and **local embedding models.** *NanoGPT covers them. The Anthropic Messages format exists only for Claude on LinkAPI.*
- **Chat import from other frontends** (parked at `P3`).
- **Linux/VPS hosting**, **spending alerts**, and **paid fallbacks without your tap**. *(The host is your Windows machine; quota, not money, is the budget.)*

Also left out on purpose, after seeing them cause sprawl in other frontends:
- In-world phones, social feeds, mini-games, gacha, video, music, and coding agents.
- Card hubs and community or social features.
- A plugin marketplace in v1. Clean internal modules plus custom trackers, macros, and regex cover most needs. STEER-07 is the only hook surface.
- SillyTavern's wall-of-settings model.

---

## 23. Suggested roadmap

| Phase | Goal | Main IDs |
|---|---|---|
| **0: Foundations** | A fast, cozy, reliable chat on Windows and Android, always on | ARCH-01…08, ARCH-10, ARCH-15, CONN-01…04, CONN-06, CONN-08, CONN-11, CONN-13, CONN-17, CHAT-01…08, CHAT-25, CHAR-01…05, PER-01…02, LORE-01…04, PROMPT-01…05, UI-01…07, MOB-01…06, MOB-14, LIB-01…03, PERF-01…05, DATA-01…03, SEC-01…04, DBG-01 |
| **1: Memory core** | Continuity at 1,000+ messages | MEM-01…13, MEM-35, MEM-39, MEM-40, SUM-01…09, SUM-12, CTX-01…10, CONN-05, CONN-12, CONN-16, CONN-19…24, ARCH-12, ARCH-14, DATA-08, DBG-02…03, PERF-06…07 |
| **2: Trackers & chat tools** | Living state you can see, plus richer steering | TRK-01…13, TRK-16…22, TRK-26…32, CHAT-09…20, CHAT-26…27, CONN-07, CONN-09, CONN-14 |
| **3: Retrieval, facts & accuracy** | Precise recall of old details, no knowledge leaks, contradictions caught | MEM-14…23, MEM-26…31, MEM-36…38, MEM-41…42, MEM-44, MEM-46, CON-01, CON-02, CON-06…08, LORE-05…15, LIB-04…07, SUM-22 |
| **4: Creator studio** | Characters and personas that aren't generic | CHAR-06…18, PER-03…07, PROMPT-06…10 |
| **5: Guards & polish** | Accuracy at 5,000+ messages, the "wow" factor | CON-03…05, CON-09, CON-10, CON-12, STEER-01…04, SUM-10…11, SUM-13…20, UI-08…20, UI-24…25, MOB-07…13, DATA-04…06, PERF-08…11, SEC-05…06, QOL-01…05, ARCH-09, ARCH-11 |
| **Later** | Depth | Every remaining `P2`/`P3` item |

A good first milestone: **Phase 0 + Phase 1**. That's already better than most frontends at long chats.

---

## 24. Remaining questions

None. All decisions are recorded in [§0.1](#01-decisions-2026-10-08) (decisions 1–14), and the plan is ready for Phase 0.

Two things Mea checks for itself on first run, so no answers are needed:
- **Your exact NanoGPT quota windows.** Mea reads the 60M/week quota, plus any daily limit, from `GET /api/subscription/v1/usage` (CONN-19), and measures whether cached tokens count toward it (CONN-22).
- **Whether LinkAPI caches Claude.** The cache probe (CONN-24) tests it the first time you add the connection. If your LinkAPI isn't the New API-based linkapi.ai, nothing changes: the probe finds the format that works, or reports that caching isn't available.
