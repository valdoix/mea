<script lang="ts">
  import { get, post } from "../../../lib/api";
  import { confirm, promptText } from "../../../lib/dialogs.svelte";
  import { LORE_CATEGORIES } from "../../../lib/lorecats";
  import { autosize } from "../../../lib/gestures";
  import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, ListTree, PenLine, Plus, RefreshCw, Trash, UserSearch } from "../../../lib/icons";
  import { LORE_TYPES, type StudioSession, typeMeta, uncovered } from "../../../lib/studio.svelte";
  import { errorToast } from "../../../lib/state.svelte";
  import type { Lorebook, LoreType, StudioDraft, StudioItem } from "../../../lib/types";
  import StudioOptions from "./StudioOptions.svelte";
  import ResearchPanel from "../../studio/ResearchPanel.svelte";

  let { session }: { session: StudioSession } = $props();
  const draft = $derived(session.draft!);
  let open = $state<Record<string, boolean>>({});
  let steer = $state("");
  let newTitle = $state("");
  let newType = $state<LoreType | "">("");
  let book = $state<Lorebook | null>(null);

  $effect(() => {
    const target = draft.targetBookId;
    if (!target) return;
    get<Lorebook>(`/api/lorebooks/${target}`).then((b) => (book = b), () => {});
  });

  const kept = $derived(draft.items.filter((i) => i.keep));
  // The census names no entry covers yet, most important first.
  const missing = $derived(uncovered(draft).sort((a, b) => ["core", "supporting", "minor"].indexOf(a.tier) - ["core", "supporting", "minor"].indexOf(b.tier)));
  const planNames = (names: string[]) => session.act("outline", "/outline", { mode: "more", names });
  const unwritten = $derived(kept.filter((i) => i.action !== "off" && (!i.entry || (i.action === "change" && i.status === "planned")) && i.status !== "queued" && i.status !== "writing"));

  // ---------- I2: versions of the plan, and what changed ----------
  interface Diff {
    n: number;
    why: string;
    added: string[];
    removed: string[];
    renamed: { id: string; from: string }[];
    recategorised: { id: string; from: string | null }[];
    repitched: string[];
  }
  let versions = $state<{ n: number; at: number; why: string; count: number }[]>([]);
  let diff = $state<Diff | null>(null);
  let showDiff = $state(true);
  async function loadVersions(n?: number) {
    try {
      const r = await get<{ versions: typeof versions; diff: Diff | null }>(`/api/lore-studio/${session.id}/versions${n ? `?n=${n}` : ""}`);
      versions = r.versions;
      diff = r.diff;
    } catch {
      versions = [];
    }
  }
  $effect(() => {
    void draft.items.length;
    void session.busy;
    void loadVersions();
  });
  const isNew = (id: string) => showDiff && Boolean(diff?.added.includes(id)) && (versions.length > 1 || false);
  const wasNamed = (id: string) => (showDiff ? diff?.renamed.find((r) => r.id === id)?.from : undefined);
  const wasCat = (id: string) => (showDiff ? diff?.recategorised.find((r) => r.id === id) : undefined);

  // ---------- I2: entries already in the book: change or switch off ----------
  const inPlan = $derived(new Set(draft.items.map((i) => i.targetEntryId).filter(Boolean)));
  const existing = $derived((book?.entries ?? []).filter((e) => e.enabled !== false && !inPlan.has(e.id) && !draft.items.some((i) => i.savedEntryId === e.id)));
  async function planExisting(entryId: string, action: "change" | "off") {
    let pitch: string | undefined;
    if (action === "change") {
      const t = await promptText({ title: "Change this entry", label: "What should change", placeholder: "It's lit again: Mira keeps it now.", multiline: true, confirmLabel: "Add to the plan" });
      if (t === null) return;
      pitch = t;
    }
    await session.act("existing", "/existing", { entryId, action, pitch });
  }
  const depthOf = (i: StudioItem) => (i.parent && draft.items.some((x) => x.id === i.parent) ? 1 : 0);
  const parentOptions = (it: StudioItem) => [
    ...draft.items.filter((x) => x.id !== it.id && x.parent !== it.id).map((x) => ({ value: x.id, label: x.title })),
    ...(book?.entries ?? []).filter((e) => !draft.items.some((x) => x.savedEntryId === e.id)).map((e) => ({ value: `entry:${e.id}`, label: `${e.comment || e.keys[0] || "Untitled"} (in the book)` })),
  ];

  function edit(it: StudioItem, p: Partial<StudioItem>, delay = 500) {
    Object.assign(it, p);
    session.saveItem(it.id, p, delay);
  }

  async function add() {
    if (!newTitle.trim()) return;
    try {
      const r = await post<{ draft: StudioDraft; itemId: string }>(`/api/lore-studio/${session.id}/items`, { title: newTitle.trim(), type: newType || null });
      session.apply(r.draft);
      newTitle = "";
    } catch (e) {
      errorToast(e);
    }
  }

  async function remove(it: StudioItem) {
    if (it.entry && !(await confirm({ title: `Remove “${it.title}”?`, message: "Its written draft goes too.", confirmLabel: "Remove", danger: true }))) return;
    await session.act("remove", `/items/${it.id}`, undefined, "DELETE");
  }

  async function move(i: number, dir: -1 | 1) {
    const list = [...draft.items];
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j]!, list[i]!];
    draft.items = list;
    await session.act("order", "/order", { ids: list.map((x) => x.id) });
  }

  async function replan() {
    if (draft.items.length && !(await confirm({ title: "Plan again from scratch?", message: "Entries already written stay; the rest of the plan is replaced.", confirmLabel: "Plan again" }))) return;
    await session.act("outline", "/outline", { mode: "replace", steer });
  }

  const STATUS: Record<StudioItem["status"], string> = { planned: "", queued: "in line", writing: "writing…", drafted: "written", error: "failed" };
