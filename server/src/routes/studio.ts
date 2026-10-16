import { type Context, Hono } from "hono";
import { stash } from "../services/undo";
import { z } from "zod";
import { body } from "../lib/http";
import { parseDocument } from "../lore/ingest";
import { commitVersionLore, createVersionLore } from "../lore/versionlore";
import { CATEGORIES } from "../lore/format";
import {
  addItem,
  planDiff,
  planExisting,
  applyCowrite,
  applyCritique,
  clearCowriteChat,
  commitDraft,
  cowriteLore,
  critiqueDraft,
  dismissCowrite,
  researchLore,
  takeCensus,
  consistencyCheck,
  createDraft,
  deepenLore,
  deleteDraft,
  directions,
  ENTRY_TYPES,
  expandLore,
  listDrafts,
  missingNames,
  mustDraft,
  patchDraft,
  patchItem,
  planOutline,
  queueWrite,
  readBack,
  removeItem,
  reorderItems,
  restorePrevious,
  reviewDraft,
  stopWrite,
} from "../lore/studio";

/** The Lore Studio (Phase 4): plan, write and review a lorebook with the model, then save it. */
export const studio = new Hono();

const types = z.enum(ENTRY_TYPES as [string, ...string[]]);
const optionsSchema = z.object({
  size: z.enum(["small", "medium", "large", "complete"]),
  length: z.enum(["lean", "standard", "rich"]),
  types: z.array(types),
  tone: z.string().max(300),
  style: z.string().max(600),
  secrets: z.boolean(),
  faithful: z.boolean(),
  overview: z.boolean(),
});
const linkSchema = z.object({ type: z.enum(["global", "character", "persona", "chat"]), id: z.string().default("") });
const entrySchema = z.object({
  content: z.string().max(20_000),
  keys: z.array(z.string().max(100)).max(40),
  aliases: z.array(z.string().max(100)).max(20),
  essentials: z.string().max(1000),
  secrets: z.array(z.object({ text: z.string().max(1000), knownBy: z.array(z.string().max(100)).max(20) })).max(10),
});
const itemSchema = z.object({
  title: z.string().max(200),
  type: types.nullable(),
  pitch: z.string().max(2000),
  parent: z.string().max(100),
  folder: z.string().max(300),
  source: z.string().max(50_000),
  constant: z.boolean(),
  keep: z.boolean(),
  steer: z.string().max(1000),
  entry: entrySchema.nullable(),
  // I1/I2: the lore category.
  category: z.enum(CATEGORIES).nullable(),
});

/** Actions whose options are all optional also accept an empty body. */
async function opts<T extends z.ZodType>(c: Context, schema: T): Promise<z.infer<T>> {
  return (await c.req.text()).trim() ? body(c, schema) : schema.parse({});
}

const d = (draft: ReturnType<typeof mustDraft>) => ({ draft });

studio.get("/lore-studio", (c) => c.json({ drafts: listDrafts() }));

studio.post("/lore-studio", async (c) => {
  const input = await body(
    c,
    z.object({
      kind: z.enum(["idea", "character", "persona", "document", "book"]),
      text: z.string().max(2_000_000).optional(),
      refId: z.string().nullable().optional(),
      fileName: z.string().max(300).optional(),
      title: z.string().max(200).optional(),
      options: optionsSchema.partial().optional(),
    }),
  );
  return c.json(d(createDraft({ ...input, options: input.options as never })), 201);
});

/** Shows how a document would split, before a draft is made (LORE-16). */
studio.post("/lore-studio/parse", async (c) => {
  const input = await body(c, z.object({ text: z.string().max(2_000_000), fileName: z.string().max(300).optional() }));
  const doc = parseDocument(input.text, input.fileName);
  return c.json({ title: doc.title, shape: doc.shape, overview: doc.overview.slice(0, 600), sections: doc.sections.map((s) => ({ title: s.title, type: s.type, folder: s.folder, words: s.source.split(/\s+/).filter(Boolean).length })) });
});

studio.get("/lore-studio/:id", (c) => c.json(d(mustDraft(c.req.param("id")))));

