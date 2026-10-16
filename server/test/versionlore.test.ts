import { beforeAll, describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import { emptyCard } from "../src/cards/card";
import { createCreatorDraft, patchCreator, saveCreator } from "../src/creator/creator";
import { createLorebook, getLorebook, linkedBooks } from "../src/lore/service";
import { addItem, mustDraft, patchItem, queueWrite, reviewDraft, runStudioJob } from "../src/lore/studio";
import { defaultEntry } from "../src/lore/types";
import { commitVersionLore, createVersionLore, isWorldItem, loreComparison, shortName } from "../src/lore/versionlore";
import { createCharacter } from "../src/services/characters";
import { createConnection, createProfile, syncModels } from "../src/services/connections";
import { registerJob } from "../src/services/jobs";
import { copyAsVersion } from "../src/services/linked";
import { createPersona } from "../src/services/personas";
import { freshDb } from "./helpers";

let app: ReturnType<typeof createApp>;
const local = { requestIP: () => ({ address: "127.0.0.1", family: "IPv4", port: 5000 }) };
async function api<T = any>(method: string, path: string, body?: unknown): Promise<{ status: number; json: T }> {
  const res = await app.fetch(new Request(`http://localhost${path}`, { method, headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined }), local);
  return { status: res.status, json: (await res.json()) as T };
}

beforeAll(async () => {
  freshDb();
  for (const kind of ["lore.studio", "lore.embed", "creator.write"]) registerJob(kind, async () => {});
  app = createApp();
  const conn = createConnection({ name: "Mock", kind: "mock", billing: "subscription" });
  await syncModels(conn);
  createProfile({ name: "Story", connectionId: conn, modelId: "mock/storyteller", params: { context_target: 4000 } });
});

/** Mira and her lorebook, and a "College AU" version made in the variant studio with a map set by hand. */
function mirasVersion() {
  const origin = createCharacter({ ...emptyCard("Mira"), description: "Mira keeps the lighthouse above Port Ellis.", first_mes: "The lamp is lit." }, { mode: "companion" });
  const book = createLorebook({
    name: "The Salt Coast",
    entries: [
      defaultEntry({ comment: "Port Ellis", keys: ["Port Ellis", "the harbour"], content: "A harbour town under a lighthouse.", extra: { type: "location" } }),
      defaultEntry({ comment: "The Salt Guild", keys: ["Salt Guild"], content: "Owns the docks and every debt.", extra: { type: "faction" } }),
      defaultEntry({ comment: "Tomas", keys: ["Tomas"], content: "Mira's brother; he left Port Ellis for the navy.", extra: { type: "character", aliases: ["Tom"] } }),
      defaultEntry({ comment: "The Lamp", keys: ["lamp"], content: "The great lamp, never out.", extra: { type: "item" } }),
      defaultEntry({ comment: "The Old Ferry", keys: ["ferry"], content: "It sank in the storm of '09.", extra: { type: "item" } }),
    ],
    links: [{ target_type: "character", target_id: origin }],
  });
  const d = createCreatorDraft({ kind: "character", baseId: origin, asVersion: { kind: "au", label: "College AU" }, idea: "She runs the campus radio." });
  patchCreator(d.id, {
    variant: {
      map: [
        { from: "Port Ellis", type: "place", state: "changed", to: "Ellis Campus, a city university" },
        { from: "The Salt Guild", type: "group", state: "kept" },
        { from: "Tomas", type: "person", state: "kept" },
        { from: "The Lamp", type: "thing", state: "kept" },
        { from: "The Old Ferry", type: "thing", state: "dropped" },
        { from: "", to: "The campus radio station", type: "place", state: "new", note: "where she works" },
      ],
    },
  });
  const version = saveCreator(d.id).id;
  return { origin, book, version, creatorId: d.id };
}

describe("a version's lorebook (docs/14, part 3)", () => {
  test("the plan: kept entries copied, changed ones planned under their new name, dropped left out, new rows added", () => {
    const { version, book } = mirasVersion();
    const d = createVersionLore("character", version);
    expect(d.source.kind).toBe("version");
    expect(d.title).toBe("Mira (College AU): lore");
    expect(d.version).toMatchObject({ kind: "character", id: version, originName: "Mira" });
    expect(d.stage).toBe("plan");
    const by = (t: string) => d.items.find((i) => i.title === t);
    // Changed: the new name, the old entry kept as what to translate.
    expect(by("Ellis Campus")).toMatchObject({ type: "location", status: "planned", entry: null, pitch: "Ellis Campus, a city university", versionSource: { from: "Port Ellis", state: "changed", bookId: book } });
    expect(by("Ellis Campus")!.versionSource!.text).toContain("harbour town");
    // Kept: copied as is, aliases and all.
    expect(by("The Salt Guild")).toMatchObject({ status: "drafted", entry: { content: "Owns the docks and every debt.", keys: ["Salt Guild"] }, versionSource: { state: "kept" } });
    // Kept on the map, but it names something the map changed: it's translated instead of copied.
    expect(by("Tomas")).toMatchObject({ status: "planned", versionSource: { state: "changed" } });
    expect(by("Tomas")!.pitch).toContain("Port Ellis");
    expect(by("The Lamp")?.versionSource?.state).toBe("kept");
    // Dropped: left out (visible, not kept).
    expect(by("The Old Ferry")).toMatchObject({ keep: false });
    // New: from the map.
    expect(by("The campus radio station")).toMatchObject({ type: "location", pitch: "The campus radio station (where she works)", versionSource: { state: "new", entryId: null } });
    expect(shortName("Dad, the county sheriff")).toBe("Dad");
    expect(isWorldItem({ type: "location" })).toBe(true);
    expect(isWorldItem({ type: "character" })).toBe(false);
  });

  test("writing translates through the map: the original's name never survives as a key or alias", async () => {
    const { version } = mirasVersion();
    const d = createVersionLore("character", version);
    queueWrite(d.id);
    await runStudioJob(d.id);
    const after = mustDraft(d.id);
    const campus = after.items.find((i) => i.title === "Ellis Campus")!;
    expect(campus.status).toBe("drafted");
    expect(campus.entry!.keys.map((k) => k.toLowerCase())).not.toContain("port ellis");
    expect(campus.entry!.aliases.map((k) => k.toLowerCase())).not.toContain("port ellis");
    // A kept entry wasn't rewritten.
    expect(after.items.find((i) => i.title === "The Salt Guild")!.entry!.content).toBe("Owns the docks and every debt.");
    // The dropped one wasn't written either.
    expect(after.items.find((i) => i.title === "The Old Ferry")!.entry).toBeNull();
    // A leak in an entry is flagged in the review.
    patchItem(d.id, campus.id, { entry: { ...campus.entry!, content: "Ellis Campus, once Port Ellis." } });
    expect(reviewDraft(d.id).issues[campus.id]!.some((i) => i.kind === "leak" && i.message.includes("Ellis Campus"))).toBe(true);
  });

  test("saving: world entries in one book, the version's own in another, both linked to it; the original's books unlinked from it", async () => {
    const { version, origin, book } = mirasVersion();
    // The creator linked the original's book to the version when it was saved.
    expect(linkedBooks("character", version).map((b) => b.id)).toContain(book);
    const d = createVersionLore("character", version);
    queueWrite(d.id);
    await runStudioJob(d.id);
    const r = commitVersionLore(d.id);
    expect(r.bookIds).toHaveLength(2);
    expect(r.unlinked).toEqual(["The Salt Coast"]);
    const mine = linkedBooks("character", version);
    expect(mine.map((b) => b.id).sort()).toEqual([...r.bookIds].sort());
    expect(linkedBooks("character", origin).map((b) => b.id)).toEqual([book]);
    const world = getLorebook(r.draft.version!.worldBookId!)!;
    const own = getLorebook(r.draft.version!.companionBookId!)!;
    expect(world.name).toBe("College AU: the world");
    expect(world.entries.map((e) => e.comment).sort()).toEqual(["Ellis Campus", "The Salt Guild", "The campus radio station"]);
    expect(own.entries.map((e) => e.comment).sort()).toEqual(["The Lamp", "Tomas"]);
    // Each entry remembers where it came from.
    expect(world.entries.find((e) => e.comment === "The Salt Guild")!.extra.source).toMatchObject({ state: "kept", bookId: book });
    expect(world.entries.find((e) => e.comment === "The campus radio station")!.extra.source).toMatchObject({ state: "new", entryId: null });
    // The original's book is untouched.
    expect(getLorebook(book)!.entries).toHaveLength(5);
    // Saving again adds new entries to the same two books.
    expect(() => commitVersionLore(d.id)).toThrow("Nothing new");
    const { item } = addItem(d.id, { title: "The night bus", type: "item" });
    patchItem(d.id, item.id, { entry: { content: "The last bus home.", keys: ["night bus"], aliases: [], essentials: "", secrets: [] } });
    const again = commitVersionLore(d.id);
    expect(again.added).toBe(1);
    expect(getLorebook(own.id)!.entries).toHaveLength(3);
    // Compare shows each entry next to the original's.
    const cmp = loreComparison("character", version);
    expect(cmp.find((x) => x.title === "Ellis Campus")).toMatchObject({ state: "changed", from: "Port Ellis", original: "A harbour town under a lighthouse." });
  });

  test("a version copied by hand (no map): every entry is translated; personas work the same way", async () => {
    const persona = createPersona({ name: "Ash", data: { description: "A courier." } });
    createLorebook({ name: "Ash's past", entries: [defaultEntry({ comment: "The depot", keys: ["depot"], content: "Where Ash picks up parcels.", extra: { type: "location" } })], links: [{ target_type: "persona", target_id: persona }] });
    const v = copyAsVersion("persona", persona, { label: "1920s Chicago", kind: "era" });
    const d = createVersionLore("persona", v);
    expect(d.version!.plan).toMatchObject({ originName: "Ash", label: "1920s Chicago", premise: "1920s Chicago." });
    expect(d.items).toHaveLength(1);
    expect(d.items[0]).toMatchObject({ title: "The depot", status: "planned", versionSource: { state: "changed" } });
    queueWrite(d.id);
    await runStudioJob(d.id);
    const r = commitVersionLore(d.id);
    expect(linkedBooks("persona", v).map((b) => b.id)).toEqual(r.bookIds);
  });

  test("routes: start from a version, from the creator's button, save, and compare with entries", async () => {
    const { version, creatorId, origin } = mirasVersion();
    const made = await api("POST", "/api/lore-studio/version", { kind: "character", id: version });
    expect(made.status).toBe(201);
    expect(made.json.draft.version.id).toBe(version);
    const fromCreator = await api("POST", `/api/creator/${creatorId}/companion`);
    expect(mustDraft(fromCreator.json.loreDraftId).source.kind).toBe("version");
    queueWrite(made.json.draft.id);
    await runStudioJob(made.json.draft.id);
    const saved = await api("POST", `/api/lore-studio/${made.json.draft.id}/commit`, { name: "ignored" });
    expect(saved.json.bookIds).toHaveLength(2);
    const cmp = await api("GET", `/api/characters/${version}/compare`);
    expect(cmp.json.entries.length).toBeGreaterThan(0);
    // Not a version: refused.
    expect((await api("POST", "/api/lore-studio/version", { kind: "character", id: origin })).status).toBe(400);
  });
});
