import { z } from "zod";
import { newId } from "../db/db";
import { badRequest } from "../lib/http";
import type { EntryExtra } from "../lore/activate";
import { getLorebook } from "../lore/service";
import { getCharacterRow } from "../services/characters";
import { callJson } from "../services/llm";
import { getDefaultPersona, getPersona } from "../services/personas";
import { baseBlocks, createCreatorDraft, type CreatorDraft, mustCreator, mutateCreator } from "./creator";
import { judgeTemp, writeTemp } from "./gate";
import { KIND_LABEL, mergeRows, type MapRow, newRow, type RowState, type RowType, ROW_TYPES, type VariantPlan } from "./variantcore";

/**
 * The variant studio's model steps (docs/14, part 2): takes on the premise, what stays true and the
 * questions about the change, the map from the original's world to the version's, and a persona's
 * version alongside a character's. The bible and the fields go through the creator itself, which
 * reads the version's premise, anchors and map in every step (variantBlock).
 */

function mustVariant(id: string): CreatorDraft & { variant: VariantPlan } {
  const d = mustCreator(id);
  if (!d.variant) throw badRequest("This draft isn't a version");
  return d as CreatorDraft & { variant: VariantPlan };
}

const whatOf = (d: CreatorDraft) => (d.kind === "persona" ? "the player's own character (a persona)" : d.options.mode === "narrator" ? "a narrator card (a storyteller running a world)" : "a character card");

// ---------- the premise ----------

const directionsSchema = z.object({ options: z.array(z.string()).default([]) });

/** "Show me directions": three divergent takes on the premise, never repeating what you've seen. */
export async function premiseDirections(id: string, steer = "") {
  const d = mustVariant(id);
  const v = d.variant;
  const r = await callJson({
    task: "helper",
    kind: "creator:variant-directions",
    name: "variant_directions",
    schema: directionsSchema,
    system: [
      `The author is making a version of ${v.originName}, ${whatOf(d)}: ${KIND_LABEL[v.kind]}${v.label ? ` ("${v.label}")` : ""}. Offer exactly 3 premises for it that are genuinely DIVERGENT: each moves them somewhere the others don't. Reach past the first, most obvious take for at least one.`,
      "Each premise: 2–4 concrete sentences: where and when this version lives, the one change everything else follows from, and what it does to who they are. Grounded in the original, never contradicting what the author already wrote.",
      steer.trim() ? `Move the whole set toward: ${steer.trim()}` : "",
      v.directions.length ? `Don't repeat these:\n${v.directions.map((x) => `- ${x}`).join("\n")}` : "",
      'Reply with JSON only: {"options": ["…", "…", "…"]}',
    ]
      .filter(Boolean)
      .join("\n\n"),
    user: baseBlocks(d, { world: 1000 }).join("\n\n"),
    maxTokens: 1200,
    temperature: writeTemp(0.9),
  });
  const list = r.data.options.map((x) => x.trim()).filter(Boolean).slice(0, 3);
  return mutateCreator(id, (cur) => {
    if (cur.variant) cur.variant.directions = [...cur.variant.directions, ...list].slice(-9);
  });
}

// ---------- what stays true, and the questions about the change ----------

const startSchema = z.object({
  anchors: z.array(z.string()).default([]),
  questions: z.array(z.object({ q: z.string().default(""), why: z.string().default(""), suggestions: z.array(z.string()).default([]) })).default([]),
});

const QUESTION_RULE =
  "Each question is about the CHANGE, never about who they already are: the point of divergence and when it happens, what the premise costs or gives them, who they are to the people around them now, what's lost, gained or turned upside down. One question each, plain words, with why you ask (one short sentence) and exactly 3 suggested answers that genuinely differ (each a concrete answer under 40 words).";

/**
 * Leaving the premise: Mea suggests what stays true about them in every version (you tick what holds),
 * and asks the first questions about the change, each with suggested answers. `anchorsOnly` suggests
 * just the anchors (a persona's version made alongside a character's already has its questions).
 */
