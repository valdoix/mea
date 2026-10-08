import { all, now, one, parseJson, run } from "../db/db";
import { publish } from "../lib/events";
import { badRequest, notFound } from "../lib/http";
import { currentFold, linesToOps } from "../trackers/store";
import { userEdit } from "../trackers/service";
import type { AtomLedger, AtomRow } from "./atoms";
import { contentWords, overlap } from "./text";
import { touchMemory } from "./store";

/**
 * Promises (MEM-30) and secrets (MEM-31): one view over the trackers' obligations and secrets
 * and the promise and secret memories. You can mark a promise kept or broken, and a secret
 * revealed; the trackers and the memory learn it either way.
 */

export type PromiseStatus = "pending" | "kept" | "broken";

export interface PromiseEntry {
  key: string;
  source: "tracker" | "memory";
  who: string | null;
  whom: string | null;
  what: string;
  status: PromiseStatus;
  due: string | null;
  seq: number | null;
  messageId: string | null;
  kind: "promise" | "debt";
  memoryIds: string[];
  markedBy: "you" | "story" | null;
}

export interface SecretEntry {
  key: string;
  source: "tracker" | "memory";
  statement: string;
  keepers: string[];
  hiddenFrom: string[];
  knows: { name: string; status: string }[];
  revealed: { to: string[]; seq: number | null; how: string | null; messageId: string | null }[];
  truth: string | null;
  seq: number | null;
  messageId: string | null;
  memoryIds: string[];
}

function seqToMessage(chatId: string) {
  const map = new Map<number, string>();
  for (const m of all<{ id: string; seq: number }>("SELECT id, seq FROM messages WHERE chat_id = ? AND deleted_at IS NULL", chatId)) map.set(m.seq, m.id);
  return map;
}

const statusOf = (s: string): PromiseStatus => (s === "kept" || s === "paid" || s === "forgiven" ? "kept" : s === "broken" || s === "lapsed" ? "broken" : "pending");

function atomLedger(a: AtomRow): AtomLedger | null {
  return a.ledger ? parseJson<AtomLedger | null>(a.ledger, null) : null;
}

export function promises(chatId: string): PromiseEntry[] {
  const msg = seqToMessage(chatId);
  const out: PromiseEntry[] = [];
  let st: ReturnType<typeof currentFold>["result"]["state"] | null = null;
  try {
    st = currentFold(chatId).result.state;
  } catch {
    st = null;
  }
  if (st) {
    const nm = (id?: string) => (id ? (st!.chars[id]?.name ?? id) : null);
    for (const o of Object.values(st.obligations)) {
      out.push({
        key: `tracker:${o.id}`,
        source: "tracker",
        who: nm(o.who),
        whom: nm(o.whom),
        what: o.what,
        status: statusOf(o.status),
        due: o.due?.text ?? null,
        seq: o.seq,
        messageId: msg.get(o.seq) ?? null,
        kind: o.kind === "owe" ? "debt" : "promise",
        memoryIds: [],
        markedBy: o.felt ? "story" : null,
      });
    }
  }
  const atoms = all<AtomRow>("SELECT * FROM memories WHERE chat_id = ? AND type = 'promise' AND deleted_at IS NULL AND status != 'superseded' ORDER BY COALESCE(max_seq, 0)", chatId);
  for (const a of atoms) {
    const words = contentWords(a.content);
    // The same promise seen by both: the tracker row carries the memory with it.
    const twin = out.find((p) => p.source === "tracker" && overlap(words, contentWords(`${p.who ?? ""} ${p.whom ?? ""} ${p.what}`)) >= 0.3);
    if (twin) {
      twin.memoryIds.push(a.id);
      continue;
    }
    const l = atomLedger(a);
    const ents = parseJson<string[]>(a.entities, []);
    out.push({
      key: `memory:${a.id}`,
      source: "memory",
      who: l?.by ?? ents[0] ?? null,
      whom: l?.to ?? ents[1] ?? null,
      what: a.content,
      status: l?.status === "kept" || l?.status === "broken" ? l.status : a.status === "resolved" ? "kept" : "pending",
      due: null,
      seq: a.max_seq,
      messageId: a.max_seq != null ? (msg.get(a.max_seq) ?? null) : null,
      kind: "promise",
      memoryIds: [a.id],
      markedBy: l?.markedBy ?? null,
    });
  }
  return out.sort((a, b) => Number(a.status !== "pending") - Number(b.status !== "pending") || (b.seq ?? 0) - (a.seq ?? 0));
}

