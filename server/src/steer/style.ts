import { parseJson } from "../db/db";
import type { PromptExtra } from "../prompt/assemble";
import { characterSettings } from "../services/charsettings";
import { type ChatSettings, mustChat } from "../services/chats";

/**
 * The style profile (STEER-04): a prose guide, words to avoid, how actions are written, and how
 * dialogue is punctuated. The character's profile is the default under each chat's own, field by
 * field. It joins the stable prompt prefix, and dialogue quotes can be normalised in the stored reply.
 */

export type StyleProfile = NonNullable<ChatSettings["style"]>;

export function styleFor(chatId: string): StyleProfile {
  const chat = mustChat(chatId);
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

/** Dialogue quotes the way the profile wants them (apostrophes are left alone). */
export function normalizeQuotes(text: string, quotes: StyleProfile["quotes"]) {
  if (quotes === "straight") return text.replace(/[“”]/g, '"');
  if (quotes !== "curly") return text;
  return text
    .split("\n")
    .map((line) => {
      let open = true;
      return line.replace(/"/g, (_m, at: number) => {
        const prev = at > 0 ? line[at - 1]! : " ";
        // An opening quote follows a space, a line start, or opening punctuation.
        const opening = /[\s([{*—–-]/.test(prev) ? true : /[\p{L}\p{N}.,!?…;:'’]/u.test(prev) ? false : open;
        open = !opening;
        return opening ? "“" : "”";
      });
    })
    .join("\n");
}
