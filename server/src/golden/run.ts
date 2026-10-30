import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { all, one, run as sql } from "../db/db";
import { checkReply, dismissIssue } from "../accuracy/checker";
// The rest of the slip registry (not here, the clock backwards, planning left in…) registers on import.
import "../accuracy/moreslips";
import "../accuracy/undone";
import { createOffpage } from "../accuracy/offpage";
import { setCanon } from "../accuracy/canoncut";
import { normalizeCard } from "../cards/card";
import { createLorebook, softDeleteLorebook } from "../lore/service";
import { defaultEntry } from "../lore/types";
import { createCharacter } from "../services/characters";
import { addMessage, createChat, getMessageRow, historyForPrompt, softDeleteChat, softDeleteMessage, updateChat } from "../services/chats";
import { previewPrompt, startStory } from "../services/generation";
import { createPersona } from "../services/personas";
import { advisorExtra, advisorInput, runAdvisor, steerFor } from "../steer/advisor";
import { currentFold, dryRunOps, linesToOps, writeEvents } from "../trackers/store";
import type { Op } from "../trackers/types";

/**
 * Golden scenarios (Almanac plan K1): a fixed set of scenes that grade Mea's preset and pipeline
 * after each change. Each scenario sets up a story (card, player, records, secrets, canon), then
 * grades: the prompt (what must and mustn't be in it), a reply (the rule graders, the same checks
 * the slip registry runs on every reply), replies that should be caught, the shape of ledger
 * lines, and the records after a reply. With the mock provider the reply is the scenario's own
 * (free, in CI); "with a real model" writes it with your story model.
 */

const scenarioSchema = z.object({
  name: z.string(),
  about: z.string(),
  card: z.object({ name: z.string(), description: z.string().default(""), first_mes: z.string().default("…") }),
  user: z.string().default("Ash"),
  /** Narrator chats run the knowledge-leak check by default (memory › leak guard "auto"). */
  mode: z.enum(["companion", "narrator"]).default("companion"),
  settings: z.record(z.string(), z.unknown()).default({}),
  ledger: z.array(z.string()).default([]),
  offpage: z.array(z.object({ label: z.string(), neverSay: z.array(z.string()) })).default([]),
  /** Lorebook entries linked to the chat, with their secrets (LORE-09). */
  lore: z.array(z.object({ keys: z.array(z.string()), content: z.string(), secrets: z.array(z.object({ text: z.string(), knownBy: z.array(z.string()).default([]) })).default([]) })).default([]),
  canon: z.object({ source: z.string(), point: z.string(), later: z.array(z.object({ kind: z.enum(["event", "character", "reveal", "term"]), text: z.string(), terms: z.array(z.string()) })) }).optional(),
  /**
   * The story so far. docs/20: a message can carry its own ledger lines (its time, place, promises),
   * and a reply can be checked as it lands, its flags kept or dismissed (a deliberate retelling).
   * `closes` are loops finished at that message, with every wording they've had (docs/22).
   */
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string(),
        ledger: z.array(z.string()).default([]),
        closes: z.array(z.object({ what: z.string(), from: z.array(z.string()).default([]) })).default([]),
        check: z.enum(["keep", "dismiss"]).optional(),
      }),
    )
    .default([]),
  /** Take back this many of the newest messages before anything's read. */
  rewind: z.number().default(0),
  /** Run the planner (the advisor, or the separate planner when the chat asks for one) before the prompt is read. */
  runPlanner: z.boolean().default(false),
  /** Plans sent back for waiting on something done, once the plan is read as a reply would. */
  replans: z.number().optional(),
  prompt: z.object({ contains: z.array(z.string()).default([]), lacks: z.array(z.string()).default([]) }).optional(),
  /** The same, of what the separate planner is given. */
  plannerInput: z.object({ contains: z.array(z.string()).default([]), lacks: z.array(z.string()).default([]) }).optional(),
  /** A good reply: none of `forbid` may be flagged. */
  reply: z.string().optional(),
  forbid: z.array(z.string()).default([]),
  /** Replies that must be caught, each with the kinds the graders must flag. */
  bad: z.array(z.object({ reply: z.string(), expect: z.array(z.string()) })).default([]),
  /** Ledger lines a tracker might write: every line must read and apply (or, with `ok: false`, not). */
  ledgerShape: z.array(z.object({ lines: z.array(z.string()), ok: z.boolean() })).default([]),
  /** Records after the reply: lines written with it, then path checks ("obligations.*.status" = "kept"), and paths with nothing there. */
  after: z.object({ lines: z.array(z.string()), expect: z.array(z.object({ path: z.string(), equals: z.unknown() })).default([]), none: z.array(z.string()).default([]) }).optional(),
});
export type Scenario = z.infer<typeof scenarioSchema>;

export interface CheckResult {
  name: string;
  pass: boolean;
  detail: string;
}
export interface ScenarioResult {
  name: string;
  about: string;
  pass: boolean;
  checks: CheckResult[];
}

