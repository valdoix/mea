import { all, parseJson } from "../db/db";
import { publish } from "../lib/events";
import type { JobContext } from "../services/jobs";
import { decideEdit, type EditProposal } from "../steer/editor";
import { flagsFor } from "./checker";
import { fixIssueSentence } from "./fixes";

/**
 * docs/33 7.6: what a story has waiting on you, as numbers, and the two buttons that clear it. In
 * one story 25 editor fixes sat as "proposed" for hundreds of messages, and the checker's true
 * catches (a heart surgeon, a faucet "still unfixed") stayed open in the text because each needed
 * finding and clicking on its own.
 */

/** How many sentences one "fix all" rewrites: each is a helper call. The rest wait for the next press. */
export const FIX_ALL_MAX = 20;

interface Edit {
  messageId: string;
  seq: number;
}

/** Editor suggestions still waiting on the takes that are showing. */
export function proposedEdits(chatId: string): Edit[] {
  return all<{ id: string; seq: number; meta: string }>(
    `SELECT m.id, m.seq, s.meta FROM messages m JOIN swipes s ON s.message_id = m.id AND s.idx = m.active_swipe
     WHERE m.chat_id = ? AND m.deleted_at IS NULL AND m.role = 'assistant' AND s.meta LIKE '%"edit"%' ORDER BY m.seq`,
    chatId,
  )
    .filter((r) => (parseJson<{ edit?: EditProposal }>(r.meta, {}).edit?.status ?? "") === "proposed")
    .map((r) => ({ messageId: r.id, seq: r.seq }));
}

/** Open notes that can be fixed by rewriting their sentence: showing, not waved off, with a fix to apply. */
export function fixable(chatId: string) {
  return flagsFor(chatId, { open: true }).flatMap((f) => f.issues.filter((i) => !i.dismissed && !i.quiet && i.fix?.trim() && i.claim?.trim()).map((i) => ({ flagId: f.id, messageId: f.messageId, issueId: i.id, kind: i.kind })));
}

export function openNotes(chatId: string) {
  const flags = flagsFor(chatId, { open: true });
  const issues = flags.reduce((n, f) => n + f.issues.filter((i) => !i.dismissed && !i.quiet).length, 0);
  return { replies: flags.filter((f) => f.issues.some((i) => !i.dismissed && !i.quiet)).length, issues, fixable: fixable(chatId).length, edits: proposedEdits(chatId).length, fixAllMax: FIX_ALL_MAX };
}

/** Every waiting editor suggestion applied; one whose reply changed since is left (and counted). No model. */
export function applyAllEdits(chatId: string) {
  let applied = 0;
  let skipped = 0;
  for (const e of proposedEdits(chatId)) {
    try {
      decideEdit(e.messageId, "apply");
      applied++;
    } catch {
      skipped++;
    }
  }
  publish({ type: "continuity.changed", chatId, messageId: "" });
  return { applied, skipped };
}

/**
 * Every open note that has a fix: its sentence rewritten in place, oldest first, one helper call
 * each, at most FIX_ALL_MAX a run. A note whose sentence is gone, or whose take isn't showing, is left.
 */
export async function fixAllOpen(chatId: string, job?: JobContext) {
  const todo = fixable(chatId).reverse();
  let fixed = 0;
  let failed = 0;
  for (const t of todo.slice(0, FIX_ALL_MAX)) {
    try {
      await fixIssueSentence(t.flagId, t.issueId);
      fixed++;
    } catch {
      failed++;
    }
    job?.note({ fixed, failed, of: Math.min(todo.length, FIX_ALL_MAX) });
  }
  const left = fixable(chatId).length;
  publish({ type: "continuity.changed", chatId, messageId: "" });
  return { fixed, failed, left };
}
