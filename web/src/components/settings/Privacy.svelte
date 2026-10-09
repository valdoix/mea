<script lang="ts">
  import { download, get, post } from "../../lib/api";
  import { confirm } from "../../lib/dialogs.svelte";
  import { bytes } from "../../lib/format";
  import { Download, HardDrive, Lock, LockOpen, Trash } from "../../lib/icons";
  import { app, errorToast, saveSetting, toast } from "../../lib/state.svelte";

  // DATA-06: what takes space, and what can be reclaimed.
  interface StorageReport {
    database: { bytes: number; wal: number; freeBytes: number };
    images: { bytes: number; files: number };
    backups: { bytes: number; files: number };
    logs: { bytes: number; files: number };
    chats: { id: string; title: string; character: string | null; deleted: boolean; messages: number; text: number; requests: number; memory: number; vectors: number; total: number }[];
    characters: { id: string; name: string; deleted: boolean; images: number; chats: number; chatBytes: number }[];
    reclaimable: { freePages: number; requestBodies: { count: number; bytes: number }; trash: { chats: number; bytes: number }; images: { count: number; bytes: number } };
  }
  let report = $state<StorageReport | null>(null);
  let busy = $state("");
  let view = $state<"chats" | "characters">("chats");
  let showAll = $state(false);

  // SEC-05
  let vault = $state<{ enabled: boolean; locked: boolean } | null>(null);
  let pass = $state({ current: "", next: "", again: "" });

  // SEC-06
  let logs = $state<{ file: string; bytes: number }[]>([]);
  const rl = $derived(app.settings?.["privacy.requestLog"]);

  async function load() {
    try {
      [report, vault, logs] = await Promise.all([get<StorageReport>("/api/storage"), get<{ enabled: boolean; locked: boolean }>("/api/vault/status"), get<{ files: typeof logs }>("/api/logs/requests").then((r) => r.files)]);
    } catch (e) {
      errorToast(e);
    }
  }
  $effect(() => {
    void load();
  });

  async function act<T>(name: string, fn: () => Promise<T>) {
    busy = name;
    try {
      return await fn();
    } catch (e) {
      errorToast(e);
    } finally {
      busy = "";
    }
  }

  const doVacuum = () =>
    act("vacuum", async () => {
      const r = await post<{ saved: number }>("/api/storage/vacuum");
      toast(r.saved ? `Compacted. ${bytes(r.saved)} freed.` : "Compacted. Nothing left to free.", { kind: "ok" });
      await load();
    });

  const cleanLabels = {
    requestBodies: { title: "Clear old request bodies?", message: "The raw text sent to and received from models more than 7 days ago is removed. Costs, timings and token counts stay." },
    trash: { title: "Empty the trash?", message: "Chats, characters and other things you deleted are removed for good. This can't be undone." },
    images: { title: "Remove unused images?", message: "Images nothing points at any more (old avatars, replaced covers) are deleted." },
  };
  async function doClean(what: keyof typeof cleanLabels) {
    if (!(await confirm({ ...cleanLabels[what], confirmLabel: "Remove", danger: what === "trash" }))) return;
    await act(what, async () => {
      const r = await post<{ removed: number }>("/api/storage/clean", { what });
      toast(`Removed ${r.removed.toLocaleString()} item${r.removed === 1 ? "" : "s"}`, { kind: "ok" });
      await load();
    });
  }

  const total = $derived(report ? report.database.bytes + report.database.wal + report.images.bytes + report.backups.bytes + report.logs.bytes : 0);
  const parts = $derived(
    report
      ? [
          { label: "Stories & memory", bytes: report.database.bytes + report.database.wal, tone: "var(--accent)" },
          { label: "Images", bytes: report.images.bytes, tone: "var(--lavender)" },
          { label: "Backups", bytes: report.backups.bytes, tone: "var(--mint)" },
          { label: "Logs", bytes: report.logs.bytes, tone: "var(--peach)" },
        ]
      : [],
  );

  async function enableVault() {
    if (pass.next.length < 8) return toast("Use a passphrase of at least 8 characters", { kind: "error" });
    if (pass.next !== pass.again) return toast("The two passphrases don't match", { kind: "error" });
    const ok = await confirm({
      title: "Encrypt the database?",
      message: "After a restart Mea stays locked until you type this passphrase. If you forget it, your stories can't be recovered. Backups are encrypted too.",
      confirmLabel: "Encrypt",
      danger: true,
    });
    if (!ok) return;
    await act("vault", async () => {
      const r = await post<{ backupsEncrypted: number }>("/api/vault/enable", { passphrase: pass.next });
      toast(`Encrypted${r.backupsEncrypted ? `, with ${r.backupsEncrypted} backups` : ""}`, { kind: "ok" });
      pass = { current: "", next: "", again: "" };
      await load();
    });
  }
  async function disableVault() {
    if (!(await confirm({ title: "Turn encryption off?", message: "The database and its backups are written back as plain files.", confirmLabel: "Turn off" }))) return;
    await act("vault", async () => {
      await post("/api/vault/disable", { passphrase: pass.current });
      toast("Encryption is off", { kind: "ok" });
      pass = { current: "", next: "", again: "" };
      await load();
    });
  }
  async function changePass() {
    if (pass.next.length < 8) return toast("Use a passphrase of at least 8 characters", { kind: "error" });
    if (pass.next !== pass.again) return toast("The two passphrases don't match", { kind: "error" });
    await act("vault", async () => {
      await post("/api/vault/passphrase", { current: pass.current, next: pass.next });
      toast("Passphrase changed", { kind: "ok" });
      pass = { current: "", next: "", again: "" };
    });
  }

  function setLog(k: "bodiesDays" | "rowsDays" | "fileDays" | "fileLog", v: number | boolean) {
    if (!rl) return;
    void saveSetting("privacy.requestLog", { ...rl, [k]: v });
  }
