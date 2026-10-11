import { all, parseJson } from "../db/db";
import { publish } from "../lib/events";
import { badRequest } from "../lib/http";
import { getSetting, setSetting } from "../lib/settings";
import { cleanText } from "../memory/text";
import { lane, registerLane } from "../prompt/lanes";
import { type ChatSettings, mustChat, updateChat } from "../services/chats";
import { registerStatusTile } from "../services/status";
import { rng } from "../sim/dice";

/**
 * The adaptive craft coach (Almanac plan D2): anti-slop that learns. Instead of a fixed banned
 * list, Mea measures the last replies (pure text statistics, no model, cached per take) against
 * this story's own baseline, and gives the model the three habits it's leaning on hardest plus
 * one technique to try, rotated so none repeats within ten replies. A phrase that keeps coming
 * back can be banned in one tap.
 */

export interface Stats {
  words: number;
  sentences: number;
  paragraphs: number[];
  /** First word of each sentence (lower case). */
  openings: string[];
  filter: number;
  emdash: number;
  ellipsis: number;
  triads: number;
  /** Share of characters inside quotes. */
  dialogue: number;
  similes: string[];
  gestures: string[];
  /** 3–5 word phrases (lower case), each once per take. */
  grams: string[];
}

const STOP = new Set("the a an and or but of to in on at for with as by from that this it its is was were be been he she they his her their him them i you your we our my me not no so then there here".split(" "));
const FILTER = /\b(?:felt|feels|feel|noticed|notices|notice|realized|realised|realizes|realises|seemed|seems|watched|watches|heard|hears|saw|sees|wondered|wonders|knew|decided)\b/gi;
const GESTURES: [string, RegExp][] = [
  ["a breath held without knowing it", /breath (?:s?he|they|i|you) didn['’]t (?:know|realize)/i],
  ["a breath catching", /breath (?:catch(?:es)?|caught|hitch(?:es|ed)?)/i],
  ["a jaw clenching", /jaw (?:clench(?:es|ed)?|tighten(?:s|ed)?|work(?:s|ed)?)/i],
  ["a smirk", /\bsmirk(?:s|ed|ing)?\b/i],
  ["eyes darkening", /eyes darken(?:s|ed)?/i],
  ["a lip bitten", /bit(?:es|e|ing)? (?:her|his|their|my) (?:lower )?lip/i],
  ["a shiver down the spine", /shiver (?:ran |runs |running )?down/i],
  ["a heart skipping", /heart (?:skip(?:s|ped)?|flutter(?:s|ed)?|stutter(?:s|ed)?)/i],
  ["a breath let out", /let(?:s)? out a (?:shaky |slow |long )?breath/i],
  ["white knuckles", /knuckles? (?:went |turned |whiten(?:ed|ing)?|white)/i],
  ["a voice barely above a whisper", /barely above a whisper/i],
];
const sentencesOf = (t: string) => t.split(/(?<=[.!?…]["”')\]*]*)\s+|\n+/).map((s) => s.trim()).filter((s) => /[\p{L}]/u.test(s));

/** The numbers for one take. */
export function craftStats(text: string): Stats {
  const clean = cleanText(text);
  const words = clean.split(/\s+/).filter(Boolean);
  const sents = sentencesOf(clean);
  const paragraphs = clean.split(/\n\s*\n|\n/).map((p) => p.split(/\s+/).filter(Boolean).length).filter((n) => n > 0);
  const quoted = (clean.match(/"[^"\n]*"|“[^”\n]*”/g) ?? []).join("").length;
  // Phrases stay inside their sentence.
  const grams = new Set<string>();
  for (const sent of sents) {
    const lw = sent.split(/\s+/).map((w) => w.toLowerCase().replace(/[^\p{L}\p{N}'’]/gu, ""));
    for (let n = 3; n <= 5; n++)
      for (let i = 0; i + n <= lw.length; i++) {
        const g = lw.slice(i, i + n);
        if (g.some((w) => !w) || g.every((w) => STOP.has(w)) || g.filter((w) => !STOP.has(w)).length < 2) continue;
        grams.add(g.join(" "));
      }
  }
  return {
    words: words.length,
    sentences: sents.length,
    paragraphs,
    openings: sents.map((s) => (s.replace(/^["“*_(]+/, "").match(/^[\p{L}'’]+/u)?.[0] ?? "").toLowerCase()).filter(Boolean),
    filter: (clean.match(FILTER) ?? []).length,
    emdash: (clean.match(/—|–|--/g) ?? []).length,
    ellipsis: (clean.match(/…|\.\.\./g) ?? []).length,
    triads: (clean.match(/\b[\p{L}'’-]+(?: [\p{L}'’-]+){0,2}, [\p{L}'’-]+(?: [\p{L}'’-]+){0,2},? and [\p{L}'’-]+/gu) ?? []).length,
    dialogue: clean.length ? quoted / clean.length : 0,
    similes: [...clean.matchAll(/\b(?:like a|like an|as if|as though) ([\p{L}'’-]+(?: [\p{L}'’-]+)?)/giu)].map((m) => m[1]!.toLowerCase()),
    gestures: GESTURES.filter(([, re]) => re.test(clean)).map(([name]) => name),
    grams: [...grams],
  };
}

/** Per take, by its id and length (a take's text only changes with an edit). */
const cache = new Map<string, Stats>();
function statsFor(id: string, text: string) {
  const key = `${id}:${text.length}:${text.slice(-40)}`;
  let s = cache.get(key);
  if (!s) {
    s = craftStats(text);
    if (cache.size > 4000) cache.clear();
    cache.set(key, s);
  }
  return s;
}

export interface Habit {
  /** Stable key, for "It's fine". */
  key: string;
  kind: "phrase" | "opening" | "shape" | "filter" | "emdash" | "ellipsis" | "triads" | "dialogue" | "gesture" | "simile";
  /** What the model is told to avoid. */
  avoid: string;
  /** For you: the numbers. */
  detail: string;
  /** How hard it leans (the top three go to the model). */
  weight: number;
  /** A phrase that can be banned in one tap. */
  phrase?: string;
}

const per100 = (n: number, words: number) => (words ? (n / words) * 100 : 0);
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/** The last replies' active takes, newest last (and the older ones for the baseline). */
function recent(chatId: string, beforeSeq?: number) {
  return all<{ id: string; content: string; seq: number }>(
    `SELECT s.id, s.content, m.seq FROM messages m JOIN swipes s ON s.message_id = m.id AND s.idx = m.active_swipe
     WHERE m.chat_id = ? AND m.role = 'assistant' AND m.deleted_at IS NULL AND s.status = 'done' AND s.content != '' ${beforeSeq != null ? "AND m.seq < ?" : ""}
     ORDER BY m.seq DESC LIMIT 48`,
    ...(beforeSeq != null ? [chatId, beforeSeq] : [chatId]),
  ).reverse();
}

const WINDOW = 8;

export interface CraftReport {
  habits: Habit[];
  /** This turn's numbers (for the Inspector's meter). */
  meter: { replies: number; filter: number; emdash: number; ellipsis: number; triads: number; dialogue: number; baselineDialogue: number | null; topOpening: { word: string; share: number } | null };
}

/**
 * What the last replies lean on, against the story's own baseline (the replies before them), so
 * a story that's always terse or always dash-heavy isn't nagged for its own style.
 */
export function craftReport(chatId: string, opts: { beforeSeq?: number } = {}): CraftReport {
  const rows = recent(chatId, opts.beforeSeq).map((r) => ({ ...r, s: statsFor(r.id, r.content) }));
  const win = rows.slice(-WINDOW);
  const base = rows.slice(0, -WINDOW);
  const ignored = new Set(parseJson<ChatSettings>(mustChat(chatId).settings, {}).craft?.ignored ?? []);
  const words = win.reduce((n, r) => n + r.s.words, 0);
  const baseWords = base.reduce((n, r) => n + r.s.words, 0);
  const rate = (k: "filter" | "emdash" | "ellipsis" | "triads", rs: typeof rows, w: number) => per100(rs.reduce((n, r) => n + r.s[k], 0), w);
  /** Above the floor, and well above this story's own baseline when it has one. */
  const drift = (cur: number, floor: number, k: "filter" | "emdash" | "ellipsis" | "triads") => (base.length >= 4 ? cur > Math.max(floor, rate(k, base, baseWords) * 1.5) : cur > floor * 1.3);
  const habits: Habit[] = [];
  if (win.length >= 2) {
    // Repeated phrases: a 3–5 word phrase in three or more of the last replies.
    const count = new Map<string, number>();
    for (const r of win) for (const g of r.s.grams) count.set(g, (count.get(g) ?? 0) + 1);
    const reps = [...count].filter(([, n]) => n >= Math.max(3, Math.ceil(win.length * 0.4))).sort((a, b) => b[1] - a[1] || b[0].length - a[0].length);
    // The longest of overlapping phrases only ("the old glass" inside "against the old glass").
    const kept: [string, number][] = [];
    const shares = (a: string, b: string) => {
      const wb = new Set(b.split(" "));
      return a.split(" ").filter((w) => wb.has(w)).length >= 3;
    };
    for (const [g, n] of reps) if (!kept.some(([k]) => k.includes(g) || g.includes(k) || shares(k, g))) kept.push([g, n]);
    for (const [g, n] of kept.slice(0, 3)) habits.push({ key: `phrase:${g}`, kind: "phrase", avoid: `the phrase "${g}"`, detail: `"${g}" in ${n} of the last ${win.length} replies`, weight: 3 + n, phrase: g });
    // Sentence openings.
    const opens = win.flatMap((r) => r.s.openings);
    const tally = new Map<string, number>();
    for (const o of opens) tally.set(o, (tally.get(o) ?? 0) + 1);
    const top = [...tally].sort((a, b) => b[1] - a[1])[0];
    const share = top && opens.length ? top[1] / opens.length : 0;
    if (top && opens.length >= 12 && share >= 0.3) habits.push({ key: `opening:${top[0]}`, kind: "opening", avoid: `opening sentences with "${top[0][0]!.toUpperCase()}${top[0].slice(1)}"`, detail: `${Math.round(share * 100)}% of sentences start with "${top[0]}"`, weight: 2 + share * 6 });
    // Paragraph shape: the same number of paragraphs, reply after reply.
    const counts = win.map((r) => r.s.paragraphs.length);
    const mode = [...new Set(counts)].map((c) => [c, counts.filter((x) => x === c).length] as const).sort((a, b) => b[1] - a[1])[0];
    if (mode && win.length >= 6 && mode[1] >= Math.ceil(win.length * 0.75) && mode[0] >= 2) habits.push({ key: `shape:${mode[0]}`, kind: "shape", avoid: `the same shape every time (${mode[0]} paragraphs of similar length)`, detail: `${mode[1]} of the last ${win.length} replies have ${mode[0]} paragraphs`, weight: 2.5 });
    // Densities.
    const f = rate("filter", win, words);
    if (drift(f, 0.9, "filter")) habits.push({ key: "filter", kind: "filter", avoid: "filter words (felt, noticed, saw, realised): show the thing itself", detail: `${f.toFixed(1)} filter words per 100 words`, weight: 1.5 + f });
    const d = rate("emdash", win, words);
    if (drift(d, 1.2, "emdash")) habits.push({ key: "emdash", kind: "emdash", avoid: "em-dashes: use full stops and commas", detail: `${d.toFixed(1)} dashes per 100 words`, weight: 1 + d });
    const e = rate("ellipsis", win, words);
    if (drift(e, 0.6, "ellipsis")) habits.push({ key: "ellipsis", kind: "ellipsis", avoid: "trailing ellipses", detail: `${e.toFixed(1)} ellipses per 100 words`, weight: 1 + e * 1.5 });
    const t = win.reduce((n, r) => n + r.s.triads, 0) / win.length;
    if (t >= 1.5) habits.push({ key: "triads", kind: "triads", avoid: "lists of three (X, Y, and Z)", detail: `${t.toFixed(1)} lists of three per reply`, weight: 1 + t });
    // Dialogue drifting away from this story's usual share.
    if (base.length >= 4) {
      const cur = mean(win.map((r) => r.s.dialogue));
      const usual = mean(base.map((r) => r.s.dialogue));
      if (Math.abs(cur - usual) >= 0.22) habits.push({ key: `dialogue:${cur > usual ? "up" : "down"}`, kind: "dialogue", avoid: cur > usual ? "letting talk crowd out the scene (more action and place, like before)" : "losing the talk (this story usually has more dialogue)", detail: `dialogue is ${Math.round(cur * 100)}% of the text, usually ${Math.round(usual * 100)}%`, weight: 2 + Math.abs(cur - usual) * 4 });
    }
    // Overused gestures and similes.
    const gest = new Map<string, number>();
    for (const r of win) for (const g of r.s.gestures) gest.set(g, (gest.get(g) ?? 0) + 1);
    for (const [g, n] of [...gest].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, 2)) habits.push({ key: `gesture:${g}`, kind: "gesture", avoid: g, detail: `${n} times in the last ${win.length} replies`, weight: 2 + n });
    const sim = new Map<string, number>();
    for (const r of win) for (const s of r.s.similes) sim.set(s, (sim.get(s) ?? 0) + 1);
    const simTotal = win.reduce((n, r) => n + r.s.similes.length, 0);
    const twice = [...sim].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1])[0];
    if (twice) habits.push({ key: `simile:${twice[0]}`, kind: "simile", avoid: `the simile "like ${twice[0]}"`, detail: `"${twice[0]}" ${twice[1]} times`, weight: 2 + twice[1] });
    else if (per100(simTotal, words) > 1.2) habits.push({ key: "similes", kind: "simile", avoid: "so many similes: say what the thing is", detail: `${per100(simTotal, words).toFixed(1)} similes per 100 words`, weight: 1.5 });
  }
  const opens = win.flatMap((r) => r.s.openings);
  const tally = new Map<string, number>();
  for (const o of opens) tally.set(o, (tally.get(o) ?? 0) + 1);
  const top = [...tally].sort((a, b) => b[1] - a[1])[0];
  return {
    habits: habits.filter((h) => !ignored.has(h.key)).sort((a, b) => b.weight - a.weight),
    meter: {
      replies: win.length,
      filter: Math.round(rate("filter", win, words) * 10) / 10,
      emdash: Math.round(rate("emdash", win, words) * 10) / 10,
      ellipsis: Math.round(rate("ellipsis", win, words) * 10) / 10,
      triads: win.length ? Math.round((win.reduce((n, r) => n + r.s.triads, 0) / win.length) * 10) / 10 : 0,
      dialogue: Math.round(mean(win.map((r) => r.s.dialogue)) * 100) / 100,
      baselineDialogue: base.length >= 4 ? Math.round(mean(base.map((r) => r.s.dialogue)) * 100) / 100 : null,
      topOpening: top && opens.length ? { word: top[0], share: Math.round((top[1] / opens.length) * 100) / 100 } : null,
    },
  };
}

// ---------- techniques, rotated ----------

export const TECHNIQUES = [
  "Subtext in dialogue: let a line mean more than it says, and don't explain it.",
  "One concrete sensory anchor (a sound, a texture, a smell) that someone in the scene actually notices.",
  "Cut away on an image instead of a summary or a reflection.",
  "An interruption: someone or something breaks into a line before it's finished.",
  "A small physical task carried on underneath the talk.",
  "A silence that does the work a line would have done.",
  "One sentence much shorter than the rest, where it lands hardest.",
  "Let a character misread something, and play it straight.",
  "A detail from earlier in the story, come back changed.",
  "Start in the middle of an action, not before it.",
  "Give the place one thing it does on its own (it creaks, it closes, it runs out).",
  "A line of dialogue answered with an action instead of words.",
  "Let the point-of-view character be wrong about what they see.",
  "An object that carries the feeling, so nobody has to name it.",
];

/** This reply's technique: a seeded order for the story, so none repeats within ten replies (and every swipe agrees). */
export function techniqueFor(chatId: string, replyNo: number) {
  const r = rng(`${chatId}:craft-order`);
  const order = TECHNIQUES.map((t) => ({ t, k: r() })).sort((a, b) => a.k - b.k).map((x) => x.t);
  return order[((replyNo % order.length) + order.length) % order.length]!;
}

// ---------- your hand ----------

export function craftOn(chatId: string) {
  return getSetting("steer.config").craft !== false && !parseJson<ChatSettings>(mustChat(chatId).settings, {}).craft?.paused;
}

export function setCraft(chatId: string, patch: { paused?: boolean; ignore?: string; unignore?: string }) {
  const cur = parseJson<ChatSettings>(mustChat(chatId).settings, {}).craft ?? {};
  const ignored = new Set(cur.ignored ?? []);
  if (patch.ignore) ignored.add(patch.ignore);
  if (patch.unignore) ignored.delete(patch.unignore);
  updateChat(chatId, { settings: { craft: { ...cur, ...(patch.paused != null ? { paused: patch.paused } : {}), ignored: [...ignored].slice(-60) } } });
}

/** "Ban it": the phrase joins your banned phrases (Settings › Writing). */
export function banPhrase(phrase: string) {
  const p = phrase.trim().slice(0, 80);
  if (!p) throw badRequest("Which phrase?");
  const b = getSetting("chat.banned");
  if (!b.list.some((x) => x.phrase.toLowerCase() === p.toLowerCase())) setSetting("chat.banned", { ...b, list: [...b.list, { phrase: p }] });
  publish({ type: "inbox.changed" });
}

// ---------- the [CRAFT] lane and the Status tile ----------

registerLane("craft", (ctx) => {
  if ((ctx.kind !== "story" && ctx.kind !== "continue") || !craftOn(ctx.chatId)) return null;
  const replyNo = all<{ n: number }>("SELECT COUNT(*) AS n FROM messages WHERE chat_id = ? AND role = 'assistant' AND deleted_at IS NULL", ctx.chatId)[0]?.n ?? 0;
  const seq = ctx.excludeMessageId ? all<{ seq: number }>("SELECT seq FROM messages WHERE id = ?", ctx.excludeMessageId)[0]?.seq : undefined;
  const r = craftReport(ctx.chatId, { beforeSeq: seq });
  if (r.meter.replies < 2) return null;
  const avoid = r.habits.slice(0, 3);
  const tech = techniqueFor(ctx.chatId, ctx.excludeMessageId ? replyNo - 1 : replyNo);
  return lane("craft", null, `${avoid.length ? `The last replies lean on these; avoid them in this one:\n${avoid.map((h) => `- ${h.avoid}`).join("\n")}\n` : ""}Try this once, where it fits: ${tech}`, { depth: 1 });
});

registerStatusTile((chatId) => {
  if (!craftOn(chatId)) return null;
  const r = craftReport(chatId);
  if (r.meter.replies < 2) return null;
  const n = r.habits.length;
  return { id: "craft", n: Math.min(n, 3), value: String(n), label: `habit${n === 1 ? "" : "s"} watched`, tone: "blue", open: { dock: "chat", section: "craft" }, order: 50, title: r.habits.slice(0, 3).map((h) => h.detail).join("\n") || "No habits to watch right now" };
});
