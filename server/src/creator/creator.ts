import { z } from "zod";
import { emptyCard, normalizeCard } from "../cards/card";
import { all, newId, now, one, parseJson, run } from "../db/db";
import { publish } from "../lib/events";
import { badRequest, notFound } from "../lib/http";
import { countTokens } from "../lib/tokens";
import { linkLorebook, linkedBooks } from "../lore/service";
import { createDraft as createLoreDraft, getDraft as getLoreDraft, mutate as mutateLore } from "../lore/studio";
import { createCharacter, getCard, getCharacterRow, updateCharacter } from "../services/characters";
import { Deferred, enqueue, type JobContext } from "../services/jobs";
import { callJson, callText } from "../services/llm";
import { createPersona, getPersona, updatePersona } from "../services/personas";
import { type CardIssue, checkExamples, checkGreeting, checkProse } from "./checks";
import { applyExpansionPatch, CRAFT, deepenSection, type Expansion, type ExpansionPatch, expandIdea, expansionBlock, tidy } from "./expand";
import { worldContext } from "./world";

/**
 * The character and persona creator (Phase 4, CHAR-08…15, PER-04…06): Idea (in your words, with
 * "Expand my idea") → Questions (what the model understood, and pointed questions with why) →
 * Bible (one source of truth, reviewed by an editor pass) → Write (each card field drafted in the
 * background from the bible, in order) → Review and save as a real card or persona.
 *
 * It links to the Lore Studio both ways: lorebooks (or an unsaved lore draft) are the world every
 * step writes against and are linked on save; any lore entry can become a card; a saved card or
 * persona can get a companion lorebook drafted from its bible.
 */

export type CreatorKind = "character" | "persona";
export type CreatorStage = "idea" | "questions" | "bible" | "write" | "done";
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
}

export interface BibleSection {
  key: string;
  label: string;
  text: string;
}

export interface CardField {
  key: string;
  label: string;
  value: string;
  status: "empty" | "queued" | "writing" | "done" | "error";
  error: string;
  previous: string | null;
  steer: string;
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
  origin: { loreDraftId?: string; loreItemId?: string; fromDraftId?: string } | null;
  /** The character or persona being reworked; saving updates it (with version history). */
  baseId: string | null;
  readback: { understood: string; missing: string[] } | null;
  questions: { id: string; q: string; why: string; answer: string }[];
  bible: BibleSection[];
  bibleCheck: { section: string; problem: string; fix: string }[] | null;
  fields: CardField[];
  savedId: string | null;
  companionLoreDraftId: string | null;
  createdAt: number;
  updatedAt: number;
}

export const defaultCreatorOptions = (): CreatorOptions => ({ pov: "third", tense: "present", length: "standard", tone: "", style: "", mode: "companion", greetings: 2 });

// ---------- the bible ----------

