import { z } from "zod";
import { all, newId, parseJson } from "../db/db";
import { publish } from "../lib/events";
import { badRequest, notFound } from "../lib/http";
import { gather } from "../creator/research";
import { lane, registerLane } from "../prompt/lanes";
import { type ChatSettings, mustChat, updateChat } from "../services/chats";
import { enqueue, type JobContext } from "../services/jobs";
import { callJson } from "../services/llm";
import { registerStatusTile } from "../services/status";
import { registerInboxProvider } from "./inbox";
import { SLIPS, type Found } from "./slips";

/**
 * Canon cutoff (Almanac plan C1). The chat knows where the story stands in its source and what
 * hasn't happened yet, so nothing from later leaks in: later events, later characters, later
 * reveals and later terms, each with the words to watch for. "Suggest from the wiki" builds the
 * list from the source's wiki (the studios' canon research); canon events that won't happen in
 * this story (an AU) become story truths; and when a scene summary shows the story has reached a
 * later event, a card offers to move the cutoff forward.
 */

export type LaterKind = "event" | "character" | "reveal" | "term";
export interface LaterItem {
  id: string;
  kind: LaterKind;
  text: string;
  /** Words that mean it has leaked in (a name, a term, a phrase). */
  terms: string[];
  /** Where it came from ("Bargaining (Buffyverse Wiki)"), when the wiki suggested it. */
  source?: string;
}
export interface WontItem {
  id: string;
  text: string;
}
export interface CanonSettings {
  /** The work this story comes from. */
  source?: string;
  /** Where the story stands in it ("Season 6, after Bargaining"). */
  point?: string;
  later?: LaterItem[];
  wont?: WontItem[];
  /** Suggestions from the wiki, waiting in the Inbox. */
  proposed?: LaterItem[];
  /** Later events you said haven't happened yet, though a summary looked like they had. */
  notYet?: string[];
}

export function canonOf(chatId: string): CanonSettings {
  return parseJson<ChatSettings>(mustChat(chatId).settings, {}).canon ?? {};
}

/** Changes the chat's canon (and keeps the "won't happen" truths in step). */
export function setCanon(chatId: string, next: CanonSettings) {
  const s = parseJson<ChatSettings>(mustChat(chatId).settings, {});
  const prev = s.canon ?? {};
  const truths = syncTruths(s.truths ?? [], prev.wont ?? [], next.wont ?? []);
  updateChat(chatId, { settings: { canon: next, ...(truths ? { truths } : {}) } });
  publish({ type: "inbox.changed" });
  return next;
}

/** "Won't happen here" items are story truths too: added and removed with them. */
const truthOf = (w: WontItem) => `In this story, canon diverges: ${w.text.replace(/\.$/, "")}.`;
function syncTruths(truths: string[], before: WontItem[], after: WontItem[]): string[] | null {
  const gone = new Set(before.filter((b) => !after.some((a) => a.id === b.id && a.text === b.text)).map(truthOf));
  const added = after.filter((a) => !before.some((b) => b.id === a.id && b.text === a.text)).map(truthOf);
  if (!gone.size && !added.length) return null;
  return [...truths.filter((t) => !gone.has(t)), ...added.filter((t) => !truths.includes(t))].slice(-30);
}

const cleanTerms = (ts: string[]) => [...new Set(ts.map((t) => t.trim()).filter((t) => t.length >= 2))].slice(0, 12);
export function laterItem(kind: LaterKind, text: string, terms: string[] = [], source?: string): LaterItem {
  const t = text.trim().slice(0, 300);
  // A character's name is the term to watch if none were given.
  return { id: newId().slice(0, 8), kind, text: t, terms: cleanTerms(terms.length ? terms : kind === "character" || kind === "term" ? [t] : []), ...(source ? { source: source.slice(0, 200) } : {}) };
}

