import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { migrations } from "../src/db/migrations";
import { resolveWeather } from "../../web/src/rooms/weatherglass/weather";
import { orchardSeason } from "../../web/src/rooms/orchard/season";

/** The rooms (web/src/rooms): each one a folder, listed everywhere it has to be. */
const WEB = join(import.meta.dir, "../../web");
const ROOMS_DIR = join(WEB, "src/rooms");
const read = (p: string) => readFileSync(p, "utf8");
const rooms = readdirSync(ROOMS_DIR).filter((d) => statSync(join(ROOMS_DIR, d)).isDirectory());

describe("rooms", () => {
  test("there are rooms", () => {
    expect(rooms.length).toBeGreaterThanOrEqual(4);
  });

  test.each(rooms)("%s has its four pieces and is listed everywhere", (id) => {
    for (const f of ["index.ts", "palette.css", "room.css", "Ambience.svelte"]) expect(statSync(join(ROOMS_DIR, id, f)).isFile()).toBe(true);
    expect(read(join(ROOMS_DIR, id, "index.ts"))).toContain(`id: "${id}"`);
    expect(read(join(ROOMS_DIR, "index.ts"))).toContain(`from "./${id}"`);
    // Its stylesheets come with Mea (listed in the aggregators) or the first time it's shown (styles).
    const index = read(join(ROOMS_DIR, id, "index.ts"));
    const listed = read(join(ROOMS_DIR, "palettes.css")).includes(`@import "./${id}/palette.css";`);
    if (index.includes("styles:")) {
      expect(index).toContain('import("./palette.css")');
      expect(index).toContain('import("./room.css")');
      expect(listed).toBe(false);
      expect(read(join(ROOMS_DIR, "rooms.css"))).not.toContain(`@import "./${id}/room.css";`);
    } else {
      expect(listed).toBe(true);
      expect(read(join(ROOMS_DIR, "rooms.css"))).toContain(`@import "./${id}/room.css";`);
    }
    // The pre-paint script and the settings both know it.
    expect(read(join(WEB, "public/theme.js"))).toContain(`"${id}"`);
    const themeEnum = read(join(import.meta.dir, "../src/routes/system.ts"))
      .split("\n")
      .find((l) => l.includes('"appearance.theme": z.enum('));
    expect(themeEnum).toContain(`"${id}"`);
  });
});

describe("rooms that load their stylesheets late", () => {
  // Their palette lands after picks.css, so a font token at full strength would beat the font
  // picks and the dyslexia font; at :where() strength it can't.
  const late = rooms.filter((id) => read(join(ROOMS_DIR, id, "index.ts")).includes("styles:"));
  test.each(late)("%s sets its fonts at :where() strength", (id) => {
    const blocks = read(join(ROOMS_DIR, id, "palette.css")).split("}");
    const fontBlocks = blocks.filter((b) => /--font-/.test(b));
    expect(fontBlocks.length).toBeGreaterThan(0);
    for (const b of fontBlocks) expect(b.slice(0, b.indexOf("{"))).toContain(":root:where(");
  });
});

/** Every @keyframes block in a stylesheet or a Svelte <style>. */
function keyframes(css: string) {
  const out: { name: string; body: string }[] = [];
  const re = /@keyframes\s+([\w-]+)\s*\{/g;
  for (let m; (m = re.exec(css)); ) {
    let depth = 1;
    let i = re.lastIndex;
    while (i < css.length && depth) depth += css[i] === "{" ? 1 : css[i] === "}" ? -1 : 0, i++;
    out.push({ name: m[1]!, body: css.slice(re.lastIndex, i) });
  }
  return out;
}

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.(css|svelte)$/.test(f) ? [p] : [];
  });
}

describe("backdrops move on the compositor", () => {
  // Animating background-position repaints the whole layer every frame; on a screen-sized backdrop
  // that halved the frame rate in an embedded browser (VENUS). Move the layer with a transform.
  // (Small things, like a progress stripe or a shine across a word, are fine and aren't checked.)
  test("no backdrop keyframes animate background-position", () => {
    const backdrops = [...files(ROOMS_DIR), join(WEB, "src/components/Ambience.svelte"), join(WEB, "src/components/Sky.svelte")];
    const offenders = backdrops.flatMap((p) =>
      keyframes(read(p))
        .filter((k) => /background-position/.test(k.body))
        .map((k) => `${p.slice(WEB.length + 1)}: @keyframes ${k.name}`),
    );
    expect(offenders).toEqual([]);
  });
});

