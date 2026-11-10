import { z } from "zod";
import { all, one, parseJson, run } from "../db/db";
import { getChatRow } from "../services/chats";
import { enqueue, type JobContext } from "../services/jobs";
import { callJson } from "../services/llm";
import { shouldShed } from "../services/quota";
import { branchEvents } from "../trackers/store";
import { type AtomRow, dropAtoms, insertAtom, supersede } from "./atoms";
import { touchMemory } from "./store";

/**
 * docs/33 Part 2: memories retire when the story overturns them. A memory is only superseded when
 * something newer says otherwise: another memory saying the same thing differently (reconcile),
 * and now these two:
 *
 * - "Dawn does not know Buffy is alive" ends the moment the trackers record Dawn knowing it. The
 *   memory that replaces it follows that message (origin "tracker"), so a swipe that takes the
 *   knowing away brings the old memory back.
 * - A story truth you add retires the memories that contradict it, after a helper reads them.
 *
 * Memories you edited or pinned are never touched.
 */

const STOP = new Set(
  "a an the is are was were be been being has have had do does did not no yet still that this these those it its of to in on at for by with from and or but if as so than then there their they them he she his her him i you we our your me my mine who what when where which why how whether about into over just only also even ever very really now".split(" "),
);

/** The content words of a phrase: lowercase, no stop words, a plural's "s" dropped. */
export function contentWords(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s'-]/gu, " ")
      .split(/\s+/)
      .map((w) => w.replace(/['’]s$/, "").replace(/(?<=\w{3})s$/, ""))
      .filter((w) => w.length >= 2 && !STOP.has(w)),
  );
}

export interface Unaware {
  /** Who doesn't know ("Dawn"), or, for "hasn't told X", who wasn't told. */
  who: string;
  /** What they don't know ("Buffy is alive"). */
  what: string;
  /** For "Buffy hasn't told X": Buffy, who knew all along, so her knowing it proves nothing. */
  teller?: string;
}

const NAME = String.raw`([A-Z][\p{L}'’-]+(?:\s+[A-Z][\p{L}'’-]+)?)`;
const UNAWARE_RE = new RegExp(`${NAME}(?:\\s+is\\s+[^.;—]{0,40}?\\s+and)?\\s+(?:does\\s+not|doesn['’]t|did\\s+not|didn['’]t|still\\s+doesn['’]t|has\\s+no\\s+idea)\\s+know(?:s)?\\s+(?:that\\s+)?([^.;—()]{3,120})`, "u");
const UNTOLD_RE = new RegExp(`${NAME}\\s+(?:has\\s+not|hasn['’]t|have\\s+not|haven['’]t)\\s+(?:yet\\s+)?told\\s+${NAME.replace("([A-Z]", "((?:her|his|their)\\s+[a-z]+|[A-Z]")}\\s+(?:that\\s+)?([^.;—()]{3,120})`, "u");

/** "Dawn is fifteen and does not know Buffy is alive" → Dawn / Buffy is alive. Null for anything else. */
export function unawareOf(content: string): Unaware | null {
  const m = content.match(UNAWARE_RE);
  if (m && !/^(?:if|whether|what|how|why|where|who)\b/i.test(m[2]!.trim())) return { who: m[1]!, what: m[2]!.trim() };
  const t = content.match(UNTOLD_RE);
  // "Buffy has not told her family she is alive": the "she" is the teller.
  if (t && !/^(?:if|whether)\b/i.test(t[3]!.trim())) return { who: t[2]!, what: t[3]!.trim().replace(/^(?:she|he|they)\b/i, t[1]!), teller: t[1]! };
  return null;
}

/** Whether a fact someone came to know covers what the memory says they didn't. */
export function covers(what: string, fact: string): boolean {
  const a = contentWords(what);
  const b = contentWords(fact);
  if (a.size < 2) return false;
  let hit = 0;
  for (const w of a) if (b.has(w)) hit++;
  return hit >= 2 && hit / a.size >= 0.6;
}

const sameWho = (a: string, b: string) => {
  const x = a.toLowerCase().split(/\s+/);
  const y = b.toLowerCase().split(/\s+/);
  return x[0] === y[0];
};
/** "her family", "his friends": anyone at all who came to know it counts. */
const anyone = (who: string) => /^(?:her|his|their)\s/i.test(who);

interface Knew {
  who: string;
  fact: string;
  seq: number;
  messageId: string;
}

function knowings(chatId: string, afterSeq: number): Knew[] {
  const out: Knew[] = [];
  for (const e of branchEvents(chatId, { afterSeq })) {
    const a = e.op.args as { fact?: string; status?: string; truth?: string };
    if (e.op.op !== "know" || !e.messageId || !e.op.subject || !a.fact) continue;
    if (a.status && a.status !== "knows" && a.status !== "sees") continue;
    if (a.truth && a.truth !== "true") continue;
    // A fact that is itself someone not knowing ("Dawn doesn't know Buffy is alive") is no one knowing it.
    if (unawareOf(a.fact) || /\b(?:doesn['’]t|does not|didn['’]t|did not|never|hasn['’]t|has not)\b/i.test(a.fact)) continue;
    out.push({ who: e.op.subject.replace(/^@/, ""), fact: a.fact, seq: e.seq, messageId: e.messageId });
  }
  return out;
}

/**
 * After each tracker update: every active "doesn't know" memory whose person the trackers have
 * since recorded knowing it is superseded by a memory saying so. Returns how many retired.
 */
export function retireUnaware(chatId: string): number {
  restoreUnaware(chatId);
  const rows = all<AtomRow>(
    `SELECT * FROM memories WHERE chat_id = ? AND deleted_at IS NULL AND status = 'active' AND user_edited = 0 AND pinned = 0
       AND (content LIKE '%know%' OR content LIKE '%told%')`,
    chatId,
  );
  const candidates = rows.map((r) => ({ r, u: unawareOf(r.content) })).filter((x): x is { r: AtomRow; u: Unaware } => Boolean(x.u));
  if (!candidates.length) return 0;
  const from = Math.min(...candidates.map((c) => c.r.max_seq ?? 0));
  const known = knowings(chatId, from);
  if (!known.length) return 0;
  let n = 0;
  // One "knows now" memory per knowing, however many memories it retires.
  const made = new Map<Knew, string>();
  for (const { r, u } of candidates) {
    const k = known.find((x) => x.seq > (r.max_seq ?? 0) && (anyone(u.who) ? !(u.teller && sameWho(u.teller, x.who)) : sameWho(u.who, x.who)) && covers(u.what, x.fact));
    if (!k) continue;
    const content = `${k.who} ${KNOWS_NOW} ${k.fact} (#${k.seq})`;
    const id =
      made.get(k) ??
      one<{ id: string }>("SELECT id FROM memories WHERE chat_id = ? AND content = ? AND status = 'active' AND deleted_at IS NULL", chatId, content)?.id ??
      insertAtom(chatId, null, { type: "fact", content, entities: parseJson<string[]>(r.entities, []), importance: r.importance, confidence: 0.85 }, [{ id: k.messageId, seq: k.seq }]);
    made.set(k, id);
    supersede(r.id, id);
    n++;
  }
  if (n) touchMemory(chatId);
  return n;
}

const KNOWS_NOW = "knows now:";

/**
 * The other way: a "knows now" memory whose knowing is no longer on the story's branch (you swiped
 * it away, or deleted the message) goes, and the memory it retired is active again.
 */
export function restoreUnaware(chatId: string): number {
  const mine = all<{ id: string; content: string; message_id: string | null }>(
    `SELECT a.id, a.content, s.message_id FROM memories a LEFT JOIN memory_sources s ON s.memory_id = a.id
     WHERE a.chat_id = ? AND a.deleted_at IS NULL AND a.user_edited = 0 AND a.content LIKE ?
       AND EXISTS (SELECT 1 FROM memories o WHERE o.superseded_by = a.id)`,
    chatId,
    `% ${KNOWS_NOW} %`,
  );
  if (!mine.length) return 0;
  const live = new Set<string>();
  for (const e of branchEvents(chatId)) {
    const a = e.op.args as { fact?: string; status?: string };
    if (e.op.op === "know" && e.messageId && a.fact && (!a.status || a.status === "knows" || a.status === "sees")) live.add(`${e.messageId}|${a.fact.trim()}`);
  }
  const gone = mine.filter((m) => {
    const fact = m.content.slice(m.content.indexOf(KNOWS_NOW) + KNOWS_NOW.length).replace(/\s*\(#\d+\)$/, "").trim();
    return !m.message_id || !live.has(`${m.message_id}|${fact}`);
  });
  if (!gone.length) return 0;
  dropAtoms(`id IN (${gone.map(() => "?").join(",")})`, ...gone.map((g) => g.id));
  touchMemory(chatId);
  return gone.length;
}

// ---------- Story truths (2.3) ----------

/** When the chat's truths change: the new ones are checked against what memory holds. */
export function truthsChanged(chatId: string, before: string[], after: string[]) {
  const added = after.filter((t) => t.trim() && !before.includes(t));
  if (added.length) enqueue("memory.truths", { chatId, truths: added }, { dedupeKey: `memory.truths:${chatId}:${added.join("|").slice(0, 200)}`, delayMs: 2000, priority: 1, chatId, maxAttempts: 2 });
}

const verdictSchema = z.object({ contradicted: z.array(z.object({ id: z.string(), why: z.string().default("") })).default([]) });

/** The memories most likely to be about a truth: the most content words in common. */
export function truthCandidates(chatId: string, truth: string, limit = 25): AtomRow[] {
  const words = contentWords(truth);
  if (!words.size) return [];
  const rows = all<AtomRow>("SELECT * FROM memories WHERE chat_id = ? AND deleted_at IS NULL AND status = 'active' AND user_edited = 0 AND pinned = 0", chatId);
  return rows
    .map((r) => {
      const w = contentWords(r.content);
      let hit = 0;
      for (const x of words) if (w.has(x)) hit++;
      return { r, hit };
    })
    .filter((x) => x.hit >= Math.min(2, words.size))
    .sort((a, b) => b.hit - a.hit)
    .slice(0, limit)
    .map((x) => x.r);
}

export async function runTruthsJob(p: { chatId: string; truths: string[] }, job?: JobContext) {
  if (!getChatRow(p.chatId) || shouldShed("continuity", p.chatId)) return;
  let n = 0;
  for (const truth of p.truths) {
    const cands = truthCandidates(p.chatId, truth);
    if (!cands.length) continue;
    const r = await callJson({
      task: "helper",
      kind: "truths",
      chatId: p.chatId,
      jobId: job?.id,
      name: "truth_check",
      schema: verdictSchema,
      system:
        "The author of a story set a truth about it. Below are memories Mea keeps of the story. List the ones that contradict the truth: a memory that says something the truth rules out. A memory about something else, or one that only leaves part of the truth unsaid, is not a contradiction. Reply with JSON: {\"contradicted\":[{\"id\":\"…\",\"why\":\"a few words\"}]}.",
      user: `TRUTH: ${truth}\n\nMEMORIES:\n${cands.map((c) => `[${c.id}] ${c.content}`).join("\n")}`,
      maxTokens: 600,
    });
    job?.note({ inputTokens: r.inputTokens });
    const ids = new Set(cands.map((c) => c.id));
    const hits = r.data.contradicted.filter((c) => ids.has(c.id));
    if (!hits.length) continue;
    // The truth itself becomes a memory (yours), and what it rules out is superseded by it.
    const max = Math.max(...cands.map((c) => c.max_seq ?? 0));
    const tid = insertAtom(p.chatId, null, { type: "fact", content: truth, importance: 9, confidence: 1, origin: "user", userEdited: true, pinned: true }, []);
    if (max) run("UPDATE memories SET max_seq = ?, min_seq = ? WHERE id = ?", max, max, tid);
    for (const h of hits) supersede(h.id, tid);
    n += hits.length;
  }
  if (n) touchMemory(p.chatId);
}
