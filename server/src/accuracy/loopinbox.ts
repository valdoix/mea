import { z } from "zod";
import { all, one, parseJson } from "../db/db";
import { doneMatcher, doneRecords } from "../memory/openlist";
import { levelRows, type LoopCandidate, memState, setMemState, storyRow } from "../memory/store";
import type { JobContext } from "../services/jobs";
import { callJson } from "../services/llm";
import { shouldShed } from "../services/quota";
import { openLoops } from "../trackers/loops";
import { currentFold, trackerConfig, writeEvents } from "../trackers/store";
import type { Op, WorldState } from "../trackers/types";
import { registerInboxProvider } from "./inbox";

/**
 * docs/22 1.4: a chat that started before loops has its commitments as words in old summaries. Once
 * per chat, rules find the candidates (what later records closed, what's still listed as open), a
 * helper says which really are, and the result waits in the Inbox, because it changes what the story
 * thinks is open. The closing record's own line is the evidence: a scene's model read the scene.
 */

/** How many candidates of each kind one call takes. */
const MAX = 40;
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const schema = z.object({ closed: z.array(z.coerce.number()).default([]), open: z.array(z.object({ n: z.coerce.number(), kind: z.string().default("errand") })).default([]), over: z.array(z.coerce.number()).default([]) });
/** A loop this many messages old, or a day past its time, may be over with nobody saying so. */
const OLD = 100;
const DAY = 1440;

const SYSTEM = `You sort the loose ends of a long roleplay, from its records.
C items: a record says something finished, and the open items are how it was written while it was open. List the number of each C item the record really does finish: the same thing, and it happened. Leave out one that only sounds alike, or only moved on.
O items: written down as still open. Keep each one the story expects to happen now: a promise, a plan, an errand, or a question someone owes an answer to, with its kind. Leave out moods, mysteries, running jokes and anything already over.
P items: still marked open, and old. List the number of each one that's over by now: it happened, its moment passed, or the story moved on. Leave any that could still happen.
Go by WHERE THE STORY IS NOW. When you can't tell, leave it out.
Reply with JSON only: {"closed":[1,2],"open":[{"n":1,"kind":"errand"}],"over":[1]}`;

/** What the old records hold that isn't a loop yet. Rules only. */
export function loopCandidates(chatId: string, st: WorldState) {
  const done = doneRecords(chatId, st);
  const match = doneMatcher(st, done);
  const taken = new Set(Object.values(st.loops ?? {}).flatMap((l) => l.from));
  const closed = new Map<string, LoopCandidate>();
  const open = new Map<string, LoopCandidate>();
  const close = (text: string, after: number, loop?: string) => {
    const d = match(text, after);
    if (!d) return false;
    // A loop closed it, so it's no new loop: only an open loop of another wording is left to close.
    if (d.strict && !loop) return true;
    // Named as the record that closed it: while open it was "still unsaid, due tonight", and that's what it can't go on saying.
    const c = closed.get(d.text) ?? { what: d.text, kind: "errand", seq: d.seq, how: d.text, items: [] };
    if (!c.items.includes(text)) c.items.push(text);
    if (loop) c.loop = loop;
    closed.set(d.text, c);
    return true;
  };
  // What's open today is what's listed since the Story So Far, and in it.
  const from = storyRow(chatId)?.end_seq ?? 0;
  for (const r of all<{ level: string; end_seq: number; data: string }>("SELECT level, end_seq, data FROM summaries WHERE chat_id = ? AND state = 'ready' AND end_seq IS NOT NULL ORDER BY end_seq", chatId)) {
    const d = parseJson<{ threadsOpened?: string[]; openThreads?: string[] }>(r.data, {});
    for (const text of [...(d.threadsOpened ?? []), ...(d.openThreads ?? [])]) {
      if (taken.has(text) || close(text, r.end_seq)) continue;
      if (r.level === "story" || r.end_seq > from) open.set(text, { what: text, kind: "errand", seq: r.end_seq, items: [text] });
    }
  }
  const now = st.time?.minutes;
  const last = Math.max(0, ...openLoops(st).map((l) => l.opened), ...Object.values(st.loops ?? {}).map((l) => l.closed ?? 0));
  const over: LoopCandidate[] = [];
  for (const l of openLoops(st)) {
    if (l.repeats || close(l.what, l.opened, l.id)) continue;
    const past = now != null && l.due?.minutes != null && l.due.minutes < now - DAY;
    if (past || last - l.opened > OLD) over.push({ what: l.what, kind: l.kind, seq: last, items: [l.what], loop: l.id });
  }
  return { closed: [...closed.values()].slice(-MAX), open: [...open.values()].slice(-MAX), over: over.slice(-MAX) };
}

/** Where the story stands, for telling what's over: its newest chapter. */
function latest(chatId: string) {
  const c = levelRows(chatId, "chapter").filter((r) => r.closed && r.state === "ready").at(-1);
  return c ? clip(c.content.trim(), 1500) : "";
}

