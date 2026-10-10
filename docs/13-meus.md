# Meus

Meus is Mea's one assistant: the co-writer in both studios (it was called Mea there) and, now, a story companion in every chat. In a chat it talks with you out of character, answers from the story with sources, brainstorms, and fixes things for you. Nothing it says goes into the roleplay, and it never changes the story until you tick and apply a change. Every applied set can be undone.

The design that was reviewed and approved is in the project files (`meus/meus-design.md`).

## Where it is

- **The side panel's Meus tab.** It took the Ask tab's place (a remembered "Ask" opens Meus). Past Archivist answers become the start of Meus's history in that chat.
- **Shortcuts:**
  - select text in a message → **Ask Meus** ("About this (in #42): …");
  - a message's menu → **Fix with Meus** ("Something's wrong in #42: ");
  - `/meus <message>` in the composer sends it straight to Meus (`/meus` alone opens it).
- **Settings → Models:** Meus has its own route ("Meus"); unset, it uses the memory summaries' profile. The Studio co-writer uses it too.

## What it reads

**Always (the brief, `meus/brief.ts`):**

- Who is who: your persona is the player's own character, the card is the character the AI plays (or a narrator), everyone else is cast. Every person is listed with their id.
- The story state as ledger lines, the story settings, truths, OOC notes and the next-reply cue.
- The running summary, the last 12 messages with their numbers, and counts of everything else (with likely Codex duplicates).
- The Archivist's numbered sources for your message, so answers can cite them.

**On request (`meus/lookups.ts`), up to three rounds:** `search:` (deep search of the messages), `recall:`, `person:`, `records:` (any part of Story → Data, with ids), `timeline: clock`, `message: 42`, `codex:` (one page, or `all`), `memories:`. What it read shows under the answer.

## What it can change (`meus/changes.ts`)

| Change | Through |
|---|---|
| Story records: clock, weather, place, people, bonds, facts, things, threads, promises, deadlines, custom trackers; rename, `edit` by path, lock | ledger lines, folded as a dry run first (`dryRunOps`); a correction can be anchored at an earlier message (`userEditAt`), and the clock may go backwards |
| Merge two cast entries | the `merge` line, the cast profiles, and the Codex pages together |
| Codex: edit (name, kind, aliases, description, status, facts), add, merge, unmerge, delete | `updateEntity`, `createEntity`, `mergeEntities`, `unmergeEntity`, `deleteEntity` |
| Memory: correct, add (pinned or not), pin, forget | `correctMemory`, `createAtom`, `updateAtom`, `deleteAtom` |
| A past message | `editMessage` (the old text is kept in the edit history) |
| The next reply's cue, a standing OOC note, a story truth, a time skip | chat settings, `timeskip` |

- **Checked before you see it.** Lines that wouldn't apply, names that aren't in the cast, and ids that don't exist are left out, and Meus says why. A line that would add someone new to the cast says so on the card (it's often a misspelt name).
- **Careful by default.** Forgetting a memory, deleting a Codex page and editing a message are marked on the card and start unticked.
- **Undo** (`undoStep`) reverses a set, last change first. Ledger events are deleted, profiles and Codex rows are restored, a merge is unmerged, memories are restored or removed, a message gets its old text back, and settings their old values.

**What it won't change:** the character card and the persona card (it points you to Meus in the Studio), other chats, and app settings.

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

## Not built yet

These are from the approved design:

- the world off the page (arcs, fates, people);
- lorebook entries and notebook notes;
- the continuity inbox;
- "Ask Meus" from Cast → Duplicates and the command palette;
- splitting one person into two;
- the "apply small fixes right away" switch;
- handing a card change straight to the Studio;
- wiki lookups in chats.

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
- the Archivist history.
