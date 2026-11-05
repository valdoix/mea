import { describe, expect, test } from "bun:test";
import { census, censusReport, COUNTERS, draftOverlap, narrationOf, proseOf } from "../src/steer/census";

const hit = (key: string, text: string) => {
  const c = COUNTERS.find((x) => x.key === key)!;
  return c.hit(text, narrationOf(text));
};

describe("the tell census", () => {
  test("each counter catches its habit and lets plain prose by", () => {
    expect(hit("office", "She filed the feeling away for later.")).toBe(true);
    expect(hit("counting", "Four knocks at the door.")).toBe(true);
    expect(hit("restart", '"That\'s — that\'s not fair."')).toBe(true);
    expect(hit("correction", "It wasn't anger — it was grief.")).toBe(true);
    expect(hit("broken", '"I only wanted —"')).toBe(true);
    expect(hit("teaser", "He closed the door behind him.\n\nSoon.")).toBe(true);
    expect(hit("bow", "The kitchen was a testament to years of use.")).toBe(true);
    expect(hit("air", "The air between them thickened.")).toBe(true);
    expect(hit("lexicon", "The smell of ozone hung there.")).toBe(true);
    expect(hit("cutaway", "She slept.\n\nSomewhere across town, a phone rang.")).toBe(true);
    expect(hit("markdown", "## The morning after\nShe woke.")).toBe(true);
    expect(hit("cascade", "She waited.\n\nNothing.\n\nThen the knock.\n\nShe stood.")).toBe(true);
    expect(hit("ack", '"Noted." He turned away.')).toBe(true);

    const plain = "Mira set the lamp on the sill and wiped the soot from her hands before she spoke to the boy at the door, who had run the whole way from the harbour.";
    for (const c of COUNTERS) expect(c.hit(plain, plain)).toBe(false);
  });

  test("dialogue tags and visuals don't read as fragments or one-line paragraphs", () => {
    const talk = '"Hi," she said.\n\n"Hey," he said.\n\n"Tea?" she asked.\n\n"Yes."';
    expect(hit("drumbeat", talk)).toBe(false);
    expect(hit("cascade", talk)).toBe(false);
    expect(hit("teaser", talk)).toBe(false);
    const texts = proseOf("She checked her phone.\n<texts with=\"Tam\">\nTam: you up\nme: yes\nTam: come down\n</texts>\nShe went down the stairs two at a time, coat half on.");
    expect(texts).not.toContain("you up");
    expect(hit("cascade", texts)).toBe(false);
    expect(hit("drumbeat", "He waited. Nothing. Then a knock. She froze. Silence.")).toBe(true);
  });

  test("a plan that drafted the story is caught; one that only planned isn't", () => {
    const story = "Mira set the lamp on the sill and wiped the soot from her hands before she answered him.";
    expect(draftOverlap(story, "NOW: dusk. MOVE: she answers, curt. VOICE: short.")).toEqual({ drafted: false, share: 0 });
    const d = draftOverlap(story, "Opening: Mira set the lamp on the sill and wiped the soot from her hands, then speaks.");
    expect(d.drafted).toBe(true);
    expect(d.share).toBeGreaterThan(0.2);
    expect(draftOverlap(story, "").drafted).toBe(false);
  });

  test("replies group by family, rates are shares, and phrases need three chats", () => {
    const rows = [
      ...[1, 2, 3, 4].map((i) => ({ chatId: `c${i}`, modelId: "z-ai/glm-4.6", content: "She filed it away. The old brass lamp flickered low.", reasoning: i === 1 ? "She filed it away. The old brass lamp flickered low." : "" })),
      { chatId: "c1", modelId: "anthropic/claude-sonnet-4.5", content: "He laughed and poured the tea.\n\nSoon.", reasoning: "MOVE: tea." },
      { chatId: "c1", modelId: "xiaomi/mimo-v2-flash", content: "The rain kept on.", reasoning: "" },
    ];
    const fams = census(rows);
    expect(fams.map((f) => f.family)).toEqual(["glm", "claude", "other"]);
    const glm = fams[0]!;
    expect(glm.replies).toBe(4);
    expect(glm.chats).toBe(4);
    expect(glm.rates.office).toBe(1);
    expect(glm.plans).toMatchObject({ with: 1, drafted: 1 });
    expect(glm.phrases.some((p) => p.phrase === "old brass lamp")).toBe(true);
    expect(fams[1]!.rates.teaser).toBe(1);
    expect(fams[1]!.phrases).toEqual([]);

    const report = censusReport(fams, { minReplies: 2 });
    expect(report).toContain("| Replies (chats) | 4 (4) | 1 (1) | 1 (1) |");
    expect(report).toContain("claude *few*");
    expect(report).toContain("| Plans that drafted the story (8 words or more reused) | 100% | 0% | — |");
  });
});
