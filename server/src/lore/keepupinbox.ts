import { all } from "../db/db";
import { registerInboxProvider } from "../accuracy/inbox";
import { confirmFact, factLine, getFact, retireFact } from "./facts";
import { afterApplied, cardText, decideUpdate, updateProposals } from "./keepup";

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
