import { beforeAll, describe, expect, test } from "bun:test";
import { checkReply } from "../src/accuracy/checker";
import { actOnInbox, inboxCounts, inboxItems, registerInboxProvider } from "../src/accuracy/inbox";
import { runSlips, slipCatalog, slipContext, SLIPS } from "../src/accuracy/slips";
import { normalizeCard } from "../src/cards/card";
import { all, one } from "../src/db/db";
import { defaultGuards, defaultMemoryConfig, setSetting } from "../src/lib/settings";
import { lane, registerLane } from "../src/prompt/lanes";
import { createCharacter } from "../src/services/characters";
import { addMessage, createChat, updateChat } from "../src/services/chats";
import { createConnection, createProfile, syncModels } from "../src/services/connections";
import { fileItem, filingsFor, registerFilingKind, undoFiling } from "../src/services/filings";
import { previewPrompt } from "../src/services/generation";
import { registerJob } from "../src/services/jobs";
import { registerStatusTile, statusTiles } from "../src/services/status";
import { seeded } from "../src/sim/dice";
import { currentFold, linesToOps, writeEvents } from "../src/trackers/store";
import { freshDb } from "./helpers";

let chatId = "";
let reply = "";

beforeAll(async () => {
  freshDb();
  for (const kind of ["memory.segment", "memory.build", "memory.embed", "memory.journal", "memory.consolidate", "lore.chronicle", "accuracy.check", "quota.refresh", "cache.probe"]) registerJob(kind, async () => {});
  const connId = createConnection({ name: "Mock", kind: "mock", billing: "subscription" });
  await syncModels(connId);
  createProfile({ name: "Story", connectionId: connId, modelId: "mock/storyteller", params: { context_target: 4000, max_tokens: 400 } });
  setSetting("memory.config", { ...defaultMemoryConfig, boundaryCheck: false, checkerModel: false });
  const { data } = normalizeCard({ spec: "chara_card_v2", data: { name: "Mira", description: "Keeper of the lighthouse.", first_mes: "Welcome." } });
  chatId = createChat({ characterId: createCharacter(data) }).id;
  const first = addMessage(chatId, "assistant", "The lamp hums.", { name: "Mira" });
  writeEvents(chatId, { messageId: first, swipeIdx: -1 }, linesToOps(["clock: Day 2 23:30", "cast: Mira@spot · Old Tom@left", "trait Mira: green eyes", "dead Old Tom — lost in the storm"]).ops, "model");
  addMessage(chatId, "user", "Who's there?", { name: "You" });
  reply = addMessage(chatId, "assistant", "Mira smiles, her blue eyes bright. Old Tom says hello from the doorway.", { name: "Mira" });
});

