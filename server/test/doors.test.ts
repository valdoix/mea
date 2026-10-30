import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * docs/22 0.4: a model reads a summary through memory/openlist.ts, or an open list from Thursday
 * reads as Friday. Every fix so far landed on one path, and the next reader started with the old
 * bug. So a file that reads summaries goes through the door or says here why it doesn't.
 */
const REASONS: Record<string, string> = {
  "accuracy/canoncut.ts": "looks for canon terms by rule; no model reads the text",
  "accuracy/codex.ts": "the Codex page: you read it, and it says what it's through",
  "accuracy/inbox.ts": "review cards for proposed summaries",
  "accuracy/loopinbox.ts": "reads open lists as data, to find what's a loop",
  "memory/build.ts": "writes summaries: a rollup reads its parts as history",
  "memory/deep.ts": "finds messages to quote; the quotes are the page",
  "memory/embed.ts": "embeddings, for search",
  "memory/entities.ts": "reads scenes' data fields, not their text",
  "memory/format.ts": "reads scenes' places and times",
  "memory/inspect.ts": "the memory inspector: you read it as it's stored",
  "memory/journals.ts": "a journal reads each scene once, when it closes, as history",
  "memory/openlist.ts": "the door",
  "memory/reconcile.ts": "checks a scene against the trackers by rule",
  "memory/scheduler.ts": "builds summaries",
  "memory/store.ts": "the store",
  "memory/transfer.ts": "export and import, as stored",
  "meus/changes.ts": "your edits to a summary, as stored",
  "routes/memory.ts": "the memory API, as stored",
  "services/book.ts": "chapter titles",
  "services/storage.ts": "sizes",
  "services/stories.ts": "titles",
  "services/trash.ts": "cleanup",
  "services/versionchat.ts": "a retelling takes a summary as history, into a new chat",
  "steer/desk.ts": "where the chapter starts",
};

const READS = /\b(?:storyRow|levelRows|childrenOf|getSummary)\(|FROM summaries\b/;
const DOOR = /\bsummaryText\(/;
const src = join(import.meta.dir, "../src");
const files = readdirSync(src, { recursive: true, encoding: "utf8" })
  .filter((f) => f.endsWith(".ts"))
  .map((f) => ({ name: relative(src, join(src, f)).replaceAll("\\", "/"), text: readFileSync(join(src, f), "utf8") }));

describe("one door for summaries", () => {
  test("a file that reads summaries goes through it, or says why not", () => {
    const raw = files.filter((f) => READS.test(f.text) && !DOOR.test(f.text) && !REASONS[f.name]).map((f) => f.name);
    expect(raw).toEqual([]);
  });

  test("a reason goes when its file stops reading summaries, or starts using the door", () => {
    const stale = Object.keys(REASONS).filter((name) => {
      const f = files.find((x) => x.name === name);
      return !f || !READS.test(f.text) || (DOOR.test(f.text) && name !== "memory/openlist.ts");
    });
    expect(stale).toEqual([]);
  });
});
