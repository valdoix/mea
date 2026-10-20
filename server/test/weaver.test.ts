import { beforeAll, describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import { normalizeCard } from "../src/cards/card";
import { getAgency, parseAgency, setAgency } from "../src/creator/books";
import { toVerdict } from "../src/creator/gate";
import { addTaste } from "../src/creator/interview";
import {
  answerQuestion,
  applyPairing,
  checkBible,
  composeDepth,
  createCreatorDraft,
  creatorReadback,
  finishInterview,
  getCreatorDraft,
  interviewPlan,
  nextQuestion,
  pairedGreeting,
  patchCreator,
  queueFields,
  questionDirections,
  resetInterview,
  reviewCreator,
  runCreatorJob,
  saveCreator,
  suggestTreatment,
  writeBible,
} from "../src/creator/creator";
import { checkScenario } from "../src/creator/checks";
import { getEnrichRun, restoreEnriched, runEnrichJob, startEnrich } from "../src/lore/enrich";
import { dreamWeaverCategory, guessCategory } from "../src/lore/format";
import { growAnswer, growQuestion } from "../src/lore/grow";
import { addPerson, answerPerson, fleshExtra, harvestPeople, listPeople, personQuestion, promotePerson, proposePeople, removePerson, weavePerson } from "../src/lore/people";
import { createLorebook, getLorebook, linkedBooks } from "../src/lore/service";
import { defaultEntry } from "../src/lore/types";
import { expandMacros, pronounsOf } from "../src/prompt/macros";
import { createCharacter, getCard } from "../src/services/characters";
import { createConnection, createProfile, syncModels } from "../src/services/connections";
import { registerJob } from "../src/services/jobs";
import { getPersona } from "../src/services/personas";
import { freshDb } from "./helpers";

let app: ReturnType<typeof createApp>;
const local = { requestIP: () => ({ address: "127.0.0.1", family: "IPv4", port: 5000 }) };
async function api<T = any>(method: string, path: string, body?: unknown): Promise<{ status: number; json: T }> {
  const res = await app.fetch(new Request(`http://localhost${path}`, { method, headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined }), local);
  return { status: res.status, json: (await res.json()) as T };
}

beforeAll(async () => {
  freshDb();
  for (const kind of ["lore.studio", "lore.embed", "creator.write", "lore.enrich"]) registerJob(kind, async () => {});
  app = createApp();
  const conn = createConnection({ name: "Mock", kind: "mock", billing: "subscription" });
  await syncModels(conn);
  createProfile({ name: "Story", connectionId: conn, modelId: "mock/storyteller", params: { context_target: 4000 } });
});

describe("drawing the idea out", () => {
  test("read-back facts, the plan, one screened question at a time, spillover, directions, taste and origins", async () => {
    const d = createCreatorDraft({ kind: "character", name: "Mira", idea: "Mira keeps the lighthouse above Port Ellis and owes the Salt Guild money." });
    const r = await creatorReadback(d.id);
    // Facts from the idea, tagged to sections.
    expect(r.facts.map((f) => [f.section, f.source])).toEqual([["identity", "idea"], ["secrets", "idea"]]);
    expect(r.readback!.gaps!.map((g) => g.section)).toEqual(["personality", "user"]);
    // What the interview will do: covered, ask (critical first), mixed, write.
    const plan = interviewPlan(r);
    expect(plan.find((p) => p.key === "identity")!.status).toBe("covered");
    expect(plan.find((p) => p.key === "personality")!.status).toBe("ask");
    expect(plan.find((p) => p.key === "gradient")!.status).toBe("mixed");
    expect(plan.find((p) => p.key === "appearance")!.status).toBe("write");
    // Optional sections stay off unless the material calls for them.
    expect(plan.some((p) => p.key === "arc")).toBe(false);
    // The first question aims at the most important open section.
    expect(r.questions).toHaveLength(1);
    expect(r.questions[0]!.section).toBe("personality");

    // Directions: three, captioned; a steered set doesn't repeat what was shown, and the steer joins your taste.
    const q1 = r.questions[0]!;
    const dir = await questionDirections(d.id, q1.id, "darker");
    expect(dir.questions[0]!.directions).toHaveLength(3);
    expect(dir.questions[0]!.directions[0]!.caption).toContain("darker");
    expect(dir.questions[0]!.shown).toHaveLength(3);
    expect(dir.taste).toEqual(["darker"]);

    // Answering: a fact with whose words it is; the listener files what else it settles; the next question follows.
    const picked = dir.questions[0]!.directions[1]!.text;
    const a = await answerQuestion(d.id, q1.id, { answer: `${picked} Her sister is in the navy.`, source: "picked" });
    expect(a.facts.find((f) => f.qid === q1.id)!.source).toBe("picked");
    expect(a.facts.some((f) => f.section === "relationships" && f.text === "a sister in the navy")).toBe(true);
    expect(a.questions).toHaveLength(2);
    expect(a.questions[1]!.section).not.toBe("personality");

    // Asking again skips the open question; claiming a section moves it to the front.
    patchCreator(d.id, { claims: ["appearance"] });
    const skipped = await nextQuestion(d.id);
    expect(skipped.questions[1]!.skipped).toBe(true);
    expect(skipped.questions[2]!.section).toBe("appearance");

    // Editing an answer edits its fact; a fact you rewrite is in your own words.
    patchCreator(d.id, { answers: { [q1.id]: "She'd rather drown than ask for help." }, answerSources: { [q1.id]: "typed" } });
    const edited = getCreatorDraft(d.id)!;
    expect(edited.facts.find((f) => f.qid === q1.id)).toMatchObject({ text: "She'd rather drown than ask for help.", source: "typed" });
    const idea = edited.facts.find((f) => f.source === "idea")!;
    patchCreator(d.id, { facts: [{ id: idea.id, text: "keeper of the Port Ellis light" }, { section: "voice", text: "never says please" }] });
    const f2 = getCreatorDraft(d.id)!.facts;
    expect(f2.find((f) => f.id === idea.id)!.source).toBe("typed");
    expect(f2.some((f) => f.section === "voice" && f.text === "never says please")).toBe(true);

    // The bible: passes, then a weave (links between real sections only) and a brief; origins follow your facts and edits.
    const b = await writeBible(d.id, "less sentimental");
    expect(b.bible.map((s) => s.key)).toEqual(expect.arrayContaining(["gradient", "tensions", "negative"]));
    expect(b.brief).toContain("forgiveness");
    expect(b.links).toEqual([{ from: "backstory", to: "personality", relation: "hardened into" }]);
    expect(b.taste).toEqual(["darker", "less sentimental"]);
    expect(b.bible.find((s) => s.key === "personality")!.origin).toBe("yours");
    expect(b.bible.find((s) => s.key === "tensions")!.origin).toBe("mea");
    expect(b.bible.find((s) => s.key === "backstory")!.origin).toBe("guess");
    expect(patchCreator(d.id, { bible: { backstory: "Her father kept the light before her." } }).bible.find((s) => s.key === "backstory")!.origin).toBe("yours");

    // Named checks, with the conditional ones only when the bible has their material.
    const checked = await checkBible(d.id);
    expect(checked.bibleGate!.passed).toBe(true);
    expect(checked.bibleGate!.criteria.map((c) => c.key)).toEqual(["specificity", "coherence", "fidelity", "renderability", "tension", "originality", "calibration", "person"]);

    // Finishing and starting over.
    expect(finishInterview(d.id).interviewDone).toBe(true);
    const reset = resetInterview(d.id);
    expect(reset.questions).toHaveLength(0);
    expect(reset.facts.some((f) => f.qid)).toBe(false);
    expect(reset.facts.some((f) => f.source === "idea")).toBe(true);
  });

  test("a gate holds a verdict to its criteria; taste keeps the newest steers without repeats", () => {
    const v = toVerdict({ criteria: [{ key: "a", passed: true, note: "" }, { key: "zzz", passed: true, note: "" }], summary: "" }, [
      { key: "a", label: "A", description: "" },
      { key: "b", label: "B", description: "" },
    ]);
    expect(v.passed).toBe(false);
    expect(v.criteria.map((c) => c.passed)).toEqual([true, false]);
    expect(addTaste(["Darker", "drier"], "darker")).toEqual(["drier", "darker"]);
    expect(addTaste([], "ok")).toEqual([]);
  });

  test("deepening after the essentials, up to the cap, and depth entries from it", async () => {
    const d = createCreatorDraft({ kind: "character", name: "Mira", idea: "Mira keeps the lighthouse. MOCK_ARC" });
    await creatorReadback(d.id);
    // MOCK_ARC: the relationship arc is detected and switched on.
    expect(getCreatorDraft(d.id)!.optional).toContain("arc");
    // Cover every section, so the next question deepens.
    const all = interviewPlan(getCreatorDraft(d.id)!).map((p) => ({ section: p.key, text: `${p.label} settled.` }));
    patchCreator(d.id, { facts: all });
    const q = await nextQuestion(d.id);
    const deep = q.questions.at(-1)!;
    expect(deep.section).toBe("depth");
    const answered = await answerQuestion(d.id, deep.id, { answer: "I keep the brass key of the old ferry hidden from Tam." });
    // Deepening answers aren't facts; they're composed into depth entries.
    expect(answered.facts.some((f) => f.qid === deep.id)).toBe(false);
    const composed = await composeDepth(d.id);
    expect(composed.depth).toHaveLength(1);
    expect(composed.depth[0]).toMatchObject({ from: "answer", qid: deep.id });
    expect(composed.depth[0]!.gate!.passed).toBe(true);
    // Composing again doesn't duplicate; from the bible adds more.
    await writeBible(d.id);
    expect((await composeDepth(d.id, { fromBible: true })).depth.map((e) => e.from)).toEqual(["answer", "bible", "bible"]);
  });
});

describe("writing and saving", () => {
  test("auto-check with one revision, sign-off, the hand-edit guard, scene objective, depth and rules books", async () => {
    const d = createCreatorDraft({ kind: "character", name: "MOCK_GATE_FAIL", idea: "A lighthouse keeper.", options: { autoCheck: true, greetings: 0, rulesBook: true, format: "tagged" } });
    await writeBible(d.id);
    queueFields(d.id, { keys: ["description", "tags"] });
    await runCreatorJob(d.id);
    const w = getCreatorDraft(d.id)!;
    const desc = w.fields.find((f) => f.key === "description")!;
    // The name keeps failing the mock's check: revised once, then it stands, flagged.
    expect(desc.revised).toBe(true);
    expect(desc.gate!.passed).toBe(false);
    expect(desc.gate!.criteria.map((c) => c.key)).toContain("no_recital");
    // Tags aren't checked.
    expect(w.fields.find((f) => f.key === "tags")!.gate ?? null).toBeNull();

    // Your edit is protected: rewriting it needs force.
    patchCreator(d.id, { fields: { description: "My own words." }, accepted: { description: true } });
    expect(getCreatorDraft(d.id)!.fields.find((f) => f.key === "description")).toMatchObject({ edited: true, accepted: true });
    expect(() => queueFields(d.id, { keys: ["description"] })).toThrow(/by hand/);
    expect(queueFields(d.id, { keys: ["description"], force: true }).fields.find((f) => f.key === "description")!.status).toBe("queued");
    await runCreatorJob(d.id);
    expect(getCreatorDraft(d.id)!.fields.find((f) => f.key === "description")).toMatchObject({ edited: false, accepted: false });

    // A companion scenario without a scene objective is flagged.
    expect(checkScenario("The storm, the light.")[0]!.kind).toBe("no-objective");
    expect(checkScenario("The storm.\nScene-objective: find out who sent him.")).toEqual([]);
    patchCreator(d.id, { fields: { scenario: "A storm night." } });
    expect(reviewCreator(d.id).issues.scenario!.some((i) => i.kind === "no-objective")).toBe(true);

    // Save: depth entries go into a depth book, and the rules into a rules book, both linked.
    patchCreator(d.id, { depth: [{ title: "The key", content: "She keeps the ferry key.", keys: ["key"] }] });
    const saved = saveCreator(d.id);
    const books = linkedBooks("character", saved.id).map((b) => getLorebook(b.id)!);
    const depth = books.find((b) => b.settings.role === "depth")!;
    const rules = books.find((b) => b.settings.role === "rules")!;
    expect(depth.settings.semantic).toBe(true);
    expect(depth.entries.map((e) => e.content)).toEqual(["She keeps the ferry key."]);
    expect(rules.entries.map((e) => e.extra.creatorRule)).toEqual(["reanchor", "deliberation", "craft"]);
    expect(rules.entries.every((e) => e.constant)).toBe(true);
    // Saving again updates in place, never duplicating.
    patchCreator(d.id, { depth: [{ id: saved.draft.depth[0]!.id, content: "She keeps the ferry key on a cord." }] });
    saveCreator(d.id);
    expect(getLorebook(depth.id)!.entries.map((e) => e.content)).toEqual(["She keeps the ferry key on a cord."]);
    expect(getLorebook(rules.id)!.entries).toHaveLength(3);
  });

  test("a narrator's world agency and harvested people; agency edited later", async () => {
    const d = createCreatorDraft({ kind: "character", name: "Saltmere", idea: "Saltmere pays a tithe to something under the bay. The clerk Wenna Rook keeps the ledger.", options: { mode: "narrator", greetings: 0 } });
    patchCreator(d.id, { optional: ["agency"] });
    await writeBible(d.id);
    patchCreator(d.id, { bible: { agency: "Agenda: the tithe will be paid in full before the spring tide.\nHolds:\n- No one who reads the ledger leaves.\n- The thing under the bay is never described." }, fields: { description: "A narrator for Saltmere." } });
    const saved = await api("POST", `/api/creator/${d.id}/save`);
    const id = saved.json.id as string;
    expect(getAgency(id)).toEqual({ enabled: true, agenda: "the tithe will be paid in full before the spring tide.", holds: ["No one who reads the ledger leaves.", "The thing under the bay is never described."] });
    // The people it names are in its people book's roster.
    expect(saved.json.peopleBookId).toBeTruthy();
    expect(listPeople(saved.json.peopleBookId).map((p) => p.origin)).toContain("interview");
    // Turned off from the card later; the entry stays, switched off.
    expect(setAgency(id, { enabled: false, agenda: "the tithe", holds: [] }).enabled).toBe(false);
    expect(getAgency(id).enabled).toBe(false);
    expect((await api("PUT", `/api/characters/${id}/agency`, { enabled: true, agenda: "", holds: [] })).status).toBe(400);
    expect(parseAgency("Agenda: x\nHolds:\n1. a\n2) b").holds).toEqual(["a", "b"]);
  });

  test("a persona to play opposite a character, its paired opening, and pronoun macros", async () => {
    const c = createCreatorDraft({ kind: "character", name: "Mira", idea: "Mira keeps the lighthouse.", options: { greetings: 0 } });
    await writeBible(c.id);
    // A blank idea is fine: Mea invents someone who fits opposite her.
    const p = createCreatorDraft({ kind: "persona", oppositeOf: { draftId: c.id } });
    expect(p.counterpart!.name).toBe("Mira");
    expect(p.idea).toContain("opposite Mira");
    await writeBible(p.id);
    queueFields(p.id);
    await runCreatorJob(p.id);
    const g = await pairedGreeting(p.id, "adversarial");
    expect(g.pairing!.register).toBe("adversarial");
    expect(g.pairing!.text.length).toBeGreaterThan(20);
    // Not saved yet: it becomes the character draft's next alternate greeting.
    const applied = applyPairing(p.id);
    expect(applied.pairing!.appliedTo).toBe(`draft:${c.id}`);
    const cd = getCreatorDraft(c.id)!;
    expect(cd.options.greetings).toBe(1);
    expect(cd.fields.find((f) => f.key === "alt_1")!.value).toBe(g.pairing!.text);
    // Persona depth: drafted from the bible and saved into a persona depth book.
    await composeDepth(p.id, { fromBible: true });
    const ps = saveCreator(p.id);
    expect(getPersona(ps.id)!.data.pronouns).toBe("she/her/her");
    expect(linkedBooks("persona", ps.id).map((b) => getLorebook(b.id)!.settings.role)).toContain("depth");

    expect(pronounsOf("she/her/her")).toEqual({ they: "she", them: "her", their: "her", theirs: "hers" });
    expect(pronounsOf("he")).toEqual({ they: "he", them: "him", their: "his", theirs: "his" });
    expect(pronounsOf("xe/xem/xyr").theirs).toBe("xyrs");
    expect(pronounsOf("")).toEqual(pronounsOf("they/them"));
    expect(expandMacros("{{user_they}} lifts {{user_their}} lamp; Mira watches {{user_them}}.", { char: "Mira", user: "Ash", userPronouns: "he/him", vars: {} })).toBe("he lifts his lamp; Mira watches him.");
  });

  test("rebuilding an imported card as a copy, and the suggested treatment", async () => {
    const { data } = normalizeCard({ spec: "chara_card_v2", data: { name: "The Gull", description: "MOCK_NARRATOR The whole harbour town and its people.", first_mes: "The rain comes in sideways." } });
    const id = createCharacter(data);
    const t = await suggestTreatment(id);
    expect(t.treatment).toBe("narrator");
    expect(t.fields.find((f) => f.key === "description")!.words).toBeGreaterThan(3);
    const r = createCreatorDraft({ kind: "character", baseId: id, asCopy: true, options: { mode: "narrator" } });
    expect(r.baseId).toBeNull();
    expect(r.origin!.copyOf).toBe(id);
    const saved = saveCreator(r.id);
    expect(saved.id).not.toBe(id);
    expect(getCard(id)!.first_mes).toBe("The rain comes in sideways.");
    expect((await api("GET", `/api/creator/treatment/${id}`)).json.treatment).toBe("narrator");
  });
});

describe("growing a lorebook", () => {
  test("add lore one question at a time; enrich in place, keeping originals that don't improve", async () => {
    const book = createLorebook({
      name: "Port Ellis",
      entries: [
        defaultEntry({ comment: "The lighthouse", keys: ["lighthouse"], content: "A white tower on the cliff." }),
        defaultEntry({ comment: "The ferry", keys: ["ferry"], content: "It runs twice a day. MOCK_WORSE" }),
      ],
    });
    const q = await growQuestion(book);
    expect(q.q).toContain("depth");
    const grown = await growAnswer(book, { question: q.q, answer: "The Salt Guild meets in the drowned chapel at low tide.", source: "typed" });
    expect(grown.entry.extra.grownFrom).toEqual({ q: q.q, a: "The Salt Guild meets in the drowned chapel at low tide." });
    expect(getLorebook(book)!.entries).toHaveLength(3);
    // The next question knows what was asked.
    expect((await growQuestion(book)).q).toContain("Question 2");

    const run = startEnrich(book);
    expect(run.items).toHaveLength(3);
    await runEnrichJob(book);
    const done = getEnrichRun(book)!;
    expect(done.state).toBe("done");
    expect(done.items.find((i) => i.title === "The lighthouse")!.status).toBe("enriched");
    expect(done.items.find((i) => i.title === "The ferry")).toMatchObject({ status: "kept" });
    const entries = getLorebook(book)!.entries;
    expect(entries.find((e) => e.comment === "The lighthouse")!.content).toContain("Enriched");
    expect(entries.find((e) => e.comment === "The ferry")!.content).toBe("It runs twice a day. MOCK_WORSE");
    const lh = entries.find((e) => e.comment === "The lighthouse")!;
    restoreEnriched(book, lh.id);
    expect(getLorebook(book)!.entries.find((e) => e.id === lh.id)!.content).toBe("A white tower on the cliff.");
  });

  test("the people ladder: name → extra → named → promoted", async () => {
    const book = createLorebook({ name: "Saltmere people book", settings: { role: "people" }, entries: [defaultEntry({ comment: "The tithe", content: "Paid each spring to the bay." })] });
    const proposed = await proposePeople(book);
    expect(proposed.map((p) => p.name)).toEqual(["Tam Hollis", "Edda Crane"]);
    // Proposing again doesn't duplicate; a manual add with the same name is ignored.
    await proposePeople(book);
    expect(addPerson(book, { name: "tam hollis" })).toBeNull();
    expect(listPeople(book)).toHaveLength(2);
    expect((await harvestPeople(book, "Wenna Rook keeps the ledger.")).map((p) => p.origin)).toEqual(["interview"]);

    const tam = listPeople(book).find((p) => p.name === "Tam Hollis")!;
    const extra = await fleshExtra(tam.id);
    expect(extra.tier).toBe("extra");
    const entry = getLorebook(book)!.entries.find((e) => e.id === extra.entryId)!;
    expect(entry.keys).toContain("Tam Hollis");
    expect(entry.extra.category).toBe("character");
    expect(() => removePerson(tam.id)).toThrow();

    const asked = await personQuestion(tam.id);
    const q = asked.interview[0]!;
    answerPerson(tam.id, q.id, "He calls every newcomer 'harbourmaster' to see who flinches.");
    const named = await weavePerson(tam.id);
    expect(named.tier).toBe("named");
    expect(named.gate!.passed).toBe(true);
    expect(getLorebook(book)!.entries.find((e) => e.id === named.entryId)!.content).toContain("harbourmaster");

    const promo = promotePerson(tam.id);
    const draft = getCreatorDraft(promo.draftId)!;
    expect(draft.name).toBe("Tam Hollis");
    expect(draft.worldBookIds).toContain(book);
    expect(draft.idea).toContain("harbourmaster");
    // Saving the promoted card marks them in-universe.
    patchCreator(draft.id, { fields: { description: "Tam pilots the tithe boat." } });
    const saved = saveCreator(draft.id);
    expect(listPeople(book).find((p) => p.id === tam.id)!.characterId).toBe(saved.id);

    // The people routes.
    expect((await api("GET", `/api/lorebooks/${book}/people`)).json.people.length).toBe(3);
    const edda = listPeople(book).find((p) => p.name === "Edda Crane")!;
    expect((await api("DELETE", `/api/people/${edda.id}`)).json.ok).toBe(true);
  });

  test("book roles set where entries start", () => {
    expect(guessCategory({ comment: "", content: "something", keys: [], constant: false }, "", "rules").category).toBe("rule");
    expect(dreamWeaverCategory("Marisol rules book")).toBe("rule");
    expect(dreamWeaverCategory("Saltmere NPC book")).toBe("character");
    expect(dreamWeaverCategory("Marisol depth book")).toBeNull();
  });
});

describe("API", () => {
  test("the interview routes", async () => {
    const made = await api("POST", "/api/creator", { kind: "character", idea: "A tired ferryman who counts the dead." });
    const id = made.json.draft.id;
    expect(made.json.draft.plan.length).toBeGreaterThan(5);
    const rb = await api("POST", `/api/creator/${id}/readback`);
    const qid = rb.json.draft.questions[0].id;
    expect((await api("POST", `/api/creator/${id}/questions/${qid}/directions`, { steer: "stranger" })).json.draft.questions[0].directions.length).toBe(3);
    expect((await api("POST", `/api/creator/${id}/questions/${qid}/answer`, { answer: "He hasn't slept since the flood.", source: "typed" })).json.draft.questions.length).toBe(2);
    expect((await api("POST", `/api/creator/${id}/question`, { steer: "about his debts" })).json.draft.questions.at(-1).q).toContain("about his debts");
    expect((await api("POST", `/api/creator/${id}/interview/finish`)).json.draft.interviewDone).toBe(true);
    await api("POST", `/api/creator/${id}/bible`);
    expect((await api("POST", `/api/creator/${id}/weave`)).json.draft.brief).toBeTruthy();
    expect((await api("PUT", `/api/creator/${id}`, { options: { format: "tagged", autoCheck: true } })).json.draft.options).toMatchObject({ format: "tagged", autoCheck: true });
    expect((await api("POST", `/api/creator/${id}/depth`, { fromBible: true })).json.draft.depth.length).toBe(2);
    expect((await api("POST", `/api/creator/${id}/interview/reset`)).json.draft.questions.length).toBe(0);
    expect((await api("POST", `/api/creator/${id}/pairing`, { register: "romantic" })).status).toBe(400);
  });
});
