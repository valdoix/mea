import { beforeAll, describe, expect, test } from "bun:test";
import { normalizeCard } from "../src/cards/card";
import { all, now, one, run } from "../src/db/db";
import { defaultMemoryConfig, setSetting } from "../src/lib/settings";
import { createAtom, deleteAtom, getAtom, restoreAtom, supersede } from "../src/memory/atoms";
import { buildSummary, storyNeedsRebuild } from "../src/memory/build";
import { entityFacts, norm, resolver, titlesClash } from "../src/memory/entities";
import { povAllows } from "../src/memory/recall";
import { ledgerChangedAfterReply, onLedgerChange, queueBuilds, segmentChat } from "../src/memory/scheduler";
import { getSummary, levelRows, memState, storyRow } from "../src/memory/store";
import { createCharacter } from "../src/services/characters";
import { addMessage, addSwipe, createChat, editMessage, onLedgerEdit, restoreMessage, restoreMessages, rewindAfter, setActiveSwipe, softDeleteMessage, updateSwipe } from "../src/services/chats";
import { createConnection, createProfile, syncModels } from "../src/services/connections";
import { previewPrompt } from "../src/services/generation";
import { registerJob } from "../src/services/jobs";
import { purgeTrash } from "../src/services/trash";
import { worldAfterReply } from "../src/sim/service";
import { afterUpdate, trackerLedgerHook } from "../src/trackers/service";
import { branchEvents, linesToOps, writeEvents } from "../src/trackers/store";
import { freshDb } from "./helpers";

const kinds = ["memory.segment", "memory.build", "memory.embed", "memory.journal", "memory.consolidate", "lore.chronicle", "quota.refresh", "cache.probe", "tracker.update", "tracker.init"];

async function setup(count: number) {
  freshDb();
  for (const kind of kinds) registerJob(kind, async () => {});
  onLedgerEdit(onLedgerChange);
  const connId = createConnection({ name: "Mock", kind: "mock", billing: "subscription" });
  await syncModels(connId);
  createProfile({ name: "Story", connectionId: connId, modelId: "mock/storyteller", params: { context_target: 4000, max_tokens: 400 } });
  setSetting("memory.config", { ...defaultMemoryConfig, sceneTokenCap: 100_000, boundaryCheck: false, scenesPerChapter: 2, chaptersPerArc: 2, lag: 2, journals: false, chronicle: false, consolidate: false });
  const { data } = normalizeCard({ spec: "chara_card_v2", data: { name: "Mira", description: "Keeper of the lighthouse.", first_mes: "Welcome to the lighthouse, {{user}}." } });
  const chatId = createChat({ characterId: createCharacter(data) }).id;
  const filler = "The sea rolls against the rocks while the lantern hums above them, warm and patient. ".repeat(3);
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const skip = i > 0 && i % 4 === 0 ? "The next morning, " : "";
    ids.push(addMessage(chatId, i % 2 ? "assistant" : "user", `${skip}Line ${i + 2}. ${filler}`, { name: i % 2 ? "Mira" : "You" }));
  }
  return { chatId, ids };
}

/** Segmentation and builds until nothing is left (what the job queue does in the app). */
async function drain(chatId: string) {
  for (let round = 0; round < 12; round++) {
    await segmentChat(chatId);
    let built = 0;
    for (const level of ["scene", "chapter", "arc"] as const) {
      for (const r of levelRows(chatId, level)) {
        if (!r.closed || !(r.state === "pending" || r.state === "stale")) continue;
        if (level !== "scene") {
          const kids = all<{ state: string }>("SELECT state FROM summaries WHERE chat_id = ? AND level = ? AND start_seq >= ? AND start_seq <= ?", chatId, level === "chapter" ? "scene" : "chapter", r.start_seq, r.end_seq!);
          if (!kids.every((k) => k.state === "ready")) continue;
        }
        await buildSummary(r.id).catch(() => {});
        built++;
      }
    }
    queueBuilds(chatId);
    const story = storyRow(chatId);
    if (story && storyNeedsRebuild(chatId) && story.state !== "building") {
      await buildSummary(story.id).catch(() => {});
      built++;
    }
    if (!built) return;
  }
}

const seqOf = (id: string) => one<{ seq: number }>("SELECT seq FROM messages WHERE id = ?", id)!.seq;

