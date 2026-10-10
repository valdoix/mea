import type { ChatMessage } from "../prompt/assemble";
import { describeError, readSSE } from "./openai";
import { type GenerationParams, httpError, INCOMPLETE, type ModelInfo, type Provider, ProviderError, type StreamDelta, type StreamRequest, type StreamResult } from "./types";

export interface AnthropicOptions {
  /** Base URL ending in /v1 (Mea adds /messages). */
  baseUrl: string;
  apiKey?: string;
  headers?: Record<string, string>;
}

type Block = { type: "text"; text: string; cache_control?: { type: "ephemeral"; ttl?: "1h" } };
interface AMessage {
  role: "user" | "assistant";
  content: Block[];
}

const THINKING_BUDGET: Record<string, number> = { minimal: 1024, low: 2048, medium: 6000, high: 12000, xhigh: 18000, max: 24000 };

/**
 * What a Claude model accepts (H2). From Claude 4.6 on there is no assistant prefill and thinking is
 * adaptive with an effort level; from Opus 4.7 / Sonnet 5 on, sampling parameters are rejected (Sonnet
 * and Haiku 5.5 reject non-default values, so they're left out too); Opus 5.5 and Fable can't turn
 * thinking off, so they get low effort when it isn't asked for. Unknown `claude-*` ids from major version 5 up get the
 * modern rules; anything else (Haiku 4.5, Sonnet/Opus 4.5 and earlier, claude-3*) keeps the old ones.
 */
export interface ClaudeCaps {
  /** temperature / top_p / top_k may be sent. */
  sampling: boolean;
  /** Thinking is `adaptive` + `output_config.effort` (else `enabled` with `budget_tokens`). */
  adaptive: boolean;
  /** A trailing assistant message (prefill) is accepted. */
  prefill: boolean;
  /** Leaving `thinking` out still thinks: Mea asks for low effort when reasoning is off. */
  alwaysThinks: boolean;
  /** The `xhigh` effort level exists (Opus 4.7 on). */
  xhigh: boolean;
  /** Thinking text comes back empty unless `display: "summarized"` is asked for (Opus 4.7 on). */
  omitsThinking: boolean;
}

const LEGACY: ClaudeCaps = { sampling: true, adaptive: false, prefill: true, alwaysThinks: false, xhigh: false, omitsThinking: false };

export function claudeCaps(model: string): ClaudeCaps {
  const id = model.toLowerCase();
  // "claude-opus-4-7", "anthropic/claude-sonnet-5.5", "claude-haiku-4-5-20251001", a new family "claude-x-5"; claude-3-5-sonnet doesn't match.
  const m = id.match(/claude-([a-z]+)-(\d+)(?:[-.](\d)(?!\d))?/);
  const named = /claude-(fable|mythos)\b/.test(id);
  if (!m && !named) return LEGACY;
  const fable = named || m?.[1] === "fable" || m?.[1] === "mythos";
  const v = m ? Number(m[2]) + Number(m[3] ?? 0) / 10 : 5;
  if (!fable && v < 4.6) return LEGACY;
  return { sampling: !fable && v < 4.7, adaptive: true, prefill: false, alwaysThinks: fable || (m?.[1] === "opus" && v >= 5.5), xhigh: fable || v >= 4.7, omitsThinking: fable || v >= 4.7 };
}

/** Mea's reasoning effort as an Anthropic effort level. */
function effortFor(effort: string, caps: ClaudeCaps) {
  const e = effort === "minimal" ? "low" : ["low", "medium", "high", "xhigh", "max"].includes(effort) ? effort : "medium";
  return e === "xhigh" && !caps.xhigh ? "high" : e;
}

/** H3: max_tokens as sent: the reply's own budget plus room for thinking when the model thinks. */
export function claudeOutputTokens(model: string, p: GenerationParams) {
  const base = p.max_tokens ?? 1200;
  if (p.reasoning_effort) return base + (THINKING_BUDGET[p.reasoning_effort] ?? THINKING_BUDGET.medium!);
  return claudeCaps(model).alwaysThinks ? base + THINKING_BUDGET.low! : base;
}

/** M18: Anthropic's stop reasons in the words the rest of Mea checks ("length" for a cut-off reply). */
function stopReason(r: string | undefined) {
  return r === "max_tokens" ? "length" : r === "end_turn" || r === "stop_sequence" ? "stop" : r;
}

const NOTE_RULE = "Text inside <mea_note> tags comes from Mea, the app running this story (its notes and instructions for you), never from the player or their character.";

