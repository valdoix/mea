import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { normalizeCard } from "../src/cards/card";
import { createCharacter } from "../src/services/characters";
import { addMessage, createChat } from "../src/services/chats";
import { filingsFor, undoFiling } from "../src/services/filings";
import { pauseJobs, registerJob } from "../src/services/jobs";
import { statusTiles } from "../src/services/status";
import { parseLine } from "../src/trackers/dsl";
import { buildNote } from "../src/trackers/note";
import { promisesAfterReply, promisesFor, setPromise, speakerOf, spokenDue, spokenPromises } from "../src/trackers/promises";
import { currentFold, linesToOps, writeEvents } from "../src/trackers/store";
import { freshDb } from "./helpers";

let chatId = "";

function say(role: "user" | "assistant", text: string, lines: string[] = []) {
  const id = addMessage(chatId, role, text, role === "assistant" ? { name: "Willow" } : {});
  if (lines.length) writeEvents(chatId, { messageId: id, swipeIdx: 0 }, linesToOps(lines).ops, "model");
  if (role === "assistant") promisesAfterReply(chatId, id, 0);
  return id;
}
const state = () => currentFold(chatId).result.state;
const char = (name: string) => Object.values(state().chars).find((c) => c.name === name)!;
const user = () => Object.values(state().chars).find((c) => c.isUser)!;
const bond = (from: string, to: string) => state().bonds[`${from}>${to}`]?.axes ?? {};
const find = (what: RegExp) => promisesFor(chatId).find((p) => what.test(p.what))!;

beforeAll(() => {
  freshDb();
  pauseJobs(true);
  for (const kind of ["memory.segment", "memory.build", "memory.embed", "accuracy.check", "tracker.update", "offpage.reword", "lessons.learn"]) registerJob(kind, async () => {});
  const { data } = normalizeCard({ spec: "chara_card_v2", data: { name: "Willow", first_mes: "Welcome." } });
  chatId = createChat({ characterId: createCharacter(data) }).id;
  const first = addMessage(chatId, "assistant", "The tavern is loud.", { name: "Willow" });
  writeEvents(chatId, { messageId: first, swipeIdx: -1 }, linesToOps(["clock: Day 2 18:00", "at: Port Ellis › The Anchor", "cast: Willow@spot"]).ops, "model");
});
afterAll(() => pauseJobs(false));

