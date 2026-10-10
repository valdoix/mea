import { beforeAll, describe, expect, test } from "bun:test";
import { normalizeCard } from "../src/cards/card";
import { all, newId, now, one, run } from "../src/db/db";
import { getEntityRow, resolver } from "../src/memory/entities";
import { buildBrief } from "../src/meus/brief";
import { applyChange, checkChanges, undoStep } from "../src/meus/changes";
import { applyMeus, meusTurn, meusView, undoMeus } from "../src/meus/meus";
import { createAtom, getAtom } from "../src/memory/atoms";
import { createLorebook } from "../src/lore/service";
import { createCharacter } from "../src/services/characters";
import { addMessage, createChat, getChat, getMessage, updateChat } from "../src/services/chats";
import { createConnection, createProfile, syncModels } from "../src/services/connections";
import { previewPrompt } from "../src/services/generation";
import { createPersona } from "../src/services/personas";
import { registerJob } from "../src/services/jobs";
import { formatStoryTime } from "../src/trackers/clock";
import { userEdit } from "../src/trackers/service";
import { currentFold, linesToOps } from "../src/trackers/store";
import { freshDb } from "./helpers";

let chatId = "";
const msgs: string[] = [];
const state = () => currentFold(chatId).result.state;
/** The #number of one of the messages added below (the greeting is #1). */
const seqOf = (i: number) => getMessage(msgs[i]!)!.seq;
const named = (name: string) => Object.values(state().chars).find((c) => c.name === name);

beforeAll(async () => {
  freshDb();
  for (const kind of ["memory.segment", "memory.build", "memory.embed", "quota.refresh", "cache.probe"]) registerJob(kind, async () => {});
  const conn = createConnection({ name: "Mock", kind: "mock", billing: "subscription" });
  await syncModels(conn);
  createProfile({ name: "Story", connectionId: conn, modelId: "mock/storyteller", params: { context_target: 8000 } });
  createPersona({ name: "Shauna", data: { description: "A goalkeeper with a temper." }, isDefault: true });
  const { data } = normalizeCard({ spec: "chara_card_v2", data: { name: "Jackie Taylor", description: "Team captain.", first_mes: "Jackie waves from the pitch." } });
  chatId = createChat({ characterId: createCharacter(data) }).id;
  msgs.push(addMessage(chatId, "user", "Shauna jogs over.", { name: "Shauna" }));
  msgs.push(addMessage(chatId, "assistant", "Jax grins. \"Captain's orders.\" The lake is cold this morning.", { name: "Jackie Taylor" }));
  msgs.push(addMessage(chatId, "user", "Shauna laughs.", { name: "Shauna" }));
  msgs.push(addMessage(chatId, "assistant", "Jackie Taylor tosses her the ball.", { name: "Jackie Taylor" }));
  userEdit(chatId, linesToOps(["clock: Day 1 09:15", "cast: Jackie Taylor@spot · Jax@spot", "mood Jax: calm → cheerful"]).ops);
});