export async function startVariant(id: string, opts: { anchorsOnly?: boolean } = {}) {
  const d = mustVariant(id);
  const v = d.variant;
  if (!v.premise.trim()) throw badRequest("Write the premise first");
  const r = await callJson({
    task: "helper",
    kind: "creator:variant-start",
    name: "variant_start",
    schema: startSchema,
    system: [
      `You help an author make a version of ${v.originName}, ${whatOf(d)}: ${KIND_LABEL[v.kind]}. Two jobs.`,
      `1. "anchors": 4–6 things about ${v.originName} that make them THEM and should stay true in any version: their voice, a core wound, what they want underneath, a habit, the way they treat people. Each a short concrete phrase drawn from the original (not generic: "dry humour that covers fear", not "funny").`,
      `2. "questions": the 3 questions about this version whose answers would change the most. ${QUESTION_RULE}`,
      'Reply with JSON only: {"anchors": ["…"], "questions": [{"q": "…", "why": "…", "suggestions": ["…", "…", "…"]}]}',
    ].join("\n\n"),
    user: baseBlocks(d, { world: 1200 }).join("\n\n"),
    maxTokens: 2200,
    temperature: judgeTemp(0.5),
  });
  return mutateCreator(id, (cur) => {
    if (!cur.variant) return;
    const have = new Set(cur.variant.anchors.map((a) => a.text.trim().toLowerCase()));
    for (const a of r.data.anchors.map((x) => x.trim()).filter(Boolean).slice(0, 6)) if (!have.has(a.toLowerCase())) cur.variant.anchors.push({ id: newId(), text: a, kept: true, from: "mea" });
    if (!opts.anchorsOnly) for (const q of r.data.questions.filter((x) => x.q.trim()).slice(0, 3)) cur.questions.push(variantQuestion(q));
    if (cur.stage === "idea") cur.stage = "questions";
  });
}

const variantQuestion = (q: { q: string; why: string; suggestions: string[] }) => ({
  id: newId(),
  q: q.q.trim(),
  why: q.why.trim(),
  answer: "",
  suggestions: q.suggestions.map((x) => x.trim()).filter(Boolean).slice(0, 3),
  section: "variant",
  source: "typed" as const,
  directions: [],
  shown: [],
  skipped: false,
});

const oneQuestionSchema = z.object({ q: z.string().default(""), why: z.string().default(""), suggestions: z.array(z.string()).default([]) });

/** "Ask me another": one more question about the change, building on what's answered. */
export async function anotherVariantQuestion(id: string, steer = "") {
  const d = mustVariant(id);
  const r = await callJson({
    task: "helper",
    kind: "creator:variant-question",
    name: "variant_question",
    schema: oneQuestionSchema,
    system: [
      `You help an author make a version of ${d.variant.originName}, ${whatOf(d)}. Ask the ONE next question whose answer would change this version the most, building on what's answered.`,
      QUESTION_RULE,
      steer.trim() ? `The author wants to be asked about: ${steer.trim()}` : "",
      `Already asked (never repeat):\n${d.questions.map((q) => `- ${q.q}`).join("\n") || "(nothing yet)"}`,
      'Reply with JSON only: {"q": "…", "why": "…", "suggestions": ["…", "…", "…"]}',
    ]
      .filter(Boolean)
      .join("\n\n"),
    user: baseBlocks(d, { world: 1000 }).join("\n\n"),
    maxTokens: 800,
    temperature: judgeTemp(0.6),
  });
  if (!r.data.q.trim()) throw badRequest("Nothing more to ask");
  return mutateCreator(id, (cur) => void cur.questions.push(variantQuestion(r.data)));
}

// ---------- the map ----------

const LORE_TYPE: Partial<Record<NonNullable<EntryExtra["type"]>, RowType>> = { character: "person", location: "place", item: "thing", faction: "group", event: "event", rule: "idea" };

