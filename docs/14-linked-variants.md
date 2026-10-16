# Build plan: linked variants (versions and universes)

**Written:** October 16, 2026 · **Base:** Mea `main` after PR #84 (plus the creator work on `claude/creator-weaver-ideas`)

Today a variant (CHAR-06, PER-05) is a set of edits laid over a card or persona: an outfit, an era, an AU. That works for an outfit, but it can't carry a whole alternate universe: there's no lorebook of its own, every field it touches is replaced whole, and the world around the character stays the original's.

This plan makes variants a real feature. A **version** is a real card or persona with its **own lorebook**. It stays **linked to the original**, so Mea always knows what it kept, changed, dropped or added, and can carry later edits from the original across. Several versions can share a **universe**: one premise, one translation map and one world book, which a whole cast (your persona included) can move into. That's what makes alternate-universe stories work.

Characters and personas get the same thing. Every part below covers both, unless it says otherwise.

---

## 0. Read this first

### 0.1 What's already in Mea (found while planning)

| Piece | Already in Mea | So this plan… |
|---|---|---|
| Edits laid over a card or persona | `services/variants.ts`, the `variants` table (migration 7), `VariantsPanel.svelte` on the character's **Variants** tab and on Personas | keeps them, renamed **Looks**, and lets a look sit on top of a version (§6) |
| A copy rebuilt from an original | `createCreatorDraft({ baseId, asCopy })` in `creator/creator.ts` sets `origin.copyOf` and keeps the original's world books | turns "rebuild as a copy" into "make a version": the link is kept after saving (§1) |
| Characters and personas in one studio | The creator handles both kinds (PER-04), with persona twins (`fromDraftId`, PER-06) and personas built opposite a character (`oppositeOf`) | the variant studio is one flow for both kinds, and a character's version can bring its persona version along (§4) |
| Listing everything in a world | `takeCensus` in `lore/studio.ts`: every person, place, group, thing, event and idea, never lumped together | gives the translation map its rows (§2) |
| Out-of-date tracking | `basis` fingerprints on creator fields and lore entries (`basisOf` in `lore/studio.ts`), with "Bring them up to date" | tells a version what changed in the original (§5) |
| Companion and persona lorebooks | CHAR-18 and PER-03, linked through `lorebook_links` (`target_type` character / persona) | each version gets its own companion book, written through the map (§3) |
| Card export with a lorebook inside | `cards/card.ts` `character_book`, and PNG / JSON / CHARX export on the character page | exports a version as a standalone card with its merged lore (§1) |
| Card history | `character_versions` (saved snapshots of one card) | stays as it is. In the UI those are **History**; the new things are **Versions**, so the names never clash |

### 0.2 Words used in this plan

| Word | Means |
|---|---|
| **Original** | The card or persona a version comes from |
| **Version** | A full card or persona linked to an original, with its own lorebook |
| **Look** | Today's lightweight variant: a few field edits over a card, persona or version |
| **Universe** | A shared setting for versions: premise, translation map, world book |
| **Map** | One row per person, place, group, thing and event from the original's world: *kept*, *changed* (with its new form), *dropped*, or *new* |
| **Anchors** | What must stay true about the person in every version (voice, core wound, what they want, a habit) |
| **Leak** | Something from the original world showing up in a universe that mapped it to something else |

### 0.3 Principles

1. **A version is a card.** It stores its own text, so it edits, chats, exports and backs up like any card. The link adds knowledge; it never makes the version depend on the original to work.
2. **Copy plus change notes, not live inheritance.** Edits to the original reach a version as notes you accept (or as auto-sync, per version), never silently.
3. **The map comes first.** Every field and entry is written through the map, so nothing comes out half-translated, and the leak check has something to check against.
4. **Characters and personas are equal.** Every step, table and button works for both kinds.
5. **Nothing is saved until you press Save.** The same rule as both studios today. Drafts continue on any device.
6. **Meus can do it.** Each part adds Meus change kinds (`meus/changes.ts`) with the usual tick-to-apply card and Undo.
7. **One PR per part,** with tests in `server/test/`, and `bun run test`, `bun run check` and `bun run build` passing.

