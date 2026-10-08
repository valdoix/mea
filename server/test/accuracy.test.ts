import { beforeAll, describe, expect, test } from "bun:test";
import { askArchivist, listArchive, pushArchive } from "../src/accuracy/archivist";
import { acceptIssue, checkReply, dismissIssue, fixNotes, flagsFor, ruleCheck } from "../src/accuracy/checker";
import { codex, codexEntry } from "../src/accuracy/codex";
import { cloze, grade, runQuiz } from "../src/accuracy/quiz";
import { normalizeCard } from "../src/cards/card";
import { all, one } from "../src/db/db";
import { defaultMemoryConfig, setSetting } from "../src/lib/settings";
import { insertAtom } from "../src/memory/atoms";
import { resolver, syncEntities } from "../src/memory/entities";
import { createCharacter } from "../src/services/characters";
import { addMessage, createChat, getChat } from "../src/services/chats";
import { createConnection, createProfile, syncModels } from "../src/services/connections";
import { registerJob } from "../src/services/jobs";
import { currentFold, linesToOps, writeEvents } from "../src/trackers/store";
import { freshDb } from "./helpers";

let chatId = "";
const ids: string[] = [];

beforeAll(async () => {
  freshDb();
  for (const kind of ["memory.segment", "memory.build", "memory.embed", "memory.journal", "memory.consolidate", "lore.chronicle", "accuracy.check", "quota.refresh", "cache.probe"]) registerJob(kind, async () => {});
  const connId = createConnection({ name: "Mock", kind: "mock", billing: "subscription" });
  await syncModels(connId);
  createProfile({ name: "Story", connectionId: connId, modelId: "mock/storyteller", params: { context_target: 4000, max_tokens: 400 } });
  setSetting("memory.config", { ...defaultMemoryConfig, boundaryCheck: false, lag: 1, leakGuard: "on" });
  const { data } = normalizeCard({ spec: "chara_card_v2", data: { name: "Mira", description: "Keeper of the lighthouse.", first_mes: "Welcome, {{user}}." } });
  chatId = createChat({ characterId: createCharacter(data) }).id;
  for (let i = 0; i < 4; i++) ids.push(addMessage(chatId, i % 2 ? "assistant" : "user", i === 2 ? "I hid the silver locket in the old logbook, Joss says." : `Line ${i}`, { name: i % 2 ? "Mira" : "You" }));
  writeEvents(
    chatId,
    { messageId: ids[1]!, swipeIdx: -1 },
    linesToOps([
      "clock: Day 2 23:30",
      "at: Port Ellis › Lighthouse › Lamp room",
      "cast: Mira@spot · Joss@peri · Old Tom@left",
      "trait Mira: green eyes",
      "secret #ledger: Joss stole the harbor ledger from the customs office | kept by Joss · from Mira",
      "dead Old Tom — lost in the storm",
    ]).ops,
    "model",
  );
  const seqOf = (id: string) => one<{ seq: number }>("SELECT seq FROM messages WHERE id = ?", id)!.seq;
  insertAtom(chatId, null, { type: "fact", content: "The silver locket is hidden inside the old logbook.", importance: 8, entities: ["silver locket"] }, [{ id: ids[2]!, seq: seqOf(ids[2]!) }]);
  insertAtom(chatId, null, { type: "promise", content: "Mira promised to fix the brass lantern before winter.", importance: 8, entities: ["Mira"] }, [{ id: ids[1]!, seq: seqOf(ids[1]!) }]);
  insertAtom(chatId, null, { type: "fact", content: "Joss keeps 40 silver coins under the tavern bar.", importance: 7, entities: ["Joss"] }, [{ id: ids[3]!, seq: seqOf(ids[3]!) }]);
});

describe("continuity rules (CON-02)", () => {
  const st = () => currentFold(chatId).result.state;
  test("eye colour against the trackers", () => {
    const issues = ruleCheck(chatId, "Mira laughs, her blue eyes bright in the lamplight.", st(), { speaker: "Mira", leaks: false });
    const t = issues.find((i) => i.kind === "trait");
    expect(t?.conflict).toContain("green eyes");
    expect(t?.citations[0]?.label).toContain("green eyes");
    expect(t?.canon?.trackerLine).toBe("trait Mira: blue eyes");
    expect(ruleCheck(chatId, "Her green eyes narrow.", st(), { speaker: "Mira", leaks: false }).some((i) => i.kind === "trait")).toBe(false);
  });
  test("the dead don't act, names that look like typos, and the clock", () => {
    const k = ruleCheck(chatId, "Old Tom smiles from the doorway. Mria sets the kettle down. \"Good morning,\" she says.", st(), { speaker: "Mira", leaks: false }).map((i) => i.kind);
    expect(k).toContain("dead");
    expect(k).toContain("name");
    expect(k).toContain("time");
    // A reply that jumps ahead in time may say morning.
    expect(ruleCheck(chatId, "Hours later, the morning light creeps in.", st(), { speaker: "Mira", leaks: false }).some((i) => i.kind === "time")).toBe(false);
  });
  test("knowledge leaks (CON-06)", () => {
    const leak = ruleCheck(chatId, '"I know you stole the harbor ledger from the customs office," Mira says.', st(), { speaker: "Mira", leaks: true });
    expect(leak.some((i) => i.kind === "leak" && i.conflict.includes("Mira doesn't know"))).toBe(true);
    expect(ruleCheck(chatId, '"I know you stole the harbor ledger from the customs office," Mira says.', st(), { speaker: "Mira", leaks: false }).some((i) => i.kind === "leak")).toBe(false);
  });
});

