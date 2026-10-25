import { describe, expect, test } from "bun:test";
import { parseStoryTime, shortStoryTime } from "../src/trackers/clock";
import { driftCharacter } from "../src/trackers/drift";
import { extractLedger, parseLedger, parseLine } from "../src/trackers/dsl";
import { type FoldConfig, foldEvents, type TrackerEvent } from "../src/trackers/fold";
import { applyPatch } from "../src/trackers/patch";
import { buildNote } from "../src/trackers/note";
import { revealFor, revealsOf } from "../src/trackers/reveals";
import { activateLore } from "../src/lore/activate";
import { defaultEntry } from "../src/lore/types";
import { STARTER_TEMPLATES, templateSchemaZ } from "../src/trackers/schema";
import { inlineInstruction, updatePrompt } from "../src/trackers/prompts";

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
    const r = foldEvents(events([["ladder Mira>Alex: 1 — noticed his mouth, blushed"], ["ladder Mira>Alex: 2 — teased him, flirting"]]), cfg());
    expect(r.state.ladders["mira>user"]!.tier).toBe(1);
    expect(Object.values(r.verdicts)[1]!.reason).toContain("slow burn");
    const fast = foldEvents(events([["ladder Mira>Alex: 3 — sparks"]]), cfg({ romance: "fast" }));
    expect(fast.state.ladders["mira>user"]!.tier).toBe(2);
    const off = foldEvents(events([["ladder Mira>Alex: 1 — x"]]), cfg({ romance: "off" }));
    expect(off.state.ladders["mira>user"]).toBeUndefined();
  });

  test("the romance ladder only drops for a real setback", () => {
    const est = cfg({ romance: "established" });
    const r = foldEvents(events([["ladder Mira>Alex: 3 — looking at him the way she never let herself look"], ["ladder Mira>Alex: 4 — the visible lean in front of everyone"]]), est);
    expect(r.state.ladders["mira>user"]).toBeUndefined();
    expect(Object.values(r.verdicts).every((v) => !v.ok)).toBe(true);
    const hurt = foldEvents(events([["ladder Mira>Alex: 5 — he lied to her about the letter"]]), est);
    expect(hurt.state.ladders["mira>user"]!.tier).toBe(5);
    const you = foldEvents(events([["ladder Mira>Alex: 3"]], "user"), est);
    expect(you.state.ladders["mira>user"]!.tier).toBe(3);
  });

  test("a bond written old → new still moves, and tension between friends doesn't open a romance", () => {
    const r = foldEvents(
      events([
        ["bond Mira>Joss: trust +4; familiarity +3 — best friends since second grade"],
        ["bond Mira>Joss: trust +4 → +2, familiarity +3 → +2 — Joss hid a pregnancy from her", "ladder Mira>Joss: 3 Charged — the silence after yes is a new kind of charge"],
      ]),
      cfg({ romance: "fast" }),
    );
    expect(r.state.bonds["mira>joss"]!.axes).toMatchObject({ trust: 2, familiarity: 2 });
    expect(r.state.ladders["mira>joss"]).toBeUndefined();
    const kiss = foldEvents(events([["ladder Mira>Joss: 1 — she kissed him and blushed"]]), cfg({ romance: "fast" }));
    expect(kiss.state.ladders["mira>joss"]!.tier).toBe(1);
    const drawn = foldEvents(events([["bond Mira>Joss: attraction +1 — caught looking"], ["ladder Mira>Joss: 1 — noticed"]]), cfg());
    expect(drawn.state.ladders["mira>joss"]!.tier).toBe(1);
  });

  test("an item line written owner first is about the thing, not the person", () => {
    const r = foldEvents(events([["cast: Mira@spot · Joss@spot"], ["item Mira: silver bracelet — a gift", "item Mira: Lucky Strike → gone (dropped) — burned herself", "item Joss: leather jacket → Mira — lent it"]]), cfg());
    expect(r.state.items.mira).toBeUndefined();
    expect(r.state.items.joss).toBeUndefined();
    expect(r.state.items["silver-bracelet"]!.holder).toBe("mira");
    expect(r.state.items["lucky-strike"]!.gone).toBe(true);
    expect(r.state.items["leather-jacket"]!.holder).toBe("mira");
    expect(r.state.chars.mira!.dead).toBeFalsy();
  });

  test("a group named in the ledger means the people in the scene, never a new person", () => {
    const r = foldEvents(events([["cast: Mira@spot · Joss@spot · Old Tom@left"], ["know Group: the well is dry — heard it said aloud", "know everyone: the boat leaves at dawn — told", "mood Circle: calm"]]), cfg());
    const names = Object.values(r.state.chars).map((c) => c.name);
    expect(names).not.toContain("Group");
    expect(names).not.toContain("Circle");
    expect(names).not.toContain("everyone");
    const well = Object.values(r.state.facts).find((f) => f.statement === "the well is dry")!;
    expect(Object.keys(well.stances).sort()).toEqual(["joss", "mira"]);
    expect(Object.values(r.verdicts).at(-1)!.ok).toBe(false);
  });

  test("a list of names is each of those people, never one person by that name", () => {
    const r = foldEvents(events([["cast: Mira@spot · Gen, Akilah & Robin@spot"], ["mood Mira, Gen and Robin: tense", "body Akilah, Robin: fatigue +1"]]), cfg());
    const names = Object.values(r.state.chars).map((c) => c.name).sort();
    expect(names).toEqual(["Akilah", "Alex", "Gen", "Mira", "Robin"]);
    expect(["mira", "gen", "robin"].map((id) => r.state.chars[id]!.mood?.name)).toEqual(["tense", "tense", "tense"]);
    expect(r.changes.m2!.filter((c) => c.kind === "mood").map((c) => c.subject)).toEqual(["Mira", "Gen", "Robin"]);
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

  test("fear of someone and fear for someone are separate axes", () => {
    const r = foldEvents(
      events([["cast: Mira@spot · Joss@spot · Alex@spot", "bond Mira>Joss: fear +2 — he drew a knife", "bond Mira>Alex: fear for +2 — he went into the storm", "bond Joss>Alex: worries +1 — the boat is late"]]),
      cfg(),
    );
    expect(r.state.bonds["mira>joss"]!.axes).toEqual({ fear: 2 });
    expect(r.state.bonds["mira>user"]!.axes).toEqual({ worry: 2 });
    expect(r.state.bonds["joss>user"]!.axes).toEqual({ worry: 1 });
    const note = buildNote(r.state, { userName: "Alex", seq: 1 }).text;
    expect(note).toContain("fear of them");
    expect(note).toContain("worry for them");
  });

  test("knowledge and secrets", () => {
    const r = foldEvents(events([["secret #thief: Alex stole the locket | kept by Alex · from Mira"], ["reveal #thief: to Mira — he confessed"]]), cfg());
    const f = r.state.facts.thief!;
    expect(f.stances.mira!.status).toBe("knows");
    expect(f.secret!.from).toEqual([]);
  });

  test("a mode written after a scene's title counts, and a new scene doesn't inherit the last one's", () => {
    expect(parseLine("scene: The Kitchen Light | mode: downtime")!.args).toMatchObject({ to: "The Kitchen Light", mode: "downtime" });
    expect(parseLine("scene: The Drive — mode: Crisis")!.args).toMatchObject({ to: "The Drive", mode: "crisis" });
    expect(parseLine("scene: Old → New (mode: intimacy)")!.args).toMatchObject({ from: "Old", to: "New", mode: "intimacy" });
    expect(parseLine("scene: Mode of Transport")!.args.mode).toBeUndefined();
    const fold = (msgs: string[][]) => foldEvents(events(msgs), cfg()).state;
    // The drive set travel; home again, the scene line names its own mode.
    expect(fold([["scene: driving home", "mode: travel"], ["at: Sunnydale › home › kitchen", "scene: Cream Soup | mode: downtime"]]).mode).toBe("downtime");
    // A new scene that names no mode leaves it unknown, not still travelling.
    expect(fold([["scene: driving home", "mode: travel"], ["scene: Cream Soup"]]).mode).toBeUndefined();
    // Named before the move in the same message, it holds.
    expect(fold([["at: Road", "scene: driving home"], ["mode: downtime", "at: Home › kitchen", "scene: Cream Soup"]]).mode).toBe("downtime");
    // Stored events from before the parser knew read again from their text.
    const old: TrackerEvent = { id: "o1", messageId: "m2", seq: 2, source: "model", op: { op: "scene", args: { to: "Cream Soup | mode: downtime" }, raw: "scene: Cream Soup | mode: downtime" } };
    const st = foldEvents([...events([["scene: driving home", "mode: travel"]]), old], cfg()).state;
    expect([st.mode, st.sceneTitle]).toEqual(["downtime", "Cream Soup"]);
  });

  test("ledger fields written into the cause still count (reliable state 1.1)", () => {
    const k = parseLine("know Jackie: Shauna is pregnant — heard Shauna confirm · knows · true")!;
    expect(k.args).toMatchObject({ fact: "Shauna is pregnant", status: "knows", truth: "true" });
    expect(k.cause).toBe("heard Shauna confirm");
    expect(parseLine("know Jackie: Shauna's seat is empty · sees · true")!.args).toMatchObject({ fact: "Shauna's seat is empty", route: "sees", truth: "true" });
    expect(parseLine("know Jackie: reads it as shock — wrong size; how: watching · wrong")!.args.status).toBe("wrong");
    expect(parseLine("know Mira: the boat leaves — she knows it's true")!.cause).toBe("she knows it's true");
    const s = parseLine("secret #js: Jeff is sleeping with Shauna — kept by Shauna · from Jackie — Jackie knows only half")!;
    expect(s.args).toMatchObject({ keepers: ["Shauna"], from: ["Jackie"] });
    expect(s.cause).toBe("Jackie knows only half");
    expect(parseLine("secret #js: x | kept by Jeff · from Jackie — from the card")!.args.from).toEqual(["Jackie"]);
  });

  test("secret name lists and asides (1.2), crowds aren't people (1.3)", () => {
    const r = foldEvents(
      events([
        ["cast: Jackie@spot · Shauna@spot · Jeff@spot · James@spot", "secret #js: Jeff is sleeping with Shauna | kept by Jeff, Shauna · from Jackie"],
        ["secret #love: Jackie loves James | kept by Jackie · from general public; known to James, suspected by Shauna", "secret #abuse: Edwin beat him | kept by James · from Jackie, others; Misty knows", "know Group: the fire is out — saw it"],
        ["cast: Misty@arrive", "secret #ghost: x | kept by Jeff · from nobody"],
      ]),
      cfg(),
    );
    expect(r.state.facts.js!.secret).toEqual({ keepers: ["jeff", "shauna"], from: ["jackie"] });
    const love = r.state.facts.love!;
    expect(love.secret!.everyone).toBe(true);
    expect(love.secret!.from).toEqual(expect.arrayContaining(["jeff", "misty"]));
    expect(love.secret!.from).not.toContain("james");
    expect(love.stances.james!.status).toBe("knows");
    expect(love.stances.shauna!.status).toBe("suspects");
    expect(Object.keys(r.state.chars)).not.toEqual(expect.arrayContaining(["group"]));
    expect(Object.values(r.state.chars).some((c) => /public|group/i.test(c.name))).toBe(false);
    expect(r.state.facts.ghost?.secret).toBeUndefined();
    expect(r.state.facts.abuse!.secret!.from).toContain("jackie");
    expect(r.state.facts.abuse!.secret!.from).not.toContain("misty");
  });

  test("a keeper written two ways still knows their secret once the names merge", () => {
    const evs = events([["cast: Jacqueline Taylor@spot · Jeff@spot", "secret #jj: Jackie stays with Jeff for the image | kept by Jackie · from everyone"]]);
    const merge: TrackerEvent = { id: "mg", messageId: "m2", seq: 2, source: "user", op: parseLine("merge: Jackie → Jacqueline Taylor")! };
    const r = foldEvents([...evs, merge], cfg());
    const f = r.state.facts.jj!;
    expect(f.secret!.keepers).toEqual(["jacqueline-taylor"]);
    expect(f.secret!.from).not.toContain("jacqueline-taylor");
    expect(f.stances["jacqueline-taylor"]!.status).toBe("knows");
  });

  test("old knowledge lines are read again from their text", () => {
    const raw = "secret #js: Jeff is sleeping with Shauna | kept by Jeff, Shauna · from Jackie";
    // As stored before the parser split "kept by" on commas.
    const stale = { ...parseLine(raw)!, args: { key: "js", fact: "Jeff is sleeping with Shauna", keepers: ["Jeff"], from: ["Jackie"] } };
    const r = foldEvents([{ id: "s1", messageId: null, seq: 0, source: "init", op: stale }], cfg());
    expect(r.state.facts.js!.secret!.keepers).toEqual(["jeff", "shauna"]);
  });

  test("one fact, not two (1.4); a re-declared secret stays revealed (1.5)", () => {
    const r = foldEvents(
      events([
        ["cast: Jackie@spot · Shauna@spot · Jeff@spot", "know Jackie: Jeff is sleeping with Shauna, Shauna is pregnant | unaware — from the card", "secret #js: Jeff is sleeping with Shauna, Shauna is pregnant | kept by Jeff · from Jackie"],
        ["know Jackie: Jeff is sleeping with Shauna and she's pregnant — Shauna told her · knows"],
        ["secret #js: Jeff is sleeping with Shauna, Shauna is pregnant | kept by Shauna · from Jackie"],
      ]),
      cfg(),
    );
    expect(Object.keys(r.state.facts)).toEqual(["js"]);
    expect(r.state.facts.js!.stances.jackie!.status).toBe("knows");
    expect(r.state.facts.js!.secret!.from).toEqual([]);
    expect(r.state.facts.js!.secret!.keepers).toEqual(["jeff", "shauna"]);
  });

  test("a secret that came out stops reading as hidden in lore and the scene note", () => {
    const r = foldEvents(
      events([["cast: Jackie@spot · Shauna@spot · Jeff@spot", "secret #jeff-shauna: Jeff is sleeping with Shauna, Shauna is pregnant | kept by Jeff · from Jackie"], ["reveal #jeff-shauna: to Jackie — Shauna told her"]]),
      cfg(),
    );
    const reveals = revealsOf(r.state);
    expect(reveals).toMatchObject([{ key: "jeff-shauna", to: ["Jackie"], out: true }]);
    // The card's lore secret was written before the reveal, in other words.
    expect(revealFor("Jackie does not know Jeff is sleeping with Shauna.", reveals)?.key).toBe("jeff-shauna");
    expect(revealFor("Shauna's journal holds a coded record of the affair with Jeff.", reveals)).toBeUndefined();
    const lore = { ...defaultEntry({ keys: ["Shauna"], content: "Jackie's best friend.", extra: { secrets: [{ text: "Shauna is pregnant with Jeff's baby and has told no one.", knownBy: ["Jeff", "Shauna"] }] } }), id: "s", bookId: "b", bookName: "Book", book: {} };
    const run = (rv?: typeof reveals) =>
      activateLore({ entries: [lore], history: ["Shauna sits down."], messageCount: 1, state: {}, defaults: { scanDepth: 4, tokenBudget: 1000, recursive: false, maxRecursion: 0, caseSensitive: false, matchWholeWords: true }, countTokens: (s) => s.length, reveals: rv }).activated[0]!.content;
    expect(run()).toContain("[Secret — known only to Jeff, Shauna:");
    expect(run(reveals)).toContain("No longer a secret (once known only to Jeff, Shauna): it came out in the story, and Jackie found out");
    expect(run(reveals)).not.toContain("known only to Jeff, Shauna:");
    const note = buildNote(r.state, { userName: "Alex", seq: 3 }).text;
    expect(note).toContain("No longer a secret from Jackie: Jeff is sleeping with Shauna");
    expect(note).not.toContain("Jackie doesn't know");
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

describe("private thoughts", () => {
  test("every reply asks for a think line per person at the spot, never the sealed player's", () => {
    const sealed = updatePrompt({ state: "", messages: "", userName: "Alex", charName: "Mira", sealed: true, romance: "slow" }).system;
    expect(sealed).toContain("every reply gets a think line for each person at the spot except Alex");
    const open = updatePrompt({ state: "", messages: "", userName: "Alex", charName: "Mira", sealed: false, romance: "slow" }).system;
    expect(open).toContain("for each person at the spot, their reaction");
    expect(inlineInstruction("")).toContain("think: every reply, one line for each person @spot");
  });
});
