# Build plan: groups and places (people are people, groups are factions, places are places)

**Written:** November 8, 2026 · **Base:** Mea `main` at cff1f6a

In *Filed Under Forever*, the People list has a card called **Downstairs Kitchen**. Its "Rooms" are three sentences about the fridge ("fridge bears league standings in marker (BRONGEL 5 · THE FIELD 0…)"). The **Scoobies**, **Dawn's friends** and the **household** are listed as people too.

---

## 0. What went wrong

Measured on a copy of the production database (`VACUUM INTO`, 7,622 tracker events in this chat).

### Things that became people

| Name on the People list | Line that made it | Who wrote it | What it should have been |
|---|---|---|---|
| Downstairs Kitchen | `room downstairs kitchen: fridge bears league standings in marker (…)` ×3 | tracker | What the kitchen looks like now (a place note) |
| Scoobies | `know Scoobies: #arc-loss-faction-scoobies-… \| lived it · knows` | **the engine** (`sim/storyteller.ts:715`) | Willow, Xander, Anya and Tara know it. Scoobies is already a faction on the Story page |
| Hellions | `know Hellions: #arc-threat-faction-hellions-…` | engine, from a subplot you started | The faction's members, or a fact held by the faction |
| household | `know household: Gabriel invests in Sturgeon AquaFarms…` | tracker | Everyone who lives at the Winters house |
| Dawn's friends (Melissa, Kara, Jamie) | `know Dawn's friends (Melissa, Kara, Jamie): Buffy Summers is alive…` | tracker | Melissa, Kara and Jamie, plus a new group: Dawn's friends |
| everyone in scene | `know everyone in scene: Walter (the Council) must not learn…` | tracker | Everyone present. The crowd words have "everyone present" and "everyone here" but not this |
| Xander Harris · Willow Rosenberg · Tara Maclay · Anya Jenkins | one `know` line | tracker | Four people. `each()` splits on `,` `&` `+` `/` `and`, but not `·` |
| traits | `cast: … · traits@spot · Ruth@arrive` and `cast Dawn Summers: traits — walks fast…` | tracker | A trait line for Dawn. "traits" is a field name, not a person |

### One house, many names

There are 119 different `at` paths. 86 of them are some kitchen. The Winters house alone shows up under 42 paths:

- `Sunnydale › Winters Residence › …`, `Sunnydale › Hills › Winters Residence › …`, `Sunnydale › Winters House › …`
- `Gabriel's House › Downstairs › Kitchen`, `Sunnydale › Hills › Gabriel's Warded House › Front Porch`
- just `downstairs kitchen`, `downstairs kitchen › fridge`, `downstairs kitchen › table`, with no house above it

The Summers house has the same problem: `Revello Drive › Kitchen`, `Summers Residence › Kitchen`, `Revello Drive › Summers Residence › Kitchen`, `Sunnydale › Summers Residence › Kitchen`. Other bad paths:

- Typos: `Sunnyvale › Restfield Cemetery`.
- Movement written into a place: `Gabriel's BMW (pulling out of the drop-off lane)`, `parking lot → driving to Revello Drive`.

Because each spelling is a separate place, "what's changed since you were last here" (`changedSince`) and "whose room this is" (`roomLine`) miss most of the time. Items filed `at downstairs kitchen › fridge door` don't count as being in the Winters kitchen.

### Root causes

1. **Any name in a person line becomes a person.** `Folder.person()` (`trackers/fold.ts`) creates a character for every subject except crowd words. The fold doesn't know the story's factions or places, so it can't tell them apart from people.
2. **The `room` line gets misused.** In the grammar, `room A: Town › Place` means A owns that place. The tracker had no way to say what a place looks like now, so it wrote `room <place>: <what's there>`. The place became the owner, and the sentence became a room.
3. **The engine uses faction names as holders.** A subplot led by a faction ends with `know <Faction>: …`.
4. **A place is only its path.** There are no aliases, no parent above a bare room, no fuzzy matching and no merge.
5. **Factions live in two lists that don't see each other.** The Story page reads `cast_factions`. The engine's `knownFactions()` (`sim/service.ts:615`) reads clocks, reputation, subplots and lore. Neither feeds the fold.

---

## Parts at a glance