const BIBLE: Record<CreatorKind, { key: string; label: string; ask: string }[]> = {
  character: [
    { key: "identity", label: "Identity", ask: "name, age, pronouns, what they are and do, and a one-line pitch" },
    { key: "appearance", label: "Appearance", ask: "build, face, hair, clothes, marks, how they move; details a scene can show" },
    { key: "personality", label: "Personality", ask: "traits shown as behaviour, and the contradiction at their core" },
    { key: "voice", label: "Voice", ask: "vocabulary, rhythm, verbal habits, what they never say, then 3–4 sample lines in quotes in different moods" },
    { key: "backstory", label: "Backstory", ask: "formative events with places and how long ago, and what each left behind" },
    { key: "motivation", label: "Wants and fears", ask: "what they want now, what they need, what they fear, how far they'd go" },
    { key: "flaws", label: "Flaws", ask: "two or three real flaws that cause trouble in scenes" },
    { key: "relationships", label: "Relationships", ask: "3–5 named people: who they are to them and where it stands now" },
    { key: "secrets", label: "Secrets", ask: "what they hide, from whom, and what happens if it comes out" },
    { key: "details", label: "Habits and details", ask: "routines, possessions, places, tells, likes and dislikes" },
    { key: "user", label: "With {{user}}", ask: "how they meet or know {{user}}, what they want from {{user}}, and the tension in the dynamic" },
    { key: "hooks", label: "Story hooks", ask: "four situations a story with them could open with" },
  ],
  persona: [
    { key: "identity", label: "Identity", ask: "name, age, pronouns, what they are and do" },
    { key: "appearance", label: "Appearance", ask: "build, face, hair, clothes, marks, how they carry themselves" },
    { key: "personality", label: "Personality", ask: "traits shown as behaviour, and the contradiction at their core" },
    { key: "voice", label: "Voice", ask: "how they talk, with 2–3 sample lines in quotes" },
    { key: "background", label: "Background", ask: "where they come from and the events that shaped them, with places and times" },
    { key: "relationships", label: "Relationships", ask: "3–5 named people in their life and where it stands" },
    { key: "skills", label: "Skills and limits", ask: "what they're good at, what they can't do, and what that costs them" },
    { key: "motivation", label: "What they want", ask: "their goal, their need, their fear" },
    { key: "details", label: "Habits and details", ask: "routines, possessions, tells, likes and dislikes" },
  ],
};

const NARRATOR_BIBLE: Record<string, string> = {
  identity: "the story's premise and the narrator's role: what world it runs, whose story it tells, its stance",
  voice: "the narration's voice: register, rhythm, how it handles description, dialogue and pacing, with 2–3 sample lines",
  relationships: "the main cast: 4–6 named characters with role, want and how they relate to {{user}}",
  user: "the role {{user}} plays in this world and what the world wants from them",
};

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
    "Give {{user}} a clear reason to respond, and end on an open hook: a question, an offer, a gesture, something left unresolved.",
    "NEVER write {{user}}'s actions, words, thoughts or feelings, and never decide what {{user}} does. Only describe what {{user}} could perceive.",
  ].join(" ");

