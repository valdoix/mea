import { z } from "zod";
import { CATEGORIES, CATEGORY_INFO, type Category, guessCategory, withCategory } from "./format";
import { allowedKinds, cleanMix, isSatellite, type Mix, mixBrief, mixFromTypes, PLAN_WHEN } from "./mix";
import { cleanParts, HIDDEN_PART, hiddenSecret, joinParts, KIND_BRIEF, type Parts, partsAsk, SHAPES, voiceProblems, voiceSlotValues, withFiring, wordsFor } from "./shapes";
import { all, newId, now, one, parseJson, run, tx } from "../db/db";
import { publish } from "../lib/events";
import { badRequest, notFound } from "../lib/http";
import { countTokens } from "../lib/tokens";
import { embeddingsEnabled } from "../memory/embed";
import { getCard } from "../services/characters";
import { Deferred, enqueue, type JobContext } from "../services/jobs";
import { callJson } from "../services/llm";
import { addTurns, applyIdeaChange, BASED_ON_RULE, IDEA_CHANGES, ideaBlock, ideaChanges, isIdeaKind, lastPerSection, misfiledSections, withDropNote, canonBlock, canonRule, type ChatTurn, chatBlock, COWRITER, covers, LOOKUP_FIELD, newProposal, type Proposal, type ProposedChange, shortHash, splitPeople, SUGGEST_RULE, withLookups } from "../creator/smarts";
import { BRIEF_RULE, gather, lookup, type Research, researchBlock, wikisFor } from "../creator/research";
import { callText } from "../services/llm";
import { applyExpansionPatch, deepenSection, type Expansion, type ExpansionPatch, expandIdea, expansionBlock } from "../creator/expand";
import { getPersona } from "../services/personas";
import { essentialsOf, extraOf } from "./activate";
import { ENTRY_TEMPLATES } from "./assist";
import { baseTitle, cleanTitle, type EntryType, entryFromSource, firstSentences, parseDocument } from "./ingest";
import { checkEntries, type EntryLength, STOCK_NAMES, STOCK_PHRASES } from "./quality";
import { createEntry, createLorebook, getLorebook, type LinkType, linkLorebook, linkedBooks, updateEntry } from "./service";
import { createFact } from "./facts";
import { defaultEntry } from "./types";
import { findLeaks, type VariantPlan, variantBlock } from "../creator/variantcore";

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

/** "version": the lorebook of a linked version (docs/14), translated from its original's through the map. */
export type SourceKind = "idea" | "character" | "persona" | "document" | "book" | "version";
export type Stage = "start" | "questions" | "plan" | "review" | "done";
export const ENTRY_TYPES = Object.keys(ENTRY_TEMPLATES) as EntryType[];

export interface StudioOptions {
  /** How many entries a plan aims for; "complete" plans every person, place and thing the census finds. */
  size: "small" | "medium" | "large" | "complete";
  length: EntryLength;
  /** Kinds of entries to plan (empty: any). Older drafts; the mix replaces it. */
  types: EntryType[];
  /** docs/17: how many of each kind the plan aims for (empty: the planner decides). */
  mix: Mix;
  /** The recipe the mix came from ("" once you change it). */
  recipe: string;
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
  /** docs/17: the kind's parts (a voice's sample lines, a mystery's clues), joined into the content. */
  parts?: Parts;
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
  /** I1/I2: the lore category (sets the saved entry's place and priority). */
  category: Category | null;
  /** I2: write a new entry, change one already in the book, or switch one off. */
  action: "write" | "change" | "off";
  /** I2: the book's entry a change or switch-off is for. */
  targetEntryId: string | null;
  /**
   * docs/17: who a satellite is about (a voice's person, a relationship's two): item ids,
   * "entry:<id>" for an entry already in the book, "card:<id>" for a companion book's card, or
   * "user" for the player's character.
   */
  about: string[];
  /** docs/17, 5.3: words a topic kind fires on, from the plan ("the dark lamp"): kept as keys when it's written. */
  cues?: string[];
  /** A version's entry (docs/14): the original entry it comes from, and whether it's kept, translated or new. */
  versionSource: VersionSource | null;
}

export interface VersionSource {
  /** The original's entry, and its book (null for an entry only the version has). */
  entryId: string | null;
  bookId: string | null;
  /** Its name in the original ("" for a new one). */
  from: string;
  state: "kept" | "changed" | "new";
  /** A fingerprint of the original entry when this was made, so a later change to it shows. */
  basis: string;
  /** The original entry's text, translated through the map when the state is "changed". */
  text: string;
}

/** What a version's lore draft knows (docs/14): whose version it is, the plan, and where it saves. */
export interface VersionLore {
  kind: "character" | "persona";
  /** The version (a saved card or persona). */
  id: string;
  name: string;
  originId: string;
  originName: string;
  plan: VariantPlan;
  /** The two books it saves into: the version's own (people, things, events) and its world's (places, groups, rules). */
  companionBookId: string | null;
  worldBookId: string | null;
}

/** I2: a numbered version of the plan, for "what changed" between versions. */
export interface PlanVersion {
  n: number;
  at: number;
  why: string;
  items: { id: string; title: string; category: Category | null; pitch: string; keep: boolean; action: StudioItem["action"] }[];
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
  /** I2: the plan's numbered versions (each plan and each accepted change makes one). */
  planVersions: PlanVersion[];
  version: VersionLore | null;
  createdAt: number;
  updatedAt: number;
}

export const defaultOptions = (kind: SourceKind = "idea"): StudioOptions => ({
  size: "medium",
  length: "standard",
  types: [],
  mix: {},
  recipe: "",
  tone: "",
  style: "",
  secrets: kind !== "document",
  faithful: kind === "document",
  overview: kind === "idea" || kind === "document",
  ...(kind === "version" ? { secrets: false } : {}),
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
    options: optionsOf(kind, d.options),
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
    planVersions: d.planVersions ?? [],
    version: d.version ?? null,
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
    category: i.category && (CATEGORIES as readonly string[]).includes(i.category) ? i.category : guessCategory({ comment: i.title ?? "", content: i.pitch ?? "", keys: [], constant: i.constant ?? false, extra: i.type ? { type: i.type } : {} }).category,
    action: i.action === "change" || i.action === "off" ? i.action : "write",
    targetEntryId: i.targetEntryId ?? null,
    versionSource: i.versionSource ?? null,
    about: Array.isArray(i.about) ? i.about.filter((x) => typeof x === "string") : [],
    ...(Array.isArray(i.cues) && i.cues.length ? { cues: i.cues.filter((x) => typeof x === "string") } : {}),
  };
}

/** A draft's options, with the mix made from its kinds of entries when it predates the mix. */
function optionsOf(kind: SourceKind, o: Partial<StudioOptions> = {}): StudioOptions {
  const merged = { ...defaultOptions(kind), ...o };
  return { ...merged, mix: o.mix ? cleanMix(o.mix) : mixFromTypes(merged.types ?? []), recipe: typeof o.recipe === "string" ? o.recipe : "" };
}

