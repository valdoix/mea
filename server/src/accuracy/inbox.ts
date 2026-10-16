import { all, now, one, parseJson, run } from "../db/db";
import { publish } from "../lib/events";
import { badRequest, notFound } from "../lib/http";
import { acceptChronicle, chronicleProposals, rejectChronicle } from "../lore/chronicle";
import { deleteAtom, updateAtom } from "../memory/atoms";
import { acceptProposal, editSummary, rejectProposal } from "../memory/build";
import { duplicateSuggestions, mergeEntities } from "../memory/entities";
import { decideJournalProposal, editJournal, type JournalRow } from "../memory/journals";
import type { SummaryRow } from "../memory/store";
import { decideProposal } from "../sim/service";
import { currentFold } from "../trackers/store";

/**
 * The review inbox (CON-09): every change to canon that Mea proposes waits here as a diff you
 * approve, edit or reject. Rebuilt summaries of things you edited, journal rewrites, story-born
 * lore, likely duplicate people, memories that contradict one you confirmed, and subplots the
 * world off the page wants to start. Nothing here changes the story until you say so.
 */

export type InboxKind = "summary" | "journal" | "chronicle" | "merge" | "disputed" | "world";

/**
 * P1: where a suggestion comes from, for the Inbox's filter. The first three are the original
 * kinds; the rest are the Almanac features' suggestions, each added by a provider below.
 */
export type InboxSource = "memory" | "lore" | "world" | "lesson" | "canon" | "pressure" | "calendar" | "secret" | "versions";

const SOURCE_OF: Record<InboxKind, InboxSource> = { summary: "memory", journal: "memory", disputed: "memory", merge: "memory", chronicle: "lore", world: "world" };

export interface InboxItem {
  key: string;
  /** One of InboxKind, or a provider's own kind. */
  kind: InboxKind | (string & {});
  source: InboxSource;
  chatId: string;
  chatTitle: string;
  title: string;
  why: string;
  before: string | null;
  after: string;
  /** "Edit" lets you change the proposed text before approving it. */
  editable: boolean;
  createdAt: number;
  /** Where to see it in context. */
  link: string;
}

type ChatLite = { id: string; title: string };

function liveChats(chatId?: string): ChatLite[] {
  if (chatId) return all<ChatLite>("SELECT id, title FROM chats WHERE id = ? AND deleted_at IS NULL", chatId);
  return all<ChatLite>("SELECT id, title FROM chats WHERE deleted_at IS NULL AND archived_at IS NULL ORDER BY COALESCE(last_message_at, updated_at) DESC LIMIT 40");
}

/**
 * P1: a feature that puts suggestions in the Inbox. `items` lists them for the given chats (keys
 * start with `kind:`), and `act` decides one, returning its chat.
 */
export interface InboxProvider {
  kind: string;
  source: InboxSource;
  items: (chats: { id: string; title: string }[]) => Omit<InboxItem, "kind" | "source">[];
  act: (id: string, action: "accept" | "reject", edited?: string) => string | null;
  /** Approving it can be taken back from a Meus card. */
  undoable?: boolean;
  /** Its items belong to no chat (chatId ""): listed once, in the Inbox for all stories. */
  global?: boolean;
}
const providers = new Map<string, InboxProvider>();
export function registerInboxProvider(p: InboxProvider) {
  providers.set(p.kind, p);
}
export const inboxProvider = (kind: string) => providers.get(kind);

const dismissed = (key: string) => Boolean(one("SELECT 1 FROM inbox_dismissed WHERE key = ?", key));

const LEVEL: Record<string, string> = { scene: "Scene", chapter: "Chapter", arc: "Arc", story: "The Story So Far" };

