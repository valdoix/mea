import { all, one, parseJson } from "../db/db";
import { textBasis } from "../lore/facts";
import { publish } from "../lib/events";
import { customOf } from "../trackers/customcal";
import { trackerConfig } from "../trackers/store";
import { badRequest, notFound } from "../lib/http";
import { getSetting } from "../lib/settings";
import { categoryOf, currentTitle, isCurrent, loreTitle } from "../lore/format";
import { scanEntriesFor } from "../lore/service";
import { getCard } from "../services/characters";
import { type ChatSettings, lastMessage, mustChat } from "../services/chats";
import { enqueue, type JobContext } from "../services/jobs";
import { callJson } from "../services/llm";
import { formatStoryTime } from "../trackers/clock";
import { slug } from "../trackers/fold";
import { castKey, castProfiles, currentFold, deleteEvents, foldConfigFor, saveCastProfile, writeEvents } from "../trackers/store";
import type { Op, WorldState } from "../trackers/types";
import { confirmArrivals, elsewhereLane } from "./crossings";
import { type Personality, PERSONALITIES } from "./director";
import { kindFromText, SPECS } from "./grammar";
import { buildRoster, lorePersonName, type Roster, samePerson, TIE_STRENGTH } from "./roster";
import { checkRead, saveSheet, sheetKey, sheetPrompt, sheetSchema, sheetsFor } from "./sheet";
import { climateFrom, forecast, latitudeFrom, placeClimate, skyLine, type SkyInput } from "./sky";
import { type BeatCard, canStep, consequences, forcedStep, MODES, newArc, pastCard, type SimMode, type Situation, tick, type TickInput } from "./storyteller";
import { retellPrompt, softProblem, tellingPrompt, tellingSchema, validateTelling } from "./telling";
import { tidyWording, validateWording, type WordingCard, wordingPrompt, wordingSchema } from "./wording";
import type { Arc, EndResult, Force, SimOp, Standing } from "./types";
import { bearingsOn, conditionsFor, eventsOf, peopleOf, pullWords, webMod } from "./web";

export interface ResolvedWorldConfig {
  mode: "off" | SimMode;
  director: Personality;
  telling: "model" | "engine";
  seeding: "auto" | "ask" | "off";
  fates: "page" | "ask" | "allow";
  view: "director" | "surprise";
  climate: string;
  latitude: number;
  /** The climate comes from the story (no setting of yours); the view offers it as "Automatic". */
  climateAuto: boolean;
  tech: "modern" | "historic" | "fantasy" | "future";
  genres: string[];
  step: number;
}

function detectTech(text: string): ResolvedWorldConfig["tech"] {
  if (/\b(spaceship|starship|android|cyber\w*|hologram|laser|space station|colony ship|ai core)\b/i.test(text)) return "future";
  if (/\b(phone|car|computer|internet|text message|apartment|subway|laptop|tv|television|email|university|office)\b/i.test(text)) return "modern";
  if (/\b(magic|kingdom|sword|dragon|castle|wizard|witch|elf|elves|dwarf|raven|knight|tavern|realm)\b/i.test(text)) return "fantasy";
  if (/\b(carriage|corset|duke|duchess|regency|victorian|candle|letter|manor)\b/i.test(text)) return "historic";
  return "modern";
}

export function worldConfig(chatId: string): ResolvedWorldConfig {
  const chat = mustChat(chatId);
  const s = parseJson<ChatSettings>(chat.settings, {});
  const own = s.world ?? {};
  const d = getSetting("world.defaults");
  const card = chat.character_id ? getCard(chat.character_id) : undefined;
  const cardText = card ? `${card.description} ${card.scenario}` : "";
  // Where the story is: the card, the canon it's based on, and the lore that's always on (the timeline, what's happening now).
  const setup = parseJson<{ answers?: { canon?: { source?: string; point?: string } } } | null>((chat as { chat_setup?: string | null }).chat_setup ?? null, null);
  const always = scanEntriesFor({ characterId: chat.character_id, personaId: chat.persona_id, chatId })
    .filter((e) => e.enabled && (e.constant || isCurrent(e)))
    .map((e) => e.content)
    .join(" ");
  const place = placeClimate(`${cardText} ${setup?.answers?.canon?.source ?? ""} ${setup?.answers?.canon?.point ?? ""} ${always}`);
  // docs/17, 5.2: a Climate entry says what the weather is like here, so it wins over the guess.
  const lore = climateEntry(chatId, `${cardText} ${always}`);
  const genres = own.genres?.length ? own.genres : (s.story?.genre ?? "").split(/\s*[,/&]\s*|\s+and\s+/).filter(Boolean);
  return {
    mode: own.mode ?? d.mode,
    director: own.director ?? d.director,
    telling: own.telling ?? d.telling,
    seeding: own.seeding ?? d.seeding,
    fates: own.fates ?? d.fates,
    view: own.view ?? d.view,
    climate: own.climate || (lore ? climateFrom(lore) : "") || place?.climate || climateFrom(cardText),
    latitude: own.latitude ? latitudeFrom(own.latitude, { typed: true }) : lore && /°|latitude/i.test(lore) ? latitudeFrom(lore) : (place?.latitude ?? latitudeFrom(cardText)),
    climateAuto: !own.climate,
    tech: own.tech ?? detectTech(cardText),
    genres,
    step: own.step ?? d.step,
  };
}

/**
 * The lore's Climate entry for where the story is (the one whose names the story uses most, else the
 * first), as text the climate is read from; null without one.
 */
function climateEntry(chatId: string, where: string): string | null {
  const chat = mustChat(chatId);
  const all = scanEntriesFor({ characterId: chat.character_id, personaId: chat.persona_id, chatId }).filter((e) => e.enabled && e.content.trim() && categoryOf(e) === "climate");
  if (!all.length) return null;
  const t = where.toLowerCase();
  const named = (e: (typeof all)[number]) => [loreTitle(e), ...e.keys].filter((k) => k.trim().length >= 3).reduce((n, k) => n + t.split(k.toLowerCase()).length - 1, 0);
  return [...all].sort((a, b) => named(b) - named(a))[0]!.content;
}