| Step | What it adds | Needs |
|---|---|---|
| **Part 0 · Fix: only people become people** | | |
| 0.1 | The fold knows the factions and places | — |
| 0.2 | `person()` sends groups, places and field words elsewhere instead of creating people | 0.1 |
| 0.3 | Name lists split on `·` and `;`; more crowd phrases | — |
| 0.4 | `room <place>: <sentence>` is read as a place note | 2.3 (falls back to a plain drop) |
| 0.5 | When a faction leads a subplot, its members get the knowledge | 0.1 |
| 0.6 | Refold every story and report what moved | 0.1–0.5 |
| **Part 1 · Groups become factions** | | |
| 1.1 | One faction list | 0.1 |
| 1.2 | Spotting groups, and adopting them automatically | 1.1 |
| 1.3 | A faction as a holder: what the group knows | 1.1 |
| 1.4 | Kinds of group: family, household, circle, organisation, side | 1.1 |
| 1.5 | Grammar: `member` lines and `@Group` | 1.1 |
| 1.6 | Factions on the Story page: suggested groups, members, what they know | 1.2, 1.3 |
| **Part 2 · A places tracker** | | |
| 2.1 | Place records: one place, many names | — |
| 2.2 | Matching an `at` path to known places | 2.1 |
| 2.3 | Place notes: what a place looks like now | 2.1 |
| 2.4 | Owners and residents | 2.1, 1.4 |
| 2.5 | The prompt uses known place names | 2.2 |
| 2.6 | Places on the Story page | 2.1–2.4 |
| 2.7 | Lore and the engine read the place tree | 2.2 |
| **Part 3 · Passing faces** | | |
| 3.1 | Unnamed extras are kept apart from the cast | 0.2 |
| **Part 4 · Measure and repair** | | |
| 4.1 | Golden scenarios from this chat | Part 0 |
| 4.2 | Story health: "not people" and "places with several names" | 0.6, 2.2 |
| 4.3 | Meus can sort out the cast and the places | 1.6, 2.6 |

**Order:** 0 → 4.1 → 2.1–2.3 (finishes 0.4) → 1 → 2.4–2.7 → 3 → 4.2, 4.3. Part 0 fixes this story on the next refold and needs no model calls. Part 2.1–2.3 comes before Part 1 because households (1.4) need homes.

One PR per part, merged when it's green, as with docs/24–29.

---

## Part 0 · Fix: only people become people

### 0.1 The fold knows the factions and places

`FoldConfig` gets:

- `factions`: `{ name, aliases, members }[]`, from `cast_factions` plus `knownFactions()`.
- `placeNames`: names and aliases from Part 2 (until then, the names already in `st.places`).

Snapshots are keyed by fold settings (`trackers/store.ts:514`), so a faction edit refolds from the first message that names that faction, not from the beginning.

### 0.2 `person()` routes instead of creating

Before a new character is created, the name is checked in this order:

| Check | Example | Where the line goes |
|---|---|---|
| A known faction (name or alias) | `Scoobies` | Each current member (person ops that can spread: `know`, `mood`, `bond`…). A `know` line is also kept as a faction fact (1.3). Other ops are rejected with "that's a group" |
| A group shape with names in brackets | `Dawn's friends (Melissa, Kara, Jamie)` | Each name in the brackets, and the group goes to suggestions (1.2) |
| A group shape with no names | `household`, `the family`, `Dawn's friends`, `the Winterses` | 1.2's resolver: the household of the home in the scene, or a family with that surname. If nothing matches, the line is held as a **suggested group** with nobody resolved, and the change says so |
| A known place, or a part of the current path | `downstairs kitchen` | A place note (0.4) for `room`. Other ops are rejected with "that's a place" |
| A field word | `traits`, `mood`, `note`, `cast`, `look` | Dropped. `cast X: traits — …` is read as `trait X: …` |

**Group shape** means one of:

- a possessive followed by a group noun ("X's friends / family / crew / gang / people / circle / kids / parents")
- a bare group noun ("household", "family", "family members", "the parents", "the kids")
- "the" followed by the plural of a cast surname ("the Summerses", "the Winters")
- a capitalised plural that has never been a person's name and is used as a holder

Only the first three are certain. The last one (`Hellions`) is a suggestion, not a rule.

Characters that were made by mistake in the past disappear on refold, because the state is rebuilt from the events. If one has a `cast_profiles` row (a portrait, notes), it's kept and reported in 0.6, never deleted.

### 0.3 Name lists and crowd words

- `each()` also splits on `·`, `•` and `;`, with the same exception as now: if someone really goes by the whole name, it's kept whole.
- `GROUP_WORD` gets "everyone in (the) scene / room / here", "all of you", "the whole house" and "the others here".

### 0.4 `room` written about a place

`room <S>: <body>` where S is a place, or where the body isn't a path (it has more than about six words in a part, or no `›` and reads like a sentence), is read again from its raw text, the way `know`, `secret` and `scene` already are (`fold.ts`, `apply`). It becomes `place <S>: <body>` (2.3). Until 2.3 lands it's rejected with "write room A: Town › Place | room", so at least nobody new gets created.

