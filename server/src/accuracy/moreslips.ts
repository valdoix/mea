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

/** A known person speaking ("…," Joss says / Joss says, "…") while the trackers have them somewhere else. */
export function notHereRule(text: string, st: WorldState): Found[] {
  const out: Found[] = [];
  const away = Object.values(st.chars).filter((c) => !c.isUser && !c.dead && c.tier === "off");
  if (!away.length) return out;
  const reply = cleanText(text);
  for (const c of away) {
    const names = [c.name, ...c.aliases].filter((n) => n.length >= 2).map(esc);
    const re = new RegExp(`(?:["”]\\s*,?\\s*(?:${names.join("|")})\\s+(?:${SAY})\\b|\\b(?:${names.join("|")})\\s+(?:${SAY})\\s*,?\\s*["“])`, "i");
    const hit = sentences(reply).find((s) => re.test(s));
    if (!hit) continue;
    // Through a phone, a letter, a radio or a memory is fine.
    if (/\b(phone|call|line|radio|letter|text|message|voicemail|screen|recording|remember|recalled|dream)/i.test(hit)) continue;
    out.push({
      kind: "nothere",
      severity: "major",
      claim: hit.trim(),
      conflict: `${c.name} isn't in this scene${c.place ? ` (they're at ${c.place})` : ""}${c.activity ? `, ${c.activity}` : ""}.`,
      citations: [{ ref: "T", type: "tracker", label: `${c.name}: away${c.place ? ` at ${c.place}` : ""}`, seq: c.lastSeq }],
      fix: `${c.name} isn't here and can't speak in this scene (unless they arrive first, or it's a call or a letter).`,
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
    description: "Someone speaking while the trackers have them elsewhere.",
    phase: "reply",
    on: (c) => c.role === "assistant" && Boolean(c.state),
    run: (text, st) => (st ? notHereRule(text, st) : []),
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