function fieldAsk(kind: CreatorKind, key: string, o: CreatorOptions, label: string): string {
  const narrator = o.mode === "narrator";
  if (kind === "persona") {
    switch (key) {
      case "description":
        return `The persona's description, as the AI storyteller will read it: who this person is in the story. ${WORDS.personaDescription![o.length]} words, third person, present tense, by name: identity and role, personality as behaviour, what they want, and what others notice first. Describe; never script their choices or feelings in a scene.`;
      case "appearance":
        return "Their appearance: 50–120 words, concrete and visual: build, face, hair, clothes, marks, how they carry themselves.";
      case "personality":
        return "Their personality: 40–100 words of traits shown as behaviour, the contradiction at their core, and how they talk.";
      case "background":
        return `Their background: ${WORDS.background![o.length]} words: where they come from, the events that shaped them, the people in their life by name, their skills and limits.`;
      case "pronouns":
        return "Only their pronouns, like she/her or they/them. Nothing else.";
    }
  }
  switch (key) {
    case "description":
      return narrator
        ? `The card's main description for a narrator card: the world, its premise and tone, the main cast by name (role, want, how they talk), the places stories happen, and how the narrator runs scenes and plays every character except {{user}}. ${WORDS.description![o.length]} words, flowing prose in short paragraphs.`
        : `The card's main description: who they are, written as reference for a storyteller. ${WORDS.description![o.length]} words, third person, present tense, flowing prose in short paragraphs (no bullet lists, no W++ or brackets). Cover identity and role; appearance (concrete, with how they move); personality shown through behaviour and its contradiction; voice and speech habits; the past that matters now; wants, fears and flaws; key relationships by name; secrets (say plainly who knows them); and their relationship to {{user}}. Use their name for them and {{user}} for the player's character.`;
    case "personality":
      return "A compact personality summary: 30–70 words, the core traits as behaviour plus the contradiction, in one or two sentences.";
    case "scenario":
      return narrator
        ? "The scenario: where and when the story opens, what is happening in the world, and the role {{user}} steps into. 50–130 words, present tense."
        : "The scenario: the situation the story starts from: where and when, what is going on, how they and {{user}} stand with each other right now, and the tension in the air. 50–130 words, present tense, third person, with {{user}} for the player. Never decide {{user}}'s feelings or actions.";
    case "first_mes":
      return narrator
        ? `The greeting: the story's opening, told by the narrator. Set the scene in one specific place of the world, bring in one or two of the cast through what they do and say, and put a choice or a problem in front of {{user}}. ${WORDS.greeting![o.length]} words. ${GREETING_RULES(o)}`
        : `The greeting: the story's opening message, written by {{char}}. ${WORDS.greeting![o.length]} words. ${GREETING_RULES(o)}`;
    case "mes_example":
      return 'Example dialogue that teaches the voice. Three short exchanges, each starting with a line "<START>", then a line "{{user}}: …" (short and neutral) and a line "{{char}}: …" (2–5 sentences: narration as in the greeting, dialogue in double quotes). Show range: one calm, one under pressure, one where a flaw or secret pushes through. Use the habits in the voice section.';
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

const normField = (f: Partial<CardField> & { key: string; label: string }): CardField => ({ value: "", status: f.value ? "done" : "empty", error: "", previous: null, steer: "", ...f });

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
    questions: d.questions ?? [],
    bible: d.bible ?? [],
    bibleCheck: d.bibleCheck ?? null,
    fields: syncFields(kind, options, d.fields ?? []),
    savedId: d.savedId ?? null,
    companionLoreDraftId: d.companionLoreDraftId ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
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
  return r ? hydrate(r) : undefined;
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
  worldBookIds?: string[];
  loreDraftId?: string | null;
  options?: Partial<CreatorOptions>;
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
    fields: syncFields(input.kind, options, []),
    savedId: null,
    companionLoreDraftId: null,
    createdAt: t,
    updatedAt: t,
  };
  if (input.baseId) {
    const base = input.kind === "character" ? cardIdea(input.baseId) : personaIdea(input.baseId);
    d.baseId = input.baseId;
    d.name ||= base.name;
    d.idea = [base.idea, d.idea && `WHAT TO CHANGE: ${d.idea}`].filter(Boolean).join("\n\n");
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
    d.origin = { fromDraftId: src.id };
    d.options = { ...d.options, tone: src.options.tone, style: src.options.style, length: src.options.length };
    d.stage = d.bible.length ? "bible" : "idea";
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
  worldBookIds?: string[];
  loreDraftId?: string | null;
  expansion?: ExpansionPatch;
  bible?: Record<string, string>;
  fields?: Record<string, string>;
}

export function patchCreator(id: string, p: CreatorPatch) {
  return mutateCreator(id, (d) => {
    if (p.name !== undefined) d.name = p.name.trim() || d.name;
    if (p.stage) d.stage = p.stage;
    if (p.idea !== undefined) d.idea = p.idea;
    if (p.options) d.options = { ...d.options, ...p.options, greetings: Math.max(0, Math.min(5, p.options.greetings ?? d.options.greetings)) };
    if (p.answers) for (const q of d.questions) if (p.answers[q.id] !== undefined) q.answer = p.answers[q.id]!;
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
      }
    if (p.fields)
      for (const [key, value] of Object.entries(p.fields)) {
        const f = d.fields.find((x) => x.key === key);
        if (!f || f.status === "queued" || f.status === "writing") continue;
        f.value = value;
        f.status = value.trim() ? "done" : "empty";
      }
  });
}

// ---------- context ----------

const LABEL: Record<CreatorKind, string> = { character: "a character card for interactive fiction (roleplay)", persona: "the user's own character (a persona) for interactive fiction (roleplay)" };

