import { beforeAll, describe, expect, test } from "bun:test";
import { normalizeCard } from "../src/cards/card";
import { cardPieces, correctionsLane, correctMemory, personaPieces } from "../src/accuracy/corrections";
import { agoPhrase, findOpening, findOutdated } from "../src/accuracy/promptcheck";
import { newId, now, run } from "../src/db/db";
import { activateLore, type ScanEntry } from "../src/lore/activate";
import { factLine } from "../src/lore/facts";
import { loreSecretLinks, secretRevealer, setSecretLink } from "../src/lore/secretlinks";
import { defaultEntry } from "../src/lore/types";
import { telescope } from "../src/memory/context";
import { createCharacter } from "../src/services/characters";
import { createChat } from "../src/services/chats";
import { parseLine } from "../src/trackers/dsl";
import { type FoldConfig, foldEvents, type TrackerEvent } from "../src/trackers/fold";
import { revealsOf } from "../src/trackers/reveals";
import { STARTER_TEMPLATES } from "../src/trackers/schema";
import { freshDb } from "./helpers";

/** Reliable state, Part 2 (docs/16): linked secrets. */
const cfg: FoldConfig = { userName: "Alex", mainName: "Jackie", sealedPersona: true, romance: "slow", strictness: "lenient", limits: true, templates: STARTER_TEMPLATES };
let n = 0;
const fold = (messages: string[][]) =>
  foldEvents(
    messages.flatMap((lines, i) => lines.map((l): TrackerEvent => ({ id: `e${++n}`, messageId: `m${i + 1}`, seq: i + 1, source: "model", op: parseLine(l)! }))),
    cfg,
  ).state;
const story = () =>
  fold([
    ["cast: Jackie@spot · Shauna@spot · Jeff@spot", "secret #js: Jeff is sleeping with Shauna, Shauna is pregnant | kept by Jeff, Shauna · from Jackie", "secret #journal: Shauna keeps a coded journal of the affair | kept by Shauna · from Jackie"],
    ["clock: +1h"],
    ["reveal #js: to Jackie — Shauna told her"],
  ]);
const entry = (secrets: { text: string; knownBy: string[] }[]): ScanEntry => ({ ...defaultEntry({ keys: ["Shauna"], comment: "Shauna", content: "Jackie's best friend.", extra: { secrets } }), id: `x${n++}`, bookId: "b", bookName: "Book", book: {} });

let chatId = "";
beforeAll(() => {
  freshDb();
  const { data } = normalizeCard({ spec: "chara_card_v2", data: { name: "Jackie", description: "Captain.", first_mes: "Hi." } });
  chatId = createChat({ characterId: createCharacter(data) }).id;
});

