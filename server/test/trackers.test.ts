import { describe, expect, test } from "bun:test";
import { parseStoryTime, shortStoryTime } from "../src/trackers/clock";
import { driftCharacter } from "../src/trackers/drift";
import { extractLedger, parseLedger, parseLine } from "../src/trackers/dsl";
import { type FoldConfig, foldEvents, type TrackerEvent } from "../src/trackers/fold";
import { applyPatch } from "../src/trackers/patch";
import { STARTER_TEMPLATES, templateSchemaZ } from "../src/trackers/schema";

const cfg = (over: Partial<FoldConfig> = {}): FoldConfig => ({
  userName: "Alex",
  mainName: "Mira",
  sealedPersona: true,
  romance: "slow",
  strictness: "lenient",
  limits: true,
  templates: STARTER_TEMPLATES,
  ...over,
});

let n = 0;
/** Lines → events, one message per array entry (seq = index + 1). */
function events(messages: string[][], source: TrackerEvent["source"] = "model"): TrackerEvent[] {
  return messages.flatMap((lines, i) => lines.map((l) => ({ id: `e${++n}`, messageId: `m${i + 1}`, seq: i + 1, source, op: parseLine(l)! })));
}

describe("ledger language", () => {
  test("parses the common shapes", () => {
    expect(parseLine("clock: +45m")!.args.plus).toBe(45);
    expect(parseLine("clock: +2h")!.args.plus).toBe(120);
    expect(parseLine("clock: Day 3 21:40")!.args.set).toBe("Day 3 21:40");
    const b = parseLine("bond Mira>Alex: trust +1; affection -2 — he gave the locket back")!;
    expect(b.subject).toBe("Mira");
    expect(b.object).toBe("Alex");
    expect(b.cause).toBe("he gave the locket back");
    expect(b.args.moves).toEqual([
      { axis: "trust", delta: 1 },
      { axis: "affection", delta: -2 },
    ]);
    const c = parseLine("cast: Mira@spot(by the stove) · Joss@left(→ street)")!;
    expect(c.args.list[1]).toEqual({ name: "Joss", tier: "left", note: "→ street" });
    const body = parseLine("body Mira: soaked; fatigue 3; hunger +1; injury: left arm, wound, bandaged")!;
    expect(body.args.meters).toEqual([
      { meter: "fatigue", set: 3 },
      { meter: "hunger", delta: 1 },
    ]);
    expect(body.args.injuries[0]).toMatchObject({ where: "left arm", severity: "wound", treated: true });
    expect(body.args.flags).toEqual(["soaked"]);
    expect(parseLine("item Locket: Alex → Mira — returned")!.args).toMatchObject({ from: "Alex", to: "Mira" });
    expect(parseLine("item Letter: → burned")!.args.gone).toBe("burned");
    expect(parseLine("thread Lost locket: advance — Mira owes Alex a favour")!.args.action).toBe("advance");
    expect(parseLine("clockf Harbor Guild: smuggling run +1 (3/6)")!.args).toMatchObject({ project: "smuggling run", delta: 1, cur: 3, max: 6 });
    expect(parseLine("know Mira: Alex is a courier | told · believes · true")!.args).toMatchObject({ fact: "Alex is a courier", status: "believes", truth: "true", route: "told" });
    expect(parseLine("promise Alex>Mira: meet at the pier | open [due Day 4 06:00]")!.args).toMatchObject({ what: "meet at the pier", status: "open", due: "Day 4 06:00" });
  });

  test("pulls a <ledger> block out of a reply", () => {
    const r = extractLedger("She smiles.\n<ledger>\nclock: +5m\n</ledger>");
    expect(r.rest).toBe("She smiles.");
    expect(r.body?.trim()).toBe("clock: +5m");
    expect(extractLedger("Text <ledger>\nclock: +5m").truncated).toBe(true);
    const p = parseLedger("<ledger>\n- clock: +5m\nnonsense here\nmood Mira: calm\n</ledger>");
    expect(p.ops.map((o) => o.op)).toEqual(["clock", "mood"]);
    expect(p.unknown).toEqual(["nonsense here"]);
  });
});

