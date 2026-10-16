import { beforeAll, describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import { emptyCard } from "../src/cards/card";
import { createCreatorDraft, getCreatorDraft, patchCreator, saveCreator } from "../src/creator/creator";
import { personaVersion } from "../src/creator/variant";
import { createLorebook, getLorebook, linkedBooks } from "../src/lore/service";
import { queueWrite, runStudioJob } from "../src/lore/studio";
import { defaultEntry } from "../src/lore/types";
import { commitVersionLore, createVersionLore } from "../src/lore/versionlore";
import { createCharacter, updateCharacter } from "../src/services/characters";
import { createConnection, createProfile, syncModels } from "../src/services/connections";
import { registerJob } from "../src/services/jobs";
import { copyAsVersion, detachVersion, linkInfo } from "../src/services/linked";
import { createPersona } from "../src/services/personas";
import { createUniverse, deleteUniverse, getUniverse, joinUniverse, leaveUniverse, listUniverses, membersOf, universeDetail, updateUniverse } from "../src/services/universes";
import { freshDb } from "./helpers";

let app: ReturnType<typeof createApp>;
const local = { requestIP: () => ({ address: "127.0.0.1", family: "IPv4", port: 5000 }) };
async function api<T = any>(method: string, path: string, body?: unknown): Promise<{ status: number; json: T }> {
  const res = await app.fetch(new Request(`http://localhost${path}`, { method, headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined }), local);
  return { status: res.status, json: (await res.json()) as T };
}

let persona = "";
beforeAll(async () => {
  freshDb();
  for (const kind of ["lore.studio", "lore.embed", "creator.write"]) registerJob(kind, async () => {});
  app = createApp();
  const conn = createConnection({ name: "Mock", kind: "mock", billing: "subscription" });
  await syncModels(conn);
  createProfile({ name: "Story", connectionId: conn, modelId: "mock/storyteller", params: { context_target: 4000 } });
  persona = createPersona({ name: "Ash", data: { description: "A courier." } });
});

/** Two people from the same harbour town, each with their own lorebook. */
function harbour() {
  const mira = createCharacter({ ...emptyCard("Mira"), description: "Mira keeps the lighthouse above Port Ellis.", first_mes: "The lamp is lit." }, { mode: "companion" });
  const jon = createCharacter({ ...emptyCard("Jon"), description: "Jon runs the forge in Port Ellis.", first_mes: "Sparks fly." }, { mode: "companion" });
  updateCharacter(mira, { defaultPersonaId: persona });
  createLorebook({ name: "Mira's coast", entries: [defaultEntry({ comment: "Port Ellis", keys: ["Port Ellis"], content: "A harbour town.", extra: { type: "location" } }), defaultEntry({ comment: "The Lamp", keys: ["lamp"], content: "Never out.", extra: { type: "item" } })], links: [{ target_type: "character", target_id: mira }] });
  createLorebook({ name: "Jon's coast", entries: [defaultEntry({ comment: "Port Ellis", keys: ["Port Ellis"], content: "Where the forge is.", extra: { type: "location" } }), defaultEntry({ comment: "The Salt Guild", keys: ["Salt Guild"], content: "Owns the docks.", extra: { type: "faction" } })], links: [{ target_type: "character", target_id: jon }] });
  return { mira, jon };
}

/** A version made in the studio, with a map row set by hand, saved. */
function studioVersion(origin: string, opts: { label?: string; universeId?: string | null; premise?: string; rows?: Parameters<typeof patchCreator>[1]["variant"] } = {}) {
  const d = createCreatorDraft({ kind: "character", baseId: origin, asVersion: { kind: "au", label: opts.label ?? "College AU", universeId: opts.universeId ?? null }, idea: opts.premise ?? "" });
  if (opts.rows) patchCreator(d.id, { variant: opts.rows });
  return { draftId: d.id, id: saveCreator(d.id).id };
}

describe("universes (docs/14, part 4)", () => {
  test("the service: create, rename, edit the map, list with members, delete", () => {
    const u = createUniverse({ name: "Neon city", premise: "Everyone lives in one arcology.", kind: "au" });
    expect(getUniverse(u.id)).toMatchObject({ name: "Neon city", premise: "Everyone lives in one arcology.", kind: "au", map: [], bookId: null });
    const edited = updateUniverse(u.id, { name: "Neon City", map: [{ from: "The sea", type: "place", state: "dropped" }] });
    expect(edited.map).toHaveLength(1);
    expect(listUniverses().find((x) => x.id === u.id)).toMatchObject({ name: "Neon City", rows: 1, members: [] });
    deleteUniverse(u.id);
    expect(getUniverse(u.id)).toBeUndefined();
  });

  test("saving a studio version makes a universe for it from its name, premise and map", () => {
    const { mira } = harbour();
    const v = studioVersion(mira, { premise: "She's at university.", rows: { map: [{ from: "Port Ellis", type: "place", state: "changed", to: "Ellis Campus" }] } });
    const info = linkInfo("character", v.id)!;
    expect(info.universe?.name).toBe("College AU");
    const u = universeDetail(info.universeId!);
    expect(u).toMatchObject({ premise: "She's at university.", kind: "au" });
    expect(u.map.find((r) => r.from === "Port Ellis")).toMatchObject({ state: "changed", to: "Ellis Campus" });
    expect(u.members.map((m) => [m.name, m.originName])).toEqual([["Mira", "Mira"]]);
    // The draft remembers it, so the persona's version can join.
    expect(getCreatorDraft(v.draftId)!.variant!.universeId).toBe(u.id);
  });

  test("a second character joins: the premise and map come along, and its own rows go into the shared map", () => {
    const { mira, jon } = harbour();
    const first = studioVersion(mira, { premise: "University.", rows: { map: [{ from: "Port Ellis", type: "place", state: "changed", to: "Ellis Campus" }, { from: "The Docks", type: "place" }] } });
    const universeId = linkInfo("character", first.id)!.universeId!;
    const d = createCreatorDraft({ kind: "character", baseId: jon, asVersion: { kind: "era", label: "Campus AU", universeId } });
    expect(d.variant).toMatchObject({ universeId, premise: "University.", kind: "au" });
    expect(d.variant!.map.find((r) => r.from === "Port Ellis")).toMatchObject({ state: "changed", to: "Ellis Campus" });
    // Jon decides a row the universe left open, and adds his own.
    const docks = d.variant!.map.find((r) => r.from === "The Docks")!;
    patchCreator(d.id, { variant: { map: [{ id: docks.id, state: "changed", to: "The quad" }, { from: "Jon's forge", type: "place", state: "changed", to: "The engineering lab" }] } });
    const second = saveCreator(d.id).id;
    const u = universeDetail(universeId);
    expect(u.members.map((m) => m.name).sort()).toEqual(["Jon", "Mira"]);
    expect(u.map.find((r) => r.from === "The Docks")).toMatchObject({ state: "changed", to: "The quad" });
    expect(u.map.find((r) => r.from === "Jon's forge")?.to).toBe("The engineering lab");
    expect(linkInfo("character", second)!.universeId).toBe(universeId);
    // Joining from a patch works too, and leaving the draft's universe keeps its rows.
    const d3 = createCreatorDraft({ kind: "character", baseId: jon, asVersion: { kind: "au" } });
    expect(patchCreator(d3.id, { variant: { universeId } }).variant!.map.length).toBeGreaterThan(0);
    expect(patchCreator(d3.id, { variant: { universeId: null } }).variant!.universeId).toBeNull();
  });

  test("world entries are written once, in the universe's book, linked to every member", async () => {
    const { mira, jon } = harbour();
    const a = studioVersion(mira, { rows: { map: [{ from: "Port Ellis", type: "place", state: "changed", to: "Ellis Campus" }] } });
    const universeId = linkInfo("character", a.id)!.universeId!;
    const b = studioVersion(jon, { label: "College AU", universeId });
    // Mira's lore: the universe's world book is made and gets her world entries.
    const la = createVersionLore("character", a.id);
    queueWrite(la.id);
    await runStudioJob(la.id);
    const ra = commitVersionLore(la.id);
    const u = getUniverse(universeId)!;
    expect(u.bookId).toBeTruthy();
    expect(ra.bookIds).toContain(u.bookId!);
    expect(getLorebook(u.bookId!)!.entries.map((e) => e.comment)).toEqual(["Ellis Campus"]);
    // Linked to both members, even the one that hasn't written its lore yet.
    expect(linkedBooks("character", a.id).map((x) => x.id)).toContain(u.bookId!);
    expect(linkedBooks("character", b.id).map((x) => x.id)).toContain(u.bookId!);
    // Jon's lore: Port Ellis is already in the world book, so it's left out; the Salt Guild is new to it.
    const lb = createVersionLore("character", b.id);
    expect(lb.items.find((i) => i.title === "Ellis Campus")).toMatchObject({ keep: false, pitch: "Already in College AU's world book." });
    queueWrite(lb.id);
    await runStudioJob(lb.id);
    commitVersionLore(lb.id);
    expect(getLorebook(u.bookId!)!.entries.map((e) => e.comment).sort()).toEqual(["Ellis Campus", "The Salt Guild"]);
  });

  test("the persona's version joins the character's universe", () => {
    const { mira } = harbour();
    const v = studioVersion(mira);
    const universeId = linkInfo("character", v.id)!.universeId!;
    const p = personaVersion(v.draftId);
    expect(p.variant!.universeId).toBe(universeId);
    const saved = saveCreator(p.id).id;
    expect(linkInfo("persona", saved)!.universeId).toBe(universeId);
    expect(membersOf(universeId).map((m) => m.kind).sort()).toEqual(["character", "persona"]);
  });

  test("leaving keeps a copy of the world; detaching leaves too; deleting the universe keeps the book linked", async () => {
    const { mira, jon } = harbour();
    const a = studioVersion(mira, { rows: { map: [{ from: "Port Ellis", type: "place", state: "changed", to: "Ellis Campus" }] } });
    const universeId = linkInfo("character", a.id)!.universeId!;
    const b = studioVersion(jon, { universeId });
    const la = createVersionLore("character", a.id);
    queueWrite(la.id);
    await runStudioJob(la.id);
    commitVersionLore(la.id);
    const bookId = getUniverse(universeId)!.bookId!;
    const left = leaveUniverse("character", b.id)!;
    expect(linkInfo("character", b.id)!.universeId).toBeNull();
    const mine = linkedBooks("character", b.id).map((x) => x.id);
    expect(mine).not.toContain(bookId);
    expect(mine).toContain(left.copyBookId!);
    expect(getLorebook(left.copyBookId!)!.entries.map((e) => e.comment)).toEqual(["Ellis Campus"]);
    // Joining again links the shared book back.
    joinUniverse("character", b.id, universeId);
    expect(linkedBooks("character", b.id).map((x) => x.id)).toContain(bookId);
    // Detaching an ordinary card out of its version leaves the universe.
    detachVersion("character", b.id);
    expect(membersOf(universeId).map((m) => m.id)).toEqual([a.id]);
    // Only a version can join.
    expect(() => joinUniverse("character", jon, universeId)).toThrow("Only a version");
    // Deleting the universe: Mira stays a version and keeps the world book.
    deleteUniverse(universeId);
    expect(linkInfo("character", a.id)).toMatchObject({ universeId: null, origin: { id: mira } });
    expect(linkedBooks("character", a.id).map((x) => x.id)).toContain(bookId);
  });

  test("routes: list, create, read, edit, join, leave, delete; a copied version can join", async () => {
    const { mira } = harbour();
    const made = await api("POST", "/api/universes", { name: "Space station", premise: "Everyone is in orbit.", kind: "au" });
    expect(made.status).toBe(201);
    const id = made.json.id as string;
    expect((await api("PUT", `/api/universes/${id}`, { map: [{ from: "The sea", type: "place", state: "changed", to: "The void" }] })).json.map).toHaveLength(1);
    const copy = copyAsVersion("character", mira, { label: "Orbit" });
    const joined = await api("POST", `/api/universes/${id}/join`, { kind: "character", id: copy });
    expect(joined.json.members.map((m: { id: string }) => m.id)).toEqual([copy]);
    expect((await api("GET", `/api/characters/${copy}`)).json.link.universe.name).toBe("Space station");
    expect((await api("GET", "/api/universes")).json.universes.some((u: { id: string }) => u.id === id)).toBe(true);
    expect((await api("POST", `/api/characters/${copy}/leave-universe`)).json.ok).toBe(true);
    expect((await api("GET", `/api/universes/${id}`)).json.members).toEqual([]);
    expect((await api("DELETE", `/api/universes/${id}`)).json.ok).toBe(true);
    expect((await api("GET", `/api/universes/${id}`)).status).toBe(404);
    // A studio version joining from its Versions panel brings its map into the shared map.
    const studio = studioVersion(mira, { label: "Orbit two", rows: { map: [{ from: "Port Ellis", type: "place", state: "changed", to: "Ring Ellis" }] } });
    const u3 = createUniverse({ name: "Orbit" });
    const j = await api("POST", `/api/universes/${u3.id}/join`, { kind: "character", id: studio.id });
    expect(j.json.map.find((r: { from: string }) => r.from === "Port Ellis")?.to).toBe("Ring Ellis");
    // The creator takes a universe when starting a version.
    const u2 = createUniverse({ name: "Noir", premise: "1940s, rain." });
    const d = await api("POST", "/api/creator", { kind: "character", baseId: mira, asVersion: { kind: "era", universeId: u2.id } });
    expect(d.json.draft.variant).toMatchObject({ universeId: u2.id, premise: "1940s, rain." });
  });
});
