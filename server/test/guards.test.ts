import { beforeAll, describe, expect, test } from "bun:test";
import { anchorExtra, buildAnchor } from "../src/accuracy/anchor";
import { checkReply, flagsFor, recordTimeline } from "../src/accuracy/checker";
import { checkDrift, driftState, spokenPart, styleDistance, styleStats, voiceSamples } from "../src/accuracy/drift";
import { applyGuards, guardIssues, puppetHits, tenseOf, trimPuppeting, voiceOf } from "../src/accuracy/guards";
import { actOnInbox, inboxItems } from "../src/accuracy/inbox";
import { fixNames, nameRegistry, nameSlips } from "../src/accuracy/names";
import { timelineIssues } from "../src/accuracy/timeline";
import { normalizeCard } from "../src/cards/card";
import { all, newId, now, one, run } from "../src/db/db";
import { defaultGuards, defaultMemoryConfig, setSetting } from "../src/lib/settings";
import { createLorebook } from "../src/lore/service";
import { defaultEntry } from "../src/lore/types";
import { insertAtom } from "../src/memory/atoms";
import { createCharacter } from "../src/services/characters";
import { patchCharacterSettings } from "../src/services/charsettings";
import { addMessage, createChat, getMessage, updateChat } from "../src/services/chats";
import { createConnection, createProfile, syncModels } from "../src/services/connections";
import { previewPrompt } from "../src/services/generation";
import { personaFix } from "../src/steer/editor";
import { registerJob } from "../src/services/jobs";
import { createPersona } from "../src/services/personas";
import { linesToOps, writeEvents } from "../src/trackers/store";
import { freshDb } from "./helpers";

let chatId = "";
let charId = "";
const PAST = [
  'Mira set the kettle on the stove and turned to the window. "Storm\'s coming," she said, and pulled the shutters closed.',
  'She lit the lamp and carried it to the table. Alex watched her work. "Sit," she said. "You look half drowned."',
  'Mira laughed and shook her head. The wind rattled the glass. "Tea first. Questions after," she told Alex, and poured.',
  'She wrapped her hands around the cup and looked at the fire. "My father kept this light for thirty years," she said.',
];

beforeAll(async () => {
  freshDb();
  for (const kind of ["memory.segment", "memory.build", "memory.embed", "memory.journal", "memory.consolidate", "lore.chronicle", "accuracy.check", "accuracy.drift", "quota.refresh", "cache.probe"]) registerJob(kind, async () => {});
  const connId = createConnection({ name: "Mock", kind: "mock", billing: "subscription" });
  await syncModels(connId);
  createProfile({ name: "Story", connectionId: connId, modelId: "mock/storyteller", params: { context_target: 6000, max_tokens: 400 } });
  setSetting("memory.config", { ...defaultMemoryConfig, boundaryCheck: false, checkerModel: false });
  const { data } = normalizeCard({
    spec: "chara_card_v2",
    data: {
      name: "Mira",
      description: "Mira keeps the lighthouse at Port Ellis.",
      personality: "Dry, warm, stubborn. Talks in short sentences. Never wastes a word.",
      first_mes: "The lamp is lit.",
      mes_example: "<START>\n{{user}}: Are you alone out here?\n{{char}}: Mostly. The gulls don't count. Neither do you, yet.\n{{char}}: Tea's on. Don't touch the lens.\n<START>\n{{char}}: Storm's three hours out. Maybe two. I've seen worse.\n{{char}}: You're dripping on my floor. Sit.",
    },
  });
  charId = createCharacter(data);
  const persona = createPersona({ name: "Alex" });
  chatId = createChat({ characterId: charId, personaId: persona }).id;
  for (const [i, t] of PAST.entries()) {
    addMessage(chatId, "user", `I knock on the door, line ${i}.`, { name: "Alex" });
    addMessage(chatId, "assistant", t, { name: "Mira" });
  }
});