/** Once per chat: what its old records say is done or open, for your word. Nothing to ask about, no call. */
export async function backfillLoops(chatId: string, job?: JobContext) {
  if (memState(chatId).loopBackfill || trackerConfig(chatId).mode === "off" || shouldShed("gates", chatId)) return;
  const c = loopCandidates(chatId, currentFold(chatId).result.state);
  if (!c.closed.length && !c.open.length && !c.over.length) {
    setMemState(chatId, { loopBackfill: { state: "done", at: Date.now(), closed: [], open: [], over: [] } });
    return;
  }
  const user = [
    `WHERE THE STORY IS NOW:\n${latest(chatId) || "(no chapter yet)"}\n`,
    ...c.closed.map((x, i) => `C${i + 1}. Record (#${x.seq}): ${clip(x.how ?? "", 200)}\n   Open items: ${x.items.slice(0, 3).map((t) => clip(t, 140)).join(" / ")}`),
    ...c.open.map((x, i) => `O${i + 1}. ${clip(x.what, 200)}`),
    ...c.over.map((x, i) => `P${i + 1}. ${clip(x.what, 200)}`),
  ].join("\n");
  const r = await callJson({ task: "helper", kind: "loops:backfill", chatId, jobId: job?.id, name: "loops_backfill", schema, system: SYSTEM, user, maxTokens: 1000 });
  const closed = r.data.closed.map((n) => c.closed[n - 1]).filter((x): x is LoopCandidate => Boolean(x));
  const open = r.data.open.flatMap((o) => {
    const x = c.open[o.n - 1];
    return x ? [{ ...x, kind: ["promise", "plan", "errand", "question"].includes(o.kind) ? o.kind : "errand" }] : [];
  });
  const over = r.data.over.map((n) => c.over[n - 1]).filter((x): x is LoopCandidate => Boolean(x));
  setMemState(chatId, { loopBackfill: { state: closed.length || open.length || over.length ? "review" : "done", at: Date.now(), closed, open, over } });
}

const line = (c: LoopCandidate) => (c.how ? `Done, #${c.seq}: ${c.what}` : c.loop ? `Over: ${c.what}` : `Open: ${c.what}`);
const everything = (p: NonNullable<ReturnType<typeof memState>["loopBackfill"]>) => [...p.closed, ...p.open, ...(p.over ?? [])];

/** Your yes: each in the ledger at the message it belongs to, under your name, so a rebuilt scene leaves it alone. */
export function applyBackfill(chatId: string, keep?: (c: LoopCandidate) => boolean) {
  const p = memState(chatId).loopBackfill;
  if (!p) return;
  const byMessage = new Map<string, Op[]>();
  for (const c of everything(p)) {
    if (keep && !keep(c)) continue;
    const at = one<{ id: string }>("SELECT id FROM messages WHERE chat_id = ? AND seq <= ? AND deleted_at IS NULL ORDER BY seq DESC LIMIT 1", chatId, c.seq);
    if (!at) continue;
    const op: Op = c.loop
      ? { op: "loop", subject: c.loop, args: c.how ? { action: "done", how: c.how } : { action: "dropped", how: "over by now" }, raw: `loop ${c.loop}: ${c.how ? `done — ${c.how}` : "dropped — over by now"}` }
      : { op: "loop", args: { action: "new", what: c.what, kind: c.kind, from: c.items, done: Boolean(c.how), how: c.how }, raw: `loop: ${c.what} | ${c.kind}` };
    byMessage.set(at.id, [...(byMessage.get(at.id) ?? []), op]);
  }
  for (const [messageId, ops] of byMessage) writeEvents(chatId, { messageId, swipeIdx: -1 }, ops, "user");
  setMemState(chatId, { loopBackfill: { ...p, state: "done" } });
}

registerInboxProvider({
  kind: "loops",
  source: "memory",
  items: (chats) =>
    chats.flatMap((c) => {
      const p = memState(c.id).loopBackfill;
      if (p?.state !== "review") return [];
      const done = p.closed.length;
      return [
        {
          key: `loops:${c.id}`,
          chatId: c.id,
          chatTitle: c.title,
          title: done ? `${done} ${done === 1 ? "thing" : "things"} the story finished` : "What the story is still waiting for",
          why: "From the story's older records. Approving these sets what the story counts as done and as still open. Take out any line that's wrong.",
          before: null,
          after: everything(p).map(line).join("\n"),
          editable: true,
          createdAt: p.at,
          link: `/chat/${c.id}/memory`,
          labels: { accept: "Apply", reject: "Not these" },
        },
      ];
    }),
  act: (id, action, edited) => {
    const p = memState(id).loopBackfill;
    if (!p) return null;
    // Not asked again, and its summaries go on saying what's open: the loops were never told the rest.
    if (action === "reject") setMemState(id, { loopBackfill: { ...p, state: "declined" } });
    else {
      const lines = edited ? new Set(edited.split("\n").map((l) => l.trim())) : null;
      applyBackfill(id, lines ? (c) => lines.has(line(c)) : undefined);
    }
    return id;
  },
});
