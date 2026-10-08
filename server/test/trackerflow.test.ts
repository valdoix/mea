import { beforeAll, describe, expect, test } from "bun:test";
import { normalizeCard } from "../src/cards/card";
import { all, one } from "../src/db/db";
import { type MeaEvent, subscribe } from "../src/lib/events";
import { setSetting } from "../src/lib/settings";
import { createCharacter } from "../src/services/characters";
import { addMessage, createChat, editMessage, getMessageRow, onLedgerEdit, setActiveSwipe, softDeleteMessage, updateChat } from "../src/services/chats";
import { createConnection, createProfile, syncModels } from "../src/services/connections";
import { prepare, startStory } from "../src/services/generation";
import { registerJob } from "../src/services/jobs";
import { evalCondition } from "../src/trackers/condition";
import { onTrackerUpdate, runTrackerInit, runTrackerUpdate, timeskip, trackerLedgerHook, userEdit } from "../src/trackers/service";
import { worldAfterReply, worldLane, worldView } from "../src/sim/service";
import { currentFold, linesToOps } from "../src/trackers/store";
import { freshDb } from "./helpers";

function waitFor(pred: (e: MeaEvent) => boolean, timeout = 5000) {
  return new Promise<MeaEvent>((resolve, reject) => {
    const t = setTimeout(() => {
      off();
      reject(new Error("timeout waiting for event"));
    }, timeout);
    const off = subscribe((e) => {
      if (pred(e)) {
        clearTimeout(t);
        off();
        resolve(e);
      }
    });
  });
}

let chatId = "";

/** Runs the tracker jobs the app's queue would (tests don't start the queue). */
async function drainTrackers() {
  for (let i = 0; i < 6; i++) {
    const jobs = all<{ id: string; kind: string; payload: string }>("SELECT id, kind, payload FROM jobs WHERE status = 'queued' AND kind LIKE 'tracker.%' ORDER BY created_at");
    if (!jobs.length) return;
    for (const j of jobs) {
      const p = JSON.parse(j.payload);
      if (j.kind === "tracker.init") await runTrackerInit(p);
      else await runTrackerUpdate(p);
      one("UPDATE jobs SET status = 'done' WHERE id = ?", j.id);
    }
  }
}

async function reply(content: string) {
  addMessage(chatId, "user", content, { name: "Alex" });
  const ended = waitFor((e) => e.type === "gen.end");
  const r = await startStory(chatId, "new");
  await ended;
  return r;
}

beforeAll(async () => {
  freshDb();
  for (const kind of ["memory.segment", "memory.build", "memory.embed", "quota.refresh", "cache.probe"]) registerJob(kind, async () => {});
  onLedgerEdit(trackerLedgerHook);
  onTrackerUpdate(worldAfterReply);
  const connId = createConnection({ name: "Mock", kind: "mock", billing: "subscription" });
  await syncModels(connId);
  createProfile({ name: "Story", connectionId: connId, modelId: "mock/storyteller", params: { context_target: 8000, max_tokens: 400 } });
  setSetting("chat.cutoff", "off");
  const { data } = normalizeCard({ spec: "chara_card_v2", data: { name: "Mira", description: "Keeper of the lighthouse, with green eyes.", first_mes: "The lamp flickers. Mira looks up." } });
  chatId = createChat({ characterId: createCharacter(data) }).id;
});

