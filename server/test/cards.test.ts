import { describe, expect, test } from "bun:test";
import { strToU8, zipSync } from "fflate";
import { normalizeCard, toV2 } from "../src/cards/card";
import { buildCharx, buildPngCard, parseCardFile } from "../src/cards/io";
import { base64ToUtf8, readTextChunks } from "../src/cards/png";
import { placeholderAvatar } from "../src/lib/png-encode";

const v2 = {
  spec: "chara_card_v2",
  spec_version: "2.0",
  data: {
    name: "Mira",
    description: "A lighthouse keeper. ✨ Unicode works.",
    personality: "wistful",
    scenario: "",
    first_mes: "Hello, {{user}}.",
    mes_example: "",
    creator_notes: "",
    system_prompt: "",
    post_history_instructions: "",
    alternate_greetings: ["Hi again."],
    tags: ["cozy"],
    creator: "me",
    character_version: "1",
    extensions: { custom_thing: { keep: true } },
    some_unknown_field: 42,
    character_book: { entries: [{ keys: ["lighthouse"], content: "The lighthouse is old.", extensions: {}, enabled: true, insertion_order: 100 }] },
  },
};

describe("cards", () => {
  test("normalizes V1, V2 and V3, keeping unknown fields", () => {
    const a = normalizeCard({ name: "Old", description: "flat v1", first_mes: "hey" });
    expect(a.spec).toBe("v1");
    expect(a.data.first_mes).toBe("hey");

    const b = normalizeCard(v2);
    expect(b.spec).toBe("v2");
    expect(b.data.some_unknown_field).toBe(42);
    expect(b.data.extensions.custom_thing).toEqual({ keep: true });
    expect(b.data.character_book?.entries[0]?.keys).toEqual(["lighthouse"]);

    const c = normalizeCard({ spec: "chara_card_v3", spec_version: "3.0", data: { ...v2.data, nickname: "Mi", group_only_greetings: ["g"] } });
    expect(c.spec).toBe("v3");
    expect(c.data.nickname).toBe("Mi");
  });

  test("rejects cards without a name", () => {
    expect(() => normalizeCard({ description: "nameless" })).toThrow();
  });

  test("PNG round trip writes chara + ccv3 and reads them back", () => {
    const { data } = normalizeCard(v2);
    const png = buildPngCard(data, placeholderAvatar(16, 16));
    const text = readTextChunks(png);
    expect(JSON.parse(base64ToUtf8(text.chara!)).spec).toBe("chara_card_v2");
    expect(JSON.parse(base64ToUtf8(text.ccv3!)).spec).toBe("chara_card_v3");
    const parsed = parseCardFile(png);
    expect(parsed.data.description).toContain("✨");
    expect(parsed.data.some_unknown_field).toBe(42);
    expect(parsed.image?.mime).toBe("image/png");
  });

  test("V2 export keeps V3-only fields inside extensions", () => {
    const { data } = normalizeCard({ spec: "chara_card_v3", data: { ...v2.data, nickname: "Mi" } });
    const out = toV2(data);
    expect((out.data.extensions as Record<string, any>).mea_v3.nickname).toBe("Mi");
  });

  test("CHARX import and export", () => {
    const { data } = normalizeCard(v2);
    const icon = placeholderAvatar(8, 8);
    const zip = buildCharx(data, { bytes: icon, mime: "image/png" });
    const parsed = parseCardFile(zip, "mira.charx");
    expect(parsed.data.name).toBe("Mira");
    expect(parsed.image?.bytes.length).toBe(icon.length);

    const manual = zipSync({ "card.json": strToU8(JSON.stringify({ spec: "chara_card_v3", data: { name: "Z" } })) });
    expect(parseCardFile(manual, "z.charx").data.name).toBe("Z");
  });
});
