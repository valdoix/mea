import { beforeAll, describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import { normalizeCard } from "../src/cards/card";
import { checkExamples, checkGreeting } from "../src/creator/checks";
import {
  checkBible,
  companionLore,
  createCreatorDraft,
  creatorReadback,
  deepenCreator,
  expandCreator,
  getCreatorDraft,
  patchCreator,
  queueFields,
  restoreField,
  reviewCreator,
  rewriteBibleSection,
  runCreatorJob,
  saveCreator,
  writeBible,
} from "../src/creator/creator";
import { worldContext } from "../src/creator/world";
import { createLorebook, linkedBooks } from "../src/lore/service";
import { createDraft as createLoreDraft, commitDraft, deepenLore, expandLore, getDraft as getLoreDraft, planOutline, queueWrite, runStudioJob } from "../src/lore/studio";
import { defaultEntry } from "../src/lore/types";
import { createCharacter, getCard, getCharacterRow, listVersions } from "../src/services/characters";
import { createConnection, createProfile, syncModels } from "../src/services/connections";
import { registerJob } from "../src/services/jobs";
import { getPersona } from "../src/services/personas";
import { freshDb } from "./helpers";

let app: ReturnType<typeof createApp>;
let worldId = "";
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
  worldId = createLorebook({
    name: "The Salt Coast",
    entries: [
      defaultEntry({ comment: "Ground truth", constant: true, content: "Magic costs memories. Nobody counts aloud at sea." }),
      defaultEntry({ comment: "Port Ellis", keys: ["Port Ellis"], content: "A harbour town under a lighthouse. Cold all year.", extra: { type: "location" } }),
    ],
  });
});

describe("expand my idea", () => {
  test("in the Lore Studio: the idea becomes sections, which feed the plan; sections go deeper and can be edited", async () => {
    const d = createLoreDraft({ kind: "idea", text: "Port Ellis, where the fog keeps secrets and the Salt Guild owns the docks." });
    const e = (await expandLore(d.id)).expansion!;
    expect(e.sections.map((s) => s.heading)).toEqual(["Premise", "Central tension", "Places", "Story hooks"]);
    expect(e.sections[0]!.text).toContain("Port Ellis");
    expect(e.use).toBe(true);
    const deeper = (await deepenLore(d.id, e.sections[1]!.id)).expansion!.sections[1]!.text;
    expect(deeper).toContain("Deeper:");
    // A rework keeps sections in outline order and sees the current version.
    expect((await expandLore(d.id, "darker")).expansion!.sections[0]!.text).toContain("(reworked)");
    // Edits through the API, and the plan reads the expansion.
    const sid = getLoreDraft(d.id)!.expansion!.sections[0]!.id;
    await api("PUT", `/api/lore-studio/${d.id}`, { expansion: { sections: [{ id: sid, text: "A drowned bell rings under Port Ellis." }] } });
    expect(getLoreDraft(d.id)!.expansion!.sections[0]!.text).toBe("A drowned bell rings under Port Ellis.");
    const planned = await planOutline(d.id);
    expect(planned.items.map((i) => i.title)).toContain("Port Ellis");
    expect((await api("POST", `/api/lore-studio/${d.id}/expand`)).status).toBe(200);
  });
});