/**
 * How things stand right now: the lorebooks' CURRENT entries, once each when merged books repeat
 * one, and (docs/17, 5.2) their Hooks, which the storyteller offers and never starts on its own.
 */
function loreSituations(chatId: string): Situation[] {
  const chat = mustChat(chatId);
  const out = new Map<string, Situation>();
  for (const e of scanEntriesFor({ characterId: chat.character_id, personaId: chat.persona_id, chatId })) {
    if (!e.enabled || !e.content.trim()) continue;
    const hook = categoryOf(e) === "hook";
    if (!hook && !isCurrent(e)) continue;
    const title = hook ? loreTitle(e).replace(/^hook\s*[:—-]\s*/i, "").trim() : currentTitle(e);
    const key = title.toLowerCase();
    if (title && !out.has(key)) out.set(key, { key, title, text: e.content.trim().slice(0, 1200), ...(hook ? { hook: true } : {}) });
  }
  return [...out.values()];
}

/** docs/17, 5.2: the schedule lines of the lore's Routine entries ("dawn: Mira Vell, at the tower"). */
function loreSchedules(chatId: string): string[] {
  const chat = mustChat(chatId);
  return scanEntriesFor({ characterId: chat.character_id, personaId: chat.persona_id, chatId })
    .filter((e) => e.enabled && categoryOf(e) === "routine")
    .flatMap((e) => {
      const parts = (e.extra as { parts?: { schedule?: string[] | string } } | undefined)?.parts?.schedule;
      return parts ? (Array.isArray(parts) ? parts : [parts]) : e.content.split("\n").filter((l) => /^\s*[-•]/.test(l));
    })
    .slice(0, 80);
}

/** People the lorebooks describe (a "Name", "Name - role" or "Character: Name" entry about a person), and the rest of the lore's text. */
function lorePeople(chatId: string): { people: { name: string; text: string }[]; notes: string[] } {
  const chat = mustChat(chatId);
  const people: { name: string; text: string }[] = [];
  const notes: string[] = [];
  for (const e of scanEntriesFor({ characterId: chat.character_id, personaId: chat.persona_id, chatId })) {
    if (!e.enabled) continue;
    const name = lorePersonName(e);
    if (!name) {
      if (notes.length < 200) notes.push(e.content.slice(0, 2000));
      continue;
    }
    if (people.length < 60) people.push({ name, text: e.content.slice(0, 1200) });
    else notes.push(e.content.slice(0, 2000));
  }
  return { people, notes };
}

export function rosterFor(chatId: string, state: WorldState): Roster {
  const fc = foldConfigFor(chatId);
  const { people, notes } = lorePeople(chatId);
  return buildRoster({ state, profiles: castProfiles(chatId), lore: people, notes, userName: fc.userName, schedules: loreSchedules(chatId), sheets: sheetsFor(chatId) });
}

// ---------- the person sheet (docs/21 Part 2) ----------

const SHEET_BATCH = 20;
/** Bumped when the reading asks for more (2: ties), so everyone is read again once. */
const SHEET_VERSION = 2;

/** The people whose lore hasn't been read yet, or has changed since (their text, and its hash). */
export function sheetsToRead(chatId: string, st: WorldState = currentFold(chatId).result.state): { name: string; text: string; basis: string }[] {
  const fc = foldConfigFor(chatId);
  const { people } = lorePeople(chatId);
  const roster = buildRoster({ state: st, profiles: castProfiles(chatId), lore: people, userName: fc.userName });
  const have = sheetsFor(chatId);
  return [...roster.actors.values()]
    .filter((a) => !a.isUser && !a.isMain && a.text.trim().length >= 20)
    .map((a) => ({ name: a.name, text: a.text.slice(0, 1500), basis: textBasis(`${SHEET_VERSION}|${a.name}: ${a.text}`) }))
    .filter((p) => have[sheetKey(p.name)]?.basis !== p.basis);
}

/** Ask for a reading when someone's lore is new or changed; one job per chat at a time. */
export function queueSheets(chatId: string, st?: WorldState) {
  if (!sheetsToRead(chatId, st).length) return false;
  enqueue("world.sheet", { chatId }, { dedupeKey: `world.sheet:${chatId}`, priority: 3, chatId });
  return true;
}

/** The model reads each person's lore once: kind, alive or not, where, in the story's present. */
export async function readSheets(p: { chatId: string }, job?: JobContext) {
  const chatId = p.chatId;
  const st = currentFold(chatId).result.state;
  const todo = sheetsToRead(chatId, st).slice(0, SHEET_BATCH * 3);
  if (!todo.length) return { read: 0 };
  const chat = mustChat(chatId);
  const card = chat.character_id ? getCard(chat.character_id) : undefined;
  const setting = [card?.name, card?.scenario, card?.description].filter(Boolean).join(". ").replace(/\s+/g, " ").slice(0, 900) || "a story";
  const o = { setting, now: st.time ? formatStoryTime(st.time) : "unknown", town: st.place[0] ?? "" };
  let read = 0;
  for (let i = 0; i < todo.length; i += SHEET_BATCH) {
    const batch = todo.slice(i, i + SHEET_BATCH);
    const { system, user } = sheetPrompt(batch, o);
    const res = await callJson({ task: "world", kind: "world:sheet", chatId, jobId: job?.id, name: "world_sheet", schema: sheetSchema, system, user, maxTokens: 2400 });
    job?.note({ inputTokens: res.inputTokens });
    for (const r of res.data.people ?? []) {
      // "Dawn" may come back as "Dawn Summers", "Giles" as "Rupert Giles": the same person, if only one in the batch fits.
      const words = (r.name ?? "").toLowerCase().split(/\s+/);
      const one = <T,>(xs: T[]) => (xs.length === 1 ? xs[0] : undefined);
      const who =
        batch.find((b) => sheetKey(b.name) === sheetKey(r.name ?? "")) ??
        one(batch.filter((b) => samePerson(b.name, r.name ?? ""))) ??
        one(batch.filter((b) => !b.name.includes(" ") && words.includes(b.name.toLowerCase())));
      const sheet = who && checkRead(r, who.text, who.basis);
      if (!who || !sheet) continue;
      saveSheet(chatId, who.name, sheet);
      read++;
    }
  }
  publish({ type: "trackers.changed", chatId });
  return { read };
}

