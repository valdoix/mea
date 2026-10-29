import type { Op, WorldState } from "../trackers/types";
import { chanceIn } from "./dice";
import { canAct, type RActor, type Roster } from "./roster";
import type { NewsHop } from "./types";

/**
 * News off the page (ALMANAC 09 §8): big facts travel person to person along ties, with delays
 * and distortion. Nobody acts on news that hasn't reached them; secrets don't spread from
 * their keepers; nobody passes on news about themselves. News about your character or the main
 * one stays on the page (who finds out about them is the story's to tell), as does anything
 * they'd tell or be told, and news about
 * someone only reaches people who know them. Only real ties carry it: a passing mention in
 * someone's lore ("her former lover", "once loved her in 1880") passes nothing on.
 */
const BIG = /\b(alive|back from the dead|came back|is back|returned|died|dead|killed|murder\w*|pregnan\w*|married|engaged|broke up|divorc\w*|arrested|in jail|escaped|betray\w*|stole|fired|quit|left town|moved away|attack\w*|raid\w*|fire\b|burned|hurt|in (?:the )?hospital|hospitali[sz]ed|missing|kidnapp\w*|exposed|secret|affair|lied|engaged|kissed|dating|together)\b/i;
const HAS = new Set(["knows", "believes", "suspects"]);

function contact(a: RActor, b: RActor, tech: string): { c: number; medium: string; why: string } {
  const aw = (a.where ?? []).join(" › ");
  const bw = (b.where ?? []).join(" › ");
  if (aw && aw.toLowerCase() === bw.toLowerCase()) return { c: 1, medium: "in person", why: `place: both at ${aw}` };
  const placed = (x: RActor, w: string) => (w ? `${x.name} at ${w}` : `${x.name}'s place not known, assumed ${x.reach}`);
  const places = `${placed(a, aw)}; ${placed(b, bw)}`;
  if (a.reach !== "far" && b.reach !== "far" && a.reach !== "none" && b.reach !== "none") return { c: 0.6, medium: "in person", why: `place: near each other (${places})` };
  const medium = tech === "modern" || tech === "future" ? "by phone" : tech === "fantasy" ? "by letter" : "by letter";
  return { c: 0.3, medium, why: `place: far apart (${places})` };
}

export function spreadNews(o: { state: WorldState; roster: Roster; hours: number; rand: () => number; tech: string; max?: number; now: number }): { hops: NewsHop[]; ops: Op[] } {
  const hops: NewsHop[] = [];
  const ops: Op[] = [];
  const max = o.max ?? 4;
  const pairsDone = new Set<string>();
  const actors = [...o.roster.actors.values()];
  const first = (name: string) => name.toLowerCase().split(" ")[0]!;
  const named = (statement: string) => {
    // "Gabriel's organization" is about Gabriel.
    const words = new Set((statement.toLowerCase().match(/[\p{L}\p{N}'’-]+/gu) ?? []).map((w) => w.replace(/['’]s?$/, "")));
    return actors.filter((a) => first(a.name).length > 1 && words.has(first(a.name)));
  };
  // "The thermostat hasn't moved since Joyce died" isn't news of a death: only the main clause counts.
  const facts = Object.values(o.state.facts).filter((f) => BIG.test(f.statement.replace(/\b(?:ever since|since|after|before|until|when)\b[^,;.]*/gi, "")));
  for (const f of facts) {
    const about = named(f.statement);
    if (about.some((a) => a.isUser || a.isMain)) continue;
    const secretKeepers = new Set(f.secret?.keepers ?? []);
    for (const [holderId, stance] of Object.entries(f.stances)) {
      if (hops.length >= max) break;
      if (!HAS.has(stance.status)) continue;
      const holder = o.roster.actors.get(holderId);
      // The main character's talk is the story's to tell, even when they've stepped out of the scene.
      // Nor do the dead, a pet, or someone you took out of the simulation.
      if (!holder || !canAct(holder) || holder.isMain || holder.ring === "onstage") continue;
      if (secretKeepers.has(holderId)) continue;
      for (const [otherId, strength] of holder.ties) {
        if (hops.length >= max) break;
        const other = o.roster.actors.get(otherId);
        if (!other || !canAct(other) || other.isMain || other.ring === "onstage") continue;
        // News goes to people you're close to, not to everyone your lore happens to name.
        if (strength < 2) continue;
        if (other.knows.has(f.key) && other.knows.get(f.key) !== "unaware") continue;
        // News about yourself isn't passed on, and isn't news to you.
        if (f.statement.toLowerCase().includes(other.name.toLowerCase().split(" ")[0]!) || f.statement.toLowerCase().includes(holder.name.toLowerCase().split(" ")[0]!)) continue;
        if (f.secret?.from.includes(otherId)) continue;
        // Bob never met Buffy: news of her means nothing to him.
        if (about.some((a) => a.id !== holderId && !other.ties.has(a.id))) continue;
        const pair = [holderId, otherId].sort().join("|");
        if (pairsDone.has(pair)) continue;
        const { c, medium, why: place } = contact(holder, other, o.tech);
        const talk = holder.guarded ? 0.2 : 1;
        const chance = chanceIn(0.1 * strength * c * talk, o.hours);
        if (o.rand() >= chance) continue;
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
          // docs/21 1.2: what the rules acted on, so a wrong guess shows on the chip.
          why: [
            `${holder.name} knew it: ${stance.route ?? "from the page"}`,
            `tie: ${holder.tieWhy.get(otherId) ?? "close"}`,
            place,
            `chance: ${Math.round(chance * 100)}% over ${Math.round(o.hours)} h${holder.guarded ? ` (${holder.name} is guarded)` : ""}`,
          ],
          raw: `know ${other.name}: #${f.key} | told by ${holder.name}, ${medium} · ${status}`,
        });
      }
    }
  }
  return { hops, ops };
}
