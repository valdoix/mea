import { z } from "zod";
import { all, one, parseJson } from "../db/db";
import { lane, registerLane } from "../prompt/lanes";
import type { Issue } from "./checker";
import { chatNames } from "../memory/build";
import { excerpt } from "../memory/deep";
import { cleanText, contentWords, ftsQuery } from "../memory/text";
import type { JobContext } from "../services/jobs";
import { callJson } from "../services/llm";
import { TimeIndex } from "../memory/format";
import type { WorldState } from "../trackers/types";
import { sentences } from "./rules";
import type { Found } from "./slips";

/**
 * Retellings checked (docs/20 Part 3). At #509 Buffy told Dawn the jealousy story: "This morning.
 * Kitchen. He's fixing the faucet… and then he says — and I quote — 'Should I be jealous of
 * Spike?'" Gabriel had asked, in the car before the faucet, "Have you ever had romantic feelings
 * towards Spike?" (#466). The checker had a kind for an invented past, but nothing found the
 * passage the story came from, so it compared the reply with summaries that didn't hold it.
 *
 * Rules first: spoken lines that point back ("this morning", "you asked me", "and I quote") are
 * retellings; the record (today's beats and a search of the ledger) gives each its likely source,
 * with the source's story time and place from the fold. A time word that can't fit the best source
 * is flagged by the rules; one helper call compares the rest (place, who, order, the quoted words).
 */

/** Words that point at an earlier moment of the story ("back in the chair" and "before the clock" are too common to count). */
export const BACK =
  /\b(this (?:morning|afternoon|evening)|earlier(?: today| tonight)?|last night|yesterday|the other (?:day|night)|an? (?:hour|few hours|minute|few minutes) ago|when (?:you|he|she|they|we) (?:asked|said|told|called|did|were|got)|(?:you|he|she|they) (?:asked|told) (?:me|us|her|him)|remember when|and I quote|word for word|(?:his|her|your|their) exact words)\b/i;

export interface Retelling {
  /** The sentence that points back, and the ones after it: the story as told. */
  text: string;
  /** The time words it uses ("this morning"), if any. */
  when: string | null;
}

/**
 * Retellings in a reply: at most two, each the sentence that points back and the eight after it,
 * narration and all. Not by quote marks: a model that opens and closes a line with the same “
 * splits the story into pieces, and one told in narration counts too.
 */