function skyInput(chatId: string, state: WorldState, cfg: ResolvedWorldConfig): SkyInput | null {
  if (!state.time) return null;
  const anchorSeq = state.weather?.seq;
  const custom = customOf(trackerConfig(chatId).calendar);
  return { seed: chatId, minutes: state.time.minutes, form: state.time.form, climate: cfg.climate, latitude: cfg.latitude, anchor: state.weather && anchorSeq != null ? { minutes: state.time.minutes - 30, text: state.weather.now } : null, ...(custom?.moons.length ? { moons: custom.moons } : {}) };
}

function recentNames(chatId: string): Set<string> {
  const rows = one<{ t: string }>(
    `SELECT GROUP_CONCAT(s.content, ' ') AS t FROM (SELECT m.id, m.active_swipe FROM messages m WHERE m.chat_id = ? AND m.deleted_at IS NULL ORDER BY m.seq DESC LIMIT 40) x JOIN swipes s ON s.message_id = x.id AND s.idx = x.active_swipe`,
    chatId,
  );
  return new Set((rows?.t?.match(/\b[A-Z][a-z]{2,}\b/g) ?? []).map((w) => w.toLowerCase()));
}

function simOps(ops: SimOp[]): Op[] {
  return ops.map((o) => ({ op: "sim", args: o as unknown as Record<string, unknown>, raw: `sim ${o.type}` }));
}

// ---------- after each reply ----------

/**
 * Runs after the trackers read a reply: deliveries are confirmed, then the world takes its turn if the clock moved enough.
 * H6: what the world does after a reply belongs to the version the trackers read (`swipeIdx`), replacing what it
 * did after an earlier reading of it; another swipe gets its own turn. Without one (your edits, a time skip) it rides every swipe.
 */
export function worldAfterReply(chatId: string, messageId: string, swipeIdx?: number) {
  const cfg = worldConfig(chatId);
  if (cfg.mode === "off") return;
  const anchor = { messageId, swipeIdx: swipeIdx ?? -1 };
  if (swipeIdx != null && one("SELECT 1 FROM tracker_events WHERE message_id = ? AND swipe_idx = ? AND source = 'engine'", messageId, swipeIdx))
    writeEvents(chatId, anchor, [], "engine", { replace: ["engine"] });
  const fold = currentFold(chatId).result;
  const st = fold.state;
  if (!st.time) return;
  const roster = rosterFor(chatId, st);
  const prose = one<{ content: string }>("SELECT s.content FROM messages m JOIN swipes s ON s.message_id = m.id AND s.idx = m.active_swipe WHERE m.id = ?", messageId)?.content ?? "";
  const fc = foldConfigFor(chatId);
  const lane = elsewhereLane({ arrivals: Object.values(st.sim.arrivals), state: st, roster, now: st.time.minutes, userName: fc.userName, arcs: Object.values(st.sim.arcs) });
  const castNames = Object.values(st.chars).filter((c) => c.tier === "spot" || c.tier === "peri").map((c) => c.name);
  const confirmed = confirmArrivals({ arrivals: Object.values(st.sim.arrivals), offered: lane.offered, prose, now: st.time.minutes, castNames });
  if (confirmed.length) writeEvents(chatId, anchor, simOps(confirmed), "engine", { replace: [] });
  const from = st.sim.lastTickAt;
  if (from != null && st.time.minutes - from < cfg.step) return;
  runTick(chatId, messageId, false, swipeIdx);
}

export function runTick(chatId: string, messageId: string | null, forced: boolean, swipeIdx?: number) {
  const cfg = worldConfig(chatId);
  if (cfg.mode === "off") throw badRequest("The world simulation is off for this chat");
  const st = currentFold(chatId).result.state;
  if (!st.time) throw badRequest("The story clock isn't set yet; the world starts once the trackers have read a reply");
  const inp = tickInput(chatId, st, rosterFor(chatId, st), forced);
  const res = tick(inp);
  const anchor = messageId ?? lastMessage(chatId)?.id ?? null;
  const idx = anchor ? (messageId && swipeIdx != null ? swipeIdx : -1) : 0;
  writeEvents(chatId, { messageId: anchor, swipeIdx: idx }, [...simOps(res.sim), ...res.ledger], "engine");
  if (cfg.telling === "model" && res.cards.length) enqueue("world.tell", { chatId, messageId: anchor, swipeIdx: idx, cards: res.cards }, { priority: 2, chatId });
  // New subplots the engine offered or started get the story's words too.
  const fresh = res.sim.flatMap((o) => (o.type === "proposal.new" ? [o.proposal.id] : o.type === "arc.new" && o.arc.by === "engine" && !o.arc.locked ? [o.arc.id] : []));
  if (cfg.telling === "model" && fresh.length) enqueue("world.word", { chatId, messageId: anchor, swipeIdx: idx, ids: fresh }, { priority: 2, chatId });
  // docs/21 Part 2: anyone whose lore is new or changed gets read before the world guesses about them again.
  queueSheets(chatId, st);
  return res;
}

