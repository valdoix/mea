import { beforeAll, describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import { mixFromTypes, RECIPES } from "../src/lore/mix";
import { addItem, createDraft, getDraft, kindGaps, missingSatellites, patchDraft, planGaps, planOutline, planPack } from "../src/lore/studio";
import { createConnection, createProfile, syncModels } from "../src/services/connections";
import { registerJob } from "../src/services/jobs";
import { freshDb } from "./helpers";

let app: ReturnType<typeof createApp>;
const local = { requestIP: () => ({ address: "127.0.0.1", family: "IPv4", port: 5000 }) };
const call = async (method: string, path: string, body?: unknown) => (await app.fetch(new Request(`http://localhost${path}`, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }), local)).json() as Promise<any>;

beforeAll(async () => {
  freshDb();
  app = createApp();
  for (const kind of ["lore.studio", "lore.embed"]) registerJob(kind, async () => {});
  const conn = createConnection({ name: "Mock", kind: "mock", billing: "subscription" });
  await syncModels(conn);
  createProfile({ name: "Story", connectionId: conn, modelId: "mock/storyteller", params: { context_target: 4000 } });
});

/** A draft with two people in its plan, and nothing else. */
function twoPeople(options: Parameters<typeof createDraft>[0]["options"] = {}) {
  const d = createDraft({ kind: "idea", text: "Mira Vell keeps the lighthouse at Port Ellis. Joss Arden hides in her oil store.", options });
  const mira = addItem(d.id, { title: "Mira Vell", category: "character", pitch: "The keeper's daughter." }).item;
  const joss = addItem(d.id, { title: "Joss Arden", category: "character", pitch: "A deserter." }).item;
  return { id: d.id, mira, joss };
}