export function secrets(chatId: string): SecretEntry[] {
  const msg = seqToMessage(chatId);
  const out: SecretEntry[] = [];
  let st: ReturnType<typeof currentFold>["result"]["state"] | null = null;
  try {
    st = currentFold(chatId).result.state;
  } catch {
    st = null;
  }
  if (st) {
    const nm = (id: string) => st!.chars[id]?.name ?? id;
    for (const f of Object.values(st.facts)) {
      if (!f.secret) continue;
      out.push({
        key: `tracker:${f.key}`,
        source: "tracker",
        statement: f.statement,
        keepers: f.secret.keepers.map(nm),
        hiddenFrom: f.secret.from.map(nm),
        knows: Object.entries(f.stances).map(([id, s]) => ({ name: nm(id), status: s.status })),
        revealed: f.revealed.map((r) => ({ to: r.to.map(nm), seq: r.seq, how: r.how ?? null, messageId: msg.get(r.seq) ?? null })),
        truth: f.truth,
        seq: f.firstSeq,
        messageId: msg.get(f.firstSeq) ?? null,
        memoryIds: [],
      });
    }
  }
  const atoms = all<AtomRow>("SELECT * FROM memories WHERE chat_id = ? AND type = 'secret' AND deleted_at IS NULL AND status != 'superseded' ORDER BY COALESCE(max_seq, 0)", chatId);
  for (const a of atoms) {
    const words = contentWords(a.content);
    const twin = out.find((s) => s.source === "tracker" && overlap(words, contentWords(s.statement)) >= 0.3);
    if (twin) {
      twin.memoryIds.push(a.id);
      continue;
    }
    const l = atomLedger(a);
    const kb = parseJson<string[]>(a.known_by, []);
    out.push({
      key: `memory:${a.id}`,
      source: "memory",
      statement: a.content,
      keepers: kb,
      hiddenFrom: [],
      knows: kb.map((name) => ({ name, status: "knows" })),
      revealed: l?.status === "revealed" ? [{ to: l.to ? [l.to] : [], seq: l.seq ?? null, how: l.note ?? null, messageId: l.seq != null ? (msg.get(l.seq) ?? null) : null }] : [],
      truth: null,
      seq: a.max_seq,
      messageId: a.max_seq != null ? (msg.get(a.max_seq) ?? null) : null,
      memoryIds: [a.id],
    });
  }
  return out.sort((a, b) => (b.seq ?? 0) - (a.seq ?? 0));
}

function setAtomLedger(id: string, patch: Partial<AtomLedger>) {
  const a = one<AtomRow>("SELECT * FROM memories WHERE id = ?", id);
  if (!a) return;
  const cur = atomLedger(a) ?? { status: a.type === "secret" ? "secret" : "pending" };
  // Marking a ledger is your edit (MEM-27): the memory is locked against AI rewrites.
  run("UPDATE memories SET ledger = ?, user_edited = 1, updated_at = ? WHERE id = ?", JSON.stringify({ ...cur, ...patch, markedBy: "you" }), now(), id);
}

/** Mark a promise kept, broken, or pending again. */
export function markPromise(chatId: string, key: string, status: PromiseStatus) {
  const entry = promises(chatId).find((p) => p.key === key);
  if (!entry) throw notFound("Promise not found");
  if (entry.source === "tracker") {
    const word = status === "pending" ? "open" : status === "kept" ? (entry.kind === "debt" ? "paid" : "kept") : "broken";
    const line = `${entry.kind === "debt" ? "owe" : "promise"} ${entry.who ?? "?"}${entry.kind === "debt" ? " → " : ">"}${entry.whom ?? "?"}: ${entry.what} | ${word}`;
    const { ops, bad } = linesToOps([line]);
    if (bad.length || !ops.length) throw badRequest("Couldn't record that in the trackers");
    userEdit(chatId, ops);
  }
  for (const id of entry.memoryIds) setAtomLedger(id, { status });
  touchMemory(chatId);
  publish({ type: "memory.changed", chatId });
  return promises(chatId).find((p) => p.key === key) ?? null;
}

/** Mark a secret revealed to someone (and how). */
export function revealSecret(chatId: string, key: string, to: string, how?: string) {
  const entry = secrets(chatId).find((s) => s.key === key);
  if (!entry) throw notFound("Secret not found");
  const last = one<{ seq: number }>("SELECT MAX(seq) AS seq FROM messages WHERE chat_id = ? AND deleted_at IS NULL", chatId)?.seq ?? null;
  if (entry.source === "tracker") {
    const { ops, bad } = linesToOps([`reveal #${key.slice("tracker:".length)}: to ${to}${how ? ` — ${how}` : ""}`]);
    if (bad.length || !ops.length) throw badRequest("Couldn't record that in the trackers");
    userEdit(chatId, ops);
  }
  for (const id of entry.memoryIds) {
    setAtomLedger(id, { status: "revealed", to, note: how, seq: last });
    const a = one<AtomRow>("SELECT known_by FROM memories WHERE id = ?", id);
    const kb = new Set(parseJson<string[]>(a?.known_by ?? "[]", []));
    kb.add(to);
    run("UPDATE memories SET known_by = ? WHERE id = ?", JSON.stringify([...kb]), id);
  }
  touchMemory(chatId);
  publish({ type: "memory.changed", chatId });
  return secrets(chatId).find((s) => s.key === key) ?? null;
}
