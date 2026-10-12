import { beforeAll, describe, expect, test } from "bun:test";
import { normalizeCard } from "../src/cards/card";
import { checkDb, dbHealth, one, run, tidyDb } from "../src/db/db";
import { defaultMemoryConfig, setSetting } from "../src/lib/settings";
import { buildSummary } from "../src/memory/build";
import { memoryInputs } from "../src/memory/context";
import { salience, sceneDigest } from "../src/memory/digest";
import { clearEmbeddingBlock, embeddingBlock, embeddingsEnabled, embedQueries, noteEmbedFailure } from "../src/memory/embed";
import { type LedgerRow, setMemState } from "../src/memory/store";
import { MockProvider } from "../src/providers/mock";
import { classifyError, ProviderError } from "../src/providers/types";
import { createCharacter } from "../src/services/characters";
import { addMessage, createChat, updateSwipe } from "../src/services/chats";
import { createConnection, createProfile, syncModels, updateConnection } from "../src/services/connections";
import { skipsPlans } from "../src/services/generation";
import { enqueue, registerJob, runningJobCount, waitForChatJobs } from "../src/services/jobs";
import { statusTiles } from "../src/services/status";
import { freshDb } from "./helpers";

/** The fixes and borrowings from the Lumiverse comparison (2026-10-12). */

let connId: string;
function chatWith(name = "Mira") {
  const { data } = normalizeCard({ spec: "chara_card_v2", data: { name, description: "Keeper of the lighthouse.", first_mes: "Welcome, {{user}}." } });
  return createChat({ characterId: createCharacter(data) }).id;
}

beforeAll(async () => {
  freshDb();
  for (const kind of ["memory.segment", "memory.build", "memory.embed", "memory.journal", "memory.consolidate", "lore.chronicle", "tracker.update", "accuracy.check"]) registerJob(kind, async () => {});
  connId = createConnection({ name: "Mock", kind: "mock", billing: "subscription" });
  await syncModels(connId);
  createProfile({ name: "Story", connectionId: connId, modelId: "mock/storyteller", params: { context_target: 4000, max_tokens: 400 } });
  setSetting("memory.config", { ...defaultMemoryConfig, boundaryCheck: false, lag: 1 });
});

describe("fix 2: provider errors are sorted by the provider's words, not Mea's hints", () => {
  test("a plain 429 is a rate limit, not a used-up quota", () => {
    expect(classifyError(429, "HTTP 429 · Too many requests. Please slow down. · Rate limit or quota reached.")).toBe("rate");
    expect(new ProviderError("HTTP 429 · Too many requests · Rate limit or quota reached.", 429).retryable).toBe(true);
  });
  test("a provider that says quota still means quota", () => {
    expect(classifyError(429, "HTTP 429 · Weekly limit reached for your subscription · Rate limit or quota reached.")).toBe("quota");
  });
  test("a key that can't pay is billing: permanent, never retried", () => {
    const e = new ProviderError("HTTP 429 · This API key is set to subscription-only billing and cannot spend from your balance. · Rate limit or quota reached.", 429);
    expect(e.kind).toBe("billing");
    expect(e.permanent).toBe(true);
    expect(e.retryable).toBe(false);
    expect(classifyError(402, "Payment Required")).toBe("billing");
    expect(new ProviderError("HTTP 401 · bad key · Check the API key.", 401).permanent).toBe(true);
  });
  test("a job that hits a permanent error fails at once", async () => {
    registerJob("t.permanent", async () => {
      throw new ProviderError("HTTP 401 · bad key", 401);
    });
    const id = enqueue("t.permanent", {}, { maxAttempts: 5 })!;
    await Bun.sleep(30);
    expect(one<{ status: string; attempts: number }>("SELECT status, attempts FROM jobs WHERE id = ?", id)).toMatchObject({ status: "failed", attempts: 1 });
  });
});

describe("fix 2: embeddings stop on a setup problem and say so once", () => {
  test("blocked: off for recall and lore, a status tile, lifted when the connection changes", async () => {
    setSetting("routing.embeddings", { connectionId: connId, model: "mock/embed", dims: 64 });
    expect(embeddingsEnabled()).toBe(true);
    noteEmbedFailure(new ProviderError("HTTP 429 · This API key is set to subscription-only billing", 429));
    expect(embeddingsEnabled()).toBe(false);
    expect(embeddingBlock()?.message).toContain("subscription-only");
    expect(await embedQueries(["anything"], 50)).toEqual([null]);
    expect(statusTiles(chatWith()).some((t) => t.id === "embeddings-off")).toBe(true);
    // Saving the connection (a new key) lifts it.
    await Bun.sleep(2);
    updateConnection(connId, { name: "Mock" });
    expect(embeddingBlock()).toBeNull();
    expect(embeddingsEnabled()).toBe(true);
  });
  test("a passing error (a 503) doesn't block", () => {
    noteEmbedFailure(new ProviderError("HTTP 503 · The provider had a problem; try again.", 503));
    expect(embeddingBlock()).toBeNull();
    clearEmbeddingBlock();
  });
});

