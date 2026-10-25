import { describeError } from "./openai";
import { HTTP_HINTS, httpError } from "./types";

/**
 * LinkAPI's billing (CONN-25). LinkAPI runs New API, which keeps money as integer "quota":
 * `quota_per_unit` of it make one currency unit, shown the way the gateway's own dashboard does.
 * The API key reads its own balance; an optional dashboard access token plus user ID reads the
 * wallet and per-model usage.
 */

export const LINKAPI_HOST = "linkapi.ai";
const TIMEOUT_MS = 20_000;
/** Request logs are read at most this many pages deep when the usage table is off. */
const LOG_PAGES = 10;
const LOG_PAGE_SIZE = 100;
const WALLET_HINT = "Check the access token and user ID.";

export function isLinkApi(baseUrl: string) {
  try {
    const host = new URL(baseUrl).hostname;
    return host === LINKAPI_HOST || host.endsWith(`.${LINKAPI_HOST}`);
  } catch {
    return false;
  }
}

/** How the gateway displays quota: `symbol` + quota / perUnit × rate. TOKENS shows raw quota. */
export interface CurrencyDisplay {
  perUnit: number;
  symbol: string;
  rate: number;
  tokens: boolean;
}

export interface ModelSpend {
  model: string;
  requests: number;
  tokens: number;
  quota: number;
}

export interface LinkApiBalance {
  currency: CurrencyDisplay;
  key: { name: string | null; granted: number; used: number; available: number; unlimited: boolean; expiresAt: number | null } | null;
  keyError: string | null;
  wallet: { available: number; used: number; requests: number | null; group: string | null } | null;
  walletError: string | null;
  usage: { days: number; models: ModelSpend[]; partial: boolean; source: "data" | "logs" } | null;
  usageError: string | null;
  fetchedAt: number;
}

export interface LinkApiOptions {
  baseUrl: string;
  apiKey?: string;
  wallet?: { accessToken: string; userId: string } | null;
  headers?: Record<string, string>;
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : Number(v) || 0);

export class LinkApiBilling {
  readonly origin: string;
  constructor(private opts: LinkApiOptions) {
    this.origin = new URL(opts.baseUrl).origin;
  }

