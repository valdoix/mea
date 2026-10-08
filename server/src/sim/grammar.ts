import type { ArcKind, EndResult, Result, Route, Secrecy, Stage } from "./types";

/**
 * The grammar of subplots (after ALMANAC 09 §5.2, extended): each kind says when it fits, how
 * fast it moves, how it reaches the player, what a win costs, how a loss makes things worse,
 * and what the lead does at each step of a dramatic shape (hook, rising, reversal, crisis,
 * climax). The engine's own sentences tell a beat when the model doesn't.
 */
export interface KindSpec {
  kind: ArcKind;
  label: string;
  /** Words that suggest this kind in a thread, a want, a role or a premise. */
  words: RegExp;
  clock: 4 | 6 | 8;
  /** Beats per story hour, before heat, stage, mode and the director. */
  base: number;
  secrecy: Secrecy;
  routes: Route[];
  prices: string[];
  worse: string[];
  want: string;
  fear: string;
  /** What the lead does at each step, after their name. {want}, {cast}, {town}, {vice}. */
  moves: Record<Exclude<Stage, "aftermath">, string>;
  /** Where a win leaves things. */
  state: string;
  other?: string;
  /** A lost ending can't be undone (a death, a permanent departure): fates apply. */
  irreversible?: boolean;
  /** Against its target (for tied subplots and the director). */
  hostile?: boolean;
  /** How the ending moves bonds: [lead→target axis, delta on met, delta on lost]. */
  bond?: { axis: string; met: number; lost: number };
}

const S = (o: KindSpec) => o;

