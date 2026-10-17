import { all, one, parseJson } from "../db/db";
import { publish } from "../lib/events";
import { badRequest, notFound } from "../lib/http";
import { chatNames } from "../memory/build";
import { promises, secrets } from "../memory/ledgers";
import { type ChatSettings, getChatRow, mustChat } from "../services/chats";
import { formatStoryTime } from "../trackers/clock";
import { currentFold, foldAt } from "../trackers/store";
import { LADDER, type WorldState } from "../trackers/types";
import { chronicleBook } from "./chronicle";
import { createFact, factsNow, type LoreFact, listFacts, retireFact } from "./facts";
import { createEntry, getLorebook, linkedBooks } from "./service";
import { defaultEntry } from "./types";
import { voiceFacts } from "./voice";

/**
 * The bond (docs/15, part 4). For companion chats, where the relationship is the story: a short,
 * always-on Bond entry for {{char}} and {{user}} in the chat's Chronicle, whose lines are facts of
 * kind `bond`, so they follow swipes and Undo like every other fact. It's rebuilt from the story's
 * records: where things stand (the bond and the ladder), what they call each other, their running
 * bits with where each began, open promises and kept secrets between the two (4.1), the moments that
 * mattered (4.2), and what {{char}} has been told about {{user}} (4.3).
 */

export type BondSlot = "stands" | "calls" | "inside joke" | "thread" | "milestone" | "knows";
const LIST: BondSlot[] = ["inside joke", "thread", "milestone", "knows"];
/** How many of each a short, always-on entry carries. */
const KEEP: Record<BondSlot, number> = { stands: 1, calls: 1, "inside joke": 5, thread: 5, milestone: 6, knows: 8 };

const isCompanion = (chatId: string) => getChatRow(chatId)?.mode === "companion";
const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, " ").replace(/\s+/g, " ").trim();

/** The chat's Bond entry (made in its Chronicle the first time). */
export function bondEntry(chatId: string, create = true): string | null {
  const existing = linkedBooks("chat", chatId).map((b) => getLorebook(b.id)).find((b) => b?.settings.chronicleFor === chatId);
  const book = existing ?? (create ? getLorebook(chronicleBook(chatId)) : null);
  const found = book?.entries.find((e) => (e.extra as { bond?: string }).bond === chatId);
  if (found || !create || !book) return found?.id ?? null;
  return createEntry(
    book.id,
    defaultEntry({
      comment: "Bond: {{char}} & {{user}}",
      constant: true,
      order: 140,
      content: "How {{char}} and {{user}} stand with each other, kept current from the story.",
      extra: { bond: chatId, type: "concept", essentials: "{{char}} and {{user}}: where things stand." },
    }),
  ).id;
}

interface Line {
  slot: BondSlot;
  value: string;
  seq: number | null;
}

function pair(st: WorldState, names: { char: string; user: string }) {
  const chars = Object.values(st.chars);
  const user = chars.find((c) => c.isUser) ?? chars.find((c) => norm(c.name) === norm(names.user));
  const char = chars.find((c) => c.isMain && !c.isUser) ?? chars.find((c) => norm(c.name) === norm(names.char));
  return { user, char };
}

