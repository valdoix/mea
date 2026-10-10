import { beforeAll, describe, expect, test } from "bun:test";
import { normalizeCard } from "../src/cards/card";
import { authorArc, forceOutcome } from "../src/sim/service";
import { createCharacter } from "../src/services/characters";
import { addMessage, createChat, updateChat } from "../src/services/chats";
import { registerJob } from "../src/services/jobs";
import { createPersona } from "../src/services/personas";
import { userEdit } from "../src/trackers/service";
import { currentFold, linesToOps } from "../src/trackers/store";
import { freshDb } from "./helpers";

let chatId = "";
const state = () => currentFold(chatId).result.state;

beforeAll(() => {
  freshDb();
  for (const kind of ["memory.segment", "memory.build", "memory.embed", "quota.refresh", "cache.probe", "world.tell"]) registerJob(kind, async () => {});
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
