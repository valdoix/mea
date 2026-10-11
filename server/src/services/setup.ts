import { z } from "zod";
import { one, parseJson, run } from "../db/db";
import { getSetting, setSetting } from "../lib/settings";
import { GENRES } from "../prompt/mea";
import { controlValues } from "../prompt/preset";
import { canonOf, setCanon } from "../accuracy/canoncut";
import { shortStoryTime, formatStoryTime } from "../trackers/clock";
import { currentFold, linesToOps } from "../trackers/store";
import { customOf, listCustomCalendars, parseCustomDate } from "../trackers/customcal";
import { userEditAt } from "../trackers/service";
import { getCard } from "./characters";
import { type ChatSettings, mustChat, updateChat } from "./chats";
import { layered } from "./layers";
import { callText } from "./llm";
import { getPersona } from "./personas";
import { resolvePreset } from "./presets";

/**
 * Session Zero (Almanac plan F1): a warm setup when a chat starts, one tap per answer. The answers
 * are pre-filled from the card, the persona, the lore and the character's defaults, so you confirm
 * rather than fill in, and they map onto settings Mea already has (preset controls, story,
 * trackers, world, canon, ambience). Nothing new reaches the prompt. Changing them later leaves a
 * card on the story's timeline ("Tone changed to Dark from message 40").
 */

const s = (n: number) => z.string().trim().max(n);
export const setupSchema = z.object({
  genres: z.array(s(30)).max(4),
  tone: s(40),
  pace: z.enum(["slow", "normal", "fast"]),
  persona: s(30),
  romance: s(30),
  difficulty: s(30),
  intimacy: s(30),
  limits: z.array(s(60)).max(20),
  world: z.object({ calendar: z.union([z.enum(["gregorian", "westeros"]), z.string().regex(/^custom:[\w-]{1,40}$/)]), climate: s(80), tech: z.enum(["modern", "historic", "fantasy", "future"]), start: s(60) }).partial(),
  canon: z.object({ source: s(120), point: s(200) }).partial(),
  trackers: z.object({ mode: z.enum(["helper", "inline", "off"]), sections: z.record(z.string(), z.boolean()) }).partial(),
  look: z.object({ accent: z.boolean(), music: z.boolean() }).partial(),
});
export type SetupAnswers = z.infer<typeof setupSchema>;

export interface SetupRecord {
  answers: SetupAnswers;
  done: boolean;
  skipped?: boolean;
  at: number;
}

