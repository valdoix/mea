import { beforeAll, describe, expect, test } from "bun:test";
import { normalizeCard } from "../src/cards/card";
import { createCharacter } from "../src/services/characters";
import { addMessage, createChat, updateChat } from "../src/services/chats";
import { createConnection, createProfile, syncModels } from "../src/services/connections";
import { registerJob } from "../src/services/jobs";
import { createPersona } from "../src/services/personas";
import { authorArc, forceOutcome, previewOutcome } from "../src/sim/service";
import { userEdit } from "../src/trackers/service";
import { currentFold, linesToOps } from "../src/trackers/store";
import { freshDb } from "./helpers";

let chatId = "";
const state = () => currentFold(chatId).result.state;

beforeAll(async () => {
  freshDb();
  for (const kind of ["memory.segment", "memory.build", "memory.embed", "quota.refresh", "cache.probe", "world.tell"]) registerJob(kind, async () => {});
  const connId = createConnection({ name: "Mock", kind: "mock", billing: "subscription" });
  await syncModels(connId);
  createProfile({ name: "Story", connectionId: connId, modelId: "mock/storyteller", params: { context_target: 6000, max_tokens: 300 } });
  createPersona({ name: "Alex", data: { description: "A lighthouse keeper." }, isDefault: true });
  const { data } = normalizeCard({ spec: "chara_card_v2", data: { name: "Mira", description: "The keeper's friend.", first_mes: "Mira trims the lamp." } });
  chatId = createChat({ characterId: createCharacter(data) }).id;
  updateChat(chatId, { settings: { world: { mode: "living", telling: "engine" } } });
  addMessage(chatId, "user", "Alex climbs the stairs.", { name: "Alex" });
  addMessage(chatId, "assistant", "Mira looks up from the lamp.", { name: "Mira" });
  userEdit(chatId, linesToOps(["clock: Day 1 20:00", "cast: Mira@spot · Alex@spot", "cast: Joss@left(→ Port Ellis › Harbour)"]).ops);
});

describe("next beat previews (G3)", () => {
  test("a preview shows how it would land, and commits nothing", async () => {
    const arc = authorArc(chatId, "Joss", "Joss wants to buy back his father's boat before the Guild sells it.");
    const before = JSON.stringify(state().sim.arcs[arc.id]);
    const p = await previewOutcome(chatId, arc.id, "cost");
    expect(p).toMatchObject({ landsNow: true, outcome: "cost", result: "cost", told: "engine" });
    expect(p.text.length).toBeGreaterThan(0);
    expect(JSON.stringify(state().sim.arcs[arc.id])).toBe(before);
    // Seeded: the same preview twice; a reroll is another seed.
    expect((await previewOutcome(chatId, arc.id, "cost")).text).toBe(p.text);
  });

  test("Accept lands exactly the previewed beat; edited words tell it", async () => {
    const arc = Object.values(state().sim.arcs).find((a) => a.premise.includes("father's boat"))!;
    const p = await previewOutcome(chatId, arc.id, "twist", 3);
    expect(p.landsNow).toBe(true);
    forceOutcome(chatId, arc.id, "twist", { salt: 3, text: "Word comes up from the harbour: the Guild sold the boat to Joss's cousin." });
    const after = state().sim.arcs[arc.id]!;
    expect(after.beats.at(-1)).toMatchObject({ result: p.result, forced: "twist", text: "Word comes up from the harbour: the Guild sold the boat to Joss's cousin." });
    expect(JSON.stringify(after)).toContain("the Guild sold the boat to Joss's cousin");
  });

  test("model telling: one cheap call writes the preview", async () => {
    updateChat(chatId, { settings: { world: { mode: "living", telling: "model" } } });
    const arc = Object.values(state().sim.arcs).find((a) => a.premise.includes("father's boat"))!;
    const p = await previewOutcome(chatId, arc.id, "win");
    expect(p).toMatchObject({ told: "model" });
    expect(p.text).toStartWith("Off the page:");
    updateChat(chatId, { settings: { world: { mode: "living", telling: "engine" } } });
  });

  test("someone in the scene: no preview yet (the call waits for their next step)", async () => {
    const hers = authorArc(chatId, "Mira", "Mira wants to fix the old lens.");
    expect(await previewOutcome(chatId, hers.id, "loss")).toMatchObject({ landsNow: false, text: "" });
  });
});
