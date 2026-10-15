import type { CardData } from "../cards/card";
import { applyRegex } from "../lib/regex";
import { all, now, one, parseJson, run } from "../db/db";
import { publish } from "../lib/events";
import { HttpError, notFound } from "../lib/http";
import { getSetting, memoryConfig } from "../lib/settings";
import { countTokens } from "../lib/tokens";
import { activateLore, type ActivationResult } from "../lore/activate";
import { loadLoreState, saveLoreState, scanEntriesFor } from "../lore/service";
import { CANON_RULE } from "../memory/canon";
import { buildMemoryContext, emptyInputs, memoryInputs } from "../memory/context";
import { embeddingsEnabled, embedQueries } from "../memory/embed";
import { resolver } from "../memory/entities";
import { reinforce } from "../memory/reinforce";
import { anySemantic, semanticScorer } from "../lore/semantic";
import { recordLoreHits } from "../lore/health";
import { warmMemory } from "../memory/warm";
import { ledgerChangedAfterReply, scheduleMemory } from "../memory/scheduler";
import { setMemState } from "../memory/store";
import { type AssembleKind, type AssembleResult, assemblePrompt, type HistoryMessage } from "../prompt/assemble";
import { expandMacros } from "../prompt/macros";
import { contextLimitFromError, INCOMPLETE, ProviderError, type CacheHint, type GenerationParams, type Usage } from "../providers/types";
import { getCard, getCharacterRow, touchCharacter } from "./characters";
import {
  addMessage,
  addSwipe,
  type ChatSettings,
  getChatRow,
  getMessageRow,
  deleteSwipe,
  getSwipes,
  historyForPrompt,
  lastMessage,
  messageCountOf,
  mustChat,
  setChatVars,
  updateSwipe,
} from "./chats";
import { learnContextLimit, recordCalibration, type ResolvedProfile, resolveProfile, resolveTaskChain } from "./connections";
import { enqueue, waitForChatJobs } from "./jobs";
import { getDefaultPersona, getPersona, personaPrompt } from "./personas";
import { isChatWatched } from "./presence";
import { layered, presetForRequest } from "./layers";
import { applyCardVariant, applyPersonaVariant, getVariant } from "./variants";
import { sendPush } from "./push";
import { assertQuota } from "./quota";
import { applyBanned, chatExtras, consumeOnce, cutFourthWall, looksLikeRefusal, trimUnfinished } from "./chattools";
import { evalCondition } from "../trackers/condition";
import type { WorldState } from "../trackers/types";
import { fileInlineLedger, scheduleTrackers, trackerPrompt } from "../trackers/service";
import type { PromptExtra } from "../prompt/assemble";
import { gatherLanes } from "../prompt/lanes";
import { offpageFilter } from "../accuracy/offpage";
import { craftOn, craftReport } from "../steer/craft";
import { angleNote, type Angle, digestNote, keptPrefix, rejectedDigest, takeShape as rejectedShape } from "../steer/swipes";
import { finishRequest, getRequest, startRequest } from "./requests";
import { anchorExtra } from "../accuracy/anchor";
import { checksOn } from "../accuracy/checker";
import { scheduleDrift } from "../accuracy/drift";
import { applyGuards } from "../accuracy/guards";
import { advisorExtra, directorPlanText, markPlanUsed, planSchema, runAdvisor, turnKey } from "../steer/advisor";
import { scheduleEditor } from "../steer/editor";
import { normalizeQuotes, styleExtra, styleFor } from "../steer/style";
import { extractSpeakers, quotedLines, rosterLine, type RosterVoice, speakerRule, type SpokenLine, voiceRoster, withoutSpeakerMarks, withSpeakerMarks } from "../lib/speakers";
import { scheduleSpeakerMarks } from "./speakermarks";

/** M18: a stream that sends nothing new for this long is treated as stalled. */
const IDLE_MS = 90_000;
/** How long a reply you send waits for the trackers to finish reading the last one (it goes ahead after). */
export const TRACKER_WAIT_MS = 6000;
/** M18: the longest Retry-After Mea waits before its one quick retry. */
const RETRY_AFTER_CAP_MS = 30_000;

/** M17: a leading <think>…</think> block (inline reasoning from OpenAI-style routes) moves out of the story. */
export function splitThink(text: string): { text: string; reasoning: string } {
  const m = text.match(/^\s*<(think|thinking|plan|reasoning)>([\s\S]*?)(?:<\/\1>|$)\s*/i);
  if (!m) return { text, reasoning: "" };
  return { text: text.slice(m[0].length), reasoning: m[2]!.trim() };
}

const THINK_OPEN = ["<think>", "<thinking>", "<plan>", "<reasoning>"];

/**
 * Mea's preset has models without provider reasoning plan inside a leading <think> block. This
 * routes that block to the reasoning field while the reply streams, so it never shows in the story.
 * Call it with each text chunk; `end()` returns whatever is still held back when the stream ends.
 */
export function thinkRouter() {
  let state: "start" | "in" | "out" = "start";
  let buf = "";
  let close = "";
  const push = (chunk: string): { text: string; reasoning: string } => {
    if (state === "out") return { text: chunk, reasoning: "" };
    buf += chunk;
    if (state === "start") {
      const lead = buf.replace(/^\s+/, "");
      const lower = lead.toLowerCase();
      const open = THINK_OPEN.find((t) => lower.startsWith(t));
      if (open) {
        state = "in";
        close = `</${open.slice(1)}`;
        buf = lead.slice(open.length);
      } else if (!lead || THINK_OPEN.some((t) => t.startsWith(lower))) {
        return { text: "", reasoning: "" };
      } else {
        state = "out";
        const t = buf;
        buf = "";
        return { text: t, reasoning: "" };
      }
    }
    const at = buf.toLowerCase().indexOf(close);
    if (at >= 0) {
      const reasoning = buf.slice(0, at);
      const text = buf.slice(at + close.length).replace(/^\s+/, "");
      state = "out";
      buf = "";
      return { text, reasoning };
    }
    // Hold back what could be the start of the closing tag.
    let keep = 0;
    for (let n = Math.min(close.length - 1, buf.length); n > 0; n--) {
      if (close.startsWith(buf.slice(-n).toLowerCase())) {
        keep = n;
        break;
      }
    }
    const reasoning = buf.slice(0, buf.length - keep);
    buf = buf.slice(buf.length - keep);
    return { text: "", reasoning };
  };
  const end = (): { text: string; reasoning: string } => {
    const rest = buf;
    buf = "";
    if (state === "in") return { text: "", reasoning: rest };
    state = "out";
    return { text: rest, reasoning: "" };
  };
  return { push, end };
}

/** The plan watch: a "plan" shorter than this is a one-line outline, not the pass. */
const PLAN_MIN_WORDS = 15;

const PLAN_HEADER = /^\s*(?:\*\*|#+\s*)?(?:NOW|SEAL|KNOW|MINDS|WORLD|MOVE|RISK|VOICE)(?:\*\*)?\s*[—–:-]/;

/**
 * M17: a model that can't reason privately sometimes writes the planning pass out. A reply that opens
 * with two or more of its step headers (NOW —, SEAL —, …) has that block moved to the reasoning field.
 */
export function splitLeakedPlan(text: string): { text: string; reasoning: string } {
  const lines = text.split("\n");
  let headers = 0;
  let end = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (PLAN_HEADER.test(line)) {
      headers++;
      end = i;
    } else if (!line.trim() || /^\s*\[BEFORE YOU WRITE[^\]]*\]\s*$/i.test(line) || (headers > 0 && /^\s+\S|^\s*[-*•]\s/.test(line))) {
      if (headers > 0 && line.trim()) end = i;
    } else break;
  }
  if (headers < 2) return { text, reasoning: "" };
  return { text: lines.slice(end + 1).join("\n").replace(/^\s+/, ""), reasoning: lines.slice(0, end + 1).join("\n").trim() };
}

