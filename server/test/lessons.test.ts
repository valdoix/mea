import { beforeAll, describe, expect, test } from "bun:test";
import { checkReply } from "../src/accuracy/checker";
import { actOnInbox, inboxItems } from "../src/accuracy/inbox";
import { normalizeCard } from "../src/cards/card";
import { all, one, run } from "../src/db/db";
import { defaultMemoryConfig, setSetting } from "../src/lib/settings";
import { applyChange, checkChanges, undoStep } from "../src/meus/changes";
import { createCharacter } from "../src/services/characters";
import { addMessage, addSwipe, createChat, setActiveSwipe, updateSwipe } from "../src/services/chats";
import { createConnection, createProfile, syncModels } from "../src/services/connections";
import { previewPrompt } from "../src/services/generation";
import { registerJob } from "../src/services/jobs";
import { activeLessons, addLesson, getLesson, learnFromEdit, learnFromSwipes, lessonsFor, noteKeptSwipe, REST_AFTER, updateLesson } from "../src/steer/lessons";
import { linesToOps, writeEvents } from "../src/trackers/store";
import { freshDb } from "./helpers";

let chatId = "";
let characterId = "";
let replyId = "";

const DEAD_TAKE = "Old Tom says hello from the doorway, shaking rain from his coat. The lamp hums. Mira pours the tea and listens to the storm.";
const KEPT_TAKE = "The lamp hums. Mira pours the tea and listens to the storm, the old logbook open on her knees.";

/** A reply with two takes: the dead speak in the first, the second is kept. */
function swiped(first: string, second: string) {
  const id = addMessage(chatId, "assistant", first, { name: "Mira" });
  const idx = addSwipe(id, "done");
  updateSwipe(id, idx, { content: second, status: "done" });
  setActiveSwipe(id, idx);
  return id;
}

beforeAll(async () => {
  freshDb();
  for (const kind of ["memory.segment", "memory.build", "memory.embed", "memory.journal", "memory.consolidate", "lore.chronicle", "accuracy.check", "quota.refresh", "cache.probe", "lessons.learn", "lessons.edit", "tracker.update"]) registerJob(kind, async () => {});
  const connId = createConnection({ name: "Mock", kind: "mock", billing: "subscription" });
  await syncModels(connId);
  createProfile({ name: "Story", connectionId: connId, modelId: "mock/storyteller", params: { context_target: 6000, max_tokens: 400 } });
  setSetting("memory.config", { ...defaultMemoryConfig, boundaryCheck: false, checkerModel: false });
  const { data } = normalizeCard({ spec: "chara_card_v2", data: { name: "Mira", description: "Keeper of the lighthouse.", first_mes: "Welcome." } });
  characterId = createCharacter(data);
  chatId = createChat({ characterId }).id;
  const first = addMessage(chatId, "assistant", "The lamp hums.", { name: "Mira" });
  writeEvents(chatId, { messageId: first, swipeIdx: -1 }, linesToOps(["clock: Day 2 23:30", "cast: Mira@spot · Old Tom@left", "dead Old Tom — lost in the storm"]).ops, "model");
  addMessage(chatId, "user", "Who's at the door?", { name: "You" });
  replyId = swiped(DEAD_TAKE, KEPT_TAKE);
});

