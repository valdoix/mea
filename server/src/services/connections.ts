import { z } from "zod";
import { config } from "../config";
import { all, newId, now, one, parseJson, run, tx } from "../db/db";
import { deleteSecret, getSecret, maskSecret, putSecret } from "../lib/crypto";
import { publish } from "../lib/events";
import { badRequest } from "../lib/http";
import { getSetting, setSetting } from "../lib/settings";
import { MockProvider } from "../providers/mock";
import { NANOGPT_BASE, NanoGPTProvider, type Quota } from "../providers/nanogpt";
import { AnthropicProvider } from "../providers/anthropic";
import { OpenAIProvider } from "../providers/openai";
import type { CacheHint, GenerationParams, ModelInfo, Provider } from "../providers/types";
import { recordQuotaSample } from "./quota";

export type ConnectionKind = "nanogpt" | "openai" | "mock";
export type Billing = "subscription" | "paygo" | "unknown";

interface ConnectionRow {
  id: string;
  name: string;
  kind: ConnectionKind;
  base_url: string;
  secret_id: string | null;
  billing: Billing;
  extra: string;
  created_at: number;
  updated_at: number;
}

export type ApiFormat = "openai" | "anthropic";

interface ConnectionExtra {
  lastSyncAt?: number;
  lastError?: string | null;
  headers?: Record<string, string>;
  /** Wire format for generic connections (CONN-23). */
  format?: ApiFormat;
}

const changed = () => publish({ type: "library.changed", what: "connections" });

export const connectionInput = z.object({
  name: z.string().trim().min(1).max(80),
  kind: z.enum(["nanogpt", "openai", "mock"]),
  baseUrl: z.string().trim().optional(),
  apiKey: z.string().trim().optional(),
  billing: z.enum(["subscription", "paygo", "unknown"]).default("unknown"),
  format: z.enum(["openai", "anthropic"]).optional(),
});

function rowToConnection(r: ConnectionRow) {
  const extra = parseJson<ConnectionExtra>(r.extra, {});
  return {
    id: r.id,
    name: r.name,
    kind: r.kind,
    baseUrl: r.base_url,
    billing: r.billing,
    hasKey: Boolean(r.secret_id),
    keyMask: maskSecret(getSecret(r.secret_id)),
    modelCount: one<{ n: number }>("SELECT COUNT(*) AS n FROM models WHERE connection_id = ?", r.id)?.n ?? 0,
    lastSyncAt: extra.lastSyncAt ?? null,
    lastError: extra.lastError ?? null,
    format: (extra.format ?? "openai") as ApiFormat,
  };
}

export function listConnections() {
  return all<ConnectionRow>("SELECT * FROM connections ORDER BY created_at").map(rowToConnection);
}

export function getConnectionRow(id: string) {
  return one<ConnectionRow>("SELECT * FROM connections WHERE id = ?", id);
}

function normalizeBaseUrl(kind: ConnectionKind, baseUrl?: string) {
  if (kind === "nanogpt") return (baseUrl || NANOGPT_BASE).replace(/\/+$/, "");
  if (kind === "mock") return "mock://local";
  if (!baseUrl) throw badRequest("A base URL is required for OpenAI-compatible connections");
  try {
    const u = new URL(baseUrl);
    if (!/^https?:$/.test(u.protocol)) throw new Error();
  } catch {
    throw badRequest("Base URL must be an http(s) URL");
  }
  return baseUrl.replace(/\/+$/, "");
}

export function createConnection(input: z.infer<typeof connectionInput>): string {
  if (input.kind === "mock" && !config.dev) throw badRequest("The mock provider is only available in development mode");
  const id = newId();
  const t = now();
  const secretId = input.apiKey ? putSecret(input.apiKey) : null;
  const extra: ConnectionExtra = input.kind === "openai" && input.format === "anthropic" ? { format: "anthropic" } : {};
  run(
    "INSERT INTO connections (id, name, kind, base_url, secret_id, billing, extra, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    id,
    input.name,
    input.kind,
    normalizeBaseUrl(input.kind, input.baseUrl),
    secretId,
    input.billing,
    JSON.stringify(extra),
    t,
    t,
  );
  changed();
  return id;
}

