import { all, newId, now, one, parseJson, run } from "../db/db";
import { badRequest } from "../lib/http";
import { publish } from "../lib/events";
import { inboxItems, actOnInbox } from "../accuracy/inbox";
import { createAtom, deleteAtom, getAtom, mergeAtoms, restoreAtom, splitAtom, updateAtom } from "../memory/atoms";
import { editJournal, listJournals } from "../memory/journals";
import { editSummary } from "../memory/build";
import { endSceneAfter, newChapterAt } from "../memory/scheduler";
import { getSummary } from "../memory/store";
import { getSetting } from "../lib/settings";
import { createEntry, deleteEntry, scanEntriesFor, updateEntry } from "../lore/service";
import type { LoreEntry } from "../lore/types";
import { createNote, deleteNote } from "../services/notebook";
import { arcAction, authorArc, decideFate, decideProposal, setActor } from "../sim/service";
import { createEntity, deleteEntity, ENTITY_KINDS, type EntityKind, type EntityRow, type EntityStatus, getEntityRow, mergeEntities, resolver, restoreEntity, unmergeEntity, updateEntity } from "../memory/entities";
import { correctMemory } from "../memory/remember";
import type { ProposedChange } from "../assistant/core";
import { type ChatSettings, editMessage, getMessageRow, mustChat, setMessageFlags, softDeleteMessage, updateChat } from "../services/chats";
import { userEditAt, timeskip } from "../trackers/service";
import { castKey, castProfiles, currentFold, deleteEvent, dryRunOps, linesToOps, moveCastProfile, saveCastProfile } from "../trackers/store";
import { parseDuration } from "../trackers/clock";
import { addLesson, deleteLesson, getLesson, lessonsFor, updateLesson } from "../steer/lessons";
import { pressureAction, type PressureAction } from "../trackers/pressures";
import { canonOf, type CanonSettings, laterItem, setCanon } from "../accuracy/canoncut";
import { createOffpage, deleteOffpage, getOffpage, type HintBudget, listOffpage, updateOffpage } from "../accuracy/offpage";

/**
 * What Meus can change in a chat, each through the tool the app already uses for it, so swipes,
 * rewinds and re-reads stay correct. A proposed change is checked before you see it (ledger lines
 * are folded as a dry run; names and ids must exist), and applying one records what undoes it.
 */

export const CHANGE_KINDS = [
  '{"kind": "ledger", "lines": ["…"], "at": <message number, only when a correction holds from an earlier message on>, "why": "short label"} for the story\'s records: the clock and calendar, weather, place, people\'s state, bonds, romance, facts and secrets, things, threads, promises and debts, deadlines, planted details, clues, gauges, custom trackers. Write ledger lines (grammar below), plus these lines only you may write: "rename Old Name: New Name", "edit [\\"chars\\",\\"<id>\\",\\"mood\\",\\"name\\"] = \\"calm\\"" (any field by path as JSON; null removes; ids are in [brackets]), "lock <path>", "unset <path>", and "expose #<secret key>: +1 — why" (a secret’s exposure clock, 0–6). To correct the clock write the right absolute time ("clock: Day 3 21:15"); it may go backwards.',
  '{"kind": "merge", "from": "<cast name>", "into": "<cast name>"} two cast entries that are one person: the first folds into the second in the story, the cast profiles and the Codex;',
  '{"kind": "codex", "id": "<page id or name>", "name": "…", "entityKind": "person|place|object|group|concept", "aliases": ["…"], "description": "…", "status": "active|dead|missing|gone|unknown", "facts": ["the whole new list"]} to edit a Codex page (only the fields that change);',
  '{"kind": "codex_add", "name": "…", "entityKind": "…", "aliases": [], "description": "…"}; {"kind": "codex_merge", "keep": "<page>", "merge": ["<page>", …]}; {"kind": "codex_unmerge", "id": "<page>"}; {"kind": "codex_delete", "id": "<page>"};',
  '{"kind": "memory_fix", "wrong": "what memory gets wrong", "right": "what is true", "ids": ["memory ids, if you know them"]} corrects memories; {"kind": "memory_add", "text": "…", "pin": false}; {"kind": "memory_pin", "id": "…", "pin": true}; {"kind": "memory_forget", "id": "…"};',
  '{"kind": "message", "message": <number>, "text": "the whole corrected message"} fixes a past message (keep every other word as it is);',
  '{"kind": "memory_merge", "ids": ["…", "…"], "text": "the merged memory"}; {"kind": "memory_split", "id": "…", "parts": ["first", "second"]};',
  '{"kind": "summary", "id": "<summary id>", "text": "the whole corrected summary"} fixes a scene or chapter summary; {"kind": "journal", "name": "<whose journal>", "text": "the whole corrected journal"};',
  '{"kind": "message", "message": <number>, "text": "the whole corrected message"} fixes a past message (keep every other word as it is); {"kind": "hide", "message": <number>, "hidden": true} hides a message from the story (the player still sees it); {"kind": "scene_end", "message": <number>} ends the scene after that message; {"kind": "chapter", "message": <number>} starts a new chapter at it;',
  '{"kind": "cue", "text": "…"} a one-time instruction for the next reply; {"kind": "ooc", "text": "…"} a standing out-of-character note; {"kind": "truth", "text": "…"} a story truth sent every turn; {"kind": "timeskip", "duration": "3 days", "note": "…"};',
  '{"kind": "steer", "length": "short|normal|long", "pacing": "slow|normal|fast", "guidance": ["chip names to switch on"], "guidance_off": ["chip names"], "guidance_once": ["chip names, for the next reply only"], "authors_note": "…", "story": {"genre", "tone", "pov", "tense", "style", "intensity", "language"}} (only what changes);',
  '{"kind": "split", "from": "<cast name>", "name": "<the other person>", "aliases": ["names that belong to the other person"], "lines": ["ledger lines about the other person, after they exist"]} when one cast entry is really two people;',
  '{"kind": "world", "arc": "<subplot id>", "action": "hold|resume|nudge|bring_in|drop|edit", "premise": "…", "want": "…", "fear": "…"}; {"kind": "world_arc", "lead": "<name>", "premise": "…"} a new subplot off the page; {"kind": "world_proposal", "id": "…", "accept": true}; {"kind": "world_fate", "arc": "<id>", "choice": "accept|soften|page"}; {"kind": "world_person", "name": "…", "where": "Town › Place", "standing": "…", "flag": "out|hold|wake|none"};',
  '{"kind": "lore", "id": "<entry id>", "comment": "title", "keys": ["…"], "content": "…"} edits a lorebook entry this chat uses; {"kind": "lore_add", "book": "<book id or name>", "comment": "title", "keys": ["…"], "content": "…"};',
  '{"kind": "note", "title": "…", "body": "…"} saves a note in the player\'s notebook for this chat;',
  '{"kind": "inbox", "key": "<inbox key>", "action": "accept|reject", "text": "edited text, if any"} decides a note in the continuity inbox;',
  '{"kind": "lesson", "text": "a short rule the story should follow from now on", "scope": "story|character|everywhere", "why": "…"} keeps a lesson (sent every turn); {"kind": "lesson", "id": "<lesson id>", "status": "kept|off"} switches one on or off;',
  '{"kind": "secret_offpage", "label": "the secret, in a sentence", "never_say": ["words the narration must not use yet"], "hint_as": "how the story may hint at it", "hints": "never|rarely|building"} keeps a secret off the page (the narration doesn’t state it); {"kind": "secret_offpage", "id": "<off-page id>", "status": "revealed|kept", "never_say": […]} reveals one, or changes it;',
  '{"kind": "canon", "source": "the work", "point": "where the story stands in it", "later": [{"kind": "event|character|reveal|term", "text": "…", "terms": ["words that give it away"]}], "wont": ["canon events that won’t happen in this story"], "remove": ["text of a later or wont item"]} changes the canon cutoff (only what changes);',
  '{"kind": "pressure", "name": "<cast name>", "action": "redraw|write|lock|unlock|head|resolve", "text": "for write: what they carry and haven’t said"} a person’s hidden pressure (head: the next scene tests it; resolve: it eases, and moves a bond).',
].join(" ");

