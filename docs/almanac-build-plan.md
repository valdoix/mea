# Build plan: Almanac ideas, made stronger, in Mea

**Written:** October 11, 2026 · **Base:** Mea `main` after PR #21 · **Source list:** [almanac-ideas-for-mea.md](almanac-ideas-for-mea.md)

This plan builds every item from the ideas list (21 Almanac features and 10 recommendations). Most features go further than Almanac does. Nothing in it is a typed command: every action is a **button, chip, toggle or card**, placed where Mea already keeps that kind of control. **Meus** can do each action too, from a plain sentence ("skip to morning", "keep the Heaven secret off the page"), and it always shows its usual tick-to-apply card with Undo.

---

## 0. Read this first

### 0.1 What's already in Mea (found while planning)

These were checked in the code, so the plan builds on them instead of duplicating them:

| Idea | Already in Mea | So this plan… |
|---|---|---|
| Swipes give a different take | `generation.ts` passes the rejected take on a swipe (`rejectedTake`), and **Regenerate with a note** exists | upgrades it (§A2) |
| Time skip, recap, story truths, chapters | Buttons in the composer's tools tray, **Story** side | adds a full Desk around them (§F2) instead of new commands |
| Off-page endings that wait for you | World page **Waiting for your word**, Meus `world_fate` accept/soften/page | drops recommendation R7 |
| Prompt cost per section | The Inspector shows *Story so far* and *Recalled* tokens against their budgets | adds the ceiling and the cut report (§H1) |
| Promises with a due time, items with owners | `Obligation.due`, `Item.owner/holder/where` | adds windows, automatic kept/broken and rooms (§E2, §E3) |
| A helper plan before each reply | The **Advisor** (`steer/advisor.ts`) | grows it into the full separate planner model (§H3) |
| Selection menu | Highlight · Remember · Pin · That's wrong · Ask Meus | gets new buttons (§F3) |
| Group chats | Set aside in `docs/02` | still out |

### 0.2 Principles for every feature

