import { z } from "zod";
import { all, newId, now, one, parseJson, run } from "../db/db";
import { publish } from "../lib/events";
import { notFound } from "../lib/http";
import { memoryConfig } from "../lib/settings";
import { keyMatches } from "../lore/activate";
import { scanEntriesFor } from "../lore/service";
import { type AtomRow } from "../memory/atoms";
import { chatNames } from "../memory/build";
import { correctMemory } from "../memory/remember";
import { cleanText, ftsQuery } from "../memory/text";
import { getMessageRow, mustChat } from "../services/chats";
import type { JobContext } from "../services/jobs";
import { callJson } from "../services/llm";
import { shouldShed } from "../services/quota";
import { userEdit } from "../trackers/service";
import { flagAllowed, guardsFor, puppetScope, type PuppetScope } from "./guards";
import { deadRule, leakRule, nameRule, ruleInput, seqMessage, timeRule, traitRule } from "./rules";
import { runSlips, slipContext } from "./slips";
import { currentFold, foldAt, linesToOps } from "../trackers/store";
import type { WorldState } from "../trackers/types";

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
  type: "tracker" | "memory" | "lore" | "card" | "message" | "lesson";
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
  canon?: { memory?: string; wrong?: string; trackerLine?: string };
  by: "rules" | "model";
  dismissed?: boolean;
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