/** L9: the note rule rides at the end of the last system block, so the cache breakpoint stays where it was. */
function addNoteRule(system: Block[]) {
  const last = system.at(-1);
  if (!last) system.push({ type: "text", text: NOTE_RULE });
  else if (!last.text.endsWith(NOTE_RULE)) last.text = `${last.text}\n\n${NOTE_RULE}`;
}

/**
 * Converts Mea's message list to Anthropic Messages format (CONN-23):
 * leading system messages become system blocks, later system notes become user turns,
 * same-role neighbours are merged, and `cache_control` breakpoints are placed after the
 * stable prefix and at the end of the history (CONN-12).
 */
export function toAnthropic(req: StreamRequest) {
  const msgs = req.messages;
  let lead = 0;
  while (lead < msgs.length && msgs[lead]!.role === "system") lead++;
  const system: Block[] = msgs.slice(0, lead).map((m) => ({ type: "text", text: m.content }));

  const out: AMessage[] = [];
  /** original index → index in `out` */
  const where = new Map<number, number>();
  let notes = false;
  msgs.forEach((m: ChatMessage, i) => {
    if (i < lead) return;
    const role = m.role === "assistant" ? "assistant" : "user";
    if (!m.content.trim()) return;
    // L9: a system note rides in a user turn; the tag keeps it from reading as the player's words.
    const text = m.role === "system" ? `<mea_note>\n${m.content}\n</mea_note>` : m.content;
    if (m.role === "system") notes = true;
    const prev = out.at(-1);
    if (prev && prev.role === role) prev.content.push({ type: "text", text });
    else out.push({ role, content: [{ type: "text", text }] });
    where.set(i, out.length - 1);
  });
  if (notes) addNoteRule(system);
  if (!out.length || out[0]!.role !== "user") {
    out.unshift({ role: "user", content: [{ type: "text", text: "(The story so far.)" }] });
    for (const [k, v] of where) where.set(k, v + 1);
  }

  if (req.cache?.mode === "anthropic") {
    const cc = req.cache.ttl === "1h" ? ({ type: "ephemeral", ttl: "1h" } as const) : ({ type: "ephemeral" } as const);
    if (system.length) system.at(-1)!.cache_control = cc;
    // Find the converted message holding the end of the history; fall back to the nearest earlier one.
    let target: number | undefined;
    for (let i = Math.min(req.cache.historyEnd, msgs.length - 1); i >= lead && target === undefined; i--) target = where.get(i);
    if (target !== undefined) out[target]!.content.at(-1)!.cache_control = cc;
  }
  return { system, messages: out };
}

/** Claude via an Anthropic-compatible gateway such as LinkAPI (New API) (CONN-23). */
export class AnthropicProvider implements Provider {
  constructor(private opts: AnthropicOptions) {}

  private url(path: string) {
    return `${this.opts.baseUrl.replace(/\/+$/, "")}${path}`;
  }

