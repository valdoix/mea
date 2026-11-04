/**
 * Worn phrases: the wording a long story has started repeating. A preset's list of tells can't know
 * the habits one chat grows on its own ("the raw ring on her right wrist", "the hollow below his
 * ear"), and the history keeps teaching them back. This reads the newest replies, finds the phrases
 * that keep coming back across them, and the turn frame names them so the next reply finds new words.
 */

const STOP = new Set(
  (
    "a an the and or but if so of to in on at by for with from into onto over under up down out off as is are was were be been being am " +
    "it its it's this that that's these those there here then than too very just not no nor yes " +
    "i me my mine you your yours he him his she her hers we us our they them their what who whom which when where why how " +
    "do does did done doing have has had having will would can could should may might must shall " +
    "one all any some each every both other more most much many own same such only also again still even ever " +
    "says said say saying goes went go get got gets like okay oh yeah about around through back now way thing things " +
    "two three four five six seven eight nine ten eleven twelve fifteen twenty thirty forty fifty hundred thousand first second minutes hours days years"
  ).split(" "),
);

const SIZES = [2, 3, 4, 5, 6, 7, 8, 9, 10];

export interface WornOptions {
  /** How many of the newest replies to read (default 12). */
  window?: number;
  /** A phrase must recur in at least this many of them (default 3)… */
  minReplies?: number;
  /** …and in at least this share of them (default 0.25). */
  minShare?: number;
  /** How many phrases to name (default 8). */
  max?: number;
  /** The player's recent messages: their own wording is never called worn. */
  player?: string[];
  /** Names in the story: a phrase that is only names and filler isn't a habit. */
  names?: string[];
}

/** The reply as plain prose: no visual tags, speaker marks or markdown emphasis. */
function prose(text: string): string {
  return text
    .replace(/<vtk\b[\s\S]*?<\/vtk>/gi, " ")
    .replace(/<\/?[a-z][^>]*>/gi, " ")
    .replace(/\[\/?spk[^\]]*\]/gi, " ")
    .replace(/[*_~]/g, "")
    .replace(/[’‘]/g, "'");
}

/** Clauses of lowercase words; a phrase never runs across a sentence, a dash or a line break. */
function clauses(text: string): string[][] {
  return prose(text)
    .toLowerCase()
    .split(/[.!?;:—–()\n"“”]+|\s-\s/)
    .map((c) => c.match(/[a-z0-9]+(?:'[a-z]+)?/g) ?? [])
    .filter((c) => c.length > 0);
}

/** Every run of two words in a phrase that isn't only filler, to tell when two phrases overlap. */
const pairs = (g: string) => {
  const w = g.split(" ");
  return w
    .slice(0, -1)
    .map((_, i) => [w[i]!, w[i + 1]!])
    .filter((p) => !p.every((x) => STOP.has(x)))
    .map((p) => p.join(" "));
};

/** Every run of three words in a phrase (the player's wording is matched on these). */
const triples = (g: string) => {
  const w = g.split(" ");
  return w.length < 3 ? [g] : w.slice(0, -2).map((_, i) => w.slice(i, i + 3).join(" "));
};

function grams(text: string): Set<string> {
  const out = new Set<string>();
  for (const c of clauses(text))
    for (const n of SIZES) for (let i = 0; i + n <= c.length; i++) out.add(c.slice(i, i + n).join(" "));
  return out;
}

/**
 * The phrases the newest replies keep reusing, most-repeated first, longest wording kept when two
 * overlap. Each has at least two words that carry meaning (not names, not filler); in a long story,
 * it shows in the thirty replies before those too.
 */
export function wornPhrases(replies: string[], opts: WornOptions = {}): string[] {
  const window = opts.window ?? 12;
  const recent = replies.slice(-window).filter((r) => r.trim());
  if (recent.length < 4) return [];
  const need = Math.max(opts.minReplies ?? 3, Math.ceil(recent.length * (opts.minShare ?? 0.25)));
  const names = new Set((opts.names ?? []).flatMap((n) => n.toLowerCase().match(/[a-z]+/g) ?? []));
  const playerText = ` ${(opts.player ?? []).map((p) => clauses(p).map((c) => c.join(" ")).join(" | ")).join(" | ")} `;
  const theirs = (g: string) => triples(g).some((t) => playerText.includes(` ${t} `));
  const counts = new Map<string, number>();
  for (const r of recent) for (const g of grams(r)) counts.set(g, (counts.get(g) ?? 0) + 1);
  // A long story: a habit also shows in the replies before these, where this scene's own things
  // (the shop they're in, what she's wearing today) don't.
  const before = replies.slice(-window - 30, -window).filter((r) => r.trim());
  const older = before.length >= 8 ? before.map((r) => ` ${clauses(r).map((c) => c.join(" ")).join(" | ")} `) : null;
  const lasting = (g: string) => !older || older.some((r) => r.includes(` ${g} `));
  const found = [...counts]
    .filter(([g, k]) => {
      if (k < need) return false;
      const w = g.split(" ");
      const meaning = w.map((x) => x.replace(/'s$/, "")).filter((x) => !STOP.has(x) && !names.has(x) && x.length > 1 && !/^\d+$/.test(x));
      if (meaning.length < 2) return false;
      return !theirs(g) && lasting(g);
    })
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length);
  // Windows of one long phrase overlap: the first (most repeated, longest) speaks for the rest.
  const chosen: string[] = [];
  const taken = new Set<string>();
  for (const [g] of found) {
    const t = pairs(g);
    if (t.some((x) => taken.has(x))) continue;
    for (const x of t) taken.add(x);
    chosen.push(g);
    if (chosen.length >= (opts.max ?? 8)) break;
  }
  return chosen;
}

/** A line restarted by repeating its first word ("that's — that's", "I — I"), in how many replies. */
export function stammerCount(replies: string[]): number {
  return replies.filter((r) => (prose(r).match(/\b([a-z]+(?:'[a-z]+)?) — \1\b/gi) ?? []).length >= 2).length;
}

/** The turn frame's line: the worn phrases quoted, plus the stammer when it has become a habit. */
export function wornLine(replies: string[], opts: WornOptions = {}): string {
  const recent = replies.slice(-(opts.window ?? 12));
  const parts = wornPhrases(replies, opts).map((p) => `"${p}"`);
  if (recent.length >= 4 && stammerCount(recent) >= Math.max(3, Math.ceil(recent.length / 3))) parts.push('a line restarted on its own first word ("that\'s — that\'s")');
  return parts.join(" · ");
}
