import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { z } from "zod";
import { createApp } from "../src/app";
import { normalizeCard } from "../src/cards/card";
import { all, one, run } from "../src/db/db";
import { type MeaEvent, subscribe } from "../src/lib/events";
import { applyServicePrompt, replyContract, SERVICE_PROMPTS } from "../src/lib/prompts";
import { applyRegex, type RegexScript } from "../src/lib/regex";
import { defaultMemoryConfig, setSetting } from "../src/lib/settings";
import { boundarySystem, rollupSystem, sceneSystem, verifySystem } from "../src/memory/prompts";
import { type AssembleInput, assemblePrompt } from "../src/prompt/assemble";
import { meaPreset } from "../src/prompt/mea";
import { importStPreset } from "../src/prompt/preset";
import { AnthropicProvider, claudeCaps } from "../src/providers/anthropic";
import { OpenAIProvider } from "../src/providers/openai";
import { INCOMPLETE, ProviderError } from "../src/providers/types";
import { emptyCard } from "../src/cards/card";
import { tellingPrompt } from "../src/sim/telling";
import { createCharacter } from "../src/services/characters";
import { addMessage, createChat } from "../src/services/chats";
import { applyReasoning, createConnection, createProfile, listModels, resolveTaskChain, syncModels } from "../src/services/connections";
import { splitThink, thinkRouter } from "../src/services/generation";
import { registerJob } from "../src/services/jobs";
import { callJson } from "../src/services/llm";
import { purgeTrash } from "../src/services/trash";
import { initPrompt, updatePrompt } from "../src/trackers/prompts";
import { freshDb } from "./helpers";

// A small OpenAI- and Anthropic-compatible server whose behaviour is picked by the model id.
let server: ReturnType<typeof Bun.serve>;
let base = "";
const seen: { model: string; size: number; max_tokens?: number }[] = [];
let emptyCatalog = false;
const counts = new Map<string, number>();

const sse = (chunks: unknown[]) => new Response(chunks.map((c) => `data: ${typeof c === "string" ? c : JSON.stringify(c)}\n\n`).join(""), { headers: { "Content-Type": "text/event-stream" } });

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname.endsWith("/models")) {
        if (emptyCatalog) return Response.json({ data: [] });
        return Response.json({
          data: [
            { id: "overflow", context_length: 64000 },
            { id: "truncated", context_length: 64000 },
            { id: "claude-opus-4-7", max_input_tokens: 1000000, max_tokens: 128000 },
          ],
        });
      }
      const body = (await req.json()) as Record<string, any>;
      const n = (counts.get(body.model) ?? 0) + 1;
      counts.set(body.model, n);
      seen.push({ model: body.model, size: JSON.stringify(body.messages).length, max_tokens: body.max_tokens });
      if (url.pathname.endsWith("/messages")) {
        // Anthropic: a reply cut off at max_tokens, then (second model) a stream that drops before message_stop.
        const events = [
          { type: "message_start", message: { usage: { input_tokens: 10 } } },
          { type: "content_block_delta", delta: { type: "text_delta", text: "Half a" } },
        ];
        if (body.model === "claude-haiku-4-5") return sse(events);
        return sse([...events, { type: "message_delta", delta: { stop_reason: "max_tokens" }, usage: { output_tokens: 5 } }, { type: "message_stop" }]);
      }
      if (body.model === "overflow" && n === 1) return Response.json({ error: { message: "This model's maximum context length is 64000 tokens" } }, { status: 400 });
      if (body.model === "ratelimited") return Response.json({ error: { message: "slow down" } }, { status: 429, headers: { "Retry-After": "7" } });
      if (body.model === "nodone") return sse([{ choices: [{ delta: { content: "Half a sent" } }] }]);
      if (body.model === "truncated") {
        const content = n === 1 ? '{"items":["a","b",' : '{"items":["a"]}';
        return Response.json({ choices: [{ message: { content }, finish_reason: n === 1 ? "length" : "stop" }], usage: { prompt_tokens: 10, completion_tokens: 5 } });
      }
      return sse([{ choices: [{ delta: { content: "A fine reply." }, finish_reason: "stop" }] }, "[DONE]"]);
    },
  });
  base = `http://localhost:${server.port}/v1`;
});

