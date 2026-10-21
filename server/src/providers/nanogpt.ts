import { describeError, OpenAIProvider } from "./openai";
import { type ModelInfo, ProviderError } from "./types";

export const NANOGPT_BASE = "https://api.nano-gpt.com/api/v1";
/** The detailed catalog is large; past this a request is treated as failed. */
const CATALOG_TIMEOUT_MS = 30_000;
const CATALOG_RETRY_MS = 1000;

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

  /** A 5xx or a dropped connection is asked again once: NanoGPT's catalog endpoints hiccup. */
  private async getJson(url: string): Promise<Record<string, any>> {
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await fetch(url, { headers: this.headers(), signal: AbortSignal.timeout(CATALOG_TIMEOUT_MS) });
      } catch (e) {
        if (attempt < 1) {
          await Bun.sleep(CATALOG_RETRY_MS);
          continue;
        }
        throw new ProviderError(`Couldn't reach the provider: ${(e as Error).message}`);
      }
      if (res.status >= 500 && attempt < 1) {
        await res.body?.cancel().catch(() => {});
        await Bun.sleep(CATALOG_RETRY_MS);
        continue;
      }
      if (!res.ok) throw new ProviderError(describeError(res.status, await res.text().catch(() => "")), res.status);
      return (await res.json()) as Record<string, any>;
    }
  }

  /** Subscription-included models, from GET /api/subscription/v1/models?detailed=true. */
  async listSubscriptionModels(): Promise<ModelInfo[]> {
    const json = await this.getJson(`${this.origin}/api/subscription/v1/models?detailed=true`);
    return ((json.data ?? []) as Record<string, any>[]).map((m) => toModel(m, true));
  }

  /**
   * The full catalog, and the subscription list for its flags. Either one failing (NanoGPT's
   * subscription list often answers 503) no longer loses the catalog: without it Mea can't tell a
   * model reasons, so it can't ask it to stop, and every reply waits on a full thinking pass.
   */
  override async listModels(opts: { subscriptionOnly?: boolean } = {}): Promise<ModelInfo[]> {
    const [subRes, allRes] = await Promise.allSettled([this.listSubscriptionModels(), this.getJson(`${this.origin}/api/v1/models?detailed=true`)]);
    const sub = subRes.status === "fulfilled" ? subRes.value : null;
    const rows = allRes.status === "fulfilled" ? ((allRes.value.data ?? []) as Record<string, any>[]) : null;
    if (!rows) {
      // The subscription list alone is a whole catalog only for a subscription-only key.
      if (sub && opts.subscriptionOnly) return sub;
      throw (allRes as PromiseRejectedResult).reason;
    }
    // An authenticated detailed catalog marks each model's subscription itself.
    const included = (m: Record<string, any>) => (sub ? sub.some((s) => s.id === String(m.id)) : m.subscription?.included === true);
    if (opts.subscriptionOnly) {
      if (sub) return sub;
      // Without either list, a subscription key would be shown paid models it would be billed for.
      if (!rows.some((m) => typeof m.subscription?.included === "boolean")) throw (subRes as PromiseRejectedResult).reason;
      return rows.filter(included).map((m) => toModel(m, true));
    }
    const all = rows.map((m) => toModel(m, included(m)));
    const seen = new Set(all.map((m) => m.id));
    return [...all, ...(sub ?? []).filter((m) => !seen.has(m.id))];
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
