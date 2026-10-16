<script lang="ts">
  import EmptyState from "../components/EmptyState.svelte";
  import { get, post } from "../lib/api";
  import { wordDiff } from "../lib/diff";
  import { onEvent } from "../lib/events";
  import { autosize } from "../lib/gestures";
  import { Check, ExternalLink, MessagesSquare, Pencil, X } from "../lib/icons";
  import { openMeusIn } from "../lib/meus.svelte";
  import { navigate, route } from "../lib/router.svelte";
  import { errorToast, toast } from "../lib/state.svelte";
  import type { InboxItem, InboxSource } from "../lib/types";

  /**
   * The review inbox (CON-09): every change to canon Mea proposes, as a diff you approve, edit
   * or reject. Nothing here touches the story until you decide.
   */
  let items = $state<InboxItem[] | null>(null);
  let editing = $state<string | null>(null);
  let draft = $state("");
  let busy = $state<string | null>(null);
  // P1: the filter is by source (?source= opens on one).
  // svelte-ignore state_referenced_locally
  let filter = $state<InboxSource | "all">((route.query.source as InboxSource) || "all");
  const chat = $derived(route.query.chat || "");

  async function load() {
    try {
      items = (await get<{ items: InboxItem[] }>(`/api/inbox${chat ? `?chat=${encodeURIComponent(chat)}` : ""}`)).items;
    } catch (e) {
      errorToast(e);
      items = [];
    }
  }
  $effect(() => {
    void chat;
    void load();
  });
  let timer: ReturnType<typeof setTimeout>;
  $effect(() =>
    onEvent((e) => {
      if (e.type === "inbox.changed" || e.type === "memory.changed" || e.type === "reconnected") {
        clearTimeout(timer);
        timer = setTimeout(load, 800);
      }
    }),
  );

  const KIND: Record<string, string> = { summary: "Summary", journal: "Journal", chronicle: "New lore", merge: "Duplicate", disputed: "Disputed memory", world: "Subplot", lesson: "Lesson", canon: "Canon", pressure: "Pressure", calendar: "Calendar", offpage: "Secret", version: "Original changed" };
  const SOURCE: Record<InboxSource, string> = { memory: "Memory", lore: "Lore", world: "World", lesson: "Lessons", canon: "Canon", pressure: "Pressures", calendar: "Calendar", secret: "Secrets", versions: "Versions" };
  const counts = $derived.by(() => {
    const c = new Map<InboxSource, number>();
    for (const i of items ?? []) c.set(i.source, (c.get(i.source) ?? 0) + 1);
    return c;
  });
  const shown = $derived((items ?? []).filter((i) => filter === "all" || i.source === filter));

  /** The note goes to Meus in its chat, which reads it with the story around it. */
  function talkItThrough(item: InboxItem) {
    openMeusIn(item.chatId, `About this inbox note [${item.key}] "${item.title}": ${item.why} Is it right? What would you do with it?`, true);
    navigate(`/chat/${item.chatId}`);
  }

  async function act(item: InboxItem, action: "accept" | "reject") {
    busy = item.key;
    try {
      await post("/api/inbox/act", { key: item.key, action, edited: action === "accept" && editing === item.key ? draft : undefined });
      items = (items ?? []).filter((i) => i.key !== item.key);
      editing = null;
      toast(action === "accept" ? "Approved ✿" : "Rejected", { kind: action === "accept" ? "ok" : "info" });
    } catch (e) {
      errorToast(e);
    } finally {
      busy = null;
    }
  }
  function startEdit(item: InboxItem) {
    editing = item.key;
    draft = item.after;
  }
  async function acceptAll() {
    for (const i of shown.filter((x) => x.kind !== "merge")) await act(i, "accept");
  }
</script>

