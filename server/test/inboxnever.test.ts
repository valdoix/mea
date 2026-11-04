import { beforeAll, describe, expect, test } from "bun:test";
import { canonOf, laterItem, setCanon } from "../src/accuracy/canoncut";
import { inboxCount, inboxItems, neverShowAgain, neverShownList, showAgain } from "../src/accuracy/inbox";
import { normalizeCard } from "../src/cards/card";
import { one, run } from "../src/db/db";
import { createCharacter } from "../src/services/characters";
import { createChat } from "../src/services/chats";
import { freshDb } from "./helpers";

let chatId = "";

function propose(text: string) {
  const item = laterItem("event", text);
  setCanon(chatId, { ...canonOf(chatId), proposed: [...(canonOf(chatId).proposed ?? []), item] });
  return `canon:${chatId}:add:${item.id}`;
}
const shown = (key: string) => inboxItems({ chatId }).some((i) => i.key === key);

beforeAll(() => {
  freshDb();
  chatId = createChat({ characterId: createCharacter(normalizeCard({ spec: "chara_card_v2", data: { name: "Mira", first_mes: "Hello." } }).data) }).id;
});

describe("never show again", () => {
  test("rejects the card, and the same suggestion under a new id doesn't come back", () => {
    const first = propose("The Harvest begins");
    neverShowAgain(first, chatId);
    expect(canonOf(chatId).proposed!.some((i) => i.text === "The Harvest begins")).toBe(false);
    expect(shown(first)).toBe(false);

    // Spacing and capitals don't make it a different suggestion.
    const again = propose("the harvest  begins.");
    expect(shown(again)).toBe(false);
    expect(inboxCount(chatId)).toBe(0);
  });

  test("something else from the same place still shows", () => {
    expect(shown(propose("The Master rises"))).toBe(true);
  });

  test("the same words in another story still show", () => {
    const other = createChat({ characterId: createCharacter(normalizeCard({ spec: "chara_card_v2", data: { name: "Joss", first_mes: "Hi." } }).data) }).id;
    const item = laterItem("event", "The Harvest begins");
    setCanon(other, { ...canonOf(other), proposed: [item] });
    expect(inboxItems({ chatId: other }).some((i) => i.key === `canon:${other}:add:${item.id}`)).toBe(true);
  });

  test("it's listed, and Show again brings back what is still waiting", () => {
    const row = neverShownList().find((n) => n.title.includes("The Harvest begins"))!;
    expect(row.chatTitle).not.toBeNull();
    const waiting = canonOf(chatId).proposed!.find((i) => i.text === "the harvest  begins.")!;
    showAgain(row.key);
    expect(neverShownList().some((n) => n.key === row.key)).toBe(false);
    expect(shown(`canon:${chatId}:add:${waiting.id}`)).toBe(true);
  });

  test("a card that's gone can't be hidden", () => {
    expect(() => neverShowAgain("canon:nope:add:nope", chatId)).toThrow();
  });

  test("a summary that comes back is rejected again, so it never leaves the story's memory", () => {
    const t = Date.now();
    const review = () => run("UPDATE summaries SET state = 'review', proposal = ? WHERE id = 'sum1'", JSON.stringify({ title: "Rebuilt", content: "Rebuilt text", at: t }));
    run("INSERT INTO summaries (id, chat_id, level, start_seq, end_seq, closed, title, content, state, created_at, updated_at) VALUES ('sum1', ?, 'scene', 1, 2, 1, 'Mine', 'My text', 'ready', ?, ?)", chatId, t, t);
    review();
    neverShowAgain("summary:sum1", chatId);
    review();
    expect(shown("summary:sum1")).toBe(false);
    const row = one<{ state: string; proposal: string | null; content: string }>("SELECT state, proposal, content FROM summaries WHERE id = 'sum1'")!;
    expect(row).toEqual({ state: "ready", proposal: null, content: "My text" });
  });
});
