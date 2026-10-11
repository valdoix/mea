import { one, run } from "../db/db";
import { publish } from "../lib/events";
import { badRequest, notFound } from "../lib/http";
import { resolver } from "../memory/entities";
import { lane, registerLane } from "../prompt/lanes";
import { getCard } from "../services/characters";
import { getMessageRow, mustChat, updateChat } from "../services/chats";
import { storyDials } from "../services/layers";
import { seeded } from "../sim/dice";
import { currentFold, linesToOps, writeEvents } from "./store";
import { userEditAt } from "./service";
import type { Character, Pressure, WorldState } from "./types";

/**
 * Hidden pressures (Almanac plan E1). Each new important character privately draws a pressure
 * that fits the story ("is grieving and has told no one"), and it shapes how they act, quietly.
 * The draw is grounded first in what the story already says about them (their fears, the card,
 * their Codex page), with the genre's deck as the fallback, and seeded so every swipe agrees.
 * Pressures grow over scenes, crack (a scene where it nearly shows), and resolve; resolving one
 * moves a bond. They're tracker events written by the engine or by you, never by the model.
 */

const COMMON = [
  "is grieving someone and has told no one",
  "owes money to someone dangerous",
  "is lying about where they were last night",
  "is in love with someone they shouldn't be",
  "has been offered a way out and hasn't decided",
  "is sick and hiding it",
  "made a promise they can't keep",
  "is being blackmailed",
  "is about to lose their home or their place",
  "betrayed someone here once, and they never found out",
  "is more afraid than they let anyone see",
  "is protecting someone by keeping quiet",
];

/** Genre decks (by the lead genre's id in Mea's preset, prompt/mea.ts), on top of the common deck. */
const DECKS: Record<string, string[]> = {
  romance: ["is still in love with someone from before", "has already decided to leave town", "doesn't believe they deserve to be loved", "is engaged, and nobody here knows"],
  romcom: ["told a lie early on that keeps growing", "has a bet riding on how this turns out", "is pretending to be someone a little better than they are"],
  mystery: ["saw something that night and said nothing", "is covering for the wrong person", "found a clue and kept it"],
  noir: ["is on someone's payroll", "is the one who sold out the last person who asked questions", "is running out of time to pay a debt"],
  crime: ["plans to keep the take for themselves", "is talking to the police", "has done this job before, and it went wrong"],
  thriller: ["knows who's coming, and why", "is the reason the opposition knows so much"],
  psych: ["isn't sure their memory of that night is true", "has been told something about another person here that isn't true"],
  horror: ["has seen it before, as a child", "brought it here, without meaning to", "has stopped sleeping"],
  gothic: ["is the heir to something the house won't give up", "knows what's behind the locked door"],
  supernatural: ["isn't entirely human, and hides it", "made a bargain with something that wants paying"],
  fantasy: ["paid for their gift with something they miss", "is bound by an oath they've broken in secret"],
  epic: ["is promised to the other side", "carries a claim to a throne they don't want"],
  darkfantasy: ["is slowly being changed by the power they use", "would sell out the others to save one person"],
  fairytale: ["is under a curse with a condition nobody knows", "gave away their true name"],
  adventure: ["has been here before and didn't come back alone", "is the one who lost the map"],
  scifi: ["isn't the original (a copy, a clone, a backup)", "knows the system is about to fail"],
  spaceopera: ["is a deserter", "is reporting to a faction aboard"],
  cyberpunk: ["is owned by a corporation, on paper", "is running out of the drug that keeps the implant quiet"],
  survival: ["is hoarding supplies", "is infected and hasn't said"],
  intrigue: ["is negotiating with the rival in secret", "holds a letter that would ruin someone here"],
  war: ["deserted once and was never caught", "lost their nerve in the last fight"],
  historical: ["was born into a station they've hidden", "is breaking the law of their time to love someone"],
  western: ["is wanted under another name", "owns the land everyone thinks is common"],
  cozy: ["is about to close the shop and hasn't told anyone", "came back to town after something went wrong"],
  slice: ["didn't get the job, and hasn't said", "is quietly taking care of a parent"],
  comedy: ["is the anonymous critic everyone hates", "has double-booked the same evening"],
  darkcomedy: ["has already done the terrible thing, and is very calm about it"],
};

