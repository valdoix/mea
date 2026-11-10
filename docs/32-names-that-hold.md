# Build plan: names that hold (nobody joins the cast by a slip)

**Written:** November 10, 2026 · **Base:** Mea `main` at a8bfbb1

In *Clawed Out Into October* the cast has a "Gabriel Summers". Nobody by that name is in the story. Your character is Gabriel Winters; Buffy's surname is Summers. The phantom had his own Codex page, his own arousal meter, a bond from Buffy, and twice the world simulation proposed a subplot for him ("Gabriel Summers has their own stake in Joyce's bus card").

---

## 0. What went wrong

The tracker model (GLM 5.2, then 5.3) wrote your first name with Buffy's surname:

```
know Gabriel Summers: same · handed it · true          (#858)
body Gabriel Summers: arousal 4                        (#866)
bond Buffy Summers>Gabriel Summers: — cause            (#918)
```

The story itself never says "Gabriel Summers": no message or swipe contains it. It exists only in ledger lines.

| Layer | What it did | Why that was wrong |
|---|---|---|
| Tracker model | Blended the two names it writes most ("Buffy Summers" 1,221 lines, "Gabriel Winters" 533) | A slip. 6 of this story's 802 tracker replies have it (first on October 22), usually one line beside correct ones in the same reply |
| Prompt (`trackers/prompts.ts`) | "use the names the story uses" | Nothing says a listed person keeps their exact name |
| Fold (`Folder.findChar`) | Matches a full name, an alias, a lone first or last name, or a one-letter typo. Anything else is a new person | "Gabriel Summers" is none of those, so `ensureChar` made someone. No line needs a cast introduction, and nothing asks whether the story ever used the name |
| Codex (`memory/entities.ts` `syncEntities`) | Made a page for the new cast member | It never takes a page back when the cast stops having that person |
| Everything downstream | Trusted the cast | The name went into 30 story prompts, 13 continuity checks, 5 speaker checks and the world simulation, which proposed two subplots for him (both ended up declined) |
| Checks | `accuracy/names.ts` looks for one-letter typos in a reply's prose | Ledger lines aren't checked, and a blend isn't a typo: both words are real names |

So the root cause has two halves. The model slips now and then, and it will again. The fold then treats any unknown name as a new person, with no check on it.

---

## Part 0: a blended name is the person whose first name it is (shipped with this plan)

- **Fold:** `Folder.blendOf(name)` (`trackers/fold.ts`), the last step of `findChar`. A two-word name nobody has, whose first name belongs to exactly one person with a full name and whose surname belongs to someone else, resolves to the first of them. A married name ("Buffy Winters") resolves the same way. It doesn't apply when two people share the first name, when the surname is nobody's ("Gabriel Reyes" is a new person), or when you said the name is a person (`castTidy.people`).
- **The line says so:** `nobody is called Gabriel Summers: read as Gabriel Winters`, as a warning on the line's verdict. Subject, object and cast lines are covered.
- **Prompt:** "Someone the state already lists keeps that exact name: never pair one person's first name with another's surname."
- **Tests:** `server/test/blendednames.test.ts`: this story's three lines, a married name, new relatives and new first names, a shared first name, a name you added.
- **Checked on a copy of the real data:** the story folds to 28 people instead of 29, the three lines land on Gabriel Winters, and the other story has no line read differently.
- **Not covered:** the Codex page for "Gabriel Summers" stays until Part 3, or until it's merged into Gabriel Winters from its Codex page. The cast is right as soon as production restarts on this code, since the fold is recomputed.

---

## Part 1: a new person needs the story to have named them

Part 0 handles one shape of slip. The general rule is that a person exists because the story named them, and a ledger line alone isn't enough.

*Changed from the first draft:* the fold asks the story itself, instead of a flag put on each line when it's filed. Old lines are covered with no sweep and no stored change, and a refold gives the same answer every time.

- **1.1** `FoldConfig.inStory(phrase, seq)` (`trackers/store.ts`): whether the story has these words by that message. It looks in the messages up to it (every swipe, full-text search), the card, the persona and the story's lore.
- **1.2** `Folder.person` (`trackers/fold.ts`), before it makes anyone: a name the tracker wrote counts as named when the story has it whole, or has a word of it that's nobody else's and isn't a title ("Hank" of Hank Summers, but not "Coach" of Coach Ramirez). A name that isn't named is read as the one person whose first name it starts with, or the one person it's a letter or two from ("Guth" for Ruth); failing that, nobody is added. The line says which: `the story never says Shannon: nobody was added`.
- **1.3** Not asked of: descriptions ("the bartender", "Woman in brown cardigan"), your own lines, the opening's lines, the engine's, and names you said are people.
- **1.4** Under the test runner the check is off unless a test turns it on (`setStoryNames`), because most fixtures file lines about people their few messages never name. The golden scenarios run with it on; their opening ledger is now filed as the opening's (`init`).