export function updateConnection(id: string, input: Partial<z.infer<typeof connectionInput>>) {
  const row = getConnectionRow(id);
  if (!row) return false;
  let secretId = row.secret_id;
  if (input.apiKey !== undefined) {
    if (input.apiKey) secretId = putSecret(input.apiKey, row.secret_id ?? undefined);
    else if (row.secret_id) {
      deleteSecret(row.secret_id);
      secretId = null;
    }
  }
  run(
    "UPDATE connections SET name = ?, base_url = ?, secret_id = ?, billing = ?, updated_at = ? WHERE id = ?",
    input.name ?? row.name,
    input.baseUrl !== undefined ? normalizeBaseUrl(row.kind, input.baseUrl) : row.base_url,
    secretId,
    input.billing ?? row.billing,
    now(),
    id,
  );
  if (input.format && row.kind === "openai") setExtra(id, { format: input.format });
  changed();
  return true;
}

export function deleteConnection(id: string) {
  const row = getConnectionRow(id);
  if (!row) return;
  tx(() => {
    run("DELETE FROM connections WHERE id = ?", id);
    if (row.secret_id) deleteSecret(row.secret_id);
  });
  changed();
}

function setExtra(id: string, patch: ConnectionExtra) {
  const row = getConnectionRow(id);
  if (!row) return;
  run("UPDATE connections SET extra = ? WHERE id = ?", JSON.stringify({ ...parseJson<ConnectionExtra>(row.extra, {}), ...patch }), id);
}

export function providerFor(connectionId: string): Provider {
  const row = getConnectionRow(connectionId);
  if (!row) throw badRequest("Connection not found");
  const apiKey = getSecret(row.secret_id);
  const headers = parseJson<ConnectionExtra>(row.extra, {}).headers;
  if (row.kind === "mock") return new MockProvider(Number(process.env.MEA_MOCK_DELAY ?? 18));
  if (row.kind === "nanogpt") return new NanoGPTProvider({ baseUrl: row.base_url, apiKey, headers });
  if (connectionFormat(row) === "anthropic") return new AnthropicProvider({ baseUrl: row.base_url, apiKey, headers });
  return new OpenAIProvider({ baseUrl: row.base_url, apiKey, headers });
}

export function connectionFormat(row: Pick<ConnectionRow, "kind" | "extra">): ApiFormat {
  return row.kind === "openai" && parseJson<ConnectionExtra>(row.extra, {}).format === "anthropic" ? "anthropic" : "openai";
}

/** Refreshes the model catalog for a connection (CONN-11). Starred flags survive. */
export async function syncModels(connectionId: string): Promise<number> {
  const row = getConnectionRow(connectionId);
  if (!row) throw badRequest("Connection not found");
  const provider = providerFor(connectionId);
  let models: ModelInfo[];
  try {
    models =
      provider instanceof NanoGPTProvider ? await provider.listModels({ subscriptionOnly: row.billing === "subscription" }) : await provider.listModels();
  } catch (e) {
    setExtra(connectionId, { lastError: (e as Error).message });
    throw badRequest(`Couldn't load models: ${(e as Error).message}`);
  }
  const t = now();
  tx(() => {
    const keep = new Set(models.map((m) => m.id));
    for (const old of all<{ model_id: string }>("SELECT model_id FROM models WHERE connection_id = ?", connectionId)) {
      if (!keep.has(old.model_id)) run("DELETE FROM models WHERE connection_id = ? AND model_id = ?", connectionId, old.model_id);
    }
    for (const m of models) {
      run(
        `INSERT INTO models (connection_id, model_id, name, context_length, max_output, capabilities, pricing, subscription, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(connection_id, model_id) DO UPDATE SET name = excluded.name, context_length = excluded.context_length,
           max_output = excluded.max_output, capabilities = excluded.capabilities, pricing = excluded.pricing,
           subscription = excluded.subscription, updated_at = excluded.updated_at`,
        connectionId,
        m.id,
        m.name ?? m.id,
        m.contextLength ?? null,
        m.maxOutput ?? null,
        JSON.stringify(m.capabilities ?? {}),
        JSON.stringify(m.pricing ?? {}),
        m.subscription ? 1 : 0,
        t,
      );
    }
  });
  setExtra(connectionId, { lastSyncAt: t, lastError: null });
  changed();
  return models.length;
}

