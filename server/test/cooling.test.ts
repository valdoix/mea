import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { normalizeCard } from "../src/cards/card";
import { extractSpeakers, mendMarks } from "../src/lib/speakers";
import { ownLines } from "../src/memory/journals";
import { createCharacter } from "../src/services/characters";
import {
  addMessage,
  createChat,
  getMessageRow,
  getSwipes,
  updateChat,
  updateSwipe,
} from "../src/services/chats";
import { pauseJobs, registerJob } from "../src/services/jobs";
import {
  coolingLine,
  coolingList,
  coolingOn,
  endsAnswerable,
  turnNote,
} from "../src/steer/cooling";
import { setCraft } from "../src/steer/craft";
import { tidyReply } from "../src/steer/tidy";
import { freshDb } from "./helpers";

/** docs/33 Part 10: prose habits cool on their own. */
let charId = "";

/** A reply with its speaker lines saved, as a finished take has them. */
function reply(
  chatId: string,
  text: string,
  lines: { name: string; text: string }[] = [],
) {
  const id = addMessage(chatId, "assistant", text, { name: "Buffy" });
  const s = getSwipes(id)[0]!;
  updateSwipe(id, s.idx, { meta: { speakers: lines } });
  return id;
}

beforeAll(() => {
  freshDb();
  pauseJobs(true);
  for (const kind of [
    "memory.segment",
    "memory.build",
    "memory.embed",
    "memory.journal",
    "accuracy.check",
    "tracker.update",
    "lessons.learn",
    "offpage.reword",
  ])
    registerJob(kind, async () => {});
  const { data } = normalizeCard({
    spec: "chara_card_v2",
    data: { name: "Buffy", first_mes: "Hi." },
  });
  charId = createCharacter(data);
});
afterAll(() => pauseJobs(false));

describe("the cooling list (the done-when fixture)", () => {
  test("every reply uses 'ruling' and 'docket': by reply 12 the courtroom family is cooling, and only its owner may use it", () => {
    const id = createChat({ characterId: charId }).id;
    // The coach is paused, as it was in Buffy × Gabriel: cooling runs anyway.
    setCraft(id, { paused: true });
    const says = (i: number) =>
      `"The ruling stands, and it's on the docket, item ${i}," Buffy says.`;
    // (The card's greeting is the first reply.)
    for (let i = 1; i <= 6; i++)
      reply(id, `${says(i)} Dawn rolls her eyes. "Fine."`, [
        { name: "Buffy", text: says(i) },
        { name: "Dawn", text: '"Fine."' },
      ]);
    // Seven replies is too few to measure.
    expect(coolingList(id)).toEqual([]);
    for (let i = 7; i <= 11; i++)
      reply(id, `${says(i)} Dawn rolls her eyes. "Fine."`, [
        { name: "Buffy", text: says(i) },
        { name: "Dawn", text: '"Fine."' },
      ]);
    const court = coolingList(id).find((c) => c.key === "cool:court")!;
    expect(court).toMatchObject({
      kind: "family",
      n: 11,
      of: 12,
      owner: "Buffy",
    });
    expect(court.used.slice(0, 2).sort()).toEqual(["docket", "ruling"]);
    const line = coolingLine(court);
    expect(line).toContain("courtroom words (");
    expect(line).toContain("only Buffy may use it");
    expect(line).toContain("nobody else");
    expect(line).not.toContain("Dawn");
  });

  test("said by everyone, a family has no owner and rests for everybody; it comes off when it fades", () => {
    const id = createChat({ characterId: charId }).id;
    for (let i = 0; i < 10; i++)
      reply(
        id,
        `She filed it under ours. "Filed," Dawn says. "Filed," Spike says.`,
        [
          { name: "Dawn", text: '"Filed,"' },
          { name: "Spike", text: '"Filed,"' },
        ],
      );
    const filing = coolingList(id).find((c) => c.key === "cool:filing")!;
    expect(filing.owner).toBeUndefined();
    expect(coolingLine(filing)).toContain("Leave it out of this reply.");
    // Twenty quiet replies later it has faded.
    for (let i = 0; i < 20; i++)
      reply(id, `She sets the cup down. "Okay," she says, ${i}.`);
    expect(coolingList(id).some((c) => c.key === "cool:filing")).toBe(false);
  });

  test("a sentence shape, and a phrase while the coach is paused", () => {
    const id = createChat({ characterId: charId }).id;
    setCraft(id, { paused: true });
    for (let i = 0; i < 10; i++)
      reply(
        id,
        `Not a ghost. Not a dream. Her hand finds his sleeve, number ${i}.`,
      );
    const keys = coolingList(id).map((c) => c.key);
    expect(keys).toContain("cool:shape:not-not");
    expect(
      keys.some(
        (k) => k.startsWith("cool:phrase:") && k.includes("hand finds"),
      ),
    ).toBe(true);
  });

  test("It's fine keeps one off the list, and cooling has its own switch", () => {
    const id = createChat({ characterId: charId }).id;
    for (let i = 0; i < 10; i++)
      reply(id, `"Overruled," she says. The docket waits, ${i}.`);
    expect(coolingList(id).some((c) => c.key === "cool:court")).toBe(true);
    setCraft(id, { ignore: "cool:court" });
    expect(coolingList(id).some((c) => c.key === "cool:court")).toBe(false);
    expect(coolingOn(id)).toBe(true);
    setCraft(id, { cooling: false });
    expect(coolingOn(id)).toBe(false);
  });
});

