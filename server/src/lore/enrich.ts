import { z } from "zod";
import { tidy } from "../creator/expand";
import { type Criterion, runGate, writeTemp } from "../creator/gate";
import { now, one, parseJson, run } from "../db/db";
import { publish } from "../lib/events";
import { badRequest, notFound } from "../lib/http";
import { countTokens } from "../lib/tokens";
import { Deferred, enqueue, type JobContext } from "../services/jobs";
import { callJson } from "../services/llm";
import { getLorebook, updateEntry } from "./service";

/**
 * "Enrich the entries" (Lumiverse's import treatment, adapted): each entry deepened in place, one at
 * a time, written with the rest of the book in view. A rewrite must clear a check (still making the
 * original's claims, more specific, still playable) or the original stands, with a note saying why.
 * Stop any time: what's finished stays, the book is valid at every moment, and any enriched entry
 * can be put back as it was.
 */

export interface EnrichItem {
  entryId: string;
  title: string;
  status: "pending" | "working" | "enriched" | "kept" | "error" | "restored";
  why: string;
  /** The text before enriching, to put back. */
  original: string;
}

export interface EnrichRun {
  bookId: string;
  state: "running" | "stopped" | "done";
  items: EnrichItem[];
  startedAt: number;
}

function load(bookId: string): EnrichRun | null {
  const r = one<{ data: string }>("SELECT data FROM lore_enrich_runs WHERE book_id = ?", bookId);
  return r ? parseJson<EnrichRun | null>(r.data, null) : null;
}

function store(run_: EnrichRun) {
  run("INSERT INTO lore_enrich_runs (book_id, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(book_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at", run_.bookId, JSON.stringify(run_), now());
  publish({ type: "library.changed", what: "lorebooks" });
  return run_;
}

const mutateRun = (bookId: string, fn: (r: EnrichRun) => void) => {
  const r = load(bookId);
  if (!r) throw notFound("No enrich run for this book");
  fn(r);
  return store(r);
};

export const getEnrichRun = (bookId: string) => load(bookId);

/** Starts (or restarts) enriching every entry with text; rules the creator manages are left alone. */
export function startEnrich(bookId: string, opts: { entryIds?: string[] } = {}) {
  const book = getLorebook(bookId);
  if (!book || book.deletedAt) throw notFound("Lorebook not found");
  const want = opts.entryIds ? new Set(opts.entryIds) : null;
  const items = book.entries
    .filter((e) => e.content.trim() && !e.extra.creatorRule && (!want || want.has(e.id)))
    .map((e) => ({ entryId: e.id, title: e.comment || e.keys[0] || "Untitled entry", status: "pending" as const, why: "", original: e.content }));
  if (!items.length) throw badRequest("There's nothing to enrich in this book");
  const r = store({ bookId, state: "running", items, startedAt: now() });
  enqueue("lore.enrich", { bookId }, { dedupeKey: `enrich:${bookId}`, priority: 2, maxAttempts: 2 });
  return r;
}

export function stopEnrich(bookId: string) {
  return mutateRun(bookId, (r) => {
    r.state = "stopped";
    for (const it of r.items) if (it.status === "working") it.status = "pending";
  });
}

/** Puts one enriched entry back as it was. */
export function restoreEnriched(bookId: string, entryId: string) {
  const book = getLorebook(bookId);
  const r = load(bookId);
  const it = r?.items.find((x) => x.entryId === entryId);
  const e = book?.entries.find((x) => x.id === entryId);
  if (!r || !it || !e || it.status !== "enriched") throw badRequest("Nothing to put back");
  updateEntry(e.id, { ...e, content: it.original });
  return mutateRun(bookId, (x) => {
    const i = x.items.find((y) => y.entryId === entryId);
    if (i) i.status = "restored";
  });
}

const CRITERIA: Criterion[] = [
  { key: "grounded", label: "Still the original", description: "It still makes every claim the original made and contradicts nothing in it or the rest of the book; it deepens, it doesn't replace." },
  { key: "better", label: "Better", description: "It's genuinely more specific and useful to a storyteller than the original: concrete details, consequences, connections; not just longer or more purple." },
  { key: "playable", label: "Playable", description: "Everything it adds is something a scene could use; no filler, no meta commentary." },
];