/** Kinds the story can't redo by itself, or that Undo can't take back: never pre-ticked. */
const NO_UNDO = "Undo can't take this one back.";

export type UndoStep =
  | { t: "events"; ids: string[] }
  | { t: "profiles"; rows: { key: string; row: { name: string; data: string } | null }[] }
  | { t: "unmerge"; id: string }
  | { t: "remerge"; keep: string; id: string }
  | { t: "entity"; row: EntityRow }
  | { t: "entityDrop"; id: string }
  | { t: "entityRestore"; id: string }
  | { t: "entityDelete"; id: string }
  | { t: "atomDelete"; id: string }
  | { t: "atomRestore"; id: string }
  | { t: "atomPin"; id: string; pinned: boolean }
  | { t: "message"; id: string; content: string }
  | { t: "settings"; patch: Partial<ChatSettings> }
  | { t: "messageDelete"; id: string }
  | { t: "row"; table: "summaries" | "journals" | "memories"; id: string; cols: Record<string, string | number | null> }
  | { t: "atomUnmerge"; keep: string; others: string[]; sources: string[] }
  | { t: "hidden"; id: string; hidden: boolean }
  | { t: "lore"; id: string; entry: LoreEntry }
  | { t: "loreDrop"; id: string }
  | { t: "noteDrop"; id: string }
  | { t: "undismiss"; key: string }
  | { t: "lessonDrop"; id: string }
  | { t: "lessonStatus"; id: string; status: "kept" | "off" | "suggested" | "rejected" }
  | { t: "offpageDrop"; id: string }
  | { t: "offpageRestore"; id: string; patch: { label: string; neverSay: string[]; hintAs: string; hints: HintBudget; status: "kept" | "revealed" } };

type Raw = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");
const strs = (v: unknown) => (Array.isArray(v) ? v.map(str).filter(Boolean) : undefined);

function messageBySeq(chatId: string, n: unknown) {
  const seq = Number(String(n ?? "").replace(/[^\d]/g, ""));
  if (!seq) return undefined;
  return one<{ id: string; seq: number; content: string; status: string }>(
    "SELECT m.id, m.seq, s.content, s.status FROM messages m JOIN swipes s ON s.message_id = m.id AND s.idx = m.active_swipe WHERE m.chat_id = ? AND m.seq = ? AND m.deleted_at IS NULL",
    chatId,
    seq,
  );
}

function entityOf(chatId: string, ref: string): EntityRow | undefined {
  const byId = getEntityRow(ref);
  if (byId && byId.chat_id === chatId && !byId.deleted_at) return byId;
  return resolver(chatId).find(ref);
}

function castChar(chatId: string, name: string) {
  const st = currentFold(chatId).result.state;
  const k = castKey(name);
  return Object.values(st.chars).find((c) => c.id === name || castKey(c.name) === k || c.aliases.some((a) => castKey(a) === k));
}

const entityText = (r: { name: string; kind: string; status: string; aliases: string[]; description: string; facts: string[] }) =>
  [`${r.name} · ${r.kind} · ${r.status}`, r.aliases.length ? `also: ${r.aliases.join(", ")}` : "", r.description, ...r.facts.map((f) => `• ${f}`)].filter(Boolean).join("\n");
const rowView = (r: EntityRow) => ({ name: r.name, kind: r.kind, status: r.status, aliases: parseJson<string[]>(r.aliases, []), description: r.description, facts: parseJson<string[]>(r.facts, []) });

/**
 * Turns what the model proposed into checked changes for the card. Anything that wouldn't apply
 * is dropped, and why goes in `dropped` so Meus can say so.
 */
