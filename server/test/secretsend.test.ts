import { describe, expect, test } from "bun:test";
import { parseLine } from "../src/trackers/dsl";
import { type FoldConfig, foldEvents, type TrackerEvent } from "../src/trackers/fold";
import { stateForModel } from "../src/trackers/prompts";
import { STARTER_TEMPLATES } from "../src/trackers/schema";
import { secretAsks } from "../src/trackers/secretasks";
import { secretMatch } from "../src/trackers/secretwords";

/**
 * docs/35 Part 7: Walter found out Buffy was alive at message 902 and spent the day with her, and the
 * secret stayed a secret with nobody left to keep it from. A secret ends, and who knows keeps up.
 */

const cfg = (over: Partial<FoldConfig> = {}): FoldConfig => ({
  userName: "Gabriel Winters",
  mainName: "Buffy Summers",
  sealedPersona: false,
  romance: "slow",
  strictness: "lenient",
  limits: true,
  templates: STARTER_TEMPLATES,
  ...over,
});

let n = 0;
function events(messages: string[][], source: TrackerEvent["source"] = "model"): TrackerEvent[] {
  return messages.flatMap((lines, i) => lines.map((l) => ({ id: `s${++n}`, messageId: `m${i + 1}`, seq: i + 1, source, op: parseLine(l)! })));
}
const fold = (messages: string[][]) => foldEvents(events(messages), cfg());
const opening = ["cast: Buffy Summers@spot · Spike@spot · Walter@off · Dawn Summers@off · Giles@off"];

describe("a secret ends (7.1)", () => {
  test("told to everyone it was kept from, it came out at that message", () => {
    const st = fold([opening, ["secret #alive: Buffy is alive | kept by Buffy Summers, Spike · from Walter"], ["reveal #alive: to Walter — Buffy shouted it"]]).state;
    expect(st.facts.alive?.secret?.out).toEqual({ seq: 3, how: "Buffy shouted it" });
  });
  test("kept from two and told to one, it stays a secret", () => {
    const st = fold([opening, ["secret #alive: Buffy is alive | kept by Buffy Summers · from Walter, Giles"], ["reveal #alive: to Walter — Buffy shouted it"]]).state;
    expect(st.facts.alive?.secret?.out).toBeUndefined();
    expect(st.facts.alive?.secret?.from).toEqual(["giles"]);
  });
  test("a know line that tells the last one closes it too", () => {
    const st = fold([opening, ["secret #alive: Buffy is alive | kept by Buffy Summers · from Walter"], ["know Walter: #alive Buffy is alive | she told him · knows"]]).state;
    expect(st.facts.alive?.secret?.out?.seq).toBe(3);
  });
  test("kept from everyone: out only when it's revealed to everyone", () => {
    const st = fold([opening, ["secret #grave: Buffy clawed out of her own grave | kept by Buffy Summers · from everyone"], ["reveal #grave: to Walter — told"]]).state;
    expect(st.facts.grave?.secret?.out).toBeUndefined();
    const all = fold([opening, ["secret #grave: Buffy clawed out of her own grave | kept by Buffy Summers · from everyone"], ["reveal #grave: to everyone — on the news"]]).state;
    expect(all.facts.grave?.secret?.out?.seq).toBe(3);
    const dawn = Object.values(all.chars).find((c) => c.name === "Dawn Summers")!;
    expect(all.facts.grave?.stances[dawn.id]?.status).toBe("knows");
  });
  test("a secret written down with nobody to keep it from isn't 'out'", () => {
    const st = fold([opening, ["secret #cargo: Spike sank the cargo | kept by Spike"]]).state;
    expect(st.facts.cargo?.secret?.out).toBeUndefined();
  });
  test("written again with someone new to keep it from, it's a secret again", () => {
    const st = fold([opening, ["secret #alive: Buffy is alive | kept by Buffy Summers · from Walter"], ["reveal #alive: to Walter — told"], ["secret #alive: Buffy is alive | kept by Buffy Summers · from Giles"]]).state;
    expect(st.facts.alive?.secret?.out).toBeUndefined();
    expect(st.facts.alive?.secret?.from).toEqual(["giles"]);
  });
  test("the tracker model is told it came out, as a line that keeps it out if copied", () => {
    const st = fold([opening, ["secret #alive: Buffy is alive | kept by Buffy Summers · from Walter"], ["reveal #alive: to Walter — told"]]).state;
    const text = stateForModel(st, { userName: "Gabriel Winters", templates: STARTER_TEMPLATES, sealed: false });
    expect(text).toContain("secret #alive: Buffy is alive | out at #3");
    const again = fold([opening, ["secret #alive: Buffy is alive | kept by Buffy Summers · from Walter"], ["reveal #alive: to Walter — told"], ["secret #alive: Buffy is alive | out at #3, nobody left to keep it from"]]).state;
    expect(again.facts.alive?.secret?.out?.seq).toBe(3);
  });
});

