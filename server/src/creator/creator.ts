import { z } from "zod";
import { emptyCard, normalizeCard } from "../cards/card";
import { all, newId, now, one, parseJson, run } from "../db/db";
import { publish } from "../lib/events";
import { badRequest, notFound } from "../lib/http";
import { countTokens } from "../lib/tokens";
import { getLorebook, linkLorebook, linkedBooks } from "../lore/service";
import { createDraft as createLoreDraft, getDraft as getLoreDraft, mutate as mutateLore } from "../lore/studio";
import { createCharacter, getCard, getCharacterRow, updateCharacter } from "../services/characters";
import { Deferred, enqueue, type JobContext } from "../services/jobs";
import { callJson, callText } from "../services/llm";
import { createPersona, getPersona, updatePersona } from "../services/personas";
import { markPromoted } from "../lore/people";
import { ensureRoleBook, parseAgency, setAgency, writeDepthBook, writeRulesBook } from "./books";
import { type CardIssue, checkExamples, checkGreeting, checkPersona, checkProse, checkScenario } from "./checks";
import { applyExpansionPatch, CRAFT, deepenSection, type Expansion, type ExpansionPatch, expandIdea, expansionBlock, tidy } from "./expand";
import { type Criterion, deepenCap, failedNotes, type GateVerdict, judgeTemp, rubric, runGate, toVerdict, writeTemp } from "./gate";
import { addTaste, askQuestion, type Direction, directions as offerDirections, type Fact, type FactSource, factsBlock, isFactSource, newFact, SOURCE_MARK, spillover, tasteBlock, WEIGHT_RULE } from "./interview";
import { addTurns, applyIdeaChange, BASED_ON_RULE, IDEA_CHANGES, ideaBlock, ideaChanges, isIdeaKind, lastPerSection, withDropNote, canonBlock, canonRule, type ChatTurn, chatBlock, COWRITER, LOOKUP_FIELD, newProposal, personaSlip, type Proposal, type ProposedChange, shortHash, unslipPersona, whoIsWho, withLookups } from "./smarts";
import { BRIEF_RULE, gather, lookup, type Research, researchBlock, wikisFor } from "./research";
import { worldContext } from "./world";
import { linkVersion, type VersionKind } from "../services/linked";
import { snapshotBasis } from "../services/versionsync";
import { applyMapPatch, findLeaks, type Leak, type MapPatch, marksOf, mergeRows, newRow, newVariant, type RowState, type VariantPlan, variantBlock } from "./variantcore";
import { createUniverse, getUniverse, joinUniverse, mergeIntoUniverse } from "../services/universes";

/**
 * The character and persona creator (Phase 4, CHAR-08…15, PER-04…06): Idea (in your words, with
 * "Expand my idea") → Questions (what the model understood as facts you can fix, then one screened
 * question at a time at the biggest gap, then deepening) → Bible (written in passes, linked up and
 * briefed, checked against named criteria) → Write (each card field drafted in the background from
 * the bible, in order, optionally checked and revised once) → Review and save as a real card or
 * persona, with a depth book, a rules book and world agency bound to it when wanted.
 *
 * It links to the Lore Studio both ways: lorebooks (or an unsaved lore draft) are the world every
 * step writes against and are linked on save; any lore entry can become a card; a saved card or
 * persona can get a companion lorebook drafted from its bible.
 */

export type CreatorKind = "character" | "persona";
/** A version (docs/14) also has a map step between its questions and its bible. */
export type CreatorStage = "idea" | "questions" | "map" | "bible" | "write" | "done";
type Length = "lean" | "standard" | "rich";

export interface CreatorOptions {
  pov: "first" | "second" | "third";
  tense: "present" | "past";
  length: Length;
  tone: string;
  style: string;
  /** Companion: one character with {{user}}. Narrator: a storyteller running a world and its cast. */
  mode: "companion" | "narrator";
  /** Alternate greetings to write (CHAR-15). */
  greetings: number;
  /** The description as flowing prose, or as a tagged sheet (labelled blocks; short bullets for a persona). */
  format: "prose" | "tagged";
  /** Check every written field against named criteria and revise it once if it fails. */
  autoCheck: boolean;
  /** On save, deepening answers and depth entries go into a triggered lorebook bound to it. */
  depthBook: boolean;
  /** On save, a character's always-on rules (think before replying, craft, re-anchor) ride in a bound lorebook. */
  rulesBook: boolean;
}

export interface BibleSection {
  key: string;
  label: string;
  text: string;
  /** Yours (your words or your edit), Mea wrote it (its craft), or a guess at something you left open. Computed. */
  origin?: "yours" | "mea" | "guess";
}

export interface CardField {
  key: string;
  label: string;
  value: string;
  status: "empty" | "queued" | "writing" | "done" | "error";
  error: string;
  previous: string | null;
  steer: string;
  /** Fingerprints of the bible sections (and name) it was written from, to spot a stale field. */
  basis: string;
  /** The automatic check's verdict (when it's on), and whether the writer revised it once. */
  gate?: GateVerdict | null;
  revised?: boolean;
  /** You signed it off. */
  accepted?: boolean;
  /** You edited it by hand: rewriting it asks first. */
  edited?: boolean;
}

export interface CreatorQuestion {
  id: string;
  q: string;
  why: string;
  answer: string;
  suggestions: string[];
  /** The bible section it pins down, or "depth" for a deepening question ("" for older drafts). */
  section: string;
  /** Whose words the answer is. */
  source: FactSource;
  directions: Direction[];
  /** Directions already shown, so a new set doesn't repeat them. */
  shown: string[];
  skipped: boolean;
}

/** A triggered depth entry: a deepening answer composed into lore, or detail drafted from the bible. */
export interface DepthEntry {
  id: string;
  title: string;
  content: string;
  keys: string[];
  from: "answer" | "bible" | "you";
  qid?: string;
  gate?: GateVerdict | null;
  /** The entry it became in the depth book. */
  entryId?: string;
}

/** The character a persona is built to play opposite (complement or friction, but reusable). */
export interface Counterpart {
  draftId: string | null;
  characterId: string | null;
  name: string;
  text: string;
}

export interface CreatorDraft {
  id: string;
  kind: CreatorKind;
  name: string;
  stage: CreatorStage;
  idea: string;
  expansion: Expansion | null;
  options: CreatorOptions;
  /** Lorebooks this one lives in: context for every step, linked on save. */
  worldBookIds: string[];
  /** A Lore Studio draft used as the world while it isn't saved yet. */
  loreDraftId: string | null;
  origin: { loreDraftId?: string; loreItemId?: string; fromDraftId?: string; copyOf?: string; versionOf?: { id: string; kind: VersionKind | null; label: string }; fromEntry?: { bookId: string; entryId: string }; personId?: string } | null;
  /** The character or persona being reworked; saving updates it (with version history). */
  baseId: string | null;
  readback: { understood: string; missing: string[]; gaps?: { section: string; note: string }[] } | null;
  questions: CreatorQuestion[];
  bible: BibleSection[];
  bibleCheck: { section: string; problem: string; fix: string }[] | null;
  /** The bible's named checks: specific, hangs together, faithful to your idea… */
  bibleGate: GateVerdict | null;
  /** A short "brief an actor" paragraph and the cause-and-effect links between sections. */
  brief: string;
  links: { from: string; to: string; relation: string }[];
  fields: CardField[];
  savedId: string | null;
  companionLoreDraftId: string | null;
  /** The existing work this is based on, if any: its canon fills the gaps. */
  basedOn: string;
  /** The editor's pass over the written card. */
  fieldCheck: { id: string; field: string; problem: string; fix: string }[] | null;
  chat: ChatTurn[];
  proposal: Proposal | null;
  /** Canon gathered from the web about the work and this person, distilled into a brief. */
  research: Research | null;
  /** The read-back thinks the material describes the other kind (a persona written as a card, or the reverse). */
  kindHint: { kind: CreatorKind; why: string } | null;
  /** You said the kind is right: the read-back stops suggesting the other. */
  kindSure: boolean;
  /** The read-back thinks a card reads as a narrator running a place (or as one character). */
  modeHint: { mode: CreatorOptions["mode"]; why: string } | null;
  /** What you've established, by section and whose words: the read-back's facts and your answers. */
  facts: Fact[];
  /** Sections you'd rather be asked about than have Mea write. */
  claims: string[];
  /** Optional sections switched on (relationship arc, closeness, world agency). */
  optional: string[];
  /** Optional sections the read-back found in your material. */
  detected: string[];
  /** Every steer you've given, fed back into later questions and writing. */
  taste: string[];
  /** Bible sections you edited by hand. */
  editedSections: string[];
  /** Nothing left to ask: the essentials are covered and deepening is at its cap. */
  interviewDone: boolean;
  depth: DepthEntry[];
  depthBookId: string | null;
  rulesBookId: string | null;
  counterpart: Counterpart | null;
  /** A persona's opening written opposite its counterpart, with the relationship register. */
  pairing: { register: string; text: string; appliedTo: string | null } | null;
  /** A version of an existing card or persona (docs/14): its premise, anchors and map. */
  variant: VariantPlan | null;
  createdAt: number;
  updatedAt: number;
}

export const defaultCreatorOptions = (): CreatorOptions => ({ pov: "third", tense: "present", length: "standard", tone: "", style: "", mode: "companion", greetings: 2, format: "prose", autoCheck: false, depthBook: true, rulesBook: false });

// ---------- the bible ----------

export type Impact = "critical" | "high" | "medium" | "low";
/** Ask: the interview asks you. Mixed: it asks the core and writes the rest. Write: Mea writes it from the rest. */
export type Fill = "ask" | "mixed" | "write";
/** The bible is written in passes, each building on the last: who they are inside, how that comes out, how they show. */
type Pass = "psyche" | "disposition" | "presentation";
const PASSES: { id: Pass; label: string; what: string }[] = [
  { id: "psyche", label: "Inner life", what: "who this person is beneath behaviour: values and the behaviour that proves each, the past that forged them, what they want, their flaws, secrets and core contradiction" },
  { id: "disposition", label: "How it comes out", what: "how that inner life produces behaviour: reactions across the range from never to craving, if-then signatures, what they won't say, their stance toward {{user}}, the people around them, and (only if present) how they change as a bond deepens" },
  { id: "presentation", label: "How they show", what: "the surface that follows from everything above: how they look and move, and above all how they sound; habits, details and story hooks" },
];

interface BibleSpec {
  key: string;
  label: string;
  ask: string;
  impact: Impact;
  fill: Fill;
  pass: Pass;
  /** For a mixed section: what you decide, and what Mea writes. */
  you?: string;
  mea?: string;
  /** Off unless your material calls for it (or you switch it on). */
  optional?: boolean;
  /** Only for narrator cards. */
  narratorOnly?: boolean;
}

const IMPACT: Record<Impact, number> = { critical: 4, high: 3, medium: 2, low: 1 };

const BIBLE: Record<CreatorKind, BibleSpec[]> = {
  character: [
    { key: "identity", label: "Identity", ask: "name, age, pronouns, what they are and do, and a one-line pitch", impact: "medium", fill: "mixed", pass: "psyche", you: "who they are and what they do", mea: "the name details, age and pitch" },
    { key: "appearance", label: "Appearance", ask: "build, face, hair, clothes, marks, how they move; details a scene can show", impact: "medium", fill: "write", pass: "presentation" },
    { key: "personality", label: "Personality", ask: "two or three values, each tied to a concrete behaviour that proves it, and the contradiction at their core: two forces that genuinely pull against each other", impact: "critical", fill: "ask", pass: "psyche" },
    { key: "voice", label: "Voice", ask: "vocabulary, rhythm, verbal habits, terms of address, what they never say, then 3–4 sample lines in quotes in different moods", impact: "high", fill: "write", pass: "presentation" },
    { key: "backstory", label: "Backstory", ask: "formative events with places and how long ago, and the value or habit each one forged", impact: "critical", fill: "ask", pass: "psyche" },
    { key: "motivation", label: "Wants and fears", ask: "the lifelong goal they're really after, the obstacle in its way (often inside them), how they pursue it turn to turn, the need under the want, and what they fear", impact: "high", fill: "mixed", pass: "psyche", you: "the goal", mea: "the obstacle and the strategy" },
    { key: "flaws", label: "Flaws", ask: "two or three real flaws that cause trouble in scenes", impact: "medium", fill: "write", pass: "psyche" },
    { key: "gradient", label: "Reaction range", ask: "WON'T: what no amount of closeness unlocks; FLAT: topics that genuinely leave them unmoved (concrete and load-bearing); OPENS TO: what they engage once trust is earned; CRAVES: each craving paired with what repels them; TRUST: the one observable act that earns their trust", impact: "critical", fill: "mixed", pass: "disposition", you: "hard limits and cravings", mea: "flat reactions and the trust gate" },
    { key: "tensions", label: "If this, then that", ask: "4–6 lines \"IF {specific trigger} THEN {specific reaction}\", drawn from the contradiction and their beliefs", impact: "high", fill: "write", pass: "disposition" },
    { key: "negative", label: "What they won't say", ask: "what they avoid saying, how they deflect when pressed, and the tells that leak when they're cornered", impact: "medium", fill: "write", pass: "disposition" },
    { key: "relationships", label: "Relationships", ask: "3–5 named people: who they are to them and where it stands now", impact: "medium", fill: "write", pass: "disposition" },
    { key: "secrets", label: "Secrets", ask: "what they hide, from whom, and what happens if it comes out", impact: "medium", fill: "mixed", pass: "psyche", you: "the secret", mea: "who knows and what it costs" },
    { key: "details", label: "Habits and details", ask: "routines, possessions, places, tells, likes and dislikes", impact: "low", fill: "write", pass: "presentation" },
    { key: "user", label: "With {{user}}", ask: "how they meet or know {{user}}, their default stance toward someone like them, what they want from {{user}}, and the tension in the dynamic", impact: "high", fill: "ask", pass: "disposition" },
    { key: "arc", label: "Relationship arc", ask: "only if they change as the bond deepens: the one through-line trait shown at low, mid and high closeness, the early hint of who they become, and which reactions shift (hard limits never move)", impact: "high", fill: "ask", pass: "disposition", optional: true },
    { key: "intimacy", label: "Closeness", ask: "structural and never explicit: what draws them, what they refuse, where the lines are, and how desire shows in behaviour", impact: "medium", fill: "ask", pass: "disposition", optional: true },
    { key: "agency", label: "World agency", ask: 'whether the world pushes back. Write "Agenda: …" (what the world quietly works toward regardless of the player), then "Holds:" and 1–4 lines starting "- " (lines that never break under pressure)', impact: "high", fill: "mixed", pass: "disposition", you: "the agenda", mea: "the holds", optional: true, narratorOnly: true },
    { key: "hooks", label: "Story hooks", ask: "four situations a story with them could open with", impact: "low", fill: "write", pass: "presentation" },
  ],
  persona: [
    { key: "identity", label: "Identity", ask: "name, age, pronouns, what they are and do", impact: "medium", fill: "mixed", pass: "psyche", you: "who they are", mea: "the details" },
    { key: "appearance", label: "Appearance", ask: "build, face, hair, clothes, marks, how they carry themselves", impact: "medium", fill: "write", pass: "presentation" },
    { key: "personality", label: "Personality", ask: "traits shown as behaviour, and the contradiction at their core", impact: "critical", fill: "ask", pass: "psyche" },
    { key: "voice", label: "Voice", ask: "how they talk, with 2–3 sample lines in quotes", impact: "high", fill: "write", pass: "presentation" },
    { key: "background", label: "Background", ask: "where they come from and the events that shaped them, with places and times", impact: "critical", fill: "ask", pass: "psyche" },
    { key: "relationships", label: "Relationships", ask: "3–5 named people in their life and where it stands", impact: "medium", fill: "write", pass: "presentation" },
    { key: "skills", label: "Skills and limits", ask: "what they're good at, what they can't do, and what that costs them", impact: "medium", fill: "mixed", pass: "psyche", you: "what they're good at", mea: "the limits and their cost" },
    { key: "motivation", label: "What they want", ask: "their goal, their need, their fear", impact: "high", fill: "ask", pass: "psyche" },
    { key: "details", label: "Habits and details", ask: "routines, possessions, tells, likes and dislikes", impact: "low", fill: "write", pass: "presentation" },
  ],
};

export const OPTIONAL_SECTIONS = ["arc", "intimacy", "agency"];

const NARRATOR_BIBLE: Record<string, string> = {
  identity: "the story's premise and the narrator's role: what world it runs, whose story it tells, its stance",
  voice: "the narration's voice: register, rhythm, how it handles description, dialogue and pacing, with 2–3 sample lines",
  relationships: "the main cast: 4–6 named characters with role, want and how they relate to {{user}}",
  user: "the role {{user}} plays in this world, how the world reads and treats them, and what it wants from them",
  gradient: "how the world reacts: what it will never allow, what it ignores, what it rewards once the player earns standing, and what it hungers for",
};

/** The sections this draft has: the kind's, optional ones only when switched on (agency only for a narrator). */
function specsOf(d: Pick<CreatorDraft, "kind" | "options" | "optional">): BibleSpec[] {
  return BIBLE[d.kind]
    .filter((s) => !s.narratorOnly || (d.kind === "character" && d.options.mode === "narrator"))
    .filter((s) => !s.optional || d.optional.includes(s.key))
    .map((s) => ({ ...s, ask: (d.options.mode === "narrator" && d.kind === "character" && NARRATOR_BIBLE[s.key]) || s.ask }));
}

const specOf = (kind: CreatorKind, key: string) => BIBLE[kind].find((b) => b.key === key);
const labelFor = (kind: CreatorKind) => (key: string) => (key === "depth" ? "Depth" : (specOf(kind, key)?.label ?? key));

// ---------- the card fields ----------

const WORDS: Record<string, Record<Length, string>> = {
  description: { lean: "220–320", standard: "320–480", rich: "450–700" },
  greeting: { lean: "100–200", standard: "160–320", rich: "260–450" },
  personaDescription: { lean: "60–110", standard: "90–160", rich: "140–240" },
  background: { lean: "80–140", standard: "120–220", rich: "200–340" },
};

function fieldSpecs(kind: CreatorKind, o: CreatorOptions): { key: string; label: string }[] {
  if (kind === "persona")
    return [
      { key: "description", label: "Description" },
      { key: "appearance", label: "Appearance" },
      { key: "personality", label: "Personality" },
      { key: "background", label: "Background" },
      { key: "pronouns", label: "Pronouns" },
    ];
  return [
    { key: "description", label: "Description" },
    { key: "personality", label: "Personality summary" },
    { key: "scenario", label: "Scenario" },
    { key: "first_mes", label: "Greeting" },
    ...Array.from({ length: Math.max(0, Math.min(5, o.greetings)) }, (_, i) => ({ key: `alt_${i + 1}`, label: `Alternate greeting ${i + 1}` })),
    { key: "mes_example", label: "Example dialogue" },
    { key: "rules", label: "Rules" },
    { key: "tags", label: "Tags" },
    { key: "creator_notes", label: "Creator notes" },
  ];
}

