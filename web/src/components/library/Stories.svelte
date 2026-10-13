<script lang="ts">
  import Avatar from "../Avatar.svelte";
  import { del, get, imageUrl, patch, post } from "../../lib/api";
  import { promptText } from "../../lib/dialogs.svelte";
  import { compact, timeAgo } from "../../lib/format";
  import { Plus, Star } from "../../lib/icons";
  import { app, errorToast } from "../../lib/state.svelte";
  import type { ChatListItem, Collection, StoryStats } from "../../lib/types";

  /** Your stories (LIB-04…07): collections, covers, auto titles, and how much you've written. */
  let collections = $state<Collection[]>([]);
  let current = $state<string>(localStorage.getItem("mea.collection") ?? "");
  let chats = $state<ChatListItem[]>([]);
  // L17: archived chats have their own filter (they're left out of every other list).
  const ARCHIVED = "@archived";
  let stats = $state<StoryStats | null>(null);

  async function load() {
    try {
      const [c, list, s] = await Promise.all([
        get<{ collections: Collection[] }>("/api/collections"),
        get<{ chats: ChatListItem[] }>(current === ARCHIVED ? "/api/chats?archived=1&limit=200" : `/api/chats?limit=24${current ? `&collection=${current}` : ""}`),
        get<StoryStats>("/api/stats"),
      ]);
      collections = c.collections;
      if (current && current !== ARCHIVED && !collections.some((x) => x.id === current)) current = "";
      chats = list.chats;
      stats = s;
    } catch (e) {
      errorToast(e);
    }
  }
  $effect(() => {
    void [current, app.libraryVersion];
    void load();
    try {
      localStorage.setItem("mea.collection", current);
    } catch {
      // ignore
    }
  });

  async function newCollection() {
    const name = await promptText({ title: "New collection", placeholder: "Rainy-day stories", confirmLabel: "Create" });
    if (!name?.trim()) return;
    try {
      const c = await post<Collection>("/api/collections", { name: name.trim() });
      current = c.id;
    } catch (e) {
      errorToast(e);
    }
  }
  async function renameCurrent() {
    const c = collections.find((x) => x.id === current);
    if (!c) return;
    const name = await promptText({ title: "Rename collection", value: c.name, confirmLabel: "Rename" });
    if (!name?.trim()) return;
    try {
      await patch(`/api/collections/${c.id}`, { name: name.trim() });
      await load();
    } catch (e) {
      errorToast(e);
    }
  }
  async function deleteCurrent() {
    try {
      await del(`/api/collections/${current}`);
      current = "";
    } catch (e) {
      errorToast(e);
    }
  }
  const hours = (m: number) => (m >= 90 ? `${Math.round(m / 60)} h` : `${m} min`);
  const cur = $derived(collections.find((x) => x.id === current));
</script>

<section class="stories">
  <div class="row between wrap">
    <h2>Stories</h2>
    {#if stats && stats.messages}
      <div class="tiny muted statline" title="Across all your chats">{compact(stats.words)} words · {stats.daysActive} day{stats.daysActive === 1 ? "" : "s"} · {hours(stats.minutesSpent)} · longest streak {stats.longestStreak} day{stats.longestStreak === 1 ? "" : "s"}</div>
    {/if}
  </div>
  <div class="chips">
    <button class="chip" class:on={!current} onclick={() => (current = "")}>Recent</button>
    {#each collections as c (c.id)}
      <button class="chip" class:on={current === c.id} onclick={() => (current = c.id)}>{#if c.builtin === "favorites"}<Star size={11} />{/if} {c.name} <span class="faint">{c.count}</span></button>
    {/each}
    <button class="chip" class:on={current === ARCHIVED} onclick={() => (current = ARCHIVED)}>Archived</button>
    <button class="chip ghost" onclick={newCollection} aria-label="New collection"><Plus size={12} /></button>
    {#if cur}
      <button class="chip ghost tiny" onclick={renameCurrent}>Rename</button>
      {#if !cur.builtin}<button class="chip ghost tiny" onclick={deleteCurrent}>Delete</button>{/if}
    {/if}
  </div>
  <div class="grid">
    {#each chats as c (c.id)}
      <a class="story card" href="/chat/{c.id}">
        {#if c.coverImageId}
          <img class="cover" src={imageUrl(c.coverImageId, true)} alt="" loading="lazy" />
        {:else}
          <div class="cover blank"><Avatar id={c.avatarId} name={c.characterName ?? ""} size={46} shape="squircle" /></div>
        {/if}
        <div class="meta">
          <b class="wraps">{c.title}</b>
          <span class="tiny muted wraps">{c.characterName} · {timeAgo(c.lastMessageAt ?? c.createdAt)} · {c.messageCount} messages</span>
        </div>
      </a>
    {:else}
      <p class="tiny muted">{current === ARCHIVED ? "No archived chats. Archive one from its panel (Chat tab)." : current ? "Nothing in this collection yet. Add chats from their panel (Chat tab)." : "No stories yet."}</p>
    {/each}
  </div>
</section>

<style>
  .stories {
    display: grid;
    gap: 0.6rem;
  }
  h2 {
    margin: 0;
  }
  .chips {
    display: flex;
    gap: 0.35rem;
    flex-wrap: wrap;
  }
  .chip {
    cursor: pointer;
    border: 1px solid var(--border);
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
  }
  .chip.on {
    border-color: var(--accent);
    color: var(--accent-ink);
  }
  .chip.ghost {
    background: none;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(13rem, 1fr));
    gap: 0.6rem;
  }
  .story {
    display: grid;
    color: inherit;
    overflow: hidden;
    padding: 0;
  }
  .cover {
    width: 100%;
    height: 5.5rem;
    object-fit: cover;
    display: block;
  }
  .cover.blank {
    display: grid;
    place-items: center;
    background: color-mix(in srgb, var(--lavender, #c9b8ff) 18%, var(--surface));
  }
  .meta {
    display: grid;
    gap: 0.1rem;
    padding: 0.5rem 0.65rem 0.6rem;
    min-width: 0;
  }
</style>
