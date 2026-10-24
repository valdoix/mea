import { parsePlan } from "../../../shared/plan";
import { sentencesOf } from "../accuracy/promptcheck";
import { contentWords } from "../memory/text";
import { topicCounts, topicScorer } from "../trackers/topics";
import type { Character, Fact, WorldState } from "../trackers/types";

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
  /** What the plan says about them: that they don't know, or that they do. */
  says: "unaware" | "knows";
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
const STATUS: Record<string, string> = { knows: "knows", believes: "believes", suspects: "suspects", doubts: "doubts", wrong: "has it wrong", unaware: "doesn't know" };

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

/** What the writer is told: where the plan and the records disagree, the records win. */
export function planCorrection(findings: PlanFinding[]): string {
  if (!findings.length) return "";
  const lines = findings.slice(0, 4).map((f) => {
    const how = [f.route, f.seq ? `#${f.seq}` : ""].filter(Boolean).join(", ");
    const records = `${f.who} ${STATUS[f.status] ?? f.status}: ${f.fact}${how ? ` (${how})` : ""}`;
    if (f.says === "knows") return `- The plan says «${f.claim}». The records: ${records}. ${f.who} can't act on it in this reply.`;
    return f.strong
      ? `- The plan says «${f.claim}». The records: ${records}. Write ${f.who} as knowing it.`
      : `- The plan says «${f.claim}». The records: ${records}. Write ${f.who} as knowing that much; anything beyond it is the plan's call.`;
  });
  return `[PLAN CORRECTION — where the plan and the records disagree about who knows what, the records are right]\n${lines.join("\n")}`;
}
