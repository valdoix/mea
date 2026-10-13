<script lang="ts">
  import EntryEditor from "../components/lore/EntryEditor.svelte";
  import Menu, { type MenuItem } from "../components/Menu.svelte";
  import Segmented from "../components/Segmented.svelte";
  import { del, download, get, post, put } from "../lib/api";
  import { confirm } from "../lib/dialogs.svelte";
  import { ArrowDown, ArrowLeft, ArrowUp, ChevronDown, ChevronRight, Download, Folder, Globe, Plus, Search, Stethoscope, Trash, WandSparkles, X } from "../lib/icons";
  import { navigate } from "../lib/router.svelte";
  import { app, errorToast, toast } from "../lib/state.svelte";
  import { route } from "../lib/router.svelte";
  import { tick } from "svelte";
  import type { CharacterSummary, LoreEntry, Lorebook, LoreHealth, LoreTrace, Persona } from "../lib/types";

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

  // LORE-13: health check.
  let health = $state<LoreHealth | null>(null);
  let folder = $state("");
  async function checkHealth() {
    try {
      health = await get<LoreHealth>(`/api/lorebooks/${id}/health`);
    } catch (e) {
      errorToast(e);
    }
  }
  const titleOf = (eid: string) => {
    const e = book?.entries.find((x) => x.id === eid);
    return e ? e.comment || e.keys.slice(0, 2).join(", ") || "Untitled" : "?";
  };
  async function openEntry(eid: string) {
    open[eid] = true;
    filter = "";
    folder = "";
    await tick();
    document.getElementById(`entry-${eid}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
  }
  const folderOf = (e: LoreEntry) => String((e.extra as { folder?: string } | undefined)?.folder ?? "");
  const folders = $derived([...new Set((book?.entries ?? []).map(folderOf).filter(Boolean))].sort());
  const siblings = $derived((book?.entries ?? []).map((e) => ({ id: e.id, title: e.comment || e.keys[0] || "Untitled" })));

  async function load() {
    try {
      book = await get<Lorebook>(`/api/lorebooks/${id}`);
      if (route.query.entry) void openEntry(route.query.entry);
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
    try {
      await del(`/api/lorebooks/${id}/entries/${e.id}`);
    } catch (err) {
      errorToast(err);
      return;
    }
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
    try {
      await del(`/api/lorebooks/${id}`);
    } catch (err) {
      errorToast(err);
      return;
    }
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
  // ---------- I1: categories ----------
  interface CatInfo {
    id: string;
    label: string;
    hint: string;
  }
  let categories = $state<CatInfo[]>([]);
  let guesses = $state<Record<string, { category: string; confidence: number; why: string; guessed: boolean }>>({});
  let catFilter = $state("");
  let sorting = $state(false);
  const catOf = (e: LoreEntry) => (e.extra as { category?: string } | undefined)?.category ?? null;
  const confOf = (e: LoreEntry) => (catOf(e) ? ((e.extra as { categoryConfidence?: number }).categoryConfidence ?? 1) : (guesses[e.id]?.confidence ?? 0));
  const dot = (c: number) => (c >= 0.75 ? "high" : c >= 0.5 ? "mid" : "low");
  async function loadGuesses() {
    try {
      const r = await post<{ entries: { entryId: string; category: string; confidence: number; why: string; guessed: boolean }[]; categories: CatInfo[] }>(`/api/lorebooks/${id}/autosort`, {});
      categories = r.categories;
      guesses = Object.fromEntries(r.entries.map((x) => [x.entryId, x]));
    } catch {
      // categories are optional
    }
  }
  $effect(() => {
    if (book?.id) void loadGuesses();
  });
  async function autoSort() {
    sorting = true;
    try {
      const r = await post<{ entries: { guessed: boolean }[] }>(`/api/lorebooks/${id}/autosort`, { apply: true, defaults: true, onlyNew: true });
      await load();
      toast(`Sorted ${r.entries.filter((x) => x.guessed).length} entries; tap a category to correct it`, { kind: "ok" });
    } catch (e) {
      errorToast(e);
    } finally {
      sorting = false;
    }
  }
  async function setCategory(entry: LoreEntry, category: string) {
    try {
      const r = await post<LoreEntry>(`/api/lorebooks/${id}/entries/${entry.id}/category`, { category, defaults: !catOf(entry) });
      const i = book?.entries.findIndex((x) => x.id === entry.id) ?? -1;
      if (book && i >= 0) book.entries[i] = { ...book.entries[i]!, ...r };
    } catch (e) {
      errorToast(e);
    }
  }
  const visible = $derived(
    (book?.entries ?? []).filter((e) => (!filter || `${e.comment} ${e.keys.join(" ")} ${e.content}`.toLowerCase().includes(filter.toLowerCase())) && (!folder || folderOf(e) === folder || folderOf(e).startsWith(`${folder} ›`)) && (!catFilter || (catOf(e) ?? guesses[e.id]?.category) === catFilter)),
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
    {#if book.settings.chronicleFor}<a class="notice tiny" href="/chat/{book.settings.chronicleFor}/codex?tab=chronicle">This is a story's Chronicle: Mea proposes entries for what the story introduces, and you review them in the Codex →</a>{/if}

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
        <label class="switch"><input type="checkbox" checked={Boolean(book.settings.semantic)} onchange={(e) => { book!.settings.semantic = e.currentTarget.checked || undefined; saveMeta(); }} /> Entries also fire on meaning, not just keywords <span class="tiny muted">(needs embeddings, Settings → Models)</span></label>
      </details>
    </section>

    <div class="row between wrap entries-head">
      <h2>Entries <span class="muted small">({book.entries.length})</span></h2>
      <div class="row wrap">
        <label class="search input"><Search size={15} /><input bind:value={filter} placeholder="Filter entries" /></label>
        {#if categories.length}
          <select class="select mini" bind:value={catFilter} aria-label="Category"><option value="">All categories</option>{#each categories as c (c.id)}<option value={c.id}>{c.label}</option>{/each}</select>
          <button class="btn" onclick={autoSort} disabled={sorting || !book.entries.length} title="Guess a category for every entry without one, and give it that category's place and priority">{sorting ? "Sorting…" : "Auto-sort this book"}</button>
        {/if}
        {#if folders.length}
          <select class="select mini" bind:value={folder} aria-label="Folder"><option value="">All folders</option>{#each folders as f (f)}<option value={f}>{f}</option>{/each}</select>
        {/if}
        <Segmented value={full ? "full" : "simple"} options={[{ value: "simple", label: "Simple" }, { value: "full", label: "Full" }]} onchange={(v) => { full = v === "full"; localStorage.setItem("mea.loreFull", full ? "1" : "0"); }} small />
        {#if !book.settings.chronicleFor}<button class="btn" onclick={() => navigate(`/lore-studio?book=${id}`)} title="Find what this book is missing and draft it with the Lore Studio"><WandSparkles size={16} /> Grow</button>{/if}
        <button class="btn primary" onclick={addEntry}><Plus size={16} /> Entry</button>
      </div>
    </div>

    <div class="entries">
      {#each book.entries as entry, i (entry.id)}
        {#if visible.includes(entry)}
        <div class="entry card" class:disabled={!entry.enabled} id="entry-{entry.id}">
          <div class="erow">
            <button class="expand" onclick={() => (open[entry.id] = !open[entry.id])} aria-expanded={Boolean(open[entry.id])}>
              {#if open[entry.id]}<ChevronDown size={16} />{:else}<ChevronRight size={16} />{/if}
              <span class="grow">
                <b class="wraps">{entry.comment || entry.keys.slice(0, 3).join(", ") || "Untitled entry"}</b>
                <span class="tiny muted wraps">{entry.constant ? "Always on" : entry.keys.join(", ") || "No keywords"} · {entry.content.slice(0, 90)}</span>
              </span>
            </button>
            {#if folderOf(entry)}<span class="chip tiny hide-sm"><Folder size={11} /> {folderOf(entry).split(" › ").at(-1)}</span>{/if}
            {#if categories.length}
              {@const cur = catOf(entry)}
              <label class="cat chip tiny" class:guess={!cur} title={cur ? (confOf(entry) < 1 ? `Auto-sorted (${guesses[entry.id]?.why ?? "a guess"}); tap to correct` : "Set by you") : `A guess from ${guesses[entry.id]?.why ?? "the entry"}; tap to set`}>
                <i class="dot {dot(confOf(entry))}" aria-hidden="true"></i>
                <select value={cur ?? guesses[entry.id]?.category ?? ""} onchange={(e) => setCategory(entry, e.currentTarget.value)} aria-label="Category of {entry.comment || 'this entry'}">
                  {#each categories as c (c.id)}<option value={c.id} title={c.hint}>{c.label}</option>{/each}
                </select>
              </label>
            {:else if (entry.extra as { type?: string } | undefined)?.type}<span class="chip tiny hide-sm">{(entry.extra as { type?: string }).type}</span>{/if}
            {#if entry.constant}<span class="chip butter">always</span>{/if}
            {#if !filter}
              <button class="btn ghost icon small" onclick={() => move(i, -1)} disabled={i === 0} aria-label="Move up"><ArrowUp size={14} /></button>
              <button class="btn ghost icon small" onclick={() => move(i, 1)} disabled={i === book.entries.length - 1} aria-label="Move down"><ArrowDown size={14} /></button>
            {/if}
            <button class="btn ghost icon small" onclick={() => removeEntry(entry)} aria-label="Delete entry"><Trash size={14} /></button>
          </div>
          {#if open[entry.id]}
            <div class="ebody" oninput={() => saveEntry(entry)} onchange={() => saveEntry(entry)} role="group">
              <EntryEditor bind:entry={book.entries[i]} {full} {siblings} onchange={() => saveEntry(entry)} />
            </div>
          {/if}
        </div>
        {/if}
      {/each}
      {#if !visible.length}
        <p class="muted small">{filter ? "No entries match." : "No entries yet. Add the first one."}</p>
      {/if}
    </div>

    <section class="panel stack">
      <div class="row between"><h3><Stethoscope size={16} /> Health check</h3><button class="btn small" onclick={checkHealth}>{health ? "Check again" : "Check"}</button></div>
      {#if health}
        <div class="tiny muted">{health.entries} entries · always-on cost {health.cost.constantTokens} tokens · all entries {health.cost.totalTokens} tokens · budget {health.cost.budget}{health.cost.averageTriggeredTokens ? ` · a fired entry averages ${health.cost.averageTriggeredTokens}` : ""}</div>
        {#each health.issues as iss, k (k)}
          <div class="issue small" class:warn={iss.severity === "warn"}>
            <span class="chip tiny">{iss.kind.replace(/-/g, " ")}</span> {iss.message}
            {#each iss.entries.slice(0, 4) as eid (eid)}<button class="link tiny" onclick={() => openEntry(eid)}>{titleOf(eid)}</button>{/each}
          </div>
        {:else}
          <p class="tiny muted">No problems found.</p>
        {/each}
        {#if health.cost.top.length}
          <details>
            <summary class="tiny">Biggest entries</summary>
            {#each health.cost.top as t (t.id)}<div class="tiny"><button class="link" onclick={() => openEntry(t.id)}>{t.title}</button> · {t.tokens} tokens{t.constant ? " · always on" : ` · fired ${t.hits}×`}</div>{/each}
          </details>
        {/if}
      {/if}
    </section>

    <section class="panel stack test">
      <h3>Test activation</h3>
      <textarea class="textarea" rows="3" bind:value={testText} placeholder="Paste a few lines of story to see which entries would fire"></textarea>
      <div class="row"><button class="btn small" onclick={runTest} disabled={!testText.trim()}>Test</button></div>
      {#if trace}
        <div class="stack tight">
          {#each trace as t (t.id)}
            <div class="row small" class:muted={t.status !== "active"}>
              <span class="chip {t.status === 'active' ? 'mint' : ''}">{t.status === "active" ? "fires" : "skipped"}</span>
              <b class="wraps">{t.comment}</b>
              <span class="tiny muted wraps">{t.reason}{t.tokens ? ` · ${t.tokens} tokens` : ""}</span>
            </div>
          {/each}
        </div>
      {/if}
    </section>
  </div>
{/if}

<Menu bind:open={exportOpen} items={exportItems} anchor={exportBtn} title="Export" />

<style>
  .cat {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    padding-right: 0.2rem;
  }
  .cat select {
    border: 0;
    background: none;
    color: inherit;
    font: inherit;
    cursor: pointer;
    max-width: 8.5rem;
  }
  .cat.guess {
    opacity: 0.65;
    border-style: dashed;
  }
  .dot {
    width: 0.45rem;
    height: 0.45rem;
    border-radius: 50%;
    display: inline-block;
  }
  .dot.high {
    background: var(--mint, #82e3d3);
  }
  .dot.mid {
    background: var(--warn, #ffb86b);
  }
  .dot.low {
    background: var(--danger);
  }
  .issue {
    border-top: 1px solid var(--border);
    padding-top: 0.35rem;
  }
  .issue.warn :global(.chip) {
    background: color-mix(in srgb, var(--danger) 15%, var(--surface));
  }
  .link {
    border: 0;
    background: none;
    color: var(--accent-ink);
    cursor: pointer;
    padding: 0 0.25rem;
  }
  .page {
    max-width: 54rem;
    margin: 0 auto;
    padding: 1.2rem clamp(1rem, 3vw, 2rem) 5rem;
    display: grid;
    grid-template-columns: minmax(0, 1fr);
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