export function checkChanges(chatId: string, raw: Raw[]): { changes: Omit<ProposedChange, "id">[]; dropped: string[] } {
  const out: Omit<ProposedChange, "id">[] = [];
  const dropped: string[] = [];
  const settings = parseJson<ChatSettings>(mustChat(chatId).settings, {});
  for (const c of raw.slice(0, 20)) {
    const kind = str(c.kind).toLowerCase();
    const why = str(c.why);
    if (kind === "ledger") {
      const lines = (strs(c.lines) ?? []).slice(0, 40);
      const { ops, bad } = linesToOps(lines);
      for (const b of bad) dropped.push(`couldn't read "${b}"`);
      if (!ops.length) continue;
      const at = c.at != null && c.at !== "" ? messageBySeq(chatId, c.at) : undefined;
      if (c.at != null && c.at !== "" && !at) dropped.push(`there's no message #${str(c.at)}`);
      const { results, state: after } = dryRunOps(chatId, ops, at ? { messageId: at.id, seq: at.seq } : undefined);
      const good = ops.filter((_, i) => results[i]!.verdict.ok);
      results.forEach((r, i) => !r.verdict.ok && dropped.push(`"${ops[i]!.raw}": ${r.verdict.reason ?? "it wouldn't apply"}`));
      if (!good.length) continue;
      const shown = results.filter((r) => r.verdict.ok).map((r, i) => (r.changes.length ? r.changes.map((x) => x.text).join("; ") : good[i]!.raw));
      const warns = results.filter((r) => r.verdict.ok && r.verdict.warn).map((r) => r.verdict.warn!);
      // A line that names someone new makes a new cast entry: say so, it's often a misspelt name.
      const before = currentFold(chatId).result.state.chars;
      const added = Object.values(after.chars).filter((x) => !before[x.id]).map((x) => x.name);
      if (added.length) warns.push(`adds ${added.join(", ")} to the cast`);
      out.push({
        kind: "ledger",
        target: at?.id ?? "",
        label: `${why || "Story records"}${at ? ` · from #${at.seq} on` : ""}`,
        before: "",
        after: shown.join("\n"),
        data: { lines: good.map((o) => o.raw), messageId: at?.id ?? null, seq: at?.seq ?? null, ...(warns.length ? { note: warns.join("; ") } : {}) },
      });
    } else if (kind === "merge") {
      const from = castChar(chatId, str(c.from));
      const into = castChar(chatId, str(c.into));
      if (!from || !into) {
        dropped.push(`there's no ${!from ? str(c.from) : str(c.into)} in the cast`);
        continue;
      }
      if (from.id === into.id) continue;
      if (from.isUser) {
        dropped.push("the player's persona can't be merged away");
        continue;
      }
      const res = resolver(chatId);
      const ef = res.find(from.name);
      const ei = res.find(into.name);
      out.push({
        kind: "merge",
        target: into.name,
        label: `Merge ${from.name} into ${into.name}`,
        before: from.name,
        after: into.name,
        data: { from: from.name, into: into.name, codex: ef && ei && ef.id !== ei.id ? { keep: ei.id, merge: ef.id } : null, why },
      });
    } else if (kind === "codex") {
      const r = entityOf(chatId, str(c.id) || str(c.name));
      if (!r) {
        dropped.push(`there's no Codex page for ${str(c.id) || str(c.name)}`);
        continue;
      }
      const cur = rowView(r);
      const ek = str(c.entityKind).toLowerCase() as EntityKind;
      const st = str(c.status).toLowerCase() as EntityStatus;
      const patch: Raw = {};
      if (str(c.name) && str(c.name) !== r.name && str(c.id)) patch.name = str(c.name);
      if (ek && ENTITY_KINDS.includes(ek) && ek !== r.kind) patch.kind = ek;
      if (strs(c.aliases) && JSON.stringify(strs(c.aliases)) !== JSON.stringify(cur.aliases)) patch.aliases = strs(c.aliases);
      if (typeof c.description === "string" && c.description.trim() !== r.description.trim()) patch.description = c.description.trim();
      if (st && ["active", "dead", "missing", "gone", "unknown"].includes(st) && st !== r.status) patch.status = st;
      if (strs(c.facts) && JSON.stringify(strs(c.facts)) !== JSON.stringify(cur.facts)) patch.facts = strs(c.facts)!.slice(0, 40);
      if (!Object.keys(patch).length) continue;
      const next = { ...cur, ...patch } as typeof cur;
      out.push({ kind: "codex", target: r.id, label: `Codex · ${r.name}`, before: entityText(cur), after: entityText(next), data: { patch, why } });
    } else if (kind === "codex_add") {
      const name = str(c.name);
      if (!name || name.length > 80) continue;
      if (resolver(chatId).findExact(name)) {
        dropped.push(`the Codex already has ${name}`);
        continue;
      }
      const ek = str(c.entityKind).toLowerCase() as EntityKind;
      const input = { name, kind: ENTITY_KINDS.includes(ek) ? ek : undefined, aliases: strs(c.aliases) ?? [], description: str(c.description) };
      out.push({ kind: "codex_add", target: name, label: `Codex · new page: ${name}`, before: "", after: entityText({ name, kind: input.kind ?? "?", status: "active", aliases: input.aliases, description: input.description, facts: [] }), data: { input, why } });
    } else if (kind === "codex_merge") {
      const keep = entityOf(chatId, str(c.keep));
      const others = (strs(c.merge) ?? []).map((x) => entityOf(chatId, x)).filter((x): x is EntityRow => Boolean(x && keep && x.id !== keep.id));
      if (!keep || !others.length) {
        dropped.push("couldn't find both Codex pages to merge");
        continue;
      }
      out.push({ kind: "codex_merge", target: keep.id, label: `Codex · merge into ${keep.name}`, before: others.map((o) => o.name).join(", "), after: keep.name, data: { keep: keep.id, ids: others.map((o) => o.id), why } });
    } else if (kind === "codex_unmerge") {
      const ref = str(c.id);
      const r = getEntityRow(ref) ?? one<EntityRow>("SELECT * FROM entities WHERE chat_id = ? AND merged_into IS NOT NULL AND deleted_at IS NULL AND lower(name) = lower(?)", chatId, ref);
      if (!r || r.chat_id !== chatId || !r.merged_into) {
        dropped.push(`${ref} isn't merged into anything`);
        continue;
      }
      out.push({ kind: "codex_unmerge", target: r.id, label: `Codex · ${r.name} stands on its own again`, before: getEntityRow(r.merged_into)?.name ?? "", after: r.name, data: { why } });
    } else if (kind === "codex_delete") {
      const r = entityOf(chatId, str(c.id) || str(c.name));
      if (!r) {
        dropped.push(`there's no Codex page for ${str(c.id) || str(c.name)}`);
        continue;
      }
      out.push({ kind: "codex_delete", target: r.id, label: `Codex · delete ${r.name}`, before: entityText(rowView(r)), after: "", data: { risky: true, why } });
    } else if (kind === "memory_fix") {
      const right = str(c.right);
      if (!right) continue;
      const ids = (strs(c.ids) ?? []).filter((id) => getAtom(id)?.chat_id === chatId);
      out.push({ kind: "memory_fix", target: ids.join(","), label: "Memory · correction", before: str(c.wrong), after: right, data: { wrong: str(c.wrong), ids, why } });
    } else if (kind === "memory_add") {
      const text = str(c.text);
      if (!text) continue;
      out.push({ kind: "memory_add", target: "", label: c.pin ? "Memory · new, pinned" : "Memory · new", before: "", after: text, data: { pin: Boolean(c.pin), why } });
    } else if (kind === "memory_pin" || kind === "memory_forget") {
      const a = getAtom(str(c.id));
      if (!a || a.chat_id !== chatId || a.deleted_at) {
        dropped.push(`there's no memory ${str(c.id)}`);
        continue;
      }
      if (kind === "memory_pin") {
        const pin = c.pin !== false;
        if (Boolean(a.pinned) === pin) continue;
        out.push({ kind, target: a.id, label: pin ? "Memory · pin" : "Memory · unpin", before: a.content, after: a.content, data: { pin, why } });
      } else out.push({ kind, target: a.id, label: "Memory · forget", before: a.content, after: "", data: { risky: true, why } });
    } else if (kind === "message") {
      const m = messageBySeq(chatId, c.message);
      const text = typeof c.text === "string" ? c.text : "";
      if (!m) {
        dropped.push(`there's no message #${str(c.message)}`);
        continue;
      }
      if (m.status === "streaming") {
        dropped.push(`#${m.seq} is still being written`);
        continue;
      }
      if (!text.trim() || text === m.content) continue;
      out.push({ kind: "message", target: m.id, label: `Message #${m.seq}`, before: m.content, after: text, data: { seq: m.seq, risky: true, why } });
    } else if (kind === "cue" || kind === "ooc" || kind === "truth") {
      const text = str(c.text).slice(0, kind === "cue" ? 1000 : kind === "ooc" ? 600 : 300);
      if (!text) continue;
      const before = kind === "cue" ? (settings.cue ?? "") : "";
      out.push({ kind, target: "", label: kind === "cue" ? "Cue for the next reply" : kind === "ooc" ? "Standing OOC note" : "Story truth", before, after: text, data: { why } });
    } else if (kind === "timeskip") {
      const duration = str(c.duration);
      if (!parseDuration(duration)) {
        dropped.push(`couldn't read the time skip "${duration}"`);
        continue;
      }
      out.push({ kind, target: "", label: `Time skip · ${duration}`, before: "", after: str(c.note) || `${duration} later.`, data: { duration, note: str(c.note), why } });
    } else if (kind === "memory_merge") {
      const ids = (strs(c.ids) ?? []).filter((id) => {
        const a = getAtom(id);
        return a && a.chat_id === chatId && !a.deleted_at && a.status !== "superseded";
      });
      if (ids.length < 2) {
        dropped.push("a memory merge needs two memories that exist");
        continue;
      }
      const rows = ids.map((id) => getAtom(id)!);
      out.push({ kind, target: ids[0]!, label: `Memory · merge ${ids.length}`, before: rows.map((r) => r.content).join("\n"), after: str(c.text) || rows.map((r) => r.content).join(" "), data: { ids, why } });
    } else if (kind === "memory_split") {
      const a = getAtom(str(c.id));
      const parts = strs(c.parts) ?? [];
      if (!a || a.chat_id !== chatId || a.deleted_at) {
        dropped.push(`there's no memory ${str(c.id)}`);
        continue;
      }
      if (parts.length !== 2) continue;
      out.push({ kind, target: a.id, label: "Memory · split in two", before: a.content, after: parts.join("\n"), data: { parts, why } });
    } else if (kind === "summary") {
      const r = getSummary(str(c.id));
      const text = str(c.text);
      if (!r || r.chat_id !== chatId) {
        dropped.push(`there's no summary ${str(c.id)}`);
        continue;
      }
      if (!text || text === r.content.trim()) continue;
      out.push({ kind, target: r.id, label: `Summary · ${r.title || r.level}`, before: r.content, after: text, data: { why } });
    } else if (kind === "journal") {
      const want = castKey(str(c.name) || str(c.id));
      const j = listJournals(chatId).find((x) => x.id === str(c.id) || castKey(x.name) === want);
      const text = str(c.text);
      if (!j) {
        dropped.push(`there's no journal for ${str(c.name) || str(c.id)}`);
        continue;
      }
      if (!text || text === j.content.trim()) continue;
      out.push({ kind, target: j.id, label: `Journal · ${j.name}`, before: j.content, after: text, data: { why } });
    } else if (kind === "hide" || kind === "scene_end" || kind === "chapter") {
      const m = messageBySeq(chatId, c.message);
      if (!m) {
        dropped.push(`there's no message #${str(c.message)}`);
        continue;
      }
      if (kind === "hide") {
        const hidden = c.hidden !== false;
        if (Boolean(getMessageRow(m.id)?.hidden) === hidden) continue;
        out.push({ kind, target: m.id, label: `${hidden ? "Hide" : "Show"} #${m.seq} ${hidden ? "from" : "to"} the story`, before: "", after: clipText(m.content, 160), data: { hidden, seq: m.seq, why } });
      } else
        out.push({ kind, target: m.id, label: kind === "scene_end" ? `End the scene after #${m.seq}` : `New chapter at #${m.seq}`, before: "", after: clipText(m.content, 160), data: { seq: m.seq, risky: true, note: NO_UNDO, noUndo: true, why } });
    } else if (kind === "steer") {
      const patch: Partial<ChatSettings> = {};
      const prev: Record<string, unknown> = {};
      const shown: string[] = [];
      const len = str(c.length).toLowerCase();
      if (["short", "normal", "long"].includes(len) && len !== (settings.length ?? "normal")) {
        patch.length = len as "short";
        shown.push(`Reply length: ${settings.length ?? "normal"} → ${len}`);
      }
      const pace = str(c.pacing).toLowerCase();
      if (["slow", "normal", "fast"].includes(pace) && pace !== (settings.pacing ?? "normal")) {
        patch.pacing = pace as "slow";
        shown.push(`Pacing: ${settings.pacing ?? "normal"} → ${pace}`);
      }
      const chips = getSetting("chat.guidance");
      const chip = (n: string) => chips.find((g) => g.id === n || g.name.toLowerCase() === n.toLowerCase());
      const on = (strs(c.guidance) ?? []).map(chip).filter((g): g is NonNullable<typeof g> => Boolean(g));
      const off = (strs(c.guidance_off) ?? []).map(chip).filter((g): g is NonNullable<typeof g> => Boolean(g));
      const once = (strs(c.guidance_once) ?? []).map(chip).filter((g): g is NonNullable<typeof g> => Boolean(g));
      for (const n of [...(strs(c.guidance) ?? []), ...(strs(c.guidance_off) ?? []), ...(strs(c.guidance_once) ?? [])]) if (!chip(n)) dropped.push(`there's no guidance chip "${n}"`);
      if (on.length || off.length || once.length) {
        const active = new Set(settings.guidance?.active ?? []);
        for (const g of on) active.add(g.id);
        for (const g of off) active.delete(g.id);
        patch.guidance = { active: [...active], once: [...new Set([...(settings.guidance?.once ?? []), ...once.map((g) => g.id)])] };
        if (on.length) shown.push(`Guidance on: ${on.map((g) => g.name).join(", ")}`);
        if (off.length) shown.push(`Guidance off: ${off.map((g) => g.name).join(", ")}`);
        if (once.length) shown.push(`Guidance for the next reply: ${once.map((g) => g.name).join(", ")}`);
      }
      if (typeof c.authors_note === "string" && c.authors_note.trim() !== (settings.authorsNote?.content ?? "").trim()) {
        patch.authorsNote = { content: c.authors_note.trim(), depth: settings.authorsNote?.depth ?? 4, role: settings.authorsNote?.role ?? "system" };
        shown.push(`Author's note: ${c.authors_note.trim() || "(cleared)"}`);
      }
      if (c.story && typeof c.story === "object") {
        const allowed = { genre: 60, tone: 60, pov: 40, tense: 20, style: 200, intensity: 40, language: 30 } as const;
        const next = { ...(settings.story ?? {}) } as Record<string, string>;
        for (const [k, v] of Object.entries(c.story as Raw)) {
          const max = allowed[k as keyof typeof allowed];
          const val = str(v).slice(0, max);
          if (max && val !== (next[k] ?? "")) {
            shown.push(`Story ${k}: ${next[k] || "(none)"} → ${val || "(none)"}`);
            next[k] = val;
          }
        }
        if (JSON.stringify(next) !== JSON.stringify(settings.story ?? {})) patch.story = next;
      }
      if (!shown.length) continue;
      for (const k of Object.keys(patch)) prev[k] = (settings as Record<string, unknown>)[k] ?? (k === "story" || k === "guidance" ? {} : null);
      out.push({ kind, target: "", label: "How the story is steered", before: "", after: shown.join("\n"), data: { patch, prev, why } });
    } else if (kind === "split") {
      const from = castChar(chatId, str(c.from));
      const name = str(c.name);
      if (!from) {
        dropped.push(`there's no ${str(c.from)} in the cast`);
        continue;
      }
      if (!name || castKey(name) === castKey(from.name)) continue;
      const other = castChar(chatId, name);
      if (other && other.id !== from.id) {
        dropped.push(`${name} is already in the cast on their own`);
        continue;
      }
      const moving = new Set([castKey(name), ...(strs(c.aliases) ?? []).map(castKey)]);
      const keep = from.aliases.filter((a) => !moving.has(castKey(a)));
      const movedAliases = from.aliases.filter((a) => moving.has(castKey(a)) && castKey(a) !== castKey(name));
      // First the two entries; then the other person's own names and lines, by their new id.
      const base = [`edit ${JSON.stringify(["chars", from.id, "aliases"])} = ${JSON.stringify(keep)}`, `cast: ${name}@${from.tier === "spot" || from.tier === "peri" ? from.tier : "left"}`];
      const first = dryRunOps(chatId, linesToOps(base).ops).state;
      const born = Object.values(first.chars).find((x) => castKey(x.name) === castKey(name));
      const lines = [...base, ...(born && movedAliases.length ? [`edit ${JSON.stringify(["chars", born.id, "aliases"])} = ${JSON.stringify(movedAliases)}`] : []), ...(strs(c.lines) ?? []).slice(0, 20)];
      const { ops, bad } = linesToOps(lines);
      for (const b of bad) dropped.push(`couldn't read "${b}"`);
      const { results } = dryRunOps(chatId, ops);
      const good = ops.filter((_, i) => results[i]!.verdict.ok);
      results.forEach((r, i) => !r.verdict.ok && dropped.push(`"${ops[i]!.raw}": ${r.verdict.reason ?? "it wouldn't apply"}`));
      if (!results[0]?.verdict.ok || !results[1]?.verdict.ok) {
        dropped.push(`couldn't split ${name} from ${from.name}`);
        continue;
      }
      const page = one<EntityRow>("SELECT * FROM entities WHERE chat_id = ? AND merged_into IS NOT NULL AND deleted_at IS NULL AND lower(name) = lower(?)", chatId, name);
      out.push({
        kind,
        target: from.id,
        label: `Split ${name} from ${from.name}`,
        before: [from.name, ...from.aliases].join(", "),
        after: `${[from.name, ...keep].join(", ")}\n${[name, ...movedAliases].join(", ")}`,
        data: { lines: good.map((o) => o.raw), unmerge: page?.id ?? null, why, note: "Past messages stay with the first person in the story's history; from here on they are two people." },
      });
    } else if (kind === "world" || kind === "world_arc" || kind === "world_proposal" || kind === "world_fate" || kind === "world_person") {
      const st = currentFold(chatId).result.state;
      if (kind === "world") {
        const arc = st.sim.arcs[str(c.arc) || str(c.id)];
        const action = str(c.action).toLowerCase().replace("bring_in", "bringIn").replace("bringin", "bringIn");
        if (!arc) {
          dropped.push(`there's no subplot ${str(c.arc) || str(c.id)}`);
          continue;
        }
        if (!["hold", "resume", "nudge", "bringIn", "drop", "edit"].includes(action)) continue;
        const patch = { ...(str(c.premise) ? { premise: str(c.premise) } : {}), ...(str(c.want) ? { want: str(c.want) } : {}), ...(str(c.fear) ? { fear: str(c.fear) } : {}) };
        if (action === "edit" && !Object.keys(patch).length) continue;
        const verb = { hold: "Hold", resume: "Resume", nudge: "Nudge", bringIn: "Bring onto the page", drop: "Drop", edit: "Rewrite" }[action];
        out.push({ kind, target: arc.id, label: `World · ${verb}: ${arc.leadName}'s subplot`, before: action === "edit" ? arc.premise : "", after: action === "edit" ? (patch.premise ?? arc.premise) : arc.premise, data: { action, patch, why } });
      } else if (kind === "world_arc") {
        const lead = str(c.lead);
        const premise = str(c.premise);
        if (!lead || !premise) continue;
        if (!st.time) {
          dropped.push("the world off the page starts once the story clock is set");
          continue;
        }
        out.push({ kind, target: lead, label: `World · a subplot for ${lead}`, before: "", after: premise, data: { lead, premise, why } });
      } else if (kind === "world_proposal") {
        const p = st.sim.proposals[str(c.id)];
        if (!p) {
          dropped.push(`there's no world proposal ${str(c.id)}`);
          continue;
        }
        const accept = c.accept !== false;
        out.push({ kind, target: p.id, label: `World · ${accept ? "start" : "turn down"} ${p.leadName}'s subplot`, before: "", after: p.premise, data: { accept, why } });
      } else if (kind === "world_fate") {
        const arc = st.sim.arcs[str(c.arc) || str(c.id)];
        const choice = str(c.choice).toLowerCase();
        if (!arc?.fate) {
          dropped.push(`nothing is waiting on subplot ${str(c.arc) || str(c.id)}`);
          continue;
        }
        if (!["accept", "soften", "page"].includes(choice)) continue;
        out.push({ kind, target: arc.id, label: `World · ${choice === "accept" ? "let it happen" : choice === "soften" ? "soften it" : "keep it for the page"}: ${arc.leadName}`, before: "", after: arc.fate.text, data: { choice, ...(choice === "accept" ? { risky: true } : {}), why } });
      } else {
        const name = str(c.name);
        if (!name) continue;
        const flag = str(c.flag).toLowerCase();
        const patch = { ...(str(c.where) ? { where: str(c.where) } : {}), ...(str(c.standing) ? { standing: str(c.standing) } : {}), ...(["out", "hold", "wake"].includes(flag) ? { flag } : flag === "none" ? { flag: null } : {}) };
        if (!Object.keys(patch).length) continue;
        out.push({ kind, target: name, label: `World · ${name} off the page`, before: "", after: Object.entries(patch).map(([k, v]) => `${k}: ${v ?? "none"}`).join("\n"), data: { name, patch, why } });
      }
    } else if (kind === "lore" || kind === "lore_add") {
      const chat = mustChat(chatId);
      const entries = scanEntriesFor({ characterId: chat.character_id, personaId: chat.persona_id, chatId });
      if (kind === "lore") {
        const e = entries.find((x) => x.id === str(c.id));
        if (!e) {
          dropped.push(`there's no lore entry ${str(c.id)} in this chat's lorebooks`);
          continue;
        }
        const next = { ...e, ...(str(c.comment) ? { comment: str(c.comment) } : {}), ...(strs(c.keys)?.length ? { keys: strs(c.keys)! } : {}), ...(typeof c.content === "string" ? { content: c.content.trim() } : {}) };
        const text = (x: { comment: string; keys: string[]; content: string }) => `${x.comment}\nkeys: ${x.keys.join(", ")}\n${x.content}`;
        if (text(next) === text(e)) continue;
        out.push({ kind, target: e.id, label: `Lore · ${e.bookName}: ${e.comment || e.keys[0] || "entry"}`, before: text(e), after: text(next), data: { comment: next.comment, keys: next.keys, content: next.content, why } });
      } else {
        const books = new Map(entries.map((x) => [x.bookId, x.bookName]));
        const chatBooks = all<{ id: string; name: string }>("SELECT b.id, b.name FROM lorebooks b JOIN lorebook_links l ON l.lorebook_id = b.id WHERE b.deleted_at IS NULL AND ((l.target_type = 'chat' AND l.target_id = ?) OR (l.target_type = 'character' AND l.target_id = ?) OR (l.target_type = 'persona' AND l.target_id = ?))", chatId, chat.character_id ?? "", chat.persona_id ?? "");
        for (const b of chatBooks) books.set(b.id, b.name);
        const ref = str(c.book);
        const book = [...books].find(([id, name]) => id === ref || name.toLowerCase() === ref.toLowerCase()) ?? (books.size === 1 ? [...books][0] : undefined);
        const content = str(c.content);
        if (!book) {
          dropped.push(ref ? `this chat doesn't use a lorebook called ${ref}` : "say which lorebook the entry goes in");
          continue;
        }
        if (!content) continue;
        const keys = strs(c.keys) ?? [];
        out.push({ kind, target: book[0], label: `Lore · new entry in ${book[1]}: ${str(c.comment) || keys[0] || "entry"}`, before: "", after: `${str(c.comment)}\nkeys: ${keys.join(", ")}\n${content}`, data: { comment: str(c.comment), keys, content, why } });
      }
    } else if (kind === "note") {
      const body = str(c.body);
      if (!body) continue;
      out.push({ kind, target: "", label: `Note · ${str(c.title) || "from Meus"}`, before: "", after: body, data: { title: str(c.title).slice(0, 200), why } });
    } else if (kind === "inbox") {
      const item = inboxItems({ chatId }).find((x) => x.key === str(c.key));
      const action = str(c.action).toLowerCase() === "reject" ? "reject" : "accept";
      if (!item) {
        dropped.push(`there's no inbox note ${str(c.key)}`);
        continue;
      }
      const text = item.editable ? str(c.text) : "";
      const undoable = ["summary", "journal", "disputed", "merge", "world"].includes(item.kind);
      out.push({
        kind,
        target: item.key,
        label: `Inbox · ${action === "accept" ? "accept" : "reject"}: ${item.title}`,
        before: item.before ?? "",
        after: text || item.after,
        data: { action, text, item: item.kind, ...(undoable ? {} : { risky: true, noUndo: true, note: NO_UNDO }), why },
      });
    } else if (kind === "lesson") {
      // A1: keep a new lesson, or switch one on or off.
      const ref = str(c.id);
      if (ref) {
        const l = lessonsFor(chatId).find((x) => x.id === ref);
        const status = str(c.status).toLowerCase() === "off" ? "off" : "kept";
        if (!l) {
          dropped.push(`there's no lesson ${ref}`);
          continue;
        }
        if (l.status === status) continue;
        out.push({ kind, target: l.id, label: `Lesson · ${status === "kept" ? "keep" : "switch off"}`, before: l.text, after: l.text, data: { status, prev: l.status, why } });
        continue;
      }
      const text = str(c.text).slice(0, 300);
      if (!text) continue;
      const sc = str(c.scope).toLowerCase();
      const scope = sc === "character" || sc === "everywhere" ? sc : "story";
      out.push({ kind, target: "", label: `Lesson · ${scope === "story" ? "this story" : scope === "character" ? "this character, in every chat" : "every story"}`, before: "", after: text, data: { scope, why } });
    } else if (kind === "secret_offpage") {
      // B1: keep a secret off the page, or reveal / change one.
      const ref = str(c.id);
      const hints = (["never", "rarely", "building"] as const).find((h) => h === str(c.hints).toLowerCase());
      const never = strs(c.never_say);
      if (ref) {
        const o = listOffpage(chatId).find((x) => x.id === ref);
        if (!o) {
          dropped.push(`there's no off-page secret ${ref}`);
          continue;
        }
        const status = str(c.status).toLowerCase() === "revealed" ? "revealed" : str(c.status).toLowerCase() === "kept" ? "kept" : o.status;
        const patch = { ...(never ? { neverSay: never } : {}), ...(typeof c.hint_as === "string" ? { hintAs: str(c.hint_as) } : {}), ...(hints ? { hints } : {}), ...(status !== o.status ? { status } : {}) };
        if (!Object.keys(patch).length) continue;
        out.push({ kind, target: o.id, label: status === "revealed" && o.status !== "revealed" ? "Off the page · reveal" : "Off the page · change", before: `${o.label}
never say: ${o.neverSay.join(", ")}`, after: `${o.label}
never say: ${(never ?? o.neverSay).join(", ")}${status !== o.status ? `
${status}` : ""}`, data: { patch, why } });
        continue;
      }
      const label = str(c.label).slice(0, 300);
      if (!label) continue;
      out.push({ kind, target: "", label: "Keep a secret off the page", before: "", after: `${label}${never?.length ? `
never say: ${never.join(", ")}` : ""}${str(c.hint_as) ? `
may hint as: ${str(c.hint_as)}` : ""}`, data: { label, neverSay: never ?? [], hintAs: str(c.hint_as), hints: hints ?? "rarely", why } });
    } else if (kind === "canon") {
      // C1: the canon cutoff, as a whole new value (Undo puts the old one back).
      const cur = canonOf(chatId);
      const next = { ...cur };
      const shown: string[] = [];
      if (str(c.source) && str(c.source) !== (cur.source ?? "")) {
        next.source = str(c.source).slice(0, 120);
        shown.push(`Source: ${next.source}`);
      }
      if (str(c.point) && str(c.point) !== (cur.point ?? "")) {
        next.point = str(c.point).slice(0, 200);
        shown.push(`Stands at: ${next.point}`);
      }
      const adds = (Array.isArray(c.later) ? c.later : []).map((x) => (typeof x === "string" ? { kind: "event", text: x } : (x as Raw))).filter((x) => str(x.text));
      if (adds.length) {
        next.later = [...(cur.later ?? []), ...adds.slice(0, 20).map((x) => laterItem((["event", "character", "reveal", "term"].includes(str(x.kind)) ? str(x.kind) : "event") as "event", str(x.text), strs(x.terms) ?? []))];
        shown.push(...adds.slice(0, 20).map((x) => `Hasn't happened: ${str(x.text)}`));
      }
      const wont = strs(c.wont) ?? [];
      if (wont.length) {
        next.wont = [...(cur.wont ?? []), ...wont.map((t) => ({ id: newId().slice(0, 8), text: t.slice(0, 300) }))];
        shown.push(...wont.map((t) => `Won't happen here: ${t}`));
      }
      const remove = (strs(c.remove) ?? []).map((t) => t.toLowerCase());
      if (remove.length) {
        const hit = (i: { id: string; text: string }) => remove.includes(i.id.toLowerCase()) || remove.includes(i.text.toLowerCase());
        next.later = (next.later ?? []).filter((i) => !hit(i));
        next.wont = (next.wont ?? []).filter((i) => !hit(i));
        shown.push(`Removed: ${remove.join(", ")}`);
      }
      if (!shown.length) continue;
      out.push({ kind, target: "", label: "Canon cutoff", before: "", after: shown.join("\n"), data: { next, why } });
    } else if (kind === "pressure") {
      // E1: a hidden pressure, through the same actions as the Story page's card.
      const who = castChar(chatId, str(c.name));
      const action = str(c.action).toLowerCase();
      if (!who || who.isUser) {
        dropped.push(`there's no ${str(c.name)} in the cast`);
        continue;
      }
      if (!["redraw", "write", "lock", "unlock", "head", "resolve"].includes(action)) continue;
      if (action === "write" && !str(c.text)) continue;
      if (action !== "redraw" && action !== "write" && !who.pressure) {
        dropped.push(`${who.name} has no pressure yet`);
        continue;
      }
      const verb = { redraw: "redraw", write: "set", lock: "lock", unlock: "unlock", head: "bring to a head", resolve: "resolve" }[action];
      out.push({ kind, target: who.id, label: `Pressure · ${verb}: ${who.name}`, before: who.pressure?.text ?? "", after: action === "write" ? str(c.text) : (who.pressure?.text ?? "(a new draw)"), data: { action, text: str(c.text), why } });
    } else if (kind) dropped.push(`Meus can't make "${kind}" changes yet`);
  }
  return { changes: out, dropped };
}

