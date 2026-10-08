/**
 * Tracks which chat each client is looking at, so push notifications only go
 * out when nobody is watching the reply arrive (CHAT-06).
 */
interface Presence {
  chatId: string | null;
  visible: boolean;
  at: number;
}

const clients = new Map<string, Presence>();
const STALE_MS = 75_000;

export function reportPresence(clientId: string, chatId: string | null, visible: boolean) {
  clients.set(clientId, { chatId, visible, at: Date.now() });
}

export function dropPresence(clientId: string) {
  clients.delete(clientId);
}

export function isChatWatched(chatId: string): boolean {
  const cutoff = Date.now() - STALE_MS;
  for (const [id, p] of clients) {
    if (p.at < cutoff) {
      clients.delete(id);
      continue;
    }
    if (p.visible && p.chatId === chatId) return true;
  }
  return false;
}
