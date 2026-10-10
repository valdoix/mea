import { beforeAll, describe, expect, test } from "bun:test";
import { normalizeCard } from "../src/cards/card";
import { all, now, one, run } from "../src/db/db";
import { defaultMemoryConfig, getSetting, setSetting } from "../src/lib/settings";
import { createAtom, getAtom, listAtoms, mergeAtoms, updateAtom } from "../src/memory/atoms";
import { acceptProposal, buildSummary, editSummary, storyNeedsRebuild } from "../src/memory/build";
import { chooseWindow, telescope } from "../src/memory/context";
import { embedChat } from "../src/memory/embed";
import { memoryOverview } from "../src/memory/inspect";
import { endSceneAfter, queueBuilds, segmentChat } from "../src/memory/scheduler";
import { detectBoundary } from "../src/memory/segment";
import { getSummary, levelRows, memState, storyRow } from "../src/memory/store";
import { cleanText, ftsQuery } from "../src/memory/text";
import { toAnthropic } from "../src/providers/anthropic";
import { classifyError, contextLimitFromError } from "../src/providers/types";
import { createCharacter } from "../src/services/characters";
import { addMessage, createChat, editMessage, onLedgerEdit } from "../src/services/chats";
import { createConnection, createProfile, syncModels } from "../src/services/connections";
import { previewPrompt } from "../src/services/generation";
import { registerJob } from "../src/services/jobs";
import { decryptBackup, encryptBackup } from "../src/services/mirror";
import { assertQuota, calibrate, quotaPlanner, quotaState, shouldShed } from "../src/services/quota";
import { onLedgerChange } from "../src/memory/scheduler";
import { linesToOps, writeEvents } from "../src/trackers/store";
import { freshDb } from "./helpers";

describe("scene-break heuristics (MEM-03)", () => {
  const prev = { seq: 1, content: "She smiles.", createdAt: 0 };
  const at = (content: string, createdAt = 1000) => detectBoundary(prev, { seq: 2, content, createdAt }, { pauseHours: 6 });

  test("strong signals", () => {
    expect(at("***\nThe harbor was quiet.")?.strength).toBe("strong");
    expect(at("*Three days later,* the letter arrived.")).toMatchObject({ kind: "timeskip", strength: "strong" });
    expect(at("The next morning, Mira opened the shutters.")).toMatchObject({ kind: "timeskip", strength: "strong" });
    expect(at("Chapter 2\n\nRain.")).toMatchObject({ kind: "chapter", strength: "strong" });
  });

  test("weak and non-signals", () => {
    expect(at('"I\'ll see you the next morning," she said.')?.strength).toBe("weak");
    expect(at("Two hours later, the tea was cold.")).toMatchObject({ kind: "timeskip", strength: "weak" });
    expect(at("She laughs and pours more tea.")).toBeNull();
    expect(at("Hello again.", 7 * 3_600_000)).toMatchObject({ kind: "pause", strength: "weak" });
  });
});

describe("text helpers", () => {
  test("cleanText strips reasoning, details, markup", () => {
    expect(cleanText("<think>plan</think>Hi <b>there</b><details><summary>x</summary>stats</details>")).toBe("Hi there");
  });
  test("ftsQuery drops stop words and quotes terms", () => {
    expect(ftsQuery("The lantern was her mother's lantern")).toBe('"lantern" OR "mother"');
  });
});

