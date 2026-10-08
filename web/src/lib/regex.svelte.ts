import type { RegexScript } from "./types";

/**
 * Regex scripts in the browser (PROMPT-08): display-only scripts change how messages look, and the
 * settings tester previews any script. Same rules as the server (server/src/lib/regex.ts).
 */

const cache = new Map<string, RegExp | null>();

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
  if (cache.size > 300) cache.delete(cache.keys().next().value!);
  return re;
}

export function applyScript(text: string, s: Pick<RegexScript, "find" | "replace">) {
  const re = compileFind(s.find);
  if (!re) return text;
  re.lastIndex = 0;
  return text.replace(re, s.replace.replace(/\{\{match\}\}/gi, "$$&"));
}

export function applyRegex(text: string, scripts: RegexScript[] | undefined, scope: { role: "ai" | "user"; mode: RegexScript["mode"]; characterId?: string | null }) {
  if (!scripts?.length) return text;
  let out = text;
  for (const s of scripts) {
    if (!s.enabled || s.mode !== scope.mode || !s.targets.includes(scope.role)) continue;
    if (s.characterIds.length && (!scope.characterId || !s.characterIds.includes(scope.characterId))) continue;
    out = applyScript(out, s);
  }
  return out;
}

/** The chat on screen, for character-scoped display scripts. */
export const regexScope = $state({ characterId: null as string | null });

export function importStRegex(json: unknown): RegexScript[] {
  const list = Array.isArray(json) ? json : [json];
  return list
    .filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === "object")
    .map((x, i) => {
      const placement = Array.isArray(x.placement) ? (x.placement as number[]) : [2];
      const targets = [...(placement.includes(1) ? ["user"] : []), ...(placement.includes(2) ? ["ai"] : [])] as ("ai" | "user")[];
      const script: RegexScript = {
        id: `st-${Date.now().toString(36)}-${i}`,
        name: String(x.scriptName ?? x.name ?? `Script ${i + 1}`),
        find: String(x.findRegex ?? x.find ?? ""),
        replace: String(x.replaceString ?? x.replace ?? ""),
        targets: targets.length ? targets : ["ai"],
        mode: (x.markdownOnly ? "display" : x.promptOnly ? "prompt" : "persistent") as RegexScript["mode"],
        enabled: !x.disabled,
        characterIds: [],
      };
      return script;
    })
    .filter((s) => s.find);
}