const clipText = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** The columns a row step restores. */
const ROW_COLS = {
  summaries: ["title", "content", "tokens", "user_edited", "state", "proposal"],
  journals: ["content", "user_edited", "proposal"],
  memories: ["content", "entities", "importance", "pinned", "user_edited", "status", "superseded_by", "min_seq", "max_seq", "stale", "deleted_at"],
} as const;

function rowStep(table: keyof typeof ROW_COLS, id: string): UndoStep {
  const r = one<Record<string, string | number | null>>(`SELECT ${ROW_COLS[table].join(", ")} FROM ${table} WHERE id = ?`, id);
  return { t: "row", table, id, cols: r ?? {} };
}

function snapshotProfiles(chatId: string, names: string[]) {
  const all_ = castProfiles(chatId);
  return names.map((n) => {
    const key = castKey(n);
    const p = all_[key];
    return { key, row: p ? { name: p.name, data: JSON.stringify(p) } : null };
  });
}

/** Applies one checked change; returns what undoes it. */
export function applyChange(chatId: string, c: ProposedChange): UndoStep[] {
  const d = c.data ?? {};
  switch (c.kind) {
    case "ledger": {
      const { ops } = linesToOps((d.lines as string[]) ?? []);
      if (!ops.length) return [];
      return [{ t: "events", ids: userEditAt(chatId, ops, (d.messageId as string | null) ?? null) }];
    }
    case "merge": {
      const from = String(d.from);
      const into = String(d.into);
      const steps: UndoStep[] = [];
      steps.push({ t: "profiles", rows: snapshotProfiles(chatId, [from, into]) });
      const raw = `merge ${from} → ${into}`;
      const ids = userEditAt(chatId, [{ op: "merge", subject: from, args: { to: into }, raw }]);
      steps.push({ t: "events", ids });
      const verdict = currentFold(chatId).result.verdicts[ids[0]!];
      if (verdict && !verdict.ok) {
        for (const id of ids) deleteEvent(chatId, id);
        throw badRequest(verdict.reason ?? "Couldn't merge them");
      }
      moveCastProfile(chatId, from, into);
      const codex = d.codex as { keep: string; merge: string } | null;
      if (codex && getEntityRow(codex.keep) && getEntityRow(codex.merge) && !getEntityRow(codex.merge)!.merged_into) {
        mergeEntities(codex.keep, [codex.merge]);
        steps.push({ t: "unmerge", id: codex.merge });
      }
      return steps;
    }
    case "codex": {
      const r = getEntityRow(c.target);
      if (!r) throw badRequest("That Codex page is gone");
      updateEntity(c.target, d.patch as Parameters<typeof updateEntity>[1]);
      return [{ t: "entity", row: r }];
    }
    case "codex_add":
      return [{ t: "entityDrop", id: createEntity(chatId, d.input as Parameters<typeof createEntity>[1]).id }];
    case "codex_merge": {
      const ids = (d.ids as string[]).filter((id) => getEntityRow(id) && !getEntityRow(id)!.merged_into);
      if (!ids.length) return [];
      mergeEntities(String(d.keep), ids);
      return ids.map((id) => ({ t: "unmerge", id }) as UndoStep);
    }
    case "codex_unmerge": {
      const r = getEntityRow(c.target);
      if (!r?.merged_into) return [];
      const keep = r.merged_into;
      unmergeEntity(c.target);
      return [{ t: "remerge", keep, id: c.target }];
    }
    case "codex_delete":
      deleteEntity(c.target);
      return [{ t: "entityRestore", id: c.target }];
    case "memory_fix": {
      const r = correctMemory(chatId, { wrong: String(d.wrong ?? ""), right: c.after, memoryIds: (d.ids as string[]) ?? [] });
      return [{ t: "atomDelete", id: r.memory.id }];
    }
    case "memory_add": {
      const a = createAtom(chatId, { type: "fact", content: c.after, importance: 7, pinned: Boolean(d.pin) });
      return [{ t: "atomDelete", id: a.id }];
    }
    case "memory_pin": {
      const a = getAtom(c.target);
      if (!a) return [];
      updateAtom(c.target, { pinned: Boolean(d.pin) });
      return [{ t: "atomPin", id: c.target, pinned: Boolean(a.pinned) }];
    }
    case "memory_forget":
      deleteAtom(c.target);
      return [{ t: "atomRestore", id: c.target }];
    case "message": {
      const cur = messageBySeq(chatId, d.seq);
      if (!cur || cur.id !== c.target) throw badRequest("That message is gone");
      editMessage(c.target, c.after);
      return [{ t: "message", id: c.target, content: cur.content }];
    }
    case "cue":
    case "ooc":
    case "truth": {
      const s = parseJson<ChatSettings>(mustChat(chatId).settings, {});
      if (c.kind === "cue") {
        updateChat(chatId, { settings: { cue: c.after } });
        return [{ t: "settings", patch: { cue: s.cue ?? null } }];
      }
      if (c.kind === "ooc") {
        updateChat(chatId, { settings: { ooc: [...(s.ooc ?? []), { id: newId(), text: c.after }].slice(-20) } });
        return [{ t: "settings", patch: { ooc: s.ooc ?? [] } }];
      }
      updateChat(chatId, { settings: { truths: [...(s.truths ?? []), c.after].slice(-30) } });
      return [{ t: "settings", patch: { truths: s.truths ?? [] } }];
    }
    case "timeskip":
      return [{ t: "messageDelete", id: timeskip(chatId, String(d.duration), String(d.note ?? "") || undefined).messageId }];
    case "memory_merge": {
      const ids = (d.ids as string[]).filter((id) => getAtom(id) && !getAtom(id)!.deleted_at);
      if (ids.length < 2) throw badRequest("Those memories are gone");
      const steps: UndoStep[] = [rowStep("memories", ids[0]!)];
      const sources = all<{ message_id: string }>("SELECT message_id FROM memory_sources WHERE memory_id = ?", ids[0]!).map((r) => r.message_id);
      mergeAtoms(ids, c.after);
      steps.push({ t: "atomUnmerge", keep: ids[0]!, others: ids.slice(1), sources });
      return steps;
    }
    case "memory_split": {
      const step = rowStep("memories", c.target);
      const [, second] = splitAtom(c.target, d.parts as [string, string]);
      return [step, { t: "atomDelete", id: second!.id }];
    }
    case "summary": {
      const step = rowStep("summaries", c.target);
      if (!editSummary(c.target, { content: c.after })) throw badRequest("That summary is gone");
      return [step];
    }
    case "journal": {
      const step = rowStep("journals", c.target);
      editJournal(c.target, c.after);
      return [step];
    }
    case "hide": {
      const m = getMessageRow(c.target);
      if (!m) throw badRequest("That message is gone");
      setMessageFlags(c.target, { hidden: Boolean(d.hidden) });
      return [{ t: "hidden", id: c.target, hidden: Boolean(m.hidden) }];
    }
    case "scene_end":
      endSceneAfter(chatId, c.target);
      return [];
    case "chapter":
      newChapterAt(chatId, c.target);
      return [];
    case "steer":
      updateChat(chatId, { settings: d.patch as ChatSettings });
      return [{ t: "settings", patch: d.prev as Partial<ChatSettings> }];
    case "split": {
      const { ops } = linesToOps((d.lines as string[]) ?? []);
      const steps: UndoStep[] = [{ t: "events", ids: userEditAt(chatId, ops) }];
      const page = d.unmerge as string | null;
      if (page && getEntityRow(page)?.merged_into) {
        const keep = getEntityRow(page)!.merged_into!;
        unmergeEntity(page);
        steps.push({ t: "remerge", keep, id: page });
      }
      return steps;
    }
    case "world": {
      const action = String(d.action) as Parameters<typeof arcAction>[2];
      return [{ t: "events", ids: arcAction(chatId, c.target, action, (d.patch as { premise?: string }) ?? {}) }];
    }
    case "world_arc":
      return [{ t: "events", ids: authorArc(chatId, String(d.lead), String(d.premise)).eventIds }];
    case "world_proposal":
      return [{ t: "events", ids: decideProposal(chatId, c.target, Boolean(d.accept)) }];
    case "world_fate":
      return [{ t: "events", ids: decideFate(chatId, c.target, String(d.choice) as "accept") }];
    case "world_person":
      return [{ t: "events", ids: setActor(chatId, String(d.name), d.patch as Parameters<typeof setActor>[2]) }];
    case "lore": {
      const r = one<{ data: string }>("SELECT data FROM lorebook_entries WHERE id = ?", c.target);
      if (!r) throw badRequest("That lore entry is gone");
      const before = parseJson<LoreEntry>(r.data, {} as LoreEntry);
      updateEntry(c.target, { ...before, comment: String(d.comment ?? before.comment), keys: (d.keys as string[]) ?? before.keys, content: String(d.content ?? before.content) });
      return [{ t: "lore", id: c.target, entry: before }];
    }
    case "lore_add":
      return [{ t: "loreDrop", id: createEntry(c.target, { comment: String(d.comment ?? ""), keys: (d.keys as string[]) ?? [], content: String(d.content ?? "") }).id }];
    case "note":
      return [{ t: "noteDrop", id: createNote({ chatId, title: String(d.title ?? ""), body: c.after }).id }];
    case "lesson": {
      if (c.target) {
        const prev = String(d.prev ?? "kept") as "kept";
        updateLesson(c.target, { status: d.status === "off" ? "off" : "kept", chatId });
        return [{ t: "lessonStatus", id: c.target, status: prev }];
      }
      return [{ t: "lessonDrop", id: addLesson(chatId, { text: c.after, scope: (d.scope as "story") ?? "story", why: String(d.why ?? ""), by: "user", from: "meus" }).id }];
    }
    case "pressure":
      return [{ t: "events", ids: pressureAction(chatId, c.target, String(d.action) as PressureAction, String(d.text ?? "")).ids }];
    case "canon": {
      const s = parseJson<ChatSettings>(mustChat(chatId).settings, {});
      setCanon(chatId, d.next as CanonSettings);
      return [{ t: "settings", patch: { canon: s.canon ?? {}, truths: s.truths ?? [] } }];
    }
    case "secret_offpage": {
      if (c.target) {
        const o = getOffpage(c.target);
        if (!o) throw badRequest("That secret is gone");
        updateOffpage(o.id, d.patch as Parameters<typeof updateOffpage>[1]);
        return [{ t: "offpageRestore", id: o.id, patch: { label: o.label, neverSay: o.neverSay, hintAs: o.hintAs, hints: o.hints, status: o.status } }];
      }
      return [{ t: "offpageDrop", id: createOffpage(chatId, { label: String(d.label), neverSay: (d.neverSay as string[]) ?? [], hintAs: String(d.hintAs ?? ""), hints: (d.hints as HintBudget) ?? "rarely" }).id }];
    }
    case "inbox": {
      const key = c.target;
      const [ik, ...rest] = key.split(":");
      const id = rest.join(":");
      const action = d.action === "reject" ? "reject" : "accept";
      const text = (d.text as string) || undefined;
      if (ik === "world") {
        const [, ...pid] = id.split(":");
        const ids = decideProposal(chatId, pid.join(":"), action === "accept");
        publish({ type: "inbox.changed" });
        return [{ t: "events", ids }];
      }
      const steps: UndoStep[] = [];
      if (ik === "summary") steps.push(rowStep("summaries", id));
      else if (ik === "journal") steps.push(rowStep("journals", id));
      else if (ik === "disputed") steps.push(rowStep("memories", id));
      actOnInbox(key, action, text);
      if (ik === "merge") {
        const [, merge] = id.split("|");
        steps.push(action === "accept" ? { t: "unmerge", id: merge! } : { t: "undismiss", key });
      }
      return steps;
    }
  }
  return [];
}

