import { z } from "zod";
import { all, newId, now, one, parseJson, run, tx } from "../db/db";
import { publish } from "../lib/events";
import { badRequest, notFound } from "../lib/http";
import { countTokens } from "../lib/tokens";
import { embeddingsEnabled } from "../memory/embed";
import { getCard } from "../services/characters";
import { Deferred, enqueue, type JobContext } from "../services/jobs";
import { callJson } from "../services/llm";
import { applyExpansionPatch, deepenSection, type Expansion, type ExpansionPatch, expandIdea, expansionBlock } from "../creator/expand";
import { getPersona } from "../services/personas";
import { essentialsOf, extraOf } from "./activate";
import { ENTRY_TEMPLATES } from "./assist";
import { baseTitle, cleanTitle, type EntryType, entryFromSource, firstSentences, parseDocument } from "./ingest";
import { checkEntries, type EntryLength, STOCK_NAMES, STOCK_PHRASES } from "./quality";
import { createEntry, createLorebook, getLorebook, type LinkType, linkLorebook, linkedBooks, updateEntry } from "./service";
import { defaultEntry } from "./types";

/**
 * The Lore Studio (Phase 4): a lorebook written with you, not for you. The flow mirrors the
 * character studio (CHAR-08): Start (an idea, a card, a persona, a document, or a book to grow)
 * → Questions (what the model understood, and what it still needs) → Plan (an overview and an
 * outline you edit) → Write (each entry drafted in the background, in order, so later entries
 * know the earlier ones) → Review (quality checks, edits, re-drafts) → Save into a book.
 *
 * Covers CHAR-18 (companion lorebook from a card), PER-03 (persona lorebooks) and LORE-16
 * (documents become draft entries without a model call). Drafts persist until you save or drop them.
 */

export type SourceKind = "idea" | "character" | "persona" | "document" | "book";
export type Stage = "start" | "questions" | "plan" | "review" | "done";
export const ENTRY_TYPES = Object.keys(ENTRY_TEMPLATES) as EntryType[];

export interface StudioOptions {
  /** How many entries a plan aims for. */
  size: "small" | "medium" | "large";
  length: EntryLength;
  /** Kinds of entries to plan (empty: any). */
  types: EntryType[];
  tone: string;
  style: string;
  /** Hidden truths with who knows them (LORE-09); the leak guard watches them. */
  secrets: boolean;
  /** Only what the source says; no invented details. */
  faithful: boolean;
  /** Save the overview as an always-on entry. */
  overview: boolean;
}

export interface StudioEntry {
  content: string;
  keys: string[];
  aliases: string[];
  essentials: string;
  secrets: { text: string; knownBy: string[] }[];
}

export interface StudioItem {
  id: string;
  title: string;
  type: EntryType | null;
  pitch: string;
  /** Another item's id, or "entry:<id>" for an entry already in the target book. */
  parent: string;
  folder: string;
  /** Verbatim notes from a document; a faithful draft keeps to them. */
  source: string;
  constant: boolean;
  keep: boolean;
  status: "planned" | "queued" | "writing" | "drafted" | "error";
  error: string;
  entry: StudioEntry | null;
  /** The draft before the last re-write, so it can be restored. */
  previous: StudioEntry | null;
  /** Steering for the next (or last) write: "darker", "shorter", "add a rival"… */
  steer: string;
  /** Set once the item is saved into a book, so saving again doesn't duplicate it. */
  savedEntryId: string | null;
  /** A character or persona made from this entry in the creator (links both ways). */
  links: { creatorDraftId?: string; characterId?: string; personaId?: string };
}

export interface StudioQuestion {
  id: string;
  q: string;
  why: string;
  answer: string;
}

export interface StudioDraft {
  id: string;
  title: string;
  stage: Stage;
  source: { kind: SourceKind; text: string; refId: string | null; refName: string; fileName: string };
  options: StudioOptions;
  readback: { understood: string; missing: string[] } | null;
  questions: StudioQuestion[];
  directions: { title: string; pitch: string }[];
  /** "Expand my idea": the idea fleshed out section by section; fed to the plan and the writer. */
  expansion: Expansion | null;
  overview: string;
  items: StudioItem[];
  /** Where Save puts the entries: an existing book (always for "book" sources), or a new one. */
  targetBookId: string | null;
  links: { type: LinkType; id: string }[];
  committedBookId: string | null;
  consistency: { items: string[]; problem: string; fix: string }[] | null;
  createdAt: number;
  updatedAt: number;
}

export const defaultOptions = (kind: SourceKind = "idea"): StudioOptions => ({
  size: "medium",
  length: "standard",
  types: [],
  tone: "",
  style: "",
  secrets: kind !== "document",
  faithful: kind === "document",
  overview: kind === "idea" || kind === "document",
});

const PLAN_SIZE = { small: 8, medium: 15, large: 26 } as const;
const WORDS = { lean: "50–90", standard: "90–170", rich: "160–280" } as const;
/** Model input is capped so a huge document can't eat the quota in one call. */
const MAX_SOURCE_CHARS = 60_000;

// ---------- storage ----------

interface Row {
  id: string;
  title: string;
  data: string;
  created_at: number;
  updated_at: number;
}