describe("the character creator", () => {
  test("idea → expand → questions → bible → check → fields → save, in a world", async () => {
    const d = createCreatorDraft({ kind: "character", idea: "Mira keeps the lighthouse above Port Ellis and owes the Salt Guild money.", name: "Mira", worldBookIds: [worldId], options: { greetings: 1 } });
    expect(d.fields.map((f) => f.key)).toEqual(["description", "personality", "scenario", "first_mes", "alt_1", "mes_example", "rules", "tags", "creator_notes"]);
    // The world is context for every step.
    expect(worldContext({ bookIds: [worldId] })).toContain("Magic costs memories");

    const ex = (await expandCreator(d.id)).expansion!;
    expect(ex.sections.map((s) => s.heading)).toEqual(["Concept", "Voice", "Wants and fears", "Story hooks"]);
    await deepenCreator(d.id, ex.sections[0]!.id, "her brother");

    const q = await creatorReadback(d.id);
    expect(q.stage).toBe("questions");
    patchCreator(d.id, { answers: { [q.questions[0]!.id]: "To be forgiven by her brother." } });

    const b = await writeBible(d.id);
    expect(b.stage).toBe("bible");
    expect(b.bible.map((s) => s.key)).toContain("voice");
    expect(b.bible.find((s) => s.key === "voice")!.text).toContain('"Sit.');
    // Your edits survive a rework; a section can be rewritten on its own.
    patchCreator(d.id, { bible: { flaws: "She lies to protect people, then can't keep the lies straight." } });
    expect((await writeBible(d.id, "darker")).bible.find((s) => s.key === "flaws")!.text).toContain("Reworked");
    expect((await rewriteBibleSection(d.id, "flaws", "make it hurt")).bible.find((s) => s.key === "flaws")!.text).toContain("make it hurt");

    patchCreator(d.id, { idea: "Mira keeps the lighthouse. MOCK_ISSUE MOCK_PUPPET" });
    const checked = await checkBible(d.id);
    expect(checked.bibleCheck).toEqual([{ section: "voice", problem: "The voice is flat.", fix: "Give them a verbal habit." }]);

    queueFields(d.id);
    await runCreatorJob(d.id);
    const w = getCreatorDraft(d.id)!;
    expect(w.fields.every((f) => f.status === "done" && f.value)).toBe(true);
    // The first greeting puppeted {{user}}; the retry named the problem and the result is clean.
    const greeting = w.fields.find((f) => f.key === "first_mes")!.value;
    expect(greeting).not.toContain("{{user}} nods");
    expect(checkGreeting(greeting, "third").some((i) => i.kind === "puppets-user")).toBe(false);
    expect(w.fields.find((f) => f.key === "tags")!.value).toBe("fantasy, harbour, mystery, slow burn");

    // Rewrite one field with a steer, then restore.
    queueFields(d.id, { keys: ["personality"], steer: "drier" });
    await runCreatorJob(d.id);
    expect(getCreatorDraft(d.id)!.fields.find((f) => f.key === "personality")!.value).toContain("(drier)");
    expect(restoreField(d.id, "personality").fields.find((f) => f.key === "personality")!.value).not.toContain("(drier)");

    const review = reviewCreator(d.id);
    expect(review.cost.permanent).toBeGreaterThan(0);
    // The two greetings open almost the same way.
    expect(review.issues.alt_1!.some((i) => i.kind === "repeats")).toBe(true);

    const saved = saveCreator(d.id);
    const card = getCard(saved.id)!;
    expect(card.name).toBe("Mira");
    expect(card.first_mes).toBe(greeting);
    expect(card.alternate_greetings).toHaveLength(1);
    expect(card.mes_example).toContain("<START>");
    expect(linkedBooks("character", saved.id).map((x) => x.id)).toContain(worldId);
    expect(getCharacterRow(saved.id)!.mode).toBe("companion");

    // Saving again updates the same card, keeping a version.
    patchCreator(d.id, { fields: { personality: "Dry, loyal, tired." } });
    expect(saveCreator(d.id).id).toBe(saved.id);
    expect(getCard(saved.id)!.personality).toBe("Dry, loyal, tired.");
    expect(listVersions(saved.id).length).toBeGreaterThan(0);

    // A companion lorebook from the bible (CHAR-18).
    const lore = companionLore(d.id);
    expect(lore.source.kind).toBe("character");
    expect(lore.source.text).toContain("THE CHARACTER BIBLE");
    expect(companionLore(d.id).id).toBe(lore.id);
  });

  test("checks: puppeting, point of view, example format", () => {
    expect(checkGreeting("{{user}} slowly nods. She waits.", "third").map((i) => i.kind)).toContain("puppets-user");
    expect(checkGreeting('She smiles. You feel warm inside. "Hi?"', "second").map((i) => i.kind)).toContain("puppets-user");
    expect(checkGreeting('I walk in. I sit. My hands shake. "Well?"', "third").map((i) => i.kind)).toContain("pov");
    expect(checkGreeting('"You nod too much," she says. "Sit?"', "third").map((i) => i.kind)).not.toContain("puppets-user");
    expect(checkExamples("{{user}}: hi\nMira: hello").map((i) => i.kind)).toEqual(["format", "format"]);
  });
});

