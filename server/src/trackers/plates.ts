import { all, parseJson } from "../db/db";
import { type ChatSettings, mustChat } from "../services/chats";
import { parseStoryTime } from "./clock";
import { calendarToday } from "./note";
import { currentFold, foldAt, trackerConfig } from "./store";

/**
 * Scene plates (Almanac plan J1): the place, weather and hour the story stood at, message by
 * message, so the chat can draw a plate at each new scene (and the current scene's plate can follow
 * the clock). Only the moments something changed are listed. Your "This place is…" corrections
 * (chat settings `placeKinds`) ride along, and the chat's calendar, because a Westeros chat reads its
 * places as Westeros. docs/25 §4.2: so does what might make a scene an occasion.
 */

export interface PlateState {
  seq: number;
  place: string[];
  weather: string | null;
  hour: number | null;
  /** Story minutes, for calendar entries with a time. */
  minutes: number | null;
  /** An event under way, in the model's words. */
  occasion: string | null;
}

export function scenePlates(chatId: string) {
  const chat = mustChat(chatId);
  const fold = currentFold(chatId).result;
  const msgs = all<{ id: string; seq: number }>("SELECT id, seq FROM messages WHERE chat_id = ? AND deleted_at IS NULL ORDER BY seq", chatId);
  const out: PlateState[] = [];
  // Where the story starts (the opening's records aren't tied to a message).
  const start = foldAt(chatId, { uptoSeq: 0 }).state;
  let place: string[] = [...start.place];
  let weather: string | null = start.weather?.now ?? null;
  let hour: number | null = start.time ? (((start.time.minutes % 1440) + 1440) % 1440) / 60 : null;
  let minutes: number | null = start.time?.minutes ?? null;
  let occasion: string | null = start.occasion?.now ?? null;
  if (place.length || weather || hour != null) out.push({ seq: 0, place: [...place], weather, hour, minutes, occasion });
  for (const m of msgs) {
    const changes = fold.changes[m.id] ?? [];
    let moved = false;
    for (const c of changes) {
      if (c.kind === "place" && c.to) {
        place = String(c.to).split(/\s*›\s*/).filter(Boolean);
        moved = true;
      } else if (c.kind === "weather" && c.to) {
        weather = String(c.to);
        moved = true;
      } else if (c.kind === "occasion") {
        occasion = c.to ? String(c.to) : null;
        moved = true;
      } else if (c.kind === "clock" && c.to) {
        const t = parseStoryTime(String(c.to));
        if (t) {
          hour = (((t.minutes % 1440) + 1440) % 1440) / 60;
          minutes = t.minutes;
          moved = true;
        }
      }
    }
    if (moved) out.push({ seq: m.seq, place: [...place], weather, hour, minutes, occasion });
  }
  const settings = parseJson<ChatSettings>(chat.settings, {});
  const dated = Object.values(fold.state.calendar)
    .filter((e) => e.at != null && !e.done)
    .map((e) => ({ title: e.title, at: e.at! }));
  return { states: out, kinds: settings.placeKinds ?? {}, styles: settings.houseStyles ?? {}, keeps: settings.keepStyles ?? {}, occasions: settings.occasionFixes ?? {}, dated, today: calendarToday(fold.state), calendar: trackerConfig(chatId).calendar };
}
