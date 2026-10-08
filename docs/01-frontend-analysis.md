# Frontend Landscape Analysis

> Research for **Mea**, as of 2026-10-08.
> Source: the 45 projects in the [Tavernary "Frontends" category](https://tavernary.org/?category=frontend), plus a deeper look at the **Lumiverse `staging` branch** (its user docs and source tree), RisuAI's HypaMemory V3 source code, and a scan of the 49 projects in Tavernary's **Memory & Retrieval** category, since memory is Mea's top priority.
> Method: each project's README, or its docs where the README was thin. Claims come from those pages. Where a project doesn't document something, this file says so instead of guessing.

---

## TL;DR: what matters for Mea

1. **Nobody combines all of Mea's priorities in one place.** The best memory systems (Lumiverse Cortex, Narrative Engine, Sonder) sit inside heavy, complex apps. The best UX (vibe_tavern, Pyre, ChungusHub) has fairly shallow memory. The best trackers (Marinara, front-porch) come bundled with features Mea doesn't want (RPG, image generation, TTS, social feeds). Mea's opening is **deep memory with a calm UI, in a light app.**
2. **Memory has converged on layers.** The serious projects all use a mix of (a) a verbatim recent window, (b) chapter or scene summaries, (c) semantic and keyword retrieval over old material, (d) structured facts/entities, and (e) pinned "core" memories. No single technique is enough on its own.
3. **The most important ideas to borrow:**
   - Lossless archive + sealed chapters + two-phase search + witness tracking (**Narrative Engine**)
   - Memory budget split into important / recent / similar / random slots, with hybrid keyword+vector search fused child-to-parent (**RisuAI HypaV3**)
   - Entity graph + salience + emotional resonance + scene/arc consolidation + inspectable memory panel (**Lumiverse Memory Cortex**)
   - Access filters *before* ranking, so a character only recalls what it perceived (**Sonder**, **alex-tavern**)
   - Tracker state tied to the specific swipe that produced it, updated by a cheap side model without delaying the reply (**vibe_tavern**)
   - Structured story summary categories: objectives, foreshadowing, developments, quotes, relationships (**Lumiverse Loom Summary**)
   - Interview-first character creation with an anti-generic quality gate (**Lumiverse Dream Weaver**)
   - Server-side generation that finishes even when the phone locks (**PocketRisu**, **Neconyan**)
4. **Transparency wins.** The best-liked tools show the user exactly what the model received (Prompt Trace, Inspector, dry-run, the context meter with a per-source breakdown) and why each lore entry or memory fired.
5. **Lightweight is achievable.** Tauri v2 + Svelte 5 + SQLite (RyokanApp, Aventuras, RisuAI), Bun + SQLite (Lumiverse, vibe_tavern, ChungusHub), and even a single HTML file (Synapse) all show that a fast app is possible. The heavy ones (SillyTavern forks, 100–400 MB repos) inherit their weight from feature sprawl.
6. **A warning sign:** the richest apps (Lumiverse, Marinara) need documentation pages explaining *which of their three memory systems you're using* and why a macro is empty. Mea should get that power without the confusion: **one memory system with layers, sensible defaults, and an inspector.**

---

## 1. Catalog at a glance (all 45)

Relevance tiers: **A** = directly relevant to Mea's priorities. **B** = relevant for UX, platform, or performance lessons. **C** = mostly out of scope (RPG, VN, multiplayer, sim), mined only for ideas. "Score" is Tavernary's community score.

### Tier A: memory, continuity, trackers, creation, UX

| Frontend | Score | Stack / platforms | Memory & summary | Trackers / state | Why it matters to Mea |
|---|---:|---|---|---|---|
| [Lumiverse](https://github.com/prolix-oc/Lumiverse/tree/staging) (staging) | 274 | Bun + Hono + `bun:sqlite`; React frontend; Tauri desktop shell | Loom Summary (structured), chunked LTM, **Memory Cortex** (entities, relations, salience, arcs), Databank, vaults/interlinks | Council tools; no built-in tracker module found | Most advanced memory stack in the catalog; Dream Weaver creator; Sovereign Hand; regen feedback |
| [RisuAI](https://github.com/kwaroran/Risuai) | 2,092 | Svelte 5, Tauri 2, Capacitor; web/desktop/mobile | SupaMemory, **HypaMemory V2/V3** | Regex, variables | HypaV3's budgeted slot selection and hybrid search are proven at scale |
| [Narrative Engine](https://github.com/Sagesheep/NarrativeEngine-P) | 134 | Node, Vite, SQLite + sqlite-vec, local ONNX embeddings | **Lossless archive**, sealed chapters, two-phase deep search, 3 compression levels, pins | **Divergence Register** with `knownBy` scopes, NPC personality axes, relations | Best-documented continuity design; Lore Check auditor |
| [vibe_tavern](https://github.com/Noineri/vibe_tavern) | 81 | Bun, Hono, React, SQLite; Android APK | Multiple summaries, background compaction, "recovered context" display | Objective + Scene trackers, **bound to the swipe variant** | Best long-session UX: context meter, Prompt Trace, Co-Author diffs |
| [Marinara Engine](https://github.com/Pasta-Devs/Marinara-Engine) | 905 | TS monorepo, Docker, PWA, Android via Termux | Long-Term Memory agent, Knowledge RAG | **13 tracker agents** (world, character, relationship, quests…); tracker panel | Breadth of tracker ideas; "decision models" gating activation |
| [Aventuras](https://github.com/AventurasTeam/Aventuras) | 253 | Tauri 2, SvelteKit, Svelte 5, SQLite; desktop/Android/iOS | Chapter summaries + retrieval | Who's present / where / what you carry | Lorebook agent merges duplicates; diff-before-apply; per-subsystem model profiles |
| [talemate](https://github.com/vegu-ai/talemate) | 495 | Python, Jinja2 templates | Long-term memory, summarizer agent, passage of time | World state management | Agent-per-job design with per-agent API routing |
| [serene-pub](https://github.com/doolijb/serene-pub) | 210 | Svelte, Vite, Node, Drizzle; Android | Scenes → lorebook history timeline; RAG scoped to what each character knows | **Narrative graph** with secret/acknowledged/public relationships | Per-character knowledge visibility; per-task model routing; low clutter |
| [Sonder Engine](https://github.com/N0819/Sonder_Engine) | 65 | Python, FastAPI | Per-beat memories with provenance; BM25 + vector + exact-phrase fusion; no vector index | Theory of mind, affect, beliefs | Perception filters before ranking; embedding-aware memory writing |
| [front-porch-AI](https://github.com/linux4life1/front-porch-AI) | 90 | Flutter, SQLite, ONNX | ONNX RAG, emotion-stamped journal, promises | Needs, story clock, weather, quests, wardrobe, Growth Rings | "Realism" modules toggled individually; receipt-backed character change |
| [otaku](https://github.com/enclavum/otaku) | 90 | Python TUI + web, SQLite | First 20 + last 150 messages verbatim; scene summaries; **per-character journals**; idle-triggered extraction | — | Proves simple strategies work; `/ooc` (persistent) vs `/cue` (one-shot) |
| [Pyre](https://github.com/devemberteam-ops/Pyre) | 78 | Flutter; Android/Win/Linux/web | Chapter-like Checkpoints, Live Sheet, Script | Live Sheet (scene state) | Thumb-first mobile design; surgical AI edits; review-before-save creator |
| [alex-tavern](https://github.com/al4xdev/alex-tavern) | 5 | (multi-agent kernel) | Memory limited to what each character perceived; first-person condensation | Code-owned clock, typed Director decisions | Code clamps model output; knowledge-leak guard |
| [PocketRisu](https://github.com/PocketRisu/PocketRisu) | 437 | Node server + browser, SQLite | HypaMemory V3 | — | **Generation survives disconnects**; QR remote access; storage dashboard |
| [ChungusHub](https://github.com/patcireamo/ChungusHub) | 50 | Bun, Svelte, Vite; single executable | Older scenes folded into summaries (per branch) | — | Assistant that fixes memory/cards with approval levels; preset controls; drafts sync |

### Tier B: UX, platform, and performance lessons

| Frontend | Score | Stack / platforms | Notes for Mea |
|---|---:|---|---|
| [SillyTavern](https://github.com/SillyTavern/SillyTavern) | 40,769 | Node/Express + web UI | The baseline and the compatibility target (cards, World Info, presets, chats). Huge power, but cluttered UI, heavy with long chats, clunky on mobile. Memory comes from extensions (Summarize, Vector Storage, Data Bank, plus community add-ons). |
| [TauriTavern](https://github.com/Darkatse/TauriTavern) | 2,014 | Rust backend on Tauri v2 + upstream ST frontend; desktop/Android/iOS | Rewriting the backend natively works. Staged startup, virtualized DOM for long chats, LAN-encrypted sync. |
| [agnai](https://github.com/agnaistic/agnai) | 962 | Node, multi-tenant web | Memory books + optional embedding pipeline; supports several persona formats (W++, SBF, plain). |
| [SillyBunny](https://github.com/SillyBunnyTeam/SillyBunny) | 164 | ST fork on Bun | Desktop-environment-style shell; global search; 4-stage agent hooks (pre / main / sidecar / post). |
| [TavernAI 2](https://github.com/TavernAI/TavernAI) | 104 | Portable local app | Final Prompt Preview; each character keeps its own timeline that merges when characters meet. |
| [NeoTavern-Frontend](https://github.com/NeoTavern/NeoTavern-Frontend) | 103 | TS/Vite over an ST backend | Built-in Chat Memory (range summary → lorebook entry, or per-message summary); Magic Rewrite across all fields. |
| [hordestudio](https://github.com/ddkhan24/hordestudio) | 72 | Vanilla JS + Python + Node | Inspectable story memory (pin/edit/archive); "Life" view exposes simulation state. |
| [SweetrollLM](https://github.com/syfr512/SweetrollLM) | 69 | Python/FastAPI, vanilla JS | Images become hidden per-turn captions; API keys resolved server-side only. |
| [Glaze](https://github.com/hydall/Glaze) | 40 | Flutter + Drift/SQLite; Android/iOS/desktop | Background generation + notification; shareable JSON themes; usage stats; deny-by-default extension permissions. |
| [AstraProjecta](https://github.com/RivelleDays/SillyTavern-AstraProjecta) | 32 | ST extension; shadcn/Radix/Tailwind/Vaul | Mobile-first: context usage on the input bar, revision history with side-by-side compare, per-chat appearance overrides. |
| [RyokanApp](https://github.com/Finn-Hecker/RyokanApp) | 23 | Rust, Tauri v2, Svelte 5, SQLite; Windows/Android | "Stays out of the way"; Simple vs Advanced settings; rolling summaries; automatic context management. |
| [writers-guild](https://github.com/amiantos/writers-guild) | 20 | Vue 3 + Express | Greeting rewrite into a consistent POV/tense; perspective-controlled continuation. |
| [Focus](https://github.com/ganon3264/focus) | 9 | Python/FastAPI + htmx | A personal, minimal ST alternative; preset variables exposed as switches. |
| [Arousal Pub](https://github.com/vevan/arousalPub) | 9 | Node/Fastify, Vue, LanceDB, ONNX | Audit panel per message (prompt assembly, regex stages); chunked on-disk chat storage. |
| [Neconyan](https://github.com/platberlitz/Neconyan) | 8 | ST/SillyBunny fork; APK/Termux | Server-side replies; "Mewmory"; notebooks linked to lorebooks; assistants that configure the app via tool calls. |
| [Mignon-UI](https://github.com/Mignon-UI/Mignon-UI) | 8 | Tauri, React, Bun | Milestone chapters as memory; onboarding wizard; lorebooks linkable to rooms. |
| [TipsyTavern](https://github.com/RebootFlume/TipsyTavern) | 4 | Tauri 2, React 19, Rust; file storage | Small and clean: Inspector shows the exact payload; persona-linked world books. |
| [charon](https://github.com/M4Marvin/charon) | 10 | React, TanStack Start, SQLite | Ctrl+K command menu; scoped `<style>` in messages; stable streaming fade-in; backup-first migrations. |
| [Synapse_Engine](https://github.com/Lainholic/Synapse_Engine) | 1 | Single HTML file, IndexedDB | Symbol toolbar above the mobile keyboard; auto-summary every 15 turns; client-side PNG card parsing. |
| [SillyTavernAndroid](https://github.com/doomedskull1011/SillyTavernAndroid) | 7 | Android wrapper | Little documented; confirms the demand for ST on phones. |

### Tier C: out of scope (RPG / VN / multiplayer / sim), mined for ideas

| Frontend | Score | Focus | Idea worth borrowing (non-RPG) |
|---|---:|---|---|
| [waidrin](https://github.com/p-e-w/waidrin) | 453 | RPG engine with JSON-schema-constrained state machine | Structured world model instead of chat-as-memory; headless engine separate from UI |
| [AI RPG](https://github.com/envy-ai/ai_rpg) | 180 | Solo tabletop GM | Scene-based (not line-based) summaries that keep memorable quotes; slow-changing relationship axes |
| [WorldLines](https://github.com/LudicDynamics/WorldLines) | 94 | Multi-agent world sim (proprietary core) | Append-only event log + schema-validated deltas (Plan → Diff → Validate → Apply) |
| [rpg-roleplay-platform](https://github.com/felixchaos/rpg-roleplay-platform) | 90 | Novel → playable RPG | — |
| [RPGraph](https://github.com/unrefined803/RPGraph) | 54 | Node workflow + in-world phone | Per-node model routing (small model for small jobs) |
| [Fugue (UIE)](https://github.com/GetfroggyHoe/Universal-Immersion-Engine-Fugue) | 50 | VN RPG | Character *definition* kept separate from live campaign state; "knowledge routing" (each fact type has a home) |
| [TaleWeaver](https://github.com/jschm42/taleweaver) | 26 | Browser RPG | — |
| [Aikobots](https://github.com/aikohanasaki/Aikobots) | 23 | Multi-user ST fork | Aims at 1000+ message stability (SQLite migration), with no detail on how |
| [Quest Keeper](https://github.com/Mnehmos/mnehmos.quest-keeper.game) | 22 | RPG DM + visual engine | — |
| [Simulith](https://github.com/Chechelpo/Simulith) | 9 | World-focused sessions | Nested region tree, with a lorebook per world/region/location/character |

---

## 2. Deep dives

### 2.1 Lumiverse (`staging` branch)

The README covers only operations and the API. The staging tree and `user-docs/` reveal a much larger system: `memory-cortex/`, `council/`, `weaver/`, `databank/`, `vector-store/` (LanceDB/Qdrant/Milvus adapters), prompt-assembly workers, and a tokenizer cache. Frontend: React, Zustand, `@tanstack/react-virtual`, Motion, CodeMirror, dnd-kit.

**Memory, three independent systems:**

| System | What it does | Notable details |
|---|---|---|
| **Loom Summary** | One editable story overview per chat, updated by an LLM from the previous summary + recent messages | Manual/Automatic modes, interval, **message lag** (lets the newest messages settle first), dedicated connection, Rebuild-in-batches. Default structure: *Completed Objectives (7), Focused Objectives (5), Foreshadowing Beats (5), Character Developments (7), Memorable Actions (7), Memorable Dialogues (5), Relationships (5)* |
| **Chat Memory / LTM** | Chunks history and retrieves by vector similarity | Presets Conservative/Balanced/Aggressive (chunk 600–1000 tokens, overlap 100–200, exclusion window 15–30 msgs); splits on time gaps and scene markers; query strategies (recent / last user / weighted recent); recency fallback while vectorizing |
| **Memory Cortex** | Adds entities, relationships, salience, emotional tags, scene→arc consolidation | Heuristic or sidecar-LLM extraction, with fallback chains; "arbitrates heuristics"; **user-edited entities are protected** from AI grading; diversity selection; core-memory protection; decay and pruning; formatters (*Shadow* prose, *Attributed* with perspective and temporal distance, *Clinical*, *Minimal*); **Vaults** (frozen snapshots of a chat's memory) and **Interlinks** (live links to another chat's memory) |

**Other notable features:**
- **Council:** advisor personas run "tools" (Suggest Direction, Propose Twist, Prose Guardian, POV Enforcer, Flame Kindler for relationships, Canon analysis…) on a sidecar model before generation. Results are injected as a deliberation block. **Historical deliberations** let an advisor build on its own past plans. **Chimera mode** fuses personas into one.
- **Dream Weaver:** the creation studio. *Dream → Read-back → Interview → Bible → Render → Finalize*. It is built on the insight that one-shot generators regress to the most average output. Tracks whose words each fact came from and weights the user's verbatim words highest. Has a quality gate for genericness, coherence, and tension. Ships lean cards plus small bound "rules / lore / NPC / depth" books, including a constant **re-anchor** entry for long sessions.
- **Sovereign Hand:** the user's message becomes a stage direction instead of in-character speech. Automatic continuation mode when the character spoke last.
- **Regen Feedback:** a note explaining *why* you're regenerating, injected as OOC for that attempt.
- **Guided Generation:** reusable prompt fragments, persistent or one-shot, that auto-activate per chat/character/connection.
- **Context Filters:** strip HTML / `<details>` / tool tags from messages older than a "keep depth". *Keep Only* mode compresses old messages down to their structured blocks.
- **Databank:** uploaded documents chunked and retrieved, or summoned with `#slug`; global, character, or chat scope.
- Prompt dry-run, request history, prompt-assembly profiler and prefetch, per-provider caching services, push notifications, color extraction from avatars.

**Steal:** layered memory with an inspector, structured summary categories, message lag, salience + emotion + diversity ranking, protected user edits, vaults for sequels, Weaver's interview flow and "your words first" weighting, re-anchor entries, regen feedback, Sovereign Hand, context filters, prefetch.
**Avoid:** three overlapping memory systems with separate settings pages, macros that silently own placement, and fallback injection rules that need a troubleshooting table. Mea should offer *one* memory system with layers and clear defaults.

### 2.2 RisuAI / PocketRisu: HypaMemory V3 (read from source)

`src/ts/process/memory/hypav3.ts`:
- Old chat is summarized in chunks into **summaries**. Each has `isImportant`, `categoryId`, and `tags`, with bulk edit and re-summarize in a dedicated modal.
- A **memory token budget** is a ratio of the context (default 20%). An `extraSummarizationRatio` reserves headroom.
- Selection order: **important** summaries first, then **recent** (default 40% of budget), then **similar** (40%), then **random** (the remaining 20%). Unused budget rolls over to the next slot.
- "Similar" uses **embedding similarity + a keyword engine**, fused with **child-to-parent Reciprocal Rank Fusion**: summaries are split into chunks, and chunk hits lift their parent summary. Optional **similarity correction** summarizes the recent chat to build a better query. Contextual-embedding support.
- PocketRisu adds **server-side generation that survives disconnects** (the finished reply is restored on reconnect), QR/Tailscale remote access, a storage dashboard, and self-update.

**Steal:** budget slots with rollover, importance pins, hybrid + child-to-parent fusion, a little randomness for serendipitous callbacks, server-side generation.
**Avoid:** summaries without structure or provenance, and a modal-centric UI for memory management.

### 2.3 Narrative Engine

- **Lossless scene archive:** nothing is thrown away. Chapters get **sealed** with an LLM overview.
- **Two-phase deep search:** first scan chapter overviews, then retrieve the specific scenes inside the relevant chapters, ranked by importance, and inject them *verbatim*.
- **Witness tracking:** each scene records which NPCs were physically present vs. merely mentioned. Matching witnesses rank higher.
- **Pinned memories**; scene-level **rollback** that cascades through the timeline, chapters, NPCs, and the register (with a safety backup).
- Summarization strategies **Tight (~50%) / Smart (~75%) / Deep**. The last 8 messages stay verbatim. Names, numbers, and stats are preserved exactly. **Dramatic-moment tags** survive re-compression. Separate summarizer model.
- **Divergence Register:** structured facts auto-extracted after each turn (locations, NPC events, promises/debts, alliances, deaths). Each fact has `knownBy` scopes so NPCs can't reference secrets. Semantic dedup and fact clustering.
- **Lore Check:** a QA tool that cross-references the archive, lore, and chapters. It returns a verdict *with citations* and offers a one-click rewrite.
- Live token gauge (system / history / free), per-module caps, lazy swipes (not committed until accepted), "Ask GM" OOC side chat, five role-based endpoints (Story, Summarizer, Utility, Image, Auxiliary), local ONNX embeddings + sqlite-vec.

**Steal:** almost all of the memory design: lossless ledger, sealed chapters, two-phase search, witness tracking, knownBy, pinned memories, preservation rules, Lore Check, Ask GM, lazy swipes.
**Skip:** dice pools, world arcs, encounter engines, the map (RPG).

### 2.4 vibe_tavern

- **Context meter** in the composer with a breakdown by layer (history, character, lorebooks, summaries…). Shows how much context the full history *would* have used vs. what was recovered.
- Multiple summaries with separate control over which enter context; background compaction that excludes already-summarized messages; **utility models** for summaries and trackers.
- **Scene Tracker** (location, participants, objects, appearance) and **Objective Tracker**. State is **tied to the response variant** that produced it and updated without delaying the reply.
- Lorebook with simple/full editor modes, AND/OR/NOT logic, inclusion groups, sticky/cooldown/delay, per-scope entries, **Prompt Trace** (which entries fired and why).
- Character editors: structured / plain / Markdown **with pinned canonical headings**. **Versions** (full snapshots, switchable). **Co-Author** chat that proposes edits as **diffs** you accept in full or in part. AI parser for messy notes.
- Mobile: QR pairing over LAN/Tailscale, bottom sheets, carousels, swipe gestures. 22 editable "service prompts" switchable as profiles.

**Steal:** context meter, variant-bound tracker state, Prompt Trace, Co-Author diffs, card versions, pinned-heading Markdown editor, service prompt profiles.

### 2.5 Marinara Engine

- Tracker agents: World State (incl. weather), Expression Engine, Quest, Background, **Character Tracker**, Persona Stats, **Custom Tracker**, Inventory, Beholder, **Memory Nag**, World Maps, Quartermaster, **Relationship Tracker**. The **Tracker Panel** docks beside the chat.
- Writer agents: Prose Guardian, **Continuity Checker**, Narrative Director, Knowledge Retrieval/Router, **Card Evolution Auditor**. Custom agents with user-defined prompt, timing, tools, and output type.
- **Decision models:** a fast yes/no model decides whether agents, lorebook entries, and prompt sections activate.
- Rich theming (fonts, layouts, movable buttons, CSS theme library), PWA, per-chat connections, AES-encrypted keys.

**Steal:** tracker taxonomy, the Continuity Checker and Card Evolution ideas, Memory Nag (remind about dormant threads), decision-gated activation, docked tracker panel.
**Avoid:** the sprawl (games, gacha, social feed, calls, video, music) that turns the app into a platform.

### 2.6 Sonder Engine and alex-tavern (epistemic designs)

- **Sonder:** objective truth, perception, memory, belief, and narration are separate layers, so characters can be wrong or deceived. Memories are minted per beat with provenance. Writing order is tuned for embedding bias (events first, room changes last). Unchanged state is omitted to avoid near-duplicates (reported duplicate rate fell from 14.6% to 0.4%). Recall uses NumPy cosine + BM25 + exact-phrase fusion with **no vector index**, arguing none is needed at this scale. **Access filters run before ranking.** Also: unbidden recall, belief revision, contrastive retrieval when a mind's thinking converges, and a detect-and-rebuild flow when the embedding model changes.
- **alex-tavern:** memory is bounded by perception. A stranger stays "the man in the open shirt" until a name is perceived. Per-turn digests are deterministic and LLM-free. An LLM condenses older memory into a first-person summary, with secrets, codes, and numbers kept verbatim. A **code-owned monotonic clock** (undo doesn't rewind time) and code that **clamps** model proposals (it can narrow perception, never widen it). Typed Director decisions with no prose.

**Steal:** filter-then-rank, perception-scoped memories for NPCs, verbatim-preservation rules, a clock owned by code, clamping model output with rules, vector search without an index for personal scale.

### 2.7 serene-pub

- Lorebooks+ combine world lore, character lore, and a **dated history timeline**. Scenes condense into standalone summaries pinned to a point in the history.
- **Narrative graph** of relationships with visibility *secret / acknowledged / public* ("a one-sided crush stays one-sided"). Lore can be private to one character. Per-character knowledge visibility per chat.
- Summaries become **editable lorebook content**; graph edges **cite source text** and need review before saving.
- **Per-task model routing:** chat, narrator, summarizers, and graph builder can each use a different connection. On-demand narrator without a narrator character. Document View (keyboard and screen-reader first). Platform limits flagged up front.

### 2.8 front-porch-AI ("Realism Engine")

- Emotion with inertia; trust/bond that changes openness; six Sims-style **needs**; likes/dislikes that amplify deltas; a **story clock** advanced by events, not turn count; hour-by-hour weather; work schedules; quests from character ambitions; pockets and wardrobe; Chance Time events.
- **Journal** stamped with emotion; **Promises** (kept/broken); **Growth Rings**, receipt-backed character changes that become permanent or fade.
- Delta **chips** (bond/trust changes) on messages. Each module can be switched on or off.
- Creator: Quick Create, voice-first interview, editor passes (*Anti-Puppet, Consistency Check, Quality Polish, Truncation Completion*), "AI Enhance" that grows a character from a chat without overwriting the card.

**Steal:** delta chips, promises ledger, growth rings, editor passes, per-module toggles, a clock driven by events.
**Skip:** needs/chaos/AFK simulation unless it's an optional template.

### 2.9 otaku (minimalism that works)

- Keeps the **first 20 + last 150 messages verbatim** (so the model keeps your prose style). Middle messages are grouped into **scenes** and replaced by scene summaries after ~200 messages.
- Background summary pass **only after 5 minutes idle**, so play is never interrupted.
- **Per-character journals** of what each character saw. Private "assistant notes" the model keeps between turns.
- `/ooc` = standing note; `/cue` = one-time nudge. Template migration respects user edits (unedited templates follow updates; edited ones are never overwritten).

### 2.10 Aventuras

- Chapters summarized as you play, with retrieval of what the current scene needs. World state (who / where / what you carry) updated each turn.
- Lorebook entries typed (characters, locations, items, factions, concepts, events) with aliases and **secrets**, keyword- and relevance-based injection, and a **background agent that merges duplicates and fills gaps**.
- The Vault assistant edits characters/lorebooks with a **diff before apply**. **Agent Profiles** assign a model per subsystem. Liquid templates for all prompts. **Local grammar check (Harper/WASM)** and repetition analysis. LAN sync via QR.

### 2.11 Pyre, Glaze, ChungusHub, AstraProjecta (mobile and UX references)

- **Pyre:** thumb-first, then widened for desktop. Checkpoints (chapter summaries), **Live Sheet** (current scene state), **Script** (future direction). Surgical field edits. Creator with review-before-save. Smart fallback on empty output or refusals, learned context limits, generation keep-alive on Android. Reasoning hidden by default.
- **Glaze:** Material 3 with separate mobile/desktop layouts; **background generation with a notification**; usage stats; shareable themes; reasoning never sent back.
- **ChungusHub:** **drafts sync across devices**, input history, find-in-chat, **Preset Controls** (a preset exposes a few user switches), prompt debug panel with token counts corrected against provider-reported usage, settings docked to the side, a single-executable build.
- **AstraProjecta:** context usage on the input bar with a per-source breakdown; quick actions on the latest message; **revision history with side-by-side comparison**; in-chat find & replace; per-chat background blur/opacity; favorites and per-character chat categories.

### 2.12 SillyTavern and its forks (the baseline)

- **SillyTavern** defines the formats Mea must read: V2/V3 cards, World Info (keys, logic, recursion, timed effects, inclusion groups, vector activation), chat-completion presets, JSONL chats. Its memory is assembled from extensions: built-in Summarize, Vector Storage, Data Bank, and community add-ons (see §3).
- Forks show what people want fixed: **SillyBunny** (cleaner shell, Bun backend, global search, agent stages), **Neconyan** (server-side replies, notebooks), **TauriTavern** (native backend, mobile, virtualized long chats), **AstraProjecta** (mobile UI), **NeoTavern** (one prompt manager, simpler built-in memory), **Focus** (strip it to what one person uses), **Aikobots** (1000+ message stability).
- Lesson: **compatibility on import is essential; copying ST's UI and settings model is not.**

---

## 3. Memory & tracker extension ecosystem (bonus scan)

Tavernary's *Memory & Retrieval* category (49 projects) shows what the community is building on top of frontends, and therefore what users feel is missing. Notable ideas:

| Extension | Idea |
|---|---|
| **MemoryBooks** (score 367) | Structured scene summaries saved as lorebook entries; side prompts; multi-tier consolidation |
| **Horae** (221) | "Structured time anchors" that keep events, costumes, relationships, and items consistent |
| **Summaryception** (197) / **Message Summarize, qvink** (195) | Recursive summarization / **per-message** summaries into short- and long-term memory, with user-flagged important messages |
| **DeepLore** (103) | Pairs keywords with AI retrieval so lore fires without exact trigger words; Obsidian vaults as a source |
| **Character Memory** (82) | Extracts structured memories into the character's Data Bank for vector recall |
| **VectFox** (80) | LLM-extracted story events + sparse/dense hybrid search |
| **Smart Memory** (71), **ReMemory** (69) | Multi-tier memory + narrative context tracking |
| **openvault** (54) | **POV-aware memory with witness tracking**, relationship dynamics, emotional continuity |
| **StatSuite** (53) | Persistent pose/location/outfit/inventory without using the main model; **injects only the latest stat block at depth 1** |
| **timeline-memory** (47) | Timeline of summarized chapters, **AI arc detection**, agentic tool-based querying |
| **Story-Editor** (13) | A separate editor model reviews new material and **proposes structured-memory updates for approval** |
| **STARmem** (8) | Deterministic retrieval, async fact extraction, **replayable traces** in a Memory Viewer timeline |
| **BlazeTracker**, **story-tracker**, **zTracker**, **Tracker** | Time, weather, location, positions, outfits, relationships; dedicated connection; HTML templates |
| **TunnelVision**, **TheLibrarian** | Model *browses* memory/lore through tools instead of the frontend guessing |
| **ST-Message-Chunker**, **Chunk-Dropper** | Drop old messages in **large chunks** to maximize prompt-cache hits |
| **Tavern-Doors** | Fold any selected range into a compact summary *in place*, without deleting anything |
| **ste_summary_editor** | Numbered summaries with arc grouping, **gap detection**, causal linking, timeline/location views |
| **Loretips** | Tooltips showing which lore entries your *draft* would trigger as you type |

The sheer number of these is the strongest signal in the research: **memory and tracking are the most-requested missing pieces, and nobody ships them integrated, coherent, and inspectable by default.**

---

## 4. Cross-cutting patterns

### 4.1 Memory approaches

| Approach | Who | Strength | Weakness |
|---|---|---|---|
| Recent window only | Basic clients | Simple, fast | Forgets everything beyond the window |
| Rolling single summary | Ryokan, Synapse, SweetrollLM, Loom Summary | Cheap, always on | Drifts over time (each rewrite compounds errors); loses detail |
| Per-message summaries | qvink, NeoTavern | Fine-grained, editable | Many calls; summaries can still overflow eventually |
| Scene/chapter summaries (hierarchical) | otaku, Aventuras, Narrative Engine, MemoryBooks, timeline-memory, Pyre | Mirrors story structure; bounded growth | Needs good scene boundaries |
| Vector RAG over chunks | Lumiverse LTM, agnai, Arousal Pub, front-porch | Recovers specific old details | Misses non-obvious relevance; noisy without reranking |
| Hybrid keyword + vector with fusion | HypaV3, Sonder, VectFox | Much better precision | More moving parts |
| Structured facts / registers | Narrative Engine (Divergence Register), Fugue | Precise, queryable, contradiction-checkable | Extraction errors need review UI |
| Entity graph + salience + emotion | Lumiverse Cortex, serene-pub graph | Memory that "feels human"; good for relationships | Complex; heuristics misfire on fantasy names |
| Perception/witness scoping | Sonder, alex-tavern, Narrative Engine, openvault, serene-pub | Characters stop metagaming | Requires witness data per memory |
| Agentic retrieval (tools) | TunnelVision, timeline-memory, NE query tool | Model asks for what it needs | Latency; needs tool-capable models |
| Lossless archive + verbatim recall | Narrative Engine | Exact quotes and details come back | Token-hungry if unbounded |

**Conclusion for Mea:** combine a lossless ledger, hierarchical summaries, structured facts and entities, hybrid retrieval with filtering *before* ranking, pinned core memories, and an inspector. Keep agentic retrieval optional.

### 4.2 Summarizer patterns
- Dedicated cheaper model with a fallback chain (vibe_tavern, Lumiverse, Narrative Engine).
- **Message lag / settling** before summarizing (Lumiverse), **idle-triggered** runs (otaku), background with no reply delay (vibe_tavern).
- Compression levels (Narrative Engine), structured categories (Loom), verbatim preservation of names/numbers/quotes (Narrative Engine, alex-tavern), dramatic-moment tags.
- Editable, rebuildable summaries; gap detection (ste_summary_editor); "recovered tokens" display (vibe_tavern).

### 4.3 Tracker patterns
- Separate model, runs after the reply, structured output (Tracker, zTracker, vibe_tavern).
- **Inject only the latest snapshot, shallow** (StatSuite).
- **State bound to the swipe variant** (vibe_tavern); undo snapshots per turn (alex-tavern).
- **Delta chips with reasons** (front-porch). Docked panel / HUD (Marinara).
- Validated deltas (WorldLines), code-clamped proposals (alex-tavern), slow-change axes (AI RPG).

### 4.4 Lorebook patterns
- ST-compatible activation is table stakes. Differentiators: **semantic activation** (Lumiverse, DeepLore), **AI maintenance** (Aventuras), **activation trace** (vibe_tavern), **typing preview** (Loretips), **scopes** (global/character/persona/chat), **hierarchy** (Simulith), **secrets/knownBy** (Aventuras, serene-pub).

### 4.5 Creator patterns
- One-shot "generate a card" is commodity and produces generic results.
- Better: **interview-first** (Weaver, front-porch voice interview), **diff-based co-author** (vibe_tavern, Aventuras), **surgical field edits** (Pyre), **editor passes** (front-porch), **versions** (vibe_tavern, ChungusHub), **quality gate against genericness** (Weaver).

### 4.6 Transparency
- Exact-payload inspector (TipsyTavern, TavernAI, Lumiverse dry-run), activation reasons (vibe_tavern), audit per message (Arousal Pub), request history with corrected token counts (ChungusHub), placement diagnostics (Lumiverse).

### 4.7 UI/UX
- Context meter on the input bar (vibe_tavern, AstraProjecta). Simple/Advanced split (Ryokan, vibe_tavern). Command palette (charon, SillyBunny). Per-chat appearance (AstraProjecta). Dialogue highlighting (front-porch, Aventuras). Separate phone design, not a shrunken desktop (Neconyan, Pyre, vibe_tavern, Glaze). Onboarding wizards (Mignon, serene-pub, charon).

### 4.8 Performance and platform
- Fast stacks: Tauri v2 + Svelte 5 + SQLite; Bun + Hono + SQLite (WAL, prepared statements, no ORM); single-executable builds (ChungusHub).
- Long chats: virtualized DOM (TauriTavern, Lumiverse), paginated DB reads, caches for tokenizers/embeddings/prompt assembly (Lumiverse), workers for heavy work.
- Phones: either a native app with local DB + sync (Aventuras, Glaze, Pyre, TauriTavern), or a **server + PWA** with server-side generation (PocketRisu, Neconyan, Marinara, vibe_tavern).

### 4.9 Agents / multi-pass
- Common hook points: pre-generation advisor, post-generation editor, side/background workers (SillyBunny's 4 stages, Lumiverse Council, Marinara agents, Glaze Studio).
- Cost and latency are the trade-off. The good designs make agents opt-in, run them on cheap models, run them in parallel, and gate them with decision models.

---

## 5. Gaps and opportunities for Mea

1. **One coherent memory system** instead of 2–3 overlapping ones. Layers, defaults that work, and an inspector that explains everything.
2. **Provenance everywhere:** every summary, fact, and tracker change links back to the messages it came from. Few apps do this consistently (Sonder, front-porch receipts, serene-pub citations).
3. **Edits that update memory:** almost no one handles "I edited message #412; which summaries and facts are now wrong?" Narrative Engine has rollback cascades; nobody has *dirty propagation*.
4. **Cache-aware context assembly:** prompt caching is the biggest speed and cost lever for long chats. Only extensions (Message-Chunker) and per-provider toggles touch it. Nobody designs the whole prompt around it.
5. **Rolling-summary drift:** nearly every rolling summary rewrites itself forever. Rebuilding the story-so-far from chapter summaries, and verifying summaries against their sources, is rare.
6. **Phone as a first-class reader:** chapter dividers, a recap when you return, who's-who popovers, a timeline scrubber. The *reading* experience of a long story is underserved.
7. **Narrative trackers without RPG baggage:** most tracker work lives inside RPG engines or ST extensions. Mea can offer clean, schema-driven, optional narrative trackers (time, place, outfit, mood, relationship, threads, promises).
8. **Creation that isn't generic:** Weaver-style interviews exist only in Lumiverse. Adding quality checks, a voice lab, and a test bench would set Mea apart.

## 6. Deliberately *not* copying

- Platform sprawl: games, social feeds, in-world phones, gacha, video, music, coding agents, card hubs.
- Group chat, multiplayer, RPG mechanics, image generation, VN mode, TTS (all out of Mea's scope).
- Branch trees and story maps (Mea has swipes plus a linear "rewind" with undo).
- Settings sprawl: ST-style walls of options, and macros with hidden placement rules.
- Extension ecosystems as a v1 dependency. They add security surface and weight. Keep clean internal modules instead.

## 7. License note

Most of these projects are **AGPL-3.0**. Lumiverse uses a source-available community license, and several (Simulith, alex-tavern, Fugue) are proprietary. **Borrowing ideas is fine; copying code carries license obligations** (for AGPL, if Mea is ever distributed or served to others). For a personal app that's never distributed this matters less, but write Mea's code yourself to keep options open.