describe("puppeting, point of view and tense (CON-04)", () => {
  test("finds the user's words and actions in the narration, not in dialogue", () => {
    expect(puppetHits('"Fine," Alex says, and sits down.', ["Alex"], { second: true })[0]?.speech).toBe(true);
    expect(puppetHits("You nod and take her hand.", ["Alex"], { second: true })[0]?.speech).toBe(false);
    expect(puppetHits('"You said you would come," she whispers.', ["Alex"], { second: true })).toHaveLength(0);
    expect(puppetHits("Alex: Thanks for the tea.", ["Alex"], { second: false })[0]?.speech).toBe(true);
    expect(puppetHits("She waits for you to answer.", ["Alex"], { second: true })).toHaveLength(0);
    // An out-of-character aside isn't the story writing for you.
    expect(puppetHits('(You said: "I shake the rain off my coat.")', ["Alex"], { second: true })).toHaveLength(0);
  });
  test("mentions of the persona and earlier lines aren't puppeting", () => {
    const quiet = (t: string, names = ["James"]) => expect(puppetHits(t, names, { second: true })).toHaveLength(0);
    // Reported speech inside a quote that runs over several sentences.
    quiet('"I don\'t believe it. That\'s what James said." Mira folds her arms.');
    quiet("“Fine. Whatever. That’s what James said, anyway.” She shrugs.");
    // A quote opened and left running to the end of the paragraph.
    quiet('Mira turns. "I heard you. James said it twice already.\nShe sighs.');
    // Narration that mentions or recalls what the persona said or did.
    quiet("That's what James said, and Mira hasn't forgotten it.");
    quiet("Mira remembers James said he'd be back by dawn.");
    quiet("She knew that James asked for this.");
    quiet("As you said, the road is closed.");
    quiet("When you said that, something in her chest went tight.");
    quiet("Did James say where he was going?");
    quiet("She waits to see if James nods.");
    quiet("Mira won't move until you answer.");
    quiet("It was everything James promised.");
    quiet("James had said as much the night before.");
  });
  test("still flags the persona's own new words and actions", () => {
    const hit = (t: string, speech: boolean) => expect(puppetHits(t, ["James"], { second: true })[0]?.speech).toBe(speech);
    hit('"I don\'t know. Maybe." James says, and looks away.', true);
    hit('Mira smiles. "Then come." James nods and follows her out.', false);
    hit("When James finally nods, she leads him upstairs.", false);
    hit("As you step inside, the door clicks shut.", false);
    hit("James: I'll stay.", true);
  });
  test("trims only when the slip is late in the reply", () => {
    const text = "Mira sets down the lamp and studies the storm through the glass for a long moment, saying nothing at all. Then she turns. Alex nods and follows her up the stairs.";
    const cut = trimPuppeting(text, puppetHits(text, ["Alex"], { second: true }));
    expect(cut?.text).toBe("Mira sets down the lamp and studies the storm through the glass for a long moment, saying nothing at all. Then she turns.");
    expect(trimPuppeting("Alex nods. Mira smiles and pours the tea, humming an old harbor song under her breath.", puppetHits("Alex nods.", ["Alex"], { second: true }))).toBeNull();
  });
  test("reads the narrator and the tense", () => {
    expect(voiceOf(PAST.join(" "), ["Mira"], ["Alex"]).narrator).toBe("third");
    expect(voiceOf("I set the kettle down. My hands shake. I look at the door and I wait for my heart to slow.", ["Mira"], ["Alex"]).narrator).toBe("first");
    expect(tenseOf(PAST.join(" "), ["Mira"]).tense).toBe("past");
    expect(tenseOf("She sets the kettle down. She turns. She smiles and she pours. Mira laughs. She looks at the fire.", ["Mira"]).tense).toBe("present");
  });
  test("a present-tense scene that remembers isn't switching tense", () => {
    const text =
      "Mira sets the kettle down. She remembers how he left that night. She turns to the window. Years ago she stood here and waited. She pours the tea. Back then she was braver. She looks at the door. She had wanted to follow him. Mira laughs at herself. Last winter he came back once. She sits by the fire.";
    const t = tenseOf(text, ["Mira"]);
    expect(t.tense).toBe("present");
    expect(t.past).toBe(0);
  });
  test("flags a switch against the recent replies", () => {
    const issues = guardIssues(chatId, "I set the kettle down and I look at you. My hands shake. I pour the tea, and I wait. I hate storms, I think.", { seq: 999 });
    const kinds = issues.map((i) => i.kind);
    expect(kinds).toContain("pov");
    expect(issues.find((i) => i.kind === "pov")?.conflict).toContain("third person");
    const tense = guardIssues(chatId, "Mira sets the cup down. She smiles at the fire. She pours more tea. She looks at the window. Mira laughs softly.", { seq: 999 });
    expect(tense.find((i) => i.kind === "tense")?.conflict).toContain("past tense");
    // The story settings win over the recent replies.
    updateChat(chatId, { settings: { story: { tense: "present" } } });
    expect(guardIssues(chatId, "Mira sets the cup down. She smiles at the fire. She pours more tea. She looks at the window. Mira laughs softly.", { seq: 999 }).some((i) => i.kind === "tense")).toBe(false);
    updateChat(chatId, { settings: { story: {} } });
  });
  test("puppeting becomes a note, a cut, or a retry", () => {
    const reply = "Mira sets down the lamp and studies the storm through the glass for a long while, saying nothing. Then she turns. \"Fine,\" Alex says, and follows her upstairs.";
    expect(guardIssues(chatId, reply, { seq: 999 }).find((i) => i.kind === "puppet")?.severity).toBe("major");
    expect(applyGuards(chatId, reply, { seq: 999, messageId: "x" }).text).toBe(reply);
    setSetting("guards.config", { ...defaultGuards, puppetAction: "trim" });
    const trimmed = applyGuards(chatId, reply, { seq: 999, messageId: "x" });
    expect(trimmed.text.endsWith("Then she turns.")).toBe(true);
    expect(trimmed.meta.trimmed).toContain("Alex says");
    setSetting("guards.config", { ...defaultGuards, puppetAction: "regenerate" });
    expect(applyGuards(chatId, reply, { seq: 999, messageId: "x" }).retry).toContain("Alex");
    setSetting("guards.config", defaultGuards);
  });
  test("puppet flags follow the Persona control, even ones already saved", async () => {
    const persona = (mode: string) => updateChat(chatId, { settings: { controls: { persona: mode } } });
    const words = 'Mira opens the door. "Fine," Alex says.';
    const acts = "Mira opens the door. Alex nods and follows her in.";
    persona("sealed");
    const id = addMessage(chatId, "assistant", acts, { name: "Mira" });
    await checkReply(chatId, id, 0, { model: false });
    const puppets = () => flagsFor(chatId, { messageIds: [id] })[0]?.issues.filter((i) => i.kind === "puppet") ?? [];
    expect(puppets()).toHaveLength(1);
    // Continuity may finish your actions: an actions-only flag hides, words still count.
    persona("continuity");
    expect(puppets()).toHaveLength(0);
    expect(flagsFor(chatId, { messageIds: [id], open: true }).length).toBe(0);
    expect(guardIssues(chatId, words, { seq: 999 }).find((i) => i.kind === "puppet")?.fix).toContain("finishing an action Alex began is fine");
    // Director and Full cast let the story write your character: nothing is flagged.
    for (const mode of ["director", "full_cast"]) {
      persona(mode);
      expect(guardIssues(chatId, words, { seq: 999 }).some((i) => i.kind === "puppet")).toBe(false);
      expect(puppets()).toHaveLength(0);
    }
    persona("sealed");
    expect(puppets()).toHaveLength(1);
    updateChat(chatId, { settings: { controls: {} } });
  });
  test("the editor's persona rule follows the Persona control", () => {
    expect(personaFix("Alex", null)).toContain("That's what Alex said");
    expect(personaFix("Alex", "continuity")).toContain("keep the plain finish of an action Alex began");
    expect(personaFix("Alex", "director")).toContain("allowed");
    expect(personaFix("Alex", "full_cast")).toContain("never cut or change Alex's words");
  });
});

