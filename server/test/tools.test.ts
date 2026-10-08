import { beforeAll, describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import { normalizeCard } from "../src/cards/card";
import { createCharacter } from "../src/services/characters";
import { addMessage, createChat } from "../src/services/chats";
import { createConnection, createProfile, syncModels } from "../src/services/connections";
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
  app = createApp();
  const conn = createConnection({ name: "Mock", kind: "mock", billing: "subscription" });
  await syncModels(conn);
  createProfile({ name: "Story", connectionId: conn, modelId: "mock/storyteller", params: {} });
  const { data } = normalizeCard({ spec: "chara_card_v2", data: { name: "Mira", description: "Keeper.", first_mes: "Hello." } });
  chatId = createChat({ characterId: createCharacter(data) }).id;
  for (let i = 0; i < 6; i++) ids.push(addMessage(chatId, i % 2 ? "assistant" : "user", `Line ${i} about the brass lantern number ${i}`, { name: i % 2 ? "Mira" : "Alex" }));
});

describe("chat tools API", () => {
  test("rewind and undo (CHAT-16)", async () => {
    const r = await api("POST", `/api/messages/${ids[2]}/rewind`);
    expect(r.json.deleted).toEqual(ids.slice(3));
    expect((await api("GET", `/api/chats/${chatId}/messages`)).json.messages).toHaveLength(4);
    await api("POST", `/api/chats/${chatId}/restore-messages`, { ids: r.json.deleted });
    expect((await api("GET", `/api/chats/${chatId}/messages`)).json.messages).toHaveLength(7);
  });

  test("drafts follow you (CHAT-17)", async () => {
    await api("PUT", `/api/chats/${chatId}/draft`, { text: "Half a thought", device: "phone" });
    const d = await api("GET", `/api/chats/${chatId}/draft`);
    expect(d.json).toMatchObject({ text: "Half a thought", device: "phone" });
    await api("PUT", `/api/chats/${chatId}/draft`, { text: "" });
    expect((await api("GET", `/api/chats/${chatId}/draft`)).json.text).toBe("");
  });

  test("search within a chat and everywhere (CHAT-18)", async () => {
    const r = await api("GET", `/api/search?q=${encodeURIComponent("lantern number 4")}`);
    expect(r.json.results).toHaveLength(1);
    expect(r.json.results[0]).toMatchObject({ messageId: ids[4], chatId });
    const s = r.json.results[0];
    expect(s.snippet.slice(s.match.start, s.match.start + s.match.length).toLowerCase()).toBe("lantern number 4");
    expect((await api("GET", `/api/search?q=brass&chatId=${chatId}`)).json.results).toHaveLength(6);
  });

  test("/ask and /recap (CHAT-15)", async () => {
    expect((await api("POST", `/api/chats/${chatId}/ask`, { question: "Where are we?" })).json.answer).toContain("lighthouse");
    expect((await api("POST", `/api/chats/${chatId}/recap`)).json.recap).toContain("Previously");
  });
});
