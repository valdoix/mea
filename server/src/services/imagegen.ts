import { z } from "zod";
import { all, newId, now, one, parseJson, run, tx } from "../db/db";
import { publish } from "../lib/events";
import { badRequest } from "../lib/http";
import { getSetting } from "../lib/settings";
import { type ImageModelInfo, type ImageReference, isImageProvider, isToolModel, pricePerImage, sizesOf } from "../providers/images";
import { ProviderError } from "../providers/types";
import { type Family, familyOf, knowsFaces } from "../portraits/compile";
import { getConnectionRow, providerFor } from "./connections";
import { enqueue } from "./jobs";
import { getImage, readImage, saveImage } from "./images";
import { finishRequest, startRequest } from "./requests";

/**
 * Pictures (docs/28 Part 1): the image catalog, and one request for pictures per tap. Every
 * request runs on a pay-as-you-go connection and is never retried on its own: a picture is
 * billed per request, so a failure is shown, not repeated.
 */

/** The connection pictures go through: the one in Settings → Images. */
export function imageConnection(connectionId?: string | null) {
  const id = connectionId ?? getSetting("images.config").connectionId;
  if (!id) throw badRequest("Choose a connection for pictures in Settings → Images first");
  const row = getConnectionRow(id);
  if (!row) throw badRequest("The connection for pictures no longer exists");
  if (row.kind !== "nanogpt" && row.kind !== "mock") throw badRequest("Pictures need a NanoGPT connection");
  if (row.billing === "subscription") throw badRequest("NanoGPT's image models are pay-as-you-go: choose your pay-as-you-go key for pictures, not the subscription one");
  const provider = providerFor(row.id);
  if (!isImageProvider(provider)) throw badRequest("This connection can't make pictures");
  return { row, provider };
}

/** Refreshes the image catalog for a connection. An empty answer keeps the saved one. */
export async function syncImageModels(connectionId?: string | null): Promise<number> {
  const { row, provider } = imageConnection(connectionId);
  let models: ImageModelInfo[];
  try {
    models = await provider.listImageModels();
  } catch (e) {
    throw badRequest(`Couldn't load the image models: ${(e as Error).message}`);
  }
  if (!models.length) throw badRequest("Couldn't load the image models: the provider returned an empty list. The saved list was kept.");
  const t = now();
  tx(() => {
    const keep = new Set(models.map((m) => m.id));
    for (const old of all<{ model_id: string }>("SELECT model_id FROM image_models WHERE connection_id = ?", row.id)) {
      if (!keep.has(old.model_id)) run("DELETE FROM image_models WHERE connection_id = ? AND model_id = ?", row.id, old.model_id);
    }
    for (const m of models) {
      run(
        `INSERT INTO image_models (connection_id, model_id, name, data, updated_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(connection_id, model_id) DO UPDATE SET name = excluded.name, data = excluded.data, updated_at = excluded.updated_at`,
        row.id,
        m.id,
        m.name,
        JSON.stringify(m),
        t,
      );
    }
  });
  return models.length;
}

export interface ImageModelRow extends ImageModelInfo {
  /** Makes no new picture from a prompt (an upscaler, a background remover). */
  tool: boolean;
  /** How its prompts are written (docs/28 §4.4). */
  family: Family;
  /** Draws real actors from a description: not used for live-action characters (§5). */
  knowsFaces: boolean;
}

/** The saved image catalog. Adult-content models only when Settings → Images says so. */
export function imageModels(connectionId: string, opts: { nsfw?: boolean; tools?: boolean } = {}): { models: ImageModelRow[]; syncedAt: number | null } {
  const rows = all<{ data: string; updated_at: number }>("SELECT data, updated_at FROM image_models WHERE connection_id = ? ORDER BY name COLLATE NOCASE", connectionId);
  const nsfw = opts.nsfw ?? getSetting("images.config").nsfw;
  const models = rows
    .map((r) => parseJson<ImageModelInfo | null>(r.data, null))
    .filter((m): m is ImageModelInfo => Boolean(m?.id))
    .map((m) => ({ ...m, tool: isToolModel(m), family: familyOf(m), knowsFaces: knowsFaces(m.id) }))
    .filter((m) => (nsfw || !m.capabilities.nsfw) && (opts.tools || !m.tool));
  return { models, syncedAt: rows.length ? Math.max(...rows.map((r) => r.updated_at)) : null };
}

