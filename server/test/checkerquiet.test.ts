import { describe, expect, test } from "bun:test";
import { clockBackRule, statedTimes } from "../src/accuracy/moreslips";

const at = (h: number, m = 0) => 1440 * 10 + h * 60 + m;

describe("the clock check says less (docs/33 Part 7)", () => {
  test("spoken times are read whole", () => {
    expect(statedTimes("seven forty-two a.m.")).toEqual([[7 * 60 + 42]]);
    expect(statedTimes("Eleven-oh-eight a.m., Sunnydale Mall.")).toEqual([[11 * 60 + 8]]);
    expect(statedTimes("at seven forty-four")).toEqual([[7 * 60 + 44, 19 * 60 + 44]]);
    expect(statedTimes("at 6:40")).toEqual([[6 * 60 + 40, 18 * 60 + 40]]);
  });
  test("a time mentioned in passing is not the clock", () => {
    expect(clockBackRule("The bags go on the sofa — the same sofa where she slept on his chest at seven a.m.", at(17, 37))).toEqual([]);
    expect(clockBackRule("He ended up in a graveyard at midnight digging out a girl in a dead dress.", at(8, 16))).toEqual([]);
    expect(clockBackRule("It's the kitchen light at four a.m., the mug at two a.m. after bad patrols.", at(17, 55))).toEqual([]);
  });
  test("a word starting with am or pm is not a time, and a sentence opening on a number isn't the clock", () => {
    // Flagged as 01:00 and 00:00 in a real story (messages 938 and 948).
    expect(statedTimes("One amendment, house rules")).toEqual([]);
    expect(statedTimes("at 6:40 amazingly")).toEqual([[6 * 60 + 40, 18 * 60 + 40]]);
    expect(clockBackRule("“One amendment, house rules: we don’t open with the wallet.", at(15, 34))).toEqual([]);
    expect(clockBackRule("Nine months of stars at midnight and you’ve never heard the voice.", at(16, 19))).toEqual([]);
    expect(clockBackRule("Seven and oh, and the field’s got a new zero.", at(14, 0))).toEqual([]);
  });
  test("just past midnight is later, not earlier", () => {
    expect(clockBackRule("The clock on the mantel reads twelve minutes past midnight.", at(23, 56))).toEqual([]);
  });
  test("a reply that says it is earlier is still caught", () => {
    expect(clockBackRule("It's seven a.m. and the kitchen is cold.", at(17, 0))).toHaveLength(1);
    expect(clockBackRule("The clock reads 6:40 a.m.", at(15, 0))).toHaveLength(1);
    expect(clockBackRule("The clock reads 6:40.", at(15, 0))).toEqual([]);
    expect(clockBackRule("Seven forty-two a.m. She hasn't slept.", at(14, 0))).toHaveLength(1);
    expect(clockBackRule("Seven forty-two a.m. She hasn't slept.", at(7, 35))).toEqual([]);
  });
});
