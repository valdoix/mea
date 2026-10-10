import type { QuoteStyle } from "./render";

/** The open story's quote style (the chat's, else its character's), for how messages are shown. */
export const storyStyle = $state({ quotes: null as QuoteStyle });
