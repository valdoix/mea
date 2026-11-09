import { describe, expect, test } from "bun:test";
import { parseLine } from "../src/trackers/dsl";
import { type FoldConfig, foldEvents, groupReach, type TrackerEvent } from "../src/trackers/fold";
import { currentMembers, groupKey, groupsInText, groupsLine, kindOfGroup, possessiveAnchor } from "../src/trackers/groups";
import { stateForModel } from "../src/trackers/prompts";
import { STARTER_TEMPLATES } from "../src/trackers/schema";
import { buildRoster } from "../src/sim/roster";

/**
 * docs/30 Part 1: groups become factions. The lines are this story's own (Filed Under Forever) or
 * written the way its tracker writes them.
 */

const cfg = (over: Partial<FoldConfig> = {}): FoldConfig => ({
  userName: "Gabriel Winters",
  mainName: "Buffy Summers",
  sealedPersona: true,
  romance: "slow",
  strictness: "lenient",
  limits: true,
  templates: STARTER_TEMPLATES,
  factions: [{ name: "Scoobies", members: ["Willow", "Xander", "Anya", "Tara"], source: "you" }],
  ...over,
});

let n = 0;
function events(messages: string[][], source: TrackerEvent["source"] = "model"): TrackerEvent[] {
  return messages.flatMap((lines, i) => lines.map((l) => ({ id: `g${++n}`, messageId: `m${i + 1}`, seq: i + 1, source, op: parseLine(l)! })));
}
const opening = ["cast: Buffy Summers@spot · Dawn@spot · Spike@spot", "cast: Willow@off · Xander@off · Anya@off · Tara@off"];
const knows = (r: ReturnType<typeof foldEvents>, who: string, text: string) => {
  const c = Object.values(r.state.chars).find((x) => x.name === who);
  const f = Object.values(r.state.facts).find((x) => x.statement.includes(text));
  return c && f ? f.stances[c.id] : undefined;
};
const names = (r: ReturnType<typeof foldEvents>) => Object.values(r.state.chars).map((c) => c.name);

describe("the story's groups (docs/30 1.2)", () => {
  test("a group named with its people becomes a faction, and its name stands for them later", () => {
    const r = foldEvents(
      events([
        [...opening, "cast: Dawn's friends (Melissa, Kara, Jamie)@off"],
        ["know Dawn's friends: Dawn's sister has a vampire boyfriend | at the mall · believes — they saw Spike"],
      ]),
      cfg(),
    );
    const g = r.state.groups!["dawn's friends"]!;
    expect(g.source).toBe("story");
    expect(g.adopted).toBe(true);
    expect(g.kind).toBe("circle");
    expect(g.anchor).toBe("Dawn");
    expect(currentMembers(g).map((m) => m.name)).toEqual(["Melissa", "Kara", "Jamie"]);
    for (const who of ["Melissa", "Kara", "Jamie"]) expect(knows(r, who, "vampire boyfriend")?.route).toContain("via the Dawn's friends");
    expect(names(r)).not.toContain("Dawn's friends");
    expect(g.facts.map((x) => x.text)).toEqual(["Dawn's sister has a vampire boyfriend"]);
  });

  test("Ask me: the group waits, and its name alone stands for nobody", () => {
    const r = foldEvents(
      events([
        [...opening, "cast: Dawn's friends (Melissa, Kara, Jamie)@off"],
        ["know Dawn's friends: Dawn's sister has a vampire boyfriend | at the mall — they saw Spike"],
      ]),
      cfg({ groupsMode: "ask" }),
    );
    expect(r.state.groups!["dawn's friends"]!.adopted).toBe(false);
    expect(knows(r, "Melissa", "vampire boyfriend")).toBeUndefined();
    expect(Object.values(r.verdicts).some((v) => !v.ok && /group/.test(v.reason ?? ""))).toBe(true);
  });

  test("Not a group: never adopted", () => {
    const r = foldEvents(events([[...opening, "cast: Dawn's friends (Melissa, Kara)@off"], ["know Dawn's friends: the mall closes at nine | Dawn said — overheard"]]), cfg({ notGroups: ["Dawn's friends"] }));
    expect(r.state.groups!["dawn's friends"]!.adopted).toBe(false);
    expect(knows(r, "Melissa", "mall closes")).toBeUndefined();
  });

  test("named in two messages, it's a faction even before anyone is named in it", () => {
    const r = foldEvents(events([[...opening, "mood the Hellions' crew: rowdy — the band"], ["bond the Hellions' crew>Dawn: trust -1 — they jeered"]]), cfg());
    const g = r.state.groups!["hellions' crew"]!;
    expect(g.mentions).toBe(2);
    expect(g.adopted).toBe(true);
    expect(names(r)).not.toContain("the Hellions' crew");
  });

  test("the same group, written with and without 'the', in any case, is one", () => {
    const r = foldEvents(events([[...opening, "cast: the Potentials (Kennedy, Rona)@off"], ["know potentials: the First is real | Buffy told them — training"]]), cfg());
    expect(Object.keys(r.state.groups!).filter((k) => k.includes("potential"))).toEqual(["potentials"]);
    expect(knows(r, "Kennedy", "First is real")?.status).toBe("knows");
  });
});

