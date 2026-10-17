import { z } from "zod";
import { all, newId, now, one, parseJson, run } from "../db/db";
import { memoryConfig } from "../lib/settings";
import type { AtomRow } from "../memory/atoms";
import { chatNames } from "../memory/build";
import { povMode } from "../memory/context";
import { embedQueries, embeddingsEnabled } from "../memory/embed";
import { norm, resolver } from "../memory/entities";
import { formatRecallBlock, TimeIndex } from "../memory/format";
import { buildQueries, recall } from "../memory/recall";
import { contentWords } from "../memory/text";
import { type ChatSettings, mustChat } from "../services/chats";
import { resolveProfile } from "../services/connections";
import { callJson } from "../services/llm";
import { factLine, factsNowFor } from "../lore/facts";
import { scanEntriesFor } from "../lore/service";
import { sameValue, slotDef } from "../lore/slots";

/**
 * The memory quiz (MEM-46): a personal benchmark. Questions come from the facts your story
 * established; each is asked of recall as it's set up now. Two scores:
 *   - retrieval: did recall bring back the memory the question was made from?
 *   - answers:   given only the memory block, could a model answer it?
 * Runs are kept with the settings they used, so you can tune with data instead of guesswork.
 */

export interface QuizQuestion {
  id: string;
  question: string;
  answer: string;
  atomId: string;
  sceneId: string | null;
  retrieved?: boolean;
  rank?: number | null;
  given?: string;
  correct?: boolean | null;
  /** docs/15, 8.3: a question from a lore entry's detail sheet (the slot), not from memory. */
  slot?: string;
  factId?: string;
}

const questionsSchema = z.object({ questions: z.array(z.object({ q: z.string(), a: z.string(), fact: z.coerce.number() })).default([]) });
const answerSchema = z.object({ answer: z.string().default("") });

/** Facts worth testing: important, older first (they're the ones memory has to carry). */
function pickFacts(chatId: string, n: number) {
  return all<AtomRow>(
    "SELECT * FROM memories WHERE chat_id = ? AND deleted_at IS NULL AND status = 'active' AND importance >= 5 AND type IN ('fact','event','promise','secret','preference','trait','relationship','plan') ORDER BY importance DESC, COALESCE(min_seq, 0) ASC LIMIT ?",
    chatId,
    n * 2,
  );
}

/** A fill-in-the-blank from a fact, when no model is around to write questions. */
export function cloze(fact: string, names: string[]): { q: string; a: string } | null {
  const text = fact.trim().replace(/\s+/g, " ");
  const num = text.match(/\b\d[\d,.:]*\b/);
  if (num) return { q: `Fill in the blank: ${text.replace(num[0], "___")}`, a: num[0] };
  const name = names.find((n) => n.length >= 3 && new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(text));
  if (name) return { q: `Fill in the blank: ${text.replace(new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`), "___")}`, a: name };
  const words = text.split(" ");
  if (words.length < 5) return null;
  const tail = words.slice(-3).join(" ").replace(/[.!?]$/, "");
  return { q: `Complete it: ${words.slice(0, -3).join(" ")} …`, a: tail };
}

export async function makeQuestions(chatId: string, n = 8): Promise<QuizQuestion[]> {
  const facts = pickFacts(chatId, n);
  if (!facts.length) return [];
  const names = resolver(chatId).rows.flatMap((e) => [e.name, ...parseJson<string[]>(e.aliases, [])]);
  let qs: QuizQuestion[] = [];
  try {
    const r = await callJson({
      task: "helper",
      kind: "quiz",
      chatId,
      name: "quiz_questions",
      schema: questionsSchema,
      system:
        'Write quiz questions that test whether someone remembers the facts of a story. One short question per fact, answerable from that fact alone, with a short exact answer (a name, a number, a place, an object, a few words). Reply with JSON only: {"questions": [{"q": "…", "a": "…", "fact": 1}]}',
      user: `FACTS:\n${facts.map((f, i) => `${i + 1}. ${f.content}`).join("\n")}\n\nWrite up to ${n} questions.`,
      maxTokens: 1200,
    });
    qs = r.data.questions
      .map((x) => {
        const f = facts[Math.round(x.fact) - 1];
        return f && x.q.trim() && x.a.trim() ? { id: newId().slice(0, 8), question: x.q.trim(), answer: x.a.trim(), atomId: f.id, sceneId: f.scene_id } : null;
      })
      .filter((x): x is QuizQuestion => Boolean(x));
  } catch {
    qs = [];
  }
  if (qs.length < Math.min(n, facts.length)) {
    for (const f of facts) {
      if (qs.length >= n) break;
      if (qs.some((q) => q.atomId === f.id)) continue;
      const c = cloze(f.content, names);
      if (c) qs.push({ id: newId().slice(0, 8), question: c.q, answer: c.a, atomId: f.id, sceneId: f.scene_id });
    }
  }
  return qs.slice(0, n);
}

/** Is the given answer the expected one (names, numbers and most content words present)? */
export function grade(expected: string, given: string) {
  const e = norm(expected);
  const g = norm(given);
  if (!g) return false;
  if (g.includes(e)) return true;
  const want = [...contentWords(expected, 2)];
  if (!want.length) return false;
  const have = contentWords(given, 2);
  const hits = want.filter((w) => have.has(w) || g.includes(w)).length;
  return hits / want.length >= 0.6;
}

// ---------- docs/15, 8.3: the continuity quiz (the detail sheet) ----------

const SLOT_Q: Record<string, (n: string) => string> = {
  eyes: (n) => `What colour are ${n}'s eyes?`,
  hair: (n) => `What is ${n}'s hair like?`,
  age: (n) => `How old is ${n}?`,
  height: (n) => `How tall is ${n}?`,
  birthday: (n) => `When is ${n}'s birthday?`,
  handedness: (n) => `Is ${n} left- or right-handed?`,
  scar: (n) => `Where is ${n}'s scar or mark?`,
};

