import type { CardData } from "../cards/card";
import { newId, now, one, run } from "../db/db";
import { publish } from "../lib/events";
import { HttpError, notFound } from "../lib/http";
import { getSetting } from "../lib/settings";
import { activateLore, type ActivationResult } from "../lore/activate";
import { loadLoreState, saveLoreState, scanEntriesFor } from "../lore/service";
import { type AssembleKind, type AssembleResult, assemblePrompt } from "../prompt/assemble";
import { expandMacros } from "../prompt/macros";
import { countTokens } from "../lib/tokens";
import { ProviderError, type GenerationParams } from "../providers/types";
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
import { resolveProfile } from "./connections";
import { enqueue } from "./jobs";
import { getDefaultPersona, getPersona, personaPrompt } from "./personas";
import { isChatWatched } from "./presence";
import { resolvePreset } from "./presets";
import { sendPush } from "./push";
import { parseJson } from "../db/db";

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
  resolved: ReturnType<typeof resolveProfile>;
  presetId: string;
  samplers: GenerationParams;
  assembled: AssembleResult;
  lore: ActivationResult;
}

/** Gathers everything for one request: card, persona, preset, profile, lore, prompt. */
export function prepare(chatId: string, kind: AssembleKind, opts: { excludeMessageId?: string; draft?: string; feedback?: string } = {}): Prepared {
  const chat = mustChat(chatId);
  if (!chat.character_id) throw new HttpError(400, "This chat has no character");
  const charRow = getCharacterRow(chat.character_id);
  const card = getCard(chat.character_id);
  if (!charRow || !card) throw notFound("Character not found");
  const persona = getPersona(chat.persona_id) ?? getDefaultPersona();
  const userName = persona?.name ?? "You";
  const settings = parseJson<ChatSettings>(chat.settings, {});
  const preset = resolvePreset(settings.presetId);
  const resolved = resolveProfile(settings.profileId);
  const history = historyForPrompt(chatId, { excludeMessageId: opts.excludeMessageId });

  const substitute = (s: string) => expandMacros(s, { char: card.name, user: userName, vars: {}, mode: chat.mode });
  const loreDefaults = getSetting("lore.defaults");
  const lore = activateLore({
    entries: scanEntriesFor({ characterId: chat.character_id, personaId: persona?.id ?? null, chatId }),
    history: history.map((m) => `${m.role === "user" ? userName : m.role === "assistant" ? card.name : "Note"}: ${m.content}`),
    messageCount: messageCountOf(chatId),
    state: loadLoreState(chatId),
    defaults: loreDefaults,
    countTokens,
    substitute,
  });

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
    contextTarget: resolved.contextTarget,
    modelId: resolved.modelId,
    vars: parseJson<Record<string, string>>(chat.vars, {}),
    seed: chatId,
    draft: opts.draft,
    feedback: opts.feedback,
  });

  // Preset samplers are defaults; the profile's tuning for this model wins.
  const samplers: GenerationParams = { ...preset.samplers, ...resolved.params };
  return { card, userName, resolved, presetId: preset.id, samplers, assembled, lore };
}

function insertGenerationRow(p: Prepared, ids: { chatId: string; messageId?: string; swipeId?: string; kind: string }) {
  const id = newId();
  run(
    `INSERT INTO generations (id, chat_id, message_id, swipe_id, kind, task, connection_id, model_id, billing, request, trace, est_prompt_tokens, status, started_at)
     VALUES (?, ?, ?, ?, ?, 'story', ?, ?, ?, ?, ?, ?, 'running', ?)`,
    id,
    ids.chatId,
    ids.messageId ?? null,
    ids.swipeId ?? null,
    ids.kind,
    p.resolved.connection.id,
    p.resolved.modelId,
    p.resolved.billing,
    JSON.stringify({ model: p.resolved.modelId, messages: p.assembled.messages, params: p.samplers }),
    JSON.stringify(p.assembled.trace),
    p.assembled.estPromptTokens,
    now(),
  );
  return id;
}