export interface ModelRow {
  connection_id: string;
  model_id: string;
  name: string | null;
  context_length: number | null;
  max_output: number | null;
  capabilities: string;
  pricing: string;
  subscription: number;
  starred: number;
  learned_context: number | null;
  calibration: number | null;
  cache_probe: string | null;
}

export function listModels(connectionId?: string) {
  const rows = connectionId
    ? all<ModelRow>("SELECT * FROM models WHERE connection_id = ? ORDER BY starred DESC, name COLLATE NOCASE", connectionId)
    : all<ModelRow>("SELECT * FROM models ORDER BY starred DESC, name COLLATE NOCASE");
  return rows.map(modelOut);
}

export function getModel(connectionId: string, modelId: string) {
  const r = one<ModelRow>("SELECT * FROM models WHERE connection_id = ? AND model_id = ?", connectionId, modelId);
  return r ? modelOut(r) : undefined;
}

function modelOut(r: ModelRow) {
  return {
    connectionId: r.connection_id,
    id: r.model_id,
    name: r.name ?? r.model_id,
    contextLength: r.context_length,
    maxOutput: r.max_output,
    capabilities: parseJson<Record<string, unknown>>(r.capabilities, {}),
    pricing: parseJson<Record<string, unknown>>(r.pricing, {}),
    subscription: Boolean(r.subscription),
    starred: Boolean(r.starred),
    learnedContext: r.learned_context,
    calibration: r.calibration,
    cacheProbe: parseJson<CacheProbe | null>(r.cache_probe, null),
  };
}

/** Result of the cache probe (CONN-24). */
export interface CacheProbe {
  verified: boolean;
  format: string;
  firstWrite: number;
  secondRead: number;
  hitRate: number;
  at: number;
  error?: string;
}

/** Remembers a model's real context limit from an overflow error (CTX-03). */
export function learnContextLimit(connectionId: string, modelId: string, limit: number) {
  run("UPDATE models SET learned_context = ? WHERE connection_id = ? AND model_id = ?", limit, connectionId, modelId);
}

/** Running ratio of provider-reported prompt tokens to Mea's estimate (CTX-03). */
export function recordCalibration(connectionId: string, modelId: string, estimated: number, reported: number) {
  if (estimated < 200 || reported < 200) return;
  const ratio = Math.max(0.5, Math.min(2, reported / estimated));
  const cur = one<{ calibration: number | null }>("SELECT calibration FROM models WHERE connection_id = ? AND model_id = ?", connectionId, modelId);
  if (!cur) return;
  const next = cur.calibration == null ? ratio : cur.calibration * 0.8 + ratio * 0.2;
  run("UPDATE models SET calibration = ? WHERE connection_id = ? AND model_id = ?", Math.round(next * 1000) / 1000, connectionId, modelId);
}

export function saveCacheProbe(connectionId: string, modelId: string, probe: CacheProbe) {
  run("UPDATE models SET cache_probe = ? WHERE connection_id = ? AND model_id = ?", JSON.stringify(probe), connectionId, modelId);
}

export function starModel(connectionId: string, modelId: string, starred: boolean) {
  run("UPDATE models SET starred = ? WHERE connection_id = ? AND model_id = ?", starred ? 1 : 0, connectionId, modelId);
}

// ---------- Profiles (CONN-02) ----------