function world(d: CreatorDraft, budget = 2500) {
  return worldContext({ bookIds: d.worldBookIds, loreDraftId: d.loreDraftId }, budget);
}

const answers = (d: CreatorDraft) =>
  d.questions
    .filter((q) => q.answer.trim())
    .map((q) => `Q: ${q.q}\nA: ${q.answer.trim()}`)
    .join("\n\n");

const prefs = (d: CreatorDraft) =>
  [
    d.kind === "character" ? `CARD TYPE: ${d.options.mode === "narrator" ? "narrator (a storyteller running a world and its cast)" : "companion (one character, one-on-one with {{user}})"}` : "",
    d.options.tone.trim() ? `TONE AND GENRE: ${d.options.tone.trim()}` : "",
    d.options.style.trim() ? `STYLE NOTES: ${d.options.style.trim()}` : "",
  ]
    .filter(Boolean)
    .join("\n");

const bibleText = (d: CreatorDraft) => d.bible.filter((b) => b.text.trim()).map((b) => `## ${b.label}\n${b.text.trim()}`).join("\n\n");

function baseBlocks(d: CreatorDraft, opts: { world?: number } = {}) {
  const w = world(d, opts.world ?? 2500);
  return [
    d.name && !/^New (character|persona)$/.test(d.name) ? `NAME: ${d.name}` : "",
    `THE AUTHOR'S IDEA (canon):\n${d.idea.trim() || "(see the expanded concept)"}`,
    expansionBlock(d.expansion),
    answers(d) ? `THE AUTHOR'S ANSWERS (their own words; canon):\n${answers(d)}` : "",
    w ? `THE WORLD (canon; fit into it):\n${w}` : "",
    prefs(d),
  ].filter(Boolean);
}

export function expandContext(d: CreatorDraft) {
  return { idea: [d.name && !/^New (character|persona)$/.test(d.name) ? `Name: ${d.name}` : "", d.idea].filter(Boolean).join("\n"), answers: answers(d), world: world(d, 2000), tone: d.options.tone, style: d.options.style };
}

// ---------- model steps ----------

export async function expandCreator(id: string, steer = "") {
  const d = mustCreator(id);
  const e = await expandIdea(d.kind, expandContext(d), { previous: d.expansion, steer });
  return mutateCreator(id, (cur) => void (cur.expansion = e));
}

export async function deepenCreator(id: string, sectionId: string, steer = "") {
  const d = mustCreator(id);
  if (!d.expansion) throw badRequest("Expand the idea first");
  const text = await deepenSection(d.kind, expandContext(d), d.expansion, sectionId, steer);
  return mutateCreator(id, (cur) => {
    const s = cur.expansion?.sections.find((x) => x.id === sectionId);
    if (s) s.text = text;
  });
}

const readbackSchema = z.object({ understood: z.string().default(""), missing: z.array(z.string()).default([]), questions: z.array(z.object({ q: z.string(), why: z.string().default("") })).default([]) });

/** Read-back + Interview (CHAR-08): what the model understood, and pointed questions with why they matter. */
export async function creatorReadback(id: string, count = 4) {
  const d = mustCreator(id);
  const r = await callJson({
    task: "helper",
    kind: `creator:readback`,
    name: "creator_readback",
    schema: readbackSchema,
    system: `You help an author create ${LABEL[d.kind]}. Read their material, then reply with: "understood": 2–4 sentences on who you understood this to be (be concrete); "missing": up to 4 short phrases naming what's still unclear; "questions": up to ${count} pointed questions, most important first, each with "why" (one short sentence on what the answer changes). Ask what makes them specific and alive: the contradiction, the want, the wound, the voice, ${d.kind === "character" ? "what they want from {{user}}, " : ""}the line they won't cross. Never ask what the material already answers, and never ask trivia. Reply with JSON only: {"understood": "…", "missing": ["…"], "questions": [{"q": "…", "why": "…"}]}`,
    user: baseBlocks(d, { world: 1200 }).join("\n\n"),
    maxTokens: 1200,
    temperature: 0.6,
  });
  return mutateCreator(id, (cur) => {
    cur.readback = { understood: r.data.understood.trim(), missing: r.data.missing.map((m) => m.trim()).filter(Boolean).slice(0, 4) };
    const kept = cur.questions.filter((q) => q.answer.trim());
    const have = new Set(kept.map((q) => q.q.trim().toLowerCase()));
    cur.questions = [...kept, ...r.data.questions.filter((q) => q.q.trim() && !have.has(q.q.trim().toLowerCase())).slice(0, count).map((q) => ({ id: newId(), q: q.q.trim(), why: q.why.trim(), answer: "" }))];
    if (cur.stage === "idea") cur.stage = "questions";
  });
}