<div class="page">
  <header class="row between wrap">
    <div>
      <h1>Review inbox</h1>
      <p class="muted small">Changes to canon Mea would like to make. Approve, edit, or reject each one; nothing changes until you do.</p>
    </div>
    {#if chat}<a class="btn ghost small" href="/inbox">All stories</a>{/if}
  </header>

  {#if items === null}
    <p class="muted">Loading…</p>
  {:else if !items.length}
    <EmptyState title="All caught up" text="When Mea proposes a change to your story's canon (a rebuilt summary, new lore, a merge), it waits here for you." icon="✉" />
  {:else}
    <div class="row wrap filters">
      <button class="chip" class:on={filter === "all"} onclick={() => (filter = "all")}>All {items.length}</button>
      {#each [...counts] as [k, n] (k)}<button class="chip" class:on={filter === k} onclick={() => (filter = k)}>{SOURCE[k] ?? k} {n}</button>{/each}
      {#if shown.filter((x) => x.kind !== "merge").length > 1}<button class="btn ghost small" onclick={acceptAll}>Approve all shown</button>{/if}
    </div>
    <div class="list">
      {#each shown as item (item.key)}
        <article class="card item">
          <div class="row between wrap">
            <span class="chip tiny">{KIND[item.kind] ?? item.kind}</span>
            <a class="tiny muted" href={item.link}>{item.chatTitle} <ExternalLink size={11} /></a>
          </div>
          <h3>{item.title}</h3>
          <p class="tiny muted why">{item.why}</p>
          {#if editing === item.key}
            <textarea class="textarea" use:autosize={420} bind:value={draft}></textarea>
          {:else if item.before && item.kind !== "merge"}
            <p class="diff small">{#each wordDiff(item.before, item.after) as part, i (i)}<span class={part.type}>{part.text}</span>{/each}</p>
          {:else if item.kind === "merge"}
            <div class="merge small">
              <div><span class="tiny faint">Merge</span><p>{item.before}</p></div>
              <div><span class="tiny faint">into</span><p>{item.after}</p></div>
            </div>
          {:else}
            <p class="after small">{item.after}</p>
          {/if}
          <div class="row wrap">
            <button class="btn primary small" onclick={() => act(item, "accept")} disabled={busy === item.key}><Check size={14} /> {editing === item.key ? "Save and approve" : item.kind === "merge" ? "Merge" : item.kind === "version" ? "Take the changes" : "Approve"}</button>
            {#if item.editable && editing !== item.key}<button class="btn ghost small" onclick={() => startEdit(item)}><Pencil size={14} /> Edit</button>{/if}
            {#if editing === item.key}<button class="btn ghost small" onclick={() => (editing = null)}>Cancel edit</button>{/if}
            <button class="btn ghost small" onclick={() => act(item, "reject")} disabled={busy === item.key}><X size={14} /> {item.kind === "merge" ? "Not the same" : item.kind === "version" ? "Not for this version" : "Reject"}</button>
            {#if item.chatId}<button class="btn ghost small" onclick={() => talkItThrough(item)}><MessagesSquare size={14} /> Talk it through with Meus</button>{/if}
          </div>
        </article>
      {/each}
    </div>
  {/if}
</div>

<style>
  .page {
    max-width: 52rem;
    margin: 0 auto;
    padding: 1.5rem clamp(1rem, 3vw, 2rem) 5rem;
    display: grid;
    gap: 1rem;
  }
  h1 {
    margin: 0;
  }
  header p {
    margin: 0.3rem 0 0;
  }
  .filters {
    gap: 0.35rem;
  }
  .filters .chip {
    cursor: pointer;
    border: 1px solid var(--border);
  }
  .filters .chip.on {
    background: var(--accent);
    color: var(--accent-ink);
  }
  .list {
    display: grid;
    gap: 0.8rem;
  }
  .item {
    padding: 0.9rem 1rem;
    display: grid;
    gap: 0.45rem;
    min-width: 0;
  }
  .item h3 {
    margin: 0;
    font-size: 1.02rem;
  }
  .why {
    margin: 0;
  }
  .diff,
  .after {
    margin: 0;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    max-height: 20rem;
    overflow: auto;
    background: var(--surface-2);
    border-radius: var(--r-sm);
    padding: 0.5rem 0.65rem;
  }
  .del {
    background: color-mix(in srgb, var(--danger) 14%, transparent);
    text-decoration: line-through;
  }
  .add {
    background: color-mix(in srgb, var(--mint) 35%, transparent);
  }
  .merge {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.6rem;
  }
  .merge p {
    margin: 0.1rem 0 0;
  }
  @media (max-width: 760px) {
    .merge {
      grid-template-columns: 1fr;
    }
  }
</style>