export function inboxItems(opts: { chatId?: string } = {}): InboxItem[] {
  const chats = liveChats(opts.chatId);
  const title = new Map(chats.map((c) => [c.id, c.title || "Untitled story"]));
  const ids = chats.map((c) => c.id);
  // Suggestions that belong to no chat (a version's original changed, docs/14) show with all stories.
  const global: InboxItem[] = [];
  if (!opts.chatId)
    for (const p of providers.values()) {
      if (!p.global) continue;
      try {
        for (const i of p.items([])) global.push({ ...i, kind: p.kind, source: p.source });
      } catch (e) {
        console.error(`[mea] inbox suggestions (${p.kind}) failed:`, e);
      }
    }
  if (!ids.length) return global.sort((a, b) => b.createdAt - a.createdAt);
  const inChats = `(${ids.map(() => "?").join(",")})`;
  const out: (Omit<InboxItem, "source"> & { source?: InboxSource })[] = [];

  // Rebuilds of summaries you edited (MEM-10), and ones waiting because memory asks first.
  for (const r of all<SummaryRow>(`SELECT * FROM summaries WHERE chat_id IN ${inChats} AND state = 'review' AND proposal IS NOT NULL`, ...ids)) {
    const p = parseJson<{ title: string; content: string; at?: number }>(r.proposal, { title: "", content: "" });
    out.push({
      key: `summary:${r.id}`,
      kind: "summary",
      chatId: r.chat_id,
      chatTitle: title.get(r.chat_id) ?? "",
      title: `${LEVEL[r.level] ?? r.level}${r.level !== "story" ? ` #${r.start_seq}–#${r.end_seq ?? "…"}` : ""}: ${p.title || r.title || "untitled"}`,
      why: r.user_edited ? "Rebuilt from its messages; you had edited the current version." : "Rebuilt from its messages; memory asks before replacing.",
      before: r.content || null,
      after: p.content,
      editable: true,
      createdAt: p.at ?? r.updated_at,
      link: `/chat/${r.chat_id}/memory`,
    });
  }
  // Journal rewrites of journals you edited (MEM-29).
  for (const r of all<JournalRow>(`SELECT * FROM journals WHERE chat_id IN ${inChats} AND proposal IS NOT NULL`, ...ids)) {
    const p = parseJson<{ content: string; at?: number }>(r.proposal, { content: "" });
    out.push({
      key: `journal:${r.id}`,
      kind: "journal",
      chatId: r.chat_id,
      chatTitle: title.get(r.chat_id) ?? "",
      title: `${r.name}'s journal`,
      why: "The story moved on; you had edited this journal.",
      before: r.content || null,
      after: p.content,
      editable: true,
      createdAt: p.at ?? r.updated_at,
      link: `/chat/${r.chat_id}/codex`,
    });
  }
  // Story-born lore (LORE-12).
  for (const c of chats)
    for (const p of chronicleProposals(c.id, "open"))
      out.push({
        key: `chronicle:${p.id}`,
        kind: "chronicle",
        chatId: c.id,
        chatTitle: title.get(c.id) ?? "",
        title: `New lore: ${p.entry.comment || p.name}`,
        why: `The story introduced ${p.name}. Approving adds an entry to this chat's Chronicle book.`,
        before: null,
        after: p.entry.content,
        editable: true,
        createdAt: p.createdAt,
        link: `/chat/${c.id}/codex`,
      });
  // Memories that contradict one you confirmed (marked disputed, never applied).
  for (const a of all<{ id: string; chat_id: string; content: string; created_at: number }>(
    `SELECT id, chat_id, content, created_at FROM memories WHERE chat_id IN ${inChats} AND status = 'disputed' AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 200`,
    ...ids,
  ))
    out.push({
      key: `disputed:${a.id}`,
      kind: "disputed",
      chatId: a.chat_id,
      chatTitle: title.get(a.chat_id) ?? "",
      title: "A memory that disagrees with your edit",
      why: "A scene record says this, but it contradicts a memory you edited or pinned. Yours stays unless you approve this.",
      before: null,
      after: a.content,
      editable: true,
      createdAt: a.created_at,
      link: `/chat/${a.chat_id}/memory`,
    });
  // Likely duplicate people, places and things (MEM-28). Only chats that have entities.
  for (const c of chats) {
    if (!one("SELECT 1 FROM entities WHERE chat_id = ? LIMIT 1", c.id)) continue;
    for (const d of duplicateSuggestions(c.id)) {
      const key = `merge:${d.keep.id}|${d.merge.id}`;
      if (dismissed(key)) continue;
      out.push({
        key,
        kind: "merge",
        chatId: c.id,
        chatTitle: title.get(c.id) ?? "",
        title: `Merge "${d.merge.name}" into "${d.keep.name}"?`,
        why: `They look like the same ${d.keep.kind} (${d.reason}). Merging keeps every fact; you can unmerge later.`,
        before: d.merge.description || d.merge.name,
        after: d.keep.description || d.keep.name,
        editable: false,
        createdAt: 0,
        link: `/chat/${c.id}/codex`,
      });
    }
  }
  // Subplots the world off the page proposes (seeding: ask).
  for (const c of chats) {
    try {
      const st = currentFold(c.id).result.state;
      for (const p of Object.values(st.sim.proposals))
        out.push({
          key: `world:${c.id}:${p.id}`,
          kind: "world",
          chatId: c.id,
          chatTitle: title.get(c.id) ?? "",
          title: `A subplot for ${p.leadName}`,
          why: p.why || "The world off the page wants to start this.",
          before: null,
          after: [p.premise, p.want ? `Wants ${p.want.replace(/^to /, "to ")}.` : "", p.fear ? `Fears ${p.fear}.` : ""].filter(Boolean).join(" "),
          editable: false,
          createdAt: 0,
          link: `/chat/${c.id}/world`,
        });
    } catch {
      // trackers off for this chat
    }
  }
  out.push(...global);
  for (const p of providers.values()) {
    if (p.global) continue;
    try {
      for (const i of p.items(chats)) out.push({ ...i, chatTitle: i.chatTitle || title.get(i.chatId) || "", kind: p.kind, source: p.source });
    } catch (e) {
      console.error(`[mea] inbox suggestions (${p.kind}) failed:`, e);
    }
  }
  return out.map((i) => ({ ...i, source: i.source ?? SOURCE_OF[i.kind as InboxKind] ?? "memory" })).sort((a, b) => b.createdAt - a.createdAt);
}

