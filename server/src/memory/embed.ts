import { all, now, one, run, tx } from "../db/db";
import { getSetting } from "../lib/settings";
import { type Provider, ProviderError } from "../providers/types";
import { getConnectionRow, providerFor } from "../services/connections";
import type { JobContext } from "../services/jobs";
import { finishRequest, startRequest } from "../services/requests";
import { registerStatusTile } from "../services/status";
import { memState } from "./store";
import { cleanText, hashText } from "./text";

/**
 * Embeddings (MEM-11) through the pay-as-you-go key (decision 10). Each vector records the
 * model and size that made it (ARCH-12); identical text is never embedded twice (PERF-07).
 */
export function embeddingTarget(opts: { ignoreBlock?: boolean } = {}): { connectionId: string; model: string; dims: number; provider: Provider; billing: string } | null {
  const cfg = getSetting("routing.embeddings");
  if (!cfg.connectionId || !cfg.model) return null;
  const conn = getConnectionRow(cfg.connectionId);
  if (!conn) return null;
  const provider = providerFor(conn.id);
  if (!provider.embed) return null;
  if (!opts.ignoreBlock && blockFor(conn.id, conn.updated_at, cfg.model, cfg.dims)) return null;
  return { connectionId: conn.id, model: cfg.model, dims: cfg.dims, provider, billing: conn.billing };
}

/**
 * A setup problem (a bad key, a key that can't pay for the embedding model) switches embeddings off
 * instead of failing every job and every turn. It lifts when the connection or the embedding
 * setting changes, after BLOCK_MS (the plan may have been fixed at the provider), or on restart.
 * Meanwhile recall and lore run on keywords, and a status tile says why.
 */
const BLOCK_MS = 6 * 3600_000;
let blocked: { stamp: string; message: string; at: number } | null = null;
const stampOf = (connectionId: string, updatedAt: number, model: string, dims: number) => `${connectionId}:${updatedAt}:${model}:${dims}`;

function blockFor(connectionId: string, updatedAt: number, model: string, dims: number) {
  if (!blocked) return null;
  if (blocked.stamp !== stampOf(connectionId, updatedAt, model, dims) || now() - blocked.at > BLOCK_MS) {
    blocked = null;
    return null;
  }
  return blocked;
}

/** Records a failed embedding call; a permanent one (auth, billing) blocks embeddings for now. */
export function noteEmbedFailure(e: unknown) {
  if (!(e instanceof ProviderError) || !e.permanent) return;
  const cfg = getSetting("routing.embeddings");
  const conn = cfg.connectionId ? getConnectionRow(cfg.connectionId) : undefined;
  if (!conn) return;
  if (!blocked) console.error(`[mea] embeddings are off until the setup changes: ${e.message}`);
  blocked = { stamp: stampOf(conn.id, conn.updated_at, cfg.model, cfg.dims), message: e.message, at: now() };
}

/** Why embeddings are switched off right now, if they are. */
export function embeddingBlock(): { message: string; at: number } | null {
  const t = embeddingTarget({ ignoreBlock: true });
  if (!t) return null;
  const conn = getConnectionRow(t.connectionId);
  const b = conn ? blockFor(conn.id, conn.updated_at, t.model, t.dims) : null;
  return b ? { message: b.message, at: b.at } : null;
}

export function clearEmbeddingBlock() {
  blocked = null;
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
  ownerType: "memory" | "summary" | "passage";
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
  return [...out, ...pendingPassages(chatId, model, dims)];
}

/** About how long a passage is: a few paragraphs, short enough that one detail still moves its vector. */
const PASSAGE_CHARS = 1200;

/**
 * docs/27 Part 5: a message cut into passages of about PASSAGE_CHARS, on sentence boundaries. The same
 * text always cuts the same way, so `<swipe id>:<n>` names one passage for as long as the text stands.
 */