export const profileParams = z.object({
  temperature: z.number().min(0).max(5).optional(),
  top_p: z.number().min(0).max(1).optional(),
  top_k: z.number().int().min(0).optional(),
  min_p: z.number().min(0).max(1).optional(),
  frequency_penalty: z.number().min(-2).max(2).optional(),
  presence_penalty: z.number().min(-2).max(2).optional(),
  repetition_penalty: z.number().min(0).max(3).optional(),
  max_tokens: z.number().int().min(16).max(65536).optional(),
  reasoning_effort: z.string().optional(),
  hide_reasoning: z.boolean().optional(),
  /** Prompt size target in tokens (CTX-01). */
  context_target: z.number().int().min(1024).max(2_000_000).optional(),
  /** Explicit prompt caching on paid Claude routes (CONN-12): auto or off. */
  cache: z.enum(["auto", "off"]).optional(),
  /** PROMPT-10: this model's prefill (the start of its reply); set, even empty, it replaces the preset's. */
  prefill: z.string().max(4000).optional(),
});
export type ProfileParams = z.infer<typeof profileParams>;

export const profileInput = z.object({
  name: z.string().trim().min(1).max(80),
  connectionId: z.string().nullable(),
  modelId: z.string().nullable(),
  params: profileParams.default({}),
});

interface ProfileRow {
  id: string;
  name: string;
  connection_id: string | null;
  model_id: string | null;
  params: string;
  created_at: number;
  updated_at: number;
}

const profileOut = (r: ProfileRow) => ({
  id: r.id,
  name: r.name,
  connectionId: r.connection_id,
  modelId: r.model_id,
  params: parseJson<ProfileParams>(r.params, {}),
});

export function listProfiles() {
  return all<ProfileRow>("SELECT * FROM profiles ORDER BY created_at").map(profileOut);
}

export function getProfile(id: string | null | undefined) {
  if (!id) return undefined;
  const r = one<ProfileRow>("SELECT * FROM profiles WHERE id = ?", id);
  return r ? profileOut(r) : undefined;
}

export function createProfile(input: z.infer<typeof profileInput>): string {
  const id = newId();
  const t = now();
  run("INSERT INTO profiles (id, name, connection_id, model_id, params, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)", id, input.name, input.connectionId, input.modelId, JSON.stringify(input.params ?? {}), t, t);
  if (!getSetting("routing.story")) setSetting("routing.story", id);
  changed();
  return id;
}

export function updateProfile(id: string, input: Partial<z.infer<typeof profileInput>>) {
  const cur = getProfile(id);
  if (!cur) return false;
  run(
    "UPDATE profiles SET name = ?, connection_id = ?, model_id = ?, params = ?, updated_at = ? WHERE id = ?",
    input.name ?? cur.name,
    input.connectionId !== undefined ? input.connectionId : cur.connectionId,
    input.modelId !== undefined ? input.modelId : cur.modelId,
    JSON.stringify(input.params ?? cur.params),
    now(),
    id,
  );
  changed();
  return true;
}

export function deleteProfile(id: string) {
  run("DELETE FROM profiles WHERE id = ?", id);
  if (getSetting("routing.story") === id) setSetting("routing.story", listProfiles()[0]?.id ?? null);
  changed();
}

export const DEFAULT_CONTEXT_TARGET = 48_000;

/**
 * Caching strategy for a model (CONN-12). Subscription routes cache implicitly and must never
 * carry explicit flags (NanoGPT would bill them as pay-as-you-go). Paid Claude gets markers.
 */
export function cacheModeFor(conn: Pick<ConnectionRow, "kind" | "extra" | "billing">, modelId: string, setting?: "auto" | "off"): CacheHint["mode"] | null {
  if (setting === "off" || conn.billing === "subscription") return null;
  if (connectionFormat(conn) === "anthropic") return "anthropic";
  if (conn.kind === "nanogpt" && /claude/i.test(modelId)) return "nanogpt";
  return null;
}

export type ResolvedProfile = ReturnType<typeof resolveProfile>;

/** Resolves everything needed to call a model for a profile. */
/**
 * A profile ready to use. `override` (CONN-07, the header's quick switcher) swaps the model and
 * connection while keeping the profile's tuning.
 */
