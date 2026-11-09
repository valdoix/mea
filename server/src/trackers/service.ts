import { all, one, parseJson, run } from "../db/db";
import { publish } from "../lib/events";
import { badRequest } from "../lib/http";
import { dropAtoms, insertAtom, isDuplicate } from "../memory/atoms";
import { norm } from "../memory/entities";
import { namedFacts } from "../memory/named";
import { touchMemory } from "../memory/store";
import { noteFactions } from "./factions";
import { detectBoundary } from "../memory/segment";
import { cleanText } from "../memory/text";
import { getCard } from "../services/characters";
import { addMessage, type ChatSettings, getMessageRow, getSwipes, lastMessage, type LedgerChange, mustChat, updateChat, updateSwipe } from "../services/chats";
import { enqueue, type JobContext } from "../services/jobs";
import { callText } from "../services/llm";
import { storyDials } from "../services/layers";
import { getDefaultPersona, getPersona, personaPrompt } from "../services/personas";
import { describeMinutes, parseDuration } from "./clock";
import { parseLedger } from "./dsl";
import { groupReach } from "./fold";
import { closingOps } from "./loops";
import { quietPeople } from "./stillhere";
import { buildNote, type NoteResult } from "./note";
import { initPrompt, inlineInstruction, stateForModel, updatePrompt } from "./prompts";
import {
  branchEvents,
  castProfiles,
  currentFold,
  eventsOf,
  foldAt,
  foldConfigFor,
  hasBase,
  hasEvents,
  linesToOps,
  notThereNames,
  onTrackerLedgerEdit,
  type ResolvedTrackerConfig,
  templatesFor,
  trackerConfig,
  writeEvents,
} from "./store";
import { AXES, type Change, METERS, type Op, type WorldState } from "./types";
import { momentsOf } from "./moments";

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

// ---------- scheduling (TRK-03, TRK-08) ----------

/** After a reply is written: queue a tracker update per the chat's cadence. Never in the way of reading. */
export function scheduleTrackers(chatId: string, messageId: string, swipeIdx: number) {
  const cfg = trackerConfig(chatId);
  if (cfg.mode === "off" || cfg.cadence === "manual") return;
  if (!hasBase(chatId)) enqueue("tracker.init", { chatId }, { dedupeKey: `tracker.init:${chatId}`, priority: 6, chatId });
  if (cfg.mode === "inline" && hasEvents(chatId, messageId, swipeIdx, ["inline"])) return;
  if (cfg.cadence === "everyN") {
    const pending = repliesSinceUpdate(chatId, messageId);
    if (pending < cfg.everyN) return;
  }
  if (cfg.cadence === "scene" && !sceneTurned(chatId, messageId) && repliesSinceUpdate(chatId, messageId) < 6) return;
  enqueue("tracker.update", { chatId, messageId, swipeIdx }, { dedupeKey: `tracker.update:${messageId}:${swipeIdx}`, priority: 5, chatId });
  publish({ type: "trackers.changed", chatId, running: true });
}

/** Assistant replies after the last one the trackers read, up to and including this one. */
function repliesSinceUpdate(chatId: string, messageId: string) {
  const msgs = all<{ id: string; role: string; seq: number; active_swipe: number }>(
    "SELECT id, role, seq, active_swipe FROM messages WHERE chat_id = ? AND deleted_at IS NULL AND seq <= (SELECT seq FROM messages WHERE id = ?) ORDER BY seq DESC LIMIT 40",
    chatId,
    messageId,
  );
  let n = 0;
  for (const m of msgs) {
    if (m.role !== "assistant") continue;
    if (m.id !== messageId && hasEvents(chatId, m.id, m.active_swipe)) break;
    n++;
  }
  return n;
}

