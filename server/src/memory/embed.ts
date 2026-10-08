import { all, now, one, run, tx } from "../db/db";
import { getSetting } from "../lib/settings";
import type { Provider } from "../providers/types";
import { getConnectionRow, providerFor } from "../services/connections";
import type { JobContext } from "../services/jobs";
import { finishRequest, startRequest } from "../services/requests";
import { hashText } from "./text";

/**
 * Embeddings (MEM-11) through the pay-as-you-go key (decision 10). Each vector records the
 * model and size that made it (ARCH-12); identical text is never embedded twice (PERF-07).
 */
export function embeddingTarget(): { connectionId: string; model: string; dims: number; provider: Provider; billing: string } | null {
  const cfg = getSetting("routing.embeddings");
  if (!cfg.connectionId || !cfg.model) return null;
  const conn = getConnectionRow(cfg.connectionId);
  if (!conn) return null;
  const provider = providerFor(conn.id);
  if (!provider.embed) return null;
  return { connectionId: conn.id, model: cfg.model, dims: cfg.dims, provider, billing: conn.billing };
}

export const embeddingsEnabled = () => embeddingTarget() !== null;

const toBlob = (v: Float32Array) => new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
const fromBlob = (b: Uint8Array) => new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));

function normalize(v: Float32Array) {
  let n = 0;
  for (let i = 0; i < v.length; i++) n += v[i]! * v[i]!;
  n = Math.sqrt(n) || 1;
  for (let i = 0; i < v.length; i++) v[i]! /= n;
  return v;
}

export function cosine(a: Float32Array, b: Float32Array) {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i]! * b[i]!;
  return s;
}

interface Pending {
  ownerType: "memory" | "summary";
  ownerId: string;
  text: string;
  hash: string;
}

/** What still needs a vector for the current model: new, changed, or made by another model. */
function pendingFor(chatId: string, model: string, dims: number): Pending[] {
  const atoms = all<{ id: string; content: string; entities: string; hash: string | null; model: string | null; dims: number | null }>(
    `SELECT m.id, m.content, m.entities, e.hash, e.model, e.dims FROM memories m
     LEFT JOIN embeddings e ON e.owner_type = 'memory' AND e.owner_id = m.id
     WHERE m.chat_id = ? AND m.deleted_at IS NULL AND m.status != 'superseded'`,
    chatId,
  );
  const sums = all<{ id: string; title: string; content: string; hash: string | null; model: string | null; dims: number | null }>(
    `SELECT s.id, s.title, s.content, e.hash, e.model, e.dims FROM summaries s
     LEFT JOIN embeddings e ON e.owner_type = 'summary' AND e.owner_id = s.id
     WHERE s.chat_id = ? AND s.level IN ('scene', 'chapter') AND s.state = 'ready' AND s.content != ''`,
    chatId,
  );
  const out: Pending[] = [];
  for (const a of atoms) {
    const text = a.content;
    const hash = hashText(text);
    if (a.hash !== hash || a.model !== model || a.dims !== dims) out.push({ ownerType: "memory", ownerId: a.id, text, hash });
  }
  for (const s of sums) {
    const text = `${s.title}\n${s.content}`;
    const hash = hashText(text);
    if (s.hash !== hash || s.model !== model || s.dims !== dims) out.push({ ownerType: "summary", ownerId: s.id, text, hash });
  }
  return out;
}

function store(chatId: string, p: Pending, model: string, dims: number, vector: Float32Array) {
  run(
    `INSERT INTO embeddings (owner_type, owner_id, chat_id, model, dims, hash, vector, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(owner_type, owner_id) DO UPDATE SET model = excluded.model, dims = excluded.dims, hash = excluded.hash, vector = excluded.vector, created_at = excluded.created_at`,
    p.ownerType,
    p.ownerId,
    chatId,
    model,
    dims,
    p.hash,
    toBlob(vector),
    now(),
  );
}

