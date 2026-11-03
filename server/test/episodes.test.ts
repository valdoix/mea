import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { normalizeCard } from "../src/cards/card";
import { createCharacter } from "../src/services/characters";
import { addMessage, createChat, mustChat } from "../src/services/chats";
import { createPersona } from "../src/services/personas";
import { pauseJobs } from "../src/services/jobs";
import { newEpisode, userEdit } from "../src/trackers/service";
import { currentFold, linesToOps } from "../src/trackers/store";
import { freshDb } from "./helpers";

let chatId = "";
const edit = (lines: string[]) => userEdit(chatId, linesToOps(lines).ops);

beforeAll(() => {
  freshDb();
  pauseJobs(true);
  const { data } = normalizeCard({ spec: "chara_card_v2", data: { name: "Mira", first_mes: "The lamp is lit." } });
  chatId = createChat({ characterId: createCharacter(data), personaId: createPersona({ name: "Alex" }) }).id;
  // The status quo, at the card's opening (the chat starts with it).
  edit(["cast: Mira@spot(trimming the wick) · Alex@spot", "mood Mira: content", "bond Mira>Alex: trust 2", "item the brass key: +Mira (pocket)"]);
});
afterAll(() => pauseJobs(false));

describe("episode breaks (docs/23, part 8)", () => {
  test("a new episode puts bodies, moods, bonds and romance back, and keeps the rest", () => {
    addMessage(chatId, "user", "I tell her the truth about the wreck.", { name: "Alex" });
    addMessage(chatId, "assistant", "Mira throws the lamp. Glass everywhere.", { name: "Mira" });
    edit(["mood Mira: content → furious", "body Mira: injury: left hand, wound; soaked; fatigue 4", "bond Mira>Alex: trust 2 → -3", "ladder Mira>Alex: 3", "plant the cracked lamp — it fails in a storm"]);
    const before = currentFold(chatId).result.state;
    expect(before.chars.mira!.injuries).toHaveLength(1);

    const r = newEpisode(chatId, "Calm Seas");
    expect(r.episode).toBe(2);
    expect(r.restored).toBeGreaterThanOrEqual(3);
    const st = currentFold(chatId).result.state;
    const mira = st.chars.mira!;
    expect(mira.injuries).toEqual([]);
    expect(mira.conditions).toEqual([]);
    expect(mira.mood?.name).toBe("content");
    expect(Object.values(st.bonds).find((b) => b.from === "mira")?.axes.trust).toBe(2);
    expect(Object.values(st.ladders)[0]?.tier ?? 0).toBe(0);
    // People, things and plants stay.
    expect(Object.values(st.items).some((i) => i.name === "the brass key")).toBe(true);
    expect(Object.keys(st.plants)).toHaveLength(1);
    expect(JSON.parse(mustChat(chatId).settings ?? "{}").episodes).toMatchObject({ n: 2 });
  });

  test("the next break counts on and returns to the same baseline", () => {
    edit(["mood Mira: content → sulking"]);
    expect(newEpisode(chatId).episode).toBe(3);
    expect(currentFold(chatId).result.state.chars.mira!.mood?.name).toBe("content");
  });
});