/** A cited fact sheet for the helper pass: story state, confirmed memories, lore, the card. */
function factSheet(chatId: string, reply: string, st: WorldState | null) {
  const cites = new Map<string, Citation>();
  const lines: string[] = [];
  const add = (prefix: string, c: Omit<Citation, "ref">, text: string) => {
    const ref = `${prefix}${[...cites.keys()].filter((k) => k.startsWith(prefix)).length + 1}`;
    cites.set(ref, { ...c, ref });
    lines.push(`[${ref}] ${text}`);
  };
  const msg = seqMessage(chatId);
  if (st) {
    if (st.time) add("T", { type: "tracker", label: "story time" }, `Story time now: ${Math.floor(st.time.minutes / 1440) + 1}d ${String(Math.floor((st.time.minutes % 1440) / 60)).padStart(2, "0")}:${String(st.time.minutes % 60).padStart(2, "0")}`);
    if (st.place.length) add("T", { type: "tracker", label: "place" }, `Place now: ${st.place.join(" › ")}`);
    for (const c of Object.values(st.chars)) {
      const bits = [c.traits.map((t) => t.text).join(", "), c.look ?? "", c.dead ? "DEAD" : "", c.tier === "spot" || c.tier === "peri" ? "present" : c.place ? `at ${c.place}` : ""].filter(Boolean);
      if (bits.length) add("T", { type: "tracker", label: c.name, seq: c.lastSeq, messageId: msg.get(c.lastSeq) ?? null }, `${c.name}${c.isUser ? " (the player's character)" : ""}: ${bits.join("; ")}`);
    }
    for (const f of Object.values(st.facts).slice(-20)) {
      const who = Object.entries(f.stances)
        .map(([id, s]) => `${st.chars[id]?.name ?? id} ${s.status}`)
        .join(", ");
      add("T", { type: "tracker", label: f.statement, seq: f.firstSeq, messageId: msg.get(f.firstSeq) ?? null }, `${f.secret ? "SECRET " : ""}${f.statement}${who ? ` (${who})` : ""}`);
    }
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
  for (const e of entries.slice(0, 8)) add("L", { type: "lore", label: e.comment || e.keys[0] || "lore", id: e.id }, e.content.replace(/\s+/g, " ").slice(0, 400));
  // A1 (and later parts): rules the reply must keep, cited as R1, R2…
  let rules = 0;
  for (const fn of sheetRules)
    for (const r of fn(chatId)) {
      add("R", { type: r.type, label: r.label, id: r.id }, `Story RULE: ${r.text}`);
      rules++;
    }
  return { lines, cites, rules };
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
  const issues: Omit<Issue, "id">[] = runSlips(ctx, "reply", (id, e) => opts.job?.note({ [`${id}Error`]: e.message.slice(0, 200) }));
  // CON-12: the timeline check runs once the trackers have read the reply; keep what it found.
  const earlier = one<FlagRow>("SELECT * FROM continuity_flags WHERE message_id = ? AND swipe_idx = ?", messageId, swipeIdx);
  issues.push(...parseJson<Issue[]>(earlier?.issues, []).filter((i) => i.kind === "timeline").map(({ id: _id, ...rest }) => rest));
  const useModel = cfg.continuity && (opts.model ?? (cfg.checkerModel && !shouldShed("continuity")));
  if (useModel) {
    const sheet = factSheet(chatId, sw.content, st);
    if (sheet.lines.length) {
      try {
        const r = await callJson({
          task: "helper",
          kind: "continuity",
          chatId,
          jobId: opts.job?.id,
          name: "continuity_check",
          schema: modelSchema,
          system: `You check one new reply of a roleplay against the story's established facts. List only real contradictions: a fact, trait, name, place, time, or who-knows-what that the reply gets wrong compared with the FACTS. Not style, not things the facts don't cover, not new details that merely add to them.${leakGuardOn(chatId) ? " Also flag a character referring to a SECRET they don't know." : ""}${sheet.rules ? ' Also flag the reply breaking a story RULE (kind "lesson", cite the R id).' : ""} Quote the reply's words in "claim", say what the facts say in "conflict", cite the fact ids like "T2" or "M5" in "cites", and write a one-line correction in "fix". In "canon", write one self-contained sentence of what would be true if the reply's version were kept, naming who it's about (for example "Mira's eyes are grey."). Reply with JSON only: {"issues": [{"kind": "fact", "severity": "major", "claim": "…", "conflict": "…", "cites": ["T1"], "fix": "…", "canon": "…"}]}`,
          user: `FACTS:\n${sheet.lines.join("\n")}\n\nNEW REPLY (by ${m.name ?? names.char}):\n${cleanText(sw.content).slice(0, 6000)}`,
          maxTokens: 800,
        });
        for (const i of r.data.issues) {
          if (issues.some((x) => x.claim.includes(i.claim.slice(0, 40)) || i.claim.includes(x.claim.slice(0, 40)))) continue;
          const citations = i.cites.map((c) => sheet.cites.get(c.replace(/[[\]\s]/g, ""))).filter((c): c is Citation => Boolean(c));
          if (!citations.length) continue; // an issue without a source is a guess
          issues.push({
            kind: (["trait", "dead", "name", "time", "place", "fact", "leak", "pov", "tense", "timeline", "lesson"].includes(i.kind) ? i.kind : "fact") as Issue["kind"],
            severity: i.severity,
            claim: i.claim.slice(0, 300),
            conflict: i.conflict.slice(0, 400),
            citations,
            fix: i.fix || i.conflict,
            // M28: what's kept is a whole sentence, never the reply's quoted fragment.
            canon: i.canon?.trim() ? { memory: i.canon.trim().slice(0, 300), wrong: citations.find((c) => c.type === "memory")?.label } : undefined,
            by: "model",
          });
        }
      } catch (e) {
        opts.job?.note({ checkerError: (e as Error).message.slice(0, 200) });
      }
    }
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
  publish({ type: "continuity.changed", chatId, messageId });
  return withIds;
}

/** A reply's notes as shown: puppet flags follow the Persona control as it is now, not as it was when checked. */
export function flagOut(r: FlagRow, scope: PuppetScope = scopeFor(r.chat_id)) {
  const issues = parseJson<Issue[]>(r.issues, []).filter((i) => flagAllowed(i, scope));
  const open = issues.filter((i) => !i.dismissed).length;
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
  const out = rows.map((r) => flagOut(r, scope));
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
  publish({ type: "continuity.changed", chatId: r.chat_id, messageId: r.message_id });
  return flagOut(one<FlagRow>("SELECT * FROM continuity_flags WHERE id = ?", r.id)!);
}

export function dismissIssue(flagId: string, issueId: string | null) {
  const r = mustFlag(flagId);
  const issues = parseJson<Issue[]>(r.issues, []).map((i) => (issueId == null || i.id === issueId ? { ...i, dismissed: true } : i));
  return save(r, issues);
}

/** "Accept and update canon": the reply's version becomes a confirmed memory (and a tracker line). */
export function acceptIssue(flagId: string, issueId: string) {
  const r = mustFlag(flagId);
  const issues = parseJson<Issue[]>(r.issues, []);
  const issue = issues.find((i) => i.id === issueId);
  if (!issue) throw notFound("Issue not found");
  // M27: only the memories the issue cites are replaced, never ones that merely share a word.
  if (issue.canon?.memory && issue.kind !== "timeline") {
    const cited = issue.citations.filter((c) => c.type === "memory" && c.id).map((c) => c.id!);
    correctMemory(r.chat_id, { wrong: issue.canon.wrong ?? issue.conflict, right: issue.canon.memory, messageId: r.message_id, memoryIds: cited, exact: true });
  }
  if (issue.canon?.trackerLine) {
    const { ops } = linesToOps([issue.canon.trackerLine]);
    if (ops.length) userEdit(r.chat_id, ops);
  }
  return save(
    r,
    issues.map((i) => (i.id === issueId ? { ...i, dismissed: true } : i)),
  );
}

/** The notes "regenerate with fix" sends with the swipe. */
export function fixNotes(flagId: string) {
  const r = mustFlag(flagId);
  const open = parseJson<Issue[]>(r.issues, []).filter((i) => !i.dismissed);
  return { chatId: r.chat_id, messageId: r.message_id, feedback: `Keep continuity: ${open.map((i) => i.fix).join(" ")}`.slice(0, 1500) };
}

/** True when anything would check a reply: the continuity checker or one of the guards. */
export function checksOn(chatId: string) {
  if (memoryConfig().continuity) return true;
  const g = guardsFor(chatId);
  return g.pov || g.tense || g.puppet || g.names !== "off" || g.timeline;
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
  publish({ type: "continuity.changed", chatId, messageId });
}

/** CON-12, after the trackers read a reply (an onTrackerUpdate hook). */
export function recordTimeline(chatId: string, messageId: string) {
  const m = getMessageRow(messageId);
  if (!m || m.deleted_at) return;
  const sw = one<{ content: string }>("SELECT content FROM swipes WHERE message_id = ? AND idx = ?", messageId, m.active_swipe);
  const ctx = slipContext({ chatId, text: sw?.content ?? "", seq: m.seq, messageId, role: m.role, speaker: m.name ?? "", state: null, guards: guardsFor(chatId), continuity: memoryConfig().continuity, leaks: false });
  mergeIssues(chatId, messageId, m.active_swipe, "timeline", runSlips(ctx, "trackers"));
}