export function imageModel(connectionId: string, modelId: string): ImageModelInfo | null {
  const r = one<{ data: string }>("SELECT data FROM image_models WHERE connection_id = ? AND model_id = ?", connectionId, modelId);
  return r ? parseJson<ImageModelInfo | null>(r.data, null) : null;
}

export const generateInput = z.object({
  connectionId: z.string().nullish(),
  model: z.string().min(1).max(200),
  prompt: z.string().trim().min(1).max(8000),
  n: z.number().int().min(1).max(8).default(1),
  size: z.string().max(40).nullish(),
  aspectRatio: z.string().max(20).nullish(),
  seed: z.number().int().min(0).max(2 ** 32 - 1).nullish(),
  negative: z.string().max(2000).nullish(),
  /** What the picture was made from (the idea, the Look, the direction), kept with it. */
  recipe: z.record(z.string(), z.unknown()).default({}),
  /** Image ids, sent as reference pictures. */
  references: z.array(z.string()).max(16).default([]),
  kind: z.enum(["try", "bakeoff", "portrait", "look", "cast", "pair", "now", "moment", "cover", "plate", "place"]).default("try"),
  ownerType: z.enum(["character", "persona", "variant", "cast", "chat"]).nullish(),
  ownerId: z.string().nullish(),
  chatId: z.string().nullish(),
});
export type GenerateInput = z.input<typeof generateInput>;

export interface BatchView {
  id: string;
  status: "queued" | "running" | "done" | "error";
  error: string | null;
  model: string;
  prompt: string;
  params: { n: number; size: string | null; aspectRatio: string | null; seed: number | null };
  kind: string;
  ownerType: string | null;
  ownerId: string | null;
  negative: string | null;
  recipe: Record<string, unknown>;
  estimate: number | null;
  cost: number | null;
  images: { id: string; width: number | null; height: number | null; cost: number | null; kept: boolean }[];
  createdAt: number;
  finishedAt: number | null;
}

interface BatchRow {
  id: string;
  status: BatchView["status"];
  error: string | null;
  connection_id: string | null;
  model: string;
  prompt: string;
  params: string;
  refs: string;
  kind: string;
  owner_type: string | null;
  owner_id: string | null;
  chat_id: string | null;
  estimate: number | null;
  cost: number | null;
  recipe: string;
  negative: string | null;
  job_id: string | null;
  created_at: number;
  finished_at: number | null;
}

/**
 * Queues one request for pictures. Checked against the model's catalog entry first, so a size it
 * doesn't take or too many pictures fail here, for free, not at the provider.
 */
