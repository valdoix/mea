# Build plan: a grounded world (the simulation acts only on what it knows)

**Written:** October 29, 2026 · **Base:** Mea `main` after PR #187 (news reach)

In *Pretty Hands and Proving It* (Buffy, season 6), Spike learned from Gabriel that his organization in LA hands out expired hospital blood. Over the next two ticks the world simulation passed it on, all "in person":

- Spike told Tara.
- Spike told Drusilla. She left Spike and was last seen in Los Angeles.
- Spike told Halfrek. She has never met Spike in this story.
- Tara told Willow and Oz a garbled version. Tara was never told on the page, and Oz left town in season 4.

PR #187 fixed the three triggers. A possessive hid Gabriel's name, so the fact didn't count as being about your character. A mention inside Halfrek's `history(…1880 London)` counted as a tie. A person with no stated place defaulted to "in town". You then had me delete the ten rows by hand.

This plan is about the class of bug, not those three triggers.

---

## 0. Read this first

### 0.1 What the history shows

The last nine fixes to `server/src/sim` all patch the same thing. The simulation reads who someone is, and where, from free prose with regexes, then acts on its guess.

| Commit | What it guessed wrong |
|---|---|
| f298135 | Lore titled "Faction: …", "History: …" became people named Faction and History |
| fdb1d7a | "Willow" and "Willow Rosenberg" were two people. "Killed Slayers in New York in 1977" put Spike abroad |
| f8cf9dd | "Nordstrom-rack" made a person called Rack, who led a subplot |
| c455e9a | Leads in the scene acted off the page |
| 810ddab | News reached the dead, came from strangers, and was about the leads |
| b751dee | Buffy, believed dead, "told" Willow and Giles things in person. Dead Kendra heard news |
| #187 | Possessive names, lore mentions as ties, nowhere means in town |

Each fix added one more regex or one more `continue` to a list of exceptions. `news.ts` now has twelve `continue` guards, and the next wrong guess will need a thirteenth.

### 0.2 What the live data shows

Measured on the production database after the cleanup:

- **News off the page:** every hop the engine ever made has been undone by you. None are left.
- **Proposals:** 73 have been made. Many lead with people who can't act or aren't people:
  - "Faction: The Watchers Council…"
  - Ruth the cat, three times
  - "Gabriel's mom (name Buffy Summers only" (a lore title cut mid-parenthesis)
  - Rack
  - Kendra and Darla, who are dead in season 6
  - Kara, a name with one line of lore
- **Roster for this chat:** Drusilla, Halfrek and Oz have no place, so all three are "town" (in Sunnydale). Spike has 11 ties, and 7 of them are the weakest kind: a name appearing somewhere in someone's lore.
- **No explanation:** a change chip says "told by Spike, in person" but not *why* the engine thought Spike and Halfrek talk. If the chip had said "tie: Halfrek's lore mentions Spike in history(…)", the bug would have been obvious at a glance.

### 0.3 Root causes

1. **The simulation's picture of people is guessed, every tick, and never shown.** Whether someone is alive, where they are, and who they're in touch with comes from regexes over lore prose. Nothing stores the result, nothing shows it to you, and you can't correct it, except through the Cast page's `standing`/`where`, which few people fill in.
2. **Unknown defaults to yes.** No place means in town. Any mention means a tie. A name the regex missed means the fact isn't about them. Each default turns missing data into an action.
3. **Exceptions instead of permissions.** Each engine feature (news, arcs, proposals, arrivals, ripples) has its own list of who may *not* act. Nothing states, in one place, who *may* reach whom.
4. **Off-page writes look the same as on-page truth.** A news hop writes `knows` into the same stance the writer and planner read, at full confidence, the moment it happens. One wrong guess becomes a fact in every prompt.
5. **No undo.** Engine changes can't be taken back from the page they appear on.

### 0.4 Principles (kept from docs/16 and docs/19, three added)

1. The tracker is the truth for who knows what.
2. Rules first. A model call is added only where rules can't decide.
3. A correction you make once holds until you undo it.
4. **New: unknown means no.** The engine acts off the page only on what it has on record: a place, a status, a tie. Missing data means it does nothing, never that it guesses.
5. **New: one sheet per person, read by every engine feature.** It is guessed once, shown to you, and kept until you or the story change it.
6. **New: every engine change says why and can be undone where it's shown.**

---

## Parts at a glance

