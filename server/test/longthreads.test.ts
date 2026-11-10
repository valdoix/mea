import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { normalizeCard } from "../src/cards/card";
import { newId, now, run } from "../src/db/db";
import { setSetting, defaultMemoryConfig } from "../src/lib/settings";
import { createCharacter } from "../src/services/characters";
import {
  addMessage,
  addSwipe,
  createChat,
  historyForPrompt,
  updateChat,
  updateSwipe,
} from "../src/services/chats";
import {
  createConnection,
  createProfile,
  syncModels,
} from "../src/services/connections";
import { pauseJobs, registerJob } from "../src/services/jobs";
import { advisorInput, runAdvisor, steerFor } from "../src/steer/advisor";
import { ledgerThreads } from "../src/steer/plancheck";
import { digestNote, rejectedDigest } from "../src/steer/swipes";
import { parseStoryTime } from "../src/trackers/clock";
import {
  dateWindow,
  longIds,
  longThreads,
  longThreadsFor,
  pinLong,
  unpinLong,
  whenOf,
} from "../src/trackers/longthreads";
import { trackerPrompt } from "../src/trackers/service";
import { currentFold, linesToOps, writeEvents } from "../src/trackers/store";
import { freshDb } from "./helpers";

/** docs/33 Part 9: long threads stay in view. */
let charId = "";
const lines = (id: string, messageId: string, ...ls: string[]) =>
  writeEvents(id, { messageId, swipeIdx: 0 }, linesToOps(ls).ops, "model", {
    replace: ["model"],
  });
const at = (s: string) => parseStoryTime(s)!.minutes;

beforeAll(async () => {
  freshDb();
  pauseJobs(true);
  for (const kind of [
    "memory.segment",
    "memory.build",
    "memory.embed",
    "memory.journal",
    "accuracy.check",
    "quota.refresh",
    "cache.probe",
    "tracker.update",
    "lessons.learn",
    "offpage.reword",
    "loops.backfill",
  ])
    registerJob(kind, async () => {});
  const connId = createConnection({
    name: "Mock",
    kind: "mock",
    billing: "subscription",
  });
  await syncModels(connId);
  createProfile({
    name: "Story",
    connectionId: connId,
    modelId: "mock/storyteller",
    params: { context_target: 12000, max_tokens: 300 },
  });
  setSetting("memory.config", { ...defaultMemoryConfig, checkerModel: false });
  const { data } = normalizeCard({
    spec: "chara_card_v2",
    data: { name: "Buffy", description: "The Slayer.", first_mes: "Hi." },
  });
  charId = createCharacter(data);
});
afterAll(() => pauseJobs(false));

