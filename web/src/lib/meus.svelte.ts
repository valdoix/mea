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
