import { lessonsFor } from "../steer/lessons";
import { listOffpage } from "../accuracy/offpage";
import { canonOf } from "../accuracy/canoncut";
import { all, parseJson } from "../db/db";
import { inboxCount } from "../accuracy/inbox";
import { originChanges } from "../services/versionsync";
import { chatMap, retellOptions } from "../services/versionchat";
import { getSetting } from "../lib/settings";
import { scanEntriesFor } from "../lore/service";
import { sinceCardPage } from "../lore/sincecard";
import { listJournals } from "../memory/journals";
import { chatNames } from "../memory/build";
import { duplicateSuggestions, listEntities } from "../memory/entities";
import { promises, secrets } from "../memory/ledgers";
import { lensOf, summaryText } from "../memory/openlist";
import { storyRow } from "../memory/store";
import { cleanText } from "../memory/text";
import { type ChatSettings, mustChat } from "../services/chats";
import { layered } from "../services/layers";
import { formatStoryTime } from "../trackers/clock";
import { correctMemory } from "../accuracy/corrections";
import { stateForModel } from "../trackers/prompts";
import { standing } from "../trackers/stands";
import { castKey, castProfiles, currentFold, foldConfigFor, templatesFor, trackerConfig } from "../trackers/store";
import type { WorldState } from "../trackers/types";

/**
 * What Meus always has in front of it in a chat: who is who (your persona, the card's character,
 * everyone else, by id), the scene now, the story's own settings and notes, the last messages, the
 * story so far, and a table of contents of everything else it can look up.
 */

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export interface BriefHeader {
  seq: number;
  time: string | null;
  place: string | null;
}

function stateOf(chatId: string): WorldState | null {
  try {
    return currentFold(chatId).result.state;
  } catch {
    return null;
  }
}

/** Who is who, said plainly: the player's persona is never the card's character. */
export function whoIsWho(chatId: string, st: WorldState | null) {
  const chat = mustChat(chatId);
  const names = chatNames(chatId);
  const narrator = chat.mode === "narrator";
  const L = [
    `WHO IS WHO (never mix these up):`,
    `- ${names.user} is the PLAYER'S PERSONA: the person the human you're talking to plays in this story ({{user}}). What ${names.user} says, feels and chooses belongs to the player. ${names.user} is not the character card.`,
    narrator
      ? `- The character card "${names.char}" is a NARRATOR: the AI tells the story and voices everyone except ${names.user}.`
      : `- ${names.char} is the CHARACTER CARD: the person the AI plays opposite ${names.user} ({{char}}).`,
    "- Everyone else in the cast is someone the story met; the AI voices them.",
  ];
  if (st) {
    const profiles = castProfiles(chatId);
    const people = Object.values(st.chars).sort((a, b) => Number(b.isUser) - Number(a.isUser) || Number(b.isMain) - Number(a.isMain) || b.lastSeq - a.lastSeq);
    L.push("THE CAST (name [id] · who · now):");
    for (const c of people.slice(0, 40)) {
      const role = c.isUser ? "the player's persona" : c.isMain ? (narrator ? "main character" : "the card's character") : "cast";
      const now = [c.dead ? "dead" : c.tier === "spot" ? "in the scene" : c.tier === "peri" ? "nearby" : "away", c.place, c.mood?.name ? `mood ${c.mood.name}` : "", c.activity].filter(Boolean).join(", ");
      const aka = c.aliases.length ? ` (also: ${c.aliases.slice(0, 5).join(", ")})` : "";
      const profile = profiles[castKey(c.name)]?.description;
      L.push(`- ${c.name}${aka} [${c.id}] · ${role} · ${now}${profile ? ` · ${clip(profile, 120)}` : ""}`);
    }
    if (people.length > 40) L.push(`- …and ${people.length - 40} more (look them up by name)`);
  }
  return L.join("\n");
}

/** The guidance chips, so "slow down" can switch on the right one. */
function guidanceLine(settings: ChatSettings) {
  const chips = getSetting("chat.guidance");
  if (!chips.length) return "";
  const on = new Set(settings.guidance?.active ?? []);
  const once = new Set(settings.guidance?.once ?? []);
  return `Guidance chips (name: what it asks${on.size || once.size ? "; ON = switched on" : ""}): ${chips.map((g) => `${g.name}${on.has(g.id) ? " (ON)" : once.has(g.id) ? " (next reply)" : ""}: ${clip(g.text, 80)}`).join(" | ")}`;
}