/** I2: a new numbered version of the plan, unless nothing in it changed. */
function snapshotPlan(d: StudioDraft, why: string) {
  const items = d.items.map((i) => ({ id: i.id, title: i.title, category: i.category, pitch: i.pitch, keep: i.keep, action: i.action }));
  const last = d.planVersions.at(-1);
  if (last && JSON.stringify(last.items) === JSON.stringify(items)) return;
  d.planVersions = [...d.planVersions, { n: (last?.n ?? 0) + 1, at: now(), why, items }].slice(-20);
}

/** I2: what changed from one version of the plan to the next (added, removed, renamed, recategorised, repitched). */
export function planDiff(d: StudioDraft, n?: number) {
  const vs = d.planVersions;
  const cur = n ? vs.find((v) => v.n === n) : vs.at(-1);
  if (!cur) return null;
  const prev = vs[vs.indexOf(cur) - 1];
  if (!prev) return { n: cur.n, why: cur.why, added: cur.items.map((i) => i.id), removed: [] as string[], renamed: [] as { id: string; from: string }[], recategorised: [] as { id: string; from: string | null }[], repitched: [] as string[] };
  const before = new Map(prev.items.map((i) => [i.id, i]));
  const now_ = new Set(cur.items.map((i) => i.id));
  return {
    n: cur.n,
    why: cur.why,
    added: cur.items.filter((i) => !before.has(i.id) || (i.keep && !before.get(i.id)!.keep)).map((i) => i.id),
    removed: prev.items.filter((i) => !now_.has(i.id) || (i.keep && !cur.items.find((x) => x.id === i.id)?.keep)).map((i) => i.title),
    renamed: cur.items.filter((i) => before.has(i.id) && before.get(i.id)!.title !== i.title).map((i) => ({ id: i.id, from: before.get(i.id)!.title })),
    recategorised: cur.items.filter((i) => before.has(i.id) && before.get(i.id)!.category !== i.category).map((i) => ({ id: i.id, from: before.get(i.id)!.category })),
    repitched: cur.items.filter((i) => before.has(i.id) && before.get(i.id)!.pitch !== i.pitch).map((i) => i.id),
  };
}

/**
 * I2: an entry already in the book joins the plan: "change" (rewritten from your words, keeping
 * to what it says now) or "off" (switched off when you save).
 */
export function planExisting(id: string, entryId: string, action: "change" | "off", pitch = "") {
  const d0 = mustDraft(id);
  const book = d0.targetBookId ? getLorebook(d0.targetBookId) : undefined;
  const e = book?.entries.find((x) => x.id === entryId);
  if (!e) throw notFound("That entry isn't in the book this plan saves into");
  return mutate(id, (d) => {
    d.items = d.items.filter((i) => i.targetEntryId !== entryId);
    const x = e.extra as { type?: EntryType; category?: Category };
    d.items.push(
      normItem({
        title: e.comment || e.keys[0] || "Untitled",
        type: x.type ?? null,
        category: x.category ?? null,
        pitch: action === "off" ? "Switch this entry off." : pitch.trim() || "Bring it up to date with the plan.",
        // A change is a rewrite of what the entry says now, steered by your words.
        entry: action === "change" ? { content: e.content, keys: e.keys, aliases: [], essentials: "", secrets: [] } : null,
        steer: action === "change" ? pitch.trim() || "Bring it up to date with the plan." : "",
        constant: e.constant,
        action,
        targetEntryId: entryId,
        // A switch-off has nothing to write.
        status: action === "off" ? "drafted" : "planned",
      }),
    );
    snapshotPlan(d, action === "off" ? `switch off ${e.comment || "an entry"}` : `change ${e.comment || "an entry"}`);
  });
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
  const options = optionsOf(input.kind, input.options);
  const d: StudioDraft = {
    id,
    title: input.title?.trim() || "",
    stage: "start",
    planVersions: [],
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
    version: null,
    createdAt: t,
    updatedAt: t,
  };
  if (input.kind === "version") {
    // Filled in by lore/versionlore.ts (createVersionLore): the version's text, its plan and its items.
    if (!input.refId) throw badRequest("Pick a version");
    d.source.text = input.text?.trim() ?? "";
    d.stage = "plan";
  } else if (input.kind === "character") {
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

export type ItemPatch = Partial<Pick<StudioItem, "title" | "type" | "pitch" | "parent" | "folder" | "source" | "constant" | "keep" | "steer" | "category" | "about">> & { entry?: StudioEntry | null };

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
    if (p.category !== undefined) {
      it.category = p.category && (CATEGORIES as readonly string[]).includes(p.category) ? p.category : null;
      // The kind says what the Codex calls it.
      if (it.category && CATEGORY_INFO[it.category].type) it.type = CATEGORY_INFO[it.category].type!;
    }
    if (p.about !== undefined) it.about = p.about.filter((x) => x !== itemId);
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
    const category = p.category ?? null;
    made = normItem({ title: cleanTitle(p.title ?? "") || "New entry", type: p.type ?? (category && CATEGORY_INFO[category].type) ?? null, category, pitch: p.pitch ?? "", parent: p.parent ?? "", folder: p.folder ?? "", source: p.source ?? "", constant: p.constant ?? false, about: p.about ?? [] });
    d.items.push(made);
  });
  return { draft: d, item: made! };
}

