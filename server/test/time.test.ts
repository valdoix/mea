import { beforeAll, describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import { normalizeCard } from "../src/cards/card";
import { activateLore, type ScanEntry } from "../src/lore/activate";
import { datesToday, monthDay } from "../src/lore/dates";
import { createFact, factsNow, supersedeFact } from "../src/lore/facts";
import { runTimeKeepup, updateProposals } from "../src/lore/keepup";
import { createEntry, createLorebook, scanEntriesFor } from "../src/lore/service";
import { durationIn } from "../src/lore/slots";
import { defaultEntry } from "../src/lore/types";
import { createCharacter } from "../src/services/characters";
import { addMessage, createChat, getMessage } from "../src/services/chats";
import { registerJob } from "../src/services/jobs";
import { parseStoryTime } from "../src/trackers/clock";
import { linesToOps, writeEvents } from "../src/trackers/store";
import { freshDb } from "./helpers";

let app: ReturnType<typeof createApp>;
let chatId = "";
let characterId = "";
let wren = "";
const msgs: string[] = [];
const at = (s: string) => parseStoryTime(s)!;
const clock = (i: number, when: string) => writeEvents(chatId, { messageId: msgs[i]!, swipeIdx: -1 }, linesToOps([`clock: ${when}`]).ops, "user");

beforeAll(() => {
  freshDb();
  app = createApp();
  for (const kind of ["memory.segment", "memory.build", "memory.embed", "tracker.update", "tracker.init", "lore.keepup", "lore.time", "lore.bond"]) registerJob(kind, async () => {});
  const { data } = normalizeCard({ spec: "chara_card_v2", data: { name: "Wren", description: "A ferry pilot.", first_mes: "Hi." } });
  characterId = createCharacter(data);
  chatId = createChat({ characterId }).id;
  const book = createLorebook({ name: "Wren", links: [{ target_type: "character", target_id: characterId }] });
  wren = createEntry(book, defaultEntry({ comment: "Wren", keys: ["Wren"], content: "Wren pilots the ferry.", extra: { type: "character" } })).id;
  for (let i = 0; i < 6; i++) msgs.push(addMessage(chatId, i % 2 ? "assistant" : "user", `Message ${i}.`, i % 2 ? { name: "Wren" } : {}));
  clock(0, "0300-01-18 09:00");
});

describe("5.1 anniversaries", () => {
  test("a birthday fires on the day in a test clock, and not the day before", () => {
    createFact(wren, { value: "19 January", slot: "birthday", origin: "you" });
    expect(monthDay("19 January")).toEqual({ month: 1, day: 19 });
    expect(monthDay("the 14th of the 10th moon")).toEqual({ month: 10, day: 14 });
    const entries = scanEntriesFor({ characterId, chatId });
    expect(datesToday(chatId, entries, at("0300-01-18 09:00"), "gregorian").size).toBe(0);
    const today = datesToday(chatId, entries, at("0300-01-19 09:00"), "gregorian");
    expect(today.get(wren)).toContain("is Wren's birthday");
  });

  test("an event with a story date fires again a year on, named by the chat's calendar, and the entry fires for it", () => {
    createFact(wren, { value: "The wedding at the sept", kind: "event", chatId, messageId: msgs[1]!, origin: "you", sinceTime: at("0299-03-02 12:00").minutes });
    const entries = scanEntriesFor({ characterId, chatId });
    const day = datesToday(chatId, entries, at("0300-03-02 08:00"), "westeros");
    expect(day.get(wren)).toMatch(/^Today, .*moon.*: a year since the wedding at the sept$/);
    const scan: ScanEntry[] = entries.map((e) => ({ ...e, keys: ["nobody says this"] }));
    const r = activateLore({ entries: scan, history: ["The bells ring."], messageCount: 5, state: {}, defaults: { scanDepth: 4, tokenBudget: 0, recursive: false, maxRecursion: 0, caseSensitive: false, matchWholeWords: true }, countTokens: (s) => s.length, dated: day });
    const hit = r.activated.find((a) => a.entry.id === wren)!;
    expect(hit.reason).toContain("date:");
    expect(hit.content).toContain("a year since the wedding");
    expect(r.trace.find((t) => t.id === wren)!.why).toBe("date");
  });
});

describe("5.2 things that wear off", () => {
  test("a state reads its duration from its words", () => {
    expect(durationIn("Arm in a sling, about six weeks")).toBe(6 * 7 * 1440);
    expect(durationIn("Mourning for a moon")).toBe(30 * 1440);
    expect(durationIn("Hair cut short")).toBeNull();
  });

  test("a six-week injury proposes healing after six story weeks, not before", () => {
    const sling = createFact(wren, { value: "Arm in a sling, about six weeks", slot: "injury (arm)", kind: "state", chatId, messageId: msgs[2]!, origin: "you", sinceTime: at("0300-01-18 09:00").minutes }).fact;
    expect(sling.expectsMinutes).toBe(6 * 7 * 1440);
    clock(3, "0300-02-20 09:00");
    expect(runTimeKeepup(chatId)).toHaveLength(0);
    clock(4, "0300-03-02 09:00");
    const made = runTimeKeepup(chatId);
    expect(made).toHaveLength(1);
    const card = updateProposals(chatId).find((p) => p.id === made[0])!;
    expect(card.diff.ops[0]).toMatchObject({ op: "retire", factId: sling.id });
    expect(card.diff.ops[0]!.note).toContain("have passed on the story's clock");
    // Asked once.
    expect(runTimeKeepup(chatId)).toHaveLength(0);
  });
});

describe("5.3 facts as of any message", () => {
  test("moving the slider before a change shows the earlier value", async () => {
    const f = createFact(wren, { value: "Riverrun", slot: "where", chatId, messageId: msgs[1]!, origin: "story" }).fact;
    supersedeFact(f.id, { value: "Saltpans", messageId: msgs[4]!, origin: "story" });
    const get = async (q: string) =>
      (await (await app.fetch(new Request(`http://localhost/api/lore/entries/${wren}/facts?chatId=${chatId}${q}`), { requestIP: () => ({ address: "127.0.0.1", family: "IPv4", port: 1 }) })).json()) as { facts: { value: string; now: boolean }[]; latest: number };
    const now = await get("");
    expect(now.latest).toBe(getMessage(msgs[5]!)!.seq);
    expect(now.facts.filter((x) => x.now).map((x) => x.value)).toContain("Saltpans");
    const before = await get(`&seq=${getMessage(msgs[3]!)!.seq}`);
    expect(before.facts.filter((x) => x.now).map((x) => x.value)).toContain("Riverrun");
    expect(before.facts.filter((x) => x.now).map((x) => x.value)).not.toContain("Saltpans");
    expect(factsNow(wren, chatId).find((x) => x.slot === "where")!.value).toBe("Saltpans");
  });
});
