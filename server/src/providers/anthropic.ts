import type { ChatMessage } from "../prompt/assemble";
import { describeError, readSSE } from "./openai";
import { type ModelInfo, type Provider, ProviderError, type StreamDelta, type StreamRequest, type StreamResult } from "./types";

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

const THINKING_BUDGET: Record<string, number> = { minimal: 1024, low: 2048, medium: 6000, high: 12000, max: 24000 };

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
  msgs.forEach((m: ChatMessage, i) => {
    if (i < lead) return;
    const role = m.role === "assistant" ? "assistant" : "user";
    const text = m.content;
    if (!text.trim()) return;
    const prev = out.at(-1);
    if (prev && prev.role === role) prev.content.push({ type: "text", text });
    else out.push({ role, content: [{ type: "text", text }] });
    where.set(i, out.length - 1);
  });
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
    const budget = p.reasoning_effort ? THINKING_BUDGET[p.reasoning_effort] : undefined;
    const maxTokens = (p.max_tokens ?? 1200) + (budget ?? 0);
    const body: Record<string, unknown> = { model: req.model, max_tokens: maxTokens, stream: true, messages };
    if (system.length) body.system = system;
    if (budget) {
      body.thinking = { type: "enabled", budget_tokens: budget };
      // Extended thinking does not allow a prefilled assistant turn.
      if (messages.at(-1)?.role === "assistant") messages.pop();
    } else {
      if (p.temperature !== undefined) body.temperature = Math.min(1, p.temperature);
      if (p.top_k) body.top_k = p.top_k;
    }
    if (p.top_p !== undefined && !budget) body.top_p = p.top_p;
    if (p.stop?.length) body.stop_sequences = p.stop;
    return body;
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
      throw new ProviderError(describeError(res.status, text), res.status, text.slice(0, 2000));
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
      result.finishReason = json.stop_reason;
      result.usage = this.usage(u.input_tokens ?? 0, u.cache_read_input_tokens ?? 0, u.cache_creation_input_tokens ?? 0, u.output_tokens ?? 0);
      return result;
    }
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
          if (json.delta?.stop_reason) result.finishReason = json.delta.stop_reason;
          if (json.usage?.output_tokens != null) output = json.usage.output_tokens;
          if (json.usage?.input_tokens != null) input = json.usage.input_tokens;
          if (json.usage?.cache_read_input_tokens != null) read = json.usage.cache_read_input_tokens;
          if (json.usage?.cache_creation_input_tokens != null) write = json.usage.cache_creation_input_tokens;
          break;
        case "error":
          throw new ProviderError(json.error?.message ?? "Provider error", undefined, data);
      }
    }
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
      contextLength: m.context_length ?? m.context_window ?? undefined,
      maxOutput: m.max_output_tokens ?? undefined,
      capabilities: { reasoning: /claude-(opus|sonnet|3-7|4|5)/.test(String(m.id)) || undefined },
      pricing: m.pricing ?? {},
    }));
  }
}