describe("the name registry (CON-05)", () => {
  test("canonical names from the card, persona, lore and entities", () => {
    createLorebook({ name: "Port", entries: [defaultEntry({ comment: "Captain Harrow", keys: ["Harrow", "the harbor"], content: "The harbormaster." })], links: [{ target_type: "chat", target_id: chatId }] });
    const names = nameRegistry(chatId).map((n) => n.name);
    expect(names).toContain("Mira");
    expect(names).toContain("Alex");
    expect(names).toContain("Captain Harrow");
    expect(names).not.toContain("the harbor");
  });
  test("slips are found and fixed; common words and names the chat already uses are not", () => {
    const slips = nameSlips(chatId, "Mria laughs. Then Harow waves from the dock. Thomas waves too.");
    expect(slips.map((s) => s.word).sort()).toEqual(["Harow", "Mria"]);
    expect(slips.find((s) => s.word === "Harow")?.canonical).toBe("Harrow");
    expect(fixNames("Mria laughs at Mria.", slips).text).toBe("Mira laughs at Mira.");
    addMessage(chatId, "user", "Have you met Mara, my sister?", { name: "Alex" });
    expect(nameSlips(chatId, "Mara waves.").length).toBe(0);
  });
  test("fix mode corrects the stored reply", () => {
    setSetting("guards.config", { ...defaultGuards, names: "fix" });
    const r = applyGuards(chatId, "Mria pours the tea.", { seq: 999, messageId: "x" });
    expect(r.text).toBe("Mira pours the tea.");
    expect(r.meta.fixed).toEqual([{ from: "Mria", to: "Mira" }]);
    setSetting("guards.config", defaultGuards);
  });
});