describe("Meus in a chat", () => {
  test("the brief says who is who: the persona is the player's, the card is the character", () => {
    const b = buildBrief(chatId);
    expect(b.text).toContain("Shauna is the PLAYER'S PERSONA");
    expect(b.text).toContain("Jackie Taylor is the CHARACTER CARD");
    expect(b.text).toMatch(/- Shauna \[[^\]]+\] · the player's persona/);
    expect(b.text).toMatch(/- Jax \[[^\]]+\] · cast/);
    expect(b.header.time).toBe("Day 1 09:15");
  });

  test("an answer cites the story, and Meus can look people up first", async () => {
    const v = await meusTurn(chatId, "who is Jax?");
    const last = v.turns.at(-1)!;
    expect(last.reads).toEqual(["Person · Jax"]);
    expect(last.text).toContain("Person · Jax");
    expect(v.proposal).toBeNull();
  });

  test("merging two cast entries reaches the story, the cast and the Codex, and undo takes it back", async () => {
    // The Codex knows both names first.
    resolver(chatId);
    const jaxPage = one<{ id: string }>("SELECT id FROM entities WHERE chat_id = ? AND name = 'Jax'", chatId);
    expect(jaxPage).toBeTruthy();
    const v = await meusTurn(chatId, "merge Jax into Jackie Taylor");
    expect(v.proposal!.changes.map((c) => c.kind)).toEqual(["merge"]);
    const applied = applyMeus(chatId, v.proposal!.changes.map((c) => c.id));
    expect(applied.applied).toBe(1);
    expect(named("Jax")).toBeUndefined();
    expect(named("Jackie Taylor")!.aliases).toContain("Jax");
    expect(getEntityRow(jaxPage!.id)!.merged_into).toBeTruthy();

    undoMeus(chatId, applied.setId!);
    expect(named("Jax")).toBeTruthy();
    expect(getEntityRow(jaxPage!.id)!.merged_into).toBeNull();
    expect(meusView(chatId).sets[0]!.undone).toBe(true);
  });

  test("the clock is corrected from an earlier message on, even backwards", async () => {
    const v = await meusTurn(chatId, `the time should be Day 1 06:30 from #${seqOf(1)}`);
    const c = v.proposal!.changes[0]!;
    expect(c.kind).toBe("ledger");
    expect(c.label).toContain(`from #${seqOf(1)} on`);
    applyMeus(chatId, [c.id]);
    const t = state().time!;
    expect(formatStoryTime(t)).toBe("Day 1 09:15"); // the later edit still holds
    // The correction sits at that message.
    const atTwo = one<{ message_id: string }>("SELECT message_id FROM tracker_events WHERE chat_id = ? AND op LIKE '%06:30%'", chatId);
    expect(atTwo!.message_id).toBe(msgs[1]!);
  });

  test("changes that wouldn't apply never reach the card, and new people are pointed out", async () => {
    const v = await meusTurn(chatId, "nonsense change");
    expect(v.turns.at(-1)!.text).toContain("Left out: there's no Ghost in the cast");
    expect(v.proposal!.changes.map((c) => c.kind)).toEqual(["ledger"]);
    expect(v.proposal!.changes[0]!.data?.note).toContain("adds Nobody, Noone to the cast");
  });

  test("a past message is fixed in place, with its old text one Undo away", async () => {
    const v = await meusTurn(chatId, `fix message #${seqOf(1)}: Jax grins. \"Captain's orders.\" The lake is warm this morning.`);
    const c = v.proposal!.changes[0]!;
    expect(c.kind).toBe("message");
    expect(c.data?.risky).toBe(true);
    const a = applyMeus(chatId, [c.id]);
    expect(getMessage(msgs[1]!)!.content).toContain("warm");
    undoMeus(chatId, a.setId!);
    expect(getMessage(msgs[1]!)!.content).toContain("cold");
  });

  test("Codex pages are edited, and undo restores them", async () => {
    const page = resolver(chatId).find("Jax")!;
    const v = await meusTurn(chatId, "codex: Jax is missing");
    const c = v.proposal!.changes[0]!;
    expect(c.kind).toBe("codex");
    expect(c.after).toContain("missing");
    const a = applyMeus(chatId, [c.id]);
    expect(getEntityRow(page.id)!.status).toBe("missing");
    undoMeus(chatId, a.setId!);
    expect(getEntityRow(page.id)!.status).toBe(page.status);
  });

  test("memories and the next reply's cue", async () => {
    const v = await meusTurn(chatId, "remember Jax hates the cold lake");
    const a = applyMeus(chatId, [v.proposal!.changes[0]!.id]);
    expect(all("SELECT id FROM memories WHERE chat_id = ? AND content = 'Jax hates the cold lake' AND deleted_at IS NULL AND pinned = 1", chatId).length).toBe(1);
    undoMeus(chatId, a.setId!);
    expect(all("SELECT id FROM memories WHERE chat_id = ? AND content = 'Jax hates the cold lake' AND deleted_at IS NULL", chatId).length).toBe(0);

    const w = await meusTurn(chatId, "cue: slow down and stay with Shauna");
    applyMeus(chatId, [w.proposal!.changes[0]!.id]);
    expect(getChat(chatId)!.settings.cue).toBe("slow down and stay with Shauna");
  });

  test("Meus's conversation never reaches the story's prompt", async () => {
    await meusTurn(chatId, "a private aside about the lighthouse plot");
    const p = await previewPrompt(chatId);
    expect(JSON.stringify(p)).not.toContain("private aside");
  });

  test("the Ask tab's answers become Meus's history", () => {
    const other = createChat({ characterId: getChat(chatId)!.characterId! }).id;
    run("INSERT INTO archivist (id, chat_id, question, answer, citations, created_at) VALUES (?, ?, ?, ?, ?, ?)", newId(), other, "Where is the ball?", "With Shauna [1].", JSON.stringify({ citations: [], confidence: "sure", all: [] }), now());
    const v = meusView(other);
    expect(v.turns.map((t) => t.text)).toEqual(["Where is the ball?", "With Shauna [1]."]);
  });

  test("one cast entry that is really two people is split, and undo joins them again", async () => {
    const m = await meusTurn(chatId, "merge Jax into Jackie Taylor");
    const merged = applyMeus(chatId, [m.proposal!.changes[0]!.id]);
    expect(named("Jax")).toBeUndefined();
    const v = await meusTurn(chatId, "split Jax from Jackie Taylor");
    const c = v.proposal!.changes[0]!;
    expect(c.kind).toBe("split");
    const a = applyMeus(chatId, [c.id]);
    expect(named("Jax")).toBeTruthy();
    expect(named("Jax")!.mood?.name).toBe("wary");
    expect(named("Jackie Taylor")!.aliases).not.toContain("Jax");
    undoMeus(chatId, a.setId!);
    expect(named("Jax")).toBeUndefined();
    undoMeus(chatId, merged.setId!);
    expect(named("Jax")).toBeTruthy();
  });

  test("steering, notes and hiding a message, each undone", async () => {
    const v = await meusTurn(chatId, "steer: slow");
    const a = applyMeus(chatId, v.proposal!.changes.map((c) => c.id));
    let s = getChat(chatId)!.settings;
    expect(s.pacing).toBe("slow");
    expect(s.guidance?.once).toContain("g-slow");
    expect(s.story?.tone).toBe("tender");
    undoMeus(chatId, a.setId!);
    s = getChat(chatId)!.settings;
    expect(s.pacing ?? null).toBeNull();
    expect(s.guidance?.once ?? []).not.toContain("g-slow");
    expect(s.story?.tone ?? "").toBe("");

    const n = await meusTurn(chatId, "note: Lake plot — Jax hid the ball by the boathouse");
    const na = applyMeus(chatId, [n.proposal!.changes[0]!.id]);
    expect(one<{ n: number }>("SELECT COUNT(*) AS n FROM notes WHERE chat_id = ? AND deleted_at IS NULL AND body LIKE '%boathouse%'", chatId)!.n).toBe(1);
    undoMeus(chatId, na.setId!);
    expect(one<{ n: number }>("SELECT COUNT(*) AS n FROM notes WHERE chat_id = ? AND deleted_at IS NULL AND body LIKE '%boathouse%'", chatId)!.n).toBe(0);

    const h = await meusTurn(chatId, `hide #${seqOf(2)}`);
    const ha = applyMeus(chatId, [h.proposal!.changes[0]!.id]);
    expect(getMessage(msgs[2]!)!.hidden).toBe(true);
    undoMeus(chatId, ha.setId!);
    expect(getMessage(msgs[2]!)!.hidden).toBe(false);
  });

  test("lore entries in this chat's lorebooks: looked up, added, and taken back", async () => {
    createLorebook({ name: "Yellowjackets", entries: [], links: [{ target_type: "chat", target_id: chatId }] });
    const v = await meusTurn(chatId, "lore: The lake — It freezes over every winter.");
    const c = v.proposal!.changes[0]!;
    expect(c.kind).toBe("lore_add");
    const a = applyMeus(chatId, [c.id]);
    const l = await meusTurn(chatId, "look up lore: lake freezes");
    expect(l.turns.at(-1)!.reads).toEqual(["Lore · lake freezes"]);
    undoMeus(chatId, a.setId!);
    expect(one<{ n: number }>("SELECT COUNT(*) AS n FROM lorebook_entries WHERE data LIKE '%freezes%'")!.n).toBe(0);
  });

  test("memories are merged and split, and undo puts them back", () => {
    const x = createAtom(chatId, { type: "fact", content: "Jax owns a red scarf", importance: 5 });
    const y = createAtom(chatId, { type: "fact", content: "The scarf was her mother's", importance: 5 });
    const { changes } = checkChanges(chatId, [{ kind: "memory_merge", ids: [x.id, y.id], text: "Jax owns her mother's red scarf" }]);
    const steps = applyChange(chatId, { ...changes[0]!, id: "m" });
    expect(getAtom(x.id)!.content).toBe("Jax owns her mother's red scarf");
    expect(getAtom(y.id)!.status).toBe("superseded");
    for (const st of [...steps].reverse()) undoStep(chatId, st);
    expect(getAtom(x.id)!.content).toBe("Jax owns a red scarf");
    expect(getAtom(y.id)!.status).toBe("active");

    const sp = checkChanges(chatId, [{ kind: "memory_split", id: x.id, parts: ["Jax owns a scarf", "The scarf is red"] }]);
    const ss = applyChange(chatId, { ...sp.changes[0]!, id: "s" });
    expect(getAtom(x.id)!.content).toBe("Jax owns a scarf");
    for (const st of [...ss].reverse()) undoStep(chatId, st);
    expect(getAtom(x.id)!.content).toBe("Jax owns a red scarf");
    expect(all("SELECT id FROM memories WHERE chat_id = ? AND content = 'The scarf is red' AND deleted_at IS NULL", chatId).length).toBe(0);
  });

  test("a subplot off the page is started, and undo takes it back", async () => {
    const before = Object.keys(state().sim.arcs).length;
    const v = await meusTurn(chatId, "world arc: Jackie Taylor — wants to win the cup");
    const c = v.proposal!.changes[0]!;
    expect(c.kind).toBe("world_arc");
    const a = applyMeus(chatId, [c.id]);
    expect(Object.keys(state().sim.arcs).length).toBe(before + 1);
    undoMeus(chatId, a.setId!);
    expect(Object.keys(state().sim.arcs).length).toBe(before);
  });

  test("Meus reads the app's checks, the inbox, summaries and the world when asked", async () => {
    const asks: [string, string][] = [
      ["checks", "Checks · what's flagged"],
      ["inbox", "Continuity inbox"],
      ["world", "World · off the page"],
    ];
    for (const [kind, title] of asks) {
      const v = await meusTurn(chatId, `look up ${kind}: all`);
      expect(v.turns.at(-1)!.reads).toEqual([title]);
    }
  });

  test("a change to the card itself is handed to the Studio, not made here", async () => {
    const v = await meusTurn(chatId, "card: make Jackie two years older");
    expect(v.proposal).toBeNull();
    const h = v.turns.at(-1)!.handoff!;
    expect(h.card).toBe("character");
    expect(h.name).toBe("Jackie Taylor");
    expect(h.request).toBe("make Jackie two years older");
  });

  test("with small fixes on, a clock fix applies right away, and undo still works", async () => {
    updateChat(chatId, { settings: { meus: { autoApply: true } } });
    const v = (await meusTurn(chatId, "the time should be Day 1 11:00")) as ReturnType<typeof meusView> & { auto?: boolean; setId?: string | null };
    expect(v.auto).toBe(true);
    expect(v.proposal).toBeNull();
    expect(formatStoryTime(state().time!)).toBe("Day 1 11:00");
    undoMeus(chatId, v.setId!);
    expect(formatStoryTime(state().time!)).toBe("Day 1 09:15");
    // Riskier changes still come as a card.
    const w = await meusTurn(chatId, "merge Jax into Jackie Taylor");
    expect(w.proposal!.changes[0]!.kind).toBe("merge");
    updateChat(chatId, { settings: { meus: { autoApply: false } } });
  });
});
