import { z } from "zod";
import { all, newId, now, one, parseJson, run } from "../db/db";
import { publish } from "../lib/events";
import { notFound } from "../lib/http";
import { memoryConfig } from "../lib/settings";
import { countTokens } from "../lib/tokens";
import type { JobContext } from "../services/jobs";
import { callJson } from "../services/llm";
import { shouldShed } from "../services/quota";
import { currentFold } from "../trackers/store";
import { chatNames } from "./build";
import { norm, resolver } from "./entities";
import type { SummaryRow } from "./store";

/**
 * Character journals (MEM-29): a first-person, subjective memory for the main character and the
 * NPCs who matter, condensed after each scene. Secrets, numbers and names stay word for word.
 * Each journal holds only what that person saw, did, was told, or feels. Your edits win:
 * once you edit one, rebuilds wait as proposals.
 */

export interface JournalRow {
  id: string;
  chat_id: string;
  name: string;
  content: string;
  through_seq: number;
  user_edited: number;
  proposal: string | null;
  created_at: number;
  updated_at: number;
}

export function journalOut(r: JournalRow) {
  return {
    id: r.id,
    name: r.name,
    content: r.content,
    throughSeq: r.through_seq,
    userEdited: Boolean(r.user_edited),
    proposal: r.proposal ? parseJson<{ content: string; throughSeq: number; at: number }>(r.proposal, { content: "", throughSeq: 0, at: 0 }) : null,
    tokens: countTokens(r.content),
    updatedAt: r.updated_at,
  };
}

export function listJournals(chatId: string) {
  return all<JournalRow>("SELECT * FROM journals WHERE chat_id = ? ORDER BY name", chatId).map(journalOut);
}

function rowFor(chatId: string, name: string) {
  return all<JournalRow>("SELECT * FROM journals WHERE chat_id = ?", chatId).find((r) => norm(r.name) === norm(name));
}

/** The journal text for the prompt (empty when there isn't one yet). */
export function journalText(chatId: string, name: string) {
  return rowFor(chatId, name)?.content ?? "";
}

/** Who keeps a journal: the main character always, and up to two NPCs the story keeps returning to. */
export function journalSubjects(chatId: string) {
  const names = chatNames(chatId);
  const out = [names.char];
  const npcs = resolver(chatId)
    .rows.filter((e) => e.kind === "person" && e.status !== "dead" && norm(e.name) !== norm(names.char) && norm(e.name) !== norm(names.user) && !parseJson<{ isUser?: boolean }>(e.data, {}).isUser)
    .filter((e) => e.mentions >= 6)
    .sort((a, b) => b.mentions - a.mentions)
    .slice(0, 2);
  for (const e of npcs) out.push(e.name);
  for (const r of all<JournalRow>("SELECT * FROM journals WHERE chat_id = ?", chatId)) if (!out.some((n) => norm(n) === norm(r.name))) out.push(r.name);
  return out;
}

const journalSchema = z.object({ journal: z.string().min(1) });

/** What the trackers say this person knows, keeps secret, and wrote down at turning points. */
function trackerView(chatId: string, name: string) {
  try {
    const st = currentFold(chatId).result.state;
    const me = Object.values(st.chars).find((c) => norm(c.name) === norm(name) || c.aliases.some((a) => norm(a) === norm(name)));
    if (!me) return "";
    const lines: string[] = [];
    for (const f of Object.values(st.facts)) {
      const stance = f.stances[me.id];
      if (stance && stance.status !== "unaware") lines.push(`- ${stance.status}: ${f.statement}${f.secret?.keepers.includes(me.id) ? " (a secret ${name} keeps)" : ""}`);
    }
    for (const j of me.journal.slice(-4)) lines.push(`- turning point: "${j.text}"`);
    if (me.mood) lines.push(`- mood now: ${me.mood.name}`);
    if (me.drives.want) lines.push(`- wants: ${me.drives.want}`);
    if (me.drives.fear) lines.push(`- fears: ${me.drives.fear}`);
    return lines.length ? `WHAT ${name.toUpperCase()} KNOWS AND FEELS (story state):\n${lines.join("\n")}` : "";
  } catch {
    return "";
  }
}

