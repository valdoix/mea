import type { CardData } from "../cards/card";
import { now, parseJson, run } from "../db/db";
import { publish } from "../lib/events";
import { HttpError, notFound } from "../lib/http";
import { getSetting, memoryConfig } from "../lib/settings";
import { countTokens } from "../lib/tokens";
import { activateLore, type ActivationResult } from "../lore/activate";
import { loadLoreState, saveLoreState, scanEntriesFor } from "../lore/service";
import { buildMemoryContext, queryText } from "../memory/context";
import { embeddingsEnabled, embedQuery } from "../memory/embed";
import { scheduleMemory } from "../memory/scheduler";
import { setMemState } from "../memory/store";
import { type AssembleKind, type AssembleResult, assemblePrompt } from "../prompt/assemble";
import { expandMacros } from "../prompt/macros";
import { contextLimitFromError, ProviderError, type CacheHint, type GenerationParams, type Usage } from "../providers/types";
import { getCard, getCharacterRow, touchCharacter } from "./characters";
import {
  addMessage,
  addSwipe,
  type ChatSettings,
  getMessageRow,
  getSwipes,
  historyForPrompt,
  lastMessage,
  messageCountOf,
  mustChat,
  setChatVars,
  updateSwipe,
} from "./chats";
import { learnContextLimit, recordCalibration, type ResolvedProfile, resolveProfile, resolveTaskChain } from "./connections";
import { enqueue } from "./jobs";
import { getDefaultPersona, getPersona, personaPrompt } from "./personas";
import { isChatWatched } from "./presence";
import { resolvePreset } from "./presets";
import { sendPush } from "./push";
import { assertQuota } from "./quota";
import { applyBanned, chatExtras, consumeOnce, looksLikeRefusal, trimUnfinished } from "./chattools";
import { evalCondition } from "../trackers/condition";
import { fileInlineLedger, scheduleTrackers, trackerPrompt } from "../trackers/service";
import type { PromptExtra } from "../prompt/assemble";
import { finishRequest, getRequest, startRequest } from "./requests";

interface ActiveGeneration {
  id: string;
  chatId: string;
  messageId: string;
  swipeIdx: number;
  abort: AbortController;
  text: string;
  reasoning: string;
}

const active = new Map<string, ActiveGeneration>();

export function activeGenerations(chatId?: string) {
  return [...active.values()]
    .filter((g) => !chatId || g.chatId === chatId)
    .map(({ id, chatId: c, messageId, swipeIdx, text, reasoning }) => ({ generationId: id, chatId: c, messageId, swipeIdx, text, reasoning }));
}

export function stopGeneration(generationId: string) {
  const g = active.get(generationId);
  if (!g) return false;
  g.abort.abort();
  return true;
}

export function stopChatGenerations(chatId: string) {
  for (const g of active.values()) if (g.chatId === chatId) g.abort.abort();
}

interface Prepared {
  card: CardData;
  userName: string;
  resolved: ResolvedProfile;
  presetId: string;
  samplers: GenerationParams;
  assembled: AssembleResult;
  lore: ActivationResult;
  cache?: CacheHint;
  trackers: { tokens: number; lanes: { name: string; tokens: number; dropped?: boolean }[]; inline: boolean } | null;
}

/** The world simulation adds what reaches the scene from off the page (sim/crossings). */
let elsewhereLane: ((chatId: string) => string | undefined) | null = null;
export function setElsewhereLane(fn: (chatId: string) => string | undefined) {
  elsewhereLane = fn;
}

export interface PrepareOptions {
  excludeMessageId?: string;
  draft?: string;
  feedback?: string;
  /** Use this profile instead of the chat's (fallbacks, or a paid reply you tapped for). */
  profileId?: string | null;
  /** Shrinks the prompt target after an overflow (CTX-08). */
  targetScale?: number;
}

