import { Hono } from "hono";
import { stash } from "../services/undo";
import { one } from "../db/db";
import { z } from "zod";
import { body, must } from "../lib/http";
import { getSetting, setSetting } from "../lib/settings";
import {
  cachedBalance,
  cachedQuota,
  connectionInput,
  connectionUpdate,
  createConnection,
  createProfile,
  deleteConnection,
  deleteProfile,
  getProfile,
  listConnections,
  listModels,
  listProfiles,
  profileInput,
  refreshBalance,
  refreshQuota,
  starModel,
  syncModels,
  updateConnection,
  updateProfile,
  walletSecretId,
} from "../services/connections";
import { cacheStats, usageSummary } from "../services/usage";
import { config } from "../config";
import { cancelJob, enqueue, listJobs, retryJob } from "../services/jobs";
import { probeCache } from "../services/probe";
import { quotaPlannerJson } from "../services/quota";
import { getRequest, listRequests } from "../services/requests";
import { SPEED_TASKS, speedReport, speedTest } from "../services/speed";

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
  const input = await body(c, connectionUpdate);
  must(updateConnection(c.req.param("id"), input) || undefined, "Connection not found");
  return c.json({ connection: listConnections().find((x) => x.id === c.req.param("id")) });
});

models.delete("/connections/:id", (c) => {
  const id = c.req.param("id");
  const secret = one<{ secret_id: string | null }>("SELECT secret_id FROM connections WHERE id = ?", id)?.secret_id ?? "";
  const wallet = walletSecretId(id) ?? "";
  // The connection, its keys, its model list, and which profiles pointed at it.
  const undo = stash(
    "Connection",
    [
      { table: "secrets", where: "id = ?", params: [secret] },
      { table: "secrets", where: "id = ?", params: [wallet] },
      { table: "connections", where: "id = ?", params: [id] },
      { table: "models", where: "connection_id = ?", params: [id] },
      { table: "profiles", where: "connection_id = ?", params: [id] },
    ],
    "connections",
  );
  deleteConnection(id);
  return c.json({ ok: true, undo });
});

models.post("/connections/:id/sync", async (c) => c.json({ count: await syncModels(c.req.param("id")) }));

/** LinkAPI key balance, wallet and per-model usage (CONN-25). */
models.get("/connections/:id/balance", (c) => c.json({ balance: cachedBalance(c.req.param("id")) }));

models.post("/connections/:id/balance/refresh", async (c) => {
  const days = Number(c.req.query("days")) === 7 ? 7 : 30;
  return c.json({ balance: await refreshBalance(c.req.param("id"), days) });
});

models.get("/models", (c) => c.json({ models: listModels(c.req.query("connectionId") || undefined) }));

models.post("/models/star", async (c) => {
  const input = await body(c, z.object({ connectionId: z.string(), modelId: z.string(), starred: z.boolean() }));
  starModel(input.connectionId, input.modelId, input.starred);
  return c.json({ ok: true });
});

models.get("/profiles", (c) => c.json({ profiles: listProfiles(), storyProfileId: getSetting("routing.story") }));

models.post("/profiles", async (c) => {
  const input = await body(c, profileInput);
  const id = createProfile(input);
  enqueue("cache.probe", {}, { dedupeKey: "cache.probe", delayMs: 5000 });
  return c.json(getProfile(id), 201);
});

models.put("/profiles/:id", async (c) => {
  const input = await body(c, profileInput.partial());
  must(updateProfile(c.req.param("id"), input) || undefined, "Profile not found");
  // A paid Claude model is probed for caching the first time it's chosen (CONN-24).
  if (input.modelId || input.connectionId) enqueue("cache.probe", {}, { dedupeKey: "cache.probe", delayMs: 5000 });
  return c.json(getProfile(c.req.param("id")));
});

models.delete("/profiles/:id", (c) => {
  const undo = stash("Profile", [{ table: "profiles", where: "id = ?", params: [c.req.param("id")] }], "connections");
  deleteProfile(c.req.param("id"));
  return c.json({ ok: true, undo });
});

models.put("/routing", async (c) => {
  const input = await body(c, z.object({ story: z.string().nullable() }));
  setSetting("routing.story", input.story);
  return c.json({ story: input.story });
});

models.get("/quota", (c) => c.json({ quota: cachedQuota() }));

models.post("/quota/refresh", async (c) => c.json({ quota: await refreshQuota() }));

models.get("/usage", (c) => c.json(usageSummary(Math.min(90, Number(c.req.query("days")) || 7))));

/** Cache probe on demand (CONN-24). */
models.post("/connections/:id/probe", async (c) => {
  const input = await body(c, z.object({ modelId: z.string().min(1) }));
  return c.json(await probeCache(c.req.param("id"), input.modelId));
});

/** Connection speed: each task's model, now against usually; a live test sends one short request. */
models.get("/speed", (c) => c.json({ routes: speedReport() }));
models.post("/speed/test", async (c) => {
  const input = await body(c, z.object({ task: z.enum(SPEED_TASKS as [string, ...string[]]) }));
  return c.json({ test: await speedTest(input.task as (typeof SPEED_TASKS)[number]), routes: speedReport() });
});

/** Quota planner (CONN-19): turns per day at current settings, by feature, plus pacing. */
models.get("/quota/planner", (c) => c.json(quotaPlannerJson()));

models.get("/cache-stats", (c) => c.json(cacheStats(Math.min(90, Number(c.req.query("days")) || 7), c.req.query("chatId") || undefined)));

/** Request history (DBG-02). */
models.get("/requests", (c) => {
  const q = c.req.query();
  return c.json({ requests: listRequests({ chatId: q.chatId || undefined, task: q.task || undefined, limit: Number(q.limit) || undefined, before: Number(q.before) || undefined }) });
});
models.get("/requests/:id", (c) => c.json(must(getRequest(c.req.param("id")), "Request not found")));

/** Job monitor (DBG-03). */
models.get("/jobs", (c) => c.json({ jobs: listJobs({ status: c.req.query("status") || undefined, chatId: c.req.query("chatId") || undefined, limit: Number(c.req.query("limit")) || undefined }) }));
models.post("/jobs/:id/retry", (c) => {
  retryJob(c.req.param("id"));
  return c.json({ ok: true });
});
models.post("/jobs/:id/cancel", (c) => {
  cancelJob(c.req.param("id"));
  return c.json({ ok: true });
});