function tickInput(chatId: string, st: WorldState, roster: Roster, forced: boolean): TickInput {
  const cfg = worldConfig(chatId);
  const sky = skyInput(chatId, st, cfg);
  const weather = sky ? skyLine(sky, st.weather?.now ?? null).weather.text : undefined;
  return {
    chatId,
    state: st,
    roster,
    mode: cfg.mode as SimMode,
    director: cfg.director,
    seeding: cfg.seeding,
    fates: cfg.fates,
    genres: cfg.genres,
    tech: cfg.tech,
    from: st.sim.lastTickAt,
    now: st.time!.minutes,
    recent: recentNames(chatId),
    forced,
    weather,
    namedDay: null,
    situations: loreSituations(chatId),
  };
}

/** The ELSEWHERE lane and the sky, for the story-state note. */
export function worldLane(chatId: string): string | undefined {
  const cfg = worldConfig(chatId);
  const st = currentFold(chatId).result.state;
  if (!st.time) return undefined;
  const parts: string[] = [];
  const sky = skyInput(chatId, st, cfg);
  if (sky) parts.push(skyLine(sky, st.weather?.now ?? null).line);
  if (cfg.mode !== "off") {
    const fc = foldConfigFor(chatId);
    const lane = elsewhereLane({ arrivals: Object.values(st.sim.arrivals), state: st, roster: rosterFor(chatId, st), now: st.time.minutes, userName: fc.userName, arcs: Object.values(st.sim.arcs) });
    if (lane.text) parts.push(lane.text);
  }
  return parts.join("\n") || undefined;
}

// ---------- telling ----------

export async function runTelling(p: { chatId: string; messageId: string | null; swipeIdx?: number; cards: BeatCard[] }, job?: JobContext) {
  const told = await tellCards(p.chatId, p.cards, { job });
  const ops: SimOp[] = p.cards.filter((c) => told.has(c.id)).map((c) => ({ type: "arc.tell", id: c.arc, at: c.at, text: told.get(c.id)! }));
  if (ops.length) writeEvents(p.chatId, { messageId: p.messageId, swipeIdx: p.messageId ? (p.swipeIdx ?? -1) : 0 }, simOps(ops), "engine");
}

/**
 * The model tells the cards; returns the words for each card it told. A telling that misses gets one
 * more try; after that, one that's off only in ways that don't change the story is used anyway.
 * `again`: the story already reads these words; the model gives them new ones.
 */
async function tellCards(chatId: string, cards: BeatCard[], opts: { job?: JobContext; again?: boolean } = {}): Promise<Map<string, string>> {
  const st = currentFold(chatId).result.state;
  const fc = foldConfigFor(chatId);
  const s = parseJson<ChatSettings>(mustChat(chatId).settings, {});
  const o = { userName: fc.userName, truths: s.truths ?? [], genres: worldConfig(chatId).genres };
  const check = { userName: fc.userName, places: [...Object.values(st.places).flatMap((x) => x.path), st.place.join(" ")], known: [...Object.values(st.chars).map((c) => c.name), ...o.truths] };
  const fresh = opts.again ? "\nTELL IT AGAIN: the story already reads ENGINE'S WORDS here. Keep what happened; give it new words of your own." : "";
  const job = opts.job;
  const told = new Map<string, string>();
  const misses = new Map<string, { text: string; problem: string }>();
  const take = (beats: { card: string; text: string }[]) => {
    for (const b of beats) {
      const card = cards.find((c) => c.id === b.card);
      if (!card || told.has(card.id)) continue;
      const problem = validateTelling(b.text, card, check);
      if (problem) misses.set(card.id, { text: b.text, problem });
      else {
        told.set(card.id, b.text.trim());
        misses.delete(card.id);
      }
    }
  };
  const { system, user } = tellingPrompt(cards, o);
  const res = await callJson({ task: "world", kind: "world:telling", chatId, jobId: job?.id, name: "world_telling", schema: tellingSchema, system, user: user + fresh, maxTokens: 1200 });
  job?.note({ inputTokens: res.inputTokens });
  take(res.data.beats);
  // The model's words are what the story should read: a telling that missed gets one more try.
  const again = cards.filter((c) => !told.has(c.id));
  if (again.length) {
    const first = new Map(misses);
    const r = retellPrompt(again, first, o);
    try {
      const res2 = await callJson({ task: "world", kind: "world:telling", chatId, jobId: job?.id, name: "world_telling", schema: tellingSchema, system: r.system, user: r.user + fresh, maxTokens: 1200 });
      take(res2.data.beats);
    } catch {
      // The first try's words still stand in where they can.
    }
    // Still off only in ways that don't change the story: the model's words beat the engine's.
    for (const [id, m] of misses) if (softProblem(m.problem)) told.set(id, m.text.trim());
    for (const [id, m] of first) if (!told.has(id) && softProblem(m.problem)) told.set(id, m.text.trim());
  }
  return told;
}

// ---------- wording new subplots ----------

/** Word the proposals and engine-started subplots a tick made (by id), in the story's words. */
export async function runWording(p: { chatId: string; messageId: string | null; swipeIdx?: number; ids: string[] }, job?: JobContext) {
  const ops = await wordSubplots(p.chatId, p.ids, job);
  if (ops.length) writeEvents(p.chatId, { messageId: p.messageId, swipeIdx: p.messageId ? (p.swipeIdx ?? -1) : 0 }, simOps(ops), "engine");
}

/** A waiting proposal, or a subplot the engine started, worded again in the model's words. */
export async function rewordSubplot(chatId: string, id: string) {
  const ops = await wordSubplots(chatId, [id], undefined, true);
  if (!ops.length) throw badRequest("The model's wording didn't hold up this time; try again");
  return control(chatId, ops);
}