/**
 * The plan-only watch: a reply that is nothing but its planning pass (in <think>, written out, or
 * in the provider's reasoning) and no story. Returns that plan, or null when there is a story.
 */
export function planOnly(text: string, reasoning: string): string | null {
  let story = text;
  let plan = reasoning;
  for (const split of [splitThink, splitLeakedPlan]) {
    const out = split(story);
    if (out.reasoning) {
      story = out.text;
      plan = [plan, out.reasoning].filter(Boolean).join("\n\n");
    }
  }
  if (story.replace(/^\s*<\/(?:think|thinking|plan|reasoning)>/i, "").trim()) return null;
  plan = plan.trim();
  return plan.split(/\s+/).filter(Boolean).length >= PLAN_MIN_WORDS ? plan : null;
}

/**
 * The plan step's answer: the pass in <think>, written out under its step headers, written as plain
 * lines naming the steps, or (when the text has none) the route's own reasoning. Null when it's
 * too short to be the pass.
 */
export function planFrom(text: string, reasoning: string): string | null {
  const words = (s: string) => s.split(/\s+/).filter(Boolean).length;
  const steps = (s: string) => new Set(s.match(/\b(?:NOW|SEAL|KNOW|MINDS|WORLD|MOVE|RISK|VOICE)\b/g) ?? []).size;
  const tagged = splitThink(text).reasoning;
  const leaked = splitLeakedPlan(text).reasoning;
  const bare = steps(text) >= 3 ? text.replace(/<\/?(?:think|thinking|plan|reasoning)>/gi, "").trim() : "";
  for (const plan of [tagged, leaked, bare, reasoning.trim()]) if (plan && words(plan) >= PLAN_MIN_WORDS) return plan;
  return null;
}

/**
 * A model that has been skipping its plan: one of its last three replies (in any chat) needed the
 * plan step (or, before it, was asked again for skipping). Those plan first, in their own step, so
 * no try is spent and stopped. The skipping is the model's habit, not the chat's, so every story
 * learns it from one (the review of 2026-10-12: 10 of 68 tries were stopped for it).
 * After six replies in a row planned that way, one tries its own pass again, so a model (or a
 * prompt) that learns to plan gets the single request back.
 */
export function skipsPlans(modelId: string, excludeMessageId?: string): boolean {
  const recent = all<{ meta: string }>(
    `SELECT s.meta FROM messages m JOIN swipes s ON s.message_id = m.id AND s.idx = m.active_swipe
     WHERE m.role = 'assistant' AND m.deleted_at IS NULL AND m.id != ? AND json_extract(s.meta, '$.model') = ?
     ORDER BY s.updated_at DESC LIMIT 6`,
    excludeMessageId ?? "",
    modelId,
  ).map((r) => parseJson<{ model?: string; plan?: string; notes?: string[] }>(r.meta, {}));
  if (recent.length === 6 && recent.every((m) => m.plan === "first")) return false;
  const skipped = (m: (typeof recent)[number]) => m.plan === "step" || m.plan === "first" || m.plan === "none" || (m.notes ?? []).some((n) => /skipped its plan/.test(n));
  return recent.slice(0, 3).some(skipped);
}

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
  characterId: string;
  card: CardData;
  userName: string;
  resolved: ResolvedProfile;
  presetId: string;
  samplers: GenerationParams;
  assembled: AssembleResult;
  lore: ActivationResult;
  cache?: CacheHint;
  trackers: { tokens: number; lanes: { name: string; tokens: number; dropped?: boolean }[]; inline: boolean } | null;
  /** STEER-01: the turn the advisor's plan was for (marked used once the reply is written). */
  planKey: string | null;
  /** H3: the planning pass this reply is written from (the separate planner's, or the writer's own from a try that stopped at its plan): shown as its reasoning. */
  plannedPass: string | null;
  /** PERF-10: where the time went before the request was sent, in ms. */
  timing: Timing;
  /** The cast's numbered voices, so each speaker mark is read back as the cast's own name. */
  voices: RosterVoice[];
  /** The reply was asked to mark its speakers. */
  speakerMarks: boolean;
}

export interface Timing {
  totalMs: number;
  trackersMs: number;
  retrievalMs: number;
  loreMs: number;
  advisorMs: number;
  assemblyMs: number;
}

/** The world simulation adds what reaches the scene from off the page (sim/crossings). */
let elsewhereLane: ((chatId: string) => string | undefined) | null = null;
export function setElsewhereLane(fn: (chatId: string) => string | undefined) {
  elsewhereLane = fn;
}

export interface PrepareOptions {
  excludeMessageId?: string;
  /** The plan watch: the last try skipped its planning pass, so this one is told plainly to start with it. */
  forcePlan?: boolean;
  /** The plan-only watch: the last try wrote only its plan, so this one writes the story from it. */
  writtenPlan?: string;
  /** The plan step: this request writes only the planning pass (the story is written from it next). */
  planOnly?: boolean;
  draft?: string;
  feedback?: string;
  /** Use this profile instead of the chat's (fallbacks, or a paid reply you tapped for). */
  profileId?: string | null;
  /** Shrinks the prompt target after an overflow (CTX-08). */
  targetScale?: number;
  /** STEER-01: wait (briefly) for the advisor's plan if it isn't ready. Off for previews. */
  advise?: boolean;
}

/** The history with each of Mea's replies marked again from the speakers saved in its meta. */
function markedHistory(history: HistoryMessage[], roster: RosterVoice[]): HistoryMessage[] {
  const ids = history.filter((m) => m.role === "assistant").map((m) => m.id);
  if (!ids.length) return history;
  const metas = new Map(
    all<{ id: string; meta: string }>(`SELECT m.id, s.meta FROM messages m JOIN swipes s ON s.message_id = m.id AND s.idx = m.active_swipe WHERE m.id IN (${ids.map(() => "?").join(",")})`, ...ids).map((r) => [r.id, r.meta]),
  );
  return history.map((m) => {
    if (m.role !== "assistant") return m;
    const lines = parseJson<{ speakers?: SpokenLine[] }>(metas.get(m.id) ?? "{}", {}).speakers;
    return lines?.length ? { ...m, content: withSpeakerMarks(m.content, lines, roster) } : m;
  });
}

