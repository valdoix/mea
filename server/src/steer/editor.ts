import { one, parseJson } from "../db/db";
import { publish } from "../lib/events";
import { badRequest, notFound } from "../lib/http";
import { guardIssues } from "../accuracy/guards";
import { chatNames } from "../memory/build";
import { hashText } from "../memory/text";
import { editMessage, getMessageRow, updateSwipe } from "../services/chats";
import { enqueue, type JobContext } from "../services/jobs";
import { callText } from "../services/llm";
import { shouldShed } from "../services/quota";
import { steerFor } from "./advisor";
import { styleFor, styleText } from "./style";

/**
 * The post-pass editor (STEER-03, opt-in): after a reply is written, a helper makes minimal
 * fixes for point-of-view slips, writing for the user, banned phrases and formatting. The fixes
 * wait as a diff you accept (or are applied, with the original kept for undo). It never rewrites
 * the story: same events, same words wherever nothing is wrong.
 */

export interface EditProposal {
  status: "proposed" | "applied" | "dismissed";
  text: string;
  notes: string[];
  /** The reply as it was before the edit (for undo, and to notice it changed meanwhile). */
  original: string;
  at: number;
}

const NOTES = /\n-{3}\s*NOTES\s*-{3}[ \t]*(?:\n|$)/i;

/** M14: the editor answers in plain text (a whole reply inside a JSON string escapes badly and truncates). */
export function parseEditorReply(raw: string): { changed: boolean; text: string; notes: string[] } {
  const t = raw.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  if (/^UNCHANGED\.?$/i.test(t)) return { changed: false, text: "", notes: [] };
  const [body = "", rest = ""] = t.split(NOTES);
  const notes = rest
    .split("\n")
    .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim())
    .filter(Boolean);
  return { changed: true, text: body.trim(), notes };
}

export function scheduleEditor(chatId: string, messageId: string, swipeIdx: number) {
  const cfg = steerFor(chatId);
  if (cfg.editor === "off") return;
  enqueue("steer.edit", { chatId, messageId, swipeIdx }, { delayMs: 1500, chatId, dedupeKey: `steer.edit:${messageId}:${swipeIdx}`, priority: 2 });
}