/** Questions with exact answers from the facts on this chat's lore entries ("What colour are Wren's eyes?" → grey). */
export function slotQuestions(chatId: string, n = 6): (QuizQuestion & { notes: string })[] {
  const chat = mustChat(chatId);
  const entries = scanEntriesFor({ characterId: chat.character_id, personaId: chat.persona_id, chatId }).filter((e) => e.enabled);
  const facts = factsNowFor(entries.map((e) => e.id), chatId);
  const out: (QuizQuestion & { notes: string })[] = [];
  for (const e of entries) {
    const name = e.comment || e.keys[0] || "";
    const fs = (facts.get(e.id) ?? []).filter((f) => f.status === "active");
    for (const f of fs) {
      // Only the detail sheet's single, settled slots: one exact answer each (no states, lists or bond lines).
      const def = slotDef(f.slot);
      if (!f.slot || !name || !def || def.list || !["attribute", "habit", "voice"].includes(def.kind) || f.kind === "state" || f.kind === "bond") continue;
      const q = SLOT_Q[f.slot]?.(name) ?? `What is ${name}'s ${slotDef(f.slot)!.label.toLowerCase().replace("{{user}}", "you")}?`;
      // The notes are what the prompt would carry for them: the entry and its facts.
      const notes = [`- ${name}: ${e.content.replace(/\s+/g, " ").slice(0, 600)}`, ...fs.map((x) => `- ${name}: ${factLine(x)}`)].join("\n");
      out.push({ id: newId().slice(0, 8), question: q, answer: f.value, atomId: "", sceneId: null, slot: f.slot, factId: f.id, notes });
      if (out.length >= n) return out;
    }
  }
  return out;
}

/** A slot's answer is right when it says the same thing ("gray" for grey, 5'7" for 170 cm). */
export const gradeSlot = (slot: string, expected: string, given: string) => sameValue(slot, expected, given) || grade(expected, given);