</script>

<div class="stack">
  <section class="panel stack">
    <div class="row between wrap">
      <h2>Storage</h2>
      <button class="btn small" onclick={doVacuum} disabled={!!busy}><HardDrive size={14} /> {busy === "vacuum" ? "Compacting…" : "Compact database"}</button>
    </div>
    {#if report}
      <p class="small"><b>{bytes(total)}</b> in all</p>
      <div class="bar" role="img" aria-label="Storage by kind">
        {#each parts as p (p.label)}<span style="flex:{Math.max(p.bytes, 1)};background:{p.tone}" title="{p.label}: {bytes(p.bytes)}"></span>{/each}
      </div>
      <div class="row wrap tiny legend">
        {#each parts as p (p.label)}<span><i style="background:{p.tone}"></i>{p.label} · {bytes(p.bytes)}</span>{/each}
      </div>

      <h3>Can be reclaimed</h3>
      <div class="list">
        <div class="row small"><span class="grow">Free space inside the database</span><span class="tiny muted">{bytes(report.reclaimable.freePages)}</span><button class="btn ghost small" onclick={doVacuum} disabled={!!busy || !report.reclaimable.freePages}>Compact</button></div>
        <div class="row small"><span class="grow">Request bodies older than 7 days <span class="faint">({report.reclaimable.requestBodies.count.toLocaleString()})</span></span><span class="tiny muted">{bytes(report.reclaimable.requestBodies.bytes)}</span><button class="btn ghost small" onclick={() => doClean("requestBodies")} disabled={!!busy || !report.reclaimable.requestBodies.count}>Clear</button></div>
        <div class="row small"><span class="grow">Trash <span class="faint">({report.reclaimable.trash.chats} chats)</span></span><span class="tiny muted">{bytes(report.reclaimable.trash.bytes)}</span><button class="btn ghost small danger" onclick={() => doClean("trash")} disabled={!!busy}><Trash size={13} /> Empty</button></div>
        <div class="row small"><span class="grow">Unused images <span class="faint">({report.reclaimable.images.count})</span></span><span class="tiny muted">{bytes(report.reclaimable.images.bytes)}</span><button class="btn ghost small" onclick={() => doClean("images")} disabled={!!busy || !report.reclaimable.images.count}>Remove</button></div>
      </div>

      <div class="row between wrap">
        <h3>Biggest</h3>
        <div class="seg row">
          <button class="btn ghost small" class:on={view === "chats"} onclick={() => (view = "chats")}>Chats</button>
          <button class="btn ghost small" class:on={view === "characters"} onclick={() => (view = "characters")}>Characters</button>
        </div>
      </div>
      <div class="list">
        {#if view === "chats"}
          {#each report.chats.slice(0, showAll ? 200 : 8) as c (c.id)}
            <a class="row small item" href="/chat/{c.id}" title="Messages {bytes(c.text)} · requests {bytes(c.requests)} · memory {bytes(c.memory)} · search vectors {bytes(c.vectors)}">
              <span class="grow truncate">{c.title}{#if c.character}<span class="faint"> · {c.character}</span>{/if}{#if c.deleted}<span class="chip">in trash</span>{/if}</span>
              <span class="tiny muted">{c.messages.toLocaleString()} msgs</span>
              <span class="tiny num">{bytes(c.total)}</span>
            </a>
          {:else}<p class="tiny muted">No chats yet.</p>{/each}
          {#if report.chats.length > 8}<button class="btn ghost small" onclick={() => (showAll = !showAll)}>{showAll ? "Show fewer" : `Show all ${report.chats.length}`}</button>{/if}
        {:else}
          {#each report.characters.slice(0, showAll ? 200 : 8) as c (c.id)}
            <a class="row small item" href="/character/{c.id}">
              <span class="grow truncate">{c.name}{#if c.deleted}<span class="chip">in trash</span>{/if}</span>
              <span class="tiny muted">{c.chats} chats · images {bytes(c.images)}</span>
              <span class="tiny num">{bytes(c.images + c.chatBytes)}</span>
            </a>
          {:else}<p class="tiny muted">No characters yet.</p>{/each}
          {#if report.characters.length > 8}<button class="btn ghost small" onclick={() => (showAll = !showAll)}>{showAll ? "Show fewer" : `Show all ${report.characters.length}`}</button>{/if}
        {/if}
      </div>
    {:else}
      <p class="tiny muted">Measuring…</p>
    {/if}
  </section>

  {#if vault}
    <section class="panel stack">
      <h2>{#if vault.enabled}<Lock size={18} />{:else}<LockOpen size={18} />{/if} Encryption at rest</h2>
      {#if vault.enabled}
        <p class="tiny muted">The database and its backups are encrypted with your passphrase. Mea asks for it after every restart.</p>
        <label class="field"><span class="label">Current passphrase</span><input class="input" type="password" autocomplete="current-password" bind:value={pass.current} /></label>
        <div class="grid">
          <label class="field"><span class="label">New passphrase</span><input class="input" type="password" autocomplete="new-password" bind:value={pass.next} /></label>
          <label class="field"><span class="label">Again</span><input class="input" type="password" autocomplete="new-password" bind:value={pass.again} /></label>
        </div>
        <div class="row wrap">
          <button class="btn small" onclick={changePass} disabled={!!busy || !pass.current || !pass.next}>Change passphrase</button>
          <button class="btn small danger" onclick={disableVault} disabled={!!busy || !pass.current}>Turn off</button>
        </div>
      {:else}
        <p class="tiny muted">
          Optional. With a passphrase, the database is kept on disk only in encrypted form. The trade-offs: after a restart Mea waits for the passphrase before anything works, up to ~30 seconds of changes can be lost if the computer loses power, and a forgotten passphrase can't be recovered.
        </p>
        <div class="grid">
          <label class="field"><span class="label">Passphrase</span><input class="input" type="password" autocomplete="new-password" bind:value={pass.next} placeholder="8 characters or more" /></label>
          <label class="field"><span class="label">Again</span><input class="input" type="password" autocomplete="new-password" bind:value={pass.again} /></label>
        </div>
        <div><button class="btn small" onclick={enableVault} disabled={!!busy || pass.next.length < 8}><Lock size={14} /> Encrypt</button></div>
      {/if}
    </section>
  {/if}

  {#if rl}
    <section class="panel stack">
      <h2>Request log</h2>
      <p class="tiny muted">A local record of what was sent to models, for debugging. API keys and passwords are always blanked out before anything is written.</p>
      <div class="grid">
        <label class="field"><span class="label">Keep full text <span class="faint">days</span></span><input class="input" type="number" min="1" max="3650" value={rl.bodiesDays} onchange={(e) => setLog("bodiesDays", Math.max(1, Number(e.currentTarget.value) || 30))} /></label>
        <label class="field"><span class="label">Keep the rows <span class="faint">days, 0 = always</span></span><input class="input" type="number" min="0" value={rl.rowsDays} onchange={(e) => setLog("rowsDays", Math.max(0, Number(e.currentTarget.value) || 0))} /><span class="hint">Costs and usage come from these.</span></label>
      </div>
      <label class="switch"><input type="checkbox" checked={rl.fileLog} onchange={(e) => setLog("fileLog", e.currentTarget.checked)} /> Also write a daily log file</label>
      {#if rl.fileLog}
        <label class="field narrow"><span class="label">Keep log files <span class="faint">days</span></span><input class="input" type="number" min="1" max="3650" value={rl.fileDays} onchange={(e) => setLog("fileDays", Math.max(1, Number(e.currentTarget.value) || 14))} /></label>
      {/if}
      {#if logs.length}
        <div class="list">
          {#each logs as l (l.file)}
            <div class="row small"><span class="grow mono">{l.file.replace(/^requests-|\.jsonl$/g, "")}</span><span class="tiny muted">{bytes(l.bytes)}</span><button class="btn ghost small icon" onclick={() => download(`/api/logs/requests/${l.file}`)} aria-label="Download log for {l.file}"><Download size={14} /></button></div>
          {/each}
        </div>
      {/if}
    </section>
  {/if}
</div>

<style>
  h2 {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }
  h3 {
    font-size: 0.95rem;
    margin: 0.4rem 0 0;
  }
  .bar {
    display: flex;
    height: 0.7rem;
    border-radius: 999px;
    overflow: hidden;
    gap: 2px;
    background: var(--surface-2);
  }
  .legend {
    gap: 0.9rem;
  }
  .legend i {
    display: inline-block;
    width: 0.6rem;
    height: 0.6rem;
    border-radius: 50%;
    margin-right: 0.3rem;
    vertical-align: middle;
  }
  .list {
    display: grid;
    gap: 0.35rem;
  }
  .item {
    color: inherit;
    text-decoration: none;
    padding: 0.2rem 0.3rem;
    border-radius: 6px;
  }
  .item:hover {
    background: var(--surface-2);
  }
  .num {
    min-width: 4.5rem;
    text-align: right;
  }
  .seg .on {
    background: color-mix(in srgb, var(--accent) 16%, transparent);
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(12rem, 1fr));
    gap: 0.8rem;
  }
  .narrow {
    max-width: 12rem;
  }
  .mono {
    font-family: var(--font-mono);
  }
</style>
