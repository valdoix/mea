import { ApiError, post, storedMessage } from "./api";
import { toast } from "./state.svelte";

/**
 * ARCH-11 / MOB-13: messages written while Mea can't be reached wait here, on this device, and
 * are sent in order when it's back. Only the last waiting message of a chat asks for a reply.
 */
export interface Queued {
  id: string;
  chatId: string;
  content: string;
  director: boolean;
  at: number;
}

const KEY = "mea.outbox";
function read(): Queued[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
export const outbox = $state({ items: read(), sending: false });
function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(outbox.items));
  } catch {
    // storage full or blocked: the queue lasts until the tab closes
  }
}

export function enqueueSend(chatId: string, content: string, director = false) {
  outbox.items = [...outbox.items, { id: crypto.randomUUID(), chatId, content, director, at: Date.now() }];
  persist();
}
export function cancelQueued(id: string) {
  outbox.items = outbox.items.filter((q) => q.id !== id);
  persist();
}

/** Sends what's waiting. Stops at the first sign Mea is still out of reach. */
/** M7: this device was unpaired: what waited here is dropped with it. */
export function clearOutbox() {
  outbox.items = [];
  clearTimeout(retryTimer);
  try {
    localStorage.removeItem(KEY);
  } catch {
    // storage unavailable
  }
}

// H8: a message that couldn't go out is tried again on a timer that backs off, not on every change.
const RETRY_MIN = 5_000;
const RETRY_MAX = 5 * 60_000;
let retryDelay = RETRY_MIN;
let notBefore = 0;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
const warned = new Set<string>();
function backOff() {
  notBefore = Date.now() + retryDelay;
  clearTimeout(retryTimer);
  retryTimer = setTimeout(() => void flushOutbox(), retryDelay);
  retryDelay = Math.min(RETRY_MAX, retryDelay * 2);
}

/**
 * Sends what's waiting. Stops at the first message that couldn't go out and tries again later.
 * `now` skips the wait (Mea just came back).
 */
export async function flushOutbox(opts: { now?: boolean } = {}) {
  if (outbox.sending || !outbox.items.length) return;
  if (!opts.now && Date.now() < notBefore) return;
  outbox.sending = true;
  let sent = 0;
  try {
    while (outbox.items.length) {
      const q = outbox.items[0]!;
      const last = !outbox.items.slice(1).some((x) => x.chatId === q.chatId);
      try {
        // The item's id lets the server recognise a message it already has (it answers `duplicate`).
        await post(`/api/chats/${q.chatId}/send`, { content: q.content, generate: last, director: q.director || undefined, clientId: q.id });
      } catch (e) {
        // Still out of reach, or refused before it was added (e.g. a reply is still being written): try again later.
        const gone = e instanceof ApiError && e.status === 404;
        if (!gone && !storedMessage(e)) {
          if (e instanceof ApiError && e.status !== 0 && !warned.has(q.id)) {
            warned.add(q.id);
            toast(`A waiting message is still waiting: ${e.message}`, { kind: "info" });
          }
          backOff();
          return;
        }
        // It's in the chat (only the reply couldn't start), or the chat is gone: don't send it twice.
        toast(gone ? `A waiting message's chat is gone: ${(e as Error).message}` : `A waiting message was sent, but: ${(e as Error).message}`, { kind: "error" });
      }
      outbox.items = outbox.items.filter((x) => x.id !== q.id);
      warned.delete(q.id);
      persist();
      sent++;
      retryDelay = RETRY_MIN;
      notBefore = 0;
    }
  } finally {
    outbox.sending = false;
    if (sent) toast(`Sent ${sent} waiting message${sent === 1 ? "" : "s"}`, { kind: "ok" });
  }
}
