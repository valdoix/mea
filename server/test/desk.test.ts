import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { normalizeCard } from "../src/cards/card";
import { all, parseJson } from "../src/db/db";
import { createCharacter } from "../src/services/characters";
import { addMessage, type ChatSettings, createChat, mustChat } from "../src/services/chats";
import { createConnection, createProfile, syncModels } from "../src/services/connections";
import { pauseJobs, registerJob } from "../src/services/jobs";
import { bondsReport, deskCue, deskSuggestions, deskView, recapSince, secretsReport, storyAudit, threadsReport } from "../src/steer/desk";
import { timeskip, untilMinutes } from "../src/trackers/service";
import { currentFold, linesToOps, writeEvents } from "../src/trackers/store";
import { freshDb } from "./helpers";

let chatId = "";
const settings = () => parseJson<ChatSettings>(mustChat(chatId).settings, {});
function reply(text: string, lines: string[] = []) {
  const id = addMessage(chatId, "assistant", text, { name: "Willow" });
  if (lines.length) writeEvents(chatId, { messageId: id, swipeIdx: 0 }, linesToOps(lines).ops, "model");
  return id;
}

beforeAll(async () => {
  freshDb();
  pauseJobs(true);
  for (const kind of ["memory.segment", "memory.build", "memory.embed", "accuracy.check", "tracker.update", "offpage.reword", "lessons.learn"]) registerJob(kind, async () => {});
  const connId = createConnection({ name: "Mock", kind: "mock", billing: "subscription" });
  await syncModels(connId);
  createProfile({ name: "Story", connectionId: connId, modelId: "mock/storyteller", params: { context_target: 6000, max_tokens: 300 } });
  const { data } = normalizeCard({ spec: "chara_card_v2", data: { name: "Willow", first_mes: "The library is dark." } });
  chatId = createChat({ characterId: createCharacter(data) }).id;
  reply("The library is dark.", ["clock: Day 2 17:30", "at: Sunnydale › Library", "cast: Willow@spot · Giles@off", "thread The missing book: new — a page is gone"]);
  const id = reply("Willow and you talk.", ["bond Willow>You: trust +2 — you kept her secret", "secret #heaven: Buffy was in Heaven | kept by Willow · from Giles"]);
  writeEvents(chatId, { messageId: id, swipeIdx: 0 }, linesToOps(["expose #heaven: 5"]).ops, "user");
  for (let i = 0; i < 31; i++) addMessage(chatId, i % 2 ? "assistant" : "user", `Line ${i}.`, { name: i % 2 ? "Willow" : undefined });
});
afterAll(() => pauseJobs(false));

describe("the Director's Desk (F2)", () => {
  test("skip ahead: until evening / morning / next day from the story's clock", () => {
    expect(untilMinutes("until evening", 2 * 1440 + 17 * 60 + 30)).toBe(30);
    expect(untilMinutes("until morning", 2 * 1440 + 22 * 60)).toBe(10 * 60);
    expect(untilMinutes("next day", null)).toBe(1440);
    expect(untilMinutes("3 days", 0)).toBeNull();
    expect(() => untilMinutes("until morning", null)).toThrow();
  });

  test("the top row knows what matters now: a stalled thread, nightfall, a secret close to out", () => {
    const s = deskSuggestions(chatId);
    expect(s.length).toBeLessThanOrEqual(3);
    expect(s.map((x) => x.label)).toEqual(expect.arrayContaining(["Thread stalled 32 msgs", "A secret is close to out (5/6)", "Night is falling"]));
  });

  test("reports: bonds since the chapter began, threads with Push this one, secrets", () => {
    const b = bondsReport(chatId);
    expect(b.bonds[0]).toMatchObject({ from: "Willow", changes: [{ axis: "trust", delta: 2, now: 2 }] });
    const t = threadsReport(chatId);
    expect(t.threads[0]).toMatchObject({ title: "The missing book", state: "stalled" });
    expect(t.threads[0]!.push).toContain("Push the thread");
    expect(secretsReport(chatId).clocks[0]).toMatchObject({ key: "heaven", cur: 5, max: 6 });
  });

  test("Cut to, Bring someone in, Push, Raise the stakes and Breathe set a one-shot cue", () => {
    expect(deskView(chatId)).toMatchObject({ here: ["Willow"], away: [{ name: "Giles" }] });
    deskCue(chatId, { kind: "cut", to: "Giles" });
    expect(settings().cue).toContain("Cut to Giles");
    deskCue(chatId, { kind: "bring", who: "Giles" });
    expect(settings().cue).toContain("Bring Giles into the scene");
    deskCue(chatId, { kind: "push", thread: "The missing book" });
    expect(settings().cue).toContain('"The missing book"');
    deskCue(chatId, { kind: "breathe" });
    expect(settings().cue).toContain("breathe");
  });

  test("a skip until morning moves the clock to 08:00", () => {
    timeskip(chatId, "until morning");
    expect(currentFold(chatId).result.state.time?.minutes).toBe(2 * 1440 + 8 * 60);
  });

  test("the story audit queues every check over the last N replies", () => {
    expect(storyAudit(chatId, 5)).toEqual({ queued: 5 });
    expect(all("SELECT id FROM jobs WHERE kind = 'accuracy.check'").length).toBeGreaterThanOrEqual(5);
  });

  test("since I was away: a recap of only what's new", async () => {
    const r = await recapSince(chatId, Date.now() + 60_000);
    expect(r).toEqual({ recap: "Nothing new since you were last here.", count: 0 });
    const all_ = await recapSince(chatId, 0);
    expect(all_.count).toBeGreaterThan(30);
    expect(all_.recap.length).toBeGreaterThan(0);
  });
});
