import { beforeAll, describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import { normalizeCard } from "../src/cards/card";
import { createCharacter } from "../src/services/characters";
import { addMessage, createChat } from "../src/services/chats";
import { rosterFor } from "../src/sim/service";
import { castProfiles, currentFold, linesToOps, writeEvents } from "../src/trackers/store";
import type { Op } from "../src/trackers/types";
import { freshDb } from "./helpers";

/** docs/21 Part 1: what the world did off the page says why, and can be undone from the chip. */
let app: ReturnType<typeof createApp>;
let chatId = "";
let m1 = "";
let m2 = "";
const local = { requestIP: () => ({ address: "127.0.0.1", family: "IPv4", port: 5000 }) };

async function api<T = any>(method: string, path: string, body?: unknown): Promise<{ status: number; json: T }> {
  const res = await app.fetch(new Request(`http://localhost${path}`, { method, headers: body !== undefined ? { "Content-Type": "application/json" } : {}, body: body !== undefined ? JSON.stringify(body) : undefined }), local);
  return { status: res.status, json: (await res.json()) as T };
}

const FACT = "The chandlery burned down in the storm";
const KEY = "chandlery";
const hop = (from: string, to: string): Op[] => [
  { op: "sim", args: { type: "news", hop: { at: 0, fact: KEY, statement: FACT, from, to, medium: "in person" } }, raw: "sim news" },
  { op: "know", subject: to, args: { fact: FACT, key: KEY, status: "knows", truth: "true", route: `told by ${from}, in person` }, cause: "news off the page", why: [`tie: ${from}'s description`, `place: ${from}'s place not known, assumed town`], raw: `know ${to}: #${KEY}` },
];
type Chip = { kind: string; subject?: string; source: string; event?: string; why?: string[] };
const chips = async (mid: string) => (await api<{ byMessage: Record<string, Chip[]> }>("GET", `/api/chats/${chatId}/trackers/chips`)).json.byMessage[mid] ?? [];
const knows = (name: string) => Object.keys(currentFold(chatId).result.state.facts[KEY]?.stances ?? {}).includes(name.toLowerCase());

beforeAll(() => {
  freshDb();
  app = createApp();
  const { data } = normalizeCard({ spec: "chara_card_v2", data: { name: "Mira", description: "Keeper of the lighthouse.", first_mes: "Welcome." } });
  chatId = createChat({ characterId: createCharacter(data) }).id;
  m1 = addMessage(chatId, "assistant", "The storm rolls in.");
  writeEvents(
    chatId,
    { messageId: m1, swipeIdx: 0 },
    linesToOps(["clock: Day 1 08:00", "at: Port Ellis › Lighthouse", "cast: Mira@spot · Joss@left · Tara@left · Willow@left", `know Joss: #${KEY} ${FACT} | saw it · knows`, "bond Joss>Tara: affection 3 — old friends"]).ops,
    "model",
  );
  writeEvents(chatId, { messageId: m1, swipeIdx: 0 }, hop("Joss", "Tara"), "engine", { replace: [] });
  m2 = addMessage(chatId, "assistant", "Morning.");
  writeEvents(chatId, { messageId: m2, swipeIdx: 0 }, hop("Tara", "Willow"), "engine", { replace: [] });
});

describe("undoing the world off the page", () => {
  test("an engine change carries its event and why", async () => {
    const tara = (await chips(m1)).find((c) => c.subject === "Tara" && c.kind === "knowledge")!;
    expect(tara.source).toBe("engine");
    expect(tara.event).toBeTruthy();
    expect(tara.why).toContain("place: Joss's place not known, assumed town");
    expect((await chips(m1)).find((c) => c.source === "model")?.event).toBeUndefined();
  });

  test("only the world's own changes undo here", async () => {
    const own = (await api<{ ledger?: unknown }>("GET", `/api/chats/${chatId}/trackers/message/${m1}`)).json as { events?: { id: string; source: string }[] };
    const model = own.events?.find((e) => e.source === "model");
    expect(model).toBeTruthy();
    expect((await api("POST", `/api/chats/${chatId}/world/undo/${model!.id}`, {})).status).toBe(400);
    expect((await api("POST", `/api/chats/${chatId}/world/undo/nope`, {})).status).toBe(404);
  });

  test("undoing a hop takes the news it passed on, and 'they don't talk' holds", async () => {
    expect(knows("Tara") && knows("Willow")).toBe(true);
    const tara = (await chips(m1)).find((c) => c.subject === "Tara" && c.kind === "knowledge")!;
    const r = await api<{ removed: number }>("POST", `/api/chats/${chatId}/world/undo/${tara.event}`, { also: "apart" });
    expect(r.json.removed).toBe(4);
    expect(knows("Tara")).toBe(false);
    expect(knows("Willow")).toBe(false);
    expect(knows("Joss")).toBe(true);
    expect(currentFold(chatId).result.state.sim.news).toEqual([]);
    expect(castProfiles(chatId).tara?.apart).toEqual(["Joss"]);
    // The bond on the page made them close; you said they don't talk, so no tie either way.
    const roster = rosterFor(chatId, currentFold(chatId).result.state);
    expect(roster.byName("Joss")!.ties.has(roster.byName("Tara")!.id)).toBe(false);
    expect(roster.byName("Tara")!.ties.has(roster.byName("Joss")!.id)).toBe(false);
  });
});
