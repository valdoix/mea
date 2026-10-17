import { factsNowFor, type LoreFact } from "../lore/facts";
import { extraOf, type ScanEntry } from "../lore/activate";
import { scanEntriesFor } from "../lore/service";
import { colourOf, COLOUR_WORDS, heightCm, normalizeValue, numberOf, sideOf } from "../lore/slots";
import { mustChat } from "../services/chats";
import type { WorldState } from "../trackers/types";
import type { Issue } from "./checker";
import { esc, sentences } from "./rules";

/**
 * The detail sheet's checks (docs/15, 3.3 and 3.4). A reply that gives grey eyes brown, puts the
 * scar on the wrong hand, gets an age wrong, or has someone do what a "never" fact says they can't,
 * is flagged with the fact as its citation. "Accept and update" on a slot slip makes the reply's
 * version the fact (the old one kept in History), so the fix and the lore stay one action.
 */

type Found = Omit<Issue, "id">;

interface Subject {
  name: string;
  names: string[];
  entry: ScanEntry;
  facts: LoreFact[];
}

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, " ").replace(/\s+/g, " ").trim();
const COLOUR_RE = COLOUR_WORDS.map((w) => w.replace(/-/g, "[- ]?")).join("|");

/** The people and things in the scene (and whoever wrote the reply) that have an entry with facts. */
export function subjectsFor(chatId: string, st: WorldState | null, speaker: string): Subject[] {
  const chat = mustChat(chatId);
  const entries = scanEntriesFor({ characterId: chat.character_id, personaId: chat.persona_id, chatId }).filter((e) => e.enabled);
  if (!entries.length) return [];
  const here = [...Object.values(st?.chars ?? {}).filter((c) => !c.isUser && !c.dead && c.tier !== "off").map((c) => [c.name, ...c.aliases]), speaker ? [speaker] : []];
  const out: Subject[] = [];
  const picked: { entry: ScanEntry; names: string[] }[] = [];
  for (const e of entries) {
    const keys = new Set([...e.keys, ...(extraOf(e).aliases ?? []), extraOf(e).entity ?? "", e.comment].map(norm).filter((n) => n.length >= 2));
    const who = here.find((ns) => ns.some((n) => keys.has(norm(n))));
    if (who) picked.push({ entry: e, names: [...new Set([...who, ...e.keys.filter((k) => !k.startsWith("/")), e.comment].filter((n) => n && n.length >= 2))] });
  }
  if (!picked.length) return [];
  const facts = factsNowFor(picked.map((p) => p.entry.id), chatId);
  for (const p of picked) {
    const f = facts.get(p.entry.id) ?? [];
    if (f.length) out.push({ name: p.entry.comment || p.names[0]!, names: p.names, entry: p.entry, facts: f });
  }
  return out;
}

/** Sentences about this subject: naming them, or (for the one speaking) their own "my" / "her" / "his". */
function about(sents: string[], s: Subject, speaker: string, others: Subject[]) {
  const nameRe = new RegExp(`\\b(${s.names.map(esc).join("|")})\\b`, "i");
  const isSpeaker = s.names.some((n) => norm(n) === norm(speaker));
  return sents.filter((x) => nameRe.test(x) || (isSpeaker && /\b(my|her|his|their)\b/i.test(x) && !others.some((o) => o !== s && new RegExp(`\\b(${o.names.map(esc).join("|")})\\b`, "i").test(x))));
}

const cite = (s: Subject, f: LoreFact) => ({ ref: "L", type: "lore" as const, label: `${s.name}: ${f.slot ? `${f.slot} ` : ""}${f.value}`.slice(0, 120), id: s.entry.id, messageId: f.messageId, seq: f.sinceSeq });

