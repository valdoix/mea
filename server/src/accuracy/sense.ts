import { norm } from "../memory/entities";
import { cleanText } from "../memory/text";
import { knowledgeOf } from "../trackers/knowledge";
import { secretMatch, subjectName } from "../trackers/secretwords";
import type { WorldState } from "../trackers/types";
import type { Issue } from "./checker";

/**
 * docs/35 4.1: a rule's flag has to survive being read before you see it. "Buffy Summers doesn't know
 * this: Buffy asks Gabriel…" fails three ways: she's who it's about, the records don't say she's in the
 * dark, and the sentence shares no words with it. A flag that fails is dropped, and counted.
 */

type Found = Omit<Issue, "id">;

/** The rule version a stored flag was raised under: bumped when a rule changes enough that old flags should be read again (4.3). */
export const RULES_VERSION = 35;

const flat = (s: string) => norm(cleanText(s).replace(/[“”"*_]/g, "").replace(/\s+/g, " "));

/** Why a rule's flag doesn't hold up, or null when it does. */
export function senseOf(i: Found, o: { st: WorldState | null; reply: string }): string | null {
  if (i.by !== "rules") return null;
  // The claim is in the reply (a word, or the start of a sentence).
  const claim = flat(i.claim).slice(0, 60);
  if (claim && !flat(o.reply).includes(claim)) return "its claim isn't in the reply";
  const st = o.st;
  if (!st) return null;
  // A tracker citation names something the tracker has.
  const cite = i.citations[0];
  if (cite?.type === "tracker" && cite.label.startsWith("secret: ")) {
    const statement = cite.label.slice(8);
    const f = Object.values(st.facts).find((x) => x.statement === statement);
    if (!f) return "its secret isn't in the tracker";
    if (i.kind === "leak" && i.about) {
      const c = st.chars[i.about.id];
      if (!c) return "who it names isn't in the story";
      // Whoever it's said of is in on it.
      if (subjectName(f.statement, [c.name, c.name.split(/\s+/)[0]!, ...c.aliases])) return `${c.name} is who it's about`;
      const k = knowledgeOf(f, c.id);
      if (k.status === "knows" || k.status === "suspects") return `the records say ${c.name} ${k.status === "knows" ? "knows" : "suspects"} it (${k.why})`;
      if (i.severity === "major" && k.status !== "unaware") return `nothing says ${c.name} doesn't know it`;
      const names = new Set(Object.values(st.chars).flatMap((x) => [x.name, ...x.aliases]).flatMap((n) => norm(n).split(" ")));
      if (secretMatch(f.statement, i.claim, names).hits.length < 2) return "the sentence and the secret share too little";
    }
  }
  return null;
}

/** The flags that hold up, and the ones dropped with why. */
export function senseCheck<T extends Found>(issues: T[], o: { st: WorldState | null; reply: string }): { kept: T[]; dropped: { issue: T; why: string }[] } {
  const kept: T[] = [];
  const dropped: { issue: T; why: string }[] = [];
  for (const i of issues) {
    const why = senseOf(i, o);
    if (why) dropped.push({ issue: i, why });
    else kept.push(i);
  }
  return { kept, dropped };
}
