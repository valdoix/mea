import { beforeAll, describe, expect, test } from "bun:test";
import { normalizeCard } from "../src/cards/card";
import { defaultMemoryConfig, setSetting } from "../src/lib/settings";
import { briefCard, briefOf, instructionLines, pinBriefLine, runBriefJob } from "../src/lore/brief";
import { getCard } from "../src/services/characters";
import { createCharacter } from "../src/services/characters";
import { addMessage, createChat } from "../src/services/chats";
import { createConnection, createProfile, syncModels } from "../src/services/connections";
import { previewPrompt } from "../src/services/generation";
import { registerJob } from "../src/services/jobs";
import { currentFold, linesToOps, writeEvents } from "../src/trackers/store";
import { buildAnchor } from "../src/accuracy/anchor";
import { freshDb } from "./helpers";

const PHI = [
  "{{original}}",
  "Keep Buffy's voice fast and offhand, with pop-culture punchlines.",
  "When she deflects, the quip must land as a cut, not a joke.",
  "Show her tells: rubbing her raw right wrist, looking at exits.",
  "With Gabriel, show no more than one crack per exchange.",
].join("\n");

let chatId = "";
let charId = "";

beforeAll(async () => {
  freshDb();
  for (const kind of ["memory.segment", "memory.build", "memory.embed", "memory.journal", "memory.consolidate", "lore.chronicle", "lore.brief", "accuracy.check", "accuracy.drift", "quota.refresh", "cache.probe"]) registerJob(kind, async () => {});
  const connId = createConnection({ name: "Mock", kind: "mock", billing: "subscription" });
  await syncModels(connId);
  createProfile({ name: "Story", connectionId: connId, modelId: "mock/storyteller", params: { context_target: 6000, max_tokens: 400 } });
  setSetting("memory.config", { ...defaultMemoryConfig, boundaryCheck: false, checkerModel: false });
  charId = createCharacter(normalizeCard({ spec: "chara_card_v2", data: { name: "Buffy Summers", description: "A slayer, back from the grave tonight.", first_mes: "The dirt gives.", post_history_instructions: PHI } }).data);
  chatId = createChat({ characterId: charId }).id;
  writeEvents(chatId, { messageId: null, swipeIdx: 0 }, linesToOps(["cast: Buffy Summers@spot", "trait Buffy Summers: blonde hair; pale; voice hoarse from disuse", "drive Buffy Summers: want: to feel anything that isn't ash; fear: never feeling right again", "mask Buffy Summers: tell: rubs her raw right wrist"]).ops, "init");
  for (let i = 0; i < 6; i++) addMessage(chatId, i % 2 ? "assistant" : "user", `Line ${i}.`, { name: i % 2 ? "Buffy Summers" : "You" });
});

describe("the brief ages with the story (docs/33 Part 1)", () => {
  test("the card's instructions are read line by line, {{original}} aside", () => {
    expect(instructionLines(PHI)).toHaveLength(4);
  });
  test("a reading keeps, revises and retires lines, and the story's card follows it", async () => {
    await runBriefJob({ chatId });
    const b = briefOf(chatId)!;
    expect(b.lines.map((l) => l.status)).toEqual(["kept", "revised", "retired", "retired"]);
    const phi = briefCard(chatId, getCard(charId)!).post_history_instructions;
    expect(phi).toContain("{{original}}");
    expect(phi).toContain("pop-culture punchlines");
    expect(phi).toContain("When she deflects now, it's teasing.");
    expect(phi).not.toContain("Show her tells");
    expect(phi).not.toContain("one crack per exchange");
    // The card itself is untouched.
    expect(getCard(charId)!.post_history_instructions).toBe(PHI);
  });
  test("the starting want and tell move on, and the opening's looks go", () => {
    const c = Object.values(currentFold(chatId).result.state.chars).find((x) => x.name === "Buffy Summers")!;
    expect(c.drives.want).toBe("to keep this life");
    expect(c.drives.fear).toBe("never feeling right again");
    expect(c.mask?.tell).toBe("hums when she's happy");
    expect(c.traits.map((t) => t.text)).toContain("blonde hair");
    expect(c.traits.map((t) => t.text)).not.toContain("pale");
    expect(c.traits.map((t) => t.text)).not.toContain("voice hoarse from disuse");
    expect(briefOf(chatId)!.traitsGone).toEqual(["pale", "voice hoarse from disuse"]);
  });
  test("a pinned line stays as the card wrote it, through the next reading too", async () => {
    pinBriefLine(chatId, "Show her tells: rubbing her raw right wrist, looking at exits.", true);
    expect(briefCard(chatId, getCard(charId)!).post_history_instructions).toContain("Show her tells");
    await runBriefJob({ chatId });
    expect(briefCard(chatId, getCard(charId)!).post_history_instructions).toContain("Show her tells");
    expect(briefCard(chatId, getCard(charId)!).post_history_instructions).not.toContain("one crack per exchange");
    pinBriefLine(chatId, "Show her tells: rubbing her raw right wrist, looking at exits.", false);
  });
  test("a card whose instructions changed is sent as written until it's read again", () => {
    const changed = { ...getCard(charId)!, post_history_instructions: `${PHI}\nA new line.` };
    expect(briefCard(chatId, changed).post_history_instructions).toBe(changed.post_history_instructions);
  });
  test("the story's prompt carries the brief, not the card's opening orders", async () => {
    const p = await previewPrompt(chatId);
    const text = JSON.stringify(p);
    expect(text).toContain("When she deflects now");
    expect(text).not.toContain("one crack per exchange");
  });
  test("the anchor says who they are now beside who the card says", () => {
    const a = buildAnchor({ card: getCard(charId)!, userName: "Gabriel", characterId: charId, now: ["whole girl, in progress — laughs with her whole body"] });
    expect(a).toContain("Who Buffy Summers is now, in this story (true where the card disagrees): whole girl, in progress");
    expect(buildAnchor({ card: getCard(charId)!, userName: "Gabriel", characterId: charId })).not.toContain("is now, in this story");
  });
});
