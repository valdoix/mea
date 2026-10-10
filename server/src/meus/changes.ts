import { newId, now, one, parseJson, run } from "../db/db";
import { badRequest } from "../lib/http";
import { publish } from "../lib/events";
import { createAtom, deleteAtom, getAtom, restoreAtom, updateAtom } from "../memory/atoms";
import { createEntity, deleteEntity, ENTITY_KINDS, type EntityKind, type EntityRow, type EntityStatus, getEntityRow, mergeEntities, resolver, restoreEntity, unmergeEntity, updateEntity } from "../memory/entities";
import { correctMemory } from "../memory/remember";
import type { ProposedChange } from "../assistant/core";
import { type ChatSettings, editMessage, mustChat, softDeleteMessage, updateChat } from "../services/chats";
import { userEditAt, timeskip } from "../trackers/service";
import { castKey, castProfiles, currentFold, deleteEvent, dryRunOps, linesToOps, moveCastProfile, saveCastProfile } from "../trackers/store";
import { parseDuration } from "../trackers/clock";

/**
 * What Meus can change in a chat, each through the tool the app already uses for it, so swipes,
 * rewinds and re-reads stay correct. A proposed change is checked before you see it (ledger lines
 * are folded as a dry run; names and ids must exist), and applying one records what undoes it.
 */

export const CHANGE_KINDS = [
  '{"kind": "ledger", "lines": ["…"], "at": <message number, only when a correction holds from an earlier message on>, "why": "short label"} for the story\'s records: the clock and calendar, weather, place, people\'s state, bonds, romance, facts and secrets, things, threads, promises and debts, deadlines, planted details, clues, gauges, custom trackers. Write ledger lines (grammar below), plus these lines only you may write: "rename Old Name: New Name", "edit [\\"chars\\",\\"<id>\\",\\"mood\\",\\"name\\"] = \\"calm\\"" (any field by path as JSON; null removes; ids are in [brackets]), "lock <path>", "unset <path>". To correct the clock write the right absolute time ("clock: Day 3 21:15"); it may go backwards.',
  '{"kind": "merge", "from": "<cast name>", "into": "<cast name>"} two cast entries that are one person: the first folds into the second in the story, the cast profiles and the Codex;',
  '{"kind": "codex", "id": "<page id or name>", "name": "…", "entityKind": "person|place|object|group|concept", "aliases": ["…"], "description": "…", "status": "active|dead|missing|gone|unknown", "facts": ["the whole new list"]} to edit a Codex page (only the fields that change);',
  '{"kind": "codex_add", "name": "…", "entityKind": "…", "aliases": [], "description": "…"}; {"kind": "codex_merge", "keep": "<page>", "merge": ["<page>", …]}; {"kind": "codex_unmerge", "id": "<page>"}; {"kind": "codex_delete", "id": "<page>"};',
  '{"kind": "memory_fix", "wrong": "what memory gets wrong", "right": "what is true", "ids": ["memory ids, if you know them"]} corrects memories; {"kind": "memory_add", "text": "…", "pin": false}; {"kind": "memory_pin", "id": "…", "pin": true}; {"kind": "memory_forget", "id": "…"};',
  '{"kind": "message", "message": <number>, "text": "the whole corrected message"} fixes a past message (keep every other word as it is);',
  '{"kind": "cue", "text": "…"} a one-time instruction for the next reply; {"kind": "ooc", "text": "…"} a standing out-of-character note; {"kind": "truth", "text": "…"} a story truth sent every turn; {"kind": "timeskip", "duration": "3 days", "note": "…"}.',
].join(" ");

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
  | { t: "messageDelete"; id: string };

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
    } else if (kind) dropped.push(`Meus can't make "${kind}" changes yet`);
  }
  return { changes: out, dropped };
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
  }
}
