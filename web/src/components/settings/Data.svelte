<script lang="ts">
  import { api, download, get, post } from "../../lib/api";
  import { confirm } from "../../lib/dialogs.svelte";
  import { bytes, clock } from "../../lib/format";
  import { Database, Download, Import } from "../../lib/icons";
  import { app, errorToast, saveSetting, toast } from "../../lib/state.svelte";

  let backups = $state<{ file: string; kind: string; bytes: number; createdAt: number }[]>([]);
  let busy = $state(false);
  let fileInput = $state<HTMLInputElement | null>(null);

  async function load() {
    try {
      backups = (await get<{ backups: typeof backups }>("/api/backups")).backups;
    } catch (e) {
      errorToast(e);
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
