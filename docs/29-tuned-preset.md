# Design plan: a sharper preset, tuned per model

> Source: *The FrankenWIRE / TeleWire TRP Guide* (Downloads, 2026-11-05). Target: Mea's built-in preset, [server/src/prompt/mea.ts](../server/src/prompt/mea.ts) (v23).
> Builds on [23-preset-additions.md](23-preset-additions.md), which reviewed an earlier FrankenWIRE text and took some of it.
> **Status:** Part 1 built (the adapter plumbing, and a line telling every model not to draft). The rest is a plan. MiMo was dropped on 2026-11-05.
> Budget: the preset may send at most **20k tokens** in the worst case (every option at its largest), counted with the model's own tokenizer.

## Contents

1. [Where the preset stands](#1-where-the-preset-stands)
2. [What the guide teaches](#2-what-the-guide-teaches)
3. [One preset or six?](#3-one-preset-or-six)
4. [The model adapter](#4-the-model-adapter)
5. [The new layout (v24)](#5-the-new-layout-v24)
6. [Planning pass with tag recall](#6-planning-pass-with-tag-recall)
7. [The prose card](#7-the-prose-card)
8. [Negatives, operators and priming](#8-negatives-operators-and-priming)
9. [Budget](#9-budget)
10. [Engine work](#10-engine-work)
11. [What not to take](#11-what-not-to-take)
12. [Parts](#12-parts)

---

## 1. Where the preset stands

I measured the preset as rendered, with the default controls, one short card and the o200k estimate in [tokens.ts](../server/src/lib/tokens.ts):

| Where | Blocks | Tokens |
|---|---|---|
| Prefix (cached) | charter 320 · boundaries 187 · agency 366 · minds 778 · bonds 327 · world 682 · craft 961 · dialogue 884 · toolkit 832 · controls 954 · notes 298 | 6,589 |
| Depth 1 (while active) | one scene module (intimacy is the largest, 427), talk lines | 0–470 |
| Tail (after the history, rebuilt and uncached every reply) | turn 317 · planning 860 · errata 177 · speakers 278 · output 106 | 1,738 |
| **Total** | GLM without reasoning, defaults | **8,335** |
| | Claude with extended thinking | 8,176 |
| | Wild toolkit, lavish rhythm, intimacy scene | 9,139 |

The worst case uses less than half the budget. So the question isn't how to make the preset smaller. It's where the words go and how each model gets the version it follows best.

Five facts from the code shape the design:

- **Model notes already exist.** [ERRATA](../server/src/prompt/mea.ts:187) sends 72–177 tokens per family (claude, deepseek, gemini, glm, kimi, gpt, open). They're one block of `{{if modelFamily == …}}` text, and they only cover the plan and a few habits.
- **The preset and the model are chosen separately.** A chat's preset comes from chat, then character, then global ([layers.ts](../server/src/services/layers.ts:11)). Its model comes from the profile. Switching profiles never switches the preset.
- **Profiles already carry samplers and reasoning effort** ([connections.ts:345](../server/src/services/connections.ts:345)). Sampler tuning per model already lives in the profile.
- **Golden scenarios** ([golden/run.ts](../server/src/golden/run.ts)) can grade a real model's replies. Mea already has the harness a model bake-off needs.

---

## 2. What the guide teaches

docs/23 already took the substitution arrows for the [CRAFT] tells, "five names, use the fifth", sensory dedup, and the recall clause in VOICE. It turned down telegraphic YAML for the cached prefix, the overcorrections (no "and"/"or" in speech, a fixed dialogue ratio), forced touching, and the "unhinged DM" mandate. Those decisions stand. Six lessons are still unused.

| # | Lesson | Mea today | Take |
|---|---|---|---|
| L1 | **Attention half-life.** World and knowledge rules hold up early in the prompt. Prose mechanics and word bans fade fastest, so they go right before generation. | All of [CRAFT], tells included, sits in the prefix, the whole history away from the reply in a long chat. docs/23's placement test was never built. | ✅ Split CRAFT: principles stay in the prefix, and the tells move into a **prose card** at the end of the tail (§7) |
| L2 | **Tag recall.** Short, unique block names that the reasoning names step by step ("how will I enforce `<omni>`?"). | Blocks have bracket headers ([MINDS], [CRAFT]) with no closing mark. Only VOICE points back at a block. | ✅ Closed lowercase tags, and every planning step names the tags it applies (§6) |
| L3 | **Two operators.** `:` defines, `->` replaces. | `→` means three things: replace (the CRAFT tells), map ("cornered and powerless → short clauses") and sequence (the romance, intimacy and stealth ladders, "intent → delivery → …"). | ✅ `→` means only "write this instead". Sequences use `›`, mappings use `:` (§8) |
| L4 | **Every ban names its replacement.** | Only the CRAFT tells do. The rest of the doctrine has about 230 negatives (never 72, no 76, not 63, don't 21). | ✅ Rewrite the style negatives. The boundaries stay negative and explicit (§8) |
| L5 | **Naming a banned thing primes it.** | The prompt quotes dozens of bad phrases, and spells out banned names ("never Elara, Seraphina, Kael…"). | ⚠️ Partly. How strongly naming primes a model varies by model, so this becomes an adapter setting decided by measurement (§4, §8) |
| L6 | **Telegraphic `key: value` lines.** | Plain prose everywhere. | ✅ Only in the tail. It's uncached and rebuilt every reply, sits next to generation, and is a checklist anyway. The prefix stays prose, because nuance there is cheap once cached |

**On the token arithmetic:** I checked the guide's claims against o200k. `[CRAFT]` is 4 tokens, `<craft>` 3, `craft:` 2, and `→`, `->` and ` ›` are one token each. The savings are real but tiny: retagging 20 blocks saves well under 100 tokens. Make the tag change for recall and clear boundaries, not to save tokens.

**On ideas the guide repeats that Mea already has:** the three-branch momentum step (MOVE), "no drafting in the reasoning" (STOP RULE), dedup (CRAFT's fixed-trait rule), and OOC first (the Charter). The one thing missing is the guide's line-of-sight idea: NOW doesn't ask where people stand or what each can see and hear. That gets a clause (§6), as positions and sightlines rather than the guide's literal "120°".

---

## 3. One preset or six?

**Recommendation: one preset, with a model adapter per family.** Six presets would duplicate about 95% of the text to change the other 5%.

| | Six presets (GLM, Claude, Gemini, DeepSeek, Kimi, GPT) | One preset and adapters |
|---|---|---|
| A doctrine change | Made six times. docs/23 alone touched 17 sections, and the preset went from v15 to v23 in two days. They would drift apart within a week. | Made once |
| Switching models in a chat | The preset is bound to the chat and the model to the profile, so a switch leaves the wrong preset in place. Fixing that means Mea picks the preset from the model, which is an adapter anyway. | Follows the model on its own, swipe by swipe |
| Controls (25 of them) and their saved values | Six copies to keep in step. A value set under one preset is lost under another. | One set |
| Restore, versioning, golden tests | Six built-ins, six versions, six test runs | One, plus one golden run per family |
| How far tuning can go | Anything | Anything a family needs: plan wording, prose tells, ban style, where the tail sits, samplers, length, and whole-block replacement as a last resort (§4.2) |
| Prompt caching | One prefix per preset | The prefix is identical for every family. Adapter text lives only in the uncached tail, so switching models never invalidates what's left of the cache. |

**What actually differs between these models** is narrow and fits in an adapter:
1. **The route:** native reasoning or a `<think>` block, and how a family drifts while planning (self-talk, drafting, restating the prompt, forgetting `<story>`).
2. **Format habits:** markdown headings, code fences, JSON plans.
3. **Prose habits:** each family's own tells (GLM's office words, Claude's teaser endings, Kimi's drumbeat fragments).
4. **Priming tolerance:** whether quoting a bad phrase helps the model or plants it.
5. **Where end-of-prompt instructions land:** some hosts may move mid-history system messages to the top.
6. **Samplers and length tendency.**

**When to fork after all:** if the bake-off (Part 6) shows a family needs different *doctrine*, not different phrasing, the adapter can replace a single block. If one family ends up replacing three or more blocks, generate that family's preset from the same sources at build time. A hand-maintained fork is never the answer.

---

## 4. The model adapter

### 4.1 Detection

- Families: claude, deepseek, gemini, glm, kimi, gpt and open. MiMo gets no family of its own. Like any model no adapter matches, it gets only the line every model gets (§4.2).
- Adapters can match sub-families by id when a variant behaves differently, such as `kimi-k2-thinking` versus `kimi-k2` instruct, or DeepSeek's reasoner versus chat. Whether the route reasons is already known (`providerReasoning`), so most variants need no split.
- **Profile override:** a *Model adapter* setting on the profile, "Auto (detected: GLM)", a family, or "None". NanoGPT and other routers use odd ids (`TEE/…`, renamed fine-tunes), and the user should be able to fix a wrong guess.

### 4.2 Shape

A typed table in a new `server/src/prompt/models.ts`, versioned with the preset and restored with it:

```ts
interface ModelAdapter {
  family: string;                 // "glm"
  label: string;                  // "GLM"
  match: RegExp;
  plan: string;                   // ≤150 tokens → {{model.plan}}, end of <pass>, before STOP RULE
  prose: string[];                // ≤10 arrow lines → {{model.prose}}, inside <prose>
  bans: "quote" | "describe";     // L5: quote examples of bad phrases, or describe the category only
  tail: "system" | "note";        // send the tail as system messages, or as a <mea_note> user turn
  planScale?: number;             // multiplies the planning word ceilings (0.7 for a family that over-plans)
  samplers?: Partial<Samplers>;   // suggestions only, applied where neither profile nor preset set one
  dropSamplers?: (keyof Samplers)[]; // params this route rejects (temperature with Claude thinking)
  replace?: Partial<Record<BlockId, string>>; // last resort: a whole block's text for this family
}
```

- **Every model is told not to draft**, whatever its family, including models no adapter matches and profiles set to "None". The line names where the plan is written: "Draft nothing in the <think> block" (or "in your reasoning"): no sentence, line of dialogue, opening or outline of the reply, and the story is written once. When a separate planner planned the reply, the line becomes "write the story once, straight through, with no draft, outline or rehearsal of it first". The family notes no longer repeat it.
- The `mea-errata` block goes. Its text moves into `plan` and `prose` unchanged in Part 1, so that part changes nothing on the page.
- **Two slots instead of one block.** Plan advice goes where the plan is written (`<pass>`), and prose advice goes where the prose rules are (`<prose>`), so each sits next to the step it corrects.
- **Samplers are suggestions.** The profile's own values always win. Settings → Connections shows "Mea suggests temperature 0.6 for Kimi K2" with an *Apply* button, and never changes the value silently.
- **The user can add more:** an *Extra model notes* text field on the profile appends to `{{model.prose}}` for that model.

### 4.3 Starting adapters

These are hypotheses. They come from the current errata plus behaviour widely reported for each family. Part 2 measures them before Part 5 commits them. Sampler suggestions are vendor guidance where it exists, and each one should be checked against the version NanoGPT actually serves.

| Family | Plan habits (`plan`) | Prose habits to test (`prose`) | Starting samplers | Other knobs |
|---|---|---|---|---|
| **GLM** | Self-talk, rechecking, drafting, leaving out `</think>` or `<story>`. The current errata covers this well. | Office and courtroom words for people, counting things, restarts ("that's — that's"), word-chain hand-offs, "the specific…", a broken line in every reply, the same closing image, one clipped voice for everyone | Temperature 1.0, top_p 0.95 (Z.ai guidance) | `bans: describe` is a candidate: some of GLM's tells may be primed by the quoted lists themselves |
| **Claude** | With thinking on, it over-plans, so `planScale` 0.8. Without it, it follows the order literally. | Teaser endings ("Soon."), a summing-up closer, explaining what a look meant, softened enemies, "something shifted", therapy words in period mouths | Leave temperature at 1. With extended thinking, `dropSamplers: [temperature, top_p, top_k]`, since Anthropic doesn't allow changing them alongside thinking | `tail: system` (the provider already wraps it as `<mea_note>`). `bans: quote` holds up well |
| **Gemini** | Restates the instructions and the state note in its thinking | Markdown headings and bold in the story, long replies, echoing the player's words, "a testament to", lists of three | Temperature 1.0 (Google's guidance for Gemini 3: lowering it can cause looping) | `tail: note` is the likely fix if the OpenAI-compatible route moves system messages to the top (the probe in §10 checks) |
| **DeepSeek** | Drafts inside the plan, and keeps writing after the plan ends | Escalating purple prose, ozone and "air thick with…", cutaways ("Somewhere, a dog barked"), inventing events to end on, rushing scenes | 1.3–1.5 on DeepSeek's own API (its scale differs). On other hosts, bench it. The reasoner ignores temperature. | `planScale` 0.8 |
| **Kimi** | "Let me plan…" workspace, self-correction, rehearsing paragraph by paragraph | Drumbeat fragments, cascades of one-line paragraphs, heavy em-dashes, a deadpan quip in every mouth | K2 instruct 0.6 (Moonshot's guidance), K2 thinking 1.0 | — |

---

## 5. The new layout (v24)

The order follows the half-life idea: stable laws first, drivers in the middle, volatile rules last, right before the reply. Each block gets one short lowercase tag, closed at its end. Tag names must not collide with the toolkit tags or Mea's own (`think`, `plan`, `reasoning`, `story`, `ledger`), so it's `<pass>`, not `<plan>`, and `<records>`, not `<notes>` (`note` is a toolkit tag). A test enforces this.

| Tier | Tag | Block | Change |
|---|---|---|---|
| Prefix · laws | `<charter>` | Charter | Tag only |
| | `<bounds>` | Boundaries | Tag only. Stays explicitly negative (§8). |
| | `<agency>` | Agency | Negatives → substitutions |
| | `<minds>` | Minds | Mappings use `:`. The name list goes (L5). |
| | `<bonds>` | Bonds | The trace chain and ladder use `›` |
| | `<world>` | World, time and weather | Negatives → substitutions |
| Prefix · drivers | `<voice>` | Dialogue and voice | The "speech tells to catch" paragraph moves to `<prose>`. Principles stay here. |
| | `<craft>` | Craft | Principles stay (point of view, "people act", one exact detail, every paragraph moves). The 16 tells move to `<prose>`, so nothing is sent twice. |
| | `<toolkit>` | Visual toolkit | Tag only |
| | `<prefs>` | Story preferences (controls) | Ladder arrows → `›` |
| | `<records>` | Reading Mea's notes | Tag only |
| | `<canon>` | Canon | Tag only |
| Context | — | Card, lore, persona, examples, memory, history | Unchanged |
| Depth 1 | `<scene>` | Scene modules, talk lines | Ladders use `›`. The intimacy module's quoted list follows the `bans` setting. |
| Tail · turn | `<turn>` | This reply | Loses the "last opening" and "worn phrases" lines, which move to `<prose>` |
| | — | Post-history | Unchanged |
| | `<pass>` | Planning pass | Tag recall (§6), plus `{{model.plan}}` |
| | `<marks>` | Speaker marks | Tag only |
| Tail · volatile | `<prose>` | **New:** the prose card (§7), plus `{{model.prose}}` | The last instruction before the format |
| | `<output>` | Output | Tag only. It stays last: it's short, and it's about format. |

The leak stripper that catches planning text in a reply ([generation.ts:182](../server/src/services/generation.ts:182)) learns the new tags, so a stray `</craft>` or `<prose>` line never reaches the page.

---

## 6. Planning pass with tag recall

Each step names the tags it applies, so the pass pulls those blocks back into attention without quoting them. Quoting would waste the plan's words and risk leaks. The steps stay fragments. The guide's "How will I…?" question form is about twice as long for the same recall, so it's an experiment, not the default (§12).

Draft wording for the changed parts:

> **NOW** `<world>` `<records>`: the time now and when this reply ends; the place; who is present, **where each stands, and what each can see and hear from there**; spotlight or edge; the weather; a new scene or the same.
> **SEAL** `<agency>`: … (unchanged)
> **KNOW** `<minds>` `<records>`: … (unchanged)
> **MINDS** `<minds>` `<bonds>`: … (unchanged)
> **WORLD** `<world>` `<scene>` `<prefs>`: a consequence coming due, …
> **MOVE**, **RISK**: unchanged
> **VOICE** `<voice>` `<prose>`: length, how much talk, each speaker's register from their card, how the opening differs from the last one, and **the two `<prose>` lines this scene most invites, by number**.
> `{{model.plan}}`
> **STOP RULE**: … recall a tag by its name; never copy a rule's words into the pass.

Numbering the `<prose>` lines (§7) lets VOICE recall them in two or three tokens ("prose 3, 9").

---

## 7. The prose card

This is the one place the guide's telegraphic form fits: it's uncached, rebuilt every reply, right before the reply, and a checklist anyway. It replaces CRAFT's tells list and DIALOGUE's "speech tells" paragraph, which leave the prefix, and gathers the turn frame's echo and worn-phrase lines.

```
<prose>
scope: narration and speech in <story>; the pass is exempt
last reply: opened «{{lastOpening}}…», closed «…{{lastClosing}}» → another subject, another shape, no reused image
worn here: {{wornPhrases}} → what this moment has instead
1 correction framing ("not X but Y", stacked "Not X. Not Y.") → Y, once, first try
2 a broken-off line, then narration about the break → one broken line a reply at most, never remarked on
3 a gesture or line explained after it's shown → the gesture alone
4 apophasis and litotes ("didn't flinch", "not unkind") → the act, the plain word
5 office words for feelings and people → the person's own world's words
6 counts standing in for detail → a quality, unless the number matters
7 a summing bow to close a paragraph → end on the thing itself
8 stock body tells (breath, pupils, knuckles, spine) → a named action or sound
9 thick air, "a beat", "something shifted" → what someone does in the pause
10 lists of three → one exact thing, or two
11 narrate, speak, narrate, speak; three paragraphs of one shape; one-line cascades → vary the shape
12 filter words (felt, seemed, noticed, realised) → the thing itself
13 restarts ("I — I"), drumbeat fragments, lines that announce themselves → the line, said once
14 empty acknowledgements and echoes of {{user}}'s words → a reaction of this person's own
{{model.prose}}
</prose>
```

Lines that only some stories need are gated by macros. For example, line 13's restart clause appears only when the craft coach saw a restart lately, as the coach's existing "habits it's leaning on" line already works. The card is about 450 tokens. It removes about 500 from the prefix.

**Placement is the riskiest change in this plan.** docs/23 proposed testing it, and nobody did. Part 6 benches v24 against v23 per family with the same scenes before v24 becomes the default.

---

## 8. Negatives, operators and priming

**Rules for the rewrite (v24):**

1. **`→` means "write this instead".** Nothing else. Sequences use `›` (`0 strangers › 1 aware › …`, `charge › approach › consent › …`, `unaware › something's off › searching › spotted › alarm`). Mappings use `:` ("cornered and powerless: short clauses, fidgeting, exits"). Today 37 arrows mix all three meanings.
2. **Every style negative gets a replacement**, or becomes a positive rule. "Never restate, paraphrase or answer it point by point" becomes "Answer its meaning, one or two things at a time: restating it → reacting to it". The audit covers about 230 negatives. Many already pair with a positive ("Show inner state through behaviour; never list it") and stay as they are.
3. **Boundaries and hard limits stay negative and explicit.** They're the one place where a vague positive rule costs more than any priming. The same goes for "Mea's notes never reach a character's mouth" and the persona seals.
4. **Quote less.** Each category of bad phrase is described, plus at most one quoted example, and only when the adapter says `bans: quote`. The stock-name list ("Elara, Seraphina, Kael, Marcus, Lily") goes everywhere: "think of five names that fit and use the fifth" already does the work without planting the names.
5. **No pseudocode:** no `!=`, `==`, `+` or `/` lists in the text. Mea has a few slash lists ("SAID / DID / ATTEMPTED", "checkbox/radio") that become plain spaces or commas. That's cosmetic, done in passing.

**What stays prose:** everything in the prefix. The guide's telegraphese is for checklists, and the prefix is doctrine. "Earned anger stays anger" doesn't compress without losing what it means.

---

## 9. Budget

The preset's own blocks only: card, lore, memory, the story-state note, lanes and the history don't count.

| | Today (v23) | Proposed (v24) |
|---|---|---|
| Prefix | 6,589 | ~6,250 (tells out −500, tags +60, NOW and recall +100, rewrites ±0) |
| Depth 1 | 0–470 | 0–470 |
| Tail | 1,738 | ~2,500 (prose card +450, adapter slots up to +300, recall +60) |
| Default total | 8,335 | **~9,200** |
| Worst case (wild toolkit, lavish rhythm, intimacy, social with talk, explicit, long user text controls, the largest adapter) | ~9,800 | **~11,000** |

- **Guard:** a test renders the worst case and fails above **15,000 o200k tokens**. GLM, DeepSeek, Kimi and Claude tokenizers can count up to about 30% more than o200k for English, so 15k o200k keeps the real count under 20k. Mea's per-model calibration ([connections.ts:330](../server/src/services/connections.ts:330)) gives the real ratio, and the Inspector can show it.
- **Running cost:** about 760 more *uncached* tokens per reply, because the prose card and adapter text sit in the tail. That's the price of the half-life idea, and Part 6 checks that it pays.
- **The headroom (~4k) is reserved, not spent.** The one candidate worth spending it on is style exemplars, a few short passages of the target prose. Models learn style fastest from examples, but they also copy them, so they're an experiment behind the bench (§12), not part of v24.

---

## 10. Engine work

| Item | Why |
|---|---|
| **Tell census:** a script that runs the craft coach's counters ([craft.ts](../server/src/steer/craft.ts)) and the worn-phrase finder ([worn.ts](../server/src/prompt/worn.ts)) over stored replies, grouped by `modelFamily` | Turns §4.3's hypotheses into rates ("GLM: office words in 31% of replies, Claude 4%"). Each family's `prose` slot then holds its own top tells, not guesses. Read-only, and it costs nothing. |
| **Golden run per family:** the K1 scenarios with a real model, one run per adapter | One table of grades per family, before and after each part. It costs money (§12, Part 6). |
| **Tail probe:** a canary instruction in the tail ("end the reply with the word *heron*"), sent once per new route, like the cache probe | Detects hosts that move mid-history system messages to the top, which would quietly undo the half-life layout. The result sets the adapter's `tail` knob for that route automatically. |
| **Inspector** | Shows the adapter in use, both slots' text and tokens, and the worst-case budget meter |
| **Settings → Connections** | The *Model adapter* override, sampler suggestions with *Apply*, and *Extra model notes* |

---

## 11. What not to take

| Pattern | Why not |
|---|---|
| Telegraphic YAML for the whole prompt | docs/23's reasoning still holds: cached tokens are cheap and nuance isn't. The tail is the exception (§7). |
| No "and"/"or" in speech, a 30–50% dialogue ratio, "max 2 clauses per sentence" | Overcorrections that make speech stilted. The clause cap would flatten exactly the rhythm CRAFT asks for. |
| "Commit full physical acts… frequent somatic contact" | Unasked touching by default works against the consent floor |
| "Unhinged DM driving an uncensored sim", "bold risks over sanitized compliance" | A jailbreak mandate. Mea's content levels are stated plainly inside the locked boundaries, and MOVE's "the one only these people would choose" already asks for the bold option honestly. |
| "120° line of sight" and "10–20 m audio" as fixed numbers | The idea is good (§6 NOW). The numbers aren't how people or rooms work. |
| VAD axes and instincts as numbers in the plan | Numbers don't steer prose. MINDS already asks for a feeling named exactly. |
| Six hand-maintained presets | §3 |

---

## 12. Parts

One PR per part, merged once test, check and build are green. Each part's prompt-test numbers go in its PR.

1. **Adapter plumbing** ✅. `prompt/models.ts`, the `{{model.plan}}` and `{{model.prose}}` macros, the errata text moved over, the no-drafting line for every model, the profile's *Model notes* override and *Extra notes for this model*, and the Inspector line. The drafting line changes the text, so the preset goes v23 → v24. `dropSamplers` wasn't needed: the Anthropic provider already leaves temperature, top_p and top_k out when thinking is on.
2. **Measure first.** The tell census over existing chats, plus a baseline golden run per family on v23. The census is free. The golden runs use paid models, so that part needs a go-ahead with the total first.
3. **Layout v24** (`MEA_PRESET_VERSION` 23 → 24): tags, operator discipline, the CRAFT split, the prose card, planning recall, the leak stripper's new tags, the 15k budget test.
4. **Negatives and priming** (v25): the audit in §8, the `bans` knob wired through the tells and the intimacy module, the name list removed. Kept apart from Part 3 so the bench can tell the two apart.
5. **Fill the adapters** from the census: each family's `plan` and `prose` lines, sampler suggestions, `planScale`, the tail probe setting `tail`.
6. **Bake-off.** v23 against v25 for each family you use (GLM, Claude, Gemini, DeepSeek, Kimi), on the golden scenarios plus three long chats. Keep or revert each change per family, using the adapter's `replace` slot where one family needs it. Paid, so it needs a go-ahead with the total.

**Experiments for after Part 6** (not scheduled): style exemplars from the reserved headroom; the guide's question-form planning ("How will I…?") against fragments; `tail: note` for every family.