export function removeItem(id: string, itemId: string) {
  return mutate(id, (d) => {
    d.items = d.items.filter((i) => i.id !== itemId);
    for (const i of d.items) if (i.parent === itemId) i.parent = "";
    for (const i of d.items) if (i.about.includes(itemId)) i.about = i.about.filter((x) => x !== itemId);
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
  const label = { idea: "THE AUTHOR'S IDEA", character: "THE CHARACTER CARD", persona: "THE PERSONA", document: "THE DOCUMENT", book: "THE EXISTING LOREBOOK", version: "THE VERSION (the card or persona this lore is for)" }[d.source.kind];
  return [`${label}:\n${text || "(nothing yet)"}`, expansionBlock(d.expansion)].filter(Boolean).join("\n\n");
};

const answersBlock = (d: StudioDraft) => {
  const qa = d.questions.filter((q) => q.answer.trim());
  return qa.length ? `THE AUTHOR'S ANSWERS (their own words; they outrank your ideas):\n${qa.map((q) => `Q: ${q.q}\nA: ${q.answer.trim()}`).join("\n\n")}` : "";
};

const prefsBlock = (d: StudioDraft) =>
  [d.options.tone.trim() && `TONE AND GENRE: ${d.options.tone.trim()}`, d.options.style.trim() && `STYLE NOTES: ${d.options.style.trim()}`, Object.keys(d.options.mix).length ? `ENTRY KINDS WANTED: ${Object.entries(d.options.mix).map(([k, l]) => `${k} (${l})`).join(", ")}` : ""].filter(Boolean).join("\n");

const PURPOSE: Record<SourceKind, string> = {
  idea: "Build it from the author's idea and answers.",
  character:
    "This is a companion lorebook for a character card: the events of their past, the people in their life, the places they know, the things they own or want, and the parts of their world their story needs. Don't make an entry for the character themself: the card covers them. Stay consistent with the card.",
  persona:
    "This is a lorebook for the user's own persona: the people, places, history and possessions around them, so stories can draw on their past. The persona is the person the human player plays ({{user}} in a chat), not a character the AI plays: don't make an entry for the persona themself, mention them by name, never as {{char}}, and never decide what they feel or do. Stay consistent with the persona.",
  document: "Turn the author's document into entries. Use only what the document says.",
  book: "Grow an existing lorebook: propose entries it lacks. Never repeat an entry it has.",
  version:
    "This is the lorebook of a VERSION (an alternate universe, another era, a time skip or a what-if): each entry is the original's entry translated into this version through THE MAP, or a new one the version needs. Keep what the map keeps, rename and rework what it changes, never mention what it dropped, and keep the role each thing plays in the story. Don't make an entry for the version themself: their card covers them.",
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
    system: `You help an author build a lorebook for interactive fiction (roleplay). ${PURPOSE[d.source.kind]} Read their material, then reply with: "understood": 2–4 sentences on what you understood (premise, tone, what's central); "missing": up to 4 short phrases naming what's still unclear; ${BASED_ON_RULE} "questions": up to ${n} pointed questions worth asking, most important first, each with "why" (one short sentence on what the answer changes in the lorebook) and ${SUGGEST_RULE} Ask about tension, specifics and the author's intent, never trivia, and never what the material (or canon, for an existing work) already answers. Ask, never assert: a question's premise may state only what the author established; raise a new possibility as a question ("is there a faction that…"), never as a fact ("who leads the faction that…"), because an invented premise steers the author and leaks into their canon. One thing per question, in plain words. Reply with JSON only: {"understood": "…", "missing": ["…"], "basedOn": "", "questions": [{"q": "…", "why": "…", "suggestions": ["…", "…", "…"]}]}`,
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

const asKind = (t: string): Category | null => ((CATEGORIES as readonly string[]).includes(t.trim().toLowerCase()) ? (t.trim().toLowerCase() as Category) : null);
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
  items: z.array(z.object({ title: z.string(), kind: z.string().default(""), type: z.string().default(""), pitch: z.string().default(""), parent: z.string().default(""), folder: z.string().default(""), now: z.boolean().default(false), about: z.array(z.string()).default([]) })).default([]),
});

type OutlineItem = z.infer<typeof outlineSchema>["items"][number];

/** One planning call: about n entries, or exactly the names given. */
async function outlineCall(d: StudioDraft, o: { n: number; more: boolean; names?: CensusEntry[]; census?: CensusEntry[]; steer?: string; planned: StudioItem[]; withOverview: boolean; kinds?: Category[] }) {
  const planned = o.planned.map((i) => `- ${i.title}${i.category ?? i.type ? ` (${i.category ?? i.type})` : ""}${i.pitch ? `: ${i.pitch}` : ""}`);
  const existing = existingTitles(d);
  const gaps = d.source.kind === "book" && d.source.refId ? missingNames(d.source.refId) : [];
  const kinds = o.kinds ?? allowedKinds(d.options.mix);
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
      o.names ? "" : 'Also plan what is already under way when the story begins (an attack in progress, who is hiding where and from whom, what people wrongly believe right now): one entry per situation, titled for what is happening ("Raiders Burn the Docks", "Mira Hides Joss from the Guild"), kind "current", with "now": true. These stay in every scene until the story moves past them, so plan only what is true at the opening, never backstory or what comes later. Every other item has "now": false.',
      `Each item: "title" (the name as the story would say it), "kind" (one of the kinds under KINDS, as written), "pitch" (one sentence: what the entry establishes in this version of the story and why a scene would need it), "parent" (the title of another planned entry it sits inside: a district inside a city, a member inside a faction; else ""), "folder" (a short path like "Places › Port Ellis", else ""), "now" (true only for a situation under way at the opening).`,
      o.withOverview ? `Also "title" (a name for the lorebook, 1–5 words) and "overview" (80–150 words: the world's premise, tone, and the ground truths every scene should respect).` : 'Leave "overview" and "title" empty.',
      d.options.faithful ? "Use only what the source says: no invented names, places or facts." : "Prefer specific, playable details with tension: things characters can want, fear, visit, use or argue about. Invent freely where the material and canon are silent, but never against them.",
      d.basedOn ? "" : AVOID,
      o.steer?.trim() ? `The author asks: ${o.steer.trim()}` : "",
      kinds.includes("current") ? "" : 'Plan nothing under way at the opening: "now" is always false.',
      'Reply with JSON only: {"title": "…", "overview": "…", "items": [{"title": "…", "kind": "…", "pitch": "…", "parent": "", "folder": "", "now": false}]}',
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
      `KINDS (what each is for):\n${mixBrief(d.options.mix, kinds)}`,
    ]
      .filter(Boolean)
      .join("\n\n"),
    maxTokens: Math.min(8000, 1200 + (o.names?.length ?? o.n) * 160),
    temperature: d.options.faithful ? 0.3 : 0.7,
  });
  return r.data;
}

