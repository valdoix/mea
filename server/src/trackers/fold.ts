import { sameThing } from "./things";
import { applySim } from "../sim/fold";
import { itemsAt } from "./belongings";
import type { SimOp } from "../sim/types";
import { formatStoryTime, leadingDuration, parseDuration, parseStoryTime, shortStoryTime } from "./clock";
import { loopId, repeats } from "./loops";
import { addCondition, conditionsIn, detectStamina, driftCharacter, type DriftNote, endsCondition, SEVERITY, severityOf } from "./drift";
import { castLabel, parseLine } from "./dsl";
import { PlaceBook, placeKey, type PlaceProfile } from "./places";
import { currentMembers, groupKey, kindOfGroup, possessiveAnchor } from "./groups";
import { bracketGroup, FIELD_WORD, familySurname, isGroupShape, looksLikePlace, passingName, sentenceNotPath } from "./whois";
import { mentions } from "./mentions";
import { applyPatch, type Change as PatchChange } from "./patch";
import type { Template } from "./schema";
import {
  AXES,
  type Axis,
  BIPOLAR_AXES,
  type Beat,
  type Bond,
  type Change,
  type Character,
  emptyWorld,
  type EventSource,
  type Group,
  type GroupKind,
  type KnowStatus,
  LADDER,
  TALKS,
  type Ladder,
  type Loop,
  METERS,
  type Meter,
  type Obligation,
  type Op,
  type Place,
  type Trait,
  type TraitKind,
  type Truth,
  type Verdict,
  type WorldState,
} from "./types";

/** One stored event: an op anchored to a message (and swipe), in order. */
export interface TrackerEvent {
  id: string;
  messageId: string | null;
  seq: number;
  source: EventSource;
  op: Op;
}

export type RomancePace = "off" | "slow" | "measured" | "fast" | "established";

export interface FoldConfig {
  userName: string;
  mainName: string;
  /** The model writes nothing about the user's inner life (ALMANAC: sealed persona). */
  sealedPersona: boolean;
  romance: RomancePace;
  /** strict: causeless bond/know/item/thread lines are rejected; lenient: accepted with a warning. */
  strictness: "strict" | "lenient";
  /** TRK-11: cap meter and bond moves per message. */
  limits: boolean;
  templates: Template[];
  /** Stamina kinds read from the card, persona and cast profiles (lower-case name → kind). */
  stamina?: Record<string, string>;
  /** Stable traits read from the card and persona (lower-case name → trait lines). */
  seedTraits?: Record<string, string[]>;
  /**
   * docs/19 2.3: leaks the checker flagged in a reply, still open. The reply's own ledger can't
   * teach that person that fact until the flag is dismissed or the sentence fixed.
   */
  held?: { messageId: string; who: string; text: string }[];
  /** docs/22 3.3: done loops a reply was flagged for having still to come. What it filed about them waits for the flag. */
  heldDone?: { messageId: string; loop: string }[];
  /**
   * docs/30 0.1: the story's factions (yours on the Story page, and the lore's). A faction's name in a
   * person line stands for its members, and is never a person itself.
   */
  factions?: { name: string; aliases?: string[]; members: string[]; kind?: GroupKind; source?: "you" | "lore"; /** docs/30 2.4: the lore's "Home" field: its members live there. */ home?: string }[];
  /**
   * docs/30 1.2: whether a group the story wrote becomes a faction by itself ("auto", the default: named in
   * two messages, or with its people named), only once you say so ("ask"), or never ("off").
   */
  groupsMode?: "auto" | "ask" | "off";
  /** docs/30 1.6: names you said aren't a group ("Not a group"): never adopted. */
  notGroups?: string[];
  /** docs/30 0.6: names you said are people after all ("It's a person" on the tidy notice). */
  people?: string[];
  /** docs/30 2.1: your edits to places (place_profiles), by place id. */
  placeProfiles?: Record<string, PlaceProfile>;
  /**
   * docs/32 Part 1: whether the story has these words by this message (its text, the card, the persona,
   * the lore). A name the tracker writes that the story never has makes nobody. Without it, any name does.
   */
  inStory?: (phrase: string, seq: number) => boolean;
}

export interface FoldResult {
  state: WorldState;
  /** Changes per message id (TRK-07). */
  changes: Record<string, Change[]>;
  verdicts: Record<string, Verdict>;
}

/**
 * A look line without the clauses that wear or hold an item ("bare-chested under Natalie's
 * leather jacket, back bandaged" less "Natalie's leather jacket" is "back bandaged").
 */
