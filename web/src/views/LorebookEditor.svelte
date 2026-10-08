<script lang="ts">
  import EntryEditor from "../components/lore/EntryEditor.svelte";
  import Menu, { type MenuItem } from "../components/Menu.svelte";
  import Segmented from "../components/Segmented.svelte";
  import { del, download, get, post, put } from "../lib/api";
  import { confirm } from "../lib/dialogs.svelte";
  import { ArrowDown, ArrowLeft, ArrowUp, ChevronDown, ChevronRight, Download, Globe, Plus, Search, Trash, X } from "../lib/icons";
  import { navigate } from "../lib/router.svelte";
  import { app, errorToast, toast } from "../lib/state.svelte";
  import type { CharacterSummary, LoreEntry, Lorebook, LoreTrace, Persona } from "../lib/types";

  let { id }: { id: string } = $props();

  let book = $state<Lorebook | null>(null);
  let characters = $state<CharacterSummary[]>([]);
  let personas = $state<Persona[]>([]);
  let open = $state<Record<string, boolean>>({});
  let full = $state(localStorage.getItem("mea.loreFull") === "1");
  let filter = $state("");
  let testText = $state("");
  let trace = $state<LoreTrace[] | null>(null);
  let exportOpen = $state(false);
  let exportBtn = $state<HTMLButtonElement | null>(null);
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  let metaTimer: ReturnType<typeof setTimeout>;

  async function load() {
    try {
      book = await get<Lorebook>(`/api/lorebooks/${id}`);
      [characters, personas] = await Promise.all([
        get<{ characters: CharacterSummary[] }>("/api/characters?sort=name").then((r) => r.characters),
        get<{ personas: Persona[] }>("/api/personas").then((r) => r.personas),
      ]);
    } catch (e) {
      errorToast(e);
    }
  }
  $effect(() => {
    void load();
  });

  function saveMeta() {
    clearTimeout(metaTimer);
    metaTimer = setTimeout(async () => {
      if (!book) return;
      try {
        await put(`/api/lorebooks/${id}`, { name: book.name || "Untitled", description: book.description, settings: $state.snapshot(book.settings) });
      } catch (e) {
        errorToast(e);
      }
    }, 500);
  }

  function saveEntry(entry: LoreEntry) {
    clearTimeout(timers.get(entry.id));
    timers.set(
      entry.id,
      setTimeout(async () => {
        const { id: entryId, ...data } = $state.snapshot(entry);
        try {
          await put(`/api/lorebooks/${id}/entries/${entryId}`, data);
        } catch (e) {
          errorToast(e);
        }
      }, 500),
    );
  }

  async function addEntry() {
    if (!book) return;
    const e = await post<LoreEntry>(`/api/lorebooks/${id}/entries`, {});
    book.entries.push(e);
    open[e.id] = true;
  }

  async function removeEntry(e: LoreEntry) {
    if (!book) return;
    if (!(await confirm({ title: "Delete this entry?", message: e.comment || e.keys.join(", "), confirmLabel: "Delete", danger: true }))) return;
    await del(`/api/lorebooks/${id}/entries/${e.id}`);
    book.entries = book.entries.filter((x) => x.id !== e.id);
  }

  async function move(i: number, dir: -1 | 1) {
    if (!book) return;
    const j = i + dir;
    if (j < 0 || j >= book.entries.length) return;
    const list = [...book.entries];
    [list[i], list[j]] = [list[j]!, list[i]!];
    book.entries = list;
    await post(`/api/lorebooks/${id}/order`, { ids: list.map((e) => e.id) });
  }

  async function setLink(type: "global" | "character" | "persona", targetId: string, on: boolean) {
    try {
      book = on ? await post<Lorebook>(`/api/lorebooks/${id}/links`, { type, id: targetId }) : await del<Lorebook>(`/api/lorebooks/${id}/links`, { type, id: targetId });
    } catch (e) {
      errorToast(e);
    }
  }

  async function removeBook() {
    if (!book || !(await confirm({ title: `Move “${book.name}” to the trash?`, confirmLabel: "Move to trash", danger: true }))) return;
    await del(`/api/lorebooks/${id}`);
    toast("Lorebook moved to trash", { action: { label: "Undo", run: () => void post(`/api/lorebooks/${id}/restore`).then(() => navigate(`/lorebooks/${id}`)) } });
    navigate("/lorebooks");
  }

  async function runTest() {
    try {
      trace = (await post<{ trace: LoreTrace[] }>(`/api/lorebooks/${id}/test`, { text: testText })).trace;
    } catch (e) {
      errorToast(e);
    }
  }

  const isGlobal = $derived(book?.links.some((l) => l.type === "global") ?? false);
  const linkedChars = $derived(characters.filter((c) => book?.links.some((l) => l.type === "character" && l.id === c.id)));
  const linkedPersonas = $derived(personas.filter((p) => book?.links.some((l) => l.type === "persona" && l.id === p.id)));
  const chatLinks = $derived(book?.links.filter((l) => l.type === "chat").length ?? 0);
  const visible = $derived(
    (book?.entries ?? []).filter((e) => !filter || `${e.comment} ${e.keys.join(" ")} ${e.content}`.toLowerCase().includes(filter.toLowerCase())),
  );

  const exportItems: MenuItem[] = [
    { label: "SillyTavern World Info (.json)", icon: Download, onclick: () => download(`/api/lorebooks/${id}/export?format=st`) },
    { label: "Character book (V2 format)", icon: Download, onclick: () => download(`/api/lorebooks/${id}/export?format=card`) },
  ];
