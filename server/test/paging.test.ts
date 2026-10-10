import { beforeAll, describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import { normalizeCard } from "../src/cards/card";
import { createCharacter } from "../src/services/characters";
import { addMessage, createChat, softDeleteMessage } from "../src/services/chats";
import { freshDb } from "./helpers";

// M21: the chat view reads a window of messages around a far jump target, then pages both ways.
let app: ReturnType<typeof createApp>;
let chatId = "";
const local = { requestIP: () => ({ address: "127.0.0.1", family: "IPv4", port: 5000 }) };
const get = async (path: string) => (await app.fetch(new Request(`http://localhost${path}`), local)).json() as Promise<any>;
const seqsOf = (r: { messages: { seq: number }[] }) => r.messages.map((m) => m.seq);

beforeAll(() => {
  freshDb();
  app = createApp();
  const { data } = normalizeCard({ spec: "chara_card_v2", data: { name: "Mira", description: "Keeper.", first_mes: "Hello." } });
  chatId = createChat({ characterId: createCharacter(data) }).id;
  // The greeting is seq 1; these are 2..500.
  const ids: string[] = [];
  for (let i = 0; i < 499; i++) ids.push(addMessage(chatId, i % 2 ? "user" : "assistant", `Line ${i + 2}`));
  softDeleteMessage(ids[248]!); // seq 250
});

describe("message windows (M21)", () => {
  test("around returns the target with older and newer neighbours", async () => {
    const r = await get(`/api/chats/${chatId}/messages?around=100&limit=40`);
    expect(seqsOf(r)).toEqual(Array.from({ length: 40 }, (_, i) => 81 + i));
    expect(r.hasMore).toBe(true);
    expect(r.hasNewer).toBe(true);
  });

  test("around near either end says there is nothing further that way", async () => {
    const start = await get(`/api/chats/${chatId}/messages?around=3&limit=40`);
    expect(start.messages[0].seq).toBe(1);
    expect(start.hasMore).toBe(false);
    expect(start.hasNewer).toBe(true);
    const end = await get(`/api/chats/${chatId}/messages?around=495&limit=40`);
    expect(end.messages.at(-1).seq).toBe(500);
    expect(end.hasNewer).toBe(false);
    // The live last message carries all its swipes, as in an ordinary page.
    expect(end.messages.at(-1).swipes).toBeTruthy();
  });

  test("around a deleted message lands on its neighbours, in order", async () => {
    const r = await get(`/api/chats/${chatId}/messages?around=250&limit=10`);
    const seqs = seqsOf(r);
    expect(seqs).not.toContain(250);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(seqs).toHaveLength(10);
  });

  test("forward pages report whether newer messages remain", async () => {
    const tail = await get(`/api/chats/${chatId}/messages?after=440&limit=60`);
    expect(tail.messages).toHaveLength(60);
    expect(tail.hasMore).toBe(false);
    expect((await get(`/api/chats/${chatId}/messages?after=300&limit=60`)).hasMore).toBe(true);
  });
});