describe("the days words point to", () => {
  // Wednesday 10 October 2001, nine in the morning.
  const wed = at("2001-10-10 09:00");

  test("on a calendar clock: tonight, tomorrow, a weekday, this week, next week, a weekend", () => {
    expect(dateWindow("dinner tonight", wed)).toMatchObject({
      from: at("2001-10-10 00:00"),
      to: at("2001-10-10 23:59"),
      text: "tonight",
    });
    expect(dateWindow("the mall tomorrow morning", wed)).toMatchObject({
      from: at("2001-10-11 00:00"),
      text: "tomorrow morning",
    });
    expect(
      dateWindow("the suit comes back out Saturday night", wed),
    ).toMatchObject({
      from: at("2001-10-13 00:00"),
      to: at("2001-10-13 23:59"),
      text: "Saturday night",
    });
    expect(
      dateWindow("cooking lessons, Monday after school", wed),
    ).toMatchObject({
      from: at("2001-10-15 00:00"),
      text: "Monday after school",
    });
    // "Next Thursday" said on a Wednesday isn't tomorrow.
    expect(dateWindow("next Thursday", wed)?.from).toBe(at("2001-10-18 00:00"));
    expect(dateWindow("bring the rings this week", wed)).toMatchObject({
      from: wed,
      to: at("2001-10-14 23:59"),
      text: "this week",
    });
    expect(dateWindow("the parents visit next week", wed)).toMatchObject({
      from: at("2001-10-15 00:00"),
      to: at("2001-10-21 23:59"),
    });
    expect(dateWindow("a picnic this weekend", wed)).toMatchObject({
      from: at("2001-10-13 00:00"),
      to: at("2001-10-14 23:59"),
    });
    expect(dateWindow("back in three days", wed)?.from).toBe(
      at("2001-10-13 00:00"),
    );
  });

  test("a routine has no day, and a day-count clock knows no weekdays", () => {
    expect(dateWindow("tacos every Friday", wed)).toBeNull();
    expect(dateWindow("pack a bento each school day", wed)).toBeNull();
    expect(dateWindow("someday, when she's ready", wed)).toBeNull();
    const d3 = at("Day 3 09:00");
    expect(dateWindow("Saturday night", d3, "day")).toBeNull();
    expect(dateWindow("next week", d3, "day")).toMatchObject({
      from: at("Day 10 00:00"),
    });
  });

  test("a week comes due on its last day, not all week; a passed one asks for two days, then goes", () => {
    const w = dateWindow("this week", wed)!;
    expect(whenOf(w, at("2001-10-11 12:00"))).toBe("soon");
    expect(whenOf(w, at("2001-10-14 10:00"))).toBe("today");
    expect(whenOf(w, at("2001-10-15 10:00"))).toBe("passed");
    expect(whenOf(w, at("2001-10-18 10:00"))).toBeNull();
    expect(whenOf(dateWindow("next week", wed)!, at("2001-10-11 12:00"))).toBe(
      "later",
    );
  });
});

describe("the list", () => {
  let id = "";
  const st = () => currentFold(id).result.state;
  beforeAll(() => {
    id = createChat({ characterId: charId }).id;
    const m = addMessage(id, "assistant", "Wednesday morning.", {
      name: "Buffy",
    });
    lines(
      id,
      m,
      "clock: 2001-10-10 09:00",
      "cast: Buffy@kitchen · Gabe@kitchen · Dawn@school · Willow@away",
      "promise Gabe>Buffy: bring the rings this week | open",
      "loop: Willow must come back and apologize to Gabe | errand",
      "loop: the audit of Joyce's accounts, and the fight it will start | plan",
      "loop: the Willow apology still has to happen | errand",
      "loop: buy more milk | errand",
      "promise Gabe>Dawn: tacos every Friday | open",
      "secret #heaven: she was in heaven, not hell | kept by Buffy · from Dawn, Willow",
    );
  });

  test("a promise with a day, open conflicts and a kept secret; not errands or routines", () => {
    const list = longThreads(id, st());
    const by = (k: string) =>
      list.filter((t) => t.kind === k).map((t) => t.text);
    expect(by("promise")).toEqual(["bring the rings this week"]);
    expect(list.find((t) => t.kind === "promise")).toMatchObject({
      when: "soon",
    });
    // Two lines about Willow's apology are one conflict.
    expect(by("conflict")).toHaveLength(2);
    expect(by("conflict").some((t) => /Willow/.test(t))).toBe(true);
    expect(by("conflict").some((t) => /audit/.test(t))).toBe(true);
    expect(list.find((t) => t.kind === "secret")).toMatchObject({
      text: "she was in heaven, not hell",
      from: ["Dawn", "Willow"],
    });
    expect(list.some((t) => /milk|tacos/.test(t.text))).toBe(false);
  });

  test("a pin stays until you take it off, dated from when you pinned it", () => {
    const after = pinLong(id, "the parents' visit", "next week");
    const pin = after.find((t) => t.kind === "pinned")!;
    expect(pin).toMatchObject({
      text: "the parents' visit",
      due: "next week",
      when: "later",
    });
    expect(longThreadsFor(id).some((t) => t.id === pin.id)).toBe(true);
    expect(unpinLong(id, pin.id).some((t) => t.id === pin.id)).toBe(false);
  });

  test("a plan may name a secret or a pin by its id", () => {
    const list = longThreads(id, st());
    const secret = list.find((t) => t.kind === "secret")!;
    expect(
      ledgerThreads(st(), [secret.id, "S00000", "made up"], longIds(list)),
    ).toEqual(["she was in heaven, not hell"]);
  });

  test("the state block shows the top few", () => {
    const tp = trackerPrompt(id, { kind: "story" });
    expect(tp.note?.text).toContain("LONG THREADS");
    expect(tp.note?.text).toContain("bring the rings this week");
  });
});

