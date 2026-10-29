import { mentions } from "../trackers/mentions";
import type { Fact, Op, WorldState } from "../trackers/types";
import { chanceIn } from "./dice";
import { reach } from "./reach";
import { type Roster, TIE_STRENGTH } from "./roster";
import type { NewsHop } from "./types";

/**
 * News off the page (ALMANAC 09 §8): big facts travel person to person along ties, with delays
 * and distortion. Who can tell whom is the gate's to say (reach.ts, docs/21 Part 4): in-touch
 * ties that talk, never the leads, secrets kept from their keepers' hands, nothing about either
 * of them, and only to people who know whom it's about. Nobody acts on news that hasn't reached them.
 */
const BIG = /\b(alive|back from the dead|came back|is back|returned|died|dead|killed|murder\w*|pregnan\w*|married|engaged|broke up|divorc\w*|arrested|in jail|escaped|betray\w*|stole|fired|quit|left town|moved away|attack\w*|raid\w*|fire\b|burned|hurt|in (?:the )?hospital|hospitali[sz]ed|missing|kidnapp\w*|exposed|secret|affair|lied|engaged|kissed|dating|together)\b/i;
const HAS = new Set(["knows", "believes", "suspects", "heard"]);

export function spreadNews(o: { state: WorldState; roster: Roster; hours: number; rand: () => number; tech: string; max?: number; now: number }): { hops: NewsHop[]; ops: Op[] } {
  const hops: NewsHop[] = [];
  const ops: Op[] = [];
  const max = o.max ?? 4;
  const pairsDone = new Set<string>();
  const actors = [...o.roster.actors.values()];
  // docs/21 4.3: the fold read who a fact is about with the cast in hand (aliases, your name, "Gabriel's").
  // People only the lore knows aren't in the cast, so they're found by name here, the same way.
  const named = (f: Fact) =>
    actors.filter((a) => (a.ring === "unmet" || !f.about ? mentions(f.statement, a.name) : f.about.includes(a.id)));
  // "The thermostat hasn't moved since Joyce died" isn't news of a death: only the main clause counts.
  const facts = Object.values(o.state.facts).filter((f) => BIG.test(f.statement.replace(/\b(?:ever since|since|after|before|until|when)\b[^,;.]*/gi, "")));
  for (const f of facts) {
    const about = named(f);
    // About the leads: the story tells who finds out. (The gate says so too; this skips the whole fact at once.)
    if (about.some((a) => a.isUser || a.isMain)) continue;
    for (const [holderId, stance] of Object.entries(f.stances)) {
      if (hops.length >= max) break;
      if (!HAS.has(stance.status)) continue;
      const holder = o.roster.actors.get(holderId);
      if (!holder) continue;
      for (const [otherId, tie] of holder.tieKind) {
        if (hops.length >= max) break;
        const other = o.roster.actors.get(otherId);
        if (!other || (other.knows.has(f.key) && other.knows.get(f.key) !== "unaware")) continue;
        const pair = [holderId, otherId].sort().join("|");
        if (pairsDone.has(pair)) continue;
        const gate = reach(holder, other, "news", { tech: o.tech, fact: f, about });
        if (!gate.ok) continue;
        const medium = gate.medium!;
        const talk = holder.guarded ? 0.2 : 1;
        const chance = chanceIn(0.1 * TIE_STRENGTH[tie.type] * gate.c! * talk, o.hours);
        if (o.rand() >= chance) continue;
        pairsDone.add(pair);
        const secondHand = /told|heard|rumou?r/.test(stance.route ?? "");
        const distorted = secondHand && o.rand() < 0.25;
        // docs/21 5.1: off the page it's hearsay; the page makes it knowing (or not).
        const status = "heard";
        const hop: NewsHop = { at: o.now, fact: f.key, statement: f.statement, from: holder.name, to: other.name, medium, ...(distorted ? { distorted: "a garbled version" } : {}) };
        hops.push(hop);
        other.knows.set(f.key, status);
        ops.push({
          op: "know",
          subject: other.name,
          args: { fact: f.statement, key: f.key, status, truth: distorted ? "partial" : f.truth, route: `told by ${holder.name}, ${medium}${distorted ? " (garbled)" : ""}` },
          cause: `news off the page`,
          // docs/21 1.2: what the rules acted on, so a wrong guess shows on the chip.
          why: [`${holder.name} knew it: ${stance.route ?? "from the page"}`, ...gate.why, `chance: ${Math.round(chance * 100)}% over ${Math.round(o.hours)} h${holder.guarded ? ` (${holder.name} is guarded)` : ""}`],
          raw: `know ${other.name}: #${f.key} | told by ${holder.name}, ${medium} · ${status}`,
        });
      }
    }
  }
  return { hops, ops };
}
