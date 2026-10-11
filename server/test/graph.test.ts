import { beforeAll, describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import { normalizeCard } from "../src/cards/card";
import { createCharacter } from "../src/services/characters";
import { addMessage, createChat } from "../src/services/chats";
import { pauseJobs, registerJob } from "../src/services/jobs";
import { linesToOps, writeEvents } from "../src/trackers/store";
import { freshDb } from "./helpers";

let app: ReturnType<typeof createApp>;
let chatId = "";
const local = { requestIP: () => ({ address: "127.0.0.1", family: "IPv4", port: 5000 }) };
const get = async (path: string) => (await app.fetch(new Request(`http://localhost${path}`), local)).json() as Promise<any>;

beforeAll(() => {
  freshDb();
  pauseJobs(true);
  for (const kind of ["memory.segment", "memory.build", "memory.embed", "accuracy.check", "tracker.update", "offpage.reword", "lessons.learn"]) registerJob(kind, async () => {});
  app = createApp();
  const { data } = normalizeCard({ spec: "chara_card_v2", data: { name: "Mira", first_mes: "The lamp hums." } });
  chatId = createChat({ characterId: createCharacter(data) }).id;
  const say = (lines: string[]) => writeEvents(chatId, { messageId: addMessage(chatId, "assistant", "…", { name: "Mira" }), swipeIdx: 0 }, linesToOps(lines).ops, "model");
  say(["clock: Day 1 20:00", "cast: Mira@spot · Joss@spot"]);
  say(["bond Mira>Joss: trust +1 — he fixed the lamp", "rep Joss @ Salt Guild: +2 — paid his dues"]);
  say(["bond Mira>Joss: trust +1; resentment +1 — he lied about the ledger", "secret #ledger: Mira hid the harbour ledger | kept by Mira · from Joss"]);
  say(["item brass key: Mira → Joss — she lent it"]);
});

describe("the relationship graph's layers (G2)", () => {
  test("bond history, factions, who knows each secret, object trails", async () => {
    const g = await get(`/api/chats/${chatId}/trackers/graph`);
    const mira = g.nodes.find((n: any) => n.name === "Mira");
    const joss = g.nodes.find((n: any) => n.name === "Joss");
    expect(joss.faction).toBe("Salt Guild");
    const e = g.edges.find((x: any) => x.from === mira.id && x.to === joss.id);
    expect(e.history.map((h: any) => [h.axis, h.delta, h.seq])).toEqual([
      ["trust", 1, 3],
      ["trust", 1, 4],
      ["resentment", 1, 4],
    ]);
    expect(e.history[1].cause).toBe("he lied about the ledger");
    expect(g.secrets[0]).toMatchObject({ key: "ledger", knows: [mira.id], unaware: [joss.id] });
    expect(g.trails[0]).toMatchObject({ name: "brass key", steps: [{ from: mira.id, to: joss.id, seq: 5 }] });
  });

  test("the time slider: the graph as it stood earlier", async () => {
    const g = await get(`/api/chats/${chatId}/trackers/graph?seq=3`);
    const e = g.edges[0];
    expect(e.axes).toEqual({ trust: 1 });
    expect(g.secrets).toEqual([]);
    expect(g.trails).toEqual([]);
  });
});
