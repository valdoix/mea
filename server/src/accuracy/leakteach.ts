import { all, now, parseJson } from "../db/db";
import { type ChatSettings, mustChat, updateChat } from "../services/chats";
import type { Issue } from "./checker";

/**
 * docs/35 Part 5: dismissing a leak teaches Mea something. Four dismissals of the same secret didn't
 * stop the fifth flag. Now "They do know" writes it down, "It isn't about that" keeps the sentence's
 * match from counting again, and a secret dismissed twice that way (or for two different people)
 * stops raising rule flags until you turn it back on.
 */

export type LeakWhy = "know" | "notAbout";

/** How many strikes turn a secret's leak check off. */
export const STRIKES = 2;

export interface LeakTaught {
  /** Secrets (fact keys) whose leak check is off, and why. */
  off: Map<string, string>;
  /** Sentences you said aren't about each secret. */
  notAbout: Map<string, string[]>;
}

export function leakTaught(chatId: string): LeakTaught {
  const back = parseJson<ChatSettings>(mustChat(chatId).settings, {}).leakBack ?? {};
  const strikes = new Map<string, { notAbout: number; who: Set<string> }>();
  const notAbout = new Map<string, string[]>();
  for (const r of all<{ issues: string; created_at: number }>("SELECT issues, created_at FROM continuity_flags WHERE chat_id = ? AND issues LIKE '%\"kind\":\"leak\"%' ORDER BY created_at", chatId)) {
    for (const i of parseJson<Issue[]>(r.issues, [])) {
      if (i.kind !== "leak" || !i.about || !i.dismissed) continue;
      // Fixed, made canon, withdrawn, or "they do know": not the rule being wrong about the secret.
      if (i.settled || i.taught === "know") continue;
      const key = i.about.fact;
      if (i.taught === "notAbout") notAbout.set(key, [...(notAbout.get(key) ?? []), i.claim]);
      // Turned back on: what came before doesn't count against it.
      if (r.created_at < (back[key] ?? 0)) continue;
      const s = strikes.get(key) ?? { notAbout: 0, who: new Set<string>() };
      if (i.taught === "notAbout") s.notAbout++;
      s.who.add(i.about.id);
      strikes.set(key, s);
    }
  }
  const off = new Map<string, string>();
  for (const [key, s] of strikes) {
    if (s.notAbout >= STRIKES) off.set(key, `you said ${s.notAbout} of its flags weren't about it`);
    else if (s.who.size >= STRIKES) off.set(key, `you dismissed its flags for ${s.who.size} different people`);
  }
  return { off, notAbout };
}

/** The secrets whose leak check is off, for the Secrets card. */
export function leakChecksOff(chatId: string): Record<string, string> {
  return Object.fromEntries(leakTaught(chatId).off);
}

/** The switch: this secret's leak check on again, counting only what comes after. */
export function leakCheckOn(chatId: string, key: string) {
  const settings = parseJson<ChatSettings>(mustChat(chatId).settings, {});
  updateChat(chatId, { settings: { leakBack: { ...settings.leakBack, [key]: now() } } });
}
