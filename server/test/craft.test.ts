import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { normalizeCard } from "../src/cards/card";
import { getSetting, setSetting } from "../src/lib/settings";
import { createCharacter } from "../src/services/characters";
import { addMessage, createChat } from "../src/services/chats";
import { createConnection, createProfile, syncModels } from "../src/services/connections";
import { previewPrompt } from "../src/services/generation";
import { pauseJobs, registerJob } from "../src/services/jobs";
import { statusTiles } from "../src/services/status";
import { banPhrase, craftReport, craftStats, setCraft, TECHNIQUES, techniqueFor } from "../src/steer/craft";
import { freshDb } from "./helpers";

let chatId = "";
let dashChat = "";

function story(id: string, replies: string[]) {
  for (const r of replies) {
    addMessage(id, "user", "Go on.", { name: "You" });
    addMessage(id, "assistant", r, { name: "Mira" });
  }
}

beforeAll(async () => {
  freshDb();
  pauseJobs(true);
  for (const kind of ["memory.segment", "memory.build", "memory.embed", "accuracy.check", "tracker.update", "lessons.learn"]) registerJob(kind, async () => {});
  const connId = createConnection({ name: "Mock", kind: "mock", billing: "subscription" });
  await syncModels(connId);
  createProfile({ name: "Story", connectionId: connId, modelId: "mock/storyteller", params: { context_target: 8000, max_tokens: 300 } });
  const { data } = normalizeCard({ spec: "chara_card_v2", data: { name: "Mira", first_mes: "Welcome." } });
  const char = createCharacter(data);
  chatId = createChat({ characterId: char }).id;
  dashChat = createChat({ characterId: char }).id;
  // Recent replies that lean on one phrase, on "She", and on filter words.
  story(
    chatId,
    Array.from({ length: 6 }, (_, i) => `She felt the cold of the old glass against her palm. She noticed the lamp flicker. She watched the sea for a while, and her breath caught. The tide comes in slow tonight ${i}.`),
  );
});
afterAll(() => pauseJobs(false));

describe("the craft coach (D2)", () => {
  test("a take's numbers", () => {
    const s = craftStats('She felt it — then, like a ghost, she smiled… "Hello," she said, slow, sure, and quiet.');
    expect(s.filter).toBe(1);
    expect(s.emdash).toBe(1);
    expect(s.ellipsis).toBe(1);
    expect(s.similes).toEqual(["ghost"]);
    expect(s.openings[0]).toBe("she");
    expect(s.dialogue).toBeGreaterThan(0);
  });

  test("it finds the habits the last replies lean on", () => {
    const r = craftReport(chatId);
    const kinds = r.habits.map((h) => h.kind);
    expect(kinds).toContain("phrase");
    expect(kinds).toContain("opening");
    expect(kinds).toContain("filter");
    expect(kinds).toContain("gesture");
    const phrase = r.habits.find((h) => h.kind === "phrase")!;
    // One of the sentences every recent reply repeats.
    expect("she felt the cold of the old glass against her palm she noticed the lamp flicker she watched the sea for a while the tide comes in slow tonight").toContain(phrase.phrase!);
  });

  test("a story's own style isn't nagged: dashes are judged against its baseline", () => {
    const dashy = (i: number) => `The door opens — rain — and Mira looks up — slow — from the logbook ${i}. Wind at the glass — always.`;
    story(dashChat, Array.from({ length: 12 }, (_, i) => dashy(i)));
    expect(craftReport(dashChat).habits.some((h) => h.kind === "emdash")).toBe(false);
  });

  test("three habits and one technique go to the model in the [CRAFT] lane", async () => {
    const p = await previewPrompt(chatId);
    const b = p.trace.blocks.find((x) => x.lane === "craft")!;
    const avoid = b.text!.split("\n").filter((l) => l.startsWith("- "));
    expect(avoid).toHaveLength(3);
    expect(b.text).toContain("Try this once, where it fits:");
    expect(p.trace.craft?.replies).toBeGreaterThanOrEqual(6);
  });

  test("techniques rotate: none repeats within ten replies, and swipes agree", () => {
    const run = Array.from({ length: 11 }, (_, i) => techniqueFor(chatId, i));
    expect(new Set(run.slice(0, 10)).size).toBe(10);
    expect(techniqueFor(chatId, 4)).toBe(techniqueFor(chatId, 4));
    expect(TECHNIQUES.length).toBeGreaterThan(10);
  });

  test("It's fine, Ban it, and Pause coach", async () => {
    const r = craftReport(chatId);
    const phrase = r.habits.find((h) => h.kind === "phrase")!;
    setCraft(chatId, { ignore: phrase.key });
    expect(craftReport(chatId).habits.some((h) => h.key === phrase.key)).toBe(false);
    banPhrase(phrase.phrase!);
    expect(getSetting("chat.banned").list.some((b) => b.phrase === phrase.phrase)).toBe(true);
    expect(statusTiles(chatId).find((t) => t.id === "craft")).toBeTruthy();
    setCraft(chatId, { paused: true });
    const p = await previewPrompt(chatId);
    expect(p.trace.blocks.some((x) => x.lane === "craft")).toBe(false);
    expect(statusTiles(chatId).some((t) => t.id === "craft")).toBe(false);
    setCraft(chatId, { paused: false });
    setSetting("steer.config", { ...getSetting("steer.config"), craft: false });
    expect(statusTiles(chatId).some((t) => t.id === "craft")).toBe(false);
    setSetting("steer.config", { ...getSetting("steer.config"), craft: true });
  });
});