/** The last reply had speech but no speaker marks, so the next one is reminded (ALMANAC's nudge). */
function droppedMarks(history: HistoryMessage[]): boolean {
  const last = history.findLast((m) => m.role === "assistant");
  if (!last || !/["“][^"“”\n]{2,}["”]/.test(last.content)) return false;
  const meta = parseJson<{ speakers?: unknown[]; model?: string }>(one<{ meta: string }>("SELECT s.meta FROM messages m JOIN swipes s ON s.message_id = m.id AND s.idx = m.active_swipe WHERE m.id = ?", last.id)?.meta ?? "{}", {});
  // Only a reply Mea generated (not a card's greeting or an imported message).
  return Boolean(meta.model) && !meta.speakers?.length;
}


/** Gathers everything for one request: card, persona, preset, profile, lore, memory, prompt. */
export async function prepare(chatId: string, kind: AssembleKind, opts: PrepareOptions = {}): Promise<Prepared> {
  // PERF-10: a stopwatch for each stage of putting the prompt together.
  const t0 = performance.now();
  let mark = t0;
  const lap = () => {
    const t = performance.now();
    const ms = t - mark;
    mark = t;
    return Math.round(ms * 10) / 10;
  };
  const chat = mustChat(chatId);
  if (!chat.character_id) throw new HttpError(400, "This chat has no character");
  const charRow = getCharacterRow(chat.character_id);
  const settings = parseJson<ChatSettings>(chat.settings, {});
  // CHAR-06 / PER-05: the chat's variants overlay the card and the persona.
  const baseCard = getCard(chat.character_id);
  const card = baseCard && applyCardVariant(baseCard, getVariant(settings.variantId), chat.character_id);
  if (!charRow || !card) throw notFound("Character not found");
  const persona = applyPersonaVariant(getPersona(chat.persona_id) ?? getDefaultPersona(), getVariant(settings.personaVariantId));
  const userName = persona?.name ?? "You";
  // PROMPT-06: chat → character → global.
  const layers = layered(settings, chat.character_id);
  const resolved = resolveProfile(opts.profileId ?? layers.profileId, opts.profileId ? null : settings.modelOverride);
  // PROMPT-10 per-model prefill, PROMPT-07 controls.
  const { preset: basePreset, controls, values: controlValues } = presetForRequest(layers.presetId, resolved.prefill, layers.controls);
  // One length hint, not two: the chat's own length setting replaces the preset's.
  const preset = settings.length ? { ...basePreset, simple: { ...basePreset.simple, length: "normal" as const } } : basePreset;
  // PROMPT-08: prompt-only regex scripts change what the model is sent, never what's stored.
  // M33: results are cached per message text, and a script that runs long is skipped for this prompt.
  const scripts = getSetting("regex.scripts");
  const regexPass = { slow: new Set<string>() };
  const history = historyForPrompt(chatId, { excludeMessageId: opts.excludeMessageId }).map((m) =>
    m.role === "system" ? m : { ...m, content: applyRegex(m.content, scripts, { role: m.role === "user" ? "user" : "ai", mode: "prompt", characterId: chat.character_id }, regexPass) },
  );
  const cfg = memoryConfig();
  lap();

  const substitute = (s: string) => expandMacros(s, { char: card.name, user: userName, vars: {}, mode: chat.mode });
  const loreDefaults = getSetting("lore.defaults");
  // Trackers (TRK-06): the story state as of the message being written. A reply you send waits a
  // few seconds for the trackers still reading the last one, so it isn't written from the state
  // before it (the clock, the scene, who's there). Previews never wait.
  if (opts.advise)
    await waitForChatJobs(chatId, ["tracker.update", "tracker.init"], { timeoutMs: TRACKER_WAIT_MS, exceptMessageId: opts.excludeMessageId, onWait: () => publish({ type: "gen.prep", chatId, stage: "trackers" }) });
  let tp: ReturnType<typeof trackerPrompt> | null = null;
  try {
    tp = trackerPrompt(chatId, { excludeMessageId: opts.excludeMessageId, kind, elsewhere: elsewhereLane?.(chatId) });
  } catch (e) {
    console.error("[mea] trackers unavailable for this prompt:", e);
  }
  const trackersMs = lap();
  // Speaker marks (while Dialogue colours is on): the cast numbered as voices, {{user}} as 0.
  const marks = (kind === "story" || kind === "continue") && getSetting("appearance.living").voices !== "off";
  const voices = voiceRoster(card.name, userName, Object.values(tp?.state?.chars ?? {}));
  const userSealed = !["director", "full_cast"].includes(controlValues.persona ?? "");
  // TRK-12: lorebook entries with a tracker condition switch on when it holds, and only then.
  const entries = scanEntriesFor({ characterId: chat.character_id, personaId: persona?.id ?? null, chatId }).flatMap((e) => {
    const when = (e.extra as { trackerWhen?: string } | undefined)?.trackerWhen?.trim();
    if (!when) return [e];
    return tp && evalCondition(tp.state, when) ? [{ ...e, constant: true }] : [];
  });
  // Recall inputs (Phase 3): queries, vectors (usually warm from prefetch), point of view, the
  // people in the scene, the librarian's verdict. Nothing here waits long (MEM-21).
  const memInputs = cfg.enabled
    ? await memoryInputs(chatId, { history, draft: kind === "expand" ? opts.draft : undefined, chatMode: chat.mode, state: tp?.state ?? null, names: { char: card.name, user: userName } })
    : emptyInputs();
  let retrievalMs = lap();
  // LORE-05 / LORE-06: lore fires on who's in the scene or just named, and on meaning when an entry opts in.
  const named = memInputs.queries.length ? resolver(chatId).mentionedIn(history.slice(-2).map((m) => m.content).join("\n")).map((e) => e.name) : [];
  let loreVec = memInputs.qvecs[0] ?? null;
  if (!loreVec && anySemantic(entries) && embeddingsEnabled()) loreVec = (await embedQueries([history.slice(-2).map((m) => m.content).join("\n").slice(-2000)], 1500))[0] ?? null;
  const lore = activateLore({
    entries,
    history: history.map((m) => `${m.role === "user" ? userName : m.role === "assistant" ? card.name : "Note"}: ${m.content}`),
    messageCount: messageCountOf(chatId),
    // M31: timers the reply being rewritten (a swipe or continue of it) started don't count against it.
    state: loadLoreState(chatId, { writing: opts.excludeMessageId ?? (kind === "continue" ? lastMessage(chatId)?.id : undefined) }),
    defaults: loreDefaults,
    countTokens,
    substitute,
    splitTriggered: true,
    present: [...memInputs.present, ...named],
    semantic: semanticScorer(loreVec),
    all: entries,
  });
  const loreMs = lap();
  // B1: memory and lore that state a secret kept off the page are reworded before the prompt.
  const offpage = offpageFilter(chatId);
  if (offpage) {
    const pl = lore.placements;
    const each = (xs: string[], where: string) => xs.map((x) => offpage(x, where));
    lore.placements = {
      ...pl,
      before_char: each(pl.before_char, "lore"),
      after_char: each(pl.after_char, "lore"),
      an_top: each(pl.an_top, "lore"),
      an_bottom: each(pl.an_bottom, "lore"),
      ex_top: each(pl.ex_top, "lore"),
      ex_bottom: each(pl.ex_bottom, "lore"),
      triggered: each(pl.triggered, "lore"),
      depth: pl.depth.map((d) => ({ ...d, content: offpage(d.content, "lore") })),
    };
  }

  const contextTarget = Math.floor(resolved.contextTarget * (opts.targetScale ?? 1));
  // Preset samplers are defaults; the profile's tuning for this model wins.
  const samplers: GenerationParams = { ...preset.samplers, ...resolved.params };
  // H3: room for the reply as it will really be asked for (the profile's max_tokens, plus thinking).
  const reserve = resolved.provider.outputTokens?.(resolved.modelId, samplers) ?? samplers.max_tokens ?? 1200;
  // STEER-01: the advisor's private plan for this turn (usually written while you typed).
  const plan =
    kind === "story" && opts.writtenPlan
      ? { id: "advisor", name: "Its own plan", content: directorPlanText(planSchema.parse({ pass: opts.writtenPlan })), depth: 0, planner: true, pass: opts.writtenPlan }
      : kind === "story"
        ? await advisorExtra(chatId, history, { wait: Boolean(opts.advise) })
        : null;
  const style = styleExtra(chatId);
  const advisorMs = lap();
  let memoryMs = 0;

  const assembled = assemblePrompt({
    kind,
    preset,
    card,
    userName,
    personaText: personaPrompt(persona),
    userPronouns: persona?.data.pronouns,
    mode: chat.mode,
    // Earlier replies keep their speaker marks in the prompt, so the model keeps writing them.
    history: marks ? markedHistory(history, voices) : history,
    authorsNote: layers.authorsNote,
    controls,
    controlValues,
    // Blocks with a condition (scene modules) follow the story state as of this reply.
    when: (cond) => (tp ? evalCondition(tp.state, cond) : false),
    swipe: kind === "story" && opts.excludeMessageId ? { rejected: rejectedTake(opts.excludeMessageId) } : undefined,
    lore,
    contextTarget,
    reserve,
    modelId: resolved.modelId,
    providerReasoning: resolved.reasoning,
    vars: parseJson<Record<string, string>>(chat.vars, {}),
    seed: chatId,
    draft: opts.draft,
    feedback: opts.feedback,
    forcePlan: opts.forcePlan,
    planOnly: opts.planOnly,
    // Speaker marks: Mea's preset words the rule in its own block (mea-speakers); this fills it in.
    speakers: marks ? { roster: rosterLine(voices, userSealed), dropped: droppedMarks(history) } : undefined,
    tokenRatio: resolved.tokenRatio,
    filterDepth: cfg.filterDepth,
    // H3: a separate planner (or the writer's last try) planned this reply: the writer's own planning pass is left out.
    skipBlocks: plan?.planner ? ["mea-planning"] : undefined,
    // H1: one ceiling for what Mea adds, cut in the order set in Settings › Memory.
    ceiling: { tokens: cfg.ceiling > 0 ? cfg.ceiling : null, order: cfg.cutOrder, keep: parseJson<ChatSettings>(chat.settings, {}).promptKeep ?? [] },
    extras: [
      // CON-01: one stable rule for which source wins when they disagree.
      // Mea's own Charter states the same order, so it isn't said twice (unless a card prompt replaced the Charter).
      ...((cfg.enabled || tp?.note) && !(preset.builtin === "mea" && preset.blocks.find((b) => b.id === "main")?.enabled && !card.system_prompt?.trim()) ? [{ id: "canon", name: "Canon order", content: CANON_RULE, prefix: true } satisfies PromptExtra] : []),
      ...(tp?.note ? [{ id: "trackers", name: "Story state (trackers)", content: tp.note.text, depth: 1 } satisfies PromptExtra] : []),
      ...(tp?.inline ? [{ id: "ledger", name: "Ledger instructions", content: tp.inline, depth: 0 } satisfies PromptExtra] : []),
      // A preset without that block (one of your own) gets the same rule just before the reply.
      ...(marks && !preset.blocks.some((b) => b.id === "mea-speakers") && !opts.planOnly
        ? [{ id: "speakers", name: "Speaker marks", content: speakerRule(userName, rosterLine(voices, userSealed), userSealed, droppedMarks(history)), depth: 0 } satisfies PromptExtra]
        : []),
      ...chatExtras(chatId, kind, tp?.state ?? null),
      // STEER-04: the style profile joins the stable prefix.
      ...(style ? [style] : []),
      ...(plan ? [(({ planner: _p, pass: _q, ...x }) => x)(plan)] : []),
      // A2: a swipe hears what every earlier take of this reply did, so it doesn't drift back to one.
      ...(kind === "story" && opts.excludeMessageId ? [{ id: "swipe-digest", name: "Earlier takes", content: digestNote(rejectedDigest(opts.excludeMessageId)), depth: 0 } satisfies PromptExtra] : []),
      // P1: the Almanac features' prompt lanes (prompt/lanes.ts), each named in the Inspector.
      ...gatherLanes({ chatId, kind, state: tp?.state ?? null, history, excludeMessageId: opts.excludeMessageId, characterId: chat.character_id }),
      // CON-03: who the character is, near the end of the prompt (stronger while the voice drifts).
      ...(kind === "story" || kind === "continue" ? [anchorExtra(chatId, card, userName, chat.character_id)].filter((x): x is PromptExtra => Boolean(x)) : []),
    ],
    memory: (available) => {
      const s = performance.now();
      const m = buildMemoryContext({
        chatId,
        history,
        available,
        target: Math.floor(contextTarget / (resolved.tokenRatio || 1)),
        inputs: memInputs,
        seed: `${chatId}:${messageCountOf(chatId)}`,
      });
      memoryMs += performance.now() - s;
      return offpage ? { ...m, story: offpage(m.story, "the Story So Far"), recall: offpage(m.recall, "recalled memories") } : m;
    },
  });
  if (offpage?.reworded.length) assembled.trace.reworded = offpage.reworded;
  // D2: the craft coach's numbers for this turn (the Inspector's meter).
  if ((kind === "story" || kind === "continue") && craftOn(chatId)) assembled.trace.craft = craftReport(chatId, { beforeSeq: opts.excludeMessageId ? getMessageRow(opts.excludeMessageId)?.seq : undefined }).meter;
  const assembled_ = lap();
  retrievalMs = Math.round((retrievalMs + memoryMs) * 10) / 10;
  const timing: Timing = { totalMs: Math.round((performance.now() - t0) * 10) / 10, trackersMs, retrievalMs, loreMs, advisorMs, assemblyMs: Math.max(0, Math.round((assembled_ - memoryMs) * 10) / 10) };

  const cache: CacheHint | undefined = resolved.cacheMode
    ? { mode: resolved.cacheMode, ttl: cfg.cacheTtl, prefixEnd: assembled.cacheMarks.prefixEnd, historyEnd: assembled.cacheMarks.historyEnd }
    : undefined;
  const trackers = tp ? { tokens: tp.note?.tokens ?? 0, lanes: tp.note?.lanes ?? [], inline: Boolean(tp.inline) } : null;
  return { characterId: chat.character_id, card, userName, resolved, presetId: preset.id, samplers, assembled, lore, cache, trackers, planKey: plan && !opts.writtenPlan ? turnKey(history) : null, plannedPass: plan?.planner ? (plan.pass ?? null) : null, timing, voices, speakerMarks: marks };
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
    trace: { ...p.assembled.trace, cacheMarks: p.assembled.cacheMarks, cacheMode: p.cache?.mode ?? null, profile: p.resolved.profile.name, trackers: p.trackers, timing: p.timing },
    estPromptTokens: p.assembled.estPromptTokens,
  });
}

