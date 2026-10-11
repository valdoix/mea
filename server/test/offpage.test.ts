import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { checkReply } from "../src/accuracy/checker";
import { fixIssueSentence } from "../src/accuracy/fixes";
import { actOnInbox, inboxItems } from "../src/accuracy/inbox";
import { createOffpage, hintAllowed, holdOffpage, listOffpage, neverSaid, offpageFilter, redact, runRewordJob, updateOffpage } from "../src/accuracy/offpage";
import { normalizeCard } from "../src/cards/card";
import { all, one, run } from "../src/db/db";
import { defaultMemoryConfig, setSetting } from "../src/lib/settings";
import { createLorebook } from "../src/lore/service";
import { defaultEntry } from "../src/lore/types";
import { applyChange, checkChanges, undoStep } from "../src/meus/changes";
import { createCharacter } from "../src/services/characters";
import { addMessage, createChat, getMessage } from "../src/services/chats";
import { createConnection, createProfile, syncModels } from "../src/services/connections";
import { previewPrompt } from "../src/services/generation";
import { pauseJobs, registerJob } from "../src/services/jobs";
import { statusTiles } from "../src/services/status";
import { freshDb } from "./helpers";

let chatId = "";
let secretId = "";

beforeAll(async () => {
  freshDb();
  pauseJobs(true);
  for (const kind of ["memory.segment", "memory.build", "memory.embed", "memory.journal", "accuracy.check", "quota.refresh", "cache.probe", "tracker.update", "lessons.learn", "offpage.reword"]) registerJob(kind, async () => {});
  const connId = createConnection({ name: "Mock", kind: "mock", billing: "subscription" });
  await syncModels(connId);
  createProfile({ name: "Story", connectionId: connId, modelId: "mock/storyteller", params: { context_target: 6000, max_tokens: 300 } });
  setSetting("memory.config", { ...defaultMemoryConfig, checkerModel: false });
  const { data } = normalizeCard({ spec: "chara_card_v2", data: { name: "Buffy", description: "The Slayer of Sunnydale.", first_mes: "The cemetery is quiet." } });
  chatId = createChat({ characterId: createCharacter(data) }).id;
  for (let i = 0; i < 4; i++) addMessage(chatId, i % 2 ? "assistant" : "user", `Line ${i}.`, { name: i % 2 ? "Buffy" : "Willow" });
  // A lore entry that states the secret plainly, always on.
  createLorebook({
    name: "Sunnydale",
    entries: [defaultEntry({ comment: "The Heaven secret", constant: true, keys: ["Buffy"], content: "Buffy was in Heaven. Willow pulled her out. The Scoobies don't know." })],
    links: [{ target_type: "chat", target_id: chatId }],
  });
});

afterAll(() => pauseJobs(false));