/** Gathers everything for one request: card, persona, preset, profile, lore, memory, prompt. */
export async function prepare(chatId: string, kind: AssembleKind, opts: PrepareOptions = {}): Promise<Prepared> {
  const chat = mustChat(chatId);
  if (!chat.character_id) throw new HttpError(400, "This chat has no character");
  const charRow = getCharacterRow(chat.character_id);
  const card = getCard(chat.character_id);
  if (!charRow || !card) throw notFound("Character not found");
  const persona = getPersona(chat.persona_id) ?? getDefaultPersona();
  const userName = persona?.name ?? "You";
  const settings = parseJson<ChatSettings>(chat.settings, {});
  const preset = resolvePreset(settings.presetId);
  const resolved = resolveProfile(opts.profileId ?? settings.profileId, opts.profileId ? null : settings.modelOverride);
  const history = historyForPrompt(chatId, { excludeMessageId: opts.excludeMessageId });
  const cfg = memoryConfig();

  const substitute = (s: string) => expandMacros(s, { char: card.name, user: userName, vars: {}, mode: chat.mode });
  const loreDefaults = getSetting("lore.defaults");
  // Trackers (TRK-06): the story state as of the message being written.
  let tp: ReturnType<typeof trackerPrompt> | null = null;
  try {
    tp = trackerPrompt(chatId, { excludeMessageId: opts.excludeMessageId, kind, elsewhere: elsewhereLane?.(chatId) });
  } catch (e) {
    console.error("[mea] trackers unavailable for this prompt:", e);
  }
  // TRK-12: lorebook entries with a tracker condition switch on when it holds, and only then.
  const entries = scanEntriesFor({ characterId: chat.character_id, personaId: persona?.id ?? null, chatId }).flatMap((e) => {
    const when = (e.extra as { trackerWhen?: string } | undefined)?.trackerWhen?.trim();
    if (!when) return [e];
    return tp && evalCondition(tp.state, when) ? [{ ...e, constant: true }] : [];
  });
  const lore = activateLore({
    entries,
    history: history.map((m) => `${m.role === "user" ? userName : m.role === "assistant" ? card.name : "Note"}: ${m.content}`),
    messageCount: messageCountOf(chatId),
    state: loadLoreState(chatId),
    defaults: loreDefaults,
    countTokens,
    substitute,
    splitTriggered: true,
  });

  // Retrieval query (MEM-11); the embedding is usually warm from typing prefetch (CTX-10).
  const query = queryText(history, kind === "expand" ? opts.draft : undefined);
  const qvec = cfg.enabled && embeddingsEnabled() ? await embedQuery(query) : null;
  const contextTarget = Math.floor(resolved.contextTarget * (opts.targetScale ?? 1));

  const assembled = assemblePrompt({
    kind,
    preset,
    card,
    userName,
    personaText: personaPrompt(persona),
    mode: chat.mode,
    history,
    authorsNote: settings.authorsNote?.content.trim() ? settings.authorsNote : undefined,
    lore,
    contextTarget,
    modelId: resolved.modelId,
    vars: parseJson<Record<string, string>>(chat.vars, {}),
    seed: chatId,
    draft: opts.draft,
    feedback: opts.feedback,
    tokenRatio: resolved.tokenRatio,
    filterDepth: cfg.filterDepth,
    extras: [
      ...(tp?.note ? [{ id: "trackers", name: "Story state (trackers)", content: tp.note.text, depth: 1 } satisfies PromptExtra] : []),
      ...(tp?.inline ? [{ id: "ledger", name: "Ledger instructions", content: tp.inline, depth: 0 } satisfies PromptExtra] : []),
      ...chatExtras(chatId, kind, tp?.state ?? null),
    ],
    memory: (available) =>
      buildMemoryContext({
        chatId,
        history,
        available,
        target: Math.floor(contextTarget / (resolved.tokenRatio || 1)),
        query,
        qvec,
        seed: `${chatId}:${messageCountOf(chatId)}`,
      }),
  });

  // Preset samplers are defaults; the profile's tuning for this model wins.
  const samplers: GenerationParams = { ...preset.samplers, ...resolved.params };
  const cache: CacheHint | undefined = resolved.cacheMode
    ? { mode: resolved.cacheMode, ttl: cfg.cacheTtl, prefixEnd: assembled.cacheMarks.prefixEnd, historyEnd: assembled.cacheMarks.historyEnd }
    : undefined;
  const trackers = tp ? { tokens: tp.note?.tokens ?? 0, lanes: tp.note?.lanes ?? [], inline: Boolean(tp.inline) } : null;
  return { card, userName, resolved, presetId: preset.id, samplers, assembled, lore, cache, trackers };
}