function hydrate(r: Row): StudioDraft {
  const d = parseJson<Partial<StudioDraft>>(r.data, {});
  const kind = d.source?.kind ?? "idea";
  return {
    id: r.id,
    title: r.title,
    stage: d.stage ?? "start",
    source: { kind, text: "", refId: null, refName: "", fileName: "", ...d.source },
    options: { ...defaultOptions(kind), ...d.options },
    readback: d.readback ?? null,
    questions: d.questions ?? [],
    directions: d.directions ?? [],
    expansion: d.expansion ?? null,
    overview: d.overview ?? "",
    items: (d.items ?? []).map(normItem),
    targetBookId: d.targetBookId ?? null,
    links: d.links ?? [],
    committedBookId: d.committedBookId ?? null,
    consistency: d.consistency ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function normItem(i: Partial<StudioItem>): StudioItem {
  return {
    id: i.id ?? newId(),
    title: i.title ?? "Untitled",
    type: i.type && ENTRY_TYPES.includes(i.type) ? i.type : null,
    pitch: i.pitch ?? "",
    parent: i.parent ?? "",
    folder: i.folder ?? "",
    source: i.source ?? "",
    constant: i.constant ?? false,
    keep: i.keep ?? true,
    status: i.status ?? (i.entry ? "drafted" : "planned"),
    error: i.error ?? "",
    entry: i.entry ?? null,
    previous: i.previous ?? null,
    steer: i.steer ?? "",
    savedEntryId: i.savedEntryId ?? null,
    links: i.links ?? {},
  };
}

function write(d: StudioDraft) {
  const { id, title, createdAt: _c, updatedAt: _u, ...data } = d;
  d.updatedAt = now();
  run("UPDATE lore_drafts SET title = ?, data = ?, updated_at = ? WHERE id = ?", title, JSON.stringify(data), d.updatedAt, id);
  publish({ type: "studio.changed", draftId: id });
}

export function getDraft(id: string): StudioDraft | undefined {
  const r = one<Row>("SELECT * FROM lore_drafts WHERE id = ?", id);
  return r ? hydrate(r) : undefined;
}

export function mustDraft(id: string) {
  const d = getDraft(id);
  if (!d) throw notFound("Draft not found");
  return d;
}

/**
 * Read-modify-write in one synchronous step: the background writer and your edits both go through
 * here, so neither overwrites the other's newer change.
 */
export function mutate(id: string, fn: (d: StudioDraft) => void) {
  const d = mustDraft(id);
  fn(d);
  write(d);
  return d;
}

export function listDrafts() {
  return all<Row>("SELECT * FROM lore_drafts ORDER BY updated_at DESC").map((r) => {
    const d = hydrate(r);
    return {
      id: d.id,
      title: d.title,
      stage: d.stage,
      kind: d.source.kind,
      refName: d.source.refName,
      items: d.items.length,
      drafted: d.items.filter((i) => i.entry).length,
      writing: d.items.filter((i) => i.status === "queued" || i.status === "writing").length,
      committedBookId: d.committedBookId,
      updatedAt: d.updatedAt,
    };
  });
}

export function deleteDraft(id: string) {
  run("DELETE FROM lore_drafts WHERE id = ?", id);
  publish({ type: "studio.changed", draftId: id });
}

// ---------- sources ----------

function cardSource(characterId: string) {
  const card = getCard(characterId);
  if (!card) throw notFound("Character not found");
  const field = (label: string, v: string, max = 4000) => (v?.trim() ? `${label}: ${v.trim().slice(0, max)}` : "");
  const text = [
    `CHARACTER: ${card.name}`,
    field("Description", card.description),
    field("Personality", card.personality),
    field("Scenario", card.scenario),
    field("First message", card.first_mes, 1500),
    field("Example dialogue", card.mes_example, 1200),
    field("Creator notes", card.creator_notes, 800),
  ]
    .filter(Boolean)
    .join("\n\n");
  return { name: card.name, text };
}

function personaSource(personaId: string) {
  const p = getPersona(personaId);
  if (!p) throw notFound("Persona not found");
  const d = p.data;
  const text = [`PERSONA (the user's character): ${p.name}${d.pronouns ? ` (${d.pronouns})` : ""}`, d.description && `Description: ${d.description}`, d.appearance && `Appearance: ${d.appearance}`, d.personality && `Personality: ${d.personality}`, d.background && `Background: ${d.background}`]
    .filter(Boolean)
    .join("\n\n");
  return { name: p.name, text };
}

function bookSource(bookId: string) {
  const book = getLorebook(bookId);
  if (!book) throw notFound("Lorebook not found");
  const lines = book.entries.filter((e) => e.content.trim()).map((e) => `- ${e.comment || e.keys[0] || "Untitled"}${extraOf(e).type ? ` (${extraOf(e).type})` : ""}: ${essentialsOf({ ...e, bookId: book.id, bookName: book.name, book: book.settings })}`);
  return { name: book.name, text: [`LOREBOOK: ${book.name}`, book.description && `About: ${book.description}`, lines.length ? `ENTRIES:\n${lines.join("\n")}` : "No entries yet."].filter(Boolean).join("\n\n") };
}

/** Capitalized only because they start a sentence. */
const COMMON_WORDS = new Set(
  "the a an in on at it he she they we i you this that these those there here when after before once every most some many but and or if her his their its our my your above below near beyond inside outside under over locals everyone nobody someone people now then today later soon each all both few no not none what who why how where which whose with without from for to by as since while though although because so yet still only even also just perhaps sometimes often one two three".split(" "),
);

/** Names the book's entries mention that have no entry of their own: the obvious gaps. */
export function missingNames(bookId: string) {
  const book = getLorebook(bookId);
  if (!book) return [];
  const covered = new Set(book.entries.flatMap((e) => [e.comment, ...e.keys, ...(extraOf(e).aliases ?? [])]).map((s) => s.trim().toLowerCase()).filter(Boolean));
  const counts = new Map<string, number>();
  for (const e of book.entries) {
    const seenHere = new Set<string>();
    for (const m of e.content.matchAll(/\b[A-Z][\p{L}'’-]+(?:\s+(?:of\s+|the\s+)?[A-Z][\p{L}'’-]+)*/gu)) {
      // A sentence can start with an ordinary word: "Above Port Ellis" is about Port Ellis.
      const words = m[0].trim().split(/\s+/);
      while (words.length && COMMON_WORDS.has(words[0]!.toLowerCase())) words.shift();
      const n = words.join(" ");
      if (n.length < 3 || covered.has(n.toLowerCase()) || seenHere.has(n)) continue;
      seenHere.add(n);
      counts.set(n, (counts.get(n) ?? 0) + 1);
    }
  }
  return [...counts].filter(([, c]) => c >= 2).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([n]) => n);
}

