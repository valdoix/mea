import { describe, expect, test } from "bun:test";
import { calendarHint, describeWhen, noteTime, spanLabel } from "../src/trackers/calendars";
import { formatStoryTime, parseDuration, parseStoryTime } from "../src/trackers/clock";
import { parseLine } from "../src/trackers/dsl";
import { foldEvents, type TrackerEvent } from "../src/trackers/fold";
import { buildNote, hudLine } from "../src/trackers/note";
import { stateForModel } from "../src/trackers/prompts";
import { STARTER_TEMPLATES } from "../src/trackers/schema";

const at = (s: string) => parseStoryTime(s)!;

describe("story calendars", () => {
  test("Westeros dates parse in prose and in ledger form, to the same moment", () => {
    const iso = at("0299-10-14 21:40");
    expect(at("the 14th day of the 10th moon of 299 AC 21:40")).toEqual(iso);
    expect(at("14th day of the 10th moon, 299 AC, 21:40")).toEqual(iso);
    expect(at("299 AC, 10th moon, day 14 21:40")).toEqual(iso);
    expect(formatStoryTime(iso)).toBe("0299-10-14 21:40");
    expect(parseStoryTime("2026-13-01")).toBeNull();
  });

  test("Gregorian reads with weekday and month; Westeros with moons, AC and its night hours", () => {
    const g = describeWhen(at("2026-10-13 23:10"), "gregorian");
    expect(g.label).toBe("Tuesday, 13 October 2026 · 23:10");
    expect(g.short).toBe("Tue 23:10");
    expect(g.season).toBe("autumn");
    expect(g.hour).toBeCloseTo(23.17, 1);

    const w = describeWhen(at("0299-10-14 04:10"), "westeros", "a long summer, its ninth year");
    expect(w.label).toBe("The 14th day of the 10th moon, 299 AC · 04:10");
    expect(w.period).toBe("the hour of the wolf");
    expect(w.weekday).toBeNull();
    expect(w.season).toBe("a long summer, its ninth year");
    expect(describeWhen(at("0299-10-14 19:30"), "westeros").period).toBe("the hour of the bat");

    expect(describeWhen(at("Day 3 21:40"), "westeros").label).toBe("Day 3 · 21:40");
  });

  test("clock chips shorten within a day and name both ends across days", () => {
    expect(spanLabel(at("2026-10-13 21:40"), at("2026-10-13 23:10"), "gregorian")).toBe("21:40 → 23:10");
    expect(spanLabel(at("0299-10-14 23:00"), at("0299-10-15 06:00"), "westeros")).toBe("10th moon, 14th · 23:00 → 10th moon, 15th · 06:00");
  });

  test("the note, the HUD and the tracker model speak the chat's calendar", () => {
    const ev: TrackerEvent[] = [{ id: "e1", messageId: "m1", seq: 1, source: "model", op: parseLine("clock: 0299-10-14 23:10")! }];
    const st = foldEvents(ev, { userName: "Arya", mainName: "Jon", sealedPersona: true, romance: "slow", strictness: "lenient", limits: true, templates: STARTER_TEMPLATES }).state;
    const note = buildNote(st, { userName: "Arya", seq: 1, calendar: "westeros", season: "winter is coming" }).text;
    expect(note).toContain("NOW: 14th of the 10th moon, 299 AC, 23:10 (the hour of the owl); season: winter is coming");
    expect(note).not.toContain("Sat");
    expect(hudLine(st, [], "westeros")).toContain("10th moon, 14th · 23:10");
    expect(stateForModel(st, { userName: "Arya", templates: [], sealed: true, calendar: "westeros" })).toContain(calendarHint("westeros"));
    expect(noteTime(st.time!, "gregorian")).toBe("");
    expect(buildNote(st, { userName: "Arya", seq: 1 }).text).toContain("NOW: Sat 23:10 (night)");
  });

  test("a private thought becomes its own change, for the drawer under the reply", () => {
    const lines = ["cast: Jon@spot", "think Jon: She shouldn't have come back.", "mask Jon: shown: calm; felt: afraid for her"];
    const ev: TrackerEvent[] = lines.map((l, i) => ({ id: `t${i}`, messageId: "m1", seq: 1, source: "model", op: parseLine(l)! }));
    const r = foldEvents(ev, { userName: "Arya", mainName: "Jon", sealedPersona: true, romance: "slow", strictness: "lenient", limits: true, templates: [] });
    const kinds = (r.changes.m1 ?? []).map((c) => c.kind);
    expect(kinds).toContain("thought");
    expect(kinds).toContain("mask");
    expect(r.changes.m1!.find((c) => c.kind === "thought")!.to).toBe("She shouldn't have come back.");
  });

  test("a skip in parts moves the clock: +1h30m, with or without a date after it", () => {
    expect(parseLine("clock: +1h30m | 1996-05-24 15:48")!.args.plus).toBe(90);
    expect(parseLine("clock: +1h 30m")!.args.plus).toBe(90);
    expect(parseLine("clock: +2 hours 15 minutes")!.args.plus).toBe(135);
    expect(parseLine("clock: +1 day, 4 hours")!.args.plus).toBe(1680);
    expect(parseLine("clock: +45m")!.args.plus).toBe(45);
    expect(parseLine("clock: +1.5h")!.args.plus).toBe(90);
    expect(parseDuration("an hour and a half")).toBe(90);
    expect(parseDuration("1h30m")).toBe(90);
    expect(parseDuration("3 days")).toBe(4320);
    const ev: TrackerEvent[] = ["clock: 1996-05-24 14:18", "clock: +1h30m | 1996-05-24 15:48"].map((l, i) => ({ id: `c${i}`, messageId: `m${i}`, seq: i + 1, source: "model", op: parseLine(l)! }));
    const st = foldEvents(ev, { userName: "James", mainName: "Jackie", sealedPersona: true, romance: "slow", strictness: "lenient", limits: true, templates: [] }).state;
    expect(formatStoryTime(st.time!)).toBe("1996-05-24 15:48");
    // A line saved before this fix kept the skip as an unread "set": the fold reads it again.
    const old: TrackerEvent[] = [ev[0]!, { id: "c9", messageId: "m9", seq: 2, source: "model", op: { op: "clock", args: { flashback: false, set: "+1h30m | 1996-05-24 15:48" }, raw: "clock: +1h30m | 1996-05-24 15:48" } }];
    expect(formatStoryTime(foldEvents(old, { userName: "James", mainName: "Jackie", sealedPersona: true, romance: "slow", strictness: "lenient", limits: true, templates: [] }).state.time!)).toBe("1996-05-24 15:48");
  });
});
