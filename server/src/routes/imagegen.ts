import { Hono } from "hono";
import { z } from "zod";
import { body, must } from "../lib/http";
import { getSetting } from "../lib/settings";
import { batchView, generateInput, imageConnection, imageModels, keepImage, recentBatches, startImageBatch, syncImageModels } from "../services/imagegen";

/** docs/28: pictures. Under /imagegen, since /images/:id serves the stored files. */
export const imagegen = new Hono();

imagegen.get("/imagegen/models", (c) => {
  const id = c.req.query("connectionId") || getSetting("images.config").connectionId;
  if (!id) return c.json({ connectionId: null, models: [], syncedAt: null });
  const tools = c.req.query("tools") === "1";
  return c.json({ connectionId: id, ...imageModels(id, { tools }) });
});

imagegen.post("/imagegen/models/sync", async (c) => {
  const { connectionId } = await body(c, z.object({ connectionId: z.string().nullish() }));
  const count = await syncImageModels(connectionId);
  return c.json({ count });
});

imagegen.post("/imagegen/generate", async (c) => {
  const input = await body(c, generateInput);
  imageConnection(input.connectionId);
  return c.json(startImageBatch(input));
});

imagegen.get("/imagegen/batches", (c) => c.json({ batches: recentBatches({ kind: c.req.query("kind") || undefined, limit: Number(c.req.query("limit")) || undefined }) }));

imagegen.get("/imagegen/batches/:id", (c) => c.json(must(batchView(c.req.param("id")), "No such request for pictures")));

imagegen.post("/imagegen/images/:id/keep", async (c) => {
  const { kept } = await body(c, z.object({ kept: z.boolean().default(true) }));
  keepImage(c.req.param("id"), kept);
  return c.json({ ok: true });
});
