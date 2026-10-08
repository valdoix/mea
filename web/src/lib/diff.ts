/**
 * Small diffs for AI proposals (CHAR-11, LORE-11): paragraph hunks you accept one by one, and a
 * word diff inside each hunk for display. Longest common subsequence, capped so a huge field
 * can't stall the page.
 */

export type Op<T> = { type: "same" | "del" | "add"; items: T[] };

function lcsOps<T>(a: T[], b: T[], eq: (x: T, y: T) => boolean): Op<T>[] {
  const n = a.length;
  const m = b.length;
  // Lengths table, one row per item of a (n+1 × m+1).
  const table: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) table[i]![j] = eq(a[i]!, b[j]!) ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
  const ops: Op<T>[] = [];
  const push = (type: Op<T>["type"], item: T) => {
    const last = ops.at(-1);
    if (last?.type === type) last.items.push(item);
    else ops.push({ type, items: [item] });
  };
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (eq(a[i]!, b[j]!)) {
      push("same", a[i]!);
      i++;
      j++;
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) push("del", a[i++]!);
    else push("add", b[j++]!);
  }
  while (i < n) push("del", a[i++]!);
  while (j < m) push("add", b[j++]!);
  return ops;
}

const paragraphs = (s: string) => s.replace(/\r\n?/g, "\n").split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
const norm = (s: string) => s.replace(/\s+/g, " ").trim();

export interface Hunk {
  id: number;
  /** Unchanged paragraphs carry no choice. */
  same: boolean;
  before: string[];
  after: string[];
}

export function paragraphHunks(before: string, after: string): Hunk[] {
  const a = paragraphs(before);
  const b = paragraphs(after);
  if (a.length > 400 || b.length > 400) return [{ id: 0, same: false, before: a, after: b }];
  const ops = lcsOps(a, b, (x, y) => norm(x) === norm(y));
  const hunks: Hunk[] = [];
  for (const op of ops) {
    const last = hunks.at(-1);
    if (op.type === "same") hunks.push({ id: hunks.length, same: true, before: op.items, after: op.items });
    else if (last && !last.same) (op.type === "del" ? last.before : last.after).push(...op.items);
    else hunks.push({ id: hunks.length, same: false, before: op.type === "del" ? [...op.items] : [], after: op.type === "add" ? [...op.items] : [] });
  }
  return hunks;
}

/** The text with the accepted hunks taken from the proposal and the rest kept as it was. */
export function mergeHunks(hunks: Hunk[], accepted: Set<number>) {
  return hunks
    .flatMap((h) => (h.same || accepted.has(h.id) ? h.after : h.before))
    .join("\n\n");
}

export type WordPart = { type: "same" | "del" | "add"; text: string };

/** Word-level changes for display; falls back to whole blocks for very long texts. */
export function wordDiff(before: string, after: string): WordPart[] {
  const a = before.split(/(\s+)/).filter(Boolean);
  const b = after.split(/(\s+)/).filter(Boolean);
  if (a.length * b.length > 2_500_000) return [...(before ? [{ type: "del" as const, text: before }] : []), ...(after ? [{ type: "add" as const, text: after }] : [])];
  return lcsOps(a, b, (x, y) => x === y).map((o) => ({ type: o.type, text: o.items.join("") }));
}