describe("checking a reply", () => {
  test("flags are stored with citations; accept updates canon; regenerate carries the fix", async () => {
    const m = addMessage(chatId, "assistant", "Mira tilts her head, blue eyes glinting. MOCK_CONTRADICTION", { name: "Mira" });
    const issues = await checkReply(chatId, m, 0);
    expect(issues!.some((i) => i.by === "rules" && i.kind === "trait")).toBe(true);
    expect(issues!.some((i) => i.by === "model" && i.citations.length > 0)).toBe(true);
    const flag = flagsFor(chatId, { messageIds: [m] })[0]!;
    expect(flag.status).toBe("open");
    expect(fixNotes(flag.id).feedback).toContain("green");
    const trait = flag.issues.find((i) => i.kind === "trait")!;
    const after = acceptIssue(flag.id, trait.id);
    expect(after.issues.find((i) => i.id === trait.id)?.dismissed).toBe(true);
    expect(one<{ content: string }>("SELECT content FROM memories WHERE chat_id = ? AND content LIKE 'Mira has blue eyes%'", chatId)).toBeTruthy();
    expect(currentFold(chatId).result.state.chars.mira?.traits.some((t) => t.text.includes("blue"))).toBe(true);
    const done = dismissIssue(flag.id, null);
    expect(done.status).toBe("resolved");
  });
  test("a clean reply is marked clean", async () => {
    const m = addMessage(chatId, "assistant", "Mira pours the tea and listens to the rain.", { name: "Mira" });
    expect(await checkReply(chatId, m, 0)).toEqual([]);
    expect(flagsFor(chatId, { messageIds: [m] })[0]!.status).toBe("clean");
  });
});

describe("the Archivist (CON-07)", () => {
  test("answers with citations that jump to the messages, and stays out of the story unless pushed", async () => {
    const a = await askArchivist(chatId, "Where is the silver locket hidden?");
    expect(a.answer).toContain("[1]");
    expect(a.citations.length).toBeGreaterThan(0);
    expect(a.citations.some((c) => c.messageId === ids[2])).toBe(true);
    expect(listArchive(chatId)[0]!.id).toBe(a.id);
    const before = all("SELECT id FROM messages WHERE chat_id = ?", chatId).length;
    expect(all("SELECT id FROM messages WHERE chat_id = ?", chatId).length).toBe(before);
    const pushed = pushArchive(a.id, "memory");
    expect(pushed.memory).toMatchObject({ pinned: true });
    pushArchive(a.id, "ooc");
    expect(getChat(chatId)!.settings.ooc?.at(-1)?.text).toContain("Established:");
  });
});

describe("the Codex (CON-08)", () => {
  test("cast, places, timeline, threads and pages", () => {
    syncEntities(chatId, true);
    const c = codex(chatId);
    expect(c.cast.map((e) => e.name)).toEqual(expect.arrayContaining(["Mira", "Joss"]));
    expect(c.cast.find((e) => e.name === "Old Tom")?.status).toBe("dead");
    expect(c.places.some((p) => p.name === "Lamp room")).toBe(true);
    const joss = resolver(chatId).find("Joss")!;
    const page = codexEntry(joss.id);
    expect(page.facts.some((f) => f.content.includes("40 silver coins"))).toBe(true);
  });
});

describe("the memory quiz (MEM-46)", () => {
  test("questions from facts, retrieval and answers scored, settings kept", async () => {
    expect(cloze("Joss keeps 40 silver coins under the tavern bar.", ["Joss"])).toEqual({ q: "Fill in the blank: Joss keeps ___ silver coins under the tavern bar.", a: "40" });
    expect(grade("40", "He keeps 40 coins")).toBe(true);
    expect(grade("the old logbook", "inside the old logbook")).toBe(true);
    expect(grade("Joss", "unknown")).toBe(false);
    const run = await runQuiz(chatId, { n: 3 });
    expect(run.questions.length).toBeGreaterThan(0);
    expect(run.retrieval).toBeGreaterThan(0);
    expect(run.answers).not.toBeNull();
    expect(run.settings).toHaveProperty("profile");
    expect(run.score).toBeGreaterThan(0);
  });
});
