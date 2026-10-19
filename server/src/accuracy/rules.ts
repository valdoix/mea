import { all, parseJson } from "../db/db";
import { scanEntriesFor } from "../lore/service";
import type { AtomRow } from "../memory/atoms";
import { norm, resolver } from "../memory/entities";
import { cleanText, contentWords } from "../memory/text";
import { mustChat } from "../services/chats";
import { secretRevealer } from "../lore/secretlinks";
import type { WorldState } from "../trackers/types";
import type { Issue } from "./checker";
import { nameSlips } from "./names";

/**
 * The continuity checker's cheap rules (CON-02, CON-06), one function per slip in the registry
 * (slips.ts): eye and hair colour against the trackers and the card, dead people acting, the time
 * of day against the story clock, names that look like typos of known ones, and secrets showing up
 * in the lines of someone who doesn't know them.
 */

type Found = Omit<Issue, "id">;

const COLORS = "blue|green|brown|hazel|grey|gray|amber|violet|black|golden|gold|silver|red|dark|light|pale|blonde?|auburn|ginger|white|chestnut|copper|pink|purple|emerald|sapphire|ice-blue|steel-grey";
const colorRe = new RegExp(`\\b((?:(?:light|dark|pale|deep|bright)[- ])?(?:${COLORS}))(?:[- ](?:${COLORS}))?\\b`, "i");
export const sentences = (t: string) => t.split(/(?<=[.!?…]["”')\]*]*)\s+|\n+/).filter((s) => s.trim());
export const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function colorOf(text: string) {
  return text.match(colorRe)?.[1]?.toLowerCase().replace(/gray/g, "grey").replace(/gold$/, "golden").replace(/blond$/, "blonde") ?? null;
}

/** Messages per seq, for citations. */
export function seqMessage(chatId: string) {
  const m = new Map<number, string>();
  for (const r of all<{ id: string; seq: number }>("SELECT id, seq FROM messages WHERE chat_id = ? AND deleted_at IS NULL", chatId)) m.set(r.seq, r.id);
  return m;
}

export interface RuleInput {
  chatId: string;
  text: string;
  st: WorldState | null;
  speaker: string;
  messageId?: string;
  /** Lazily shared between the rules of one check. */
  reply: string;
  sents: string[];
  msg: Map<number, string>;
}

export function ruleInput(chatId: string, text: string, st: WorldState | null, o: { speaker: string; messageId?: string }): RuleInput {
  const reply = cleanText(text);
  return { chatId, text, st, speaker: o.speaker, messageId: o.messageId, reply, sents: sentences(reply), msg: seqMessage(chatId) };
}

const npcs = (st: WorldState) => Object.values(st.chars).filter((c) => !c.isUser);
const namesOf = (c: { name: string; aliases: string[] }) => [c.name, ...c.aliases].filter((n) => n.length >= 2);

const SHE = /\b(she|her|hers|herself)\b/gi;
const HE = /\b(he|him|his|himself)\b/gi;
const count = (s: string, re: RegExp) => s.match(re)?.length ?? 0;

/** "f", "m" or null: the pronouns the reply uses in sentences about this person and no one else. */
export function genderIn(sents: string[], nameRe: RegExp, others: RegExp[]): "f" | "m" | null {
  let f = 0;
  let m = 0;
  for (const s of sents) {
    if (!nameRe.test(s) || others.some((o) => o.test(s))) continue;
    f += count(s, SHE);
    m += count(s, HE);
  }
  if (f >= 2 && f >= m * 2) return "f";
  if (m >= 2 && m >= f * 2) return "m";
  return null;
}

export interface Whose {
  nameRe: RegExp;
  /** Everyone else the story knows. */
  others: RegExp[];
  gender: "f" | "m" | null;
  isSpeaker: boolean;
}

/**
 * Whether the colour phrase at `at` describes this person ("her eyes have gone to his face… blue
 * eyes and a crooked grin" is his, not hers): a name's possessive right before it, else a
 * possessive pronoun, else the nearest person named or pointed to before it in the sentence. When
 * it can't be told (both "his" and "her" before it, and no idea which this person is), it isn't.
 */
export function describes(s: string, at: number, who: Whose): boolean {
  const pre = s.slice(0, at);
  const poss = pre.match(/\b([A-Z][\w’'-]*(?:\s+[A-Z][\w’'-]*)?)['’]s\s+(?:[\w-]+,?\s+){0,2}$/);
  if (poss) return who.nameRe.test(poss[1]!);
  const pron = pre.match(/\b(my|her|his|their|your|its)\s+(?:[\w-]+,?\s+){0,2}$/i)?.[1]?.toLowerCase();
  const refs: { at: number; name?: string; pron?: string }[] = [];
  for (const m of pre.matchAll(/\b(she|her|hers|he|him|his|my|me|i|they|them|their|your|you)\b/gi)) refs.push({ at: m.index!, pron: m[1]!.toLowerCase() });
  for (const re of [who.nameRe, ...who.others]) for (const m of pre.matchAll(new RegExp(re.source, "gi"))) refs.push({ at: m.index!, name: m[0] });
  refs.sort((a, b) => a.at - b.at);
  const near = pron ? { pron, name: undefined } : refs.at(-1);
  // Nothing before it ("Blue eyes meet hers"): theirs if the sentence names them and no one else.
  if (!near) return who.nameRe.test(s) && !who.others.some((o) => o.test(s));
  if (near.name) return who.nameRe.test(near.name);
  const p = near.pron!;
  if (p === "my" || p === "me" || p === "i") return who.isSpeaker;
  if (!/^(she|her|hers|he|him|his)$/.test(p)) return false;
  if (who.gender) return who.gender === (/^(she|her|hers)$/.test(p) ? "f" : "m");
  if (count(pre, SHE) && count(pre, HE)) return false;
  const lastName = refs.filter((x) => x.name).at(-1)?.name;
  return lastName ? who.nameRe.test(lastName) : who.isSpeaker || who.nameRe.test(s);
}

/** Eye and hair colour (TRK-17 traits, card traits included). */
export function traitRule(r: RuleInput): Found[] {
  const out: Found[] = [];
  const { st, sents, msg, speaker } = r;
  if (!st) return out;
  const nameReOf = (x: { name: string; aliases: string[] }) => new RegExp(`\\b(${namesOf(x).map(esc).join("|")})\\b`, "i");
  for (const c of npcs(st)) {
    const nameRe = nameReOf(c);
    const others = Object.values(st.chars).filter((x) => x !== c && namesOf(x).length).map(nameReOf);
    const who = { nameRe, others, gender: genderIn(sents, nameRe, others), isSpeaker: norm(c.name) === norm(speaker) };
    for (const part of ["eyes", "hair"] as const) {
      const trait = c.traits.find((t) => (part === "eyes" ? t.kind === "eyes" : t.kind === "hair"));
      if (!trait) continue;
      const want = colorOf(trait.text);
      if (!want) continue;
      const phrase = new RegExp(`\\b((?:(?:light|dark|pale|deep|bright)[- ])?(?:${COLORS}))(?:[- ](?:${COLORS}))?\\s+${part}\\b`, "gi");
      for (const s of sents) {
        const m = [...s.matchAll(phrase)].find((x) => describes(s, x.index!, who));
        if (!m) continue;
        const got = colorOf(m[0]);
        if (!got || got === want || want.includes(got) || got.includes(want)) continue;
        out.push({
          kind: "trait",
          severity: "major",
          claim: s.trim().slice(0, 240),
          conflict: `${c.name} has ${trait.text}${trait.by === "card" ? " (from the character card)" : trait.by === "user" ? " (you set this)" : ""}.`,
          citations: [{ ref: "T", type: trait.by === "card" ? "card" : "tracker", label: `${c.name}: ${trait.text}`, messageId: msg.get(trait.seq) ?? null, seq: trait.seq }],
          fix: `${c.name}'s ${part} are ${want} (${trait.text}); don't describe them as ${got}.`,
          canon: { memory: `${c.name} has ${m[0].toLowerCase().replace(/\s+/g, " ")}.`, wrong: `${c.name} has ${trait.text}`, trackerLine: `trait ${c.name}: ${got} ${part}` },
          by: "rules",
        });
        break;
      }
    }
  }
  return out;
}

/** The dead don't speak or act. */
export function deadRule(r: RuleInput): Found[] {
  const out: Found[] = [];
  const { st, sents, msg } = r;
  if (!st) return out;
  for (const c of npcs(st)) {
    if (!c.dead) continue;
    const names = namesOf(c);
    const act = new RegExp(`\\b(${names.map(esc).join("|")})\\b\\s+(says|said|smiles?|smiled|laughs?|laughed|walks?|walked|nods?|nodded|grins?|grinned|whispers?|whispered|replies|replied|asks?|asked|looks?|looked|steps?|stepped|reaches|reached|takes?|took)\\b`, "i");
    const hit = sents.find((s) => act.test(s));
    if (hit)
      out.push({
        kind: "dead",
        severity: "major",
        claim: hit.trim().slice(0, 240),
        conflict: `${c.name} is dead in this story.`,
        citations: [{ ref: "T", type: "tracker", label: `${c.name} died`, seq: c.lastSeq, messageId: msg.get(c.lastSeq) ?? null }],
        fix: `${c.name} is dead and can't appear acting or speaking (only in memories, dreams or as a body).`,
        by: "rules",
      });
  }
  return out;
}

/** Time of day against the story clock (a reply that jumps ahead is fine). */
export function timeRule(r: RuleInput): Found[] {
  const out: Found[] = [];
  const { st, sents, reply } = r;
  if (!st?.time) return out;
  const hour = Math.floor((((st.time.minutes % 1440) + 1440) % 1440) / 60);
  const jumps = /\b(later|hours? (?:pass|passed|later)|next (?:morning|day|evening)|the following|by (?:dawn|morning|nightfall|evening)|at dawn|overnight|as the sun (?:rose|set)|wakes?|woke)\b/i.test(reply);
  const night = hour >= 22 || hour < 5;
  const day = hour >= 9 && hour < 16;
  const saysMorning = sents.find((s) => /\b(good morning|morning sun|morning light|the sun (?:is )?rising|sunrise|breakfast)\b/i.test(s));
  const saysNight = sents.find((s) => /\b(good night|moonlight|moonlit|the night sky|starlight|stars (?:are )?out|midnight)\b/i.test(s));
  const clock = `${String(hour).padStart(2, "0")}:${String(st.time.minutes % 60).padStart(2, "0")}`;
  if (!jumps && night && saysMorning)
    out.push({ kind: "time", severity: "minor", claim: saysMorning.trim().slice(0, 240), conflict: `The story clock says it's night (${clock}).`, citations: [{ ref: "T", type: "tracker", label: `story time ${clock}` }], fix: `It's night (${clock}), not morning.`, by: "rules" });
  if (!jumps && day && saysNight)
    out.push({ kind: "time", severity: "minor", claim: saysNight.trim().slice(0, 240), conflict: `The story clock says it's daytime (${clock}).`, citations: [{ ref: "T", type: "tracker", label: `story time ${clock}` }], fix: `It's daytime (${clock}), not night.`, by: "rules" });
  return out;
}

/** Names that look like typos of names the story knows ("Mria" for "Mira"): the name registry (CON-05). */
export function nameRule(r: RuleInput): Found[] {
  const out: Found[] = [];
  for (const slip of nameSlips(r.chatId, r.text, { messageId: r.messageId })) {
    const ent = slip.entry.source === "entity" ? resolver(r.chatId).find(slip.entry.name) : undefined;
    const where = slip.entry.source === "lore" ? "lorebook" : slip.entry.source === "card" ? "the character card" : slip.entry.source === "persona" ? "your persona" : "known to the story";
    out.push({
      kind: "name",
      severity: "minor",
      claim: slip.word,
      conflict: `Did you mean ${slip.canonical}?`,
      citations: [{ ref: "E", type: slip.entry.source === "lore" ? "lore" : slip.entry.source === "card" || slip.entry.source === "persona" ? "card" : "memory", label: `${slip.entry.name} (${where})`, ...(ent ? { id: ent.id } : {}) }],
      fix: `The name is spelled "${slip.canonical}".`,
      by: "rules",
    });
  }
  return out;
}

/** Knowledge leaks (CON-06): a secret's words in a sentence that belongs to someone who doesn't know it. */
export function leakRule(r: RuleInput): Found[] {
  const out: Found[] = [];
  const { chatId, st, sents, msg, speaker } = r;
  if (!st) return out;
  const known = resolver(chatId).rows.filter((e) => e.kind === "person");
  const knownNames = new Set(known.flatMap((e) => [e.name, ...parseJson<string[]>(e.aliases, [])]).map(norm));
  for (const f of Object.values(st.facts)) {
    if (!f.secret && !Object.values(f.stances).some((s) => s.status === "unaware")) continue;
    const knowers = new Set([...(f.secret?.keepers ?? []), ...Object.entries(f.stances).filter(([, s]) => s.status !== "unaware" && s.status !== "wrong").map(([id]) => id), ...f.revealed.flatMap((x) => x.to)]);
    const secretWords = [...contentWords(f.statement, 4)].filter((w) => !knownNames.has(w));
    if (secretWords.length < 2) continue;
    for (const c of Object.values(st.chars)) {
      if (c.isUser || knowers.has(c.id) || c.dead) continue;
      const nameRe = new RegExp(`\\b(${[c.name, ...c.aliases].map(esc).join("|")})\\b`, "i");
      const isSpeaker = norm(c.name) === norm(speaker);
      for (const s of sents) {
        // The speaker's own dialogue, or a sentence about this person saying or thinking something.
        const theirs = (isSpeaker && /["“]/.test(s)) || (nameRe.test(s) && /\b(says?|said|knows?|knew|tells?|told|whispers?|asks?|mentions?|thinks?|realizes?|remembers?)\b/i.test(s));
        if (!theirs) continue;
        const sw = contentWords(s, 4);
        const hits = secretWords.filter((w) => sw.has(w));
        if (hits.length >= 2 && hits.length >= Math.ceil(secretWords.length * 0.4)) {
          out.push({
            kind: "leak",
            severity: "major",
            claim: s.trim().slice(0, 240),
            conflict: `${c.name} doesn't know this: "${f.statement}"${f.secret ? ` (kept by ${f.secret.keepers.map((k) => st.chars[k]?.name ?? k).join(", ")})` : ""}.`,
            citations: [{ ref: "T", type: "tracker", label: `secret: ${f.statement}`, seq: f.firstSeq, messageId: msg.get(f.firstSeq) ?? null }],
            fix: `${c.name} doesn't know that ${f.statement.replace(/\.$/, "")}; they must not reference it.`,
            canon: { memory: `${c.name} learned that ${f.statement.replace(/\.$/, "")}.`, trackerLine: `know ${c.name}: ${f.statement} | from the story · knows` },
            by: "rules",
          });
          break;
        }
      }
    }
  }
  // Lorebook secrets with a known-by list (LORE-09).
  const chat = mustChat(chatId);
  const entries = scanEntriesFor({ characterId: chat.character_id, personaId: chat.persona_id, chatId });
  const revealed = secretRevealer(chatId, st, entries);
  for (const e of entries) {
    for (const [i, sec] of (((e.extra ?? {}) as { secrets?: { text: string; knownBy: string[] }[] }).secrets ?? []).entries()) {
      // The story let it out since the entry was written: whoever found out (or everyone, once it's out) knows.
      const r = revealed(e.id, i);
      const kb = new Set([...(sec.knownBy ?? []), ...(r?.keepers ?? []), ...(r?.to ?? [])].map(norm));
      if (!sec.text?.trim() || kb.has(norm(speaker)) || kb.has("everyone") || r?.out) continue;
      const secretWords = [...contentWords(sec.text, 4)].filter((w) => !knownNames.has(w));
      if (secretWords.length < 2) continue;
      const hit = sents.find((s) => /["“]/.test(s) && secretWords.filter((w) => contentWords(s, 4).has(w)).length >= Math.max(2, Math.ceil(secretWords.length * 0.5)));
      if (hit && !out.some((i) => i.kind === "leak" && i.claim === hit.trim().slice(0, 240)))
        out.push({
          kind: "leak",
          severity: "major",
          claim: hit.trim().slice(0, 240),
          conflict: `${speaker} doesn't know this lore secret${sec.knownBy?.length ? ` (only ${sec.knownBy.join(", ")} do)` : ""}: "${sec.text}"`,
          citations: [{ ref: "L", type: "lore", label: `${e.comment || e.keys[0] || "lore"}: secret`, id: e.id }],
          fix: `${speaker} doesn't know: ${sec.text}`,
          by: "rules",
        });
    }
  }
  // Secret memories with a known-by list (narrator mode: each NPC only knows their own).
  for (const a of all<AtomRow>("SELECT * FROM memories WHERE chat_id = ? AND type = 'secret' AND deleted_at IS NULL AND status = 'active' AND known_by != '[]'", chatId)) {
    const kb = new Set(parseJson<string[]>(a.known_by, []).map(norm));
    const secretWords = [...contentWords(a.content, 4)].filter((w) => !knownNames.has(w));
    if (secretWords.length < 2 || kb.has(norm(speaker))) continue;
    if (kb.has("everyone")) continue;
    const hit = sents.find((s) => /["“]/.test(s) && secretWords.filter((w) => contentWords(s, 4).has(w)).length >= Math.max(2, Math.ceil(secretWords.length * 0.5)));
    if (hit && !out.some((i) => i.kind === "leak" && i.claim === hit.trim().slice(0, 240)))
      out.push({
        kind: "leak",
        severity: "major",
        claim: hit.trim().slice(0, 240),
        conflict: `${speaker} doesn't know this secret (only ${[...parseJson<string[]>(a.known_by, [])].join(", ")} do): "${a.content}"`,
        citations: [{ ref: "M", type: "memory", label: a.content, id: a.id, seq: a.max_seq, messageId: a.max_seq != null ? (msg.get(a.max_seq) ?? null) : null }],
        fix: `${speaker} doesn't know: ${a.content}`,
        by: "rules",
      });
  }
  return out;
}
