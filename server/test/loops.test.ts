import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { actOnInbox, inboxItems } from "../src/accuracy/inbox";
import { applyBackfill, backfillLoops, loopCandidates } from "../src/accuracy/loopinbox";
import { normalizeCard } from "../src/cards/card";
import { newId, now, run } from "../src/db/db";
import { applySceneLoops, loopBlock } from "../src/memory/loops";
import { doneMatcher, doneRecords, lensOf, summaryText } from "../src/memory/openlist";
import { ledger, memState, setMemState } from "../src/memory/store";
import { createCharacter } from "../src/services/characters";
import { addMessage, createChat } from "../src/services/chats";
import { createConnection, createProfile, syncModels } from "../src/services/connections";
import { pauseJobs, registerJob } from "../src/services/jobs";
import { pendingDone } from "../src/steer/plancheck";
import { parseLine } from "../src/trackers/dsl";
import { closingOps, doneLoops, loopId, openLoops, quoted } from "../src/trackers/loops";
import { stateForModel } from "../src/trackers/prompts";
import { currentFold, foldAt, linesToOps, writeEvents } from "../src/trackers/store";
import { freshDb } from "./helpers";

/** docs/22 Part 1: one record of what's open, closed once, by id. */
const WORD = "say the word tonight, after Dawn's dinner, no takebacks";
let chatId = "";
let charId = "";
const state = () => currentFold(chatId).result.state;
const chat = () => createChat({ characterId: charId }).id;
const lines = (id: string, messageId: string, ...ls: string[]) => writeEvents(id, { messageId, swipeIdx: 0 }, linesToOps(ls).ops, "model", { replace: ["model"] });
const reply = (id: string, text: string) => addMessage(id, "assistant", text, { name: "Buffy" });
const loopOf = (what: string) => state().loops[loopId(what)]!;

beforeAll(async () => {
  freshDb();
  pauseJobs(true);
  for (const kind of ["memory.segment", "memory.build", "memory.embed", "memory.journal", "accuracy.check", "tracker.update", "lessons.learn", "offpage.reword", "loops.backfill"]) registerJob(kind, async () => {});
  const connId = createConnection({ name: "Mock", kind: "mock", billing: "subscription" });
  await syncModels(connId);
  createProfile({ name: "Story", connectionId: connId, modelId: "mock/storyteller", params: { context_target: 12000, max_tokens: 300 } });
  const { data } = normalizeCard({ spec: "chara_card_v2", data: { name: "Buffy", first_mes: "Hi." } });
  charId = createCharacter(data);
  chatId = chat();
  const first = reply(chatId, "Tonight, she says.");
  lines(chatId, first, "clock: Day 1 12:00", "cast: Buffy@spot · Gabe@spot", `promise Buffy>Gabe: ${WORD} | open`, "promise Buffy>Gabe: tacos every Friday | open", "plan grocery run: Day 2 10:00 | who: Buffy");
});
afterAll(() => pauseJobs(false));

describe("the ledger line", () => {
  test("closing and opening read back", () => {
    expect(parseLine("loop L1a2b3: done — I love you")).toMatchObject({ op: "loop", subject: "L1a2b3", args: { action: "done", how: "I love you" } });
    expect(parseLine("loop L1a2b3: dropped — they called it off")).toMatchObject({ args: { action: "dropped", how: "they called it off" } });
    expect(parseLine("loop: buy the groceries | errand [due tomorrow]")).toMatchObject({ args: { action: "new", what: "buy the groceries", kind: "errand", due: "tomorrow" } });
  });
});

