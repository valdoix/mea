import { Hono } from "hono";
import { stash } from "../services/undo";
import { z } from "zod";
import { one } from "../db/db";
import { badRequest, body, HttpError, must } from "../lib/http";
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
import { assistEntry, ENTRY_TEMPLATES, glossary, previewLore, templateContent } from "../lore/assist";
import { acceptChronicle, chronicleProposals, rejectChronicle, runChronicle } from "../lore/chronicle";
import { loreHealth } from "../lore/health";
import { embedLore } from "../lore/semantic";
import { embeddingsEnabled } from "../memory/embed";
import { enqueue } from "../services/jobs";
import { getSetting } from "../lib/settings";
import { countTokens } from "../lib/tokens";

export const lore = new Hono();

const settingsSchema = z.object({
  scanDepth: z.number().int().min(0).max(1000).optional(),
  tokenBudget: z.number().int().min(0).optional(),
  recursive: z.boolean().optional(),
  caseSensitive: z.boolean().optional(),
  matchWholeWords: z.boolean().optional(),
  semantic: z.boolean().optional(),
  chronicleFor: z.string().optional(),
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
  const undo = stash("Link", [{ table: "lorebook_links", where: "lorebook_id = ? AND target_type = ? AND target_id = ?", params: [c.req.param("id"), l.type, l.type === "global" ? "" : (l.id ?? "")] }], "lorebooks");
  unlinkLorebook(c.req.param("id"), l.type as LinkType, l.id);
  return c.json({ ...getLorebook(c.req.param("id")), undo });
});

/** LORE-05: entries that fire on meaning need fresh vectors after an edit. */
const reembed = () => {
  if (embeddingsEnabled()) enqueue("lore.embed", {}, { dedupeKey: "lore.embed", delayMs: 4000 });
};

lore.post("/lorebooks/:id/entries", async (c) => {
  const partial = await body(c, entrySchema.partial());
  const e = createEntry(c.req.param("id"), defaultEntry(partial));
  reembed();
  return c.json(e, 201);
});

lore.put("/lorebooks/:id/entries/:entryId", async (c) => {
  const entry = await body(c, entrySchema);
  must(updateEntry(c.req.param("entryId"), entry) || undefined, "Entry not found");
  reembed();
  return c.json({ ...entry, id: c.req.param("entryId") });
});

// ---------- Phase 3: health, assist, templates, preview, glossary, Chronicle ----------

lore.get("/lorebooks/:id/health", (c) => c.json(must(loreHealth(c.req.param("id")) ?? undefined, "Lorebook not found")));

lore.get("/lore/templates", (c) => c.json({ templates: ENTRY_TEMPLATES }));
lore.get("/lore/templates/:type", (c) => {
  const type = c.req.param("type") as keyof typeof ENTRY_TEMPLATES;
  if (!ENTRY_TEMPLATES[type]) return c.json({ error: "Unknown type" }, 400);
  return c.json({ content: templateContent(type, c.req.query("name") ?? "") });
});

lore.post("/lore/assist", async (c) => {
  const input = await body(
    c,
    z.object({
      action: z.enum(["draft", "keys", "condense", "rewrite"]),
      idea: z.string().max(2000).optional(),
      comment: z.string().max(300).optional(),
      content: z.string().max(20_000).optional(),
      keys: z.array(z.string()).max(40).optional(),
      type: z.enum(["character", "location", "item", "faction", "concept", "event", "rule"]).optional(),
      style: z.string().max(500).optional(),
      chatId: z.string().nullable().optional(),
    }),
  );
  return c.json(await assistEntry(input.action, input));
});

lore.post("/chats/:id/lore/preview", async (c) => {
  const input = await body(c, z.object({ draft: z.string().max(20_000) }));
  return c.json({ entries: previewLore(c.req.param("id"), input.draft) });
});

lore.get("/chats/:id/glossary", (c) => c.json({ terms: glossary(c.req.param("id")) }));

lore.get("/chats/:id/chronicle", (c) => c.json({ proposals: chronicleProposals(c.req.param("id"), c.req.query("status") || "open") }));
lore.post("/chats/:id/chronicle/run", async (c) => c.json({ proposals: await runChronicle(c.req.param("id"), undefined, { max: 5 }) }));
lore.post("/chronicle/:id/accept", async (c) => {
  const input = await body(c, z.object({ comment: z.string().optional(), keys: z.array(z.string()).optional(), content: z.string().optional() }).default({}));
  const r = acceptChronicle(c.req.param("id"), input);
  reembed();
  return c.json(r);
});
lore.post("/chronicle/:id/reject", (c) => {
  rejectChronicle(c.req.param("id"));
  return c.json({ ok: true });
});
lore.post("/lore/embed", async (c) => c.json(await embedLore()));

/** Which book an entry lives in (for citations that point at a lore entry). */
lore.get("/lore/entries/:id/locate", (c) => {
  const r = one<{ lorebook_id: string }>("SELECT lorebook_id FROM lorebook_entries WHERE id = ?", c.req.param("id"));
  return r ? c.json({ bookId: r.lorebook_id }) : c.json({ error: "Entry not found" }, 404);
});

lore.delete("/lorebooks/:id/entries/:entryId", (c) => {
  const undo = stash("Entry", [{ table: "lorebook_entries", where: "id = ?", params: [c.req.param("entryId")] }], "lorebooks");
  deleteEntry(c.req.param("entryId"));
  return c.json({ ok: true, undo });
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
  // L2: a file that isn't JSON (or isn't a lorebook) is a 400, not a 500.
  let json: unknown;
  try {
    json = JSON.parse(await file.text());
  } catch {
    throw badRequest("That file isn't JSON");
  }
  if (!json || typeof json !== "object") throw badRequest("That file isn't a lorebook");
  let id: string;
  try {
    id = importLorebookJson(json as Parameters<typeof importLorebookJson>[0], file.name.replace(/\.json$/i, ""));
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw badRequest(`That file isn't a lorebook: ${(e as Error).message}`);
  }
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
