import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { all, one } from "../src/db/db";
import { isLinkApi, LinkApiBilling } from "../src/providers/linkapi";
import { connectionUpdate, createConnection, deleteConnection, getConnectionRow, listConnections, updateConnection, walletSecretId } from "../src/services/connections";
import { getSecret } from "../src/lib/crypto";
import { freshDb } from "./helpers";

/** A New API gateway with one key, one user, and a usage table that can be switched off. */
let server: ReturnType<typeof Bun.serve>;
let base = "";
let dataTable = true;
let seen: { path: string; auth: string | null; user: string | null }[] = [];

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    fetch(req) {
      const url = new URL(req.url);
      const auth = req.headers.get("authorization");
      const user = req.headers.get("new-api-user");
      seen.push({ path: url.pathname, auth, user });
      const walletOk = auth === "Bearer pat-1" && user === "42";
      if (url.pathname === "/api/status") return Response.json({ success: true, data: { quota_per_unit: 500000, display_in_currency: true, quota_display_type: "CNY", usd_exchange_rate: 1 } });
      if (url.pathname === "/api/usage/token/") {
        if (auth === "Bearer sk-limited")
          return Response.json({ code: true, message: "ok", data: { object: "token_usage", name: "mea", total_granted: 5_000_000, total_used: 1_250_000, total_available: 3_750_000, unlimited_quota: false, expires_at: 0 } });
        if (auth === "Bearer sk-open")
          return Response.json({ code: true, data: { name: "open", total_granted: 0, total_used: 900_000, total_available: 0, unlimited_quota: true, expires_at: 1_900_000_000, user_quota: { total_available: 7_000_000, total_used: 2_000_000 } } });
        return Response.json({ success: false, message: "Invalid token" }, { status: 401 });
      }
      if (!walletOk && url.pathname.startsWith("/api/")) return Response.json({ success: false, message: "Unauthorized, invalid access token" });
      if (url.pathname === "/api/user/self") return Response.json({ success: true, data: { id: 42, quota: 10_000_000, used_quota: 4_000_000, request_count: 321, group: "default" } });
      if (url.pathname === "/api/data/self") {
        if (!dataTable) return Response.json({ success: true, data: [] });
        return Response.json({
          success: true,
          data: [
            { model_name: "claude-opus-5-5", count: 3, token_used: 30_000, quota: 1_500_000 },
            { model_name: "gpt-5", count: 10, token_used: 5_000, quota: 100_000 },
            { model_name: "claude-opus-5-5", count: 2, token_used: 20_000, quota: 1_000_000 },
          ],
        });
      }
      if (url.pathname === "/api/log/self") {
        const p = Number(url.searchParams.get("p"));
        const items = p === 1 ? Array.from({ length: 100 }, () => ({ model_name: "gpt-5", quota: 1000, prompt_tokens: 10, completion_tokens: 5 })) : [{ model_name: "claude-opus-5-5", quota: 50_000, prompt_tokens: 900, completion_tokens: 100 }];
        return Response.json({ success: true, data: { items, total: 101, page: p, page_size: 100 } });
      }
      return new Response("not found", { status: 404 });
    },
  });
  base = `http://localhost:${server.port}/v1`;
});

afterAll(() => server.stop(true));

