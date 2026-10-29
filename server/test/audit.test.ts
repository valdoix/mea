import { beforeAll, describe, expect, test } from "bun:test";
import { actOnInbox, inboxItems } from "../src/accuracy/inbox";
import { normalizeCard } from "../src/cards/card";
import { createCharacter } from "../src/services/characters";
import { addMessage, createChat, updateChat } from "../src/services/chats";
import { registerJob } from "../src/services/jobs";
import { auditWorld, refreshAudit } from "../src/sim/audit";
import { runTick } from "../src/sim/service";
import { currentFold, linesToOps, saveCastProfile, writeEvents } from "../src/trackers/store";
import { freshDb } from "./helpers";

/** docs/21 6.2: what the world passed on off the page is checked again as things stand now. */
const FACT = "The chandlery burned down in the storm";

function story() {
  const id = createChat({ characterId: createCharacter(normalizeCard({ spec: "chara_card_v2", data: { name: "Mira", description: "x", first_mes: "y" } }).data) }).id;
  updateChat(id, { settings: { world: { mode: "living", telling: "engine", news: "auto" } } });
  const m = addMessage(id, "assistant", "The storm rolls in.");
  writeEvents(id, { messageId: m, swipeIdx: 0 }, linesToOps(["clock: Day 1 08:00", "at: Port Ellis › Lighthouse", "cast: Mira@spot", "cast: Joss@left(→ Port Ellis › Harbour) · Kit@left(→ Port Ellis › Market)", `know Joss: ${FACT} | saw it · knows`, "bond Joss>Kit: affection 3 — old friends"]).ops, "model");
  runTick(id, null, true);
  const n = addMessage(id, "assistant", "Days pass.");
  writeEvents(id, { messageId: n, swipeIdx: 0 }, linesToOps(["clock: Day 4 08:00"]).ops, "model");
  runTick(id, null, true);
  return id;
}
const kit = (id: string) => Object.values(currentFold(id).result.state.facts).find((f) => f.statement === FACT)?.stances.kit;

beforeAll(() => {
  freshDb();
  for (const kind of ["world.tell", "world.word", "world.sheet"]) registerJob(kind, async () => {});
});

describe("the world's own audit", () => {
  test("news that still holds isn't flagged", () => {
    const id = story();
    expect(kit(id)?.status).toBe("heard");
    expect(auditWorld(id).filter((f) => f.kind === "hop")).toEqual([]);
  });

  test("news that couldn't happen now goes to the Inbox, says why, and undoes from there", () => {
    const id = story();
    saveCastProfile(id, "Kit", { out: true });
    const hop = auditWorld(id).find((f) => f.kind === "hop")!;
    expect(hop.title).toBe("Kit heard it from Joss, but that couldn't happen now");
    expect(hop.why).toEqual(["you left Kit out"]);
    refreshAudit(id);
    const item = inboxItems({ chatId: id }).find((i) => i.kind === "worldaudit" && i.key.includes(":hop:"))!;
    expect(item.labels).toEqual({ accept: "Undo it", reject: "Keep it" });
    actOnInbox(item.key, "accept");
    expect(kit(id)).toBeUndefined();
    expect(auditWorld(id).filter((f) => f.kind === "hop")).toEqual([]);
  });

  test("'Keep it' stays kept", () => {
    const id = story();
    saveCastProfile(id, "Kit", { out: true });
    refreshAudit(id);
    const item = inboxItems({ chatId: id }).find((i) => i.kind === "worldaudit" && i.key.includes(":hop:"))!;
    actOnInbox(item.key, "reject");
    expect(inboxItems({ chatId: id }).some((i) => i.key === item.key)).toBe(false);
    expect(kit(id)?.status).toBe("heard");
  });

  test("people whose lore isn't read yet are a finding of their own", () => {
    const id = story();
    saveCastProfile(id, "Dru", { description: "Dru is a seer, last seen in Los Angeles in early 2001." });
    const unread = auditWorld(id).find((f) => f.kind === "unread")!;
    expect(unread.title).toBe("The world is guessing about 1 person");
    refreshAudit(id);
    expect(inboxItems({ chatId: id }).find((i) => i.key === `worldaudit:${id}:unread`)?.labels?.accept).toBe("Read their lore");
  });
});
