import { badRequest, notFound } from "../lib/http";
import { publish } from "../lib/events";
import { registerInboxProvider } from "../accuracy/inbox";
import { userEditAt } from "./service";
import { currentFold, linesToOps } from "./store";
import type { Fact, WorldState } from "./types";

/**
 * docs/35 7.2 and 7.3: "Does Walter still not know this?" Asked, not assumed, when someone a secret is
 * kept from has shared three scenes with the people it's about, or the tracker wrote that they learned
 * something like it in other words. Your answer is a know line you set, so it isn't asked again.
 */

export const SHARED_SCENES = 3;

export interface SecretAsk {
  key: string;
  id: string;
  who: string;
  statement: string;
  why: string;
}

const stateOf = (chatId: string): WorldState | null => {
  try {
    return currentFold(chatId).result.state;
  } catch {
    return null;
  }
};

export function secretAsks(st: WorldState): SecretAsk[] {
  const out: SecretAsk[] = [];
  const nm = (id: string) => st.chars[id]?.name ?? id;
  for (const f of Object.values(st.facts)) {
    const s = f.secret;
    if (!s || s.out) continue;
    // One question a secret at a time: a line that said they learned it first, then whoever has been around longest.
    const asks: (SecretAsk & { rank: number })[] = [];
    for (const id of s.from) {
      const c = st.chars[id];
      if (!c || c.dead || c.isUser || f.stances[id]?.set) continue;
      const maybe = s.maybe?.[id];
      const t = s.together?.[id];
      const about = (f.about ?? []).filter((x) => x !== id).map(nm);
      if (maybe) asks.push({ rank: 1e6, key: f.key, id, who: c.name, statement: f.statement, why: `The tracker wrote that ${c.name} learned "${maybe.said}" (message #${maybe.seq}). That may be this secret in other words.` });
      else if (t && t.scenes >= SHARED_SCENES) asks.push({ rank: t.scenes, key: f.key, id, who: c.name, statement: f.statement, why: `${c.name} has been in ${t.scenes} scenes with ${about.join(" and ") || "the people it's about"} since it was kept from them.` });
    }
    const top = asks.sort((a, b) => b.rank - a.rank)[0];
    if (top) {
      const { rank: _rank, ...ask } = top;
      out.push(ask);
    }
  }
  return out;
}

function answer(chatId: string, f: Fact, who: string, knows: boolean) {
  userEditAt(chatId, linesToOps([`know ${who}: #${f.key} ${f.statement} | you said so · ${knows ? "knows" : "unaware"}`]).ops);
  publish({ type: "trackers.changed", chatId });
  publish({ type: "inbox.changed" });
}

registerInboxProvider({
  kind: "secret-ask",
  source: "secret",
  items: (chats) =>
    chats.flatMap((c) => {
      const st = stateOf(c.id);
      return st
        ? secretAsks(st).map((x) => ({
            key: `secret-ask:${c.id}:${x.key}:${x.id}`,
            chatId: c.id,
            chatTitle: "",
            title: `Does ${x.who} still not know this?`,
            why: `${x.why} Say whether they know it now; your answer is kept.`,
            before: null,
            after: x.statement,
            editable: false,
            createdAt: 0,
            link: `/chat/${c.id}/codex?tab=ledgers`,
            labels: { accept: "They know", reject: "Still doesn't" },
            sameAs: `${x.key}|${x.id}`,
          }))
        : [];
    }),
  act: (id, action) => {
    const [chatId, key, who] = id.split(":");
    if (!chatId || !key || !who) throw badRequest("Bad card");
    const st = stateOf(chatId);
    const f = st?.facts[key];
    const c = st?.chars[who];
    if (!f?.secret || !c) throw notFound("That secret is gone");
    answer(chatId, f, c.name, action === "accept");
    return chatId;
  },
});
