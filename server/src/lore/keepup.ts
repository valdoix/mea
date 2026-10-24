import { z } from "zod";
import { all, newId, now, one, parseJson, run, tx } from "../db/db";
import { publish } from "../lib/events";
import { badRequest, notFound } from "../lib/http";
import { memoryConfig } from "../lib/settings";
import { getChatRow } from "../services/chats";
import { fileItem, registerFilingKind } from "../services/filings";
import type { JobContext } from "../services/jobs";
import { callJson } from "../services/llm";
import { shouldShed } from "../services/quota";
import { stashRestore } from "../services/undo";
import { currentFold } from "../trackers/store";
import type { Character, Item, WorldState } from "../trackers/types";
import { extraOf, type ScanEntry } from "./activate";
import { createFact, factLine, factsNow, factsNowFor, type FactKind, type LoreFact, retireFact, supersedeFact } from "./facts";
import { describeMinutes } from "../trackers/clock";
import { milestoneAtoms } from "./bond";
import { getLorebook, linkedBooks, scanEntriesFor, updateEntry } from "./service";
import type { LoreEntry } from "./types";
import { CATEGORY_INFO, categoryOf, loreTitle, type Category } from "./format";
import { setSinceRead, sinceAtoms, sinceCardEntry, sinceCardOf, sinceCardOps, sinceRead, sinceScanEntry, sinceWhos } from "./sincecard";

/**
 * Entries that keep up (docs/15, part 2). When the story changes something an entry describes,
 * the change arrives as a card with a diff on the entry's facts ("Where: Riverrun → the inn at
 * Saltpans"), with the message it came from. Apply, Edit, or Not this.
 *
 * - 2.1 Tracker changes (moves, injuries, belongings, people gone) become fact operations with no
 *   model call, by comparing what the trackers say now with the facts the trackers made before.
 * - 2.2 Changes only the story text shows (a nickname, a habit) come from new memories about the
 *   entity, in one model call whose every operation must cite a memory.
 * - 2.3 Each book has a trust level: ask me, apply tracker facts and ask the rest, or apply all.
 *   Applied changes show as a chip with Undo under the reply that caused them. A locked fact the
 *   story contradicts gets its own card instead of a change.
 * - 2.4 When the entry's own text still says the old thing, a card offers the rewritten text.
 *
 * Story facts belong to the chat, even on an entry in the companion book, so the book stays clean.
 */

export type KeepupLevel = "ask" | "tracker" | "all";
export const KEEPUP_LEVELS: KeepupLevel[] = ["ask", "tracker", "all"];

export interface FactOp {
  op: "add" | "supersede" | "retire";
  slot: string | null;
  value: string;
  /** supersede / retire: the fact it changes, and what it said. */
  factId?: string;
  old?: string;
  /** The message it came from (null: the newest one). */
  messageId: string | null;
  origin: "tracker" | "story";
  /** 2.2: the memory it rests on. */
  cite?: string;
  citeText?: string;
  /** The fact it changes is locked: only a contradiction card can change it. */
  locked?: boolean;
  /** The kind of fact it makes (default: state for the trackers', attribute for the rest). */
  kind?: FactKind;
  /** 5.2: why it's asked ("About six weeks have passed on the story's clock."). */
  note?: string;
  /** Since the card: the card's sentence this line updates, word for word. */
  against?: string;
}

export interface UpdateDiff {
  ops: FactOp[];
  /** 2.3: the story contradicts a locked fact. */
  contradiction?: boolean;
  /** 2.4: the entry's text, rewritten for what's true now. */
  core?: { before: string; after: string; stale: string[] };
  /** What applying it did, so Undo (and the chip) can take it back. */
  applied?: Applied;
}

interface Applied {
  created: string[];
  superseded: { old: string; made: string }[];
  retired: string[];
}

interface ProposalRow {
  id: string;
  chat_id: string;
  entry_id: string;
  name: string;
  kind: string;
  diff: string;
  status: string;
  created_at: number;
}

const normName = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, " ").replace(/\s+/g, " ").trim();
const plainKeys = (ks: string[] | undefined) => (ks ?? []).filter((k) => !/^\/.*\/[a-z]*$/.test(k.trim()));
const namesOfEntry = (e: ScanEntry) =>
  new Set([...plainKeys(e.keys), ...(extraOf(e).aliases ?? []), extraOf(e).entity ?? "", e.comment].map(normName).filter((n) => n.length >= 2));

/** The kinds that are the whole of one person or thing: where they are, what they carry, their nicknames belong here. */
const PROFILE_KINDS = new Set<Category>(["character", "item"]);
/** Two people in a title ("Willy the Snitch & Buffy Summers", "Mira and Joss"). */
const PAIR = /\s(?:&|\+|and|x|\/)\s|\s*&\s*/i;

/** A kind named in the title ("Voice: Gabriel", "Character - Gabriel"), and the rest of it. */
function titledKind(e: ScanEntry): { kind: Category; rest: string } | null {
  const m = loreTitle(e).match(/^\s*([^:|\-–—]+?)\s*(?::|\s[-–—|]\s)\s*(.+)$/);
  if (!m) return null;
  const label = normName(m[1]!);
  const kind = (Object.keys(CATEGORY_INFO) as Category[]).find((k) => k === label || normName(CATEGORY_INFO[k].label) === label);
  return kind ? { kind, rest: m[2]! } : null;
}

/** The entry's kind: the one it's set to, else one its title names. */
const kindOf = (e: ScanEntry): Category | null => categoryOf(e) ?? titledKind(e)?.kind ?? null;

