import { all, one, parseJson } from "../db/db";
import { listAtoms } from "../memory/atoms";
import { chatNames } from "../memory/build";
import { deepSearch } from "../memory/deep";
import { embedQueries, embeddingsEnabled } from "../memory/embed";
import { type EntityRow, entityCard, entityFacts, getEntityRow, listEntities, resolver } from "../memory/entities";
import { cleanText } from "../memory/text";
import { gatherSources } from "../accuracy/archivist";
import type { Looked } from "../assistant/core";
import { castKey, castProfiles, currentFold } from "../trackers/store";
import type { Character, WorldState } from "../trackers/types";

/**
 * What Meus can ask to read before it answers, as "kind: what" lines. Each comes back as a short,
 * labelled page; what it read shows under its reply.
 */

export const LOOKUPS = [
  '"search: <words>" the exact words in past messages, with their numbers;',
  '"recall: <topic>" memories and scene summaries about a topic;',
  '"person: <name>" everything about one person: their cast entry, bonds, things, secrets, journal, Codex page and memories;',
  '"records: <bonds|facts|items|threads|promises|deadlines|plants|clues|calendar|places|gauges|custom>" one part of the story\'s records, in full, with ids;',
  '"timeline: clock" how the story clock moved, message by message;',
  '"message: <number>" one message in full;',
  '"codex: <name>" a Codex page with its id, aliases, status and facts (or "codex: all" for the list);',
  '"memories: <words>" memories that mention these words, with their ids.',
].join(" ");

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function stateOf(chatId: string): WorldState | null {
  try {
    return currentFold(chatId).result.state;
  } catch {
    return null;
  }
}

function findChar(st: WorldState, name: string): Character | undefined {
  const k = castKey(name);
  const all_ = Object.values(st.chars);
  return all_.find((c) => c.id === name || castKey(c.name) === k || c.aliases.some((a) => castKey(a) === k)) ?? all_.find((c) => castKey(c.name).split(" ").includes(k));
}

