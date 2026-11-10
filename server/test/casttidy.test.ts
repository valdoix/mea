import { beforeAll, describe, expect, test } from "bun:test";
import { normalizeCard } from "../src/cards/card";
import { all, newId, now, run } from "../src/db/db";
import { withKnown } from "../src/lore/activate";
import { insertAtom, isDuplicate, smallBeat } from "../src/memory/atoms";
import { notPersonName, placeAs, roleKeys } from "../src/memory/casttidy";
import { needsProfile } from "../src/memory/consolidate";
import { syncEntities } from "../src/memory/entities";
import { createCharacter } from "../src/services/characters";
import { addMessage, createChat } from "../src/services/chats";
import { parseLine } from "../src/trackers/dsl";
import { type FoldConfig, foldEvents, type TrackerEvent } from "../src/trackers/fold";
import { PlaceBook } from "../src/trackers/places";
import { STARTER_TEMPLATES } from "../src/trackers/schema";
import { currentFold, linesToOps, writeEvents } from "../src/trackers/store";
import { isCrowdShape, orgKind, tidyAliases } from "../src/trackers/whois";
import { freshDb } from "./helpers";

/** docs/33 Part 11: cast, places and memory tidy. The names are one story's own. */
const cfg: FoldConfig = { userName: "Gabriel Winters", mainName: "Buffy Summers", sealedPersona: true, romance: "slow", strictness: "lenient", limits: true, templates: STARTER_TEMPLATES };
let n = 0;
const fold = (messages: string[][]) =>
  foldEvents(
    messages.flatMap((lines, i) => lines.map((l): TrackerEvent => ({ id: `e${++n}`, messageId: `m${i + 1}`, seq: i + 1, source: "model", op: parseLine(l)! }))),
    cfg,
  ).state;

describe("names that aren't names (11.1)", () => {
  test("stage directions, sentences and slips aren't other names", () => {
    expect(tidyAliases("Spike", ["Spike (offscreen, approaching)", "Spike (departing)", "William the Bloody"])).toEqual(["William the Bloody"]);
    expect(tidyAliases("Ruth", ["Ruth the cat", "Ruth (cat, distant)", "Ruth the orange cat"])).toEqual(["Ruth the cat", "Ruth the orange cat"]);
    expect(tidyAliases("Frank", ["Frank charges $12-14"])).toEqual([]);
    expect(tidyAliases("Eleanor Winters", ["Eleanor", "Gabriel's mom (name Buffy Summers only"])).toEqual(["Eleanor", "Gabriel's mom"]);
    expect(tidyAliases("Giles", ["Rupert Giles", "Gupert Giles"])).toEqual(["Rupert Giles"]);
    expect(tidyAliases("Gabriel's father", ["Gabriel"])).toEqual([]);
  });
  test("a company, a school and a crowd are not people", () => {
    expect(orgKind("Winters Holdings")).toBe("group");
    expect(orgKind("Sunnydale High")).toBe("place");
    expect(orgKind("Sunnydale General")).toBe("place");
    expect(orgKind("General")).toBeNull();
    expect(orgKind("Walter Clark")).toBeNull();
    expect(isCrowdShape("board members")).toBe(true);
    expect(isCrowdShape("Salesgirls at Verano")).toBe(true);
    expect(isCrowdShape("two delivery men in grey shirts")).toBe(true);
    expect(isCrowdShape("Hank Summers")).toBe(false);
    expect(isCrowdShape("Officer Dan")).toBe(false);
  });
  test("the fold makes nobody of them", () => {
    const st = fold([["clock: Day 1 12:00", "cast: Buffy Summers@spot · unchanged@spot · Winters Holdings@peri · Sunnydale High@peri · Walter@spot"]]);
    const names = Object.values(st.chars).map((c) => c.name);
    expect(names).toContain("Walter");
    expect(names).not.toContain("unchanged");
    expect(names).not.toContain("Winters Holdings");
    expect(names).not.toContain("Sunnydale High");
  });
  test("by what the story knows: a street's first word, a known group", () => {
    const known = { places: ["Powell Street", "Sunnydale Mall"], groups: ["The Hellions"] };
    expect(notPersonName("Powell", known)).toBe("place");
    expect(notPersonName("Hellions", known)).toBe("group");
    expect(notPersonName("unchanged", known)).toBe("drop");
    expect(notPersonName("Co.", known)).toBe("drop");
    expect(notPersonName("Riley", known)).toBeNull();
    expect(notPersonName("Dawn's friends", known)).toBe("group");
  });
  test("a role names the person a roster gives it to", () => {
    const keys = roleKeys("Gabriel's mother, Jonathan's wife");
    expect(keys).toContain("gabriel mother");
    expect(keys).toContain("gabriel mom");
    expect(keys).toContain("jonathan wife");
    expect(roleKeys("The current patriarch and owner of Winters Holdings")).toEqual([]);
  });
});