studio.put("/lore-studio/:id", async (c) => {
  const input = await body(
    c,
    z.object({
      title: z.string().max(200).optional(),
      stage: z.enum(["start", "questions", "plan", "review", "done"]).optional(),
      text: z.string().max(2_000_000).optional(),
      options: optionsSchema.partial().optional(),
      answers: z.record(z.string(), z.string().max(4000)).optional(),
      overview: z.string().max(20_000).optional(),
      targetBookId: z.string().nullable().optional(),
      links: z.array(linkSchema).optional(),
      basedOn: z.string().max(200).optional(),
      expansion: z
        .object({
          sections: z.array(z.object({ id: z.string().max(100), heading: z.string().max(200).optional(), text: z.string().max(20_000).optional() })).max(40).optional(),
          use: z.boolean().optional(),
          remove: z.array(z.string()).optional(),
        })
        .optional(),
    }),
  );
  return c.json(d(patchDraft(c.req.param("id"), input as never)));
});

studio.delete("/lore-studio/:id", (c) => {
  const undo = stash("Draft", [{ table: "lore_drafts", where: "id = ?", params: [c.req.param("id")] }]);
  deleteDraft(c.req.param("id"));
  return c.json({ ok: true, undo });
});

studio.post("/lore-studio/:id/readback", async (c) => {
  const input = await opts(c, z.object({ count: z.number().int().min(1).max(6).optional() }).default({}));
  return c.json(d(await readBack(c.req.param("id"), input)));
});

/** "Expand my idea": the whole concept (or a rework with a steer), and one section deeper. */
studio.post("/lore-studio/:id/expand", async (c) => {
  const input = await opts(c, z.object({ steer: z.string().max(1000).optional() }).default({}));
  return c.json(d(await expandLore(c.req.param("id"), input.steer)));
});
studio.post("/lore-studio/:id/expand/:sectionId", async (c) => {
  const input = await opts(c, z.object({ steer: z.string().max(1000).optional() }).default({}));
  return c.json(d(await deepenLore(c.req.param("id"), c.req.param("sectionId"), input.steer)));
});

studio.post("/lore-studio/:id/directions", async (c) => {
  const input = await opts(c, z.object({ steer: z.string().max(300).optional() }).default({}));
  return c.json(d(await directions(c.req.param("id"), input.steer)));
});

studio.post("/lore-studio/:id/outline", async (c) => {
  const input = await opts(c, z.object({ mode: z.enum(["replace", "more"]).optional(), steer: z.string().max(1000).optional(), count: z.number().int().min(1).max(40).optional(), names: z.array(z.string().max(200)).max(200).optional() }).default({}));
  return c.json(d(await planOutline(c.req.param("id"), input)));
});

/** Canon from the web: the work's wiki, Wikipedia and your links, distilled into a brief. */
studio.post("/lore-studio/:id/research", async (c) => {
  const input = await opts(c, z.object({ urls: z.array(z.string().max(2000)).max(8).optional() }).default({}));
  return c.json(d(await researchLore(c.req.param("id"), input)));
});

/** The census: everyone and everything the world has, from the material and canon (re-taken on a fresh plan). */
studio.post("/lore-studio/:id/census", async (c) => c.json(d(await takeCensus(c.req.param("id")))));

studio.get("/lore-studio/:id/gaps", (c) => {
  const draft = mustDraft(c.req.param("id"));
  return c.json({ names: draft.source.kind === "book" && draft.source.refId ? missingNames(draft.source.refId) : [] });
});

/** I2: an entry already in the book joins the plan, to change or switch off. */
studio.post("/lore-studio/:id/existing", async (c) => {
  const b = await body(c, z.object({ entryId: z.string(), action: z.enum(["change", "off"]), pitch: z.string().max(600).optional() }));
  return c.json({ draft: planExisting(c.req.param("id"), b.entryId, b.action, b.pitch) });
});

/** I2: the plan's numbered versions and what changed in one (the latest by default). */
studio.get("/lore-studio/:id/versions", (c) => {
  const d = mustDraft(c.req.param("id"));
  const n = c.req.query("n") ? Number(c.req.query("n")) : undefined;
  return c.json({ versions: d.planVersions.map((v) => ({ n: v.n, at: v.at, why: v.why, count: v.items.filter((i) => i.keep).length })), diff: planDiff(d, n) });
});

