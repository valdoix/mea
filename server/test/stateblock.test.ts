import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { findOutdated } from "../src/accuracy/promptcheck";
import { normalizeCard } from "../src/cards/card";
import { type ActivationInput, activateLore, essentialsOf, type ScanEntry } from "../src/lore/activate";
import { defaultEntry } from "../src/lore/types";
import { doneMatcher, doneRecords, memoryText, PLAIN } from "../src/memory/openlist";
import { createCharacter } from "../src/services/characters";
import { addMessage, addSwipe, createChat, setActiveSwipe } from "../src/services/chats";
import { pauseJobs, registerJob } from "../src/services/jobs";
import { roomLine } from "../src/trackers/belongings";
import { parseLine } from "../src/trackers/dsl";
import { type FoldConfig, foldEvents, type TrackerEvent } from "../src/trackers/fold";
import { longThreads } from "../src/trackers/longthreads";
import { buildNote } from "../src/trackers/note";
import { STARTER_TEMPLATES } from "../src/trackers/schema";
import { standing } from "../src/trackers/stands";
import { currentFold, linesToOps, writeEvents } from "../src/trackers/store";
import { firstClause, todayLines, todaysBeats } from "../src/trackers/today";
import { isAnimal } from "../src/trackers/whois";
import { freshDb } from "./helpers";

/** docs/33 Part 5b: the rest of the state block. */
const cfg: FoldConfig = { userName: "Gabriel", mainName: "Buffy", sealedPersona: true, romance: "slow", strictness: "lenient", limits: true, templates: STARTER_TEMPLATES };
let n = 0;
const fold = (messages: string[][]) =>
  foldEvents(
    messages.flatMap((lines, i) => lines.map((l): TrackerEvent => ({ id: `e${++n}`, messageId: `m${i + 1}`, seq: i + 1, source: "model", op: parseLine(l)! }))),
    cfg,
  ).state;
const note = (st: ReturnType<typeof fold>, seq = 99) => buildNote(st, { userName: "Gabriel", seq })?.text ?? "";

let charId = "";
beforeAll(() => {
  freshDb();
  pauseJobs(true);
  for (const kind of ["memory.segment", "memory.build", "memory.embed", "memory.journal", "accuracy.check", "tracker.update", "lessons.learn", "offpage.reword", "loops.backfill", "tracker.beats"]) registerJob(kind, async () => {});
  const { data } = normalizeCard({ spec: "chara_card_v2", data: { name: "Buffy", first_mes: "Hi." } });
  charId = createCharacter(data);
});
afterAll(() => pauseJobs(false));

describe("today so far (5.4)", () => {
  const day = () =>
    fold([
      ["clock: Day 1 20:15", "at: Sunnydale › House › Shower", "cast: Buffy@spot", "beat: they finish in the shower"],
      ["clock: Day 2 06:00", "at: Sunnydale › House › Kitchen", "beat: Gabriel makes omelettes, waffles and a bento for Dawn; Buffy steals a gummy"],
      ["clock: Day 2 09:05", "at: Sunnydale › Mall › Parking lot", "beat: Buffy admits she gets jealous of his food"],
      ["clock: Day 2 09:15", "at: Sunnydale › Hills › Turnout", "beat: Gabriel drives them to a quiet hillside turnout instead of home"],
      ["clock: Day 2 09:50", "at: Sunnydale › House › Living room", "beat: Walter arrives on a motorcycle; Spike throws first"],
    ]);
  test("the day starts at its first message, not last night", () => {
    const beats = todaysBeats(day());
    expect(beats).toHaveLength(4);
    expect(beats[0]!.text).toContain("omelettes");
  });
  test("last night still shows while today has barely begun", () => {
    const st = fold([
      ["clock: Day 1 23:15", "at: Sunnydale › House › Bedroom", "cast: Buffy@spot", "beat: they fall asleep with a lamp on"],
      ["clock: Day 2 05:05", "beat: Gabriel wakes at five"],
    ]);
    expect(todaysBeats(st)).toHaveLength(2);
  });
  test("a folded line breaks where the place does, and never cuts mid-clause", () => {
    const lines = todayLines(day(), (id) => id, 60).map((l) => l.text);
    // The turnout is its own line: never filed under the parking lot.
    expect(lines.some((l) => l.includes("Parking lot") && l.includes("turnout instead"))).toBe(false);
    expect(firstClause("Gabriel wakes at 5am to Buffy seeking friction from his thigh, half asleep, and says her name twice before she stops; then more")).toBe("Gabriel wakes at 5am to Buffy seeking friction from his thigh, half asleep…");
    expect(firstClause("Buffy gives Walter the origin story; Spike protests")).toBe("Buffy gives Walter the origin story");
  });
});