describe("timeline sanity (CON-12)", () => {
  let tchat = "";
  const clockAt = (messageId: string | null, line: string) => writeEvents(tchat, { messageId, swipeIdx: -1 }, linesToOps([line]).ops, "model");
  beforeAll(() => {
    tchat = createChat({ characterId: charId }).id;
    clockAt(null, "clock: Day 1 10:00");
  });
  test("backwards, a silent jump, and a next day the clock didn't see", () => {
    const back = addMessage(tchat, "assistant", "Mira pours the tea and sits.", { name: "Mira" });
    clockAt(back, "clock: Day 1 08:00");
    expect(timelineIssues(tchat, back).map((i) => i.severity)).toEqual(["major"]);
    const jump = addMessage(tchat, "assistant", "Mira pours more tea.", { name: "Mira" });
    clockAt(jump, "clock: +2d");
    expect(timelineIssues(tchat, jump)[0]?.conflict).toContain("Nothing in the reply");
    const said = addMessage(tchat, "assistant", "The next morning, Mira opens the shutters.", { name: "Mira" });
    clockAt(said, "clock: +10m");
    const i = timelineIssues(tchat, said)[0];
    expect(i?.claim).toBe("The next morning");
    expect(i?.canon?.trackerLine).toMatch(/^clock: \+\d+m$/);
    const fine = addMessage(tchat, "assistant", "Days later, the storm finally breaks.", { name: "Mira" });
    clockAt(fine, "clock: +3d");
    expect(timelineIssues(tchat, fine)).toHaveLength(0);
  });
  test("a clock the prose reads aloud an hour off the story clock", () => {
    const chat = createChat({ characterId: charId }).id;
    const at = (messageId: string | null, line: string) => writeEvents(chat, { messageId, swipeIdx: -1 }, linesToOps([line]).ops, "model");
    at(null, "clock: 2001-10-11 17:20");
    const off = addMessage(chat, "assistant", "The clock somewhere in the house — Buffy can hear it now, faint, in the kitchen maybe — ticks toward 16:50. Sundown in forty minutes.", { name: "Mira" });
    at(off, "clock: +30m");
    const i = timelineIssues(chat, off)[0];
    expect(i?.claim).toBe("clock somewhere in the house — Buffy can hear it now, faint, in the kitchen maybe — ticks toward 16:50");
    expect(i?.conflict).toContain("16:50");
    expect(i?.fix).toContain("17:50");
    const near = addMessage(chat, "assistant", "The kitchen clock ticks past 18:02, and it's 6:05 by the time she sits.", { name: "Mira" });
    at(near, "clock: +15m");
    expect(timelineIssues(chat, near)).toHaveLength(0);
    const plan = addMessage(chat, "assistant", "They'll meet at 21:00, after the patrol. Her phone screen glows, the timer showing 03:41.", { name: "Mira" });
    at(plan, "clock: +5m");
    expect(timelineIssues(chat, plan)).toHaveLength(0);
  });
  test("lands in the reply's notes next to the other checks", async () => {
    const m = addMessage(tchat, "assistant", "Mira pours the tea and sits.", { name: "Mira" });
    clockAt(m, "clock: Day 1 06:00");
    recordTimeline(tchat, m);
    await checkReply(tchat, m, 0);
    const f = flagsFor(tchat, { messageIds: [m] })[0];
    expect(f?.issues.some((x) => x.kind === "timeline")).toBe(true);
  });
});

