import { z } from "zod";
import { ensureRoleBook } from "../creator/books";
import { createCreatorDraft, getCreatorDraft } from "../creator/creator";
import { tidy } from "../creator/expand";
import { type Criterion, failedNotes, type GateVerdict, namedTarget, peopleCount, runGate, writeTemp } from "../creator/gate";
import { askQuestion, type Direction, directions as offerDirections, type FactSource, SOURCE_MARK } from "../creator/interview";
import { worldContext } from "../creator/world";
import { all, newId, now, one, parseJson, run } from "../db/db";
import { publish } from "../lib/events";
import { badRequest, notFound } from "../lib/http";
import { callJson } from "../services/llm";
import { withCategory } from "./format";
import { createEntry, getLorebook, updateEntry } from "./service";
import { defaultEntry } from "./types";

/**
 * A world's people (Lumiverse's roster, adapted): every person the narrator can bring into a scene,
 * on a ladder where each step is one action: a name → an extra (two or three background lines in the
 * book) → named (a short interview woven into a voiced profile, firing by name) → promoted to their
 * own card that carries the world's lorebook. People come from your own build, from "Propose people"
 * (anchored to the book's lore and naming style), or from you.
 */

export type Tier = "unfleshed" | "extra" | "named";

export interface PersonAnswer {
  id: string;
  q: string;
  why: string;
  answer: string;
  source: FactSource;
  directions: Direction[];
  shown: string[];
}

export interface Person {
  id: string;
  bookId: string;
  name: string;
  hook: string;
  origin: "proposed" | "manual" | "interview";
  tier: Tier;
  interview: PersonAnswer[];
  entryId: string | null;
  creatorDraftId: string | null;
  characterId: string | null;
  gate: GateVerdict | null;
  createdAt: number;
  updatedAt: number;
}

interface Row {
  id: string;
  book_id: string;
  name: string;
  data: string;
  created_at: number;
  updated_at: number;
}

const hydrate = (r: Row): Person => {
  const d = parseJson<Partial<Person>>(r.data, {});
  return { id: r.id, bookId: r.book_id, name: r.name, hook: d.hook ?? "", origin: d.origin ?? "manual", tier: d.tier ?? "unfleshed", interview: d.interview ?? [], entryId: d.entryId ?? null, creatorDraftId: d.creatorDraftId ?? null, characterId: d.characterId ?? null, gate: d.gate ?? null, createdAt: r.created_at, updatedAt: r.updated_at };
};

function save(p: Person) {
  const { id, bookId: _b, name, createdAt: _c, updatedAt: _u, ...data } = p;
  p.updatedAt = now();
  run("UPDATE lore_people SET name = ?, data = ?, updated_at = ? WHERE id = ?", name, JSON.stringify(data), p.updatedAt, id);
  publish({ type: "library.changed", what: "lorebooks" });
  return p;
}

function mustPerson(id: string) {
  const r = one<Row>("SELECT * FROM lore_people WHERE id = ?", id);
  if (!r) throw notFound("That person is gone");
  return hydrate(r);
}

const mutatePerson = (id: string, fn: (p: Person) => void) => {
  const p = mustPerson(id);
  fn(p);
  return save(p);
};

function mustBook(bookId: string) {
  const b = getLorebook(bookId);
  if (!b || b.deletedAt) throw notFound("Lorebook not found");
  return b;
}

const key = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N} ]+/gu, "").replace(/\s+/g, " ").trim();

/** The roster, kept honest: someone whose entry was deleted from the book drops back to a name. */
export function listPeople(bookId: string): Person[] {
  const book = mustBook(bookId);
  const ids = new Set(book.entries.map((e) => e.id));
  return all<Row>("SELECT * FROM lore_people WHERE book_id = ? ORDER BY created_at", bookId)
    .map(hydrate)
    .map((p) => (p.entryId && !ids.has(p.entryId) ? save({ ...p, entryId: null, tier: "unfleshed" }) : p));
}

