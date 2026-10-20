# Design: the complete Lore Studio (every kind of entry)

**Written:** October 20, 2026 · **Base:** Mea `main` after PR #121 · **Mockup:** `mockups/lore-studio-kinds.html`

The Lore Studio plans a lorebook by seven Codex **types** (character, location, item, faction, concept, event, rule). The lorebook itself has sixteen **categories** (`lore/format.ts`): Voice, Relationship, Current, Secret, Belief, Upcoming, Customs, Scene and the rest. Only one of them, Current, reaches the studio's planner and writer (PR #120). The others are guessed from the title after planning, and written like any other entry. So a studio book never has a real Voice entry for its people, never plans what two characters are to each other, never says what's coming, and never writes the world's slang, money or weather, even though activation, the world sim and the re-anchor all know how to use those entries.

This design makes the **kind** of entry the thing the studio plans, writes and checks. There are 28 kinds on five shelves. Each kind knows when to plan one, how to write it, where it goes in the prompt, what fires it, which facts it fills, and how to check it. You pick the mix (or a recipe), the plan shows every shelf with what's missing, characters get their satellites (voice, bonds, reactions, secrets) in one tap, and review checks each entry against its kind.

The design has 7 parts. **Every part is its own PR.** The numbered steps are the pieces inside a part's PR, each with its own tests and "done when".

---

## 0. Read this first

### 0.1 What's already in Mea (found while designing)

