import { beforeAll, describe, expect, test } from "bun:test";
import { normalizeCard } from "../src/cards/card";
import { all } from "../src/db/db";
import { createFact } from "../src/lore/facts";
import { createEntry, createLorebook } from "../src/lore/service";
import { defaultEntry } from "../src/lore/types";
import { compilePrompt, type Direction, familyOf, knowsFaces, minorIn, PortraitRuleError, scrubNames, statedAge } from "../src/portraits/compile";
import { emptyLook, getLook, type Look, saveLook, setLine } from "../src/portraits/look";
import { appearanceExcerpt, directions, pickCanonTitle, readBack } from "../src/portraits/writer";
import { createCharacter } from "../src/services/characters";
import { createConnection, createProfile, syncModels } from "../src/services/connections";
import { createPersona } from "../src/services/personas";
import { freshDb } from "./helpers";

/** The §3.6 example, as the read-back would fill it. */
function buffy(): Look {
  const l = emptyLook();
  l.name = "Buffy Summers";
  l.canon = { work: "Buffy the Vampire Slayer", medium: "live-action" };
  setLine(l, "age", 20, "you");
  setLine(l, "presentation", "woman", "canon");
  setLine(l, "build", "petite and athletic", "canon");
  setLine(l, "hair", "long straight blonde hair worn loose", "canon");
  setLine(l, "eyes", "hazel-green", "canon");
  setLine(l, "skin", "fair", "canon");
  setLine(l, "wears", "a black leather jacket over a fitted top, late-1990s style", "canon");
  setLine(l, "signature", ["a small silver cross necklace"], "canon");
  return l;
}
const NIGHT: Direction = { title: "Night watch", setting: "Buffy waits in an old cemetery at night, mist between the headstones", light: "cool moonlight from the left", framing: "Waist-up, three-quarter view", mood: "confident half-smile", outfit: "", action: "Holding a wooden stake at her side" };
const FLUX = { id: "blackforestlabs/flux-3/klein/text-to-image", tags: ["text-to-image"] };
const ANIMA = { id: "anima/text-to-image", tags: [], description: "A fast 2B anime image model for tag-driven illustrations" };

describe("the rules (§5)", () => {
  test("ages in ideas", () => {
    expect(statedAge("buffy summers, 20 years old")).toBe(20);
    expect(statedAge("a 25-year-old knight")).toBe(25);
    expect(statedAge("aged 34, tired")).toBe(34);
    expect(statedAge("buffy summers")).toBeNull();
  });

  test("an idea about someone under 18 stops before any model sees it", () => {
    expect(minorIn("a 16-year-old witch")).toMatch(/adults/);
    expect(minorIn("buffy summers, 15 years old")).toMatch(/adults/);
    expect(minorIn("a teenage witch")).toMatch(/adults/);
    expect(minorIn("a schoolgirl")).toMatch(/adults/);
    expect(minorIn("buffy summers, 20 years old")).toBeNull();
    expect(minorIn("a girl in her twenties with red hair")).toBeNull();
    expect(minorIn("a high school teacher with baby blue eyes and a minor scar, 40")).toBeNull();
  });

  test("the prompt always says an adult age; none, and nothing is compiled", () => {
    const l = buffy();
    l.age = null;
    expect(() => compilePrompt({ look: l, direction: NIGHT, model: FLUX })).toThrow(PortraitRuleError);
  });

  test("models that know faces aren't used for live-action characters", () => {
    expect(knowsFaces("nano-banana-2")).toBe(true);
    expect(knowsFaces("nano-banana-pro")).toBe(true);
    expect(knowsFaces("bytedance/seedream-v5.0-flash")).toBe(false);
    const err = (() => {
      try {
        compilePrompt({ look: buffy(), direction: NIGHT, model: { id: "nano-banana-2" } });
      } catch (e) {
        return e as PortraitRuleError;
      }
    })();
    expect(err?.rule).toBe("faces");
    const drawn = { ...buffy(), canon: { work: "Some Manga", medium: "drawn" as const } };
    expect(compilePrompt({ look: drawn, direction: NIGHT, model: { id: "nano-banana-2" } }).prompt).toContain("20-year-old");
  });

  test("names come out, word by word, possessives too", () => {
    expect(scrubNames("Buffy's stake, then Summers smiled; Jane Placeholder too", ["Buffy Summers", "Jane Placeholder"], "the woman")).toBe("the woman's stake, then the woman smiled; the woman too");
  });
});

