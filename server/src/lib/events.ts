/**
 * In-process event bus feeding the live SSE stream (ARCH-06).
 * Every connected client receives events; clients filter by chat on their side,
 * so a reply streams to both the phone and the PC at once.
 */
export type MeaEvent =
  | { type: "gen.start"; chatId: string; messageId: string; swipeIdx: number; generationId: string }
  | { type: "gen.delta"; chatId: string; messageId: string; generationId: string; text: string; reasoning?: string }
  | { type: "gen.end"; chatId: string; messageId: string; generationId: string; status: string; error?: string }
  | { type: "message.changed"; chatId: string; messageId: string }
  | { type: "chat.changed"; chatId: string }
  | { type: "jobs.activity"; running: number; queued: number }
  | { type: "quota.changed" }
  | { type: "memory.changed"; chatId: string }
  | { type: "library.changed"; what: "characters" | "personas" | "lorebooks" | "presets" | "connections" };

type Listener = (event: MeaEvent) => void;

const listeners = new Set<Listener>();

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function publish(event: MeaEvent) {
  for (const l of listeners) {
    try {
      l(event);
    } catch {
      // a broken listener must not affect others
    }
  }
}

export function listenerCount() {
  return listeners.size;
}