const POV: Record<CreatorOptions["pov"], string> = {
  first: 'Narrate as {{char}} in first person ("I"), {{user}} as "you" or by {{user}}.',
  second: 'Narrate in second person: {{user}} is "you", but only for what they can see, hear and touch; {{char}} is in third person by name.',
  third: "Narrate in third person: {{char}} by name, {{user}} as {{user}}.",
};

export const GREETING_RULES = (o: Pick<CreatorOptions, "pov" | "tense">) =>
  [
    `${POV[o.pov]} ${o.tense === "past" ? "Past" : "Present"} tense.`,
    "Open in motion, inside a concrete scene: a place, a time, something already happening. Let the voice and personality show through what they do and say (dialogue in double quotes). Include sensory detail.",
    "The narration sees through {{char}}'s lens: what they notice and the words they'd choose, never a neutral camera reporting events.",
    "Give {{user}} a clear reason to respond, and end on an open hook: a question, an offer, a gesture, something left unresolved.",
    "NEVER write {{user}}'s actions, words, thoughts or feelings, and never decide what {{user}} does. Only describe what {{user}} could perceive.",
  ].join(" ");

/** The description as a tagged sheet: labelled blocks, load-bearing first (Lumiverse's Weaver bundle, adapted). */
const TAGGED_DESCRIPTION = [
  "Write it as a TAGGED SHEET: these bracket-tagged blocks in this order, each drawn faithfully from the bible, terse and specific, no preamble or closing summary:",
  "[CORE] `{Name}: {one-line essence}.` then `Values:` 2–3 values as `{value} → {the concrete behaviour that proves it}`.",
  "[ARC] 3–5 formative beats, past tense, each `{when}, {what happened} → {what it taught them}.` followed by `*forged {the value or habit it made}* *excuses {what it now lets them justify}*`.",
  "[FORM] start with `(for reference, never recited)`, then build, height, the few visible details that matter, distinguishing tells, what their body lets them do or prevents, and presence (voice timbre, scent, how they hold distance).",
  "[TENSIONS] `IF {trigger} THEN {response}.` lines, then `Conflicts: {X} vs {Y}`.",
  "[INTENT] `Goal:`, `Obstacle:`, `Strategy:` lines.",
  "[NEGATIVE SPACE] what they won't say or do, how they deflect, the tell when cornered.",
  "[GRADIENT] `WON'T:`, `FLAT:`, `OPENS TO:`, `CRAVES: {craving} (vs. {aversion})`, `TRUST:` lines.",
  "[WITH {{user}}] their stance toward {{user}} and the tension in it.",
  "Add [ARC OF THE BOND] only if the bible has a relationship arc (low vs high closeness; hard limits never move), and [CLOSENESS] only if it has closeness material (structural, never explicit).",
].join("\n");

const TAGGED_PERSONA = "Write it as short bullet lines (a few words to one sentence each) under these headings, lean because it rides every turn: \"## Identity\", \"## Appearance\", \"## Personality\", \"## Drive\". Only what matters at a glance; history and secrets belong in depth entries, not here.";

function fieldAsk(kind: CreatorKind, key: string, o: CreatorOptions, label: string): string {
  const narrator = o.mode === "narrator";
  if (kind === "persona") {
    switch (key) {
      case "description":
        if (o.format === "tagged") return `The persona's description, as the AI storyteller will read it every turn: who this person is in the story, by name, in third person. ${TAGGED_PERSONA} Describe; never script their choices or feelings in a scene.`;
        return `The persona's description, as the AI storyteller will read it: who this person is in the story. ${WORDS.personaDescription![o.length]} words, third person, present tense, by name: identity and role, personality as behaviour, what they want, and what others notice first. Describe; never script their choices or feelings in a scene.`;
      case "appearance":
        return "Their appearance: 50–120 words, concrete and visual: build, face, hair, clothes, marks, how they carry themselves.";
      case "personality":
        return "Their personality: 40–100 words of traits shown as behaviour, the contradiction at their core, and how they talk.";
      case "background":
        return `Their background: ${WORDS.background![o.length]} words: where they come from, the events that shaped them, the people in their life by name, their skills and limits.`;
      case "pronouns":
        return "Only their pronouns as subject/object/possessive, like she/her/her or they/them/their. Nothing else.";
    }
  }
  switch (key) {
    case "description":
      return narrator
        ? `The card's main description for a narrator card: the world, its premise and tone, the main cast by name (role, want, how they talk), the places stories happen, and how the narrator runs scenes and plays every character except {{user}}. ${WORDS.description![o.length]} words, flowing prose in short paragraphs.`
        : o.format === "tagged"
          ? `The card's main description: who they are, as a reference sheet for a storyteller. ${TAGGED_DESCRIPTION} Use their name and {{user}} for the player's character.`
          : `The card's main description: who they are, written as reference for a storyteller. ${WORDS.description![o.length]} words, third person, present tense, flowing prose in short paragraphs (no bullet lists, no W++ or brackets). Cover identity and role; appearance (concrete, with how they move); personality shown through behaviour and its contradiction; voice and speech habits; the past that matters now; wants, fears and flaws; key relationships by name; secrets (say plainly who knows them); and their relationship to {{user}}. Use their name for them and {{user}} for the player's character.`;
    case "personality":
      return "A compact personality summary: 30–70 words, the core traits as behaviour plus the contradiction, in one or two sentences.";
    case "scenario":
      return narrator
        ? "The scenario: where and when the story opens, what is happening in the world, and the role {{user}} steps into. 50–130 words, present tense."
        : "The scenario: the situation the story starts from: where and when, what is going on, how they and {{user}} stand with each other right now, and the tension in the air. 50–130 words, present tense, third person, with {{user}} for the player. Never decide {{user}}'s feelings or actions. Then a last line starting \"Scene-objective:\": what {{char}} is trying to find out or achieve in this opening scene, drawn from their wants.";
    case "first_mes":
      return narrator
        ? `The greeting: the story's opening, told by the narrator. Set the scene in one specific place of the world, bring in one or two of the cast through what they do and say, and put a choice or a problem in front of {{user}}. ${WORDS.greeting![o.length]} words. ${GREETING_RULES(o)}`
        : `The greeting: the story's opening message, written by {{char}}. ${WORDS.greeting![o.length]} words. ${GREETING_RULES(o)}`;
    case "mes_example":
      return 'Example dialogue that teaches the voice. Four or five short exchanges, each starting with a line "<START>", then a line "{{user}}: …" (short and neutral) and a line "{{char}}: …" (2–5 sentences: narration in {{char}}\'s own lens as in the greeting, dialogue in double quotes). Cover distinct beats, not one register repeated: a peak emotional moment, a boundary they hold, their humour, a choice driven by one of their values, and an everyday exchange. If the bible has a relationship arc, make one exchange low closeness and one high closeness, showing the same through-line. Use the habits in the voice section and the reaction range.';
    case "rules":
      return "The card's built-in rules (CHAR-17): a short re-anchor block the model reads after the chat history every turn. 50–120 words as 4–7 terse bullet points in the imperative: the voice markers to keep, what they would never do or say, the limits of what they know, the dynamic with {{user}} to preserve, and \"Never write {{user}}'s actions, words, thoughts or feelings.\" Only what's specific to this character; use {{char}} and {{user}}.";
    case "tags":
      return "4–8 short lowercase tags (genre, setting, role, tone), comma-separated. Nothing else.";
    case "creator_notes":
      return "Creator notes for the player (never sent to the model): 2–4 sentences on who this is, what kind of story they suit, and tips for playing them.";
  }
  if (key.startsWith("alt_"))
    return `${label}: a genuinely different opening from the greetings already written: a different place, time, mood or stage of the relationship, drawn from the story hooks. ${WORDS.greeting![o.length]} words. ${GREETING_RULES(o)}`;
  return `The ${label}.`;
}

// ---------- storage ----------

interface Row {
  id: string;
  kind: string;
  name: string;
  data: string;
  created_at: number;
  updated_at: number;
}

const normField = (f: Partial<CardField> & { key: string; label: string }): CardField => ({ value: "", status: f.value ? "done" : "empty", error: "", previous: null, steer: "", basis: "", ...f });

