import { z } from "zod";
import { all, now, one, parseJson, run } from "../db/db";
import { publish } from "../lib/events";
import { chatNames } from "../memory/build";
import { type ChatSettings, getMessageRow, lastMessage, mustChat, updateChat } from "../services/chats";
import { contentWords } from "../memory/text";
import { lessonsFor } from "./lessons";
import { fileItem, type Filing, registerFilingKind } from "../services/filings";
import { callJson } from "../services/llm";
import { shouldShed } from "../services/quota";
import { userEditAt } from "../trackers/service";
import { openLoops } from "../trackers/loops";
import { currentFold, deleteEvent, linesToOps } from "../trackers/store";
import type { Character, Loop, Op, WorldState } from "../trackers/types";

/**
 * Your corrections stick (docs/19 Part 5). A note for a reply ("buffy doesn't know that giles has
 * left", "she already washed her mouth") fixed that one reply and was gone the next. Now a note
 * that states something true about the story becomes a record: who knows what becomes your `know`
 * line, anything else a story truth. Each is a chip on the reply with Undo, and "That's only for
 * this reply", which also stops it being saved again. Style notes ("make it warmer") are never
 * touched.
 *
 * Rules first: a clause that names its person ("Buffy doesn't know …") is read by rules. A clause
 * that might be a fact but needs reading ("she doesn't know that he worked as a lifeguard": who is
 * she, who is he) goes to the helper once, which must quote the note.
 *
 * A note that says something open already happened ("we already did the grocery run") closes its
 * loop (docs/22 5.2), so it fixes the record and not just one take.
 */

export interface NoteFact {
  kind: "know" | "truth" | "loop";
  /** The chip's text. */
  label: string;
  /** know: the person, whether they know, and what. */
  who?: string;
  status?: "knows" | "unaware";
  fact?: string;
  /** truth: the sentence that holds. loop: the words that close it. */
  text?: string;
  /** loop: the one it closes. */
  loop?: string;
  /** The note's own words, when the helper read it. */
  quote?: string;
}