async function wordSubplots(chatId: string, ids: string[], job?: JobContext, again = false): Promise<SimOp[]> {
  const st = currentFold(chatId).result.state;
  const fc = foldConfigFor(chatId);
  const s = parseJson<ChatSettings>(mustChat(chatId).settings, {});
  const o = { userName: fc.userName, truths: s.truths ?? [], genres: worldConfig(chatId).genres };
  const name = (who: string) => st.sim.actors[who]?.name ?? who;
  const cards: WordingCard[] = ids.flatMap((id) => {
    const p = st.sim.proposals[id];
    if (p) return [{ id, kind: p.kind, lead: p.leadName, cast: p.cast.map(name), premise: p.premise, want: p.want, fear: p.fear, why: p.why }];
    const a = st.sim.arcs[id];
    // Words you wrote (or edited) are yours: they're never reworded.
    if (a && a.by === "engine" && (!a.locked || again)) return [{ id, kind: a.kind, lead: a.leadName, cast: a.cast.map(name), premise: a.premise, want: a.want, fear: a.fear, why: a.grounds.join(", ") || "the story so far" }];
    return [];
  });
  if (!cards.length) return [];
  const freshly = again ? "\nWORD IT AGAIN: the story already reads the engine's words above. Give it new words of your own." : "";
  const worded = new Map<string, { premise: string; want: string; fear: string }>();
  const misses = new Map<string, { w: { premise: string; want: string; fear: string }; problem: string }>();
  const take = (items: { id: string; premise: string; want: string; fear: string }[]) => {
    for (const it of items) {
      if (!cards.some((c) => c.id === it.id) || worded.has(it.id)) continue;
      const problem = validateWording(it, o);
      if (problem) misses.set(it.id, { w: it, problem });
      else {
        worded.set(it.id, tidyWording(it));
        misses.delete(it.id);
      }
    }
  };
  const { system, user } = wordingPrompt(cards, o);
  const res = await callJson({ task: "world", kind: "world:wording", chatId, jobId: job?.id, name: "world_wording", schema: wordingSchema, system, user: user + freshly, maxTokens: 1200 });
  job?.note({ inputTokens: res.inputTokens });
  take(res.data.items);
  const left = cards.filter((c) => !worded.has(c.id));
  if (left.length) {
    const notes = left.map((c) => (misses.get(c.id) ? `ITEM ${c.id}: turned back (${misses.get(c.id)!.problem}). Word it again without that.` : `ITEM ${c.id}: you left it out. Word it.`)).join("\n");
    try {
      const r = wordingPrompt(left, o);
      const res2 = await callJson({ task: "world", kind: "world:wording", chatId, jobId: job?.id, name: "world_wording", schema: wordingSchema, system: r.system, user: `${r.user}${freshly}\n\nLAST TRY:\n${notes}`, maxTokens: 1200 });
      take(res2.data.items);
    } catch {
      // The first try's words still stand in where they can.
    }
    // Too long is still the story's words; deciding for the user's character is not.
    for (const [id, m] of misses) if (m.problem === "too long" && !worded.has(id)) worded.set(id, tidyWording(m.w));
  }
  return cards.flatMap((c): SimOp[] => {
    const w = worded.get(c.id);
    if (!w) return [];
    return st.sim.proposals[c.id] ? [{ type: "proposal.set", id: c.id, patch: w }] : [{ type: "arc.set", id: c.id, patch: w }];
  });
}

/** Tell a step already taken (n), or the ending (null), again in the model's words. */
export async function retellStep(chatId: string, id: string, n: number | null) {
  const st = currentFold(chatId).result.state;
  const arc = mustArc(st, id);
  if (!st.time) throw badRequest("The story clock isn't set yet");
  const card = pastCard(arc, n, tickInput(chatId, st, rosterFor(chatId, st), true));
  if (!card) throw notFound("That step isn't there any more");
  const told = await tellCards(chatId, [card], { again: true });
  const text = told.get(card.id);
  if (!text) throw badRequest("The model's telling didn't hold up this time; try again");
  return control(chatId, [{ type: "arc.tell", id, at: card.at, text, ...(n === null ? { ending: true } : { n }) }]);
}

// ---------- your controls ----------

/** Your controls write "user" events at the newest message; returns their ids (Meus undoes by them). */
function control(chatId: string, ops: SimOp[], ledger: Op[] = []): string[] {
  const last = lastMessage(chatId);
  return writeEvents(chatId, { messageId: last?.id ?? null, swipeIdx: last ? -1 : 0 }, [...simOps(ops), ...ledger], "user");
}

function mustArc(st: WorldState, id: string): Arc {
  const a = st.sim.arcs[id];
  if (!a) throw notFound("Subplot not found");
  return a;
}

export function arcAction(chatId: string, id: string, action: "hold" | "resume" | "nudge" | "bringIn" | "drop" | "edit", patch: { premise?: string; want?: string; fear?: string } = {}) {
  const st = currentFold(chatId).result.state;
  const arc = mustArc(st, id);
  const now = st.time?.minutes ?? 0;
  const p: Partial<Arc> =
    action === "hold" ? { status: "held" } : action === "resume" ? { status: "running" } : action === "nudge" ? { push: true, nextAt: now } : action === "bringIn" ? { bringIn: true, push: true, nextAt: now } : action === "drop" ? { status: "dropped" } : { ...patch, locked: true };
  return control(chatId, [{ type: "arc.set", id: arc.id, patch: p }]);
}

/**
 * Call a subplot's next beat (win, at a cost, loss, a twist, or a reversal). When the subplot can
 * move off the page now, the beat lands at once, so the next reply already has it on its way to the
 * scene; otherwise the call waits on the subplot and its next beat takes it. null clears a waiting call.
 */
