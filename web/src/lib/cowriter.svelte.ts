/** The co-writer panel's state, so any part of a studio (like "Expand my idea") can open it with a thought started. */
export const cowriter = $state({ open: false, draft: "" });

/** Opens the co-writer, with the message box started (the author finishes the thought). */
export function brainstorm(start = "") {
  if (start && !cowriter.draft.trim()) cowriter.draft = start;
  cowriter.open = true;
}
