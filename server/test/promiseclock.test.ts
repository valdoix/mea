import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { normalizeCard } from "../src/cards/card";
import { createCharacter } from "../src/services/characters";
import { addMessage, createChat } from "../src/services/chats";
import { pauseJobs, registerJob } from "../src/services/jobs";
import { restated } from "../src/trackers/fold";
import { currentFold, linesToOps, writeEvents } from "../src/trackers/store";
import { freshDb } from "./helpers";

/** docs/20 Part 0: promises the clock can't misread, said once even when said twice. */

let chatId = "";

function say(text: string, lines: string[] = []) {
  const id = addMessage(chatId, "assistant", text, { name: "Buffy" });
  if (lines.length) writeEvents(chatId, { messageId: id, swipeIdx: 0 }, linesToOps(lines).ops, "model");
  return id;
}
const state = () => currentFold(chatId).result.state;
const promises = () => Object.values(state().obligations).filter((o) => o.kind === "promise");
const dawnTrust = () => {
  const dawn = Object.values(state().chars).find((c) => c.name === "Dawn")!;
  const buffy = Object.values(state().chars).find((c) => c.name === "Buffy")!;
  return state().bonds[`${dawn.id}>${buffy.id}`]?.axes ?? {};
};

beforeAll(() => {
  freshDb();
  pauseJobs(true);
  for (const kind of ["memory.segment", "memory.build", "memory.embed", "accuracy.check", "tracker.update", "offpage.reword", "lessons.learn"]) registerJob(kind, async () => {});
  const { data } = normalizeCard({ spec: "chara_card_v2", data: { name: "Buffy", first_mes: "Revello Drive." } });
  chatId = createChat({ characterId: createCharacter(data) }).id;
  const first = addMessage(chatId, "assistant", "Revello Drive.", { name: "Buffy" });
  writeEvents(chatId, { messageId: first, swipeIdx: -1 }, linesToOps(["clock: 2001-10-11 13:10", "at: Sunnydale › Gabriel's car", "cast: Buffy@spot"]).ops, "model");
});
afterAll(() => pauseJobs(false));

describe("the promise clock (docs/20 Part 0)", () => {
  test("a promise to one person said again to another is one promise", () => {
    expect(restated("tell Dawn about the jealousy question at dinner", "You", "the jealousy/Spike story at dinner, 15:05", "Dawn")).toBe(true);
    // A shared listener isn't enough: two promises to Gabriel both name him.
    expect(restated("come upstairs, fast, one minute", "Gabriel Winters", "tell Dawn about the jealousy question at dinner", "Gabriel Winters")).toBe(false);
    // Naming the other's listener isn't enough without the promise itself in common.
    expect(restated("say the word tonight, after Dawn's dinner", "Gabriel", "tacos every Friday at 15:00", "Dawn")).toBe(false);

    say("“No. And Dawn's hearing about this at dinner.”", ["promise Buffy → You: tell Dawn about the jealousy question at dinner | open [due tonight, dinner]"]);
    say("They pick Dawn up.", ["clock: 2001-10-11 14:58", "cast: Buffy@spot, Dawn@spot", "promise Buffy → Dawn: the jealousy/Spike story at dinner, 15:05 | open [due Day 1 15:05]"]);
    const ps = promises();
    expect(ps).toHaveLength(1);
    expect(ps[0]!.what).toBe("tell Dawn about the jealousy question at dinner");
    expect(ps[0]!.due?.text).toBe("Day 1 15:05");
  });

  test("a day count on a calendar clock is today's time, not year one's: the promise isn't broken on arrival", () => {
    const p = promises()[0]!;
    expect(p.status).toBe("open");
    // 15:05 on the day the clock is on.
    expect(p.due!.minutes! - state().time!.minutes).toBe(7);
    expect(dawnTrust().trust ?? 0).toBe(0);
  });

  test("kept in either wording, the one promise is kept", () => {
    say("“So. This morning…”", ["clock: 2001-10-11 15:15", "promise Buffy → Dawn: the jealousy/Spike story at dinner, 15:05 | kept"]);
    expect(promises().map((p) => p.status)).toEqual(["kept"]);
  });

  test("a time already behind the clock when it was promised isn't broken until its window after that", () => {
    say("“Story time at three, Dawnie.”", ["clock: 2001-10-11 15:20", "promise Buffy → Dawn: the move talk at three | open [due 2001-10-11 15:00]"]);
    // A day after 15:00, but not yet a day after it was promised at 15:20.
    say("Later.", ["clock: 2001-10-12 15:10"]);
    expect(promises().find((p) => /move talk/.test(p.what))!.status).toBe("due");
    say("Much later.", ["clock: 2001-10-12 15:30"]);
    expect(promises().find((p) => /move talk/.test(p.what))!.status).toBe("broken");
  });
});
