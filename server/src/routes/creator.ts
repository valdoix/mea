import { type Context, Hono } from "hono";
import { z } from "zod";
import { body } from "../lib/http";
import {
  applyCreatorCowrite,
  applyFieldCheck,
  checkBible,
  clearCreatorChat,
  cowriteCreator,
  critiqueFields,
  dismissCreatorCowrite,
  researchCreator,
  companionLore,
  createCreatorDraft,
  creatorReadback,
  deepenCreator,
  deleteCreatorDraft,
  expandCreator,
  listCreatorDrafts,
  mustCreator,
  patchCreator,
  queueFields,
  restoreField,
  switchCreatorKind,
  reviewCreator,
  rewriteBibleSection,
  saveCreator,
  stopFields,
  writeBible,
  writeVariantBible,
  draftLeaks,
  variantMarks,
  variantFieldPlan,
  answerQuestion,
  applyPairing,
  composeDepth,
  finishInterview,
  interviewPlan,
  nextQuestion,
  pairedGreeting,
  questionDirections,
  resetInterview,
  suggestTreatment,
  weaveCreator,
} from "../creator/creator";
import { harvestFromCreator } from "../lore/people";
import { extendText } from "../creator/expand";
import { versionKind } from "../services/linked";
import { createVersionLore } from "../lore/versionlore";
import { anotherVariantQuestion, buildMap, fillMap, personaVersion, premiseDirections, startVariant } from "../creator/variant";
import { ROW_STATES, ROW_TYPES, type RowState, type RowType } from "../creator/variantcore";

/** The character and persona creator (Phase 4). */
export const creator = new Hono();

async function opts<T extends z.ZodType>(c: Context, schema: T): Promise<z.infer<T>> {
  return (await c.req.text()).trim() ? body(c, schema) : schema.parse({});
}

const optionsSchema = z.object({
  pov: z.enum(["first", "second", "third"]),
  tense: z.enum(["present", "past"]),
  length: z.enum(["lean", "standard", "rich"]),
  tone: z.string().max(300),
  style: z.string().max(600),
  mode: z.enum(["companion", "narrator"]),
  greetings: z.number().int().min(0).max(5),
  format: z.enum(["prose", "tagged"]),
  autoCheck: z.boolean(),
  depthBook: z.boolean(),
  rulesBook: z.boolean(),
});
const source = z.enum(["idea", "typed", "picked", "extended"]);
const expansionPatch = z.object({
  sections: z.array(z.object({ id: z.string().max(100), heading: z.string().max(200).optional(), text: z.string().max(20_000).optional() })).max(40).optional(),
  use: z.boolean().optional(),
  remove: z.array(z.string()).optional(),
});
const steer = z.object({ steer: z.string().max(1000).optional() }).default({});
/** The draft, with what the interview will do about each section ("I'll handle next"). */
const d = (draft: ReturnType<typeof mustCreator>) => ({
  draft: {
    ...draft,
    plan: interviewPlan(draft),
    // A version (docs/14): its bible's marks, what leaked from the original's world, and which fields carry over.
    ...(draft.variant ? { leaks: draftLeaks(draft), marks: variantMarks(draft), fieldPlan: variantFieldPlan(draft) } : {}),
  },
});
const variantPatch = z.object({
  kind: versionKind.optional(),
  label: z.string().max(80).optional(),
  premise: z.string().max(8000).optional(),
  anchors: z.array(z.object({ id: z.string().optional(), text: z.string().max(300).optional(), kept: z.boolean().optional(), remove: z.boolean().optional() })).max(40).optional(),
  map: z.array(z.object({ id: z.string().optional(), type: z.enum(ROW_TYPES as [RowType, ...RowType[]]).optional(), from: z.string().max(200).optional(), to: z.string().max(300).optional(), state: z.enum(ROW_STATES as [RowState, ...RowState[]]).optional(), note: z.string().max(300).optional(), remove: z.boolean().optional() })).max(300).optional(),
});

creator.get("/creator", (c) => c.json({ drafts: listCreatorDrafts() }));

creator.post("/creator", async (c) => {
  const input = await body(
    c,
    z.object({
      kind: z.enum(["character", "persona"]),
      idea: z.string().max(100_000).optional(),
      name: z.string().max(120).optional(),
      baseId: z.string().nullable().optional(),
      fromLore: z.object({ draftId: z.string(), itemId: z.string() }).nullable().optional(),
      fromDraftId: z.string().nullable().optional(),
      asCopy: z.boolean().optional(),
      asVersion: z.object({ kind: versionKind.nullable().optional(), label: z.string().max(80).optional() }).nullable().optional(),
      fromEntry: z.object({ bookId: z.string(), entryId: z.string() }).nullable().optional(),
      oppositeOf: z.object({ draftId: z.string().nullable().optional(), characterId: z.string().nullable().optional() }).nullable().optional(),
      worldBookIds: z.array(z.string()).max(20).optional(),
      loreDraftId: z.string().nullable().optional(),
      options: optionsSchema.partial().optional(),
    }),
  );
  return c.json(d(createCreatorDraft(input)), 201);
});

