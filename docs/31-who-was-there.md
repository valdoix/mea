# Build plan: who was there (knowledge reaches only the people it could have)

**Written:** November 9, 2026 · **Base:** Mea `main` at 3f45ff8

In *Clawed Out Into October* (seq 916), lunch in the Winters kitchen: Gabriel, Buffy, Walter, Spike and Ruth. Walter compares Gabriel and Buffy to Tom Paris and B'elanna Torres. Four chips under the reply said:

> Willow learned: Walter compares Gabriel and Buffy to Tom Paris and B'elanna Torres
> Xander learned: … · Anya learned: … · Tara learned: …

None of them was there. The people who *were* there learned nothing from that line.

---

## 0. What went wrong

The tracker wrote one line:

```
know @Scoobies: Walter compares Gabriel and Buffy to Tom Paris and B'elanna Torres | he said it at the table · knows · true
```

| Layer | What it did | Why that was wrong |
|---|---|---|
| Prompt (`trackers/prompts.ts`) | Taught `know @Scoobies: …` as "the group itself", with no word about where its members are | The model used the group's name for "the people at the table". In this story the Scoobies are Willow, Xander, Anya and Tara, and none of them was at the table |
| Fold (`Folder.spread`) | Spread a faction's line over every current member | It never asked whether the reply reached them. That's on purpose: group lines often report offscreen learning ("at the mall — they saw Spike", "Riley's files"), and the tests rely on it |
| Checks | Nothing compares a `know` holder with the scene or the text | The leak landed silently |
| Chips | The Undo choices were "Just undo" (which would also take back what the table learned) and "isn't in the story now" | There was no "wasn't there" choice, so the fix needed the API |

Neither the reply nor your message before it names any Scoobie or the Scoobies. That's the signal the fold couldn't see, because it reads events, not text.

**How common:** this was the only `know @Group` line the tracker wrote in this story. There are 26 `know everyone:` lines, plus one `household` and one `everyone in scene`. Those resolve to whoever is `@spot`/`@peri`, which is right today (Gabriel, Buffy, Ruth, Walter, Spike). They would leak in the same way if presence went stale.

---

## Part 0: group lines reach the members the reply reached (shipped with this plan)

- **Data:** the bad event is deleted. The fact is filed for Gabriel, Buffy, Walter and Spike (`user` source, anchored to seq 916).
- **`groupReach(ops, state, cfg, text)`** (`trackers/fold.ts`) runs when a reply's lines are filed (`runTrackerUpdate` and `fileInlineLedger`). For each `know` line whose holder is a group, it lists the members the reply never reached in `args.away`. A member counts as reached if any of these is true:
  - they're `@spot`/`@peri`, or arrive in this reply's cast line;
  - they're named in the messages the tracker read;
  - the group itself is named in the messages (an offscreen report about them);
  - the route travels (a call, a text, a letter, the files, rumour, later);
  - their people are listed in brackets.
- **Fold:** `spread` skips the `away` members and says why on the line. A group fact (`g.facts`) is recorded only when every member heard it. The re-parse of model lines keeps `away`.
- **Prompt:** a group line reaches only the members in the scene unless its route reaches the rest, and people around a table who aren't one group are named one by one.
- **Tests:** `groups.test.ts` covers this lunch, a member walking in, a text, a reply that names them, and named people left untouched.

---

## Part 1: "wasn't there" on a knowledge chip

The fix for a wrong holder should be one click, and it shouldn't take back what everyone else learned.

- **1.1** A tracker knowledge chip carries its line (`lineId`), and gets a quiet **"{Name} wasn't there"** link (`NotThere.svelte`, in both the cast roll and the Folio margin). It adds the name to the line's `args.notThere` (`POST /trackers/events/:eid/not-there`) and refolds. The other holders keep the fact.
- **1.2** `notThere` applies to any `know` line: one person, a list, a group or `everyone`. With everyone off it, the line teaches nobody and says why. A group fact isn't recorded when someone was taken off.
- **1.3** Once you've named two people in a story, the tracker's prompt (and the inline ledger instruction) gets a CORRECTIONS line naming them. *Changed from the first draft:* a Lessons rule would go to the story model, which didn't make the mistake.

**Done when:** undoing Willow's chip leaves Buffy's, a refold keeps it, and the test covers both a group line and a list line.

## Part 2: named people who weren't there

`know Willow: … | he said it at the table` is the same mistake without a group. Naming someone is stronger evidence than a group word, so this part flags instead of dropping.

