import { z } from "zod";
import type { BeatCard } from "./storyteller";

/**
 * Telling (ALMANAC 09 §9): the engine has already decided who, where, when and how it turned
 * out; one quiet model call puts each beat into the story's own words. A validator keeps it
 * honest; a beat that fails keeps the engine's sentence.
 */
export const tellingSchema = z.object({
  beats: z.array(z.object({ card: z.string(), text: z.string(), arrival: z.string().optional() })),
});

export function tellingPrompt(cards: BeatCard[], o: { userName: string; truths: string[]; genres: string[] }) {
  const system = `You tell what happened off the page in a roleplay, between two story times. Each CARD is already decided: who, where, when, and how it turned out (WIN, COST, LOSS, or an ending: MET, PRICE, LOST). Tell each as two short, plain sentences: what happened (past tense, naming the actual people, places and news), then where it leaves things (present tense). At most 50 words per card.
Keep the outcome. Add nothing the card doesn't allow. Name only the people on the card; anyone else is unnamed ("a clerk").
Subplots bear on each other. MEANWHILE is what tied subplots did last: keep in step with it and never contradict it; a step marked [since this subplot's last step] is what this one answers. STANDS is settled about its people: this step can't undo it by itself. ANSWERS is what set this step off elsewhere (another subplot's outcome, or a plot thread moving): tell this step as a response to it. You may name the people in MEANWHILE, STANDS and ANSWERS. Never decide anything ${o.userName} (the user's character) does, says, thinks or knows. No dialogue.${o.genres.length ? `\nThe story's genre: ${o.genres.join(", ")}.` : ""}${o.truths.length ? `\nStory truths that hold here too: ${o.truths.join("; ")}` : ""}
Reply with JSON only: {"beats":[{"card":"<id>","text":"…"}]}`;
  const user = cards
    .map((c) =>
      [
        `CARD ${c.id}`,
        `KIND ${c.kind} · ${c.ending ? "ENDING" : `step: ${c.stage}`} · outcome ${String(c.result).toUpperCase()}${c.twist ? ` · twist: ${c.twist}` : ""}`,
        `LEAD ${c.lead}${c.cast.length ? ` · WITH ${c.cast.join(", ")}` : ""} · WHERE ${c.where}`,
        `PREMISE ${c.premise}`,
        `WANTS ${c.want} · FEARS ${c.fear}`,
        c.soFar.length ? `SO FAR ${c.soFar.join(" ")}` : "",
        ...(c.meanwhile ?? []).map((l) => `MEANWHILE ${l}`),
        ...(c.stands ?? []).map((l) => `STANDS ${l}`),
        c.answers ? `ANSWERS ${c.answers}` : "",
        `ENGINE'S WORDS ${c.template}`,
      ]
        .filter(Boolean)
        .join("\n"),
    )
    .join("\n\n");
  return { system, user: `${user}\n\nWORLD TELLING: tell each card.` };
}

/** A second try for the cards whose telling failed: the same cards, with what went wrong. */
export function retellPrompt(cards: BeatCard[], misses: Map<string, { text: string; problem: string }>, o: { userName: string; truths: string[]; genres: string[] }) {
  const { system, user } = tellingPrompt(cards, o);
  const notes = cards
    .map((c) => {
      const m = misses.get(c.id);
      return m ? `CARD ${c.id}: your telling "${m.text.trim()}" was turned back (${m.problem}). Tell it again without that.` : `CARD ${c.id}: you left it out. Tell it.`;
    })
    .join("\n");
  return { system, user: `${user}\n\nLAST TRY:\n${notes}` };
}

const COMMON = new Set(
  "The A An It In On At By For With From After Before When While Then But And Or Off Somewhere Nobody Someone Everyone Later Meanwhile That This Their His Her They She He Monday Tuesday Wednesday Thursday Friday Saturday Sunday January February March April May June July August September October November December Day Night Morning Evening".split(" "),
);

/**
 * Problems the model's words survive: they still read better than the engine's sentence, so after a
 * second try they're used anyway. The rest (deciding for the user's character, turning the outcome
 * around) would change the story, so the engine's sentence stands.
 */
export function softProblem(problem: string): boolean {
  return problem === "too long" || problem === "dialogue" || problem.startsWith("named ");
}

/** Checks a telling; returns the problem, or null when it can be used. */
export function validateTelling(text: string, card: BeatCard, o: { userName: string; places: string[]; known?: string[] }): string | null {
  const words = text.trim().split(/\s+/);
  if (!text.trim()) return "empty";
  if (words.length > 75) return "too long";
  if (/["“”]/.test(text) && /\b(said|says|asked|told)\b/.test(text) && /["“][^"”]{10,}["”]/.test(text)) return "dialogue";
  const u = o.userName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (new RegExp(`\\b${u}\\s+(?:\\w+ed|\\w+s|was|is|had|felt|thought|knew|decided|agreed)\\b`, "i").test(text)) return "decided something for the user's character";
  // Anything the card itself says (where, the premise, earlier steps, what bears on it) is fair to name.
  const said = [card.where, card.premise, card.want, card.fear, card.template, card.answers ?? "", ...card.soFar, ...(card.meanwhile ?? []), ...(card.stands ?? [])];
  const allowed = new Set(
    [card.lead, ...card.cast, ...(card.names ?? []), o.userName, ...o.places, ...(o.known ?? []), ...said].flatMap((n) => n.split(/[\s›]+/)).map((w) => w.replace(/[^\w'-]/g, "").replace(/'s$/, "").toLowerCase()),
  );
  // Capitalised words not at the start of a sentence must be names the card allows.
  const tokens = text.match(/(?<![.!?]\s)(?<!^)\b[A-Z][a-z'’-]{2,}\b/g) ?? [];
  for (const t of tokens) {
    if (COMMON.has(t)) continue;
    if (!allowed.has(t.toLowerCase().replace(/['’]s$/, ""))) return `named someone or somewhere not on the card ("${t}")`;
  }
  const r = String(card.result).toLowerCase();
  if ((r === "loss" || r === "lost") && /\b(succeeded|managed to|won|triumph\w*)\b/i.test(text)) return "told a loss as a win";
  if ((r === "win" || r === "met") && /\b(failed|gave up|was defeated|fell apart)\b/i.test(text)) return "told a win as a loss";
  return null;
}