describe("trackers end to end (mock)", () => {
  test("the starting state comes from the card (TRK-09)", async () => {
    await runTrackerInit({ chatId });
    const st = currentFold(chatId).result.state;
    expect(st.place.at(-1)).toBe("Lamp room");
    expect(st.chars.mira!.mood?.name).toBe("relieved");
    expect(st.chars.mira!.traits.some((t) => t.text === "green eyes")).toBe(true);
    expect(st.threads["the-keepers-logbook"]).toBeTruthy();
  });

  test("a reply is read after it's written; chips land on the message", async () => {
    const r = await reply("Thank you for the tea. I brought your locket back.");
    await drainTrackers();
    const fold = currentFold(chatId).result;
    const chips = fold.changes[r.messageId] ?? [];
    expect(chips.some((c) => c.kind === "clock")).toBe(true);
    expect(chips.some((c) => c.kind === "bond" && c.text.includes("Trust +1"))).toBe(true);
    expect(fold.state.bonds["mira>user"]!.axes.trust).toBe(1);
  });

  test("the prompt carries the story state, and a swipe's prompt doesn't see its own old lines (TRK-04)", async () => {
    const last = one<{ id: string }>("SELECT id FROM messages WHERE chat_id = ? AND role = 'assistant' ORDER BY seq DESC LIMIT 1", chatId)!;
    const p = await prepare(chatId, "story");
    expect(p.assembled.messages.some((m) => m.content.includes("[Story state"))).toBe(true);
    const swipe = await prepare(chatId, "story", { excludeMessageId: last.id });
    const note = swipe.assembled.messages.find((m) => m.content.includes("[Story state"))?.content ?? "";
    expect(note).not.toContain("trust");
    expect(p.trackers?.tokens).toBeGreaterThan(0);
  });

  test("swiping switches state; deleting rolls it back", async () => {
    const before = currentFold(chatId).result.state.bonds["mira>user"]?.axes.trust;
    const r = await reply("I promise I'll come back tomorrow. Thank you.");
    await drainTrackers();
    expect(currentFold(chatId).result.state.bonds["mira>user"]!.axes.trust).toBe((before ?? 0) + 1);
    const ended = waitFor((e) => e.type === "gen.end");
    await startStory(chatId, "swipe", { messageId: r.messageId });
    await ended;
    // The new swipe has no lines yet: the trust from the old swipe no longer counts.
    expect(currentFold(chatId).result.state.bonds["mira>user"]!.axes.trust).toBe(before);
    setActiveSwipe(r.messageId, 0);
    expect(currentFold(chatId).result.state.bonds["mira>user"]!.axes.trust).toBe((before ?? 0) + 1);
    softDeleteMessage(r.messageId);
    expect(currentFold(chatId).result.state.bonds["mira>user"]!.axes.trust).toBe(before);
  });

  test("an edited reply is read again", async () => {
    const r = await reply("Hello again.");
    await drainTrackers();
    await Bun.sleep(1100);
    editMessage(r.messageId, "Mira hands back the locket. MOCK_EDITED");
    expect(one("SELECT 1 FROM jobs WHERE kind = 'tracker.update' AND status = 'queued'")).toBeTruthy();
    await drainTrackers();
    expect(getMessageRow(r.messageId)).toBeTruthy();
  });

  test("your edits and locks hold (TRK-05)", async () => {
    userEdit(chatId, linesToOps(["mood Mira: furious", "lock chars.mira.mood: on"]).ops);
    expect(currentFold(chatId).result.state.chars.mira!.mood?.name).toBe("furious");
    await reply("Shall we light the lamp?");
    await drainTrackers();
    expect(currentFold(chatId).result.state.chars.mira!.mood?.name).toBe("furious");
  });

  test("tracker conditions (TRK-12)", () => {
    const st = currentFold(chatId).result.state;
    expect(evalCondition(st, "mood Mira = furious")).toBe(true);
    expect(evalCondition(st, "location contains lamp room")).toBe(true);
    expect(evalCondition(st, "bond Mira>You trust >= 1 and present contains Mira")).toBe(true);
    expect(evalCondition(st, "bond Mira>You trust >= 6")).toBe(false);
  });

  test("timeskip moves the clock and adds a marker (TRK-10)", () => {
    const before = currentFold(chatId).result.state.time!.minutes;
    const r = timeskip(chatId, "3 days");
    const st = currentFold(chatId).result.state;
    expect(st.time!.minutes - before).toBe(3 * 1440);
    expect(getMessageRow(r.messageId)!.role).toBe("system");
  });

  test("the world ticks once the clock has moved (sim)", () => {
    const st = currentFold(chatId).result.state;
    expect(st.sim.lastTickAt).not.toBeNull();
    expect(st.sim.tension.length).toBeGreaterThan(0);
    const v = worldView(chatId);
    expect(v.sky?.line).toContain("SKY:");
    expect(worldLane(chatId)).toContain("SKY:");
    expect(v.people.some((p) => p.name === "Mira")).toBe(true);
  });

  test("inline mode: the ledger comes out of the reply and is filed", async () => {
    updateChat(chatId, { settings: { trackers: { mode: "inline" } } });
    const r = await reply("Tell me about the storm.");
    const msg = one<{ content: string; meta: string }>("SELECT s.content, s.meta FROM swipes s JOIN messages m ON m.id = s.message_id WHERE m.id = ? AND s.idx = m.active_swipe", r.messageId)!;
    expect(msg.content).not.toContain("<ledger>");
    expect(JSON.parse(msg.meta).ledger).toContain("clock: +6m");
    expect((currentFold(chatId).result.changes[r.messageId] ?? []).some((c) => c.source === "inline")).toBe(true);
  });
});
