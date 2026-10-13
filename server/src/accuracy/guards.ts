import { all, parseJson } from "../db/db";
import { defaultGuards, getSetting, type GuardsConfig } from "../lib/settings";
import { chatNames } from "../memory/build";
import { cleanText } from "../memory/text";
import { type ChatSettings, mustChat } from "../services/chats";
import { layered, type PersonaMode, storyDials } from "../services/layers";
import { currentFold } from "../trackers/store";
import type { Issue } from "./checker";
import { fixNames, nameSlips } from "./names";

/**
 * Point of view, tense and puppeting (CON-04), plus the name registry's slips (CON-05).
 * Cheap rules over the reply's narration (dialogue in quotes is left out), compared with the
 * story settings or, failing those, with the last few replies. They flag; for puppeting they can
 * also cut the end of the reply or ask for one more try, and names can be corrected in place.
 */

export function guardsFor(chatId: string): GuardsConfig {
  const global = { ...defaultGuards, ...getSetting("guards.config") };
  const own = parseJson<ChatSettings>(mustChat(chatId).settings, {}).guards ?? {};
  // A chat's own check switches go over the global ones, one by one.
  return { ...global, ...own, slips: { ...global.slips, ...own.slips } };
}

type GuardIssue = Omit<Issue, "id">;

