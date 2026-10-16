import { registerInboxProvider } from "../accuracy/inbox";
import { badRequest } from "../lib/http";
import type { LinkKind } from "./linked";
import { skipChanges, takeChanges, versionsWithChanges } from "./versionsync";

/**
 * Part 5 (docs/14): one Inbox note per version whose original changed where the version kept it the
 * same. Approve takes those changes; Reject makes them the version's own. What the version changed
 * for itself waits on its page, where it can be translated again through the map.
 */
registerInboxProvider({
  kind: "version",
  source: "versions",
  global: true,
  items: () =>
    versionsWithChanges().flatMap((v) => {
      const kept = v.changes.filter((c) => c.state === "kept");
      const changed = v.changes.filter((c) => c.state === "changed");
      if (!kept.length) return [];
      const entries = kept.filter((c) => c.target === "entry").length;
      const what = [...kept.filter((c) => c.target === "field").map((c) => c.label), entries ? `${entries} lore ${entries === 1 ? "entry" : "entries"}` : ""].filter(Boolean).join(", ");
      const one = kept.length === 1 ? kept[0]! : null;
      const page = v.kind === "persona" ? `/personas/${v.id}` : `/character/${v.id}`;
      return [
        {
          key: `version:${v.kind}:${v.id}`,
          chatId: "",
          chatTitle: v.label ? `${v.name} · ${v.label}` : v.name,
          title: `${v.originName} changed: ${what}`,
          why: `${v.label || v.name} keeps ${kept.length === 1 ? "this" : "these"} the same as ${v.originName}. Approve to take the change${kept.length === 1 ? "" : "s"}; reject and ${kept.length === 1 ? "it becomes" : "they become"} this version's own.${changed.length ? ` Also changed, and translated for this version: ${changed.map((c) => c.label).join(", ")}; translate ${changed.length === 1 ? "it" : "them"} on the version's page.` : ""}`,
          before: one ? one.mine : null,
          after: one ? one.now : kept.map((c) => `## ${c.label}\n${c.now}`).join("\n\n"),
          editable: false,
          createdAt: 0,
          link: page,
        },
      ];
    }),
  act: (id, action) => {
    const [kind, vid] = id.split(":") as [LinkKind, string];
    if ((kind !== "character" && kind !== "persona") || !vid) throw badRequest("Bad note");
    const keys = versionsWithChanges()
      .find((v) => v.kind === kind && v.id === vid)
      ?.changes.filter((c) => c.state === "kept")
      .map((c) => c.key);
    if (!keys?.length) throw badRequest("Nothing waits for this version any more");
    if (action === "accept") takeChanges(kind, vid, keys);
    else skipChanges(kind, vid, keys);
    return null;
  },
});
