import { beforeAll, describe, expect, test } from "bun:test";
import { normalizeCard } from "../src/cards/card";
import { newId, now, run } from "../src/db/db";
import { createCharacter } from "../src/services/characters";
import { addMessage, createChat, editMessage, setActiveSwipe } from "../src/services/chats";
import { planbook, planOutcomes, planStats, planTrend } from "../src/steer/planbook";
import { freshDb } from "./helpers";

const PLAN = (tier: string) => `Tier: ${tier}\nNOW — night, the lamp room.\nMOVE — she offers tea.\nVOICE — short.`;

let chatId = "";

/** A planned reply: its takes (each with a plan), the one kept, then your answer to it. */
function reply(opts: { tier?: string; takes?: number; kept?: number; how?: string; model?: string; edit?: boolean; slips?: { kind: string; dismissed?: boolean }[]; answer?: boolean; chat?: string }) {
  const chat = opts.chat ?? chatId;
  const id = addMessage(chat, "assistant", "Take 0.", { name: "Mira", meta: { plan: opts.how ?? "own", model: opts.model ?? "m/one" } });
  run("UPDATE swipes SET reasoning = ? WHERE message_id = ?", PLAN(opts.tier ?? "Routine"), id);
  for (let i = 1; i < (opts.takes ?? 1); i++) {
    run(
      "INSERT INTO swipes (id, message_id, idx, content, reasoning, status, meta, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'done', ?, ?, ?)",
      newId(), id, i, `Take ${i}.`, PLAN(opts.tier ?? "Routine"), JSON.stringify({ plan: opts.how ?? "own", model: opts.model ?? "m/one" }), now(), now(),
    );
  }
  if (opts.kept) setActiveSwipe(id, opts.kept);
  if (opts.edit) editMessage(id, "Changed by hand.");
  if (opts.slips) {
    run(
      "INSERT INTO continuity_flags (id, chat_id, message_id, swipe_idx, issues, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'open', ?, ?)",
      newId(), chat, id, opts.kept ?? 0, JSON.stringify(opts.slips.map((s) => ({ id: newId(), severity: "minor", claim: "", conflict: "", citations: [], fix: "", by: "rules", ...s }))), now(), now(),
    );
  }
  if (opts.answer !== false) addMessage(chat, "user", "And then?");
  return id;
}

beforeAll(() => {
  freshDb();
  const { data } = normalizeCard({ spec: "chara_card_v2", data: { name: "Mira", description: "Keeper of the lighthouse.", first_mes: "The lamp hums." } });
  chatId = createChat({ characterId: createCharacter(data) }).id;
  addMessage(chatId, "assistant", "The lamp hums.", { name: "Mira" });
  addMessage(chatId, "user", "Hello.");
});

describe("the planner's log: how each plan turned out", () => {
  test("each answered reply: its takes, the one kept, edits, slips, and the kept take's plan", () => {
    const first = reply({ tier: "Routine" });
    const swiped = reply({ tier: "Charged", takes: 3, kept: 2, how: "step" });
    const edited = reply({ tier: "Pivotal", edit: true, slips: [{ kind: "leak" }, { kind: "name", dismissed: true }] });
    const open = reply({ answer: false });
    const list = planOutcomes({ chatId });
    // The greeting has no plan, and the last reply isn't answered yet: neither counts.
    expect(list.map((o) => o.messageId)).toEqual([first, swiped, edited]);
    expect(list.map((o) => o.messageId)).not.toContain(open);
    expect(list[0]).toMatchObject({ tier: "Routine", steps: 3, tries: 1, edited: false, slips: [], how: "own", model: "m/one" });
    expect(list[1]).toMatchObject({ tier: "Charged", tries: 3, how: "step" });
    expect(list[2]).toMatchObject({ tier: "Pivotal", edited: true, slips: ["leak"] });

    const s = planStats(list);
    expect(s.n).toBe(3);
    expect(s.firstTry).toBeCloseTo(1 / 3);
    expect(s.swipes).toBeCloseTo(2 / 3);
    expect(s.slips).toBeCloseTo(100 / 3);
    expect(s.planned).toBe(1);
    run("UPDATE messages SET deleted_at = 1 WHERE id = ?", open);
  });

  test("the notebook: totals, the last 20 against before, per tier and per source, the commonest slips", () => {
    for (let i = 0; i < 20; i++) reply({ tier: "Routine", takes: i % 4 === 0 ? 2 : 1, slips: i % 5 === 0 ? [{ kind: "leak" }] : undefined });
    const book = planbook(chatId);
    expect(book.all.n).toBe(23);
    expect(book.recent.n).toBe(20);
    expect(book.earlier.n).toBe(3);
    expect(book.recent.firstTry).toBeCloseTo(15 / 20);
    expect(book.byTier.Routine?.n).toBe(21);
    expect(book.byTier.Pivotal?.firstTry).toBe(0);
    expect(book.byHow.step?.n).toBe(1);
    expect(book.slipKinds[0]).toEqual({ kind: "leak", count: 5 });
    expect(book.trend.reduce((a, p) => a + p.n, 0)).toBe(23);
  });

  test("the trend: stretches of five or more, a short last one joined to the one before", () => {
    const list = planOutcomes({ chatId });
    const trend = planTrend(list.slice(0, 12));
    expect(trend.map((p) => p.n)).toEqual([5, 7]);
    expect(trend[0]!.fromSeq).toBe(list[0]!.seq);
    expect(planTrend([])).toEqual([]);
  });

  test("by model: every chat that model wrote", () => {
    const { data } = normalizeCard({ spec: "chara_card_v2", data: { name: "Tam", description: "A fisherman." } });
    const other = createChat({ characterId: createCharacter(data) }).id;
    addMessage(other, "user", "Ahoy.");
    reply({ chat: other, model: "m/two" });
    reply({ chat: other, model: "m/one", takes: 2 });
    reply({ model: "m/one" });
    const book = planbook(chatId, "model");
    expect(book.scope).toBe("model");
    expect(book.model).toBe("m/one");
    expect(book.all.n).toBe(planOutcomes({ chatId }).length + 1);
  });
});
