import { beforeAll, describe, expect, test } from "bun:test";
import { now, run } from "../src/db/db";
import { createConnection, createProfile, syncModels } from "../src/services/connections";
import { speedReport, speedTest, statsOf, verdictOf } from "../src/services/speed";
import { setSetting } from "../src/lib/settings";
import { freshDb } from "./helpers";

let connId = "";

beforeAll(async () => {
  freshDb();
  connId = createConnection({ name: "Mock", kind: "mock", billing: "subscription" });
  await syncModels(connId);
  setSetting("routing.story", createProfile({ name: "Story", connectionId: connId, modelId: "mock/storyteller", params: {} }));
});

const row = (startedAgoMs: number, secs: number, tokens: number, status = "done", error: string | null = null) => {
  const t = now() - startedAgoMs;
  run(
    "INSERT INTO generations (id, kind, task, connection_id, model_id, billing, status, error, started_at, first_token_at, finished_at, completion_tokens) VALUES (?, 'test', 'story', ?, 'mock/storyteller', 'subscription', ?, ?, ?, ?, ?, ?)",
    crypto.randomUUID(),
    connId,
    status,
    error,
    t,
    t + 2000,
    t + secs * 1000,
    tokens,
  );
};

describe("connection speed", () => {
  test("stats: medians, failures, restarts don't count", () => {
    const t = now();
    const s = statsOf([
      { status: "done", error: null, started_at: t, first_token_at: t + 1000, finished_at: t + 10_000, completion_tokens: 500 },
      { status: "done", error: null, started_at: t, first_token_at: t + 3000, finished_at: t + 20_000, completion_tokens: 500 },
      { status: "error", error: "ECONNRESET", started_at: t, first_token_at: null, finished_at: t + 5000, completion_tokens: null },
      { status: "error", error: "interrupted by restart", started_at: t, first_token_at: null, finished_at: null, completion_tokens: null },
    ]);
    expect(s.n).toBe(3);
    expect(s.firstWord).toBe(2);
    expect(s.tokensPerSec).toBe(37.5);
    expect(s.errorRate).toBe(0.33);
  });

  test("verdict compares now with usually", () => {
    const usual = { n: 20, firstWord: 2, tokensPerSec: 60, errorRate: 0 };
    expect(verdictOf({ n: 3, firstWord: 2, tokensPerSec: 50, errorRate: 0 }, usual)).toBe("normal");
    expect(verdictOf({ n: 3, firstWord: 2, tokensPerSec: 25, errorRate: 0 }, usual)).toBe("slow");
    expect(verdictOf({ n: 3, firstWord: 2, tokensPerSec: 6, errorRate: 0 }, usual)).toBe("very slow");
    expect(verdictOf({ n: 3, firstWord: 10, tokensPerSec: 60, errorRate: 0 }, usual)).toBe("very slow");
    expect(verdictOf({ n: 4, firstWord: 2, tokensPerSec: 60, errorRate: 0.5 }, usual)).toBe("failing");
    expect(verdictOf({ n: 1, firstWord: 2, tokensPerSec: 6, errorRate: 0 }, usual)).toBe("unknown");
  });

  test("report groups tasks on one model and reads history", () => {
    for (let i = 0; i < 5; i++) row(2 * 24 * 3600_000 + i * 60_000, 10, 600); // usually 60 tok/s
    for (let i = 0; i < 3; i++) row(30 * 60_000 + i * 60_000, 100, 600); // now 6 tok/s
    const [r] = speedReport();
    expect(r!.modelId).toBe("mock/storyteller");
    expect(r!.tasks).toContain("story");
    expect(r!.tasks).toContain("summarizer");
    expect(r!.usual.tokensPerSec).toBe(60);
    expect(r!.recent.tokensPerSec).toBe(6);
    expect(r!.verdict).toBe("very slow");
  });

  test("a live test measures and is logged", async () => {
    const t = await speedTest("summarizer");
    expect(t.ok).toBe(true);
    expect(t.tokens).toBeGreaterThan(0);
    expect(t.firstWord).not.toBeNull();
    expect(speedReport()[0]!.recent.n).toBe(4);
  });
});
