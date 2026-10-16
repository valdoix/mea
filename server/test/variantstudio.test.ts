import { beforeAll, describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import { emptyCard } from "../src/cards/card";
import { checkBible, createCreatorDraft, draftLeaks, getCreatorDraft, patchCreator, queueFields, reviewCreator, rewriteBibleSection, runCreatorJob, saveCreator, variantFieldPlan, variantMarks, writeBible, writeVariantBible } from "../src/creator/creator";
import { buildMap, fillMap, personaVersion, premiseDirections, startVariant, anotherVariantQuestion } from "../src/creator/variant";
import { findLeaks, newRow } from "../src/creator/variantcore";
import { createLorebook } from "../src/lore/service";
import { defaultEntry } from "../src/lore/types";
import { createCharacter, getCard, updateCharacter } from "../src/services/characters";
import { createConnection, createProfile, syncModels } from "../src/services/connections";
import { registerJob } from "../src/services/jobs";
import { linkInfo } from "../src/services/linked";
import { createPersona, getPersona } from "../src/services/personas";
import { freshDb, ownGreeting } from "./helpers";

let app: ReturnType<typeof createApp>;
const local = { requestIP: () => ({ address: "127.0.0.1", family: "IPv4", port: 5000 }) };
async function api<T = any>(method: string, path: string, body?: unknown): Promise<{ status: number; json: T }> {
  const res = await app.fetch(new Request(`http://localhost${path}`, { method, headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined }), local);
  return { status: res.status, json: (await res.json()) as T };
}

let persona = "";
const mira = () => {
  const id = createCharacter({ ...emptyCard("Mira"), description: "Mira keeps the lighthouse above Port Ellis. Her brother Tomas left for the navy.", personality: "Dry, watchful.", scenario: "A storm night at the lighthouse.", first_mes: "The lamp is lit.", mes_example: "<START>\n{{user}}: Hi.\n{{char}}: \"Sit.\"" }, { mode: "companion" });
  createLorebook({ name: "The Salt Coast", entries: [defaultEntry({ comment: "Port Ellis", keys: ["Port Ellis"], content: "A harbour town under a lighthouse.", extra: { type: "location" } }), defaultEntry({ comment: "The Salt Guild", keys: ["Salt Guild"], content: "Owns the docks.", extra: { type: "faction" } })], links: [{ target_type: "character", target_id: id }] });
  updateCharacter(id, { defaultPersonaId: persona });
  return id;
};

beforeAll(async () => {
  freshDb();
  for (const kind of ["lore.studio", "lore.embed", "creator.write"]) registerJob(kind, async () => {});
  app = createApp();
  const conn = createConnection({ name: "Mock", kind: "mock", billing: "subscription" });
  await syncModels(conn);
  createProfile({ name: "Story", connectionId: conn, modelId: "mock/storyteller", params: { context_target: 4000 } });
  persona = createPersona({ name: "Ash", data: { description: "A courier who never sits still.", pronouns: "they/them/their" } });
});

describe("the variant studio (docs/14, part 2)", () => {
  test("a version draft keeps the original apart from the premise, and every step reads both", async () => {
    const origin = mira();
    const d = createCreatorDraft({ kind: "character", baseId: origin, asVersion: { kind: "au", label: "College AU" }, idea: "She's a sophomore who runs the campus radio." });
    expect(d.variant).toMatchObject({ originId: origin, originName: "Mira", kind: "au", label: "College AU", premise: "She's a sophomore who runs the campus radio.", originBible: null });
    expect(d.idea).toContain("lighthouse");
    expect(d.idea).not.toContain("WHAT TO CHANGE");
    // The world comes along.
    expect(d.worldBookIds.length).toBe(1);
    const took = await premiseDirections(d.id, "darker");
    expect(took.variant!.directions).toHaveLength(3);
    expect(took.variant!.directions[0]).toContain("darker");
  });

  test("start: anchors to tick and questions about the change, each with suggestions; another on request", async () => {
    const origin = mira();
    const d = createCreatorDraft({ kind: "character", baseId: origin, asVersion: { kind: "au", label: "College AU" }, idea: "Campus radio." });
    const s = await startVariant(d.id);
    expect(s.stage).toBe("questions");
    expect(s.variant!.anchors.map((a) => [a.text, a.kept])).toEqual([["Dry humour that covers fear", true], ["Keeps the lamp lit no matter what", true]]);
    expect(s.questions).toHaveLength(2);
    expect(s.questions[0]).toMatchObject({ section: "variant", suggestions: ["Ten years ago", "At birth", "Last winter"] });
    const more = await anotherVariantQuestion(d.id);
    expect(more.questions).toHaveLength(3);
    // Untick one, add your own, answer a question.
    const a = more.variant!.anchors[1]!;
    const p = patchCreator(d.id, { variant: { anchors: [{ id: a.id, kept: false }, { text: "Calls everyone by surname" }] }, answers: { [more.questions[0]!.id]: "Ten years ago" } });
    expect(p.variant!.anchors.filter((x) => x.kept).map((x) => x.text)).toEqual(["Dry humour that covers fear", "Calls everyone by surname"]);
    expect(p.questions[0]!.answer).toBe("Ten years ago");
    // A premise is needed to start.
    const empty = createCreatorDraft({ kind: "character", baseId: origin, asVersion: { kind: "era" } });
    await expect(startVariant(empty.id)).rejects.toThrow("premise");
  });

  test("the map: the original, its lorebook entries and the names on its card; Mea fills the first rows", async () => {
    const origin = mira();
    const d = createCreatorDraft({ kind: "character", baseId: origin, asVersion: { kind: "au", label: "College AU" }, idea: "Campus radio." });
    const m = await buildMap(d.id);
    const map = m.variant!.map;
    expect(m.variant!.mapBuilt).toBe(true);
    expect(map[0]).toMatchObject({ type: "self", from: "Mira", state: "changed", to: "Mira, a sophomore" });
    expect(map.find((r) => r.from === "Port Ellis")).toMatchObject({ type: "place", source: "lore" });
    expect(map.find((r) => r.from === "The Salt Guild")?.type).toBe("group");
    expect(map.some((r) => r.from === "Tomas" && r.source === "card")).toBe(true);
    // Nothing is listed twice, every row was decided, and the version gained something new.
    expect(new Set(map.map((r) => r.from.toLowerCase() || r.to)).size).toBe(map.length);
    expect(map.filter((r) => r.state === "open")).toEqual([]);
    expect(map.find((r) => r.state === "new")).toMatchObject({ to: "the campus radio station", source: "mea" });
    // Building again adds nothing and keeps your edits.
    const row = map.find((r) => r.from === "Tomas")!;
    patchCreator(d.id, { variant: { map: [{ id: row.id, state: "changed", to: "Tom, her roommate" }, { from: "", to: "Professor Hale", type: "person", state: "new" }] } });
    const again = await buildMap(d.id);
    expect(again.variant!.map.find((r) => r.id === row.id)).toMatchObject({ state: "changed", to: "Tom, her roommate" });
    expect(again.variant!.map.length).toBe(map.length + 1);
    // An open row is filled on request.
    patchCreator(d.id, { variant: { map: [{ from: "The old ferry", type: "thing" }] } });
    const filled = await fillMap(d.id, { all: true });
    expect(filled.variant!.map.find((r) => r.from === "The old ferry")?.state).not.toBe("open");
  });

  test("the bible is marked against the original's: kept sections are copied, the rest written; marks follow edits", async () => {
    // An original made in the creator has a bible to compare with.
    const made = createCreatorDraft({ kind: "character", idea: "Mira keeps the lighthouse above Port Ellis." });
    await writeBible(made.id);
    await runCreatorJob((queueFields(made.id), made.id));
    const origin = saveCreator(made.id).id;
    const before = getCreatorDraft(made.id)!.bible;
    const d = createCreatorDraft({ kind: "character", baseId: origin, asVersion: { kind: "au", label: "College AU" }, idea: "Campus radio." });
    expect(d.variant!.originBible?.length).toBe(before.filter((b) => b.text.trim()).length);
    const v = await writeVariantBible(d.id);
    const marks = variantMarks(v);
    expect(marks.voice).toBe("kept");
    expect(v.bible.find((b) => b.key === "voice")!.text).toBe(before.find((b) => b.key === "voice")!.text);
    expect(marks.identity).toBe("changed");
    expect(v.bible.find((b) => b.key === "identity")!.text).toContain("on campus");
    expect(v.stage).toBe("bible");
    // Editing a kept section makes it changed; the route sends the marks.
    patchCreator(d.id, { bible: { voice: "Clipped, on air." } });
    const got = await api("GET", `/api/creator/${d.id}`);
    expect(got.json.draft.marks.voice).toBe("changed");
    // The bible route writes a version's bible for a version draft.
    const r = await api("POST", `/api/creator/${d.id}/bible`, { steer: "warmer" });
    expect(r.json.draft.bible.find((b: { key: string }) => b.key === "identity").text).toContain("Reworked");
    // Your edit stood.
    expect(r.json.draft.bible.find((b: { key: string }) => b.key === "voice").text).toBe("Clipped, on air.");
  });

  test("without an original bible every section is written, marked by the writer; a rewrite turns kept into changed", async () => {
    const origin = mira();
    const d = createCreatorDraft({ kind: "character", baseId: origin, asVersion: { kind: "au" }, idea: "Campus radio." });
    const v = await writeVariantBible(d.id);
    expect(variantMarks(v).voice).toBe("kept");
    expect(v.bible.find((b) => b.key === "voice")!.text).toContain("on campus");
    const r = await rewriteBibleSection(d.id, "voice", "on air");
    expect(variantMarks(r).voice).toBe("changed");
  });

  test("leaks: original names the map changed or dropped are caught in the bible and fields, with the fix", async () => {
    expect(findLeaks([newRow({ from: "Port Ellis", to: "Ellis Campus", state: "changed" })], [{ where: "bible", key: "a", label: "A", text: "She grew up in Port Ellis." }])).toHaveLength(1);
    // Part of its own translation: not a leak. A longer word containing it: not a leak.
    expect(findLeaks([newRow({ from: "Arya", to: "Arya Stark", state: "changed" })], [{ where: "bible", key: "a", label: "A", text: "Arya laughs." }])).toEqual([]);
    expect(findLeaks([newRow({ from: "Tom", state: "dropped" })], [{ where: "bible", key: "a", label: "A", text: "Tomorrow, then." }])).toEqual([]);
    // A name is matched as written: Rose the person, not rose the verb.
    expect(findLeaks([newRow({ from: "Rose", state: "dropped" })], [{ where: "bible", key: "a", label: "A", text: "She rose early." }])).toEqual([]);
    expect(findLeaks([newRow({ from: "Rose", state: "dropped" })], [{ where: "bible", key: "a", label: "A", text: "Rose rose early." }])).toHaveLength(1);
    const origin = mira();
    const d = createCreatorDraft({ kind: "character", baseId: origin, asVersion: { kind: "au" }, idea: "Campus radio." });
    await writeVariantBible(d.id);
    const p = patchCreator(d.id, { variant: { map: [{ from: "Port Ellis", to: "Ellis Campus", state: "changed", type: "place" }, { from: "Tomas", state: "dropped", type: "person" }] }, bible: { backstory: "She left Port Ellis at eighteen." } });
    const leaks = draftLeaks(p);
    expect(leaks.find((l) => l.where === "bible")).toMatchObject({ term: "Port Ellis", to: "Ellis Campus", key: "backstory" });
    // The original's description is still in the fields: both names show up there.
    expect(leaks.filter((l) => l.where === "field" && l.key === "description").map((l) => l.term).sort()).toEqual(["Port Ellis", "Tomas"]);
    expect(reviewCreator(d.id).issues.description!.some((i) => i.kind === "leak" && i.message.includes("Ellis Campus"))).toBe(true);
    // The editor's check judges a version on two more criteria.
    const checked = await checkBible(d.id);
    expect(checked.bibleGate!.criteria.map((c) => c.key)).toEqual(expect.arrayContaining(["still_them", "translated"]));
  });

  test("the field plan: what carries over word for word and what's rewritten for the version", async () => {
    const made = createCreatorDraft({ kind: "character", idea: "Mira keeps the lighthouse." });
    await writeBible(made.id);
    queueFields(made.id);
    await runCreatorJob(made.id);
    const origin = saveCreator(made.id).id;
    const d = createCreatorDraft({ kind: "character", baseId: origin, asVersion: { kind: "au" }, idea: "Campus radio." });
    expect(variantFieldPlan(d)).toBeNull();
    await writeVariantBible(d.id);
    const plan = variantFieldPlan(getCreatorDraft(d.id)!)!;
    // The description reads every section (some changed); greetings and the scenario always open in the new world.
    expect(plan.rewrite).toEqual(expect.arrayContaining(["description", "scenario", "first_mes"]));
    // Fields written only from kept sections carry over: none here reads only the voice, so check the rule directly.
    patchCreator(d.id, { bible: Object.fromEntries(getCreatorDraft(d.id)!.variant!.originBible!.map((b) => [b.key, b.text])) });
    const allKept = variantFieldPlan(getCreatorDraft(d.id)!)!;
    expect(allKept.keep).toEqual(expect.arrayContaining(["personality", "mes_example", "rules", "tags", "creator_notes"]));
    expect(allKept.rewrite).toEqual(expect.arrayContaining(["scenario", "first_mes"]));
  });

  test("save links the version with its name, kind and what stays true; then the persona's version", async () => {
    const origin = mira();
    const d = createCreatorDraft({ kind: "character", baseId: origin, asVersion: { kind: "au", label: "College AU" }, idea: "Campus radio." });
    await startVariant(d.id);
    await buildMap(d.id);
    const cur = getCreatorDraft(d.id)!;
    patchCreator(d.id, { variant: { label: "Campus AU", anchors: [{ id: cur.variant!.anchors[1]!.id, kept: false }] }, answers: { [cur.questions[0]!.id]: "Ten years ago" } });
    await writeVariantBible(d.id);
    const saved = saveCreator(ownGreeting(d.id));
    expect(saved.id).not.toBe(origin);
    expect(getCard(origin)!.description).toContain("lighthouse");
    expect(linkInfo("character", saved.id)).toMatchObject({ origin: { id: origin }, kind: "au", label: "Campus AU", anchors: ["Dry humour that covers fear"] });
    // The persona's version: same kind, name, premise, answers and map, built opposite this one.
    const p = personaVersion(d.id);
    expect(p.kind).toBe("persona");
    expect(p.variant).toMatchObject({ originId: persona, originName: "Ash", kind: "au", label: "Campus AU", premise: "Campus radio." });
    expect(p.counterpart?.draftId).toBe(d.id);
    expect(p.questions.map((q) => q.answer)).toEqual(["Ten years ago"]);
    expect(p.variant!.map.some((r) => r.from === "Port Ellis")).toBe(true);
    expect(p.variant!.map.some((r) => r.type === "self")).toBe(false);
    expect(p.stage).toBe("questions");
    // Its own anchors on request, without more questions.
    const anchored = await startVariant(p.id, { anchorsOnly: true });
    expect(anchored.variant!.anchors.length).toBe(2);
    expect(anchored.questions).toHaveLength(1);
    await writeVariantBible(p.id);
    const ps = saveCreator(p.id);
    expect(getPersona(ps.id)!.name).toBe("Ash");
    expect(linkInfo("persona", ps.id)!.origin?.id).toBe(persona);
    expect(getPersona(persona)!.data.description).toBe("A courier who never sits still.");
  });

  test("routes: patch the plan, start, map, fill, persona, and the draft payload", async () => {
    const origin = mira();
    const made = await api("POST", "/api/creator", { kind: "character", baseId: origin, asVersion: { kind: "skip", label: "Ten years later" }, idea: "She's forty and runs the harbour office." });
    const id = made.json.draft.id as string;
    expect(made.json.draft.variant.kind).toBe("skip");
    expect(made.json.draft.leaks).toEqual([]);
    expect((await api("PUT", `/api/creator/${id}`, { variant: { premise: "She's forty.", map: [{ from: "The lamp", type: "thing", state: "kept" }] } })).json.draft.variant.premise).toBe("She's forty.");
    expect((await api("POST", `/api/creator/${id}/variant/directions`, {})).json.draft.variant.directions).toHaveLength(3);
    expect((await api("POST", `/api/creator/${id}/variant/start`)).json.draft.stage).toBe("questions");
    expect((await api("POST", `/api/creator/${id}/variant/question`, { steer: "her brother" })).json.draft.questions.length).toBe(3);
    const mapped = await api("POST", `/api/creator/${id}/variant/map`);
    expect(mapped.json.draft.variant.map.find((r: { from: string }) => r.from === "The lamp").state).toBe("kept");
    expect((await api("POST", `/api/creator/${id}/variant/map/fill`, { all: true })).status).toBe(200);
    expect((await api("PUT", `/api/creator/${id}`, { stage: "map" })).json.draft.stage).toBe("map");
    const bible = await api("POST", `/api/creator/${id}/bible`);
    expect(bible.json.draft.fieldPlan.rewrite).toContain("first_mes");
    const p = await api("POST", `/api/creator/${id}/variant/persona`, {});
    expect(p.status).toBe(201);
    expect(p.json.draft.kind).toBe("persona");
    // A draft that isn't a version refuses the variant steps.
    const plain = await api("POST", "/api/creator", { kind: "character", idea: "Someone new." });
    expect((await api("POST", `/api/creator/${plain.json.draft.id}/variant/start`)).status).toBe(400);
  });
});
