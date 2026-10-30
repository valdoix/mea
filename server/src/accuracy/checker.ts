import { z } from "zod";
import { all, newId, now, one, parseJson, run } from "../db/db";
import { publish } from "../lib/events";
import { notFound } from "../lib/http";
import { memoryConfig } from "../lib/settings";
import { keyMatches } from "../lore/activate";
import { getFact, supersedeFact } from "../lore/facts";
import { scanEntriesFor } from "../lore/service";
import { type AtomRow } from "../memory/atoms";
import { chatNames } from "../memory/build";
import { correctMemory } from "../memory/remember";
import { excerpt } from "../memory/deep";
import { cleanText, contentWords, ftsQuery } from "../memory/text";
import { type ChatSettings, editMessage, getMessageRow, mustChat, updateChat, updateSwipe } from "../services/chats";
import { replaceTerm, universeCheckOn } from "../services/versionchat";
import type { JobContext } from "../services/jobs";
import { callJson } from "../services/llm";
import { shouldShed } from "../services/quota";
import { userEdit } from "../trackers/service";
import { flagAllowed, guardsFor, puppetScope, type PuppetScope } from "./guards";
import { citesClosed, flagKey, flagKinds, quietKeys, wavedThrough } from "./quiet";
import { deadRule, leakRule, nameRule, ruleInput, seqMessage, timeRule, traitRule } from "./rules";
import { runSlips, slipAllowed, slipContext } from "./slips";
import { retellIssues } from "./retell";
import { tieIssues } from "./ties";
import { doneLoops } from "../trackers/loops";
import { alreadyHappened } from "../trackers/stands";
import { currentFold, foldAt, invalidate, linesToOps } from "../trackers/store";
import type { WorldState } from "../trackers/types";
import { formatStoryTime } from "../trackers/clock";
import { beatNames, todayLines } from "../trackers/today";

/**
 * The continuity checker (CON-02) and the knowledge-leak guard (CON-06). After each reply:
 *   1. cheap rules: eye and hair colour against the trackers and the card, dead people acting,
 *      names that look like typos of known ones, the time of day against the story clock,
 *      and secrets showing up in the lines of someone who doesn't know them;
 *   2. optionally a helper pass over a cited fact sheet.
 * Issues are flagged inline with citations. It never rewrites anything by itself: you pick
 * "regenerate with fix" or "accept and update canon" (or dismiss).
 */

export interface Citation {
  ref: string;
  type: "tracker" | "memory" | "lore" | "card" | "message" | "lesson" | "secret";
  label: string;
  id?: string;
  messageId?: string | null;
  seq?: number | null;
}

export interface Issue {
  id: string;
  /** A slip registry id (slips.ts), or what the helper model called it. */
  kind: "trait" | "dead" | "name" | "time" | "place" | "fact" | "leak" | "pov" | "tense" | "puppet" | "timeline" | "lesson" | (string & {});
  severity: "minor" | "major";
  claim: string;
  conflict: string;
  citations: Citation[];
  fix: string;
  /** What "accept and update canon" writes: a confirmed memory, and a tracker line if it helps. */
  canon?: { memory?: string; wrong?: string; trackerLine?: string; /** docs/15, 3.3: the lore fact the reply's version replaces. */ fact?: { id: string; value: string } };
  by: "rules" | "model";
  dismissed?: boolean;
  /** docs/22 4.2: it went away because you acted on it: its sentence rewritten, or its version made canon. Not waved off. */
  settled?: "fixed" | "accepted";
  /** docs/22 4.2: its kind has gone quiet, so it isn't showing on the reply. Worked out as it's read, never stored. */
  quiet?: boolean;
  /** docs/14, part 6: a one-tap fix that swaps a word in the reply (a name from the original's world). */
  replace?: { from: string; to: string };
}

export interface FlagRow {
  id: string;
  chat_id: string;
  message_id: string;
  swipe_idx: number;
  issues: string;
  status: string;
  created_at: number;
  updated_at: number;
}


export { typoDistance } from "./names";

export function leakGuardOn(chatId: string) {
  const cfg = memoryConfig();
  if (cfg.leakGuard === "on") return true;
  if (cfg.leakGuard === "off") return false;
  return mustChat(chatId).mode === "narrator";
}

/** The rules pass (trait, dead, time, names, leaks). Pure apart from reading the story state; returns issues without ids. */
export function ruleCheck(chatId: string, text: string, st: WorldState | null, o: { speaker: string; leaks: boolean; names?: boolean; messageId?: string }): Omit<Issue, "id">[] {
  const r = ruleInput(chatId, text, st, o);
  return [...traitRule(r), ...deadRule(r), ...timeRule(r), ...(o.names !== false ? nameRule(r) : []), ...(o.leaks ? leakRule(r) : [])];
}