/** Undoes one step (the steps of a set run in reverse). */
export function undoStep(chatId: string, s: UndoStep) {
  switch (s.t) {
    case "events":
      for (const id of s.ids) deleteEvent(chatId, id);
      return;
    case "profiles":
      for (const p of s.rows) {
        run("DELETE FROM cast_profiles WHERE chat_id = ? AND name_key = ?", chatId, p.key);
        if (p.row) saveCastProfile(chatId, p.row.name, parseJson(p.row.data, { name: p.row.name }));
      }
      return;
    case "unmerge":
      if (getEntityRow(s.id)?.merged_into) unmergeEntity(s.id);
      return;
    case "remerge":
      if (getEntityRow(s.keep) && getEntityRow(s.id) && !getEntityRow(s.id)!.merged_into) mergeEntities(s.keep, [s.id]);
      return;
    case "entity": {
      const r = s.row;
      run(
        "UPDATE entities SET name = ?, kind = ?, aliases = ?, description = ?, status = ?, facts = ?, data = ?, user_edited = ?, updated_at = ? WHERE id = ?",
        r.name,
        r.kind,
        r.aliases,
        r.description,
        r.status,
        r.facts,
        r.data,
        r.user_edited,
        now(),
        r.id,
      );
      publish({ type: "memory.changed", chatId });
      return;
    }
    case "entityDrop":
      // A page Meus added goes completely (a tombstone would keep its names from coming back).
      run("DELETE FROM entities WHERE id = ? AND chat_id = ?", s.id, chatId);
      publish({ type: "memory.changed", chatId });
      return;
    case "entityRestore":
      if (getEntityRow(s.id)?.deleted_at) restoreEntity(s.id);
      return;
    case "entityDelete":
      deleteEntity(s.id);
      return;
    case "atomDelete":
      if (getAtom(s.id) && !getAtom(s.id)!.deleted_at) deleteAtom(s.id);
      return;
    case "atomRestore":
      if (getAtom(s.id)?.deleted_at) restoreAtom(s.id);
      return;
    case "atomPin":
      if (getAtom(s.id) && !getAtom(s.id)!.deleted_at) updateAtom(s.id, { pinned: s.pinned });
      return;
    case "message":
      editMessage(s.id, s.content);
      return;
    case "settings":
      updateChat(chatId, { settings: s.patch as ChatSettings });
      return;
    case "messageDelete":
      softDeleteMessage(s.id);
      return;
    case "row": {
      const cols = Object.keys(s.cols).filter((k) => (ROW_COLS[s.table] as readonly string[]).includes(k));
      if (!cols.length) return;
      run(`UPDATE ${s.table} SET ${cols.map((k) => `${k} = ?`).join(", ")}, updated_at = ? WHERE id = ?`, ...cols.map((k) => s.cols[k] ?? null), now(), s.id);
      publish({ type: "memory.changed", chatId });
      publish({ type: "inbox.changed" });
      return;
    }
    case "atomUnmerge": {
      // The merged-away memories stand again; the kept one loses the sources the merge gave it.
      for (const id of s.others) run("UPDATE memories SET status = 'active', superseded_by = NULL, updated_at = ? WHERE id = ? AND superseded_by = ?", now(), id, s.keep);
      if (s.sources.length) run(`DELETE FROM memory_sources WHERE memory_id = ? AND message_id NOT IN (${s.sources.map(() => "?").join(",")})`, s.keep, ...s.sources);
      publish({ type: "memory.changed", chatId });
      return;
    }
    case "hidden":
      if (getMessageRow(s.id)) setMessageFlags(s.id, { hidden: s.hidden });
      return;
    case "lore":
      updateEntry(s.id, s.entry);
      return;
    case "loreDrop":
      deleteEntry(s.id);
      return;
    case "noteDrop":
      deleteNote(s.id);
      return;
    case "undismiss":
      run("DELETE FROM inbox_dismissed WHERE key = ?", s.key);
      publish({ type: "inbox.changed" });
      return;
    case "offpageDrop":
      if (getOffpage(s.id)) deleteOffpage(s.id);
      return;
    case "offpageRestore":
      if (getOffpage(s.id)) updateOffpage(s.id, s.patch);
      return;
    case "lessonDrop":
      if (getLesson(s.id)) deleteLesson(s.id);
      return;
    case "lessonStatus":
      if (getLesson(s.id)) {
        run("UPDATE lessons SET status = ?, updated_at = ? WHERE id = ?", s.status, now(), s.id);
        publish({ type: "lessons.changed", chatId });
      }
      return;
  }
}
