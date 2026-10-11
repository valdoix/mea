import { get } from "./api";
import { onEvent } from "./events";
import type { InboxSource } from "./types";

/**
 * P1: the suggestions waiting in the Inbox for the open chat (lessons, canon, pressures…), for the
 * side dock's badge and the Chat tab's Status tile. Refreshed when the Inbox changes.
 */
export const sugg = $state<{ chatId: string | null; count: number; bySource: Partial<Record<InboxSource, number>> }>({ chatId: null, count: 0, bySource: {} });

let timer: ReturnType<typeof setTimeout> | undefined;

export async function loadSuggestions(chatId: string) {
  try {
    const r = await get<{ count: number; bySource: Partial<Record<InboxSource, number>> }>(`/api/inbox/count?chat=${encodeURIComponent(chatId)}`);
    if (sugg.chatId !== chatId) return;
    sugg.count = r.count;
    sugg.bySource = r.bySource ?? {};
  } catch {
    // the badge is optional
  }
}

/** Follows one chat's suggestions; returns the clean-up for an $effect. */
export function watchSuggestions(chatId: string) {
  sugg.chatId = chatId;
  sugg.count = 0;
  sugg.bySource = {};
  void loadSuggestions(chatId);
  const off = onEvent((e) => {
    if (e.type === "inbox.changed" || e.type === "memory.changed" || e.type === "reconnected") {
      clearTimeout(timer);
      timer = setTimeout(() => void loadSuggestions(chatId), 900);
    }
  });
  return () => {
    off();
    clearTimeout(timer);
    if (sugg.chatId === chatId) sugg.chatId = null;
  };
}