The prompt's example line (`trackers/prompts.ts:37`) gets a counter-example: "`room` says whose place it is. To describe a place, write `place`."

### 0.5 Subplots led by a faction

In `consequences()` (`sim/storyteller.ts`), if the lead is `faction:…`, the holders are the faction's members, plus one faction fact (1.3). If the faction has no members, only the faction fact is written. The same applies to `authorArc(…, group = true)`.

### 0.6 Refold and report

Refold every chat on a copy first. For each chat, write down:

- the characters that disappeared and where their lines went
- profiles left without a person
- held lines

That report goes in the PR. Then a one-time notice on the Story page: "Mea tidied the cast: Downstairs Kitchen is now a place; Scoobies, household and Dawn's friends are groups." It has an Undo for each item (a lock on that name).

### Part 0 as built (November 8, 2026)

- **0.1:** `FoldConfig.factions` holds the Story page's factions (with members) and the lore's faction and family titles (`lore/factionnames.ts`). The fold also counts the engine's own faction names (clocks, standing, subplots) as factions with no members. A faction edit changes the fold settings, so the story refolds from the start, not from the first message naming the faction. That's simpler, and fast enough for now.
- **0.2:** `Folder.whoIs()` (`trackers/fold.ts`, helpers in `trackers/whois.ts`). Someone already in the cast, or a name you said is a person, always wins. Lines that go elsewhere are counted in `state.notPeople`.
- **0.3:** as planned.
- **0.4:** `place Where: …` is a real line now (a small first step of 2.3): notes on the place, the `HERE:` line in the note, and the tracker sees them. `room <place>: …` is read as a place note. When the body is a path, the note lands on that path, with the bracket text and the cause as the note ("room Cabin: wilderness › clearing › cabin (abandoned, log walls)").
- **0.5:** done in the fold, not the engine. The engine still writes `know Scoobies: …`, and the fold spreads it over the members. With no members known, the line is rejected with a reason, and nobody is created.
- **0.6:** `scripts/cast-tidy.ts` (runs on a copy). On the Story page's Cast tab, a "Mea tidied the cast" notice lists each name with *It's a person* (with Undo) and *OK*, and stores the answers in `castTidy` in the chat's settings.

**Measured on a copy of the production database:** 4 names left casts across 2 chats, and no real person did.

| Story | Left the cast | Joined (named inside a group) |
|---|---|---|
| Filed Under Forever | Dawn's friends, Hellions, downstairs kitchen | Melissa, Kara, Jamie |
| The Word in Her Throat | Cabin (`room Cabin: Canadian wilderness › clearing › cabin (…)`, 5 lines) | — |

Scoobies, household and "traits" were already off this copy's cast (you'd removed household yourself, with `edit ["chars","household"] = null`). Their lines now go to the members (Scoobies) or nowhere, with a reason (household, traits).

---

## Part 1 · Groups become factions

### 1.1 One faction list

`cast_factions` is the record. `knownFactions()` reads it first, then adds what the engine knows (clocks, reputation, subplots, lore factions). Those additional names show on the Story page as factions **found in the story**, with a badge. They count as factions everywhere (the fold, the prompt, the engine), and confirming one only means you've looked at it.

Each faction record gets `aliases`, `kind` (1.4), `members[{ name, role, since, why }]`, `home` (a place id, 2.4) and `source` (you / lore / story / engine).

### 1.2 Spotting groups, and adopting them

A **group candidate** is any group-shaped holder (0.2), any capitalised group named in the story text ("the Scoobies", "the Hellions") and any lore entry of kind faction or family. It collects:

- **evidence:** the messages where it's named
- **members:** names in brackets; people present when the group is spoken to or about; the lore's "Members" field; the possessive anchor ("Dawn's friends" is tied to Dawn, as a circle)

A setting on the story's dials, **Groups: Automatic / Ask me / Off**, with Automatic as the default:

- **Automatic:** a candidate becomes a faction when it has been named in two or more messages, or has members listed, or comes from lore. Each one shows in the story's changes with Undo, like any engine change.
- **Ask me:** candidates wait in a "Mea thinks these are groups" strip.
- **Off:** groups are only what you make.

A candidate that never earns membership fades after 200 messages without a mention.

Membership changes over time. `member` lines (1.5) and evidence ("Dawn introduced Kara to her friends") add members with `since`. A member who dies stays on the list with †.

### 1.3 What a group knows

`know Scoobies: X` does two things:

- Each current member knows X, with the route "via the Scoobies".
- X is kept as a **faction fact**, with the members at that moment.