function requestFor(p: Prepared, ids: { chatId: string; messageId?: string; swipeId?: string; kind: string }) {
  return startRequest({
    chatId: ids.chatId,
    messageId: ids.messageId,
    swipeId: ids.swipeId,
    kind: ids.kind,
    task: "story",
    resolved: p.resolved,
    request: { model: p.resolved.modelId, messages: p.assembled.messages, params: p.samplers, cache: p.cache ?? null },
    trace: { ...p.assembled.trace, cacheMarks: p.assembled.cacheMarks, cacheMode: p.cache?.mode ?? null, profile: p.resolved.profile.name, trackers: p.trackers },
    estPromptTokens: p.assembled.estPromptTokens,
  });
}

/** Records which memories and summaries a reply was given (MEM-39, MEM-40). */
function recordMemoryUsage(generationId: string, chatId: string, p: Prepared) {
  const m = p.assembled.trace.memory;
  if (!m?.enabled) return;
  const t = now();
  const ins = (type: string, id: string, slot: string) =>
    run("INSERT OR IGNORE INTO memory_usage (generation_id, chat_id, owner_type, owner_id, slot, created_at) VALUES (?, ?, ?, ?, ?, ?)", generationId, chatId, type, id, slot, t);
  for (const i of m.telescope) ins("summary", i.id, "story");
  for (const r of m.recall) ins(r.ownerType, r.id, r.slot);
}

export type StoryAction = "new" | "swipe" | "continue";

/** Starts a story generation and returns once it's running; tokens arrive over the event stream (ARCH-02, ARCH-06). */
export async function startStory(chatId: string, action: StoryAction, opts: { messageId?: string; feedback?: string; profileId?: string | null; auto?: string } = {}) {
  if (activeGenerations(chatId).length) throw new HttpError(409, "A reply is already being written in this chat");
  const last = lastMessage(chatId);
  if (action !== "new" && (!last || last.id !== opts.messageId || last.role !== "assistant")) throw new HttpError(400, "Only the latest reply can be swiped or continued");

  const prepared =
    action === "new"
      ? await prepare(chatId, "story", { feedback: opts.feedback, profileId: opts.profileId })
      : action === "swipe"
        ? await prepare(chatId, "story", { excludeMessageId: last!.id, feedback: opts.feedback, profileId: opts.profileId })
        : await prepare(chatId, "continue", { feedback: opts.feedback, profileId: opts.profileId });
  // A used-up subscription quota is explained plainly, with paid options only on your tap (CONN-20).
  assertQuota(prepared.resolved.billing);
  if (activeGenerations(chatId).length) throw new HttpError(409, "A reply is already being written in this chat");

  let messageId: string;
  let swipeIdx: number;
  let baseText = "";
  if (action === "new") {
    messageId = addMessage(chatId, "assistant", "", { name: prepared.card.name, status: "streaming" });
    swipeIdx = 0;
  } else if (action === "swipe") {
    messageId = last!.id;
    swipeIdx = addSwipe(last!.id);
  } else {
    messageId = last!.id;
    swipeIdx = last!.active_swipe;
    baseText = getSwipes(last!.id).find((s) => s.idx === swipeIdx)?.content ?? "";
    updateSwipe(messageId, swipeIdx, { status: "streaming" });
  }
  if (prepared.assembled.evictedThrough != null) setMemState(chatId, { evictedThrough: prepared.assembled.evictedThrough });

  const swipeId = getSwipes(messageId).find((s) => s.idx === swipeIdx)?.id;
  const generationId = requestFor(prepared, { chatId, messageId, swipeId, kind: action });
  const gen: ActiveGeneration = { id: generationId, chatId, messageId, swipeIdx, abort: new AbortController(), text: baseText, reasoning: "" };
  active.set(generationId, gen);
  publish({ type: "gen.start", chatId, messageId, swipeIdx, generationId });
  void runStory(gen, prepared, action, baseText, opts.feedback, opts.auto);
  return { generationId, messageId, swipeIdx };
}

