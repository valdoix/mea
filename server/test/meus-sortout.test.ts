import { beforeAll, describe, expect, test } from "bun:test";
import { normalizeCard } from "../src/cards/card";
import { buildBrief } from "../src/meus/brief";
import { applyChange, checkChanges, undoStep } from "../src/meus/changes";
import { createCharacter } from "../src/services/characters";
import { addMessage, createChat } from "../src/services/chats";
import { registerJob } from "../src/services/jobs";
import { createPersona } from "../src/services/personas";
import { factionBook } from "../src/trackers/factions";
import { castFactions, currentFold, linesToOps, placeProfiles, writeEvents } from "../src/trackers/store";
import { freshDb } from "./helpers";

/** docs/30 4.3: Meus sorts out the cast's groups and the places, and Undo takes each change back. */

let chatId = "";
const msgs: string[] = [];
const story = (i: number, lines: string[]) => writeEvents(chatId, { messageId: msgs[i]!, swipeIdx: 0 }, linesToOps(lines).ops, "model");
const st = () => currentFold(chatId).result.state;
const place = (name: string) => Object.values(st().places).find((p) => p.name === name);

beforeAll(() => {
  freshDb();
  for (const kind of ["memory.segment", "memory.build", "memory.embed", "quota.refresh", "cache.probe", "tracker.update", "tracker.init", "lore.keepup", "lore.chronicle", "lore.bond"]) registerJob(kind, async () => {});
  createPersona({ name: "Gabriel", data: { description: "A lawyer." }, isDefault: true });
  const { data } = normalizeCard({ spec: "chara_card_v2", data: { name: "Buffy", description: "The Slayer.", first_mes: "Buffy stakes a vampire." } });
  chatId = createChat({ characterId: createCharacter(data) }).id;
  for (let i = 0; i < 6; i++) msgs.push(addMessage(chatId, i % 2 ? "assistant" : "user", `Message ${i}.`, i % 2 ? { name: "Buffy" } : { name: "Gabriel" }));
  story(1, ["at: Sunnydale › Winters Residence › Kitchen", "cast: Buffy@spot · Willow@spot · Xander@spot · Dawn@peri"]);
  story(3, ["at: Sunnydale › Winters Residence › Stairs › Kitchen", "cast: Dawn's friends (Melissa, Kara)@off"]);
  story(5, ["at: Sunnydale › Gym"]);
});

const propose = (raw: Record<string, unknown>) => checkChanges(chatId, [raw]);
const apply = (raw: Record<string, unknown>) => {
  const { changes, dropped } = propose(raw);
  expect(dropped).toEqual([]);
  return changes.flatMap((c) => applyChange(chatId, { ...c, id: "x" } as never));
};
const undo = (steps: ReturnType<typeof apply>) => {
  for (const s of [...steps].reverse()) undoStep(chatId, s);
};

describe("factions (docs/30 4.3)", () => {
  test("make one, with members from the cast; Undo takes it out", () => {
    const steps = apply({ kind: "faction", action: "make", name: "Scoobies", group_kind: "circle", members: ["Willow", "Xander", "Giles"] });
    const f = castFactions(chatId).find((x) => x.name === "Scoobies")!;
    expect(f.members.map((m) => m.name)).toEqual(["Willow", "Xander"]);
    expect(f.kind).toBe("circle");
    undo(steps);
    expect(castFactions(chatId).some((x) => x.name === "Scoobies")).toBe(false);
  });

  test("a person's name isn't a faction", () => {
    expect(propose({ kind: "faction", action: "make", name: "Willow" }).dropped[0]).toContain("person");
  });

  test("merge: one faction's names and members go to the other; Undo brings both back", () => {
    apply({ kind: "faction", action: "make", name: "Scoobies", members: ["Willow", "Xander"] });
    apply({ kind: "faction", action: "make", name: "The Gang", members: ["Buffy"] });
    const steps = apply({ kind: "faction", action: "merge", from: "The Gang", into: "Scoobies" });
    const rows = castFactions(chatId);
    expect(rows.map((r) => r.name)).toEqual(["Scoobies"]);
    expect(rows[0]!.aliases).toContain("The Gang");
    expect(rows[0]!.members.map((m) => m.name).sort()).toEqual(["Buffy", "Willow", "Xander"]);
    undo(steps);
    expect(castFactions(chatId).map((r) => r.name).sort()).toEqual(["Scoobies", "The Gang"]);
    expect(castFactions(chatId).find((r) => r.name === "Scoobies")!.members).toHaveLength(2);
  });

  test("members: a member line for each, so it's in the story's records", () => {
    const steps = apply({ kind: "faction", action: "member", name: "Dawn's friends", add: ["Dawn"], role: "the anchor" });
    const f = factionBook(chatId).factions.find((x) => x.name === "Dawn's friends")!;
    expect(f.members.filter((m) => m.left == null).map((m) => m.name)).toContain("Dawn");
    undo(steps);
    expect(factionBook(chatId).factions.find((x) => x.name === "Dawn's friends")!.members.map((m) => m.name)).not.toContain("Dawn");
  });
});

describe("places (docs/30 4.3)", () => {
  test("merge the second kitchen into the first; Undo splits them again", () => {
    const kitchens = Object.values(st().places).filter((p) => p.name === "Kitchen");
    expect(kitchens).toHaveLength(2);
    const stairs = kitchens.find((k) => k.path.includes("Stairs"))!;
    const main = kitchens.find((k) => !k.path.includes("Stairs"))!;
    const steps = apply({ kind: "place", action: "merge", id: stairs.id, into: "Sunnydale › Winters Residence › Kitchen" });
    expect(placeProfiles(chatId)[stairs.id]?.into).toBe(main.id);
    expect(Object.values(st().places).filter((p) => p.name === "Kitchen")).toHaveLength(1);
    undo(steps);
    expect(placeProfiles(chatId)[stairs.id]).toBeUndefined();
    expect(Object.values(st().places).filter((p) => p.name === "Kitchen")).toHaveLength(2);
  });

  test("move under, rename, not a place", () => {
    const gym = place("Gym")!;
    const home = place("Winters Residence")!;
    const moved = apply({ kind: "place", action: "move", id: gym.id, into: home.id });
    expect(place("Gym")!.path).toEqual(["Sunnydale", "Winters Residence", "Gym"]);
    undo(moved);
    expect(place("Gym")!.path).toEqual(["Sunnydale", "Gym"]);
    const renamed = apply({ kind: "place", action: "rename", id: home.id, name: "The Winters House" });
    expect(place("The Winters House")?.aliases).toContain("Winters Residence");
    undo(renamed);
    expect(place("Winters Residence")).toBeTruthy();
    expect(propose({ kind: "place", action: "move", id: home.id, into: "Sunnydale › Winters Residence › Kitchen" }).dropped[0]).toContain("inside");
  });

  test("the brief lists the factions and the place tree, and what Story health says", () => {
    const text = buildBrief(chatId).text;
    expect(text).toContain("FACTIONS (name · kind · whose · members):");
    expect(text).toContain("PLACES (path [id] · kind · also called · lives here):");
    expect(text).toContain("Winters Residence has Kitchen more than once: Kitchen / Stairs › Kitchen");
  });
});
