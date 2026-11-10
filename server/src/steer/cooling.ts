import { all, parseJson } from "../db/db";
import type { SpokenLine } from "../lib/speakers";
import { chatNames } from "../memory/build";
import { cleanText } from "../memory/text";
import { lane, registerLane } from "../prompt/lanes";
import { type ChatSettings, mustChat } from "../services/chats";
import { currentFold } from "../trackers/store";
import { craftOn, craftStats } from "./craft";

/**
 * Prose habits cool on their own (docs/33 Part 10). In Buffy × Gabriel the tics were replaced, not
 * removed: the raw wrist went and the filing cabinet came ("filed under" in 97% of replies), the
 * filing cabinet eased and the courtroom arrived (ruling, docket, counselor in 86%), and it spread
 * from Buffy to Dawn, Spike and Ruth. The craft coach was paused, so nothing watched.
 *
 * This looks at the last twenty replies by counting, with no model: a word family (filing,
 * courtroom), a coined word that suddenly turns up everywhere ("load-bearing"), a sentence shape ("Not X.
 * Not Y."), or (with the coach off) a phrase, over a set share of them goes on a cooling list by
 * itself and comes off when it fades. A running bit that one person says is theirs: the line names
 * who may still use it.
 */

export const COOL_WINDOW = 20;
/** Fewer replies than this and nothing is measured. */
const MIN_REPLIES = 8;
/** A family, a word or a shape in this share of the window is cooling. */
const FAMILY_SHARE = 0.35;
/** Coined words ("load-bearing") cool at a lower share: in Buffy × Gabriel it was 42% of an era. */
const WORD_SHARE = 0.3;
const SHAPE_SHARE = 0.35;
const PHRASE_SHARE = 0.3;
/** A word found by counting must be new: in at most this share of the replies before the window. */
const WORD_WAS = 0.1;
const MAX_ITEMS = 5;

/** Metaphor families, by their words. The first word is the family's example. */
export const FAMILIES: { key: string; label: string; words: string[] }[] = [
  {
    key: "filing",
    label: "filing words",
    words: [
      "filed",
      "file",
      "files",
      "filing",
      "refiled",
      "misfiled",
      "drawer",
      "drawers",
      "folder",
      "folders",
      "cross-referenced",
      "cross-reference",
    ],
  },
  {
    key: "court",
    label: "courtroom words",
    words: [
      "ruling",
      "overruled",
      "sustained",
      "objection",
      "counselor",
      "counsellor",
      "gavel",
      "exhibit",
      "verdict",
      "testimony",
      "docket",
      "courtroom",
      "the court",
      "your honor",
      "so ordered",
      "case closed",
      "for the record",
      "jury",
      "recess",
      "precedent",
      "cross-examination",
      "admissible",
      "inadmissible",
      "stricken",
      "adjourned",
      "bailiff",
      "defendant",
      "prosecution",
      "the defense",
      "plaintiff",
      "sentencing",
      "ruled",
    ],
  },
];

/** Sentence shapes that become tics, by what they look like on the page. */
const SHAPES: {
  key: string;
  label: string;
  re: RegExp;
  quoted?: boolean;
  first?: boolean;
}[] = [
  {
    key: "not-not",
    label: '"Not X. Not Y." sentences',
    re: /(?:^|[.!?…]["”]?\s+)Not [^.!?\n]{1,40}[.!?…]["”]?\s+Not [^.!?\n]{1,40}[.!?…]/,
  },
  {
    key: "kind-of",
    label: '"the kind of …" descriptions',
    re: /\bthe kind of\b/i,
  },
  {
    key: "whole-thing",
    label: '"a whole thing"',
    re: /\ba whole (?:thing|situation|production|bit)\b/i,
  },
  // Dialogue built of false starts ("That's — you can't just — there's a whole —").
  {
    key: "stutter",
    label: "lines built of false starts (\"That's — you can't just —\")",
    re: /(?:[\w'’]+(?: [\w'’]+){0,3} ?[—–] ?){3,}/,
    quoted: true,
  },
  // Opening on the house's own noise.
  {
    key: "noise-open",
    label:
      "opening on a sound in the house (a pipe, the fridge, the water heater)",
    re: /\b(?:fridge|refrigerator|pipes?|water heater|radiator|furnace|ice maker|dishwasher|clock)\b/i,
    first: true,
  },
];