describe("the compiler", () => {
  test("a prose prompt: the Look word for word, the direction, the style last, no names", () => {
    const c = compilePrompt({ look: buffy(), direction: NIGHT, model: FLUX, style: "painted", realPeople: ["Jane Placeholder"] });
    expect(c.family).toBe("prose");
    expect(c.negative).toBeNull();
    expect(c.prompt).toStartWith("Portrait of a 20-year-old woman, petite and athletic, with long straight blonde hair worn loose, hazel-green eyes and fair skin.");
    expect(c.prompt).toContain("Wearing a black leather jacket over a fitted top, late-1990s style.");
    expect(c.prompt).toContain("With a small silver cross necklace.");
    expect(c.prompt).toContain("The woman waits in an old cemetery");
    expect(c.prompt).toEndWith("Cinematic painted realism, rich visible brushwork.");
    expect(c.prompt).not.toMatch(/Buffy|Summers|Placeholder/);
  });

  test("a tag prompt: adult first, the negatives keep children out", () => {
    const c = compilePrompt({ look: buffy(), direction: NIGHT, model: ANIMA });
    expect(c.family).toBe("tags");
    expect(c.style).toBe("anime");
    expect(c.prompt).toStartWith("adult woman, 20 years old, solo");
    expect(c.prompt).toContain("hazel-green eyes");
    expect(c.prompt).not.toMatch(/buffy|summers/i);
    expect(c.negative).toContain("child, teenager");
    expect(familyOf({ id: "realpony-xl" })).toBe("pony");
    const p = compilePrompt({ look: buffy(), direction: NIGHT, model: { id: "realpony-xl" } });
    expect(p.prompt).toStartWith("score_9, score_8_up, score_7_up, adult woman");
  });

  test("the name only for drawn or animated characters you asked it for", () => {
    const anime = { ...buffy(), name: "Asuka", canon: { work: "Some Anime", medium: "animated" as const }, useName: true };
    expect(compilePrompt({ look: anime, direction: NIGHT, model: FLUX }).prompt).toStartWith("Portrait of Asuka from Some Anime, a 20-year-old woman");
    const live = { ...buffy(), useName: true };
    expect(compilePrompt({ look: live, direction: NIGHT, model: FLUX }).prompt).not.toContain("Buffy");
  });

  test("a direction's outfit replaces their usual clothes; never-lines; the model's limit", () => {
    const l = buffy();
    l.never = ["glasses"];
    l.hair = "copper curls";
    l.skin = "freckled";
    const c = compilePrompt({ look: l, direction: { ...NIGHT, outfit: "A grey hoodie" }, model: FLUX });
    expect(c.prompt).toContain("with copper curls, hazel-green eyes and freckled skin.");
    expect(c.prompt).toContain("Wearing a grey hoodie.");
    expect(c.prompt).not.toContain("leather jacket");
    expect(c.prompt).toContain("Never shown with glasses.");
    const short = compilePrompt({ look: buffy(), direction: NIGHT, model: { ...FLUX, maxPromptChars: 200 } });
    expect(short.prompt.length).toBeLessThanOrEqual(200);
    expect(short.notes[0]).toMatch(/Shortened/);
  });
});