**Seen on a copy of the real data:** besides "Gabriel Summers", the cast loses "Shannon", a clerk the tracker named in four lines at #169–#171 whom no message names. Lines for "Guth", "Gupert Giles" and "Guffy audit" (the model's misspellings; none had made a person) now say why they went nowhere. Folding the long story takes 1.9 s, as before.

**Done when:** a ledger line naming someone the story never mentions makes no cast member, in a test and in this story's refold; a walk-on the reply names still appears on the first line. *(Both hold.)*

## Part 2: the tracker sees the names it must use

- **2.1** `stateForModel` lists who is here and the last eight away. Add one NAMES line with every living person's exact name (capped by tokens, most recent first), so the model copies instead of recalling.
- **2.2** The same line goes to the helpers that write names into records: `world:wording`, `world:heed`, `speakers`, the continuity check, the inline ledger instruction.
- **2.3** `world:wording` wrote "sits between Gabriel Summers and Buffy's quiet question" because the proposal's `leadName` said so. The sim takes `leadName` from the cast at read time (by `lead` id), not from the stored proposal, so a later merge or rename shows the right name.

**Done when:** the prompt of a tracker call in this story lists "Gabriel Winters" under NAMES, and a merged person's open subplot reads with the kept name.

## Part 3: the Codex follows the cast

Today a Codex page made from the cast outlives the cast member. This story has 92 live person pages; 14 carry a note in brackets ("Dawn Summers (on phone)"), 10 are lists ("Buffy Summers & Gabriel Winters").

- **3.1** `syncEntities` (`memory/entities.ts`): a person's page that nothing stands behind any more is put away. That means a page known only from the cast or the scene records, never edited by you, and absent from both now. It's merged into the page of whoever the fold reads its name as (Unmerge in the Codex brings it back), or hidden when it's read as nobody. A hidden page returns by itself if the story comes to have the person. The wrong name doesn't become an alias of the right person.
- **3.2** `sceneNames`: a scene record's people go in as names. A note in brackets is dropped ("Dawn Summers (on phone)"), a list is its people ("Buffy Summers & Gabriel Winters"), and a group's label before a list isn't one of them ("Dawn's friends: Melissa, Kara, Jamie").
- **3.3** *Changed from the first draft:* there's no separate cleanup pass. The first sync after the update does it, and every step can be undone.
- **Left alone:** pages you edited, pages a memory names, your character's and the main character's, places and things, and a scene's plain name that's missing only because its scene is being rewritten.

**Seen on a copy of the real data:** *Clawed Out Into October* goes from 92 person pages to 58: 16 merged (the ten "(on phone)"-style pages, "Gabriel Summers" into Gabriel Winters) and 22 hidden (lists, "traits", "household", "cash only", and four canon people the cast doesn't have: Halfrek, Jenny Calendar, Kendra Young, Oz). *The Word in Her Throat* goes from 30 to 26.

**Done when:** this story has no "Gabriel Summers" page and no cast-made person page with brackets or a list in its name, and pages you edited are untouched. *(Holds on the copy; one bracketed page a memory names stays, by the rule above.)*

## Part 4: one click when Mea read a name wrong

- **4.1** The tidy notice (docs/30 0.6) gains a row per re-read name: "Gabriel Summers · read as Gabriel Winters · 3 lines", with **Right** and **No, a new person** (adds the name to `castTidy.people`, which Part 0 already respects).
- **4.2** The row's **Right** also merges any Codex page under the wrong name (the cast's own merge in Story and World already exists).
- **4.3** Story health: a row "Names read as someone else" (count of re-read names not yet confirmed) beside "Not people".

**Done when:** confirming and overturning a re-read both survive a refold.

## Part 5: measure it

- **5.1** A golden scenario with blended, misspelt and never-named people in the mock tracker's lines; the cast must come out exact.
- **5.2** A script over every story listing people made in the last 30 days whose name the story's text never has. It should print nothing.

---

## Order

0 (done) → 1 → 3 → 2 → 4 → 5. Part 1 closes the class; Part 3 removes what's already there; 2 lowers how often the slip happens; 4 and 5 are for when the first three miss.

## Not doing

- Requiring a cast line before any person exists. Walk-ons often get a `mood` or `think` line first, and the text check in Part 1 covers the same risk.
- Correcting the stored ledger lines. They stay as written; the fold reads them right, and the warning shows what was read.
- Asking the model to confirm names in a second call.