const DIR = join(import.meta.dir, "..", "..", "test", "golden");

export function loadScenarios(dir = DIR): Scenario[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => scenarioSchema.parse(JSON.parse(readFileSync(join(dir, f), "utf8"))));
}

/** A dotted path with "*" for any key: every match must equal the value (and there must be one). */
function pathValues(obj: unknown, path: string): unknown[] {
  let cur: unknown[] = [obj];
  for (const k of path.split(".")) cur = cur.flatMap((o) => (o && typeof o === "object" ? (k === "*" ? Object.values(o) : [(o as Record<string, unknown>)[k]]) : []));
  return cur.filter((x) => x !== undefined);
}

async function issuesFor(chatId: string, text: string) {
  const id = addMessage(chatId, "assistant", text);
  const issues = (await checkReply(chatId, id, 0, { model: false })) ?? [];
  return { id, kinds: [...new Set(issues.map((i) => i.kind))] };
}

/** Writes a reply with the story model (the real pipeline), and waits for it. */
async function modelReply(chatId: string, timeoutMs = 180_000) {
  const r = await startStory(chatId, "new");
  const until = Date.now() + timeoutMs;
  // Wait on the reply itself: the plan watch may retry a take that skipped its planning pass
  // (a new generation for the same reply), which is Mea working as meant, not a failure.
  while (Date.now() < until) {
    const sw = one<{ status: string; error: string | null }>("SELECT s.status, s.error FROM messages m JOIN swipes s ON s.message_id = m.id AND s.idx = m.active_swipe WHERE m.id = ?", r.messageId);
    const running = one("SELECT 1 FROM generations WHERE message_id = ? AND status = 'running' LIMIT 1", r.messageId);
    if (sw?.status === "done" && !running) break;
    if (sw?.status === "error" && !running) throw new Error(sw.error ?? "the model failed");
    await Bun.sleep(500);
  }
  const m = getMessageRow(r.messageId);
  if (!m) throw new Error("no reply");
  return { id: m.id, text: one<{ content: string }>("SELECT content FROM swipes WHERE message_id = ? AND idx = ?", m.id, m.active_swipe)?.content ?? "" };
}