- **2.1** `groupReach` → `reach`. It checks every holder of a model `know` line the same way. An unreached, explicitly named holder gets `args.unsure: [names]` instead of `away`.
- **2.2** The fold files the stance, but the chip shows a muted **"not in the scene?"** tag with Keep / "wasn't there" (Part 1). Keep (`POST /trackers/events/:eid/heard`) takes them off the line's `unsure`, so a refold won't ask again. The stance isn't made `set`, so the tracker can still change it later.
- **2.3** The same reach rule applies to the other scene-bound spread ops, `mood` and `bond`. "mood Scoobies: worried" when none of them is there is a mood for nobody. `owe`, `promise` and `lives` aren't about being there and stay as they are.

**Done when:** a seeded reply with `know Xander: …` and Xander absent and unnamed shows the tag, and both answers stick through a refold.

## Part 3: "everyone" against a stale scene

`everyone` is only as good as presence. Someone who left without a cast line stays `@spot` and keeps learning things.

- **3.1** Quiet presence (`trackers/stillhere.ts`): someone `@spot`/`@peri` whom the messages haven't named in the last 6 replies (the replies and the messages between them) is *quiet*, unless you said they're here since (a cast line of yours). This reads the text, not `lastSeq`, because the tracker keeps writing think lines for whoever the state says is here. `everyone` doesn't reach a quiet person unless the current reply names them (`groupReach` puts them in `away`).
- **3.2** The Cast tab gets a **"Still in the scene?"** notice (Here / Gone) for anyone quiet for 10 replies, with how long it's been. Here writes `cast: Xander@spot` and Gone writes `cast: Xander@left`, as your lines.
- **3.3** The tracker's state block (and the inline ledger's) marks quiet people with `(quiet)`, with a line asking it to write them `@left` if they've gone rather than keep them by habit.

**Done when:** a fixture where Willow leaves without a cast line stops getting `everyone` facts after 6 replies, and the notice asks about her after 10.

## Part 4: sweep what's already filed

The new rule only applies to new replies. Older ones can carry the same leak.

- **4.1** `trackers/sweep.ts` folds the story once and checks each older `model`/`inline` know, mood and bond line the way a new one is checked. It uses the state just before the line, its reply's text and cast lines, and who was quiet then. `scripts/reach-sweep.ts [story] [--db …] [--all] [--json …]` runs it read-only on a `VACUUM INTO` copy with the connections taken out. It's its own script because `replay.ts` rebuilds one reply's prompts, which is a different job.
- **4.2** The Cast tab lists the findings, loaded after the tab: **"N older lines reached people who weren't there"**, with **Fix all**, and **Fix** or **Leave** on each line. A fix writes `away`/`unsure` onto the line, marked `swept`, and the toast's Undo takes exactly that back. Leave marks the line `sweepOk`. The result is cached until an answer lands on a line. New lines are checked as they're filed, so a new reply can't add findings.

**Done (November 9, 2026):** on a copy of the production database, the sweep takes 2.0 s for *Clawed Out Into October* (1.8 s for a plain fold) and 0.3 s for *The Word in Her Throat*. Those are the only two stories with tracker lines. Every candidate it raised was checked by hand. That was 4 candidates, not the planned 10, because there weren't more to find:
- **#742 (Clawed):** `know Spike: the daisy mug is his`. Spike isn't named in that reply or the one before, and Buffy is setting a place for "the guest", so asking "not in the scene?" is right.
- **#79, #97, #107 (Word in Her Throat): false positives, now fixed.** In #97 and #107, the reply's own cast line put all 18 people in the cabin. In #79, Natalie is leaving in that reply (`@left`) and is called "Nat". So anyone named in a reply's own cast lines, at any tier, now counts as reached, for new lines too. The sweep now reports only #742.

## Part 5: keep it fixed

- **5.1** Golden scenario `29-who-was-there` (this lunch, with no Scoobie at the table). Its `after` lines are now filed the way a reply's are (`reachForReply`, shared with inline ledgers), so the scenario checks the filing pipeline. The table learns the line, no Scoobie does, and a text reaches them all. With the reach check turned off it fails on exactly the four leaked stances. It runs free on the mock provider in `bun run golden` and CI. *Changed from the first draft:* golden scripts its tracker lines, so it tests Mea's filing, not a tracker model. How each model behaves is 5.2's job.
- **5.2** Story health gets an **Off-scene knowledge** part (`offScene` in `accuracy/health.ts`). It counts the people kept off tracker lines over the health window (not reached, asked about, or taken off by you) and breaks them down per 100 replies by the model that wrote the lines (the tracker model, or the story model for inline ledgers). A tracker model that keeps doing it shows up there.

---

## Order and size

| Part | Size | Needs |
|---|---|---|
| 0 | done | (none) |
| 1 | small, server and web | 0 |
| 2 | medium | 0, 1 for the chip actions |
| 3 | medium | (none) |
| 4 | small script and one notice | 1 |
| 5 | small | 0 (free: golden runs on the mock provider) |
