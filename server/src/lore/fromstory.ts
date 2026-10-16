import { all, parseJson } from "../db/db";
import { listOffpage } from "../accuracy/offpage";
import { type ChatSettings, mustChat } from "../services/chats";
import { foldAt } from "../trackers/store";
import { BIPOLAR_AXES, type WorldState } from "../trackers/types";
import { exportStWorldInfo } from "./convert";
import { type Category, withCategory } from "./format";
import { createDraft, mutate } from "./studio";
import { defaultEntry, type LoreEntry } from "./types";

/**
 * Story → lorebook (Almanac plan I3): the Codex, truths, timeline, people, places, bonds, secrets
 * (with off-page handling) and callbacks of one story, as a categorised lorebook, ready for a sequel
 * or another app. As of a chosen message; spoiler-safe leaves every secret out.
 */

export interface StoryBookOptions {
  /** The world as of this message (default: now). */
  uptoSeq?: number;
  /** Leave secrets out (and anything kept off the page). */
  spoilerSafe?: boolean;
}

interface EntityRow {
  id: string;
  kind: string;
  name: string;
  aliases: string;
  description: string;
  status: string;
  facts: string;
  first_seq: number | null;
}

const KIND_CATEGORY: Record<string, Category> = { person: "character", place: "location", object: "item", group: "faction", concept: "history" };
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** How a bond reads in words ("trusts, warm; some resentment"). */
function bondWords(axes: Record<string, number | undefined>) {
  const out: string[] = [];
  for (const [k, v] of Object.entries(axes)) {
    if (!v) continue;
    const bip = (BIPOLAR_AXES as readonly string[]).includes(k);
    const strength = Math.abs(v) >= 3 ? "deep " : Math.abs(v) >= 2 ? "" : "some ";
    out.push(bip && v < 0 ? `${strength}lack of ${k}` : `${strength}${k}`);
  }
  return out.join(", ");
}