export async function runScenario(s: Scenario, opts: { model?: boolean } = {}): Promise<ScenarioResult> {
  const checks: CheckResult[] = [];
  const check = (name: string, pass: boolean, detail = "") => checks.push({ name, pass, detail });
  const { data } = normalizeCard({ spec: "chara_card_v2", data: s.card });
  const characterId = createCharacter(data);
  const personaId = createPersona({ name: s.user, data: { description: "" } });
  const chatId = createChat({ characterId, personaId, mode: s.mode }).id;
  let book: string | null = null;
  updateChat(chatId, { title: `[story check] ${s.name}`, settings: s.settings as never });
  try {
    const first = one<{ id: string }>("SELECT id FROM messages WHERE chat_id = ? ORDER BY seq LIMIT 1", chatId)?.id ?? null;
    if (s.ledger.length) writeEvents(chatId, { messageId: first, swipeIdx: -1 }, linesToOps(s.ledger).ops, "model");
    for (const o of s.offpage) createOffpage(chatId, o);
    if (s.lore.length) book = createLorebook({ name: `[story check] ${s.name}`, entries: s.lore.map((e) => defaultEntry({ keys: e.keys, comment: e.keys[0], content: e.content, extra: { secrets: e.secrets } })), links: [{ target_type: "chat", target_id: chatId }] });
    if (s.canon) setCanon(chatId, { ...s.canon, later: s.canon.later.map((l, i) => ({ ...l, id: `g${i}` })), wont: [] });
    for (const m of s.history) {
      const id = addMessage(chatId, m.role, m.content, m.role === "assistant" ? { name: s.card.name } : {});
      if (m.ledger.length) writeEvents(chatId, { messageId: id, swipeIdx: 0 }, linesToOps(m.ledger).ops, "model");
      if (m.closes.length) writeEvents(chatId, { messageId: id, swipeIdx: 0 }, m.closes.map((c): Op => ({ op: "loop", args: { action: "new", what: c.what, kind: "errand", from: c.from, done: true, how: c.what }, raw: `loop: ${c.what}` })), "memory");
      if (m.check) {
        const issues = (await checkReply(chatId, id, 0, { model: false })) ?? [];
        const flag = one<{ id: string }>("SELECT id FROM continuity_flags WHERE message_id = ?", id);
        if (m.check === "dismiss" && flag) for (const i of issues) dismissIssue(flag.id, i.id);
      }
    }

    for (const { id } of all<{ id: string }>("SELECT id FROM messages WHERE chat_id = ? AND deleted_at IS NULL ORDER BY seq DESC LIMIT ?", chatId, s.rewind)) softDeleteMessage(id);

    if (s.runPlanner) {
      const plan = await runAdvisor(chatId);
      check("the planner ran", true, plan ? (plan.pass || plan.direction).slice(0, 120) : "no plan: the writer plans for itself");
    }
    if (s.plannerInput) {
      const { user } = await advisorInput(chatId, historyForPrompt(chatId), undefined, { ...steerFor(chatId), planner: true });
      for (const c of s.plannerInput.contains) check(`planner reads "${c.slice(0, 40)}"`, user.includes(c));
      for (const c of s.plannerInput.lacks) check(`planner doesn't read "${c.slice(0, 40)}"`, !user.includes(c));
    }
    if (s.replans != null) {
      await advisorExtra(chatId, historyForPrompt(chatId), { wait: true, state: currentFold(chatId).result.state });
      const n = one<{ n: number }>("SELECT COUNT(*) AS n FROM generations WHERE chat_id = ? AND kind = 'planner:replan'", chatId)?.n ?? 0;
      check(`${s.replans} plan${s.replans === 1 ? "" : "s"} sent back`, n === s.replans, `got ${n}`);
    }
    if (s.prompt) {
      const p = await previewPrompt(chatId);
      const text = p.messages.map((m) => m.content).join("\n");
      for (const c of s.prompt.contains) check(`prompt has "${c.slice(0, 40)}"`, text.includes(c));
      for (const c of s.prompt.lacks) check(`prompt lacks "${c.slice(0, 40)}"`, !text.includes(c));
    }

    // The bad replies first (each is the latest reply while it's graded, then goes).
    for (const b of s.bad) {
      const r = await issuesFor(chatId, b.reply);
      const missing = b.expect.filter((k) => !r.kinds.includes(k));
      check(`catches ${b.expect.join(", ")}`, !missing.length, missing.length ? `flagged ${r.kinds.join(", ") || "nothing"}` : "");
      softDeleteMessage(r.id);
    }

    let replyId: string | null = null;
    if (opts.model && (s.reply || s.forbid.length)) {
      try {
        const r = await modelReply(chatId);
        replyId = r.id;
        const issues = (await checkReply(chatId, r.id, getMessageRow(r.id)!.active_swipe, { model: false })) ?? [];
        const bad = [...new Set(issues.map((i) => i.kind))].filter((k) => s.forbid.includes(k));
        check("the model's reply is clean", !bad.length, bad.length ? `flagged ${bad.join(", ")}: ${issues.find((i) => bad.includes(i.kind))?.claim ?? ""}` : clip(r.text));
      } catch (e) {
        check("the model's reply is clean", false, (e as Error).message);
      }
    } else if (s.reply) {
      const r = await issuesFor(chatId, s.reply);
      replyId = r.id;
      const bad = r.kinds.filter((k) => s.forbid.includes(k));
      check("a good reply passes", !bad.length, bad.length ? `flagged ${bad.join(", ")}` : "");
    }

    for (const [i, l] of s.ledgerShape.entries()) {
      const parsed = linesToOps(l.lines);
      const results = parsed.ops.length ? dryRunOps(chatId, parsed.ops).results : [];
      const read = parsed.ops.length === l.lines.length && results.every((r) => r.verdict?.ok);
      check(`ledger shape ${i + 1} ${l.ok ? "reads" : "is refused"}`, read === l.ok, read === l.ok ? "" : `${parsed.ops.length}/${l.lines.length} read; ${results.filter((r) => !r.verdict?.ok).map((r) => r.verdict?.reason).join("; ")}`);
    }

    if (s.after) {
      writeEvents(chatId, { messageId: replyId ?? addMessage(chatId, "assistant", "…", { name: s.card.name }), swipeIdx: 0 }, linesToOps(s.after.lines).ops, "model");
      const st = currentFold(chatId).result.state;
      for (const e of s.after.expect) {
        const vs = pathValues(st, e.path);
        check(`${e.path} = ${JSON.stringify(e.equals)}`, vs.length > 0 && vs.every((v) => JSON.stringify(v) === JSON.stringify(e.equals)), `got ${JSON.stringify(vs).slice(0, 120)}`);
      }
      for (const p of s.after.none) {
        const vs = pathValues(st, p);
        check(`nothing at ${p}`, !vs.length, `got ${JSON.stringify(vs).slice(0, 120)}`);
      }
    }
  } finally {
    // A story check leaves nothing behind but the trash (which empties itself).
    softDeleteChat(chatId);
    sql("UPDATE characters SET deleted_at = ? WHERE id = ?", Date.now(), characterId);
    sql("UPDATE personas SET deleted_at = ? WHERE id = ?", Date.now(), personaId);
    if (book) softDeleteLorebook(book);
  }
  return { name: s.name, about: s.about, pass: checks.every((c) => c.pass), checks };
}

const clip = (s: string) => (s.length > 160 ? `${s.slice(0, 159)}…` : s);

export async function runGolden(opts: { model?: boolean } = {}) {
  const out: ScenarioResult[] = [];
  for (const s of loadScenarios()) out.push(await runScenario(s, opts));
  return { at: Date.now(), model: Boolean(opts.model), pass: out.every((r) => r.pass), results: out };
}