| Step | What it adds | Needs |
|---|---|---|
| **Part 1 · Undo and why** | | |
| 1.1 | Undo on every engine change chip, branch-aware | — |
| 1.2 | "Why": the evidence behind each engine change | — |
| 1.3 | "Not again": undo can forbid the pair or the person | 1.1 |
| **Part 2 · The person sheet** | | |
| 2.1 | Status, whereabouts, era: stored slots per person in a chat | — |
| 2.2 | Filled once from lore by a model read, rules as fallback | 2.1 |
| 2.3 | The World page shows each sheet, its sources, and lets you fix it | 2.1 |
| 2.4 | The story keeps it current (left town, died, came back) | 2.1 |
| **Part 3 · Ties are acquaintance, not mention** | | |
| 3.1 | Typed ties: close, friend, knows, knows of, past, enemy | 2.2 |
| 3.2 | "In touch now", separate from "knows" | 3.1 |
| **Part 4 · One gate** | | |
| 4.1 | `reach(from, to, how)`: the single permission check, with reasons | 2, 3 |
| 4.2 | News, proposals, arcs, arrivals and ripples all ask it | 4.1 |
| 4.3 | Facts carry who they're about (docs/19 4.1, pulled forward) | — |
| **Part 5 · Off-page knowledge is hearsay** | | |
| 5.1 | A `heard` stance: the writer sees "has probably heard, off the page" | — |
| 5.2 | Hearsay becomes `knows` only when the page confirms it | 5.1 |
| 5.3 | News mode: auto · ask · off, like fates | — |
| **Part 6 · Measure it** | | |
| 6.1 | A season-6 golden world: 300 ticks, nothing implausible | Parts 2–4 |
| 6.2 | An invariant audit on every tick, into the inbox | 4.1 |

Suggested order: **1 → 4.3 → 2 → 3 → 4 → 5 → 6**. Part 1 is small and makes the next mistake cheap to see and undo. Part 4.3 retires the name-matching bug class on its own. Parts 2–4 are the real change.

---

## Part 1 · Undo and why

### 1.1 Undo on engine chips

Each engine row in *What changed* (`ChangeChips.svelte`) gets an undo. It removes the `sim` row and the `know`/`arc` rows it caused. `DELETE /chats/:id/trackers/events/:eid` already exists. What's missing is grouping: a news hop writes a `sim news` row and a `know` row in the same batch. Each `know` row should carry `cause: { hop: <sim event id> }` so undo takes both. Undoing a hop also undoes hops that came from it (Tara → Willow goes with Spike → Tara).

### 1.2 Why

Every engine op records the evidence the rules used, as short labelled clauses:

> tie: Halfrek's lore names Spike in history(…) · place: neither has one (assumed town) · chance 0.6 × 0.1 × 1 over 9 h

They're stored on the op (`args.why: string[]`) and shown under the chip on tap. They cost nothing to compute, because the rules already have each value in hand. "Assumed" is a flag, so the audit (6.2) can count guesses.

### 1.3 Not again

Undo offers two follow-ups:
- **"They don't talk"** writes a `no-contact` tie between the pair.
- **"Not in this story right now"** sets the person's status to `absent`.

Both go on the person sheet (Part 2), so the correction lasts (principle 3).

## Part 2 · The person sheet

### 2.1 Slots

Add character slots to the detail sheet (`lore/slots.ts`). They're chat-scoped story facts, which `lore_facts` already supports with branch and swipe handling:

| Slot | Values | Kind |
|---|---|---|
| `status` | alive · dead · undead · absent · captive · changed · unknown | state |
| `whereabouts` | a place path, or `far: <place>`, or unknown | state |
| `in story` | in the story's era and cast now · past only · not yet | state |
| `ties` | `<name>: <type>[, in touch]` | bond, list |

People without a lore entry (the Cast page, tracker-only people) store the same slots in `cast_profiles.data`. The roster reads the sheet first. The regexes in `roster.ts` (`readStanding`, `diedInLore`, `farNow`, `textTie`) are kept only as the fallback in 2.2, and their output is marked `assumed`.

### 2.2 Filled once

When a chat starts the world simulation, and when a person's lore text changes (by `textBasis` hash), one structured model call per batch of about 20 people reads their lore together with the story's era from the card. It returns the slots with a quoted source span for each value. For example: `{status: "absent", whereabouts: "far: Los Angeles", source: "last seen in Los Angeles in early 2001"}`.

The results are cached by hash. They're never re-guessed on a tick. With no model available, the current rules fill the sheet and mark every value `assumed`.