export function startImageBatch(raw: GenerateInput): BatchView {
  const input = generateInput.parse(raw);
  const { row } = imageConnection(input.connectionId);
  const m = imageModel(row.id, input.model);
  if (!m && row.kind !== "mock") throw badRequest("That model isn't in the image catalog. Sync the image models first.");
  if (m) {
    if (input.n > m.maxImages) throw badRequest(`${m.name} makes at most ${m.maxImages} ${m.maxImages === 1 ? "picture" : "pictures"} at a time`);
    const sizes = sizesOf(m);
    if (input.size && sizes.length && !sizes.includes(input.size) && !m.sizes.includes(input.size)) throw badRequest(`${m.name} doesn't draw at ${input.size} (it takes ${sizes.slice(0, 8).join(", ")})`);
    if (input.aspectRatio && m.aspectRatios.length && !m.aspectRatios.includes(input.aspectRatio)) throw badRequest(`${m.name} doesn't take the shape ${input.aspectRatio}`);
    if (input.references.length > m.maxInputImages) throw badRequest(m.maxInputImages ? `${m.name} takes at most ${m.maxInputImages} reference pictures` : `${m.name} doesn't take reference pictures`);
    if (m.maxPromptChars && input.prompt.length > m.maxPromptChars) throw badRequest(`The prompt is too long for ${m.name} (${input.prompt.length} of ${m.maxPromptChars} characters)`);
    if (m.capabilities.nsfw && !getSetting("images.config").nsfw) throw badRequest(`${m.name} is hidden: models that allow adult content are off in Settings → Images`);
  }
  for (const id of input.references) if (!getImage(id)) throw badRequest("A reference picture no longer exists");
  if (JSON.stringify(input.recipe).length > 40_000) throw badRequest("The recipe is too large");
  const each = m ? pricePerImage(m, input.size && m.prices[input.size] != null ? input.size : input.aspectRatio) : null;
  const estimate = each == null ? null : Math.round(each * input.n * 1_000_000) / 1_000_000;
  const id = newId();
  const params = { n: input.n, size: input.size ?? null, aspectRatio: input.aspectRatio ?? null, seed: input.seed ?? null };
  run(
    `INSERT INTO image_batches (id, status, connection_id, model, prompt, params, refs, kind, owner_type, owner_id, chat_id, estimate, created_at, recipe, negative)
     VALUES (?, 'queued', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    row.id,
    input.model,
    input.prompt,
    JSON.stringify(params),
    JSON.stringify(input.references),
    input.kind,
    input.ownerType ?? null,
    input.ownerId ?? null,
    input.chatId ?? null,
    estimate,
    now(),
    JSON.stringify(input.recipe),
    input.negative?.trim() || null,
  );
  // One attempt only: a retried request would be billed again.
  const jobId = enqueue("image.generate", { batchId: id }, { maxAttempts: 1, priority: 3, chatId: input.chatId ?? null });
  run("UPDATE image_batches SET job_id = ? WHERE id = ?", jobId, id);
  return batchView(id)!;
}

export function batchView(id: string): BatchView | null {
  const b = one<BatchRow>("SELECT * FROM image_batches WHERE id = ?", id);
  if (!b) return null;
  const images = all<{ image_id: string; cost: number | null; kept: number; width: number | null; height: number | null }>(
    "SELECT r.image_id, r.cost, r.kept, i.width, i.height FROM image_recipes r JOIN images i ON i.id = r.image_id WHERE r.batch_id = ? ORDER BY r.idx",
    id,
  );
  return {
    id: b.id,
    status: b.status,
    error: b.error,
    model: b.model,
    prompt: b.prompt,
    params: parseJson(b.params, { n: 1, size: null, aspectRatio: null, seed: null }),
    kind: b.kind,
    ownerType: b.owner_type,
    ownerId: b.owner_id,
    negative: b.negative,
    recipe: parseJson(b.recipe, {}),
    estimate: b.estimate,
    cost: b.cost,
    images: images.map((r) => ({ id: r.image_id, width: r.width, height: r.height, cost: r.cost, kept: Boolean(r.kept) })),
    createdAt: b.created_at,
    finishedAt: b.finished_at,
  };
}

/** Recent requests for pictures, newest first. */
export function recentBatches(opts: { kind?: string; ownerType?: string; ownerId?: string; limit?: number } = {}): BatchView[] {
  const where: string[] = [];
  const args: (string | number)[] = [];
  if (opts.kind) {
    where.push("kind = ?");
    args.push(opts.kind);
  }
  if (opts.ownerType && opts.ownerId) {
    where.push("owner_type = ? AND owner_id = ?");
    args.push(opts.ownerType, opts.ownerId);
  }
  const ids = all<{ id: string }>(`SELECT id FROM image_batches ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY created_at DESC LIMIT ?`, ...args, Math.min(100, opts.limit ?? 12));
  return ids.map((r) => batchView(r.id)!).filter(Boolean);
}

/** Keeps a picture for good (it no longer goes after UNKEPT_DAYS), or lets it go again. */
export function keepImage(imageId: string, kept = true) {
  const r = one<{ batch_id: string }>("SELECT batch_id FROM image_recipes WHERE image_id = ?", imageId);
  if (!r) throw badRequest("That picture wasn't made by Mea");
  run("UPDATE image_recipes SET kept = ? WHERE image_id = ?", kept ? 1 : 0, imageId);
  publish({ type: "images.changed", batchId: r.batch_id });
}

function finishBatch(id: string, patch: { status: "done" | "error"; error?: string | null; cost?: number | null }) {
  run("UPDATE image_batches SET status = ?, error = ?, cost = COALESCE(?, cost), finished_at = ? WHERE id = ?", patch.status, patch.error ?? null, patch.cost ?? null, now(), id);
  publish({ type: "images.changed", batchId: id });
}

/** The job: draws a queued request once. A request already started (Mea restarted mid-way) is never sent again. */
export async function runImageJob(payload: Record<string, unknown>, job: { id: string }) {
  const id = String(payload.batchId ?? "");
  const b = one<BatchRow>("SELECT * FROM image_batches WHERE id = ?", id);
  if (!b) return;
  if (b.status === "running") {
    finishBatch(id, { status: "error", error: "Mea stopped while this was being drawn. It wasn't sent again, so you aren't billed twice; any charge shows in NanoGPT's history." });
    return;
  }
  if (b.status !== "queued") return;
  run("UPDATE image_batches SET status = 'running' WHERE id = ?", id);
  publish({ type: "images.changed", batchId: id });
  const params = parseJson<BatchView["params"]>(b.params, { n: 1, size: null, aspectRatio: null, seed: null });
  let target: ReturnType<typeof imageConnection>;
  try {
    target = imageConnection(b.connection_id);
  } catch (e) {
    finishBatch(id, { status: "error", error: (e as Error).message });
    return;
  }
  const references: ImageReference[] = [];
  for (const ref of parseJson<string[]>(b.refs, [])) {
    const img = await readImage(ref);
    if (!img) {
      finishBatch(id, { status: "error", error: "A reference picture no longer exists" });
      return;
    }
    references.push({ mime: img.mime, bytes: img.bytes });
  }
  const reqId = startRequest({
    chatId: b.chat_id,
    kind: "image",
    task: "images",
    resolved: { connection: { id: target.row.id }, modelId: b.model, billing: target.row.billing, profile: { id: "images" } },
    request: { model: b.model, prompt: b.prompt, ...(b.negative ? { negative: b.negative } : {}), ...params, references: references.length },
    jobId: job.id,
  });
  try {
    const res = await target.provider.generateImage({ model: b.model, prompt: b.prompt, n: params.n, size: params.size ?? undefined, aspectRatio: params.aspectRatio ?? undefined, seed: params.seed ?? undefined, negative: b.negative ?? undefined, references });
    const each = res.cost == null ? null : res.cost / res.images.length;
    const t = now();
    let idx = 0;
    for (const bytes of res.images) {
      let imageId: string;
      try {
        imageId = await saveImage(bytes);
      } catch {
        continue; // a format Mea can't store: the others still count
      }
      run("INSERT INTO image_recipes (image_id, batch_id, idx, cost, kept, created_at) VALUES (?, ?, ?, ?, 0, ?)", imageId, id, idx++, each, t);
    }
    finishRequest(reqId, { status: "done", sentBody: res.sentBody, response: JSON.stringify({ pictures: res.images.length, saved: idx, cost: res.cost }), cost: res.cost });
    if (!idx) finishBatch(id, { status: "error", error: "The provider sent pictures in a format Mea can't store", cost: res.cost });
    else finishBatch(id, { status: "done", cost: res.cost });
  } catch (e) {
    const message = (e as Error).message;
    finishRequest(reqId, { status: "error", error: message, cost: null });
    finishBatch(id, { status: "error", error: e instanceof ProviderError && e.kind === "billing" ? `${message} · This key can't pay for pictures: pictures need the pay-as-you-go key and some balance.` : message });
  }
}