describe("fix 1: query vectors never hold a reply for nothing", () => {
  test("a deadline stops the wait, not the request: the vector lands in the cache for next time", async () => {
    setSetting("routing.embeddings", { connectionId: connId, model: "mock/embed", dims: 64 });
    const original = MockProvider.prototype.embed;
    let calls = 0;
    MockProvider.prototype.embed = async function (this: MockProvider, texts, model, dims) {
      calls++;
      await Bun.sleep(80);
      return original.call(this, texts, model, dims);
    };
    try {
      const t0 = performance.now();
      expect(await embedQueries(["the slow lantern query"], 10)).toEqual([null]);
      expect(performance.now() - t0).toBeLessThan(60);
      // Asked again while it's on its way: no second request.
      expect(await embedQueries(["the slow lantern query"], 0)).toEqual([null]);
      await Bun.sleep(120);
      const [v] = await embedQueries(["the slow lantern query"], 0);
      expect(v).toBeInstanceOf(Float32Array);
      expect(calls).toBe(1);
    } finally {
      MockProvider.prototype.embed = original;
    }
  });
  test("nothing has left the window: no query is embedded at all", async () => {
    const chatId = chatWith();
    const msgId = addMessage(chatId, "user", "Where is the brass lantern?");
    const history = [{ id: msgId, role: "user" as const, content: "Where is the brass lantern?", seq: 1 }];
    const original = MockProvider.prototype.embed;
    let calls = 0;
    MockProvider.prototype.embed = async function (this: MockProvider, texts, model, dims) {
      calls++;
      return original.call(this, texts, model, dims);
    };
    try {
      const names = { char: "Mira", user: "You" };
      const cold = await memoryInputs(chatId, { history, chatMode: "companion", state: null, names });
      expect(cold.qvecs.every((v) => v === null)).toBe(true);
      expect(calls).toBe(0);
      setMemState(chatId, { evictedThrough: 1 });
      const warm = await memoryInputs(chatId, { history, chatMode: "companion", state: null, names });
      expect(warm.qvecs.some(Boolean)).toBe(true);
      expect(calls).toBeGreaterThan(0);
    } finally {
      MockProvider.prototype.embed = original;
    }
  });
});

describe("fix 3: the plan watch learns a model's habit across stories", () => {
  test("one skip in any chat makes the model plan first everywhere", () => {
    const a = chatWith("Ada");
    const b = chatWith("Bea");
    const m1 = addMessage(a, "assistant", "A reply.");
    updateSwipe(m1, 0, { meta: { model: "mock/habit", plan: "own" } });
    expect(skipsPlans("mock/habit")).toBe(false);
    const m2 = addMessage(b, "assistant", "Another reply.");
    updateSwipe(m2, 0, { meta: { model: "mock/habit", plan: "step", notes: ["planned in its own step: the first try skipped its plan"] } });
    expect(skipsPlans("mock/habit")).toBe(true);
    expect(skipsPlans("mock/other")).toBe(false);
  });
});

