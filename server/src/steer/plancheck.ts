import { parsePlan } from "../../../shared/plan";
import { sentencesOf } from "../accuracy/promptcheck";
import { closedItems, doneMatcher, doneRecords } from "../memory/openlist";
import { contentWords } from "../memory/text";
import { topicCounts, topicScorer } from "../trackers/topics";
import type { Character, Fact, WorldState } from "../trackers/types";
import { BACK, clear, hhmm, retellSources, type Source, whenConflict } from "../accuracy/retell";

/**
 * The plan check (docs/19 Part 2): the plan's KNOW step says who knows what, and nothing checked
 * it. At #323 the plan said "Dawn doesn't know Buffy picked the socks" while the records had Dawn
 * told about them on the call, so the reply wrote them as news. Rules only, no model call:
 *
 * - "X doesn't know / hasn't been told / has no idea …" about a fact X knows (or believes);
 * - "X knows / found out / was told …" about a fact X doesn't know, or a secret kept from X.
 *
 * A claim is matched to a fact by what it's about (topics.ts), then by the stance of the person it
 * names. Strong: the claim says most of the fact's own words. Otherwise it only touches the fact,
 * and the correction says so ("write her as knowing that; the rest is the plan's call").
 */
export interface PlanFinding {
  /** The plan's sentence. */
  claim: string;
  who: string;
  /** What the plan says about them: that they don't know, or that they do; or that something done is still to come. */
  says: "unaware" | "knows" | "pending";
  fact: string;
  /** The stance the records have, with how and when. */
  status: string;
  route?: string;
  seq: number;
  strong: boolean;
}

const LEAD = String.raw`(?:^|(?<=[;:—–,(]\s*)|(?<=\b(?:but|and|while|so)\s+))`;
const NEG = String.raw`(?:still\s+|also\s+|yet\s+)?(?:doesn['’]t|does not|don['’]t|didn['’]t|can['’]t|cannot)\s+(?:yet\s+)?know|hasn['’]t\s+(?:been\s+told|heard|learned|found\s+out|seen)|has\s+not\s+been\s+told|has\s+no\s+idea|is\s+(?:still\s+)?unaware|isn['’]t\s+aware|is\s+not\s+aware|never\s+(?:learned|found\s+out|heard)|is\s+in\s+the\s+dark`;
const POS = String.raw`(?:already\s+|also\s+|now\s+)?(?:knows|has\s+learned|learned|found\s+out|was\s+told|has\s+been\s+told|heard|realizes|realises|is\s+aware)`;
const TAIL = String.raw`(?:\s+(?:that|about|of|how|why|who|what|where|when|if|whether))?[\s:,—–-]*(.+)`;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const KNOWING = new Set(["knows", "believes"]);
const STATUS: Record<string, string> = { knows: "knows", believes: "believes", suspects: "suspects", doubts: "doubts", wrong: "has it wrong", unaware: "doesn't know", heard: "has probably heard" };

/** The plan's knowledge sentences: its KNOW step, or the whole pass when it has no steps. */
function knowText(plan: string) {
  const p = parsePlan(plan);
  const know = p.steps.filter((s) => s.key === "KNOW").map((s) => s.text);
  return know.length ? know.join("\n") : p.steps.length ? "" : plan;
}

