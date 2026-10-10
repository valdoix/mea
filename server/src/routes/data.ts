import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { Hono } from "hono";
import { z } from "zod";
import { paths } from "../config";
import { badRequest, body, must, notFound } from "../lib/http";
import { exportMemory, queueMemoryImport } from "../memory/transfer";
import { type BookOptions, bookEpub, bookHtml, bookOutline } from "../services/book";
import { chatTitleFor } from "../services/export";
import { mustChat } from "../services/chats";
import { addHighlight, createNote, deleteHighlight, deleteNote, getNote, highlightsFor, listNotes, moments, restoreNote, updateNote } from "../services/notebook";
import { all } from "../db/db";
import { clean, storageReport, vacuum } from "../services/storage";

/** Phase 5 data: book export, memory export/import, storage, the notebook, highlights, request logs. */
export const data = new Hono();

/**
 * H10/L17: the largest single upload Mea accepts, and the request body limit index.ts should pass to
 * Bun.serve as `maxRequestBodySize` (a little over, for multipart overhead). Bun's default is 128 MB,
 * so the old 200 MB check here could never fire.
 */
export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
export const MAX_REQUEST_BODY_BYTES = MAX_UPLOAD_BYTES + 8 * 1024 * 1024;

const download = (name: string, ext: string) => ({ "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`${name}.${ext}`)}` });

// ---------- Book export (DATA-04) ----------

function bookOptions(q: Record<string, string>): BookOptions {
  return { clean: q.clean !== "0", voices: q.voices === "names" ? "names" : "prose", includeUser: q.user !== "0" };
}

data.get("/chats/:id/book/outline", (c) => c.json(bookOutline(c.req.param("id"), bookOptions(c.req.query()))));

data.get("/chats/:id/book", (c) => {
  const id = c.req.param("id");
  const q = c.req.query();
  const o = bookOptions(q);
  const name = chatTitleFor(id);
  if (q.format === "epub") return new Response(bookEpub(id, o), { headers: { "Content-Type": "application/epub+zip", ...download(name, "epub") } });
  // "pdf": the same book, opened in the browser with the print dialog (save as PDF from there).
  const html = bookHtml(id, o, { print: q.format === "pdf" });
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", ...(q.format === "pdf" ? {} : download(name, "html")) } });
});

// ---------- Memory export / import (DATA-05, PERF-11) ----------

data.get("/chats/:id/memory/export", (c) => {
  const id = c.req.param("id");
  return new Response(JSON.stringify(exportMemory(id), null, 1), { headers: { "Content-Type": "application/json; charset=utf-8", ...download(`${chatTitleFor(id)} memory`, "json") } });
});

data.post("/chats/:id/memory/import", async (c) => {
  const id = c.req.param("id");
  mustChat(id);
  const type = c.req.header("content-type") ?? "";
  let text = "";
  let mode: "merge" | "replace" = "merge";
  if (type.includes("multipart/form-data")) {
    const form = await c.req.formData();
    const f = form.get("file");
    if (!(f instanceof File)) throw badRequest("No file uploaded");
    if (f.size > MAX_UPLOAD_BYTES) throw badRequest("That file is too big (100 MB at most)");
    text = await f.text();
    mode = form.get("mode") === "replace" ? "replace" : "merge";
  } else {
    const input = await body(c, z.object({ text: z.string().min(2), mode: z.enum(["merge", "replace"]).default("merge") }));
    text = input.text;
    mode = input.mode;
  }
  return c.json(queueMemoryImport(id, text, mode), 202);
});

// ---------- Storage (DATA-06) ----------

data.get("/storage", (c) => c.json(storageReport()));
data.post("/storage/vacuum", (c) => c.json(vacuum()));
data.post("/storage/clean", async (c) => {
  const input = await body(c, z.object({ what: z.enum(["requestBodies", "trash", "images"]) }));
  return c.json(clean(input.what));
});

// ---------- Request log files (SEC-06) ----------

data.get("/logs/requests", (c) => {
  if (!existsSync(paths.logs)) return c.json({ files: [] });
  const files = readdirSync(paths.logs)
    .filter((f) => /^requests-\d{4}-\d{2}-\d{2}\.jsonl$/.test(f))
    .map((f) => ({ file: f, bytes: statSync(join(paths.logs, f)).size }))
    .sort((a, b) => b.file.localeCompare(a.file));
  return c.json({ files });
});
data.get("/logs/requests/:file", (c) => {
  const f = c.req.param("file");
  if (!/^requests-\d{4}-\d{2}-\d{2}\.jsonl$/.test(f)) throw badRequest("Bad file name");
  const p = join(paths.logs, f);
  if (!existsSync(p)) throw notFound("No log for that day");
  return new Response(Bun.file(p), { headers: { "Content-Type": "application/jsonl; charset=utf-8", ...download(f.replace(/\.jsonl$/, ""), "jsonl") } });
});

// ---------- Notebook (QOL-01) ----------

const noteInput = z.object({ chatId: z.string().nullable().optional(), title: z.string().max(200).optional(), body: z.string().max(100_000).optional(), pinned: z.boolean().optional() });

data.get("/notes", (c) => {
  const q = c.req.query();
  return c.json({ notes: listNotes({ chatId: q.chat || null, scope: q.scope === "chat" || q.scope === "global" ? q.scope : "all" }) });
});
data.post("/notes", async (c) => c.json(createNote(await body(c, noteInput)), 201));
data.get("/notes/:id", (c) => c.json(must(getNote(c.req.param("id")), "Note not found")));
data.put("/notes/:id", async (c) => c.json(updateNote(c.req.param("id"), await body(c, noteInput))));
data.delete("/notes/:id", (c) => {
  deleteNote(c.req.param("id"));
  return c.json({ ok: true });
});
data.post("/notes/:id/restore", (c) => c.json(must(restoreNote(c.req.param("id")), "Note not found")));

// ---------- Highlights and best moments (QOL-02) ----------

data.post("/messages/:id/highlights", async (c) => {
  const input = await body(c, z.object({ text: z.string().trim().min(1).max(4000), note: z.string().max(1000).optional() }));
  return c.json(addHighlight(c.req.param("id"), input.text, input.note), 201);
});
data.delete("/highlights/:id", (c) => c.json({ removed: deleteHighlight(c.req.param("id")) }));
data.get("/chats/:id/highlights", (c) => {
  const id = c.req.param("id");
  mustChat(id);
  const ids = all<{ id: string }>("SELECT DISTINCT message_id AS id FROM highlights WHERE chat_id = ?", id).map((r) => r.id);
  return c.json({ highlights: highlightsFor(ids) });
});
data.get("/moments", (c) => c.json({ moments: moments({ chatId: c.req.query("chat") || undefined }) }));