/** Lore the source already has (linked books), so the plan doesn't repeat it. */
function existingTitles(d: StudioDraft) {
  const books = d.source.kind === "character" && d.source.refId ? linkedBooks("character", d.source.refId) : d.source.kind === "persona" && d.source.refId ? linkedBooks("persona", d.source.refId) : [];
  const ids = new Set([...books.map((b) => b.id), ...(d.targetBookId ? [d.targetBookId] : [])]);
  return [...ids].flatMap((id) => getLorebook(id)?.entries.map((e) => e.comment || e.keys[0] || "").filter(Boolean) ?? []);
}

// ---------- create ----------

export interface CreateInput {
  kind: SourceKind;
  text?: string;
  refId?: string | null;
  fileName?: string;
  title?: string;
  options?: Partial<StudioOptions>;
}

export function createDraft(input: CreateInput): StudioDraft {
  const id = newId();
  const t = now();
  const options = { ...defaultOptions(input.kind), ...input.options };
  const d: StudioDraft = {
    id,
    title: input.title?.trim() || "",
    stage: "start",
    source: { kind: input.kind, text: input.text?.trim() ?? "", refId: input.refId ?? null, refName: "", fileName: input.fileName ?? "" },
    options,
    readback: null,
    questions: [],
    directions: [],
    expansion: null,
    overview: "",
    items: [],
    targetBookId: null,
    links: [],
    committedBookId: null,
    consistency: null,
    createdAt: t,
    updatedAt: t,
  };
  if (input.kind === "character") {
    if (!input.refId) throw badRequest("Pick a character");
    const s = cardSource(input.refId);
    d.source.refName = s.name;
    d.source.text = [s.text, input.text?.trim() && `AUTHOR'S NOTES: ${input.text.trim()}`].filter(Boolean).join("\n\n");
    d.title ||= `${s.name}'s world`;
    d.links = [{ type: "character", id: input.refId }];
  } else if (input.kind === "persona") {
    if (!input.refId) throw badRequest("Pick a persona");
    const s = personaSource(input.refId);
    d.source.refName = s.name;
    d.source.text = [s.text, input.text?.trim() && `AUTHOR'S NOTES: ${input.text.trim()}`].filter(Boolean).join("\n\n");
    d.title ||= `${s.name}'s past`;
    d.links = [{ type: "persona", id: input.refId }];
  } else if (input.kind === "book") {
    if (!input.refId) throw badRequest("Pick a lorebook");
    const s = bookSource(input.refId);
    d.source.refName = s.name;
    d.source.text = [s.text, input.text?.trim() && `AUTHOR'S NOTES: ${input.text.trim()}`].filter(Boolean).join("\n\n");
    d.title ||= s.name;
    d.targetBookId = input.refId;
  } else if (input.kind === "document") {
    if (!input.text?.trim()) throw badRequest("The document is empty");
    const doc = parseDocument(input.text, input.fileName);
    d.title ||= doc.title;
    d.overview = doc.overview;
    const ids = doc.sections.map(() => newId());
    d.items = doc.sections.map((s, k) =>
      normItem({ id: ids[k], title: s.title, type: s.type, pitch: "", parent: s.parent >= 0 ? ids[s.parent]! : "", folder: s.folder, source: s.source, entry: s.source.trim() ? entryFromSource(s.title, s.source) : null, status: s.source.trim() ? "drafted" : "planned" }),
    );
    // Every key needs a home: a section with no text keeps its title as a key once it's written.
    for (const i of d.items) if (i.entry) i.title = baseTitle(i.title);
    d.stage = d.items.length ? "review" : "plan";
  } else {
    if (!input.text?.trim()) throw badRequest("Describe the world first");
    d.title ||= "";
  }
  d.title ||= "Untitled world";
  const { id: _i, title, createdAt: _c, updatedAt: _u, ...data } = d;
  run("INSERT INTO lore_drafts (id, title, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)", id, title, JSON.stringify(data), t, t);
  publish({ type: "studio.changed", draftId: id });
  return d;
}

// ---------- edits ----------

export interface DraftPatch {
  title?: string;
  stage?: Stage;
  text?: string;
  options?: Partial<StudioOptions>;
  answers?: Record<string, string>;
  overview?: string;
  targetBookId?: string | null;
  links?: { type: LinkType; id: string }[];
  expansion?: ExpansionPatch;
}

export function patchDraft(id: string, p: DraftPatch) {
  return mutate(id, (d) => {
    if (p.title !== undefined) d.title = p.title.trim() || d.title;
    if (p.stage) d.stage = p.stage;
    if (p.text !== undefined) d.source.text = p.text;
    if (p.options) d.options = { ...d.options, ...p.options };
    if (p.answers) for (const q of d.questions) if (p.answers[q.id] !== undefined) q.answer = p.answers[q.id]!;
    if (p.overview !== undefined) d.overview = p.overview;
    if (p.targetBookId !== undefined) d.targetBookId = p.targetBookId;
    if (p.links) d.links = p.links;
    if (p.expansion) applyExpansionPatch(d, p.expansion);
  });
}

export type ItemPatch = Partial<Pick<StudioItem, "title" | "type" | "pitch" | "parent" | "folder" | "source" | "constant" | "keep" | "steer">> & { entry?: StudioEntry | null };