const schema = z.object({ content: z.string().default("") });

/** The job: one entry at a time, re-reading the run between them so Stop applies. */
export async function runEnrichJob(bookId: string, job?: JobContext) {
  for (;;) {
    const r = load(bookId);
    const book = getLorebook(bookId);
    if (!r || !book || r.state !== "running") return;
    const next = r.items.find((i) => i.status === "pending");
    if (!next) {
      mutateRun(bookId, (x) => void (x.state = "done"));
      return;
    }
    const entry = book.entries.find((e) => e.id === next.entryId);
    if (!entry) {
      mutateRun(bookId, (x) => void Object.assign(x.items.find((i) => i.entryId === next.entryId)!, { status: "kept", why: "It's no longer in the book." }));
      continue;
    }
    mutateRun(bookId, (x) => void (x.items.find((i) => i.entryId === next.entryId)!.status = "working"));
    const others = book.entries
      .filter((e) => e.id !== entry.id && e.enabled && e.content.trim())
      .map((e) => `- ${e.comment || e.keys[0] || "Untitled"}: ${e.content.replace(/\s+/g, " ").slice(0, 300)}`)
      .join("\n")
      .slice(0, 9000);
    try {
      const out = await callJson({
        task: "summarizer",
        kind: "lore:enrich",
        name: "lore_enrich",
        jobId: job?.id,
        schema,
        system: [
          "Deepen one lorebook entry in place. Keep every claim the original makes (names, facts, rules) and its purpose; add concrete specifics, consequences and connections to the rest of the book that a storyteller could use. Plain, vivid prose, third person; at most about twice the original's length. No meta commentary.",
          'Reply with JSON only: {"content": "the whole new entry text"}',
        ].join("\n\n"),
        user: [`THE BOOK: ${book.name}`, others ? `THE REST OF THE BOOK (stay consistent with it):\n${others}` : "", `THE ENTRY: ${entry.comment || entry.keys[0] || "Untitled"}\n${entry.content}`].filter(Boolean).join("\n\n"),
        maxTokens: Math.min(3000, countTokens(entry.content) * 3 + 400),
        temperature: writeTemp(0.6),
      });
      const content = tidy(out.data.content);
      const gate = content
        ? await runGate({ kind: "lore:enrich-gate", name: "lore_enrich_gate", what: "an enriched rewrite of a lorebook entry, against its original", criteria: CRITERIA, user: [`THE ORIGINAL:\n${entry.content}`, others ? `THE REST OF THE BOOK:\n${others.slice(0, 4000)}` : "", `THE TEXT TO JUDGE:\n${content}`].filter(Boolean).join("\n\n"), jobId: job?.id })
        : null;
      const stillRunning = load(bookId)?.state === "running";
      if (gate?.passed && stillRunning) {
        const fresh = getLorebook(bookId)?.entries.find((e) => e.id === entry.id);
        // An entry you edited meanwhile is yours: it isn't overwritten.
        if (fresh && fresh.content === entry.content) updateEntry(entry.id, { ...fresh, content });
        mutateRun(bookId, (x) => void Object.assign(x.items.find((i) => i.entryId === entry.id)!, fresh && fresh.content === entry.content ? { status: "enriched", why: "" } : { status: "kept", why: "You edited it while it was being enriched." }));
      } else {
        const why = gate ? gate.criteria.filter((c) => !c.passed).map((c) => c.note || c.label).join(" ") || "The rewrite wasn't better." : "The rewrite came back empty.";
        mutateRun(bookId, (x) => void Object.assign(x.items.find((i) => i.entryId === entry.id)!, { status: stillRunning ? "kept" : "pending", why: stillRunning ? why : "" }));
      }
    } catch (e) {
      if (e instanceof Deferred) {
        mutateRun(bookId, (x) => void (x.items.find((i) => i.entryId === entry.id)!.status = "pending"));
        throw e;
      }
      mutateRun(bookId, (x) => void Object.assign(x.items.find((i) => i.entryId === entry.id)!, { status: "error", why: String((e as Error)?.message ?? e).slice(0, 300) }));
    }
  }
}