  private headers(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      "anthropic-version": "2023-06-01",
      ...(this.opts.apiKey ? { "x-api-key": this.opts.apiKey, Authorization: `Bearer ${this.opts.apiKey}` } : {}),
      ...this.opts.headers,
    };
  }

  buildBody(req: StreamRequest): Record<string, unknown> {
    const { system, messages } = toAnthropic(req);
    const p = req.params;
    const caps = claudeCaps(req.model);
    const body: Record<string, unknown> = { model: req.model, max_tokens: claudeOutputTokens(req.model, p), stream: true, messages };
    if (system.length) body.system = system;
    if (caps.adaptive) {
      // H2: adaptive thinking with an effort level, never a budget.
      if (p.reasoning_effort) {
        body.thinking = caps.omitsThinking && !p.hide_reasoning ? { type: "adaptive", display: "summarized" } : { type: "adaptive" };
        body.output_config = { effort: effortFor(p.reasoning_effort, caps) };
      } else if (caps.alwaysThinks) body.output_config = { effort: "low" };
    } else if (p.reasoning_effort) {
      body.thinking = { type: "enabled", budget_tokens: THINKING_BUDGET[p.reasoning_effort] ?? THINKING_BUDGET.medium };
      // Extended thinking does not allow a prefilled assistant turn.
      if (messages.at(-1)?.role === "assistant") messages.pop();
    }
    if (caps.sampling && !body.thinking) {
      if (p.temperature !== undefined) body.temperature = Math.min(1, p.temperature);
      if (p.top_k) body.top_k = p.top_k;
      if (p.top_p !== undefined) body.top_p = p.top_p;
    }
    // H2: Claude 4.6 and later take no prefill: the start of the reply becomes a last instruction.
    if (!caps.prefill && messages.at(-1)?.role === "assistant") {
      const start = messages.pop()!.content.map((b) => b.text).join("\n\n");
      const note: Block = { type: "text", text: `<mea_note>\nBegin your reply with exactly: ${start}\n</mea_note>` };
      if (messages.at(-1)?.role === "user") messages.at(-1)!.content.push(note);
      else messages.push({ role: "user", content: [note] });
      addNoteRule(system);
      body.system = system;
    }
    if (p.stop?.length) body.stop_sequences = p.stop;
    return body;
  }

  outputTokens(model: string, params: GenerationParams) {
    return claudeOutputTokens(model, params);
  }

  async stream(req: StreamRequest, onDelta: (d: StreamDelta) => void): Promise<StreamResult> {
    const body = this.buildBody(req);
    let res: Response;
    try {
      res = await fetch(this.url("/messages"), { method: "POST", headers: { ...this.headers(), Accept: "text/event-stream" }, body: JSON.stringify(body), signal: req.signal });
    } catch (e) {
      if ((e as Error).name === "AbortError") throw e;
      throw new ProviderError(`Couldn't reach the provider: ${(e as Error).message}`);
    }
    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => "");
      throw httpError(res, describeError(res.status, text), text);
    }
    const result: StreamResult = { sentBody: body };
    let input = 0;
    let read = 0;
    let write = 0;
    let output = 0;
    const hide = Boolean(req.params.hide_reasoning);
    if (!(res.headers.get("content-type") ?? "").includes("event-stream")) {
      const json = (await res.json()) as Record<string, any>;
      for (const block of json.content ?? []) {
        if (block.type === "text" && block.text) onDelta({ text: block.text });
        if (block.type === "thinking" && block.thinking && !hide) onDelta({ reasoning: block.thinking });
      }
      const u = json.usage ?? {};
      result.finishReason = stopReason(json.stop_reason);
      result.usage = this.usage(u.input_tokens ?? 0, u.cache_read_input_tokens ?? 0, u.cache_creation_input_tokens ?? 0, u.output_tokens ?? 0);
      return result;
    }
    // M18: without message_stop, the connection dropped mid-reply.
    let ended = false;
    for await (const data of readSSE(res.body)) {
      let json: Record<string, any>;
      try {
        json = JSON.parse(data);
      } catch {
        continue;
      }
      switch (json.type) {
        case "message_start": {
          const u = json.message?.usage ?? {};
          input = u.input_tokens ?? 0;
          read = u.cache_read_input_tokens ?? 0;
          write = u.cache_creation_input_tokens ?? 0;
          output = u.output_tokens ?? 0;
          break;
        }
        case "content_block_delta": {
          const d = json.delta ?? {};
          if (d.type === "text_delta" && d.text) onDelta({ text: d.text });
          else if (d.type === "thinking_delta" && d.thinking && !hide) onDelta({ reasoning: d.thinking });
          break;
        }
        case "message_delta":
          if (json.delta?.stop_reason) result.finishReason = stopReason(json.delta.stop_reason);
          if (json.usage?.output_tokens != null) output = json.usage.output_tokens;
          if (json.usage?.input_tokens != null) input = json.usage.input_tokens;
          if (json.usage?.cache_read_input_tokens != null) read = json.usage.cache_read_input_tokens;
          if (json.usage?.cache_creation_input_tokens != null) write = json.usage.cache_creation_input_tokens;
          break;
        case "message_stop":
          ended = true;
          break;
        case "error":
          throw new ProviderError(json.error?.message ?? "Provider error", undefined, data);
      }
    }
    if (!ended) result.finishReason = INCOMPLETE;
    result.usage = this.usage(input, read, write, output);
    return result;
  }

  /** Anthropic's input_tokens excludes cache reads and writes; Mea stores the full prompt size. */
  private usage(input: number, read: number, write: number, output: number): StreamResult["usage"] {
    return { promptTokens: input + read + write, completionTokens: output, cachedTokens: read, cacheWriteTokens: write };
  }

  async listModels(): Promise<ModelInfo[]> {
    const res = await fetch(this.url("/models"), { headers: this.headers() });
    if (!res.ok) throw new ProviderError(describeError(res.status, await res.text().catch(() => "")), res.status);
    const json = (await res.json()) as { data?: Record<string, any>[] };
    return (json.data ?? []).map((m) => ({
      id: String(m.id),
      name: m.display_name ?? m.name ?? m.id,
      // H2: the Models API calls the context window max_input_tokens and the output cap max_tokens.
      contextLength: m.max_input_tokens ?? m.context_length ?? m.context_window ?? undefined,
      maxOutput: m.max_tokens ?? m.max_output_tokens ?? undefined,
      capabilities: { reasoning: /claude-(opus|sonnet|haiku|fable|mythos|3-7|4|5)/.test(String(m.id)) || undefined },
      pricing: m.pricing ?? {},
    }));
  }
}