export function buildBrief(chatId: string): { text: string; header: BriefHeader } {
  const chat = mustChat(chatId);
  const settings = parseJson<ChatSettings>(chat.settings, {});
  const st = stateOf(chatId);
  const blocks: string[] = [whoIsWho(chatId, st)];

  if (st) {
    const fc = foldConfigFor(chatId);
    const cfg = trackerConfig(chatId);
    blocks.push(`THE STORY STATE NOW (the trackers' records, as ledger lines):\n${stateForModel(st, { userName: fc.userName, templates: templatesFor(cfg), sealed: cfg.sealed, calendar: cfg.calendar })}`);
    const { stands, happened } = standing(chatId, st);
    if (stands) blocks.push(`WHERE THINGS STAND:\n${stands}`);
    if (happened) blocks.push(`ALREADY HAPPENED:\n${happened}`);
  }

  // The story's own rules and notes, which Meus can also change.
  const layers = layered(settings, chat.character_id);
  const story = Object.entries(layers.story).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`);
  const steer = [
    story.length ? `Story settings: ${story.join("; ")}` : "",
    layers.truths.length ? `Story truths:\n${layers.truths.map((t) => `  - ${t}`).join("\n")}` : "",
    settings.ooc?.length ? `Standing OOC notes:\n${settings.ooc.map((o) => `  - ${o.text}`).join("\n")}` : "",
    settings.cue ? `Cue for the next reply: ${settings.cue}` : "",
    settings.length ? `Reply length: ${settings.length}` : "",
    settings.pacing ? `Pacing: ${settings.pacing}` : "",
    settings.authorsNote?.content ? `Author's note: ${clip(settings.authorsNote.content, 400)}` : "",
    guidanceLine(settings),
    lessonLines(chatId),
    offpageLines(chatId),
    canonLine(chatId),
  ].filter(Boolean);
  if (steer.length) blocks.push(`HOW THE STORY IS STEERED:\n${steer.join("\n")}`);

  // Since the card: who the character and persona are now, where the cards no longer say it.
  const since = sinceCardPage(chatId).people.filter((p) => p.lines.length);
  const sinceLine = (f: (typeof since)[number]["lines"][number]) => `  [${f.id}] ${f.slot ? `${f.slot}: ` : ""}${f.value}${f.locked ? " (yours)" : ""}`;
  if (since.length) blocks.push(`SINCE THE CARD (this chat's note on how they've changed; the cards stay as written; [line ids]):\n${since.map((p) => `${p.name} (${p.who}):\n${p.lines.map(sinceLine).join("\n")}`).join("\n")}`);

  const recap = storyRow(chatId);
  if (recap?.content?.trim()) blocks.push(`THE STORY SO FAR (the running summary, to #${recap.end_seq}):\n${correctMemory(st, clip(summaryText(recap, lensOf(chatId, st)), 2500), "Story So Far").text}`);

  const recent = all<{ seq: number; name: string | null; role: string; content: string; hidden: number }>(
    `SELECT m.seq, m.name, m.role, m.hidden, s.content FROM messages m JOIN swipes s ON s.message_id = m.id AND s.idx = m.active_swipe
     WHERE m.chat_id = ? AND m.deleted_at IS NULL ORDER BY m.seq DESC LIMIT 12`,
    chatId,
  ).reverse();
  const names = chatNames(chatId);
  const who = (m: { role: string; name: string | null }) => m.name ?? (m.role === "user" ? names.user : m.role === "assistant" ? names.char : m.role);
  if (recent.length) blocks.push(`THE LATEST MESSAGES (#number speaker: text):\n${recent.map((m) => `#${m.seq}${m.hidden ? " (hidden)" : ""} ${who(m)}: ${clip(cleanText(m.content).replace(/\s+/g, " "), 900)}`).join("\n")}`);

  // A table of contents of what it can look up.
  const toc: string[] = [];
  if (st) {
    const count = (o: object) => Object.keys(o).length;
    const open = Object.values(st.obligations).filter((o) => o.status === "open" || o.status === "due").length;
    toc.push(
      `cast ${count(st.chars)}`,
      `bonds ${count(st.bonds)}`,
      `facts and secrets ${count(st.facts)}`,
      `things ${count(st.items)}`,
      `threads ${Object.values(st.threads).filter((t) => t.status !== "resolved").length} open`,
      `promises and debts ${open} open`,
      `deadlines ${Object.values(st.deadlines).filter((d) => !d.done).length}`,
      `planted details ${Object.values(st.plants).filter((p) => !p.paidSeq).length} unpaid`,
      `clues ${st.clues.length}`,
      `calendar ${count(st.calendar)}`,
      `places ${count(st.places)}`,
    );
  }
  const codex = listEntities(chatId);
  const dupes = duplicateSuggestions(chatId);
  toc.push(`Codex pages ${codex.length}${dupes.length ? ` (${dupes.length} look like duplicates: ${dupes.slice(0, 5).map((d) => `${d.merge.name} ≈ ${d.keep.name}`).join(", ")})` : ""}`);
  toc.push(`memory ledgers: ${promises(chatId).length} promises, ${secrets(chatId).length} secrets`);
  const inbox = inboxCount(chatId);
  if (inbox) toc.push(`continuity inbox ${inbox} waiting`);
  // docs/14, part 6: the world this chat is set in (fix a leaked name with the message kind), and where it could be retold.
  const vmap = chatMap(chatId);
  if (vmap) {
    const moved = vmap.rows.filter((r) => r.from.trim() && (r.state === "changed" || r.state === "dropped"));
    if (moved.length) toc.push(`set in ${vmap.label}: ${moved.slice(0, 30).map((r) => (r.state === "dropped" ? `no ${r.from}` : `${r.from} → ${r.to}`)).join("; ")} (a reply using an original name is a leak)`);
  }
  try {
    const ro = retellOptions(chatId);
    if (ro.versions.length && ro.arcs.length) toc.push(`could be retold (kind retell) in: ${ro.versions.map((v) => (v.label ? `${v.name} (${v.label})` : v.name)).join(", ")}; arcs: ${ro.arcs.slice(0, 12).map((a) => `[${a.id}] ${a.title}`).join("; ")}`);
  } catch {
    // no character
  }
  // docs/14, part 5: this chat's card or persona is a version and its original changed.
  for (const [who, id] of [["character", chat.character_id], ["persona", chat.persona_id]] as const) {
    const changes = id ? originChanges(who, id) : [];
    if (changes.length) toc.push(`changes from the ${who}'s original (version_sync, who "${who}"): ${changes.map((x) => `[${x.key}] ${x.label} (${x.state === "kept" ? "kept the same, can take" : "changed for the version, translate on its page"})`).join("; ")}`);
  }
  if (st) {
    const arcs = Object.values(st.sim.arcs);
    const live = arcs.filter((a) => a.status === "running" || a.status === "held" || a.status === "fate");
    if (arcs.length || Object.keys(st.sim.proposals).length) toc.push(`world off the page: ${live.length} subplots${arcs.some((a) => a.fate) ? " (a fate is waiting)" : ""}, ${Object.keys(st.sim.proposals).length} proposals`);
  }
  const lore = scanEntriesFor({ characterId: chat.character_id, personaId: chat.persona_id, chatId });
  if (lore.length) toc.push(`lore: ${new Set(lore.map((e) => e.bookId)).size} books, ${lore.length} entries`);
  const journals = listJournals(chatId);
  if (journals.length) toc.push(`journals: ${journals.map((j) => j.name).join(", ")}`);
  blocks.push(`WHAT ELSE YOU CAN LOOK UP: ${toc.join(" · ")}`);

  const seq = recent.at(-1)?.seq ?? 0;
  return {
    text: blocks.join("\n\n"),
    header: { seq, time: st?.time ? formatStoryTime(st.time) : null, place: st?.place.length ? st.place.join(" › ") : null },
  };
}

