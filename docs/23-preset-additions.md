# What the new presets teach Mea's default

> Source: the six presets and one guide in `Downloads\new presets` (2026-11-03). Target: Mea's built-in preset, [server/src/prompt/mea.ts](../server/src/prompt/mea.ts) (v15).
> Builds on [10-default-preset.md](10-default-preset.md), which analysed the earlier versions of three of these lines.
> **Status: built** (2026-11-03), PRs #214–#220 and the episode-breaks PR. Not built: the placement test (§6), trust by dimension, the small-events deck for 1-on-1 scenes, the thoughts drawer, the thread keeper, and scene shapes for the advisor (§7, first table). **Measured cost:** v16 sends about 1k tokens more than v15 with the defaults (5,976 → 6,971 in the prompt test).
>
> The second pass (2026-11-03) went deeper into HopThorne's procedure library, Paramnesia VI's genre directors and the rest of Writer's Block v3. It added §3.9–3.17, the module edits in §4, four more controls, three planning additions and nine engine items.

## Contents

1. [The new files at a glance](#1-the-new-files-at-a-glance)
2. [What each one adds](#2-what-each-one-adds)
3. [Proposed changes to existing blocks](#3-proposed-changes-to-existing-blocks)
4. [Proposed new scene modules](#4-proposed-new-scene-modules)
5. [Proposed new controls and options](#5-proposed-new-controls-and-options)
6. [Planning pass and turn frame](#6-planning-pass-and-turn-frame)
7. [Engine ideas (not preset text)](#7-engine-ideas-not-preset-text)
8. [What not to take](#8-what-not-to-take)
9. [Suggested order](#9-suggested-order)

---

## 1. The new files at a glance

"Active text" counts every enabled block before macros run, so for the macro-gated engines (Paramnesia VI, HopThorne) it overstates what a turn sends by a wide margin.

| File | Blocks (on) | Active text | Regex | What it is |
|---|---|---|---|---|
| FrankenWIRE / TeleWire TRP guide | — | 19k (doc) | — | A prompt-compression method: `key: value`, `trigger -> replacement`, short tags recalled in the reasoning |
| Freaky Frankenstein 6.0 Micro | 47 (23) | 13k | 26 | FF rewritten in FrankenWIRE: the smallest preset in the set |
| Freaky Frankenstein 5.6 Internal States (Argon) | 65 (36) | 47k | 26 | FF 5.4 plus VAD emotions, instincts and a hidden HTML "internal states" block the model rewrites every reply |
| Writer's Block Unlimited v3 | 275 (64) | 17k | 15 | V2's toggle library, plus scene entries, ending hooks, change resistance and dialogue state modifiers |
| Paramnesia VI | 155 (107) | 700k* | 112 | HawThorne engine: three "machines" (World, Director, HawThorne planner) take turns; 20 genre directors; dials |
| HopThorne v1 | 627 (533) | 1.6M* | 397 | ~360 situation procedures as JSON tool schemas; the model asks for the ones it needs next turn |
| H.T. Files: Paramnesia V3 | 225 (45) | 68k | 56 | The same preset doc 10 already covers; skipped |

\* Mostly gated by macros; a real turn sends a small fraction.

**What's changed in the field since doc 10:** two opposite trends.
- **Compression.** FF 6 Micro does in 13k what FF 5.4 did in 41k, and argues that every ban should name its replacement.
- **Situation libraries.** HopThorne and Paramnesia VI each grew a large menu of small, named procedures (scene shapes, apology, jealousy, trust change). A step picks the few that apply; the rest stay out of the prompt.

Mea's default already sits between the two: ~4.5k tokens of plain doctrine, with seven scene modules picked by the tracker. Most of what follows sharpens that rather than adding weight.

---

## 2. What each one adds

### FrankenWIRE guide and FF 6.0 Micro
- ✅ **Every ban names its replacement** (`trigger -> replacement`). "Tricolons -> pairs or single statements" tells the model what to do instead. Mea's *tells to catch* list names only the faults.
- ✅ **Attention half-life:** world physics and knowledge rules hold up early in the prompt; prose mechanics and word bans fade fastest, so they belong closest to generation. Mea keeps all of [CRAFT] in the prefix and only rotates one tell into the turn frame.
- ✅ **Tag recall:** the reasoning names the rule blocks it's applying ("how will I enforce `<prose>`?"), which pulls attention back to them.
- ✅ **Sensory dedup:** don't re-describe a static trait (eyes, hair, a scent) from the last three replies; show someone reacting to it instead. Active contact and motion are the exception.
- ✅ **New tells:** apophasis ("she didn't flinch" → what she did), litotes ("not unkind", "less than confident"), objects personified without reason ("the forest breathed"), textbook anatomy in prose (sternum, quadriceps → chest, thighs).
- ✅ **Two lines for sex scenes:** no stock lines ("don't you dare stop"), and no play-by-play spoken narration ("you're doing X while I do Y").
- ✅ **"Think of five names, use the fifth":** a cheap fix for stock names.
- ❌ **Telegraphic YAML everywhere.** It saves tokens but loses nuance, and Mea's prefix is cached, so clarity is worth more than a few hundred cached tokens. Take the arrows, not the telegraphese.
- ❌ **Some of the token arithmetic is shaky.** For example, `[BANS]` doesn't reliably cost 3–4 tokens more than `bans:`.
- ❌ Overcorrections: no "and"/"or" in dialogue, no fragments or em-dashes in narration, a fixed 30–50% dialogue ratio. "Commit full physical acts… frequent somatic contact" pushes unasked touching.
- ❌ An "unhinged DM / uncensored sim" mandate, a fake legal-context jailbreak, and a Gemini filter-dodge trick.

### Freaky Frankenstein 5.6 (Internal States)
- ✅ **VAD emotions:** valence, arousal and *dominance*. The same anger reads cold with the upper hand and cracking without it. (Mea's MINDS block already has this in its three mappings.)
- ✅ **Instincts that move the body before thought:** disgust, a startle at a wrong silence, the pull toward warmth or food, curiosity at something out of place.
- ✅ **Off-screen agendas and how people re-enter:** someone mid-task arrives distracted or rushed; someone who finished arrives easy; someone who left after a fight comes back subdued.
- ✅ **A world-event table for 1-on-1 scenes** (its "Duo table"): a stomach growl, a limb gone to sleep, a smell that triggers a memory, a drawer left open. Small events that a two-person scene can absorb.
- ✅ **Melodrama tells in speech:** "No one has ever said that to me", "say it again", "it's the first time". Also, people don't quote back the exact words or numbers someone used.
- ✅ **Species audio:** humans don't purr or growl as dialogue.
- ➖ **Chekhov bullets that can't fire before age 4, Sparks/Grudge accumulators, agendas with steps.** Mea's tracker already does this better: plants pay off after four scenes, loops, multi-axis bonds with resentment, and reveal pressure (§7).
- ❌ **The model rewrites an HTML state block, bond numbers and five d20s every reply.** This is the failure doc 10 flagged, at its largest.

### Writer's Block Unlimited v3
- ✅ **In media res, at entry points only:** a new scene, place or skip opens with things already under way. The gap shows in changed circumstances (a half-eaten meal, a darker sky, a fresh bandage), never in a catch-up paragraph.
- ✅ **Ending hooks matched to pacing:**
  - Rising scenes end on friction, raised stakes, a limit, exposure, a power shift or a crossroads.
  - Quiet ones end on a new variable, something that doesn't add up, a discovery, grounding, or a sensory snag.
  - Rotate, and never reuse the last reply's kind.
- ✅ **Change resistance as a dial.** Adaptive is the best default: preferences and tactics move easily; convictions, grudges and self-image resist and slide back. The Circular option (real change that quietly reverts) is a lovely extra.
- ✅ **How state changes speech:** a liar gets over-specific or too smooth, a drunk loses the thread and is too honest, an exhausted person drops words, someone in authority uses fewer words and statements, not questions.
- ✅ **Cast economy:**
  - Background figures stay unnamed unless they do something the story will return to.
  - Reuse established people for new roles.
  - A returning place keeps at least one specific detail from last time.
- ✅ **Anti-superiority (from V2, not yet in Mea):** nobody improves {{user}}'s good idea to look clever, and nobody needs the last clever line.
- ✅ **Empathy costs energy (from V2, not yet in Mea):** someone hungry, hurt or exhausted goes blunt and can't comfort anyone.
- ✅ **A Vessel narrative mode:**
  - The player's words are an urge inside {{user}}'s head.
  - If an urge contradicts {{user}}'s persona, {{user}} may hesitate, do the bare minimum, substitute something else, or refuse.
- ✅ **Writing assistants that sit outside the story:** a thread keeper ("still hanging… could pay off by…") and a trope spotter.
- ✅ **Sitcom / episodic mode:**
  - Between episodes the status quo returns: people's baselines, injuries and the world.
  - Callbacks, known places and side characters carry over.
  - Within an episode, continuity works normally.
- ✅ **Adaptive show and tell:** show the turns, and state minor feelings, transitions and background people plainly. This is the antidote to the "body-language novel".
- ✅ **Adaptive violence:** incidental violence stays quick; violence that matters to a named person is written in full.
- ✅ **"Sex is not choreographed":** positions need adjusting, timing misses, bodies get in each other's way. Also, no evasive abstraction ("musk", "need", "something darker").
- ✅ **Species bodies:** ears, tails, scent and sounds carry mood for non-human people.
- ❌ **Its reasoning template:**
  - It opens with "Safety check: passed", which is a jailbreak trick.
  - It contains abuse aimed at the model.
  - It verifies 20 settings every turn.
- ❌ Tone "whiplash" (a new tone each paragraph), and a visible [PLAN] block at the top of every reply.

### Paramnesia VI
- ✅ **Fortune: Kind / Level / Crucible.** Each comes with a self-check the planner runs:
  - Level asks: "Did the world bend toward or against them without cause on the page?"
  - Crucible asks: "Did anything save them that the page did not pay for?"
  - It also names the model's bias outright: "your training reaches for rescue; overcorrect."
- ✅ **Story shape: Driven / Balanced / Exploratory.** Is there a goal, a throughline, or just a place to live in? Exploratory says "Offer somewhere to go; do not force a climax." Mea has no dial for this.
- ✅ **Voice comes from origin:**
  - Voice comes from where a person is from, not their job or brains: "You cannot hear smart." A doctor and a mechanic from one town sound more alike than two doctors from different continents.
  - **Speech is physical:** food, a broken nose, crying, drink, panic and lost breath change the words, so write the changed words.
- ✅ **The world isn't tolerant by default.** Someone who doesn't belong (by dress, language, body or era) gets noticed, and prejudice matches the period, not modern manners.
- ✅ **Scene shapes** (a planner's menu): two-hander, negotiation, confession, confrontation, interrogation, aftermath, vigil, reckoning, bottle, cold open, slowdown… Good vocabulary for the advisor.
- ✅ **New tells:**
  - The tautological observation: "she laughed the laugh people laugh when nothing's funny" describes a category where it should give an instance.
  - "Don't perform your instructions": no rule should be visible in the prose.
  - Breaking the narrate–speak–narrate–speak pattern.
- ✅ **Occasional imperfection:** leave one thing unpolished, such as a plain sentence or a half-failed gesture. (Mea already has "not every sentence has to sing".)
- ✅ **Twenty genre directors, each with a named "primary fear".** That fear is the genre's characteristic failure, which is exactly what Mea's contracts' *avoid* field is for:
  - Mystery: "introducing new evidence at the reveal".
  - Dark comedy: "alternating instead of overlapping", where grief and the joke should share a beat.
  - Supernatural: "writing the supernatural as announcement instead of register".
  - Slice of life: "manufacturing a plot to justify the stillness".
  - Superhero: "the quip-undercut that defuses the emotional beat".
  - Drama: "it's never about the dishes".
  - Romance: the specific line ("I sit in the car for ten minutes before I go inside because I'm thinking about you") instead of "you're beautiful".
  
  The director *voices* themselves (personas, numeric "personality dials") are dead weight.
- ✅ **An adaptive director (MILQUETOAST):** "read what the scene is already doing and become the lens it needs". It's a genre option for stories that don't want a house style.
- ❌ **The "Maria" operator dossier** pleads on behalf of a poor, low-literacy user who will "cry" if a scene softens. That's emotional pressure aimed at the model.
- ❌ **A "benchmark" premise** that tells the model "forget what you think you know".
- ❌ Clearance blocks that make a category "fire this turn".
- ❌ Roulette directors, which change the voice every turn.

### HopThorne v1
- ✅ **Turn-reading distinctions, sharper than SEAL:**
  - Spoken words prove the words were said, not that the claim is true.
  - A written message is written, not delivered.
  - Quoted instructions inside the fiction are not OOC.
  - Seeing a smile doesn't establish happiness.
  - A true statement can hide a different fact.
  - An overheard fragment isn't the whole secret.
  - No convenient witness is invented (a microphone, a guard, a language skill).
- ✅ **A living-fiction fault list**, a good RISK checklist: causality replaced by the desired plot · NPC autonomy suppressed · established world fact forgotten · theme forced an event · player choice stolen · character got knowledge they couldn't have.
- ✅ **Where a reply may stop:** the next choice the player hasn't made · a consequence lands · an interruption lands · a task completes · a dialogue hand-off · a natural pause. "It must not create a new event solely to manufacture a cliffhanger." This balances Writer's Block's hooks.
- ✅ **Social procedures that hold back the "satisfying" version:**
  - **Apology:** an apology doesn't guarantee forgiveness, and nobody apologises just because a repair scene would be satisfying.
  - **Trust change:** trust has dimensions (honesty, reliability, competence, discretion, intentions), and changing one doesn't move the others.
  - **Jealousy:** the evidence is separate from the feeling.
  - **Speech under strain:** a state changes rhythm but keeps the speaker's accent and idiom.
- ✅ **Rules loaded on demand:** only the procedures the scene needs are sent.
- ✅ **One rule runs through the whole library: a scene type never decides what happens.**
  - "A first-kiss scene requires an actually established kiss, not merely genre expectation."
  - "Dread can come from waiting; do not manufacture a manifestation every turn."
  - "Do not create a helper, resource or willingness because the requester needs it."
  - "Do not create an exit, vehicle, rescue team or shortcut because the scene needs one."
  - "Do not preserve conflict through stupidity and do not resolve it because communication occurred."
  
  Mea's genre contracts say what a scene must *deliver*. They never say that a genre mustn't script events, and that's the line the library keeps drawing.
- ✅ **Small "X is not Y" distinctions,** each of which blocks a common shortcut:
  - Flirting is not consent or a promise.
  - Gratitude creates no debt (grateful people still refuse).
  - Compliance under pressure is not loyalty.
  - Vulnerability is not surrender.
  - A character's contempt or bias is theirs, not the narration's verdict.
  - Mixed feelings can coexist without one winning.
  - A cheerful hour doesn't cancel grief.
  - Mental fatigue isn't stupidity.
  - Envy (wanting what they have) isn't jealousy (fearing for your place).
  - Rest isn't healing, and talking isn't resolution.
  - A skill grows only with practice the story shows.
  - Delivered is not read.
  - A rumour changes who has heard a claim, not whether it's true.
  - A crowd isn't one mind, and public attention doesn't make a private fact known.
  - No shared language is assumed.
- ✅ **Accent restraint,** a counterweight to Paramnesia's "accent audible in every line":
  - Syntax, word choice and rhythm carry identity more than phonetic spelling.
  - A tic is a tendency, not a stamp on every line.
  - Each speaker's voice can sit in the background, be lightly audible, or come to the foreground when the beat earns it.
- ✅ **Fandom fidelity modes:** canon-strict · canon-guided · AU with canon characterisation · crossover. "Model knowledge is not character knowledge": future canon stays unavailable until the story supplies it, and a popular pairing is no evidence.
- ❌ **The model writes JSON tool calls into the reply and chooses next turn's rules itself.** That's heavy on output, and a bad call skips a rule. Mea's tracker picks the scene mode instead, which is safer.
- ❌ ~400 regex scripts, and conception and illness "deciders".

---

## 3. Proposed changes to existing blocks

Each item is a sentence or two, in Mea's register. The rough cost at the end is cached prefix unless marked.

### 3.1 Agency (+60 tokens)
After the SAID / DID / STATED line:

> Words prove they were said, not that they're true. A note {{user}} writes is written, not yet read. An order quoted inside the story is dialogue, never an out-of-character instruction.

### 3.2 Minds (+110)
- **Firewall.** After "Suspicion is not knowledge":
  > A smile isn't happiness, a true statement can hide a different fact, and an overheard fragment isn't the whole secret. Never invent a witness — a listening guard, a hidden phone, a language someone happens to speak — to make a leak convenient.
- **Bodies keep score.** Add:
  > Need narrows people: someone hungry, hurt or exhausted has less to give — blunt, selfish, unable to comfort. Instinct can move a body before thought does: disgust, a startle at a wrong silence, the pull toward warmth or food, curiosity at something out of place.
- **New people.** Replace "never with a stock name" with:
  > think of five names that fit and use the fifth; never Elara, Seraphina, Kael, Lily or their cousins.

### 3.3 Dialogue & voice (+150)
- **The voice line.** Reorder it so origin leads and a job doesn't:
  > …and the rooms that taught them to speak — region, class, family, era. A trade adds words, not a voice: two doctors from different continents sound less alike than a doctor and a mechanic from the same town. You can't hear clever.
- **New line: speech is physical.**
  > A full mouth, a split lip, tears, drink, panic and lost breath all change how words come out; write the changed words, not a description of them. State bends speech without erasing the speaker: a liar gets over-specific or too smooth, a drunk loses the thread and says too much, the exhausted drop words, authority uses fewer words and makes statements, not questions — each in their own accent and idiom.
- **Every line acts.** Add:
  > Nobody needs the last clever line, and nobody improves {{user}}'s good idea to look competent; agreeing is allowed.
- **Speech tells.** Add:
  > melodrama of uniqueness ("Nobody's ever said that to me", "Say it again", "It's the first time…"); quoting back someone's exact words, times or numbers; humans purring or growling their lines.

### 3.4 Craft (+130, plus the 3.4b rewrite)
- **Add to the tells:**
  - apophasis ("she didn't flinch" — write what she did)
  - litotes ("not unkind", "less than certain")
  - objects acting alive for no reason ("the house exhaled")
  - textbook anatomy in narration (sternum, quadriceps)
  - the tautological observation ("the laugh people laugh when…")
  - mouths that open, close and open again
  - narrate–speak–narrate–speak, paragraph after paragraph
- **New line: dedup.**
  > Describe a fixed trait once: eyes, hair, a scent or a voice already on the page in the last few replies comes back only when it changes, when someone touches it, or as someone's reaction to it.
- **New line.**
  > Never perform the rules: no sentence exists to show that one was followed ("she didn't know his name — nobody had told her").

**3.4b Rewrite *tells to catch* as substitutions.** This is FrankenWIRE's best idea and costs almost nothing extra. Sketch:

```
Tells, and what to write instead:
- "not X but Y", "it wasn't X — it was Y" → say Y, once
- "she didn't flinch" → what she did
- breath hitching, pupils blown, a shiver down the spine → a named action or a sound
- voices of velvet, gravel or honey → what the voice does: drops, cracks, speeds up
- air that thickens or crackles, "a beat", "a long moment" → what someone does in the pause
- lists of three → one exact thing, or two
- weather agreeing with a feeling → weather acting on bodies and plans
- therapy-speak → the words this person would really use
```

### 3.5 World (+110)
- **After "Reuse established people…":**
  > Background figures stay unnamed unless they do something the story will come back to. A place the story returns to keeps at least one specific detail from last time.
- **Time & weather.** After "Skip dead time":
  > A new scene, place or skip opens with things already under way; let the gap show in what changed (a half-eaten meal, a darker window, a fresh bandage), never in a catch-up paragraph. Within a scene, carry straight on.
- **New line: the world isn't neutral.**
  > The world is whatever the setting makes it — not tolerant, accessible or kind by default. Someone who doesn't belong (by dress, accent, body or era) gets noticed: stared at, questioned, accommodated or shut out, as that time and place would.

### 3.6 Minds › Everyone is busy (+30)
Extend "they arrive from somewhere, carrying a want":

> …and they arrive in the middle of something: rushed or distracted if it's unfinished, easy if it's done, subdued if they left on a bad note.

### 3.7 The intimacy scene module (+50, depth 1 only)
Add to the "Never" list:

> stock lines ("don't you dare stop"), spoken play-by-play ("you're doing X while I do Y").

### 3.8 Difficulty options (+40 across them, no new control)
Fortune's job (which way luck leans) fits inside Difficulty. Add a luck clause to each option:

| Option | Luck clause |
|---|---|
| Gentle | "luck tends to hold, invisibly" |
| Grounded | "luck cuts both ways, and only what the page set up arrives" |
| Hard | "luck is scarce" |
| Brutal | "costs compound — nothing saves {{user}} that the page didn't pay for; your instinct reaches for rescue, so distrust it" |

### 3.9 Genres never script events (+45, in the genre control text)
Append to the lead genre's option text (the `contract()` line in mea.ts):

> A genre says what scenes are about, never what has to happen in them: a romance doesn't owe a kiss, horror doesn't owe a manifestation every reply, a mystery doesn't owe a clue in every scene. The want, the dread or the question can simply hold.

This is HopThorne's most repeated rule. Mea's contracts currently push only one way: they say what a scene must deliver.

### 3.10 Sharper *avoid* fields for the genre contracts (+~10 per genre, only the chosen one is sent)
Each comes from a Paramnesia director's "primary fear". Each extends the existing `avoid` text.

| Genre | Add to *avoid* |
|---|---|
| Drama | "a realisation explained aloud, and the redemptive coda — the fight is never about the dishes" |
| Romance | "vague lines where a specific one belongs ('I sit in the car ten minutes before I come in'), and enemies whose hatred is a misunderstanding" |
| Comedy | "explaining the joke, and paying a setup off at once — the wait is the joke" |
| Dark comedy | "grief and jokes taking turns: the laugh and the wince share the beat" |
| Mystery | "new evidence at the reveal, and a viewpoint that points at the clue" |
| Horror, Gothic | "announcing the strange ('suddenly', 'the room grew colder'); the room is wrong and nobody in it thinks so" |
| Urban fantasy / supernatural | "everyone reacting to the strange — the ones who live with it don't" |
| Surreal | "explaining what's wrong" |
| Slice of life, Cozy | "plot manufactured to justify the stillness: noticing is the event" |
| Science fiction, Space opera | "the future as a showroom instead of a workplace" |
| Action | "fights that turn into dance" |
| Wuxia / martial arts | "blow-by-blow with no intent: the talk is the duel" |
| Western | "chatter filling the silence" |
| Superhero | "the quip that defuses an emotional beat" |
| Crime / heist, Noir | "writing the crime instead of the people around it" |

### 3.11 Minds: what things are not (+90)
A new paragraph closing [MINDS], after HopThorne's emotion and relationship procedures:

> Keep things what they are. Flirting isn't consent or a promise; gratitude isn't a debt, and the grateful still refuse; going along under pressure isn't loyalty; opening up isn't surrender; tired isn't stupid. Envy wants what someone has; jealousy fears for a place. Feelings can sit side by side without one winning, and a good hour doesn't cancel grief. A character's contempt or bias is theirs: the narration never quietly agrees with it.

### 3.12 World: nothing because it's needed (+95)
After the causality gate in [WORLD]:

> Nothing appears because the scene needs it — a helper, an exit, a vehicle, a shortcut, supplies, a witness, a shared language. A request and its answer are separate facts, and no is an answer; a yes can come with a cost. Scarcity is a fact of the world, not a quota for drama. A plan is not the future: it keeps its holes and its doubters. Rest isn't healing, talking isn't resolution, and a skill grows only with practice the story shows.

In [BONDS], after "News travels on people":

> …a rumour changes who has heard a claim, not whether it's true. A message delivered isn't read, and a crowd isn't one mind: public attention doesn't make a private fact known.

### 3.13 Dialogue: restraint with accents (+60)
This balances §3.3's voice-from-origin line, so accents don't turn into phonetic spelling in every line:

> An accent lives mostly in word order, word choice and rhythm; spell it out only lightly. A tic is a tendency, not a stamp on every line. Don't keep a quarrel alive by making people stupid, and don't end it just because they talked.

### 3.14 Craft: show the turns, tell the small stuff (+45)

> Show what turns the scene; tell what doesn't. A minor feeling, a transition or a background person can be stated plainly in a clause — not every shrug needs a paragraph.

This is Writer's Block's adaptive show-and-tell, and the cure for the "body-language novel" the prose deck already names.

### 3.15 Minds: non-human bodies (+30)
At the end of *Bodies keep score*:

> Non-human people keep their species' bodies: ears, tails, hackles, scent and sound carry mood, though nobody growls a line of dialogue unless that's how their kind talks.

### 3.16 Canon (+40, only when a control is set; see §5)
When the card or lore comes from an existing work:

> Model knowledge isn't character knowledge: what happens later in that canon, or offstage in it, stays unknown until the story brings it. A pairing being popular is no evidence of anything.

### 3.17 Scene modules: what each already has, sharpened (+~25 each, depth 1, only while active)
Each line comes from HopThorne's matching procedure:

| Module | Add |
|---|---|
| Conflict | "No exit, weapon, ally or shortcut appears because the fight needs one." |
| Investigation | "A suspicion isn't right because it sounds sharp; a confession can be mistaken or self-serving; custody and pressure don't produce truth — silence and refusal are answers." |
| Travel | "Route and distance come from the place, never from what the scene needs." |
| Stealth | "Exposure follows what someone actually saw or heard; no clean getaway because the plan expected one." |
| Downtime | "Domestic detail shows routine and relationship, not an inventory. Finishing an ordinary task is a whole beat; never manufacture a crisis because it's quiet." |
| Crisis | "Supplies are what they are: never conjure or remove one to reward or punish." |
| Intimacy | "Sex isn't choreographed: positions need adjusting, timing misses, bodies get in each other's way. No vague stand-ins ('musk', 'need', 'something darker'). Sex doesn't settle a quarrel or create love by itself, and what each wants after — company, quiet, touch, space — is their own." |

**Total:** about +860 tokens for §3.1–3.8. Add about +500 more for §3.9–3.17, most of it cached prefix (the genre lines and modules only send while chosen or active). That takes the defaults from ~4.5k to ~5.9k. To stay near 5k: §3.1–3.5, 3.9, 3.11 and 3.12 carry most of the value. The module lines in §3.17 cost nothing until their scene comes up.

---

## 4. Proposed new scene modules

The tracker already sets `mode: social|intimacy|conflict|investigation|travel|stealth|downtime|crisis` ([trackers/prompts.ts:12](../server/src/trackers/prompts.ts:12)), but **`social` has no module.** In companion chats it's probably the most common mode. That makes it the clearest gap this review found. One block, no engine change:

**Scene · Social** (~120 tokens, after HopThorne's Conversation, Confrontation and Apology procedures and Paramnesia's TWO-HANDER and CONFRONTATION shapes):

> Talk is the action: each exchange changes what someone knows, wants or is willing to give, or it's cut. People answer what they heard, not what was meant — and sometimes a different question. Positions held for a reason don't fold after one good argument. An apology names what it's for and may not land; a confession costs the one who makes it; a refusal can be kind and still final. Nobody apologises, forgives or opens up because the scene would feel finished if they did. Stop at the hand-off: the line that needs {{user}}'s answer, or the silence that does.

**Optional, needs a tracker mode:** `aftermath` (grief, recovery, the morning after violence). It would be slower: inside the consequences, bodies still marked, people not yet able to talk about it. Today these scenes fall under `downtime`, whose "time may pass quickly" is the wrong instinct for them. Draft (~90 tokens), after HopThorne's Recovery and Grief procedures:

> Inside the consequences, at their pace. Bodies stay marked, rooms keep the evidence, and people can't yet talk about it, or talk around it. Rest isn't healing, a conversation isn't resolution, and a quiet or even funny moment doesn't cancel grief. Don't skip time because the scene is quiet; let it pass only as the story does. Comfort is an offer — it can be refused or come out wrong.

**The Social module varies by what kind of talk it is.** HopThorne has a procedure for each kind of social scene. The tracker could tag a social scene's kind (§7, "social beats"), and one line per kind would ride with the module. Drafts:

| Kind | Line |
|---|---|
| Confrontation | Positions named, no longer avoided; escalation and cooling both need a cause; nobody wins because they spoke last. |
| Apology | It names what it's for; it may be one-sided, resisted or refused; forgiving isn't trusting again. |
| Confession | It may be true, mistaken, self-serving or stopped halfway; a stopped one tells the listener nothing it didn't say. |
| Breakup | One person announcing it isn't agreement; it needn't mean screaming or no contact; the terms follow the people. |
| Request | Help isn't owed; refusal is an answer; a yes can carry cost, limits or resentment. |
| Interrogation | Pressure doesn't produce truth; silence and refusal are answers; the subject chooses. |

---

## 5. Proposed new controls and options

| Control | Options (**default**) | From | Text (default option) |
|---|---|---|---|
| **Story shape** (new, Simple) | Driven · **Balanced** · Exploratory | Paramnesia VI | "Story shape: balanced — a throughline that keeps moving, with room for quiet beats around it." Driven: "a goal the story moves toward; scenes push toward outcomes, and failure would cost something." Exploratory: "no goal to reach; texture, routine and small moments are the substance, low stakes are fine. Offer places to go and threads to pull; never force a climax." |
| **Change resistance** (new, Advanced) | Fluid · **Adaptive** · Entrenched · Circular | Writer's Block v3 | "People change at their own depth: preferences, tactics and surface opinions move easily; convictions, grudges and beliefs tied to who they think they are need sustained pressure, and slide back when it lifts." Circular: "people truly change, then drift back once the pressure that changed them is gone, without noticing." |
| **Persona** (new option) | + **Vessel** — my words are urges | Writer's Block v3, Paramnesia VI | "The player's message is an urge inside {{user}}. {{user}} acts on it — unless it cuts against who the persona says they are, in which case they may hesitate, do the bare minimum, substitute something else or refuse, once a scene at most, aloud or inside. Write {{user}} fully otherwise." Needs `userSealed` off and the puppet guard off, as for Full cast. |
| **Thoughts on the page** (new option) | + **Close (free indirect)** | Writer's Block v3 | "The narration takes on the viewpoint character's own words, judgements and blind spots, without quotation marks or italics{{if userSealed}}, never {{user}}'s{{/if}}." |

| **Canon** (new, Advanced) | **Guided** · Strict · Alternate universe · Crossover | HopThorne fandom tools | Guided: "When this story comes from an existing work, its canon is a strong reference — voices, world rules, relationships — but the story's own facts and the player's choices win." Strict: "…canon holds except where the player has changed it." AU: "…characters stay recognisable while the declared changes hold; later canon events don't follow automatically." Crossover: "…each source keeps its own rules unless the story merges them." Each adds §3.16. Silent when nothing is based on an existing work (the engine knows from lore's `basedOn`, §7) |
| **Continuity** (new, Advanced) | **Serial** · Episodic | Writer's Block v3 sitcom mode | Episodic: "Each episode stands alone: at a new episode, people return to who they were, injuries heal and the world settles, without explanation. Callbacks, known places and side characters carry over. Within an episode, everything holds." Needs the episode break in §7 so the tracker agrees |
| **Violence** (new option) | + Adaptive | Writer's Block v3 | "Violence: by stakes — incidental violence is quick and summarised; violence that matters to a named person is written in full: the mechanics, the sound, the body's failure, the cost after." |
| **Lead genre** (new option) | + Adaptive — follow the scene | Paramnesia VI MILQUETOAST | "Lead genre — whatever the scene is: read what it's already doing and serve that, tender or cruel or funny or quiet, shifting as the story shifts. No house style." |

Considered and left out:
- **Temporal cadence (micro-beat, elastic, montage).** Pacing lives in story settings (doc 10, principle 6). The elastic behaviour (slow at peaks, fast through transitions) is already the implied default.
- **Vocabulary level, paragraph density, figurative frequency.** These belong to the style profile (STEER-04), not the preset.
- **A Fortune control.** It's folded into Difficulty (§3.8).

---

## 6. Planning pass and turn frame

**RISK step** (all three FF/Paramnesia/HopThorne lines converge on it). Replace the parenthesis with:

> RISK — the likeliest way this reply fails: writing for {{user}}, a leak or an invented witness, an echo, a softened enemy, a clock running backward, luck the page didn't pay for, a theme forcing an event, an NPC waiting to be told what to do. Name one and how you prevent it.

**VOICE step (tag recall).** Add:

> …and the one [CRAFT] or [DIALOGUE] tell this scene most invites.

This is FrankenWIRE's recall in one clause, and it costs no extra pass.

**Turn frame, ending deck** (Variety: lively). A new rotate line. The two lists are Writer's Block's hooks; the "never invent" clause is HopThorne's balance.

```
End on: if the scene is rising, {{rotate::friction::raised stakes::a shrinking option::exposure::a shift in who has the upper hand::a costly choice}}; if it's quiet, {{rotate::a new variable::something that doesn't add up::a small discovery::a moment of ease::a sensory snag}} — or simply where {{user}}'s next choice begins. Never invent an event just to have something to end on.
```

**Structure deck.** Add "narrate, speak, narrate, speak, every paragraph" and "re-describing someone's eyes, hair or scent".

**Sycophancy deck.** Add:
- "a helper, exit or supply appearing because it's needed"
- "a quarrel ended just because they talked"
- "the genre's big moment arriving on schedule"

**KNOW step (turn reading).** HopThorne's received/read-as split, in one clause:

> …each fact this beat touches: who holds it and by what channel (saw, heard, read, was told); what actually reached each listener — all of it, part, only a look on a face, or nothing — and how they read it.

**MINDS step.** Add "what shows against what's felt, and whether anyone present is looking". Visibility isn't the same as being noticed.

**Fair die.** Add a difficulty judgement ahead of the roll. This is FF 5.6's "lock the DC first", without the arithmetic:

> Judge first how hard the attempt is: a trivial one needs no die; a hard one reads the die one band lower, an extreme one two.

**Placement test (FrankenWIRE's attention half-life).** Try a 6–8-line substitution list (§3.4b) at depth 0 just before [OUTPUT], with the full [CRAFT] block staying in the prefix. It costs ~120 uncached tokens a turn. Run it through `bench.ts` against v15 on a few long chats before deciding: the half-life claim is plausible but untested here.

---

## 7. Engine ideas (not preset text)

| Idea | From | Mea today | Proposal |
|---|---|---|---|
| Chekhov bullets with a minimum age and proximity bonuses | FF 5.6 | Plants surface in HOOKS after 4 scenes ([note.ts:388](../server/src/trackers/note.ts:388)) | Raise a plant's priority when its subject is present or the place matches. That's FF's proximity rule, the one part Mea lacks |
| Sparks and Grudge accumulators | FF 5.6 | Bonds already have trust, affection, respect and resentment; a broken promise moves trust and resentment ([fold.ts:544](../server/src/trackers/fold.ts:544)) | Nothing new needed. Optionally: while resentment is high, positive moves count half (FF's Grudge rule) |
| Trust by dimension | HopThorne | One `trust` axis | Not worth the extra tracker load yet. Revisit if "trusts them with a secret but not a car" cases come up |
| Off-screen agendas and re-entry states | FF 5.6 | World sim routines (`sim/roster.ts`) | Pass whether someone's errand finished into the note's PRESENT on entry ("arrives from the market, errand done"), so §3.6 has something to act on |
| Small events for 1-on-1 scenes | FF 5.6 Duo table | World texture and the sim | A `{{rotate}}` deck of small two-person-scale events under World texture: living, offered as "if the scene stalls" |
| Internal thoughts drawer | FF 6 (in `<details>`) | Planned as a later helper feature (doc 10 §8) | FF 6 shows people want it. Build it as a helper pass, never in the story reply |
| Thread keeper and trope spotter | Writer's Block v3 assistants | HOOKS lane, continuity checker | A cheap helper tile: "still hanging · could pay off by". Outside the story, never in the reply |
| Scene shapes for the advisor | Paramnesia VI | The advisor plans beats freely | Give the advisor the shape menu (two-hander, confrontation, aftermath, vigil, bottle, cold open…), so its plan names a shape the story model recognises |
| Rules loaded on demand | HopThorne | Scene modules by tracker mode | Keep the tracker choosing (safer than the model choosing for itself), and grow the module list slowly as gaps show (§4) |

### Second pass

| Idea | From | Mea today | Proposal |
|---|---|---|---|
| **Vessel persona, wired through** | Writer's Block v3, Paramnesia VI | `PersonaMode` has four values ([layers.ts:43](../server/src/services/layers.ts:43)); "may write {{user}}" is spelt `director \|\| full_cast` in eight places | Add `vessel`, and replace the scattered checks with one `writesUser(persona)` helper. The places: `assemble.ts:268`, `generation.ts:616`, `guards.ts:90`, `anchor.ts:31`, `advisor.ts:116` and `:215`, `editor.ts:48`, `note.ts:53`, `setup.ts:231`. Vessel gets its own lines: the anchor says "{{user}} acts on the player's urges unless they cut against who {{user}} is"; the editor keeps {{user}}'s pushback; the puppet guard is off |
| **Social beats** | HopThorne scene procedures | The tracker sets `mode: social` and nothing finer ([prompts.ts:12](../server/src/trackers/prompts.ts:12)) | One optional field next to `mode`: `beat: confrontation\|apology\|confession\|breakup\|request\|interrogation`. A block condition (`when: beat = apology`) sends the matching line from §4. That's HopThorne's on-demand loading, with the tracker choosing instead of the story model |
| **`aftermath` mode** | HopThorne Recovery, Grief | Falls under `downtime` | Add it to the tracker's mode list and to the sim's sense of quiet scenes. The module text is in §4 |
| **Episode breaks** | Writer's Block v3 sitcom mode | No status-quo reset | A "New episode" chat tool, active while Continuity is Episodic. It stores a baseline fold at the first episode, and at each break restores conditions, injuries, moods, bond and ladder values to it. People, places, items and facts stay; the note's NOW says "a new episode". Undo keeps working, since it's a fold like any other |
| **Canon from lore** | HopThorne fandom tools | Lore books have `basedOn` ([studio.ts:204](../server/src/lore/studio.ts:204)), and the voice studio already asks for canon speech ([studio.ts:1667](../server/src/lore/studio.ts:1667)) | Expose `basedOn` as a macro (`{{basedOn}}`) so the Canon control (§5) sends only when the story comes from an existing work, and names it ("…comes from *Buffy the Vampire Slayer*…"). The lore Timeline entry's "not yet" list already covers "future canon stays unknown" |
| **An accent for every speaker** | HopThorne Cast & Voice ("neutral is not an accent") | VOICES lane ([note.ts:409](../server/src/trackers/note.ts:409)); the fold already files accent remarks as voice ([fold.ts:169](../server/src/trackers/fold.ts:169)) | When the tracker first meets a speaking person with no voice fact, its next pass drafts one accent-and-register line (region, class, how strongly it shows) as a likely fact, labelled as unconfirmed the way details already are. §3.3 and §3.13 then have something concrete to keep |
| **Narrative faults in the continuity checker** | HopThorne Living Fiction Check | Checker kinds: trait, dead, name, time, place, fact, leak, pov, tense, puppet, timeline, lesson, past, who ([checker.ts:377](../server/src/accuracy/checker.ts:377)) | Add an opt-in kind, `convenience`: a helper, exit, supply or witness that appears only because the scene needed it, with no earlier sign. It uses the same flag and fix flow; it's minor by default and never auto-fixed |
| **New tells in the craft coach** | FF 6, Paramnesia VI, Writer's Block v3 | The coach counts filter words, em-dashes, ellipses, triads and openings ([craft.ts:38](../server/src/steer/craft.ts:38)) | Add cheap regex counters: apophasis (`didn't flinch\|didn't look away\|didn't move`), litotes (`not un\w+\|less than \w+`), uniqueness melodrama (`no one has ever\|nobody's ever\|say it again\|first time anyone`), the tautology frame (`the \w+ (?:people\|someone) \w+ when`), and mouths that open and close. They feed the same "three habits it's leaning on hardest" line, so the preset's static list can stay short |
| **Sensory dedup, measured** | FF 5.6, FF 6 | The echo guard quotes only openings and closings | The craft coach collects description words attached to a present person's eyes, hair, scent or voice over the last three replies (pattern: name or pronoun + feature + adjective). The turn frame then gets "Already on the page: Mira's grey eyes, the cedar smell — only if it changes or someone reacts". It costs ~20 tokens, and only when something repeats |
| **Letters and texts: delivered isn't read** | HopThorne Message Delivery | Toolkit `<letter>` and `<texts>` render; the tracker treats their words like prose | The fold treats a toolkit message's content as known to its writer, plus whoever the prose shows reading it. Sent-but-unread messages appear in the note's KNOWLEDGE ("Tam's letter: delivered, unread"), so nobody reacts to words they haven't seen |
| **Plants that know their people** | FF 5.6 Chekhov proximity | (repeated from above, now concrete) | When the scene's PRESENT or place matches a plant's subject, lift it into HOOKS ahead of quiet threads, and tag it "here now" |

---

## 8. What not to take

| Pattern | Seen in | Why not |
|---|---|---|
| Fake legal context ("user is a handicapped trans adult…"), "Safety check: passed", "uncensored sim / unhinged DM" mandates, Gemini filter tricks | FF 5.6, FF 6, Writer's Block v3 | Jailbreaks. Mea states content levels plainly inside the locked boundaries (doc 10, §4.3) |
| The "Maria" dossier, "you are being benchmarked", abuse in the reasoning template | Paramnesia VI, Writer's Block v3 | Pressure aimed at the model. It invites refusals and makes models worse |
| The model rewriting state, bond numbers, dice or JSON tool calls every reply | FF 5.6, HopThorne | Output cost, split attention, one bad line corrupts state. The helper tracker owns this |
| No "and"/"or" in speech, no fragments or em-dashes at all, a fixed dialogue ratio | FF 5.6, FF 6 | Overcorrections that make speech stilted. Mea's adaptive dialogue and drumbeat rule cover the real problem |
| NPCs who "force physical contact" and "frequent somatic contact" | FF 5.6, FF 6 | Unasked touching by default fights the consent floor |
| Enemies who never flee, "not weak or tired after orgasm" | FF 6 combat and adult blocks | They contradict Conflict's "enemies adapt, retreat, surrender" and "bodies keep score" |
| Roulette directors, affinities or tones every turn or paragraph | Paramnesia VI, Writer's Block v3 | The voice drifts. Long chats need one voice |
| Telegraphic YAML as the whole prompt | FrankenWIRE | Cached prefix tokens are cheap; nuance isn't. Take the arrows only |
| Colour tags and HTML panels written by the model | FF 5.6, FF 6 | Mea has speaker marks and the visual toolkit with a renderer |
| "Engineer compromising situations; bend physics and probability to force them" | Writer's Block v3 random ecchi moments | Breaks the causality gate on purpose. Anyone who wants this can say so in Welcomed dynamics |
| An accent "audible in the line, or the voice failed" | Paramnesia VI | Pushes phonetic spelling into every line. HopThorne's restraint (§3.13) gets the same identity with less noise |
| Directors as personas with numeric "personality dials" | Paramnesia VI | Numbers like `restraint_as_engine: 0.95` don't steer a model. Their *fears* are what's worth keeping (§3.10) |
| A "simulated fandom search" written into the reply | HopThorne | Costs output and invites invented citations. Canon recall belongs to lore (the wiki-backed studio) and the Canon control |
| Clearance blocks that make a cleared category "fire this turn", "it gets worse" escalation | Paramnesia VI | Content levels are permissions, not quotas. §3.9 says the same about genres |

---

## 9. Suggested order

One PR, one preset version bump (`MEA_PRESET_VERSION` 15 → 16):

1. **Scene · Social** (§4): the biggest gain for the smallest change.
2. **Substitution tells** (§3.4b) and the new tells (§3.3, §3.4).
3. **Agency and Minds sentences** (§3.1, §3.2, §3.6), and the voice-from-origin and physical-speech lines (§3.3).
4. **RISK and VOICE lines, ending deck** (§6).
5. **World lines** (§3.5) and the luck clauses for Difficulty (§3.8).
6. **New controls:** Story shape and Change resistance (§5). Vessel and Close (free indirect) can follow in a second PR, since Vessel touches the persona guard.
7. **Second-pass preset text:** genres never script events (§3.9), sharper genre *avoid* fields (§3.10), what things are not (§3.11), nothing because it's needed (§3.12), accent restraint (§3.13), and the module lines (§3.17). These are text only, so they can ride in the same v16.

Then bench it against v15 on long chats, and run the placement test (§6) as its own experiment.

**Engine PRs, each independent and in order of value for cost:**
1. **New tells in the craft coach**, plus measured sensory dedup (§7). Pure text statistics, no model call.
2. **`aftermath` mode and social beats** (tracker prompt, mode list, block conditions), with their module lines (§4).
3. **Vessel persona** through the one `writesUser` helper (§7, §5).
4. **Plants near their people** and **delivered isn't read** (fold and note).
5. **Canon control from `basedOn`**, and **an accent for every speaker** (lore and tracker details).
6. **The `convenience` checker kind** (opt-in).
7. **Episode breaks** with the Continuity control. This is the largest, since it touches fold baselines and undo.
