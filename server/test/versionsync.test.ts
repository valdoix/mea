import { beforeAll, describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import { emptyCard } from "../src/cards/card";
import { createCreatorDraft, mutateCreator, patchCreator, saveCreator } from "../src/creator/creator";
import { createLorebook, getLorebook, linkedBooks } from "../src/lore/service";
import { queueWrite, runStudioJob } from "../src/lore/studio";
import { defaultEntry } from "../src/lore/types";
import { commitVersionLore, createVersionLore } from "../src/lore/versionlore";
import { createCharacter, getCard, updateCharacter } from "../src/services/characters";
import { createConnection, createProfile, syncModels } from "../src/services/connections";
import { registerJob } from "../src/services/jobs";
import { copyAsVersion, linkInfo } from "../src/services/linked";
import { createPersona, getPersona, updatePersona } from "../src/services/personas";
import { restoreStash } from "../src/services/undo";
import { originChanges, setAutoSync, skipChanges, snapshotBasis, syncInfo, takeChanges, translateChange } from "../src/services/versionsync";
import { applyChange, checkChanges, undoStep } from "../src/meus/changes";
import { createChat } from "../src/services/chats";
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

/** Mira, and a version of her copied as she is. */
function mira() {
  const origin = createCharacter({ ...emptyCard("Mira"), description: "Mira keeps the lighthouse above Port Ellis.", personality: "Dry, tired, kind.", first_mes: "The lamp is lit." }, { mode: "companion" });
  const version = copyAsVersion("character", origin, { label: "College AU", kind: "au", name: "Mira (college)" });
  return { origin, version };
}
const editCard = (id: string, patch: Record<string, unknown>) => updateCharacter(id, { card: { ...getCard(id)!, ...patch } });

describe("changes from the original (docs/14, part 5)", () => {
  test("a kept field: the original's change shows, Take copies it across, Undo puts it back", () => {
    const { origin, version } = mira();
    expect(originChanges("character", version)).toEqual([]);
    editCard(origin, { personality: "Dry, tired, kind, and newly brave." });
    const changes = originChanges("character", version);
    expect(changes).toEqual([{ key: "field:personality", target: "field", label: "Personality", state: "kept", was: "Dry, tired, kind.", now: "Dry, tired, kind, and newly brave.", mine: "Dry, tired, kind." }]);
    expect(linkInfo("character", version)!.changes).toBe(1);
    const r = takeChanges("character", version, ["field:personality"]);
    expect(r.taken).toBe(1);
    expect(getCard(version)!.personality).toBe("Dry, tired, kind, and newly brave.");
    expect(originChanges("character", version)).toEqual([]);
    // Undo: the version is as it was, and the change waits again.
    restoreStash(r.undo);
    expect(getCard(version)!.personality).toBe("Dry, tired, kind.");
    expect(originChanges("character", version).map((c) => c.key)).toEqual(["field:personality"]);
  });

  test("a changed field asks to be translated: the new part goes through the map, the rest stays", async () => {
    const { origin, version } = mira();
    editCard(version, { description: "Mira runs the campus radio at Ellis College." });
    snapshotBasis("character", version); // as the studio does when it saves a version
    editCard(origin, { description: "Mira keeps the lighthouse above Port Ellis.\nShe has a cat called Pilot." });
    const [c] = originChanges("character", version);
    expect(c).toMatchObject({ key: "field:description", state: "changed", mine: "Mira runs the campus radio at Ellis College." });
    expect(() => takeChanges("character", version, ["field:description"])).toThrow(/translate it first/);
    const t = await translateChange("character", version, "field:description");
    expect(t.before).toBe("Mira runs the campus radio at Ellis College.");
    expect(t.text).toBe("Mira runs the campus radio at Ellis College. (Translated: She has a cat called Pilot.)");
    takeChanges("character", version, ["field:description"], { "field:description": t.text });
    expect(getCard(version)!.description).toBe(t.text);
    expect(originChanges("character", version)).toEqual([]);
    // Still a changed field: the original's next edit asks again.
    editCard(origin, { description: "Mira keeps the lighthouse.\nShe has a cat called Pilot." });
    expect(originChanges("character", version)[0]).toMatchObject({ key: "field:description", state: "changed" });
  });

  test("a field you edited in the version is its own: never offered, never overwritten", () => {
    const { origin, version } = mira();
    editCard(version, { personality: "Loud, rested, kind." });
    editCard(origin, { personality: "Dry, tired, kind, and newly brave.", first_mes: "The lamp is lit. Come in." });
    expect(originChanges("character", version).map((c) => c.key)).toEqual(["field:first_mes"]);
    setAutoSync("character", version, true);
    expect(getCard(version)!.personality).toBe("Loud, rested, kind.");
    expect(getCard(version)!.first_mes).toBe("The lamp is lit. Come in.");
  });

  test("Not for this version: the field becomes the version's own, and Undo takes that back", () => {
    const { origin, version } = mira();
    editCard(origin, { personality: "Sharper now." });
    const r = skipChanges("character", version, ["field:personality"]);
    expect(originChanges("character", version)).toEqual([]);
    editCard(origin, { personality: "Sharper still." });
    expect(originChanges("character", version)).toEqual([]);
    restoreStash(r.undo);
    expect(originChanges("character", version).map((c) => c.key)).toEqual(["field:personality"]);
  });

  test("auto-sync: saving the original updates kept fields at once; changed ones still ask", async () => {
    const { origin, version } = mira();
    editCard(version, { description: "Mira runs the campus radio." });
    snapshotBasis("character", version);
    expect((await api("PUT", `/api/characters/${version}/origin-changes`, { auto: true })).json.auto).toBe(true);
    const card = getCard(origin)!;
    await api("PUT", `/api/characters/${origin}`, { card: { ...card, personality: "Braver.", description: "Mira keeps two lighthouses." } });
    expect(getCard(version)!.personality).toBe("Braver.");
    expect(getCard(version)!.description).toBe("Mira runs the campus radio.");
    expect(syncInfo("character", version).changes.map((c) => c.key)).toEqual(["field:description"]);
  });

  test("a version made in the studio: unchanged fields are kept, rewritten ones changed", () => {
    const { origin } = mira();
    const d = createCreatorDraft({ kind: "character", baseId: origin, asVersion: { kind: "au", label: "Ten years later" }, idea: "" });
    mutateCreator(d.id, (cur) => {
      cur.fields.find((f) => f.key === "personality")!.value = "Older, softer, still dry.";
    });
    const version = saveCreator(d.id).id;
    editCard(origin, { personality: "Dry, tired, kind, brave.", first_mes: "The lamp is lit, always." });
    const by = Object.fromEntries(originChanges("character", version).map((c) => [c.key, c.state]));
    expect(by["field:first_mes"]).toBe("kept");
    expect(by["field:personality"]).toBe("changed");
  });

  test("lore: a kept entry's change is in the Inbox, one note per version; approving takes it", async () => {
    const origin = createCharacter({ ...emptyCard("Mira"), description: "Mira keeps the lighthouse above Port Ellis.", first_mes: "The lamp is lit." }, { mode: "companion" });
    const book = createLorebook({
      name: "The Salt Coast",
      entries: [
        defaultEntry({ comment: "Port Ellis", keys: ["Port Ellis"], content: "A harbour town under a lighthouse.", extra: { type: "location" } }),
        defaultEntry({ comment: "The Lamp", keys: ["lamp", "Mira"], content: "The great lamp, never out.", extra: { type: "item" } }),
      ],
      links: [{ target_type: "character", target_id: origin }],
    });
    const d = createCreatorDraft({ kind: "character", baseId: origin, asVersion: { kind: "au", label: "College AU" }, idea: "" });
    patchCreator(d.id, { name: "Mia", variant: { map: [{ from: "Port Ellis", type: "place", state: "changed", to: "Ellis Campus" }, { from: "The Lamp", type: "thing", state: "kept" }] } } as never);
    const version = saveCreator(d.id).id;
    const ld = createVersionLore("character", version);
    queueWrite(ld.id);
    await runStudioJob(ld.id);
    commitVersionLore(ld.id);
    const lamp = getLorebook(book)!.entries.find((e) => e.comment === "The Lamp")!;
    const mine = () => linkedBooks("character", version).flatMap((b) => getLorebook(b.id)!.entries).find((e) => e.comment === "The Lamp")!;
    expect(mine().content).toBe("The great lamp, never out.");
    // The original's entry changes, through the lorebook editor.
    const { id: _id, ...data } = lamp;
    await api("PUT", `/api/lorebooks/${book}/entries/${lamp.id}`, { ...data, content: "The great lamp, never out. Its lens came from Venice.", keys: ["lamp", "lens", "Mira"] });
    const changes = originChanges("character", version);
    expect(changes).toEqual([expect.objectContaining({ key: `entry:${mine().id}`, target: "entry", state: "kept", label: "The Lamp", now: "The great lamp, never out. Its lens came from Venice." })]);
    const inbox = (await api("GET", "/api/inbox")).json.items.filter((i: { key: string }) => i.key === `version:character:${version}`);
    expect(inbox).toHaveLength(1);
    expect(inbox[0]).toMatchObject({ key: `version:character:${version}`, source: "versions", chatId: "", title: "Mira changed: 1 lore entry", link: `/character/${version}` });
    expect((await api("POST", "/api/inbox/act", { key: inbox[0].key, action: "accept" })).status).toBe(200);
    expect(mine().content).toBe("The great lamp, never out. Its lens came from Venice.");
    // The original's name stays out of the version's keys.
    expect(mine().keys).toEqual(["lamp", "lens"]);
    expect(originChanges("character", version)).toEqual([]);
    // Editing the version's own entry makes it its own.
    const m = mine();
    const { id: mid, ...md } = m;
    const vbook = linkedBooks("character", version).find((b) => getLorebook(b.id)!.entries.some((e) => e.id === mid))!.id;
    await api("PUT", `/api/lorebooks/${vbook}/entries/${mid}`, { ...md, content: "Our lamp is a desk lamp." });
    await api("PUT", `/api/lorebooks/${book}/entries/${lamp.id}`, { ...data, content: "Changed again." });
    expect(originChanges("character", version)).toEqual([]);
  });

  test("personas, and the routes", async () => {
    const origin = createPersona({ name: "Ash", data: { description: "A courier.", background: "Grew up on the docks." } });
    const version = (await api("POST", `/api/personas/${origin}/family`, { label: "Ten years later", kind: "skip" })).json.id as string;
    updatePersona(origin, { data: { background: "Grew up on the docks; ran away at twelve." } });
    const info = (await api("GET", `/api/personas/${version}/origin-changes`)).json;
    expect(info).toMatchObject({ origin: { id: origin, name: "Ash" }, auto: false, changes: [{ key: "field:background", state: "kept" }] });
    const t = (await api("POST", `/api/personas/${version}/origin-changes/translate`, { key: "field:background" })).json;
    expect(t.text).toContain("Translated: Grew up on the docks; ran away at twelve.");
    const taken = (await api("POST", `/api/personas/${version}/origin-changes/take`, { keys: ["field:background"] })).json;
    expect(taken).toMatchObject({ taken: 1, changes: [] });
    expect(typeof taken.undo).toBe("string");
    expect(getPersona(version)!.data.background).toBe("Grew up on the docks; ran away at twelve.");
    expect((await api("POST", `/api/undo/${taken.undo}`)).status).toBe(200);
    expect(getPersona(version)!.data.background).toBe("Grew up on the docks.");
    expect((await api("POST", `/api/personas/${version}/origin-changes/skip`, { keys: ["field:background"] })).json).toMatchObject({ skipped: 1, changes: [] });
    expect((await api("POST", `/api/personas/${version}/origin-changes/take`, { keys: ["field:background"] })).status).toBe(404);
    expect((await api("GET", `/api/personas/${origin}/origin-changes`)).json).toMatchObject({ origin: null, changes: [] });
  });

  test("Meus: version_sync takes or skips a kept change for the chat's version, and Undo takes it back", () => {
    const { origin, version } = mira();
    editCard(version, { description: "Mira runs the campus radio." });
    snapshotBasis("character", version);
    editCard(origin, { personality: "Braver.", description: "Mira keeps two lighthouses." });
    const chatId = createChat({ characterId: version }).id;
    const { changes, dropped } = checkChanges(chatId, [
      { kind: "version_sync", who: "character", key: "field:personality", action: "take" },
      { kind: "version_sync", who: "character", key: "field:description", action: "take" },
      { kind: "version_sync", who: "character", key: "field:nothing", action: "take" },
    ]);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ kind: "version_sync", target: version, before: "Dry, tired, kind.", after: "Braver." });
    expect(dropped).toEqual(["Description was changed for this version: translate it on the version's page", "there's no change from the original field:nothing"]);
    const steps = applyChange(chatId, { ...changes[0]!, id: "c1" });
    expect(getCard(version)!.personality).toBe("Braver.");
    for (const s of steps.reverse()) undoStep(chatId, s);
    expect(getCard(version)!.personality).toBe("Dry, tired, kind.");
  });
});