describe("a loop's life", () => {
  test("a promise and a plan are loops, and an id comes from the words, not the order", () => {
    expect(openLoops(state()).map((l) => l.kind)).toEqual(["promise", "promise", "plan"]);
    expect(loopOf(WORD)).toMatchObject({ what: WORD, kind: "promise", status: "open", opened: expect.any(Number) });
    expect(loopId("Say the word tonight!")).toBe(loopId("say the word  tonight"));
  });

  test("the state the tracker reads lists them by id", () => {
    const text = stateForModel(state(), { userName: "Gabe", templates: [], sealed: true });
    expect(text).toContain(`loop ${loopId(WORD)}: ${WORD}`);
    expect(text).toContain("(repeats)");
  });

  test("saying it again isn't a second loop", () => {
    const id = chat();
    const m = reply(id, "Again.");
    lines(id, m, `promise Buffy>Gabe: ${WORD} | open`, `loop: ${WORD}, as she said | promise`);
    expect(openLoops(currentFold(id).result.state)).toHaveLength(1);
  });

  test("closing it keeps the promise, at the message it happened, and warms the bond once", () => {
    const id = chat();
    const a = reply(id, "Tonight.");
    lines(id, a, "cast: Buffy@spot · Gabe@spot", `promise Buffy>Gabe: ${WORD} | open`);
    const said = reply(id, "I love you.");
    const later = reply(id, "Later.");
    const trust = () => currentFold(id).result.state.bonds[Object.keys(currentFold(id).result.state.bonds).find((k) => k.endsWith(">buffy") || k.includes(">buffy"))!]?.axes.trust ?? 0;
    lines(id, said, `loop ${loopId(WORD)}: done — I love you`);
    const st = currentFold(id).result.state;
    const l = st.loops[loopId(WORD)]!;
    const o = Object.values(st.obligations)[0]!;
    const seq = l.closed!;
    expect(l).toMatchObject({ status: "done", how: "I love you" });
    expect(o).toMatchObject({ status: "kept", settled: seq });
    const warmed = trust();
    expect(warmed).toBeGreaterThan(0);
    // You marking it kept later changes nothing: it was kept when it happened.
    lines(id, later, `promise Buffy>Gabe: ${WORD} | kept`);
    expect(currentFold(id).result.state.obligations[o.id]).toMatchObject({ status: "kept", settled: seq });
    expect(trust()).toBe(warmed);
  });

  test("a promise marked kept closes its loop, and open again reopens it", () => {
    const id = chat();
    const a = reply(id, "Soon.");
    lines(id, a, "cast: Buffy@spot · Gabe@spot", "promise Buffy>Gabe: fix the faucet | open");
    const b = reply(id, "Fixed.");
    lines(id, b, "promise Buffy>Gabe: fix the faucet | kept");
    expect(doneLoops(currentFold(id).result.state)).toHaveLength(1);
    const c = reply(id, "It drips.");
    lines(id, c, `loop ${loopId("fix the faucet")}: open — it drips again`);
    const st = currentFold(id).result.state;
    expect(openLoops(st)).toHaveLength(1);
    expect(Object.values(st.obligations)[0]!.status).toBe("open");
  });

  test("one that repeats stays open and notes the instance", () => {
    const id = chat();
    const a = reply(id, "Friday.");
    lines(id, a, "cast: Buffy@spot · Gabe@spot", "promise Buffy>Gabe: tacos every Friday | open");
    const b = reply(id, "Tacos.");
    lines(id, b, `loop ${loopId("tacos every Friday")}: done — tacos`);
    const l = currentFold(id).result.state.loops[loopId("tacos every Friday")]!;
    expect(l.status).toBe("open");
    expect(l.last).toEqual(expect.any(Number));
    expect(Object.values(currentFold(id).result.state.obligations)[0]!.status).toBe("open");
  });

  test("a plan comes off the calendar", () => {
    const id = chat();
    const a = reply(id, "Tomorrow.");
    lines(id, a, "clock: Day 1 12:00", "plan grocery run: Day 2 10:00");
    const b = reply(id, "Bought.");
    lines(id, b, `loop ${loopId("grocery run")}: done — bought`);
    expect(Object.values(currentFold(id).result.state.calendar)[0]!.done).toBe(true);
  });

  test("an id nothing has opened is rejected", () => {
    const id = chat();
    const a = reply(id, "Hm.");
    lines(id, a, "loop Lfffff: done — nothing");
    expect(Object.values(currentFold(id).result.verdicts).some((v) => !v.ok && /no such loop/.test(v.reason ?? ""))).toBe(true);
  });

  test("a closure follows the branch: swipe it away and the loop is open again", () => {
    const id = chat();
    const a = reply(id, "Tonight.");
    lines(id, a, `promise Buffy>Gabe: ${WORD} | open`);
    const said = reply(id, "I love you.");
    lines(id, said, `loop ${loopId(WORD)}: done — I love you`);
    expect(openLoops(currentFold(id).result.state)).toHaveLength(0);
    run("UPDATE messages SET deleted_at = ? WHERE id = ?", now(), said);
    expect(openLoops(foldAt(id, { excludeMessageId: said }).state)).toHaveLength(1);
  });
});