### 0.4 Where things live

| Surface | What goes there |
|---|---|
| **Character page** | The **Variants** tab splits into **Versions** and **Looks**. A version's own page has a "Version of Mira · College AU" chip linking back |
| **Personas** | The same two sections in the persona editor, and the same chip on a persona version |
| **Home / library** | A version shows as its own card with a small universe chip. A **Group versions** toggle folds them under their original |
| **Creator Studio** (`/creator`) | A fourth way in: **A version** (of a character or persona). Drafts list with the others |
| **Universes** (new, under Lorebooks) | Every universe: premise, map, world book, and who's in it |
| **Inbox** | "The original changed" notes, source **version** |
| **New chat** | Pick a character version and a persona version. Mea suggests the persona version in the same universe |

---

## Parts at a glance

| Part | Theme | Done when |
|---|---|---|
| **1** | Linking | A version can be made, opened, compared, detached and exported, for characters and personas |
| **2** | The variant studio | A version is written from a premise, anchors and a map, through a marked bible |
| **3** | The version's lorebook | Its companion book is written through the map: kept, changed, dropped, new |
| **4** | Universes | Several versions share one premise, map and world book, and a persona can join |
| **5** | Changes from the original | Edits to the original reach versions as notes, re-translation or auto-sync |
| **6** | In chats | Leak checks, retelling a chat in another universe, Looks on versions |

Parts run in order. Part 4's tables are created in part 1 (empty), so versions made early never need migrating.

---

## Part 1 · Linking

**What you get:** a version is a real card or persona that knows its original. It can be made straight from today's "rebuild as a copy", so there's something to use before the studio exists.

**Buttons**
- Character page › **Versions** tab (it was **Variants**; Looks sit under it) › **New version**: a name ("College AU") and a kind, then either
  - **Rebuild in the studio:** the creator rebuilds it as a copy, and the link is made when you save. Part 2 turns this into the full variant studio.
  - **Copy now, change by hand:** an instant copy of the card, portrait, tags, settings and lorebooks, opened for editing.
- On a version: a chip **"Version of Mira · College AU"** under the name (it opens the original). Its Versions tab has the version's name, kind and **What stays true** (its anchors), plus **Compare with Mira** and **Detach** (with Undo). Export is the usual export button.
- Personas: the same panel under **Versions and looks**, the same chip, and a small "Version of…" line in the persona list.
- Home: a universe chip on version cards, and a **Group versions** toggle.
- Moving an original to the Trash: the dialog lists its versions. They keep working and stay linked while it's in the Trash (the chip says so). Deleting it for good detaches them (the link is `ON DELETE SET NULL`). Nothing is lost.

**Compare** opens original and version side by side, field by field, using `DiffModal.svelte`. Lore comparison arrives with part 3.

**Export.** A character version exports like any card. Its `character_book` holds its own companion book and universe book merged (with entry names prefixed only when two collide). Personas export as today.

