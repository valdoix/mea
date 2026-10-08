import { one } from "../db/db";
import { extraOf } from "../lore/activate";
import { scanEntriesFor } from "../lore/service";
import { chatNames } from "../memory/build";
import { core, norm, resolver } from "../memory/entities";
import { cleanText } from "../memory/text";
import { mustChat } from "../services/chats";
import { currentFold } from "../trackers/store";

/**
 * The name registry (CON-05): canonical spellings from the card, the persona, the entity graph,
 * the trackers and the lorebooks. Names in a reply that look like a typo of one of them are
 * flagged, and (optionally) corrected in the stored reply. The same list feeds @-mentions in the
 * composer (QOL-03) and the spell checker's dictionary (QOL-04).
 */

export interface NameEntry {
  name: string;
  kind: string;
  source: "card" | "persona" | "entity" | "tracker" | "lore";
  /** A short line for the mention popup: "person · keeper of the lighthouse". */
  hint?: string;
}

const looksProper = (s: string) => /^[A-Z][\p{L}'’-]*(?:\s+(?:of|the|de|van|von|al|el|du|da|[A-Z][\p{L}'’-]*)){0,3}$/u.test(s.trim());

export function nameRegistry(chatId: string): NameEntry[] {
  const chat = mustChat(chatId);
  const names = chatNames(chatId);
  const out = new Map<string, NameEntry>();
  const add = (name: string, e: Omit<NameEntry, "name">) => {
    const n = name.trim();
    const k = norm(n);
    if (!k || k.length < 2 || out.has(k)) return;
    out.set(k, { name: n, ...e });
  };
  add(names.char, { kind: "person", source: "card", hint: "the character" });
  add(names.user, { kind: "person", source: "persona", hint: "you" });
  try {
    const st = currentFold(chatId).result.state;
    for (const c of Object.values(st.chars)) for (const n of [c.name, ...c.aliases]) add(n, { kind: "person", source: "tracker", hint: c.isUser ? "you" : c.dead ? "dead" : undefined });
    for (const p of Object.values(st.places)) add(p.name, { kind: "place", source: "tracker" });
  } catch {
    // trackers are optional
  }
  for (const r of resolver(chatId).rows) {
    const hint = [r.kind, r.description.split(/(?<=[.!?])\s/)[0]?.slice(0, 80)].filter(Boolean).join(" · ");
    for (const n of [r.name, ...JSON.parse(r.aliases || "[]")]) add(String(n), { kind: r.kind, source: "entity", hint });
  }
  for (const e of scanEntriesFor({ characterId: chat.character_id, personaId: chat.persona_id, chatId })) {
    if (!e.enabled) continue;
    const x = extraOf(e);
    const kind = x.type ?? "lore";
    const hint = `${kind} · ${e.content.replace(/\s+/g, " ").slice(0, 70)}`;
    for (const n of [e.comment, ...e.keys, ...(x.aliases ?? [])]) if (n && looksProper(n)) add(n, { kind, source: "lore", hint });
  }
  return [...out.values()];
}

/** Words the registry vouches for: whole names and each word of a longer name. */
function knownWords(reg: NameEntry[]) {
  const known = new Set<string>();
  const tokens: { word: string; entry: NameEntry }[] = [];
  for (const e of reg) {
    known.add(norm(e.name));
    for (const w of norm(e.name).split(" ")) {
      known.add(w);
      if (w.length >= 4) tokens.push({ word: w, entry: e });
    }
    const c = core(e.name);
    if (c) known.add(c);
  }
  return { known, tokens };
}

