import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { ProposedChange } from "../src/assistant/core";
import { normalizeCard } from "../src/cards/card";
import { parseJson } from "../src/db/db";
import { applyChange, CHANGE_KINDS, checkChanges, undoStep } from "../src/meus/changes";
import { createCharacter } from "../src/services/characters";
import { addMessage, type ChatSettings, createChat, mustChat } from "../src/services/chats";
import { pauseJobs, registerJob } from "../src/services/jobs";
import { promisesFor } from "../src/trackers/promises";
import { currentFold, linesToOps, writeEvents } from "../src/trackers/store";
import { freshDb } from "./helpers";

let chatId = "";
const state = () => currentFold(chatId).result.state;
const check = (raw: Record<string, unknown>[]) => checkChanges(chatId, raw);
const apply = (c: Omit<ProposedChange, "id">) => applyChange(chatId, { ...c, id: "x" });

beforeAll(() => {
  freshDb();
  pauseJobs(true);
  for (const kind of ["memory.segment", "memory.build", "memory.embed", "accuracy.check", "tracker.update", "offpage.reword", "lessons.learn"]) registerJob(kind, async () => {});
  const { data } = normalizeCard({ spec: "chara_card_v2", data: { name: "Buffy", first_mes: "Night in Sunnydale." } });
  chatId = createChat({ characterId: createCharacter(data) }).id;
  const id = addMessage(chatId, "assistant", "Night in Sunnydale.", { name: "Buffy" });
  writeEvents(chatId, { messageId: id, swipeIdx: -1 }, linesToOps(["clock: Day 2 22:00", "at: Sunnydale › Library", "cast: Buffy@spot · Spike@off", "know Spike: Buffy was in Heaven | overheard · knows", "secret #willow: Willow pulled her out | kept by Willow · from Spike"]).ops, "model");
});
afterAll(() => pauseJobs(false));

describe("Meus runs the Desk (F4)", () => {
  test("Meus is told about every Desk kind", () => {
    for (const k of ["report", "cut_to", "promise", "calendar_add", "room", "timeskip", "pressure", "lesson", "secret_offpage", "canon"]) expect(CHANGE_KINDS).toContain(`"kind": "${k}"`);
    expect(CHANGE_KINDS).not.toContain('"kind": "playbook"');
  });

  test("“Skip to morning and remind me what Spike knows”: one card, two ticks", () => {
    const { changes, dropped } = check([
      { kind: "timeskip", duration: "until morning" },
      { kind: "report", report: "knows", name: "Spike" },
    ]);
    expect(dropped).toEqual([]);
    expect(changes.map((c) => c.kind)).toEqual(["timeskip", "report"]);
    expect(changes[1]!.after).toContain("knows: Buffy was in Heaven");
    expect(changes[1]!.after).toContain("doesn't know: Willow pulled her out");
    for (const c of changes) apply(c);
    expect((state().time?.minutes ?? 0) % 1440).toBe(8 * 60);
  });

  test("cut_to sets the cue, and Undo puts the old one back", () => {
    const [c] = check([{ kind: "cut_to", to: "Spike" }]).changes;
    const steps = apply(c!);
    expect(parseJson<ChatSettings>(mustChat(chatId).settings, {}).cue).toContain("Cut to Spike");
    for (const s of steps) undoStep(chatId, s);
    expect(parseJson<ChatSettings>(mustChat(chatId).settings, {}).cue ?? null).toBeNull();
  });

  test("promise: record one, then settle it", () => {
    const rec = check([{ kind: "promise", who: "Buffy", whom: "Spike", what: "meet at the Bronze", meet: "the Bronze", due: "Day 3 21:00" }]).changes[0]!;
    apply(rec);
    const p = promisesFor(chatId).find((x) => x.what === "meet at the Bronze")!;
    expect(p).toMatchObject({ who: "Buffy", meet: "the Bronze", status: "open" });
    const settle = check([{ kind: "promise", id: p.id, verdict: "kept" }]).changes[0]!;
    const steps = apply(settle);
    expect(promisesFor(chatId).find((x) => x.id === p.id)?.status).toBe("kept");
    for (const s of steps) undoStep(chatId, s);
    expect(promisesFor(chatId).find((x) => x.id === p.id)?.status).toBe("open");
  });

  test("calendar_add and room write the story's records", () => {
    const { changes } = check([
      { kind: "calendar_add", title: "Dawn's birthday", when: "10 November", event_kind: "birthday" },
      { kind: "room", name: "Spike", place: "Sunnydale › The Crypt", room_kind: "home", keeps: ["a stolen jacket @ The Crypt"] },
    ]);
    for (const c of changes) apply(c);
    expect(Object.values(state().calendar).find((e) => e.title === "Dawn's birthday")).toMatchObject({ kind: "birthday", when: "10 November" });
    const crypt = Object.values(state().places).find((p) => p.name === "The Crypt")!;
    expect(crypt).toMatchObject({ kind: "home" });
    expect(state().chars[crypt.owner!]?.name).toBe("Spike");
    expect(state().items["a-stolen-jacket"]).toMatchObject({ holder: "place:The Crypt" });
  });

  test("reports for bonds, threads and secrets read without changing anything", () => {
    const { changes } = check([{ kind: "report", report: "secrets" }, { kind: "report", report: "threads" }, { kind: "report", report: "nonsense" }]);
    expect(changes.map((c) => c.label)).toEqual(["Report · secrets", "Report · threads"]);
    expect(changes[0]!.after).toContain("Willow pulled her out");
    expect(apply(changes[0]!)).toEqual([]);
  });
});