/** The take a swipe replaces: the message's active swipe. */
function rejectedTake(messageId: string): string {
  const m = getMessageRow(messageId);
  if (!m) return "";
  return getSwipes(messageId).find((s) => s.idx === m.active_swipe)?.content ?? "";
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

/** "redo": A2's "Keep this, redo the rest": a new take that starts with the kept part of the current one. */
export type StoryAction = "new" | "swipe" | "continue" | "redo";

/** Starts a story generation and returns once it's running; tokens arrive over the event stream (ARCH-02, ARCH-06). */
export async function startStory(chatId: string, action: StoryAction, opts: { messageId?: string; feedback?: string; profileId?: string | null; auto?: string; angle?: Angle; keep?: string } = {}) {
  if (activeGenerations(chatId).length) throw new HttpError(409, "A reply is already being written in this chat");
  const last = lastMessage(chatId);
  if (action !== "new" && (!last || last.id !== opts.messageId || last.role !== "assistant")) throw new HttpError(400, "Only the latest reply can be swiped or continued");
  // A2: an angle is a one-shot note for this take.
  if (opts.angle) opts = { ...opts, feedback: [angleNote(opts.angle, last?.name ?? getCard(mustChat(chatId).character_id ?? "")?.name ?? "the character"), opts.feedback].filter(Boolean).join(" ") };
  // A2: "Keep this, redo the rest": the new take starts as the kept part, then is continued.
  let redo: { idx: number; prefix: string; previous: string } | null = null;
  if (action === "redo") {
    const current = getSwipes(last!.id).find((s) => s.idx === last!.active_swipe);
    const prefix = current ? keptPrefix(current.content, opts.keep ?? "") : null;
    if (!current || !prefix) throw new HttpError(400, "Select a sentence in the latest reply to keep");
    if (current.status === "streaming") throw new HttpError(409, "Wait for the reply to finish");
    const idx = addSwipe(last!.id, "done");
    const kept = parseJson<{ speakers?: { text: string }[] }>(current.meta, {}).speakers?.filter((l) => prefix.includes(l.text));
    updateSwipe(last!.id, idx, { content: prefix, status: "done", meta: { keptFrom: current.idx, ...(kept?.length ? { speakers: kept } : {}) } });
    redo = { idx, prefix, previous: current.content.slice(prefix.length).trim() };
    const rest = takeShapeNote(redo.previous);
    opts = { ...opts, feedback: [`Everything up to here is kept word for word; write the rest anew${rest ? `, not as the earlier take went on (${rest})` : ""}.`, opts.feedback].filter(Boolean).join(" ") };
  }

  let prepared: Prepared;
  try {
    prepared =
      action === "new"
        ? await prepare(chatId, "story", { feedback: opts.feedback, profileId: opts.profileId, advise: true })
        : action === "swipe"
          ? await prepare(chatId, "story", { excludeMessageId: last!.id, feedback: opts.feedback, profileId: opts.profileId, advise: true })
          : await prepare(chatId, "continue", { feedback: opts.feedback, profileId: opts.profileId });
  } catch (e) {
    publish({ type: "gen.prep", chatId, stage: null });
    // The kept part waits for a take that never started: put the reply back as it was.
    if (redo) {
      try {
        deleteSwipe(last!.id, redo.idx);
      } catch {
        // it stays as a short take you can delete
      }
    }
    throw e;
  }
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
    // continue, or redo (whose new take already holds the kept part)
    messageId = last!.id;
    swipeIdx = redo ? redo.idx : last!.active_swipe;
    baseText = getSwipes(last!.id).find((s) => s.idx === swipeIdx)?.content ?? "";
    updateSwipe(messageId, swipeIdx, { status: "streaming" });
  }
  if (prepared.assembled.evictedThrough != null) setMemState(chatId, { evictedThrough: prepared.assembled.evictedThrough });

  const swipeId = getSwipes(messageId).find((s) => s.idx === swipeIdx)?.id;
  const generationId = requestFor(prepared, { chatId, messageId, swipeId, kind: action });
  const gen: ActiveGeneration = { id: generationId, chatId, messageId, swipeIdx, abort: new AbortController(), text: baseText, reasoning: "" };
  active.set(generationId, gen);
  publish({ type: "gen.start", chatId, messageId, swipeIdx, generationId });
  // C2: a failure after the reply must never become an unhandled rejection (Bun exits on those).
  // A redo streams exactly like a continue of its new take.
  void runStory(gen, prepared, action === "redo" ? "continue" : action, baseText, opts.feedback, opts.auto).catch((e) => console.error("[mea] reply failed:", e));
  return { generationId, messageId, swipeIdx };
}