describe("lessons from swipes (A1)", () => {
  test("a take where the dead speak teaches that they're dead and don't speak", async () => {
    const found = await learnFromSwipes(chatId, replyId);
    expect(found).toHaveLength(1);
    const l = found[0]!;
    expect(l.text).toContain("Old Tom is dead");
    expect(l.text).toContain("don't speak");
    expect(l).toMatchObject({ status: "suggested", by: "rules", messageId: replyId, scope: "story" });
    expect(l.data.slip).toEqual({ kind: "dead", subject: "Old Tom" });
    // Evidence: the take passed over, and the one kept.
    expect(l.quote).toContain("Old Tom says hello");
    expect(l.data.rejected?.[0]?.quote).toContain("Old Tom says hello");
    expect(l.data.kept).toContain("old logbook");
  });

  test("learning again suggests nothing twice", async () => {
    expect(await learnFromSwipes(chatId, replyId)).toHaveLength(0);
  });

  test("suggestions wait in the Inbox too, and approving one keeps it", () => {
    const item = inboxItems({ chatId }).find((i) => i.kind === "lesson");
    expect(item).toMatchObject({ source: "lesson" });
    expect(item!.after).toContain("Old Tom is dead");
    actOnInbox(item!.key, "accept");
    expect(lessonsFor(chatId).find((l) => l.messageId === replyId)?.status).toBe("kept");
  });

  test("a kept lesson goes into the next prompt, in the [LESSONS] lane", async () => {
    const p = await previewPrompt(chatId);
    const b = p.trace.blocks.find((x) => x.lane === "lessons");
    expect(b?.included).toBe(true);
    expect(b?.text).toContain("Old Tom is dead");
    expect(p.messages.some((m) => m.content.includes("[LESSONS]") && m.content.includes("Old Tom is dead"))).toBe(true);
  });

  test("breaking a kept lesson flags the reply and makes the lesson stronger (once per reply)", async () => {
    addMessage(chatId, "user", "Is Tom here?", { name: "You" });
    const bad = addMessage(chatId, "assistant", "Old Tom nodded at her from the stairs. The lamp hums.", { name: "Mira" });
    const issues = (await checkReply(chatId, bad, 0)) ?? [];
    const lesson = issues.find((i) => i.kind === "lesson");
    expect(lesson?.conflict).toContain("breaks a lesson you kept");
    expect(lesson?.citations[0]?.type).toBe("lesson");
    const l = lessonsFor(chatId).find((x) => x.messageId === replyId)!;
    expect(l.strength).toBe(2);
    await checkReply(chatId, bad, 0);
    expect(getLesson(l.id)!.strength).toBe(2);
  });

  test("a lesson not needed for 200 messages rests, and leaves the prompt", async () => {
    const l = lessonsFor(chatId).find((x) => x.messageId === replyId)!;
    const seq = one<{ s: number }>("SELECT MAX(seq) AS s FROM messages WHERE chat_id = ?", chatId)!.s;
    run("UPDATE lessons SET last_broken_seq = ?, data = ? WHERE id = ?", seq - REST_AFTER, JSON.stringify({ ...l.data, seen: { [chatId]: seq - REST_AFTER } }), l.id);
    expect(lessonsFor(chatId).find((x) => x.id === l.id)?.resting).toBe(true);
    expect(activeLessons(chatId).some((x) => x.id === l.id)).toBe(false);
    const p = await previewPrompt(chatId);
    expect(p.trace.blocks.some((x) => x.lane === "lessons" && x.included)).toBe(false);
  });

  test("breaking a resting lesson wakes it", async () => {
    addMessage(chatId, "user", "And now?", { name: "You" });
    const bad = addMessage(chatId, "assistant", "Old Tom says goodnight. The lamp hums.", { name: "Mira" });
    await checkReply(chatId, bad, 0);
    const l = lessonsFor(chatId).find((x) => x.messageId === replyId)!;
    expect(l.resting).toBe(false);
    expect(l.strength).toBe(3);
  });

  test("passing over longer takes for a short one teaches length", async () => {
    const long = `${"The waves roll in against the rocks below the lighthouse, slow and grey. ".repeat(12)}`;
    const id = addMessage(chatId, "assistant", long, { name: "Mira" });
    const i2 = addSwipe(id, "done");
    updateSwipe(id, i2, { content: long, status: "done" });
    const i3 = addSwipe(id, "done");
    updateSwipe(id, i3, { content: "Mira sets the cup down beside you and watches the rain run down the glass for a long while. The fire pops once, then settles. She smiles at nothing in particular, then at you, and says nothing at all for a while longer.", status: "done" });
    setActiveSwipe(id, i3);
    const found = await learnFromSwipes(chatId, id);
    expect(found.some((l) => l.data.slip?.kind === "length" && /short/i.test(l.text))).toBe(true);
  });

  test("your edit teaches too: cutting the dead's lines", async () => {
    const id = addMessage(chatId, "assistant", "Old Tom laughs by the fire.", { name: "Mira" });
    run("DELETE FROM lessons WHERE chat_id = ? AND by != 'user'", chatId);
    const found = await learnFromEdit(chatId, id, "Old Tom laughs by the fire. Mira hums.", "Mira hums.");
    expect(found[0]).toMatchObject({ by: "edit", status: "suggested" });
    expect(found[0]!.data.from).toBe("edit");
  });

  test("a character lesson follows the card into a new chat; a story lesson stays", () => {
    const own = addLesson(chatId, { text: "Mira never raises her voice.", scope: "character" });
    const story = addLesson(chatId, { text: "The lighthouse lamp is never allowed to go out.", scope: "story" });
    const other = createChat({ characterId }).id;
    const there = lessonsFor(other).map((l) => l.id);
    expect(there).toContain(own.id);
    expect(there).not.toContain(story.id);
    updateLesson(own.id, { status: "off" });
    expect(activeLessons(other).some((l) => l.id === own.id)).toBe(false);
  });

  test("sending after a swiped reply queues learning; a reply with one take doesn't", () => {
    const before = all("SELECT 1 FROM jobs WHERE kind = 'lessons.learn'").length;
    const u = addMessage(chatId, "user", "Next.", { name: "You" });
    noteKeptSwipe(chatId, u); // the reply before has one take
    expect(all("SELECT 1 FROM jobs WHERE kind = 'lessons.learn'").length).toBe(before);
    swiped("First take, Old Tom says hi.", "Second take.");
    const u2 = addMessage(chatId, "user", "Go on.", { name: "You" });
    noteKeptSwipe(chatId, u2);
    expect(all("SELECT 1 FROM jobs WHERE kind = 'lessons.learn'").length).toBe(before + 1);
  });

  test("Meus can keep a lesson, and Undo takes it back", () => {
    const { changes } = checkChanges(chatId, [{ kind: "lesson", text: "Keep the storm going all night.", scope: "story" }]);
    expect(changes[0]).toMatchObject({ kind: "lesson", after: "Keep the storm going all night." });
    const steps = applyChange(chatId, { ...changes[0]!, id: "c1" });
    expect(activeLessons(chatId).some((l) => l.text === "Keep the storm going all night.")).toBe(true);
    for (const s of steps.reverse()) undoStep(chatId, s);
    expect(lessonsFor(chatId).some((l) => l.text === "Keep the storm going all night.")).toBe(false);
  });
});
