import type { Component } from "svelte";
import { api, get, put } from "./api";
import { onEvent } from "./events";
import { Flag, Lightbulb, MapPin, Milestone, Package, ScrollText, Users } from "./icons";
import { errorToast } from "./state.svelte";
import { DraftSaver } from "./drafts.svelte";
import type { CensusEntry, Expansion, ExpansionPatch, LoreType, StudioDraft, StudioEntry, StudioItem, StudioOptions, StudioReview } from "./types";

/** Entry kinds, with the icon and chip colour the studio shows for each. */
export const LORE_TYPES: { value: LoreType; label: string; plural: string; icon: Component<{ size?: number }>; chip: string }[] = [
  { value: "character", label: "Character", plural: "People", icon: Users, chip: "rose" },
  { value: "location", label: "Location", plural: "Places", icon: MapPin, chip: "sky" },
  { value: "faction", label: "Faction", plural: "Factions", icon: Flag, chip: "lavender" },
  { value: "item", label: "Item", plural: "Things", icon: Package, chip: "peach" },
  { value: "concept", label: "Concept", plural: "Concepts", icon: Lightbulb, chip: "butter" },
  { value: "event", label: "Event", plural: "Events", icon: Milestone, chip: "mint" },
  { value: "rule", label: "Rule", plural: "Rules", icon: ScrollText, chip: "" },
];
export const typeMeta = (t: LoreType | null) => LORE_TYPES.find((x) => x.value === t) ?? null;

type DraftPatch = Partial<{ title: string; stage: StudioDraft["stage"]; text: string; options: Partial<StudioOptions>; answers: Record<string, string>; overview: string; targetBookId: string | null; links: StudioDraft["links"]; expansion: ExpansionPatch; basedOn: string }>;
type ItemPatch = Partial<Pick<StudioItem, "title" | "type" | "pitch" | "parent" | "folder" | "source" | "constant" | "keep" | "steer" | "category" | "about">> & { entry?: StudioEntry | null };

/** Keeps the sections you're editing when the server's copy of an expansion comes in. */
export function mergeExpansion(local: Expansion | null, server: Expansion | null, saver: DraftSaver): Expansion | null {
  if (!server || !local || !saver.pendingPrefix("exp:")) return server;
  return {
    ...server,
    use: saver.pending("exp:use") ? local.use : server.use,
    sections: server.sections.map((s) => {
      const l = local.sections.find((x) => x.id === s.id);
      return l && saver.pending(`exp:${s.id}`) ? { ...s, heading: l.heading, text: l.text } : s;
    }),
  };
}

/**
 * One open studio draft. Text you type is saved after a pause and never overwritten by the
 * server's copy while it's pending; the background writer's progress (status, drafts) streams in
 * through the live event stream and merges around it.
 */
