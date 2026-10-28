import { all, parseJson } from "../db/db";
import type { MemoryConfig } from "../lib/settings";
import { currentFold } from "../trackers/store";
import { AUTHORITY } from "./canon";

/**
 * How recalled memories read in the prompt: temporal grounding (MEM-36) and formatter styles (MEM-37).
 * Every memory is labeled with when (relative to the story's "now") and where it happened.
 */

export interface RecallItem {
  ownerType: "memory" | "summary" | "entity" | "quote" | "journal";
  id: string;
  type: string;
  content: string;
  slot: "pinned" | "entity" | "recent" | "relevant" | "serendipity" | "deep";
  score: number;
  reasons: string[];
  tokens: number;
  seq: number | null;
  /** MEM-36: "3 days ago", "yesterday evening". */
  when?: string | null;
  /** MEM-36: "at the harbor". */
  where?: string | null;
  /** Who holds this memory (MEM-16 attributed format). */
  who?: string[];
  /** CON-01: you wrote or confirmed it. */
  confirmed?: boolean;
  disputed?: boolean;
}

const HOUR = 60;
const DAY = 1440;

function partOfDay(minutes: number) {
  const h = Math.floor((((minutes % DAY) + DAY) % DAY) / HOUR);
  return h < 5 ? "night" : h < 12 ? "morning" : h < 17 ? "afternoon" : h < 21 ? "evening" : "night";
}

/** "yesterday evening", "3 days ago", "last week": relative to the story's own clock. */
export function relativeTime(then: number, nowMin: number): string {
  const d = nowMin - then;
  if (d < -5) return "later on";
  if (d < 45) return "moments ago";
  if (d < 3 * HOUR) return "an hour or two ago";
  const days = Math.floor(nowMin / DAY) - Math.floor(then / DAY);
  if (days <= 0) return partOfDay(then) === partOfDay(nowMin) ? "earlier today" : `this ${partOfDay(then)}`;
  if (days === 1) return partOfDay(then) === "night" ? "last night" : `yesterday ${partOfDay(then)}`;
  if (days < 7) return `${days} days ago`;
  if (days < 14) return "last week";
  if (days < 60) return `${Math.round(days / 7)} weeks ago`;
  if (days < 365) return `${Math.round(days / 30)} months ago`;
  const y = Math.round(days / 365);
  return y === 1 ? "a year ago" : `${y} years ago`;
}

/** Story time and place per message (from the trackers), and place per scene (from scene records) where the trackers have none. */
export class TimeIndex {
  private seqs: number[] = [];
  private minutes: number[] = [];
  private placeSeqs: number[] = [];
  private placeNames: string[] = [];
  private scenePlace = new Map<string, string>();
  private sceneTime = new Map<string, string>();
  readonly now: number | null;
  constructor(chatId: string) {
    let times: Record<string, string | null> = {};
    let places: Record<string, string> = {};
    try {
      const f = currentFold(chatId);
      times = f.times;
      places = f.places ?? {};
    } catch {
      times = {};
    }
    const rows = all<{ id: string; seq: number }>("SELECT id, seq FROM messages WHERE chat_id = ? AND deleted_at IS NULL ORDER BY seq", chatId);
    for (const r of rows) {
      const p = places[r.id];
      if (p) {
        this.placeSeqs.push(r.seq);
        this.placeNames.push(p.split(" › ").slice(-2).join(" › "));
      }
      const t = times[r.id];
      if (!t) continue;
      this.seqs.push(r.seq);
      this.minutes.push(Number(t.split(":")[0]));
    }
    this.now = this.minutes.at(-1) ?? null;
    for (const s of all<{ id: string; data: string; story_time: string | null }>("SELECT id, data, story_time FROM summaries WHERE chat_id = ? AND level = 'scene'", chatId)) {
      const loc = parseJson<{ locations?: string[] }>(s.data, {}).locations?.[0];
      if (loc) this.scenePlace.set(s.id, loc);
      if (s.story_time) this.sceneTime.set(s.id, s.story_time);
    }
  }
  /** Story minutes at a message (the latest known at or before it). */
  at(seq: number | null): number | null {
    const i = latest(this.seqs, seq);
    return i < 0 ? null : this.minutes[i]!;
  }
  when(seq: number | null, sceneId?: string | null): string | null {
    const t = this.at(seq);
    if (t != null && this.now != null) return relativeTime(t, this.now);
    return sceneId ? (this.sceneTime.get(sceneId) ?? null) : null;
  }
  /**
   * Where a memory happened: the place at its own message, since a scene can move (the drive home
   * was filed "at Gabriel's kitchen", where its scene began); the scene's place when the trackers
   * have none. A whole scene's summary passes no seq and keeps the scene's place.
   */
  where(sceneId?: string | null, seq?: number | null): string | null {
    const i = latest(this.placeSeqs, seq ?? null);
    if (i >= 0) return this.placeNames[i]!;
    return sceneId ? (this.scenePlace.get(sceneId) ?? null) : null;
  }
}

