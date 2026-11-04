import { z } from "zod";
import type { WorldState } from "../trackers/types";
import { isStockLine } from "./grammar";
import type { Roster } from "./roster";
import type { Arc, ArcKind } from "./types";

/**
 * Wording: the engine picks who a new subplot is about and what kind it is, and starts it with stock
 * lines for its kind. One quiet model call writes what it's really about: the premise in the story's
 * words, and a want and a fear of the model's own, from what's known of these people.
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
  /** What's known that bears on it: labelled lines (wordingAbout). */
  about?: string[];
}

export const wordingSchema = z.object({
  items: z.array(z.object({ id: z.string(), premise: z.string(), want: z.string(), fear: z.string() })),
});

const clip = (s: string, n: number) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1).replace(/\s+\S*$/, "")}…` : t;
};

/**
 * What the model needs to say what this subplot is really about: the lead's lore and own drives, the
 * people with them and how they stand, the thread, debt, secret or lore it grew from, and what else
 * they've got going on.
 */
export function wordingAbout(x: { id: string; lead: string; leadName: string; cast: string[]; grounds: string[] }, st: WorldState, roster: Roster, situations: { key: string; title: string; text: string }[] = []): string[] {
  const nameOf = (id: string) => roster.actors.get(id)?.name ?? st.chars[id]?.name ?? st.sim.actors[id]?.name ?? id;
  const out: string[] = [];
  const lead = roster.actors.get(x.lead);
  if (lead?.text.trim()) out.push(`ABOUT ${x.leadName}: ${clip(lead.text, 700)}`);
  if (lead?.want || lead?.fear) out.push(`THEIR DRIVES ${[lead.want && `wants ${lead.want}`, lead.fear && `fears ${lead.fear}`].filter(Boolean).join("; ")}`);
  for (const id of x.cast.slice(0, 3)) {
    const c = roster.actors.get(id);
    if (c?.text.trim() && !c.isUser) out.push(`ABOUT ${c.name}: ${clip(c.text, 250)}`);
    for (const b of Object.values(st.bonds)) {
      if (!((b.from === x.lead && b.to === id) || (b.from === id && b.to === x.lead))) continue;
      const axes = Object.entries(b.axes).filter(([, v]) => v).map(([k, v]) => `${k} ${v}`);
      const cause = b.history.findLast((m) => m.cause)?.cause;
      if (axes.length || b.label) out.push(`BOND ${nameOf(b.from)} → ${nameOf(b.to)}: ${[b.label, ...axes].filter(Boolean).join(", ")}${cause ? `; last moved by: ${clip(cause, 160)}` : ""}`);
    }
  }
  for (const g of x.grounds) {
    const i = g.indexOf(":");
    const key = g.slice(i + 1);
    const what = g.slice(0, i);
    if (what === "thread") {
      const t = st.threads[key];
      if (t) out.push(`THREAD ${t.title}${t.latest ? `: ${clip(t.latest, 300)}` : ""}${t.blocker ? ` (held up by: ${clip(t.blocker, 120)})` : ""}`);
    } else if (what === "obligation") {
      const o = Object.values(st.obligations).find((y) => y.id === key);
      if (o) out.push(`${o.kind === "owe" ? "DEBT" : "PROMISE"} ${nameOf(o.who)}${o.whom ? ` to ${nameOf(o.whom)}` : ""}: ${clip(o.what, 200)}${o.due?.text ? ` (due ${o.due.text})` : ""}`);
    } else if (what === "fact") {
      const f = Object.values(st.facts).find((y) => y.key === key);
      if (f) out.push(`SECRET ${clip(f.statement, 240)}${f.secret?.from.length ? ` (kept from ${f.secret.from.map(nameOf).join(", ")})` : ""}`);
    } else if (what === "current" || what === "hook") {
      const s = situations.find((y) => y.key === key);
      if (s) out.push(`LORE ${s.title}: ${clip(s.text, 600)}`);
    }
  }
  const others = Object.values(st.sim.arcs).filter((a: Arc) => a.id !== x.id && a.status === "running" && (a.lead === x.lead || a.cast.includes(x.lead)));
  for (const a of others.slice(0, 2)) out.push(`ALSO GOING ON ${clip(a.premise, 160)}`);
  return out;
}

export function wordingPrompt(cards: WordingCard[], o: { userName: string; truths: string[]; genres: string[]; scene?: string }) {
  const system = `You write new subplots for a roleplay: stories that go on off the page. Each ITEM is already decided: who leads it, what kind of story it is, and what it grew from. What they're after and what they dread is yours to write, from what's known about these people.
