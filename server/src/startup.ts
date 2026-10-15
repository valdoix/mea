import { ensureDirs, paths } from "./config";
import { checkDb, openDb, openDbFromBytes, run, tidyDb } from "./db/db";
import { lockUntilUnlocked, vaultEnabled, vaultMigrationBackup } from "./lib/vault";
import { loadMasterKey } from "./lib/crypto";
import { scheduledBackup } from "./services/backup";
import { listConnections, refreshQuota, syncModels } from "./services/connections";
import { pruneJobs, registerJob, schedule, startJobs } from "./services/jobs";
import { ensureDefaultPreset } from "./services/presets";
import { vapidKeys } from "./services/push";
import { purgeTrash } from "./services/trash";
import { pruneGenerations } from "./services/usage";
import { onLedgerEdit } from "./services/chats";
import { embedChat } from "./memory/embed";
import { consolidate } from "./memory/consolidate";
import { recordTimeline, runCheckJob } from "./accuracy/checker";
import { runLessonsJob } from "./steer/lessons";
import { runRewordJob } from "./accuracy/offpage";
import { exposureAfterReply } from "./trackers/exposure";
import { pressuresAfterReply } from "./trackers/pressures";
import { promisesAfterReply } from "./trackers/promises";
import { asidesAfterReply } from "./accuracy/asides";
import { musicAfterReply } from "./music/director";
import { suggestCanon } from "./accuracy/canoncut";
import { runDriftJob } from "./accuracy/drift";
import { runEditorJob } from "./steer/editor";
import { runMemoryImport } from "./memory/transfer";
import { runChronicle } from "./lore/chronicle";
import { embedLore } from "./lore/semantic";
import { runEnrichJob } from "./lore/enrich";
import { runStudioJob } from "./lore/studio";
import { runCreatorJob } from "./creator/creator";
import { runJournalJob } from "./memory/journals";
import { onLedgerChange, runBuildJob, segmentChat } from "./memory/scheduler";
import { probeCache, runDueProbes } from "./services/probe";
import { onTrackerUpdate, runTrackerInit, runTrackerUpdate, trackerLedgerHook } from "./trackers/service";
import { runTelling, worldAfterReply, worldLane } from "./sim/service";
import { activeGenerations, setElsewhereLane } from "./services/generation";
import { runSpeakerMarksJob } from "./services/speakermarks";

/** Replies that were streaming when Mea stopped are marked so the user can retry them. */
function recoverInterrupted() {
  run(`UPDATE swipes SET
         status = CASE WHEN TRIM(content) = '' THEN 'error' ELSE 'stopped' END,
         error = CASE WHEN TRIM(content) = '' THEN 'Mea restarted while this reply was being written. Swipe to try again.' ELSE error END
       WHERE status = 'streaming'`);
  run("UPDATE generations SET status = 'error', error = 'interrupted by restart' WHERE status = 'running'");
}

export function startup(opts: { jobs?: boolean; dbFile?: string } = {}) {
  ensureDirs();
  loadMasterKey();
  // SEC-05: an encrypted database waits for its passphrase; everything else starts once it's open.
  if (!opts.dbFile && vaultEnabled()) {
    lockUntilUnlocked((bytes) => {
      openDbFromBytes(bytes, { backup: vaultMigrationBackup });
      afterOpen(opts);
    });
    console.log("  the database is encrypted: open Mea in a browser and enter the passphrase to unlock it");
    return;
  }
  openDb(opts.dbFile ?? paths.db);
  afterOpen(opts);
}

