import { z } from "zod";
import { tidy } from "../creator/expand";
import { type Criterion, failedNotes, type GateVerdict, runGate, writeTemp } from "../creator/gate";
import { askQuestion, type Direction, directions as offerDirections, type FactSource, SOURCE_MARK } from "../creator/interview";
import { worldContext } from "../creator/world";
import { badRequest, notFound } from "../lib/http";
import { callJson } from "../services/llm";
import { guessCategory, withCategory } from "./format";
import { createEntry, getLorebook } from "./service";
import { defaultEntry } from "./types";

/**
 * "Add lore" on any saved book (Lumiverse's hub loop, adapted): one pointed question at a time,
 * grounded in what the book already holds; each answer, in your own words, becomes one new triggered
 * entry. Growth only ever adds: entries already in the book, yours or not, are never touched. The
 * questions answered so far live on the entries they made, so the loop picks up where it left off.
 */

function mustBook(bookId: string) {
  const b = getLorebook(bookId);
  if (!b || b.deletedAt) throw notFound("Lorebook not found");
  return b;
}

/** What's been asked here before: the entries this loop made remember their question and answer. */
function grown(bookId: string) {
  return mustBook(bookId)
    .entries.map((e) => e.extra.grownFrom as { q?: string; a?: string } | undefined)
    .filter((g): g is { q: string; a: string } => Boolean(g?.q))
    .map((g) => ({ q: g.q, a: g.a ?? "" }));
}

const material = (bookId: string) => {
  const b = mustBook(bookId);
  return [`THE BOOK: ${b.name}${b.description ? ` (${b.description})` : ""}`, worldContext({ bookIds: [bookId] }, 2500)].filter(Boolean).join("\n\n");
};

/** The next question about this book's world. */
export async function growQuestion(bookId: string, opts: { steer?: string; avoid?: string[] } = {}) {
  const asked = await askQuestion({
    kind: "lore:grow",
    subject: "the world this lorebook describes",
    material: material(bookId),
    asked: grown(bookId),
    targets: [],
    deepening: "the specifics of places, factions, customs, history, people and the tensions between them: what a storyteller would want to know that the book doesn't yet say",
    taste: [],
    steer: opts.steer,
    avoid: opts.avoid,
  });
  if (!asked) throw new Error("No question came back. Try again.");
  return { q: asked.q, why: asked.why };
}

export async function growDirections(bookId: string, input: { question: string; why?: string; steer?: string; avoid?: string[] }): Promise<Direction[]> {
  return offerDirections({ kind: "lore:grow", question: input.question, why: input.why, material: material(bookId), taste: [], steer: input.steer, avoid: input.avoid });
}

const ENTRY_CRITERIA: Criterion[] = [
  { key: "self_contained", label: "Self-contained", description: "Reads as finished lore on its own: no interview residue, no questions, no second person." },
  { key: "author_preserved", label: "Your words kept", description: "The author's answer survives in substance and wording; nothing beyond it is asserted." },
  { key: "premise_clean", label: "Premise clean", description: "Nothing from the question that the answer didn't confirm survives; a rejected premise is replaced by the author's truth." },
  { key: "consistent", label: "Fits the book", description: "It contradicts nothing already in the book." },
];

const entrySchema = z.object({ title: z.string().default(""), content: z.string().default(""), keys: z.array(z.string()).default([]), essentials: z.string().default("") });

/** Your answer composed into one new triggered entry, checked (and revised once if it fails), then added to the book. */
export async function growAnswer(bookId: string, input: { question: string; answer: string; source?: FactSource }) {
  const book = mustBook(bookId);
  const answer = input.answer.trim();
  if (!answer) throw badRequest("Write an answer first");
  const source = input.source ?? "typed";
  const ctx = material(bookId);
  const write = async (fix = "") =>
    (
      await callJson({
        task: "summarizer",
        kind: "lore:grow-entry",
        name: "lore_grow_entry",
        schema: entrySchema,
        system: [
          "Compose the author's answer into ONE lorebook entry a storyteller consults when its subject comes up. Third person, plain and specific, 2–6 sentences. Never mention the question, the author or an interview.",
          "The question is scaffolding: keep only what the answer confirms; where it corrects the question, state the author's truth. Keep their specifics verbatim and add nothing they didn't establish.",
          '"title": what it covers, short. "keys": 2–5 names or words that would come up in a scene where it matters. "essentials": its single most important fact in one line.',
          fix ? `A first try failed these checks; fix exactly them: ${fix}` : "",
          'Reply with JSON only: {"title": "…", "content": "…", "keys": ["…"], "essentials": "…"}',
        ]
          .filter(Boolean)
          .join("\n\n"),
        user: [ctx, `QUESTION: ${input.question}`, `ANSWER (${SOURCE_MARK[source]}): ${answer}`].join("\n\n"),
        maxTokens: 900,
        temperature: writeTemp(0.5),
      })
    ).data;
  const judge = (c: z.infer<typeof entrySchema>) => runGate({ kind: "lore:grow-gate", name: "lore_grow_gate", what: "one lorebook entry composed from an author's answer", criteria: ENTRY_CRITERIA, user: [ctx, `QUESTION: ${input.question}`, `ANSWER: ${answer}`, `THE TEXT TO JUDGE:\n${c.title}\n${c.content}`].join("\n\n") });
  let c = await write();
  let gate: GateVerdict = await judge(c);
  if (!gate.passed) {
    c = await write(failedNotes(gate));
    gate = await judge(c);
  }
  const content = tidy(c.content) || answer;
  const title = c.title.trim() || input.question.slice(0, 60);
  const keys = c.keys.map((k) => k.trim()).filter(Boolean).slice(0, 6);
  const base = defaultEntry({ comment: title, keys: keys.length ? keys : [title], content, extra: { essentials: c.essentials.trim(), grownFrom: { q: input.question, a: answer } } });
  const g = guessCategory(base, book.name, book.settings.role);
  const entry = createEntry(bookId, withCategory(base, g.category, { defaults: true, confidence: g.confidence }));
  return { entry, gate };
}
