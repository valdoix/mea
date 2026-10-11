import { beforeAll, describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import { normalizeCard } from "../src/cards/card";
import { listOffpage } from "../src/accuracy/offpage";
import { createCharacter } from "../src/services/characters";
import { createChat } from "../src/services/chats";
import { categoryOf, dreamWeaverCategory, guessCategory, withCategory } from "../src/lore/format";
import { createLorebook, getEntries } from "../src/lore/service";
import { defaultEntry } from "../src/lore/types";
import { freshDb } from "./helpers";

let app: ReturnType<typeof createApp>;
const local = { requestIP: () => ({ address: "127.0.0.1", family: "IPv4", port: 5000 }) };
const post = async (path: string, body: unknown) => (await app.fetch(new Request(`http://localhost${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }), local)).json() as Promise<any>;
const g = (comment: string, content = "", extra: Record<string, unknown> = {}) => guessCategory({ ...defaultEntry({ comment, content, extra }) });

beforeAll(() => {
  freshDb();
  app = createApp();
});

describe("lorebook categories (I1)", () => {
  test("auto-sort reads titles and words", () => {
    expect(g("Buffy & Spike - Truce")).toMatchObject({ category: "relationship" });
    expect(g("Buffy & Spike - Truce").confidence).toBeGreaterThan(0.8);
    expect(g("OOC: keep replies short").category).toBe("ooc");
    expect(g("Timeline: after season 5").category).toBe("timeline");
    expect(g("Scene: the Bronze on a Friday").category).toBe("scene");
    expect(g("Spike's voice").category).toBe("voice");
    expect(g("Customs of the Watchers Council").category).toBe("customs");
    expect(g("The Slayer's Scythe", "", { type: "item" }).category).toBe("item");
    expect(g("Willow", "Nobody knows she brought Buffy back.").category).toBe("secret");
    expect(g("Something vague").confidence).toBeLessThan(0.3);
  });

  test("Dream Weaver books are recognised by their names", () => {
    expect(dreamWeaverCategory("DW Rules")).toBe("rule");
    expect(dreamWeaverCategory("Dream Weaver – NPCs")).toBe("character");
    expect(dreamWeaverCategory("DW Depth")).toBe("current");
    expect(dreamWeaverCategory("My own book")).toBeNull();
    expect(guessCategory(defaultEntry({ comment: "Giles" }), "DW NPCs")).toMatchObject({ category: "character", why: "a Dream Weaver book" });
  });

  test("a category sets a sensible place and priority, and the Codex type", () => {
    const e = withCategory(defaultEntry({ comment: "No magic without cost" }), "rule", { defaults: true });
    expect(e).toMatchObject({ position: "before_char", order: 10, constant: true, extra: { category: "rule", type: "rule" } });
    expect(categoryOf(e)).toBe("rule");
    const kept = withCategory(defaultEntry({ comment: "x", position: "depth" }), "location");
    expect(kept.position).toBe("depth");
  });

  test("Auto-sort this book (routes), one-tap correction, and a Secret kept off the page", async () => {
    const bookId = createLorebook({ name: "Sunnydale", entries: [defaultEntry({ comment: "Buffy & Spike - Truce", content: "An uneasy truce." }), defaultEntry({ comment: "Willow's secret", keys: ["Heaven"], content: "Willow pulled Buffy out of Heaven. The others don't know." })] });
    const dry = await post(`/api/lorebooks/${bookId}/autosort`, {});
    expect(dry.entries.map((x: any) => x.category)).toEqual(["relationship", "secret"]);
    expect(getEntries(bookId).every((e) => !categoryOf(e))).toBe(true);
    await post(`/api/lorebooks/${bookId}/autosort`, { apply: true, defaults: true });
    const [truce, secret] = getEntries(bookId);
    expect(categoryOf(truce!)).toBe("relationship");
    expect(truce!.order).toBe(110);
    const fixed = await post(`/api/lorebooks/${bookId}/entries/${truce!.id}/category`, { category: "current", defaults: true });
    expect(fixed).toMatchObject({ position: "depth", depth: 2, extra: { category: "current", categoryConfidence: 1 } });
    // Auto-sort again leaves what you set alone.
    const again = await post(`/api/lorebooks/${bookId}/autosort`, { apply: true });
    expect(again.entries[0]).toMatchObject({ category: "current", why: "set by you" });
    const { data } = normalizeCard({ spec: "chara_card_v2", data: { name: "Buffy", first_mes: "Patrol." } });
    const chatId = createChat({ characterId: createCharacter(data) }).id;
    await post(`/api/lorebooks/${bookId}/entries/${secret!.id}/offpage`, { chatId });
    expect(listOffpage(chatId)[0]).toMatchObject({ label: "Willow pulled Buffy out of Heaven.", neverSay: ["Heaven"] });
  });
});