function finishGenerationRow(id: string, r: { status: string; error?: string; usage?: { promptTokens?: number; completionTokens?: number; cachedTokens?: number }; firstTokenAt?: number | null; sentBody?: unknown }) {
  run(
    `UPDATE generations SET status = ?, error = ?, prompt_tokens = ?, completion_tokens = ?, cached_tokens = ?, first_token_at = ?, finished_at = ?,
       request = COALESCE(?, request) WHERE id = ?`,
    r.status,
    r.error ?? null,
    r.usage?.promptTokens ?? null,
    r.usage?.completionTokens ?? null,
    r.usage?.cachedTokens ?? null,
    r.firstTokenAt ?? null,
    now(),
    r.sentBody ? JSON.stringify(r.sentBody) : null,
    id,
  );
}

export type StoryAction = "new" | "swipe" | "continue";

/** Starts a story generation and returns immediately; tokens arrive over the event stream (ARCH-02, ARCH-06). */
export function startStory(chatId: string, action: StoryAction, opts: { messageId?: string; feedback?: string } = {}) {
  if (activeGenerations(chatId).length) throw new HttpError(409, "A reply is already being written in this chat");
  const last = lastMessage(chatId);
  let messageId: string;
  let swipeIdx: number;
  let baseText = "";
  let prepared: Prepared;

  if (action === "new") {
    prepared = prepare(chatId, "story", { feedback: opts.feedback });
    messageId = addMessage(chatId, "assistant", "", { name: prepared.card.name, status: "streaming" });
    swipeIdx = 0;
  } else {
    if (!last || last.id !== opts.messageId || last.role !== "assistant") throw new HttpError(400, "Only the latest reply can be swiped or continued");
    if (action === "swipe") {
      prepared = prepare(chatId, "story", { excludeMessageId: last.id, feedback: opts.feedback });
      messageId = last.id;
      swipeIdx = addSwipe(last.id);
    } else {
      prepared = prepare(chatId, "continue", { feedback: opts.feedback });
      messageId = last.id;
      swipeIdx = last.active_swipe;
      baseText = getSwipes(last.id).find((s) => s.idx === swipeIdx)?.content ?? "";
      updateSwipe(messageId, swipeIdx, { status: "streaming" });
    }
  }

  const swipeId = getSwipes(messageId).find((s) => s.idx === swipeIdx)?.id;
  const generationId = insertGenerationRow(prepared, { chatId, messageId, swipeId, kind: action });
  const gen: ActiveGeneration = { id: generationId, chatId, messageId, swipeIdx, abort: new AbortController(), text: baseText, reasoning: "" };
  active.set(generationId, gen);
  publish({ type: "gen.start", chatId, messageId, swipeIdx, generationId });
  void runStory(gen, prepared, action, baseText, opts.feedback);
  return { generationId, messageId, swipeIdx };
}

