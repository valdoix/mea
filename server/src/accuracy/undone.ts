import { cleanText } from "../memory/text";
import type { WorldState } from "../trackers/types";
import { doneAhead, sentencesOf } from "./promptcheck";
import { wavedThrough } from "./quiet";
import { type Found, SLIPS } from "./slips";

/**
 * docs/22 3.3: a reply is trusted before it's checked, so its mistakes become records. #599 said
 * "Then groceries", 137 messages after they were bought; #629 said "the grocery run", the tracker
 * filed a plan for it, and the mistake was in the records one reply later. By rules: a sentence of
 * the reply, thoughts and dialogue too, that looks ahead at a done loop. While the flag is open what
 * the reply filed about that loop waits (`heldDone`); dismissing it says the story meant to.
 */

export function undoneRule(chatId: string, text: string, st: WorldState): Found[] {
  const ahead = doneAhead(st, { lists: true });
  const skip = wavedThrough(chatId);
  const out: Found[] = [];
  for (const s of sentencesOf(cleanText(text))) {
    const l = ahead(s);
    if (!l || skip.has(l.id) || out.some((f) => f.citations[0]?.id === l.id)) continue;
    out.push({
      kind: "undone",
      severity: "major",
      claim: s,
      conflict: `That already happened, at #${l.closed}: ${l.what}.`,
      citations: [{ ref: "L", type: "tracker", label: l.what, id: l.id, seq: l.closed }],
      fix: `${l.what} already happened (#${l.closed}). That's the past: nobody waits for it, plans it or promises it again.`,
      by: "rules",
    });
  }
  return out.slice(0, 3);
}

SLIPS.push({
  id: "undone",
  label: "Already done",
  description: "A reply treating something finished as still to come.",
  phase: "reply",
  on: (c) => c.continuity && c.role === "assistant",
  run: (t, s, c) => (s ? undoneRule(c.chatId, t, s) : []),
});
