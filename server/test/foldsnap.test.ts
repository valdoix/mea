import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { normalizeCard } from "../src/cards/card";
import { all, newId, now, one, run } from "../src/db/db";
import { createCharacter } from "../src/services/characters";
import { addMessage, addSwipe, createChat, deleteSwipe, editMessage, rewindAfter, restoreMessage, restoreMessages, setActiveSwipe, softDeleteMessage, updateSwipe } from "../src/services/chats";
import { purgeTrash } from "../src/services/trash";
import {
  clearEvents,
  currentFold,
  deleteEvent,
  eventsOf,
  foldAt,
  fullFold,
  linesToOps,
  pruneFoldMarks,
  saveCastProfile,
  setSnapshotSpacing,
  snapshotFold,
  snapshotSeqs,
  writeEvents,
} from "../src/trackers/store";
import { freshDb } from "./helpers";

/**
 * M20: tracker folds start from snapshots. Whatever changes, a fold from the snapshots must equal
 * a fold from the very first event: checked after every kind of change, at several points.
 */

let chatId = "";
const ids: string[] = [];
const NAMES = ["Joss", "Brenna", "Kael", "Old Tom"];
const lines = (i: number) => {
  const who = NAMES[i % NAMES.length]!;
  const out = [`clock: +${10 + (i % 7) * 5}m`, `cast: Mira@spot · ${who}@peri`];
  if (i % 2 === 0) out.push(`bond Mira>${who}: trust +1 — they talked`);
  if (i % 3 === 0) out.push("body Mira: fatigue +1");
  if (i % 4 === 0) out.push(`item Coin ${i}: Mira → ${who} — paid`);
  if (i % 5 === 0) out.push(`thread Lost locket ${i % 3}: advance — a clue at ${i}`);
  return linesToOps(out).ops;
};
let prevSpacing = 0;

const seqOf = (id: string) => one<{ seq: number }>("SELECT seq FROM messages WHERE id = ?", id)!.seq;
const json = (x: unknown) => JSON.stringify(x);

/** Snapshot folds (and the cached ones) equal full folds: now, at several seqs, and without a message. */
function expectSame(label: string) {
  const full = fullFold(chatId);
  const snap = snapshotFold(chatId);
  expect(json(snap.result), label).toBe(json(full.result));
  expect(json(snap.times), label).toBe(json(full.times));
  expect(json(currentFold(chatId).result), label).toBe(json(full.result));
  const last = one<{ s: number }>("SELECT MAX(seq) AS s FROM messages WHERE chat_id = ?", chatId)!.s;
  for (const upto of [3, 7, 12, 18, 23, last - 1]) {
    expect(json(snapshotFold(chatId, { uptoSeq: upto }).result), `${label} @${upto}`).toBe(json(fullFold(chatId, { uptoSeq: upto }).result));
    expect(json(foldAt(chatId, { uptoSeq: upto })), `${label} foldAt @${upto}`).toBe(json(fullFold(chatId, { uptoSeq: upto }).result));
  }
  for (const id of [ids[4]!, ids[16]!, ids.at(-1)!]) {
    expect(json(snapshotFold(chatId, { excludeMessageId: id }).result), `${label} without ${id}`).toBe(json(fullFold(chatId, { excludeMessageId: id }).result));
  }
}

/** Fills the snapshots (every 5 messages), so the next check starts from them. */
const warm = () => {
  snapshotFold(chatId);
  expect(snapshotSeqs(chatId).length).toBeGreaterThan(3);
};

beforeAll(() => {
  freshDb();
  prevSpacing = setSnapshotSpacing(5);
  const { data } = normalizeCard({ spec: "chara_card_v2", data: { name: "Mira", description: "Keeper of the lighthouse.", first_mes: "Welcome." } });
  chatId = createChat({ characterId: createCharacter(data) }).id;
  writeEvents(chatId, { messageId: null, swipeIdx: 0 }, linesToOps(["clock: Day 1 08:00", "at: Port Ellis › Lighthouse"]).ops, "init");
  for (let i = 0; i < 30; i++) {
    const id = addMessage(chatId, i % 2 ? "assistant" : "user", `Line ${i}`, { name: i % 2 ? "Mira" : "You" });
    ids.push(id);
    if (i % 2) writeEvents(chatId, { messageId: id, swipeIdx: 0 }, lines(i), "model");
  }
});
afterAll(() => setSnapshotSpacing(prevSpacing));