describe("the read-back", () => {
  let personaId = "";
  let characterId = "";
  beforeAll(async () => {
    freshDb();
    const conn = createConnection({ name: "Mock", kind: "mock", billing: "subscription" });
    await syncModels(conn);
    createProfile({ name: "Story", connectionId: conn, modelId: "mock/storyteller", params: { context_target: 8000 } });
    personaId = createPersona({ name: "Wren Hale", data: { appearance: "Hair: copper curls. Eyes: grey." } });
    const { data } = normalizeCard({ spec: "chara_card_v2", data: { name: "Mira", description: "A lighthouse keeper. Hair: dark and cropped. Eyes: brown.", first_mes: "Hi." } });
    characterId = createCharacter(data);
    const book = createLorebook({ name: "Mira's book", links: [{ target_type: "character", target_id: characterId }] });
    const entry = createEntry(book, defaultEntry({ comment: "Mira", keys: ["Mira"], content: "Mira keeps the light.", extra: { type: "character" } })).id;
    createFact(entry, { value: "storm-grey", slot: "eyes", origin: "card" });
    createFact(entry, { value: "a scar through her left eyebrow", slot: "scar", origin: "card" });
  });

  const page = { title: "Buffy Summers (Test Wiki)", url: "https://example.test/wiki/Buffy", text: "Buffy Summers is the Slayer, portrayed by Jane Placeholder.\nAppearance\nHair: long straight blonde. Eyes: hazel-green. Build: petite and athletic. Clothes: leather jacket\nPersonality\nWry." };

  test("the §3.6 idea: canon from the page, your age, the actor kept out", async () => {
    const r = await readBack({ idea: "buffy summers, 20 years old" }, { canonPage: async () => page });
    expect(r.refused).toBeNull();
    expect(r.look.name).toBe("Buffy Summers");
    expect(r.look.canon).toEqual({ work: "Buffy the Vampire Slayer", medium: "live-action" });
    expect(r.look.age).toBe(20);
    expect(r.look.source.age).toBe("you");
    expect(r.look.hair).toBe("long straight blonde");
    expect(r.look.source.hair).toBe("canon");
    expect(r.look.eyes).toBe("hazel-green");
    expect(r.look.skin).toBe("fair");
    expect(r.look.source.skin).toBe("guess");
    expect(r.realPeople).toEqual(["Jane Placeholder"]);
    expect(r.sources).toEqual([{ title: page.title, url: page.url }]);
    expect(r.questions).toEqual([]);
    const c = compilePrompt({ look: r.look, direction: NIGHT, model: FLUX, realPeople: r.realPeople });
    expect(c.prompt).not.toMatch(/Buffy|Summers|Jane|Placeholder/);
  });

  test("no age, and canon's is under 18: Mea asks for an adult one", async () => {
    const r = await readBack({ idea: "buffy summers" }, { canonPage: async () => page });
    expect(r.look.age).toBeNull();
    expect(r.questions.map((q) => q.id)).toContain("age");
    expect(r.questions[0]!.text).toMatch(/under 18/);
  });

  test("an idea about a minor is refused before any helper runs", async () => {
    const before = all("SELECT 1 FROM generations").length;
    const r = await readBack({ idea: "buffy summers, 16 years old" });
    expect(r.refused).toMatch(/adults/);
    expect(all("SELECT 1 FROM generations").length).toBe(before);
  });

  test("your words beat everything; a persona's own appearance counts as the card", async () => {
    const r = await readBack({ idea: "with green eyes, 30 years old", ownerType: "persona", ownerId: personaId });
    expect(r.look.name).toBe("Wren Hale");
    expect(r.look.eyes).toBe("green");
    expect(r.look.source.eyes).toBe("you");
    expect(r.look.hair).toBe("copper curls");
    expect(r.look.source.hair).toBe("card");
    expect(r.look.canon).toBeNull();
  });

  test("lore slots beat the card's prose", async () => {
    const r = await readBack({ idea: "34 years old", ownerType: "character", ownerId: characterId });
    expect(r.look.eyes).toBe("storm-grey");
    expect(r.look.source.eyes).toBe("lore");
    expect(r.look.marks).toEqual(["a scar through her left eyebrow"]);
    expect(r.look.hair).toBe("dark and cropped");
    expect(r.look.source.hair).toBe("card");
  });

  test("a saved Look: your fixes stay yours on the next read-back", async () => {
    const first = await readBack({ idea: "34 years old", ownerType: "character", ownerId: characterId });
    setLine(first.look, "hair", "silver, in a long braid", "you");
    saveLook("character", characterId, first.look);
    expect(getLook("character", characterId)?.hair).toBe("silver, in a long braid");
    const again = await readBack({ idea: "", ownerType: "character", ownerId: characterId });
    expect(again.look.hair).toBe("silver, in a long braid");
    expect(again.look.age).toBe(34);
  });

  test("three directions", async () => {
    const d = await directions({ look: buffy(), idea: "buffy summers, 20 years old" });
    expect(d).toHaveLength(3);
    expect(new Set(d.map((x) => x.title)).size).toBe(3);
  });

  test("the appearance part of a wiki page", () => {
    expect(appearanceExcerpt(page.text)).toContain("[Appearance]\nHair: long straight blonde");
  });

  test("a long article's ## Appearance, far down; never the episode list", () => {
    const filler = "Plot. ".repeat(20_000);
    const article = `Buffy Anne Summers was a Slayer.\n\n## Biography\n\n${filler}\n\n## Appearance\n\nHer most obvious feature was her small size; her hair was naturally blonde.\n\n## Powers and abilities\n\nStrong.\n\n## Appearances\n\n- Welcome to the Hellmouth`;
    const ex = appearanceExcerpt(article);
    expect(ex).toContain("[Appearance]\nHer most obvious feature was her small size; her hair was naturally blonde.");
    expect(ex).not.toContain("Strong.");
    expect(ex).not.toContain("Welcome to the Hellmouth");
    expect(appearanceExcerpt(`Intro.\n\n## Appearance and Character\n\nA young woman with silver-gold hair and violet eyes, slender.\n\n## History\n\nx`)).toContain("[Appearance]\nA young woman with silver-gold hair");
  });

  test("no such section: only paragraphs that describe looks", () => {
    const article = `${"Opening. ".repeat(300)}\n\nShe looks into his eyes and leaves.\n\nHer long silver-gold hair was braided in the Dothraki fashion.\n\nThe moon cracked like an egg.`;
    const ex = appearanceExcerpt(article);
    expect(ex).toContain("[How they look, from the page]\nHer long silver-gold hair was braided");
    expect(ex).not.toContain("into his eyes");
  });

  test("the character's own page among search hits", () => {
    expect(pickCanonTitle("Buffy Summers", ["Buffy Summers (The Last Vampire Slayer)", "Buffy Summers (2019)", "Buffy Summers"])).toBe("Buffy Summers");
    expect(pickCanonTitle("Buffy Summers", ["Buffy Summers (Wishverse)", "Buffy Summers/Gallery"])).toBe("Buffy Summers/Gallery");
    expect(pickCanonTitle("Willow", ["Willow Rosenberg (Wishverse)", "Willow Rosenberg"])).toBe("Willow Rosenberg");
    expect(pickCanonTitle("Nobody", ["Somebody"])).toBeNull();
  });
});