async function runStory(gen: ActiveGeneration, p: Prepared, action: StoryAction, baseText: string, feedback?: string) {
  const startedAt = now();
  let firstTokenAt: number | null = null;
  let pendingText = "";
  let pendingReasoning = "";
  let first = true;
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
  let usage: { promptTokens?: number; completionTokens?: number; cachedTokens?: number } | undefined;
  let finishReason: string | undefined;
  let sentBody: unknown;
  try {
    const result = await p.resolved.provider.stream(
      { model: p.resolved.modelId, messages: p.assembled.messages, params: p.samplers, signal: gen.abort.signal },
      (d) => {
        firstTokenAt ??= now();
        if (d.reasoning) {
          gen.reasoning += d.reasoning;
          pendingReasoning += d.reasoning;
        }
        if (d.text) {
          let t = d.text;
          if (first && action === "continue") {
            if (baseText && !/\s$/.test(baseText) && /^[\p{L}\p{N}"'*(]/u.test(t)) t = ` ${t}`;
            first = false;
          } else if (first) {
            t = t.replace(/^\s+/, "");
            if (t) first = false;
          }
          gen.text += t;
          pendingText += t;
        }
      },
    );
    usage = result.usage;
    finishReason = result.finishReason;
    sentBody = result.sentBody;
  } catch (e) {
    if ((e as Error).name === "AbortError" || gen.abort.signal.aborted) status = "stopped";
    else {
      status = "error";
      error = e instanceof ProviderError || e instanceof HttpError ? e.message : `Something went wrong: ${(e as Error).message}`;
    }
  } finally {
    clearInterval(flushTimer);
    clearInterval(saveTimer);
    flush();
    active.delete(gen.id);
  }

  const text = gen.text.trimEnd();
  const finalStatus = status === "error" && action === "continue" ? "done" : status === "error" && text ? "stopped" : status;
  updateSwipe(gen.messageId, gen.swipeIdx, {
    content: text,
    reasoning: gen.reasoning || null,
    status: finalStatus,
    error: status === "error" ? (error ?? "Unknown error") : null,
    meta: {
      generationId: gen.id,
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
      ...(feedback ? { feedback } : {}),
    },
  });
  finishGenerationRow(gen.id, { status, error, usage, firstTokenAt, sentBody });
  publish({ type: "gen.end", chatId: gen.chatId, messageId: gen.messageId, generationId: gen.id, status: finalStatus, error });
  publish({ type: "message.changed", chatId: gen.chatId, messageId: gen.messageId });

  if (status !== "error") {
    saveLoreState(gen.chatId, p.lore.stateUpdates);
    setChatVars(gen.chatId, p.assembled.vars);
    const chat = mustChat(gen.chatId);
    if (chat.character_id) touchCharacter(chat.character_id);
  }
  if (p.resolved.billing === "subscription") enqueue("quota.refresh", {}, { dedupeKey: "quota.refresh", delayMs: 3000 });
  if (status === "done" && !isChatWatched(gen.chatId)) {
    void sendPush({ title: p.card.name, body: text.replace(/\s+/g, " ").slice(0, 140), url: `/chat/${gen.chatId}`, tag: gen.chatId }).catch(() => {});
  }
}

/** Impersonate / expand: a draft for the composer, streamed straight back (CHAT-05). Not saved as a message. */
export async function* streamDraft(chatId: string, kind: "impersonate" | "expand", draft: string | undefined, signal: AbortSignal): AsyncGenerator<{ text?: string; done?: boolean; error?: string }> {
  const p = prepare(chatId, kind, { draft });
  const genId = insertGenerationRow(p, { chatId, kind });
  const queue: string[] = [];
  let wake: (() => void) | null = null;
  let finished = false;
  let failure: string | undefined;
  let usage: { promptTokens?: number; completionTokens?: number; cachedTokens?: number } | undefined;
  let firstTokenAt: number | null = null;
  const abort = new AbortController();
  signal.addEventListener("abort", () => abort.abort());
  const params: GenerationParams = { ...p.samplers, max_tokens: Math.min(p.samplers.max_tokens ?? 600, 800) };
  p.resolved.provider
    .stream({ model: p.resolved.modelId, messages: p.assembled.messages, params, signal: abort.signal }, (d) => {
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
  finishGenerationRow(genId, { status: failure ? "error" : abort.signal.aborted ? "stopped" : "done", error: failure, usage, firstTokenAt });
  if (p.resolved.billing === "subscription") enqueue("quota.refresh", {}, { dedupeKey: "quota.refresh", delayMs: 3000 });
  yield failure ? { error: failure, done: true } : { done: true };
}

/** Dry run of the next story request for the inspector (DBG-01). */
export function previewPrompt(chatId: string) {
  const p = prepare(chatId, "story");
  return {
    model: p.resolved.modelId,
    profile: p.resolved.profile.name,
    connection: p.resolved.connection.name,
    billing: p.resolved.billing,
    params: p.samplers,
    messages: p.assembled.messages,
    trace: p.assembled.trace,
    estPromptTokens: p.assembled.estPromptTokens,
  };
}

export function getGeneration(id: string) {
  const r = one<Record<string, unknown> & { request: string | null; trace: string | null }>("SELECT * FROM generations WHERE id = ?", id);
  if (!r) return undefined;
  return { ...r, request: parseJson(r.request, null), trace: parseJson(r.trace, null) };
}

export function messageIsStreaming(messageId: string) {
  const m = getMessageRow(messageId);
  return Boolean(m && [...active.values()].some((g) => g.messageId === messageId));
}
