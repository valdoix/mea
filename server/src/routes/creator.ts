import { type Context, Hono } from "hono";
import { z } from "zod";
import { body } from "../lib/http";
import {
  checkBible,
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
  reviewCreator,
  rewriteBibleSection,
  saveCreator,
  stopFields,
  writeBible,
} from "../creator/creator";
import { extendText } from "../creator/expand";

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
});
const expansionPatch = z.object({
  sections: z.array(z.object({ id: z.string().max(100), heading: z.string().max(200).optional(), text: z.string().max(20_000).optional() })).max(40).optional(),
  use: z.boolean().optional(),
  remove: z.array(z.string()).optional(),
});
const steer = z.object({ steer: z.string().max(1000).optional() }).default({});
const d = (draft: ReturnType<typeof mustCreator>) => ({ draft });

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
      stage: z.enum(["idea", "questions", "bible", "write", "done"]).optional(),
      idea: z.string().max(100_000).optional(),
      options: optionsSchema.partial().optional(),
      answers: z.record(z.string(), z.string().max(8000)).optional(),
      worldBookIds: z.array(z.string()).max(20).optional(),
      loreDraftId: z.string().nullable().optional(),
      expansion: expansionPatch.optional(),
      bible: z.record(z.string(), z.string().max(20_000)).optional(),
      fields: z.record(z.string(), z.string().max(40_000)).optional(),
    }),
  );
  return c.json(d(patchCreator(c.req.param("id"), input)));
});

creator.delete("/creator/:id", (c) => {
  deleteCreatorDraft(c.req.param("id"));
  return c.json({ ok: true });
});

creator.post("/creator/:id/expand", async (c) => c.json(d(await expandCreator(c.req.param("id"), (await opts(c, steer)).steer))));
creator.post("/creator/:id/expand/:sectionId", async (c) => c.json(d(await deepenCreator(c.req.param("id"), c.req.param("sectionId"), (await opts(c, steer)).steer))));
creator.post("/creator/:id/readback", async (c) => c.json(d(await creatorReadback(c.req.param("id")))));
creator.post("/creator/:id/bible", async (c) => c.json(d(await writeBible(c.req.param("id"), (await opts(c, steer)).steer))));
creator.post("/creator/:id/bible/check", async (c) => c.json(d(await checkBible(c.req.param("id")))));
creator.post("/creator/:id/bible/:key", async (c) => c.json(d(await rewriteBibleSection(c.req.param("id"), c.req.param("key"), (await opts(c, steer)).steer))));

creator.post("/creator/:id/write", async (c) => {
  const input = await opts(c, z.object({ keys: z.array(z.string()).optional(), steer: z.string().max(1000).optional(), all: z.boolean().optional() }).default({}));
  return c.json(d(queueFields(c.req.param("id"), input)));
});
creator.post("/creator/:id/stop", (c) => c.json(d(stopFields(c.req.param("id")))));
creator.post("/creator/:id/fields/:key/restore", (c) => c.json(d(restoreField(c.req.param("id"), c.req.param("key")))));
creator.get("/creator/:id/review", (c) => c.json(reviewCreator(c.req.param("id"))));

creator.post("/creator/:id/save", async (c) => {
  const input = await opts(c, z.object({ makeDefault: z.boolean().optional() }).default({}));
  return c.json(saveCreator(c.req.param("id"), input));
});

/** A companion lorebook drafted from the bible (CHAR-18 / PER-03): returns the Lore Studio draft. */
creator.post("/creator/:id/companion", (c) => {
  const lore = companionLore(c.req.param("id"));
  return c.json({ loreDraftId: lore.id, draft: mustCreator(c.req.param("id")) });
});
