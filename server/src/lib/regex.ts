import { z } from "zod";

/**
 * Regex scripts (PROMPT-08), SillyTavern-style. Each script finds a pattern and replaces it:
 * - display: only how messages look on screen (the web app applies these; stored text is untouched)
 * - prompt: only what the model is sent (the history in the prompt)
 * - persistent: the stored message itself, when a reply finishes or you send a message
 * `{{match}}` in the replacement is the whole match; `$1`… are groups.
 */

export const regexScriptSchema = z.object({
  id: z.string().min(1).max(60),
  name: z.string().max(120),
  find: z.string().max(4000),
  replace: z.string().max(20_000),
  targets: z.array(z.enum(["ai", "user"])).max(2),
  mode: z.enum(["display", "prompt", "persistent"]),
  enabled: z.boolean(),
  /** Only in chats with these characters (empty: every chat). */
  characterIds: z.array(z.string()).max(200).default([]),
});
export type RegexScript = z.infer<typeof regexScriptSchema>;

const cache = new Map<string, RegExp | null>();

/** "/pattern/flags" or a bare pattern (global). Invalid patterns return null and are skipped. */
export function compileFind(find: string): RegExp | null {
  if (cache.has(find)) return cache.get(find)!;
  let re: RegExp | null = null;
  try {
    const m = find.match(/^\/([\s\S]+)\/([dgimsuvy]*)$/);
    re = m ? new RegExp(m[1]!, m[2]!.includes("g") ? m[2]! : `${m[2]}g`) : find ? new RegExp(find, "g") : null;
  } catch {
    re = null;
  }
  cache.set(find, re);
  if (cache.size > 500) cache.delete(cache.keys().next().value!);
  return re;
}

/** M33: a prompt pass's shared state: scripts that ran too long are skipped for the rest of it. */
export interface RegexPass {
  slow: Set<string>;
}

/** M33: a script slower than this on one message is skipped for the rest of the pass. */
export const SCRIPT_BUDGET_MS = 50;

/** M33: prompt-pass results by scripts + scope + text; the history barely changes from turn to turn. */
const results = new Map<string, string>();
const RESULT_CAP = 5000;

export function applyRegex(text: string, scripts: RegexScript[], scope: { role: "ai" | "user"; mode: RegexScript["mode"]; characterId?: string | null }, pass?: RegexPass) {
  const active = scripts.filter(
    (s) => s.enabled && s.mode === scope.mode && s.targets.includes(scope.role) && (!s.characterIds.length || (scope.characterId != null && s.characterIds.includes(scope.characterId))),
  );
  if (!active.length) return text;
  const key = pass ? `${Bun.hash(JSON.stringify(active.map((s) => [s.find, s.replace])))}:${scope.role}:${text.length}:${Bun.hash(text)}` : "";
  if (pass) {
    const hit = results.get(key);
    if (hit !== undefined) return hit;
  }
  let out = text;
  let skipped = false;
  for (const s of active) {
    if (pass?.slow.has(s.id)) {
      skipped = true;
      continue;
    }
    const re = compileFind(s.find);
    if (!re) continue;
    re.lastIndex = 0;
    const t0 = performance.now();
    out = out.replace(re, s.replace.replace(/\{\{match\}\}/gi, "$$&"));
    const ms = performance.now() - t0;
    if (ms > SCRIPT_BUDGET_MS) {
      console.warn(`[mea] regex script "${s.name}" took ${Math.round(ms)} ms on one message${pass ? "; skipped for the rest of this prompt" : ""}`);
      pass?.slow.add(s.id);
    }
  }
  // A pass that skipped a slow script isn't the real result: it's worked out again next time.
  if (pass && !skipped) {
    results.set(key, out);
    if (results.size > RESULT_CAP) results.delete(results.keys().next().value!);
  }
  return out;
}

/** SillyTavern regex export (one script or a list) → Mea scripts. */
export function importStRegex(json: unknown): RegexScript[] {
  const list = Array.isArray(json) ? json : [json];
  return list
    .filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === "object")
    .map((x, i) => {
      const placement = Array.isArray(x.placement) ? (x.placement as number[]) : [2];
      const targets = [...(placement.includes(1) ? ["user"] : []), ...(placement.includes(2) ? ["ai"] : [])] as ("ai" | "user")[];
      return {
        id: typeof x.id === "string" && x.id ? x.id : `st-${Date.now().toString(36)}-${i}`,
        name: String(x.scriptName ?? x.name ?? `Script ${i + 1}`),
        find: String(x.findRegex ?? x.find ?? ""),
        replace: String(x.replaceString ?? x.replace ?? ""),
        targets: targets.length ? targets : ["ai"],
        mode: x.markdownOnly ? "display" : x.promptOnly ? "prompt" : "persistent",
        enabled: !x.disabled,
        characterIds: [],
      } satisfies RegexScript;
    })
    .filter((s) => s.find);
}
