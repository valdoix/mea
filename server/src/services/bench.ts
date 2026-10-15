import type { CardData } from "../cards/card";
import { now } from "../db/db";
import { getSetting } from "../lib/settings";
import { countTokens } from "../lib/tokens";
import { activateLore } from "../lore/activate";
import { scanEntriesFor } from "../lore/service";
import { assemblePrompt, type HistoryMessage } from "../prompt/assemble";
import { expandMacros } from "../prompt/macros";
import type { Usage } from "../providers/types";
import { resolveProfile } from "./connections";
import { layered, presetForRequest } from "./layers";
import { getDefaultPersona, getPersona, personaPrompt } from "./personas";
import { assertQuota } from "./quota";
import { finishRequest, startRequest } from "./requests";
import { applyPersonaVariant, getVariant } from "./variants";

/**
 * Test bench (CHAR-16): a sandbox conversation with the card as it is on screen, saved or not. It is
 * built exactly like a real chat (preset, controls, persona, lore, profile) so what you hear is
 * what you'll get, but nothing is stored: no chat, no memory, no trackers. Requests still show up
 * in request history (kind "bench") so their cost is visible.
 */

export interface BenchInput {
  characterId: string | null;
  card: CardData;
  mode: "companion" | "narrator";
  personaId?: string | null;
  personaVariantId?: string | null;
  messages: { role: "user" | "assistant"; content: string }[];
}

export function benchPrompt(input: BenchInput) {
  const persona = applyPersonaVariant(getPersona(input.personaId) ?? getDefaultPersona(), getVariant(input.personaVariantId));
  const userName = persona?.name ?? "You";
  const layers = layered({}, input.characterId);
  const resolved = resolveProfile(layers.profileId);
  const { preset, controls, values: controlValues } = presetForRequest(layers.presetId, resolved.prefill, layers.controls);
  const fill = (s: string) => expandMacros(s, { char: input.card.name, user: userName, vars: {}, mode: input.mode });
  const history: HistoryMessage[] = input.messages.filter((m) => m.content.trim()).map((m, i) => ({ id: `bench-${i}`, role: m.role, content: fill(m.content), seq: i + 1 }));
  const entries = input.characterId ? scanEntriesFor({ characterId: input.characterId, personaId: persona?.id ?? null }) : [];
  const lore = entries.length
    ? activateLore({
        entries: entries.filter((e) => !(e.extra as { trackerWhen?: string } | undefined)?.trackerWhen?.trim()),
        history: history.map((m) => `${m.role === "user" ? userName : input.card.name}: ${m.content}`),
        messageCount: history.length,
        state: {},
        defaults: getSetting("lore.defaults"),
        countTokens,
        substitute: fill,
        splitTriggered: true,
        all: entries,
      })
    : null;
  const assembled = assemblePrompt({
    kind: "story",
    preset,
    card: input.card,
    userName,
    personaText: personaPrompt(persona),
    userPronouns: persona?.data.pronouns,
    mode: input.mode,
    history,
    authorsNote: layers.authorsNote,
    lore,
    contextTarget: resolved.contextTarget,
    modelId: resolved.modelId,
    vars: {},
    seed: "bench",
    tokenRatio: resolved.tokenRatio,
    controls,
    controlValues,
  });
  return { resolved, assembled, samplers: { ...preset.samplers, ...resolved.params } };
}

export async function* streamBench(input: BenchInput, signal: AbortSignal): AsyncGenerator<{ text?: string; done?: boolean; error?: string }> {
  const { resolved, assembled, samplers } = benchPrompt(input);
  assertQuota(resolved.billing);
  const genId = startRequest({ kind: "bench", task: "story", resolved, request: { model: resolved.modelId, messages: assembled.messages, params: samplers }, trace: assembled.trace, estPromptTokens: assembled.estPromptTokens });
  const queue: string[] = [];
  let wake: (() => void) | null = null;
  let finished = false;
  let failure: string | undefined;
  let usage: Usage | undefined;
  let firstTokenAt: number | null = null;
  const abort = new AbortController();
  signal.addEventListener("abort", () => abort.abort());
  resolved.provider
    .stream({ model: resolved.modelId, messages: assembled.messages, params: samplers, signal: abort.signal }, (d) => {
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
  finishRequest(genId, { status: failure ? "error" : abort.signal.aborted ? "stopped" : "done", error: failure, usage, firstTokenAt, pricing: resolved.pricing, billing: resolved.billing });
  yield failure ? { error: failure, done: true } : { done: true };
}

/** Quick probes for the bench: one tap each. */
export const BENCH_PROBES = [
  { label: "Introduce yourself", text: "Tell me about yourself." },
  { label: "Bad news", text: "*I sit down heavily.* I have bad news. Your oldest friend left town last night without a word." },
  { label: "What do you want?", text: "What do you want most, really?" },
  { label: "Flirt", text: "*I lean a little closer than I need to.* You look good tonight." },
  { label: "Accuse", text: "You're lying to me. I know you are." },
  { label: "Be rude", text: "Honestly? You're exhausting." },
  { label: "Ask for help", text: "I need your help, and I can't tell you why." },
];
