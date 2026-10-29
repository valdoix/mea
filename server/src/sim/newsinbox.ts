import { registerInboxProvider } from "../accuracy/inbox";
import { currentFold } from "../trackers/store";
import { decideNews } from "./service";

/** docs/21 5.3: news off the page waiting for your word (news: ask), in the Inbox with its why. */
registerInboxProvider({
  kind: "worldnews",
  source: "world",
  items: (chats) =>
    chats.flatMap((c) => {
      let pending;
      try {
        pending = Object.values(currentFold(c.id).result.state.sim.newsAsk ?? {});
      } catch {
        return []; // trackers off for this chat
      }
      return pending.map((p) => ({
        key: `worldnews:${c.id}:${p.id}`,
        chatId: c.id,
        chatTitle: "",
        title: `${p.hop.to} could hear it from ${p.hop.from}, ${p.hop.medium}`,
        why: (p.op.why ?? []).join(" · ") || "The world off the page would pass this on.",
        before: null,
        after: p.hop.statement,
        editable: false,
        createdAt: 0,
        link: `/chat/${c.id}/world`,
        labels: { accept: "Let it travel", reject: "Not this" },
      }));
    }),
  act: (id, action) => {
    const [chatId, ...rest] = id.split(":");
    if (!chatId) return null;
    decideNews(chatId, rest.join(":"), action === "accept");
    return chatId;
  },
});