describe("being there (7.2)", () => {
  test("two messages in the room with someone meant to be dead: they know she's alive", () => {
    const r = fold([opening, ["secret #alive: Buffy is alive | kept by Buffy Summers · from Walter"], ["cast: Walter@spot · Buffy Summers@spot"], ["cast: Walter@spot · Buffy Summers@spot"]]);
    const f = r.state.facts.alive!;
    expect(f.stances.walter?.status).toBe("knows");
    expect(f.stances.walter?.route).toBe("saw Buffy Summers");
    expect(f.secret?.out?.seq).toBe(4);
  });
  test("one message isn't enough, and the next room over doesn't count", () => {
    const one = fold([opening, ["secret #alive: Buffy is alive | kept by Buffy Summers · from Walter"], ["cast: Walter@spot · Buffy Summers@spot"]]);
    expect(one.state.facts.alive?.stances.walter?.status).toBe("unaware");
    const apart = fold([opening, ["secret #alive: Buffy is alive | kept by Buffy Summers · from Walter"], ["cast: Walter@spot · Buffy Summers@off"], ["cast: Walter@spot · Buffy Summers@off"]]);
    expect(apart.state.facts.alive?.stances.walter?.status).toBe("unaware");
  });
  test("what you set yourself stands", () => {
    const evs = [...events([opening, ["secret #alive: Buffy is alive | kept by Buffy Summers · from Walter"]]), ...events([[], [], ["know Walter: #alive Buffy is alive | you said so · unaware"]], "user"), ...events([[], [], [], ["cast: Walter@spot · Buffy Summers@spot"], ["cast: Walter@spot · Buffy Summers@spot"]])];
    const st = foldEvents(evs.sort((a, b) => a.seq - b.seq), cfg()).state;
    expect(st.facts.alive?.stances.walter?.status).toBe("unaware");
  });
  test("any other secret: three shared scenes ask, they don't decide", () => {
    const scene = (k: number) => [`scene: Day ${k} kitchen`, "cast: Walter@spot · Buffy Summers@spot"];
    const r = fold([opening, ["secret #grave: Buffy clawed out of her own grave | kept by Buffy Summers · from Walter"], scene(1), scene(2), scene(3)]);
    expect(r.state.facts.grave?.stances.walter?.status).toBe("unaware");
    const asks = secretAsks(r.state);
    expect(asks.map((a) => [a.key, a.who])).toEqual([["grave", "Walter"]]);
    expect(asks[0]!.why).toContain("3 scenes");
  });
});

describe("the same thing in other words (7.3)", () => {
  test("a strong match is learning the secret", () => {
    const st = fold([opening, ["secret #ledger: Spike stole the harbor ledger from the customs office | kept by Spike · from Walter"], ["know Walter: Spike took the harbor ledger out of the customs office | he saw · knows"]]).state;
    expect(st.facts.ledger?.stances.walter?.status).toBe("knows");
    expect(st.facts.ledger?.secret?.out?.seq).toBe(3);
  });
  test("one telling word asks: Walter and Restfield", () => {
    const st = fold([opening, ["secret #grave: Buffy clawed out of her own grave with bare hands | kept by Buffy Summers · from Walter"], ["know Walter: Buffy died in May, was brought back by a ritual, clawed out of Restfield | Buffy told him · knows"]]).state;
    expect(st.facts.grave?.stances.walter?.status).toBe("unaware");
    expect(st.facts.grave?.secret?.maybe?.walter?.seq).toBe(3);
    expect(secretAsks(st)[0]?.why).toContain("clawed out of Restfield");
  });
  test("not about the same person, or a short common word: nothing", () => {
    const st = fold([opening, ["secret #grave: Buffy clawed out of her own grave with bare hands | kept by Buffy Summers · from Walter"], ["know Walter: Spike clawed at the door | he heard · knows"], ["know Walter: Buffy's hand was on the table | he saw · knows"]]).state;
    expect(st.facts.grave?.secret?.maybe).toBeUndefined();
  });
  test("the matcher ignores names and telling words", () => {
    expect(secretMatch("Buffy asks Gabriel not to tell Walter she is alive", "Gabriel asks Dawn to tell her", new Set(["buffy", "gabriel", "walter", "dawn"])).hits).toEqual([]);
  });
});

describe("notes aren't secrets, brackets aren't people (7.4, 7.5)", () => {
  const base = [opening, ["secret #alive: Buffy is alive | kept by Buffy Summers · from Walter"]];
  test("a status note leaves the secret as it was", () => {
    const r = fold([...base, ["secret #alive: risk — Walter glimpsed Buffy twice"], ["secret #alive: open — Buffy must say it now"]]);
    expect(r.state.facts.alive?.statement).toBe("Buffy is alive");
    expect(r.state.facts.alive?.secret?.from).toEqual(["walter"]);
    expect(Object.values(r.verdicts).some((v) => v.warn?.includes("a note on #alive"))).toBe(true);
  });
  test("'revealed to Walter' is a reveal", () => {
    const st = fold([...base, ["secret #alive: revealed to Walter — Buffy shouted it"]]).state;
    expect(st.facts.alive?.stances.walter?.status).toBe("knows");
    expect(st.facts.alive?.secret?.out?.seq).toBe(3);
  });
  test("a note in brackets is about the name before it", () => {
    const st = fold([...base, ['reveal #alive: to Gabriel\'s mom (name "Buffy Summers" only, nothing else) — Buffy texted her']]).state;
    const names = Object.values(st.chars).map((c) => c.name.toLowerCase());
    expect(names.some((x) => x.includes("nothing"))).toBe(false);
    expect(names.some((x) => x.includes("only"))).toBe(false);
  });
  test("older events split at the bracket's comma are read the same way", () => {
    const evs = events([...base]);
    evs.push({ id: `s${++n}`, messageId: "m3", seq: 3, source: "model", op: { op: "reveal", subject: "#alive", args: { key: "alive", to: ['Gabriel\'s mom (name "Buffy Summers" only', "nothing else)"] }, raw: "" } });
    const st = foldEvents(evs, cfg()).state;
    expect(Object.values(st.chars).some((c) => /nothing|only/i.test(c.name))).toBe(false);
  });
});
