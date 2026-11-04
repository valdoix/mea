import { z } from "zod";
import type { WorldState } from "../trackers/types";
import { COMMON } from "./telling";
import type { Arc, Beat, EndResult, Proposal, Result, SimOp } from "./types";
import { tidyWording } from "./wording";

/**
 * Heeding the page: the story outranks what the world off the page assumed. After a reply, one quiet
 * model call reads the scene against the subplots it mentions and says which it changed. Every change
 * has to quote the words of the scene it rests on, so nothing moves on a guess. It's the one thing that
 * rewrites a subplot you wrote: if the page shows your premise is out of date, the page wins, and the
 * step it leaves says so.
 */
export interface HeedItem {
  id: string;
  kind: string;
  lead: string;
  cast: string[];
  status: string;
  premise: string;
  want: string;
  fear: string;
  lately: string[];
  /** Every name and proper noun it turns on: a scene that uses none of them can't be about it. */
  names: string[];
}

export const heedSchema = z.object({
  changes: z.array(
    z.object({
      id: z.string(),
      effect: z.string(),
      quote: z.string().nullish(),
      happened: z.string().nullish(),
      result: z.string().nullish(),
      premise: z.string().nullish(),
      want: z.string().nullish(),
      fear: z.string().nullish(),
    }),
  ),
});
export type HeedChange = z.infer<typeof heedSchema>["changes"][number];

/** Capitalised words that are never anyone's name, on top of the telling's list. */
const NOT_NAMES = new Set("Now Who What Why How Not Its Our You Your Has Had Was Are Will Can There Here Still Even Once Each Both Some Many Most None Those These Into Over Under".split(" "));

