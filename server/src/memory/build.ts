import { all, now, one, parseJson, run, tx } from "../db/db";
import { memoryConfig } from "../lib/settings";
import { countTokens } from "../lib/tokens";
import { getCard } from "../services/characters";
import { getChatRow } from "../services/chats";
import type { JobContext } from "../services/jobs";
import { callJson } from "../services/llm";
import { getDefaultPersona, getPersona } from "../services/personas";
import { shouldShed } from "../services/quota";
import { type AtomRow, insertAtom, isDuplicate, supersede } from "./atoms";
import {
  boundarySchema,
  boundarySystem,
  clampInt,
  type Moment,
  renderRollup,
  renderScene,
  rollupSchema,
  rollupSystem,
  type SceneOutput,
  sceneSchema,
  sceneSystem,
  type VerifyOutput,
  verifySchema,
  verifySystem,
} from "./prompts";
import {
  childrenOf,
  formatLedger,
  getSummary,
  ledger,
  ledgerTokens,
  levelRows,
  removeBoundary,
  saveVersion,
  type SummaryRow,
  storyRow,
  touchMemory,
} from "./store";
import { ftsQuery, hashText } from "./text";
import { highlightsInRange } from "../services/notebook";

export function chatNames(chatId: string) {
  const chat = getChatRow(chatId);
  const card = chat?.character_id ? getCard(chat.character_id) : undefined;
  const persona = getPersona(chat?.persona_id) ?? getDefaultPersona();
  return { char: card?.name ?? "Character", user: persona?.name ?? "You" };
}

/** Existing active atoms likely related to a scene, labeled A1…An so the model can supersede them (MEM-07). */
function relatedAtoms(chatId: string, text: string, beforeSeq: number, sceneId: string) {
  const q = ftsQuery(text, 40);
  const byFts = q
    ? all<AtomRow>(
        `SELECT m.* FROM memories_fts f JOIN memories m ON m.id = f.id
         WHERE memories_fts MATCH ? AND f.chat_id = ? AND m.deleted_at IS NULL AND m.status IN ('active', 'disputed')
           AND (m.scene_id IS NULL OR m.scene_id != ?) AND COALESCE(m.min_seq, 0) < ?
         ORDER BY bm25(memories_fts) LIMIT 30`,
        q,
        chatId,
        sceneId,
        beforeSeq,
      )
    : [];
  const pinned = all<AtomRow>("SELECT * FROM memories WHERE chat_id = ? AND pinned = 1 AND deleted_at IS NULL AND status = 'active' LIMIT 20", chatId);
  const seen = new Set<string>();
  return [...pinned, ...byFts].filter((a) => !seen.has(a.id) && seen.add(a.id)).slice(0, 40);
}

interface SceneBuild {
  output: SceneOutput;
  verification: (VerifyOutput & { repaired?: boolean; skipped?: string }) | null;
  related: AtomRow[];
  sourceHash: string;
  sourceTokens: number;
  rows: ReturnType<typeof ledger>;
}

