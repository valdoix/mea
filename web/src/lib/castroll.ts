/** The parts of a tracker change the roll reads (kept local so the server tests can load this file). */
export interface TrackerChange {
  kind: string;
  text: string;
  subject?: string;
  reason?: string;
  tone?: "up" | "down" | "due" | "warn";
  flag?: string;
  source?: string;
  event?: string;
  why?: string[];
}

/**
 * The cast roll under a reply: what it changed, filed under the person it happened to, with
 * everything that belongs to no one (the clock, the weather, a new thread) under "the world".
 * Each change is read back into a short line in that person's voice ("feels more Fear toward
 * James", "learned: …", "promised the group: …"); anything it can't read keeps its full text.
 */

export type Beat =
  | { type: "feel"; c: TrackerChange; feeling: string; delta: string; toward: string; good: boolean }
  | { type: "know"; c: TrackerChange; verb: string; text: string }
  | { type: "vow"; c: TrackerChange; verb: string; whom: string; text: string }
  | { type: "tag"; c: TrackerChange; tag: string; text: string; toward?: string };

export interface Row {
  /** Null for the world. */
  name: string | null;
  beats: Beat[];
}

// The most telling first; the clock goes last (it's in the HUD).
export const RANK = ["death", "romance", "bond", "secret", "knowledge", "promise", "owe", "deadline", "thread", "item", "body", "mood", "place", "cast", "custom", "gauge", "faction", "trait", "look", "weather", "clock"];
const rank = (k: string) => (RANK.indexOf(k) + 100) % 100;
export const byRank = (a: TrackerChange, b: TrackerChange) => rank(a.kind) - rank(b.kind);

/** Kinds that are always about the world, even when a name leads the text. */
const WORLD = new Set(["clock", "weather", "place", "scene", "thread", "deadline", "plant", "clue", "gauge", "faction", "calendar", "motif", "milestone", "item", "secret", "reputation"]);
/** Short labels for the little tag in front of a line. */
const TAG: Record<string, string> = { body: "body", look: "look", trait: "trait", mood: "mood", drive: "wants", cast: "cast", death: "died", journal: "journal", pressure: "pressure", custom: "note", edit: "edited" };

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Who a change belongs to: its subject, or a known name that leads its text. */
function ownerOf(c: TrackerChange, names: string[]): string | null {
  if (WORLD.has(c.kind)) return null;
  if (c.subject) return c.subject;
  const t = c.text.toLowerCase();
  const hit = names.filter((n) => t.startsWith(n.toLowerCase())).sort((a, b) => b.length - a.length)[0];
  return hit ? c.text.slice(0, hit.length) : null;
}

/** The text with its owner's name taken off the front ("Jackie: brittle" → "brittle"). */
function rest(text: string, who: string): string {
  const m = text.match(new RegExp(`^${esc(who)}(?:'s)?\\s*[:·]?\\s*`, "i"));
  return m ? text.slice(m[0].length) : text;
}

export function beatOf(c: TrackerChange, who: string | null): Beat {
  const body = who ? rest(c.text, who) : c.text;
  if (who && (c.kind === "bond" || c.kind === "romance")) {
    // "A → B · Fear +1"
    const axis = body.match(/^→\s*(.+?)\s*·\s*(.+?)\s+([+\-−]?\d+)$/);
    if (axis) return { type: "feel", c, toward: axis[1]!, feeling: axis[2]!, delta: axis[3]!.replace("-", "−"), good: c.tone !== "down" };
    // "A → B: label" / "A → B: Sweetheart (5/7)"
    const label = body.match(/^→\s*(.+?):\s*(.+)$/);
    if (label) return { type: "tag", c, tag: c.kind === "romance" ? "heart" : "bond", toward: label[1]!, text: label[2]! };
  }
  if (who && c.kind === "knowledge") {
    const m = body.match(/^(learned|now [\w ]+?):\s*(.+)$/s);
    if (m) return { type: "know", c, verb: m[1] === "learned" ? "now knows" : m[1]!, text: m[2]! };
  }
  if (who && (c.kind === "promise" || c.kind === "owe")) {
    const m = body.match(/^(promised|owes|will meet)\s*([^:]*?):\s*(.+)$/s);
    if (m) return { type: "vow", c, verb: m[1] === "promised" ? (m[2] ? "swore to" : "swore") : m[1]!, whom: m[2] ?? "", text: m[3]! };
    const s = body.match(/^(Promise|Debt) (\w+):\s*(.+)$/s);
    if (s) return { type: "tag", c, tag: `${s[1]!.toLowerCase()} ${s[2]}`, text: s[3]! };
  }
  if (who && c.kind === "cast") return { type: "tag", c, tag: "cast", text: body };
  if (who && c.kind === "death") return { type: "tag", c, tag: "died", text: c.reason ?? "" };
  return { type: "tag", c, tag: TAG[c.kind] ?? c.kind, text: body || c.text };
}

/** The roll: people in the order their most telling change comes, then the world. */
export function castRoll(changes: TrackerChange[], names: string[]): Row[] {
  const rows = new Map<string, Row>();
  const world: Row = { name: null, beats: [] };
  for (const c of [...changes].sort(byRank)) {
    const who = ownerOf(c, names);
    if (!who) {
      world.beats.push(beatOf(c, null));
      continue;
    }
    const key = who.toLowerCase();
    const row = rows.get(key) ?? { name: who, beats: [] };
    rows.set(key, row);
    row.beats.push(beatOf(c, who));
  }
  return [...rows.values(), ...(world.beats.length ? [world] : [])];
}
