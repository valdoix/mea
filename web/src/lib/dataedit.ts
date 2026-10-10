/**
 * Your direct edits of the story's records, as ledger lines the server folds in like any other
 * change: `edit ["chars","mira","mood","name"] = "calm"` (null removes).
 */
export const editLine = (path: (string | number)[], value: unknown) => `edit ${JSON.stringify(path.map(String))} = ${JSON.stringify(value ?? null)}`;

const isObj = (v: unknown): v is Record<string, unknown> => v != null && typeof v === "object" && !Array.isArray(v);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** The smallest set of edit lines that turns `before` into `after` (lists are replaced whole). */
export function diffLines(before: unknown, after: unknown, path: (string | number)[]): string[] {
  if (same(before, after)) return [];
  if (isObj(before) && isObj(after)) {
    const out: string[] = [];
    for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (!(k in after) || after[k] === undefined) out.push(editLine([...path, k], null));
      else out.push(...diffLines(before[k], after[k], [...path, k]));
    }
    return out;
  }
  return [editLine(path, after === "" && typeof before !== "string" ? null : after)];
}

/** Record fields that hold a person's id. */
export const PERSON_KEYS = new Set(["holder", "owner", "who", "whom", "from", "to", "keepers"]);
