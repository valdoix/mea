import { beforeAll, describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import { checkReply, flagsFor, replaceIssue } from "../src/accuracy/checker";
import { emptyCard } from "../src/cards/card";
import { createCreatorDraft, patchCreator, reviewCreator, saveCreator } from "../src/creator/creator";
import { newId, now, one, run } from "../src/db/db";
import { listEntities, syncEntities } from "../src/memory/entities";
import { memState } from "../src/memory/store";
import { applyChange, checkChanges, undoStep } from "../src/meus/changes";
import { addMessage, createChat, getChatRow } from "../src/services/chats";
import { chatExtras } from "../src/services/chattools";
import { createCharacter, getCard } from "../src/services/characters";
import { createConnection, createProfile, syncModels } from "../src/services/connections";
import { registerJob } from "../src/services/jobs";
import { copyAsVersion } from "../src/services/linked";
import { createPersona } from "../src/services/personas";
import { joinUniverse } from "../src/services/universes";
import { applyCardVariant, createVariant, getVariant, looksFor, updateVariant } from "../src/services/variants";
import { forgetChatMap, retellOptions, universeLeaks } from "../src/services/versionchat";
import { freshDb, ownGreeting } from "./helpers";

let app: ReturnType<typeof createApp>;
const local = { requestIP: () => ({ address: "127.0.0.1", family: "IPv4", port: 5000 }) };
async function api<T = any>(method: string, path: string, body?: unknown): Promise<{ status: number; json: T }> {
  const res = await app.fetch(new Request(`http://localhost${path}`, { method, headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined }), local);
  return { status: res.status, json: (await res.json()) as T };
}

beforeAll(async () => {
  freshDb();
  for (const kind of ["lore.studio", "lore.embed", "creator.write", "accuracy.check", "memory.build"]) registerJob(kind, async () => {});
  app = createApp();
  const conn = createConnection({ name: "Mock", kind: "mock", billing: "subscription" });
  await syncModels(conn);
  createProfile({ name: "Story", connectionId: conn, modelId: "mock/storyteller", params: { context_target: 4000 } });
});

/** Mira, and her College AU made in the studio: Port Ellis became a campus, the ferry is gone. */
function college() {
  const origin = createCharacter({ ...emptyCard("Mira"), description: "Mira keeps the lighthouse above Port Ellis.", first_mes: "The lamp is lit." }, { mode: "companion" });
  const d = createCreatorDraft({ kind: "character", baseId: origin, asVersion: { kind: "au", label: "College AU" }, idea: "" });
  patchCreator(d.id, {
    variant: {
      map: [
        { from: "Port Ellis", type: "place", state: "changed", to: "Ellis Campus, a city university" },
        { from: "The Old Ferry", type: "thing", state: "dropped" },
        { from: "The Lamp", type: "thing", state: "kept" },
      ],
    },
  } as never);
  const version = saveCreator(ownGreeting(d.id)).id;
  return { origin, version };
}

/** A summary row, as memory would write it. */
function summary(chatId: string, level: string, content: string, data: Record<string, unknown> = {}, start = 1) {
  const t = now();
  const id = newId();
  run("INSERT INTO summaries (id, chat_id, level, start_seq, end_seq, title, content, data, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ready', ?, ?)", id, chatId, level, start, start + 4, level === "story" ? "" : "The first night", content, JSON.stringify(data), t, t);
  return id;
}

describe("versions in chats (docs/14, part 6)", () => {
  test("a reply that leaks the original's world is flagged, and the one-tap fix uses the version's name", async () => {
    const { version } = college();
    const chatId = createChat({ characterId: version }).id;
    expect(universeLeaks(chatId, "We walked past the lamp.")).toEqual([]);
    const found = universeLeaks(chatId, "We took the bus back to Port Ellis. The Old Ferry was gone.");
    expect(found.map((f) => [f.claim, f.replace?.to ?? null])).toEqual([
      ["Port Ellis", "Ellis Campus"],
      ["The Old Ferry", null],
    ]);
    expect(found[0]).toMatchObject({ kind: "universe", conflict: "In College AU, Port Ellis is Ellis Campus, a city university.", fix: 'Call it "Ellis Campus", not "Port Ellis".', by: "rules" });
    // Through the checker, as after a reply.
    const mid = addMessage(chatId, "assistant", "Back in Port Ellis, Port Ellis felt smaller.", { name: "Mira" });
    await checkReply(chatId, mid, 0, { model: false });
    const flag = flagsFor(chatId, { messageIds: [mid] })[0]!;
    const issue = flag.issues.find((i) => i.kind === "universe")!;
    expect(issue.replace).toEqual({ from: "Port Ellis", to: "Ellis Campus" });
    replaceIssue(flag.id, issue.id);
    expect(one<{ content: string }>("SELECT content FROM swipes WHERE message_id = ? AND idx = 0", mid)!.content).toBe("Back in Ellis Campus, Ellis Campus felt smaller.");
    // Off in Chat › Guards, like the other checks.
    const guards = (await api("GET", `/api/chats/${chatId}/guards`)).json;
    expect(guards.slips.find((s: { id: string }) => s.id === "universe")).toMatchObject({ label: "This version's world", runs: true });
  });

  test("a chat with the original isn't checked, and a dropped name never becomes a Codex page", () => {
    const { origin, version } = college();
    const plain = createChat({ characterId: origin }).id;
    expect(universeLeaks(plain, "Port Ellis at dusk.")).toEqual([]);
    const chatId = createChat({ characterId: version }).id;
    summary(chatId, "scene", "They met on campus.", { participants: ["Mira"], locations: ["Port Ellis", "Ellis Campus", "The Old Ferry"] });
    syncEntities(chatId, true);
    const names = listEntities(chatId).map((e) => e.name);
    expect(names).toContain("Ellis Campus");
    expect(names).not.toContain("Port Ellis");
    expect(names).not.toContain("The Old Ferry");
  });

  test("retell in another version: a new chat with the version, opening on the arc told through its map", async () => {
    const { origin, version } = college();
    const chatId = createChat({ characterId: origin }).id;
    expect((await api("POST", `/api/chats/${chatId}/retell`, { versionId: version })).status).toBe(400); // nothing to retell yet
    summary(chatId, "story", "Mira met Ash on the pier at Port Ellis and lent them a lantern.");
    const arc = summary(chatId, "chapter", "Mira and Ash argued about the Old Ferry.", {}, 6);
    const opts = (await api("GET", `/api/chats/${chatId}/retell`)).json;
    expect(opts.versions).toEqual([expect.objectContaining({ id: version, label: "College AU", original: false, universe: expect.objectContaining({ name: "College AU" }) })]);
    expect(opts.arcs.map((a: { level: string }) => a.level)).toEqual(["story", "chapter"]);
    const r = await api("POST", `/api/chats/${chatId}/retell`, { versionId: version, arcId: arc });
    expect(r.status).toBe(201);
    const made = getChatRow(r.json.chatId)!;
    expect(made.character_id).toBe(version);
    expect(r.json.recap).toBe("Retold here: Mira and Ash argued about the Old Ferry.");
    expect(memState(made.id).recap?.text).toBe(r.json.recap);
    // It opens on a greeting written for the retelling, not the card's usual one (which would start over).
    const opening = one<{ content: string; n: number }>("SELECT s.content, (SELECT COUNT(*) FROM swipes x WHERE x.message_id = m.id) AS n FROM messages m JOIN swipes s ON s.message_id = m.id AND s.idx = m.active_swipe WHERE m.chat_id = ? AND m.seq = 1", made.id)!;
    expect(opening).toEqual({ content: 'Mira looks up as You comes in. "So. Where were we?"', n: 1 });
    expect(chatExtras(made.id, "story", null).find((x) => x.id === "retold")?.content).toContain("Retold here: Mira and Ash argued");
    // From the version's chat, the original is offered back.
    expect(retellOptions(made.id).versions.map((v) => [v.id, v.original])).toEqual([[origin, true]]);
  });

  test("Looks on versions: an original's Look marked for every version plays on them; others don't", async () => {
    const { origin, version } = college();
    const coat = createVariant("character", origin, { name: "Winter coat", overlay: { description: "Mira in a long wool coat." } });
    const gala = createVariant("character", origin, { name: "Gala", overlay: { description: "Mira in silver." } });
    const own = createVariant("character", version, { name: "Finals week", overlay: { personality: "Running on coffee." } });
    expect(looksFor("character", version).map((v) => v.name)).toEqual(["Finals week"]);
    updateVariant(coat.id, { everyVersion: true });
    expect(looksFor("character", version).map((v) => [v.name, v.fromOriginal])).toEqual([
      ["Finals week", false],
      ["Winter coat", true],
    ]);
    expect(applyCardVariant(getCard(version)!, getVariant(coat.id), version).description).toBe("Mira in a long wool coat.");
    expect(applyCardVariant(getCard(version)!, getVariant(gala.id), version).description).toBe(getCard(version)!.description);
    const chat = createChat({ characterId: version, variantId: coat.id });
    expect(chat.settings.variantId).toBe(coat.id);
    expect(chat.title).toContain("(Winter coat)");
    const detail = (await api("GET", `/api/chats/${chat.id}`)).json;
    expect(detail.variants.map((v: { name: string; fromOriginal: boolean }) => [v.name, v.fromOriginal])).toEqual([
      ["Finals week", false],
      ["Winter coat", true],
    ]);
    expect(detail.character.universeId).toBeTruthy();
    expect((await api("PUT", `/api/variants/${gala.id}`, { everyVersion: true })).json.everyVersion).toBe(true);
    void own;
  });

  test("a new chat with a version in a universe brings your persona's version from it", () => {
    const { origin, version } = college();
    const ash = createPersona({ name: "Ash", data: { description: "A courier." }, isDefault: true });
    const ashCollege = copyAsVersion("persona", ash, { label: "College AU", kind: "au" });
    const universeId = one<{ universe_id: string }>("SELECT universe_id FROM characters WHERE id = ?", version)!.universe_id;
    joinUniverse("persona", ashCollege, universeId);
    forgetChatMap();
    expect(createChat({ characterId: version }).personaId).toBe(ashCollege);
    // The original's chat keeps your usual persona; asking for one wins.
    expect(createChat({ characterId: origin }).personaId).toBe(ash);
    expect(createChat({ characterId: version, personaId: ash }).personaId).toBe(ash);
  });

  test("Meus: retell starts the chat with its own recap, and Undo takes it back", () => {
    const { origin, version } = college();
    const chatId = createChat({ characterId: origin }).id;
    summary(chatId, "story", "Mira met Ash on the pier.");
    const { changes, dropped } = checkChanges(chatId, [
      { kind: "retell", version: "College AU", text: "Mira met Ash outside the campus radio station.", greeting: "The ON AIR light flickers as {{char}} waves you in." },
      { kind: "retell", version: "Nobody", text: "…" },
    ]);
    expect(dropped).toEqual(['there\'s no version "Nobody" of this character']);
    expect(changes[0]).toMatchObject({ kind: "retell", target: version, label: "Retell in College AU: The story so far" });
    const steps = applyChange(chatId, { ...changes[0]!, id: "c1" });
    const made = (steps[0] as { id: string }).id;
    expect(getChatRow(made)).toMatchObject({ character_id: version, deleted_at: null });
    expect(memState(made).recap?.text).toBe("Mira met Ash outside the campus radio station.");
    expect(one<{ content: string }>("SELECT s.content FROM messages m JOIN swipes s ON s.message_id = m.id AND s.idx = 0 WHERE m.chat_id = ? AND m.seq = 1", made)!.content).toBe("The ON AIR light flickers as Mira waves you in.");
    for (const s of steps.reverse()) undoStep(chatId, s);
    expect(getChatRow(made)!.deleted_at).not.toBeNull();
  });

  test("a studio version opens with its own greeting: the original's word for word can't be saved", () => {
    const origin = createCharacter({ ...emptyCard("Mira"), description: "Mira keeps the lighthouse.", first_mes: "The lamp is lit." }, { mode: "companion" });
    const d = createCreatorDraft({ kind: "character", baseId: origin, asVersion: { kind: "au", label: "College AU" }, idea: "" });
    expect(reviewCreator(d.id).issues.first_mes?.map((i) => i.kind)).toContain("original");
    expect(() => saveCreator(d.id)).toThrow(/still opens with Mira's greeting/);
    ownGreeting(d.id, "The ON AIR light is on.");
    expect(reviewCreator(d.id).issues.first_mes?.map((i) => i.kind) ?? []).not.toContain("original");
    expect(getCard(saveCreator(d.id).id)!.first_mes).toBe("The ON AIR light is on.");
  });
});