</script>

<section class="stack">
  {#if draft.basedOn || draft.research}
    <ResearchPanel research={draft.research} basedOn={draft.basedOn} busy={session.busy === "research"} onresearch={(urls) => session.act("research", "/research", { urls })} />
  {/if}
  <label class="field">
    <span class="label">Overview <span class="faint">the ground truths every entry is written against{draft.options.overview ? "; saved as an always-on entry" : ""}</span></span>
    <textarea class="textarea story" use:autosize={{ max: 360, value: draft.overview }} bind:value={draft.overview} oninput={() => session.save({ overview: draft.overview }, "overview")} placeholder="The world's premise, tone, and the rules every scene should respect. Plan the lorebook and Mea drafts this for you."></textarea>
  </label>

  <div class="row between wrap">
    <h2>Plan <span class="muted small">({kept.length} entries{draft.items.length > kept.length ? `, ${draft.items.length - kept.length} left out` : ""})</span></h2>
    <span class="tiny muted">Entries are written in this order; later ones see what earlier ones say.</span>
  </div>
  {#if versions.length}
    <div class="row wrap versions tiny">
      <span class="muted">Version</span>
      <select class="select mini" value={diff?.n ?? versions.at(-1)?.n} onchange={(e) => loadVersions(Number(e.currentTarget.value))} aria-label="Plan version">
        {#each [...versions].reverse() as v (v.n)}<option value={v.n}>{v.n} · {v.why} ({v.count})</option>{/each}
      </select>
      {#if diff && versions.length > 1}
        <label class="switch small"><input type="checkbox" bind:checked={showDiff} /> Show what changed</label>
        {#if showDiff}
          <span class="muted">{[diff.added.length ? `${diff.added.length} new` : "", diff.renamed.length ? `${diff.renamed.length} renamed` : "", diff.recategorised.length ? `${diff.recategorised.length} recategorised` : "", diff.repitched.length ? `${diff.repitched.length} rewritten` : "", diff.removed.length ? `left out: ${diff.removed.join(", ")}` : ""].filter(Boolean).join(" · ") || "no changes"}</span>
        {/if}
      {/if}
    </div>
  {/if}

  {#if !draft.items.length}
    <p class="muted small">No plan yet. {session.busy === "outline" ? "Planning…" : ""}</p>
  {/if}

  <div class="items">
    {#each draft.items as it, i (it.id)}
      {@const meta = typeMeta(it.type)}
      <div class="item card" class:out={!it.keep} class:new={isNew(it.id)} class:changed={Boolean(wasNamed(it.id) || wasCat(it.id) || (showDiff && diff?.repitched.includes(it.id)))} style:margin-left={depthOf(it) ? "1.4rem" : undefined}>
        <div class="irow">
          <input type="checkbox" checked={it.keep} onchange={(e) => edit(it, { keep: e.currentTarget.checked }, 0)} aria-label="Include {it.title}" title="Include in the lorebook" />
          <select class="select type" value={it.type ?? ""} onchange={(e) => edit(it, { type: (e.currentTarget.value || null) as LoreType | null }, 0)} aria-label="Kind">
            <option value="">Plain</option>
            {#each LORE_TYPES as t (t.value)}<option value={t.value}>{t.label}</option>{/each}
          </select>
          <select class="select type" value={it.category ?? ""} onchange={(e) => edit(it, { category: e.currentTarget.value || null }, 0)} aria-label="Category" title={wasCat(it.id) ? `was ${wasCat(it.id)?.from ?? "none"}` : "Category: sets where the entry goes and how strongly"}>
            <option value="">No category</option>
            {#each LORE_CATEGORIES as c (c.id)}<option value={c.id}>{c.label}</option>{/each}
          </select>
          <input class="input name" value={it.title} oninput={(e) => edit(it, { title: e.currentTarget.value })} aria-label="Title" title={wasNamed(it.id) ? `was “${wasNamed(it.id)}”` : undefined} />
          {#if it.action === "change"}<span class="chip tiny butter" title="Changes the entry already in the book">change</span>{:else if it.action === "off"}<span class="chip tiny rose" title="Switched off when you save">switch off</span>{/if}
          {#if STATUS[it.status]}<span class="chip tiny" class:mint={it.status === "drafted"} class:butter={it.status === "writing" || it.status === "queued"} class:rose={it.status === "error"}>{STATUS[it.status]}</span>{/if}
          {#if it.constant}<span class="chip tiny butter">always</span>{/if}
          <div class="tools">
            <button class="btn ghost icon small" onclick={() => (open[it.id] = !open[it.id])} aria-label="More" aria-expanded={Boolean(open[it.id])}>{#if open[it.id]}<ChevronDown size={14} />{:else}<ChevronRight size={14} />{/if}</button>
            <button class="btn ghost icon small" onclick={() => move(i, -1)} disabled={i === 0} aria-label="Move up"><ArrowUp size={14} /></button>
            <button class="btn ghost icon small" onclick={() => move(i, 1)} disabled={i === draft.items.length - 1} aria-label="Move down"><ArrowDown size={14} /></button>
            <button class="btn ghost icon small" onclick={() => remove(it)} aria-label="Remove"><Trash size={14} /></button>
          </div>
        </div>
        <input class="input pitch" value={it.pitch} oninput={(e) => edit(it, { pitch: e.currentTarget.value })} placeholder={meta ? `What this ${meta.label.toLowerCase()} establishes, and why a scene needs it` : "What this entry establishes"} aria-label="Pitch" />
        {#if open[it.id]}
          <div class="more">
            <label class="field"><span class="label">Sits inside</span>
              <select class="select" value={it.parent} onchange={(e) => edit(it, { parent: e.currentTarget.value }, 0)}>
                <option value="">Nothing</option>
                {#each parentOptions(it) as p (p.value)}<option value={p.value}>{p.label}</option>{/each}
              </select>
            </label>
            <label class="field"><span class="label">Folder</span><input class="input" value={it.folder} oninput={(e) => edit(it, { folder: e.currentTarget.value })} placeholder="Places › Port Ellis" /></label>
            <label class="switch"><input type="checkbox" checked={it.constant} onchange={(e) => edit(it, { constant: e.currentTarget.checked }, 0)} /> Always on</label>
            {#if it.research?.url}<a class="tiny src" href={it.research.url} target="_blank" rel="noopener noreferrer">Canon read from {it.research.title}</a>{/if}
            {#if it.source}<details class="src"><summary class="tiny muted">Source notes ({it.source.split(/\s+/).length} words)</summary><p class="tiny pre">{it.source}</p></details>{/if}
          </div>
        {/if}
      </div>
    {/each}
  </div>

  {#if draft.census}
    <div class="panel stack tight coverage">
      <div class="row between wrap">
        <span class="small"><UserSearch size={14} /> <b>Census</b> <span class="muted">{draft.census.length} people, places and things found{draft.basedOn ? `, ${draft.basedOn} canon included` : ""} · {missing.length ? `${missing.length} not in the plan yet` : "all of them are in the plan"}</span></span>
        <div class="row">
          <button class="btn ghost small" onclick={() => session.act("census", "/census")} disabled={Boolean(session.busy)} title="Look through the material and canon again">{session.busy === "census" ? "Counting…" : "Count again"}</button>
          {#if missing.length}<button class="btn small" onclick={() => planNames(missing.map((e) => e.name))} disabled={Boolean(session.busy)}><Plus size={14} /> {session.busy === "outline" ? "Planning…" : `Plan all ${missing.length}`}</button>{/if}
        </div>
      </div>
      {#if missing.length}
        <div class="row wrap misses">
          {#each missing as e (e.name)}
            <button class="chip miss" class:core={e.tier === "core"} class:minor={e.tier === "minor"} title={e.note} onclick={() => planNames([e.name])} disabled={Boolean(session.busy)}><Plus size={11} /> {e.name}{#if e.type}<span class="faint"> · {typeMeta(e.type)?.label.toLowerCase()}</span>{/if}</button>
          {/each}
        </div>
      {/if}
    </div>
  {:else if draft.items.length && draft.source.kind !== "document"}
    <div class="row"><button class="btn ghost small" onclick={() => session.act("census", "/census")} disabled={Boolean(session.busy)}><UserSearch size={14} /> {session.busy === "census" ? "Counting…" : "Check who's missing"}</button></div>
  {/if}

  {#if existing.length}
    <details class="panel stack tight">
      <summary class="small"><b>Already in the book</b> <span class="muted">{existing.length} entries · change one or switch it off as part of this plan</span></summary>
      {#each existing.slice(0, 80) as e (e.id)}
        <div class="row between exist">
          <span class="small wraps">{e.comment || e.keys[0] || "Untitled"}</span>
          <span class="row">
            <button class="btn ghost small" onclick={() => planExisting(e.id, "change")} disabled={Boolean(session.busy)}>Change it</button>
            <button class="btn ghost small" onclick={() => planExisting(e.id, "off")} disabled={Boolean(session.busy)}>Switch it off</button>
          </span>
        </div>
      {/each}
    </details>
  {/if}

  <div class="row wrap addrow">
    <select class="select type" bind:value={newType} aria-label="Kind of the new entry"><option value="">Plain</option>{#each LORE_TYPES as t (t.value)}<option value={t.value}>{t.label}</option>{/each}</select>
    <input class="input grow" bind:value={newTitle} placeholder="Add an entry by name" onkeydown={(e) => e.key === "Enter" && add()} />
    <button class="btn" onclick={add} disabled={!newTitle.trim()}><Plus size={15} /> Add</button>
  </div>

  <div class="panel stack tight">
    <div class="row wrap">
      <input class="input grow" bind:value={steer} placeholder="Ask for something: more villains, places outside the city, the gods…" aria-label="What to plan" />
      <button class="btn" onclick={() => session.act("outline", "/outline", { mode: "more", steer })} disabled={Boolean(session.busy) || !draft.source.text.trim()}><Plus size={15} /> {session.busy === "outline" ? "Planning…" : "Plan more"}</button>
      <button class="btn ghost" onclick={replan} disabled={Boolean(session.busy) || !draft.source.text.trim()}><RefreshCw size={15} /> Plan again</button>
    </div>
  </div>

  <StudioOptions {session} />

  <div class="row wrap actions">
    <span class="tiny muted grow">{unwritten.length ? `Mea writes ${unwritten.length} entr${unwritten.length === 1 ? "y" : "ies"} in the background. You can leave this page; they'll be waiting.` : "Everything in the plan is written."}</span>
    {#if !unwritten.length && kept.length}
      <button class="btn primary" onclick={() => {
          draft.stage = "review";
          session.save({ stage: "review" }, "stage", 0);
        }}><ListTree size={16} /> Review</button>
    {:else}
      <button class="btn primary" onclick={() => session.act("write", "/write")} disabled={Boolean(session.busy) || !unwritten.length}><PenLine size={16} /> {session.busy === "write" ? "Starting…" : `Write ${unwritten.length} entr${unwritten.length === 1 ? "y" : "ies"}`}</button>
    {/if}
  </div>
</section>

<style>
  .items {
    display: grid;
    gap: 0.45rem;
  }
  .item {
    display: grid;
    gap: 0.4rem;
    padding: 0.55rem 0.7rem;
  }
  .item.out {
    opacity: 0.55;
  }
  .item.new {
    box-shadow: inset 3px 0 0 var(--mint, #82e3d3);
  }
  .item.changed {
    box-shadow: inset 3px 0 0 var(--butter, #ffd08f);
  }
  .versions {
    align-items: center;
    gap: 0.4rem;
  }
  .exist {
    padding: 0.15rem 0;
    border-bottom: 1px solid var(--border);
  }
  .irow {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    flex-wrap: wrap;
  }
  .type {
    width: auto;
    padding-top: 0.3rem;
    padding-bottom: 0.3rem;
    font-size: var(--fs-xs);
  }
  .name {
    flex: 1 1 12rem;
    min-width: 0;
    font-weight: 700;
    padding-top: 0.3rem;
    padding-bottom: 0.3rem;
  }
  .tools {
    display: flex;
    margin-left: auto;
  }
  .pitch {
    font-size: var(--fs-sm);
    padding-top: 0.3rem;
    padding-bottom: 0.3rem;
  }
  .more {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(13rem, 1fr));
    gap: 0.6rem;
    align-items: end;
  }
  .src {
    grid-column: 1 / -1;
  }
  .pre {
    white-space: pre-wrap;
    margin: 0.3rem 0 0;
  }
  .misses {
    gap: 0.3rem;
  }
  .miss {
    cursor: pointer;
    border: 1px dashed var(--border);
    background: none;
    color: var(--text);
    font: inherit;
    font-size: var(--fs-xs);
    display: inline-flex;
    align-items: center;
    gap: 0.2rem;
  }
  .miss.core {
    border-style: solid;
    border-color: var(--accent);
    font-weight: 700;
  }
  .miss.minor {
    opacity: 0.75;
  }
  .miss:hover:not(:disabled) {
    border-color: var(--accent);
  }
  .addrow .grow {
    flex: 1 1 12rem;
    min-width: 0;
  }
  .panel .grow {
    flex: 1 1 14rem;
    min-width: 0;
  }
  .actions {
    align-items: center;
  }
  .actions .grow {
    flex: 1 1 14rem;
  }
</style>
