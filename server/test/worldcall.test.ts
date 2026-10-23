import { beforeAll, describe, expect, test } from "bun:test";
import { normalizeCard } from "../src/cards/card";
import { authorArc, forceOutcome, retellStep, rewordSubplot, worldView } from "../src/sim/service";
import { createCharacter } from "../src/services/characters";
import { addMessage, createChat, updateChat } from "../src/services/chats";
import { createConnection, createProfile, syncModels } from "../src/services/connections";
import { registerJob } from "../src/services/jobs";
import { createPersona } from "../src/services/personas";
import { userEdit } from "../src/trackers/service";
import { currentFold, linesToOps, writeEvents } from "../src/trackers/store";
import { freshDb } from "./helpers";

let chatId = "";
const state = () => currentFold(chatId).result.state;

beforeAll(async () => {
  freshDb();
  for (const kind of ["memory.segment", "memory.build", "memory.embed", "quota.refresh", "cache.probe", "world.tell", "world.word"]) registerJob(kind, async () => {});
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

describe("calling a subplot's next beat", () => {
  test("lands at once with your outcome when it can, waits when it can't, and clears", () => {
    const arc = authorArc(chatId, "Joss", "Joss wants to buy back his father's boat before the Guild sells it.");
    const beats = () => state().sim.arcs[arc.id]!.beats;
    const n = beats().length;
    const r = forceOutcome(chatId, arc.id, "loss");
    expect(r.landed).toBe(true);
    expect(beats().length).toBe(n + 1);
    expect(beats().at(-1)!.result).toBe("loss");
    expect(beats().at(-1)!.forced).toBe("loss");
    expect(state().sim.arcs[arc.id]!.force ?? null).toBeNull();
    // Twice in the same story minute still works.
    expect(forceOutcome(chatId, arc.id, "win").landed).toBe(true);
    expect(beats().at(-1)!.result).toBe("win");
    // Mira is in the scene: her subplot keeps the call for its next beat.
    const hers = authorArc(chatId, "Mira", "Mira wants to fix the old lens.");
    const w = forceOutcome(chatId, hers.id, "twist");
    expect(w.landed).toBe(false);
    expect(state().sim.arcs[hers.id]!.force).toBe("twist");
    forceOutcome(chatId, hers.id, null);
    expect(state().sim.arcs[hers.id]!.force ?? null).toBeNull();
  });
});

describe("the World page's ties", () => {
  test("every subplot comes with what it's tied to", () => {
    const v = worldView(chatId);
    expect(v.arcs.length).toBeGreaterThan(0);
    for (const a of v.arcs) {
      expect(Array.isArray(a.ties)).toBe(true);
      expect(Array.isArray(a.stands)).toBe(true);
    }
  });
});

describe("the model's words, after the fact", () => {
  test("a past step and a waiting proposal can be told again", async () => {
    const arc = Object.values(state().sim.arcs).find((a) => a.leadName === "Joss" && a.beats.length >= 2)!;
    const second = arc.beats[1]!.text;
    await retellStep(chatId, arc.id, 0);
    const beats = state().sim.arcs[arc.id]!.beats;
    expect(beats[0]!.told).toBe("model");
    expect(beats[0]!.text).toStartWith("Off the page:");
    // Only that step: the one after it (same story minute) keeps its words.
    expect(beats[1]!.text).toBe(second);
    const proposal = { id: "p:test", key: "joss|life|test", kind: "life" as const, lead: "joss", leadName: "Joss", cast: [], premise: "Joss has their own stake in \"boat\": rough words.", want: "to get on with an ordinary life", fear: "the ordinary life comes apart", grounds: [], secrecy: "private" as const, why: "test", at: 0 };
    writeEvents(chatId, { messageId: null, swipeIdx: 0 }, [{ op: "sim", args: { type: "proposal.new", proposal }, raw: "sim proposal.new" }], "engine");
    await rewordSubplot(chatId, "p:test");
    const p = state().sim.proposals["p:test"]!;
    expect(p.premise).toStartWith("Worded:");
    expect(p.want).toBe("to keep going");
    expect(p.fear).toBe("it all comes apart");
  });
});