describe("member lines and @Group (docs/30 1.5)", () => {
  test("parses joins and leaves, with a role and a reason", () => {
    expect(parseLine("member Scoobies: + Dawn | junior · since she found the Slayer handbook")).toMatchObject({ op: "member", subject: "Scoobies", args: { leave: false, names: ["Dawn"], role: "junior", why: "since she found the Slayer handbook" } });
    expect(parseLine("member @Scoobies: - Anya — left after the wedding")).toMatchObject({ op: "member", subject: "Scoobies", args: { leave: true, names: ["Anya"] }, cause: "left after the wedding" });
    expect(parseLine("member Scoobies: + Faith, Kennedy and Rona")!.args.names).toEqual(["Faith", "Kennedy", "Rona"]);
  });

  test("who's in it changes over time, and only those in it then are told", () => {
    const r = foldEvents(
      events([
        opening,
        ["know Scoobies: the Initiative is hunting demons | Riley's files · knows — Willow hacked them"],
        ["member Scoobies: + Dawn | junior · she found the handbook", "member Scoobies: - Anya — left after the wedding"],
        ["know @Scoobies: the First can look like the dead | Buffy warned them — patrol"],
      ]),
      cfg(),
    );
    const g = r.state.groups!.scoobies!;
    expect(g.source).toBe("you");
    expect(currentMembers(g).map((m) => m.name)).toEqual(["Willow", "Xander", "Tara", "Dawn"]);
    expect(g.members.find((m) => m.name === "Dawn")).toMatchObject({ since: 3, role: "junior" });
    expect(g.members.find((m) => m.name === "Anya")).toMatchObject({ since: 0, left: 3, why: "left after the wedding" });
    // Dawn joined later: she wasn't told what the group knew before.
    expect(knows(r, "Dawn", "Initiative")).toBeUndefined();
    expect(knows(r, "Dawn", "look like the dead")?.status).toBe("knows");
    // Anya left: she isn't told the new one.
    expect(knows(r, "Anya", "Initiative")?.status).toBe("knows");
    expect(knows(r, "Anya", "look like the dead")).toBeUndefined();
    expect(g.facts.map((x) => x.members.length)).toEqual([4, 4]);
    expect(r.changes.m3!.map((c) => c.text)).toEqual(["Dawn joined Scoobies (junior)", "Anya left Scoobies"]);
  });

  describe("a group line reaches the members the reply did (groupReach)", () => {
    // Clawed Out Into October, seq 916: no Scoobie was at lunch or named in it, yet all four "learned" it.
    const lunch = [...opening, "cast: Walter@spot", "at: Sunnydale › hills › Winters Residence › kitchen"];
    const reply = "Walter set down his taco. \"You two are Tom Paris and B'elanna Torres.\" Spike admitted he only watches Passions.";
    /** Files message 2 the way the tracker does: its lines get `away` from the state before it and the reply. */
    const file = (lines: string[], text = reply) => {
      const before = foldEvents(events([lunch]), cfg());
      const ops = groupReach(lines.map((l) => parseLine(l)!), before.state, cfg(), text);
      return foldEvents([...events([lunch]), ...ops.map((op, i) => ({ id: `r${i}`, messageId: "m2", seq: 2, source: "model" as const, op }))], cfg());
    };

    test("none of them there or named: nobody learns it, and the line says why", () => {
      const r = file(["know @Scoobies: Walter compares Gabriel and Buffy to Tom Paris and B'elanna Torres | he said it at the table · knows · true"]);
      for (const who of ["Willow", "Xander", "Anya", "Tara"]) expect(knows(r, who, "Tom Paris")).toBeUndefined();
      expect(Object.values(r.verdicts).find((v) => !v.ok && /in the scene or the messages/.test(v.reason ?? ""))).toBeTruthy();
    });

    test("one of them walks in: only she hears it, and the group as a whole wasn't told", () => {
      const r = file(["cast: Willow@spot", "know Scoobies: Spike watches Passions | he said so at lunch · knows · true"]);
      expect(knows(r, "Willow", "Passions")?.status).toBe("knows");
      for (const who of ["Xander", "Anya", "Tara"]) expect(knows(r, who, "Passions")).toBeUndefined();
      expect(r.state.groups!.scoobies!.facts.some((x) => x.text.includes("Passions"))).toBe(false);
    });

    test("a route that travels, or a reply that names them, reaches them all", () => {
      const texted = file(["know @Scoobies: Buffy rules film Fridays | Willow texted them · knows · true"]);
      const named = file(["know @Scoobies: Buffy rules film Fridays | at the Magic Box · knows · true"], `${reply} Across town, Xander, Anya, Willow and Tara heard about it at the Magic Box.`);
      for (const r of [texted, named]) for (const who of ["Willow", "Xander", "Anya", "Tara"]) expect(knows(r, who, "film Fridays")?.status).toBe("knows");
    });

    test("people at the table named one by one are untouched", () => {
      const lines = ["know Walter, Buffy Summers, Spike: Walter compares Gabriel and Buffy to Tom Paris | he said it at the table · knows · true"];
      expect(groupReach(lines.map((l) => parseLine(l)!), foldEvents(events([lunch]), cfg()).state, cfg(), reply)[0]!.args.away).toBeUndefined();
    });
  });

  test("@Group is never a person, even unknown", () => {
    const r = foldEvents(events([[...opening, "know @Watchers' Council: Buffy is alive | Giles reported · knows — phone call"]]), cfg());
    expect(names(r).some((x) => /watcher/i.test(x))).toBe(false);
    expect(Object.values(r.verdicts).at(-1)!.reason).toContain("no members known yet");
  });

  test("a member line can't make a person into a group", () => {
    const r = foldEvents(events([[...opening, "member Spike: + Dawn — she follows him around"]]), cfg());
    expect(Object.values(r.verdicts).at(-1)).toMatchObject({ ok: false, reason: "Spike is a person, not a group" });
  });
});