export function passageChunks(text: string, size = PASSAGE_CHARS): string[] {
  const clean = cleanText(text).replace(/[ \t]+/g, " ").trim();
  if (!clean) return [];
  const sentences = clean.split(/(?<=[.!?…]["”')\]*]*)\s+/);
  const out: string[] = [];
  let cur = "";
  for (let s of sentences) {
    while (s.length > size) {
      if (cur) out.push(cur), (cur = "");
      out.push(s.slice(0, size));
      s = s.slice(size);
    }
    if (cur && cur.length + 1 + s.length > size) out.push(cur), (cur = "");
    cur = cur ? `${cur} ${s}` : s;
  }
  if (cur) out.push(cur);
  return out;
}

/**
 * The passages of old messages that still need a vector. Only what has left the window: recall can't
 * search anything before that, so takes that never get used are never paid for. Passages that no longer
 * stand (a rewind, another swipe chosen, an edit, a message hidden or deleted) lose theirs here.
 */
function pendingPassages(chatId: string, model: string, dims: number): Pending[] {
  const evicted = memState(chatId).evictedThrough;
  const have = new Map(
    all<{ owner_id: string; hash: string; model: string; dims: number }>("SELECT owner_id, hash, model, dims FROM embeddings WHERE chat_id = ? AND owner_type = 'passage'", chatId).map((r) => [r.owner_id, r]),
  );
  const live = new Set<string>();
  const out: Pending[] = [];
  if (evicted > 0) {
    const msgs = all<{ swipe: string; content: string }>(
      `SELECT s.id AS swipe, s.content FROM messages m JOIN swipes s ON s.message_id = m.id AND s.idx = m.active_swipe
       WHERE m.chat_id = ? AND m.seq <= ? AND m.deleted_at IS NULL AND m.hidden = 0`,
      chatId,
      evicted,
    );
    for (const m of msgs) {
      passageChunks(m.content).forEach((text, n) => {
        const id = `${m.swipe}:${n}`;
        live.add(id);
        const hash = hashText(text);
        const h = have.get(id);
        if (!h || h.hash !== hash || h.model !== model || h.dims !== dims) out.push({ ownerType: "passage", ownerId: id, text, hash });
      });
    }
  }
  const stale = [...have.keys()].filter((id) => !live.has(id));
  for (let i = 0; i < stale.length; i += 500) {
    const part = stale.slice(i, i + 500);
    run(`DELETE FROM embeddings WHERE chat_id = ? AND owner_type = 'passage' AND owner_id IN (${part.map(() => "?").join(",")})`, chatId, ...part);
  }
  if (stale.length) invalidateVectors(chatId);
  return out;
}

export interface PassageHit {
  swipeId: string;
  n: number;
  sim: number;
}

/**
 * docs/27 Part 5: the passages closest in meaning to a query, best passage per message first. Only the
 * vectors are read here; the caller checks the message is still live and how far back it is.
 */
export function closestPassages(chatId: string, qvec: Float32Array, limit = 60): PassageHit[] {
  const best = new Map<string, PassageHit>();
  for (const v of chatVectors(chatId)) {
    if (v.ownerType !== "passage") continue;
    const cut = v.ownerId.lastIndexOf(":");
    const swipeId = v.ownerId.slice(0, cut);
    const sim = cosine(qvec, v.vector);
    const cur = best.get(swipeId);
    if (!cur || sim > cur.sim) best.set(swipeId, { swipeId, n: Number(v.ownerId.slice(cut + 1)), sim });
  }
  return [...best.values()].sort((a, b) => b.sim - a.sim).slice(0, limit);
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
      noteEmbedFailure(e);
      throw e;
    }
  }
  invalidateVectors(chatId);
  job?.note({ embedded: fresh.length, reused: pending.length - fresh.length, inputTokens: tokens });
}

// ---------- Query side ----------

const queryCache = new Map<string, Float32Array>();
/** Requests on their way, by text, so a send and a prefetch never pay for the same query twice. */
const inflight = new Map<string, Promise<void>>();
/** How long a query request may run in the background after the caller stopped waiting. */
const QUERY_REQUEST_MS = 30_000;

function cacheQuery(key: string, v: Float32Array) {
  queryCache.delete(key);
  queryCache.set(key, v);
  while (queryCache.size > 500) queryCache.delete(queryCache.keys().next().value!);
}

/**
 * Starts embedding the texts not cached or already on their way. The request isn't tied to any
 * caller's deadline: a slow endpoint still fills the cache, so the next turn (or the send after a
 * prefetch) finds the vectors ready.
 */
function requestQueries(texts: string[]): Promise<void>[] {
  const t = embeddingTarget();
  if (!t) return [];
  const keyOf = (s: string) => `${t.model}:${t.dims}:${hashText(s)}`;
  const waiting = new Set<Promise<void>>();
  const missing: string[] = [];
  for (const s of new Set(texts.filter((x) => x.trim()))) {
    const key = keyOf(s);
    if (queryCache.has(key)) continue;
    const on = inflight.get(key);
    if (on) waiting.add(on);
    else missing.push(s);
  }
  if (missing.length) {
    const keys = missing.map(keyOf);
    const req: Promise<void> = t.provider
      .embed!(missing, t.model, t.dims, AbortSignal.timeout(QUERY_REQUEST_MS))
      .then((res) => keys.forEach((k, i) => res.vectors[i] && cacheQuery(k, normalize(res.vectors[i]!))))
      .catch((e) => noteEmbedFailure(e)) // keywords carry this turn (MEM-21)
      .finally(() => keys.forEach((k) => inflight.get(k) === req && inflight.delete(k)));
    keys.forEach((k) => inflight.set(k, req));
    waiting.add(req);
  }
  return [...waiting];
}

/** Embeds a search query, cached by text (PERF-06). Returns null when embeddings are off or fail. */
export async function embedQuery(text: string, timeoutMs = 8000): Promise<Float32Array | null> {
  return (await embedQueries([text], timeoutMs))[0] ?? null;
}

/**
 * Several queries in one request (MEM-14), each cached by text. With a deadline the reply never
 * waits long: what isn't ready by then comes back null and recall uses keywords (MEM-21), while
 * the request itself carries on and fills the cache. A deadline of 0 never waits.
 */
export async function embedQueries(texts: string[], timeoutMs = 8000): Promise<(Float32Array | null)[]> {
  const t = embeddingTarget();
  if (!t) return texts.map(() => null);
  const waiting = requestQueries(texts);
  if (waiting.length && timeoutMs > 0) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([Promise.all(waiting), new Promise<void>((r) => (timer = setTimeout(r, timeoutMs)))]);
    clearTimeout(timer);
  }
  return texts.map((s) => queryCache.get(`${t.model}:${t.dims}:${hashText(s)}`) ?? null);
}