afterAll(() => server.stop(true));

const signal = () => new AbortController().signal;

describe("Anthropic request rules per model (H2, L8, L9, M18)", () => {
  const p = new AnthropicProvider({ baseUrl: "http://x/v1" });
  const req = (model: string, params: Record<string, unknown>) => ({
    model,
    signal: signal(),
    params,
    messages: [
      { role: "system" as const, content: "Rules." },
      { role: "user" as const, content: "Hi" },
      { role: "assistant" as const, content: "She turned" },
    ],
  });

  test("capabilities by model id", () => {
    expect(claudeCaps("claude-haiku-4-5-20251001")).toMatchObject({ sampling: true, adaptive: false, prefill: true });
    expect(claudeCaps("claude-sonnet-4-20250514").adaptive).toBe(false);
    expect(claudeCaps("claude-3-5-sonnet-20241022").adaptive).toBe(false);
    expect(claudeCaps("claude-sonnet-4-6")).toMatchObject({ sampling: true, adaptive: true, prefill: false });
    expect(claudeCaps("claude-opus-4-7")).toMatchObject({ sampling: false, adaptive: true, alwaysThinks: false });
    expect(claudeCaps("anthropic/claude-sonnet-5.5")).toMatchObject({ sampling: false, alwaysThinks: false });
    expect(claudeCaps("claude-opus-5-5")).toMatchObject({ sampling: false, alwaysThinks: true });
    expect(claudeCaps("claude-fable-5-1")).toMatchObject({ sampling: false, alwaysThinks: true });
    expect(claudeCaps("claude-nova-5")).toMatchObject({ adaptive: true, prefill: false });
  });

  test("an older model keeps sampling, budget thinking and its prefill", () => {
    const plain = p.buildBody(req("claude-haiku-4-5", { temperature: 1.3, top_p: 0.9, top_k: 40, max_tokens: 500 }));
    expect(plain).toMatchObject({ temperature: 1, top_p: 0.9, top_k: 40, max_tokens: 500 });
    expect((plain.messages as any[]).at(-1)).toMatchObject({ role: "assistant", content: [{ text: "She turned" }] });
    const thinking = p.buildBody(req("claude-haiku-4-5", { temperature: 0.7, max_tokens: 500, reasoning_effort: "low" }));
    expect(thinking.thinking).toEqual({ type: "enabled", budget_tokens: 2048 });
    expect(thinking.max_tokens).toBe(2548);
    expect(thinking.temperature).toBeUndefined();
  });

  test("a current model: no sampling, adaptive thinking with an effort, the prefill as an instruction", () => {
    const b = p.buildBody(req("claude-opus-4-7", { temperature: 0.9, top_p: 0.9, top_k: 40, max_tokens: 500, reasoning_effort: "high" }));
    expect(b.temperature).toBeUndefined();
    expect(b.top_p).toBeUndefined();
    expect(b.top_k).toBeUndefined();
    expect(b.thinking).toMatchObject({ type: "adaptive" });
    expect(b.output_config).toEqual({ effort: "high" });
    const last = (b.messages as any[]).at(-1);
    expect(last.role).toBe("user");
    expect(last.content.at(-1).text).toContain("Begin your reply with exactly: She turned");
    expect(JSON.stringify(b.system)).toContain("<mea_note>");
    // Sonnet 5.5 without reasoning: nothing about thinking, no sampling values
    const s = p.buildBody(req("claude-sonnet-5-5", { temperature: 0.9, max_tokens: 500 }));
    expect(s.thinking).toBeUndefined();
    expect(s.temperature).toBeUndefined();
    // Opus 5.5 can't turn thinking off: low effort, and room for it in max_tokens (H3)
    const o = p.buildBody(req("claude-opus-5-5", { max_tokens: 500 }));
    expect(o.thinking).toBeUndefined();
    expect(o.output_config).toEqual({ effort: "low" });
    expect(o.max_tokens).toBeGreaterThan(500);
    expect(p.outputTokens("claude-opus-5-5", { max_tokens: 500 })).toBe(o.max_tokens as number);
  });

  test("max_tokens reads as length; a stream without message_stop is incomplete; catalog limits", async () => {
    const a = new AnthropicProvider({ baseUrl: base });
    const cut = await a.stream({ model: "claude-opus-4-7", messages: [{ role: "user", content: "hi" }], params: {}, signal: signal() }, () => {});
    expect(cut.finishReason).toBe("length");
    const dropped = await a.stream({ model: "claude-haiku-4-5", messages: [{ role: "user", content: "hi" }], params: {}, signal: signal() }, () => {});
    expect(dropped.finishReason).toBe(INCOMPLETE);
  });

  test("a story request never ends on a reply already written (L8)", () => {
    const preset = importStPreset({ prompts: [{ identifier: "main", name: "Main", role: "system", content: "Be {{char}}." }, { identifier: "chatHistory", name: "Chat History", marker: true }], prompt_order: [{ character_id: 100001, order: [{ identifier: "main", enabled: true }, { identifier: "chatHistory", enabled: true }] }] }, "Imported");
    const r = assemblePrompt(input({ preset: { ...preset, waitPrompt: "" }, history: [{ id: "1", role: "assistant", content: "Welcome." }] }));
    expect(r.messages.at(-1)!.role).toBe("system");
  });
});

