# Audit: "Clawed Out Into October" (Buffy × Gabriel)

Audited 2026-11-10 against the real database, opened read-only. Nothing in the story or the app was changed.

## What was checked, and what was not

| Covered | How |
|---|---|
| All 428 of Gabriel's turns | Read in full |
| Replies 1–115 and 920–926 | Read in full |
| All 429 live replies | Scanned by script: tense, quote style, tags, recurring phrases, openings, echoing, weather words, dates |
| The prompt Mea sent for reply 926 | Read block by block |
| Mea's own records for the chat | Continuity flags (448 issues), memories (2,195), cast list (883 entries), summaries (186), journals, lessons, subplot proposals, weather events, job results, all 18,860 model calls |

Not done: replies 116–919 were not each read word for word. Findings in that range come from the scans, from Mea's own flags, and from the user's regenerate notes, so a wrong fact that no scan or flag touched could still be sitting there.

The chat: 857 live messages (69 deleted), story time Tuesday 9 October 2001 21:54 to Monday 15 October about 14:40. Writers: GLM 5.2 (1–365), GLM 5.3, Opus 4.6 (461–589), Opus 5.5 (601–685), GLM 5.3 again (796–926).

---

## 1. The ten things that matter most

1. **The day-zero character brief is still injected at message 926.** Every prompt still tells the writer to "show her tells: rubbing her raw right wrist, looking at exits, blinking too slowly, hands trembling", to allow "no more than one crack per exchange", and that she "exhales for the first time since the grave". Buffy's state line still reads "wants: to feel anything that isn't ash and exhaustion · shows blank, staring but feels cratering". This is six story days and a whole romance later. It is the root of the wrist tic (79% of replies in the first era, banned by you 20 times, eight variants on the ignore list) and of the grim tone you corrected about 20 times ("warmer", "comedic", "not depressing").
2. **Facts are never retired.** Memory #197, "Dawn is fifteen and does not know Buffy is alive", is still active at full confidence 650 messages after the reunion. The first take of reply 926 was built on it: Buffy "tells Dawn today" and Spike gets a cover story. Only 163 of 2,195 memories were ever superseded.
3. **Tense.** The story is set to present tense. 141 of 429 replies are past tense, including nearly every reply from 595 on. The tense check is switched off in the guard settings, so it has raised nothing since message 400; the "present tense" lesson still shows last broken at 355, and 25 editor fixes are left as "proposed".
4. **Summaries guess the date.** The tracker keeps a story time for every message, but each summary's time label is the summarizer's own guess: the same Wednesday is called Day 1, Day 2 and Day 3; mid-October is called "late October"; a 10 a.m. scene is labelled "night". (An earlier version of this audit said the clock was never stamped on messages; the unused column is redundant, not the cause.)
5. **Character state in the prompt is stale and garbled.** At 926, during darts with Walter and Spike, Buffy is "wearing: jeans unbuttoned… boots in the footwell" and Gabriel has "taste of her on his mouth" (both from the car scene hours earlier). Gabriel's body line has unclosed brackets and Buffy's body inside it. Inventories never expire: Buffy still "has" cream soup, a wrapped toothbrush, three pairs of shoes all "on her feet"; Gabriel is still "eating" Thursday's burnt toast with a cereal bowl on his head.
6. **The automatic word-fixer corrupts text.** It turned Gruyère into "(grey" eight times, Mario into Maria, "Slower" into "shower", Billy into Willy. Three corruptions are still live: 135 "Rack on three walls", 151 "loose.", 269 "greyère". The one legitimate hit (Rovello→Revello) was Spike mispronouncing on purpose.
7. **The continuity checker is mostly noise, and its real catches are left unfixed.** 448 issues, most dismissed. Whole families are false alarms (below). Meanwhile true errors sit open in the text: Eleanor as a "heart surgeon", the faucet "still unfixed", the BALLET! album and Joyce's mug in the wrong house.
8. **Cost and speed.** 18,860 model calls for 429 replies, about 44 per reply, about 172 million prompt tokens. Each reply sends the full ~77k-token prompt three or four times because the writer skips its plan (109 "asked again", 90 planner rescues, 102 "planned first"). Replies 461–685 carried 150k–510k tokens each. Median wait 52 seconds; many 150–330 seconds.
9. **Weather is not weather.** The weather field holds lighting notes ("first thin gold on the kitchen tile"). The last one, "cold clean air off the ice", was written at the rink and is still the story's weather six hours later indoors. Monday has frost on the car in a mediterranean-climate town five days after a beach date was planned.
10. **Subplot proposals are template filler.** 86 offered, 1 accepted. "Powell" (a street) and "Rack" (from "Nordstrom rack") are proposed as people; the cat "is being blackmailed".

