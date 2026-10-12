import { z } from "zod";
import { applyServicePrompt } from "../lib/prompts";
import { now } from "../db/db";
import { getSetting } from "../lib/settings";
import { countTokens } from "../lib/tokens";
import type { ChatMessage } from "../prompt/assemble";
import { INCOMPLETE, ProviderError, type Usage } from "../providers/types";
import { type ResolvedProfile, resolveTaskChain } from "./connections";
import { Deferred } from "./jobs";
import { QuotaExhausted, assertQuota } from "./quota";
import { finishRequest, startRequest } from "./requests";

export type HelperTask = "summarizer" | "helper" | "tracker" | "world" | "assistant" | "planner";

export interface JsonCall<T extends z.ZodType> {
  task: HelperTask;
  /** What the request is for, shown in request history: "scene", "verify", "chapter"… */
  kind: string;
  chatId?: string | null;
  jobId?: string | null;
  name: string;
  schema: T;
  system: string;
  user: string;
  maxTokens?: number;
  /** Creative helpers (the Lore Studio) run warmer than extraction does. */
  temperature?: number;
  signal?: AbortSignal;
  /** H3: a profile to try first (a chat's own planner model), ahead of the task's routing. */
  profileId?: string | null;
}

export interface JsonResult<T> {
  data: T;
  generationId: string;
  usage?: Usage;
  model: string;
  profileName: string;
  inputTokens: number;
}

/** Pulls the JSON object out of a reply that may carry code fences or chatter around it. */
export function extractJson(text: string): unknown {
  const t = text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1]! : t;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("The reply had no JSON object");
  return JSON.parse(body.slice(start, end + 1));
}

/**
 * M14: a reply cut off mid-list keeps its finished items. Trims back to the last complete element of
 * an open array and closes every open bracket. Returns null when there's no array item to keep.
 */