describe("chunked eviction (CTX-05)", () => {
  const msgs = Array.from({ length: 20 }, (_, i) => ({ seq: i + 1, tokens: 100 }));
  const boundaries = [6, 11, 16].map((seq) => ({ seq, safe: true }));

  test("keeps the window while it fits", () => {
    expect(chooseWindow({ msgs, boundaries, evicted: 0, budget: 2500, lowWater: 0.7 })).toMatchObject({ evicted: 0, moved: "kept" });
  });
  test("evicts whole scenes down to the low-water mark", () => {
    const w = chooseWindow({ msgs, boundaries, evicted: 0, budget: 1500, lowWater: 0.7 });
    expect(w).toMatchObject({ evicted: 10, moved: "advanced", unsafe: false });
  });
  test("prefers summarized scenes; evicts unsummarized ones only when it must", () => {
    const unsafe = [6, 11, 16].map((seq) => ({ seq, safe: seq <= 6 }));
    const w = chooseWindow({ msgs, boundaries: unsafe, evicted: 0, budget: 1400, lowWater: 0.7 });
    expect(w).toMatchObject({ evicted: 10, unsafe: true });
    const w2 = chooseWindow({ msgs, boundaries: unsafe, evicted: 0, budget: 1600, lowWater: 0.7 });
    expect(w2).toMatchObject({ evicted: 5, unsafe: false });
  });
  test("restores older scenes when there's room again", () => {
    expect(chooseWindow({ msgs, boundaries, evicted: 15, budget: 5000, lowWater: 0.7 })).toMatchObject({ evicted: 0, moved: "restored" });
  });
});

describe("providers", () => {
  test("error classification and learned limits (CTX-03, CTX-08)", () => {
    expect(classifyError(400, "This model's maximum context length is 131072 tokens")).toBe("overflow");
    expect(contextLimitFromError("This model's maximum context length is 131,072 tokens")).toBe(131072);
    expect(classifyError(429, "weekly limit reached for your subscription")).toBe("quota");
    expect(classifyError(503, "upstream")).toBe("server");
  });

  test("Anthropic conversion with cache breakpoints (CONN-23, CONN-12)", () => {
    const { system, messages } = toAnthropic({
      model: "claude",
      params: {},
      signal: new AbortController().signal,
      messages: [
        { role: "system", content: "rules + card + story so far" },
        { role: "assistant", content: "Greeting" },
        { role: "user", content: "Hi" },
        { role: "assistant", content: "Hello" },
        { role: "system", content: "[Memory notes]" },
        { role: "user", content: "Latest" },
      ],
      cache: { mode: "anthropic", ttl: "5m", prefixEnd: 0, historyEnd: 3 },
    });
    expect(system[0]!.cache_control).toEqual({ type: "ephemeral" });
    expect(messages[0]!.role).toBe("user");
    // the system note merges into the final user turn
    expect(messages.at(-1)!.content.map((b) => b.text)).toEqual(["[Memory notes]", "Latest"]);
    const marked = messages.findIndex((m) => m.content.some((b) => b.cache_control));
    expect(messages[marked]!.content.at(-1)!.text).toBe("Hello");
  });
});

describe("quota (CONN-19, CONN-20, CONN-22)", () => {
  beforeAll(() => freshDb());
  const quota = (used: number) => ({ active: true, daily: null, weekly: { used, limit: 1000, remaining: 1000 - used, percentUsed: null, resetAt: now() + 3 * 86400_000 }, recommendedMode: null, fetchedAt: now() });

  test("sheds optional helpers in order and stops at zero", () => {
    setSetting("quota.cache", quota(500));
    expect(quotaState().shed).toEqual([]);
    setSetting("quota.cache", quota(950));
    expect(shouldShed("gates")).toBe(true);
    expect(shouldShed("verification")).toBe(false);
    setSetting("quota.cache", quota(985));
    expect(shouldShed("verification")).toBe(true);
    setSetting("quota.cache", quota(1000));
    expect(() => assertQuota("subscription")).toThrow(/quota is used up/);
    expect(() => assertQuota("paygo")).not.toThrow();
    setSetting("quota.cache", null);
  });

  test("calibrates how much cached input counts", () => {
    const t = now();
    run(
      "INSERT INTO generations (id, kind, task, billing, prompt_tokens, cached_tokens, status, started_at, finished_at) VALUES ('g1', 'new', 'story', 'subscription', 10000, 8000, 'done', ?, ?)",
      t - 500,
      t - 100,
    );
    calibrate(t - 1000, t, 2000 + 8000 * 0.5);
    expect(getSetting("quota.calibration").cachedWeight).toBe(0.5);
  });

  test("planner estimates turns per day before there's data", () => {
    setSetting("quota.cache", { ...quota(0), weekly: { used: 0, limit: 60_000_000, remaining: 60_000_000, percentUsed: 0, resetAt: now() + 86400_000 } });
    const p = quotaPlanner();
    expect(p.measured).toBe(false);
    expect(p.turnsPerDay).toBeGreaterThan(50);
    setSetting("quota.cache", null);
  });
});