export function forceOutcome(chatId: string, id: string, outcome: Force | null, opts: { salt?: number; text?: string } = {}): { landed: boolean; eventIds: string[] } {
  const cfg = worldConfig(chatId);
  const st = currentFold(chatId).result.state;
  const arc = mustArc(st, id);
  if (arc.status !== "running" && arc.status !== "held") throw badRequest("This subplot isn't moving any more");
  if (outcome === null) return { landed: false, eventIds: control(chatId, [{ type: "arc.set", id, patch: { force: null } }]) };
  if (cfg.mode !== "off" && st.time) {
    const roster = rosterFor(chatId, st);
    if (canStep(arc, roster)) {
      // The fold's state is shared: the call rides on a copy of this one subplot.
      const called: WorldState = { ...st, sim: { ...st.sim, arcs: { ...st.sim.arcs, [id]: { ...arc, force: outcome } } } };
      const res = forcedStep(tickInput(chatId, called, roster, true), id, opts.salt ?? 0);
      // G3: the words you accepted (or edited) in the preview tell it; no second telling.
      const told = opts.text?.trim() && res.cards[0] ? [{ type: "arc.tell" as const, id, at: res.cards[0].at, text: opts.text.trim().slice(0, 1200) }] : [];
      const eventIds = control(chatId, [...res.sim, ...told], res.ledger);
      if (!told.length && cfg.telling === "model" && res.cards.length) {
        const last = lastMessage(chatId);
        enqueue("world.tell", { chatId, messageId: last?.id ?? null, swipeIdx: last ? -1 : 0, cards: res.cards }, { priority: 2, chatId });
      }
      return { landed: true, eventIds };
    }
  }
  const now = st.time?.minutes ?? arc.nextAt;
  return { landed: false, eventIds: control(chatId, [{ type: "arc.set", id, patch: { force: outcome, ...(arc.status === "running" ? { push: true, nextAt: now } : {}) } }]) };
}

export interface BeatPreview {
  /** False: the subplot can't move off the page right now, so the call would wait for its next step. */
  landsNow: boolean;
  outcome: Force;
  salt: number;
  result: string | null;
  stage: string | null;
  /** How it reaches the scene, in words: the engine's (free), or one cheap call in model-telling mode. */
  text: string;
  told: "engine" | "model";
  /** The ways it could reach the scene (a messenger, a letter, word going round…). */
  arrivals: { route: string; text: string; carrier: string | null }[];
  why: string[];
  /** What else the beat would set moving: subplots answering it, endings it settles, subplots it starts. */
  ripples: string[];
}

/**
 * G3: how a called beat would land, before anything commits: the forced step runs on a copy of the
 * story, seeded by the salt, so Accept (with the same salt) lands exactly this. Reroll is a new salt.
 */
export async function previewOutcome(chatId: string, id: string, outcome: Force, salt = 0): Promise<BeatPreview> {
  const cfg = worldConfig(chatId);
  const st = currentFold(chatId).result.state;
  const arc = mustArc(st, id);
  if (arc.status !== "running" && arc.status !== "held") throw badRequest("This subplot isn't moving any more");
  const none: BeatPreview = { landsNow: false, outcome, salt, result: null, stage: null, text: "", told: "engine", arrivals: [], why: [], ripples: [] };
  if (cfg.mode === "off" || !st.time) return none;
  const roster = rosterFor(chatId, st);
  if (!canStep(arc, roster)) return none;
  const copy = structuredClone(st);
  copy.sim.arcs[id] = { ...copy.sim.arcs[id]!, force: outcome };
  const res = forcedStep(tickInput(chatId, copy, roster, true), id, salt);
  const beat = res.sim.find((o): o is Extract<SimOp, { type: "arc.beat" }> => o.type === "arc.beat" && o.id === id)?.beat;
  const arrivals = res.sim.filter((o): o is Extract<SimOp, { type: "arrival.new" }> => o.type === "arrival.new").map((o) => ({ route: o.arrival.route, text: o.arrival.text, carrier: o.arrival.carrier ? (roster.actors.get(o.arrival.carrier)?.name ?? o.arrival.carrier) : null }));
  const engineText = beat?.text ?? res.cards[0]?.template ?? res.summary.join(" ");
  let text = engineText;
  let told: BeatPreview["told"] = "engine";
  if (cfg.telling === "model" && res.cards.length) {
    try {
      const fc = foldConfigFor(chatId);
      const s = parseJson<ChatSettings>(mustChat(chatId).settings, {});
      const { system, user } = tellingPrompt(res.cards.slice(0, 1), { userName: fc.userName, truths: s.truths ?? [], genres: cfg.genres });
      const r = await callJson({ task: "world", kind: "world:telling", chatId, name: "world_telling", schema: tellingSchema, system, user, maxTokens: 500 });
      const b = r.data.beats.find((x) => x.card === res.cards[0]!.id) ?? r.data.beats[0];
      if (b?.text.trim()) {
        text = b.text.trim();
        told = "model";
      }
    } catch {
      // The engine's words stand in.
    }
  }
  return { landsNow: true, outcome, salt, result: beat?.result ?? null, stage: beat?.stage ?? null, text, told, arrivals, why: beat?.why ?? [], ripples: res.summary.slice(1) };
}

/** "Give someone a story": a premise in your words, started at once (it locks). */
export function authorArc(chatId: string, name: string, premise: string) {
  const st = currentFold(chatId).result.state;
  if (!st.time) throw badRequest("The story clock isn't set yet");
  const roster = rosterFor(chatId, st);
  const lead = roster.byName(name);
  if (!lead || lead.isUser) throw badRequest(`Nobody called "${name}" is known to the story yet; add them on the Cast page first`);
  const kind = kindFromText(premise) ?? "pursuit";
  const others = [...roster.actors.values()].filter((a) => a.id !== lead.id && premise.includes(a.name.split(" ")[0]!));
  const want = premise.match(/\b(?:wants?|hopes?|needs?|tries|plans?|means|intends?|sets? out|vows?)\s+to\s+([^.;,!?]+)/i)?.[1];
  const cfg = worldConfig(chatId);
  const inp = { chatId, state: st, roster, mode: cfg.mode === "off" ? "living" : cfg.mode, now: st.time.minutes } as unknown as TickInput;
  const arc = newArc({ kind, lead: lead.id, leadName: lead.name, cast: others.map((a) => a.id), target: others[0]?.id, premise: premise.trim(), want: want ? `to ${want.trim()}` : undefined, grounds: ["player"], score: 1, why: "your story", key: `${lead.id}|${kind}|player` }, inp);
  const ids = control(chatId, [{ type: "arc.new", arc: { ...arc, by: "player", locked: true, push: true, nextAt: st.time.minutes } }]);
  return { ...arc, eventIds: ids };
}

