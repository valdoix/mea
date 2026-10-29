import { beforeAll, describe, expect, test } from "bun:test";
import { normalizeCard } from "../src/cards/card";
import { all } from "../src/db/db";
import { createCharacter } from "../src/services/characters";
import { addMessage, createChat, updateChat } from "../src/services/chats";
import { registerJob } from "../src/services/jobs";
import { createPersona } from "../src/services/personas";
import { runTick } from "../src/sim/service";
import { saveSheet, type Sheet } from "../src/sim/sheet";
import { currentFold, linesToOps, saveCastProfile, writeEvents } from "../src/trackers/store";
import type { Op } from "../src/trackers/types";
import { freshDb } from "./helpers";

/**
 * docs/21 6.1: a season-6 world, run for 300 world steps with the real engine. The never-list is
 * what went wrong before (news to Drusilla in Los Angeles, to Halfrek who never met Spike, from a
 * Tara who was never told, about your own character; subplots led by the dead, a cat, a faction);
 * and something must still happen, so a world that does nothing doesn't pass.
 */
let chatId = "";
const STEPS = 300;
const BRONZE = "The Bronze burned down last night";
const OURS = "Gabriel was arrested in Los Angeles";

const sheet = (o: Partial<Sheet>): Sheet => ({ kind: "person", status: "alive", whereabouts: "Sunnydale", far: false, inStory: "now", basis: "golden", at: 0, ...o });

beforeAll(() => {
  freshDb();
  for (const kind of ["world.tell", "world.word", "world.sheet"]) registerJob(kind, async () => {});
  createPersona({ name: "Gabriel Winters", data: { description: "A Slayer from Los Angeles." }, isDefault: true });
  const { data } = normalizeCard({ spec: "chara_card_v2", data: { name: "Buffy Summers", description: "The Slayer, back from the dead in 2001 Sunnydale.", first_mes: "She breathes." } });
  chatId = createChat({ characterId: createCharacter(data) }).id;
  updateChat(chatId, { settings: { world: { mode: "restless", telling: "engine", news: "auto", seeding: "auto", tech: "modern" } } });

  // The lore's people, as the Cast page knows them, with the sheets a model read from their entries.
  const lore: [string, string, Partial<Sheet>][] = [
    ["Drusilla", "Drusilla is a mad vampire seer, sire and former lover of Spike. status(left Spike; last seen in Los Angeles in early 2001).", { status: "absent", whereabouts: "Los Angeles", far: true, ties: [{ name: "Spike", type: "past", inTouch: false }] }],
    ["Halfrek", "Halfrek is a vengeance demon, Anya's oldest friend. history(appears to have been Cecily, whom William, later Spike, loved in 1880).", { whereabouts: null, ties: [{ name: "Anya", type: "friend", inTouch: true }] }],
    ["Oz", "Oz is Willow's ex-boyfriend, a werewolf who left town in 2000 and is traveling.", { status: "absent", whereabouts: null, far: true, ties: [{ name: "Willow", type: "past", inTouch: false }] }],
    ["Kendra Young", "Kendra was a Slayer, killed by Drusilla in 1998.", { status: "dead", inStory: "past", whereabouts: null }],
    ["Joyce Summers", "Joyce, Buffy and Dawn's mother, died in February 2001.", { status: "dead", inStory: "past", whereabouts: null }],
    ["Ruth", "Ruth is Gabriel's grey cat. She sleeps on the stove.", { kind: "animal" }],
    ["Watchers Council", "The Watchers Council in London trains and guides Slayers.", { kind: "group", whereabouts: "London", far: true }],
    ["Anya", "Anya is a former vengeance demon who runs the Magic Box and is engaged to Xander.", { ties: [{ name: "Halfrek", type: "friend", inTouch: true }] }],
  ];
  for (const [name, description, s] of lore) {
    saveCastProfile(chatId, name, { description });
    saveSheet(chatId, name, sheet(s));
  }

  const m = addMessage(chatId, "assistant", "Buffy sits up in her old bed.");
  writeEvents(
    chatId,
    { messageId: m, swipeIdx: 0 },
    linesToOps([
      "clock: Day 1 08:00",
      "at: Sunnydale › Revello Drive › Buffy's Bedroom",
      "cast: Buffy Summers@spot · Gabriel Winters@spot",
      "cast: Spike@left(→ Sunnydale › Spike's Crypt) · Tara@left(→ Sunnydale › Revello Drive › Kitchen) · Willow@left(→ Sunnydale › Revello Drive › Kitchen) · Dawn@left(→ Sunnydale › Revello Drive › Kitchen)",
      "bond Tara>Willow: affection 4; trust 3 — girlfriends",
      "bond Spike>Tara: trust 1 — she treats him with courtesy",
      "bond Spike>Dawn: affection 2 — he looks after her",
      `know Spike: ${BRONZE} | saw the smoke · knows`,
      `know Spike: ${OURS} | Gabriel told him · knows`,
      // Loose ends that once grew subplots for a cat, a faction and the dead, and real ones that should.
      "thread Ruth's breakfast: new — Ruth needs feeding at Gabriel's house",
      "thread Watchers Council back pay: new — the Council owes Buffy a million dollars",
      "thread Kendra's stake: new — Kendra's old stake turned up in the weapons chest",
      "thread Spike's debt: new — Spike owes Clem forty kittens from poker",
      "thread Dawn's shoplifting: new — Dawn has been stealing from the mall",
      "bond Dawn>Buffy Summers: affection 5; resentment 3 — she was gone",
      "bond Spike>Buffy Summers: attraction 5; affection 4 — he counted every day",
    ]).ops,
    "model",
  );
  runTick(chatId, null, true);
  // Three story hours a step, a reply's worth of messages every so often (so bonds stay "lately").
  for (let i = 1; i <= STEPS; i++) {
    const day = 1 + Math.floor((8 + i * 3) / 24);
    const hour = (8 + i * 3) % 24;
    const n = addMessage(chatId, "assistant", "Time passes.");
    writeEvents(chatId, { messageId: n, swipeIdx: 0 }, linesToOps([`clock: Day ${day} ${String(hour).padStart(2, "0")}:00`]).ops, "model");
    runTick(chatId, null, true);
  }
}, 240_000);

