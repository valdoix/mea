# Meus

Meus is Mea's one assistant: the co-writer in both studios (it was called Mea there) and, now, a story companion in every chat. In a chat it talks with you out of character, answers from the story with sources, brainstorms, and fixes things for you. Nothing it says goes into the roleplay, and it never changes the story until you tick and apply a change. Every applied set can be undone.

The design that was reviewed and approved is in the project files (`meus/meus-design.md`).

## Where it is

- **The side panel's Meus tab.** It took the Ask tab's place (a remembered "Ask" opens Meus). Past Archivist answers become the start of Meus's history in that chat.
- **Shortcuts:**
  - select text in a message → **Ask Meus** ("About this (in #42): …");
  - a message's menu → **Fix with Meus** ("Something's wrong in #42: ");
  - `/meus <message>` in the composer sends it straight to Meus (`/meus` alone opens it);
  - Story → Cast, a person's Duplicates → **Ask Meus to sort these out**;
  - the Codex's "Maybe the same" list → **Ask Meus to sort these out**;
  - a note in the continuity inbox → **Talk it through with Meus** (opens its chat);
  - the command palette, in a chat → **Meus…**, or **Ask Meus: <what you typed>**.
- **Settings → Models:** Meus has its own route ("Meus"); unset, it uses the memory summaries' profile. The Studio co-writer uses it too.

## What it reads

**Always (the brief, `meus/brief.ts`):**

- Who is who: your persona is the player's own character, the card is the character the AI plays (or a narrator), everyone else is cast. Every person is listed with their id.
- The story state as ledger lines, the story settings, truths, OOC notes and the next-reply cue.
- The running summary, the last 12 messages with their numbers, and counts of everything else (with likely Codex duplicates).
- The Archivist's numbered sources for your message, so answers can cite them.

**On request (`meus/lookups.ts`), up to three rounds:** `search:` (deep search of the messages), `recall:`, `person:`, `records:` (any part of Story → Data, with ids), `timeline: clock`, `message: 42`, `codex:` (one page, or `all`), `memories:`, `summaries:`, `journal:`, `world: all` (subplots, proposals, fates, people off the page), `lore:` (the lorebooks this chat uses), `inbox: all`, `checks: all` (what the continuity checker and scene reconcile already flagged, for "What's inconsistent right now?") and `wiki:` (the fandom wiki the Studio researched for this card, else Wikipedia). What it read shows under the answer.

The brief also lists the guidance chips (and which are on), the author's note, and counts for the world, lore and journals.

## What it can change (`meus/changes.ts`)

| Change | Through |
|---|---|
| Story records: clock, weather, place, people, bonds, facts, things, threads, promises, deadlines, custom trackers; rename, `edit` by path, lock | ledger lines, folded as a dry run first (`dryRunOps`); a correction can be anchored at an earlier message (`userEditAt`), and the clock may go backwards |
| Merge two cast entries | the `merge` line, the cast profiles, and the Codex pages together |
| Codex: edit (name, kind, aliases, description, status, facts), add, merge, unmerge, delete | `updateEntity`, `createEntity`, `mergeEntities`, `unmergeEntity`, `deleteEntity` |
| Split one cast entry that is really two people | ledger `edit` of the first one's aliases, a `cast:` line for the second, their own lines; a Codex page merged under that name stands on its own again |
| Memory: correct, add (pinned or not), pin, forget, merge, split | `correctMemory`, `createAtom`, `updateAtom`, `deleteAtom`, `mergeAtoms`, `splitAtom` |
| A scene or chapter summary, a character's journal | `editSummary`, `editJournal` |
| A past message; hide it from the story; end a scene after it; start a chapter at it | `editMessage` (the old text is kept in the edit history), `setMessageFlags`, `endSceneAfter`, `newChapterAt` |
| The next reply's cue, a standing OOC note, a story truth, a time skip | chat settings, `timeskip` |
| Length, pacing, guidance chips (on, off, next reply only), the author's note, story settings | chat settings |
| The world off the page: hold, resume, nudge, bring in, drop or rewrite a subplot; start one; accept or turn down a proposal; accept, soften or keep a fate for the page; where someone is | `arcAction`, `authorArc`, `decideProposal`, `decideFate`, `setActor` (they now return their event ids) |
| A lorebook entry this chat uses: edit or add | `updateEntry`, `createEntry` |
| Since the card: how the character or persona has changed in this chat (add, edit, retire a line) | `addSinceLine`, `updateFact`, `retireFact` (`lore/sincecard.ts`) |
| A note in your notebook | `createNote` |
| A continuity inbox note: accept (with an edit) or reject | `actOnInbox` (a world proposal goes through `decideProposal`) |

- **Checked before you see it.** Lines that wouldn't apply, names that aren't in the cast, and ids that don't exist are left out, and Meus says why. A line that would add someone new to the cast says so on the card (it's often a misspelt name).
- **Careful by default.** Forgetting a memory, deleting a Codex page, editing a message and accepting a fate are marked on the card and start unticked. Ending a scene, starting a chapter and accepting a chronicle or similar inbox note can't be undone from Meus; the card says so and they start unticked too.
- **"Apply small fixes right away"** (the switch under the panel, per chat, off by default): a reply whose changes are all story-record or clock lines, with no warning on them, applies without the card. The toast and the conversation still offer Undo.
- **The cards themselves** go to the Studio: when you ask to change the character card or the persona card, Meus says so and its reply has **Open … in the Studio**, which opens the card in the Creator Studio with your request typed into Meus there.
- **Undo** (`undoStep`) reverses a set, last change first. Ledger and world events are deleted, profiles, Codex rows, summaries, journals and lore entries are restored, a merge is unmerged, memories are restored or removed (a memory merge stands both again), a message gets its old text back or is shown again, notes are removed, and settings get their old values.

**What it won't change:** the character card and the persona card (it hands them to Meus in the Studio; how they've changed in *this* story goes on the chat's Since the card note instead), other chats, and app settings.

If the story is rewound below what Meus last read, the panel says so under the header: earlier answers may not hold.

**Why a message is edited in place, not as a new swipe:** a new swipe of a past message would drop the story-state records the trackers read from the old one. An edit keeps them, keeps the old text in the edit history, and memory and the trackers re-read the message.

## Storage and routes

- One `meus` row per chat (migration 13): `turns`, the waiting `proposal`, and the last 20 applied `sets` with their undo steps. It is never read by the prompt, memory or the trackers.
- `GET /chats/:id/meus`
- `POST /chats/:id/meus` `{message}`
- `POST /chats/:id/meus/apply` `{accept}`
- `POST /chats/:id/meus/dismiss`
- `POST /chats/:id/meus/undo/:setId`
- `DELETE /chats/:id/meus`

The Archivist's routes are unchanged.

## The shared core

`assistant/core.ts` holds what the studios and the chat share: the conversation, proposals, the lookup rounds (`withLookups`, now with several rounds) and the voice. `creator/smarts.ts` re-exports it for the studios.

## Tests

`meus.test.ts` covers:

- who is who in the brief;
- a lookup round;
- the full merge and its undo;
- a clock correction anchored at an earlier message;
- dry-run drops;
- a message fix and its undo;
- Codex edits and their undo;
- memories and the cue;
- that Meus never reaches the prompt;
- the Archivist history;
- splitting a person and joining them again;
- steering, notes and hiding a message, each undone;
- lore entries added, looked up and taken back;
- memory merges and splits, undone;
- a subplot off the page started and undone;
- the checks, inbox and world lookups;
- the hand-off to the Studio;
- small fixes applied right away, with Undo.