export async function runQuiz(chatId: string, opts: { n?: number; answers?: boolean } = {}) {
  const chat = mustChat(chatId);
  const cfg = memoryConfig();
  const names = chatNames(chatId);
  const questions = await makeQuestions(chatId, opts.n ?? 8);
  const lastSeq = one<{ s: number }>("SELECT MAX(seq) AS s FROM messages WHERE chat_id = ? AND deleted_at IS NULL", chatId)?.s ?? 0;
  let target = 8000;
  try {
    target = resolveProfile(parseJson<ChatSettings>(chat.settings, {}).profileId).contextTarget;
  } catch {
    // no model yet: a typical size
  }
  const budget = Math.max(200, Math.round(cfg.budget.recall * target));
  const res = resolver(chatId);
  const me = res.find(names.char);
  const pov = povMode(cfg, chat.mode) === "character" ? { names: new Set([names.char, ...(me ? res.namesOf(me) : [])].map(norm)), label: names.char } : null;
  const times = new TimeIndex(chatId);
  const qvecs = embeddingsEnabled() ? await embedQueries(questions.map((q) => q.question), 8000) : questions.map(() => null);
  for (const [i, q] of questions.entries()) {
    // As if the whole story had left the window: everything comes from memory.
    const r = recall({
      chatId,
      evicted: lastSeq,
      budget,
      queries: buildQueries([{ role: "user", content: q.question }]),
      qvecs: [qvecs[i] ?? null],
      excludeSummaryIds: new Set(),
      seed: `quiz:${q.id}`,
      cfg: { ...cfg, librarian: false },
      pov,
      present: [],
      mood: null,
      librarian: null,
      times,
      skipCards: new Set(),
      povName: names.char,
    });
    const ranked = r.items.filter((x) => x.slot !== "pinned");
    const idx = ranked.findIndex((x) => (x.ownerType === "memory" && x.id === q.atomId) || (x.ownerType === "summary" && q.sceneId != null && x.id === q.sceneId));
    q.retrieved = idx >= 0 || r.items.some((x) => x.slot === "pinned" && x.id === q.atomId);
    q.rank = idx >= 0 ? idx + 1 : null;
    if (opts.answers !== false) {
      try {
        const block = formatRecallBlock(r.items, cfg.format, pov ? names.char : null) || "(nothing recalled)";
        const a = await callJson({
          task: "helper",
          kind: "quiz:answer",
          chatId,
          name: "quiz_answer",
          schema: answerSchema,
          system: 'Answer the question using only the notes. Give the short answer only (a name, number, place or a few words). If the notes don\'t say, answer "unknown". Reply with JSON only: {"answer": "…"}',
          user: `NOTES:\n${block}\n\nQUESTION: ${q.question}`,
          maxTokens: 80,
        });
        q.given = a.data.answer.trim();
        q.correct = grade(q.answer, q.given);
      } catch {
        q.correct = null;
      }
    }
  }
  // 8.3: the detail sheet, asked of the model as the prompt would give it the lore.
  const sheet = opts.answers === false ? [] : slotQuestions(chatId, opts.n ?? 6);
  for (const q of sheet) {
    try {
      const a = await callJson({
        task: "helper",
        kind: "quiz:answer",
        chatId,
        name: "quiz_answer",
        schema: answerSchema,
        system: 'Answer the question using only the notes. Give the short answer only (a name, number, colour, place or a few words). If the notes don\'t say, answer "unknown". Reply with JSON only: {"answer": "…"}',
        user: `NOTES:\n${q.notes}\n\nQUESTION: ${q.question}`,
        maxTokens: 80,
      });
      q.given = a.data.answer.trim();
      q.correct = gradeSlot(q.slot!, q.answer, q.given);
    } catch {
      q.correct = null;
    }
  }
  const sheetGraded = sheet.filter((q) => q.correct != null);
  const slots = sheetGraded.length ? sheetGraded.filter((q) => q.correct).length / sheetGraded.length : null;
  const n = questions.length || 1;
  const retrieval = questions.filter((q) => q.retrieved).length / n;
  const graded = questions.filter((q) => q.correct != null);
  const answers = graded.length ? graded.filter((q) => q.correct).length / graded.length : null;
  const score = answers == null ? retrieval : (retrieval + answers) / 2;
  const settings = { profile: cfg.profile, format: cfg.format, diversity: cfg.diversity, budget: cfg.budget, slots: cfg.slots, entityRecall: cfg.entityRecall, reinforcement: cfg.reinforcement, embeddings: embeddingsEnabled(), recallTokens: budget, pov: pov ? names.char : "narrator" };
  const id = newId();
  let model: string | null = null;
  try {
    model = resolveProfile(parseJson<ChatSettings>(chat.settings, {}).profileId).modelId;
  } catch {
    model = null;
  }
  run(
    "INSERT INTO quiz_runs (id, chat_id, settings, questions, retrieval, answers, score, slots, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    id,
    chatId,
    JSON.stringify({ ...settings, model }),
    JSON.stringify([...questions, ...sheet.map(({ notes: _n, ...q }) => q)]),
    retrieval,
    answers,
    score,
    slots,
    now(),
  );
  return quizOut(one<QuizRow>("SELECT * FROM quiz_runs WHERE id = ?", id)!);
}

interface QuizRow {
  id: string;
  chat_id: string;
  settings: string;
  questions: string;
  retrieval: number | null;
  answers: number | null;
  score: number | null;
  slots: number | null;
  created_at: number;
}

export function quizOut(r: QuizRow) {
  return { id: r.id, settings: parseJson<Record<string, unknown>>(r.settings, {}), questions: parseJson<QuizQuestion[]>(r.questions, []), retrieval: r.retrieval, answers: r.answers, score: r.score, slots: r.slots ?? null, createdAt: r.created_at };
}

export function quizRuns(chatId: string) {
  return all<QuizRow>("SELECT * FROM quiz_runs WHERE chat_id = ? ORDER BY created_at DESC LIMIT 30", chatId).map(quizOut);
}