async function runStory(gen: ActiveGeneration, first: Prepared, action: StoryAction, baseText: string, feedback?: string, auto?: string) {
  const startedAt = now();
  let p = first;
  let firstTokenAt: number | null = null;
  let lastDeltaAt = now();
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
  const saveTimer = setInterval(() => {
    try {
      updateSwipe(gen.messageId, gen.swipeIdx, { content: gen.text, reasoning: gen.reasoning || null });
    } catch (e) {
      console.error("[mea] couldn't save the reply so far:", e);
    }
  }, 1000);

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
  let planRetried = false;
  let planOnlyRetried = false;
  let backedOff = false;
  const notes: string[] = [];
  /** Where this reply's plan came from (saved in meta.plan; skipsPlans reads it back). */
  let planHow: "own" | "step" | "first" | null = null;
  const planAsked = action !== "continue" && (Boolean(p.plannedPass) || p.assembled.trace.blocks.some((b) => b.id === "mea-planning" && b.included));

  /**
   * The plan step: the planning pass on a request of its own (the same prompt, ending in "plan
   * only"), so the reply is always written from a plan, even by a model that skips its <think>
   * block. The plan streams in as the reply's reasoning and the request stops at </think>.
   * Returns the plan, or null when none came back.
   */
  const planStep = async (): Promise<string | null> => {
    const pp = await prepare(gen.chatId, "story", { excludeMessageId: action === "swipe" ? gen.messageId : undefined, feedback, profileId: p.resolved.profile.id, planOnly: true });
    const rid = requestFor(pp, { chatId: gen.chatId, messageId: gen.messageId, kind: "plan" });
    const ctl = new AbortController();
    const onUserAbort = () => ctl.abort();
    gen.abort.signal.addEventListener("abort", onUserAbort);
    let started: number | null = null;
    const timer = setTimeout(() => started == null && ctl.abort(), getSetting("routing.timeouts").story * 1000);
    const think = thinkRouter();
    let text = "";
    let reasoning = "";
    let done = false;
    gen.text = baseText;
    gen.reasoning = "";
    pendingText = "";
    pendingReasoning = "";
    publish({ type: "gen.delta", chatId: gen.chatId, messageId: gen.messageId, generationId: gen.id, text: "", reasoning: "", reset: true });
    try {
      const result = await pp.resolved.provider.stream({ model: pp.resolved.modelId, messages: pp.assembled.messages, params: pp.samplers, signal: ctl.signal, cache: pp.cache }, (d) => {
        if (done) return;
        started ??= now();
        lastDeltaAt = now();
        if (d.reasoning) {
          reasoning += d.reasoning;
          gen.reasoning += d.reasoning;
          pendingReasoning += d.reasoning;
        }
        if (d.text) {
          text += d.text;
          const out = think.push(d.text);
          const shown = out.reasoning + out.text;
          gen.reasoning += shown;
          pendingReasoning += shown;
          // The pass is over: whatever follows </think> would be the story, which isn't this request's.
          if (/<\/(?:think|thinking|plan|reasoning)>/i.test(text)) {
            done = true;
            ctl.abort();
          }
        }
      });
      finishRequest(rid, { status: "done", usage: result.usage, firstTokenAt: started, sentBody: result.sentBody, pricing: pp.resolved.pricing, billing: pp.resolved.billing });
    } catch (e) {
      if (gen.abort.signal.aborted) throw e;
      if (!done) {
        finishRequest(rid, { status: "error", error: (e as Error).message, firstTokenAt: started });
        return null;
      }
      finishRequest(rid, { status: "done", firstTokenAt: started });
    } finally {
      clearTimeout(timer);
      gen.abort.signal.removeEventListener("abort", onUserAbort);
    }
    const plan = planFrom(text, reasoning);
    if (!plan) {
      // Nothing usable: the next try starts clean, so the plan watch isn't fooled by the leftovers.
      gen.reasoning = "";
      pendingReasoning = "";
      publish({ type: "gen.delta", chatId: gen.chatId, messageId: gen.messageId, generationId: gen.id, text: "", reasoning: "", reset: true });
    }
    return plan;
  };
  /** Writes the reply from a finished plan: the next try's prompt has the plan in place of its own pass. */
  const writeFrom = async (plan: string) => {
    // The advisor's plan the plan step built on still counts as used by this reply (STEER-02).
    const planKey = p.planKey;
    p = await prepare(gen.chatId, "story", { excludeMessageId: action === "swipe" ? gen.messageId : undefined, feedback, profileId: p.resolved.profile.id, writtenPlan: plan });
    p.planKey ??= planKey;
    gen.text = baseText;
    gen.reasoning = `${plan}\n\n`;
    pendingText = "";
    pendingReasoning = "";
    first_ = true;
    firstTokenAt = null;
    publish({ type: "gen.delta", chatId: gen.chatId, messageId: gen.messageId, generationId: gen.id, text: "", reasoning: gen.reasoning, reset: true });
    requestId = requestFor(p, { chatId: gen.chatId, messageId: gen.messageId, kind: action });
  };

  try {
    // A model that keeps skipping its plan in this chat plans in its own step first, rather than
    // spending a try that would be stopped anyway.
    if (planAsked && !p.plannedPass && skipsPlans(p.resolved.modelId, gen.messageId)) {
      const plan = await planStep();
      if (plan) {
        finishRequest(requestId, { status: "replaced", error: "replaced: planned first, in its own step" });
        await writeFrom(plan);
        planHow = "first";
        notes.push("planned first, in its own step: this model has been skipping its plan");
      }
    }
    for (;;) {
      // First-token timeout (CONN-05): a stuck route moves on to the next model.
      const attempt = new AbortController();
      let timedOut = false;
      let stalled = false;
      const onUserAbort = () => attempt.abort();
      gen.abort.signal.addEventListener("abort", onUserAbort);
      const timeoutMs = getSetting("routing.timeouts").story * 1000;
      const timer = setTimeout(() => {
        if (firstTokenAt == null) {
          timedOut = true;
          attempt.abort();
        }
      }, timeoutMs);
      // M18: once text flows, a stream that goes quiet for too long is cut off with what it wrote.
      const idle = setInterval(() => {
        if (firstTokenAt != null && now() - lastDeltaAt > IDLE_MS) {
          stalled = true;
          attempt.abort();
        }
      }, 5000);
      // The preset's <think> planning block goes to reasoning as it streams (not when continuing).
      const think = action === "continue" ? null : thinkRouter();
      // The plan watch: a preset that plans (Mea's). If the story starts with no plan before it (in
      // <think> or the route's own reasoning), or a token one, this try stops at once and the plan
      // is written in its own step, then the story from it. Once only.
      let planSkipped = false;
      let watching = !planRetried && action !== "continue" && p.assembled.trace.blocks.some((b) => b.id === "mea-planning" && b.included);
      const watchPlan = () => {
        if (!watching) return;
        const story = gen.text.slice(baseText.length).replace(/^\s+/, "");
        if (story.length < 40 && !story.includes("\n")) return;
        watching = false;
        // A plan written out without its tags is moved to reasoning when the reply ends (M17).
        if (/^(?:\*\*|#+\s*)?(?:\[BEFORE YOU WRITE|NOW|SEAL|KNOW)\b/i.test(story)) return;
        if (gen.reasoning.trim().split(/\s+/).filter(Boolean).length >= PLAN_MIN_WORDS) return;
        planSkipped = true;
        attempt.abort();
      };
      const addReasoning = (r: string) => {
        gen.reasoning += r;
        pendingReasoning += r;
      };
      const addText = (text: string) => {
        let t = text;
        if (first_ && action === "continue") {
          if (baseText && !/\s$/.test(baseText) && /^[\p{L}\p{N}"'*(]/u.test(t)) t = ` ${t}`;
          first_ = false;
        } else if (first_) {
          t = t.replace(/^\s+/, "");
          if (t) first_ = false;
        }
        gen.text += t;
        pendingText += t;
      };
      const route = (out: { text: string; reasoning: string }) => {
        if (out.reasoning) addReasoning(out.reasoning);
        if (out.text) addText(out.text);
      };
      // H3: a reply written from a finished plan shows that plan as its reasoning.
      if (p.plannedPass && !gen.reasoning.trim()) addReasoning(`${p.plannedPass}\n\n`);
      try {
        const result = await p.resolved.provider.stream(
          { model: p.resolved.modelId, messages: p.assembled.messages, params: p.samplers, signal: attempt.signal, cache: p.cache },
          (d) => {
            firstTokenAt ??= now();
            lastDeltaAt = now();
            if (d.reasoning) addReasoning(d.reasoning);
            if (d.text) {
              if (think) route(think.push(d.text));
              else addText(d.text);
              watchPlan();
            }
          },
        );
        // The plan watch stopped this try (a fast stream can finish before the abort lands).
        if (planSkipped) throw new Error("the reply skipped its plan");
        // Text still held back (a tag cut short at the end) belongs to the reply or its reasoning.
        if (think) route(think.end());
        usage = result.usage;
        finishReason = result.finishReason;
        sentBody = result.sentBody;
        const written = gen.text.slice(baseText.length);
        // The plan-only watch: the writer planned and stopped there, with no story. Once, the story
        // is asked for again with that plan as the finished plan, so the next try writes only prose.
        const planned = action !== "continue" && p.assembled.trace.blocks.some((b) => b.id === "mea-planning" && b.included);
        const leftover = planned && !planOnlyRetried && !gen.abort.signal.aborted ? planOnly(written, gen.reasoning) : null;
        if (leftover) {
          planOnlyRetried = true;
          finishRequest(requestId, { status: "retried", error: "retried: the reply was only its plan", usage, firstTokenAt, sentBody, pricing: p.resolved.pricing, billing: p.resolved.billing });
          p = await prepare(gen.chatId, "story", { excludeMessageId: action === "swipe" ? gen.messageId : undefined, feedback, profileId: p.resolved.profile.id, writtenPlan: leftover });
          notes.push("the first try wrote only its plan: the story was written from it");
          planHow = "own";
          gen.text = baseText;
          gen.reasoning = `${leftover}\n\n`;
          pendingText = "";
          pendingReasoning = "";
          first_ = true;
          firstTokenAt = null;
          publish({ type: "gen.delta", chatId: gen.chatId, messageId: gen.messageId, generationId: gen.id, text: "", reasoning: gen.reasoning, reset: true });
          requestId = requestFor(p, { chatId: gen.chatId, messageId: gen.messageId, kind: action });
          continue;
        }
        // CONN-09: an empty reply or a refusal gets one more try (the next model in the chain if there is one).
        const retry = getSetting("chat.retry");
        const why = !written.trim() && retry.empty ? "empty reply" : retry.refusal && looksLikeRefusal(written) ? "refusal" : null;
        if (why && !smartRetried && !gen.abort.signal.aborted) {
          smartRetried = true;
          finishRequest(requestId, { status: "retried", error: `retried: ${why}`, usage, firstTokenAt, sentBody, pricing: p.resolved.pricing, billing: p.resolved.billing });
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
        // M18: the stream ended without its end marker: keep what arrived, marked as cut off.
        if (finishReason === INCOMPLETE) {
          status = "stopped";
          notes.push("the connection dropped before the reply finished");
        }
        break;
      } catch (e) {
        if (gen.abort.signal.aborted) throw e;
        if (planSkipped && !planRetried) {
          planRetried = true;
          finishRequest(requestId, { status: "retried", error: "retried: the reply skipped its plan", firstTokenAt });
          // The plan in its own step, then the story from it; if no plan comes back, one more try told plainly to plan.
          const plan = await planStep();
          if (plan) {
            await writeFrom(plan);
            planHow = "step";
            notes.push("planned in its own step: the first try skipped its plan");
            continue;
          }
          p = await prepare(gen.chatId, "story", { excludeMessageId: action === "swipe" ? gen.messageId : undefined, feedback, profileId: p.resolved.profile.id, forcePlan: true });
          notes.push("asked again: the first try skipped its plan");
          gen.text = baseText;
          gen.reasoning = "";
          pendingText = "";
          pendingReasoning = "";
          first_ = true;
          firstTokenAt = null;
          publish({ type: "gen.delta", chatId: gen.chatId, messageId: gen.messageId, generationId: gen.id, text: "", reset: true });
          requestId = requestFor(p, { chatId: gen.chatId, messageId: gen.messageId, kind: action });
          continue;
        }
        const err = timedOut ? new ProviderError(`No reply within ${Math.round(timeoutMs / 1000)} s`) : stalled ? new ProviderError(`The reply stalled: nothing new for ${IDLE_MS / 1000} s`) : e;
        const nothingYet = firstTokenAt == null && !gen.text.slice(baseText.length);
        if (!(err instanceof ProviderError) || !nothingYet) throw err;
        // CTX-08: the provider says the prompt is too long. Learn the limit, shrink, and retry once.
        if (err.kind === "overflow" && !overflowRetried) {
          overflowRetried = true;
          const limit = contextLimitFromError(`${err.message} ${err.body ?? ""}`);
          if (limit) learnContextLimit(p.resolved.connection.id, p.resolved.modelId, limit);
          finishRequest(requestId, { status: "error", error: err.message });
          // H3: always smaller than the prompt that failed, whether or not a limit was learned.
          p = await prepare(gen.chatId, action === "continue" ? "continue" : "story", {
            excludeMessageId: action === "swipe" ? gen.messageId : undefined,
            feedback,
            profileId: p.resolved.profile.id,
            targetScale: 0.75,
          });
          notes.push("prompt shrunk after a length error");
          requestId = requestFor(p, { chatId: gen.chatId, messageId: gen.messageId, kind: action });
          continue;
        }
        // CONN-09: a server error gets one quick retry on the same model before moving down the chain.
        if (err.retryable && !backedOff && getSetting("chat.retry").serverErrors) {
          backedOff = true;
          finishRequest(requestId, { status: "error", error: err.message });
          // M18: a rate limit says how long to wait (capped); otherwise a short pause.
          await Bun.sleep(err.retryAfterMs ? Math.min(err.retryAfterMs, RETRY_AFTER_CAP_MS) : 1500);
          if (gen.abort.signal.aborted) throw err;
          notes.push(`retried after: ${err.message.slice(0, 60)}`);
          requestId = requestFor(p, { chatId: gen.chatId, messageId: gen.messageId, kind: action });
          continue;
        }
        // CONN-05: try the next model in the story chain.
        const next = chain.shift();
        if ((err.retryable || err.kind === "refused" || err.kind === "billing") && next) {
          finishRequest(requestId, { status: "error", error: err.message });
          p = await prepare(gen.chatId, action === "continue" ? "continue" : "story", { excludeMessageId: action === "swipe" ? gen.messageId : undefined, feedback, profileId: next.profile.id });
          notes.push(`fell back to ${next.profile.name} (${err.message.slice(0, 80)})`);
          requestId = requestFor(p, { chatId: gen.chatId, messageId: gen.messageId, kind: action });
          continue;
        }
        throw err;
      } finally {
        clearTimeout(timer);
        clearInterval(idle);
        gen.abort.signal.removeEventListener("abort", onUserAbort);
      }
    }
  } catch (e) {
    if ((e as Error).name === "AbortError" || gen.abort.signal.aborted) status = "stopped";
    else {
      status = "error";
      error = e instanceof ProviderError || e instanceof HttpError ? e.message : `Something went wrong: ${(e as Error).message}`;
      if (e instanceof ProviderError && e.kind === "quota") error = `${e.message} — your subscription quota may be used up.`;
      if (e instanceof ProviderError && e.kind === "billing") error = `${e.message} — this key can't pay for that model; pick one your plan covers in Settings → Models.`;
    }
  } finally {
    clearInterval(flushTimer);
    clearInterval(saveTimer);
    flush();
    for (const [k, g] of active) if (g === gen) active.delete(k);
  }

  // C2: the chat can be deleted while the reply streams; nothing after this point may throw out.
  const chatAlive = () => {
    const c = getChatRow(gen.chatId);
    return c && !c.deleted_at ? c : null;
  };
  let text = gen.text.trimEnd();
  let reasoning = gen.reasoning;
  // Inline trackers: the <ledger> block comes out of the reply before it's saved.
  let ledgerRaw: string | null = null;
  const inline = p.trackers?.inline && status !== "error";
  const cutoff = getSetting("chat.cutoff");
  const cutOff = status === "done" && finishReason === "length";
  let banned: ReturnType<typeof applyBanned> = { text, hits: [], replaced: 0 };
  let guarded: ReturnType<typeof applyGuards> | null = null;
  let original = text;
  try {
    // M17: inline reasoning (<think>…</think>) from OpenAI-style routes goes to the reasoning field.
    if (action !== "continue") {
      for (const split of [splitThink, splitLeakedPlan]) {
        const out = split(text);
        if (out.reasoning && (split === splitThink || out.text.trim())) {
          text = out.text;
          reasoning = [reasoning, out.reasoning].filter(Boolean).join("\n\n");
        }
      }
    }
    if (inline) {
      const at = text.search(/<ledger\b/i);
      if (at >= 0) {
        ledgerRaw = text.slice(at);
        text = text.slice(0, at).trimEnd();
      }
    }
    // CHAT-14: a reply cut off by the length limit is trimmed to its last sentence, or continued.
    if (cutOff && cutoff === "trim") text = trimUnfinished(text);
    // PROMPT-08: persistent regex scripts change the stored reply.
    if (status !== "error") text = applyRegex(text, getSetting("regex.scripts"), { role: "ai", mode: "persistent", characterId: p.characterId });
    // CHAT-19 + STEER-04: banned phrases (yours, and this story's style profile).
    const style = styleFor(gen.chatId);
    banned = status !== "error" ? applyBanned(text, style.banned ?? []) : { text, hits: [], replaced: 0 };
    text = banned.text;
    // The model naming "the player" in the prose steps out of the story; that sentence comes out.
    if (status !== "error") text = cutFourthWall(text).text;
    if (status !== "error" && style.quotes && style.quotes !== "any") text = normalizeQuotes(text, style.quotes);
    // CON-04 / CON-05: names corrected and puppeting cut, when you chose those actions.
    original = text;
    guarded = status !== "error" && text.trim() && chatAlive() ? applyGuards(gen.chatId, text, { seq: getMessageRow(gen.messageId)?.seq ?? 0, messageId: gen.messageId }) : null;
    if (guarded) {
      text = guarded.text;
      notes.push(...guarded.notes);
    }
  } catch (e) {
    console.error("[mea] after-reply clean-up failed:", e);
  }
  // Speaker marks come out last, so the lines they keep match the text as saved.
  const marked = extractSpeakers(text, first.voices);
  text = marked.text;
  original = withoutSpeakerMarks(original);
  let speakers: SpokenLine[] = marked.lines;
  // A continue keeps the marks of the part it continued, whether or not its own part has any.
  if (action === "continue") {
    const before = parseJson<{ speakers?: SpokenLine[] }>(getSwipes(gen.messageId).find((s) => s.idx === gen.swipeIdx)?.meta ?? "{}", {}).speakers ?? [];
    speakers = [...before, ...speakers];
  }
  const finalStatus = status === "error" && action === "continue" ? "done" : status === "error" && text ? "stopped" : status;
  try {
    updateSwipe(gen.messageId, gen.swipeIdx, {
      content: text,
      reasoning: reasoning.trim() || null,
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
        // PERF-10: the timing breakdown for the inspector.
        timing: {
          ...p.timing,
          ttftMs: firstTokenAt ? firstTokenAt - startedAt : null,
          tokensPerSec: usage?.completionTokens && firstTokenAt && now() > firstTokenAt ? Math.round((usage.completionTokens / ((now() - firstTokenAt) / 1000)) * 10) / 10 : null,
          cacheHit: usage?.promptTokens ? Math.round(((usage.cachedTokens ?? 0) / usage.promptTokens) * 1000) / 1000 : null,
        },
        finishReason: finishReason ?? null,
        ...(finishReason === INCOMPLETE ? { incomplete: true } : {}),
        ...(notes.length ? { notes } : {}),
        ...(feedback ? { feedback } : {}),
        ...(banned.hits.length ? { banned: banned.hits } : {}),
        ...(ledgerRaw ? { ledger: ledgerRaw.slice(0, 6000) } : {}),
        ...(speakers.length ? { speakers } : {}),
        // Where the plan came from: its own pass, the plan step, or a separate planner (none when it skipped it).
        ...(planAsked ? { plan: planHow ?? (p.plannedPass ? "planner" : reasoning.trim().split(/\s+/).filter(Boolean).length >= PLAN_MIN_WORDS ? "own" : "none") } : {}),
        ...(cutOff ? { cutOff: true } : {}),
        ...(guarded && text !== original ? { guard: { ...guarded.meta, original: original.slice(0, 20_000) } } : {}),
      },
    });
    finishRequest(requestId, { status, error, usage, firstTokenAt, sentBody, pricing: p.resolved.pricing, billing: p.resolved.billing });
  } catch (e) {
    console.error("[mea] couldn't save the finished reply:", e);
  } finally {
    publish({ type: "gen.end", chatId: gen.chatId, messageId: gen.messageId, generationId: requestId, status: finalStatus, error });
    publish({ type: "message.changed", chatId: gen.chatId, messageId: gen.messageId });
  }

  const chat = chatAlive();
  if (!chat) return;
  try {
    if (status !== "error") {
      try {
        consumeOnce(gen.chatId);
        if (inline) fileInlineLedger(gen.chatId, gen.messageId, gen.swipeIdx, ledgerRaw);
        else if (status === "done") scheduleTrackers(gen.chatId, gen.messageId, gen.swipeIdx);
      } catch (e) {
        console.error("[mea] after-reply step failed:", e);
      }
      saveLoreState(gen.chatId, p.lore.stateUpdates, gen.messageId);
      recordLoreHits(gen.chatId, p.lore.activated.map((a) => a.entry.id));
      setChatVars(gen.chatId, p.assembled.vars);
      recordMemoryUsage(requestId, gen.chatId, p);
      // STEER-02: the advisor remembers which of its plans a reply was written with.
      if (p.planKey) markPlanUsed(gen.chatId, p.planKey, requestId);
      // CON-02 / CON-06: check the reply against the story's facts, in the background.
      if (status === "done" && checksOn(gen.chatId)) enqueue("accuracy.check", { chatId: gen.chatId, messageId: gen.messageId, swipeIdx: gen.swipeIdx }, { delayMs: 2500, chatId: gen.chatId, dedupeKey: `accuracy.check:${gen.messageId}:${gen.swipeIdx}` });
      // MEM-19: the memories this reply drew on gain weight.
      if (status === "done" && memoryConfig().reinforcement) {
        try {
          reinforce(gen.chatId, requestId, text, getMessageRow(gen.messageId)?.seq ?? 0);
        } catch (e) {
          console.error("[mea] reinforcement failed:", e);
        }
      }
      // CON-10: every few replies, measure the character's voice against their samples.
      if (status === "done") scheduleDrift(gen.chatId);
      // A reply that came back with dialogue and no marks: the helper names the speakers.
      if (status === "done" && p.speakerMarks && !speakers.length && quotedLines(text).length) scheduleSpeakerMarks(gen.chatId, gen.messageId, gen.swipeIdx, first.voices);
      // STEER-03: the post-pass editor, when it's on (not for a reply about to be written again).
      if (status === "done" && !guarded?.retry) scheduleEditor(gen.chatId, gen.messageId, gen.swipeIdx);
      if (chat.character_id) touchCharacter(chat.character_id);
    }
    if (usage?.promptTokens) recordCalibration(p.resolved.connection.id, p.resolved.modelId, p.assembled.estPromptTokens, usage.promptTokens);
    if (p.resolved.billing === "subscription") enqueue("quota.refresh", {}, { dedupeKey: "quota.refresh", delayMs: 3000 });
    // A finished turn may have settled older messages: let memory catch up in the background (SUM-07).
    // C3 / H5: a swipe or continue changed a reply memory may already have read.
    if (action !== "new" && status !== "error") ledgerChangedAfterReply(gen.chatId, gen.messageId);
    scheduleMemory(gen.chatId);
  } catch (e) {
    console.error("[mea] after-reply work failed:", e);
  }
  // CHAT-14 / CHAT-19: follow-ups that start a new generation once this one is saved.
  if (status === "done" && cutOff && cutoff === "continue" && auto !== "continue") {
    setTimeout(() => void startStory(gen.chatId, "continue", { messageId: gen.messageId, auto: "continue" }).catch(() => {}), 50);
  } else if (status === "done" && banned.hits.length && getSetting("chat.banned").action === "regenerate" && !auto) {
    setTimeout(() => void startStory(gen.chatId, "swipe", { messageId: gen.messageId, auto: "banned" }).catch(() => {}), 50);
  } else if (status === "done" && guarded?.retry && !auto) {
    // CON-04: the reply wrote for you; one more try with a note.
    setTimeout(() => void startStory(gen.chatId, "swipe", { messageId: gen.messageId, auto: "guard", feedback: guarded!.retry! }).catch(() => {}), 50);
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
  const onAbort = () => abort.abort();
  signal.addEventListener("abort", onAbort);
  // M18: the same first-token timeout as a reply, and the idle cut-off once text flows.
  const timeoutMs = getSetting("routing.timeouts").story * 1000;
  let lastDeltaAt = now();
  let timedOut: string | null = null;
  const watch = setInterval(() => {
    if (firstTokenAt == null ? now() - lastDeltaAt > timeoutMs : now() - lastDeltaAt > IDLE_MS) {
      timedOut = firstTokenAt == null ? `No reply within ${Math.round(timeoutMs / 1000)} s` : `The draft stalled: nothing new for ${IDLE_MS / 1000} s`;
      abort.abort();
    }
  }, 1000);
  const params: GenerationParams = { ...p.samplers, max_tokens: Math.min(p.samplers.max_tokens ?? 600, 800) };
  p.resolved.provider
    .stream({ model: p.resolved.modelId, messages: p.assembled.messages, params, signal: abort.signal, cache: p.cache }, (d) => {
      lastDeltaAt = now();
      if (d.text) {
        firstTokenAt ??= now();
        queue.push(d.text);
        wake?.();
      }
    })
    .then((r) => (usage = r.usage))
    .catch((e) => {
      if (timedOut) failure = timedOut;
      else if ((e as Error).name !== "AbortError") failure = (e as Error).message;
    })
    .finally(() => {
      clearInterval(watch);
      signal.removeEventListener("abort", onAbort);
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
    trace: { ...p.assembled.trace, timing: p.timing },
    estPromptTokens: p.assembled.estPromptTokens,
    cacheMarks: p.assembled.cacheMarks,
    cacheMode: p.cache?.mode ?? null,
  };
}

/** Warms retrieval while you type (CTX-10, MEM-20): query vectors, the rewritten query and the librarian's pick. */
export async function prefetch(chatId: string, draft: string) {
  // STEER-01: the advisor plans the next reply while you type.
  void runAdvisor(chatId, { draft });
  return warmMemory(chatId, draft);
}

export function getGeneration(id: string) {
  return getRequest(id);
}

export function messageIsStreaming(messageId: string) {
  const m = getMessageRow(messageId);
  return Boolean(m && [...active.values()].some((g) => g.messageId === messageId));
}

/** What the rest of the earlier take did, in a few words (for "Keep this, redo the rest"). */
function takeShapeNote(rest: string) {
  if (!rest.trim()) return "";
  const t = rejectedShape(rest);
  return [t.opening && `it went «${t.opening}»`, t.beat && `with «${t.beat}»`].filter(Boolean).join(" ");
}
