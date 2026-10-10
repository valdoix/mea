import type { ChatMessage } from "../prompt/assemble";

export interface GenerationParams {
  temperature?: number;
  top_p?: number;
  top_k?: number;
  min_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  repetition_penalty?: number;
  max_tokens?: number;
  seed?: number;
  stop?: string[];
  reasoning_effort?: string;
  hide_reasoning?: boolean;
}

/**
 * Where the stable part of the prompt ends, for explicit caching (CONN-12).
 * Indexes point into `messages`. Subscription requests never carry this.
 */
export interface CacheHint {
  mode: "nanogpt" | "anthropic";
  ttl: "5m" | "1h";
  /** Last message of the stable prefix (system, card, summaries). */
  prefixEnd: number;
  /** Last history message before the per-turn dynamic block. */
  historyEnd: number;
}

export interface StreamRequest {
  model: string;
  messages: ChatMessage[];
  params: GenerationParams;
  signal: AbortSignal;
  cache?: CacheHint;
  /** OpenAI-style response_format (structured output for helpers). */
  responseFormat?: Record<string, unknown>;
}

export interface StreamDelta {
  text?: string;
  reasoning?: string;
}

export interface StreamResult {
  finishReason?: string;
  usage?: Usage;
  /** The request body actually sent (keys never included). */
  sentBody: Record<string, unknown>;
}

export interface Usage {
  promptTokens?: number;
  completionTokens?: number;
  /** Input tokens read from the provider's cache. */
  cachedTokens?: number;
  /** Input tokens written to the cache (Anthropic-style). */
  cacheWriteTokens?: number;
}

export interface EmbedResult {
  vectors: Float32Array[];
  promptTokens?: number;
}

export interface ModelInfo {
  id: string;
  name?: string;
  contextLength?: number;
  maxOutput?: number;
  capabilities?: Record<string, unknown>;
  pricing?: Record<string, unknown>;
  subscription?: boolean;
}

export interface Provider {
  stream(req: StreamRequest, onDelta: (d: StreamDelta) => void): Promise<StreamResult>;
  listModels(): Promise<ModelInfo[]>;
  /** H3: the output tokens a request will ask for (max_tokens plus any thinking allowance). */
  outputTokens?(model: string, params: GenerationParams): number;
  embed?(texts: string[], model: string, dims?: number, signal?: AbortSignal): Promise<EmbedResult>;
}

export type ErrorKind = "overflow" | "quota" | "auth" | "rate" | "server" | "network" | "refused" | "other";

export class ProviderError extends Error {
  kind: ErrorKind;
  /** M18: how long the provider asked us to wait (Retry-After), in ms. */
  retryAfterMs?: number;
  constructor(
    message: string,
    public status?: number,
    public body?: string,
  ) {
    super(message);
    this.kind = classifyError(status, `${message} ${body ?? ""}`);
  }
  /** Worth trying the next model in a fallback chain (CONN-05). */
  get retryable() {
    return this.kind === "server" || this.kind === "network" || this.kind === "rate" || this.kind === "other";
  }
}

/** M18: an HTTP error response as a ProviderError, with its Retry-After (seconds or a date) when given. */
export function httpError(res: Response, message: string, body: string): ProviderError {
  const err = new ProviderError(message, res.status, body.slice(0, 2000));
  const ra = res.headers.get("retry-after");
  if (ra) {
    const secs = Number(ra);
    const ms = Number.isFinite(secs) ? secs * 1000 : Date.parse(ra) - Date.now();
    if (Number.isFinite(ms) && ms > 0) err.retryAfterMs = ms;
  }
  return err;
}

/** M18: a stream that ended without its end marker (the connection dropped mid-reply). */
export const INCOMPLETE = "incomplete";

/** Sorts provider failures so Mea can react: shrink the prompt, fall back, or explain the quota. */
export function classifyError(status: number | undefined, text: string): ErrorKind {
  const t = text.toLowerCase();
  if (/context.{0,20}(length|window|limit)|maximum context|too many tokens|prompt is too long|input.{0,20}too long|reduce the length|exceeds? the (model'?s )?(maximum|context)|token limit/.test(t)) return "overflow";
  if (/quota|subscription (limit|usage)|weekly limit|daily limit|insufficient (balance|credits?)|usage limit/.test(t) && status !== 500) return "quota";
  if (status === 401 || status === 403) return "auth";
  if (status === 429) return "rate";
  if (status != null && status >= 500) return "server";
  if (status == null && /couldn't reach|fetch failed|network|econn|timed? ?out|socket/.test(t)) return "network";
  if (status === 400 || status === 404 || status === 422) return "refused";
  return "other";
}

/** Reads a context limit out of an overflow error, e.g. "maximum context length is 131072 tokens" (CTX-03). */
export function contextLimitFromError(text: string): number | null {
  const m =
    text.match(/maximum context length (?:is|of) (\d[\d,]*)/i) ??
    text.match(/context (?:length|window|limit)(?: of| is|:)? (\d[\d,]*)/i) ??
    text.match(/(\d[\d,]{3,}) tokens? (?:limit|maximum|max)/i) ??
    text.match(/(?:limit|maximum|max)(?: is| of)? (\d[\d,]{3,}) tokens/i);
  const n = m ? Number(m[1]!.replaceAll(",", "")) : NaN;
  return Number.isFinite(n) && n >= 1024 ? n : null;
}