/** What the story's records say about the two of them now. */
function wantedLines(chatId: string): Line[] {
  const names = chatNames(chatId);
  const out: Line[] = [];
  let st: WorldState | null = null;
  try {
    st = currentFold(chatId).result.state;
  } catch {
    st = null;
  }
  const isPair = (a?: string | null, b?: string | null) => {
    const x = [norm(a ?? ""), norm(b ?? "")];
    return x.includes(norm(names.char)) && x.includes(norm(names.user));
  };
  if (st) {
    const { user, char } = pair(st, names);
    if (user && char) {
      // Where things stand: the ladder and the bond, in a sentence.
      const ladder = st.ladders[`${char.id}>${user.id}`] ?? st.ladders[`${user.id}>${char.id}`];
      const bond = st.bonds[`${char.id}>${user.id}`];
      const axes = Object.entries(bond?.axes ?? {})
        .filter(([, v]) => v != null && v !== 0)
        .sort((a, b) => Math.abs(b[1]!) - Math.abs(a[1]!))
        .slice(0, 3)
        .map(([k, v]) => `${k} ${v! > 0 ? "+" : ""}${v}`);
      if (ladder || axes.length)
        out.push({ slot: "stands", value: [ladder ? `${LADDER[ladder.tier] ?? "Somewhere"}${ladder.evidence ? ` (${ladder.evidence})` : ""}` : "", axes.length ? `${names.char} toward ${names.user}: ${axes.join(", ")}` : ""].filter(Boolean).join(". "), seq: ladder?.seq ?? bond?.history.at(-1)?.seq ?? null });
      // The moments that mattered between them (4.2), with the story's date.
      for (const m of st.milestones.filter((x) => x.who.includes(char.id) && x.who.includes(user.id)))
        out.push({ slot: "milestone", value: `${m.text}${m.at ? ` (${m.at})` : ""}`, seq: m.seq });
    }
    // Inside jokes: the running bits, with where each began, so callbacks land.
    for (const m of Object.values(st.motifs)) out.push({ slot: "inside joke", value: `${m.text} (since #${m.firstSeq})`, seq: m.firstSeq });
  }
  // What they call each other: the pet names in the character's lore.
  const pets = voiceFacts(chatId, names.char).filter((f) => f.slot === "pet names");
  if (pets.length) out.push({ slot: "calls", value: `${names.char} calls ${names.user} ${pets.map((f) => `“${f.value}”`).join(", ")}`, seq: null });
  // Open threads: promises still pending and secrets the two keep together.
  for (const p of promises(chatId).filter((x) => x.status === "pending" && isPair(x.who, x.whom))) out.push({ slot: "thread", value: `Promise: ${p.who ?? "?"} → ${p.whom ?? "?"}: ${p.what}`, seq: p.seq });
  for (const s of secrets(chatId).filter((x) => x.keepers.some((k) => norm(k) === norm(names.char)) && x.keepers.some((k) => norm(k) === norm(names.user)))) out.push({ slot: "thread", value: `Secret they keep: ${s.statement}`, seq: s.seq });
  // 4.3: what the character knows about you: memories about you told to them, none they weren't.
  if (personaFactsOn(chatId)) {
    const user = norm(names.user);
    const char = norm(names.char);
    const rows = all<{ content: string; entities: string; known_by: string; type: string; max_seq: number | null }>(
      "SELECT content, entities, known_by, type, max_seq FROM memories WHERE chat_id = ? AND deleted_at IS NULL AND status = 'active' AND origin != 'tracker' ORDER BY importance DESC, max_seq DESC LIMIT 200",
      chatId,
    );
    for (const a of rows) {
      if (!parseJson<string[]>(a.entities, []).some((n) => norm(n) === user)) continue;
      const known = parseJson<string[]>(a.known_by, []).map(norm);
      // Told to them, or plain to everyone; a secret nobody told them stays out.
      if (known.length ? !known.includes(char) : a.type === "secret") continue;
      out.push({ slot: "knows", value: a.content, seq: a.max_seq });
    }
  }
  return out;
}

/** 4.3: "Persona facts" (Chat › Bond): on unless switched off (in companion mode). */
export function personaFactsOn(chatId: string) {
  const s = parseJson<ChatSettings & { personaFacts?: boolean | null }>(mustChat(chatId).settings, {});
  return s.personaFacts ?? isCompanion(chatId);
}

/**
 * Brings the Bond's lines up to date: lines the records add come in (from the message that made
 * them, so a swipe takes them away), ones they no longer say are retired. Lines you edited (locked)
 * or retired yourself are left as you left them.
 */
export function refreshBond(chatId: string, opts: { create?: boolean } = {}) {
  if (!isCompanion(chatId)) return null;
  const want = wantedLines(chatId);
  const entryId = bondEntry(chatId, opts.create !== false && want.length > 0);
  if (!entryId) return null;
  const seqMsg = new Map(all<{ id: string; seq: number }>("SELECT id, seq FROM messages WHERE chat_id = ? AND deleted_at IS NULL", chatId).map((m) => [m.seq, m.id]));
  const have = listFacts(entryId, { chatId });
  const now_ = have.filter((f) => f.now);
  // Ones you retired (or edited away) aren't asked for again.
  const gone = new Set(have.filter((f) => !f.now && f.origin === "tracker").map((f) => `${f.slot}|${norm(f.value)}`));
  const kept = new Set<string>();
  let changed = false;
  for (const slot of Object.keys(KEEP) as BondSlot[]) {
    const lines = want.filter((l) => l.slot === slot).slice(-KEEP[slot]);
    for (const l of lines) {
      const k = `${slot}|${norm(l.value)}`;
      kept.add(k);
      const msg = (l.seq != null ? seqMsg.get(l.seq) : null) ?? null;
      // Already there, retired by you, or a line you edited from the same source: leave it.
      if (now_.some((f) => f.slot === slot && (norm(f.value) === norm(l.value) || (f.locked && (f.messageId ?? null) === msg))) || gone.has(k)) continue;
      // A single line (where things stand) replaces the old one.
      if (!LIST.includes(slot)) for (const old of now_.filter((f) => f.slot === slot && f.origin === "tracker" && !f.locked)) retireFact(old.id, { chatId });
      createFact(entryId, { value: l.value, slot, kind: slot === "milestone" ? "event" : "bond", chatId, messageId: msg, origin: "tracker" });
      changed = true;
    }
  }
  for (const f of now_) if (f.origin === "tracker" && !f.locked && f.slot && !kept.has(`${f.slot}|${norm(f.value)}`)) {
    retireFact(f.id, { chatId });
    changed = true;
  }
  if (changed) publish({ type: "lore.facts", entryId, chatId });
  return entryId;
}

