import { beforeAll, describe, expect, test } from "bun:test";
import type { MeaEvent } from "../src/lib/events";
import { subscribe } from "../src/lib/events";
import { normalizeCard } from "../src/cards/card";
import { all, one } from "../src/db/db";
import { defaultMemoryConfig, defaultSteer, setSetting } from "../src/lib/settings";
import { buildSummary, carryMoments, storyNeedsRebuild } from "../src/memory/build";
import { voiceRule, rollupSystem, sceneSystem } from "../src/memory/prompts";
import { autoRecap, rebuildEstimate, rebuildProgress, recapFor } from "../src/memory/recap";
import { queueBuilds, segmentChat } from "../src/memory/scheduler";
import { levelRows, storyRow } from "../src/memory/store";
import { createCharacter } from "../src/services/characters";
import { patchCharacterSettings } from "../src/services/charsettings";
import { applyBanned } from "../src/services/chattools";
import { addMessage, createChat, getMessage, historyForPrompt, updateChat } from "../src/services/chats";
import { createConnection, createProfile, syncModels } from "../src/services/connections";
import { prefetch, previewPrompt, startStory } from "../src/services/generation";
import { registerJob } from "../src/services/jobs";
import { createPersona } from "../src/services/personas";
import { planFor, recentPlans, runAdvisor, turnKey } from "../src/steer/advisor";
import { decideEdit, runEditorJob } from "../src/steer/editor";
import { normalizeQuotes, styleFor, styleText } from "../src/steer/style";
import { freshDb } from "./helpers";

let charId = "";
let chatId = "";

function waitFor(pred: (e: MeaEvent) => boolean, timeout = 8000) {
  return new Promise<MeaEvent>((resolve, reject) => {
    const t = setTimeout(() => (off(), reject(new Error("timed out"))), timeout);
    const off = subscribe((e) => {
      if (pred(e)) {
        clearTimeout(t);
        off();
        resolve(e);
      }
    });
  });
}

beforeAll(async () => {
  freshDb();
  for (const kind of ["memory.segment", "memory.build", "memory.embed", "memory.journal", "memory.consolidate", "lore.chronicle", "accuracy.check", "accuracy.drift", "steer.edit", "quota.refresh", "cache.probe"]) registerJob(kind, async () => {});
  const connId = createConnection({ name: "Mock", kind: "mock", billing: "subscription" });
  await syncModels(connId);
  createProfile({ name: "Story", connectionId: connId, modelId: "mock/storyteller", params: { context_target: 6000, max_tokens: 400 } });
  setSetting("memory.config", { ...defaultMemoryConfig, boundaryCheck: false, verify: false, sceneTokenCap: 100_000, scenesPerChapter: 2, chaptersPerArc: 2, lag: 1 });
  const { data } = normalizeCard({ spec: "chara_card_v2", data: { name: "Mira", description: "Keeper of the lighthouse.", first_mes: "The lamp is lit." } });
  charId = createCharacter(data);
  chatId = createChat({ characterId: charId, personaId: createPersona({ name: "Ash" }) }).id;
});

describe("the style profile (STEER-04)", () => {
  test("the character's profile under the chat's, field by field", () => {
    patchCharacterSettings(charId, { style: { guide: "Short paragraphs. Sensory detail.", banned: ["tapestry"], actions: "asterisks" } });
    updateChat(chatId, { settings: { style: { quotes: "curly", banned: ["orbs"] } } });
    const s = styleFor(chatId);
    expect(s).toMatchObject({ guide: "Short paragraphs. Sensory detail.", actions: "asterisks", quotes: "curly" });
    expect([...(s.banned ?? [])].sort()).toEqual(["orbs", "tapestry"]);
    expect(styleText(s)).toContain('Never use these words or phrases: "tapestry", "orbs".');
  });
  test("goes into the stable prefix", async () => {
    const p = await previewPrompt(chatId);
    expect(p.trace.blocks.find((b) => b.id === "extra:style")?.included).toBe(true);
    expect(p.messages[0]!.content).toContain("[Style for this story]");
  });
  test("quotes are normalised, apostrophes left alone", () => {
    expect(normalizeQuotes('"Don\'t," she said. "Stay."', "curly")).toBe("“Don't,” she said. “Stay.”");
    expect(normalizeQuotes("“Stay,” she said.", "straight")).toBe('"Stay," she said.');
  });
  test("the story's banned words are flagged with yours", () => {
    expect(applyBanned("Her orbs gleamed.", ["orbs"]).hits).toContain("orbs");
    expect(applyBanned("A tapestry of light.", ["tapestry"]).hits).toEqual(["tapestry"]);
  });
});

