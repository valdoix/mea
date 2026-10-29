import { beforeAll, describe, expect, test } from "bun:test";
import { inboxItems } from "../src/accuracy/inbox";
import { normalizeCard } from "../src/cards/card";
import { createCharacter } from "../src/services/characters";
import { addMessage, createChat, updateChat } from "../src/services/chats";
import { registerJob } from "../src/services/jobs";
import { decideNews, runTick } from "../src/sim/service";
import "../src/sim/newsinbox";
import { buildNote } from "../src/trackers/note";
import { currentFold, foldConfigFor, linesToOps, writeEvents } from "../src/trackers/store";
import { freshDb } from "./helpers";

/** docs/21 Part 5: off the page, news is hearsay; with news: ask, it waits for your word. */
let chatId = "";
const FACT = "The chandlery burned down in the storm";
const st = () => currentFold(chatId).result.state;
const stance = (name: string) => Object.values(st().facts).find((f) => f.statement === FACT)?.stances[name.toLowerCase()];
const later = (clock: string) => {
  const m = addMessage(chatId, "assistant", "Time passes.");
  writeEvents(chatId, { messageId: m, swipeIdx: 0 }, linesToOps([`clock: ${clock}`]).ops, "model");
};

beforeAll(() => {
  freshDb();
  for (const kind of ["world.tell", "world.word", "world.sheet"]) registerJob(kind, async () => {});
  const { data } = normalizeCard({ spec: "chara_card_v2", data: { name: "Mira", description: "Keeper of the lighthouse.", first_mes: "Welcome." } });
  chatId = createChat({ characterId: createCharacter(data) }).id;
  updateChat(chatId, { settings: { world: { mode: "living", telling: "engine", news: "ask" } } });
  const m = addMessage(chatId, "assistant", "The storm rolls in.");
  writeEvents(
    chatId,
    { messageId: m, swipeIdx: 0 },
    linesToOps(["clock: Day 1 08:00", "at: Port Ellis › Lighthouse", "cast: Mira@spot", "cast: Joss@left(→ Port Ellis › Harbour) · Kit@left(→ Port Ellis › Market)", `know Joss: ${FACT} | saw it · knows`, "bond Joss>Kit: affection 3 — old friends"]).ops,
    "model",
  );
  runTick(chatId, null, true);
});

describe("news: ask", () => {
  test("the news waits for your word, in the Inbox with its why, and nobody has heard it yet", () => {
    later("Day 4 08:00");
    runTick(chatId, null, true);
    const pending = Object.values(st().sim.newsAsk ?? {});
    expect(pending.map((p) => p.hop.to)).toEqual(["Kit"]);
    expect(stance("Kit")).toBeUndefined();
    const item = inboxItems({ chatId }).find((i) => i.kind === "worldnews")!;
    expect(item.title).toBe("Kit could hear it from Joss, in person");
    expect(item.why).toContain("tie: friend, in touch");
    // Asked once: the next tick doesn't ask again.
    later("Day 6 08:00");
    runTick(chatId, null, true);
    expect(Object.values(st().sim.newsAsk ?? {})).toHaveLength(1);
  });

  test("let it travel: they've probably heard, as hearsay, not that they know", () => {
    const p = Object.values(st().sim.newsAsk ?? {})[0]!;
    decideNews(chatId, p.id, true);
    expect(st().sim.newsAsk).toEqual({});
    expect(stance("Kit")).toMatchObject({ status: "heard", route: "told by Joss, in person" });
    expect(st().sim.news.at(-1)?.to).toBe("Kit");
  });

  test("the page settles it: the tracker's word that they know replaces the hearsay", () => {
    const m = addMessage(chatId, "assistant", "Kit mentions the chandlery fire.");
    writeEvents(chatId, { messageId: m, swipeIdx: 0 }, linesToOps([`know Kit: ${FACT} | mentioned it · knows`]).ops, "model");
    expect(stance("Kit")?.status).toBe("knows");
  });
});

describe("hearsay in the prompt", () => {
  test("someone who's probably heard is a maybe in KNOWLEDGE, and it fades if the page never shows it", () => {
    const local = createChat({ characterId: createCharacter(normalizeCard({ spec: "chara_card_v2", data: { name: "Mira", description: "x", first_mes: "y" } }).data) }).id;
    const m = addMessage(local, "assistant", "Joss comes in.");
    writeEvents(local, { messageId: m, swipeIdx: 0 }, linesToOps(["clock: Day 1 08:00", "at: Port Ellis › Lighthouse", "cast: Mira@spot · Joss@spot"]).ops, "model");
    writeEvents(local, { messageId: m, swipeIdx: 0 }, [{ op: "know", subject: "Joss", args: { fact: FACT, status: "heard", route: "told by Kit, by phone" }, cause: "news off the page", raw: "know Joss" }], "engine", { replace: [] });
    const fold = currentFold(local).result.state;
    const note = (seq: number) => buildNote(fold, { userName: foldConfigFor(local).userName, seq }).text;
    expect(note(fold.lastSeq)).toContain(`Joss has probably heard, off the page (told by Kit, by phone): ${FACT}`);
    expect(note(fold.lastSeq + 200)).not.toContain(FACT);
  });
});

describe("turning news down, and keeping it on the page", () => {
  const story = (news: "ask" | "off") => {
    const id = createChat({ characterId: createCharacter(normalizeCard({ spec: "chara_card_v2", data: { name: "Mira", description: "x", first_mes: "y" } }).data) }).id;
    updateChat(id, { settings: { world: { mode: "living", telling: "engine", news } } });
    const m = addMessage(id, "assistant", "The storm rolls in.");
    writeEvents(id, { messageId: m, swipeIdx: 0 }, linesToOps(["clock: Day 1 08:00", "at: Port Ellis › Lighthouse", "cast: Mira@spot", "cast: Joss@left(→ Port Ellis › Harbour) · Kit@left(→ Port Ellis › Market)", `know Joss: ${FACT} | saw it · knows`, "bond Joss>Kit: affection 3 — old friends"]).ops, "model");
    runTick(id, null, true);
    const tickAt = (clock: string) => {
      const n = addMessage(id, "assistant", "Time passes.");
      writeEvents(id, { messageId: n, swipeIdx: 0 }, linesToOps([`clock: ${clock}`]).ops, "model");
      runTick(id, null, true);
      return currentFold(id).result.state;
    };
    return { id, tickAt };
  };

  test("'Not this' isn't asked again", () => {
    const { id, tickAt } = story("ask");
    const p = Object.values(tickAt("Day 4 08:00").sim.newsAsk ?? {})[0]!;
    decideNews(id, p.id, false);
    const s = tickAt("Day 8 08:00");
    expect(s.sim.newsAsk).toEqual({});
    expect(Object.values(s.facts).find((f) => f.statement === FACT)?.stances.kit).toBeUndefined();
  });

  test("news: off keeps it on the page", () => {
    const { tickAt } = story("off");
    const s = tickAt("Day 4 08:00");
    expect(s.sim.newsAsk ?? {}).toEqual({});
    expect(s.sim.news).toEqual([]);
  });
});