</script>

{#if book}
  <div class="page">
    <button class="btn ghost small" onclick={() => navigate("/lorebooks")}><ArrowLeft size={15} /> Lorebooks</button>
    <div class="head">
      <input class="title" bind:value={book.name} oninput={saveMeta} aria-label="Lorebook name" />
      <div class="row">
        <button class="btn icon" bind:this={exportBtn} onclick={() => (exportOpen = true)} aria-label="Export"><Download size={17} /></button>
        <button class="btn icon" onclick={removeBook} aria-label="Delete lorebook"><Trash size={17} /></button>
      </div>
    </div>
    <textarea class="textarea desc" rows="2" bind:value={book.description} oninput={saveMeta} placeholder="What this lorebook covers (not sent to the model)"></textarea>

    <section class="panel stack scope">
      <h3>Where it applies</h3>
      <label class="switch"><input type="checkbox" checked={isGlobal} onchange={(e) => setLink("global", "", e.currentTarget.checked)} /> <Globe size={15} /> Every chat (global)</label>
      <div class="row wrap">
        <span class="tiny muted label">Characters</span>
        {#each linkedChars as c (c.id)}<span class="chip rose">{c.name}<button class="x" onclick={() => setLink("character", c.id, false)} aria-label="Unlink {c.name}"><X size={11} /></button></span>{/each}
        <select class="select mini" onchange={(e) => { if (e.currentTarget.value) { void setLink("character", e.currentTarget.value, true); e.currentTarget.value = ""; } }}>
          <option value="">Add…</option>
          {#each characters.filter((c) => !linkedChars.includes(c)) as c (c.id)}<option value={c.id}>{c.name}</option>{/each}
        </select>
      </div>
      <div class="row wrap">
        <span class="tiny muted label">Personas</span>
        {#each linkedPersonas as p (p.id)}<span class="chip lavender">{p.name}<button class="x" onclick={() => setLink("persona", p.id, false)} aria-label="Unlink {p.name}"><X size={11} /></button></span>{/each}
        <select class="select mini" onchange={(e) => { if (e.currentTarget.value) { void setLink("persona", e.currentTarget.value, true); e.currentTarget.value = ""; } }}>
          <option value="">Add…</option>
          {#each personas.filter((p) => !linkedPersonas.includes(p)) as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
        </select>
      </div>
      {#if chatLinks}<span class="tiny muted">Also linked to {chatLinks} chat{chatLinks > 1 ? "s" : ""} (manage from the chat's panel).</span>{/if}
      <details>
        <summary class="small"><b>Scanning settings</b> <span class="muted">(overrides for this book)</span></summary>
        <div class="grid3">
          <label class="field"><span class="label">Scan depth</span><input class="input" type="number" min="0" placeholder={String(app.settings?.["lore.defaults"].scanDepth ?? 4)} value={book.settings.scanDepth ?? ""} oninput={(e) => { book!.settings.scanDepth = e.currentTarget.value === "" ? undefined : Number(e.currentTarget.value); saveMeta(); }} /></label>
          <label class="field">
            <span class="label">Case sensitive</span>
            <select class="select" value={String(book.settings.caseSensitive ?? "")} onchange={(e) => { book!.settings.caseSensitive = e.currentTarget.value === "" ? undefined : e.currentTarget.value === "true"; saveMeta(); }}><option value="">App default</option><option value="true">Yes</option><option value="false">No</option></select>
          </label>
          <label class="field">
            <span class="label">Whole words</span>
            <select class="select" value={String(book.settings.matchWholeWords ?? "")} onchange={(e) => { book!.settings.matchWholeWords = e.currentTarget.value === "" ? undefined : e.currentTarget.value === "true"; saveMeta(); }}><option value="">App default</option><option value="true">Yes</option><option value="false">No</option></select>
          </label>
        </div>
      </details>
    </section>

    <div class="row between wrap entries-head">
      <h2>Entries <span class="muted small">({book.entries.length})</span></h2>
      <div class="row wrap">
        <label class="search input"><Search size={15} /><input bind:value={filter} placeholder="Filter entries" /></label>
        <Segmented value={full ? "full" : "simple"} options={[{ value: "simple", label: "Simple" }, { value: "full", label: "Full" }]} onchange={(v) => { full = v === "full"; localStorage.setItem("mea.loreFull", full ? "1" : "0"); }} small />
        <button class="btn primary" onclick={addEntry}><Plus size={16} /> Entry</button>
      </div>
    </div>

    <div class="entries">
      {#each book.entries as entry, i (entry.id)}
        {#if visible.includes(entry)}
        <div class="entry card" class:disabled={!entry.enabled}>
          <div class="erow">
            <button class="expand" onclick={() => (open[entry.id] = !open[entry.id])} aria-expanded={Boolean(open[entry.id])}>
              {#if open[entry.id]}<ChevronDown size={16} />{:else}<ChevronRight size={16} />{/if}
              <span class="grow">
                <b class="truncate">{entry.comment || entry.keys.slice(0, 3).join(", ") || "Untitled entry"}</b>
                <span class="tiny muted truncate">{entry.constant ? "Always on" : entry.keys.join(", ") || "No keywords"} · {entry.content.slice(0, 90)}</span>
              </span>
            </button>
            {#if entry.constant}<span class="chip butter">always</span>{/if}
            {#if !filter}
              <button class="btn ghost icon small" onclick={() => move(i, -1)} disabled={i === 0} aria-label="Move up"><ArrowUp size={14} /></button>
              <button class="btn ghost icon small" onclick={() => move(i, 1)} disabled={i === book.entries.length - 1} aria-label="Move down"><ArrowDown size={14} /></button>
            {/if}
            <button class="btn ghost icon small" onclick={() => removeEntry(entry)} aria-label="Delete entry"><Trash size={14} /></button>
          </div>
          {#if open[entry.id]}
            <div class="ebody" oninput={() => saveEntry(entry)} onchange={() => saveEntry(entry)} role="group">
              <EntryEditor bind:entry={book.entries[i]} {full} />
            </div>
          {/if}
        </div>
        {/if}
      {/each}
      {#if !visible.length}
        <p class="muted small">{filter ? "No entries match." : "No entries yet. Add the first one."}</p>
      {/if}
    </div>

    <section class="panel stack test">
      <h3>Test activation</h3>
      <textarea class="textarea" rows="3" bind:value={testText} placeholder="Paste a few lines of story to see which entries would fire"></textarea>
      <div class="row"><button class="btn small" onclick={runTest} disabled={!testText.trim()}>Test</button></div>
      {#if trace}
        <div class="stack tight">
          {#each trace as t (t.id)}
            <div class="row small" class:muted={t.status !== "active"}>
              <span class="chip {t.status === 'active' ? 'mint' : ''}">{t.status === "active" ? "fires" : "skipped"}</span>
              <b class="truncate">{t.comment}</b>
              <span class="tiny muted truncate">{t.reason}{t.tokens ? ` · ${t.tokens} tokens` : ""}</span>
            </div>
          {/each}
        </div>
      {/if}
    </section>
  </div>
{/if}

<Menu bind:open={exportOpen} items={exportItems} anchor={exportBtn} title="Export" />

<style>
  .page {
    max-width: 54rem;
    margin: 0 auto;
    padding: 1.2rem clamp(1rem, 3vw, 2rem) 5rem;
    display: grid;
    gap: 1rem;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 0.8rem;
  }
  .title {
    flex: 1;
    min-width: 0;
    border: 0;
    background: none;
    color: var(--text);
    font: 600 1.8rem/1.2 var(--font-display);
    font-variation-settings: "SOFT" 100;
    padding: 0.2rem 0;
    outline: none;
    border-bottom: 2px solid transparent;
  }
  .title:focus {
    border-bottom-color: var(--accent);
  }
  .desc {
    min-height: 3rem;
  }
  .scope .label {
    min-width: 5.5rem;
    font-weight: 700;
  }
  .mini {
    width: auto;
    padding-top: 0.3rem;
    padding-bottom: 0.3rem;
    font-size: var(--fs-xs);
  }
  .x {
    border: 0;
    background: none;
    display: grid;
    place-items: center;
    cursor: pointer;
    color: inherit;
    padding: 0;
  }
  .grid3 {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(11rem, 1fr));
    gap: 0.8rem;
    margin-top: 0.8rem;
  }
  .entries-head {
    gap: 0.6rem;
    margin-top: 0.5rem;
  }
  .search {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    width: 12rem;
    border-radius: var(--r-pill);
    padding: 0.4rem 0.8rem;
  }
  .search input {
    border: 0;
    background: none;
    outline: none;
    font: inherit;
    color: var(--text);
    width: 100%;
  }
  .entries {
    display: grid;
    gap: 0.5rem;
  }
  .entry.disabled {
    opacity: 0.6;
  }
  .erow {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.35rem 0.5rem 0.35rem 0.25rem;
  }
  .expand {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    border: 0;
    background: none;
    color: var(--text);
    cursor: pointer;
    text-align: left;
    padding: 0.4rem;
    font: inherit;
  }
  .expand .grow {
    display: grid;
  }
  .ebody {
    padding: 0.4rem 1rem 1rem;
    border-top: 1px solid var(--border);
  }
  .test {
    margin-top: 1rem;
  }
</style>