/**
 * The names an entry is the profile of, or none. A belief, a relationship or a voice fires on a
 * person's name too, but the trackers' "Where" and a memory about their family aren't about it.
 * Without a kind set, the title (after a "Character:" prefix) has to be the name itself ("Gabriel",
 * "Character: Gabriel Brennan (the Watcher)"); "Voice: Gabriel" is a voice, not Gabriel.
 */
function profileNames(e: ScanEntry): Set<string> {
  const cat = categoryOf(e);
  const titled = cat ? null : titledKind(e);
  const kind = cat ?? titled?.kind;
  const type = extraOf(e).type;
  if (kind ? !PROFILE_KINDS.has(kind) : type && type !== "character" && type !== "item") return new Set();
  const names = namesOfEntry(e);
  if (cat) return names;
  const head = (titled?.rest ?? loreTitle(e)).replace(/\s*[([].*$/, "").split(/\s[-–—|]\s|[:,]/)[0]!;
  if (PAIR.test(head)) return new Set();
  const words = new Set([...names].flatMap((n) => n.split(" ")));
  const hw = normName(head).split(" ").filter(Boolean);
  return hw.length && hw.every((w) => words.has(w)) ? names : new Set();
}

/** What a memory says when it's about how someone talks (stems: "call" finds "calls her little fish"). */
const VOICE_WORDS = ["say", "said", "call", "voice", "talk", "speak", "spoke", "swear", "swore", "curse", "cursing", "accent", "phrase", "catchphrase", "greet", "nicknam", "pet name", "whisper", "mutter", "drawl", "stammer", "stutter", "tone", "word"];

const TOPIC_SKIP = new Set(["everyone", "everything", "always", "never", "about", "would", "could", "should", "must"]);

/**
 * Does a memory touch what a non-profile entry is about? A relationship needs both its people; any
 * other kind (a belief, a moment) needs one of its own words beyond the names it fires on.
 */
function aboutTopic(e: ScanEntry, text: string): boolean {
  const n = ` ${normName(text)} `;
  const has = (name: string) => name.length >= 3 && n.includes(` ${name} `);
  const second = plainKeys(e.secondaryKeys).map(normName);
  const sides = second.length
    ? [plainKeys(e.keys).map(normName), second]
    : loreTitle(e).split(PAIR).length > 1
      ? loreTitle(e).split(PAIR).map((s) => [normName(s), ...normName(s).split(" ").filter((w) => w.length >= 3 && !["the", "and"].includes(w))])
      : null;
  if (sides) return sides.every((side) => side.some(has));
  const x = extraOf(e);
  const names = new Set([...plainKeys(e.keys), ...plainKeys(e.secondaryKeys), ...(x.aliases ?? []), x.entity ?? ""].flatMap((k) => normName(k).split(" ")));
  const topic = telling(loreTitle(e)).filter((w) => !names.has(w) && !TOPIC_SKIP.has(w));
  if (kindOf(e) === "voice" && VOICE_WORDS.some((w) => n.includes(` ${w}`))) return true;
  // A loose stem, so "protect" finds "protects" and "belief" finds "believes".
  return topic.some((w) => n.includes(` ${w.length > 5 ? w.slice(0, -1) : w}`));
}

/** One line of a diff: "Where: Riverrun → the inn at Saltpans", "+ Carries: a knife", "− Injury (arm): wound". */
export function opLine(o: FactOp) {
  const label = o.slot ? `${o.slot.charAt(0).toUpperCase()}${o.slot.slice(1)}: ` : "";
  if (o.op === "add") return `+ ${label}${o.value}`;
  if (o.op === "retire") return `− ${label}${o.old ?? o.value}`;
  return `${label}${o.old ?? "?"} → ${o.value}`;
}
const opSig = (entryId: string, o: FactOp) => `${entryId}|${o.op}|${o.slot ?? ""}|${normName(o.op === "retire" ? (o.old ?? o.value) : o.value)}`;

// ---------- 2.1 what the trackers say ----------

const SEVERITY = ["", "a scratch", "a wound", "serious", "critical"];

interface Want {
  slot: string;
  value: string;
  /** Change paths that say which message set it. */
  paths: string[];
}

function charWants(c: Character, st: WorldState): Want[] {
  const at = `chars.${c.id}`;
  if (c.dead) return [{ slot: "status", value: "dead", paths: [`${at}.dead`] }];
  const out: Want[] = [];
  if (c.place) out.push({ slot: "where", value: c.place, paths: ["place", `${at}.tier`, `${at}.place`] });
  for (const i of c.injuries) out.push({ slot: `injury (${i.where})`, value: `${SEVERITY[i.severity] ?? "hurt"}${i.treated ? ", treated" : ""}`, paths: [`${at}.injuries`, `${at}.body`] });
  for (const k of c.conditions) out.push({ slot: `condition (${k.kind})`, value: k.text, paths: [`${at}.conditions`, `${at}.body`] });
  const held = Object.values(st.items).filter((it) => !it.gone && it.holder === c.id);
  if (held.length) out.push({ slot: "carries", value: held.map((it) => it.name).join(", "), paths: held.map((it) => `items.${it.id}`) });
  return out;
}

function itemWants(it: Item, st: WorldState): Want[] {
  const at = `items.${it.id}`;
  if (it.gone) return [{ slot: "status", value: "gone", paths: [at] }];
  const out: Want[] = [];
  if (it.holder) {
    const who = it.holder.startsWith("place:") ? it.holder.slice(6) : (st.chars[it.holder]?.name ?? it.holder);
    out.push({ slot: it.holder.startsWith("place:") ? "kept at" : "held by", value: who, paths: [at] });
  }
  if (it.where && !it.holder?.startsWith("place:")) out.push({ slot: "where", value: it.where, paths: [at] });
  if (it.condition) out.push({ slot: "condition", value: it.condition, paths: [at] });
  return out;
}

/** The trackers' people and things, each with the entry it belongs to (by name, alias or link). */
function trackedFor(entries: ScanEntry[], st: WorldState, personaBooks: Set<string> = new Set()) {
  const out: { entry: ScanEntry; wants: Want[] }[] = [];
  for (const e of entries) {
    const names = profileNames(e);
    if (!names.size) continue;
    // 8.2: your persona's own lorebook keeps up with your character too.
    const c = Object.values(st.chars).find((x) => (!x.isUser || personaBooks.has(e.bookId)) && [x.name, ...x.aliases].some((n) => names.has(normName(n))));
    if (c) {
      out.push({ entry: e, wants: charWants(c, st) });
      continue;
    }
    const it = Object.values(st.items).find((x) => names.has(normName(x.name)));
    if (it) out.push({ entry: e, wants: itemWants(it, st) });
  }
  return out;
}

/** The newest message on the branch whose tracker changes touch one of these paths. */
function sourceMessage(changes: Record<string, { path: string }[]>, onPath: { id: string; seq: number }[], paths: string[]) {
  for (const m of onPath) if ((changes[m.id] ?? []).some((c) => paths.some((p) => c.path === p || c.path.startsWith(`${p}.`)))) return m.id;
  return onPath[0]?.id ?? null;
}

/** 2.1: the fact operations that bring an entry's tracker facts up to what the trackers say now. */
function trackerOps(entryId: string, chatId: string, wants: Want[], facts: LoreFact[], ctx: { changes: Record<string, { path: string }[]>; onPath: { id: string; seq: number }[] }): FactOp[] {
  const ops: FactOp[] = [];
  const bySlot = new Map<string, LoreFact>();
  // The trackers' own facts first; a fact of yours in the same slot is what the change replaces otherwise.
  for (const f of facts) if (f.slot && (!bySlot.has(f.slot) || f.origin === "tracker")) bySlot.set(f.slot, f);
  const wanted = new Set(wants.map((w) => w.slot));
  for (const w of wants) {
    const have = bySlot.get(w.slot);
    const messageId = sourceMessage(ctx.changes, ctx.onPath, w.paths);
    if (!have) ops.push({ op: "add", slot: w.slot, value: w.value, messageId, origin: "tracker" });
    else if (normName(have.value) !== normName(w.value)) ops.push({ op: "supersede", slot: w.slot, value: w.value, factId: have.id, old: have.value, messageId, origin: "tracker", ...(have.locked ? { locked: true } : {}) });
  }
  // What the trackers said before and don't now (healed, put down): retired, from the newest message.
  for (const f of facts)
    if (f.origin === "tracker" && f.slot && !wanted.has(f.slot)) ops.push({ op: "retire", slot: f.slot, value: f.value, old: f.value, factId: f.id, messageId: ctx.onPath[0]?.id ?? null, origin: "tracker", ...(f.locked ? { locked: true } : {}) });
  void entryId;
  void chatId;
  return ops;
}

// ---------- 2.2 what only the story text shows ----------

const opsSchema = z.object({
  ops: z
    .array(z.object({ op: z.enum(["add", "supersede", "retire"]), slot: z.string().nullable().optional(), value: z.string().default(""), fact: z.string().nullable().optional(), cite: z.string().nullable().optional() }))
    .default([]),
});

interface AtomLite {
  id: string;
  content: string;
  created_at: number;
  msg: string | null;
}

/** The new memories about an entry, and how far it read (past the ones that weren't about it, so they aren't read again). */
function newAtoms(chatId: string, e: ScanEntry, since: number): { atoms: AtomLite[]; at: number } {
  const names = [...namesOfEntry(e)].filter((n) => n.length >= 3);
  if (!names.length) return { atoms: [], at: since };
  const rows = all<AtomLite & { entities: string }>(
    `SELECT a.id, a.content, a.created_at, a.entities,
       (SELECT s.message_id FROM memory_sources s JOIN messages m ON m.id = s.message_id WHERE s.memory_id = a.id AND m.deleted_at IS NULL ORDER BY s.seq DESC LIMIT 1) AS msg
     FROM memories a WHERE a.chat_id = ? AND a.deleted_at IS NULL AND a.status = 'active' AND a.origin != 'tracker' AND a.created_at > ?
     ORDER BY a.created_at LIMIT 200`,
    chatId,
    since,
  );
  const profile = profileNames(e).size > 0;
  const atoms = rows
    .filter((a) => parseJson<string[]>(a.entities, []).some((n) => names.includes(normName(n))) || names.some((n) => normName(a.content).includes(n)))
    .filter((a) => profile || aboutTopic(e, a.content))
    .slice(-20);
  return { atoms, at: rows.at(-1)?.created_at ?? since };
}

async function memoryOps(chatId: string, e: ScanEntry, atoms: AtomLite[], facts: LoreFact[], job?: JobContext): Promise<FactOp[]> {
  if (!atoms.length || shouldShed("verification", chatId)) return [];
  const title = e.comment || e.keys[0] || "this entry";
  const cat = kindOf(e);
  // Only what this entry covers: a belief's facts are about the belief, not the believer's scars.
  const scope = profileNames(e).size
    ? `This entry is the profile of ${title}.`
    : `This entry is${cat ? ` a ${CATEGORY_INFO[cat].label.toLowerCase()} (${CATEGORY_INFO[cat].hint})` : ""} about "${title}" only, not a profile of the people it names. Propose only changes to what it covers; a fact about a person that isn't about this (their body, home, family, habits) belongs in their own entry: skip it. Most memories won't change it; an empty list is the usual answer.`;
  const F = facts.map((f, i) => ({ ref: `F${i + 1}`, f }));
  const A = atoms.map((a, i) => ({ ref: `M${i + 1}`, a }));
  let data: z.infer<typeof opsSchema>;
  try {
    data = (
      await callJson({
        task: "summarizer",
        kind: "lore keep-up",
        chatId,
        jobId: job?.id,
        name: "lore_keepup",
        schema: opsSchema,
        system: `You keep a lorebook entry's facts true to a story. You get the entry, its facts now (F1…) and new memories from the story (M1…). ${scope} Propose only changes the memories clearly state about ${title}: a new lasting fact (a nickname, a habit, a new home, something they can or can't do), a new value for a fact (supersede it: name the fact), or a fact that stopped being true (retire it). Facts are short and exact: keep names, numbers, sides and colours word for word. Skip passing moods, one-off actions and anything already in the facts or the entry. Every operation must cite the memory it rests on. Reply with JSON only: {"ops": [{"op": "add|supersede|retire", "slot": "short label or null", "value": "the fact", "fact": "F2 for supersede/retire", "cite": "M3"}]}`,
        user: `ENTRY: ${title}\n${e.content.slice(0, 1500)}\n\nFACTS NOW:\n${F.map((x) => `${x.ref}. ${factLine(x.f)}`).join("\n") || "(none)"}\n\nNEW MEMORIES:\n${A.map((x) => `${x.ref}. ${x.a.content}`).join("\n")}`,
        maxTokens: 700,
      })
    ).data;
  } catch {
    return [];
  }
  const out: FactOp[] = [];
  for (const o of data.ops.slice(0, 8)) {
    // Every operation rests on a memory it names; anything uncited is dropped.
    const cite = A.find((x) => x.ref === o.cite?.trim());
    if (!cite) continue;
    const value = o.value.replace(/\s+/g, " ").trim().slice(0, 300);
    const fact = F.find((x) => x.ref === o.fact?.trim())?.f;
    const base = { slot: o.slot?.trim().toLowerCase() || fact?.slot || null, messageId: cite.a.msg, origin: "story" as const, cite: cite.a.id, citeText: cite.a.content };
    if (o.op === "add" && value) out.push({ op: "add", value, ...base });
    else if (o.op === "supersede" && fact && value && normName(value) !== normName(fact.value)) out.push({ op: "supersede", value, factId: fact.id, old: fact.value, ...base, ...(fact.locked ? { locked: true } : {}) });
    else if (o.op === "retire" && fact) out.push({ op: "retire", value: fact.value, old: fact.value, factId: fact.id, ...base, ...(fact.locked ? { locked: true } : {}) });
  }
  return out;
}

// ---------- proposals ----------

const proposalRow = (id: string) => one<ProposalRow>("SELECT id, chat_id, entry_id, name, kind, diff, status, created_at FROM chronicle_proposals WHERE id = ?", id);
const diffOf = (r: ProposalRow) => parseJson<UpdateDiff>(r.diff, { ops: [] });

/** What this chat already said no to on an entry (asked once is enough). */
function rejectedSigs(entryId: string, chatId: string) {
  const out = new Set<string>();
  for (const r of all<ProposalRow>("SELECT * FROM chronicle_proposals WHERE entry_id = ? AND chat_id = ? AND kind = 'update' AND status = 'rejected'", entryId, chatId)) for (const o of diffOf(r).ops) out.add(opSig(entryId, o));
  return out;
}

/** One open card per entry (and one for contradictions): new operations join it, replacing ones on the same slot. */
function upsertCard(chatId: string, e: ScanEntry, ops: FactOp[], contradiction: boolean) {
  const open = all<ProposalRow>("SELECT * FROM chronicle_proposals WHERE entry_id = ? AND chat_id = ? AND kind = 'update' AND status = 'open'", e.id, chatId).find((r) => Boolean(diffOf(r).contradiction) === contradiction);
  const title = e.comment || e.keys[0] || "an entry";
  if (open) {
    const d = diffOf(open);
    const key = (o: FactOp) => `${o.slot ?? ""}|${o.factId ?? o.value}`;
    const fresh = new Set(ops.map(key));
    d.ops = [...d.ops.filter((o) => !fresh.has(key(o))), ...ops];
    run("UPDATE chronicle_proposals SET diff = ?, updated_at = ? WHERE id = ?", JSON.stringify(d), now(), open.id);
    return open.id;
  }
  const id = newId();
  const diff: UpdateDiff = { ops, ...(contradiction ? { contradiction: true } : {}) };
  run("INSERT INTO chronicle_proposals (id, chat_id, entity_id, name, entry, status, created_at, updated_at, kind, entry_id, diff) VALUES (?, ?, NULL, ?, '{}', 'open', ?, ?, 'update', ?, ?)", id, chatId, title, now(), now(), e.id, JSON.stringify(diff));
  return id;
}

/** The book's trust level (2.3). */
export function keepupLevel(bookId: string): KeepupLevel {
  const s = getLorebook(bookId)?.settings as { keepup?: KeepupLevel } | undefined;
  return s?.keepup && KEEPUP_LEVELS.includes(s.keepup) ? s.keepup : "ask";
}

/** Carries out operations on an entry's facts for a chat, and says what it did (for Undo). */
export function applyOps(entryId: string, chatId: string, ops: FactOp[], opts: { force?: boolean } = {}): Applied {
  const done: Applied = { created: [], superseded: [], retired: [] };
  // 5.2: what the story's clock says now, so a state can wear off.
  const sinceTime = clockNow(chatId)?.minutes ?? null;
  tx(() => {
    for (const o of ops) {
      if (o.locked && !opts.force) continue;
      const messageId = o.messageId && one("SELECT 1 FROM messages WHERE id = ? AND deleted_at IS NULL", o.messageId) ? o.messageId : null;
      const target = o.factId ? one<{ id: string; deleted_at: number | null }>("SELECT id, deleted_at FROM lore_facts WHERE id = ?", o.factId) : undefined;
      if (o.op === "add" || ((o.op === "supersede" || o.op === "retire") && (!target || target.deleted_at))) {
        if (o.op === "retire") continue;
        done.created.push(createFact(entryId, { value: o.value, slot: o.slot, chatId, messageId, origin: o.origin, kind: o.kind ?? (o.origin === "tracker" ? "state" : "attribute"), sinceTime }).fact.id);
      } else if (o.op === "supersede") {
        done.superseded.push({ old: o.factId!, made: supersedeFact(o.factId!, { value: o.value, slot: o.slot, chatId, messageId, origin: o.origin, sinceTime }, { force: opts.force }).fact.id });
      } else {
        retireFact(o.factId!, { chatId, ...(messageId ? { atMessageId: messageId } : {}) });
        done.retired.push(o.factId!);
      }
    }
  });
  return done;
}

/** Takes back what `applyOps` did (works long after the 15-minute Undo, for the chips). */
export function revertApplied(entryId: string, chatId: string, a: Applied) {
  tx(() => {
    for (const id of a.created) run("DELETE FROM lore_facts WHERE id = ?", id);
    for (const s of a.superseded) {
      run("DELETE FROM lore_facts WHERE id = ?", s.made);
      run("UPDATE lore_facts SET status = 'active', superseded_by = NULL, updated_at = ? WHERE id = ? AND superseded_by = ?", now(), s.old, s.made);
    }
    for (const id of a.retired) run("UPDATE lore_facts SET until_seq = NULL, until_message_id = NULL, until_swipe = NULL, updated_at = ? WHERE id = ?", now(), id);
  });
  publish({ type: "lore.facts", entryId, chatId });
}

/** Applied without asking (trust levels): a chip with Undo under each reply that caused a change. */
function fileApplied(chatId: string, e: ScanEntry, ops: FactOp[], applied: Applied) {
  const title = e.comment || e.keys[0] || "entry";
  const byMsg = new Map<string | null, FactOp[]>();
  for (const o of ops) byMsg.set(o.messageId, [...(byMsg.get(o.messageId) ?? []), o]);
  // One chip per reply; Undo on any of them takes back the whole batch (it was applied together).
  for (const [messageId, list] of byMsg) fileItem(chatId, { messageId, kind: "lore_update", label: `${title}: ${list.map(opLine).join("; ")}`.slice(0, 200), data: { entryId: e.id, applied } });
}

registerFilingKind("lore_update", {
  undo: (f) => {
    const d = f.data as { entryId?: string; applied?: Applied };
    if (d.entryId && d.applied) revertApplied(d.entryId, f.chatId, d.applied);
  },
});

// ---------- 2.4 the core ----------

const sentencesOf = (text: string) => text.replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s+/).filter(Boolean);
/** The words of a value that would give it away in prose ("Riverrun", "the inn at Saltpans" → "inn", "saltpans"). */
const telling = (v: string) => normName(v).split(" ").filter((w) => w.length >= 4 && !["with", "from", "that", "this", "their", "there"].includes(w));

/** 2.4: sentences of the core that still say an old value (by its telling words). */
export function staleSentences(core: string, olds: string[]) {
  const out: string[] = [];
  for (const s of sentencesOf(core)) {
    const n = ` ${normName(s)} `;
    if (olds.some((o) => {
      const w = telling(o);
      return w.length > 0 && w.every((x) => n.includes(` ${x} `));
    }))
      out.push(s);
  }
  return out;
}

const coreSchema = z.object({ content: z.string().min(1) });

/** A card offering the entry's text rewritten for what's true now (only saved when you keep it). */
async function proposeCore(chatId: string, e: ScanEntry, ops: FactOp[], job?: JobContext) {
  const changes = ops.filter((o) => (o.op === "supersede" || o.op === "retire") && o.old);
  if (!changes.length || !e.content.trim()) return null;
  const stale = staleSentences(e.content, changes.map((o) => o.old!));
  if (!stale.length) return null;
  if (one("SELECT 1 FROM chronicle_proposals WHERE entry_id = ? AND chat_id = ? AND kind = 'core' AND status = 'open'", e.id, chatId)) return null;
  // Rules first: the old value's words become the new value's; a retired thing's sentence goes.
  let after = e.content;
  for (const o of changes) {
    if (o.op === "supersede") after = after.replace(new RegExp(o.old!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), o.value);
    else for (const s of staleSentences(after, [o.old!])) after = after.replace(s, "").replace(/\s{2,}/g, " ");
  }
  after = after.trim();
  if (!shouldShed("verification", chatId)) {
    try {
      const r = await callJson({
        task: "summarizer",
        kind: "lore keep-up",
        chatId,
        jobId: job?.id,
        name: "lore_core_rewrite",
        schema: coreSchema,
        system: `Rewrite a lorebook entry so it no longer says what stopped being true. Change only the sentences that say an old value; keep every other word, name and number exactly as it is. Reply with JSON only: {"content": "the whole entry"}`,
        user: `ENTRY:\n${e.content}\n\nWHAT CHANGED:\n${changes.map(opLine).join("\n")}`,
        maxTokens: 1200,
      });
      if (r.data.content.trim() && r.data.content.trim() !== e.content.trim()) after = r.data.content.trim();
    } catch {
      // the rules' version stands
    }
  }
  if (after === e.content.trim()) return null;
  const id = newId();
  const diff: UpdateDiff = { ops: changes, core: { before: e.content, after, stale } };
  run("INSERT INTO chronicle_proposals (id, chat_id, entity_id, name, entry, status, created_at, updated_at, kind, entry_id, diff) VALUES (?, ?, NULL, ?, '{}', 'open', ?, ?, 'core', ?, ?)", id, chatId, e.comment || e.keys[0] || "an entry", now(), now(), e.id, JSON.stringify(diff));
  return id;
}

// ---------- the job ----------

function cursor(entryId: string, chatId: string) {
  return one<{ seq: number; atoms_at: number }>("SELECT seq, atoms_at FROM lore_keepup WHERE entry_id = ? AND chat_id = ?", entryId, chatId) ?? { seq: 0, atoms_at: 0 };
}
function setCursor(entryId: string, chatId: string, seq: number, atomsAt: number) {
  run(
    "INSERT INTO lore_keepup (entry_id, chat_id, seq, atoms_at, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(entry_id, chat_id) DO UPDATE SET seq = excluded.seq, atoms_at = excluded.atoms_at, updated_at = excluded.updated_at",
    entryId,
    chatId,
    seq,
    atomsAt,
    now(),
  );
}

export interface KeepupResult {
  proposed: string[];
  applied: { entryId: string; ops: FactOp[] }[];
  core: string[];
}

/**
 * The keep-up job (after scene records, beside the Chronicle): for each entry the story touches,
 * what the trackers and the new memories changed since the last check, as cards or (by the book's
 * trust level) applied with a chip.
 */
export async function runKeepup(chatId: string, job?: JobContext, opts: { memories?: boolean } = {}): Promise<KeepupResult> {
  const res: KeepupResult = { proposed: [], applied: [], core: [] };
  const cfg = memoryConfig();
  const chat = getChatRow(chatId);
  if (!chat || chat.deleted_at) return res;
  const onPath = all<{ id: string; seq: number }>("SELECT id, seq FROM messages WHERE chat_id = ? AND deleted_at IS NULL ORDER BY seq DESC", chatId);
  const latest = onPath[0]?.seq ?? 0;
  if (cfg.sinceCard && opts.memories !== false) await sinceCardKeepup(chatId, latest, res, job);
  const entries = cfg.loreKeepup ? scanEntriesFor({ characterId: chat.character_id, personaId: chat.persona_id, chatId }).filter((e) => e.enabled && !sinceCardOf(e)) : [];
  if (!entries.length) return finish(chatId, res);
  let st: WorldState | null = null;
  let changes: Record<string, { path: string }[]> = {};
  try {
    const fold = currentFold(chatId).result;
    st = fold.state;
    changes = fold.changes as Record<string, { path: string }[]>;
  } catch {
    st = null;
  }
  const personaBooks = new Set(chat.persona_id ? linkedBooks("persona", chat.persona_id).map((b) => b.id) : []);
  const tracked = new Map(st ? trackedFor(entries, st, personaBooks).map((t) => [t.entry.id, t.wants]) : []);
  for (const e of entries) {
    const cur = cursor(e.id, chatId);
    // 4.2: the Bond entry (companion chats): important memories about the two of them become milestone cards.
    if ((e.extra as { bond?: string }).bond === chatId) {
      const found = milestoneAtoms(chatId, cur.atoms_at);
      setCursor(e.id, chatId, latest, found.at(-1)?.created_at ?? cur.atoms_at);
      const no = rejectedSigs(e.id, chatId);
      const ops: FactOp[] = found
        .map((a): FactOp => ({ op: "add", slot: "milestone", value: a.content, kind: "event", messageId: a.msg, origin: "story", cite: a.id, citeText: a.content }))
        .filter((o) => !no.has(opSig(e.id, o)) && !factsNow(e.id, chatId).some((f) => f.slot === "milestone" && normName(f.value) === normName(o.value)));
      if (ops.length) res.proposed.push(upsertCard(chatId, e, ops, false));
      continue;
    }
    const wants = tracked.get(e.id);
    const read = opts.memories === false ? { atoms: [], at: cur.atoms_at } : newAtoms(chatId, e, cur.atoms_at);
    const atoms = read.atoms;
    if (!wants && !atoms.length) {
      if (read.at !== cur.atoms_at) setCursor(e.id, chatId, latest, read.at);
      continue;
    }
    const facts = factsNow(e.id, chatId);
    let ops: FactOp[] = wants ? trackerOps(e.id, chatId, wants, facts, { changes, onPath }) : [];
    const taken = new Set(ops.map((o) => o.factId ?? `slot:${o.slot}`));
    // The memories' changes, minus any a tracker change already covers.
    for (const o of await memoryOps(chatId, e, atoms, facts, job)) if (!taken.has(o.factId ?? `slot:${o.slot}`) || !o.slot) ops.push(o);
    setCursor(e.id, chatId, latest, read.at);
    await deliver(chatId, e, ops, res, job);
  }
  return finish(chatId, res);
}

/** Operations for an entry, minus ones told no before: applied (by the book's trust level) or asked as cards. */
async function deliver(chatId: string, e: ScanEntry, ops: FactOp[], res: KeepupResult, job?: JobContext, opts: { core?: boolean } = {}) {
  // Asked before and told no: not again for the same change.
  const no = rejectedSigs(e.id, chatId);
  ops = ops.filter((o) => !no.has(opSig(e.id, o)));
  if (!ops.length) return;
  const locked = ops.filter((o) => o.locked);
  const free = ops.filter((o) => !o.locked);
  const level = keepupLevel(e.bookId);
  const auto = free.filter((o) => level === "all" || (level === "tracker" && o.origin === "tracker"));
  const ask = free.filter((o) => !auto.includes(o));
  if (auto.length) {
    const applied = applyOps(e.id, chatId, auto);
    fileApplied(chatId, e, auto, applied);
    res.applied.push({ entryId: e.id, ops: auto });
    if (opts.core !== false) {
      const core = await proposeCore(chatId, e, auto, job);
      if (core) res.core.push(core);
    }
  }
  if (ask.length) res.proposed.push(upsertCard(chatId, e, ask, false));
  if (locked.length) res.proposed.push(upsertCard(chatId, e, locked, true));
}

function finish(chatId: string, res: KeepupResult) {
  if (res.proposed.length || res.applied.length || res.core.length) {
    publish({ type: "inbox.changed" });
    publish({ type: "memory.changed", chatId });
  }
  return res;
}

/**
 * Since the card: new memories about the character or the persona that show a lasting change from
 * the card become lines on the chat's Since the card entry (made the first time there's something
 * to read). The entry's text is fixed, so there's no core rewrite to offer.
 */
async function sinceCardKeepup(chatId: string, latest: number, res: KeepupResult, job?: JobContext) {
  for (const who of sinceWhos(chatId)) {
    const since = sinceRead(chatId, who);
    const read = sinceAtoms(chatId, who, since);
    if (read.at !== since) setSinceRead(chatId, who, read.at);
    if (!read.atoms.length) continue;
    const existing = sinceCardEntry(chatId, who, false);
    const ops = await sinceCardOps(chatId, who, read.atoms, existing ? factsNow(existing, chatId) : [], job);
    if (!ops.length) continue;
    // The entry is made the first time there's a line to propose, not before.
    const e = sinceScanEntry(existing ?? sinceCardEntry(chatId, who)!, chatId, who);
    if (e) await deliver(chatId, e, ops, res, job, { core: false });
  }
}

// ---------- 5.2 things that wear off ----------

/** The story's clock now (null: no clock yet). */
export function clockNow(chatId: string) {
  try {
    return currentFold(chatId).result.state.time ?? null;
  } catch {
    return null;
  }
}

/**
 * 5.2: states whose expected time has passed on the story's clock ("a sling, about six weeks") get a
 * "healed?" card (asked once), instead of lasting forever. Runs after the clock moves.
 */
export function runTimeKeepup(chatId: string) {
  const t = clockNow(chatId);
  const chat = getChatRow(chatId);
  if (!t || !chat || chat.deleted_at || !memoryConfig().loreKeepup) return [];
  const entries = scanEntriesFor({ characterId: chat.character_id, personaId: chat.persona_id, chatId }).filter((e) => e.enabled);
  const facts = factsNowFor(entries.map((e) => e.id), chatId);
  const latest = one<{ id: string }>("SELECT id FROM messages WHERE chat_id = ? AND deleted_at IS NULL ORDER BY seq DESC LIMIT 1", chatId)?.id ?? null;
  const made: string[] = [];
  for (const e of entries) {
    const due = (facts.get(e.id) ?? []).filter((f) => f.expectsMinutes && f.sinceTime != null && t.minutes >= f.sinceTime + f.expectsMinutes);
    if (!due.length) continue;
    const no = rejectedSigs(e.id, chatId);
    const asked = new Set(all<ProposalRow>("SELECT * FROM chronicle_proposals WHERE entry_id = ? AND chat_id = ? AND kind = 'update' AND status = 'open'", e.id, chatId).flatMap((r) => diffOf(r).ops.map((o) => o.factId)));
    const ops = due
      .map((f): FactOp => ({ op: "retire", slot: f.slot, value: f.value, old: f.value, factId: f.id, messageId: latest, origin: "tracker", note: `${describeMinutes(t.minutes - f.sinceTime!)} have passed on the story's clock since “${f.value}”.`, ...(f.locked ? { locked: true } : {}) }))
      .filter((o) => !no.has(opSig(e.id, o)) && !asked.has(o.factId));
    if (ops.length) made.push(upsertCard(chatId, e, ops.filter((o) => !o.locked), false), ...(ops.some((o) => o.locked) ? [upsertCard(chatId, e, ops.filter((o) => o.locked), true)] : []));
  }
  if (made.length) publish({ type: "inbox.changed" });
  return made;
}

// ---------- deciding a card ----------

export interface UpdateProposal {
  id: string;
  chatId: string;
  entryId: string;
  title: string;
  kind: "update" | "core";
  diff: UpdateDiff;
  createdAt: number;
}

export function updateProposals(chatId: string): UpdateProposal[] {
  return all<ProposalRow>("SELECT * FROM chronicle_proposals WHERE chat_id = ? AND kind IN ('update', 'core') AND status = 'open' AND entry_id IS NOT NULL ORDER BY created_at DESC", chatId)
    .filter((r) => one("SELECT 1 FROM lorebook_entries WHERE id = ?", r.entry_id))
    .map((r) => ({ id: r.id, chatId: r.chat_id, entryId: r.entry_id, title: r.name, kind: r.kind as "update" | "core", diff: diffOf(r), createdAt: r.created_at }));
}

/**
 * Apply a card (with `edited`: one line per operation, in order, "Slot: value" or just the value) or
 * say no. A contradiction card applied ("Update it") changes the locked fact; rejected, yours stays.
 * Returns the chat and an Undo token.
 */
export function decideUpdate(id: string, action: "accept" | "reject", edited?: string): { chatId: string; undo: string | null } {
  const r = proposalRow(id);
  if (!r || (r.kind !== "update" && r.kind !== "core")) throw notFound("That suggestion is gone");
  if (r.status !== "open") throw badRequest("That suggestion was already decided");
  const d = diffOf(r);
  if (action === "reject") {
    run("UPDATE chronicle_proposals SET status = 'rejected', updated_at = ? WHERE id = ?", now(), id);
    return { chatId: r.chat_id, undo: stashRestore("Not this", () => run("UPDATE chronicle_proposals SET status = 'open', updated_at = ? WHERE id = ?", now(), id)) };
  }
  if (r.kind === "core") {
    const row = one<{ data: string }>("SELECT data FROM lorebook_entries WHERE id = ?", r.entry_id);
    if (!row) throw notFound("That entry is gone");
    const before = parseJson<LoreEntry>(row.data, {} as LoreEntry);
    updateEntry(r.entry_id, { ...before, content: edited?.trim() || d.core!.after });
    run("UPDATE chronicle_proposals SET status = 'accepted', updated_at = ? WHERE id = ?", now(), id);
    return {
      chatId: r.chat_id,
      undo: stashRestore("Rewrite", () => {
        updateEntry(r.entry_id, before);
        run("UPDATE chronicle_proposals SET status = 'open', updated_at = ? WHERE id = ?", now(), id);
      }),
    };
  }
  let ops = d.ops;
  if (edited?.trim()) {
    const lines = edited.split("\n").map((l) => l.trim()).filter(Boolean);
    ops = ops.map((o, i) => {
      const l = lines[i]?.replace(/^[+−-]\s*/, "");
      if (!l || o.op === "retire") return o;
      const v = l.includes("→") ? l.split("→").at(-1)!.trim() : o.slot && l.toLowerCase().startsWith(`${o.slot}:`) ? l.slice(o.slot.length + 1).trim() : l;
      return v ? { ...o, value: v } : o;
    });
  }
  const applied = applyOps(r.entry_id, r.chat_id, ops, { force: Boolean(d.contradiction) });
  run("UPDATE chronicle_proposals SET status = 'accepted', diff = ?, updated_at = ? WHERE id = ?", JSON.stringify({ ...d, ops, applied }), now(), id);
  return {
    chatId: r.chat_id,
    undo: stashRestore("Lore update", () => {
      revertApplied(r.entry_id, r.chat_id, applied);
      run("UPDATE chronicle_proposals SET status = 'open', diff = ?, updated_at = ? WHERE id = ?", JSON.stringify(d), now(), id);
    }),
  };
}

/** 2.4 after a card is applied: the core may now read wrong. */
export async function afterApplied(id: string) {
  const r = proposalRow(id);
  if (!r || r.kind !== "update" || r.status !== "accepted") return null;
  const chat = getChatRow(r.chat_id);
  if (!chat) return null;
  const e = scanEntriesFor({ characterId: chat.character_id, personaId: chat.persona_id, chatId: r.chat_id }).find((x) => x.id === r.entry_id);
  return e && !sinceCardOf(e) ? proposeCore(r.chat_id, e, diffOf(r).ops) : null;
}

/** For the Inbox card: the title, why, and the diff as lines. */
export function cardText(p: UpdateProposal) {
  if (p.kind === "core")
    return { title: `${p.title}: its text still says the old thing`, why: `It says “${p.diff.core!.stale[0]?.slice(0, 120) ?? ""}”. Keep the rewritten text, edit it, or leave it for now.`, before: p.diff.core!.before, after: p.diff.core!.after };
  const lines = p.diff.ops.map(opLine);
  const from = p.diff.ops.find((o) => o.citeText)?.citeText;
  // Since the card: the card stays as written; the line goes on this chat's note beside it.
  if (p.title.startsWith("Since the card:")) {
    const against = p.diff.ops.find((o) => o.against)?.against;
    return {
      title: p.diff.contradiction ? `${p.title}: the story contradicts a line you wrote` : p.title,
      why: p.diff.contradiction
        ? "You wrote this line, so it wasn't changed. Keep yours, or update it to what the story says."
        : `${against ? `The card says “${against.slice(0, 140)}”. ` : ""}From the story${from ? `: “${from.slice(0, 140)}”` : ""}. Applying adds it to this chat's note on who they are now; the card itself isn't changed.`,
      before: null,
      after: lines.join("\n"),
    };
  }
  const tracker = p.diff.ops.every((o) => o.origin === "tracker");
  const worn = p.diff.ops.find((o) => o.note)?.note;
  return {
    title: p.diff.contradiction ? `${p.title}: the story contradicts a locked fact` : worn ? `${p.title}: over by now?` : `Lore update: ${p.title}`,
    why: p.diff.contradiction
      ? "You locked this fact, so it wasn't changed. Keep yours, or update it to what the story says."
      : worn
        ? `${worn} Applying retires it (kept in History); Not this keeps it.`
        : tracker
        ? "The story's records changed. Applying keeps the old value in History."
        : `From the story${from ? `: “${from.slice(0, 140)}”` : ""}. Applying keeps the old value in History.`,
    // The lines already show old → new, so there's no separate before.
    before: null,
    after: lines.join("\n"),
  };
}