export function patchItem(id: string, itemId: string, p: ItemPatch) {
  return mutate(id, (d) => {
    const it = d.items.find((i) => i.id === itemId);
    if (!it) throw notFound("Item not found");
    if (p.title !== undefined) it.title = cleanTitle(p.title) || it.title;
    if (p.type !== undefined) it.type = p.type && ENTRY_TYPES.includes(p.type) ? p.type : null;
    if (p.pitch !== undefined) it.pitch = p.pitch;
    if (p.parent !== undefined) it.parent = p.parent === itemId ? "" : p.parent;
    if (p.folder !== undefined) it.folder = p.folder.trim();
    if (p.source !== undefined) it.source = p.source;
    if (p.constant !== undefined) it.constant = p.constant;
    if (p.keep !== undefined) it.keep = p.keep;
    if (p.steer !== undefined) it.steer = p.steer;
    if (p.entry !== undefined) {
      it.entry = p.entry && { ...p.entry, keys: dedupe(p.entry.keys), aliases: dedupe(p.entry.aliases) };
      if (it.entry && it.status !== "queued" && it.status !== "writing") it.status = "drafted";
    }
  });
}

export function addItem(id: string, p: ItemPatch) {
  let made: StudioItem | null = null;
  const d = mutate(id, (d) => {
    made = normItem({ title: cleanTitle(p.title ?? "") || "New entry", type: p.type ?? null, pitch: p.pitch ?? "", parent: p.parent ?? "", folder: p.folder ?? "", source: p.source ?? "", constant: p.constant ?? false });
    d.items.push(made);
  });
  return { draft: d, item: made! };
}

export function removeItem(id: string, itemId: string) {
  return mutate(id, (d) => {
    d.items = d.items.filter((i) => i.id !== itemId);
    for (const i of d.items) if (i.parent === itemId) i.parent = "";
  });
}

export function reorderItems(id: string, ids: string[]) {
  return mutate(id, (d) => {
    const pos = new Map(ids.map((x, k) => [x, k]));
    d.items.sort((a, b) => (pos.get(a.id) ?? 1e9) - (pos.get(b.id) ?? 1e9));
  });
}

export function restorePrevious(id: string, itemId: string) {
  return mutate(id, (d) => {
    const it = d.items.find((i) => i.id === itemId);
    if (!it?.previous) throw badRequest("Nothing to restore");
    [it.entry, it.previous] = [it.previous, it.entry];
    it.status = "drafted";
  });
}

const dedupe = (xs: string[]) => [...new Map(xs.map((x) => x.trim()).filter(Boolean).map((x) => [x.toLowerCase(), x])).values()];

// ---------- model steps ----------

const sourceBlock = (d: StudioDraft) => {
  const text = d.source.text.length > MAX_SOURCE_CHARS ? `${d.source.text.slice(0, MAX_SOURCE_CHARS)}\n[…the rest is cut for length]` : d.source.text;
  const label = { idea: "THE AUTHOR'S IDEA", character: "THE CHARACTER CARD", persona: "THE PERSONA", document: "THE DOCUMENT", book: "THE EXISTING LOREBOOK" }[d.source.kind];
  return [`${label}:\n${text || "(nothing yet)"}`, expansionBlock(d.expansion)].filter(Boolean).join("\n\n");
};

const answersBlock = (d: StudioDraft) => {
  const qa = d.questions.filter((q) => q.answer.trim());
  return qa.length ? `THE AUTHOR'S ANSWERS (their own words; they outrank your ideas):\n${qa.map((q) => `Q: ${q.q}\nA: ${q.answer.trim()}`).join("\n\n")}` : "";
};

const prefsBlock = (d: StudioDraft) =>
  [d.options.tone.trim() && `TONE AND GENRE: ${d.options.tone.trim()}`, d.options.style.trim() && `STYLE NOTES: ${d.options.style.trim()}`, d.options.types.length ? `ENTRY KINDS WANTED: ${d.options.types.join(", ")}` : ""].filter(Boolean).join("\n");

const PURPOSE: Record<SourceKind, string> = {
  idea: "Build it from the author's idea and answers.",
  character:
    "This is a companion lorebook for a character card: the events of their past, the people in their life, the places they know, the things they own or want, and the parts of their world their story needs. Don't make an entry for the character themself: the card covers them. Stay consistent with the card.",
  persona: "This is a lorebook for the user's own persona: the people, places, history and possessions around them, so stories can draw on their past. Don't make an entry for the persona themself. Stay consistent with the persona.",
  document: "Turn the author's document into entries. Use only what the document says.",
  book: "Grow an existing lorebook: propose entries it lacks. Never repeat an entry it has.",
};

const AVOID = `Avoid names models overuse (${STOCK_NAMES.slice(0, 18).join(", ")}…) unless the author used them, and filler phrases (${STOCK_PHRASES.slice(0, 10).join(", ")}…).`;

const readbackSchema = z.object({
  understood: z.string().default(""),
  missing: z.array(z.string()).default([]),
  questions: z.array(z.object({ q: z.string(), why: z.string().default("") })).default([]),
});

/** Read-back + Interview: what the model understood, and a few pointed questions with why they matter. */
export async function readBack(id: string, opts: { count?: number } = {}) {
  const d = mustDraft(id);
  const n = Math.min(6, Math.max(1, opts.count ?? 4));
  const r = await callJson({
    task: "helper",
    kind: "studio:readback",
    name: "studio_readback",
    schema: readbackSchema,
    system: `You help an author build a lorebook for interactive fiction (roleplay). ${PURPOSE[d.source.kind]} Read their material, then reply with: "understood": 2–4 sentences on what you understood (premise, tone, what's central); "missing": up to 4 short phrases naming what's still unclear; "questions": up to ${n} pointed questions worth asking, most important first, each with "why" (one short sentence on what the answer changes in the lorebook). Ask about tension, specifics and the author's intent, never trivia, and never what the material already answers. Reply with JSON only: {"understood": "…", "missing": ["…"], "questions": [{"q": "…", "why": "…"}]}`,
    user: [sourceBlock(d), answersBlock(d), prefsBlock(d)].filter(Boolean).join("\n\n"),
    maxTokens: 1200,
    temperature: 0.6,
  });
  return mutate(id, (cur) => {
    cur.readback = { understood: r.data.understood.trim(), missing: r.data.missing.map((m) => m.trim()).filter(Boolean).slice(0, 4) };
    // Answered questions stay; new ones are added after them.
    const answered = cur.questions.filter((q) => q.answer.trim());
    const have = new Set(answered.map((q) => q.q.trim().toLowerCase()));
    cur.questions = [...answered, ...r.data.questions.filter((q) => q.q.trim() && !have.has(q.q.trim().toLowerCase())).slice(0, n).map((q) => ({ id: newId(), q: q.q.trim(), why: q.why.trim(), answer: "" }))];
    if (cur.stage === "start") cur.stage = "questions";
  });
}

