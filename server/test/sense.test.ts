import { beforeAll, describe, expect, test } from "bun:test";
import { fixNotes, type Issue, withdrawStale } from "../src/accuracy/checker";
import { RULES_VERSION, senseOf } from "../src/accuracy/sense";
import { normalizeCard } from "../src/cards/card";
import { all, now, one, run } from "../src/db/db";
import { defaultMemoryConfig, setSetting } from "../src/lib/settings";
import { createCharacter } from "../src/services/characters";
import { addMessage, createChat } from "../src/services/chats";
import { registerJob } from "../src/services/jobs";
import { currentFold, heldLeaks, linesToOps, writeEvents } from "../src/trackers/store";
import { freshDb } from "./helpers";

/**
 * docs/35 Part 4: "Buffy Summers doesn't know this: 'Buffy asks Gabriel not to tell Walter she is
 * alive'" was shown as a major slip. A flag has to survive being read, and old ones are read again.
 */

let chatId = "";
let reply = "";
const REPLY = "“And if she asks why you want it, tell her Dawn’s running a background check!” Buffy calls. Walter says the silver vault key hangs behind the lighthouse clock.";

beforeAll(() => {
  freshDb();
  for (const kind of ["memory.segment", "memory.build", "memory.embed", "memory.journal", "memory.consolidate", "lore.chronicle", "accuracy.check", "quota.refresh", "cache.probe"]) registerJob(kind, async () => {});
  setSetting("memory.config", { ...defaultMemoryConfig, boundaryCheck: false, lag: 1, leakGuard: "on" });
  const { data } = normalizeCard({ spec: "chara_card_v2", data: { name: "Buffy Summers", description: "The Slayer.", first_mes: "Hi." } });
  chatId = createChat({ characterId: createCharacter(data) }).id;
  const first = addMessage(chatId, "assistant", "Hi.", { name: "Buffy Summers" });
  writeEvents(
    chatId,
    { messageId: first, swipeIdx: -1 },
    linesToOps([
      "cast: Buffy Summers@spot · Walter@spot · Joss@peri · Dawn Summers@off",
      "secret #alive: Buffy asks Gabriel not to tell Walter she is alive, not yet | kept by Buffy Summers · from Walter",
      "secret #vault: the silver vault key hangs behind the lighthouse clock | kept by Joss · from Walter",
    ]).ops,
    "model",
  );
  reply = addMessage(chatId, "assistant", REPLY, { name: "Buffy Summers" });
});

const st = () => currentFold(chatId).result.state;
const leak = (over: Partial<Issue>): Omit<Issue, "id"> => ({ kind: "leak", severity: "major", claim: "“And if she asks why you want it, tell her Dawn’s running a background check!”", conflict: "", citations: [{ ref: "T", type: "tracker", label: "secret: Buffy is alive" }], fix: "", by: "rules", ...over });
const idOf = (name: string) => Object.values(st().chars).find((c) => c.name === name)!.id;

describe("a flag has to survive being read (4.1)", () => {
  test("the screenshot's flag: Buffy is who it's about", () => {
    expect(senseOf(leak({ about: { id: idOf("Buffy Summers"), fact: "alive" } }), { st: st(), reply: REPLY })).toBe("Buffy Summers is who it's about");
  });
  test("a claim that isn't in the reply, or a secret the tracker doesn't have", () => {
    expect(senseOf(leak({ claim: "Something nobody wrote." }), { st: st(), reply: REPLY })).toBe("its claim isn't in the reply");
    expect(senseOf(leak({ citations: [{ ref: "T", type: "tracker", label: "secret: Buffy asks Gabriel not to tell Walter she is alive, not yet" }] }), { st: st(), reply: REPLY })).toBe("its secret isn't in the tracker");
  });
  test("nothing says they're in the dark: not a major slip", () => {
    expect(senseOf(leak({ about: { id: idOf("Dawn Summers"), fact: "alive" } }), { st: st(), reply: REPLY })).toBe("nothing says Dawn Summers doesn't know it");
  });
  test("too little in common", () => {
    const vault = { citations: [{ ref: "T" as const, type: "tracker" as const, label: "secret: the silver vault key hangs behind the lighthouse clock" }], about: { id: idOf("Walter"), fact: "vault" } };
    expect(senseOf(leak({ ...vault, claim: "“And if she asks why you want it, tell her Dawn’s running a background check!”" }), { st: st(), reply: REPLY })).toBe("the sentence and the secret share too little");
    expect(senseOf(leak({ ...vault, claim: "Walter says the silver vault key hangs behind the lighthouse clock." }), { st: st(), reply: REPLY })).toBeNull();
  });
  test("a model's flag isn't the rules' to judge", () => {
    expect(senseOf(leak({ by: "model", claim: "nowhere" }), { st: st(), reply: REPLY })).toBeNull();
  });
});