export function resolveProfile(profileId?: string | null, override?: { connectionId: string; modelId: string } | null) {
  const base = getProfile(profileId ?? getSetting("routing.story")) ?? listProfiles()[0];
  if (!base) throw badRequest("No model is set up yet. Add a connection and a profile in Settings → Models.");
  const profile = override && getConnectionRow(override.connectionId) ? { ...base, connectionId: override.connectionId, modelId: override.modelId } : base;
  if (!profile.connectionId || !profile.modelId) throw badRequest(`Profile "${profile.name}" has no model selected.`);
  const conn = getConnectionRow(profile.connectionId);
  if (!conn) throw badRequest(`Profile "${profile.name}" points to a deleted connection.`);
  const model = getModel(conn.id, profile.modelId);
  const contextLength = model?.learnedContext ?? model?.contextLength ?? null;
  let contextTarget = profile.params.context_target ?? DEFAULT_CONTEXT_TARGET;
  if (contextLength) contextTarget = Math.min(contextTarget, contextLength);
  const params: GenerationParams = { ...profile.params };
  delete (params as Record<string, unknown>).context_target;
  delete (params as Record<string, unknown>).cache;
  delete (params as Record<string, unknown>).prefill;
  return {
    profile,
    /** PROMPT-10: this model's prefill; undefined means "use the preset's". */
    prefill: profile.params.prefill,
    connection: conn,
    provider: providerFor(conn.id),
    modelId: profile.modelId,
    billing: conn.billing,
    contextTarget,
    params,
    /** Provider tokens per estimated token, learned from usage (CTX-03). */
    tokenRatio: model?.calibration ?? 1,
    cacheMode: cacheModeFor(conn, profile.modelId, profile.params.cache),
    structured: Boolean(model?.capabilities?.structured_output),
    pricing: model?.pricing ?? {},
  };
}

export type Task = "story" | "summarizer" | "helper" | "tracker" | "world";

/** Unset helper tasks borrow another task's profile: trackers the helper's, the world the summarizer's. */
const BORROWS: Partial<Record<Task, "summarizer" | "helper">> = { tracker: "helper", world: "summarizer" };

/**
 * The profiles to try for a task, in order (CONN-03, CONN-05). Helpers fall back to the story
 * profile. A chain never moves from a subscription key to a paid one on its own (CONN-20).
 */
export function resolveTaskChain(task: Task, primaryId?: string | null): ResolvedProfile[] {
  const routing = getSetting("routing.tasks");
  const fallbacks = getSetting("routing.fallbacks");
  const story = getSetting("routing.story");
  const first = primaryId ?? (task === "story" ? story : (routing[task] ?? (BORROWS[task] ? routing[BORROWS[task]!] : null) ?? story));
  const out: ResolvedProfile[] = [resolveProfile(first)];
  const seen = new Set([out[0]!.profile.id]);
  for (const id of fallbacks[task] ?? (BORROWS[task] ? fallbacks[BORROWS[task]!] : []) ?? []) {
    let r: ResolvedProfile;
    try {
      r = resolveProfile(id);
    } catch {
      continue;
    }
    if (seen.has(r.profile.id)) continue;
    if (out[0]!.billing === "subscription" && r.billing !== "subscription") continue;
    seen.add(r.profile.id);
    out.push(r);
  }
  return out;
}

// ---------- Quota (CONN-13, CONN-19) ----------

export function quotaConnection() {
  return (
    one<ConnectionRow>("SELECT * FROM connections WHERE kind = 'nanogpt' AND billing = 'subscription' AND secret_id IS NOT NULL ORDER BY created_at LIMIT 1") ??
    one<ConnectionRow>("SELECT * FROM connections WHERE kind = 'nanogpt' AND secret_id IS NOT NULL ORDER BY created_at LIMIT 1")
  );
}

export async function refreshQuota(): Promise<Quota | null> {
  const conn = quotaConnection();
  if (!conn) return null;
  const provider = providerFor(conn.id) as NanoGPTProvider;
  const quota = await provider.getQuota();
  setSetting("quota.cache", quota);
  recordQuotaSample(quota);
  publish({ type: "quota.changed" });
  return quota;
}

export function cachedQuota(): Quota | null {
  return (getSetting("quota.cache") as Quota | null) ?? null;
}
