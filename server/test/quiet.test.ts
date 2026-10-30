import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { acceptIssue, checkReply, dismissIssue, factSheet, fixNotes, flagsFor, showKindAgain } from "../src/accuracy/checker";
import { storyHealth } from "../src/accuracy/health";
import "../src/accuracy/moreslips";
import { flagKinds, quietKeys } from "../src/accuracy/quiet";
import "../src/accuracy/undone";
import { normalizeCard } from "../src/cards/card";
import { newId, now, run } from "../src/db/db";
import { defaultMemoryConfig, setSetting } from "../src/lib/settings";
import { gatherLanes } from "../src/prompt/lanes";
import { createCharacter } from "../src/services/characters";
import { addMessage, createChat, editMessage } from "../src/services/chats";
import { createConnection, createProfile, syncModels } from "../src/services/connections";
import { pauseJobs, registerJob } from "../src/services/jobs";
import { currentFold, heldDone, linesToOps, writeEvents } from "../src/trackers/store";
import type { Op } from "../src/trackers/types";
import { freshDb } from "./helpers";

/** docs/22 Part 4: flags that cite what's finished, and a kind you keep waving off. */

const DONE = "The grocery portion of the Thursday list — completed";
const closed = (what: string, from: string[]): Op => ({ op: "loop", args: { action: "new", what, kind: "errand", from, done: true, how: what }, raw: `loop: ${what}` });

let charId = "";
const reply = (id: string, text: string) => addMessage(id, "assistant", text, { name: "Buffy" });
/** A chat where the groceries are done. */
function story() {
  const id = createChat({ characterId: charId }).id;
  const first = reply(id, "Friday, she says.");
  writeEvents(id, { messageId: first, swipeIdx: 0 }, linesToOps(["clock: Day 1 12:00", "cast: Buffy@spot · Gabe@spot"]).ops, "model");
  const done = reply(id, "Bought.");
  writeEvents(id, { messageId: done, swipeIdx: -1 }, [closed(DONE, ["The Thursday list: groceries, then tacos", "We'll buy you groceries tomorrow", "the grocery run for the house"])], "user");
  return id;
}

let at = 1_000;
/** A reply carrying one stored flag. */
function flagged(id: string, kind: string, o: { by?: "rules" | "model"; dismissed?: boolean; settled?: "fixed" | "accepted"; ref?: string; loop?: string; claim?: string } = {}) {
  const m = reply(id, `Line ${at}.`);
  const issue = { id: "1", kind, severity: "minor", claim: o.claim ?? `claim ${at}`, conflict: "No.", citations: o.ref ? [{ ref: o.ref, type: "tracker", label: "the record", ...(o.loop ? { id: o.loop } : {}) }] : [], fix: `fix for ${kind}`, by: o.by ?? "model", ...(o.dismissed ? { dismissed: true } : {}), ...(o.settled ? { settled: o.settled } : {}) };
  run("INSERT INTO continuity_flags (id, chat_id, message_id, swipe_idx, issues, status, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?, ?)", newId(), id, m, JSON.stringify([issue]), o.dismissed ? "resolved" : "open", at, at);
  at++;
  return m;
}
const many = (id: string, n: number, kind: string, o: Parameters<typeof flagged>[2] = {}) => {
  for (let i = 0; i < n; i++) flagged(id, kind, o);
};
const kind = (id: string, key: string) => flagKinds(id).find((k) => k.key === key);

beforeAll(async () => {
  freshDb();
  pauseJobs(true);
  for (const k of ["memory.segment", "memory.build", "memory.embed", "memory.journal", "accuracy.check", "tracker.update", "lessons.learn", "offpage.reword", "loops.backfill"]) registerJob(k, async () => {});
  const connId = createConnection({ name: "Mock", kind: "mock", billing: "subscription" });
  await syncModels(connId);
  createProfile({ name: "Story", connectionId: connId, modelId: "mock/storyteller", params: { context_target: 12000, max_tokens: 300 } });
  setSetting("memory.config", { ...defaultMemoryConfig, checkerModel: true });
  const { data } = normalizeCard({ spec: "chara_card_v2", data: { name: "Buffy", first_mes: "Hi." } });
  charId = createCharacter(data);
});
afterAll(() => pauseJobs(false));

