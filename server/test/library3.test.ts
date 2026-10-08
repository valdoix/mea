import { beforeAll, describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import { normalizeCard } from "../src/cards/card";
import { now, run } from "../src/db/db";
import { setSetting, defaultMemoryConfig } from "../src/lib/settings";
import { insertAtom } from "../src/memory/atoms";
import { createLorebook } from "../src/lore/service";
import { defaultEntry } from "../src/lore/types";
import { createCharacter } from "../src/services/characters";
import { addMessage, createChat } from "../src/services/chats";
import { createConnection, createProfile, syncModels } from "../src/services/connections";
import { registerJob } from "../src/services/jobs";
import { autoTitle } from "../src/services/stories";
import { linesToOps, writeEvents } from "../src/trackers/store";
import { freshDb } from "./helpers";

let app: ReturnType<typeof createApp>;
let chatId = "";
const ids: string[] = [];
const local = { requestIP: () => ({ address: "127.0.0.1", family: "IPv4", port: 5000 }) };

async function api<T = any>(method: string, path: string, body?: unknown): Promise<{ status: number; json: T }> {
  const res = await app.fetch(new Request(`http://localhost${path}`, { method, headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined }), local);
  return { status: res.status, json: (await res.json()) as T };
}

beforeAll(async () => {
  freshDb();
  for (const kind of ["memory.segment", "memory.build", "memory.embed", "memory.journal", "memory.consolidate", "lore.chronicle", "lore.embed", "accuracy.check", "quota.refresh", "cache.probe"]) registerJob(kind, async () => {});
  app = createApp();
  const conn = createConnection({ name: "Mock", kind: "mock", billing: "subscription" });
  await syncModels(conn);
  createProfile({ name: "Story", connectionId: conn, modelId: "mock/storyteller", params: { context_target: 4000 } });
  setSetting("memory.config", { ...defaultMemoryConfig, boundaryCheck: false });
  const { data } = normalizeCard({ spec: "chara_card_v2", data: { name: "Mira", description: "Keeper of the northern lighthouse.", first_mes: "Hello." } });
  chatId = createChat({ characterId: createCharacter(data) }).id;
  const base = now() - 3 * 86_400_000;
  for (let i = 0; i < 6; i++) {
    ids.push(addMessage(chatId, i % 2 ? "assistant" : "user", `Line ${i}: the brass lantern needs a new wick, number ${i}.`, { name: i % 2 ? "Mira" : "Alex" }));
    // Two sittings on two days.
    run("UPDATE messages SET created_at = ? WHERE id = ?", base + (i < 3 ? i * 120_000 : 86_400_000 + i * 120_000), ids[i]!);
  }
  insertAtom(chatId, null, { type: "promise", content: "Mira promised to replace the wick of the brass lantern.", importance: 8, entities: ["Mira"] }, [{ id: ids[1]!, seq: 3 }]);
  createLorebook({ name: "Town", entries: [defaultEntry({ comment: "The Wick Shop", keys: ["wick shop"], content: "A chandlery that sells lantern wicks." })] });
  writeEvents(chatId, { messageId: ids[1]!, swipeIdx: -1 }, linesToOps(["clock: Day 1 20:00", "cast: Mira@spot"]).ops, "model");
  run("INSERT INTO summaries (id, chat_id, level, start_seq, end_seq, closed, title, content, state, created_at, updated_at) VALUES ('st1', ?, 'story', 1, 6, 1, 'The Keeper and the Wick', 'Alex helps Mira.', 'ready', ?, ?)", chatId, now(), now());
});

describe("titles and covers (LIB-04)", () => {
  test("the Story So Far names the chat until you rename it", async () => {
    expect(autoTitle(chatId)).toBe("The Keeper and the Wick");
    await api("PATCH", `/api/chats/${chatId}`, { title: "My own title" });
    expect(autoTitle(chatId)).toBeNull();
    const back = await api("POST", `/api/chats/${chatId}/title/auto`);
    expect(back.json.title).toBe("The Keeper and the Wick");
    expect((await api("GET", `/api/chats/${chatId}/extras`)).json.titleLocked).toBe(false);
  });
});

describe("collections (LIB-06)", () => {
  test("built-ins, your own, membership and the chat list filter", async () => {
    const list = (await api("GET", "/api/collections")).json.collections;
    expect(list.map((c: { builtin: string }) => c.builtin)).toEqual(["ongoing", "finished", "favorites"]);
    const mine = (await api("POST", "/api/collections", { name: "Rainy days" })).json;
    await api("PUT", `/api/chats/${chatId}/collections/col-ongoing`, { member: true });
    const r = await api("PUT", `/api/chats/${chatId}/collections/col-finished`, { member: true });
    expect(r.json.collections).toEqual(["col-finished"]); // ongoing and finished exclude each other
    await api("PUT", `/api/chats/${chatId}/collections/${mine.id}`, { member: true });
    expect((await api("GET", `/api/chats?collection=${mine.id}`)).json.chats.map((c: { id: string }) => c.id)).toEqual([chatId]);
    expect((await api("DELETE", "/api/collections/col-favorites")).status).toBe(400);
    expect((await api("DELETE", `/api/collections/${mine.id}`)).status).toBe(200);
  });
});

describe("stats (LIB-07)", () => {
  test("messages, words, time spent, days active", async () => {
    const s = (await api("GET", `/api/chats/${chatId}/stats`)).json;
    expect(s.messages).toBe(7);
    expect(s.yourMessages).toBe(3);
    expect(s.words).toBeGreaterThan(40);
    expect(s.daysActive).toBeGreaterThanOrEqual(2);
    expect(s.minutesSpent).toBeGreaterThan(0);
    expect(s.memories).toBe(1);
    expect((await api("GET", "/api/stats")).json.messages).toBeGreaterThanOrEqual(7);
  });
});

describe("search everything (LIB-05)", () => {
  test("messages, characters, lore and memories in one box", async () => {
    const r = (await api("GET", `/api/search/all?q=${encodeURIComponent("wick")}`)).json;
    expect(r.counts.message).toBeGreaterThan(0);
    expect(r.counts.lore).toBe(1);
    expect(r.counts.memory).toBe(1);
    expect(r.results.find((x: { kind: string }) => x.kind === "message").link).toContain(`/chat/${chatId}?m=`);
    expect((await api("GET", `/api/search/all?q=${encodeURIComponent("northern lighthouse")}`)).json.counts.character).toBe(1);
    expect((await api("GET", `/api/search/all?q=${encodeURIComponent('"unbalanced')}`)).status).toBe(200);
  });
});

describe("every Phase 3 endpoint answers", () => {
  test("knowledge, accuracy, lore", async () => {
    for (const [method, path, body] of [
      ["GET", `/api/chats/${chatId}/entities`],
      ["GET", `/api/chats/${chatId}/entities/duplicates`],
      ["GET", `/api/chats/${chatId}/entity-graph`],
      ["GET", `/api/chats/${chatId}/ledgers`],
      ["GET", `/api/chats/${chatId}/journals`],
      ["GET", `/api/chats/${chatId}/reconcile`],
      ["GET", "/api/memory/profiles"],
      ["POST", `/api/chats/${chatId}/warm`],
      ["POST", `/api/chats/${chatId}/consolidate`],
      ["GET", `/api/chats/${chatId}/continuity`],
      ["POST", `/api/messages/${ids[5]}/check`],
      ["GET", `/api/chats/${chatId}/archivist`],
      ["POST", `/api/chats/${chatId}/archivist`, { question: "What did Mira promise?" }],
      ["GET", `/api/chats/${chatId}/codex`],
      ["GET", `/api/chats/${chatId}/quiz`],
      ["POST", `/api/chats/${chatId}/quiz`, { n: 2 }],
      ["GET", "/api/lore/templates"],
      ["POST", `/api/chats/${chatId}/lore/preview`, { draft: "to the wick shop" }],
      ["GET", `/api/chats/${chatId}/glossary`],
      ["GET", `/api/chats/${chatId}/chronicle`],
      ["POST", `/api/chats/${chatId}/remember`, { messageId: ids[2], text: "the brass lantern needs a new wick" }],
      ["POST", `/api/chats/${chatId}/correct/preview`, { wrong: "brass lantern" }],
    ] as [string, string, unknown?][]) {
      const r = await api(method, path, body);
      expect(`${method} ${path} ${r.status}`).toBe(`${method} ${path} ${r.status < 300 ? r.status : "ok"}`);
    }
    const ask = (await api("POST", `/api/chats/${chatId}/archivist`, { question: "What did Mira promise?" })).json;
    expect(ask.citations.length).toBeGreaterThan(0);
    const prof = await api("POST", "/api/memory/profiles/balanced");
    expect(prof.json.config.profile).toBe("balanced");
  });
});