function sceneTurned(chatId: string, messageId: string) {
  const rows = all<{ seq: number; content: string; created_at: number }>(
    `SELECT m.seq, s.content, m.created_at FROM messages m JOIN swipes s ON s.message_id = m.id AND s.idx = m.active_swipe
     WHERE m.chat_id = ? AND m.deleted_at IS NULL AND m.seq <= (SELECT seq FROM messages WHERE id = ?) ORDER BY m.seq DESC LIMIT 2`,
    chatId,
    messageId,
  );
  if (rows.length < 2) return true;
  const [cur, prev] = rows;
  return Boolean(detectBoundary({ seq: prev!.seq, content: prev!.content, createdAt: prev!.created_at }, { seq: cur!.seq, content: cur!.content, createdAt: cur!.created_at }, { pauseHours: 6 }));
}

// ---------- the update job ----------

/** The messages a tracker update reads: everything since the last message the trackers covered (at most 8). */
function messagesFor(chatId: string, messageId: string, names: { user: string; char: string }) {
  const target = getMessageRow(messageId);
  if (!target) return null;
  const rows = all<{ id: string; seq: number; role: string; name: string | null; active_swipe: number; content: string }>(
    `SELECT m.id, m.seq, m.role, m.name, m.active_swipe, s.content FROM messages m JOIN swipes s ON s.message_id = m.id AND s.idx = m.active_swipe
     WHERE m.chat_id = ? AND m.deleted_at IS NULL AND m.hidden = 0 AND m.seq <= ? ORDER BY m.seq DESC LIMIT 12`,
    chatId,
    target.seq,
  );
  const picked: typeof rows = [];
  for (const r of rows) {
    if (r.id !== messageId && r.role === "assistant" && hasEvents(chatId, r.id, r.active_swipe)) break;
    picked.unshift(r);
    if (picked.length >= 8) break;
  }
  return picked
    .map((r) => {
      const who = r.role === "user" ? names.user : r.role === "assistant" ? r.name || names.char : "Note";
      // Whole messages: what changes often comes at the end of a long reply (a reveal, a death, a kiss).
      return `[#${r.seq}] ${who}: ${cleanText(r.content)}`;
    })
    .join("\n\n");
}

/**
 * docs/31 1.3: once you've said twice that someone wasn't there, the tracker hears about it. (A lesson
 * would go to the story model, which didn't make the mistake.)
 */
export function notThereReminder(chatId: string): string | undefined {
  const names = notThereNames(chatId);
  if (names.length < 2) return undefined;
  return `CORRECTIONS: in this story, know lines gave things to people who weren't there (${names.slice(0, 6).join(", ")}). Only the people in the scene hear what's said in it: name each of them, and someone elsewhere only with how it reached them (a call, a text).`;
}

export async function runTrackerUpdate(p: { chatId: string; messageId: string; swipeIdx: number }, job?: JobContext) {
  const msg = getMessageRow(p.messageId);
  if (!msg || msg.deleted_at || msg.active_swipe !== p.swipeIdx) return;
  const swipe = getSwipes(p.messageId).find((s) => s.idx === p.swipeIdx);
  if (!swipe || swipe.status === "streaming" || swipe.status === "error" || !swipe.content.trim()) return;
  const cfg = trackerConfig(p.chatId);
  if (cfg.mode === "off") return;
  const fc = foldConfigFor(p.chatId, cfg);
  const before = foldAt(p.chatId, { uptoSeq: msg.seq - 1 }).state;
  const messages = messagesFor(p.chatId, p.messageId, { user: fc.userName, char: fc.mainName });
  if (!messages) return;
  // docs/31 Part 3: who the scene has but the story hasn't named in a while, before this reply.
  const quiet = quietPeople(p.chatId, before, { uptoSeq: msg.seq - 1 }).map((q) => q.name);

  // No "nothing changed" gate: every reply gets its people's private thoughts, so every reply is read.
  const { system, user } = updatePrompt({
    state: stateForModel(before, { userName: fc.userName, templates: fc.templates, sealed: cfg.sealed, calendar: cfg.calendar, quiet }),
    messages,
    userName: fc.userName,
    charName: fc.mainName,
    sealed: cfg.sealed,
    romance: cfg.romance,
    extra: notThereReminder(p.chatId),
  });
  const res = await callText({
    task: "tracker",
    kind: "tracker",
    chatId: p.chatId,
    jobId: job?.id,
    system,
    user,
    maxTokens: 1600,
    validate: (t) => (parseLedger(t).ops.length ? null : "That had no ledger lines. Write one change per line, like: clock: +5m"),
  });
  job?.note({ inputTokens: res.inputTokens });
  const parsed = parseLedger(res.text);
  // The message may have been swiped or edited while the model was writing.
  const now = getMessageRow(p.messageId);
  if (!now || now.deleted_at || now.active_swipe !== p.swipeIdx) return;
  writeEvents(p.chatId, { messageId: p.messageId, swipeIdx: p.swipeIdx }, groupReach(closingOps(parsed.ops, messages), before, fc, messages, quiet), "model", { replace: ["model"] });
  afterUpdate(p.chatId, p.messageId, p.swipeIdx);
}

