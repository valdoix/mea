import { type EmbedResult, httpError, INCOMPLETE, type ModelInfo, type Provider, ProviderError, type StreamDelta, type StreamRequest, type StreamResult } from "./types";

export interface OpenAIOptions {
  baseUrl: string;
  apiKey?: string;
  headers?: Record<string, string>;
  /** Extra body fields merged into every request. */
  extraBody?: Record<string, unknown>;
}

/** Reads a server-sent-events stream and yields each `data:` payload. */
export async function* readSSE(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).replace(/\r$/, "");
        buf = buf.slice(nl + 1);
        if (line.startsWith("data:")) yield line.slice(5).trimStart();
      }
    }
    if (buf.startsWith("data:")) yield buf.slice(5).trimStart();
  } finally {
    reader.releaseLock();
  }
}

export function buildBody(req: StreamRequest, extra: Record<string, unknown> = {}): Record<string, unknown> {
  const p = req.params;
  const body: Record<string, unknown> = {
    model: req.model,
    messages: req.messages,
    stream: true,
    stream_options: { include_usage: true },
    ...extra,
  };
  for (const k of ["temperature", "top_p", "top_k", "min_p", "frequency_penalty", "presence_penalty", "repetition_penalty", "max_tokens", "seed"] as const) {
    if (p[k] !== undefined && p[k] !== null) body[k] = p[k];
  }
  if (p.stop?.length) body.stop = p.stop;
  if (p.reasoning_effort) body.reasoning_effort = p.reasoning_effort;
  if (p.hide_reasoning) body.reasoning = { exclude: true };
  if (req.responseFormat) body.response_format = req.responseFormat;
  // NanoGPT's Claude cache helper (CONN-12). Only ever set for pay-as-you-go Claude.
  if (req.cache?.mode === "nanogpt") {
    body.prompt_caching = { enabled: true, ttl: req.cache.ttl, cut_after_message_index: Math.max(0, req.cache.historyEnd) };
  }
  return body;
}

/** Generic OpenAI Chat Completions provider (CONN-01): NanoGPT, LinkAPI, OpenRouter, local servers. */
export class OpenAIProvider implements Provider {
  constructor(protected opts: OpenAIOptions) {}

  protected url(path: string) {
    return `${this.opts.baseUrl.replace(/\/+$/, "")}${path}`;
  }

  protected headers(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      ...(this.opts.apiKey ? { Authorization: `Bearer ${this.opts.apiKey}` } : {}),
      ...this.opts.headers,
    };
  }

  async stream(req: StreamRequest, onDelta: (d: StreamDelta) => void): Promise<StreamResult> {
    const body = buildBody(req, this.opts.extraBody);
    let res: Response;
    try {
      res = await fetch(this.url("/chat/completions"), { method: "POST", headers: { ...this.headers(), Accept: "text/event-stream" }, body: JSON.stringify(body), signal: req.signal });
    } catch (e) {
      if ((e as Error).name === "AbortError") throw e;
      throw new ProviderError(`Couldn't reach the provider: ${(e as Error).message}`);
    }
    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => "");
      throw httpError(res, describeError(res.status, text), text);
    }
    const result: StreamResult = { sentBody: body };
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("event-stream")) {
      // Some servers ignore stream:true and return a single JSON response.
      const json = (await res.json()) as Record<string, any>;
      const msg = json.choices?.[0]?.message ?? {};
      const reasoning = msg.reasoning ?? msg.reasoning_content;
      if (reasoning) onDelta({ reasoning });
      if (msg.content) onDelta({ text: msg.content });
      result.finishReason = json.choices?.[0]?.finish_reason;
      result.usage = usageOf(json.usage);
      return result;
    }
    // M18: a stream that stops without [DONE] or a finish reason was cut off, not finished.
    let ended = false;
    for await (const data of readSSE(res.body)) {
      if (data === "[DONE]") {
        ended = true;
        break;
      }
      let json: Record<string, any>;
      try {
        json = JSON.parse(data);
      } catch {
        continue;
      }
      if (json.error) throw new ProviderError(typeof json.error === "string" ? json.error : (json.error.message ?? "Provider error"), undefined, data);
      const choice = json.choices?.[0];
      const delta = choice?.delta ?? {};
      const reasoning = delta.reasoning ?? delta.reasoning_content;
      if (typeof reasoning === "string" && reasoning) onDelta({ reasoning });
      if (typeof delta.content === "string" && delta.content) onDelta({ text: delta.content });
      if (choice?.finish_reason) {
        result.finishReason = choice.finish_reason;
        ended = true;
      }
      if (json.usage) result.usage = usageOf(json.usage);
    }
    if (!ended) result.finishReason = INCOMPLETE;
    return result;
  }

  /** OpenAI-style embeddings (NanoGPT: text-embedding-3-large with `dimensions`). */
  async embed(texts: string[], model: string, dims?: number, signal?: AbortSignal): Promise<EmbedResult> {
    let res: Response;
    try {
      res = await fetch(this.url("/embeddings"), {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({ model, input: texts, ...(dims ? { dimensions: dims } : {}), encoding_format: "float" }),
        signal,
      });
    } catch (e) {
      if ((e as Error).name === "AbortError") throw e;
      throw new ProviderError(`Couldn't reach the provider: ${(e as Error).message}`);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new ProviderError(describeError(res.status, text), res.status, text.slice(0, 2000));
    }
    const json = (await res.json()) as { data?: { index: number; embedding: number[] }[]; usage?: { prompt_tokens?: number } };
    const rows = [...(json.data ?? [])].sort((a, b) => a.index - b.index);
    if (rows.length !== texts.length) throw new ProviderError(`Expected ${texts.length} embeddings, got ${rows.length}`);
    return { vectors: rows.map((r) => Float32Array.from(r.embedding)), promptTokens: json.usage?.prompt_tokens };
  }

  async listModels(): Promise<ModelInfo[]> {
    const res = await fetch(this.url("/models"), { headers: this.headers() });
    if (!res.ok) throw new ProviderError(describeError(res.status, await res.text().catch(() => "")), res.status);
    const json = (await res.json()) as { data?: Record<string, any>[] };
    return (json.data ?? []).map((m) => ({
      id: String(m.id),
      name: m.name ?? m.id,
      contextLength: m.context_length ?? m.context_window ?? undefined,
      maxOutput: m.max_output_tokens ?? undefined,
      capabilities: m.capabilities ?? {},
      pricing: m.pricing ?? {},
    }));
  }
}

export function usageOf(u: Record<string, any> | undefined): StreamResult["usage"] {
  if (!u) return undefined;
  return {
    promptTokens: u.prompt_tokens ?? u.input_tokens,
    completionTokens: u.completion_tokens ?? u.output_tokens,
    cachedTokens: u.prompt_tokens_details?.cached_tokens ?? u.cache_read_input_tokens ?? u.prompt_cache_hit_tokens ?? undefined,
    cacheWriteTokens: u.cache_creation_input_tokens ?? u.prompt_tokens_details?.cache_write_tokens ?? undefined,
  };
}

export function describeError(status: number, body: string): string {
  let detail = "";
  try {
    const j = JSON.parse(body);
    detail = j.error?.message ?? j.message ?? (typeof j.error === "string" ? j.error : "");
  } catch {
    detail = body.slice(0, 300);
  }
  const hint =
    status === 401 || status === 403 ? "Check the API key." : status === 429 ? "Rate limit or quota reached." : status === 404 ? "Unknown model or wrong base URL." : status >= 500 ? "The provider had a problem; try again." : "";
  return [`HTTP ${status}`, detail, hint].filter(Boolean).join(" · ");
}