const input = (over: Partial<AssembleInput> = {}): AssembleInput => ({
  kind: "story",
  preset: meaPreset(),
  card: { ...emptyCard("Mira"), description: "Keeper of the lighthouse." },
  userName: "Ash",
  personaText: "",
  mode: "companion",
  history: [
    { id: "1", role: "assistant", content: "Welcome, Ash." },
    { id: "2", role: "user", content: "Hello Mira." },
  ],
  lore: null,
  contextTarget: 48000,
  modelId: "test",
  vars: {},
  seed: "c",
  ...over,
});

describe("prompt budget (H3)", () => {
  test("the reply's room comes off the prompt target (H3)", () => {
    const small = assemblePrompt(input({ reserve: 1000 })).trace.budget;
    const big = assemblePrompt(input({ reserve: 9000 })).trace.budget;
    expect(JSON.stringify(small)).not.toBe(JSON.stringify(big));
  });
});

describe("helper prompts and calls (M14, M15, M16, M17, M18, M33, L3)", () => {
  beforeAll(() => freshDb());

  test("replacing any service prompt keeps its reply format (M16)", () => {
    const names = { char: "Mira", user: "Ash" };
    const prompts: Record<string, string> = {
      tracker: updatePrompt({ state: "", messages: "", userName: "Ash", charName: "Mira", sealed: true, romance: "slow" }).system,
      "tracker:start": initPrompt({ userName: "Ash", charName: "Mira", card: "", persona: "", greeting: "", templates: [], sealed: true }).system,
      scene: sceneSystem(names, defaultMemoryConfig),
      verify: verifySystem(),
      chapter: rollupSystem("chapter", names, defaultMemoryConfig),
      "gate:scene": boundarySystem(),
      "world:telling": tellingPrompt([], { userName: "Ash", truths: [], genres: [] }).system,
    };
    for (const [kind, system] of Object.entries(prompts)) {
      const contract = replyContract(system);
      expect(contract.length).toBeGreaterThan(20);
      const id = SERVICE_PROMPTS.find((p) => p.match(kind))!.id;
      const out = applyServicePrompt(kind, system, { id: "s", name: "S", overrides: { [id]: { mode: "replace", text: "Be brief." } } });
      expect(out.startsWith("Be brief.")).toBe(true);
      expect(out.endsWith(contract)).toBe(true);
    }
    // the tracker's line grammar is part of what survives
    expect(replyContract(prompts.tracker!)).toContain("Omission never means removal");
  });

  test("a leading think block moves out of the story (M17)", () => {
    expect(splitThink("<think>plan the beat</think>\n\nShe smiled.")).toEqual({ text: "She smiled.", reasoning: "plan the beat" });
    expect(splitThink("She smiled. <think>no</think>")).toEqual({ text: "She smiled. <think>no</think>", reasoning: "" });
  });

  test("the <think> planning block goes to reasoning while it streams, even split mid-tag", () => {
    const run = (chunks: string[]) => {
      const r = thinkRouter();
      const out = { text: "", reasoning: "" };
      for (const c of [...chunks.map((x) => r.push(x)), r.end()]) {
        out.text += c.text;
        out.reasoning += c.reasoning;
      }
      return out;
    };
    expect(run(["\n<thi", "nk>NOW — dusk", "; SEAL — said</th", "ink>\n\nShe smiled."])).toEqual({ text: "She smiled.", reasoning: "NOW — dusk; SEAL — said" });
    expect(run(["<thinking>plan</thinking>Rain."])).toEqual({ text: "Rain.", reasoning: "plan" });
    expect(run(["She ", "smiled. <think>x</think>"])).toEqual({ text: "She smiled. <think>x</think>", reasoning: "" });
    expect(run(["<", "b>Bold</b> move"])).toEqual({ text: "<b>Bold</b> move", reasoning: "" });
    expect(run(["<think>never closed"])).toEqual({ text: "", reasoning: "never closed" });
  });

  test("no provider reasoning by default: reasoning models are asked to stop where they can", () => {
    const openai = { kind: "openai", extra: null } as never;
    const anthropic = { kind: "openai", extra: JSON.stringify({ format: "anthropic" }) } as never;
    const check = (effort: string | undefined, conn: never, caps: Record<string, unknown> | undefined) => {
      const params: { reasoning_effort?: string } = effort === undefined ? {} : { reasoning_effort: effort };
      return { reasons: applyReasoning(params, conn, caps), sent: params.reasoning_effort };
    };
    expect(check(undefined, openai, {})).toEqual({ reasons: false, sent: undefined });
    expect(check(undefined, openai, { reasoning: true })).toEqual({ reasons: false, sent: "none" });
    expect(check(undefined, openai, { reasoning_efforts: ["none", "low", "high"] })).toEqual({ reasons: false, sent: "none" });
    expect(check(undefined, openai, { reasoning_efforts: ["low", "high"] })).toEqual({ reasons: true, sent: undefined });
    expect(check(undefined, anthropic, { reasoning: true })).toEqual({ reasons: false, sent: undefined });
    expect(check("model", openai, { reasoning: true })).toEqual({ reasons: true, sent: undefined });
    expect(check("high", openai, {})).toEqual({ reasons: true, sent: "high" });
  });

  test("a stream with no end marker is incomplete; Retry-After is kept (M18)", async () => {
    const p = new OpenAIProvider({ baseUrl: base });
    const r = await p.stream({ model: "nodone", messages: [{ role: "user", content: "hi" }], params: {}, signal: signal() }, () => {});
    expect(r.finishReason).toBe(INCOMPLETE);
    const err = await p.stream({ model: "ratelimited", messages: [], params: {}, signal: signal() }, () => {}).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.retryAfterMs).toBe(7000);
  });

  test("a slow prompt-mode regex script is skipped for the rest of the prompt (M33)", () => {
    const slow: RegexScript = { id: "slow", name: "Slow", find: "/(\\w+\\s?)+$/", replace: "", enabled: true, mode: "prompt", targets: ["ai"], characterIds: [] } as RegexScript;
    const pass = { slow: new Set<string>() };
    const text = `${"word ".repeat(60)}!`;
    const t0 = performance.now();
    applyRegex(text, [slow], { role: "ai", mode: "prompt" }, pass);
    const first = performance.now() - t0;
    if (first > 50) {
      expect(pass.slow.has("slow")).toBe(true);
      const t1 = performance.now();
      for (let i = 0; i < 20; i++) applyRegex(`${text}${i}`, [slow], { role: "ai", mode: "prompt" }, pass);
      expect(performance.now() - t1).toBeLessThan(first);
    }
    // fast scripts run as before, and a repeat of the same text is cached
    const fast = { ...slow, id: "fast", find: "/Mira/g", replace: "M" } as RegexScript;
    const p2 = { slow: new Set<string>() };
    expect(applyRegex("Mira and Mira", [fast], { role: "ai", mode: "prompt" }, p2)).toBe("M and M");
    expect(applyRegex("Mira and Mira", [fast], { role: "ai", mode: "prompt" }, p2)).toBe("M and M");
  });

  test("a truncated JSON reply is retried with more room (M14); helpers don't borrow the story's reasoning (M15)", async () => {
    const conn = createConnection({ name: "Local", kind: "openai", baseUrl: base, billing: "paygo" });
    await syncModels(conn);
    const story = createProfile({ name: "Story", connectionId: conn, modelId: "truncated", params: { reasoning_effort: "high", max_tokens: 900 } });
    setSetting("routing.story", story);
    const chain = resolveTaskChain("summarizer");
    expect(chain[0]!.params.reasoning_effort).toBeUndefined();
    expect(resolveTaskChain("story")[0]!.params.reasoning_effort).toBe("high");
    seen.length = 0;
    const r = await callJson({ task: "summarizer", kind: "scene", name: "items", schema: z.object({ items: z.array(z.string()) }), system: "List items. Reply with JSON only.", user: "go", maxTokens: 300 });
    expect(r.data.items).toEqual(["a"]);
    const calls = seen.filter((s) => s.model === "truncated");
    expect(calls.length).toBe(2);
    expect(calls[1]!.max_tokens).toBe(calls[0]!.max_tokens! * 2);
  });

  test("an empty model list keeps the saved catalog (L3)", async () => {
    const conn = createConnection({ name: "Local 2", kind: "openai", baseUrl: base, billing: "paygo" });
    await syncModels(conn);
    const before = listModels(conn).length;
    expect(before).toBeGreaterThan(0);
    emptyCatalog = true;
    try {
      await expect(syncModels(conn)).rejects.toThrow(/empty list/);
    } finally {
      emptyCatalog = false;
    }
    expect(listModels(conn).length).toBe(before);
    // H2: the Models API names Claude's limits max_input_tokens / max_tokens
    const claude = createConnection({ name: "Claude", kind: "openai", format: "anthropic", baseUrl: base, billing: "paygo" });
    await syncModels(claude);
    expect(listModels(claude).find((m) => m.id === "claude-opus-4-7")).toMatchObject({ contextLength: 1000000, maxOutput: 128000 });
  });
});

