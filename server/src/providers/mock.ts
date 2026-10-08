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
        moments: lines.filter((l) => /\bpromise/i.test(l.text)).map((l) => ({ tag: "promise", text: firstSentence(l.text), seq: l.seq })),
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
    case "advisor_plan": {
      const said = user.split("IS ABOUT TO SAY:")[1]?.trim().split("\n")[0] ?? "";
      return { direction: `Answer what was just said${said ? ` ("${said.slice(0, 60)}")` : ""} and let the scene breathe.`, beats: ["A small gesture", "One honest line", "Leave room to respond"], threads: [], reminders: [], avoid: ["writing the player's actions"] };
    }
    case "post_edit": {
      const reply = user.split("REPLY:\n")[1] ?? "";
      if (!/PROBLEMS FOUND/.test(user)) return { changed: false, text: reply, notes: [] };
      // Drop sentences that write for the player, as a careful editor would.
      const kept = reply.split(/(?<=[.!?]["”]?)\s+/).filter((s) => !/\b(?:Ash|Alex|You)\s+(?:says|said|nods|takes|follows)\b/.test(s.replace(/"[^"]*"/g, "")));
      return { changed: true, text: kept.join(" "), notes: ["cut a line written for the player"] };
    }
    case "scene_boundary":
      return { newScene: !/MOCK_SAME_SCENE/.test(user), reason: "mock" };
    case "ask_answer":
      return { answer: "From what the story has established: Mira keeps the lighthouse and is waiting out the storm." };
    case "recap":
      return { recap: "Previously: you came back to the lighthouse through the storm, and Mira was waiting with tea." };
    case "tracker_gate":
      return { changed: !/MOCK_NO_CHANGE/.test(user) };
    case "world_telling":
      return {
        beats: [...user.matchAll(/^CARD (\S+)[\s\S]*?^ENGINE'S WORDS (.+)$/gm)].map((m) => ({ card: m[1], text: `Off the page: ${m[2]}` })),
      };
    case "recall_query": {
      const latest = user.split("LATEST LINES:")[1] ?? user;
      return { query: [...new Set(latest.toLowerCase().match(/[a-z]{5,}/g) ?? [])].slice(0, 10).join(" ") };
    }
    case "librarian": {
      // Keep notes that share a longer word with the latest lines.
      const [head, notes = ""] = user.split("NOTES:");
      const words = new Set((head!.toLowerCase().match(/[a-z]{5,}/g) ?? []).filter((w) => !["latest", "lines", "player", "writing"].includes(w)));
      const keep = [...notes.matchAll(/^(\d+)\. (.*)$/gm)].filter((m) => (m[2]!.toLowerCase().match(/[a-z]{5,}/g) ?? []).some((w) => words.has(w))).map((m) => Number(m[1]));
      return { keep };
    }
    case "journal_update": {
      const who = user.match(/^PERSON: (.+?)(?: \(the main character\))?\. /m)?.[1] ?? "I";
      const titles = [...user.matchAll(/^- (.+?) \(#\d+–#\d+\): (.*)$/gm)].map((m) => `${m[1]}: ${firstSentence(m[2]!)}`);
      const prev = user.match(/JOURNAL SO FAR:\n([\s\S]*?)\n\n/)?.[1] ?? "";
      return { journal: `${prev ? `${prev} ` : ""}I, ${who}, remember ${titles.join(" Then ")}`.slice(0, 1800) };
    }
    case "continuity_check": {
      if (!/MOCK_CONTRADICTION/.test(user)) return { issues: [] };
      const ref = user.match(/^\[([TML]\d+)\]/m)?.[1] ?? "T1";
      return { issues: [{ kind: "fact", severity: "major", claim: "MOCK_CONTRADICTION", conflict: "The facts say otherwise.", cites: [ref], fix: "Follow the established facts." }] };
    }
    case "archivist_answer": {
      const first = user.match(/^\[1\] \([^)]*\) (.*)$/m)?.[1];
      return first ? { answer: `According to the archive [1], ${firstSentence(first)}`, cites: [1], confidence: "sure" } : { answer: "The story hasn't established that.", cites: [], confidence: "unknown" };
    }
    case "quiz_questions": {
      const facts = [...user.matchAll(/^(\d+)\. (.*)$/gm)];
      return {
        questions: facts.slice(0, 8).map((m) => {
          const words = m[2]!.replace(/[.!?]$/, "").split(" ");
          return { q: `Fill in the blank: ${words.slice(0, -1).join(" ")} ___`, a: words.at(-1)!, fact: Number(m[1]) };
        }),
      };
    }
    case "quiz_answer": {
      const q = (user.split("QUESTION:")[1] ?? "").toLowerCase();
      const qw = new Set(q.match(/[a-z]{3,}/g) ?? []);
      const notes = (user.split("QUESTION:")[0] ?? "").split("\n").filter((l) => /^[-•]/.test(l.trim()));
      let best = "";
      let bestN = 0;
      for (const l of notes) {
        const n = (l.toLowerCase().match(/[a-z]{3,}/g) ?? []).filter((w) => qw.has(w)).length;
        if (n > bestN) {
          bestN = n;
          best = l;
        }
      }
      return { answer: best ? best.replace(/^[-•]\s*/, "") : "unknown" };
    }
    case "memory_digest":
      return { digest: (user.match(/^- (.*)$/gm) ?? []).map((l) => l.slice(2).replace(/[.!?]$/, "")).join("; ") + "." };
    case "entity_profile":
      return { description: firstSentence((user.split("NOTES:")[1] ?? "").replace(/^\s*- /m, "")) };
    case "lore_assist": {
      const idea = user.match(/^IDEA: (.*)$/m)?.[1];
      const entry = user.split("ENTRY:\n")[1] ?? "";
      const title = user.match(/^TITLE: (.*)$/m)?.[1] ?? idea?.split(/[,.]/)[0] ?? "Entry";
      const content = idea ? `${idea.trim().replace(/\.?$/, ".")} It matters to the story.` : entry.split(/(?<=[.!?])\s+/).slice(0, 2).join(" ");
      return { comment: title, content, keys: names(`${title} ${content}`).length ? names(`${title} ${content}`) : [title.toLowerCase()], aliases: [], essentials: firstSentence(content) };
    }
    case "chronicle_entry": {
      const name = user.match(/^(\S[^—\n(]*?)(?: \(| —|\.)/m)?.[1]?.trim() ?? "Someone";
      const notes = (user.match(/^- (.*)$/gm) ?? []).map((l) => l.slice(2));
      return { comment: name, keys: [name], content: `${name}. ${notes.join(" ")}`.slice(0, 900) };
    }
    // ---------- Lore Studio (Phase 4) ----------
    case "studio_readback":
      return {
        understood: `A setting built around ${names(user).slice(0, 2).join(" and ") || "the author's idea"}. ${firstSentence(user.split("\n").slice(1).join(" "))}`,
        missing: ["who holds power", "what people fear"],
        questions: [
          { q: "Who holds power here, and who wants it?", why: "Factions and rivals need someone to push against." },
          { q: "What do ordinary people fear at night?", why: "Fears become dangers, rumours and rules." },
          { q: "What should never happen in this world?", why: "Hard rules keep long stories consistent." },
        ],
      };
    case "studio_directions":
      return {
        directions: [
          { title: "The quiet decline", pitch: "The town is slowly emptying. Those who stay guard something they won't name." },
          { title: "The rival house", pitch: "Two families split the harbour between them. Every favour has a price." },
          { title: "The thing in the fog", pitch: "Ships come back with one sailor too many. Nobody counts aloud anymore." },
        ],
      };
    case "studio_outline": {
      const want = Number(user.match(/^MOCK_COUNT (\d+)$/m)?.[1] ?? 0) || 6;
      const planned = new Set((user.split("ALREADY PLANNED:")[1] ?? "").split("\n").map((l) => l.match(/^- (.+?)(?: \(|:|$)/)?.[1]?.toLowerCase()).filter(Boolean));
      const source = user.split(/\n\n(?:THE AUTHOR'S ANSWERS|TONE AND GENRE|STYLE NOTES|ENTRY KINDS|OVERVIEW|ALREADY PLANNED|ALREADY IN THEIR LORE)/)[0] ?? user;
      const found = [...new Set(source.match(/\b[A-Z][a-z]{2,}(?: [A-Z][a-z]{2,})?\b/g) ?? [])].filter((w) => !["The", "She", "You", "This", "That", "THE", "Description", "Personality", "Scenario", "First", "Creator", "Example", "About", "Entries"].includes(w.split(" ")[0]!));
      const types = ["location", "character", "faction", "item", "concept", "event"];
      const titles = [...found, "The Old Harbour", "The Night Market", "The Salt Guild", "The Drowned Bell", "The Long Winter", "The Ferryman"].filter((t) => !planned.has(t.toLowerCase()));
      const items = [...new Set(titles)].slice(0, want).map((t, k) => ({ title: t, type: types[k % types.length], pitch: `${t} matters to the story.`, parent: k === 1 && titles[0] ? titles[0] : "", folder: "" }));
      return { title: /ALREADY PLANNED/.test(user) ? "" : "Mock World", overview: /ALREADY PLANNED/.test(user) ? "" : "A cold harbour town where the fog keeps secrets. Everyone owes someone.", items };
    }
    case "studio_entry": {
      const m = user.match(/^THIS ENTRY: (.+?)(?: \((\w+)\))?(?:: (.*))?$/m);
      const title = m?.[1] ?? "Entry";
      const notes = user.split("SOURCE NOTES FOR THIS ENTRY:\n")[1]?.split("\n\n")[0];
      const content = notes ? notes.trim() : `${title} is part of this world. ${m?.[3] ?? ""} People speak of it in low voices, and it shapes what happens next.`.replace(/\s+/g, " ").trim();
      const asks = user.match(/^THE AUTHOR ASKS: (.*)$/m)?.[1];
      return {
        content: asks ? `${content} (${asks})` : content,
        keys: [title, ...names(content).filter((n) => n !== title).slice(0, 1)],
        aliases: [],
        essentials: firstSentence(content),
        secrets: /"secrets": 0–2/.test(user) || !/MOCK_SECRET/.test(user) ? [] : [{ text: `${title} hides something.`, knownBy: [title] }],
      };
    }
    case "studio_consistency": {
      const n = [...user.matchAll(/^(\d+)\. /gm)].length;
      return { issues: /MOCK_CONFLICT/.test(user) && n >= 2 ? [{ entries: [1, 2], problem: "They disagree.", fix: "Pick one." }] : [] };
    }
    // ---------- Expand my idea, the character and persona creator (Phase 4) ----------
    case "idea_expand": {
      const kind = user.match(/^KIND: (\w+)/m)?.[1] ?? "world";
      const idea = (user.split(/THE AUTHOR'S IDEA \(canon\):\n/)[1] ?? "").split("\n\n")[0] ?? "";
      const heads = kind === "world" ? ["Premise", "Central tension", "Places", "Story hooks"] : ["Concept", "Voice", "Wants and fears", "Story hooks"];
      const again = /THE CURRENT VERSION:/.test(user) ? " (reworked)" : "";
      return { sections: heads.map((h) => ({ heading: h, text: `${h} for ${firstSentence(idea) || "the idea"} Named: ${names(idea).join(", ") || "nobody yet"}.${again}` })) };
    }
    case "creator_readback":
      return {
        understood: `Someone built from ${names(user).slice(0, 2).join(" and ") || "the author's idea"}.`,
        missing: ["their voice", "what they want"],
        questions: [
          { q: "What do they want that they can't admit?", why: "A hidden want drives scenes." },
          { q: "How do they talk when they're angry?", why: "Voice under pressure is what players remember." },
        ],
      };
    case "creator_bible": {
      const name = user.match(/^NAME: (.+)$/m)?.[1] ?? names(user.split("THE AUTHOR'S IDEA")[1] ?? user)[0] ?? "Wren";
      const keys = ["identity", "appearance", "personality", "voice", "backstory", "background", "motivation", "flaws", "relationships", "secrets", "details", "user", "hooks", "skills"];
      const steer = /THE CURRENT BIBLE:/.test(user) ? " Reworked." : "";
      return { name, ...Object.fromEntries(keys.map((k) => [k, `${name}'s ${k}: specific and playable.${k === "voice" ? ' "Sit. You look like the fog chewed you."' : ""}${steer}`])) };
    }
    // ---------- card tools (Phase 4) ----------
    case "notes_sort": {
      const notes = user.split("THE NOTES:\n")[1] ?? "";
      const looks = notes.split("\n").filter((l) => /eyes|hair|tall|wears/i.test(l));
      const rest = notes.split("\n").filter((l) => l.trim() && !/eyes|hair|tall|wears/i.test(l) && !/^TODO/i.test(l));
      return {
        fields: { ...(looks.length ? { description: looks.join(" ") } : {}), ...(rest.length ? { personality: rest.join(" ") } : {}) },
        placements: [...looks.map((l) => ({ piece: l.slice(0, 30), field: "description", why: "how they look" })), ...rest.map((l) => ({ piece: l.slice(0, 30), field: "personality", why: "how they act" }))],
        leftover: notes.split("\n").filter((l) => /^TODO/i.test(l)),
      };
    }
    case "card_review":
      return { issues: /MOCK_ISSUE/.test(user) ? [{ field: "description", problem: "The want is vague.", fix: "Say what she wants from {{user}}." }] : [] };
    case "voice_lab": {
      const name = user.match(/^CHARACTER: (.+)$/m)?.[1] ?? "Mira";
      return { lines: ["calm", "angry"].map((s) => ({ situation: s, cue: s === "calm" ? "How are you?" : "You lied to me.", line: `"${s === "calm" ? "Fine. The lamp's lit." : "Then leave."}" ${name} doesn't look up.` })) };
    }
    case "variant_draft": {
      const idea = user.split("THE VARIANT: ")[1]?.trim() ?? "variant";
      return { name: idea.split(" ").slice(0, 3).join(" "), note: `The ${idea}.`, fields: { description: `In the ${idea}: the same person, different clothes.`, first_mes: `Snow falls on the harbour as she looks up. "You came back?"`, nonsense: "dropped" } };
    }
    case "creator_bible_check":
      return { issues: /MOCK_ISSUE/.test(user) ? [{ section: "voice", problem: "The voice is flat.", fix: "Give them a verbal habit." }] : [] };
    default:
      return {};
  }
}

/** Plain-text creative helpers (fields, deeper sections, extended answers), keyed by their prompt's wording. */
function mockPlainText(system: string, user: string): string | null {
  const field = system.match(/^Field: (.+)$/m)?.[1];
  // Card tools' field actions echo the field with the action, so a test can see what was asked.
  const editing = user.match(/THE FIELD TO EDIT \([^)]*\):\n([\s\S]*)$/)?.[1];
  if (field && editing !== undefined) {
    const action = /Condense it/.test(system) ? "condensed" : /Expand it/.test(system) ? "expanded" : /Convert it to flowing prose/.test(system) ? "prose" : /Make exactly this change/.test(system) ? "edited" : "rewritten";
    return `${editing.trim()} (${action})`;
  }
  if (field) {
    const name = user.match(/^NAME: (.+)$/m)?.[1] ?? "Wren";
    const asks = user.match(/^THE AUTHOR ASKS: (.*)$/m)?.[1];
    const fixed = /writes \{\{user\}\}'s actions/.test(user);
    let text: string;
    if (field === "Greeting" || field.startsWith("Alternate greeting"))
      text =
        /MOCK_PUPPET/.test(user) && !fixed
          ? `{{user}} nods and smiles at ${name}. You feel safe at last.`
          : `${name} looks up from the logbook as the door bangs open, and the lamp gutters in the draught. "You're late," ${name} says, sliding a chipped mug across the table. The tea is still warm; the fog presses at the glass like a held breath. "Sit down. The harbourmaster was here asking about you, and I told him nothing. ${field === "Greeting" ? "So" : "Now"} — what did the fog take from you this time?"`;
    else if (field === "Example dialogue") text = `<START>\n{{user}}: Hello.\n{{char}}: "Hello yourself." ${name} doesn't look up from the ledger.\n<START>\n{{user}}: Are you angry?\n{{char}}: "Angry is for people with time." ${name} snaps the book shut.`;
    else if (field === "Tags") text = "Fantasy, Harbour, mystery, slow burn";
    else if (field === "Pronouns") text = "she/her";
    else text = `${field} of ${name}: ${name} keeps the harbour light and keeps her promises, and the people of Port Ellis know both cost her something. She talks in short, dry sentences and laughs only when she's tired.`;
    return asks ? `${text} (${asks})` : text;
  }
  if (/^Go deeper on one section/.test(system)) {
    const section = user.split("THE SECTION TO DEEPEN: ")[1] ?? "";
    return `${section.split("\n").slice(1).join(" ").trim()} Deeper: the harbourmaster keeps a second ledger, and the Salt Guild pays for the pages that go missing.`;
  }
  if (/^Rewrite one section of the bible/.test(system)) return `Rewritten: sharper, more specific, and playable.${/The author asks: (.*)/.exec(system)?.[1] ? ` ${/The author asks: (.*)/.exec(system)![1]}` : ""}`;
  if (/^Push the author's draft answer further/.test(system)) return `${(user.split("THE AUTHOR'S DRAFT:\n")[1] ?? "").trim()} She keeps the key on a cord around her wrist, and never lets anyone see her use it.`;
  return null;
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
    const plain = schemaName ? null : mockPlainText(system, userText);
    if (plain !== null) {
      onDelta({ text: plain });
      return { finishReason: "stop", usage: { promptTokens: Math.round(JSON.stringify(req.messages).length / 4), completionTokens: Math.round(plain.length / 4) }, sentBody: { model: req.model, messages: req.messages } };
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
  if (system.includes('"query"')) return "recall_query";
  if (system.includes('"keep"')) return "librarian";
  if (system.includes('"journal"')) return "journal_update";
  if (system.includes('"issues"')) return "continuity_check";
  if (system.includes('"confidence"')) return "archivist_answer";
  if (system.includes('"questions"')) return "quiz_questions";
  if (system.includes('"digest"')) return "memory_digest";
  if (system.includes('"description"')) return "entity_profile";
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