When someone joins later, they don't learn old faction facts unless a line says so. A group's knowledge isn't magic. The faction card lists its facts. FACTS IN PLAY shows a faction fact when a member is in the scene.

Secrets kept "from the Scoobies" work the same way: kept from each member, now and later, like "from everyone" does today.

### 1.4 Kinds of group

| Kind | Example | What changes |
|---|---|---|
| family | Winters Family, the Summerses | Members tied by blood or marriage. Feeds the roster's CLOSE ties (`sim/roster.ts`) |
| household | the household | **Whoever lives at a home** (2.4), not a fixed list. "household" in a line means the household of the home in the scene, or of the home the speaker lives in |
| circle | Scoobies, Dawn's friends | Friends. Anchored to a person when the name is possessive |
| organisation | Watchers' Council, Hellions | Can have clocks, reputation and relations in the engine |
| side | "the ones who want Buffy kept secret" | Short-lived, made from a stance. Never automatic, only by you or Meus |

The kind is guessed from the name and the lore category (family entries are already `type: "faction"` with a "Members" field, `lore/format.ts:81`). You can change it.

### 1.5 Grammar

New lines for the tracker prompt:

```
member Scoobies: + Dawn | junior · since she found the Slayer handbook
member Scoobies: - Anya — left after the wedding
know @Scoobies: Buffy is alive          (the group, spelled out)
```

The prompt lists the story's factions in one line ("Groups: Scoobies (Willow, Xander, Anya, Tara) · Winters Family (Gabriel, Eleanor) · Dawn's friends (Melissa, Kara, Jamie)") so the tracker uses those names. A bare group name in a person line still works through 0.2. `@` only removes any doubt.

### 1.6 Factions on the Story page

The section is already there (`web/src/views/StoryView.svelte`, around line 380). It gets:

