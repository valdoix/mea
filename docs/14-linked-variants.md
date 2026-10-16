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
- Character page › **Versions** › **New version**. Until part 2 it opens the creator as a copy, as today, but the link is kept when you save.
- On a version: a chip **"Version of Mira · College AU"** (it opens the original), plus a **Version** menu with **Compare with original**, **Detach** and **Export**.
- Personas: the same section, chip and menu.
- Home: a universe chip on version cards, and a **Group versions** toggle.
- Deleting an original that has versions: a dialog lists them and offers **Detach them and delete** or **Cancel**. Nothing is lost.

**Compare** opens original and version side by side, field by field, using `DiffModal.svelte`. Lore comparison arrives with part 3.

**Export.** A character version exports like any card. Its `character_book` holds its own companion book and universe book merged (with entry names prefixed only when two collide). Personas export as today.

**How it's built**
- **Migration 23:**
  - `characters`: `variant_of TEXT REFERENCES characters(id) ON DELETE SET NULL`, `universe_id TEXT`, `anchors TEXT NOT NULL DEFAULT '[]'`, `variant_kind TEXT` (au / era / skip / whatif)
  - `personas`: the same four columns, referencing `personas(id)`
  - `universes`: `id, name, premise, kind, map TEXT NOT NULL DEFAULT '[]', book_id TEXT REFERENCES lorebooks(id) ON DELETE SET NULL, created_at, updated_at, deleted_at` (filled in from part 4)
  - `variants`: `on_version_id TEXT` for Looks that sit on a version (used in part 6)
- **New `services/versions.ts`:** `makeVersion`, `listVersions`, `originOf`, `detach`, `compare`. Saving a creator draft whose `origin.copyOf` is set writes `variant_of`.
- **Routes:** `/api/{characters,personas}/:id/versions`, `/api/versions/:kind/:id/{detach,compare}`.
- **Library payloads** gain `variantOf` and `universe` so Home can group and label.
- **Web:** `VersionsPanel.svelte` (character page and persona editor), a `VersionChip.svelte`, and the delete dialog.
- **Meus:** `version_detach`.

**Tests (`versions.test.ts`):** make a version of a character and of a persona; it chats and exports on its own; detach; deleting the original detaches its versions; Looks still work as before.

---

## Part 2 · The variant studio

**What you get:** a version written the way the creator writes a card, but starting from everything the original already is. Same shape as the creator: **Start → Questions → Map → Bible → Write → Save**.

### The steps

1. **Start.**
   - The original (a character or a persona). Its card, its bible if the creator made it, and its linked lorebooks come along.
   - The kind: **Alternate universe**, **Another era**, **Time skip** ("ten years later"), **What if** (one event went differently).
   - The premise in your words, with **Expand my idea**, the three suggested directions, and **Brainstorm with Meus**.
   - Until part 4: the universe is created here, privately, for this one version.
2. **Questions,** about the change, each with three suggested answers, as in the creator:
   - What's the point of divergence, and when does it happen?
   - **What must stay true?** Mea suggests anchors drawn from the original (voice, core wound, want, a habit, a relationship), and you tick the ones that hold in this version.
   - What's lost, gained or turned upside down?
   - For a time skip: what happened in between?
3. **The map.** One row for each person, place, group, thing and event from the original's card and lorebooks (from `takeCensus`), plus the original themself.

   | Original | → | In this version | State |
   |---|---|---|---|
   | Winterfell | → | the Stark family's ranch outside Bozeman | changed |
   | Ned Stark | → | Dad, the county sheriff | changed |
   | Longclaw | → | — | dropped |
   | Arya | → | Arya | kept |
   | — | → | the rival ranch next door | new |

   - Each row has suggested answers, and the map has **Fill the rest** and **Brainstorm this row**.
   - **Not mapped yet** lists rows still open, as chips, like the Lore Studio's coverage list.
   - The map is saved with the draft (and in part 4, with the universe).
4. **Bible.** The original's bible sections, each marked **kept**, **changed** or **new**. For a card without a bible, one is drafted from the card first, the way **Rework** does today.
   - Only changed and new sections are written. Kept ones are copied, and can be opened up with one tap.
   - The editor's check gains two tests:
     - **Still them?** Each anchor must still be visible.
     - **Leaks:** anything the map changed or dropped that slipped through unchanged.
   - **Sharpen**, **Rewrite**, **Rework with a steer** and **Apply fix** work as they do now.
5. **Write.** Every field is written from the variant bible, in the same order and with the same checks as the creator: greetings that act for `{{user}}`, point of view, repeated greetings, stock phrases, bloated fields. Greetings are set in the new world. Kept fields that the bible didn't change are copied word for word.
6. **Save.** It saves as a new card or persona with `variant_of`, `universe_id`, `anchors` and `variant_kind`. Then: **Open**, **Start a chat**, **Write its lorebook** (part 3), and for a character, **Make my persona's version too** (below).

### Persona versions

- **On their own.** Your persona can get a version for any story: "me, but a vampire", "me in 1920s Chicago". It's the same flow, with the persona's shorter bible (including skills and limits), and its anchors.
- **Alongside a character.** After saving a character's version, **Make my persona's version too** opens the studio for your persona with the same premise and map already filled in. It uses the existing persona-twin path (`fromDraftId`, `oppositeOf`), so the two fit each other: if Mira is now your rival on the next ranch, your persona's version knows it.
- **Choosing which persona.** By default it's the character's default persona (`default_persona_id`). You can pick another.

### How it's built
- `creator/creator.ts`: a new draft kind flag `variant: { originKind, originId, kind, premise, anchors, map }` on `CreatorDraft`, rather than a separate draft type, so every creator tool keeps working.
- New `creator/variant.ts`: anchor suggestions, the divergence questions, map building from the census (`takeCensus` takes a card and books as material), the marked bible, and the **Still them?** and **Leaks** checks. The leak check runs on rules first (names from changed and dropped rows) and only asks the model about paraphrases.
- Saving goes through the existing save, plus the part 1 link.
- **Web:** `CreatorHub.svelte` gains **A version**. New `CreatorMap.svelte` (the map table) and `CreatorAnchors.svelte`. `CreatorBible.svelte` shows the kept / changed / new marks.
- **Meus** in the studio can propose map rows, anchors and section rewrites, as diffs.
- Creative steps run on the **summarizer** route, as the creator's do.

**Tests (`variantstudio.test.ts`, mock provider):** a character version and a persona version from premise to save; kept fields copied exactly; a leak caught and fixed; an anchor dropped and flagged; "Make my persona's version too" carrying the premise and map.

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
- Retelling: `services/versions.ts` `retell(chatId, arc, versionIds)` uses the existing summaries (`memory/recap.ts`) and one map-translation call, then `createChat`.
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
| Confusion with card History (`character_versions`) | The UI says **History** for snapshots and **Versions** for linked cards. The code keeps the names apart (`versions.ts` vs the existing history routes) |
| Deleting an original | Versions are detached, never deleted, after a dialog |

## What you'll do

Nothing until a part is ready. Each part arrives as its own PR. Part 2 is the one worth trying hands-on first: make an AU version of a character you know well, with a persona version alongside it, and check the map and the anchors with a real model.
