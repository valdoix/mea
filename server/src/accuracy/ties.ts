import { z } from "zod";
import { all } from "../db/db";
import { type AtomRow } from "../memory/atoms";
import { cleanText } from "../memory/text";
import type { JobContext } from "../services/jobs";
import { callJson } from "../services/llm";
import { seqMessage, sentences } from "./rules";
import type { Found } from "./slips";

/**
 * Ties across generations (who is whose ancestor, and who knew them). A reply at #341 had Buffy
 * read Gabriel's jaw as "the geometry of a man who knew her great-great-grandfather": it was Spike
 * who knew George Winters, Gabriel's great-great-grandfather (#298). The scene's memory kept the
 * line word for word, and the writer read it back as a fact at #365. Nothing checked either.
 *
 * Rules first: only a passage that names a tie of the same kind as an earlier memory goes to the
 * helper, once, with those memories. Used on replies (checker.ts) and on a scene's new memories
 * before they're kept (memory/build.ts).
 */

const KIN = /\b(?:(?:great-)+(?:grand)?(?:father|mother|parent|son|daughter|child|uncle|aunt|nephew|niece)s?|grand(?:father|mother|parent|son|daughter|child|pa|ma|dad|mum|mom)s?|ancestors?|ancestry|ancestral|descendants?|descended|forebears?|forefathers?|bloodline|lineage)\b/gi;

/**
 * The kind of tie a word names: "line" for a distant one (great-anything, ancestors, descendants),
 * "grand" for a grandparent or grandchild. Plain parents and children are too common to check.
 */
export function tieKinds(text: string): Set<"line" | "grand"> {
  const out = new Set<"line" | "grand">();
  for (const m of text.matchAll(KIN)) out.add(/^grand/i.test(m[0]) ? "grand" : "line");
  return out;
}

const shares = (a: Set<string>, b: Set<string>) => [...a].some((k) => b.has(k));

/** Earlier memories that name a tie: yours first, then the oldest (the record that set it up). */
function tieRecords(chatId: string, beforeSeq: number, opts: { notScene?: string }) {
  return all<AtomRow>(
    `SELECT * FROM memories WHERE chat_id = ? AND deleted_at IS NULL AND status IN ('active', 'disputed') AND COALESCE(min_seq, 0) < ?
       AND (scene_id IS NULL OR scene_id != ?)
       AND (content LIKE '%grand%' OR content LIKE '%ancest%' OR content LIKE '%descend%' OR content LIKE '%forebear%' OR content LIKE '%forefather%' OR content LIKE '%bloodline%' OR content LIKE '%lineage%' OR content LIKE '%great-%')
     ORDER BY user_edited DESC, pinned DESC, COALESCE(min_seq, 0), importance DESC LIMIT 60`,
    chatId,
    beforeSeq,
    opts.notScene ?? "",
  ).filter((a) => tieKinds(a.content).size);
}

const schema = z.object({
  slips: z
    .array(
      z.object({
        passage: z.coerce.number(),
        conflict: z.string(),
        cites: z.array(z.string()).default([]),
        fix: z.string().default(""),
        right: z.string().default(""),
      }),
    )
    .default([]),
});

export interface TieSlip {
  /** Index into the passages checked. */
  passage: number;
  conflict: string;
  fix: string;
  /** The passage with the tie put right (for a memory, what to keep instead). */
  right: string;
  records: AtomRow[];
}

const MAX_PASSAGES = 6;
const MAX_RECORDS = 8;

/**
 * Checks passages (a reply's sentences, or a scene's new memories) against the earlier memories
 * that name the same kind of tie. No helper call when no passage names a tie the records hold.
 */
export async function tieCheck(chatId: string, passages: string[], beforeSeq: number, opts: { job?: JobContext; signal?: AbortSignal; notScene?: string; what?: "reply" | "memories" } = {}): Promise<TieSlip[]> {
  const asks = passages.map((text, n) => ({ n, text, kinds: tieKinds(text) })).filter((p) => p.kinds.size);
  if (!asks.length) return [];
  const records = tieRecords(chatId, beforeSeq, opts);
  const picked = asks.filter((p) => records.some((r) => shares(p.kinds, tieKinds(r.content)))).slice(0, MAX_PASSAGES);
  if (!picked.length) return [];
  const kinds = new Set(picked.flatMap((p) => [...p.kinds]));
  const used = records.filter((r) => shares(kinds, tieKinds(r.content))).slice(0, MAX_RECORDS);
  const r = await callJson({
    task: "helper",
    kind: "continuity",
    chatId,
    jobId: opts.job?.id,
    name: "ties_check",
    schema,
    system: `You check who is related to whom, and who knew whom, in passages from a roleplay story, against the story's earlier RECORDS. Each passage is ${opts.what === "memories" ? "a note about the latest scene" : "a sentence from the newest reply"}. A passage is wrong only when it gets a tie the RECORDS settle wrong: the wrong ancestor or descendant, whose relative it is ("her great-grandfather" when he is his), the wrong generation (grandfather for great-grandfather), or the wrong person who knew them. Read pronouns carefully: work out who "he", "she", "his" and "her" are from the passage. A metaphor or a thought that keeps the right people isn't wrong, and nor is anything the RECORDS don't settle. Where two RECORDS disagree, one confirmed by the player wins, then the older. List only wrong passages. "conflict": what the RECORDS say, with names. "cites": the record ids. "fix": a one-line correction. "right": the passage rewritten so the tie is right, changing as little as possible. Reply with JSON only: {"slips": [{"passage": 1, "conflict": "…", "cites": ["R1"], "fix": "…", "right": "…"}]}`,
    user: `RECORDS:\n${used.map((a, i) => `[R${i + 1}] (#${a.min_seq ?? "?"}${a.user_edited ? ", confirmed by the player" : ""}) ${a.content}`).join("\n")}\n\nPASSAGES:\n${picked.map((p, i) => `${i + 1}. ${p.text}`).join("\n")}`,
    maxTokens: 1200,
    signal: opts.signal,
  });
  const out: TieSlip[] = [];
  for (const s of r.data.slips) {
    const p = picked[s.passage - 1];
    const cited = s.cites.map((c) => used[Number(c.replace(/\D/g, "")) - 1]).filter((a): a is AtomRow => Boolean(a));
    // A tie is wrong against a record, so one with no record behind it is a guess.
    if (!p || !cited.length || out.some((o) => o.passage === p.n)) continue;
    out.push({ passage: p.n, conflict: s.conflict, fix: s.fix || s.conflict, right: s.right.trim(), records: cited });
  }
  return out;
}

/** The reply's part: each wrong sentence as a flag, cited to the memories it contradicts. */
export async function tieIssues(chatId: string, text: string, seq: number, job?: JobContext): Promise<Found[]> {
  const sents = sentences(cleanText(text));
  const slips = await tieCheck(chatId, sents, seq, { job, what: "reply" });
  if (!slips.length) return [];
  const msg = seqMessage(chatId);
  return slips.map((s) => ({
    kind: "ties",
    severity: "major",
    claim: sents[s.passage]!.trim(),
    conflict: s.conflict,
    citations: s.records.map((a, i) => ({ ref: `M${i + 1}`, type: "memory" as const, label: a.content, id: a.id, seq: a.max_seq, messageId: a.max_seq != null ? (msg.get(a.max_seq) ?? null) : null })),
    fix: s.fix,
    by: "model",
  }));
}