function namesIn(text: string): string[] {
  return (text.match(/\b[A-Z][\p{L}'’-]{2,}/gu) ?? []).map((w) => w.replace(/['’]s$/, "")).filter((w) => !COMMON.has(w) && !NOT_NAMES.has(w));
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).replace(/\s+\S*$/, "")}…` : s);

/** The subplots and waiting proposals still open, as the model reads them. */
export function heedItems(st: WorldState): HeedItem[] {
  const nameOf = (id: string) => st.sim.actors[id]?.name ?? st.chars[id]?.name ?? id;
  const item = (x: Arc | Proposal, status: string, lately: string[]): HeedItem => {
    const cast = x.cast.map(nameOf);
    return { id: x.id, kind: x.kind, lead: x.leadName, cast, status, premise: x.premise, want: x.want, fear: x.fear, lately, names: [...new Set([...[x.leadName, ...cast].flatMap((n) => n.split(/\s+/).filter((w) => w.length >= 3)), ...namesIn(`${x.premise} ${x.want} ${x.fear}`)])] };
  };
  return [
    ...Object.values(st.sim.arcs)
      .filter((a) => a.status === "running" || a.status === "held" || a.status === "crossed")
      .map((a) => item(a, a.status, a.beats.slice(-2).map((b) => clip(b.text, 200)))),
    ...Object.values(st.sim.proposals).map((p) => item(p, "offered", [])),
  ];
}

/** The items a scene names, most-named first; at most `limit`, so one reply stays one small call. */
export function touchedBy(items: HeedItem[], scene: string, limit = 10): HeedItem[] {
  const count = (n: string) => scene.split(new RegExp(`(?<![\\p{L}'’-])${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}-])`, "u")).length - 1;
  return items
    .map((it) => ({ it, n: it.names.reduce((sum, w) => sum + count(w), 0) }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n)
    .slice(0, limit)
    .map((x) => x.it);
}

export function heedPrompt(items: HeedItem[], scene: string, o: { userName: string }) {
  const system = `You keep a roleplay's off-page subplots true to what the story itself has shown. THE SCENE just happened on the page, and it outranks every subplot. Each ITEM is a subplot running off the page, or one being offered. Report only the items the scene really changes; leaving them all out is the usual, correct answer.
effect "shift": the subplot goes on, but the scene has put its PREMISE, WANT or FEAR out of date. Something it assumes turned out false, someone in it learned what changes their course, or what they're after moved. Example: PREMISE "The crew believes their captain drowned, and is dividing his share." The crew find him alive in the scene, so the premise becomes "The crew have found their captain alive, and now have to answer for dividing his share." Give the new premise (at most 40 words, present tense, naming the lead), and a new want ("to …", at most 14 words) and fear (a clause, at most 14 words) whenever those moved too. result: how this went for the lead: "win", "cost" or "loss".
effect "end": the scene settled it, and nothing is left to pursue. result: "met" (they got it), "price" (they got it at a cost) or "lost".
It only counts if the scene shows it happening. Someone being mentioned, seen or talked about changes nothing, and neither does a rumour, a plan, a hope or a dream. People learn only what they were there for or were plainly told: if ${o.userName} (the user's character) finds something out and the lead doesn't, what the lead believes hasn't changed. Never decide anything ${o.userName} does, says, thinks or knows beyond what the scene shows.
quote: the few words of THE SCENE the change rests on, copied exactly. happened: one past-tense sentence (at most 30 words) on what the scene did to this subplot.
Reply with JSON only: {"changes":[{"id":"<id>","effect":"shift","quote":"…","happened":"…","result":"win","premise":"…","want":"to …","fear":"…"}]}`;
  const user = items
    .map((c) =>
      [
        `ITEM ${c.id}`,
        `KIND ${c.kind} · LEAD ${c.lead}${c.cast.length ? ` · WITH ${c.cast.join(", ")}` : ""} · ${c.status}`,
        `PREMISE ${c.premise}`,
        `WANT ${c.want} · FEAR ${c.fear}`,
        ...c.lately.map((l) => `LATELY ${l}`),
      ].join("\n"),
    )
    .join("\n\n");
  return { system, user: `${user}\n\nTHE SCENE\n${scene}\n\nWORLD HEED: which of these did the scene change?` };
}

const flat = (s: string) => s.replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim().toLowerCase();

const RESULTS: Result[] = ["win", "cost", "loss"];
const ENDS: EndResult[] = ["met", "price", "lost"];

/**
 * What the model's reading writes. A change whose quote isn't in the scene is dropped, and so is one
 * for something no longer open. Whatever it was on its way to telling the scene is out of date too.
 * New subplots are held back from saying what the user's character does; here the page has shown it
 * ("Buffy is alive" is the whole point when you play Buffy), and the quote keeps it honest.
 */
export function heedOps(st: WorldState, changes: HeedChange[], scene: string, o: { now: number }): SimOp[] {
  const ops: SimOp[] = [];
  const page = flat(scene);
  const done = new Set<string>();
  for (const c of changes) {
    if (done.has(c.id) || (c.effect !== "shift" && c.effect !== "end")) continue;
    const quote = c.quote?.trim();
    const happened = c.happened?.trim();
    if (!quote || !happened || !page.includes(flat(quote))) continue;
    const proposal = st.sim.proposals[c.id];
    const arc = st.sim.arcs[c.id];
    const open = arc && (arc.status === "running" || arc.status === "held" || arc.status === "crossed");
    if (!proposal && !open) continue;
    if (c.effect === "end") {
      done.add(c.id);
      if (proposal) ops.push({ type: "proposal.done", id: c.id, accepted: false });
      else ops.push({ type: "arc.end", id: c.id, result: ENDS.find((r) => r === c.result) ?? "price", text: happened, at: o.now });
    } else {
      const was = proposal ?? arc!;
      const words = { premise: c.premise?.trim() || was.premise, want: c.want?.trim() || was.want, fear: c.fear?.trim() || was.fear };
      if (words.premise === was.premise && words.want === was.want && words.fear === was.fear) continue;
      done.add(c.id);
      const patch = tidyWording(words);
      if (proposal) ops.push({ type: "proposal.set", id: c.id, patch });
      else {
        const beat: Beat = { at: o.now, roll: [0, 0], mod: 0, why: [`the story: "${clip(quote, 120)}"`], result: RESULTS.find((r) => r === c.result) ?? "cost", stage: arc!.stage, text: happened, told: "model", page: true, seq: 0 };
        ops.push({ type: "arc.beat", id: c.id, beat, nextAt: arc!.nextAt }, { type: "arc.set", id: c.id, patch });
      }
    }
    for (const a of Object.values(st.sim.arrivals)) if (a.arc === c.id && (a.status === "pending" || a.status === "offered")) ops.push({ type: "arrival.set", id: a.id, status: "expired" });
  }
  return ops;
}