/** Plan items from the model's outline: people split one per entry, duplicates dropped. */
function toItems(raw: OutlineItem[], taken: Set<string>, census: CensusEntry[], allowed: Category[] = [...CATEGORIES]): StudioItem[] {
  const out: StudioItem[] = [];
  for (const x of raw) {
    const kind = asKind(x.kind) ?? (x.now ? "current" : null);
    // A kind the mix leaves out isn't planned.
    if (kind && !allowed.includes(kind)) continue;
    const type = (kind && CATEGORY_INFO[kind].type) || asType(x.type) || census.find((e) => covers([e.name], x.title))?.type || null;
    const titles = type === "character" ? splitPeople(cleanTitle(x.title)) : [cleanTitle(x.title)];
    for (const title of titles) {
      if (!title || taken.has(title.toLowerCase())) continue;
      taken.add(title.toLowerCase());
      out.push(normItem({ title, type, ...(kind ? { category: kind } : {}), pitch: titles.length > 1 ? (census.find((e) => covers([e.name], title))?.note || x.pitch.trim()) : x.pitch.trim(), folder: x.folder.trim(), parent: x.parent.trim() }));
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
  // docs/17: the kinds the mix allows; people's satellites (voices, bonds…) get their own pass after the people.
  const mix = d.options.mix;
  const allowed = allowedKinds(mix);
  const sats = (Object.keys(mix) as Category[]).filter(isSatellite);
  const worldKinds = sats.length ? allowed.filter((c) => !isSatellite(c)) : allowed;
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
      const data = await outlineCall(d, { n: batch.length || PLAN_SIZE.large, more: !first, names: batch.length ? batch : undefined, census, steer: opts.steer, planned: [...keptOnReplan, ...fresh], withOverview: first, kinds: worldKinds });
      if (first) {
        title = data.title;
        overview = data.overview;
      }
      fresh.push(...toItems(data.items, taken, census, allowed));
      if (!batch.length) break;
    }
    // The ideas that hold the world together (concepts, rules, events) beyond the census's names.
    if (complete && !named) {
      const data = await outlineCall(d, { n: 8, more: true, steer: ["Now the concepts, rules, events and places that make this world work and aren't planned yet.", opts.steer ?? ""].join(" "), planned: [...keptOnReplan, ...fresh], withOverview: false, kinds: worldKinds });
      fresh.push(...toItems(data.items, taken, census, allowed));
    }
  } else {
    const base = opts.count ?? (more ? Math.max(4, Math.round(PLAN_SIZE[d.options.size] / 3)) : PLAN_SIZE[d.options.size]);
    // Every core name fits, whatever the size.
    const n = more ? base : Math.max(base, census.filter((e) => e.tier === "core").length + 4);
    const data = await outlineCall(d, { n, more, census, steer: opts.steer, planned: more ? d.items : [], withOverview: !more, kinds: more ? allowed : worldKinds });
    title = data.title;
    overview = data.overview;
    fresh.push(...toItems(data.items, taken, census, allowed).slice(0, more ? n : 120));
  }

  // The people's satellites, now that the people are planned (a fresh plan only; "more" and names add to it).
  if (!more && !named && sats.length) {
    const pool = [...keptOnReplan, ...fresh];
    fresh.push(...(await satellitePass(d, pool, satelliteTargets(d, pool, sats), taken)));
  }
  // docs/17, 5.3: a companion book's shared moments, from what the card says happened.
  if (!more && !named && d.source.kind === "character" && d.source.refId && (!Object.keys(mix).length || mix.moment)) fresh.push(...(await companionMoments(d, [...keptOnReplan, ...fresh], taken)));
  // 5.1: a book based on an existing work holds a timeline boundary, so the story neither spoils nor skips canon.
  if (!more && !named && wantsTimeline(d) && ![...keptOnReplan, ...fresh].some((i) => i.category === "timeline")) fresh.unshift(timelineItem(d));

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
    snapshotPlan(cur, more ? (opts.steer?.trim() ? `planned more: ${opts.steer.trim()}` : "planned more") : opts.steer?.trim() ? `planned: ${opts.steer.trim()}` : "the plan");
  });
}

// ---------- satellites (docs/17, 2.2–2.4) ----------

/** One satellite to plan, or a few: these kinds about this person ("few" kinds are spread over the people). */
interface SatTarget {
  person: StudioItem;
  kinds: Category[];
}

const isPerson = (i: StudioItem) => i.keep && i.action !== "off" && (i.category === "character" || (!i.category && i.type === "character"));

/** The people a satellite is for: the census's core ones (all of them without a census), at most 10. */
function corePeople(d: StudioDraft, pool: StudioItem[]): StudioItem[] {
  const people = pool.filter(isPerson);
  const core = (d.census ?? []).filter((e) => e.tier === "core").map((e) => e.name);
  const picked = core.length ? people.filter((p) => covers(core, p.title) || core.some((n) => covers([p.title], n))) : people;
  return (picked.length ? picked : people).slice(0, 10);
}

/** The satellites already planned about a person, by kind. */
const satellitesOf = (pool: StudioItem[], personId: string) => pool.filter((i) => i.keep && i.about.includes(personId));

/** Who gets which satellite kinds: "each" for every core person, "all" for every person, "few" for the core ones (the planner picks). */
function satelliteTargets(d: StudioDraft, pool: StudioItem[], kinds: Category[]): SatTarget[] {
  const core = corePeople(d, pool);
  const everyone = pool.filter(isPerson).slice(0, 24);
  const out = new Map<string, SatTarget>();
  for (const k of kinds) {
    const level = d.options.mix[k] ?? "few";
    for (const p of level === "all" ? everyone : core) {
      if (CATEGORY_INFO[k].subject === "one" && satellitesOf(pool, p.id).some((s) => s.category === k)) continue;
      const t = out.get(p.id) ?? { person: p, kinds: [] };
      t.kinds.push(k);
      out.set(p.id, t);
    }
  }
  return [...out.values()];
}

const satSchema = z.object({ items: z.array(z.object({ title: z.string(), kind: z.string().default(""), pitch: z.string().default(""), about: z.array(z.string()).default([]) })).default([]) });

/** Default titles, when the planner leaves one out. */
function satTitle(kind: Category, about: string[]): string {
  const [a, b] = about;
  if (kind === "voice") return `Voice: ${a}`;
  if (kind === "relationship" && b) return `${a} & ${b}`;
  return `${CATEGORY_INFO[kind].label}: ${about.join(" & ")}`;
}

/**
 * Plans the satellites for these people in one call: each person's kinds, about them by exact
 * title ("{{user}}" for the player's character), never one already planned.
 */