describe("the drift detector (CON-10) and the re-anchor (CON-03)", () => {
  test("style statistics tell a terse voice from a florid one", () => {
    const terse = styleStats(["Mostly. The gulls don't count.", "Tea's on. Don't touch the lens.", "Sit. You're dripping."]);
    const florid = styleStats(["Oh, my dearest friend, however shall I express the profound and immeasurable gratitude that fills my weary heart tonight!", "Indeed, it is certainly a most remarkable and extraordinary evening, is it not!"]);
    const d = styleDistance(terse, florid);
    expect(d.score).toBeGreaterThan(0.45);
    expect(d.reasons.join(" ")).toContain("more formal");
    expect(styleDistance(terse, terse).score).toBe(0);
    expect(spokenPart('*She smiles.* "Sit down." She waits. "Now."')).toBe("Sit down. Now.");
  });
  test("samples come from the voice lab and the card", () => {
    expect(voiceSamples(charId).source).toBe("examples");
    patchCharacterSettings(charId, { voice: { kept: [{ id: "v1", situation: "calm", cue: "", line: "Lamp's lit. Kettle's on. You're late." }] } });
    expect(voiceSamples(charId).source).toBe("both");
    expect(voiceSamples(charId).lines[0]).toBe("Lamp's lit. Kettle's on. You're late.");
  });
  test("a drifting voice is measured and strengthens the re-anchor", async () => {
    const dchat = createChat({ characterId: charId }).id;
    for (let i = 0; i < 8; i++)
      addMessage(dchat, "assistant", `"Oh, my dearest companion, however shall I possibly express the profound and immeasurable gratitude that fills my weary heart on this most remarkable evening, number ${i}! Indeed, it is certainly extraordinary!"`, { name: "Mira" });
    const r = await checkDrift(dchat);
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.reading.drifting).toBe(true);
    expect(driftState(dchat)?.drifting).toBe(true);
    // Auto mode: a short chat gets the re-anchor only because it's drifting, and a stronger one.
    const card = (await import("../src/services/characters")).getCard(charId)!;
    const a = anchorExtra(dchat, card, "Alex", charId);
    expect(a?.name).toContain("stronger");
    expect(a?.content).toContain("drifted");
    expect(a?.content).toContain("Lamp's lit");
  });
  test("auto, always and off", async () => {
    const card = (await import("../src/services/characters")).getCard(charId)!;
    const fresh = createChat({ characterId: charId }).id;
    expect(anchorExtra(fresh, card, "Alex", charId)).toBeNull();
    updateChat(fresh, { settings: { guards: { anchor: "always" } } });
    const a = anchorExtra(fresh, card, "Alex", charId);
    expect(a?.content).toContain("Who Mira is");
    expect(a?.content).toContain("never Alex's words");
    expect((await previewPrompt(fresh)).messages.some((m) => m.content.includes("Who Mira is"))).toBe(true);
    patchCharacterSettings(charId, { anchor: "Mira: a lighthouse keeper of few words." });
    expect(buildAnchor({ card, userName: "Alex", characterId: charId })).toContain("a lighthouse keeper of few words");
    updateChat(fresh, { settings: { guards: { anchor: "off" } } });
    expect(anchorExtra(fresh, card, "Alex", charId)).toBeNull();
  });
});