export function checkPlan(st: WorldState | null | undefined, plan: string | null | undefined, focus?: string): PlanFinding[] {
  if (!st || !plan?.trim()) return [];
  const text = knowText(plan);
  if (!text.trim()) return [];
  const people = Object.values(st.chars).filter((c) => !c.isUser);
  const names = (c: Character) => [...new Set([c.name, c.name.split(/\s+/)[0]!, ...c.aliases].filter((n) => n.length >= 3))];
  const alt = people.flatMap(names).sort((a, b) => b.length - a.length).map(esc).join("|");
  if (!alt) return [];
  const who = (n: string) => people.find((c) => names(c).some((x) => x.toLowerCase() === n.toLowerCase()));
  const neg = new RegExp(`${LEAD}(${alt})\\s+(?:${NEG})${TAIL}`, "iu");
  const pos = new RegExp(`${LEAD}(${alt})\\s+(?:${POS})${TAIL}`, "iu");
  const facts = Object.values(st.facts);
  const scorer = topicScorer(st, facts.map((f) => f.statement));
  const beat = focus?.trim() ? topicCounts(st, focus) : null;
  const out: PlanFinding[] = [];
  for (const s of sentencesOf(text)) {
    for (const [re, says] of [[neg, "unaware"], [pos, "knows"]] as const) {
      const m = s.match(re);
      const c = m && who(m[1]!);
      if (!c) continue;
      // Up to the next claim: "…the socks; Spike doesn't know…", "knows she's alive · does NOT know heaven", "knows X, doesn't know Y".
      const about = m[2]!.split(new RegExp(`[;.·•|]|,\\s*(?:but\\s+|and\\s+)?(?:(?:${alt})\\s+)?(?:${NEG}|${POS}|does\\s+not)\\b`, "iu"))[0]!.trim();
      const want = topicCounts(st, about);
      if (!want.size) continue;
      const hits = facts
        .map((f, i) => ({ f, score: scorer.score(want, scorer.words[i]!) }))
        .filter((h) => h.score > 0 && h.score >= scorer.enough && clash(h.f, c.id, says))
        .sort((a, b) => b.score - a.score);
      const best = hits[0];
      if (!best || out.some((o) => o.who === c.name && o.fact === best.f.statement)) continue;
      const stance = best.f.stances[c.id];
      const own = [...contentWords(best.f.statement)].filter((w) => !names(c).some((n) => n.toLowerCase() === w));
      const said = contentWords(about);
      const strong = own.length > 0 && own.filter((w) => said.has(w)).length / own.length >= 0.5;
      // A claim that only touches a fact ("the socks' origin" and "era of origin") counts when the beat is about it.
      if (!strong && !(beat && scorer.score(beat, scorer.words[facts.indexOf(best.f)]!) >= scorer.enough)) continue;
      out.push({ claim: s, who: c.name, says, fact: best.f.statement, status: stance?.status ?? "unaware", route: stance?.route ?? (best.f.secret ? "kept from them" : undefined), seq: stance?.seq ?? best.f.firstSeq, strong });
    }
  }
  return out;
}

/** Whether the records say otherwise about this person: they know it, or it's kept from them. */
function clash(f: Fact, id: string, says: "unaware" | "knows") {
  const s = f.stances[id]?.status;
  if (says === "unaware") return KNOWING.has(s ?? "") && f.stances[id]?.route !== "keeps it" ? true : Boolean(f.secret?.keepers.includes(id));
  return s === "unaware" || s === "wrong" || Boolean(f.secret?.from.includes(id) && !KNOWING.has(s ?? ""));
}