describe("the advisor (STEER-01, STEER-02)", () => {
  test("plans while you type; the plan waits for the reply it was written for", async () => {
    const achat = createChat({ characterId: charId }).id;
    // Off by default: no plan.
    expect(await runAdvisor(achat, { draft: "Hello" })).toBeNull();
    updateChat(achat, { settings: { advisor: true } });
    const draft = "I set the lantern down and ask about the storm.";
    await prefetch(achat, draft);
    // prefetch starts the advisor in the background; it is cached by the turn it was planned for.
    for (let i = 0; i < 50 && !planFor(achat, turnKey(historyForPrompt(achat), draft)); i++) await Bun.sleep(20);
    expect(planFor(achat, turnKey(historyForPrompt(achat), draft))?.direction).toContain("ask about the storm");
    addMessage(achat, "user", draft, { name: "Ash" });
    const p = await previewPrompt(achat);
    expect(p.messages.some((m) => m.content.includes("[Private plan for this reply"))).toBe(true);
    // A real reply marks the plan used, and the next plan sees it.
    const ended = waitFor((e) => e.type === "gen.end" && "chatId" in e && e.chatId === achat);
    await startStory(achat, "new");
    await ended;
    expect(recentPlans(achat)[0]?.used).toBe(true);
    await runAdvisor(achat, { draft: "And then?" });
    const req = one<{ request: string }>("SELECT request FROM generations WHERE chat_id = ? AND kind = 'advisor' ORDER BY started_at DESC LIMIT 1", achat);
    expect(req?.request).toContain("YOUR EARLIER PLANS");
  });
  test("a send waits briefly for a plan that isn't ready (never for previews)", async () => {
    const bchat = createChat({ characterId: charId }).id;
    updateChat(bchat, { settings: { advisor: true } });
    addMessage(bchat, "user", "Is the lamp lit?", { name: "Ash" });
    expect((await previewPrompt(bchat)).messages.some((m) => m.content.includes("Private plan"))).toBe(false);
    const ended = waitFor((e) => e.type === "gen.end" && "chatId" in e && e.chatId === bchat);
    await startStory(bchat, "new");
    await ended;
    const used = all<{ used_at: number | null }>("SELECT used_at FROM advisor_plans WHERE chat_id = ?", bchat);
    expect(used).toHaveLength(1);
    expect(used[0]!.used_at).not.toBeNull();
  });
});

describe("the post-pass editor (STEER-03)", () => {
  test("suggests minimal fixes as a diff, then applies and undoes them", async () => {
    const echat = createChat({ characterId: charId, personaId: createPersona({ name: "Ash" }) }).id;
    updateChat(echat, { settings: { editor: "flagged" } });
    const clean = addMessage(echat, "assistant", "Mira sets the lamp down and studies the storm.", { name: "Mira" });
    await runEditorJob({ chatId: echat, messageId: clean, swipeIdx: 0 });
    expect(getMessage(clean)?.meta.edit).toBeUndefined();
    const original = 'Mira sets the lamp down and studies the storm for a long moment. "Fine," Ash says, and follows her up the stairs.';
    const m = addMessage(echat, "assistant", original, { name: "Mira" });
    await runEditorJob({ chatId: echat, messageId: m, swipeIdx: 0 });
    const edit = getMessage(m)?.meta.edit as { status: string; text: string; notes: string[] };
    expect(edit.status).toBe("proposed");
    expect(edit.text).toBe("Mira sets the lamp down and studies the storm for a long moment.");
    expect(getMessage(m)?.content).toBe(original);
    decideEdit(m, "apply");
    expect(getMessage(m)?.content).toBe(edit.text);
    decideEdit(m, "undo");
    expect(getMessage(m)?.content).toBe(original);
  });
  test("auto mode applies the fix and keeps the original", async () => {
    const echat = createChat({ characterId: charId, personaId: createPersona({ name: "Ash" }) }).id;
    updateChat(echat, { settings: { editor: "every" } });
    setSetting("steer.config", { ...defaultSteer, editorApply: "auto" });
    const original = 'Mira laughs and pours the tea for the two of them. "Fine," Ash says, and drinks.';
    const m = addMessage(echat, "assistant", original, { name: "Mira" });
    await runEditorJob({ chatId: echat, messageId: m, swipeIdx: 0 });
    expect(getMessage(m)?.content).toBe("Mira laughs and pours the tea for the two of them.");
    expect((getMessage(m)?.meta.edit as { original: string }).original).toBe(original);
    setSetting("steer.config", defaultSteer);
  });
});