export function storyBook(chatId: string, opts: StoryBookOptions = {}) {
  const chat = mustChat(chatId);
  const settings = parseJson<ChatSettings>(chat.settings, {});
  const upto = opts.uptoSeq ?? Number.MAX_SAFE_INTEGER;
  let st: WorldState | null = null;
  try {
    st = foldAt(chatId, opts.uptoSeq != null ? { uptoSeq: opts.uptoSeq } : {}).state;
  } catch {
    st = null;
  }
  const entries: LoreEntry[] = [];
  const add = (e: Partial<LoreEntry>, cat: Category) => entries.push(withCategory(defaultEntry({ ...e, uid: entries.length }), cat, { defaults: true }));
  const nameOf = (id: string) => (st?.chars[id]?.name ?? id);
  const secretTexts = new Set<string>();
  if (st) for (const f of Object.values(st.facts)) if (f.secret) secretTexts.add(f.statement.toLowerCase());
  const kept = listOffpage(chatId).filter((o) => o.status === "kept");
  const keptWords = kept.flatMap((o) => o.neverSay.map((w) => w.toLowerCase()));
  // Spoiler-safe: a fact that states a secret, or uses a word kept off the page, stays out.
  const spoils = (text: string) => opts.spoilerSafe && ([...secretTexts].some((s) => text.toLowerCase().includes(s)) || keptWords.some((w) => w && text.toLowerCase().includes(w)));

  // The timeline boundary: where the story stands.
  const last = all<{ seq: number }>("SELECT MAX(seq) AS seq FROM messages WHERE chat_id = ? AND deleted_at IS NULL AND seq <= ?", chatId, upto)[0]?.seq ?? 0;
  const when = st?.time ? `${st.place.join(" › ") || "somewhere"}, ${st.sceneTitle ? `scene "${st.sceneTitle}"` : "the latest scene"}` : "";
  add({ comment: `${chat.title}: where the story stands`, content: [`As of message ${last} of "${chat.title}".`, when ? `The story is at ${when}.` : "", ...(st?.milestones.slice(-8).map((m) => `${m.text}.`) ?? [])].filter(Boolean).join(" "), keys: [] }, "timeline");

  // Story truths: always.
  if (settings.truths?.length) add({ comment: "Story truths", content: settings.truths.map((t) => `- ${t}`).join("\n"), keys: [] }, "rule");

  // The Codex: people, places, things, groups and ideas, as of that message.
  const rows = all<EntityRow>("SELECT id, kind, name, aliases, description, status, facts, first_seq FROM entities WHERE chat_id = ? AND deleted_at IS NULL AND merged_into IS NULL AND (first_seq IS NULL OR first_seq <= ?) ORDER BY mentions DESC", chatId, upto);
  for (const r of rows.slice(0, 150)) {
    const facts = parseJson<string[]>(r.facts, []).filter((f) => !spoils(f));
    const aliases = parseJson<string[]>(r.aliases, []);
    const content = [r.description.trim(), r.status !== "active" ? `Status: ${r.status}.` : "", ...facts.slice(0, 12).map((f) => `- ${f}`)].filter(Boolean).join("\n");
    if (!content || spoils(r.description)) continue;
    add({ comment: r.name, keys: [r.name, ...aliases].slice(0, 6), content: clip(content, 3000) }, KIND_CATEGORY[r.kind] ?? "history");
  }

  if (st) {
    // People the trackers know who the Codex doesn't, with their lasting traits and drives.
    const named = new Set(entries.map((e) => e.comment.toLowerCase()));
    for (const c of Object.values(st.chars)) {
      if (c.isUser || named.has(c.name.toLowerCase())) continue;
      const bits = [c.look ? `Looks: ${c.look}.` : "", c.traits.length ? `Always: ${c.traits.map((t) => t.text).join("; ")}.` : "", c.drives.want ? `Wants ${c.drives.want}.` : "", c.dead ? "Dead." : ""].filter(Boolean);
      if (bits.length) add({ comment: c.name, keys: [c.name, ...c.aliases].slice(0, 6), content: bits.join(" ") }, "character");
    }
    // Bonds, as relationships.
    for (const b of Object.values(st.bonds)) {
      const words = bondWords(b.axes);
      if (!words && !b.label) continue;
      const a = nameOf(b.from);
      const z = nameOf(b.to);
      add({ comment: `${a} & ${z}`, keys: [a, z], secondaryKeys: [], content: `${a} toward ${z}: ${words || "it's complicated"}${b.label ? ` ("${b.label}")` : ""}.` }, "relationship");
    }
    // Secrets: the facts kept from someone (spoiler-safe leaves them out).
    if (!opts.spoilerSafe) {
      for (const f of Object.values(st.facts).filter((x) => x.secret)) {
        const keepers = f.secret!.keepers.map(nameOf).join(", ");
        const from = f.secret!.from.map(nameOf).join(", ");
        add({ comment: `Secret: ${clip(f.statement, 60)}`, keys: f.statement.split(/\s+/).filter((w) => /^[A-Z]/.test(w)).slice(0, 4), content: `${f.statement}${keepers ? ` Kept by ${keepers}.` : ""}${from ? ` Kept from ${from}.` : ""}` }, "secret");
      }
      // Off-page handling: what the narration may not state yet travels as an OOC note.
      for (const o of kept) add({ comment: `Kept off the page: ${clip(o.label, 50)}`, keys: [], constant: true, content: `[OOC: the narration doesn't state this yet: ${o.label}${o.neverSay.length ? ` Never say: ${o.neverSay.join(", ")}.` : ""}${o.hintAs ? ` It may only be hinted at as: ${o.hintAs}.` : ""}]` }, "ooc");
    }
    // Callbacks: running bits.
    const motifs = Object.values(st.motifs).filter((m) => m.uses >= 1).slice(0, 12);
    if (motifs.length) add({ comment: "Running bits", keys: [], content: motifs.map((m) => `- ${m.text}${m.uses > 1 ? ` (×${m.uses})` : ""}`).join("\n") }, "customs");
    // What's coming: open promises and plans.
    const upcoming = [...Object.values(st.obligations).filter((o) => o.status === "open" || o.status === "due").map((o) => `${nameOf(o.who)} promised ${o.whom ? nameOf(o.whom) : "someone"}: ${o.what}`), ...Object.values(st.calendar).filter((e) => !e.done && e.kind === "plan").map((e) => `${e.title} (${e.when})`)];
    if (upcoming.length) add({ comment: "Promises and plans", keys: [], content: upcoming.map((u) => `- ${u}`).join("\n") }, "upcoming");
  }
  return { name: `${chat.title} (lore)`, description: `From the story "${chat.title}", as of message ${last}${opts.spoilerSafe ? ", spoiler-safe" : ""}.`, entries, asOf: last };
}

/** Export: a SillyTavern World Info book. */
export function storyBookJson(chatId: string, opts: StoryBookOptions = {}) {
  const b = storyBook(chatId, opts);
  return exportStWorldInfo(b.name, b.description, b.entries);
}

/** "As a lorebook": a Lore Studio draft whose plan is pre-filled with the story's entries (each written, with its category). */
export function storyBookDraft(chatId: string, opts: StoryBookOptions = {}) {
  const b = storyBook(chatId, opts);
  const d = createDraft({ kind: "idea", title: b.name, text: b.description });
  return mutate(d.id, (cur) => {
    cur.overview = b.description;
    cur.options.overview = false;
    cur.items = b.entries.map((e) => ({
      id: crypto.randomUUID(),
      title: e.comment,
      type: ((e.extra as { type?: string }).type ?? null) as never,
      pitch: "",
      parent: "",
      folder: "",
      source: "",
      constant: e.constant,
      keep: true,
      status: "drafted" as const,
      error: "",
      entry: { content: e.content, keys: e.keys, aliases: [], essentials: e.content.split(/(?<=[.!?])\s/)[0]!.slice(0, 200), secrets: [] },
      previous: null,
      steer: "",
      savedEntryId: null,
      basis: "",
      research: null,
      links: {},
      category: ((e.extra as { category?: Category }).category ?? null) as Category | null,
      action: "write" as const,
      targetEntryId: null,
      versionSource: null,
    }));
    cur.stage = "plan";
    cur.planVersions = [{ n: 1, at: Date.now(), why: `from the story, as of message ${b.asOf}`, items: cur.items.map((i) => ({ id: i.id, title: i.title, category: i.category, pitch: i.pitch, keep: i.keep, action: i.action })) }];
  });
}
