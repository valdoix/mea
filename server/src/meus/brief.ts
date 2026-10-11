import { lessonsFor } from "../steer/lessons";
import { all, parseJson } from "../db/db";
import { inboxCount } from "../accuracy/inbox";
import { getSetting } from "../lib/settings";
import { scanEntriesFor } from "../lore/service";
import { listJournals } from "../memory/journals";
import { chatNames } from "../memory/build";
import { duplicateSuggestions, listEntities } from "../memory/entities";
import { promises, secrets } from "../memory/ledgers";
import { storyRow } from "../memory/store";
import { cleanText } from "../memory/text";
import { type ChatSettings, mustChat } from "../services/chats";
import { layered } from "../services/layers";
import { formatStoryTime } from "../trackers/clock";
import { stateForModel } from "../trackers/prompts";
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
  ].filter(Boolean);
  if (steer.length) blocks.push(`HOW THE STORY IS STEERED:\n${steer.join("\n")}`);

  const recap = storyRow(chatId);
  if (recap?.content?.trim()) blocks.push(`THE STORY SO FAR (the running summary, to #${recap.end_seq}):\n${clip(recap.content.trim(), 2500)}`);

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