describe("fold snapshots (M20)", () => {
  test("a fresh chat: snapshots are taken and match", () => {
    warm();
    expect(snapshotSeqs(chatId)).toEqual(expect.arrayContaining([5, 10, 15, 20, 25]));
    expectSame("fresh");
  });

  test("a new message keeps the earlier snapshots", () => {
    warm();
    const before = snapshotSeqs(chatId);
    const id = addMessage(chatId, "assistant", "More", { name: "Mira" });
    ids.push(id);
    writeEvents(chatId, { messageId: id, swipeIdx: 0 }, lines(31), "model");
    snapshotFold(chatId);
    expect(snapshotSeqs(chatId)).toEqual(expect.arrayContaining(before));
    expectSame("new message");
  });

  test("an edit of an early message drops the snapshots from it on", () => {
    warm();
    const target = ids[11]!; // seq 12
    editMessage(target, "Line 11, edited");
    snapshotFold(chatId);
    expect(snapshotSeqs(chatId).filter((s) => s < 12)).toEqual([5, 10]);
    expectSame("edit");
  });

  test("tracker events rewritten, deleted or cleared at an early message", () => {
    warm();
    writeEvents(chatId, { messageId: ids[5]!, swipeIdx: 0 }, linesToOps(["clock: +3h", "bond Mira>Joss: trust -2 — a lie"]).ops, "model", { replace: ["model"] });
    expectSame("rewrite");
    warm();
    deleteEvent(chatId, eventsOf(chatId, ids[9]!)[0]!.id);
    expectSame("delete event");
    warm();
    writeEvents(chatId, { messageId: ids[13]!, swipeIdx: -1 }, linesToOps(["trait Mira: grey eyes"]).ops, "user");
    expectSame("user line");
    warm();
    clearEvents(chatId, ["user"]);
    expectSame("clear");
  });

  test("the base state changes", () => {
    warm();
    writeEvents(chatId, { messageId: null, swipeIdx: 0 }, linesToOps(["clock: Day 2 06:00"]).ops, "init", { replace: ["init"] });
    expectSame("base");
  });

  test("swipes: switching, adding and deleting one", () => {
    const target = ids[7]!; // an assistant reply, seq 8
    warm();
    const idx = addSwipe(target, "done");
    updateSwipe(target, idx, { content: "Another take", status: "done" });
    writeEvents(chatId, { messageId: target, swipeIdx: idx }, linesToOps(["clock: +6h", "dead Old Tom — fell"]).ops, "model");
    expectSame("new swipe");
    warm();
    setActiveSwipe(target, 0);
    expectSame("back to the first swipe");
    warm();
    setActiveSwipe(target, idx);
    expectSame("to the second again");
    warm();
    deleteSwipe(target, 0);
    expectSame("first swipe deleted");
  });

  test("delete, restore, rewind and undo", () => {
    warm();
    softDeleteMessage(ids[9]!);
    expectSame("delete");
    warm();
    restoreMessage(ids[9]!);
    expectSame("restore");
    warm();
    const gone = rewindAfter(ids[14]!);
    expect(gone.length).toBeGreaterThan(5);
    expectSame("rewind");
    // New messages after the rewind take the seqs past the old ones; folds still match.
    for (let i = 0; i < 6; i++) {
      const id = addMessage(chatId, "assistant", `Branch ${i}`, { name: "Mira" });
      writeEvents(chatId, { messageId: id, swipeIdx: 0 }, lines(40 + i), "model");
    }
    expectSame("new branch");
    warm();
    restoreMessages(chatId, gone);
    expectSame("rewind undone");
  });

  test("purged messages (hard deletes) and changes made behind the code's back", () => {
    warm();
    softDeleteMessage(ids[3]!);
    purgeTrash(now() + 1000);
    expect(one("SELECT 1 FROM messages WHERE id = ?", ids[3]!)).toBeFalsy();
    expectSame("purge");
    // Straight SQL, no hooks: the database's own marks still catch it.
    warm();
    run("INSERT INTO tracker_events (id, chat_id, message_id, swipe_idx, source, ord, op, created_at) VALUES (?, ?, ?, 0, 'model', 99, ?, ?)", newId(), chatId, ids[5]!, JSON.stringify(linesToOps(["clock: +9h"]).ops[0]), now());
    expectSame("raw event");
    warm();
    run("UPDATE messages SET deleted_at = ? WHERE id = ?", now(), ids[7]!);
    expectSame("raw delete");
    warm();
    run("UPDATE messages SET deleted_at = NULL WHERE id = ?", ids[7]!);
    run("UPDATE tracker_events SET swipe_idx = 5 WHERE message_id = ?", ids[11]!);
    expectSame("raw swipe renumber");
  });

  test("fold settings: a cast profile's stamina", () => {
    warm();
    saveCastProfile(chatId, "Mira", { stamina: "tireless" });
    expectSame("cast profile");
  });

  test("old marks are pruned without breaking the checks", () => {
    warm();
    pruneFoldMarks();
    expect(all("SELECT id FROM fold_marks").length).toBe(0);
    editMessage(ids[19]!, "edited after a prune");
    expectSame("after prune");
  });
});