/**
 * Significant changes become memories (TRK-13); the off-page world takes its turn. `swipeIdx` is the
 * version the trackers just read (H6: the world's turn belongs to it); none for your edits and time skips.
 */
export function afterUpdate(chatId: string, messageId: string, swipeIdx?: number) {
  syncTrackerMemories(chatId, messageId);
  for (const h of afterUpdateHooks) {
    try {
      h(chatId, messageId, swipeIdx);
    } catch (e) {
      console.error("[mea] tracker hook failed:", e);
    }
  }
}

type AfterUpdateHook = (chatId: string, messageId: string, swipeIdx?: number) => void;
const afterUpdateHooks: AfterUpdateHook[] = [];
/** The world simulation registers here to tick once the story clock has moved. */
export function onTrackerUpdate(fn: AfterUpdateHook) {
  afterUpdateHooks.push(fn);
}

/** H5: how sure a memory the trackers made is (M31: they're marked by origin, not by this). */
const TRACKER_CONFIDENCE = 0.85;
const changeContent = (c: Change) => `${c.text}${c.reason ? ` (${c.reason})` : ""}`.replace(/\s+/g, " ").trim();

/**
 * H5: the memories the trackers made from a message follow the version of it the story shows now.
 * Ones its fold no longer has go (a swipe, an edit read again, a delete); ones it has come (back).
 * Memories you edited or pinned stay.
 */
export function syncTrackerMemories(chatId: string, messageId: string) {
  const own = all<{ id: string; content: string; swipe_idx: number | null }>(
    `SELECT m.id, m.content, m.swipe_idx FROM memories m WHERE m.chat_id = ? AND m.origin = 'tracker' AND m.user_edited = 0 AND m.pinned = 0
       AND EXISTS (SELECT 1 FROM memory_sources s WHERE s.memory_id = m.id AND s.message_id = ?)`,
    chatId,
    messageId,
  );
  if (!own.length && !one("SELECT 1 FROM tracker_events WHERE message_id = ?", messageId)) return;
  const msg = getMessageRow(messageId);
  const wanted = msg && !msg.deleted_at ? (currentFold(chatId).result.changes[messageId] ?? []).filter((c) => c.memory && c.source !== "user" && c.source !== "init") : [];
  const keep = new Set(wanted.map(changeContent));
  const gone = own.filter((a) => !keep.has(a.content));
  if (gone.length) dropAtoms(`id IN (${gone.map(() => "?").join(",")})`, ...gone.map((a) => a.id));
  // Ones the swipe shown now has too follow it (M31: the swipe they belong to).
  const kept = own.filter((a) => keep.has(a.content) && a.swipe_idx !== msg!.active_swipe);
  if (kept.length) run(`UPDATE memories SET swipe_idx = ? WHERE id IN (${kept.map(() => "?").join(",")})`, msg!.active_swipe, ...kept.map((a) => a.id));
  const have = new Set(own.map((a) => a.content));
  let added = 0;
  for (const c of wanted) if (!have.has(changeContent(c)) && rememberChange(chatId, c, { id: messageId, seq: msg!.seq, swipeIdx: msg!.active_swipe })) added++;
  if (gone.length || added) touchMemory(chatId);
}