export async function runEditorJob(p: { chatId: string; messageId: string; swipeIdx: number }, job?: JobContext) {
  const cfg = steerFor(p.chatId);
  if (cfg.editor === "off" || shouldShed("editor")) return;
  const m = getMessageRow(p.messageId);
  if (!m || m.deleted_at || m.active_swipe !== p.swipeIdx) return;
  const sw = one<{ content: string; meta: string }>("SELECT content, meta FROM swipes WHERE message_id = ? AND idx = ?", p.messageId, p.swipeIdx);
  if (!sw?.content.trim()) return;
  const meta = parseJson<Record<string, unknown>>(sw.meta, {});
  const issues = guardIssues(p.chatId, sw.content, { seq: m.seq, messageId: p.messageId });
  const banned = (meta.banned as string[] | undefined) ?? [];
  const problems = [...issues.map((i) => `- ${i.conflict} Fix: ${i.fix}${i.kind === "puppet" || i.kind === "name" ? ` (at: "${i.claim.slice(0, 120)}")` : ""}`), ...banned.map((b) => `- Uses the banned phrase "${b}": reword just that phrase.`)];
  if (cfg.editor === "flagged" && !problems.length) return;
  const names = chatNames(p.chatId);
  const style = styleText(styleFor(p.chatId));
  const r = await callText({
    task: "helper",
    kind: "editor",
    chatId: p.chatId,
    jobId: job?.id,
    system: `You are a careful copy editor for a roleplay. ${names.char}'s reply was just written. Make the smallest possible edits so it follows the rules below; change nothing else. Keep every event, every line of ${names.char}'s dialogue, the order and the length. Typical fixes: cut or rewrite a sentence that writes ${names.user}'s words, actions or decisions (only ${names.user}'s player writes those), but leave alone any line that only mentions ${names.user}, recalls or repeats what ${names.user} said or did earlier, or reacts to it ("That's what ${names.user} said" is fine); fix a slip in point of view or tense; replace a banned phrase; fix formatting (asterisks, quotes) to match the style.
Reply in plain text. If nothing needs fixing, reply with the single word UNCHANGED. Otherwise reply with the full edited reply, then a line ---NOTES--- and one line per edit, a few words each.`,
    user: `${style ? `${style}\n\n` : ""}${problems.length ? `PROBLEMS FOUND:\n${problems.join("\n")}\n\n` : ""}REPLY:\n${sw.content}`,
    maxTokens: Math.min(6000, Math.ceil(sw.content.length / 2.5) + 400),
    // A reply cut off at the length limit loses its notes line: never take half a reply as the edit.
    validate: (t) => (parseEditorReply(t).changed && !NOTES.test(t) ? "The reply had no ---NOTES--- line after the edited text." : null),
  });
  job?.note({ inputTokens: r.inputTokens });
  const edit = parseEditorReply(r.text);
  const text = edit.text;
  if (!edit.changed || !text || text === sw.content.trim()) return;
  // A rewrite isn't an edit. Cutting a line written for you can remove a lot; adding much never fits.
  if (text.length < sw.content.length * 0.4 || text.length > sw.content.length * 1.3) return;
  // The reply changed while the editor worked (you edited or swiped): drop the proposal.
  const now_ = one<{ content: string }>("SELECT content FROM swipes WHERE message_id = ? AND idx = ?", p.messageId, p.swipeIdx);
  if (!now_ || hashText(now_.content) !== hashText(sw.content)) return;
  // L12: the edit belongs to the swipe it read: once you've moved to another, it waits there as a suggestion.
  const cur = getMessageRow(p.messageId);
  if (!cur || cur.deleted_at) return;
  const proposal: EditProposal = { status: "proposed", text, notes: edit.notes.slice(0, 8), original: sw.content, at: Date.now() };
  if (cfg.editorApply === "auto" && cur.active_swipe === p.swipeIdx) {
    editMessage(p.messageId, text);
    updateSwipe(p.messageId, p.swipeIdx, { meta: { edit: { ...proposal, status: "applied" } } });
  } else updateSwipe(p.messageId, p.swipeIdx, { meta: { edit: proposal } });
  publish({ type: "message.changed", chatId: p.chatId, messageId: p.messageId });
}

function currentEdit(messageId: string) {
  const m = getMessageRow(messageId);
  if (!m) throw notFound("Message not found");
  const sw = one<{ content: string; meta: string }>("SELECT content, meta FROM swipes WHERE message_id = ? AND idx = ?", messageId, m.active_swipe);
  const edit = parseJson<Record<string, unknown>>(sw?.meta, {}).edit as EditProposal | undefined;
  if (!sw || !edit) throw notFound("No editor suggestion on this message");
  return { m, sw, edit };
}

/** Accept the editor's fixes (or, for an applied edit, put the original back). */
export function decideEdit(messageId: string, action: "apply" | "dismiss" | "undo") {
  const { m, sw, edit } = currentEdit(messageId);
  if (action === "apply") {
    if (edit.status !== "proposed") throw badRequest("This suggestion isn't open any more");
    if (sw.content !== edit.original) throw badRequest("The reply changed since the editor read it");
    editMessage(messageId, edit.text);
    updateSwipe(messageId, m.active_swipe, { meta: { edit: { ...edit, status: "applied" } } });
  } else if (action === "undo") {
    if (edit.status !== "applied") throw badRequest("Nothing to undo");
    editMessage(messageId, edit.original);
    updateSwipe(messageId, m.active_swipe, { meta: { edit: { ...edit, status: "dismissed" } } });
  } else updateSwipe(messageId, m.active_swipe, { meta: { edit: { ...edit, status: "dismissed" } } });
  publish({ type: "message.changed", chatId: m.chat_id, messageId });
}