describe("4.1 the checker cites loops", () => {
  test("told the D facts don't lag, it can flag a reply against one", async () => {
    const id = story();
    const m = reply(id, "Tomorrow, the shopping trip. MOCK_CONTRADICTION MOCK_CITE_DONE");
    const issue = (await checkReply(id, m, 0))!.find((i) => i.by === "model")!;
    expect(issue.citations[0]).toMatchObject({ type: "tracker", label: `Done: ${DONE}` });
    expect(issue.citations[0]!.ref).toMatch(/^D\d+$/);
  });

  test("the story's older words can't settle it: they'd be the same slip", async () => {
    const id = story();
    addMessage(id, "user", "Shopping trip tomorrow, right? MOCK_SETTLED: MOCK_CONTRADICTION", { name: "Gabe" });
    const m = reply(id, "Tomorrow, the shopping trip. MOCK_CONTRADICTION MOCK_CITE_DONE");
    expect((await checkReply(id, m, 0))!.some((i) => i.by === "model")).toBe(true);
  });

  test("a loop you waved through leaves the sheet; rewriting the sentence doesn't wave it", async () => {
    const id = story();
    const onSheet = () => factSheet(id, "", currentFold(id).result.state, 99).lines.some((l) => l.includes(`Done: ${DONE}`));
    expect(onSheet()).toBe(true);
    const m = reply(id, "“Then groceries.”");
    await checkReply(id, m, 0, { model: false });
    const f = flagsFor(id, { open: true })[0]!;
    dismissIssue(f.id, f.issues[0]!.id, "fixed");
    expect(onSheet()).toBe(true);
    const next = reply(id, "“Then groceries.”");
    expect((await checkReply(id, next, 0, { model: false }))!.some((i) => i.kind === "undone")).toBe(true);
    const g = flagsFor(id, { messageIds: [next] })[0]!;
    dismissIssue(g.id, g.issues[0]!.id);
    expect(onSheet()).toBe(false);
  });
});