function rememberChange(chatId: string, c: Change, source: { id: string; seq: number; swipeIdx: number }) {
  const content = changeContent(c);
  if (isDuplicate(chatId, content)) return false;
  const type = c.kind === "bond" || c.kind === "romance" ? "relationship" : c.kind === "promise" ? "promise" : c.kind === "secret" ? "secret" : "event";
  insertAtom(chatId, null, { type, content, entities: c.subject ? [c.subject] : [], importance: c.kind === "death" || c.kind === "romance" ? 9 : 7, confidence: TRACKER_CONFIDENCE, origin: "tracker", swipeIdx: source.swipeIdx },
    [{ id: source.id, seq: source.seq }],
  );
  return true;
}

// ---------- starting state (TRK-09) ----------

export async function runTrackerInit(p: { chatId: string }, job?: JobContext) {
  if (hasBase(p.chatId)) return;
  const chat = mustChat(p.chatId);
  const cfg = trackerConfig(p.chatId);
  if (cfg.mode === "off") return;
  const card = chat.character_id ? getCard(chat.character_id) : undefined;
  if (!card) return;
  const persona = getPersona(chat.persona_id) ?? getDefaultPersona();
  const greeting = one<{ content: string }>(
    "SELECT s.content FROM messages m JOIN swipes s ON s.message_id = m.id AND s.idx = m.active_swipe WHERE m.chat_id = ? AND m.deleted_at IS NULL ORDER BY m.seq LIMIT 1",
    p.chatId,
  );
  const fc = foldConfigFor(p.chatId, cfg);
  const { system, user } = initPrompt({
    userName: fc.userName,
    charName: card.name,
    card: clip([card.description, card.personality && `Personality: ${card.personality}`, card.scenario && `Scenario: ${card.scenario}`].filter(Boolean).join("\n\n"), 12000),
    persona: clip(personaPrompt(persona), 3000),
    greeting: clip(cleanText(greeting?.content ?? ""), 6000),
    templates: fc.templates,
    sealed: cfg.sealed,
    calendar: cfg.calendar,
  });
  const res = await callText({ task: "tracker", kind: "tracker:start", chatId: p.chatId, jobId: job?.id, system, user, maxTokens: 1500, validate: (t) => (parseLedger(t).ops.length ? null : "That had no ledger lines.") });
  job?.note({ inputTokens: res.inputTokens });
  if (hasBase(p.chatId)) return;
  writeEvents(p.chatId, { messageId: null, swipeIdx: 0 }, parseLedger(res.text).ops, "init");
}

// ---------- inline ledgers ----------

/**
 * Inline mode: the story model wrote a <ledger> after its reply (generation takes it out of the
 * message and keeps it in the swipe's meta). It's filed here; a reply without one gets a helper pass.
 */
export function fileInlineLedger(chatId: string, messageId: string, swipeIdx: number, ledger: string | null) {
  const parsed = ledger ? parseLedger(ledger) : null;
  if (parsed?.ops.length) {
    // Who its group lines reached: the reply and the message it answers.
    const msg = getMessageRow(messageId);
    const cfg = trackerConfig(chatId);
    const text = msg ? messagesFor(chatId, messageId, { user: "", char: "" }) : null;
    const before = msg ? foldAt(chatId, { uptoSeq: msg.seq - 1 }).state : null;
    const ops = msg && before && text != null ? groupReach(parsed.ops, before, foldConfigFor(chatId, cfg), text, quietPeople(chatId, before, { uptoSeq: msg.seq - 1 }).map((q) => q.name)) : parsed.ops;
    writeEvents(chatId, { messageId, swipeIdx }, ops, "inline", { replace: ["inline", "model"] });
    afterUpdate(chatId, messageId, swipeIdx);
  } else enqueue("tracker.update", { chatId, messageId, swipeIdx }, { dedupeKey: `tracker.update:${messageId}:${swipeIdx}`, priority: 5, chatId });
}