describe("story clock (TRK-10)", () => {
  test("both forms", () => {
    expect(parseStoryTime("Day 3 21:40")!.minutes).toBe(2 * 1440 + 21 * 60 + 40);
    expect(shortStoryTime("2026-03-12 23:10")).toBe("Thu 23:10");
    expect(shortStoryTime("Day 3 21:40")).toBe("Day 3 · 21:40");
  });

  test("moves forward, caps, and refuses to run backwards", () => {
    const r = foldEvents(events([["clock: Day 1 08:00"], ["clock: +45m"], ["clock: Day 1 07:00"], ["clock: Day 1 06:00 flashback"], ["clock: +20d"]]), cfg());
    const v = Object.values(r.verdicts);
    expect(v[2]!.ok).toBe(false);
    expect(v[3]!.ok).toBe(true);
    expect(v[4]!.warn).toContain("capped");
    expect(r.changes.m2![0]!.text).toBe("Day 1 · 08:00 → Day 1 · 08:45");
  });
});

describe("fold rules", () => {
  test("bond moves are capped and need sensible input", () => {
    const r = foldEvents(events([["bond Mira>Alex: trust +4 — he smiled"], ["bond Mira>Alex: trust +3 — he saved her life"], ["bond Mira>Mira: trust +1 — x"]]), cfg());
    expect(r.state.bonds["mira>user"]!.axes.trust).toBe(5);
    expect(r.changes.m1![0]!.flag).toBe("capped from +4");
    expect(r.state.bonds["mira>user"]!.history.map((h) => h.delta)).toEqual([2, 3]);
    expect(Object.values(r.verdicts)[2]!.ok).toBe(false);
  });

  test("deaths: the grammar's own \"dead Name — cause\" form works, and the user's fate is theirs", () => {
    expect(parseLine("dead Old Tom — lost in the storm")).toMatchObject({ op: "dead", subject: "Old Tom", cause: "lost in the storm" });
    const r = foldEvents(events([["cast: Mira@spot · Old Tom@spot"], ["dead Old Tom — lost in the storm", "dead Alex — x"]]), cfg());
    const tom = Object.values(r.state.chars).find((c) => c.name === "Old Tom")!;
    expect(tom.dead).toBe(true);
    expect(tom.tier).toBe("off");
    expect(r.state.chars.user!.dead).toBeFalsy();
    expect(r.state.milestones.some((m) => m.text.startsWith("Old Tom died"))).toBe(true);
  });

  test("sealed persona: the model can't write the user's feelings", () => {
    const r = foldEvents(events([["mood Alex: nervous"], ["bond Alex>Mira: trust +1 — x"]]), cfg());
    expect(Object.values(r.verdicts).every((v) => !v.ok)).toBe(true);
    const open = foldEvents(events([["mood Alex: nervous"]]), cfg({ sealedPersona: false }));
    expect(open.state.chars.user!.mood?.name).toBe("nervous");
  });

  test("romance ladder respects the pace", () => {
    const r = foldEvents(events([["ladder Mira>Alex: 1 — noticed him"], ["ladder Mira>Alex: 2 — teased him"]]), cfg());
    expect(r.state.ladders["mira>user"]!.tier).toBe(1);
    expect(Object.values(r.verdicts)[1]!.reason).toContain("slow burn");
    const fast = foldEvents(events([["ladder Mira>Alex: 3 — sparks"]]), cfg({ romance: "fast" }));
    expect(fast.state.ladders["mira>user"]!.tier).toBe(2);
    const off = foldEvents(events([["ladder Mira>Alex: 1 — x"]]), cfg({ romance: "off" }));
    expect(off.state.ladders["mira>user"]).toBeUndefined();
  });

  test("traits from the card hold against the story", () => {
    const r = foldEvents(events([["trait Mira: blue eyes"], ["trait Mira: green eyes; a scar over her brow"]]), cfg({ seedTraits: { mira: ["green eyes"] } }));
    const eyes = r.state.chars.mira!.traits.find((t) => t.kind === "eyes")!;
    expect(eyes.text).toBe("green eyes");
    expect(Object.values(r.verdicts)[0]!.warn).toContain("from the card");
    expect(r.state.chars.mira!.traits.some((t) => t.kind === "scar")).toBe(true);
  });

  test("items, threads, promises and their effects", () => {
    const r = foldEvents(
      events([
        ["clock: Day 1 20:00", "item Locket: +Alex — found it", "thread Lost locket: new — Mira lost her mother's locket", "promise Alex>Mira: meet at the pier | open [due Day 2 06:00]"],
        ["item Locket: Alex → Mira — returned", "thread Lost locket: advance — Mira lost her mother's locket"],
        ["clock: Day 2 07:00", "promise Alex>Mira: meet at the pier | broken — he overslept"],
        ["thread Lost locket: resolve — the locket is home"],
      ]),
      cfg(),
    );
    expect(r.state.items.locket!.holder).toBe("mira");
    expect(r.state.items.locket!.owner).toBe("user");
    expect(r.state.threads["lost-locket"]!.history.length).toBe(2);
    expect(r.state.threads["lost-locket"]!.status).toBe("resolved");
    expect(r.changes.m3!.some((c) => c.text.startsWith("Promise due"))).toBe(true);
    expect(r.state.bonds["mira>user"]!.axes).toMatchObject({ trust: -1, resentment: 1 });
  });

  test("knowledge and secrets", () => {
    const r = foldEvents(events([["secret #thief: Alex stole the locket | kept by Alex · from Mira"], ["reveal #thief: to Mira — he confessed"]]), cfg());
    const f = r.state.facts.thief!;
    expect(f.stances.mira!.status).toBe("knows");
    expect(f.secret!.from).toEqual([]);
  });

  test("custom template fields", () => {
    const r = foldEvents(events([["set survival.supplies: 60 — found a cache"], ["set survival.supplies: 95 — x"]]), cfg());
    expect(r.state.custom.survival!.supplies).toBe(70);
    expect(r.changes.m2![0]!.flag).toContain("capped");
  });

  test("swipes: only the active swipe's events count (the caller filters)", () => {
    const a = foldEvents(events([["clock: Day 1 08:00"], ["mood Mira: angry"]]), cfg());
    const b = foldEvents(events([["clock: Day 1 08:00"], ["mood Mira: amused"]]), cfg());
    expect(a.state.chars.mira!.mood!.name).toBe("angry");
    expect(b.state.chars.mira!.mood!.name).toBe("amused");
  });
});