export function salvageJson(text: string): unknown {
  const t = text.replace(/<think>[\s\S]*?<\/think>/gi, "");
  const start = t.indexOf("{");
  if (start < 0) return null;
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  let cut = -1;
  let cutStack: string[] = [];
  for (let i = start; i < t.length; i++) {
    const ch = t[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') {
        inString = false;
        if (stack[stack.length - 1] === "[") {
          cut = i + 1;
          cutStack = [...stack];
        }
      }
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{" || ch === "[") stack.push(ch);
    else if (ch === "}" || ch === "]") {
      stack.pop();
      if (!stack.length) return null; // the object closed: nothing was cut, so there's nothing to salvage
      // A finished element of an open array is a safe place to stop.
      if (stack[stack.length - 1] === "[") {
        cut = i + 1;
        cutStack = [...stack];
      }
    }
  }
  if (cut < 0) return null;
  const close = cutStack.reverse().map((b) => (b === "{" ? "}" : "]")).join("");
  try {
    return JSON.parse(t.slice(start, cut) + close);
  } catch {
    return null;
  }
}

const schemaCache = new Map<string, Record<string, unknown>>();
function jsonSchemaOf(name: string, schema: z.ZodType) {
  let s = schemaCache.get(name);
  if (!s) {
    s = z.toJSONSchema(schema, { target: "draft-7", unrepresentable: "any" }) as Record<string, unknown>;
    delete s.$schema;
    schemaCache.set(name, s);
  }
  return s;
}

/** M15: on a route that reasons, thinking shares the helper's budget: never send it less than this. */
const REASONING_FLOOR = 1024;
/** M14: the most a truncated helper reply is retried with. */
const MAX_RETRY_TOKENS = 32_000;

async function once(r: ResolvedProfile, call: JsonCall<z.ZodType>, messages: ChatMessage[], structured: boolean, maxTokens?: number) {
  const timeoutMs = (getSetting("routing.timeouts")[call.task] ?? 120) * 1000;
  const signal = call.signal ? AbortSignal.any([call.signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
  const budget = maxTokens ?? call.maxTokens ?? 4000;
  const params = { ...r.params, max_tokens: r.reasoning ? Math.max(budget, REASONING_FLOOR) : budget, temperature: call.temperature ?? 0.3 };
  const responseFormat = structured ? { type: "json_schema", json_schema: { name: call.name, strict: false, schema: jsonSchemaOf(call.name, call.schema) } } : undefined;
  const est = messages.reduce((n, m) => n + countTokens(m.content) + 4, 0);
  const id = startRequest({
    chatId: call.chatId,
    kind: call.kind,
    task: call.task,
    resolved: r,
    request: { model: r.modelId, messages, params, response_format: responseFormat },
    estPromptTokens: est,
    jobId: call.jobId,
  });
  let text = "";
  let firstTokenAt: number | null = null;
  try {
    const res = await r.provider.stream({ model: r.modelId, messages, params, signal, responseFormat }, (d) => {
      if (d.text) {
        firstTokenAt ??= now();
        text += d.text;
      }
    });
    finishRequest(id, { status: "done", usage: res.usage, firstTokenAt, sentBody: res.sentBody, response: text, pricing: r.pricing, billing: r.billing });
    return { id, text, usage: res.usage, est, finishReason: res.finishReason, maxTokens: params.max_tokens };
  } catch (e) {
    const timedOut = (e as Error).name === "TimeoutError" || ((e as Error).name === "AbortError" && !call.signal?.aborted);
    const err = timedOut ? new ProviderError(`Timed out after ${Math.round(timeoutMs / 1000)} s`) : e;
    finishRequest(id, { status: "error", error: (err as Error).message, firstTokenAt, response: text || null });
    throw err;
  }
}

/** M14: the reply stopped at the token limit (or the stream dropped) rather than finishing. */
const cutOff = (res: { finishReason?: string }) => res.finishReason === "length" || res.finishReason === INCOMPLETE;

/**
 * A structured helper call (SUM-03, CONN-05, CONN-21): tries each profile in the task's chain,
 * validates the reply against the schema (ARCH-05), and asks once more if it doesn't parse.
 * A subscription quota that is used up defers the job until the reset instead of failing.
 */
export async function callJson<T extends z.ZodType>(call: JsonCall<T>): Promise<JsonResult<z.infer<T>>> {
  const chain = resolveTaskChain(call.task, call.profileId ?? undefined);
  let lastError: unknown = null;
  for (const r of chain) {
    try {
      assertQuota(r.billing);
    } catch (e) {
      if (e instanceof QuotaExhausted) throw new Deferred("Waiting for the quota to reset", e.resetAt ? Math.max(60_000, e.resetAt - now()) : 30 * 60_000);
      throw e;
    }
    let structured = r.structured;
    const messages: ChatMessage[] = [
      { role: "system", content: applyServicePrompt(call.kind, call.system) },
      { role: "user", content: call.user },
    ];
    let maxTokens: number | undefined;
    let salvaged: JsonResult<z.infer<T>> | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      let res: Awaited<ReturnType<typeof once>>;
      try {
        res = await once(r, call, messages, structured, maxTokens);
      } catch (e) {
        lastError = e;
        if (call.signal?.aborted) throw e;
        if (e instanceof ProviderError) {
          if (e.kind === "quota") throw new Deferred("The provider reports the quota is used up", 30 * 60_000);
          // Some routes reject response_format; retry the same model without it.
          if (e.kind === "refused" && structured) {
            structured = false;
            continue;
          }
          if (e.retryable || e.permanent || e.kind === "refused") break;
        }
        throw e;
      }
      let parsed: unknown;
      let problem = "";
      try {
        parsed = extractJson(res.text);
        const ok = call.schema.safeParse(parsed);
        if (ok.success) return { data: ok.data, generationId: res.id, usage: res.usage, model: r.modelId, profileName: r.profile.name, inputTokens: res.usage?.promptTokens ?? res.est };
        problem = z.prettifyError(ok.error).slice(0, 1200);
      } catch (e) {
        problem = (e as Error).message;
      }
      lastError = new Error(`The model's reply didn't match the expected format: ${problem}`);
      // M14: a reply cut off at the length limit gets more room and a request to be briefer, not the same budget again.
      if (cutOff(res)) {
        // Keep the finished items in case every retry is cut off too.
        const partial = call.schema.safeParse(salvageJson(res.text));
        if (partial.success) salvaged = { data: partial.data, generationId: res.id, usage: res.usage, model: r.modelId, profileName: r.profile.name, inputTokens: res.usage?.promptTokens ?? res.est };
        maxTokens = Math.min(MAX_RETRY_TOKENS, res.maxTokens * 2);
        lastError = new Error(`The model's reply was cut off at ${res.maxTokens} tokens`);
        messages.splice(2, messages.length, { role: "user", content: "Your last reply was cut off at the length limit before the JSON was complete. Reply again with the whole JSON object, shorter this time: fewer items and briefer text where the format allows." });
        continue;
      }
      messages.splice(2, messages.length, { role: "assistant", content: res.text.slice(0, 6000) }, { role: "user", content: `That reply wasn't valid: ${problem}\nReply again with only the corrected JSON object.` });
    }
    if (salvaged) return salvaged;
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export interface TextCall {
  task: HelperTask;
  kind: string;
  chatId?: string | null;
  jobId?: string | null;
  system: string;
  user: string;
  maxTokens?: number;
  signal?: AbortSignal;
  temperature?: number;
  /** Returns a problem to send back once ("the reply had no ledger lines"), or null when it's usable. */
  validate?: (text: string) => string | null;
}

/** A plain-text helper call (tracker ledgers): the task's chain, quota deferral, one corrective retry. */
export async function callText(call: TextCall): Promise<{ text: string; generationId: string; usage?: Usage; model: string; inputTokens: number }> {
  const chain = resolveTaskChain(call.task);
  let lastError: unknown = null;
  const asJson = { ...call, name: "text", schema: z.any() } as JsonCall<z.ZodType>;
  for (const r of chain) {
    try {
      assertQuota(r.billing);
    } catch (e) {
      if (e instanceof QuotaExhausted) throw new Deferred("Waiting for the quota to reset", e.resetAt ? Math.max(60_000, e.resetAt - now()) : 30 * 60_000);
      throw e;
    }
    const messages: ChatMessage[] = [
      { role: "system", content: applyServicePrompt(call.kind, call.system) },
      { role: "user", content: call.user },
    ];
    let maxTokens: number | undefined;
    for (let attempt = 0; attempt < 2; attempt++) {
      let res: Awaited<ReturnType<typeof once>>;
      try {
        res = await once(r, asJson, messages, false, maxTokens);
      } catch (e) {
        lastError = e;
        if (call.signal?.aborted) throw e;
        if (e instanceof ProviderError) {
          if (e.kind === "quota") throw new Deferred("The provider reports the quota is used up", 30 * 60_000);
          if (e.retryable || e.permanent || e.kind === "refused") break;
        }
        throw e;
      }
      const problem = call.validate?.(res.text) ?? null;
      if (!problem) return { text: res.text, generationId: res.id, usage: res.usage, model: r.modelId, inputTokens: res.usage?.promptTokens ?? res.est };
      lastError = new Error(problem);
      if (cutOff(res)) maxTokens = Math.min(MAX_RETRY_TOKENS, res.maxTokens * 2);
      messages.splice(2, messages.length, { role: "assistant", content: res.text.slice(0, 4000) }, { role: "user", content: `${problem}\nReply again with only the corrected lines.` });
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
