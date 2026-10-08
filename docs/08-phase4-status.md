# Phase 4 status

> Phase 4 goal: characters and personas that aren't generic (the creator studio).
> IDs refer to [02-mea-ideas.md](02-mea-ideas.md).
> Phase 4 is complete. Studios live under **Studio** in the sidebar (`/creator`); card tools live in the character and persona editors; prompt features live in presets, chats and Settings.

## Delivered, by roadmap ID

| Area | IDs |
|---|---|
| Characters | CHAR-06 (variants), CHAR-07 (notes and source link; tags, folders and favourites were already there), CHAR-08 (interview-first creation), CHAR-09 (your words first), CHAR-10 (directions, Expand my idea, Extend my answer), CHAR-11 (field AI actions as a diff), CHAR-12 (sort messy notes into fields), CHAR-13 (quality checks and an editor's review), CHAR-14 (voice lab), CHAR-15 (greeting workshop), CHAR-16 (test bench), CHAR-17 (built-in rules), CHAR-18 (companion lorebooks) |
| Personas | PER-03 (persona lorebooks), PER-04 (the same studio and tools), PER-05 (variants), PER-06 (character ↔ persona). PER-07 (persona state) was already delivered as TRK-21 in Phase 2 |
| Prompts | PROMPT-06 (global → character → chat), PROMPT-07 (preset controls), PROMPT-08 (regex scripts), PROMPT-09 (helper prompt sets), PROMPT-10 (per-model prefill; reasoning effort per model already existed) |
| Lore | LORE-16 (documents become entries), plus the Lore Studio |

## The Lore Studio

The studio builds a lorebook with you, in the same shape as the character studio (CHAR-08): **Start → Questions → Plan → Write & review → Save**. Nothing goes into a lorebook until you've reviewed it and pressed Save.

### Five ways to start

| Start from | What happens | Roadmap |
|---|---|---|
| **An idea** | You describe the world in your own words. "Show me directions" offers three different takes you can fold in, and you can lean them ("darker"). | CHAR-10, for worlds |
| **A character** | A companion lorebook drawn from the card: the events of their past, the people in their life, the places they know. The plan skips lore the character already has, and the book is linked to the character. | CHAR-18 |
| **A persona** | The same for your own character: family, home, history, the things they carry. Linked to the persona. | PER-03 |
| **A document** | Markdown or plain text (a setting bible, wiki page or notes). Headings become entries, sub-headings become folders and parents, and a single top heading becomes the title and overview. "Name: definition" glossaries and plain prose work too. **No model call**: your text is kept word for word, and you can polish any entry with the model afterwards. | LORE-16 |
| **A book you have** | Mea finds names the book mentions that have no entry, and plans entries to fill the gaps. They are saved into the same book, and can sit inside existing entries. | — |

### The steps

1. **Start:** your idea (or the material) plus the *shape* of the book:
   - how many entries (about 8, 15 or 26)
   - entry length (lean, standard or rich)
   - which kinds (people, places, factions, things, concepts, events, rules)
   - tone, style notes
   - whether to invent secrets, whether to stick to the source only, and whether the overview becomes an always-on entry
2. **Questions** (optional): what Mea understood, what's still unclear, and up to four pointed questions, each with *why it's asking*. Your answers are quoted to the model as the author's own words and outrank anything it would invent (CHAR-09, for lore).
3. **Plan:** an **overview** (the ground truths every entry is written against) and an **outline**. You can:
   - edit, reorder, nest, file into folders, leave out, or mark always-on any item
   - add your own items
   - "Plan more" with a request ("more villains", "places outside the city")
   - "Plan again" from scratch (written entries are kept)
4. **Write & review:** entries are written **in the background, one at a time, in plan order**, so later entries see what earlier ones established. You can leave the page or lock the phone; they'll be waiting. For each entry you can:
   - edit everything: content, keywords, aliases, essentials, secrets with who knows them
   - **rewrite** with one tap ("Shorter", "Darker", "Add a secret"…) or your own instruction; the previous version can be restored
   - leave it out
5. **Save:** into a new lorebook or one you have, and choose where it applies (every chat, characters, personas). Saving again later adds only the new entries, into the same book.

### Quality checks (review step)

Instant checks, no model call:
- **Generic:** names models overuse (Elara, Kael, Thorne…) and filler phrases ("tapestry", "testament to"…). These are notes, not errors: keep them if you chose them.
- **Keywords:** missing, too common to be useful ("magic", "city"), or shared with another entry or the target book.
- **Size:** too thin, or over the length target (a warning if the entry is always on), and no essentials line on a long entry.
- **Secrets:** nobody knows them, or they're known only by people who have no entry.
- **Duplicates:** a title the book already has.

**Check for contradictions** is an optional model pass that finds conflicting ages, dates, family ties, places and rules between entries, with links to each.

There's also a cost line: total tokens, always-on tokens, and the average size of an entry when it fires.

### Where to find it

- **Lorebooks → Lore Studio** (and a notice when a draft is waiting).
- **Character → Lore tab → Build a companion lorebook.**
- **Personas → Lorebooks → Build with the studio.**
- **A lorebook → Grow** (next to "Entry").
- Drafts are kept until you delete them, and they continue on any device: `/lore-studio`.

## Expand my idea

Takes the few lines you wrote and turns them into a fully fleshed-out concept, section by section.

- **Where:** the Start step of the Lore Studio, and the Idea step of the character and persona creator.
- **Worlds get eleven sections:**
  - premise, setting, central tension, powers and factions
  - places, people, history, rules and limits
  - secrets and mysteries, tone and themes, story hooks
- **Characters get twelve sections:**
  - concept, look, personality, voice (with sample lines), past
  - wants and fears, flaws, relationships, secrets, daily life
  - what they want from {{user}}, story hooks
- **Personas get nine sections:**
  - concept, look, personality, voice, past
  - relationships, skills and limits, what they want, story hooks
- **What you can do with it:**
  - edit any section or its heading, add or remove sections
  - **Go deeper** on one section (more specifics, consequences, connections)
  - **Rewrite** one section your way
  - **Rework** all of it with a steer ("darker", "fewer factions"); your edits are kept
- **Where it goes:** the expansion is fed to every later step (questions, plan, bible, every entry and field) as canon. "Use it" turns that off.
- **Extend my answer** (CHAR-10): next to every interview answer, it pushes your draft further and keeps your words.

### Where the quality comes from

The prompts share one set of craft rules (`CRAFT` in `creator/expand.ts`):
- The author's words are canon, kept verbatim where possible.
- Make decisions: no hedging, no menus of options.
- Be specific: names, numbers and sensory detail, with traits shown as behaviour.
- Give it internal logic: causes, costs and connections.
- Every part must hand a storyteller something to play.
- Avoid the stock names and filler phrases models overuse.

Creative steps run on the **summarizer** route (the stronger model) at a higher temperature. Interview steps use the helper route. Pure formatting (tags, pronouns) runs cool.

## The character and persona creator

The roadmap's CHAR-08 flow, for both characters and personas (PER-04): **Idea → Questions → Bible → Write & save**.

1. **Idea:**
   - your words (a line, notes, or a card to rework)
   - **the world they live in** (lorebooks, or an unsaved Lore Studio draft)
   - Expand my idea
   - the card's shape: one character or a narrator, point of view and tense for greetings, length, how many alternate greetings, tone and style
2. **Questions:** what Mea understood, then pointed questions, each with why it's asking (CHAR-09: your answers outrank the model).
3. **Bible:** the single source of truth.
   - **Characters:** identity, appearance, personality, voice, backstory, wants and fears, flaws, relationships, secrets, habits, what they want from {{user}}, story hooks.
   - **Personas:** a shorter set, with skills and limits.
   - Narrator cards get narrator-specific sections (premise, narration voice, main cast).
   - **What you can do with it:**
     - **Sharpen** or **Rewrite** any section
     - **Rework** the whole bible with a steer (your edits are kept)
     - **Check it like an editor** (CHAR-13): a model review for generic choices, contradictions with the world, missing essentials (voice, want, flaw, tension) and flat spots. Each issue has a one-tap **Apply fix**.
4. **Write & save:** every field is written from the bible in the background, in order, so the greeting sees the description and each alternate greeting sees the others.
   - **Character fields:** description, personality summary, scenario, greeting, alternate greetings (CHAR-15), example dialogue in `<START>` blocks, tags, creator notes.
   - **Persona fields:** description, appearance, personality, background, pronouns.
   - **Rewriting:** one tap per field (Shorter, More vivid, More in their voice, Less purple…), your own instruction, or a fresh draft; the previous version can be restored.
   - **Checks:**
     - a greeting that writes {{user}}'s actions, words or feelings (the writer also retries once when it catches this)
     - point of view slipping, no hook at the end
     - greetings that repeat each other
     - example dialogue without `<START>` / `{{char}}:` lines
     - stock names and phrases
     - bloated permanent fields, with token costs
   - **Saving:** creates a real card (or persona, optionally your default) and **links the world's lorebooks** to it. Saving again updates it, and cards keep version history.
   - **Then:** open it, start a chat, or build its companion lorebook.

**Rework an existing card or persona:** "Rework" on a character page, or "Rework in the studio" on a persona. The draft starts with every current field filled in and the world already linked, so you rewrite only what you choose.

## How the three link

| From | To | How |
|---|---|---|
| A lorebook (or a Lore Studio draft) | A character or persona | Pick it as their **world**: every step writes against it, and it's linked on save. An unsaved Lore Studio draft works too, and its book is linked once you save it. |
| A person entry in the Lore Studio | A character card or your persona | **Make a character card** / **Make it my persona** on the entry. The entry's text, secrets and world come along, and the entry then links to the draft and the saved card. |
| A saved character or persona | A lorebook | **Build a companion lorebook** opens the Lore Studio with the **bible** as source, so the lore matches the card. The plan skips what the world already covers. |
| A character | A persona (and back) | **Make a persona from this** on the bible step: the idea, expansion, answers, world and shared bible sections carry over. |
| A card or persona you have | The creator | **Rework**, as above. |

The **Creator Studio** page (`/creator`) is the front door for all three: a character, a persona or a world, with every draft in progress listed together. Home and Personas have **Create** buttons that go straight there.

## Card tools in the editors

Everything in the creator also works on a card or persona you already have, in the regular editors. Every tool reads the card **as it is on screen**, saved or not, and returns a proposal; nothing changes until you accept it.

- **Field AI actions** (CHAR-11): the wand next to each field.
  - **Actions:** Expand, Condense, Make it prose (W++ and brackets become sentences), Fix point of view and tense, Rewrite in a style, Change something (a precise edit; nothing else moves), and on greetings Stop it acting for {{user}}.
  - **Review:** the result opens as a **diff**: take it all, or tick only the changed paragraphs you want.
- **Sort my notes** (CHAR-12): paste notes in any shape. Each field's proposal shows as a diff, with where each piece went and what didn't fit (kept out). Tick the fields to take.
- **Check this card** (CHAR-13): a quick check per field (puppeting, point of view, missing hook, example format, W++, stock names and phrases, bloat). **Ask an editor** adds a model review whose fixes open as a diff.
- **Greeting workshop** (CHAR-15): a new alternate greeting from a situation (or one-tap ideas), in the point of view and tense you pick, never acting for {{user}}.
- **Rules** (CHAR-17): **Draft rules** writes a short re-anchor block into the card's post-history instructions: the voice to keep, what they'd never do, the dynamic to preserve. It starts with `{{original}}`, so the preset's own instructions stay. The creator now writes this field too.
- **Voice lab** (CHAR-14): sample lines in situations you pick (calm, angry, lying, your own), **keep** the ones that sound right, and add them to the example dialogue in one tap. Kept lines are saved with the character as its voice fingerprint, for the drift detector in Phase 5.
- **Test bench** (CHAR-16): a sandbox chat with the card on screen, using this character's preset, controls, lore and your persona, exactly like a real chat.
  - **Probes:** one tap each: introduce yourself, bad news, what do you want, flirt, accuse, be rude, ask for help.
  - **Controls:** pick the greeting, persona and persona variant; regenerate; stop.
  - **Nothing is saved:** no chat, no memory. Requests appear in history as "bench".
- **Personas** (PER-04): the wand on every field, Sort my notes, Check this persona, and Variants.
- **Notes and source** (CHAR-07): private notes and the card's source link, on the Advanced tab.

## Variants (CHAR-06, PER-05)

A variant is the same character (or you) in another outfit, era or universe.

- **Overlay, not copy:** it overrides only the fields you choose; everything else follows the base, so edits to the base reach every variant. Nothing is duplicated.
- **Drafting:** **Draft it** from an idea ("winter outfit", "modern AU", "ten years later"). The model rewrites only the fields that must change, and you review the diff before saving. Or start blank and change fields by hand.
- **Portraits:** a variant can have its own portrait from the gallery.
- **In chats:**
  - **Start:** **Chat** on a variant starts a chat that opens with the variant's greeting and is named after it.
  - **Switch:** the chat panel picks which variant the character plays and which variant **you** play.
  - **Delete:** deleting a variant sends its chats back to the base.

## Prompts

- **Layered overrides** (PROMPT-06): each character has **defaults for its chats** on the Advanced tab: preset, model profile, author's note, story truths and controls.
  - **Order:** chat → character → global. A chat's own choice wins; empty falls through.
  - **Shown in the panel:** the chat panel names the source ("Mira's default (Terse)").
- **Preset controls** (PROMPT-07): friendly switches a preset offers.
  - **Defaults:** More dialogue, Slow burn, Mature content, and a Narration focus choice.
  - **Where to set them:** flip them per chat in the panel, or per character on its Advanced tab.
  - **Editing:** add or edit them in the preset editor (switches or choices, each with its instruction). What's on fills a new **Preset controls** block. Existing presets gain the block and the defaults automatically.
- **Regex scripts** (PROMPT-08): Settings → Regex.
  - **Modes:** **display only** (how messages look), **prompt only** (what the model is sent), or **stored text** (applied when a reply finishes or you send a message).
  - **Scope:** for replies, your messages, or both, optionally only with certain characters.
  - **Tester:** each script has a live tester.
  - **Import:** SillyTavern regex exports import directly.
- **Helper prompt sets** (PROMPT-09): Settings → Helper prompts.
  - **What you can change:** add to or replace any helper prompt: memory, trackers, the world, the checker, the Archivist, the quiz, lore assist, the Chronicle, both studios, the card tools. Also a line for every helper.
  - **What you can see:** each one shows the prompt as last sent.
  - **Sets:** changes live in named sets you switch between. Mea's defaults are never edited, so your sets survive updates.
  - **Safety:** the reply format a helper needs is always kept, even when you replace a prompt; `{{default}}` puts Mea's prompt inside yours.
- **Per-model prefill** (PROMPT-10): a model profile can have **its own prefill**. Set (even empty), it replaces the preset's; useful for models that refuse prefills, or need a different one.

## Faster first load

Home and the chat are in the first download; every other screen loads the first time you open it. The first load dropped from 224 KB to **120 KB** of JavaScript (gzipped), so the new tools cost nothing up front.

## Build notes

- **Server, lore:**
  - `studio.ts`: drafts, the model steps (read-back, directions, outline, entry writer, contradictions), the background writer, review and save.
  - `ingest.ts`: document parsing.
  - `quality.ts`: the checks.
- **Routes:** `routes/studio.ts` under `/api/lore-studio`:
  - CRUD for drafts and items
  - `readback`, `directions`, `outline`, `write`, `stop`, `review`, `consistency`, `commit`
  - `parse`, a document preview that makes no draft
- **Job:** `lore.studio` writes queued entries one by one. It re-reads the draft between entries, so your edits and Stop apply at once. A quota pause puts the entry back in line, and a restart resumes where it was.
- **Event:** `studio.changed` streams progress to every open device.
- **Migration 5:** the `lore_drafts` table.
- **Helpers:**
  - `callJson` gains an optional `temperature`. Planning and writing run warmer (0.75–0.9) than extraction (0.3); "only what the source says" runs at 0.3.
  - Read-back and directions use the **helper** route; the outline, entries and contradiction check use the **summarizer** route (the stronger model).
- **Web:**
  - `views/LoreStudio.svelte`
  - `components/lore/studio/`: Start, Seed, Options, Questions, Plan, Review, ItemCard
  - `lib/studio.svelte.ts`, a draft session. Your typing is saved after a pause, never overwritten by the server's copy while pending, and flushed before any action that reads the draft.
- **Creator, server** (`server/src/creator/`):
  - `expand.ts`: Expand my idea, Go deeper, Extend my answer, the shared craft rules
  - `creator.ts`: drafts, read-back, bible, editor check, the field writer, review, save, companion lore
  - `checks.ts`: card checks
  - `world.ts`: world context from lorebooks or a Lore Studio draft, trimmed to a token budget
- **Routes:** `routes/creator.ts` under `/api/creator`, and `expand` routes on `/api/lore-studio`.
- **Job:** `creator.write`, the same pattern as `lore.studio`.
- **Event:** `creator.changed`.
- **Migration 6:** the `creator_drafts` table.
- **Lore Studio additions:** drafts gain `expansion`, and items gain `links` (to a creator draft, character or persona).
- **Web:**
  - `views/Creator.svelte`, `components/creator/` (Hub, Idea, Questions, Bible, Write, Field, WorldPicker)
  - `components/studio/` (ExpandPanel, ExtendButton)
  - `lib/creator.svelte.ts`, and `lib/drafts.svelte.ts`, a saver both studios now share
  - `autosize` can now be given the value, so text written in the background re-fits its box
- **Card tools, server:**
  - `creator/tools.ts`: field actions, notes, checks, review, greetings, rules, voice
  - `services/bench.ts`: the test bench, using the same layering as real chats
  - `services/variants.ts`: overlays, apply, the drafted variant
  - `services/charsettings.ts`: per-character settings
  - `services/layers.ts`: chat → character → global, controls and prefill for every request
- **Prompt features, server:**
  - `lib/regex.ts` and `lib/prompts.ts` (helper prompt sets: a registry by helper kind, applied inside `callJson`/`callText`)
  - preset controls in `prompt/preset.ts` and a `controls` block in `assemble.ts`
- **Routes:** `routes/cardtools.ts` (`/api/card-tools/*`, `/api/{characters,personas}/:id/variants`, `/api/variants/:id`), `GET /api/prompts/service`.
  - The chat payload gains `variants`, `personaVariants` and `defaults`.
  - Settings gain `regex.scripts`, `prompts.sets` and `prompts.active`, validated on save.
- **Migration 7:** `characters.settings` and the `variants` table.
- **Web:**
  - `components/cardtools/`: FieldTools, DiffModal, NotesSorter, CardCheck, GreetingWorkshop, VoiceLab, TestBench, VariantsPanel, CharacterDefaults
  - `components/presets/`: ControlsEditor, ControlSwitches
  - `components/settings/`: Regex, Prompts
  - `lib/diff.ts`, `lib/regex.svelte.ts`
  - Lazy-loaded views in `App.svelte`
  - A `portal` action so dialogs and menus render at the end of the page
- **Saved entries** use the Phase 3 fields in `extra`: type, aliases, essentials, secrets, folder and parent. Typed entries also fire when their subject is in the scene (LORE-06), and SillyTavern exports carry everything.

## Verified

- **Server tests:** 188 pass (`bun run test`).
- **15 tests in `cardtools.test.ts`:**
  - field actions and the route's validation
  - notes sorted with placements and leftovers
  - the quick checks and the editor's review
  - a greeting that acted for {{user}}, caught and rewritten
  - rules that keep `{{original}}`
  - voice lines kept on the character and turned into examples
  - **Variants:**
    - drafted (only changed fields kept, unknown fields dropped)
    - played in the prompt, opening a chat with their greeting
    - deleted back to the base
    - persona variants in the prompt
  - **Layered overrides:** the character's preset, note, controls, story settings and truths reach the prompt, and the chat's own choices win
  - controls text
  - per-model prefill as the last message, never sent as a parameter
  - **The bench:** built like a real chat with unsaved edits, lore and filled macros; streamed; nothing saved
  - **Regex:** modes, targets, scope, `{{match}}`, invalid patterns, SillyTavern import, prompt-only on the real prompt, settings validation
  - **Helper prompt sets:** append, replace, `{{default}}`, the kept reply contract, the line for every helper, and the real request carrying them
- **6 tests in `creator.test.ts`:**
  - expanding, deepening and editing in the Lore Studio, and the plan reading the expansion
  - **The full character flow,** in a world:
    - expand, questions, bible (your edits survive a rework), section rewrites, the editor check
    - the background writer, including a greeting that wrote {{user}}'s actions, was caught and rewritten
    - steered rewrites and restore, the review checks
    - saving, saving again (versions kept), and the companion lorebook
  - the greeting, point-of-view and example-dialogue checks
  - lore entry → character with the world carried along and links back both ways
  - character → persona, saving a persona as default, and reworking an existing card without blanking its fields
  - every creator route end to end
- **9 tests in `studio.test.ts`** (the Lore Studio, from the first delivery):
  - document parsing (headings, glossaries, prose, aliases), and saving with parents and folders, with no model call
  - quality checks
  - the full idea flow: questions and answers, directions, plan and plan-more, the background writer, steered rewrites and restore, stop, review, contradictions, saving, and saving again without duplicates
  - companion lorebooks for a card (skips existing lore, links the character), persona lorebooks
  - growing a book: gaps found, parents that are existing entries, saved into the same book
  - every route end to end
- **Type checks:** `tsc` and `svelte-check` report 0 errors and 0 warnings.
- **Clicked through in a browser** with the mock provider:
  - the idea flow from Start to Save, a second save into the same book, document import, and the character entry point
  - at the pane's width, at phone width (390 px, no sideways scrolling), and in dark mode

- **The creator, in a browser** with the mock provider:
  - **A character, start to finish:**
    - the Creator Studio page: Expand, an edit flushed before Go deeper
    - bible and editor check, the background writer
    - a live rewrite, save, companion lorebook
  - **The links:**
    - a world expanded and planned in the Lore Studio, and a person entry turned into a card
    - Rework from a character page
    - a persona made from a character's bible, written and saved
  - Apply fix
  - phone width (390 px, no sideways scrolling on any screen), and dark mode
- **The card tools, in a browser** with the mock provider:
  - **On the character page:** Condense as a diff and accepted, Sort my notes, both checks, the greeting workshop, the voice lab (kept line saved), the test bench (a probe streamed, no chat made)
  - **Variants:** drafted, saved, chatted as, picked in the chat panel
  - **Chat panel:** a control flipped and seen in the real prompt
  - **Settings:** a display-only regex shown in the chat while the stored text stayed the same, and a helper prompt set created
  - every character tab, personas, presets and the new settings tabs at phone width with no sideways scrolling
- **Bundle budget:** first load is 120 KB JS + 13 KB CSS gzipped (budgets: 250 KB / 60 KB).

### Fixes found while verifying

- **Dialogs opened from a field label inherited its style** (all capitals), and their clicks could reach the label. Dialogs and menus now render at the end of the page.
- **A proposal's text started with stray indentation** in the diff view.
- **Missing spaces** before "·" in a few headings (one of them older, in the Codex).
- **Helper prompts: "in use" looked like several switches that could all be on.** It's a dropdown now.
- **A test-only clash:** registering stand-in job handlers for the tracker jobs broke the tracker tests that ran after them. The new tests no longer do that; nothing in the app was affected.
- Earlier deliveries in this phase:

- **Reworking a card blanked fields you didn't rewrite.** The draft now starts with the card's current fields.
- **Text written in the background didn't resize its box** (a field, a deeper section, a rewritten entry). `autosize` now re-fits when the value changes.
- **A greeting point-of-view check missed "My" at the start of a sentence.**
- **The space between an issue and its fix was dropped.**

- **Second save made a second book:** after the first save, the save panel still offered "a new lorebook". It now says which book it's saving into, and adds only new entries there.
- **Review crashed on first open:** an entry card's open state started as `undefined`, which Svelte rejects for a bound prop with a default.
- **Gap finder clipped names:** names at the start of a sentence ("Captain Harrow…") were cut. Leading common words are now trimmed instead.
- **Accessibility:** the step buttons lost their names on phones, where the labels are hidden. They now have `aria-label`s.

## Not verified yet (needs your real setup)

- **Quality with real models:** expansions, bibles, editor checks, card fields, read-backs, outlines, entries, field actions, sorted notes, voice lines, variants and the bench were only checked against the mock (whose text is deliberately canned).
  - Try one character from a two-line idea with GLM. Check that the expansion commits to choices, the bible's voice has real sample lines, and the greeting never acts for you.
  - Try one small idea book and one companion lorebook.
  - Expansions and bibles are the largest calls (up to ~6k output tokens). Compare their cost, and the summarizer and helper costs, in Settings → Usage.
- **Regex scripts run as you write them:** a badly written pattern (catastrophic backtracking) can stall replies. Test new patterns in the tester first.
- **Mature content control:** it only says what the story may contain. Whether a model honours it depends on the model and its provider.
- **Big documents:** parsing is instant, but a 200-section setting bible hasn't been tried in the review screen.

## Development note

If Mea is already running on this machine (the Windows service on :7766), `bun run dev` can't start its API. The dev script honours `MEA_PORT`, and `.claude/launch.json` has a `mea-dev-alt-port` entry that runs the dev API on :7767.

## Next: Phase 5 (guards and polish)

- **Accuracy guards:** CON-03…05, CON-09, CON-10 (the drift detector can now use each character's kept voice lines), CON-12
- **Steering and summaries:** STEER-01…04, SUM-10…11, SUM-13…20
- **Interface, phone and offline:** UI-08…20, UI-24…25, MOB-07…13, ARCH-09, ARCH-11
- **Data, performance and security:** DATA-04…06, PERF-08…11, SEC-05…06, QOL-01…05