/** 3.3: colours, sides, heights and ages in the reply against the slots of who's in the scene. */
export function slotRule(chatId: string, text: string, st: WorldState | null, speaker: string, found: Found[] = []): Found[] {
  const subjects = subjectsFor(chatId, st, speaker);
  if (!subjects.length) return [];
  const sents = sentences(text);
  const out: Found[] = [];
  for (const s of subjects) {
    const mine = about(sents, s, speaker, subjects);
    if (!mine.length) continue;
    const slot = (k: string) => s.facts.find((f) => f.slot === k);
    const flag = (f: LoreFact, claim: string, got: string, part: string) =>
      out.push({
        kind: "lore-slot",
        severity: "major",
        claim: claim.trim().slice(0, 240),
        conflict: `${s.name}'s ${part}: ${f.value} (in their lore).`,
        citations: [cite(s, f)],
        fix: `${s.name}'s ${part}: ${f.value}; don't write ${got}.`,
        canon: { memory: `${s.name}'s ${part}: ${got}.`, wrong: `${s.name}'s ${part}: ${f.value}`, fact: { id: f.id, value: got } },
        by: "rules",
      });
    // Eyes and hair: a colour word right before the part. Where the lore has the slot, it's the check
    // that counts (it cites the fact, and accepting updates it), so the trackers' trait note on the
    // same sentence gives way to it.
    for (const part of ["eyes", "hair"] as const) {
      const f = slot(part);
      const want = f && colourOf(f.value);
      if (!f || !want) continue;
      for (const x of mine) {
        const m = x.match(new RegExp(`\\b((?:(?:light|dark|pale|deep|bright)[- ])?(?:${COLOUR_RE})(?:[- ](?:${COLOUR_RE}))?)\\s+${part}\\b`, "i"));
        const got = m && colourOf(m[1]!);
        if (!m || !got) continue;
        const twin = found.findIndex((y) => y.kind === "trait" && y.claim.includes(x.trim().slice(0, 60)) && new RegExp(`\\b${part}\\b`, "i").test(y.claim));
        // The lore says this colour here (a change this chat made): the card's trait note is wrong, not the reply.
        if (twin >= 0) found.splice(twin, 1);
        if (got === want) continue;
        flag(f, x, m[1]!.toLowerCase(), part);
        break;
      }
    }
    // Scars and marks: the side ("the scar on her left hand"), when the reply names the same mark.
    for (const f of s.facts.filter((x) => x.slot === "scar" || x.slot === "scars")) {
      const side = sideOf(f.value);
      const mark = f.value.toLowerCase().match(/\b(scar|tattoo|birthmark|burn|brand|mark)\b/)?.[1];
      const where = f.value.toLowerCase().match(/\b(hand|arm|cheek|eye|shoulder|leg|knee|wrist|brow|temple|jaw|ear|palm|thigh|hip|foot)\b/)?.[1];
      if (!side || !mark || !where) continue;
      for (const x of mine) {
        const m = x.match(new RegExp(`\\b${mark}\\b[^.!?]{0,40}?\\b(left|right)\\s+${where}|\\b(left|right)\\s+${where}\\b[^.!?]{0,40}?\\b${mark}\\b`, "i"));
        const got = (m?.[1] ?? m?.[2])?.toLowerCase();
        if (!m || !got || got === side) continue;
        flag(f, x, `${got} ${where}`, mark);
        break;
      }
    }
    // Age: "a twenty-five-year-old", "she's 25", "25 years old".
    const age = slot("age");
    const wantAge = age && numberOf(age.value);
    if (age && wantAge)
      for (const x of mine) {
        const m = x.match(/\b(\d{1,3}|[a-z]+(?:-[a-z]+)?)[- ]years?[- ]old\b/i);
        const got = m && numberOf(m[1]!);
        if (!m || !got || got === wantAge) continue;
        flag(age, x, String(got), "age");
        break;
      }
    // Height: an exact height in the reply that isn't theirs (within 3 cm is the same).
    const h = slot("height");
    const wantH = h && heightCm(h.value);
    if (h && wantH)
      for (const x of mine) {
        const m = x.match(/\b(\d\s*(?:'|’|ft|foot|feet)\s*\d{0,2}\s*(?:"|”|in(?:ches)?)?|\d{2,3}\s*cm|\d[.,]\d{1,2}\s*m)\b/i);
        const got = m && heightCm(m[1]!);
        if (!m || !got || Math.abs(got - wantH) <= 3) continue;
        flag(h, x, m[1]!.trim(), "height");
        break;
      }
    // Handedness: "with her right hand" isn't a slip; "right-handed" / "her dominant right" is.
    const hand = slot("handedness");
    const wantHand = hand && normalizeValue("handedness", hand.value);
    if (hand && (wantHand === "left" || wantHand === "right"))
      for (const x of mine) {
        const m = x.match(/\b(left|right)[- ]handed\b|\bdominant (left|right)\b/i);
        const got = (m?.[1] ?? m?.[2])?.toLowerCase();
        if (!m || !got || got === wantHand) continue;
        flag(hand, x, `${got}-handed`, "handedness");
        break;
      }
  }
  return out;
}

// ---------- 3.4 "never" facts ----------

const IRREGULAR: Record<string, string[]> = {
  swim: ["swam", "swum"],
  meet: ["met"],
  eat: ["ate", "eaten"],
  drink: ["drank", "drunk"],
  ride: ["rode", "ridden"],
  fly: ["flew", "flown", "flies"],
  write: ["wrote", "written"],
  speak: ["spoke", "spoken"],
  drive: ["drove", "driven"],
  sing: ["sang", "sung"],
  run: ["ran"],
  see: ["saw", "seen"],
  go: ["went", "gone", "goes"],
  tell: ["told"],
  fight: ["fought"],
  cry: ["cried", "cries"],
  lie: ["lied", "lies", "lying"],
  read: [],
  kill: [],
  dance: [],
  cook: [],
  smoke: [],
  sleep: ["slept"],
  leave: ["left"],
  win: ["won"],
  lose: ["lost"],
  hit: [],
  shoot: ["shot"],
  steal: ["stole", "stolen"],
  forget: ["forgot", "forgotten"],
  laugh: [],
  kiss: ["kisses"],
  touch: ["touches"],
  wear: ["wore", "worn"],
  climb: [],
  whistle: [],
  curse: [],
  swear: ["swore", "sworn"],
};

/** Every form of a verb a reply might use: swim → swim, swims, swam, swum, swimming. */
export function verbForms(base: string): string[] {
  const b = base.toLowerCase();
  const forms = new Set([b, ...(IRREGULAR[b] ?? [])]);
  forms.add(/(s|sh|ch|x|z|o)$/.test(b) ? `${b}es` : /[^aeiou]y$/.test(b) ? `${b.slice(0, -1)}ies` : `${b}s`);
  const ing = /ie$/.test(b) ? `${b.slice(0, -2)}ying` : /[^aeiou]e$/.test(b) ? `${b.slice(0, -1)}ing` : /^[^aeiou]*[aeiou][bdgmnprt]$/.test(b) ? `${b}${b.at(-1)}ing` : `${b}ing`;
  forms.add(ing);
  if (!IRREGULAR[b]?.length) forms.add(/e$/.test(b) ? `${b}d` : /[^aeiou]y$/.test(b) ? `${b.slice(0, -1)}ied` : /^[^aeiou]*[aeiou][bdgmnprt]$/.test(b) ? `${b}${b.at(-1)}ed` : `${b}ed`);
  return [...forms];
}

/** What a "never" fact rules out, as a verb and what follows it ("has never met Arya" → meet, Arya). */
export function neverPattern(value: string): { verb: string; object: string | null } | null {
  const v = value.trim().replace(/[.!]+$/, "");
  const m =
    v.match(/\b(?:can't|cannot|can not|couldn't|doesn't|does not|won't|will not|never|has never|have never|hasn't ever|is unable to|unable to)\s+(?:ever\s+)?(?:been\s+)?(\w+)(?:\s+(.*))?$/i) ?? v.match(/^(?:no|not)\s+(\w+)(?:\s+(.*))?$/i);
  if (!m) return null;
  let verb = m[1]!.toLowerCase();
  // "has never met" → meet; "never swam" → swim.
  for (const [base, forms] of Object.entries(IRREGULAR)) if (forms.includes(verb)) verb = base;
  if (verb.endsWith("ed") && verb.length > 4 && !IRREGULAR[verb]) verb = verb.replace(/ied$/, "y").replace(/ed$/, "");
  const object = m[2]?.trim().split(/\s+/).slice(0, 3).join(" ") || null;
  return { verb, object: object && /^(a|an|the|any|anyone|anything)$/i.test(object) ? null : object };
}

/** 3.4: a reply where someone does what a "never" fact says they can't. */
export function neverRule(chatId: string, text: string, st: WorldState | null, speaker: string): Found[] {
  const subjects = subjectsFor(chatId, st, speaker).filter((s) => s.facts.some((f) => f.kind === "never"));
  if (!subjects.length) return [];
  const sents = sentences(text);
  const out: Found[] = [];
  for (const s of subjects) {
    const mine = about(sents, s, speaker, subjects);
    for (const f of s.facts.filter((x) => x.kind === "never")) {
      const p = neverPattern(f.value);
      if (!p) continue;
      const verbs = verbForms(p.verb).map(esc).join("|");
      const obj = p.object ? `[^.!?]{0,30}?\\b${esc(p.object.split(/\s+/)[0]!)}\\b` : "";
      const re = new RegExp(`\\b(${verbs})\\b${obj}`, "i");
      // Saying it again ("she can't swim", "never met") isn't breaking it.
      const negated = new RegExp(`\\b(?:can't|cannot|couldn't|doesn't|didn't|won't|never|not|no)\\s+(?:\\w+\\s+){0,2}(?:${verbs})\\b`, "i");
      const hit = mine.find((x) => re.test(x) && !negated.test(x));
      if (!hit) continue;
      out.push({
        kind: "lore-never",
        severity: "major",
        claim: hit.trim().slice(0, 240),
        conflict: `In ${s.name}'s lore: ${f.value}.`,
        citations: [cite(s, f)],
        fix: `${s.name}: ${f.value}. Don't write them doing it.`,
        by: "rules",
      });
    }
  }
  return out;
}
