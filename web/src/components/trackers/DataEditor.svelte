<script lang="ts">
  import { untrack } from "svelte";
  import DataField from "./DataField.svelte";
  import { get } from "../../lib/api";
  import { diffLines, editLine } from "../../lib/dataedit";
  import { confirm } from "../../lib/dialogs.svelte";
  import { Plus, Search, Trash } from "../../lib/icons";
  import { errorToast, toast } from "../../lib/state.svelte";
  import { trackerEdit } from "../../lib/trackers.svelte";
  import type { TrackersResponse } from "../../lib/types";

  /** Every record the story keeps, editable field by field (your edits are ledger lines, so they rewind and swipe like the rest). */
  let { chatId, focus = "" }: { chatId: string; focus?: string } = $props();

  let data = $state<TrackersResponse | null>(null);
  // Where to start (the parent re-mounts this to jump elsewhere).
  const start = untrack(() => focus).split(".");
  let section = $state(start[0] || "chars");
  let open = $state<string | null>(start[1] ?? null);
  let draft = $state<any>(null);
  let q = $state("");
  let line = $state("");
  let busy = $state(false);

  async function load() {
    try {
      data = await get<TrackersResponse>(`/api/chats/${chatId}/trackers`);
      if (open) startEdit(open);
    } catch (e) {
      errorToast(e);
    }
  }
  $effect(() => {
    void chatId;
    void load();
  });

  const st = $derived(data?.state as any);
  const people = $derived(Object.values(data?.state.chars ?? {}).map((c) => ({ id: c.id, name: c.isUser ? data!.userName || c.name : c.name })));
  const nm = (id?: string) => people.find((p) => p.id === id)?.name ?? id ?? "?";

  type Sec = { key: string; label: string; title: (v: any, id: string) => string; blank?: (name: string) => any; newLabel?: string };
  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "x";
  const SECTIONS: Sec[] = [
    { key: "chars", label: "People", title: (v) => `${v.isUser ? data?.userName || v.name : v.name}${v.isUser ? " (you)" : v.isMain ? " (main)" : ""}`, newLabel: "Name", blank: (name) => ({ id: slug(name), name, aliases: [], isUser: false, isMain: false, firstSeq: 0, lastSeq: 0, tier: "off", meters: {}, flags: [], injuries: [], conditions: [], traits: [], drives: {}, journal: [], stamina: "ordinary" }) },
    { key: "bonds", label: "Bonds", title: (v) => `${nm(v.from)} → ${nm(v.to)}${v.label ? ` · ${v.label}` : ""}` },
    { key: "ladders", label: "Romance", title: (v) => `${nm(v.from)} → ${nm(v.to)} · rung ${v.tier}` },
    { key: "facts", label: "Facts and secrets", title: (v) => v.statement, newLabel: "The fact", blank: (s) => ({ key: slug(s), statement: s, truth: "true", stances: {}, revealed: [], firstSeq: 0, lastSeq: 0 }) },
    { key: "items", label: "Things", title: (v) => `${v.name}${v.gone ? " (gone)" : v.holder ? ` · ${nm(v.holder.replace(/^place:/, ""))}` : ""}`, newLabel: "Item name", blank: (name) => ({ id: slug(name), name, custody: [], lastSeq: 0 }) },
    { key: "threads", label: "Threads", title: (v) => `${v.title} · ${v.status}`, newLabel: "Thread title", blank: (title) => ({ id: slug(title), title, status: "open", openedSeq: 0, lastSeq: 0, history: [] }) },
    { key: "obligations", label: "Promises and debts", title: (v) => `${nm(v.who)} → ${nm(v.whom)}: ${v.what} · ${v.status}` },
    { key: "deadlines", label: "Deadlines", title: (v) => `${v.title}${v.done ? " (done)" : ""}`, newLabel: "Deadline", blank: (title) => ({ id: slug(title), title, at: null, text: "", done: false, seq: 0 }) },
    { key: "plants", label: "Planted details", title: (v) => v.text, newLabel: "Detail", blank: (text) => ({ id: slug(text), text, seq: 0, scene: 0 }) },
    { key: "clues", label: "Clues", title: (v) => v.text, newLabel: "Clue", blank: (text) => ({ id: slug(text), text, seq: 0 }) },
    { key: "gauges", label: "Gauges", title: (v) => `${v.name} ${v.cur}/${v.max}`, newLabel: "Gauge name", blank: (name) => ({ name, cur: 0, max: 6, history: [] }) },
    { key: "clocks", label: "Faction clocks", title: (v) => `${v.faction}: ${v.name} ${v.cur}/${v.max}` },
    { key: "rep", label: "Reputation", title: (v) => `${nm(v.who)} with ${v.group}: ${v.score}` },
    { key: "calendar", label: "Calendar", title: (v) => `${v.title}${v.when ? ` · ${v.when}` : ""}`, newLabel: "Event", blank: (title) => ({ id: slug(title), title, kind: "plan", when: "", at: null, who: [], seq: 0 }) },
    { key: "motifs", label: "Running bits", title: (v) => v.text, newLabel: "Motif", blank: (text) => ({ id: slug(text), text, firstSeq: 0, lastSeq: 0, uses: 1 }) },
    { key: "milestones", label: "Milestones", title: (v) => v.text, newLabel: "Milestone", blank: (text) => ({ text, who: [], seq: 0, at: null }) },
    { key: "places", label: "Places", title: (v) => v.path?.join(" › ") || v.name, newLabel: "Place (Town › Spot)", blank: (p) => ({ id: slug(p), name: p.split("›").at(-1)!.trim(), path: p.split("›").map((s: string) => s.trim()), visits: 0, lastSeq: 0 }) },
    { key: "custom", label: "Custom trackers", title: (_v, id) => data?.templates.find((t) => t.key === id)?.name ?? id },
  ];
  const sec = $derived(SECTIONS.find((s) => s.key === section) ?? SECTIONS[0]!);
  const SCENE_KEYS = ["weather", "place", "sceneTitle", "mode", "sceneNo", "sceneStartSeq", "time", "locks"];

  // Records are keyed (most sections) or listed (clues, milestones); both read as [id, value].
  const entries = $derived.by(() => {
    if (!st) return [] as [string, any][];
    const raw = st[section];
    const list: [string, any][] = Array.isArray(raw) ? raw.map((v: any, i: number) => [String(i), v]) : Object.entries(raw ?? {});
    const needle = q.trim().toLowerCase();
    return needle ? list.filter(([id, v]) => `${id} ${sec.title(v, id)} ${JSON.stringify(v)}`.toLowerCase().includes(needle)) : list;
  });
  const count = (key: string) => (st ? (Array.isArray(st[key]) ? st[key].length : Object.keys(st[key] ?? {}).length) : 0);

  function startEdit(id: string) {
    open = id;
    const v = section === "scene" ? Object.fromEntries(SCENE_KEYS.map((k) => [k, st?.[k] ?? null])) : st?.[section]?.[Array.isArray(st[section]) ? Number(id) : id];
    draft = v === undefined ? null : structuredClone($state.snapshot(v));
  }
  function pick(s: string) {
    section = s;
    open = null;
    draft = null;
    q = "";
  }

  async function send(lines: string[], done = "Saved") {
    if (!lines.length) return toast("Nothing changed");
    busy = true;
    const ok = await trackerEdit(chatId, lines);
    busy = false;
    if (ok) {
      toast(done, { kind: "ok" });
      await load();
    }
  }
  async function save() {
    if (!open || draft == null) return;
    if (section === "scene") {
      const before = Object.fromEntries(SCENE_KEYS.map((k) => [k, st?.[k] ?? null]));
      const lines: string[] = [];
      for (const k of SCENE_KEYS) lines.push(...diffLines(before[k], draft[k], [k]));
      return send(lines);
    }
    const path = [section, Array.isArray(st[section]) ? Number(open) : open];
    await send(diffLines($state.snapshot(st[section][path[1]!]), $state.snapshot(draft), path));
  }
  async function remove(id: string) {
    const title = sec.title(st[section][Array.isArray(st[section]) ? Number(id) : id], id);
    if (!(await confirm({ title: `Remove “${title.slice(0, 60)}”?`, message: "It leaves the story's records from now on. The model can still bring it back if the story mentions it again; locking stops that.", confirmLabel: "Remove", danger: true }))) return;
    open = null;
    draft = null;
    await send([editLine([section, id], null)], "Removed");
  }
  async function lock(id: string) {
    const path = `${section}.${id}`;
    const on = !st.locks.includes(path);
    await send([`lock ${path}: ${on ? "on" : "off"}`], on ? "Locked: the story can't change it" : "Unlocked");
  }
  async function addNew() {
    const name = line.trim();
    if (!name || !sec.blank) return;
    const v = sec.blank(name);
    const id = Array.isArray(st[section]) ? String(st[section].length) : v.id ?? v.key ?? slug(name);
    if (!Array.isArray(st[section]) && st[section]?.[id]) return toast("That one already exists", { kind: "info" });
    line = "";
    await send([editLine([section, id], v)], "Added");
    startEdit(id);
  }
  async function writeLine() {
    if (!line.trim()) return;
    const l = line;
    line = "";
    await send(l.split(/\n/).filter((x) => x.trim()), "Written");
  }