function person(chatId: string, name: string): Looked | null {
  const st = stateOf(chatId);
  const names = chatNames(chatId);
  const L: string[] = [];
  const c = st ? findChar(st, name) : undefined;
  if (st && c) {
    const nm = (id: string) => st.chars[id]?.name ?? id;
    L.push(`${c.name} [${c.id}]${c.isUser ? ` (the player's persona, ${names.user})` : c.isMain ? " (the card's character)" : ""}${c.aliases.length ? `, also called ${c.aliases.join(", ")}` : ""}`);
    L.push(`Story record (path ["chars","${c.id}"]): ${JSON.stringify({ tier: c.tier, place: c.place, activity: c.activity, mood: c.mood?.name, look: c.look, traits: c.traits.map((t) => t.text), drives: c.drives, mask: c.mask, meters: c.meters, injuries: c.injuries, conditions: c.conditions.map((x) => x.text), dead: c.dead })}`);
    const profile = castProfiles(chatId)[castKey(c.name)];
    if (profile) L.push(`Cast profile: ${JSON.stringify(profile)}`);
    for (const [k, b] of Object.entries(st.bonds)) if (b.from === c.id || b.to === c.id) L.push(`bond [${k}] ${nm(b.from)}>${nm(b.to)}: ${JSON.stringify(b.axes)}${b.label ? ` "${b.label}"` : ""}`);
    for (const [k, l] of Object.entries(st.ladders)) if (l.from === c.id || l.to === c.id) L.push(`romance [${k}] ${nm(l.from)}>${nm(l.to)}: rung ${l.tier}`);
    for (const i of Object.values(st.items)) if (i.holder === c.id || i.owner === c.id) L.push(`thing [${i.id}] ${i.name}${i.holder === c.id ? " (holds)" : ""}${i.owner === c.id ? " (owns)" : ""}${i.gone ? " (gone)" : ""}`);
    for (const f of Object.values(st.facts)) if (f.secret?.keepers.includes(c.id) || f.stances[c.id]) L.push(`fact #${f.key}: ${f.statement}${f.secret ? ` (secret kept by ${f.secret.keepers.map(nm).join(", ")})` : ""}${f.stances[c.id] ? ` · ${c.name} ${f.stances[c.id]!.status}` : ""}`);
    for (const j of c.journal.slice(-5)) L.push(`journal #${j.seq}: ${j.text}`);
  }
  const ent = resolver(chatId).find(c?.name ?? name);
  if (ent) {
    L.push(`Codex page [${ent.id}]: ${entityCard(ent)}`);
    for (const a of entityFacts(chatId, ent, 10)) L.push(`memory [${a.id}]: ${a.content}`);
  }
  return L.length ? { title: `Person · ${c?.name ?? ent?.name ?? name}`, text: L.join("\n") } : null;
}

const SECTIONS: Record<string, keyof WorldState> = {
  bonds: "bonds", romance: "ladders", ladders: "ladders", facts: "facts", secrets: "facts", items: "items", things: "items", threads: "threads",
  promises: "obligations", debts: "obligations", obligations: "obligations", deadlines: "deadlines", plants: "plants", clues: "clues",
  calendar: "calendar", places: "places", gauges: "gauges", clocks: "clocks", factions: "clocks", rep: "rep", reputation: "rep",
  custom: "custom", motifs: "motifs", milestones: "milestones", locks: "locks", scene: "place",
};

function records(chatId: string, what: string): Looked | null {
  const st = stateOf(chatId);
  if (!st) return null;
  const key = SECTIONS[what.toLowerCase().trim().split(/\s+/)[0] ?? ""];
  if (!key) return null;
  const v = key === "place" ? { time: st.time, weather: st.weather, place: st.place, scene: st.sceneTitle } : st[key];
  // History arrays are long and rarely needed; the edit path is the section key and the record's id.
  const strip = (x: unknown): unknown => (Array.isArray(x) ? x.map(strip) : x && typeof x === "object" ? Object.fromEntries(Object.entries(x).filter(([k]) => k !== "history" && k !== "custody").map(([k, y]) => [k, strip(y)])) : x);
  return { title: `Records · ${what}`, text: `Edit path starts ["${key}", …].\n${clip(JSON.stringify(strip(v), null, 1), 6000)}` };
}

function timeline(chatId: string): Looked | null {
  const fold = currentFold(chatId).result;
  const seqOf = new Map(all<{ id: string; seq: number }>("SELECT id, seq FROM messages WHERE chat_id = ? AND deleted_at IS NULL", chatId).map((r) => [r.id, r.seq]));
  const L: string[] = [];
  for (const [mid, list] of Object.entries(fold.changes))
    for (const c of list) if (c.kind === "clock") L.push(`#${seqOf.get(mid) ?? "?"} ${c.text}${c.flag ? ` (${c.flag})` : ""}${c.source === "user" ? " (your edit)" : ""}`);
  L.sort((a, b) => Number(a.slice(1).split(" ")[0]) - Number(b.slice(1).split(" ")[0]));
  return { title: "Timeline · the clock", text: L.length ? L.slice(-80).join("\n") : "The clock hasn't moved yet." };
}

function message(chatId: string, n: string): Looked | null {
  const seq = Number(n.replace(/[^\d]/g, ""));
  if (!seq) return null;
  const m = one<{ id: string; seq: number; name: string | null; role: string; content: string; swipes: number }>(
    `SELECT m.id, m.seq, m.name, m.role, s.content, (SELECT COUNT(*) FROM swipes x WHERE x.message_id = m.id) AS swipes
     FROM messages m JOIN swipes s ON s.message_id = m.id AND s.idx = m.active_swipe WHERE m.chat_id = ? AND m.seq = ? AND m.deleted_at IS NULL`,
    chatId,
    seq,
  );
  if (!m) return null;
  const names = chatNames(chatId);
  const who = m.name ?? (m.role === "user" ? names.user : m.role === "assistant" ? names.char : m.role);
  return { title: `Message #${m.seq} · ${who}`, text: `${m.swipes > 1 ? `(${m.swipes} versions; this is the one shown)\n` : ""}${clip(m.content, 8000)}` };
}

function codex(chatId: string, name: string): Looked | null {
  if (/^(all|list|everything|\*)$/i.test(name.trim())) {
    const rows = listEntities(chatId);
    return { title: "Codex · every page", text: rows.slice(0, 150).map((e) => `[${e.id}] ${e.name} (${e.kind}${e.status !== "active" ? `, ${e.status}` : ""})${e.aliases.length ? ` aka ${e.aliases.slice(0, 4).join(", ")}` : ""}`).join("\n") || "The Codex is empty." };
  }
  const res = resolver(chatId);
  const hits: EntityRow[] = [];
  const direct = getEntityRow(name.trim());
  if (direct && direct.chat_id === chatId) hits.push(direct);
  const found = res.find(name);
  if (found && !hits.includes(found)) hits.push(found);
  for (const e of listEntities(chatId, { q: name }).slice(0, 4)) {
    const r = getEntityRow(e.id);
    if (r && !hits.some((h) => h.id === r.id)) hits.push(r);
  }
  if (!hits.length) return null;
  return {
    title: `Codex · ${hits[0]!.name}`,
    text: hits
      .slice(0, 4)
      .map((r) => {
        const data = parseJson<{ locked?: string[] }>(r.data, {});
        return `[${r.id}] ${r.name} · ${r.kind} · ${r.status}${r.merged_into ? ` · merged into ${r.merged_into}` : ""}\naliases: ${parseJson<string[]>(r.aliases, []).join(", ") || "none"}\ndescription: ${r.description || "(none)"}\nfacts:\n${parseJson<string[]>(r.facts, []).map((f) => `  - ${f}`).join("\n") || "  (none)"}${data.locked?.length ? `\nlocked by the player: ${data.locked.join(", ")}` : ""}`;
      })
      .join("\n\n"),
  };
}

function memories(chatId: string, words: string): Looked | null {
  const r = listAtoms(chatId, { q: words, limit: 15 });
  if (!r.atoms.length) return null;
  return { title: `Memories · ${words}`, text: r.atoms.map((a) => `[${a.id}] (${a.type}${a.pinned ? ", pinned" : ""}${a.status !== "active" ? `, ${a.status}` : ""}${a.sources?.length ? `, #${a.sources.map((s) => s.seq).join(" #")}` : ""}) ${a.content}`).join("\n") };
}

async function search(chatId: string, words: string): Promise<Looked | null> {
  const last = one<{ s: number }>("SELECT MAX(seq) AS s FROM messages WHERE chat_id = ? AND deleted_at IS NULL", chatId)?.s ?? 0;
  const qvec = embeddingsEnabled() ? ((await embedQueries([words], 4000))[0] ?? null) : null;
  const hits = deepSearch(chatId, { query: words, qvec, beforeSeq: last + 1, quotes: 8, excerptSize: 500 });
  if (!hits.length) return null;
  return { title: `Search · ${words}`, text: hits.map((h) => `#${h.seq} ${h.speaker}: ${cleanText(h.excerpt).replace(/\s+/g, " ")}`).join("\n") };
}

async function recallTopic(chatId: string, topic: string): Promise<Looked | null> {
  const s = await gatherSources(chatId, topic, 10);
  if (!s.length) return null;
  return { title: `Recall · ${topic}`, text: s.map((x) => `(${x.type}${x.seq != null ? `, #${x.seq}` : ""}${x.type === "memory" && x.ownerId ? `, id ${x.ownerId}` : ""}) ${clip(x.excerpt, 500)}`).join("\n") };
}

/** One "kind: what" lookup. Unknown kinds search the story's words. */
export async function lookup(chatId: string, query: string): Promise<Looked | null> {
  const m = query.match(/^\s*([a-z]+)\s*:\s*(.+)$/i);
  const kind = m?.[1]?.toLowerCase() ?? "search";
  const what = (m?.[2] ?? query).trim();
  if (!what) return null;
  switch (kind) {
    case "person":
    case "who":
      return person(chatId, what);
    case "records":
    case "record":
    case "data":
      return records(chatId, what);
    case "timeline":
    case "clock":
      return timeline(chatId);
    case "message":
    case "msg":
      return message(chatId, what);
    case "codex":
    case "entity":
      return codex(chatId, what);
    case "memories":
    case "memory":
      return memories(chatId, what);
    case "recall":
      return recallTopic(chatId, what);
    default:
      return search(chatId, what);
  }
}