describe("4.2 a kind you always dismiss stops interrupting", () => {
  test("more than 80% over at least 20 flags, and not before", () => {
    const short = story();
    many(short, 19, "past", { dismissed: true });
    expect(quietKeys(short).size).toBe(0);
    const even = story();
    many(even, 16, "past", { dismissed: true });
    many(even, 4, "past");
    expect(kind(even, "past:model")).toMatchObject({ flags: 20, waved: 16, quiet: false });
    const over = story();
    many(over, 17, "past", { dismissed: true });
    many(over, 3, "past");
    expect(kind(over, "past:model")).toMatchObject({ flags: 20, waved: 17, quiet: true });
    expect(kind(over, "past:model")!.reason).toContain("17 of 20");
  });

  test("a flag you acted on isn't waved off: fixed, accepted, or the reply edited", () => {
    const id = story();
    many(id, 10, "fact", { dismissed: true, settled: "fixed" });
    many(id, 5, "fact", { dismissed: true, settled: "accepted" });
    for (let i = 0; i < 5; i++) editMessage(flagged(id, "fact", { dismissed: true }), "Rewritten by hand.");
    expect(kind(id, "fact:model")).toMatchObject({ flags: 20, waved: 0, quiet: false });
  });

  test("an older flag whose canon you accepted isn't waved off either", async () => {
    const id = story();
    const m = reply(id, "A thing. MOCK_CONTRADICTION");
    await checkReply(id, m, 0);
    const f = flagsFor(id, { messageIds: [m] })[0]!;
    const after = acceptIssue(f.id, f.issues.find((i) => i.by === "model")!.id);
    expect(after.issues.find((i) => i.by === "model")!.settled).toBe("accepted");
    // A flag from before `settled` existed: dismissed, and its version in memory.
    run("UPDATE continuity_flags SET issues = replace(issues, ',\"settled\":\"accepted\"', '') WHERE id = ?", f.id);
    expect(kind(id, "fact:model")).toMatchObject({ flags: 1, waved: 0 });
  });

  test("a quiet kind leaves the reply, the fix, the next prompt and the score", () => {
    const id = story();
    many(id, 20, "past", { dismissed: true });
    const m = flagged(id, "past", { claim: "She remembers Paris." });
    expect(storyHealth(id).flags.find((k) => k.key === "past:model")).toMatchObject({ quiet: true, waitingCount: 1 });
    expect(storyHealth(id).flags.find((k) => k.key === "past:model")!.waiting[0]).toMatchObject({ messageId: m, claim: "She remembers Paris." });
    const f = flagsFor(id, { messageIds: [m] })[0]!;
    expect(f).toMatchObject({ open: 0, status: "clean" });
    expect(f.issues[0]!.quiet).toBe(true);
    expect(flagsFor(id, { open: true })).toEqual([]);
    expect(fixNotes(f.id).feedback).not.toContain("fix for past");
    expect(storyHealth(id).parts.find((p) => p.part === "continuity")!.score).toBe(100);
  });

  test("the next reply isn't told about a quiet kind, and is once it's back", () => {
    const id = story();
    many(id, 20, "past", { dismissed: true });
    many(id, 20, "retell", { dismissed: true });
    flagged(id, "retell");
    flagged(id, "past");
    const lanes = () => gatherLanes({ chatId: id, kind: "story", state: null, history: [], characterId: "" }).map((l) => l.lane);
    expect(lanes()).not.toContain("retold");
    expect(lanes()).not.toContain("slips");
    showKindAgain(id, "retell:model");
    expect(lanes()).toContain("retold");
    expect(lanes()).not.toContain("slips");
    showKindAgain(id, "past:model");
    expect(lanes()).toContain("slips");
  });

  test("its count stops while it's quiet, so it can't come back on its own", () => {
    const id = story();
    many(id, 20, "past", { dismissed: true });
    many(id, 30, "past");
    expect(kind(id, "past:model")).toMatchObject({ flags: 20, waved: 20, quiet: true, waitingCount: 30 });
  });

  test("Dismiss all leaves a quiet note alone", () => {
    const id = story();
    many(id, 20, "past", { dismissed: true });
    const m = flagged(id, "past");
    dismissIssue(flagsFor(id, { messageIds: [m] })[0]!.id, null);
    expect(kind(id, "past:model")!.waitingCount).toBe(1);
  });

  test("one tap shows it again, its waiting ones too, and the count starts over", () => {
    const id = story();
    many(id, 20, "past", { dismissed: true });
    const m = flagged(id, "past");
    showKindAgain(id, "past:model");
    expect(kind(id, "past:model")).toMatchObject({ quiet: false, flags: 0, waved: 0 });
    expect(flagsFor(id, { messageIds: [m] })[0]).toMatchObject({ open: 1, status: "open" });
    expect(() => showKindAgain(id, "nothing:rules")).toThrow();
  });

  test("what cites a closed record is measured apart from the guesses", () => {
    const id = story();
    many(id, 20, "fact", { dismissed: true });
    many(id, 2, "fact", { ref: "D1" });
    many(id, 2, "undone", { by: "rules", ref: "L", loop: "L1" });
    expect(kind(id, "fact:model")!.quiet).toBe(true);
    expect(kind(id, "fact:record")).toMatchObject({ flags: 2, quiet: false });
    expect(kind(id, "undone:record")).toMatchObject({ flags: 2, quiet: false });
    const showing = flagsFor(id, { open: true }).flatMap((f) => f.issues.filter((i) => !i.quiet).map((i) => i.kind));
    expect(showing).toEqual(["undone", "undone", "fact", "fact"]);
  });

  test("a lore citation that happens to be L isn't a closed record", () => {
    const id = story();
    const m = reply(id, "A leak.");
    run("INSERT INTO continuity_flags (id, chat_id, message_id, swipe_idx, issues, status, created_at, updated_at) VALUES (?, ?, ?, 0, ?, 'open', ?, ?)", newId(), id, m, JSON.stringify([{ id: "1", kind: "leak", severity: "major", claim: "x", conflict: "y", citations: [{ ref: "L", type: "lore", label: "a secret" }], fix: "z", by: "rules" }]), now(), now());
    expect(kind(id, "leak:rules")).toMatchObject({ source: "rules" });
  });

  test("what a quiet flag was holding back stops waiting, and waits again when it's back", async () => {
    const id = story();
    many(id, 20, "undone", { by: "rules", ref: "L", loop: "Lother", dismissed: true });
    expect(kind(id, "undone:record")!.quiet).toBe(true);
    const m = flagged(id, "undone", { by: "rules", ref: "L", loop: "L9" });
    writeEvents(id, { messageId: m, swipeIdx: 0 }, linesToOps(["plan grocery run: Day 2 10:00"]).ops, "model");
    expect(heldDone(id)).toEqual([]);
    showKindAgain(id, "undone:record");
    expect(heldDone(id)).toEqual([{ messageId: m, loop: "L9" }]);
  });
});
