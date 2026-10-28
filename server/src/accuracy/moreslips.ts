import { all, one, parseJson } from "../db/db";
import { notFound } from "../lib/http";
import { cleanText } from "../memory/text";
import { lane, registerLane } from "../prompt/lanes";
import { addLesson } from "../steer/lessons";
import type { FlagRow, Issue } from "./checker";
import { esc, sentences } from "./rules";
import { type Found, SLIPS } from "./slips";
import type { WorldState } from "../trackers/types";

/**
 * More reply checks (Almanac plan D1), each one entry in the slip registry: someone speaking who
 * isn't in the scene, a reply putting the clock back, planning left in the prose, and (with the
 * helper model) claims about a past the records don't hold. Every finding can be fixed one
 * sentence at a time, dismissed, or kept as a lesson; and the last reply's open findings go into
 * the next prompt, so the slip isn't made twice.
 */

const SAY = "says|said|asks|asked|replies|replied|whispers|whispered|murmurs|murmured|shouts|shouted|calls|called|answers|answered|snaps|snapped|mutters|muttered|tells|told|adds|added";

// ---------- not in the scene ----------

const ARRIVE = "arrives?|arrived|arriving|walks? in|walked in|comes? in|came in|steps? in(?:side)?|stepped in(?:side)?|enters?|entered|bursts? in|burst in|shows? up|showed up|turns? up|turned up|appears? (?:in|at) the (?:door(?:way)?|entrance)|appeared (?:in|at) the (?:door(?:way)?|entrance)|comes? through the door|came through the door|ducks? in(?:side)?|ducked in(?:side)?";
/** Doing something in the room, as the subject of the sentence ("Shauna sits", "Shauna's hand moves"). */
const ACT = "sits?|sat|stands?|stood|watches|watched|looks? (?:up|over|away|at)|looked (?:up|over|away|at)|turns?|turned|nods?|nodded|smiles?|smiled|grins?|grinned|laughs?|laughed|shifts?|shifted|leans?|leaned|reaches|reached|hands?|handed|moves?|moved|crosses|crossed|kneels?|knelt|shrugs?|shrugged|sighs?|sighed|stares?|stared|flinches|flinched|pulls?|pulled|pushes|pushed";
const NOT_REALLY = /\b(phone|call|line|radio|letter|text|message|voicemail|screen|recording|photo|picture|remember(?:s|ed)?|recall(?:s|ed)?|dream(?:s|ed|t)?|imagin(?:e|es|ed)|pictur(?:e|es|ed)|would|could|might|if|wish(?:es|ed)?|used to|back (?:at|in|when|then)|thinks? of|thought of|wonders?|wondered)\b/i;
const namesRe = (c: { name: string; aliases: string[] }) => [c.name, ...c.aliases].filter((n) => n.length >= 2).map(esc).join("|");

/** The sentence this person arrives in (nothing marking it a memory or a wish), or undefined. */
function arrival(sents: string[], c: { name: string; aliases: string[] }) {
  const re = new RegExp(`\\b(?:${namesRe(c)})\\b(?:['’]s\\s+\\w+)?(?:\\s+\\w+ly)?\\s+(?:${ARRIVE})\\b`, "i");
  return sents.findIndex((s) => re.test(s) && !NOT_REALLY.test(s));
}

/**
 * A known person speaking ("…," Joss says / Joss says, "…") or acting in the room ("Joss sits",
 * "Joss's hand moves") while the trackers have them somewhere else, unless the reply brings them in first.
 */