// ---------- expand my idea ----------

const expandCtx = (d: StudioDraft) => ({
  idea: d.source.text.length > MAX_SOURCE_CHARS ? d.source.text.slice(0, MAX_SOURCE_CHARS) : d.source.text,
  answers: d.questions
    .filter((q) => q.answer.trim())
    .map((q) => `Q: ${q.q}\nA: ${q.answer.trim()}`)
    .join("\n\n"),
  tone: d.options.tone,
  style: d.options.style,
});

/** "Expand my idea": the whole concept, or a rework of it with a steer ("darker", "more political"). */
export async function expandLore(id: string, steer = "") {
  const d = mustDraft(id);
  if (!d.source.text.trim()) throw badRequest("Describe the world first");
  const e = await expandIdea("world", expandCtx(d), { previous: d.expansion, steer });
  return mutate(id, (cur) => void (cur.expansion = e));
}

export async function deepenLore(id: string, sectionId: string, steer = "") {
  const d = mustDraft(id);
  if (!d.expansion) throw badRequest("Expand the idea first");
  const text = await deepenSection("world", expandCtx(d), d.expansion, sectionId, steer);
  return mutate(id, (cur) => {
    const s = cur.expansion?.sections.find((x) => x.id === sectionId);
    if (s) s.text = text;
  });
}

const directionsSchema = z.object({ directions: z.array(z.object({ title: z.string(), pitch: z.string() })).default([]) });

/** Stuck helper (CHAR-10 for worlds): three genuinely different takes, steerable ("darker", "stranger"). */
export async function directions(id: string, steer = "") {
  const d = mustDraft(id);
  const r = await callJson({
    task: "helper",
    kind: "studio:directions",
    name: "studio_directions",
    schema: directionsSchema,
    system: `You help an author shape a setting for interactive fiction. Offer three genuinely different directions their material could take: different central tensions, not three flavours of one. Each: "title" (2–5 words) and "pitch" (two concrete sentences). ${steer.trim() ? `Lean: ${steer.trim()}.` : ""} ${AVOID} Reply with JSON only: {"directions": [{"title": "…", "pitch": "…"}]}`,
    user: [sourceBlock(d), answersBlock(d), prefsBlock(d)].filter(Boolean).join("\n\n"),
    maxTokens: 900,
    temperature: 0.9,
  });
  return mutate(id, (cur) => {
    cur.directions = r.data.directions.filter((x) => x.title.trim() && x.pitch.trim()).slice(0, 3);
  });
}

const outlineSchema = z.object({
  title: z.string().default(""),
  overview: z.string().default(""),
  items: z.array(z.object({ title: z.string(), type: z.string().default(""), pitch: z.string().default(""), parent: z.string().default(""), folder: z.string().default("") })).default([]),
});