export function decideProposal(chatId: string, id: string, accept: boolean) {
  const st = currentFold(chatId).result.state;
  const p = st.sim.proposals[id];
  if (!p) throw notFound("Proposal not found");
  const ops: SimOp[] = [{ type: "proposal.done", id, accepted: accept }];
  if (accept && st.time) {
    const roster = rosterFor(chatId, st);
    const inp = { chatId, state: st, roster, now: st.time.minutes } as unknown as TickInput;
    const arc = newArc({ kind: p.kind, lead: p.lead, leadName: p.leadName, cast: p.cast, target: p.cast[0], premise: p.premise, want: p.want, fear: p.fear, grounds: p.grounds, score: 1, why: p.why, key: p.key }, inp);
    ops.push({ type: "arc.new", arc: { ...arc, push: true, nextAt: st.time.minutes } });
  }
  return control(chatId, ops);
}

/** Fates (ALMANAC 09 §12): accept the ending, soften it, or keep it for a scene on the page. */
export function decideFate(chatId: string, id: string, choice: "accept" | "soften" | "page") {
  const st = currentFold(chatId).result.state;
  const arc = mustArc(st, id);
  if (!arc.fate || !st.time) throw badRequest("Nothing is waiting on this subplot");
  const roster = rosterFor(chatId, st);
  if (choice === "page") return control(chatId, [{ type: "arc.set", id, patch: { status: "running", bringIn: true, heat: 3 } }]);
  const result: EndResult = choice === "soften" ? "softened" : arc.fate.result;
  const text = choice === "soften" ? `${arc.leadName} came close to the worst, but it didn't come to that.` : arc.fate.text;
  const ledger: Op[] = [];
  if (choice === "accept") {
    const inp = { chatId, state: st, roster, now: st.time.minutes } as unknown as TickInput;
    ledger.push(...consequences(arc, result, text, inp));
    // What can't be undone, done: a death, or a grave wound.
    if (arc.kind === "decline" || arc.kind === "threat") ledger.push({ op: "dead", subject: arc.leadName, args: { text }, cause: text, raw: `dead ${arc.leadName} — ${text}` });
    if (arc.kind === "revenge" && arc.target) {
      const t = roster.actors.get(arc.target);
      if (t) ledger.push({ op: "body", subject: t.name, args: { meters: [], injuries: [{ where: "a grave wound", severity: "serious" }], flags: [], clear: [] }, cause: text, raw: `body ${t.name}: injury: a grave wound, serious` });
    }
  }
  return control(chatId, [{ type: "arc.end", id, result, text, at: st.time.minutes }], ledger);
}

/** What an undo of an engine change also says (docs/21 1.3): the two don't talk, or this person sits out the simulation. */
export type UndoAlso = "apart" | "out";

/**
 * Takes back a change the world made off the page (docs/21 1.1). News goes with its hop and with
 * everything that travelled on from it (undoing Spike → Tara also undoes Tara → Willow). `also`
 * keeps it from happening again, on the cast profiles, which every branch reads.
 */
export function undoEngine(chatId: string, eventId: string, also?: UndoAlso): { removed: number } {
  mustChat(chatId);
  type Row = { id: string; message_id: string | null; swipe_idx: number; source: string; op: string };
  const row = one<Row>("SELECT id, message_id, swipe_idx, source, op FROM tracker_events WHERE chat_id = ? AND id = ?", chatId, eventId);
  if (!row) throw notFound("That change is gone already");
  if (row.source !== "engine") throw badRequest("Only the world's own changes can be undone here");
  const ids = new Set<string>();
  const told = (op: Op) => (op.op === "know" ? String(op.args.route ?? "").match(/^told by (.+?), /)?.[1] : undefined);
  const take = (r: Row) => {
    if (ids.has(r.id)) return;
    ids.add(r.id);
    const op = parseJson<Op>(r.op, { op: "sim", args: {}, raw: "" } as Op);
    if (!told(op) || !op.subject) return;
    const key = String(op.args.key ?? "");
    // The hop record beside it.
    for (const h of all<Row>(
      "SELECT id, message_id, swipe_idx, source, op FROM tracker_events WHERE chat_id = ? AND source = 'engine' AND message_id IS ? AND swipe_idx = ? AND json_extract(op, '$.args.type') = 'news' AND json_extract(op, '$.args.hop.fact') = ? AND json_extract(op, '$.args.hop.to') = ?",
      chatId, r.message_id, r.swipe_idx, key, op.subject,
    ))
      ids.add(h.id);
    // And whatever they passed on.
    for (const next of all<Row>(
      "SELECT id, message_id, swipe_idx, source, op FROM tracker_events WHERE chat_id = ? AND source = 'engine' AND json_extract(op, '$.op') = 'know' AND json_extract(op, '$.args.key') = ? AND json_extract(op, '$.args.route') LIKE ?",
      chatId, key, `told by ${op.subject}, %`,
    ))
      take(next);
  };
  take(row);

  const op = parseJson<Op>(row.op, { op: "sim", args: {}, raw: "" } as Op);
  if (also === "out" && op.subject) saveCastProfile(chatId, op.subject, { out: true });
  if (also === "apart" && op.subject) {
    const other = told(op) ?? op.object;
    if (other) {
      const cur = castProfiles(chatId)[castKey(op.subject)]?.apart ?? [];
      if (!cur.some((n) => n.toLowerCase() === other.toLowerCase())) saveCastProfile(chatId, op.subject, { apart: [...cur, other] });
    }
  }
  deleteEvents(chatId, [...ids]);
  return { removed: ids.size };
}

