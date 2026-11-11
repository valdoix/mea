import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { applyAllEdits, fixable, openNotes, proposedEdits } from "../src/accuracy/opennotes";
import { normalizeCard } from "../src/cards/card";
import { newId, now, one, run } from "../src/db/db";
import { createCharacter } from "../src/services/characters";
import { addMessage, createChat, editMessage, updateSwipe } from "../src/services/chats";
import { pauseJobs, registerJob } from "../src/services/jobs";
import { freshDb } from "./helpers";

/** docs/33 7.6: what's waiting on a story, and "apply all". */
let chatId = "";
const ids: string[] = [];
const text = (id: string) => one<{ content: string }>("SELECT s.content FROM swipes s JOIN messages m ON m.id = s.message_id AND s.idx = m.active_swipe WHERE m.id = ?", id)!.content;

beforeAll(() => {
  freshDb();
  pauseJobs(true);
  for (const kind of ["memory.segment", "memory.build", "memory.embed", "accuracy.check", "tracker.update", "offpage.reword", "lessons.learn", "steer.edit", "steer.tense"]) registerJob(kind, async () => {});
  const { data } = normalizeCard({ spec: "chara_card_v2", data: { name: "Buffy", first_mes: "Hi." } });
  chatId = createChat({ characterId: createCharacter(data) }).id;
  for (let i = 0; i < 3; i++) {
    const id = addMessage(chatId, "assistant", `She walked to the door, take ${i}.`, { name: "Buffy" });
    ids.push(id);
    updateSwipe(id, 0, { meta: { edit: { status: "proposed", text: `She walks to the door, take ${i}.`, notes: ["tense"], original: `She walked to the door, take ${i}.`, at: 1 } } });
  }
  const issues = [
    { id: "1", kind: "fact", severity: "major", claim: "She walked to the door, take 0.", conflict: "Eleanor is a neurosurgeon.", citations: [], fix: "Eleanor is a neurosurgeon.", by: "rules" },
    { id: "2", kind: "fact", severity: "minor", claim: "x", conflict: "y", citations: [], fix: "z", by: "rules", dismissed: true },
  ];
  run("INSERT INTO continuity_flags (id, chat_id, message_id, swipe_idx, issues, status, created_at, updated_at) VALUES (?, ?, ?, 0, ?, 'open', ?, ?)", newId(), chatId, ids[0]!, JSON.stringify(issues), now(), now());
});
afterAll(() => pauseJobs(false));

describe("open notes (docs/33 7.6)", () => {
  test("counts what's open and what can be fixed", () => {
    expect(openNotes(chatId)).toMatchObject({ replies: 1, issues: 1, fixable: 1, edits: 3 });
    expect(fixable(chatId)[0]).toMatchObject({ issueId: "1", messageId: ids[0] });
  });
  test("apply all applies each waiting suggestion, and leaves one whose reply changed", () => {
    editMessage(ids[2]!, "She ran, in the end.");
    const r = applyAllEdits(chatId);
    expect(r).toEqual({ applied: 2, skipped: 1 });
    expect(text(ids[0]!)).toBe("She walks to the door, take 0.");
    expect(text(ids[1]!)).toBe("She walks to the door, take 1.");
    expect(text(ids[2]!)).toBe("She ran, in the end.");
    expect(proposedEdits(chatId).map((e) => e.messageId)).toEqual([ids[2]!]);
  });
});