export const SPECS: Record<ArcKind, KindSpec> = {
  pursuit: S({
    kind: "pursuit", label: "Pursuit", words: /\b(wants?|seeks?|search|looking for|find|win|earn|recover|chase|goal|dream)\b/i, clock: 6, base: 0.08, secrecy: "private",
    routes: ["carrier", "entrance", "signal"], prices: ["it ate the whole day", "it cost money that was hard to spare", "it left a favour owed", "someone took notice", "it strained a friendship"],
    worse: ["the trail went cold", "someone else got there first", "it drew the wrong kind of attention", "a promise had to be broken"],
    want: "to get what they're after", fear: "it slips away for good",
    moves: { hook: "set out {want}", rising: "kept at it, still trying {want}", reversal: "found the way forward wasn't what it seemed", crisis: "risked a great deal {want}", climax: "made one last push {want}" },
    state: "The trail is warm.",
  }),
  scheme: S({
    kind: "scheme", label: "Scheme", words: /\b(scheme|plot|conspir\w*|usurp|seize|ambitious|alliance|influence|power|succession|leverage|blackmail|manipulat\w*)\b/i, clock: 8, base: 0.07, secrecy: "secret",
    routes: ["carrier", "signal", "entrance", "omen"], prices: ["an ally began to have doubts", "it meant owing a dangerous friend", "someone saw more than they should have", "it cost good coin"],
    worse: ["a confidant talked", "the rival moved first", "a letter went astray", "the plan had to change"],
    want: "to gain the upper hand", fear: "the plot comes to light",
    moves: { hook: "quietly laid the groundwork {want}", rising: "moved another piece into place", reversal: "discovered someone else was playing the same game", crisis: "pulled every string at once", climax: "made the decisive move" },
    state: "Nobody suspects a thing.", hostile: true, bond: { axis: "rivalry", met: 1, lost: 1 },
  }),
  rivalry: S({
    kind: "rivalry", label: "Rivalry", words: /\b(rival|rivalry|compet\w*|feud|score to settle|one-?up)\b/i, clock: 6, base: 0.07, secrecy: "private",
    routes: ["carrier", "ambient", "entrance"], prices: ["it ended in a public scene", "a friend's patience wore thin", "pride took a bruising"],
    worse: ["the other side struck back", "it turned ugly in public", "someone got hurt"],
    want: "to come out on top", fear: "the other side wins", other: "the other side",
    moves: { hook: "took a swipe at {cast}", rising: "raised the stakes with {cast}", reversal: "was caught off guard by {cast}", crisis: "pushed {cast} to the edge", climax: "forced a showdown with {cast}" },
    state: "{Lead} {has} the upper hand, for now.", hostile: true, bond: { axis: "rivalry", met: 1, lost: 1 },
  }),
  revenge: S({
    kind: "revenge", label: "Revenge", words: /\b(revenge|vengeance|avenge|get back at|pay (?:them|him|her) back|grudge|wronged|betrayed)\b/i, clock: 6, base: 0.06, secrecy: "secret",
    routes: ["omen", "carrier", "trace", "entrance"], prices: ["it cost them a night's sleep and a little more of themselves", "it meant using someone who trusted them", "they left a trace behind"],
    worse: ["{cast} saw it coming", "it hurt the wrong person", "they lost their nerve"],
    want: "to make {cast} pay", fear: "{cast} gets away with it", other: "whoever wronged them",
    moves: { hook: "began watching {cast}", rising: "learned {cast}'s habits and weak points", reversal: "found {cast} had their own reasons", crisis: "set the trap for {cast}", climax: "moved against {cast}" },
    state: "{Cast} doesn't know what's coming.", hostile: true, irreversible: true, bond: { axis: "resentment", met: -1, lost: 1 },
  }),
  courtship: S({
    kind: "courtship", label: "Courtship", words: /\b(courting|courtship|woo(?:s|ing|ed)?|flirt\w*|on a date|dating|crush on|attracted to|smitten|in love|sweetheart)\b/i, clock: 6, base: 0.07, secrecy: "private",
    routes: ["carrier", "ambient", "entrance"], prices: ["people started talking", "a friend made their disapproval plain", "there was a misunderstanding to untangle"],
    worse: ["it went awkwardly wrong", "a rival turned up", "one of them pulled back"],
    want: "to be with the one they want", fear: "it falls apart before it starts", other: "the one who'd caught their eye",
    moves: { hook: "found an excuse to be near {cast}", rising: "made {cast} laugh, and stayed longer than they meant to", reversal: "said the wrong thing to {cast}", crisis: "risked something real with {cast}", climax: "finally told {cast} the truth" },
    state: "{Cast} didn't seem to mind.", bond: { axis: "affection", met: 2, lost: -1 },
  }),
  rift: S({
    kind: "rift", label: "Rift", words: /\b(argument|argue|fight with|falling[- ]out|estranged|broke up|rift|quarrel|not speaking)\b/i, clock: 4, base: 0.08, secrecy: "private",
    routes: ["carrier", "entrance", "signal"], prices: ["hard words were said", "it ended with a night apart", "now an apology is owed"],
    worse: ["it only got worse", "someone took sides", "a door was slammed"],
    want: "to set things right", fear: "the bond breaks", other: "the other one",
    moves: { hook: "stopped answering {cast}'s messages", rising: "tried to talk things through with {cast}", reversal: "learned what {cast} had really meant", crisis: "had it out with {cast} at last", climax: "made a choice about {cast}" },
    state: "Things are a little easier between them.", bond: { axis: "trust", met: 1, lost: -2 },
  }),
  reconcile: S({
    kind: "reconcile", label: "Reconciliation", words: /\b(reconcil\w*|make amends|apolog\w*|forgive\w*|patch (?:it|things) up|mend fences|second chance)\b/i, clock: 4, base: 0.06, secrecy: "private",
    routes: ["carrier", "signal", "entrance"], prices: ["it meant swallowing a lot of pride", "old hurts came up first"],
    worse: ["the apology came out wrong", "{cast} wasn't ready to listen"],
    want: "to make amends with {cast}", fear: "it's too late", other: "the one they hurt",
    moves: { hook: "drafted an apology to {cast} and didn't send it", rising: "reached out to {cast}", reversal: "found {cast} carrying a hurt they hadn't known about", crisis: "showed up in person for {cast}", climax: "asked {cast} for forgiveness" },
    state: "There's a little warmth again.", bond: { axis: "trust", met: 2, lost: -1 },
  }),
  debt: S({
    kind: "debt", label: "Debt", words: /\b(owe|owes|owed|debt|payment|back[- ]pay|bills?|mortgage|loan|rent|collector)\b/i, clock: 4, base: 0.06, secrecy: "private",
    routes: ["signal", "carrier", "entrance"], prices: ["the interest kept climbing", "the deadline moved up", "pride had to be swallowed"],
    worse: ["the creditor lost patience", "the sum grew", "a threat was made"],
    want: "to settle what's owed", fear: "the debt comes due all at once", other: "a creditor",
    moves: { hook: "counted what they had against what they owed {cast}", rising: "chipped away at the debt to {cast}", reversal: "found the debt was bigger than they'd been told", crisis: "scrambled to pay {cast}", climax: "faced {cast} over the debt" },
    state: "The debt is smaller than it was.", bond: { axis: "obligation", met: -1, lost: 1 },
  }),
  secret: S({
    kind: "secret", label: "Secret", words: /\b(secret|hid(?:e|es|ing|den)|conceal|cover[- ]up|nobody knows|tell no one)\b/i, clock: 6, base: 0.06, secrecy: "secret",
    routes: ["carrier", "entrance", "omen"], prices: ["it took another lie", "there was one more lie to keep straight", "someone half-guessed"],
    worse: ["someone saw something", "a lie didn't hold", "a clue was left behind"],
    want: "to keep it hidden", fear: "it comes out", other: "everyone",
    moves: { hook: "covered the tracks", rising: "kept {cast} in the dark", reversal: "realised {cast} already suspected", crisis: "had a close call with {cast}", climax: "was nearly caught out by {cast}" },
    state: "The secret is safe, for now.",
  }),
  decline: S({
    kind: "decline", label: "Decline", words: /\b(addict\w*|spiral\w*|dark magic|drinking|drunk|overdose|withdraw\w*|craving|hooked|obsess\w*|gambl\w*)\b/i, clock: 6, base: 0.07, secrecy: "secret",
    routes: ["carrier", "signal", "entrance", "trace"], prices: ["it took a lie to someone close", "it cost money", "it cost a night's sleep", "a little more of them went with it"],
    worse: ["it went further than meant", "someone close was hurt by it", "the cost began to show"],
    want: "to stay in control", fear: "they hit bottom",
    moves: { hook: "leaned on {vice} a little", rising: "leaned on {vice} harder than before", reversal: "swore off {vice}, and lasted a day", crisis: "leaned on {vice} with everything at stake", climax: "reached the edge with {vice}" },
    state: "Nobody has noticed yet.", irreversible: true,
  }),
  recovery: S({
    kind: "recovery", label: "Recovery", words: /\b(recover\w*|heal\w*|rehab\w*|getting better|sober\w*|therapy|rebuild\w*|convalesc\w*)\b/i, clock: 6, base: 0.05, secrecy: "private",
    routes: ["carrier", "signal", "entrance"], prices: ["it was slower than they'd hoped", "it meant asking for help"],
    worse: ["they had a setback", "an old habit pulled at them"],
    want: "to get back on their feet", fear: "they slip back",
    moves: { hook: "made the first small step", rising: "kept to the routine", reversal: "had a bad day that felt like the beginning again", crisis: "faced the thing that broke them", climax: "stood on their own again" },
    state: "They're steadier than they were.",
  }),
  investigation: S({
    kind: "investigation", label: "Investigation", words: /\b(investigat\w*|inquir\w*|research\w*|case|clue|evidence|theory|find out|mystery|suspect\w*|detective)\b/i, clock: 6, base: 0.08, secrecy: "private",
    routes: ["carrier", "entrance", "signal"], prices: ["it cost a sleepless night", "it meant calling in a favour", "it meant talking to a dangerous contact"],
    worse: ["it ran into a dead end", "the lead turned out to be false", "someone noticed the questions"],
    want: "to find the answer", fear: "the answer comes too late",
    moves: { hook: "followed up a lead", rising: "dug deeper", reversal: "found evidence that pointed the other way", crisis: "closed in on the answer", climax: "put the pieces together" },
    state: "The answer is coming into focus.",
  }),
  threat: S({
    kind: "threat", label: "Threat", words: /\b(raid|attack|gang|army|invade|invasion|monster|demon|loot|siege|threat|predator|killer|bandits?|hunt(?:ing|s)?)\b/i, clock: 6, base: 0.09, secrecy: "public",
    routes: ["ambient", "trace", "omen", "carrier"], prices: ["they were seen", "one of theirs was hurt", "it took longer than planned"],
    worse: ["someone fought back", "they lost ground", "they were beaten back"],
    want: "to take what they came for", fear: "they're driven off",
    moves: { hook: "scouted {town}", rising: "struck at the edges of {town}", reversal: "ran into resistance they hadn't counted on", crisis: "came at {town} in force", climax: "threw everything at {town}" },
    state: "{Town} is feeling it.", hostile: true, irreversible: true,
  }),
  return: S({
    kind: "return", label: "Return", words: /\b(return|come back|coming back|homecoming|coming home|on (?:the|his|her|their) way back)\b/i, clock: 6, base: 0.09, secrecy: "private",
    routes: ["signal", "carrier", "omen", "entrance"], prices: ["it took longer than hoped", "a connection was missed", "it cost more than planned"],
    worse: ["the journey was delayed", "something held them back", "second thoughts crept in"],
    want: "to come back", fear: "they come back too late",
    moves: { hook: "began thinking of coming back to {town}", rising: "made arrangements to travel", reversal: "had a reason to stay away after all", crisis: "set off for {town}", climax: "is nearly back in {town}" },
    state: "{Lead} {is} on the way.",
  }),
  duty: S({
    kind: "duty", label: "Duty", words: /\b(council|summons|summoned|orders?|duty|office|court|king|queen|lord|command|guild|church|police|crown|boss|employer)\b/i, clock: 6, base: 0.06, secrecy: "private",
    routes: ["signal", "carrier", "entrance"], prices: ["a superior was displeased", "a rule had to bend", "a favour was called in"],
    worse: ["the order came down harder", "a broken rule was noted", "a superior stepped in"],
    want: "to do what the post demands", fear: "the institution turns on them",
    moves: { hook: "answered a summons", rising: "carried out an order", reversal: "was given an order they couldn't stomach", crisis: "was called to account", climax: "chose between duty and conscience" },
    state: "The higher-ups are satisfied, for now.",
  }),
  ambition: S({
    kind: "ambition", label: "Ambition", words: /\b(promotion|career|ambition|audition|exam|competition|tournament|apprentice\w*|business|shop|open(?:ing)? a)\b/i, clock: 6, base: 0.05, secrecy: "public",
    routes: ["carrier", "signal", "ambient"], prices: ["it cost a lot of late nights", "it meant stepping on someone's toes"],
    worse: ["someone better came along", "they choked at the wrong moment"],
    want: "to make something of themselves", fear: "they're passed over",
    moves: { hook: "put their name forward", rising: "worked twice as hard as anyone", reversal: "learned the game was rigged", crisis: "had their big chance", climax: "learned whether it was enough" },
    state: "People are starting to notice.",
  }),
  protect: S({
    kind: "protect", label: "Protection", words: /\b(protect\w*|guard\w*|keep (?:her|him|them) safe|watch over|shield\w*|bodyguard)\b/i, clock: 6, base: 0.07, secrecy: "private",
    routes: ["carrier", "entrance", "omen"], prices: ["they didn't sleep", "it put them in danger instead"],
    worse: ["the danger got closer", "{cast} slipped out of their sight"],
    want: "to keep {cast} safe", fear: "they fail {cast}", other: "the one they're watching over",
    moves: { hook: "started watching over {cast}", rising: "kept a step ahead of the danger to {cast}", reversal: "realised the danger to {cast} was closer than they thought", crisis: "stood between {cast} and the worst of it", climax: "had to choose how far to go for {cast}" },
    state: "{Cast} is safe, for now.", bond: { axis: "trust", met: 1, lost: -1 },
  }),
  life: S({
    kind: "life", label: "Life", words: /\b(work|job|shift|school|class|birthday|family|wedding|holiday|festival|dinner|practice|hospital|garden|neighbou?r)\b/i, clock: 6, base: 0.035, secrecy: "private",
    routes: ["signal", "carrier"], prices: ["it made for a long day", "an errand was forgotten", "there was a small disappointment"],
    worse: ["the day went badly", "plans fell through", "a small worry grew"],
    want: "to get on with an ordinary life", fear: "the ordinary life comes apart",
    moves: { hook: "went about the ordinary business of life", rising: "had a busy stretch", reversal: "had a small surprise", crisis: "had a hard week", climax: "reached a small milestone" },
    state: "",
  }),
  loss: S({
    kind: "loss", label: "Grief", words: /\b(death|died|grief|grieving|funeral|mourn\w*|bereave\w*|widow\w*|orphan\w*|buried)\b/i, clock: 4, base: 0.05, secrecy: "private",
    routes: ["carrier", "signal"], prices: ["it made for a hard night", "an old wound opened again"],
    worse: ["grief turned to anger", "they shut everyone out", "there was an argument at the graveside"],
    want: "to bear it", fear: "they don't come back from it",
    moves: { hook: "got through the first days", rising: "went through the rituals of grief", reversal: "found something of the one they lost", crisis: "broke down at last", climax: "began to find a new shape for life" },
    state: "The worst days are behind {lead}.",
  }),
  faction: S({
    kind: "faction", label: "Faction", words: /\b(guild|council|gang|cult|order|house|clan|company|syndicate|crew|army|court|church)\b/i, clock: 8, base: 0.06, secrecy: "public",
    routes: ["ambient", "signal", "carrier", "omen"], prices: ["somewhere, a price was paid", "a road was closed", "an ally was spent"],
    worse: ["the pressure met resistance", "a rival group moved against them"],
    want: "to move its agenda", fear: "the agenda stalls",
    moves: { hook: "set its sights on {want}", rising: "pushed its agenda", reversal: "found its own members divided", crisis: "pressed harder", climax: "came to a head" },
    state: "{Lead}'s grip is tightening.", hostile: true,
  }),
};