describe("what a group knows (docs/30 1.3)", () => {
  test("a secret kept from a group is kept from whoever joins later", () => {
    const r = foldEvents(
      events([
        opening,
        ["secret #heaven: Buffy was in heaven | kept by Buffy Summers, Spike · from Scoobies — she told only Spike"],
        ["member Scoobies: + Dawn — she moved in with them"],
      ]),
      cfg(),
    );
    const f = r.state.facts.heaven!;
    const id = (name: string) => Object.values(r.state.chars).find((c) => c.name === name)!.id;
    expect(f.secret!.groups).toEqual(["scoobies"]);
    for (const who of ["Willow", "Xander", "Anya", "Tara", "Dawn"]) expect(f.secret!.from).toContain(id(who));
    expect(f.secret!.from).not.toContain(id("Spike"));
  });
});

describe("kinds of group (docs/30 1.4)", () => {
  test("from the name, the lore and the cast", () => {
    expect(kindOfGroup("the household")).toBe("household");
    expect(kindOfGroup("Winters Family")).toBe("family");
    expect(kindOfGroup("the Summerses", { surnames: ["summers"] })).toBe("family");
    expect(kindOfGroup("Dawn's friends")).toBe("circle");
    expect(kindOfGroup("Scoobies")).toBe("circle");
    expect(kindOfGroup("Watchers' Council")).toBe("organisation");
    expect(kindOfGroup("the Initiative")).toBe("organisation");
    expect(kindOfGroup("Aurelius", { lore: "faction" })).toBe("organisation");
    expect(kindOfGroup("House Tyrell", { lore: "family" })).toBe("family");
    expect(possessiveAnchor("Dawn's friends")).toBe("Dawn");
    expect(possessiveAnchor("Gabriel Winters' crew")).toBe("Gabriel Winters");
    expect(groupKey("The Scoobies")).toBe("scoobies");
  });

  test("a family is close and a circle is friends, in the roster", () => {
    const r = foldEvents(events([[...opening, "cast: Joyce Summers@off · Melissa@off · Kara@off"]]), cfg());
    const roster = buildRoster({
      state: r.state,
      profiles: {},
      lore: [],
      userName: "Gabriel Winters",
      groups: [
        { name: "the Summerses", kind: "family", yours: false, members: ["Buffy Summers", "Joyce Summers"] },
        { name: "Dawn's friends", kind: "circle", yours: false, members: ["Melissa", "Kara"] },
      ],
    });
    const id = (name: string) => Object.values(r.state.chars).find((c) => c.name === name)!.id;
    expect(roster.actors.get(id("Joyce Summers"))!.tieKind.get(id("Buffy Summers"))).toMatchObject({ type: "close", by: "story", why: "both in the Summerses" });
    expect(roster.actors.get(id("Melissa"))!.tieKind.get(id("Kara"))).toMatchObject({ type: "friend", inTouch: true });
  });
});