/** Plan: the overview (the "bible") and an outline of entries. "more" adds to the plan instead of replacing it. */
export async function planOutline(id: string, opts: { mode?: "replace" | "more"; steer?: string; count?: number } = {}) {
  const d = mustDraft(id);
  const more = opts.mode === "more";
  const n = opts.count ?? (more ? Math.max(4, Math.round(PLAN_SIZE[d.options.size] / 3)) : PLAN_SIZE[d.options.size]);
  const planned = d.items.map((i) => `- ${i.title}${i.type ? ` (${i.type})` : ""}${i.pitch ? `: ${i.pitch}` : ""}`);
  const existing = existingTitles(d);
  const gaps = d.source.kind === "book" && d.source.refId ? missingNames(d.source.refId) : [];
  const typeList = (d.options.types.length ? d.options.types : ENTRY_TYPES).join(", ");
  const r = await callJson({
    task: "summarizer",
    kind: "studio:outline",
    name: "studio_outline",
    schema: outlineSchema,
    system: [
      "You plan a lorebook for interactive fiction (roleplay). A lorebook is a set of short entries a storyteller sees only when they matter: the people, places, items, factions, concepts, events and rules of a world.",
      PURPOSE[d.source.kind],
      more ? `The plan already has the entries listed under ALREADY PLANNED. Propose up to ${n} NEW entries that fill its gaps; never repeat one.` : `Plan about ${n} entries.`,
      `Each item: "title" (the name as the story would say it), "type" (one of: ${typeList}), "pitch" (one sentence: what the entry establishes and why a scene would need it), "parent" (the title of another planned entry it sits inside: a district inside a city, a member inside a faction; else ""), "folder" (a short path like "Places › Port Ellis", else "").`,
      more ? 'Leave "overview" and "title" empty.' : `Also "title" (a name for the lorebook, 1–5 words) and "overview" (80–150 words: the world's premise, tone, and the ground truths every scene should respect).`,
      d.options.faithful ? "Use only what the source says: no invented names, places or facts." : "Prefer specific, playable details with tension: things characters can want, fear, visit, use or argue about. Invent freely where the material is silent, but never against it.",
      AVOID,
      opts.steer?.trim() ? `The author asks: ${opts.steer.trim()}` : "",
      'Reply with JSON only: {"title": "…", "overview": "…", "items": [{"title": "…", "type": "…", "pitch": "…", "parent": "", "folder": ""}]}',
    ]
      .filter(Boolean)
      .join(" "),
    user: [
      sourceBlock(d),
      answersBlock(d),
      prefsBlock(d),
      d.overview.trim() && more ? `OVERVIEW:\n${d.overview.trim()}` : "",
      planned.length && more ? `ALREADY PLANNED:\n${planned.join("\n")}` : "",
      existing.length ? `ALREADY IN THEIR LORE (don't repeat):\n${existing.slice(0, 120).join(", ")}` : "",
      gaps.length ? `NAMED IN THE BOOK BUT WITHOUT AN ENTRY (good candidates):\n${gaps.join(", ")}` : "",
    ]
      .filter(Boolean)
      .join("\n\n"),
    maxTokens: 4000,
    temperature: d.options.faithful ? 0.3 : 0.8,
  });
  return mutate(id, (cur) => {
    const taken = new Set([...(more ? cur.items.map((i) => i.title.toLowerCase()) : []), ...existing.map((t) => t.toLowerCase())]);
    const fresh = r.data.items
      .map((x) => ({ ...x, title: cleanTitle(x.title) }))
      .filter((x) => x.title && !taken.has(x.title.toLowerCase()) && (taken.add(x.title.toLowerCase()), true))
      .slice(0, more ? n : 60)
      .map((x) => normItem({ title: x.title, type: (ENTRY_TYPES as string[]).includes(x.type.toLowerCase()) ? (x.type.toLowerCase() as EntryType) : null, pitch: x.pitch.trim(), folder: x.folder.trim(), parent: x.parent.trim() }));
    // Parents come back as titles; point them at items (this plan's or the earlier ones).
    const pool = more ? [...cur.items, ...fresh] : fresh;
    const book = cur.targetBookId ? getLorebook(cur.targetBookId) : undefined;
    for (const it of fresh) {
      if (!it.parent) continue;
      const t = it.parent.toLowerCase();
      const p = pool.find((o) => o.id !== it.id && o.title.toLowerCase() === t);
      const e = !p && book?.entries.find((x) => (x.comment || "").toLowerCase() === t);
      it.parent = p ? p.id : e ? `entry:${e.id}` : "";
    }
    if (more) cur.items.push(...fresh);
    else {
      // Replanning keeps what you've already written or edited.
      const kept = cur.items.filter((i) => i.entry || i.status === "queued" || i.status === "writing");
      const keptTitles = new Set(kept.map((i) => i.title.toLowerCase()));
      cur.items = [...kept, ...fresh.filter((i) => !keptTitles.has(i.title.toLowerCase()))];
      if (r.data.overview.trim() && (!cur.overview.trim() || cur.source.kind !== "document")) cur.overview = r.data.overview.trim();
      if (r.data.title.trim() && (cur.title === "Untitled world" || !cur.title.trim())) cur.title = cleanTitle(r.data.title);
    }
    if (cur.stage === "start" || cur.stage === "questions") cur.stage = "plan";
  });
}

// ---------- writing (background) ----------

const entrySchema = z.object({
  content: z.string().min(1),
  keys: z.array(z.string()).default([]),
  aliases: z.array(z.string()).default([]),
  essentials: z.string().default(""),
  secrets: z.array(z.object({ text: z.string(), knownBy: z.array(z.string()).default([]) })).default([]),
});

/** Queues entries to be written (or rewritten) in the background, in plan order. */
export function queueWrite(id: string, opts: { itemIds?: string[]; steer?: string; all?: boolean } = {}) {
  const d = mutate(id, (d) => {
    const want = new Set(opts.itemIds ?? []);
    for (const it of d.items) {
      const pick = opts.itemIds ? want.has(it.id) : opts.all ? it.keep : it.keep && !it.entry;
      if (!pick || it.status === "queued" || it.status === "writing") continue;
      it.status = "queued";
      it.error = "";
      if (opts.steer !== undefined) it.steer = opts.steer;
    }
    if (d.stage !== "done") d.stage = "review";
  });
  if (d.items.some((i) => i.status === "queued")) enqueue("lore.studio", { draftId: id }, { dedupeKey: `studio:${id}`, priority: 1, maxAttempts: 2 });
  return d;
}

export function stopWrite(id: string) {
  return mutate(id, (d) => {
    for (const it of d.items) if (it.status === "queued") it.status = it.entry ? "drafted" : "planned";
  });
}

/** The job: one entry at a time, re-reading the draft between them so your edits and stops apply. */
export async function runStudioJob(draftId: string, job?: JobContext) {
  if (!getDraft(draftId)) return;
  // A restart mid-write leaves "writing" items; they go back in line.
  mutate(draftId, (d) => {
    for (const it of d.items) if (it.status === "writing") it.status = "queued";
  });
  let done = 0;
  for (;;) {
    const d = getDraft(draftId);
    const next = d?.items.find((i) => i.status === "queued");
    if (!d || !next) break;
    mutate(draftId, (cur) => {
      const it = cur.items.find((i) => i.id === next.id);
      if (it) it.status = "writing";
    });
    try {
      const entry = await writeEntry(d, next, job);
      mutate(draftId, (cur) => {
        const it = cur.items.find((i) => i.id === next.id);
        if (!it) return;
        if (it.entry) it.previous = it.entry;
        it.entry = entry;
        it.status = "drafted";
        it.error = "";
      });
      done++;
      job?.note({ written: done });
    } catch (e) {
      if (e instanceof Deferred) {
        mutate(draftId, (cur) => {
          const it = cur.items.find((i) => i.id === next.id);
          if (it) it.status = "queued";
        });
        throw e;
      }
      mutate(draftId, (cur) => {
        const it = cur.items.find((i) => i.id === next.id);
        if (!it) return;
        it.status = "error";
        it.error = String((e as Error)?.message ?? e).slice(0, 400);
      });
    }
  }
}

