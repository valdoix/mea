import { z } from "zod";
import { all, newId, now, one, parseJson, run } from "../db/db";
import { publish } from "../lib/events";
import { badRequest, notFound } from "../lib/http";
import { hash } from "../sim/dice";
import { lane, registerLane } from "../prompt/lanes";
import { mustChat } from "../services/chats";
import { enqueue, type JobContext } from "../services/jobs";
import { callJson } from "../services/llm";
import { shouldShed } from "../services/quota";
import { registerStatusTile } from "../services/status";
import { registerFilingKind } from "../services/filings";
import { currentFold } from "../trackers/store";
import { registerInboxProvider } from "./inbox";
import { SLIPS } from "./slips";
import type { Found } from "./slips";

/**
 * Secrets kept off the page (Almanac plan B1). A secret can be held back from the narration
 * itself, not only from characters: words never to use yet, how the story may hint at it, and
 * when it may come out. Before the prompt is put together, memory and lore that state it are
 * reworded (by rules at once; by the helper model in the background, cached by content). The
 * [OFFPAGE] lane tells the model what to keep back and whether one hint is allowed this reply,
 * and the `offpage` check flags a reply that uses a never-say word.
 */

export type HintBudget = "never" | "rarely" | "building";
export interface RevealPlan {
  when: "never" | "say" | "after" | "exposure";
  /** "after": once the story reaches this message number… */
  afterSeq?: number;
  /** …or this story time (minutes on the clock). */
  atMinutes?: number;
  /** What was asked for, as you wrote it ("40 messages", "Day 12"). */
  text?: string;
}

interface OffpageRow {
  id: string;
  chat_id: string;
  ref: string;
  label: string;
  never_say: string;
  hint_as: string;
  hints: string;
  reveal: string;
  status: string;
  data: string;
  created_at: number;
  updated_at: number;
}

export interface OffpageData {
  /** The message number it was kept off the page at (the hint rhythm counts from here). */
  seq?: number;
  /** "Hold": ask again from this message on. */
  heldUntil?: number;
  revealedSeq?: number;
}

export interface Offpage {
  id: string;
  chatId: string;
  /** "tracker:<fact key>", "memory:<memory id>", or "" for one of your own. */
  ref: string;
  label: string;
  neverSay: string[];
  hintAs: string;
  hints: HintBudget;
  reveal: RevealPlan;
  status: "kept" | "revealed";
  data: OffpageData;
  createdAt: number;
  /** Its reveal plan has come due (and it isn't being held). */
  due?: boolean;
}

const view = (r: OffpageRow): Offpage => ({
  id: r.id,
  chatId: r.chat_id,
  ref: r.ref,
  label: r.label,
  neverSay: parseJson<string[]>(r.never_say, []),
  hintAs: r.hint_as,
  hints: r.hints as HintBudget,
  reveal: parseJson<RevealPlan>(r.reveal, { when: "say" }),
  status: r.status as Offpage["status"],
  data: parseJson<OffpageData>(r.data, {}),
  createdAt: r.created_at,
});

const curSeq = (chatId: string) => one<{ s: number | null }>("SELECT MAX(seq) AS s FROM messages WHERE chat_id = ? AND deleted_at IS NULL", chatId)?.s ?? 0;
const clockNow = (chatId: string) => {
  try {
    return currentFold(chatId).result.state.time?.minutes ?? null;
  } catch {
    return null;
  }
};
const changed = (chatId: string) => {
  publish({ type: "offpage.changed", chatId });
  publish({ type: "inbox.changed" });
};

/** B2 sets this: how full a secret's exposure clock is (0–6). */
let exposureOf: ((chatId: string, o: Offpage) => number) | null = null;
export function setExposureReader(fn: (chatId: string, o: Offpage) => number) {
  exposureOf = fn;
}

function isDue(o: Offpage, seq: number, minutes: number | null) {
  if (o.status !== "kept") return false;
  if (o.data.heldUntil != null && seq < o.data.heldUntil) return false;
  const r = o.reveal;
  if (r.when === "after") return (r.afterSeq != null && seq >= r.afterSeq) || (r.atMinutes != null && minutes != null && minutes >= r.atMinutes);
  if (r.when === "exposure") return (exposureOf?.(o.chatId, o) ?? 0) >= 6;
  return false;
}

export function listOffpage(chatId: string): Offpage[] {
  const seq = curSeq(chatId);
  const minutes = clockNow(chatId);
  return all<OffpageRow>("SELECT * FROM secrets_offpage WHERE chat_id = ? ORDER BY created_at", chatId)
    .map(view)
    .map((o) => ({ ...o, due: isDue(o, seq, minutes) }));
}
export const keptOffpage = (chatId: string) => listOffpage(chatId).filter((o) => o.status === "kept");

