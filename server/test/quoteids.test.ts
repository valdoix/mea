import { describe, expect, test } from "bun:test";
import { quoteIds } from "../../web/src/lib/quotes";

/** The dialogue stretches quoteIds finds, as text. */
const spoken = (text: string) => {
  const ids = quoteIds(text);
  const out: string[] = [];
  for (let i = 0; i < text.length; i++) {
    if (!ids[i]) continue;
    if (ids[i] !== ids[i - 1]) out.push(text[i]!);
    else out[out.length - 1] += text[i]!;
  }
  return out;
};

describe("dialogue marks the model gets wrong", () => {
  test("a line written backwards (”…“) is still a line", () => {
    expect(spoken(`”...and yeah. I like it.“`)).toEqual([`”...and yeah. I like it.“`]);
    expect(spoken(`She shrugs. ”Fine.“ Then, “Really.”`)).toEqual([`”Fine.“`, `“Really.”`]);
  });

  test("a ” that closes a line is not taken for an opener", () => {
    expect(spoken(`“Go,” she says. ”Now.”`)).toEqual([`“Go,”`, `”Now.”`]);
    expect(spoken(`It was “fine” and that was all.`)).toEqual([`“fine”`]);
  });
});