/** Common capitalised words (sentence starts) that are one letter away from many names. */
const COMMON = new Set(
  "then than they them there their these those this that what when where which while with without would could should shall will have here hers more most much must just once only over very well were what whom whose your yours from into onto upon about after again also back been being both came come does done down each even ever every find give gone good have hold home just keep kind know last left like line look made make many mine near need next once open part past pull push rain read real rest ride rise road rock role rose said same seen self send sent side sign some soon sure take tell than that them then they thin this time told took town tree true turn upon used wait wake walk wall want warm wave ways wear went were west what when wide wife wild will wind wine wise wish word wore work yard year yeah yell your able ache aged also anna away bare bark bear beat bell belt bend best bird bite blue body bold bone book born boss bowl burn busy call calm cape card care cart case cast cave cold come cook cool cord core cost crew cure dare dark dart dawn dead deal dear debt deep deer desk dial dirt dock does door dose dove draw drew drop drum dull dusk dust duty earn ease east easy edge else even evil face fact fade fail fair fall fame fare farm fast fate fear feed feel feet fell felt file fill film find fine fire firm fish fist flag flat fled flew flow foam fold folk fond food fool foot form fort four free from fuel full fury gate gave gaze gear gift girl glad glow gold golf gone grab gray grew grey grim grin grip hair half hall halt hand hang hard harm hate head heal heap hear heat held hell help herb hero hide high hill hint hire hold hole holy hood hook hope horn host hour huge hung hunt hurt idea iron item jade jail jest join joke jump just kept kick kill king kiss knee knew knit knot lace lack lady laid lake lamb lamp land lane lash late lawn lead leaf lean leap less lied life lift lily limb lime link lion lips list live load loan lock long loom loop lord lose loss lost loud love luck lung lure maid mail main male mark mask mass mate maze meal mean meat meet melt mild mile milk mill mind mint miss mist moan mode mold monk mood moon moss moth move myth nail name navy neck nest news nice nine node none noon norm nose note numb oath odds once pace pack page paid pain pair pale palm park pass path peak pear peel peer pile pine pink pipe plan play plea plot plum poem poet pole pond pool poor pore port pose post pour pray prey pure quit race rage raid rail rang rank rare rate rear rely rent ribs rice rich ride ring riot ripe risk roam roar robe roof room root rope ruby rude ruin rule rush rust sack safe sage sail salt sand sang sank save scar seal seat seed seek seem sell shed ship shoe shop shot show shut sick sigh silk sing sink site size skin slip slow snow soak soap sock soft soil sold sole song sort soul soup sour span spin spot star stay stem step stir stop such suit swan swim tail tale talk tall tame tank tape task team tear tend tent term test text thaw tide tidy tile till tilt tiny tire toad toll tomb tone tool tore torn tour toys trap tray trim trip tuck tune twin type ugly unit vain vale vast veil vein verb vest view vine void vote wade wage wail waist wand ward wary wash weak weep weld wept whip wick wing wink wipe wire wolf womb wood wool worm worn wrap yawn zone today tonight tomorrow maybe never always sorry please thank thanks hello oh okay right still something nothing everything someone anyone everyone perhaps though although because before behind beneath beside between beyond inside outside under until where whether while within morning evening night afternoon".split(
    " ",
  ),
);

/** Edit distance with adjacent swaps counted as one typo (optimal string alignment). */
export function typoDistance(a: string, b: string) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)] as number[]);
  for (let j = 1; j <= b.length; j++) d[0]![j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) {
      d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i]![j] = Math.min(d[i]![j]!, d[i - 2]![j - 2]! + 1);
    }
  return d[a.length]![b.length]!;
}

/** True when the word already appears in another message of this chat (then it's someone, not a typo). */
function seenInChat(chatId: string, word: string, exceptMessageId?: string) {
  try {
    return Boolean(
      one(
        `SELECT 1 FROM swipes_fts f JOIN swipes s ON s.rowid = f.rowid JOIN messages m ON m.id = s.message_id
         WHERE swipes_fts MATCH ? AND m.chat_id = ? AND m.id != ? AND m.deleted_at IS NULL LIMIT 1`,
        `"${word.replaceAll('"', "")}"`,
        chatId,
        exceptMessageId ?? "",
      ),
    );
  } catch {
    return false;
  }
}

export interface NameSlip {
  word: string;
  canonical: string;
  entry: NameEntry;
  distance: number;
  /** Safe to correct automatically: one letter off and never used anywhere else in the chat. */
  fixable: boolean;
}

/** Names in a text that look like misspellings of names the story knows. */
export function nameSlips(chatId: string, text: string, opts: { messageId?: string; registry?: NameEntry[] } = {}): NameSlip[] {
  const reg = opts.registry ?? nameRegistry(chatId);
  const { known, tokens } = knownWords(reg);
  const words = new Set((cleanText(text).match(/\b[A-Z][a-z]{3,}\b/g) ?? []).filter((w) => !known.has(norm(w)) && !COMMON.has(w.toLowerCase())));
  const out: NameSlip[] = [];
  for (const w of words) {
    const lw = w.toLowerCase();
    let best: { t: (typeof tokens)[number]; d: number } | null = null;
    for (const t of tokens) {
      if (Math.abs(t.word.length - lw.length) > 2) continue;
      const max = t.word.length >= 8 ? 2 : 1;
      if (max === 2 && t.word[0] !== lw[0]) continue;
      const d = typoDistance(t.word, lw);
      if (d <= max && (!best || d < best.d)) best = { t, d };
    }
    if (!best) continue;
    if (seenInChat(chatId, w, opts.messageId)) continue;
    // The canonical spelling of that one word, keeping a longer name's own capitalisation.
    const canonical = best.t.entry.name.split(/\s+/).find((p) => norm(p) === best!.t.word) ?? best.t.entry.name;
    out.push({ word: w, canonical, entry: best.t.entry, distance: best.d, fixable: best.d === 1 });
  }
  return out;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Applies the fixable corrections to a reply. */
export function fixNames(text: string, slips: NameSlip[]) {
  let out = text;
  const fixed: { from: string; to: string }[] = [];
  for (const s of slips.filter((x) => x.fixable)) {
    const re = new RegExp(`\\b${esc(s.word)}\\b`, "g");
    if (!re.test(out)) continue;
    out = out.replace(re, s.canonical);
    fixed.push({ from: s.word, to: s.canonical });
  }
  return { text: out, fixed };
}
