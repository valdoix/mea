import { z } from "zod";
import { all, newId, now, one, parseJson, run, tx } from "../db/db";
import { publish } from "../lib/events";
import { badRequest, notFound } from "../lib/http";
import { countTokens } from "../lib/tokens";
import { embeddingsEnabled } from "../memory/embed";
import { getCard } from "../services/characters";
import { Deferred, enqueue, type JobContext } from "../services/jobs";
import { callJson } from "../services/llm";
import { addTurns, applyIdeaChange, BASED_ON_RULE, IDEA_CHANGES, ideaBlock, ideaChange, canonBlock, canonRule, type ChatTurn, chatBlock, COWRITER, covers, LOOKUP_FIELD, newProposal, type Proposal, type ProposedChange, shortHash, splitPeople, SUGGEST_RULE, withLookups } from "../creator/smarts";
import { BRIEF_RULE, gather, lookup, type Research, researchBlock, wikisFor } from "../creator/research";
import { callText } from "../services/llm";
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
  /** How many entries a plan aims for; "complete" plans every person, place and thing the census finds. */
  size: "small" | "medium" | "large" | "complete";
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
  /** Fingerprints of what the entry was written from (overview, answers, its pitch, canon), to spot stale entries. */
  basis: string;
  /** The wiki page about this entry (canon), looked up when it's first written. */
  research: { title: string; url: string; text: string } | null;
  /** A character or persona made from this entry in the creator (links both ways). */
  links: { creatorDraftId?: string; characterId?: string; personaId?: string };
}

export interface StudioQuestion {
  id: string;
  q: string;
  why: string;
  answer: string;
  /** Answers to pick from (the author can still write their own). */
  suggestions: string[];
}

/** Everything a complete lorebook for this world should cover (the census), before choosing what to plan. */
export interface CensusEntry {
  name: string;
  type: EntryType | null;
  tier: "core" | "supporting" | "minor";
  note: string;
}

/** The editor's pass: contradictions, flat or generic entries, canon errors, weak keys, merged subjects, gaps. */
export interface CritiqueIssue {
  id: string;
  kind: string;
  items: string[];
  problem: string;
  fix: string;
  add: { title: string; type: EntryType | null; pitch: string } | null;
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
  /** The existing work this is based on ("Yellowjackets (TV series)"), if any: its canon fills the gaps. */
  basedOn: string;
  census: CensusEntry[] | null;
  critique: CritiqueIssue[] | null;
  /** The co-writer: the conversation, and the changes it's proposing. */
  chat: ChatTurn[];
  proposal: Proposal | null;
  /** Canon gathered from the web (the source's wiki, Wikipedia, your links), distilled into a brief. */
  research: Research | null;
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

const PLAN_SIZE = { small: 8, medium: 15, large: 26, complete: 26 } as const;
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
    questions: (d.questions ?? []).map((q) => ({ ...q, suggestions: q.suggestions ?? [] })),
    directions: d.directions ?? [],
    expansion: d.expansion ?? null,
    overview: d.overview ?? "",
    items: (d.items ?? []).map(normItem),
    targetBookId: d.targetBookId ?? null,
    links: d.links ?? [],
    committedBookId: d.committedBookId ?? null,
    consistency: d.consistency ?? null,
    basedOn: d.basedOn ?? "",
    census: d.census ?? null,
    critique: d.critique ?? null,
    chat: d.chat ?? [],
    proposal: d.proposal ?? null,
    research: d.research ?? null,
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
    basis: i.basis ?? "",
    research: i.research ?? null,
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
    basedOn: "",
    census: null,
    critique: null,
    chat: [],
    proposal: null,
    research: null,
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
  basedOn?: string;
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
    if (p.basedOn !== undefined) d.basedOn = p.basedOn.trim();
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
      // Your own edit is up to date with what you can see now.
      if (it.entry) it.basis = basisOf(d, it);
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
  persona:
    "This is a lorebook for the user's own persona: the people, places, history and possessions around them, so stories can draw on their past. The persona is the person the human player plays ({{user}} in a chat), not a character the AI plays: don't make an entry for the persona themself, mention them by name, never as {{char}}, and never decide what they feel or do. Stay consistent with the persona.",
  document: "Turn the author's document into entries. Use only what the document says.",
  book: "Grow an existing lorebook: propose entries it lacks. Never repeat an entry it has.",
};

const AVOID = `Avoid names models overuse (${STOCK_NAMES.slice(0, 18).join(", ")}…) unless the author used them, and filler phrases (${STOCK_PHRASES.slice(0, 10).join(", ")}…).`;