const ORDER: ArcKind[] = ["revenge", "return", "decline", "recovery", "threat", "scheme", "investigation", "debt", "reconcile", "rift", "rivalry", "courtship", "loss", "secret", "protect", "duty", "ambition", "life", "faction", "pursuit"];

/** The kind a piece of text suggests (a thread, a want, a premise), or null. */
export function kindFromText(text: string, exclude: ArcKind[] = ["faction"]): ArcKind | null {
  for (const k of ORDER) if (!exclude.includes(k) && k !== "pursuit" && SPECS[k].words.test(text)) return k;
  return SPECS.pursuit.words.test(text) ? "pursuit" : null;
}

/** Steps through a subplot's shape. */
export function stageOf(cur: number, max: number): Exclude<Stage, "aftermath"> {
  if (cur <= 0) return "hook";
  if (cur >= max - 1) return "climax";
  if (cur === max - 2) return "crisis";
  if (cur === Math.floor(max / 2)) return "reversal";
  return "rising";
}

export function viceOf(text: string): string {
  const m = /\b(dark magic|black magic|magic|drink(?:ing)?|alcohol|the bottle|drugs?|pills|power|gambling|blood)\b/i.exec(text);
  if (!m) return "it";
  const w = m[1]!.toLowerCase();
  return /^(drink|drinking|alcohol)$/.test(w) ? "the bottle" : w === "drug" ? "drugs" : w;
}