const sentences = (t: string) => t.split(/(?<=[.!?…]["”')\]*]*)\s+|\n+/).filter((s) => s.trim());
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** The narration of a text: quoted speech replaced by a placeholder. */
export const narration = (t: string) => t.replace(/"[^"\n]*"|“[^”\n]*”/g, " ‹…› ");

const SPEECH = "say|says|said|reply|replies|replied|ask|asks|asked|whisper|whispers|whispered|murmur|murmurs|murmured|shout|shouts|shouted|answer|answers|answered|mutter|mutters|muttered|tell|tells|told|admit|admits|admitted|confess|confesses|confessed|promise|promises|promised";
const ACT =
  "nod|nods|nodded|smile|smiles|smiled|grin|grins|grinned|laugh|laughs|laughed|sigh|sighs|sighed|walk|walks|walked|step|steps|stepped|reach|reaches|reached|take|takes|took|grab|grabs|grabbed|pull|pulls|pulled|push|pushes|pushed|kiss|kisses|kissed|hug|hugs|hugged|decide|decides|decided|agree|agrees|agreed|lean|leans|leaned|follow|follows|followed|hand|hands|handed|wrap|wraps|wrapped|shrug|shrugs|shrugged|blush|blushes|blushed|wink|winks|winked|squeeze|squeezes|squeezed|reply|replies";

export interface PuppetHit {
  sentence: string;
  speech: boolean;
}

/** Quoted speech blanked out over the whole text (a quote can hold several sentences); an unclosed quote runs to the paragraph's end. */
const maskSpeech = (t: string) => t.replace(/"[^"\n]*(?:"|(?=\n|$))|“[^”\n]*(?:”|(?=\n|$))/g, (m) => " ".repeat(m.length));

const ap = (words: string) => words.replace(/'/g, "['’]");
/** Words before the name that make it a mention, not the reply acting: "what Alex said", "did you say", "remembers Alex asked". */
const MENTION = new RegExp(
  `(?:^|[^\\p{L}'’])(?:${ap(
    "what|whatever|how|why|where|whether|if|unless|until|before|everything|all|anything|something|nothing|do|does|did|don't|doesn't|didn't|would|wouldn't|could|couldn't|should|shouldn't|will|won't|can|can't|might|may|must|remember|remembers|remembered|recall|recalls|recalled|hear|hears|heard|know|knows|knew|forget|forgets|forgot|swear|swears|swore",
  )})(?:\\s+that)?\\s+$`,
  "iu",
);
/** And words that make a speech verb a reference to something already said: "as you said", "when you said that". */
const SAID_BEFORE = /(?:^|[^\p{L}'’])(?:as|like|when|whenever|after|since|once|because)(?:\s+that)?\s+$/iu;

/** Sentences where the reply writes the user's character speaking or acting (CON-04). Mentions, reported speech and earlier lines don't count. */
export function puppetHits(text: string, userNames: string[], opts: { second: boolean }): PuppetHit[] {
  const names = userNames.filter((n) => n.trim().length >= 2).map(esc);
  const subj = [...names, ...(opts.second ? ["you", "You"] : [])];
  if (!subj.length) return [];
  const verb = (v: string) => new RegExp(`(?<=^|[^\\p{L}])(?:${subj.join("|")})(?:\\s+(?:\\w+ly|then|just|finally|quietly|slowly))?\\s+(?:${v})\\b`, "gu");
  const speech = verb(SPEECH);
  const act = verb(ACT);
  const writes = (re: RegExp, n: string, isSpeech: boolean) =>
    [...n.matchAll(re)].some((m) => {
      const before = n.slice(Math.max(0, m.index - 40), m.index);
      return !MENTION.test(before) && !(isSpeech && SAID_BEFORE.test(before));
    });
  const lineSpeaker = names.length ? new RegExp(`^\\s*(?:\\*\\*)?(?:${names.join("|")})(?:\\*\\*)?\\s*:\\s*\\S`, "m") : null;
  const clean = cleanText(text);
  const masked = maskSpeech(clean);
  const out: PuppetHit[] = [];
  let from = 0;
  for (const s of sentences(clean)) {
    const at = clean.indexOf(s, from);
    from = at + s.length;
    // Out-of-character asides in parentheses aren't the story writing for anyone.
    const n = masked.slice(at, at + s.length).replace(/\([^)]*\)/g, " ");
    if (lineSpeaker?.test(s)) out.push({ sentence: s.trim(), speech: true });
    else if (writes(speech, n, true)) out.push({ sentence: s.trim(), speech: true });
    else if (writes(act, n, false)) out.push({ sentence: s.trim(), speech: false });
  }
  return out;
}

/**
 * What counts as puppeting under the preset's Persona control: everything when sealed, only
 * words when the model may finish the player's started actions, nothing when it may write them.
 */
export type PuppetScope = "all" | "speech" | "off";
const scopeOf = (persona: PersonaMode | null): PuppetScope => (persona === "director" || persona === "full_cast" ? "off" : persona === "continuity" ? "speech" : "all");
export function puppetScope(chatId: string): PuppetScope {
  return scopeOf(storyDials(mustChat(chatId)).persona);
}

/**
 * Whether a stored flag still counts under the Persona control as it is now: a puppet flag saved
 * while it was Sealed hides once you switch to Director or Full cast (and an actions-only one under Continuity).
 */
export const flagAllowed = (i: { kind: string; severity: string }, scope: PuppetScope) => i.kind !== "puppet" || scope === "all" || (scope === "speech" && i.severity === "major");

const scoped = (hits: PuppetHit[], scope: PuppetScope) => (scope === "off" ? [] : scope === "speech" ? hits.filter((h) => h.speech) : hits);

/** Cuts a reply where it starts writing for the user, when that's in its second half. */
export function trimPuppeting(text: string, hits: PuppetHit[]): { text: string; cut: string } | null {
  const first = hits[0];
  if (!first) return null;
  const at = text.indexOf(first.sentence.slice(0, Math.min(40, first.sentence.length)));
  if (at < 0 || at < text.length * 0.4) return null;
  const kept = text.slice(0, at).trimEnd();
  if (kept.length < 40) return null;
  return { text: kept, cut: text.slice(at).trim() };
}

export type Narrator = "first" | "third" | null;
export type Address = "second" | "third" | null;
export type Tense = "past" | "present" | null;

/** Who narrates (the character as "I", or in third person) and how the user is addressed ("you" or by name). */
export function voiceOf(text: string, charNames: string[], userNames: string[]): { narrator: Narrator; address: Address } {
  const n = narration(cleanText(text));
  const count = (re: RegExp) => (n.match(re) ?? []).length;
  const first = count(/\bI\b|\b(?:me|my|myself|mine)\b/g);
  const cn = charNames.filter((x) => x.length >= 2).map(esc);
  const third = count(/\b(?:she|he|her|him|his|hers|herself|himself)\b/gi) + (cn.length ? count(new RegExp(`\\b(?:${cn.join("|")})\\b`, "g")) : 0);
  const second = count(/\b(?:you|your|yours|yourself)\b/gi);
  const un = userNames.filter((x) => x.length >= 2).map(esc);
  const userThird = un.length ? count(new RegExp(`\\b(?:${un.join("|")})\\b`, "g")) : 0;
  const narrator: Narrator = first >= 4 && first >= third * 1.5 ? "first" : third >= 4 && third >= first * 1.5 ? "third" : null;
  const address: Address = second >= 3 && second >= userThird * 2 ? "second" : userThird >= 3 && userThird >= second * 2 ? "third" : null;
  return { narrator, address };
}

const PAST = new Set(
  "was were had did said went came took made saw knew thought felt told gave found left stood sat held kept began brought got ran fell rose spoke heard meant put set let lay drew grew wore threw caught taught bought fought sought slept swept wept woke shook broke chose froze stole hid bit lit led fed fled met paid sent spent built lent bent stuck struck swung hung rang sang sank drank shrank swam began".split(" "),
);
const PRESENT = new Set(
  "is are am has does says goes comes takes makes sees knows thinks feels tells gives finds leaves stands sits holds keeps begins brings gets runs falls rises speaks hears means puts sets lets lies draws grows wears throws catches teaches buys fights seeks sleeps sweeps weeps wakes shakes breaks chooses freezes steals hides bites lights leads feeds flees meets pays sends spends builds lends bends sticks strikes swings hangs rings sings sinks drinks swims".split(" "),
);
const NOT_VERBS = new Set("always perhaps just never still also only even then too almost already really nearly suddenly finally quietly slowly gently softly".split(" "));

/**
 * Sentences that step out of the narration's own time, where the other tense is right: a memory or
 * a backstory ("years ago", "she had", "remembers"), what's to come, a thought, a general truth.
 */
const TIME_SHIFT =
  /\b(?:ago|yesterday|earlier|before|once|used to|had|hadn't|remember(?:s|ed)?|recall(?:s|ed)?|thinks?|thought|wonder(?:s|ed)?|knows?|knew|always|every time|whenever|tomorrow|tonight|soon|will|won't|would|wouldn't|later|since|last (?:night|week|year|time)|back then|when (?:she|he|they|I|we|you) (?:was|were|is|are))\b/i;

/**
 * The narration's tense: past, present, or unclear (with the counts, to spot a reply that wobbles).
 * Each sentence counts once, by its main verb (its first subject and verb), and sentences that step
 * into another time don't count at all, so a present-tense scene that remembers isn't "switching".
 */
export function tenseOf(text: string, charNames: string[]): { tense: Tense; past: number; present: number } {
  const n = narration(cleanText(text));
  const cn = charNames.filter((x) => x.length >= 2).map(esc);
  const re = new RegExp(`\\b(?:[Hh]e|[Ss]he|[Ii]t|[Tt]hey|I|[Ww]e|[Yy]ou|${cn.length ? cn.join("|") : "\\u0000"})\\s+(?:(?:\\w+ly|still|just|then|never|also)\\s+)?([a-z]+)\\b`, "g");
  let past = 0;
  let present = 0;
  for (const s of sentences(n)) {
    if (TIME_SHIFT.test(s)) continue;
    for (const m of s.matchAll(re)) {
      const v = m[1]!;
      if (NOT_VERBS.has(v)) continue;
      if (PAST.has(v) || (v.length > 4 && v.endsWith("ed"))) past++;
      else if (PRESENT.has(v) || (v.length > 3 && v.endsWith("s") && !/(ss|us|is|ous)$/.test(v))) present++;
      else continue;
      break;
    }
  }
  const tense: Tense = past >= 5 && past >= present * 2 ? "past" : present >= 5 && present >= past * 2 ? "present" : null;
  return { tense, past, present };
}

/** What the story expects: its settings first, else what most of the recent replies do. */
function expected(chatId: string, beforeSeq: number, charNames: string[], userNames: string[]) {
  const chat = mustChat(chatId);
  const story = layered(parseJson<ChatSettings>(chat.settings, {}), chat.character_id).story;
  const recent = all<{ content: string }>(
    `SELECT s.content FROM messages m JOIN swipes s ON s.message_id = m.id AND s.idx = m.active_swipe
     WHERE m.chat_id = ? AND m.role = 'assistant' AND m.deleted_at IS NULL AND m.seq < ? AND s.status = 'done' ORDER BY m.seq DESC LIMIT 5`,
    chatId,
    beforeSeq,
  ).map((r) => r.content);
  const together = recent.length >= 3 ? recent.join("\n\n") : "";
  const voices = together ? voiceOf(together, charNames, userNames) : { narrator: null, address: null };
  const pov = (story.pov ?? "").toLowerCase();
  const tenseSet = (story.tense ?? "").toLowerCase();
  return {
    narrator: (/first/.test(pov) ? "first" : /third/.test(pov) ? "third" : voices.narrator) as Narrator,
    address: (/second/.test(pov) ? "second" : voices.address) as Address,
    tense: (/present/.test(tenseSet) ? "present" : /past/.test(tenseSet) ? "past" : together ? tenseOf(together, charNames).tense : null) as Tense,
    fromSettings: { pov: Boolean(pov), tense: Boolean(tenseSet) },
  };
}

function names(chatId: string) {
  const n = chatNames(chatId);
  const userNames = [n.user];
  const charNames = [n.char];
  try {
    for (const c of Object.values(currentFold(chatId).result.state.chars)) {
      if (c.isUser) userNames.push(c.name, ...c.aliases);
      else if (c.isMain) charNames.push(c.name, ...c.aliases);
    }
  } catch {
    // trackers are optional
  }
  // A first name alone counts too ("Alex" for "Alex Reyes").
  for (const list of [userNames, charNames]) for (const x of [...list]) if (x.includes(" ")) list.push(x.split(" ")[0]!);
  return { n, userNames: [...new Set(userNames.filter(Boolean))], charNames: [...new Set(charNames.filter(Boolean))] };
}

/** What one reply's guard checks share: its text, the names, and (computed once, when first asked) what the story expects. */
export interface GuardInput {
  chatId: string;
  text: string;
  seq: number;
  messageId?: string;
  cfg: GuardsConfig;
  n: ReturnType<typeof chatNames>;
  userNames: string[];
  charNames: string[];
  exp: () => ReturnType<typeof expected>;
}

export function guardInput(chatId: string, text: string, o: { seq: number; messageId?: string; cfg?: GuardsConfig }): GuardInput {
  const { n, userNames, charNames } = names(chatId);
  let memo: ReturnType<typeof expected> | null = null;
  return { chatId, text, seq: o.seq, messageId: o.messageId, cfg: o.cfg ?? guardsFor(chatId), n, userNames, charNames, exp: () => (memo ??= expected(chatId, o.seq, charNames, userNames)) };
}

/** CON-04: the reply writes the user's character. */
export function puppetGuard(g: GuardInput): GuardIssue[] {
  const { chatId, text, n, userNames } = g;
  const persona = storyDials(mustChat(chatId)).persona;
  const hits = scoped(puppetHits(text, userNames, { second: g.exp().address !== "third" }), scopeOf(persona));
  if (!hits.length) return [];
  const h = hits.find((x) => x.speech) ?? hits[0]!;
  const continuity = persona === "continuity";
  return [
    {
      kind: "puppet",
      severity: hits.some((x) => x.speech) ? "major" : "minor",
      claim: h.sentence.slice(0, 240),
      conflict: `The reply writes ${n.user}'s ${hits.some((x) => x.speech) ? "words" : "actions"}${hits.length > 1 ? ` (${hits.length} places)` : ""}. ${continuity ? `Under Persona: Continuity it may only finish an action ${n.user} began.` : `Only you write ${n.user}.`}`,
      citations: [{ ref: "R", type: "card", label: continuity ? "Persona: Continuity" : "Your character is yours to write" }],
      fix: continuity
        ? `Don't write ${n.user}'s words, thoughts or decisions, or start an action for them; finishing an action ${n.user} began is fine.`
        : `Don't write ${n.user}'s words, actions, thoughts or decisions; stop where ${n.user} would respond.`,
      by: "rules",
    },
  ];
}

/** CON-04: who narrates, and how the user is addressed. */
export function povGuard(g: GuardInput): GuardIssue[] {
  const { text, n, charNames, userNames } = g;
  const exp = g.exp();
  const out: GuardIssue[] = [];
  const v = voiceOf(text, charNames, userNames);
  const why = exp.fromSettings.pov ? "the story settings" : "the recent replies";
  if (v.narrator && exp.narrator && v.narrator !== exp.narrator)
    out.push({
      kind: "pov",
      severity: "major",
      claim: sentences(cleanText(text))[0]?.slice(0, 240) ?? "",
      conflict: `This reply narrates in the ${v.narrator} person; ${why} use the ${exp.narrator} person.`,
      citations: [{ ref: "S", type: "card", label: `Point of view: ${exp.narrator} person` }],
      fix: `Narrate in the ${exp.narrator} person${exp.narrator === "first" ? ` as ${n.char} ("I")` : ""}.`,
      by: "rules",
    });
  if (v.address && exp.address && v.address !== exp.address)
    out.push({
      kind: "pov",
      severity: "minor",
      claim: sentences(cleanText(text))[0]?.slice(0, 240) ?? "",
      conflict: `This reply calls ${n.user} ${v.address === "second" ? '"you"' : `by name`}; ${why} ${exp.address === "second" ? 'say "you"' : "use the name"}.`,
      citations: [{ ref: "S", type: "card", label: `${n.user} is ${exp.address === "second" ? '"you"' : "named"} in the narration` }],
      fix: exp.address === "second" ? `Address ${n.user} as "you" in the narration.` : `Refer to ${n.user} by name in the narration, not as "you".`,
      by: "rules",
    });
  return out;
}

/** CON-04: the narration's tense. */
export function tenseGuard(g: GuardInput): GuardIssue[] {
  const { text, charNames } = g;
  const exp = g.exp();
  const t = tenseOf(text, charNames);
  if (t.tense && exp.tense && t.tense !== exp.tense)
    return [
      {
        kind: "tense",
        severity: "minor",
        claim: sentences(cleanText(text))[0]?.slice(0, 240) ?? "",
        conflict: `This reply is told in the ${t.tense} tense; ${exp.fromSettings.tense ? "the story settings ask for" : "the story has been in"} the ${exp.tense} tense.`,
        citations: [{ ref: "S", type: "card", label: `Tense: ${exp.tense}` }],
        fix: `Narrate in the ${exp.tense} tense.`,
        by: "rules",
      },
    ];
  if (!t.tense && t.past >= 5 && t.present >= 5 && Math.min(t.past, t.present) / Math.max(t.past, t.present) >= 0.6)
    return [
      {
        kind: "tense",
        severity: "minor",
        claim: sentences(cleanText(text))[0]?.slice(0, 240) ?? "",
        conflict: `The narration switches between past and present tense (${t.past} past, ${t.present} present).`,
        citations: [{ ref: "S", type: "card", label: exp.tense ? `Tense: ${exp.tense}` : "One tense per reply" }],
        fix: `Keep the narration in one tense${exp.tense ? ` (${exp.tense})` : ""}.`,
        by: "rules",
      },
    ];
  return [];
}

/** CON-05: the name registry's slips, as the guards report them. */
export function nameGuard(g: GuardInput): GuardIssue[] {
  return nameSlips(g.chatId, g.text, { messageId: g.messageId }).map((s) => ({
    kind: "name" as const,
    severity: "minor" as const,
    claim: s.word,
    conflict: `Did you mean ${s.canonical}?`,
    citations: [{ ref: "N", type: s.entry.source === "lore" ? ("lore" as const) : s.entry.source === "card" || s.entry.source === "persona" ? ("card" as const) : ("memory" as const), label: `${s.entry.name} (${s.entry.source === "lore" ? "lorebook" : s.entry.source === "entity" ? "known to the story" : s.entry.source})` }],
    fix: `The name is spelled "${s.canonical}".`,
    by: "rules" as const,
  }));
}

/** The guard issues for one reply (CON-04, CON-05). */
export function guardIssues(chatId: string, text: string, o: { seq: number; messageId?: string; cfg?: GuardsConfig }): GuardIssue[] {
  const g = guardInput(chatId, text, o);
  return [...(g.cfg.puppet ? puppetGuard(g) : []), ...(g.cfg.pov ? povGuard(g) : []), ...(g.cfg.tense ? tenseGuard(g) : []), ...(g.cfg.names !== "off" ? nameGuard(g) : [])];
}

export interface GuardResult {
  text: string;
  meta: { trimmed?: string; fixed?: { from: string; to: string }[] };
  notes: string[];
  /** Ask for one more try (puppeting with the "regenerate" action). */
  retry: string | null;
}

/** Runs when a reply is saved: corrects names and cuts puppeting, when you chose those actions. */
export function applyGuards(chatId: string, text: string, o: { seq: number; messageId: string }): GuardResult {
  const cfg = guardsFor(chatId);
  const res: GuardResult = { text, meta: {}, notes: [], retry: null };
  if (cfg.names === "fix") {
    const f = fixNames(res.text, nameSlips(chatId, res.text, { messageId: o.messageId }));
    if (f.fixed.length) {
      res.text = f.text;
      res.meta.fixed = f.fixed;
      res.notes.push(`corrected ${f.fixed.map((x) => `${x.from} → ${x.to}`).join(", ")}`);
    }
  }
  if (cfg.puppet && cfg.puppetAction !== "flag") {
    const { n, userNames } = names(chatId);
    const exp = expected(chatId, o.seq, [n.char], userNames);
    const hits = scoped(puppetHits(res.text, userNames, { second: exp.address !== "third" }), puppetScope(chatId));
    if (hits.length) {
      const cut = cfg.puppetAction === "trim" ? trimPuppeting(res.text, hits) : null;
      if (cut) {
        res.text = cut.text;
        res.meta.trimmed = cut.cut.slice(0, 2000);
        res.notes.push(`trimmed where it wrote for ${n.user}`);
      } else if (cfg.puppetAction === "regenerate") {
        // (A cut that would lose most of the reply is left as a note instead.)
        res.retry = `Don't write ${n.user}'s words, actions or decisions. Stop where ${n.user} would respond.`;
      }
    }
  }
  return res;
}
