import { memoryConfig } from "../lib/settings";
import { historyForPrompt, mustChat } from "../services/chats";
import { currentFold } from "../trackers/store";
import type { WorldState } from "../trackers/types";
import { chatNames } from "./build";
import { memoryInputs } from "./context";
import { chatVectors, embeddingsEnabled } from "./embed";
import { syncEntities } from "./entities";
import { type RecallItem, TimeIndex } from "./format";
import { contextText, rewriteQuery, runLibrarian } from "./librarian";
import { recall } from "./recall";
import { memState } from "./store";

/**
 * Warm on open, prefetch while typing (MEM-20, MEM-21): entities synced, the vector cache loaded,
 * the query rewritten and embedded, and the librarian's verdict ready, so pressing Send costs
 * nothing extra. Nothing here ever blocks a reply; if it isn't ready, recall uses what is.
 */
export async function warmMemory(chatId: string, draft = "") {
  const cfg = memoryConfig();
  if (!cfg.enabled) return { warmed: false, librarian: 0, rewritten: null as string | null };
  const chat = mustChat(chatId);
  const names = chatNames(chatId);
  const history = historyForPrompt(chatId);
  let state: WorldState | null = null;
  try {
    state = currentFold(chatId).result.state;
  } catch {
    state = null;
  }
  syncEntities(chatId);
  if (embeddingsEnabled()) chatVectors(chatId);
  const ctx = contextText(history);
  const rewritten = cfg.rewriteQuery ? await rewriteQuery(chatId, ctx, draft.trim()) : null;
  const inputs = await memoryInputs(chatId, { history, draft, chatMode: chat.mode, state, names, waitMs: 8000 });
  let librarian = 0;
  const evicted = memState(chatId).evictedThrough;
  if (cfg.librarian && evicted > 0) {
    const r = recall({
      chatId,
      evicted,
      budget: 2400,
      queries: inputs.queries,
      qvecs: inputs.qvecs,
      excludeSummaryIds: new Set(),
      seed: `${chatId}:warm`,
      cfg: { ...cfg, entityRecall: false, deepSearch: false },
      pov: inputs.pov,
      present: inputs.present,
      mood: inputs.mood,
      librarian: null,
      times: new TimeIndex(chatId),
      skipCards: inputs.skipCards,
      povName: inputs.povName,
    });
    const v = await runLibrarian(chatId, ctx, draft.trim(), librarianCandidates(r, LIBRARIAN_WIDE), undefined, { ranked: LIBRARIAN_WIDE });
    librarian = v?.keep.size ?? 0;
  }
  return { warmed: true, librarian, rewritten };
}

/**
 * docs/27 6.2: the librarian is shown recall's best-scored memories, chosen or not, and ranks its picks.
 * Shown only what recall already chose, it could reorder those but never rescue a near miss.
 */
export const LIBRARIAN_WIDE = true;

/** What the librarian is shown (the eval shows it the same): recall's best-scored memories, or the best of what it chose. */
export function librarianCandidates(r: { items: RecallItem[]; pool: { key: string; text: string }[] }, wide: boolean) {
  if (wide) return r.pool;
  return r.items
    .filter((i) => (i.ownerType === "memory" || i.ownerType === "summary") && i.slot !== "pinned")
    .sort((a, b) => b.score - a.score)
    .slice(0, 24)
    .map((i) => ({ key: `${i.ownerType}:${i.id}`, text: i.content }));
}