/** Brings one journal up to date with the scenes since it was last written. */
export async function updateJournal(chatId: string, name: string, opts: { job?: JobContext; fromScratch?: boolean; signal?: AbortSignal } = {}) {
  const row = rowFor(chatId, name);
  const through = opts.fromScratch ? 0 : (row?.through_seq ?? 0);
  const scenes = all<SummaryRow>("SELECT * FROM summaries WHERE chat_id = ? AND level = 'scene' AND state = 'ready' AND closed = 1 AND end_seq > ? ORDER BY start_seq", chatId, through);
  // Scenes this person was part of (or, for the main character, all of them).
  const names = chatNames(chatId);
  const isMain = norm(name) === norm(names.char);
  const res = resolver(chatId);
  const me = res.find(name);
  const myNames = new Set((me ? res.namesOf(me) : [name]).map(norm));
  const mine = scenes.filter((s) => {
    if (isMain) return true;
    const d = parseJson<{ participants?: string[] }>(s.data, {});
    return (d.participants ?? []).some((p) => myNames.has(norm(p))) || [...myNames].some((n) => n.length >= 3 && norm(s.content).includes(n));
  });
  if (!mine.length) {
    if (row && scenes.length) run("UPDATE journals SET through_seq = ?, updated_at = ? WHERE id = ?", scenes.at(-1)!.end_seq ?? through, now(), row.id);
    return row ? journalOut(rowFor(chatId, name)!) : null;
  }
  // M24: eight scenes at a time, oldest first, until it has caught up (a backlog is never skipped).
  const batch = mine.slice(0, 8);
  const more = mine.length > batch.length;
  const endSeq = (more ? batch.at(-1)!.end_seq : scenes.at(-1)!.end_seq) ?? batch.at(-1)!.end_seq ?? 0;
  // Progress back at 0 (a rewind) means it's written again from the scenes left.
  const prev = opts.fromScratch || through === 0 ? "" : (row?.proposal ? parseJson<{ content: string }>(row.proposal, { content: "" }).content : row?.content) || "";
  const user = [
    `PERSON: ${name}${isMain ? " (the main character)" : ""}. The player's character is ${names.user}.`,
    prev ? `${name.toUpperCase()}'S JOURNAL SO FAR:\n${prev}` : `${name} has no journal yet.`,
    trackerView(chatId, name),
    `NEW SCENES, oldest first:\n${batch.map((s) => `- ${s.title} (#${s.start_seq}–#${s.end_seq}): ${s.content}`).join("\n")}`,
  ]
    .filter(Boolean)
    .join("\n\n");
  opts.job?.note({ inputTokens: countTokens(user), journal: name });
  const r = await callJson({
    task: "summarizer",
    kind: "journal",
    chatId,
    jobId: opts.job?.id,
    name: "journal_update",
    schema: journalSchema,
    system: `You keep ${name}'s private journal in an ongoing roleplay. Write it in ${name}'s own first-person voice: what ${name} saw, did, was told, and feels about it, and what ${name} is keeping to themselves.
Rules:
- Only what ${name} witnessed or learned. Never what happened where ${name} wasn't, unless someone told them.
- Keep word for word: names, numbers, dates, places, promises, secrets, and lines that mattered to ${name}.
- Condense: fold the new scenes into the journal so far, keeping the through-line and the feelings; drop small talk. At most 320 words.
- Subjective is fine (${name}'s opinions, fears, hopes), invented events are not.
Reply with JSON only: {"journal": "…"}`,
    user,
    maxTokens: 1200,
    signal: opts.signal,
  });
  const content = r.data.journal.trim();
  const t = now();
  if (!row) {
    run("INSERT INTO journals (id, chat_id, name, content, through_seq, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)", newId(), chatId, name, content, endSeq, t, t);
  } else if (row.user_edited) {
    // Your edited journal is never overwritten: the new version waits for you.
    run("UPDATE journals SET proposal = ?, through_seq = ?, updated_at = ? WHERE id = ?", JSON.stringify({ content, throughSeq: endSeq, at: t }), endSeq, t, row.id);
  } else {
    run("UPDATE journals SET content = ?, through_seq = ?, updated_at = ? WHERE id = ?", content, endSeq, t, row.id);
  }
  publish({ type: "memory.changed", chatId });
  if (more && !opts.signal?.aborted) return updateJournal(chatId, name, { ...opts, fromScratch: false });
  return journalOut(rowFor(chatId, name)!);
}

/** Background job after scenes close: every journal subject catches up. */
export async function runJournalJob(chatId: string, job?: JobContext) {
  if (!memoryConfig().journals || shouldShed("verification")) return;
  for (const name of journalSubjects(chatId)) await updateJournal(chatId, name, { job });
}

export function editJournal(id: string, content: string) {
  const r = one<JournalRow>("SELECT * FROM journals WHERE id = ?", id);
  if (!r) throw notFound("Journal not found");
  run("UPDATE journals SET content = ?, user_edited = 1, updated_at = ? WHERE id = ?", content.trim(), now(), id);
  publish({ type: "memory.changed", chatId: r.chat_id });
  return journalOut(one<JournalRow>("SELECT * FROM journals WHERE id = ?", id)!);
}

export function decideJournalProposal(id: string, accept: boolean) {
  const r = one<JournalRow>("SELECT * FROM journals WHERE id = ?", id);
  if (!r) throw notFound("Journal not found");
  if (r.proposal && accept) {
    const p = parseJson<{ content: string }>(r.proposal, { content: r.content });
    run("UPDATE journals SET content = ?, proposal = NULL, user_edited = 0, updated_at = ? WHERE id = ?", p.content, now(), id);
  } else run("UPDATE journals SET proposal = NULL, updated_at = ? WHERE id = ?", now(), id);
  publish({ type: "memory.changed", chatId: r.chat_id });
  return journalOut(one<JournalRow>("SELECT * FROM journals WHERE id = ?", id)!);
}