/** True when a query's vector is already cached (so a send doesn't wait). */
export function queryReady(text: string) {
  const t = embeddingTarget();
  return Boolean(t && queryCache.has(`${t.model}:${t.dims}:${hashText(text)}`));
}

/** How much of a chat's memory has vectors for the current model (MEM-21: is the index ready?). */
export function indexCoverage(chatId: string) {
  const t = getSetting("routing.embeddings");
  const total = (one<{ n: number }>("SELECT COUNT(*) AS n FROM memories WHERE chat_id = ? AND deleted_at IS NULL AND status != 'superseded'", chatId)?.n ?? 0) +
    (one<{ n: number }>("SELECT COUNT(*) AS n FROM summaries WHERE chat_id = ? AND level IN ('scene', 'chapter') AND state = 'ready' AND content != ''", chatId)?.n ?? 0);
  // M31: only vectors of live memories and summaries count.
  const have =
    (one<{ n: number }>(
      "SELECT COUNT(*) AS n FROM embeddings e JOIN memories m ON m.id = e.owner_id WHERE e.owner_type = 'memory' AND e.chat_id = ? AND e.model = ? AND e.dims = ? AND m.deleted_at IS NULL AND m.status != 'superseded'",
      chatId,
      t.model,
      t.dims,
    )?.n ?? 0) +
    (one<{ n: number }>(
      "SELECT COUNT(*) AS n FROM embeddings e JOIN summaries s ON s.id = e.owner_id WHERE e.owner_type = 'summary' AND e.chat_id = ? AND e.model = ? AND e.dims = ? AND s.level IN ('scene', 'chapter') AND s.state = 'ready' AND s.content != ''",
      chatId,
      t.model,
      t.dims,
    )?.n ?? 0);
  return total ? Math.min(1, have / total) : 1;
}

