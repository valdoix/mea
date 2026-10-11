import { type CalendarId, calendarHint } from "./calendars";
import { formatStoryTime } from "./clock";
import type { Field, Template } from "./schema";
import { AXES, LADDER, type WorldState } from "./types";

/** The ledger grammar, compact enough to send with every tracker call. */
export const GRAMMAR = `Write one change per line, only what changed in the NEW MESSAGES. Omission never means removal.
clock: +45m | +2h | Day 3 21:40 | 2026-03-14 21:40   (time passed; never backwards unless "flashback")
wx: rain → heavy rain                        at: City › District › Building › Room
scene: <title of a new scene>                 mode: social|intimacy|conflict|investigation|travel|stealth|downtime|crisis
cast: Name@spot(activity) · Name@peri(at the bar) · Name@left(→ where) · Name@arrive   (after @ only spot|peri|left|arrive; places go in at:)
mood Name: old → new | V-1 A2 D0              (named emotion; VAD optional: valence -3..3, arousal 0..5, dominance -3..3)
body Name: fatigue 3; hunger +1; soaked; injury: left arm, wound, bandaged; healed: left arm
   (meters 0-5: health, fatigue, hunger, thirst, pain, intox, composure, stress, arousal; severities: scratch, wound, serious, critical)
look Name: what they wear and visible marks now
trait Name: green eyes; red hair in a braid   (only lasting features, first time described)
drive Name: want: …; fear: …; need: …; tactic: …      mask Name: shown: calm; felt: panic; tell: …
think Name: "their private thought now"       journal Name: "a turning point, in their own slant"
dead Name — cause
bond A>B: trust +1; affection -1; label "grudging warmth" — cause   (axes: ${AXES.join(", ")}; usually ±1, ±2 major)
ladder A>B: 3 — evidence   (romance rungs: ${LADDER.map((n, i) => `${i} ${n}`).join(", ")})
know Holder: fact | how they learned it · knows|believes|suspects|doubts|wrong|unaware · true|false|partial
secret #key: fact | kept by A · from B        reveal #key: to B — how
item Name: A → B — how | item Name: +A (pocket) | item Name: → gone — burned | item Name: owner A | item Name: A → B (gift from A) — why
room A: Town › Place | room|home|shop (whose place it is)     keeps A: item @ place (theirs, kept there)
thread Title: new|advance|complicate|stall(blocker)|resolve — detail
owe A → B: what | open|paid [due Day 4]       promise A>B: what | open|kept|broken [due tomorrow 9:00]
promise A>B: be at the Bronze | meet @ the Bronze · minor|major|vital [due 21:00] [window 30m]   (a meeting: Mea checks who turns up)
deadline Title: Day 3 18:00                   plant detail — possible payoff     payoff detail — how it paid off
clue text → points to … | reliability: shaky gauge Name: 3/6 — cause            clockf Faction: project +1 (3/6)
rep Name @ Group: -1 — deed                   event Title: 19 March | birthday | who: Name     plan Title: Day 5 19:00 | who: A, B
motif "a running joke or pet name" — whose    milestone what happened — who
set template.field: value — cause   (custom trackers; tables: template.field[Row].column)
Use each person's full name exactly as in the state below; never invent a second entry for someone already listed.
Every bond, know, item and thread line needs a cause after " — ".`;

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** The current state, with numbers, for the tracker model (it has to write correct deltas). */
export function stateForModel(st: WorldState, o: { userName: string; templates: Template[]; sealed: boolean; calendar?: CalendarId }): string {
  const L: string[] = [];
  const hint = calendarHint(o.calendar ?? "gregorian");
  if (hint) L.push(hint);
  const nm = (id: string) => (st.chars[id]?.isUser ? o.userName : (st.chars[id]?.name ?? id));
  if (st.time) L.push(`clock: ${formatStoryTime(st.time)}`);
  else L.push("clock: (not set yet: set it with an absolute time if the story gives one, else Day 1 and a likely hour)");
  if (st.weather) L.push(`wx: ${st.weather.now}`);
  if (st.place.length) L.push(`at: ${st.place.join(" › ")}`);
  if (st.sceneTitle) L.push(`scene: ${st.sceneTitle}`);
  const here = Object.values(st.chars).filter((c) => c.tier === "spot" || c.tier === "peri");
  const away = Object.values(st.chars).filter((c) => !here.includes(c) && !c.isUser && !c.dead).slice(-8);
  if (here.length) L.push(`cast: ${here.map((c) => `${nm(c.id)}@${c.tier}${c.activity ? `(${clip(c.activity, 40)})` : ""}`).join(" · ")}`);
  if (away.length) L.push(`known, not here: ${away.map((c) => c.name).join(", ")}`);
  for (const c of here) {
    const bits: string[] = [];
    if (c.mood) bits.push(`mood ${c.mood.name}`);
    const meters = Object.entries(c.meters).filter(([, v]) => v != null).map(([k, v]) => `${k} ${Math.round(v!)}`);
    if (meters.length) bits.push(meters.join(", "));
    if (c.injuries.length) bits.push(`injuries: ${c.injuries.map((i) => `${i.where} (${["", "scratch", "wound", "serious", "critical"][i.severity]}${i.treated ? ", treated" : ""})`).join("; ")}`);
    if (c.conditions.length) bits.push(c.conditions.map((k) => k.text).join(", "));
    if (c.look) bits.push(`look: ${clip(c.look, 100)}`);
    if (c.traits.length) bits.push(`traits: ${c.traits.map((t) => t.text).join("; ")}`);
    if (c.drives.want) bits.push(`want: ${clip(c.drives.want, 60)}`);
    const items = Object.values(st.items).filter((i) => i.holder === c.id && !i.gone);
    if (items.length) bits.push(`has: ${items.map((i) => i.name).join(", ")}`);
    if (bits.length) L.push(`${nm(c.id)}${c.isUser && o.sealed ? " (sealed: write only body, look, items)" : ""}: ${bits.join(" · ")}`);
  }
  const ids = new Set(here.map((c) => c.id));
  for (const b of Object.values(st.bonds)) {
    if (!ids.has(b.from) || !ids.has(b.to)) continue;
    const ax = Object.entries(b.axes).filter(([, v]) => v).map(([k, v]) => `${k} ${v! > 0 ? "+" : ""}${v}`);
    const l = st.ladders[`${b.from}>${b.to}`];
    if (ax.length || b.label || l) L.push(`bond ${nm(b.from)}>${nm(b.to)}: ${[...ax, b.label ? `"${b.label}"` : "", l ? `ladder ${l.tier} ${LADDER[l.tier]}` : ""].filter(Boolean).join(", ")}`);
  }
  const threads = Object.values(st.threads).filter((t) => t.status !== "resolved").slice(-10);
  for (const t of threads) L.push(`thread ${t.title}: ${t.status}${t.latest ? ` — ${clip(t.latest, 80)}` : ""}`);
  for (const ob of Object.values(st.obligations).filter((x) => x.status === "open" || x.status === "due").slice(-8)) L.push(`${ob.kind} ${nm(ob.who)} → ${ob.whom ? nm(ob.whom) : "?"}: ${ob.what} | ${ob.status}`);
  for (const d of Object.values(st.deadlines).filter((x) => !x.done)) L.push(`deadline ${d.title}: ${d.text}`);
  for (const f of Object.values(st.facts).filter((x) => x.secret)) L.push(`secret #${f.key}: ${clip(f.statement, 80)}`);
  for (const g of Object.values(st.gauges)) L.push(`gauge ${g.name}: ${g.cur}/${g.max}`);
  for (const c of Object.values(st.clocks)) L.push(`clockf ${c.faction}: ${c.name} ${c.cur}/${c.max}`);
  const loose = Object.values(st.items).filter((i) => !i.gone && i.holder?.startsWith("place:")).slice(-6);
  for (const i of loose) L.push(`item ${i.name}: at ${i.holder!.slice(6)}${i.owner ? ` (${nm(i.owner)}'s)` : ""}`);
  for (const p of Object.values(st.places).filter((x) => x.owner).slice(-6)) L.push(`room ${nm(p.owner!)}: ${p.path.join(" › ")} | ${p.kind ?? "room"}`);
  for (const t of o.templates) {
    const vals = st.custom[t.key] ?? {};
    L.push(`[${t.key}] ${t.name}: ${t.schema.fields.map((f) => `${f.key}=${fieldValue(f, vals[f.key])}`).join("; ")}`);
  }
  if (st.locks.length) L.push(`locked (never change): ${st.locks.join(", ")}`);
  return L.join("\n");
}

function fieldValue(f: Field, v: unknown): string {
  const type = f.type === "enum" ? `one of ${f.options?.join("/")}` : f.type === "table" ? `table by ${f.keyField ?? f.fields?.[0]?.key}: ${(f.fields ?? []).map((s) => s.key).join(",")}` : f.type;
  if (v == null || v === "" || (Array.isArray(v) && !v.length)) return `(${type})`;
  if (f.type === "table" && Array.isArray(v)) {
    const key = f.keyField ?? f.fields?.[0]?.key ?? "name";
    return `[${(v as Record<string, unknown>[]).map((r) => `${r[key]}: ${(f.fields ?? []).filter((s) => s.key !== key && r[s.key] != null).map((s) => `${s.key} ${String(r[s.key])}`).join(", ")}`).join(" | ")}]`;
  }
  return `${Array.isArray(v) ? v.join(", ") : typeof v === "object" ? JSON.stringify(v) : String(v)}`;
}

export function updatePrompt(o: { state: string; messages: string; userName: string; charName: string; sealed: boolean; romance: string; extra?: string }) {
  // M16: the format comes last, after "Reply with", so a replaced prompt keeps it (lib/prompts.ts replyContract).
  const system = `You keep the story ledger for a roleplay between ${o.userName} (the user's character) and ${o.charName}. Read the NEW MESSAGES and write what changed in the story world, as ledger lines.
Rules:
- Only changes the messages show or clearly imply. Never invent events. Small talk changes little; write nothing for what stayed the same.
- Time: estimate time passed from the action (a short exchange: +2m to +10m; a meal: +45m) unless the text states a time.
- People: use the names the story uses. New named people get a cast line when they appear.
- Relationships change only when the aftermath differs from before; intensity is not progress. Not everyone warms up.${o.sealed ? `\n- ${o.userName}'s inner life is the user's: never write mood, think, drive, mask, journal or bond lines from ${o.userName}'s side.` : ""}
- Romance pace: ${o.romance}.
Reply with ledger lines only, in this format:
${GRAMMAR}
Write nothing else: no commentary, no code fences, no headings. If nothing changed, write: clock: +2m`;
  const user = `CURRENT STATE:\n${o.state}\n${o.extra ? `\n${o.extra}\n` : ""}\nNEW MESSAGES:\n${o.messages}\n\nLEDGER TRACKER: write the ledger lines now.`;
  return { system, user };
}

export function initPrompt(o: { userName: string; charName: string; card: string; persona: string; greeting: string; templates: Template[]; sealed: boolean; calendar?: CalendarId }) {
  const system = `You set up the starting state of a roleplay's story ledger from the character card and the opening message. ${o.userName} is the user's character; ${o.charName} is the card's character.
Write the STARTING STATE as ledger lines:
- clock (an absolute time: a date if the story gives one, else Day 1 with the likely hour${o.calendar === "westeros" ? "; " + calendarHint("westeros") : ""}), wx, at, cast (who is present in the opening), scene title.
- For each person present: mood, look, trait (only lasting features the card states: eyes, hair, build, scars, voice, age), drive (their want and fear).
- Bonds the card establishes (with axes and a label), the romance rung if the card states one, items people carry, open threads the premise sets up, secrets the card states.
${o.templates.length ? `- Custom trackers: set every field you can infer (${o.templates.map((t) => t.key).join(", ")}).\n` : ""}- Causes for starting lines may be "from the card".${o.sealed ? `\n- Never write ${o.userName}'s mood, thoughts or feelings.` : ""}
Reply with ledger lines only, in this format:
${GRAMMAR}
Write nothing else.`;
  const user = `CARD (${o.charName}):\n${o.card}\n\n${o.persona ? `${o.userName}:\n${o.persona}\n\n` : ""}OPENING MESSAGE:\n${o.greeting}\n\nSTARTING STATE: write the ledger lines now.`;
  return { system, user };
}

/** Appended to the story prompt in inline mode: the story model writes the ledger itself (no extra request). */
export function inlineInstruction(state: string) {
  return `After your reply, add a <ledger> block listing what changed in the story world, one change per line, in this language:
${GRAMMAR}
Current ledger state (for correct numbers):
${state}
Format: your reply, then
<ledger>
…lines…
</ledger>
The ledger is hidden from the reader; never mention it in the prose.`;
}