export function getOffpage(id: string) {
  const r = one<OffpageRow>("SELECT * FROM secrets_offpage WHERE id = ?", id);
  return r ? view(r) : undefined;
}
function mustOffpage(id: string) {
  const o = getOffpage(id);
  if (!o) throw notFound("That secret is gone");
  return o;
}

/** Never-say words: trimmed, at least two letters, each once whatever its case. */
const cleanWords = (ws: string[]) => {
  const seen = new Set<string>();
  return ws
    .map((w) => w.trim().slice(0, 60))
    .filter((w) => w.length >= 2 && !seen.has(w.toLowerCase()) && seen.add(w.toLowerCase()))
    .slice(0, 30);
};

export interface OffpageInput {
  ref?: string;
  label: string;
  neverSay?: string[];
  hintAs?: string;
  hints?: HintBudget;
  reveal?: RevealPlan;
}

/** "after N messages" becomes a message number now, so it doesn't move as the story grows. */
function planFor(chatId: string, r: RevealPlan | undefined, cur?: RevealPlan): RevealPlan {
  if (!r) return cur ?? { when: "say" };
  if (r.when !== "after") return { when: r.when };
  return { when: "after", ...(r.afterSeq != null ? { afterSeq: r.afterSeq } : {}), ...(r.atMinutes != null ? { atMinutes: r.atMinutes } : {}), ...(r.text ? { text: r.text.slice(0, 60) } : {}) };
}

export function createOffpage(chatId: string, input: OffpageInput): Offpage {
  mustChat(chatId);
  const label = input.label.trim().slice(0, 300);
  if (!label) throw badRequest("Say what the secret is");
  if (input.ref && one("SELECT 1 FROM secrets_offpage WHERE chat_id = ? AND ref = ? AND status = 'kept'", chatId, input.ref)) throw badRequest("That secret is already kept off the page");
  const id = newId();
  const t = now();
  run(
    "INSERT INTO secrets_offpage (id, chat_id, ref, label, never_say, hint_as, hints, reveal, status, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'kept', ?, ?, ?)",
    id,
    chatId,
    input.ref ?? "",
    label,
    JSON.stringify(cleanWords(input.neverSay ?? [])),
    (input.hintAs ?? "").trim().slice(0, 300),
    input.hints ?? "rarely",
    JSON.stringify(planFor(chatId, input.reveal)),
    JSON.stringify({ seq: curSeq(chatId) } satisfies OffpageData),
    t,
    t,
  );
  changed(chatId);
  return getOffpage(id)!;
}

export function updateOffpage(id: string, patch: Partial<OffpageInput> & { status?: "kept" | "revealed" }): Offpage {
  const o = mustOffpage(id);
  const data: OffpageData = { ...o.data };
  if (patch.status === "revealed" && o.status !== "revealed") data.revealedSeq = curSeq(o.chatId);
  if (patch.status === "kept" && o.status === "revealed") delete data.revealedSeq;
  run(
    "UPDATE secrets_offpage SET label = ?, never_say = ?, hint_as = ?, hints = ?, reveal = ?, status = ?, data = ?, updated_at = ? WHERE id = ?",
    patch.label?.trim().slice(0, 300) || o.label,
    JSON.stringify(patch.neverSay ? cleanWords(patch.neverSay) : o.neverSay),
    patch.hintAs != null ? patch.hintAs.trim().slice(0, 300) : o.hintAs,
    patch.hints ?? o.hints,
    JSON.stringify(planFor(o.chatId, patch.reveal, o.reveal)),
    patch.status ?? o.status,
    JSON.stringify(data),
    now(),
    id,
  );
  changed(o.chatId);
  return getOffpage(id)!;
}

/** "Never say this": one more word for a secret. */
export function addNeverSay(id: string, word: string) {
  const o = mustOffpage(id);
  return updateOffpage(id, { neverSay: [...o.neverSay, word] });
}

export function deleteOffpage(id: string) {
  const o = mustOffpage(id);
  run("DELETE FROM secrets_offpage WHERE id = ?", id);
  changed(o.chatId);
}

/** "Reveal now": it may come out on the page; nothing is reworded or flagged any more. */
export const revealOffpage = (id: string) => updateOffpage(id, { status: "revealed" });

/** "Hold": not yet; ask again in ten messages. */
export function holdOffpage(id: string) {
  const o = mustOffpage(id);
  run("UPDATE secrets_offpage SET data = ?, updated_at = ? WHERE id = ?", JSON.stringify({ ...o.data, heldUntil: curSeq(o.chatId) + 10 }), now(), id);
  changed(o.chatId);
  return getOffpage(id)!;
}