describe("drift (ALMANAC §6.3)", () => {
  test("needs build, sleep restores, wounds heal", () => {
    const r = foldEvents(events([["clock: Day 1 08:00", "cast: Mira@spot", "body Mira: injury: arm, scratch"], ["clock: +10h"]]), cfg());
    const m = r.state.chars.mira!;
    expect(m.meters.fatigue).toBeGreaterThan(2);
    const c = structuredClone(m);
    c.tier = "off";
    c.meters.fatigue = 4;
    driftCharacter(c, parseStoryTime("Day 1 22:00")!.minutes, parseStoryTime("Day 4 08:00")!.minutes);
    expect(c.meters.fatigue).toBeLessThan(4);
    expect(c.meters.hunger).toBe(1);
    expect(c.injuries.length).toBe(0);
  });

  test("illnesses run their course; the immune don't catch them", () => {
    const r = foldEvents(events([["clock: Day 1 08:00", "body Mira: has a streaming cold"], ["clock: +7d"]]), cfg());
    expect(r.state.chars.mira!.conditions.length).toBe(0);
    const v = foldEvents(events([["clock: Day 1 08:00", "body Mira: a nasty cold"]]), cfg({ stamina: { mira: "vampire" } }));
    expect(v.state.chars.mira!.conditions.length).toBe(0);
  });
});

describe("custom templates (TRK-01)", () => {
  test("validation and patching", () => {
    expect(templateSchemaZ.safeParse({ fields: [{ key: "x", label: "X", type: "enum" }] }).success).toBe(false);
    for (const t of STARTER_TEMPLATES) expect(templateSchemaZ.safeParse(t.schema).success).toBe(true);
    const r = applyPatch({}, { changes: [{ path: "adventurer.quests[Find the key].status", value: "active" }] }, { templates: STARTER_TEMPLATES, source: "ai" });
    expect((r.state.adventurer!.quests as { quest: string; status: string }[])[0]).toMatchObject({ quest: "Find the key", status: "active" });
  });
});

