import { one, run } from "../db/db";
import { publish } from "../lib/events";
import { badRequest, notFound } from "../lib/http";
import { registerInboxProvider } from "../accuracy/inbox";
import { keptOffpage, neverSaid, revealOffpage, setExposureReader } from "../accuracy/offpage";
import { getMessageRow, updateChat } from "../services/chats";
import { registerStatusTile } from "../services/status";
import { currentFold, linesToOps, writeEvents } from "./store";
import { userEditAt } from "./service";
import type { Exposure, Fact, WorldState } from "./types";

/**
 * Secret exposure clocks (Almanac plan B2). Each tracker secret has a 0–6 clock and a ranked list
 * of who is closest to finding out, and why. After each reply the rules move it for reasons the
 * trackers already record: a keeper in earshot of someone it's kept from, a clue pointing at it,
 * the narration slipping a word kept off the page, a rumour reaching someone off the page. The
 * moves are `expose` events tied to the reply, so a swipe, an edit or a delete takes them back.
 * When the clock fills, a card offers to let it come out on the page, in a scene; never off it.
 */

export const MAX = 6;

export interface ExposureView {
  key: string;
  statement: string;
  cur: number;
  max: number;
  /** Closest first: who, how close, and why. */
  near: { id: string; name: string; score: number; why: string[] }[];
  history: Exposure["history"];
}

const stateOf = (chatId: string): WorldState | null => {
  try {
    return currentFold(chatId).result.state;
  } catch {
    return null;
  }
};

const words = (s: string) => new Set((s.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? []).filter((w) => !STOP.has(w)));
const STOP = new Set("that this with from have they them their there what when where which while about would could should been were will into just only than then also some more most very your yours".split(" "));
const overlap = (a: string, b: string) => {
  const A = words(a);
  const B = words(b);
  if (!A.size || !B.size) return 0;
  let n = 0;
  for (const w of A) if (B.has(w)) n++;
  return n / Math.min(A.size, B.size);
};

/** Every tracker secret that's still a secret from someone, with its clock. */
export function exposureFor(chatId: string): ExposureView[] {
  const st = stateOf(chatId);
  if (!st) return [];
  return Object.values(st.facts)
    .filter((f) => f.secret)
    .map((f) => view(st, f));
}

function view(st: WorldState, f: Fact): ExposureView {
  const e = st.exposure?.[f.key];
  return {
    key: f.key,
    statement: f.statement,
    cur: e?.cur ?? 0,
    max: e?.max ?? MAX,
    near: Object.entries(e?.near ?? {})
      .filter(([id, n]) => n.score > 0 && !st.chars[id]?.isUser)
      .map(([id, n]) => ({ id, name: st.chars[id]?.name ?? id, score: n.score, why: n.why }))
      .sort((a, b) => b.score - a.score),
    history: e?.history ?? [],
  };
}

const line = (key: string, delta: number, why: string, who?: string) => `expose #${key}: ${delta > 0 ? "+" : ""}${delta}${who ? ` | ${who}` : ""} — ${why}`;

/**
 * The rules, after the trackers have read a reply (an onTrackerUpdate hook). At most one step per
 * reason per secret; "in earshot" counts once a scene for each person.
 */
export function exposureAfterReply(chatId: string, messageId: string, swipeIdx?: number) {
  const m = getMessageRow(messageId);
  if (!m || m.deleted_at) return;
  const anchor = { messageId, swipeIdx: swipeIdx ?? -1 };
  // A reply read again starts over (its earlier moves go).
  run("DELETE FROM tracker_events WHERE message_id = ? AND swipe_idx = ? AND source = 'engine' AND op LIKE '%\"op\":\"expose\"%'", messageId, anchor.swipeIdx);
  const st = stateOf(chatId);
  if (!st) return;
  const secrets = Object.values(st.facts).filter((f) => f.secret && f.secret.from.length);
  if (!secrets.length) return;
  const present = new Set(Object.values(st.chars).filter((c) => (c.tier === "spot" || c.tier === "peri") && !c.dead).map((c) => c.id));
  const name = (id: string) => (st.chars[id]?.isUser ? null : (st.chars[id]?.name ?? null));
  const prose = one<{ content: string }>("SELECT content FROM swipes WHERE message_id = ? AND idx = ?", messageId, m.active_swipe)?.content ?? "";
  const offpage = keptOffpage(chatId);
  const lines: string[] = [];
  for (const f of secrets) {
    const e = st.exposure?.[f.key];
    if ((e?.cur ?? 0) >= (e?.max ?? MAX)) continue;
    const thisScene = (e?.history ?? []).filter((h) => h.seq >= st.sceneStartSeq);
    // A keeper in earshot of someone it's kept from (once a scene for each of them).
    const keeper = f.secret!.keepers.find((k) => present.has(k));
    if (keeper) {
      for (const id of f.secret!.from) {
        const who = name(id);
        if (!who || !present.has(id) || thisScene.some((h) => h.who === id && h.why?.startsWith("in earshot"))) continue;
        lines.push(line(f.key, 1, `in earshot of ${name(keeper) ?? "the keeper"}`, who));
        break;
      }
    }
    // A clue this reply added that points at it.
    const clue = st.clues.find((c) => c.seq === m.seq && c.pointsTo && (c.pointsTo.toLowerCase().includes(f.key) || overlap(c.pointsTo, f.statement) >= 0.5 || overlap(c.text, f.statement) >= 0.5));
    if (clue) {
      const who = f.secret!.from.map(name).find((n) => n && present.has(f.secret!.from.find((id) => name(id) === n)!));
      lines.push(line(f.key, 1, `a clue points at it: ${clue.text.slice(0, 80)}`, who ?? undefined));
    }
    // The narration slipped a word kept off the page.
    const op = offpage.filter((o) => o.ref === `tracker:${f.key}`);
    if (op.length && neverSaid(prose, op).length) lines.push(line(f.key, 1, "the narration slipped"));
    // A rumour of it reached someone off the page (each hop counts once).
    const hops = st.sim.news.filter((h) => h.fact === f.key || overlap(h.statement, f.statement) >= 0.6);
    const counted = (e?.history ?? []).filter((h) => h.why?.startsWith("a rumour")).length;
    const hop = hops[counted];
    if (hop) lines.push(line(f.key, 1, `a rumour reached ${hop.to}`, f.secret!.from.map(name).find((n) => n && n.toLowerCase() === hop.to.toLowerCase()) ?? undefined));
  }
  if (!lines.length) return;
  const { ops } = linesToOps(lines);
  writeEvents(chatId, anchor, ops, "engine");
}