studio.post("/lore-studio/:id/items", async (c) => {
  const input = await body(c, itemSchema.partial());
  const r = addItem(c.req.param("id"), input as never);
  return c.json({ draft: r.draft, itemId: r.item.id }, 201);
});

studio.put("/lore-studio/:id/items/:itemId", async (c) => {
  const input = await body(c, itemSchema.partial());
  return c.json(d(patchItem(c.req.param("id"), c.req.param("itemId"), input as never)));
});

studio.delete("/lore-studio/:id/items/:itemId", (c) => c.json(d(removeItem(c.req.param("id"), c.req.param("itemId")))));

studio.post("/lore-studio/:id/items/:itemId/restore", (c) => c.json(d(restorePrevious(c.req.param("id"), c.req.param("itemId")))));

studio.post("/lore-studio/:id/order", async (c) => {
  const { ids } = await body(c, z.object({ ids: z.array(z.string()) }));
  return c.json(d(reorderItems(c.req.param("id"), ids)));
});

studio.post("/lore-studio/:id/write", async (c) => {
  const input = await opts(c, z.object({ itemIds: z.array(z.string()).optional(), steer: z.string().max(1000).optional(), all: z.boolean().optional() }).default({}));
  return c.json(d(queueWrite(c.req.param("id"), input)));
});

studio.post("/lore-studio/:id/stop", (c) => c.json(d(stopWrite(c.req.param("id")))));

studio.get("/lore-studio/:id/review", (c) => c.json(reviewDraft(c.req.param("id"))));

studio.post("/lore-studio/:id/consistency", async (c) => c.json(d(await consistencyCheck(c.req.param("id")))));

/** The editor's pass over every entry, and applying one of its fixes. */
studio.post("/lore-studio/:id/critique", async (c) => c.json(d(await critiqueDraft(c.req.param("id")))));
studio.post("/lore-studio/:id/critique/:issueId", (c) => c.json(d(applyCritique(c.req.param("id"), c.req.param("issueId")))));

/** The co-writer: ask in plain words, get changes to accept or reject. */
studio.post("/lore-studio/:id/cowrite", async (c) => {
  const input = await body(c, z.object({ message: z.string().trim().min(1).max(4000) }));
  return c.json(d(await cowriteLore(c.req.param("id"), input.message)));
});
studio.post("/lore-studio/:id/cowrite/apply", async (c) => {
  const input = await body(c, z.object({ accept: z.array(z.string()).max(40) }));
  return c.json(d(applyCowrite(c.req.param("id"), input.accept)));
});
studio.post("/lore-studio/:id/cowrite/dismiss", (c) => c.json(d(dismissCowrite(c.req.param("id")))));
studio.delete("/lore-studio/:id/cowrite", (c) => c.json(d(clearCowriteChat(c.req.param("id")))));

/** A version's own lorebook (docs/14): the plan comes from its map; kept entries are already in it. */
studio.post("/lore-studio/version", async (c) => {
  const input = await body(c, z.object({ kind: z.enum(["character", "persona"]), id: z.string().min(1) }));
  return c.json(d(createVersionLore(input.kind, input.id)), 201);
});

studio.post("/lore-studio/:id/commit", async (c) => {
  // A version's lore saves into its own two books, whatever the request names.
  if (mustDraft(c.req.param("id")).version) {
    const r = commitVersionLore(c.req.param("id"));
    return c.json({ bookId: r.bookIds[0] ?? null, bookIds: r.bookIds, added: r.added, unlinked: r.unlinked, draft: r.draft });
  }
  const input = await opts(
    c,
    z
      .object({ bookId: z.string().nullable().optional(), name: z.string().max(200).optional(), description: z.string().max(2000).optional(), links: z.array(linkSchema).optional(), overview: z.boolean().optional(), itemIds: z.array(z.string()).optional() })
      .default({}),
  );
  const r = commitDraft(c.req.param("id"), input);
  return c.json({ ...r, draft: mustDraft(c.req.param("id")) });
});
