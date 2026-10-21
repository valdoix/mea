import { describeError, OpenAIProvider, type OpenAIOptions } from "./openai";
import { type ModelInfo, ProviderError } from "./types";

export const NANOGPT_BASE = "https://api.nano-gpt.com/api/v1";
/** The detailed catalog is large; past this a request is treated as failed. */
const CATALOG_TIMEOUT_MS = 30_000;
const CATALOG_RETRY_MS = 1000;
/**
 * NanoGPT answers the same API on both hosts, and one can be down while the other works: on
 * 2026-10-21 api.nano-gpt.com gave every request a bare 503 for hours while nano-gpt.com was fine.
 */
const MIRRORS: Record<string, string> = { "https://api.nano-gpt.com": "https://nano-gpt.com", "https://nano-gpt.com": "https://api.nano-gpt.com" };
/** After a host fails and its mirror answers, requests start on the mirror for this long. */
const MIRROR_STICKY_MS = 10 * 60_000;
/** Which host to try first, per configured origin; shared by every NanoGPT connection. */
const preferred = new Map<string, { origin: string; until: number }>();
/** Gateway errors: the host, not the request, is the problem. */
const hostDown = (status: number) => status === 502 || status === 503 || status === 504;

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

/** `subscription` undefined: NanoGPT didn't say (the saved flag is kept). */
function toModel(m: Record<string, any>, subscription: boolean | undefined): ModelInfo {
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
  /** Set by listModels when the models loaded but which ones the subscription includes couldn't be read. */
  subscriptionProblem: string | null = null;
  /** The other host to try when this one is down; null for a custom base URL. */
  private readonly mirror: string | null;

  constructor(opts: OpenAIOptions, mirror?: string | null) {
    super(opts);
    this.mirror = mirror !== undefined ? mirror : (MIRRORS[this.origin] ?? null);
  }

  private get origin() {
    return new URL(this.opts.baseUrl).origin;
  }

  /**
   * A dropped connection or a gateway error is asked again once on the mirror host. Only before any
   * reply has arrived: a stream cut off midway isn't repeated (it may already have been billed).
   */
  protected override async send(url: string, init: RequestInit): Promise<Response> {
    if (!this.mirror || !url.startsWith(this.origin)) return super.send(url, init);
    const pref = preferred.get(this.origin);
    const first = pref && pref.until > Date.now() ? pref.origin : this.origin;
    const second = first === this.origin ? this.mirror : this.origin;
    const at = (origin: string) => origin + url.slice(this.origin.length);
    let failed: unknown;
    try {
      const res = await super.send(at(first), init);
      if (!hostDown(res.status)) return res;
      failed = res;
    } catch (e) {
      if (init.signal?.aborted) throw e;
      failed = e;
    }
    let res: Response;
    try {
      res = await super.send(at(second), init);
    } catch (e) {
      // Neither host answered usefully: report the first one's failure.
      if (init.signal?.aborted) throw e;
      if (failed instanceof Response) return failed;
      throw failed;
    }
    if (failed instanceof Response) await failed.body?.cancel().catch(() => {});
    if (!hostDown(res.status)) {
      if (second === this.origin) preferred.delete(this.origin);
      else preferred.set(this.origin, { origin: second, until: Date.now() + MIRROR_STICKY_MS });
    }
    return res;
  }

  /** A 5xx or a dropped connection is asked again once: NanoGPT's catalog endpoints hiccup. */
  private async getJson(url: string): Promise<Record<string, any>> {
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await this.send(url, { headers: this.headers(), signal: AbortSignal.timeout(CATALOG_TIMEOUT_MS) });
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
    this.subscriptionProblem = null;
    const [subRes, allRes] = await Promise.allSettled([this.listSubscriptionModels(), this.getJson(`${this.origin}/api/v1/models?detailed=true`)]);
    const sub = subRes.status === "fulfilled" ? subRes.value : null;
    const rows = allRes.status === "fulfilled" ? ((allRes.value.data ?? []) as Record<string, any>[]) : null;
    if (!rows) {
      // The subscription list alone is a whole catalog only for a subscription-only key.
      if (sub && opts.subscriptionOnly) return sub;
      throw (allRes as PromiseRejectedResult).reason;
    }
    // An authenticated detailed catalog marks each model's subscription itself.
    const flagged = rows.some((m) => typeof m.subscription?.included === "boolean");
    const included = (m: Record<string, any>) => (sub ? sub.some((s) => s.id === String(m.id)) : flagged ? m.subscription?.included === true : undefined);
    this.subscriptionProblem =
      sub || flagged ? null : `NanoGPT's subscription list didn't load (${(subRes as PromiseRejectedResult).reason?.message ?? "no answer"}), so which models your subscription includes is unknown. Sync again later.`;
    if (opts.subscriptionOnly) {
      if (sub) return sub;
      // Without either list, a subscription key would be shown paid models it would be billed for.
      if (!flagged) throw (subRes as PromiseRejectedResult).reason;
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