/** Background job: embeds everything new or changed in a chat, in batches. */
export async function embedChat(chatId: string, job?: JobContext) {
  const t = embeddingTarget();
  if (!t) return;
  const pending = pendingFor(chatId, t.model, t.dims);
  if (!pending.length) return;
  // Reuse vectors for identical text first (PERF-07).
  const fresh: Pending[] = [];
  for (const p of pending) {
    const hit = one<{ vector: Uint8Array }>("SELECT vector FROM embeddings WHERE hash = ? AND model = ? AND dims = ? LIMIT 1", p.hash, t.model, t.dims);
    if (hit) store(chatId, p, t.model, t.dims, fromBlob(hit.vector));
    else fresh.push(p);
  }
  let tokens = 0;
  for (let i = 0; i < fresh.length; i += 64) {
    const batch = fresh.slice(i, i + 64);
    const reqId = startRequest({
      chatId,
      kind: "embed",
      task: "embeddings",
      resolved: { connection: { id: t.connectionId }, modelId: t.model, billing: t.billing, profile: { id: "embeddings" } },
      request: { model: t.model, dimensions: t.dims, inputs: batch.length },
      jobId: job?.id,
    });
    try {
      const res = await t.provider.embed!(
        batch.map((b) => b.text),
        t.model,
        t.dims,
      );
      tx(() => batch.forEach((b, j) => store(chatId, b, t.model, t.dims, normalize(res.vectors[j]!))));
      tokens += res.promptTokens ?? 0;
      finishRequest(reqId, { status: "done", usage: { promptTokens: res.promptTokens } });
    } catch (e) {
      finishRequest(reqId, { status: "error", error: (e as Error).message });
      throw e;
    }
  }
  invalidateVectors(chatId);
  job?.note({ embedded: fresh.length, reused: pending.length - fresh.length, inputTokens: tokens });
}

// ---------- Query side ----------

const queryCache = new Map<string, Float32Array>();

/** Embeds a search query, cached by text (PERF-06). Returns null when embeddings are off or fail. */
export async function embedQuery(text: string, signal?: AbortSignal): Promise<Float32Array | null> {
  const t = embeddingTarget();
  if (!t || !text.trim()) return null;
  const key = `${t.model}:${t.dims}:${hashText(text)}`;
  const hit = queryCache.get(key);
  if (hit) return hit;
  try {
    const res = await t.provider.embed!([text], t.model, t.dims, signal ?? AbortSignal.timeout(8000));
    const v = normalize(res.vectors[0]!);
    queryCache.set(key, v);
    if (queryCache.size > 500) queryCache.delete(queryCache.keys().next().value!);
    return v;
  } catch {
    return null; // never block a reply on embeddings (MEM-21)
  }
}

const vectorCache = new Map<string, { key: string; rows: { ownerType: string; ownerId: string; vector: Float32Array }[] }>();

export function invalidateVectors(chatId: string) {
  vectorCache.delete(chatId);
}

/** All of a chat's vectors for the current model, cached in memory. */
export function chatVectors(chatId: string) {
  const t = getSetting("routing.embeddings");
  const stamp = one<{ n: number; m: number | null }>("SELECT COUNT(*) AS n, MAX(created_at) AS m FROM embeddings WHERE chat_id = ? AND model = ? AND dims = ?", chatId, t.model, t.dims);
  const key = `${t.model}:${t.dims}:${stamp?.n}:${stamp?.m}`;
  const cached = vectorCache.get(chatId);
  if (cached?.key === key) return cached.rows;
  const rows = all<{ owner_type: string; owner_id: string; vector: Uint8Array }>("SELECT owner_type, owner_id, vector FROM embeddings WHERE chat_id = ? AND model = ? AND dims = ?", chatId, t.model, t.dims).map(
    (r) => ({ ownerType: r.owner_type, ownerId: r.owner_id, vector: fromBlob(r.vector) }),
  );
  vectorCache.set(chatId, { key, rows });
  return rows;
}

/** Registry view (ARCH-12): vectors per model and size, and how many don't match the current setting. */
export function embeddingStatus() {
  const t = getSetting("routing.embeddings");
  const byModel = all<{ model: string; dims: number; n: number }>("SELECT model, dims, COUNT(*) AS n FROM embeddings GROUP BY model, dims ORDER BY n DESC");
  const total = byModel.reduce((n, r) => n + r.n, 0);
  const current = byModel.find((r) => r.model === t.model && r.dims === t.dims)?.n ?? 0;
  const items =
    (one<{ n: number }>("SELECT COUNT(*) AS n FROM memories WHERE deleted_at IS NULL AND status != 'superseded'")?.n ?? 0) +
    (one<{ n: number }>("SELECT COUNT(*) AS n FROM summaries WHERE level IN ('scene', 'chapter') AND state = 'ready' AND content != ''")?.n ?? 0);
  return { enabled: embeddingsEnabled(), model: t.model, dims: t.dims, byModel, total, current, mismatched: total - current, missing: Math.max(0, items - current) };
}

/** Drops vectors from other models and queues a re-embed for every chat (ARCH-12). */
export function reembedAll(enqueueFor: (chatId: string) => void) {
  const t = getSetting("routing.embeddings");
  run("DELETE FROM embeddings WHERE model != ? OR dims != ?", t.model, t.dims);
  vectorCache.clear();
  for (const c of all<{ id: string }>("SELECT DISTINCT chat_id AS id FROM memories UNION SELECT DISTINCT chat_id FROM summaries")) enqueueFor(c.id);
}
