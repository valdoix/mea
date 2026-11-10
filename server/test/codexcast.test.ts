import { beforeAll, describe, expect, test } from "bun:test";
import { normalizeCard } from "../src/cards/card";
import { all, newId, now, one, run } from "../src/db/db";
import { sceneNames, syncEntities, unmergeEntity, updateEntity } from "../src/memory/entities";
import { createCharacter } from "../src/services/characters";
import { addMessage, createChat, softDeleteMessage } from "../src/services/chats";
import { createPersona } from "../src/services/personas";
import { linesToOps, writeEvents } from "../src/trackers/store";
import { freshDb } from "./helpers";

/** docs/32 Part 3: the Codex follows the cast. A page the cast no longer stands behind is put away, and can come back. */

let chatId = "";
const reply = (text: string, lines: string[]) => {
  const id = addMessage(chatId, "assistant", text, { name: "Buffy Summers" });
  if (lines.length) writeEvents(chatId, { messageId: id, swipeIdx: 0 }, linesToOps(lines).ops, "model");
  return id;
};
const scene = (participants: string[], seq: number) =>
  run(
    "INSERT INTO summaries (id, chat_id, level, start_seq, end_seq, closed, title, content, data, state, created_at, updated_at) VALUES (?, ?, 'scene', ?, ?, 1, 't', 'c', ?, 'ready', ?, ?)",
    newId(),
    chatId,
    seq,
    seq,
    JSON.stringify({ participants }),
    now(),
    now(),
  );
const page = (name: string) => one<{ id: string; merged_into: string | null; deleted_at: number | null; data: string }>("SELECT id, merged_into, deleted_at, data FROM entities WHERE chat_id = ? AND name = ?", chatId, name);
const live = () => all<{ name: string }>("SELECT name FROM entities WHERE chat_id = ? AND kind = 'person' AND merged_into IS NULL AND deleted_at IS NULL ORDER BY name", chatId).map((r) => r.name);
/** A page as an older Mea left it: made from the cast or a scene record under a name nobody has now. */
const oldPage = (name: string, sources: string[]) =>
  run("INSERT INTO entities (id, chat_id, kind, name, data, created_at, updated_at) VALUES (?, ?, 'person', ?, ?, ?, ?)", newId(), chatId, name, JSON.stringify({ sources }), now(), now());

beforeAll(() => {
  freshDb();
  const { data } = normalizeCard({ spec: "chara_card_v2", data: { name: "Buffy Summers", description: "Buffy Summers, twenty.", first_mes: "The lamp hums." } });
  chatId = createChat({ characterId: createCharacter(data), personaId: createPersona({ name: "Gabriel Winters", data: { description: "" } }) }).id;
  reply("Dawn calls down the stairs. Eleanor is on the phone.", ["cast: Buffy Summers@spot · Gabriel Winters@spot · Dawn Summers@peri · Eleanor Winters@off"]);
  scene(["Buffy Summers", "Gabriel Winters"], 1);
  syncEntities(chatId, true);
});

describe("scene records' people, as names (docs/32 3.2)", () => {
  test("notes in brackets go, lists are their people, and a group's label isn't one of them", () => {
    expect(sceneNames(["Dawn Summers (on phone)", "Spike (briefly, at the back door)", "Buffy Summers & Gabriel Winters", "Dawn's friends: Melissa, Kara, Jamie", "Xander|Willow"])).toEqual([
      "Dawn Summers",
      "Spike",
      "Buffy Summers",
      "Gabriel Winters",
      "Melissa",
      "Kara",
      "Jamie",
      "Xander",
      "Willow",
    ]);
    expect(sceneNames(["Gabriel's mom (name unknown", "Walter Clark"])).toEqual(["Gabriel's mom", "Walter Clark"]);
  });

  test("a scene record's note never makes a page", () => {
    scene(["Dawn Summers (upstairs, showering)", "Buffy Summers, Gabriel Winters"], 2);
    syncEntities(chatId, true);
    expect(live()).toEqual(["Buffy Summers", "Dawn Summers", "Eleanor Winters", "Gabriel Winters"]);
  });
});

describe("pages the cast no longer has (docs/32 3.1)", () => {
  test("a wrong name's page joins the page of whoever it's read as; a note's page joins its person; a list's is hidden", () => {
    oldPage("Gabriel Summers", ["tracker"]);
    oldPage("Eleanor Winters (by phone)", ["scenes"]);
    oldPage("Buffy Summers & Gabriel Winters", ["tracker"]);
    oldPage("Shannon", ["tracker"]);
    syncEntities(chatId, true);
    expect(page("Gabriel Summers")!.merged_into).toBe(page("Gabriel Winters")!.id);
    expect(page("Eleanor Winters (by phone)")!.merged_into).toBe(page("Eleanor Winters")!.id);
    expect(page("Buffy Summers & Gabriel Winters")!.deleted_at).not.toBeNull();
    expect(JSON.parse(page("Shannon")!.data).retired).toBe("hidden");
    expect(live()).toEqual(["Buffy Summers", "Dawn Summers", "Eleanor Winters", "Gabriel Winters"]);
    // The wrong name didn't become one of the right person's names.
    expect(one<{ aliases: string }>("SELECT aliases FROM entities WHERE id = ?", page("Gabriel Winters")!.id)!.aliases).not.toContain("Summers");
  });

  test("what you edited, what memories name and a scene's plain name are left alone", () => {
    oldPage("Marguerite", ["tracker"]);
    updateEntity(page("Marguerite")!.id, { description: "Mine." });
    oldPage("Jenny", ["tracker", "memories"]);
    oldPage("Tobias", ["scenes"]);
    syncEntities(chatId, true);
    expect(live()).toEqual(expect.arrayContaining(["Marguerite", "Jenny", "Tobias"]));
  });

  test("a merge can be undone, and a hidden page comes back when the story has the person", () => {
    unmergeEntity(page("Gabriel Summers")!.id);
    expect(page("Gabriel Summers")!.merged_into).toBeNull();
    reply("Shannon, the clerk, holds the door.", ["cast: Shannon@peri"]);
    syncEntities(chatId, true);
    expect(page("Shannon")!.deleted_at).toBeNull();
    expect(JSON.parse(page("Shannon")!.data).retired).toBeUndefined();
    expect(live()).toContain("Shannon");
  });

  test("someone who leaves the cast with their reply leaves the Codex, and returns with it", () => {
    const id = reply("Marco looks up from the counter.", ["cast: Marco@peri"]);
    syncEntities(chatId, true);
    expect(live()).toContain("Marco");
    softDeleteMessage(id);
    syncEntities(chatId, true);
    expect(live()).not.toContain("Marco");
    reply("Marco looks up from the counter again.", ["cast: Marco@peri"]);
    syncEntities(chatId, true);
    expect(live()).toContain("Marco");
  });
});