describe("groups in the story's text and the tracker's state (docs/30 1.2, 1.5)", () => {
  test("capitalised groups after 'the', counted by message", () => {
    const found = groupsInText(
      [
        { seq: 1, text: "The Scoobies met at the Magic Box. Willow said the Scoobies needed snacks." },
        { seq: 2, text: "Later one of the Hellions played at the Bronze, and the Watchers' Council called." },
        { seq: 3, text: "On Mondays the Scoobies were on patrol. She waved at the Summerses, and the Lucky Strikes stayed in her bag." },
      ],
      (name) => name === "Summerses",
    );
    expect(found.get("scoobies")!.seqs).toEqual([1, 3]);
    expect(found.get("hellions")!.seqs).toEqual([2]);
    expect(found.get("watchers' council")!.name).toBe("Watchers' Council");
    expect(found.has("magic box")).toBe(false);
    expect(found.has("bronze")).toBe(false);
    expect(found.has("summerses")).toBe(false);
    // A brand isn't a group: nothing around it says it is.
    expect(found.has("lucky strikes")).toBe(false);
  });

  test("the tracker is told the groups' names and people", () => {
    const r = foldEvents(events([[...opening, "cast: Dawn's friends (Melissa, Kara, Jamie)@off"]]), cfg());
    expect(groupsLine(Object.values(r.state.groups!))).toBe("Groups: Dawn's friends (Melissa, Kara, Jamie) · Scoobies (Willow, Xander, Anya, Tara)");
    expect(stateForModel(r.state, { userName: "Gabriel Winters", templates: [], sealed: true })).toContain("Groups: Dawn's friends (Melissa, Kara, Jamie)");
  });
});
