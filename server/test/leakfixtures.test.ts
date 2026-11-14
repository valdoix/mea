import { beforeAll, describe, expect, test } from "bun:test";
import { ruleCheck } from "../src/accuracy/checker";
import { normalizeCard } from "../src/cards/card";
import { createCharacter } from "../src/services/characters";
import { addMessage, createChat } from "../src/services/chats";
import { currentFold, linesToOps, writeEvents } from "../src/trackers/store";
import fixtures from "./fixtures/leaks.json";
import { freshDb } from "./helpers";

/**
 * docs/35 Part 6.1: every leak flag the rule raised in a real story, rebuilt from the tracker state
 * it was raised on, and the true leaks it must still catch. A wrong flag goes in here before the fix.
 */
interface Case {
  story: string;
  seq?: number;
  note?: string;
  speaker: string;
  who: string;
  secret: string;
  lines: string[];
  sentence: string;
  leak: boolean;
  todo?: string;
}

const cases = (fixtures as { cases: Case[] }).cases;
const chats = new Map<Case, string>();

beforeAll(() => {
  freshDb();
  for (const c of cases) {
    const { data } = normalizeCard({ spec: "chara_card_v2", data: { name: c.speaker, description: "", first_mes: "Hello." } });
    const chatId = createChat({ characterId: createCharacter(data) }).id;
    const msg = addMessage(chatId, "assistant", "Hello.", { name: c.speaker });
    writeEvents(chatId, { messageId: msg, swipeIdx: -1 }, linesToOps(c.lines).ops, "model");
    chats.set(c, chatId);
  }
});

const flagged = (c: Case) => {
  const chatId = chats.get(c)!;
  return ruleCheck(chatId, c.sentence, currentFold(chatId).result.state, { speaker: c.speaker, leaks: true, names: false }).filter(
    (i) => i.kind === "leak" && i.citations[0]?.label === `secret: ${c.secret}`,
  );
};

describe("leak flags from real stories (docs/35 Part 6)", () => {
  for (const c of cases) {
    const name = `${c.story}${c.seq ? ` #${c.seq}` : ""}: ${c.leak ? "catches" : "doesn't flag"} ${c.who} — ${c.note ?? c.sentence.slice(0, 60)}`;
    if (c.todo) {
      test.todo(`${name} (${c.todo})`, () => expect(flagged(c).length).toBeGreaterThan(0));
      continue;
    }
    test(name, () => {
      const got = flagged(c);
      if (c.leak) expect(got.map((i) => i.conflict).join(" ")).toContain(c.who);
      else expect(got.map((i) => i.conflict)).toEqual([]);
    });
  }
});
