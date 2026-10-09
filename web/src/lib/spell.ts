/**
 * QOL-04: local English spell and grammar check (Harper, in WebAssembly). Nothing leaves the
 * device. The binary is large, so it loads only once you switch the check on, and the names from
 * the story (CON-05's registry) go into its dictionary so "Mira" is never a typo.
 */

export interface SpellIssue {
  start: number;
  end: number;
  text: string;
  message: string;
  kind: string;
  suggestions: string[];
}

type Linter = import("harper.js").LocalLinter;
let linter: Promise<Linter> | null = null;
const imported = new Set<string>();

async function load(): Promise<Linter> {
  const [{ LocalLinter, Dialect }, { slimBinary: binary }] = await Promise.all([import("harper.js"), import("harper.js/slimBinary")]);
  const l = new LocalLinter({ binary, dialect: Dialect.American });
  await l.setup();
  return l;
}

export function spellReady() {
  linter ??= load().catch((e) => {
    linter = null;
    throw e;
  });
  return linter;
}

/** Words the checker should accept: names, and each word of a longer name. */
export async function addNames(names: string[]) {
  const l = await spellReady();
  const words = [...new Set(names.flatMap((n) => [n, ...n.split(/\s+/)]).map((w) => w.trim()).filter((w) => w.length > 1 && !imported.has(w)))];
  if (!words.length) return;
  for (const w of words) imported.add(w);
  await l.importWords(words);
}

/** Harper counts in code points; the textarea counts in UTF-16 units. */
function toUnits(text: string, cp: number) {
  let units = 0;
  let i = 0;
  for (const ch of text) {
    if (i++ >= cp) break;
    units += ch.length;
  }
  return units;
}

// Roleplay text is full of things that aren't mistakes: *actions*, (OOC asides), {{macros}}.
const MASK = String.raw`\{\{[^}]*\}\}|\(OOC:[^)]*\)|https?://\S+`;

export async function check(text: string): Promise<SpellIssue[]> {
  if (!text.trim()) return [];
  const l = await spellReady();
  const lints = await l.lint(text, { language: "plaintext", regex_mask: MASK });
  const out: SpellIssue[] = [];
  for (const x of lints) {
    const span = x.span();
    const start = toUnits(text, span.start);
    const end = toUnits(text, span.end);
    out.push({
      start,
      end,
      text: text.slice(start, end),
      message: x.message(),
      kind: x.lint_kind_pretty(),
      suggestions: x
        .suggestions()
        .slice(0, 3)
        .map((s) => s.get_replacement_text()),
    });
    x.free();
  }
  return out;
}