describe("lore secrets link to tracker facts (2.1)", () => {
  test("found by their words, offered when close, and yours to change", () => {
    const st = story();
    const e = entry([
      { text: "Jackie does not know Jeff is sleeping with Shauna.", knownBy: ["Jeff", "Shauna"] },
      { text: "Shauna writes about the affair in her journal in code.", knownBy: ["Shauna"] },
      { text: "Shauna once stole a trophy.", knownBy: ["Shauna"] },
    ]);
    const links = loreSecretLinks(chatId, st, [e]);
    expect(links.map((l) => [l.fact, l.by])).toEqual([["js", "match"], ["journal", "match"], [null, null]]);

    // Unlinked by you: no longer treated as this fact, and the prompt says it's still a secret.
    setSecretLink(chatId, `${e.id}:0`, null);
    expect(loreSecretLinks(chatId, st, [e])[0]).toMatchObject({ fact: null, unlinked: true, near: "js" });
    expect(secretRevealer(chatId, st, [e])(e.id, 0)).toBeUndefined();
    // Linked by you, to a fact its words don't point at.
    setSecretLink(chatId, `${e.id}:2`, "js");
    expect(loreSecretLinks(chatId, st, [e])[2]).toMatchObject({ fact: "js", by: "you" });
    expect(secretRevealer(chatId, st, [e])(e.id, 2)?.to).toEqual(["Jackie"]);
    setSecretLink(chatId, `${e.id}:0`, "auto");
    expect(loreSecretLinks(chatId, st, [e])[0]).toMatchObject({ fact: "js", by: "match" });
    setSecretLink(chatId, `${e.id}:2`, "auto");
  });

  test("the prompt follows the link, not the words", () => {
    const st = story();
    const e = entry([{ text: "Jackie does not know Jeff is sleeping with Shauna.", knownBy: ["Jeff", "Shauna"] }, { text: "Shauna once stole a trophy.", knownBy: ["Shauna"] }]);
    setSecretLink(chatId, `${e.id}:1`, "js");
    const out = activateLore({ entries: [e], history: ["Shauna sits down."], messageCount: 3, state: {}, defaults: { scanDepth: 4, tokenBudget: 2000, recursive: false, maxRecursion: 0, caseSensitive: false, matchWholeWords: true }, countTokens: (s) => s.length, reveals: revealsOf(st), secretReveal: secretRevealer(chatId, st, [e]) }).activated[0]!.content;
    expect(out).toContain("No longer a secret (once known only to Jeff, Shauna): it came out in the story, and Jackie found out. Written before that, so who \"doesn't know\" here is out of date: Jackie does not know");
    expect(out).toContain("No longer a secret (once known only to Shauna): it came out in the story, and Jackie found out. Written before that, so who \"doesn't know\" here is out of date: Shauna once stole a trophy.");
    setSecretLink(chatId, `${e.id}:1`, "auto");
  });
});

test("a secret Now: fact follows the reveal (2.2)", () => {
  expect(factLine({ slot: null, value: "Pregnant with Jeff's baby", knownBy: ["Shauna"], status: "active" })).toBe("Pregnant with Jeff's baby [secret — known only to Shauna]");
  expect(factLine({ slot: null, value: "Pregnant with Jeff's baby", knownBy: ["Shauna"], status: "active", revealedTo: ["Jackie"], out: true })).toBe("Pregnant with Jeff's baby [no longer a secret — once known only to Shauna; Jackie found out]");
  expect(factLine({ slot: null, value: "x", knownBy: ["Shauna"], status: "active", revealedTo: ["Jackie"], out: false })).toBe("x [secret — known to Shauna, and since revealed to Jackie]");
});

test("card sentences that still call it hidden (2.3)", () => {
  const card =
    "Jackie is the captain. She does not yet know about Jeff and Shauna or about Edwin Holloway; when either surfaces, it hits her hard. Shauna is pregnant with Jeff's baby and has told no one. Jeff and Shauna met at a party.";
  const found = findOutdated(story(), [{ where: "card", text: card }]);
  expect(found.map((f) => f.sentence)).toEqual(["She does not yet know about Jeff and Shauna or about Edwin Holloway", "Shauna is pregnant with Jeff's baby and has told no one."]);
  expect(found[0]).toMatchObject({ kind: "knowledge", now: "Jackie knows now: Jeff is sleeping with Shauna, Shauna is pregnant", seq: 3, ref: "js" });
  // Before the reveal (the state as of message 2), nothing is out of date.
  expect(findOutdated(fold([["cast: Jackie@spot · Shauna@spot · Jeff@spot", "secret #js: Jeff is sleeping with Shauna, Shauna is pregnant | kept by Jeff, Shauna · from Jackie"]]), [{ where: "card", text: card }])).toEqual([]);
});