export class StudioSession {
  draft = $state<StudioDraft | null>(null);
  review = $state<StudioReview | null>(null);
  /** The action in flight ("readback", "outline", "write"…), for spinners and disabled buttons. */
  busy = $state("");
  /** What the action in flight is doing now, as the server says ("Taking the census of the world…"). */
  step = $state("");
  /** Seconds into the current step, ticking while an action runs. */
  elapsed = $state(0);
  #stepAt = 0;
  missing = $state(false);
  saver = new DraftSaver(() => this.#queueReview());
  #refreshTimer: ReturnType<typeof setTimeout> | undefined;
  #reviewTimer: ReturnType<typeof setTimeout> | undefined;
  #itemPatches = new Map<string, ItemPatch>();

  constructor(public id: string) {}

  async load() {
    try {
      this.apply((await get<{ draft: StudioDraft }>(`/api/lore-studio/${this.id}`)).draft);
    } catch (e) {
      if ((e as { status?: number }).status === 404) this.missing = true;
      else errorToast(e);
    }
  }

  listen() {
    return onEvent((e) => {
      if (e.type === "studio.step" && e.draftId === this.id) {
        this.step = e.step;
        this.#stepAt = Date.now();
        this.elapsed = 0;
      }
      if ((e.type === "studio.changed" && e.draftId === this.id) || e.type === "reconnected") {
        clearTimeout(this.#refreshTimer);
        this.#refreshTimer = setTimeout(() => void this.load(), 150);
      }
    });
  }

  /** Takes the server's copy, keeping whatever you're still typing. */
  apply(s: StudioDraft) {
    const cur = this.draft;
    const p = (k: string) => this.saver.pending(k);
    if (!cur) {
      this.draft = s;
      this.#queueReview();
      return;
    }
    const items = s.items.map((si) => {
      const li = cur.items.find((x) => x.id === si.id);
      if (!li || !p(`item:${si.id}`)) return si;
      return { ...si, title: li.title, type: li.type, pitch: li.pitch, parent: li.parent, folder: li.folder, source: li.source, constant: li.constant, keep: li.keep, steer: li.steer, entry: si.status === "writing" || si.status === "queued" ? si.entry : li.entry };
    });
    this.draft = {
      ...s,
      items,
      title: p("title") ? cur.title : s.title,
      overview: p("overview") ? cur.overview : s.overview,
      source: p("text") ? { ...s.source, text: cur.source.text } : s.source,
      options: p("options") ? cur.options : s.options,
      basedOn: p("basedOn") ? cur.basedOn : s.basedOn,
      questions: s.questions.map((q) => (p(`answer:${q.id}`) ? { ...q, answer: cur.questions.find((x) => x.id === q.id)?.answer ?? q.answer } : q)),
      expansion: mergeExpansion(cur.expansion, s.expansion, this.saver),
    };
    this.#queueReview();
  }

  /** Saves draft fields after a pause (text) or at once (delay 0). */
  save(p: DraftPatch, key: string, delay = 500) {
    this.saver.queue(key, delay, () => put(`/api/lore-studio/${this.id}`, p));
  }

  saveItem(itemId: string, p: ItemPatch, delay = 500) {
    // Several fields of one item can change in one pause; send them together.
    this.#itemPatches.set(itemId, { ...(this.#itemPatches.get(itemId) ?? {}), ...p });
    this.saver.queue(`item:${itemId}`, delay, async () => {
      const body = this.#itemPatches.get(itemId) ?? {};
      this.#itemPatches.delete(itemId);
      await put(`/api/lore-studio/${this.id}/items/${itemId}`, body);
    });
  }

  flush() {
    return this.saver.flush();
  }

  /** Runs a studio action and takes its result. */
  async act(label: string, path: string, body?: unknown, method: "POST" | "DELETE" = "POST"): Promise<boolean> {
    this.busy = label;
    this.#stepAt = Date.now();
    this.elapsed = 0;
    const ticker = setInterval(() => (this.elapsed = Math.floor((Date.now() - this.#stepAt) / 1000)), 1000);
    try {
      await this.flush();
      const r = await api<{ draft: StudioDraft }>(method, `/api/lore-studio/${this.id}${path}`, method === "POST" ? (body ?? {}) : body);
      if (r?.draft) this.apply(r.draft);
      return true;
    } catch (e) {
      errorToast(e);
      return false;
    } finally {
      clearInterval(ticker);
      this.busy = "";
      this.step = "";
    }
  }

  /** A busy button's label: the step under way, and how long it's taken once that's worth saying. */
  progress(fallback: string) {
    const t = this.elapsed >= 10 ? ` ${Math.floor(this.elapsed / 60)}:${String(this.elapsed % 60).padStart(2, "0")}` : "";
    return `${this.step || fallback}${t}`;
  }

  #queueReview() {
    if (this.draft?.stage !== "review" && this.draft?.stage !== "done") return;
    clearTimeout(this.#reviewTimer);
    this.#reviewTimer = setTimeout(async () => {
      try {
        this.review = await get<StudioReview>(`/api/lore-studio/${this.id}/review`);
      } catch {
        // the checks are a nicety
      }
    }, 400);
  }

  dispose() {
    clearTimeout(this.#refreshTimer);
    clearTimeout(this.#reviewTimer);
    // Unsaved typing still goes out when you leave.
    void this.flush().catch(() => {});
  }
}

/** Steering for a re-write, one tap each. */
export const STEERS = ["Shorter", "More concrete", "Darker", "Warmer", "Stranger", "Add a secret", "More about relationships", "Fix the point of view"];

// ---------- coverage: the census against the plan (mirrors server/src/creator/smarts.ts) ----------

const nameKey = (s: string) => s.toLowerCase().replace(/^(the|a|an)\s+/, "").replace(/['’]s\b/g, "").replace(/[^\p{L}\p{N} ]+/gu, " ").replace(/\s+/g, " ").trim();

/** Does a plan title (or one of its names) cover this name? "Natalie" ↔ "Natalie Scatorccio". */
export function covers(names: string[], name: string): boolean {
  const n = nameKey(name);
  if (!n) return true;
  const words = n.split(" ");
  const inside = (a: string[], b: string[]) => a.length <= b.length && b.join(" ").includes(a.join(" ")) && (a.length > 1 || b[0] === a[0] || b.at(-1) === a[0]);
  return names.some((t) => {
    const k = nameKey(t);
    if (!k) return false;
    if (k === n) return true;
    const kw = k.split(" ");
    return inside(words, kw) || inside(kw, words);
  });
}

/** Who and what the census found that no planned entry covers yet. */
export function uncovered(d: StudioDraft): CensusEntry[] {
  const titles = d.items.flatMap((i) => [i.title, ...(i.entry?.aliases ?? [])]);
  return (d.census ?? []).filter((e) => !covers(titles, e.name));
}