describe("promises on the clock (E3)", () => {
  test("times and promises are read from what was said", () => {
    expect(spokenDue("Meet me at the Bronze at nine tonight.")).toBe("21:00");
    expect(spokenDue("tomorrow by 10am")).toBe("tomorrow 10:00");
    expect(spokenDue("at 7:30 pm")).toBe("19:30");
    expect(spokenPromises(`She smiles. "Meet me at the Bronze Bell at nine."`, false)[0]).toMatchObject({ meet: "the Bronze Bell", due: "around 9:00", what: "be at the Bronze Bell" });
    expect(spokenPromises("I promise I'll bring the map back by noon.", true)[0]).toMatchObject({ what: "bring the map back by noon", due: "noon" });
    // Narration isn't dialogue: only quoted speech counts in a reply.
    expect(spokenPromises("She will meet you at the Bronze at nine, she thinks.", false)).toEqual([]);
    // Oaths, threats and lines cut off aren't promises.
    expect(spokenPromises(`"I swear to god if you call me Nattie one more time - " Nat threatens.`, false)).toEqual([]);
    expect(spokenPromises(`"I swear, you're impossible," she laughs.`, false)).toEqual([]);
    expect(spokenPromises(`"I swear I'll kill you if you touch her."`, false)).toEqual([]);
    expect(spokenPromises(`"I promise I'll come back for—" The door slams.`, false)).toEqual([]);
    expect(spokenPromises(`"I promise I'll..." he trails off.`, false)).toEqual([]);
    expect(spokenPromises(`"I swear to god I'll get you out of here."`, false)[0]).toMatchObject({ what: "get you out of here", importance: 3 });
    expect(spokenPromises(`"I promise you, I won't tell a soul."`, false)[0]).toMatchObject({ what: "not tell a soul" });
    expect(spokenPromises(`"I promise to write every week."`, false)[0]).toMatchObject({ what: "write every week" });
    expect(parseLine("promise Willow>You: be there | meet @ the Bronze · vital [due 21:00] [window 30m]")?.args).toMatchObject({ meet: "the Bronze", importance: 3, window: "30m", due: "21:00" });
  });

  test("a meeting in the reply's dialogue becomes a promise with a chip", () => {
    const id = say("assistant", `Willow leans close. "Meet me at the Bronze at nine. Don't be late."`);
    const p = find(/Bronze/);
    expect(p).toMatchObject({ who: "Willow", meet: "the Bronze", status: "open", left: 180 });
    expect(filingsFor(chatId).find((f) => f.messageId === id && f.kind === "promise")?.label).toContain("Willow promised");
    // Read again: no second promise, no second chip.
    promisesAfterReply(chatId, id, 0);
    expect(promisesFor(chatId).filter((x) => /Bronze/.test(x.what)).length).toBe(1);
    expect(filingsFor(chatId).filter((f) => f.messageId === id).length).toBe(1);
  });

  test("a reminder shows on the Status tile and in the note shortly before", () => {
    say("assistant", "Time passes.", ["clock: Day 2 20:20"]);
    expect(statusTiles(chatId).find((t) => t.id === "promise")).toMatchObject({ value: "40 min", n: 1, label: "meeting at the Bronze" });
    const note = buildNote(state(), { userName: user().name, seq: 10 })?.text ?? "";
    expect(note).toContain("Meeting: Willow promised");
    expect(note).toContain("in 40 min");
  });

  test("both there in the window, at the place: kept, and trust rises", () => {
    say("assistant", "The Bronze is warm.", ["clock: Day 2 20:55", "at: Port Ellis › The Bronze", "cast: Willow@spot"]);
    expect(find(/Bronze/)).toMatchObject({ status: "kept", auto: true });
    expect(bond(user().id, char("Willow").id).trust).toBe(1);
  });

  test("your own promise counts; stood up, it's broken, and an override takes the bond back", () => {
    say("user", "I promise I'll bring the ledger by noon tomorrow.");
    say("assistant", `"You'd better," Willow says.`);
    const p = find(/ledger/);
    expect(p).toMatchObject({ who: user().name, status: "open" });
    say("assistant", "Days go by.", ["clock: Day 4 13:00"]);
    expect(find(/ledger/)).toMatchObject({ status: "broken", auto: true });
    expect(bond(char("Willow").id, user().id)).toMatchObject({ trust: -1, resentment: 1 });
    setPromise(chatId, p.id, "forgiven");
    expect(bond(char("Willow").id, user().id)).toMatchObject({ trust: -1, resentment: 0 });
    setPromise(chatId, p.id, "open");
    setPromise(chatId, p.id, "broken");
    setPromise(chatId, p.id, "excused");
    expect(bond(char("Willow").id, user().id)).toMatchObject({ trust: 0, resentment: 0 });
  });

  test("a quote goes to whoever the narration says spoke it", () => {
    const cast = [{ name: "James Holloway" }, { name: "Natalie Reyes", aliases: ["Nat"] }];
    const near = (s: string) => spokenPromises(s, false)[0]?.near;
    expect(speakerOf(near(`"I promise I'll be careful," Nat says, glancing at James.`), cast)).toBe("Natalie Reyes");
    expect(speakerOf(near(`James sighs. "I promise I'll be careful."`), cast)).toBe("James Holloway");
    expect(speakerOf(near(`"I promise I'll be careful."`), cast)).toBeUndefined();
  });

  test("Undo on the chip takes the promise back, and it isn't found again", () => {
    const id = say("assistant", `"I swear I'll find your brother," Willow says.`);
    const f = filingsFor(chatId).find((x) => x.messageId === id && x.kind === "promise")!;
    expect(find(/find your brother/)).toMatchObject({ importance: 3 });
    undoFiling(f.id);
    expect(promisesFor(chatId).some((x) => /brother/.test(x.what))).toBe(false);
    promisesAfterReply(chatId, id, 0);
    expect(promisesFor(chatId).some((x) => /brother/.test(x.what))).toBe(false);
  });
});