- **"Mea thinks these are groups"** when Ask me is on, or for low-evidence candidates: name, evidence count, guessed members. Buttons: *Make a faction* · *Add to …* · *Not a group*. "Not a group" locks the name. If it's really a person, they come back as a person.
- On each faction card: kind, members with "since #n", home (a household's home), what they know (faction facts, newest first), and the engine's standing (clocks, reputation, relations), which today only appears in the World view.
- The person sheet's faction toggles stay. Add "since #n" on hover.

---

## Part 2 · A places tracker

### 2.1 Place records

The design copies the cast: the fold builds the places, and **place profiles** (a new table `place_profiles`, keyed by chat and place id, like `cast_profiles`) keep your edits through refolds.

```
Place {
  id, name, kind: town | district | street | building | home | floor | room | spot | vehicle | outdoors
  parent?: id               // the tree: Sunnydale › Winters Residence › Kitchen › Fridge door
  aliases: string[]         // "Gabriel's House", "Winters House", "downstairs kitchen"
  owner?: id; residents?: id[]
  notes: { text, seq }[]    // 2.3: what it looks like, newest first
  firstSeq, lastSeq, visits, seen?
  source: story | lore | card | you
}
```

`WorldState.places` keeps its shape for old readers, with `path` worked out from the parents. Items held `place:<path>` are resolved to a place id when folded, so the photos on the fridge door show under that place however the path was spelled.

### 2.2 Matching an `at` path

Each part of the path is matched from the top, against the current tree:

1. **Same name or alias** under the same parent.
2. **A bare room** (`downstairs kitchen`, `kitchen`) right after a scene in a building that has, or could have, that room: it goes under that building. "Downstairs" becomes a floor if the building already has floors, and stays part of the name if it doesn't.
3. **An owner's alias:** "Gabriel's House" and "Gabriel's warded house" resolve to the home Gabriel owns or lives in (Winters Residence), and the name becomes an alias.
4. **A one-letter typo** of a known town or building (Sunnyvale → Sunnydale), like `findChar` does for people.
5. **A street as an address:** "Revello Drive › Summers Residence" and "Revello Drive › Kitchen" are the same home when the Summerses live on Revello Drive. The street becomes the home's address, not a separate parent.
6. **Notes about moving** are stripped: brackets with a verb ending in -ing ("(pulling out of the drop-off lane)") and `→ driving to X` turn into a trip (from, to, by) on the scene, not into a place.
7. **Something new:** it goes under the deepest part that matched, and the change says "new place: Kitchen › Fridge door, under Winters Residence".

A match that isn't certain (rules 3–5) is shown as a change with *Not the same place*, which splits it and locks that.

**Target for this chat:** the Winters house is one building with about ten rooms and spots. The 42 paths should become those, and the 119 should come down to under 40. That gets measured in 4.1, not promised here.

### 2.3 Place notes

```
place Kitchen › Fridge door: league standings in marker, BRONGEL 5 · THE FIELD 0, target drawn
place Living room: permanent dart nick in the paint by the dartboard — Buffy keeps it
```

- A note belongs to the place and to the message it was written at. A new note about the same feature replaces the old one: "fridge door" notes stack up as a history, and only the newest is current.
- Old `room <place>: <sentence>` lines become notes when refolded (0.4). The three Downstairs Kitchen "rooms" become two notes about the fridge door and one about the living-room wall. The last of those one names the dartboard wall, so it goes under Living room.
- The note shows the current place's newest notes and its items. "Since you were last here" (`changedSince`) compares notes as well as items.

### 2.4 Owners and residents

- `room A: place | kind` keeps its meaning: A owns it.
- A new `lives A: place` line, plus evidence from the card or lore ("lives at", "her house"), fills `residents`.
- A **household** (1.4) is the residents of a home. That gives "household" in a line a meaning: Gabriel, Buffy and Dawn at the Winters house, if that's where they live now.
- The person sheet's "Rooms and belongings" lists only places that person owns or lives in, by their real names.

### 2.5 The prompt uses known place names

The tracker prompt gets a short list of known places around the scene, by their canonical paths: the current building's rooms, the town's usual places, and the five most recently visited. The instruction: "Write places by these names; add a new part only for a new place." This is cheap and cuts most of the drift before 2.2 has to clean it up.

### 2.6 Places on the Story page

A **Places** section between Factions and People:

- A tree (town › building › room), folded at the building level, with visit counts and "last here at #n".
- Each place card: name and aliases, kind, owner and residents, current notes, items here, and a link to its lore entry if there is one.
- Actions: *Rename* · *Merge into…* · *Move under…* · *Not a place* (for a phrase that got into the tree by mistake) · *Pin* (always kept in mind, like pinned people).
- The Director's Desk place picker (`DirectorsDesk.svelte:182`) uses the tree, so "move the scene to the kitchen" offers one kitchen per house.

The layout follows the cast cards. Mock it up in `mockups/` before building, as with the earlier rooms work.

### 2.7 Lore and the engine read the tree

- A location lore entry is linked to a place by title or alias. A place visited five or more times with no entry offers *Write a location entry* in the Lore Studio, never automatically.
- The roster's reach (`sim/roster.ts`, `Reach`/`TRAVEL`) is measured by distance in the tree (same room, same building, same town) instead of comparing path strings. Off-page arrivals land in real places.

---

## Part 3 · Passing faces

### 3.1 Extras aren't the cast

"Zapatos Dorothea worker" and "woman in brown cardigan" are people, but they're extras. A character whose name is a description (an article or a role noun, no proper name) is marked **passing**:

- It's folded into a "Passing faces" line under People instead of getting a full card.
- It gets no pressure cards and no engine subplots.
- It's promoted to the full cast when it gets a proper name ("rename"), shows up in three or more scenes, or you pin it.

---

## Part 4 · Measure and repair

### 4.1 Golden scenarios

Built from this chat's real lines (the ones quoted in §0), as fold tests that make no model calls:

- None of the eight names in the first table is a character after the fold.
- Willow, Xander, Anya and Tara know the Scoobies subplot fact. The Scoobies faction holds it.
- Melissa, Kara and Jamie exist, each knows "Buffy is alive", and "Dawn's friends" is a candidate (or a faction, under Automatic).
- Every Winters-house path resolves into one building. The fridge-door photos are at Winters Residence › Kitchen › Fridge door.
- `Sunnyvale › Restfield Cemetery` resolves to Sunnydale.

Also a few scenarios written from scratch for other genres (a guild, a ship's crew, a royal household), so the rules aren't fitted to one story.

### 4.2 Story health

Two new rows in Story health:

- **Not people:** cast entries that 0.2 would route somewhere else. Should stay at 0 after the fix. Not 0 means a new pattern.
- **Places with several names:** places whose path drifted within one building.

### 4.3 Meus

Meus gets tools for factions (make, merge, add a member) and places (merge, move under, rename, mark "not a place"), and a prompt: "Sort out the cast and places in this story." Every change goes through the same undoable changes.

---

## Open questions

1. **When to adopt automatically.** "Named in 2+ messages" may be too eager for a capitalised plural like "the Hellions" when it's a band name. Start at 2 with an Undo, and revisit after 4.2's counts.
2. **Place profiles as a table, or locks on the fold.** A table follows the cast and survives edits. Locks are lighter. This plan picks the table.
3. **Household:** a group of its own, or a view of a home's residents? This plan makes it a view, so it never goes stale.