/** The index of the latest seq at or before this one, or -1. */
function latest(seqs: number[], seq: number | null) {
  if (seq == null || !seqs.length) return -1;
  let lo = 0;
  let hi = seqs.length - 1;
  let best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (seqs[mid]! <= seq) {
      best = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return best;
}

const RECALL_HEADERS: Record<MemoryConfig["format"], string> = {
  prose:
    "Memory notes — details from earlier in the story that may matter right now, each with when and where it happened. Use them to stay consistent and weave them in only where they fit naturally. Don't quote them, list them, or say that you remember.",
  attributed:
    "Memory notes — who remembers what, and how long ago. A character only knows what they remember here or saw on the page. Weave them in naturally; don't quote them or say that you remember.",
  clinical: "Continuity facts (type · when · source message). Keep replies consistent with them. Don't recite them.",
  minimal: "Memory notes. Stay consistent; don't recite.",
};

const mark = (it: RecallItem) => `${it.confirmed ? " (confirmed)" : ""}${it.disputed ? " (disputed — the story may have changed this)" : ""}`;

function line(it: RecallItem, style: MemoryConfig["format"], pov: string | null) {
  const when = it.when ?? "";
  const where = it.where ? `at ${it.where.replace(/^(at|in) /i, "")}` : "";
  const stamp = [when, where].filter(Boolean).join(", ");
  if (it.ownerType === "entity") return style === "clinical" ? `• [who/what] ${it.content}` : `- About ${it.content}`;
  if (it.ownerType === "quote") return `- ${stamp ? `${stamp[0]!.toUpperCase()}${stamp.slice(1)}, ` : ""}${it.content}`;
  switch (style) {
    case "minimal":
      return `- ${it.content}${mark(it)}`;
    case "clinical":
      return `• [${it.type}] ${it.content}${mark(it)}${stamp ? ` — ${stamp}` : ""}${it.seq != null ? ` · #${it.seq}` : ""}`;
    case "attributed": {
      const who = it.who?.length ? it.who.slice(0, 3).join(" and ") : (pov ?? "Everyone involved");
      const verb = it.who && it.who.length > 1 ? "remember" : "remembers";
      return `- ${who} ${verb}${stamp ? ` (${stamp})` : ""}: ${it.content}${mark(it)}`;
    }
    default:
      return `- ${stamp ? `${stamp[0]!.toUpperCase()}${stamp.slice(1)}: ` : ""}${it.content}${mark(it)}`;
  }
}

/** The recall block (MEM-37), oldest first, entity cards on top, quotes at the end. */
export function formatRecallBlock(items: RecallItem[], style: MemoryConfig["format"], pov: string | null) {
  const list = items.filter((i) => i.slot !== "pinned");
  if (!list.length) return "";
  const entities = list.filter((i) => i.ownerType === "entity");
  const quotes = list.filter((i) => i.ownerType === "quote").sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
  const rest = list.filter((i) => i.ownerType !== "entity" && i.ownerType !== "quote").sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
  const parts = [`[${AUTHORITY.memory} ${RECALL_HEADERS[style]}]`];
  if (entities.length) parts.push(entities.map((i) => line(i, style, pov)).join("\n"));
  if (rest.length) parts.push(rest.map((i) => line(i, style, pov)).join("\n"));
  if (quotes.length) parts.push(`Exact words from long ago:\n${quotes.map((i) => line(i, style, pov)).join("\n")}`);
  return parts.join("\n");
}