describe("secrets kept off the page (B1)", () => {
  test("a secret with never-say words and a hint", () => {
    const o = createOffpage(chatId, { label: "Buffy was in Heaven, not Hell.", neverSay: ["Heaven", "heaven", "paradise"], hintAs: "she flinches at sunlight", hints: "rarely" });
    secretId = o.id;
    expect(o.neverSay).toEqual(["Heaven", "paradise"]);
    expect(o.status).toBe("kept");
    expect(neverSaid("She remembers HEAVEN.", [o])).toHaveLength(1);
    expect(neverSaid("Heavenly music plays.", [o])).toHaveLength(0);
  });

  test("the rules leave out every sentence that names it", () => {
    const o = listOffpage(chatId)[0]!;
    expect(redact("Buffy was in Heaven. Willow pulled her out. The Scoobies don't know.", [o])).toBe("Willow pulled her out. The Scoobies don't know.");
  });

  test("lore that states it is reworded before the prompt, shown in the Inspector, and the helper is asked for next time", async () => {
    const p = await previewPrompt(chatId);
    const all_ = p.messages.map((m) => m.content).join("\n");
    expect(all_).toContain("Willow pulled her out.");
    // The lore's own sentence is gone (the [OFFPAGE] lane still names the secret to the model).
    expect(all_).not.toContain("Buffy was in Heaven. Willow");
    expect(p.trace.reworded?.[0]).toMatchObject({ where: "lore", by: "rules" });
    expect(all<{ kind: string }>("SELECT kind FROM jobs WHERE kind = 'offpage.reword'").length).toBeGreaterThan(0);
  });

  test("the helper's rewording is cached and used from then on", async () => {
    const job = one<{ payload: string }>("SELECT payload FROM jobs WHERE kind = 'offpage.reword' LIMIT 1")!;
    await runRewordJob(JSON.parse(job.payload));
    expect(one<{ n: number }>("SELECT COUNT(*) AS n FROM offpage_cache WHERE chat_id = ?", chatId)!.n).toBe(1);
    const p = await previewPrompt(chatId);
    expect(p.trace.reworded?.[0]?.by).toBe("model");
    expect(p.messages.map((m) => m.content).join("\n")).not.toContain("Buffy was in Heaven. Willow");
  });

  test("the [OFFPAGE] lane says what to keep back, and whether one hint is allowed", async () => {
    const p = await previewPrompt(chatId);
    const lane = p.trace.blocks.find((b) => b.lane === "offpage");
    expect(lane?.text).toContain("Buffy was in Heaven, not Hell.");
    expect(lane?.text).toContain('Never say: "Heaven", "paradise"');
    const o = listOffpage(chatId)[0]!;
    // "rarely": one hint every fifteen messages, the same for every swipe.
    const start = o.data.seq!;
    expect(hintAllowed(o, start + 15)).toBe(true);
    expect(hintAllowed(o, start + 16)).toBe(false);
    expect(hintAllowed({ ...o, hints: "never" }, start + 15)).toBe(false);
    expect(hintAllowed({ ...o, hints: "building" }, start + 10)).toBe(true);
  });

  test("a reply that says a never-say word is flagged, and the sentence can be reworded alone", async () => {
    const id = addMessage(chatId, "assistant", 'Buffy sits on the step. "I was in Heaven," she whispers. The night is cold.', { name: "Buffy" });
    const issues = (await checkReply(chatId, id, 0)) ?? [];
    const slip = issues.find((i) => i.kind === "offpage")!;
    expect(slip.conflict).toContain("kept off the page");
    expect(slip.citations[0]).toMatchObject({ type: "secret", id: secretId });
    const flag = one<{ id: string }>("SELECT id FROM continuity_flags WHERE message_id = ?", id)!;
    const r = await fixIssueSentence(flag.id, slip.id);
    const text = getMessage(id)!.content;
    expect(text.startsWith("Buffy sits on the step.")).toBe(true);
    expect(text.endsWith("The night is cold.")).toBe(true);
    expect(text).not.toContain("Heaven");
    expect(r.before).toContain("Heaven");
  });

  test("a reveal plan that comes due asks: Reveal now, or Hold", () => {
    const o = updateOffpage(secretId, { reveal: { when: "after", afterSeq: 2 } });
    expect(listOffpage(chatId)[0]!.due).toBe(true);
    const item = inboxItems({ chatId }).find((i) => i.key === `offpage:${o.id}`);
    expect(item).toMatchObject({ source: "secret", title: "A secret is ready to come out" });
    expect(statusTiles(chatId).find((t) => t.id === "offpage")).toMatchObject({ n: 1, tone: "amber" });
    // Hold: not due for ten messages.
    actOnInbox(item!.key, "reject");
    expect(listOffpage(chatId)[0]!.due).toBe(false);
    run("UPDATE secrets_offpage SET data = json_set(data, '$.heldUntil', 0) WHERE id = ?", secretId);
    actOnInbox(`offpage:${secretId}`, "accept");
    expect(listOffpage(chatId)[0]!.status).toBe("revealed");
    expect(offpageFilter(chatId)).toBeNull();
  });

  test("Hold on its own waits ten messages", () => {
    const o = createOffpage(chatId, { label: "Spike has a soul.", neverSay: ["soul"], reveal: { when: "after", afterSeq: 1 } });
    expect(listOffpage(chatId).find((x) => x.id === o.id)!.due).toBe(true);
    holdOffpage(o.id);
    expect(listOffpage(chatId).find((x) => x.id === o.id)!.due).toBe(false);
  });

  test("Meus can keep one off the page, and Undo takes it back", () => {
    const { changes } = checkChanges(chatId, [{ kind: "secret_offpage", label: "Dawn is the Key.", never_say: ["Key"], hint_as: "a green glow", hints: "building" }]);
    expect(changes[0]).toMatchObject({ kind: "secret_offpage", label: "Keep a secret off the page" });
    const steps = applyChange(chatId, { ...changes[0]!, id: "c1" });
    expect(listOffpage(chatId).some((o) => o.label === "Dawn is the Key.")).toBe(true);
    for (const s of steps.reverse()) undoStep(chatId, s);
    expect(listOffpage(chatId).some((o) => o.label === "Dawn is the Key.")).toBe(false);
  });
});
