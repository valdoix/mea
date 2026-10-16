import { beforeAll, describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import { emptyCard } from "../src/cards/card";
import { run } from "../src/db/db";
import { createCreatorDraft, saveCreator } from "../src/creator/creator";
import { createLorebook, linkedBooks } from "../src/lore/service";
import { defaultEntry } from "../src/lore/types";
import { createCharacter, exportCharacter, getCard, softDeleteCharacter, updateCharacter } from "../src/services/characters";
import { createChat } from "../src/services/chats";
import { compareWithOriginal, copyAsVersion, detachVersion, linkInfo, linkVersion, listLinkedVersions } from "../src/services/linked";
import { createPersona, getPersona, updatePersona } from "../src/services/personas";
import { createVariant, listVariants } from "../src/services/variants";
import { freshDb, ownGreeting } from "./helpers";

let app: ReturnType<typeof createApp>;
const local = { requestIP: () => ({ address: "127.0.0.1", family: "IPv4", port: 5000 }) };
async function api<T = any>(method: string, path: string, body?: unknown): Promise<{ status: number; json: T }> {
  const res = await app.fetch(new Request(`http://localhost${path}`, { method, headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined }), local);
  const text = await res.text();
  let json: T;
  try {
    json = JSON.parse(text) as T;
  } catch {
    json = text as T;
  }
  return { status: res.status, json };
}

const mira = () =>
  createCharacter({ ...emptyCard("Mira"), description: "A lighthouse keeper on a northern rock.", personality: "Dry, watchful.", first_mes: "The lamp is lit." }, { tags: ["sea"], mode: "companion" });

beforeAll(() => {
  freshDb();
  app = createApp();
});

describe("linked versions (docs/14, part 1)", () => {
  test("copying makes a whole card of its own, linked to the original, sharing its lorebooks", () => {
    const origin = mira();
    const book = createLorebook({ name: "The Rock", entries: [{ ...defaultEntry(), keys: ["lamp"], content: "The lamp never goes out." }], links: [{ target_type: "character", target_id: origin }] });
    const id = copyAsVersion("character", origin, { kind: "au", label: "College AU", anchors: ["Dry humour"] });
    expect(id).not.toBe(origin);
    expect(getCard(id)!.description).toBe(getCard(origin)!.description);
    expect(linkedBooks("character", id).map((b) => b.id)).toEqual([book]);
    const info = linkInfo("character", id)!;
    expect(info.origin?.id).toBe(origin);
    expect(info).toMatchObject({ kind: "au", label: "College AU", anchors: ["Dry humour"] });
    expect(listLinkedVersions("character", origin).map((v) => v.id)).toEqual([id]);
    // Editing the version leaves the original alone.
    updateCharacter(id, { card: { ...getCard(id)!, description: "A sophomore who runs the campus radio." } });
    expect(getCard(origin)!.description).toContain("lighthouse");
  });

  test("a version chats and exports on its own, with its lore inside", async () => {
    const origin = mira();
    createLorebook({ name: "The Rock", entries: [{ ...defaultEntry(), keys: ["lamp"], content: "The lamp never goes out." }], links: [{ target_type: "character", target_id: origin }] });
    const id = copyAsVersion("character", origin, { label: "Ten years later" });
    const chat = createChat({ characterId: id });
    expect(chat.title).toContain("Mira");
    const out = (await exportCharacter(id, "json"))!;
    const card = JSON.parse(new TextDecoder().decode(out.bytes));
    expect(card.data.character_book.entries[0].content).toContain("lamp");
  });

  test("compare shows the fields that differ and the books each one uses", () => {
    const origin = mira();
    const id = copyAsVersion("character", origin, { label: "Modern" });
    updateCharacter(id, { card: { ...getCard(id)!, scenario: "A city apartment." } });
    const own = createLorebook({ name: "The City", entries: [], links: [{ target_type: "character", target_id: id }] });
    const cmp = compareWithOriginal("character", id);
    expect(cmp.fields.find((f) => f.key === "scenario")).toMatchObject({ same: false, original: "", version: "A city apartment." });
    expect(cmp.fields.find((f) => f.key === "description")?.same).toBe(true);
    expect(cmp.books.versionOnly.map((b) => b.id)).toEqual([own]);
  });

  test("detach cuts the link; loops are refused", () => {
    const origin = mira();
    const id = copyAsVersion("character", origin);
    expect(() => linkVersion("character", origin, id)).toThrow();
    expect(() => linkVersion("character", id, id)).toThrow();
    detachVersion("character", id);
    expect(linkInfo("character", id)!.origin).toBeNull();
    expect(listLinkedVersions("character", origin)).toEqual([]);
    // It can be linked again.
    linkVersion("character", id, origin, { label: "Back" });
    expect(linkInfo("character", id)!.origin?.id).toBe(origin);
  });

  test("an original in the Trash keeps its versions linked; deleting it for good detaches them", () => {
    const origin = mira();
    const id = copyAsVersion("character", origin);
    softDeleteCharacter(origin);
    expect(linkInfo("character", id)!.origin).toMatchObject({ id: origin, inTrash: true });
    run("DELETE FROM characters WHERE id = ?", origin);
    expect(linkInfo("character", id)!.origin).toBeNull();
    expect(getCard(id)!.name).toBe("Mira");
  });

  test("persona versions work the same way", () => {
    const origin = createPersona({ name: "Ash", data: { description: "A courier.", pronouns: "they/them/their" } });
    const id = copyAsVersion("persona", origin, { kind: "era", label: "1920s Chicago" });
    expect(getPersona(id)!.data.description).toBe("A courier.");
    expect(getPersona(id)!.isDefault).toBe(false);
    updatePersona(id, { data: { description: "A bootlegger's runner." } });
    const cmp = compareWithOriginal("persona", id);
    expect(cmp.fields.find((f) => f.key === "description")).toMatchObject({ original: "A courier.", version: "A bootlegger's runner.", same: false });
    expect(linkInfo("persona", origin)!.versions.map((v) => v.label)).toEqual(["1920s Chicago"]);
  });

  test("Looks are untouched", () => {
    const origin = mira();
    const look = createVariant("character", origin, { name: "Winter coat", overlay: { description: "In a heavy coat." } });
    copyAsVersion("character", origin);
    expect(listVariants("character", origin).map((v) => v.id)).toEqual([look.id]);
  });

  test("the creator saves a rebuild as a linked version, once", () => {
    const origin = mira();
    const d = createCreatorDraft({ kind: "character", baseId: origin, asVersion: { kind: "whatif", label: "Never left the city" } });
    expect(d.origin?.versionOf?.id).toBe(origin);
    const id = saveCreator(ownGreeting(d.id)).id;
    expect(id).not.toBe(origin);
    expect(linkInfo("character", id)).toMatchObject({ origin: { id: origin }, kind: "whatif", label: "Never left the city" });
    // Saving again updates the same version.
    saveCreator(ownGreeting(d.id));
    expect(listLinkedVersions("character", origin).map((v) => v.id)).toEqual([id]);
  });

  test("routes: family, link, detach, compare, and library payloads", async () => {
    const origin = mira();
    const made = await api("POST", `/api/characters/${origin}/family`, { label: "College AU", kind: "au" });
    expect(made.status).toBe(201);
    const id = made.json.id as string;
    expect((await api("GET", `/api/characters/${id}`)).json.link.origin.id).toBe(origin);
    expect((await api("GET", `/api/characters/${origin}/family`)).json.versions[0].id).toBe(id);
    const list = (await api("GET", "/api/characters")).json.characters as { id: string; version: { originId: string; label: string } | null }[];
    expect(list.find((c) => c.id === id)?.version).toMatchObject({ originId: origin, label: "College AU" });
    expect(list.find((c) => c.id === origin)?.version).toBeNull();
    expect((await api("PUT", `/api/characters/${id}/link`, { anchors: ["Watchful"] })).json.anchors).toEqual(["Watchful"]);
    expect((await api("GET", `/api/characters/${id}/compare`)).json.originId).toBe(origin);
    expect((await api("DELETE", `/api/characters/${origin}`)).json.versions).toBe(1);
    expect((await api("POST", `/api/characters/${id}/detach`)).json.originId).toBe(origin);
    expect((await api("GET", `/api/characters/${id}/compare`)).status).toBe(400);
    // History keeps its own route.
    expect((await api("GET", `/api/characters/${id}/versions`)).json.versions).toBeArray();
    const p = createPersona({ name: "Ash" });
    const pv = await api("POST", `/api/personas/${p}/family`, { label: "Vampire" });
    expect((await api("GET", "/api/personas")).json.personas.find((x: { id: string }) => x.id === pv.json.id).version.originId).toBe(p);
  });
});
