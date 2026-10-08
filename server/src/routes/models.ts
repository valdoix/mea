import { Hono } from "hono";
import { z } from "zod";
import { body, must } from "../lib/http";
import { getSetting, setSetting } from "../lib/settings";
import {
  cachedQuota,
  connectionInput,
  createConnection,
  createProfile,
  deleteConnection,
  deleteProfile,
  getProfile,
  listConnections,
  listModels,
  listProfiles,
  profileInput,
  refreshQuota,
  starModel,
  syncModels,
  updateConnection,
  updateProfile,
} from "../services/connections";
import { usageSummary } from "../services/usage";
import { config } from "../config";

export const models = new Hono();

models.get("/connections", (c) => c.json({ connections: listConnections(), devMode: config.dev }));

models.post("/connections", async (c) => {
  const input = await body(c, connectionInput);
  const id = createConnection(input);
  let syncError: string | null = null;
  try {
    await syncModels(id);
  } catch (e) {
    syncError = (e as Error).message;
  }
  return c.json({ connection: listConnections().find((x) => x.id === id), syncError }, 201);
});

models.put("/connections/:id", async (c) => {
  const input = await body(c, connectionInput.partial());
  must(updateConnection(c.req.param("id"), input) || undefined, "Connection not found");
  return c.json({ connection: listConnections().find((x) => x.id === c.req.param("id")) });
});

models.delete("/connections/:id", (c) => {
  deleteConnection(c.req.param("id"));
  return c.json({ ok: true });
});

models.post("/connections/:id/sync", async (c) => c.json({ count: await syncModels(c.req.param("id")) }));

models.get("/models", (c) => c.json({ models: listModels(c.req.query("connectionId") || undefined) }));

models.post("/models/star", async (c) => {
  const input = await body(c, z.object({ connectionId: z.string(), modelId: z.string(), starred: z.boolean() }));
  starModel(input.connectionId, input.modelId, input.starred);
  return c.json({ ok: true });
});

models.get("/profiles", (c) => c.json({ profiles: listProfiles(), storyProfileId: getSetting("routing.story") }));

models.post("/profiles", async (c) => {
  const input = await body(c, profileInput);
  return c.json(getProfile(createProfile(input)), 201);
});

models.put("/profiles/:id", async (c) => {
  const input = await body(c, profileInput.partial());
  must(updateProfile(c.req.param("id"), input) || undefined, "Profile not found");
  return c.json(getProfile(c.req.param("id")));
});

models.delete("/profiles/:id", (c) => {
  deleteProfile(c.req.param("id"));
  return c.json({ ok: true });
});

models.put("/routing", async (c) => {
  const input = await body(c, z.object({ story: z.string().nullable() }));
  setSetting("routing.story", input.story);
  return c.json({ story: input.story });
});

models.get("/quota", (c) => c.json({ quota: cachedQuota() }));

models.post("/quota/refresh", async (c) => c.json({ quota: await refreshQuota() }));

models.get("/usage", (c) => c.json(usageSummary(Math.min(90, Number(c.req.query("days")) || 7))));