function afterOpen(opts: { jobs?: boolean }) {
  checkDb();
  recoverInterrupted();
  ensureDefaultPreset();
  vapidKeys();

  registerJob("backup.scheduled", async () => scheduledBackup());
  registerJob("quota.refresh", async () => {
    await refreshQuota();
  });
  registerJob("catalog.sync", async () => {
    for (const c of listConnections()) if (c.hasKey || c.kind === "mock") await syncModels(c.id).catch(() => {});
  });
  registerJob("trash.purge", async () => {
    purgeTrash();
  });
  registerJob("maintenance", async () => {
    pruneJobs();
    pruneGenerations();
    // The checkpoint waits for writers, so not while a reply streams; the next run does it.
    if (!activeGenerations().length) tidyDb();
  });
  registerJob("db.check", async () => {
    checkDb();
  });

  // Memory (Phase 1): segmentation, summaries, embeddings, all in the background (SUM-07).
  onLedgerEdit(onLedgerChange);
  registerJob("memory.segment", async (p, job) => segmentChat(String(p.chatId), job));
  registerJob("memory.build", async (p, job) => runBuildJob(p as { chatId: string; summaryId: string; instruction?: string; propose?: boolean }, job));
  registerJob("memory.embed", async (p, job) => embedChat(String(p.chatId), job));
  // Phase 3: journals, sleep (consolidation), story-born lore, the continuity checker.
  registerJob("memory.journal", async (p, job) => runJournalJob(String(p.chatId), job));
  registerJob("lore.chronicle", async (p, job) => {
    await runChronicle(String(p.chatId), job);
  });
  registerJob("lore.embed", async () => {
    await embedLore();
  });
  // Phase 4: the Lore Studio writes drafted entries one at a time, in plan order.
  registerJob("lore.studio", async (p, job) => runStudioJob(String(p.draftId), job));
  registerJob("creator.write", async (p, job) => runCreatorJob(String(p.draftId), job));
  registerJob("lore.enrich", async (p, job) => runEnrichJob(String(p.bookId), job));
  registerJob("accuracy.check", async (p, job) => runCheckJob(p as { chatId: string; messageId: string; swipeIdx: number }, job));
  registerJob("memory.consolidate", async (p, job) => {
    await consolidate(String(p.chatId), job);
  });
  // Trackers (Phase 2): read after each reply, never in the way (TRK-03).
  onLedgerEdit(trackerLedgerHook);
  registerJob("tracker.update", async (p, job) => runTrackerUpdate(p as { chatId: string; messageId: string; swipeIdx: number }, job));
  registerJob("tracker.init", async (p, job) => runTrackerInit(p as { chatId: string }, job));
  // The world off the page (Phase 2): ticks once the story clock moves; the model only tells.
  onTrackerUpdate(worldAfterReply);
  // Phase 5 guards: the timeline check once the clock has moved (CON-12), the voice now and then (CON-10).
  onTrackerUpdate(recordTimeline);
  // B2: secrets' exposure clocks move for what the reply showed.
  onTrackerUpdate(exposureAfterReply);
  // E1: important people draw a hidden pressure, and it grows over scenes.
  onTrackerUpdate(pressuresAfterReply);
  // E3: promises said in the reply or your message become ledger lines, with a chip and Undo.
  onTrackerUpdate(promisesAfterReply);
  // F3: what your own message states about you (things you have, your birthday), each a chip.
  onTrackerUpdate(asidesAfterReply);
  // J3: the soundtrack changes on story beats (YouTube Music, only when you've turned it on).
  onTrackerUpdate(musicAfterReply);
  registerJob("accuracy.drift", async (p, job) => runDriftJob(String(p.chatId), job));
  // Speaker marks a reply left out, named by the helper.
  registerJob("speakers.mark", async (p, job) => runSpeakerMarksJob(p as Parameters<typeof runSpeakerMarksJob>[0], job));
  // STEER-03: the post-pass editor, after a reply.
  registerJob("steer.edit", async (p, job) => runEditorJob(p as { chatId: string; messageId: string; swipeIdx: number }, job));
  // A1: lessons from the takes you kept and the replies you edited.
  registerJob("lessons.learn", async (p, job) => runLessonsJob(p as { chatId: string; messageId: string }, job));
  // B1: the helper's rewording of memory and lore that state a secret kept off the page.
  registerJob("offpage.reword", async (p, job) => runRewordJob(p as { chatId: string; key: string; text: string }, job));
  // C1: "Suggest from the wiki" for the canon cutoff.
  registerJob("canon.suggest", async (p, job) => void (await suggestCanon(String(p.chatId), job)));
  registerJob("lessons.edit", async (p, job) => runLessonsJob(p as { chatId: string; messageId: string; before: string; after: string }, job));
  // DATA-05 / PERF-11: memory files come in as a chunked background job.
  registerJob("memory.import", async (p, job) => runMemoryImport(p as { chatId: string; file: string; mode: "merge" | "replace" }, job));
  setElsewhereLane((chatId) => worldLane(chatId));
  registerJob("world.tell", async (p, job) => runTelling(p as Parameters<typeof runTelling>[0], job));
  registerJob("cache.probe", async (p) => {
    if (p.connectionId && p.modelId) await probeCache(String(p.connectionId), String(p.modelId));
    else await runDueProbes();
  });

  if (opts.jobs !== false) {
    startJobs();
    schedule("backup.scheduled", 60 * 60_000, { runNow: true });
    schedule("quota.refresh", 5 * 60_000, { runNow: true });
    schedule("catalog.sync", 24 * 3600_000);
    schedule("trash.purge", 24 * 3600_000, { runNow: true });
    schedule("maintenance", 6 * 3600_000, { runNow: true });
    schedule("db.check", 24 * 3600_000);
    schedule("cache.probe", 24 * 3600_000);
  }
}