const modelSchema = z.object({
  issues: z
    .array(
      z.object({
        kind: z.string().default("fact"),
        severity: z.enum(["minor", "major"]).catch("minor"),
        claim: z.string(),
        conflict: z.string(),
        cites: z.array(z.string()).default([]),
        fix: z.string().default(""),
        canon: z.string().optional(),
      }),
    )
    .default([]),
});

const verifySchema = z.object({ verdicts: z.array(z.object({ id: z.coerce.string(), stands: z.boolean().catch(true) })).default([]) });

type Passage = { seq: number; messageId: string; role: string; name: string | null; text: string };

/**
 * The story's own words about an issue: the earlier messages that best match it, and the newest
 * ones that mention it (a later message overrides an earlier one: a jacket given back).
 */
function storyPassages(chatId: string, beforeSeq: number, about: string): Passage[] {
  const q = ftsQuery(about, 12);
  if (!q) return [];
  const words = contentWords(about);
  const pick = (order: string) => {
    try {
      return all<{ id: string; seq: number; role: string; name: string | null; content: string }>(
        `SELECT m.id, m.seq, m.role, m.name, s.content FROM swipes_fts f JOIN swipes s ON s.rowid = f.rowid JOIN messages m ON m.id = s.message_id AND s.idx = m.active_swipe
         WHERE swipes_fts MATCH ? AND m.chat_id = ? AND m.seq < ? AND m.deleted_at IS NULL ORDER BY ${order} LIMIT 4`,
        q,
        chatId,
        beforeSeq,
      );
    } catch {
      return [];
    }
  };
  const seen = new Map<number, Passage>();
  for (const r of [...pick("bm25(swipes_fts)"), ...pick("m.seq DESC")]) if (!seen.has(r.seq)) seen.set(r.seq, { seq: r.seq, messageId: r.id, role: r.role, name: r.name, text: excerpt(r.content, words, 480) });
  return [...seen.values()].sort((a, b) => a.seq - b.seq);
}

/**
 * The trackers and memories are summaries and miss things (a line said in your first message, a
 * jacket handed back). Before a helper's flag is shown, the story itself is searched for it, and
 * a flag the story's own words settle in the reply's favour is dropped.
 */
