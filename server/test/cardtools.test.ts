import { beforeAll, describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import { normalizeCard } from "../src/cards/card";
import { all } from "../src/db/db";
import { asCardLike, checkCardFields, draftGreeting, draftRules, fieldAssist, reviewCard, sortNotes, voiceSamples, voiceToExamples } from "../src/creator/tools";
import { applyServicePrompt, replyContract } from "../src/lib/prompts";
import { applyRegex, compileFind, importStRegex, type RegexScript } from "../src/lib/regex";
import { setSetting } from "../src/lib/settings";
import { createLorebook } from "../src/lore/service";
import { defaultEntry } from "../src/lore/types";
import { controlsText, DEFAULT_CONTROLS } from "../src/prompt/preset";
import { benchPrompt, streamBench } from "../src/services/bench";
import { createCharacter, getCard, updateCharacter } from "../src/services/characters";
import { addMessage, createChat, updateChat } from "../src/services/chats";
import { createConnection, createProfile, syncModels } from "../src/services/connections";
import { callJson } from "../src/services/llm";
import { previewPrompt } from "../src/services/generation";
import { registerJob } from "../src/services/jobs";
import { createPersona } from "../src/services/personas";
import { createPreset } from "../src/services/presets";
import { defaultPreset } from "../src/prompt/preset";
import { applyCardVariant, createVariant, deleteVariant, draftVariant, getVariant, listVariants } from "../src/services/variants";
import { z } from "zod";
import { freshDb } from "./helpers";

let app: ReturnType<typeof createApp>;
let charId = "";
let profileId = "";
const local = { requestIP: () => ({ address: "127.0.0.1", family: "IPv4", port: 5000 }) };
async function api<T = any>(method: string, path: string, body?: unknown): Promise<{ status: number; json: T }> {
  const res = await app.fetch(new Request(`http://localhost${path}`, { method, headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined }), local);
  const text = await res.text();
  let json: T;
  try {
    json = JSON.parse(text) as T;
  } catch {
    json = text as T;
  }
  return { status: res.status, json };
}
const card = () => getCard(charId)!;
const sys = (messages: { role: string; content: string }[]) => messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");

beforeAll(async () => {
  freshDb();
  for (const k of ["memory.segment", "memory.build", "memory.embed", "memory.journal", "memory.consolidate", "lore.chronicle", "lore.embed", "accuracy.check", "quota.refresh", "creator.write", "lore.studio"]) registerJob(k, async () => {});
  app = createApp();
  const conn = createConnection({ name: "Mock", kind: "mock", billing: "subscription" });
  await syncModels(conn);
  profileId = createProfile({ name: "Story", connectionId: conn, modelId: "mock/storyteller", params: { context_target: 8000 } });
  const { data } = normalizeCard({
    spec: "chara_card_v2",
    data: { name: "Mira", description: "Mira keeps the lighthouse above Port Ellis. [tall, grey eyes]", personality: "Dry, loyal.", first_mes: "{{user}} nods and smiles. Mira waits.", mes_example: "{{user}}: hi\nMira: hello" },
  });
  charId = createCharacter(data);
});

describe("field AI actions, notes, checks (CHAR-11…13)", () => {
  test("an action returns a proposal for one field", async () => {
    const r = await fieldAssist({ kind: "character", field: "description", action: "condense", text: card().description, card: asCardLike(card()) });
    expect(r.text).toBe(`${card().description} (condensed)`);
    expect(r.tokens.after).toBeGreaterThan(0);
    expect((await api("POST", "/api/card-tools/assist", { kind: "character", field: "description", action: "prose", text: "x", card: card() })).json.text).toBe("x (prose)");
    expect((await api("POST", "/api/card-tools/assist", { kind: "character", field: "description", action: "edit", text: "x", card: card() })).status).toBe(400);
  });

  test("messy notes are sorted into fields, with where each piece went", async () => {
    const r = await sortNotes({ kind: "character", notes: "She has grey eyes and wears oilskins.\nShe never apologises.\nTODO: give her a dog", card: asCardLike(card()) });
    expect(r.fields.description).toContain("grey eyes");
    expect(r.fields.personality).toContain("never apologises");
    expect(r.placements.map((p) => p.field)).toEqual(["description", "personality"]);
    expect(r.leftover).toEqual(["TODO: give her a dog"]);
  });

  test("checks catch puppeting, example format and W++; the review is a model pass", async () => {
    const issues = checkCardFields("character", asCardLike(card()));
    expect(issues.first_mes?.map((i) => i.kind)).toContain("puppets-user");
    expect(issues.mes_example?.map((i) => i.kind)).toContain("format");
    expect(issues.description?.map((i) => i.kind)).toContain("format");
    expect(await reviewCard("character", { ...asCardLike(card()), description: "MOCK_ISSUE" })).toEqual([{ field: "description", problem: "The want is vague.", fix: "Say what she wants from {{user}}." }]);
    const viaApi = await api("POST", "/api/card-tools/check", { kind: "persona", card: { name: "Ash", description: "A tapestry of quiet." } });
    expect(viaApi.json.issues.description.map((i: { kind: string }) => i.kind)).toContain("stock-phrase");
    expect(viaApi.json.review).toBeNull();
  });
});

describe("greetings, rules, voice (CHAR-14, 15, 17)", () => {
  test("a new greeting never puppets {{user}}; the retry fixes it", async () => {
    const g = await draftGreeting({ card: { ...asCardLike(card()), description: "MOCK_PUPPET" }, situation: "at the docks at dawn", pov: "third", tense: "present" });
    expect(g).not.toContain("{{user}} nods");
    expect(g).toContain("logbook");
  });

  test("rules keep the preset's own post-history instructions", async () => {
    const rules = await draftRules(asCardLike(card()));
    expect(rules.startsWith("{{original}}\n")).toBe(true);
  });

  test("voice lab lines, kept lines saved on the character, and turned into examples", async () => {
    const lines = await voiceSamples({ card: asCardLike(card()), situations: ["calm", "angry"], count: 1 });
    expect(lines.map((l) => l.situation)).toEqual(["calm", "angry"]);
    expect(lines[0]!.line).toContain("Mira");
    updateCharacter(charId, { settings: { voice: { kept: [lines[0]!] } } });
    expect((await api("GET", `/api/characters/${charId}`)).json.settings.voice.kept).toHaveLength(1);
    expect(voiceToExamples([lines[0]!])).toBe(`<START>\n{{user}}: ${lines[0]!.cue}\n{{char}}: ${lines[0]!.line}`);
  });
});

describe("variants (CHAR-06, PER-05)", () => {
  test("a variant overlays only what it changes; chats can play it", async () => {
    const d = await draftVariant("character", charId, "winter outfit");
    expect(Object.keys(d.overlay).sort()).toEqual(["description", "first_mes"]);
    const v = createVariant("character", charId, { name: d.name, note: d.note, overlay: d.overlay });
    expect(listVariants("character", charId)).toHaveLength(1);
    const played = applyCardVariant(card(), v, charId);
    expect(played.description).toContain("winter outfit");
    expect(played.personality).toBe("Dry, loyal.");
    // Another character's variant is ignored.
    expect(applyCardVariant(card(), v, "someone-else").description).toBe(card().description);

    // A new chat with the variant opens with its greeting and plays its description.
    const chat = createChat({ characterId: charId, variantId: v.id });
    expect(chat.settings.variantId).toBe(v.id);
    const p = await previewPrompt(chat.id);
    expect(sys(p.messages)).toContain("winter outfit");
    const got = await api("GET", `/api/chats/${chat.id}`);
    expect(got.json.variants.map((x: { id: string }) => x.id)).toEqual([v.id]);
    const first = all<{ content: string }>("SELECT s.content FROM swipes s JOIN messages m ON m.id = s.message_id WHERE m.chat_id = ? ORDER BY s.idx", chat.id);
    expect(first[0]!.content).toContain("Snow falls");

    // Deleting it sends chats back to the base card.
    deleteVariant(v.id);
    expect(getVariant(v.id)).toBeUndefined();
    expect((await api("GET", `/api/chats/${chat.id}`)).json.chat.settings.variantId).toBeUndefined();
  });

  test("persona variants change the persona in the prompt; the routes work", async () => {
    const pid = createPersona({ name: "Ash", data: { description: "A courier." } });
    const made = await api("POST", `/api/personas/${pid}/variants`, { name: "Ten years later", overlay: { description: "A retired courier with a limp.", bogus: "x" } });
    expect(made.status).toBe(201);
    expect(made.json.overlay).toEqual({ description: "A retired courier with a limp." });
    const chat = createChat({ characterId: charId, personaId: pid });
    updateChat(chat.id, { settings: { personaVariantId: made.json.id } });
    expect(sys((await previewPrompt(chat.id)).messages)).toContain("retired courier");
    expect((await api("PUT", `/api/variants/${made.json.id}`, { name: "Older" })).json.name).toBe("Older");
    expect((await api("POST", `/api/characters/${charId}/variants/draft`, { idea: "modern AU" })).json.overlay.description).toContain("modern AU");
  });
});

describe("prompt layers: overrides, controls, prefill (PROMPT-06, 07, 10)", () => {
  test("chat → character → global, for preset, author's note, controls and story settings", async () => {
    const terse = createPreset({ ...defaultPreset(), name: "Terse", blocks: defaultPreset().blocks.map((b) => (b.id === "main" ? { ...b, content: "TERSE PRESET" } : b)) });
    const chat = createChat({ characterId: charId });
    expect(sys((await previewPrompt(chat.id)).messages)).not.toContain("TERSE PRESET");
    updateCharacter(charId, { settings: { presetId: terse, authorsNote: { content: "CHARACTER NOTE", depth: 2, role: "system" }, controls: { dialogue: true }, story: { tone: "wistful" }, truths: ["Nobody counts aloud at sea."] } });
    let prompt = sys((await previewPrompt(chat.id)).messages);
    expect(prompt).toContain("TERSE PRESET");
    expect(prompt).toContain("CHARACTER NOTE");
    expect(prompt).toContain("Favour dialogue over narration");
    expect(prompt).toContain("Tone: wistful");
    expect(prompt).toContain("Nobody counts aloud at sea.");
    // The chat's own choices win.
    updateChat(chat.id, { settings: { presetId: null, authorsNote: { content: "CHAT NOTE", depth: 2, role: "system" }, controls: { dialogue: false, focus: "atmosphere" } } });
    prompt = sys((await previewPrompt(chat.id)).messages);
    expect(prompt).toContain("CHAT NOTE");
    expect(prompt).not.toContain("CHARACTER NOTE");
    expect(prompt).not.toContain("Favour dialogue");
    expect(prompt).toContain("Linger on atmosphere");
    // An empty chat preset falls through to the character's.
    expect(prompt).toContain("TERSE PRESET");
    const got = await api("GET", `/api/chats/${chat.id}`);
    expect(got.json.defaults.from.preset).toBe("character");
    updateCharacter(charId, { settings: { presetId: null, authorsNote: null, controls: {}, story: {}, truths: [] } });
  });

  test("controls render only what's on", () => {
    expect(controlsText(DEFAULT_CONTROLS, {})).toBe("");
    expect(controlsText(DEFAULT_CONTROLS, { slowburn: true, focus: "inner" })).toContain("Slow burn");
    expect(controlsText(DEFAULT_CONTROLS, { slowburn: true, focus: "inner" })).toContain("inner life");
  });

  test("a model's prefill replaces the preset's", async () => {
    const chat = createChat({ characterId: charId });
    updateChat(chat.id, { settings: { profileId: createProfile({ name: "Prefilled", connectionId: (await api("GET", "/api/connections")).json.connections[0].id, modelId: "mock/storyteller", params: { prefill: "PREFILL:" } }) } });
    const p = await previewPrompt(chat.id);
    expect(p.messages.at(-1)).toEqual({ role: "assistant", content: "PREFILL:" });
    expect(JSON.stringify(p.params)).not.toContain("PREFILL");
  });
});

describe("the test bench (CHAR-16)", () => {
  test("built like a real chat (preset, lore, persona variant), streamed, never saved", async () => {
    createLorebook({ name: "Coast", entries: [defaultEntry({ comment: "Port Ellis", keys: ["Port Ellis"], content: "BENCH LORE: a cold harbour." })], links: [{ target_type: "character", target_id: charId }] });
    const chats = all("SELECT id FROM chats").length;
    const input = { characterId: charId, card: { ...card(), description: "UNSAVED EDIT" }, mode: "companion" as const, messages: [{ role: "assistant" as const, content: "Hello, {{user}}." }, { role: "user" as const, content: "Tell me about Port Ellis." }] };
    const { assembled } = benchPrompt(input);
    const text = sys(assembled.messages);
    expect(text).toContain("UNSAVED EDIT");
    expect(text).toContain("BENCH LORE");
    // Macros in the bench history are filled in, with the default persona's name.
    expect(assembled.messages.some((m) => m.content === "Hello, Ash.")).toBe(true);
    let out = "";
    for await (const chunk of streamBench(input, new AbortController().signal)) out += chunk.text ?? "";
    expect(out).toContain("lamp");
    expect(all("SELECT id FROM chats").length).toBe(chats);
    expect(all<{ kind: string }>("SELECT kind FROM generations WHERE kind = 'bench'").length).toBe(1);
    const res = await api("POST", "/api/card-tools/bench", { characterId: charId, card: card(), messages: [{ role: "user", content: "Hi." }] });
    expect(res.status).toBe(200);
    expect(String(res.json)).toContain('"done":true');
  });
});

describe("regex scripts (PROMPT-08)", () => {
  const scripts: RegexScript[] = [
    { id: "a", name: "Hide OOC", find: "/\\(OOC:[^)]*\\)/g", replace: "", targets: ["ai", "user"], mode: "prompt", enabled: true, characterIds: [] },
    { id: "b", name: "Em dash", find: " -- ", replace: " — ", targets: ["ai"], mode: "persistent", enabled: true, characterIds: [] },
    { id: "c", name: "Shout", find: "/lighthouse/gi", replace: "[{{match}}]", targets: ["user"], mode: "persistent", enabled: true, characterIds: ["nobody"] },
  ];

  test("modes, targets, character scope, {{match}}", () => {
    expect(applyRegex("hi (OOC: brb) there", scripts, { role: "user", mode: "prompt" })).toBe("hi  there");
    expect(applyRegex("wait -- what", scripts, { role: "ai", mode: "persistent" })).toBe("wait — what");
    expect(applyRegex("wait -- what", scripts, { role: "user", mode: "persistent" })).toBe("wait -- what");
    expect(applyRegex("the Lighthouse", scripts, { role: "user", mode: "persistent", characterId: "nobody" })).toBe("the [Lighthouse]");
    expect(applyRegex("the Lighthouse", scripts, { role: "user", mode: "persistent", characterId: "x" })).toBe("the Lighthouse");
    expect(compileFind("/(unclosed/")).toBeNull();
    expect(importStRegex([{ scriptName: "Trim", findRegex: "/\\s+$/", replaceString: "", placement: [2], markdownOnly: true }])[0]).toMatchObject({ name: "Trim", mode: "display", targets: ["ai"] });
  });

  test("prompt-only changes what's sent; persistent changes what's stored; settings are validated", async () => {
    expect((await api("PUT", "/api/settings", { "regex.scripts": [{ id: "x" }] })).status).toBe(400);
    expect((await api("PUT", "/api/settings", { "regex.scripts": scripts })).status).toBe(200);
    const chat = createChat({ characterId: charId });
    addMessage(chat.id, "user", "Hello (OOC: is this on?) Mira");
    const p = await previewPrompt(chat.id);
    expect(JSON.stringify(p.messages)).not.toContain("OOC");
    setSetting("regex.scripts", []);
  });
});

describe("helper prompt sets (PROMPT-09)", () => {
  test("append, replace with {{default}}, the reply contract kept, and a global line", async () => {
    const system = 'Summarise the scene. Reply with JSON only: {"summary": "…"}';
    expect(replyContract(system)).toBe('Reply with JSON only: {"summary": "…"}');
    const set = {
      id: "s1",
      name: "Mine",
      overrides: { "memory.scene": { mode: "replace" as const, text: "Write like a court reporter." }, "memory.verify": { mode: "append" as const, text: "Be strict." }, global: { mode: "append" as const, text: "British spelling." } },
    };
    expect(applyServicePrompt("scene", system, set)).toBe('Write like a court reporter.\n\nAlways: British spelling.\n\nReply with JSON only: {"summary": "…"}');
    expect(applyServicePrompt("verify", system, set)).toContain("Summarise the scene.\n\nAdditional instructions from the author:\nBe strict.");
    expect(applyServicePrompt("scene", system, { ...set, overrides: { "memory.scene": { mode: "replace", text: "First: {{default}}" } } })).toBe('First: Summarise the scene.\n\nReply with JSON only: {"summary": "…"}');
    expect(applyServicePrompt("scene", system, null)).toBe(system);

    // Through the real call path, with the set switched on in settings.
    expect((await api("PUT", "/api/settings", { "prompts.sets": [set], "prompts.active": "s1" })).status).toBe(200);
    await callJson({ task: "helper", kind: "verify", name: "summary_check", schema: z.any(), system, user: "x" });
    const sent = all<{ request: string }>("SELECT request FROM generations WHERE kind = 'verify' ORDER BY started_at DESC LIMIT 1")[0]!;
    expect(sent.request).toContain("Be strict.");
    expect(sent.request).toContain("British spelling.");
    const listing = await api("GET", "/api/prompts/service");
    expect(listing.json.prompts.find((p: { id: string }) => p.id === "memory.verify").sample.text).toContain("Be strict.");
    setSetting("prompts.active", null);
  });
});
