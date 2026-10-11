import { all, parseJson } from "../db/db";
import { type ChatSettings, mustChat } from "../services/chats";
import { parseStoryTime } from "./clock";
import { currentFold, foldAt } from "./store";

/**
 * Scene plates (Almanac plan J1): the place, weather and hour the story stood at, message by
 * message, so the chat can draw a plate at each new scene (and the current scene's plate can follow
 * the clock). Only the moments something changed are listed. Your "This place is…" corrections
 * (chat settings `placeKinds`) ride along.
 */

export interface PlateState {
  seq: number;
  place: string[];
  weather: string | null;
  hour: number | null;
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
  if (place.length || weather || hour != null) out.push({ seq: 0, place: [...place], weather, hour });
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
      } else if (c.kind === "clock" && c.to) {
        const t = parseStoryTime(String(c.to));
        if (t) {
          hour = (((t.minutes % 1440) + 1440) % 1440) / 60;
          moved = true;
        }
      }
    }
    if (moved) out.push({ seq: m.seq, place: [...place], weather, hour });
  }
  return { states: out, kinds: parseJson<ChatSettings>(chat.settings, {}).placeKinds ?? {} };
}
