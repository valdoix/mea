import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { storyHealth } from "../src/accuracy/health";
import { createApp } from "../src/app";
import { normalizeCard } from "../src/cards/card";
import { createCharacter } from "../src/services/characters";
import { addMessage, createChat } from "../src/services/chats";
import { pauseJobs } from "../src/services/jobs";
import { createPersona } from "../src/services/personas";
import { currentFold, linesToOps, setStoryNames, writeEvents } from "../src/trackers/store";
import { freshDb } from "./helpers";

/** docs/32 Part 4: one click when Mea read a name wrong. */

let app: ReturnType<typeof createApp>;
let chatId = "";
const local = { requestIP: () => ({ address: "127.0.0.1", family: "IPv4", port: 5000 }) };
async function api<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await app.fetch(new Request(`http://localhost${path}`, { method, headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined }), local);
  expect(res.status).toBe(200);
  return (await res.json()) as T;
}
const cast = () => api<{ people: { name: string }[]; reread: { name: string; as: string | null; lines: number; lastSeq: number }[] }>("GET", `/api/chats/${chatId}/cast`);
const names = () => Object.values(currentFold(chatId).result.state.chars).map((c) => c.name);

beforeAll(() => {
  freshDb();
  pauseJobs(true);
  setStoryNames(true);
  app = createApp();
  const { data } = normalizeCard({ spec: "chara_card_v2", data: { name: "Buffy Summers", description: "Buffy Summers, twenty.", first_mes: "The lamp hums." } });
  chatId = createChat({ characterId: createCharacter(data), personaId: createPersona({ name: "Gabriel Winters", data: { description: "" } }) }).id;
  const reply = (text: string, lines: string[]) => writeEvents(chatId, { messageId: addMessage(chatId, "assistant", text, { name: "Buffy Summers" }), swipeIdx: 0 }, linesToOps(lines).ops, "model");
  reply("Buffy hands Gabriel the towel.", ["cast: Buffy Summers@spot · Gabriel Winters@spot", "body Gabriel Summers: arousal 4 — her hand"]);
  reply("A clerk folds the last of the shirts.", ["cast: Shannon@peri", "bond Buffy Summers>Gabriel Summers: trust +1 — he waited"]);
});
afterAll(() => {
  setStoryNames(false);
  pauseJobs(false);
});

describe("names read as someone else (docs/32 Part 4)", () => {
  test("the cast lists each one with whom it was read as, how many lines, and where last", async () => {
    const r = await cast();
    expect(r.reread).toEqual([
      { name: "Gabriel Summers", as: "Gabriel Winters", lines: 2, lastSeq: 3 },
      { name: "Shannon", as: null, lines: 1, lastSeq: 3 },
    ]);
    expect(r.people.map((p) => p.name)).not.toContain("Shannon");
  });

  test("Story health counts them until you've looked", async () => {
    const row = () => storyHealth(chatId).parts.find((p) => p.part === "reread")!;
    expect(row().score).toBe(80);
    expect(row().detail).toContain("Gabriel Summers (read as Gabriel Winters)");
    await api("POST", `/api/chats/${chatId}/cast/tidy`, { name: "Gabriel Summers", action: "seen" });
    expect(row().score).toBe(90);
    expect((await cast()).reread.map((x) => x.name)).toEqual(["Shannon"]);
  });

  test("'No, a new person' adds them under that name, survives a refold, and can be undone", async () => {
    await api("POST", `/api/chats/${chatId}/cast/tidy`, { name: "Shannon", action: "person" });
    expect(names()).toContain("Shannon");
    expect((await cast()).reread).toEqual([]);
    await api("POST", `/api/chats/${chatId}/cast/tidy`, { name: "Shannon", action: "undo" });
    expect(names()).not.toContain("Shannon");
    expect((await cast()).reread.map((x) => x.name)).toEqual(["Shannon"]);
  });

  test("the same for a blended name: it becomes its own person only when you say so", async () => {
    await api("POST", `/api/chats/${chatId}/cast/tidy`, { name: "Gabriel Summers", action: "person" });
    expect(names()).toContain("Gabriel Summers");
    await api("POST", `/api/chats/${chatId}/cast/tidy`, { name: "Gabriel Summers", action: "undo" });
    expect(names()).not.toContain("Gabriel Summers");
  });
});