// ---------- matching ----------

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const termRe = (t: string) => new RegExp(`(?<![\\p{L}\\p{N}])${esc(t.trim()).replace(/\s+/g, "\\s+")}(?![\\p{L}\\p{N}])`, "iu");
const sentences = (t: string) => t.match(/[^.!?…\n]+(?:[.!?…]+["”')\]*]*)?/g) ?? [];

/** The later items a text names, and the words that gave them away. */
export function laterIn(text: string, later: LaterItem[]): { item: LaterItem; term: string }[] {
  const out: { item: LaterItem; term: string }[] = [];
  for (const i of later) {
    const term = i.terms.find((t) => termRe(t).test(text));
    if (term) out.push({ item: i, term });
  }
  return out;
}

// ---------- the [CANON] lane and the check ----------

registerLane("canon", (ctx) => {
  if (ctx.kind !== "story" && ctx.kind !== "continue") return null;
  const c = canonOf(ctx.chatId);
  const later = c.later ?? [];
  if (!c.source?.trim() && !later.length && !c.wont?.length) return null;
  const by = (k: LaterKind) => later.filter((i) => i.kind === k);
  const parts = [
    c.source?.trim() ? `This story comes from ${c.source.trim()}${c.point?.trim() ? `, and stands at: ${c.point.trim()}` : ""}. Nothing from later in the source exists yet: nobody knows it, mentions it or foreshadows it by name.` : "",
    by("event").length ? `Hasn't happened yet:\n${by("event").map((i) => `- ${i.text}`).join("\n")}` : "",
    by("reveal").length ? `Not revealed yet (nobody knows):\n${by("reveal").map((i) => `- ${i.text}`).join("\n")}` : "",
    by("character").length ? `Haven't appeared yet (don't introduce them): ${by("character").map((i) => i.text).join(", ")}` : "",
    by("term").length ? `Words that don't exist here yet: ${by("term").map((i) => i.text).join(", ")}` : "",
    c.wont?.length ? `In this story, canon diverges (these won't happen as in the source):\n${c.wont.map((w) => `- ${w.text}`).join("\n")}` : "",
  ].filter(Boolean);
  return lane("canon", null, parts.join("\n"), { prefix: true });
});

SLIPS.push({
  id: "canon",
  label: "Later canon",
  description: "Later events, characters or terms showing up before their time.",
  phase: "reply",
  on: (c) => c.role === "assistant",
  run: (text, _s, c) => {
    const later = canonOf(c.chatId).later ?? [];
    if (!later.length) return [];
    const out: Found[] = [];
    const seen = new Set<string>();
    for (const s of sentences(text)) {
      for (const { item: i, term } of laterIn(s, later)) {
        if (seen.has(i.id)) continue;
        seen.add(i.id);
        out.push({
          kind: "canon",
          severity: i.kind === "reveal" || i.kind === "character" ? "major" : "minor",
          claim: s.trim(),
          conflict: `“${term}” is from later in the source: ${i.kind === "character" ? `${i.text} hasn't appeared yet` : i.kind === "term" ? `the word doesn't exist here yet` : `${i.text} hasn't happened yet`}.`,
          citations: [{ ref: "C", type: "card", label: `Canon cutoff: ${i.text.slice(0, 80)}${i.source ? ` (${i.source})` : ""}` }],
          fix: i.kind === "character" ? `${i.text} hasn't appeared at this point; leave them out.` : `Don't mention "${term}" yet; at this point in the story it ${i.kind === "term" ? "isn't a thing" : "hasn't happened"}.`,
          by: "rules",
        });
      }
    }
    return out;
  },
});

// ---------- suggest from the wiki ----------

const suggestSchema = z.object({ later: z.array(z.object({ kind: z.string(), text: z.string(), terms: z.array(z.string()).default([]), source: z.string().default("") })).default([]) });

/** "Suggest from the wiki": reads the source's wiki and proposes what comes after the cutoff. */
export async function suggestCanon(chatId: string, job?: JobContext) {
  const c = canonOf(chatId);
  if (!c.source?.trim()) throw badRequest("Say which story this comes from first");
  const g = await gather(c.source, { focus: c.point?.trim() ? [c.point.trim()] : [], maxChars: 40_000 }).catch(() => null);
  job?.note({ sources: g?.sources.map((s) => s.title) ?? [] });
  const r = await callJson({
    task: "helper",
    kind: "canon",
    chatId,
    jobId: job?.id,
    name: "canon_later",
    schema: suggestSchema,
    system: `A roleplay is set inside an existing story, at a given point. From the research (and what you know of the work), list what comes AFTER that point and must not leak in early: later events, characters who haven't appeared yet, later reveals (secrets not yet known), and terms or names not yet coined. For each: "kind" (event | character | reveal | term), "text" (a short line), "terms" (one to four exact words or names that would give it away in prose; avoid common words), and "source" (the research page it's from, if any). At most 30, the most spoiling first. Reply with JSON only: {"later": [{"kind": "event", "text": "…", "terms": ["…"], "source": "…"}]}`,
    user: `THE WORK: ${c.source}\nTHE STORY STANDS AT: ${c.point?.trim() || "the beginning"}\n\nRESEARCH:\n${g?.text.slice(0, 30_000) || "(nothing found online)"}`,
    maxTokens: 2500,
  });
  const known = new Set([...(c.later ?? []), ...(c.proposed ?? [])].map((i) => i.text.toLowerCase()));
  const fresh = r.data.later
    .filter((x) => x.text.trim() && !known.has(x.text.trim().toLowerCase()))
    .slice(0, 30)
    .map((x) => laterItem((["event", "character", "reveal", "term"].includes(x.kind) ? x.kind : "event") as LaterKind, x.text, x.terms, x.source || undefined));
  setCanon(chatId, { ...canonOf(chatId), proposed: [...(canonOf(chatId).proposed ?? []), ...fresh].slice(0, 150) });
  return fresh;
}

export function queueSuggest(chatId: string) {
  if (!canonOf(chatId).source?.trim()) throw badRequest("Say which story this comes from first");
  return enqueue("canon.suggest", { chatId }, { chatId, dedupeKey: `canon.suggest:${chatId}` });
}

// ---------- the cutoff moves ----------

/** Later events (and reveals) the newest scene summaries say have happened. */
export function passedEvents(chatId: string): { item: LaterItem; summary: string; term: string }[] {
  const c = canonOf(chatId);
  const events = (c.later ?? []).filter((i) => (i.kind === "event" || i.kind === "reveal") && !(c.notYet ?? []).includes(i.id));
  if (!events.length) return [];
  const rows = all<{ title: string; content: string }>("SELECT title, content FROM summaries WHERE chat_id = ? AND level = 'scene' AND state != 'pending' AND content != '' ORDER BY start_seq DESC LIMIT 4", chatId);
  const out: { item: LaterItem; summary: string; term: string }[] = [];
  for (const i of events) {
    // At least two of its words in one summary, or its one word when it has only one.
    for (const r of rows) {
      const hits = i.terms.filter((t) => termRe(t).test(r.content));
      if (hits.length >= Math.min(2, i.terms.length) && hits.length) {
        out.push({ item: i, summary: r.title || r.content.slice(0, 80), term: hits[0]! });
        break;
      }
    }
  }
  return out;
}

/** "Move the cutoff forward": the event leaves the "hasn't happened" list, and the story now stands after it. */
export function moveCutoff(chatId: string, id: string) {
  const c = canonOf(chatId);
  const i = (c.later ?? []).find((x) => x.id === id);
  if (!i) throw notFound("That canon item is gone");
  return setCanon(chatId, { ...c, later: (c.later ?? []).filter((x) => x.id !== id), point: `after ${i.text.replace(/\.$/, "")}` });
}

// ---------- the Inbox: wiki suggestions, and the cutoff moving ----------

registerInboxProvider({
  kind: "canon",
  source: "canon",
  items: (chats) =>
    chats.flatMap((ch) => {
      const c = canonOf(ch.id);
      const proposals = (c.proposed ?? []).map((i) => ({
        key: `canon:${ch.id}:add:${i.id}`,
        chatId: ch.id,
        chatTitle: "",
        title: `Hasn't happened yet (${i.kind}): ${i.text.slice(0, 60)}`,
        why: `Suggested from ${i.source || "the wiki"}. Approving adds it to this story's canon cutoff${i.terms.length ? `, watching for: ${i.terms.join(", ")}` : ""}.`,
        before: null,
        after: i.text,
        editable: true,
        createdAt: 0,
        link: `/chat/${ch.id}`,
      }));
      const moved = passedEvents(ch.id).map((p) => ({
        key: `canon:${ch.id}:move:${p.item.id}`,
        chatId: ch.id,
        chatTitle: "",
        title: "Move the cutoff forward?",
        why: `A scene summary (“${p.summary.slice(0, 60)}”) mentions “${p.term}”: the story may have reached this. Approve to move the cutoff past it; reject if it hasn't happened yet.`,
        before: c.point ?? null,
        after: `after ${p.item.text}`,
        editable: false,
        createdAt: 0,
        link: `/chat/${ch.id}/memory`,
      }));
      return [...moved, ...proposals];
    }),
  act: (id, action, edited) => {
    const [chatId, what, itemId] = id.split(":");
    if (!chatId || !itemId) throw badRequest("Bad card");
    const c = canonOf(chatId);
    if (what === "move") {
      if (action === "accept") moveCutoff(chatId, itemId);
      else setCanon(chatId, { ...c, notYet: [...(c.notYet ?? []), itemId].slice(-150) });
      return chatId;
    }
    const p = (c.proposed ?? []).find((x) => x.id === itemId);
    const rest = (c.proposed ?? []).filter((x) => x.id !== itemId);
    setCanon(chatId, { ...c, proposed: rest, ...(action === "accept" && p ? { later: [...(c.later ?? []), { ...p, text: edited?.trim() || p.text }].slice(0, 150) } : {}) });
    return chatId;
  },
});

registerStatusTile((chatId) => {
  const c = canonOf(chatId);
  if (!c.source?.trim() && !c.later?.length) return null;
  const moved = passedEvents(chatId).length;
  return moved
    ? { id: "canon", n: moved, label: "canon cutoff may have moved", tone: "blue", open: { inbox: "canon" }, order: 40 }
    : { id: "canon", n: 0, value: String(c.later?.length ?? 0), label: "later canon watched", tone: "blue", open: { dock: "chat", section: "canon" }, order: 40 };
});