/** Card and Codex words that ground a draw in what the story already says. */
const GROUNDS: [RegExp, string][] = [
  [/\b(widow|widower|grief|grieving|mourning|lost (?:her|his|their) (?:wife|husband|child|son|daughter|mother|father|brother|sister))\b/i, "still hasn't let themselves grieve"],
  [/\b(debt|owes|broke|gambl\w*|poor|pawned)\b/i, "is in more debt than anyone knows"],
  [/\b(secret|hides|hidden|disguise|alias|false name)\b/i, "is keeping a secret that would change how people see them"],
  [/\b(sick|ill|illness|cough\w*|dying|wound\w*|scar)\b/i, "is in more pain than they show"],
  [/\b(exile|exiled|fled|runaway|deserter|fugitive)\b/i, "is afraid of being found"],
  [/\b(ambitio\w*|rival|crown|heir|inherit\w*)\b/i, "wants something here badly enough to betray for it"],
  [/\b(lonely|alone|solitary|recluse)\b/i, "is lonelier than they will ever admit"],
];

/** The draw for one person: grounded if the story gives a reason, else the genre's deck. Seeded. */
export function drawPressure(chatId: string, st: WorldState, c: Character, draw = 1, avoid?: string): { text: string; by: Pressure["by"] } {
  const r = seeded(chatId, c.firstSeq, `pressure:${c.id}:${draw}`);
  // Grounded: a fear the trackers already know, then the card (main character) or their Codex page.
  if (draw === 1 && c.drives.fear) return { text: `carries a fear they hide: ${c.drives.fear.replace(/\.$/, "")}`, by: "grounded" };
  const chat = mustChat(chatId);
  const card = c.isMain && chat.character_id ? getCard(chat.character_id) : null;
  const page = resolver(chatId).find(c.name);
  const about = [card?.description, card?.personality, page?.description, ...(page ? JSON.parse(page.facts || "[]") : [])].filter(Boolean).join(" ");
  const grounds = GROUNDS.filter(([re]) => re.test(about)).map(([, t]) => t);
  if (grounds.length && draw <= grounds.length) return { text: grounds[Math.floor(r() * grounds.length)]!, by: "grounded" };
  const genre = storyDials(chat).genre ?? "";
  const deck = [...(DECKS[genre] ?? []), ...(DECKS[genre] ?? []), ...COMMON];
  // Not someone else's, and (on a redraw) not the one they had.
  const taken = new Set([...Object.values(st.chars).filter((x) => x.id !== c.id).map((x) => x.pressure?.text), avoid].filter(Boolean));
  const free = deck.filter((t) => !taken.has(t));
  const pool = free.length ? free : deck;
  // Each redraw rolls again from a fresh seed, so it's a different card more often than not.
  return { text: pool[Math.floor(r() * pool.length)]!, by: "deck" };
}

/** Someone the story keeps coming back to: the main character, or present across several messages. */
const important = (c: Character) => !c.isUser && !c.dead && (c.isMain || c.lastSeq - c.firstSeq >= 6);
const present = (c: Character) => c.tier === "spot" || c.tier === "peri";
const line = (name: string, text: string, meta: string[], why: string) => `pressure ${name}: ${text}${meta.length ? ` | ${meta.join(" | ")}` : ""} — ${why}`;

/**
 * After the trackers read a reply (an onTrackerUpdate hook): important people present without a
 * pressure draw one; pressures grow a stage every two scenes their person is in (hidden →
 * growing → cracking). Tied to the reply, so swipes and deletes take it back.
 */
export function pressuresAfterReply(chatId: string, messageId: string, swipeIdx?: number) {
  const m = getMessageRow(messageId);
  if (!m || m.deleted_at) return;
  const anchor = { messageId, swipeIdx: swipeIdx ?? -1 };
  run("DELETE FROM tracker_events WHERE message_id = ? AND swipe_idx = ? AND source = 'engine' AND op LIKE '%\"op\":\"pressure\"%'", messageId, anchor.swipeIdx);
  let st: WorldState;
  try {
    st = currentFold(chatId).result.state;
  } catch {
    return;
  }
  const lines: string[] = [];
  for (const c of Object.values(st.chars)) {
    if (!important(c) || !present(c)) continue;
    const p = c.pressure;
    if (!p) {
      const d = drawPressure(chatId, st, c);
      lines.push(line(c.name, d.text, ["stage: hidden", `by: ${d.by}`, "draw: 1"], "drawn"));
      continue;
    }
    if (p.locked || p.stage === "resolved" || p.stage === "head") continue;
    const next = p.stage === "hidden" ? "growing" : p.stage === "growing" ? "cracking" : null;
    if (next && st.sceneNo - p.scene >= 2) lines.push(line(c.name, "", [`stage: ${next}`], "it grew over the scenes"));
  }
  if (lines.length) writeEvents(chatId, anchor, linesToOps(lines).ops, "engine");
}

