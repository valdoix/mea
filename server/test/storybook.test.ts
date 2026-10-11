import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createOffpage } from "../src/accuracy/offpage";
import { normalizeCard } from "../src/cards/card";
import { categoryOf } from "../src/lore/format";
import { storyBook, storyBookDraft, storyBookJson } from "../src/lore/fromstory";
import { commitDraft } from "../src/lore/studio";
import { getLorebook } from "../src/lore/service";
import { createEntity, updateEntity } from "../src/memory/entities";
import { createCharacter } from "../src/services/characters";
import { addMessage, createChat, getMessageRow, updateChat } from "../src/services/chats";
import { pauseJobs, registerJob } from "../src/services/jobs";
import { linesToOps, writeEvents } from "../src/trackers/store";
import { freshDb } from "./helpers";

let chatId = "";
let early = 0;

beforeAll(() => {
  freshDb();
  pauseJobs(true);
  for (const kind of ["memory.segment", "memory.build", "memory.embed", "accuracy.check", "tracker.update", "offpage.reword", "lessons.learn", "lore.embed", "lore.studio"]) registerJob(kind, async () => {});
  const { data } = normalizeCard({ spec: "chara_card_v2", data: { name: "Buffy", first_mes: "Patrol." } });
  chatId = createChat({ characterId: createCharacter(data) }).id;
  updateChat(chatId, { title: "Sunnydale", settings: { truths: ["Vampires can't enter uninvited."] } });
  const say = (lines: string[]) => {
    const id = addMessage(chatId, "assistant", "…", { name: "Buffy" });
    writeEvents(chatId, { messageId: id, swipeIdx: 0 }, linesToOps(lines).ops, "model");
    return id;
  };
  const first = say(["clock: Day 1 22:00", "at: Sunnydale › Cemetery", "cast: Buffy@spot · Spike@spot", "bond Buffy>Spike: trust +2; resentment +1 — he helped"]);
  early = getMessageRow(first)!.seq;
  say(["secret #heaven: Willow pulled Buffy out of Heaven | kept by Willow · from Buffy", "motif \"the Bronze on a Friday\"", "promise Spike>Buffy: watch Dawn | open"]);
  const spike = createEntity(chatId, { name: "Spike", kind: "person", description: "A bleached vampire with a chip in his head." });
  updateEntity(typeof spike === "string" ? spike : spike.id, { facts: ["He's in love with Buffy.", "Willow pulled Buffy out of Heaven, he overheard."] });
  createOffpage(chatId, { label: "Willow pulled Buffy out of Heaven.", neverSay: ["Heaven"] });
});
afterAll(() => pauseJobs(false));

const byTitle = (b: ReturnType<typeof storyBook>, t: string | RegExp) => b.entries.find((e) => (typeof t === "string" ? e.comment === t : t.test(e.comment)));

describe("story → lorebook (I3)", () => {
  test("the story becomes a categorised lorebook", () => {
    const b = storyBook(chatId);
    expect(categoryOf(byTitle(b, /where the story stands/)!)).toBe("timeline");
    expect(byTitle(b, "Story truths")!.content).toContain("uninvited");
    expect(categoryOf(byTitle(b, "Spike")!)).toBe("character");
    expect(byTitle(b, "Spike")!.content).toContain("chip in his head");
    expect(categoryOf(byTitle(b, "Buffy & Spike")!)).toBe("relationship");
    expect(byTitle(b, "Buffy & Spike")!.content).toContain("trust");
    expect(categoryOf(byTitle(b, /^Secret:/)!)).toBe("secret");
    expect(byTitle(b, /^Kept off the page/)!.content).toContain("Never say: Heaven");
    expect(byTitle(b, "Running bits")!.content).toContain("the Bronze on a Friday");
    expect(categoryOf(byTitle(b, "Promises and plans")!)).toBe("upcoming");
  });

  test("spoiler-safe leaves secrets out, and facts that give them away", () => {
    const b = storyBook(chatId, { spoilerSafe: true });
    expect(byTitle(b, /^Secret:/)).toBeUndefined();
    expect(byTitle(b, /^Kept off the page/)).toBeUndefined();
    expect(byTitle(b, "Spike")!.content).not.toContain("Heaven");
    expect(byTitle(b, "Spike")!.content).toContain("in love with Buffy");
  });

  test("as of an earlier message", () => {
    const b = storyBook(chatId, { uptoSeq: early });
    expect(byTitle(b, /^Secret:/)).toBeUndefined();
    expect(byTitle(b, "Running bits")).toBeUndefined();
    expect(byTitle(b, "Buffy & Spike")).toBeDefined();
  });

  test("exports as SillyTavern World Info, and opens in the Studio's plan, ready to save", () => {
    const json = storyBookJson(chatId) as { name: string; entries: Record<string, { comment: string; key: string[] }> };
    expect(json.name).toBe("Sunnydale (lore)");
    expect(Object.values(json.entries).some((e) => e.comment === "Spike" && e.key.includes("Spike"))).toBe(true);
    const d = storyBookDraft(chatId, { spoilerSafe: true });
    expect(d.stage).toBe("plan");
    expect(d.items.every((i) => i.status === "drafted" && i.category)).toBe(true);
    const saved = commitDraft(d.id);
    const book = getLorebook(saved.bookId)!;
    expect(book.entries.find((e) => e.comment === "Story truths")).toMatchObject({ constant: true, position: "before_char" });
  });
});