async function satellitePass(d: StudioDraft, pool: StudioItem[], targets: SatTarget[], taken: Set<string>): Promise<StudioItem[]> {
  if (!targets.length) return [];
  const kinds = [...new Set(targets.flatMap((t) => t.kinds))];
  const few = kinds.filter((k) => d.options.mix[k] === "few");
  const user = d.source.kind === "persona" ? d.source.refName || "{{user}}" : "{{user}}";
  const already = pool.filter((i) => i.about.length).map((i) => `- ${i.title} (${i.category})`);
  const r = await callJson({
    task: "summarizer",
    kind: "studio:satellites",
    name: "studio_satellites",
    schema: satSchema,
    system: [
      "You plan the entries of a lorebook that belong to its people: how each one talks, what's between two of them, how one reacts when a topic comes up, what one keeps secret, a moment two of them share. A storyteller sees each only when it matters, so each one needs a specific, playable subject.",
      PURPOSE[d.source.kind],
      "For each person under THE PEOPLE, plan the kinds listed after their name: one entry per kind, unless the kind is listed under A FEW IN TOTAL, which means a few spread over the people where it matters most.",
      `Each item: "title" (following the kind's title pattern under KINDS), "kind" (as written), "pitch" (one sentence: what it establishes and when a scene needs it), "about" (the exact titles of the one or two people it's about; "${user}" for the player's character).`,
      "A relationship or shared moment is about exactly two people, and only where there is something real between them. A reaction is one topic and one behaviour. Never plan one that's under ALREADY PLANNED.",
      canonRule(d.basedOn),
      'Reply with JSON only: {"items": [{"title": "…", "kind": "…", "pitch": "…", "about": ["…"]}]}',
    ]
      .filter(Boolean)
      .join(" "),
    user: [
      d.overview.trim() ? `OVERVIEW:\n${d.overview.trim()}` : sourceBlock(d),
      canonBlock(d.basedOn),
      answersBlock(d),
      `KINDS (what each is for):\n${kinds.map((k) => `- ${k}: ${PLAN_WHEN[k]}`).join("\n")}`,
      few.length ? `A FEW IN TOTAL: ${few.join(", ")}` : "",
      `THE PEOPLE:\n${targets.map((t) => `- ${t.person.title}: ${t.kinds.join(", ")}${t.person.entry?.essentials || t.person.pitch ? ` (${t.person.entry?.essentials || t.person.pitch})` : ""}`).join("\n")}`,
      `EVERYONE ELSE IN THE PLAN:\n${pool.filter(isPerson).filter((p) => !targets.some((t) => t.person.id === p.id)).map((p) => p.title).slice(0, 40).join(", ") || "(nobody)"}`,
      already.length ? `ALREADY PLANNED:\n${already.join("\n")}` : "",
    ]
      .filter(Boolean)
      .join("\n\n"),
    maxTokens: Math.min(6000, 600 + targets.reduce((n, t) => n + t.kinds.length, 0) * 140),
    temperature: d.options.faithful ? 0.3 : 0.7,
  });
  const people = pool.filter(isPerson);
  const idOf = (name: string) => {
    if (/^\{\{user\}\}$/i.test(name.trim()) || name.trim().toLowerCase() === user.toLowerCase()) return "user";
    const n = name.trim().toLowerCase();
    return people.find((p) => p.title.toLowerCase() === n)?.id ?? people.find((p) => covers([p.title], name))?.id ?? null;
  };
  const out: StudioItem[] = [];
  for (const x of r.data.items) {
    const kind = asKind(x.kind);
    if (!kind || !kinds.includes(kind)) continue;
    const about = [...new Set(x.about.map(idOf).filter((v): v is string => Boolean(v)))];
    if (!about.some((a) => a !== "user")) continue;
    if (CATEGORY_INFO[kind].subject === "one" && about.length > 1) about.length = 1;
    // One voice (or reaction set…) per person: a second "each" one for the same person is dropped.
    if (kind === "voice" && [...pool, ...out].some((i) => i.category === "voice" && i.about[0] === about[0])) continue;
    const names = about.map((a) => (a === "user" ? "{{user}}" : people.find((p) => p.id === a)!.title));
    const title = cleanTitle(x.title) || satTitle(kind, names);
    if (taken.has(title.toLowerCase())) continue;
    taken.add(title.toLowerCase());
    out.push(normItem({ title, category: kind, type: CATEGORY_INFO[kind].type ?? null, pitch: x.pitch.trim(), about }));
  }
  return out;
}

const momentSchema = z.object({ items: z.array(z.object({ title: z.string(), pitch: z.string().default(""), words: z.array(z.string()).default([]) })).default([]) });

/**
 * Shared moments between the card's character and {{user}} (docs/17, 5.3): only what the card's
 * scenario, first message and example dialogue say happened, never a history it contradicts. Each
 * fires on words from the moment itself, so "remember the lighthouse?" brings it all back.
 */
async function companionMoments(d: StudioDraft, pool: StudioItem[], taken: Set<string>): Promise<StudioItem[]> {
  const card = getCard(d.source.refId!);
  if (!card) return [];
  const level = d.options.mix.moment ?? "few";
  const already = pool.filter((i) => i.category === "moment").map((i) => `- ${i.title}`);
  const r = await callJson({
    task: "summarizer",
    kind: "studio:moments",
    name: "studio_moments",
    schema: momentSchema,
    system: [
      `You plan the shared moments of a companion lorebook: moments ${card.name} and {{user}} (the player's character) remember together. A storyteller brings one back whenever it's mentioned.`,
      d.options.faithful
        ? "Plan only moments the card states happened (in the scenario, the first message or the example dialogue). If it states none, plan none."
        : "Plan moments the card states or clearly implies happened (in the scenario, the first message or the example dialogue). Never invent a history the card contradicts, and never decide what {{user}} felt.",
      `${level === "few" ? "Two or three at most" : "One for each moment the card names"}. Never one under ALREADY PLANNED.`,
      'Each item: "title" (what they\'d call it: "The Night of the Dark Lamp"), "pitch" (one sentence: what happened and what it means now), "words" (2–4 short phrases a chat would use about it: "the dark lamp", "that storm"; never just a name).',
      'Reply with JSON only: {"items": [{"title": "…", "pitch": "…", "words": ["…"]}]}',
    ].join(" "),
    user: [`THE CARD: ${card.name}`, card.scenario.trim() ? `SCENARIO:\n${card.scenario.trim().slice(0, 3000)}` : "", card.first_mes.trim() ? `FIRST MESSAGE:\n${card.first_mes.trim().slice(0, 3000)}` : "", card.mes_example?.trim() ? `EXAMPLE DIALOGUE:\n${card.mes_example.trim().slice(0, 3000)}` : "", card.description.trim() ? `DESCRIPTION:\n${card.description.trim().slice(0, 2000)}` : "", already.length ? `ALREADY PLANNED:\n${already.join("\n")}` : ""].filter(Boolean).join("\n\n"),
    maxTokens: 900,
    temperature: d.options.faithful ? 0.2 : 0.5,
  });
  const out: StudioItem[] = [];
  // Never just a name: "Mira" would bring the memory into every scene she's in.
  const names = new Set([card.name, ...card.name.split(/\s+/), "{{user}}", "{{char}}"].map((n) => n.toLowerCase()));
  for (const x of r.data.items.slice(0, level === "few" ? 3 : 8)) {
    const title = cleanTitle(x.title);
    if (!title || taken.has(title.toLowerCase())) continue;
    taken.add(title.toLowerCase());
    const cues = dedupe(x.words.map((w) => w.trim()).filter((w) => w.length >= 3 && w.length <= 40 && !names.has(w.toLowerCase()))).slice(0, 4);
    out.push(normItem({ title, category: "moment", type: "event", pitch: x.pitch.trim(), about: [`card:${d.source.refId}`, "user"], cues }));
  }
  return out;
}

/** The default satellites a Pack plans when the mix names none. */
function packKinds(d: StudioDraft): Category[] {
  const fromMix = (Object.keys(d.options.mix) as Category[]).filter(isSatellite);
  if (fromMix.length) return fromMix;
  return ["voice", "relationship", "reaction", ...(d.options.secrets ? (["secret"] as const) : [])];
}

/** The satellites a person is still missing (one-person kinds they don't have yet; bonds and moments always fit one more). */
export function missingSatellites(d: StudioDraft, itemId: string): Category[] {
  const have = new Set(satellitesOf(d.items, itemId).map((s) => s.category));
  return packKinds(d).filter((k) => !have.has(k));
}