describe("the prompt check (Part 3)", () => {
  const st = () =>
    fold([
      ["cast: Jackie@spot · Shauna@spot · Jeff@spot · Misty@spot · Ben@spot", "secret #love: Jackie loves James | kept by Jackie · from everyone; known to James"],
      ["know Misty: Jackie loves James — she said it aloud · knows", "dead Ben — the fever took him"],
    ]);

  test("who knows: the sentence's own names for \"doesn't know\", the others for \"known only to\"", () => {
    const found = findOutdated(st(), [
      { where: "lore", text: "Misty doesn't know that Jackie loves James. [Secret — known only to James: Jackie loves James.]" },
      { where: "lore", text: "Jackie loves James, known only to James and Misty." },
    ]);
    expect(found.map((f) => f.now)).toEqual(["Misty knows now: Jackie loves James", "Misty knows now: Jackie loves James"]);
    expect(found).toHaveLength(2);
  });

  test("a sentence about another fact, or about someone still in the dark, isn't corrected", () => {
    const found = findOutdated(st(), [
      // Same words, other people: not "Jackie loves James".
      { where: "lore", text: "Shauna is secretly in love with Jackie." },
      // Names only, of a fact that never came out by a reveal.
      { where: "lore", text: "Jackie wants James to say it, and doesn't know Shauna is leaving." },
      // About someone who still doesn't know (Jeff never learned it).
      { where: "lore", text: "Jeff doesn't know that Jackie loves James." },
      // A "; "-list: only the clause that says it.
      { where: "Story So Far", text: "Still open: the cabin needs a door; Misty doesn't know that Jackie loves James; Ben's leg." },
    ]);
    expect(found.map((f) => f.sentence)).toEqual(["Misty doesn't know that Jackie loves James"]);
  });

  test("long lists of who knows are cut short", () => {
    const many = fold([["cast: Jackie@spot · Anna@spot · Bea@spot · Cora@spot · Dina@spot · Edie@spot", "secret #love: Jackie loves James | kept by Jackie · from everyone"], ["reveal #love: to Anna, Bea, Cora, Dina, Edie — she said it aloud"]]);
    expect(findOutdated(many, [{ where: "card", text: "Jackie secretly loves James." }])[0]!.now).toBe("Anna, Bea, Cora and 2 others know now: Jackie loves James");
  });

  test("the dead aren't waiting at home", () => {
    const found = findOutdated(st(), [{ where: "Story So Far", text: "Ben is waiting at the cabin for the others. The fire is low. Ben died in the night, and they buried him." }]);
    expect(found).toEqual([expect.objectContaining({ kind: "death", sentence: "Ben is waiting at the cabin for the others.", now: "Ben is dead", seq: 2 })]);
  });

  test("lines already corrected aren't corrected again, and the lane says what's true now", () => {
    expect(findOutdated(st(), [{ where: "lore", text: "[No longer a secret: it came out in the story, and Misty found out. Written before that: Misty doesn't know that Jackie loves James.]" }])).toEqual([]);
    const { extra, findings } = correctionsLane(st(), [{ where: "card", text: "Misty doesn't know that Jackie loves James." }]);
    expect(findings).toHaveLength(1);
    expect(extra!.content).toContain('- The card says: "Misty doesn\'t know that Jackie loves James." — written before #2. Misty knows now: Jackie loves James.');
    expect(correctionsLane(st(), [{ where: "card", text: "Misty is kind." }]).extra).toBeNull();
    expect(correctMemory(st(), "### Scene\nBen is waiting at the cabin.", "Story So Far").text).toContain("### Out of date in the records above");
  });

  test("the persona is checked like the card", () => {
    expect(personaPieces("  ")).toEqual([]);
    const { extra } = correctionsLane(st(), personaPieces("Misty is new in town. Misty doesn't know that Jackie loves James."));
    expect(extra!.content).toContain('- The persona says: "Misty doesn\'t know that Jackie loves James." — written before #2. Misty knows now: Jackie loves James.');
  });
});

