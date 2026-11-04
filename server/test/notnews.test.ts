import { beforeAll, describe, expect, test } from "bun:test";
import { alreadyToldRule, newsClaims, oldNews, repairRecords, undoRepair } from "../src/accuracy/notnews";
import { SLIPS } from "../src/accuracy/slips";
import "../src/accuracy/moreslips";
import { normalizeCard } from "../src/cards/card";
import { all } from "../src/db/db";
import { insertAtom } from "../src/memory/atoms";
import { createCharacter } from "../src/services/characters";
import { createPersona } from "../src/services/personas";
import { addMessage, createChat } from "../src/services/chats";
import { notNews, planCorrection } from "../src/steer/plancheck";
import type { WorldState } from "../src/trackers/types";
import { planCheckLine } from "../../shared/plan";
import { currentFold, linesToOps, writeEvents } from "../src/trackers/store";
import { freshDb } from "./helpers";

/** The cast as far as these rules read it. */
const state = {
  chars: {
    buffy: { name: "Buffy Summers", aliases: ["Buffy"], isUser: false },
    dawn: { name: "Dawn Summers", aliases: ["Dawn"], isUser: false },
    spike: { name: "Spike", aliases: [], isUser: false },
    gabriel: { name: "Gabriel Winters", aliases: ["Gabriel"], isUser: true },
  },
} as unknown as WorldState;