/** Pack: plans the satellites one person is missing (or just these kinds). */
export async function planPack(id: string, itemId: string, kinds?: Category[]) {
  const d = mustDraft(id);
  const person = d.items.find((i) => i.id === itemId);
  if (!person) throw notFound("Item not found");
  const want = (kinds?.length ? kinds.filter(isSatellite) : missingSatellites(d, itemId)).filter((k) => !(CATEGORY_INFO[k].subject === "one" && satellitesOf(d.items, itemId).some((s) => s.category === k)));
  if (!want.length) return d;
  const taken = new Set([...d.items.map((i) => i.title.toLowerCase()), ...existingTitles(d).map((t) => t.toLowerCase())]);
  // A pack is one person's: "few" means one or two for them, not a spread.
  const solo = { ...d, options: { ...d.options, mix: Object.fromEntries(want.map((k) => [k, "each"])) as Mix } };
  const fresh = await satellitePass(solo, d.items, [{ person, kinds: want }], taken);
  return mutate(id, (cur) => {
    // Right after the person and their other satellites, so they're written after them.
    const at = cur.items.reduce((last, i, k) => (i.id === itemId || i.about.includes(itemId) ? k : last), cur.items.length - 1);
    cur.items.splice(at + 1, 0, ...fresh);
    snapshotPlan(cur, `a pack for ${person.title}`);
  });
}

export interface KindGap {
  kind: Category;
  /** The person it's missing for (empty for a book-wide gap like the timeline boundary). */
  about: string[];
  label: string;
}

/** What the mix asks for that the plan doesn't have yet (docs/17, 2.4). */
export function kindGaps(d: StudioDraft): KindGap[] {
  const mix = d.options.mix;
  const out: KindGap[] = [];
  const book = d.targetBookId ? getLorebook(d.targetBookId) : undefined;
  const inBook = (k: Category) => Boolean(book?.entries.some((e) => (e.extra as { category?: string }).category === k));
  const planned = (k: Category) => d.items.some((i) => i.keep && i.category === k) || inBook(k);
  for (const k of (Object.keys(mix) as Category[]).filter((c) => CATEGORY_INFO[c].subject === "one" && mix[c] !== "few")) {
    for (const p of mix[k] === "all" ? d.items.filter(isPerson) : corePeople(d, d.items)) {
      if (!satellitesOf(d.items, p.id).some((s) => s.category === k)) out.push({ kind: k, about: [p.id], label: p.title });
    }
  }
  const empty = !Object.keys(mix).length;
  if (wantsTimeline(d) && !planned("timeline")) out.push({ kind: "timeline", about: [], label: "" });
  if (mix.rule && !planned("rule")) out.push({ kind: "rule", about: [], label: "" });
  return out;
}

/** The timeline boundary a book based on an existing work plans (docs/17, 5.1). */
function timelineItem(d: StudioDraft): StudioItem {
  return normItem({ title: "Timeline: where the story stands", category: "timeline", type: "rule", constant: true, pitch: `Where the story stands at the opening${d.basedOn ? ` of ${d.basedOn}` : ""}: what has already happened, and the named events that haven't yet.` });
}

/** Whether a book wants a timeline boundary: based on an existing work, and the mix doesn't leave it out. */
const wantsTimeline = (d: StudioDraft) => Boolean(d.basedOn.trim()) && (!Object.keys(d.options.mix).length || Boolean(d.options.mix.timeline));

/** Plans every gap: the people's missing satellites in one call, a timeline boundary, rules. */
export async function planGaps(id: string) {
  let d = mustDraft(id);
  const gaps = kindGaps(d);
  if (!gaps.length) return d;
  const byPerson = new Map<string, SatTarget>();
  for (const g of gaps.filter((x) => x.about.length)) {
    const person = d.items.find((i) => i.id === g.about[0]);
    if (!person) continue;
    const t = byPerson.get(person.id) ?? { person, kinds: [] };
    t.kinds.push(g.kind);
    byPerson.set(person.id, t);
  }
  const taken = new Set([...d.items.map((i) => i.title.toLowerCase()), ...existingTitles(d).map((t) => t.toLowerCase())]);
  const fresh = byPerson.size ? await satellitePass(d, d.items, [...byPerson.values()], taken) : [];
  if (gaps.some((g) => g.kind === "rule")) {
    const data = await outlineCall(d, { n: 3, more: true, steer: 'Only the rules of this world (kind "rule"): laws that must always hold.', planned: d.items, withOverview: false, kinds: ["rule"] });
    fresh.push(...toItems(data.items, taken, d.census ?? [], ["rule"]));
  }
  d = mutate(id, (cur) => {
    if (gaps.some((g) => g.kind === "timeline") && !cur.items.some((i) => i.category === "timeline")) cur.items.unshift(timelineItem(cur));
    cur.items.push(...fresh);
    snapshotPlan(cur, "filled the gaps");
  });
  return d;
}

// ---------- writing (background) ----------

const entrySchema = z.object({
  content: z.string().min(1),
  keys: z.array(z.string()).default([]),
  aliases: z.array(z.string()).default([]),
  essentials: z.string().default(""),
  secrets: z.array(z.object({ text: z.string(), knownBy: z.array(z.string()).default([]) })).default([]),
  parts: z.record(z.string(), z.union([z.string(), z.array(z.string())])).default({}),
});

