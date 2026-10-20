import { beforeAll, describe, expect, test } from "bun:test";
import { actOnInbox, inboxItems } from "../src/accuracy/inbox";
import { all, run } from "../src/db/db";
import { runDetailsJob } from "../src/lore/details";
import { factsNow } from "../src/lore/facts";
import "../src/lore/keepupinbox";
import { getLorebook, linkLorebook } from "../src/lore/service";
import { onlyAdjectives, voiceProblems, voiceSlotValues } from "../src/lore/shapes";
import { addItem, commitDraft, createDraft, getDraft, patchItem, queueWrite, reviewDraft, runStudioJob, voiceOwner } from "../src/lore/studio";
import { voiceFacts, voiceLines } from "../src/lore/voice";
import { normalizeCard } from "../src/cards/card";
import { createCharacter } from "../src/services/characters";
import { createChat } from "../src/services/chats";
import { createConnection, createProfile, syncModels } from "../src/services/connections";
import { registerJob } from "../src/services/jobs";
import { freshDb } from "./helpers";

beforeAll(async () => {
  freshDb();
  for (const kind of ["lore.studio", "lore.embed", "lore.details", "memory.segment", "memory.build", "memory.embed", "quota.refresh", "cache.probe", "tracker.update", "tracker.init", "lore.keepup", "lore.chronicle", "accuracy.check"]) registerJob(kind, async () => {});
  const conn = createConnection({ name: "Mock", kind: "mock", billing: "subscription" });
  await syncModels(conn);
  createProfile({ name: "Story", connectionId: conn, modelId: "mock/storyteller", params: { context_target: 4000 } });
});

describe("4.1 the Voice entry", () => {
  test("sample lines must be speech, three or more", () => {
    expect(onlyAdjectives("warm, gruff and teasing")).toBe(true);
    expect(onlyAdjectives("calm: soft, measured, deliberate")).toBe(true);
    expect(onlyAdjectives("teasing: You'll want boots for that, little fish.")).toBe(false);
    expect(onlyAdjectives("Aye, lad.")).toBe(false);
    expect(onlyAdjectives("Get out!")).toBe(false);
    expect(voiceProblems({ "sample lines": ["a: Say it again.", "b: Sit with me.", "c: Off with you, then."] })).toEqual([]);
    expect(voiceProblems({ "sample lines": ["a: Say it again.", "warm, gruff and teasing"] })).toEqual([
      "Only 2 sample lines; three or more, in different moods, make the voice hold.",
      "“warm, gruff and teasing” describes the voice instead of using it. Write what they'd say.",
    ]);
    expect(voiceProblems({})[0]).toContain("No sample lines");
  });

  test("a voice's slots come out of its parts, one value each; nothing stays nothing", () => {
    expect(voiceSlotValues({ "pet names": ["love", "“little fish”", "love", "none"], catchphrases: ["Tides willing"], swearing: "none", greeting: "Oi, you", goodbye: "-", "never says": ["babe"], register: "plain" })).toEqual([
      { slot: "pet names", value: "love" },
      { slot: "pet names", value: "little fish" },
      { slot: "catchphrases", value: "Tides willing" },
      { slot: "swearing", value: "doesn't swear" },
      { slot: "greeting", value: "Oi, you" },
      { slot: "never says", value: "babe" },
    ]);
    expect(voiceOwner("Voice: Mira Vell")).toBe("Mira Vell");
    expect(voiceOwner("Mira Vell's voice")).toBe("Mira Vell");
  });
});

