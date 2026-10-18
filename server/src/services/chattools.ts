import { retoldNote } from "./versionchat";
import { parseJson } from "../db/db";
import { layered } from "./layers";
import { getSetting, type GuidanceChip } from "../lib/settings";
import { withoutSpeakerMarks } from "../lib/speakers";
import type { PromptExtra } from "../prompt/assemble";
import { evalCondition } from "../trackers/condition";
import type { WorldState } from "../trackers/types";
import { type ChatSettings, mustChat, updateChat } from "./chats";

/**
 * Chat tools that steer the next reply (CHAT-09…13, CHAT-19). Stable settings join the cached
 * prefix; per-turn nudges go in shallow, next to the reply.
 */
const LENGTH: Record<string, string> = {
  short: "Keep this reply short: one or two paragraphs.",
  normal: "Keep this reply to a normal length: three or four paragraphs.",
  long: "Write a long, full reply: five or more paragraphs, taking your time.",
};
const PACING: Record<string, string> = {
  slow: "Pacing: slow. Stay in the moment with detail and interiority; don't skip ahead.",
  normal: "",
  fast: "Pacing: brisk. Move the story along; summarise the unimportant and get to what matters.",
};

/** Guidance chips that apply to this reply: switched on, used once, or switched on by themselves (TRK-12). */
export function activeGuidance(settings: ChatSettings, characterId: string | null, state: WorldState | null): GuidanceChip[] {
  const lib = getSetting("chat.guidance");
  const on = new Set([...(settings.guidance?.active ?? []), ...(settings.guidance?.once ?? [])]);
  return lib.filter((g) => {
    if (on.has(g.id)) return true;
    if (g.auto?.characterIds?.length && characterId && g.auto.characterIds.includes(characterId)) return true;
    if (g.auto?.when && state) {
      try {
        return evalCondition(state, g.auto.when);
      } catch {
        return false;
      }
    }
    return false;
  });
}

export function chatExtras(chatId: string, kind: string, state: WorldState | null): PromptExtra[] {
  const chat = mustChat(chatId);
  const s = parseJson<ChatSettings>(chat.settings, {});
  const out: PromptExtra[] = [];
  // PROMPT-06: the character's story settings and truths are the defaults under the chat's.
  const layers = layered(s, chat.character_id);
  const story = layers.story;
  const settings = [
    story.genre && `Genre: ${story.genre}`,
    story.tone && `Tone: ${story.tone}`,
    story.pov && `Point of view: ${story.pov}`,
    story.tense && `Tense: ${story.tense}`,
    story.style && `Narration style: ${story.style}`,
    story.intensity && `Content intensity: ${story.intensity}`,
    story.language && story.language.toLowerCase() !== "english" && `Write in ${story.language}`,
  ].filter(Boolean);
  if (settings.length) out.push({ id: "story", name: "Story settings", content: `[Story settings]\n${settings.join("\n")}`, prefix: true });
  if (layers.truths.length) out.push({ id: "truths", name: "Story truths", content: `[Story truths: these hold over the card, the lore and anything earlier in the chat]\n${layers.truths.map((t) => `- ${t}`).join("\n")}`, prefix: true });

  const retold = retoldNote(s);
  if (retold) out.push({ id: "retold", name: "Retold story", content: retold, prefix: true });

  const story_ = kind === "story" || kind === "continue";
  if (s.ooc?.length) out.push({ id: "ooc", name: "OOC notes", content: `[Notes from the user, out of character]\n${s.ooc.map((o) => `- ${o.text}`).join("\n")}`, depth: 1 });
  if (story_) {
    const nudges: string[] = [];
    if (s.length && LENGTH[s.length]) nudges.push(LENGTH[s.length]!);
    if (s.pacing && PACING[s.pacing]) nudges.push(PACING[s.pacing]!);
    for (const g of activeGuidance(s, chat.character_id, state)) nudges.push(g.text);
    if (s.cue?.trim()) nudges.push(`For this reply only: ${s.cue.trim()}`);
    const banned = getSetting("chat.banned");
    if (banned.remind && banned.list.length) nudges.push(`Avoid these phrases: ${banned.list.map((b) => `"${b.phrase}"`).join(", ")}.`);
    if (nudges.length) out.push({ id: "guidance", name: "Guidance", content: `[Guidance for this reply]\n${nudges.map((n) => `- ${n}`).join("\n")}`, depth: 0 });
  }
  return out;
}

/** After a reply is written: the cue and once-only guidance are used up (CHAT-10, CHAT-11). */
export function consumeOnce(chatId: string) {
  const chat = mustChat(chatId);
  const s = parseJson<ChatSettings>(chat.settings, {});
  if (!s.cue && !s.guidance?.once?.length) return;
  updateChat(chatId, { settings: { cue: null, guidance: { active: s.guidance?.active ?? [], once: [] } } });
}

/** CHAT-09: a stage direction reads as one in the history, never as the user's character speaking. */
export function asDirection(content: string) {
  return `[Stage direction from the user, not their character's words or actions: ${content.trim()}]`;
}