/** Whose voice a Voice entry is, from its title ("Voice: Mira Vell" → "Mira Vell"). */
export const voiceOwner = (title: string) => baseTitle(title.replace(/^\s*voice\s*(?:of|:|—|-)\s*/i, "").replace(/['’]s voice\s*$/i, ""));

/** A card's text as a subject: who they are, and what the card says happened. */
function cardText(c: NonNullable<ReturnType<typeof getCard>>) {
  return [c.description, c.personality, c.scenario, c.first_mes, c.mes_example].filter((x) => x?.trim()).join("\n\n");
}

/** A satellite's subjects: who it's about, with their names and what's written of them so far. */
function subjectsOf(d: StudioDraft, it: StudioItem) {
  const book = d.targetBookId ? getLorebook(d.targetBookId) : undefined;
  return it.about.flatMap((ref) => {
    if (ref === "user") return [];
    if (ref.startsWith("card:")) {
      const c = getCard(ref.slice(5));
      return c ? [{ name: c.name, aliases: [] as string[], text: cardText(c).slice(0, 2500), research: "" }] : [];
    }
    if (ref.startsWith("entry:")) {
      const e = book?.entries.find((x) => x.id === ref.slice(6));
      return e ? [{ name: e.comment || e.keys[0] || "", aliases: extraOf(e).aliases ?? [], text: e.content.slice(0, 1500), research: "" }] : [];
    }
    const p = d.items.find((x) => x.id === ref);
    return p ? [{ name: baseTitle(p.title), aliases: p.entry?.aliases ?? [], text: p.entry?.content.slice(0, 1500) || p.pitch, research: p.research?.text ?? "" }] : [];
  });
}

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
      // I2: a planned change rewrites the book's entry; a switch-off has nothing to write.
      const pick = it.action === "off" ? false : opts.itemIds ? want.has(it.id) : opts.all ? it.keep : it.keep && (!it.entry || (it.action === "change" && it.status === "planned"));
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
  // A satellite reads its subject's page instead of looking up its own title.
  const satellite = item.about.some((a) => a !== "user");
  const it = { ...item, research: satellite ? item.research : await entryPage(d, item) };
  const kind = it.category;
  const template = kind ? { label: CATEGORY_INFO[kind].label, fields: CATEGORY_INFO[kind].fields } : it.type ? ENTRY_TEMPLATES[it.type] : null;
  const subjects = subjectsOf(d, it);
  const withUser = it.about.includes("user");
  const shaped = Boolean(kind && SHAPES[kind]);
  const hidden = Boolean(kind && HIDDEN_PART[kind]);
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
  const cast = [d.source.kind === "character" || d.source.kind === "persona" || d.source.kind === "version" ? d.source.refName : ""].filter(Boolean);
  const vs = it.versionSource;
  const r = await callJson({
    task: "summarizer",
    kind: "studio:entry",
    jobId: job?.id,
    name: "studio_entry",
    schema: entrySchema,
    system: [
      `You write one lorebook entry for interactive fiction: "${it.title}"${it.type ? ` (${template!.label.toLowerCase()})` : ""}. The storyteller reads it only when the entry fires, so it must stand on its own.`,
      `"content": ${wordsFor(WORDS[d.options.length], kind)} words, third person, present tense, plain declarative sentences a storyteller can use in a scene: concrete looks, behaviour, history, relationships and stakes.${template ? ` Cover what fits of: ${template.fields.join(", ")}.` : ""} No headings, no lists of adjectives, no meta commentary.`,
      kind ? (KIND_BRIEF[kind] ?? "") : "",
      kind && shaped ? partsAsk(kind) : "",
      kind === "voice" && d.basedOn ? "They're from an existing work: keep their canon speech (accent, dialect, signature words and turns of phrase) from what's written of them and their wiki page." : "",
      subjects.length || withUser ? `It's about ${[...subjects.map((s) => s.name), ...(withUser ? ["{{user}} (the player's character; never decide what {{user}} does or feels)"] : [])].join(" and ")}: stay true to what's written of them under IT'S ABOUT.` : "",
      "Tie it into the world: name the two or three other entries it matters most to and how (who they love, owe, fear or lie to; where it is; who holds it), using their exact titles. Show character through what they do and say, not adjectives; give the storyteller something to play (a want, a tension, a tell, a line of dialogue in their voice for people).",
      canonRule(d.basedOn),
      `"keys": 2–6 trigger words: the names, nicknames and short phrases a story uses when this matters. Never common words that would fire on every message. "aliases": other names it goes by (can be empty). "essentials": one sentence, the single most important fact.`,
      hidden ? `"secrets": the hidden truth (the same as its "truth" part), with "knownBy" naming who knows it.` : d.options.secrets && !faithful ? `"secrets": 0–2 hidden truths that would change scenes if revealed, each with "knownBy" (who knows it, by name). Only where it fits; most entries have none.` : `"secrets": [] unless the source states a secret, with "knownBy" naming who knows it.`,
      faithful ? "Use only what the source notes say; keep every name, number and fact exact; add nothing." : "Stay consistent with the overview, the source and the rest of the plan; invent only details that fit.",
      d.basedOn ? "" : AVOID,
      shaped
        ? 'Reply with JSON only: {"content": "…", "parts": {…}, "keys": ["…"], "aliases": ["…"], "essentials": "…", "secrets": [{"text": "…", "knownBy": ["…"]}]}'
        : 'Reply with JSON only: {"content": "…", "keys": ["…"], "aliases": ["…"], "essentials": "…", "secrets": [{"text": "…", "knownBy": ["…"]}]}',
    ]
      .filter(Boolean)
      .join(" "),
    user: [
      d.overview.trim() ? `OVERVIEW:\n${d.overview.trim()}` : "",
      d.source.kind === "document" ? "" : sourceBlock(d),
      d.version ? `PURPOSE: ${PURPOSE.version}\n\n${variantBlock(d.version.plan, { original: false })}` : "",
      vs?.text.trim() ? `THE ORIGINAL'S ENTRY${vs.from ? ` ("${vs.from}")` : ""}, to translate into this version through the map (keep its role, change what the map changes):\n${vs.text.trim().slice(0, 8000)}` : "",
      canonBlock(d.basedOn),
      researchBlock(d.research),
      answersBlock(d),
      prefsBlock(d),
      others.length ? `THE REST OF THE LOREBOOK:\n${others.join("\n")}` : "",
      parent ? `IT SITS INSIDE: ${parent.title}: ${parent.essentials}` : "",
      subjects.length ? `IT'S ABOUT:\n${subjects.map((s) => `${s.name}: ${s.text}`).join("\n\n")}` : "",
      subjects.some((s) => s.research) ? `THEIR WIKI PAGE (canon: use these facts; the author's changes win):\n${subjects.find((s) => s.research)!.research.slice(0, 5000)}` : "",
      it.folder ? `FOLDER: ${it.folder}` : "",
      `THIS ENTRY: ${it.title}${kind ? ` (${kind})` : it.type ? ` (${it.type})` : ""}${it.pitch ? `: ${it.pitch}` : ""}`,
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
  // A translated entry never keeps the original's name as a key or alias (unless it's part of the new one).
  const oldName = vs?.state === "changed" && vs.from && !name.toLowerCase().includes(vs.from.toLowerCase()) ? vs.from.toLowerCase() : "";
  const notOld = (k: string) => !oldName || k.trim().toLowerCase() !== oldName;
  // A kind keyed on its names takes its title as a key; a voice, a reaction or a term list doesn't ("Reaction: Mira, when…" isn't a word anyone says).
  const titleKey = !kind || CATEGORY_INFO[kind].fires === "names" || CATEGORY_INFO[kind].fires === "meaning";
  const keys = dedupe([...(titleKey ? [name] : []), ...(it.cues ?? []), ...r.data.keys].filter((k) => k.trim().length >= 2 && k.length <= 50 && !/[.!?]$/.test(k.trim()) && notOld(k)));
  const parts = cleanParts(kind, r.data.parts);
  const secrets = r.data.secrets.filter((s) => s.text.trim()).map((s) => ({ text: s.text.trim(), knownBy: dedupe(s.knownBy) })).slice(0, 3);
  // A hidden truth the writer left only in its parts is kept as a secret, by the people it's about.
  const truth = hiddenSecret(kind, parts, subjects.map((s) => s.name));
  if (truth && !secrets.some((s) => s.text.toLowerCase() === truth.text.toLowerCase())) secrets.unshift(truth);
  const content = joinParts(kind, r.data.content, parts);
  return {
    content,
    keys: keys.slice(0, kind === "lexicon" ? 30 : 8),
    aliases: dedupe(r.data.aliases).filter((a) => notOld(a) && !keys.some((k) => k.toLowerCase() === a.toLowerCase())).slice(0, 6),
    essentials: r.data.essentials.trim() || firstSentences(r.data.content),
    secrets: secrets.slice(0, 3),
    ...(Object.keys(parts).length ? { parts } : {}),
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
  // A version's entries shouldn't name what its world changed or dropped (docs/14).
  if (d.version)
    for (const i of drafted)
      for (const l of findLeaks(d.version.plan.map, [{ where: "field", key: i.id, label: i.title, text: [i.entry!.content, ...i.entry!.keys, ...i.entry!.aliases].join("\n") }]))
        (issues[i.id] ??= []).push({ kind: "leak", severity: "warn", message: l.state === "changed" ? `"${l.term}" is "${l.to}" in this version.` : `"${l.term}" doesn't exist in this version.` });
  // docs/17, 4.1: a voice needs three sample lines, each something they'd say.
  for (const i of drafted) if (i.category === "voice") for (const message of voiceProblems(i.entry!.parts ?? {})) (issues[i.id] ??= []).push({ kind: "voice", severity: "warn", message });
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
    if (isIdeaKind(kind)) {
      // A lorebook from a card or a story has no idea of its own to rewrite.
      changes.push(...ideaChanges(c, d.source.text, d.expansion).filter((x) => x.kind !== "idea" || d.source.kind === "idea"));
      continue;
    }
    const misfiled = kind === "overview" ? misfiledSections(c.text || c.content, d.expansion) : [];
    if (misfiled.length) changes.push(...misfiled);
    else if (kind === "overview" && c.text.trim() && c.text.trim() !== d.overview.trim()) changes.push({ kind, target: "overview", label: "Overview", before: d.overview, after: c.text.trim() });
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
  const kept = lastPerSection(changes);
  const proposal = newProposal(message.trim(), withDropNote(r.data.reply.trim() || (kept.length ? "Here's what I'd change." : "Nothing to change for that."), r.data.changes.length, kept.length), kept);
  return mutate(id, (cur) => {
    cur.chat = addTurns(cur.chat, { role: "user", text: message }, { role: "mea", text: proposal.reply, ...(sources.length ? { sources: sources.map((p) => ({ title: p.title, url: p.url })) } : {}) });
    cur.proposal = kept.length ? proposal : null;
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
    if (ok.some((c) => c.kind === "plan" || c.kind === "add" || c.kind === "remove")) snapshotPlan(d, "asked for changes");
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
  const items = d.items.filter((i) => i.keep && (i.action === "off" ? Boolean(i.targetEntryId) : i.entry?.content.trim()) && !i.savedEntryId && (!pick || pick.has(i.id)));
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
    const inBook = new Map(getLorebook(bookId)!.entries.map((x) => [x.id, x]));
    for (const it of items) {
      // I2: an entry already in the book is switched off, or changed in place.
      const existing = it.targetEntryId ? inBook.get(it.targetEntryId) : undefined;
      if (it.action !== "write" && existing) {
        const { id: eid, ...data } = existing;
        if (it.action === "off") updateEntry(eid, { ...data, enabled: false });
        else updateEntry(eid, { ...data, content: it.entry!.content, keys: it.entry!.keys.length ? it.entry!.keys : data.keys, extra: { ...data.extra, ...(it.category ? { category: it.category } : {}) } });
        saved.set(it.id, eid);
        continue;
      }
      if (it.action !== "write") continue;
      const e = it.entry!;
      const extra: Record<string, unknown> = { ...(it.type ? { type: it.type } : {}), ...(e.aliases.length ? { aliases: e.aliases } : {}), ...(e.essentials ? { essentials: e.essentials } : {}), ...(e.secrets.length ? { secrets: e.secrets } : {}), ...(it.folder ? { folder: it.folder } : {}) };
      // A version's entry remembers the original it came from (docs/14).
      if (it.versionSource) extra.source = { entryId: it.versionSource.entryId, bookId: it.versionSource.bookId, state: it.versionSource.state, basis: it.versionSource.basis, text: it.versionSource.text };
      let entry = defaultEntry({ comment: it.title, keys: e.keys, content: e.content, constant: it.constant, extra });
      // I1: the category's place and priority (an always-on choice of yours stays).
      if (it.category) entry = { ...withCategory(entry, it.category, { defaults: true }), ...(it.constant ? { constant: true } : {}) };
      // docs/17, 3.4: what fires it, by kind (a voice with its person, a reaction on its topic, a relationship on both names).
      if (it.category) entry = withFiring(entry, it.category, subjectsOf(d, it), e.parts ?? {});
      // docs/17, 4.2: a voice with no subject picked still belongs to the person its title names ("Voice: Mira").
      if (it.category === "voice" && !entry.extra.entity) entry = { ...entry, extra: { ...entry.extra, entity: voiceOwner(it.title) } };
      if (e.parts && Object.keys(e.parts).length) entry = { ...entry, extra: { ...entry.extra, parts: e.parts } };
      const made = createEntry(bookId, entry);
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
  // docs/17, 4.2: a voice's slots (pet names, catchphrases, greeting…) become canon facts, so the re-anchor and the drift alert use them from the first chat.
  for (const it of items) {
    const eid = saved.get(it.id);
    if (it.action !== "write" || it.category !== "voice" || !eid || !it.entry?.parts) continue;
    for (const v of voiceSlotValues(it.entry.parts)) createFact(eid, { value: v.value, slot: v.slot, kind: "voice", origin: "studio" });
  }
  if (embeddingsEnabled()) enqueue("lore.embed", {}, { dedupeKey: "lore.embed", delayMs: 4000 });
  // docs/15, 3.2: a companion book's details stage: the card's small details, and the gaps drafted for your yes.
  if (d.source.kind === "character" && d.source.refId) enqueue("lore.details", { bookId, characterId: d.source.refId }, { dedupeKey: `lore.details:${bookId}`, delayMs: 2000, priority: 0 });
  // docs/17, 4.3: and every person the studio wrote gets theirs (the card's own character is covered above).
  const card = d.source.kind === "character" ? baseTitle(d.source.refName).toLowerCase() : "";
  for (const it of items) {
    const eid = saved.get(it.id);
    if (it.action === "write" && eid && (it.category === "character" || (!it.category && it.type === "character")) && baseTitle(it.title).toLowerCase() !== card)
      enqueue("lore.details", { bookId, entryId: eid }, { dedupeKey: `lore.details:${eid}`, delayMs: 2500, priority: 0 });
  }
  return { bookId, added: saved.size + (wantOverview ? 1 : 0) };
}
