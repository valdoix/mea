import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DISPLAY_FONTS, STORY_FONTS, UI_FONTS } from "../src/lib/settings";

const WEB = join(import.meta.dir, "../../web");
const read = (p: string) => readFileSync(join(WEB, p), "utf8");

/** The ids in one of fontcatalog.ts's `const X = [...] as const` lists. */
function listed(name: string) {
  const m = read("src/lib/fontcatalog.ts").match(new RegExp(`const ${name} = \\[([^\\]]*)\\] as const`));
  expect(m).not.toBeNull();
  return [...m![1]!.matchAll(/"([a-z0-9]+)"/g)].map((x) => x[1]!);
}

describe("font pickers", () => {
  // A font the picker offers but the server refuses would fail to save, silently for the reader.
  test.each([
    ["story", "STORY_FACES", STORY_FONTS, ["theme", "nunito"]],
    ["interface", "UI_FACES", UI_FONTS, ["nunito", "system"]],
    ["heading", "DISPLAY_FACES", DISPLAY_FONTS, ["theme"]],
  ] as const)("%s: the web and the server offer the same fonts", (_label, list, server, own) => {
    expect([...own, ...listed(list)].sort()).toEqual([...server].sort());
  });

  test("every font in a list has a face behind it", () => {
    const src = read("src/lib/fontcatalog.ts");
    for (const id of new Set([...listed("STORY_FACES"), ...listed("UI_FACES"), ...listed("DISPLAY_FACES")])) {
      expect(src).toMatch(new RegExp(`\\n  ${id}: [a-z]\\("`));
    }
  });
});

describe("layouts", () => {
  test("the pre-paint script knows the layouts", () => {
    const js = read("public/theme.js");
    expect(js).toContain('"folio"');
    expect(js).toContain('"stage"');
  });

  // Rooms load after layouts.css or before it, and users recolour them: a layout may only read tokens.
  test("layouts.css doesn't dress itself for one room", () => {
    const css = read("src/styles/layouts.css").replace(/\/\*[\s\S]*?\*\//g, "");
    const named = [...css.matchAll(/data-theme="([a-z]+)"/g)].map((m) => m[1]);
    expect(new Set(named)).toEqual(new Set(["lantern"]));
  });

  // Choosing Folio or Stage moves you to Book style, which hides portraits in Classic.
  test("Folio and Stage keep portraits in Book style", () => {
    const css = read("src/styles/layouts.css");
    for (const l of ["folio", "stage"]) expect(css).toContain(`:root[data-layout="${l}"] .style-book .msg .portrait-col`);
  });
});
