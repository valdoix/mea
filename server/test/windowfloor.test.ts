import { describe, expect, test } from "bun:test";
import { emptyCard } from "../src/cards/card";
import { one } from "../src/db/db";
import { type AssembleInput, assemblePrompt, WINDOW_FLOOR } from "../src/prompt/assemble";
import { defaultPreset } from "../src/prompt/preset";
import { createConnection, recordCalibration, syncModels } from "../src/services/connections";
import { freshDb } from "./helpers";

const words = (n: number, w = "lamp") => Array.from({ length: n }, () => w).join(" ");
const history = Array.from({ length: 40 }, (_, i) => ({ id: String(i), seq: i + 1, role: i % 2 ? ("user" as const) : ("assistant" as const), content: `Message ${i}. ${words(30, "tide")}` }));
const base = (over: Partial<AssembleInput> = {}): AssembleInput => ({
  kind: "story",
  preset: defaultPreset(),
  card: { ...emptyCard("Mira"), description: words(1500, "keeper"), personality: "wistful", post_history_instructions: "" },
  userName: "Ash",
  personaText: "A traveler.",
  mode: "companion",
  history,
  lore: null,
  contextTarget: 8000,
  reserve: 1000,
  modelId: "test",
  vars: {},
  seed: "c",
  ...over,
});

describe("the window floor", () => {
  test("fixed blocks and memory that fill the target still leave the last turns verbatim", () => {
    let floorSeen = 0;
    const r = assemblePrompt(
      base({
        memory: (_available, floor) => {
          floorSeen = floor;
          return { story: words(3000, "summary"), recall: "", history, evictedThrough: 0, trace: { enabled: true } as never };
        },
      }),
    );
    expect(floorSeen).toBe(Math.round(7000 * WINDOW_FLOOR));
    // Without the floor this was the latest message alone.
    expect(r.trace.history.included).toBeGreaterThan(10);
    expect(r.trace.history.tokens).toBeLessThanOrEqual(floorSeen);
  });

  test("a doubled token ratio still keeps the floor", () => {
    const r = assemblePrompt(base({ tokenRatio: 2 }));
    expect(r.trace.history.included).toBeGreaterThan(5);
  });
});

describe("calibration (CTX-03)", () => {
  test("a report no tokenizer could give is ignored", async () => {
    freshDb();
    const connId = createConnection({ name: "Mock", kind: "mock", billing: "subscription" });
    await syncModels(connId);
    const cal = () => one<{ calibration: number | null }>("SELECT calibration FROM models WHERE connection_id = ? AND model_id = ?", connId, "mock/storyteller")!.calibration;
    // 92k characters reported as 146k tokens: a relay counting something besides the prompt.
    recordCalibration(connId, "mock/storyteller", 20_700, 146_663, 92_784);
    expect(cal()).toBeNull();
    // 172k characters as 62k tokens: a real (denser) tokenizer.
    recordCalibration(connId, "mock/storyteller", 39_000, 61_800, 172_400);
    expect(cal()).toBeCloseTo(1.585, 2);
  });
});