describe("on its day, a dated promise is in the plan (the done-when fixture)", () => {
  test("not on Thursday; on Sunday, the last day of the week, it's among the plan's threads", async () => {
    const id = createChat({ characterId: charId }).id;
    updateChat(id, { settings: { planning: "planner" } });
    expect(steerFor(id).planner).toBe(true);
    const a = addMessage(
      id,
      "assistant",
      "Wednesday. He turns the ring box over in his pocket.",
      { name: "Buffy" },
    );
    lines(
      id,
      a,
      "clock: 2001-10-10 09:00",
      "cast: Buffy@kitchen · Gabe@kitchen",
      "promise Gabe>Buffy: bring the rings this week | open",
    );
    addMessage(id, "user", "Morning.");
    const b = addMessage(id, "assistant", "Thursday comes and goes.", {
      name: "Buffy",
    });
    lines(id, b, "clock: 2001-10-11 12:00");
    addMessage(id, "user", "What's for lunch?");
    const thu = await runAdvisor(id);
    expect(thu?.threads ?? []).not.toContain("bring the rings this week");
    const { user } = await advisorInput(
      id,
      historyForPrompt(id),
      undefined,
      steerFor(id),
    );
    expect(user).toContain("LONG THREADS");
    expect(user).toContain(
      "promise, this week, coming up: bring the rings this week",
    );
    // The planner reads the whole list once, not again in the state block.
    expect(user.split("LONG THREADS").length).toBe(2);

    const c = addMessage(id, "assistant", "Sunday, late morning.", {
      name: "Buffy",
    });
    lines(id, c, "clock: 2001-10-14 10:30");
    addMessage(id, "user", "Pancakes?");
    const sun = await runAdvisor(id);
    expect(sun?.threads).toContain("bring the rings this week");
  });
});

describe("a new take hears why the last was passed over (9.3)", () => {
  test("your note with the next take, and what a check found", () => {
    const id = createChat({ characterId: charId }).id;
    const m = addMessage(
      id,
      "assistant",
      "She runs out into the night. The door slams behind her and the street is empty.",
      { name: "Buffy" },
    );
    const one = addSwipe(m, "done");
    updateSwipe(m, one, {
      content:
        "She stays. She pours two cups of tea and sits down across from him at the table.",
      status: "done",
      meta: { passedOver: { note: "too fast, she wouldn't leave" } },
    });
    const t = now();
    run(
      "INSERT INTO continuity_flags (id, chat_id, message_id, swipe_idx, issues, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'open', ?, ?)",
      newId(),
      id,
      m,
      1,
      JSON.stringify([
        {
          id: "1",
          kind: "place",
          severity: "major",
          claim: "sits down across from him at the table",
          conflict: "Gabe is at the hospital",
          citations: [],
          fix: "",
          by: "rules",
        },
      ]),
      t,
      t,
    );
    const takes = rejectedDigest(m);
    expect(takes).toHaveLength(2);
    expect(takes[0]!.why).toEqual([
      "the player said «too fast, she wouldn't leave»",
    ]);
    expect(takes[1]!.why?.[0]).toContain(
      "the check found «sits down across from him at the table» against the record: Gabe is at the hospital",
    );
    const note = digestNote(takes);
    expect(note).toContain(
      "Passed over because the player said «too fast, she wouldn't leave»",
    );
    expect(note).toContain("Whatever made a take wrong stays out of this one.");
  });

  test("with no reason known, the note is as it was", () => {
    const note = digestNote([{ opening: "She waits.", beat: "" }]);
    expect(note).not.toContain("Passed over because");
    expect(note).not.toContain("stays out");
  });
});
