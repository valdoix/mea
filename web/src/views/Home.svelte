<script lang="ts">
  import Avatar from "../components/Avatar.svelte";
  import EmptyState from "../components/EmptyState.svelte";
  import Stories from "../components/library/Stories.svelte";
  import { api, get, post, put } from "../lib/api";
  import { greeting, timeAgo } from "../lib/format";
  import { Heart, Import, MessageHeart, Plus, Search, Star, WandSparkles } from "../lib/icons";
  import { navigate } from "../lib/router.svelte";
  import { app, errorToast, toast } from "../lib/state.svelte";
  import type { CharacterSummary, ChatListItem } from "../lib/types";

  let characters = $state<CharacterSummary[]>([]);
  let tags = $state<string[]>([]);
  let folders = $state<string[]>([]);
  let recent = $state<ChatListItem[]>([]);
  let dots = $state<Record<string, { score: number; level: "good" | "fair" | "poor" } | null>>({});
  let loaded = $state(false);
  let q = $state("");
  let tag = $state("");
  let folder = $state("");
  let favOnly = $state(false);
  let sort = $state<"recent" | "name" | "created" | "updated">((localStorage.getItem("mea.sort") as "recent") || "recent");
  let dragging = $state(false);
  let importing = $state(false);
  let fileInput = $state<HTMLInputElement | null>(null);

  async function load() {
    const params = new URLSearchParams({ sort });
    if (q) params.set("q", q);
    if (tag) params.set("tag", tag);
    if (folder) params.set("folder", folder);
    if (favOnly) params.set("favorite", "1");
    try {
      const [lib, chats] = await Promise.all([
        get<{ characters: CharacterSummary[]; tags: string[]; folders: string[] }>(`/api/characters?${params}`),
        get<{ chats: ChatListItem[] }>("/api/chats?limit=6"),
      ]);
      characters = lib.characters;
      tags = lib.tags;
      folders = lib.folders;
      recent = chats.chats;
      // D3: a story-health dot on each recent chat (best effort).
      if (recent.length) get<{ dots: Record<string, { score: number; level: "good" | "fair" | "poor" } | null> }>(`/api/story-health/dots?ids=${recent.map((c) => c.id).join(",")}`).then((r) => (dots = r.dots), () => {});
    } catch (e) {
      errorToast(e);
    }
    loaded = true;
  }

  let searchTimer: ReturnType<typeof setTimeout>;
  $effect(() => {
    void [q, tag, folder, favOnly, sort, app.libraryVersion];
    clearTimeout(searchTimer);
    searchTimer = setTimeout(load, q ? 180 : 0);
    try {
      localStorage.setItem("mea.sort", sort);
    } catch {
      // ignore
    }
  });

  async function importFiles(files: FileList | File[]) {
    if (!files.length) return;
    importing = true;
    const form = new FormData();
    for (const f of files) form.append("file", f);
    try {
      const r = await api<{ results: { ok: boolean; file: string; kind?: string; name?: string; error?: string; notes?: string[] }[] }>("POST", "/api/import", form);
      for (const res of r.results) {
        if (res.ok) toast(`Imported ${res.kind}: ${res.name}${res.notes?.length ? ` · ${res.notes[0]}` : ""}`, { kind: "ok" });
        else toast(`${res.file}: ${res.error}`, { kind: "error" });
      }
      await load();
    } catch (e) {
      errorToast(e);
    } finally {
      importing = false;
    }
  }

  async function newCharacter() {
    try {
      const c = await post<{ id: string }>("/api/characters", { name: "New character" });
      navigate(`/character/${c.id}?tab=card`);
    } catch (e) {
      errorToast(e);
    }
  }

  async function toggleFav(c: CharacterSummary, e: Event) {
    e.preventDefault();
    e.stopPropagation();
    c.favorite = !c.favorite;
    try {
      await put(`/api/characters/${c.id}`, { favorite: c.favorite });
    } catch (err) {
      c.favorite = !c.favorite;
      errorToast(err);
    }
  }

  async function startChat(c: CharacterSummary, e: Event) {
    e.preventDefault();
    e.stopPropagation();
    try {
      const chats = (await get<{ chats: ChatListItem[] }>(`/api/chats?characterId=${c.id}&limit=1`)).chats;
      if (chats[0]) navigate(`/chat/${chats[0].id}`);
      else navigate(`/chat/${(await post<{ id: string }>("/api/chats", { characterId: c.id })).id}`);
    } catch (err) {
      errorToast(err);
    }
  }

  const latest = $derived(recent[0]);
  const when = new Date().toLocaleDateString(undefined, { weekday: "long" });

  /** Lantern: a character card leans toward the pointer and catches the light. */
  function tilt(el: HTMLElement) {
    if (app.isMobile || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width;
      const y = (e.clientY - r.top) / r.height;
      el.style.transform = `perspective(900px) rotateY(${(x - 0.5) * 9}deg) rotateX(${(0.5 - y) * 9}deg) translateY(-4px)`;
      el.style.setProperty("--mx", `${x * 100}%`);
      el.style.setProperty("--my", `${y * 100}%`);
    };
    const leave = () => (el.style.transform = "");
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerleave", leave);
    return { destroy: () => (el.removeEventListener("pointermove", move), el.removeEventListener("pointerleave", leave)) };
  }
  // UI-14: the chapter you're in and one line of recap, for the Continue card.
  let cont = $state<{ chapter: { title: string; storyTime: string | null } | null; line: string | null } | null>(null);
  $effect(() => {
    const idNow = latest?.id;
    cont = null;
    if (idNow) get<NonNullable<typeof cont>>(`/api/chats/${idNow}/continue`).then((r) => idNow === latest?.id && (cont = r), () => {});
  });