export interface BondPage {
  entryId: string | null;
  companion: boolean;
  personaFacts: boolean;
  stands: LoreFact | null;
  calls: LoreFact | null;
  jokes: LoreFact[];
  threads: LoreFact[];
  milestones: LoreFact[];
  knows: LoreFact[];
}

/** Side dock › Story › Bond: the page, freshly brought up to date. */
export function bondPage(chatId: string): BondPage {
  const companion = isCompanion(chatId);
  const entryId = companion ? refreshBond(chatId) : bondEntry(chatId, false);
  const facts = entryId ? factsNow(entryId, chatId) : [];
  const of = (slot: BondSlot) => facts.filter((f) => f.slot === slot);
  return { entryId, companion, personaFacts: personaFactsOn(chatId), stands: of("stands")[0] ?? null, calls: of("calls")[0] ?? null, jokes: of("inside joke"), threads: of("thread"), milestones: of("milestone"), knows: of("knows") };
}

/** 4.2: "Mark as a milestone" on a message: an event fact on the Bond, with the story's date then. */
export function markMilestone(messageId: string, text?: string) {
  const m = one<{ chat_id: string; seq: number; deleted_at: number | null; active_swipe: number }>("SELECT chat_id, seq, deleted_at, active_swipe FROM messages WHERE id = ?", messageId);
  if (!m || m.deleted_at) throw notFound("Message not found");
  const body = one<{ content: string }>("SELECT content FROM swipes WHERE message_id = ? AND idx = ?", messageId, m.active_swipe)?.content ?? "";
  const what = (text?.trim() || body.replace(/[*_"“”]/g, "").replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s+/)[0] || "").slice(0, 200);
  if (!what) throw badRequest("Say what the milestone is");
  const entryId = bondEntry(m.chat_id)!;
  let when: string | null = null;
  let minutes: number | null = null;
  try {
    const t = foldAt(m.chat_id, { uptoSeq: m.seq }).state.time;
    if (t) {
      minutes = t.minutes;
      when = formatStoryTime(t);
    }
  } catch {
    when = null;
  }
  return createFact(entryId, { value: `${what}${when ? ` (${when})` : ""}`, slot: "milestone", kind: "event", chatId: m.chat_id, messageId, origin: "you", sinceTime: minutes, locked: true });
}

/** The job after scene records: a companion chat's Bond, kept current (the first scene makes it). */
export function runBondJob(chatId: string) {
  return refreshBond(chatId);
}

/**
 * 4.2: important memories about the two of them since the last check (a confession, a first fight)
 * that could be milestones: what the keep-up job proposes on the Bond entry.
 */
export function milestoneAtoms(chatId: string, since: number) {
  const names = chatNames(chatId);
  const both = [norm(names.char), norm(names.user)];
  return all<{ id: string; content: string; entities: string; created_at: number; msg: string | null }>(
    `SELECT a.id, a.content, a.entities, a.created_at,
       (SELECT s.message_id FROM memory_sources s WHERE s.memory_id = a.id ORDER BY s.seq DESC LIMIT 1) AS msg
     FROM memories a WHERE a.chat_id = ? AND a.deleted_at IS NULL AND a.status = 'active' AND a.origin != 'tracker'
       AND a.importance >= 8 AND a.type IN ('event', 'relationship') AND a.created_at > ? ORDER BY a.created_at`,
    chatId,
    since,
  ).filter((a) => both.every((n) => parseJson<string[]>(a.entities, []).some((x) => norm(x) === n)));
}
