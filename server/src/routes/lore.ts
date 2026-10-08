import { Hono } from "hono";
import { z } from "zod";
import { body, must } from "../lib/http";
import {
  createEntry,
  createLorebook,
  deleteEntry,
  exportLorebook,
  getLorebook,
  importLorebookJson,
  type LinkType,
  linkLorebook,
  listLorebooks,
  reorderEntries,
  restoreLorebook,
  softDeleteLorebook,
  unlinkLorebook,
  updateEntry,
  updateLorebook,
} from "../lore/service";
import { defaultEntry } from "../lore/types";
import { activateLore } from "../lore/activate";
import { getSetting } from "../lib/settings";
import { countTokens } from "../lib/tokens";

export const lore = new Hono();

const settingsSchema = z.object({
  scanDepth: z.number().int().min(0).max(1000).optional(),
  tokenBudget: z.number().int().min(0).optional(),
  recursive: z.boolean().optional(),
  caseSensitive: z.boolean().optional(),
  matchWholeWords: z.boolean().optional(),
});

const entrySchema = z.object({
  uid: z.number().int(),
  comment: z.string(),
  keys: z.array(z.string()),
  secondaryKeys: z.array(z.string()),
  logic: z.enum(["and_any", "not_all", "not_any", "and_all"]),
  content: z.string(),
  enabled: z.boolean(),
  constant: z.boolean(),
  order: z.number(),
  position: z.enum(["before_char", "after_char", "an_top", "an_bottom", "depth", "ex_top", "ex_bottom"]),
  depth: z.number().int().min(0),
  role: z.enum(["system", "user", "assistant"]),
  probability: z.number().min(0).max(100),
  useProbability: z.boolean(),
  scanDepth: z.number().int().min(0).nullable(),
  caseSensitive: z.boolean().nullable(),
  matchWholeWords: z.boolean().nullable(),
  excludeRecursion: z.boolean(),
  preventRecursion: z.boolean(),
  delayUntilRecursion: z.boolean(),
  group: z.string(),
  groupOverride: z.boolean(),
  groupWeight: z.number(),
  useGroupScoring: z.boolean().nullable(),
  sticky: z.number().int().min(0),
  cooldown: z.number().int().min(0),
  delay: z.number().int().min(0),
  extra: z.record(z.string(), z.unknown()),
});

const linkSchema = z.object({ type: z.enum(["global", "character", "persona", "chat"]), id: z.string().default("") });

lore.get("/lorebooks", (c) => c.json({ lorebooks: listLorebooks({ deleted: c.req.query("deleted") === "1" }) }));

lore.post("/lorebooks", async (c) => {
  const input = await body(c, z.object({ name: z.string().trim().min(1), description: z.string().optional(), settings: settingsSchema.optional(), links: z.array(linkSchema).optional() }));
  const id = createLorebook({ ...input, links: input.links?.map((l) => ({ target_type: l.type, target_id: l.id })) });
  return c.json(getLorebook(id), 201);
});

lore.get("/lorebooks/:id", (c) => c.json(must(getLorebook(c.req.param("id")), "Lorebook not found")));

lore.put("/lorebooks/:id", async (c) => {
  const input = await body(c, z.object({ name: z.string().trim().min(1).optional(), description: z.string().optional(), settings: settingsSchema.optional() }));
  must(updateLorebook(c.req.param("id"), input) || undefined, "Lorebook not found");
  return c.json(getLorebook(c.req.param("id")));
});

lore.delete("/lorebooks/:id", (c) => {
  softDeleteLorebook(c.req.param("id"));
  return c.json({ ok: true });
});

lore.post("/lorebooks/:id/restore", (c) => {
  restoreLorebook(c.req.param("id"));
  return c.json(getLorebook(c.req.param("id")));
});

lore.post("/lorebooks/:id/links", async (c) => {
  const l = await body(c, linkSchema);
  linkLorebook(c.req.param("id"), l.type as LinkType, l.id);
  return c.json(getLorebook(c.req.param("id")));
});

lore.delete("/lorebooks/:id/links", async (c) => {
  const l = await body(c, linkSchema);
  unlinkLorebook(c.req.param("id"), l.type as LinkType, l.id);
  return c.json(getLorebook(c.req.param("id")));
});

lore.post("/lorebooks/:id/entries", async (c) => {
  const partial = await body(c, entrySchema.partial());
  return c.json(createEntry(c.req.param("id"), defaultEntry(partial)), 201);
});

lore.put("/lorebooks/:id/entries/:entryId", async (c) => {
  const entry = await body(c, entrySchema);
  must(updateEntry(c.req.param("entryId"), entry) || undefined, "Entry not found");
  return c.json({ ...entry, id: c.req.param("entryId") });
});

lore.delete("/lorebooks/:id/entries/:entryId", (c) => {
  deleteEntry(c.req.param("entryId"));
  return c.json({ ok: true });
});

lore.post("/lorebooks/:id/order", async (c) => {
  const { ids } = await body(c, z.object({ ids: z.array(z.string()) }));
  reorderEntries(c.req.param("id"), ids);
  return c.json({ ok: true });
});

lore.post("/lorebooks/import", async (c) => {
  const form = await c.req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return c.json({ error: "No file" }, 400);
  const id = importLorebookJson(JSON.parse(await file.text()), file.name.replace(/\.json$/i, ""));
  return c.json(getLorebook(id), 201);
});

/** Try out activation against sample text (LORE-04). */
lore.post("/lorebooks/:id/test", async (c) => {
  const input = await body(c, z.object({ text: z.string().max(50_000), char: z.string().optional(), user: z.string().optional() }));
  const book = must(getLorebook(c.req.param("id")), "Lorebook not found");
  const defaults = getSetting("lore.defaults");
  const result = activateLore({
    entries: book.entries.map((e) => ({ ...e, bookId: book.id, bookName: book.name, book: book.settings })),
    history: input.text.split(/\n{2,}/),
    messageCount: 1000,
    state: {},
    defaults: { ...defaults, scanDepth: Math.max(defaults.scanDepth, book.settings.scanDepth ?? 0, 1000) },
    countTokens,
    substitute: (s) => s.replace(/\{\{char\}\}/gi, input.char ?? "{{char}}").replace(/\{\{user\}\}/gi, input.user ?? "{{user}}"),
  });
  return c.json({ trace: result.trace, totalTokens: result.totalTokens });
});

lore.get("/lorebooks/:id/export", (c) => {
  const format = c.req.query("format") === "card" ? "card" : "st";
  const book = must(getLorebook(c.req.param("id")), "Lorebook not found");
  const out = exportLorebook(book.id, format);
  return new Response(JSON.stringify(out, null, 2), {
    headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`${book.name}.json`)}` },
  });
});
