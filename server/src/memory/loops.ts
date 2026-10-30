import { all } from "../db/db";
import { deleteEvents, foldAt, trackerConfig, writeEvents } from "../trackers/store";
import { openLoops, quoted } from "../trackers/loops";
import type { Op } from "../trackers/types";
import type { SceneOutput } from "./prompts";
import type { LedgerRow } from "./store";

/**
 * docs/22 1.2: the scene build already runs and already says what a scene closed, in free text. Given
 * the open loops by id it can say which, so a closure needs no matching. A closure quotes the scene
 * and the quote is checked. What's checked goes in the ledger on the message it happened at, and
 * follows swipes, edits and rewinds like every other event.
 */

/** How many open loops a scene is shown, the newest kept. */
const SHOWN = 40;

const trackersOff = (chatId: string) => trackerConfig(chatId).mode === "off";

/** A scene's loops: open when it began, so a rebuild can close its own again, or by its end, so it can close one made in it. */
function sceneLoops(chatId: string, startSeq: number, endSeq: number) {
  const byId = new Map([...openLoops(foldAt(chatId, { uptoSeq: startSeq - 1 }).state), ...openLoops(foldAt(chatId, { uptoSeq: endSeq }).state)].map((l) => [l.id, l]));
  return [...byId.values()];
}

/** What the scene is told is open. */
export function loopBlock(chatId: string, startSeq: number, endSeq: number) {
  if (trackersOff(chatId)) return "";
  const open = sceneLoops(chatId, startSeq, endSeq).slice(-SHOWN);
  return open.length ? `OPEN LOOPS in this scene:\n${open.map((l) => `${l.id} (${l.kind}) ${l.what}`).join("\n")}` : "";
}

/** A scene's loop events, written again with each build of it: one that's rebuilt says all of it again. */
export function applySceneLoops(chatId: string, startSeq: number, endSeq: number, o: Pick<SceneOutput, "loopsClosed" | "loopsOpened">, rows: LedgerRow[]) {
  if (trackersOff(chatId)) return;
  const old = all<{ id: string }>(
    "SELECT e.id FROM tracker_events e JOIN messages m ON m.id = e.message_id WHERE e.chat_id = ? AND e.source = 'memory' AND m.seq BETWEEN ? AND ?",
    chatId,
    startSeq,
    endSeq,
  ).map((r) => r.id);
  if (old.length) deleteEvents(chatId, old);
  const open = new Set(sceneLoops(chatId, startSeq, endSeq).map((l) => l.id));
  const byMessage = new Map<string, Op[]>();
  const add = (id: string, op: Op) => byMessage.set(id, [...(byMessage.get(id) ?? []), op]);
  for (const l of o.loopsOpened) {
    const what = l.what.replace(/\s+/g, " ").trim();
    const at = rows.find((r) => r.seq === l.seq) ?? rows.at(-1);
    if (!what || !at) continue;
    const kind = ["promise", "plan", "errand", "question"].includes(l.kind) ? l.kind : "errand";
    add(at.id, { op: "loop", args: { action: "new", what, kind }, raw: `loop: ${what} | ${kind}` });
  }
  for (const c of o.loopsClosed) {
    if (!open.has(c.id)) continue;
    const at = rows.find((r) => r.seq === c.seq && quoted(r.content, c.quote)) ?? rows.find((r) => quoted(r.content, c.quote));
    if (at) add(at.id, { op: "loop", subject: c.id, args: { action: "done", how: c.quote }, raw: `loop ${c.id}: done — ${c.quote}` });
  }
  for (const [messageId, ops] of byMessage) {
    const swipe = all<{ active_swipe: number }>("SELECT active_swipe FROM messages WHERE id = ?", messageId)[0];
    if (swipe) writeEvents(chatId, { messageId, swipeIdx: swipe.active_swipe }, ops, "memory");
  }
}