// ---------- your hand ----------

export type PressureAction = "redraw" | "write" | "lock" | "unlock" | "head" | "resolve";

/** Redraw, Write my own, Lock, Bring it to a head (the next scene tests it), Resolve (moves a bond). */
export function pressureAction(chatId: string, charId: string, action: PressureAction, text?: string) {
  const st = currentFold(chatId).result.state;
  const c = st.chars[charId];
  if (!c || c.isUser) throw notFound("Who?");
  const p = c.pressure;
  const lines: string[] = [];
  if (action === "redraw") {
    const draws = (p?.draws ?? 0) + 1;
    const d = drawPressure(chatId, st, c, draws, p?.text);
    lines.push(line(c.name, d.text, ["stage: hidden", `by: ${d.by}`, `draw: ${draws}`, "unlock"], "you redrew it"));
  } else if (action === "write") {
    if (!text?.trim()) throw badRequest("Write the pressure first");
    lines.push(line(c.name, text.trim().slice(0, 200), ["stage: hidden", "by: you", "lock"], "you wrote it"));
  } else {
    if (!p) throw badRequest(`${c.name} has no pressure yet`);
    if (action === "lock" || action === "unlock") lines.push(line(c.name, "", [action], `you ${action}ed it`));
    if (action === "head") {
      lines.push(line(c.name, "", ["stage: head"], "you brought it to a head"));
      updateChat(chatId, { settings: { cue: `The next scene tests ${c.name}'s hidden pressure (${p.text}): put them where hiding it costs something. It may come out, or they may hold on, at a price.` } });
    }
    if (action === "resolve") {
      lines.push(line(c.name, "", ["stage: resolved"], "it was resolved"));
      // Resolving it moves a bond: they trust whoever was there for it a little more.
      const user = Object.values(st.chars).find((x) => x.isUser);
      if (user) lines.push(`bond ${c.name}>${user.name}: trust +1 — what they carried was faced`);
    }
  }
  const ids = userEditAt(chatId, linesToOps(lines).ops);
  publish({ type: "trackers.changed", chatId });
  return { ids, pressure: currentFold(chatId).result.state.chars[charId]?.pressure ?? null };
}

/** Every pressure in the chat, with what the player knows that each person doesn't (the dramatic irony view). */
export function pressuresView(chatId: string) {
  const st = currentFold(chatId).result.state;
  const user = Object.values(st.chars).find((c) => c.isUser);
  const knownToUser = Object.values(st.facts).filter((f) => !user || f.stances[user.id]?.status === "knows" || f.secret?.keepers.includes(user.id));
  return Object.values(st.chars)
    .filter((c) => !c.isUser && (c.pressure || important(c)))
    .map((c) => ({
      id: c.id,
      name: c.name,
      present: present(c),
      pressure: c.pressure ?? null,
      youKnow: knownToUser.filter((f) => f.stances[c.id]?.status === "unaware" || f.secret?.from.includes(c.id)).map((f) => f.statement).slice(0, 6),
    }));
}

// ---------- the [PRESSURES] lane: present people only ----------

const STAGE: Record<Pressure["stage"], string> = {
  hidden: "never stated; let it colour a choice or two",
  growing: "harder to carry now; it shows in small things",
  cracking: "this scene it nearly shows: a slip, a tell, a line cut short",
  head: "this scene tests it directly",
  resolved: "",
};

registerLane("pressures", (ctx) => {
  if (ctx.kind !== "story" && ctx.kind !== "continue") return null;
  const st = ctx.state;
  if (!st) return null;
  const here = Object.values(st.chars).filter((c) => !c.isUser && present(c) && c.pressure && c.pressure.stage !== "resolved");
  if (!here.length) return null;
  return lane("pressures", null, `What these people carry and haven't said (play it through behaviour; never announce it, and nobody else knows):\n${here.map((c) => `- ${c.name} ${c.pressure!.text}. ${STAGE[c.pressure!.stage]}.`).join("\n")}`, { depth: 1 });
});

export const hasPressures = (chatId: string) => Boolean(one("SELECT 1 FROM tracker_events WHERE chat_id = ? AND op LIKE '%\"op\":\"pressure\"%' LIMIT 1", chatId));