export interface Cooling {
  /** Stable, for "It's fine" (craft's ignored list). */
  key: string;
  kind: "family" | "word" | "shape" | "phrase";
  label: string;
  /** The family's words this window actually used, most first. */
  used: string[];
  /** Replies in the window that have it. */
  n: number;
  of: number;
  /** Who says it, when one person says most of it: the only one who may still use it. */
  owner?: string;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const wordRe = (w: string) =>
  new RegExp(
    `(?<![\\p{L}'’-])${esc(w).replace(/ /g, "\\s+")}(?![\\p{L}'’-])`,
    "giu",
  );
const FAMILY_RES = FAMILIES.map((f) => ({
  ...f,
  res: f.words.map((w) => [w, wordRe(w)] as const),
}));

const quotedSpans = (t: string) =>
  (t.match(/"[^"\n]*"|“[^”\n]*”/g) ?? []).join("\n");
const firstSentence = (t: string) => t.trim().split(/(?<=[.!?…])\s+/)[0] ?? "";
/** Words of five letters or more, possessives folded ("walter’s" is "walter"). */
const tokens = (t: string) =>
  new Set(
    (t.toLowerCase().match(/\p{L}[\p{L}'’-]*\p{L}/gu) ?? [])
      .map((w) => w.replace(/['’]s$/, ""))
      .filter((w) => w.length >= 5),
  );
const CALENDAR = new Set(
  "monday tuesday wednesday thursday friday saturday sunday january february march april june july august september october november december".split(
    " ",
  ),
);
/** A word found by counting has to turn up across this many scenes: one scene's props are the scene. */
const WORD_SCENES = 3;

interface Reply {
  seq: number;
  text: string;
  lines: SpokenLine[];
}

function replies(chatId: string, beforeSeq?: number): Reply[] {
  return all<{ seq: number; content: string; meta: string }>(
    `SELECT m.seq, s.content, s.meta FROM messages m JOIN swipes s ON s.message_id = m.id AND s.idx = m.active_swipe
     WHERE m.chat_id = ? AND m.role = 'assistant' AND m.deleted_at IS NULL AND s.status = 'done' AND s.content != '' ${beforeSeq != null ? "AND m.seq < ?" : ""}
     ORDER BY m.seq DESC LIMIT 60`,
    ...(beforeSeq != null ? [chatId, beforeSeq] : [chatId]),
  )
    .reverse()
    .map((r) => ({
      seq: r.seq,
      text: cleanText(r.content),
      lines: parseJson<{ speakers?: SpokenLine[] }>(r.meta, {}).speakers ?? [],
    }));
}

/** The player's last turns, newest first. */
function playerTurns(
  chatId: string,
  beforeSeq: number | undefined,
  n: number,
): string[] {
  return all<{ content: string }>(
    `SELECT s.content FROM messages m JOIN swipes s ON s.message_id = m.id AND s.idx = m.active_swipe
     WHERE m.chat_id = ? AND m.role = 'user' AND m.deleted_at IS NULL ${beforeSeq != null ? "AND m.seq < ?" : ""} ORDER BY m.seq DESC LIMIT ${n}`,
    ...(beforeSeq != null ? [chatId, beforeSeq] : [chatId]),
  ).map((r) => r.content);
}

/** Who says most of what matches, in the lines Mea knows the speaker of. */
function ownerOf(win: Reply[], has: (s: string) => number): string | undefined {
  const by = new Map<string, number>();
  let said = 0;
  for (const r of win)
    for (const l of r.lines) {
      const n = l.name ? has(l.text) : 0;
      if (!n) continue;
      said += n;
      by.set(l.name!, (by.get(l.name!) ?? 0) + n);
    }
  const top = [...by].sort((a, b) => b[1] - a[1])[0];
  return top && said >= 3 && top[1] / said >= 0.6 ? top[0] : undefined;
}

/** What's cooling in this story now, most used first. */
export function coolingList(
  chatId: string,
  opts: { beforeSeq?: number } = {},
): Cooling[] {
  const rows = replies(chatId, opts.beforeSeq);
  const win = rows.slice(-COOL_WINDOW);
  if (win.length < MIN_REPLIES) return [];
  const before = rows.slice(0, -COOL_WINDOW);
  const ignored = new Set(
    parseJson<ChatSettings>(mustChat(chatId).settings, {}).craft?.ignored ?? [],
  );
  const out: Cooling[] = [];
  const of = win.length;

  for (const f of FAMILY_RES) {
    const count = (s: string) =>
      f.res.reduce((n, [, re]) => n + (s.match(re)?.length ?? 0), 0);
    const hits = win.filter((r) => count(r.text) > 0).length;
    if (hits / of < FAMILY_SHARE) continue;
    const used = f.res
      .map(
        ([w, re]) =>
          [
            w,
            win.reduce((n, r) => n + (r.text.match(re)?.length ?? 0), 0),
          ] as const,
      )
      .filter(([, n]) => n > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([w]) => w);
    out.push({
      key: `cool:${f.key}`,
      kind: "family",
      label: f.label,
      used: used.slice(0, 5),
      n: hits,
      of,
      owner: ownerOf(win, count),
    });
  }

  // Words found by counting: everywhere now, and rare before. Names, and what the player is
  // talking about, are the scene, not a habit.
  if (before.length >= 15) {
    const skip = new Set<string>();
    try {
      for (const c of Object.values(currentFold(chatId).result.state.chars))
        for (const n of [c.name, ...c.aliases])
          for (const w of n.toLowerCase().split(/\s+/)) skip.add(w);
    } catch {
      // no cast to skip
    }
    for (const t of playerTurns(chatId, opts.beforeSeq, 6))
      for (const w of tokens(t)) skip.add(w);
    for (const f of FAMILIES) for (const w of f.words) skip.add(w);
    const inWin = new Map<string, number>();
    for (const w of CALENDAR) skip.add(w);
    // Which scene each reply is in (the closed scene records), so a word must cross scenes.
    const scenes = all<{ start_seq: number; end_seq: number | null }>(
      "SELECT start_seq, end_seq FROM summaries WHERE chat_id = ? AND level = 'scene' ORDER BY start_seq",
      chatId,
    );
    const sceneOf = (seq: number) =>
      scenes.findIndex(
        (x) => seq >= x.start_seq && seq <= (x.end_seq ?? Infinity),
      );
    const sceneSets = new Map<string, Set<number>>();
    for (const r of win)
      for (const w of tokens(r.text)) {
        // Plain words that crowd a stretch are mostly the scene's props (toast, the table); a coined,
        // hyphenated word that does is a tic.
        if (skip.has(w) || !w.includes("-")) continue;
        inWin.set(w, (inWin.get(w) ?? 0) + 1);
        const sets = sceneSets.get(w) ?? new Set<number>();
        sets.add(sceneOf(r.seq));
        sceneSets.set(w, sets);
      }
    const was = new Map<string, number>();
    for (const r of before)
      for (const w of tokens(r.text)) was.set(w, (was.get(w) ?? 0) + 1);
    const words = [...inWin]
      .filter(
        ([w, n]) =>
          n / of >= WORD_SHARE &&
          (was.get(w) ?? 0) / before.length <= WORD_WAS &&
          [...(sceneSets.get(w) ?? [])].filter((i) => i >= 0).length >=
            WORD_SCENES,
      )
      .sort((a, b) => b[1] - a[1]);
    for (const [w, n] of words.slice(0, 3)) {
      const re = wordRe(w);
      out.push({
        key: `cool:word:${w}`,
        kind: "word",
        label: `"${w}"`,
        used: [w],
        n,
        of,
        owner: ownerOf(win, (s) => s.match(re)?.length ?? 0),
      });
    }
  }

  for (const s of SHAPES) {
    const part = (r: Reply) =>
      s.quoted ? quotedSpans(r.text) : s.first ? firstSentence(r.text) : r.text;
    const n = win.filter((r) => s.re.test(part(r))).length;
    if (n / of >= SHAPE_SHARE)
      out.push({
        key: `cool:shape:${s.key}`,
        kind: "shape",
        label: s.label,
        used: [],
        n,
        of,
        owner: s.first
          ? undefined
          : ownerOf(win, (t) => (s.re.test(t) ? 1 : 0)),
      });
  }

  // Phrases are the coach's when it's on; with it paused, they cool here.
  if (!craftOn(chatId)) {
    const count = new Map<string, number>();
    for (const r of win)
      for (const g of craftStats(r.text).grams)
        count.set(g, (count.get(g) ?? 0) + 1);
    const kept: [string, number][] = [];
    for (const [g, n] of [...count]
      .filter(([, n]) => n / of >= PHRASE_SHARE)
      .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length))
      if (
        !kept.some(
          ([k]) =>
            k.includes(g) ||
            g.includes(k) ||
            k.split(" ").filter((w) => w.length > 3 && g.split(" ").includes(w))
              .length >= 2,
        )
      )
        kept.push([g, n]);
    for (const [g, n] of kept.slice(0, 2))
      out.push({
        key: `cool:phrase:${g}`,
        kind: "phrase",
        label: `"${g}"`,
        used: [g],
        n,
        of,
      });
  }

  return out
    .filter((c) => !ignored.has(c.key))
    .sort((a, b) => b.n - a.n)
    .slice(0, MAX_ITEMS);
}

/** One line of the lane. A running bit with an owner stays theirs; anything else rests for a reply. */
export function coolingLine(c: Cooling) {
  const what =
    c.kind === "family"
      ? `${c.label} (${c.used.join(", ")}${c.used.length >= 5 ? "…" : ""})`
      : c.label;
  const where = `in ${c.n} of the last ${c.of} replies`;
  return c.owner
    ? `- ${what}: ${where}. It's ${c.owner}'s running bit: only ${c.owner} may use it, in ${c.owner}'s own lines, at most once here; nobody else, and not the narration.`
    : `- ${what}: ${where}. Leave it out of this reply.`;
}

/** The chat's own switch: cooling runs whether or not the coach is paused, unless you turn it off. */
export function coolingOn(chatId: string) {
  return (
    parseJson<ChatSettings>(mustChat(chatId).settings, {}).craft?.cooling !==
    false
  );
}

// ---------- docs/33 10.4: length follows the turn, and the reply ends on something to answer ----------

const words = (t: string) => cleanText(t).split(/\s+/).filter(Boolean).length;

/** Whether a reply ends on something the player can answer: a line said, or a question. */
export function endsAnswerable(text: string) {
  const paras = cleanText(text)
    .split(/\n\s*\n|\n/)
    .map((p) => p.trim())
    .filter((p) => /\p{L}/u.test(p) && !/^<\/?[a-z]/i.test(p));
  const last = paras.at(-1) ?? "";
  return /["“”]/.test(last) || /\?["”’)]*$/.test(last);
}

export function turnNote(chatId: string, beforeSeq?: number): string {
  const s = parseJson<ChatSettings>(mustChat(chatId).settings, {});
  const user = chatNames(chatId).user;
  const lines: string[] = [];
  const turn = playerTurns(chatId, beforeSeq, 1)[0];
  // Your length setting wins.
  if (turn && !s.length) {
    const n = words(turn);
    if (n > 0 && n <= 40)
      lines.push(
        `${user}'s turn was ${n} words: answer in kind, about ${n <= 15 ? 150 : 250} words at most, unless something in the scene turns.`,
      );
  }
  const last = replies(chatId, beforeSeq).slice(-10);
  if (last.length >= 6) {
    const answerable = last.filter((r) => endsAnswerable(r.text)).length;
    if (answerable / last.length <= 0.3)
      lines.push(
        `${last.length - answerable} of the last ${last.length} replies ended on the room. End this one on something ${user} can answer: a line, a look, a question.`,
      );
  }
  return lines.join("\n");
}

registerLane("cooling", (ctx) => {
  if (
    (ctx.kind !== "story" && ctx.kind !== "continue") ||
    !coolingOn(ctx.chatId)
  )
    return null;
  const seq = ctx.excludeMessageId
    ? all<{ seq: number }>(
        "SELECT seq FROM messages WHERE id = ?",
        ctx.excludeMessageId,
      )[0]?.seq
    : undefined;
  const list = coolingList(ctx.chatId, { beforeSeq: seq });
  if (!list.length) return null;
  return lane(
    "cooling",
    null,
    `These have been in too many of the last replies, so they rest:\n${list.map(coolingLine).join("\n")}`,
    { depth: 1 },
  );
});

registerLane("turn", (ctx) => {
  if (ctx.kind !== "story" || !coolingOn(ctx.chatId)) return null;
  const seq = ctx.excludeMessageId
    ? all<{ seq: number }>(
        "SELECT seq FROM messages WHERE id = ?",
        ctx.excludeMessageId,
      )[0]?.seq
    : undefined;
  return lane("turn", null, turnNote(ctx.chatId, seq), { depth: 0 });
});
