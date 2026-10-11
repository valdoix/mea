import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { normalizeCard } from "../src/cards/card";
import { newId, run } from "../src/db/db";
import { getSetting, setSetting } from "../src/lib/settings";
import { createCharacter } from "../src/services/characters";
import { chatCostToday, cheaperForBackground, replyCost } from "../src/services/chatcost";
import { addMessage, createChat, updateChat } from "../src/services/chats";
import { createConnection, createProfile, syncModels } from "../src/services/connections";
import { budgetMode, shouldShed } from "../src/services/quota";
import { statusTiles } from "../src/services/status";
import { freshDb } from "./helpers";

let chatId = "";
let replyId = "";

function gen(o: { task: string; kind: string; prompt: number; completion?: number; cost?: number; message?: string | null; at?: number; billing?: string }) {
  const id = newId();
  run(
    "INSERT INTO generations (id, chat_id, message_id, kind, task, billing, prompt_tokens, completion_tokens, cached_tokens, cost, status, started_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 'done', ?)",
    id,
    chatId,
    o.message ?? null,
    o.kind,
    o.task,
    o.billing ?? "subscription",
    o.prompt,
    o.completion ?? 0,
    o.cost ?? null,
    o.at ?? Date.now(),
  );
  return id;
}

beforeAll(async () => {
  freshDb();
  const { data } = normalizeCard({ spec: "chara_card_v2", data: { name: "Mira", first_mes: "Hi." } });
  chatId = createChat({ characterId: createCharacter(data) }).id;
  replyId = addMessage(chatId, "assistant", "The lamp hums.", { name: "Mira" });
  setSetting("quota.cache", { active: true, daily: { used: 0, limit: 100_000, remaining: 100_000, percentUsed: 0, resetAt: null }, weekly: null, recommendedMode: null, fetchedAt: Date.now() });
});
afterAll(() => setSetting("quota.cache", null));

describe("per-chat cost guard (H2)", () => {
  test("background work today, as a share of the day's quota; the tile warns past the share", () => {
    gen({ task: "story", kind: "story", prompt: 8000, completion: 400 });
    gen({ task: "summarizer", kind: "summary:scene", prompt: 9000 });
    gen({ task: "helper", kind: "check", prompt: 4000 });
    gen({ task: "tracker", kind: "tracker", prompt: 3000, at: Date.now() - 2 * 24 * 3600_000 });
    let c = chatCostToday(chatId);
    expect(c.background).toMatchObject({ tokens: 13000, requests: 2, quotaTokens: 13000 });
    expect(c.share).toBeCloseTo(0.13, 2);
    expect(c.over).toBe(false);
    expect(statusTiles(chatId).find((t) => t.id === "cost")).toBeUndefined();
    gen({ task: "world", kind: "world:telling", prompt: 20000 });
    c = chatCostToday(chatId);
    expect(c.over).toBe(true);
    expect(c.background.byKind[0]).toMatchObject({ kind: "world", tokens: 20000 });
    expect(statusTiles(chatId).find((t) => t.id === "cost")).toMatchObject({ value: "33%", n: 1 });
  });

  test("Budget mode turns off optional model reads for that chat only", () => {
    expect(shouldShed("lessons", chatId)).toBe(false);
    updateChat(chatId, { settings: { budgetMode: true } });
    expect(budgetMode(chatId)).toBe(true);
    expect(shouldShed("lessons", chatId)).toBe(true);
    expect(shouldShed("continuity", chatId)).toBe(true);
    expect(shouldShed("lessons")).toBe(false);
    updateChat(chatId, { settings: { budgetMode: false } });
  });

  test("cost per reply: writer, planner and the background it set off", () => {
    const w = gen({ task: "story", kind: "story", prompt: 5000, completion: 500, cost: 0.01, message: replyId });
    gen({ task: "helper", kind: "advisor", prompt: 1500, completion: 200, cost: 0.002, at: Date.now() - 60_000 });
    gen({ task: "tracker", kind: "tracker", prompt: 2000, completion: 100, cost: 0.001, message: replyId });
    const r = replyCost(w)!;
    expect(r.writer).toEqual({ tokens: 5500, cost: 0.01 });
    expect(r.planner?.tokens).toBe(1700);
    expect(r.background).toMatchObject({ tokens: 2100, requests: 1 });
    expect(r.total.tokens).toBe(9300);
    expect(r.total.cost).toBeCloseTo(0.013, 5);
  });

  test("Use a cheaper model for these: background routing moves to the cheapest priced profile", async () => {
    expect(() => cheaperForBackground()).toThrow();
    const conn = createConnection({ name: "Mock", kind: "mock", billing: "subscription" });
    await syncModels(conn);
    run("UPDATE models SET pricing = ? WHERE connection_id = ? AND model_id = 'mock/storyteller'", JSON.stringify({ prompt: 3, completion: 15 }), conn);
    run("UPDATE models SET pricing = ? WHERE connection_id = ? AND model_id = 'mock/fast'", JSON.stringify({ prompt: 0.1, completion: 0.4 }), conn);
    createProfile({ name: "Story", connectionId: conn, modelId: "mock/storyteller", params: {} });
    const p = createProfile({ name: "Cheap", connectionId: conn, modelId: "mock/fast", params: {} });
    const r = cheaperForBackground();
    expect(r.profile.name).toBe("Cheap");
    expect(getSetting("routing.tasks")).toMatchObject({ summarizer: p, helper: p, tracker: p, world: p });
  });
});
