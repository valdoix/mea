<script lang="ts">
  import EmptyState from "../components/EmptyState.svelte";
  import { get, post } from "../lib/api";
  import { wordDiff } from "../lib/diff";
  import { onEvent } from "../lib/events";
  import { autosize } from "../lib/gestures";
  import { Ban, Check, ExternalLink, MessagesSquare, Pencil, Undo, X } from "../lib/icons";
  import { openMeusIn } from "../lib/meus.svelte";
  import { navigate, route } from "../lib/router.svelte";
  import { errorToast, toast } from "../lib/state.svelte";
  import type { InboxItem, InboxSource, NeverShownItem } from "../lib/types";

  /**
   * The review inbox (CON-09): every change to canon Mea proposes, as a diff you approve, edit
   * or reject. Nothing here touches the story until you decide.
   */
  let items = $state<InboxItem[] | null>(null);
  let neverShown = $state<NeverShownItem[]>([]);
  let editing = $state<string | null>(null);
  let draft = $state("");
  let busy = $state<string | null>(null);
  // P1: the filter is by source (?source= opens on one).
  // svelte-ignore state_referenced_locally
  let filter = $state<InboxSource | "all">((route.query.source as InboxSource) || "all");
  // The story filter lives in the URL (?chat=), as the links from a chat already open on it.
  const chat = $derived(route.query.chat || "");
  /** ?chat= for the suggestions that belong to no story (a version's original changed). */
  const NO_STORY = "none";

  async function load() {
    try {
      // The full list names every story for the filter. It leaves out archived chats and all but the
      // 40 most recent, so a link to one of those fetches that chat as well.
      const scoped = chat && chat !== NO_STORY ? get<{ items: InboxItem[] }>(`/api/inbox?chat=${encodeURIComponent(chat)}`) : null;
      const [everything, own, never] = await Promise.all([get<{ items: InboxItem[] }>("/api/inbox"), scoped, get<{ items: NeverShownItem[] }>("/api/inbox/never")]);
      items = [...new Map([...everything.items, ...(own?.items ?? [])].map((i) => [i.key, i])).values()];
      neverShown = never.items;
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

  const KIND: Record<string, string> = { summary: "Summary", journal: "Journal", chronicle: "New lore", merge: "Duplicate", disputed: "Disputed memory", world: "Subplot", lesson: "Lesson", canon: "Canon", pressure: "Pressure", calendar: "Calendar", offpage: "Secret", version: "Original changed", "lore-update": "Lore update", "lore-recheck": "Re-check", worldnews: "News", worldaudit: "World check" };
  const SOURCE: Record<InboxSource, string> = { memory: "Memory", lore: "Lore", world: "World", lesson: "Lessons", canon: "Canon", pressure: "Pressures", calendar: "Calendar", secret: "Secrets", versions: "Versions" };
  const storyOf = (i: InboxItem) => i.chatId || NO_STORY;
  /** The filter's choices, A to Z, with the suggestions that belong to no story last. */
  const stories = $derived.by(() => {
    const found = new Map<string, { id: string; title: string; n: number }>();
    for (const i of items ?? []) {
      const id = storyOf(i);
      const s = found.get(id);
      if (s) s.n++;
      else found.set(id, { id, title: id === NO_STORY ? "Not tied to a story" : i.chatTitle || "Untitled story", n: 1 });
    }
    // A story with nothing waiting still needs its choice while it's selected.
    if (chat && !found.has(chat)) found.set(chat, { id: chat, title: chat === NO_STORY ? "Not tied to a story" : "This story", n: 0 });
    return [...found.values()].sort((a, b) => Number(a.id === NO_STORY) - Number(b.id === NO_STORY) || a.title.localeCompare(b.title));
  });
  const inStory = $derived((items ?? []).filter((i) => !chat || storyOf(i) === chat));
  const counts = $derived.by(() => {
    const c = new Map<InboxSource, number>();
    for (const i of inStory) c.set(i.source, (c.get(i.source) ?? 0) + 1);
    return c;
  });
  // A source this story has nothing from falls back to everything rather than an empty list.
  const source = $derived(filter !== "all" && counts.has(filter) ? filter : "all");
  const shown = $derived(inStory.filter((i) => source === "all" || i.source === source));

  function pickStory(id: string) {
    navigate(id ? `/inbox?chat=${encodeURIComponent(id)}` : "/inbox", { replace: true });
  }

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
  /** Rejects it, and it doesn't come back, even as a new suggestion saying the same thing. */
  async function neverAgain(item: InboxItem) {
    busy = item.key;
    try {
      await post("/api/inbox/never", { key: item.key, chatId: item.chatId || undefined });
      items = (items ?? []).filter((i) => i.key !== item.key);
      if (editing === item.key) editing = null;
      toast("Rejected. It won't show again.", { kind: "info" });
      await load();
    } catch (e) {
      errorToast(e);
    } finally {
      busy = null;
    }
  }
  async function showAgain(n: NeverShownItem) {
    busy = n.key;
    try {
      await post("/api/inbox/never/restore", { key: n.key });
      await load();
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
  </header>

  {#if items === null}
    <p class="muted">Loading…</p>
  {:else if !items.length}
    <EmptyState title="All caught up" text="When Mea proposes a change to your story's canon (a rebuilt summary, new lore, a merge), it waits here for you." icon="✉" />
  {:else}
    <div class="row wrap filters">
      {#if stories.length > 1 || chat}
        <select class="select story" value={chat} onchange={(e) => pickStory(e.currentTarget.value)} aria-label="Filter by story">
          <option value="">All stories ({items.length})</option>
          {#each stories as s (s.id)}<option value={s.id}>{s.title} ({s.n})</option>{/each}
        </select>
      {/if}
      {#if inStory.length}
        <button class="chip" class:on={source === "all"} onclick={() => (filter = "all")}>All {inStory.length}</button>
        {#each [...counts] as [k, n] (k)}<button class="chip" class:on={source === k} onclick={() => (filter = k)}>{SOURCE[k] ?? k} {n}</button>{/each}
      {/if}
      {#if shown.filter((x) => x.kind !== "merge").length > 1}<button class="btn ghost small" onclick={acceptAll}>Approve all shown</button>{/if}
    </div>
    {#if !shown.length}<p class="muted small">Nothing waiting here.</p>{/if}
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
            <button class="btn primary small" onclick={() => act(item, "accept")} disabled={busy === item.key}><Check size={14} /> {editing === item.key ? `Save and ${(item.labels?.accept ?? "approve").toLowerCase()}` : (item.labels?.accept ?? (item.kind === "merge" ? "Merge" : item.kind === "version" ? "Take the changes" : "Approve"))}</button>
            {#if item.editable && editing !== item.key}<button class="btn ghost small" onclick={() => startEdit(item)}><Pencil size={14} /> Edit</button>{/if}
            {#if editing === item.key}<button class="btn ghost small" onclick={() => (editing = null)}>Cancel edit</button>{/if}
            <button class="btn ghost small" onclick={() => act(item, "reject")} disabled={busy === item.key}><X size={14} /> {item.labels?.reject ?? (item.kind === "merge" ? "Not the same" : item.kind === "version" ? "Not for this version" : "Reject")}</button>
            <button class="btn ghost small" onclick={() => neverAgain(item)} disabled={busy === item.key} title="Reject this, and don't suggest it again"><Ban size={14} /> Never show again</button>
            {#if item.chatId}<button class="btn ghost small" onclick={() => talkItThrough(item)}><MessagesSquare size={14} /> Talk it through with Meus</button>{/if}
          </div>
        </article>
      {/each}
    </div>
  {/if}

  {#if neverShown.length}
    <details class="never">
      <summary class="small muted">Never shown again ({neverShown.length})</summary>
      <ul>
        {#each neverShown as n (n.key)}
          <li class="row between">
            <span class="small">{n.title}{#if n.chatTitle}<span class="tiny muted"> · {n.chatTitle}</span>{/if}</span>
            <button class="btn ghost small" onclick={() => showAgain(n)} disabled={busy === n.key}><Undo size={14} /> Show again</button>
          </li>
        {/each}
      </ul>
    </details>
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
  .filters .story {
    width: auto;
    max-width: 100%;
    min-width: 0;
  }
  .filters .chip {
    cursor: pointer;
    border: 1px solid var(--border);
  }
  .filters .chip.on {
    /* Some rooms restyle every .chip; the selected one still has to look selected. */
    background: var(--accent) !important;
    color: var(--on-accent) !important;
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
  .never summary {
    cursor: pointer;
  }
  .never ul {
    list-style: none;
    margin: 0.5rem 0 0;
    padding: 0;
    display: grid;
    gap: 0.35rem;
  }
  .never li {
    gap: 0.6rem;
    flex-wrap: nowrap;
  }
  .never li span {
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .never li button {
    flex: none;
  }
  @media (max-width: 760px) {
    .merge {
      grid-template-columns: 1fr;
    }
  }
</style>
