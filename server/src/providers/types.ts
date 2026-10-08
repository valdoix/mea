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

export interface StreamRequest {
  model: string;
  messages: ChatMessage[];
  params: GenerationParams;
  signal: AbortSignal;
}

export interface StreamDelta {
  text?: string;
  reasoning?: string;
}

export interface StreamResult {
  finishReason?: string;
  usage?: { promptTokens?: number; completionTokens?: number; cachedTokens?: number };
  /** The request body actually sent (keys never included). */
  sentBody: Record<string, unknown>;
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
}

export class ProviderError extends Error {
  constructor(
    message: string,
    public status?: number,
    public body?: string,
  ) {
    super(message);
  }
}