export function notHereRule(text: string, st: WorldState): Found[] {
  const out: Found[] = [];
  const away = Object.values(st.chars).filter((c) => !c.isUser && !c.dead && c.tier === "off");
  if (!away.length) return out;
  const sents = sentences(cleanText(text));
  for (const c of away) {
    const names = namesRe(c);
    const said = new RegExp(`(?:["”]\\s*,?\\s*(?:${names})\\s+(?:${SAY})\\b|\\b(?:${names})\\s+(?:${SAY})\\s*,?\\s*["“])`, "i");
    const did = new RegExp(`(?:^|[.;:—–-]\\s*|\\band\\s+)[*_“"]?(?:${names})(?:['’]s\\s+(?:hand|hands|eyes|head|gaze|voice|face|mouth|jaw|shoulders?))?\\s+(?:${ACT})\\b`, "i");
    const came = arrival(sents, c);
    const at = sents.findIndex((s, i) => (came < 0 || i < came) && (said.test(s) || did.test(s.trim())) && !NOT_REALLY.test(s));
    if (at < 0) continue;
    const hit = sents[at]!;
    out.push({
      kind: "nothere",
      severity: "major",
      claim: hit.trim(),
      conflict: `${c.name} isn't in this scene${c.place ? ` (they're at ${c.place})` : ""}${c.activity ? `, ${c.activity}` : ""}.`,
      citations: [{ ref: "T", type: "tracker", label: `${c.name}: away${c.place ? ` at ${c.place}` : ""}`, seq: c.lastSeq }],
      fix: `${c.name} isn't here and can't speak or act in this scene (unless they arrive first, or it's a call or a letter).`,
      by: "rules",
    });
  }
  return out;
}

/** Someone the trackers already have in the scene arriving again ("Shauna comes in" when Shauna's been by the fire all along). */
export function arrivesAgainRule(text: string, st: WorldState): Found[] {
  // A reply that jumps ahead can bring people in anew.
  const reply = cleanText(text);
  if (/\b(later|next (?:morning|day|evening)|hours? (?:later|pass(?:ed)?)|the following|by (?:dawn|morning|nightfall|evening)|overnight)\b/i.test(reply)) return [];
  const out: Found[] = [];
  const sents = sentences(reply);
  for (const c of Object.values(st.chars)) {
    if (c.isUser || c.dead || (c.tier !== "spot" && c.tier !== "peri")) continue;
    const i = arrival(sents, c);
    if (i < 0) continue;
    // Leaving first and coming back is fine.
    const left = new RegExp(`\\b(?:${namesRe(c)})\\b[^.!?]{0,40}\\b(?:leaves?|left|goes? out|went out|steps? out(?:side)?|stepped out(?:side)?|walks? out|walked out|heads? out|headed out|slips? out|slipped out)\\b`, "i");
    if (sents.slice(0, i).some((s) => left.test(s))) continue;
    out.push({
      kind: "nothere",
      severity: "major",
      claim: sents[i]!.trim(),
      conflict: `${c.name} is already in this scene${c.activity ? ` (${c.activity})` : ""}; they can't arrive again.`,
      citations: [{ ref: "T", type: "tracker", label: `${c.name}: here${st.place.length ? ` at ${st.place.at(-1)}` : ""}`, seq: c.lastSeq }],
      fix: `${c.name} is already here${st.place.length ? ` in ${st.place.at(-1)}` : ""}; don't have them arrive (unless they leave first).`,
      by: "rules",
    });
  }
  return out;
}

// ---------- the clock backwards ----------

const FLASHBACK = /\b(remember(?:s|ed)?|recall(?:s|ed)?|years ago|back then|flashback|that morning|earlier(?: that| today)?|yesterday|last night|had been|used to)\b/i;
const FORWARD = /\b(later|next (?:morning|day|evening|night)|the following|tomorrow|overnight|hours? (?:later|pass(?:ed)?)|by (?:dawn|morning|nightfall|evening|noon))\b/i;
const WORDNUM: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, noon: 12, midnight: 0 };