// ---------- your edits (TRK-05) ----------

/** Lines you wrote (or the panel wrote for you): anchored to the newest message, on every swipe of it. */
export function userEdit(chatId: string, ops: Op[]) {
  userEditAt(chatId, ops);
  return currentFold(chatId).result;
}

/**
 * Your edit lines, anchored to the newest message (on every swipe of it), or to an earlier one
 * when a correction holds from that point on ("the time went wrong at #180"). Returns the event ids.
 */
export function userEditAt(chatId: string, ops: Op[], messageId?: string | null) {
  mustChat(chatId);
  const anchor = messageId ?? lastMessage(chatId)?.id ?? null;
  return writeEvents(chatId, { messageId: anchor, swipeIdx: anchor ? -1 : 0 }, ops, "user");
}

// ---------- episode breaks (docs/23, part 8) ----------

/**
 * The tracker lines that put the story back to its status quo (Writer's Block's episodic mode):
 * injuries heal, conditions clear, meters, moods, bonds and romance rungs return to the baseline.
 * People, places, items, facts and threads stay; so does a death.
 */
export function episodeLines(cur: WorldState, base: WorldState): string[] {
  const lines: string[] = [];
  const why = " — a new episode";
  for (const c of Object.values(cur.chars)) {
    if (c.dead) continue;
    const b = base.chars[c.id];
    const body: string[] = [];
    for (const i of c.injuries) if (!b?.injuries.some((x) => x.where === i.where)) body.push(`healed: ${i.where}`);
    for (const k of c.conditions) if (!b?.conditions.some((x) => x.text === k.text)) body.push(`no longer ${k.text}`);
    if (b) {
      for (const m of METERS) {
        const now = c.meters[m];
        const was = b.meters[m];
        if (now != null && was != null && now !== was) body.push(`${m} ${now} → ${was}`);
      }
    }
    if (body.length) lines.push(`body ${c.name}: ${body.join("; ")}`);
    if (b?.mood && c.mood?.name !== b.mood.name) lines.push(`mood ${c.name}: ${c.mood?.name ?? "none"} → ${b.mood.name}`);
  }
  const nameOf = (id: string) => cur.chars[id]?.name;
  for (const [key, bond] of Object.entries(cur.bonds)) {
    const from = nameOf(bond.from);
    const to = nameOf(bond.to);
    if (!from || !to) continue;
    const was = base.bonds[key]?.axes ?? {};
    const moves = AXES.filter((a) => (bond.axes[a] ?? 0) !== (was[a] ?? 0)).map((a) => `${a} ${bond.axes[a] ?? 0} → ${was[a] ?? 0}`);
    if (moves.length) lines.push(`bond ${from}>${to}: ${moves.join("; ")}${why}`);
  }
  for (const [key, ladder] of Object.entries(cur.ladders)) {
    const [a, b] = key.split(">");
    const from = nameOf(a!);
    const to = nameOf(b!);
    const was = base.ladders[key]?.tier ?? 0;
    if (from && to && ladder.tier !== was) lines.push(`ladder ${from}>${to}: ${was}${why}`);
  }
  return lines;
}