export function addPerson(bookId: string, input: { name: string; hook?: string; origin?: Person["origin"] }): Person | null {
  mustBook(bookId);
  const name = input.name.trim().slice(0, 80);
  if (!name) throw badRequest("Give them a name");
  if (all<Row>("SELECT * FROM lore_people WHERE book_id = ?", bookId).some((r) => key(r.name) === key(name))) return null;
  const id = newId();
  const t = now();
  const p: Person = { id, bookId, name, hook: input.hook?.trim().slice(0, 300) ?? "", origin: input.origin ?? "manual", tier: "unfleshed", interview: [], entryId: null, creatorDraftId: null, characterId: null, gate: null, createdAt: t, updatedAt: t };
  const { id: _i, bookId: _b, name: _n, createdAt: _c, updatedAt: _u, ...data } = p;
  run("INSERT INTO lore_people (id, book_id, name, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)", id, bookId, name, JSON.stringify(data), t, t);
  publish({ type: "library.changed", what: "lorebooks" });
  return p;
}

/** Only someone who is still just a name can be removed here; anyone fleshed lives in the book. */
export function removePerson(id: string) {
  const p = mustPerson(id);
  if (p.tier !== "unfleshed") throw badRequest(`${p.name} has an entry in the book now: remove it there`);
  run("DELETE FROM lore_people WHERE id = ?", id);
  publish({ type: "library.changed", what: "lorebooks" });
}

const bookContext = (bookId: string, budget = 2000) => worldContext({ bookIds: [bookId] }, budget);

const peopleSchema = z.object({ people: z.array(z.object({ name: z.string().default(""), hook: z.string().default("") })).default([]) });

/** "Propose people": faces the world's own lore needs, each anchored to something established, named in its own style. */
export async function proposePeople(bookId: string) {
  const book = mustBook(bookId);
  const have = listPeople(bookId).map((p) => p.name).concat(book.entries.map((e) => e.comment).filter(Boolean));
  const r = await callJson({
    task: "helper",
    kind: "people:propose",
    name: "people_propose",
    schema: peopleSchema,
    system: [
      `Propose ${peopleCount()} people for this world that a narrator could bring into scenes. Every one is anchored to established material: a named place, faction, rule or tension that needs a face. Names follow the world's own naming culture, never a generic name that would fit any setting.`,
      '"hook": one line on who they are and which part of the lore they hang from.',
      'Reply with JSON only: {"people": [{"name": "…", "hook": "…"}]}',
    ].join("\n\n"),
    user: [`THE WORLD (${book.name}):\n${bookContext(bookId)}`, have.length ? `ALREADY HERE (don't repeat):\n${have.join(", ")}` : ""].filter(Boolean).join("\n\n"),
    maxTokens: 1200,
    temperature: writeTemp(0.8),
  });
  return r.data.people.filter((x) => x.name.trim()).map((x) => addPerson(bookId, { name: x.name, hook: x.hook, origin: "proposed" })).filter(Boolean) as Person[];
}

/** People you named while building something (a narrator card), picked up into its people book's roster. No inventions. */
export async function harvestPeople(bookId: string, material: string, cap = 12) {
  if (!material.trim()) return [];
  const r = await callJson({
    task: "helper",
    kind: "people:harvest",
    name: "people_harvest",
    schema: peopleSchema,
    system: 'List the people the author actually NAMED in this material (proper names of individuals, not groups or places), each with a one-line hook taken from what the material says about them. Never invent anyone; an empty list is fine. Reply with JSON only: {"people": [{"name": "…", "hook": "…"}]}',
    user: material.slice(0, 20_000),
    maxTokens: 1200,
    temperature: 0.2,
  });
  return r.data.people.slice(0, cap).filter((x) => x.name.trim()).map((x) => addPerson(bookId, { name: x.name, hook: x.hook, origin: "interview" })).filter(Boolean) as Person[];
}

/** After a narrator card is saved: the people it names go into its people book's roster. */
export async function harvestFromCreator(draftId: string) {
  const d = getCreatorDraft(draftId);
  if (!d?.savedId || d.kind !== "character" || d.options.mode !== "narrator") return null;
  const material = [d.idea, ...d.facts.map((f) => f.text), ...d.questions.filter((q) => q.answer.trim()).map((q) => q.answer), d.bible.find((b) => b.key === "relationships")?.text ?? ""].join("\n");
  const bookId = ensureRoleBook("people", { type: "character", id: d.savedId, name: d.name });
  await harvestPeople(bookId, material);
  return bookId;
}

const entryFor = (name: string, content: string, keys: string[]) => withCategory(defaultEntry({ comment: name, keys: [...new Set([name, ...keys])].slice(0, 6), content: content.trim(), extra: { person: true } }), "character", { defaults: true });