</script>

<svelte:window
  ondragover={(e) => {
    if (e.dataTransfer?.types.includes("Files")) {
      e.preventDefault();
      dragging = true;
    }
  }}
  ondragleave={(e) => {
    if (!e.relatedTarget) dragging = false;
  }}
  ondrop={(e) => {
    e.preventDefault();
    dragging = false;
    if (e.dataTransfer?.files) void importFiles(e.dataTransfer.files);
  }}
/>

<div class="home">
  <header class="hello">
    <div class="eyebrow-l lamp">{when}</div>
    <h1>{greeting()}<span class="spark">✿</span></h1>
    <p class="muted">{latest ? `The lamp is lit. ${latest.characterName ?? "Your story"} is waiting where you left off.` : "Pick up a story, or start a new one."}</p>
  </header>

  {#if latest}
    <a href="/chat/{latest.id}" class="continue card">
      <span class="hero-pic"><Avatar id={latest.avatarId} name={latest.characterName ?? ""} size={app.isMobile ? 64 : 112} portrait={!app.isMobile} shape="squircle" /></span>
      <div class="grow">
        <div class="tiny muted eyebrow">Continue · {timeAgo(latest.lastMessageAt)}{#if dots[latest.id]}{@const d = dots[latest.id]!}<span class="hdot {d.level}" title="Story health {d.score}" aria-label="Story health {d.score}"></span>{/if}</div>
        <div class="title">{latest.characterName}{#if cont?.chapter}<span class="chapter"> · {cont.chapter.title}</span>{/if}</div>
        {#if cont?.line}<p class="recapline dz">{cont.line}</p>{/if}
        <p class="last prose dz">{latest.lastText || latest.title}</p>
      </div>
      <span class="btn primary go"><MessageHeart size={18} /> Continue</span>
    </a>
    {#if recent.length > 1}
      <div class="recent">
        {#each recent.slice(1) as c (c.id)}
          <a href="/chat/{c.id}" class="mini card">
            <Avatar id={c.avatarId} name={c.characterName ?? ""} size={36} />
            <span class="grow truncate"><b>{c.characterName}</b> <span class="muted">· {timeAgo(c.lastMessageAt)}</span></span>
            {#if dots[c.id]}<span class="hdot {dots[c.id]!.level}" title="Story health {dots[c.id]!.score}" aria-label="Story health {dots[c.id]!.score}"></span>{/if}
          </a>
        {/each}
      </div>
    {/if}
  {/if}

  {#if latest}<Stories />{/if}

  <section class="library">
    <div class="toolbar">
      <h2>Characters</h2>
      <div class="row wrap tools">
        <label class="search input">
          <Search size={16} />
          <input bind:value={q} placeholder="Search characters…" aria-label="Search characters" />
        </label>
        <select class="select sort" bind:value={sort} aria-label="Sort">
          <option value="recent">Recently played</option>
          <option value="name">Name</option>
          <option value="updated">Recently edited</option>
          <option value="created">Newest</option>
        </select>
        <button class="btn" onclick={() => fileInput?.click()} disabled={importing}><Import size={16} /> {importing ? "Importing…" : "Import"}</button>
        <a class="btn" href="/creator?kind=character" title="Expand an idea into a full card with the Creator Studio"><WandSparkles size={16} /> Create</a>
        <button class="btn primary" onclick={newCharacter}><Plus size={16} /> New</button>
        <input bind:this={fileInput} type="file" accept=".png,.json,.charx,image/png,application/json" multiple hidden onchange={(e) => e.currentTarget.files && importFiles(e.currentTarget.files)} />
      </div>
    </div>

    {#if tags.length || folders.length}
      <div class="filters row wrap">
        <button class="chip" class:rose={favOnly} onclick={() => (favOnly = !favOnly)}><Star size={12} /> Favorites</button>
        {#each folders as f (f)}
          <button class="chip" class:sky={folder === f} onclick={() => (folder = folder === f ? "" : f)}>📁 {f}</button>
        {/each}
        {#each tags as t (t)}
          <button class="chip" class:lavender={tag === t} onclick={() => (tag = tag === t ? "" : t)}>{t}</button>
        {/each}
      </div>
    {/if}

    {#if loaded && characters.length === 0}
      {#if q || tag || folder || favOnly}
        <p class="muted" style="padding:2rem 0">No characters match. <button class="btn ghost small" onclick={() => ((q = ""), (tag = ""), (folder = ""), (favOnly = false))}>Clear filters</button></p>
      {:else}
        <EmptyState title="No characters yet" text="Import a character card (PNG, JSON or CHARX), drop files anywhere on this page, or create one from scratch.">
          <button class="btn" onclick={() => fileInput?.click()}><Import size={16} /> Import a card</button>
          <a class="btn primary" href="/creator?kind=character"><WandSparkles size={16} /> Create one with the studio</a>
          <button class="btn" onclick={newCharacter}><Plus size={16} /> Blank card</button>
        </EmptyState>
      {/if}
    {:else}
      <div class="grid">
        {#each characters as c (c.id)}
          <a href="/character/{c.id}" class="char card" use:tilt>
            <span class="shine" aria-hidden="true"></span>
            <div class="portrait">
              <Avatar id={c.avatarId} name={c.name} size={220} portrait shape="squircle" palette={c.palette} />
              <button class="fav" class:on={c.favorite} onclick={(e) => toggleFav(c, e)} aria-label={c.favorite ? "Unfavorite" : "Favorite"}>
                <Heart size={16} fill={c.favorite ? "currentColor" : "none"} />
              </button>
            </div>
            <div class="meta">
              <div class="name truncate">{c.name}</div>
              <div class="row between">
                <span class="tiny muted truncate">{c.chatCount ? `${c.chatCount} chat${c.chatCount === 1 ? "" : "s"}` : "No chats yet"}</span>
                <button class="btn small chatbtn" onclick={(e) => startChat(c, e)}><MessageHeart size={14} /> Chat</button>
              </div>
            </div>
          </a>
        {/each}
      </div>
    {/if}
  </section>
</div>

{#if dragging}
  <div class="drop"><div class="drop-inner"><Import size={30} /> Drop cards, lorebooks, or presets to import</div></div>
{/if}

<style>
  .hdot {
    display: inline-block;
    width: 8px;
    height: 8px;
    margin-left: 0.4rem;
    border-radius: 50%;
    vertical-align: middle;
    background: var(--ok);
    flex: 0 0 auto;
  }
  .hdot.fair {
    background: var(--warn, #b7791f);
  }
  .hdot.poor {
    background: var(--danger);
  }
  .home {
    max-width: 72rem;
    margin: 0 auto;
    padding: 2rem clamp(1rem, 3vw, 2.5rem) 4rem;
    display: grid;
    gap: 1.5rem;
  }
  .hello h1 {
    font-size: clamp(1.7rem, 3vw, 2.2rem);
  }
  .spark {
    color: var(--accent-ink);
    font-size: 0.7em;
  }
  .continue {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 1rem 1.2rem;
    color: var(--text);
    text-decoration: none !important;
    background: linear-gradient(120deg, color-mix(in srgb, var(--peach) 28%, var(--surface)), color-mix(in srgb, var(--lavender) 28%, var(--surface)));
    transition: transform var(--t) var(--ease);
  }
  .continue:hover {
    transform: translateY(-2px);
  }
  .eyebrow {
    font-weight: 800;
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }
  .title {
    font-family: var(--font-display);
    font-variation-settings: "SOFT" 100;
    font-size: 1.3rem;
    font-weight: 600;
  }
  .chapter {
    font-family: var(--font-story);
    font-style: italic;
    font-weight: 400;
    font-size: 0.8em;
    color: var(--text-muted);
  }
  .recapline {
    margin: 0.15rem 0 0.25rem;
    font-size: var(--fs-sm);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .last {
    font-size: var(--fs-sm);
    color: var(--text-muted);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    margin-top: 0.2rem;
  }
  .recent {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr));
    gap: 0.6rem;
    margin-top: -0.6rem;
  }
  .mini {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.5rem 0.7rem;
    color: var(--text);
    text-decoration: none !important;
    font-size: var(--fs-sm);
  }
  .toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    flex-wrap: wrap;
    margin-bottom: 0.8rem;
  }
  .tools {
    gap: 0.5rem;
  }
  .search {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    width: 15rem;
    border-radius: var(--r-pill);
    padding: 0.45rem 0.9rem;
    color: var(--text-muted);
  }
  .search input {
    border: 0;
    background: none;
    outline: none;
    font: inherit;
    color: var(--text);
    width: 100%;
  }
  .sort {
    width: auto;
    border-radius: var(--r-pill);
  }
  .filters {
    gap: 0.4rem;
    margin-bottom: 1rem;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(10.5rem, 1fr));
    gap: 1rem;
  }
  .char {
    display: grid;
    color: var(--text);
    text-decoration: none !important;
    overflow: hidden;
    transition:
      transform var(--t) var(--ease),
      box-shadow var(--t) var(--ease);
    animation: fade-up 0.35s var(--ease) both;
  }
  .char:hover {
    transform: translateY(-3px);
    box-shadow: var(--shadow-2);
  }
  .portrait {
    position: relative;
    aspect-ratio: 2 / 3;
    overflow: hidden;
  }
  .portrait :global(.avatar) {
    width: 100% !important;
    height: 100% !important;
    border-radius: 0 !important;
  }
  .fav {
    position: absolute;
    top: 0.5rem;
    right: 0.5rem;
    width: 2rem;
    height: 2rem;
    border-radius: 50%;
    border: 0;
    display: grid;
    place-items: center;
    background: var(--glass);
    color: var(--text-muted);
    cursor: pointer;
    backdrop-filter: blur(6px);
  }
  .fav.on {
    color: var(--accent-ink);
  }
  .meta {
    padding: 0.6rem 0.7rem 0.7rem;
    display: grid;
    gap: 0.35rem;
  }
  .name {
    font-weight: 800;
  }
  .chatbtn {
    min-height: 1.8rem;
  }
  .drop {
    position: fixed;
    inset: 0;
    z-index: 100;
    background: var(--scrim);
    display: grid;
    place-items: center;
    pointer-events: none;
  }
  .drop-inner {
    display: grid;
    justify-items: center;
    gap: 0.6rem;
    padding: 2rem 3rem;
    border-radius: var(--r-lg);
    border: 2px dashed var(--accent-strong);
    background: var(--surface);
    font-weight: 700;
  }
  /* ---------- Lantern ---------- */
  .shine {
    display: none;
  }
  :global([data-shell="lantern"]) .home {
    gap: 1.8rem;
  }
  :global([data-shell="lantern"]) .hello h1 {
    font-size: clamp(2.6rem, 6vw, 4.4rem);
    line-height: 0.95;
    margin: 0.5rem 0 0.4rem;
  }
  :global([data-shell="lantern"]) .hello .spark {
    margin-left: 0.25em;
    font-size: 0.45em;
    vertical-align: middle;
    color: var(--lamp);
    text-shadow: 0 0 16px var(--lamp);
  }
  :global([data-shell="lantern"]) .hello p {
    font-size: 1.02rem;
  }
  :global([data-shell="lantern"]) .continue {
    position: relative;
    overflow: hidden;
    gap: 1.6rem;
    padding: 1.3rem 1.6rem 1.3rem 1.3rem;
    border-radius: 30px;
    background:
      radial-gradient(500px 240px at 0% 0%, color-mix(in srgb, var(--lamp) 14%, transparent), transparent 70%),
      linear-gradient(135deg, color-mix(in srgb, var(--hi) 8%, transparent), color-mix(in srgb, var(--accent) 5%, transparent) 60%, color-mix(in srgb, var(--lavender) 6%, transparent));
    border-color: color-mix(in srgb, var(--lamp) 28%, transparent);
  }
  :global([data-shell="lantern"]) .continue:hover {
    transform: translateY(-3px);
    box-shadow: 0 30px 60px -24px color-mix(in srgb, var(--lo) 80%, transparent), 0 0 40px -16px color-mix(in srgb, var(--lamp) 45%, transparent);
  }
  :global([data-shell="lantern"]) .hero-pic {
    display: inline-flex;
    border-radius: 24px;
    box-shadow:
      0 0 0 2px var(--bg),
      0 0 0 3.5px color-mix(in srgb, var(--lamp) 60%, transparent),
      0 20px 40px -14px color-mix(in srgb, var(--lo) 75%, transparent);
  }
  :global([data-shell="lantern"]) .hero-pic :global(.avatar) {
    border-radius: 24px !important;
  }
  :global([data-shell="lantern"]) .continue .eyebrow {
    color: var(--lamp);
    letter-spacing: 0.2em;
  }
  :global([data-shell="lantern"]) .continue .title {
    font-size: clamp(1.8rem, 3.4vw, 2.6rem);
    font-weight: 400;
    line-height: 1.05;
    margin: 0.2rem 0 0.3rem;
  }
  :global([data-shell="lantern"]) .continue .recapline {
    font: italic 400 1.05rem/1.55 var(--font-story);
    color: var(--recap-ink, #f0e2d6);
    padding-left: 0.9rem;
    border-left: 2px solid var(--lamp);
  }
  :global([data-shell="lantern"]) .continue .go {
    background: var(--grad-warm);
    color: var(--on-warm, #2b1724);
    min-height: 3rem;
    padding: 0 1.3rem;
  }
  :global([data-shell="lantern"]) .mini {
    border-radius: 18px;
  }
  :global([data-shell="lantern"]) .toolbar h2 {
    font-size: 2rem;
  }
  :global([data-shell="lantern"]) .grid {
    grid-template-columns: repeat(auto-fill, minmax(12.5rem, 1fr));
    gap: 1.1rem;
  }
  :global([data-shell="lantern"]) .char {
    position: relative;
    border-radius: 26px;
    transform-style: preserve-3d;
    transition:
      transform 0.5s var(--ease),
      box-shadow 0.4s;
  }
  :global([data-shell="lantern"]) .char .portrait {
    aspect-ratio: 3 / 4.1;
  }
  :global([data-shell="lantern"]) .char .portrait :global(.avatar img) {
    transition: transform 0.8s var(--ease);
  }
  :global([data-shell="lantern"]) .char:hover .portrait :global(.avatar img) {
    transform: scale(1.06);
  }
  :global([data-shell="lantern"]) .char .meta {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    padding: 3.2rem 0.95rem 0.95rem;
    background: linear-gradient(180deg, transparent, color-mix(in srgb, var(--bg) 78%, transparent) 45%, color-mix(in srgb, var(--bg) 95%, transparent));
  }
  :global([data-shell="lantern"]) .char .name {
    font: 400 1.65rem/1.05 var(--font-display);
    white-space: normal;
  }
  :global([data-shell="lantern"]) .shine {
    display: block;
    position: absolute;
    inset: 0;
    z-index: 2;
    pointer-events: none;
    background: radial-gradient(circle at var(--mx, 50%) var(--my, 0%), color-mix(in srgb, var(--hi) 16%, transparent), transparent 45%);
    opacity: 0;
    transition: opacity 0.3s;
  }
  :global([data-shell="lantern"]) .char:hover .shine {
    opacity: 1;
  }
  :global([data-shell="lantern"]) .fav {
    z-index: 3;
    background: color-mix(in srgb, var(--lo) 35%, transparent);
    color: var(--accent-ink);
  }

  @media (max-width: 760px) {
    :global([data-shell="lantern"]) .grid {
      grid-template-columns: repeat(2, 1fr);
      gap: 0.75rem;
    }
    :global([data-shell="lantern"]) .char .name {
      font-size: 1.3rem;
    }
    .home {
      padding-top: 1.2rem;
    }
    .search {
      width: 100%;
      order: -1;
    }
    .tools {
      width: 100%;
    }
    .grid {
      grid-template-columns: repeat(2, 1fr);
      gap: 0.7rem;
    }
    .continue .go {
      display: none;
    }
  }
</style>