/** "/episode": a marker, and the status quo restored from the story's opening (or the baseline the first break kept). */
export function newEpisode(chatId: string, title?: string) {
  const settings = parseJson<ChatSettings>(mustChat(chatId).settings, {});
  const opening = one<{ seq: number }>("SELECT MIN(seq) AS seq FROM messages WHERE chat_id = ? AND role = 'assistant' AND deleted_at IS NULL", chatId)?.seq;
  if (opening == null) throw badRequest("There's no story yet to start a new episode of");
  const baselineSeq = settings.episodes?.baselineSeq ?? opening;
  const n = (settings.episodes?.n ?? 1) + 1;
  const base = foldAt(chatId, { uptoSeq: baselineSeq }).state;
  const lines = episodeLines(currentFold(chatId).result.state, base);
  const messageId = addMessage(chatId, "system", `*Episode ${n}${title?.trim() ? `: ${title.trim()}` : ""}*`, { name: "New episode", meta: { episode: n } });
  const { ops } = linesToOps(lines);
  if (ops.length) writeEvents(chatId, { messageId, swipeIdx: -1 }, ops, "user");
  updateChat(chatId, { settings: { episodes: { baselineSeq, n } } });
  afterUpdate(chatId, messageId);
  return { messageId, episode: n, restored: lines.length };
}

// ---------- time skips (TRK-10) ----------

/** "/timeskip 3 days": the clock moves (bodies drift with it), the story gets a marker, trackers catch up. */
/** F2: "until evening", "until morning", "next day": how long from the story's clock. */
const UNTIL: Record<string, number> = { dawn: 6 * 60, morning: 8 * 60, noon: 12 * 60, afternoon: 14 * 60, evening: 18 * 60, dusk: 19 * 60, night: 22 * 60, midnight: 24 * 60 };
export function untilMinutes(text: string, now: number | null): number | null {
  const t = text.trim().toLowerCase();
  if (/^(the )?next day$/.test(t)) return 1440;
  const m = t.match(/^until (?:the )?(dawn|morning|noon|afternoon|evening|dusk|night|midnight)$/);
  if (!m) return null;
  if (now == null) throw badRequest("The story has no time yet: skip by a length, like “3 hours”");
  const at = UNTIL[m[1]!]!;
  const into = now % 1440;
  return at > into ? at - into : at + 1440 - into;
}

export function timeskip(chatId: string, durationText: string, note?: string) {
  const st = currentFold(chatId).result.state;
  const minutes = untilMinutes(durationText, st.time?.minutes ?? null) ?? parseDuration(durationText);
  if (!minutes || minutes <= 0) throw badRequest('Write how long, like "3 days", "2 hours" or "a week"');
  const text = `*${describeMinutes(minutes).replace(/^1 days/, "One day")} later.*${note?.trim() ? ` ${note.trim()}` : ""}`;
  const messageId = addMessage(chatId, "system", text, { name: "Time skip", meta: { timeskip: minutes } });
  const ops: Op[] = st.time ? [{ op: "clock", args: { plus: minutes }, raw: `clock: +${minutes}m` }] : [];
  writeEvents(chatId, { messageId, swipeIdx: -1 }, ops, "timeskip");
  afterUpdate(chatId, messageId);
  return { messageId, minutes };
}

// ---------- the prompt (TRK-06) ----------

export interface TrackerPromptParts {
  note: NoteResult | null;
  inline: string | null;
  state: WorldState;
  config: ResolvedTrackerConfig;
}

