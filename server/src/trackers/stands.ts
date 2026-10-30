import { countTokens } from "../lib/tokens";
import { dated, type Lens, lensOf, sceneRecords } from "../memory/openlist";
import { contentWords, overlap } from "../memory/text";
import { lane, registerLane } from "../prompt/lanes";
import { formatStoryTime, shortStoryTime } from "./clock";
import { doneLoops, openLoops } from "./loops";
import { trackerConfig } from "./store";
import { topicWords } from "./topics";
import { LADDER, type Loop, type WorldState } from "./types";

/**
 * docs/22 Part 2: summaries are history, and only the ledger says what's open. WHERE THINGS STAND is
 * built from the loops with every reply and never summarized, so what it says can't go stale, and
 * ALREADY HAPPENED answers "have they said it?" with something better than recall's luck: at #629 the
 * first "I love you" was in no list a prompt could rely on. Both sit outside the cached prefix.
 */

/** How much each line takes: the note is read on every reply. */
const OPEN_TOKENS = 200;
const DONE_TOKENS = 90;
const HAPPENED_TOKENS = 250;
const HAPPENED_MAX = 20;
/** Long enough for a promise; a closing record's whole sentence isn't needed here. */
const ITEM = 90;
const HAPPENED_ITEM = 72;
/** Due within this many story minutes, it's what comes up next. */
const SOON = 1440;
/** Hour by hour under this many minutes, like the note's reminders. */
const HOURS = 180;
/** A loop's words the newest messages share, for it to count as being talked about. */
const TALKED = 2;
/** Two lines this alike are one thing said twice. */
const SAME = 0.6;
/** A scene rated this high can raise a moment of these kinds; a turning point takes the top rating. */
const FIRST_RATING = 9;
const TOP_RATING = 10;
const FIRSTS = new Set(["confession", "first kiss", "death"]);
/** The ladder rungs that are something happening, not something brewing: "Spoken" on. */
const LADDER_FROM = 5;
/** What says outright that it's a first. */
const FIRST_WORDS = /\bfirst\b|\bi love you\b/i;

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** When it's due, as a day: a stored "tonight" is the night it was written. */
function dueText(st: WorldState, l: Loop, lens: Lens) {
  const at = l.due?.minutes;
  const now = st.time?.minutes;
  if (at != null && now != null) {
    const left = at - now;
    // "Day 3 · 10:00": the dot is what splits the list.
    const when = shortStoryTime(formatStoryTime({ minutes: at, form: st.time!.form })).replace(" · ", " ");
    if (left < 0) return ` (was due ${when})`;
    return left <= HOURS ? ` (in ${left < 120 ? `${left} min` : `${Math.round(left / 60)} h`})` : ` (due ${when})`;
  }
  return l.due?.text ? ` (due ${dated(l.due.text, l.opened, lens)})` : "";
}

/** One open loop, with whose promise it is: a promise's own words often have no subject. */
function openItem(st: WorldState, l: Loop, lens: Lens) {
  const who = l.obligation ? st.chars[st.obligations[l.obligation]?.who ?? ""]?.name : undefined;
  return `${who ? `${who}: ` : ""}${dated(clip(l.what, ITEM), l.opened, lens)}${dueText(st, l, lens)}`;
}

/** Whole items while they fit, in the order given. */
function fit(items: string[], budget: number) {
  const kept: string[] = [];
  let used = 0;
  for (const item of items) {
    const t = countTokens(item);
    if (used + t > budget) break;
    kept.push(item);
    used += t;
  }
  return kept;
}

/** Each thing once, its first telling kept. */
function distinct<T>(items: T[], text: (x: T) => string) {
  const kept: { item: T; words: Set<string> }[] = [];
  for (const item of items) {
    const words = contentWords(text(item));
    if (!kept.some((k) => overlap(k.words, words) >= SAME)) kept.push({ item, words });
  }
  return kept.map((k) => k.item);
}

/** Whether the newest messages are about it, so a thing just brought up is the one that shows. */
const talkedAbout = (st: WorldState, about: Set<string>) => (l: Loop) => [...topicWords(st, l.what)].filter((w) => about.has(w)).length >= TALKED;

/** Open loops, what's due first, then what's being talked about, then the newest. */
function rankedOpen(st: WorldState, about: Set<string>) {
  const now = st.time?.minutes;
  const soon = (l: Loop) => l.due?.minutes != null && now != null && l.due.minutes >= now && l.due.minutes - now <= SOON;
  const talked = talkedAbout(st, about);
  const rank = (l: Loop) => (soon(l) ? 0 : talked(l) ? 1 : 2);
  return [...openLoops(st)].sort((a, b) => rank(a) - rank(b) || (soon(a) ? a.due!.minutes! - b.due!.minutes! : b.opened - a.opened));
}