describe("what closes a loop has to be there", () => {
  test("quotes are found whatever the marks", () => {
    expect(quoted("“I love you,” she says.", "I love you")).toBe(true);
    expect(quoted("He said *I love* — you.", '"i love you"')).toBe(true);
    expect(quoted("He said he likes her.", "I love you")).toBe(false);
    expect(quoted("Anything goes here.", "no")).toBe(false);
    expect(quoted("She said **I love you**.", "i love you")).toBe(true);
    expect(quoted("Anything.", "")).toBe(false);
  });

  test("the tracker's closing line needs its words in the new messages", () => {
    const ops = linesToOps(["loop L1a2b3: done — I love you", "loop L4c5d6: done — never said", "clock: +2m"]).ops;
    expect(closingOps(ops, "[#5] Buffy: I love you.").map((o) => o.raw)).toEqual(["loop L1a2b3: done — I love you", "clock: +2m"]);
  });
});

describe("scenes close loops by id", () => {
  let id = "";
  const rows = () => ledger(id, 0);
  const seqOf = (text: string) => rows().find((r) => r.content === text)!.seq;

  beforeAll(() => {
    id = chat();
    lines(id, reply(id, "Tonight."), `promise Buffy>Gabe: ${WORD} | open`);
    reply(id, "\"I love you,\" she says.");
    reply(id, "They eat.");
  });

  test("a scene sees the loops open in it", () => {
    expect(loopBlock(id, seqOf("They eat."), seqOf("They eat."))).toContain(loopId(WORD));
    expect(loopBlock(id, 0, 0)).toBe("");
  });

  test("a closure lands on the message that shows it, even if the scene named the wrong one", () => {
    const seq = seqOf("\"I love you,\" she says.");
    applySceneLoops(id, 1, 99, { loopsClosed: [{ id: loopId(WORD), seq: seqOf("They eat."), quote: "I love you" }], loopsOpened: [{ what: "buy the groceries", kind: "errand", seq }] }, rows());
    const st = currentFold(id).result.state;
    expect(st.loops[loopId(WORD)]).toMatchObject({ status: "done", closed: seq });
    expect(st.loops[loopId("buy the groceries")]).toMatchObject({ status: "open", kind: "errand", opened: seq });
  });

  test("a tracker reading the reply again leaves it", () => {
    const said = rows().find((r) => r.seq === seqOf("\"I love you,\" she says."))!;
    lines(id, said.id, "clock: +2m");
    expect(currentFold(id).result.state.loops[loopId(WORD)]!.status).toBe("done");
  });

  test("a rebuild says all of it again: what it no longer says goes", () => {
    applySceneLoops(id, 1, 99, { loopsClosed: [], loopsOpened: [] }, rows());
    const st = currentFold(id).result.state;
    expect(st.loops[loopId(WORD)]!.status).toBe("open");
    expect(st.loops[loopId("buy the groceries")]).toBeUndefined();
  });

  test("a closure with no such line, or for a loop that isn't open, is left out", () => {
    applySceneLoops(id, 1, 99, { loopsClosed: [{ id: loopId(WORD), seq: 2, quote: "she never said this" }, { id: "Lfffff", seq: 2, quote: "They eat" }], loopsOpened: [] }, rows());
    expect(currentFold(id).result.state.loops[loopId(WORD)]!.status).toBe("open");
    expect(Object.values(currentFold(id).result.verdicts).filter((v) => /loop/.test(v.reason ?? ""))).toHaveLength(0);
  });
});

