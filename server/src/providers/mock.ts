import type { EmbedResult, ModelInfo, Provider, StreamDelta, StreamRequest, StreamResult } from "./types";

const LINES = [
  "The lamp flickers as the wind presses against the old glass, and for a moment the whole room seems to hold its breath.",
  'She tucks a loose strand of hair behind her ear and smiles, a little crooked. "You came back," she says softly. "I wasn\'t sure you would."',
  "*Outside, the sea keeps up its patient rhythm, waves folding over the rocks below the lighthouse.*",
  '"Sit, please. The tea is still warm, and I have a feeling we have a lot to talk about."',
];

/** "[#12] Mira: text" lines from a helper prompt. */
function ledgerLines(text: string) {
  return [...text.matchAll(/^\[#(\d+)\] ([^:\n]+): (.*)$/gm)].map((m) => ({ seq: Number(m[1]), who: m[2]!.trim(), text: m[3]!.trim() }));
}

const firstSentence = (s: string) => (s.replace(/[*_"]/g, "").match(/^.{1,160}?[.!?](\s|$)/)?.[0] ?? s.replace(/[*_"]/g, "").slice(0, 160)).trim();
const names = (s: string) => [...new Set((s.match(/\b[A-Z][a-z]{2,}\b/g) ?? []).filter((w) => !["The", "She", "You", "Outside", "Sit", "This", "That", "Mock"].includes(w)))].slice(0, 4);

/** Deterministic stand-ins for the memory helpers, keyed by the schema name the caller asks for. */
function helperJson(name: string, user: string): unknown {
  const lines = ledgerLines(user);
  switch (name) {
    case "scene_memory": {
      const first = lines[0]?.seq ?? 0;
      const last = lines.at(-1)?.seq ?? 0;
      return {
        title: `Scene #${first}–#${last}`,
        summary: lines.map((l) => `${l.who}: ${firstSentence(l.text)}`).join(" ").slice(0, 900) || "Nothing much happened.",
        events: lines.slice(0, 3).map((l) => `${l.who} spoke`),
        decisions: [],
        stateChanges: [],
        relationshipShifts: [],
        threadsOpened: [],
        threadsClosed: [],
        quotes: lines.slice(0, 1).map((l) => ({ speaker: l.who, text: firstSentence(l.text), seq: l.seq })),
        storyTime: "",
        locations: [],
        participants: [...new Set(lines.map((l) => l.who))],
        importance: 5,
        memories: lines.map((l) => ({
          type: "event",
          content: `${l.who}: ${l.text.split(/(?<=[.!?])\s+/).find((x) => /promise|secret|named/i.test(x)) ?? firstSentence(l.text)}`,
          entities: [l.who, ...names(l.text)],
          importance: /promise|secret|never|always/i.test(l.text) ? 8 : 4,
          emotions: [],
          sources: [l.seq],
          knownBy: [],
          supersedes: [],
          confidence: 0.9,
        })),
      };
    }
    case "summary_check":
      return { verdict: /MOCK_MAJOR/.test(user) ? "major" : "ok", unsupported: /MOCK_MAJOR/.test(user) ? [{ claim: "mock claim", reason: "mock" }] : [], omissions: [] };
    case "summary_rollup": {
      const titles = [...user.matchAll(/^(?:Scene|Chapter|Arc) \d+: (.+?) \(messages/gm)].map((m) => m[1]);
      return { title: `Part with ${titles.length} records`, summary: `Rollup of: ${titles.join("; ")}.`, keyQuotes: [], openThreads: [], storyTime: "", importance: 5 };
    }
    case "scene_boundary":
      return { newScene: !/MOCK_SAME_SCENE/.test(user), reason: "mock" };
    case "tracker_gate":
      return { changed: !/MOCK_NO_CHANGE/.test(user) };
    case "world_telling":
      return {
        beats: [...user.matchAll(/^CARD (\S+)[\s\S]*?^ENGINE'S WORDS (.+)$/gm)].map((m) => ({ card: m[1], text: `Off the page: ${m[2]}` })),
      };
    default:
      return {};
  }
}

/** Bag-of-words hashing so related texts land near each other. */
export function mockVector(text: string, dims = 64) {
  const v = new Float32Array(dims);
  for (const w of text.toLowerCase().match(/[a-z]{3,}/g) ?? []) {
    let h = 2166136261;
    for (let i = 0; i < w.length; i++) h = Math.imul(h ^ w.charCodeAt(i), 16777619);
    v[(h >>> 0) % dims]! += 1;
  }
  return v;
}

/** Development-only provider (MEA_DEV=1): streams a canned reply so the app can be exercised without API keys. */
export class MockProvider implements Provider {
  constructor(private delayMs = 18) {}

  async stream(req: StreamRequest, onDelta: (d: StreamDelta) => void): Promise<StreamResult> {
    const schemaName = (req.responseFormat?.json_schema as { name?: string } | undefined)?.name;
    const system = req.messages.find((m) => m.role === "system")?.content ?? "";
    const userText = req.messages.filter((m) => m.role === "user").map((m) => m.content).join("\n");
    // Tracker ledgers (plain lines) for the tracker helper calls.
    if (/LEDGER TRACKER: write the ledger lines now|STARTING STATE: write the ledger lines now/.test(userText)) {
      const text = /STARTING STATE/.test(userText) ? mockInit(userText) : mockLedger(`${system}\n${userText}`);
      onDelta({ text });
      return { finishReason: "stop", usage: { promptTokens: Math.round(JSON.stringify(req.messages).length / 4), completionTokens: Math.round(text.length / 4) }, sentBody: { model: req.model, messages: req.messages } };
    }
    const helper = schemaName ?? (/Reply with one JSON object only|Reply with JSON only/.test(system) ? guessSchema(system) : undefined);
    if (helper) {
      const user = req.messages.filter((m) => m.role === "user").map((m) => m.content).join("\n");
      const text = JSON.stringify(helperJson(helper, user));
      onDelta({ text });
      const promptTokens = Math.round(JSON.stringify(req.messages).length / 4);
      return { finishReason: "stop", usage: { promptTokens, completionTokens: Math.round(text.length / 4) }, sentBody: { model: req.model, messages: req.messages, ...req.params } };
    }
    const last = [...req.messages].reverse().find((m) => m.role === "user")?.content ?? "";
    const tail = req.messages.at(-1)?.content ?? "";
    const text =
      /Write .*next message/i.test(tail)
        ? "I step closer, brushing the rain from my coat. \"I told you I would. I keep my promises.\""
        : /rough draft/i.test(tail)
          ? 'I set my bag down by the door and let out a long breath. "It\'s good to see you again," I say, and I mean it.'
          : /single word OK/.test(tail)
            ? "OK"
            : `${LINES.join("\n\n")}\n\n(You said: "${last.slice(0, 80)}")${req.messages.some((m) => m.content.includes("add a <ledger> block")) ? `\n\n<ledger>\nclock: +6m\nmood Mira: thoughtful — he came back\n</ledger>` : ""}`;
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
    // Pretend the stable prefix was cached when the request asks for it (for cache stats and the probe).
    const cachedTokens = req.cache ? Math.round(promptTokens * 0.8) : undefined;
    return {
      finishReason: "stop",
      usage: { promptTokens, completionTokens: Math.round(text.length / 4), cachedTokens },
      sentBody: { model: req.model, messages: req.messages, ...req.params },
    };
  }

  async embed(texts: string[], _model: string, dims = 64): Promise<EmbedResult> {
    return { vectors: texts.map((t) => mockVector(t, Math.min(dims, 256))), promptTokens: texts.reduce((n, t) => n + Math.ceil(t.length / 4), 0) };
  }

  async listModels(): Promise<ModelInfo[]> {
    return [
      { id: "mock/storyteller", name: "Mock Storyteller", contextLength: 128000, capabilities: { structured_output: true, reasoning: true }, subscription: true },
      { id: "mock/fast", name: "Mock Fast", contextLength: 32000, capabilities: { structured_output: true }, subscription: true },
      { id: "mock/embed", name: "Mock Embeddings", contextLength: 8000, capabilities: { embeddings: true }, subscription: false },
    ];
  }
}

function guessSchema(system: string) {
  if (system.includes('"memories"')) return "scene_memory";
  if (system.includes('"changed"')) return "tracker_gate";
  if (system.includes('"beats"')) return "world_telling";
  if (system.includes('"verdict"')) return "summary_check";
  if (system.includes('"newScene"')) return "scene_boundary";
  if (system.includes('"openThreads"')) return "summary_rollup";
  return undefined;
}

const MOODS = ["wistful", "wary-curious", "amused", "guarded", "warm", "thoughtful"];

/** A deterministic ledger for the newest messages, so trackers can be exercised without a model. */
function mockLedger(user: string): string {
  const msgs = user.split("NEW MESSAGES:")[1] ?? "";
  const main = user.match(/keep the story ledger for a roleplay between .+? and (.+?)\./)?.[1] ?? "Mira";
  const userName = user.match(/roleplay between (.+?) \(the user's character\)/)?.[1];
  const n = msgs.length;
  const lines = ["clock: +8m", `cast: ${main}@spot`, `mood ${main}: ${MOODS[n % MOODS.length]}`];
  if (!/^clock: (?:Day|\d)/m.test(user)) lines.unshift("clock: Day 1 20:30");
  const toUser = userName ?? "{{user}}";
  if (/\b(thank|gave|back|kind|promise)\w*/i.test(msgs)) lines.push(`bond ${main}>${toUser}: trust +1 — kept their word`);
  if (/\blocket\b/i.test(msgs)) lines.push("thread Lost locket: advance — the locket came up again");
  if (/\btea\b/i.test(msgs)) lines.push(`body ${main}: thirst -1`);
  if (/\bstorm|rain\b/i.test(msgs)) lines.push("wx: rain");
  return lines.join("\n");
}

function mockInit(user: string): string {
  const main = user.match(/CARD \((.+?)\):/)?.[1] ?? "Mira";
  return [
    "clock: Day 1 20:00",
    "wx: wind off the sea",
    "at: Port Ellis › Lighthouse › Lamp room",
    "scene: The storm",
    `cast: ${main}@spot(by the logbook)`,
    `mood ${main}: relieved`,
    `look ${main}: wool sweater, sleeves pushed up`,
    `drive ${main}: want: company through the long night; fear: being forgotten out here`,
    "thread The keeper's logbook: new — a page is missing",
  ].join("\n");
}