/** Rows from the original's lorebooks, free: each entry's name and type. */
function loreRows(d: CreatorDraft): MapRow[] {
  const out: MapRow[] = [];
  for (const bookId of d.worldBookIds) {
    const book = getLorebook(bookId);
    for (const e of book?.entries ?? []) {
      const name = (e.comment || e.keys[0] || "").trim();
      if (!name || name.length > 80) continue;
      const t = (e.extra as EntryExtra | undefined)?.type;
      out.push(newRow({ from: name, type: (t && LORE_TYPE[t]) || "thing", source: "lore" }));
    }
  }
  return out.slice(0, 240);
}

const namesSchema = z.object({ rows: z.array(z.object({ type: z.string().default("thing"), name: z.string().default("") })).default([]) });

/** Names the original's card (and bible) mentions: people, places, groups, things, events. */
async function cardRows(d: CreatorDraft & { variant: VariantPlan }): Promise<MapRow[]> {
  const r = await callJson({
    task: "helper",
    kind: "creator:variant-names",
    name: "variant_names",
    schema: namesSchema,
    system: [
      `List every specific named person, place, group, thing and event in this material about ${d.variant.originName}, so an author can decide what each becomes in a new version. Proper names and specific things only (\"the Hollow Crown inn\", \"her brother Tomas\", \"the flood of '09\"), never generic ones (\"a tavern\", \"her family\"). Each one once; never lump people together.`,
      `"type" is one of: person, place, group, thing, event, idea. Leave out ${d.variant.originName} themself.`,
      'Reply with JSON only: {"rows": [{"type": "person", "name": "…"}]}',
    ].join("\n\n"),
    user: [`THE ORIGINAL:\n${d.idea.slice(0, 12_000)}`, d.variant.originBible?.length ? `THE ORIGINAL'S BIBLE:\n${d.variant.originBible.map((b) => `## ${b.label}\n${b.text}`).join("\n\n").slice(0, 12_000)}` : ""].filter(Boolean).join("\n\n"),
    maxTokens: 2500,
    temperature: judgeTemp(0.2),
  });
  return r.data.rows
    .filter((x) => x.name.trim() && x.name.trim().toLowerCase() !== d.variant.originName.trim().toLowerCase())
    .map((x) => newRow({ from: x.name.trim().slice(0, 80), type: (ROW_TYPES as string[]).includes(x.type) ? (x.type as RowType) : "thing", source: "card" }));
}

const fillSchema = z.object({
  rows: z.array(z.object({ name: z.string().default(""), state: z.string().default(""), to: z.string().default(""), note: z.string().default("") })).default([]),
  added: z.array(z.object({ type: z.string().default("thing"), name: z.string().default(""), note: z.string().default("") })).default([]),
});

const BATCH = 18;

async function fillBatch(d: CreatorDraft & { variant: VariantPlan }, rows: MapRow[], addNew: boolean) {
  return callJson({
    task: "summarizer",
    kind: "creator:variant-map",
    name: "variant_map",
    schema: fillSchema,
    system: [
      `You translate the world of ${d.variant.originName} into a version: ${KIND_LABEL[d.variant.kind]}${d.variant.label ? ` ("${d.variant.label}")` : ""}. For each row from the original, decide what it is in this version, following the premise and the author's answers.`,
      '"state": "kept" (the same thing exists here, unchanged), "changed" (it exists in a new form: "to" is its new name and a few words on what it is now, like "Dad, the county sheriff"), or "dropped" (it has no place in this version). Translate in the spirit of the premise: a medieval inn might become a roadside diner; keep what the premise leaves alone. Never invent a change the premise doesn\'t call for, and keep names when the premise allows.',
      `For the row "${d.variant.originName}" itself (type self): "changed" with who they are in this version in a few words.`,
      '"note": optional, a few words on why or how.',
      addNew ? '"added": 0–4 people, places or things this version needs that the original doesn\'t have (only what the premise clearly calls for), each with type and a few words.' : '"added": [].',
      'Reply with JSON only: {"rows": [{"name": "<the original name, exactly>", "state": "kept|changed|dropped", "to": "…", "note": "…"}], "added": [{"type": "place", "name": "…", "note": "…"}]}',
    ].join("\n\n"),
    user: [...baseBlocks(d, { world: 1500 }).filter((b) => !b.startsWith("THE MAP")), `THE ROWS TO DECIDE:\n${rows.map((r) => `- ${r.type === "self" ? "self" : r.type}: ${r.from}`).join("\n")}`].join("\n\n"),
    maxTokens: 3000,
    temperature: writeTemp(0.6),
  });
}

/** Proposes what each open row becomes (in batches); the first batch may also add what the version needs. */
export async function fillMap(id: string, opts: { all?: boolean } = {}) {
  let d = mustVariant(id);
  const open = d.variant.map.filter((r) => r.state === "open" && r.from.trim());
  if (!open.length) return d;
  const batches = opts.all ? Math.ceil(open.length / BATCH) : 2;
  for (let i = 0; i < batches; i++) {
    const rows = open.slice(i * BATCH, (i + 1) * BATCH);
    if (!rows.length) break;
    const r = await fillBatch(d, rows, i === 0 && !d.variant.map.some((x) => x.state === "new"));
    d = mutateCreator(id, (cur) => {
      if (!cur.variant) return;
      for (const x of r.data.rows) {
        const row = cur.variant.map.find((m) => m.state === "open" && m.from.trim().toLowerCase() === x.name.trim().toLowerCase());
        const state = x.state.trim().toLowerCase();
        if (!row || !["kept", "changed", "dropped"].includes(state)) continue;
        row.state = state as RowState;
        row.to = state === "changed" ? x.to.trim().slice(0, 200) : "";
        if (x.note.trim()) row.note = x.note.trim().slice(0, 200);
      }
      cur.variant.map = mergeRows(
        cur.variant.map,
        r.data.added.filter((a) => a.name.trim()).slice(0, 4).map((a) => newRow({ from: "", to: a.name.trim().slice(0, 120), note: a.note.trim().slice(0, 200), type: (ROW_TYPES as string[]).includes(a.type) ? (a.type as RowType) : "thing", state: "new", source: "mea" })),
      );
    }) as CreatorDraft & { variant: VariantPlan };
  }
  return d;
}

/**
 * The map: one row for the original themself, every entry in their lorebooks, and every name their
 * card mentions; then Mea proposes what the first rows become. Building again adds what's new and
 * never touches rows already there.
 */
export async function buildMap(id: string) {
  const d = mustVariant(id);
  const rows = [newRow({ from: d.variant.originName, type: "self", source: "card" }), ...loreRows(d), ...(await cardRows(d))];
  mutateCreator(id, (cur) => {
    if (!cur.variant) return;
    cur.variant.map = mergeRows(cur.variant.map, rows);
    cur.variant.mapBuilt = true;
  });
  return fillMap(id);
}

// ---------- a persona's version alongside a character's ----------

/**
 * "Make my persona's version too": a persona version with the same kind, name, premise, answers and
 * map, built to play opposite this character's version. It opens at its questions.
 */
export function personaVersion(id: string, personaId?: string | null) {
  const d = mustVariant(id);
  if (d.kind !== "character") throw badRequest("This is already a persona");
  const pid = personaId || getCharacterRow(d.variant.originId)?.default_persona_id || getDefaultPersona()?.id;
  if (!pid || !getPersona(pid)) throw badRequest("Pick a persona first");
  const p = createCreatorDraft({ kind: "persona", baseId: pid, asVersion: { kind: d.variant.kind, label: d.variant.label }, idea: d.variant.premise, oppositeOf: { draftId: d.id } });
  return mutateCreator(p.id, (cur) => {
    if (!cur.variant) return;
    cur.variant.map = d.variant.map.filter((r) => r.type !== "self").map((r) => ({ ...r, id: newId() }));
    cur.questions = d.questions.filter((q) => q.answer.trim()).map((q) => ({ ...q, id: newId() }));
    cur.worldBookIds = [...new Set([...cur.worldBookIds, ...d.worldBookIds])];
    cur.stage = "questions";
  });
}