export async function writeEntry(d: StudioDraft, it: StudioItem, job?: JobContext): Promise<StudioEntry> {
  const template = it.type ? ENTRY_TEMPLATES[it.type] : null;
  const titleOf = (ref: string) => {
    if (ref.startsWith("entry:")) {
      const book = d.targetBookId ? getLorebook(d.targetBookId) : undefined;
      const e = book?.entries.find((x) => x.id === ref.slice(6));
      return e ? { title: e.comment || e.keys[0] || "", essentials: essentialsOf({ ...e, bookId: "", bookName: "", book: {} }) } : null;
    }
    const p = d.items.find((x) => x.id === ref);
    return p ? { title: p.title, essentials: p.entry?.essentials || p.pitch } : null;
  };
  const parent = it.parent ? titleOf(it.parent) : null;
  // The rest of the plan, with what's written so far, keeps names and facts consistent across entries.
  const others = d.items
    .filter((x) => x.id !== it.id && x.keep)
    .slice(0, 80)
    .map((x) => `- ${x.title}${x.type ? ` (${x.type})` : ""}: ${x.entry?.essentials || x.pitch || "(not written yet)"}`);
  const faithful = d.options.faithful || Boolean(it.source.trim() && d.source.kind === "document");
  const cast = [d.source.kind === "character" ? d.source.refName : "", d.source.kind === "persona" ? d.source.refName : ""].filter(Boolean);
  const r = await callJson({
    task: "summarizer",
    kind: "studio:entry",
    jobId: job?.id,
    name: "studio_entry",
    schema: entrySchema,
    system: [
      `You write one lorebook entry for interactive fiction: "${it.title}"${it.type ? ` (${template!.label.toLowerCase()})` : ""}. The storyteller reads it only when the entry fires, so it must stand on its own.`,
      `"content": ${WORDS[d.options.length]} words, third person, present tense, plain declarative sentences a storyteller can use in a scene: concrete looks, behaviour, history, relationships and stakes.${template ? ` Cover what fits of: ${template.fields.join(", ")}.` : ""} No headings, no lists of adjectives, no meta commentary.`,
      `"keys": 2–6 trigger words: the names, nicknames and short phrases a story uses when this matters. Never common words that would fire on every message. "aliases": other names it goes by (can be empty). "essentials": one sentence, the single most important fact.`,
      d.options.secrets && !faithful ? `"secrets": 0–2 hidden truths that would change scenes if revealed, each with "knownBy" (who knows it, by name). Only where it fits; most entries have none.` : `"secrets": [] unless the source states a secret, with "knownBy" naming who knows it.`,
      faithful ? "Use only what the source notes say; keep every name, number and fact exact; add nothing." : "Stay consistent with the overview, the source and the rest of the plan; invent only details that fit.",
      AVOID,
      'Reply with JSON only: {"content": "…", "keys": ["…"], "aliases": ["…"], "essentials": "…", "secrets": [{"text": "…", "knownBy": ["…"]}]}',
    ].join(" "),
    user: [
      d.overview.trim() ? `OVERVIEW:\n${d.overview.trim()}` : "",
      d.source.kind === "document" ? "" : sourceBlock(d),
      answersBlock(d),
      prefsBlock(d),
      others.length ? `THE REST OF THE LOREBOOK:\n${others.join("\n")}` : "",
      parent ? `IT SITS INSIDE: ${parent.title}: ${parent.essentials}` : "",
      it.folder ? `FOLDER: ${it.folder}` : "",
      `THIS ENTRY: ${it.title}${it.type ? ` (${it.type})` : ""}${it.pitch ? `: ${it.pitch}` : ""}`,
      it.source.trim() ? `SOURCE NOTES FOR THIS ENTRY:\n${it.source.trim().slice(0, 12_000)}` : "",
      it.entry && it.steer.trim() ? `THE CURRENT DRAFT (rewrite it):\n${it.entry.content}` : "",
      it.steer.trim() ? `THE AUTHOR ASKS: ${it.steer.trim()}` : "",
      cast.length ? `MAIN CHARACTERS (may know secrets): ${cast.join(", ")}` : "",
    ]
      .filter(Boolean)
      .join("\n\n"),
    maxTokens: 1800,
    temperature: faithful ? 0.3 : 0.75,
  });
  const name = baseTitle(it.title);
  const keys = dedupe([name, ...r.data.keys].filter((k) => k.trim().length >= 2 && k.length <= 50 && !/[.!?]$/.test(k.trim())));
  return {
    content: r.data.content.trim(),
    keys: keys.slice(0, 8),
    aliases: dedupe(r.data.aliases).filter((a) => !keys.some((k) => k.toLowerCase() === a.toLowerCase())).slice(0, 6),
    essentials: r.data.essentials.trim() || firstSentences(r.data.content),
    secrets: r.data.secrets.filter((s) => s.text.trim()).map((s) => ({ text: s.text.trim(), knownBy: dedupe(s.knownBy) })).slice(0, 3),
  };
}

// ---------- review ----------

/** Quality checks over everything drafted, plus the token cost of saving it. */
export function reviewDraft(id: string) {
  const d = mustDraft(id);
  const book = d.targetBookId ? getLorebook(d.targetBookId) : undefined;
  const drafted = d.items.filter((i) => i.keep && i.entry);
  const cast = [d.source.refName, "{{char}}", "{{user}}"].filter(Boolean);
  const issues = checkEntries(
    drafted.map((i) => ({ id: i.id, title: i.title, constant: i.constant, content: i.entry!.content, keys: i.entry!.keys, aliases: i.entry!.aliases, essentials: i.entry!.essentials, secrets: i.entry!.secrets })),
    { existing: book?.entries.filter((e) => !d.items.some((i) => i.savedEntryId === e.id)).map((e) => ({ title: e.comment, keys: [...e.keys, ...(extraOf(e).aliases ?? [])] })), length: d.options.length, cast },
  );
  const tokens = Object.fromEntries(drafted.map((i) => [i.id, countTokens(i.entry!.content)]));
  const overviewTokens = d.options.overview ? countTokens(d.overview) : 0;
  return {
    issues,
    tokens,
    cost: {
      entries: drafted.length,
      totalTokens: Object.values(tokens).reduce((a, b) => a + b, 0) + overviewTokens,
      alwaysOnTokens: drafted.filter((i) => i.constant).reduce((n, i) => n + (tokens[i.id] ?? 0), 0) + overviewTokens,
      averageTokens: drafted.length ? Math.round(Object.values(tokens).reduce((a, b) => a + b, 0) / drafted.length) : 0,
    },
  };
}