/** A1: the lessons this story keeps (and suggests), with ids so Meus can switch them. */
function lessonLines(chatId: string) {
  try {
    const list = lessonsFor(chatId).filter((l) => l.status !== "rejected");
    if (!list.length) return "";
    return `Lessons (rules learned from the player's swipes and edits):\n${list
      .slice(0, 20)
      .map((l) => `  - [${l.id}] ${l.text} (${l.status === "kept" ? (l.resting ? "kept, resting" : "kept") : l.status}${l.scope !== "story" ? `, ${l.scope}` : ""})`)
      .join("\n")}`;
  } catch {
    return "";
  }
}

/** B1: secrets kept off the page, with ids so Meus can reveal or change them. */
function offpageLines(chatId: string) {
  try {
    const list = listOffpage(chatId);
    if (!list.length) return "";
    return `Secrets kept off the page (the narration doesn't state them yet):\n${list.map((o) => `  - [${o.id}] ${o.label}${o.neverSay.length ? ` · never say: ${o.neverSay.join(", ")}` : ""} (${o.status}${o.due ? ", ready to come out" : ""})`).join("\n")}`;
  } catch {
    return "";
  }
}

/** C1: the canon cutoff, briefly. */
function canonLine(chatId: string) {
  try {
    const c = canonOf(chatId);
    if (!c.source?.trim() && !c.later?.length && !c.wont?.length) return "";
    return `Canon cutoff: ${c.source ?? "?"}${c.point ? `, at ${c.point}` : ""}${c.later?.length ? `; hasn't happened yet: ${c.later.map((i) => i.text).slice(0, 15).join("; ")}` : ""}${c.wont?.length ? `; won't happen here: ${c.wont.map((w) => w.text).join("; ")}` : ""}`;
  } catch {
    return "";
  }
}