export function lookWithout(look: string, item: string): string {
  const words = (item.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).map((w) => w.replace(/'s$/, "")).filter((w) => w.length > 2 && w !== "the");
  const head = words.at(-1);
  if (!head) return look;
  const rest = words.slice(0, -1);
  const clauses = look.split(/\s*[,;]\s*/);
  const kept = clauses.filter((c) => {
    const cw = new Set((c.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).map((w) => w.replace(/s$/, "")));
    if (!cw.has(head.replace(/s$/, ""))) return true;
    return rest.length > 0 && !rest.some((w) => cw.has(w.replace(/s$/, "")));
  });
  return kept.length === clauses.length ? look : kept.join(", ");
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/#\d+.*$/, "")
    .replace(/[“”"']/g, "")
    .replace(/['’]s$/, "")
    .replace(/\s+/g, " ")
    .trim();
export const slug = (s: string) => norm(s).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "x";
const cap = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);
const clip = (s: string | undefined) => (s ?? "").trim();
const cut = (s: string, n: number) => (s.trim().length > n ? `${s.trim().slice(0, n - 1).trimEnd()}…` : s.trim());
/** Beats kept in the state: a few story days of replies. */
const MAX_BEATS = 400;
/** A name as the model wrote it, without a place or note: "Jackie Taylor@down-slope (finding James)" → "Jackie Taylor". */
export const personName = (s: string) => s.replace(/\s*@.*$/, "").replace(/\s*\([^)]*\)\s*$/, "").trim();

function lev(a: string, b: string, max = 2) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const d = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0]!;
    d[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const t = d[j]!;
      d[j] = Math.min(d[j]! + 1, d[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = t;
    }
  }
  return d[b.length]!;
}

/** Word overlap between two phrases (0–1), for matching threads and facts written differently. */
export function overlap(a: string, b: string) {
  const w = (s: string) => new Set(norm(s).split(/\W+/).filter((x) => x.length > 2 && !STOP.has(x)));
  const A = w(a);
  const B = w(b);
  if (!A.size || !B.size) return 0;
  let n = 0;
  for (const x of A) if (B.has(x)) n++;
  return n / Math.min(A.size, B.size);
}
const STOP = new Set("the and for with from that this was were has have had her his their them she they you are not but into onto over about".split(" "));

/** Words that say when or how a promise is kept, not what it is. */
const PROMISE_STOP = new Set("tell make give take every tonight tomorrow today after before later then again soon right going will promise".split(" "));
const stems = (s: string) => new Set((norm(s).match(/[a-z]{4,}/g) ?? []).filter((w) => !STOP.has(w) && !PROMISE_STOP.has(w)).map((w) => w.slice(0, 6)));

/**
 * A promise to one person said again to another: one names the other's listener ("tell Dawn about
 * the jealousy question" to Gabriel, "the jealousy story at dinner" to Dawn), and they share two
 * words besides. A shared listener is never enough: two promises to Gabriel both name Gabriel.
 */
export function restated(a: string, aTo: string, b: string, bTo: string) {
  const first = (n: string) => n.trim().split(/\s+/)[0]!.toLowerCase();
  if (!aTo || !bTo || first(aTo) === first(bTo)) return false;
  const names = (s: string) => new RegExp(`\\b${first(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
  if (!names(bTo).test(a) && !names(aTo).test(b)) return false;
  const drop = new Set([first(aTo), first(bTo)].map((w) => w.slice(0, 6)));
  const A = [...stems(a)].filter((w) => !drop.has(w));
  const B = stems(b);
  return A.filter((w) => B.has(w)).length >= 2;
}

const TRAIT_KIND: [TraitKind, RegExp][] = [
  ["eyes", /\beyes?\b/i],
  ["hair", /\bhair\b|\bbald\b|\bbraid|\bcurls\b/i],
  ["height", /\b(tall|short|petite|towering|\d+\s*(?:cm|ft|foot|feet)|height)\b/i],
  ["build", /\b(build|slender|slim|stocky|muscular|lean|broad|curvy|athletic|heavyset|wiry|lanky)\b/i],
  ["skin", /\b(skin|complexion|freckl|tan|pale|dark-skinned)\w*/i],
  ["scar", /\bscar/i],
  ["mark", /\b(tattoo|birthmark|piercing|mole|brand)\w*/i],
  ["voice", /\bvoice\b|\baccent\b/i],
  ["age", /\b(\d{1,3}|teen|twenties|thirties|forties|fifties|sixties)\b.*\b(years?|old|age)\b|\baged?\b/i],
  ["face", /\b(face|jaw|nose|lips|cheekbones|beard|stubble)\b/i],
];
// "voice: broad Glaswegian" is a voice even though "broad" reads as a build.
export const traitKind = (text: string): TraitKind => (/^\s*voice\s*:|\baccent\b/i.test(text) ? "voice" : (TRAIT_KIND.find(([, re]) => re.test(text))?.[0] ?? "other"));

const METER_ALIASES: Record<string, Meter> = {
  tired: "fatigue", tiredness: "fatigue", exhaustion: "fatigue", fatigue: "fatigue", hunger: "hunger", hungry: "hunger", thirst: "thirst", thirsty: "thirst",
  pain: "pain", drunk: "intox", intox: "intox", intoxication: "intox", drunkenness: "intox", health: "health", hp: "health", composure: "composure",
  ballast: "composure", arousal: "arousal", lust: "arousal", stress: "stress", anxiety: "stress",
};
const AXIS_ALIASES: Record<string, Axis> = {
  trust: "trust", affection: "affection", love: "affection", fondness: "affection", respect: "respect", familiarity: "familiarity", comfort: "comfort",
  safety: "comfort", attraction: "attraction", desire: "attraction", fear: "fear", "fear of": "fear", "afraid of": "fear", dread: "fear",
  worry: "worry", worries: "worry", "fear for": "worry", "fears for": "worry", "afraid for": "worry", concern: "worry", resentment: "resentment", resent: "resentment", anger: "resentment",
  obligation: "obligation", debt: "obligation", rivalry: "rivalry", rival: "rivalry", jealousy: "rivalry",
};
const BIG_CAUSE = /\b(betray\w*|rescue\w*|saved?\b|saving|unforgiv\w*|life|died|death|confess\w*|attack\w*|abandon\w*)\b/i;
const DOWN_CAUSE = /\b(betray\w*|lie|lies|lied|lying|neglect\w*|abandon\w*|broke|broken|break\w*|cheat\w*|hurt\w*|reject\w*|refus\w*|cruel\w*|deceiv\w*|deceit\w*|revealed|left (?:her|him|them)|walked away|turned away|pushed (?:her|him|them) away|cold|withdr[ae]w\w*|distan\w*|end(?:ed|s)? it|split|dumped|argu\w*|resent\w*)\b/i;
const ROMANCE_CAUSE = /\b(kiss\w*|attract\w*|desir\w*|crush\w*|flirt\w*|blush\w*|in love|lov(?:e|es|ed|ing)|romanc\w*|romantic\w*|date|dating|lips|mouth|jealous\w*|long(?:s|ed|ing) for|butterfl\w*|chemistry|sparks?|aroused|arousal|wants? (?:her|him|them)|sexual\w*|seduc\w*|caress\w*)\b/i;
/** Words that name a crowd, not a person: "know Group: …" means everyone in the scene. */
const GROUP_WORD = /^(?:the |all the |whole )*(?:group|whole group|everyone|everybody|all|all present|all of them|all of us|all of you|circle|others|others here|rest|crowd|camp|team|squad|party|survivors|room|table|fire|us|them|they|we|both|both of them|girls|boys|kids|everyone present|everyone here|everyone in (?:the )?(?:scene|room)|everybody in (?:the )?(?:scene|room)|whole house|whole camp)$/;
/** Words for people at large ("the general public", "nobody"): no one in particular, so never a person. */
const PUBLIC_WORD = /^(?:the )?(?:general )?public$|^(?:the )?(?:whole )?(?:world|town|school|city|village)$|^(?:other )?people$|^everyone else$|^anyone(?: else)?$|^outsiders$|^(?:nobody|no one|noone|none)(?: else)?$/;
/** "from everyone": the crowd words, and people at large (but not "nobody"). */
const EVERYONE_WORD = (n: string) => GROUP_WORD.test(n) || (PUBLIC_WORD.test(n) && !/^(?:nobody|no one|noone|none)/.test(n));
const isCrowd = (name: string) => {
  const n = norm(personName(name));
  return GROUP_WORD.test(n) || PUBLIC_WORD.test(n);
};
/** Ops said of a person, which a list of names in the subject spreads over each of them. */
const PERSON_OPS = new Set<string>(["mood", "body", "look", "trait", "drive", "mask", "dead", "bond", "ladder", "know", "pressure", "room", "keeps", "owe", "promise", "rep", "lives"]);
/** docs/30 0.2: ops a group's name spreads over its people. A trait, a look or a room of the Scoobies isn't each member's. */
const SPREAD_OPS = new Set<string>(["know", "mood", "bond", "owe", "promise", "lives"]);

/** A route that reaches people who aren't in the scene: a call, a text, a letter, the files, word getting round. */
const REMOTE_ROUTE =
  /\b(?:phone\w*|call(?:s|ed|ing)?|text(?:s|ed|ing)?|messag\w*|voicemail|letters?|notes?|e-?mail\w*|radio\w*|news\w*|broadcast\w*|tv|video\w*|files?|reports?|papers?|diar(?:y|ies)|journals?|recording\w*|tapes?|online|internet|posted|rumou?rs?|gossip\w*|grapevine|word (?:got|gets|spread|travels|travelled)|passed (?:it )?on|relay\w*|later|afterwards|off-?screen)\b/i;

/** What a name in a person's place stands for (docs/30 0.2). */
type Who =
  | { kind: "person" }
  | { kind: "crowd" }
  | { kind: "many"; names: string[]; as: "faction" | "group"; group: string; /** docs/30 2.4: a household: the home (a place id) whose residents these are. */ home?: string }
  | { kind: "not"; as: "place" | "group" | "faction" | "field"; name: string; reason: string };

interface Ctx {
  cfg: FoldConfig;
  changes: Change[];
  verdict: Verdict;
  ev: TrackerEvent;
  notes: DriftNote[];
}

export class Folder {
  state: WorldState;
  changes: Record<string, Change[]> = {};
  verdicts: Record<string, Verdict> = {};
  /** The line being applied, for what's said about it from deep in a name's lookup. */
  private cur?: Ctx;
  /** docs/32 Part 1: what the line being applied named that the story never has. */
  private unsaid: string[] = [];

  constructor(
    public cfg: FoldConfig,
    state?: WorldState,
  ) {
    this.state = state ?? emptyWorld();
    if (!state) {
      this.ensureChar(cfg.userName || "You", 0, { isUser: true });
      if (cfg.mainName) this.ensureChar(cfg.mainName, 0, { isMain: true });
      // docs/30 1.1: yours and the lore's groups, with their people from the start.
      for (const f of cfg.factions ?? []) {
        const had = this.findGroup(f.name);
        const g = this.groupOf(f.name, 0, f.source ?? "you");
        if (had && had.source === "you" && f.source === "lore") {
          if (groupKey(f.name) !== groupKey(g.name)) g.aliases = uniq([...(g.aliases ?? []), f.name]);
        } else {
          g.name = f.name;
          g.source = f.source ?? "you";
          if (f.kind) g.kind = f.kind;
        }
        if (f.aliases?.length) g.aliases = uniq([...(g.aliases ?? []), ...f.aliases]);
        for (const m of f.members) this.join(g, m, 0);
        g.adopted = true;
      }
    }
  }

  // ---------- groups (docs/30 Part 1) ----------

  /** The group by this name or one of its other names. */
  findGroup(name: string): Group | undefined {
    const key = groupKey(personName(name.replace(/^\s*@/, "")) || name);
    if (!key) return undefined;
    const groups = this.state.groups ?? {};
    return groups[key] ?? Object.values(groups).find((g) => groupKey(g.name) === key || (g.aliases ?? []).some((a) => groupKey(a) === key));
  }

  /** The cast whose surname a family is named by. */
  private bySurname(name: string): string[] {
    const surnames = familySurname(name.replace(/^family:\s*/i, ""));
    if (!surnames.length) return [];
    return Object.values(this.state.chars)
      .filter((c) => c.name.includes(" ") && surnames.includes(norm(c.name).split(" ").at(-1)!))
      .map((c) => c.name);
  }

  private notGroup(name: string) {
    const key = groupKey(name);
    return (this.cfg.notGroups ?? []).some((n) => groupKey(n) === key);
  }

  /** The group by this name, made (as the story's) when it's new. */
  private groupOf(name: string, seq: number, source: Group["source"] = "story"): Group {
    const found = this.findGroup(name);
    if (found) return found;
    const clean = name.replace(/^\s*@/, "").replace(/\s+/g, " ").trim();
    const surnames = Object.values(this.state.chars)
      .filter((c) => c.name.includes(" "))
      .map((c) => norm(c.name).split(" ").at(-1)!)
      .filter(Boolean);
    const anchor = possessiveAnchor(clean);
    const g: Group = { name: clean, kind: kindOfGroup(clean, { surnames }), source, members: [], facts: [], firstSeq: seq, lastSeq: seq, mentions: 0, ...(anchor ? { anchor } : {}) };
    (this.state.groups ??= {})[groupKey(clean)] = g;
    return g;
  }

  /**
   * docs/30 1.2: whether a group stands for its people. Yours and the lore's always; the story's when
   * groups are automatic and it has people named or was written in two messages, unless you said it isn't a group.
   */
  private adopts(g: Group): boolean {
    if (g.source !== "story") return true;
    if (this.notGroup(g.name) || (this.cfg.groupsMode ?? "auto") !== "auto") return false;
    // A household is whoever lives at a home (docs/30 2.4), not a list the story wrote once.
    if (g.kind === "household") return Boolean(g.home && this.residentsOf(g.home).length) || currentMembers(g).length > 0;
    return currentMembers(g).length > 0 || g.mentions >= 2;
  }

  private mention(g: Group, seq: number) {
    if (!g.mentions || seq > g.lastSeq) g.mentions++;
    g.lastSeq = Math.max(g.lastSeq, seq);
    g.adopted = this.adopts(g);
  }

  /** Someone joins (true when they weren't in it already). */
  private join(g: Group, name: string, seq: number, o: { role?: string; why?: string } = {}): boolean {
    const c = this.findChar(name);
    const same = (m: { name: string }) => norm(m.name) === norm(personName(name)) || (c ? this.findChar(m.name)?.id === c.id : false);
    const cur = g.members.find((m) => m.left == null && same(m));
    if (cur) {
      if (o.role) cur.role = o.role;
      return false;
    }
    g.members.push({ name: c?.name ?? personName(name), since: seq, ...(o.role ? { role: o.role } : {}), ...(o.why ? { why: o.why } : {}) });
    if (c) this.keepFromGroups(c.id);
    g.adopted = this.adopts(g);
    return true;
  }

  private leave(g: Group, name: string, seq: number, why?: string): boolean {
    const c = this.findChar(name);
    const m = g.members.find((x) => x.left == null && (norm(x.name) === norm(personName(name)) || (c ? this.findChar(x.name)?.id === c.id : false)));
    if (!m) return false;
    m.left = seq;
    if (why) m.why = why;
    g.adopted = this.adopts(g);
    return true;
  }

  /** docs/30 1.3: a secret kept from a group is kept from whoever is in it now, including those who joined later. */
  private keepFromGroups(id: string) {
    const c = this.state.chars[id];
    if (!c || c.isUser) return;
    const mine = Object.entries(this.state.groups ?? {})
      .filter(([, g]) => currentMembers(g).some((m) => norm(m.name) === norm(c.name) || this.findChar(m.name)?.id === id))
      .map(([k]) => k);
    if (!mine.length) return;
    for (const f of Object.values(this.state.facts)) {
      const s = f.secret;
      if (!s?.groups?.some((k) => mine.includes(k)) || s.keepers.includes(id) || s.from.includes(id)) continue;
      if (/knows|believes|suspects/.test(f.stances[id]?.status ?? "")) continue;
      s.from.push(id);
      f.stances[id] ??= { status: "unaware", route: "kept from their group", seq: this.state.lastSeq };
    }
  }

  // ---------- names ----------

  /** Finds a character by name, alias, {{user}}/{{char}}, first or last name, or a one-letter typo. */
  findChar(name: string): Character | undefined {
    const n = norm(personName(name));
    if (!n) return undefined;
    const chars = Object.values(this.state.chars);
    if (/^(\{\{user\}\}|user|you|your character|me|i)$/.test(n)) return chars.find((c) => c.isUser);
    if (/^(\{\{char\}\}|char)$/.test(n)) return chars.find((c) => c.isMain);
    const exact = chars.find((c) => c.id === slug(n) || norm(c.name) === n || c.aliases.some((a) => norm(a) === n));
    if (exact) return exact;
    // "Jackie" for Jackie Taylor, "Jackie Taylor" for Jackie, "Holloway" for James Holloway.
    const words = (s: string) => norm(s).split(" ");
    const nw = n.split(" ");
    const pick = (list: Character[]) => {
      if (list.length <= 1) return list[0];
      // Several share the name: whoever is in the scene, then your character or the main one.
      const here = list.filter((c) => c.tier === "spot" || c.tier === "peri");
      if (here.length === 1) return here[0];
      const lead = list.filter((c) => c.isUser || c.isMain);
      return lead.length === 1 ? lead[0] : undefined;
    };
    const first = pick(chars.filter((c) => [c.name, ...c.aliases].some((x) => words(x)[0] === n || (nw.length > 1 && nw[0] === norm(x)))));
    if (first) return first;
    if (nw.length === 1 && n.length >= 3) {
      const last = pick(chars.filter((c) => words(c.name).length > 1 && words(c.name).at(-1) === n));
      if (last) return last;
    }
    if (n.length >= 5) {
      const typo = chars.filter((c) => lev(norm(c.name), n, 1) <= 1);
      if (typo.length === 1) return typo[0];
    }
    return this.blendOf(name);
  }

  /**
   * docs/32 Part 0: a name made of one person's first name and another's surname ("Gabriel Summers"
   * beside Gabriel Winters and Buffy Summers) is the first of them, misnamed: a model's slip, or a
   * married name. Never when the name is already someone's, or you said it's a person.
   */
  blendOf(name: string): Character | undefined {
    const n = norm(personName(name));
    const nw = n.split(" ");
    if (nw.length !== 2) return undefined;
    if ((this.cfg.people ?? []).some((p) => norm(p) === n)) return undefined;
    const full = Object.values(this.state.chars)
      .map((c) => ({ c, w: norm(c.name).split(" ") }))
      .filter((x) => x.w.length >= 2);
    if (full.some((x) => x.w.join(" ") === n || x.c.aliases.some((a) => norm(a) === n))) return undefined;
    const owners = full.filter((x) => x.w[0] === nw[0]);
    if (owners.length !== 1 || owners[0]!.w.at(-1) === nw[1]) return undefined;
    const owner = owners[0]!.c;
    return full.some((x) => x.c.id !== owner.id && x.w.at(-1) === nw[1]) ? owner : undefined;
  }

  /** The names an op is written about: its subject (each of a list), its object, a cast line's people. */
  private namedIn(op: Op): string[] {
    const cast = op.op === "cast" && Array.isArray(op.args.list) ? (op.args.list as { name: string }[]).map((x) => x.name) : [];
    return [...(op.subject ? this.each(op.subject) : []), ...(op.object ? [op.object] : []), ...cast.flatMap((n) => this.each(n))];
  }

  ensureChar(name: string, seq: number, opts: { isUser?: boolean; isMain?: boolean } = {}): Character {
    const found = opts.isUser ? Object.values(this.state.chars).find((c) => c.isUser) : this.findChar(name);
    if (found) {
      found.lastSeq = Math.max(found.lastSeq, seq);
      return found;
    }
    const clean = personName(name).replace(/#\d+.*$/, "").replace(/[“”"]/g, "").trim() || name.trim();
    let id = opts.isUser ? "user" : slug(clean);
    // A merged-away person's id stays free of clashes.
    for (let i = 2; !opts.isUser && this.state.chars[id]; i++) id = `${slug(clean)}-${i}`;
    const key = clean.toLowerCase();
    const c: Character = {
      id,
      name: clean,
      aliases: [],
      isUser: !!opts.isUser,
      isMain: !!opts.isMain,
      firstSeq: seq,
      lastSeq: seq,
      meters: {},
      flags: [],
      injuries: [],
      conditions: [],
      traits: [],
      drives: {},
      journal: [],
      stamina: this.cfg.stamina?.[key] ?? (opts.isUser ? this.cfg.stamina?.user : undefined) ?? "ordinary",
    };
    this.state.chars[id] = c;
    for (const t of this.cfg.seedTraits?.[opts.isUser ? "user" : key] ?? []) c.traits.push({ kind: traitKind(t), text: t, by: "card", seq: 0 });
    // A secret kept from everyone is kept from whoever turns up later too.
    if (!opts.isUser) for (const f of Object.values(this.state.facts)) if (f.secret?.everyone && !f.secret.keepers.includes(id)) f.secret.from.push(id);
    // docs/30 1.3: and one kept from a group they're in.
    this.keepFromGroups(id);
    // docs/21 4.3: facts said before they turned up may be about them.
    for (const f of Object.values(this.state.facts)) if (!f.about?.includes(id) && mentions(f.statement, clean)) f.about = [...(f.about ?? []), id];
    return c;
  }

  /** "Mari, Gen and Robin" → each of them (unless someone really goes by the whole thing). */
  each(name: string): string[] {
    // A bracketed list belongs to the group before it ("Dawn's friends (Melissa, Kara, Jamie)"): whoIs reads it whole.
    if (/\([^)]*[,&]/.test(name) && !/^[^(]*[,&·•;]/.test(name)) return [name];
    // docs/30 0.3: "Xander Harris · Willow Rosenberg" and "Tara; Anya" are lists too.
    const parts = personName(name).split(/\s*(?:,|&|\+|\/|·|•|;|\band\b)\s*/i).map((s) => s.trim()).filter(Boolean);
    if (parts.length < 2) return [name];
    const n = norm(personName(name));
    return Object.values(this.state.chars).some((c) => norm(c.name) === n || c.aliases.some((x) => norm(x) === n)) ? [name] : parts;
  }

  /** docs/30 0.1: a faction the story knows by this name: yours, the lore's, or the engine's (clocks, standing, subplots). */
  private faction(name: string): { name: string; members: string[] } | undefined {
    const n = norm(name).replace(/^the /, "");
    if (!n) return undefined;
    const same = (x: string) => norm(x).replace(/^the /, "") === n;
    if (this.notGroup(name)) return undefined;
    // docs/30 1.1: yours, the lore's, and the story's own when it's adopted, with who's in it now.
    const g = this.findGroup(name);
    if (g && (g.adopted ?? this.adopts(g))) {
      // docs/30 2.4: a household is whoever lives at its home now.
      if (g.kind === "household" && g.home) return { name: g.name, members: this.residentsOf(g.home).map((id) => this.nameOf(id)) };
      const members = currentMembers(g).map((m) => m.name);
      // docs/30 1.4: a family nobody listed is the cast by its surname ("the Taylor family": Jackie Taylor).
      return { name: g.name, members: members.length || g.kind !== "family" ? members : this.bySurname(g.name) };
    }
    const own = (this.cfg.factions ?? []).find((f) => same(f.name) || (f.aliases ?? []).some(same));
    if (own) return { name: own.name, members: own.members };
    const st = this.state;
    const engine = [
      ...Object.values(st.clocks).map((k) => k.faction),
      ...Object.values(st.rep).map((r) => r.group),
      ...Object.values(st.sim?.arcs ?? {}).filter((a) => a.lead.startsWith("faction:")).map((a) => a.leadName),
      ...Object.keys(st.sim?.factionRel ?? {}).flatMap((k) => k.split("|")),
    ].find((x) => x && same(x));
    return engine ? { name: engine, members: [] } : undefined;
  }

  /** docs/30 0.2: a place the story has been, by any part of its path ("downstairs kitchen"). */
  private isPlace(name: string): boolean {
    const n = norm(personName(name));
    if (!n) return false;
    if (this.state.place.some((x) => norm(x) === n)) return true;
    return Object.values(this.state.places).some((p) => p.path.some((x) => norm(x) === n) || (p.aliases ?? []).some((x) => norm(x) === n));
  }

  // ---------- homes (docs/30 2.4) ----------

  /** Who lives at a place now (character ids), the dead left out. */
  residentsOf(placeId: string): string[] {
    return (this.state.places[placeId]?.residents ?? []).filter((id) => this.state.chars[id] && !this.state.chars[id]!.dead);
  }

  /** The home someone lives in now. */
  homeOf(charId: string): Place | undefined {
    const all = Object.values(this.state.places).filter((p) => p.residents?.includes(charId));
    return all.find((p) => p.kind === "home") ?? all[0];
  }

  /**
   * docs/30 2.4: "household", "the household", "the Winters household", "Dawn's household": the home
   * it means (the named one, the one the scene is in, or the player's), and who lives there now.
   */
  private household(name: string): { group: string; home: Place; names: string[] } | undefined {
    const n = norm(name);
    const m = n.match(/^(?:the\s+)?(?:whole\s+)?(?:(.+?)\s+)?(?:household|housemates|roommates)$/) ?? n.match(/^everyone (?:at home|in the house)$/);
    if (!m) return undefined;
    const st = this.state;
    const book = this.placeBook;
    const homes = Object.values(st.places).filter((p) => p.kind === "home");
    let home: Place | undefined;
    const pre = m[1]?.replace(/^the\s+/, "");
    if (pre) {
      const who = pre.match(/^(.+?)(?:'s|s')$/)?.[1];
      const c = who ? this.findChar(who) : undefined;
      if (c) home = this.homeOf(c.id);
      else {
        const fam = pre.replace(/(?:es|s)$/, "");
        const sur = (x: string) => x.split(" ").at(-1)!.replace(/(?:es|s)$/, "");
        const hits = homes.filter((h) => book.names(h).some((x) => placeKey(x).split(" ")[0]!.replace(/(?:es|s)$/, "") === fam) || this.residentsOf(h.id).some((id) => sur(norm(st.chars[id]!.name)) === fam));
        if (hits.length === 1) home = hits[0];
      }
      if (!home) return undefined;
    } else {
      const here = book.buildingOf(book.here());
      const user = Object.values(st.chars).find((c) => c.isUser);
      home = here?.kind === "home" ? here : user ? this.homeOf(user.id) : undefined;
      if (!home) return undefined;
    }
    return { group: `${home.name} household`, home, names: this.residentsOf(home.id).map((id) => this.nameOf(id)) };
  }

  /**
   * docs/30 2.4: who lives at a home, from what the story already says: a home named for someone
   * ("Gabriel's House"), the lore's family with this "Home", a `room` line making the home theirs, and
   * a bedroom of their own in it. These are guesses (`guessed`): a "lives" line always wins. A guess
   * only fills in someone who lives nowhere yet, except a new room line (`fresh`, its person), which
   * moves a guess: Dawn's new bedroom at the Winters house says she lives there now.
   */
  private homeEvidence(p: Place, fresh?: string) {
    const st = this.state;
    const book = this.placeBook;
    const home = book.buildingOf(p);
    if (!home || home.kind !== "home") return;
    const where = new Map<string, Place>();
    for (const x of Object.values(st.places)) for (const id of x.residents ?? []) where.set(id, x);
    const add = (c: Character | undefined) => {
      if (!c || c.dead) return;
      const at = where.get(c.id);
      if (at?.id === home.id) return;
      if (at) {
        // Said with a lives line, or a guess that only a new room line moves.
        if (fresh !== c.id || !at.guessed?.includes(c.id)) return;
        at.residents = at.residents!.filter((id) => id !== c.id);
        at.guessed = at.guessed.filter((id) => id !== c.id);
      }
      (home.residents ??= []).push(c.id);
      (home.guessed ??= []).push(c.id);
      where.set(c.id, home);
    };
    const names = book.names(home);
    for (const n of names) {
      const m = n.match(/^(.+?)(?:'s|s')\s+(?:.*\s)?(?:house|home|place|apartment|flat|residence|mansion|manor)$/i);
      if (m) add(this.findChar(m[1]!));
    }
    for (const f of this.cfg.factions ?? []) if (f.home && names.some((x) => placeKey(x) === placeKey(f.home!))) for (const name of f.members) add(this.findChar(name));
    if (home.owner) add(st.chars[home.owner]);
    // A bedroom of their own, not any room a line called theirs (a kitchen, a porch).
    for (const r of book.under(home, 2)) if (r.owner && /\bbed ?room\b|\bquarters\b/i.test(`${r.name} ${r.kind ?? ""}`)) add(st.chars[r.owner]);
  }

  /**
   * docs/30 0.2: what a name in a person's place stands for. Someone already in the cast (or that you
   * said is a person) is a person. Otherwise a faction or a group stands for its people, and a place
   * or a field name ("traits") stands for nobody.
   */
  whoIs(raw: string): Who {
    // docs/30 1.5: "@Scoobies" is the group, spelled out: never a person.
    if (/^\s*@\S/.test(raw)) {
      const nm = personName(raw.trim().slice(1));
      const f = this.faction(nm);
      const g = f ? undefined : this.findGroup(nm);
      const names = f?.members ?? (g ? currentMembers(g).map((m) => m.name) : []);
      const group = f?.name ?? g?.name ?? nm;
      return names.length ? { kind: "many", names, as: "faction", group } : { kind: "not", as: "group", name: group, reason: `${group} has no members known yet: name its people` };
    }
    const name = personName(raw);
    const n = norm(name);
    if (!n) return { kind: "person" };
    if ((this.cfg.people ?? []).some((p) => norm(p) === n)) return { kind: "person" };
    if (Object.values(this.state.chars).some((c) => norm(c.name) === n || c.aliases.some((a) => norm(a) === n))) return { kind: "person" };
    if (isCrowd(raw)) return { kind: "crowd" };
    // docs/30 2.4: "the household" is whoever lives at the home in the scene (or the player's home).
    const hh = this.household(name);
    if (hh)
      return hh.names.length
        ? { kind: "many", names: hh.names, as: "group", group: hh.group, home: hh.home.id }
        : { kind: "not", as: "group", name: hh.group, reason: `nobody is known to live at ${hh.home.name} yet: write lives Name: ${hh.home.name}` };
    // docs/30 1.2: or a name nobody has, with two people or more in brackets ("the Potentials (Kennedy, Rona)").
    const several = /\([^)]*(?:,|&|;|·|\band\b)[^)]*\)\s*$/.test(raw);
    const br = bracketGroup(raw, (head) => isGroupShape(head) || Boolean(this.faction(head)) || (several && !this.findChar(head) && !looksLikePlace(head)));
    if (br) return { kind: "many", names: br.names, as: this.faction(br.group) ? "faction" : "group", group: br.group };
    if (FIELD_WORD.test(n)) return { kind: "not", as: "field", name, reason: `"${name}" is a field name, not a person` };
    const f = this.faction(name);
    if (f) return f.members.length ? { kind: "many", names: f.members, as: "faction", group: f.name } : { kind: "not", as: "faction", name: f.name, reason: `${f.name} is a faction with no members known yet` };
    const surnames = familySurname(name);
    if (surnames.length) {
      const fam = Object.values(this.state.chars).filter((c) => {
        const last = norm(c.name).split(" ").at(-1);
        return c.name.includes(" ") && last && surnames.includes(last);
      });
      if (fam.length) return { kind: "many", names: fam.map((c) => c.name), as: "group", group: name };
    }
    if (isGroupShape(name)) return { kind: "not", as: "group", name, reason: `${name} is a group: name its people` };
    if (this.isPlace(name) || looksLikePlace(name)) return { kind: "not", as: "place", name, reason: `${name} is a place, not a person` };
    return { kind: "person" };
  }

  /** docs/30 0.6: keeps a name that went elsewhere, for the tidy notice and the refold report. */
  private routed(w: Who, seq: number) {
    if (w.kind !== "many" && w.kind !== "not") return;
    const name = w.kind === "many" ? w.group : w.name;
    const as = w.kind === "many" ? w.as : w.as;
    const key = name.toLowerCase().replace(/\s+/g, " ").trim();
    const map = (this.state.notPeople ??= {});
    const cur = map[key];
    if (cur) {
      cur.lastSeq = Math.max(cur.lastSeq, seq);
      cur.lines++;
      if (w.kind === "many") cur.members = uniq([...(cur.members ?? []), ...w.names]);
    } else map[key] = { name, as, firstSeq: seq, lastSeq: seq, lines: 1, ...(w.kind === "many" ? { members: [...w.names] } : {}) };
    // docs/30 1.2: a group the story names is kept, with the people it named.
    if (as === "group" || as === "faction") {
      const g = this.groupOf(name, seq);
      // docs/30 2.4: a household's people are its home's residents, read fresh each time: nobody is joined to it.
      if (w.kind === "many" && w.home) {
        g.kind = "household";
        g.home = w.home;
        this.mention(g, seq);
        return;
      }
      if (w.kind === "many") for (const n of w.names) if (this.whoIs(n).kind === "person") this.join(g, n, seq);
      this.mention(g, seq);
    }
  }

  /** A person named in an op: resolves or creates (never for names that look like groups or places). */
  person(name: string | undefined, seq: number): Character | undefined {
    if (!name?.trim()) return undefined;
    const yours = (this.cfg.people ?? []).some((p) => norm(p) === norm(personName(name)));
    // A crowd or "the public" is never a person, even one made by mistake before (unless you said it is).
    if (isCrowd(name) && !yours) return undefined;
    // docs/30 0.2: nor a place, a group, a faction or a field name.
    const w = this.whoIs(name);
    if (w.kind !== "person") {
      this.routed(w, seq);
      return undefined;
    }
    const known = this.findChar(name);
    if (known) return known;
    // docs/32 Part 1: a name only the ledger has is someone it misnamed, or nobody.
    if (!yours && this.unnamed(name, seq)) {
      const c = this.nearest(name);
      const note = `the story never says ${personName(name)}: ${c ? `read as ${c.name}` : "nobody was added"}`;
      if (!this.unsaid.includes(note)) {
        this.unsaid.push(note);
        this.rereadAs(name, c, seq);
      }
      return c;
    }
    return this.ensureChar(name, seq);
  }

  /**
   * docs/32 Part 1: a name the tracker wrote that the story doesn't have by this message: not whole, and
   * not by any word of it that's nobody else's ("Hank" of Hank Summers). Descriptions ("the bartender")
   * are the tracker's own words and pass; so do your lines, the opening's and the engine's.
   */
  private unnamed(name: string, seq: number): boolean {
    const has = this.cfg.inStory;
    const src = this.cur?.ev.source;
    if (!has || (src !== "model" && src !== "inline")) return false;
    const clean = personName(name).replace(/#\d+.*$/, "").replace(/[“”"]/g, "").trim();
    if (!clean || passingName(clean) || has(clean, seq)) return false;
    const owned = new Set(Object.values(this.state.chars).flatMap((c) => [c.name, ...c.aliases]).flatMap((n) => norm(n).split(" ")));
    const words = clean.split(/\s+/);
    if (words.length < 2) return true;
    return !words.some((w) => /^\p{Lu}[\p{L}'’-]{2,}$/u.test(w) && !TITLE_WORD.test(w) && !owned.has(norm(w)) && has(w, seq));
  }

  /** docs/32 Part 4: keeps a name that was read as someone else (or nobody), for the tidy notice and Story health. */
  private rereadAs(name: string, c: Character | undefined, seq: number) {
    const clean = personName(name).replace(/\s+/g, " ").trim();
    const map = (this.state.reread ??= {});
    const cur = map[clean.toLowerCase()];
    if (cur) {
      cur.lastSeq = Math.max(cur.lastSeq, seq);
      cur.lines++;
      cur.as = c?.name ?? cur.as;
    } else map[clean.toLowerCase()] = { name: clean, as: c?.name ?? null, firstSeq: seq, lastSeq: seq, lines: 1 };
  }

  /** Who an unnamed name most likely is: the one person whose first name it starts with. */
  private nearest(name: string): Character | undefined {
    const n = norm(personName(name));
    const first = n.split(" ")[0] ?? "";
    if (first.length < 3) return undefined;
    const chars = Object.values(this.state.chars);
    const owners = chars.filter((c) => norm(c.name).split(" ")[0] === first);
    if (owners.length === 1) return owners[0];
    // A misspelling the story never has ("Guth" for Ruth): looser than findChar's, since nobody else can be meant.
    const max = n.length >= 8 ? 2 : 1;
    const typo = n.length >= 4 ? chars.filter((c) => [c.name, ...c.aliases].some((x) => lev(norm(x), n, max) <= max)) : [];
    return typo.length === 1 ? typo[0] : undefined;
  }

  /** The people a name stands for: "the group", "everyone", "the circle" mean whoever is in the scene; a faction, its members. */
  people(name: string | undefined, seq: number): Character[] {
    if (name?.trim() && GROUP_WORD.test(norm(personName(name))))
      return Object.values(this.state.chars).filter((c) => (c.tier === "spot" || c.tier === "peri") && !c.dead);
    if (name?.trim()) {
      const w = this.whoIs(name);
      if (w.kind === "many") {
        this.routed(w, seq);
        return uniq(w.names.flatMap((n) => this.person(n, seq) ?? []));
      }
    }
    const c = this.person(name, seq);
    return c ? [c] : [];
  }

  /**
   * docs/30 0.2: one person line as the lines it stands for. "know Scoobies: …" is a line for each
   * member (heard "via the Scoobies"); "mood Downstairs Kitchen: …" is a line for nobody, and says why.
   */
  private spread(op: Op, ctx: Ctx): Op[] {
    const seq = ctx.ev.seq;
    const out: Op[] = [];
    const why: string[] = [];
    for (const part of this.each(op.subject!)) {
      const w = this.whoIs(part);
      if (w.kind === "person" || w.kind === "crowd") {
        out.push({ ...op, subject: part });
        continue;
      }
      this.routed(w, seq);
      if (w.kind === "not") {
        why.push(w.reason);
        continue;
      }
      if (!SPREAD_OPS.has(op.op)) {
        why.push(`${w.group} is a group: write it for each of them`);
        continue;
      }
      const via = w.as === "faction" && op.op === "know" ? `via the ${w.group.replace(/^the\s+/i, "")}` : undefined;
      // Members the reply never reached (groupReach, when the line was filed) don't learn it.
      let names = w.names;
      const unreached = REACH_OPS.has(op.op) && Array.isArray(op.args.away) ? (op.args.away as string[]).map(norm) : [];
      if (unreached.length) {
        const away = names.filter((n) => unreached.includes(norm(n)));
        names = names.filter((n) => !unreached.includes(norm(n)));
        if (away.length) why.push(`${away.join(", ")} ${away.length === 1 ? "isn't" : "aren't"} in the scene or the messages: a ${w.group} line reaches only those it did, unless it says how it reached the rest (a call, a text)`);
        if (!names.length) continue;
      }
      // docs/30 1.3: what the group as a whole was told, and who was in it then (not when only some heard it,
      // nor when you said one of them wasn't there).
      if (op.op === "know" && op.args.fact && names.length === w.names.length && !names.some((n) => this.notThere(op, n))) {
        const g = this.findGroup(w.group);
        if (g && !g.facts.some((x) => overlap(x.text, String(op.args.fact)) >= 0.8)) g.facts.push({ text: String(op.args.fact), seq, members: [...names] });
      }
      for (const name of names) out.push({ ...op, subject: name, ...(via ? { args: { ...op.args, route: op.args.route ? `${op.args.route}, ${via}` : via } } : {}) });
    }
    if (!out.length && why.length) this.reject(ctx, why.join("; "));
    else if (why.length) this.warn(ctx, why.join("; "));
    return out;
  }

  /** docs/30 0.4: "room Downstairs Kitchen: fridge bears the league standings" describes the kitchen; nobody owns it. */
  private roomAsPlace(op: Op, seq: number): Op | null {
    if (op.op !== "room" || !op.subject) return null;
    const parts = ((op.args.path ?? []) as string[]).filter(Boolean);
    const w = this.whoIs(op.subject);
    const aPlace = w.kind === "not" && w.as === "place";
    const unknown = w.kind === "person" && !this.findChar(op.subject);
    if (!aPlace && !(unknown && sentenceNotPath(parts))) return null;
    if (!parts.length) return null;
    this.routed(aPlace ? w : { kind: "not", as: "place", name: personName(op.subject), reason: "" }, seq);
    // A sentence about the place: "room Downstairs Kitchen: fridge bears the league standings".
    if (sentenceNotPath(parts)) return { op: "place", subject: op.subject, args: { path: [personName(op.subject)], text: parts[0]! }, cause: op.cause, raw: op.raw };
    // A path with what it's like: "room Cabin: wilderness › clearing › cabin (abandoned, log walls) — woodstove lit".
    const last = parts.at(-1)!;
    const m = last.match(/^(.*?)\s*\(([^)]*)\)\s*$/);
    const path = [...parts.slice(0, -1), (m ? m[1]! : last).trim()].filter(Boolean);
    const text = [m?.[2]?.trim(), op.cause?.trim()].filter(Boolean).join(" — ");
    return { op: "place", subject: op.subject, args: { path, text }, raw: op.raw };
  }

  nameOf(id: string) {
    return this.state.chars[id]?.name ?? id;
  }

  now(): number | null {
    return this.state.time?.minutes ?? null;
  }

  // ---------- applying ----------

  apply(ev: TrackerEvent) {
    // Knowledge and scene lines the model wrote are read again from their text, so older ones get what the
    // parser has learned since (fields in the cause, "kept by A, B", a mode after the scene's title). The engine's own carry args the text doesn't.
    // docs/30 0.2: and a cast line that was really a trait ("cast Dawn: traits — …"); other cast lines keep what they stored.
    if (["know", "secret", "scene", "cast"].includes(ev.op.op) && (ev.source === "model" || ev.source === "inline" || ev.source === "init") && ev.op.raw) {
      const op = parseLine(ev.op.raw);
      // Who a line missed (groupReach) and who you said wasn't there aren't in the text: they stay.
      const kept = Object.fromEntries((["away", "notThere", "unsure"] as const).filter((k) => ev.op.args[k]).map((k) => [k, ev.op.args[k]]));
      if (op && (ev.op.op === "cast" ? op.op === "trait" : op.op === ev.op.op)) ev = { ...ev, op: { ...op, args: { ...op.args, ...kept } } };
    }
    const ctx: Ctx = { cfg: this.cfg, changes: [], verdict: { raw: ev.op.raw, ok: true }, ev, notes: [] };
    this.cur = ctx;
    this.unsaid = [];
    try {
      // docs/32 Part 0: a blended name is read as the person whose first name it is, and the line says so.
      if (ev.source !== "user")
        for (const part of this.namedIn(ev.op)) {
          const c = this.blendOf(part);
          if (!c) continue;
          this.warn(ctx, `nobody is called ${personName(part)}: read as ${c.name}`);
          this.rereadAs(part, c, ev.seq);
        }
      const asPlace = this.roomAsPlace(ev.op, ev.seq);
      if (asPlace) this.applyOp(asPlace, ctx);
      // "mood Mari, Gen & Robin: tense" is said of each of them, not of one person by that name;
      // docs/30 0.2: "know Scoobies: …" of each member, and "mood Downstairs Kitchen: …" of nobody.
      else if (PERSON_OPS.has(ev.op.op) && ev.op.op !== "rep" && ev.op.subject) for (const op of this.spread(ev.op, ctx)) this.applyOp(op, ctx);
      else this.applyOp(ev.op, ctx);
      if (ev.op.op === "cast" || ev.op.op === "at" || ev.op.op === "clock") this.promiseChecks(ctx);
      // A beat is stamped with where and when its reply ends, whichever order the lines came in.
      if (ev.op.op === "cast" || ev.op.op === "at" || ev.op.op === "clock") {
        const b = this.state.beats?.at(-1);
        if (b?.seq === ev.seq) this.stamp(b);
      }
    } catch (e) {
      ctx.verdict = { raw: ev.op.raw, ok: false, reason: `couldn't apply: ${(e as Error).message}` };
    }
    // docs/32 Part 1: a line about nobody says why, whatever else stopped it.
    if (this.unsaid.length) {
      if (ctx.verdict.ok) this.warn(ctx, this.unsaid.join("; "));
      else ctx.verdict.reason = this.unsaid.join("; ");
    }
    this.logPresence(ev.seq);
    this.verdicts[ev.id] = ctx.verdict;
    if (ev.messageId && ctx.changes.length) (this.changes[ev.messageId] ??= []).push(...ctx.changes);
    this.state.lastSeq = Math.max(this.state.lastSeq, ev.seq);
  }

  private reject(ctx: Ctx, reason: string) {
    ctx.verdict = { raw: ctx.ev.op.raw, ok: false, reason };
  }
  private warn(ctx: Ctx, w: string) {
    ctx.verdict.warn = ctx.verdict.warn ? `${ctx.verdict.warn}; ${w}` : w;
  }
  private push(ctx: Ctx, c: Omit<Change, "source">) {
    const engine = ctx.ev.source === "engine" ? { event: ctx.ev.id, ...(ctx.ev.op.why?.length ? { why: ctx.ev.op.why } : {}) } : {};
    const line = c.kind === "knowledge" && (ctx.ev.source === "model" || ctx.ev.source === "inline") ? { lineId: ctx.ev.id } : {};
    ctx.changes.push({ ...c, source: ctx.ev.source, ...engine, ...line });
  }
  private isLocked(path: string) {
    const p = path.toLowerCase();
    return this.state.locks.some((l) => p === l || p.startsWith(`${l}.`));
  }
  /** docs/31 1.1: you said this person wasn't there for this line. */
  private notThere(op: Op, name: string, key: "notThere" | "unsure" | "away" = "notThere") {
    const list = op.args[key];
    if (!Array.isArray(list) || !list.length) return false;
    const id = this.findChar(name)?.id;
    return (list as string[]).some((n) => norm(n) === norm(name) || (id != null && this.findChar(n)?.id === id));
  }
  private ai(ctx: Ctx) {
    return ctx.ev.source !== "user";
  }
  /** Whether this reply is flagged for having this done thing still to come. Words only: anything else it filed stands. */
  private doneHeld(ctx: Ctx, what: string) {
    if (!this.ai(ctx) || !ctx.ev.messageId) return false;
    return (this.cfg.heldDone ?? []).some((h) => {
      const l = h.messageId === ctx.ev.messageId ? this.state.loops?.[h.loop] : undefined;
      return Boolean(l && [l.what, ...l.from].some((w) => overlap(w, what) >= 0.5));
    });
  }
  private needCause(ctx: Ctx, op: Op) {
    if (op.cause || !this.ai(ctx) || ctx.ev.source === "init" || ctx.ev.source === "engine") return true;
    if (this.cfg.strictness === "strict") {
      this.reject(ctx, "needs a cause (— why)");
      return false;
    }
    this.warn(ctx, "no cause given");
    return true;
  }

  /** Moves the clock and lets every body drift with it. */
  /** docs/25 §4.2: an occasion is over. Nothing forgets to end one: 12 story hours or a move away will. */
  private endOccasion(ctx: Ctx) {
    const was = this.state.occasion?.now;
    if (!was) return;
    this.state.occasion = null;
    this.push(ctx, { kind: "occasion", text: `${was}: over`, path: "occasion", from: was });
  }

  private moveClock(to: number, form: "date" | "day", ctx: Ctx, flag?: string) {
    const prev = this.state.time;
    const from = prev && prev.form === form ? prev.minutes : null;
    this.state.time = { minutes: to, form };
    const occ = this.state.occasion;
    if (occ && occ.at == null) occ.at = to;
    else if (occ && occ.at != null && to - occ.at >= 720) this.endOccasion(ctx);
    if (!prev) this.state.start = { minutes: to, form };
    // A switch from "Day 1" to a calendar keeps how long ago the start was.
    else if (prev.form !== form && this.state.start) this.state.start = { minutes: to - (prev.minutes - this.state.start.minutes), form };
    // M26: a switch of clock form starts the count again; nothing drifts across it.
    if (prev && prev.form !== form) for (const c of Object.values(this.state.chars)) c.driftAt = to;
    if (from == null) {
      this.push(ctx, { kind: "clock", text: shortStoryTime(formatStoryTime({ minutes: to, form })), path: "clock", to: formatStoryTime({ minutes: to, form }) });
      return;
    }
    if (to > from) for (const c of Object.values(this.state.chars)) driftCharacter(c, c.driftAt ?? from, to, ctx.notes);
    else for (const c of Object.values(this.state.chars)) c.driftAt = to;
    const a = formatStoryTime({ minutes: from, form });
    const b = formatStoryTime({ minutes: to, form });
    this.push(ctx, { kind: "clock", text: `${shortStoryTime(a)} → ${shortStoryTime(b)}`, path: "clock", from: a, to: b, ...(flag ? { flag } : {}) });
    // A jump of three hours or more starts a new scene.
    if (to - from >= 180) this.newScene(ctx.ev.seq);
    for (const n of ctx.notes.splice(0)) this.push(ctx, { kind: "body", text: `${n.who}: ${n.text}`, subject: n.who, path: `chars.${slug(n.who)}.body`, tone: "up" });
    this.dueChecks(ctx);
  }

  /** docs/20 1.1: a beat takes the story's time, place and people as they stand now. */
  private stamp(b: Beat) {
    const st = this.state;
    b.minutes = st.time?.minutes ?? null;
    b.form = st.time?.form;
    b.place = [...st.place];
    b.who = Object.values(st.chars).filter((c) => (c.tier === "spot" || c.tier === "peri") && !c.dead).map((c) => c.id);
  }

  /** docs/26 3.1: the scene's people, when they change. One entry a message at most, so it stays small. */
  private logPresence(seq: number) {
    const st = this.state;
    const who = Object.values(st.chars)
      .filter((c) => (c.tier === "spot" || c.tier === "peri") && !c.dead)
      .map((c) => c.id)
      .sort();
    const log = (st.presence ??= []);
    const last = log.at(-1);
    if (last && last.who.length === who.length && last.who.every((id, i) => id === who[i])) return;
    if (last?.seq === seq) last.who = who;
    else log.push({ seq, who });
  }

  /** E2: where and when the story is, for an object's history. */
  private where() {
    return { ...(this.state.place.length ? { at: this.state.place.join(" › ") } : {}), ...(this.state.time ? { time: this.state.time.minutes } : {}) };
  }

  /** docs/30 2.1: the place tree over this state, with your edits to it. */
  get placeBook() {
    return new PlaceBook(this.state, { profiles: this.cfg.placeProfiles, findChar: (n) => this.findChar(n) });
  }

  /** E2: the known place a path names (the same place written in full, by its last part, or by another name). */
  placeAt(path: string[]): Place | undefined {
    if (!path.length) return undefined;
    const exact = this.state.places[slug(path.join(" "))];
    if (exact) return exact;
    const found = this.placeBook.resolve(path, { create: false })?.place;
    if (found) return found;
    const tail = path.map(norm);
    return Object.values(this.state.places).find((p) => {
      const pp = p.path.map(norm);
      return tail.length <= pp.length ? tail.every((x, i) => x === pp[pp.length - tail.length + i]) : pp.every((x, i) => x === tail[tail.length - pp.length + i]);
    });
  }

  /**
   * docs/30 2.2: the place a path names, made if new, with a chip for each name taken by a guess
   * ("Gabriel's House is the Winters Residence"). Undefined for a path with nothing in it.
   */
  private placeFor(raw: string | string[], ctx: Ctx, seq: number, noNewTop = false): Place | undefined {
    const r = this.placeBook.resolve(raw, { create: true, seq, noNewTop });
    if (!r) return undefined;
    for (const g of r.guessed) this.push(ctx, { kind: "place", text: `${g.written} is ${g.place.name}`, path: `places.${g.place.id}.aliases`, reason: g.why });
    this.homeEvidence(r.place);
    return r.place;
  }

  /**
   * One message's move and cast, to tell who went along. A move takes everyone present with it,
   * but when the same message also says who is in the scene (a cast line), the people present
   * before who aren't in it stayed behind: three walking to the cabin don't bring the camp. Only
   * when the cast line names someone who came along; one that just notes a change says nothing.
   */
  private turnCast: { key: string; named: Set<string>; cast: boolean; move?: { from: string[]; carried: string[] }; heading: Map<string, string> } | null = null;

  private castTurn(ctx: Ctx) {
    const key = `${ctx.ev.messageId ?? ""}:${ctx.ev.seq}:${ctx.ev.source}`;
    if (this.turnCast?.key !== key) this.turnCast = { key, named: new Set(), cast: false, heading: new Map() };
    return this.turnCast;
  }

  /** "Buffy@left(→ kitchen)" when the scene is the kitchen: she went where the scene is, so she's in it. */
  private goesHere(dest: string) {
    const here = this.state.place.at(-1);
    const bare = (s: string) => norm(s.replace(/^the\s+/i, ""));
    return Boolean(here && bare(dest.split(" › ").at(-1)!) === bare(here));
  }

  /**
   * docs/30 3.1: counts a scene someone is in, once per scene, when a line puts them in it (a cast line,
   * an arrival). Being carried along by a move doesn't count: that's often someone the move left behind.
   */
  private inScene(c: Character) {
    if (c.lastScene === this.state.sceneNo) return;
    c.lastScene = this.state.sceneNo;
    c.scenes = (c.scenes ?? 0) + 1;
  }

  private comeIn(ctx: Ctx, c: Character, seq: number) {
    this.inScene(c);
    c.tier = "spot";
    c.place = this.state.place.join(" › ") || c.place;
    c.activity = undefined;
    c.lastSeq = seq;
    this.push(ctx, { kind: "cast", text: `${c.name} arrived`, subject: c.name, path: `chars.${c.id}.tier` });
  }

  private leftBehind(ctx: Ctx) {
    const t = this.turnCast;
    if (!t?.cast || !t.move || !ctx.ev.messageId) return;
    // A cast line that only notes a change ("Tom@arrive") says nothing about who came along.
    if (!t.move.carried.some((id) => t.named.has(id) && !this.state.chars[id]?.isUser)) return;
    const from = t.move.from.join(" › ");
    for (const id of t.move.carried) {
      const c = this.state.chars[id];
      if (!c || t.named.has(id) || c.isUser || c.dead || (c.tier !== "spot" && c.tier !== "peri")) continue;
      c.tier = "off";
      c.place = from;
      c.activity = undefined;
      this.push(ctx, { kind: "cast", text: `${c.name} stayed behind (${t.move.from.at(-1)})`, subject: c.name, path: `chars.${c.id}.tier` });
    }
    t.move.carried = [];
  }

  /** The message that last named the mode. */
  private modeSeq = -1;

  private setMode(mode: string, seq: number) {
    // "social (apology)", "social: apology", "social · apology": the mode, and the kind of talk it names.
    const m = /^([a-z]+)\s*(?:[(:·,—–-]\s*([a-z]+)\s*\)?)?/.exec(clip(mode).toLowerCase());
    this.state.mode = m?.[1] ?? clip(mode).toLowerCase();
    const talk = TALKS.find((t) => t === m?.[2]);
    this.state.talk = this.state.mode === "social" ? talk : undefined;
    this.modeSeq = seq;
  }

  private newScene(seq: number) {
    this.state.sceneNo++;
    this.state.sceneStartSeq = seq;
    this.state.sceneTitle = undefined;
    // A new scene doesn't inherit the last one's mode (a drive's "travel" in the kitchen after), unless
    // this same message named it.
    if (this.modeSeq !== seq) {
      this.state.mode = undefined;
      this.state.talk = undefined;
    }
    for (const c of Object.values(this.state.chars)) c.activity = undefined;
  }

  /** Promises, debts, deadlines and plans whose time has come. */
  private dueChecks(ctx: Ctx) {
    const now = this.now();
    if (now == null) return;
    for (const o of Object.values(this.state.obligations)) {
      if (o.status === "open" && o.due?.minutes != null && now >= o.due.minutes) {
        o.status = "due";
        this.push(ctx, { kind: o.kind, text: `${o.kind === "promise" ? "Promise" : "Debt"} due: ${o.what}`, subject: this.nameOf(o.who), path: `obligations.${o.id}`, tone: "due" });
      }
    }
    for (const d of Object.values(this.state.deadlines)) {
      if (!d.done && d.at != null && now >= d.at && !(d as { passed?: boolean }).passed) {
        (d as { passed?: boolean }).passed = true;
        this.push(ctx, { kind: "deadline", text: `Deadline passed: ${d.title}`, path: `deadlines.${d.id}`, tone: "due" });
      }
    }
  }

  /**
   * E3: keeping a promise warms the bond and breaking one cools it, by how much it mattered. An
   * override (Kept after Broken, They had a reason, Forgive) takes back what the last verdict moved;
   * forgiving lets the resentment go but not the lost trust.
   */
  private feelPromise(o: Obligation, ctx: Ctx, seq: number) {
    if (!o.whom) return;
    const imp = o.importance ?? 2;
    const kept: { axis: Axis; delta: number }[] = [];
    for (const m of o.moves ?? []) {
      if (o.status === "forgiven" && m.axis !== "resentment") {
        kept.push(m);
        continue;
      }
      this.nudgeBond(o.whom, o.who, m.axis, -m.delta, `${o.status}: ${o.what}`, ctx, seq);
    }
    o.moves = kept;
    const moves: [Axis, number][] = o.status === "kept" ? [["trust", imp >= 3 ? 2 : 1]] : o.status === "broken" ? (imp <= 1 ? [["trust", -1]] : [["trust", imp >= 3 ? -2 : -1], ["resentment", imp >= 3 ? 2 : 1]]) : [];
    for (const [axis, d] of moves) {
      const moved = this.nudgeBond(o.whom, o.who, axis, d, `${o.status} a promise: ${o.what}`, ctx, seq);
      if (moved) o.moves.push({ axis, delta: moved });
    }
    o.felt = true;
  }

  /** docs/22 1.1: a promise or a plan is a loop, and saying it again doesn't make a second one. */
  private openLoop(what: string, kind: Loop["kind"], seq: number, link: Partial<Loop> = {}) {
    const loops = (this.state.loops ??= {});
    const all = Object.values(loops);
    const same = all.find((l) => (link.obligation && l.obligation === link.obligation) || (link.calendar && l.calendar === link.calendar)) ?? loops[loopId(what)] ?? all.find((l) => l.status === "open" && overlap(l.what, what) >= 0.7);
    if (same) {
      Object.assign(same, link);
      if (!same.from.includes(what)) same.from.push(what);
      return same;
    }
    const l: Loop = { id: loopId(what), what: clip(what), kind, status: "open", opened: seq, from: [what], ...(repeats(what) ? { repeats: true } : {}), ...link };
    loops[l.id] = l;
    return l;
  }

  /** It happened. A promise behind it is kept and warms the bond, a plan is off the calendar, and one that repeats stays open. */
  private closeLoop(l: Loop, seq: number, how: string | undefined, ctx: Ctx) {
    if (l.repeats) {
      l.last = seq;
      return;
    }
    if (l.status === "done") return;
    l.status = "done";
    l.closed = seq;
    if (how) l.how = clip(how);
    this.ownLoop(l, ctx);
    this.push(ctx, { kind: "loop", text: `Done: ${l.what}`, path: `loops.${l.id}`, reason: how, tone: "up" });
    const st = this.state;
    const o = l.obligation ? st.obligations[l.obligation] : undefined;
    if (o && o.status !== "kept" && o.status !== "paid") {
      o.status = o.kind === "owe" ? "paid" : "kept";
      o.settled = seq;
      o.auto = false;
      this.push(ctx, { kind: o.kind, text: `${o.kind === "owe" ? "Debt paid" : "Promise kept"}: ${o.what}`, subject: this.nameOf(o.who), path: `obligations.${o.id}`, reason: how, tone: "up", memory: true });
      if (o.kind === "promise" && o.whom) this.feelPromise(o, ctx, seq);
    }
    const e = l.calendar ? st.calendar[l.calendar] : undefined;
    if (e) e.done = true;
  }

  /** Called off: nobody's waiting for it, so its promise isn't left to break and its plan comes off the calendar. */
  private dropLoop(l: Loop, seq: number, ctx: Ctx) {
    const st = this.state;
    const o = l.obligation ? st.obligations[l.obligation] : undefined;
    if (o && (o.status === "open" || o.status === "due")) {
      o.status = "excused";
      o.settled = seq;
      o.auto = false;
      this.feelPromise(o, ctx, seq);
    }
    const e = l.calendar ? st.calendar[l.calendar] : undefined;
    if (e) e.done = true;
  }

  /** It's yours once you've had your say, and it counts as by hand if a tap or a note did it: a card you approved doesn't. */
  private ownLoop(l: Loop, ctx: Ctx, hand = Boolean(ctx.ev.op.args.hand)) {
    if (ctx.ev.source !== "user") return;
    l.yours = true;
    if (hand) l.byHand = true;
    else delete l.byHand;
  }

  /** What only you can change: a loop you closed, or one you reopened, up to where you did. */
  private loopHeld(l: Loop, seq: number) {
    return l.status === "open" ? (l.reopened ?? -1) >= seq : Boolean(l.yours);
  }

  /** A promise's verdict reaches its loop. One already closed stays closed at the message it happened. */
  private settleLoop(o: Obligation, seq: number, ctx: Ctx, mine = ctx.ev.source === "user") {
    const l = Object.values(this.state.loops ?? {}).find((x) => x.obligation === o.id);
    if (!l || l.repeats || (!mine && this.loopHeld(l, seq))) return;
    const done = o.status === "kept" || o.status === "paid";
    if (o.status === "open" || o.status === "due") {
      l.status = "open";
      delete l.closed;
      delete l.how;
      if (mine) {
        delete l.yours;
        delete l.byHand;
        l.reopened = seq;
      }
    } else if (l.status === "open" || (done && l.status !== "done")) {
      l.status = done ? "done" : o.status === "forgiven" || o.status === "excused" ? "dropped" : "lapsed";
      l.closed = seq;
      // "Mark as kept" is the same act as closing the loop by hand.
      if (mine) this.ownLoop(l, ctx, true);
    }
  }

  /** One bond axis, by d (clamped); returns what it actually moved. */
  private nudgeBond(from: string, to: string, axis: Axis, d: number, cause: string, ctx: Ctx, seq: number) {
    const st = this.state;
    const key = `${from}>${to}`;
    const b = (st.bonds[key] ??= { from, to, axes: {}, tags: [], history: [] });
    const lo = (BIPOLAR_AXES as readonly string[]).includes(axis) ? -5 : 0;
    const prev = b.axes[axis] ?? 0;
    const next = Math.max(lo, Math.min(5, prev + d));
    if (next === prev) return 0;
    b.axes[axis] = next;
    b.history.push({ axis, from: prev, to: next, delta: next - prev, cause, seq });
    this.push(ctx, { kind: "bond", text: `${this.nameOf(from)} → ${this.nameOf(to)} · ${cap(axis)} ${next - prev > 0 ? "+" : ""}${next - prev}`, subject: this.nameOf(from), reason: cause, path: `bonds.${key}.${axis}`, tone: next > prev === (axis !== "resentment") ? "up" : "down" });
    return next - prev;
  }

  /**
   * E3: promises on the clock. A meeting is kept when both are there (and at the place, if it
   * names one) inside its window, and broken once the window has passed without it; any promise
   * with a time is broken a while after it (a day, or its own window) unless something kept it.
   */
  private promiseChecks(ctx: Ctx) {
    const now = this.now();
    if (now == null) return;
    const st = this.state;
    const here = (id: string) => {
      const c = st.chars[id];
      return Boolean(c && (c.isUser || c.tier === "spot" || c.tier === "peri"));
    };
    const at = (place: string) => {
      const want = norm(place.replace(/^the\s+/i, ""));
      return st.place.some((p) => norm(p.replace(/^the\s+/i, "")) === want);
    };
    for (const o of Object.values(st.obligations)) {
      if (o.kind !== "promise" || (o.status !== "open" && o.status !== "due") || o.due?.minutes == null) continue;
      const due = o.due.minutes;
      const win = o.window ?? (o.meet ? 60 : 1440);
      let verdict: "kept" | "broken" | null = null;
      if (o.meet && o.whom && now >= due - win && now <= due + win && here(o.who) && here(o.whom) && at(o.meet)) verdict = "kept";
      // Never broken sooner than its window after it was made: a time already behind the clock when
      // it was promised ("at dinner, 15:05", said at 15:10) is a slip, not a promise broken on arrival.
      else if (now > Math.max(due, o.made ?? due) + win) verdict = "broken";
      if (!verdict) continue;
      o.status = verdict;
      o.settled = ctx.ev.seq;
      this.settleLoop(o, ctx.ev.seq, ctx, false);
      o.auto = true;
      const who = this.nameOf(o.who);
      this.push(ctx, { kind: "promise", text: verdict === "kept" ? `Promise kept: ${o.what}` : o.meet ? `${o.whom ? this.nameOf(o.whom) : "Someone"} was stood up: ${o.what}` : `Promise broken: ${o.what}`, subject: who, path: `obligations.${o.id}`, reason: verdict === "kept" ? "both were there in time" : "the time passed", tone: verdict === "kept" ? "up" : "down", memory: true });
      this.feelPromise(o, ctx, ctx.ev.seq);
    }
  }

  /** "Day 4 06:00", "tomorrow", "tonight", "+2h", "in 3 days" → story minutes. */
  private when(text: string | undefined): number | null {
    if (!text) return null;
    let t = text.trim().toLowerCase();
    const abs = parseStoryTime(text.replace(/^(?:at|on|by)\s+/i, ""));
    const now = this.now();
    const form = this.state.time?.form;
    if (abs && (now == null || !form || abs.form === form)) return abs.minutes;
    if (now == null) return null;
    // A day count on a calendar clock ("Day 1 15:05" on 11 October 2001), or a date on a day count, is
    // off this clock: read as minute 905 of year one, Buffy's promise to Dawn broke as she made it. Its
    // time of day is what was meant.
    if (abs) t = t.match(/(\d{1,2}:\d{2})\s*$/)?.[1] ?? "";
    const day = Math.floor(now / 1440) * 1440;
    const hm = t.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
    const at = (base: number) => {
      if (!hm) return null;
      let h = Number(hm[1]) % 24;
      if (hm[3] === "pm" && h < 12) h += 12;
      if (hm[3] === "am" && h === 12) h = 0;
      return base + h * 60 + Number(hm[2] ?? 0);
    };
    if (/\btomorrow\b/.test(t)) return at(day + 1440) ?? day + 1440 + 9 * 60;
    if (/\btonight\b/.test(t)) return at(day) ?? day + 21 * 60;
    if (/\bdawn\b|\bsunrise\b/.test(t)) return day + (now % 1440 > 6 * 60 ? 1440 : 0) + 6 * 60;
    if (/\bnoon\b/.test(t)) return day + (now % 1440 > 12 * 60 ? 1440 : 0) + 12 * 60;
    if (/\bmidnight\b/.test(t)) return day + 1440;
    const rel = t.match(/^(?:\+|in\s+)(.+)$/);
    if (rel) {
      const d = parseDuration(rel[1]!.replace(/^(\d+)(\w)/, "$1 $2"));
      if (d != null) return now + d;
    }
    const nextDay = t.match(/\bnext\s+week\b/) ? now + 7 * 1440 : null;
    if (nextDay) return nextDay;
    const plain = at(day);
    // E3: "around 9" (said without am or pm) is the next nine that comes, morning or evening.
    if (plain != null && /^around\b/.test(t) && hm && !hm[3] && Number(hm[1]) < 12) return [plain, plain + 720, plain + 1440].find((x) => x >= now) ?? plain + 1440;
    return plain != null ? (plain < now ? plain + 1440 : plain) : null;
  }

  applyOp(op: Op, ctx: Ctx): void {
    const st = this.state;
    const seq = ctx.ev.seq;
    const a = op.args;
    switch (op.op) {
      case "clock": {
        if (this.isLocked("clock") && this.ai(ctx)) return this.reject(ctx, "the clock is locked");
        const now = this.now();
        // A skip in parts saved before Mea read them ("+1h30m | 1996-05-24 15:48") is read again here.
        const late = a.plus == null && typeof a.set === "string" && a.set.trim().startsWith("+") ? leadingDuration(a.set.trim().slice(1)) : null;
        if (a.plus != null || late) {
          if (now == null) return this.reject(ctx, "no time set yet to move from");
          let plus = (a.plus as number | undefined) ?? late!.minutes;
          const capMin = ctx.ev.source === "model" || ctx.ev.source === "inline" ? 7 * 1440 : Infinity;
          if (plus > capMin) {
            this.warn(ctx, `capped a ${Math.round(plus / 1440)}-day jump at 7 days`);
            plus = capMin;
          }
          if (plus <= 0) return;
          return this.moveClock(now + plus, st.time!.form, ctx);
        }
        const t = parseStoryTime(a.set);
        if (!t) return this.reject(ctx, "use +45m, +2h, Day N HH:MM or YYYY-MM-DD HH:MM");
        // M26: "Day N" and a calendar date count minutes from different starts; only the setup, you
        // or /timeskip can switch between them (and bodies don't drift across the switch).
        if (now != null && t.form !== st.time!.form && ctx.ev.source !== "init" && ctx.ev.source !== "user" && ctx.ev.source !== "timeskip")
          return this.reject(ctx, st.time!.form === "day" ? "the clock counts days here: use Day N HH:MM or +2h" : "the clock follows a calendar here: use YYYY-MM-DD HH:MM or +2h");
        if (now != null && t.minutes < now && !a.flashback && this.ai(ctx) && ctx.ev.source !== "timeskip")
          return this.reject(ctx, "story time can't go backwards (write flashback if it's one)");
        if (now != null && t.minutes - now > 7 * 1440 && this.ai(ctx) && ctx.ev.source !== "timeskip" && ctx.ev.source !== "init") this.warn(ctx, "a jump of more than a week");
        return this.moveClock(t.minutes, t.form, ctx, a.flashback ? "flashback" : undefined);
      }
      case "wx": {
        if (!a.to) return this.reject(ctx, "no weather given");
        const prev = st.weather?.now;
        if (prev && norm(prev) === norm(a.to)) return;
        st.weather = { now: clip(a.to), prev, seq };
        this.push(ctx, { kind: "weather", text: prev ? `${prev} → ${a.to}` : a.to, path: "weather", from: prev, to: a.to });
        return;
      }
      case "occasion": {
        if (!a.to) return this.reject(ctx, "no occasion given");
        if (/^(?:off|none|over|ended?|finished)$/i.test(String(a.to).trim())) {
          this.endOccasion(ctx);
          return;
        }
        const prev = st.occasion?.now;
        if (prev && norm(prev) === norm(a.to)) return;
        st.occasion = { now: clip(a.to), seq, at: st.time?.minutes ?? null, root: norm(st.place[0] ?? "") };
        this.push(ctx, { kind: "occasion", text: prev ? `${prev} → ${a.to}` : a.to, path: "occasion", from: prev, to: a.to });
        return;
      }
      case "at": {
        const written = (a.path as string[]).map((s) => clip(s)).filter(Boolean);
        if (!written.length) return this.reject(ctx, "no place given");
        if (this.isLocked("place") && this.ai(ctx)) return this.reject(ctx, "the place is locked");
        const before = st.place;
        // E2: what was in the place you're leaving, for "what's changed since you were last here".
        const left = st.placeId ? st.places[st.placeId] : this.placeAt(before);
        // docs/30 2.2: the path as the tree knows it ("downstairs kitchen" is Sunnydale › Winters Residence › kitchen).
        const found = this.placeFor(written, ctx, seq);
        if (!found) return this.reject(ctx, "no place given");
        // docs/30 2.2: homes made apart that are one home, a street that is a home's address, fold together now.
        const book0 = this.placeBook;
        book0.settle(book0.buildingOf(found) ?? found, left);
        const p = st.places[found.id] ?? (st.placeId ? st.places[st.placeId] : undefined) ?? found;
        const path = p.path;
        // The same place (perhaps under a name the story now uses more): no move.
        if ((left && left.id === p.id) || before.join(" › ").toLowerCase() === path.join(" › ").toLowerCase()) {
          st.placeId = p.id;
          st.place = path;
          return;
        }
        if (left && left.id !== p.id) {
          left.seen = itemsAt(st, left).map((i) => i.id);
          left.leftSeq = seq;
        }
        st.place = path;
        st.placeId = p.id;
        p.visits++;
        p.lastSeq = seq;
        // A move to a different building or further starts a new scene. docs/30 2.2: by the places themselves,
        // so a place that took another name isn't a move.
        const book = this.placeBook;
        const was = left ? book.chainOf(left).map((x) => x.id) : before.map(norm);
        const now = left ? book.chainOf(p).map((x) => x.id) : path.map(norm);
        const common = was.findIndex((x, i) => x !== now[i]);
        const moved = before.length > 0 && (common < 0 ? was.length !== now.length : common < Math.max(1, now.length - 1));
        if (moved) this.newScene(seq);
        const along = Object.values(st.chars).filter((c) => c.tier === "spot" || c.tier === "peri");
        for (const c of along) c.place = path.join(" › ");
        // Whoever this message sent ahead to where the scene now goes is in it.
        for (const [id, dest] of this.castTurn(ctx).heading) {
          const c = st.chars[id];
          if (c && c.tier === "off" && !c.dead && this.goesHere(dest)) this.comeIn(ctx, c, seq);
        }
        if (moved) {
          const t = this.castTurn(ctx);
          t.move = { from: before, carried: along.map((c) => c.id) };
          this.leftBehind(ctx);
        }
        this.push(ctx, { kind: "place", text: before.length ? `${before.at(-1)} → ${path.at(-1)}` : path.join(" › "), path: "place", from: before.join(" › "), to: path.join(" › "), ...(moved ? { newScene: true } : {}) });
        // An occasion stays where it was: leaving the castle or the town leaves it behind.
        if (st.occasion?.root && norm(path[0] ?? "") !== st.occasion.root) this.endOccasion(ctx);
        return;
      }
      case "scene": {
        if (a.mode) this.setMode(String(a.mode), seq);
        if (a.to && norm(a.to) !== norm(st.sceneTitle ?? "")) {
          const fresh = Boolean(st.sceneTitle);
          if (fresh) this.newScene(seq);
          st.sceneTitle = clip(a.to);
          // newScene marks a real change of scene (not the first title), which memory treats as a break.
          this.push(ctx, { kind: "scene", text: `Scene: ${st.sceneTitle}`, path: "scene", ...(fresh ? { newScene: true } : {}) });
        }
        return;
      }
      case "mode":
        this.setMode(String(a.to), seq);
        return;
      case "cast": {
        const turn = this.castTurn(ctx);
        turn.cast = true;
        // Events stored before castArgs dropped "traits: …" bits still carry them.
        const list = (a.list as { name: string; tier: string; note?: string }[]).filter((x) => !castLabel(x.name));
        // docs/30 0.2: "Scoobies@spot" brings in its members; "traits@spot" and "Downstairs Kitchen@spot" bring in nobody.
        const named = list.flatMap((x) =>
          this.each(x.name).flatMap((name) => {
            const w = this.whoIs(name);
            if (w.kind === "many") this.routed(w, seq);
            return (w.kind === "many" ? w.names : [name]).map((n) => ({ ...x, name: n }));
          }),
        );
        for (const it of named) {
          const c = this.person(it.name, seq);
          if (!c) continue;
          turn.named.add(c.id);
          if (c.dead && /spot|peri|arrive/.test(it.tier)) {
            this.warn(ctx, `${c.name} is dead`);
            continue;
          }
          const was = c.tier;
          const dest = it.note && /→/.test(it.note) ? it.note.replace(/^.*→\s*/, "").trim() : "";
          const leaving = /^(left|leave|leaves|off|away|gone|exit\w*)$/.test(it.tier);
          if (leaving && dest) turn.heading.set(c.id, dest);
          const tier = leaving && !(dest && this.goesHere(dest)) ? "off" : /^peri/.test(it.tier) ? "peri" : "spot";
          c.tier = tier;
          if (tier !== "off") this.inScene(c);
          c.activity = it.note ? clip(it.note.replace(/^(→|←)\s*/, "")) : tier === "off" ? undefined : c.activity;
          if (tier !== "off") {
            c.place = st.place.join(" › ") || c.place;
            for (const k of ["hunger", "thirst", "fatigue"] as const) if (c.meters[k] == null && !c.isUser) c.meters[k] = 1;
            c.driftAt ??= this.now();
          } else if (it.note && /→/.test(it.note)) c.place = clip(it.note.replace(/^.*→\s*/, ""));
          if (was !== tier) {
            if (tier === "off" && was) this.push(ctx, { kind: "cast", text: `${c.name} left${c.activity ? "" : ""}`, subject: c.name, path: `chars.${c.id}.tier` });
            else if (tier !== "off" && (was === "off" || !was) && !c.isUser && c.firstSeq !== seq) this.push(ctx, { kind: "cast", text: `${c.name} arrived`, subject: c.name, path: `chars.${c.id}.tier` });
            else if (tier !== "off" && !was && !c.isUser) this.push(ctx, { kind: "cast", text: `${c.name} appears`, subject: c.name, path: `chars.${c.id}.tier` });
          }
          c.lastSeq = seq;
        }
        this.leftBehind(ctx);
        // docs/30 2.4: someone new at a home may be one who lives there (the lore's family, a home named for them).
        const here = st.placeId ? st.places[st.placeId] : undefined;
        if (here && named.length) this.homeEvidence(here);
        return;
      }
      case "mood": {
        const c = this.person(op.subject, seq);
        if (!c) return this.reject(ctx, "whose mood?");
        if (c.isUser && this.cfg.sealedPersona && this.ai(ctx)) return this.reject(ctx, "your character's inner life is yours to write");
        if (this.isLocked(`chars.${c.id}.mood`) && this.ai(ctx)) return this.reject(ctx, "locked");
        if (!a.to) return this.reject(ctx, "no mood given");
        const prev = c.mood?.name;
        if (prev && norm(prev) === norm(a.to)) return;
        c.mood = { name: clip(a.to), v: clamp(a.v, -3, 3), a: clamp(a.a, 0, 5), d: clamp(a.d, -3, 3), prev, seq };
        this.push(ctx, { kind: "mood", text: `${c.name}: ${c.mood.name}`, subject: c.name, path: `chars.${c.id}.mood`, from: prev, to: c.mood.name });
        return;
      }
      case "body": {
        const c = this.person(op.subject, seq);
        if (!c) return this.reject(ctx, "whose body?");
        if (this.isLocked(`chars.${c.id}.body`) && this.ai(ctx)) return this.reject(ctx, "locked");
        const now = this.now();
        for (const m of a.meters as { meter: string; delta?: number; set?: number }[]) {
          const k = METER_ALIASES[m.meter];
          if (!k || !(METERS as readonly string[]).includes(k)) {
            c.flags = uniq([...c.flags, `${m.meter} ${m.set ?? m.delta}`]);
            continue;
          }
          const prev = c.meters[k];
          const next = clamp(m.set ?? (prev ?? (k === "health" || k === "composure" ? 5 : 0)) + (m.delta ?? 0), 0, 5)!;
          if (prev === next) continue;
          c.meters[k] = next;
          // Meters drift in fractions between replies; the chip shows the whole steps people read.
          this.push(ctx, { kind: "body", text: `${c.name}: ${k} ${prev == null ? "–" : Math.round(prev)} → ${Math.round(next)}`, subject: c.name, path: `chars.${c.id}.meters.${k}`, from: prev, to: next, tone: (k === "health" || k === "composure") === next > (prev ?? next) ? "up" : "down" });
        }
        for (const inj of a.injuries as { where: string; severity?: string; treated?: boolean; heal?: boolean }[]) {
          const where = clip(inj.where);
          const cur = c.injuries.find((i) => overlap(i.where, where) >= 0.5 || norm(i.where) === norm(where));
          if (inj.heal) {
            if (cur) {
              c.injuries = c.injuries.filter((i) => i !== cur);
              this.push(ctx, { kind: "body", text: `${c.name}: ${cur.where} healed`, subject: c.name, path: `chars.${c.id}.injuries`, tone: "up" });
            }
            continue;
          }
          const sev = severityOf(inj.severity);
          if (cur) {
            if (inj.treated && !cur.treated) cur.treated = true;
            if (sev > cur.severity) {
              cur.severity = sev;
              cur.worst = Math.max(cur.worst, sev) as typeof cur.worst;
              cur.since = now;
              this.push(ctx, { kind: "body", text: `${c.name}: ${where} worse (${SEVERITY[sev]})`, subject: c.name, path: `chars.${c.id}.injuries`, tone: "down" });
            }
            continue;
          }
          c.injuries.push({ where, severity: sev, treated: !!inj.treated, since: now, worst: sev });
          this.push(ctx, { kind: "body", text: `${c.name} hurt: ${where} (${SEVERITY[sev]})`, subject: c.name, path: `chars.${c.id}.injuries`, tone: "down", memory: sev >= 3 });
        }
        for (const f of a.flags as string[]) {
          const kinds = conditionsIn(f);
          if (kinds.length && endsCondition(f)) {
            c.conditions = c.conditions.filter((k) => !kinds.includes(k.kind));
            continue;
          }
          let added = false;
          for (const k of kinds) if (addCondition(c, k, f, now)) added = true;
          if (added) this.push(ctx, { kind: "body", text: `${c.name}: ${f}`, subject: c.name, path: `chars.${c.id}.conditions`, tone: "down" });
          else if (!kinds.length && !c.flags.some((x) => norm(x) === norm(f))) {
            c.flags = uniq([...c.flags, clip(f)]).slice(-12);
            this.push(ctx, { kind: "body", text: `${c.name}: ${f}`, subject: c.name, path: `chars.${c.id}.flags` });
          }
        }
        for (const x of a.clear as string[]) {
          c.flags = c.flags.filter((f) => !norm(f).includes(norm(x)));
          const kinds = conditionsIn(x);
          c.conditions = c.conditions.filter((k) => !kinds.includes(k.kind));
        }
        return;
      }
      case "look": {
        const c = this.person(op.subject, seq);
        if (!c || !a.to) return this.reject(ctx, "whose look?");
        if (this.isLocked(`chars.${c.id}.look`) && this.ai(ctx)) return this.reject(ctx, "locked");
        if (c.look && norm(c.look) === norm(a.to)) return;
        c.look = clip(a.to);
        this.push(ctx, { kind: "look", text: `${c.name}: ${clip(a.to)}`, subject: c.name, path: `chars.${c.id}.look` });
        return;
      }
      case "trait": {
        const c = this.person(op.subject, seq);
        if (!c) return this.reject(ctx, "whose traits?");
        for (const text of a.list as string[]) {
          const kind = traitKind(text);
          const cur = kind !== "other" ? c.traits.find((t) => t.kind === kind) : c.traits.find((t) => norm(t.text) === norm(text));
          const by: Trait["by"] = ctx.ev.source === "user" ? "user" : ctx.ev.source === "init" ? "card" : "model";
          if (cur && norm(cur.text) === norm(text)) continue;
          // Looks that don't drift: the user's word and the card hold against the story.
          if (cur && (cur.by === "user" || cur.by === "card") && by === "model") {
            if (!/\b(dye|dyed|contacts|magic|spell|cut|shaved|grew|surgery|transform\w*|changed)\b/i.test(`${text} ${op.cause ?? ""}`)) {
              this.warn(ctx, `kept "${cur.text}" (${cur.by === "user" ? "your word" : "from the card"})`);
              continue;
            }
          }
          if (cur) c.traits = c.traits.filter((t) => t !== cur);
          c.traits.push({ kind, text: clip(text), by, seq });
          this.push(ctx, { kind: "trait", text: `${c.name}: ${clip(text)}`, subject: c.name, path: `chars.${c.id}.traits.${kind}`, from: cur?.text, to: text });
        }
        return;
      }
      case "drive":
      case "mask": {
        const c = this.person(op.subject, seq);
        if (!c) return this.reject(ctx, "whose?");
        if (c.isUser && this.cfg.sealedPersona && this.ai(ctx)) return this.reject(ctx, "your character's inner life is yours to write");
        const target = op.op === "drive" ? c.drives : (c.mask ??= {});
        const keys = op.op === "drive" ? ["want", "fear", "need", "tactic"] : ["shown", "felt", "tell"];
        let any = false;
        for (const k of keys) {
          if (!a[k]) continue;
          if ((target as Record<string, string>)[k] && norm((target as Record<string, string>)[k]!) === norm(a[k])) continue;
          (target as Record<string, string>)[k] = clip(a[k]);
          any = true;
          if (op.op === "mask" && k === "felt") this.push(ctx, { kind: "mask", text: `${c.name} hides: ${clip(a[k])}`, subject: c.name, path: `chars.${c.id}.mask`, to: a[k] });
          if (op.op === "drive" && k === "want") this.push(ctx, { kind: "drive", text: `${c.name} wants: ${clip(a[k])}`, subject: c.name, path: `chars.${c.id}.drives.want` });
        }
        if (!any && !keys.some((k) => a[k])) return this.reject(ctx, `write ${keys.join(": / ")}:`);
        return;
      }
      case "think": {
        const c = this.person(op.subject, seq);
        if (!c || !a.text) return this.reject(ctx, "whose thoughts?");
        if (c.isUser && this.cfg.sealedPersona && this.ai(ctx)) return this.reject(ctx, "your character's inner life is yours to write");
        // The tracker writes thoughts only for people in the scene: one for someone it has away means they came in without a cast line.
        if ((ctx.ev.source === "model" || ctx.ev.source === "inline") && !c.isUser && !c.dead && c.tier !== "spot" && c.tier !== "peri" && !this.castTurn(ctx).named.has(c.id)) this.comeIn(ctx, c, seq);
        c.thoughts = { text: a.text.trim(), seq };
        // A private change: the thoughts drawer under the reply reads it; the chips never show it.
        this.push(ctx, { kind: "thought", text: `${c.name} thinks`, subject: c.name, path: `chars.${c.id}.thoughts`, to: c.thoughts.text });
        return;
      }
      case "journal": {
        const c = this.person(op.subject, seq);
        if (!c || !a.text) return this.reject(ctx, "whose journal?");
        if (c.isUser && this.cfg.sealedPersona && this.ai(ctx)) return this.reject(ctx, "your character's inner life is yours to write");
        c.journal.push({ text: clip(a.text), seq, at: st.time ? formatStoryTime(st.time) : null });
        if (c.journal.length > 40) c.journal.splice(0, c.journal.length - 40);
        this.push(ctx, { kind: "journal", text: `${c.name}'s journal`, subject: c.name, path: `chars.${c.id}.journal`, to: a.text });
        return;
      }
      case "dead": {
        const c = this.person(op.subject, seq);
        if (!c) return this.reject(ctx, "who died?");
        if (c.isUser && this.ai(ctx)) return this.reject(ctx, "only you decide your character's fate");
        if (c.dead) return;
        c.dead = true;
        c.tier = "off";
        this.push(ctx, { kind: "death", text: `${c.name} died`, subject: c.name, reason: op.cause ?? a.text, path: `chars.${c.id}.dead`, tone: "down", memory: true });
        st.milestones.push({ text: `${c.name} died${op.cause ? ` (${op.cause})` : ""}`, who: [c.id], seq, at: st.time ? formatStoryTime(st.time) : null });
        return;
      }
      case "rename": {
        const c = this.findChar(op.subject ?? "");
        if (!c || !a.to) return this.reject(ctx, "rename whom?");
        c.aliases = uniq([...c.aliases, c.name]);
        c.name = clip(a.to);
        this.leadNames(c);
        return;
      }
      case "merge": {
        if (ctx.ev.source !== "user") return this.reject(ctx, "only you can merge people");
        const from = this.findChar(op.subject ?? "");
        const into = this.findChar(a.to ?? "");
        if (!from || !into) return this.reject(ctx, "merge whom into whom?");
        if (from.id === into.id) return;
        if (from.isUser) return this.reject(ctx, "your character can't be merged away");
        this.mergeChars(from, into);
        this.push(ctx, { kind: "cast", text: `${from.name} is ${into.name}`, subject: into.name, path: `chars.${into.id}` });
        return;
      }
      case "edit": {
        if (ctx.ev.source !== "user") return this.reject(ctx, "only you can edit fields directly");
        const path = (a.path as (string | number)[]).map(String);
        const err = editPath(st, path, a.value);
        if (err) return this.reject(ctx, err);
        // Whatever was typed, a person keeps the shape the rest of the app reads.
        if (path[0] === "chars" && path[1] && st.chars[path[1]]) repairChar(st.chars[path[1]]!, path[1]);
        // A person removed takes their bonds and ladders with them.
        if (path.length === 2 && path[0] === "chars" && a.value == null) {
          for (const k of Object.keys(st.bonds)) if (k.split(">").includes(path[1]!)) delete st.bonds[k];
          for (const k of Object.keys(st.ladders)) if (k.split(">").includes(path[1]!)) delete st.ladders[k];
        }
        const who = path[0] === "chars" && path[1] ? st.chars[path[1]]?.name : undefined;
        this.push(ctx, { kind: "edit", text: `Edited ${who ? `${who} · ` : ""}${path.slice(who ? 2 : 0).join(" › ") || path.join(" › ")}`, subject: who, path: path.join("."), to: a.value });
        return;
      }
      case "bond": {
        const from = this.person(op.subject, seq);
        const to = this.person(op.object, seq);
        if (!from || !to) return this.reject(ctx, "write bond A>B: axis ±N");
        if (from.id === to.id) return this.reject(ctx, "a bond needs two people");
        if (from.isUser && this.cfg.sealedPersona && this.ai(ctx) && (a.moves as unknown[]).length) return this.reject(ctx, "how your character feels is yours to write");
        if (!this.needCause(ctx, op)) return;
        const key = `${from.id}>${to.id}`;
        const b = (st.bonds[key] ??= { from: from.id, to: to.id, axes: {}, tags: [], history: [] });
        if (this.isLocked(`bonds.${key}`) && this.ai(ctx)) return this.reject(ctx, "locked");
        for (const m of a.moves as { axis: string; delta?: number; set?: number }[]) {
          const axis = AXIS_ALIASES[m.axis.replace(/s$/, "")] ?? AXIS_ALIASES[m.axis];
          if (!axis || !(AXES as readonly string[]).includes(axis)) {
            this.warn(ctx, `unknown axis "${m.axis}"`);
            continue;
          }
          const lo = (BIPOLAR_AXES as readonly string[]).includes(axis) ? -5 : 0;
          const prev = b.axes[axis] ?? 0;
          let next = m.set != null ? m.set : prev + (m.delta ?? 0);
          next = Math.max(lo, Math.min(5, Math.round(next)));
          let delta = next - prev;
          let flag: string | undefined;
          // TRK-11 / ALMANAC §8.2: typical ±1, major ±2, ±3 only for betrayal, rescue or the unforgivable.
          const limit = BIG_CAUSE.test(op.cause ?? "") ? 3 : 2;
          if (this.ai(ctx) && ctx.ev.source !== "init" && Math.abs(delta) > limit) {
            if (this.cfg.limits) {
              flag = `capped from ${delta > 0 ? "+" : ""}${delta}`;
              delta = Math.sign(delta) * limit;
              next = prev + delta;
            } else flag = "big jump";
          }
          if (!delta) continue;
          b.axes[axis] = next;
          b.history.push({ axis, from: prev, to: next, delta, cause: op.cause, seq });
          if (b.history.length > 200) b.history.splice(0, b.history.length - 200);
          const good = axis === "fear" || axis === "resentment" || axis === "rivalry" ? delta < 0 : delta > 0;
          this.push(ctx, {
            kind: "bond",
            text: `${from.name} → ${to.name} · ${cap(axis)} ${delta > 0 ? "+" : ""}${delta}`,
            subject: from.name,
            reason: op.cause,
            path: `bonds.${key}.${axis}`,
            from: prev,
            to: next,
            tone: good ? "up" : "down",
            ...(flag ? { flag } : {}),
          });
        }
        if (a.label && norm(a.label) !== norm(b.label ?? "")) {
          const prev = b.label;
          b.label = clip(a.label);
          this.push(ctx, { kind: "bond", text: `${from.name} → ${to.name}: ${b.label}`, subject: from.name, reason: op.cause, path: `bonds.${key}.label`, from: prev, to: b.label, memory: true });
        }
        for (const t of a.tagsAdd as string[]) if (t && !b.tags.includes(t.toLowerCase())) b.tags.push(t.toLowerCase());
        b.tags = b.tags.filter((t) => !(a.tagsRemove as string[]).includes(t));
        return;
      }
      case "ladder": {
        const from = this.person(op.subject, seq);
        const to = this.person(op.object, seq);
        if (!from || !to || from.id === to.id) return this.reject(ctx, "write ladder A>B: tier N");
        if (from.isUser && this.ai(ctx)) return this.reject(ctx, "your character's side of a romance changes only through your words");
        let tier: number | undefined = a.tier;
        if (tier == null && a.word) {
          const i = LADDER.findIndex((n) => n.toLowerCase() === a.word);
          tier = i >= 0 ? i : LADDER_WORDS[a.word as string];
        }
        if (tier == null || tier < 0 || tier > 7) return this.reject(ctx, `a rung 0–7 (${LADDER.join(", ")})`);
        const key = `${from.id}>${to.id}`;
        const cur = st.ladders[key];
        const prev = cur?.tier ?? (this.cfg.romance === "established" ? 7 : 0);
        if (tier === prev) return;
        const up = tier > prev;
        // A romance starts from something romantic: attraction on the bond, or a romantic cause. Shock or tension isn't one.
        if (!cur && up && this.ai(ctx) && ctx.ev.source !== "init" && this.cfg.romance !== "established" && !((st.bonds[key]?.axes.attraction ?? 0) > 0) && !ROMANCE_CAUSE.test(op.cause ?? ""))
          return this.reject(ctx, "a romance starts from attraction or a romantic moment; tension between friends is a bond");
        if (this.ai(ctx) && up) {
          const pace = this.cfg.romance;
          if (pace === "off") return this.reject(ctx, "romance is off in this story");
          const scenesSince = cur ? st.sceneNo - cur.scene : 99;
          const maxStep = pace === "fast" ? 2 : 1;
          if (tier - prev > maxStep) {
            this.warn(ctx, `${pace} pace: one rung at a time`);
            tier = prev + maxStep;
          }
          if (pace === "slow" && prev >= 1 && scenesSince < 2) return this.reject(ctx, "slow burn: a step up needs two separate scenes of returned signals");
          if (pace === "measured" && prev >= 1 && scenesSince < 1) return this.reject(ctx, "measured pace: one step per scene");
        }
        // A rung is lost to betrayal, neglect, cruelty or a revealed lie, never to a re-read of the moment.
        if (!up && this.ai(ctx) && !DOWN_CAUSE.test(op.cause ?? ""))
          return this.reject(ctx, LADDER_WARM.test(op.cause ?? "") ? "a warm beat doesn't lower the ladder" : `the ladder is at ${LADDER[prev]} (${prev}/7); it only drops for a betrayal, neglect, cruelty or a revealed lie`);
        const l = (st.ladders[key] ??= { from: from.id, to: to.id, tier: prev, seq, scene: st.sceneNo, history: [] });
        l.tier = tier;
        l.evidence = op.cause;
        l.seq = seq;
        l.scene = st.sceneNo;
        l.history.push({ tier, evidence: op.cause, seq });
        this.push(ctx, { kind: "romance", text: `${from.name} → ${to.name}: ${LADDER[tier]} (${tier}/7)`, subject: from.name, reason: op.cause, path: `ladders.${key}`, from: LADDER[prev], to: LADDER[tier], tone: up ? "up" : "down", memory: tier >= 5 || !up });
        return;
      }
      case "know": {
        // docs/31 1.1: whoever you said wasn't there doesn't learn it from this line.
        const all = this.people(op.subject, seq);
        const holders = all.filter((c) => !this.notThere(op, c.name) && !this.notThere(op, c.name, "away"));
        if (all.length && !holders.length) return this.reject(ctx, `you said ${all.map((c) => c.name).join(", ")} wasn't there`);
        if (!holders.length || !a.fact) return this.reject(ctx, "write know Holder: fact | route · status · truth");
        if (!this.needCause(ctx, op) && !a.route) return;
        const f = this.fact(a.key, a.fact, seq, a.truth);
        const status = (a.status ?? "knows") as KnowStatus;
        const one = holders.length === 1;
        for (const holder of holders) {
          const cur = f.stances[holder.id];
          if (cur?.set && this.ai(ctx)) {
            if (one) return this.reject(ctx, "you set what they know about this");
            continue;
          }
          if (cur && cur.status === status) continue;
          // 2.3: what a flagged leak let out doesn't count as learned while the flag is open.
          const held = /knows|believes|suspects/.test(status) && this.ai(ctx) && ctx.ev.messageId ? this.cfg.held?.find((h) => h.messageId === ctx.ev.messageId && norm(h.who) === norm(holder.name) && overlap(h.text, f.statement) >= 0.4) : undefined;
          if (held) {
            if (one) return this.reject(ctx, `held: the checker flagged this reply for letting it out to ${holder.name}; it counts once you dismiss the flag or fix the sentence`);
            continue;
          }
          f.stances[holder.id] = { status, route: a.route ?? op.cause, seq, ...(ctx.ev.source === "user" ? { set: true } : {}) };
          if (f.secret?.from.includes(holder.id) && /knows|believes|suspects/.test(status)) f.secret.from = f.secret.from.filter((x) => x !== holder.id);
          this.push(ctx, { kind: "knowledge", text: `${holder.name} ${status === "knows" ? "learned" : status === "heard" ? "now has heard" : `now ${status}`}: ${clip(f.statement)}`, subject: holder.name, reason: a.route ?? op.cause, path: `facts.${f.key}.${holder.id}`, ...(this.notThere(op, holder.name, "unsure") ? { flag: UNSURE_FLAG } : {}) });
        }
        return;
      }
      case "secret": {
        if (!a.fact && !a.key) return this.reject(ctx, "write secret #key: fact | kept by A · from B");
        const ids = (xs: unknown) => uniq(((xs ?? []) as string[]).flatMap((n) => this.people(n, seq).map((c) => c.id)));
        const named = ((a.from ?? []) as string[]).filter((n) => n.trim());
        const all = named.some((n) => EVERYONE_WORD(norm(personName(n))));
        const fromIds = ids(named.filter((n) => !EVERYONE_WORD(norm(personName(n)))));
        // docs/30 1.3: kept from a group: from whoever joins it later too.
        const fromGroups = named.flatMap((n) => {
          const w = this.whoIs(n);
          return w.kind === "many" && w.as === "faction" ? [groupKey(w.group)] : [];
        });
        if (named.length && !all && !fromIds.length) return this.reject(ctx, `from whom? "${named.join(", ")}" isn't anyone in the story; name the people`);
        const f = this.fact(a.key, a.fact ?? a.key, seq, "true");
        const keepers = uniq([...(f.secret?.keepers ?? []), ...ids(a.keepers)]);
        const knownTo = ids(a.knownTo).filter((id) => !keepers.includes(id));
        const suspects = ids(a.suspectedBy).filter((id) => !keepers.includes(id) && !knownTo.includes(id));
        for (const id of knownTo) if (!f.stances[id]?.set) f.stances[id] = { status: "knows", route: "known to them", seq };
        for (const id of suspects) if (!f.stances[id]?.set) f.stances[id] = { status: "suspects", route: "suspects it", seq };
        // "from everyone" / "from the public": everyone but the keepers, now and whoever turns up later.
        const everyone = all || Boolean(f.secret?.everyone);
        const wanted = uniq([...fromIds, ...(all ? Object.values(st.chars).filter((c) => !c.isUser).map((c) => c.id) : [])]).filter((id) => !keepers.includes(id) && !knownTo.includes(id) && !suspects.includes(id));
        // Someone who already found out isn't put back in the dark by the secret being written again (only you can).
        const told = (id: string) => /knows|believes|suspects/.test(f.stances[id]?.status ?? "");
        const back = ctx.ev.source === "user" ? [] : wanted.filter(told);
        const from = uniq([...(f.secret?.from ?? []), ...wanted.filter((id) => !back.includes(id))]).filter((id) => !keepers.includes(id));
        const groups = uniq([...(f.secret?.groups ?? []), ...fromGroups]);
        f.secret = { keepers, from, ...(everyone ? { everyone: true } : {}), ...(groups.length ? { groups } : {}) };
        if (back.length) ctx.verdict.reason = `${back.map((x) => this.nameOf(x)).join(", ")} already found out, and still knows`;
        for (const k of keepers) f.stances[k] ??= { status: "knows", route: "keeps it", seq };
        for (const k of from) if (!f.stances[k] || f.stances[k]!.status === "unaware") f.stances[k] = { status: "unaware", route: "kept from them", seq };
        this.push(ctx, { kind: "secret", text: `Secret: ${clip(f.statement)}`, path: `facts.${f.key}`, reason: op.cause });
        return;
      }
      case "reveal": {
        const f = a.key ? st.facts[slug(a.key)] ?? Object.values(st.facts).find((x) => overlap(x.statement, a.key) > 0.6) : undefined;
        if (!f) return this.reject(ctx, "no such secret or fact");
        const to = uniq(((a.to ?? []) as string[]).flatMap((n) => this.people(n, seq).map((c) => c.id)));
        for (const id of to) f.stances[id] = { status: "knows", route: op.cause ?? "revealed", seq };
        if (f.secret) f.secret.from = f.secret.from.filter((x) => !to.includes(x));
        f.revealed.push({ to, seq, how: op.cause });
        this.push(ctx, { kind: "secret", text: `Revealed to ${to.map((x) => this.nameOf(x)).join(", ") || "someone"}: ${clip(f.statement)}`, path: `facts.${f.key}`, reason: op.cause, tone: "warn", memory: true });
        return;
      }
      case "pressure": {
        // E1: drawn by the engine, or set by you; the model never writes them (they're hidden from it as text to play, not to report).
        if (ctx.ev.source !== "engine" && ctx.ev.source !== "user") return this.reject(ctx, "pressures are drawn by Mea, not the ledger");
        const c = this.person(op.subject, seq);
        if (!c || c.isUser) return this.reject(ctx, "whose pressure?");
        const cur = c.pressure;
        if (cur?.locked && ctx.ev.source === "engine" && a.lock !== false) return;
        const stage = (["hidden", "growing", "cracking", "head", "resolved"].includes(a.stage) ? a.stage : undefined) as NonNullable<typeof c.pressure>["stage"] | undefined;
        const text = a.text ? clip(a.text) : cur?.text;
        if (!text) return this.reject(ctx, "write pressure Name: what they carry | stage: hidden");
        const next = {
          text,
          stage: stage ?? (a.text && a.text !== cur?.text ? "hidden" : (cur?.stage ?? "hidden")),
          by: (["deck", "grounded", "you"].includes(a.by) ? a.by : (cur?.by ?? "you")) as "deck" | "grounded" | "you",
          locked: a.lock != null ? Boolean(a.lock) : cur?.locked,
          scene: st.sceneNo,
          seq,
          draws: Number(a.draw) || cur?.draws || 1,
          history: [...(cur?.history ?? [])],
        };
        if (cur && cur.text === next.text && cur.stage === next.stage && cur.locked === next.locked) return;
        next.history.push({ stage: next.stage, ...(next.text !== cur?.text ? { text: next.text } : {}), seq });
        c.pressure = next;
        this.push(ctx, { kind: "pressure", text: next.stage === "resolved" ? `${c.name}'s pressure eases` : !cur || cur.text !== next.text ? `${c.name} carries something` : `${c.name}: pressure ${next.stage}`, path: `chars.${c.id}.pressure`, reason: op.cause, tone: next.stage === "cracking" || next.stage === "head" ? "warn" : undefined });
        return;
      }
      case "expose": {
        // B2: only the engine (rules after each reply) and you move a secret's exposure clock.
        if (ctx.ev.source !== "engine" && ctx.ev.source !== "user") return this.reject(ctx, "exposure is moved by Mea, not the ledger");
        const f = a.key ? (st.facts[slug(a.key)] ?? Object.values(st.facts).find((x) => overlap(x.statement, a.key) > 0.6)) : undefined;
        if (!f) return this.reject(ctx, "no such secret");
        const e = ((st.exposure ??= {})[f.key] ??= { cur: 0, max: 6, history: [], near: {} });
        const prev = e.cur;
        e.cur = Math.max(0, Math.min(e.max, a.cur ?? prev + (a.delta ?? 0)));
        const who = a.who ? this.person(a.who, seq) : undefined;
        if (who && e.cur !== prev) {
          const n = (e.near[who.id] ??= { score: 0, why: [] });
          n.score = Math.max(0, n.score + (e.cur - prev));
          if (e.cur > prev && op.cause) n.why = [...n.why.filter((w) => w !== op.cause), op.cause].slice(-4);
        }
        if (e.cur === prev) return;
        e.history.push({ delta: e.cur - prev, v: e.cur, why: op.cause, who: who?.id, seq });
        this.push(ctx, { kind: "secret", text: `Exposure ${e.cur}/${e.max}: ${clip(f.statement)}`, path: `exposure.${f.key}`, reason: op.cause, from: prev, to: e.cur, tone: e.cur >= e.max ? "warn" : e.cur > prev ? "due" : undefined, memory: e.cur >= e.max });
        return;
      }
      case "item": {
        // Owner first ("item Jackie: silver bracelet", "item Jackie: Lucky Strike → gone") means the thing she has.
        const owner = op.subject && !st.items[slug(clip(op.subject))] && !sameThing(st.items, clip(op.subject)) ? this.findChar(op.subject) : undefined;
        if (owner) {
          const thing = String(a.from ?? a.to ?? "").replace(/^at\s+/i, "").trim();
          if (!thing || this.findChar(thing)) return this.reject(ctx, "write item Thing: from → to (the thing first, not its owner)");
          const args = a.from ? { ...a, from: owner.name } : { ...a, to: owner.name };
          return this.applyOp({ ...op, subject: thing, args }, ctx);
        }
        const said = clip(op.subject);
        if (!said) return this.reject(ctx, "which item?");
        if (!this.needCause(ctx, op)) return;
        // docs/26 6.1: one thing, one record, however it's described this time.
        const known = st.items[slug(said)] ?? sameThing(st.items, said);
        const id = known?.id ?? slug(said);
        const it = known ?? (st.items[id] = { id, name: said, custody: [], lastSeq: seq });
        if (said.length > it.name.length) it.name = said;
        const name = it.name;
        if (this.isLocked(`items.${id}`) && this.ai(ctx)) return this.reject(ctx, "locked");
        it.lastSeq = seq;
        if (a.owner) {
          const o = this.findChar(a.owner);
          it.owner = o?.id ?? clip(a.owner);
          return;
        }
        if (a.condition) {
          it.condition = clip(a.condition);
          this.push(ctx, { kind: "item", text: `${name}: ${it.condition}`, path: `items.${id}` });
          return;
        }
        if (a.gone) {
          it.gone = true;
          const was = it.holder;
          it.holder = undefined;
          it.custody.push({ from: was, how: a.gone, seq, ...this.where() });
          // E2: a lost gift is noticed (it goes to memory, and the note tells the giver's scenes).
          const from = it.gift ? this.findChar(it.gift) : undefined;
          this.push(ctx, { kind: "item", text: it.gift ? `${name} (a gift from ${it.gift}): ${a.gone}` : `${name}: ${a.gone}`, path: `items.${id}`, reason: op.cause, tone: "down", ...(from ? { memory: true } : {}) });
          if (from && it.owner && it.owner !== from.id) it.lostGift = seq;
          return;
        }
        const toChar = a.to ? this.findChar(a.to) ?? (looksLikePerson(a.to) ? this.person(a.to, seq) : undefined) : undefined;
        // docs/30 2.2: a thing put down is at a place the tree knows, however the path was written.
        const holder = toChar?.id ?? (a.to ? `place:${clip(a.to)}` : it.holder);
        // docs/30 2.2: the place in the tree, for what's at a place however its path was written. Only what's
        // written as a place ("at the counter", "→ Town › House › shelf"): "Mira's bag" doesn't grow the tree.
        if (holder !== it.holder || toChar) it.placeId = !toChar && a.to && (/^(?:at|in|on|inside)\s/i.test(clip(a.to)) || /›|»/.test(a.to)) ? this.placeFor(clip(a.to), ctx, seq, true)?.id : undefined;
        // G2: a first hand-off says who it came from ("item key: Mira → Joss"), for the object's trail.
        const was = it.holder ?? (a.from ? this.findChar(a.from)?.id : undefined);
        it.gone = false;
        it.holder = holder;
        if (a.where) it.where = clip(a.where);
        let gave: Character[] = [];
        if (a.gift) {
          // docs/26 6.4: a gift can have several givers ("gift from Gabriel, Buffy").
          const named = String(a.gift).split(/\s*(?:,|&|\band\b)\s*/).filter(Boolean);
          gave = named.map((n) => this.findChar(n)).filter((c): c is Character => Boolean(c));
          const fresh = !it.gift;
          it.gift = named.map((n) => this.findChar(n)?.name ?? clip(n)).join(", ");
          if (toChar) it.owner = toChar.id;
          if (!fresh) gave = [];
        }
        if (!it.owner && toChar) it.owner = toChar.id;
        it.lostGift = undefined;
        it.custody.push({ from: was, to: holder, how: op.cause, seq, ...this.where() });
        // A jacket handed back is no longer part of the giver's look.
        const giver = was && was !== holder ? st.chars[was] : undefined;
        if (giver?.look && !this.isLocked(`chars.${giver.id}.look`)) {
          const look = lookWithout(giver.look, name);
          if (look !== giver.look) giver.look = look || undefined;
        }
        const nm = (h?: string) => (h ? (h.startsWith("place:") ? h.slice(6) : this.nameOf(h)) : "");
        this.push(ctx, { kind: "item", text: was && was !== holder ? `${name}: ${nm(was)} → ${nm(holder)}` : `${name} → ${nm(holder)}`, path: `items.${id}`, reason: op.cause, from: nm(was), to: nm(holder), memory: Boolean(a.gift) });
        // E2: a gift moves a bond: the one who got it warms to the one who gave it. It reads as a written bond line,
        // tags and all: without them this line threw, and every gift went down as "couldn't apply".
        for (const g of gave) if (toChar && g.id !== toChar.id) this.applyOp({ op: "bond", subject: toChar.name, object: g.name, args: { moves: [{ axis: "affection", delta: 1 }], tagsAdd: [], tagsRemove: [] }, cause: gave.length > 1 ? `a gift: ${name}, from ${g.name}` : `a gift: ${name}`, raw: "" }, ctx);
        return;
      }
      case "room": {
        // E2: whose place this is, and what kind of place.
        const who = this.person(op.subject, seq);
        const path = ((a.path ?? []) as string[]).map((x) => clip(x)).filter(Boolean);
        if (!who || !path.length) return this.reject(ctx, "write room A: Town › Place | room");
        const p = this.placeFor(path, ctx, seq);
        if (!p) return this.reject(ctx, "write room A: Town › Place | room");
        // A kind is a word ("home", "shop"); "asleep-bound, door knob turned…" isn't one.
        const said = clip(a.kind).toLowerCase();
        const kind = /^(?:room|bedroom|home|house|flat|apartment|shop|store|office|studio|workshop|study|den|suite|quarters|cabin|crypt|lair|camp|tent|bunk|cell|stall)$/.test(said) && !(said === "room" && (p.kind === "home" || p.kind === "building")) ? said : (p.kind ?? "room");
        if (p.owner === who.id && p.kind === kind) return;
        if (this.isLocked(`places.${p.id}`) && this.ai(ctx)) return this.reject(ctx, "locked");
        p.owner = who.id;
        p.kind = kind;
        this.push(ctx, { kind: "place", text: `${p.name}: ${who.isUser ? this.cfg.userName || "your" : who.name}'s ${kind}`, path: `places.${p.id}`, reason: op.cause });
        this.homeEvidence(p, who.id);
        return;
      }
      case "lives": {
        // docs/30 2.4: where someone lives now ("lives Dawn: Sunnydale › Summers Residence"), or moved out ("lives Anya: - Xander's apartment").
        const who = this.person(op.subject, seq);
        const path = ((a.path ?? []) as string[]).map((x) => clip(x)).filter(Boolean);
        if (!who || !path.length) return this.reject(ctx, "write lives A: Town › Home (or lives A: - Home, moved out)");
        const at = a.leave ? this.placeAt(path) : this.placeFor(path, ctx, seq);
        if (!at) return this.reject(ctx, a.leave ? `no place called ${path.join(" › ")}` : "write lives A: Town › Home");
        // A room in a home is theirs, and they live in the home: "lives Dawn: Summers Residence › Dawn's bedroom".
        const home = this.placeBook.buildingOf(at) ?? at;
        if (this.isLocked(`places.${home.id}`) && this.ai(ctx)) return this.reject(ctx, "locked");
        const nm = who.isUser ? this.cfg.userName || "you" : who.name;
        if (a.leave) {
          if (!home.residents?.includes(who.id)) return;
          home.residents = home.residents.filter((id) => id !== who.id);
          if (home.guessed) home.guessed = home.guessed.filter((id) => id !== who.id);
          this.push(ctx, { kind: "place", text: `${nm} moved out of ${home.name}`, path: `places.${home.id}.residents`, reason: op.cause });
          return;
        }
        if (at.id !== home.id && (at.kind === "room" || at.kind === "bedroom") && !at.owner) at.owner = who.id;
        // Said now, not guessed.
        if (home.guessed?.includes(who.id)) home.guessed = home.guessed.filter((id) => id !== who.id);
        if (home.residents?.includes(who.id)) return;
        // One home at a time: moving into a house or a building moves them out of the last one.
        if (home.kind === "home" || home.kind === "building")
          for (const x of Object.values(st.places))
            if (x.id !== home.id && x.residents?.includes(who.id)) {
              x.residents = x.residents.filter((id) => id !== who.id);
              if (x.guessed) x.guessed = x.guessed.filter((id) => id !== who.id);
            }
        (home.residents ??= []).push(who.id);
        this.push(ctx, { kind: "place", text: `${nm} lives at ${home.name}`, path: `places.${home.id}.residents`, reason: op.cause });
        return;
      }
      case "place": {
        // docs/30 0.4: what a place looks like now. The place is found by its path or its last part, or made.
        const path = ((a.path ?? []) as string[]).map((x) => clip(x)).filter(Boolean);
        const text = clip(a.text);
        if (!path.length || !text) return this.reject(ctx, "write place Where: what's there now");
        // docs/30 2.2: the place by the tree, or (a bare name the tree doesn't place) by its last part, or made.
        const found = this.placeAt(path) ?? (path.length > 1 ? undefined : this.placeAt(path.slice(-1)));
        const at = found ?? this.placeFor(path, ctx, seq);
        if (!at) return this.reject(ctx, "write place Where: what's there now");
        if (this.isLocked(`places.${at.id}`) && this.ai(ctx)) return this.reject(ctx, "locked");
        // docs/30 2.3: by what it's about, and in the room it names ("living room dartboard wall…").
        const { place: p, added } = this.placeBook.addNote(at, text, seq);
        if (!added) return;
        this.push(ctx, { kind: "place", text: `${p.name}: ${cut(p.notes!.at(-1)!.text, 80)}`, path: `places.${p.id}.notes`, reason: op.cause });
        return;
      }
      case "keeps": {
        // E2: something of theirs, kept somewhere ("keeps Mira: the ledger @ Lamp room").
        const who = this.person(op.subject, seq);
        const name = clip(a.item);
        if (!who || !name) return this.reject(ctx, "write keeps A: item @ place");
        const id = slug(name);
        const it = (st.items[id] ??= { id, name, custody: [], lastSeq: seq });
        if (this.isLocked(`items.${id}`) && this.ai(ctx)) return this.reject(ctx, "locked");
        const holder = a.place ? `place:${clip(a.place)}` : it.holder;
        if (a.place) it.placeId = this.placeFor(clip(a.place), ctx, seq, true)?.id;
        if (it.owner === who.id && it.holder === holder && !it.gone) return;
        const was = it.holder;
        it.owner = who.id;
        it.gone = false;
        it.lastSeq = seq;
        if (holder !== was) {
          it.holder = holder;
          it.custody.push({ from: was, to: holder, how: op.cause ?? "kept there", seq, ...this.where() });
        }
        this.push(ctx, { kind: "item", text: `${name}: ${who.isUser ? this.cfg.userName || "yours" : who.name}'s${holder?.startsWith("place:") ? `, kept at ${holder.slice(6)}` : ""}`, path: `items.${id}`, reason: op.cause });
        return;
      }
      case "thread": {
        const title = clip(op.subject ?? a.detail);
        if (!title) return this.reject(ctx, "which thread?");
        const id = this.threadId(title);
        let t = st.threads[id];
        const action = a.action as string;
        if (!t) {
          if (action === "resolve") return this.reject(ctx, "no such open thread");
          t = st.threads[id] = { id, title, status: "open", openedSeq: seq, lastSeq: seq, history: [], kind: a.kind };
          t.history.push({ op: "new", detail: a.detail, seq });
          t.latest = a.detail;
          this.push(ctx, { kind: "thread", text: `New thread: ${title}`, path: `threads.${id}`, reason: a.detail });
          return;
        }
        // A restatement with nothing new isn't progress (ALMANAC 09 §1).
        if (action === "advance" && a.detail && t.latest && overlap(a.detail, t.latest) > 0.8) return;
        t.lastSeq = seq;
        t.history.push({ op: action, detail: a.detail, seq });
        if (t.history.length > 60) t.history.splice(0, t.history.length - 60);
        if (a.detail) t.latest = clip(a.detail);
        if (action === "resolve") t.status = "resolved";
        else if (action === "stall") {
          t.status = "stalled";
          t.blocker = a.blocker ?? a.detail;
        } else t.status = "open";
        if (a.kind) t.kind = a.kind;
        this.push(ctx, {
          kind: "thread",
          text: action === "resolve" ? `Resolved: ${t.title}` : action === "stall" ? `Stalled: ${t.title}` : `${t.title}: ${clip(a.detail ?? action)}`,
          path: `threads.${id}`,
          reason: a.detail,
          tone: action === "resolve" ? "up" : action === "complicate" ? "warn" : undefined,
          memory: action === "resolve",
        });
        return;
      }
      case "owe":
      case "promise": {
        const who = this.person(op.subject, seq);
        const whom = op.object ? this.person(op.object, seq) : undefined;
        if (!who || !a.what) return this.reject(ctx, `write ${op.op} A → B: what | status [due …]`);
        if (this.doneHeld(ctx, a.what)) return this.reject(ctx, "held: the checker flagged this reply for having this still to come; it counts once you dismiss the flag or fix the sentence");
        const id = this.obligationId(op.op, who.id, whom?.id, a.what);
        const made = this.now();
        const o = (st.obligations[id] ??= { id, kind: op.op, who: who.id, whom: whom?.id, what: clip(a.what), status: "open", seq, ...(made != null ? { made } : {}) });
        if (a.due) o.due = { minutes: this.when(a.due), text: a.due };
        // E3: a meeting, its window, and how much it matters.
        if (a.meet) o.meet = clip(a.meet);
        if (a.importance) o.importance = a.importance;
        if (a.window) o.window = parseDuration(String(a.window).replace(/^(\d+)(\w)/, "$1 $2")) ?? o.window;
        const status = a.status as typeof o.status | undefined;
        this.openLoop(o.what, "promise", seq, { obligation: o.id, ...(o.due ? { due: o.due } : {}) });
        const fresh = o.seq === seq && o.status === "open" && !o.felt;
        if (status && status !== o.status) {
          o.status = status;
          o.settled = seq;
          this.settleLoop(o, seq, ctx);
          o.auto = ctx.ev.source === "engine";
          this.push(ctx, { kind: op.op, text: `${cap(op.op === "owe" ? "debt" : "promise")} ${status}: ${o.what}`, subject: who.name, path: `obligations.${id}`, reason: op.cause, tone: status === "kept" || status === "paid" ? "up" : status === "broken" ? "down" : "due", memory: status === "broken" || status === "kept" });
          if (op.op === "promise" && whom) this.feelPromise(o, ctx, seq);
        } else if (fresh) this.push(ctx, { kind: op.op, text: `${op.op === "owe" ? `${who.name} owes ${whom?.name ?? "someone"}` : `${who.name} ${o.meet ? `will meet ${whom?.name ?? "someone"} at ${o.meet}` : `promised${whom ? ` ${whom.name}` : ""}`}`}: ${o.what}`, subject: who.name, path: `obligations.${id}`, reason: op.cause });
        this.promiseChecks(ctx);
        return;
      }
      case "loop": {
        if (a.action === "new") {
          if (!a.what?.trim()) return this.reject(ctx, "write loop: what | promise|plan|errand|question");
          if (this.doneHeld(ctx, a.what)) return this.reject(ctx, "held: the checker flagged this reply for having this still to come; it counts once you dismiss the flag or fix the sentence");
          const l = this.openLoop(a.what, (a.kind ?? "errand") as Loop["kind"], seq, a.due ? { due: { minutes: this.when(a.due), text: clip(a.due) } } : {});
          for (const t of (a.from as string[] | undefined) ?? []) if (!l.from.includes(t)) l.from.push(t);
          if (a.done) this.closeLoop(l, seq, a.how, ctx);
          return;
        }
        const l = st.loops?.[op.subject ?? ""];
        if (!l) return this.reject(ctx, "no such loop");
        if (ctx.ev.source !== "user" && this.loopHeld(l, seq)) return this.reject(ctx, "held: you settled this loop, and it stays as you left it");
        if (a.action === "done") return this.closeLoop(l, seq, a.how, ctx);
        if (a.action === "dropped") {
          if (l.status !== "open") return;
          l.status = "dropped";
          l.closed = seq;
          if (a.how) l.how = clip(a.how);
          this.ownLoop(l, ctx);
          this.dropLoop(l, seq, ctx);
        } else if (a.action === "open") {
          l.status = "open";
          delete l.closed;
          delete l.how;
          delete l.yours;
          delete l.byHand;
          if (ctx.ev.source === "user") l.reopened = seq;
          const o = l.obligation ? st.obligations[l.obligation] : undefined;
          if (o && o.status !== "open" && o.status !== "due") {
            o.status = "open";
            o.settled = seq;
            this.feelPromise(o, ctx, seq);
          }
          const e = l.calendar ? st.calendar[l.calendar] : undefined;
          if (e) e.done = false;
        }
        this.push(ctx, { kind: "loop", text: `${a.action === "open" ? "Open again" : "Dropped"}: ${l.what}`, path: `loops.${l.id}`, reason: a.how });
        return;
      }
      case "deadline": {
        if (!a.title) return this.reject(ctx, "write deadline Title: when");
        const id = slug(a.title);
        const d = (st.deadlines[id] ??= { id, title: clip(a.title), at: null, text: "", done: false, seq });
        if (a.when) {
          d.text = clip(a.when);
          d.at = this.when(a.when);
        }
        if (a.done && !d.done) {
          d.done = true;
          this.push(ctx, { kind: "deadline", text: `Done: ${d.title}`, path: `deadlines.${id}`, tone: "up" });
        } else if (d.seq === seq) this.push(ctx, { kind: "deadline", text: `Deadline: ${d.title}${d.text ? ` (${d.text})` : ""}`, path: `deadlines.${id}`, tone: "due" });
        return;
      }
      case "plant": {
        if (!a.text) return this.reject(ctx, "plant what?");
        const id = slug(a.text);
        if (st.plants[id]) return;
        st.plants[id] = { id, text: clip(a.text), payoff: a.payoff ? clip(a.payoff) : undefined, seq, scene: st.sceneNo };
        this.push(ctx, { kind: "plant", text: `Planted: ${clip(a.text)}`, path: `plants.${id}` });
        return;
      }
      case "payoff": {
        const p = Object.values(st.plants).find((x) => x.paidSeq == null && (slug(a.text) === x.id || overlap(x.text, a.text) >= 0.5));
        if (!p) return this.reject(ctx, "no unpaid plant like that");
        p.paidSeq = seq;
        this.push(ctx, { kind: "plant", text: `Paid off: ${clip(p.text)}`, path: `plants.${p.id}`, reason: a.payoff, tone: "up", memory: true });
        return;
      }
      case "clue": {
        if (!a.text) return this.reject(ctx, "what clue?");
        if (st.clues.some((c) => overlap(c.text, a.text) > 0.8)) return;
        st.clues.push({ id: slug(a.text), text: clip(a.text), pointsTo: a.pointsTo, reliability: a.reliability, seq });
        this.push(ctx, { kind: "clue", text: `Clue: ${clip(a.text)}`, path: `clues.${slug(a.text)}` });
        return;
      }
      case "gauge": {
        const name = clip(op.subject);
        if (!name) return this.reject(ctx, "write gauge Name: 3/6");
        const g = (st.gauges[slug(name)] ??= { name, cur: 0, max: a.max ?? 6, history: [] });
        if (a.max) g.max = a.max;
        const prev = g.cur;
        g.cur = Math.max(0, Math.min(g.max, a.cur ?? prev + (a.delta ?? 0)));
        if (g.cur === prev) return;
        g.cause = op.cause;
        g.history.push({ v: g.cur, seq });
        this.push(ctx, { kind: "gauge", text: `${name} ${g.cur}/${g.max}`, path: `gauges.${slug(name)}`, reason: op.cause, from: prev, to: g.cur, tone: g.cur >= g.max ? "warn" : undefined });
        return;
      }
      case "clockf": {
        const faction = clip(op.subject);
        if (!faction || !a.project) return this.reject(ctx, "write clockf Faction: project +1 (3/6)");
        const existing = Object.values(st.clocks).find((c) => norm(c.faction) === norm(faction) && overlap(c.name, a.project) >= 0.5);
        const id = existing ? `${slug(existing.faction)}:${slug(existing.name)}` : `${slug(faction)}:${slug(a.project)}`;
        const c = (st.clocks[id] ??= { faction, name: clip(a.project), cur: 0, max: a.max ?? 6, history: [] });
        if (a.max) c.max = a.max;
        const prev = c.cur;
        c.cur = Math.max(0, Math.min(c.max, a.cur ?? prev + (a.delta ?? 1)));
        if (c.cur === prev) return;
        c.history.push({ v: c.cur, seq });
        this.push(ctx, { kind: "faction", text: `${faction}: ${c.name} ${c.cur}/${c.max}`, path: `clocks.${id}`, reason: op.cause, tone: c.cur >= c.max ? "warn" : undefined, memory: c.cur >= c.max });
        return;
      }
      case "member": {
        // docs/30 1.5: "member Scoobies: + Dawn | junior · since she found the handbook", "member Scoobies: - Anya — left after the wedding".
        const name = clip(op.subject).replace(/^@/, "").trim();
        const names = ((a.names ?? []) as string[]).filter((n) => n.trim());
        if (!name || !names.length) return this.reject(ctx, "write member Group: + Name | role · why (or - Name — why)");
        if (this.notGroup(name)) return this.reject(ctx, `you said ${name} isn't a group`);
        if (!this.findGroup(name) && this.findChar(name) && !isGroupShape(name)) return this.reject(ctx, `${name} is a person, not a group`);
        const g = this.groupOf(name, seq);
        this.mention(g, seq);
        const why = [a.why, op.cause].filter(Boolean).join("; ") || undefined;
        for (const n of names) {
          if (a.leave) {
            if (this.leave(g, n, seq, why)) this.push(ctx, { kind: "faction", text: `${this.findChar(n)?.name ?? n} left ${g.name}`, subject: n, path: `groups.${groupKey(g.name)}`, reason: why });
            continue;
          }
          const c = this.person(n, seq);
          if (!c) continue;
          if (this.join(g, c.name, seq, { role: a.role, why })) this.push(ctx, { kind: "faction", text: `${c.name} joined ${g.name}${a.role ? ` (${a.role})` : ""}`, subject: c.name, path: `groups.${groupKey(g.name)}`, reason: why });
        }
        g.adopted = this.adopts(g);
        return;
      }
      case "rep": {
        const who = this.person(op.subject ?? this.cfg.userName, seq);
        const group = clip(op.object);
        if (!who || !group) return this.reject(ctx, "write rep Name @ Group: ±N — deed");
        const id = `${who.id}@${slug(group)}`;
        const r = (st.rep[id] ??= { who: who.id, group, score: 0, tags: [], history: [] });
        const prev = r.score;
        r.score = Math.max(-3, Math.min(3, prev + (a.delta ?? 0)));
        for (const t of a.tags as string[]) if (!r.tags.includes(t)) r.tags.push(t);
        if (r.score === prev && !(a.tags as string[]).length) return;
        r.history.push({ delta: r.score - prev, deed: op.cause, seq });
        this.push(ctx, { kind: "reputation", text: `${who.name} @ ${group} ${r.score > prev ? "+" : ""}${r.score - prev}`, path: `rep.${id}`, reason: op.cause, tone: r.score > prev ? "up" : "down" });
        return;
      }
      case "event":
      case "plan": {
        if (!a.title) return this.reject(ctx, `write ${op.op} Title: when | kind | who: …`);
        if (this.doneHeld(ctx, a.title)) return this.reject(ctx, "held: the checker flagged this reply for having this still to come; it counts once you dismiss the flag or fix the sentence");
        const id = slug(a.title);
        const kind = (a.kind ?? (/birthday/i.test(a.title) ? "birthday" : /anniversar/i.test(a.title) ? "anniversary" : op.op === "plan" ? "plan" : "recurring")) as "plan";
        const e = (st.calendar[id] ??= { id, title: clip(a.title), kind, when: "", at: null, who: [], seq });
        if (a.when) {
          e.when = clip(a.when);
          e.at = kind === "plan" || kind === "appointment" ? this.when(a.when) : null;
        }
        e.who = uniq([...e.who, ...((a.who as string[]) ?? []).map((n) => this.findChar(n)?.id ?? n)]);
        if (a.done) e.done = true;
        if (kind === "plan" || kind === "appointment") {
          const l = this.openLoop(e.title, "plan", seq, { calendar: e.id, ...(e.when ? { due: { minutes: e.at, text: e.when } } : {}) });
          if (e.done) this.closeLoop(l, seq, undefined, ctx);
        }
        if (e.seq === seq) this.push(ctx, { kind: "calendar", text: `${cap(kind)}: ${e.title}${e.when ? ` (${e.when})` : ""}`, path: `calendar.${id}` });
        return;
      }
      case "motif": {
        if (!a.text) return this.reject(ctx, "what running bit?");
        const id = slug(a.text);
        const existing = st.motifs[id] ?? Object.values(st.motifs).find((m) => overlap(m.text, a.text) >= 0.7);
        if (existing) {
          existing.uses++;
          existing.lastSeq = seq;
          return;
        }
        st.motifs[id] = { id, text: clip(a.text), who: a.who, firstSeq: seq, lastSeq: seq, uses: 1 };
        this.push(ctx, { kind: "motif", text: `Running bit: ${clip(a.text)}`, path: `motifs.${id}` });
        return;
      }
      case "beat": {
        if (!a.text) return this.reject(ctx, "what happened?");
        const beats = (st.beats ??= []);
        // One beat per reply: a second line for the same reply adds to it.
        const last = beats.at(-1);
        const b = last?.seq === seq ? last : { text: "", seq, minutes: null, place: [], who: [] };
        if (b !== last) beats.push(b);
        b.text = b.text ? `${b.text}; ${cut(a.text, 240)}` : cut(a.text, 240);
        this.stamp(b);
        if (beats.length > MAX_BEATS) beats.splice(0, beats.length - MAX_BEATS);
        return;
      }
      case "milestone": {
        if (!a.text) return this.reject(ctx, "what milestone?");
        if (st.milestones.some((m) => overlap(m.text, a.text) > 0.8)) return;
        const who = (a.who ? String(a.who).split(/\s*(?:&|,|\band\b)\s*/) : []).map((n: string) => this.findChar(n)?.id ?? n);
        st.milestones.push({ text: clip(a.text), who, seq, at: st.time ? formatStoryTime(st.time) : null });
        this.push(ctx, { kind: "milestone", text: `Milestone: ${clip(a.text)}`, path: `milestones.${slug(a.text)}`, memory: true, tone: "up" });
        return;
      }
      case "lock": {
        if (ctx.ev.source !== "user") return this.reject(ctx, "only you can lock fields");
        const path = String(a.path ?? "").toLowerCase().trim();
        if (!path) return;
        st.locks = a.on ? uniq([...st.locks, path]) : st.locks.filter((l) => l !== path);
        return;
      }
      case "set":
      case "unset": {
        const path = String(a.path ?? "").trim();
        const res = applyPatch(st.custom, { changes: [{ path, op: "set", value: op.op === "unset" ? null : a.value, reason: op.cause }] }, {
          templates: this.cfg.templates,
          locks: st.locks,
          source: ctx.ev.source === "user" ? "user" : ctx.ev.source === "init" ? "init" : ctx.ev.source === "timeskip" ? "timeskip" : "ai",
          limits: this.cfg.limits,
          seq,
        });
        if (res.rejected.length) return this.reject(ctx, res.rejected[0]!.why);
        st.custom = res.state;
        for (const c of res.changes) this.push(ctx, fromPatch(c));
        return;
      }
      case "sim":
        applySim(st.sim, op.args as SimOp, seq);
        return;
    }
  }

  fact(key: string | undefined, statement: string, seq: number, truth?: string) {
    const st = this.state;
    const facts = Object.values(st.facts);
    // Said again without its key, it's the same fact: a secret first (at the reveal's 0.6), then anything close.
    const k = key
      ? slug(key)
      : (facts.find((f) => f.secret && overlap(f.statement, statement) >= 0.6)?.key ?? facts.find((f) => overlap(f.statement, statement) >= 0.75)?.key ?? slug(statement));
    // A #key given to a fact first written without one takes it over, stances and all.
    if (key && !st.facts[k]) {
      const old = facts.find((f) => !f.secret && f.key === slug(f.statement) && overlap(f.statement, statement) >= 0.75);
      if (old) {
        delete st.facts[old.key];
        st.facts[k] = { ...old, key: k };
      }
    }
    const f = (st.facts[k] ??= { key: k, statement: clip(statement), truth: (truth as Truth) ?? "true", stances: {}, revealed: [], firstSeq: seq, lastSeq: seq });
    f.lastSeq = seq;
    if (truth) f.truth = truth as Truth;
    f.about = this.aboutOf(f.statement);
    return f;
  }

  /** docs/21 4.3: the people a statement names, by name, alias, or (for you) your name. */
  aboutOf(statement: string): string[] {
    return Object.values(this.state.chars)
      .filter((c) => [c.name, ...c.aliases, ...(c.isUser && this.cfg.userName ? [this.cfg.userName] : [])].some((n) => mentions(statement, n)))
      .map((c) => c.id);
  }

  /** docs/32 2.3: a subplot is told under its lead's name as it is now, not as it was when the subplot began. */
  private leadNames(c: Character) {
    for (const x of [...Object.values(this.state.sim?.arcs ?? {}), ...Object.values(this.state.sim?.proposals ?? {})]) if (x.lead === c.id) x.leadName = c.name;
  }

  /** Folds one person into another (the same person written two ways): every bond, item, secret and promise follows. */
  mergeChars(from: Character, into: Character) {
    const st = this.state;
    const swap = (id: string | undefined) => (id === from.id ? into.id : id);
    const newer = from.lastSeq > into.lastSeq;
    into.aliases = uniq([...into.aliases, ...from.aliases, from.name]).filter((x) => norm(x) !== norm(into.name));
    into.firstSeq = Math.min(into.firstSeq, from.firstSeq);
    into.lastSeq = Math.max(into.lastSeq, from.lastSeq);
    into.isMain ||= from.isMain;
    into.dead ||= from.dead;
    // docs/32 2.3: their subplots off the page follow, under the name that's kept.
    for (const x of [...Object.values(st.sim?.arcs ?? {}), ...Object.values(st.sim?.proposals ?? {})]) {
      if (x.lead === from.id) x.lead = into.id;
      x.cast = uniq(x.cast.map((id) => swap(id)!)).filter((id) => id !== x.lead);
      if ("target" in x && x.target === from.id) x.target = into.id;
    }
    this.leadNames(into);
    // What changes scene to scene comes from whoever was seen last; the rest fills gaps.
    for (const k of ["tier", "activity", "place", "mood", "look", "thoughts"] as const) {
      if (from[k] != null && (newer || into[k] == null)) (into as unknown as Record<string, unknown>)[k] = from[k];
    }
    for (const [k, v] of Object.entries(from.meters)) if (into.meters[k as Meter] == null) into.meters[k as Meter] = v;
    into.drives = { ...from.drives, ...into.drives };
    if (from.mask) into.mask = { ...from.mask, ...into.mask };
    into.flags = uniq([...into.flags, ...from.flags]);
    for (const i of from.injuries) if (!into.injuries.some((x) => norm(x.where) === norm(i.where))) into.injuries.push(i);
    for (const c of from.conditions) if (!into.conditions.some((x) => x.kind === c.kind)) into.conditions.push(c);
    for (const t of from.traits) {
      const clash = into.traits.find((x) => (t.kind !== "other" ? x.kind === t.kind : norm(x.text) === norm(t.text)));
      if (!clash) into.traits.push(t);
      else if (clash.by === "model" && t.by !== "model") into.traits[into.traits.indexOf(clash)] = t;
    }
    into.journal = [...into.journal, ...from.journal].sort((x, y) => x.seq - y.seq).slice(-40);
    delete st.chars[from.id];
    // Bonds and ladders are keyed by both ends.
    for (const table of [st.bonds, st.ladders] as Record<string, Bond | Ladder>[]) {
      for (const [k, v] of Object.entries(table)) {
        if (v.from !== from.id && v.to !== from.id) continue;
        delete table[k];
        v.from = swap(v.from)!;
        v.to = swap(v.to)!;
        if (v.from === v.to) continue;
        const key = `${v.from}>${v.to}`;
        const cur = table[key];
        if (!cur) table[key] = v;
        else if ("axes" in cur && "axes" in v) {
          cur.axes = { ...v.axes, ...cur.axes };
          cur.tags = uniq([...cur.tags, ...v.tags]);
          cur.label ??= v.label;
          cur.history = [...v.history, ...cur.history].sort((x, y) => x.seq - y.seq);
        } else if ("tier" in cur && "tier" in v && v.seq > cur.seq) table[key] = v;
      }
    }
    for (const it of Object.values(st.items)) {
      it.holder = swap(it.holder);
      it.owner = swap(it.owner);
      for (const c of it.custody) {
        c.from = swap(c.from);
        c.to = swap(c.to);
      }
    }
    for (const f of Object.values(st.facts)) {
      if (f.about) f.about = uniq(f.about.map((x) => swap(x)!));
      const s = f.stances[from.id];
      if (s) {
        if (!f.stances[into.id] || f.stances[into.id]!.seq < s.seq) f.stances[into.id] = s;
        delete f.stances[from.id];
      }
      if (f.secret) {
        const keepers = uniq(f.secret.keepers.map((x) => swap(x)!));
        f.secret = { ...f.secret, keepers, from: uniq(f.secret.from.map((x) => swap(x)!)).filter((x) => !keepers.includes(x)) };
        // One of the keepers all along: the stance "kept from them" the other name had doesn't stick.
        if (keepers.includes(into.id) && f.stances[into.id]?.status === "unaware") f.stances[into.id] = { status: "knows", route: "keeps it", seq: f.stances[into.id]!.seq };
      }
      for (const r of f.revealed) r.to = uniq(r.to.map((x) => swap(x)!));
    }
    for (const o of Object.values(st.obligations)) {
      o.who = swap(o.who)!;
      o.whom = swap(o.whom);
    }
    for (const [k, r] of Object.entries(st.rep)) {
      if (r.who !== from.id) continue;
      delete st.rep[k];
      r.who = into.id;
      st.rep[`${into.id}@${slug(r.group)}`] ??= r;
    }
    for (const e of Object.values(st.calendar)) e.who = uniq(e.who.map((x) => swap(x)!));
    for (const m of st.milestones) m.who = uniq(m.who.map((x) => swap(x)!));
    for (const b of st.beats ?? []) b.who = uniq(b.who.map((x) => swap(x)!));
    st.locks = st.locks.map((l) => l.replace(`chars.${from.id}`, `chars.${into.id}`).replace(new RegExp(`(^|[.>])${from.id}(?=$|[.>])`, "g"), `$1${into.id}`));
  }

  threadId(title: string) {
    const st = this.state;
    const id = slug(title);
    if (st.threads[id]) return id;
    const close = Object.values(st.threads).find((t) => t.status !== "resolved" && (overlap(t.title, title) >= 0.6 || slug(t.title).startsWith(id) || id.startsWith(slug(t.title))));
    return close?.id ?? id;
  }

  obligationId(kind: string, who: string, whom: string | undefined, what: string) {
    const own = `${kind}:${who}>${whom ?? "-"}:${slug(what)}`;
    const close = Object.values(this.state.obligations).find((o) => o.kind === kind && o.who === who && o.whom === whom && overlap(o.what, what) >= 0.5);
    if (close || this.state.obligations[own]) return close?.id ?? own;
    // The same promise said again to someone else: "tell Dawn about the jealousy question at dinner"
    // to Gabriel (#467), then "the jealousy/Spike story at dinner" to Dawn (#501). One record, or
    // one is kept while the other breaks.
    const again = Object.values(this.state.obligations).find((o) => o.kind === kind && o.who === who && (o.status === "open" || o.status === "due") && restated(o.what, o.whom ? this.nameOf(o.whom) : "", what, whom ? this.nameOf(whom) : ""));
    return again?.id ?? own;
  }
}

const LADDER_WORDS: Record<string, number> = {
  stranger: 0, strangers: 0, aware: 1, noticed: 1, interested: 2, curious: 2, drawn: 2, charged: 3, tension: 3, spark: 3, tested: 4, spoken: 5,
  confessed: 5, declared: 5, together: 6, committed: 6, couple: 6, lovers: 6, dating: 6, established: 7, settled: 7, married: 7,
};
const LADDER_WARM = /\b(kiss\w*|hug\w*|smil\w*|laugh\w*|held|hold\w*|touch\w*|tender\w*|warm\w*|close(?:r)?|confess\w*)\b/i;

function clamp(v: unknown, lo: number, hi: number): number | undefined {
  const n = typeof v === "number" ? v : v == null ? undefined : Number(v);
  return n == null || !Number.isFinite(n) ? undefined : Math.max(lo, Math.min(hi, n));
}
const uniq = <T>(xs: T[]) => [...new Set(xs)];

function repairChar(c: Character, id: string) {
  c.id = id;
  c.name = typeof c.name === "string" && c.name.trim() ? c.name : id;
  for (const k of ["aliases", "flags", "injuries", "conditions", "traits", "journal"] as const) if (!Array.isArray(c[k])) (c as unknown as Record<string, unknown>)[k] = [];
  for (const k of ["meters", "drives"] as const) if (!c[k] || typeof c[k] !== "object" || Array.isArray(c[k])) (c as unknown as Record<string, unknown>)[k] = {};
  c.traits = c.traits.filter((t) => t && typeof t.text === "string").map((t) => ({ ...t, kind: t.kind ?? traitKind(t.text), by: t.by ?? "user", seq: t.seq ?? 0 }));
  if (c.tier && !["spot", "peri", "off"].includes(c.tier)) c.tier = "spot";
  c.firstSeq = Number(c.firstSeq) || 0;
  c.lastSeq = Number(c.lastSeq) || 0;
  c.stamina ||= "ordinary";
  c.isUser = Boolean(c.isUser);
  c.isMain = Boolean(c.isMain);
}

/** Sets (or, with null, removes) any field of the world by path; parents are made as needed. Returns why not. */
export function editPath(root: object, path: string[], value: unknown): string | null {
  if (path.some((k) => k === "__proto__" || k === "constructor" || k === "prototype")) return "not a field";
  if (["sim", "lastSeq"].includes(path[0]!)) return "that part isn't editable";
  let node = root as Record<string, unknown>;
  for (let i = 0; i < path.length - 1; i++) {
    const k = path[i]!;
    let next = node[k];
    if (next == null || typeof next !== "object") {
      if (value == null) return null; // removing something already gone
      next = /^\d+$/.test(path[i + 1]!) ? [] : {};
      node[k] = next;
    }
    node = next as Record<string, unknown>;
  }
  const last = path.at(-1)!;
  if (value == null) {
    if (Array.isArray(node) && /^\d+$/.test(last)) node.splice(Number(last), 1);
    else delete node[last];
  } else node[last] = value;
  return null;
}
/** Words before a name that the story may have without having the person ("Coach", "Aunt"). */
const TITLE_WORD = /^(?:mr|mrs|ms|miss|mister|dr|doctor|sir|lady|lord|coach|officer|captain|professor|principal|aunt|uncle|father|mother|sister|brother|the)$/i;
const looksLikePerson = (s: string) => /^[A-Z][a-z'’-]+(?:\s+[A-Z][a-z'’-]+){0,2}$/.test(s.trim()) && !/\b(table|floor|bag|box|drawer|shelf|room|house|car|desk|chest|pocket|safe|trunk|bed)\b/i.test(s);

function fromPatch(c: PatchChange): Omit<Change, "source"> {
  const fmt = (v: unknown) => (Array.isArray(v) ? v.join(", ") : v == null || v === "" ? "–" : String(v));
  const text =
    c.kind === "row_added" ? `${c.label} added` : c.kind === "row_removed" ? `${c.label} removed` : c.delta != null ? `${c.label} ${c.delta > 0 ? "+" : ""}${c.delta}` : c.kind === "add" ? `${c.label} +${fmt(c.to)}` : c.kind === "remove" ? `${c.label} −${fmt(c.to)}` : `${c.label}: ${fmt(c.to)}`;
  return { kind: "custom", text, subject: c.row, reason: c.reason, path: `custom.${c.path}`, from: c.from, to: c.to, flag: c.limited ? `capped from ${fmt(c.limited.requested)}` : c.flag, memory: c.memory, tone: c.delta != null ? (c.delta > 0 ? "up" : "down") : undefined };
}

/** Folds events in order (TRK-04): the state as of the last event given. */
/**
 * Who a reply's group lines reached, worked out when they're filed (the fold never sees the text).
 * "know @Scoobies: … | he said it at the table" when no Scoobie is in the scene, arrives in this
 * reply or is named in the messages reached none of them: the line keeps `away`, the members it
 * missed, and the fold tells only the rest. A route that travels (a call, a text, the files), a
 * group named in the messages ("Dawn's friends saw him at the mall") or its people listed in
 * brackets reach them all, as before.
 */
export function groupReach(ops: Op[], state: WorldState, cfg: FoldConfig, text: string, quiet: string[] = []): Op[] {
  if (!ops.some((op) => REACH_OPS.has(op.op) && op.subject)) return ops;
  return reachOn(new Folder(cfg, structuredClone(state)), ops, text, quiet);
}

/** groupReach on a fold that's already at the moment before the reply (the sweep's own, read only). */
export function reachOn(f: Folder, ops: Op[], text: string, quiet: string[] = []): Op[] {
  // Anyone this reply's cast lines name, even someone leaving: they were in it for some of it.
  const inCast = new Set(ops.filter((op) => op.op === "cast").flatMap((op) => ((op.args.list ?? []) as { name: string }[]).flatMap((x) => f.each(x.name).map((n) => norm(personName(n))))));
  const castIds = new Set([...inCast].map((n) => f.findChar(n)?.id).filter(Boolean));
  const castHas = (name: string) => inCast.has(norm(personName(name))) || castIds.has(f.findChar(name)?.id);
  const reached = (name: string) => {
    if (castHas(name)) return true;
    const c = f.findChar(name);
    if (!c) return mentions(text, personName(name));
    if (c.dead) return false;
    return c.isUser || c.tier === "spot" || c.tier === "peri" || [c.name, ...c.aliases].some((n) => mentions(text, n));
  };
  return ops.map((op) => {
    if (!REACH_OPS.has(op.op) || !op.subject || REMOTE_ROUTE.test(`${op.args.route ?? ""} ${op.cause ?? ""}`)) return op;
    const away: string[] = [];
    const unsure: string[] = [];
    for (const part of f.each(op.subject)) {
      if (/\(/.test(part)) continue;
      const w = f.whoIs(part);
      // docs/31 2.1: someone named on a know line the reply never reached. Naming them is stronger than a
      // group word, so it's filed with a question rather than dropped.
      if (w.kind === "person") {
        if (op.op === "know" && !reached(part)) unsure.push(f.findChar(part)?.name ?? personName(part));
        continue;
      }
      // docs/31 3.1: "everyone" is the scene, but not someone it hasn't named in a while (unless this reply does).
      if (w.kind === "crowd") {
        if (op.op === "know") away.push(...quiet.filter((n) => !mentions(text, n) && !castHas(n)));
        continue;
      }
      if (w.kind !== "many") continue;
      const group = w.group.replace(/^@/, "").replace(/^the\s+/i, "");
      if (mentions(text, group) || text.toLowerCase().includes(group.toLowerCase())) continue;
      away.push(...w.names.filter((n) => !reached(n)));
    }
    if (!away.length && !unsure.length) return op;
    return { ...op, args: { ...op.args, ...(away.length ? { away: uniq(away) } : {}), ...(unsure.length ? { unsure: uniq(unsure) } : {}) } };
  });
}

/** docs/31 2.3: the lines whose holder has to be there: knowing what was said, a mood from it, a bond moved by it. */
const REACH_OPS = new Set(["know", "mood", "bond"]);
/** The flag on a knowledge chip for someone named who wasn't in the scene or the messages. */
export const UNSURE_FLAG = "not in the scene?";

export function foldEvents(events: TrackerEvent[], cfg: FoldConfig): FoldResult {
  const f = new Folder(cfg);
  for (const ev of events) f.apply(ev);
  return { state: f.state, changes: f.changes, verdicts: f.verdicts };
}

export { detectStamina };
