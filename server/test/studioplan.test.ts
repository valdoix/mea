import { beforeAll, describe, expect, test } from "bun:test";
import { categoryOf } from "../src/lore/format";
import { createLorebook, getLorebook } from "../src/lore/service";
import { commitDraft, createDraft, getDraft, patchItem, planDiff, planExisting, planOutline, queueWrite, runStudioJob } from "../src/lore/studio";
import { defaultEntry } from "../src/lore/types";
import { createConnection, createProfile, syncModels } from "../src/services/connections";
import { registerJob } from "../src/services/jobs";
import { freshDb } from "./helpers";

beforeAll(async () => {
  freshDb();
  for (const kind of ["lore.studio", "lore.embed"]) registerJob(kind, async () => {});
  const conn = createConnection({ name: "Mock", kind: "mock", billing: "subscription" });
  await syncModels(conn);
  createProfile({ name: "Story", connectionId: conn, modelId: "mock/storyteller", params: { context_target: 4000 } });
});

describe("the Lore Studio plans first (I2)", () => {
  test("what's happening now is planned as Current entries", async () => {
    const d = createDraft({ kind: "idea", text: "A harbour town called Port Ellis where the fog keeps secrets.", options: { size: "small" } });
    await planOutline(d.id);
    const cur = await planOutline(d.id, { mode: "more", steer: 'Only situations already under way when the story opens, each with "now": true.' });
    const raid = cur.items.find((i) => i.title === "Raiders Burn the Docks")!;
    expect(raid.category).toBe("current");
    expect(cur.items.filter((i) => i.category === "current")).toHaveLength(1);
  });

  test("plan items carry a category, versions are numbered, and the differences are named", async () => {
    const d = createDraft({ kind: "idea", text: "A harbour town called Port Ellis where the fog keeps secrets. The Salt Guild owns the docks.", options: { size: "small" } });
    const planned = await planOutline(d.id);
    expect(planned.items.every((i) => i.category)).toBe(true);
    expect(planned.planVersions.map((v) => v.n)).toEqual([1]);
    const first = planned.items[0]!;
    patchItem(d.id, first.id, { category: "location", title: "Port Ellis (the harbour)" });
    await planOutline(d.id, { mode: "more", count: 2, steer: "more places" });
    const cur = getDraft(d.id)!;
    expect(cur.planVersions.map((v) => v.n)).toEqual([1, 2]);
    expect(cur.planVersions[1]!.why).toBe("planned more: more places");
    const diff = planDiff(cur)!;
    expect(diff.added.length).toBe(2);
    expect(diff.renamed).toEqual([{ id: first.id, from: first.title }]);
    expect(diff.recategorised[0]?.id ?? first.id).toBe(first.id);
    // Saved entries take their category's place and priority.
    queueWrite(d.id);
    await runStudioJob(d.id);
    const saved = commitDraft(d.id);
    const port = getLorebook(saved.bookId)!.entries.find((e) => e.comment === "Port Ellis (the harbour)")!;
    expect(categoryOf(port)).toBe("location");
    expect(port.order).toBe(170);
  });

  test("growing a book: change an entry in place, or switch one off", async () => {
    const bookId = createLorebook({ name: "Coast", entries: [defaultEntry({ comment: "The Lighthouse", keys: ["lighthouse"], content: "An old lighthouse. It is dark." }), defaultEntry({ comment: "Old Rumour", keys: ["rumour"], content: "Nobody believes it any more." })] });
    const book = getLorebook(bookId)!;
    const d = createDraft({ kind: "book", refId: bookId });
    planExisting(d.id, book.entries[0]!.id, "change", "It's lit again: Mira keeps it now.");
    const off = planExisting(d.id, book.entries[1]!.id, "off");
    expect(off.items.map((i) => i.action)).toEqual(["change", "off"]);
    expect(off.planVersions.length).toBe(2);
    queueWrite(d.id);
    await runStudioJob(d.id);
    commitDraft(d.id);
    const after = getLorebook(bookId)!;
    expect(after.entries.length).toBe(2);
    expect(after.entries.find((e) => e.comment === "Old Rumour")!.enabled).toBe(false);
    const lh = after.entries.find((e) => e.comment === "The Lighthouse")!;
    expect(lh.content).not.toBe("An old lighthouse. It is dark.");
    expect(lh.enabled).toBe(true);
  });
});