let app: ReturnType<typeof createApp>;
const local = { requestIP: () => ({ address: "127.0.0.1", family: "IPv4", port: 5000 }) };
async function api<T = any>(method: string, path: string, body?: unknown): Promise<{ status: number; json: T }> {
  const res = await app.fetch(new Request(`http://localhost${path}`, { method, headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined }), local);
  return { status: res.status, json: (await res.json().catch(() => null)) as T };
}

function waitFor(pred: (e: MeaEvent) => boolean, timeout = 8000) {
  return new Promise<MeaEvent>((resolve, reject) => {
    const t = setTimeout(() => {
      off();
      reject(new Error("timeout waiting for event"));
    }, timeout);
    const off = subscribe((e) => {
      if (pred(e)) {
        clearTimeout(t);
        off();
        resolve(e);
      }
    });
  });
}

function newChat() {
  const { data } = normalizeCard({ spec: "chara_card_v2", data: { name: "Mira", description: "Keeper of the lighthouse.", first_mes: "Welcome, {{user}}." } });
  return createChat({ characterId: createCharacter(data) }).id;
}

describe("sending (H8, C2, H3)", () => {
  beforeAll(() => {
    freshDb();
    for (const kind of ["memory.segment", "memory.build", "memory.embed", "quota.refresh", "cache.probe", "trackers.update", "accuracy.check"]) registerJob(kind, async () => {});
    app = createApp();
  });

  test("a resent message is stored once; stored tells the outbox it's safe (H8)", async () => {
    const chatId = newChat();
    const count = () => one<{ n: number }>("SELECT COUNT(*) AS n FROM messages WHERE chat_id = ? AND role = 'user'", chatId)!.n;
    // No model yet: the reply can't start, but the message is kept.
    const first = await api("POST", `/api/chats/${chatId}/send`, { content: "Hello?", clientId: "out-1" });
    expect(first.status).toBe(400);
    expect(first.json.stored).toBe(true);
    const again = await api("POST", `/api/chats/${chatId}/send`, { content: "Hello?", clientId: "out-1" });
    expect(again.status).toBe(200);
    expect(again.json).toMatchObject({ duplicate: true, userMessage: { id: first.json.userMessage.id } });
    expect(count()).toBe(1);
    const nothing = await api("POST", `/api/chats/${chatId}/send`, { clientId: "out-2" });
    expect(nothing.json.stored).toBe(false);
  });

  test("deleting a chat while its reply streams doesn't crash (C2)", async () => {
    const rejections: unknown[] = [];
    const onRejection = (e: unknown) => rejections.push(e);
    process.on("unhandledRejection", onRejection);
    const conn = createConnection({ name: "Mock", kind: "mock", billing: "subscription" });
    await syncModels(conn);
    setSetting("routing.story", createProfile({ name: "Story", connectionId: conn, modelId: "mock/storyteller", params: {} }));
    process.env.MEA_MOCK_DELAY = "15";
    try {
      for (const hard of [false, true]) {
        const chatId = newChat();
        const delta = waitFor((e) => e.type === "gen.delta" && (e as any).chatId === chatId);
        const end = waitFor((e) => e.type === "gen.end" && (e as any).chatId === chatId);
        const r = await api("POST", `/api/chats/${chatId}/send`, { content: "I hold up the lantern." });
        expect(r.status).toBe(200);
        await delta;
        if (hard) {
          // emptying the trash under a running reply: the rows are gone for good
          run("UPDATE chats SET deleted_at = 1 WHERE id = ?", chatId);
          purgeTrash(Date.now());
        } else expect((await api("DELETE", `/api/chats/${chatId}`)).status).toBe(200);
        await end;
        await Bun.sleep(100);
        if (!hard) expect(all<{ status: string }>("SELECT s.status FROM swipes s JOIN messages m ON m.id = s.message_id WHERE m.chat_id = ?", chatId).some((s) => s.status === "streaming")).toBe(false);
      }
    } finally {
      process.env.MEA_MOCK_DELAY = "0";
      process.off("unhandledRejection", onRejection);
    }
    expect(rejections).toEqual([]);
  });

  test("the overflow retry always sends a smaller prompt (H3)", async () => {
    const conn = createConnection({ name: "Local", kind: "openai", baseUrl: base, billing: "paygo" });
    await syncModels(conn);
    setSetting("routing.story", createProfile({ name: "Overflow", connectionId: conn, modelId: "overflow", params: { context_target: 12000, max_tokens: 2000 } }));
    setSetting("memory.config", { ...defaultMemoryConfig, enabled: false });
    const chatId = newChat();
    const filler = "The sea rolls against the rocks while the lantern hums above them, warm and patient. ".repeat(12);
    for (let i = 0; i < 60; i++) addMessage(chatId, i % 2 ? "assistant" : "user", `Line ${i}. ${filler}`, { name: i % 2 ? "Mira" : "You" });
    seen.length = 0;
    counts.delete("overflow");
    const end = waitFor((e) => e.type === "gen.end" && (e as any).chatId === chatId);
    const r = await api("POST", `/api/chats/${chatId}/send`, { content: "Go on." });
    expect(r.status).toBe(200);
    expect((await end as any).status).toBe("done");
    const calls = seen.filter((s) => s.model === "overflow");
    expect(calls.length).toBe(2);
    expect(calls[1]!.size).toBeLessThan(calls[0]!.size);
  });
});