export function trackerPrompt(chatId: string, opts: { excludeMessageId?: string; kind: string; elsewhere?: string; focus?: string }): TrackerPromptParts {
  const cfg = trackerConfig(chatId);
  const fold = opts.excludeMessageId ? foldAt(chatId, { excludeMessageId: opts.excludeMessageId }) : currentFold(chatId).result;
  const state = fold.state;
  if (cfg.mode === "off") return { note: null, inline: null, state, config: cfg };
  const fc = foldConfigFor(chatId, cfg);
  const profiles = castProfiles(chatId);
  const voices: Record<string, string> = {};
  const pinned: { name: string; text: string }[] = [];
  for (const [k, p] of Object.entries(profiles)) {
    if (p.voice) voices[k] = p.voice;
    if (p.pinned && p.description) pinned.push({ name: p.name, text: p.description });
  }
  const seq = one<{ s: number | null }>("SELECT MAX(seq) AS s FROM messages WHERE chat_id = ? AND deleted_at IS NULL", chatId)?.s ?? 0;
  const cast = new Set(Object.values(state.chars).flatMap((c) => [c.name, ...c.name.split(/\s+/), ...c.aliases]).map(norm));
  const replacing = opts.excludeMessageId ? one<{ seq: number }>("SELECT seq FROM messages WHERE id = ?", opts.excludeMessageId)?.seq : undefined;
  const note = buildNote(state, {
    userName: fc.userName,
    budget: cfg.budget,
    named: namedFacts(chatId, opts.focus, replacing ?? seq, cast, 2, state),
    seq,
    quietAfter: cfg.quietAfter,
    templates: fc.templates,
    sections: cfg.sections,
    voices,
    pinned,
    factions: noteFactions(chatId, state),
    nudges: cfg.nudges,
    elsewhere: opts.elsewhere,
    calendar: cfg.calendar,
    season: cfg.season,
    persona: storyDials(mustChat(chatId)).persona,
    kind: opts.kind,
    focus: opts.focus,
    moment: momentsOf(chatId),
  });
  const inline =
    cfg.mode === "inline" && (opts.kind === "story" || opts.kind === "continue") ? inlineInstruction(stateForModel(state, { userName: fc.userName, templates: templatesFor(cfg), sealed: cfg.sealed, calendar: cfg.calendar, quiet: quietPeople(chatId, state).map((q) => q.name) }), notThereReminder(chatId)) : null;
  return { note: note.text ? note : null, inline, state, config: cfg };
}

/**
 * A message changed (edit, delete, restore, swipe, hide): the fold is recomputed. An edited reply
 * whose tracker lines are older than its text is read again (TRK-04: edits roll state back).
 */
export function trackerLedgerHook(chatId: string, messageId: string, change?: LedgerChange) {
  // M20: fold snapshots before the message stay good (a restore names its earliest message; a rewind, where it ends).
  const at = one<{ seq: number }>("SELECT seq FROM messages WHERE id = ?", messageId)?.seq;
  onTrackerLedgerEdit(chatId, at == null ? undefined : change?.rewoundTo != null ? Math.min(at, change.rewoundTo + 1) : at);
  // H5: memories made from these messages follow them (a rewind drops the ones of the messages it took).
  if (change?.rewoundTo != null) {
    for (const r of all<{ message_id: string }>(
      `SELECT DISTINCT s.message_id FROM memory_sources s JOIN memories mm ON mm.id = s.memory_id JOIN messages m ON m.id = s.message_id
       WHERE mm.chat_id = ? AND mm.origin = 'tracker' AND m.deleted_at IS NOT NULL`,
      chatId,
    ))
      syncTrackerMemories(chatId, r.message_id);
  }
  for (const id of change?.restored ?? [messageId]) syncTrackerMemories(chatId, id);
  const m = getMessageRow(messageId);
  if (!m || m.deleted_at || m.role !== "assistant") return;
  const swipe = getSwipes(messageId).find((s) => s.idx === m.active_swipe);
  if (!swipe || swipe.status !== "done") return;
  const newest = one<{ t: number | null }>("SELECT MAX(created_at) AS t FROM tracker_events WHERE message_id = ? AND swipe_idx = ? AND source IN ('model', 'inline')", messageId, m.active_swipe)?.t;
  if (newest != null && swipe.updated_at > newest + 1000) {
    enqueue("tracker.update", { chatId, messageId, swipeIdx: m.active_swipe }, { dedupeKey: `tracker.update:${messageId}:${m.active_swipe}`, priority: 5, chatId });
  }
}

export { branchEvents, eventsOf };