export function findRetellings(reply: string): Retelling[] {
  const sents = sentences(cleanText(reply));
  const out: Retelling[] = [];
  for (let i = 0; i < sents.length && out.length < 2; i++) {
    if (!BACK.test(sents[i]!)) continue;
    const text = sents.slice(i, i + 9).join(" ").replace(/[“”"]/g, "").replace(/\s+/g, " ").trim();
    if (text.split(/\s+/).length < 8) continue;
    const when = text.match(/\b(this morning|this afternoon|this evening|last night|yesterday)\b/i)?.[1]?.toLowerCase() ?? null;
    out.push({ text: text.slice(0, 900), when });
    i += 8;
  }
  return out;
}

export interface Source {
  seq: number;
  messageId: string;
  /** Who wrote it: the player ("user") or the character. */
  role?: string;
  /** The moment of a promise the retelling keeps (where the event it tells happened). */
  promised?: boolean;
  /** The beat for it, when there is one ("Gabriel asks Buffy whether…"). */
  beat?: string;
  /** The message's own words, around what the retelling shares with it. */
  passage: string;
  minutes: number | null;
  place: string | null;
  score: number;
}

const DAY = 1440;
const pad = (n: number) => String(n).padStart(2, "0");
export const hhmm = (m: number) => `${pad(Math.floor((((m % DAY) + DAY) % DAY) / 60))}:${pad(m % 60)}`;

/** Words cut to a stem, so "jealous", "jealousy" and "jealous-adjacent" meet. */
const stems = (text: string) => new Set([...contentWords(text)].flatMap((w) => w.split(/[-']/)).filter((w) => w.length >= 4).map((w) => w.slice(0, 6)));

type Row = { id: string; seq: number; role: string; content: string };
/** What any promise to tell something says: never what it's about. */
const PROMISE_WORDS = new Set(["tell", "telli", "about", "promis", "tonigh", "today", "after", "befor", "later", "story", "stories", "whole"]);
const ROW = "SELECT m.id, m.seq, m.role, s.content FROM messages m JOIN swipes s ON s.message_id = m.id AND s.idx = m.active_swipe";

/**
 * The earlier messages a retelling most likely tells, scored by the rare stems they share with it
 * (names count half: everyone's in everything). Candidates: a full-text search of the ledger,
 * today's beats, and the promise it keeps. A wrong retelling shares few words with what happened
 * ("jealous" for "romantic feelings"), but "tell Dawn about the jealousy question" was promised in
 * the reply that tells it right.
 */
export function retellSources(chatId: string, st: WorldState | null, seq: number, r: Retelling, max = 4): Source[] {
  const names = new Set(Object.values(st?.chars ?? {}).flatMap((c) => [...stems([c.name, ...(c.aliases ?? [])].join(" "))]));
  const want = [...stems(r.text)];
  if (!want.some((w) => !names.has(w))) return [];
  const beats = new Map((st?.beats ?? []).filter((b) => b.seq < seq).map((b) => [b.seq, b.text]));
  const rows = new Map<number, Row>();
  // The promise's own moment always goes to the helper, however its words score.
  const kept = new Set<number>();
  const add = (xs: Row[]) => xs.forEach((x) => rows.set(x.seq, x));
  const q = ftsQuery(r.text, 16);
  if (q)
    try {
      add(all<Row>(`SELECT m.id, m.seq, m.role, s.content FROM swipes_fts f JOIN swipes s ON s.rowid = f.rowid JOIN messages m ON m.id = s.message_id AND s.idx = m.active_swipe
         WHERE swipes_fts MATCH ? AND m.chat_id = ? AND m.seq < ? AND m.deleted_at IS NULL ORDER BY bm25(swipes_fts) LIMIT 8`, q, chatId, seq));
    } catch {
      // a query FTS can't parse finds nothing
    }
  const seqs = [...beats.keys()];
  // The promise this retelling keeps: the reply it was made in, and the message that led to it. Only
  // the one that shares the most with it: a word no other promise has ("jealousy") counts two, one
  // many share ("dinner") one, and it takes two.
  const earlier = Object.values(st?.obligations ?? {}).filter((o) => o.seq < seq);
  const own = new Map(earlier.map((o) => [o, [...stems(o.what)].filter((w) => !names.has(w) && !PROMISE_WORDS.has(w))]));
  const spread = new Map<string, number>();
  for (const ws of own.values()) for (const w of ws) spread.set(w, (spread.get(w) ?? 0) + 1);
  const promises = earlier
    .map((o) => ({ o, n: own.get(o)!.filter((w) => want.includes(w)).reduce((n, w) => n + (spread.get(w) === 1 ? 2 : 1), 0) }))
    .filter((x) => x.n >= 2);
  const most = Math.max(0, ...promises.map((x) => x.n));
  for (const { o } of promises.filter((x) => x.n === most).sort((x, y) => x.o.seq - y.o.seq).slice(0, 1)) {
    seqs.push(o.seq, o.seq - 1);
    kept.add(o.seq).add(o.seq - 1);
  }
  if (seqs.length) add(all<Row>(`${ROW} WHERE m.chat_id = ? AND m.deleted_at IS NULL AND m.seq IN (${seqs.map(() => "?").join(",")})`, chatId, ...seqs));
  // A stem in few of the candidates says more than one in all of them.
  const docs = [...rows.values()].map((x) => ({ x, words: stems(`${beats.get(x.seq) ?? ""} ${cleanText(x.content)}`) }));
  const df = new Map<string, number>();
  for (const d of docs) for (const w of want) if (d.words.has(w)) df.set(w, (df.get(w) ?? 0) + 1);
  const ti = new TimeIndex(chatId);
  const scored = docs
    .map((d) => {
      const shared = want.filter((w) => d.words.has(w));
      const score = shared.reduce((n, w) => n + Math.log(1 + docs.length / (df.get(w) ?? 1)) * (names.has(w) ? 0.5 : 1), 0);
      return {
        seq: d.x.seq,
        messageId: d.x.id,
        role: d.x.role,
        promised: kept.has(d.x.seq),
        beat: beats.get(d.x.seq),
        passage: excerpt(d.x.content, contentWords(r.text), 520),
        minutes: ti.at(d.x.seq),
        place: ti.where(null, d.x.seq),
        score,
      } satisfies Source;
    })
    .filter((x) => x.score > 0 || kept.has(x.seq))
    .sort((x, y) => y.score - x.score);
  const top = scored.filter((x) => !kept.has(x.seq)).slice(0, max - 1);
  // The first time it was promised is where it happened; a later promise only repeats it.
  const promised = scored.filter((x) => kept.has(x.seq)).sort((x, y) => x.seq - y.seq).slice(0, 2);
  return [...top, ...promised].sort((x, y) => y.score - x.score);
}

/**
 * Why a time word can't be when the source happened, or null when it can: "this morning" for 13:10
 * the same day, "last night" for this afternoon. Only the words the clock can settle.
 */
export function whenConflict(word: string | null, src: number | null, now: number | null): string | null {
  if (!word || src == null || now == null || src > now) return null;
  const days = Math.floor(now / DAY) - Math.floor(src / DAY);
  const h = Math.floor((((src % DAY) + DAY) % DAY) / 60);
  const part = h < 5 ? "night" : h < 12 ? "morning" : h < 17 ? "afternoon" : h < 21 ? "evening" : "night";
  const at = `${days === 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`} at ${hhmm(src)}`;
  switch (word) {
    case "this morning":
      return days === 0 && part === "morning" ? null : `it happened ${at}${days === 0 ? `, in the ${part}` : ""}, not this morning`;
    case "this afternoon":
      return days === 0 && part === "afternoon" ? null : `it happened ${at}, not this afternoon`;
    case "this evening":
      return days === 0 && (part === "evening" || part === "night") ? null : `it happened ${at}, not this evening`;
    case "last night":
      return (days === 1 && (part === "evening" || part === "night")) || (days === 0 && h < 5) ? null : `it happened ${at}, not last night`;
    case "yesterday":
      return days === 1 ? null : `it happened ${at}, not yesterday`;
    default:
      return null;
  }
}

/** The best source is clear when it outscores the next by half again. */
export const clear = (s: Source[]) => s.length > 0 && (s.length === 1 || s[0]!.score >= s[1]!.score * 1.5);

const where = (s: Source) => [s.minutes != null ? hhmm(s.minutes) : null, s.place ? s.place.split(" › ").slice(-2).join(" › ") : null].filter(Boolean).join(", ");
const cite = (s: Source) => ({ ref: `S${s.seq}`, type: "message" as const, label: `#${s.seq}${where(s) ? ` (${where(s)})` : ""}${s.beat ? `: ${s.beat}` : ""}`, messageId: s.messageId, seq: s.seq });

const compareSchema = z.object({
  verdicts: z
    .array(
      z.object({
        retelling: z.coerce.number(),
        source: z.coerce.number().nullable().catch(null),
        wrong: z.boolean().catch(false),
        conflict: z.string().default(""),
        fix: z.string().default(""),
      }),
    )
    .default([]),
});

const COMPARE_SYSTEM = `In a roleplay reply, a character retells something that happened earlier in the story. For each retelling you get the passages it most likely tells, from the story itself, with their message numbers and the story time and place each happened at. Pick the passage it tells (or none if none of them is it). Then say whether the retelling gets it wrong: told at another time or place, in another order, with other people, or with words put in someone's mouth that they didn't say (a paraphrase of what was said is fine; a different question or line is not). A detail the passages don't cover is not wrong. A character deliberately lying, joking or exaggerating in the story isn't wrong only when the reply itself shows it's a lie or a joke. In "conflict", say what really happened, where and when, quoting the passage's own words for a line; in "fix", one line for the retelling. Reply with JSON only: {"verdicts":[{"retelling":1,"source":467,"wrong":true,"conflict":"…","fix":"…"}]}`;

/**
 * The reply's retellings against their sources: a time word the best source can't fit is flagged
 * by the rules; the rest go to one helper call. Each flag cites the source message with its time
 * and place.
 */
export async function retellIssues(chatId: string, text: string, seq: number, st: WorldState | null, opts: { job?: JobContext; model?: boolean } = {}): Promise<Found[]> {
  const tellings = findRetellings(text);
  if (!tellings.length) return [];
  const now = st?.time?.minutes ?? null;
  const out: Found[] = [];
  const asks: { n: number; r: Retelling; sources: Source[] }[] = [];
  tellings.forEach((r, n) => {
    const sources = retellSources(chatId, st, seq, r);
    if (!sources.length) return;
    const best = sources[0]!;
    const off = clear(sources) ? whenConflict(r.when, best.minutes, now) : null;
    if (off)
      out.push({
        kind: "retell",
        severity: "major",
        claim: r.text,
        conflict: `As told, but ${off}${best.place ? `, at ${best.place.split(" › ").slice(-2).join(" › ")}` : ""} (#${best.seq}).${best.beat ? ` ${best.beat}.` : ""}`,
        citations: [cite(best)],
        fix: `Tell it as it happened: ${off.replace(/^it happened /, "")}${best.place ? `, at ${best.place.split(" › ").slice(-2).join(" › ")}` : ""}.`,
        by: "rules",
      });
    asks.push({ n, r, sources });
  });
  if (opts.model === false || !asks.length) return out;
  const names = chatNames(chatId);
  try {
    const r = await callJson({
      task: "helper",
      kind: "continuity",
      chatId,
      jobId: opts.job?.id,
      name: "continuity_retell",
      schema: compareSchema,
      system: COMPARE_SYSTEM,
      user: `${now != null ? `Story time now: ${hhmm(now)}.\n\n` : ""}${asks
        .map((a) => `RETELLING ${a.n + 1} (in a reply by ${names.char}): "${a.r.text}"\nPASSAGES:\n${a.sources.map((s) => `#${s.seq}${where(s) ? ` (${where(s)})` : ""}${s.beat ? ` [what happened: ${s.beat}]` : ""}: ${s.passage}`).join("\n")}`)
        .join("\n\n")}`,
    });
    for (const v of r.data.verdicts) {
      const a = asks.find((x) => x.n === v.retelling - 1);
      if (!a || !v.wrong || !v.conflict.trim()) continue;
      const src = a.sources.find((s) => s.seq === v.source) ?? (clear(a.sources) ? a.sources[0] : undefined);
      // A flag needs the passage it's wrong against.
      if (!src) continue;
      const rule = out.find((o) => o.claim === a.r.text);
      if (rule) {
        // The rules caught the time; the helper's reading of the rest replaces their bare line.
        rule.conflict = `${v.conflict.trim()} (#${src.seq})`;
        rule.fix = v.fix.trim() || rule.fix;
        rule.citations = [cite(src)];
        continue;
      }
      out.push({ kind: "retell", severity: "major", claim: a.r.text, conflict: `${v.conflict.trim()} (#${src.seq})`, citations: [cite(src)], fix: v.fix.trim() || v.conflict.trim(), by: "model" });
    }
  } catch (e) {
    opts.job?.note({ retellError: (e as Error).message.slice(0, 200) });
  }
  return out;
}

// ---------- docs/20 5.2: a story told wrong stays corrected ----------

/** How many replies back a wrong retelling is still said, and how many lines at most. */
const TOLD_BACK = 8;
const TOLD_MAX = 4;

/**
 * The retellings flagged in the last few replies, with what really happened. LAST SLIPS passes on
 * one reply's fixes; a story told wrong is told again (the faucet setting came up at #487, #501 and
 * #509), so its correction stays for eight replies. A flag you dismissed was a deliberate retelling
 * (a lie, a joke, a faulty memory) and stays as written.
 */
export function toldWrong(chatId: string, excludeMessageId?: string): string[] {
  const before = excludeMessageId ? (one<{ seq: number }>("SELECT seq FROM messages WHERE id = ?", excludeMessageId)?.seq ?? Infinity) : Infinity;
  const recent = all<{ id: string; seq: number }>(
    "SELECT id, seq FROM messages WHERE chat_id = ? AND role = 'assistant' AND deleted_at IS NULL AND seq < ? ORDER BY seq DESC LIMIT ?",
    chatId,
    Number.isFinite(before) ? before : Number.MAX_SAFE_INTEGER,
    TOLD_BACK,
  );
  if (!recent.length) return [];
  const seqs = new Map(recent.map((r) => [r.id, r.seq]));
  const flags = all<{ message_id: string; swipe_idx: number; issues: string }>(
    `SELECT f.message_id, f.swipe_idx, f.issues FROM continuity_flags f JOIN messages m ON m.id = f.message_id AND m.active_swipe = f.swipe_idx WHERE f.message_id IN (${recent.map(() => "?").join(",")})`,
    ...recent.map((r) => r.id),
  );
  const lines: { seq: number; line: string }[] = [];
  for (const f of flags)
    for (const i of parseJson<Issue[]>(f.issues, []))
      if (i.kind === "retell" && !i.dismissed) lines.push({ seq: seqs.get(f.message_id)!, line: `- Told wrong at #${seqs.get(f.message_id)}: «${i.claim.length > 140 ? `${i.claim.slice(0, 139).trimEnd()}…` : i.claim}» What happened: ${i.conflict}` });
  return lines.sort((a, b) => b.seq - a.seq).slice(0, TOLD_MAX).map((l) => l.line);
}

registerLane("retold", (ctx) => {
  if (ctx.kind !== "story" && ctx.kind !== "continue") return null;
  const lines = toldWrong(ctx.chatId, ctx.excludeMessageId);
  return lines.length ? lane("retold", null, `Earlier replies told these wrong. Don't build on their version; anyone who brings it up again tells it as it happened:\n${lines.join("\n")}`, { depth: 1 }) : null;
});
