import { all, now, one, parseJson, run, tx } from "../db/db";
import { getSetting } from "../lib/settings";
import { cosine, embeddingTarget } from "../memory/embed";
import { hashText } from "../memory/text";
import { finishRequest, startRequest } from "../services/requests";
import { type EntryExtra, type ScanEntry } from "./activate";
import { defaultEntry, type LoreEntry, type LorebookSettings } from "./types";

/**
 * Semantic activation (LORE-05): entries that opt in (per entry, or for a whole book) can fire
 * on meaning as well as on keywords. Their vectors live with the memory vectors (owner "lore"),
 * keyed by content hash, so an unchanged entry is never embedded twice.
 */

export function semanticOn(e: { extra: Record<string, unknown>; book: LorebookSettings }) {
  const own = (e.extra as EntryExtra).semantic;
  return own ?? Boolean(e.book.semantic);
}

const toBlob = (v: Float32Array) => new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
const fromBlob = (b: Uint8Array) => new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
const textOf = (e: Pick<LoreEntry, "comment" | "content" | "keys">) => `${e.comment}\n${e.keys.join(", ")}\n${e.content}`.trim();

function semanticEntries() {
  const books = all<{ id: string; settings: string }>("SELECT id, settings FROM lorebooks WHERE deleted_at IS NULL");
  const out: { id: string; text: string }[] = [];
  for (const b of books) {
    const settings = parseJson<LorebookSettings>(b.settings, {});
    for (const r of all<{ id: string; data: string }>("SELECT id, data FROM lorebook_entries WHERE lorebook_id = ?", b.id)) {
      const e = defaultEntry(parseJson<Partial<LoreEntry>>(r.data, {}));
      if (!e.enabled || !e.content.trim()) continue;
      if (semanticOn({ extra: e.extra, book: settings })) out.push({ id: r.id, text: textOf(e) });
    }
  }
  return out;
}

/** Background job: embeds opted-in entries that are new or changed (LORE-05). */
export async function embedLore() {
  const t = embeddingTarget();
  if (!t) return { embedded: 0 };
  const want = semanticEntries();
  const have = new Map(all<{ owner_id: string; hash: string; model: string; dims: number }>("SELECT owner_id, hash, model, dims FROM embeddings WHERE owner_type = 'lore'").map((r) => [r.owner_id, r]));
  const todo = want.filter((w) => {
    const h = have.get(w.id);
    return !h || h.hash !== hashText(w.text) || h.model !== t.model || h.dims !== t.dims;
  });
  for (let i = 0; i < todo.length; i += 64) {
    const batch = todo.slice(i, i + 64);
    const reqId = startRequest({ chatId: null, kind: "embed", task: "embeddings", resolved: { connection: { id: t.connectionId }, modelId: t.model, billing: t.billing, profile: { id: "embeddings" } }, request: { model: t.model, inputs: batch.length, lore: true } });
    try {
      const res = await t.provider.embed!(
        batch.map((b) => b.text),
        t.model,
        t.dims,
      );
      tx(() =>
        batch.forEach((b, j) => {
          const v = res.vectors[j]!;
          let n = 0;
          for (let k = 0; k < v.length; k++) n += v[k]! * v[k]!;
          n = Math.sqrt(n) || 1;
          for (let k = 0; k < v.length; k++) v[k]! /= n;
          run(
            `INSERT INTO embeddings (owner_type, owner_id, chat_id, model, dims, hash, vector, created_at) VALUES ('lore', ?, '', ?, ?, ?, ?, ?)
             ON CONFLICT(owner_type, owner_id) DO UPDATE SET model = excluded.model, dims = excluded.dims, hash = excluded.hash, vector = excluded.vector, created_at = excluded.created_at`,
            b.id,
            t.model,
            t.dims,
            hashText(b.text),
            toBlob(v),
            now(),
          );
        }),
      );
      finishRequest(reqId, { status: "done", usage: { promptTokens: res.promptTokens } });
    } catch (e) {
      finishRequest(reqId, { status: "error", error: (e as Error).message });
      throw e;
    }
  }
  cache = null;
  return { embedded: todo.length };
}

let cache: { key: string; map: Map<string, Float32Array> } | null = null;

export function loreVectors() {
  const t = getSetting("routing.embeddings");
  const stamp = one<{ n: number; m: number | null }>("SELECT COUNT(*) AS n, MAX(created_at) AS m FROM embeddings WHERE owner_type = 'lore' AND model = ? AND dims = ?", t.model, t.dims);
  const key = `${t.model}:${t.dims}:${stamp?.n}:${stamp?.m}`;
  if (cache?.key === key) return cache.map;
  const map = new Map(all<{ owner_id: string; vector: Uint8Array }>("SELECT owner_id, vector FROM embeddings WHERE owner_type = 'lore' AND model = ? AND dims = ?", t.model, t.dims).map((r) => [r.owner_id, fromBlob(r.vector)]));
  cache = { key, map };
  return map;
}

/** True when any entry in these would fire on meaning (so a query vector is worth having). */
export function anySemantic(entries: ScanEntry[]) {
  return entries.some((e) => semanticOn(e));
}

/** The scorer activateLore uses: similarity for opted-in entries with a vector, else null. */
export function semanticScorer(qvec: Float32Array | null) {
  if (!qvec) return undefined;
  const vecs = loreVectors();
  if (!vecs.size) return undefined;
  return (e: ScanEntry) => {
    if (!semanticOn(e)) return null;
    const v = vecs.get(e.id);
    return v ? cosine(qvec, v) : null;
  };
}
