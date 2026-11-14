import { beforeAll, describe, expect, test } from "bun:test";
import { dismissIssue, ruleCheck } from "../src/accuracy/checker";
import { leakCheckOn, leakChecksOff } from "../src/accuracy/leakteach";
import { normalizeCard } from "../src/cards/card";
import { now, run } from "../src/db/db";
import { defaultMemoryConfig, setSetting } from "../src/lib/settings";
import { createCharacter } from "../src/services/characters";
import { addMessage, createChat } from "../src/services/chats";
import { registerJob } from "../src/services/jobs";
import { currentFold, linesToOps, writeEvents } from "../src/trackers/store";
import { freshDb } from "./helpers";

/** docs/35 Part 5: four dismissals of the same secret didn't stop the fifth flag. Dismissing teaches now. */

let chatId = "";
let n = 0;

beforeAll(() => {
  freshDb();
  for (const kind of ["memory.segment", "memory.build", "memory.embed", "memory.journal", "memory.consolidate", "lore.chronicle", "accuracy.check", "quota.refresh", "cache.probe"]) registerJob(kind, async () => {});
  setSetting("memory.config", { ...defaultMemoryConfig, boundaryCheck: false, lag: 1, leakGuard: "on" });
  const { data } = normalizeCard({ spec: "chara_card_v2", data: { name: "Mira", description: "Keeper of the lighthouse.", first_mes: "Hi." } });
  chatId = createChat({ characterId: createCharacter(data) }).id;
  const first = addMessage(chatId, "assistant", "Hi.", { name: "Mira" });
  writeEvents(chatId, { messageId: first, swipeIdx: -1 }, linesToOps(["cast: Mira@spot · Walter@spot · Dawn Summers@spot · Joss@peri", "secret #vault: the silver vault key hangs behind the lighthouse clock | kept by Joss · from Walter, Dawn Summers"]).ops, "model");
});

const st = () => currentFold(chatId).result.state;
const flags = (text: string, speaker: string) => ruleCheck(chatId, text, st(), { speaker, leaks: true, names: false }).filter((i) => i.kind === "leak");
/** Stores a leak flag as the checker would, and dismisses it with a reason. */
function dismissed(text: string, speaker: string, why?: "know" | "notAbout") {
  const found = flags(text, speaker);
  expect(found.length).toBe(1);
  const id = `f${++n}`;
  // One flag a reply: each its own.
  const msg = addMessage(chatId, "assistant", text, { name: speaker });
  run("INSERT INTO continuity_flags (id, chat_id, message_id, swipe_idx, issues, status, created_at, updated_at) VALUES (?, ?, ?, 0, ?, 'open', ?, ?)", id, chatId, msg, JSON.stringify([{ ...found[0], id: "1" }]), now() - 1000 + n, now());
  dismissIssue(id, "1", undefined, why);
}

describe("dismissing a leak teaches (5.1, 5.2)", () => {
  test("'It isn't about that': the same words don't match it again; other words still do", () => {
    dismissed("“The silver vault key hangs behind the lighthouse clock,” Walter says.", "Walter", "notAbout");
    expect(flags("“The silver vault key hangs behind the lighthouse clock,” Walter says.", "Walter")).toEqual([]);
    expect(leakChecksOff(chatId)).toEqual({});
  });
  test("two strikes and the secret's leak check is off, until you turn it back on", () => {
    dismissed("“The lighthouse clock hides the silver vault key,” Dawn says. “It hangs there.”", "Dawn Summers", "notAbout");
    expect(leakChecksOff(chatId)).toEqual({ vault: "you said 2 of its flags weren't about it" });
    expect(flags("“The silver key to the vault hangs on the lighthouse clock,” Dawn says.", "Dawn Summers")).toEqual([]);
    leakCheckOn(chatId, "vault");
    expect(leakChecksOff(chatId)).toEqual({});
  });
  test("'They do know' writes it down, and nothing flags them for it again", () => {
    dismissed("Dawn Summers knows the vault key hangs behind the lighthouse clock.", "Mira", "know");
    const dawn = Object.values(st().chars).find((c) => c.name === "Dawn Summers")!;
    expect(st().facts.vault?.stances[dawn.id]).toMatchObject({ status: "knows", set: true });
    expect(flags("Dawn Summers knows the vault key hangs behind the lighthouse clock.", "Mira")).toEqual([]);
  });
});
