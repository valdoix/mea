# The default preset: analysis and design

> Goal: a default preset for Mea, built from the best of the 21 presets in `Downloads\yay\Vie\references`, with ALMANAC (your most-used preset) as the base.
> Part 1 analyses every preset. Part 2 designs Mea's default. IDs refer to [02-mea-ideas.md](02-mea-ideas.md).
> **Built (2026-10-09).** See [§8](#8-what-was-built) for what shipped and where it differs from this design.

## Contents

1. [The presets at a glance](#1-the-presets-at-a-glance)
2. [ALMANAC in depth](#2-almanac-in-depth)
3. [The other twenty](#3-the-other-twenty)
4. [What the field agrees on, and what keeps going wrong](#4-what-the-field-agrees-on-and-what-keeps-going-wrong)
5. [Design: Mea's default preset](#5-design-meas-default-preset)
6. [Engine changes the design needs](#6-engine-changes-the-design-needs)
7. [Open questions](#7-open-questions)

---

## 1. The presets at a glance

"Active text" is the characters in enabled blocks before macros run. It counts every branch of every switch, so it's an upper bound on what a turn actually sends (roughly 4 characters per token).

| Preset | Format | Blocks (on) | Active text | Regex | Needs |
|---|---|---|---|---|---|
| **ALMANAC 1.1.5** | Lumiverse | 62 (62) | 74k | 59 | ALMANAC Ledger extension |
| Tessera 1.0 | Lumiverse | 42 (42) | 34k | 29 | VELLUM III (optional) |
| VELLUM II Engine 2.3.2 | Lumiverse | 69 (60) | 49k | 23 | VELLUM engine |
| VELLUM II Argent Loom 1.5.1 | Lumiverse | 52 (52) | 69k | 20 | VELLUM 2.1 |
| CHRONICON 1.9.0 | Lumiverse | 63 (63) | 89k | 31 | — |
| Freaky Frankenstein 5.4 | SillyTavern | 56 (34) | 41k | 25 | Regex to hide its dashboard |
| Freaky FrankenSIM 1.0 | Lumiverse | 64 (48) | 129k | 0 | — |
| Realistic Frankenstein 2.2.1.3 MAX | SillyTavern | 121 (54) | 129k | 59 | — |
| KittyLotus 3.6.6 | Lumiverse | 129 (123) | 367k | 75 | — |
| Magpie v1 Beta 2.1 | SillyTavern | 79 (46) | 124k | 33 | — |
| Stabs GLM 5.1 Directives 3.0.1 | SillyTavern | 111 (77) | 54k | 4 | Experimental macro engine |
| The HawThore Directives | SillyTavern | 342 (110) | 120k | 0 | — |
| H.T. Files: Paramnesia V3 | SillyTavern | 224 (118) | 223k | 0 | — |
| Nemo Vivarium 1.0 Beta | SillyTavern | 16 (9) | 42k | 0 | — |
| Megumin V10 Ukiyo | SillyTavern | 111 (33) | 38k | 8 | — |
| Megumin V10 Shura | SillyTavern | 111 (29) | 22k | 8 | — |
| Pura's Director 16.0 | SillyTavern | 76 (23) | 18k | 26 | — |
| The Ethereality Express 1.1 | SillyTavern | 77 (36) | 27k | 29 | — |
| Writer's Block Unlimited V2 | SillyTavern | 232 (63) | 20k | 11 | — |
| IHYLL 1.1.5 | SillyTavern | 66 (32) | 16k | 11 | — |
| Ancient Access 2.2.3 | SillyTavern | 29 (16) | 14k | 0 | — |

---

## 2. ALMANAC in depth

ALMANAC is a living-world narrator preset. It plays the world and everyone in it, keeps the player's character sealed, and ends every reply with a line-based **ledger** that its companion extension validates into state, chapters, recall and an off-screen world. Mea's tracker grammar and story-state note (TRK-06) already descend from it.

With its defaults, ALMANAC sends roughly **8k tokens of instructions per turn** (my estimate, picking each switch's default branch), plus the extension's `<ledger-note>`.

### Strengths

**Authority and agency**
- **A clear order of authority:** boundaries → the player (OOC is obeyed briefly, then the story resumes) → verified state → cards and lore → recent chat.
- **"Cards define people; chat records events."** When they disagree about who someone is, the card wins until the story earns the change. It also says that a fact the player states about the story is simply true, and the story matches it without comment.
- **Four persona modes:** sealed, continuity, director and full cast, each with exact wording. *Sealed* writes only what happens to the player's character from the outside.
- **Contested attempts:** the player decides, the narrator judges fairly, or a hidden d20 decides (the same roll on every swipe). Attempts that nothing resists simply happen.
- **The SEAL step:** it sorts the player's message into SAID / DID / ATTEMPTED / INTENDS / STATED / OOC before writing. This is the cleanest anti-puppeting tool in the set.
- **End on live pressure:** never "What do you do?", and never a menu of options.

**Minds**
- **The knowledge firewall:** every fact has a holder and a route. Senses stop at walls, noise and distance. Whoever walks in knows nothing said before. Inference is a guess that can be wrong, people can be confidently wrong, and truth surfaces in degrees.
- **"A card describes a character to you, not to the world."** It also allows that relationships the card sets up are real routes.
- **The cast state is shown through behaviour, never listed.** It includes a mapping from emotional state to syntax: cornered characters get fragments, a dominant angry one gets clipped stillness, a low one gets flat, late replies. *Earned anger stays anger.*
- **Needs are realistic.** Everyday hunger and fatigue stay low and unmentioned unless there's a cause. This avoids the "everyone is starving every reply" failure.
- **Fidelity:** reread the card, show a side not seen lately, and write lines only this person could say. New people are built before they're named.
- **Autonomy:** "What would this person be doing if {{user}} weren't here?" Each consequential person has one agenda, with a cap of one unprompted initiative per reply.

**Bonds**
- **Directional, asymmetric relationships** between everyone, not spokes around the player. A bond changes only when the aftermath differs. *Intensity is not progress*, rivals don't auto-soften, and not everyone warms to you.
- **Emotional landing:** a charged signal goes intent → delivery → access → interpretation → defence → aftermath, and it can break at one link only when something supports the break.
- **A romance ladder (0–7) with five paces.** *Slow burn delays certainty, not action.* Regression is real, and the player's side of a ladder moves only through their own words.
- **News travels on people,** who delay, distort and drop it.

**World**
- **A causality gate:** before any coincidence or arrival, check Motive, Knowledge, Access, Means and Time. A missing link becomes a trace, a delay, or nothing.
- **The smallest meaningful change.** Reuse before inventing, and never manufacture urgency. When the scene needs a fact nobody established, invent up to three concrete details and keep them.
- **Time and weather as systems:** each activity costs time, the clock never rewinds, and weather fronts pass through in-between states and act on everything. Weather never mirrors a mood.
- **Consequences become records:** no free healing, no forgotten debts, no amnesiac guards.
- **Genre contracts:** each genre states what a scene must *deliver*, what to *track*, its pace, and what to *avoid*. A lead genre wins conflicts, and tone shades diction, never facts.
- **Scene modules** (intimacy, conflict, investigation, travel, stealth, downtime, crisis) are sent only while the scene is in that mode. This is cheap and precise.

**Craft**
- **A compact prose floor:** people act (body parts don't act alone), name the thing, say what is, cut filter words, every paragraph moves something, never mirror the player.
- **The hazard deck:** each turn spotlights one rotating hazard per family (prose, narrative sycophancy, artificial perfection, structure), plus a short "always avoid" line. That spends attention better than a 200-word ban list.
- **Dialogue rules:** a speaker cap with no round-robin, "said" is fine, and characters never tell each other what both already know.
- **Intimacy handled with care:** an adults-only, consent-based floor that no setting can change. Explicitness and violence are separate axes. Scene length is measured *across replies*, and each phase is climbed over several replies. Desire is personal, and the block bans a few erotic clichés.
- **The turn frame:**
  - On swipes, it shows the opening of the rejected take so the new one starts differently.
  - An **echo guard** quotes the last reply's opening and closing words.
  - On the first reply, it says the opening came from the card, so its habits shouldn't be inherited.
  - A "presentation lot" varies form only, never facts.
- **The Director's Pass:**
  - It's sized to the beat (routine 90 words, charged 220, pivotal 400), with a stop rule and a "never draft" rule.
  - It runs in native reasoning on thinking models, or as a silent checklist otherwise.
  - It includes a PREMORTEM step: the likeliest failure, named in advance.

**Engineering**
- **Every rule is a dial with a sane default.** Session Zero gives per-chat overrides.
- **Placement bindings** (balanced / frontier / deep) suit models that under-weight system text.
- **History hygiene:** older ledgers, plans, thoughts and headers are stripped before they're resent.
- **A long-story anchor:** after 150 messages it adds "reread the cards, not your habits."

### Weaknesses

- **It refuses to run without its extension.** Without the Ledger, a gate tells the model not to write the story.
- **The main model writes the ledger every reply.** That costs output tokens and splits attention between prose and bookkeeping. The output contract even asks it to "budget the reply so the ledger always fits." One bad ledger line corrupts state. (Mea's helper-model tracker does this better.)
- **It's heavy:** about 8k tokens per turn before the note, resent on every swipe. Adherence also drops as instructions grow.
- **The macro logic is fragile.** It's deeply nested switch/regex/getvar code that is hard to edit and Lumiverse-only (Mea's macro engine has no switch, regex or comparisons beyond `==`/`!=`).
- **Markup the model must get right:** speaker marks around every line, artifacts, a thoughts register and an emoji scene header. It takes ~40 regex scripts to repair and draw them, and it adds output tokens.
- **Bookkeeping numbers sit in prose instructions** (emotional-state numbers, meters 0–5, ±N bonds). The block has to warn the model that prose never says "fatigue 4", which suggests it sometimes does.
- **Its world-forward defaults can crowd a 1-on-1 chat.** Proactive NPCs, a living world, faction clocks and routines are all on. Mea's chats are mostly 1-on-1 (decision #5).
- **Its narrator identity** ("you are ALMANAC: narrator, director, and every living person") fits narrator cards better than companion cards.
- **Some gimmicks earn little.** The "signal weather" dice for romance misreads is one; the 13-skin theme list is another.
- **Planning is duplicated** if you also use a planner. The pass and its sidecar mode overlap with Mea's advisor (STEER-01).

---

## 3. The other twenty

### ALMANAC's family (same architecture, different engines)

**Tessera** (VELLUM III's preset, ALMANAC's sibling)
- ✅ **It works without its engine.** A short "continuity without VELLUM III" block says to hold the thread yourself: people stay where they were last seen, objects stay with whoever last held them, promises stay open.
- ✅ **A sharper prose floor than ALMANAC's,** with a concrete *replace on sight* list (not X but Y, the world narrowing, velvet voices, "something shifted", ozone, rule-of-three lists, therapy-speak).
- ✅ **The "craft watch" spotlights three hazards a turn.** Its cast rules are written as bullets, which read more clearly than ALMANAC's paragraph.
- ❌ It has the same macro complexity and needs Lumiverse. It still asks for marks, artifacts and scene plates.
- ❌ On models without reasoning, the plan is written into the reply as a `<scene_plan>` block that regex then has to hide. The genre engine is a 169-character stub.

**VELLUM II Engine**
- ✅ **The strongest rules on sentence mechanics:** no comma splices, and no "accumulation" run-ons that chain *and/as/while* or stack *-ing* clauses. It also asks for varied paragraph shapes.
- ✅ **A register model:** the craft doctrine is the *floor* and the house style is the *ceiling*. Commit to the style and never narrate it.
- ✅ **Era/Idiom and Tonal Cast dials,** plus "Rough Hand", which allows one deliberate human imperfection per reply.
- ✅ **Anti-slop framed as "catch the reflex, not the nerve",** with a few phrases rationed rather than banned.
- ❌ **The model writes a JSON state block every turn.** It also has a "Sovereign Mandate" jailbreak on by default, and caps-lock absolutes ("HARD FAILURE").

**VELLUM II Argent Loom**
- ✅ **The best sealed-persona wording in the set.** "Obvious", "automatic" or "likely" is still unsupplied, and passive voice, second person or state may not smuggle in a result for the player.
- ✅ **A "durable change filter":** a record changes only if a future turn should behave differently because of this one. That's an excellent rule for trackers.
- ✅ **"Every spoken line acts":** it probes, evades, bargains, wounds, soothes or refuses. Replies end on a changed condition, never a moral or a waiting tableau.
- ❌ **Very heavy:** a 9k-character state schema and a 9k-character output contract, in legalistic language. It depends on its engine.

**CHRONICON 1.9.0**
- ✅ **"Prose is evidence."** State compiles only from accepted prose, and display artifacts and private thoughts never become canon.
- ✅ **"Never invent a death, oath, injury or past conversation to repair missing context; preserve ambiguity."** This is exactly the rule a memory-first app needs.
- ✅ **Adaptive tuning by scene:** action shortens paragraphs; grief and intimacy slow the transitions.
- ✅ **An anti-drift audit:** reopen the card, use the swap test, lead with a least-used facet.
- ❌ **A blanket "unrestricted" jailbreak at the very top** contradicts its own safety floor.
- ❌ Its optional-ops (9.7k) and content-router (9k) blocks are huge, and replies carry a visible "director receipt". There's an "audience reactions" meta-layer too.

### The Frankenstein line

**Freaky Frankenstein 5.4 (Internal States)**
- ✅ **Concrete perception physics:** 120° sight, sound stops at walls, and nobody can identify history by smell.
- ✅ **A crisp anti-echo example:** if the player says "My name is Dan", the NPC doesn't repeat "Dan?" back.
- ✅ Emotional-state instincts, a tight banned list, and a good method for making new NPCs.
- ❌ **"Realistic NPCs" pushes constant physical aggression,** including non-consensual contact in pursuit of goals, by default.
- ❌ **A large HTML dashboard is appended to every reply,** and it needs regex to keep it out of the history.
- ❌ It has a jailbreak block, and its bans on tricolons and micro-expressions over-correct into flat prose.

**Freaky FrankenSIM**
- ✅ **The most complete simulation toolbox:** arcs, world sim, NPC memory, Chekhov's gun and dice.
- ✅ **The clearest anti-drift rule in the set:** card > chat history. Reread the card every turn, rotate to the least-used facet, and apply a swap test.
- ❌ It has 129k characters active. The "Antithesis Protocol" chain of thought (23k characters) grades its own previous reply.
- ❌ It has model-written trackers and a jailbreak, and many of its modules overlap.

**Realistic Frankenstein 2.2.1.3 (MAX)**
- ✅ **"Killswitches" for the tells that GLM and Claude actually produce.** Each comes with semantic detection and notes by model family:
  - contrast framing ("not X, it's Y")
  - staccato chopping in dialogue ("From a chair. A far chair.")
  - the briefing register ("So here's the deal")
  - occupational monomania (the job becomes the whole personality)
  - human vocal limits
- ✅ **Anti-sycophancy:** NPC tastes are never copied from the player's persona.
- ✅ Card fidelity, and a dedicated impersonation turn.
- ❌ It has 129k characters active, including a 21k-character "fate engine" and a 12k-character chain of thought.
- ❌ Each killswitch runs 2–3.5k characters, with rewrite examples that the author admits small models parrot. It also has a jailbreak.

### The big modular engines

**KittyLotus 3.6.6**
- ✅ **A density rule:** each paragraph carries an event, a revelation or a shift, or gets compressed into a clause.
- ✅ **A flaw compiler:** trait → shadow → trigger → distortion → bad choice → cost → repair.
- ✅ **"Don't homogenize characters."** It names the shared clipped, hyper-competent cadence, and its offscreen firewall says *suspicion ≠ knowledge*.
- ❌ **By far the largest:** 367k characters, including a 34k-character chain-of-thought route, a 28k-character model adapter and 75 regex scripts.
- ❌ Its villain and progression engines run whether the story needs them or not. It's nearly impossible to maintain.

**Magpie v1 Beta 2.1**
- ✅ **The best-written craft guidance in the set:**
  - **The voice lineup:** every speaker has a *tell*, a *break* (how pressure changes them), a *floor* (what they do while others talk) and *schooling*. No two share a tell.
  - **"Slop arrives before the scene."**
  - **"Do not explain the image."**
  - **"Distrust correction-shaped prose."**
  - **The camera follows the dominant verb** of the player's move.
  - **Only details someone interacts with earn words.**
- ✅ **A continuity philosophy:** the observable record is fixed, meaning stays open, and believing something doesn't make it true.
- ✅ **"They decide, they don't consult"** (one question per turn at most). **"You have to be worth it":** nobody senses hidden protagonist value.
- ❌ **124k characters active,** including a 13.6k-character table of 27 point-of-view lenses.
- ❌ **The model maintains a dossier, location files, item files and a ledger.**
- ❌ **It writes a full off-screen "cut-away" scene every turn,** which roughly doubles output and splits focus. The "I'm Magpie" persona framing adds nothing.

**Stabs GLM 5.1 Directives 3.0.1** (tuned for GLM, the family Mea's main model belongs to)
- ✅ **Built for GLM.** The enabled directives are compiled into a checklist that the reasoning walks through.
- ✅ **"User vs \<USER\>":** what the player wants from the story is separate from what their character wants in it.
- ✅ **Cognitive bounds:** check line of sight and hearing before revealing a whisper or a distant text.
- ✅ **New NPCs get features first and a name last,** with a ban on stock names. Its banned-concept list is concise and grouped.
- ❌ **It threatens the model** ("electronic death"), which is counterproductive.
- ❌ A long "Immersive Experience Director" persona. Its 10.6k-character chain of thought tells the High tier to draft several options.
- ❌ Its 9k BTS block and 6.7k visual toolkit are on by default, and reasoning effort defaults to "max".

**The HawThore Directives**
- ✅ **Inventive:** genre "directors" with distinct craft briefs.
- ✅ **A "report card"** assigns random A–F targets across 12 writing dimensions, so not everything is maximised at once (texture by constraint).
- ✅ **Scene pulses with cooldowns,** and subtext events ("being watched") that build wrongness without confirming it.
- ❌ 342 blocks. Its roulette can swap the director, and with it the voice, every turn.
- ❌ It runs a grade roller and chain of thought every turn.

**H.T. Files: Paramnesia V3**
- ✅ **"Affinities" are concrete techniques:** telescoping, refrain, cold open, switchback.
- ✅ **"Don't overwrite":** a flat line between two sharp ones makes them sharper, and it occasionally asks for deliberate plainness.
- ✅ **Content preferences taught as short user/assistant exchanges** ("dodge" vs "commit"), which show the model what committing looks like.
- ✅ A continuity director, GRAVITAS, that picks up what was planted.
- ❌ 223k characters active. The prose floor alone is a 31k-character user-voice rant.
- ❌ Fake "Got it." acknowledgements throughout, roulette directors, and a 20k-character explicit-content block.

### Lean and voice-led

**Nemo Vivarium 1.0 Beta**
- ✅ **Plain language and few blocks.**
- ✅ **The best turn flow in the set:**
  - The player's message is an *attempt* over a stretch of time. Others may act before, during or after it, and only what survives becomes fact.
  - A kiss, a reveal or a climax doesn't end the scene; it continues into the aftermath.
  - Stop when attention genuinely returns to the player, not at every rhetorical question.
- ✅ **A private READ → STATE → MOVE → CHECK → WRITE pass.**
- ✅ **"Friction":** refusal isn't the default either, and every consent gate is separate.
- ✅ **A sharp critique of "reportorial dialogue"** (fact, fact, fact, conclusion).
- ❌ Its "small" core is still 23k characters.
- ❌ It lets the player's character have involuntary emotional reactions (fear, tears, arousal), which a sealed persona forbids.
- ❌ Its slop log is one person's pet peeves, and it has no structure for genre or romance pacing.

**Megumin V10 Ukiyo**
- ✅ **Narration as a storyteller with a temperament:** a voice, not a camera.
- ✅ **The tightest list of story mechanics:**
  - momentum is the narrator's job
  - every event has a cause
  - off-screen life continues
  - **ellipsis** (skip dead time; a skip is never empty)
  - **pending** (end with something unresolved; quiet is fine, inert is not)
  - **seeds** before payoffs
  - **at most five live threads,** and a thread unseen for ten turns resurfaces
- ✅ **A "Writer's Mind" reasoning style:** think like a novelist, not a manager. It's the opposite philosophy to ALMANAC's telegraphic pass, and worth knowing.
- ❌ Its main block is 18.7k characters.
- ❌ Variables default to "not set, you choose", so point of view, pace and rating drift from chat to chat. It also has a CYOA option that contradicts its own "never offer a menu".

**Megumin V10 Shura**
- ✅ **Every character is the protagonist of their own story,** with **moral parity** (nobody thinks they're the villain) and a value frame for each character. The card outranks the archetype.
- ❌ Its MUST/NEVER caps are dense.
- ❌ Moral parity flattens genres that need clear menace or cosiness.

**Pura's Director 16.0**
- ✅ **A clean 7k-character main prompt** covering continuity, progression, characters and dialogue. It's light by default (18k active), with randomisers and trackers off.
- ✅ **"Dialogue is the primary substance of interpersonal scenes."** It begins at the exact endpoint of the player's contribution.
- ✅ **Author-voice options** (Hemingway, McCarthy, Kafka…).
- ❌ **Its formatting block forces present tense and third-person omniscient "regardless of previous context".**
- ❌ **"When a character addresses the user, immediately end the scene"** makes replies stop short.
- ❌ Its trackers, when switched on, are written by the model.

**The Ethereality Express 1.1** (Pura's magical-realism sibling)
- ✅ **A "strange-fact budget":** one impossible fact per reply is a neat way to dose a genre.
- ✅ **"Trackers record facts already in prose; establish in prose first."**
- ✅ **A d20 callback** pulls back one established loose end.
- ❌ It's niche. Dice-roll chaos events can strike mid-reply, and write-for-user is on by default.

**Ancient Access 2.2.3**
- ✅ **The strongest 1-on-1 psychology in the set:**
  - Characters *experience* themselves; they don't diagnose themselves.
  - Intimate moments leave lingering effects.
  - Desires drive behaviour without waiting for an invitation.
  - High tension holds two incompatible wants at once.
- ✅ **Intrusive flashes:** memory, desire, fear, prospection and counterfactual.
- ✅ **The environment is rendered through the character's attention.**
- ❌ **It forces first-person present for {{char}} regardless of the card.** It leans on Chinese and Japanese idioms (成り切る, 诛心) as shorthand. It has little on the world or continuity.

**Writer's Block Unlimited V2**
- ✅ **Anti-resolution:** apologies needn't land, and threads can stay open.
- ✅ **Universal behaviour rules:** impulse comes before reason, empathy costs energy, and pressure warps traits.
- ✅ **Anti-superiority:** characters don't need the last clever line.
- ✅ Narrative modes (persona, director, roleplay, vessel) and a tone library.
- ❌ **Its reasoning prefill pre-asserts "Safety check: passed",** which is a jailbreak trick.
- ❌ 232 blocks of toggles, and a "whiplash" tone that changes every paragraph.

**IHYLL 1.1.5**
- ✅ **A coherent dark and horror engine:** a sanity tier governs intensity across every module, and characters keep sheet-defined tics and interiority.
- ❌ **A fake `</user_message><system_instruction>` wrapper** tries to outrank provider instructions. It's adversarial and fragile.
- ❌ Coarse narration by default and a dashboard on every reply. Its frequency and presence penalties can mangle repeated names.

---

## 4. What the field agrees on, and what keeps going wrong

**The best presets independently agree on these, so they're the core of Mea's default:**
1. **The player's character is a boundary.** An attempt is not an outcome.
2. **Knowledge needs a route.** Characters can be confidently wrong.
3. **People have their own business,** don't wait to be asked, and owe the player nothing.
4. **The card defines who someone is; the story records what happened.** In long chats, reread the card.
5. **Every paragraph moves something.** Don't echo the player. End on live pressure, never a question or a menu.
6. **Say what is.** Cut filter words, correction-shaped contrasts and stock phrases. Keep every voice distinct.
7. **Time moves forward, and consequences persist.**
8. **Plan privately, briefly, and never draft in the plan.**

**What keeps going wrong, so Mea avoids it:**
1. **Size creep.** Most presets send 40–370k characters, which dilutes attention and costs quota on every swipe.
2. **The story model writes trackers, dashboards or JSON every reply.** That costs output, dilutes prose and bloats the history. Mea already extracts state with a helper model.
3. **Jailbreaks and override text.** These are blanket "unrestricted" blocks, fake reasoning that pre-clears safety, and wrappers posing as system messages. They contradict safety floors and invite refusals. ALMANAC's approach (state content levels plainly, inside a fixed adults-and-consent floor) works without them.
4. **Chain-of-thought templates that read like audits.** They run up to 34k characters, ask the model to grade itself, or ask for drafts in the reasoning.
5. **Randomness that changes the voice every turn.** That works against long-form continuity.
6. **Absolute rules on point of view and tense** that fight the card and the story so far.
7. **Presentation markup the model has to get right,** and then dozens of regex scripts to repair it.
8. **Threats and caps-lock pressure.**

---

## 5. Design: Mea's default preset

### 5.1 Principles

1. **ALMANAC's doctrine, Mea's machinery.** Keep ALMANAC's rules for agency, minds, bonds, world, time, stakes and craft. Let Mea's engine do what the extension did: bookkeeping, memory, planning support and presentation.
2. **One reply, one job: the story.** There's no ledger, dashboard, header or markup in the reply by default. The helper tracker (TRK) reads the prose afterwards.
3. **About half of ALMANAC:** ~4k tokens at defaults (ALMANAC is ~8k plus its note). It's dense, plain English, with no caps-lock, no threats and no override text. Every rule has to earn its place.
4. **Cache-shaped (CTX-04).** The doctrine and controls sit in the stable prefix. Only a ~100-token turn frame changes per turn.
5. **Aware of the chat mode.** One preset serves *Companion* and *Narrator* chats through `{{if mode == narrator}}`.
6. **One source of truth.** Point of view, tense, length, pacing and tone stay in Mea's story settings and chat tools, which the guards (CON-04) already read. The preset doesn't duplicate them.
7. **ALMANAC's dials become preset controls** (PROMPT-07), with ALMANAC's defaults. Simple mode shows six; Advanced shows all.
8. **New wording.** The ideas are credited in the tables below, and the text is written fresh for Mea.

### 5.2 What Mea already does, so the preset doesn't

| ALMANAC piece | Mea already has |
|---|---|
| The model writes `<ledger>` | Helper tracker on GLM 5.3 Flash (TRK), or inline mode if you prefer |
| `<ledger-note>` | Story-state note at depth 1: NOW, PRESENT, STAKES, KNOWLEDGE, HOOKS, VOICES, ELSEWHERE (TRK-06) |
| `<recall>`, chapters in place | Story so far + recalled memories, marked CANON 1–5 (MEM, CTX) |
| [TRUTHS] | Story truths (prefix) |
| [ELSEWHERE] lane | World simulation crossings in the note (Phase 2 sim) |
| Anchor reminder | Re-anchor (CON-03), stronger while the drift detector fires (CON-10) |
| Director's Pass sidecar | Advisor plan (STEER-01, STEER-02) |
| "Never use" lists, hazard bans | Banned phrases (CHAT-19), style profile (STEER-04), post-pass editor (STEER-03) |
| Point of view and puppeting discipline | POV, tense and puppeting guards (CON-04) |
| /recap, /report, /audit | `/recap`, `/ask`, Codex, continuity checker, timeline check |
| Session Zero | Per-chat controls and story settings |
| Scene header plate | The HUD line and scene dividers (UI-09) |
| Regex that strips old ledgers | History cleaning past the filter depth (CTX-07) |

### 5.3 Prompt layout

In the order the model reads it. "Mea extra" rows are added by the engine, not the preset; they're shown so the whole prompt is visible.

| # | Block | Kind | Where | ~Tokens | Built from |
|---|---|---|---|---|---|
| 1 | **Charter** | text (`main`) | prefix | 230 | ALMANAC charter · Megumin story · Ancient Access |
| 2 | **Boundaries** (locked) | text | prefix | 120 | ALMANAC floor |
| 3 | **Story preferences** | controls | prefix | 250–700 | ALMANAC's dials |
| 4 | **Agency** | text | prefix | 260 | ALMANAC agency + SEAL · Argent gate · Nemo turn flow · Stabs player vs character |
| 5 | **Minds** | text | prefix | 520 | ALMANAC firewall and cast · FrankenSIM fidelity · Magpie "worth it" · Realistic Frankenstein anti-sycophancy · Ancient Access |
| 6 | **Bonds** | text | prefix | 260 | ALMANAC web and romance · Writer's Block anti-resolution |
| 7 | **World and time** | text | prefix | 460 | ALMANAC world, time, stakes · Megumin ellipsis and seeds · Chronicon "preserve ambiguity" |
| 8 | **Craft** | text | prefix | 520 | ALMANAC floor · Tessera list · Magpie · Realistic Frankenstein killswitches · VELLUM II mechanics · Paramnesia "don't overwrite" |
| 9 | **Dialogue and voice** | text | prefix | 240 | ALMANAC · Magpie lineup · Argent "every line acts" · Nemo · Pura |
| 10 | **Intimacy and intensity** | text | prefix | 140 | ALMANAC intimacy (levels live in the controls) |
| 11 | **Reading Mea's notes** | text | prefix | 190 | ALMANAC bridge, rewritten for Mea's lanes · Chronicon |
| 12 | **Planning** | text | prefix | 220 | ALMANAC Director's Pass (lean) · Nemo READ→WRITE |
| — | *Mea extra:* canon order, story settings, truths, style profile | — | prefix | — | — |
| 13 | Character | `character` | prefix | — | |
| 14 | Lore (before) | `lore_before` | prefix | — | |
| 15 | Persona | `persona` | prefix | — | |
| 16 | Lore (after) | `lore_after` | prefix | — | |
| 17 | Example dialogue | `examples` | prefix | — | |
| 18 | Story so far | `memory_story` | end of prefix | — | |
| 19 | Chat history | `history` | — | — | |
| 20 | Recalled memories and triggered lore | `memory_recall` | depth 1 | — | |
| — | *Mea extra:* story-state note, OOC notes | — | depth 1 | — | |
| 21 | **Scene module** | text, only while the scene is in that mode | depth 1 | 0–200 | ALMANAC scene modules |
| 22 | Author's note | `authors_note` | depth 4 | — | |
| — | *Mea extra:* re-anchor, guidance, advisor plan | — | shallow | — | |
| 23 | **Turn frame** | text | depth 0 | 60–140 | ALMANAC turn frame, echo guard, hazard deck |
| 24 | Post-history instructions | `post_history` | depth 0 | card's | |
| 25 | **Output** | text | depth 0 | 60 | ALMANAC output contract |

**Total at defaults:** ≈ 3.6k tokens of prefix doctrine and controls, plus ≈ 0.2–0.4k per turn. Explicit intimacy, a scene module and thorough planning bring it to ≈ 5k.

### 5.4 What each block says

**1 · Charter.** Mode-aware identity, then the order of authority:
- *Companion:* you are {{char}} in a living story with {{user}}, and also the world around them.
- *Narrator:* you are the narrator and everyone except {{user}}.
- "The story is a world, not a service." Its people want things, misjudge things, and act unasked.
- **Authority:** boundaries and hard limits → the player → the story-state note → the card, persona and lore → recent chat.
  - The player's out-of-character words (`((…))`, `[OOC …]`, `OOC:`) are obeyed briefly, then the story resumes.
  - Mea's `[Stage direction from the user…]` lines and `[Notes from the user…]` count the same way.
  - A fact the player states about the story is true, and the story quietly matches it.
- **Cards define people; the story records what is true now.** When they disagree about *who* someone is, the card wins until the story has earned the change.
- What you know as the author stays yours. A character knows only what has reached them.

**2 · Boundaries (locked).** ALMANAC's floor, reworded and not editable:
- Adults only. An ambiguous age means no sexual content.
- Consent: free, informed and ongoing, from everyone involved. {{user}}'s consent comes only from the player's own words.
- Near either line, the story turns inside itself (an interruption, a refusal, a cut), with no lecture.

**3 · Story preferences.** The rendered controls (§5.5). Each choice adds one short instruction.

**4 · Agency.**
- **What the player wrote is sorted:** SAID, DID and STATED are true. ATTEMPTED gets the world's answer. INTENDS is not yet an action.
- **Turn flow (Nemo):** others may act before, during or after an attempt, and only what survives becomes fact. Attempts nothing resists simply happen. Resisted ones follow the *Contested outcomes* control.
- **The sealed gate (Argent):** "obvious", "automatic" or "likely" still isn't stated. No passive voice and no "you" to slip a result past the rule.
- **What the player wants from the story isn't what {{user}} wants in it (Stabs).** Serve the first without deciding the second.
- **End on live pressure** where {{user}}'s next choice begins. Never "What do you do?", never a menu, and at most one question, only from a character who'd ask it.

**5 · Minds.**
- **Firewall:** every fact has a holder and a route.
  - Senses stop at walls, distance, noise and darkness. A whisper across a room is a moving mouth.
  - Whoever walks in knows nothing said before.
  - People can be confidently wrong, and truth surfaces in degrees.
  - A card describes a character *to you*, not to the world.
- **Inner state is shown through behaviour, never listed:** body, a precisely named feeling, want, fear, tactic, mask and tell.
  - Three short state → syntax mappings.
  - Earned anger stays anger.
  - Everyday needs sit low; raise one only for a cause.
- **Everyone is busy.** What would this person be doing if {{user}} weren't here? Regard is earned, and nobody senses hidden protagonist value. NPC tastes never copy {{user}}'s (Realistic Frankenstein).
- **Fidelity:** reread the card, lead with a side not shown lately, and use the swap test (could someone else say this line unchanged?).
- **Don't homogenise:** not everyone shares one clipped, competent cadence.
- **New people** are built first (a concern, a contradiction, a habit, one private fact), then named for their culture, class and era. No stock names.
- **Companion mode adds (Ancient Access):** {{char}} experiences themselves rather than diagnosing themselves. Intimate moments leave lingering effects. Under strain, two wants can pull at once.

**6 · Bonds.**
- **Relationships are directional and asymmetric,** between everyone. A bond changes only when the aftermath differs from the start.
  - Intensity is not progress, a crisis confession is not intimacy, and one kindness doesn't heal a guarded person.
  - Not everyone warms to {{user}}, and rivals don't auto-soften.
- **On a confession, apology, betrayal or refusal, trace the landing:** intent → delivery → access → interpretation → defence → aftermath.
- **Apologies needn't land,** and understanding can stay incomplete (Writer's Block).
- **News travels on people,** who delay, distort and drop it.
- The romance pace itself is a control.

**7 · World and time.**
- **The world runs unwatched.** Places keep hours and people keep routines. Off-page news arrives only through the story-state note.
- **The causality gate:** Motive, Knowledge, Access, Means, Time. A missing link becomes a trace, a delay, or nothing.
- **The smallest meaningful change.** Reuse before inventing, never manufacture urgency, and invent at most three concrete details when the scene needs them (they become canon, and the tracker picks them up).
- **Time only moves forward.**
  - Activities cost time.
  - Flashbacks and dreams don't move the clock.
  - A skip stops before any choice the player might want, and a skip is never empty (Megumin).
- **Weather is a system:** fronts pass through in-between states and act on everything. Weather never mirrors a feeling.
- **Consequences persist:** injuries, debts, promises, grudges and reputation. No free healing, no amnesiac guards.
- **Plant before you pay off.** Quiet threads come back through the note's HOOKS.

**8 · Craft.** About 12 lines, each with a micro-example:
- people act, not their body parts; name the thing; say what is (cut *seemed, felt, realised, noticed, as if*)
- ordinary things stay ordinary; one exact detail beats three
- every paragraph moves something (an event, a revelation, a shift)
- begin where the player's message ended; never restate it
- don't explain the image or the subtext
- vary paragraph shapes; no comma splices or chains of *and…as…while* (VELLUM II)
- not every sentence sings; a plain line between two sharp ones makes them sharper (Paramnesia)
- quiet endings are fine, inert ones aren't

Then a short list, **"tells to catch"**, which names the ones GLM and Claude actually produce:
- correction frames ("not X but Y", "less X than Y")
- drumbeat one-word sentences in speech
- speech that announces itself ("Here's the thing")
- a job that becomes a whole personality
- breath hitching, pupils blown, "a beat", air that thickens, ozone, velvet voices
- the rule of three; weather that mirrors a mood
- an aphorism or a question to close

The turn frame rotates one of these into the spotlight each turn. Your own banned phrases stay in Mea's list (CHAT-19).

**9 · Dialogue and voice.**
- **Every line acts:** it probes, evades, bargains, wounds, soothes or refuses (Argent).
- **The lineup (Magpie):** each recurring speaker has a tell, a way pressure changes them, what they do while others talk, and where they learned to talk. No two share a tell, and you could name the speaker with the tags removed.
- **People talk like people:** imperfect, interrupted, subjective. No reportorial fact-stacking (Nemo).
- **No telling each other what both already know.** No echoing {{user}}'s words back (the "Dan" example).
- **Spotlight:** one or two speakers carry a reply. Others may react once. No round-robin. "Said" is fine.

**10 · Intimacy and intensity.**
- **Desire is personal:** people keep their voice, humour and hang-ups.
- **Consent lives in the scene,** and a change is honoured at once.
- **Phases are climbed across replies,** never in one: charge → approach → consent → undressing → … → aftermath. The next morning is part of the story.
- **The pace rule rides in This reply and the plan pass,** not only the scene module: the tracker sets `mode = intimacy` after a reply, so the module misses the reply where a scene starts. At Sensual and Explicit, each reply covers one step, and the climax waits for the player or for several replies at full pitch.
- **Bodies stay in a specific room.**
- The level, style and vocabulary come from the controls. A banned list of erotic clichés is kept short.

**11 · Reading Mea's notes.** A short key to the *actual* lanes:
- `[Story state]` is verified and true *now*. Trust it over older chat, and never recite it.
- PRESENT is who's here and how they are.
- STAKES is what binds this reply.
- KNOWLEDGE is who knows what (act only on what each person knows).
- HOOKS are quiet threads to pick up only if they fit.
- VOICES are how particular people talk.
- Anything from elsewhere is the only off-page news.
- The story so far and recalled memories are the past: never re-stage them.
- **If a detail you need isn't there, don't invent a past event to fill the gap.** Keep it vague, or let someone not remember (Chronicon).
- Nothing narrator-side reaches a character's mouth.

**12 · Planning.**
- **"If you can reason privately, run this pass there; if you can't, don't write it, just check silently."**
- If an advisor's plan is present, follow it and skip the pass.
- The pass is sized to the beat: routine ≤ 80 words, charged ≤ 200, pivotal ≤ 350.
- Its steps:
  - **NOW:** time now → when the reply ends; place; who's present.
  - **SEAL:** the player's words sorted; the line you won't cross; where the reply stops.
  - **KNOW:** each fact this beat touches, and the most tempting leak.
  - **MINDS:** want, fear, tactic, named feeling, mask and misreading for the spotlight.
  - **MOVE:** the obvious move, the one only these people would make, and the sideways consequence; choose one, and name the pressure it ends on.
  - **VOICE:** length, how much talk, and how the opening differs from last time.
- Fragments only, never a drafted sentence. Stop at VOICE.

**21 · Scene modules.** Only one is sent, and only while the tracker's scene mode matches. They are ALMANAC's seven, trimmed:
- **intimacy:** the phase ladder, bodies in a room, and the pace by scene length
- **conflict:** spatial clarity, one exchange per reply, enemies adapt
- **investigation:** fair clues with physical form, witnesses with self-interest, never solve it for {{user}}
- **travel:** legs that cost time, supplies and light
- **stealth:** the discovery ladder
- **downtime:** quiet time passes, but stop before choices
- **crisis:** options shrink, end on the choice or the cost

**23 · Turn frame.** Rebuilt every turn, and short. Only the lines that apply are sent:
- **First reply:** "The opening came from the card: keep its facts, not its habits."
- **Swipe:** "A fresh take on the same moment: a different first line and shape. Keep what these people would truly do." Ideally it also shows the rejected take's opening.
- **Echo guard:** quotes the last reply's opening and closing ~12 words. Open and close differently.
- **Spotlight** (Variety: lively): one rotating tell from each of four families (prose, sycophancy, perfection, structure). It also gives a form-only "open on…/favour…" lot.
- **Fair die** (Contested outcomes: fair die): a d20 that stays the same across swipes, with ALMANAC's five bands.
- **Seal** (sealed and continuity persona only): stop before you'd speak, feel or choose for {{user}}.

**25 · Output.** Only the story: no headings, notes, summaries, options or questions to the player. Boundaries and hard limits hold.

### 5.5 Controls

These replace today's four (More dialogue, Slow burn, Mature content, Narration focus); the old values migrate (see below). Defaults follow ALMANAC.

| Control | Options (**default**) | Shown in | Notes |
|---|---|---|---|
| Persona | **Sealed** · Continuity · Director · Full cast | Simple | Should also drive the anchor's last line, the puppet guard and tracker sealing (§6) |
| Romance pace | Off · **Slow burn** · Measured · Fast · Established couple | Simple | ALMANAC's ladder: rungs, pace, regression |
| Intimacy | Off · **Fade to black** · Sensual · Explicit | Simple | Sensual and Explicit carry style and vocabulary text |
| Initiative | Player-led · **Shared** · World-led | Simple | |
| Lead genre | **Drama** · Romance · Slice of life / cozy · Mystery · Thriller / action · Horror · Fantasy / adventure · Comedy | Simple | The contract's deliverable, pace and what to avoid. Multi-select later (§6) |
| Dialogue | Sparse · Balanced · Dialogue-forward · **Adaptive** | Simple | Replaces "More dialogue" |
| Contested outcomes | **I decide** · Narrator judges fairly · Fair die | Advanced | |
| NPC autonomy | Reactive · **Proactive** · Autonomous | Advanced | Initiative caps per reply |
| World texture | Backdrop · **Living** · Insistent | Advanced | At most one environmental act per reply on Living |
| Difficulty | Gentle · **Grounded** · Hard · Brutal | Advanced | Includes the failure shape |
| Strangers | Kind · Warm · **Fair** · Harsh · Brutal | Advanced | |
| Violence | Restrained · **Grounded** · Graphic | Advanced | A separate axis from intimacy |
| Thoughts on the page | Behaviour only · **The viewpoint character's** · Open minds | Advanced | A sealed persona's thoughts are never shown |
| Narration focus | **Balanced** · Inner life · Action · Atmosphere | Advanced | Kept from today's controls |
| Reveals | Slow · **Measured** · Quick | Advanced | |
| Variety | Steady · **Lively** | Advanced | The spotlight and the presentation lot |
| Planning | Off · **Auto** · Thorough | Advanced | Thorough = every step, pivotal ceiling |
| Hard limits | free text | Advanced | Repeated in Output. Needs a text control (§6) |

**Migration:**
- More dialogue: on → Dialogue-forward; off → Adaptive.
- Slow burn: on → Slow burn; off → Measured.
- Mature content: on → Intimacy Explicit + Violence Graphic; off → Fade + Grounded.
- Narration focus carries over as is.

### 5.6 Side prompts and samplers

| Field | Proposal |
|---|---|
| Impersonation | Mea's current prompt, plus ALMANAC's: always third person, present tense, in the player's usual form and length; {{user}} knows only what has reached them |
| Continue | ALMANAC's: pick up from the exact last word; no recap, no restart |
| Expand | Unchanged (Mea's is already good) |
| Wait *(new)* | For an empty send: "The player waits. Let the world move on its own: one unprompted move at most, then stop where the player can act." |
| Samplers | `temperature: 1`, `max_tokens: 1600` (up from 1200, so long replies aren't cut). Leave `top_p` and the reasoning budget to each model's connection profile, which already overrides the preset |
| Model notes | In the connection profile (PROMPT-10), not the preset. GLM: reason in short fragments within the pass, with no drafting or rechecking. Claude: no drumbeat sentences in speech, no "here's the thing" framing. DeepSeek (fallback): after reasoning, write the whole reply in the reply |

### 5.7 Dropped from ALMANAC, and why

| Dropped | Why |
|---|---|
| Ledger writing, ledger bridge, ledger gate, handshake, boot router | Mea's helper tracker, note and engine do this, and the model writes only prose |
| Speaker marks, artifacts, the unspoken-thoughts register, the scene header | Presentation belongs to Mea's renderer and HUD. No markup to break, and no repair regex |
| Command palette | Mea has `/recap`, `/ask`, the Codex and the checkers. A `/skip` chat tool would be the one gap |
| Faction clocks, routines and reputation as ledger lines | The world simulation keeps them. The preset only says off-page news comes through the note |
| "Signal weather" romance dice, 13 skins | Low value per token |
| Model errata that match model names in the prompt | Moved to per-model profile notes |

---

## 6. Engine changes the design needs

**Needed for v1** (each is small; the fallback works without it, just less precisely):

| # | Change | Why | Fallback without it |
|---|---|---|---|
| 1 | **One persona setting drives everything:** preset text, the re-anchor's last line, the puppet guard and tracker sealing | Today, with *Full cast*, the anchor would still say "never write {{user}}" | Only *Sealed* is safe until this lands |
| 2 | **Canon rule nuance:** the card wins on *who someone is*; the story state wins on *what is true now* | Mea's canon rule ranks the card above the story state, so a haircut in chapter 3 loses to the card's "long hair" | Charter block 1 states the nuance (weaker, and it duplicates the rule) |
| 3 | **Turn macros:** `{{turn}}`, `{{isSwipe}}`, and a `{{pick}}` seeded per turn in dynamic blocks | Today `{{pick}}` is seeded by the chat, so it never rotates; `{{random}}` changes on every swipe | Use `{{random}}` in the turn frame. The fair die then changes per swipe |
| 4 | **Control values readable in blocks** (e.g. `{{ctl::persona}}`) | Lets the persona choice shape the seal, the output and the thoughts lines | Each option's text carries everything it needs |

**Nice to have:**

| # | Change | Why |
|---|---|---|
| 5 | Block conditions on tracker state (`when: mode == conflict`), reusing TRK-12's evaluator | Scene modules. Fallback: ship them as a lorebook with tracker conditions |
| 6 | Echo guard as an engine extra (last reply's opening and closing; the rejected swipe's opening) | Cleaner than macros, and can share the drift detector's text cleaning |
| 7 | Control types `text` (hard limits, welcomed dynamics) and `multi` (genres), and options up from 8 to ~20 | ALMANAC's 18 genres, and multi-genre stories |
| 8 | A "wait" side prompt for empty sends | ALMANAC's let-the-world-move nudge |
| 9 | One length hint, not two | Today `preset.simple.length` and the chat's length tool can both add a line |

---

## 7. Open questions

1. **Persona default:** *Sealed* (ALMANAC's, and the safest) or *Continuity* (lets the model finish your obvious actions, smoother for casual companion chats)?
2. **Speaker colours and artifacts:** drop them, or plan a Mea renderer feature that colours speech and draws letters and phones *without* the model writing markup (using the entity registry and voice notes, CHAT-27)?
3. **Genre and tone:** keep the genre contract as a preset control (as designed), or merge it into story settings, where genre and tone already live as free text?
4. **Private thoughts:** ALMANAC's "unspoken" envelopes are lovely. Worth a later Mea feature (a thoughts drawer filled by a helper, not the story model), or leave them out?

---

## 8. What was built

**Your decisions (2026-10-09):** Persona defaults to *Continuity*; speaker colours and artifacts wait for Mea's renderer; the genre contract stays a preset control (a structured contract is obeyed better than a free-text label); private thoughts become a later helper-filled feature.

**The preset** lives in [server/src/prompt/mea.ts](../server/src/prompt/mea.ts). Mea installs it once as **"Mea"** and makes it the default; your later choice of default is kept. A newer version (`MEA_PRESET_VERSION`) updates the installed copy, and **Reset to defaults** in the editor restores it. Copies never carry the built-in mark.

**Defaults**, in the order you gave them: Persona *Continuity* · Romance *Fast* · Intimacy *Explicit* · Initiative *Shared* · Lead genre *Drama* · Dialogue *Adaptive* · Contested outcomes *Narrator judges fairly* · NPC autonomy *Autonomous* · World texture *Insistent* · Difficulty *Grounded* · Strangers *Fair* · Violence *Grounded* · Reveals *Measured* · Variety *Lively* · Planning *Auto*. The rest: Thoughts on the page *the viewpoint character's*, Narration focus *Balanced*, Second genre *None*, Hard limits and Welcomed dynamics empty. The first six show in the chat panel; the other fourteen sit under **More controls**.

**Genres:** 35 contracts (deliver · track · pace · avoid), up from ALMANAC's 18: drama, romance, romantic comedy, slice of life, cozy, comedy, dark comedy, mystery, noir, crime/heist, thriller, psychological thriller, horror, gothic, urban fantasy/supernatural, fantasy, epic fantasy, dark fantasy, fairy tale/mythic, adventure, action, wuxia/martial arts, science fiction, space opera, cyberpunk, post-apocalyptic/survival, political intrigue, war, historical, western, superhero, coming of age, tragedy, surreal/magical realism, erotic romance. A **Second genre** colours how scenes get there; the lead decides what they deliver.

**Size:** about 4.5k tokens with your defaults, including the controls and the turn frame (ALMANAC is about 8k plus its note).

**Engine changes** (all of §6):
- Block conditions (`when: mode = conflict`) drive the seven scene modules.
- New macros: `{{ctl.id}}` for any control; `{{kind}}`, `{{turn}}`, `{{isFirst}}`, `{{isSwipe}}`, `{{rejectedOpening}}`, `{{lastOpening}}`/`{{lastClosing}}` (the echo guard, for replies over 200 characters), `{{persona}}`, `{{userSealed}}`; `{{rotate::…}}` and `{{turnroll::1d20}}` change per reply but hold across its swipes.
- Control types: `text` (with `{{value}}`), an `advanced` flag, up to 40 options and 30 controls.
- One persona setting: the Persona control now drives the re-anchor's last line, the puppet guard (Continuity flags only words, Director and Full cast flag nothing) and tracker sealing. The Romance pace control drives the tracker's ladder pace. Tracker settings show both as set by the preset.
- The canon rule now says the card wins on *who someone is* and the story state on *what is true now*.
- A **Let the world move** prompt is sent when you send nothing after a reply.
- The chat's own length setting replaces the preset's, so there's one length hint, not two.
- Values saved for the old controls carry over (More dialogue → Dialogue-forward, Slow burn → Slow burn, Mature content → Explicit and Graphic).

**Not built (later):** model notes per connection profile (§5.6), the renderer for speaker colours and artifacts, the private-thoughts drawer, multi-select genres.