describe("planning by kind (docs/17, Part 2)", () => {
  test("the mix: old drafts' kinds become a mix, recipes are real mixes, kinds are typed by their kind", () => {
    expect(createDraft({ kind: "idea", text: "x", options: { types: ["character", "concept"] } }).options.mix).toEqual({ character: "each", power: "few", customs: "few" });
    expect(mixFromTypes([])).toEqual({});
    expect(createDraft({ kind: "idea", text: "x" }).options).toMatchObject({ mix: {}, recipe: "" });
    expect(RECIPES.find((r) => r.id === "companion")!.mix).toMatchObject({ voice: "each", reaction: "each" });
    const { mira } = twoPeople();
    expect(mira.type).toBe("character");
  });

  test("a fresh plan gives every core person their satellites, about them", async () => {
    const d = createDraft({ kind: "idea", text: "Joss Arden and Wren Hale run the ferry at Port Ellis.", options: { size: "small", mix: { character: "each", voice: "each", relationship: "few" } } });
    const planned = await planOutline(d.id);
    const people = planned.items.filter((i) => i.category === "character");
    expect(people.length).toBeGreaterThan(0);
    const voices = planned.items.filter((i) => i.category === "voice");
    // One voice for each core person, about that person, written after them.
    expect(voices.length).toBeGreaterThan(0);
    for (const v of voices) {
      const who = planned.items.find((i) => i.id === v.about[0])!;
      expect(v.title).toBe(`Voice: ${who.title}`);
      expect(planned.items.indexOf(v)).toBeGreaterThan(planned.items.indexOf(who));
    }
    expect(new Set(voices.map((v) => v.about[0])).size).toBe(voices.length);
    // "A few" relationships: only one here, about two people.
    const bonds = planned.items.filter((i) => i.category === "relationship");
    expect(bonds.length).toBe(1);
    expect(bonds[0]!.about.length).toBe(2);
  });

  test("a kind the mix leaves out isn't planned", async () => {
    const d = createDraft({ kind: "idea", text: "A harbour town called Port Ellis.", options: { size: "small", mix: { location: "each" } } });
    await planOutline(d.id);
    const cur = await planOutline(d.id, { mode: "more", steer: 'Only situations already under way when the story opens, each with "now": true.' });
    expect(cur.items.some((i) => i.category === "current")).toBe(false);
  });

  test("Pack: a person's missing satellites, right after them; then nothing is missing", async () => {
    const { id, mira, joss } = twoPeople();
    expect(missingSatellites(getDraft(id)!, mira.id)).toEqual(["voice", "relationship", "reaction", "secret"]);
    const after = await planPack(id, mira.id);
    const sats = after.items.filter((i) => i.about.includes(mira.id));
    expect(sats.map((i) => i.category).sort()).toEqual(["reaction", "relationship", "secret", "voice"]);
    expect(sats.find((i) => i.category === "relationship")!.about).toEqual([mira.id, joss.id]);
    // Written after Mira and before Joss.
    const order = after.items.map((i) => i.id);
    for (const s of sats) expect(order.indexOf(s.id)).toBeGreaterThan(order.indexOf(mira.id));
    expect(order.indexOf(joss.id)).toBeGreaterThan(Math.max(...sats.map((s) => order.indexOf(s.id))));
    expect(missingSatellites(after, mira.id)).toEqual([]);
    // Just one kind; a second Pack plans nothing new.
    const only = await planPack(id, joss.id, ["voice"]);
    expect(only.items.filter((i) => i.about[0] === joss.id).map((i) => i.title)).toEqual(["Voice: Joss Arden"]);
    expect((await planPack(id, mira.id)).items.length).toBe(only.items.length);
  });

  test("kind gaps: people without a voice, a book based on a work without a timeline boundary, and planning them", async () => {
    const { id, mira, joss } = twoPeople({ mix: { voice: "each" } });
    expect(kindGaps(getDraft(id)!)).toEqual([
      { kind: "voice", about: [mira.id], label: "Mira Vell" },
      { kind: "voice", about: [joss.id], label: "Joss Arden" },
    ]);
    const filled = await planGaps(id);
    expect(filled.items.filter((i) => i.category === "voice").map((i) => i.about[0])).toEqual([mira.id, joss.id]);
    expect(kindGaps(filled)).toEqual([]);

    patchDraft(id, { basedOn: "Buffy the Vampire Slayer (TV)", options: { mix: { voice: "each", timeline: "few" } } });
    expect(kindGaps(getDraft(id)!).map((g) => g.kind)).toEqual(["timeline"]);
    const withBoundary = await planGaps(id);
    expect(withBoundary.items[0]).toMatchObject({ category: "timeline", constant: true });
    expect(kindGaps(withBoundary)).toEqual([]);
  });

  test("the routes: options take a mix, gaps and Pack, the recipes", async () => {
    const { id, mira } = twoPeople();
    const put = await call("PUT", `/api/lore-studio/${id}`, { options: { mix: { voice: "each", hook: "few" }, recipe: "" } });
    expect(put.draft.options.mix).toEqual({ voice: "each", hook: "few" });
    const gaps = await call("GET", `/api/lore-studio/${id}/gaps`);
    expect(gaps.kinds.map((g: any) => g.kind)).toEqual(["voice", "voice"]);
    expect(gaps.missing[mira.id]).toEqual(["voice"]);
    const packed = await call("POST", `/api/lore-studio/${id}/pack`, { itemId: mira.id });
    expect(packed.draft.items.some((i: any) => i.title === "Voice: Mira Vell")).toBe(true);
    expect((await call("GET", "/api/lore-studio-recipes")).recipes.length).toBe(RECIPES.length);
    // A satellite's subjects can be set, and never include itself.
    const voice = packed.draft.items.find((i: any) => i.category === "voice");
    const patched = await call("PUT", `/api/lore-studio/${id}/items/${voice.id}`, { about: [voice.id, mira.id] });
    expect(patched.draft.items.find((i: any) => i.id === voice.id).about).toEqual([mira.id]);
  });
});
