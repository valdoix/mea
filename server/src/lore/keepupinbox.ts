import { all } from "../db/db";
import { registerInboxProvider } from "../accuracy/inbox";
import { confirmFact, factLine, getFact, retireFact } from "./facts";
import { afterApplied, cardText, decideUpdate, updateProposals } from "./keepup";
import { decideBookDetails, detailsByBook, detailsText } from "./details";
import { coverageFindings, fixFinding } from "./coverage";
import { compactProposals, decideCompaction } from "./compact";
import { now, run } from "../db/db";

/**
 * The Inbox cards of living lore (docs/15, part 2): update proposals and contradictions on an entry's
 * facts (Apply / Not this), rewrites of an entry's text (Keep / Not now), and story facts whose
 * message was edited since (Still true / Retire it).
 */

registerInboxProvider({
  kind: "lore-update",
  source: "lore",
  undoable: true,
  items: (chats) =>
    chats.flatMap((c) =>
      updateProposals(c.id).map((p) => {
        const t = cardText(p);
        return {
          key: `lore-update:${p.id}`,
          chatId: c.id,
          chatTitle: c.title,
          title: t.title,
          why: t.why,
          before: t.before,
          after: t.after,
          editable: true,
          createdAt: p.createdAt,
          link: `/chat/${c.id}/codex`,
          labels: p.kind === "core" ? { accept: "Keep", reject: "Not now" } : p.diff.contradiction ? { accept: "Update it", reject: "Keep mine" } : { accept: "Apply", reject: "Not this" },
        };
      }),
    ),
  act: (id, action, edited) => {
    const r = decideUpdate(id, action, edited);
    // 2.4: with the facts changed, the entry's own text may now say the old thing.
    if (action === "accept") void afterApplied(id).catch(() => {});
    return r.chatId;
  },
});

// 3.2: details drafted for a book's people, waiting for your yes (they belong to no chat).
// docs/17, 4.3: one card per book, however many people it drafted for.
registerInboxProvider({
  kind: "lore-details",
  source: "lore",
  global: true,
  items: () =>
    detailsByBook().map((b) => ({
      key: `lore-details:${b.bookId}`,
      chatId: "",
      chatTitle: "",
      title: b.people.length > 1 ? `Details drafted for ${b.people.length} people` : `Details drafted for ${b.people[0]!.name || "an entry"}`,
      why: "The lore leaves these open, so Mea drafted them to keep every chat the same. Until you keep them they're sent as “likely”, not as fact.",
      before: null,
      after: detailsText(b),
      editable: true,
      createdAt: Math.max(...b.people.flatMap((x) => x.facts.map((f) => f.createdAt))),
      link: b.people.length > 1 ? `/lorebooks/${b.bookId}` : `/lorebooks/${b.bookId}?entry=${b.people[0]!.entryId}`,
      labels: { accept: "Keep all", reject: "Clear them" },
    })),
  act: (id, action, edited) => {
    decideBookDetails(id, action, edited);
    return null;
  },
});

// 7.1: coverage findings, each with its fix (Draft facts, Add key, Raise budget, Merge, Confirm); Not now hides it.
registerInboxProvider({
  kind: "lore-health",
  source: "lore",
  items: (chats) =>
    chats.flatMap((c) =>
      coverageFindings(c.id).map((f) => ({
        key: `lore-health:${f.key}`,
        chatId: c.id,
        chatTitle: c.title,
        title: `Lore health: ${f.entries.map((e) => e.title).join(" · ")}`,
        why: f.message,
        before: null,
        after: f.entries.map((e) => `${e.title} (${e.bookName})`).join("\n"),
        editable: false,
        createdAt: 0,
        link: `/chat/${c.id}/codex`,
        labels: { accept: f.fixLabel, reject: "Not now" },
      })),
    ),
  act: (id, action) => {
    const chatId = id.split(":")[1] ?? null;
    if (action === "reject") run("INSERT OR IGNORE INTO inbox_dismissed (key, chat_id, created_at) VALUES (?, ?, ?)", `lore-health:${id}`, chatId, now());
    else if (chatId) fixFinding(chatId, id);
    return chatId;
  },
});

// 7.3: a shorter text for an entry you wrote, names and numbers kept (no chat: listed with all stories).
registerInboxProvider({
  kind: "lore-compact",
  source: "lore",
  global: true,
  items: () =>
    compactProposals().map((p) => ({
      key: `lore-compact:${p.entryId}`,
      chatId: "",
      chatTitle: "",
      title: `A shorter “${p.entry.comment || p.entry.keys[0] || "entry"}”`,
      why: "The text has grown long. This keeps every name and number; the facts and their History aren't touched.",
      before: p.entry.content,
      after: (p.entry.extra as { compactProposal: { content: string } }).compactProposal.content,
      editable: true,
      createdAt: (p.entry.extra as { compactProposal: { at: number } }).compactProposal.at,
      link: `/lorebooks/${p.bookId}?entry=${p.entryId}`,
      labels: { accept: "Keep", reject: "Not now" },
    })),
  act: (id, action, edited) => {
    decideCompaction(id, action, edited);
    return null;
  },
});

registerInboxProvider({
  kind: "lore-recheck",
  source: "lore",
  items: (chats) => {
    if (!chats.length) return [];
    const title = new Map(chats.map((c) => [c.id, c.title]));
    const rows = all<{ id: string; chat_id: string; name: string; created_at: number }>(
      `SELECT f.id, f.chat_id, f.created_at, COALESCE(json_extract(e.data, '$.comment'), '') AS name FROM lore_facts f JOIN lorebook_entries e ON e.id = f.entry_id
       WHERE f.basis IS NOT NULL AND f.deleted_at IS NULL AND f.chat_id IN (${chats.map(() => "?").join(",")})`,
      ...chats.map((c) => c.id),
    );
    return rows.flatMap((r) => {
      const f = getFact(r.id);
      if (!f?.stale || !f.now) return [];
      return [
        {
          key: `lore-recheck:${f.id}`,
          chatId: r.chat_id,
          chatTitle: title.get(r.chat_id) ?? "",
          title: `${r.name || "A lore entry"}: is this still true?`,
          why: `The message this fact came from (#${f.sinceSeq ?? "?"}) was edited since.`,
          before: null,
          after: factLine(f),
          editable: false,
          createdAt: f.updatedAt,
          link: `/chat/${r.chat_id}?at=${f.sinceSeq ?? ""}`,
          labels: { accept: "Still true", reject: "Retire it" },
        },
      ];
    });
  },
  act: (id, action) => {
    const f = getFact(id);
    if (!f) return null;
    if (action === "accept") confirmFact(id);
    else retireFact(id, { chatId: f.chatId });
    return f.chatId;
  },
});