describe("old chats", () => {
  let id = "";
  const CLOSED = "Buffy's promise to say 'I love you' tonight, face to face, eyes open, no takebacks — fulfilled";
  const OPEN = "Buffy's promised 'I love you' — 'the whole word. No takebacks' — still unsaid, due tonight after Dawn sleeps";
  const add = (level: string, start: number, end: number, data: Record<string, unknown>) =>
    run("INSERT INTO summaries (id, chat_id, level, start_seq, end_seq, closed, title, content, data, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, 't', ?, ?, 'ready', ?, ?)", newId(), id, level, start, end, "Text.", JSON.stringify(data), now(), now());
  const fresh = () => {
    id = chat();
    for (let i = 0; i < 10; i++) reply(id, `Message ${i}.`);
    add("story", 1, 4, { openThreads: [OPEN, "Dawn's answer on the move"] });
    add("scene", 5, 6, { threadsClosed: [CLOSED], threadsOpened: ["The static hums in her head"] });
  };

  test("rules find what's closed and what may still be open", () => {
    fresh();
    const c = loopCandidates(id, currentFold(id).result.state);
    expect(c.closed).toHaveLength(1);
    expect(c.closed[0]).toMatchObject({ what: CLOSED, how: CLOSED, seq: 6, items: [OPEN] });
    expect(c.open.map((o) => o.what)).toEqual(["Dawn's answer on the move", "The static hums in her head"]);
  });

  test("nothing changes until you say so", async () => {
    fresh();
    await backfillLoops(id);
    expect(memState(id).loopBackfill?.state).toBe("review");
    expect(Object.keys(currentFold(id).result.state.loops)).toHaveLength(0);
    const card = inboxItems({ chatId: id }).find((i) => i.kind === "loops")!;
    expect(card.title).toBe("1 thing the story finished");
    expect(card.after).toContain("Done, #6:");
    expect(card.after).toContain("Open: Dawn's answer on the move");
  });

  test("your yes puts them in the ledger, and the old list leaves the summaries", async () => {
    fresh();
    await backfillLoops(id);
    actOnInbox(`loops:${id}`, "accept");
    const st = currentFold(id).result.state;
    expect(memState(id).loopBackfill?.state).toBe("done");
    expect(doneLoops(st).map((l) => l.closed)).toEqual([6]);
    expect(openLoops(st).map((l) => l.what)).toContain("Dawn's answer on the move");
    expect(inboxItems({ chatId: id }).find((i) => i.kind === "loops")).toBeUndefined();
    const text = summaryText({ content: `x\nStill open: ${OPEN}`, level: "story", start_seq: 1, end_seq: 4 }, lensOf(id, st));
    expect(text).toBe("x");
  });

  test("a line you take out stays out; no is no", async () => {
    fresh();
    await backfillLoops(id);
    const card = inboxItems({ chatId: id }).find((i) => i.kind === "loops")!;
    actOnInbox(`loops:${id}`, "accept", card.after.split("\n").filter((l) => !l.includes("static")).join("\n"));
    expect(openLoops(currentFold(id).result.state).map((l) => l.what)).toEqual(["Dawn's answer on the move"]);
    fresh();
    await backfillLoops(id);
    actOnInbox(`loops:${id}`, "reject");
    expect(Object.keys(currentFold(id).result.state.loops)).toHaveLength(0);
    expect(memState(id).loopBackfill?.state).toBe("declined");
    expect(inboxItems({ chatId: id }).find((i) => i.kind === "loops")).toBeUndefined();
  });

  test("a promise that's already a loop closes as itself", async () => {
    id = chat();
    const m = reply(id, "Soon.");
    lines(id, m, "cast: Buffy@spot · Gabe@spot", "promise Buffy>Gabe: help Dawn pick paint at the hardware store | open");
    for (let i = 0; i < 8; i++) reply(id, `Message ${i}.`);
    add("scene", 5, 9, { threadsClosed: ["The hardware store paint trip with Dawn — paint picked, done"] });
    const c = loopCandidates(id, currentFold(id).result.state);
    expect(c.closed[0]?.loop).toBe(loopId("help Dawn pick paint at the hardware store"));
    setMemState(id, { loopBackfill: { state: "review", at: 1, closed: c.closed, open: [] } });
    applyBackfill(id);
    const st = currentFold(id).result.state;
    expect(openLoops(st)).toHaveLength(0);
    expect(Object.values(st.obligations)[0]!.status).toBe("kept");
  });

  test("what a loop already closed isn't a second loop", () => {
    id = chat();
    reply(id, "Soon.");
    const n = reply(id, "Paint.");
    add("scene", 1, 1, { threadsOpened: ["Pick paint at the hardware store with Dawn"] });
    lines(id, n, "cast: Buffy@spot · Gabe@spot", "promise Buffy>Gabe: help Dawn pick paint at the hardware store | open");
    lines(id, reply(id, "Picked."), "promise Buffy>Gabe: help Dawn pick paint at the hardware store | kept");
    const c = loopCandidates(id, currentFold(id).result.state);
    expect(c.closed).toEqual([]);
    expect(c.open).toEqual([]);
  });

  test("an old loop nobody closed can be called over, and only by a yes", async () => {
    id = chat();
    const m = reply(id, "Tomorrow.");
    lines(id, m, "clock: Day 1 12:00", "plan Pick up Dawn: Day 1 13:00");
    const last = reply(id, "Days pass.");
    lines(id, last, "clock: Day 5 12:00");
    const c = loopCandidates(id, currentFold(id).result.state);
    expect(c.over.map((o) => o.what)).toEqual(["Pick up Dawn"]);
    await backfillLoops(id);
    expect(inboxItems({ chatId: id }).find((i) => i.kind === "loops")?.after).toContain("Over: Pick up Dawn");
    expect(openLoops(currentFold(id).result.state)).toHaveLength(1);
    actOnInbox(`loops:${id}`, "accept");
    const st = currentFold(id).result.state;
    expect(openLoops(st)).toHaveLength(0);
    expect(st.loops[loopId("Pick up Dawn")]).toMatchObject({ status: "dropped", how: "over by now" });
  });

  test("a done promise's few words don't close a thread that only shares them", () => {
    id = chat();
    const m = reply(id, "Soon.");
    lines(id, m, "cast: Buffy@spot · Gabe@spot", "promise Buffy>Spike: offer him the hills house | open");
    const n = reply(id, "Done.");
    lines(id, n, "promise Buffy>Spike: offer him the hills house | kept");
    add("scene", 1, 1, { threadsOpened: ["Moving Buffy, Dawn, and Ruth into Gabriel's house in the hills"] });
    const c = loopCandidates(id, currentFold(id).result.state);
    expect(c.closed).toEqual([]);
    expect(c.open.map((o) => o.what)).toEqual(["Moving Buffy, Dawn, and Ruth into Gabriel's house in the hills"]);
  });

  test("once per chat, and no call with nothing to ask", async () => {
    id = chat();
    reply(id, "Hello.");
    await backfillLoops(id);
    expect(memState(id).loopBackfill).toMatchObject({ state: "done", closed: [], open: [] });
    add("scene", 1, 2, { threadsOpened: ["Something new"] });
    await backfillLoops(id);
    expect(memState(id).loopBackfill?.open).toEqual([]);
  });
});

describe("what reads loops", () => {
  test("a wording known to be a loop needs no matching", () => {
    const id = chat();
    const m = reply(id, "Done.");
    writeEvents(id, { messageId: m, swipeIdx: 0 }, [{ op: "loop", args: { action: "new", what: "the words", kind: "promise", from: ["nothing in common here at all"], done: true, how: "said" }, raw: "loop: the words" }], "user");
    const st = currentFold(id).result.state;
    const done = doneRecords(id, st);
    expect(doneMatcher(st, done)("nothing in common here at all", 0)?.text).toBe("the words");
    expect(doneMatcher(st, done)("nothing in common here at all", 99)).toBeNull();
  });

  test("a plan that waits for a done loop is told, with no scene record at all", () => {
    const id = chat();
    const a = reply(id, "Tonight.");
    lines(id, a, `promise Buffy>Gabe: ${WORD} | open`);
    const said = reply(id, "I love you.");
    lines(id, said, `loop ${loopId(WORD)}: done — I love you`);
    const found = pendingDone(id, currentFold(id).result.state, "Tonight still holds her promise: say the word after Dawn's dinner, no takebacks");
    expect(found).toHaveLength(1);
    expect(found[0]!.fact).toBe(WORD);
  });
});
