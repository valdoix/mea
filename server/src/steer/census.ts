import { cleanText } from "../memory/text";
import { TOOLKIT_TAGS } from "../prompt/mea";
import { detectFamily } from "../prompt/models";
import { craftStats } from "./craft";

/**
 * The tell census (docs/29 Part 2): which habits each model family leans on, measured over the
 * replies already written, so each adapter's notes name its own tells rather than guesses. Pure
 * text statistics, no model. It also measures drafting: how often a plan holds words the story
 * then uses, the thing every model is now told not to do.
 */

export interface CensusRow {
  chatId: string;
  modelId: string;
  /** The story as the model wrote it (never a take the player edited). */
  content: string;
  /** The plan or reasoning that came with it, if the route returned one. */
  reasoning: string;
}

/** A habit the census counts: a reply "has" it when the pattern turns up at least once. */
interface Counter {
  key: string;
  label: string;
  hit: (text: string, narration: string) => boolean;
}

const re = (r: RegExp) => (t: string) => r.test(t);

const QUOTE = /["“”]/;
const paragraphsOf = (t: string) => t.split(/\n\s*\n|\n/).map((x) => x.trim()).filter(Boolean);
/** Narration only: the paragraphs with no speech in them, so a dialogue tag ("she said.") never reads as a fragment. */
export const narrationOf = (t: string) => paragraphsOf(t).filter((p) => !QUOTE.test(p)).join("\n\n");

const VISUALS = new RegExp(`<(${TOOLKIT_TAGS.join("|")})\\b[^>]*>[\\s\\S]*?<\\/\\1>|<(?:${TOOLKIT_TAGS.join("|")})\\b[^>]*\\/>`, "gi");
/** The story as prose: visuals (texts, letters, screens) out, then markup and speaker marks. */
export const proseOf = (t: string) => cleanText(t.replace(VISUALS, "\n"));

const sentences = (t: string) => t.split(/(?<=[.!?…])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
const wordCount = (s: string) => s.split(/\s+/).filter(Boolean).length;

/** The reply ends on a short teaser line of narration ("Soon.", "Not yet."). */
function teaserEnd(t: string): boolean {
  const lastPara = paragraphsOf(t).at(-1) ?? "";
  if (QUOTE.test(lastPara)) return false;
  const last = sentences(lastPara).at(-1) ?? "";
  return Boolean(last) && wordCount(last) <= 3 && /[.!…]$/.test(last);
}

/** Three short one-line paragraphs of narration in a row. */
function cascade(t: string): boolean {
  let run = 0;
  for (const p of paragraphsOf(t)) {
    run = wordCount(p) <= 8 && !QUOTE.test(p) ? run + 1 : 0;
    if (run >= 3) return true;
  }
  return false;
}

/** The share of narration sentences that are fragments of one to three words. */
export function fragmentShare(narration: string): number {
  const all = sentences(narration).filter((s) => /\p{L}/u.test(s));
  return all.length ? all.filter((s) => wordCount(s) <= 3).length / all.length : 0;
}

/** Drumbeat narration: at least three fragments, and two sentences in five or more of them. */
function drumbeat(_t: string, narration: string): boolean {
  const all = sentences(narration).filter((s) => /\p{L}/u.test(s));
  return all.filter((s) => wordCount(s) <= 3).length >= 3 && fragmentShare(narration) >= 0.4;
}

export const COUNTERS: Counter[] = [
  { key: "office", label: "office words for people (noted, filed, ledger…)", hit: re(/\b(?:noted|filed(?: away)?|logged|catalogu?ed|tallied|recalibrat\w+|ledger|load-bearing|protocol|for the record|data point|notari[sz]ed)\b/i) },
  { key: "counting", label: "counts for detail (\"three seconds\", \"four knocks\")", hit: re(/\b(?:two|three|four|five|six|seven|eight|nine|ten)\s+(?:seconds|beats|breaths|heartbeats|knocks|steps|times|spoons|taps)\b/i) },
  { key: "restart", label: "restarts (\"I — I\", \"that's — that's\")", hit: re(/\b([\p{L}'’]+)\s*(?:—|–|--)\s*\1\b/iu) },
  { key: "correction", label: "correction framing (\"not X but Y\", \"Not X. Not Y.\")", hit: (t) => /\b(?:it|this|that) (?:was|is)n['’]t [^.!?\n]{1,40}?(?:[.;,—–]|--)\s*(?:it|this|that) (?:was|is)\b|\bnot (?:just |only )?\p{L}+(?: \p{L}+){0,3},? but\b/iu.test(t) || /(?:^|[.!?]\s+)Not [^.!?\n]{1,30}\.\s+Not\b/u.test(t) },
  { key: "broken", label: "a line broken off with a dash", hit: re(/[\p{L},]\s*(?:—|–|--)\s*["”]/u) },
  { key: "teaser", label: "a teaser ending (a closing line of three words or fewer)", hit: teaserEnd },
  { key: "bow", label: "a summing bow (\"a testament to\", \"a mix of\")", hit: re(/\ba (?:testament|mix|mixture|blend|cocktail) (?:to|of)\b/i) },
  { key: "air", label: "thick air, \"a beat\", \"something shifted\"", hit: re(/\b(?:a beat\b|a long moment|something shifted|the air (?:between them )?(?:thick|grew thick|thickened|crackled|hung|was heavy))/i) },
  { key: "lexicon", label: "textbook words (ozone, petrichor, sternum)", hit: re(/\b(?:ozone|petrichor|sternum|quadriceps)\b/i) },
  { key: "cutaway", label: "a cutaway (\"Somewhere, …\")", hit: re(/(?:^|\n)\s*(?:Somewhere|Elsewhere|Across (?:the )?town|Far away|Miles away)\b/i) },
  { key: "markdown", label: "markdown headings or bold", hit: re(/^#{1,6}\s|\*\*[^*\n]+\*\*/m) },
  { key: "cascade", label: "a cascade of one-line paragraphs", hit: cascade },
  { key: "drumbeat", label: "drumbeat narration (fragments are 40% or more of its sentences)", hit: drumbeat },
  { key: "therapy", label: "therapy-speak", hit: re(/\b(?:boundar(?:y|ies)|validat(?:e|ed|ion)|safe space|space for (?:you|this|that)|healing|trauma|processing (?:this|that|it))\b/i) },
  { key: "ack", label: "empty acknowledgements (\"Noted.\", \"Understood.\")", hit: re(/["“](?:Noted|Understood|Copy that|Fair|Fair enough|Acknowledged)[.!]/) },
];

const tokens = (t: string) => cleanText(t).toLowerCase().replace(/[^\p{L}\p{N}'’\s]/gu, " ").split(/\s+/).filter(Boolean);

function grams(words: string[], n: number): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i + n <= words.length; i++) out.add(words.slice(i, i + n).join(" "));
  return out;
}

/** Words of the story the plan already held: shared runs of eight words, as a share of the story's. */
export function draftOverlap(story: string, plan: string): { drafted: boolean; share: number } {
  if (!plan.trim()) return { drafted: false, share: 0 };
  const s = grams(tokens(story), 8);
  if (!s.size) return { drafted: false, share: 0 };
  const p = grams(tokens(plan), 8);
  let shared = 0;
  for (const g of s) if (p.has(g)) shared++;
  return { drafted: shared > 0, share: shared / s.size };
}

export interface FamilyCensus {
  family: string;
  replies: number;
  chats: number;
  models: { id: string; replies: number }[];
  words: number;
  /** Per 100 words. */
  filter: number;
  emdash: number;
  /** Median share of narration sentences that are one-to-three-word fragments. */
  fragments: number;
  /** Share of replies with at least one, by counter key (and "gesture" and "tell" from the craft coach). */
  rates: Record<string, number>;
  /** Replies that came with a plan, how long it ran, and how many drafted the story inside it. */
  plans: { with: number; words: number; drafted: number; overlap: number };
  /** Phrases this family keeps reaching for: share of its replies, seen in at least three chats. */
  phrases: { phrase: string; share: number; chats: number }[];
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) / 2)]!;
};
const round = (n: number, d = 3) => Math.round(n * 10 ** d) / 10 ** d;

/** The census of a set of replies, one entry per family, most replies first. */
export function census(rows: CensusRow[], opts: { phrases?: number } = {}): FamilyCensus[] {
  const byFamily = new Map<string, CensusRow[]>();
  for (const r of rows) {
    if (!r.content.trim()) continue;
    const f = detectFamily(r.modelId) || "other";
    byFamily.set(f, [...(byFamily.get(f) ?? []), r]);
  }
  const out: FamilyCensus[] = [];
  for (const [family, list] of byFamily) {
    const hits: Record<string, number> = Object.fromEntries([...COUNTERS.map((c) => [c.key, 0]), ["gesture", 0], ["tell", 0]]);
    const words: number[] = [];
    const frags: number[] = [];
    let filter = 0;
    let emdash = 0;
    const planWords: number[] = [];
    let drafted = 0;
    const overlaps: number[] = [];
    const gramReplies = new Map<string, number>();
    const gramChats = new Map<string, Set<string>>();
    const models = new Map<string, number>();
    for (const r of list) {
      models.set(r.modelId, (models.get(r.modelId) ?? 0) + 1);
      const text = proseOf(r.content);
      const narration = narrationOf(text);
      const st = craftStats(text);
      words.push(st.words);
      frags.push(fragmentShare(narration));
      filter += st.filter;
      emdash += st.emdash;
      if (st.gestures.length) hits.gesture!++;
      if (st.tells.length) hits.tell!++;
      for (const c of COUNTERS) if (c.hit(text, narration)) hits[c.key]!++;
      for (const g of st.grams) {
        gramReplies.set(g, (gramReplies.get(g) ?? 0) + 1);
        if (!gramChats.has(g)) gramChats.set(g, new Set());
        gramChats.get(g)!.add(r.chatId);
      }
      if (r.reasoning.trim()) {
        planWords.push(wordCount(r.reasoning));
        const d = draftOverlap(r.content, r.reasoning);
        if (d.drafted) drafted++;
        overlaps.push(d.share);
      }
    }
    const total = words.reduce((a, b) => a + b, 0);
    const phrases = [...gramReplies]
      .filter(([g, n]) => n >= 3 && (gramChats.get(g)?.size ?? 0) >= 3)
      .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
      .slice(0, opts.phrases ?? 12)
      .map(([phrase, n]) => ({ phrase, share: round(n / list.length), chats: gramChats.get(phrase)!.size }));
    out.push({
      family,
      replies: list.length,
      chats: new Set(list.map((r) => r.chatId)).size,
      models: [...models].map(([id, n]) => ({ id, replies: n })).sort((a, b) => b.replies - a.replies),
      words: Math.round(mean(words)),
      filter: round(total ? (filter / total) * 100 : 0, 2),
      emdash: round(total ? (emdash / total) * 100 : 0, 2),
      fragments: round(median(frags), 2),
      rates: Object.fromEntries(Object.entries(hits).map(([k, n]) => [k, round(n / list.length)])),
      plans: { with: planWords.length, words: Math.round(mean(planWords)), drafted, overlap: round(mean(overlaps)) },
      phrases,
    });
  }
  return out.sort((a, b) => b.replies - a.replies);
}

const LABELS: Record<string, string> = { ...Object.fromEntries(COUNTERS.map((c) => [c.key, c.label])), gesture: "stock body tells (breath catching, jaw…)", tell: "apophasis and litotes (\"didn't flinch\", \"not unkind\")" };
const pct = (n: number) => `${Math.round(n * 100)}%`;
const pct1 = (n: number) => `${Math.round(n * 1000) / 10}%`;

/** The census as a Markdown report: one table of rates across families, then each family's plans and phrases. */
export function censusReport(fams: FamilyCensus[], opts: { minReplies?: number; title?: string } = {}): string {
  const min = opts.minReplies ?? 20;
  const lines: string[] = [`# ${opts.title ?? "Tell census"}`, ""];
  if (!fams.length) return [...lines, "No replies to count."].join("\n");
  lines.push(`Share of replies with at least one hit. Families under ${min} replies are marked *few*: read their numbers loosely.`, "");
  lines.push(`| Habit | ${fams.map((f) => `${f.family}${f.replies < min ? " *few*" : ""}`).join(" | ")} |`);
  lines.push(`|---|${fams.map(() => "---:").join("|")}|`);
  lines.push(`| Replies (chats) | ${fams.map((f) => `${f.replies} (${f.chats})`).join(" | ")} |`);
  lines.push(`| Words per reply | ${fams.map((f) => f.words).join(" | ")} |`);
  lines.push(`| Filter words per 100 | ${fams.map((f) => f.filter).join(" | ")} |`);
  lines.push(`| Em-dashes per 100 | ${fams.map((f) => f.emdash).join(" | ")} |`);
  lines.push(`| Narration sentences that are fragments (median) | ${fams.map((f) => pct(f.fragments)).join(" | ")} |`);
  for (const key of Object.keys(LABELS)) lines.push(`| ${LABELS[key]} | ${fams.map((f) => pct(f.rates[key] ?? 0)).join(" | ")} |`);
  lines.push(`| Replies with a plan | ${fams.map((f) => pct(f.replies ? f.plans.with / f.replies : 0)).join(" | ")} |`);
  lines.push(`| Plan words | ${fams.map((f) => (f.plans.with ? f.plans.words : "—")).join(" | ")} |`);
  lines.push(`| Plans that drafted the story (8 words or more reused) | ${fams.map((f) => (f.plans.with ? pct(f.plans.drafted / f.plans.with) : "—")).join(" | ")} |`);
  lines.push(`| Story words already in the plan | ${fams.map((f) => (f.plans.with ? pct1(f.plans.overlap) : "—")).join(" | ")} |`);
  for (const f of fams) {
    lines.push("", `## ${f.family}`, "", `Models: ${f.models.map((m) => `\`${m.id}\` (${m.replies})`).join(", ")}`);
    if (f.phrases.length) {
      lines.push("", "Phrases it keeps reaching for (share of replies, chats):");
      for (const p of f.phrases) lines.push(`- "${p.phrase}" — ${pct(p.share)}, ${p.chats} chats`);
    }
  }
  return lines.join("\n");
}