describe("one person, one entry", () => {
  const userCfg = cfg({ userName: "James Holloway", mainName: "Jackie Taylor" });
  const names = (r: ReturnType<typeof foldEvents>) => Object.values(r.state.chars).map((c) => c.name).sort();

  test("a place after the @ is not part of the name", () => {
    expect(parseLine("cast: Jackie Taylor@down-slope(finding James) · Misty Quigley@down-slope@spot(kit) · Shauna@left(→ wreck)")!.args.list).toEqual([
      { name: "Jackie Taylor", tier: "spot", note: "finding James" },
      { name: "Misty Quigley", tier: "spot", note: "kit" },
      { name: "Shauna", tier: "left", note: "→ wreck" },
    ]);
  });

  test("names already stored with a place still resolve, and first names stay unambiguous", () => {
    // The shape older versions stored: the place glued to the name.
    const stored = { op: "cast" as const, args: { list: [{ name: "Jackie Taylor@down-slope", tier: "spot", note: "finding James" }, { name: "James Holloway@down-slope", tier: "spot" }] }, raw: "cast: …" };
    const evs: TrackerEvent[] = [{ id: "s1", messageId: "m1", seq: 1, source: "model", op: stored }, ...events([[], ["mood Jackie: warm", "body James: pain 1", "mood Holloway: tired"]])];
    const r = foldEvents(evs, userCfg);
    expect(names(r)).toEqual(["Jackie Taylor", "James Holloway"]);
    expect(r.state.chars["jackie-taylor"]!.mood!.name).toBe("warm");
  });

  test("merge folds one into another, bonds and items included", () => {
    const r = foldEvents(
      [
        ...events([["cast: Jackie@spot · Jax@spot", "bond Jax>James: trust +1 — x", "item Locket: → Jax — given", "trait Jax: freckles"]]),
        ...events([[], ["merge Jax → Jackie Taylor"]], "user"),
        ...events([[], [], ["mood Jax: giddy"]]),
      ],
      userCfg,
    );
    expect(names(r)).toEqual(["Jackie Taylor", "James Holloway"]);
    const j = r.state.chars["jackie-taylor"]!;
    expect(j.aliases).toContain("Jax");
    expect(j.traits.some((t) => t.text === "freckles")).toBe(true);
    expect(r.state.bonds["jackie-taylor>user"]!.axes.trust).toBe(1);
    expect(r.state.items.locket!.holder).toBe("jackie-taylor");
    // The old name now finds the merged person.
    expect(j.mood!.name).toBe("giddy");
  });

  test("edit sets any field; only you can, and a person keeps their shape", () => {
    expect(parseLine('edit ["chars","mira","mood"] = {"name":"calm","seq":1}')).toMatchObject({ op: "edit", args: { path: ["chars", "mira", "mood"], value: { name: "calm", seq: 1 } } });
    const r = foldEvents(
      [
        ...events([["cast: Mira@spot · Joss@spot", "bond Joss>Mira: trust +1 — x"]]),
        ...events([[], ['edit ["chars","mira","look"] = "a red coat"', 'edit ["chars","mira","traits"] = "oops"', 'edit ["chars","joss"] = null', 'edit ["threads","heist"] = {"id":"heist","title":"The heist","status":"open","openedSeq":0,"lastSeq":0,"history":[]}']], "user"),
        ...events([[], [], ['edit ["chars","mira","look"] = "stolen"']], "model"),
      ],
      cfg(),
    );
    const mira = r.state.chars.mira!;
    expect(mira.look).toBe("a red coat");
    expect(Array.isArray(mira.traits)).toBe(true);
    expect(r.state.chars.joss).toBeUndefined();
    expect(Object.keys(r.state.bonds).some((k) => k.includes("joss"))).toBe(false);
    expect(r.state.threads.heist!.title).toBe("The heist");
    expect(Object.values(r.verdicts).at(-1)!.ok).toBe(false);
  });
});