describe("backup mirror encryption (DATA-08)", () => {
  test("round trip, wrong passphrase fails", () => {
    const data = Buffer.from("SQLite format 3\u0000 pretend database");
    const enc = encryptBackup(data, "correct horse");
    expect(decryptBackup(enc, "correct horse").equals(data)).toBe(true);
    expect(() => decryptBackup(enc, "wrong")).toThrow();
  });
});

describe("memory pipeline with the mock provider", () => {
  let chatId = "";
  const messageIds: string[] = [];

  /** Runs segmentation and builds until nothing is left to do (what the job queue does in the app). */
  async function drain() {
    for (let round = 0; round < 12; round++) {
      await segmentChat(chatId);
      let built = 0;
      for (const level of ["scene", "chapter", "arc"] as const) {
        for (const r of levelRows(chatId, level)) {
          if (!r.closed || !(r.state === "pending" || r.state === "stale")) continue;
          if (level !== "scene") {
            const kids = all<{ state: string }>("SELECT state FROM summaries WHERE chat_id = ? AND level = ? AND start_seq >= ? AND start_seq <= ?", chatId, level === "chapter" ? "scene" : "chapter", r.start_seq, r.end_seq!);
            if (!kids.every((k) => k.state === "ready")) continue;
          }
          await buildSummary(r.id);
          built++;
        }
      }
      queueBuilds(chatId);
      const story = storyRow(chatId);
      if (story && storyNeedsRebuild(chatId)) {
        await buildSummary(story.id);
        built++;
      }
      if (!built) return;
    }
  }

  beforeAll(async () => {
    freshDb();
    for (const kind of ["memory.segment", "memory.build", "memory.embed", "quota.refresh", "cache.probe"]) registerJob(kind, async () => {});
    onLedgerEdit(onLedgerChange);
    const connId = createConnection({ name: "Mock", kind: "mock", billing: "subscription" });
    await syncModels(connId);
    createProfile({ name: "Story", connectionId: connId, modelId: "mock/storyteller", params: { context_target: 4000, max_tokens: 400 } });
    setSetting("routing.embeddings", { connectionId: connId, model: "mock/embed", dims: 64 });
    setSetting("memory.config", { ...defaultMemoryConfig, sceneTokenCap: 100_000, boundaryCheck: false, scenesPerChapter: 2, chaptersPerArc: 2, lag: 2 });
    const { data } = normalizeCard({ spec: "chara_card_v2", data: { name: "Mira", description: "Keeper of the lighthouse.", first_mes: "Welcome to the lighthouse, {{user}}." } });
    const charId = createCharacter(data);
    chatId = createChat({ characterId: charId }).id;
    const filler = "The sea rolls against the rocks while the lantern hums above them, warm and patient, and the gulls argue about nothing at all. ".repeat(4);
    for (let i = 0; i < 24; i++) {
      const skip = i > 0 && i % 4 === 0 ? "The next morning, " : "";
      const promise = i === 5 ? " Mira promises to fix the brass lantern before winter." : "";
      messageIds.push(addMessage(chatId, i % 2 ? "assistant" : "user", `${skip}Line ${i + 2}. ${filler}${promise}`, { name: i % 2 ? "Mira" : "You" }));
    }
  });

  test("segments at time skips, summarizes scenes, rolls up chapters, arcs, and the Story So Far", async () => {
    await drain();
    const scenes = levelRows(chatId, "scene");
    expect(scenes.length).toBeGreaterThanOrEqual(5);
    expect(scenes.filter((s) => s.closed).every((s) => s.state === "ready")).toBe(true);
    expect(scenes[1]!.boundary).toContain("timeskip");
    expect(levelRows(chatId, "chapter").length).toBeGreaterThanOrEqual(2);
    expect(levelRows(chatId, "chapter")[0]!.state).toBe("ready");
    expect(storyRow(chatId)?.state).toBe("ready");
    // the newest messages are never touched (SUM-06)
    const lastSeq = one<{ s: number }>("SELECT MAX(seq) AS s FROM messages WHERE chat_id = ?", chatId)!.s;
    expect(memState(chatId).segmentedThrough).toBe(lastSeq - 2);
  });

  test("atoms carry their sources (MEM-01, MEM-06)", () => {
    const { atoms, total } = listAtoms(chatId, { q: "lantern winter" });
    expect(total).toBeGreaterThan(0);
    const promise = atoms.find((a) => a.content.includes("promises"));
    expect(promise?.sources?.length).toBe(1);
    expect(promise?.importance).toBe(8);
  });

  test("embeddings are made once per text (PERF-07)", async () => {
    await embedChat(chatId);
    const n = one<{ n: number }>("SELECT COUNT(*) AS n FROM embeddings WHERE chat_id = ?", chatId)!.n;
    expect(n).toBeGreaterThan(5);
    await embedChat(chatId);
    expect(one<{ n: number }>("SELECT COUNT(*) AS n FROM generations WHERE task = 'embeddings'")!.n).toBe(1);
  });

  test("the prompt holds the telescope, recall, and a chunked window (MEM-02, MEM-11, CTX-05)", async () => {
    const p = await previewPrompt(chatId);
    const all = p.messages.map((m) => m.content).join("\n");
    expect(all).toContain("CANON 5 · story so far");
    // Mea's Charter states the canon order itself, so the separate rule isn't repeated.
    expect(all).toContain("What decides, highest first:");
    expect(all).not.toContain("Canon order.");
    expect(p.trace.memory?.evictedThrough).toBeGreaterThan(0);
    expect(p.trace.memory?.telescope.length).toBeGreaterThan(0);
    // nothing recalled from inside the verbatim window (MEM-13)
    const evicted = p.trace.memory!.evictedThrough;
    for (const r of p.trace.memory!.recall) if (r.ownerType === "memory") expect(getAtom(r.id)!.min_seq!).toBeLessThanOrEqual(evicted);
    expect(p.trace.budget.memory).toBeGreaterThan(0);
    expect(p.cacheMarks.historyEnd).toBeGreaterThanOrEqual(p.cacheMarks.prefixEnd);
  });

  test("telescope folds old scenes into chapters to fit the budget", () => {
    const evicted = memState(chatId).segmentedThrough;
    const wide = telescope(chatId, evicted, 1_000_000);
    const tight = telescope(chatId, evicted, Math.floor(wide.tokens / 2));
    expect(wide.items.every((i) => i.level === "scene")).toBe(true);
    expect(tight.items.some((i) => i.level !== "scene")).toBe(true);
    expect(tight.tokens).toBeLessThan(wide.tokens);
  });

  test("pinned memories are always included (MEM-08)", async () => {
    const pinned = createAtom(chatId, { type: "fact", content: "Mira is allergic to roses.", pinned: true });
    const p = await previewPrompt(chatId);
    expect(p.messages[0]!.content).toContain("Mira is allergic to roses.");
    updateAtom(pinned.id, { pinned: false });
  });

  test("editing an old message makes its memory stale and rebuilds it (MEM-10)", async () => {
    const scene = levelRows(chatId, "scene")[1]!;
    const msg = one<{ id: string }>("SELECT id FROM messages WHERE chat_id = ? AND seq = ?", chatId, scene.start_seq)!;
    editMessage(msg.id, "The next morning, a stranger named Kael knocked on the door.");
    expect(getSummary(scene.id)!.state).toBe("stale");
    const chapter = levelRows(chatId, "chapter")[0]!;
    expect(getSummary(chapter.id)!.state).toBe("stale");
    await drain();
    expect(getSummary(scene.id)!.state).toBe("ready");
    expect(getSummary(scene.id)!.content).toContain("Kael");
    expect(listAtoms(chatId, { q: "Kael" }).total).toBeGreaterThan(0);
  });

  test("your summary edits are never overwritten: rebuilds wait as proposals (SUM-08)", async () => {
    const scene = levelRows(chatId, "scene")[0]!;
    editSummary(scene.id, { content: "My own words about the first scene." });
    await buildSummary(scene.id);
    const row = getSummary(scene.id)!;
    expect(row.state).toBe("review");
    expect(row.content).toBe("My own words about the first scene.");
    expect(acceptProposal(scene.id)).toBe(true);
    expect(getSummary(scene.id)!.content).not.toBe("My own words about the first scene.");
  });

  test("merging atoms supersedes the others (MEM-07)", () => {
    const a = createAtom(chatId, { type: "fact", content: "Mira's hair is long." });
    const b = createAtom(chatId, { type: "fact", content: "Mira keeps her hair braided." });
    const merged = mergeAtoms([a.id, b.id], "Mira's hair is long and braided.");
    expect(merged.content).toBe("Mira's hair is long and braided.");
    expect(getAtom(b.id)!.status).toBe("superseded");
    expect(getAtom(b.id)!.superseded_by).toBe(a.id);
  });

  test("manual scene breaks (MEM-04)", () => {
    const before = levelRows(chatId, "scene").length;
    const scene = levelRows(chatId, "scene")[0]!;
    const inside = one<{ id: string }>("SELECT id FROM messages WHERE chat_id = ? AND seq = ?", chatId, scene.start_seq + 1)!;
    endSceneAfter(chatId, inside.id);
    const scenes = levelRows(chatId, "scene");
    expect(scenes.length).toBe(before + 1);
    expect(scenes[1]!.manual).toBe(1);
    expect(scenes[0]!.state).toBe("stale");
  });

  test("overview reports coverage and stats (SUM-09)", () => {
    const o = memoryOverview(chatId);
    expect(o.coverage.some((c) => c.level === "story")).toBe(true);
    expect(o.stats.atoms).toBeGreaterThan(0);
    expect(o.embeddings.enabled).toBe(true);
  });
});