describe("old news", () => {
  let chatId: string;

  beforeAll(() => {
    freshDb();
    const { data } = normalizeCard({ spec: "chara_card_v2", data: { name: "Buffy Summers", description: "A Slayer.", first_mes: "Hi." } });
    chatId = createChat({ characterId: createCharacter(data), personaId: createPersona({ name: "Gabriel Winters", data: { description: "" } }) }).id;
    addMessage(chatId, "user", `"They called me *The Brongel*. Brother-angel," he says.`); // #2
    addMessage(chatId, "assistant", `"That's a whole name that exists in the world."`); // #3
    addMessage(chatId, "user", `A banner read BRONGEL FOR PRESIDENT. Dawn snorts.`); // #4
    addMessage(chatId, "assistant", `Dawn traced the banner.`); // #5
    for (let i = 0; i < 14; i++) addMessage(chatId, "user", `Sunday again, and Harmony called, take ${i}.`); // #6–#19
    addMessage(chatId, "user", `"That's Brongel for you!" "The fuck is a Brongel?" Spike asks.`); // #20
    const rows = all<{ id: string; seq: number }>("SELECT id, seq FROM messages WHERE chat_id = ? ORDER BY seq", chatId);
    const at = (seq: number) => [rows.find((r) => r.seq === seq)!];
    insertAtom(chatId, null, { type: "fact", content: "Gabriel's frat called him 'The Brongel'.", knownBy: ["Buffy Summers", "Gabriel Winters"] }, at(2));
    insertAtom(chatId, null, { type: "fact", content: "Dawn saw the Brongel banner.", knownBy: ["Buffy Summers", "Gabriel Winters", "Dawn Summers"] }, at(4));
  });

  test("a rare word's earlier messages, and who the memories say knows it", () => {
    const n = oldNews(chatId, "brongel", 20)!;
    expect(n.mentions.map((m) => m.seq)).toEqual([2, 4]);
    expect(n.mentions[0]!.passage).toContain("The Brongel");
    expect(n.knownBy).toEqual(["Buffy Summers", "Gabriel Winters", "Dawn Summers"]);
  });

  test("no answer when it's new, or too common to say", () => {
    expect(oldNews(chatId, "brongel", 2)).toBeNull();
    expect(oldNews(chatId, "portmanteau", 20)).toBeNull();
    expect(oldNews(chatId, "harmony", 20)).toBeNull();
  });

  describe("a plan that calls it new", () => {
    test("the line from #792 is corrected, with where it came up", () => {
      const found = notNews(chatId, state, "KNOW — The 'Brongel' nickname is new information (nobody knew before he said it). Dawn knows the rules.", 20);
      expect(found).toHaveLength(1);
      expect(found[0]).toMatchObject({ says: "news", who: "", seq: 2 });
      const said = planCorrection(found);
      expect(said).toContain("It came up at #2 and #4");
      expect(said).toContain("Known to Buffy Summers, Gabriel Winters, Dawn Summers");
      expect(said).toContain("they remember it, they don't find out");
      expect(planCheckLine({ ...found[0]!, says: "news", corrected: true })).toContain("The writer was told.");
    });

    test("someone who has heard it", () => {
      expect(newsClaims(chatId, state, "Dawn has never heard of Brongel.", 20).map((c) => c.who)).toEqual(["Dawn Summers"]);
    });

    test("someone who really hasn't is left alone: Spike asks what it is", () => {
      expect(newsClaims(chatId, state, "Spike has never heard of Brongel.", 20)).toEqual([]);
    });

    test("looking ahead isn't a claim about the past", () => {
      expect(newsClaims(chatId, state, "Nobody knows Brongel's next move.", 20)).toEqual([]);
    });

    test("not knowing a sentence isn't not having heard a word", () => {
      expect(newsClaims(chatId, state, "Dawn doesn't know Brongel was president.", 20)).toEqual([]);
    });

    test("something truly new is fine", () => {
      expect(newsClaims(chatId, state, "'Marisol' is new information (nobody knew before she said it).", 20)).toEqual([]);
    });

    test("the cast's own names don't count", () => {
      expect(newsClaims(chatId, state, "Nobody knew Spike had 'Brongel' on his phone.", 20).map((c) => c.news.term)).toEqual(["brongel"]);
    });
  });

  describe("a reply that calls it new", () => {
    const line = `“Brongel. *Brongel*. You had a frat nickname and it was a portmanteau and you never mentioned this? That’s a new file.”`;

    test("the line from #792 is flagged, citing the messages", () => {
      const [flag, ...rest] = alreadyToldRule(chatId, line, 21, state);
      expect(rest).toEqual([]);
      expect(flag).toMatchObject({ kind: "known", severity: "minor", by: "rules" });
      expect(flag!.claim).toContain("you never mentioned this?");
      expect(flag!.conflict).toContain("It came up at #2 and #4");
      expect(flag!.citations.map((c) => c.seq)).toEqual([2, 4]);
    });

    test("nobody here was there for it: it can truly be new to this room", () => {
      const others = { chars: { x: { id: "x", name: "Willow", aliases: [], tier: "spot" } }, presence: [{ seq: 1, who: ["z"] }, { seq: 21, who: ["x"] }] } as unknown as WorldState;
      expect(alreadyToldRule(chatId, line, 21, others)).toEqual([]);
      const there = { chars: { x: { id: "x", name: "Willow", aliases: [], tier: "spot" } }, presence: [{ seq: 1, who: ["x"] }] } as unknown as WorldState;
      expect(alreadyToldRule(chatId, line, 21, there)).toHaveLength(1);
    });

    test("no flag without the words, or when the page hasn't said it", () => {
      expect(alreadyToldRule(chatId, `“Brongel. *Brongel*. That’s a whole name.”`, 21, state)).toEqual([]);
      expect(alreadyToldRule(chatId, `“Marisol? You never mentioned Marisol.”`, 21, state)).toEqual([]);
    });

    test("#299: someone not saying a thing isn't someone never told", () => {
      expect(alreadyToldRule(chatId, `You knew about Brongel and you didn't say anything.`, 21, state)).toEqual([]);
    });

    test("a different paragraph isn't what they mean", () => {
      expect(alreadyToldRule(chatId, `“Brongel.”\n\n“You never told me you could swim.”`, 21, state)).toEqual([]);
    });

    test("it's in the registry for assistant replies", () => {
      const slip = SLIPS.find((s) => s.id === "known")!;
      expect(slip.phase).toBe("reply");
      expect(slip.on({ role: "assistant" } as never)).toBe(true);
      expect(slip.on({ role: "user" } as never)).toBe(false);
    });
  });

  describe("putting the records right (docs/26 5.3)", () => {
    const stance = (fact: string, id: string) => Object.values(currentFold(chatId).result.state.facts).find((f) => f.statement.includes(fact))?.stances[id];
    const beat = () => currentFold(chatId).result.state.beats.at(-1)?.text;

    test("who knew and since when, the beat reworded, and all of it taken back", async () => {
      const reply = addMessage(chatId, "assistant", "“Brongel. You had a nickname and you never mentioned this?”");
      const seq = all<{ seq: number }>("SELECT seq FROM messages WHERE id = ?", reply)[0]!.seq;
      writeEvents(chatId, { messageId: reply, swipeIdx: 0 }, linesToOps(["cast: Buffy Summers@spot · Dawn Summers@spot · Spike@spot", 'know everyone: frat nickname "Brongel" — he said it aloud', 'beat: Gabriel reveals frat nickname "Brongel"; Buffy files it']).ops, "model");
      expect(beat()).toContain("reveals");
      expect(stance("Brongel", "buffy-summers")?.seq).toBe(seq);

      // A later memory calls the same people by other names, and one by a name that's nobody in the story.
      insertAtom(chatId, null, { type: "fact", content: "They said Brongel again at the table.", knownBy: ["Buffy", "Dawn", "Spike", "Xander"] }, [{ id: reply, seq: seq - 1 }]);
      const before = currentFold(chatId).result.state;
      const repair = repairRecords(chatId, "brongel", seq, reply, 0);
      expect(repair.knew).toEqual([{ name: "Buffy Summers", seq: 2 }, { name: "Dawn Summers", seq: 4 }, { name: "Spike", seq: seq - 1 }]);
      expect(Object.values(currentFold(chatId).result.state.chars).map((c) => c.name)).not.toContain("Xander");
      expect(beat()).toBe('Gabriel brings up frat nickname "Brongel"; Buffy files it');
      expect(stance("Brongel", "buffy-summers")?.seq).toBe(2);
      expect(stance("Brongel", "dawn-summers")?.seq).toBe(4);
      expect(stance("Brongel", "spike")?.seq).toBe(seq - 1);
      expect(Object.values(currentFold(chatId).result.state.facts).filter((f) => f.statement.includes("Brongel"))).toHaveLength(1);

      undoRepair(chatId, repair);
      expect(beat()).toContain("reveals");
      expect(stance("Brongel", "buffy-summers")?.seq).toBe(seq);
      expect(Object.keys(currentFold(chatId).result.state.facts)).toEqual(Object.keys(before.facts));
    });
  });
});