const vectorCache = new Map<string, { key: string; rows: { ownerType: string; ownerId: string; vector: Float32Array }[] }>();
/** The chats whose vectors stay in memory: the ones used most recently (an open story and a few more). */
const VECTOR_CACHE_CHATS = 8;

export function invalidateVectors(chatId: string) {
  vectorCache.delete(chatId);
}

/** All of a chat's vectors for the current model, cached in memory. */
export function chatVectors(chatId: string) {
  const t = getSetting("routing.embeddings");
  const stamp = one<{ n: number; m: number | null }>("SELECT COUNT(*) AS n, MAX(created_at) AS m FROM embeddings WHERE chat_id = ? AND model = ? AND dims = ?", chatId, t.model, t.dims);
  const key = `${t.model}:${t.dims}:${stamp?.n}:${stamp?.m}`;
  const cached = vectorCache.get(chatId);
  if (cached?.key === key) {
    vectorCache.delete(chatId);
    vectorCache.set(chatId, cached);
    return cached.rows;
  }
  const rows = all<{ owner_type: string; owner_id: string; vector: Uint8Array }>("SELECT owner_type, owner_id, vector FROM embeddings WHERE chat_id = ? AND model = ? AND dims = ?", chatId, t.model, t.dims).map(
    (r) => ({ ownerType: r.owner_type, ownerId: r.owner_id, vector: fromBlob(r.vector) }),
  );
  vectorCache.delete(chatId);
  vectorCache.set(chatId, { key, rows });
  while (vectorCache.size > VECTOR_CACHE_CHATS) vectorCache.delete(vectorCache.keys().next().value!);
  return rows;
}

/** Registry view (ARCH-12): vectors per model and size, and how many don't match the current setting. */
export function embeddingStatus() {
  const t = getSetting("routing.embeddings");
  const byModel = all<{ model: string; dims: number; n: number }>("SELECT model, dims, COUNT(*) AS n FROM embeddings GROUP BY model, dims ORDER BY n DESC");
  const total = byModel.reduce((n, r) => n + r.n, 0);
  const current = byModel.find((r) => r.model === t.model && r.dims === t.dims)?.n ?? 0;
  // Passages (docs/27 Part 5) have vectors of their own; what's missing counts memories and summaries only.
  const currentItems = one<{ n: number }>("SELECT COUNT(*) AS n FROM embeddings WHERE model = ? AND dims = ? AND owner_type != 'passage'", t.model, t.dims)?.n ?? 0;
  const items =
    (one<{ n: number }>("SELECT COUNT(*) AS n FROM memories WHERE deleted_at IS NULL AND status != 'superseded'")?.n ?? 0) +
    (one<{ n: number }>("SELECT COUNT(*) AS n FROM summaries WHERE level IN ('scene', 'chapter') AND state = 'ready' AND content != ''")?.n ?? 0);
  return { enabled: embeddingsEnabled(), blocked: embeddingBlock(), model: t.model, dims: t.dims, byModel, total, current, mismatched: total - current, missing: Math.max(0, items - currentItems) };
}

/** Drops vectors from other models and queues a re-embed for every chat (ARCH-12). */
export function reembedAll(enqueueFor: (chatId: string) => void) {
  const t = getSetting("routing.embeddings");
  run("DELETE FROM embeddings WHERE model != ? OR dims != ?", t.model, t.dims);
  vectorCache.clear();
  for (const c of all<{ id: string }>("SELECT DISTINCT chat_id AS id FROM memories UNION SELECT DISTINCT chat_id FROM summaries")) enqueueFor(c.id);
}

// Fix 2 (the review of 2026-10-12): a key that can't embed is said once, here, not in 45 failed jobs.
registerStatusTile(() => {
  const b = embeddingBlock();
  if (!b) return null;
  return {
    id: "embeddings-off",
    n: 1,
    label: "search by meaning off",
    tone: "red",
    title: `Embeddings stopped: ${b.message}\nMemory and lore use keywords until the embedding connection or model changes (or in a few hours).`,
    open: { href: "/settings/models" },
    order: 3,
  };
});
