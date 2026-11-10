import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import "../src/accuracy/moreslips";
import { weatherRule } from "../src/accuracy/worldslips";
import { normalizeCard } from "../src/cards/card";
import { createCharacter } from "../src/services/characters";
import { addMessage, createChat } from "../src/services/chats";
import { pauseJobs, registerJob } from "../src/services/jobs";
import { storyWeather, worldLane, worldView } from "../src/sim/service";
import { outOfClimate, skyLine, weatherAt } from "../src/sim/sky";
import { currentFold, linesToOps, writeEvents } from "../src/trackers/store";
import { wxKind } from "../src/trackers/weather";
import { freshDb } from "./helpers";

let chatId = "";
function reply(lines: string[]) {
  const id = addMessage(chatId, "assistant", "…", { name: "Buffy" });
  writeEvents(chatId, { messageId: id, swipeIdx: 0 }, linesToOps(lines).ops, "model");
  return id;
}
const state = () => currentFold(chatId).result.state;
const SUNNYDALE = { climate: "mediterranean", latitude: 34 };

beforeAll(() => {
  freshDb();
  pauseJobs(true);
  for (const kind of ["memory.segment", "memory.build", "memory.embed", "accuracy.check", "tracker.update", "offpage.reword", "lessons.learn"]) registerJob(kind, async () => {});
  const { data } = normalizeCard({ spec: "chara_card_v2", data: { name: "Buffy", description: "The Slayer, back in Sunnydale, California.", first_mes: "Hi." } });
  chatId = createChat({ characterId: createCharacter(data) }).id;
  reply(["clock: 2001-10-15 08:05", "at: Sunnydale › Ice rink", "scene: the rink", "cast: Buffy@spot"]);
});
afterAll(() => pauseJobs(false));

describe("weather is weather (docs/33 Part 13)", () => {
  test("light, mood and a room's air are told from weather", () => {
    expect(wxKind("kitchen half-dark, fridge hum")).toBe("light");
    expect(wxKind("first thin gold on the kitchen tile")).toBe("light");
    expect(wxKind("mall waking — shutters rattling up")).toBe("light");
    expect(wxKind("cold clean air off the ice")).toBe("indoor");
    expect(wxKind("sixty-two degrees in the house")).toBe("indoor");
    expect(wxKind("rain on the kitchen window")).toBe("weather");
    expect(wxKind("full morning sun")).toBe("weather");
    expect(wxKind("overcast, wind off the sea")).toBe("weather");
    expect(wxKind("frost on the car")).toBe("weather");
  });

  test("a light line leaves the forecast in place", () => {
    reply(["wx: kitchen half-dark, fridge hum"]);
    expect(state().weather).toBeNull();
    expect(state().light?.text).toBe("kitchen half-dark, fridge hum");
    const forecast = weatherAt({ seed: chatId, minutes: state().time!.minutes, form: "date", ...SUNNYDALE }).text;
    expect(worldLane(chatId)).toContain(`SKY: ${forecast}, `);
  });

  test("a room's air is carried as indoors, and only in that room", () => {
    reply(["wx: cold clean air off the ice"]);
    expect(state().weather).toBeNull();
    expect(worldLane(chatId)).toContain("indoors: cold clean air off the ice");
    reply(["clock: +6h", "at: Sunnydale › Hills house › Living room", "scene: darts"]);
    expect(worldLane(chatId)).not.toContain("off the ice");
    // An October afternoon in Sunnydale: the forecast, a mediterranean temperature, autumn.
    const line = worldLane(chatId)!.split("\n")[0]!;
    expect(line).toMatch(/^SKY: [a-z ,]+, (1[4-9]|2\d)°C · sunset \d\d:\d\d · autumn$/);
  });

  test("weather the climate can't have is not taken as the sky's anchor", () => {
    reply(["wx: frost on the car"]);
    const wx = storyWeather(state(), SUNNYDALE);
    expect(wx.ok).toBe(false);
    expect(wx.doubt).toContain("14°C");
    expect(worldLane(chatId)).not.toContain("frost");
    expect(worldView(chatId).sky?.doubt).toContain("frost on the car");
  });

  test("real weather is taken, in the story's words while fresh, then the sky moves on", () => {
    reply(["wx: thin rain off the sea"]);
    expect(storyWeather(state(), SUNNYDALE).ok).toBe(true);
    expect(worldLane(chatId)).toContain("SKY: thin rain off the sea, ");
    reply(["clock: +9h"]);
    expect(worldLane(chatId)).not.toContain("thin rain off the sea");
  });

  test("the range check", () => {
    expect(outOfClimate("frost on the hoods", "mediterranean", 288, 34)).toBeTruthy();
    expect(outOfClimate("frost on the hoods", "continental", 288, 41)).toBeNull();
    expect(outOfClimate("clear, 62°F", "mediterranean", 288, 34)).toBeNull();
    expect(outOfClimate("clear, 38°C", "mediterranean", 288, 34)).toBeTruthy();
    expect(outOfClimate("light rain", "mediterranean", 288, 34)).toBeNull();
  });

  test("the sky line never repeats a stated temperature", () => {
    const inp = { seed: "s", minutes: 1000, form: "day" as const, climate: "maritime", latitude: 50, anchor: { minutes: 990, text: "clear, 12°C" } };
    expect(skyLine(inp, "clear, 12°C").line.match(/°C/g)).toHaveLength(1);
  });

  test("a reply writing frost in a warm autumn is flagged; a memory of snow is not", () => {
    const st = state();
    expect(weatherRule("Frost burns off the hoods in the lot.", st, SUNNYDALE)[0]?.kind).toBe("weather");
    expect(weatherRule("She remembers snow, once, the Christmas Angel didn't die.", st, SUNNYDALE)).toHaveLength(0);
    expect(weatherRule("The frosted glass of the bathroom door.", st, SUNNYDALE)).toHaveLength(0);
    expect(weatherRule("Frost burns off the hoods in the lot.", st, { climate: "continental", latitude: 41 })).toHaveLength(0);
  });
});
