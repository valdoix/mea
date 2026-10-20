import { one, parseJson } from "../db/db";
import { customOf } from "../trackers/customcal";
import { trackerConfig } from "../trackers/store";
import { badRequest, notFound } from "../lib/http";
import { getSetting } from "../lib/settings";
import { currentTitle, isCurrent } from "../lore/format";
import { scanEntriesFor } from "../lore/service";
import { getCard } from "../services/characters";
import { type ChatSettings, lastMessage, mustChat } from "../services/chats";
import { enqueue, type JobContext } from "../services/jobs";
import { callJson } from "../services/llm";
import { formatStoryTime } from "../trackers/clock";
import { slug } from "../trackers/fold";
import { castKey, castProfiles, currentFold, foldConfigFor, writeEvents } from "../trackers/store";
import type { Op, WorldState } from "../trackers/types";
import { confirmArrivals, elsewhereLane } from "./crossings";
import { type Personality, PERSONALITIES } from "./director";
import { kindFromText, SPECS } from "./grammar";
import { buildRoster, lorePersonName, type Roster } from "./roster";
import { climateFrom, forecast, latitudeFrom, placeClimate, skyLine, type SkyInput } from "./sky";
import { type BeatCard, canStep, consequences, forcedStep, MODES, newArc, type SimMode, type Situation, tick, type TickInput } from "./storyteller";
import { tellingPrompt, tellingSchema, validateTelling } from "./telling";
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
  const genres = own.genres?.length ? own.genres : (s.story?.genre ?? "").split(/\s*[,/&]\s*|\s+and\s+/).filter(Boolean);
  return {
    mode: own.mode ?? d.mode,
    director: own.director ?? d.director,
    telling: own.telling ?? d.telling,
    seeding: own.seeding ?? d.seeding,
    fates: own.fates ?? d.fates,
    view: own.view ?? d.view,
    climate: own.climate || place?.climate || climateFrom(cardText),
    latitude: own.latitude ? latitudeFrom(own.latitude, { typed: true }) : (place?.latitude ?? latitudeFrom(cardText)),
    climateAuto: !own.climate,
    tech: own.tech ?? detectTech(cardText),
    genres,
    step: own.step ?? d.step,
  };
}

/** How things stand right now: the lorebooks' CURRENT entries, once each when merged books repeat one. */
function loreSituations(chatId: string): Situation[] {
  const chat = mustChat(chatId);
  const out = new Map<string, Situation>();
  for (const e of scanEntriesFor({ characterId: chat.character_id, personaId: chat.persona_id, chatId })) {
    if (!e.enabled || !e.content.trim() || !isCurrent(e)) continue;
    const title = currentTitle(e);
    const key = title.toLowerCase();
    if (title && !out.has(key)) out.set(key, { key, title, text: e.content.trim().slice(0, 1200) });
  }
  return [...out.values()];
}

/** People the lorebooks describe (a "Name", "Name - role" or "Character: Name" entry about a person). */
function lorePeople(chatId: string): { name: string; text: string }[] {
  const chat = mustChat(chatId);
  const out: { name: string; text: string }[] = [];
  for (const e of scanEntriesFor({ characterId: chat.character_id, personaId: chat.persona_id, chatId })) {
    if (!e.enabled) continue;
    const name = lorePersonName(e);
    if (!name) continue;
    out.push({ name, text: e.content.slice(0, 1200) });
    if (out.length >= 60) break;
  }
  return out;
}

export function rosterFor(chatId: string, state: WorldState): Roster {
  const fc = foldConfigFor(chatId);
  return buildRoster({ state, profiles: castProfiles(chatId), lore: lorePeople(chatId), userName: fc.userName });
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
  const st = currentFold(p.chatId).result.state;
  const fc = foldConfigFor(p.chatId);
  const chat = mustChat(p.chatId);
  const s = parseJson<ChatSettings>(chat.settings, {});
  const { system, user } = tellingPrompt(p.cards, { userName: fc.userName, truths: s.truths ?? [], genres: worldConfig(p.chatId).genres });
  const res = await callJson({ task: "world", kind: "world:telling", chatId: p.chatId, jobId: job?.id, name: "world_telling", schema: tellingSchema, system, user, maxTokens: 1200 });
  job?.note({ inputTokens: res.inputTokens });
  const places = Object.values(st.places).flatMap((x) => x.path);
  const ops: SimOp[] = [];
  for (const b of res.data.beats) {
    const card = p.cards.find((c) => c.id === b.card);
    if (!card) continue;
    const problem = validateTelling(b.text, card, { userName: fc.userName, places: [...places, st.place.join(" ")] });
    if (problem) continue;
    ops.push({ type: "arc.tell", id: card.arc, at: card.at, text: b.text.trim() });
  }
  if (ops.length) writeEvents(p.chatId, { messageId: p.messageId, swipeIdx: p.messageId ? (p.swipeIdx ?? -1) : 0 }, simOps(ops), "engine");
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

export function setActor(chatId: string, name: string, patch: { standing?: string; where?: string; flag?: "out" | "hold" | "wake" | null }) {
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
      ties: [...a.ties.entries()].map(([id, s]) => ({ id, name: roster.actors.get(id)?.name ?? id, strength: s })),
      flag: a.flag ?? null,
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
    town: roster.town,
    factionRel: st.sim.factionRel,
  };
}
