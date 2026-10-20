import { all, newId, now, one, parseJson, run, tx } from "../db/db";
import { publish } from "../lib/events";
import { badRequest, notFound } from "../lib/http";
import { shortHash } from "../creator/smarts";
import { stashRestore } from "../services/undo";
import { durationIn, isSingleSlot, slotDef } from "./slots";

/**
 * Living lore (docs/15, part 1): facts on lorebook entries. An entry keeps its written core and
 * gains small, exact, dated statements: *Eyes: grey*, *Can't swim*, *Lives at the inn at Saltpans*.
 *
 * A canon fact (no chat) holds in every chat. A story fact belongs to one chat and, like the
 * tracker events and the memories made from them, to the message and swipe it came from: swipe,
 * delete or rewind that message and the fact is gone from the story; swipe back and it returns.
 * `swipe_idx` -1 means whichever swipe of the message is shown (facts you add yourself).
 */

export type FactKind = "attribute" | "never" | "state" | "event" | "habit" | "voice" | "bond";
export type FactOrigin = "card" | "studio" | "you" | "story" | "tracker" | "invented";
export type FactStatus = "active" | "superseded" | "disputed" | "invented";
export const FACT_KINDS: FactKind[] = ["attribute", "never", "state", "event", "habit", "voice", "bond"];
export const FACT_ORIGINS: FactOrigin[] = ["card", "studio", "you", "story", "tracker", "invented"];