describe("places as the tracker has them (11.2)", () => {
  const st = fold([
    ["clock: Day 1 12:00", "cast: Buffy Summers@spot · Gabriel Winters@spot", "at: Sunnydale › hills › Winters Residence › kitchen", "lives Gabriel Winters: Sunnydale › hills › Winters Residence"],
    ["at: Sunnydale › hills › Winters Residence › living room"],
    ["at: Sunnydale › Revello Drive › Summers Residence › Kitchen"],
    ["at: Sunnydale › strip mall › Zapatos Dorothea"],
  ]);
  const book = new PlaceBook(st, { findChar: (name) => Object.values(st.chars).find((c) => c.name.toLowerCase().startsWith(name.toLowerCase())) });
  const as = (w: string) => {
    const r = placeAs(book, st, w);
    return r === null ? null : "place" in r ? r.place.path.slice(-2).join(" › ") : `name: ${r.name}`;
  };
  test("one kitchen, however it was written", () => {
    for (const w of ["Gabriel's kitchen", "Gabriel's kitchen (darkening, then dark)", "The hills house kitchen", "Kitchen of the hills house", "Winters Residence kitchen"]) expect(as(w), w).toBe("Winters Residence › kitchen");
    for (const w of ["Revello Drive kitchen", "1630 Revello Drive kitchen", "Summers kitchen, 1630 Revello Drive", "Summers kitchen"]) expect(as(w), w).toBe("Summers Residence › Kitchen");
  });
  test("a house by its address, its hill or its owner", () => {
    expect(as("1630 Revello Drive")).toBe("Sunnydale › Summers Residence");
    expect(as("Gabriel's house in the hills")).toBe("hills › Winters Residence");
    expect(as("Zapatos Dorothea shoe store")).toBe("strip mall › Zapatos Dorothea");
  });
  test("a seat, a bare room and a trip are not places of their own; a new place keeps its name", () => {
    expect(as("passenger seat")).toBeNull();
    expect(as("hallway")).toBeNull();
    expect(as("driving to Revello Drive")).toBeNull();
    expect(as("Kitchen → Gabriel's BMW → (heading to) Summers Residence")).toBeNull();
    expect(as("Joyce's kitchen")).toBe("name: Joyce's kitchen");
    expect(as("Espresso Pump (corner table)")).toBe("name: Espresso Pump");
  });
});

describe("the cast sync", () => {
  let chatId = "";
  const rows = () => all<{ kind: string; name: string; aliases: string }>("SELECT kind, name, aliases FROM entities WHERE chat_id = ? AND deleted_at IS NULL AND merged_into IS NULL", chatId);
  const of = (name: string) => rows().find((r) => r.name === name);
  beforeAll(() => {
    freshDb();
    const { data } = normalizeCard({ spec: "chara_card_v2", data: { name: "Buffy Summers", description: "The Slayer.", first_mes: "Hi." } });
    chatId = createChat({ characterId: createCharacter(data) }).id;
    const m = addMessage(chatId, "assistant", "They cook.", { name: "Buffy Summers" });
    writeEvents(chatId, { messageId: m, swipeIdx: 0 }, linesToOps(["clock: 2001-10-10 09:00", "cast: Buffy Summers@spot · Spike@peri · Gabriel Winters@spot", "at: Sunnydale › hills › Winters Residence › kitchen", "lives Gabriel Winters: Sunnydale › hills › Winters Residence", "at: Sunnydale › Powell Street"]).ops, "model");
    const src = [{ id: m, seq: 2 }];
    const mem = (content: string, entities: string[]) => insertAtom(chatId, null, { type: "fact", content, entities, importance: 5 }, src);
    mem("Frank is the Powell Street blood dealer.", ["Frank", "Powell"]);
    mem("Dawn visited the Powell Street dealer every Tuesday.", ["Powell", "Dawn"]);
    mem("Dawn's DVD shortlist was The Princess Bride, Mulan and Ocean's Eleven.", ["Mulan", "Dawn"]);
    mem("Gabriel said Li Shang fell in love with Mulan while thinking Mulan was a guy.", ["Li Shang", "Mulan"]);
    mem("Buffy's read on Li Shang: he liked Ping, he likes Mulan.", ["Li Shang"]);
    mem("Gabriel interned at Winters Holdings one summer.", ["Winters Holdings"]);
    mem("Winters Holdings owns the restaurants.", ["Winters Holdings"]);
    mem("Frank charges fourteen dollars a pint.", ["Frank"]);
    mem("Riley was beige, Buffy said.", ["Riley"]);
    mem("Buffy never felt possessive with Riley.", ["Riley"]);
    run(
      "INSERT INTO summaries (id, chat_id, level, start_seq, end_seq, closed, title, content, data, state, created_at, updated_at) VALUES (?, ?, 'scene', 1, 2, 1, 't', 'Text.', ?, 'ready', ?, ?)",
      newId(),
      chatId,
      JSON.stringify({ participants: ["Buffy Summers", "board members", "Co."], locations: ["The hills house kitchen", "Gabriel's kitchen (darkening)", "passenger seat", "Espresso Pump (corner table)"] }),
      now(),
      now(),
    );
    // Pages an older sync made, as they were found in one story.
    for (const [kind, name] of [["place", "Gabriel's kitchen (darkening)"], ["place", "Kitchen → Gabriel's BMW → (heading to) Summers Residence"], ["person", "Powell"], ["person", "Co."]] as const)
      run("INSERT INTO entities (id, chat_id, kind, name, aliases, description, status, data, mentions, created_at, updated_at) VALUES (?, ?, ?, ?, '[]', '', 'active', ?, 1, ?, ?)", newId(), chatId, kind, name, JSON.stringify({ sources: ["scenes"] }), now(), now());
    syncEntities(chatId, true);
  });
  test("a street, a company and a film's people are not people; an ex is", () => {
    const people = rows().filter((r) => r.kind === "person").map((r) => r.name);
    expect(people).toContain("Riley");
    expect(people).toContain("Frank");
    for (const no of ["Powell", "Winters Holdings", "Mulan", "Li Shang", "board members", "Co."]) expect(people, no).not.toContain(no);
    expect(of("Winters Holdings")?.kind).toBe("group");
    expect(of("Mulan")?.kind).toBe("concept");
    expect(of("Li Shang")?.kind).toBe("concept");
    expect(of("Powell")).toBeUndefined();
  });
  test("one kitchen, and the old pages follow it", () => {
    const places = rows().filter((r) => r.kind === "place").map((r) => r.name);
    expect(places.filter((p) => /kitchen/i.test(p))).toEqual(["Winters Residence kitchen"]);
    expect(places).toContain("Espresso Pump");
    expect(places).not.toContain("passenger seat");
    expect(places.some((p) => p.includes("→"))).toBe(false);
    const old = all<{ merged: number }>("SELECT merged_into IS NOT NULL AS merged FROM entities WHERE chat_id = ? AND name = ?", chatId, "Gabriel's kitchen (darkening)")[0];
    expect(old?.merged).toBe(1);
  });
  test("a second sync changes nothing", () => {
    const before = JSON.stringify(rows());
    expect(syncEntities(chatId, true)).toBe(false);
    expect(JSON.stringify(rows())).toBe(before);
    expect(currentFold(chatId).result.state.chars).toBeTruthy();
  });
});