describe("the slip registry (P1)", () => {
  test("every existing check is in it, once (later parts add theirs after)", () => {
    const ids = SLIPS.map((s) => s.id);
    expect(ids.slice(0, 9)).toEqual(["trait", "dead", "time", "name", "leak", "puppet", "pov", "tense", "timeline"]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("a reply is checked through the registry, with the same findings as before", async () => {
    const issues = (await checkReply(chatId, reply, 0)) ?? [];
    expect(issues.map((i) => i.kind).sort()).toEqual(["dead", "trait"]);
  });

  test("a check switched off in this chat stays quiet; the rest still run", async () => {
    updateChat(chatId, { settings: { guards: { slips: { trait: false } } } });
    const issues = (await checkReply(chatId, reply, 0)) ?? [];
    expect(issues.map((i) => i.kind)).toEqual(["dead"]);
    updateChat(chatId, { settings: { guards: { slips: {} } } });
  });

  test("the catalog says what runs, and what waits on another setting", () => {
    const on = slipCatalog(chatId, { ...defaultGuards }, { continuity: true, leaks: false });
    expect(on.find((s) => s.id === "trait")).toMatchObject({ on: true, runs: true });
    expect(on.find((s) => s.id === "leak")).toMatchObject({ on: true, runs: false });
    const off = slipCatalog(chatId, { ...defaultGuards, pov: false, slips: { dead: false } }, { continuity: true, leaks: true });
    expect(off.find((s) => s.id === "pov")?.on).toBe(false);
    expect(off.find((s) => s.id === "dead")?.on).toBe(false);
  });

  test("a check that throws is skipped, never the pass", () => {
    const ctx = slipContext({ chatId, text: "x", seq: 1, role: "assistant", speaker: "Mira", state: currentFold(chatId).result.state, guards: { ...defaultGuards }, continuity: true, leaks: false });
    const broken = { ...SLIPS[0]!, id: "broken", run: () => { throw new Error("boom"); } };
    SLIPS.unshift(broken);
    const errors: string[] = [];
    try {
      runSlips(ctx, "reply", (id) => errors.push(id));
    } finally {
      SLIPS.shift();
    }
    expect(errors).toEqual(["broken"]);
  });
});

describe("prompt lanes (P1)", () => {
  test("a lane goes into the prompt tagged, and the Inspector lists it by name with its text", async () => {
    registerLane("craft", (ctx) => (ctx.chatId === chatId ? lane("craft", null, "- Avoid: a breath she didn't know she held") : null));
    const p = await previewPrompt(chatId);
    const b = p.trace.blocks.find((x) => x.lane === "craft");
    expect(b).toMatchObject({ name: "Craft coach", kind: "lane", included: true });
    expect(b?.text).toContain("[CRAFT]");
    expect(p.messages.some((m) => m.content.includes("[CRAFT]"))).toBe(true);
  });
  test("an empty lane stays out", () => {
    expect(lane("lessons", null, "   ")).toBeNull();
  });
});

describe("the suggestions queue (P1)", () => {
  test("a provider's suggestions carry their source, and deciding one goes back to it", () => {
    const decided: string[] = [];
    registerInboxProvider({
      kind: "test-suggestion",
      source: "lesson",
      items: (chats) => (chats.some((c) => c.id === chatId) && !decided.length ? [{ key: "test-suggestion:l1", chatId, chatTitle: "", title: "A lesson", why: "From your swipes", before: null, after: "Wren doesn't apologise easily.", editable: true, createdAt: 1, link: "/" }] : []),
      act: (id, action) => (decided.push(`${id}:${action}`), chatId),
    });
    const item = inboxItems({ chatId }).find((i) => i.key === "test-suggestion:l1");
    expect(item).toMatchObject({ kind: "test-suggestion", source: "lesson" });
    expect(inboxCounts(chatId).lesson).toBe(1);
    actOnInbox("test-suggestion:l1", "accept");
    expect(decided).toEqual(["l1:accept"]);
    expect(inboxItems({ chatId }).some((i) => i.key === "test-suggestion:l1")).toBe(false);
  });
  test("the original kinds have sources too", () => {
    for (const i of inboxItems()) expect(i.source).toBeTruthy();
  });
});

describe("filed chips (P1)", () => {
  test("a filing shows on its message until undone, and undo goes to its feature", () => {
    const undone: string[] = [];
    registerFilingKind("truth", { undo: (f) => undone.push(String(f.data.text)), notMeant: (f) => undone.push(`not:${f.data.text}`) });
    const f = fileItem(chatId, { messageId: reply, kind: "truth", label: "Truth: the lamp never goes out", data: { text: "the lamp never goes out", guess: true } });
    expect(filingsFor(chatId).map((x) => x.id)).toContain(f.id);
    undoFiling(f.id, "notMeant");
    expect(undone).toEqual(["not:the lamp never goes out"]);
    expect(filingsFor(chatId).map((x) => x.id)).not.toContain(f.id);
    // Undoing twice is harmless.
    expect(undoFiling(f.id).status).toBe("undone");
  });
});

describe("status tiles and dice (P1)", () => {
  test("tiles come back in order, and a broken one is left out", () => {
    registerStatusTile((id) => (id === chatId ? { id: "b", n: 1, label: "second", tone: "amber", order: 20 } : null));
    registerStatusTile(() => {
      throw new Error("no");
    });
    registerStatusTile((id) => (id === chatId ? { id: "a", n: 0, label: "first", tone: "blue", order: 10 } : null));
    // (Features' own tiles may show too; these two keep their order.)
    expect(statusTiles(chatId).map((t) => t.id).filter((id) => id === "a" || id === "b")).toEqual(["a", "b"]);
  });
  test("seeded dice agree for the same chat, message and salt", () => {
    const a = seeded("c1", 12, "pressure");
    const b = seeded("c1", 12, "pressure");
    const c = seeded("c1", 12, "reroll-1");
    const xs = [a(), a(), a()];
    expect([b(), b(), b()]).toEqual(xs);
    expect(c()).not.toBe(xs[0]);
  });
});

describe("migration 18 (P1)", () => {
  test("the new tables and the setup column exist", () => {
    const tables = all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'").map((t) => t.name);
    for (const t of ["lessons", "secrets_offpage", "calendars_custom", "filings"]) expect(tables).toContain(t);
    // Playbooks were dropped from the plan (migration 19).
    expect(tables).not.toContain("playbooks");
    expect(all<{ name: string }>("PRAGMA table_info(chats)").map((c) => c.name)).toContain("chat_setup");
    expect(one<{ id: number }>("SELECT id FROM _migrations WHERE id = 18")).toBeTruthy();
  });
});