/** "Extend my answer" (CHAR-10), for any answer box in any studio. */
creator.post("/creator/extend", async (c) => {
  const input = await body(c, z.object({ text: z.string().min(1).max(8000), question: z.string().max(1000).optional(), idea: z.string().max(20_000).optional() }));
  return c.json({ text: await extendText(input.text, input) });
});

creator.get("/creator/:id", (c) => c.json(d(mustCreator(c.req.param("id")))));

creator.put("/creator/:id", async (c) => {
  const input = await body(
    c,
    z.object({
      name: z.string().max(120).optional(),
      stage: z.enum(["idea", "questions", "map", "bible", "write", "done"]).optional(),
      idea: z.string().max(100_000).optional(),
      options: optionsSchema.partial().optional(),
      answers: z.record(z.string(), z.string().max(8000)).optional(),
      worldBookIds: z.array(z.string()).max(20).optional(),
      loreDraftId: z.string().nullable().optional(),
      expansion: expansionPatch.optional(),
      bible: z.record(z.string(), z.string().max(20_000)).optional(),
      fields: z.record(z.string(), z.string().max(40_000)).optional(),
      basedOn: z.string().max(200).optional(),
      dismissKindHint: z.boolean().optional(),
      dismissModeHint: z.boolean().optional(),
      answerSources: z.record(z.string(), source).optional(),
      accepted: z.record(z.string(), z.boolean()).optional(),
      facts: z.array(z.object({ id: z.string().optional(), section: z.string().max(40).optional(), text: z.string().max(4000).optional(), remove: z.boolean().optional() })).max(100).optional(),
      claims: z.array(z.string().max(40)).max(40).optional(),
      optional: z.array(z.string().max(40)).max(10).optional(),
      taste: z.array(z.string().max(200)).max(24).optional(),
      brief: z.string().max(4000).optional(),
      depth: z.array(z.object({ id: z.string().optional(), title: z.string().max(200).optional(), content: z.string().max(4000).optional(), keys: z.array(z.string().max(80)).max(12).optional(), remove: z.boolean().optional() })).max(60).optional(),
      variant: variantPatch.optional(),
    }),
  );
  return c.json(d(patchCreator(c.req.param("id"), input)));
});

/** How to rebuild an imported card: what it carries, and whether it reads as one character or a narrator. */
creator.get("/creator/treatment/:characterId", async (c) => c.json(await suggestTreatment(c.req.param("characterId"))));

creator.delete("/creator/:id", (c) => {
  deleteCreatorDraft(c.req.param("id"));
  return c.json({ ok: true });
});

/** The draft becomes the other kind (a persona, or a character card) in place. */
creator.post("/creator/:id/kind", async (c) => {
  const input = await body(c, z.object({ kind: z.enum(["character", "persona"]) }));
  return c.json(d(switchCreatorKind(c.req.param("id"), input.kind)));
});

creator.post("/creator/:id/expand", async (c) => c.json(d(await expandCreator(c.req.param("id"), (await opts(c, steer)).steer))));
creator.post("/creator/:id/expand/:sectionId", async (c) => c.json(d(await deepenCreator(c.req.param("id"), c.req.param("sectionId"), (await opts(c, steer)).steer))));
creator.post("/creator/:id/readback", async (c) => c.json(d(await creatorReadback(c.req.param("id")))));
/** The interview: the next question (asking again skips the open one), answering it, directions, finishing, starting over. */
creator.post("/creator/:id/question", async (c) => c.json(d(await nextQuestion(c.req.param("id"), await opts(c, steer)))));
creator.post("/creator/:id/questions/:qid/answer", async (c) => {
  const input = await body(c, z.object({ answer: z.string().min(1).max(8000), source: source.optional(), next: z.boolean().optional() }));
  return c.json(d(await answerQuestion(c.req.param("id"), c.req.param("qid"), input)));
});
creator.post("/creator/:id/questions/:qid/directions", async (c) => c.json(d(await questionDirections(c.req.param("id"), c.req.param("qid"), (await opts(c, steer)).steer))));
creator.post("/creator/:id/interview/finish", (c) => c.json(d(finishInterview(c.req.param("id")))));
creator.post("/creator/:id/interview/reset", (c) => c.json(d(resetInterview(c.req.param("id")))));
creator.post("/creator/:id/weave", async (c) => c.json(d(await weaveCreator(c.req.param("id")))));
/** Depth entries: deepening answers composed (and, with fromBible, more drafted from the bible). */
creator.post("/creator/:id/depth", async (c) => c.json(d(await composeDepth(c.req.param("id"), await opts(c, z.object({ fromBible: z.boolean().optional() }).default({}))))));
/** A persona's opening written opposite its character, and adding it to that character. */
creator.post("/creator/:id/pairing", async (c) => c.json(d(await pairedGreeting(c.req.param("id"), (await body(c, z.object({ register: z.string().max(40) }))).register))));
creator.post("/creator/:id/pairing/apply", async (c) => c.json(d(applyPairing(c.req.param("id"), (await opts(c, z.object({ text: z.string().max(8000).optional() }).default({}))).text))));
creator.post("/creator/:id/bible", async (c) => {
  const id = c.req.param("id");
  const s = (await opts(c, steer)).steer;
  return c.json(d(mustCreator(id).variant ? await writeVariantBible(id, s) : await writeBible(id, s)));
});