describe(`a season-6 world, ${STEPS} steps`, () => {
  const engine = () => all<{ op: string }>("SELECT op FROM tracker_events WHERE chat_id = ? AND source = 'engine'", chatId).map((r) => JSON.parse(r.op) as Op);
  const hops = () => engine().filter((o) => o.op === "sim" && o.args.type === "news").map((o) => o.args.hop as { from: string; to: string; statement: string });
  const leads = () => engine().filter((o) => o.op === "sim" && (o.args.type === "arc.new" || o.args.type === "proposal.new")).map((o) => String((o.args.arc ?? o.args.proposal).leadName));

  test("news never reaches or comes from someone who couldn't pass it", () => {
    const never = ["Drusilla", "Halfrek", "Oz", "Kendra Young", "Joyce Summers", "Ruth", "Watchers Council", "Buffy Summers", "Gabriel Winters"];
    const bad = hops().filter((h) => never.includes(h.from) || never.includes(h.to));
    expect(bad).toEqual([]);
  });

  test("news about your character never leaves the page", () => {
    expect(hops().filter((h) => h.statement === OURS)).toEqual([]);
    const f = Object.values(currentFold(chatId).result.state.facts).find((x) => x.statement === OURS)!;
    expect(Object.keys(f.stances)).toEqual(["spike"]);
  });

  test("off the page, people only ever have heard", () => {
    const told = engine().filter((o) => o.op === "know" && /^told by /.test(String(o.args.route)));
    expect(told.length).toBeGreaterThan(0);
    expect(told.every((o) => o.args.status === "heard")).toBe(true);
  });

  test("no subplot is led by the dead, a pet, a group, or the leads", () => {
    const never = ["Kendra Young", "Joyce Summers", "Ruth", "Watchers Council", "Buffy Summers", "Gabriel Winters"];
    expect(leads().filter((l) => never.includes(l))).toEqual([]);
  });

  test("and the world still moves: subplots for the living, and the Bronze news along real ties", () => {
    expect(leads().length).toBeGreaterThan(0);
    const bronze = hops().filter((h) => h.statement === BRONZE);
    expect(bronze.length).toBeGreaterThan(0);
    for (const h of bronze) expect(["Spike", "Tara", "Willow", "Dawn"]).toContain(h.to);
  });
});
