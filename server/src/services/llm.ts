import { z } from "zod";
import { now } from "../db/db";
import { getSetting } from "../lib/settings";
import { countTokens } from "../lib/tokens";
import type { ChatMessage } from "../prompt/assemble";
import { ProviderError, type Usage } from "../providers/types";
import { type ResolvedProfile, resolveTaskChain } from "./connections";
import { Deferred } from "./jobs";
import { QuotaExhausted, assertQuota } from "./quota";
import { finishRequest, startRequest } from "./requests";

export type HelperTask = "summarizer" | "helper";

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
  signal?: AbortSignal;
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

async function once(r: ResolvedProfile, call: JsonCall<z.ZodType>, messages: ChatMessage[], structured: boolean) {
  const timeoutMs = (getSetting("routing.timeouts")[call.task] ?? 120) * 1000;
  const signal = call.signal ? AbortSignal.any([call.signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
  const params = { ...r.params, max_tokens: call.maxTokens ?? 4000, temperature: 0.3 };
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
    return { id, text, usage: res.usage, est };
  } catch (e) {
    const timedOut = (e as Error).name === "TimeoutError" || ((e as Error).name === "AbortError" && !call.signal?.aborted);
    const err = timedOut ? new ProviderError(`Timed out after ${Math.round(timeoutMs / 1000)} s`) : e;
    finishRequest(id, { status: "error", error: (err as Error).message, firstTokenAt, response: text || null });
    throw err;
  }
}

/**
 * A structured helper call (SUM-03, CONN-05, CONN-21): tries each profile in the task's chain,
 * validates the reply against the schema (ARCH-05), and asks once more if it doesn't parse.
 * A subscription quota that is used up defers the job until the reset instead of failing.
 */
export async function callJson<T extends z.ZodType>(call: JsonCall<T>): Promise<JsonResult<z.infer<T>>> {
  const chain = resolveTaskChain(call.task);
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
      { role: "system", content: call.system },
      { role: "user", content: call.user },
    ];
    for (let attempt = 0; attempt < 3; attempt++) {
      let res: Awaited<ReturnType<typeof once>>;
      try {
        res = await once(r, call, messages, structured);
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
          if (e.retryable || e.kind === "auth" || e.kind === "refused") break;
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
      messages.splice(2, messages.length, { role: "assistant", content: res.text.slice(0, 6000) }, { role: "user", content: `That reply wasn't valid: ${problem}\nReply again with only the corrected JSON object.` });
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