describe("fix 4: urgent jobs have a slot of their own; a send waits briefly for the trackers", () => {
  test("two long jobs running: an urgent one still starts, an ordinary one waits", async () => {
    let release = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const started: string[] = [];
    registerJob("t.slow", async (p) => {
      started.push(String(p.n));
      await gate;
    });
    registerJob("t.urgent", async () => {
      started.push("urgent");
    });
    enqueue("t.slow", { n: 1 });
    enqueue("t.slow", { n: 2 });
    enqueue("t.slow", { n: 3 });
    await Bun.sleep(20);
    expect(started.sort()).toEqual(["1", "2"]);
    enqueue("t.urgent", {}, { priority: 5 });
    await Bun.sleep(20);
    expect(started).toContain("urgent");
    expect(started).not.toContain("3");
    release();
    await Bun.sleep(30);
    expect(started).toContain("3");
    expect(runningJobCount()).toBe(0);
  });
  test("waits until the chat's tracker job is done, but not for the reply being rewritten", async () => {
    const chatId = chatWith();
    expect(await waitForChatJobs(chatId, ["tracker.update"], { timeoutMs: 500 })).toBe(0);
    let release = () => {};
    const gate = new Promise<void>((r) => (release = r));
    registerJob("tracker.update", () => gate);
    enqueue("tracker.update", { chatId, messageId: "m-old", swipeIdx: 0 }, { priority: 5 });
    await Bun.sleep(10);
    expect(await waitForChatJobs(chatId, ["tracker.update"], { timeoutMs: 1000, exceptMessageId: "m-old" })).toBe(0);
    let waited = false;
    setTimeout(release, 250);
    const ms = await waitForChatJobs(chatId, ["tracker.update"], { timeoutMs: 2000, onWait: () => (waited = true) });
    expect(waited).toBe(true);
    expect(ms).toBeGreaterThanOrEqual(200);
    expect(ms).toBeLessThan(1500);
    registerJob("tracker.update", async () => {});
  });
});

describe("borrowed: the database checks itself and tidies up", () => {
  test("a healthy database checks ok; tidying doesn't throw", () => {
    expect(checkDb()).toMatchObject({ ok: true, problems: [], repaired: false });
    expect(dbHealth()?.ok).toBe(true);
    expect(() => tidyDb()).not.toThrow();
    expect(statusTiles(chatWith()).some((t) => t.id === "db-health")).toBe(false);
  });
});

describe("borrowed: a scene keeps its telling lines when the helper can't write its record", () => {
  test("salience: feelings, promises and turns outrank scenery", () => {
    expect(salience('"I promise I will come back for you," Kael said, desperately afraid.')).toBeGreaterThan(salience("The sea was grey and the sky was grey too, as usual."));
    expect(salience("Suddenly Mira revealed the secret of the logbook to Joss.")).toBeGreaterThan(salience("They walked on along the road for a while."));
    expect(salience("Okay.")).toBe(0);
  });
  test("the digest keeps the best lines in story order, within its cap", () => {
    const rows: LedgerRow[] = [
      { id: "a", seq: 10, role: "user", name: null, content: "We walked along the shore. The sand was cold.", created_at: 0 },
      { id: "b", seq: 11, role: "assistant", name: null, content: 'Mira stopped. "I swear I will never leave you again," she said, tears in her eyes. The gulls called.', created_at: 0 },
      { id: "c", seq: 12, role: "user", name: null, content: "Suddenly Kael confessed that he had stolen the brass lantern.", created_at: 0 },
    ];
    const d = sceneDigest(rows, { char: "Mira", user: "Alex" })!;
    expect(d.title).toBe("Scene #10–#12 (kept by rules)");
    const lines = d.content.split("\n");
    expect(lines.some((l) => l.includes("I swear I will never leave you again"))).toBe(true);
    expect(lines.some((l) => l.startsWith("Alex (#12): Suddenly Kael confessed"))).toBe(true);
    expect(d.content.indexOf("#11")).toBeLessThan(d.content.indexOf("#12"));
    expect(d.content).not.toContain("The gulls called");
  });
  test("a failed scene build leaves the digest standing in, still marked failed", async () => {
    const chatId = chatWith();
    for (let i = 0; i < 4; i++) addMessage(chatId, i % 2 ? "assistant" : "user", i === 1 ? '"I promise to light the lamp every night," Mira vowed, trembling.' : "The tide came in slowly over the rocks by the harbor wall.");
    const id = "scene-digest-test";
    run("INSERT INTO summaries (id, chat_id, level, start_seq, end_seq, closed, state, created_at, updated_at) VALUES (?, ?, 'scene', 1, 4, 1, 'pending', 0, 0)", id, chatId);
    // The helper is down: every request fails with a server error.
    const original = MockProvider.prototype.stream;
    MockProvider.prototype.stream = async () => {
      throw new ProviderError("HTTP 500 · The provider had a problem; try again.", 500);
    };
    try {
      await buildSummary(id).catch(() => {});
    } finally {
      MockProvider.prototype.stream = original;
    }
    const row = one<{ state: string; content: string; data: string }>("SELECT state, content, data FROM summaries WHERE id = ?", id)!;
    expect(row.state).toBe("error");
    expect(row.content).toContain("I promise to light the lamp every night");
    expect(JSON.parse(row.data)).toMatchObject({ extractive: true });
  });
});
