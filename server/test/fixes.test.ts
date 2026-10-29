import { describe, expect, test } from "bun:test";
import { locateSentence } from "../src/accuracy/fixes";

const at = (text: string, claim: string) => locateSentence(text, claim)?.sentence ?? null;

describe("locateSentence", () => {
  test("finds a claim the checker retyped without markdown, curly quotes or ellipses", () => {
    const text = `*She leans on the rail.* “Wait…” she says — then *Arya smiles at the sea.* The ship rolls.`;
    expect(at(text, `Arya smiles at the sea.`)).toBe(`she says — then *Arya smiles at the sea.*`);
    expect(at(text, `"Wait..." she says - then Arya smiles`)).toBe(`“Wait…” she says — then *Arya smiles at the sea.*`);
    expect(at(text, `SHE LEANS ON THE RAIL`)).toBe(`*She leans on the rail.*`);
  });

  test("keeps decimals and abbreviations inside one sentence", () => {
    const text = `Mr.Snow came at 3.30 today. He left soon.`;
    expect(at(text, `came at 3.30 today`)).toBe(`Mr.Snow came at 3.30 today.`);
  });

  test("takes every sentence a claim spans, and the whole of a clipped one", () => {
    const text = `First thing. She draws the sword, the old one from Winterfell. He bows. Last.`;
    expect(at(text, `the sword, the old one from Winterfell. He bows`)).toBe(`She draws the sword, the old one from Winterfell. He bows.`);
    expect(at(text, `She draws the sword … from Winterfell`)).toBe(`She draws the sword, the old one from Winterfell.`);
  });

  test("falls back to the sentence holding most of the claim's words", () => {
    const text = `The hall is cold. Jon walks slowly toward the old weirwood tree. Snow falls.`;
    expect(at(text, `Jon walked slowly toward the weirwood tree`)).toBe(`Jon walks slowly toward the old weirwood tree.`);
    expect(at(text, `Daenerys rides a dragon over the wall`)).toBeNull();
  });

  test("matches single-quoted claims against double-quoted dialogue", () => {
    const text = `Her eyes drop.\n\n“My love.”\n\nTwo words. The new one. The one he dropped this morning, sleepy, and now he’s using it *here*.\n\nShe climbs onto the bed.`;
    expect(at(text, `'My love.' Two words. The new one. The one he dropped this morning`)).toBe(
      `“My love.”\n\nTwo words. The new one. The one he dropped this morning, sleepy, and now he’s using it *here*.`,
    );
  });

  test("falls back to a run of sentences when a retyped claim spans several", () => {
    const text = `Night. “Say it again.” Not a request. The girl who heard it all night wants it again. “I love you.” He says it. Immediate. Morning comes.`;
    expect(at(text, `The girl who heard it all night wants it again. I love you. He says it. Immediate`)).toBe(
      `The girl who heard it all night wants it again. “I love you.” He says it. Immediate.`,
    );
  });

  test("skips markup", () => {
    const text = `<p>She <b>runs</b> home.</p><p>Night falls.</p>`;
    expect(at(text, `She runs home.`)).toContain(`She <b>runs</b> home.`);
  });
});
