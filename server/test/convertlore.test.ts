import { beforeAll, describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import { CATEGORY_INFO } from "../src/lore/format";
import { readLorebook } from "../src/lore/formats";
import { createLorebook, getLorebook } from "../src/lore/service";
import { commitDraft, createDraft, getDraft, patchDraft, previewConvert, queueWrite, runStudioJob } from "../src/lore/studio";
import { defaultEntry } from "../src/lore/types";
import { createConnection, createProfile, syncModels } from "../src/services/connections";
import { registerJob } from "../src/services/jobs";
import { freshDb } from "./helpers";

let app: ReturnType<typeof createApp>;
const local = { requestIP: () => ({ address: "127.0.0.1", family: "IPv4", port: 5000 }) };
async function api<T = any>(method: string, path: string, body?: unknown): Promise<{ status: number; json: T }> {
  const res = await app.fetch(new Request(`http://localhost${path}`, { method, headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined }), local);
  return { status: res.status, json: (await res.json()) as T };
}

beforeAll(async () => {
  freshDb();
  for (const kind of ["lore.studio", "lore.embed", "lore.details"]) registerJob(kind, async () => {});
  app = createApp();
  const conn = createConnection({ name: "Mock", kind: "mock", billing: "subscription" });
  await syncModels(conn);
  createProfile({ name: "Story", connectionId: conn, modelId: "mock/storyteller", params: { context_target: 4000 } });
});

const ST = {
  name: "Salt Coast",
  description: "A cold coast.",
  entries: {
    "0": { uid: 0, key: ["Port Ellis", "the harbour"], comment: "Port Ellis", content: "A harbour town under the lighthouse.", order: 7, position: 1, group: "towns", stCustom: 1 },
    "1": { uid: 1, key: ["Mira"], comment: "Voice: Mira", content: "Mira speaks in short, dry sentences and calls everyone 'sailor'.", order: 3, position: 0 },
  },
};
const NOVELAI = {
  lorebookVersion: 5,
  name: "Fogbound",
  categories: [{ id: "c1", name: "Places" }],
  entries: [
    { displayName: "The Gray Heron", text: "A ship that left and never came back.", keys: ["Gray Heron", "the Heron"], enabled: true, category: "c1", contextConfig: { budgetPriority: 400 } },
    { displayName: "Magic", text: "Salt magic costs memories.", keys: ["salt magic"], forceActivation: true },
  ],
};
const AGNAI = { kind: "memory", name: "Agnai book", description: "From Agnai.", entries: [{ name: "The Salt Guild", entry: "The guild owns the docks.", keywords: ["Salt Guild"], priority: 50, weight: 10, enabled: true }] };
const RISU = {
  type: "risu",
  ver: 1,
  data: [
    { key: "f1", comment: "People", mode: "folder", content: "" },
    { key: "Tobias, Toby", secondkey: "", content: "Mira's brother, lost at sea.", comment: "Tobias", mode: "normal", insertorder: 120, alwaysActive: false, selective: false, folder: "f1" },
  ],
};

describe("lorebooks from other apps", () => {
  test("reads each format, keeps what it doesn't know, and says which it was", () => {
    const st = readLorebook(ST);
    expect(st.format).toBe("sillytavern");
    expect(st.entries[0]!.extra.stCustom).toBe(1);

    const nai = readLorebook(NOVELAI);
    expect(nai.format).toBe("novelai");
    expect(nai.name).toBe("Fogbound");
    expect(nai.entries[0]).toMatchObject({ comment: "The Gray Heron", keys: ["Gray Heron", "the Heron"], content: "A ship that left and never came back." });
    expect(nai.entries[0]!.extra.folder).toBe("Places");
    expect(nai.entries[1]!.constant).toBe(true);

    const ag = readLorebook(AGNAI);
    expect(ag.format).toBe("agnai");
    expect(ag.entries[0]).toMatchObject({ comment: "The Salt Guild", content: "The guild owns the docks.", order: 50 });

    const risu = readLorebook(RISU);
    expect(risu.format).toBe("risu");
    expect(risu.entries).toHaveLength(1);
    expect(risu.entries[0]).toMatchObject({ comment: "Tobias", keys: ["Tobias", "Toby"], order: 120 });
    expect(risu.entries[0]!.extra.folder).toBe("People");

    const card = readLorebook({ spec: "chara_card_v3", data: { name: "Mira", character_book: { entries: [{ keys: ["lamp"], content: "The lamp never goes out.", enabled: true, insertion_order: 10 }] } } });
    expect(card.format).toBe("card");
    expect(card.name).toBe("Mira's lore");

    const list = readLorebook([{ title: "Fog", text: "The fog keeps secrets.", triggers: ["fog"] }]);
    expect(list.format).toBe("list");
    expect(list.entries[0]).toMatchObject({ comment: "Fog", keys: ["fog"], content: "The fog keeps secrets." });

    expect(() => readLorebook({ hello: "world" })).toThrow();
    expect(() => readLorebook({ spec: "chara_card_v2", data: { name: "X", character_book: { entries: [] } } })).toThrow("no lorebook");
  });

  test("Lorebooks › Import takes a NovelAI file too", async () => {
    const form = new FormData();
    form.append("file", new File([JSON.stringify(NOVELAI)], "fog.lorebook", { type: "application/json" }));
    const res = await app.fetch(new Request("http://localhost/api/lorebooks/import", { method: "POST", body: form }), local);
    expect(res.status).toBe(201);
    const book = (await res.json()) as { entries: { comment: string }[] };
    expect(book.entries.map((e) => e.comment)).toEqual(["The Gray Heron", "Magic"]);
  });
});

describe("the studio converts a lorebook into Mea's format", () => {
  test("a preview names the format and the kinds", async () => {
    const r = await api("POST", "/api/lore-studio/convert-preview", { text: JSON.stringify(ST), fileName: "salt.json" });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ format: "sillytavern", name: "Salt Coast", count: 2 });
    expect(r.json.entries.find((e: { title: string }) => e.title === "Voice: Mira").kind).toBe("voice");
    expect((await api("POST", "/api/lore-studio/convert-preview", { text: "# not json" })).status).toBe(400);
  });

  test("a file becomes a drafted plan, and saving gives a Mea book with the original's settings", async () => {
    const { json } = await api("POST", "/api/lore-studio", { kind: "convert", text: JSON.stringify(ST), fileName: "salt.json" });
    const d = json.draft;
    expect(d.stage).toBe("review");
    expect(d.title).toBe("Salt Coast");
    expect(d.convert).toMatchObject({ format: "sillytavern", description: "A cold coast." });
    expect(d.items.every((i: { status: string }) => i.status === "drafted")).toBe(true);
    const voice = d.items.find((i: { title: string }) => i.title === "Voice: Mira");
    expect(voice.category).toBe("voice");

    const { bookId } = commitDraft(d.id);
    const book = getLorebook(bookId)!;
    expect(book.description).toBe("A cold coast.");
    const port = book.entries.find((e) => e.comment === "Port Ellis")!;
    // Mea's fields, Mea's place for its kind, and everything SillyTavern had besides.
    expect(port.extra.category).toBe("location");
    expect(port.extra.converted).toBe("sillytavern");
    expect(port.position).toBe(CATEGORY_INFO.location.position);
    expect(port.order).toBe(CATEGORY_INFO.location.order);
    expect(port.group).toBe("towns");
    expect(port.extra.stCustom).toBe(1);
    expect(port.keys).toEqual(["Port Ellis", "the harbour"]);
    const v = book.entries.find((e) => e.comment === "Voice: Mira")!;
    expect(v.extra.entity).toBe("Mira");

    // Saving again adds nothing.
    expect(() => commitDraft(d.id)).toThrow();
  });

  test("“Keep where it was” keeps the original's place in the prompt", () => {
    const d = createDraft({ kind: "convert", text: JSON.stringify(ST), fileName: "salt.json" });
    patchDraft(d.id, { options: { placement: "original" } });
    const book = getLorebook(commitDraft(d.id).bookId)!;
    const port = book.entries.find((e) => e.comment === "Port Ellis")!;
    expect(port.extra.category).toBe("location");
    expect(port).toMatchObject({ order: 7, position: "after_char" });
  });

  test("a book in Mea is converted in place, never copied", () => {
    const id = createLorebook({ name: "Old book", entries: [defaultEntry({ comment: "The Salt Guild", keys: ["Salt Guild"], content: "A guild that owns the docks.", order: 999 })] });
    const d = createDraft({ kind: "convert", refId: id });
    expect(d.targetBookId).toBe(id);
    expect(d.items[0]!.action).toBe("change");
    commitDraft(d.id);
    const book = getLorebook(id)!;
    expect(book.entries).toHaveLength(1);
    expect(book.entries[0]!.extra.category).toBe("faction");
    expect(book.entries[0]!.order).toBe(CATEGORY_INFO.faction.order);
  });

  test("“Shape for Mea” rewrites each entry from the original, keeping its keys", async () => {
    const d = createDraft({ kind: "convert", text: JSON.stringify(ST), fileName: "salt.json" });
    expect(d.options.faithful).toBe(true);
    queueWrite(d.id, { all: true });
    await runStudioJob(d.id);
    const after = getDraft(d.id)!;
    const port = after.items.find((i) => i.title === "Port Ellis")!;
    expect(port.status).toBe("drafted");
    expect(port.previous).not.toBeNull();
    expect(port.entry!.keys.slice(0, 2)).toEqual(["Port Ellis", "the harbour"]);
  });
});
