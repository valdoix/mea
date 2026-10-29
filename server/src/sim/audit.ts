import { registerInboxProvider } from "../accuracy/inbox";
import { all, now, one, parseJson, run } from "../db/db";
import { publish, subscribe } from "../lib/events";
import { currentFold } from "../trackers/store";
import type { Op, WorldState } from "../trackers/types";
import { factAbout } from "./news";
import { reach } from "./reach";
import { queueSheets, rosterFor, sheetsToRead, undoEngine, worldConfig } from "./service";

/**
 * docs/21 6.2: the world checks its own work. What it passed on off the page is checked again
 * against the gate as things stand now (you marked Oz away, the lore read found Drusilla in Los
 * Angeles, you said Spike and Halfrek don't talk), and anything that no longer holds goes to the
 * Inbox to undo. Lore that hasn't been read, so the world is guessing about people, goes there too.
 */
export interface AuditFinding {
  id: string;
  kind: "hop" | "unread";
  title: string;
  why: string[];
  after: string;
  /** hop: the engine event to undo. */
  event?: string;
}

const memo = new WeakMap<WorldState, { stamp: string; findings: AuditFinding[] }>();

/** What changes the answer without changing the story's state: sheets read, cast profiles edited. */
function stamp(chatId: string) {
  const s = one<{ a: number | null; b: number | null }>(
    "SELECT (SELECT MAX(updated_at) FROM world_sheets WHERE chat_id = ?) AS a, (SELECT MAX(updated_at) FROM cast_profiles WHERE chat_id = ?) AS b",
    chatId,
    chatId,
  );
  return `${s?.a ?? 0}|${s?.b ?? 0}`;
}

export function auditWorld(chatId: string): AuditFinding[] {
  const cfg = worldConfig(chatId);
  if (cfg.mode === "off") return [];
  const st = currentFold(chatId).result.state;
  const key = stamp(chatId);
  const hit = memo.get(st);
  if (hit?.stamp === key) return hit.findings;

  const findings: AuditFinding[] = [];
  const roster = rosterFor(chatId, st);
  const actors = [...roster.actors.values()];
  // Each piece of news the world passed on that still stands as hearsay.
  const rows = all<{ id: string; op: string }>(
    "SELECT id, op FROM tracker_events WHERE chat_id = ? AND source = 'engine' AND json_extract(op, '$.op') = 'know' AND json_extract(op, '$.args.route') LIKE 'told by %'",
    chatId,
  );
  for (const r of rows) {
    const op = parseJson<Op>(r.op, { op: "sim", args: {}, raw: "" } as Op);
    const route = String(op.args.route ?? "");
    const from = roster.byName(route.match(/^told by (.+?), /)?.[1] ?? "");
    const to = op.subject ? roster.byName(op.subject) : undefined;
    const f = st.facts[String(op.args.key ?? "")];
    if (!to || !f) continue;
    const s = f.stances[to.id];
    // Since settled on the page (they know, or don't) or replaced, its route is the page's: nothing to check.
    // Still the world's own word, whether hearsay or from before hearsay ("knows"): check it.
    if (!s || s.route !== route || s.status === "unaware") continue;
    const gate = reach(from, to, "news", { tech: cfg.tech, fact: f, about: factAbout(f, actors) });
    if (gate.ok) continue;
    findings.push({
      id: `hop:${r.id}`,
      kind: "hop",
      title: `${to.name} heard it from ${from?.name ?? route.replace(/^told by /, "")}, but that couldn't happen now`,
      why: gate.why,
      after: f.statement,
      event: r.id,
    });
  }
  const unread = sheetsToRead(chatId, st).length;
  if (unread) findings.push({ id: "unread", kind: "unread", title: `The world is guessing about ${unread} ${unread === 1 ? "person" : "people"}`, why: ["Their lore hasn't been read yet, so the world guesses whether they're alive, where they are and whom they talk to."], after: "Read their lore now?" });
  memo.set(st, { stamp: key, findings });
  return findings;
}

/** Check again and keep the answer for the Inbox (which only reads it: a check can take a second). */
export function refreshAudit(chatId: string): AuditFinding[] {
  const findings = auditWorld(chatId);
  const before = one<{ data: string }>("SELECT data FROM world_audit WHERE chat_id = ?", chatId)?.data;
  const data = JSON.stringify(findings);
  if (before === data) return findings;
  run("INSERT INTO world_audit (chat_id, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(chat_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at", chatId, data, now());
  publish({ type: "inbox.changed" });
  return findings;
}

const storedAudit = (chatId: string) => parseJson<AuditFinding[]>(one<{ data: string }>("SELECT data FROM world_audit WHERE chat_id = ?", chatId)?.data, []);

// After each change to a story's world (a step, an undo, news let through, lore read), once things settle.
const timers = new Map<string, ReturnType<typeof setTimeout>>();
subscribe((e) => {
  if (e.type !== "trackers.changed" || e.running) return;
  clearTimeout(timers.get(e.chatId));
  timers.set(
    e.chatId,
    setTimeout(() => {
      timers.delete(e.chatId);
      try {
        refreshAudit(e.chatId);
      } catch {
        // the chat is gone, or its trackers are off
      }
    }, 1500),
  );
});

const dismissed = (key: string) => Boolean(one("SELECT 1 FROM inbox_dismissed WHERE key = ?", key));

registerInboxProvider({
  kind: "worldaudit",
  source: "world",
  items: (chats) =>
    chats.flatMap((c) => {
      return storedAudit(c.id)
        .map((x) => ({
          key: `worldaudit:${c.id}:${x.id}`,
          chatId: c.id,
          chatTitle: "",
          title: x.title,
          why: x.why.join(" · "),
          before: null,
          after: x.after,
          editable: false,
          createdAt: 0,
          link: `/chat/${c.id}/world`,
          labels: x.kind === "hop" ? { accept: "Undo it", reject: "Keep it" } : { accept: "Read their lore", reject: "Not now" },
        }))
        .filter((i) => !dismissed(i.key));
    }),
  act: (id, action) => {
    const [chatId, ...rest] = id.split(":");
    const fid = rest.join(":");
    if (!chatId) return null;
    if (action === "reject") run("INSERT OR IGNORE INTO inbox_dismissed (key, chat_id, created_at) VALUES (?, ?, ?)", `worldaudit:${id}`, chatId, now());
    else if (fid.startsWith("hop:")) undoEngine(chatId, fid.slice(4));
    else if (fid === "unread") queueSheets(chatId);
    refreshAudit(chatId);
    return chatId;
  },
});
