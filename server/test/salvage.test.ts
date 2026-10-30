import { describe, expect, test } from "bun:test";
import { vetPattern } from "../src/lib/regex";
import { opensMidSentence } from "../src/services/chattools";
import { planFrom, planOnly, splitLeakedPlan, splitStopLine, splitStoryBox, splitStrayClose, storyRouter } from "../src/services/generation";

describe("a reply that arrives without its opening", () => {
  test("the openings that were really lost", () => {
    expect(opensMidSentence("works fine. It’s — it’s Mom’s old one, but it works —”\n\n“Dawn.”\n\nBuffy’s voice.")).toBe(true);
    expect(opensMidSentence("—are dark denim, fitted, the pair in her closet.\n\nThe car hums.")).toBe(true);
    expect(opensMidSentence("”*Bamboozled*. You just said it. “\n\nHer eyes are on his mouth.")).toBe(true);
  });
  test("whole openings, and a story written all in lowercase, are left alone", () => {
    for (const t of ["The rain held. She waited.", "“Dawn.”\n\nBuffy’s voice.", "“No,” she said. “Not now.”", "—The door slams.\n\nMira turns.", "the rain held. she waited.\n\nnobody came.", "*Next week.*\n\nThe timeline landed."]) expect(opensMidSentence(t)).toBe(false);
  });
  test("a route's misplaced split: the reasoning's last words and its closing tag leave the text", () => {
    expect(splitStrayClose("now.\n</think>\n\n\n“Babe.”\n\nBuffy repeats it.")).toEqual({ text: "“Babe.”\n\nBuffy repeats it.", reasoning: "now." });
    expect(splitStrayClose("Mira looks up.")).toEqual({ text: "Mira looks up.", reasoning: "" });
    expect(opensMidSentence(splitStrayClose("now.\n</think>\n\n“Babe.”\n\nBuffy repeats it.").text)).toBe(false);
  });
});

describe("the plan step's answer", () => {
  const pass = "NOW — dusk, the lamp room. SEAL — Ash arrived and spoke. MINDS — Mira wary, hopeful. MOVE — she offers tea. VOICE — short.";
  test("takes the pass in <think>, written out, or as plain lines, and nothing after it", () => {
    expect(planFrom(`<think>${pass}</think>\n\nMira looks up.`, "")).toBe(pass);
    expect(planFrom(pass.replace(/\. /g, ".\n"), "")).toContain("MOVE — she offers tea");
    expect(planFrom(`<think>${pass}`, "")).toBe(pass);
  });
  test("falls back to the route's reasoning, and refuses a token plan or a story", () => {
    expect(planFrom("", pass)).toBe(pass);
    expect(planFrom("<think>NOW — dusk.</think>", "")).toBeNull();
    expect(planFrom("Mira looks up from the logbook and sets the kettle on.", "")).toBeNull();
  });
});
import { salvageJson } from "../src/services/llm";
import { parseEditorReply } from "../src/steer/editor";

describe("M14: salvaging a cut-off JSON reply", () => {
  test("keeps the finished items of an open list", () => {
    expect(salvageJson('{"items":[{"name":"Mira","age":30},{"name":"Ash","age":2')).toEqual({ items: [{ name: "Mira", age: 30 }] });
    expect(salvageJson('```json\n{"tags":["harbour","fog","sto')).toEqual({ tags: ["harbour", "fog"] });
    expect(salvageJson('{"a":{"list":[[1,2],[3,4],[5')).toEqual({ a: { list: [[1, 2], [3, 4]] } });
  });
  test("brackets and quotes inside strings don't confuse it", () => {
    expect(salvageJson('{"lines":["she said \\"[no]\\" {twice}","and')).toEqual({ lines: ['she said "[no]" {twice}'] });
  });
  test("returns null when nothing was cut or nothing can be kept", () => {
    expect(salvageJson('{"items":[1]}')).toBeNull();
    expect(salvageJson('{"text":"half a sent')).toBeNull();
    expect(salvageJson("no json here")).toBeNull();
  });
});

describe("M14: the editor's plain-text reply", () => {
  test("UNCHANGED means no edit", () => {
    expect(parseEditorReply("UNCHANGED").changed).toBe(false);
    expect(parseEditorReply("<think>fine</think>\nunchanged.").changed).toBe(false);
  });
  test("the edited reply and its notes", () => {
    const r = parseEditorReply('Mira nods. "Fine."\n\nShe waits.\n---NOTES---\n- cut a line for the player\n2. fixed tense\n');
    expect(r).toEqual({ changed: true, text: 'Mira nods. "Fine."\n\nShe waits.', notes: ["cut a line for the player", "fixed tense"] });
  });
});