/** Bible (CHAR-08): the single source of truth every field is written from. Rework keeps your edits. */
export async function writeBible(id: string, steer = "") {
  const d = mustCreator(id);
  const spec = BIBLE[d.kind].map((s) => ({ ...s, ask: (d.options.mode === "narrator" && d.kind === "character" && NARRATOR_BIBLE[s.key]) || s.ask }));
  const rework = d.bible.some((b) => b.text.trim());
  const shape = Object.fromEntries([["name", "…"], ...spec.map((s) => [s.key, "…"])]);
  const r = await callJson({
    task: "summarizer",
    kind: "creator:bible",
    name: "creator_bible",
    schema: z.object({ name: z.string().default("") }).catchall(z.unknown()),
    system: [
      `You write the bible for ${LABEL[d.kind]}: the single source of truth every card field will be written from. ${rework ? "Rework the current bible: keep what the author wrote or edited into it, and change what they ask." : ""}`,
      `Craft rules:\n- ${CRAFT}`,
      "Character craft: one clear contradiction at the core; a concrete want that drives scenes and a deeper need under it; flaws with teeth; a voice you'd recognise without a name tag; a past that explains the present; relationships with names and current tension. Nothing that only sounds good: every line must be usable in a scene.",
      `Sections (40–160 words each; sample lines in quotes where asked):\n${spec.map((s) => `- "${s.key}" (${s.label}): ${s.ask}`).join("\n")}`,
      steer.trim() ? `The author asks: ${steer.trim()}` : "",
      `Reply with JSON only: ${JSON.stringify(shape)}`,
    ]
      .filter(Boolean)
      .join("\n\n"),
    user: [...baseBlocks(d), rework ? `THE CURRENT BIBLE:\n${bibleText(d)}` : ""].filter(Boolean).join("\n\n"),
    maxTokens: 6000,
    temperature: 0.8,
  });
  const data = r.data as Record<string, unknown>;
  return mutateCreator(id, (cur) => {
    cur.bible = spec.map((s) => ({ key: s.key, label: s.label, text: typeof data[s.key] === "string" ? tidy(data[s.key] as string) : (cur.bible.find((b) => b.key === s.key)?.text ?? "") }));
    const name = typeof data.name === "string" ? data.name.trim() : "";
    if (name && name.length <= 60 && (/^New (character|persona)$/.test(cur.name) || !cur.name.trim())) cur.name = name;
    cur.bibleCheck = null;
    if (cur.stage === "idea" || cur.stage === "questions") cur.stage = "bible";
  });
}