describe("rooms, knowledge and stakes in the note", () => {
  test("a shared room is nobody's room (5.9)", () => {
    const st = fold([["clock: Day 1 12:00", "at: Sunnydale › Winters Residence › kitchen", "cast: Buffy@spot · Dawn@spot", "room Dawn: Sunnydale › Winters Residence › kitchen | room", "room Dawn: Sunnydale › Winters Residence › Dawn's room | room"]]);
    expect(Object.values(st.places).find((p) => p.name === "kitchen")?.owner).toBeUndefined();
    expect(roomLine(st, (id) => id)).toBeNull();
    expect(Object.values(st.places).find((p) => p.name === "Dawn's room")?.owner).toBeTruthy();
  });
  test("a pet neither knows nor fails to know", () => {
    const st = fold([
      ["clock: Day 1 12:00", "cast: Buffy@spot · Ruth@spot · Walter@spot", "trait Ruth: cat, orange, automatic-feeder loyal", "secret #grave: Buffy clawed out of her own grave | kept by Buffy · from Ruth, Walter"],
    ]);
    expect(isAnimal(Object.values(st.chars).find((c) => c.name === "Ruth"))).toBe(true);
    expect(isAnimal(Object.values(st.chars).find((c) => c.name === "Walter"))).toBe(false);
    expect(isAnimal({ name: "Ruth the cat" })).toBe(true);
    expect(isAnimal({ name: "Cat Grant", traits: [{ text: "tall, catlike grace" }] })).toBe(false);
    const text = note(st);
    expect(text).toContain("Walter doesn't know: Buffy clawed out");
    expect(text).not.toContain("Ruth doesn't know");
  });
  test("a deadline that passed half a day ago is history", () => {
    const st = fold([["clock: Day 1 12:00", "cast: Buffy@spot", "deadline the suit: Day 1 13:00", "deadline the pickup: Day 2 15:00"], ["clock: Day 2 14:00"]]);
    const text = note(st);
    expect(text).toContain("Deadline: the pickup");
    expect(text).not.toContain("the suit");
  });
  test("what's under someone's clothes prints in an intimate scene only", () => {
    const lines = ["clock: Day 1 12:00", "cast: Buffy@spot · Walter@spot", "trait Walter: brown eyes; twelve inches soft, thick"];
    expect(note(fold([[...lines, "mode: social"]]))).not.toContain("twelve inches");
    expect(note(fold([[...lines, "mode: social"]]))).toContain("brown eyes");
    expect(note(fold([[...lines, "mode: intimacy"]]))).toContain("twelve inches");
  });
});

describe("corrections (5.7)", () => {
  const st = () =>
    fold([
      ["cast: Buffy@spot · Gabriel@spot · Eleanor@peri", "know Buffy: Gabriel did ballet | he said so · knows · true", "know Buffy: Maria the nanny died of a heart attack while Gabriel was at practice | he told her · knows · true"],
    ]);
  test("a fact that only shares a word with the sentence corrects nothing", () => {
    const found = findOutdated(st(), [{ where: "lore", text: "Gabriel never liked talking about his exams — not to Amaya, not to his parents, not to anyone — and nobody knows why he quit ballet that winter." }]);
    expect(found.filter((f) => f.kind === "knowledge")).toHaveLength(0);
  });
  test("the fact the sentence is about still corrects it", () => {
    const found = findOutdated(st(), [{ where: "lore", text: "Nobody knows that Maria the nanny died of a heart attack while Gabriel was at practice." }]);
    expect(found[0]?.now).toContain("Buffy knows now");
  });
});

const DEFAULTS = { scanDepth: 4, tokenBudget: 1000, recursive: true, maxRecursion: 3, caseSensitive: false, matchWholeWords: true };

describe("lore that is only its title (5.8)", () => {
  let k = 0;
  const entry = (o: Partial<ScanEntry>): ScanEntry => ({ ...defaultEntry({ keys: ["parking lot"], ...o }), id: `t${k++}`, bookId: "b", bookName: "Book", book: {} }) as ScanEntry;
  const run = (entries: ScanEntry[], history: string[]) => activateLore({ entries, history, messageCount: history.length, state: {}, defaults: DEFAULTS, countTokens: (x: string) => x.length, random: () => 0.5 } as ActivationInput);
  test("it isn't sent", () => {
    const bare = entry({ comment: "Parking Lot", content: "Parking Lot" });
    const real = entry({ comment: "Mall", content: "The mall has a parking lot the size of a lake." });
    const r = run([bare, real], ["They cross the parking lot."]);
    expect(r.activated.map((a) => a.entry.id)).toEqual([real.id]);
  });
  test("essentials that are only the name fall back to the entry's first sentences", () => {
    const e = entry({ comment: "Winters Residence kitchen", content: "The kitchen holds the ballet album. The fridge is the league's scoreboard. More.", extra: { entity: "Winters Residence kitchen", essentials: "Winters Residence kitchen" } });
    expect(essentialsOf(e)).toBe("The kitchen holds the ballet album. The fridge is the league's scoreboard.");
    expect(essentialsOf(entry({ comment: "Ruth", content: "Long.", extra: { essentials: "Gabriel's orange cat, named for a justice." } }))).toBe("Gabriel's orange cat, named for a justice.");
  });
});

