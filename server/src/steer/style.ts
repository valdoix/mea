import { parseJson } from "../db/db";
import type { PromptExtra } from "../prompt/assemble";
import { characterSettings } from "../services/charsettings";
import { type ChatSettings, getChatRow } from "../services/chats";

/**
 * The style profile (STEER-04): a prose guide, words to avoid, how actions are written, and how
 * dialogue is punctuated. The character's profile is the default under each chat's own, field by
 * field. It joins the stable prompt prefix, and dialogue quotes can be normalised in the stored reply.
 */

export type StyleProfile = NonNullable<ChatSettings["style"]>;

export function styleFor(chatId: string): StyleProfile {
  // C2: a chat deleted while its reply streams has no style left, not an error.
  const chat = getChatRow(chatId);
  if (!chat || chat.deleted_at) return { banned: [] };
  const own = parseJson<ChatSettings>(chat.settings, {}).style ?? {};
  const base = characterSettings(chat.character_id).style ?? {};
  const pick = <K extends keyof StyleProfile>(k: K) => {
    const v = own[k];
    return v === undefined || v === "" || (Array.isArray(v) && !v.length) ? base[k] : v;
  };
  return {
    guide: pick("guide"),
    banned: [...new Set([...(base.banned ?? []), ...(own.banned ?? [])])],
    actions: pick("actions"),
    quotes: pick("quotes"),
    dialogue: pick("dialogue"),
  };
}

export function styleText(s: StyleProfile) {
  const lines = [
    s.guide?.trim(),
    s.actions === "asterisks" ? "Write actions and narration in *asterisks*; dialogue stays outside them." : s.actions === "plain" ? "Write plain prose: no asterisks around actions or narration." : "",
    s.quotes === "curly" ? "Put dialogue in curly quotes: “like this”." : s.quotes === "straight" ? 'Put dialogue in straight double quotes: "like this".' : "",
    s.dialogue?.trim(),
    s.banned?.length ? `Never use these words or phrases: ${s.banned.map((b) => `"${b}"`).join(", ")}.` : "",
  ].filter(Boolean);
  return lines.length ? `[Style for this story]\n${lines.join("\n")}` : "";
}

/** The style block for the prompt's stable prefix, or null when there's no profile. */
export function styleExtra(chatId: string): PromptExtra | null {
  const content = styleText(styleFor(chatId));
  return content ? { id: "style", name: "Style profile", content, prefix: true } : null;
}

const OPENER_BEFORE = /[\s([{\u201c\u2018]/;
const CLOSER_AFTER = /[\s.,;:!?)\]}\u2026*_\u201d\u2019]/;
const WORDISH = /[\p{L}\p{N}]/u;
/** Words that start with an apostrophe rather than a single quote: 'em, 'tis, '90s. */
const ELISION = /^(?:em|tis|twas|cause|cos|til|bout|round|n|kay|scuse|nother)\b|^\d/i;

/**
 * Curly quotes, read from each straight mark's neighbours the way a typesetter would (mirrors
 * web/src/lib/quotes.ts). A space or an opening bracket before it and a word after: it opens.
 * Punctuation or a space after it: it closes. So "I was—" closes and —"wait" opens. Between two
 * letters a ' is an apostrophe. `skip` marks characters left as they are (code, tags); the marks
 * beside them are read past them, so "<i>Hi</i>" still opens and closes.
 */
export function smartQuotes(text: string, skip?: Uint8Array) {
  const visible = (i: number, step: 1 | -1) => {
    for (let j = i + step; j >= 0 && j < text.length; j += step) if (!skip?.[j]) return text[j]!;
    return " ";
  };
  let open = false;
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === "\n") open = false;
    if ((ch !== '"' && ch !== "'") || skip?.[i]) {
      out += ch;
      continue;
    }
    const prev = visible(i, -1);
    const next = visible(i, 1);
    if (ch === "'") {
      if (WORDISH.test(prev) && WORDISH.test(next)) out += "\u2019";
      else if (/[\s([{\u201c\u2014\u2013-]/.test(prev) && WORDISH.test(next) && !ELISION.test(text.slice(i + 1, i + 9))) out += "\u2018";
      else out += "\u2019";
      continue;
    }
    let opening: boolean;
    const spaceBefore = OPENER_BEFORE.test(prev);
    const spaceAfter = /\s/.test(next);
    if (spaceBefore && !spaceAfter) opening = true;
    else if (spaceBefore && spaceAfter) opening = !open;
    else if (CLOSER_AFTER.test(next)) opening = false;
    else if (/[\u2014\u2013\-*_]/.test(prev)) opening = true;
    else opening = !open;
    open = opening;
    out += opening ? "\u201c" : "\u201d";
  }
  return out;
}

/** Code, tags (artifact attributes like from="Wren") and CSS in a visual's <style> keep their straight marks. */
const SKIP = /```[\s\S]*?(?:```|$)|`[^`\n]*`|<style\b[\s\S]*?(?:<\/style\s*>|$)|<\/?[a-zA-Z][^<>]*>/gi;

function skipMask(text: string) {
  const mask = new Uint8Array(text.length);
  for (const m of text.matchAll(SKIP)) mask.fill(1, m.index, m.index! + m[0].length);
  return mask;
}

/** Dialogue quotes the way the profile wants them; curly makes apostrophes curly too. */
export function normalizeQuotes(text: string, quotes: StyleProfile["quotes"]) {
  if (quotes === "curly") return smartQuotes(text, skipMask(text));
  if (quotes !== "straight") return text;
  const mask = skipMask(text);
  return text.replace(/[\u201c\u201d\u201e]/g, (m, at: number) => (mask[at] ? m : '"'));
}
