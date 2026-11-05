# Design plan: a sharper preset, tuned per model

> Source: *The FrankenWIRE / TeleWire TRP Guide* (Downloads, 2026-11-05). Target: Mea's built-in preset, [server/src/prompt/mea.ts](../server/src/prompt/mea.ts) (v23).
> Builds on [23-preset-additions.md](23-preset-additions.md), which reviewed an earlier FrankenWIRE text and took some of it.
> **Status:** Parts 1–5 built: the adapters and the no-drafting line (v24), the census and golden baseline, the new layout (v25, §14), the negatives and priming rewrite (v26, §15), and the adapters filled from the measurements (v27, §16). Part 6, the bake-off, has run once on the golden scenarios (§17): v27 on all five families, v23 on GLM and DeepSeek. v23 on the paid models and a second Claude run wait on a go-ahead. MiMo was dropped on 2026-11-05.
> Budget: the preset may send at most **20k tokens** in the worst case (every option at its largest), counted with the model's own tokenizer.

## Contents

1. [Where the preset stands](#1-where-the-preset-stands)
2. [What the guide teaches](#2-what-the-guide-teaches)
3. [One preset or six?](#3-one-preset-or-six)
4. [The model adapter](#4-the-model-adapter)
5. [The new layout (v25)](#5-the-new-layout-v25)
6. [Planning pass with tag recall](#6-planning-pass-with-tag-recall)
7. [The prose card](#7-the-prose-card)
8. [Negatives, operators and priming](#8-negatives-operators-and-priming)
9. [Budget](#9-budget)
10. [Engine work](#10-engine-work)
11. [What not to take](#11-what-not-to-take)
12. [Parts](#12-parts)
13. [Part 2: what the census found](#13-part-2-what-the-census-found)
14. [Part 3: the v25 layout as built](#14-part-3-the-v25-layout-as-built)
15. [Part 4: negatives and priming as built](#15-part-4-negatives-and-priming-as-built)
16. [Part 5: the adapters filled](#16-part-5-the-adapters-filled)
17. [Part 6: the bake-off, golden scenarios](#17-part-6-the-bake-off-golden-scenarios)

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

## 5. The new layout (v25)

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
2. **Measure first** (census ✅, golden baseline ✅ for GLM and DeepSeek. Claude, Gemini and Kimi weren't run, by your choice). `scripts/tell-census.ts` counts each family's habits over your chats, read-only (results in §13). `scripts/golden-models.ts` runs the golden scenarios on one model per family. Without `--go` it only prints the routes and the price. The baseline runs on v24, the version Part 1 shipped: v24 changed only the model notes, and it's the version Part 3 is measured against.
3. **Layout v25** ✅ (`MEA_PRESET_VERSION` 24 → 25; v24 went to Part 1). Tags, operator discipline, the CRAFT split, the prose card, planning recall, the leak checks' new tags, the 15k budget test. What changed from this plan is in §14.
4. **Negatives and priming** ✅ (v26, since v25 went to Part 3): the audit in §8, the `bans` knob wired through the tells and the intimacy module, the name list removed. Kept apart from Part 3 so the bench can tell the two apart. What was built is in §15.
5. **Fill the adapters** ✅ (v27) from the census: each family's `plan` and `prose` lines, sampler suggestions, `planScale`. DeepSeek plans first, in its own step. The tail probe and its `tail` setting moved to after Part 6 (§16).
6. **Bake-off.** ◐ Golden scenarios run (§17); the long chats weren't approved. v23 against v25 for each family you use (GLM, Claude, Gemini, DeepSeek, Kimi), on the golden scenarios plus three long chats. Keep or revert each change per family, using the adapter's `replace` slot where one family needs it. Paid, so it needs a go-ahead with the total.

**Experiments for after Part 6** (not scheduled): style exemplars from the reserved headroom; the guide's question-form planning ("How will I…?") against fragments; `tail: note` for every family.

---

## 13. Part 2: what the census found

`bun scripts/tell-census.ts` read 463 story replies, all written before Part 1's no-drafting line reached your install. Only two families have real numbers: **GLM** (336 replies over 5 chats, GLM 5.2 and 5.3) and **Claude** (126 replies, Opus 4.6 and 5.5). Gemini has one reply, and DeepSeek and Kimi have none, so their adapters need the golden baseline before anything is written for them.

Claude's 126 replies all come from one chat, and GLM wrote 276 replies in that same chat. So the fair comparison is inside it (`--chat`), where the card, the cast and the player are the same and only the model changes:

| Habit (share of replies) | GLM | Claude | Reading |
|---|---:|---:|---|
| Narration sentences that are fragments (median) | 29% | 42% | Claude writes in drumbeats |
| Drumbeat narration (fragments are 40%+ of sentences) | 7% | 57% | Claude |
| A cascade of one-line paragraphs | 4% | 52% | Claude |
| A teaser ending (closing line of three words or fewer) | 7% | 44% | Claude. The current Claude note is right. |
| A line broken off with a dash | 15% | 71% | Claude. The current GLM note ("a broken line in every reply") looks out of date for GLM 5.x. |
| Restarts ("that's — that's", "I — I") | 79% | 85% | Both. It belongs in the shared prose card, not one adapter. |
| Correction framing ("not X but Y") | 46% | 46% | Both, the same |
| Counts for detail ("three seconds") | 20% | 31% | Both, Claude more |
| Textbook words (ozone, sternum) | 27% | 10% | GLM. Missing from its notes. |
| Stock body tells | 20% | 27% | Both |
| Apophasis and litotes | 9% | 15% | Both |
| Office words for people | 70% | 85% | Mostly one word that is this story's own running joke. Without it: "load-bearing" 27% Claude against almost none for GLM, "protocol" 21% against 11%. Claude needs the office-words line as much as GLM. |
| Plans that drafted the story (8+ words reused) | 11% | 14% | The baseline for the no-drafting line. Rerun with `--since 2026-11-05` once v24 has been used for a while. |

**What this changes for Part 5:**
- **Claude's notes** gain drumbeat fragments, one-line cascades, broken-off lines and office words ("load-bearing", "protocol"). The teaser ending stays.
- **GLM's notes** gain textbook words. The "line broken off in every reply" clause is a candidate to drop.
- **Restarts and correction framing** go into the shared `<prose>` card (Part 3), since both families do them at the same rate.
- Every rate here is one story's worth for Claude. The golden baseline gives a second, controlled read, with the same 28 scenarios for every model.

### Golden baseline, subscription models (2026-11-05, v24)

You chose to run only the free models: GLM 5.3 and DeepSeek, both on your NanoGPT subscription. Claude, Gemini and Kimi weren't run. DeepSeek ran twice, the second time with the request breakdown.

| | GLM 5.3 | DeepSeek (latest), run 1 · run 2 |
|---|---:|---:|
| Scenarios passed | 24 / 28 | 23 · 25 / 28 |
| Requests for 16 replies | 20 | 73 · 72 |
| Tokens in | 142k | 345k · 345k |
| Replies that came with a plan | 100% | 88% · 81% |
| Plan words | 174 | 451 · 397 |
| Plans that drafted the story (8+ words reused) | **0%** | 7% · **23%** |
| Story words already in the plan | 0% | 6.1% · 12.5% |

- **Four failures belong to the scenarios, not the models.** `planner-fallback` and `already-said` need the mock's scripted planner (`MOCK_PLANNER_FAIL`), so a real model can't pass them. `held-plan` and `things-stay` fail in the mock's model mode as well. The runner now leaves the first two out for real models, so the next run reads out of 26.
- **GLM** failed one scenario of its own: `retold-past` (it retold a past scene wrongly). With the no-drafting line it planned every reply and drafted none, against 11% drafting in your chats before. The scenes are short, so this doesn't prove the line worked, but it's the right direction.
- **DeepSeek skips its plan, and drafts when it does plan.** The breakdown for run 2:
  - 17 of its first tries came back without a plan and were retried ("asked again" 9 times).
  - 6 replies fell back to the separate planner after the writer skipped twice, and 5 more were planned in their own step.
  - 23% of the plans it did write drafted the story, despite the new line.
  - In `things-stay` the planning pass leaked into the story itself: a "SEAL — SAID: …" line reached the page.
  - Run 1 failed `canon-cutoff`, but run 2 passed it. One run per model is noisy, so a failure needs to repeat before it counts.
- **What this means for DeepSeek's adapter (Part 5):** a stronger note won't be enough. DeepSeek should start in the mode Mea already falls back to: plan in its own step, or with the separate planner, from the first reply. Its route should reason natively where the host allows, and the leak stripper (§5) should catch planning step labels ("SEAL —", "KNOW —") at the start of a line.

**The rest of the golden baseline** (`bun scripts/golden-models.ts`, dry run on 2026-11-05). Each run sends about 186k tokens in and 27–54k out (16 story replies and 5 planner calls, ×1.3 for retries):

| Model | Route | Estimate |
|---|---|---:|
| GLM 5.3 | NanoGPT · Planner (subscription) | $0 |
| DeepSeek (latest) | NanoGPT · Planner (subscription) | $0 |
| Gemini 4 Argon | Nano PAYG ($2 / $10 per M) | ≈ $0.83 |
| Kimi K3.1 Pro | Nano PAYG ($2 / $10 per M) | ≈ $0.83 |
| Claude Opus 5.5 | LinkAPI (`[SP]claude-opus-5-5`), price not listed. On Nano PAYG (`anthropic/claude-opus-5.5`, $4 / $20 per M) it would be ≈ $1.82. | unknown / ≈ $1.82 |

---

## 14. Part 3: the v25 layout as built

**Measured** (o200k, the same render as §1):

| | v23 | v25 |
|---|---:|---:|
| Prefix (cached) | 6,589 | 5,738 (craft 961 → 340, voice 884 → 747) |
| Tail (uncached, every reply) | 1,738 | 2,587 (pass 978, prose card 900) |
| Default total, GLM without reasoning | 8,335 | 8,435 |
| Claude with extended thinking | 8,176 | 8,275 |
| Wild toolkit, lavish rhythm, intimacy scene | 9,139 | 9,241 |

That's about 850 more uncached tokens a reply, close to the ~760 estimated in §9, and about 100 more in total. The worst-case test (every option at its largest, 2,000 characters of extra model notes and 1,000-character limits) stays under 15,000 o200k tokens.

**Changed from the plan:**
- **`<people>` and `<ties>`, not `<minds>` and `<bonds>`.** The toolkit has `<mind>` and `<bond>`, and a renderer matching by prefix could take one for the other. A test now fails if any block tag equals or starts with a toolkit tag, or equals a reply tag (`think`, `plan`, `story`, `ledger`, `fx`). The MINDS step keeps its name.
- **The controls block keeps its `[Story preferences]` header.** It's built in `preset.ts` for every preset, imported ones included, so retagging it is a separate change. Agency and the romance ladder still point at it by that name.
- **The model notes moved into the blocks they correct, and the Model notes block is gone.** `{{model.plan}}` sits in `<pass>` just before STOP RULE, and in `<turn>` when a separate planner planned the reply. `{{model.prose}}` closes the prose card as "For this model: …". STOP RULE no longer repeats "Never draft", since the adapter's no-drafting line now sits right above it for every model.
- **The prose card gained the closing tells** (line 19: aphorisms, teasers, cutaways, roll-calls), moved from `<craft>`, because the census found Claude closing on a teaser in 44% of its replies. Line 15 gathers the shape tells (drumbeat fragments, one-line cascades) and line 18 the speech tells (restarts, office words as replies), the two habits GLM and Claude share.
- **`<pass>` counts as a plan wrapper.** A model that copies the tag and writes its plan inside `<pass>…</pass>` has it moved to reasoning like `<think>`. `<passage>`, the toolkit tag, can't match. Step headers with tags ("NOW <world> —") are recognised by the plan watch and the planning-left-in slip check.
- **The separate planner sees the steps without tags**, since it never sees the blocks they name. Its VOICE step asks for "the prose habit this scene most invites" instead of card numbers.

---

## 15. Part 4: negatives and priming as built

`MEA_PRESET_VERSION` 25 → 26.

**The `bans` knob.** Each adapter now says `bans: "quote"` or `"describe"`, and the preset reads it as `{{model.bans}}`. Every bad phrase the preset names is described by kind. One example is added in brackets, `{{if model.bans == quote}} ("not X but Y"){{/if}}`, only for a quote family. A line never quotes more than one.

| Family | `bans` | Why |
|---|---|---|
| GLM | describe | The census found GLM's office and textbook words in 27% of its replies, and the old lists quoted exactly those words. Its own adapter notes are described too. |
| Claude | quote | §4.3: quoted examples hold up well on Claude. |
| DeepSeek, Gemini, Kimi, GPT, open models, Other, None | quote | Today's behaviour, until the bake-off (Part 6) says otherwise. |

The knob reaches:
- every prose-card line (the card is now built from a table in `mea.ts`, one habit, one example and one replacement per line)
- `<craft>` (filter words), `<voice>` (empty acknowledgements, echoing a name back)
- the intimacy module (vague stand-ins, romance-novel stock)
- the Explicit intimacy setting's euphemism example

Under describe, nothing in the prompt quotes a bad phrase. What's left in quotation marks is the meta-leak rule ("the player", "the user"), toolkit syntax, and the right way to write something ("she grabbed it", "he was cold").

**Removed:**
- **The stock-name list.** "Elara, Seraphina, Kael, Marcus, Lily" is gone. The rule is now "think of five names that fit and use the fifth, since the first is the one every story reaches for". Mea's lore-quality check (`lore/quality.ts`) still keeps its own list of stock names for flagging lorebooks; that isn't sent to the model.
- **The intimacy module's quoted list.** Ten quoted phrases became two described categories.
- **Quoted lines in the turn's rotating hazards.** Every hazard now names what to write instead ("correction framing — say what it is, once", "perfect memory — people forget and misremember"). A test checks each one has a replacement.
- **Slash lists.** "SAID / DID / ATTEMPTED / INTENDS / STATED / OOC", "checkbox/radio", "label for/id" and the toolkit's "Name: line / me: line" are plain lists now.

**Style negatives rewritten as positives** (boundaries, hard limits, the persona seals and "Mea's notes never reach a character's mouth" stay negative, per §8 rule 3):
- **Agency.** "Never restate, paraphrase or answer it point by point" became "People react to its meaning … instead of restating it". The ending rule now says what to end on, not what to avoid asking.
- **People.** "Never just 'upset'" became "the exact one, not the general". The job-or-catchphrase rule now says what a person is, not what they mustn't become.
- **Craft.** Body parts acting alone, "something in her voice", and "don't explain the image" each became the positive form.
- **Voice.** Acknowledgements, sitcom banter, lecturing and echoing now say what a reply does instead.
- **World, toolkit and turn.** Manufactured urgency, visuals at the edges, the swipe's replaced opening, and the invented ending event.

About 30 negative words left the source, from 336 to 307. Most of the rest are knowledge and world rules ("a crisis confession is not intimacy") or are already paired with what to do.

**Measured** (the same small render for both versions, trace token counts):

| | v25 | v26 |
|---|---:|---:|
| GLM, default | 8,151 (prefix 5,848, tail 2,303) | 7,966 (5,836 · 2,130) |
| Claude with extended thinking | 7,991 | 7,928 |
| GLM, wild toolkit, lavish, intimacy scene | 8,957 | 8,746 |
| Prose card, GLM / Claude | 900 / 818 | 716 / 738 |

The rotating hazards cost about 11 tokens more each reply, since each now carries its replacement. Everything else is smaller.

**Not changed:**
- **The craft coach's "habits it's leaning on" line.** It quotes the model's own repeated phrases back. That's data from the story, like the worn-phrase line, not a planted example.
- **There's no setting on the profile for `bans` yet.** Part 6 can compare quote and describe for one family with the adapter's `replace` slot or a profile setting, if the bench needs it.

---

## 16. Part 5: the adapters filled

`MEA_PRESET_VERSION` 26 → 27, since the planning pass's word ceilings became values (`{{plan.routine}}`, `{{plan.charged}}`, `{{plan.pivotal}}`).

**From the census and the golden baseline (§13):**

| Family | What changed | Evidence |
|---|---|---|
| **Claude** | Its notes now name drumbeat fragments, one-line cascades, a line broken off with a dash, and office and engineering words ("load-bearing"), on top of the teaser ending and the summing-up close. They end with what to do: whole sentences, full paragraphs, end on the thing itself. With extended thinking the plan ceilings are scaled by 0.8 (70, 180 and 320 words). | Drumbeats 57%, cascades 52%, broken lines 71%, teasers 44%, "load-bearing" 27% |
| **GLM** | Its notes gain clinical and textbook words for bodies, air and weather. "A line broken off before the sad word in every reply" is gone. The notes stay described, not quoted (Part 4). | Textbook words 27%. Broken lines 15%, not every reply. |
| **DeepSeek** | It **plans first, in its own step**, from its first reply, the way Mea already handles a model after it skips its plan. It doesn't when its route reasons natively, since then its reasoning is the plan. Plan ceilings ×0.8. A single step line that opens the reply in the pass's own words ("SEAL — SAID: …") is now moved out of the story. | Golden: 17 first tries with no plan, 23% of plans drafted, one leaked SEAL line, plans of 400+ words |
| **Gemini, Kimi** | Notes unchanged. There's no census or golden data yet, and §4.3's guesses stay guesses until Part 6. | — |
| **Restarts and correction framing** | Already on the shared prose card (Part 3), since both families do them at the same rate | 79–85%, 46% |

**Sampler suggestions.** Settings → Models shows a line under a profile's Temperature, such as "Mea suggests temperature 1, top_p 0.95: Z.ai's guidance for GLM", with an **Apply** button.
- The line only shows while the profile's own values differ.
- Mea never changes a sampler on its own.
- The suggestion follows the profile's *Model notes* family, and *None* suggests nothing.

| Family | Suggestion | Source |
|---|---|---|
| GLM | temperature 1, top_p 0.95 | Z.ai |
| Gemini | temperature 1 | Google, for Gemini 3 and later: lower can loop |
| Kimi K2 | 0.6; 1 for K2 Thinking | Moonshot. Newer Kimi models (your K3.1 Pro) get no suggestion until one is benched. |
| Claude, DeepSeek | none | Claude is fine at its default, and DeepSeek's scale differs by host |

**Sizes** (the same render as §15): Claude's prose card is 738 → 793 tokens, for its longer notes. The other families are unchanged to within a token. The tier line costs the same number of tokens whatever the ceilings.

**Moved to after Part 6: the tail probe.** It would send a small canary request on each new route to see whether the host moves mid-history system messages to the top, and set the adapter's `tail` from the answer. Claude's route already sends the tail as `<mea_note>` turns, so the probe matters only for OpenAI-compatible hosts. It also costs a request per route. The bake-off will show whether any family's tail is being ignored, and that's the time to build it.

---

## 17. Part 6: the bake-off, golden scenarios

You approved "golden only, ≈ $7" on 2026-11-06: the 28 golden scenarios (26 for a real model) on v23 (before this plan) and v27, one run per model. GLM and DeepSeek ran on your NanoGPT subscription; Gemini 4 Argon, Kimi K3.1 Pro and Claude Opus 5.5 ran on Nano PAYG. The long-chat replays weren't run.

**What ran.** v27 ran on all five. The first v23 run stopped before its first request: its copy of the census needs `prompt/models.ts`, which v23 doesn't have. The copy now carries that file (the census uses it only to name families; v23's prompt never loads it), and v23 ran again on GLM and DeepSeek only, since the paid models on v23 would take the total past the ≈ $7 approved (below).

| | GLM 5.3 v23 · v27 | DeepSeek v23 · v27 | Gemini 4 Argon v27 | Kimi K3.1 Pro v27 | Claude Opus 5.5 v27 |
|---|---:|---:|---:|---:|---:|
| Scenarios passed (of 26) | 25 · 24 | 25 · 23 | 24 | 25 | 25 |
| Requests for 16 replies | 21 · 21 | 54 · 56 | 51 | 47 | 55 |
| Replies with a plan | 100% · 100% | 94% · 94% | 100% | 100% | — |
| Plan words | 347 · 280 | 369 · 331 | 147 | 2,410 | — |
| Plans that drafted the story | 0% · 0% | 7% · **0%** | 0% | **100%** | — |
| Words per reply | 216 · 223 | 117 · 101 | 198 | 85 | — |

**Failures.** `held-plan` fails for every model on both versions, and `things-stay` for three of them: both fail in the mock's model mode too, so they're the scenarios' fault (§13). Apart from those, GLM failed nothing on v27, and DeepSeek failed `retold-past` on v27 only. v23 passed one more scenario than v27 on both free models, but one run per model is noisy (DeepSeek's two v24 runs differed by two, §13): a gap of one or two needs a second run before it means anything.

**What v27 did, by family:**
- **GLM**: no change in requests or failures. Plans are 20% shorter (347 → 280 words), and no plan drafted on either version. Its office words (13% → 19%) and broken-off lines (13% → 25%) are each two or three replies out of 16, too few to read.
- **DeepSeek**: drafting is gone (7% → 0%) and plans are 10% shorter. Requests didn't drop (54 → 56). Mea already plans first for a model that skipped its plan in one of its last three replies, in any chat, and v23 did that 9 times. So `planFirst` only saves its very first skip and the test every six replies, when Mea gives the model's own pass another try. Both versions had 6 tries retried for skipping. The 72 requests of the v24 baseline (§13) came from a different run, not from v23's prompt.
- **Gemini**: no v23 run to compare. It skipped its plan until Mea's fallback caught it, and 12 of its 16 replies were planned in their own step, so **Gemini now plans first too** (`planFirst: true`). Its census is clean apart from office words (38%, 6 replies). Its token counts (16k in for 51 requests) are far too low to be real: Nano PAYG didn't report usage for it.
- **Kimi K3.1 Pro** writes the story inside its plan. 15 of its 16 first tries were a plan with no story after it, and Mea wrote the story from it. Those plans run 2,410 words, every one drafted the story, and 55% of the story's words were already in the plan. The no-drafting line doesn't hold for it. Planning first wouldn't help, since the plan step would draft the same way. What would: running its route with native reasoning, so its thinking stays thinking and isn't the plan Mea asks for. That's a route setting to try, not an adapter line.
- **Claude Opus 5.5**: not readable. Every first try came back empty and was retried (16 of 16), it reported 3k tokens out for 55 requests, and its replies don't show in the census. That's a route problem, not a prompt result: Claude ran on Nano PAYG here, not your LinkAPI route. The run's database was thrown away, so the cause can't be read back. The script now has `--keep run.db`, which saves the run's database (requests, replies, errors), for the next run.

**Cost.** Nano PAYG reported no prices, so this is tokens × list price: Kimi ≈ $1.69 (its long plans doubled the output estimate), Claude at least $2.44 (its output count is too low to trust), Gemini unknown (its counts are wrong; the estimate was $0.83). About **$4.2–5** in all, against the $3.47 estimated for v27. v23 on the three paid models would be about as much again, which is past the ≈ $7 approved.

**Not done, and needs a go-ahead:**
- v23 on Gemini, Kimi and Claude (≈ $4–5).
- Claude again, on LinkAPI or on Nano PAYG with `--keep`, to see why its first tries were empty.
- Kimi with native reasoning on its route.
- The long-chat replays (≈ $13–24, §12).

**Kept, reverted.** Nothing is reverted: no family did clearly worse on v27, and the gains are real but small (no drafting, shorter plans). The open question is the free models' one-scenario gap, which a second free run of each version would settle.