describe("C3: a rewind takes memory back with it", () => {
  let chatId = "";
  let ids: string[] = [];
  let cut = 0;
  let undo: string[] = [];

  beforeAll(async () => {
    ({ chatId, ids } = await setup(24));
    await drain(chatId);
  });

  test("summaries and memories of the abandoned timeline go", () => {
    const scenes = levelRows(chatId, "scene");
    expect(scenes.length).toBeGreaterThanOrEqual(4);
    // Rewind into the middle of the second scene.
    cut = scenes[1]!.start_seq + 1;
    const anchor = ids.find((id) => seqOf(id) === cut)!;
    const lateAtoms = all<{ id: string }>("SELECT m.id FROM memories m JOIN summaries s ON s.id = m.scene_id WHERE m.chat_id = ? AND s.start_seq > ?", chatId, cut).map((r) => r.id);
    const holderAtoms = all<{ id: string }>("SELECT id FROM memories WHERE scene_id = ? AND min_seq > ?", scenes[1]!.id, cut).map((r) => r.id);
    expect(lateAtoms.length).toBeGreaterThan(0);
    undo = rewindAfter(anchor);
    expect(undo.length).toBe(24 - ids.indexOf(anchor) - 1);

    expect(all("SELECT 1 FROM summaries WHERE chat_id = ? AND level != 'story' AND start_seq > ?", chatId, cut)).toHaveLength(0);
    // The row that held the rewind point is open again and isn't canon until it's rebuilt.
    const holder = levelRows(chatId, "scene").at(-1)!;
    expect(holder.closed).toBe(0);
    expect(holder.state).toBe("pending");
    expect(storyRow(chatId)!.state).toBe("pending");
    const st = memState(chatId);
    expect(st.segmentedThrough).toBeLessThanOrEqual(cut);
    expect(st.evictedThrough).toBeLessThanOrEqual(cut);
    // The scene's own AI memories went with it.
    for (const id of lateAtoms) expect(getAtom(id)).toBeFalsy();
    // Ones past the rewind point in the reopened scene are stale until it's rebuilt.
    for (const id of holderAtoms) expect(getAtom(id)!.stale).toBe(1);
  });

  test("recall and entity cards leave out memories of messages that are gone", async () => {
    // A memory you wrote about the abandoned part stays, but it isn't recalled while its sources are gone.
    const lost = undo.slice(0, 2);
    const mine = createAtom(chatId, { type: "event", content: "Mira burned the harbor ledger.", entities: ["Mira"], messageIds: lost });
    run("UPDATE memories SET stale = 1, user_edited = 0 WHERE id = ?", mine.id);
    run("UPDATE chats SET memory = json_set(memory, '$.evictedThrough', 9999) WHERE id = ?", chatId);
    const res = resolver(chatId);
    const mira = res.find("Mira");
    if (mira) expect(entityFacts(chatId, mira, 50).some((a) => a.id === mine.id)).toBe(false);
    const p = await previewPrompt(chatId);
    expect(p.messages.map((m) => m.content).join("\n")).not.toContain("burned the harbor ledger");
    run("UPDATE chats SET memory = json_set(memory, '$.evictedThrough', 0) WHERE id = ?", chatId);
  });

  test("undoing the rewind brings the messages back into memory", async () => {
    expect(restoreMessages(chatId, undo)).toBe(undo.length);
    await drain(chatId);
    const scenes = levelRows(chatId, "scene");
    expect(scenes.length).toBeGreaterThanOrEqual(4);
    expect(scenes.filter((s) => s.closed).every((s) => s.state === "ready")).toBe(true);
    expect(memState(chatId).segmentedThrough).toBeGreaterThan(cut);
  });

  test("a swipe that ends on a summarized message rebuilds its scene", () => {
    const scene = levelRows(chatId, "scene")[0]!;
    const msg = ids.find((id) => seqOf(id) === scene.start_seq + 1)!;
    expect(scene.state).toBe("ready");
    ledgerChangedAfterReply(chatId, msg);
    expect(getSummary(scene.id)!.state).toBe("stale");
    // A message memory hasn't reached yet changes nothing.
    const last = ids.at(-1)!;
    const before = levelRows(chatId, "scene").map((s) => s.state);
    ledgerChangedAfterReply(chatId, last);
    expect(levelRows(chatId, "scene").map((s) => s.state)).toEqual(before);
  });
});