1. **Buttons, not syntax.** No new slash commands and no `((…))` asides to learn. Every action is a button in an existing place (§0.3). Typing is only for content, such as a truth's wording.
2. **Meus can do it all.** Each feature adds a Meus change kind (in `server/src/meus/changes.ts`), so plain words work too, with a tick-to-apply card and Undo.
3. **Undo everywhere.** Anything Mea files, changes or infers shows as a chip or card with **Undo**. It goes through the existing `services/undo.ts` and the toast's Undo action.
4. **Branch-safe.** New state is keyed by message and swipe, or folded from tracker events (`trackers/fold.ts`). A swipe, an edit or a fork can never corrupt it.
5. **Rules first, model second.** Every check runs on rules for free. A model read is optional, runs on its own routed connection (Settings › Models › Routing), and respects quota shedding (`shouldShed`).
6. **Visible in the Inspector.** Anything that goes into the prompt gets a labelled section in the reply's Inspector (the receipt button), with its tokens.
7. **One PR per part** (Aline's rule from the Meus build), each with tests in `server/test/`, and `bun run test`, `bun run check` and `bun run build` passing.

### 0.3 Where buttons live (Mea's existing surfaces)

| Surface | What goes there |
|---|---|
| **Message actions** (⋯ menu and the swipe row under a reply) | Swipe with an angle, Learn from this swipe, Check again, Mark played |
| **Selection menu** (select text in a reply) | Pin as truth, Running bit, Add to calendar, Keep off the page, Never say this, Plant this |
| **Composer tools tray**, *Story* side | The Director's Desk (§F2) |
| **Side dock tabs** (Chat · Memory · Story · World · Meus · Notes) | Status tiles, Lessons, Secrets, Promises, People, Graph |
| **World page** | Subplots, Next beat previews, the relationship graph, pressures |
| **Story page** (Cast) | People, traits, rooms, belongings |
| **Codex** | Secrets, playbooks, lore categories |
| **Inbox** | Anything waiting for a yes or no: suggested lessons, proposed canon, playbooks to confirm |
| **Settings** | Defaults only. Per-chat choices live in the chat, mainly in Session Zero (§F1) |

---

## Phases at a glance

| Phase | Theme | Parts (one PR each) |
|---|---|---|
| **1** | Foundations | P1 shared building blocks |
| **2** | Swipes that teach | A1 Lessons · A2 Swipe with an angle |
| **3** | Secrets and canon | B1 Off the page · B2 Exposure clocks · C1 Canon cutoff · ~~C2 Playbooks~~ (dropped) |
| **4** | Quality | D1 More reply checks · D2 Adaptive craft coach · D3 Story health |
| **5** | People | E1 Hidden pressures · E2 Belongings and rooms · E3 Promises on the clock |
| **6** | Control | F1 Session Zero · F2 Director's Desk · F3 Selection asides · F4 Meus runs the Desk |
| **7** | World and time | G1 Calendars · G2 Relationship graph · G3 Next beat previews |
| **8** | Prompt and cost | H1 Ceiling and cut report · H2 Cost guard · H3 Planner model |
| **9** | Lore | I1 Lorebook format · I2 Creator plan · I3 Story → lorebook |
| **10** | Look and sound | J1 Scene plates · J2 Room colours · J3 Soundtrack |
| **11** | Safety net | K1 Golden scenarios · K2 CI |

Phase 11 can run in parallel from the start. Doing K2 early protects every later PR.

---

## Phase 1 · Foundations (P1)

Shared pieces that several features need, built once.

- **Slip registry** (`server/src/accuracy/slips.ts`). One list of checks: `{ id, label, severity, run(text, state, ctx) → Issue[] }`. The existing checks in `checker.ts` and `guards.ts` (trait, dead, name, time, leak, pov, tense, puppet, timeline) move into it unchanged, so new checks (D1, B1, C1) are one file each. A per-chat toggle sits on each check in **Chat › Guards**.
- **Prompt lanes.** One helper, `lane(id, label, text)`, makes a `PromptExtra` the Inspector lists by name. It's used for `[LESSONS]`, `[CANON]`, `[OFFPAGE]`, `[CRAFT]`, `[PRESSURES]`, `[PROMISES]` and `[PLAYBOOK]`.
- **Suggestions queue.** Inbox items get a `source` (lesson, canon, playbook, pressure, calendar). The Inbox filters by source, and each chat's side dock shows a count badge.
- **Change chips.** `ChangeChips.svelte` grows a generic "filed from your message" chip with Undo, which A1, E3, F3 and G1 reuse.
- **Seeded dice.** `sim/dice.ts` is exposed as `seeded(chatId, seq, salt)` so pressures, Next beat previews and the soundtrack agree across swipes.
- **Migration 18.** New tables `lessons`, `secrets_offpage`, `playbooks` and `calendars_custom`, plus a `chat_setup` JSON column for Session Zero.

**Done when:** current checks pass through the registry with no behaviour change, and the Inspector shows lanes by name.

---

## Phase 2 · Swipes that teach

### A1. Lessons from swipes

**What you get:** when you swipe past replies and keep one, Mea works out what the rejected takes got wrong and suggests it as a rule for this story. Lessons you keep go to the model every turn.

**Beyond Almanac**
- **Three sources:** rule slips (from the slip registry), an optional model comparison of the kept and rejected takes, and *your* edits. When you edit a reply, the difference is a lesson too ("cut her apology" → "Wren doesn't apologise easily").
- **Scope:** each lesson applies to *this story*, *this character* (it follows the card into new chats) or *all stories* (for writing habits).
- **Strength:** a lesson that keeps getting broken moves up the prompt and is checked after each reply. One that hasn't been needed in 200 messages fades to "resting" and stops costing tokens.
- **Evidence:** each lesson links to the rejected and kept takes, so you can see why it exists.

**Buttons**
- Under a reply you kept after swiping: a small **"2 lessons from your swipes"** chip. It opens cards with **Keep**, **Edit**, **Not this** and a scope picker (Story / Character / Everywhere).
- Message ⋯ menu: **Learn from this swipe**, which runs the comparison on demand.
- Side dock › **Story** › new **Lessons** section: the list, with on/off toggles, strength bars and **Add a lesson**.
- Settings › Guards: **Suggest lessons:** Off / Rules only / Rules + model.

**How it's built:** `server/src/steer/lessons.ts` (ported from Almanac `core/autopsy.ts` `ruleFor`), triggered when a swipe is kept (the active swipe changes and a new user message follows it). The `lessons` table holds id, chat, character, scope, text, why, quote, msg, status, strength, by and last broken. There's a `[LESSONS]` lane, a Meus `lesson` kind, and the checker re-reads kept lessons through an optional model pass.

**Done when:** a rejected take that named a dead character's speech produces a "doesn't speak, is dead" lesson, keeping it puts it in the next prompt, and a test covers fading.

### A2. Swipe with an angle

**What you get:** today a swipe gets a fresh take and can carry a note. This makes the swipe itself the steering tool.

**Beyond Almanac**
- The rejected take's *opening* and *main beat* (not just its first lines) go to the model with "do something else". After several swipes, all the rejected takes are summarised, so the fifth swipe doesn't drift back to the first.
- **Angle chips** on the swipe arrow: **Another direction**, **Quieter**, **More tension**, **More dialogue**, **Shorter**, **From her side** (a POV hint), and **Surprise me**. Each is a one-shot cue.
- **Keep this part:** select a sentence in the current take and press **Keep this, redo the rest**. The new take starts from that sentence.
- **Side-by-side:** a **Compare** button puts two swipes next to each other with the differences highlighted, then **Keep left / Keep right**.

**Buttons:** long-press or right-click the → swipe arrow for the angle chips. **Keep this, redo the rest** in the selection menu. **Compare** in the swipe row when there are 2+ takes.

**How it's built:** extend `rejectedTake()` into `rejectedDigest()`. Angles are presets of the existing note-for-this-attempt. Prefix-keeping uses the continue path with the kept prefix. Compare is a new modal that reuses `DiffModal.svelte`.

---

## Phase 3 · Secrets and canon

### B1. Secrets kept off the page

**What you get:** a secret can be held back from the *narration*, not only from characters. You choose the words never to use yet, and how the story may hint at it.

**Beyond Almanac**
- **Reveal plan:** each secret can have a planned reveal: *never*, *when I say*, *after a set message count or story date*, or *when its exposure clock fills* (B2). When the condition is met, a card asks **Reveal now / Hold**.
- **Rewording before the prompt** covers summaries, memories, journals, Codex pages and lore entries. Rewordings are cached, and the Inspector shows them under **Reworded for the secret**.
- **Hint budget:** set how often the story may hint (*never*, *rarely*, *slowly building*). The model gets one allowed hint at a time, which builds dramatic irony on purpose.
- The slip check (D1) flags any "never say" word in a reply, with **Reword this sentence** as a one-click fix that rewrites only that sentence.

**Buttons**
- Codex › a fact or secret › **Keep off the page** toggle. It opens fields for *Never say* (chips), *May hint as* and *Reveal when*.
- Selection menu: **Never say this** (adds the selected word to a secret) and **Keep off the page** (creates an off-page secret from the selection).
- Side dock › **Story** › Knowledge: a 🔒 badge on off-page secrets, and **Reveal now**.

**How it's built:** `secrets_offpage` keyed to the tracker fact id. `server/src/accuracy/offpage.ts` does the rewording with a cache keyed by content hash, and runs on every memory block in `memory/context.ts` before assembly. It adds an `offpage` slip check and an `[OFFPAGE]` lane.

### B2. Secret exposure clocks

**What you get:** each secret has a 0–6 clock and a ranked list of who is closest to finding out, and why.

**Beyond Almanac**
- The clock moves for real reasons the trackers already record: a keeper in earshot of the person kept from, a clue pointing at it (`Clue.pointsTo`), a slip in a reply, rumours in the world sim (`sim/news.ts`).
- **Pressure on purpose:** buttons to **Raise the stakes** (+1, and the next scene puts the secret at risk) or **Cool it down** (−1).
- When the clock fills, the secret comes out *on the page* in a scene, offered as a card (**Let it come out / Hold one more scene**), never by itself off the page.
- The relationship graph (G2) can colour people by how close they are to the secret.

**Buttons:** Codex › secret › clock dial with **+ / −**, **Raise the stakes** and **Cool it down**. A Status tile in the Chat tab: **"Secret at 5/6"** opens it.

**How it's built:** `server/src/trackers/exposure.ts`, folded from events, so it's branch-safe. The world sim feeds rumour hops into it.

### C1. Canon cutoff

**What you get:** the chat knows where the story stands in its source and what hasn't happened yet. Nothing from later leaks in.

**Beyond Almanac**
- **Suggest** uses Mea's existing canon research (`creator/research.ts`, the fandom wiki reader) to build the list from the actual wiki: later events, later characters, later reveals and later terms, each with its source.
- **AU divergence:** mark canon events that *won't* happen in this story ("Jenny lives"). They become truths automatically.
- **The cutoff moves:** when a summary shows the story has passed a canon event, a card offers **Move the cutoff forward**.
- The slip check flags later terms *and* later characters appearing early, with **Reword**.

**Buttons:** Chat tab › **Canon** card with a source picker, **Suggest from the wiki**, and lists of *Hasn't happened* / *Won't happen here*, each item with ✕. Proposals arrive in the Inbox with **Accept all / Review**.

**How it's built:** `server/src/accuracy/canoncut.ts`, a `[CANON]` lane, a `canon` slip check, and research reuse. It's stored in chat settings.

### C2. Playbooks

> **Dropped** (October 11, 2026): playbooks are not being built. The playbook parts of I1 (Upcoming and Scene entries becoming playbooks) and the `[PLAYBOOK]` lane are dropped with it; migration 19 removes the unused table.

**What you get:** lorebook entries that script future scenes ("When Buffy learns…") are no longer read as things that already happened.

**Beyond Almanac**
- **Detection:** future-tense and conditional patterns, plus the Dream Weaver depth-book titles (I1). Anything Mea isn't sure about goes to the Inbox as **Is this a playbook?** with **Yes / No**.
- **Readiness meter:** each playbook shows how close the story is to it (matching keys, people present, place, time). At *ready*, it goes in once, marked *not history*.
- **You direct:** **Set it up next**, which nudges the story toward the playbook through a cue, **Hold** and **Mark played**.
- **Branch-safe retire:** a playbook retires when a summary shows the scene happened. Swiping back un-retires it.
- It never fires if it would give away an off-page secret (B1).

**Buttons:** Codex › new **Playbooks** list with a readiness bar, **Set it up next**, **Hold** and **Mark played**. The message ⋯ menu has **This played out the playbook…** with a picker.

**How it's built:** the `playbooks` table, a filter in `lore/activate.ts` that removes playbook entries from keyword activation, `server/src/lore/playbooks.ts` for readiness scoring, and a `[PLAYBOOK]` lane.

---

## Phase 4 · Quality

### D1. More reply checks

New checks, each one file in the slip registry:

| Check | Rule |
|---|---|
| **Not in the scene** | A speaker who isn't present by the tracker (`Character.tier !== "spot"`) or in transit |
| **Clock backwards** | A reply implies an earlier time than the clock, outside a flashback |
| **Planning left in** | `<think>`, planning headings or checklist lines left in the prose |
| **Off-page word** | From B1 |
| **Later canon** | From C1 |
| **Broken lesson** | From A1 |
| **Promise forgotten** | Someone due somewhere who isn't mentioned (E3) |
| **Object teleport** | An item used by someone who doesn't hold it and isn't near it (E2) |
| **Invented past** (model, optional) | Claims about past events the memory record doesn't hold |

**Beyond Almanac:** each finding offers **Fix this sentence**, which rewrites only that sentence and keeps every other word, as well as **Dismiss** and **Make it a lesson**. Findings go into the next turn's note, so the slip isn't repeated.

**Buttons:** the existing continuity flags in the reply, plus **Check again** in the ⋯ menu, and per-check toggles in Chat › Guards.

### D2. Adaptive craft coach (anti-slop that learns)

**What you get:** instead of a fixed banned list, Mea measures the last replies and gives the model three specific things to avoid and one technique to try.

**Measures:** repeated 3–5 word phrases, the same sentence openings, monotonous paragraph shapes, filter words ("she felt", "he noticed"), em-dash and ellipsis density, lists of three, dialogue-ratio drift, overused gestures ("a breath she didn't know"), and repeated similes.

**Beyond Almanac**
- **Personal baseline:** the coach learns your story's normal rhythm, so it flags drift, not style.
- **Banned-list growth:** a phrase that keeps coming back is offered as a banned phrase in one tap (it joins Settings › Writing).
- **Technique rotation:** techniques come from a library (subtext in dialogue, a concrete sensory anchor, a cut on an image, an interruption…) and never repeat within ten replies.
- A **Craft** meter in the Inspector shows this turn's numbers.

**Buttons:** the side-dock Chat tab gets a **Craft** tile ("3 habits watched") that opens the list with **Ban it**, **It's fine** and **Pause coach**. The lowest level is a toggle in Settings › Writing.

**How it's built:** `server/src/steer/craft.ts`, pure text statistics with no model call, cached per message, plus a `[CRAFT]` lane.

### D3. Story health

**What you get:** a single **Story health** tile for the last 20 replies, scoring continuity slips, leaks, repetition, missing ledger lines, broken lessons and cost.

**Beyond:** each part clicks through to its cause (a flagged reply, a lesson, the craft list). A **Fix the top 3** button sends them to Meus as one change card. A weekly trend sparkline shows whether the story is getting healthier.

**Buttons:** a Status tile in the Chat tab, and the Home page's chat cards show a small health dot.

**How it's built:** `server/src/accuracy/health.ts` aggregates existing flags, lessons and craft stats. Nothing new is stored.

---

## Phase 5 · People

### E1. Hidden pressures

**What you get:** each new important character privately draws a pressure that fits the genre ("is grieving and has told no one"). It shapes how they act, quietly.

**Beyond Almanac**
- **Grounded draws:** the pressure is drawn from what the card, lore and story already say about the person, with the genre deck as a fallback. The draw is seeded, so swipes agree.
- **Pressures evolve:** they grow, crack (a scene where it nearly shows), or resolve, and resolving one moves a bond.
- **Dramatic irony view:** a narrator toggle shows every pressure and what *you* know that *they* don't.
- **Your hand:** **Redraw**, **Write my own**, **Lock** and **Bring it to a head** (the next scene tests it).

**Buttons:** Story page › each person › a 🂠 **Pressure** card with a hidden/shown toggle and the buttons above. World page: a **Dramatic irony** toggle.

**How it's built:** `server/src/trackers/pressures.ts` (deck from Almanac `core/pressures.ts`, extended with Mea's genre list in `prompt/mea.ts`), stored as tracker events with source `engine`, plus a `[PRESSURES]` lane for present characters only.

