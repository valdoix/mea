# Smarter studios, a cleaner cast, and editing everything

What changed after the living page: the cast stopped splitting people in two, the dialogue colours forgive the quote marks models get wrong, every record a story keeps can be edited, and both studios (characters and personas, and lore) got much smarter.

## One person, one entry (the cast)

**What went wrong.** The tracker model sometimes writes a place after the `@` in a `cast:` line (`Jackie Taylor@down-slope(finding James)`). The parser kept `@down-slope` as part of the name, which made a second Jackie Taylor. With two Jackies, a plain "Jackie" no longer matched either one, so a third entry appeared (the same happened to James).

**The fix:**

- **The parser** (`trackers/dsl.ts`): the name stops at the first `@`. A tier word after it is the tier; anything else counts as where they are.
- **The fold** (`trackers/fold.ts`):
  - Names are cleaned on the way in (`personName`), so ledgers stored the old way replay correctly.
  - When several people share a first name, whoever is in the scene wins, then your character or the main one.
  - A last name alone also finds its person ("Holloway").
- **The grammar** tells the model that only `spot|peri|left|arrive` go after the `@`.
- **Card traits** no longer read a place as a scar ("the torn scar of pines").
- **Orphaned profiles** (a duplicate renamed in the Cast editor kept its old key) fold back into the person their name points to the next time the cast loads.

The trackers re-fold their history, so existing chats clean up by themselves.

**New ledger lines (yours only):**

- `merge Jax → Jackie Taylor`: one entry folds into another, and its bonds, items, secrets, promises, traits and journal come along. The old name becomes an alias.
- `edit ["chars","mira","look"] = "a red coat"`: sets any field of the world by path (JSON value; `null` removes it). A person always keeps the shape the app reads. Removing a person takes their bonds with them.

## Editing everything

- **Story → Cast → Edit** now has "In the story now": also called (aliases), presence, mood, what they're doing, where, look, lasting traits, wants, needs, fears, copes by, shows, feels, tell, and dead. "Duplicates" has **Merge** ("the same person as…") and **Forget**. Renaming someone renames them in the story too, and their profile follows.
- **Story → Data** shows every record the story keeps: Scene, People, Bonds, Romance, Facts and secrets, Things, Threads, Promises and debts, Deadlines, Planted details, Clues, Gauges, Faction clocks, Reputation, Calendar, Running bits, Milestones, Places, and Custom trackers.
  - Each record is edited field by field (`DataField.svelte`).
  - Saving writes the smallest set of `edit` lines (`lib/dataedit.ts`), so your edits hold when you rewind or swipe.
  - You can lock a record, remove one, add new ones by name, or write raw ledger lines.

## Dialogue colours

`lib/quotes.ts` decides which characters are dialogue before `render.ts` wraps them:

- **A stray opening quote.** When a second `“` arrives before the closing `”` and is followed by a space or punctuation, it closes the line ("why didn't you — “ She grabs…"). Followed by a word, the earlier line simply ran unclosed and a new one starts there.
- **A stray straight quote.** A `"` hugging the word before it, then a space, is a stray closer, not an opener.
- **Mixed marks.** `“…"` pairs still close.

## The studios

### Lore that covers everyone

**The census** (`takeCensus`) comes before any plan. It lists every person, place, group, thing, event and idea in your material, plus the source's canon when the world is based on an existing work. It never lumps people together, and anything you named that the model missed is still counted (`namesInText`).

- **Everything** is a new plan size. It plans every census name in batches of 18, then the concepts, rules and events that hold the world together. Smaller sizes always fit every core name.
- **Coverage list (Plan step).** "Not in the plan yet" lists who's missing, as chips: add one, or "Plan all".
- **Split entries.** Entries that lump people together ("Taissa Turner & Van Palmer", "Gen, Melissa & Crystal") are split, one person per entry.

### Canon from the web (`creator/research.ts`)

- **Based on.** The read-back works out what the material is based on ("Yellowjackets (TV series, 2021)"). You can also set it in Questions or the plan options.
- **Reading up.** Before planning (or with "Read up on canon"), Mea reads:
  - the work's Fandom wiki, with its whole character roster;
  - Wikipedia;
  - any links you paste.
  
  Everything is read through the MediaWiki APIs, and only public addresses are fetched. Mea distils it into a **canon brief** with a cast list, places, events, and fanon marked as fanon.
- **Per entry.** Each canon entry reads its own wiki page before it's written; the plan shows which page.
- **Fanon.** Fanlore and AO3 block automated readers, so fanon comes from the model's own knowledge (marked as fanon) and from pages you paste.
- **The creator** does the same for a character from an existing work: their own wiki page, then the brief.

### In both studios