// ---------- after the reply ----------

/** CHAT-19: phrases you never want to read. Replacements are applied; the rest are reported. */
export function applyBanned(text: string, extra: string[] = []): { text: string; hits: string[]; replaced: number } {
  const global = getSetting("chat.banned");
  // STEER-04: a story's own banned words are flagged like yours (they have no replacements).
  const known = new Set(global.list.map((b) => b.phrase.toLowerCase()));
  const banned = { ...global, list: [...global.list, ...extra.filter((p) => !known.has(p.toLowerCase())).map((phrase): { phrase: string; replace?: string } => ({ phrase }))] };
  let out = text;
  const hits: string[] = [];
  let replaced = 0;
  for (const b of banned.list) {
    const re = new RegExp(`\\b${b.phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+")}\\b`, "gi");
    if (!re.test(out)) continue;
    if (b.replace != null && banned.action === "replace") {
      out = out.replace(re, (m) => (m[0] === m[0]!.toUpperCase() && b.replace ? b.replace[0]!.toUpperCase() + b.replace.slice(1) : b.replace!));
      replaced++;
    } else hits.push(b.phrase);
  }
  return { text: out.replace(/ {2,}/g, " "), hits, replaced };
}

/**
 * A short narration sentence that names the player or the user ("The player put them there.") is the
 * model stepping out of the story; it comes out. Dialogue and longer sentences are left alone.
 */
export function cutFourthWall(text: string): { text: string; cut: string[] } {
  const cut: string[] = [];
  const out = text.replace(/(^|[.!?…*]["”’']?[ \t]+|\n[ \t]*)([^.!?…"“”\n]*\bthe (?:player|user)(?:['’]s)?\b[^.!?…"“”\n]*[.!?…]+)[ \t]*/gi, (m, lead: string, s: string) => {
    if (s.trim().split(/\s+/).length > 12) return m;
    cut.push(s.trim());
    return lead;
  });
  if (!cut.length) return { text, cut };
  return { text: out.replace(/[ \t]+\n/g, "\n").replace(/[ \t]{2,}/g, " ").replace(/^\s*\n/, "").replace(/\n{3,}/g, "\n\n"), cut };
}

/** CHAT-14: cuts an unfinished last sentence. */
export function trimUnfinished(text: string): string {
  const t = text.trimEnd();
  if (/[.!?…"”'*)\]~]$/.test(t)) return t;
  const m = t.match(/^[\s\S]*[.!?…]["”'*)\]]*(?=\s)/);
  return m && m[0].length > t.length * 0.5 ? m[0].trimEnd() : t;
}

/**
 * CHAT-14: where a continue's opening really joins the reply it continues. A model that picks up by
 * writing the reply's last words again, or goes back and writes on from an earlier point word for
 * word, rejoins there: the reply becomes `base.slice(0, at)` + the continuation. Null when it picks
 * up cleanly. Speaker marks and spacing don't count (the prompt's copy of the reply has marks).
 */
export function continueJoin(base: string, head: string): number | null {
  // The base, spaces collapsed, with each character's place in the original.
  let nb = "";
  const pos: number[] = [];
  for (let i = 0; i < base.length; i++) {
    const ch = base[i]!;
    if (/\s/.test(ch)) {
      if (nb && !nb.endsWith(" ")) {
        nb += " ";
        pos.push(i);
      }
      continue;
    }
    nb += ch;
    pos.push(i);
  }
  nb = nb.trimEnd();
  const c = withoutSpeakerMarks(head).replace(/\s+/g, " ").trimStart();
  if (!nb || !c) return null;
  // Gone back over the reply: its opening is a long stretch of the reply, word for word.
  if (c.length >= REPLAY_MIN) {
    const j = nb.lastIndexOf(c.slice(0, REPLAY_MIN));
    if (j >= 0 && (j === 0 || nb[j - 1] === " ")) return pos[j]!;
  }
  // The reply's last words written again.
  for (let n = Math.min(nb.length, c.length, 400); n >= 4; n--) {
    const s = c.slice(0, n);
    const at = nb.length - n;
    if ((at === 0 || nb[at - 1] === " ") && nb.endsWith(s) && (s.includes(" ") || n >= 12)) return pos[at]!;
  }
  return null;
}
/** How much of a continue's opening, word for word, means it went back over the reply. */
const REPLAY_MIN = 60;

/** CONN-09: a reply that refuses rather than writes. Short and apologetic, with the usual words. */
export function looksLikeRefusal(text: string): boolean {
  const t = text.trim();
  if (t.length > 600) return false;
  return /\b(I can(?:not|'t|’t) (?:help|assist|continue|write|create|provide|engage)|I(?:'m| am) (?:not able|unable) to (?:help|continue|write|assist)|I won(?:'t|’t) (?:write|continue|create)|as an AI\b|against (?:my|the) (?:guidelines|policies|content policy)|I must decline)/i.test(t);
}