async function runScenePass(row: SummaryRow, ctx: { job?: JobContext; instruction?: string; signal?: AbortSignal }): Promise<SceneBuild | null> {
  const cfg = memoryConfig();
  const rows = ledger(row.chat_id, row.start_seq, row.end_seq ?? Number.MAX_SAFE_INTEGER);
  if (!rows.length) return null;
  const names = chatNames(row.chat_id);
  const source = formatLedger(rows, names);
  const sourceHash = hashText(source);
  const sourceTokens = ledgerTokens(rows);
  const prev = all<SummaryRow>("SELECT * FROM summaries WHERE chat_id = ? AND level = 'scene' AND start_seq < ? AND state = 'ready' ORDER BY start_seq DESC LIMIT 1", row.chat_id, row.start_seq)[0];
  const related = relatedAtoms(row.chat_id, source, row.start_seq, row.id);
  // QOL-02: what the player marked in this scene matters to them; keep it, word for word.
  const marked = [
    ...all<{ seq: number }>("SELECT seq FROM messages WHERE chat_id = ? AND bookmarked = 1 AND deleted_at IS NULL AND seq BETWEEN ? AND ? ORDER BY seq", row.chat_id, row.start_seq, row.end_seq ?? Number.MAX_SAFE_INTEGER).map((r) => `[#${r.seq}] (the whole message)`),
    ...highlightsInRange(row.chat_id, row.start_seq, row.end_seq ?? Number.MAX_SAFE_INTEGER).map((h) => `[#${h.seq}] "${h.text.slice(0, 300)}"`),
  ];
  const header = [
    `Characters: ${names.char} (the character), ${names.user} (the player's character).`,
    prev ? `Previous scene, for continuity only (don't record it again): ${prev.title}: ${prev.content.slice(0, 1500)}` : "",
    related.length ? `EXISTING MEMORIES that may be related:\n${related.map((a, i) => `A${i + 1} (${a.type}) ${a.content}`).join("\n")}` : "",
    ctx.instruction ? `Extra instruction from the author for this record: ${ctx.instruction}` : "",
    marked.length ? `The player marked these as favourite moments. Make sure the record keeps them (quote the key words):\n${marked.join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  const user = `${header}\n\nSCENE (messages #${rows[0]!.seq}–#${rows.at(-1)!.seq}):\n\n${source}`;
  ctx.job?.note({ inputTokens: countTokens(user), level: "scene" });

  const first = await callJson({ task: "summarizer", kind: "scene", chatId: row.chat_id, jobId: ctx.job?.id, name: "scene_memory", schema: sceneSchema, system: sceneSystem(names), user, maxTokens: 5000, signal: ctx.signal });
  let output = first.data;
  let verification: SceneBuild["verification"] = null;

  // SUM-12: check the record against its source; repair once if it found real problems.
  if (cfg.verify) {
    if (shouldShed("verification")) verification = { verdict: "ok", unsupported: [], omissions: [], skipped: "quota" };
    else {
      const check = await callJson({
        task: "summarizer",
        kind: "verify",
        chatId: row.chat_id,
        jobId: ctx.job?.id,
        name: "summary_check",
        schema: verifySchema,
        system: verifySystem(),
        user: `SOURCE MESSAGES:\n\n${source}\n\nRECORD TO CHECK:\n${JSON.stringify({ title: output.title, summary: output.summary, quotes: output.quotes, memories: output.memories.map((m) => m.content) }, null, 1)}`,
        maxTokens: 2000,
        signal: ctx.signal,
      });
      verification = check.data;
      if (cfg.autoRepair && check.data.verdict === "major") {
        const issues = [
          ...check.data.unsupported.map((u) => `- Unsupported: ${u.claim}${u.reason ? ` (${u.reason})` : ""}`),
          ...check.data.omissions.map((o) => `- Missing: ${o.what}${o.seq ? ` [#${o.seq}]` : ""}`),
        ].join("\n");
        const repaired = await callJson({
          task: "summarizer",
          kind: "scene-repair",
          chatId: row.chat_id,
          jobId: ctx.job?.id,
          name: "scene_memory",
          schema: sceneSchema,
          system: sceneSystem(names),
          user: `${user}\n\nA checker reviewed an earlier record of this scene and found these problems. Write the record again, fixing them:\n${issues}`,
          maxTokens: 5000,
          signal: ctx.signal,
        });
        output = repaired.data;
        verification = { ...check.data, repaired: true };
      }
    }
  }
  return { output, verification, related, sourceHash, sourceTokens, rows };
}

/** Writes a finished scene record and replaces the scene's AI-made atoms (MEM-05, MEM-07). */
function applyScene(row: SummaryRow, b: SceneBuild) {
  const o = b.output;
  const bySeq = new Map(b.rows.map((m) => [m.seq, m]));
  const content = renderScene(o);
  tx(() => {
    const cur = getSummary(row.id)!;
    saveVersion(cur, cur.user_edited ? "user" : "ai", "before rebuild");
    run(
      `UPDATE summaries SET title = ?, content = ?, data = ?, state = 'ready', error = NULL, verification = ?, importance = ?, tokens = ?, source_tokens = ?,
         source_hash = ?, story_time = ?, proposal = NULL, user_edited = 0, built_at = ?, updated_at = ? WHERE id = ?`,
      o.title.trim().slice(0, 160),
      content,
      JSON.stringify(o),
      b.verification ? JSON.stringify(b.verification) : null,
      clampInt(o.importance, 1, 10, 5),
      countTokens(content),
      b.sourceTokens,
      b.sourceHash,
      o.storyTime || null,
      now(),
      now(),
      row.id,
    );
    // Replace AI atoms from this scene; atoms you edited or pinned stay.
    run("DELETE FROM memories WHERE scene_id = ? AND user_edited = 0 AND pinned = 0", row.id);
    run("UPDATE memories SET stale = 0 WHERE scene_id = ?", row.id);
    const all = b.rows.map((m) => ({ id: m.id, seq: m.seq }));
    // The scene's old AI atoms are gone now, so anything matching is a real duplicate, even one
    // from this very record (a model can repeat a memory) or one you kept in this scene.
    const seen = new Set<string>();
    for (const m of o.memories) {
      const key = m.content.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, "").replace(/\s+/g, " ").trim();
      if (!key || seen.has(key) || isDuplicate(row.chat_id, m.content)) continue;
      seen.add(key);
      let sources = m.sources.map((s) => bySeq.get(Math.round(s))).filter((x): x is NonNullable<typeof x> => Boolean(x)).map((x) => ({ id: x.id, seq: x.seq }));
      if (!sources.length) sources = all.length <= 3 ? all : [all.at(-1)!];
      const targets = m.supersedes
        .map((label) => b.related[Number(String(label).replace(/\D/g, "")) - 1])
        .filter((a): a is AtomRow => Boolean(a));
      // Your edits win: an AI fact can't overrule a memory you edited or pinned; it's marked disputed instead.
      const locked = targets.some((t) => t.user_edited || t.pinned);
      const id = insertAtom(
        row.chat_id,
        row.id,
        {
          type: m.type,
          content: m.content,
          entities: m.entities,
          importance: m.importance,
          emotions: m.emotions,
          storyTime: o.storyTime || null,
          knownBy: m.knownBy,
          confidence: m.confidence,
          status: locked ? "disputed" : "active",
        },
        sources,
      );
      if (!locked) for (const t of targets) supersede(t.id, id);
    }
  });
}

async function buildScene(row: SummaryRow, opts: BuildOptions) {
  const cur = getSummary(row.id)!;
  const b = await runScenePass(cur, opts);
  if (!b) {
    // Every message in the scene was deleted or hidden: fold it into its neighbour.
    removeBoundary(row.chat_id, "scene", row.start_seq);
    return;
  }
  if (opts.propose || cur.user_edited) {
    // Your edited summary is never overwritten: the rebuild waits as a proposal (MEM-10 diff preview).
    run("UPDATE summaries SET state = 'review', proposal = ?, updated_at = ? WHERE id = ?", JSON.stringify({ title: b.output.title, content: renderScene(b.output), data: b.output, verification: b.verification, at: now(), kind: "scene", hash: b.sourceHash, sourceTokens: b.sourceTokens }), now(), row.id);
    return;
  }
  applyScene(cur, b);
}

const ROLLUP_CHILD: Record<"chapter" | "arc", "scene" | "chapter"> = { chapter: "scene", arc: "chapter" };

/** Inputs for a chapter, arc, or the Story So Far, built only from the level below (SUM-01, SUM-02). */
function rollupInputs(row: SummaryRow): { parts: SummaryRow[]; endSeq: number | null } {
  if (row.level === "story") {
    // Rewritten from arcs (plus closed chapters after the last arc), never rolled forward (SUM-02).
    const arcs = levelRows(row.chat_id, "arc").filter((a) => a.closed && a.state === "ready");
    const after = arcs.at(-1)?.end_seq ?? 0;
    const chapters = levelRows(row.chat_id, "chapter").filter((c) => c.closed && c.state === "ready" && c.start_seq > after);
    const parts = [...arcs, ...chapters];
    return { parts, endSeq: parts.at(-1)?.end_seq ?? null };
  }
  return { parts: childrenOf(row, ROLLUP_CHILD[row.level as "chapter" | "arc"]).filter((c) => c.state === "ready"), endSeq: row.end_seq };
}

async function buildRollup(row: SummaryRow, opts: BuildOptions) {
  const level = row.level as "chapter" | "arc" | "story";
  const { parts, endSeq } = rollupInputs(row);
  if (!parts.length) {
    run("UPDATE summaries SET state = 'pending', updated_at = ? WHERE id = ?", now(), row.id);
    return;
  }
  const names = chatNames(row.chat_id);
  const label = (p: SummaryRow) => (p.level === "scene" ? "Scene" : p.level === "chapter" ? "Chapter" : "Arc");
  const body = parts
    .map((p, i) => {
      const d = parseJson<Record<string, unknown>>(p.data, {});
      const extra = [d.storyTime ? `Time: ${d.storyTime}` : "", Array.isArray(d.threadsClosed) && d.threadsClosed.length ? `Resolved: ${(d.threadsClosed as string[]).join("; ")}` : ""].filter(Boolean).join(" · ");
      const moments = memoryConfig().moments && Array.isArray(d.moments) && d.moments.length ? `\nMOMENTS: ${(d.moments as Moment[]).map((m) => `[${m.tag}] ${m.text}`).join(" · ")}` : "";
      return `${label(p)} ${i + 1}: ${p.title} (messages #${p.start_seq}–#${p.end_seq ?? "…"})${extra ? `\n${extra}` : ""}\n${p.content}${moments}`;
    })
    .join("\n\n");
  const user = `${opts.instruction ? `Extra instruction from the author: ${opts.instruction}\n\n` : ""}RECORDS, oldest first:\n\n${body}`;
  opts.job?.note({ inputTokens: countTokens(user), level });
  const r = await callJson({ task: "summarizer", kind: level, chatId: row.chat_id, jobId: opts.job?.id, name: "summary_rollup", schema: rollupSchema, system: rollupSystem(level, names), user, maxTokens: memoryConfig().compression[level] === "detailed" ? 4000 : 3000, signal: opts.signal });
  r.data.moments = memoryConfig().moments ? carryMoments(parts) : [];
  const content = renderRollup(r.data, level);
  const hash = hashText(parts.map((p) => `${p.id}:${p.source_hash ?? ""}:${p.updated_at}`).join("|"));
  const cur = getSummary(row.id)!;
  if (opts.propose || cur.user_edited) {
    run("UPDATE summaries SET state = 'review', proposal = ?, updated_at = ? WHERE id = ?", JSON.stringify({ title: r.data.title, content, data: r.data, at: now(), kind: level, hash, endSeq }), now(), row.id);
    return;
  }
  tx(() => {
    saveVersion(cur, "ai", "before rebuild");
    run(
      `UPDATE summaries SET title = ?, content = ?, data = ?, state = 'ready', error = NULL, importance = ?, tokens = ?, source_tokens = ?, source_hash = ?, story_time = ?,
         proposal = NULL, built_at = ?, updated_at = ?${level === "story" ? ", end_seq = ?" : ""} WHERE id = ?`,
      r.data.title.trim().slice(0, 160),
      content,
      JSON.stringify(r.data),
      clampInt(r.data.importance, 1, 10, 5),
      countTokens(content),
      parts.reduce((n, p) => n + p.source_tokens, 0),
      hash,
      r.data.storyTime || null,
      now(),
      now(),
      ...(level === "story" ? [endSeq, row.id] : [row.id]),
    );
  });
}

/** SUM-11: the moments of a rollup's parts, in story order, so none is lost to compression. */
export function carryMoments(parts: SummaryRow[]): Moment[] {
  const out: Moment[] = [];
  const seen = new Set<string>();
  for (const p of parts) {
    const d = parseJson<{ moments?: Moment[] }>(p.data, {});
    for (const m of d.moments ?? []) {
      const key = `${m.tag}|${m.text}`.toLowerCase();
      if (!m.text?.trim() || seen.has(key)) continue;
      seen.add(key);
      out.push(m);
    }
  }
  return out;
}

export interface BuildOptions {
  job?: JobContext;
  instruction?: string;
  /** Build into a proposal for review instead of replacing (MEM-10 "ask first"). */
  propose?: boolean;
  signal?: AbortSignal;
}

/** Builds (or rebuilds) one summary row. Errors are recorded on the row for the inspector. */
export async function buildSummary(id: string, opts: BuildOptions = {}) {
  const row = getSummary(id);
  if (!row) return;
  if (row.level !== "story" && !row.closed) return; // open rows are still being written
  run("UPDATE summaries SET state = 'building', error = NULL, updated_at = ? WHERE id = ?", now(), id);
  touchMemory(row.chat_id);
  try {
    if (row.level === "scene") await buildScene(row, opts);
    else await buildRollup(row, opts);
  } catch (e) {
    const prev = getSummary(id);
    if (prev) {
      const deferred = (e as Error).name === "Deferred";
      run(
        "UPDATE summaries SET state = ?, error = ?, updated_at = ? WHERE id = ?",
        deferred ? (prev.content ? "stale" : "pending") : "error",
        deferred ? null : (e as Error).message.slice(0, 500),
        now(),
        id,
      );
    }
    throw e;
  } finally {
    touchMemory(row.chat_id);
  }
}

/** Accepts a pending proposal (MEM-10 review): the new version replaces the old one, which is kept in history. */
export function acceptProposal(id: string) {
  const row = getSummary(id);
  if (!row?.proposal) return false;
  const p = parseJson<{ title: string; content: string; data: Record<string, unknown>; verification?: unknown; hash?: string; sourceTokens?: number; endSeq?: number | null; kind: string }>(row.proposal, {
    title: "",
    content: "",
    data: {},
    kind: "",
  });
  if (row.level === "scene") {
    const rows = ledger(row.chat_id, row.start_seq, row.end_seq ?? Number.MAX_SAFE_INTEGER);
    const names = chatNames(row.chat_id);
    applyScene(row, {
      output: sceneSchema.parse(p.data),
      verification: (p.verification as SceneBuild["verification"]) ?? null,
      related: relatedAtoms(row.chat_id, formatLedger(rows, names), row.start_seq, row.id),
      sourceHash: p.hash ?? "",
      sourceTokens: p.sourceTokens ?? ledgerTokens(rows),
      rows,
    });
  } else {
    tx(() => {
      saveVersion(row, row.user_edited ? "user" : "ai", "before accepting a rebuild");
      run(
        `UPDATE summaries SET title = ?, content = ?, data = ?, state = 'ready', tokens = ?, source_hash = ?, proposal = NULL, user_edited = 0, built_at = ?, updated_at = ?${row.level === "story" ? ", end_seq = ?" : ""} WHERE id = ?`,
        p.title,
        p.content,
        JSON.stringify(p.data),
        countTokens(p.content),
        p.hash ?? null,
        now(),
        now(),
        ...(row.level === "story" ? [p.endSeq ?? row.end_seq, id] : [id]),
      );
    });
  }
  touchMemory(row.chat_id);
  return true;
}

export function rejectProposal(id: string) {
  const row = getSummary(id);
  if (!row) return false;
  // Keeping your version means it stays as it is; it is no longer flagged.
  run("UPDATE summaries SET proposal = NULL, state = CASE WHEN content != '' THEN 'ready' ELSE 'pending' END, updated_at = ? WHERE id = ?", now(), id);
  touchMemory(row.chat_id);
  return true;
}

/** Your edit to a summary (SUM-08): versioned, and locked against AI rebuilds until you accept one. */
export function editSummary(id: string, patch: { title?: string; content?: string }) {
  const row = getSummary(id);
  if (!row) return undefined;
  tx(() => {
    saveVersion(row, row.user_edited ? "user" : "ai", "before your edit");
    const content = patch.content ?? row.content;
    run(
      "UPDATE summaries SET title = ?, content = ?, tokens = ?, user_edited = 1, state = CASE WHEN state IN ('stale', 'error', 'pending') AND ? != '' THEN 'ready' ELSE state END, updated_at = ? WHERE id = ?",
      patch.title ?? row.title,
      content,
      countTokens(content),
      content,
      now(),
      id,
    );
  });
  touchMemory(row.chat_id);
  return getSummary(id);
}

export function summaryVersions(id: string) {
  return all<{ id: string; title: string; content: string; source: string; note: string | null; created_at: number }>(
    "SELECT id, title, content, source, note, created_at FROM summary_versions WHERE summary_id = ? ORDER BY created_at DESC LIMIT 50",
    id,
  ).map((v) => ({ id: v.id, title: v.title, content: v.content, source: v.source, note: v.note, createdAt: v.created_at }));
}

export function restoreSummaryVersion(id: string, versionId: string) {
  const v = one<{ title: string; content: string; data: string }>("SELECT title, content, data FROM summary_versions WHERE id = ? AND summary_id = ?", versionId, id);
  const row = getSummary(id);
  if (!v || !row) return undefined;
  tx(() => {
    saveVersion(row, row.user_edited ? "user" : "ai", "before restoring an older version");
    run("UPDATE summaries SET title = ?, content = ?, data = ?, tokens = ?, user_edited = 1, updated_at = ? WHERE id = ?", v.title, v.content, v.data, countTokens(v.content), now(), id);
  });
  touchMemory(row.chat_id);
  return getSummary(id);
}

/** Cheap gate (CONN-14 preview): does this message start a new scene? Used for weak signals only. */
export async function confirmBoundary(chatId: string, recent: string, next: string, signal?: AbortSignal) {
  const r = await callJson({
    task: "helper",
    kind: "gate:scene",
    chatId,
    name: "scene_boundary",
    schema: boundarySchema,
    system: boundarySystem(),
    user: `CURRENT SCENE (latest messages):\n${recent}\n\nNEW MESSAGE:\n${next}`,
    maxTokens: 300,
    signal,
  });
  return r.data;
}

export function storyNeedsRebuild(chatId: string) {
  const story = storyRow(chatId);
  const arcs = levelRows(chatId, "arc").filter((a) => a.closed && a.state === "ready");
  const target = arcs.at(-1)?.end_seq ?? null;
  if (target == null) return false;
  if (!story) return true;
  if (story.state === "stale" || story.state === "pending") return story.state === "stale" || (story.end_seq ?? 0) < target;
  return story.state === "ready" && (story.end_seq ?? 0) < target;
}
