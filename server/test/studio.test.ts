import { beforeAll, describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import { normalizeCard } from "../src/cards/card";
import { all, one } from "../src/db/db";
import { aliasesIn, parseDocument } from "../src/lore/ingest";
import { checkEntries } from "../src/lore/quality";
import { createLorebook, getLorebook, linkedBooks } from "../src/lore/service";
import {
  commitDraft,
  consistencyCheck,
  createDraft,
  directions,
  getDraft,
  missingNames,
  patchDraft,
  patchItem,
  planOutline,
  queueWrite,
  readBack,
  restorePrevious,
  reviewDraft,
  runStudioJob,
  stopWrite,
} from "../src/lore/studio";
import { defaultEntry } from "../src/lore/types";
import { createCharacter } from "../src/services/characters";
import { createConnection, createProfile, syncModels } from "../src/services/connections";
import { registerJob } from "../src/services/jobs";
import { createPersona } from "../src/services/personas";
import { subscribe } from "../src/lib/events";
import { getSetting, setSetting } from "../src/lib/settings";
import { freshDb } from "./helpers";

let app: ReturnType<typeof createApp>;
let charId = "";
const local = { requestIP: () => ({ address: "127.0.0.1", family: "IPv4", port: 5000 }) };
async function api<T = any>(method: string, path: string, body?: unknown): Promise<{ status: number; json: T }> {
  const res = await app.fetch(new Request(`http://localhost${path}`, { method, headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined }), local);
  return { status: res.status, json: (await res.json()) as T };
}
const generations = () => one<{ n: number }>("SELECT COUNT(*) AS n FROM generations")!.n;

beforeAll(async () => {
  freshDb();
  // The test drives the writer itself; the queue's copy does nothing.
  for (const kind of ["lore.studio", "lore.embed"]) registerJob(kind, async () => {});
  app = createApp();
  const conn = createConnection({ name: "Mock", kind: "mock", billing: "subscription" });
  await syncModels(conn);
  createProfile({ name: "Story", connectionId: conn, modelId: "mock/storyteller", params: { context_target: 4000 } });
  const { data } = normalizeCard({ spec: "chara_card_v2", data: { name: "Mira", description: "Mira keeps the lighthouse above Port Ellis. Her brother Tobias left on the Gray Heron.", first_mes: "Welcome." } });
  charId = createCharacter(data);
});

describe("documents become draft entries (LORE-16)", () => {
  const md = `# The Salt Coast

A cold coast of fishing towns. Everyone owes someone.

## Places

### Port Ellis
A harbour town under the lighthouse. Also called the Old Port.

#### The Gull Inn
A crooked inn by the docks, run by Joss.

## People

### Joss
Innkeeper of the Gull Inn, known as Old Joss. Smuggles brandy.

## The Salt Guild
Controls the fish trade.
`;

  test("headings: title, overview, folders, parents and types", () => {
    const doc = parseDocument(md, "coast.md");
    expect(doc.shape).toBe("headings");
    expect(doc.title).toBe("The Salt Coast");
    expect(doc.overview).toContain("Everyone owes someone");
    const titles = doc.sections.map((s) => s.title);
    // "Places" and "People" have no text of their own: they are folders, not entries.
    expect(titles).toEqual(["Port Ellis", "The Gull Inn", "Joss", "The Salt Guild"]);
    const inn = doc.sections[1]!;
    expect(inn.folder).toBe("Places › Port Ellis");
    expect(doc.sections[inn.parent]?.title).toBe("Port Ellis");
    expect(doc.sections[0]!.type).toBe("location");
    expect(doc.sections[2]!.type).toBe("character");
    expect(doc.sections[3]!.type).toBe("faction");
  });

  test("glossaries and plain prose", () => {
    const g = parseDocument("Joss: the innkeeper.\nPort Ellis: a harbour town.\nThe Gray Heron — a lost ship.\nSalt Guild: traders.\n  They run the docks.", "terms.txt");
    expect(g.shape).toBe("glossary");
    expect(g.sections.map((s) => s.title)).toEqual(["Joss", "Port Ellis", "The Gray Heron", "Salt Guild"]);
    expect(g.sections[3]!.source).toContain("They run the docks.");
    const p = parseDocument("Port Ellis sits under the lighthouse. It is cold.\n\nThe Salt Guild runs the docks and the fish trade.", "notes.txt");
    expect(p.shape).toBe("prose");
    expect(p.sections[0]!.title).toBe("Port Ellis");
    expect(aliasesIn("The Gull Inn (the Gull)", "Locals call it the Rookery, also known as Gull House.")).toEqual(["the Gull", "Gull House"]);
  });

  test("a document draft needs no model call, and saves with parents and folders", () => {
    const before = generations();
    const d = createDraft({ kind: "document", text: md, fileName: "coast.md" });
    expect(generations()).toBe(before);
    expect(d.title).toBe("The Salt Coast");
    expect(d.stage).toBe("review");
    expect(d.items.every((i) => i.status === "drafted")).toBe(true);
    const joss = d.items.find((i) => i.title === "Joss")!;
    expect(joss.entry!.aliases).toContain("Old Joss");
    const r = commitDraft(d.id, {});
    const book = getLorebook(r.bookId)!;
    expect(book.name).toBe("The Salt Coast");
    // Four entries plus the always-on overview.
    expect(r.added).toBe(5);
    const overview = book.entries.find((e) => e.constant)!;
    expect(overview.content).toContain("Everyone owes someone");
    const port = book.entries.find((e) => e.comment === "Port Ellis")!;
    const inn = book.entries.find((e) => e.comment === "The Gull Inn")!;
    expect(inn.extra.parent).toBe(port.id);
    expect(inn.extra.folder).toBe("Places › Port Ellis");
    expect(inn.extra.type).toBe("location");
    // Saving again adds nothing new.
    expect(() => commitDraft(d.id, {})).toThrow("Nothing new to save");
  });
});

describe("quality checks", () => {
  test("generic keys, stock names and phrases, clashes, missing keys, length", () => {
    const issues = checkEntries(
      [
        { id: "a", title: "Elara", constant: false, content: "Elara is a testament to the rich history of the realm.", keys: ["Elara", "magic"], aliases: [], essentials: "", secrets: [] },
        { id: "b", title: "The Tower", constant: false, content: "x ".repeat(400), keys: ["Elara"], aliases: [], essentials: "", secrets: [{ text: "It is hollow.", knownBy: ["Nobody Here"] }] },
        { id: "c", title: "Rule", constant: false, content: "Iron burns the fae on touch, always and everywhere, without exception.", keys: [], aliases: [], essentials: "", secrets: [] },
      ],
      { existing: [{ title: "The Tower", keys: ["tower"] }], cast: ["Mira"] },
    );
    const kinds = (id: string) => issues[id]!.map((i) => i.kind);
    expect(kinds("a")).toEqual(expect.arrayContaining(["generic-key", "stock-name", "stock-phrase", "key-clash"]));
    expect(kinds("b")).toEqual(expect.arrayContaining(["long", "duplicate-title", "no-essentials", "secret-unknown", "key-clash"]));
    expect(kinds("c")).toContain("no-keys");
  });
});

describe("the studio flow: idea → questions → plan → write → review → save", () => {
  test("from an idea", async () => {
    const d = createDraft({ kind: "idea", text: "A harbour town called Port Ellis where the fog keeps secrets. The Salt Guild owns the docks.", options: { size: "small", tone: "quiet gothic" } });
    expect(d.stage).toBe("start");
    expect(d.options.secrets).toBe(true);

    // Read-back + interview.
    const rb = await readBack(d.id);
    expect(rb.stage).toBe("questions");
    expect(rb.readback?.understood).toContain("Port Ellis");
    expect(rb.questions.length).toBe(3);
    const q = rb.questions[0]!;
    patchDraft(d.id, { answers: { [q.id]: "The Salt Guild, and the harbourmaster wants it." } });
    // Asking again keeps the answered question.
    const again = await readBack(d.id);
    expect(again.questions.find((x) => x.id === q.id)?.answer).toContain("harbourmaster");

    // Stuck helper.
    expect((await directions(d.id, "darker")).directions).toHaveLength(3);

    // Plan.
    const planned = await planOutline(d.id);
    expect(planned.stage).toBe("plan");
    expect(planned.title).toBe("Mock World");
    expect(planned.overview).toContain("fog");
    const titles = planned.items.map((i) => i.title);
    expect(titles).toContain("Port Ellis");
    // The second planned item sits inside the first: the parent title became an item id.
    expect(planned.items[1]!.parent).toBe(planned.items[0]!.id);
    const more = await planOutline(d.id, { mode: "more", count: 3 });
    expect(more.items.length).toBeGreaterThan(planned.items.length);
    expect(new Set(more.items.map((i) => i.title.toLowerCase())).size).toBe(more.items.length);

    // Drop one, write the rest in the background.
    const dropped = more.items.at(-1)!;
    patchItem(d.id, dropped.id, { keep: false });
    const queued = queueWrite(d.id);
    expect(queued.stage).toBe("review");
    expect(queued.items.filter((i) => i.status === "queued").length).toBe(more.items.length - 1);
    await runStudioJob(d.id);
    const written = getDraft(d.id)!;
    expect(written.items.filter((i) => i.keep).every((i) => i.status === "drafted" && i.entry?.content)).toBe(true);
    expect(written.items.find((i) => i.id === dropped.id)!.entry).toBeNull();
    const port = written.items.find((i) => i.title === "Port Ellis")!;
    expect(port.entry!.keys[0]).toBe("Port Ellis");

    // Rewrite one with steering; the old draft can come back.
    queueWrite(d.id, { itemIds: [port.id], steer: "make it colder" });
    await runStudioJob(d.id);
    const rewritten = getDraft(d.id)!.items.find((i) => i.id === port.id)!;
    expect(rewritten.entry!.content).toContain("make it colder");
    expect(rewritten.previous).not.toBeNull();
    const restored = restorePrevious(d.id, port.id).items.find((i) => i.id === port.id)!;
    expect(restored.entry!.content).not.toContain("make it colder");

    // Stop leaves unwritten items planned.
    patchItem(d.id, dropped.id, { keep: true });
    queueWrite(d.id, { itemIds: [dropped.id] });
    expect(stopWrite(d.id).items.find((i) => i.id === dropped.id)!.status).toBe("planned");

    // Review.
    const review = reviewDraft(d.id);
    expect(review.cost.entries).toBe(more.items.length - 1);
    expect(review.cost.alwaysOnTokens).toBeGreaterThan(0);
    expect(Object.keys(review.issues).length).toBe(more.items.length - 1);
    expect((await consistencyCheck(d.id)).consistency).toEqual([]);

    // Save into a new global book.
    const saved = commitDraft(d.id, { links: [{ type: "global", id: "" }] });
    const book = getLorebook(saved.bookId)!;
    expect(book.name).toBe("Mock World");
    expect(book.links).toEqual([{ type: "global", id: "" }]);
    expect(book.entries.length).toBe(more.items.length);
    const second = book.entries.find((e) => e.comment === planned.items[1]!.title)!;
    expect(second.extra.parent).toBe(book.entries.find((e) => e.comment === planned.items[0]!.title)!.id);
    expect(getDraft(d.id)!.stage).toBe("done");

    // Writing the dropped one later and saving again adds only it.
    queueWrite(d.id, { itemIds: [dropped.id] });
    await runStudioJob(d.id);
    expect(commitDraft(d.id).added).toBe(1);
    expect(getLorebook(saved.bookId)!.entries.length).toBe(more.items.length + 1);
  });

  test("a companion lorebook from a card (CHAR-18) skips lore it already has, and links the character", async () => {
    createLorebook({ name: "Mira's lore", entries: [defaultEntry({ comment: "Port Ellis", keys: ["Port Ellis"], content: "A harbour town." })], links: [{ target_type: "character", target_id: charId }] });
    const d = createDraft({ kind: "character", refId: charId, options: { size: "small" } });
    expect(d.title).toBe("Mira's world");
    expect(d.source.text).toContain("Tobias");
    expect(d.links).toEqual([{ type: "character", id: charId }]);
    const planned = await planOutline(d.id);
    expect(planned.items.map((i) => i.title)).not.toContain("Port Ellis");
    expect(planned.items.map((i) => i.title)).toContain("Tobias");
    queueWrite(d.id);
    await runStudioJob(d.id);
    const r = commitDraft(d.id);
    expect(linkedBooks("character", charId).map((b) => b.id)).toContain(r.bookId);
    // No overview for a card: the card already says who they are.
    expect(getLorebook(r.bookId)!.entries.some((e) => e.constant)).toBe(false);
  });

  test("a persona lorebook (PER-03) links the persona", async () => {
    const pid = createPersona({ name: "Alex", data: { background: "Grew up in Brightmoor with a sister named Wren." } });
    const d = createDraft({ kind: "persona", refId: pid });
    expect(d.links).toEqual([{ type: "persona", id: pid }]);
    await planOutline(d.id);
    queueWrite(d.id);
    await runStudioJob(d.id);
    const r = commitDraft(d.id);
    expect(linkedBooks("persona", pid).map((b) => b.id)).toContain(r.bookId);
  });

  test("growing an existing book: gaps, existing parents, saves into it", async () => {
    const bookId = createLorebook({
      name: "Coast",
      entries: [
        defaultEntry({ comment: "Port Ellis", keys: ["Port Ellis"], content: "A harbour town. Captain Harrow runs the harbour. The Drowned Bell rings at night." }),
        defaultEntry({ comment: "The Lighthouse", keys: ["lighthouse"], content: "Above Port Ellis. Captain Harrow inspects it. Locals fear the Drowned Bell." }),
      ],
    });
    expect(missingNames(bookId)).toEqual(expect.arrayContaining(["Captain Harrow", "Drowned Bell"]));
    const d = createDraft({ kind: "book", refId: bookId });
    expect(d.targetBookId).toBe(bookId);
    expect(d.options.overview).toBe(false);
    const planned = await planOutline(d.id);
    expect(planned.items.map((i) => i.title)).not.toContain("Port Ellis");
    const portId = getLorebook(bookId)!.entries.find((e) => e.comment === "Port Ellis")!.id;
    patchItem(d.id, planned.items[0]!.id, { parent: `entry:${portId}` });
    queueWrite(d.id);
    await runStudioJob(d.id);
    const r = commitDraft(d.id);
    expect(r.bookId).toBe(bookId);
    const book = getLorebook(bookId)!;
    expect(book.entries.length).toBe(2 + planned.items.length);
    expect(book.entries.find((e) => e.comment === planned.items[0]!.title)!.extra.parent).toBe(portId);
  });
});

describe("API", () => {
  test("the routes, end to end", async () => {
    const made = await api("POST", "/api/lore-studio", { kind: "idea", text: "A floating market city named Vell." });
    expect(made.status).toBe(201);
    const id = made.json.draft.id;
    expect((await api("GET", "/api/lore-studio")).json.drafts.some((x: { id: string }) => x.id === id)).toBe(true);
    expect((await api("PUT", `/api/lore-studio/${id}`, { options: { size: "small", types: ["location", "faction"] }, title: "Vell" })).json.draft.options.types).toEqual(["location", "faction"]);
    expect((await api("POST", `/api/lore-studio/${id}/readback`)).json.draft.questions.length).toBeGreaterThan(0);
    const plan = (await api("POST", `/api/lore-studio/${id}/outline`)).json.draft;
    expect(plan.items.length).toBeGreaterThan(0);
    const added = await api("POST", `/api/lore-studio/${id}/items`, { title: "The Tide Clock", type: "item" });
    expect(added.status).toBe(201);
    const itemId = added.json.itemId;
    const edited = await api("PUT", `/api/lore-studio/${id}/items/${itemId}`, { entry: { content: "A clock that tells the tide.", keys: ["Tide Clock", "tide clock"], aliases: [], essentials: "", secrets: [] } });
    const item = edited.json.draft.items.find((i: { id: string }) => i.id === itemId);
    expect(item.status).toBe("drafted");
    // Keys are de-duplicated without regard to case.
    expect(item.entry.keys).toEqual(["tide clock"]);
    expect((await api("GET", `/api/lore-studio/${id}/review`)).json.cost.entries).toBe(1);
    expect((await api("POST", `/api/lore-studio/${id}/write`, { itemIds: [plan.items[0].id] })).json.draft.items[0].status).toBe("queued");
    expect((await api("POST", `/api/lore-studio/${id}/stop`)).json.draft.items[0].status).toBe("planned");
    const parsed = await api("POST", "/api/lore-studio/parse", { text: "## Vell\nA city.\n## Tide Clock\nA clock.", fileName: "vell.md" });
    expect(parsed.json.sections.map((s: { title: string }) => s.title)).toEqual(["Vell", "Tide Clock"]);
    const saved = await api("POST", `/api/lore-studio/${id}/commit`, { name: "Vell lore", overview: false });
    expect(saved.json.added).toBe(1);
    expect(getLorebook(saved.json.bookId)!.name).toBe("Vell lore");
    expect((await api("POST", `/api/lore-studio/${id}/commit`, {})).status).toBe(400);
    expect((await api("POST", "/api/lore-studio", { kind: "character" })).status).toBe(400);
    expect((await api("DELETE", `/api/lore-studio/${id}`)).json.ok).toBe(true);
    expect((await api("GET", `/api/lore-studio/${id}`)).status).toBe(404);
  });
});

describe("the studio's own profile", () => {
  test("a draft's pick, else Settings › Routing's, else the task's routing", async () => {
    const conn = one<{ id: string }>("SELECT id FROM connections LIMIT 1")!.id;
    const fast = createProfile({ name: "Fast", connectionId: conn, modelId: "mock/fast", params: {} });
    // The model of the one studio call since the last look.
    const seen = new Set<string>();
    const lastModel = () => {
      const rows = all<{ id: string; model_id: string }>("SELECT id, model_id FROM generations WHERE kind LIKE 'studio:%'").filter((r) => !seen.has(r.id));
      for (const r of rows) seen.add(r.id);
      return rows.length === 1 ? rows[0]!.model_id : `${rows.length} calls`;
    };
    lastModel();
    const d = createDraft({ kind: "idea", text: "A harbour town called Port Ellis where the fog keeps secrets." });

    await directions(d.id);
    expect(lastModel()).toBe("mock/storyteller");

    setSetting("routing.tasks", { ...getSetting("routing.tasks"), studio: fast });
    await directions(d.id);
    expect(lastModel()).toBe("mock/fast");

    const story = one<{ id: string }>("SELECT id FROM profiles WHERE name = 'Story'")!.id;
    const r = await api("PUT", `/api/lore-studio/${d.id}`, { options: { profileId: story } });
    expect(r.status).toBe(200);
    expect(getDraft(d.id)!.options.profileId).toBe(story);
    await directions(d.id);
    expect(lastModel()).toBe("mock/storyteller");

    // A deleted profile falls back to the routing.
    patchDraft(d.id, { options: { ...getDraft(d.id)!.options, profileId: "gone" } });
    await directions(d.id);
    expect(lastModel()).toBe("mock/fast");
    setSetting("routing.tasks", { ...getSetting("routing.tasks"), studio: null });
  });
});

describe("planning says which step it's on", () => {
  test("census, outline, then done", async () => {
    const d = createDraft({ kind: "idea", text: "A harbour town called Port Ellis where the fog keeps secrets. The Salt Guild owns the docks.", options: { size: "small" } });
    const steps: string[] = [];
    const stop = subscribe((e) => {
      if (e.type === "studio.step" && e.draftId === d.id) steps.push(e.step);
    });
    try {
      await planOutline(d.id);
    } finally {
      stop();
    }
    expect(steps[0]).toBe("Taking the census of the world…");
    expect(steps).toContain("Outlining…");
    expect(steps.at(-1)).toBe("");
  });

  test("a complete plan counts its batches", async () => {
    const d = createDraft({ kind: "idea", text: "A harbour town called Port Ellis where the fog keeps secrets.", options: { size: "complete" } });
    const steps: string[] = [];
    const stop = subscribe((e) => {
      if (e.type === "studio.step" && e.draftId === d.id) steps.push(e.step);
    });
    try {
      await planOutline(d.id);
    } finally {
      stop();
    }
    const outline = steps.filter((s) => s.startsWith("Outlining"));
    expect(outline[0]).toMatch(/^Outlining 1 of \d+…$/);
    expect(outline.at(-1)).toMatch(/^Outlining (\d+) of \1: the concepts/);
    expect(steps.at(-1)).toBe("");
  });
});
