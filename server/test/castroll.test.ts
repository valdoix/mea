import { describe, expect, test } from "bun:test";
import { castRoll } from "../../web/src/lib/castroll";
import type { TrackerChange } from "../../web/src/lib/castroll";

const ch = (kind: string, text: string, extra: Partial<TrackerChange> = {}): TrackerChange => ({ kind, text, ...extra });
const JACKIE = "Jacqueline 'Jackie' Taylor";

describe("cast roll", () => {
  const rows = castRoll(
    [
      ch("clock", "Dusk → Night"),
      ch("mood", `${JACKIE}: brittle, captain-bright`, { subject: JACKIE }),
      ch("bond", `${JACKIE} → James Holloway · Fear +1`, { subject: JACKIE, tone: "down" }),
      ch("knowledge", "Shauna Shipman learned: Jackie won't look at her since the tree line.", { subject: "Shauna Shipman" }),
      ch("promise", `James Holloway promised ${JACKIE}: to god if you call me Nattie one more time`, { subject: "James Holloway" }),
      ch("cast", "Travis Martinez arrived", { subject: "Travis Martinez" }),
      ch("item", "Whistle: lost"),
    ],
    [JACKIE.toLowerCase(), "shauna shipman", "james holloway", "travis martinez"],
  );

  test("files each change under its person, the most telling first, the world last", () => {
    expect(rows.map((r) => r.name)).toEqual([JACKIE, "Shauna Shipman", "James Holloway", "Travis Martinez", null]);
    expect(rows[0]!.beats.map((b) => b.c.kind)).toEqual(["bond", "mood"]);
    expect(rows.at(-1)!.beats.map((b) => b.c.kind)).toEqual(["item", "clock"]);
  });

  test("reads each change back into a line", () => {
    expect(rows[0]!.beats[0]).toMatchObject({ type: "feel", feeling: "Fear", delta: "+1", toward: "James Holloway", good: false });
    expect(rows[0]!.beats[1]).toMatchObject({ type: "tag", tag: "mood", text: "brittle, captain-bright" });
    expect(rows[1]!.beats[0]).toMatchObject({ type: "know", verb: "now knows", text: "Jackie won't look at her since the tree line." });
    expect(rows[2]!.beats[0]).toMatchObject({ type: "vow", verb: "swore to", whom: JACKIE, text: "to god if you call me Nattie one more time" });
    expect(rows[3]!.beats[0]).toMatchObject({ type: "tag", tag: "cast", text: "arrived" });
  });

  test("a name leading the text claims a change with no subject", () => {
    const [row] = castRoll([ch("custom", "Travis Martinez: counting Javi")], ["travis martinez"]);
    expect(row).toMatchObject({ name: "Travis Martinez", beats: [{ type: "tag", text: "counting Javi" }] });
  });
});