/** Your hand on the clock: + / −, "Raise the stakes" (+1 and a cue) and "Cool it down" (−1). */
export function nudgeExposure(chatId: string, key: string, delta: number, how: "set" | "raise" | "cool" | "hold" = "set") {
  const st = stateOf(chatId);
  const f = st?.facts[key];
  if (!st || !f?.secret) throw notFound("That secret is gone");
  if (!delta) throw badRequest("Nothing to change");
  const why = how === "raise" ? "you raised the stakes" : how === "cool" ? "you cooled it down" : how === "hold" ? "held one more scene" : "you set it";
  const ids = userEditAt(chatId, linesToOps([line(key, delta, why)]).ops);
  if (how === "raise") updateChat(chatId, { settings: { cue: `The next scene puts this secret at risk of coming out (through what people see and infer, not by announcement): ${f.statement}` } });
  publish({ type: "trackers.changed", chatId });
  publish({ type: "inbox.changed" });
  return { ids, exposure: view(currentFold(chatId).result.state, f) };
}

/** "Let it come out": a cue for this scene (on the page, never off it); an off-page hold on it lifts. */
export function letItComeOut(chatId: string, key: string) {
  const st = stateOf(chatId);
  const f = st?.facts[key];
  if (!st || !f) throw notFound("That secret is gone");
  const near = view(st, f).near[0];
  updateChat(chatId, { settings: { cue: `In this scene the secret comes out on the page: ${f.statement}${near ? ` Show how ${near.name} finds out (${near.why.at(-1) ?? "from what they've seen"}).` : ""} Let it land through action and reaction, not a summary.` } });
  for (const o of keptOffpage(chatId).filter((x) => x.ref === `tracker:${key}`)) revealOffpage(o.id);
  publish({ type: "inbox.changed" });
}

// B1's reveal plan "when its exposure clock fills" reads the clock here.
setExposureReader((chatId, o) => {
  if (!o.ref.startsWith("tracker:")) return 0;
  return stateOf(chatId)?.exposure?.[o.ref.slice(8)]?.cur ?? 0;
});

// A full clock: Let it come out (in a scene), or Hold one more scene.
registerInboxProvider({
  kind: "exposure",
  source: "secret",
  items: (chats) =>
    chats.flatMap((c) => {
      const kept = keptOffpage(c.id);
      return exposureFor(c.id)
        .filter((x) => x.cur >= x.max && !nothingLeft(c.id, x.key))
        // A secret B1 holds "until its clock fills" asks through its own card.
        .filter((x) => !kept.some((o) => o.ref === `tracker:${x.key}` && o.reveal.when === "exposure"))
        .map((x) => ({
          key: `exposure:${c.id}:${x.key}`,
          chatId: c.id,
          chatTitle: "",
          title: "A secret is about to come out",
          why: `Its exposure clock is full${x.near[0] ? `; ${x.near[0].name} is closest (${x.near[0].why.at(-1) ?? ""})` : ""}. Approve to let it come out on the page, in a scene; reject to hold it one more scene.`,
          before: null,
          after: x.statement,
          editable: false,
          createdAt: 0,
          link: `/chat/${c.id}/codex?tab=ledgers`,
        }));
    }),
  act: (id, action) => {
    const [chatId, ...rest] = id.split(":");
    const key = rest.join(":");
    if (!chatId) throw badRequest("Bad card");
    if (action === "accept") {
      letItComeOut(chatId, key);
      // The card is answered: the clock steps back so it doesn't ask again before the scene plays.
      nudgeExposure(chatId, key, -1, "set");
    } else nudgeExposure(chatId, key, -1, "hold");
    return chatId;
  },
});

/** A secret revealed to everyone it was kept from has nothing left to come out. */
function nothingLeft(chatId: string, key: string) {
  const f = stateOf(chatId)?.facts[key];
  return !f?.secret?.from.length;
}

registerStatusTile((chatId) => {
  const top = exposureFor(chatId)
    .filter((x) => x.cur > 0)
    .sort((a, b) => b.cur - a.cur)[0];
  if (!top) return null;
  return {
    id: "exposure",
    n: top.cur >= 4 ? 1 : 0,
    value: `${top.cur}/${top.max}`,
    label: `secret: ${top.statement.slice(0, 40)}${top.statement.length > 40 ? "…" : ""}`,
    tone: top.cur >= top.max ? "red" : "amber",
    title: top.near[0] ? `${top.near[0].name} is closest` : "How close it is to coming out",
    open: { href: `/chat/${chatId}/codex?tab=ledgers` },
    order: 25,
  };
});