describe("length follows the turn, and the reply ends on something to answer (10.4)", () => {
  test("a short turn asks for a short reply, unless you set a length", () => {
    const id = createChat({ characterId: charId }).id;
    reply(id, "The kitchen is quiet.");
    addMessage(id, "user", "Morning. Coffee?");
    expect(turnNote(id)).toContain(
      "turn was 2 words: answer in kind, about 150 words at most",
    );
    updateChat(id, { settings: { length: "long" } });
    expect(turnNote(id)).not.toContain("answer in kind");
  });

  test("replies that keep ending on the room are told to end on something to answer", () => {
    const id = createChat({ characterId: charId }).id;
    for (let i = 0; i < 8; i++)
      reply(
        id,
        `"Hi," she says.\n\nThe fridge hums in the dark kitchen, ${i}.`,
      );
    expect(turnNote(id)).toMatch(
      /\d of the last \d replies ended on the room\. End this one on something You can answer/,
    );
    expect(endsAnswerable('The room is quiet.\n\n"Are you coming?"')).toBe(
      true,
    );
    expect(
      endsAnswerable("The room is quiet.\n\nShe looks up. Is he coming?"),
    ).toBe(true);
    expect(endsAnswerable('"Hi."\n\nThe light goes amber on the tile.')).toBe(
      false,
    );
  });
});

describe("the tidy pass (10.5)", () => {
  test("a toolkit closer written with its attributes reads as a closer", () => {
    expect(
      tidyReply('<mind of mood="love">mine</mind of mood="love">\nShe smiles.')
        .text,
    ).toBe('<mind of mood="love">mine</mind>\nShe smiles.');
  });

  test("a sentence said twice back to back is said once", () => {
    const t = tidyReply(
      "She puts the spoon down beside the bowl. She puts the spoon down beside the bowl. Then she looks up.",
    );
    expect(t.text).toBe(
      "She puts the spoon down beside the bowl. Then she looks up.",
    );
    expect(t.fixes).toEqual(["repeat"]);
    // A short echo is a voice, not a slip.
    expect(tidyReply("No. No. Not tonight.").text).toBe("No. No. Not tonight.");
  });

  test("a stray word from another script goes; a kaomoji and a <mind> keep theirs", () => {
    const body = [1, 2, 3]
      .map(
        (n) =>
          `She folds her hands on the table and waits for the kettle to finish its long climb toward a boil, counting ${n} tiles. `,
      )
      .join("");
    expect(tidyReply(`${body}She whispers a 祈祷 and lets it go.`).text).toBe(
      `${body}She whispers a and lets it go.`,
    );
    expect(tidyReply(`${body}She shrugs (ツ) at him.`).fixes).not.toContain(
      "script",
    );
    expect(
      tidyReply(`${body}<mind of mood="panic">!! ヤバい</mind>`).fixes,
    ).not.toContain("script");
  });

  test("stray speaker-mark closers ([//spk], [c/spk]) close their line", () => {
    expect(mendMarks('[spk=Buffy]"Hi."[//spk]')).toBe('[spk=Buffy]"Hi."[/spk]');
    expect(mendMarks('[spk=Buffy]"Hi."[c/spk]')).toBe('[spk=Buffy]"Hi."[/spk]');
    expect(extractSpeakers('[spk=Buffy]"Hi."[//spk] She waves.').text).toBe(
      '"Hi." She waves.',
    );
  });
});

describe("journals in their own voice (10.3)", () => {
  test("a person's own lines in their scenes, never anyone else's", () => {
    const id = createChat({ characterId: charId }).id;
    const x = reply(id, "x", [
      { name: "Dawn", text: '"I am not a child, I am a whole person."' },
      { name: "Buffy", text: '"Ruling: overruled, counselor."' },
    ]);
    const y = reply(id, "y", [
      { name: "Dawn", text: '"Pancakes are a human right."' },
    ]);
    const lines = ownLines(id, new Set(["dawn"]), [{ from: 1, to: 99 }]);
    expect(lines).toEqual([
      '"I am not a child, I am a whole person."',
      '"Pancakes are a human right."',
    ]);
    const seq = getMessageRow(y)!.seq;
    expect(getMessageRow(x)!.seq).toBe(seq - 1);
    expect(ownLines(id, new Set(["dawn"]), [{ from: seq, to: seq }])).toEqual([
      '"Pancakes are a human right."',
    ]);
  });
});