PREMISE: one or two plain sentences (at most 40 words), present tense: who is in what situation, and what is pulling at them. Name the lead; keep what the engine's premise means.
WANT: the particular thing the lead is after right now, as a phrase starting with "to" (at most 14 words). You could tell when they'd got it. It names the person, thing, place or deadline involved: "to bring Dawn home before the Council hears", never "to get what they're after".
FEAR: the particular thing that could happen, as a clause (at most 14 words). It's what this lead stands to lose, or what going after the want could cost them, not just the want failing: "Dawn chooses to stay", never "it slips away for good".
Build them from ABOUT, BOND, THREAD, DEBT, PROMISE, SECRET, LORE and THE STORY LATELY. Use the details that make this person different from anyone else in the same kind of story, and let the want and the fear pull against each other. Two items should never sound alike. Add no new named people or events; name only people the material names. Never decide anything ${o.userName} (the user's character) does, says, thinks or knows. No dialogue.${o.genres.length ? `\nThe story's genre: ${o.genres.join(", ")}.` : ""}${o.truths.length ? `\nStory truths that hold here too: ${o.truths.join("; ")}` : ""}
Reply with JSON only: {"items":[{"id":"<id>","premise":"…","want":"to …","fear":"…"}]}`;
  const items = cards
    .map((c) =>
      [
        `ITEM ${c.id}`,
        `KIND ${c.kind} · LEAD ${c.lead}${c.cast.length ? ` · WITH ${c.cast.join(", ")}` : ""}`,
        `GREW FROM ${c.why}`,
        ...(c.about ?? []),
        `ENGINE'S PREMISE ${c.premise}`,
        // The stock line for its kind says nothing about these people, so the model doesn't see it.
        isStockLine(c.want) ? "" : `A WANT SO FAR ${c.want}`,
        isStockLine(c.fear) ? "" : `A FEAR SO FAR ${c.fear}`,
      ]
        .filter(Boolean)
        .join("\n"),
    )
    .join("\n\n");
  return { system, user: `${o.scene ? `THE STORY LATELY\n${o.scene}\n\n` : ""}${items}\n\nWORLD WORDING: write each item.` };
}

/** Checks a wording; returns the problem, or null when it can be used. */
export function validateWording(w: { premise: string; want: string; fear: string }, o: { userName: string }): string | null {
  if (!w.premise.trim() || !w.want.trim() || !w.fear.trim()) return "left a part empty";
  if (w.premise.trim().split(/\s+/).length > 60 || w.want.split(/\s+/).length > 20 || w.fear.split(/\s+/).length > 20) return "too long";
  const u = o.userName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (new RegExp(`\\b${u}\\s+(?:\\w+ed|\\w+s|was|is|had|felt|thought|knew|decided|agreed)\\b`, "i").test(w.premise)) return "decided something for the user's character";
  if (isStockLine(w.want) || isStockLine(w.fear)) return "used a stock line instead of saying what these people want and fear";
  return null;
}

/** Problems the model's words survive after a second try: deciding for the user's character isn't one. */
export const softWording = (problem: string) => problem === "too long" || problem.startsWith("used a stock line");

/** "to …" for the want, whatever the model sent. */
export function tidyWording(w: { premise: string; want: string; fear: string }) {
  const want = w.want.trim().replace(/[.]+$/, "");
  return { premise: w.premise.trim(), want: /^to\b/i.test(want) ? want : `to ${want}`, fear: w.fear.trim().replace(/[.]+$/, "") };
}