describe("M17: a written-out plan leaves the story", () => {
  test("a reply that opens with the planning steps keeps only the story", () => {
    const reply = "NOW — dusk, the lighthouse, Mira and Ash.\nSEAL — SAID: hello\n  - stop before Ash answers\nVOICE — short\n\nMira looks up from the logbook.";
    const out = splitLeakedPlan(reply);
    expect(out.text).toBe("Mira looks up from the logbook.");
    expect(out.reasoning).toContain("SEAL — SAID: hello");
  });
  test("ordinary prose is left alone", () => {
    for (const t of ["Now — she said — we wait.", "NOW — the bell rings.\nMira runs.", "Mira waits.\nMOVE — later", "Mira waits by the door.\n\nNOW — the bell.\nMOVE — she runs."]) expect(splitLeakedPlan(t).reasoning).toBe("");
  });
  test("a step's own lines, a header the route ate, and a story glued onto the pass all leave (2026-10-16)", () => {
    // The GLM reply: MINDS one person a line with its header gone, candidates under MOVE, the story glued to VOICE.
    const reply = [
      "Jackie: wants to see the wound · fears it's worse · tactic: captain's orders · mask: command voice",
      "Nat: wants James to stop bleeding · fears he'll tear it · tactic: flat refusal",
      "",
      "WORLD — The cabin door is ajar. The woodstove is cold.",
      "",
      "MOVE —",
      "Candidate A: Jackie examines the wound. Obvious.",
      "Candidate B: her voice cracks. More character-driven.",
      "Choose B. The pressure: Nat has to decide.",
      "",
      "RISK — Writing for James (prevent: no interior).",
      "",
      "VOICE — Medium length. Opening: on Jackie's hands.Her hands are already moving when he turns.",
      "",
      "Not the hover from before.",
    ].join("\n");
    const out = splitLeakedPlan(reply);
    expect(out.text).toBe("Her hands are already moving when he turns.\n\nNot the hover from before.");
    expect(out.reasoning).toContain("Candidate B");
    expect(out.reasoning.endsWith("on Jackie's hands.")).toBe(true);
  });
  test("the story right under the last step, with no blank line, stays story", () => {
    expect(splitLeakedPlan("NOW — dusk.\nVOICE — short\nMira looks up.").text).toBe("Mira looks up.");
  });
  test("a plan written as a bulleted list leaves the story too", () => {
    const reply = "• NOW: ~21:53, the hallway, Buffy on the stairs.\n• SEAL: DID — Gabriel offered the mug.\n• MINDS: Buffy — wants to stop the bleeding · fears the mirror · tactic: body before voice\n\nBuffy is off the stair before she decides to move.";
    const out = splitLeakedPlan(reply);
    expect(out.text).toBe("Buffy is off the stair before she decides to move.");
    expect(out.reasoning).toContain("• SEAL: DID");
  });
  test("a bulleted list in the prose is not a plan", () => {
    expect(splitLeakedPlan("Mira lists what's left:\n• Now: the bread.\n• Move: later.").reasoning).toBe("");
  });
});

describe("the story box: only what's inside <story> is prose", () => {
  test("everything before the box is plan; the ledger after it stays with the text", () => {
    const out = splitStoryBox("NOW — dusk.\nMOVE — tea.\nVOICE — short.<story>\nMira looks up.\n</story>\n<ledger>\nclock: +5m\n</ledger>");
    expect(out.reasoning).toBe("NOW — dusk.\nMOVE — tea.\nVOICE — short.");
    expect(out.text).toBe("Mira looks up.\n\n<ledger>\nclock: +5m\n</ledger>");
    expect(splitStoryBox("<think>NOW — dusk</think>\n<story>Rain.</story>")).toEqual({ text: "Rain.", reasoning: "NOW — dusk" });
    expect(splitStoryBox("Mira looks up.")).toEqual({ text: "Mira looks up.", reasoning: "" });
  });
  const run = (chunks: string[]) => {
    const r = storyRouter();
    const out = { text: "", reasoning: "" };
    for (const c of [...chunks.map((x) => r.push(x)), r.end()]) {
      out.text += c.text;
      out.reasoning += c.reasoning;
    }
    return out;
  };
  test("while it streams, the plan goes to reasoning and only the box reaches the text", () => {
    expect(run(["<think>NOW — dusk", "</think>\n<sto", "ry>\nShe smiled.</st", "ory>"])).toEqual({ text: "She smiled.", reasoning: "NOW — dusk" });
    // A plan written out with no tags is held back, never shown as prose, and goes to reasoning when the box opens.
    expect(run(["NOW — dusk, the cabin.\n", "MOVE — she ", "dresses it.\n<story>", "Her hands move."])).toEqual({ text: "Her hands move.", reasoning: "NOW — dusk, the cabin.\nMOVE — she dresses it.\n" });
    // More plan after the think block closes stays plan.
    expect(run(["<think>NOW — dusk</think>\nMOVE — tea, warily, the sideways choice.\n<story>Rain."])).toEqual({ text: "Rain.", reasoning: "NOW — dusk\n\nMOVE — tea, warily, the sideways choice.\n" });
    expect(run(["<story>Rain.</story>\n<ledger>\nclock: +5m\n</ledger>"])).toEqual({ text: "Rain.\n<ledger>\nclock: +5m\n</ledger>", reasoning: "" });
  });
  test("a reply with no box: prose streams as it comes, a held plan goes back for the clean-up", () => {
    expect(run(["She ", "smiled at the lamp and said nothing for a long while, which was answer enough.\nRain."])).toEqual({ text: "She smiled at the lamp and said nothing for a long while, which was answer enough.\nRain.", reasoning: "" });
    expect(run(["<think>never closed"])).toEqual({ text: "", reasoning: "never closed" });
    expect(run(["NOW — dusk.\nVOICE — short.\n\nMira looks up."])).toEqual({ text: "NOW — dusk.\nVOICE — short.\n\nMira looks up.", reasoning: "" });
    expect(run(["<", "b>Bold</b> move"])).toEqual({ text: "<b>Bold</b> move", reasoning: "" });
  });
});