This is also where non-people drop out. The call says whether the entry is a person who could act in this story (Ruth: animal, can't act; "Faction": not a person; Kendra: dead before the story). That replaces the person heuristics in `lorePersonName` and the proposal filters.

### 2.3 On the World page

Each person card shows status, whereabouts and ties, each with its source ("from lore", "from the story #412", "you", "assumed"), and lets you edit them. Assumed values are shown dimmed, and the page lists "N people the engine is guessing about", which you can clear in one pass.

### 2.4 Kept current

The tracker's existing ops update the sheet in the chat (as story facts, on the branch they came from):
- `cast: X@left(→ place)` sets whereabouts.
- A death sets status.
- "Left for England" in a reply goes through the keep-up path that living lore already has.

## Part 3 · Ties are acquaintance, not mention

### 3.1 Typed ties

Replace the numeric `textTie` with typed ties from the sheet and from bonds:

| Type | Meaning | Carries news? |
|---|---|---|
| close, friend, colleague | they talk | yes |
| knows | they've met, not close | big news only, slowly |
| knows of | name only | no |
| past | they did know each other (Halfrek/Spike as Cecily/William) | no |
| enemy | they know each other | no, unless the fact is about the other |
| no-contact | you said so | never |

On-page bonds still count. Their axes map to a type (familiarity ≥ 2 is at least *knows*).

### 3.2 In touch now

A tie can be true but dormant. Drusilla and Spike know each other but aren't in touch. "In touch" is its own flag. It's set by the story (they spoke in the last N days on the page) or by the sheet. News needs *in touch*. The medium comes from both whereabouts: in person only when both are known to be in the same town. Otherwise it's phone or letter by tech level, and with an unknown place, nothing.

## Part 4 · One gate

### 4.1 `reach()`

A single function in `sim/reach.ts`:

```ts
reach(from: RActor, to: RActor, how: "news" | "meet" | "lead" | "arrive" | "ripple", fact?: Fact)
  → { ok: true; medium; chance; why: string[] } | { ok: false; why: string[] }
```

It is an allowlist. Each rule is a named clause that must pass: both able to act (status), a tie of the right type and in touch, a known place for in-person, the fact not about a lead, a secret's keepers, and no `no-contact` on either sheet. The `why` from 1.2 comes from here. Every engine feature's own guard list is deleted in favour of this one, so a new rule lands once and covers everything.

### 4.2 Every feature asks it

- `news.ts` asks for news.
- `storyteller.ts` asks for leads (`lead`: a proposal or arc needs a lead with status alive, in story now, and able to act) and cast.
- `crossings.ts` asks for arrivals. Giles "thinking of coming back" needs his whereabouts and in-story status.
- `ripples.ts` asks for ripples.

### 4.3 Facts know who they're about

docs/19 4.1, the part that matters here. When the tracker folds a `know`/`secret`/`thread` op, it resolves the names in the statement against the cast (the fold already resolves `subject`) and stores `about: string[]` (ids) on the `Fact`. `spreadNews` stops tokenising statements. "Gabriel's", "Buffy's" and "the Summers girl" are all settled once, with the cast in hand, and tested in the fold.

## Part 5 · Off-page knowledge is hearsay

### 5.1 A `heard` stance

The engine never writes `knows`. It writes `heard` (a new `KnowStatus`), with the route. The writer's KNOWLEDGE lane shows it as *"has probably heard, off the page (from Spike)"*, and the plan check (docs/19 2.1) treats it as maybe, never as certain. A wrong hop then costs a hedge in the prose, not a contradiction.

### 5.2 Confirmed by the page

`heard` becomes `knows` when a reply shows the person knowing it. The tracker already writes `know X` for that. It becomes `unaware` when a reply shows them not knowing. Hearsay that's never confirmed fades after a set time.

### 5.3 News mode

`world.news: auto | ask | off`, beside `fates`:
- **ask** puts each hop in the inbox (the `world` inbox kind exists) with its why.
- **auto** keeps today's behaviour, but as hearsay.

The default for a new chat is **ask** until you've accepted about 10 hops with no undo, then it offers to switch to auto.

## Part 6 · Measure it

### 6.1 A golden world

`server/test/golden/19-offpage-world.json`: a season-6 roster built from lore text like this chat's (Drusilla in LA, Halfrek via Anya, Oz gone, Kendra and Joyce dead, Ruth the cat, a "Faction:" entry). It runs 300 ticks with fixed dice and asserts the **never** list:
- No news to or from the dead, absent, far without a phone or letter, or past-only ties.
- No lead who isn't a person who can act.
- No fact about you or the main character leaves the page.

It also asserts that something does happen (Tara → Willow can), so "never act" doesn't pass.

### 6.2 An audit on every tick

After each tick, re-check every engine op with `reach()` against the sheet as it stands, and count the `assumed` clauses. Failures and heavy guessing go to the inbox as a `world` item: "The engine is guessing where 6 people are. Fill them in?" This catches a change in the sheet that makes an earlier hop wrong (you mark Oz absent after he heard something).

---

## Not in this plan

- Making the simulation more active. This plan only makes it right.
- Model-written news (who tells whom, in what words). The engine still decides with rules and dice. The model fills the sheet only.
- Exporting the sheet to other apps (per docs/15, no export).