const cap = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);
const sentence = (s: string) => {
  const t = s.trim().replace(/[;,:\s]+$/, "");
  return t ? `${cap(t)}${/[.!?…”"]$/.test(t) ? "" : "."}` : "";
};
const bare = (s: string) => s.replace(/[.!]+$/, "").trim();
const isGroup = (name: string) => /\b(guild|council|gang|cult|order|house|clan|company|syndicate|crew|army|court|church|family|police)\b/i.test(name);

export interface BeatWords {
  kind: ArcKind;
  lead: string;
  want: string;
  stage: Exclude<Stage, "aftermath">;
  result: Result;
  price?: string;
  worse?: string;
  cast?: string;
  town?: string;
  place?: string;
  premise?: string;
  twist?: string;
  /** The lead is a group (a faction): "the Harbour Guild are…". */
  group?: boolean;
}

/** The engine's two sentences for a beat: what happened, then where it leaves things. */
export function beatTemplate(o: BeatWords): string {
  const spec = SPECS[o.kind];
  const group = o.group ?? isGroup(o.lead);
  const lead = group && !/^the\s/i.test(o.lead) ? `the ${o.lead}` : o.lead;
  const town = o.town || "town";
  const cast = o.cast || spec.other || "someone";
  const want = bare(o.want || spec.want).replace(/\{cast\}/g, cast);
  const fill = (t: string) =>
    t
      .replace(/\{want\}/g, want)
      .replace(/\{vice\}/g, viceOf(`${o.premise ?? ""} ${o.want}`))
      .replace(/\{cast\}/g, cast)
      .replace(/\{Cast\}/g, cap(cast))
      .replace(/\{town\}/g, town)
      .replace(/\{Town\}/g, cap(town))
      .replace(/\{lead\}/g, lead)
      .replace(/\{Lead\}/g, cap(lead))
      .replace(/\{is\}/g, group ? "are" : "is")
      .replace(/\{has\}/g, group ? "have" : "has");
  const placeWord = o.place ? o.place.split(/\s*›\s*/).at(-1)! : "";
  const where = placeWord && !want.toLowerCase().includes(placeWord.toLowerCase()) && placeWord.toLowerCase() !== town.toLowerCase() ? `At ${placeWord}, ` : "";
  const first = `${where}${where ? lead : cap(lead)} ${fill(spec.moves[o.stage])}.`;
  const twist = o.twist ? ` ${sentence(o.twist)}` : "";
  const then = o.result === "win" ? fill(spec.state) : o.result === "cost" ? sentence(fill(o.price ?? spec.prices[0]!)) : sentence(fill(o.worse ?? spec.worse[0]!));
  return `${first}${twist}${then ? ` ${then}` : ""}`.trim();
}