describe("LinkAPI billing", () => {
  test("recognizes linkapi.ai only", () => {
    expect(isLinkApi("https://linkapi.ai/v1")).toBe(true);
    expect(isLinkApi("https://api.linkapi.ai/v1")).toBe(true);
    expect(isLinkApi("https://notlinkapi.ai/v1")).toBe(false);
    expect(isLinkApi("https://openrouter.ai/api/v1")).toBe(false);
  });

  test("the key alone reads its own balance in the gateway's currency", async () => {
    const b = await new LinkApiBilling({ baseUrl: base, apiKey: "sk-limited" }).balance();
    expect(b.currency).toEqual({ perUnit: 500000, symbol: "¥", rate: 1, tokens: false });
    expect(b.key).toMatchObject({ name: "mea", granted: 5_000_000, used: 1_250_000, available: 3_750_000, unlimited: false, expiresAt: null });
    expect(b.wallet).toBeNull();
    expect(b.walletError).toBeNull();
    expect(b.usage).toBeNull();
  });

  test("a key allowed to see its owner's quota brings the wallet too", async () => {
    const b = await new LinkApiBilling({ baseUrl: base, apiKey: "sk-open" }).balance();
    expect(b.key).toMatchObject({ unlimited: true, used: 900_000, expiresAt: 1_900_000_000_000 });
    expect(b.wallet).toEqual({ available: 7_000_000, used: 2_000_000, requests: null, group: null });
  });

  test("wallet access reads the wallet and spend per model", async () => {
    dataTable = true;
    seen = [];
    const b = await new LinkApiBilling({ baseUrl: base, apiKey: "sk-limited", wallet: { accessToken: "pat-1", userId: "42" } }).balance(30);
    expect(b.wallet).toEqual({ available: 10_000_000, used: 4_000_000, requests: 321, group: "default" });
    expect(b.usage?.source).toBe("data");
    expect(b.usage?.models).toEqual([
      { model: "claude-opus-5-5", requests: 5, tokens: 50_000, quota: 2_500_000 },
      { model: "gpt-5", requests: 10, tokens: 5_000, quota: 100_000 },
    ]);
    const self = seen.find((s) => s.path === "/api/user/self")!;
    expect(self).toMatchObject({ auth: "Bearer pat-1", user: "42" });
  });

  test("with the usage table off, the request logs are added up", async () => {
    dataTable = false;
    const u = await new LinkApiBilling({ baseUrl: base, wallet: { accessToken: "pat-1", userId: "42" } }).usage(7);
    expect(u.source).toBe("logs");
    expect(u.partial).toBe(false);
    expect(u.models).toEqual([
      { model: "gpt-5", requests: 100, tokens: 1500, quota: 100_000 },
      { model: "claude-opus-5-5", requests: 1, tokens: 1000, quota: 50_000 },
    ]);
    dataTable = true;
  });

  test("a wrong access token fails the wallet but keeps the key balance", async () => {
    const b = await new LinkApiBilling({ baseUrl: base, apiKey: "sk-limited", wallet: { accessToken: "nope", userId: "42" } }).balance();
    expect(b.key?.available).toBe(3_750_000);
    expect(b.wallet).toBeNull();
    expect(b.walletError).toContain("invalid access token");
    expect(b.usageError).toContain("invalid access token");
  });
});

describe("LinkAPI wallet access on a connection", () => {
  test("is stored as a secret, masked, replaced in place, and removed with the connection", () => {
    freshDb();
    const id = createConnection({ name: "LinkAPI", kind: "openai", billing: "paygo", baseUrl: "https://linkapi.ai/v1", apiKey: "sk-abc" });
    expect(listConnections()[0]).toMatchObject({ linkApi: true, wallet: null });
    expect(() => updateConnection(id, { walletToken: "pat-secret-token" })).toThrow("user ID");

    updateConnection(id, { walletToken: "pat-secret-token", walletUserId: "42" });
    const secretId = walletSecretId(id)!;
    expect(getSecret(secretId)).toBe("pat-secret-token");
    const c = listConnections()[0]!;
    expect(c.wallet?.userId).toBe("42");
    expect(c.wallet?.tokenMask).not.toContain("secret");

    updateConnection(id, { walletToken: "pat-other-token" });
    expect(walletSecretId(id)).toBe(secretId);
    expect(getSecret(secretId)).toBe("pat-other-token");
    expect(listConnections()[0]!.wallet?.userId).toBe("42");

    deleteConnection(id);
    expect(getConnectionRow(id)).toBeUndefined();
    expect(one("SELECT 1 FROM secrets WHERE id = ?", secretId)).toBeUndefined();
  });

  test("an empty token removes it", () => {
    freshDb();
    const id = createConnection({ name: "LinkAPI", kind: "openai", billing: "paygo", baseUrl: "https://linkapi.ai/v1", apiKey: "sk-abc" });
    updateConnection(id, { walletToken: "pat-secret-token", walletUserId: "42" });
    updateConnection(id, { walletToken: "" });
    expect(listConnections()[0]!.wallet).toBeNull();
    expect(all("SELECT id FROM secrets")).toHaveLength(1);
  });

  test("an update that leaves billing out keeps it", () => {
    freshDb();
    const id = createConnection({ name: "LinkAPI", kind: "openai", billing: "paygo", baseUrl: "https://linkapi.ai/v1", apiKey: "sk-abc" });
    const input = connectionUpdate.parse({ walletToken: "pat-secret-token", walletUserId: "42" });
    expect(input.billing).toBeUndefined();
    updateConnection(id, input);
    expect(listConnections()[0]!.billing).toBe("paygo");
  });

  test("other OpenAI-compatible connections aren't LinkAPI", () => {
    freshDb();
    createConnection({ name: "OR", kind: "openai", billing: "paygo", baseUrl: "https://openrouter.ai/api/v1", apiKey: "sk-abc" });
    expect(listConnections()[0]!.linkApi).toBe(false);
  });
});