describe("H4: an edit while a summary is being written isn't lost", () => {
  test("the build ends stale and runs again", async () => {
    const { chatId, ids } = await setup(12);
    await drain(chatId);
    const scene = levelRows(chatId, "scene")[0]!;
    const pending = buildSummary(scene.id);
    expect(getSummary(scene.id)!.state).toBe("building");
    editMessage(ids[1]!, "Mira says a stranger named Kael rowed in from the north.");
    await expect(pending).rejects.toThrow();
    expect(getSummary(scene.id)!.state).toBe("stale");
    await buildSummary(scene.id);
    expect(getSummary(scene.id)!.state).toBe("ready");
    expect(getSummary(scene.id)!.content).toContain("Kael");
  });

  test("a rollup whose child changed mid-build ends stale too", async () => {
    const { chatId, ids } = await setup(20);
    await drain(chatId);
    const chapter = levelRows(chatId, "chapter").find((c) => c.closed)!;
    const pending = buildSummary(chapter.id);
    editMessage(ids.find((id) => seqOf(id) >= chapter.start_seq && seqOf(id) <= chapter.end_seq!)!, "The next morning, the storm came in.");
    await expect(pending).rejects.toThrow();
    expect(getSummary(chapter.id)!.state).toBe("stale");
  });
});

describe("M19, M22: parents follow their children; an emptied scene never sticks", () => {
  test("a rebuilt scene makes its chapter and the Story So Far stale", async () => {
    const { chatId } = await setup(20);
    await drain(chatId);
    const scene = levelRows(chatId, "scene")[0]!;
    const chapter = levelRows(chatId, "chapter")[0]!;
    expect(getSummary(chapter.id)!.state).toBe("ready");
    await buildSummary(scene.id);
    expect(getSummary(chapter.id)!.state).toBe("stale");
    expect(storyRow(chatId)!.state).toBe("stale");
  });

  test("a scene whose messages were all deleted folds away", async () => {
    const { chatId, ids } = await setup(16);
    await drain(chatId);
    const scene = levelRows(chatId, "scene")[1]!;
    const inside = ids.filter((id) => seqOf(id) >= scene.start_seq && seqOf(id) <= scene.end_seq!);
    for (const id of inside) softDeleteMessage(id);
    await buildSummary(scene.id);
    const row = getSummary(scene.id);
    expect(!row || row.state !== "building").toBe(true);
    expect(all("SELECT 1 FROM summaries WHERE chat_id = ? AND state = 'building'", chatId)).toHaveLength(0);
    expect(all("SELECT 1 FROM memories WHERE scene_id = ? AND user_edited = 0", scene.id)).toHaveLength(0);
  });
});

describe("M23: a replaced fact comes back when its replacement goes", () => {
  test("deleting the newer memory revives the older one; restoring it buries it again", async () => {
    const { chatId } = await setup(2);
    const old = createAtom(chatId, { type: "fact", content: "Mira carries her father's sword." });
    const nu = createAtom(chatId, { type: "event", content: "The sword shattered on the rocks." });
    supersede(old.id, nu.id);
    expect(getAtom(old.id)!.status).toBe("superseded");
    deleteAtom(nu.id);
    expect(getAtom(old.id)!.status).toBe("active");
    restoreAtom(nu.id);
    expect(getAtom(old.id)!.status).toBe("superseded");
  });

  test("a scene rebuild revives what its old memories superseded", async () => {
    const { chatId } = await setup(12);
    await drain(chatId);
    const scene = levelRows(chatId, "scene")[0]!;
    const aiAtom = one<{ id: string }>("SELECT id FROM memories WHERE scene_id = ? AND user_edited = 0", scene.id)!;
    const old = createAtom(chatId, { type: "fact", content: "The lantern is new." });
    supersede(old.id, aiAtom.id);
    await buildSummary(scene.id);
    expect(getAtom(aiAtom.id)).toBeFalsy();
    expect(getAtom(old.id)!.status).toBe("active");
  });
});