| Piece | Already in Mea | So this design… |
|---|---|---|
| Categories | `lore/format.ts`: 16 categories with position, order, depth, constant, Codex type, and `guessCategory` rules; `web/src/lib/lorecats.ts` mirrors the list | grows them into the kind registry: 12 new kinds, a shelf, fields, firing, a writer brief and checks for each (Part 1) |
| Studio types | `ENTRY_TEMPLATES` in `lore/assist.ts` (7 types, with fields); `options.types` filters the planner; `LORE_TYPES` chips in `StudioOptions.svelte` | the kind replaces the type as what you pick and what the writer follows; the type stays as the Codex type each kind maps to (2.1) |
| Planned category | `StudioItem.category`, set by `guessCategory` or by `"now": true` (Current); a per-item select in `StudioPlan.svelte` | the planner returns a kind for every item, never a guess (2.2) |
| Kind-specific writing | `writeEntry` has one special brief, for Current | every kind gets its brief and, where it helps, a structured shape (Part 3) |
| Save | `withCategory(entry, cat, { defaults: true })` sets position, order, depth and constant | also sets the kind's keys policy, `extra.entity` for satellites, and the kind's facts (3.4, 4.2) |
| Voice slots | `lore/slots.ts` (`pet names`, `catchphrases`, `swearing`, `greeting`, `goodbye`, `never says`); `lore/voice.ts` feeds them to the re-anchor and the drift alert, matching the entry by title, keys or `extra.entity` | Voice entries fill those slots as canon facts, so the re-anchor works for studio-built people from the first chat (Part 4) |
| Invented details | `lore/details.ts` (docs/15, 3.2): a companion book's character slots, from the card or drafted for your yes | runs for every character a studio book writes, not only the card's (4.3) |
| Current in the sim | `sim/storyteller.ts` starts each Current entry as a running subplot (PR #120); the sim reads climate from where the story is (PR #121) | Climate, Routine, Hook and Upcoming entries are written in the shape the sim can read (5.2) |
| Secrets | `extra.secrets` with `knownBy`, the leak guard, tracker links (docs/16) | Secret and Mystery kinds write their truth as a kept secret, never in the open text (3.3) |
| Census and coverage | `takeCensus`, `uncovered()`, the coverage list's "Add" | adds kind coverage: core people without a voice, pairs without a bond, a world without a timeline boundary (2.4) |
| Critique and checks | `lore/quality.ts` `checkEntries`, `critiqueDraft`, `consistencyCheck` | gain per-kind checks (Part 6) |
| Companion books | `companionLore` in `creator/creator.ts` opens a studio draft from the saved card or persona; `PURPOSE.character` says "don't make an entry for the character themself" | satellites can hang off the card itself, and the card's voice goes out as facts, not a second text (7.1) |
| Persona books | `PURPOSE.persona`: the persona is {{user}}, never decided for | a Persona recipe, and kinds that would speak or feel for {{user}} are blocked with the persona as subject (7.2) |
| Depth book | `writeDepthBook` in `creator/books.ts`; until PR #122 it tagged every deepening answer Current, which since PR #120 put each in every prompt and in the sim | the composer picks each answer's kind (7.3) |
| Creator world context | `worldContext` in `creator/world.ts` sorts a world's entries by the seven types | sorts by shelf, with Ground truth, Current and Lexicon first (7.5) |
| Plan versions | I2: numbered plan versions with a diff (renamed, recategorised…) | the diff says "kind changed" in the new words; nothing else changes |

### 0.2 Words used in this design

| Word | Means |
|---|---|
| **Kind** | What an entry is for: Voice, Current, Mystery… Stored as `extra.category` (the existing field), so old books and imports keep working |
| **Shelf** | A group of kinds in the picker and the plan: Ground truth, People, World, Time, Scenes |
| **Subject** | The entry a kind hangs off: a Voice's character, a Relationship's two people, a Reaction's character |
| **Satellite** | An entry with a subject. A character's satellites are its voice, bonds, reactions, beliefs, secrets and shared moments |
| **Mix** | How many of each kind the plan aims for: none, a few, one per core subject, everything |
| **Recipe** | A saved mix for a kind of story: Companion, Adventure, Fandom AU, Mystery, Slice of life, Court intrigue |
| **Shape** | The structured parts a kind's writer returns (a voice's sample lines, a mystery's clues) before they're joined into the entry text |

### 0.3 Principles

1. **One field, no migration.** The kind is `extra.category`. The 16 existing ids keep their meaning; new ids are added. Old drafts keep their type and get a kind from it on load.
2. **The kind decides, you override.** A kind sets position, priority, depth, keys policy and length; every one of those stays editable on the item and in the editor, and your choice wins on re-save.
3. **Plan what scenes use.** Every kind's planner brief says when a scene needs one. No kind is planned "for completeness" unless the mix says Everything.
4. **People first.** Satellites are planned after their subjects and written after them, so a voice reads the character's draft.
5. **Shapes, not forms.** Shapes are for the writer and the checks. The saved entry is still prose a storyteller can read (with a short list where a list is clearer: prices, terms, sample lines).
6. **Secrets stay kept.** A kind with a hidden truth writes it into `secrets` with keepers, never into the open text.
7. **Same checks as before, plus the kind's.** Nothing in `checkEntries` gets weaker.
8. **Meus can do it.** New studio actions (plan a pack, apply a recipe) add their Meus change kinds.
9. **One PR per part,** with tests in `server/test/` for each step, and `bun run test`, `bun run check` and `bun run build` passing. Build the next part while CI runs; merge only when green.

### 0.4 Where things live

| Surface | What goes there |
|---|---|
| **Studio › Start › Shape of the lorebook** | Recipes, and the kind mix by shelf (replaces "Kinds of entries") |
| **Studio › Plan** | The shelf board (counts, gaps, "plan these"), items grouped by shelf, satellites under their character, the **Pack** button |
| **Studio › Plan › an item** | Kind picker (grouped), subject picker for satellites, the kind's one-line hint |
| **Studio › Review › an entry** | The kind's shape (sample lines, clues, prices) above the text, and the kind's checks |
| **Lorebook editor** | The grouped kind picker and the kind's template for a new entry (Part 1 only) |
| **Creator › Save › Companion lorebook** | Opens the studio with the Companion or Persona recipe, the card as the subject of its satellites |
| **Creator › Deepen** | Each composed answer shows its kind (Reaction, History…) with one-tap change |
| **Inspector** | Unchanged; entries show their kind as they do their category today |

---

## The 28 kinds

New kinds are marked ✦. "Fires" is the keys policy the studio saves (the editor can change it).

### Ground truth (always in the prompt, kept short)

| Kind | For | Fires | Shape |
|---|---|---|---|
| Timeline boundary | Where the story stands; what hasn't happened yet | Always | as of · already happened · not yet (list) |
| Rule | How the world works, always | Always | the rule · why · exceptions |
| ✦ Power | A magic system, technology or ability set: what it does, what it costs, its limits | Its names, and by meaning | source · can · can't · cost · who has it |
| OOC (Writer's notes) | Notes to the writer: prose style, pacing, point of view, content limits | Always (depth 4) | style · pacing · limits |

### People

| Kind | For | Fires | Shape |
|---|---|---|---|
| Character | A person | Name, nicknames; entity in scene | looks · manner · history · wants · fears (+ character slots) |
| Voice | How a person talks | Whenever its subject is in the scene | register · rhythm · vocabulary · pet names · catchphrases · swearing · greeting · goodbye · never says · how it shifts · 3–5 sample lines |
| Relationship | What's between two people | Both names together (secondary keys) | how they met · what each is to the other · tension · history · where it stands now |
| ✦ Family | A household or bloodline: members, roles, how they get on | Family name, house words | members (with role) · head · dynamics · feuds · home |
| ✦ Shared moment | One remembered moment between two people (often {{char}} and {{user}}) | Words from it ("the lighthouse", "that winter") | when · where · what happened · what was said · what it means to each |
| ✦ Reaction | How someone reacts when a topic comes up | The topic's words, only when the subject is in the scene | trigger · what they do · what they say · why |
| Belief | What someone holds true, true or not | Its topic, by meaning | who believes · what · how strongly · the truth (kept) |
| Secret | Something kept from someone | Its topic; text off the page | the open part · the truth (kept, with keepers) · who it's kept from · what happens if it comes out |

### World

| Kind | For | Fires | Shape |
|---|---|---|---|
| Location | A place, from a world to a room | Name; entity in scene | looks · atmosphere · who's there · features · dangers (+ place slots) |
| Faction | A group, guild, house or side | Name, members' words | who · goals · leaders · methods · allies and enemies (+ group slots) |
| ✦ Species | A people, race or creature: body, mind, culture, dangers | Its names, plural forms | body · mind · culture · how others see them · dangers |
| Item | An object that matters | Name; entity in scene | looks · does · history · who has it (+ item slots) |
| ✦ Faith | Gods, saints, churches, oaths and what people swear by | Its names and oaths | what's worshipped · clergy · rites · oaths and curses · heresies |
| Customs | Manners, rites, food, festivals, how people do things | By meaning | the custom · when · who · what breaking it means |
| ✦ Lexicon | The world's words: slang, titles, terms, how to address people | Each term | term — meaning (list) · who says it |
| ✦ Money and trade | Currency, prices, what's scarce, who trades what | Coin names, "price", "cost", "buy" | coins and worth · what things cost (list) · scarce · markets |
| ✦ Climate and seasons | Weather, seasons and what they do to life here | Season and weather words, by meaning | the seasons · now · what the weather changes · dangers |

### Time

| Kind | For | Fires | Shape |
|---|---|---|---|
| History | What happened before | Its names, by meaning | what · when · who · what it left behind |
| Current | A situation under way now | From the first message until the story moves past it | what · who · where · each side wants · what happens next if nobody acts |
| Upcoming | What's coming, foreshadowed | By meaning (depth 3) | what · when · signs to drop · who knows |
| ✦ Hook | An opening a scene can pick up: a job, a rumour, a stranger who needs something | Its names, by meaning | setup · who offers it · stakes · where it leads |
| ✦ Mystery | An open question the story is built around | Its clue words, by meaning | the question · the truth (kept, with keepers) · clues (list) · red herrings · who's hiding what |
| ✦ Routine | Who is where, when: a day at the inn, the guard's rounds, the market week | Places and times named in it | time — who — where (list) · what breaks the routine |

### Scenes

| Kind | For | Fires | Shape |
|---|---|---|---|
| Scene | A guide for one kind of scene while it lasts: combat, court, a heist, a quiet night | By meaning of the scene (depth 1) | when it applies · how to write it · what to track · how it ends |

---

## Part 1 · The kind registry

The 28 kinds in one place, read by the editor, the studio, activation and the guesser.

### 1.1 Kinds in `lore/format.ts`

- Add the 12 new ids to `CATEGORIES` and `CATEGORY_INFO`. Each `CategoryInfo` gains: `shelf`, `fields` (the shape's parts, in order), `fires` (`"always" | "names" | "meaning" | "subject" | "topic"`), `subject` (`"none" | "one" | "two"`), `lengthScale` (Lexicon and Money run longer, Reaction shorter), `slots` (the slot group it fills, if any), and `example` (a one-line pitch for the picker).
- Placement for the new ones: Power `before_char` 20; Family `after_char` 105; Shared moment `after_char` 118; Reaction `depth` 2, order 116; Species `after_char` 145; Faith and Lexicon `before_char` 72 and 74; Money `before_char` 76; Climate `before_char` 78; Hook `depth` 3, 155; Mystery `after_char` 135; Routine `after_char` 175.
- `ENTRY_TEMPLATES` stays (the Codex type's fields); `templateContent` takes a kind and uses its fields when given one.
- **Done when:** every kind has complete info; a test walks the registry (unique orders within a position, every shelf non-empty, every `slots` group exists in `SLOTS`).

### 1.2 The guesser learns the new kinds

- `guessCategory` rules for the new kinds, title first then words: "Voice: Mira" and "how Mira talks" (Voice already), "Family", "House of", "the Starks" → Family; "When … mentions", "if someone", "triggers" → Reaction; "the night we…", "remember when", "first kiss" → Shared moment; "magic", "powers", "bending", "tech" → Power (moved off Rule); "species", "race", "creatures", plural people names → Species; "gods", "church", "faith", "religion", "oaths" → Faith; "slang", "glossary", "terms", "language" → Lexicon; "currency", "prices", "coin", "economy" → Money; "weather", "seasons", "climate", "winter" → Climate; "hook", "quest", "job", "rumour" → Hook; "mystery", "who killed", "the question of" → Mystery; "routine", "schedule", "a day at" → Routine.
- Dream Weaver role books are unchanged.
- **Done when:** the guess tests cover each new kind with a title and a text example, and every old guess test still passes.

### 1.3 The grouped picker

- `lorecats.ts` gets the shelves and hints. A `KindPicker.svelte` (grouped `<select>` with `optgroup`s on small screens, a popover grid with the hint on wide ones) replaces the plain category selects in the editor and the studio.
- The editor's **New entry** offers a kind first and fills the kind's template.
- **Done when:** picking a kind in the editor sets its defaults as picking a category does today; the picker works at phone width.

---

## Part 2 · Planning by kind

The studio plans the mix you picked, shelf by shelf, people before their satellites.

### 2.1 The mix and recipes

- `StudioOptions.types` becomes `StudioOptions.mix: Partial<Record<Category, "none" | "few" | "each" | "all">>`. Empty means "the planner decides" (today's behaviour). On load, an old draft's `types` maps to a mix (`character` → Character "each", `concept` → Power and Customs "few", `event` → History "few", and so on).
- "each" is per subject: one Voice per core character, one Relationship per core pair with something between them, one Reaction set per core character.
- **Recipes** set the mix in one tap and show it, so you can adjust:

| Recipe | Leans on |
|---|---|
| Companion | Character, Voice (each), Relationship with {{user}}, Shared moments (few), Reactions (each), Routine, Current, OOC |
| Adventure world | Location, Faction, Species, Power, Item, Hook (few), Money, Climate, History, Current |
| Fandom AU | Timeline boundary, Character, Voice (each), Relationship (each), Secret, Current, Upcoming, Lexicon |
| Mystery | Character, Secret (each), Mystery, Location, Routine, Belief, Hook, Timeline boundary |
| Slice of life | Character, Voice (each), Relationship, Routine, Customs, Location, Climate, Shared moment |
| Court intrigue | Faction, Family, Character, Secret, Belief, Customs, Lexicon, Faith, Upcoming |

- Character, Location and Faction keep their place in every recipe the census needs them for; recipes add, they don't hide the world.
- **Shape of the lorebook** shows Recipes as cards, then the mix as five shelf rows of kind chips with a four-step dial (off, few, each, all). The summary line reads "Companion · 9 kinds · about 24 entries".
- **Done when:** a draft with a mix plans only the kinds it allows (plus the census's people, places and groups); old drafts open with an equivalent mix; a recipe sets exactly its mix.

### 2.2 The planner returns kinds and subjects

- The outline item gains `kind` (one of the 28) and `about` (titles of its subject entries). `type` is derived from the kind. `now` stays accepted and means Current.
- `StudioItem` gains `about: string[]` (item ids, or `entry:<id>` for an entry already in the book). `category` is now always set by the planner, never guessed for studio items.
- Planning runs in two passes when the mix has satellites: first the world (everything with no subject), then a satellite pass over the planned people, so every Voice and Relationship names a real character. Satellite titles follow the kind's title convention: `Voice: Mira`, `Mira & Joss`, `Reaction: Mira, when her mother comes up`, `Moment: The Lighthouse`.
- The planner brief for each kind comes from the registry (when a scene needs one, and what not to plan: no Upcoming for things that are backstory, no Current for what's already over).
- **Done when:** a plan for a mix with Voice "each" has one Voice per core character, each `about` its character; Relationship items have two subjects; a plan with no satellite kinds makes one outline call as today.

### 2.3 The shelf board and grouped plan

- Above the plan, a board: one tile per shelf with its kinds as counts ("Voice 3 / 5"), and a gap line where the mix wants more than the plan has ("2 core people without a voice: Joss, the Harbourmaster · Plan them").
- The plan list groups by shelf (collapsible), then by folder as today. A character card shows its satellites as chips underneath; tapping one opens it, and the **Pack** button on a character plans whichever satellites it's missing (voice, bond with {{user}} or with its closest people, reactions, a secret if Secrets are on).
- Reordering, keep/drop, steer and versions work as today. The version diff says "kind: Voice → Character".
- **Done when:** the board counts match the plan; Pack plans only missing satellites; the plan still renders without a mix (no gap lines).

### 2.4 Kind coverage

- `uncovered()` gains kind gaps from the mix: core people without each "each" satellite, core pairs (people the census or the drafts tie together) without a Relationship, no Timeline boundary when the book is based on an existing work, no Current when the source describes an opening situation, no Rule when the mix asked for one.
- The coverage list's **Add** plans exactly those, with `about` set.
- **Done when:** coverage tests cover each gap type, and adding them clears them.

---

## Part 3 · Writing by kind

Each kind is written to its purpose, then checked against its shape.

### 3.1 Kind briefs

- `writeEntry` takes the kind's brief from the registry in place of the single Current brief. Briefs are short and concrete: a Voice is written to be imitated ("how a sentence of theirs sounds, not adjectives about it"), a Reaction is one trigger and one behaviour, a Routine is a schedule, a Lexicon is terms the story can use.
- Word targets scale by `lengthScale` (`WORDS[length] × scale`), so a Reaction stays lean and a Lexicon can list twenty terms.
- Subjects come into the prompt: a satellite gets its subject's draft (or essentials), so a Voice reads the character it belongs to and a Relationship reads both people.
- **Done when:** a test per kind (mock provider) shows its brief and its subjects in the prompt.

### 3.2 Shapes

- The entry schema gains an optional `parts: Record<string, string | string[]>` with the kind's fields. Kinds with a shape ask for it; the writer then joins the parts into `content` with the kind's layout (prose for most, short labelled lines for Voice, Money, Lexicon and Routine).
- The draft keeps `parts`, so Review can show them and a re-write can steer one part ("more sample lines", "make the clues harder").
- **Done when:** each shaped kind's parts survive a save and re-open, and the joined text reads as an entry (snapshot tests on the layouts).

### 3.3 Hidden truths

- Secret, Belief and Mystery write their hidden part (the truth, the real answer) into `secrets` with `knownBy`. The open text says only what the world can see: the rumour, the question, the clues.
- The leak guard already watches `secrets`; Review flags a draft whose open text contains its own secret.
- **Done when:** a Mystery's truth is never in its `content` (test), and it reaches the prompt only through the secrets path.

### 3.4 Keys by kind

- The kind's `fires` sets what the writer is asked for and what's saved: `subject` kinds key on their subject's names and save `extra.entity`, so entity-linked firing (LORE-06) brings them in whenever the subject is in the scene; Relationship saves one name as keys and the other as secondary keys (`and_any`); `topic` kinds key on the topic's words, never the subject's name; Lexicon keys on each term; `meaning` kinds turn on `extra.semantic`; `always` kinds are constant.
- **Done when:** saved entries of each `fires` policy fire in an activation test the way the table says, and never on a plain mention of a common word.

---

## Part 4 · Voices that hold

The kind the user asked for by name, end to end.

### 4.1 The Voice entry

- Shape: register (formal, plain, street…), rhythm (short and clipped, long and winding…), vocabulary (what words they reach for), pet names for {{user}}, catchphrases, swearing, greeting, goodbye, words they'd never use, how it shifts (with {{user}}, with strangers, angry, scared, lying), and 3–5 sample lines in different moods, each with the mood.
- The text the storyteller sees is short: two sentences on the sound of them, then the sample lines. The slot values are not repeated in the text; they go out as facts (4.2).
- For an existing work, the writer reads the character's wiki page and keeps their canon speech (accent, signature words), and the sample lines are new lines in that voice, never quotes.
- **Done when:** a Voice draft has its parts, at least three sample lines, and no line that's only adjectives.

### 4.2 Voice slots become facts

- On save, each voice part that maps to a slot (`pet names`, `catchphrases`, `swearing`, `greeting`, `goodbye`, `never says`) becomes a canon fact on the Voice entry (`createFact`, source "studio"). Lists become list facts, one value each.
- The entry saves `extra.entity` = its subject's name, so `voiceFacts()` finds it, and the re-anchor and the drift alert use it from the first chat.
- **Done when:** after saving a studio book with a Voice for Mira, `voiceLines(voiceFacts(chat, "Mira"))` returns her pet names and catchphrases (test).

### 4.3 Details for every person

- The details stage (`lore.details`, docs/15 3.2) runs for each Character entry the studio saves, not only the card's character: the character slots the draft states become canon facts, and the open ones are drafted as invented, waiting for your yes in one Inbox card per book.
- **Done when:** saving a studio book with three people queues one details job per person, and their stated slots are facts.

---

## Part 5 · Kinds the story machinery reads

Some kinds only pay off when the rest of Mea uses them. These are the hookups, each small.

### 5.1 Timeline boundary from the plan

- Any book based on an existing work plans a Timeline boundary (unless the mix turns it off), written from the opening the author picked: what has happened, and the named events that haven't, so the storyteller doesn't spoil or skip them.
- The prompt check (PR #115) already reads constant text; the boundary's "not yet" list is what it checks against.
- **Done when:** a Fandom AU plan has a boundary with both lists.

### 5.2 Sim-readable kinds

- **Routine:** saved with its schedule lines (`time — who — where`) in `parts`, so the world sim can place people who aren't in the scene where their routine says, before it rolls anything.
- **Climate:** the sim already reads climate from where the story is; a Climate entry for that place wins over the guess.
- **Hook:** the storyteller offers a Hook as a proposed subplot (the usual proposal card), never starts it on its own.
- **Upcoming:** unchanged in the sim; the writer drops its signs as foreshadowing, as today.
- **Done when:** a sim test places a routine's person by the story clock; a Climate entry overrides the guessed climate; a Hook becomes a proposal, not a running subplot.

### 5.3 Shared moments for companions

- A Companion book plans Shared moments from the card's first message, example dialogues and scenario (what they say happened), never inventing a history the card contradicts; with **Only what the source says** on, it plans only the ones the card states.
- They fire on the words of the moment, so "remember the lighthouse?" brings the whole memory back.
- **Done when:** a moment named in a card's scenario is planned and fires on its words.

---

## Part 6 · Review by kind

### 6.1 Per-kind checks

`checkEntries` gains checks keyed by kind, with the existing severity levels:

| Kind | Check |
|---|---|
| Voice | at least 3 sample lines; no sample line is a description; doesn't contradict the character's voice slot |
| Current | present tense; no more than one clause of backstory; names who and where |
| Upcoming | future or conditional; not already in History |
| Relationship | names both subjects; says where it stands now |
| Reaction | has a trigger; keys don't include the subject's own name |
| Secret, Belief, Mystery | truth in `secrets` with keepers; truth not in the open text |
| Mystery | at least 3 clues; at least one red herring when the length is standard or rich |
| Lexicon, Money | at least 5 terms or prices; keys cover the terms |
| Routine | at least 3 time lines; every person named is in the plan or the book |
| Timeline boundary | has a "not yet" list when based on an existing work |
| Satellites | the subject exists (in the plan or the book) |

- **Done when:** each check has a failing and a passing test, and Review shows them on the entry like today's issues.

### 6.2 The kind-aware critique

- The editor's pass (`critiqueDraft`) gets the shelf board's gaps and each item's kind, so its "add" suggestions come with a kind and subject, and its "misfiled" finding can say "this Character entry is mostly how she talks: split out a Voice".
- **Done when:** a critique add carries a kind; "split out" suggestions create the satellite with `about` set.

### 6.3 Review grouped by shelf

- Review lists entries by shelf like the plan, with the kind's shape shown above the text (sample lines as quotes, clues as a list, prices as a small table), the token cost per shelf, and the always-on total (Ground truth, Current) called out, since that's what every message pays.
- **Done when:** the per-shelf token totals add up to today's total.

---

## Part 7 · Cards and personas

The card and persona creator feeds the studio in three places (the companion book, the depth book, a lore entry becoming a card). Each needs to know about kinds, and a persona needs its own rules.

### 7.1 Companion books: the card is the subject

- `StudioItem.about` accepts `card:<id>` and `persona:<id>` beside item ids and `entry:<id>`. A companion draft (source kind `character`) plans Reactions, Shared moments with {{user}}, Relationships and Secrets about the card's character with `about: ["card:<id>"]`, still without a Character entry for them (the card covers them).
- **No Voice entry text for the card's own character.** The card already has a voice section, example dialogue and the re-anchor bullets; a second text costs tokens and drifts from them. Instead, a companion book's save reads the bible's voice section and writes the voice slots (pet names, catchphrases, swearing, greeting, goodbye, never says) as canon facts on the details entry (`detailsEntry` in `lore/details.ts`), so `voiceFacts()` finds them. Voice entries are written for everyone else in the book.
- The Companion recipe is the default when the studio opens from a card; the mix still shows and can change.
- **Done when:** a companion plan for a card has satellites about the card and no Voice or Character entry for it; after saving, `voiceFacts(chat, card name)` returns the bible's pet names and catchphrases.

### 7.2 Persona books: never speak for {{user}}

- A **Persona** recipe: Relationship (what others are to them), Family, Shared moment, History, Location, Item, Faction, and Secret only as something *others* keep from them.
- With the persona as subject, the kinds that would decide what {{user}} says, feels or does are blocked in the planner, the Pack button and the coverage gaps: Voice, Reaction, Belief, and a Secret the persona keeps. The planner brief already says the persona is never {{char}}; the kind list now enforces it, so a model that plans "Reaction: Ren, when the war comes up" has it dropped with a note.
- Other people in a persona book get every kind as usual (their voice, their reactions to the persona).
- **Done when:** a persona plan never holds a blocked kind about the persona (test with a mock outline that proposes one); the Persona recipe is the default from a persona.

### 7.3 Depth entries get their kind

- PR #122 stopped the depth book from tagging answers Current (and repaired saved ones). Here the composer (`composeOne` in `creator/creator.ts`) also returns a `kind` from a short list that fits inner material: History, Reaction, Belief, Secret, Shared moment, Relationship, or none. The depth book saves it with `withCategory(..., { defaults: false })`, so the entry keeps the depth book's firing (by meaning, after the character) and gains the kind's checks and Codex type.
- A Secret answer writes its truth into `secrets` with the character as keeper (3.3); a Reaction keys on its topic (3.4).
- Never Current, Timeline boundary, Rule or Scene from a depth answer.
- **Done when:** composed answers carry a kind from the list; a Secret answer's truth is in `secrets`, not in the text; nothing from the depth book is ever Current (test).

### 7.4 Lore entry → card, and back

- When a planned or saved person becomes a card (`fromLore`, `fromEntry`), their satellites come along as material: the Voice entry's parts seed the bible's voice section (sample lines included), Relationships seed the relationships section, Reactions seed the reaction range.
- After the card is saved, their satellites re-point at it (`about: ["card:<id>"]`) and the Voice entry's text is retired in favour of the card's own voice, keeping its slot facts (7.1's rule: one voice text per person).
- **Done when:** promoting a person with a Voice entry fills the bible's voice section from it, and after saving there's one voice text (the card's) and the facts are unchanged.

### 7.5 The creator reads the world by shelf

- `worldContext` orders a book's entries by shelf instead of the seven types: Ground truth, Current, Lexicon and Customs first (what a card must not contradict, and the words it should use), then People, World, Time. Satellites of other people are left out of the condensed context (they're about someone else).
- **Done when:** a world with a Lexicon puts its terms in the creator's context ahead of places and people (test on the built string).

---

## Parts at a glance

| Part | PR | What you see |
|---|---|---|
| 1 | Kind registry | 28 kinds in the editor's grouped picker; imports guess the new ones |
| 2 | Planning by kind | Recipes, the mix, the shelf board, satellites and Pack in the studio plan |
| 3 | Writing by kind | Every kind written to its purpose, with shapes, kept secrets and the right keys |
| 4 | Voices | Voice entries with sample lines whose slots feed the re-anchor; details for every person |
| 5 | Story machinery | Timeline boundaries, routines and climate the sim reads, hooks as proposals, shared moments |
| 6 | Review by kind | Per-kind checks, a kind-aware critique, review by shelf |
| 7 | Cards and personas | Companion books with satellites about the card, persona books that never speak for you, depth answers with their kind, people promoted to cards keeping one voice |

Parts 1 → 2 → 3 are in order. Part 4 needs 3. Parts 5 and 6 need 3 and can go in either order. Part 7 needs 4 (voice facts) and 2 (subjects); its 7.3 and 7.5 can go earlier, after Part 1.

## Not in this design

- No playbook hooks (dropped from the Almanac).
- No new export format: kinds travel as `extra.category`, which SillyTavern ignores and Mea reads back.
- No new calendars; Routine uses the story clock and the Westeros calendar where it's set.