describe("summaries (SUM-10, SUM-11, SUM-17)", () => {
  test("compression and voice shape the prompts", () => {
    const names = { char: "Mira", user: "Ash" };
    expect(sceneSystem(names, { ...defaultMemoryConfig, compression: { ...defaultMemoryConfig.compression, scene: "tight" } })).toContain("(30–80 words)");
    expect(sceneSystem(names, defaultMemoryConfig)).toContain('"moments"');
    expect(sceneSystem(names, { ...defaultMemoryConfig, moments: false })).not.toContain('"moments"');
    expect(rollupSystem("story", names, { ...defaultMemoryConfig, compression: { ...defaultMemoryConfig.compression, story: "detailed" } })).toContain("about 1000 words");
    expect(voiceRule({ tense: "present", person: "third", register: "storybook" })).toContain("present tense, third person, like a storybook narrator");
  });
  test("dramatic moments survive into every level above", async () => {
    const schat = createChat({ characterId: charId }).id;
    const lines = [
      "We reach the lighthouse at dusk.",
      "I promise I will bring the brass lantern back before winter.",
      "***\nThe next scene starts on the stairs.",
      "The stairs creak under us.",
      "***\nMorning comes over the harbor.",
      "Gulls wheel over the boats.",
      "***\nNight again, by the lamp.",
      "The lamp hums.",
      "***\nThe last scene for now.",
      "Rain on the glass.",
      "One more line to settle the scene.",
    ];
    for (const [i, t] of lines.entries()) addMessage(schat, i % 2 ? "assistant" : "user", t, { name: i % 2 ? "Mira" : "Ash" });
    for (let round = 0; round < 10; round++) {
      await segmentChat(schat);
      let built = 0;
      for (const level of ["scene", "chapter", "arc"] as const)
        for (const r of levelRows(schat, level)) {
          if (!r.closed || r.state !== "pending") continue;
          if (level !== "scene" && !all<{ state: string }>("SELECT state FROM summaries WHERE chat_id = ? AND level = ? AND start_seq >= ? AND start_seq <= ?", schat, level === "chapter" ? "scene" : "chapter", r.start_seq, r.end_seq!).every((k) => k.state === "ready")) continue;
          await buildSummary(r.id);
          built++;
        }
      queueBuilds(schat);
      const story = storyRow(schat);
      if (story && storyNeedsRebuild(schat)) {
        await buildSummary(story.id);
        built++;
      }
      if (!built) break;
    }
    const scene = levelRows(schat, "scene").find((s) => JSON.parse(s.data).moments?.length);
    expect(JSON.parse(scene!.data).moments[0].tag).toBe("promise");
    expect(scene!.content).toContain("Turning points: [promise]");
    const chapter = levelRows(schat, "chapter").find((c) => c.state === "ready");
    expect(JSON.parse(chapter!.data).moments.map((m: { tag: string }) => m.tag)).toContain("promise");
    expect(carryMoments(levelRows(schat, "scene")).length).toBe(1);
  });
});

describe("recap and rebuild (SUM-15, SUM-19)", () => {
  test("the recap is cached until the story moves", async () => {
    const rchat = createChat({ characterId: charId }).id;
    for (let i = 0; i < 8; i++) addMessage(rchat, i % 2 ? "assistant" : "user", `Line ${i} about the tide.`, { name: i % 2 ? "Mira" : "Ash" });
    const a = await recapFor(rchat);
    expect(a.cached).toBe(false);
    expect((await recapFor(rchat)).cached).toBe(true);
    addMessage(rchat, "user", "And then the bell rang.", { name: "Ash" });
    expect((await recapFor(rchat)).cached).toBe(false);
    expect(await autoRecap(rchat, 60_000)).toBeNull();
    expect((await autoRecap(rchat, 7 * 3600_000))?.text).toContain("Previously");
  });
  test("an estimate before, progress during", () => {
    const e = rebuildEstimate(chatId);
    expect(e.messages).toBeGreaterThan(0);
    expect(e.inputTokens).toBeGreaterThan(e.storyTokens);
    const p = rebuildProgress(chatId);
    expect(p).toMatchObject({ paused: false });
  });
});
