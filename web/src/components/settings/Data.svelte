<script lang="ts">
  import { api, download, get, post, put } from "../../lib/api";
  import { confirm } from "../../lib/dialogs.svelte";
  import { bytes, clock, timeAgo } from "../../lib/format";
  import { Database, Download, HardDrive, Import } from "../../lib/icons";
  import { app, errorToast, saveSetting, toast } from "../../lib/state.svelte";

  let backups = $state<{ file: string; kind: string; bytes: number; createdAt: number }[]>([]);
  let busy = $state(false);
  let fileInput = $state<HTMLInputElement | null>(null);

  interface Mirror {
    dir: string;
    encrypt: boolean;
    keep: number;
    lastAt: number | null;
    lastError: string | null;
    hasPassphrase: boolean;
  }
  let mirror = $state<Mirror | null>(null);
  let mirrorForm = $state({ dir: "", keep: 14, encrypt: false, passphrase: "" });
  let mirrorBusy = $state(false);

  async function load() {
    try {
      const [b, m] = await Promise.all([get<{ backups: typeof backups }>("/api/backups"), get<Mirror>("/api/backups/mirror")]);
      backups = b.backups;
      mirror = m;
      mirrorForm = { dir: m.dir, keep: m.keep, encrypt: m.encrypt, passphrase: "" };
    } catch (e) {
      errorToast(e);
    }
  }

  async function saveMirror() {
    mirrorBusy = true;
    try {
      mirror = await put<Mirror>("/api/backups/mirror", {
        dir: mirrorForm.dir,
        keep: mirrorForm.keep,
        encrypt: mirrorForm.encrypt,
        passphrase: mirrorForm.passphrase || undefined,
      });
      mirrorForm.passphrase = "";
      toast("Saved", { kind: "ok" });
    } catch (e) {
      errorToast(e);
    } finally {
      mirrorBusy = false;
    }
  }

  async function runMirror() {
    mirrorBusy = true;
    try {
      const r = await post<{ copied: string; mirror: Mirror }>("/api/backups/mirror/run");
      mirror = r.mirror;
      toast("Copied the latest backup", { kind: "ok" });
    } catch (e) {
      errorToast(e);
    } finally {
      mirrorBusy = false;
    }
  }
  $effect(() => {
    void load();
  });

  async function backupNow() {
    busy = true;
    try {
      await post("/api/backups");
      toast("Backup created", { kind: "ok" });
      await load();
    } catch (e) {
      errorToast(e);
    } finally {
      busy = false;
    }
  }

  async function restore(b: (typeof backups)[number]) {
    if (!(await confirm({ title: "Restore this backup?", message: `Everything goes back to ${clock(b.createdAt)}. A safety backup of the current state is made first.`, confirmLabel: "Restore", danger: true }))) return;
    try {
      await post(`/api/backups/${encodeURIComponent(b.file)}/restore`);
      toast("Restored. Reloading…", { kind: "ok" });
      setTimeout(() => location.reload(), 800);
    } catch (e) {
      errorToast(e);
    }
  }

  async function importFiles(files: FileList) {
    const form = new FormData();
    for (const f of files) form.append("file", f);
    try {
      const r = await api<{ results: { ok: boolean; file: string; kind?: string; name?: string; error?: string }[] }>("POST", "/api/import", form);
      for (const x of r.results) toast(x.ok ? `Imported ${x.kind}: ${x.name}` : `${x.file}: ${x.error}`, { kind: x.ok ? "ok" : "error" });
    } catch (e) {
      errorToast(e);
    }
  }

  const lore = $derived(app.settings?.["lore.defaults"]);
  function setLore(k: string, v: number | boolean) {
    if (!lore) return;
    void saveSetting("lore.defaults", { ...lore, [k]: v });
  }
  const kindLabel: Record<string, string> = { hourly: "Hourly", daily: "Daily", manual: "Manual", "pre-restore": "Before restore", "pre-migration": "Before update" };
</script>