const consistencySchema = z.object({ issues: z.array(z.object({ entries: z.array(z.number()).default([]), problem: z.string(), fix: z.string().default("") })).default([]) });

/** A model pass for contradictions between drafted entries (ages, dates, relations, places, rules). */
export async function consistencyCheck(id: string) {
  const d = mustDraft(id);
  const drafted = d.items.filter((i) => i.keep && i.entry);
  if (drafted.length < 2) return mutate(id, (cur) => void (cur.consistency = []));
  const r = await callJson({
    task: "summarizer",
    kind: "studio:consistency",
    name: "studio_consistency",
    schema: consistencySchema,
    system:
      'Check these lorebook entries for real contradictions with each other or with the overview: different ages, dates, family ties, places, ranks, or rules of the world. Ignore style and things that are merely unstated. Each issue cites the entries by number, says the problem in one sentence, and suggests a fix. Reply with JSON only: {"issues": [{"entries": [1, 3], "problem": "…", "fix": "…"}]}',
    user: [d.overview.trim() ? `OVERVIEW:\n${d.overview.trim()}` : "", `ENTRIES:\n${drafted.map((i, k) => `${k + 1}. ${i.title}: ${i.entry!.content.replace(/\s+/g, " ").slice(0, 900)}`).join("\n")}`].filter(Boolean).join("\n\n"),
    maxTokens: 1500,
  });
  return mutate(id, (cur) => {
    cur.consistency = r.data.issues
      .map((x) => ({ items: x.entries.map((n) => drafted[n - 1]?.id).filter((v): v is string => Boolean(v)), problem: x.problem.trim(), fix: x.fix.trim() }))
      .filter((x) => x.items.length && x.problem);
  });
}

// ---------- save ----------

export interface CommitInput {
  /** An existing book to add to; omitted means a new book. */
  bookId?: string | null;
  name?: string;
  description?: string;
  links?: { type: LinkType; id: string }[];
  overview?: boolean;
  itemIds?: string[];
}

/** Writes the kept, drafted entries into a book (parents resolved to entry ids). Saving twice never duplicates. */
export function commitDraft(id: string, input: CommitInput = {}) {
  const d = mustDraft(id);
  const pick = input.itemIds ? new Set(input.itemIds) : null;
  const items = d.items.filter((i) => i.keep && i.entry?.content.trim() && !i.savedEntryId && (!pick || pick.has(i.id)));
  const targetId = input.bookId === undefined ? d.targetBookId : input.bookId;
  const target = targetId ? getLorebook(targetId) : undefined;
  if (targetId && (!target || target.deletedAt)) throw notFound("Lorebook not found");
  const wantOverview = (input.overview ?? d.options.overview) && Boolean(d.overview.trim()) && !d.committedBookId;
  if (!items.length && !wantOverview) throw badRequest("Nothing new to save. Write some entries first.");
  let bookId = targetId ?? "";
  const saved = new Map<string, string>();
  tx(() => {
    if (!bookId)
      bookId = createLorebook({
        name: input.name?.trim() || d.title,
        description: input.description ?? (d.source.kind === "character" || d.source.kind === "persona" ? `Made in the Lore Studio from ${d.source.refName}.` : "Made in the Lore Studio."),
      });
    for (const l of input.links ?? d.links) linkLorebook(bookId, l.type, l.id);
    if (wantOverview) createEntry(bookId, defaultEntry({ comment: `${d.title}: overview`, constant: true, content: d.overview.trim(), order: 150, extra: { type: "concept", essentials: firstSentences(d.overview) } }));
    for (const it of items) {
      const e = it.entry!;
      const extra: Record<string, unknown> = { ...(it.type ? { type: it.type } : {}), ...(e.aliases.length ? { aliases: e.aliases } : {}), ...(e.essentials ? { essentials: e.essentials } : {}), ...(e.secrets.length ? { secrets: e.secrets } : {}), ...(it.folder ? { folder: it.folder } : {}) };
      const made = createEntry(bookId, defaultEntry({ comment: it.title, keys: e.keys, content: e.content, constant: it.constant, extra }));
      saved.set(it.id, made.id);
    }
    // Second pass: parents point at real entries now that every entry has an id (LORE-10).
    const book = getLorebook(bookId)!;
    for (const it of items) {
      if (!it.parent) continue;
      const parentId = it.parent.startsWith("entry:") ? it.parent.slice(6) : (saved.get(it.parent) ?? d.items.find((x) => x.id === it.parent)?.savedEntryId);
      const entry = book.entries.find((x) => x.id === saved.get(it.id));
      if (!parentId || !entry || !book.entries.some((x) => x.id === parentId)) continue;
      const { id: entryId, ...data } = entry;
      updateEntry(entryId, { ...data, extra: { ...data.extra, parent: parentId } });
    }
  });
  mutate(id, (cur) => {
    for (const it of cur.items) if (saved.has(it.id)) it.savedEntryId = saved.get(it.id)!;
    cur.committedBookId = bookId;
    cur.targetBookId = bookId;
    cur.stage = "done";
  });
  if (embeddingsEnabled()) enqueue("lore.embed", {}, { dedupeKey: "lore.embed", delayMs: 4000 });
  return { bookId, added: saved.size + (wantOverview ? 1 : 0) };
}
