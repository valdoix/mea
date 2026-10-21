import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { NanoGPTProvider } from "../src/providers/nanogpt";
import { OpenAIProvider } from "../src/providers/openai";
import { ProviderError } from "../src/providers/types";
import { createConnection, getConnectionRow, listModels, syncModels } from "../src/services/connections";
import { freshDb } from "./helpers";

let server: ReturnType<typeof Bun.serve>;
let base = "";
let lastBody: any = null;
let lastAuth: string | null = null;

const sse = (chunks: unknown[]) =>
  new Response(chunks.map((c) => `data: ${typeof c === "string" ? c : JSON.stringify(c)}\n\n`).join(""), { headers: { "Content-Type": "text/event-stream" } });

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      lastAuth = req.headers.get("authorization");
      if (url.pathname === "/api/v1/chat/completions") {
        lastBody = await req.json();
        if (lastBody.model === "broken") return new Response(JSON.stringify({ error: { message: "Model not found" } }), { status: 404 });
        if (lastBody.model === "plain") return Response.json({ choices: [{ message: { content: "Hi there", reasoning: "thinking" }, finish_reason: "stop" }], usage: { prompt_tokens: 12, completion_tokens: 2 } });
        return sse([
          { choices: [{ delta: { reasoning: "plan" } }] },
          { choices: [{ delta: { content: "Hello" } }] },
          { choices: [{ delta: { content: ", world" }, finish_reason: "stop" }] },
          { choices: [], usage: { prompt_tokens: 100, completion_tokens: 3, prompt_tokens_details: { cached_tokens: 80 } } },
          "[DONE]",
        ]);
      }
      if (url.pathname === "/api/v1/models") {
        return Response.json({ data: [{ id: "z-ai/glm-5.3", name: "GLM 5.3", context_length: 1048576, capabilities: { structured_output: true } }, { id: "anthropic/claude-sonnet-5.5", name: "Claude", context_length: 1000000 }] });
      }
      if (url.pathname === "/api/subscription/v1/models") return Response.json({ data: [{ id: "z-ai/glm-5.3", name: "GLM 5.3", context_length: 1048576 }] });
      if (url.pathname === "/api/subscription/v1/usage") {
        return Response.json({ active: true, limits: { weeklyInputTokens: 60_000_000, dailyInputTokens: null }, weeklyInputTokens: { used: 15_000_000, remaining: 45_000_000, percentUsed: 0.25, resetAt: 1_800_000_000_000 }, routing: { recommendedMode: "subscription" } });
      }
      return new Response("not found", { status: 404 });
    },
  });
  base = `http://localhost:${server.port}/api/v1`;
});

afterAll(() => server.stop(true));

describe("OpenAI-compatible streaming", () => {
  test("streams text and reasoning, reports usage incl. cached tokens", async () => {
    const p = new OpenAIProvider({ baseUrl: base, apiKey: "sk-test" });
    const text: string[] = [];
    const reasoning: string[] = [];
    const r = await p.stream(
      { model: "glm", messages: [{ role: "user", content: "hi" }], params: { temperature: 0.7, max_tokens: 100, reasoning_effort: "high" }, signal: new AbortController().signal },
      (d) => {
        if (d.text) text.push(d.text);
        if (d.reasoning) reasoning.push(d.reasoning);
      },
    );
    expect(text.join("")).toBe("Hello, world");
    expect(reasoning.join("")).toBe("plan");
    expect(r.usage).toEqual({ promptTokens: 100, completionTokens: 3, cachedTokens: 80 });
    expect(r.finishReason).toBe("stop");
    expect(lastAuth).toBe("Bearer sk-test");
    expect(lastBody).toMatchObject({ model: "glm", stream: true, temperature: 0.7, max_tokens: 100, reasoning_effort: "high" });
    expect(lastBody.top_k).toBeUndefined();
  });

  test("handles non-streaming JSON responses", async () => {
    const p = new OpenAIProvider({ baseUrl: base });
    let text = "";
    const r = await p.stream({ model: "plain", messages: [], params: {}, signal: new AbortController().signal }, (d) => (text += d.text ?? ""));
    expect(text).toBe("Hi there");
    expect(r.usage?.promptTokens).toBe(12);
  });

  test("turns HTTP errors into readable messages", async () => {
    const p = new OpenAIProvider({ baseUrl: base });
    const err = await p.stream({ model: "broken", messages: [], params: {}, signal: new AbortController().signal }, () => {}).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.message).toContain("HTTP 404");
    expect(err.message).toContain("Model not found");
  });
});