/** The variant studio (docs/14): premise takes, what stays true and the questions, the map, a persona's version. */
creator.post("/creator/:id/variant/directions", async (c) => c.json(d(await premiseDirections(c.req.param("id"), (await opts(c, steer)).steer))));
creator.post("/creator/:id/variant/start", async (c) => c.json(d(await startVariant(c.req.param("id"), await opts(c, z.object({ anchorsOnly: z.boolean().optional() }).default({}))))));
creator.post("/creator/:id/variant/question", async (c) => c.json(d(await anotherVariantQuestion(c.req.param("id"), (await opts(c, steer)).steer))));
creator.post("/creator/:id/variant/map", async (c) => c.json(d(await buildMap(c.req.param("id")))));
creator.post("/creator/:id/variant/map/fill", async (c) => c.json(d(await fillMap(c.req.param("id"), await opts(c, z.object({ all: z.boolean().optional() }).default({}))))));
creator.post("/creator/:id/variant/persona", async (c) => {
  const input = await opts(c, z.object({ personaId: z.string().nullable().optional() }).default({}));
  return c.json(d(personaVersion(c.req.param("id"), input.personaId)), 201);
});
creator.post("/creator/:id/bible/check", async (c) => c.json(d(await checkBible(c.req.param("id")))));
creator.post("/creator/:id/bible/:key", async (c) => c.json(d(await rewriteBibleSection(c.req.param("id"), c.req.param("key"), (await opts(c, steer)).steer))));

creator.post("/creator/:id/write", async (c) => {
  const input = await opts(c, z.object({ keys: z.array(z.string()).optional(), steer: z.string().max(1000).optional(), all: z.boolean().optional(), force: z.boolean().optional() }).default({}));
  return c.json(d(queueFields(c.req.param("id"), input)));
});
creator.post("/creator/:id/stop", (c) => c.json(d(stopFields(c.req.param("id")))));
creator.post("/creator/:id/fields/:key/restore", (c) => c.json(d(restoreField(c.req.param("id"), c.req.param("key")))));
creator.get("/creator/:id/review", (c) => c.json(reviewCreator(c.req.param("id"))));

/** Canon from the web: the work's wiki, Wikipedia and your links, distilled into a brief. */
creator.post("/creator/:id/research", async (c) => {
  const input = await opts(c, z.object({ urls: z.array(z.string().max(2000)).max(8).optional() }).default({}));
  return c.json(d(await researchCreator(c.req.param("id"), input)));
});

/** The editor's pass over the written card, and applying one of its notes. */
creator.post("/creator/:id/critique", async (c) => c.json(d(await critiqueFields(c.req.param("id")))));
creator.post("/creator/:id/critique/:issueId", (c) => c.json(d(applyFieldCheck(c.req.param("id"), c.req.param("issueId")))));

/** The co-writer: ask in plain words, get changes to accept or reject. */
creator.post("/creator/:id/cowrite", async (c) => {
  const input = await body(c, z.object({ message: z.string().trim().min(1).max(4000) }));
  return c.json(d(await cowriteCreator(c.req.param("id"), input.message)));
});
creator.post("/creator/:id/cowrite/apply", async (c) => {
  const input = await body(c, z.object({ accept: z.array(z.string()).max(40) }));
  return c.json(d(applyCreatorCowrite(c.req.param("id"), input.accept)));
});
creator.post("/creator/:id/cowrite/dismiss", (c) => c.json(d(dismissCreatorCowrite(c.req.param("id")))));
creator.delete("/creator/:id/cowrite", (c) => c.json(d(clearCreatorChat(c.req.param("id")))));

creator.post("/creator/:id/save", async (c) => {
  const input = await opts(c, z.object({ makeDefault: z.boolean().optional() }).default({}));
  const saved = saveCreator(c.req.param("id"), input);
  // A narrator's named people go into its people book's roster (best effort: the save already stands).
  let peopleBookId: string | null = null;
  if (saved.draft.kind === "character" && saved.draft.options.mode === "narrator") peopleBookId = await harvestFromCreator(saved.draft.id).catch(() => null);
  return c.json({ ...saved, draft: d(saved.draft).draft, peopleBookId });
});

/** A companion lorebook drafted from the bible (CHAR-18 / PER-03): returns the Lore Studio draft. */
creator.post("/creator/:id/companion", (c) => {
  // A saved version gets its own lorebook, translated from its original's through the map (docs/14).
  const cur = mustCreator(c.req.param("id"));
  if (cur.variant && cur.savedId) {
    const lore = createVersionLore(cur.kind, cur.savedId);
    return c.json({ loreDraftId: lore.id, draft: cur });
  }
  const lore = companionLore(c.req.param("id"));
  return c.json({ loreDraftId: lore.id, draft: mustCreator(c.req.param("id")) });
});