- **Suggested answers.** Every interview question comes with three answers to tap. Follow-ups build on what you've answered.
- **Meus, the co-writer** ("Brainstorm with Meus"; it was called Mea before it came to chats too, see [13-meus.md](13-meus.md)) is a companion chat.
  - **Brainstorming.** It riffs, offers options, pushes back and knows the fandom. It changes the draft only when you ask or agree.
  - **In "Expand my idea".** Meus reads your idea and every expanded section by heading. It can rewrite a section, add a new one, or (rarely) your idea itself. **Brainstorm** on the panel opens the chat; the speech-bubble button on a section starts the message for you ("Let's brainstorm the Central tension section: ").
  - **Looking things up.** When it needs facts it searches the wiki (one round), and the pages it read show under its reply.
  - **Changes.** Proposed changes appear as diffs you tick or untick:
    - **Creator:** idea and concept sections, bible sections, fields, background rewrites, the name.
    - **Lore:** idea and concept sections, the overview, an entry's text, plan lines, new entries, leaving one out, background rewrites.
- **Out of date.** Entries and fields remember fingerprints of what they were written from (`basis`).
  - **Lore:** the overview, your answers, what it's based on, and the entry's own plan line.
  - **Creator:** the name, what it's based on, and just the bible sections that field reads.
  
  Change one, and Review says what changed, with "Bring them up to date". Your own edit counts as up to date.
- **Editor's pass.** A model-based critique of what's written.
  - **Lore:** contradictions, flat writing, canon mistakes, weak keys, two subjects in one entry, and who's missing.
  - **Creator:** voice drift, static greetings, puppeting, contradictions, generic rules.
  
  Each note has a one-tap fix: a rewrite with that steer, or a new plan line.

### Routes

| Lore Studio | Creator |
|---|---|
| `POST /lore-studio/:id/research` `{urls?}` | `POST /creator/:id/research` `{urls?}` |
| `POST /lore-studio/:id/census` | |
| `POST /lore-studio/:id/outline` `{names?}` | |
| `POST /lore-studio/:id/critique`, `/critique/:issueId` | `POST /creator/:id/critique`, `/critique/:issueId` |
| `POST /lore-studio/:id/cowrite`, `/cowrite/apply`, `/cowrite/dismiss`, `DELETE /cowrite` | the same under `/creator/:id` |

`MEA_OFFLINE=1` keeps research off the network (the tests set it).

## Tests

- **`trackers.test.ts`:** places after the `@`, ledgers stored the old way, merge, and edit.
- **`smarts.test.ts`:**
  - name matching and splitting;
  - the URL guard and the HTML cleaner;
  - the co-writer's lookup round;
  - the census, Everything and coverage;
  - suggested answers, stale entries and fields, the editor's pass, and the co-writer in both studios.

## Who is who (personas are not cards)

**What went wrong.** Every step treated a persona like a character card. The co-writer offered "Make the greeting start in the middle of an argument" on a persona, the editor's pass looked for greetings and rules, and models slipped in `{{char}}` or "her relationship with {{user}}" for someone who *is* {{user}}.

**The fix:**

- **`WHO_IS_WHO`** (`creator/smarts.ts`) says what a card, a narrator and a persona each are in a chat. Every creator step (expand, deepen, read-back, bible, section rewrites, the bible check, fields, the editor's pass, the co-writer), the persona card tools and the Lore Studio's persona lorebooks read it. It's exported for anything else that works on a chat (Meus).
- **Persona prompts** ask what the player needs to step into this person, never about greetings or "what they want from {{user}}". The editor's pass for a persona looks for card habits and scripted choices instead of greetings and rules.
- **Slips are fixed.** A `{{char}}` in persona text becomes their name (`unslipPersona`). Chat lines are sent back for one more try (`personaSlip`). Review flags any that remain (`checkPersona`, "card-words").
- **The wrong kind is noticed.** The read-back says when the material reads as the other kind ("I'm a night nurse…" in a character draft). Questions shows "Make it a persona" (`POST /creator/:id/kind`, which switches in place and asks again) or "keep it" (`dismissKindHint`, never asked again).
- **Examples in the co-writer** follow the kind: a persona never gets card prompts.

## A more capable co-writer

- **It sees what's flagged.** `THE STATE OF THE DRAFT` lists open questions, what's still unclear, both editors' notes, out-of-date fields, the automatic checks' warnings, what's not written yet and what's being written. "What's wrong?" and "Fix what's flagged" work.
- **New changes it can propose:**
  - `answer`: answers an open interview question.
  - `option`: the draft's shape (tone, style, length; for cards also point of view, tense, card type and greetings). Values are checked, so "first person" becomes `first`.
  - `basedOn`: what it's based on.
  - `write`: writes every empty field (or all of them) from the bible in the background.
