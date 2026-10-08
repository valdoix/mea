import { countTokens } from "../lib/tokens";
import { STOCK_NAMES, STOCK_PHRASES, type QualityIssue } from "../lore/quality";

/**
 * Card checks (CHAR-13), instant and deterministic: the greeting never acts or feels for {{user}},
 * point of view holds, example dialogue has the shape models learn from, nothing is missing or
 * bloated, and stock names and filler phrases are flagged. The model-side review is the bible check.
 */

export type CardIssue = Omit<QualityIssue, "kind"> & { kind: string };

const USER_VERBS =
  "nods|smiles|says|said|replies|replied|asks|asked|feels|felt|thinks|thought|decides|decided|walks|walked|looks|looked|sighs|sighed|laughs|laughed|shrugs|grins|blushes|turns|steps|takes|took|reaches|reached|leans|watches|notices|realizes|realises|wonders|wants|agrees|answers|whispers|gasps|frowns|swallows|hesitates";
const PUPPET_USER = new RegExp(`\\{\\{user\\}\\}(?:'s\\s+\\w+)?\\s+(?:\\w+ly\\s+)?(?:${USER_VERBS})\\b`, "i");
const PUPPET_YOU = /(?:^|[.!?]\s+|,\s+|\band\s+)you\s+(?:\w+ly\s+)?(?:feel|felt|decide|decided|think|thought|nod|nodded|smile|smiled|say|said|sigh|sighed|laugh|laughed|blush|blushed|realize|realized|realise|realised|wonder|wondered|agree|agreed|answer|answered|shrug|shrugged|can't help|cannot help)\b/i;

/** Narration only: text outside quotes. */
const narration = (t: string) => t.replace(/"[^"]*"|“[^”]*”/g, " ");

export function checkGreeting(text: string, pov: "first" | "second" | "third"): CardIssue[] {
  const out: CardIssue[] = [];
  if (!text.trim()) return out;
  const n = narration(text);
  if (PUPPET_USER.test(n) || PUPPET_YOU.test(n)) out.push({ kind: "puppets-user", severity: "warn", message: "It writes {{user}}'s actions, words or feelings. A greeting should leave every choice to the player." });
  const words = text.split(/\s+/).filter(Boolean).length;
  if (words < 60) out.push({ kind: "short", severity: "info", message: `Only ${words} words; a greeting this short gives the model little voice to copy.` });
  if (words > 520) out.push({ kind: "long", severity: "info", message: `${words} words; long greetings push replies to be long too.` });
  const firstPerson = (n.match(/\b(I|I'm|I've|I'd|[Mm]y|[Mm]e)\b/g) ?? []).length;
  if (pov === "third" && firstPerson >= 3) out.push({ kind: "pov", severity: "warn", message: "The narration slips into first person in a third-person greeting." });
  if (pov === "first" && firstPerson < 2 && words > 60) out.push({ kind: "pov", severity: "info", message: "Little first-person narration in a first-person greeting." });
  if (!/\?|\.\.\.|…|—\s*$|"\s*$/.test(text.trim().slice(-160))) out.push({ kind: "no-hook", severity: "info", message: "It doesn't end on an opening for {{user}}: a question, a gesture, something left hanging." });
  return out;
}

export function checkExamples(text: string): CardIssue[] {
  if (!text.trim()) return [];
  const out: CardIssue[] = [];
  if (!/<START>/i.test(text)) out.push({ kind: "format", severity: "warn", message: "Example dialogue should be split into <START> blocks." });
  if (!/\{\{char\}\}:/.test(text)) out.push({ kind: "format", severity: "warn", message: "No {{char}}: lines, so the model can't tell who is speaking." });
  if (PUPPET_USER.test(narration(text.replace(/^\{\{user\}\}:.*$/gm, "")))) out.push({ kind: "puppets-user", severity: "info", message: "{{char}}'s lines describe {{user}}'s actions." });
  return out;
}

export function checkProse(text: string, opts: { maxTokens?: number; minTokens?: number } = {}): CardIssue[] {
  const out: CardIssue[] = [];
  if (!text.trim()) return [{ kind: "empty", severity: "warn", message: "Empty." }];
  const names = [...new Set([...text.matchAll(new RegExp(`\\b(${STOCK_NAMES.join("|")})\\b`, "g"))].map((m) => m[1]!))];
  if (names.length) out.push({ kind: "stock-name", severity: "info", message: `${names.join(", ")}: names models use a lot. Keep them if you chose them.` });
  const lower = text.toLowerCase();
  const phrases = STOCK_PHRASES.filter((p) => lower.includes(p));
  if (phrases.length) out.push({ kind: "stock-phrase", severity: "info", message: `Stock phrasing: ${phrases.slice(0, 4).map((p) => `"${p}"`).join(", ")}.` });
  const tokens = countTokens(text);
  if (opts.maxTokens && tokens > opts.maxTokens) out.push({ kind: "long", severity: "info", message: `${tokens} tokens (aim for under ${opts.maxTokens}); every turn pays for permanent fields.` });
  if (opts.minTokens && tokens < opts.minTokens) out.push({ kind: "thin", severity: "info", message: `Only ${tokens} tokens; there's little here for the model to hold on to.` });
  return out;
}
