import { z } from "zod";
import { now } from "../db/db";
import { callJson } from "../services/llm";
import { shouldShed } from "../services/quota";
import type { LibrarianVerdict } from "./recall";
import { contentWords, hashText } from "./text";

/**
 * The librarian (MEM-23) and the rewritten query (MEM-14). Both run while you type (prefetch) or
 * when a chat opens (MEM-21), and their results are cached; a reply never waits for them.
 *
 * They are keyed by the conversation so far (the last two messages), not by the draft, and the send
 * finds the latest one. docs/27 6.3: typing asks again only when it would learn something. The
 * librarian judges each note once per conversation, and is asked again only about notes it hasn't
 * seen; the query is rewritten again only when the draft has new words. Before, both refreshed every
 * 6 seconds of typing and whenever a memory was filed: about six librarian calls a reply, and in
 * nearly half of them every note had been judged already.
 */

interface Entry<T> {
  value: T;
  draft: string;
  at: number;
}

const rewrites = new Map<string, Entry<string | null>>();
const verdicts = new Map<string, Entry<LibrarianVerdict>>();
const inflight = new Map<string, Promise<unknown>>();
/** Fewer unjudged notes than this, and the librarian isn't asked again: the rest stay unweighted. */
const NEW_NOTES = 4;
/** The draft must gain this many new words before the query is rewritten again. */
const NEW_WORDS = 3;

const remember = <T>(m: Map<string, Entry<T>>, k: string, v: T, draft: string) => {
  m.set(k, { value: v, draft, at: now() });
  if (m.size > 300) m.delete(m.keys().next().value!);
};

/** The conversation context a cache entry belongs to: the last two messages. */
export function contextText(msgs: { content: string }[]) {
  return msgs
    .slice(-2)
    .map((m) => m.content)
    .join("\n")
    .slice(-2400);
}

const rwKey = (chatId: string, ctx: string) => `${chatId}:${hashText(ctx)}`;
// Not keyed by the memory version: a verdict is per note, and a new memory is simply a note not yet judged.
const libKey = (chatId: string, ctx: string) => `${chatId}:${hashText(ctx)}`;

/** The cached rewrite for any of the given contexts (before or after the message was sent). */
export function cachedRewrite(chatId: string, contexts: string[]) {
  for (const c of contexts) {
    const e = rewrites.get(rwKey(chatId, c));
    if (e) return e.value;
  }
  return null;
}

export function cachedVerdict(chatId: string, contexts: string[]) {
  for (const c of contexts) {
    const e = verdicts.get(libKey(chatId, c));
    if (e) return e.value;
  }
  return null;
}

/** A rewrite still serves while the draft hasn't gained enough new words. */
function fresh(e: Entry<string | null> | undefined, draft: string) {
  if (!e) return false;
  if (e.draft === draft) return true;
  const before = contentWords(e.draft);
  let added = 0;
  for (const w of contentWords(draft)) if (!before.has(w) && ++added >= NEW_WORDS) return false;
  return true;
}

const rewriteSchema = z.object({ query: z.string().default("") });

/** A search query for what from the past matters now: names, places, objects, open promises. */
export async function rewriteQuery(chatId: string, ctx: string, draft = "", signal?: AbortSignal) {
  const key = rwKey(chatId, ctx);
  const cur = rewrites.get(key);
  if (fresh(cur, draft)) return cur!.value;
  if (shouldShed("librarian", chatId)) return cur?.value ?? null;
  const running = inflight.get(`rw:${key}`) as Promise<string | null> | undefined;
  if (running) return running;
  const p = (async () => {
    try {
      const q = await askRewrite(chatId, ctx, draft, signal);
      remember(rewrites, key, q, draft);
      return q;
    } catch {
      return cur?.value ?? null;
    } finally {
      inflight.delete(`rw:${key}`);
    }
  })();
  inflight.set(`rw:${key}`, p);
  return p;
}

/** The rewrite itself, uncached (the eval calls it too). */
export async function askRewrite(chatId: string, ctx: string, draft = "", signal?: AbortSignal) {
  const r = await callJson({
    task: "helper",
    kind: "librarian:query",
    chatId,
    name: "recall_query",
    schema: rewriteSchema,
    system:
      'You help a story\'s memory search. Read the latest lines of a roleplay and write one search query (8–20 words) for what from EARLIER in the story matters to them now: the people, places, objects, promises, secrets or events they point back to. Use names. No explanations. Reply with JSON only: {"query": "…"}',
    user: `LATEST LINES:\n${ctx}${draft ? `\n\nTHE PLAYER IS WRITING:\n${draft.slice(-1200)}` : ""}`,
    maxTokens: 120,
    signal,
  });
  return r.data.query.trim().slice(0, 300) || null;
}

const verdictSchema = z.object({ keep: z.array(z.coerce.number()).default([]) });

/** Filters recall candidates down to what matters for this turn. */
export async function runLibrarian(chatId: string, ctx: string, draft: string, candidates: { key: string; text: string }[], signal?: AbortSignal) {
  const key = libKey(chatId, ctx);
  const cur = verdicts.get(key);
  const unjudged = candidates.filter((c) => !cur?.value.keep.has(c.key) && !cur?.value.drop.has(c.key));
  if (unjudged.length < NEW_NOTES || shouldShed("librarian", chatId)) return cur?.value ?? null;
  const running = inflight.get(`lib:${key}`) as Promise<LibrarianVerdict | null> | undefined;
  if (running) return running;
  const p = (async () => {
    try {
      const got = await askLibrarian(chatId, ctx, draft, unjudged, signal);
      const verdict: LibrarianVerdict = { keep: new Set([...(cur?.value.keep ?? []), ...got.keep]), drop: new Set([...(cur?.value.drop ?? []), ...got.drop]) };
      remember(verdicts, key, verdict, draft);
      return verdict;
    } catch {
      return cur?.value ?? null;
    } finally {
      inflight.delete(`lib:${key}`);
    }
  })();
  inflight.set(`lib:${key}`, p);
  return p;
}

/** The librarian's call itself, uncached (the eval calls it too). */
export async function askLibrarian(chatId: string, ctx: string, draft: string, candidates: { key: string; text: string }[], signal?: AbortSignal): Promise<LibrarianVerdict> {
  const r = await callJson({
    task: "helper",
    kind: "librarian",
    chatId,
    name: "librarian",
    schema: verdictSchema,
    system:
      'You are the librarian of a long roleplay story. Given its latest lines and numbered notes from earlier in the story, pick the notes that would help write the very next reply well: things referred to, people present, promises or secrets in play, facts that must stay consistent. Leave out notes that are merely on the same topic. Reply with JSON only: {"keep": [numbers]}',
    user: `LATEST LINES:\n${ctx}${draft ? `\n\nTHE PLAYER IS WRITING:\n${draft.slice(-1200)}` : ""}\n\nNOTES:\n${candidates.map((c, i) => `${i + 1}. ${c.text.slice(0, 300)}`).join("\n")}`,
    maxTokens: 200,
    signal,
  });
  const keep = new Set(r.data.keep.map((n) => candidates[Math.round(n) - 1]?.key).filter((k): k is string => Boolean(k)));
  return { keep, drop: new Set(candidates.map((c) => c.key).filter((k) => !keep.has(k))) };
}

/** For tests: forget everything cached. */
export function resetLibrarian() {
  rewrites.clear();
  verdicts.clear();
}
