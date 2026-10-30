import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { storyHealth } from "../src/accuracy/health";
import { normalizeCard } from "../src/cards/card";
import { run } from "../src/db/db";
import { createCharacter } from "../src/services/characters";
import { addMessage, createChat } from "../src/services/chats";
import { createConnection, createProfile, syncModels } from "../src/services/connections";
import { undoFiling } from "../src/services/filings";
import { pauseJobs, registerJob } from "../src/services/jobs";
import { closedByNote, fileNoteFacts, readNote } from "../src/steer/notefacts";
import { loopId, pastDue } from "../src/trackers/loops";
import { loopsFor, setLoop, setPromise } from "../src/trackers/promises";
import { currentFold, linesToOps, writeEvents } from "../src/trackers/store";
import { freshDb } from "./helpers";

/** docs/22 Part 5: the panel, a note that closes a loop, and Story health's Open loops. */

let charId = "";
const reply = (id: string, text: string) => addMessage(id, "assistant", text, { name: "Buffy" });
const lines = (id: string, messageId: string, ...ls: string[]) => writeEvents(id, { messageId, swipeIdx: 0 }, linesToOps(ls).ops, "model");
const state = (id: string) => currentFold(id).result.state;
const loop = (id: string, what: string) => state(id).loops[loopId(what)]!;
const GROCERY = "the grocery run";
const JOBS = ["Fix the porch light", "Feed Miss Kitty", "Call Willow back", "Return the library books", "Wash the blue sweater"];

function story() {
  const id = createChat({ characterId: charId }).id;
  const first = reply(id, "Friday, she says.");
  lines(id, first, "clock: Day 1 12:00", "cast: Buffy@spot · Gabe@spot", `loop: ${GROCERY} | errand`);
  return { id, first };
}

beforeAll(async () => {
  freshDb();
  pauseJobs(true);
  for (const kind of ["memory.segment", "memory.build", "memory.embed", "memory.journal", "accuracy.check", "tracker.update", "lessons.learn", "offpage.reword", "loops.backfill"]) registerJob(kind, async () => {});
  const connId = createConnection({ name: "Mock", kind: "mock", billing: "subscription" });
  await syncModels(connId);
  createProfile({ name: "Story", connectionId: connId, modelId: "mock/storyteller", params: { context_target: 12000, max_tokens: 300 } });
  const { data } = normalizeCard({ spec: "chara_card_v2", data: { name: "Buffy", first_mes: "Hi." } });
  charId = createCharacter(data);
});
afterAll(() => pauseJobs(false));

describe("one tap, and it holds", () => {
  test("open first, then what closed, newest first", () => {
    const { id, first } = story();
    lines(id, first, "loop: Spike's answer | question");
    setLoop(id, loopId(GROCERY), "done");
    expect(loopsFor(id).map((l) => [l.what, l.status, l.byHand])).toEqual([["Spike's answer", "open", false], [GROCERY, "done", true]]);
  });

  test("a model can't undo what you closed or called off", () => {
    const { id } = story();
    setLoop(id, loopId(GROCERY), "dropped");
    lines(id, reply(id, "Bought."), `loop ${loopId(GROCERY)}: done — Bought.`);
    expect(loop(id, GROCERY).status).toBe("dropped");
    setLoop(id, loopId(GROCERY), "open");
    setLoop(id, loopId(GROCERY), "done");
    lines(id, reply(id, "Back on."), `loop ${loopId(GROCERY)}: open`);
    expect(loop(id, GROCERY).status).toBe("done");
  });

  test("reopening undoes it, and only what's written later can close it again", () => {
    const { id, first } = story();
    lines(id, first, `loop ${loopId(GROCERY)}: done — Friday, she says.`);
    const late = reply(id, "Hm.");
    setLoop(id, loopId(GROCERY), "open");
    expect(loop(id, GROCERY)).toMatchObject({ status: "open", reopened: 3 });
    lines(id, late, `loop ${loopId(GROCERY)}: done — Hm.`);
    expect(loop(id, GROCERY).status).toBe("open");
    lines(id, reply(id, "Bought, this time."), `loop ${loopId(GROCERY)}: done — Bought, this time.`);
    expect(loop(id, GROCERY).status).toBe("done");
  });

  test("calling off a promise leaves nothing to break, and the bond stays where it was", () => {
    const { id, first } = story();
    lines(id, first, "promise Buffy>Gabe: bring the map [due Day 1 13:00]");
    const l = loop(id, "bring the map");
    setLoop(id, l.id, "dropped");
    lines(id, reply(id, "Later."), "clock: Day 3 12:00");
    const st = state(id);
    expect(Object.values(st.obligations)[0]?.status).toBe("excused");
    expect(Object.values(st.bonds).flatMap((b) => Object.values(b.axes)).filter(Boolean)).toEqual([]);
    setLoop(id, l.id, "open");
    expect(Object.values(state(id).obligations)[0]?.status).toBe("open");
  });

  test("a plan called off comes off the calendar", () => {
    const { id, first } = story();
    lines(id, first, "plan Dinner at the Bronze: tomorrow");
    setLoop(id, Object.values(state(id).loops).find((l) => l.calendar)!.id, "dropped");
    expect(Object.values(state(id).calendar)[0]?.done).toBe(true);
  });

  test("marking a promise kept is closing its loop by hand, and warms the bond once", () => {
    const { id, first } = story();
    lines(id, first, "promise Buffy>Gabe: bring the map");
    const p = Object.keys(state(id).obligations)[0]!;
    setPromise(id, p, "kept");
    const l = loop(id, "bring the map");
    expect(l).toMatchObject({ status: "done", byHand: true, yours: true });
    expect(Object.values(state(id).bonds)[0]?.axes.trust).toBe(1);
  });

  test("what repeats notes the time, and stays open", () => {
    const { id, first } = story();
    lines(id, first, "loop: Tacos every Friday | plan");
    setLoop(id, loopId("Tacos every Friday"), "done");
    expect(loop(id, "Tacos every Friday")).toMatchObject({ status: "open", last: 2 });
  });

  test("a line for a loop that isn't there is refused", () => {
    expect(() => setLoop(story().id, "Lnope", "done")).toThrow("No such loop");
  });
});

