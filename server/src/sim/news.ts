import type { Op, WorldState } from "../trackers/types";
import { chanceIn } from "./dice";
import type { RActor, Roster } from "./roster";
import type { NewsHop } from "./types";

/**
 * News off the page (ALMANAC 09 §8): big facts travel person to person along ties, with delays
 * and distortion. Nobody acts on news that hasn't reached them; secrets don't spread from
 * their keepers; nobody passes on news about themselves. News about your character or the main
 * one stays on the page (who finds out about them is the story's to tell), and news about
 * someone only reaches people who know them.
 */
const BIG = /\b(alive|back from the dead|came back|is back|returned|died|dead|killed|murder\w*|pregnan\w*|married|engaged|broke up|divorc\w*|arrested|in jail|escaped|betray\w*|stole|fired|quit|left town|moved away|attack\w*|raid\w*|fire\b|burned|hurt|hospital|missing|kidnapp\w*|exposed|secret|affair|lied|engaged|kissed|dating|together)\b/i;
const HAS = new Set(["knows", "believes", "suspects"]);

function contact(a: RActor, b: RActor, tech: string): { c: number; medium: string } {
  const aw = (a.where ?? []).join(" › ").toLowerCase();
  const bw = (b.where ?? []).join(" › ").toLowerCase();
  if (aw && aw === bw) return { c: 1, medium: "in person" };
  if (a.reach !== "far" && b.reach !== "far" && a.reach !== "none" && b.reach !== "none") return { c: 0.6, medium: "in person" };
  const medium = tech === "modern" || tech === "future" ? "by phone" : tech === "fantasy" ? "by letter" : "by letter";
  return { c: 0.3, medium };
}

export function spreadNews(o: { state: WorldState; roster: Roster; hours: number; rand: () => number; tech: string; max?: number; now: number }): { hops: NewsHop[]; ops: Op[] } {
  const hops: NewsHop[] = [];
  const ops: Op[] = [];
  const max = o.max ?? 4;
  const pairsDone = new Set<string>();
  const actors = [...o.roster.actors.values()];
  const first = (name: string) => name.toLowerCase().split(" ")[0]!;
  const named = (statement: string) => {
    const words = new Set(statement.toLowerCase().match(/[\p{L}\p{N}'’-]+/gu) ?? []);
    return actors.filter((a) => first(a.name).length > 1 && words.has(first(a.name)));
  };
  const facts = Object.values(o.state.facts).filter((f) => BIG.test(f.statement));
  for (const f of facts) {
    const about = named(f.statement);
    if (about.some((a) => a.isUser || a.isMain)) continue;
    const secretKeepers = new Set(f.secret?.keepers ?? []);
    for (const [holderId, stance] of Object.entries(f.stances)) {
      if (hops.length >= max) break;
      if (!HAS.has(stance.status)) continue;
      const holder = o.roster.actors.get(holderId);
      if (!holder || holder.dead || holder.isUser || holder.ring === "onstage") continue;
      if (secretKeepers.has(holderId)) continue;
      for (const [otherId, strength] of holder.ties) {
        if (hops.length >= max) break;
        const other = o.roster.actors.get(otherId);
        if (!other || other.dead || other.isUser || other.ring === "onstage") continue;
        if (other.knows.has(f.key) && other.knows.get(f.key) !== "unaware") continue;
        // News about yourself isn't passed on, and isn't news to you.
        if (f.statement.toLowerCase().includes(other.name.toLowerCase().split(" ")[0]!) || f.statement.toLowerCase().includes(holder.name.toLowerCase().split(" ")[0]!)) continue;
        if (f.secret?.from.includes(otherId)) continue;
        // Bob never met Buffy: news of her means nothing to him.
        if (about.some((a) => a.id !== holderId && !other.ties.has(a.id))) continue;
        const pair = [holderId, otherId].sort().join("|");
        if (pairsDone.has(pair)) continue;
        const { c, medium } = contact(holder, other, o.tech);
        const talk = holder.guarded ? 0.2 : 1;
        if (o.rand() >= chanceIn(0.1 * strength * c * talk, o.hours)) continue;
        pairsDone.add(pair);
        const secondHand = /told|heard|rumou?r/.test(stance.route ?? "");
        const distorted = secondHand && o.rand() < 0.25;
        const status = distorted ? "believes" : "knows";
        const hop: NewsHop = { at: o.now, fact: f.key, statement: f.statement, from: holder.name, to: other.name, medium, ...(distorted ? { distorted: "a garbled version" } : {}) };
        hops.push(hop);
        other.knows.set(f.key, status);
        ops.push({
          op: "know",
          subject: other.name,
          args: { fact: f.statement, key: f.key, status, truth: distorted ? "partial" : f.truth, route: `told by ${holder.name}, ${medium}${distorted ? " (garbled)" : ""}` },
          cause: `news off the page`,
          raw: `know ${other.name}: #${f.key} | told by ${holder.name}, ${medium} · ${status}`,
        });
      }
    }
  }
  return { hops, ops };
}