/** "Extra": two or three background lines in the book, enough for the narrator to use them in passing. */
export async function fleshExtra(id: string) {
  const p = mustPerson(id);
  const book = mustBook(p.bookId);
  const r = await callJson({
    task: "helper",
    kind: "people:extra",
    name: "person_extra",
    schema: z.object({ content: z.string().default(""), keys: z.array(z.string()).default([]) }),
    system: `Write 2–3 short background lines about ${p.name} for a narrator to use in passing: who they are around here, one concrete detail, how they come across. Grounded in the world; no invented major canon. "keys": other names or words they'd be mentioned by. Reply with JSON only: {"content": "…", "keys": []}`,
    user: [`THE WORLD (${book.name}):\n${bookContext(p.bookId, 1500)}`, `THE PERSON: ${p.name}${p.hook ? `: ${p.hook}` : ""}`].join("\n\n"),
    maxTokens: 500,
    temperature: writeTemp(0.7),
  });
  const content = tidy(r.data.content);
  if (!content) throw new Error("The model wrote nothing. Try again.");
  const entry = p.entryId ? book.entries.find((e) => e.id === p.entryId) : undefined;
  const entryId = entry ? (updateEntry(entry.id, { ...entry, content }), entry.id) : createEntry(p.bookId, entryFor(p.name, content, r.data.keys)).id;
  return mutatePerson(id, (x) => {
    x.entryId = entryId;
    if (x.tier === "unfleshed") x.tier = "extra";
  });
}