async function settledByStory(chatId: string, seq: number, found: Omit<Issue, "id">[], job?: JobContext): Promise<Set<number>> {
  const asks = found
    // docs/22 4.1: not one that cites something finished. The earlier replies with the same slip would settle it the wrong way.
    .map((i, n) => ({ n, i, passages: i.by === "model" && STORY_SETTLES.has(i.kind) && !citesClosed(i) ? storyPassages(chatId, seq, `${i.claim} ${i.conflict}`) : [] }))
    .filter((a) => a.passages.length);
  if (!asks.length) return new Set();
  const names = chatNames(chatId);
  const who = (p: Passage) => (p.role === "user" ? names.user : (p.name ?? names.char));
  try {
    const r = await callJson({
      task: "helper",
      kind: "continuity",
      chatId,
      jobId: job?.id,
      name: "continuity_verify",
      schema: verifySchema,
      system: `A continuity checker compared a new roleplay reply (message #${seq}) with helper notes (trackers and memories) and flagged the issues below. Those notes are summaries: they are often incomplete or out of date. Under each issue are passages from the story itself, with their message numbers. The passages are the record, and a later message overrides an earlier one. For each issue decide whether it still stands. It does NOT stand when the passages show the reply is right: the event or line did happen, the object changed hands again, the detail was established, the person did say it. It stands only when the passages don't back the reply. Reply with JSON only: {"verdicts": [{"id": "1", "stands": false}]}`,
      user: asks
        .map((a) => `ISSUE ${a.n + 1} (${a.i.kind})\nThe reply says: "${a.i.claim}"\nThe checker said: ${a.i.conflict}\nSTORY:\n${a.passages.map((p) => `#${p.seq} (${who(p)}): ${p.text}`).join("\n")}`)
        .join("\n\n"),
    });
    return new Set(r.data.verdicts.filter((v) => !v.stands).map((v) => Number(v.id) - 1));
  } catch (e) {
    job?.note({ verifyError: (e as Error).message.slice(0, 200) });
    return new Set();
  }
}

/** Kinds the story's own words can settle. Not "ties": an earlier reply with the same slip would settle it the wrong way. */
const STORY_SETTLES = new Set(["fact", "past", "trait", "place", "time", "dead", "name", "who"]);

/** How many messages before the reply the helper pass reads whole (who said and did what just now). */
const RECENT = 4;
/** How many closed loops the fact sheet lists, the newest kept. */
const DONE_SHEET = 12;

/**
 * Tense and point of view are read by counting words, which can't tell the scene's own narration
 * from a memory, a plan, a thought or a general truth. Before such a flag is shown, the helper reads
 * the reply and drops the ones where the narration itself keeps the rule.
 */
async function voiceSettled(chatId: string, text: string, found: Omit<Issue, "id">[], job?: JobContext): Promise<Set<number>> {
  const asks = found.map((i, n) => ({ i, n })).filter((a) => a.i.by === "rules" && (a.i.kind === "tense" || a.i.kind === "pov"));
  if (!asks.length) return new Set();
  try {
    const r = await callJson({
      task: "helper",
      kind: "continuity",
      chatId,
      jobId: job?.id,
      name: "continuity_voice",
      schema: verifySchema,
      system: `A word-counting check flagged the narration of the roleplay reply below for its tense or point of view. Counting is crude: it can't tell the scene's own narration from a memory, a flashback, backstory, a plan, a character's thoughts, a general truth, a letter or dialogue, where another tense or person is right. Read the reply and decide for each flag whether the narration of the scene itself really breaks the rule (for tense: the scene's present action told in the wrong tense, or that action flipping between tenses). Tenses that English grammar needs together ("she remembers how he left", "he had been there before", "she knows he will come") don't stand. When unsure, it doesn't stand. Reply with JSON only: {"verdicts": [{"id": "1", "stands": false}]}`,
      user: `${asks.map((a, k) => `FLAG ${k + 1} (${a.i.kind}): ${a.i.conflict}`).join("\n")}\n\nTHE REPLY:\n${cleanText(text)}`,
    });
    return new Set(r.data.verdicts.filter((v) => !v.stands).map((v) => asks[Number(v.id) - 1]?.n).filter((n): n is number => n != null));
  } catch (e) {
    job?.note({ voiceError: (e as Error).message.slice(0, 200) });
    return new Set();
  }
}

/** A cited fact sheet for the helper pass: the last few messages, story state, confirmed memories, lore, the card. */
export function factSheet(chatId: string, reply: string, st: WorldState | null, seq: number) {
  const cites = new Map<string, Citation>();
  const lines: string[] = [];
  const add = (prefix: string, c: Omit<Citation, "ref">, text: string) => {
    const ref = `${prefix}${[...cites.keys()].filter((k) => k.startsWith(prefix)).length + 1}`;
    cites.set(ref, { ...c, ref });
    lines.push(`[${ref}] ${text}`);
  };
  const msg = seqMessage(chatId);
  const names = chatNames(chatId);
  const recent = all<{ id: string; seq: number; role: string; name: string | null; content: string }>(
    `SELECT m.id, m.seq, m.role, m.name, s.content FROM messages m JOIN swipes s ON s.message_id = m.id AND s.idx = m.active_swipe
     WHERE m.chat_id = ? AND m.seq < ? AND m.deleted_at IS NULL AND m.role IN ('user', 'assistant') ORDER BY m.seq DESC LIMIT ?`,
    chatId,
    seq,
    RECENT,
  ).reverse();
  for (const r of recent) {
    const who = r.role === "user" ? names.user : (r.name ?? names.char);
    add("S", { type: "message", label: `#${r.seq} (${who})`, messageId: r.id, seq: r.seq }, `Message #${r.seq}, written by ${who}${r.role === "user" ? " (the player)" : ""}: ${cleanText(r.content).replace(/\s+/g, " ")}`);
  }
  if (st) {
    // A calendar clock's minutes count from year one: "730000d 15:15" told the checker nothing.
    if (st.time) add("T", { type: "tracker", label: "story time" }, `Story time now: ${formatStoryTime(st.time)}`);
    if (st.place.length) add("T", { type: "tracker", label: "place" }, `Place now: ${st.place.join(" › ")}`);
    for (const c of Object.values(st.chars)) {
      // Everyone the story has met is listed, even with nothing known about them yet: a name missing here reads as a stranger.
      const bits = [c.traits.map((t) => t.text).join(", "), c.look ?? "", c.dead ? "DEAD" : "", c.tier === "spot" || c.tier === "peri" ? "present" : c.place ? `at ${c.place}` : "", c.firstSeq ? `in the story since #${c.firstSeq}` : ""].filter(Boolean);
      add("T", { type: "tracker", label: c.name, seq: c.lastSeq, messageId: msg.get(c.lastSeq) ?? null }, `${c.name}${c.isUser ? " (the player's character)" : ""}: ${bits.join("; ")}`);
    }
    // docs/20 1.2: the day in order, so a reply that retells today can be checked against where and when it happened.
    for (const b of todayLines(st, beatNames(chatId, st))) add("B", { type: "tracker", label: `today, #${b.seq}`, seq: b.seq, messageId: msg.get(b.seq) ?? null }, `Today: ${b.text}`);
    for (const f of Object.values(st.facts).slice(-20)) {
      const who = Object.entries(f.stances)
        .map(([id, s]) => `${st.chars[id]?.name ?? id} ${s.status}`)
        .join(", ");
      add("T", { type: "tracker", label: f.statement, seq: f.firstSeq, messageId: msg.get(f.firstSeq) ?? null }, `${f.secret ? "SECRET " : ""}${f.statement}${who ? ` (${who})` : ""}`);
    }
    // docs/22 2.1: what's finished, from the ledger. A reply that has one still to come contradicts it. What you've waved through has left it (3.3).
    const waved = wavedThrough(chatId);
    const done: { text: string; seq: number; id?: string }[] = [...alreadyHappened(chatId, st).map((h) => ({ text: `Already happened: ${h.text}`, seq: h.seq })), ...doneLoops(st).slice(-DONE_SHEET).map((l) => ({ text: `Done: ${l.what}`, seq: l.closed!, id: l.id }))];
    for (const d of done) if (!waved.has(d.id ?? d.text)) add("D", { type: "tracker", label: d.text, ...(d.id ? { id: d.id } : {}), seq: d.seq, messageId: msg.get(d.seq) ?? null }, `${d.text} (#${d.seq})`);
  }
  const q = ftsQuery(reply, 20);
  const atoms = [
    ...all<AtomRow>("SELECT * FROM memories WHERE chat_id = ? AND deleted_at IS NULL AND status = 'active' AND (pinned = 1 OR user_edited = 1) ORDER BY importance DESC LIMIT 15", chatId),
    ...(q
      ? all<AtomRow>(
          "SELECT m.* FROM memories_fts f JOIN memories m ON m.id = f.id WHERE memories_fts MATCH ? AND f.chat_id = ? AND m.deleted_at IS NULL AND m.status = 'active' ORDER BY bm25(memories_fts) LIMIT 15",
          q,
          chatId,
        )
      : []),
  ];
  const seen = new Set<string>();
  for (const a of atoms) {
    if (seen.has(a.id)) continue;
    seen.add(a.id);
    add("M", { type: "memory", label: a.content, id: a.id, seq: a.max_seq, messageId: a.max_seq != null ? (msg.get(a.max_seq) ?? null) : null }, `${a.content}${a.user_edited ? " (confirmed by the player)" : ""}${a.known_by !== "[]" ? ` (known by ${parseJson<string[]>(a.known_by, []).join(", ")})` : ""}`);
  }
  const chat = mustChat(chatId);
  const entries = scanEntriesFor({ characterId: chat.character_id, personaId: chat.persona_id, chatId }).filter((e) => e.enabled && (e.constant || e.keys.some((k) => keyMatches(k, reply, false, true))));
  for (const e of entries.slice(0, 8)) add("L", { type: "lore", label: e.comment || e.keys[0] || "lore", id: e.id }, e.content.replace(/\s+/g, " "));
  // A1 (and later parts): rules the reply must keep, cited as R1, R2…
  let rules = 0;
  for (const fn of sheetRules)
    for (const r of fn(chatId)) {
      add("R", { type: r.type, label: r.label, id: r.id }, `Story RULE: ${r.text}`);
      rules++;
    }
  const keys = [...cites.keys()];
  return { lines, cites, rules, today: keys.some((k) => k.startsWith("B")), done: keys.some((k) => k.startsWith("D")) };
}

/** Rules the helper pass also checks a reply against (kept lessons, A1). */
type SheetRule = { type: Citation["type"]; label: string; id?: string; text: string };
const sheetRules: ((chatId: string) => SheetRule[])[] = [];
export function registerSheetRules(fn: (chatId: string) => SheetRule[]) {
  sheetRules.push(fn);
}

/**
 * The canon a reply is checked against: the story state as the reply found it (so its own
 * tracker updates can't hide a slip), plus what's canon regardless of when it was written:
 * traits you or the card set, deaths, and the secrets the story knows (CON-01).
 */
export function canonFor(chatId: string, seq: number): WorldState {
  const before = foldAt(chatId, { uptoSeq: seq - 1 }).state;
  const now = currentFold(chatId).result.state;
  const st = structuredClone(before);
  for (const [id, c] of Object.entries(now.chars)) {
    const mine = st.chars[id];
    if (!mine) {
      // Someone the story knows now but not yet at this reply (added by an edit anchored to it):
      // known by name, with only the traits that are canon regardless of the reply.
      st.chars[id] = { ...structuredClone(c), traits: c.traits.filter((t) => t.by !== "model") };
      continue;
    }
    if (c.dead) mine.dead = true;
    for (const t of c.traits) if (t.by !== "model" && !mine.traits.some((x) => x.kind === t.kind && x.text === t.text)) mine.traits = [...mine.traits.filter((x) => x.kind !== t.kind || x.by !== "model"), t];
  }
  for (const [key, f] of Object.entries(now.facts)) if (!st.facts[key]) st.facts[key] = structuredClone(f);
  return st;
}

/** Checks one reply and stores the issues (replacing any earlier check of the same swipe). */
export async function checkReply(chatId: string, messageId: string, swipeIdx: number, opts: { job?: JobContext; model?: boolean } = {}) {
  const cfg = memoryConfig();
  const m = getMessageRow(messageId);
  if (!m) return null;
  const sw = one<{ content: string }>("SELECT content FROM swipes WHERE message_id = ? AND idx = ?", messageId, swipeIdx);
  if (!sw?.content.trim()) return null;
  const names = chatNames(chatId);
  let st: WorldState | null = null;
  try {
    st = canonFor(chatId, m.seq);
  } catch {
    st = null;
  }
  const g = guardsFor(chatId);
  // P1: every check in the slip registry that's on for this chat (slips.ts).
  const ctx = slipContext({ chatId, text: sw.content, seq: m.seq, messageId, role: m.role, speaker: m.name ?? names.char, state: st, guards: g, continuity: cfg.continuity, leaks: leakGuardOn(chatId) });
  let issues: Omit<Issue, "id">[] = runSlips(ctx, "reply", (id, e) => opts.job?.note({ [`${id}Error`]: e.message.slice(0, 200) }));
  // CON-12: the timeline check runs once the trackers have read the reply; keep what it found.
  const earlier = one<FlagRow>("SELECT * FROM continuity_flags WHERE message_id = ? AND swipe_idx = ?", messageId, swipeIdx);
  issues.push(...parseJson<Issue[]>(earlier?.issues, []).filter((i) => i.kind === "timeline").map(({ id: _id, ...rest }) => rest));
  // Ties across generations, against the memories that set them up (ties.ts). The helper runs only when the rules find one.
  if (cfg.continuity && m.role === "assistant" && slipAllowed("ties", g) && !shouldShed("continuity", chatId)) {
    try {
      issues.push(...(await tieIssues(chatId, sw.content, m.seq, opts.job)));
    } catch (e) {
      opts.job?.note({ tiesError: (e as Error).message.slice(0, 200) });
    }
  }
  // docs/20 Part 3: a story retold against the passage it tells. Rules find the retellings and their sources; the helper runs only when there is one.
  if (cfg.continuity && m.role === "assistant" && slipAllowed("retell", g) && !shouldShed("continuity", chatId)) {
    try {
      issues.push(...(await retellIssues(chatId, sw.content, m.seq, st, { job: opts.job, model: opts.model ?? cfg.checkerModel })));
    } catch (e) {
      opts.job?.note({ retellError: (e as Error).message.slice(0, 200) });
    }
  }
  const useModel = cfg.continuity && (opts.model ?? (cfg.checkerModel && !shouldShed("continuity", chatId)));
  if (useModel) {
    const sheet = factSheet(chatId, sw.content, st, m.seq);
    if (sheet.lines.length) {
      try {
        const r = await callJson({
          task: "helper",
          kind: "continuity",
          chatId,
          jobId: opts.job?.id,
          name: "continuity_check",
          schema: modelSchema,
          system: `You check one new reply of a roleplay against the story's established facts. List only real contradictions: a fact, trait, name, place, time, or who-knows-what that the reply gets wrong compared with the FACTS. Watch who said and did what: a line, an act or an idea credited to the wrong person, whether it was said in the recent messages (S ids, quoted in full) or earlier in this same reply (kind "who"; cite the S id, or none when the reply contradicts itself). The S messages are the story itself and outrank the other FACTS. Watch who is where: someone the FACTS have present arriving as if they had been away, or someone the FACTS have elsewhere in the room with no arrival, is a contradiction (kind "place"). Check a look or trait against the person it describes, never someone else in the same sentence ("her eyes went to his blue ones" is about him). Not style, not things the facts don't cover, not new details that merely add to them. The FACTS are summaries kept by helpers and can lag behind the story (an object handed back, a change of clothes): a reply describing a later change isn't wrong for it.${sheet.done ? ' The D facts don\'t lag: they are the record of what finished, at the message shown. A reply, thoughts and dialogue included, that has one still to come (planning it, waiting for it, promising it, listing it next) contradicts it (kind "fact"; cite the D id), even when a recent S message has it still to come too: that is the same mistake repeated. Remembering it, or doing it again on purpose, doesn\'t.' : ""}${leakGuardOn(chatId) ? " Also flag a character referring to a SECRET they don't know." : ""}${sheet.rules ? ' Also flag the reply breaking a story RULE (kind "lesson", cite the R id).' : ""}${slipAllowed("past", g) ? ' Also flag a claim about something that happened before this scene (an earlier event, a promise, a conversation) that neither the FACTS nor the memories hold (kind "past"; cite the nearest fact if any).' : ""}${sheet.today ? ` The B facts are today in order, each at its time and place: a reply that tells one of those events at another time or place, in another order, or with other words in someone's mouth contradicts it (kind "${slipAllowed("past", g) ? "past" : "fact"}"; cite the B id).` : ""} Quote the reply's words in "claim", say what the facts say in "conflict", cite the fact ids like "T2" or "M5" in "cites", and write a one-line correction in "fix". In "canon", write one self-contained sentence of what would be true if the reply's version were kept, naming who it's about (for example "Mira's eyes are grey."; for an invented past, the event as the reply tells it, never its denial). Reply with JSON only: {"issues": [{"kind": "fact", "severity": "major", "claim": "…", "conflict": "…", "cites": ["T1"], "fix": "…", "canon": "…"}]}`,
          user: `FACTS:\n${sheet.lines.join("\n")}\n\nNEW REPLY (by ${m.name ?? names.char}):\n${cleanText(sw.content)}`,
        });
        for (const i of r.data.issues) {
          if (issues.some((x) => x.claim.includes(i.claim.slice(0, 40)) || i.claim.includes(x.claim.slice(0, 40)))) continue;
          const citations = i.cites.map((c) => sheet.cites.get(c.replace(/[[\]\s]/g, ""))).filter((c): c is Citation => Boolean(c));
          // An issue without a source is a guess, except an invented past (its point is that nothing holds it).
          if (!citations.length && i.kind !== "past" && i.kind !== "who") continue;
          issues.push({
            kind: (["trait", "dead", "name", "time", "place", "fact", "leak", "pov", "tense", "timeline", "lesson", "past", "who"].includes(i.kind) ? i.kind : "fact") as Issue["kind"],
            severity: i.severity,
            claim: i.claim,
            conflict: i.conflict,
            citations,
            fix: i.fix || i.conflict,
            // M28: what's kept is a whole sentence, never the reply's quoted fragment.
            canon: i.canon?.trim() ? { memory: i.canon.trim(), wrong: citations.find((c) => c.type === "memory")?.label } : undefined,
            by: "model",
          });
        }
      } catch (e) {
        opts.job?.note({ checkerError: (e as Error).message.slice(0, 200) });
      }
    }
  }
  const settled = useModel ? new Set((await Promise.all([settledByStory(chatId, m.seq, issues, opts.job), voiceSettled(chatId, sw.content, issues, opts.job)])).flatMap((x) => [...x])) : new Set<number>();
  if (settled.size) {
    opts.job?.note({ settledByStory: settled.size });
    issues = issues.filter((_, n) => !settled.has(n));
  }
  const withIds: Issue[] = issues.map((i, n) => ({ ...i, id: `${n + 1}` }));
  const t = now();
  run(
    `INSERT INTO continuity_flags (id, chat_id, message_id, swipe_idx, issues, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(message_id, swipe_idx) DO UPDATE SET issues = excluded.issues, status = excluded.status, updated_at = excluded.updated_at`,
    newId(),
    chatId,
    messageId,
    swipeIdx,
    JSON.stringify(withIds),
    withIds.length ? "open" : "clean",
    t,
    t,
  );
  flagsChanged(chatId, messageId);
  return withIds;
}

/** A reply's notes as shown: puppet flags follow the Persona control as it is now, not as it was when checked. */
export function flagOut(r: FlagRow, scope: PuppetScope = scopeFor(r.chat_id), quiet = quietKeys(r.chat_id)) {
  const issues = parseJson<Issue[]>(r.issues, [])
    .filter((i) => flagAllowed(i, scope))
    .map((i) => (!i.dismissed && quiet.has(flagKey(i)) ? { ...i, quiet: true } : i));
  const open = issues.filter((i) => !i.dismissed && !i.quiet).length;
  return { id: r.id, messageId: r.message_id, swipeIdx: r.swipe_idx, status: r.status === "open" && !open ? "clean" : r.status, issues, open, updatedAt: r.updated_at };
}

function scopeFor(chatId: string): PuppetScope {
  try {
    return puppetScope(chatId);
  } catch {
    return "all";
  }
}

export function flagsFor(chatId: string, opts: { messageIds?: string[]; open?: boolean } = {}) {
  let rows = all<FlagRow>("SELECT * FROM continuity_flags WHERE chat_id = ? ORDER BY updated_at DESC", chatId);
  if (opts.messageIds) {
    const ids = new Set(opts.messageIds);
    rows = rows.filter((r) => ids.has(r.message_id));
  }
  const scope = scopeFor(chatId);
  const quiet = quietKeys(chatId);
  const out = rows.map((r) => flagOut(r, scope, quiet));
  return opts.open ? out.filter((f) => f.status === "open") : out;
}

function mustFlag(id: string) {
  const r = one<FlagRow>("SELECT * FROM continuity_flags WHERE id = ?", id);
  if (!r) throw notFound("Check not found");
  return r;
}

function save(r: FlagRow, issues: Issue[], status?: string) {
  const open = issues.filter((i) => !i.dismissed).length;
  run("UPDATE continuity_flags SET issues = ?, status = ?, updated_at = ? WHERE id = ?", JSON.stringify(issues), status ?? (open ? "open" : "resolved"), now(), r.id);
  flagsChanged(r.chat_id, r.message_id);
  return flagOut(one<FlagRow>("SELECT * FROM continuity_flags WHERE id = ?", r.id)!);
}

/** "Dismiss all" means the notes you can see. `settled` says you acted on it, rather than waved it off. */
export function dismissIssue(flagId: string, issueId: string | null, settled?: Issue["settled"]) {
  const r = mustFlag(flagId);
  const quiet = quietKeys(r.chat_id);
  const issues = parseJson<Issue[]>(r.issues, []).map((i) => ((issueId == null ? !quiet.has(flagKey(i)) : i.id === issueId) ? { ...i, dismissed: true, ...(settled ? { settled } : {}) } : i));
  return save(r, issues);
}

/** docs/22 4.2, the one tap back: the kind's flags show again, its waiting ones too, and its count starts over. */
export function showKindAgain(chatId: string, key: string) {
  if (!flagKinds(chatId).some((k) => k.key === key)) throw notFound("No flags of that kind");
  const settings = parseJson<ChatSettings>(mustChat(chatId).settings, {});
  updateChat(chatId, { settings: { flagsBack: { ...settings.flagsBack, [key]: now() } } });
  // What a quiet flag had stopped holding waits again (docs/19 2.3).
  invalidate(chatId);
  publish({ type: "continuity.changed", chatId, messageId: "" });
}

/** "Accept and update canon": the reply's version becomes a confirmed memory (and a tracker line). */
export function acceptIssue(flagId: string, issueId: string) {
  const r = mustFlag(flagId);
  const issues = parseJson<Issue[]>(r.issues, []);
  const issue = issues.find((i) => i.id === issueId);
  if (!issue) throw notFound("Issue not found");
  // M27: only the memories the issue cites are replaced, never ones that merely share a word.
  // docs/15, 3.3: the reply's version becomes the fact (the old one kept in History), from this message.
  if (issue.canon?.fact) {
    const f = getFact(issue.canon.fact.id);
    if (f && f.now) supersedeFact(f.id, { value: issue.canon.fact.value, chatId: r.chat_id, messageId: r.message_id, origin: "story" }, { force: true });
  }
  if (issue.canon?.memory && issue.kind !== "timeline" && !issue.canon.fact) {
    // An invented past adds an event; the memories it cited aren't wrong, so none is replaced.
    const cited = issue.kind === "past" ? [] : issue.citations.filter((c) => c.type === "memory" && c.id).map((c) => c.id!);
    correctMemory(r.chat_id, { wrong: issue.canon.wrong ?? issue.conflict, right: issue.canon.memory, messageId: r.message_id, memoryIds: cited, exact: true });
  }
  if (issue.canon?.trackerLine) {
    const { ops } = linesToOps([issue.canon.trackerLine]);
    if (ops.length) userEdit(r.chat_id, ops);
  }
  return save(
    r,
    issues.map((i) => (i.id === issueId ? { ...i, dismissed: true, settled: "accepted" as const } : i)),
  );
}

/** The notes "regenerate with fix" sends with the swipe: the ones showing on it. */
export function fixNotes(flagId: string) {
  const r = mustFlag(flagId);
  const quiet = quietKeys(r.chat_id);
  const open = parseJson<Issue[]>(r.issues, []).filter((i) => !i.dismissed && !quiet.has(flagKey(i)));
  return { chatId: r.chat_id, messageId: r.message_id, feedback: `Keep continuity: ${open.map((i) => i.fix).join(" ")}` };
}

/** True when anything would check a reply: the continuity checker or one of the guards. */
export function checksOn(chatId: string) {
  if (memoryConfig().continuity) return true;
  const g = guardsFor(chatId);
  return g.pov || g.tense || g.puppet || g.names !== "off" || g.timeline || (slipAllowed("universe", g) && universeCheckOn(chatId));
}

/** docs/14, part 6: the one-tap fix, the version's name in place of the original's, in the reply as shown. */
export function replaceIssue(flagId: string, issueId: string) {
  const r = mustFlag(flagId);
  const issues = parseJson<Issue[]>(r.issues, []);
  const issue = issues.find((i) => i.id === issueId);
  if (!issue?.replace) throw notFound("Nothing to swap for that note");
  const sw = one<{ content: string }>("SELECT content FROM swipes WHERE message_id = ? AND idx = ?", r.message_id, r.swipe_idx);
  if (!sw) throw notFound("That reply is gone");
  const next = replaceTerm(sw.content, issue.replace.from, issue.replace.to);
  // The swipe on screen is edited as you would (its history kept, the chat told); another one quietly.
  if (next !== sw.content) {
    if (getMessageRow(r.message_id)?.active_swipe === r.swipe_idx) editMessage(r.message_id, next);
    else updateSwipe(r.message_id, r.swipe_idx, { content: next });
  }
  return save(
    r,
    issues.map((i) => (i.id === issueId || (i.kind === issue.kind && i.replace?.from === issue.replace!.from) ? { ...i, dismissed: true, settled: "fixed" as const } : i)),
  );
}

/** After each reply (job "accuracy.check"). */
export async function runCheckJob(p: { chatId: string; messageId: string; swipeIdx: number }, job?: JobContext) {
  if (!checksOn(p.chatId)) return;
  await checkReply(p.chatId, p.messageId, p.swipeIdx, { job });
}

/**
 * Replaces one kind of issue on a reply's notes (the timeline check, which runs later than the
 * rest), keeping the others and anything you already dismissed.
 */
export function mergeIssues(chatId: string, messageId: string, swipeIdx: number, kind: Issue["kind"], found: Omit<Issue, "id">[]) {
  const r = one<FlagRow>("SELECT * FROM continuity_flags WHERE message_id = ? AND swipe_idx = ?", messageId, swipeIdx);
  const cur = parseJson<Issue[]>(r?.issues, []);
  if (!r && !found.length) return;
  const dismissed = new Set(cur.filter((i) => i.kind === kind && i.dismissed).map((i) => i.claim));
  const kept = cur.filter((i) => i.kind !== kind);
  let next = 0;
  for (const i of kept) next = Math.max(next, Number(i.id) || 0);
  const issues: Issue[] = [...kept, ...found.map((i) => ({ ...i, id: String(++next), ...(dismissed.has(i.claim) ? { dismissed: true } : {}) }))];
  const open = issues.filter((i) => !i.dismissed).length;
  const t = now();
  run(
    `INSERT INTO continuity_flags (id, chat_id, message_id, swipe_idx, issues, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(message_id, swipe_idx) DO UPDATE SET issues = excluded.issues, status = excluded.status, updated_at = excluded.updated_at`,
    newId(),
    chatId,
    messageId,
    swipeIdx,
    JSON.stringify(issues),
    open ? "open" : issues.length ? "resolved" : "clean",
    t,
    t,
  );
  flagsChanged(chatId, messageId);
}

/** CON-12, after the trackers read a reply (an onTrackerUpdate hook). */
export function recordTimeline(chatId: string, messageId: string) {
  const m = getMessageRow(messageId);
  if (!m || m.deleted_at) return;
  const sw = one<{ content: string }>("SELECT content FROM swipes WHERE message_id = ? AND idx = ?", messageId, m.active_swipe);
  const ctx = slipContext({ chatId, text: sw?.content ?? "", seq: m.seq, messageId, role: m.role, speaker: m.name ?? "", state: null, guards: guardsFor(chatId), continuity: memoryConfig().continuity, leaks: false });
  mergeIssues(chatId, messageId, m.active_swipe, "timeline", runSlips(ctx, "trackers"));
}

/** A reply's flags changed: the page hears, and the fold folds again (docs/19 2.3: an open leak holds what it let out). */
function flagsChanged(chatId: string, messageId: string) {
  invalidate(chatId, { messageId });
  publish({ type: "continuity.changed", chatId, messageId });
}
