import { ApiError, post } from "./api";
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
export async function flushOutbox() {
  if (outbox.sending || !outbox.items.length) return;
  outbox.sending = true;
  let sent = 0;
  try {
    while (outbox.items.length) {
      const q = outbox.items[0]!;
      const last = !outbox.items.slice(1).some((x) => x.chatId === q.chatId);
      try {
        await post(`/api/chats/${q.chatId}/send`, { content: q.content, generate: last, director: q.director || undefined });
      } catch (e) {
        if (e instanceof ApiError && (e.status === 0 || e.code === "offline")) return;
        // Refused before it was added (a reply is still being written): keep it for the next try.
        if (e instanceof ApiError && e.status === 400) {
          toast(`A waiting message is still waiting: ${e.message}`, { kind: "info" });
          return;
        }
        // Otherwise it's in the chat (even if the reply couldn't start) or the chat is gone: don't send it twice.
        toast(`A waiting message was sent, but: ${(e as Error).message}`, { kind: "error" });
      }
      outbox.items = outbox.items.filter((x) => x.id !== q.id);
      persist();
      sent++;
    }
  } finally {
    outbox.sending = false;
    if (sent) toast(`Sent ${sent} waiting message${sent === 1 ? "" : "s"}`, { kind: "ok" });
  }
}