<div class="stack">
  <section class="panel stack">
    <div class="row between wrap">
      <h2>Backups</h2>
      <button class="btn primary small" onclick={backupNow} disabled={busy}><Database size={15} /> Back up now</button>
    </div>
    <p class="tiny muted">Mea snapshots its database every hour when something changed, plus once a day. It keeps {app.settings?.["backup.hourlyKeep"]} hourly and {app.settings?.["backup.dailyKeep"]} daily copies.</p>
    <div class="list">
      {#each backups.slice(0, 30) as b (b.file)}
        <div class="row small">
          <span class="chip">{kindLabel[b.kind] ?? b.kind}</span>
          <span class="grow">{clock(b.createdAt)}</span>
          <span class="tiny muted">{bytes(b.bytes)}</span>
          <button class="btn ghost small" onclick={() => restore(b)}>Restore</button>
        </div>
      {:else}
        <p class="tiny muted">No backups yet. The first one is made a minute after Mea starts.</p>
      {/each}
    </div>
  </section>

  {#if mirror}
    <section class="panel stack">
      <h2>Copy backups elsewhere</h2>
      <p class="tiny muted">
        Once a day Mea copies its newest backup to a second folder, such as another drive or a synced folder (OneDrive, Dropbox), so a dead disk doesn't take your stories with it.
      </p>
      <label class="field">
        <span class="label">Folder</span>
        <input class="input" bind:value={mirrorForm.dir} placeholder="D:\Backups\Mea" />
        <span class="hint">A full path. Leave empty to turn this off.</span>
      </label>
      <div class="grid">
        <label class="field"><span class="label">Keep</span><input class="input" type="number" min="1" max="90" bind:value={mirrorForm.keep} /><span class="hint">copies</span></label>
      </div>
      <label class="switch"><input type="checkbox" bind:checked={mirrorForm.encrypt} /> Encrypt the copies with a passphrase</label>
      {#if mirrorForm.encrypt}
        <label class="field">
          <span class="label">Passphrase {#if mirror.hasPassphrase}<span class="faint">(set; type a new one to change it)</span>{/if}</span>
          <input class="input" type="password" autocomplete="new-password" bind:value={mirrorForm.passphrase} placeholder={mirror.hasPassphrase ? "••••••••" : "Choose a passphrase"} />
          <span class="hint">Write it down. Without it, the encrypted copies can't be restored.</span>
        </label>
      {/if}
      <div class="row wrap between">
        <span class="tiny muted">
          {#if mirror.lastError}<span class="err">Last copy failed: {mirror.lastError}</span>{:else if mirror.lastAt}Last copy {timeAgo(mirror.lastAt)}{:else if mirror.dir}No copy yet{/if}
        </span>
        <div class="row">
          <button class="btn small" onclick={runMirror} disabled={mirrorBusy || !mirror.dir}><HardDrive size={14} /> Copy now</button>
          <button class="btn primary small" onclick={saveMirror} disabled={mirrorBusy || (mirrorForm.encrypt && !mirror.hasPassphrase && !mirrorForm.passphrase)}>Save</button>
        </div>
      </div>
    </section>
  {/if}

  <section class="panel stack">
    <h2>Import & export</h2>
    <div class="row wrap">
      <button class="btn" onclick={() => fileInput?.click()}><Import size={16} /> Import files</button>
      <button class="btn" onclick={() => download("/api/export/library")}><Download size={16} /> Export everything (.zip)</button>
      <input bind:this={fileInput} type="file" multiple accept=".png,.json,.charx" hidden onchange={(e) => e.currentTarget.files && importFiles(e.currentTarget.files)} />
    </div>
    <p class="tiny muted">Imports character cards (PNG, JSON, CHARX), SillyTavern lorebooks, chat-completion presets, and personas. The export zip holds the database and every image.</p>
  </section>

  {#if lore}
    <section class="panel stack">
      <h2>Lorebook scanning defaults</h2>
      <div class="grid">
        <label class="field"><span class="label">Scan depth <span class="faint">messages</span></span><input class="input" type="number" min="0" value={lore.scanDepth} onchange={(e) => setLore("scanDepth", Number(e.currentTarget.value))} /></label>
        <label class="field"><span class="label">Token budget</span><input class="input" type="number" min="0" step="128" value={lore.tokenBudget} onchange={(e) => setLore("tokenBudget", Number(e.currentTarget.value))} /></label>
        <label class="field"><span class="label">Recursion steps</span><input class="input" type="number" min="0" max="10" value={lore.maxRecursion} onchange={(e) => setLore("maxRecursion", Number(e.currentTarget.value))} /></label>
      </div>
      <div class="row wrap" style="gap:1.2rem">
        <label class="switch"><input type="checkbox" checked={lore.recursive} onchange={(e) => setLore("recursive", e.currentTarget.checked)} /> Entries can trigger other entries</label>
        <label class="switch"><input type="checkbox" checked={lore.matchWholeWords} onchange={(e) => setLore("matchWholeWords", e.currentTarget.checked)} /> Match whole words</label>
        <label class="switch"><input type="checkbox" checked={lore.caseSensitive} onchange={(e) => setLore("caseSensitive", e.currentTarget.checked)} /> Case sensitive</label>
      </div>
    </section>
  {/if}
</div>

<style>
  .err {
    color: var(--danger);
  }
  .list {
    display: grid;
    gap: 0.35rem;
    max-height: 22rem;
    overflow-y: auto;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(10rem, 1fr));
    gap: 0.8rem;
  }
</style>