describe("NanoGPT", () => {
  test("catalog marks subscription models; subscription-only key lists only those", async () => {
    const p = new NanoGPTProvider({ baseUrl: base, apiKey: "k" });
    const all = await p.listModels();
    expect(all.find((m) => m.id === "z-ai/glm-5.3")?.subscription).toBe(true);
    expect(all.find((m) => m.id === "anthropic/claude-sonnet-5.5")?.subscription).toBe(false);
    const sub = await p.listModels({ subscriptionOnly: true });
    expect(sub.map((m) => m.id)).toEqual(["z-ai/glm-5.3"]);
  });

  test("the subscription list answering 503 doesn't lose the catalog (or its reasoning flags)", async () => {
    let subCalls = 0;
    let flaky = 0;
    const down = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/api/subscription/v1/models") {
          subCalls++;
          return new Response("Service Unavailable", { status: 503 });
        }
        if (url.pathname === "/api/v1/models") {
          // Once flaky, then fine: asked again, it loads.
          if (flaky++ === 0) return new Response("busy", { status: 503 });
          return Response.json({
            data: [
              { id: "z-ai/glm-5.3", capabilities: { reasoning: true }, reasoning_efforts: ["none", "high"], subscription: { included: true } },
              { id: "anthropic/claude-sonnet-5.5", subscription: { included: false } },
            ],
          });
        }
        return new Response("not found", { status: 404 });
      },
    });
    try {
      const p = new NanoGPTProvider({ baseUrl: `http://localhost:${down.port}/api/v1`, apiKey: "k" });
      const all = await p.listModels();
      expect(subCalls).toBe(2);
      expect(all.map((m) => [m.id, m.subscription])).toEqual([
        ["z-ai/glm-5.3", true],
        ["anthropic/claude-sonnet-5.5", false],
      ]);
      expect(all[0]!.capabilities).toMatchObject({ reasoning: true, reasoning_efforts: ["none", "high"] });
      // A subscription key gets only the included models, read from the catalog's own flags.
      expect((await p.listModels({ subscriptionOnly: true })).map((m) => m.id)).toEqual(["z-ai/glm-5.3"]);
    } finally {
      down.stop(true);
    }
  });

  test("a subscription key with no subscription list and no flags in the catalog fails rather than list paid models", async () => {
    const down = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/api/subscription/v1/models") return new Response("Service Unavailable", { status: 503 });
        return Response.json({ data: [{ id: "anthropic/claude-sonnet-5.5" }] });
      },
    });
    try {
      const p = new NanoGPTProvider({ baseUrl: `http://localhost:${down.port}/api/v1`, apiKey: "k" });
      const err = await p.listModels({ subscriptionOnly: true }).catch((e) => e);
      expect(err).toBeInstanceOf(ProviderError);
      expect(err.message).toContain("HTTP 503");
      // Pay-as-you-go still loads, saying it couldn't tell what's included (the sync keeps the saved flags).
      expect((await p.listModels()).map((m) => [m.id, m.subscription])).toEqual([["anthropic/claude-sonnet-5.5", undefined]]);
      expect(p.subscriptionProblem).toContain("subscription list didn't load (HTTP 503");
    } finally {
      down.stop(true);
    }
  });

  test("a sync while the subscription list is down keeps each model's saved label and says why", async () => {
    let down = false;
    const nano = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/api/subscription/v1/models") return down ? new Response("Service Unavailable", { status: 503 }) : Response.json({ data: [{ id: "z-ai/glm-5.3" }] });
        return Response.json({ data: [{ id: "z-ai/glm-5.3" }, { id: "anthropic/claude-sonnet-5.5" }] });
      },
    });
    try {
      freshDb();
      const id = createConnection({ name: "Nano", kind: "nanogpt", billing: "paygo", baseUrl: `http://localhost:${nano.port}/api/v1`, apiKey: "k" });
      const labels = () => Object.fromEntries(listModels(id).map((m) => [m.id, m.subscription]));
      await syncModels(id);
      expect(labels()).toEqual({ "z-ai/glm-5.3": true, "anthropic/claude-sonnet-5.5": false });
      down = true;
      await syncModels(id);
      expect(labels()).toEqual({ "z-ai/glm-5.3": true, "anthropic/claude-sonnet-5.5": false });
      expect(getConnectionRow(id)?.extra).toContain("subscription list didn't load");
    } finally {
      nano.stop(true);
    }
  });

  test("quota normalizes weekly input tokens", async () => {
    const q = await new NanoGPTProvider({ baseUrl: base, apiKey: "k" }).getQuota();
    expect(q.weekly).toMatchObject({ used: 15_000_000, limit: 60_000_000, percentUsed: 0.25 });
    expect(q.daily).toBeNull();
    expect(q.recommendedMode).toBe("subscription");
  });
});