const material = (p: Person) =>
  [
    `THE WORLD:\n${bookContext(p.bookId, 1500)}`,
    `THE PERSON: ${p.name}${p.hook ? `: ${p.hook}` : ""}`,
    p.entryId ? `THEIR ENTRY NOW:\n${getLorebook(p.bookId)?.entries.find((e) => e.id === p.entryId)?.content ?? ""}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

/** "Weave": the next question of a short interview aimed at making them voiceable. */
export async function personQuestion(id: string, steer = "") {
  const p = mustPerson(id);
  const asked = await askQuestion({
    kind: "people",
    subject: `${p.name}, a person in this world whom a narrator will voice`,
    material: material(p),
    asked: p.interview.map((a) => ({ q: a.q, a: a.answer })),
    targets: [],
    deepening: "what makes them voiceable: how they talk and what their voice does under pressure, what they want, where their lines are, what they know that others don't, and how they'd treat a newcomer",
    taste: [],
    steer,
    avoid: p.interview.filter((a) => !a.answer.trim()).map((a) => a.q),
  });
  if (!asked) throw new Error("No question came back. Try again.");
  return mutatePerson(id, (x) => {
    x.interview = x.interview.filter((a) => a.answer.trim());
    x.interview.push({ id: newId(), q: asked.q, why: asked.why, answer: "", source: "typed", directions: [], shown: [] });
  });
}

export function answerPerson(id: string, qid: string, answer: string, source: FactSource = "typed") {
  if (!answer.trim()) throw badRequest("Write an answer first");
  return mutatePerson(id, (p) => {
    const a = p.interview.find((x) => x.id === qid);
    if (!a) throw notFound("That question is gone");
    a.answer = answer.trim();
    a.source = source;
  });
}

export async function personDirections(id: string, qid: string, steer = "") {
  const p = mustPerson(id);
  const a = p.interview.find((x) => x.id === qid);
  if (!a) throw notFound("That question is gone");
  const list = await offerDirections({ kind: "people", question: a.q, why: a.why, material: material(p), taste: [], steer, avoid: a.shown });
  return mutatePerson(id, (x) => {
    const c = x.interview.find((y) => y.id === qid);
    if (c) {
      c.directions = list;
      c.shown = [...c.shown, ...list.map((d) => d.text)].slice(-12);
    }
  });
}

const PROFILE_CRITERIA: Criterion[] = [
  { key: "voiceable", label: "Voiceable", description: "A narrator could speak them from this alone: how they sound, what they want, where their lines are." },
  { key: "distinct_voice", label: "A voice of their own", description: "Their register and turns of phrase are specific, not a generic townsperson." },
  { key: "author_preserved", label: "Your words kept", description: "The author's answers survive in substance and wording; nothing beyond them is asserted as canon." },
  { key: "grounded", label: "Grounded in the world", description: "It fits the world's lore and naming, and contradicts nothing in it." },
];

const profileSchema = z.object({ content: z.string().default(""), keys: z.array(z.string()).default([]) });

/** "Weave now": the answers woven into one profile entry keyed by their name, checked, revised once if it fails. */
export async function weavePerson(id: string) {
  const p = mustPerson(id);
  const answered = p.interview.filter((a) => a.answer.trim());
  if (!answered.length) throw badRequest("Answer at least one question first");
  const qa = answered.map((a) => `Q: ${a.q}\nA: ${a.answer} [${SOURCE_MARK[a.source]}]`).join("\n\n");
  const write = async (fix = "") =>
    (
      await callJson({
        task: "summarizer",
        kind: "people:weave",
        name: "person_profile",
        schema: profileSchema,
        system: [
          `Weave the author's answers about ${p.name} into ONE profile entry a narrator speaks them from whenever they come up: their voice (register, rhythm, a phrase or two in quotes), what they want, what they know, and where their lines are. 80–180 words, third person by name, no mention of the interview or the author.`,
          "Keep the author's specifics verbatim; add nothing they didn't establish beyond what the world already says.",
          fix ? `A first try failed these checks; fix exactly them: ${fix}` : "",
          '"keys": other names or words they\'d be mentioned by. Reply with JSON only: {"content": "…", "keys": []}',
        ]
          .filter(Boolean)
          .join("\n\n"),
        user: [material(p), `THE AUTHOR'S ANSWERS:\n${qa}`].join("\n\n"),
        maxTokens: 900,
        temperature: writeTemp(0.6),
      })
    ).data;
  const judge = (content: string) => runGate({ kind: "people:weave-gate", name: "person_profile_gate", what: `a voiced profile of ${p.name} for a narrator`, criteria: PROFILE_CRITERIA, user: [material(p), `THE AUTHOR'S ANSWERS:\n${qa}`, `THE TEXT TO JUDGE:\n${content}`].join("\n\n") });
  let out = await write();
  let gate = await judge(out.content);
  if (!gate.passed) {
    out = await write(failedNotes(gate));
    gate = await judge(out.content);
  }
  const content = tidy(out.content);
  if (!content) throw new Error("The model wrote nothing. Try again.");
  const book = mustBook(p.bookId);
  const entry = p.entryId ? book.entries.find((e) => e.id === p.entryId) : undefined;
  const entryId = entry ? (updateEntry(entry.id, { ...entry, content, keys: [...new Set([...entry.keys, ...out.keys])].slice(0, 8) }), entry.id) : createEntry(p.bookId, entryFor(p.name, content, out.keys)).id;
  return mutatePerson(id, (x) => {
    x.entryId = entryId;
    x.tier = "named";
    x.gate = gate;
  });
}

/** How many answers count as enough for a solid profile (settings). */
export const enoughAnswers = () => namedTarget();

/** "Promote": a character build pre-seeded with everything the world knows about them; the card will carry the world's book. */
export function promotePerson(id: string) {
  const p = mustPerson(id);
  if (p.creatorDraftId && getCreatorDraft(p.creatorDraftId)) return { person: p, draftId: p.creatorDraftId };
  if (!p.entryId) throw badRequest(`Flesh ${p.name} out first`);
  const answers = p.interview.filter((a) => a.answer.trim()).map((a) => `Q: ${a.q}\nA: ${a.answer}`).join("\n\n");
  const draft = createCreatorDraft({ kind: "character", name: p.name, fromEntry: { bookId: p.bookId, entryId: p.entryId }, personId: p.id, idea: [p.hook, answers && `WHAT THE AUTHOR SAID ABOUT THEM:\n${answers}`].filter(Boolean).join("\n\n") });
  return { person: mutatePerson(id, (x) => void (x.creatorDraftId = draft.id)), draftId: draft.id };
}

/** Called when the promoted card is saved: the roster shows them as in-universe. */
export function markPromoted(personId: string, draftId: string, characterId: string | null) {
  if (!one<Row>("SELECT id FROM lore_people WHERE id = ?", personId)) return;
  mutatePerson(personId, (p) => {
    p.creatorDraftId = draftId;
    if (characterId) p.characterId = characterId;
  });
}