describe("memory weight, profiles and who knows (11.3–11.5)", () => {
  test("a small physical beat is one, and a moment between people isn't", () => {
    expect(smallBeat("The toothbrush rolls to a stop against the tile.")).toBe(true);
    expect(smallBeat("The price tag spins on its thread.")).toBe(true);
    expect(smallBeat("Buffy rolled her eyes and said she loved him.")).toBe(false);
    expect(smallBeat("The ring slid onto her finger for the first time.")).toBe(false);
    expect(smallBeat("Gabriel promised to fix the faucet.")).toBe(false);
  });
  test("it is stored light, and the same thing in nearly the same words is a duplicate", () => {
    freshDb();
    const { data } = normalizeCard({ spec: "chara_card_v2", data: { name: "Buffy", first_mes: "Hi." } });
    const id = createChat({ characterId: createCharacter(data) }).id;
    const m = addMessage(id, "assistant", "…", { name: "Buffy" });
    const a = insertAtom(id, null, { type: "event", content: "The toothbrush rolls to a stop against the tile.", entities: [], importance: 8 }, [{ id: m, seq: 2 }]);
    expect(all<{ importance: number }>("SELECT importance FROM memories WHERE id = ?", a)[0]!.importance).toBe(3);
    insertAtom(id, null, { type: "fact", content: "Gabriel employs a vampire lawyer named Bob on the legal team of his blood charity.", entities: ["Bob"], importance: 6 }, [{ id: m, seq: 2 }]);
    expect(isDuplicate(id, "Gabriel employs a vampire lawyer named Bob on his blood charity's legal team.")).toBe(true);
    expect(isDuplicate(id, "Bob the vampire lawyer went to Yale and wears funky socks.")).toBe(false);
  });
  test("whoever is mentioned often and has no profile is first in line", () => {
    expect(needsProfile({ kind: "person", mentions: 316, data: JSON.stringify({ descSource: "tracker" }), description: "Spike: bleached" })).toBe(true);
    expect(needsProfile({ kind: "person", mentions: 316, data: JSON.stringify({ descSource: "consolidation" }), description: "…" })).toBe(false);
    expect(needsProfile({ kind: "person", mentions: 7, data: "{}", description: "" })).toBe(false);
    expect(needsProfile({ kind: "place", mentions: 44, data: "{}", description: "" })).toBe(false);
  });
  test("an entry only some people know says so", () => {
    const text = withKnown({ extra: { knownBy: ["Giles", "Willow"] } }, "He left Sunnydale after a tearful send-off at the airport.");
    expect(text).toContain("Known only to Giles, Willow");
    expect(withKnown({ extra: {} }, "Sunnydale sits on a Hellmouth.")).toBe("Sunnydale sits on a Hellmouth.");
  });
});