describe("memory scenes follow the scene tracker", () => {
  test("a new scene the tracker recorded opens a memory scene", async () => {
    freshDb();
    for (const kind of ["memory.segment", "memory.build", "memory.embed", "quota.refresh", "cache.probe"]) registerJob(kind, async () => {});
    setSetting("memory.config", { ...defaultMemoryConfig, sceneTokenCap: 100_000, boundaryCheck: false, lag: 1 });
    const { data } = normalizeCard({ spec: "chara_card_v2", data: { name: "Mira", description: "Keeper.", first_mes: "Hello." } });
    const chatId = createChat({ characterId: createCharacter(data) }).id;
    const ids: string[] = [];
    for (let i = 0; i < 8; i++) ids.push(addMessage(chatId, i % 2 ? "assistant" : "user", `Line ${i}. The lamp hums and the sea is calm.`, { name: i % 2 ? "Mira" : "You" }));
    // The first title isn't a break; the change at message 4 is.
    writeEvents(chatId, { messageId: ids[1]!, swipeIdx: -1 }, linesToOps(["scene: Tea in the lamp room"]).ops, "model");
    writeEvents(chatId, { messageId: ids[4]!, swipeIdx: -1 }, linesToOps(["scene: Down at the harbor"]).ops, "model");
    await segmentChat(chatId);
    const scenes = levelRows(chatId, "scene");
    expect(scenes.length).toBe(2);
    expect(scenes[1]!.boundary).toContain("tracker");
    expect(scenes[1]!.boundary).toContain("harbor");
  });
});
