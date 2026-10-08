import { describeError, OpenAIProvider } from "./openai";
import { type ModelInfo, ProviderError } from "./types";

export const NANOGPT_BASE = "https://api.nano-gpt.com/api/v1";

export interface QuotaWindow {
  used: number | null;
  limit: number | null;
  remaining: number | null;
  percentUsed: number | null;
  resetAt: number | null;
}

export interface Quota {
  active: boolean;
  daily: QuotaWindow | null;
  weekly: QuotaWindow | null;
  recommendedMode: string | null;
  fetchedAt: number;
}

function toModel(m: Record<string, any>, subscription: boolean): ModelInfo {
  return {
    id: String(m.id),
    name: m.name ?? m.id,
    contextLength: m.context_length ?? undefined,
    maxOutput: m.max_output_tokens ?? undefined,
    capabilities: { ...(m.capabilities ?? {}), reasoning_efforts: m.reasoning_efforts ?? undefined, input_modalities: m.architecture?.input_modalities },
    pricing: m.pricing ?? {},
    subscription,
  };
}

/** NanoGPT (CONN-11, CONN-13): detailed catalog, subscription catalog, quota. */
export class NanoGPTProvider extends OpenAIProvider {
  private get origin() {
    return new URL(this.opts.baseUrl).origin;
  }

  private async getJson(url: string): Promise<Record<string, any>> {
    const res = await fetch(url, { headers: this.headers() });
    if (!res.ok) throw new ProviderError(describeError(res.status, await res.text().catch(() => "")), res.status);
    return (await res.json()) as Record<string, any>;
  }

  /** Subscription-included models, from GET /api/subscription/v1/models?detailed=true. */
  async listSubscriptionModels(): Promise<ModelInfo[]> {
    const json = await this.getJson(`${this.origin}/api/subscription/v1/models?detailed=true`);
    return ((json.data ?? []) as Record<string, any>[]).map((m) => toModel(m, true));
  }

  override async listModels(opts: { subscriptionOnly?: boolean } = {}): Promise<ModelInfo[]> {
    const sub = await this.listSubscriptionModels();
    if (opts.subscriptionOnly) return sub;
    const subIds = new Set(sub.map((m) => m.id));
    const json = await this.getJson(`${this.origin}/api/v1/models?detailed=true`);
    const all = ((json.data ?? []) as Record<string, any>[]).map((m) => toModel(m, subIds.has(String(m.id))));
    const seen = new Set(all.map((m) => m.id));
    return [...all, ...sub.filter((m) => !seen.has(m.id))];
  }

  async getQuota(): Promise<Quota> {
    const j = await this.getJson(`${this.origin}/api/subscription/v1/usage`);
    const win = (w: Record<string, any> | null | undefined, limit: unknown): QuotaWindow | null => {
      if (!w && limit == null) return null;
      const lim = typeof limit === "number" ? limit : (w?.limit ?? null);
      const used = w?.used ?? null;
      return {
        used,
        limit: lim,
        remaining: w?.remaining ?? (lim != null && used != null ? Math.max(0, lim - used) : null),
        percentUsed: w?.percentUsed ?? (lim && used != null ? used / lim : null),
        resetAt: w?.resetAt ?? null,
      };
    };
    return {
      active: Boolean(j.active),
      daily: win(j.dailyInputTokens, j.limits?.dailyInputTokens),
      weekly: win(j.weeklyInputTokens, j.limits?.weeklyInputTokens),
      recommendedMode: j.routing?.recommendedMode ?? null,
      fetchedAt: Date.now(),
    };
  }
}
