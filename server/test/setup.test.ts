import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { normalizeCard } from "../src/cards/card";
import { one, parseJson } from "../src/db/db";
import { setSetting } from "../src/lib/settings";
import { createCharacter } from "../src/services/characters";
import { addMessage, type ChatSettings, createChat, mustChat } from "../src/services/chats";
import { createConnection, createProfile, syncModels } from "../src/services/connections";
import { pauseJobs, registerJob } from "../src/services/jobs";
import { storyDials } from "../src/services/layers";
import { applySetup, previewOpening, saveUsual, setupView, skipSetup, usual } from "../src/services/setup";
import { currentFold, linesToOps, writeEvents } from "../src/trackers/store";
import { freshDb } from "./helpers";

let chatId = "";
const settings = () => parseJson<ChatSettings>(mustChat(chatId).settings, {});

beforeAll(async () => {
  freshDb();
  pauseJobs(true);
  for (const kind of ["memory.segment", "memory.build", "memory.embed", "accuracy.check", "tracker.update", "offpage.reword", "lessons.learn"]) registerJob(kind, async () => {});
  const connId = createConnection({ name: "Mock", kind: "mock", billing: "subscription" });
  await syncModels(connId);
  createProfile({ name: "Story", connectionId: connId, modelId: "mock/storyteller", params: { context_target: 6000, max_tokens: 300 } });
  const { data } = normalizeCard({ spec: "chara_card_v2", data: { name: "Arya", description: "A girl of Winterfell with a sword called Needle. A dark, grim world of horror and intrigue.", tags: ["Fantasy"], first_mes: "Snow falls on Winterfell." } });
  chatId = createChat({ characterId: createCharacter(data) }).id;
  const first = addMessage(chatId, "assistant", "Snow falls on Winterfell.", { name: "Arya" });
  writeEvents(chatId, { messageId: first, swipeIdx: -1 }, linesToOps(["clock: Day 1 08:00", "cast: Arya@spot"]).ops, "model");
});
afterAll(() => {
  pauseJobs(false);
  setSetting("setup.usual", null);
});

describe("Session Zero (F1)", () => {
  test("a new chat shows it, pre-filled from the card", () => {
    const v = setupView(chatId);
    expect(v.show).toBe(true);
    expect(v.done).toBe(false);
    expect(v.answers.genres).toEqual(expect.arrayContaining(["fantasy", "horror", "intrigue"]));
    expect(v.answers.tone).toBe("Dark");
    expect(v.answers.world).toMatchObject({ calendar: "westeros", tech: "fantasy", start: "Day 1 · 08:00" });
    expect(v.answers.canon.source).toContain("Game of Thrones");
    expect(v.options.persona.map((o) => o.value)).toContain("sealed");
  });

  test("the answers land on the settings Mea already has", () => {
    const a = setupView(chatId).answers;
    applySetup(chatId, { ...a, genres: ["horror", "gothic"], persona: "sealed", romance: "slow", limits: ["Graphic gore", "Torture"], pace: "slow", world: { ...a.world, climate: "subarctic", start: "Day 1 20:00" } });
    const s = settings();
    expect(s.controls).toMatchObject({ genre: "horror", genre2: "gothic", persona: "sealed", romance: "slow", limits: "Graphic gore, Torture" });
    expect(s).toMatchObject({ pacing: "slow", story: { tone: "Dark" }, trackers: { calendar: "westeros" }, world: { climate: "subarctic", genres: ["horror", "gothic"] } });
    expect(storyDials(mustChat(chatId))).toMatchObject({ persona: "sealed", romance: "slow", genre: "horror" });
    expect(s.canon?.source).toContain("Game of Thrones");
    expect(currentFold(chatId).result.state.time?.minutes).toBe(20 * 60);
    const v = setupView(chatId);
    expect(v).toMatchObject({ done: true, show: false });
  });

  test("a change after the start leaves a card on the story's timeline", () => {
    const a = setupView(chatId).answers;
    applySetup(chatId, { ...a, tone: "Warm" });
    const st = currentFold(chatId).result.state;
    expect(st.milestones.map((m) => m.text)).toContain("Story setup · Tone changed to Warm");
    expect(setupView(chatId).answers.tone).toBe("Warm");
  });

  test("Save as my usual, Use my usual (without the story's own start and canon)", () => {
    saveUsual(setupView(chatId).answers);
    expect(usual()).toMatchObject({ tone: "Warm", genres: ["horror", "gothic"], world: { start: "" }, canon: {} });
  });

  test("skipping keeps it from opening again; an old chat with talk in it never pops it", () => {
    const charId = createCharacter(normalizeCard({ spec: "chara_card_v2", data: { name: "Wren", first_mes: "Hi." } }).data);
    const other = createChat({ characterId: charId }).id;
    addMessage(other, "user", "Hello.");
    expect(setupView(other).show).toBe(false);
    const fresh = createChat({ characterId: charId }).id;
    expect(setupView(fresh).show).toBe(true);
    skipSetup(fresh);
    expect(setupView(fresh)).toMatchObject({ show: false, done: false });
    expect(one<{ chat_setup: string }>("SELECT chat_setup FROM chats WHERE id = ?", fresh)?.chat_setup).toContain('"skipped":true');
  });

  test("the live preview rewrites the opening in the chosen tone", async () => {
    const r = await previewOpening(chatId, { tone: "Playful", persona: "sealed", genres: ["comedy"] });
    expect(r.text).toContain("(Playful)");
    expect(r.text).toContain("Snow falls on Winterfell");
  });
});