  private async getJson(path: string, auth: Record<string, string>): Promise<any> {
    const res = await fetch(`${this.origin}${path}`, { headers: { Accept: "application/json", ...this.opts.headers, ...auth }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    const text = await res.text();
    if (!res.ok) {
      const msg = describeError(res.status, text);
      throw httpError(res, auth["New-Api-User"] ? msg.replace(HTTP_HINTS[0], WALLET_HINT) : msg, text);
    }
    let j: any;
    try {
      j = JSON.parse(text);
    } catch {
      throw new Error(`LinkAPI sent something that isn't JSON from ${path}`);
    }
    // New API answers dashboard errors with HTTP 200 and success: false.
    if (j && j.success === false) throw new Error(`${j.message || `LinkAPI refused ${path}`}${auth["New-Api-User"] && /token|auth/i.test(j.message ?? "") ? ` · ${WALLET_HINT}` : ""}`);
    return j;
  }

  private walletAuth() {
    const w = this.opts.wallet!;
    return { Authorization: `Bearer ${w.accessToken}`, "New-Api-User": w.userId };
  }

  async currency(): Promise<CurrencyDisplay> {
    const d = (await this.getJson("/api/status", {})).data ?? {};
    const perUnit = num(d.quota_per_unit) || 500_000;
    const type = String(d.quota_display_type ?? (d.display_in_currency === false ? "TOKENS" : "USD")).toUpperCase();
    if (type === "TOKENS") return { perUnit, symbol: "", rate: 1, tokens: true };
    if (type === "CNY") return { perUnit, symbol: "¥", rate: num(d.usd_exchange_rate) || 1, tokens: false };
    if (type === "CUSTOM") return { perUnit, symbol: String(d.custom_currency_symbol ?? "¤"), rate: num(d.custom_currency_exchange_rate) || 1, tokens: false };
    return { perUnit, symbol: "$", rate: 1, tokens: false };
  }

  /** The API key's own balance; a key allowed to see its owner's quota also brings the wallet. */
  async keyBalance(): Promise<{ key: NonNullable<LinkApiBalance["key"]>; wallet: LinkApiBalance["wallet"] }> {
    const d = (await this.getJson("/api/usage/token/", { Authorization: `Bearer ${this.opts.apiKey ?? ""}` })).data ?? {};
    const uq = d.user_quota;
    return {
      key: {
        name: d.name ?? null,
        granted: num(d.total_granted),
        used: num(d.total_used),
        available: num(d.total_available),
        unlimited: Boolean(d.unlimited_quota),
        expiresAt: num(d.expires_at) > 0 ? num(d.expires_at) * 1000 : null,
      },
      wallet: uq ? { available: num(uq.total_available), used: num(uq.total_used), requests: null, group: null } : null,
    };
  }

  async wallet(): Promise<NonNullable<LinkApiBalance["wallet"]>> {
    const d = (await this.getJson("/api/user/self", this.walletAuth())).data ?? {};
    return { available: num(d.quota), used: num(d.used_quota), requests: d.request_count != null ? num(d.request_count) : null, group: d.group ?? null };
  }

  /**
   * Spend per model over the last `days`. The hourly usage table comes first; a gateway that keeps
   * it off (or limits its range) falls back to adding up the request logs.
   */
  async usage(days: number, nowMs = Date.now()): Promise<NonNullable<LinkApiBalance["usage"]>> {
    const end = Math.floor(nowMs / 1000);
    const start = end - days * 86_400;
    let tableError: unknown = null;
    try {
      const rows = (await this.getJson(`/api/data/self?start_timestamp=${start}&end_timestamp=${end}`, this.walletAuth())).data;
      if (Array.isArray(rows) && rows.length) {
        return { days, models: groupByModel(rows.map((r: any) => ({ model: r.model_name, requests: r.count, tokens: r.token_used, quota: r.quota }))), partial: false, source: "data" };
      }
    } catch (e) {
      tableError = e;
    }
    try {
      return await this.usageFromLogs(days, start, end);
    } catch (e) {
      throw tableError ?? e;
    }
  }

  private async usageFromLogs(days: number, start: number, end: number): Promise<NonNullable<LinkApiBalance["usage"]>> {
    const rows: { model: unknown; requests: number; tokens: unknown; quota: unknown }[] = [];
    let total = 0;
    for (let p = 1; p <= LOG_PAGES; p++) {
      const d = (await this.getJson(`/api/log/self?p=${p}&page_size=${LOG_PAGE_SIZE}&type=2&start_timestamp=${start}&end_timestamp=${end}`, this.walletAuth())).data;
      // Newer New API pages as { items, total }; older versions send the bare list.
      const items: any[] = Array.isArray(d) ? d : (d?.items ?? []);
      total = Array.isArray(d) ? rows.length + items.length + (items.length === LOG_PAGE_SIZE ? 1 : 0) : num(d?.total);
      for (const l of items) rows.push({ model: l.model_name, requests: 1, tokens: num(l.prompt_tokens) + num(l.completion_tokens), quota: l.quota });
      if (items.length < LOG_PAGE_SIZE) break;
    }
    return { days, models: groupByModel(rows), partial: total > rows.length, source: "logs" };
  }

  /** Every part that can be read; a part that fails says why instead of failing the rest. */
  async balance(days = 30): Promise<LinkApiBalance> {
    const why = (e: unknown) => (e as Error).message;
    const out: LinkApiBalance = { currency: await this.currency(), key: null, keyError: null, wallet: null, walletError: null, usage: null, usageError: null, fetchedAt: Date.now() };
    const [k, w, u] = await Promise.allSettled([
      this.opts.apiKey ? this.keyBalance() : Promise.reject(new Error("No API key")),
      this.opts.wallet ? this.wallet() : Promise.resolve(null),
      this.opts.wallet ? this.usage(days).catch((e) => (/range|exceed/i.test(why(e)) && days > 7 ? this.usage(7) : Promise.reject(e))) : Promise.resolve(null),
    ]);
    if (k.status === "fulfilled") {
      out.key = k.value.key;
      out.wallet = k.value.wallet;
    } else out.keyError = why(k.reason);
    if (w.status === "fulfilled") out.wallet = w.value ?? out.wallet;
    else out.walletError = why(w.reason);
    if (u.status === "fulfilled") out.usage = u.value;
    else out.usageError = why(u.reason);
    return out;
  }
}

function groupByModel(rows: { model: unknown; requests: unknown; tokens: unknown; quota: unknown }[]): ModelSpend[] {
  const by = new Map<string, ModelSpend>();
  for (const r of rows) {
    const model = String(r.model || "unknown");
    const m = by.get(model) ?? { model, requests: 0, tokens: 0, quota: 0 };
    m.requests += num(r.requests);
    m.tokens += num(r.tokens);
    m.quota += num(r.quota);
    by.set(model, m);
  }
  return [...by.values()].sort((a, b) => b.quota - a.quota);
}