describe("old flags are read again (4.3) and unsure ones hold nothing (4.4)", () => {
  const insert = (issues: Partial<Issue>[]) => {
    const id = `flag-${Math.random().toString(36).slice(2)}`;
    run("DELETE FROM continuity_flags WHERE message_id = ?", reply);
    run("INSERT INTO continuity_flags (id, chat_id, message_id, swipe_idx, issues, status, created_at, updated_at) VALUES (?, ?, ?, 0, ?, 'open', ?, ?)", id, chatId, reply, JSON.stringify(issues.map((i, n) => ({ ...leak({}), id: String(n + 1), ...i }))), now(), now());
    return id;
  };
  test("the screenshot's open flag is withdrawn on start; a real one stays, in today's words", () => {
    const id = insert([
      { conflict: `Buffy Summers doesn't know this: "Buffy asks Gabriel not to tell Walter she is alive, not yet" (kept by Gabriel Winters).` },
      { claim: "Walter says the silver vault key hangs behind the lighthouse clock.", conflict: "old words", citations: [{ ref: "T", type: "tracker", label: "secret: the silver vault key hangs behind the lighthouse clock" }] },
    ]);
    expect(withdrawStale()).toEqual({ read: 1, withdrawn: 1 });
    const issues = JSON.parse(one<{ issues: string }>("SELECT issues FROM continuity_flags WHERE id = ?", id)!.issues) as Issue[];
    expect(issues[0]).toMatchObject({ dismissed: true, settled: "withdrawn", rv: RULES_VERSION });
    expect(issues[1]).toMatchObject({ rv: RULES_VERSION, conflict: expect.stringContaining("Walter doesn't know this") });
    expect(issues[1]!.dismissed).toBeUndefined();
    // Read once: a second start reads nothing.
    expect(withdrawStale()).toEqual({ read: 0, withdrawn: 0 });
  });
  test("all of a flag withdrawn: the flag is resolved", () => {
    const id = insert([{ conflict: "Buffy Summers doesn't know this." }]);
    withdrawStale();
    expect(one<{ status: string }>("SELECT status FROM continuity_flags WHERE id = ?", id)!.status).toBe("resolved");
  });
  test("only a certain leak holds back what the tracker records, and goes to a rewrite", () => {
    const id = insert([
      { severity: "minor", conflict: "Does Dawn know this?", fix: "Check whether Dawn knows that X.", rv: RULES_VERSION },
      { claim: "Walter says the silver vault key hangs behind the lighthouse clock.", holds: { who: "Walter", text: "the silver vault key hangs behind the lighthouse clock" }, fix: "Walter doesn't know that the key hangs there.", rv: RULES_VERSION },
    ]);
    expect(heldLeaks(chatId)).toEqual([{ messageId: reply, who: "Walter", text: "the silver vault key hangs behind the lighthouse clock" }]);
    expect(fixNotes(id).feedback).not.toContain("Check whether Dawn");
    expect(fixNotes(id).feedback).toContain("Walter doesn't know");
    expect(all("SELECT 1 FROM continuity_flags").length).toBe(1);
  });
});