/** Done loops, what's being talked about first, then the newest. */
function rankedDone(st: WorldState, about: Set<string>) {
  const talked = talkedAbout(st, about);
  return [...doneLoops(st)].sort((a, b) => Number(talked(b)) - Number(talked(a)) || b.closed! - a.closed!);
}

/** "Buffy said 'I love you' — load-bearing": the fact, before the color. A cut inside a quote is left alone. */
function firstClause(text: string) {
  const first = text.trim().split(/\s+[—–]\s+/)[0]!;
  const quotes = first.replace(/\b['’]\b/g, "").match(/['"“”‘’]/g)?.length ?? 0;
  return quotes % 2 ? text.trim() : first;
}

/**
 * The turning points, oldest first. The tracker's milestones, the rung two people reached, a vital
 * promise kept and the top of the scenes' moments, each rated as its scene was. What the tracker chose
 * and what says it's a first count for more, and the first telling of a thing stands for the rest.
 */
export function alreadyHappened(chatId: string, st: WorldState) {
  const scenes = sceneRecords(chatId);
  const rated = (seq: number) => scenes.find((s) => s.start <= seq && seq <= s.end)?.importance ?? 5;
  const found: { text: string; seq: number; weight: number }[] = [];
  const add = (text: string, seq: number, weight: number) => found.push({ text: clip(text, HAPPENED_ITEM), seq, weight: weight + (FIRST_WORDS.test(text) ? 1 : 0) });
  for (const m of st.milestones) add(m.text, m.seq, rated(m.seq) + 1);
  const pairs = new Map<string, { text: string; seq: number; tier: number }>();
  for (const l of Object.values(st.ladders)) {
    const a = st.chars[l.from]?.name;
    const b = st.chars[l.to]?.name;
    if (!a || !b || l.tier < LADDER_FROM) continue;
    const key = [a, b].sort().join(" and ");
    const had = pairs.get(key);
    if (!had || l.tier > had.tier) pairs.set(key, { text: `${key}: ${LADDER[l.tier]}`, seq: l.seq, tier: l.tier });
  }
  for (const p of pairs.values()) add(p.text, p.seq, TOP_RATING + 1);
  for (const l of doneLoops(st)) {
    const o = l.obligation ? st.obligations[l.obligation] : undefined;
    if (o?.importance === 3) add(`Kept: ${l.what}`, l.closed!, rated(l.closed!) + 1);
  }
  for (const s of scenes) {
    for (const m of s.moments) {
      const tag = m.tag.replace(/_/g, " ");
      if (FIRSTS.has(tag) ? s.importance >= FIRST_RATING : tag === "turning point" && s.importance >= TOP_RATING) add(firstClause(m.text), m.seq || s.end, FIRSTS.has(tag) ? s.importance + 1 : s.importance);
    }
  }
  const items = distinct(found.sort((a, b) => a.seq - b.seq), (f) => f.text).sort((a, b) => b.weight - a.weight || a.seq - b.seq);
  const lines = items.map((f) => `${f.text} (#${f.seq})`);
  const kept = fit(lines, HAPPENED_TOKENS).slice(0, HAPPENED_MAX).length;
  return items.slice(0, kept).sort((a, b) => a.seq - b.seq).map(({ text, seq }) => ({ text, seq }));
}

/** The two blocks, as text. `focus` is what the story is on now: the loops it touches come first. */
export function standing(chatId: string, st: WorldState | null | undefined, focus = "") {
  if (!st || trackerConfig(chatId).mode === "off") return { stands: "", happened: "" };
  const lens = lensOf(chatId, st);
  const about = topicWords(st, focus);
  const open = distinct(rankedOpen(st, about), (l) => l.what).map((l) => openItem(st, l, lens));
  const shown = fit(open, OPEN_TOKENS);
  const quiet = open.length - shown.length;
  const done = fit(distinct(rankedDone(st, about), (l) => l.what).map((l) => `${dated(clip(l.what, ITEM), l.opened, lens)} (#${l.closed})`), DONE_TOKENS);
  const lines = [shown.length ? `Open: ${[...shown, ...(quiet ? [`and ${quiet} quieter`] : [])].join(" · ")}` : "", done.length ? `Done lately: ${done.join(" · ")}` : ""].filter(Boolean);
  const happened = alreadyHappened(chatId, st).map((h) => `${h.text} (#${h.seq})`);
  return {
    stands: lines.length ? `This is what's open now, from the record. Summaries and memories say what was open then, and lose to this.\n${lines.join("\n")}` : "",
    happened: happened.length ? `Never staged as a first again.\n${happened.join(" · ")}` : "",
  };
}

registerLane("stands", (ctx) => {
  const { stands, happened } = standing(ctx.chatId, ctx.state, ctx.history.slice(-4).map((m) => m.content).join("\n"));
  return [lane("stands", null, stands), lane("happened", null, happened)].filter((l) => l !== null);
});