async function runStory(gen: ActiveGeneration, first: Prepared, action: StoryAction, baseText: string, feedback?: string, auto?: string) {
  const startedAt = now();
  let p = first;
  let firstTokenAt: number | null = null;
  let pendingText = "";
  let pendingReasoning = "";
  let first_ = true;
  const flush = () => {
    if (!pendingText && !pendingReasoning) return;
    publish({ type: "gen.delta", chatId: gen.chatId, messageId: gen.messageId, generationId: gen.id, text: pendingText, reasoning: pendingReasoning || undefined });
    pendingText = "";
    pendingReasoning = "";
  };
  const flushTimer = setInterval(flush, 50);
  const saveTimer = setInterval(() => updateSwipe(gen.messageId, gen.swipeIdx, { content: gen.text, reasoning: gen.reasoning || null }), 1000);

  let status: "done" | "stopped" | "error" = "done";
  let error: string | undefined;
  let usage: Usage | undefined;
  let finishReason: string | undefined;
  let sentBody: unknown;
  let requestId = gen.id;
  const chain = (() => {
    try {
      return resolveTaskChain("story", p.resolved.profile.id).slice(1);
    } catch {
      return [];
    }
  })();
  let overflowRetried = false;
  let smartRetried = false;
  let backedOff = false;
  const notes: string[] = [];

  try {
    for (;;) {
      // First-token timeout (CONN-05): a stuck route moves on to the next model.
      const attempt = new AbortController();
      let timedOut = false;
      const onUserAbort = () => attempt.abort();
      gen.abort.signal.addEventListener("abort", onUserAbort);
      const timeoutMs = getSetting("routing.timeouts").story * 1000;
      const timer = setTimeout(() => {
        if (firstTokenAt == null) {
          timedOut = true;
          attempt.abort();
        }
      }, timeoutMs);
      try {
        const result = await p.resolved.provider.stream(
          { model: p.resolved.modelId, messages: p.assembled.messages, params: p.samplers, signal: attempt.signal, cache: p.cache },
          (d) => {
            firstTokenAt ??= now();
            if (d.reasoning) {
              gen.reasoning += d.reasoning;
              pendingReasoning += d.reasoning;
            }
            if (d.text) {
              let t = d.text;
              if (first_ && action === "continue") {
                if (baseText && !/\s$/.test(baseText) && /^[\p{L}\p{N}"'*(]/u.test(t)) t = ` ${t}`;
                first_ = false;
              } else if (first_) {
                t = t.replace(/^\s+/, "");
                if (t) first_ = false;
              }
              gen.text += t;
              pendingText += t;
            }
          },
        );
        usage = result.usage;
        finishReason = result.finishReason;
        sentBody = result.sentBody;
        // CONN-09: an empty reply or a refusal gets one more try (the next model in the chain if there is one).
        const written = gen.text.slice(baseText.length);
        const retry = getSetting("chat.retry");
        const why = !written.trim() && retry.empty ? "empty reply" : retry.refusal && looksLikeRefusal(written) ? "refusal" : null;
        if (why && !smartRetried && !gen.abort.signal.aborted) {
          smartRetried = true;
          finishRequest(requestId, { status: "error", error: `retried: ${why}`, usage, firstTokenAt, sentBody, pricing: p.resolved.pricing, billing: p.resolved.billing });
          const next = chain.shift();
          if (next) p = await prepare(gen.chatId, action === "continue" ? "continue" : "story", { excludeMessageId: action === "swipe" ? gen.messageId : undefined, feedback, profileId: next.profile.id });
          notes.push(`retried after ${why}${next ? ` with ${next.profile.name}` : ""}`);
          gen.text = baseText;
          first_ = true;
          firstTokenAt = null;
          publish({ type: "gen.delta", chatId: gen.chatId, messageId: gen.messageId, generationId: gen.id, text: "", reset: true });
          requestId = requestFor(p, { chatId: gen.chatId, messageId: gen.messageId, kind: action });
          continue;
        }
        break;
      } catch (e) {
        if (gen.abort.signal.aborted) throw e;
        const err = timedOut ? new ProviderError(`No reply within ${Math.round(timeoutMs / 1000)} s`) : e;
        const nothingYet = firstTokenAt == null && !gen.text.slice(baseText.length);
        if (!(err instanceof ProviderError) || !nothingYet) throw err;
        // CTX-08: the provider says the prompt is too long. Learn the limit, shrink, and retry once.
        if (err.kind === "overflow" && !overflowRetried) {
          overflowRetried = true;
          const limit = contextLimitFromError(`${err.message} ${err.body ?? ""}`);
          if (limit) learnContextLimit(p.resolved.connection.id, p.resolved.modelId, limit);
          finishRequest(requestId, { status: "error", error: err.message });
          p = await prepare(gen.chatId, action === "continue" ? "continue" : "story", {
            excludeMessageId: action === "swipe" ? gen.messageId : undefined,
            feedback,
            profileId: p.resolved.profile.id,
            targetScale: limit ? undefined : 0.75,
          });
          notes.push("prompt shrunk after a length error");
          requestId = requestFor(p, { chatId: gen.chatId, messageId: gen.messageId, kind: action });
          continue;
        }
        // CONN-09: a server error gets one quick retry on the same model before moving down the chain.
        if (err.retryable && !backedOff && getSetting("chat.retry").serverErrors) {
          backedOff = true;
          finishRequest(requestId, { status: "error", error: err.message });
          await Bun.sleep(1500);
          if (gen.abort.signal.aborted) throw err;
          notes.push(`retried after: ${err.message.slice(0, 60)}`);
          requestId = requestFor(p, { chatId: gen.chatId, messageId: gen.messageId, kind: action });
          continue;
        }
        // CONN-05: try the next model in the story chain.
        const next = chain.shift();
        if ((err.retryable || err.kind === "refused") && next) {
          finishRequest(requestId, { status: "error", error: err.message });
          p = await prepare(gen.chatId, action === "continue" ? "continue" : "story", { excludeMessageId: action === "swipe" ? gen.messageId : undefined, feedback, profileId: next.profile.id });
          notes.push(`fell back to ${next.profile.name} (${err.message.slice(0, 80)})`);
          requestId = requestFor(p, { chatId: gen.chatId, messageId: gen.messageId, kind: action });
          continue;
        }
        throw err;
      } finally {
        clearTimeout(timer);
        gen.abort.signal.removeEventListener("abort", onUserAbort);
      }
    }
  } catch (e) {
    if ((e as Error).name === "AbortError" || gen.abort.signal.aborted) status = "stopped";
    else {
      status = "error";
      error = e instanceof ProviderError || e instanceof HttpError ? e.message : `Something went wrong: ${(e as Error).message}`;
      if (e instanceof ProviderError && e.kind === "quota") error = `${e.message} — your subscription quota may be used up.`;
    }
  } finally {
    clearInterval(flushTimer);
    clearInterval(saveTimer);
    flush();
    for (const [k, g] of active) if (g === gen) active.delete(k);
  }

  let text = gen.text.trimEnd();
  // Inline trackers: the <ledger> block comes out of the reply before it's saved.
  let ledgerRaw: string | null = null;
  const inline = p.trackers?.inline && status !== "error";
  if (inline) {
    const at = text.search(/<ledger\b/i);
    if (at >= 0) {
      ledgerRaw = text.slice(at);
      text = text.slice(0, at).trimEnd();
    }
  }
  // CHAT-14: a reply cut off by the length limit is trimmed to its last sentence, or continued.
  const cutoff = getSetting("chat.cutoff");
  const cutOff = status === "done" && finishReason === "length";
  if (cutOff && cutoff === "trim") text = trimUnfinished(text);
  // CHAT-19: banned phrases.
  const banned = status !== "error" ? applyBanned(text) : { text, hits: [], replaced: 0 };
  text = banned.text;
  const finalStatus = status === "error" && action === "continue" ? "done" : status === "error" && text ? "stopped" : status;
  updateSwipe(gen.messageId, gen.swipeIdx, {
    content: text,
    reasoning: gen.reasoning || null,
    status: finalStatus,
    error: status === "error" ? (error ?? "Unknown error") : null,
    meta: {
      generationId: requestId,
      model: p.resolved.modelId,
      connectionId: p.resolved.connection.id,
      connectionName: p.resolved.connection.name,
      profileId: p.resolved.profile.id,
      profileName: p.resolved.profile.name,
      presetId: p.presetId,
      billing: p.resolved.billing,
      promptTokens: usage?.promptTokens ?? null,
      completionTokens: usage?.completionTokens ?? null,
      cachedTokens: usage?.cachedTokens ?? null,
      estPromptTokens: p.assembled.estPromptTokens,
      ttftMs: firstTokenAt ? firstTokenAt - startedAt : null,
      durationMs: now() - startedAt,
      finishReason: finishReason ?? null,
      ...(notes.length ? { notes } : {}),
      ...(feedback ? { feedback } : {}),
      ...(banned.hits.length ? { banned: banned.hits } : {}),
      ...(ledgerRaw ? { ledger: ledgerRaw.slice(0, 6000) } : {}),
      ...(cutOff ? { cutOff: true } : {}),
    },
  });
  finishRequest(requestId, { status, error, usage, firstTokenAt, sentBody, pricing: p.resolved.pricing, billing: p.resolved.billing });
  publish({ type: "gen.end", chatId: gen.chatId, messageId: gen.messageId, generationId: requestId, status: finalStatus, error });
  publish({ type: "message.changed", chatId: gen.chatId, messageId: gen.messageId });

  if (status !== "error") {
    try {
      consumeOnce(gen.chatId);
      if (inline) fileInlineLedger(gen.chatId, gen.messageId, gen.swipeIdx, ledgerRaw);
      else if (status === "done") scheduleTrackers(gen.chatId, gen.messageId, gen.swipeIdx);
    } catch (e) {
      console.error("[mea] after-reply step failed:", e);
    }
    saveLoreState(gen.chatId, p.lore.stateUpdates);
    setChatVars(gen.chatId, p.assembled.vars);
    recordMemoryUsage(requestId, gen.chatId, p);
    const chat = mustChat(gen.chatId);
    if (chat.character_id) touchCharacter(chat.character_id);
  }
  if (usage?.promptTokens) recordCalibration(p.resolved.connection.id, p.resolved.modelId, p.assembled.estPromptTokens, usage.promptTokens);
  if (p.resolved.billing === "subscription") enqueue("quota.refresh", {}, { dedupeKey: "quota.refresh", delayMs: 3000 });
  // A finished turn may have settled older messages: let memory catch up in the background (SUM-07).
  scheduleMemory(gen.chatId);
  // CHAT-14 / CHAT-19: follow-ups that start a new generation once this one is saved.
  if (status === "done" && cutOff && cutoff === "continue" && auto !== "continue") {
    setTimeout(() => void startStory(gen.chatId, "continue", { messageId: gen.messageId, auto: "continue" }).catch(() => {}), 50);
  } else if (status === "done" && banned.hits.length && getSetting("chat.banned").action === "regenerate" && !auto) {
    setTimeout(() => void startStory(gen.chatId, "swipe", { messageId: gen.messageId, auto: "banned" }).catch(() => {}), 50);
  }
  if (status === "done" && !isChatWatched(gen.chatId)) {
    void sendPush({ title: p.card.name, body: text.replace(/\s+/g, " ").slice(0, 140), url: `/chat/${gen.chatId}`, tag: gen.chatId }).catch(() => {});
  }
}

/** Impersonate / expand: a draft for the composer, streamed straight back (CHAT-05). Not saved as a message. */
export async function* streamDraft(chatId: string, kind: "impersonate" | "expand", draft: string | undefined, signal: AbortSignal): AsyncGenerator<{ text?: string; done?: boolean; error?: string }> {
  const p = await prepare(chatId, kind, { draft });
  assertQuota(p.resolved.billing);
  const genId = requestFor(p, { chatId, kind });
  const queue: string[] = [];
  let wake: (() => void) | null = null;
  let finished = false;
  let failure: string | undefined;
  let usage: Usage | undefined;
  let firstTokenAt: number | null = null;
  const abort = new AbortController();
  signal.addEventListener("abort", () => abort.abort());
  const params: GenerationParams = { ...p.samplers, max_tokens: Math.min(p.samplers.max_tokens ?? 600, 800) };
  p.resolved.provider
    .stream({ model: p.resolved.modelId, messages: p.assembled.messages, params, signal: abort.signal, cache: p.cache }, (d) => {
      if (d.text) {
        firstTokenAt ??= now();
        queue.push(d.text);
        wake?.();
      }
    })
    .then((r) => (usage = r.usage))
    .catch((e) => {
      if ((e as Error).name !== "AbortError") failure = (e as Error).message;
    })
    .finally(() => {
      finished = true;
      wake?.();
    });

  let started = false;
  while (true) {
    while (queue.length) {
      let t = queue.shift()!;
      if (!started) {
        t = t.replace(/^\s+/, "");
        if (!t) continue;
        started = true;
      }
      yield { text: t };
    }
    if (finished) break;
    await new Promise<void>((r) => (wake = r));
    wake = null;
  }
  finishRequest(genId, { status: failure ? "error" : abort.signal.aborted ? "stopped" : "done", error: failure, usage, firstTokenAt, pricing: p.resolved.pricing, billing: p.resolved.billing });
  if (p.resolved.billing === "subscription") enqueue("quota.refresh", {}, { dedupeKey: "quota.refresh", delayMs: 3000 });
  yield failure ? { error: failure, done: true } : { done: true };
}

/** Dry run of the next story request for the inspector (DBG-01). */
export async function previewPrompt(chatId: string) {
  const p = await prepare(chatId, "story");
  return {
    model: p.resolved.modelId,
    profile: p.resolved.profile.name,
    connection: p.resolved.connection.name,
    billing: p.resolved.billing,
    params: p.samplers,
    messages: p.assembled.messages,
    trace: p.assembled.trace,
    estPromptTokens: p.assembled.estPromptTokens,
    cacheMarks: p.assembled.cacheMarks,
    cacheMode: p.cache?.mode ?? null,
  };
}

/** Warms retrieval while you type (CTX-10, MEM-20): the query embedding is cached for the send. */
export async function prefetch(chatId: string, draft: string) {
  if (!memoryConfig().enabled || !embeddingsEnabled()) return { warmed: false };
  const history = historyForPrompt(chatId);
  await embedQuery(queryText(history, draft.trim()));
  return { warmed: true };
}

export function getGeneration(id: string) {
  return getRequest(id);
}

export function messageIsStreaming(messageId: string) {
  const m = getMessageRow(messageId);
  return Boolean(m && [...active.values()].some((g) => g.messageId === messageId));
}