---

## 2. Continuity

### Dates and time
- 63: "a Thursday morning". 10 October 2001 was a Wednesday (87 and 97 get it right).
- 55: "the wrong end of October" on the 10th. Summaries repeat "late October".
- 65 and 95: "known for six hours" (nine, then eleven). 109: "seven in the morning" after 99 said "almost nine".
- 69: wet hair at 7 a.m. after an 11 p.m. shower.
- 147/149 and the "Already happened" list: Buffy outside "for the first time since February". She died in May; February is Joyce.
- 785: "still time before eight" on a Sunday; the arc summary 355–532 starts on "Wednesday" when it was Thursday.

### Objects and places
- The toothbrush: unwrapped and used at 69, "still in its packaging… all morning" at 111 (after you corrected it at 71), crinkling in a back pocket at 85. It appears in 16% of the first 365 replies and is still on the counter in memory.
- 175: orange slippers for green. 443: a henley and button-down over the sunflower tee. 870: the grey tee left at the store reappears.
- 279: Ruth walks into Revello Drive though she was left at Gabriel's.
- 736, 742: BALLET! album and Joyce's daisy mug appear in the Winters kitchen; both are at Revello.
- 593: kitchen faucet "still unfixed" a day after Gabriel fixed it.
- 153: a Foot Locker appears in a strip mall described without one.
- Place names fork: the darts wall is "kitchen › living room"; the prompt says the scene is in the kitchen with "ROOM: Dawn's room".

### People
- 73: Buffy knows the cat is "named after a Supreme Court justice" 250 messages before Gabriel says so (326). You flagged this kind of leak at 73 and 81.
- 57: Buffy narrates Giles crying at the airport and leaving "that August". She was dead, and buried in May. The line comes from a lore entry injected with no "who knows this" gate.
- 45: the soup is "a recipe his dead nanny taught him" one message before Gabriel says Maria is dead; nobody said it was her recipe.
- 57 vs 81: two different Merrick stories. 57/85: Buffy "worked at a coffee shop and got fired".
- 443: Eleanor a "heart surgeon" (neurosurgeon). 900: George Winters called great-grandfather (great-great). 701: Dawn called Gabriel's sister.
- 583/585: Gabriel's injuries (horse, lacrosse, skiing) given to Buffy, and stored as her memory.
- 391: Buffy's boots "bought with a dead woman's debit card". You set the truth that Gabriel bought them; the memory and her inventory still say otherwise.
- Blood: Dawn's supplier is both "the butcher on Third" and "Frank behind the laundromat on Powell"; "two pints" and "21 unopened pints"; Spike's type is O negative in replies and plans, O+ in your turn 716.
- 291: "Tara told me about the Powell guy" with no basis.
- Spike in daylight: he leaves the house at 14:40 on a Monday (926), plays Mario Kart in the morning (795), and exits by day (799). Nothing flags sunlight.
- Dawn, fifteen, is "the small child" (920).

### Period slips
355 Steve Jobs's turtlenecks and "decision fatigue"; 784 emoji on a 2001 Nokia. (Mario Kart on a PS2 is yours; noted only because a period check could offer to flag it.)

