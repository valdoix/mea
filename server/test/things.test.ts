import { beforeAll, describe, expect, test } from "bun:test";
import { normalizeCard } from "../src/cards/card";
import { sentences } from "../src/accuracy/rules";
import { createCharacter } from "../src/services/characters";
import { addMessage, createChat } from "../src/services/chats";
import { notHereThings, planCorrection } from "../src/steer/plancheck";
import { currentFold, linesToOps, writeEvents } from "../src/trackers/store";
import { sameThing, thingCore, thingPlace, thingsElsewhere } from "../src/trackers/things";
import type { Item, WorldState } from "../src/trackers/types";
import { inPlay } from "../src/trackers/note";
import { planCheckLine } from "../../shared/plan";
import { freshDb } from "./helpers";

const item = (name: string, holder?: string, at?: string, extra: Partial<Item> = {}): Item => ({ id: name, name, holder, custody: at ? [{ to: holder, seq: 5, at }] : [], lastSeq: 5, ...extra });
const of = (...list: Item[]) => Object.fromEntries(list.map((i) => [i.id, i]));

describe("one thing, one record (docs/26 6.1)", () => {
  test("what's said about it is what it's said to be", () => {
    expect(thingCore("Daisy Mug (Joyce's, cream ceramic)")).toBe("daisy mug");
  });

  test("the same thing with more said joins, either way round", () => {
    const short = item("daisy mug");
    const long = item("daisy mug (Joyce's, cream ceramic, faded daisy)");
    expect(sameThing(of(short), long.name)).toBe(short);
    expect(sameThing(of(long), "daisy mug")).toBe(long);
    expect(sameThing(of(long), "daisy mug (Joyce's, cream ceramic, faded daisy, Buffy's cocoa mug)")).toBe(long);
  });

  test("two things that say different things stay two", () => {
    expect(sameThing(of(item("pint (O negative, empty)")), "pint (O negative, full)")).toBeUndefined();
    expect(sameThing(of(item("boots (black)")), "boots (brown)")).toBeUndefined();
  });

  test("a one-word thing needs two words in common: a phone that matches Gabriel's isn't Gabriel's", () => {
    expect(sameThing(of(item("phone (new, matching Gabriel's)")), "phone (Gabriel's)")).toBeUndefined();
    const buffys = item("phone (new, Buffy's, dark screen)");
    expect(sameThing(of(buffys), "phone (new, Buffy's)")).toBe(buffys);
  });

  test("a bare one-word thing could be anyone's", () => {
    expect(sameThing(of(item("phone (new, Buffy's)")), "phone")).toBeUndefined();
    expect(sameThing(of(item("plate")), "plate (blue)")).toBeUndefined();
  });

  test("when it could be either, it's neither", () => {
    expect(sameThing(of(item("grey tee (faded)"), item("grey tee (new)")), "grey tee")).toBeUndefined();
  });

  test("something gone stays gone", () => {
    expect(sameThing(of(item("daisy mug", undefined, undefined, { gone: true })), "daisy mug (Joyce's)")).toBeUndefined();
  });
});

describe("where a thing rests (docs/26 6.2)", () => {
  const at = "Sunnydale › Summers Residence › Kitchen";
  test("put down somewhere: where the story was when it moved", () => {
    expect(thingPlace(item("mug", "place:at counter", at))).toBe(at);
    expect(thingPlace(item("mug", "place:Spike's hands", at))).toBe(at);
  });

  test("the line can name the place itself", () => {
    expect(thingPlace(item("mug", "place:at Winters Residence › shelf", at))).toBe("Winters Residence › shelf");
  });

  test("held, worn, carried or gone says nothing about a place", () => {
    for (const held of ["buffy", "place:still worn by Buffy", "place:Gabriel's basket", "place:Buffy's grip → Gabriel", "place:bag on porch", "place:abandoned"]) expect(thingPlace(item("mug", held, at))).toBeNull();
    expect(thingPlace(item("mug", "place:at counter", at, { gone: true }))).toBeNull();
  });
});