interface FactRow {
  id: string;
  entry_id: string;
  chat_id: string | null;
  slot: string | null;
  value: string;
  kind: FactKind;
  since_seq: number | null;
  until_seq: number | null;
  since_time: number | null;
  until_time: number | null;
  message_id: string | null;
  swipe_idx: number;
  origin: FactOrigin;
  locked: number;
  status: FactStatus;
  superseded_by: string | null;
  replaces: string | null;
  basis: string | null;
  until_message_id: string | null;
  until_swipe: number | null;
  expects_minutes: number | null;
  source: string | null;
  known_by: string;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

/** A row with where its message stands now (null when it has none, or it's gone). */
type Joined = FactRow & { m_seq: number | null; m_swipe: number | null; m_deleted: number | null; m_chat: string | null; m_text?: string | null; u_seq?: number | null; u_swipe?: number | null; u_deleted?: number | null };

export interface LoreFact {
  id: string;
  entryId: string;
  chatId: string | null;
  slot: string | null;
  value: string;
  kind: FactKind;
  /** The message number it holds from (null: from the start). */
  sinceSeq: number | null;
  /** The message number it stops at (retired); null while it holds. */
  untilSeq: number | null;
  sinceTime: number | null;
  /** 5.2: how long it's expected to last on the story's clock (null: until the story says). */
  expectsMinutes: number | null;
  untilTime: number | null;
  messageId: string | null;
  swipeIdx: number;
  origin: FactOrigin;
  locked: boolean;
  status: FactStatus;
  supersededBy: string | null;
  /** The fact this one replaced. */
  replaces: string | null;
  /** 8.1: a canon fact made from a story fact: the chat, message and number it came from. */
  source: { chatId: string; messageId: string | null; seq: number | null } | null;
  knownBy: string[];
  createdAt: number;
  updatedAt: number;
  /** True at the message it was read at, on the branch shown now. */
  now: boolean;
  /** 2.3: the message it was read from was edited since; it needs a re-check. */
  stale: boolean;
}

const view = (r: Joined, nowAt: boolean, seq?: number | null): LoreFact => ({
  id: r.id,
  entryId: r.entry_id,
  chatId: r.chat_id,
  slot: r.slot,
  value: r.value,
  kind: r.kind,
  sinceSeq: seq ?? r.since_seq,
  untilSeq: r.until_message_id ? (r.u_seq ?? null) : r.until_seq,
  sinceTime: r.since_time,
  expectsMinutes: r.expects_minutes ?? null,
  untilTime: r.until_time,
  messageId: r.message_id,
  swipeIdx: r.swipe_idx,
  origin: r.origin,
  locked: Boolean(r.locked),
  status: r.status,
  supersededBy: r.superseded_by,
  replaces: r.replaces,
  source: r.source ? parseJson<{ chatId: string; messageId: string | null; seq: number | null } | null>(r.source, null) : null,
  knownBy: parseJson<string[]>(r.known_by, []),
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  now: nowAt,
  stale: Boolean(r.basis && r.m_text != null && textBasis(r.m_text) !== r.basis),
});

/** The fingerprint of a fact's source text (2.3). */
export const textBasis = (text: string) => shortHash(text.replace(/\s+/g, " ").trim());

const changed = (entryId: string, chatId: string | null) => publish({ type: "lore.facts", entryId, chatId });

/**
 * Whether a fact's message is on the branch the chat shows: the message is there and not deleted,
 * and the fact came from the swipe shown (or from any, at -1). The same test the tracker events
 * use (`branchEvents`), so lore and the trackers never disagree about what happened.
 */
const onPath = (r: Joined) => !r.message_id || (r.m_seq != null && r.m_deleted == null && (r.swipe_idx === -1 || r.swipe_idx === r.m_swipe));
/** Where the fact starts: its message's number as it is now (rewinds renumber nothing, but be safe). */
const sinceOf = (r: Joined) => (r.message_id ? r.m_seq : r.since_seq);

const SELECT = `SELECT f.*, m.seq AS m_seq, m.active_swipe AS m_swipe, m.deleted_at AS m_deleted, m.chat_id AS m_chat,
  CASE WHEN f.basis IS NULL THEN NULL ELSE (SELECT s.content FROM swipes s WHERE s.message_id = f.message_id AND s.idx = CASE WHEN f.swipe_idx = -1 THEN m.active_swipe ELSE f.swipe_idx END) END AS m_text
  , u.seq AS u_seq, u.active_swipe AS u_swipe, u.deleted_at AS u_deleted
  FROM lore_facts f LEFT JOIN messages m ON m.id = f.message_id LEFT JOIN messages u ON u.id = f.until_message_id`;

function rowsFor(entryIds: string[], chatId: string | null | undefined): Joined[] {
  if (!entryIds.length) return [];
  const ids = entryIds.map(() => "?").join(",");
  const scope = chatId === undefined ? "" : chatId === null ? "AND f.chat_id IS NULL" : "AND (f.chat_id IS NULL OR f.chat_id = ?)";
  return all<Joined>(`${SELECT} WHERE f.entry_id IN (${ids}) AND f.deleted_at IS NULL ${scope} ORDER BY f.created_at, f.rowid`, ...entryIds, ...(chatId ? [chatId] : []));
}

/** The newest message number in a chat (on any branch: seqs are shared by the swipes of a message). */
export const latestSeq = (chatId: string) => one<{ s: number | null }>("SELECT MAX(seq) AS s FROM messages WHERE chat_id = ? AND deleted_at IS NULL", chatId)?.s ?? 0;

/**
 * Sorts rows into what's true at `seq` on the current branch. A fact holds when its message is
 * on the branch, it started by `seq`, it wasn't retired by then, and no fact that replaced it is
 * (yet) on the branch. So a replaced fact holds again when its replacement's swipe is swiped away,
 * and a chat's change to a canon fact hides it in that chat only.
 */
function resolve(rows: Joined[], seq: number) {
  const visible = (r: Joined) => onPath(r) && (sinceOf(r) ?? 0) <= seq;
  const replaced = new Set(rows.filter((r) => r.replaces && visible(r)).map((r) => r.replaces!));
  const holds = (r: Joined): boolean => {
    if (!visible(r) || replaced.has(r.id)) return false;
    // Superseded within its own scope, and the replacement isn't here: it still holds.
    if (r.status === "superseded") return true;
    // Ended at a message: only on that message's branch, from there on.
    if (r.until_message_id) return !(r.u_seq != null && r.u_deleted == null && (r.until_swipe == null || r.until_swipe === -1 || r.until_swipe === r.u_swipe) && r.u_seq <= seq);
    return r.until_seq == null || seq < r.until_seq;
  };
  // 8.1: in a chat, its own value for a single slot (eyes, age…) wins over the canon one.
  const own = new Set(rows.filter((r) => r.chat_id && r.slot && isSingleSlot(r.slot) && holds(r)).map((r) => r.slot!));
  return rows.map((r) => ({ r, now: holds(r) && !(!r.chat_id && r.slot && own.has(r.slot)), shown: onPath(r) }));
}

/**
 * The facts true now for each entry: in this chat (and canon), at message `seq` (default: after the
 * newest message), on the branch shown. One query for any number of entries.
 */
export function factsNowFor(entryIds: string[], chatId: string | null, seq?: number): Map<string, LoreFact[]> {
  const at = seq ?? (chatId ? latestSeq(chatId) + 1 : Number.MAX_SAFE_INTEGER);
  const out = new Map<string, LoreFact[]>();
  for (const { r, now: holds } of resolve(rowsFor(entryIds, chatId), at)) {
    if (!holds || r.status === "disputed") continue;
    if (!out.has(r.entry_id)) out.set(r.entry_id, []);
    out.get(r.entry_id)!.push(view(r, true, sinceOf(r)));
  }
  return out;
}

export function factsNow(entryId: string, chatId: string | null, seq?: number): LoreFact[] {
  return factsNowFor([entryId], chatId, seq).get(entryId) ?? [];
}

/**
 * Every fact on an entry, for the editor and the Codex: now and history. With a chat, its facts and
 * canon; without one, canon and every chat's (each judged at its own chat's newest message). Facts
 * from a branch that isn't shown are left out (they come back with their swipe).
 */
export function listFacts(entryId: string, opts: { chatId?: string | null; seq?: number } = {}): LoreFact[] {
  const rows = rowsFor([entryId], opts.chatId ?? undefined);
  const groups = new Map<string, Joined[]>();
  for (const r of rows) {
    const k = r.chat_id ?? "";
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(r);
  }
  const canon = groups.get("") ?? [];
  const out: LoreFact[] = [];
  const add = (set: Joined[], at: number, only?: (r: Joined) => boolean) => {
    for (const x of resolve(set, at)) if (x.shown && (!only || only(x.r))) out.push(view(x.r, x.now, sinceOf(x.r)));
  };
  if (opts.chatId) add(rows, opts.seq ?? latestSeq(opts.chatId) + 1);
  else {
    add(canon, Number.MAX_SAFE_INTEGER);
    for (const [k, set] of groups) if (k) add([...canon, ...set], latestSeq(k) + 1, (r) => r.chat_id === k);
  }
  return out;
}

export function getFact(id: string): LoreFact | undefined {
  const r = one<Joined>(`${SELECT} WHERE f.id = ?`, id);
  return r ? view(r, onPath(r) && r.status !== "superseded" && r.until_seq == null && !r.until_message_id, sinceOf(r)) : undefined;
}

const rawRow = (id: string) => one<FactRow>("SELECT * FROM lore_facts WHERE id = ?", id);

/** A way to put rows back as they are now (and drop ones that aren't there yet), for Undo. */
function snapshot(ids: string[]) {
  const before = ids.map((id) => ({ id, row: rawRow(id) ?? null }));
  return () => {
    for (const { id, row } of before) {
      if (!row) {
        run("DELETE FROM lore_facts WHERE id = ?", id);
        continue;
      }
      const cols = Object.keys(row);
      run(`INSERT OR REPLACE INTO lore_facts (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`, ...(cols.map((c) => (row as unknown as Record<string, unknown>)[c]) as never[]));
    }
  };
}

/** The token for an Undo that puts the facts back as they are now. */
function undoable(label: string, ids: string[], entryId: string, chatId: string | null) {
  const back = snapshot(ids);
  return stashRestore(label, () => {
    back();
    changed(entryId, chatId);
  });
}

export interface FactInput {
  value: string;
  slot?: string | null;
  kind?: FactKind;
  /** A story fact's chat. Canon (every chat) when left out and there's no message. */
  chatId?: string | null;
  /** Where it came from: the fact holds from this message on, on this message's branch. */
  messageId?: string | null;
  /** Which swipe of the message (default: -1 for facts you make, the shown one for story-made ones). */
  swipeIdx?: number;
  origin?: FactOrigin;
  locked?: boolean;
  knownBy?: string[];
  sinceTime?: number | null;
  /** 5.2: how long it lasts (default: read from the words for a state, "about six weeks"). */
  expectsMinutes?: number | null;
  status?: FactStatus;
}

const cleanValue = (v: string) => v.replace(/\s+/g, " ").trim().slice(0, 500);
const cleanSlot = (s: string | null | undefined) => (s ? s.replace(/\s+/g, " ").trim().toLowerCase().slice(0, 60) || null : null);
const cleanNames = (xs: string[] | undefined) => [...new Set((xs ?? []).map((x) => x.trim()).filter(Boolean))].slice(0, 20);

function insertFact(entryId: string, f: FactInput): string {
  const value = cleanValue(f.value);
  if (!value) throw badRequest("Say what the fact is");
  if (!one("SELECT 1 FROM lorebook_entries WHERE id = ?", entryId)) throw notFound("Entry not found");
  const msg = f.messageId ? one<{ chat_id: string; seq: number; active_swipe: number; deleted_at: number | null }>("SELECT chat_id, seq, active_swipe, deleted_at FROM messages WHERE id = ?", f.messageId) : undefined;
  if (f.messageId && (!msg || msg.deleted_at)) throw badRequest("That message is gone");
  if (msg && f.chatId && msg.chat_id !== f.chatId) throw badRequest("That message isn't in this chat");
  const chatId = msg?.chat_id ?? f.chatId ?? null;
  if (chatId && !one("SELECT 1 FROM chats WHERE id = ?", chatId)) throw notFound("Chat not found");
  const origin = f.origin ?? "you";
  const swipe = f.swipeIdx ?? (msg && (origin === "story" || origin === "tracker") ? msg.active_swipe : -1);
  const kind = f.kind && FACT_KINDS.includes(f.kind) ? f.kind : "attribute";
  const id = newId();
  const t = now();
  run(
    `INSERT INTO lore_facts (id, entry_id, chat_id, slot, value, kind, since_seq, since_time, message_id, swipe_idx, origin, locked, status, known_by, basis, expects_minutes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    entryId,
    chatId,
    cleanSlot(f.slot),
    value,
    kind,
    msg?.seq ?? null,
    f.sinceTime ?? null,
    f.messageId ?? null,
    swipe,
    origin,
    f.locked ? 1 : 0,
    f.status ?? (origin === "invented" ? "invented" : "active"),
    JSON.stringify(cleanNames(f.knownBy)),
    // Facts read from a message's words remember them, so an edit there asks for a re-check (2.3).
    msg && origin === "story" ? textBasis(one<{ content: string }>("SELECT content FROM swipes WHERE message_id = ? AND idx = ?", f.messageId!, swipe === -1 ? msg.active_swipe : swipe)?.content ?? "") : null,
    f.expectsMinutes !== undefined ? f.expectsMinutes : kind === "state" ? durationIn(value) : null,
    t,
    t,
  );
  return id;
}

/** Adds a fact. Returns it, with the token for its Undo. */
export function createFact(entryId: string, f: FactInput) {
  const id = insertFact(entryId, f);
  const fact = getFact(id)!;
  const undo = stashRestore("Fact", () => {
    run("DELETE FROM lore_facts WHERE id = ?", id);
    changed(entryId, fact.chatId);
  });
  changed(entryId, fact.chatId);
  return { fact, undo };
}

function mustFact(id: string) {
  const r = rawRow(id);
  if (!r || r.deleted_at) throw notFound("Fact not found");
  return r;
}

/**
 * 3.1: adds a fact, and when its slot holds one value at a time (eyes, age…) and already has one
 * here, the new value supersedes it instead (kept in History). List slots (likes, scars) just add.
 */
export function addFact(entryId: string, f: FactInput) {
  const slot = cleanSlot(f.slot);
  const kind = f.kind ?? slotDef(slot)?.kind;
  if (slot && isSingleSlot(slot)) {
    const chatId = f.chatId ?? (f.messageId ? (one<{ chat_id: string }>("SELECT chat_id FROM messages WHERE id = ?", f.messageId)?.chat_id ?? null) : null);
    const cur = factsNow(entryId, chatId).find((x) => x.slot === slot && (chatId || !x.chatId));
    if (cur && !cur.locked) {
      const r = supersedeFact(cur.id, { ...f, slot, kind, chatId });
      return { fact: r.fact, undo: r.undo, replaced: r.old };
    }
  }
  return { ...createFact(entryId, { ...f, slot, kind }), replaced: null };
}

/** Changes a fact in place (its words, slot, kind, keepers, or lock). A locked fact's words need `force`. */
export function updateFact(id: string, patch: { value?: string; slot?: string | null; kind?: FactKind; locked?: boolean; knownBy?: string[]; status?: FactStatus }, opts: { force?: boolean } = {}) {
  const r = mustFact(id);
  if (r.locked && !opts.force && patch.value !== undefined && cleanValue(patch.value) !== r.value) throw badRequest("This fact is locked; unlock it to change it");
  const undo = undoable("Fact", [id], r.entry_id, r.chat_id);
  const value = patch.value !== undefined ? cleanValue(patch.value) : r.value;
  if (!value) throw badRequest("Say what the fact is");
  run(
    "UPDATE lore_facts SET value = ?, slot = ?, kind = ?, locked = ?, known_by = ?, status = ?, updated_at = ? WHERE id = ?",
    value,
    patch.slot !== undefined ? cleanSlot(patch.slot) : r.slot,
    patch.kind && FACT_KINDS.includes(patch.kind) ? patch.kind : r.kind,
    patch.locked === undefined ? r.locked : patch.locked ? 1 : 0,
    patch.knownBy ? JSON.stringify(cleanNames(patch.knownBy)) : r.known_by,
    patch.status ?? r.status,
    now(),
    id,
  );
  changed(r.entry_id, r.chat_id);
  return { fact: getFact(id)!, undo };
}

/**
 * Retires a fact: it stops holding after `atSeq` (default: now, the chat's newest message) and stays
 * in History. A canon fact retires everywhere.
 */
export function retireFact(id: string, opts: { chatId?: string | null; atSeq?: number; /** The story ended it here: on this message's branch only. */ atMessageId?: string; swipeIdx?: number } = {}) {
  const r = mustFact(id);
  if (r.until_seq != null || r.until_message_id) throw badRequest("This fact is already retired");
  const chatId = r.chat_id ?? opts.chatId ?? null;
  const undo = undoable("Retired fact", [id], r.entry_id, r.chat_id);
  if (opts.atMessageId) {
    const m = one<{ active_swipe: number }>("SELECT active_swipe FROM messages WHERE id = ?", opts.atMessageId);
    run("UPDATE lore_facts SET until_message_id = ?, until_swipe = ?, updated_at = ? WHERE id = ?", opts.atMessageId, opts.swipeIdx ?? m?.active_swipe ?? -1, now(), id);
  } else {
    const until = opts.atSeq ?? (r.chat_id ? latestSeq(r.chat_id) + 1 : 0);
    run("UPDATE lore_facts SET until_seq = ?, updated_at = ? WHERE id = ?", until, now(), id);
  }
  changed(r.entry_id, chatId);
  return { fact: getFact(id)!, undo };
}

/**
 * A new value for a fact: the new one holds from its message on, the old one is kept in History
 * (and holds again if the new one's swipe is swiped away). Locked facts need `force`.
 */
export function supersedeFact(id: string, next: Omit<FactInput, "chatId"> & { chatId?: string | null }, opts: { force?: boolean } = {}) {
  const r = mustFact(id);
  if (r.locked && !opts.force) throw badRequest("This fact is locked; unlock it to change it");
  const back = snapshot([id]);
  const made = tx(() => {
    const made = insertFact(r.entry_id, { slot: r.slot, kind: r.kind, knownBy: parseJson<string[]>(r.known_by, []), ...next, chatId: next.chatId ?? r.chat_id });
    run("UPDATE lore_facts SET replaces = ? WHERE id = ?", id, made);
    // In its own scope the old one is marked replaced; a canon fact changed in one chat stays canon for the rest.
    if (rawRow(made)!.chat_id === r.chat_id) run("UPDATE lore_facts SET status = 'superseded', superseded_by = ?, updated_at = ? WHERE id = ?", made, now(), id);
    return made;
  });
  const undo = stashRestore("Changed fact", () => {
    run("DELETE FROM lore_facts WHERE id = ?", made);
    back();
    changed(r.entry_id, r.chat_id);
  });
  changed(r.entry_id, r.chat_id);
  return { fact: getFact(made)!, old: getFact(id)!, undo };
}

/** 2.3: a fact whose source message was edited still holds: it now reads from the edited text. */
export function confirmFact(id: string) {
  const r = mustFact(id);
  const m = r.message_id ? one<{ active_swipe: number }>("SELECT active_swipe FROM messages WHERE id = ?", r.message_id) : undefined;
  const text = m ? (one<{ content: string }>("SELECT content FROM swipes WHERE message_id = ? AND idx = ?", r.message_id!, r.swipe_idx === -1 ? m.active_swipe : r.swipe_idx)?.content ?? "") : "";
  run("UPDATE lore_facts SET basis = ?, updated_at = ? WHERE id = ?", m ? textBasis(text) : null, now(), id);
  changed(r.entry_id, r.chat_id);
  return getFact(id)!;
}

/**
 * 8.1 "Make it canon": a story fact holds in every chat from now on. It moves to `toEntryId` (the
 * companion or world book's entry for the same person, place or thing; default: where it is),
 * keeping where it came from (its chat, message and number) as provenance. A canon fact it had
 * replaced in that chat is replaced everywhere now (kept in History).
 */
export function promoteFact(id: string, toEntryId?: string) {
  const r = mustFact(id);
  if (!r.chat_id) throw badRequest("This fact is canon already");
  const target = toEntryId ?? r.entry_id;
  if (!one("SELECT 1 FROM lorebook_entries WHERE id = ?", target)) throw notFound("Entry not found");
  const seq = r.message_id ? one<{ seq: number }>("SELECT seq FROM messages WHERE id = ?", r.message_id)?.seq : null;
  const back = snapshot([id, ...(r.replaces ? [r.replaces] : [])]);
  tx(() => {
    run(
      "UPDATE lore_facts SET chat_id = NULL, entry_id = ?, message_id = NULL, swipe_idx = -1, since_seq = NULL, until_seq = NULL, until_message_id = NULL, basis = NULL, source = ?, updated_at = ? WHERE id = ?",
      target,
      JSON.stringify({ chatId: r.chat_id, messageId: r.message_id, seq: seq ?? r.since_seq }),
      now(),
      id,
    );
    if (r.replaces) run("UPDATE lore_facts SET status = 'superseded', superseded_by = ?, updated_at = ? WHERE id = ? AND chat_id IS NULL", id, now(), r.replaces);
  });
  const undo = stashRestore("Made canon", () => {
    back();
    changed(r.entry_id, r.chat_id);
    changed(target, null);
  });
  changed(r.entry_id, r.chat_id);
  changed(target, null);
  return { fact: getFact(id)!, undo };
}

/**
 * 8.1 "Only in this chat": a chat's own version of a canon fact (the same, or `value`), which wins
 * in this chat and leaves every other chat with the canon one.
 */
export function overrideFact(id: string, chatId: string, value?: string) {
  const r = mustFact(id);
  if (r.chat_id) throw badRequest("This fact already belongs to one chat");
  if (!one("SELECT 1 FROM chats WHERE id = ?", chatId)) throw notFound("Chat not found");
  const latest = one<{ id: string }>("SELECT id FROM messages WHERE chat_id = ? AND deleted_at IS NULL ORDER BY seq DESC LIMIT 1", chatId)?.id ?? null;
  const made = insertFact(r.entry_id, { value: value?.trim() || r.value, slot: r.slot, kind: r.kind, chatId, messageId: latest, origin: "you", knownBy: parseJson<string[]>(r.known_by, []) });
  run("UPDATE lore_facts SET replaces = ? WHERE id = ?", id, made);
  const undo = stashRestore("Only in this chat", () => {
    run("DELETE FROM lore_facts WHERE id = ?", made);
    changed(r.entry_id, chatId);
  });
  changed(r.entry_id, chatId);
  return { fact: getFact(made)!, undo };
}

/** Deletes a fact (kept for Undo). */
export function deleteFact(id: string) {
  const r = mustFact(id);
  const undo = undoable("Deleted fact", [id], r.entry_id, r.chat_id);
  run("UPDATE lore_facts SET deleted_at = ?, updated_at = ? WHERE id = ?", now(), now(), id);
  changed(r.entry_id, r.chat_id);
  return { undo };
}

// ---------- in the prompt (1.2) ----------

type FactText = { slot: string | null; value: string; knownBy: string[]; status: string; kind?: string; revealedTo?: string[]; out?: boolean };
const SLOT_LABEL = (slot: string) => slot.charAt(0).toUpperCase() + slot.slice(1);

/** One fact as the prompt says it: "Eyes: grey", a secret with its keepers, an unconfirmed one as likely. */
export function factLine(f: FactText, name?: string) {
  // 3.4: a "never" fact is said plainly, as a statement about them ("Wren can't swim."), so the model doesn't fill the gap with the opposite.
  const never = f.kind === "never" && name ? (f.value.toLowerCase().includes(name.toLowerCase()) ? f.value : `${name} ${f.value.charAt(0).toLowerCase()}${f.value.slice(1)}`).replace(/[.!]*$/, ".") : null;
  const text = never ?? (f.slot ? `${SLOT_LABEL(f.slot)}: ${f.value}` : f.value);
  // Reliable state 2.2: a secret the story has since let out says who found out.
  const secret = !f.knownBy.length
    ? ""
    : f.revealedTo?.length
      ? f.out
        ? `no longer a secret — once known only to ${f.knownBy.join(", ")}; ${f.revealedTo.join(", ")} found out`
        : `secret — known to ${f.knownBy.join(", ")}, and since revealed to ${f.revealedTo.join(", ")}`
      : `secret — known only to ${f.knownBy.join(", ")}`;
  const tags = [f.status === "invented" ? "likely, not confirmed" : "", secret].filter(Boolean);
  return tags.length ? `${text} [${tags.join("; ")}]` : text;
}

/** The `Now:` block an entry carries after its core. */
export function nowBlock(facts: FactText[], name?: string) {
  return facts.length ? `Now:\n${facts.map((f) => `- ${factLine(f, name)}`).join("\n")}` : "";
}
