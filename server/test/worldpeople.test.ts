import { beforeAll, describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import { normalizeCard } from "../src/cards/card";
import { createCharacter } from "../src/services/characters";
import { addMessage, createChat } from "../src/services/chats";
import { linesToOps, saveCastProfile, writeEvents } from "../src/trackers/store";
import { freshDb } from "./helpers";

/** Editing, merging and deleting people from the World page, through the cast endpoints. */
let app: ReturnType<typeof createApp>;
let chatId = "";
const local = { requestIP: () => ({ address: "127.0.0.1", family: "IPv4", port: 5000 }) };

async function api<T = any>(method: string, path: string, body?: unknown): Promise<{ status: number; json: T }> {
  const res = await app.fetch(new Request(`http://localhost${path}`, { method, headers: body !== undefined ? { "Content-Type": "application/json" } : {}, body: body !== undefined ? JSON.stringify(body) : undefined }), local);
  return { status: res.status, json: (await res.json()) as T };
}
const people = async () => (await api<{ people: { id: string; name: string; source: string; role: string | null; where: string | null }[] }>("GET", `/api/chats/${chatId}/world`)).json.people;

beforeAll(() => {
  freshDb();
  app = createApp();
  const { data } = normalizeCard({ spec: "chara_card_v2", data: { name: "Mira", description: "Keeper of the lighthouse.", first_mes: "Welcome." } });
  chatId = createChat({ characterId: createCharacter(data) }).id;
  const msg = addMessage(chatId, "assistant", "Jeff and Sadecki wave.");
  writeEvents(chatId, { messageId: msg, swipeIdx: 0 }, linesToOps(["clock: Day 1 08:00", "at: Port Ellis › Lighthouse", "cast: Mira@spot · Jeff@left · Sadecki@left · Dana@left"]).ops, "model");
  saveCastProfile(chatId, "Bobby Farleigh", { role: "the ferryman" });
});

describe("people on the World page", () => {
  test("each person says where they come from", async () => {
    const ps = await people();
    expect(ps.find((p) => p.name === "Jeff")?.source).toBe("story");
    expect(ps.find((p) => p.name === "Bobby Farleigh")).toMatchObject({ source: "cast", role: "the ferryman" });
  });

  test("merging folds one into the other", async () => {
    const ps = await people();
    const from = ps.find((p) => p.name === "Jeff")!;
    const into = ps.find((p) => p.name === "Sadecki")!;
    expect((await api("POST", `/api/chats/${chatId}/cast/merge`, { from: from.id, into: into.id })).status).toBe(200);
    const after = await people();
    expect(after.some((p) => p.name === "Jeff")).toBe(false);
    expect(after.some((p) => p.name === "Sadecki")).toBe(true);
  });

  test("editing renames them and sets where they are", async () => {
    await api("PUT", `/api/chats/${chatId}/cast/${encodeURIComponent("Dana")}`, { name: "Dana Kowalski", role: "the baker" });
    await api("PUT", `/api/chats/${chatId}/world/people/${encodeURIComponent("Dana Kowalski")}`, { where: "Port Ellis › Bakery" });
    const dana = (await people()).find((p) => p.name === "Dana Kowalski");
    expect(dana).toMatchObject({ source: "story", role: "the baker", where: "Port Ellis › Bakery" });
    expect((await people()).some((p) => p.name === "Dana")).toBe(false);
  });

  test("deleting takes them out of the world", async () => {
    await api("DELETE", `/api/chats/${chatId}/cast/${encodeURIComponent("Dana Kowalski")}?forget=1`);
    await api("DELETE", `/api/chats/${chatId}/cast/${encodeURIComponent("Bobby Farleigh")}?forget=1`);
    const ps = await people();
    expect(ps.some((p) => p.name.startsWith("Dana"))).toBe(false);
    expect(ps.some((p) => p.name === "Bobby Farleigh")).toBe(false);
  });
});