/** One bible section, rewritten (a fix from the check, or your own steer). */
export async function rewriteBibleSection(id: string, key: string, steer = "") {
  const d = mustCreator(id);
  const s = d.bible.find((b) => b.key === key) ?? BIBLE[d.kind].find((b) => b.key === key);
  if (!s) throw notFound("Section not found");
  const ask = BIBLE[d.kind].find((b) => b.key === key)?.ask ?? "";
  const r = await callText({
    task: "summarizer",
    kind: "creator:bible-section",
    system: [
      `Rewrite one section of the bible for ${LABEL[d.kind]}: "${s.label}" (${ask}).`,
      steer.trim() ? `The author asks: ${steer.trim()}` : "Make it sharper, more specific and more playable, keeping every fact already in it.",
      "40–180 words, consistent with the other sections.",
      `Craft rules:\n- ${CRAFT}`,
      "Reply with the section text only: no heading, no preamble.",
    ].join("\n\n"),
    user: [...baseBlocks(d, { world: 1500 }), `THE BIBLE:\n${bibleText(d)}`, `THE SECTION: ${s.label}\n${"text" in s ? s.text : ""}`].join("\n\n"),
    maxTokens: 1200,
    temperature: 0.75,
    validate: (t) => (tidy(t).length < 20 ? "That was empty. Write the section text." : null),
  });
  return mutateCreator(id, (cur) => {
    const sec = cur.bible.find((b) => b.key === key);
    if (sec) sec.text = tidy(r.text);
    else cur.bible.push({ key, label: s.label, text: tidy(r.text) });
    if (cur.bibleCheck) cur.bibleCheck = cur.bibleCheck.filter((i) => i.section !== key);
  });
}

const checkSchema = z.object({ issues: z.array(z.object({ section: z.string(), problem: z.string(), fix: z.string().default("") })).default([]) });

/** The editor's pass (CHAR-13): genericness, contradictions, missing essentials, flatness. */
export async function checkBible(id: string) {
  const d = mustCreator(id);
  if (!d.bible.some((b) => b.text.trim())) throw badRequest("Write the bible first");
  const keys = BIBLE[d.kind].map((b) => b.key);
  const r = await callJson({
    task: "summarizer",
    kind: "creator:bible-check",
    name: "creator_bible_check",
    schema: checkSchema,
    system: `Review this bible for ${LABEL[d.kind]} like a demanding editor. Find: generic choices (stock names, tropes played straight with no twist, purple prose, traits told instead of shown); contradictions between sections or with the world; missing essentials (a distinct voice, a concrete want, a real flaw, ${d.kind === "character" ? "what they want from {{user}}, " : ""}tension that drives scenes); anything that would play flat. Each issue names the section by key (${keys.join(", ")}), states the problem in one sentence, and gives a concrete fix the author could accept as is. Only real issues, at most 8, most important first. If it's strong, return none. Reply with JSON only: {"issues": [{"section": "…", "problem": "…", "fix": "…"}]}`,
    user: [...baseBlocks(d, { world: 1500 }), `THE BIBLE:\n${d.bible.map((b) => `[${b.key}] ${b.label}\n${b.text.trim()}`).join("\n\n")}`].join("\n\n"),
    maxTokens: 1600,
  });
  return mutateCreator(id, (cur) => {
    cur.bibleCheck = r.data.issues.filter((i) => keys.includes(i.section) && i.problem.trim()).slice(0, 8).map((i) => ({ section: i.section, problem: i.problem.trim(), fix: i.fix.trim() }));
  });
}

// ---------- writing the fields (background) ----------