describe("the plan-only watch: a reply that is only its plan", () => {
  const pass = "NOW — dusk, the lighthouse, Mira and Ash.\n\nSEAL — SAID: hello. Reply ends on her question.\n\nMOVE — she offers tea, warily.\n\nVOICE — short, quiet, no recap.";
  test("a written-out plan, a <think> plan or the provider's reasoning with no story after it", () => {
    expect(planOnly(pass, "")).toBe(pass);
    expect(planOnly(`<think>${pass}</think>\n\n`, "")).toBe(pass);
    expect(planOnly(`${pass}\n</think>`, "")).toBe(pass);
    expect(planOnly("", pass)).toBe(pass);
  });
  test("a plan and the trackers' ledger, with no story between, is still only a plan", () => {
    expect(planOnly(`${pass}\n\n<ledger>\nclock: +5m\n</ledger>`, "")).toBe(pass);
    expect(planOnly(`${pass}\n<story>\n</story>\n<ledger>\nclock: +5m\n</ledger>`, "")).toBe(pass);
    expect(planOnly(`${pass}\n<story>Mira looks up.</story>`, "")).toBeNull();
  });
  test("a story after the plan, or a token plan, is not one", () => {
    expect(planOnly(`${pass}\n\nMira looks up from the logbook.`, "")).toBeNull();
    expect(planOnly("<think>NOW — dusk.</think>", "")).toBeNull();
    expect(planOnly("", "")).toBeNull();
    expect(planOnly("Mira looks up from the logbook.", pass)).toBeNull();
  });
  test("the stop rule echoed as the whole text, after a plan in the route's reasoning, is only a plan", () => {
    expect(planOnly("STOP — After VOICE, close and write.", pass)).toBe(`${pass}\n\nSTOP — After VOICE, close and write.`);
    expect(planOnly("**STOP RULE:** done.\n\n<ledger>\nclock: +5m\n</ledger>", pass)).not.toBeNull();
    expect(planOnly("STOP — After VOICE, close and write.\n\nMira looks up.", pass)).toBeNull();
  });
});

describe("the echoed stop rule", () => {
  test("leading STOP lines go to the reasoning, the story after them stays", () => {
    expect(splitStopLine("STOP — After VOICE, close and write.\n\nMira looks up.")).toEqual({ text: "Mira looks up.", reasoning: "STOP — After VOICE, close and write." });
    expect(splitStopLine("VOICE — short.\nSTOP: write.\nMira looks up.")).toEqual({ text: "Mira looks up.", reasoning: "VOICE — short.\nSTOP: write." });
  });
  test("speech and story are left alone", () => {
    for (const t of ["Stop — she said — wait.", "\"STOP — now!\" Mira yelled.", "Mira looks up.\nSTOP — later", "VOICE — short.\nMira looks up."]) expect(splitStopLine(t).reasoning).toBe("");
  });
});

describe("M33: regex patterns are vetted on save", () => {
  test("slow and broken patterns are turned away, ordinary ones pass", () => {
    expect(vetPattern("/(\\w+\\s?)+$/")).toContain("too long");
    expect(vetPattern("/(a+)+$/")).toContain("too long");
    expect(vetPattern("/(/")).toContain("valid");
    expect(vetPattern("/\\*([^*]+)\\*/g")).toBeNull();
    expect(vetPattern('/"([^"]*)"/g')).toBeNull();
    expect(vetPattern("")).toBeNull();
  });
});
