import type { ModelInfo, Provider, StreamDelta, StreamRequest, StreamResult } from "./types";

const LINES = [
  "The lamp flickers as the wind presses against the old glass, and for a moment the whole room seems to hold its breath.",
  'She tucks a loose strand of hair behind her ear and smiles, a little crooked. "You came back," she says softly. "I wasn\'t sure you would."',
  "*Outside, the sea keeps up its patient rhythm, waves folding over the rocks below the lighthouse.*",
  '"Sit, please. The tea is still warm, and I have a feeling we have a lot to talk about."',
];

/** Development-only provider (MEA_DEV=1): streams a canned reply so the app can be exercised without API keys. */
export class MockProvider implements Provider {
  constructor(private delayMs = 18) {}

  async stream(req: StreamRequest, onDelta: (d: StreamDelta) => void): Promise<StreamResult> {
    const last = [...req.messages].reverse().find((m) => m.role === "user")?.content ?? "";
    const tail = req.messages.at(-1)?.content ?? "";
    const text =
      /Write .*next message/i.test(tail)
        ? "I step closer, brushing the rain from my coat. \"I told you I would. I keep my promises.\""
        : /rough draft/i.test(tail)
          ? 'I set my bag down by the door and let out a long breath. "It\'s good to see you again," I say, and I mean it.'
          : `${LINES.join("\n\n")}\n\n(You said: "${last.slice(0, 80)}")`;
    onDelta({ reasoning: "Mock reasoning: keep continuity with the lighthouse scene." });
    const words = text.split(/(\s+)/);
    for (const w of words) {
      if (req.signal.aborted) {
        const err = new Error("aborted");
        err.name = "AbortError";
        throw err;
      }
      onDelta({ text: w });
      if (this.delayMs) await Bun.sleep(this.delayMs);
    }
    const promptTokens = Math.round(JSON.stringify(req.messages).length / 4);
    return { finishReason: "stop", usage: { promptTokens, completionTokens: Math.round(text.length / 4) }, sentBody: { model: req.model, messages: req.messages, ...req.params } };
  }

  async listModels(): Promise<ModelInfo[]> {
    return [
      { id: "mock/storyteller", name: "Mock Storyteller", contextLength: 128000, capabilities: { structured_output: true, reasoning: true }, subscription: true },
      { id: "mock/fast", name: "Mock Fast", contextLength: 32000, capabilities: { structured_output: true }, subscription: true },
    ];
  }
}