describe("where things stand (5.5), and takes that weren't kept (5.10)", () => {
  const reply = (id: string, text = "…") => addMessage(id, "assistant", text, { name: "Buffy" });
  const lines = (id: string, messageId: string, swipeIdx: number, ...ls: string[]) => writeEvents(id, { messageId, swipeIdx }, linesToOps(ls).ops, "model");
  const state = (id: string) => currentFold(id).result.state;

  test("a plan for a day that has gone by is no longer open, and a promise outranks an errand", () => {
    const id = createChat({ characterId: charId }).id;
    lines(id, reply(id), 0, "clock: 2001-10-14 10:00", "cast: Buffy@spot · Gabe@spot", "plan write the house constitution: 2001-10-14 15:00 | who: Buffy", "promise Buffy>Gabe: write the house constitution today | open", "promise Gabe>Buffy: take her to the beach before the month is out | open");
    for (let i = 0; i < 4; i++) lines(id, reply(id), 0, `thread errand ${i}: new — pick up the dry cleaning number ${i}`);
    expect(standing(id, state(id)).stands).toMatch(/^Open: .*constitution/m);
    lines(id, reply(id), 0, "clock: 2001-10-15 14:00");
    const { stands } = standing(id, state(id));
    expect(stands.match(/^Open: .*$/m)?.[0] ?? "").not.toContain("constitution");
    expect(stands).toMatch(/^Their day went by.*constitution/m);
    expect(stands.match(/^Open: .*$/m)![0]).toContain("beach");
  });

  test("a rejected take's ledger lines are in no reader of the state", () => {
    const id = createChat({ characterId: charId }).id;
    lines(id, reply(id), 0, "clock: Day 1 12:00", "cast: Buffy@spot · Walter@spot · Dawn@left", "know Dawn: Buffy is alive | she saw her · knows · true");
    const m = reply(id, "Take one.");
    lines(id, m, 0, "know Walter: Dawn doesn't know Buffy is alive yet | Buffy said · believes · true", "promise Buffy>Walter: tell Dawn today | open", "thread telling Dawn: new — the cover story for Spike", "beat: Buffy plans to tell Dawn today", "secret #cover: Spike is a friend from the coffee place | kept by Buffy · from Dawn");
    expect(standing(id, state(id)).stands).toContain("tell Dawn today");
    // A new take is written and kept; the old one's lines stay in the table.
    addSwipe(m, "done");
    setActiveSwipe(m, 1);
    lines(id, m, 1, "beat: Walter loses at darts");
    const st = state(id);
    const all = [buildNote(st, { userName: "Gabriel", seq: 9 })?.text ?? "", standing(id, st).stands, standing(id, st).happened, todayLines(st, (x) => x).map((l) => l.text).join("\n"), longThreads(id, st).map((t) => t.text).join("\n"), JSON.stringify(st.facts), JSON.stringify(st.threads), JSON.stringify(st.loops ?? {})].join("\n");
    expect(all).not.toContain("tell Dawn today");
    expect(all).not.toContain("cover story");
    expect(all).not.toContain("coffee place");
    expect(all).not.toContain("doesn't know Buffy is alive");
    expect(all).toContain("Walter loses at darts");
  });

  test("a memory of something still broken says so once a closed loop fixed it", () => {
    const id = createChat({ characterId: charId }).id;
    lines(id, reply(id), 0, "clock: Day 1 12:00", "cast: Buffy@spot · Gabe@spot", "promise Gabe>Buffy: fix the dripping kitchen faucet at Revello | open");
    const m = reply(id, "He tightens the last nut. The faucet stops dripping.");
    lines(id, m, 0, "promise Gabe>Buffy: fix the dripping kitchen faucet at Revello | kept");
    const st = state(id);
    const done = doneRecords(id, st);
    const lens = { ...PLAIN, done, match: doneMatcher(st, done) };
    const mem = (content: string, type = "fact") => memoryText({ content, type, max_seq: 2 } as Parameters<typeof memoryText>[0], lens);
    expect(mem("The kitchen faucet at Revello still drips; nobody has fixed it.")).toContain("since then: Promise kept: fix the dripping kitchen faucet");
    expect(mem("Joyce bought the kitchen faucet at Revello in 1997.")).toBe("Joyce bought the kitchen faucet at Revello in 1997.");
  });
});