---

## 3. Accuracy of Mea's records

### Memory (2,195 entries)
- Wrong and still active: #197 Dawn doesn't know; #391/#419 debit card; #583 Buffy's concussions; #149 "since February"; the false note marked *confirmed*: "Gabriel never fed Buffy soup on day one" (he did, at 38).
- Trivia stored at full confidence: a toothbrush rolling to a stop, a price tag spinning.
- 14 embedding jobs failed with a provider 503. (Harmless, it turned out: the next run embeds whatever lacks a vector, and only one active memory has none.)
- The stored recap is from message 569. It is only a cache: a recap is written fresh when you ask or come back after a break, so this is harmless.

### Cast and places (883 entries)
- 455 places, heavily duplicated: Summers kitchen / Revello Drive kitchen / 1630 Revello Drive kitchen / kitchen / Gabriel's kitchen / Winters Residence kitchen / hills house kitchen.
- "People" that are not: Sunnydale High, Winters Holdings, Powell, Sunnydale General, Li Shang, Mulan, Tennyson, "unchanged", "Ruth the dog".
- Aliases polluted by stage notes: "Spike (offscreen, approaching)", "Ruth (cat, distant)", "Gupert Giles", "Frank charges $12-14", "Gabriel's mom (name Buffy Summers only".
- "Gabriel's mother", "Gabriel's mom", "Gabriel's father" exist as concepts, not linked to Eleanor and Jonathan. World sheets duplicate Valeria / Valeria Ahearn and Giles / Rupert Giles.
- The Winters Family group lists Clara as "William's son".
- Only four cast profiles exist (Buffy, Giles, Eleanor, Dawn). None for Spike, Walter, Valeria, Willow or Ruth.

### Summaries
- Time labels are unreliable (section 1, item 4). Two chapters share the title "The Whole Word, No Takebacks".
- The verifier marks many scenes "major" and nothing happens. About 14 scenes were skipped for quota. The verifier is itself wrong at times ("Gabriel's mother is dead"; "the source never mentions Mario Kart").