export const TONES = ["Warm", "Light", "Playful", "Bittersweet", "Tense", "Dark", "Grim"];
export const LIMIT_CHIPS = ["Sexual violence", "Harm to children", "Graphic gore", "Self-harm", "Animal cruelty", "Torture", "Incest", "Drug use", "Body horror", "Character death"];
export const TRACKER_SECTIONS = ["scene", "cast", "body", "bonds", "romance", "knowledge", "items", "threads", "stakes", "calendar", "motifs"];
const WESTEROS = /\b(westeros|winterfell|king'?s landing|the seven kingdoms|the wall|targaryen|stark|lannister|essos)\b/i;
const FANDOMS: [RegExp, string][] = [
  [WESTEROS, "A Song of Ice and Fire / Game of Thrones"],
  [/\b(hogwarts|gryffindor|slytherin|dumbledore)\b/i, "Harry Potter"],
  [/\b(middle-earth|the shire|mordor|gandalf|rivendell)\b/i, "The Lord of the Rings"],
  [/\b(sunnydale|slayer|buffy)\b/i, "Buffy the Vampire Slayer"],
];

const setupOf = (chatId: string) => parseJson<SetupRecord | null>(one<{ chat_setup: string | null }>("SELECT chat_setup FROM chats WHERE id = ?", chatId)?.chat_setup ?? null, null);

/** The options each page offers, from the chat's preset (so a custom preset's own choices show). */
export function setupOptions(chatId: string) {
  const chat = mustChat(chatId);
  const preset = resolvePreset(layered(parseJson<ChatSettings>(chat.settings, {}), chat.character_id).presetId);
  const choices = (id: string) => preset.controls.find((c) => c.id === id)?.options.map((o) => ({ value: o.value, label: o.label })) ?? [];
  return {
    genres: GENRES.map((g) => ({ value: g.id, label: g.label })),
    tones: TONES,
    persona: choices("persona"),
    romance: choices("romance"),
    difficulty: choices("difficulty"),
    intimacy: choices("intimacy"),
    limits: LIMIT_CHIPS,
    sections: TRACKER_SECTIONS,
    calendars: [{ value: "gregorian", label: "Our calendar" }, { value: "westeros", label: "Westeros" }, ...listCustomCalendars().map((c) => ({ value: `custom:${c.id}`, label: c.name }))],
  };
}

/** What the card, persona, lore and defaults already say: the answers you confirm. */
export function prefill(chatId: string): SetupAnswers {
  const chat = mustChat(chatId);
  const settings = parseJson<ChatSettings>(chat.settings, {});
  const layers = layered(settings, chat.character_id);
  const preset = resolvePreset(layers.presetId);
  const v = controlValues(preset.controls, layers.controls);
  const card = chat.character_id ? getCard(chat.character_id) : undefined;
  const persona = getPersona(chat.persona_id);
  const about = [card?.description, card?.personality, card?.scenario, card?.first_mes, ...(card?.tags ?? []), persona?.data.description, persona?.data.background].filter(Boolean).join(" ");
  // Genres: the chat's lead and second genre, else what the card's tags and words point to.
  const set = [v.genre, v.genre2].filter((g): g is string => typeof g === "string" && g !== "none" && Boolean(g));
  const fromCard = GENRES.filter((g) => new RegExp(`\\b(${[g.id, g.label.toLowerCase(), ...g.label.toLowerCase().split(/\s*\/\s*/)].map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`, "i").test(about)).map((g) => g.id);
  const genres = [...new Set([...(settings.controls?.genre || layers.controls.genre ? set : []), ...fromCard, ...set])].slice(0, 3);
  const tone = layers.story.tone || TONES.find((t) => new RegExp(`\\b${t}\\b`, "i").test(about)) || (/\b(dark|grim|bleak|horror)\b/i.test(about) ? "Dark" : "Warm");
  let start = "";
  try {
    const st = currentFold(chatId).result.state;
    if (st.time) start = shortStoryTime(formatStoryTime(st.time));
  } catch {
    start = "";
  }
  const fandom = FANDOMS.find(([re]) => re.test(about))?.[1];
  const canon = canonOf(chatId);
  const lim = typeof v.limits === "string" ? v.limits.split(/\s*[,;]\s*/).filter(Boolean) : [];
  return {
    genres: genres.length ? genres : [String(v.genre ?? "drama")],
    tone,
    pace: settings.pacing ?? "normal",
    persona: String(v.persona ?? "continuity"),
    romance: String(v.romance ?? "measured"),
    difficulty: String(v.difficulty ?? "grounded"),
    intimacy: String(v.intimacy ?? "fade"),
    limits: lim,
    world: {
      calendar: settings.trackers?.calendar ?? (WESTEROS.test(about) ? "westeros" : "gregorian"),
      climate: settings.world?.climate ?? "",
      tech: settings.world?.tech ?? (/\b(sword|castle|king|queen|magic|dragon)\b/i.test(about) ? "fantasy" : /\b(starship|android|cyber|orbit)\b/i.test(about) ? "future" : "modern"),
      start,
    },
    canon: { source: canon.source ?? fandom ?? "", point: canon.point ?? "" },
    trackers: { mode: settings.trackers?.mode ?? "helper", sections: Object.fromEntries(TRACKER_SECTIONS.map((k) => [k, settings.trackers?.sections?.[k] !== false])) },
    look: { accent: settings.ambience?.accent ?? true, music: settings.music?.on ?? false },
  };
}

/** The page's state: the answers (yours if saved, else pre-filled), whether to show it, and the options. */
export function setupView(chatId: string) {
  const rec = setupOf(chatId);
  const n = one<{ n: number }>("SELECT COUNT(*) AS n FROM messages WHERE chat_id = ? AND deleted_at IS NULL AND role = 'user'", chatId)?.n ?? 0;
  return {
    answers: { ...prefill(chatId), ...(rec?.answers ?? {}) } as SetupAnswers,
    done: Boolean(rec?.done),
    /** Shown on its own only when a chat starts (nothing said yet) and was never set up or skipped. */
    show: !rec && n === 0,
    usual: Boolean(getSetting("setup.usual")),
    options: setupOptions(chatId),
  };
}

const LABEL: Record<string, string> = { genres: "Genres", tone: "Tone", pace: "Pace", persona: "Who writes your character", romance: "Romance pace", difficulty: "Difficulty", intimacy: "Intimacy", limits: "Hard limits", calendar: "Calendar", climate: "Climate", tech: "World", start: "Start", canon: "Canon" };

/** What changed between two sets of answers, in words ("Tone changed to Dark"). */
function changes(a: SetupAnswers, b: SetupAnswers, opts: ReturnType<typeof setupOptions>): string[] {
  const out: string[] = [];
  const label = (k: "persona" | "romance" | "difficulty" | "intimacy", val: string) => opts[k].find((o) => o.value === val)?.label.split(" — ")[0] ?? val;
  const genre = (g: string) => opts.genres.find((x) => x.value === g)?.label ?? g;
  if (a.genres.join() !== b.genres.join()) out.push(`${LABEL.genres} changed to ${b.genres.map(genre).join(", ")}`);
  for (const k of ["tone", "pace"] as const) if (a[k] !== b[k]) out.push(`${LABEL[k]} changed to ${b[k]}`);
  for (const k of ["persona", "romance", "difficulty", "intimacy"] as const) if (a[k] !== b[k]) out.push(`${LABEL[k]} changed to ${label(k, b[k])}`);
  if (a.limits.join() !== b.limits.join()) out.push(`${LABEL.limits} changed`);
  for (const k of ["calendar", "climate", "tech"] as const) if ((a.world[k] ?? "") !== (b.world[k] ?? "") && b.world[k]) out.push(`${LABEL[k]} changed to ${b.world[k]}`);
  if ((a.canon.source ?? "") !== (b.canon.source ?? "") || (a.canon.point ?? "") !== (b.canon.point ?? "")) out.push(`${LABEL.canon} set to ${b.canon.source || "none"}${b.canon.point ? `, ${b.canon.point}` : ""}`);
  return out;
}

/** Applies the answers to the chat's settings, and records them. After the start, each change leaves a card on the timeline. */
export function applySetup(chatId: string, input: SetupAnswers) {
  const chat = mustChat(chatId);
  const answers = setupSchema.parse(input);
  const settings = parseJson<ChatSettings>(chat.settings, {});
  const before = setupView(chatId);
  const [lead, second] = answers.genres;
  updateChat(chatId, {
    settings: {
      controls: {
        ...(settings.controls ?? {}),
        ...(lead ? { genre: lead } : {}),
        genre2: second ?? "none",
        persona: answers.persona,
        romance: answers.romance,
        difficulty: answers.difficulty,
        intimacy: answers.intimacy,
        limits: answers.limits.join(", "),
      },
      story: { ...(settings.story ?? {}), tone: answers.tone },
      pacing: answers.pace,
      trackers: { ...(settings.trackers ?? {}), ...(answers.trackers.mode ? { mode: answers.trackers.mode } : {}), ...(answers.trackers.sections ? { sections: { ...(settings.trackers?.sections ?? {}), ...answers.trackers.sections } } : {}), ...(answers.world.calendar ? { calendar: answers.world.calendar } : {}) },
      world: { ...(settings.world ?? {}), genres: answers.genres, ...(answers.world.climate ? { climate: answers.world.climate } : {}), ...(answers.world.tech ? { tech: answers.world.tech } : {}) },
      ambience: { ...(settings.ambience ?? {}), ...(answers.look.accent != null ? { accent: answers.look.accent } : {}) },
      // J3: Session Zero › Look › Music on.
      ...(answers.look.music != null ? { music: { ...(settings.music ?? {}), on: answers.look.music } } : {}),
    },
  });
  if (answers.canon.source != null && (answers.canon.source !== (canonOf(chatId).source ?? "") || (answers.canon.point ?? "") !== (canonOf(chatId).point ?? ""))) setCanon(chatId, { ...canonOf(chatId), source: answers.canon.source, point: answers.canon.point ?? "" });
  const lines: string[] = [];
  if (answers.world.start && answers.world.start !== before.answers.world.start) {
    // G1: a start date in a calendar you built is read in that calendar.
    const custom = customOf(answers.world.calendar);
    const at = custom ? parseCustomDate(custom, answers.world.start) : null;
    lines.push(`clock: ${at != null ? formatStoryTime({ minutes: at, form: "date" }) : answers.world.start}`);
  }
  // After the start, each change is a card on the story's timeline.
  if (before.done) for (const c of changes(before.answers, answers, before.options)) lines.push(`milestone: Story setup · ${c}`);
  if (lines.length) {
    try {
      userEditAt(chatId, linesToOps(lines).ops);
    } catch {
      // Trackers off: the settings still changed.
    }
  }
  const rec: SetupRecord = { answers, done: true, at: Date.now() };
  run("UPDATE chats SET chat_setup = ? WHERE id = ?", JSON.stringify(rec), chatId);
  return setupView(chatId);
}

/** Skip: it won't open by itself again (Chat tab › Story setup still does). */
export function skipSetup(chatId: string) {
  mustChat(chatId);
  const rec: SetupRecord = setupOf(chatId) ?? { answers: prefill(chatId), done: false, skipped: true, at: Date.now() };
  run("UPDATE chats SET chat_setup = ? WHERE id = ?", JSON.stringify({ ...rec, skipped: true }), chatId);
  return setupView(chatId);
}

/** Save as my usual / Use my usual (start date and canon stay per story). */
export function saveUsual(answers: SetupAnswers) {
  const a = setupSchema.parse(answers);
  setSetting("setup.usual", { ...a, world: { ...a.world, start: "" }, canon: {} });
}
export function usual(): SetupAnswers | null {
  return getSetting("setup.usual");
}

/** Live preview: the card's opening, rewritten in this tone and POV (one cheap call; optional). */
export async function previewOpening(chatId: string, a: Pick<SetupAnswers, "tone" | "persona" | "genres">) {
  const chat = mustChat(chatId);
  const card = chat.character_id ? getCard(chat.character_id) : undefined;
  const opening = (card?.first_mes ?? "").slice(0, 1200);
  if (!opening.trim()) return { text: "" };
  const genre = GENRES.find((g) => g.id === a.genres[0])?.label ?? a.genres[0] ?? "";
  const pov = a.persona === "full_cast" ? "the player's character may be written too" : "never write the player's character's words or choices";
  const res = await callText({
    task: "helper",
    kind: "setup_preview",
    chatId,
    system: "You rewrite one opening paragraph of a roleplay to show a tone. Keep the people, place and events; change only the voice. Reply with the paragraph only, under 120 words.",
    user: `TONE: ${a.tone}\nGENRE: ${genre}\nPOV RULE: ${pov}\n\nOPENING:\n${opening}`,
    maxTokens: 300,
  });
  return { text: res.text.trim() };
}