export function setActor(chatId: string, name: string, patch:{ standing?: string; where?: string; flag?: "out" | "hold" | "wake" | null }) {
  const st = currentFold(chatId).result.state;
  const roster = rosterFor(chatId, st);
  const a = roster.byName(name);
  const id = a?.id ?? slug(name);
  return control(chatId, [
    {
      type: "actor.set",
      actor: {
        id,
        name: a?.name ?? name,
        ...(patch.standing ? { standing: patch.standing as Standing } : {}),
        ...(patch.where ? { where: patch.where.split(/\s*›\s*/) } : {}),
        ...(patch.flag !== undefined ? { flag: patch.flag ?? undefined } : {}),
      },
    },
  ]);
}

// ---------- the view ----------

export function worldView(chatId: string) {
  const cfg = worldConfig(chatId);
  const st = currentFold(chatId).result.state;
  const roster = rosterFor(chatId, st);
  const sky = skyInput(chatId, st, cfg);
  const skyNow = sky ? skyLine(sky, st.weather?.now ?? null) : null;
  const profiles = castProfiles(chatId);
  const people = [...roster.actors.values()]
    .filter((a) => !a.isUser)
    .map((a) => ({
      id: a.id,
      name: a.name,
      // Where they come from decides what you can change: the story's records, a cast profile, or only a lorebook entry.
      source: st.chars[a.id] ? ("story" as const) : profiles[castKey(a.name)] ? ("cast" as const) : ("lore" as const),
      role: profiles[castKey(a.name)]?.role ?? null,
      description: profiles[castKey(a.name)]?.description ?? null,
      ring: a.ring,
      standing: a.standing,
      where: a.where?.join(" › ") ?? null,
      reach: a.reach,
      travel: Number.isFinite(a.travel) ? a.travel : null,
      ties: [...a.tieKind.entries()].map(([id, t]) => ({ id, name: roster.actors.get(id)?.name ?? id, strength: TIE_STRENGTH[t.type], type: t.type, inTouch: t.inTouch, by: t.by })),
      flag: a.flag ?? null,
      // docs/21 Part 2: where their standing and place came from (you, the story, the lore read, or a guess).
      basis: a.basis,
      arcs: Object.values(st.sim.arcs).filter((x) => x.lead === a.id && (x.status === "running" || x.status === "held" || x.status === "fate")).map((x) => x.id),
    }));
  const surprise = cfg.view === "surprise";
  const all = Object.values(st.sim.arcs);
  const events = all.flatMap(eventsOf);
  const now = st.time?.minutes ?? Math.max(0, ...events.map((e) => e.at));
  // How a live subplot is tied to the others now: what they did, which way they pull, and what stands about its people.
  const tiesOf = (a: Arc) => {
    if (a.status !== "running" && a.status !== "held") return { ties: [], stands: [], pull: null };
    const bs = bearingsOn(a, all, roster, now);
    const pull = webMod(bs);
    return {
      ties: bs.slice(0, 4).map((b) => ({ id: b.arc, leadName: b.leadName, kind: b.kind, stance: b.stance, dir: b.dir ?? null, person: b.person, ending: b.ending, fresh: b.fresh, text: b.text, at: b.at, pull: b.mod && !surprise ? pullWords(b).replace(/^tied: /, "") : "", mod: surprise ? 0 : b.mod })),
      stands: conditionsFor(peopleOf(a, roster), events, now).map((c) => ({ text: c.text, leadName: c.leadName, kind: c.kind, at: c.at })),
      pull: pull.mod && !surprise ? pull : null,
    };
  };
  const arcs = all
    .sort((a, b) => Number(b.status === "running") - Number(a.status === "running") || (b.beats.at(-1)?.at ?? b.createdAt) - (a.beats.at(-1)?.at ?? a.createdAt))
    .map((a) => ({ ...(surprise ? { ...a, beats: a.beats.map((b) => ({ ...b, roll: [0, 0] as [number, number], mod: 0, why: [] })) } : a), ...tiesOf(a) }));
  return {
    config: cfg,
    personalities: PERSONALITIES,
    modes: Object.keys(MODES),
    kinds: Object.fromEntries(Object.entries(SPECS).map(([k, v]) => [k, { label: v.label, clock: v.clock, hostile: Boolean(v.hostile) }])),
    time: st.time ? formatStoryTime(st.time) : null,
    sky: skyNow ? { line: skyNow.line, weather: skyNow.weather, season: skyNow.season, sunrise: skyNow.sunrise, sunset: skyNow.sunset, moon: skyNow.moon, forecast: forecast(sky!, 12) } : null,
    arcs,
    arrivals: Object.values(st.sim.arrivals).sort((a, b) => b.at - a.at),
    proposals: Object.values(st.sim.proposals),
    news: [...st.sim.news].reverse(),
    incidents: [...st.sim.incidents].reverse(),
    tension: st.sim.tension,
    lastTickAt: st.sim.lastTickAt != null ? formatStoryTime({ minutes: st.sim.lastTickAt, form: st.time?.form ?? "day" }) : null,
    ticks: st.sim.ticks,
    people,
    // Off the page and placed by nobody: the engine is guessing about them until the lore is read or you say.
    guessing: people.filter((p) => p.ring !== "onstage" && !p.flag && p.basis.where !== "you" && p.basis.where !== "story" && p.basis.where !== "lore" && p.basis.standing !== "lore" && p.basis.standing !== "you").length,
    toRead: sheetsToRead(chatId, st).length,
    // Two people in the story's records with one name: likely one person written twice, for you to merge.
    twins: Object.values(Object.groupBy(Object.values(st.chars).filter((c) => !c.isUser), (c) => sheetKey(c.name)))
      .filter((g) => (g?.length ?? 0) > 1)
      .map((g) => g!.map((c) => c.name)[0]!),
    town: roster.town,
    factionRel: st.sim.factionRel,
  };
}