describe("a thing left in another home (docs/26 6.3)", () => {
  const state = (place: string[], items: Item[]) =>
    ({
      place,
      places: {},
      items: of(...items),
      chars: { buffy: { id: "buffy", name: "Buffy Summers", aliases: [] }, user: { id: "user", name: "Gabriel Winters", aliases: [] } },
    }) as unknown as WorldState;
  const mug = item("daisy mug (Joyce's)", "place:at counter", "Sunnydale › Summers Residence › Kitchen");
  const here = ["Sunnydale", "Winters Residence", "Kitchen"];

  test("#742: Joyce's mug on a shelf in Gabriel's kitchen", () => {
    const [found, ...rest] = thingsElsewhere(state(here, [mug]), "The daisy mug came down from the shelf.", sentences);
    expect(rest).toEqual([]);
    expect(found).toMatchObject({ place: "Sunnydale › Summers Residence › Kitchen", sentence: "The daisy mug came down from the shelf." });
  });

  test("at home it's fine, whatever the place is called", () => {
    expect(thingsElsewhere(state(["Summers Residence", "Hallway"], [mug]), "The daisy mug sat there.", sentences)).toEqual([]);
    const album = item("ballet album", "place:at counter", "Gabriel's House › Downstairs › Kitchen");
    expect(thingsElsewhere(state(here, [album]), "She set it by the ballet album.", sentences)).toEqual([]);
  });

  test("remembering it or bringing it isn't having it here", () => {
    for (const line of ["She remembered the daisy mug.", "He brought the daisy mug over from Revello.", "Back at the house, the daisy mug waited."]) expect(thingsElsewhere(state(here, [mug]), line, sentences)).toEqual([]);
  });

  test("somewhere neither of them lives can't be told apart from here", () => {
    expect(thingsElsewhere(state(["Sunnydale", "The Bronze"], [mug]), "The daisy mug sat there.", sentences)).toEqual([]);
    const lamp = item("brass lamp", "place:at counter", "The Magic Box");
    expect(thingsElsewhere(state(here, [lamp]), "The brass lamp glowed.", sentences)).toEqual([]);
  });

  test("a thing with a one-word name isn't picked out", () => {
    expect(thingsElsewhere(state(here, [item("mug", "place:at counter", "Summers Residence › Kitchen")]), "The mug sat there.", sentences)).toEqual([]);
  });

  test("a plan gets a correction, and the drawer a line", () => {
    const found = notHereThings(state(here, [mug]), "MOVE — Buffy sets the daisy mug at the fourth place.");
    expect(found).toHaveLength(1);
    expect(planCorrection(found)).toContain("nothing has moved it here");
    expect(planCheckLine({ ...found[0]!, says: "elsewhere", corrected: true })).toContain("daisy mug (Joyce's) is at Sunnydale › Summers Residence › Kitchen");
  });
});

describe("the fold keeps one record", () => {
  let chatId: string;
  const lines = (...l: string[]) => writeEvents(chatId, { messageId: null, swipeIdx: -1 }, linesToOps(l).ops, "user");

  beforeAll(() => {
    freshDb();
    const { data } = normalizeCard({ spec: "chara_card_v2", data: { name: "Buffy", description: "A Slayer.", first_mes: "Hi." } });
    chatId = createChat({ characterId: createCharacter(data) }).id;
    addMessage(chatId, "user", "Hello.");
  });

  test("three descriptions, one mug, the fullest name, and its whole trail", () => {
    lines("at: Sunnydale > Summers Residence > Kitchen", "cast: Buffy@spot · Spike@spot", "item daisy mug (Joyce's, faded daisy): → Spike — offered", "item daisy mug: → at banister — set down", "item daisy mug (Joyce's, faded daisy, cocoa mug): → at counter — rinsed", "item brass key: Spike → Buffy — found it", "item red scarf: → Buffy — hers");
    const st = currentFold(chatId).result.state;
    const mugs = Object.values(st.items).filter((i) => i.name.includes("daisy mug"));
    expect(mugs).toHaveLength(1);
    expect(mugs[0]!.name).toBe("daisy mug (Joyce's, faded daisy, cocoa mug)");
    expect(mugs[0]!.custody).toHaveLength(3);
    expect(thingPlace(mugs[0]!)).toBe("Sunnydale › Summers Residence › Kitchen");
  });

  test("FACTS IN PLAY says which counter, and who it started with", () => {
    const st = currentFold(chatId).result.state;
    const [line] = inPlay(st, "She reaches for the daisy mug.", (id) => st.chars[id]?.name ?? id);
    expect(line).toContain("at counter, Sunnydale › Summers Residence › Kitchen");
    expect(line).toContain("trail: ");
    expect(line).toContain("offered");
  });

  test("a gift can have several givers, and warms the one who got it to each (docs/26 6.4)", () => {
    lines("cast: Buffy@spot · Dawn@spot · Spike@spot", "item grey socks: Spike → Dawn (gift from Spike, Buffy) — they chose them together");
    const st = currentFold(chatId).result.state;
    const socks = Object.values(st.items).find((i) => i.name === "grey socks")!;
    expect(socks.gift).toBe("Spike, Buffy");
    const dawn = Object.values(st.chars).find((c) => c.name === "Dawn")!;
    const bonds = Object.values(st.bonds ?? {}).filter((b: any) => b.from === dawn.id);
    expect(bonds.length).toBe(2);
    expect(bonds.map((b: any) => b.axes.affection)).toEqual([1, 1]);
  });
});
