import { parseJson } from "../db/db";
import { type ChatSettings, mustChat, updateChat } from "../services/chats";
import { bestMatch, type Reveal, revealOf } from "../trackers/reveals";
import type { WorldState } from "../trackers/types";
import { extraOf, type ScanEntry } from "./activate";

/**
 * Reliable state 2.1 (docs/16): which tracker fact each lore secret is about, in this chat. A
 * companion book is shared by every chat with the character and the tracker's keys are this
 * chat's own, so the link lives with the chat: found by the words they share, and overridden by
 * you from the Codex (settings.secretLinks, "entryId:index" → fact key, or "" for "not this").
 */
export interface LoreSecretLink {
  /** "entryId:index" */
  ref: string;
  entryId: string;
  index: number;
  /** The entry's name. */
  entry: string;
  text: string;
  knownBy: string[];
  /** The tracker fact it's linked to. */
  fact: string | null;
  /** How: matched by its words, or by you. */
  by: "match" | "you" | null;
  /** Not linked, but it might be about this fact (offered as Link). */
  near: string | null;
  /** You said it isn't about the fact its words point to. */
  unlinked: boolean;
}

const MATCH = 0.6;
const NEAR = 0.4;

export const secretLinkOverrides = (chatId: string) => parseJson<ChatSettings>(mustChat(chatId).settings, {}).secretLinks ?? {};

export function loreSecretLinks(chatId: string, st: WorldState | null, entries: ScanEntry[]): LoreSecretLink[] {
  const own = secretLinkOverrides(chatId);
  const facts = st ? Object.values(st.facts).filter((f) => f.secret || f.revealed.length) : [];
  const out: LoreSecretLink[] = [];
  for (const e of entries)
    (extraOf(e).secrets ?? []).forEach((s, index) => {
      if (!s.text?.trim()) return;
      const ref = `${e.id}:${index}`;
      const mine = own[ref];
      const match = bestMatch(s.text, facts, NEAR);
      const auto = match && match.score >= MATCH ? match.item.key : null;
      const fact = mine !== undefined ? (mine && st?.facts[mine] ? mine : null) : auto;
      out.push({
        ref,
        entryId: e.id,
        index,
        entry: e.comment || e.keys[0] || "entry",
        text: s.text,
        knownBy: s.knownBy ?? [],
        fact,
        by: fact ? (mine !== undefined ? "you" : "match") : null,
        near: !fact && match ? match.item.key : null,
        unlinked: mine === "",
      });
    });
  return out;
}

/** For the prompt and the checks: the reveal a lore secret is linked to, if its fact has come out. */
export function secretRevealer(chatId: string, st: WorldState | null, entries: ScanEntry[]) {
  const linked = new Map(loreSecretLinks(chatId, st, entries).flatMap((l) => (l.fact ? [[l.ref, l.fact] as const] : [])));
  return (entryId: string, index: number): Reveal | undefined => {
    const key = linked.get(`${entryId}:${index}`);
    return key && st ? revealOf(st, key) : undefined;
  };
}

/** Link a lore secret to a fact, unlink it (null), or let the words decide again ("auto"). */
export function setSecretLink(chatId: string, ref: string, fact: string | null | "auto") {
  const next = { ...secretLinkOverrides(chatId) };
  if (fact === "auto") delete next[ref];
  else next[ref] = fact ?? "";
  updateChat(chatId, { settings: { secretLinks: next } });
}
