/**
 * Meus in a chat: the box's text, a message waiting to be sent, and a request to open the panel
 * (from a shortcut elsewhere in the chat).
 */
export const meus = $state({ draft: "", queued: "", want: 0 });

/** Opens Meus with a message started for you ("About this: …"); what you'd already typed stays. */
export function askMeus(start = "") {
  if (start && !meus.draft.trim()) meus.draft = start;
  meus.want++;
}

/** Opens Meus and sends this right away ("/meus merge Jax into Jackie"). */
export function sendToMeus(text: string) {
  meus.queued = text;
  meus.want++;
}

/** Where a shortcut from another page wants Meus opened (the chat opens its tab on arrival). */
export const meusFor = $state({ chatId: "" });

/** From outside the chat (the inbox, Cast, the Codex, the command palette): go there and open Meus. */
export function openMeusIn(chatId: string, text = "", send = false) {
  if (send && text) meus.queued = text;
  else if (text && !meus.draft.trim()) meus.draft = text;
  meusFor.chatId = chatId;
}
