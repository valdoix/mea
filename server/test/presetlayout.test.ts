import { describe, expect, test } from "bun:test";
import { normalizeCard } from "../src/cards/card";
import { assemblePrompt } from "../src/prompt/assemble";
import { GENRES, meaPreset, TOOLKIT_TAGS } from "../src/prompt/mea";
import { controlValues } from "../src/prompt/preset";

const { data: card } = normalizeCard({ spec: "chara_card_v2", data: { name: "Mira", description: "Mira keeps the lighthouse.", personality: "", first_mes: "" } });

/** The tag each block opens with (`<people>`), for blocks that have one. */
function blockTags() {
  const tags: string[] = [];
  for (const b of meaPreset().blocks) {
    for (const m of (b.content ?? "").matchAll(/(?:^|\}\})<([a-z]+)>\n/g)) tags.push(m[1]!);
  }
  return [...new Set(tags)];
}

describe("the v25 layout (docs/29 §5)", () => {
  test("every rule block is wrapped in a short lowercase tag that it closes", () => {
    const p = meaPreset();
    for (const b of p.blocks.filter((x) => x.kind === "text")) {
      const open = (b.content ?? "").match(/(?:^|\}\})<([a-z]+)>\n/);
      expect(open, `${b.id} opens with a tag`).not.toBeNull();
      expect(b.content!, `${b.id} closes <${open![1]}>`).toContain(`</${open![1]}>`);
    }
  });

  test("no block tag can be mistaken for a toolkit visual or for Mea's own reply tags", () => {
    const reserved = ["think", "thinking", "plan", "reasoning", "story", "ledger", "fx", ...TOOLKIT_TAGS];
    const tags = blockTags();
    expect(tags).toContain("pass");
    expect(tags).toContain("prose");
    for (const t of tags) {
      expect(reserved, t).not.toContain(t);
      // "<minds>" would read as "<mind" to a renderer that matches by prefix.
      for (const r of TOOLKIT_TAGS) expect(t.startsWith(r), `${t} starts with ${r}`).toBe(false);
    }
  });

  test("the arrow means one thing: write this instead (sequences use ›, mappings use :)", () => {
    for (const b of meaPreset().blocks) {
      if (b.id === "mea-prose") continue;
      expect(b.content ?? "", b.id).not.toContain("→");
    }
    for (const c of meaPreset().controls) for (const o of c.options) expect(o.text, `${c.id}.${o.value}`).not.toContain("→");
  });

  test("the planning pass recalls the blocks it applies, and the prose card is numbered for VOICE", () => {
    const p = meaPreset();
    const pass = p.blocks.find((b) => b.id === "mea-planning")!.content!;
    expect(pass).toContain("NOW <world> <records> —");
    expect(pass).toContain("VOICE <voice> <prose> —");
    expect(pass).toContain("the two <prose> lines this scene most invites, by number");
    const prose = p.blocks.find((b) => b.id === "mea-prose")!.content!;
    expect(prose).toMatch(/\n1\. "not X but Y"/);
    expect(prose).toMatch(/\n19\. a close on an aphorism/);
  });

  test("worst case, the preset's own text stays under 15k tokens (20k on any model's tokenizer)", () => {
    const preset = meaPreset();
    const longest = [...GENRES].sort((a, b) => (b.deliver + b.track + b.avoid).length - (a.deliver + a.track + a.avoid).length);
    const values = {
      ...controlValues(preset.controls),
      artifacts: "wild",
      rhythm: "lavish",
      textfx: "on",
      intimacy: "explicit",
      persona: "director",
      genre: longest[0]!.id,
      genre2: longest[1]!.id,
      outcomes: "die",
      autonomy: "sandbox",
      texture: "insistent",
      difficulty: "brutal",
      strangers: "brutal",
      violence: "adaptive",
      change: "circular",
      continuity: "episodic",
      canon: "strict",
      thoughts: "open",
      focus: "inner",
      limits: "x".repeat(1000),
      welcome: "y".repeat(1000),
    };
    const long = "The lamp hummed over the harbour while the rain kept on against the glass. ".repeat(12);
    const r = assemblePrompt({
      kind: "story",
      preset,
      card,
      userName: "Ash",
      personaText: "",
      mode: "companion",
      history: [
        { id: "1", role: "assistant", content: long },
        { id: "2", role: "user", content: "I wait." },
      ],
      lore: null,
      contextTarget: 200_000,
      modelId: "z-ai/glm-5.3",
      modelNotes: "z".repeat(2000),
      vars: {},
      seed: "s",
      canonSource: "Buffy the Vampire Slayer",
      controlValues: Object.fromEntries(Object.entries(values).map(([k, v]) => [k, String(v)])),
      when: (c) => c === "mode = intimacy" || c.startsWith("talk ="),
      swipe: { rejected: long },
      speakers: { roster: "Mira#1, Tam#2, Ash#0", dropped: true },
    });
    const own = r.trace.blocks.filter((b) => b.included && (b.id === "main" || b.id === "controls" || b.id.startsWith("mea-")));
    const tokens = own.reduce((n, b) => n + b.tokens, 0);
    expect(own.length).toBeGreaterThan(20);
    expect(tokens).toBeLessThan(15_000);
  });
});