describe("H7, M34: emptying the trash", () => {
  test("a purged message's tracker events don't come back at the start of the story", async () => {
    const { chatId, ids } = await setup(6);
    writeEvents(chatId, { messageId: ids[3]!, swipeIdx: -1 }, linesToOps(["clock: +3d"]).ops, "user");
    expect(branchEvents(chatId).some((e) => e.messageId === ids[3])).toBe(true);
    softDeleteMessage(ids[3]!);
    expect(branchEvents(chatId).some((e) => e.messageId === ids[3])).toBe(false);
    purgeTrash(now() + 1000);
    expect(one("SELECT 1 FROM messages WHERE id = ?", ids[3]!)).toBeFalsy();
    expect(all("SELECT 1 FROM tracker_events WHERE message_id = ?", ids[3]!)).toHaveLength(0);
    // Even an event left behind by an older purge stays out of the fold.
    run("INSERT INTO tracker_events (id, chat_id, message_id, swipe_idx, source, ord, op, created_at) VALUES ('orphan', ?, 'gone-message', -1, 'user', 1, ?, ?)", chatId, JSON.stringify(linesToOps(["clock: +3d"]).ops[0]), now());
    expect(branchEvents(chatId).some((e) => e.id === "orphan")).toBe(false);
  });

  test("a trashed character that a live chat uses isn't purged", async () => {
    const { chatId } = await setup(1);
    const charId = one<{ character_id: string }>("SELECT character_id FROM chats WHERE id = ?", chatId)!.character_id;
    run("UPDATE characters SET deleted_at = ? WHERE id = ?", now() - 1000, charId);
    purgeTrash(now());
    expect(one("SELECT 1 FROM characters WHERE id = ?", charId)).toBeTruthy();
  });
});

describe("M25, L13: names", () => {
  test("different titles are different people", () => {
    expect(titlesClash("Mr Smith", "Mrs Smith")).toBe(true);
    expect(titlesClash("King Edward", "Prince Edward")).toBe(true);
    expect(titlesClash("Old Tom", "Young Tom")).toBe(true);
    expect(titlesClash("Captain Mira", "Mira")).toBe(false);
  });

  test("a possessive doesn't pass the point-of-view filter", () => {
    const pov = { names: new Set([norm("Mira")]), label: "Mira" };
    expect(povAllows({ known_by: JSON.stringify(["Mira's sister"]) }, pov)).toBe(false);
    expect(povAllows({ known_by: JSON.stringify(["Captain Mira"]) }, pov)).toBe(true);
    expect(povAllows({ known_by: JSON.stringify(["mira"]) }, pov)).toBe(true);
  });
});

describe("H5, H6: what the trackers and the world make follows the swipe", () => {
  let chatId = "";
  let msg = "";
  beforeAll(async () => {
    ({ chatId } = await setup(1));
    onLedgerEdit(trackerLedgerHook);
    writeEvents(chatId, { messageId: null, swipeIdx: 0 }, linesToOps(["clock: Day 1 20:00", "at: Port Ellis › Lighthouse", "cast: Mira@spot · Tom@spot"]).ops, "init");
    msg = addMessage(chatId, "assistant", "Tom slipped and fell from the tower.", { name: "Mira" });
  });
  const tomDied = () => all<{ id: string }>("SELECT id FROM memories WHERE chat_id = ? AND content LIKE 'Tom died%' AND deleted_at IS NULL", chatId);

  test("a memory made from a tracker change goes when its swipe does, and comes back with it", () => {
    writeEvents(chatId, { messageId: msg, swipeIdx: 0 }, linesToOps(["dead Tom — fell from the tower", "clock: +6h"]).ops, "model");
    afterUpdate(chatId, msg, 0);
    expect(tomDied()).toHaveLength(1);
    // A new swipe: generation calls this when it ends.
    const idx = addSwipe(msg, "done");
    updateSwipe(msg, idx, { content: "Tom caught the railing just in time." });
    ledgerChangedAfterReply(chatId, msg);
    expect(tomDied()).toHaveLength(0);
    setActiveSwipe(msg, 0);
    expect(tomDied()).toHaveLength(1);
    softDeleteMessage(msg);
    expect(tomDied()).toHaveLength(0);
    restoreMessage(msg);
    expect(tomDied()).toHaveLength(1);
  });

  test("the world's turn after a reply belongs to the swipe that was read", () => {
    const engine = (idx: number) => all("SELECT 1 FROM tracker_events WHERE message_id = ? AND source = 'engine' AND swipe_idx = ?", msg, idx).length;
    worldAfterReply(chatId, msg, 0);
    const n = engine(0);
    expect(n).toBeGreaterThan(0);
    expect(engine(-1)).toBe(0);
    // Reading the same swipe again replaces its turn instead of adding another.
    worldAfterReply(chatId, msg, 0);
    expect(engine(0)).toBe(n);
    setActiveSwipe(msg, 1);
    expect(branchEvents(chatId).some((e) => e.messageId === msg && e.source === "engine")).toBe(false);
  });
});
