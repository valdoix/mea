import type { Fact } from "../trackers/types";
import { canAct, CARRIES_NEWS, type RActor, type Tie, TIE_STRENGTH, TIE_WORDS } from "./roster";

/**
 * The one gate for the world off the page (docs/21 Part 4). Every engine feature asks it before
 * someone acts or reaches someone else, so a rule lands once and holds everywhere. It's an
 * allowlist: each clause has to pass, and what isn't on record (a place, a tie, being in touch)
 * doesn't pass. The answer carries its reasons, for the why under a change.
 */
export interface Gate {
  ok: boolean;
  /** What passed (when ok), or the clause that didn't. */
  why: string[];
}
export interface Contact extends Gate {
  medium?: string;
  /** How easily it happens, 0..1 (in person 1 or 0.6, by phone 0.5, by letter 0.3). */
  c?: number;
}

/** news: pass on a fact · call: reach someone in the scene by phone or letter · meet: be pulled into their subplot · ripple: act for someone they're close to. */
export type How = "news" | "call" | "meet" | "ripple";

const no = (why: string): Contact => ({ ok: false, why: [why] });

/** Why someone can't act off the page now, or null when they can. */
function unable(a: RActor): string | null {
  if (a.isUser) return "you act on the page";
  if (a.dead) return `${a.name} is dead`;
  if (a.flag === "out") return `you left ${a.name} out`;
  if (!canAct(a)) return `${a.name} can't act (${a.standing})`;
  return null;
}

/** Whether someone can do something of their own off the page now: lead a subplot, start one. */
export function canLead(a: RActor | undefined): Gate {
  if (!a) return no("nobody the world knows");
  const u = unable(a);
  if (u) return no(u);
  if (a.flag === "hold") return no(`you put ${a.name}'s doings on hold`);
  // Someone on the page acts on the page: their subplots wait until they leave the scene.
  if (a.ring === "onstage") return no(`${a.name} is in the scene`);
  return { ok: true, why: [`${a.name} can act`] };
}

/** Near enough to meet: both placed (by you, the story or the lore), both in the story's town or closer. */
function near(a: RActor, b: RActor): boolean {
  const placed = (x: RActor) => x.basis.where !== "none" || x.ring === "onstage";
  const close = (x: RActor) => x.reach === "here" || x.reach === "building" || x.reach === "district" || x.reach === "town";
  return placed(a) && placed(b) && close(a) && close(b);
}
const placeWords = (x: RActor) => (x.where?.length ? `${x.name} at ${x.where.join(" › ")}` : `${x.name}'s place not known`);

/** How two people get word to each other, if they can: in person when both are placed near, else what the times allow. */
function medium(a: RActor, b: RActor, tech: string): Contact {
  const aw = (a.where ?? []).join(" › ").toLowerCase();
  if (aw && aw === (b.where ?? []).join(" › ").toLowerCase()) return { ok: true, why: [`place: both at ${a.where!.join(" › ")}`], medium: "in person", c: 1 };
  if (near(a, b)) return { ok: true, why: [`place: near each other (${placeWords(a)}; ${placeWords(b)})`], medium: "in person", c: 0.6 };
  if (tech === "modern" || tech === "future") return { ok: true, why: [`place: not known to be near (${placeWords(a)}; ${placeWords(b)}), so by phone`], medium: "by phone", c: 0.5 };
  // A letter needs somewhere to go.
  if (b.basis.where !== "none" && b.where?.length) return { ok: true, why: [`place: apart (${placeWords(a)}; ${placeWords(b)}), so by letter`], medium: "by letter", c: 0.3 };
  return no(`place: not known where ${b.name} is, and no way to reach them`);
}

const tieLine = (t: Tie) => `tie: ${TIE_WORDS[t.type]}${t.inTouch ? ", in touch" : ", not in touch"}${t.by === "guess" ? " (assumed)" : ""}: ${t.why}`;

/** Whether `from` can reach `to` this way now, how, and why (or why not). */
export function reach(from: RActor | undefined, to: RActor | undefined, how: How, o: { tech: string; fact?: Fact; about?: RActor[] } = { tech: "modern" }): Contact {
  if (!from || !to) return no("nobody the world knows");
  if (from.id === to.id) return no("the same person");
  const uf = unable(from);
  if (uf) return no(uf);
  const tie = from.tieKind.get(to.id);
  if (!tie) return no(`tie: ${from.name} and ${to.name} aren't tied`);

  if (how === "news") {
    // The leads' talk is the story's to tell, even when they've stepped out of the scene; nobody in the scene hears it off the page.
    for (const x of [from, to]) {
      if (x.isMain) return no(`${x.name} is the main character: the story tells what they hear and say`);
      if (x.isUser) return no("you hear things on the page");
      if (x.ring === "onstage") return no(`${x.name} is in the scene`);
    }
    const ut = unable(to);
    if (ut) return no(ut);
    if (!CARRIES_NEWS.has(tie.type)) return no(`${tieLine(tie)}: that doesn't pass news on`);
    if (!tie.inTouch) return no(`${tieLine(tie)}`);
    const f = o.fact;
    if (f) {
      if (f.secret?.keepers.includes(from.id)) return no(`${from.name} keeps it secret`);
      if (f.secret?.from.includes(to.id)) return no(`it's kept from ${to.name}`);
      const about = o.about ?? [];
      if (about.some((a) => a.isUser || a.isMain)) return no("it's about the leads: the story tells who finds out");
      if (about.some((a) => a.id === from.id || a.id === to.id)) return no("it's about one of them");
      // Bob never met Buffy: news of her means nothing to him.
      const stranger = about.find((a) => !to.tieKind.has(a.id));
      if (stranger) return no(`${to.name} doesn't know ${stranger.name}`);
    }
    const m = medium(from, to, o.tech);
    return m.ok ? { ...m, why: [tieLine(tie), ...m.why] } : m;
  }

  if (how === "call") {
    if (!CARRIES_NEWS.has(tie.type) || !tie.inTouch) return no(tieLine(tie));
    return { ok: true, why: [tieLine(tie)] };
  }

  // meet / ripple: close enough to be pulled in, or to act for them. Knowing of someone, or knowing them once, isn't.
  if (how === "meet") {
    const ut = unable(to);
    if (ut) return no(ut);
  }
  if (how === "ripple" && from.ring === "onstage") return no(`${from.name} is in the scene`);
  if (TIE_STRENGTH[tie.type] < 2) return no(`${tieLine(tie)}: not close enough`);
  if (how === "ripple" && tie.type === "enemy") return no(`${tieLine(tie)}: they wouldn't act for them`);
  return { ok: true, why: [tieLine(tie)] };
}
