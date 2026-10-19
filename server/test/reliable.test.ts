import { beforeAll, describe, expect, test } from "bun:test";
import { normalizeCard } from "../src/cards/card";
import { staleCardLines } from "../src/accuracy/corrections";
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
  const lines = staleCardLines(card, revealsOf(story()));
  expect(lines.map((l) => l.sentence)).toEqual(["She does not yet know about Jeff and Shauna or about Edwin Holloway; when either surfaces, it hits her hard.", "Shauna is pregnant with Jeff's baby and has told no one."]);
  expect(staleCardLines(card, [])).toEqual([]);
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