describe("links between the creators", () => {
  test("a lore entry becomes a character; the world comes along; the entry links back", async () => {
    const lore = createLoreDraft({ kind: "idea", text: "Port Ellis and its harbourmaster Tamsin Reeve.", options: { size: "small" } });
    await planOutline(lore.id);
    queueWrite(lore.id);
    await runStudioJob(lore.id);
    const item = getLoreDraft(lore.id)!.items[0]!;
    const c = createCreatorDraft({ kind: "character", fromLore: { draftId: lore.id, itemId: item.id } });
    expect(c.name).toBe(item.title);
    expect(c.idea).toContain(item.entry!.content);
    // Not saved yet: the lore draft itself is the world.
    expect(c.loreDraftId).toBe(lore.id);
    expect(worldContext({ loreDraftId: lore.id })).toContain(item.title);
    expect(getLoreDraft(lore.id)!.items[0]!.links.creatorDraftId).toBe(c.id);

    // The lore is saved, then the character: it links to the saved book, and the entry links to the card.
    const book = commitDraft(lore.id, {});
    await writeBible(c.id);
    queueFields(c.id, { keys: ["description", "first_mes"] });
    await runCreatorJob(c.id);
    const saved = saveCreator(c.id);
    expect(linkedBooks("character", saved.id).map((x) => x.id)).toContain(book.bookId);
    expect(getLoreDraft(lore.id)!.items[0]!.links.characterId).toBe(saved.id);
  });

  test("character ↔ persona, persona saving, and reworking an existing card", async () => {
    const c = createCreatorDraft({ kind: "character", idea: "Wren, a cartographer who maps places that move.", worldBookIds: [worldId] });
    await writeBible(c.id);
    const p = createCreatorDraft({ kind: "persona", fromDraftId: c.id });
    expect(p.stage).toBe("bible");
    expect(p.worldBookIds).toEqual([worldId]);
    // Shared sections carry over; character-only ones don't.
    expect(p.bible.map((s) => s.key)).toContain("voice");
    expect(p.bible.map((s) => s.key)).not.toContain("hooks");
    expect(p.fields.map((f) => f.key)).toEqual(["description", "appearance", "personality", "background", "pronouns"]);
    await writeBible(p.id);
    queueFields(p.id);
    await runCreatorJob(p.id);
    const saved = saveCreator(p.id, { makeDefault: true });
    const persona = getPersona(saved.id)!;
    expect(persona.data.pronouns).toBe("she/her/her");
    expect(persona.isDefault).toBe(true);
    expect(linkedBooks("persona", saved.id).map((x) => x.id)).toContain(worldId);
    expect(companionLore(p.id).source.kind).toBe("persona");

    // Rework an existing card: its text is the idea, its world comes along, and saving updates it.
    const { data } = normalizeCard({ spec: "chara_card_v2", data: { name: "Old Joss", description: "Innkeeper of the Gull.", first_mes: "Hello." } });
    const id = createCharacter(data);
    const r = createCreatorDraft({ kind: "character", baseId: id, idea: "Make him warmer." });
    expect(r.name).toBe("Old Joss");
    expect(r.idea).toContain("Innkeeper of the Gull.");
    expect(r.idea).toContain("WHAT TO CHANGE: Make him warmer.");
    await writeBible(r.id);
    queueFields(r.id, { keys: ["description"] });
    await runCreatorJob(r.id);
    expect(saveCreator(r.id).id).toBe(id);
    expect(getCard(id)!.first_mes).toBe("Hello.");
    expect(getCard(id)!.description).toContain("Description of");
  });
});

describe("API", () => {
  test("the creator routes, end to end", async () => {
    const made = await api("POST", "/api/creator", { kind: "character", idea: "A tired ferryman who counts the dead.", worldBookIds: [worldId] });
    expect(made.status).toBe(201);
    const id = made.json.draft.id;
    expect((await api("GET", "/api/creator")).json.drafts.some((x: { id: string }) => x.id === id)).toBe(true);
    expect((await api("POST", `/api/creator/${id}/expand`)).json.draft.expansion.sections.length).toBe(4);
    // The read-back asks one question at a time.
    expect((await api("POST", `/api/creator/${id}/readback`)).json.draft.questions.length).toBe(1);
    expect((await api("POST", `/api/creator/${id}/write`)).status).toBe(400);
    expect((await api("POST", `/api/creator/${id}/bible`)).json.draft.bible.length).toBeGreaterThan(5);
    expect((await api("POST", `/api/creator/${id}/bible/check`)).json.draft.bibleCheck).toEqual([]);
    expect((await api("POST", `/api/creator/${id}/bible/voice`, { steer: "rougher" })).json.draft.bible.find((s: { key: string }) => s.key === "voice").text).toContain("rougher");
    expect((await api("PUT", `/api/creator/${id}`, { options: { greetings: 0, pov: "second" } })).json.draft.fields.some((f: { key: string }) => f.key.startsWith("alt_"))).toBe(false);
    expect((await api("POST", `/api/creator/${id}/write`)).json.draft.fields[0].status).toBe("queued");
    expect((await api("POST", `/api/creator/${id}/stop`)).json.draft.fields[0].status).toBe("empty");
    await api("PUT", `/api/creator/${id}`, { fields: { description: "A ferryman.", first_mes: 'He holds out a hand for the coin. "Fare?"' } });
    expect((await api("GET", `/api/creator/${id}/review`)).json.issues.first_mes.some((i: { kind: string }) => i.kind === "short")).toBe(true);
    const saved = await api("POST", `/api/creator/${id}/save`);
    expect(getCard(saved.json.id)!.description).toBe("A ferryman.");
    expect((await api("POST", `/api/creator/${id}/companion`)).json.loreDraftId).toBeTruthy();
    expect((await api("POST", "/api/creator/extend", { text: "She hates the sea." })).json.text).toContain("She hates the sea.");
    expect((await api("POST", "/api/creator", { kind: "persona" })).status).toBe(400);
    expect((await api("DELETE", `/api/creator/${id}`)).json.ok).toBe(true);
    expect((await api("GET", `/api/creator/${id}`)).status).toBe(404);
  });
});
