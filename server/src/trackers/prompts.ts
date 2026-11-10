import { type CalendarId, calendarHint } from "./calendars";
import { formatStoryTime } from "./clock";
import type { Field, Template } from "./schema";
import { groupsLine } from "./groups";
import { openLoops } from "./loops";
import { placeNotesHere } from "./belongings";
import { knownPlacesLine } from "./places";
import { passingName } from "./whois";
import { AXES, LADDER, type WorldState } from "./types";

/** The ledger grammar, compact enough to send with every tracker call. */
export const GRAMMAR = `Write one change per line, only what changed in the NEW MESSAGES. Omission never means removal.
clock: +45m | +2h | Day 3 21:40 | 2026-03-14 21:40   (time passed; never backwards unless "flashback")
wx: rain → heavy rain                        at: City › District › Building › Room   (a known place by its known name and path)
   (wx is the weather outside only: sky, temperature, wind, rain or snow, and only when the messages state it or it changes. The light in a room, a mood or a sound is never wx.)
scene: <title of a new scene>
occasion: a royal wedding feast | off   (only when the messages show an event under way: a birthday party, a wedding, a funeral, a feast, in your own words; off when it ends; never for a plan or a memory of one)
mode: social|intimacy|conflict|investigation|travel|stealth|downtime|aftermath|crisis   (its own line; with every new scene, or when the scene turns into another; aftermath: just after a death, an injury, violence or a loss, inside the consequences; a social scene may name its talk: social (confrontation|apology|confession|breakup|request|interrogation))
cast: Name@spot(activity) · Name@peri(at the bar) · Name@left(→ where) · Name@arrive   (after @ only spot|peri|left|arrive; places go in at:; with a new at: that moves the scene, name everyone who came along: whoever was present and isn't named stayed behind; @spot or @peri only for people the messages put in the scene, never someone only thought of, talked about or waiting elsewhere)
mood Name: old → new | V-1 A2 D0              (named emotion; VAD optional: valence -3..3, arousal 0..5, dominance -3..3)
body Name: fatigue 3; hunger +1; soaked; injury: left arm, wound, bandaged; healed: left arm
   (meters 0-5: health, fatigue, hunger, thirst, pain, intox, composure, stress, arousal; severities: scratch, wound, serious, critical)
look Name: what they wear and visible marks now   (the whole look, replacing the old one: leave out what they took off or handed back)
trait Name: green eyes; red hair in a braid   (only lasting features, first time described)
   (the first time someone other than the player's character speaks, one voice trait: where their speech comes from and how strongly it shows — trait Joss: voice: broad Glaswegian, working-class, swears easily, drops it with strangers. An accent is a place and a class, never "neutral"; take it from the card or the messages when they say)
drive Name: want: …; fear: …; need: …; tactic: …      mask Name: shown: calm; felt: panic; tell: …
think Name: "Damn it, not now. If she finds the letter I'm finished."       journal Name: "a turning point, in their own slant"
   (think: every reply, one line for each person @spot, even when little else changed, never for a character marked sealed; first person, in their own head-voice: their words, slang, oaths, grudges and worries, only what they know, about what's in front of them; a raw reaction, not narration, summary or poetry)
beat: Alex asks Mira whether she ever loved Joss; she says no and promises to tell Sam at supper
   (beat: every reply, one line, last: what happened in the NEW MESSAGES, in order, at most 25 words: who did or said what, with the names; plain facts, never how it read; a line said that matters goes in as said)
dead Name — cause
bond A>B: trust +1; affection -1; label "grudging warmth" — cause   (axes: ${AXES.join(", ")}; usually ±1, ±2 major; write the change, not old → new)
   (fear is fear OF them: they are a threat. worry is fear FOR them: they might get hurt, caught or lost. Dreading what happens to someone you care about is worry, never fear.)
   (a hidden truth coming out — a lie, an affair, a secret pregnancy — drops trust for whoever it was kept from; think about who else it touches: whose partner, whose family, whose best friend)
ladder A>B: 3 — evidence   (romance rungs: ${LADDER.map((n, i) => `${i} ${n}`).join(", ")})
   (ladder is ONLY romantic or sexual interest. Shock, tension, loyalty or closeness between friends or family is a bond, never a ladder. A rung drops only for betrayal, neglect, cruelty or a lie.)
know Holder: fact | how they learned it · knows|believes|suspects|doubts|wrong|unaware · true|false|partial   (know everyone: … = everyone in the scene)
   (someone telling their own past or a detail about themselves — a nickname, an old job, a family story — is a know line for each person listening, and a trait if it lasts: know Mira: Tam's crew called him Skipper | he told her · knows · true. It's worth filing however small it seems. A nickname or in-joke that sticks is also a motif line, so it's kept by its name: motif "Skipper, his old crew's name for him" — Tam.)
   (a letter, note, text or email — a <letter>, <note>, <texts> or <email> in the messages too — is known to whoever wrote it; to anyone else only once the messages show them reading it. Sent, handed over or left on the table isn't read: know Mira: what Tam's letter says | it's in her bag, unopened · unaware)
secret #key: fact | kept by A · from B        reveal #key: to B — how
item Thing: A → B — how (the same name each time; put down: item Thing: at counter; taken to another house: item Thing: → Town › Place › shelf — packed. Worn or carried stays with whoever has it: item Thing: A) (the thing first, never its owner) | item Name: +A (pocket) | item Name: → gone — burned | item Name: owner A | item Name: A → B (gift from A) — why
room A: Town › Place | room|home|shop (whose place it is; A is a person)     keeps A: item @ place (theirs, kept there)
lives A: Town › Home   (where someone lives now: moving in, moving out with lives A: - Home; "household" in a line then means whoever lives there)
place Where: what's there now   (what a place looks like, never room: place Kitchen › Fridge door: league standings in marker, two photos)
member Group: + Name | role · why   member Group: - Name — why   (someone joins or leaves a group: member Scoobies: + Dawn | junior · she found the handbook)
   (a line's Holder, A or B is one person, or several: know Willow, Xander: … A group's name stands for its members only when it's a faction (the Groups line below); otherwise name each of them, or name them once in brackets: know Dawn's friends (Melissa, Kara): … Write @Group to mean the group itself: know @Scoobies: … A group line reaches only its members in the scene; a member elsewhere learns it only by a route that reaches them (know @Scoobies: … | Willow texted them). For people around a table who aren't one group, name each of them. A place is never a person.)
thread Title: new|advance|complicate|stall(blocker)|resolve — detail
   (a thread is a question the story is still asking, titled for that question. A nickname or a detail is a know line or a trait, never a thread, and a new question gets its own title rather than an old one's.)
loop L1a2b3: done — the words that show it   (an open loop the NEW MESSAGES finished; the words copied exactly from them; loop L1a2b3: dropped — why, if it's called off)
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

/**
 * docs/32 2.1: the living cast by their exact names, most recently seen first, within about 90 tokens.
 * Passing faces ("the bartender") are left out: they have no name to get wrong.
 */
export function namesLine(st: WorldState, userName: string): string {
  const people = Object.values(st.chars)
    .filter((c) => !c.dead && !passingName(c.name))
    .sort((a, b) => Number(b.isUser) - Number(a.isUser) || Number(b.isMain) - Number(a.isMain) || b.lastSeq - a.lastSeq);
  if (people.length < 2) return "";
  const out: string[] = [];
  let used = 0;
  for (const c of people) {
    const n = c.isUser ? userName : c.name;
    if (used + n.length > 360) break;
    out.push(n);
    used += n.length + 2;
  }
  return `names (write each person exactly as here): ${out.join(", ")}`;
}

/** The current state, with numbers, for the tracker model (it has to write correct deltas). */
export function stateForModel(st: WorldState, o: { userName: string; templates: Template[]; sealed: boolean; calendar?: CalendarId; /** docs/31 3.3: present but not named in a while. */ quiet?: string[] }): string {
  const L: string[] = [];
  const hint = calendarHint(o.calendar ?? "gregorian");
  if (hint) L.push(hint);
  const nm = (id: string) => (st.chars[id]?.isUser ? o.userName : (st.chars[id]?.name ?? id));
  if (st.time) L.push(`clock: ${formatStoryTime(st.time)}`);
  else L.push("clock: (not set yet: set it with an absolute time if the story gives one, else Day 1 and a likely hour)");
  if (st.weather) L.push(`wx: ${st.weather.now}`);
  if (st.place.length) L.push(`at: ${st.place.join(" › ")}`);
  // docs/30 2.5: the places around the scene by their tree names, so a new line doesn't start a second kitchen.
  const known = knownPlacesLine(st);
  if (known) L.push(known);
  if (st.sceneTitle) L.push(`scene: ${st.sceneTitle}`);
  if (st.occasion) L.push(`occasion: ${st.occasion.now}`);
  const here = Object.values(st.chars).filter((c) => c.tier === "spot" || c.tier === "peri");
  const away = Object.values(st.chars).filter((c) => !here.includes(c) && !c.isUser && !c.dead).slice(-8);
  const quiet = new Set((o.quiet ?? []).map((n) => n.toLowerCase()));
  if (here.length) L.push(`cast: ${here.map((c) => `${nm(c.id)}@${c.tier}${c.activity ? `(${clip(c.activity, 40)})` : ""}${quiet.has(c.name.toLowerCase()) ? " (quiet)" : ""}`).join(" · ")}`);
  if (quiet.size) L.push("(quiet: present by the ledger, but the messages haven't named them in a while. If they've left, write them @left; don't keep them in the scene by habit.)");
  if (away.length) L.push(`known, not here: ${away.map((c) => c.name).join(", ")}`);
  // docs/32 2.1: everyone's name as the ledger has it, so the model copies a name instead of recalling it.
  const names = namesLine(st, o.userName);
  if (names) L.push(names);
  // docs/30 1.5: the story's groups by the names the tracker should use, with who's in each.
  const groups = groupsLine(Object.values(st.groups ?? {}).filter((g) => g.adopted));
  if (groups) L.push(groups);
  // The player away (a shower, an errand) has to be brought back with a cast line too, so say so.
  const me = Object.values(st.chars).find((c) => c.isUser && !here.includes(c));
  if (me) L.push(`${o.userName} is not in the scene${me.place ? ` (${clip(me.place, 40)})` : ""}: when the messages put them back in it, write ${o.userName}@arrive`);
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
  for (const l of openLoops(st).slice(-12)) L.push(`loop ${l.id}: ${clip(l.what, 90)}${l.repeats ? " (repeats)" : ""}`);
  for (const m of st.milestones.slice(-10)) L.push(`milestone ${clip(m.text, 80)}`);
  for (const d of Object.values(st.deadlines).filter((x) => !x.done)) L.push(`deadline ${d.title}: ${d.text}`);
  for (const f of Object.values(st.facts).filter((x) => x.secret)) L.push(`secret #${f.key}: ${clip(f.statement, 80)}`);
  for (const g of Object.values(st.gauges)) L.push(`gauge ${g.name}: ${g.cur}/${g.max}`);
  for (const c of Object.values(st.clocks)) L.push(`clockf ${c.faction}: ${c.name} ${c.cur}/${c.max}`);
  const loose = Object.values(st.items).filter((i) => !i.gone && i.holder?.startsWith("place:")).slice(-6);
  for (const i of loose) L.push(`item ${i.name}: at ${i.holder!.slice(6)}${i.owner ? ` (${nm(i.owner)}'s)` : ""}`);
  for (const p of Object.values(st.places).filter((x) => x.owner).slice(-6)) L.push(`room ${nm(p.owner!)}: ${p.path.join(" › ")} | ${p.kind ?? "room"}`);
  // docs/30 2.4: who lives where (said with a lives line, not guessed), so "household" and moves read against it.
  const said = (p: { residents?: string[]; guessed?: string[] }) => (p.residents ?? []).filter((id) => st.chars[id] && !st.chars[id]!.dead && !p.guessed?.includes(id));
  for (const p of Object.values(st.places).filter((x) => said(x).length).slice(-4)) L.push(`lives ${said(p).map(nm).join(", ")}: ${p.path.join(" › ")}`);
  for (const h of placeNotesHere(st, 2)) for (const n of h.notes) L.push(`place ${h.place.path.join(" › ")}: ${clip(n, 100)}`);
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
- Thoughts are the exception: every reply gets a think line for each person at the spot${o.sealed ? ` except ${o.userName}` : ""}, their reaction to this moment.
- Open loops: the state lists what the story is waiting for. Did the NEW MESSAGES finish any of them? It happened on the page, not just got talked about or planned: write a loop line for it, and keep any promise's own line out of it.
- Firsts: the first time something happens between people (a first kiss, the first "I love you", the first night together, meeting the family) gets a milestone line, so it's never staged as new again.
- Time: estimate time passed from the action (a short exchange: +2m to +10m; a meal: +45m) unless the text states a time.
- People: use the names the story uses. New named people get a cast line when they appear. Someone the state already lists keeps that exact name: never pair one person's first name with another's surname.
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
- clock (an absolute time: a date if the story gives one, else Day 1 with the likely hour${o.calendar && o.calendar !== "gregorian" ? "; " + calendarHint(o.calendar) : ""}), wx, at, cast (who is present in the opening), scene title.
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
export function inlineInstruction(state: string, extra?: string) {
  return `After your reply, add a <ledger> block listing what changed in the story world, one change per line, in this language:
${GRAMMAR}
Current ledger state (for correct numbers):
${state}${extra ? `
${extra}` : ""}
Format: your reply, then
<ledger>
…lines…
</ledger>
The ledger is hidden from the reader; never mention it in the prose.`;
}
