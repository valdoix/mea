import { z } from "zod";
import type { ArcKind } from "./types";

/**
 * Wording: the engine picks who a new subplot is about and what kind it is, and glues a premise,
 * a want and a fear together from its parts. One quiet model call puts them in the story's own words.
 */
export interface WordingCard {
  id: string;
  kind: ArcKind;
  lead: string;
  cast: string[];
  premise: string;
  want: string;
  fear: string;
  /** Why it came up: the lore, thread or event it grew from. */
  why: string;
}

export const wordingSchema = z.object({
  items: z.array(z.object({ id: z.string(), premise: z.string(), want: z.string(), fear: z.string() })),
});

export function wordingPrompt(cards: WordingCard[], o: { userName: string; truths: string[]; genres: string[] }) {
  const system = `You word new subplots for a roleplay: stories that go on off the page. Each ITEM is already decided: who leads it, what kind of story it is, and what it grew from. The engine's words for it are rough; put them in the story's own words.
PREMISE: one or two plain sentences (at most 40 words), present tense: who is in what situation, and what is pulling at them. Name the lead; name only people the item names.
WANT: what the lead is after, as a short phrase starting with "to" (at most 12 words): "to bring Dawn home before the Council hears".
FEAR: what the lead dreads, as a short clause (at most 12 words): "the Council finds out first".
Be specific to these people and this story; keep what the engine's words mean. Never decide anything ${o.userName} (the user's character) does, says, thinks or knows. No dialogue.${o.genres.length ? `\nThe story's genre: ${o.genres.join(", ")}.` : ""}${o.truths.length ? `\nStory truths that hold here too: ${o.truths.join("; ")}` : ""}
Reply with JSON only: {"items":[{"id":"<id>","premise":"…","want":"to …","fear":"…"}]}`;
  const user = cards
    .map((c) =>
      [
        `ITEM ${c.id}`,
        `KIND ${c.kind} · LEAD ${c.lead}${c.cast.length ? ` · WITH ${c.cast.join(", ")}` : ""}`,
        `GREW FROM ${c.why}`,
        `ENGINE'S PREMISE ${c.premise}`,
        `ENGINE'S WANT ${c.want}`,
        `ENGINE'S FEAR ${c.fear}`,
      ].join("\n"),
    )
    .join("\n\n");
  return { system, user: `${user}\n\nWORLD WORDING: word each item.` };
}

/** Checks a wording; returns the problem, or null when it can be used. Every problem here is soft but these. */
export function validateWording(w: { premise: string; want: string; fear: string }, o: { userName: string }): string | null {
  if (!w.premise.trim() || !w.want.trim() || !w.fear.trim()) return "left a part empty";
  if (w.premise.trim().split(/\s+/).length > 60 || w.want.split(/\s+/).length > 20 || w.fear.split(/\s+/).length > 20) return "too long";
  const u = o.userName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (new RegExp(`\\b${u}\\s+(?:\\w+ed|\\w+s|was|is|had|felt|thought|knew|decided|agreed)\\b`, "i").test(w.premise)) return "decided something for the user's character";
  return null;
}

/** "to …" for the want, whatever the model sent. */
export function tidyWording(w: { premise: string; want: string; fear: string }) {
  const want = w.want.trim().replace(/[.]+$/, "");
  return { premise: w.premise.trim(), want: /^to\b/i.test(want) ? want : `to ${want}`, fear: w.fear.trim().replace(/[.]+$/, "") };
}