describe("the review inbox (CON-09)", () => {
  test("lists proposals across kinds and acts on them", () => {
    const ichat = createChat({ characterId: charId }).id;
    const mid = addMessage(ichat, "user", "We met at the harbor.", { name: "Alex" });
    run(
      "INSERT INTO chronicle_proposals (id, chat_id, entity_id, name, entry, status, created_at, updated_at) VALUES (?, ?, NULL, ?, ?, 'open', ?, ?)",
      "cp1",
      ichat,
      "The Gull Inn",
      JSON.stringify({ comment: "The Gull Inn", keys: ["Gull Inn"], content: "A tavern by the docks.", extra: {} }),
      now(),
      now(),
    );
    const disputed = insertAtom(ichat, null, { type: "fact", content: "Alex arrived by boat.", status: "disputed" }, [{ id: mid, seq: 1 }]);
    let items = inboxItems({ chatId: ichat });
    expect(items.map((i) => i.kind).sort()).toEqual(["chronicle", "disputed"]);
    actOnInbox("chronicle:cp1", "accept", "A tavern by the docks, run by Joss.");
    expect(one<{ status: string }>("SELECT status FROM chronicle_proposals WHERE id = 'cp1'")?.status).toBe("accepted");
    const entries = all<{ data: string }>("SELECT data FROM lorebook_entries").map((r) => JSON.parse(r.data).content);
    expect(entries).toContain("A tavern by the docks, run by Joss.");
    actOnInbox(`disputed:${disputed}`, "reject");
    items = inboxItems({ chatId: ichat });
    expect(items).toHaveLength(0);
  });
  test("a summary rebuild waiting for review", () => {
    const ichat = createChat({ characterId: charId }).id;
    const sid = newId();
    run(
      "INSERT INTO summaries (id, chat_id, level, start_seq, end_seq, closed, title, content, state, proposal, user_edited, created_at, updated_at) VALUES (?, ?, 'chapter', 1, 10, 1, 'Old', 'Your version.', 'review', ?, 1, ?, ?)",
      sid,
      ichat,
      JSON.stringify({ title: "New", content: "The rebuilt version.", data: {}, kind: "chapter", at: now() }),
      now(),
      now(),
    );
    const item = inboxItems({ chatId: ichat }).find((i) => i.kind === "summary");
    expect(item?.before).toBe("Your version.");
    expect(item?.after).toBe("The rebuilt version.");
    actOnInbox(item!.key, "reject");
    expect(one<{ content: string; proposal: string | null }>("SELECT content, proposal FROM summaries WHERE id = ?", sid)).toEqual({ content: "Your version.", proposal: null });
  });
});

describe("the checker keeps guard notes", () => {
  test("a puppeting reply gets a note even with the continuity checker off", async () => {
    setSetting("memory.config", { ...defaultMemoryConfig, continuity: false });
    const m = addMessage(chatId, "assistant", 'Mira sets the lamp down. "Fine," Alex says, and sits by the fire.', { name: "Mira" });
    await checkReply(chatId, m, 0);
    expect(flagsFor(chatId, { messageIds: [m] })[0]?.issues.map((i) => i.kind)).toContain("puppet");
    expect(getMessage(m)?.content).toContain("Alex says");
    setSetting("memory.config", { ...defaultMemoryConfig, boundaryCheck: false, checkerModel: false });
  });
});