/** The clock times a sentence states, as minutes of the day: every reading ("three" is 3:00 or 15:00). */
export function statedTimes(s: string): number[][] {
  const out: number[][] = [];
  for (const m of s.matchAll(/\b(\d{1,2}):(\d{2})\s*(am|pm|a\.m\.|p\.m\.)?/gi)) {
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (h > 23 || min > 59) continue;
    const ap = m[3]?.toLowerCase()[0];
    out.push(ap ? [((h % 12) + (ap === "p" ? 12 : 0)) * 60 + min] : h > 12 ? [h * 60 + min] : [h * 60 + min, ((h + 12) % 24) * 60 + min]);
  }
  for (const m of s.matchAll(/\b(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s*(o'clock|o’clock|am|pm|a\.m\.|p\.m\.)/gi)) {
    const h = WORDNUM[m[1]!.toLowerCase()] ?? Number(m[1]);
    if (!h || h > 12) continue;
    const ap = m[2]!.toLowerCase()[0];
    out.push(ap === "a" ? [(h % 12) * 60] : ap === "p" ? [((h % 12) + 12) * 60] : [(h % 12) * 60, ((h % 12) + 12) * 60]);
  }
  if (/\b(?:at|by|past|after)\s+midnight\b/i.test(s)) out.push([0]);
  if (/\b(?:at|by)\s+noon\b/i.test(s)) out.push([720]);
  return out;
}

/** A reply that says it's earlier in the day than the story clock, with nothing marking a flashback. */
export function clockBackRule(text: string, minutes: number | null): Found[] {
  if (minutes == null) return [];
  const reply = cleanText(text);
  if (FORWARD.test(reply)) return [];
  const now = ((minutes % 1440) + 1440) % 1440;
  for (const s of sentences(reply)) {
    if (FLASHBACK.test(s)) continue;
    for (const readings of statedTimes(s)) {
      // Earlier by more than an hour under every reading, and not just after midnight.
      if (readings.every((t) => t < now - 60) && now >= 120) {
        const fmt = (n: number) => `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
        return [
          {
            kind: "clockback",
            severity: "minor",
            claim: s.trim(),
            conflict: `The story clock says ${fmt(now)}; this puts it at ${readings.map(fmt).join(" or ")}, earlier the same day, with nothing saying it's a memory.`,
            citations: [{ ref: "T", type: "tracker", label: `story time ${fmt(now)}` }],
            fix: `It's ${fmt(now)} now; don't put the time back (unless it's clearly a memory).`,
            by: "rules",
          },
        ];
      }
    }
  }
  return [];
}

// ---------- planning left in ----------

const PLAN_LINE = /^\s*(?:<\/?(?:think|thinking|plan|reasoning)>|(?:\*\*|#+\s*)?(?:NOW|SEAL|KNOW|MINDS|WORLD|MOVE|RISK|VOICE|STOP RULE|TIER)(?:\*\*)?\s*[—–:-]|\[BEFORE YOU WRITE|\[OUTPUT\]|[-*]\s*\[[ x]\]\s|(?:step|beat)\s*\d+\s*[:.)-]|(?:plan|outline|checklist|notes? to self)\s*:)/i;

/** A reasoning tag, a planning-pass heading or a checklist line left in the story. */
export function planningRule(text: string): Found[] {
  const hits = text.split("\n").filter((l) => PLAN_LINE.test(l));
  if (!hits.length) return [];
  return [
    {
      kind: "planning",
      severity: hits.length > 1 ? "major" : "minor",
      claim: hits[0]!.trim().slice(0, 240),
      conflict: `Planning was left in the story${hits.length > 1 ? ` (${hits.length} lines)` : ""}.`,
      citations: [{ ref: "R", type: "card", label: "Only the story goes on the page" }],
      fix: "Leave planning out of the reply: only the story.",
      by: "rules",
    },
  ];
}

SLIPS.push(
  {
    id: "nothere",
    label: "Not in the scene",
    description: "Someone speaking or acting while the trackers have them elsewhere, or arriving when they're already here.",
    phase: "reply",
    on: (c) => c.role === "assistant" && Boolean(c.state),
    run: (text, st) => (st ? [...notHereRule(text, st), ...arrivesAgainRule(text, st)] : []),
  },
  {
    id: "clockback",
    label: "Clock backwards",
    description: "A reply putting the time earlier than the story clock, outside a flashback.",
    phase: "reply",
    on: (c) => c.role === "assistant" && Boolean(c.state?.time),
    run: (text, st) => clockBackRule(text, st?.time?.minutes ?? null),
  },
  {
    id: "planning",
    label: "Planning left in",
    description: "A <think> tag, planning headings or checklist lines in the prose.",
    phase: "reply",
    on: (c) => c.role === "assistant",
    run: (text) => planningRule(text),
  },
  {
    // The helper model's part: it reads this switch (checker.ts) and runs no rules of its own.
    id: "past",
    label: "Invented past",
    description: "Claims about earlier events the memory doesn't hold (the helper model, when it checks).",
    phase: "reply",
    on: (c) => c.role === "assistant" && c.continuity,
    run: () => [],
  },
  {
    // Rules pick the sentences, the helper reads them (ties.ts, run by checker.ts).
    id: "ties",
    label: "Family ties",
    description: "Who is whose ancestor, and who knew them, against the memories that set it up (the helper model, only when a reply names such a tie).",
    phase: "reply",
    on: (c) => c.role === "assistant" && c.continuity,
    run: () => [],
  },
  {
    // docs/20 Part 3: rules find the retelling and its source, the helper compares them (retell.ts, run by checker.ts).
    id: "retell",
    label: "Retold past",
    description: "A character telling something that already happened at another time or place, or with other words, against the message it tells (rules, then the helper model when a reply retells something).",
    phase: "reply",
    on: (c) => c.role === "assistant" && c.continuity,
    run: () => [],
  },
);

// ---------- the next turn hears the last reply's slips ----------

registerLane("slips", (ctx) => {
  if (ctx.kind !== "story" && ctx.kind !== "continue") return null;
  // The last reply (the one being swiped, or the one before a new reply).
  const last = ctx.excludeMessageId
    ? { id: ctx.excludeMessageId }
    : one<{ id: string }>("SELECT id FROM messages WHERE chat_id = ? AND role = 'assistant' AND deleted_at IS NULL ORDER BY seq DESC LIMIT 1", ctx.chatId);
  if (!last) return null;
  const flags = all<FlagRow>("SELECT * FROM continuity_flags WHERE message_id = ? AND status = 'open'", last.id);
  const open = flags.flatMap((f) => parseJson<Issue[]>(f.issues, [])).filter((i) => !i.dismissed && i.kind !== "puppet");
  if (!open.length) return null;
  const fixes = [...new Set(open.map((i) => i.fix))].slice(0, 6);
  return lane("slips", null, `${ctx.excludeMessageId ? "The take being replaced" : "The last reply"} slipped; don't repeat it:\n${fixes.map((f) => `- ${f}`).join("\n")}`, { depth: 0 });
});

// ---------- "Make it a lesson" ----------

/** A finding kept as a lesson for this story (and, from now on, checked as one). */
export function issueToLesson(flagId: string, issueId: string) {
  const f = one<FlagRow>("SELECT * FROM continuity_flags WHERE id = ?", flagId);
  if (!f) throw notFound("Check not found");
  const issue = parseJson<Issue[]>(f.issues, []).find((i) => i.id === issueId);
  if (!issue) throw notFound("Issue not found");
  const subject = issue.conflict.match(/^(.+?) (?:is dead|has |doesn't know|isn't in this scene)/)?.[1];
  return addLesson(f.chat_id, { text: issue.fix, why: `From a note on a reply: ${issue.conflict}`.slice(0, 300), messageId: f.message_id, from: "flag", slip: { kind: issue.kind, ...(subject ? { subject } : {}) } });
}