/** The number for the sidebar badge. */
export function inboxCount(chatId?: string) {
  return inboxItems({ chatId }).length;
}

/** P1: how many wait from each source (the side dock's badge and the Inbox filter). */
export function inboxCounts(chatId?: string) {
  const out: Partial<Record<InboxSource, number>> = {};
  for (const i of inboxItems({ chatId })) out[i.source] = (out[i.source] ?? 0) + 1;
  return out;
}

export function actOnInbox(key: string, action: "accept" | "reject", edited?: string) {
  const [kind, ...rest] = key.split(":");
  const id = rest.join(":");
  const text = edited?.trim();
  let chatId: string | null = null;
  switch (kind as InboxKind) {
    case "summary": {
      const r = one<SummaryRow>("SELECT * FROM summaries WHERE id = ?", id);
      if (!r) throw notFound("That summary is gone");
      chatId = r.chat_id;
      if (action === "accept") {
        acceptProposal(id);
        if (text) editSummary(id, { content: text });
      } else rejectProposal(id);
      break;
    }
    case "journal": {
      const r = one<JournalRow>("SELECT * FROM journals WHERE id = ?", id);
      if (!r) throw notFound("That journal is gone");
      chatId = r.chat_id;
      decideJournalProposal(id, action === "accept");
      if (action === "accept" && text) editJournal(id, text);
      break;
    }
    case "chronicle": {
      chatId = one<{ chat_id: string }>("SELECT chat_id FROM chronicle_proposals WHERE id = ?", id)?.chat_id ?? null;
      if (action === "accept") acceptChronicle(id, text ? { content: text } : undefined);
      else rejectChronicle(id);
      break;
    }
    case "disputed": {
      chatId = one<{ chat_id: string }>("SELECT chat_id FROM memories WHERE id = ?", id)?.chat_id ?? null;
      if (action === "accept") updateAtom(id, { status: "active", ...(text ? { content: text } : {}) });
      else deleteAtom(id);
      break;
    }
    case "merge": {
      const [keep, merge] = id.split("|");
      if (!keep || !merge) throw badRequest("Bad suggestion");
      chatId = one<{ chat_id: string }>("SELECT chat_id FROM entities WHERE id = ?", keep)?.chat_id ?? null;
      if (action === "accept") mergeEntities(keep, [merge]);
      else run("INSERT OR IGNORE INTO inbox_dismissed (key, chat_id, created_at) VALUES (?, ?, ?)", key, chatId, now());
      break;
    }
    case "world": {
      const [cid, ...pid] = id.split(":");
      chatId = cid ?? null;
      if (!cid) throw badRequest("Bad proposal");
      decideProposal(cid, pid.join(":"), action === "accept");
      break;
    }
    default: {
      const p = providers.get(kind!);
      if (!p) throw badRequest("Unknown inbox item");
      chatId = p.act(id, action, text);
    }
  }
  if (chatId) publish({ type: "memory.changed", chatId });
  publish({ type: "inbox.changed" });
  return { ok: true };
}
