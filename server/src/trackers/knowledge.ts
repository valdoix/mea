import type { Fact, KnowStatus } from "./types";

/**
 * docs/35 Part 2: one answer to "does this person know this?". Every check, prompt and plan reads it
 * here, so a missing entry means the same thing everywhere: nothing recorded, never "doesn't know".
 *
 * - knows: a keeper, someone it was revealed to, or a stance of knows / believes / sees
 * - suspects: suspects, doubts, or heard it off the page
 * - unaware: a stance of unaware or wrong, kept from them by name, or kept from everyone
 * - unsaid: nothing recorded either way
 */
export type Knowing = "knows" | "suspects" | "unaware" | "unsaid";

export interface Knowledge {
  status: Knowing;
  /** The stance as recorded ("believes", "wrong", "heard"), when there is one. */
  detail?: KnowStatus;
  /** One of the people keeping it. */
  keeper: boolean;
  /** Kept from them by name (or by "from everyone"). */
  kept: boolean;
  /** How they came to know, or why not: "keeps it", "told at #904", "kept from them", "it's about them". */
  why: string;
  seq?: number;
  /** You set it yourself. */
  set?: boolean;
}

const KNOWS = new Set<string>(["knows", "believes", "sees"]);
const SUSPECTS = new Set<string>(["suspects", "doubts", "heard"]);
const UNAWARE = new Set<string>(["unaware", "wrong"]);

export function knowledgeOf(f: Fact, id: string): Knowledge {
  const s = f.stances[id];
  const keeper = Boolean(f.secret?.keepers.includes(id));
  const kept = Boolean(f.secret && !keeper && (f.secret.from.includes(id) || f.secret.everyone) && !(s && (KNOWS.has(s.status) || SUSPECTS.has(s.status))));
  const told = f.revealed.find((r) => r.to.includes(id));
  const base = { keeper, kept, ...(s?.set ? { set: true } : {}) };
  // What you set yourself comes first, then what the records say, most certain first.
  if (s?.set) return { ...base, status: statusOf(s.status), detail: s.status, why: s.route ?? "you said so", seq: s.seq };
  if (keeper) return { ...base, status: "knows", detail: s?.status ?? "knows", why: "keeps it", seq: s?.seq };
  if (told) return { ...base, status: "knows", detail: s?.status ?? "knows", why: told.how ? `told at #${told.seq}: ${told.how}` : `told at #${told.seq}`, seq: told.seq };
  if (s) return { ...base, status: statusOf(s.status), detail: s.status, why: s.route ?? (UNAWARE.has(s.status) && kept ? "kept from them" : s.status), seq: s.seq };
  if (kept) return { ...base, status: "unaware", why: "kept from them" };
  return { ...base, status: "unsaid", why: "nothing recorded" };
}

function statusOf(s: KnowStatus | string): Knowing {
  if (KNOWS.has(s)) return "knows";
  if (SUSPECTS.has(s)) return "suspects";
  if (UNAWARE.has(s)) return "unaware";
  return "unsaid";
}

/** Who knows, suspects, or is in the dark about a fact, of the ids given. */
export function whoKnows(f: Fact, ids: string[]) {
  const by = (k: Knowing) => ids.filter((id) => knowledgeOf(f, id).status === k);
  return { knows: by("knows"), suspects: by("suspects"), unaware: by("unaware") };
}