// ---------- matching and rewording ----------

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const wordRe = (w: string) => new RegExp(`(?<![\\p{L}\\p{N}])${esc(w.trim()).replace(/\s+/g, "\\s+")}(?![\\p{L}\\p{N}])`, "iu");
const sentences = (t: string) => t.match(/[^.!?…\n]+(?:[.!?…]+["”')\]*]*)?|\n+/g) ?? [];

/** The never-say words a text uses, per secret. */
export function neverSaid(text: string, list: Offpage[]): { secret: Offpage; word: string }[] {
  const out: { secret: Offpage; word: string }[] = [];
  for (const o of list) for (const w of o.neverSay) if (wordRe(w).test(text)) out.push({ secret: o, word: w });
  return out;
}

/** The rule rewording: sentences that use a never-say word are left out (whole lines that empty are dropped). */
export function redact(text: string, list: Offpage[]): string {
  if (!list.some((o) => o.neverSay.length)) return text;
  const res = list.flatMap((o) => o.neverSay.map(wordRe));
  return sentences(text)
    .filter((s) => !res.some((re) => re.test(s)))
    .join("")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const signature = (list: Offpage[]) => list.map((o) => `${o.id}:${o.label}:${o.neverSay.join(",")}`).join("|");
const cacheKey = (text: string, list: Offpage[]) => `${hash(text)}-${hash(signature(list))}-${text.length}`;

export interface Reworded {
  where: string;
  before: string;
  after: string;
  by: "rules" | "model";
}

/**
 * The filter memory and lore go through before the prompt: a block that uses a never-say word is
 * reworded (the helper's cached version if there is one; the rules' otherwise, and the helper is
 * asked in the background for next time). Returns null when nothing is kept off the page.
 */
export function offpageFilter(chatId: string): ((text: string, where: string) => string) & { reworded: Reworded[] } | null {
  const list = keptOffpage(chatId).filter((o) => o.neverSay.length);
  if (!list.length) return null;
  const reworded: Reworded[] = [];
  const fn = Object.assign(
    (text: string, where: string) => {
      if (!text || !neverSaid(text, list).length) return text;
      const key = cacheKey(text, list);
      const cached = one<{ text: string }>("SELECT text FROM offpage_cache WHERE key = ?", key)?.text;
      // A cached rewording that still slips is not trusted.
      const after = cached != null && !neverSaid(cached, list).length ? cached : redact(text, list);
      if (cached == null) enqueue("offpage.reword", { chatId, key, text: text.slice(0, 12_000) }, { chatId, dedupeKey: `offpage.reword:${key}`, delayMs: 500 });
      reworded.push({ where, before: text.slice(0, 1500), after: after.slice(0, 1500), by: cached != null && after === cached ? "model" : "rules" });
      return after;
    },
    { reworded },
  );
  return fn;
}

const rewordSchema = z.object({ text: z.string() });

/** The helper's rewording of one block, cached for every prompt that holds the same text. */
export async function runRewordJob(p: { chatId: string; key: string; text: string }, job?: JobContext) {
  if (one("SELECT 1 FROM offpage_cache WHERE key = ?", p.key)) return;
  const list = keptOffpage(p.chatId).filter((o) => o.neverSay.length);
  if (!list.length || shouldShed("offpage", p.chatId)) return;
  const r = await callJson({
    task: "helper",
    kind: "offpage",
    chatId: p.chatId,
    jobId: job?.id,
    name: "offpage_reword",
    schema: rewordSchema,
    system: `You edit a story's memory notes so they keep secrets off the page. Rewrite the text so it neither states nor names these secrets, and never uses the listed words; keep everything else exactly as it is (same facts, same order, same voice). Where a sentence only exists to state a secret, leave it out. Reply with JSON only: {"text": "…"}`,
    user: `SECRETS KEPT OFF THE PAGE:\n${list.map((o) => `- ${o.label} (never say: ${o.neverSay.join(", ")})`).join("\n")}\n\nTEXT:\n${p.text}`,
    maxTokens: Math.min(4000, Math.ceil(p.text.length / 2.5) + 200),
  });
  const text = r.data.text.trim();
  // Only a rewording that really keeps the words out is kept.
  if (!text || neverSaid(text, list).length) return;
  run("INSERT OR REPLACE INTO offpage_cache (key, chat_id, text, created_at) VALUES (?, ?, ?, ?)", p.key, p.chatId, text, now());
}

// ---------- the hint budget and the [OFFPAGE] lane ----------

/**
 * Whether one hint is allowed in the reply at `seq`. Deterministic, so every swipe of a reply
 * agrees: "rarely" every 15 messages, "slowly building" every 10 at first, then more often
 * (down to every 3) as the story goes on.
 */
export function hintAllowed(o: Offpage, seq: number): boolean {
  if (o.hints === "never" || !o.hintAs.trim()) return false;
  const from = o.data.seq ?? 0;
  const since = Math.max(0, seq - from);
  const every = o.hints === "rarely" ? 15 : Math.max(3, 10 - Math.floor(since / 25));
  return since > 0 && since % every === 0;
}

registerLane("offpage", (ctx) => {
  if (ctx.kind !== "story" && ctx.kind !== "continue") return null;
  const list = keptOffpage(ctx.chatId);
  if (!list.length) return null;
  const seq = curSeq(ctx.chatId) + (ctx.kind === "story" && !ctx.excludeMessageId ? 1 : 0);
  const lines = list.map((o) => {
    const hint = hintAllowed(o, seq) ? ` One hint is allowed in this reply, only as: "${o.hintAs}" (subtle, deniable; the characters may still not know).` : o.hints === "never" || !o.hintAs ? " No hints." : " No hint in this reply.";
    return `- ${o.label}${o.neverSay.length ? ` Never say: ${o.neverSay.map((w) => `"${w}"`).join(", ")}.` : ""}${hint}`;
  });
  return lane("offpage", null, `These stay off the page for now: the narration must not state them, and no character may say them unless the story already showed they know.\n${lines.join("\n")}`, { depth: 1 });
});

// ---------- the check ----------

SLIPS.push({
  id: "offpage",
  label: "Off-page words",
  description: "A reply using a word you keep off the page.",
  phase: "reply",
  on: (c) => c.role === "assistant",
  run: (text, _s, c) => {
    const list = keptOffpage(c.chatId).filter((o) => o.neverSay.length);
    if (!list.length) return [];
    const out: Found[] = [];
    for (const s of sentences(text)) {
      const hits = neverSaid(s, list);
      if (!hits.length) continue;
      const h = hits[0]!;
      out.push({
        kind: "offpage",
        severity: "major",
        claim: s.trim(),
        conflict: `This names a secret kept off the page: “${h.secret.label}” (never say “${h.word}” yet).`,
        citations: [{ ref: "S", type: "secret", label: h.secret.label.slice(0, 120), id: h.secret.id }],
        fix: `Don't say "${h.word}" or state the secret yet${h.secret.hintAs ? `; at most hint at it, as "${h.secret.hintAs}"` : ""}.`,
        by: "rules",
      });
    }
    return out;
  },
});

// ---------- reveal plans: a card when one comes due ----------

registerInboxProvider({
  kind: "offpage",
  source: "secret",
  items: (chats) =>
    chats.flatMap((c) =>
      listOffpage(c.id)
        .filter((o) => o.due)
        .map((o) => ({
          key: `offpage:${o.id}`,
          chatId: c.id,
          chatTitle: "",
          title: "A secret is ready to come out",
          why: o.reveal.when === "exposure" ? "Its exposure clock is full. It comes out on the page, in a scene, only if you let it." : `Its reveal plan came due${o.reveal.text ? ` (${o.reveal.text})` : ""}. Approve to let it come out on the page; reject to hold it a while longer.`,
          before: null,
          after: o.label,
          editable: false,
          createdAt: 0,
          link: `/chat/${c.id}/codex?tab=ledgers`,
        })),
    ),
  act: (id, action) => {
    const o = mustOffpage(id);
    if (action === "accept") revealOffpage(id);
    else holdOffpage(id);
    return o.chatId;
  },
});

registerStatusTile((chatId) => {
  const list = keptOffpage(chatId);
  if (!list.length) return null;
  const due = list.filter((o) => o.due).length;
  return due
    ? { id: "offpage", n: due, label: `secret${due === 1 ? "" : "s"} ready to come out`, tone: "amber", open: { inbox: "secret" }, order: 30, title: "Reveal now, or hold" }
    : { id: "offpage", n: 0, value: String(list.length), label: `kept off the page`, tone: "blue", open: { dock: "story", section: "offpage" }, order: 30 };
});

// "Keep off the page" from a selection files a chip on the message; Undo deletes the secret.
registerFilingKind("offpage", {
  undo: (f) => {
    const id = String(f.data.offpageId ?? "");
    if (getOffpage(id)) deleteOffpage(id);
  },
});
registerFilingKind("neversay", {
  undo: (f) => {
    const o = getOffpage(String(f.data.offpageId ?? ""));
    const word = String(f.data.word ?? "");
    if (o) updateOffpage(o.id, { neverSay: o.neverSay.filter((w) => w.toLowerCase() !== word.toLowerCase()) });
  },
});
