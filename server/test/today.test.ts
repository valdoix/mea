import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { normalizeCard } from "../src/cards/card";
import { TimeIndex } from "../src/memory/format";
import { createCharacter } from "../src/services/characters";
import { addMessage, createChat, historyForPrompt } from "../src/services/chats";
import { pauseJobs, registerJob } from "../src/services/jobs";
import { advisorInput, steerFor } from "../src/steer/advisor";
import { parseLine } from "../src/trackers/dsl";
import { beatNames, missingBeats, todayLines, todayText } from "../src/trackers/today";
import { currentFold, linesToOps, writeEvents } from "../src/trackers/store";
import { freshDb } from "./helpers";

/** docs/20 Part 1: the day in order. */

let chatId = "";
const seqOf = new Map<string, number>();

function say(role: "user" | "assistant", text: string, lines: string[] = []) {
  const id = addMessage(chatId, role, text, role === "assistant" ? { name: "Buffy" } : {});
  if (lines.length) writeEvents(chatId, { messageId: id, swipeIdx: 0 }, linesToOps(lines).ops, "model");
  seqOf.set(text, historyForPrompt(chatId).at(-1)!.seq!);
  return id;
}
const state = () => currentFold(chatId).result.state;
const names = () => beatNames(chatId, state());

beforeAll(() => {
  freshDb();
  pauseJobs(true);
  for (const kind of ["memory.segment", "memory.build", "memory.embed", "accuracy.check", "tracker.update", "tracker.beats", "offpage.reword", "lessons.learn"]) registerJob(kind, async () => {});
  const { data } = normalizeCard({ spec: "chara_card_v2", data: { name: "Buffy", first_mes: "Revello Drive." } });
  chatId = createChat({ characterId: createCharacter(data) }).id;
  const first = addMessage(chatId, "assistant", "Revello Drive.", { name: "Buffy" });
  writeEvents(chatId, { messageId: first, swipeIdx: -1 }, linesToOps(["clock: 2001-10-10 16:00", "at: Sunnydale › Revello Drive › kitchen", "cast: Buffy@spot"]).ops, "model");
});
afterAll(() => pauseJobs(false));

describe("beats (docs/20 1.1)", () => {
  test("the beat line reads whole: a cause dash or a name with a colon stays in it", () => {
    expect(parseLine("beat: Gabriel asks about Spike — she says no")).toMatchObject({ op: "beat", args: { text: "Gabriel asks about Spike — she says no" } });
    expect(parseLine("beat Gabriel: asks about Spike")?.args.text).toBe("Gabriel asks about Spike");
    expect(parseLine("happened: they drive home")?.op).toBe("beat");
  });

  test("a beat takes the time, place and people its reply ends with, whatever order the lines came in", () => {
    say("assistant", "Yesterday afternoon.", ["beat: Buffy waters the plants"]);
    say("assistant", "The car.", ["beat: Gabriel asks Buffy about Spike; she says no", "clock: 2001-10-11 13:10", "at: Sunnydale › Gabriel's car", "cast: Buffy@spot · You@spot"]);
    const b = state().beats.at(-1)!;
    expect(b.seq).toBe(seqOf.get("The car.")!);
    expect(b.place).toEqual(["Sunnydale", "Gabriel's car"]);
    expect(b.minutes! % 1440).toBe(13 * 60 + 10);
    expect(b.who.map(names())).toEqual(expect.arrayContaining(["Buffy"]));
  });

  test("a second beat line for the same reply adds to its beat", () => {
    say("assistant", "The faucet.", ["clock: +20m", "at: Sunnydale › Revello Drive › kitchen", "beat: Gabriel fixes the faucet", "beat: Buffy watches"]);
    expect(state().beats.at(-1)!.text).toBe("Gabriel fixes the faucet; Buffy watches");
  });
});

describe("TODAY SO FAR (docs/20 1.2)", () => {
  test("today's beats in order, each with its time, and its place when the place changes", () => {
    const lines = todayLines(state(), names());
    // Yesterday afternoon is more than 18 hours back and on another day: not today.
    expect(lines.map((l) => l.text).join("\n")).not.toContain("plants");
    expect(lines[0]!.text).toStartWith("13:10 · Sunnydale › Gabriel's car");
    expect(lines[0]!.text).toContain(`(#${seqOf.get("The car.")}): Gabriel asks Buffy about Spike`);
    expect(lines[1]!.text).toStartWith("13:30 · Revello Drive › kitchen");
    expect(lines.map((l) => l.ref)).toEqual(["B1", "B2"]);
    expect(todayText(state(), names())).toContain("retell it as it happened here");
  });

  test("over budget, the oldest hour folds into one line instead of being lost", () => {
    for (let i = 0; i < 6; i++) say("assistant", `Kitchen ${i}.`, ["clock: +5m", `beat: Buffy and Gabriel talk about the move to the house in the hills, part ${i}, at length, with every detail of it`]);
    const lines = todayLines(state(), names(), 120);
    expect(lines[0]!.text).toContain("Gabriel asks Buffy about Spike");
    expect(lines.length).toBeLessThan(8);
  });

  test("the advisor reads TODAY SO FAR", async () => {
    say("user", "Tell Dawn the Spike story.");
    const { user } = await advisorInput(chatId, historyForPrompt(chatId), undefined, steerFor(chatId));
    expect(user).toContain("TODAY SO FAR:");
    expect(user).toContain("Sunnydale › Gabriel's car");
  });
});

describe("memories in the right place (docs/20 1.3)", () => {
  test("a memory takes the place of its own message, not where its scene began", () => {
    const ti = new TimeIndex(chatId);
    expect(ti.where(null, seqOf.get("The car.")!)).toBe("Sunnydale › Gabriel's car");
    expect(ti.where(null, seqOf.get("The faucet.")!)).toBe("Revello Drive › kitchen");
  });
});

describe("backfill (docs/20 1.1)", () => {
  test("today's replies the trackers read without a beat are found; ones with a beat, or not read yet, aren't", () => {
    say("assistant", "Read before beats.", ["clock: +5m", "mood Buffy: calm → happy"]);
    addMessage(chatId, "assistant", "Not read yet.", { name: "Buffy" });
    const seqs = missingBeats(chatId).map((m) => m.seq);
    expect(seqs).toContain(seqOf.get("Read before beats.")!);
    expect(seqs).not.toContain(seqOf.get("The car.")!);
    expect(seqs.length).toBe(1);
  });
});
