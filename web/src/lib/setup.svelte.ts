/** F1: Session Zero, opened by itself when a chat starts, or from Chat tab › Story setup. */
export const setupState = $state<{ open: boolean; chatId: string | null; seq: number }>({ open: false, chatId: null, seq: 0 });

export function openSetup(chatId: string) {
  setupState.chatId = chatId;
  setupState.open = true;
  setupState.seq++;
}
