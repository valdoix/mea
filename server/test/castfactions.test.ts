import { beforeAll, describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import { normalizeCard } from "../src/cards/card";
import { createCharacter } from "../src/services/characters";
import { addMessage, createChat } from "../src/services/chats";
import { trackerPrompt } from "../src/trackers/service";
import { linesToOps, writeEvents } from "../src/trackers/store";
import { freshDb } from "./helpers";

/** Factions on the Story page's Cast: groups of people, kept by name. */
let app: ReturnType<typeof createApp>;
let chatId = "";
const local = { requestIP: () => ({ address: "127.0.0.1", family: "IPv4", port: 5000 }) };

async function api<T = any>(method: string, path: string, body?: unknown): Promise<{ status: number; json: T }> {
  const res = await app.fetch(new Request(`http://localhost${path}`, { method, headers: body !== undefined ? { "Content-Type": "application/json" } : {}, body: body !== undefined ? JSON.stringify(body) : undefined }), local);
  return { status: res.status, json: (await res.json()) as T };
}
type Faction = { id: string; name: string; description?: string; members: { name: string; role?: string }[] };
const factions = async () => (await api<{ factions: Faction[] }>("GET", `/api/chats/${chatId}/factions`)).json.factions;

beforeAll(() => {
  freshDb();
  app = createApp();
  const { data } = normalizeCard({ spec: "chara_card_v2", data: { name: "Mira", description: "Keeper of the lighthouse.", first_mes: "Welcome." } });
  chatId = createChat({ characterId: createCharacter(data) }).id;
  const msg = addMessage(chatId, "assistant", "Jeff and Sadecki wave.");
  writeEvents(chatId, { messageId: msg, swipeIdx: 0 }, linesToOps(["clock: Day 1 08:00", "at: Port Ellis › Lighthouse", "cast: Mira@spot · Jeff@spot · Sadecki@left"]).ops, "model");
});

describe("cast factions", () => {
  let guild = "";

  test("a faction is made with its members, once each", async () => {
    const r = await api<Faction>("POST", `/api/chats/${chatId}/factions`, { name: "Harbour Guild", description: "Runs the docks.", members: [{ name: "Jeff", role: "captain" }, { name: "jeff " }, { name: "Sadecki" }] });
    expect(r.status).toBe(201);
    guild = r.json.id;
    expect(r.json.members).toEqual([{ name: "Jeff", role: "captain" }, { name: "Sadecki" }]);
    expect((await api("POST", `/api/chats/${chatId}/factions`, { name: " " })).status).toBe(400);
  });

  test("members can be added later; fields left out stay", async () => {
    const f = (await factions()).find((x) => x.id === guild)!;
    const r = await api<Faction>("PUT", `/api/chats/${chatId}/factions/${guild}`, { members: [...f.members, { name: "Bobby Farleigh", role: "ferryman" }] });
    expect(r.json.members.map((m) => m.name)).toEqual(["Jeff", "Sadecki", "Bobby Farleigh"]);
    expect(r.json.description).toBe("Runs the docks.");
    expect((await api("PUT", `/api/chats/${chatId}/factions/nope`, { name: "X" })).status).toBe(404);
  });

  test("a faction with someone in the scene is in the prompt", () => {
    expect(trackerPrompt(chatId, { kind: "story" }).note?.text).toContain("Faction Harbour Guild: Jeff (captain), Sadecki, Bobby Farleigh (ferryman); Runs the docks.");
  });

  test("a renamed person keeps their place; a forgotten one leaves", async () => {
    await api("PUT", `/api/chats/${chatId}/cast/${encodeURIComponent("Jeff")}`, { name: "Jeff Moreau" });
    expect((await factions())[0]!.members[0]).toEqual({ name: "Jeff Moreau", role: "captain" });
    await api("DELETE", `/api/chats/${chatId}/cast/${encodeURIComponent("Sadecki")}?forget=1`);
    expect((await factions())[0]!.members.map((m) => m.name)).toEqual(["Jeff Moreau", "Bobby Farleigh"]);
  });

  test("deleting a faction leaves its people", async () => {
    await api("DELETE", `/api/chats/${chatId}/factions/${guild}`);
    expect(await factions()).toEqual([]);
    const cast = (await api<{ people: { name: string }[] }>("GET", `/api/chats/${chatId}/cast`)).json.people;
    expect(cast.some((p) => p.name === "Jeff Moreau")).toBe(true);
  });
});