const readbackSchema = z.object({
  understood: z.string().default(""),
  missing: z.array(z.string()).default([]),
  basedOn: z.string().default(""),
  questions: z.array(z.object({ q: z.string(), why: z.string().default(""), suggestions: z.array(z.string()).default([]) })).default([]),
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
    system: `You help an author build a lorebook for interactive fiction (roleplay). ${PURPOSE[d.source.kind]} Read their material, then reply with: "understood": 2–4 sentences on what you understood (premise, tone, what's central); "missing": up to 4 short phrases naming what's still unclear; ${BASED_ON_RULE} "questions": up to ${n} pointed questions worth asking, most important first, each with "why" (one short sentence on what the answer changes in the lorebook) and ${SUGGEST_RULE} Ask about tension, specifics and the author's intent, never trivia, and never what the material (or canon, for an existing work) already answers. Reply with JSON only: {"understood": "…", "missing": ["…"], "basedOn": "", "questions": [{"q": "…", "why": "…", "suggestions": ["…", "…", "…"]}]}`,
    user: [sourceBlock(d), canonBlock(d.basedOn), researchBlock(d.research), answersBlock(d), prefsBlock(d)].filter(Boolean).join("\n\n"),
    maxTokens: 2000,
    temperature: 0.6,
  });
  return mutate(id, (cur) => {
    cur.readback = { understood: r.data.understood.trim(), missing: r.data.missing.map((m) => m.trim()).filter(Boolean).slice(0, 4) };
    // Answered questions stay; new ones are added after them.
    const answered = cur.questions.filter((q) => q.answer.trim());
    const have = new Set(answered.map((q) => q.q.trim().toLowerCase()));
    cur.questions = [...answered, ...r.data.questions.filter((q) => q.q.trim() && !have.has(q.q.trim().toLowerCase())).slice(0, n).map((q) => ({ id: newId(), q: q.q.trim(), why: q.why.trim(), answer: "", suggestions: q.suggestions.map((x) => x.trim()).filter(Boolean).slice(0, 3) }))];
    if (!cur.basedOn && r.data.basedOn.trim().length > 2) cur.basedOn = r.data.basedOn.trim().slice(0, 160);
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

// ---------- research: canon from the web ----------

/** Reads up on the work this is based on (its wiki, Wikipedia, your links) and distils a canon brief. */
export async function researchLore(id: string, opts: { urls?: string[] } = {}) {
  const d = mustDraft(id);
  if (!d.basedOn.trim() && !opts.urls?.length) throw badRequest("Say what it's based on first, or paste links to read");
  const g = await gather(d.basedOn || d.title, { urls: opts.urls });
  if (!g.text.trim()) throw badRequest(d.basedOn ? `Couldn't find a wiki for ${d.basedOn}. Paste a link to one (a Fandom or Wikipedia page).` : "Couldn't read those links");
  const r = await callText({
    task: "summarizer",
    kind: "studio:research",
    system: BRIEF_RULE(d.basedOn || d.title),
    user: [`THE AUTHOR'S PREMISE (for what matters; the brief is canon only):\n${d.source.text.slice(0, 4000)}`, `THE RESEARCH:\n${g.text}`].join("\n\n"),
    maxTokens: 5000,
    temperature: 0.2,
    validate: (t) => (t.trim().length < 200 ? "That was too short. Write the full brief." : null),
  });
  return mutate(id, (cur) => {
    cur.research = { basedOn: cur.basedOn, at: now(), wikis: g.wikis, sources: g.sources, names: g.names, brief: r.text.trim() };
  });
}

/** The wiki page for one entry (canon people, places, events), cached on the item. */
async function entryPage(d: StudioDraft, it: StudioItem) {
  if (it.research !== null || !d.research?.wikis.length || d.options.faithful) return it.research;
  const page = await lookup(d.research.wikis, baseTitle(it.title), 5000, true).catch(() => null);
  const found = page ? { title: page.title, url: page.url, text: page.text } : { title: "", url: "", text: "" };
  mutate(d.id, (cur) => {
    const x = cur.items.find((i) => i.id === it.id);
    if (x) x.research = found;
  });
  return found;
}

// ---------- the census: everything a complete lorebook would cover ----------

const censusSchema = z.object({
  basedOn: z.string().default(""),
  entities: z.array(z.object({ name: z.string(), type: z.string().default(""), tier: z.string().default("supporting"), note: z.string().default("") })).default([]),
});

const asType = (t: string): EntryType | null => ((ENTRY_TYPES as string[]).includes(t.trim().toLowerCase()) ? (t.trim().toLowerCase() as EntryType) : null);
const asTier = (t: string): CensusEntry["tier"] => (/core|main|central|major/i.test(t) ? "core" : /minor|background|small/i.test(t) ? "minor" : "supporting");

/** Proper names in the author's own words (multi-word names, or a name said twice mid-sentence): the census can't miss these. */
export function namesInText(text: string): string[] {
  const counts = new Map<string, number>();
  for (const sentence of text.split(/(?<=[.!?:;\n—–-])\s+|\n+/)) {
    const words = [...sentence.matchAll(/\b[\p{Lu}][\p{L}'’]+(?:\s+(?:of\s+|the\s+|de\s+|van\s+)?[\p{Lu}][\p{L}'’]+)*/gu)];
    for (const m of words) {
      let parts = m[0].trim().split(/\s+/);
      while (parts.length && COMMON_WORDS.has(parts[0]!.toLowerCase())) parts = parts.slice(1);
      // "Holloways’ Fourth of July" is two names; "James'" is James.
      const names = parts.join(" ").split(/['’]s?\s+/).map((x) => x.replace(/['’]s?$/, "").replace(/\s+(AU|TV)$/i, "").trim());
      // A single word that opens the sentence is often just a capital letter.
      const atStart = m.index === sentence.search(/\S/);
      for (const n of names) {
        if (n.length < 3 || /^(AU|TV|OK|POV|NSFW|I|I'm)$/i.test(n)) continue;
        const weight = n.includes(" ") ? 2 : atStart && n === names[0] ? 0 : 1;
        counts.set(n, (counts.get(n) ?? 0) + weight);
      }
    }
  }
  return [...counts].filter(([, c]) => c >= 2).map(([n]) => n);
}

/**
 * The census: every person, place, group, thing, event and idea the world has, from the author's
 * material and (for a fan work or AU) the source's canon, before anything is chosen for the plan.
 * People are never lumped together.
 */
export async function takeCensus(id: string) {
  const d = mustDraft(id);
  const material = [d.source.text, d.questions.map((q) => q.answer).join("\n"), d.expansion?.use ? d.expansion.sections.map((s) => s.text).join("\n") : ""].join("\n");
  const r = await callJson({
    task: "summarizer",
    kind: "studio:census",
    name: "studio_census",
    schema: censusSchema,
    system: [
      "You take the census of a world for a lorebook (interactive fiction). List EVERYTHING a complete lorebook for it should cover: every named person, place, group, item, event, concept and rule.",
      "Include every one named or clearly implied in the author's material. If it's set in or based on an existing work (a show, book, film, game) or the author says to keep canon, also list that work's canon cast and world as it stands where the story is set: main and minor characters (teammates, family, teachers, rivals), places, groups, objects and events, so nobody is left out.",
      "One person per line; never combine people (\"Gen\", \"Melissa\" and \"Crystal\" are three lines). Use full names where known.",
      `For each: "name"; "type" (one of: ${ENTRY_TYPES.join(", ")}); "tier": core (the story turns on them), supporting, or minor; "note": a few words on who or what it is in THIS version of the story.`,
      BASED_ON_RULE,
      PURPOSE[d.source.kind],
      'Reply with JSON only: {"basedOn": "", "entities": [{"name": "…", "type": "…", "tier": "core", "note": "…"}]}',
    ].join(" "),
    user: [sourceBlock(d), canonBlock(d.basedOn), researchBlock(d.research), d.research?.names.length ? `CHARACTER PAGES ON THE WIKI (each is a canon person: include every one who exists at the point the story is set):\n${d.research.names.join(", ")}` : "", answersBlock(d), prefsBlock(d)].filter(Boolean).join("\n\n"),
    maxTokens: 7000,
    temperature: 0.2,
  });
  const out: CensusEntry[] = [];
  const add = (e: CensusEntry) => {
    if (!e.name.trim() || out.some((x) => covers([x.name], e.name) && (x.type === e.type || !e.type || !x.type))) return;
    out.push(e);
  };
  for (const e of r.data.entities) {
    const type = asType(e.type);
    const names = type === "character" ? splitPeople(cleanTitle(e.name)) : [cleanTitle(e.name)];
    for (const name of names) add({ name, type, tier: asTier(e.tier), note: e.note.trim().slice(0, 200) });
  }
  // Whatever the author named that the model missed is still counted.
  for (const name of namesInText(material)) if (!out.some((x) => covers([x.name], name))) add({ name, type: null, tier: "supporting", note: "named in your material" });
  return mutate(id, (cur) => {
    cur.census = out.slice(0, 200);
    if (!cur.basedOn && r.data.basedOn.trim().length > 2) cur.basedOn = r.data.basedOn.trim().slice(0, 160);
  });
}

/** Census entries no planned (or already saved) entry covers yet. */
export function uncovered(d: StudioDraft): CensusEntry[] {
  const titles = [...d.items.flatMap((i) => [i.title, ...(i.entry?.aliases ?? [])]), ...existingTitles(d)];
  return (d.census ?? []).filter((e) => !covers(titles, e.name));
}

const outlineSchema = z.object({
  title: z.string().default(""),
  overview: z.string().default(""),
  items: z.array(z.object({ title: z.string(), type: z.string().default(""), pitch: z.string().default(""), parent: z.string().default(""), folder: z.string().default("") })).default([]),
});

type OutlineItem = z.infer<typeof outlineSchema>["items"][number];

/** One planning call: about n entries, or exactly the names given. */
async function outlineCall(d: StudioDraft, o: { n: number; more: boolean; names?: CensusEntry[]; census?: CensusEntry[]; steer?: string; planned: StudioItem[]; withOverview: boolean }) {
  const planned = o.planned.map((i) => `- ${i.title}${i.type ? ` (${i.type})` : ""}${i.pitch ? `: ${i.pitch}` : ""}`);
  const existing = existingTitles(d);
  const gaps = d.source.kind === "book" && d.source.refId ? missingNames(d.source.refId) : [];
  const typeList = (d.options.types.length ? d.options.types : ENTRY_TYPES).join(", ");
  const line = (e: CensusEntry) => `- ${e.name}${e.type ? ` (${e.type}, ${e.tier})` : ` (${e.tier})`}${e.note ? `: ${e.note}` : ""}`;
  const r = await callJson({
    task: "summarizer",
    kind: "studio:outline",
    name: "studio_outline",
    schema: outlineSchema,
    system: [
      "You plan a lorebook for interactive fiction (roleplay). A lorebook is a set of short entries a storyteller sees only when they matter: the people, places, items, factions, concepts, events and rules of a world.",
      PURPOSE[d.source.kind],
      canonRule(d.basedOn),
      o.names
        ? `Plan exactly one entry for each name under PLAN THESE, using that name as the title (you may complete a partial name), in that order. Nothing else.`
        : o.more
          ? `The plan already has the entries listed under ALREADY PLANNED. Propose up to ${o.n} NEW entries that fill its gaps; never repeat one.`
          : `Plan about ${o.n} entries.`,
      o.census && !o.names ? "THE CENSUS lists what the world contains. Every core name in it gets an entry; then supporting ones, most useful to a scene first; then the concepts, events and rules that make the world work." : "",
      "One person per entry: never put two people in one entry (a family or team can have its own entry besides its members).",
      `Each item: "title" (the name as the story would say it), "type" (one of: ${typeList}), "pitch" (one sentence: what the entry establishes in this version of the story and why a scene would need it), "parent" (the title of another planned entry it sits inside: a district inside a city, a member inside a faction; else ""), "folder" (a short path like "Places › Port Ellis", else "").`,
      o.withOverview ? `Also "title" (a name for the lorebook, 1–5 words) and "overview" (80–150 words: the world's premise, tone, and the ground truths every scene should respect).` : 'Leave "overview" and "title" empty.',
      d.options.faithful ? "Use only what the source says: no invented names, places or facts." : "Prefer specific, playable details with tension: things characters can want, fear, visit, use or argue about. Invent freely where the material and canon are silent, but never against them.",
      d.basedOn ? "" : AVOID,
      o.steer?.trim() ? `The author asks: ${o.steer.trim()}` : "",
      'Reply with JSON only: {"title": "…", "overview": "…", "items": [{"title": "…", "type": "…", "pitch": "…", "parent": "", "folder": ""}]}',
    ]
      .filter(Boolean)
      .join(" "),
    user: [
      sourceBlock(d),
      canonBlock(d.basedOn),
      researchBlock(d.research),
      answersBlock(d),
      prefsBlock(d),
      d.overview.trim() && !o.withOverview ? `OVERVIEW:\n${d.overview.trim()}` : "",
      planned.length ? `ALREADY PLANNED:\n${planned.join("\n")}` : "",
      existing.length ? `ALREADY IN THEIR LORE (don't repeat):\n${existing.slice(0, 120).join(", ")}` : "",
      gaps.length ? `NAMED IN THE BOOK BUT WITHOUT AN ENTRY (good candidates):\n${gaps.join(", ")}` : "",
      o.names ? `PLAN THESE:\n${o.names.map(line).join("\n")}` : o.census?.length ? `THE CENSUS:\n${o.census.map(line).join("\n")}` : "",
    ]
      .filter(Boolean)
      .join("\n\n"),
    maxTokens: Math.min(8000, 1200 + (o.names?.length ?? o.n) * 160),
    temperature: d.options.faithful ? 0.3 : 0.7,
  });
  return r.data;
}

/** Plan items from the model's outline: people split one per entry, duplicates dropped. */
function toItems(raw: OutlineItem[], taken: Set<string>, census: CensusEntry[]): StudioItem[] {
  const out: StudioItem[] = [];
  for (const x of raw) {
    const type = asType(x.type) ?? census.find((e) => covers([e.name], x.title))?.type ?? null;
    const titles = type === "character" ? splitPeople(cleanTitle(x.title)) : [cleanTitle(x.title)];
    for (const title of titles) {
      if (!title || taken.has(title.toLowerCase())) continue;
      taken.add(title.toLowerCase());
      out.push(normItem({ title, type, pitch: titles.length > 1 ? (census.find((e) => covers([e.name], title))?.note || x.pitch.trim()) : x.pitch.trim(), folder: x.folder.trim(), parent: x.parent.trim() }));
    }
  }
  return out;
}

/**
 * Plan: the overview (the "bible") and an outline of entries. A census of the whole world comes
 * first, so nobody the story needs is skipped; "complete" plans all of it, in batches. "more" adds
 * to the plan instead of replacing it, and `names` plans exactly those (the coverage list's "Add").
 */
export async function planOutline(id: string, opts: { mode?: "replace" | "more"; steer?: string; count?: number; names?: string[] } = {}) {
  let d = mustDraft(id);
  const more = opts.mode === "more" || Boolean(opts.names?.length);
  // A world based on an existing work reads up on it first (once).
  if (d.basedOn && !d.research?.brief && !d.options.faithful) {
    try {
      d = await researchLore(id);
    } catch (e) {
      if (e instanceof Deferred) throw e;
    }
  }
  // A fresh plan takes a fresh census (a draft from a document plans from its own sections).
  if ((!more || !d.census) && d.source.kind !== "document" && !d.options.faithful) {
    try {
      d = await takeCensus(id);
    } catch (e) {
      if (e instanceof Deferred) throw e;
      // Planning still works without one.
    }
  }
  const census = d.census ?? [];
  const keptOnReplan = more ? d.items : d.items.filter((i) => i.entry || i.status === "queued" || i.status === "writing");
  const taken = new Set([...keptOnReplan.map((i) => i.title.toLowerCase()), ...existingTitles(d).map((t) => t.toLowerCase())]);
  const fresh: StudioItem[] = [];
  let title = "";
  let overview = "";

  const named = opts.names?.length ? opts.names.map((n) => census.find((e) => e.name === n) ?? { name: n, type: null, tier: "supporting" as const, note: "" }) : null;
  const complete = d.options.size === "complete" && !more;
  if (named || complete) {
    // Exactly these names, in batches small enough that each gets a real pitch.
    const todo = named ?? census.filter((e) => !covers([...keptOnReplan.map((i) => i.title), ...existingTitles(d)], e.name)).sort((a, b) => ["core", "supporting", "minor"].indexOf(a.tier) - ["core", "supporting", "minor"].indexOf(b.tier));
    const BATCH = 18;
    for (let k = 0; k < todo.length || (k === 0 && complete); k += BATCH) {
      const batch = todo.slice(k, k + BATCH);
      const first = k === 0 && !more;
      const data = await outlineCall(d, { n: batch.length || PLAN_SIZE.large, more: !first, names: batch.length ? batch : undefined, census, steer: opts.steer, planned: [...keptOnReplan, ...fresh], withOverview: first });
      if (first) {
        title = data.title;
        overview = data.overview;
      }
      fresh.push(...toItems(data.items, taken, census));
      if (!batch.length) break;
    }
    // The ideas that hold the world together (concepts, rules, events) beyond the census's names.
    if (complete && !named) {
      const data = await outlineCall(d, { n: 8, more: true, steer: ["Now the concepts, rules, events and places that make this world work and aren't planned yet.", opts.steer ?? ""].join(" "), planned: [...keptOnReplan, ...fresh], withOverview: false });
      fresh.push(...toItems(data.items, taken, census));
    }
  } else {
    const base = opts.count ?? (more ? Math.max(4, Math.round(PLAN_SIZE[d.options.size] / 3)) : PLAN_SIZE[d.options.size]);
    // Every core name fits, whatever the size.
    const n = more ? base : Math.max(base, census.filter((e) => e.tier === "core").length + 4);
    const data = await outlineCall(d, { n, more, census, steer: opts.steer, planned: more ? d.items : [], withOverview: !more });
    title = data.title;
    overview = data.overview;
    fresh.push(...toItems(data.items, taken, census).slice(0, more ? n : 120));
  }

  return mutate(id, (cur) => {
    // Parents come back as titles; point them at items (this plan's or the earlier ones).
    const pool = [...(more ? cur.items : keptOnReplan), ...fresh];
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
      if (overview.trim() && (!cur.overview.trim() || cur.source.kind !== "document")) cur.overview = overview.trim();
      if (title.trim() && (cur.title === "Untitled world" || !cur.title.trim())) cur.title = cleanTitle(title);
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

/**
 * What an entry is written from, as fingerprints: the overview, your answers, canon, and its own
 * title, kind and pitch. When one changes after it was written, the entry is out of date.
 */
export function basisOf(d: StudioDraft, it: StudioItem) {
  const answers = d.questions.filter((q) => q.answer.trim()).map((q) => `${q.q}\n${q.answer.trim()}`).join("\n");
  return `o:${shortHash(d.overview.trim())}|a:${shortHash(answers)}|c:${shortHash(d.basedOn.trim())}|p:${shortHash(`${it.title}\n${it.type ?? ""}\n${it.pitch.trim()}`)}`;
}

const BASIS_LABEL: Record<string, string> = { o: "the overview", a: "your answers", c: "what it's based on", p: "its plan line" };

/** Why an entry is out of date ("the overview", "its plan line"), or [] if it isn't (or we can't tell). */
export function staleReasons(d: StudioDraft, it: StudioItem): string[] {
  if (!it.entry || !it.basis || it.status === "queued" || it.status === "writing") return [];
  const was = Object.fromEntries(it.basis.split("|").map((p) => p.split(":") as [string, string]));
  const now = Object.fromEntries(basisOf(d, it).split("|").map((p) => p.split(":") as [string, string]));
  return Object.keys(now).filter((k) => was[k] !== undefined && was[k] !== now[k]).map((k) => BASIS_LABEL[k]!);
}

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
        it.basis = basisOf(d, next);
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

export async function writeEntry(d: StudioDraft, item: StudioItem, job?: JobContext): Promise<StudioEntry> {
  // Canon people and places get their wiki page read first.
  const it = { ...item, research: await entryPage(d, item) };
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
      "Tie it into the world: name the two or three other entries it matters most to and how (who they love, owe, fear or lie to; where it is; who holds it), using their exact titles. Show character through what they do and say, not adjectives; give the storyteller something to play (a want, a tension, a tell, a line of dialogue in their voice for people).",
      canonRule(d.basedOn),
      `"keys": 2–6 trigger words: the names, nicknames and short phrases a story uses when this matters. Never common words that would fire on every message. "aliases": other names it goes by (can be empty). "essentials": one sentence, the single most important fact.`,
      d.options.secrets && !faithful ? `"secrets": 0–2 hidden truths that would change scenes if revealed, each with "knownBy" (who knows it, by name). Only where it fits; most entries have none.` : `"secrets": [] unless the source states a secret, with "knownBy" naming who knows it.`,
      faithful ? "Use only what the source notes say; keep every name, number and fact exact; add nothing." : "Stay consistent with the overview, the source and the rest of the plan; invent only details that fit.",
      d.basedOn ? "" : AVOID,
      'Reply with JSON only: {"content": "…", "keys": ["…"], "aliases": ["…"], "essentials": "…", "secrets": [{"text": "…", "knownBy": ["…"]}]}',
    ]
      .filter(Boolean)
      .join(" "),
    user: [
      d.overview.trim() ? `OVERVIEW:\n${d.overview.trim()}` : "",
      d.source.kind === "document" ? "" : sourceBlock(d),
      canonBlock(d.basedOn),
      researchBlock(d.research),
      answersBlock(d),
      prefsBlock(d),
      others.length ? `THE REST OF THE LOREBOOK:\n${others.join("\n")}` : "",
      parent ? `IT SITS INSIDE: ${parent.title}: ${parent.essentials}` : "",
      it.folder ? `FOLDER: ${it.folder}` : "",
      `THIS ENTRY: ${it.title}${it.type ? ` (${it.type})` : ""}${it.pitch ? `: ${it.pitch}` : ""}`,
      it.source.trim() ? `SOURCE NOTES FOR THIS ENTRY:\n${it.source.trim().slice(0, 12_000)}` : "",
      it.research?.text ? `ITS WIKI PAGE (canon: use these facts; the author's changes win):\n${it.research.text}` : "",
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
  const stale = Object.fromEntries(drafted.map((i) => [i.id, staleReasons(d, i)]).filter(([, r]) => r!.length));
  return {
    issues,
    tokens,
    stale,
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

// ---------- the editor's pass ----------

const critiqueSchema = z.object({
  issues: z
    .array(
      z.object({
        entries: z.array(z.number()).default([]),
        kind: z.string().default("quality"),
        problem: z.string(),
        fix: z.string().default(""),
        add: z.object({ title: z.string(), type: z.string().default(""), pitch: z.string().default("") }).nullable().optional(),
      }),
    )
    .default([]),
});

/**
 * A demanding editor reads every drafted entry: contradictions, flat or generic writing, canon
 * mistakes, weak trigger keys, two subjects in one entry, and the people or places that are missing.
 * Each issue comes with a fix the author can apply (a rewrite with that steer, or a new plan line).
 */
export async function critiqueDraft(id: string) {
  const d = mustDraft(id);
  const drafted = d.items.filter((i) => i.keep && i.entry);
  if (!drafted.length) throw badRequest("Write some entries first");
  const missing = uncovered(d).slice(0, 40);
  const r = await callJson({
    task: "summarizer",
    kind: "studio:critique",
    name: "studio_critique",
    schema: critiqueSchema,
    system: [
      "You are a demanding lorebook editor for interactive fiction. Read every entry and find what would make scenes worse:",
      '"contradiction" (entries disagree with each other or the overview: ages, dates, family, places, rules);',
      '"flat" (generic, tells instead of shows, nothing a scene can use, stock phrasing);',
      d.basedOn ? `"canon" (gets ${d.basedOn} wrong where the author didn't change it, or misses canon detail that matters);` : "",
      '"keys" (trigger words too common to be safe, or missing the nicknames the story would use);',
      '"split" (one entry covers two subjects that each need their own);',
      '"gap" (a person, place or thing the entries lean on, or canon has, with no entry: give "add" with its title, type and a one-line pitch).',
      'Each issue cites entries by number (none for a gap), states the problem in one sentence, and gives "fix": an instruction a writer could follow as is ("Give Lottie her visions starting before the crash and her lithium; name her father"). At most 14 issues, most important first. If it\'s strong, return few.',
      canonRule(d.basedOn),
      'Reply with JSON only: {"issues": [{"entries": [1], "kind": "flat", "problem": "…", "fix": "…", "add": null}]}',
    ]
      .filter(Boolean)
      .join(" "),
    user: [
      d.overview.trim() ? `OVERVIEW:\n${d.overview.trim()}` : "",
      canonBlock(d.basedOn),
      researchBlock(d.research),
      `ENTRIES:\n${drafted.map((i, k) => `${k + 1}. ${i.title}${i.type ? ` (${i.type})` : ""} [keys: ${i.entry!.keys.join(", ")}]: ${i.entry!.content.replace(/\s+/g, " ").slice(0, 900)}`).join("\n")}`,
      missing.length ? `IN THE CENSUS BUT NOT PLANNED: ${missing.map((e) => e.name).join(", ")}` : "",
    ]
      .filter(Boolean)
      .join("\n\n"),
    maxTokens: 3000,
    temperature: 0.3,
  });
  return mutate(id, (cur) => {
    cur.critique = r.data.issues
      .map((x) => ({
        id: newId(),
        kind: x.kind.trim().toLowerCase() || "quality",
        items: x.entries.map((n) => drafted[n - 1]?.id).filter((v): v is string => Boolean(v)),
        problem: x.problem.trim(),
        fix: x.fix.trim(),
        add: x.add?.title.trim() ? { title: cleanTitle(x.add.title), type: asType(x.add.type), pitch: x.add.pitch.trim() } : null,
      }))
      .filter((x) => x.problem && (x.items.length || x.add))
      .slice(0, 14);
  });
}

/** Applies one of the editor's fixes: a rewrite of the entries it names with that steer, or the missing entry added to the plan. */
export function applyCritique(id: string, issueId: string) {
  const d = mustDraft(id);
  const issue = d.critique?.find((x) => x.id === issueId);
  if (!issue) throw notFound("That note is gone");
  if (issue.add && !d.items.some((i) => covers([i.title], issue.add!.title))) addItem(id, { title: issue.add.title, type: issue.add.type, pitch: issue.add.pitch });
  if (issue.items.length) queueWrite(id, { itemIds: issue.items, steer: issue.fix || issue.problem });
  return mutate(id, (cur) => void (cur.critique = (cur.critique ?? []).filter((x) => x.id !== issueId)));
}

// ---------- the co-writer ----------

const cowriteSchema = z.object({
  reply: z.string().default(""),
  lookup: z.array(z.string()).default([]),
  changes: z
    .array(
      z.object({
        kind: z.string(),
        entry: z.string().default(""),
        title: z.string().default(""),
        section: z.string().default(""),
        type: z.string().default(""),
        pitch: z.string().default(""),
        content: z.string().default(""),
        keys: z.array(z.string()).default([]),
        steer: z.string().default(""),
        text: z.string().default(""),
      }),
    )
    .default([]),
});

/**
 * "Make the Holloways old money from Philadelphia, and give Lottie a brother": the co-writer reads
 * the whole draft and proposes exact changes (the overview, entries' text, plan lines, new entries,
 * background rewrites) that you accept or reject one by one. Nothing changes until you accept.
 */
export async function cowriteLore(id: string, message: string) {
  const d = mustDraft(id);
  const m = message.toLowerCase();
  // Entries the message names are read in full; the rest by their one-line essentials.
  const named = (i: StudioItem) => [i.title, ...(i.entry?.keys ?? [])].some((k) => k.trim().length > 2 && m.includes(k.toLowerCase()));
  const items = d.items.filter((i) => i.keep);
  const full = items.filter(named).slice(0, 12);
  // The co-writer can read the wiki (the source's, or Wikipedia) before it answers.
  const wikis = await wikisFor(d.research, d.basedOn);
  const ask = async (looked: string) => (await callJson({
    task: "assistant",
    kind: "studio:cowrite",
    name: "studio_cowrite",
    schema: cowriteSchema,
    system: [
      COWRITER,
      `The draft is a lorebook, grown from ${d.source.kind === "idea" ? "the author's idea and its expanded concept" : "its source"}.${d.source.kind === "character" || d.source.kind === "persona" ? ` ${PURPOSE[d.source.kind]}` : ""} Changes you can propose:`,
      IDEA_CHANGES,
      '{"kind": "overview", "text": "the whole new overview"};',
      '{"kind": "entry", "entry": "<exact title>", "content": "the whole new text", "keys": ["…"]} for a written entry whose text needs a small, exact edit (keys only if they change);',
      '{"kind": "rewrite", "entry": "<exact title>", "steer": "what to change"} when an entry needs rewriting more than editing, or isn\'t shown in full below;',
      '{"kind": "plan", "entry": "<exact title>", "title": "new title or empty", "type": "", "pitch": "new plan line or empty"};',
      '{"kind": "add", "title": "…", "type": "…", "pitch": "…"} for a new entry;',
      '{"kind": "remove", "entry": "<exact title>"} to leave one out.',
      `Types: ${ENTRY_TYPES.join(", ")}. At most 20 changes; prefer "rewrite" for broad changes across many entries.`,
      canonRule(d.basedOn),
      looked ? "" : LOOKUP_FIELD,
      'Reply with JSON only: {"reply": "…", "lookup": [], "changes": [ … ]}',
    ]
      .filter(Boolean)
      .join(" "),
    user: [
      `THE LOREBOOK: ${d.title}`,
      ideaBlock(d.source.kind === "idea" ? d.source.text : "", d.expansion),
      d.overview.trim() ? `OVERVIEW:\n${d.overview.trim()}` : "",
      canonBlock(d.basedOn),
      researchBlock(d.research),
      answersBlock(d),
      `THE PLAN (title (type) [status]: essentials or plan line):\n${items.map((i) => `- ${i.title}${i.type ? ` (${i.type})` : ""} [${i.entry ? "written" : "planned"}]: ${i.entry?.essentials || i.pitch || ""}`).join("\n")}`,
      ...full.filter((i) => i.entry).map((i) => `ENTRY IN FULL — ${i.title} [keys: ${i.entry!.keys.join(", ")}]:\n${i.entry!.content}`),
      chatBlock(d.chat),
      looked,
      `THE AUTHOR SAYS: ${message.trim()}`,
    ]
      .filter(Boolean)
      .join("\n\n"),
    maxTokens: 6000,
    temperature: 0.7,
  })).data;
  const { data, sources } = await withLookups(ask, (q) => lookup(wikis, q, 5000));
  const r = { data };
  const find = (t: string) => d.items.find((i) => i.title.toLowerCase() === t.trim().toLowerCase()) ?? d.items.find((i) => t.trim() && covers([i.title], t));
  const changes: Omit<ProposedChange, "id">[] = [];
  for (const c of r.data.changes.slice(0, 20)) {
    const kind = c.kind.trim().toLowerCase();
    const it = c.entry ? find(c.entry) : undefined;
    if (kind === "idea" || kind === "section") {
      const ch = kind === "idea" && d.source.kind !== "idea" ? null : ideaChange(c, d.source.text, d.expansion);
      if (ch) changes.push(ch);
      continue;
    }
    if (kind === "overview" && c.text.trim() && c.text.trim() !== d.overview.trim()) changes.push({ kind, target: "overview", label: "Overview", before: d.overview, after: c.text.trim() });
    else if (kind === "entry" && it?.entry && c.content.trim() && c.content.trim() !== it.entry.content.trim())
      changes.push({ kind, target: it.id, label: `${it.title} · text`, before: it.entry.content, after: c.content.trim(), data: c.keys.length ? { keys: c.keys } : undefined });
    else if ((kind === "rewrite" || (kind === "entry" && it && !it.entry)) && it && (c.steer.trim() || c.content.trim()))
      changes.push({ kind: "rewrite", target: it.id, label: `${it.title} · ${it.entry ? "rewrite" : "write"}`, before: it.entry?.content ?? it.pitch, after: "", steer: c.steer.trim() || `Use this: ${c.content.trim()}` });
    else if (kind === "plan" && it && (c.title.trim() || c.pitch.trim() || c.type.trim()))
      changes.push({ kind, target: it.id, label: `${it.title} · plan`, before: `${it.title}${it.type ? ` (${it.type})` : ""}: ${it.pitch}`, after: `${c.title.trim() || it.title}${asType(c.type) ?? it.type ? ` (${asType(c.type) ?? it.type})` : ""}: ${c.pitch.trim() || it.pitch}`, data: { title: c.title.trim(), type: asType(c.type), pitch: c.pitch.trim() } });
    else if (kind === "add" && c.title.trim() && !d.items.some((i) => i.title.toLowerCase() === c.title.trim().toLowerCase()))
      changes.push({ kind, target: "", label: `New: ${cleanTitle(c.title)}`, before: "", after: `${cleanTitle(c.title)}${asType(c.type) ? ` (${asType(c.type)})` : ""}: ${c.pitch.trim()}`, data: { title: cleanTitle(c.title), type: asType(c.type), pitch: c.pitch.trim() } });
    else if (kind === "remove" && it && it.keep) changes.push({ kind, target: it.id, label: `Leave out ${it.title}`, before: it.title, after: "" });
  }
  const proposal = newProposal(message.trim(), r.data.reply.trim() || (changes.length ? "Here's what I'd change." : "Nothing to change for that."), changes);
  return mutate(id, (cur) => {
    cur.chat = addTurns(cur.chat, { role: "user", text: message }, { role: "mea", text: proposal.reply, ...(sources.length ? { sources: sources.map((p) => ({ title: p.title, url: p.url })) } : {}) });
    cur.proposal = changes.length ? proposal : null;
  });
}

/** Accepts some of the co-writer's changes (by id); the rest are dropped. Rewrites go to the background writer. */
export function applyCowrite(id: string, accept: string[]) {
  const d0 = mustDraft(id);
  const p = d0.proposal;
  if (!p) throw badRequest("There's nothing to apply");
  const ok = p.changes.filter((c) => accept.includes(c.id));
  const rewrites: { itemId: string; steer: string }[] = [];
  const d = mutate(id, (d) => {
    for (const c of ok) {
      const it = d.items.find((i) => i.id === c.target);
      if (c.kind === "idea" || c.kind === "section") applyIdeaChange(d, c, (t) => (d.source.text = t));
      else if (c.kind === "overview") d.overview = c.after;
      else if (c.kind === "entry" && it?.entry) {
        it.previous = it.entry;
        it.entry = { ...it.entry, content: c.after, keys: Array.isArray(c.data?.keys) ? dedupe(c.data.keys as string[]) : it.entry.keys };
        it.status = "drafted";
        it.basis = basisOf(d, it);
      } else if (c.kind === "plan" && it) {
        const data = c.data as { title?: string; type?: EntryType | null; pitch?: string };
        if (data.title) it.title = cleanTitle(data.title) || it.title;
        if (data.type) it.type = data.type;
        if (data.pitch) it.pitch = data.pitch;
      } else if (c.kind === "add") {
        const data = c.data as { title: string; type: EntryType | null; pitch: string };
        d.items.push(normItem({ title: data.title, type: data.type, pitch: data.pitch }));
      } else if (c.kind === "remove" && it) it.keep = false;
      else if (c.kind === "rewrite" && it) rewrites.push({ itemId: it.id, steer: c.steer ?? "" });
    }
    d.proposal = null;
    if (ok.length) d.chat = addTurns(d.chat, { role: "mea", text: `Applied ${ok.length} of ${p.changes.length} change${p.changes.length === 1 ? "" : "s"}.` });
  });
  // Each rewrite carries its own steer.
  for (const w of rewrites) queueWrite(id, { itemIds: [w.itemId], steer: w.steer });
  return rewrites.length ? mustDraft(id) : d;
}

export function dismissCowrite(id: string) {
  return mutate(id, (d) => void (d.proposal = null));
}

export function clearCowriteChat(id: string) {
  return mutate(id, (d) => {
    d.chat = [];
    d.proposal = null;
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