function hydrate(r: Row): CreatorDraft {
  const d = parseJson<Partial<CreatorDraft>>(r.data, {});
  const kind = (r.kind === "persona" ? "persona" : "character") as CreatorKind;
  const options = { ...defaultCreatorOptions(), ...d.options };
  return {
    id: r.id,
    kind,
    name: r.name,
    stage: d.stage ?? "idea",
    idea: d.idea ?? "",
    expansion: d.expansion ?? null,
    options,
    worldBookIds: d.worldBookIds ?? [],
    loreDraftId: d.loreDraftId ?? null,
    origin: d.origin ?? null,
    baseId: d.baseId ?? null,
    readback: d.readback ?? null,
    questions: (d.questions ?? []).map((q) => ({ ...q, suggestions: q.suggestions ?? [], section: q.section ?? "", source: isFactSource(q.source) ? q.source : "typed", directions: q.directions ?? [], shown: q.shown ?? [], skipped: q.skipped ?? false })),
    bible: d.bible ?? [],
    bibleCheck: d.bibleCheck ?? null,
    bibleGate: d.bibleGate ?? null,
    brief: d.brief ?? "",
    links: d.links ?? [],
    fields: syncFields(kind, options, d.fields ?? []),
    savedId: d.savedId ?? null,
    companionLoreDraftId: d.companionLoreDraftId ?? null,
    basedOn: d.basedOn ?? "",
    fieldCheck: d.fieldCheck ?? null,
    chat: d.chat ?? [],
    proposal: d.proposal ?? null,
    research: d.research ?? null,
    kindHint: d.kindHint ?? null,
    kindSure: d.kindSure ?? false,
    modeHint: d.modeHint ?? null,
    facts: d.facts ?? [],
    claims: d.claims ?? [],
    optional: d.optional ?? [],
    detected: d.detected ?? [],
    taste: d.taste ?? [],
    editedSections: d.editedSections ?? [],
    interviewDone: d.interviewDone ?? false,
    depth: d.depth ?? [],
    depthBookId: d.depthBookId ?? null,
    rulesBookId: d.rulesBookId ?? null,
    counterpart: d.counterpart ?? null,
    pairing: d.pairing ?? null,
    variant: d.variant ? { ...newVariant(d.variant), ...d.variant } : null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

const AUTHOR_SOURCES: FactSource[] = ["idea", "typed", "picked", "extended"];

/** Whose a bible section is: yours if you edited it or it rests on your facts, Mea's craft, or a guess at what you left open. */
export function sectionOrigin(d: CreatorDraft, key: string): BibleSection["origin"] {
  if (d.editedSections.includes(key)) return "yours";
  if (d.facts.some((f) => f.section === key && AUTHOR_SOURCES.includes(f.source))) return "yours";
  const spec = specOf(d.kind, key);
  return !spec || spec.fill === "write" ? "mea" : "guess";
}

/** Bible sections carry their origin (recomputed on every read and write). */
function withOrigins(d: CreatorDraft) {
  d.bible = d.bible.map((b) => ({ ...b, origin: sectionOrigin(d, b.key) }));
  return d;
}

/** The field list follows the options (more or fewer alternate greetings), keeping what's written. */
function syncFields(kind: CreatorKind, o: CreatorOptions, have: CardField[]) {
  return fieldSpecs(kind, o).map((s) => normField({ ...have.find((f) => f.key === s.key), ...s }));
}

function write(d: CreatorDraft) {
  const { id, name, kind, createdAt: _c, updatedAt: _u, ...data } = d;
  d.updatedAt = now();
  run("UPDATE creator_drafts SET name = ?, kind = ?, data = ?, updated_at = ? WHERE id = ?", name, kind, JSON.stringify(data), d.updatedAt, id);
  publish({ type: "creator.changed", draftId: id });
}

export function getCreatorDraft(id: string) {
  const r = one<Row>("SELECT * FROM creator_drafts WHERE id = ?", id);
  return r ? withOrigins(hydrate(r)) : undefined;
}

export function mustCreator(id: string) {
  const d = getCreatorDraft(id);
  if (!d) throw notFound("Draft not found");
  return d;
}

export function mutateCreator(id: string, fn: (d: CreatorDraft) => void) {
  const d = mustCreator(id);
  fn(d);
  d.fields = syncFields(d.kind, d.options, d.fields);
  withOrigins(d);
  write(d);
  return d;
}

export function listCreatorDrafts() {
  return all<Row>("SELECT * FROM creator_drafts ORDER BY updated_at DESC").map((r) => {
    const d = hydrate(r);
    return { id: d.id, kind: d.kind, name: d.name, stage: d.stage, written: d.fields.filter((f) => f.value.trim()).length, fields: d.fields.length, writing: d.fields.filter((f) => f.status === "queued" || f.status === "writing").length, savedId: d.savedId, updatedAt: d.updatedAt };
  });
}

export function deleteCreatorDraft(id: string) {
  run("DELETE FROM creator_drafts WHERE id = ?", id);
  publish({ type: "creator.changed", draftId: id });
}

// ---------- create ----------

export interface CreatorInput {
  kind: CreatorKind;
  idea?: string;
  name?: string;
  /** Rework an existing character or persona. */
  baseId?: string | null;
  /** Start from a Lore Studio item (a person in the world). */
  fromLore?: { draftId: string; itemId: string } | null;
  /** Start from another creator draft: a character's persona twin, or the other way round (PER-06). */
  fromDraftId?: string | null;
  /** With baseId: rebuild from that card or persona but save as a new one, leaving the original untouched. */
  asCopy?: boolean;
  /** With baseId: save as a new card or persona linked to the original as its version (docs/14). */
  asVersion?: { kind?: VersionKind | null; label?: string; universeId?: string | null } | null;
  /** Start from an entry in a saved lorebook (a person promoted from a world's roster); the book comes along. */
  fromEntry?: { bookId: string; entryId: string } | null;
  /** The roster person being promoted (lore/people.ts), to link back on save. */
  personId?: string | null;
  /** A persona built to play opposite this character (a creator draft or a saved card). */
  oppositeOf?: { draftId?: string | null; characterId?: string | null } | null;
  worldBookIds?: string[];
  loreDraftId?: string | null;
  options?: Partial<CreatorOptions>;
}

/** What a persona built opposite a character needs to know about them: who they are, how they sound. */
function counterpartOf(input: NonNullable<CreatorInput["oppositeOf"]>): Counterpart {
  if (input.draftId) {
    const src = mustCreator(input.draftId);
    const v = (k: string) => src.fields.find((f) => f.key === k)?.value.trim() ?? "";
    const sec = (k: string) => src.bible.find((b) => b.key === k)?.text.trim() ?? "";
    const text = [src.brief && `Brief: ${src.brief}`, sec("identity") && `Identity: ${sec("identity")}`, (v("description") || sec("personality")).slice(0, 1500) && `Who they are: ${(v("description") || sec("personality")).slice(0, 1500)}`, sec("voice") && `Voice: ${sec("voice").slice(0, 800)}`, sec("user") && `With {{user}}: ${sec("user")}`].filter(Boolean).join("\n");
    return { draftId: src.id, characterId: src.savedId, name: src.name, text };
  }
  const c = input.characterId ? getCard(input.characterId) : undefined;
  if (!c) throw notFound("Character not found");
  return { draftId: null, characterId: input.characterId!, name: c.name, text: [`Who they are: ${c.description.slice(0, 1500)}`, c.personality && `Personality: ${c.personality}`, c.scenario && `Scenario: ${c.scenario.slice(0, 600)}`].filter(Boolean).join("\n") };
}

function cardIdea(id: string) {
  const c = getCard(id);
  if (!c) throw notFound("Character not found");
  const f = (l: string, v: string) => (v?.trim() ? `${l}: ${v.trim()}` : "");
  return { name: c.name, idea: [f("Description", c.description), f("Personality", c.personality), f("Scenario", c.scenario), f("Greeting", c.first_mes.slice(0, 2000)), f("Example dialogue", c.mes_example.slice(0, 1500))].filter(Boolean).join("\n\n") };
}

function personaIdea(id: string) {
  const p = getPersona(id);
  if (!p) throw notFound("Persona not found");
  const d = p.data;
  return { name: p.name, idea: [d.pronouns && `Pronouns: ${d.pronouns}`, d.description && `Description: ${d.description}`, d.appearance && `Appearance: ${d.appearance}`, d.personality && `Personality: ${d.personality}`, d.background && `Background: ${d.background}`].filter(Boolean).join("\n\n") };
}

function currentFields(kind: CreatorKind, id: string): Record<string, string> {
  if (kind === "persona") {
    const p = getPersona(id);
    return p ? { ...p.data } : {};
  }
  const c = getCard(id);
  if (!c) return {};
  return {
    description: c.description,
    personality: c.personality,
    scenario: c.scenario,
    first_mes: c.first_mes,
    ...Object.fromEntries(c.alternate_greetings.slice(0, 5).map((g, i) => [`alt_${i + 1}`, g])),
    mes_example: c.mes_example,
    rules: c.post_history_instructions.replace(/^\{\{original\}\}\s*/i, ""),
    tags: c.tags.join(", "),
    creator_notes: c.creator_notes,
  };
}

/** The variant studio's plan a saved version was made with (the latest draft that saved it), if any. */
export function variantPlanOf(kind: CreatorKind, savedId: string): VariantPlan | null {
  const rows = all<Row>("SELECT * FROM creator_drafts WHERE kind = ? AND json_extract(data, '$.savedId') = ? AND json_extract(data, '$.variant') IS NOT NULL ORDER BY updated_at DESC", kind, savedId);
  for (const r of rows) {
    const v = hydrate(r).variant;
    if (v) return v;
  }
  return null;
}

/** The bible the creator wrote for a saved card or persona, if it made one (the latest draft that saved it). */
function originBible(kind: CreatorKind, savedId: string) {
  const rows = all<Row>("SELECT * FROM creator_drafts WHERE kind = ? AND json_extract(data, '$.savedId') = ? ORDER BY updated_at DESC", kind, savedId);
  for (const r of rows) {
    const bible = hydrate(r).bible.filter((b) => b.text.trim());
    if (bible.length) return bible.map((b) => ({ key: b.key, label: b.label, text: b.text }));
  }
  return null;
}

export function createCreatorDraft(input: CreatorInput): CreatorDraft {
  const id = newId();
  const t = now();
  const options = { ...defaultCreatorOptions(), ...input.options };
  const d: CreatorDraft = {
    id,
    kind: input.kind,
    name: input.name?.trim() ?? "",
    stage: "idea",
    idea: input.idea?.trim() ?? "",
    expansion: null,
    options,
    worldBookIds: [...new Set(input.worldBookIds ?? [])],
    loreDraftId: input.loreDraftId ?? null,
    origin: null,
    baseId: null,
    readback: null,
    questions: [],
    bible: [],
    bibleCheck: null,
    bibleGate: null,
    brief: "",
    links: [],
    fields: syncFields(input.kind, options, []),
    savedId: null,
    companionLoreDraftId: null,
    basedOn: "",
    fieldCheck: null,
    chat: [],
    proposal: null,
    research: null,
    kindHint: null,
    kindSure: false,
    modeHint: null,
    facts: [],
    claims: [],
    optional: [],
    detected: [],
    taste: [],
    editedSections: [],
    interviewDone: false,
    depth: [],
    depthBookId: null,
    rulesBookId: null,
    counterpart: null,
    pairing: null,
    variant: null,
    createdAt: t,
    updatedAt: t,
  };
  if (input.baseId) {
    const base = input.kind === "character" ? cardIdea(input.baseId) : personaIdea(input.baseId);
    // A copy rebuilds from the original but saves as a new one; the original stays as it is.
    if (input.asVersion) d.origin = { copyOf: input.baseId, versionOf: { id: input.baseId, kind: input.asVersion.kind ?? null, label: input.asVersion.label?.trim() ?? "" } };
    else if (input.asCopy) d.origin = { copyOf: input.baseId };
    else d.baseId = input.baseId;
    d.name ||= base.name;
    if (input.asVersion) {
      // A version keeps the original as its source and the premise apart: every step reads both.
      d.variant = newVariant({ originKind: input.kind, originId: input.baseId, originName: base.name, kind: input.asVersion.kind, label: input.asVersion.label, premise: d.idea, originBible: originBible(input.kind, input.baseId) });
      if (input.asVersion.universeId) joinDraftUniverse(d.variant, input.asVersion.universeId);
      d.idea = base.idea;
    } else d.idea = [base.idea, d.idea && `WHAT TO CHANGE: ${d.idea}`].filter(Boolean).join("\n\n");
    // The rework keeps the world it already lives in.
    d.worldBookIds = [...new Set([...d.worldBookIds, ...linkedBooks(input.kind, input.baseId).map((b) => b.id)])];
    if (input.kind === "character") d.options.mode = (getCharacterRow(input.baseId)?.mode as CreatorOptions["mode"]) ?? d.options.mode;
    // The current fields are the starting point: you rewrite only what you choose, nothing is blanked.
    const current = currentFields(input.kind, input.baseId);
    if (input.kind === "character") d.options.greetings = Math.min(5, Object.keys(current).filter((k) => k.startsWith("alt_")).length);
    d.fields = syncFields(input.kind, d.options, []).map((f) => (current[f.key]?.trim() ? { ...f, value: current[f.key]!, status: "done" } : f));
  }
  if (input.fromLore) {
    const lore = getLoreDraft(input.fromLore.draftId);
    const item = lore?.items.find((i) => i.id === input.fromLore!.itemId);
    if (!lore || !item) throw notFound("Lore entry not found");
    d.name ||= item.title;
    const secrets = item.entry?.secrets.map((s) => `Secret${s.knownBy.length ? ` (known to ${s.knownBy.join(", ")})` : ""}: ${s.text}`) ?? [];
    d.idea = [d.idea, `${item.title}${item.pitch ? `: ${item.pitch}` : ""}`, item.entry?.content ?? item.source, ...secrets].filter(Boolean).join("\n\n");
    d.origin = { loreDraftId: lore.id, loreItemId: item.id };
    d.basedOn ||= lore.basedOn;
    if (lore.committedBookId) d.worldBookIds = [...new Set([...d.worldBookIds, lore.committedBookId])];
    else d.loreDraftId = lore.id;
    d.options.tone ||= lore.options.tone;
  }
  if (input.fromDraftId) {
    const src = mustCreator(input.fromDraftId);
    d.name ||= src.name;
    d.idea ||= src.idea;
    d.expansion = src.expansion && { ...src.expansion, sections: src.expansion.sections.map((s) => ({ ...s, id: newId() })) };
    d.worldBookIds = [...new Set([...d.worldBookIds, ...src.worldBookIds])];
    d.loreDraftId ??= src.loreDraftId;
    d.questions = src.questions.filter((q) => q.answer.trim()).map((q) => ({ ...q, id: newId() }));
    // Sections both kinds share carry over; the bible is then filled in for the new kind.
    const keys = new Set(BIBLE[input.kind].map((b) => b.key));
    d.bible = src.bible.filter((b) => keys.has(b.key) && b.text.trim()).map((b) => ({ ...b, label: BIBLE[input.kind].find((x) => x.key === b.key)!.label }));
    d.facts = src.facts.filter((f) => keys.has(f.section)).map((f) => ({ ...f, id: newId() }));
    d.taste = [...src.taste];
    d.origin = { fromDraftId: src.id };
    d.basedOn ||= src.basedOn;
    d.options = { ...d.options, tone: src.options.tone, style: src.options.style, length: src.options.length };
    d.stage = d.bible.length ? "bible" : "idea";
  }
  if (input.fromEntry) {
    const book = getLorebook(input.fromEntry.bookId);
    const entry = book?.entries.find((e) => e.id === input.fromEntry!.entryId);
    if (!book || !entry) throw notFound("Lore entry not found");
    d.name ||= entry.comment || entry.keys[0] || "";
    d.idea = [d.idea, entry.content].filter(Boolean).join("\n\n");
    d.worldBookIds = [...new Set([...d.worldBookIds, book.id])];
    d.origin = { ...d.origin, fromEntry: input.fromEntry, ...(input.personId ? { personId: input.personId } : {}) };
  }
  if (input.oppositeOf && input.kind === "persona") {
    d.counterpart = counterpartOf(input.oppositeOf);
    const src = input.oppositeOf.draftId ? mustCreator(input.oppositeOf.draftId) : null;
    if (src) {
      d.worldBookIds = [...new Set([...d.worldBookIds, ...src.worldBookIds])];
      d.loreDraftId ??= src.loreDraftId;
      d.options = { ...d.options, tone: src.options.tone, style: src.options.style };
    }
    // A blank idea is fine: Mea invents someone who fits opposite them.
    d.idea ||= `Someone to play opposite ${d.counterpart.name}: invent a specific, grounded person who complements or rubs against them.`;
  }
  if (!d.idea.trim() && !d.bible.length && !input.fromLore) throw badRequest(input.kind === "persona" ? "Describe who you want to be first" : "Describe your character first");
  d.name ||= input.kind === "persona" ? "New persona" : "New character";
  const { id: _i, name, kind, createdAt: _c, updatedAt: _u, ...data } = d;
  run("INSERT INTO creator_drafts (id, kind, name, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)", id, kind, name, JSON.stringify(data), t, t);
  if (input.fromLore)
    mutateLore(input.fromLore.draftId, (l) => {
      const it = l.items.find((i) => i.id === input.fromLore!.itemId);
      if (it) it.links = { ...it.links, creatorDraftId: id };
    });
  publish({ type: "creator.changed", draftId: id });
  return d;
}

// ---------- edits ----------

export interface CreatorPatch {
  name?: string;
  stage?: CreatorStage;
  idea?: string;
  options?: Partial<CreatorOptions>;
  answers?: Record<string, string>;
  /** Whose words each answer is, by question id (typed, picked from directions, or extended). */
  answerSources?: Record<string, FactSource>;
  worldBookIds?: string[];
  loreDraftId?: string | null;
  expansion?: ExpansionPatch;
  bible?: Record<string, string>;
  fields?: Record<string, string>;
  /** Sign fields off (or take the tick back). */
  accepted?: Record<string, boolean>;
  basedOn?: string;
  /** "It's right as it is": hides the read-back's other-kind suggestion. */
  dismissKindHint?: boolean;
  dismissModeHint?: boolean;
  /** Fact edits: a new fact has no id; `remove` drops one. */
  facts?: { id?: string; section?: string; text?: string; remove?: boolean }[];
  claims?: string[];
  optional?: string[];
  taste?: string[];
  brief?: string;
  depth?: { id?: string; title?: string; content?: string; keys?: string[]; remove?: boolean }[];
  variant?: VariantPatch;
}

/** Edits to a version's plan: its kind, name and premise, anchors, and map rows (a new row has no id). */
export interface VariantPatch {
  kind?: VersionKind;
  label?: string;
  premise?: string;
  anchors?: { id?: string; text?: string; kept?: boolean; remove?: boolean }[];
  map?: MapPatch[];
  /** Join a universe (its premise and map come along), or leave it with null. */
  universeId?: string | null;
}

function applyVariantPatch(v: VariantPlan, p: VariantPatch) {
  if (p.kind) v.kind = p.kind;
  if (p.label !== undefined) v.label = p.label.trim();
  if (p.premise !== undefined) v.premise = p.premise;
  for (const a of p.anchors ?? []) {
    const cur = a.id ? v.anchors.find((x) => x.id === a.id) : undefined;
    if (cur && a.remove) v.anchors = v.anchors.filter((x) => x !== cur);
    else if (cur) {
      if (a.text !== undefined) cur.text = a.text;
      if (a.kept !== undefined) cur.kept = a.kept;
    } else if (!a.id && a.text?.trim()) v.anchors.push({ id: newId(), text: a.text.trim(), kept: a.kept ?? true, from: "you" });
  }
  if (p.map) v.map = applyMapPatch(v.map, p.map);
  if (p.universeId !== undefined) joinDraftUniverse(v, p.universeId);
}

/**
 * A version draft joins a universe (docs/14, part 4): it takes the universe's kind and premise when
 * it has none of its own, and the universe's map rows it doesn't have yet. Null leaves it (the rows stay).
 */
function joinDraftUniverse(v: VariantPlan, universeId: string | null) {
  if (!universeId) {
    v.universeId = null;
    return;
  }
  const u = getUniverse(universeId);
  if (!u) throw notFound("Universe not found");
  v.universeId = u.id;
  if (!v.premise.trim()) v.premise = u.premise;
  if (u.kind) v.kind = u.kind;
  v.map = mergeRows(v.map, u.map.map((r) => ({ ...r, id: newId() })));
}

export function patchCreator(id: string, p: CreatorPatch) {
  return mutateCreator(id, (d) => {
    if (p.name !== undefined) d.name = p.name.trim() || d.name;
    if (p.stage) d.stage = p.stage;
    if (p.idea !== undefined) d.idea = p.idea;
    if (p.options) d.options = { ...d.options, ...p.options, greetings: Math.max(0, Math.min(5, p.options.greetings ?? d.options.greetings)) };
    if (p.answers)
      for (const q of d.questions) {
        if (p.answers[q.id] === undefined) continue;
        q.answer = p.answers[q.id]!;
        if (p.answerSources?.[q.id]) q.source = p.answerSources[q.id]!;
        syncAnswerFact(d, q);
      }
    if (p.worldBookIds) d.worldBookIds = [...new Set(p.worldBookIds)];
    if (p.loreDraftId !== undefined) d.loreDraftId = p.loreDraftId;
    if (p.expansion) applyExpansionPatch(d, p.expansion);
    if (p.bible)
      for (const [key, text] of Object.entries(p.bible)) {
        const s = d.bible.find((b) => b.key === key);
        if (s) s.text = text;
        else {
          const spec = BIBLE[d.kind].find((b) => b.key === key);
          if (spec) d.bible.push({ key, label: spec.label, text });
        }
        if (!d.editedSections.includes(key)) d.editedSections.push(key);
        if (d.variant && d.variant.marks[key] === "kept") d.variant.marks[key] = "changed";
      }
    if (p.fields)
      for (const [key, value] of Object.entries(p.fields)) {
        const f = d.fields.find((x) => x.key === key);
        if (!f || f.status === "queued" || f.status === "writing") continue;
        f.value = value;
        f.status = value.trim() ? "done" : "empty";
        // Your own edit is up to date with the bible you can see, and rewriting it asks first.
        f.basis = fieldBasis(d, key);
        f.edited = Boolean(value.trim());
      }
    if (p.accepted)
      for (const [key, ok] of Object.entries(p.accepted)) {
        const f = d.fields.find((x) => x.key === key);
        if (f) f.accepted = ok && Boolean(f.value.trim());
      }
    if (p.basedOn !== undefined) d.basedOn = p.basedOn.trim();
    if (p.dismissKindHint) {
      d.kindHint = null;
      d.kindSure = true;
    }
    if (p.dismissModeHint) d.modeHint = null;
    if (p.facts)
      for (const f of p.facts) {
        const cur = f.id ? d.facts.find((x) => x.id === f.id) : undefined;
        if (cur && f.remove) d.facts = d.facts.filter((x) => x.id !== cur.id);
        else if (cur) {
          if (f.text !== undefined) cur.text = f.text;
          if (f.section && specOf(d.kind, f.section)) cur.section = f.section;
          // A fact you rewrote is in your own words.
          if (f.text !== undefined) cur.source = "typed";
        } else if (!f.id && f.text?.trim() && f.section && specOf(d.kind, f.section)) d.facts.push(newFact(f.section, f.text, "typed"));
      }
    if (p.claims) d.claims = [...new Set(p.claims.filter((k) => specOf(d.kind, k)))];
    if (p.optional) d.optional = [...new Set(p.optional.filter((k) => OPTIONAL_SECTIONS.includes(k) && specOf(d.kind, k)))];
    if (p.taste) d.taste = p.taste.map((t) => t.trim()).filter(Boolean).slice(-24);
    if (p.brief !== undefined) d.brief = p.brief;
    if (p.variant && d.variant) applyVariantPatch(d.variant, p.variant);
    if (p.depth)
      for (const e of p.depth) {
        const cur = e.id ? d.depth.find((x) => x.id === e.id) : undefined;
        if (cur && e.remove) d.depth = d.depth.filter((x) => x.id !== cur.id);
        else if (cur) {
          if (e.title !== undefined) cur.title = e.title;
          if (e.content !== undefined) cur.content = e.content;
          if (e.keys) cur.keys = e.keys.map((k) => k.trim()).filter(Boolean).slice(0, 12);
        } else if (!e.id) d.depth.push({ id: newId(), title: e.title?.trim() || "Detail", content: e.content ?? "", keys: (e.keys ?? []).map((k) => k.trim()).filter(Boolean), from: "you" });
      }
  });
}

/** An answer is a fact in its section (deepening answers live in the depth lane instead). */
function syncAnswerFact(d: CreatorDraft, q: CreatorQuestion) {
  const has = d.facts.find((f) => f.qid === q.id);
  if (!q.section || q.section === "depth" || !specOf(d.kind, q.section)) return;
  if (!q.answer.trim()) {
    if (has) d.facts = d.facts.filter((f) => f !== has);
    return;
  }
  if (has) {
    has.text = q.answer.trim();
    has.source = q.source;
  } else d.facts.push(newFact(q.section, q.answer, q.source, q.id));
}

/**
 * "This is me, not someone for the AI to play" (or the reverse): the draft becomes the other kind in
 * place. What both kinds share (the idea, the concept, answers, matching bible sections) stays;
 * the read-back, written fields and editor's notes are redone for the new kind.
 */
export function switchCreatorKind(id: string, kind: CreatorKind) {
  return mutateCreator(id, (d) => {
    if (d.kind === kind) return;
    if (d.savedId || d.baseId) throw badRequest(`It's already saved as a ${d.kind === "persona" ? "persona" : "character"}. Use "Make a ${kind} from this" instead.`);
    const keys = new Map(BIBLE[kind].map((b) => [b.key, b.label]));
    d.kind = kind;
    d.bible = d.bible.filter((b) => keys.has(b.key) && b.text.trim()).map((b) => ({ ...b, label: keys.get(b.key)! }));
    d.fields = syncFields(kind, d.options, []);
    d.readback = null;
    // Questions asked for the other kind go; your answers stay.
    d.questions = d.questions.filter((q) => q.answer.trim()).map((q) => ({ ...q, section: keys.has(q.section) || q.section === "depth" ? q.section : "" }));
    d.facts = d.facts.filter((f) => keys.has(f.section));
    d.claims = d.claims.filter((k) => keys.has(k));
    d.optional = d.optional.filter((k) => keys.has(k));
    d.bibleCheck = null;
    d.bibleGate = null;
    d.fieldCheck = null;
    d.proposal = null;
    d.kindHint = null;
    d.kindSure = true;
    d.interviewDone = false;
    if (/^New (character|persona)$/.test(d.name)) d.name = kind === "persona" ? "New persona" : "New character";
    if (d.stage === "write" || d.stage === "done") d.stage = d.bible.length ? "bible" : "questions";
  });
}

// ---------- context ----------

const LABEL: Record<CreatorKind, string> = { character: "a character card for interactive fiction (roleplay)", persona: "the user's own character (a persona) for interactive fiction (roleplay)" };

/** Who the draft is in a chat (a card the AI plays, a narrator, or the player's own persona), for every step. */
const who = (d: CreatorDraft) => whoIsWho(d.kind, d.options.mode);

function world(d: CreatorDraft, budget = 2500) {
  return worldContext({ bookIds: d.worldBookIds, loreDraftId: d.loreDraftId }, budget);
}

const answers = (d: CreatorDraft) =>
  d.questions
    .filter((q) => q.answer.trim())
    .map((q) => `Q: ${q.q}\nA: ${q.answer.trim()} [${SOURCE_MARK[q.source]}]`)
    .join("\n\n");

const prefs = (d: CreatorDraft) =>
  [
    d.kind === "character" ? `CARD TYPE: ${d.options.mode === "narrator" ? "narrator (a storyteller running a world and its cast)" : "companion (one character, one-on-one with {{user}})"}` : "",
    d.options.tone.trim() ? `TONE AND GENRE: ${d.options.tone.trim()}` : "",
    d.options.style.trim() ? `STYLE NOTES: ${d.options.style.trim()}` : "",
  ]
    .filter(Boolean)
    .join("\n");

/** The bible as every field is written from it: the brief, each section, and how the sections connect. */
function bibleText(d: CreatorDraft) {
  const label = labelFor(d.kind);
  return [
    d.brief.trim() ? `## Brief\n${d.brief.trim()}` : "",
    ...d.bible.filter((b) => b.text.trim()).map((b) => `## ${b.label}\n${b.text.trim()}`),
    d.links.length ? `## How it connects\n${d.links.map((l) => `- ${label(l.from)} → ${l.relation} → ${label(l.to)}`).join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** The character a persona is built opposite: complement or friction, but no names baked into the persona. */
const counterpartBlock = (d: CreatorDraft) =>
  d.counterpart
    ? `THE CHARACTER THIS PERSONA IS BUILT TO PLAY OPPOSITE (${d.counterpart.name}). Design the persona to complement or rub against them, but keep the persona reusable: don't bake this character's name or proper nouns into who the persona is.\n${d.counterpart.text}`
    : "";

/** Facts not already shown as answers: the read-back's facts from the idea, and anything you added or the listener filed. */
const factBlock = (d: CreatorDraft) => factsBlock(d.facts.filter((f) => !f.qid), labelFor(d.kind));

export function baseBlocks(d: CreatorDraft, opts: { world?: number } = {}) {
  const w = world(d, opts.world ?? 2500);
  return [
    d.name && !/^New (character|persona)$/.test(d.name) ? `NAME: ${d.name}` : "",
    d.variant
      ? `THE ORIGINAL, ${d.variant.originName} as they are now (the source the version is made from; the premise and the map outrank it):\n${d.idea.trim()}`
      : `THE AUTHOR'S IDEA (canon):\n${d.idea.trim() || "(see the expanded concept)"}`,
    variantBlock(d.variant),
    expansionBlock(d.expansion),
    factBlock(d),
    answers(d) ? `THE AUTHOR'S ANSWERS (canon; marked by whose words):\n${answers(d)}` : "",
    counterpartBlock(d),
    w ? `THE WORLD (canon; fit into it):\n${w}` : "",
    canonBlock(d.basedOn),
    researchBlock(d.research),
    prefs(d),
    tasteBlock(d.taste),
  ].filter(Boolean);
}

export function expandContext(d: CreatorDraft) {
  return { idea: [d.name && !/^New (character|persona)$/.test(d.name) ? `Name: ${d.name}` : "", d.idea, counterpartBlock(d)].filter(Boolean).join("\n"), answers: answers(d), world: world(d, 2000), tone: d.options.tone, style: d.options.style, who: who(d) };
}

// ---------- model steps ----------

export async function expandCreator(id: string, steer = "") {
  const d = mustCreator(id);
  const e = await expandIdea(d.kind, expandContext(d), { previous: d.expansion, steer });
  return mutateCreator(id, (cur) => {
    cur.expansion = e;
    cur.taste = addTaste(cur.taste, steer);
  });
}

export async function deepenCreator(id: string, sectionId: string, steer = "") {
  const d = mustCreator(id);
  if (!d.expansion) throw badRequest("Expand the idea first");
  const text = await deepenSection(d.kind, expandContext(d), d.expansion, sectionId, steer);
  return mutateCreator(id, (cur) => {
    const s = cur.expansion?.sections.find((x) => x.id === sectionId);
    if (s) s.text = text;
    cur.taste = addTaste(cur.taste, steer);
  });
}

const readbackSchema = z.object({
  understood: z.string().default(""),
  missing: z.array(z.string()).default([]),
  basedOn: z.string().default(""),
  /** What the author actually established, as bare values tagged to a section. */
  facts: z.array(z.object({ section: z.string().default(""), text: z.string().default("") })).default([]),
  /** Load-bearing sections the material leaves empty or ambiguous. */
  gaps: z.array(z.object({ section: z.string().default(""), note: z.string().default("") })).default([]),
  /** Optional sections the material clearly calls for (a relationship arc, closeness, world agency). */
  detected: z.array(z.string()).default([]),
  /** What the material reads as: someone for the AI to play ("character") or the player themself ("persona"). */
  reads: z.string().default(""),
  readsWhy: z.string().default(""),
  /** For a card: one character ("companion") or a storyteller running a place ("narrator"). */
  card: z.string().default(""),
  cardWhy: z.string().default(""),
});

const READS_RULE = (kind: CreatorKind) =>
  `"reads": "persona" if the material describes the author's own character (the person they will play: "I", "me", "my persona", "who I play", "self-insert"), "character" if it describes someone for the AI to play opposite them (a card, a love interest, a companion, a narrator), or "" if it could be either. This draft is a ${kind}; only say the other when the material clearly is. "readsWhy": one short sentence quoting what tells you, or "".`;

const CARD_RULE = (mode: CreatorOptions["mode"]) =>
  `"card": "narrator" if the material describes a storyteller running a place and voicing many people (a world, a scenario with a cast and no single persona), "companion" if it is one person, or "". This draft is set to ${mode}; only say the other when the material clearly is. "cardWhy": one short sentence, or "".`;

/** One line per section for the read-back and the listener: key, label, what it holds, and whether it's optional. */
const sectionCatalog = (d: CreatorDraft) =>
  BIBLE[d.kind]
    .filter((s) => !s.narratorOnly || (d.kind === "character" && d.options.mode === "narrator"))
    .map((s) => `- ${s.key} (${s.label}${s.optional ? ", OPTIONAL: only if the material clearly shows it" : ""}): ${(d.options.mode === "narrator" && d.kind === "character" && NARRATOR_BIBLE[s.key]) || s.ask}`)
    .join("\n");

/**
 * Read-back (CHAR-08): what the model understood, the facts you established (tagged to sections, to
 * fix or add to), the gaps, and optional sections your material calls for. Then the first question.
 * Running it again replaces the facts it took from your idea; your own facts and answers stay.
 */
export async function creatorReadback(id: string) {
  const d = mustCreator(id);
  const r = await callJson({
    task: "helper",
    kind: `creator:readback`,
    name: "creator_readback",
    schema: readbackSchema,
    system: [
      `You read an author's material for ${LABEL[d.kind]}. ${who(d)} Your job is NOT to write it: separate what the author established from what's missing.`,
      '"understood": 2–4 concrete sentences on who you understood this to be. "missing": up to 4 short phrases naming what\'s still unclear.',
      '"facts": what the author actually established, each tagged to a section key. State the bare value, not a sentence about it ("lighthouse keeper above Port Ellis", not "She is a lighthouse keeper"). Extract only what the text directly supports: never embellish, generalise or interpret. One sentence can give several facts across sections. Fewer, sharper facts beat many vague ones. A contradiction is only a fact if the text shows two opposing forces.',
      '"gaps": sections the text leaves empty or ambiguous where a writer would be forced to guess AND whose absence would push the result toward the generic. A section with a fact is not a gap. Note what\'s missing in a few words.',
      `"detected": optional section keys the material clearly calls for (a character who changes as a bond deepens → "arc"; desire or closeness central to who they are → "intimacy"${d.kind === "character" && d.options.mode === "narrator" ? '; a world with an agenda of its own and lines it won\'t bend → "agency"' : ""}). Usually empty.`,
      `Sections:\n${sectionCatalog(d)}`,
      BASED_ON_RULE,
      READS_RULE(d.kind),
      d.kind === "character" ? CARD_RULE(d.options.mode) : "",
      'Reply with JSON only: {"understood": "…", "missing": ["…"], "basedOn": "", "facts": [{"section": "…", "text": "…"}], "gaps": [{"section": "…", "note": "…"}], "detected": [], "reads": "", "readsWhy": "", "card": "", "cardWhy": ""}',
    ]
      .filter(Boolean)
      .join("\n\n"),
    user: baseBlocks(d, { world: 1200 }).join("\n\n"),
    maxTokens: 2500,
    temperature: judgeTemp(0.4),
  });
  const keys = new Set(BIBLE[d.kind].map((s) => s.key));
  mutateCreator(id, (cur) => {
    cur.readback = {
      understood: r.data.understood.trim(),
      missing: r.data.missing.map((m) => m.trim()).filter(Boolean).slice(0, 4),
      gaps: r.data.gaps.filter((g) => keys.has(g.section)).map((g) => ({ section: g.section, note: g.note.trim() })),
    };
    // The idea's facts are re-read; yours (typed, picked, extended, answers) stay.
    cur.facts = [...cur.facts.filter((f) => f.source !== "idea"), ...r.data.facts.filter((f) => keys.has(f.section) && f.text.trim()).slice(0, 40).map((f) => newFact(f.section, f.text, "idea"))];
    const detected = r.data.detected.filter((k) => OPTIONAL_SECTIONS.includes(k) && specsOf({ ...cur, optional: OPTIONAL_SECTIONS }).some((s) => s.key === k));
    cur.detected = detected;
    cur.optional = [...new Set([...cur.optional, ...detected])];
    if (!cur.basedOn && r.data.basedOn.trim().length > 2) cur.basedOn = r.data.basedOn.trim().slice(0, 160);
    // Only a fresh draft is worth switching; a rework or a twin already knows what it is.
    const reads = r.data.reads.trim().toLowerCase();
    if ((reads === "persona" || reads === "character") && reads !== cur.kind && !cur.kindSure && !cur.baseId && !cur.origin?.fromDraftId && !cur.savedId && !cur.counterpart) cur.kindHint = { kind: reads, why: r.data.readsWhy.trim().slice(0, 300) };
    else cur.kindHint = null;
    const card = r.data.card.trim().toLowerCase();
    cur.modeHint = cur.kind === "character" && (card === "narrator" || card === "companion") && card !== cur.options.mode && !cur.savedId ? { mode: card, why: r.data.cardWhy.trim().slice(0, 300) } : null;
    cur.interviewDone = false;
    if (cur.stage === "idea") cur.stage = "questions";
  });
  const after = mustCreator(id);
  return after.questions.some((q) => !q.answer.trim() && !q.skipped) ? after : nextQuestion(id);
}

export interface PlanItem {
  key: string;
  label: string;
  /** Covered by your facts, or what the interview will do about it. */
  status: "covered" | "ask" | "mixed" | "write";
  impact: Impact;
  you?: string;
  mea?: string;
  claimed: boolean;
  detected: boolean;
  note: string;
}

/** What's covered, and what the interview will ask, half-ask, or leave to Mea ("I'll handle next"). */
export function interviewPlan(d: CreatorDraft): PlanItem[] {
  return specsOf(d).map((s) => {
    const claimed = d.claims.includes(s.key);
    const covered = d.facts.some((f) => f.section === s.key && f.text.trim());
    return {
      key: s.key,
      label: s.label,
      status: covered ? "covered" : claimed ? "ask" : s.fill,
      impact: s.impact,
      ...(s.you ? { you: s.you, mea: s.mea } : {}),
      claimed,
      detected: d.detected.includes(s.key),
      note: d.readback?.gaps?.find((g) => g.section === s.key)?.note ?? "",
    };
  });
}

/** What deepening reaches into, per kind: material that belongs in triggered lore, not on the card. */
const DEEPEN: Record<CreatorKind, string> = {
  character: "history, relationships, knowledge, secrets, daily texture: whatever makes THIS character interesting, worth knowing but not worth carrying on the card every turn",
  persona: "past events, the people in their life, what they know and can do, secrets: detail that should surface when relevant instead of riding every turn",
};

/**
 * The single next question: at the most important open section the interview asks about (sections
 * you claimed first), then deepening up to the cap. Asking again while a question is open skips it.
 */
export async function nextQuestion(id: string, opts: { steer?: string } = {}) {
  const d = mustCreator(id);
  const open = d.questions.find((q) => !q.answer.trim() && !q.skipped);
  const skippedSections = new Set(d.questions.filter((q) => q.skipped || q.id === open?.id).map((q) => q.section));
  const avoid = d.questions.filter((q) => q.skipped).map((q) => q.q).concat(open ? [open.q] : []);
  const plan = interviewPlan(d);
  const targets = plan
    .filter((p) => (p.status === "ask" || p.status === "mixed") && (!skippedSections.has(p.key) || p.claimed))
    .sort((a, b) => Number(b.claimed) - Number(a.claimed) || IMPACT[b.impact] - IMPACT[a.impact]);
  const deepened = d.questions.filter((q) => q.section === "depth" && (q.answer.trim() || q.skipped)).length;
  const canDeepen = deepened < deepenCap();
  const specs = specsOf(d);
  const asked = !targets.length && !canDeepen
    ? null
    : await askQuestion({
        kind: "creator",
        subject: LABEL[d.kind],
        who: who(d),
        material: baseBlocks(d, { world: 1200 }).join("\n\n"),
        asked: d.questions.filter((q) => q.answer.trim() || q.skipped).map((q) => ({ q: q.q, a: q.answer })),
        targets: targets.map((t) => {
          const s = specs.find((x) => x.key === t.key)!;
          return { key: t.key, label: t.label, ask: s.fill === "mixed" && !t.claimed ? `${s.ask} (ask only about ${s.you}; Mea writes ${s.mea})` : s.ask };
        }),
        deepening: canDeepen ? DEEPEN[d.kind] : "",
        taste: d.taste,
        steer: opts.steer,
        avoid,
      });
  return mutateCreator(id, (cur) => {
    const o = open && cur.questions.find((q) => q.id === open.id);
    if (o) o.skipped = true;
    cur.taste = addTaste(cur.taste, opts.steer);
    if (!asked) {
      cur.interviewDone = true;
      return;
    }
    cur.questions.push({ id: newId(), q: asked.q, why: asked.why, answer: "", suggestions: [], section: asked.target, source: "typed", directions: [], shown: [], skipped: false });
    cur.interviewDone = false;
    if (cur.stage === "idea") cur.stage = "questions";
  });
}

/**
 * "Use my answer": the answer becomes a fact in its section (whose words it is goes with it), the
 * listener files anything else it plainly settles, and the next question is asked.
 */
export async function answerQuestion(id: string, qid: string, input: { answer: string; source?: FactSource; next?: boolean }) {
  const text = input.answer.trim();
  if (!text) throw badRequest("Write an answer first");
  const d = mutateCreator(id, (cur) => {
    const q = cur.questions.find((x) => x.id === qid);
    if (!q) throw notFound("That question is gone");
    q.answer = text;
    q.source = input.source ?? "typed";
    q.skipped = false;
    syncAnswerFact(cur, q);
  });
  const q = d.questions.find((x) => x.id === qid)!;
  if (q.section && q.section !== "depth") {
    const label = labelFor(d.kind);
    const extra = await spillover({ kind: "creator", question: q.q, target: q.section, answer: text, sections: specsOf(d).map((s) => ({ key: s.key, label: s.label })), facts: d.facts, labelOf: label });
    if (extra.length) mutateCreator(id, (cur) => void cur.facts.push(...extra.map((f) => newFact(f.section, f.text, q.source))));
  }
  return input.next === false ? mustCreator(id) : nextQuestion(id);
}

/** "Finish questions": whatever is still open is Mea's to write from what it has. */
export function finishInterview(id: string) {
  return mutateCreator(id, (d) => {
    for (const q of d.questions) if (!q.answer.trim()) q.skipped = true;
    d.interviewDone = true;
  });
}

/** "Start the questions over": answers and the facts they made go; the idea's facts and yours stay. */
export function resetInterview(id: string) {
  return mutateCreator(id, (d) => {
    const qids = new Set(d.questions.map((q) => q.id));
    d.facts = d.facts.filter((f) => !f.qid || !qids.has(f.qid));
    d.questions = [];
    d.interviewDone = false;
  });
}

/** "Show me directions": three divergent answers to one question, steerable, never repeating what you've seen. */
export async function questionDirections(id: string, qid: string, steer = "") {
  const d = mustCreator(id);
  const q = d.questions.find((x) => x.id === qid);
  if (!q) throw notFound("That question is gone");
  const list = await offerDirections({ kind: "creator", question: q.q, why: q.why, material: baseBlocks(d, { world: 1000 }).join("\n\n"), taste: d.taste, steer, avoid: q.shown });
  return mutateCreator(id, (cur) => {
    const c = cur.questions.find((x) => x.id === qid);
    if (!c) return;
    c.directions = list;
    c.shown = [...c.shown, ...list.map((x) => x.text)].slice(-12);
    cur.taste = addTaste(cur.taste, steer);
  });
}

/** Reads up on the work and this person (their wiki page, Wikipedia, your links) and distils a canon brief. */
export async function researchCreator(id: string, opts: { urls?: string[] } = {}) {
  const d = mustCreator(id);
  if (!d.basedOn.trim() && !opts.urls?.length) throw badRequest("Say what it's based on first, or paste links to read");
  const name = d.name && !/^New (character|persona)$/.test(d.name) ? d.name : "";
  const g = await gather(d.basedOn || name, { urls: opts.urls, focus: name ? [name] : [] });
  if (!g.text.trim()) throw badRequest(d.basedOn ? `Couldn't find a wiki for ${d.basedOn}. Paste a link to one (a Fandom or Wikipedia page).` : "Couldn't read those links");
  const r = await callText({
    task: "summarizer",
    kind: "creator:research",
    system: BRIEF_RULE(d.basedOn || name, name || undefined),
    user: [`THE AUTHOR'S IDEA (for what matters; the brief is canon only):\n${d.idea.slice(0, 4000)}`, `THE RESEARCH:\n${g.text}`].join("\n\n"),
    maxTokens: 5000,
    temperature: 0.2,
    validate: (t) => (t.trim().length < 200 ? "That was too short. Write the full brief." : null),
  });
  return mutateCreator(id, (cur) => {
    cur.research = { basedOn: cur.basedOn, at: now(), wikis: g.wikis, sources: g.sources, names: g.names, brief: r.text.trim() };
  });
}

const CHARACTER_CRAFT =
  "Character craft: one clear contradiction at the core; a concrete want that drives scenes and a deeper need under it; values each proven by a behaviour, and a past that forged them; flaws with teeth; a reaction range that is genuinely calibrated (the FLAT band is real, every craving has its aversion, nobody is uniformly agreeable); a voice you'd recognise without a name tag; relationships with names and current tension. Nothing that only sounds good: every line must be usable in a scene.";
const PERSONA_CRAFT =
  "Persona craft: a person the player can step into and steer: a clear contradiction, a want and a need, real limits and flaws, a recognisable voice, a past that explains the present, and named people with current tension. Give the storyteller what it needs to react to them; leave every choice in a scene to the player. Nothing that only sounds good: every line must be usable in a story.";

const weaveSchema = z.object({ brief: z.string().default(""), links: z.array(z.object({ from: z.string().default(""), to: z.string().default(""), relation: z.string().default("") })).default([]) });

/** The weave: cause-and-effect links between sections and a short brief, adding nothing new. */
async function weave(d: CreatorDraft, bible: BibleSection[]) {
  const keys = new Set(bible.map((b) => b.key));
  const r = await callJson({
    task: "summarizer",
    kind: "creator:weave",
    name: "creator_weave",
    schema: weaveSchema,
    system: [
      `You do the final weave over the bible for ${LABEL[d.kind]}. You add nothing new; you only connect what's there and sum it up.`,
      `1. "links": how the sections cause each other (a past event that hardened into a value, a value that produces a reaction, a contradiction that bends their stance toward others). Each names a cause section key, an effect section key and a short relation ("hardened into", "drives"). Only links the bible supports; at most 10.`,
      `2. "brief": one tight paragraph (3–5 sentences) briefing ${d.kind === "persona" ? "a storyteller on who the player is" : "an actor on who this is"}: concrete and particular, surfacing the central tension${d.kind === "character" ? ", the reaction range and, if present, the relationship arc" : ""} in plain words. No clichés, no hedging.`,
      'Reply with JSON only: {"links": [{"from": "<key>", "to": "<key>", "relation": "…"}], "brief": "…"}',
    ].join("\n\n"),
    user: [`THE AUTHOR'S IDEA (ground the brief's language in this texture):\n${d.idea.slice(0, 3000)}`, `THE BIBLE (keys in brackets):\n${bible.filter((b) => b.text.trim()).map((b) => `[${b.key}] ${b.label}\n${b.text.trim()}`).join("\n\n")}`].join("\n\n"),
    maxTokens: 1500,
    temperature: writeTemp(0.5),
  });
  return {
    brief: tidy(r.data.brief),
    links: r.data.links.filter((l) => keys.has(l.from) && keys.has(l.to) && l.from !== l.to && l.relation.trim()).slice(0, 10).map((l) => ({ from: l.from, to: l.to, relation: l.relation.trim().slice(0, 60) })),
  };
}

/** Re-runs the weave after edits: new links and a new brief from the bible as it stands. */
export async function weaveCreator(id: string) {
  const d = mustCreator(id);
  if (!d.bible.some((b) => b.text.trim())) throw badRequest("Write the bible first");
  const w = await weave(d, d.bible);
  return mutateCreator(id, (cur) => {
    cur.brief = w.brief || cur.brief;
    cur.links = w.links;
  });
}

/**
 * Bible (CHAR-08): the single source of truth every field is written from, in passes (inner life →
 * how it comes out → how they show), each building on the last, then woven into links and a brief.
 * A rework keeps your edits.
 */
export async function writeBible(id: string, steer = "") {
  let d = mustCreator(id);
  // Someone from an existing work reads up on canon first (once).
  if (d.basedOn && !d.research?.brief) {
    try {
      d = await researchCreator(id);
    } catch (e) {
      if (e instanceof Deferred) throw e;
    }
  }
  const specs = specsOf(d);
  const rework = d.bible.some((b) => b.text.trim());
  const clean = (t: string) => (d.kind === "persona" ? unslipPersona(tidy(t), d.name) : tidy(t));
  const out: Record<string, string> = {};
  let name = "";
  for (const pass of PASSES) {
    const group = specs.filter((s) => s.pass === pass.id);
    if (!group.length) continue;
    const earlier = specs.filter((s) => out[s.key]);
    const shape = Object.fromEntries([["name", "…"], ...group.map((s) => [s.key, "…"])]);
    const r = await callJson({
      task: "summarizer",
      kind: `creator:bible:${pass.id}`,
      name: "creator_bible",
      schema: z.object({ name: z.string().default("") }).catchall(z.unknown()),
      system: [
        `You write the bible for ${LABEL[d.kind]}: the single source of truth every ${d.kind === "persona" ? "persona" : "card"} field will be written from. It is written in passes; THIS PASS is "${pass.label}": ${pass.what}. ${rework ? "Rework the current bible: keep what the author wrote or edited into it, and change what they ask." : ""}`,
        who(d),
        `Craft rules:\n- ${CRAFT}`,
        WEIGHT_RULE,
        canonRule(d.basedOn),
        d.kind === "persona" ? PERSONA_CRAFT : CHARACTER_CRAFT,
        `Sections for this pass (40–160 words each; sample lines in quotes where asked):\n${group.map((s) => `- "${s.key}" (${s.label}): ${s.ask}`).join("\n")}`,
        earlier.length ? "Stay consistent with what earlier passes wrote and build on it; never contradict it." : "",
        steer.trim() ? `The author asks: ${steer.trim()}` : "",
        `Reply with JSON only: ${JSON.stringify(shape)}`,
      ]
        .filter(Boolean)
        .join("\n\n"),
      user: [
        ...baseBlocks(d),
        earlier.length ? `WRITTEN BY EARLIER PASSES:\n${earlier.map((s) => `## ${s.label}\n${out[s.key]}`).join("\n\n")}` : "",
        rework ? `THE CURRENT BIBLE:\n${bibleText(d)}` : "",
      ]
        .filter(Boolean)
        .join("\n\n"),
      maxTokens: 5000,
      temperature: writeTemp(0.8),
    });
    const data = r.data as Record<string, unknown>;
    if (!name && typeof data.name === "string") name = data.name.trim();
    for (const s of group) if (typeof data[s.key] === "string" && (data[s.key] as string).trim()) out[s.key] = clean(data[s.key] as string);
  }
  const bible = specs.map((s) => ({ key: s.key, label: s.label, text: out[s.key] ?? d.bible.find((b) => b.key === s.key)?.text ?? "" }));
  let woven = { brief: d.brief, links: d.links };
  try {
    woven = await weave(d, bible);
  } catch (e) {
    if (e instanceof Deferred) throw e;
  }
  return mutateCreator(id, (cur) => {
    if (name && name.length <= 60 && (/^New (character|persona)$/.test(cur.name) || !cur.name.trim())) cur.name = name;
    // A persona is never {{char}}: a slipped macro becomes their name.
    cur.bible = bible.map((b) => ({ ...b, text: cur.kind === "persona" ? unslipPersona(b.text, cur.name) : b.text }));
    cur.brief = woven.brief || cur.brief;
    cur.links = woven.links;
    cur.bibleCheck = null;
    cur.bibleGate = null;
    cur.taste = addTaste(cur.taste, steer);
    if (cur.stage === "idea" || cur.stage === "questions") cur.stage = "bible";
  });
}

const MARKS = new Set(["kept", "changed", "new"]);

/**
 * The bible of a version (docs/14): the original's sections, each kept, changed for the version, or
 * new, in the same passes as any bible. With the original's bible to hand, a kept section is copied
 * word for word and only the rest is written; without one, every section is written from the card.
 * Sections you edited by hand stay as they are on a rework.
 */
export async function writeVariantBible(id: string, steer = "") {
  const d = mustCreator(id);
  const v = d.variant;
  if (!v) throw badRequest("This draft isn't a version");
  const specs = specsOf(d);
  const origin = v.originBible;
  const rework = d.bible.some((b) => b.text.trim());
  const clean = (t: string) => (d.kind === "persona" ? unslipPersona(tidy(t), d.name) : tidy(t));
  const out: Record<string, { mark: "kept" | "changed" | "new"; text: string }> = {};
  for (const pass of PASSES) {
    const group = specs.filter((s) => s.pass === pass.id);
    if (!group.length) continue;
    const earlier = specs.filter((s) => out[s.key]);
    const shape = Object.fromEntries(group.map((s) => [s.key, { mark: "kept|changed|new", text: "…" }]));
    const r = await callJson({
      task: "summarizer",
      kind: `creator:variant-bible:${pass.id}`,
      name: "creator_variant_bible",
      schema: z.object({}).catchall(z.unknown()),
      system: [
        `You write the bible for a VERSION of ${v.originName}, ${LABEL[d.kind]}: the single source of truth every field of the version will be written from. It is written in passes; THIS PASS is "${pass.label}": ${pass.what}.`,
        who(d),
        origin
          ? 'Decide each section against THE ORIGINAL\'S BIBLE: "kept" when it holds as written in this version (leave "text" empty: the original\'s words are copied), "changed" when the premise or the map changes it (write the whole section for the version), or "new" only for a section the original has nothing for.'
          : 'The original is a card without a bible: write every section for the version from THE ORIGINAL. Mark each one "kept" when it\'s what the original already establishes and the premise leaves it alone, "changed" when the premise or the map changes it, or "new" when the original says nothing about it.',
        "A version is the same person moved into the premise, not a stranger with their name: change what the premise and the map change, and no more. Keep every point under WHAT STAYS TRUE visible. Follow THE MAP exactly: the version's names, places and history, never an original name the map changed or dropped.",
        `Craft rules:\n- ${CRAFT}`,
        WEIGHT_RULE,
        canonRule(d.basedOn),
        d.kind === "persona" ? PERSONA_CRAFT : CHARACTER_CRAFT,
        `Sections for this pass (40–160 words each when written; sample lines in quotes where asked):\n${group.map((s) => `- "${s.key}" (${s.label}): ${s.ask}`).join("\n")}`,
        earlier.length ? "Stay consistent with what earlier passes wrote and build on it; never contradict it." : "",
        rework ? "Rework the version's current bible: keep what the author wrote or edited into it, and change what they ask." : "",
        steer.trim() ? `The author asks: ${steer.trim()}` : "",
        `Reply with JSON only: ${JSON.stringify(shape)}`,
      ]
        .filter(Boolean)
        .join("\n\n"),
      user: [
        ...baseBlocks(d),
        earlier.length ? `WRITTEN BY EARLIER PASSES:\n${earlier.map((s) => `## ${s.label}\n${out[s.key]!.text}`).join("\n\n")}` : "",
        rework ? `THE VERSION'S CURRENT BIBLE:\n${bibleText(d)}` : "",
      ]
        .filter(Boolean)
        .join("\n\n"),
      maxTokens: 5000,
      temperature: writeTemp(0.75),
    });
    const data = r.data as Record<string, unknown>;
    for (const s of group) {
      const current = d.bible.find((b) => b.key === s.key)?.text.trim() ?? "";
      const was = origin?.find((o) => o.key === s.key)?.text.trim() ?? "";
      // Your own edit stands on a rework.
      if (d.editedSections.includes(s.key) && current) {
        out[s.key] = { mark: was && was === current ? "kept" : was ? "changed" : "new", text: current };
        continue;
      }
      const raw = (data[s.key] && typeof data[s.key] === "object" ? data[s.key] : { text: data[s.key] }) as { mark?: unknown; text?: unknown };
      const said = typeof raw.mark === "string" && MARKS.has(raw.mark.trim().toLowerCase()) ? (raw.mark.trim().toLowerCase() as "kept" | "changed" | "new") : "changed";
      const text = typeof raw.text === "string" ? clean(raw.text) : "";
      if (origin) {
        if (said === "kept" && was) out[s.key] = { mark: "kept", text: was };
        else if (text) out[s.key] = { mark: was ? "changed" : "new", text };
        else if (was) out[s.key] = { mark: "kept", text: was };
      } else if (text) out[s.key] = { mark: said, text };
    }
  }
  const bible = specs.map((s) => ({ key: s.key, label: s.label, text: out[s.key]?.text ?? d.bible.find((b) => b.key === s.key)?.text ?? "" }));
  let woven = { brief: d.brief, links: d.links };
  try {
    woven = await weave(d, bible);
  } catch (e) {
    if (e instanceof Deferred) throw e;
  }
  return mutateCreator(id, (cur) => {
    cur.bible = bible.map((b) => ({ ...b, text: cur.kind === "persona" ? unslipPersona(b.text, cur.name) : b.text }));
    if (cur.variant) cur.variant.marks = Object.fromEntries(Object.entries(out).map(([k, x]) => [k, x.mark]));
    cur.brief = woven.brief || cur.brief;
    cur.links = woven.links;
    cur.bibleCheck = null;
    cur.bibleGate = null;
    cur.taste = addTaste(cur.taste, steer);
    if (cur.stage !== "write" && cur.stage !== "done") cur.stage = "bible";
  });
}

/** One bible section, rewritten (a fix from the check, or your own steer). */
export async function rewriteBibleSection(id: string, key: string, steer = "") {
  const d = mustCreator(id);
  const s = d.bible.find((b) => b.key === key) ?? BIBLE[d.kind].find((b) => b.key === key);
  if (!s) throw notFound("Section not found");
  const ask = specsOf({ ...d, optional: OPTIONAL_SECTIONS }).find((b) => b.key === key)?.ask ?? "";
  const r = await callText({
    task: "summarizer",
    kind: "creator:bible-section",
    system: [
      `Rewrite one section of the bible for ${LABEL[d.kind]}: "${s.label}" (${ask}).`,
      who(d),
      steer.trim() ? `The author asks: ${steer.trim()}` : "Make it sharper, more specific and more playable, keeping every fact already in it.",
      "40–180 words, consistent with the other sections.",
      `Craft rules:\n- ${CRAFT}`,
      WEIGHT_RULE,
      canonRule(d.basedOn),
      "Reply with the section text only: no heading, no preamble.",
    ]
      .filter(Boolean)
      .join("\n\n"),
    user: [...baseBlocks(d, { world: 1500 }), `THE BIBLE:\n${bibleText(d)}`, `THE SECTION: ${s.label}\n${"text" in s ? s.text : ""}`].join("\n\n"),
    maxTokens: 1200,
    temperature: writeTemp(0.75),
    validate: (t) => (tidy(t).length < 20 ? "That was empty. Write the section text." : d.kind === "persona" ? personaSlip(unslipPersona(tidy(t), d.name)) : null),
  });
  return mutateCreator(id, (cur) => {
    const text = cur.kind === "persona" ? unslipPersona(tidy(r.text), cur.name) : tidy(r.text);
    const sec = cur.bible.find((b) => b.key === key);
    if (sec) sec.text = text;
    else cur.bible.push({ key, label: s.label, text });
    if (cur.bibleCheck) cur.bibleCheck = cur.bibleCheck.filter((i) => i.section !== key);
    cur.editedSections = cur.editedSections.filter((k) => k !== key);
    if (cur.variant && cur.variant.marks[key] === "kept") cur.variant.marks[key] = "changed";
    cur.taste = addTaste(cur.taste, steer);
  });
}

type BibleCriterion = Criterion & { applies?: (d: CreatorDraft) => boolean };
const has = (d: CreatorDraft, key: string) => Boolean(d.bible.find((b) => b.key === key)?.text.trim());

const SHARED_CRITERIA: BibleCriterion[] = [
  { key: "specificity", label: "Specific, not generic", description: "It commits to concrete, particular choices, not generic traits or hedges that could describe almost anyone." },
  { key: "coherence", label: "Hangs together", description: "The parts explain each other causally (the past forged the values, the values drive the reactions); one person, not a list of traits." },
  { key: "fidelity", label: "Faithful to your idea", description: "The author's own names, images, phrases and specifics survive intact rather than being paraphrased into something more average. Judge against THE AUTHOR'S IDEA and their facts and answers." },
  { key: "renderability", label: "Enough to write from", description: "There's enough specific, load-bearing material to write distinct fields without inventing toward the average." },
];

const BIBLE_CRITERIA: Record<"character" | "narrator" | "persona", BibleCriterion[]> = {
  character: [
    ...SHARED_CRITERIA,
    { key: "tension", label: "Living tension", description: "The central contradiction is two forces that genuinely pull against each other, not one trait restated or a flaw bolted on." },
    { key: "originality", label: "Not the obvious version", description: "It resists the statistical mean: not the first, most predictable take on this premise." },
    { key: "calibration", label: "Not always eager", description: "The reaction range is calibrated: the FLAT band is real and load-bearing, and every craving is paired with the aversion that bounds it. Someone who engages everything equally fails.", applies: (d) => has(d, "gradient") },
    { key: "earned_arc", label: "Change is earned", description: "The relationship arc re-aims the SAME through-line trait across closeness (not a different personality), the later self is hinted early, and hard limits never move.", applies: (d) => has(d, "arc") },
    { key: "person", label: "Reads like a person", description: "The inner read (values, beliefs, contradiction) doesn't contradict the behaviour (if-then reactions, reaction range, wants)." },
  ],
  narrator: [
    ...SHARED_CRITERIA,
    { key: "tension", label: "Living tension", description: "The world has an unresolved, charged core worth playing in, not just a place to visit." },
    { key: "player_place", label: "The player has a place", description: "{{user}} has a real role here, and the world reads and treats them in a specific way." },
    { key: "rules_bite", label: "Rules that bite", description: "The rules of the place have costs and consequences a scene can feel; they're not decoration." },
    { key: "agency_earned", label: "Agency is real", description: "The world's agenda and holds grow out of the material, and the holds are concrete lines a scene can strain but never break.", applies: (d) => has(d, "agency") },
  ],
  persona: [
    ...SHARED_CRITERIA,
    { key: "playable", label: "Leaves the player in charge", description: "It gives the storyteller what it needs to react to them (look, manner, past, limits) and never decides what they feel, say or choose." },
    { key: "not_a_card", label: "A persona, not a card", description: "Nothing is written as if this were a character card: no greetings, no {{char}}, no relationship \"with {{user}}\" (they are {{user}})." },
  ],
};

/** A version is also judged on staying the same person, and on living in its own world. */
const VARIANT_CRITERIA: BibleCriterion[] = [
  { key: "still_them", label: "Still them", description: "Every point under WHAT STAYS TRUE is visible in the bible, and the version reads as the same person at the core, moved into the premise; not someone new with the same name." },
  { key: "translated", label: "In its own world", description: "The version follows the premise and THE MAP: the version's names, places and history throughout, nothing left over from the original's world that the map changed or dropped, and no half-translated mix." },
];

const bibleCriteria = (d: CreatorDraft) => [...BIBLE_CRITERIA[d.kind === "persona" ? "persona" : d.options.mode === "narrator" ? "narrator" : "character"], ...(d.variant ? VARIANT_CRITERIA : [])].filter((c) => !c.applies || c.applies(d));

const checkSchema = z.object({
  criteria: z.array(z.object({ key: z.string(), passed: z.boolean().default(false), note: z.string().default("") })).default([]),
  summary: z.string().default(""),
  issues: z.array(z.object({ section: z.string(), problem: z.string(), fix: z.string().default("") })).default([]),
});

/** The editor's pass (CHAR-13): named pass/fail checks, then the concrete issues behind them, each with a fix. */
export async function checkBible(id: string) {
  const d = mustCreator(id);
  if (!d.bible.some((b) => b.text.trim())) throw badRequest("Write the bible first");
  const keys = d.bible.map((b) => b.key);
  const criteria = bibleCriteria(d);
  const r = await callJson({
    task: "summarizer",
    kind: "creator:bible-check",
    name: "creator_bible_check",
    schema: checkSchema,
    system: [
      `Review this bible for ${LABEL[d.kind]} like a demanding editor, before any field is written from it. ${who(d)} The cost of passing a weak bible is a whole generic ${d.kind === "persona" ? "persona" : "card"}.`,
      `First judge each criterion: passed true or false, with one sharp sentence naming exactly what's strong or thin. A criterion fails if it's only half met. Write as an editor talking to the author, in plain words.\nCRITERIA:\n${rubric(criteria)}`,
      'Then "summary": a plain line on what works, or the one or two things that would most raise the ceiling.',
      `Then "issues": the concrete problems behind any failures, plus ${d.kind === "persona" ? "anything written as if it were a character card; " : ""}generic choices (stock names, tropes played straight, purple prose, traits told instead of shown), contradictions between sections or with the world, missing essentials, anything that would play flat. Each names the section by key (${keys.join(", ")}), states the problem in one sentence, and gives a fix the author could accept as is. At most 8, most important first; none if it's strong.`,
      'Reply with JSON only: {"criteria": [{"key": "…", "passed": true, "note": "…"}], "summary": "…", "issues": [{"section": "…", "problem": "…", "fix": "…"}]}',
    ].join("\n\n"),
    user: [...baseBlocks(d, { world: 1500 }), d.brief ? `THE BRIEF:\n${d.brief}` : "", `THE BIBLE:\n${d.bible.map((b) => `[${b.key}] ${b.label}\n${b.text.trim()}`).join("\n\n")}`].filter(Boolean).join("\n\n"),
    maxTokens: 2400,
    temperature: judgeTemp(0.3),
  });
  return mutateCreator(id, (cur) => {
    cur.bibleGate = toVerdict(r.data, criteria);
    cur.bibleCheck = r.data.issues.filter((i) => keys.includes(i.section) && i.problem.trim()).slice(0, 8).map((i) => ({ section: i.section, problem: i.problem.trim(), fix: i.fix.trim() }));
  });
}

// ---------- writing the fields (background) ----------

/** A rewrite of fields you edited by hand needs `force` (the client asks first). */
export class HandEdited extends Error {
  constructor(public keys: string[]) {
    super(`You edited ${keys.join(", ")} by hand. Rewriting replaces your edit.`);
  }
}

export function queueFields(id: string, opts: { keys?: string[]; steer?: string; all?: boolean; force?: boolean } = {}) {
  const pre = mustCreator(id);
  const want = new Set(opts.keys ?? []);
  const pick = (f: CardField) => (opts.keys ? want.has(f.key) : opts.all ? true : !f.value.trim());
  const guarded = pre.fields.filter((f) => pick(f) && f.edited && f.value.trim()).map((f) => f.label);
  if (guarded.length && !opts.force) throw badRequest(new HandEdited(guarded).message);
  const d = mutateCreator(id, (d) => {
    if (!d.bible.some((b) => b.text.trim())) throw badRequest("Write the bible first");
    for (const f of d.fields) {
      if (!pick(f) || f.status === "queued" || f.status === "writing") continue;
      f.status = "queued";
      f.error = "";
      if (opts.steer !== undefined) f.steer = opts.steer;
    }
    d.taste = addTaste(d.taste, opts.steer);
    if (d.stage !== "done") d.stage = "write";
  });
  if (d.fields.some((f) => f.status === "queued")) enqueue("creator.write", { draftId: id }, { dedupeKey: `creator:${id}`, priority: 1, maxAttempts: 2 });
  return d;
}

export function stopFields(id: string) {
  return mutateCreator(id, (d) => {
    for (const f of d.fields) if (f.status === "queued") f.status = f.value.trim() ? "done" : "empty";
  });
}

export async function runCreatorJob(draftId: string, job?: JobContext) {
  if (!getCreatorDraft(draftId)) return;
  mutateCreator(draftId, (d) => {
    for (const f of d.fields) if (f.status === "writing") f.status = "queued";
  });
  for (;;) {
    const d = getCreatorDraft(draftId);
    const next = d?.fields.find((f) => f.status === "queued");
    if (!d || !next) break;
    mutateCreator(draftId, (cur) => {
      const f = cur.fields.find((x) => x.key === next.key);
      if (f) f.status = "writing";
    });
    try {
      let value = await writeField(d, next, job);
      let gate: GateVerdict | null = null;
      let revised = false;
      // The automatic check: judged against the bible; one revision with what failed, then it stands.
      if (d.options.autoCheck && !NO_CHECK.has(next.key)) {
        gate = await gateField(d, next, value, job);
        if (!gate.passed) {
          value = await writeField(d, { ...next, value, steer: `Fix exactly these: ${failedNotes(gate)}` }, job);
          revised = true;
          gate = await gateField(d, next, value, job);
        }
      }
      mutateCreator(draftId, (cur) => {
        const f = cur.fields.find((x) => x.key === next.key);
        if (!f) return;
        if (f.value.trim()) f.previous = f.value;
        f.value = value;
        f.status = "done";
        f.error = "";
        f.basis = fieldBasis(d, next.key);
        f.gate = gate;
        f.revised = revised;
        f.edited = false;
        f.accepted = false;
      });
    } catch (e) {
      if (e instanceof Deferred) {
        mutateCreator(draftId, (cur) => {
          const f = cur.fields.find((x) => x.key === next.key);
          if (f) f.status = "queued";
        });
        throw e;
      }
      mutateCreator(draftId, (cur) => {
        const f = cur.fields.find((x) => x.key === next.key);
        if (!f) return;
        f.status = "error";
        f.error = String((e as Error)?.message ?? e).slice(0, 400);
      });
    }
  }
}

const NO_CHECK = new Set(["tags", "pronouns", "creator_notes"]);

const isGreeting = (key: string) => key === "first_mes" || key.startsWith("alt_");

/** The field checks, by what the field is: every field is faithful, specific and well-formed; voiced fields stay in voice. */
function fieldCriteria(d: CreatorDraft, key: string): Criterion[] {
  const out: Criterion[] = [
    { key: "faithful", label: "Faithful", description: "Consistent with the bible: it carries the bible's specifics through and invents nothing that contradicts it." },
    { key: "specific", label: "Specific", description: "Concrete choices grounded in this one person, not generic filler, hedges or traits that could describe anyone." },
    { key: "well_formed", label: "Well-formed", description: "The right shape and length for this field, no meta-commentary or preamble, ready to drop into the card." },
  ];
  if (d.kind === "persona") out.push({ key: "not_a_card", label: "A persona, not a card", description: "No {{char}}, chat lines or relationship \"with {{user}}\"; describes who they are without scripting their choices." });
  else if (isGreeting(key) || key === "mes_example") {
    out.push(
      { key: "in_voice", label: "In voice", description: "The dialogue matches the bible's voice: rhythm, diction and register sound like this specific person." },
      { key: "voiced_narration", label: "Voiced narration", description: "The narration sees through the character's lens and idiolect, not a neutral camera reporting events." },
      { key: "user_untouched", label: "Player untouched", description: "It never writes {{user}}'s actions, words, thoughts or feelings." },
    );
    if (key === "mes_example") out.push({ key: "coverage", label: "Coverage", description: "The exchanges cover distinct beats (a peak moment, a held boundary, humour, a value-driven choice, an everyday exchange), not one register repeated." });
  } else if (key === "description") out.push({ key: "no_recital", label: "No recital", description: "Appearance is a reference, not a spec sheet read aloud: physical facts surface where they carry weight." });
  return out;
}

async function gateField(d: CreatorDraft, f: CardField, value: string, job?: JobContext) {
  return runGate({
    kind: `creator:${f.key}:gate`,
    name: "creator_field_gate",
    what: `one field (the ${f.label.toLowerCase()}) of ${LABEL[d.kind]}, written from its bible: did it project the bible faithfully and specifically, in the right shape, without sliding toward the generic? Don't re-judge the concept`,
    criteria: fieldCriteria(d, f.key),
    user: [`THE BIBLE:\n${bibleText(d)}`, `THE TEXT TO JUDGE:\n${value}`].join("\n\n"),
    editor: true,
    jobId: job?.id,
  });
}

export async function writeField(d: CreatorDraft, f: CardField, job?: JobContext): Promise<string> {
  const written = d.fields.filter((x) => x.key !== f.key && x.value.trim() && ["description", "scenario", "first_mes", "background"].concat(isGreeting(f.key) ? d.fields.filter((g) => isGreeting(g.key)).map((g) => g.key) : []).includes(x.key));
  const name = d.name && !/^New (character|persona)$/.test(d.name) ? d.name : "";
  const r = await callText({
    task: "summarizer",
    kind: `creator:${f.key}`,
    jobId: job?.id,
    system: [
      `Field: ${f.label}`,
      `You write one field of ${LABEL[d.kind]}${name ? ` for ${name}` : ""}, from its bible. ${fieldAsk(d.kind, f.key, d.options, f.label)}`,
      who(d),
      `Craft rules:\n- ${CRAFT}`,
      d.kind === "character" ? "Use the macros exactly: {{user}} for the player's character, {{char}} only where the format asks for it." : `Call them by name${name ? ` (${name})` : ""}; no {{char}} or {{user}} macros.`,
      "Stay faithful to the bible and the world: every name, age, place and fact must match. Don't invent anything that contradicts them.",
      canonRule(d.basedOn),
      f.steer.trim() && f.value.trim() ? "Rewrite the current version as the author asks; keep what works." : "",
      "Reply with the field's text only: no label, no heading, no commentary.",
    ]
      .filter(Boolean)
      .join("\n\n"),
    user: [
      `THE BIBLE (canon):\n${bibleText(d)}`,
      ...baseBlocks(d, { world: 1500 }).filter((b) => !b.startsWith("THE AUTHOR'S IDEA") && !b.startsWith("THE EXPANDED CONCEPT")),
      ...written.map((x) => `ALREADY WRITTEN — ${x.label.toUpperCase()}:\n${x.value.trim()}`),
      f.steer.trim() && f.value.trim() ? `THE CURRENT VERSION:\n${f.value.trim()}` : "",
      f.steer.trim() ? `THE AUTHOR ASKS: ${f.steer.trim()}` : "",
    ]
      .filter(Boolean)
      .join("\n\n"),
    maxTokens: f.key === "description" ? 2200 : 1400,
    temperature: f.key === "tags" || f.key === "pronouns" ? 0.3 : writeTemp(0.8),
    // A greeting that plays {{user}} gets one more try with the problem named (CHAR-13 anti-puppet).
    validate: (t) => {
      const text = tidy(t);
      if (!text) return "That was empty. Write the field.";
      if (isGreeting(f.key) && checkGreeting(text, d.options.pov).some((i) => i.kind === "puppets-user")) return "The greeting writes {{user}}'s actions, words or feelings. Rewrite it so {{user}} only perceives; leave every choice to them.";
      if (f.key === "mes_example" && !/<START>/i.test(text)) return 'Use "<START>" lines to separate the exchanges, and "{{user}}:" / "{{char}}:" speaker labels.';
      // A slipped {{char}} is fixed below; chat lines can't be, so they're sent back.
      if (d.kind === "persona" && f.key !== "pronouns") return personaSlip(unslipPersona(text, name));
      return null;
    },
  });
  let text = tidy(r.text);
  if (f.key === "tags") text = [...new Set(text.split(/[,\n]/).map((s) => s.replace(/^[-#*\s]+/, "").trim().toLowerCase()).filter((s) => s && s.length <= 30))].slice(0, 10).join(", ");
  if (f.key === "pronouns") text = text.split("\n")[0]!.replace(/[.]+$/, "").slice(0, 40);
  if (d.kind === "persona") text = unslipPersona(text, name);
  return text;
}

export function restoreField(id: string, key: string) {
  return mutateCreator(id, (d) => {
    const f = d.fields.find((x) => x.key === key);
    if (!f?.previous) throw badRequest("Nothing to restore");
    [f.value, f.previous] = [f.previous, f.value];
    f.status = "done";
  });
}

// ---------- stale fields ----------

/** Which bible sections each field is written from (the rest of the bible can change without it going stale). */
const READS: Record<string, string[]> = {
  personality: ["personality", "flaws", "voice", "motivation", "gradient", "negative"],
  scenario: ["identity", "user", "hooks", "relationships", "motivation", "agency"],
  mes_example: ["voice", "personality", "user", "flaws", "secrets", "gradient", "tensions", "arc"],
  rules: ["voice", "personality", "user", "secrets", "flaws", "gradient", "negative"],
  tags: ["identity", "personality", "hooks"],
  creator_notes: ["identity", "personality", "hooks", "user"],
  pronouns: ["identity"],
  appearance: ["appearance"],
  background: ["background", "relationships", "skills"],
};
const readsOf = (d: CreatorDraft, key: string) => (d.kind === "persona" && key === "personality" ? ["personality", "voice"] : (READS[key] ?? d.bible.map((b) => b.key)));

/** Fingerprints of what a field is written from: the name, canon, and the bible sections it reads. */
export function fieldBasis(d: CreatorDraft, key: string) {
  const parts = [`name:${shortHash(d.name.trim())}`, `canon:${shortHash(d.basedOn.trim())}`];
  for (const k of readsOf(d, key)) parts.push(`${k}:${shortHash(d.bible.find((b) => b.key === k)?.text.trim() ?? "")}`);
  return parts.join("|");
}

/** The sections that changed since a field was written ("Voice", "the name"), or [] if it's current (or unknown). */
export function staleFieldReasons(d: CreatorDraft, f: CardField): string[] {
  if (!f.basis || !f.value.trim() || f.status === "queued" || f.status === "writing") return [];
  const was = Object.fromEntries(f.basis.split("|").map((p) => p.split(":") as [string, string]));
  const now = Object.fromEntries(fieldBasis(d, f.key).split("|").map((p) => p.split(":") as [string, string]));
  return Object.keys(now)
    .filter((k) => was[k] !== undefined && was[k] !== now[k])
    .map((k) => (k === "name" ? "the name" : k === "canon" ? "what it's based on" : (d.bible.find((b) => b.key === k)?.label ?? k)));
}

// ---------- versions (docs/14) ----------

/** Original names that slipped into the version's bible or fields (rules only, free). */
export function draftLeaks(d: CreatorDraft): Leak[] {
  if (!d.variant) return [];
  return findLeaks(d.variant.map, [
    ...d.bible.map((b) => ({ where: "bible" as const, key: b.key, label: b.label, text: b.text })),
    ...d.fields.filter((f) => f.key !== "tags" && f.key !== "pronouns").map((f) => ({ where: "field" as const, key: f.key, label: f.label, text: f.value })),
  ]);
}

/** Each bible section, kept from the original, changed for the version, or new. */
export const variantMarks = (d: CreatorDraft) => (d.variant ? marksOf(d.variant, d.bible) : {});

/**
 * Which fields carry over from the original word for word, and which need writing for the version:
 * a field is kept only when every section it's written from is kept and nothing in it leaked.
 * Greetings and the scenario open a story in the version's world, so they're always rewritten.
 */
export function variantFieldPlan(d: CreatorDraft) {
  if (!d.variant || !d.bible.some((b) => b.text.trim())) return null;
  const marks = variantMarks(d);
  const leaked = new Set(draftLeaks(d).filter((l) => l.where === "field").map((l) => l.key));
  const keep: string[] = [];
  const rewrite: string[] = [];
  for (const f of d.fields) {
    const sections = readsOf(d, f.key).filter((k) => marks[k]);
    const allKept = sections.length > 0 && sections.every((k) => marks[k] === "kept");
    const opens = f.key === "scenario" || isGreeting(f.key);
    if (f.value.trim() && allKept && !opens && !leaked.has(f.key)) keep.push(f.key);
    else rewrite.push(f.key);
  }
  return { keep, rewrite };
}

// ---------- the editor's pass on the card ----------

const fieldCheckSchema = z.object({ issues: z.array(z.object({ field: z.string(), problem: z.string(), fix: z.string().default("") })).default([]) });

/**
 * A demanding editor reads the written card, not just the bible: flat or generic greetings, a voice
 * that drifts from the bible, contradictions between fields, {{user}} being played, rules that don't
 * re-anchor anything. Each note carries a fix the writer can follow as a rewrite steer.
 */
export async function critiqueFields(id: string) {
  const d = mustCreator(id);
  const written = d.fields.filter((f) => f.value.trim());
  if (!written.length) throw badRequest("Write some fields first");
  const keys = d.fields.map((f) => f.key);
  const r = await callJson({
    task: "summarizer",
    kind: "creator:critique",
    name: "creator_critique",
    schema: fieldCheckSchema,
    system: [
      `You are a demanding editor reviewing ${LABEL[d.kind]} before it's used. ${who(d)} Read the written fields against the bible and find what would make the roleplay worse:`,
      d.kind === "persona"
        ? "anything written as if this were a character card (greetings, scenes, {{char}} or {{user}} macros, a relationship \"with {{user}}\"); text that decides what they feel, say or choose instead of describing who they are; generic or purple prose; traits told instead of shown; contradictions between fields or with the bible and world; a description that wouldn't tell a storyteller who it's talking to (role, look, manner, what others notice first); pronouns that don't match the bible."
        : "a voice that doesn't match the bible's sample lines; generic or purple prose; traits told instead of shown; contradictions between fields or with the bible and world; greetings that are static, play {{user}}'s actions or feelings, or don't give {{user}} something to answer; greetings that repeat each other; example dialogue that doesn't show range; rules that are generic instead of specific to this character; a description missing the want, the flaw or the relationship to {{user}}.",
      canonRule(d.basedOn) ? `${canonRule(d.basedOn)} Flag canon mistakes too.` : "",
      `Each issue names the field by key (${keys.join(", ")}), states the problem in one sentence, and gives "fix": an instruction a writer could follow as is. At most 10, most important first; if it's strong, return few.`,
      'Reply with JSON only: {"issues": [{"field": "…", "problem": "…", "fix": "…"}]}',
    ]
      .filter(Boolean)
      .join(" "),
    user: [`THE BIBLE:\n${bibleText(d)}`, ...baseBlocks(d, { world: 1000 }).filter((b) => !b.startsWith("THE AUTHOR'S IDEA") && !b.startsWith("THE EXPANDED CONCEPT")), ...written.map((f) => `[${f.key}] ${f.label.toUpperCase()}:\n${f.value.trim().slice(0, 4000)}`)].join("\n\n"),
    maxTokens: 2200,
    temperature: judgeTemp(0.3),
  });
  return mutateCreator(id, (cur) => {
    cur.fieldCheck = r.data.issues
      .filter((i) => keys.includes(i.field) && i.problem.trim())
      .slice(0, 10)
      .map((i) => ({ id: newId(), field: i.field, problem: i.problem.trim(), fix: i.fix.trim() }));
  });
}

/** Applies one of the editor's notes: that field is rewritten in the background with the fix as its steer. */
export function applyFieldCheck(id: string, issueId: string) {
  const d = mustCreator(id);
  const issue = d.fieldCheck?.find((x) => x.id === issueId);
  if (!issue) throw notFound("That note is gone");
  queueFields(id, { keys: [issue.field], steer: issue.fix || issue.problem, force: true });
  return mutateCreator(id, (cur) => void (cur.fieldCheck = (cur.fieldCheck ?? []).filter((x) => x.id !== issueId)));
}

// ---------- the co-writer ----------

const cowriteSchema = z.object({
  reply: z.string().default(""),
  lookup: z.array(z.string()).default([]),
  changes: z.array(z.object({ kind: z.string(), key: z.string().default(""), section: z.string().default(""), text: z.string().default(""), steer: z.string().default("") })).default([]),
});

/** The shape options the co-writer may change, with what each accepts. */
const OPTION_VALUES: Record<string, readonly string[] | "text" | "count"> = {
  tone: "text",
  style: "text",
  length: ["lean", "standard", "rich"],
  pov: ["first", "second", "third"],
  tense: ["present", "past"],
  mode: ["companion", "narrator"],
  greetings: "count",
};
/** A persona has no point of view, tense, card type or greetings to set. */
const optionKeys = (kind: CreatorKind) => (kind === "persona" ? ["tone", "style", "length"] : Object.keys(OPTION_VALUES));

/** An option value the co-writer proposed, made valid (null if it isn't). */
function optionValue(key: string, raw: string): string | number | null {
  const want = OPTION_VALUES[key];
  const v = raw.trim();
  if (!want) return null;
  if (want === "text") return v.slice(0, key === "tone" ? 300 : 600);
  if (want === "count") {
    const n = Number.parseInt(v, 10);
    return Number.isFinite(n) ? Math.max(0, Math.min(5, n)) : null;
  }
  const hit = want.find((x) => v.toLowerCase().startsWith(x));
  return hit ?? null;
}

/**
 * What the co-writer should know is off: the automatic checks, fields written from an older bible,
 * the editors' notes, and open questions. So "fix what's wrong" and "what's missing?" just work.
 */
function stateBlock(d: CreatorDraft) {
  const lines: string[] = [];
  const open = d.questions.map((q, i) => ({ q, n: i + 1 })).filter(({ q }) => !q.answer.trim());
  if (open.length) lines.push(`Open questions (answer one with {"kind": "answer", "key": "<number>"}):\n${open.map(({ q, n }) => `  ${n}. ${q.q}`).join("\n")}`);
  if (d.readback?.missing.length) lines.push(`Still unclear: ${d.readback.missing.join("; ")}`);
  if (d.bibleCheck?.length) lines.push(`Bible editor's notes:\n${d.bibleCheck.map((i) => `  [${i.section}] ${i.problem}${i.fix ? ` Fix: ${i.fix}` : ""}`).join("\n")}`);
  if (d.fieldCheck?.length) lines.push(`Card editor's notes:\n${d.fieldCheck.map((i) => `  [${i.field}] ${i.problem}${i.fix ? ` Fix: ${i.fix}` : ""}`).join("\n")}`);
  if (d.fields.some((f) => f.value.trim())) {
    const r = reviewCreator(d.id);
    const stale = Object.entries(r.stale as Record<string, string[]>).map(([k, why]) => `  [${k}] written before ${why.join(", ")} changed`);
    if (stale.length) lines.push(`Out of date:\n${stale.join("\n")}`);
    const warn = Object.entries(r.issues).flatMap(([k, list]) => list.filter((i) => i.severity === "warn").map((i) => `  [${k}] ${i.message}`));
    if (warn.length) lines.push(`Automatic checks:\n${warn.slice(0, 12).join("\n")}`);
  }
  const empty = d.fields.filter((f) => !f.value.trim() && f.status !== "queued" && f.status !== "writing").map((f) => f.key);
  if (d.bible.length && empty.length) lines.push(`Not written yet: ${empty.join(", ")}`);
  const writing = d.fields.filter((f) => f.status === "queued" || f.status === "writing").map((f) => f.key);
  if (writing.length) lines.push(`Being written right now (don't edit these): ${writing.join(", ")}`);
  return lines.length ? `THE STATE OF THE DRAFT (stage: ${d.stage}):\n${lines.join("\n")}` : `THE STATE OF THE DRAFT (stage: ${d.stage}): nothing flagged.`;
}

/**
 * "Make her five years older and give her a sister in the navy": the co-writer reads the whole
 * draft (idea, answers, bible, every field, and what's flagged) and proposes exact edits to the
 * bible sections and fields it touches, background rewrites, answers to open questions, the
 * draft's shape and canon, or writing what's left, for you to accept or reject one by one.
 */
export async function cowriteCreator(id: string, message: string) {
  const d = mustCreator(id);
  const sections = d.bible.map((b) => b.key);
  const fields = d.fields.map((f) => f.key);
  const persona = d.kind === "persona";
  const opts = optionKeys(d.kind);
  // The co-writer can read the wiki before it answers.
  const wikis = await wikisFor(d.research, d.basedOn);
  const ask = async (looked: string) => (await callJson({
    task: "assistant",
    kind: "creator:cowrite",
    name: "creator_cowrite",
    schema: cowriteSchema,
    system: [
      COWRITER,
      who(d),
      `The draft is ${LABEL[d.kind]}: a bible (the source of truth) and the ${persona ? "persona's" : "card's"} fields written from it. Changes you can propose:`,
      `{"kind": "bible", "key": "<section key>", "text": "the whole new section"} (keys: ${sections.join(", ") || "none yet"});`,
      `{"kind": "field", "key": "<field key>", "text": "the whole new field"} for a precise edit to a written field (keys: ${fields.join(", ")});`,
      `{"kind": "rewrite", "key": "<field key>", "steer": "what to change"} when a long field (${persona ? "the description, the background" : "a greeting, the description"}) needs rewriting rather than a small edit;`,
      '{"kind": "name", "text": "the new name"};',
      d.variant ? '{"kind": "map", "key": "<the original name, or new>", "text": "what it is in this version, or \\"dropped\\", or \\"kept\\""} to change a row of THE MAP (or add a new one);' : "",
      d.variant ? '{"kind": "anchor", "text": "something about them that stays true in every version"} to add to WHAT STAYS TRUE;' : "",
      IDEA_CHANGES,
      d.questions.length ? '{"kind": "answer", "key": "<question number>", "text": "the answer, in the author\'s voice"} to answer an open interview question with what you agreed;' : "",
      `{"kind": "option", "key": "<${opts.join("|")}>", "text": "the new value"} to change the draft's shape (length: lean|standard|rich${persona ? "" : "; pov: first|second|third; tense: present|past; mode: companion|narrator; greetings: 0–5 alternate greetings"});`,
      '{"kind": "basedOn", "text": "the work and its medium, or empty for an original"} when what it\'s based on changes;',
      d.bible.some((b) => b.text.trim()) ? '{"kind": "write", "key": "empty" or "all"} to have the writer draft every empty field (or redo all of them) from the bible in the background, when they ask you to write the rest;' : "",
      "Before there's a bible, the idea and the expanded concept are the draft: brainstorm there.",
      `When a fact changes, change it in the bible AND in every written field that states it. ${persona ? "Call the persona by name; never use {{char}} for them." : "Keep the macros {{user}} and {{char}} as they are."} Use THE STATE OF THE DRAFT to answer "what's wrong" or "what's missing" and to fix it when asked. At most 16 changes.`,
      canonRule(d.basedOn),
      looked ? "" : LOOKUP_FIELD,
      'Reply with JSON only: {"reply": "…", "lookup": [], "changes": [ … ]}',
    ]
      .filter(Boolean)
      .join(" "),
    user: [
      ...baseBlocks(d, { world: 1200 }).filter((b) => !b.startsWith("THE AUTHOR'S IDEA") && !b.startsWith("THE EXPANDED CONCEPT")),
      ideaBlock(d.idea, d.expansion),
      d.bible.length ? `THE BIBLE:\n${d.bible.map((b) => `[${b.key}] ${b.label}\n${b.text.trim()}`).join("\n\n")}` : "",
      ...d.fields.filter((f) => f.value.trim()).map((f) => `FIELD [${f.key}] ${f.label}:\n${f.value.trim().slice(0, 5000)}`),
      `THE SHAPE: ${opts.map((k) => `${k}: ${String(d.options[k as keyof CreatorOptions]) || "(none)"}`).join("; ")}`,
      stateBlock(d),
      chatBlock(d.chat),
      looked,
      `THE AUTHOR SAYS: ${message.trim()}`,
    ]
      .filter(Boolean)
      .join("\n\n"),
    maxTokens: 8000,
    temperature: 0.7,
  })).data;
  const { data, sources } = await withLookups(ask, (q) => lookup(wikis, q, 5000));
  const r = { data };
  const changes: Omit<ProposedChange, "id">[] = [];
  for (const c of r.data.changes.slice(0, 16)) {
    const kind = c.kind.trim().toLowerCase();
    const sec = d.bible.find((b) => b.key === c.key) ?? (kind === "bible" ? BIBLE[d.kind].find((b) => b.key === c.key) : undefined);
    const f = d.fields.find((x) => x.key === c.key);
    const text = persona ? unslipPersona(tidy(c.text), d.name) : tidy(c.text);
    if (kind === "bible" && sec && text && text !== ("text" in sec ? sec.text.trim() : "")) changes.push({ kind, target: c.key, label: `Bible · ${sec.label}`, before: "text" in sec ? sec.text : "", after: text });
    else if (kind === "field" && f && text && text !== f.value.trim()) changes.push({ kind, target: f.key, label: f.label, before: f.value, after: text });
    else if (kind === "rewrite" && f && (c.steer.trim() || text)) changes.push({ kind, target: f.key, label: `${f.label} · ${f.value.trim() ? "rewrite" : "write"}`, before: f.value, after: "", steer: c.steer.trim() || `Use this: ${text}` });
    else if (kind === "name" && text && text.length <= 60 && text !== d.name) changes.push({ kind, target: "name", label: "Name", before: d.name, after: text });
    else if (kind === "map" && d.variant && text) {
      const row = d.variant.map.find((r) => r.from.trim().toLowerCase() === c.key.trim().toLowerCase());
      const before = row ? (row.state === "changed" ? row.to : row.state) : "";
      if (row) changes.push({ kind, target: row.id, label: `Map · ${row.from}`, before, after: text });
      else if (c.key.trim().toLowerCase() === "new" || !c.key.trim()) changes.push({ kind, target: "new", label: "Map · new", before: "", after: text });
    } else if (kind === "anchor" && d.variant && text && !d.variant.anchors.some((a) => a.text.trim().toLowerCase() === text.toLowerCase())) changes.push({ kind, target: "anchor", label: "What stays true", before: "", after: text });
    else if (isIdeaKind(kind)) changes.push(...ideaChanges({ ...c, text }, d.idea, d.expansion));
    else if (kind === "answer") {
      const q = d.questions[Number.parseInt(c.key, 10) - 1] ?? d.questions.find((x) => x.id === c.key);
      if (q && text && text !== q.answer.trim()) changes.push({ kind, target: q.id, label: `Answer · ${q.q.slice(0, 80)}`, before: q.answer, after: text });
    } else if (kind === "option" && opts.includes(c.key)) {
      const v = optionValue(c.key, c.text);
      const was = d.options[c.key as keyof CreatorOptions];
      if (v !== null && v !== was) changes.push({ kind, target: c.key, label: `Shape · ${c.key}`, before: String(was), after: String(v) });
    } else if (kind === "basedon" && c.text.trim() !== d.basedOn.trim()) changes.push({ kind: "basedOn", target: "basedOn", label: "Based on", before: d.basedOn, after: c.text.trim().slice(0, 200) });
    else if (kind === "write" && d.bible.some((b) => b.text.trim())) {
      const all = c.key.trim().toLowerCase() === "all";
      const keys = all ? d.fields.map((f) => f.label) : d.fields.filter((f) => !f.value.trim()).map((f) => f.label);
      if (keys.length && !changes.some((x) => x.kind === "write")) changes.push({ kind, target: all ? "all" : "empty", label: all ? "Write every field again" : "Write the empty fields", before: "", after: keys.join(", ") });
    }
  }
  const kept = lastPerSection(changes);
  const proposal = newProposal(message.trim(), withDropNote(r.data.reply.trim() || (kept.length ? "Here's what I'd change." : "Nothing to change for that."), r.data.changes.length, kept.length), kept);
  return mutateCreator(id, (cur) => {
    cur.chat = addTurns(cur.chat, { role: "user", text: message }, { role: "mea", text: proposal.reply, ...(sources.length ? { sources: sources.map((p) => ({ title: p.title, url: p.url })) } : {}) });
    cur.proposal = kept.length ? proposal : null;
  });
}

/** Accepts some of the co-writer's changes (by id); rewrites go to the background writer. */
export function applyCreatorCowrite(id: string, accept: string[]) {
  const p = mustCreator(id).proposal;
  if (!p) throw badRequest("There's nothing to apply");
  const ok = p.changes.filter((c) => accept.includes(c.id));
  const rewrites: { key: string; steer: string }[] = [];
  let writeAll: "empty" | "all" | null = null;
  const d = mutateCreator(id, (d) => {
    for (const c of ok) {
      if (c.kind === "bible") {
        const sec = d.bible.find((b) => b.key === c.target);
        if (sec) sec.text = c.after;
        else {
          const spec = BIBLE[d.kind].find((b) => b.key === c.target);
          if (spec) d.bible.push({ key: spec.key, label: spec.label, text: c.after });
        }
      } else if (c.kind === "field") {
        const f = d.fields.find((x) => x.key === c.target);
        if (f && f.status !== "queued" && f.status !== "writing") {
          if (f.value.trim()) f.previous = f.value;
          f.value = c.after;
          f.status = "done";
        }
      } else if (c.kind === "name") d.name = c.after;
      else if (c.kind === "map" && d.variant) {
        const row = d.variant.map.find((r) => r.id === c.target);
        const v = c.after.trim();
        const word = v.toLowerCase();
        if (!row) d.variant.map.push(newRow({ from: "", to: v, state: "new", source: "mea" }));
        else if (word === "dropped" || word === "kept") Object.assign(row, { state: word as RowState, to: "" });
        else Object.assign(row, { state: "changed" as RowState, to: v });
      } else if (c.kind === "anchor" && d.variant) d.variant.anchors.push({ id: newId(), text: c.after.trim(), kept: true, from: "mea" });
      else if (c.kind === "idea" || c.kind === "section") applyIdeaChange(d, c, (t) => (d.idea = t));
      else if (c.kind === "rewrite") rewrites.push({ key: c.target, steer: c.steer ?? "" });
      else if (c.kind === "answer") {
        const q = d.questions.find((x) => x.id === c.target);
        if (q) q.answer = c.after;
      } else if (c.kind === "option") {
        const v = optionValue(c.target, c.after);
        if (v !== null) d.options = { ...d.options, [c.target]: v };
      } else if (c.kind === "basedOn") d.basedOn = c.after;
      else if (c.kind === "write") writeAll = c.target === "all" ? "all" : "empty";
    }
    // Fields edited here match the bible as it now stands.
    for (const c of ok) if (c.kind === "field") {
      const f = d.fields.find((x) => x.key === c.target);
      if (f) f.basis = fieldBasis(d, f.key);
    }
    d.proposal = null;
    if (ok.length) d.chat = addTurns(d.chat, { role: "mea", text: `Applied ${ok.length} of ${p.changes.length} change${p.changes.length === 1 ? "" : "s"}.` });
  });
  for (const w of rewrites) queueFields(id, { keys: [w.key], steer: w.steer, force: true });
  if (writeAll) queueFields(id, writeAll === "all" ? { all: true, force: true } : {});
  return rewrites.length || writeAll ? mustCreator(id) : d;
}

export function dismissCreatorCowrite(id: string) {
  return mutateCreator(id, (d) => void (d.proposal = null));
}

export function clearCreatorChat(id: string) {
  return mutateCreator(id, (d) => {
    d.chat = [];
    d.proposal = null;
  });
}

// ---------- review ----------

export function reviewCreator(id: string) {
  const d = mustCreator(id);
  const issues: Record<string, CardIssue[]> = {};
  const tokens: Record<string, number> = {};
  for (const f of d.fields) {
    tokens[f.key] = countTokens(f.value);
    if (!f.value.trim()) {
      issues[f.key] = f.status === "done" || f.status === "error" ? [{ kind: "empty", severity: "warn", message: "Empty." }] : [];
      continue;
    }
    if (isGreeting(f.key)) issues[f.key] = [...checkGreeting(f.value, d.options.pov), ...checkProse(f.value)];
    else if (f.key === "mes_example") issues[f.key] = checkExamples(f.value);
    else if (f.key === "description") issues[f.key] = checkProse(f.value, { maxTokens: d.kind === "persona" ? 350 : { lean: 550, standard: 800, rich: 1100 }[d.options.length], minTokens: d.kind === "persona" ? 40 : 150 });
    else if (f.key === "personality") issues[f.key] = checkProse(f.value, { maxTokens: d.kind === "persona" ? 200 : 140 });
    else if (f.key === "scenario") issues[f.key] = [...checkProse(f.value), ...(d.kind === "character" && d.options.mode === "companion" ? checkScenario(f.value) : [])];
    else if (f.key === "tags" || f.key === "pronouns") issues[f.key] = [];
    else issues[f.key] = checkProse(f.value);
    if (d.kind === "persona" && f.key !== "pronouns") issues[f.key]!.push(...checkPersona(f.value));
  }
  // A version's fields shouldn't name what its world changed or dropped.
  for (const l of draftLeaks(d)) {
    if (l.where !== "field") continue;
    (issues[l.key] ??= []).push({ kind: "leak", severity: "warn", message: l.state === "changed" ? `"${l.term}" is "${l.to}" in this version.` : `"${l.term}" doesn't exist in this version.` });
  }
  // A version opens its own story: a greeting still the original's word for word is never saved.
  const sameGreeting = originalGreeting(d);
  if (sameGreeting) (issues.first_mes ??= []).push({ kind: "original", severity: "warn", message: `Still ${sameGreeting}'s greeting word for word: write this version's own (it can't be saved as it is).` });
  // Greetings that open the same way read as one greeting three times.
  const greetings = d.fields.filter((f) => isGreeting(f.key) && f.value.trim());
  for (let i = 0; i < greetings.length; i++)
    for (let j = 0; j < i; j++) {
      const a = new Set(greetings[i]!.value.toLowerCase().match(/[a-z]{4,}/g) ?? []);
      const b = new Set(greetings[j]!.value.toLowerCase().match(/[a-z]{4,}/g) ?? []);
      const shared = [...a].filter((w) => b.has(w)).length / Math.max(1, Math.min(a.size, b.size));
      if (shared > 0.6) issues[greetings[i]!.key]!.push({ kind: "repeats", severity: "info", message: `Very close to the ${greetings[j]!.label.toLowerCase()}; a different place, time or mood would add more.` });
    }
  const stale = Object.fromEntries(d.fields.map((f) => [f.key, staleFieldReasons(d, f)]).filter(([, r]) => r!.length));
  const permanent = d.kind === "character" ? ["description", "personality", "scenario"].reduce((n, k) => n + (tokens[k] ?? 0), 0) : d.fields.reduce((n, f) => n + (tokens[f.key] ?? 0), 0);
  return { issues, tokens, stale, cost: { permanent, greeting: tokens.first_mes ?? 0, examples: tokens.mes_example ?? 0 } };
}

// ---------- save ----------

/** The original's name when a version's greeting is still the original's word for word (docs/14). */
function originalGreeting(d: CreatorDraft): string | null {
  const v0 = d.origin?.versionOf;
  if (!v0 || d.kind !== "character") return null;
  const mine = d.fields.find((f) => f.key === "first_mes")?.value.trim() ?? "";
  const theirs = getCard(v0.id)?.first_mes?.trim() ?? "";
  return mine && mine === theirs ? (d.variant?.originName ?? getCard(v0.id)?.name ?? "the original") : null;
}

export function saveCreator(id: string, opts: { makeDefault?: boolean } = {}) {
  const d = mustCreator(id);
  const sameGreeting = originalGreeting(d);
  if (sameGreeting) throw badRequest(`This version still opens with ${sameGreeting}'s greeting: write its own greeting first`);
  const v = (k: string) => d.fields.find((f) => f.key === k)?.value.trim() ?? "";
  const name = d.name.trim() || (d.kind === "persona" ? "New persona" : "New character");
  let savedId = d.savedId ?? d.baseId;
  if (d.kind === "character") {
    if (!v("description") && !v("first_mes")) throw badRequest("Write the description or the greeting first");
    const base = savedId ? getCard(savedId) : undefined;
    const tags = v("tags").split(/\s*,\s*/).filter(Boolean);
    const card = {
      ...(base ?? emptyCard(name)),
      name,
      description: v("description"),
      personality: v("personality"),
      scenario: v("scenario"),
      first_mes: v("first_mes"),
      alternate_greetings: d.fields.filter((f) => f.key.startsWith("alt_") && f.value.trim()).map((f) => f.value.trim()),
      mes_example: v("mes_example"),
      // The card's rules follow the preset's own post-history instructions ({{original}}).
      post_history_instructions: v("rules") ? `{{original}}
${v("rules")}` : (base?.post_history_instructions ?? ""),
      creator_notes: v("creator_notes") || base?.creator_notes || "",
      tags: tags.length ? tags : (base?.tags ?? []),
    };
    if (savedId && getCharacterRow(savedId) && !getCharacterRow(savedId)!.deleted_at) updateCharacter(savedId, { card, note: "From the creator studio", mode: d.options.mode, tags: card.tags });
    else savedId = createCharacter(normalizeCard({ spec: "chara_card_v3", data: card }).data, { mode: d.options.mode, tags: card.tags });
  } else {
    if (!v("description") && !v("background")) throw badRequest("Write the description or the background first");
    const data = { description: v("description"), appearance: v("appearance"), personality: v("personality"), background: v("background"), pronouns: v("pronouns") };
    const existing = savedId ? getPersona(savedId) : undefined;
    if (existing && !existing.deletedAt) updatePersona(savedId!, { name, data, isDefault: opts.makeDefault || undefined });
    else savedId = createPersona({ name, data, isDefault: opts.makeDefault });
  }
  // A version (docs/14) is linked to its original the first time it's saved.
  const v0 = d.origin?.versionOf;
  if (v0 && !d.savedId && savedId !== v0.id)
    linkVersion(d.kind, savedId!, v0.id, d.variant ? { kind: d.variant.kind, label: d.variant.label, anchors: d.variant.anchors.filter((a) => a.kept).map((a) => a.text) } : { kind: v0.kind, label: v0.label });
  // Part 5: every save from the studio is what the version's fields are written from now.
  else if (v0 && savedId !== v0.id) snapshotBasis(d.kind, savedId!);
  // Part 4: a version lives in a universe: the one it joined (its map decisions go into the shared
  // map), or one made for it from its name, premise and map, which others can join later.
  let universeId: string | null = null;
  if (d.variant && v0 && savedId !== v0.id) {
    const joined = getUniverse(d.variant.universeId);
    const u = joined ? mergeIntoUniverse(joined.id, d.variant.map) : createUniverse({ name: d.variant.label || `${d.variant.originName}'s ${d.variant.kind === "au" ? "alternate universe" : d.variant.kind === "era" ? "other era" : d.variant.kind === "skip" ? "later years" : "what if"}`, premise: d.variant.premise, kind: d.variant.kind, map: d.variant.map.filter((r) => r.type !== "self") });
    joinUniverse(d.kind, savedId!, u.id);
    universeId = u.id;
  }
  const owner = { type: d.kind, id: savedId!, name };
  // The world it was made in comes along (LORE-02 scopes): a saved lore draft's book, and every world book.
  const lore = d.loreDraftId ? getLoreDraft(d.loreDraftId) : undefined;
  const books = [...new Set([...d.worldBookIds, ...(lore?.committedBookId ? [lore.committedBookId] : [])])];
  for (const b of books) linkLorebook(b, d.kind, savedId!);
  if (d.origin?.loreDraftId && d.origin.loreItemId && getLoreDraft(d.origin.loreDraftId))
    mutateLore(d.origin.loreDraftId, (l) => {
      const it = l.items.find((i) => i.id === d.origin!.loreItemId);
      if (it) it.links = { ...it.links, creatorDraftId: d.id, ...(d.kind === "character" ? { characterId: savedId! } : { personaId: savedId! }) };
    });
  // The depth book: deepening answers and depth entries, firing on meaning instead of riding every turn.
  let depthBookId = d.depthBookId;
  let depthIds: Record<string, string> = {};
  const depth = d.depth.filter((e) => e.content.trim());
  if (d.options.depthBook && depth.length) {
    depthBookId = ensureRoleBook("depth", owner, d.depthBookId);
    depthIds = writeDepthBook(depthBookId, depth);
  }
  // The rules book: always-on rules and a re-anchor, so the card plays to spec under any preset.
  let rulesBookId = d.rulesBookId;
  const section = (k: string) => d.bible.find((b) => b.key === k)?.text.trim() ?? "";
  if (d.kind === "character" && d.options.rulesBook && d.bible.length) {
    rulesBookId = ensureRoleBook("rules", owner, d.rulesBookId);
    writeRulesBook(rulesBookId, { name, narrator: d.options.mode === "narrator", brief: d.brief, section });
  }
  // World agency for a narrator: the bible's agenda and holds become an always-on rule.
  if (d.kind === "character" && d.options.mode === "narrator" && d.optional.includes("agency") && section("agency")) {
    const a = parseAgency(section("agency"));
    if (a.agenda) setAgency(savedId!, a);
  }
  if (d.origin?.personId) markPromoted(d.origin.personId, d.id, d.kind === "character" ? savedId! : null);
  const saved = mutateCreator(id, (cur) => {
    cur.savedId = savedId!;
    if (cur.variant && universeId) cur.variant.universeId = universeId;
    cur.stage = "done";
    cur.depthBookId = depthBookId;
    cur.rulesBookId = rulesBookId;
    for (const e of cur.depth) if (depthIds[e.id]) e.entryId = depthIds[e.id];
    if (lore?.committedBookId) cur.worldBookIds = [...new Set([...cur.worldBookIds, lore.committedBookId])];
  });
  return { id: savedId!, draft: saved };
}

/**
 * CHAR-18 / PER-03, from the creator: a companion lorebook drafted from the bible, so the lore
 * matches the card. World books are linked to the card already, so the plan skips what they cover.
 */
export function companionLore(id: string) {
  const d = mustCreator(id);
  if (!d.savedId) throw badRequest("Save it first");
  if (d.companionLoreDraftId && getLoreDraft(d.companionLoreDraftId)) return getLoreDraft(d.companionLoreDraftId)!;
  const lore = createLoreDraft({ kind: d.kind, refId: d.savedId, text: `THE ${d.kind === "persona" ? "PERSONA" : "CHARACTER"} BIBLE (canon; the people, places and events it names are the best entries):\n${bibleText(d)}`, options: { tone: d.options.tone } });
  mutateCreator(id, (cur) => void (cur.companionLoreDraftId = lore.id));
  return lore;
}

// ---------- depth ----------

const DEPTH_CRITERIA: Criterion[] = [
  { key: "self_contained", label: "Self-contained", description: "Reads as finished depth material on its own: no interview residue, no questions, no second person, no trace of an author or an asking." },
  { key: "author_preserved", label: "Your words kept", description: "The author's substance and wording survive; nothing is asserted beyond what they established." },
  { key: "premise_clean", label: "Premise clean", description: "Nothing from the question's framing that the answer didn't confirm survives; where the answer rejected the premise, the entry states the author's truth instead." },
];

const depthSchema = z.object({ title: z.string().default(""), content: z.string().default(""), keys: z.array(z.string()).default([]) });

/** One deepening Q&A as a self-contained entry, checked; revised once with what failed. */
async function composeOne(d: CreatorDraft, q: CreatorQuestion): Promise<DepthEntry> {
  const name = d.name && !/^New (character|persona)$/.test(d.name) ? d.name : "them";
  const ask = async (fix = "") =>
    (
      await callJson({
        task: "summarizer",
        kind: "creator:depth",
        name: "creator_depth_entry",
        schema: depthSchema,
        system: [
          `Compose one interview Q&A into ONE self-contained depth entry about ${name} that a storyteller can consult mid-scene; it surfaces only when its subject comes up. Write in the third person about them, by name; never address anyone, never mention the interview, the author or the question.`,
          "The question is scaffolding: take from it only what the answer confirms; where the answer rejects or corrects the question's premise, state the author's truth and let the rejected premise vanish. Keep the author's specifics verbatim; add nothing they didn't establish.",
          '"title": a short concrete title naming what it covers. "content": 1–4 sentences. "keys": 2–5 trigger words or names that would come up in a scene where it matters.',
          fix ? `A first try failed these checks; fix exactly them: ${fix}` : "",
          'Reply with JSON only: {"title": "…", "content": "…", "keys": ["…"]}',
        ]
          .filter(Boolean)
          .join("\n\n"),
        user: [`WHO THIS IS ABOUT: ${name}${d.brief ? `. ${d.brief}` : ""}`, `QUESTION: ${q.q}`, `ANSWER (the author's ${SOURCE_MARK[q.source]}): ${q.answer.trim()}`].join("\n\n"),
        maxTokens: 700,
        temperature: writeTemp(0.5),
      })
    ).data;
  const judge = (c: z.infer<typeof depthSchema>) => runGate({ kind: "creator:depth-gate", name: "creator_depth_gate", what: "one depth entry composed from an interview answer", criteria: DEPTH_CRITERIA, user: [`QUESTION: ${q.q}`, `ANSWER: ${q.answer.trim()}`, `THE TEXT TO JUDGE:\n${c.title}\n${c.content}`].join("\n\n") });
  let c = await ask();
  let gate = await judge(c);
  if (!gate.passed) {
    c = await ask(failedNotes(gate));
    gate = await judge(c);
  }
  return { id: newId(), title: c.title.trim() || q.q.slice(0, 60), content: tidy(c.content) || q.answer.trim(), keys: c.keys.map((k) => k.trim()).filter(Boolean).slice(0, 6), from: "answer", qid: q.id, gate };
}

const fromBibleSchema = z.object({ entries: z.array(depthSchema).default([]) });

/**
 * Depth entries: every deepening answer not composed yet becomes one entry; `fromBible` also drafts
 * entries from the bible for what shouldn't ride every turn (past events, people, secrets).
 */
export async function composeDepth(id: string, opts: { fromBible?: boolean } = {}) {
  const d = mustCreator(id);
  const done = new Set(d.depth.map((e) => e.qid).filter(Boolean));
  const todo = d.questions.filter((q) => q.section === "depth" && q.answer.trim() && !done.has(q.id));
  const made: DepthEntry[] = [];
  for (const q of todo) made.push(await composeOne(d, q));
  if (opts.fromBible) {
    if (!d.bible.some((b) => b.text.trim())) throw badRequest("Write the bible first");
    const name = d.name && !/^New (character|persona)$/.test(d.name) ? d.name : "them";
    const r = await callJson({
      task: "summarizer",
      kind: "creator:depth-bible",
      name: "creator_depth_from_bible",
      schema: fromBibleSchema,
      system: [
        `From this bible for ${LABEL[d.kind]}, draft 3–8 triggered depth entries about ${name}: material worth knowing but not worth carrying every turn (formative events, the people in their life, secrets, places, possessions with a story). Nothing basic or always relevant: that stays in the ${d.kind === "persona" ? "persona's always-on text" : "card"}.`,
        who(d),
        'Each: "title" (short, concrete), "content" (1–3 sentences, third person by name, faithful to the bible), "keys" (2–5 trigger words or names).',
        d.depth.length ? `Already there (don't repeat): ${d.depth.map((e) => e.title).join("; ")}` : "",
        'Reply with JSON only: {"entries": [{"title": "…", "content": "…", "keys": ["…"]}]}',
      ]
        .filter(Boolean)
        .join("\n\n"),
      user: `THE BIBLE:\n${bibleText(d)}`,
      maxTokens: 2000,
      temperature: writeTemp(0.6),
    });
    const text = (t: string) => (d.kind === "persona" ? unslipPersona(tidy(t), d.name) : tidy(t));
    for (const e of r.data.entries.slice(0, 8)) if (e.content.trim()) made.push({ id: newId(), title: e.title.trim() || "Detail", content: text(e.content), keys: e.keys.map((k) => k.trim()).filter(Boolean).slice(0, 6), from: "bible" });
  }
  return mutateCreator(id, (cur) => {
    const have = new Set(cur.depth.map((e) => e.qid).filter(Boolean));
    cur.depth.push(...made.filter((e) => !e.qid || !have.has(e.qid)));
  });
}

// ---------- a persona's paired opening ----------

/** Relationship registers for an opening written opposite a persona. */
export const REGISTERS: Record<string, string> = {
  neutral: "They are simply both present in the scene with no prior history. Open on the situation itself; the relationship is undefined and unweighted: a first encounter or a chance crossing.",
  canon: "Honour the character's own world and situation. The persona belongs inside it: open on a moment that fits the character's setting and stakes, meeting the persona the way this character really would.",
  au: "Reframe the meeting in an alternate setting (a different era, place or genre) while keeping both of them themselves. Establish the new frame quickly, then play the two of them in it.",
  romantic: "There is romantic or attractive charge between them. Open on a moment where that pull is live (tension, history or fresh spark) without being explicit.",
  adversarial: "They are at odds: rivals, opponents or wary antagonists. Open on friction or confrontation with real stakes between them.",
};

/** The counterpart's card as the greeting writer needs it: name, voice, scenario and its default opening. */
function counterpartCard(c: Counterpart) {
  const src = c.draftId ? getCreatorDraft(c.draftId) : undefined;
  if (src) {
    const v = (k: string) => src.fields.find((f) => f.key === k)?.value.trim() ?? "";
    return { name: src.name, voice: v("personality") || src.bible.find((b) => b.key === "voice")?.text || "", scenario: v("scenario"), first: v("first_mes"), description: v("description") };
  }
  const card = c.characterId ? getCard(c.characterId) : undefined;
  if (!card) throw notFound("The character is gone");
  return { name: card.name, voice: card.personality, scenario: card.scenario, first: card.first_mes, description: card.description };
}

/** The persona as {{user}} in a greeting: its written description, or its bible. */
function personaText(d: CreatorDraft) {
  const v = (k: string) => d.fields.find((f) => f.key === k)?.value.trim() ?? "";
  return [v("description"), v("appearance") && `Appearance: ${v("appearance")}`, v("personality") && `Personality: ${v("personality")}`].filter(Boolean).join("\n") || d.brief || bibleText(d).slice(0, 2000);
}

/** An alternate greeting on the counterpart's card that opens with this persona in play, in the register you pick. */
export async function pairedGreeting(id: string, register: string) {
  const d = mustCreator(id);
  if (d.kind !== "persona" || !d.counterpart) throw badRequest("Only a persona made to play opposite a character has a paired opening");
  const guidance = REGISTERS[register] ?? REGISTERS.neutral!;
  const c = counterpartCard(d.counterpart);
  const r = await callText({
    task: "summarizer",
    kind: "creator:paired-greeting",
    system: [
      "Field: Paired greeting",
      `Write ONE opening message from {{char}} (${c.name}) to {{user}}, to be used as an alternate greeting on {{char}}'s card. {{user}} IS the specific persona described below: open the scene opposite that persona.`,
      `RELATIONSHIP: ${guidance}`,
      "The message sounds like {{char}}'s own voice (the voice material is the source of truth), reflects their stance toward {{user}}, and lets {{char}} act, not just react. Use {{user}} and {{char}} where natural. NEVER write {{user}}'s actions, words, thoughts or feelings. Open in motion and end on something {{user}} can answer.",
      "Reply with the greeting only: no label, no preamble.",
    ].join("\n\n"),
    user: [
      `{{char}}: ${c.name}`,
      c.description && `WHO {{char}} IS:\n${c.description.slice(0, 1500)}`,
      c.voice && `{{char}}'S VOICE:\n${c.voice.slice(0, 1000)}`,
      c.scenario && `SCENARIO:\n${c.scenario.slice(0, 800)}`,
      c.first && `{{char}}'S DEFAULT OPENING (for voice; write a DIFFERENT opening):\n${c.first.slice(0, 1000)}`,
      `{{user}} IS THIS PERSONA (${d.name}):\n${personaText(d)}`,
    ]
      .filter(Boolean)
      .join("\n\n"),
    maxTokens: 1200,
    temperature: writeTemp(0.8),
    validate: (t) => (checkGreeting(tidy(t), "third").some((i) => i.kind === "puppets-user") ? "The greeting writes {{user}}'s actions, words or feelings. Rewrite it so {{user}} only perceives." : tidy(t) ? null : "That was empty."),
  });
  return mutateCreator(id, (cur) => void (cur.pairing = { register: REGISTERS[register] ? register : "neutral", text: tidy(r.text), appliedTo: null }));
}

/** Adds the paired opening to the counterpart: the saved card's alternate greetings, or its draft's next alternate greeting. */
export function applyPairing(id: string, text?: string) {
  const d = mustCreator(id);
  const opening = (text ?? d.pairing?.text ?? "").trim();
  if (!d.counterpart || !opening) throw badRequest("Write the paired opening first");
  const src = d.counterpart.draftId ? getCreatorDraft(d.counterpart.draftId) : undefined;
  const charId = src?.savedId ?? d.counterpart.characterId;
  let where: string;
  if (charId && getCard(charId)) {
    const card = getCard(charId)!;
    updateCharacter(charId, { card: { ...card, alternate_greetings: [...card.alternate_greetings, opening] }, note: `Opening opposite ${d.name}` });
    where = `card:${charId}`;
  } else if (src) {
    mutateCreator(src.id, (s) => {
      const empty = s.fields.find((f) => f.key.startsWith("alt_") && !f.value.trim() && f.status !== "queued" && f.status !== "writing");
      if (empty) {
        empty.value = opening;
        empty.status = "done";
        return;
      }
      if (s.options.greetings >= 5) throw badRequest(`${s.name} already has five alternate greetings`);
      s.options.greetings += 1;
      s.fields = syncFields(s.kind, s.options, s.fields);
      const f = s.fields.find((x) => x.key === `alt_${s.options.greetings}`)!;
      f.value = opening;
      f.status = "done";
    });
    where = `draft:${src.id}`;
  } else throw notFound("The character is gone");
  return mutateCreator(id, (cur) => void (cur.pairing = { register: cur.pairing?.register ?? "neutral", text: opening, appliedTo: where }));
}

// ---------- imports ----------

/** What an imported card carries (field sizes, its books), and whether it reads as one character or a narrator running a place. */
export async function suggestTreatment(characterId: string) {
  const c = getCard(characterId);
  if (!c) throw notFound("Character not found");
  const words = (s: string) => s.split(/\s+/).filter(Boolean).length;
  const fields = [
    { key: "description", label: "Description", words: words(c.description) },
    { key: "personality", label: "Personality", words: words(c.personality) },
    { key: "scenario", label: "Scenario", words: words(c.scenario) },
    { key: "first_mes", label: "Greeting", words: words(c.first_mes) },
    { key: "alternate_greetings", label: "Alternate greetings", words: c.alternate_greetings.reduce((n, g) => n + words(g), 0), count: c.alternate_greetings.length },
    { key: "mes_example", label: "Example dialogue", words: words(c.mes_example) },
  ];
  const books = linkedBooks("character", characterId).map((b) => ({ id: b.id, name: b.name, entries: getLorebook(b.id)?.entries.length ?? 0 }));
  const r = await callJson({
    task: "helper",
    kind: "creator:treatment",
    name: "creator_treatment",
    schema: z.object({ treatment: z.string().default("character"), why: z.string().default("") }),
    system: 'Read this character card and say how to rebuild it. "treatment": "character" if it reads as one person someone chats with, or "narrator" if it reads as a storyteller running a place and voicing many people (a scenario card with a cast and no single persona). "why": one short sentence quoting what tells you. Reply with JSON only: {"treatment": "character", "why": "…"}',
    user: [`NAME: ${c.name}`, c.description && `DESCRIPTION:\n${c.description.slice(0, 4000)}`, c.scenario && `SCENARIO:\n${c.scenario.slice(0, 1500)}`, c.first_mes && `GREETING:\n${c.first_mes.slice(0, 1500)}`].filter(Boolean).join("\n\n"),
    maxTokens: 300,
    temperature: judgeTemp(0.2),
  });
  const treatment: CreatorOptions["mode"] = r.data.treatment.trim().toLowerCase() === "narrator" ? "narrator" : "companion";
  return { name: c.name, fields, books, mode: (getCharacterRow(characterId)?.mode as CreatorOptions["mode"]) ?? "companion", treatment, why: r.data.why.trim() };
}
