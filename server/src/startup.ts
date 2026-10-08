import { ensureDirs, paths } from "./config";
import { openDb, run } from "./db/db";
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
import { onLedgerChange, runBuildJob, segmentChat } from "./memory/scheduler";
import { probeCache, runDueProbes } from "./services/probe";

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
  openDb(opts.dbFile ?? paths.db);
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
  });

  // Memory (Phase 1): segmentation, summaries, embeddings, all in the background (SUM-07).
  onLedgerEdit(onLedgerChange);
  registerJob("memory.segment", async (p, job) => segmentChat(String(p.chatId), job));
  registerJob("memory.build", async (p, job) => runBuildJob(p as { chatId: string; summaryId: string; instruction?: string; propose?: boolean }, job));
  registerJob("memory.embed", async (p, job) => embedChat(String(p.chatId), job));
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
    schedule("cache.probe", 24 * 3600_000);
  }
}