describe("a note closes the loop", () => {
  test("it has to say all of a wording, and that it's over", () => {
    const { id, first } = story();
    lines(id, first, "loop: The move to Gabriel's house | plan");
    const st = state(id);
    expect(closedByNote(st, "We already did the grocery run")?.what).toBe(GROCERY);
    expect(closedByNote(st, "We haven't done the grocery run yet")).toBeNull();
    expect(closedByNote(st, "the grocery run was cancelled")).toBeNull();
    expect(closedByNote(st, "she already moved the boxes to the house")).toBeNull();
  });

  test("it closes at the message before the reply, and Undo opens it again", async () => {
    const { id } = story();
    const replyId = reply(id, "Then groceries.");
    const [f] = await fileNoteFacts(id, replyId, "We already did the grocery run");
    expect(f).toMatchObject({ kind: "note-loop", label: `Saved: Done: ${GROCERY}` });
    expect(loop(id, GROCERY)).toMatchObject({ status: "done", closed: 2, byHand: true, how: "your note: We already did the grocery run" });
    undoFiling(f!.id);
    expect(loop(id, GROCERY).status).toBe("open");
    expect(await fileNoteFacts(id, replyId, "We already did the grocery run")).toEqual([]);
  });

  test("the helper knows it in other words, and what it doesn't close stands", async () => {
    const { id, first } = story();
    lines(id, first, "cast: Gabe@spot");
    expect(readNote(state(id), "Buffy already said I love you").over).toEqual(["Buffy already said I love you"]);
    const [f] = await fileNoteFacts(id, reply(id, "Tonight."), "Buffy already said I love you");
    expect(f?.kind).toBe("note-loop");
    expect(loop(id, GROCERY).status).toBe("done");

    const quiet = story();
    const [t] = await fileNoteFacts(quiet.id, reply(quiet.id, "Tonight."), "Buffy already bought the socks");
    expect(t).toMatchObject({ kind: "note-truth", label: "Saved: Buffy already bought the socks" });
    expect(loop(quiet.id, GROCERY).status).toBe("open");
  });
});

describe("Story health: Open loops", () => {
  const part = (id: string) => storyHealth(id).parts.find((p) => p.part === "loops");
  const replies = (id: string) => {
    for (let i = 0; i < 3; i++) reply(id, "On.");
  };

  test("a chat with no loops has nothing to say", () => {
    const id = createChat({ characterId: charId }).id;
    replies(id);
    expect(part(id)).toBeUndefined();
  });

  test("what's past due is the worst, and it opens the panel", () => {
    const { id, first } = story();
    lines(id, first, "loop: Pick up Dawn | errand [due Day 1 13:00]");
    replies(id);
    lines(id, reply(id, "Days later."), "clock: Day 3 12:00");
    expect(pastDue(state(id)).map((l) => l.what)).toEqual(["Pick up Dawn"]);
    expect(part(id)).toMatchObject({ detail: "1 open loop past due, oldest: Pick up Dawn", open: { dock: "story", section: "loops" } });
  });

  test("closes by hand count, and a card you approved doesn't", () => {
    const { id, first } = story();
    for (const w of JOBS) lines(id, first, `loop: ${w} | errand`);
    replies(id);
    for (const w of JOBS.slice(0, 3)) setLoop(id, loopId(w), "done");
    writeEvents(id, { messageId: first, swipeIdx: -1 }, linesToOps(JOBS.slice(3).map((w) => `loop ${loopId(w)}: done — by the card`)).ops, "user");
    const p = part(id)!;
    expect([p.detail, ...p.notes!].join("\n")).toContain("3 of the last 5 closes by hand");
    expect(p.score).toBeLessThan(100);
  });

  test("the plans sent back and the stale lines are counted, from what's kept", () => {
    const { id } = story();
    replies(id);
    const last = reply(id, "On.");
    run("INSERT INTO generations (id, chat_id, message_id, kind, task, status, started_at, trace) VALUES ('g1', ?, ?, 'story', 'story', 'done', ?, ?)", id, last, Date.now(), JSON.stringify({ outdated: [{ kind: "done", where: "card", sentence: "x", now: "y", seq: 1, ref: "r" }, { kind: "time", where: "card", sentence: "x", now: "y", seq: 1, ref: "r" }] }));
    run("INSERT INTO generations (id, chat_id, kind, task, status, started_at) VALUES ('g2', ?, 'planner:replan', 'planner', 'done', ?)", id, Date.now());
    const p = part(id)!;
    expect([p.detail, ...p.notes!].join("\n")).toContain("1 stale line caught (card), 1 plan sent back");
  });
});