describe("Weatherglass", () => {
  test("the sky follows the scene unless it's pinned", () => {
    expect(resolveWeather("scene", "storm")).toBe("storm");
    expect(resolveWeather("scene", "wind")).toBe("cloudy");
    expect(resolveWeather("scene", "clear")).toBe("fair");
    expect(resolveWeather("scene", null)).toBe("fair");
    expect(resolveWeather("snow", "storm")).toBe("snow");
    expect(resolveWeather(undefined, "rain")).toBe("rain");
  });
});

describe("Mea Cozy is retired", () => {
  test("a saved Cozy theme moves to Lantern; rooms stay", () => {
    const db = new Database(":memory:");
    db.exec("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    const m = migrations.find((x) => x.name === "no cozy theme")!;
    for (const [value, after] of [
      ['"light"', '"lantern"'],
      ['"dark"', '"lantern"'],
      ['"system"', '"lantern"'],
      ['"citadel"', '"citadel"'],
    ] as const) {
      db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('appearance.theme', ?)", [value]);
      db.exec(m.sql!);
      expect(db.query<{ value: string }, []>("SELECT value FROM settings WHERE key = 'appearance.theme'").get()!.value).toBe(after);
    }
  });
});

describe("Night Train and Form are retired", () => {
  test("a saved Night Train or Form moves to Lantern; other rooms stay", () => {
    const db = new Database(":memory:");
    db.exec("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    const m = migrations.find((x) => x.name === "night train and form retired")!;
    for (const [value, after] of [
      ['"nighttrain"', '"lantern"'],
      ['"form"', '"lantern"'],
      ['"caravanserai"', '"caravanserai"'],
    ] as const) {
      db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('appearance.theme', ?)", [value]);
      db.exec(m.sql!);
      expect(db.query<{ value: string }, []>("SELECT value FROM settings WHERE key = 'appearance.theme'").get()!.value).toBe(after);
    }
  });
});

describe("speaker styles after Blocks", () => {
  test("a retired style moves to Blocks; Off and the new styles stay", () => {
    const db = new Database(":memory:");
    db.exec("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    const m = migrations.find((x) => x.name === "speaker styles after blocks")!;
    for (const [voices, after] of [
      ["ink", "blocks"],
      ["script", "blocks"],
      ["halo", "blocks"],
      ["off", "off"],
      ["balloons", "balloons"],
    ] as const) {
      db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('appearance.living', ?)", [JSON.stringify({ voices, artifacts: true, window: true, thoughts: "drawer" })]);
      db.exec(m.sql!);
      const saved = JSON.parse(db.query<{ value: string }, []>("SELECT value FROM settings WHERE key = 'appearance.living'").get()!.value);
      expect(saved.voices).toBe(after);
      expect(saved.thoughts).toBe("drawer");
    }
  });

  test("each style has its stylesheet, a loader and a place in the picker", () => {
    const voices = read(join(WEB, "src/lib/voices.ts"));
    const picker = read(join(WEB, "src/components/settings/Appearance.svelte"));
    for (const id of ["balloons", "quest", "texts", "sticky", "seal", "stage", "patch", "holo"]) {
      expect(statSync(join(WEB, `src/styles/voices/${id}.css`)).isFile()).toBe(true);
      expect(voices).toContain(`import("../styles/voices/${id}.css")`);
      expect(picker).toContain(`<option value="${id}">`);
    }
  });
});

describe("Orchard", () => {
  test("the leaves follow the story's season", () => {
    expect(orchardSeason("spring", 4)).toBe("blossom");
    expect(orchardSeason("summer", 7)).toBe("summer");
    expect(orchardSeason("autumn", 9)).toBe("early");
    expect(orchardSeason("autumn", 10)).toBe("peak");
    expect(orchardSeason("autumn", 11)).toBe("late");
    expect(orchardSeason("Late autumn", null)).toBe("late");
    expect(orchardSeason("winter", 1)).toBe("late");
    expect(orchardSeason(null, null)).toBe("peak");
  });
});