### E2. Belongings and rooms

**What you get:** places have owners, people have rooms, and things live somewhere.

**Beyond Almanac**
- `Place` gets `owner`, `kind` (room, home, shop…) and `contents`. In someone's room, the note says what they keep there and what has changed since you were last in it.
- **Object history:** each important item has a trail of who held it, where and when, and the time slider (G2) can show it.
- **Gifts matter:** a gift moves a bond, and losing a gift is noticed.
- The object-teleport check comes from D1.

**Buttons:** Story page › person › **Rooms** and **Belongings** with **+ Add**, drag an item to a person or place, and **Set as theirs**. Selection menu: **This belongs to…**

**How it's built:** extend `trackers/types.ts` (`Place.owner/kind`), the fold, and `dsl.ts` (`room A: …`, `keeps A: item @ place`). Note lines go in `trackers/note.ts`.

### E3. Promises on the clock

**What you get:** promises and meetings get a time window. Mea notices when they're kept or broken.

**Beyond Almanac**
- Detected from dialogue and ledger lines, and from *your* message. Each one shows as a chip with Undo.
- A **meeting** is kept when both are present in the window, and broken when someone is stood up. Kept promises raise trust. Broken ones lower trust and add resentment, scaled by how important the promise was.
- **Reminders:** an upcoming promise shows on the Status tile and in the note shortly before it's due ("you promised Willow you'd be at the Bronze at nine, in 40 minutes").
- **Your call:** an automatic "broken" can be overridden with **They had a reason** (the bond doesn't move) or **Forgive**.

**Buttons:** side dock › Story › **Promises** with a countdown, **Kept**, **Broken**, **They had a reason** and **Forgive**. A Status tile shows the next one due.

**How it's built:** extend `Obligation` with `window` and `importance`, and add a `promises.ts` evaluator on each fold that checks presence against the window. The bond deltas go through existing bond events.

---

## Phase 6 · Control (no commands)

### F1. Session Zero

**What you get:** a warm setup window when a chat starts. Each answer is a tap.

**Pages (one screen each, skippable):** *Genres* (the first tapped leads) · *Tone and pace* · *Who writes your character* (sealed / shared / open) · *Romance pace* · *Difficulty* · *Intimacy and hard limits* (chips) · *World* (calendar G1, climate, start date and time) · *Canon* (C1, for fandom stories) · *Trackers to show* · *Look* (room, colours J2, music J3 on or off).

**Beyond Almanac**
- **Pre-filled** from the card, the persona, the lore and the character's defaults (`charsettings.ts`). You confirm rather than fill in.
- **Live preview:** a sample opening paragraph is re-written as you change tone or POV (one cheap call, optional).
- **Presets:** **Save as my usual** and **Use my usual** for quick setup.
- **Reopen any time:** Chat tab › **Story setup**. Changes after the start become a card ("Tone changed to Dark from message 40") that shows in the story's timeline.

**How it's built:** `web/src/components/chat/SessionZero.svelte`, a modal shown when a new chat has no `chat_setup`. The answers map onto existing chat settings (`layers.ts` story dials, guards, trackers and theme). Nothing new for the prompt.

### F2. The Director's Desk

**What you get:** one panel of big buttons for running the story, on the **Story** side of the composer's tools tray (it already holds Previously on, Skip ahead, Chapter, Remember and Ask).

| Button | What it does |
|---|---|
| **Skip ahead** | Chips: *30 min · 1 hour · Until evening · Until morning · Next day · A week* and *Custom*, plus an optional "what happened meanwhile" |
| **Previously on…** | (exists) plus a **Since I was away** variant |
| **Report: Bonds** | A card with every bond's change since the chapter began, with arrows |
| **Report: Threads** | Open, stalled and ripe threads, with **Push this one** |
| **Report: Secrets** | Clocks, who's close, and off-page secrets |
| **Story audit** | Runs every check over the last N replies and opens Story health |
| **End scene · New chapter** | (exist) |
| **Cut to…** | Pick a person or place, and the next reply cuts there |
| **Bring someone in** | Pick from the World roster |
| **Raise the stakes · Breathe** | One-shot pacing cues |

**Beyond:** the Desk is **context-aware**. Its top row shows the three most useful buttons right now, such as **Promise due in 20 min**, **Thread stalled 30 msgs** or **Night is falling**. The Desk also lives in a header button on phones.

**How it's built:** `web/src/components/chat/DirectorsDesk.svelte` reuses `components/desk/` (Knob, Rocker…). The reports are read-only views over the fold. "Cut to" and the pacing buttons are preset cues.

### F3. Selection asides (replacing `((truth: …))`)

Select any text in a reply or your own message, and the selection menu offers:

- **Pin as truth** → a story truth (exists in the tray, now one tap from the text)
- **Running bit** → a callback/motif
- **Add to calendar** → a date picker pre-filled from the text ("her birthday, 19 January")
- **Set the clock** → when the text names a time or day
- **Keep off the page / Never say this** (B1)
- **Plant this** → a Chekhov plant
- **This belongs to…** (E2)

Each filed item shows as a chip with **Undo**. Facts stated in your own messages are still read automatically, and each one shows as a chip on your message with **Undo** and **That's not what I meant**.

### F4. Meus runs the Desk

Every Desk button and selection aside has a Meus change kind (`timeskip` exists; add `report`, `cut_to`, `lesson`, `secret_offpage`, `canon`, `playbook`, `pressure`, `promise`, `calendar_add`, `room`). "Skip to morning and remind me what Spike knows" becomes one Meus card with two ticks.

---

## Phase 7 · World and time

### G1. More calendars

**What you get:** Roshar, Harptos and Shire Reckoning join Gregorian and Westeros. You can also build your own calendar.

**Beyond Almanac (no mini-language):** a **calendar builder** with buttons. Add a month (name and days), add a festival day between months, set weekdays (or none), the era and year, leap rules, moons (name and cycle) and holidays. A live month grid previews as you build. **Story seasons** is a toggle: the season changes when the story says so, and weather and day length follow. Calendars can be shared across chats ("Use in another story").

**Buttons:** Session Zero › World › **Calendar** picker plus **Build my own**. The Story tab's calendar gets **Add a day** (birthday, feast, anniversary).

**How it's built:** extend `CalendarId` into data-driven definitions in `trackers/calendars.ts` and `web/src/lib/storytime.ts`, stored in `calendars_custom`. Moon phases feed `sim/sky.ts`.

### G2. Relationship graph with a time slider

**What you get:** the server already builds `entityGraph(chatId, { atSeq })`. This gives it a screen.

**Beyond Almanac**
- **Layers:** bonds (trust, affection, resentment as colours), knowledge (who knows the selected secret), factions, and object trails (E2).
- **Time slider:** reuses `Scrubber.svelte`. Drag through the story and the graph animates, and **Play** runs it like a film.
- **Click a line** to see the bond's history, with **Jump to the message** for each change.
- **Focus mode:** pick a person to see only their web.

**Buttons:** World page › **Graph** view toggle (list / graph). Story page › person › **See their web**.

**How it's built:** `web/src/components/world/RelGraph.svelte` with a small force layout (d3-force, about 6 KB) inside the bundle budget (`bun run budgets`). It reads `/api/chats/:id/trackers/graph` and the entity graph route.

### G3. Next beat previews

**What you get:** the PR #21 buttons (Win / At a cost / Loss / Twist / Reversal) show a preview of how the outcome would reach the scene before anything commits.

**Beyond:** **Accept**, **Reroll** (seeded, so it's the same for everyone on that branch) and **Edit**. Previews are free in engine-telling mode and one cheap call in model-telling mode.

---

## Phase 8 · Prompt and cost

### H1. Prompt ceiling and cut report

**What you get:** one token ceiling for everything Mea adds (note, recall, summaries, lanes). When the prompt is over it, the cuts happen in a fixed order.

**Beyond Almanac**
- **Cut order you can see and drag:** Settings › Memory › **What goes first when space is short** is a list you reorder.
- **Per-turn cut report** in the Inspector: what was cut, its tokens, and **Keep this next time** (pin) for anything cut.
- **Auto-ceiling:** set from the model's context length (from the NanoGPT catalog) minus room for the reply, so you never need to guess.

**How it's built:** a single budget pass after all extras are gathered in `generation.ts`, reusing the profiles' `budget` shares. Cut decisions go into the generation record, so the Inspector can show them.

### H2. Per-chat cost guard

**What you get:** a warning when this chat's background calls (summaries, archivist, checks, lessons, telling) go over a share of the day's quota, with **Use a cheaper model for these** in one tap.

**Beyond:** a **cost per reply** line in the Inspector (writer + planner + background), and a **Budget mode** toggle on the chat that turns off optional model reads for that chat only.

**How it's built:** extend `services/usage.ts` and `services/quota.ts` per chat. The cheaper-model button writes `routing.tasks`.

### H3. A separate planner model

**What you get:** a strong reasoning model writes the plan, and your writing model writes only the prose.

**Beyond Almanac (which designed this but never shipped it)**
- Grows the existing **Advisor**: the planner gets Mea's full planning pass (the `mea.ts` planning block) and the lanes, and returns the plan. The writer gets the plan as `<director-plan>`, and its own `<think>` is turned off, so there are fewer runaway think blocks.
- **Prefetch:** it runs while you type (as the Advisor does now), so sending usually finds the plan ready.
- **Fallback:** if the planner is late (a 20 s budget) or fails, the writer plans for itself as today.
- **Plan viewer:** the Inspector shows the plan. **Edit the plan and regenerate** is a button, so you can steer by editing beats instead of writing notes.

**Buttons:** Chat tab › **Planning:** *In the reply* (today) / *Separate planner* with a model picker. Settings › Models › Routing › **Planner**.

---

## Phase 9 · Lore

### I1. Lorebook categories and Dream Weaver books

**What you get:** lore entries get categories: Timeline boundary, Rule, OOC, Character, Relationship, Voice, Current, Belief, Secret, Faction, Upcoming, Item, Location, History, Customs and Scene. Each category sets a sensible default position and priority.

**Beyond:** **Auto-sort** guesses the category from titles and content (`Buffy & Spike - Truce` → Relationship), with a confidence dot and one-tap correction. **Upcoming** and **Scene** entries become playbooks (C2). **Secret** entries link to B1. Dream Weaver rule, NPC, depth and lore books are recognised by their fixed names.

**Buttons:** Lorebook editor › a category chip on each entry, **Auto-sort this book**, and a filter by category.

**How it's built:** `server/src/lore/format.ts`, and `lore/ingest.ts` maps entries into the Codex by category.

### I2. Creator: plan first, then write

**What you get:** the Lore Studio proposes a plan (every entry it would write, change or switch off, with category and title) before writing anything.

**Beyond:** the plan is an editable list (rename, recategorise, remove, **Add an entry**), with **Ask for changes** in plain words, numbered versions, and the differences highlighted. **Accept** writes in batches, checks each against the format, and offers **Review** (tokens, activation check, edit or rewrite any) before **Save into book**.

**How it's built:** extend `lore/studio.ts` with a `plan` stage. The UI lives under `components/lore/studio/`.

### I3. Story → lorebook

**What you get:** **Save this story as a lorebook** turns the Codex, truths, timeline, people, places, secrets (with off-page handling) and callbacks into a categorised lorebook, ready for a sequel or another app.

**Beyond:** **choose a point in the story** (the book reflects the world as of that message), **spoiler-safe** mode (secrets left out), and export as a SillyTavern or Lumiverse JSON book.

**Buttons:** Chat tab › **Export** › **As a lorebook**, which opens the I2 plan view pre-filled.

---

## Phase 10 · Look and sound

### J1. Scene plates

**What you get:** a drawn header at each new scene: a place silhouette, the sky by hour and weather, and the room's style.

**Beyond:** built on Mea's existing scene art (`web/src/lib/artifacts.ts` skies) and rooms. **Place kinds** (street, forest, tavern, bedroom, castle, shore…) each have procedural silhouettes, and the plate changes subtly as time passes during a scene. **Save as image** shares it.

**Buttons:** Display menu › **Scene plates** on/off. A plate's **⋯** menu offers **This place is…**, which corrects the place kind.

### J2. Room colours

**What you get:** a colour picker for each colour of the current room (paper, text, quiet text, lines, accents, good, warning, danger), separately for light and dark.

**Buttons:** Settings › Appearance › **Customise colours**, with **Reset** for each colour and **Reset all**. Colours are saved per room. Contrast is checked live, with a warning when text would be hard to read.

### J3. Soundtrack

**What you get:** music chosen to fit the scene (mood, intensity, hour, weather, place, genre). It changes on story beats, not every reply.

**Beyond Almanac**
- **Players:** Spotify (Web API with your login), YouTube Music on the PC (the desktop app's local API, since Mea runs on the same machine), or a **local music folder** (Mea plays the files itself in the browser, works on the phone too, and needs no account).
- **Taste:** preferred and banned artists, genres, and *instrumental only during dialogue*.
- **Leitmotifs:** pin a song to a person or a bond ("Spike & Buffy"), and it comes back when they share a scene.
- **Beats:** music changes on scene, mood or time-of-day changes, a big moment (`MOMENT_TAGS`) or a chapter. Otherwise it holds.
- **Thumbs:** 👍 / 👎 on the now-playing chip teaches the picker for this story.

**Buttons:** a **now-playing chip** in the chat header (play/pause, skip, 👍/👎, **Not for this scene**). Settings › **Music** (new section): player, taste and leitmotifs. Session Zero › Look › **Music on**.

**How it's built:** `server/src/music/` (cue from tracker state, picker, director), with a `web/src/components/chat/NowPlaying.svelte` player. Network access is only to the chosen service, and it's off by default.

---

## Phase 11 · Safety net

### K1. Golden scenarios

**What you get:** a fixed set of test scenes that grade Mea's preset and pipeline after each change: agency, knowledge leak, clock, weather, people acting on each other, a promise kept, an off-page secret, a canon cutoff, the safety floor, ledger shape and planning-block leak.

**Beyond:** each scenario has **rule graders** (reusing the slip registry) and an optional **model grader**. It runs with the mock provider for free in CI, and with a real model on demand from Settings › Status › **Run story checks**, which shows a pass/fail board.

**How it's built:** `server/test/golden/*.json` scenarios and `scripts/golden.ts`.

### K2. Light CI

A GitHub Action on every PR runs `bun install`, `bun run check`, `bun run test`, `bun run build`, `bun run budgets` and the golden scenarios on the mock provider. It's a required check before merge, which also settles the open question about reviewing PRs before they merge.

---

## Build order and dependencies

```
K2 CI ───────────────────────────────────────────────── (first, protects everything)
P1 Foundations ─┬─ A1 Lessons ── A2 Swipe angles
                ├─ B1 Off the page ── B2 Exposure ── (G2 secret layer)
                ├─ C1 Canon cutoff ── C2 Playbooks ── I1 Lore categories ── I2 Creator plan ── I3 Story → lorebook
                ├─ D1 Checks ── D2 Craft coach ── D3 Story health
                ├─ E1 Pressures · E2 Rooms · E3 Promises
                └─ F1 Session Zero ── F2 Desk ── F3 Selection asides ── F4 Meus kinds (rolls up all the above)
G1 Calendars (after F1) · G2 Graph (after E2/B2) · G3 Previews (any time)
H1 Ceiling (after the lanes exist) · H2 Cost guard · H3 Planner (after H1)
J1 Plates · J2 Colours · J3 Soundtrack (independent, last)
K1 Golden (grows with each phase)
```

**Suggested first five PRs:** K2 CI → P1 Foundations → A1 Lessons → B1 Off the page → D2 Craft coach. They give the biggest jump in story quality the fastest.

## Risks and how they're handled

| Risk | Handling |
|---|---|
| Prompt bloat from new lanes | H1's ceiling and cut order, lessons fading, lanes only for people present |
| Extra cost from model reads | All optional, routed to a cheaper model, quota shedding, H2 guard |
| Wrong automatic filing (promises, facts) | Every filing is a chip with Undo, and "That's not what I meant" teaches the reader |
| Swipe or branch corruption | Everything new is folded from events or keyed by message and swipe, with tests per feature |
| Soundtrack services change their APIs | The local-folder player always works, and network players are optional |
| Bundle size (graph, plates) | Lazy-loaded, checked by `bun run budgets` |
| Untested desktop and Android builds | The plan adds no native code. The phone uses the same web screens |

## What you'll do

Nothing until a phase is ready. Each part arrives as its own PR with a plain-language summary, and you update with **Update Mea** in the tray. Session Zero (F1) and the Desk (F2) are the parts worth trying hands-on first.
