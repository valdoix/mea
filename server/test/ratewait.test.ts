import { beforeAll, describe, expect, test } from "bun:test";
import { z } from "zod";
import { all } from "../src/db/db";
import { createConnection, createProfile, syncModels } from "../src/services/connections";
import { callJson, callText, RATE_WAIT_MS, rateWait } from "../src/services/llm";
import { ProviderError } from "../src/providers/types";
import { freshDb } from "./helpers";

/** Audit of 15 November: 77 helper calls failed on HTTP 429 in 28 replies, with no other route to try. */
beforeAll(async () => {
  freshDb();
  const connId = createConnection({ name: "Mock", kind: "mock", billing: "subscription" });
  await syncModels(connId);
  createProfile({ name: "Story", connectionId: connId, modelId: "mock/storyteller", params: { context_target: 6000, max_tokens: 300 } });
});

const ask = (user: string, jobId?: string) => callJson({ task: "helper", kind: "librarian:query", name: "q", schema: z.any(), system: "Reply with JSON only.", user, jobId });
const tries = (user: string) => all<{ status: string }>("SELECT status FROM generations WHERE request LIKE ?", `%${user}%`).map((r) => r.status);

describe("a rate-limited helper waits and tries once more", () => {
  test("outside a job: one wait, one more try, and it goes through", async () => {
    await ask("MOCK_RATE_ONCE_a what happened at the rink?");
    expect(tries("MOCK_RATE_ONCE_a")).toEqual(["error", "done"]);
  });

  test("plain-text calls too", async () => {
    await callText({ task: "tracker", kind: "tracker", system: "Write lines.", user: "MOCK_RATE_ONCE_b the ledger" });
    expect(tries("MOCK_RATE_ONCE_b")).toEqual(["error", "done"]);
  });

  test("never more than once, and never inside a job (the queue tries it again later)", async () => {
    await expect(ask("MOCK_RATE_ALWAYS_c still busy")).rejects.toThrow(/429/);
    expect(tries("MOCK_RATE_ALWAYS_c")).toEqual(["error", "error"]);
    await expect(ask("MOCK_RATE_ONCE_d in a job", "job-1")).rejects.toThrow(/429/);
    expect(tries("MOCK_RATE_ONCE_d")).toEqual(["error"]);
  });

  test("the wait follows Retry-After, within bounds; other errors don't wait", () => {
    const rate = new ProviderError("HTTP 429", 429);
    expect(rateWait({}, rate)).toBe(RATE_WAIT_MS);
    rate.retryAfterMs = 60_000;
    expect(rateWait({}, rate)).toBe(8000);
    expect(rateWait({}, new ProviderError("HTTP 503", 503))).toBeNull();
    expect(rateWait({ rateRetried: true }, rate)).toBeNull();
  });
});