/** A plan line with something still to come, and one that knows it's past. */
const AHEAD = /\b(?:tonight|tomorrow|still|due|pending|waiting|waits|unsaid|not yet|hasn['’]t)\b/i;
const PAST = /\b(?:already|again|since|anymore|no longer)\b/i;

/**
 * A plan that waits for what the story has done. #629's said "tonight holds her promised whole-word
 * 'I love you' after Dawn sleeps", and "don't stage the confession early": she'd said it the night
 * before. A line is matched against the open items later records closed, in their own wording,
 * since a plan built on a stale list repeats it. Only a scene's word closes it: a kept promise can
 * come round again (tacos every Friday), and something still open that the line also fits keeps it.
 */
export function pendingDone(chatId: string, st: WorldState | null | undefined, plan: string | null | undefined): PlanFinding[] {
  if (!st || !plan?.trim()) return [];
  const items = closedItems(chatId, doneMatcher(st, doneRecords(chatId, st))).filter((i) => !i.closed.strict);
  if (!items.length) return [];
  const match = doneMatcher(st, items.map((i) => ({ ...i, strict: true })));
  const stillOpen = doneMatcher(st, Object.values(st.obligations).filter((o) => o.status === "open" || o.status === "due").map((o) => ({ text: o.what, seq: 1 })));
  const out: PlanFinding[] = [];
  for (const s of sentencesOf(plan)) {
    if (!AHEAD.test(s) || PAST.test(s) || stillOpen(s, 0)) continue;
    const hit = match(s, 0);
    const item = hit && items.find((i) => i.text === hit.text);
    if (!item || out.some((o) => o.fact === item.closed.text)) continue;
    out.push({ claim: s.trim(), who: "", says: "pending", fact: item.closed.text, status: "done", seq: item.closed.seq, strong: true });
  }
  return out.slice(0, 2);
}

/** What the writer is told: where the plan and the records disagree, the records win. */
export function planCorrection(findings: PlanFinding[]): string {
  if (!findings.length) return "";
  const lines = findings.slice(0, 4).map((f) => {
    if (f.says === "pending") return `- The plan says «${f.claim}». The records: already done, ${f.fact} (#${f.seq}). That's the past: nobody waits for it, plans it or promises it again.`;
    const how = [f.route, f.seq ? `#${f.seq}` : ""].filter(Boolean).join(", ");
    const records = `${f.who} ${STATUS[f.status] ?? f.status}: ${f.fact}${how ? ` (${how})` : ""}`;
    if (f.says === "knows") return `- The plan says «${f.claim}». The records: ${records}. ${f.who} can't act on it in this reply.`;
    return f.strong
      ? `- The plan says «${f.claim}». The records: ${records}. Write ${f.who} as knowing it.`
      : `- The plan says «${f.claim}». The records: ${records}. Write ${f.who} as knowing that much; anything beyond it is the plan's call.`;
  });
  return `[PLAN CORRECTION — where the plan and the records disagree about who knows what or what has happened, the records are right]\n${lines.join("\n")}`;
}

// ---------- docs/20 Part 4: a plan that retells answers to the record ----------

/** Plan lines that have someone tell what already happened: a word that points back, or a story told. */
const RETELLS = /\b(?:retell|retells|retelling|reenact|reenacts|re-enacts|recount|recounts|recalls|reminisces|tells? (?:\w+ ){0,3}(?:about|the story|the whole story)|delivers? the (?:promised )?(?:\w+ )?story|the (?:\w+ )?story (?:of|about)|story time|throws? \w+ under the bus)\b/i;
/** How much of each record passage the writer reads. */
const RECORD_CHARS = 420;

export interface PlanRecord {
  /** The plan's line. */
  claim: string;
  /** The record it retells: the promise's moment, or the one clear match. */
  sources: Source[];
  /** A time word the record can't fit ("not this morning: it happened yesterday at 20:33"). */
  when: string | null;
}

/**
 * What a plan retells, found in the record. Told "Buffy reenacts the morning: Gabriel asking
 * whether he should be jealous of Spike", the writer set the question at the faucet; the record
 * has it asked at the curb, by Gabriel's car, in other words (#466). Rules only: the passages a
 * promise to tell it was made in, or the one passage that clearly matches, go under the plan.
 */
export function planRecords(chatId: string, st: WorldState | null | undefined, plan: string | null | undefined, seq: number): PlanRecord[] {
  if (!st || !plan?.trim()) return [];
  const now = st.time?.minutes ?? null;
  const out: PlanRecord[] = [];
  for (const s of sentencesOf(plan)) {
    if (out.length >= 2) break;
    // A bare "earlier" in a plan is an adjective as often as not ("eating his earlier plate").
    const back = s.match(BACK)?.[1]?.toLowerCase();
    if (!RETELLS.test(s) && (!back || back === "earlier")) continue;
    const when = s.match(/\b(this morning|this afternoon|this evening|last night|yesterday)\b/i)?.[1]?.toLowerCase() ?? null;
    const found = retellSources(chatId, st, seq, { text: s, when });
    const promised = found.filter((x) => x.promised).sort((a, b) => a.seq - b.seq);
    // Without a promise to go by, only a line that says when gets the passage that clearly matches: its time can be checked.
    const sources = promised.length ? promised : when && clear(found) ? found.slice(0, 1) : [];
    if (!sources.length || out.some((o) => o.sources.some((x) => sources.some((y) => y.seq === x.seq)))) continue;
    const at = sources.at(-1)!;
    out.push({ claim: s.trim(), sources, when: whenConflict(when, at.minutes, now) });
  }
  return out;
}

/** What the writer reads under the plan: the record of what it retells, which outranks the plan's version. */
export function planRecordText(records: PlanRecord[], names: { char: string; user: string }): string {
  if (!records.length) return "";
  const at = (s: Source) => [s.minutes != null ? hhmm(s.minutes) : null, s.place].filter(Boolean).join(", ");
  const lines = records.map((r) => {
    const passages = r.sources.map((s) => `  #${s.seq}${at(s) ? ` (${at(s)})` : ""} ${s.role === "user" ? names.user : names.char}: ${s.passage.length > RECORD_CHARS ? `${s.passage.slice(0, RECORD_CHARS - 1).trimEnd()}…` : s.passage}`);
    return [`- The plan: «${r.claim}»${r.when ? ` Not as the plan has it: ${r.when}.` : ""}`, ...passages].join("\n");
  });
  return `[THE RECORD — the plan has someone tell what already happened. Tell it as it happened here: the place, the time, the order and the words said. Where the plan's version differs, the record is right]\n${lines.join("\n")}`;
}
