# Design plan: search by meaning (what vectors can still do for recall)

**Written:** November 5, 2026 · **Base:** `origin/main` at d752319, which includes the recall rebalance (#255) · **Status:** Parts 1 to 4 done (see their results); Part 5 waits on a point-of-view answer

Mea already searches by meaning. Memories, summaries and song passages have vectors, recall fuses them with keywords, and the eval from docs/26 Part 4 can score any change. This plan covers what's left. The biggest gain looks like a small fix: recall often finds the right memory and then fails to use it.

---

## 0. What was measured

Run with `scripts/recall-eval.ts` over its 39 cases from *Filed Under Forever*, on a copy of the database from November 4 with no connections. Query vectors came from the eval's cache, so nothing was spent. The variants were throwaway patches. The eval runs without the librarian or a draft.

| Variant | Writer, of 39 | Planner, of 39 | "Meaning" cases, writer / planner (of 19) |
|---|---|---|---|
| **As shipped** | **32** | **28** | 15 / 13 |
| Vectors off | 29 | 23 | 13 / 9 |
| Keyword search off | 29 | 27 | 15 / 13 |
| Similarity floor at 0.3 or 0.4, not 0.2 | 32 | 28 | 15 / 13 |
| Vector rank scaled by similarity (4 tunings) | 30–31 | 29 | 14–15 / 14 |
| Diversity off | 31 | 29 | 15 / 14 |
| Closest 2 memories always get in | 32 | 30 | 16 / 15 |
| Closest 3 | 32 | 31 | 16 / 16 |
| **Closest 5** | **35** | **34** | **18 / 18** |

Each case is worth 2.6%, so a change of one or two cases is noise.

### What this shows

1. **Vectors earn their place,** mostly for the planner and for cases with no shared words.
2. **Recall loses matches it has already found.** Six turns missed a "meaning" case. In five of them a wanted memory was among the 5 closest to the newest message, and in the sixth it was 12th. (Measured with mood left out, so these ranks are close, not exact.) The likely cause is fusion: a memory that is fairly close to four queries can outscore one that is very close to the newest message alone.
3. **Similarity scores don't sharpen ranking here.** A story's memories all sound alike, so the band is narrow: per query, the median memory scores 0.43, the 10th best 0.59 and the best 0.65. Scaling by score did no better than rank alone, and the 0.2 floor filters almost nothing, since even the median memory clears it comfortably.
4. **Deep search's "weak recall" trigger never fires.** It needs a top score under 0.03, and the lowest seen was 0.415. It was false on all 78 recalls (39 turns, two readers). Deep search ran only on cue words, on 2 of the 78.
5. **Speed isn't a problem.** Scanning one query takes about 2 ms, or roughly 8 ms for a turn's four queries. The largest chat has about 2,000 vectors.

### How far to trust this

**The "meaning" cases may be circular.** Docs/26 doesn't record how they were found. If they came from looking at vector neighbours, a slot for the closest matches would pass them by construction. Part 1 exists to settle this before anything ships. The eval also counts hits, so it can't see what a new slot pushes out or how the prose reads.

---

## Parts at a glance

| Step | What it adds | Needs |
|---|---|---|
| **Part 1 · A fairer test** | | |
| 1.1 | Cases found without vectors, from two chats | Small spend |
| 1.2 | Quote cases, and a report of what gets displaced | — |
| **Part 2 · The closest matches get in** | | |
| 2.1 | A reserved slot in recall | 1.1 |
| 2.2 | Guards: short messages and unused memories | 2.1 |
| **Part 3 · Knowing when to reach back** | | |
| 3.1 | A "weak recall" test that can actually fail | 1.2 |
| **Part 4 · Better vectors** | | |
| 4.1 | Memories embedded with who and where | 1.1, small spend |
| 4.2 | Long messages split into several queries (test only) | 1.1, small spend |
| **Part 5 · Old messages by meaning** | | |
| 5.1 | Passage vectors, used by deep search | 1.2, 3.1, a point-of-view answer, spend |

**Order:** 1 → 2 → 3 → 4 → 5. Part 5 is built only if Part 1's quote cases show it's needed.

---

## Part 1 · A fairer test

**1.1 Independent cases.** At least 20 new cases, each with a `found` field saying how it was found. Sources: callbacks spotted by reading the player's messages, slips from the checker and Story health, and a second chat (*The Word in Her Throat*). None may come from vector neighbours or shared-word search. The eval reports independent and earlier cases separately. Cases stay in `data/evals/`, since the repo is public.

**1.2 Better reporting.**
- `expect` can name a message as well as a memory, for details no memory holds. This lets deep search be scored at all.
- Vectors-off becomes a standard variant, so their value stays visible.
- For any variant, list what it added and what it pushed out, to be read by hand.

*Done when:* both chats print a baseline, and the independent cases are scored as shipped.

*Spend:* query vectors only, about 300 tokens a case.

### Part 1 results (November 5)

**Built:** `scripts/recall-eval.ts` takes `msg:<seq>` in `expect`, scores cases with a `found` field apart from the earlier ones, always runs "vectors off" after "as it stands", and with `--displaced` lists what each variant added to the writer's block and pushed out. It now sets up the point of view, entity cards and the scene's place the way `memoryInputs` does; the earlier totals didn't move (32 and 28), though two earlier cases traded places between "words" and "meaning".

**Cases:** 37 new ones. 31 in *Filed Under Forever*: 29 callbacks found by reading all 364 of the player's messages for references to something already outside the window, and 2 slips the checker flagged (not dismissed) that cite a memory outside it. 6 in *The Word in Her Throat*, all callbacks. For each, the memory was picked by reading the scene where the detail was first told. One (#513) is set aside because its memory was still in the window. One is a quote case (#147: Ruth's colour, said once in #15 and never filed). Embedding their queries took about 15,000 tokens.

| Set | Writer, as shipped | Writer, vectors off | Planner, as shipped | Planner, vectors off |
|---|---|---|---|---|
| Earlier (docs/26), of 39 | 32 | 29 | 28 | 22 |
| **Independent, of 30** | **21** | **16** | **15** | **13** |
| *The Word in Her Throat*, of 6 | 5 | 5 | 5 | 5 |

Vectors are worth five independent cases to the writer and two to the planner, so their value isn't an artifact of how the earlier cases were found. The second chat is short (the window first moved at #49) and its six cases are too few to rank variants on; it is there to catch a change that only suits one story. Neither quote case nor the slip about the faucet hits in any variant.

**Found along the way:** in the second chat, memories known by "the group" or "all survivors" never reach Jackie, because the point-of-view filter only treats words like "everyone" as public. The case for #71 (the missing teammates) was dropped for that reason. It belongs to the witness work, not this plan.

---

## Part 2 · The closest matches get in

**2.1 The slot.** In `recall()`, straight after the named records, take the N memories closest to the strongest query (your draft, or the newest message). They share a cap of 15% of the remaining budget and carry the reason "closest in meaning". Candidates have already passed the point-of-view filter and aren't in the window. The prototype's N of 5 is the starting point.

Summaries stay out of the slot: one costs as much as several memories, and #255 has only just capped them.

**2.2 Guards.**
- A short message ("OK.") has no real nearest neighbour, so skip the slot below a minimum of content words.
- A memory that is "recalled often, never used" (`reinforcement()`) skips the slot, or it could return every turn past the penalty that normally fades it.

*Done when:* the independent cases rise, the named and shared-word cases don't fall, and the displaced list reads as a fair trade. Then a few live replies are compared, since the prose can only be judged there.

*If the independent cases don't rise,* the gain was circular. Drop the slot and record that here.

### Part 2 results (November 5)

**Built:** in `recall()`, straight after the named records, the 5 memories closest to the strongest query take up to 15% of what's left, with the reason "closest in meaning 0.62 (newest message)". Both guards are in: no slot when the strongest query has fewer than 3 content words, and no slot for a memory "recalled often, never used". Neither chat has a message that short; 104 of 1,746 memories in *Filed Under Forever* are never-used ones.

Serendipity now draws one number per memory (from the turn's seed and the memory's id) instead of taking numbers in turn. Before, any change in what other slots chose reshuffled every serendipity pick, which buried real displacement in noise: the displaced list for this slot shrank from about 2,700 lines to a readable few per turn. The baseline below is after that change (it cost the writer one earlier and two independent hits, by chance).

| Variant | Writer: earlier / independent | Planner: earlier / independent | Named, writer / planner |
|---|---|---|---|
| No slot | 32 / 19 | 28 / 15 | 5 / 3 |
| Closest 3 | 34 / 20 | 32 / 16 | 5 / 3 |
| **Closest 5 (shipped)** | **34 / 20** | **33 / 18** | **4 / 4** |
| Closest 8 | 35 / 21 | 33 / 19 | 4 / 4 |
| Vectors off | 28 / 15 | 22 / 13 | 4 / 3 |

*The Word in Her Throat* stays at 5 of 6 in every variant.

**Reading it:** the independent cases rise, by 1 for the writer and 3 for the planner, so the gain isn't only circular, but the earlier set gains more (2 and 5), which suggests some of it was. The planner, with the smaller budget, gains most, as expected: its fused list has the least room. The writer's one lost named case is #221 ("Gabe-o"): the slot took the kitchen and food memories closest to a mac-and-cheese scene and the 15% it used squeezed the memory naming the nickname out of the relevant slot. The planner gained a named case, so named cases don't fall overall.

**What it displaces** (`--displaced`, read by hand for about twenty turns): what goes in is on topic (Joyce dying in February when Gabriel asks about her family; the back pay when he says "millionaire"; the cheese waffles when he makes them again). What goes out is mostly recent-slot trivia (a breakfast plate on the counter, Ruth's water bowl), serendipity, and relevant-slot items that matched loosely. One trade at #717 pushed out a wrong memory ("Gabriel pulled Buffy out of her grave"). It reads as a fair trade.

**Not done:** comparing a few live replies. That needs the production server restarted onto this code and real generations, so it's left for the user.

---

## Part 3 · Knowing when to reach back

**3.1** Replace `relevant[0].score < 0.03` ([recall.ts](../server/src/memory/recall.ts)) with a test that can fail: no name or rare-word hit, and a best similarity low for this chat. A fixed number won't carry between stories, so measure against the chat's own distribution, and fall back to today's cue words when there's no query vector.

Quotes use only budget the other slots leave, so a trigger firing more often costs little, but it does add database searches to the turn.

*Done when:* it fires on a chosen share of turns (start at most 1 in 5), and the quote cases improve.

### Part 3 results (November 5)

**Built:** recall measures how far the best memory stands above the rest for the strongest query, in standard deviations of that query's scores over this chat's memories ("standout"). Recall is weak when no name brought back a record, no memory shares 4 or more rare words with the newest lines, and the standout is under 2.6. Weak recall reaches back once the story is 200 messages past the window, as before; cue words reach back whatever the scores say, and are all that's left with no query vector. Both the standout and what made recall reach back are in the recall stats.

**Two things the plan didn't expect:**
- *"No name or rare-word hit" never happens.* Every one of the 69 turns had either a name that brought back a record (30) or a memory sharing at least 2 rare words (all of them): in a 400-character message, two or three rare words in common happen by chance. So the test counts strength (4+ rare words), not presence.
- *Deep search's quotes never land.* Quotes use only what the other slots leave, and on these turns they leave nothing. With the new test, deep search reaches back on 11 of 69 turns (3 by cue words, 8 by weak recall, about 1 in 8), and adds a quote on none of them. The 5 turns that do carry a quote get it from the named records ("the first mention of ..."). Since a search with no room can't add anything, recall now skips it, which changes no output.

The standout over these turns: 10th percentile 2.14 sd, median 2.54. In the second chat, 2.00 and 2.11, but its window has only just moved, so it never passes the 200-message gate.

**The quote case:** #147 still misses, and would even with deep search forced to run. Deep search picks scenes by their summaries and then the message by keywords, and "Ruth's colour" never says "orange". That is the gap Part 5 is about.

**Done?** Half. The test can now fail, and it fires on about 1 turn in 8. The quote cases don't improve, because quotes have no budget, and with one quote case there's nothing to tune on. Giving quotes a share of their own would be the next step, but the forced search above shows what they'd hold today: keyword matches from the right period that don't answer the question. That share belongs with Part 5, if it's built.

---

## Part 4 · Better vectors

**4.1 Context in the vector.** `pendingFor` ([embed.ts](../server/src/memory/embed.ts)) embeds only a memory's bare text, though it already reads `entities`. "He told her about it" gives a vague vector. Embed the names and the scene title with the text; keyword search doesn't change. Since vectors are keyed by hash of the text, `embedChat` re-embeds everything by itself once the text changes.

The risk is that names pull every memory about a regular together. Test on a copy, and ship only if it beats Part 2's result.

**4.2 Split long queries.** Expect little: the newest message has a median of 392 characters, and only the longest reach the 1,600 cap. Try splitting past about 800 characters, and keep it only if the score moves, because it costs more tokens every turn.

### Part 4 results (November 5): neither ships

**4.1, names and scene in the vector.** Tested on a second copy: each memory embedded as "names · scene title", then its text, which re-embedded 2,058 memories in both chats for about 110,000 tokens. Against Part 2 and 3 as built:

| | Writer: earlier / independent | Planner: earlier / independent |
|---|---|---|
| Bare text (shipped) | 34 / 20 | 33 / 18 |
| With names and scene | 34 / 21 | 33 / 19 |

That's one case each, made of churn: the writer gains #401, #431 and #740 and loses #161 and #613, and the planner gains and loses much the same. The vectors also bunch up as feared (the median standout falls from 2.54 to 2.34 sd), which would shift Part 3's threshold too. It doesn't clearly beat Part 2, so it stays out. The change is one function in `embed.ts` (`memoryEmbedText`) if a later model or a bigger test set calls for another look.

**4.2, splitting long queries.** Only 5 of the 61 case turns have a newest message over 800 characters (median 385). Split there with each part keeping the message's full weight, nothing moves; with the weight shared among the parts, the writer loses 4 cases and the planner 4. It stays out.

---

## Part 5 · Old messages by meaning

Vectors stop at memories and summaries. Deep search can find a scene by meaning, but it picks the message to quote by keywords alone (`deep.ts`, phase 2). A detail never filed, and later paraphrased, is hard to reach.

**5.1 Design:**
- New owner type `passage`, id `<swipe id>:<n>`, in chunks of about 1,200 characters on sentence boundaries.
- Embedded only once a message leaves the window, since recall can't search it before that. Takes that never get used are never paid for.
- A trigger removes vectors with their swipe, as M31 does for memories. Reads check the active swipe and `seq <= evicted`, so rewinds and swipes stay right.
- Deep search ranks a scene's messages by keywords and meaning together, and can run with no keyword query.

**Blocking question: point of view.** Quotes ignore `known_by` today, so a character can already be handed lines from a scene they weren't in. Meaning search would make that more likely, since it finds more. It needs a presence check first, which overlaps the witness rule still open from docs/19 3.1.

*Done when:* quote cases for unfiled details rise, with no quote from a scene the point-of-view character missed.

---

## Costs

Estimated at about 4 characters a token and OpenAI's list price of $0.13 per million as I remember it. The connection goes through NanoGPT, so check the rate against Usage first.

| Step | Tokens, once | About | Storage |
|---|---|---|---|
| 1.1 eval queries | 6,000–15,000 | under 1¢ | cache file |
| 4.1 re-embed all memories | 150,000 | 2¢ | none (replaces) |
| 5.1 embed all messages | 580,000 | 8¢ | about 8 MB, roughly 2,100 vectors |

Part 5 also roughly doubles the scan in the longest chat, to about 4 ms a query.

---

## Left out, and why

- **A vector index (`sqlite-vec`) or faster math (SIMD):** a turn's scan takes about 8 ms. An extra native dependency buys nothing at this size.
- **Ranking by similarity score:** tried above, no better than rank.
- **A higher similarity floor:** no effect, because the top-80 cut already decides.
- **A different embedding model:** nothing suggests the model is the weak part, as wanted memories already rank near the top.
- **A reranking model:** the librarian already does this.
- **Fact vectors (docs/19 4.1):** still unbuilt, and no code in `server/src/trackers` uses embeddings. They could merge reworded facts, and that plan owns them. The two slip cases miss here at every setting because they need records, not ranking.