const PAST: Record<string, string> = {
  slips: "slipped", comes: "came", come: "came", wins: "won", falls: "fell", fall: "fell", breaks: "broke", stalls: "stalled", fails: "failed",
  gets: "got", goes: "went", is: "was", are: "were", "they're": "they were", "it's": "it was", hit: "hit", passed: "passed",
};
function cameTrue(fear: string, lead: string): string {
  const t = fear.replace(/[\w']+/g, (w) => PAST[w.toLowerCase()] ?? w).replace(/^they\b/i, lead);
  return sentence(t);
}

/** The engine's words for an ending. */
export function endTemplate(o: { kind: ArcKind; lead: string; want: string; fear: string; result: EndResult; price?: string; cast?: string }): string {
  const spec = SPECS[o.kind];
  const cast = o.cast || spec.other || "the other side";
  const want = bare(o.want || spec.want).replace(/\{cast\}/g, cast);
  const fear = bare(o.fear || spec.fear).replace(/\{cast\}/g, cast).replace(/^(?:that)\s+/i, "");
  if (o.result === "met") return `In the end, ${o.lead} managed ${want}.`;
  if (o.result === "price") return `In the end, ${o.lead} managed ${want}. ${sentence(o.price ?? "It cost more than anyone expected")}`;
  if (o.result === "softened") return `${cap(o.lead)} came close to the worst, but it didn't come to that.`;
  return `It went badly for ${o.lead}. ${cameTrue(fear, o.lead)}`;
}

/** Genres lean the draw toward kinds that deliver them. */
export const GENRE_LEAN: Record<string, ArcKind[]> = {
  horror: ["threat", "decline", "secret"], romance: ["courtship", "rift", "reconcile"], intrigue: ["scheme", "secret", "duty"], cozy: ["life", "ambition", "reconcile"],
  "slice of life": ["life", "ambition"], mystery: ["investigation", "secret"], noir: ["debt", "secret", "scheme", "revenge"], thriller: ["threat", "scheme", "revenge"],
  drama: ["rift", "loss", "decline", "reconcile"], fantasy: ["duty", "threat", "return", "faction"], "dark fantasy": ["threat", "decline", "scheme", "revenge"], tragedy: ["loss", "decline"],
  comedy: ["courtship", "life", "rivalry"], adventure: ["pursuit", "threat", "investigation"], action: ["threat", "rivalry", "revenge"], survival: ["threat", "loss", "protect"],
};

export const RESULT_WORD: Record<Result, string> = { win: "went their way", cost: "worked, at a price", loss: "went wrong" };