describe("4.2–4.3 a studio book's voices and people", () => {
  test("a Voice's slots are canon facts the re-anchor uses; every person gets a details job, and one Inbox card per book", async () => {
    const d = createDraft({ kind: "idea", text: "Mira Vell keeps the lighthouse at Port Ellis. Joss Arden hides in her oil store. Tam Reed rows the ferry.", options: { secrets: false } });
    const mira = addItem(d.id, { title: "Mira Vell", category: "character", pitch: "The keeper's daughter.", source: "Mira Vell has grey eyes and a temper." }).item;
    addItem(d.id, { title: "Joss Arden", category: "character", pitch: "A deserter." });
    addItem(d.id, { title: "Tam Reed", category: "character", pitch: "The ferryman." });
    const voice = addItem(d.id, { title: "Voice: Mira Vell", category: "voice", about: [mira.id] }).item;
    const loose = addItem(d.id, { title: "Voice: Tam Reed", category: "voice" }).item;
    queueWrite(d.id);
    await runStudioJob(d.id);
    const cur = getDraft(d.id)!;
    expect(cur.items.find((i) => i.id === voice.id)!.entry!.parts?.["pet names"]).toEqual(["pet names one", "pet names two"]);
    // Review: the mock's three sample lines pass; a flat one is flagged.
    expect(reviewDraft(d.id).issues[voice.id]?.filter((i) => i.kind === "voice") ?? []).toEqual([]);
    const e = cur.items.find((i) => i.id === loose.id)!.entry!;
    patchItem(d.id, loose.id, { entry: { ...e, parts: { ...e.parts, "sample lines": ["quiet, slow and gentle"] } } });
    expect(reviewDraft(d.id).issues[loose.id]!.filter((i) => i.kind === "voice")).toHaveLength(2);

    const { bookId } = commitDraft(d.id);
    const entries = getLorebook(bookId)!.entries;
    const saved = (title: string) => entries.find((x) => x.comment === title)!;
    expect(saved("Voice: Mira Vell").extra).toMatchObject({ entity: "Mira Vell" });
    // No subject picked: the title names whose voice it is.
    expect(saved("Voice: Tam Reed").extra).toMatchObject({ entity: "Tam Reed" });
    const facts = factsNow(saved("Voice: Mira Vell").id, null);
    expect(facts.every((f) => f.origin === "studio" && f.kind === "voice" && f.status === "active")).toBe(true);
    expect(facts.filter((f) => f.slot === "pet names").map((f) => f.value)).toEqual(["pet names one", "pet names two"]);

    // In a chat with the book, the re-anchor has her voice from the first message.
    const { data } = normalizeCard({ spec: "chara_card_v2", data: { name: "Mira Vell", description: "The keeper's daughter.", first_mes: "The lamp is lit." } });
    const characterId = createCharacter(data);
    linkLorebook(bookId, "character", characterId);
    const chatId = createChat({ characterId }).id;
    const lines = voiceLines(voiceFacts(chatId, "Mira Vell"), "Sam");
    expect(lines).toContain("Calls Sam: “pet names one” · “pet names two”");
    expect(lines.some((l) => l.startsWith("Says: “catchphrases one”"))).toBe(true);
    expect(lines.some((l) => l.startsWith("Greets with: “greeting of Voice”"))).toBe(true);

    // 4.3: one details job per person.
    const jobs = all<{ payload: string }>("SELECT payload FROM jobs WHERE kind = 'lore.details' AND status = 'queued'").map((j) => JSON.parse(j.payload) as { bookId: string; entryId?: string });
    const people = ["Mira Vell", "Joss Arden", "Tam Reed"].map((n) => saved(n).id);
    expect(jobs.map((j) => j.entryId).sort()).toEqual([...people].sort());
    // Run here, not by the queue (and leave nothing queued for later test files).
    run("DELETE FROM jobs WHERE kind = 'lore.details'");
    for (const j of jobs) await runDetailsJob(j);
    const hers = factsNow(saved("Mira Vell").id, null);
    // What her entry states is canon, from the studio; the gaps wait for a yes.
    expect(hers.find((f) => f.slot === "eyes")).toMatchObject({ value: "grey", origin: "studio", status: "active" });
    expect(hers.filter((f) => f.status === "invented").map((f) => f.slot)).toEqual(["birthday", "handedness"]);

    // One card for the book, a line per detail with whose it is.
    const cards = inboxItems().filter((i) => i.key.startsWith("lore-details:"));
    expect(cards.map((c) => c.key)).toEqual([`lore-details:${bookId}`]);
    expect(cards[0]!.title).toBe("Details drafted for 3 people");
    expect(cards[0]!.after).toContain("Mira Vell · Birthday: 19 January [likely, not confirmed]");
    const edited = cards[0]!.after!.replace("Mira Vell · Birthday: 19 January [likely, not confirmed]", "Mira Vell · Birthday: 2 March");
    actOnInbox(cards[0]!.key, "accept", edited);
    expect(factsNow(saved("Mira Vell").id, null).find((f) => f.slot === "birthday")).toMatchObject({ value: "2 March", status: "active" });
    expect(factsNow(saved("Tam Reed").id, null).find((f) => f.slot === "birthday")).toMatchObject({ value: "19 January", status: "active" });
    expect(inboxItems().some((i) => i.key.startsWith("lore-details:"))).toBe(false);
  });
});