/** Asks for the reply's style or direction, not a fact: "make it warmer", "she takes his hand", "write in present tense". */
const STYLE = /^\s*(?:please\s+)?(?:make|more|less|slower|faster|emphasi[sz]e|write|keep|add|let|give|have|tone|pace|focus|show|describe|use|avoid|try|go|end|start|open|skip|cut|include)\b/i;
/** True of this reply only: "the call is already ongoing", "he thinks it, but doesn't say it". */
const MOMENT = /\b(?:already\s+ongoing|still\s+ongoing|right\s+now|in\s+this\s+(?:reply|scene)|at\s+the\s+moment|currently|didn['’]t\s+say|doesn['’]t\s+say|does\s+not\s+say|thinks\s+it|only\s+thinks)\b/i;
/** Said as something that happened or holds: past events, "already", "is the one who". */
const FACTUAL = /\b(?:already|yesterday|earlier|before|last\s+night|has\s+been|have\s+been|had\s+been|was|were|is\s+the\s+one|are\s+the\s+ones|did|bought|told|gave|left|took|cleaned|washed|used|met|knows?|doesn['’]t\s+know|does\s+not\s+know)\b/i;
const NEG = /\b(?:doesn['’]t|does\s+not|don['’]t|didn['’]t)\s+(?:yet\s+)?know\b|\bhasn['’]t\s+(?:been\s+told|heard|learned)\b|\bhas\s+no\s+idea\b|\bis\s+unaware\b/i;
const POS = /\b(?:already\s+)?knows\b|\bhas\s+(?:been\s+told|learned)\b|\bfound\s+out\b/i;
/** Says something's over. Not "was", which a thing called off is too. */
const OVER = /\b(?:already|did|done|happened|finished)\b/i;
const NOT_YET = /\b(?:not|never|yet|still|hasn['’]t|haven['’]t|didn['’]t|won['’]t|isn['’]t)\b/i;
const PRONOUN = /\b(?:he|she|they|him|her|his|hers|them|their|it|those|these|this|that)\b/i;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The note's clauses: sentences, and the parts of "X - Y" and "X; also: Y". */
export function clausesOf(note: string): string[] {
  return note
    .split(/(?<=[.!?])\s+|\s*;\s*|\s+[-–—]\s+|\n+|\balso:\s*/i)
    .map((s) => s.replace(/^[\s,.:]+|[\s,.:]+$/g, "").trim())
    .filter((s) => s.length >= 8);
}

const names = (c: Character) => [...new Set([c.name, c.name.split(/\s+/)[0]!, ...c.aliases].filter((n) => n.length >= 3))];
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "Buffy doesn't know that Giles has left" → Buffy, unaware, "Giles has left". Only when it names its person and says the rest plainly. */
export function knowledgeClaim(st: WorldState, clause: string): { who: Character; status: "knows" | "unaware"; fact: string } | null {
  const people = Object.values(st.chars).filter((c) => !c.isUser);
  const alt = people.flatMap(names).sort((a, b) => b.length - a.length).map(esc).join("|");
  if (!alt) return null;
  for (const [re, status] of [[NEG, "unaware"], [POS, "knows"]] as const) {
    const m = clause.match(new RegExp(`^(?:but\\s+|and\\s+)?(${alt})(?:['’]s?)?\\s+(?:still\\s+|also\\s+)?(?=${re.source.replace(/^\\b/, "")})`, "iu"));
    if (!m) continue;
    const who = people.find((c) => names(c).some((n) => n.toLowerCase() === m[1]!.toLowerCase()));
    const rest = clause.slice(m[0].length).replace(re, "").replace(/^\s*(?:that|about|of|how|why|who|what|where|when|if|whether)\b\s*/i, "");
    // "…, and must not act as if they do": the rule about it isn't part of the fact.
    const fact = rest.replace(/,?\s*(?:and|so)\s+(?:must|should|can|will)(?:n['’]t|\s+not)?\b[\s\S]*$/i, "").replace(/[\s.,;:]+$/, "").trim();
    if (who && fact.length >= 6) return { who, status, fact: cap(fact) };
  }
  return null;
}

/**
 * The open loop a clause says is over: it says every word of a wording, so "she already moved the
 * boxes" doesn't close the move to his house. Wordings of two words or more: one says too little.
 */
export function closedByNote(st: WorldState, clause: string): Loop | null {
  if (!OVER.test(clause) || NOT_YET.test(clause)) return null;
  const said = contentWords(clause);
  return openLoops(st).find((l) => !l.repeats && [l.what, ...l.from].some((t) => {
    const words = [...contentWords(t)];
    return words.length >= 2 && words.every((w) => said.has(w));
  })) ?? null;
}

const clipped = (s: string) => (s.length > 120 ? `${s.slice(0, 119).trimEnd()}…` : s);

/** What rules can read on their own, the clauses that might be facts but need the helper, and plain facts it should see first. */
export function readNote(st: WorldState, note: string): { facts: NoteFact[]; unsure: string[]; over: string[] } {
  const facts: NoteFact[] = [];
  const unsure: string[] = [];
  const over: string[] = [];
  const cast = Object.values(st.chars);
  const named = (s: string) => cast.some((c) => names(c).some((n) => new RegExp(`(?<![\\p{L}])${esc(n)}(?![\\p{L}])`, "iu").test(s)));
  for (const c of clausesOf(note)) {
    if (STYLE.test(c) || MOMENT.test(c)) continue;
    const k = knowledgeClaim(st, c);
    if (k && !PRONOUN.test(k.fact.replace(/^(?:that|this)\b/i, ""))) {
      facts.push({ kind: "know", who: k.who.name, status: k.status, fact: k.fact, label: `${k.who.name} ${k.status === "knows" ? "knows" : "doesn't know"}: ${k.fact}` });
      continue;
    }
    const done = k ? null : closedByNote(st, c);
    if (done) {
      facts.push({ kind: "loop", loop: done.id, text: c, label: `Done: ${clipped(done.what)}` });
      continue;
    }
    if (!FACTUAL.test(c)) continue;
    // A plain fact that names its people ("Gabriel bought the socks with Buffy") holds as written.
    if (!k && named(c) && !/^(?:he|she|they)\b/i.test(c) && !PRONOUN.test(c.replace(/\b(?:his|her|their)\b/gi, ""))) {
      // Unless it may be an open loop in other words: the helper can tell, and it stands if it can't.
      if (OVER.test(c) && !NOT_YET.test(c) && openLoops(st).length) over.push(c);
      else facts.push({ kind: "truth", text: cap(c), label: cap(c) });
    } else unsure.push(c);
  }
  return { facts, unsure, over };
}

const helperSchema = z.object({
  facts: z
    .array(
      z.object({
        kind: z.enum(["knows", "unaware", "truth", "closes", "direction", "moment"]).catch("direction"),
        who: z.string().default(""),
        loop: z.string().default(""),
        fact: z.string().default(""),
        quote: z.string().default(""),
      }),
    )
    .default([]),
});

/** The clauses rules couldn't read: who "she" and "he" are, and whether it's a lasting fact. */
async function askHelper(chatId: string, st: WorldState, clauses: string[]): Promise<NoteFact[]> {
  if (!clauses.length || shouldShed("lessons", chatId)) return [];
  const n = chatNames(chatId);
  const here = Object.values(st.chars).filter((c) => c.tier === "spot" || c.tier === "peri").map((c) => (c.isUser ? `${n.user} (the player)` : c.name));
  const open = openLoops(st).slice(-12);
  const system = `You read a player's note to the writer of a story and pick out what it states as true about the story, so it can be saved. The story's main character is ${n.char}; the player plays ${n.user}. People in the scene: ${here.join(", ") || "unknown"}.
For each clause, answer one item:
- "unaware": someone doesn't know something. who = their name; fact = what they don't know, with every pronoun replaced by a name.
- "knows": someone already knows something (same rules).
- "truth": something that happened or holds, said as fact ("she already washed her mouth", "her nails were cleaned yesterday"). fact = the sentence with names for pronouns.
- "closes": it says one of the OPEN THINGS already happened on the page. loop = its id. Only when it's plainly that one, and it's over, not just talked about.
- "moment": true of this reply only ("the call is already ongoing").
- "direction": what the player wants written, or a style ("make it warmer", "she takes his hand").
A vague fact ("those details") is "direction". quote = the clause's own words, exactly.`;
  try {
    const r = await callJson({ task: "helper", kind: "note facts", chatId, name: "note_facts", schema: helperSchema, system, user: `${open.length ? `OPEN THINGS:\n${open.map((l) => `${l.id}: ${clipped(l.what)}`).join("\n")}\n\n` : ""}NOTE CLAUSES:\n${clauses.map((c) => `- ${c}`).join("\n")}`, maxTokens: 600, temperature: 0.1 });
    const out: NoteFact[] = [];
    const people = Object.values(st.chars).filter((c) => !c.isUser);
    for (const f of r.data.facts) {
      // It must quote the note, and say something.
      const quote = f.quote.trim();
      const clause = quote.length >= 6 ? clauses.find((c) => c.toLowerCase().includes(quote.toLowerCase().slice(0, 40))) : undefined;
      if (!clause) continue;
      if (f.kind === "closes") {
        const l = open.find((x) => x.id === f.loop.trim());
        if (l) out.push({ kind: "loop", loop: l.id, text: clause, quote: clause, label: `Done: ${clipped(l.what)}` });
        continue;
      }
      if (!f.fact.trim()) continue;
      const fact = cap(f.fact.trim().replace(/[\s.]+$/, ""));
      if (f.kind === "truth") out.push({ kind: "truth", text: fact, quote: clause, label: fact });
      else if (f.kind === "knows" || f.kind === "unaware") {
        const who = people.find((c) => names(c).some((x) => x.toLowerCase() === f.who.trim().toLowerCase()));
        if (who) out.push({ kind: "know", who: who.name, status: f.kind, fact, quote: clause, label: `${who.name} ${f.kind === "knows" ? "knows" : "doesn't know"}: ${fact}` });
      }
    }
    return out;
  } catch (e) {
    console.error("[mea] reading the note failed:", (e as Error).message);
    return [];
  }
}

/** The message a reply answers: your records go there, so they hold for every take of the reply and after. */
function anchorFor(chatId: string, replyId: string) {
  const at = getMessageRow(replyId)?.seq;
  if (at == null) return replyId;
  return one<{ id: string }>("SELECT id FROM messages WHERE chat_id = ? AND seq < ? AND deleted_at IS NULL ORDER BY seq DESC LIMIT 1", chatId, at)?.id ?? replyId;
}

/**
 * Saves what a note for a reply states as true. Runs as the reply starts (the note is already in its
 * prompt); a record already saved, or one you said was only for that reply, isn't saved again.
 */
export async function fileNoteFacts(chatId: string, replyId: string, note: string): Promise<Filing[]> {
  const st = currentFold(chatId).result.state;
  const { facts, unsure, over } = readNote(st, note);
  const read = await askHelper(chatId, st, [...unsure, ...over]);
  const closes = new Set(read.filter((f) => f.kind === "loop").map((f) => f.quote));
  facts.push(...read.filter((f) => f.kind === "loop" || !over.includes(f.quote ?? "")));
  for (const c of over) if (!closes.has(c)) facts.push({ kind: "truth", text: cap(c), label: cap(c) });
  const before = new Map(all<{ label: string; status: string }>("SELECT label, status FROM filings WHERE chat_id = ? AND kind IN ('note-know', 'note-truth', 'note-loop')", chatId).map((r) => [r.label.toLowerCase(), r.status]));
  const anchor = anchorFor(chatId, replyId);
  const out: Filing[] = [];
  for (const f of facts) {
    const label = `Saved: ${f.label}`.slice(0, 200);
    if (before.has(label.toLowerCase())) continue;
    before.set(label.toLowerCase(), "filed");
    if (f.kind === "know") {
      const ops = linesToOps([`know ${f.who}: ${(f.fact ?? "").replace(/[|·]/g, ",")} · ${f.status} · true — your note`]).ops;
      if (!ops.length) continue;
      const ids = userEditAt(chatId, ops, anchor);
      out.push(fileItem(chatId, { messageId: replyId, kind: "note-know", label, data: { ids } }));
    } else if (f.kind === "loop") {
      const how = `your note: ${f.text}`;
      const op: Op = { op: "loop", subject: f.loop, args: { action: "done", how, hand: true }, raw: `loop ${f.loop}: done — ${how}` };
      const ids = userEditAt(chatId, [op], anchor);
      out.push(fileItem(chatId, { messageId: replyId, kind: "note-loop", label, data: { ids } }));
    } else if (f.text) {
      const s = parseJson<ChatSettings>(mustChat(chatId).settings, {});
      const truths = [...(s.truths ?? [])];
      if (!truths.includes(f.text)) truths.push(f.text);
      updateChat(chatId, { settings: { truths: truths.slice(-30) } });
      out.push(fileItem(chatId, { messageId: replyId, kind: "note-truth", label, data: { text: f.text } }));
    }
  }
  if (out.length) publish({ type: "trackers.changed", chatId });
  return out;
}

/**
 * docs/19 5.2: a lesson that only states who knows what ("Dawn doesn't know that Buffy was in
 * heaven, and must not act as if they do") is a fourth copy of a truth the trackers hold. It moves
 * to a stance (your `know` line, linked to the fact by the fold) and the lesson is switched off.
 * The chip on its reply has Undo and "Keep as a lesson". Runs before each reply; rules only.
 */
export function lessonsToFacts(chatId: string): Filing[] {
  const list = lessonsFor(chatId).filter((l) => l.chatId === chatId && l.scope === "story" && (l.status === "kept" || l.status === "suggested"));
  if (!list.length) return [];
  const moved = new Set(all<{ lesson: string | null }>("SELECT json_extract(data, '$.lesson') AS lesson FROM filings WHERE chat_id = ? AND kind = 'lesson-fact'", chatId).map((r) => r.lesson));
  const st = currentFold(chatId).result.state;
  const out: Filing[] = [];
  for (const l of list) {
    if (moved.has(l.id) || clausesOf(l.text).length !== 1) continue;
    const k = knowledgeClaim(st, l.text.trim().replace(/[.!]+$/, ""));
    if (!k || PRONOUN.test(k.fact.replace(/^(?:that|this)\b/i, ""))) continue;
    const ops = linesToOps([`know ${k.who.name}: ${k.fact.replace(/[|·]/g, ",")} · ${k.status} · true — a lesson you kept`]).ops;
    if (!ops.length) continue;
    const at = l.messageId && getMessageRow(l.messageId) ? l.messageId : lastMessage(chatId)?.id;
    if (!at) continue;
    const ids = userEditAt(chatId, ops, anchorFor(chatId, at));
    run("UPDATE lessons SET status = 'off', updated_at = ? WHERE id = ?", now(), l.id);
    out.push(fileItem(chatId, { messageId: at, kind: "lesson-fact", label: `Now a record: ${k.who.name} ${k.status === "knows" ? "knows" : "doesn't know"}: ${k.fact}`, data: { lesson: l.id, was: l.status, ids } }));
  }
  if (out.length) {
    publish({ type: "lessons.changed", chatId });
    publish({ type: "trackers.changed", chatId });
  }
  return out;
}

// Undo puts the lesson back as it was; "Keep as a lesson" keeps it. Either way the stance goes.
const backToLesson = (status?: string) => (f: Filing) => {
  for (const id of (f.data.ids as string[] | undefined) ?? []) deleteEvent(f.chatId, id);
  run("UPDATE lessons SET status = ?, updated_at = ? WHERE id = ?", status ?? String(f.data.was ?? "kept"), now(), String(f.data.lesson));
  publish({ type: "lessons.changed", chatId: f.chatId });
  publish({ type: "trackers.changed", chatId: f.chatId });
};
registerFilingKind("lesson-fact", { undo: (f) => backToLesson()(f), notMeant: backToLesson("kept") });

// Undo, or "That's only for this reply" (the filing stays as undone, so the same note isn't saved again).
for (const kind of ["note-know", "note-truth", "note-loop"] as const) {
  const undo = (f: Filing) => {
    if (kind !== "note-truth") for (const id of (f.data.ids as string[] | undefined) ?? []) deleteEvent(f.chatId, id);
    else {
      const s = parseJson<ChatSettings>(mustChat(f.chatId).settings, {});
      updateChat(f.chatId, { settings: { truths: (s.truths ?? []).filter((t) => t !== f.data.text) } });
    }
    publish({ type: "trackers.changed", chatId: f.chatId });
  };
  registerFilingKind(kind, { undo, notMeant: undo });
}
