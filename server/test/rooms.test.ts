import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { migrations } from "../src/db/migrations";

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
    expect(read(join(ROOMS_DIR, "palettes.css"))).toContain(`@import "./${id}/palette.css";`);
    expect(read(join(ROOMS_DIR, "rooms.css"))).toContain(`@import "./${id}/room.css";`);
    // The pre-paint script and the settings both know it.
    expect(read(join(WEB, "public/theme.js"))).toContain(`"${id}"`);
    const themeEnum = read(join(import.meta.dir, "../src/routes/system.ts"))
      .split("\n")
      .find((l) => l.includes('"appearance.theme": z.enum('));
    expect(themeEnum).toContain(`"${id}"`);
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
  // (Small things, like a progress stripe, are fine and aren't checked.)
  test("no backdrop keyframes animate background-position", () => {
    const backdrops = [...files(ROOMS_DIR), ...files(join(WEB, "src/styles")), join(WEB, "src/components/Ambience.svelte"), join(WEB, "src/components/Sky.svelte")];
    const offenders = backdrops.flatMap((p) =>
      keyframes(read(p))
        .filter((k) => /background-position/.test(k.body))
        .map((k) => `${p.slice(WEB.length + 1)}: @keyframes ${k.name}`),
    );
    expect(offenders).toEqual([]);
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