### The state block at 926
- "Facts in play" pulls irrelevant items into a darts scene (#7 which cemetery was closest; #215 the "position filled" mix-up).
- "Where things stand" shows 12 open items plus "50 quieter". Shown: "the fridge situation" (solved Thursday), "writing the house constitution today (Sun)" on Monday. Not shown: promise rings, Eleanor and Jonathan's visit, the audit of Joyce's accounts, Willow, the beach date, Spike moving in, the Council and Giles.
- "Today so far" starts with yesterday, clips entries mid-sentence ("seeking friction from his;"), and files the hillside, the darts and Walter's arrival under "Sunnydale Mall parking lot".
- "Corrections" contains non-sequiturs: "Maria died… Buffy Summers knows now: Gabriel did ballet".
- "Pressures": "Ruth is being blackmailed", "Walter is keeping a secret that would change how people see them", "Spike is pretending to be someone a little better". These are drawn from a deck, not from the story.
- Ruth is "hungry, thirsty; belly full". Spike is "hungry, thirsty… stress 5" during a friendly game.
- Buffy's permanent traits include "pale; eyes too wide, pupils dilated; voice hoarse from disuse" (grave-night state frozen as "always"). Gabriel's include "twelve inches" in every prompt.
- The lore block opens with three empty entries: "Winters Residence kitchen", "Summers kitchen", "Jamie".
- Events from rejected takes are stored alongside the live one (926 has 30 from the rejected take, 26 from the live one). Worth confirming the state fold ignores them everywhere.

### The continuity checker
| Kind | Count | Dismissed | What goes wrong |
|---|---|---|---|
| clock going backwards | 39 | 34 | Any time of day in a memory or simile ("a graveyard at midnight"). Also misreads "seven forty-two a.m." as 02:00 and "eleven-oh-eight" as 08:00 |
| name | 13 | 10 | Spell-suggests ordinary words: Corn→"grey tee", Flour→four, Hugh→High, Homer→"home)" |
| leak | 8 | 7 | Wrong secret, wrong person: "Ruth doesn't know Buffy clawed out of her grave"; "Buffy doesn't know Gabriel is with Buffy" |
| not here | 21 | 19 | People you just brought in (Chloe at the till, Spike opening his own door) |
| past | 56 | 46 | "No record of X" when X is on the page: the M card (35), Gabriel's promise (58), Uncle William |
| trait | 4 | 4 | Gabriel's blue eyes checked against Dawn's |
| tense + lesson | 97 | 86 | Correct, but two flags per reply, then nothing after message 400 |
| fact | 162 | 135 | Mixed; holds most of the real catches |

---

## 4. Planning

- The writer skips its plan on most replies; Mea then re-asks, plans separately, or hands off to the planner. Four replies were written with no plan at all. One plan leaked into the story (287) and one `</think>` (501).
- The plan check caught ten wrong claims before they were written (mostly "Dawn doesn't know…"), which is the same stale-fact problem surfacing upstream.
- Plans carry forward wrong facts (O negative) and odd residue ("the sealed word 'horny' stays sealed").
- The advisor made 2,165 calls and 19 million tokens for 429 replies.
- The planner follows your lead well scene to scene, but none of the long arcs appear in a plan's "threads worth touching": rings "this week", the parents' visit "next week", the audit, Willow's apology, the beach, Spike's room, telling the Council.
- A new take is told only the opening and main beat of the rejected one, not why it was rejected. For 926 the reason was a wrong fact, which the retry could have repeated.

---

## 5. Prose

Share of replies containing each habit, by era:

| Habit | 1–365 | 366–460 | 461–589 | 590–685 | 686–795 | 796–926 |
|---|---|---|---|---|---|---|
| wrist / raw ring | 79% | 36% | 14% | 68% | 28% | 12% |
| "filed", "file", "drawer" | 73% | 94% | 93% | 97% | 84% | 50% |
| courtroom words (ruling, docket, overruled, counselor…) | 26% | 50% | 49% | 44% | 73% | 86% |
| "Not X. Not Y." | 58% | 13% | 47% | 46% | 7% | 0% |
| "a whole thing" | 56% | 30% | 0% | 6% | 21% | 3% |
| sycamore | 63% | 5% | 3% | 0% | 0% | 0% |
| "the kind of / that" | 34% | 19% | 57% | 68% | 13% | 4% |
| "load-bearing" | 2% | 8% | 42% | 8% | 7% | 6% |
| em dashes per reply | 29 | 20 | 31 | 33 | 20 | 13 |

- Tics are replaced, not removed. The wrist went and the filing cabinet came; the filing cabinet eased and the courtroom arrived (3.2 legal words per reply now). The craft tracker is paused with 19 ignored phrases, so nothing is watching.
- The courtroom voice has spread to everyone. Dawn's, Spike's and Ruth's journals all open "Filed under" and end on "Gavel". Ruth's journal quotes Buffy's lines verbatim.
- Early replies run 900 words against two-line turns, open on an ambient noise (pipe, fridge, water heater) and close on an atmospheric paragraph. Only 2% of the Opus 5.5 replies end on dialogue, which leaves Gabriel little to answer.
- Early dialogue is stutter-built: "That's — you can't just — there's a whole —" in nearly every reply. "For the record" holds at about one reply in six throughout.
- Early replies re-quote your lines back (19, 77). This is mostly gone later (3 of 172).
- Prop fixation: toothbrush, BALLET! album, the exclamation mark, the spoon parallel to the bowl, an egg piece for Ruth five times in one scene.
- 111 repeats a sentence twice. 91 and 103 swap which wrist. 876 contains "祈祷".
- Straight quotes in 30 replies up to 339 (the style asks for curly). Unbalanced tags at 333, 421, 431, 547, 621, 826. Speaker marks left in 115, 117, 123, 756.
- Late dialogue often has no speaker ("Why twice?" at 920).
- Your turns 460, 688 and 865 are in the model's voice; 688 is past tense. If these came from "write for me", it is feeding the tense drift.
- Voice drift checks compare against the five day-zero card lines, so a happier Buffy reads as "drifting".

---

## 6. Subplots and the living world

- 86 proposals, 85 declined. Most premises are a template plus a random fact: "Ruth has their own stake in 'empty house'… want: to get what they're after · fear: it slips away for good."
- Non-people as leads: Powell (three times, including one where "Powell" bought Dawn's blood for 21 weeks), Rack, the Hellions after they left.
- Built from dead threads: at 926 a proposal is grounded on "first day back" and the last bite of a day-one waffle.
- Proposals for Walter invent a family "expecting reports" and say he would "rather lose the name Winters".
- A few are good and went unused: Giles cornered by proof Buffy is legally alive (205); Dawn wanting the truth instead of protection (657); Hank (683).
- None of the proposals pick up what the story actually set up: Willow's next move, the audit result, Eleanor's arrival, the Council noticing.
- World incidents are generic and British ("a delivery truck blocked the high street", "the market was busier than usual; everyone was talking about prices") and none reached the page.
- The opening arcs (Hellion raid, the Scoobies' secret) ran on dice and templates.

---

## 7. Weather

- 43 weather events in 429 replies, with gaps of 100 messages (451–549, 551–623).
- The values are light and mood, not conditions: "kitchen half-dark, fridge hum", "mall waking — shutters rattling up". No sky, temperature, wind or rain is ever recorded.
- Values go stale: "first thin gold on the kitchen tile" from 06:45 to 10:30 Thursday; "full morning sun" from 06:30 to 16:00 Friday; "cold clean air off the ice" from the rink at 08:05 to the living room at 14:40.
- The sky engine treats any weather line the story writes as truth and continues from it, so these non-weather lines become the anchor and its own forecast never shows.
- The setting is mediterranean, where the engine's own autumn low is 14°C. Monday still has "frost on the car" and "frost burning off the hoods" (874, 878). Wednesday was bare-forearm weather with a beach date planned.
- The Summers house is "sixty-two degrees" in five replies (a nice recurring detail, but indoors).
- The season setting is blank although the date is known.
- No rain, wind or cloud happens in six days; the only variety is sunrise and sunset.

---

## 8. Proposed fixes

### Do first
1. **Let the character brief age.** After a set number of scenes, or on any milestone (first kiss, "established", moving in), rewrite the "who she is", "tells", "wants / fears" and voice rules from what the story has shown, and show you the before and after. Keep the card as origin, not as standing orders.
2. **Retire facts on events.** When a reveal, reunion, purchase or repair is recorded, find the memories and facts it overturns and supersede them. Give "doesn't know" facts an owner and end them when the knowledge event fires. Run a one-off sweep on this chat.
3. **Enforce tense and point of view in code.** Check every reply; on a miss, rewrite once automatically before showing it. Keep the check running for the whole chat, and tell "write for me" the same setting.
4. **Stamp story time on every message** and make summaries read it instead of guessing. One day-numbering rule (day one is the opening date).
5. **Expire transient state.** Clothing, body and "holding" last one scene unless restated. Inventory drops consumed, left-behind and bought-then-put-away items. One pair of shoes on a pair of feet. Validate the state line (balanced brackets, one person per line) before it goes in a prompt.
6. **Turn the word-fixer into suggestions only**, and only for known cast and place names. Never apply to dictionary words, words inside italics, or quoted mispronunciations. Repair 135, 151 and 269.
7. **Plan once.** If a model skips its plan twice in a chat, switch that chat to "plan in its own step" for good, so each reply is two calls, not four. Cache the shared prompt across them.

### Continuity checker
8. Clock check: ignore times inside memories, similes and reported speech; fix the spoken-number parser.
9. Drop the name spell-check on ordinary words. Match secrets to the right holder. Treat anyone named in the latest user turn as present. Check a trait against the person the sentence is about.
10. Before saying "no record of X", search the transcript, not just memory.
11. Merge the tense flag and the tense lesson into one. Offer a one-click fix for each open flag and a "fix all open" pass; show open flags as a count on the chat.
12. Add checks that are missing: sunlight for vampires, weekday against date, period (2001), blood type and other "one value per person" facts.

### Memory and cast
13. Importance scoring so trivia decays; merge near-duplicates at write time.
14. Retry failed embedding jobs; show a count of unsearchable memories.
15. Cast tidy: merge duplicate places by address, strip bracketed stage notes from aliases, keep organisations, streets and film characters out of "people", link role names ("Gabriel's mom") to the named person.
16. Refresh the recap every chapter. Build a profile for anyone with more than about 20 mentions.
17. When you add a "truth", search for memories and inventory lines that contradict it and retire them.
18. Gate lore by who knows it, so narration in Buffy's head cannot use what only Giles saw.
19. Skip empty lore entries. Pick "facts in play" by the current scene's people and place.

### Planning and long arcs
20. A short "long threads" list, separate from errands, always in the plan: promises with dates (rings this week, parents next week), unresolved conflicts (Willow, the audit), secrets (heaven, the Council). The planner should surface one when its date arrives.
21. Rank open items by weight, not recency; close ones the story has plainly finished.
22. Tell a new take why the last one was rejected when the reason is known (your note, or a failed check).
23. Feed "Corrections" only from real supersessions.

### Prose
24. Re-enable the craft tracker with a rolling window: any phrase or word family over a set share of the last 20 replies goes on a cooling list automatically, including metaphor families (filing, courtroom), not just exact strings.
25. Per-character voice notes so a running bit belongs to one person. Journals written from each character's own vocabulary and only from scenes they were in.
26. Length follows the turn: a two-line turn gets a short reply unless the scene turns. End on something Gabriel can answer.
27. A light post-pass for curly quotes, balanced tags, stray speaker marks, repeated sentences and stray non-English characters.
28. Refresh the voice-drift reference from recent replies you kept.

### Subplots and world
29. Proposals only for real, present-in-the-world people; never for places, shops or pets unless you ask.
30. Each proposal must cite a live thread and say what would change on the page; drop the template wording. Stop proposing a kind you have declined several times.
31. Seed proposals from what the story set up: Willow, the audit, Eleanor's visit, Giles, the Council.
32. Incidents drawn from the setting (Sunnydale, 2001), with a route onto the page (overheard, on the radio, on the drive).

### Weather
33. Split "light" from "weather". Weather is sky, temperature, wind, rain; light comes from the clock and the sun times the engine already has.
34. Only accept a story-written weather line as truth when it is actually about weather and within the climate's range; otherwise keep the forecast and flag the line (frost at 14°C).
35. Put one plain weather line in the state block each scene, and carry outdoors and indoors separately (the rink, the cold Summers house).
36. Fill the season from the date. Let fronts arrive so six days are not identical.

### Cost
37. Canon is 84k of the 112k-character system prompt on every call. Send a short core and retrieve the rest by scene.
38. Cap the prompt; investigate why 461–685 reached 150k–510k tokens.
39. Batch the helper calls (librarian, lore keep-up, continuity, journal) per scene instead of per reply.

### One-off repairs for this chat
- Retire memories #197, #391, #419, #583, #149 and the false "no soup" note.
- Settle Spike's blood type and Dawn's supplier.
- Fix "Clara (William's son)".
- Fix the open true flags: 443, 593, 736, 742, 279.
- Decide whether Spike can be out by day in this version of the world, and record it as a truth.