export function queueFields(id: string, opts: { keys?: string[]; steer?: string; all?: boolean } = {}) {
  const d = mutateCreator(id, (d) => {
    if (!d.bible.some((b) => b.text.trim())) throw badRequest("Write the bible first");
    const want = new Set(opts.keys ?? []);
    for (const f of d.fields) {
      const pick = opts.keys ? want.has(f.key) : opts.all ? true : !f.value.trim();
      if (!pick || f.status === "queued" || f.status === "writing") continue;
      f.status = "queued";
      f.error = "";
      if (opts.steer !== undefined) f.steer = opts.steer;
    }
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
      const value = await writeField(d, next, job);
      mutateCreator(draftId, (cur) => {
        const f = cur.fields.find((x) => x.key === next.key);
        if (!f) return;
        if (f.value.trim()) f.previous = f.value;
        f.value = value;
        f.status = "done";
        f.error = "";
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

const isGreeting = (key: string) => key === "first_mes" || key.startsWith("alt_");

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
      `Craft rules:\n- ${CRAFT}`,
      d.kind === "character" ? "Use the macros exactly: {{user}} for the player's character, {{char}} only where the format asks for it." : "",
      "Stay faithful to the bible and the world: every name, age, place and fact must match. Don't invent anything that contradicts them.",
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
    temperature: f.key === "tags" || f.key === "pronouns" ? 0.3 : 0.8,
    // A greeting that plays {{user}} gets one more try with the problem named (CHAR-13 anti-puppet).
    validate: (t) => {
      const text = tidy(t);
      if (!text) return "That was empty. Write the field.";
      if (isGreeting(f.key) && checkGreeting(text, d.options.pov).some((i) => i.kind === "puppets-user")) return "The greeting writes {{user}}'s actions, words or feelings. Rewrite it so {{user}} only perceives; leave every choice to them.";
      if (f.key === "mes_example" && !/<START>/i.test(text)) return 'Use "<START>" lines to separate the exchanges, and "{{user}}:" / "{{char}}:" speaker labels.';
      return null;
    },
  });
  let text = tidy(r.text);
  if (f.key === "tags") text = [...new Set(text.split(/[,\n]/).map((s) => s.replace(/^[-#*\s]+/, "").trim().toLowerCase()).filter((s) => s && s.length <= 30))].slice(0, 10).join(", ");
  if (f.key === "pronouns") text = text.split("\n")[0]!.replace(/[.]+$/, "").slice(0, 40);
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
    else if (f.key === "tags" || f.key === "pronouns") issues[f.key] = [];
    else issues[f.key] = checkProse(f.value);
  }
  // Greetings that open the same way read as one greeting three times.
  const greetings = d.fields.filter((f) => isGreeting(f.key) && f.value.trim());
  for (let i = 0; i < greetings.length; i++)
    for (let j = 0; j < i; j++) {
      const a = new Set(greetings[i]!.value.toLowerCase().match(/[a-z]{4,}/g) ?? []);
      const b = new Set(greetings[j]!.value.toLowerCase().match(/[a-z]{4,}/g) ?? []);
      const shared = [...a].filter((w) => b.has(w)).length / Math.max(1, Math.min(a.size, b.size));
      if (shared > 0.6) issues[greetings[i]!.key]!.push({ kind: "repeats", severity: "info", message: `Very close to the ${greetings[j]!.label.toLowerCase()}; a different place, time or mood would add more.` });
    }
  const permanent = d.kind === "character" ? ["description", "personality", "scenario"].reduce((n, k) => n + (tokens[k] ?? 0), 0) : d.fields.reduce((n, f) => n + (tokens[f.key] ?? 0), 0);
  return { issues, tokens, cost: { permanent, greeting: tokens.first_mes ?? 0, examples: tokens.mes_example ?? 0 } };
}

// ---------- save ----------

export function saveCreator(id: string, opts: { makeDefault?: boolean } = {}) {
  const d = mustCreator(id);
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
  // The world it was made in comes along (LORE-02 scopes): a saved lore draft's book, and every world book.
  const lore = d.loreDraftId ? getLoreDraft(d.loreDraftId) : undefined;
  const books = [...new Set([...d.worldBookIds, ...(lore?.committedBookId ? [lore.committedBookId] : [])])];
  for (const b of books) linkLorebook(b, d.kind, savedId!);
  if (d.origin?.loreDraftId && d.origin.loreItemId && getLoreDraft(d.origin.loreDraftId))
    mutateLore(d.origin.loreDraftId, (l) => {
      const it = l.items.find((i) => i.id === d.origin!.loreItemId);
      if (it) it.links = { ...it.links, creatorDraftId: d.id, ...(d.kind === "character" ? { characterId: savedId! } : { personaId: savedId! }) };
    });
  const saved = mutateCreator(id, (cur) => {
    cur.savedId = savedId!;
    cur.stage = "done";
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
