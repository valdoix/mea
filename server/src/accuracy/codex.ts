import { all, parseJson } from "../db/db";
import { notFound } from "../lib/http";
import { keyMatches } from "../lore/activate";
import { scanEntriesFor } from "../lore/service";
import { atomOut } from "../memory/atoms";
import { entityCard, entityFacts, entityGraph, entityOut, getEntityRow, norm, resolver } from "../memory/entities";
import { listJournals } from "../memory/journals";
import { promises, secrets } from "../memory/ledgers";
import { levelRows, storyRow, type SummaryRow } from "../memory/store";
import { mustChat } from "../services/chats";
import { currentFold } from "../trackers/store";

/**
 * The Story Codex (CON-08): a wiki of the story, built from entities, facts, summaries and the
 * trackers: cast, places, things, groups, the timeline, threads, relationships. It's editable,
 * and edits flow back: an entity edit locks it (MEM-27), a fact edit is a memory edit.
 */

export function codex(chatId: string) {
  mustChat(chatId);
  const res = resolver(chatId);
  const journals = new Set(listJournals(chatId).map((j) => norm(j.name)));
  const factCount = new Map<string, number>();
  for (const e of res.rows) factCount.set(e.id, 0);
  for (const a of all<{ entities: string }>("SELECT entities FROM memories WHERE chat_id = ? AND deleted_at IS NULL AND status IN ('active', 'disputed')", chatId)) {
    for (const n of parseJson<string[]>(a.entities, [])) {
      const e = res.find(n);
      if (e) factCount.set(e.id, (factCount.get(e.id) ?? 0) + 1);
    }
  }
  const card = (e: (typeof res.rows)[number]) => ({ ...entityOut(e), card: entityCard(e), facts: factCount.get(e.id) ?? 0, journal: journals.has(norm(e.name)) });
  const of = (kind: string) => res.rows.filter((e) => e.kind === kind).map(card);

  // Timeline: chapters with their scenes, then whatever isn't in a chapter yet.
  const chapters = levelRows(chatId, "chapter");
  const scenes = levelRows(chatId, "scene").filter((s) => s.closed);
  const sceneOut = (s: SummaryRow) => ({ id: s.id, title: s.title, startSeq: s.start_seq, endSeq: s.end_seq, storyTime: s.story_time, state: s.state, importance: s.importance, summary: s.content.split("\n")[0]?.slice(0, 280) ?? "" });
  const timeline = chapters.map((c) => ({
    id: c.id,
    title: c.title || "Untitled chapter",
    startSeq: c.start_seq,
    endSeq: c.end_seq,
    storyTime: c.story_time,
    state: c.state,
    summary: c.content.split("\n")[0]?.slice(0, 400) ?? "",
    scenes: scenes.filter((s) => s.start_seq >= c.start_seq && (c.end_seq == null || (s.end_seq ?? 0) <= c.end_seq)).map(sceneOut),
  }));

  // Threads: the trackers' threads, plus what the latest rollups still call open.
  let trackerThreads: { id: string; title: string; status: string; latest: string | null; openedSeq: number; lastSeq: number }[] = [];
  let calendar: { title: string; when: string; who: string[] }[] = [];
  let milestones: { text: string; seq: number }[] = [];
  try {
    const st = currentFold(chatId).result.state;
    trackerThreads = Object.values(st.threads).map((t) => ({ id: t.id, title: t.title, status: t.status, latest: t.latest ?? null, openedSeq: t.openedSeq, lastSeq: t.lastSeq }));
    calendar = Object.values(st.calendar).map((e) => ({ title: e.title, when: e.when, who: e.who }));
    milestones = st.milestones.map((m) => ({ text: m.text, seq: m.seq }));
  } catch {
    // no trackers yet
  }
  const latestRollup = [...chapters].reverse().find((c) => c.state === "ready") ?? storyRow(chatId);
  const openFromRecords = parseJson<{ openThreads?: string[] }>(latestRollup?.data ?? "{}", {}).openThreads ?? [];

  const graph = entityGraph(chatId);
  const story = storyRow(chatId);
  return {
    story: story ? { title: story.title, summary: story.content, throughSeq: story.end_seq } : null,
    cast: of("person"),
    places: of("place"),
    objects: of("object"),
    groups: of("group"),
    concepts: of("concept"),
    timeline,
    unfiled: scenes.filter((s) => !chapters.some((c) => s.start_seq >= c.start_seq && (c.end_seq == null || (s.end_seq ?? 0) <= c.end_seq))).map(sceneOut),
    threads: { tracked: trackerThreads, fromRecords: openFromRecords },
    calendar,
    milestones,
    relationships: graph.edges.map((e) => ({ ...e, fromName: graph.nodes.find((n) => n.id === e.from)?.name ?? "", toName: graph.nodes.find((n) => n.id === e.to)?.name ?? "" })),
    promises: promises(chatId).length,
    secrets: secrets(chatId).length,
  };
}

/** One codex page: the entity, every fact about it, where it shows up, its ties, its journal, its lore. */
export function codexEntry(entityId: string) {
  const e = getEntityRow(entityId);
  if (!e) throw notFound("Entity not found");
  const chatId = e.chat_id;
  const res = resolver(chatId);
  const names = res.namesOf(e);
  const facts = entityFacts(chatId, e, 60).map((a) => atomOut(a));
  // Scenes that name it, through any alias.
  const appearances = levelRows(chatId, "scene")
    .filter((s) => s.state === "ready" && names.some((n) => n.length >= 3 && keyMatches(n, `${s.title}\n${s.content}\n${s.data}`, false, true)))
    .map((s) => ({ id: s.id, title: s.title, startSeq: s.start_seq, endSeq: s.end_seq, storyTime: s.story_time }));
  const graph = entityGraph(chatId);
  const ties = graph.edges
    .filter((x) => x.from === e.id || x.to === e.id)
    .map((x) => ({ ...x, other: graph.nodes.find((n) => n.id === (x.from === e.id ? x.to : x.from))?.name ?? "", direction: x.from === e.id ? "out" : "in" }));
  const journal = listJournals(chatId).find((j) => names.some((n) => norm(n) === norm(j.name))) ?? null;
  const chat = mustChat(chatId);
  const lore = scanEntriesFor({ characterId: chat.character_id, personaId: chat.persona_id, chatId })
    .filter((x) => x.keys.some((k) => names.some((n) => norm(k) === norm(n))) || names.some((n) => norm(x.comment) === norm(n)))
    .map((x) => ({ id: x.id, bookId: x.bookId, bookName: x.bookName, title: x.comment || x.keys[0] || "", content: x.content.slice(0, 600) }));
  // The facts are listed in full below, so the card is just who or what it is.
  return { entity: entityOut(e), card: entityCard(e), facts, appearances, ties, journal, lore };
}