**How it's built**
- **Migration 23:**
  - `characters`: `variant_of TEXT REFERENCES characters(id) ON DELETE SET NULL`, `variant_kind TEXT` (au / era / skip / whatif), `variant_label TEXT` (the version's own name, "College AU"), `universe_id TEXT REFERENCES universes(id)`, `anchors TEXT NOT NULL DEFAULT '[]'`
  - `personas`: the same five columns, referencing `personas(id)`
  - `universes`: `id, name, premise, kind, map TEXT NOT NULL DEFAULT '[]', book_id TEXT REFERENCES lorebooks(id) ON DELETE SET NULL, created_at, updated_at, deleted_at` (filled in from part 4)
  - `variants`: `on_version_id TEXT` for Looks that sit on a version (used in part 6)
- **New `services/linked.ts`** (not `versions.ts`: card History already owns that word in the code): `copyAsVersion`, `linkVersion`, `updateLink`, `detachVersion`, `linkInfo`, `listLinkedVersions`, `versionLabels`, `compareWithOriginal`. Linking refuses loops.
- **Creator:** `createCreatorDraft({ baseId, asVersion: { kind, label } })` sets `origin.versionOf`, and the first save links the new card or persona.
- **Routes** (`routes/linked.ts`; `/family` because `/characters/:id/versions` is History): `GET|POST /api/{characters,personas}/:id/family`, `POST|PUT …/:id/link`, `POST …/:id/detach`, `GET …/:id/compare`.
- **Library payloads:** a character or persona carries `link` (its original, label, kind, anchors and versions). Lists carry `version` (original's name and label) so Home and Personas can label and group.
- **Web:** `VersionsPanel.svelte` and `VersionCompare.svelte` (character page and persona editor), the chip, the Trash dialogs, and Home's **Group versions** chip.
- **Meus:** none in this part. Meus's change kinds act on a story, and detaching is a library action; Meus gets version kinds in the studio (part 2).

**Tests (`versions.test.ts`):** a version of a character and of a persona; it chats and exports on its own with its lore; compare; detach and relink, with loops refused; an original in the Trash keeps its versions linked, and deleting it for good detaches them; the creator saves a linked version once; Looks untouched; the routes and library payloads.

---

## Part 2 · The variant studio

**What you get:** a version written the way the creator writes a card, but starting from everything the original already is. Its steps: **Premise → Questions → Map → Bible → Write & save**.

**Ways in:** **Rebuild in the studio** on a character's or persona's **Versions** panel (part 1), or **Creator Studio › A version** (pick a character or persona, a kind and a name).

### The steps

1. **Premise.**
   - The original (a character or a persona). Its card, its bible if the creator made it, and its linked lorebooks come along. The original's text is the source; the premise is kept apart from it, and outranks it wherever they disagree.
   - What it's called ("College AU") and the kind: **Alternate universe**, **Another era**, **Time skip** ("ten years later"), **What if** (one event went differently).
   - The premise in your words, with **Show me directions** (three divergent takes, steerable, with **Use this** or **Add to mine**) and **Brainstorm with Meus**.
   - Until part 4 there's no universe to join; the premise and map live on the draft.
2. **Questions.**
   - **What stays true.** Mea suggests anchors drawn from the original (voice, core wound, want, a habit), and you tick the ones that hold in this version, untick the rest, or add your own. A persona's version made alongside a character's has **Suggest them** for its own.
   - Three questions about the change, each with why it's asked and three suggested answers to tap: the point of divergence, what it costs or gives them, who they are to the people around them now. **Ask me another** (optionally steered) adds one more.
3. **The map.** One row for the original themself, every entry in their lorebooks (name and type, read without a model call), and every name their card and bible mention (one model call).

   | Original | → | In this version | State |
   |---|---|---|---|
   | Winterfell | → | the Stark family's ranch outside Bozeman | changed |
   | Ned Stark | → | Dad, the county sheriff | changed |
   | Longclaw | → | — | dropped |
   | Arya | → | Arya | kept |
   | — | → | the rival ranch next door | new |

   - Mea fills the first 36 rows (and may add up to four new ones the version needs); **Fill the N open** does the rest in batches of 18.
   - Each row: its type, **The same / Becomes… / Not here / New here / Not decided**, what it becomes, and a note. Filter chips by state, **Add a row** (from the original or new here), remove a row.
   - **Read the original again** adds anything new and never touches rows already there.
4. **Bible.** The original's sections, each marked **Kept**, **Changed** or **New**.
   - With the original's bible (when the creator made the original): a kept section is copied word for word, and only the rest is written. A section is marked by comparing it with the original's, so an edit turns Kept into Changed.
   - Without one: every section is written from the card, and the writer marks each one.
   - The editor's check gains two criteria: **Still them** (every anchor visible, the same person moved) and **In its own world** (the premise and map followed, nothing half-translated).
   - **Leaks** are found by rules, for free: an original name the map changed or dropped that still appears. Names are matched as written ("Rose" the person, not "rose" the verb), and a name that's part of its own translation ("Arya" → "Arya Stark") doesn't count. Each leak in a section has **Fix it**, which rewrites the section with what to use instead.
   - **Sharpen**, **Rewrite**, **Rework with a steer** (your edits stand) and **Apply fix** work as they do now.
5. **Write.** **Write the version** writes only the fields its changes reach: a field carries over word for word when every section it's written from is kept and nothing in it leaked. Greetings and the scenario always open in the new world, so they're always written. The write step says what carried over and what still holds the original's text (**Write the N for this version**), and any field that still names things from the original's world shows the leak, with **Fix them** for all of them at once.
6. **Save.** It saves as a new card or persona linked to the original, with its name, kind and the anchors you kept. Then: **Open**, **Start a chat**, **Build a companion lorebook** (as today; part 3 writes it through the map), and for a character, **Make my persona's version too**.

### Persona versions

- **On their own.** Your persona can get a version for any story: "me, but a vampire", "me in 1920s Chicago". It's the same flow, with the persona's shorter bible (including skills and limits), and its anchors.
- **Alongside a character.** **Make my persona's version too** (after saving a character's version) makes a persona version with the same kind, name, premise, answers and map (minus the character's own row), built to play opposite the character's version (`oppositeOf`). It opens at its questions.
- **Which persona.** The character's default persona, or your default persona if the character has none.

### How it's built
- `creator/variantcore.ts` (no creator imports): the plan on the draft (`variant`: original, kind, name, premise, anchors, map, the original's bible, marks, directions), `variantBlock` (what every step reads), `findLeaks`, `marksOf`.
- `creator/creator.ts`: `variant` on `CreatorDraft`, set by `asVersion`. `baseBlocks` labels the original as the source and adds `variantBlock`, so the questions, bible, fields, checks and co-writer all read the premise, anchors and map. `writeVariantBible`, `draftLeaks`, `variantMarks`, `variantFieldPlan`, leak issues in the card review, two more bible criteria, and the anchors linked on save. A new `map` stage.
- `creator/variant.ts`: premise directions, anchors and questions (`startVariant`, `anotherVariantQuestion`), the map (`buildMap`, `fillMap`), and `personaVersion`.
- **Routes:** `PUT /api/creator/:id` takes `variant` edits (kind, name, premise, anchors, map rows). `POST /api/creator/:id/variant/{directions,start,question,map,map/fill,persona}`. `POST /api/creator/:id/bible` writes a version's bible for a version draft. The draft payload adds `leaks`, `marks` and `fieldPlan`.
- **Web:** `VariantStart.svelte`, `VariantQuestions.svelte` and `VariantMap.svelte` for the first three steps; `CreatorBible.svelte` and `CreatorWrite.svelte` show marks, leaks and the field plan; `CreatorHub.svelte` gains **A version**.
- **Meus** in the studio proposes map rows (`map`) and anchors (`anchor`) alongside its usual section and field changes, as diffs to tick.
- Creative steps run on the **summarizer** route, questions and the name list on the helper route, as the creator's do.

**Tests (`variantstudio.test.ts`, mock provider):** the original kept apart from the premise, and premise takes; anchors and questions, ticking and adding; the map from lorebook, card and the original, filled and rebuilt without touching your edits; the bible marked against an original bible (kept copied, edits change the mark, your edit stands on a rework) and without one; leaks in the bible and fields, with names matched as written, and the two extra criteria; the field plan; save with name, kind and kept anchors; the persona's version, its own anchors; every route.

---

## Part 3 · The version's lorebook

**What you get:** the version's own lore, written through the map, so the AU has its own places, people and history, not the original's.

### What happens to each entry

From the original's linked books (companion and world), every entry goes through the map:

| Map says | The entry |
|---|---|
| **kept** | is copied, and remembers which entry it came from |
| **changed** | is rewritten through the map: new name, new facts, the same role in the story |
| **dropped** | is left out |
| **new** | is written fresh from the map row and the bible |

**Where entries go.** People and things that belong to this character go to the version's **companion book**. Places, groups and world rules go to the **universe book**, so other versions can share them later (part 4). Until part 4, both books belong to this one version.

### Buttons
- **Write its lorebook** after saving (part 2), or **Lore** tab › **Write this version's lorebook** on any version.
- It opens the Lore Studio with the map as its plan: **Plan → Write & review → Save**. Every entry shows its source entry and state, and can be edited, rewritten or left out before saving.
- **Compare with original** (part 1) gains a **Lore** side: entry next to entry.

### How it's built
- `lore/studio.ts`: a new start mode **From a version** that builds plan items from the map instead of a census. Each item carries `source: { entryId, state }`.
- Saved entries keep `extra.source = { entryId, bookId, state, basis }`. `basis` is the source entry's fingerprint (the existing `basisOf` idea), which is what part 5 compares against.
- Entries keep the Phase 3 fields (type, aliases, essentials, secrets, folder, parent). Aliases from the original are mapped too, so the old name of a changed place is never left behind as an alias.
- Links: the companion book to the version (`target_type` character or persona), the universe book to the version until part 4 moves it to the universe.
- **Meus:** `version_lore_entry` (rewrite one entry through the map).

**Tests (`versionlore.test.ts`):** kept entries copied with their source; a changed entry renamed everywhere including aliases; dropped entries absent; new entries present; a persona version's book linked to the persona; export carries the merged book.

---

## Part 4 · Universes

**What you get:** an AU becomes a place, not one card's private setting. Make Mira's college AU, and later Jon's version joins it: it reuses the premise, the map and the world book, and only Jon's own card and companion lore are written.

### Buttons
- **Lorebooks › Universes:** every universe with its premise, map, world book, and the versions in it (characters and personas). **New universe** starts with no versions yet.
- In the variant studio's **Start:** **Join a universe** (pick one) or **New universe**.
- On a universe page: **Add a character** and **Add my persona**, both opening the variant studio already joined.
- On a universe's map: rows added by one version's studio are visible to the others. A row that one version changed ("Ned → the sheriff") is offered, not forced, to the next.

### What joining means
- The premise and map are shared. Joining adds this original's own census rows to the shared map, so Jon's people get mapped next to Mira's.
- World entries (places, groups, rules) are written once, in the universe book. Joining reuses them and writes only what's missing.
- Anchors stay per person.
- A persona can join any universe. A chat between a character version and a persona version in the same universe gets both companion books and the one universe book.

### How it's built
- The `universes` table from part 1 comes into use. New `services/universes.ts`: create, join, leave, shared map edits, the book link (`lorebook_links` gains `target_type = 'universe'`, and a chat whose character or persona is in a universe activates that universe's book).
- The variant studio's **Start** and **Map** steps read and write the universe's map.
- Leaving a universe: the version keeps its own copy of the world entries it used, in its companion book.
- **Web:** `UniversesView` under Lorebooks, a `UniversePicker.svelte` in the studio, universe chips on Home.
- **Meus:** `universe_map_row`, `universe_join`.

**Tests (`universes.test.ts`):** two characters and one persona join one universe; the world book written once and active in their chats; a shared map row reused; leaving keeps the version working.

---

## Part 5 · Changes from the original

**What you get:** an original keeps growing, and its versions don't fall behind without you knowing.

### How it behaves
- When you save an edit to an original's card, bible or lore, each version compares the fingerprints it was written from (`basis`) with the original's new ones.
- **Kept** fields and entries that changed in the original: one note per version in the **Inbox**, "Mira's original changed: Personality, 2 lore entries", with **Take the changes** (copied straight across) or **Not for this version** (the field becomes the version's own).
- **Changed** fields and entries: **Translate the new part**, which re-runs only the edited part through the map and shows a diff.
- **Auto-sync** per version (a switch in the Version menu): kept fields and entries update without asking. Changed ones still ask.
- Your own edit to a version's field or entry marks it as the version's own, so it's never overwritten.
- A version's page shows a quiet **"2 changes from the original"** badge that opens the same list.

### How it's built
- `basis` is stored on version fields (`characters.settings.versionBasis` and the persona equivalent) and on lore entries (`extra.source.basis`, from part 3).
- New `services/versionsync.ts`: on save of an original (a hook in the card, persona and lorebook save paths), work out what's stale per version, queue Inbox items with source **version**, and apply them on accept, through `services/undo.ts`.
- Re-translation reuses part 2's per-section rewrite and part 3's per-entry rewrite, with the map.
- **Meus:** `version_sync` (take or skip a change).

**Tests (`versionsync.test.ts`):** a kept field updated by Take; a changed field re-translated; auto-sync touching only kept items; a field you edited in the version never overwritten; Undo restores.

---

## Part 6 · In chats

**What you get:** stories set in a version or universe stay in it.

### Leak checks
- A new check in the slip registry (`accuracy/slips.ts`): a reply that uses a name the universe changed or dropped ("Winterfell" in the ranch AU) is flagged, with the mapped name offered as a one-tap fix. It runs on rules, for free.
- The Codex, trackers and continuity checker treat a dropped name as foreign to this story, so a leak never becomes a cast entry or a place.
- A per-chat toggle in **Chat › Guards**, as for the other checks.

### Retell in another universe
- From a chat with the original: **Retell in…** (chat ⋯ menu) › pick a version (or a universe and the versions in it). Mea starts a new chat with the version, opening on the chosen arc's summary translated through the map ("replay our first meeting, college AU"). The new chat's memory starts fresh, with the translated summary as its opening recap.
- You pick the arc from the chat's chapters or scenes.

### Looks on versions
- A Look (today's variants) can sit on a version: *College AU* + *Winter coat*. The chat panel's variant picker lists the version's own Looks, then the original's Looks that make sense on it (any Look marked as "works on every version").
- **Make it a version** on a Look opens the variant studio with the Look's edits as the premise.

### Choosing in a new chat
- When you start a chat with a character version, the persona picker lists your persona versions in the same universe first, then your others.

### Later: crossovers
Two versions of the same person meeting (the original and an AU self, or two AUs). Each one's map lets it recognise the other. This is listed for completeness; it isn't part of the six PRs.

### How it's built
- The leak check reads the universe map through a small cache keyed by universe and map version.
- Retelling: `services/linked.ts` `retell(chatId, arc, versionIds)` uses the existing summaries (`memory/recap.ts`) and one map-translation call, then `createChat`.
- Looks on versions: `variants.on_version_id` (part 1) plus an "every version" flag. `applyCardVariant` / `applyPersonaVariant` accept a Look for the version or for its original.
- **Meus:** `retell`, plus fixing a leak in a past message through the existing message edit kind.

**Tests (`versionchat.test.ts`):** a leak flagged and fixed; a dropped name not filed in the Codex; a retold chat opening in the version with the translated summary; a Look applied on a version; the persona version offered first.

---

## Build order and dependencies

```
1 Linking ── 2 Variant studio ── 3 Version lorebook ── 4 Universes ── 5 Changes from the original
                                                    └─────────────── 6 In chats (needs the map from 2, the books from 3, universes from 4)
```

Parts 5 and 6 are independent of each other and can go in either order. Each part is usable on its own: after part 1 you can link copies, after part 2 you can write versions, after part 3 they have their own lore.

## Risks and how they're handled

| Risk | Handling |
|---|---|
| A big original (a narrator card with a large world) makes a huge map | The map is batched like the Lore Studio's **Everything** plan (18 rows at a time), and **Fill the rest** works in batches |
| Cost of writing a version and its lore | Kept fields and entries are copied, never rewritten. Only changed and new ones cost a call. The studio shows the estimate before Write |
| Half-translated text | Everything is written through the map, the studio's **Leaks** check catches what slipped, and the chat check catches the rest |
| A version drifting from who the person is | Anchors, the **Still them?** check, and Compare |
| The original and versions drifting apart | Part 5's notes and auto-sync |
| Confusion with card History (`character_versions`) | The UI says **History** for snapshots and **Versions** for linked cards. The code keeps the names apart (`services/linked.ts` and `/family` vs the existing history routes) |
| Deleting an original | Versions stay linked while it's in the Trash and are detached, never deleted, when it's deleted for good |

## What you'll do

Nothing until a part is ready. Each part arrives as its own PR. Part 2 is the one worth trying hands-on first: make an AU version of a character you know well, with a persona version alongside it, and check the map and the anchors with a real model.