describe("the card's opening, once the clock has moved past it", () => {
  const card = normalizeCard({
    spec: "chara_card_v2",
    data: {
      name: "Buffy",
      description: "Buffy is twenty and has died twice. Tonight she clawed out of her own grave with bare hands, splinters under her nails. She is the Slayer.",
      scenario: "October 9 2001, a little past midnight on the cemetery road. Buffy stands barefoot at the edge of her open grave.",
      first_mes: "…",
    },
  }).data;
  const at = (...clock: string[]) => fold([["cast: Buffy@spot · Alex@spot", `clock: ${clock[0]}`], ...clock.slice(1).map((c) => [`clock: ${c}`])]);

  test("a day on, the card's \"tonight\" is last night", () => {
    // The grave at 00:15, a night's sleep, the whole next day: 22:53 the same calendar day.
    const st = at("Day 1 00:15", "+6h45m", "+15h53m");
    const found = findOpening(st, cardPieces(card));
    expect(found.map((f) => f.sentence)).toEqual(["Tonight she clawed out of her own grave with bare hands, splinters under her nails.", "October 9 2001, a little past midnight on the cemetery road."]);
    expect(found[0]!.now).toBe("that is the story's opening, last night (about 23 hours ago), not now");
    const { extra } = correctionsLane(st, cardPieces(card));
    expect(extra!.content).toContain(`- The card says: "Tonight she clawed out of her own grave with bare hands, splinters under her nails." — that is the story's opening, last night (about 23 hours ago), not now.`);
    expect(extra!.content).toContain("is the past");
  });

  test("the first hours of the story need no correction, and nor does a card with no present in it", () => {
    expect(findOpening(at("Day 1 00:15", "+2h"), cardPieces(card))).toEqual([]);
    expect(findOpening(at("Day 1 00:15", "+30h"), [{ where: "card", text: "Buffy is the Slayer." }])).toEqual([]);
    expect(findOpening(at("Day 1 00:15", "+30h"), [{ where: "lore", text: "Tonight the Bronze is packed." }])).toEqual([]);
  });

  test("how long ago, as people say it", () => {
    const h = (d: number, hh: number, mm = 0) => (d - 1) * 1440 + hh * 60 + mm;
    expect(agoPhrase(h(1, 0, 15), h(1, 22, 53))).toBe("last night");
    expect(agoPhrase(h(1, 0, 15), h(1, 4))).toBe("earlier tonight");
    expect(agoPhrase(h(1, 21), h(2, 9))).toBe("last night");
    expect(agoPhrase(h(1, 21), h(3, 9))).toBe("the night before last");
    expect(agoPhrase(h(1, 10), h(1, 16))).toBe("earlier today");
    expect(agoPhrase(h(1, 10), h(2, 16))).toBe("yesterday");
    expect(agoPhrase(h(1, 10), h(5, 16))).toBe("4 days ago");
  });
});

test("summaries written before a reveal say what's true since (2.4)", () => {
  const add = (start: number, end: number, content: string) =>
    run("INSERT INTO summaries (id, chat_id, level, start_seq, end_seq, closed, title, content, state, created_at, updated_at) VALUES (?, ?, 'scene', ?, ?, 1, 't', ?, 'ready', ?, ?)", newId(), chatId, start, end, content, now(), now());
  add(1, 1, "Jackie doesn't know Jeff is sleeping with Shauna, or that Shauna is pregnant.");
  add(2, 2, "Shauna hides that she's pregnant by Jeff; she has been sleeping badly.");
  add(3, 3, "Jackie finds out from Shauna.");
  const reveal = { ...revealsOf(story())[0]!, seq: 3 };
  const text = telescope(chatId, 3, 100_000, [reveal]).text;
  // Once, after the last summary before the reveal that mentions it.
  expect(text.match(/Since then/g)?.length).toBe(1);
  expect(text).toContain("she has been sleeping badly.\nSince then (#3): Jackie found out that Jeff is sleeping with Shauna, Shauna is pregnant; it's no longer a secret.");
  expect(telescope(chatId, 3, 100_000, []).text).not.toContain("Since then");
});