</script>

<datalist id="data-people">{#each people as p (p.id)}<option value={p.id}>{p.name}</option>{/each}</datalist>

<div class="data">
  <nav class="secs" aria-label="Records">
    <button class="sec" class:on={section === "scene"} onclick={() => { pick("scene"); startEdit("scene"); }}>Scene</button>
    {#each SECTIONS as s (s.key)}
      <button class="sec" class:on={section === s.key} onclick={() => pick(s.key)}>{s.label}<span class="tiny faint">{count(s.key) || ""}</span></button>
    {/each}
  </nav>

  <div class="body">
    {#if !data}
      <p class="muted small">Reading the records…</p>
    {:else if section === "scene"}
      <div class="card entry open">
        <p class="tiny muted">Time is stored as minutes; to change it, write a line below such as <code>clock: Day 2 08:00</code>.</p>
        {#if draft}
          {#each Object.keys(draft) as k (k)}<DataField obj={draft} {k} {people} />{/each}
          <div class="row end"><button class="btn ghost small" onclick={() => startEdit("scene")}>Revert</button><button class="btn primary small" disabled={busy} onclick={save}>Save</button></div>
        {/if}
      </div>
    {:else}
      <div class="row tools">
        <span class="search grow"><Search size={14} /><input class="input" bind:value={q} placeholder="Find in {sec.label.toLowerCase()}" /></span>
      </div>
      <div class="list">
        {#each entries as [id, v] (id)}
          <div class="card entry" class:open={open === id}>
            <div class="row">
              <button class="grow title" onclick={() => (open === id ? ((open = null), (draft = null)) : startEdit(id))}>
                <span class="small">{sec.title(v, id)}</span>
                {#if st.locks.includes(`${section}.${id}`)}<span class="chip tiny">locked</span>{/if}
              </button>
              <button class="btn ghost small" onclick={() => lock(id)} title="Locked records can't be changed by the story">{st.locks.includes(`${section}.${id}`) ? "Unlock" : "Lock"}</button>
              {#if !(section === "chars" && v.isUser)}<button class="btn ghost icon small" onclick={() => remove(id)} aria-label="Remove"><Trash size={14} /></button>{/if}
            </div>
            {#if open === id && draft}
              <div class="fields">
                {#each Object.keys(draft) as k (k)}<DataField obj={draft} {k} {people} />{/each}
              </div>
              <div class="row end">
                <button class="btn ghost small" onclick={() => startEdit(id)}>Revert</button>
                <button class="btn primary small" disabled={busy} onclick={save}>Save</button>
              </div>
            {/if}
          </div>
        {:else}
          <p class="muted small">{q ? "Nothing matches." : "Nothing here yet."}</p>
        {/each}
      </div>
    {/if}

    <div class="card write">
      <label class="field">
        <span class="label">{sec.blank && section !== "scene" ? `Add to ${sec.label.toLowerCase()}, or write a ledger line` : "Write a ledger line"}</span>
        <textarea class="textarea" rows="2" bind:value={line} placeholder={sec.blank && section !== "scene" ? `${sec.newLabel}…  or  bond Mira>Alex: trust +1 — she kept the secret` : "clock: Day 2 08:00   ·   bond Mira>Alex: trust +1 — she kept the secret"}></textarea>
      </label>
      <div class="row end">
        {#if sec.blank && section !== "scene"}<button class="btn small" disabled={busy || !line.trim() || line.includes("\n")} onclick={addNew}><Plus size={14} /> Add “{line.trim().slice(0, 24) || sec.newLabel}”</button>{/if}
        <button class="btn small" disabled={busy || !line.trim()} onclick={writeLine}>Write as ledger</button>
      </div>
    </div>
  </div>
</div>

<style>
  .data {
    display: grid;
    grid-template-columns: 12rem 1fr;
    gap: 1rem;
    align-items: start;
  }
  .secs {
    display: grid;
    gap: 0.15rem;
    position: sticky;
    top: 1rem;
  }
  .sec {
    display: flex;
    justify-content: space-between;
    gap: 0.5rem;
    border: 0;
    background: none;
    color: var(--text-muted);
    text-align: left;
    padding: 0.4rem 0.6rem;
    border-radius: 8px;
    cursor: pointer;
    font: inherit;
    font-size: 0.88rem;
  }
  .sec:hover {
    background: var(--surface-2);
  }
  .sec.on {
    background: var(--surface-2);
    color: var(--text);
    font-weight: 600;
  }
  .body {
    display: grid;
    gap: 0.6rem;
    min-width: 0;
  }
  .search {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }
  .list {
    display: grid;
    gap: 0.4rem;
  }
  .entry {
    padding: 0.45rem 0.6rem;
    display: grid;
    gap: 0.5rem;
  }
  .entry.open {
    border-color: var(--accent);
  }
  .title {
    border: 0;
    background: none;
    color: inherit;
    text-align: left;
    cursor: pointer;
    padding: 0.2rem 0;
    display: flex;
    gap: 0.4rem;
    align-items: center;
    min-width: 0;
    font: inherit;
  }
  .title .small {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .fields {
    display: grid;
    gap: 0.25rem;
  }
  .end {
    justify-content: flex-end;
    gap: 0.4rem;
  }
  .write {
    padding: 0.6rem;
    display: grid;
    gap: 0.4rem;
  }
  @media (max-width: 720px) {
    .data {
      grid-template-columns: 1fr;
    }
    .secs {
      position: static;
      display: flex;
      overflow-x: auto;
      gap: 0.3rem;
      padding-bottom: 0.2rem;
    }
    .sec {
      flex: none;
      white-space: nowrap;
    }
  }
</style>
