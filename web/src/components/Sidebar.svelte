<script lang="ts">
  import { isRoom, themeInfo } from "../lib/themes";
  import { get } from "../lib/api";
  import { onEvent } from "../lib/events";
  import { timeAgo } from "../lib/format";
  import { device, setDevice } from "../lib/device.svelte";
  import { palette } from "../lib/palette.svelte";
  import { BookOpen, Eye, EyeOff, House, Inbox, Moon, NotebookPen, Search, Settings, SlidersHorizontal, Sun, Trash, Users, WandSparkles } from "../lib/icons";
  import { route } from "../lib/router.svelte";
  import { app, saveSetting } from "../lib/state.svelte";
  import type { ChatListItem } from "../lib/types";
  import Avatar from "./Avatar.svelte";
  import QuotaRing from "./QuotaRing.svelte";

  let chats = $state<ChatListItem[]>([]);

  async function load() {
    try {
      chats = (await get<{ chats: ChatListItem[] }>("/api/chats?limit=12")).chats;
    } catch {
      // sidebar is best-effort
    }
  }

  $effect(() => {
    void app.libraryVersion;
    void load();
  });

  $effect(() =>
    onEvent((e) => {
      if (e.type === "chat.changed" || e.type === "gen.end" || e.type === "reconnected") void load();
      if (e.type === "inbox.changed" || e.type === "memory.changed" || e.type === "reconnected") countSoon();
    }),
  );

  // CON-09: how many proposals wait in the review inbox.
  let inbox = $state(0);
  let countTimer: ReturnType<typeof setTimeout>;
  function countSoon() {
    clearTimeout(countTimer);
    countTimer = setTimeout(async () => {
      try {
        inbox = (await get<{ count: number }>("/api/inbox/count")).count;
      } catch {
        // best-effort
      }
    }, 1500);
  }
  $effect(() => {
    void app.libraryVersion;
    countSoon();
  });

  const nav = [
    { href: "/", label: "Home", icon: House, match: ["home", "character"] },
    { href: "/personas", label: "Personas", icon: Users, match: ["personas"] },
    { href: "/creator", label: "Studio", icon: WandSparkles, match: ["creator", "studio"] },
    { href: "/lorebooks", label: "Lorebooks", icon: BookOpen, match: ["lorebooks", "lorebook"] },
    { href: "/presets", label: "Presets", icon: SlidersHorizontal, match: ["presets", "preset"] },
    { href: "/notebook", label: "Notebook", icon: NotebookPen, match: ["notebook"] },
    { href: "/inbox", label: "Inbox", icon: Inbox, match: ["inbox"] },
    { href: "/settings", label: "Settings", icon: Settings, match: ["settings"] },
  ];

  const dark = $derived(app.dark);
  // In a room, day ↔ night. Otherwise Lantern → Mea Cozy → Cozy Night → Lantern.
  function toggleTheme() {
    if (isRoom(app.theme)) void saveSetting("appearance.themeMode", app.night ? "day" : "night");
    else void saveSetting("appearance.theme", app.theme === "lantern" ? "light" : app.theme === "light" ? "dark" : "lantern");
  }
  const themeTitle = $derived(isRoom(app.theme) ? (app.night ? themeInfo(app.theme)?.day : themeInfo(app.theme)?.night) : app.theme === "lantern" ? "Mea Cozy (light)" : app.theme === "light" ? "Cozy Night" : "Lantern");
</script>

<div class="sidebar">
  <div class="top">
    <a href="/" class="brand">Mea<span>✿</span></a>
    <div class="row">
      {#if app.activity.running > 0}
        <span class="weaving" title="Working in the background"><span class="dot"></span></span>
      {/if}
      <QuotaRing />
      <button class="btn ghost icon small" onclick={() => ((app.drawerOpen = false), (palette.open = true))} aria-label="Jump to anything" title="Jump to anything (Ctrl+K)"><Search size={16} /></button>
      <button class="btn ghost icon small" onclick={() => setDevice("discreet", !device.discreet)} aria-label={device.discreet ? "Leave discreet mode" : "Discreet mode: blur avatars and previews"} aria-pressed={device.discreet} title={device.discreet ? "Discreet mode is on" : "Discreet mode"}>
        {#if device.discreet}<EyeOff size={16} />{:else}<Eye size={16} />{/if}
      </button>
      <button class="btn ghost icon small" onclick={toggleTheme} aria-label="Change theme" title={themeTitle}>
        {#if dark}<Sun size={16} />{:else}<Moon size={16} />{/if}
      </button>
    </div>
  </div>

  <nav>
    {#each nav as item (item.href)}
      <a href={item.href} class="nav" class:active={item.match.includes(route.name)}>
        <item.icon size={18} />
        <span>{item.label}</span>
        {#if item.href === "/inbox" && inbox > 0}<span class="badge" aria-label="{inbox} waiting">{inbox > 99 ? "99+" : inbox}</span>{/if}
      </a>
    {/each}
  </nav>

  <div class="section-title">Recent stories</div>
  <div class="chats">
    {#each chats as c (c.id)}
      <a href="/chat/{c.id}" class="chat" class:active={route.name === "chat" && route.params.id === c.id}>
        <Avatar id={c.avatarId} name={c.characterName ?? "?"} size={34} />
        <span class="grow">
          <span class="name truncate">{c.characterName ?? "Unknown"}</span>
          <span class="sub truncate dz">{c.lastText || c.title}</span>
        </span>
        <span class="when">{timeAgo(c.lastMessageAt)}</span>
      </a>
    {:else}
      <p class="faint small empty">Your stories will appear here.</p>
    {/each}
  </div>

  <div class="bottom">
    <a href="/trash" class="nav small" class:active={route.name === "trash"}><Trash size={16} /><span>Trash</span></a>
  </div>
</div>

<style>
  .sidebar {
    display: flex;
    flex-direction: column;
    height: 100%;
    padding: calc(0.9rem + var(--safe-top)) 0.75rem 0.75rem;
    gap: 0.4rem;
  }
  .top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 0.4rem 0.5rem;
  }
  .brand {
    font-family: var(--font-display);
    font-variation-settings: "SOFT" 100;
    font-size: 1.6rem;
    font-weight: 600;
    color: var(--text);
    text-decoration: none !important;
  }
  .badge {
    margin-left: auto;
    min-width: 1.3rem;
    padding: 0 0.35rem;
    border-radius: var(--r-pill);
    background: var(--accent);
    color: var(--accent-ink);
    font-size: var(--fs-xs);
    font-weight: 800;
    text-align: center;
  }
  .brand span {
    color: var(--accent-strong);
    font-size: 0.75em;
    margin-left: 0.15em;
  }
  nav {
    display: grid;
    gap: 0.15rem;
  }
  .nav {
    display: flex;
    align-items: center;
    gap: 0.7rem;
    padding: 0.55rem 0.75rem;
    border-radius: var(--r-sm);
    color: var(--text-muted);
    font-weight: 700;
    font-size: var(--fs-sm);
    text-decoration: none !important;
    transition: background var(--t-fast);
  }
  .nav:hover {
    background: var(--surface-2);
    color: var(--text);
  }
  .nav.active {
    background: var(--surface);
    color: var(--text);
    box-shadow: var(--shadow-1);
  }
  .section-title {
    margin: 0.9rem 0.75rem 0.2rem;
    font-size: var(--fs-xs);
    font-weight: 800;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-faint);
  }
  .chats {
    flex: 1;
    overflow-y: auto;
    display: grid;
    align-content: start;
    gap: 0.1rem;
    margin: 0 -0.25rem;
    padding: 0 0.25rem;
  }
  .chat {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.45rem 0.55rem;
    border-radius: var(--r-sm);
    color: var(--text);
    text-decoration: none !important;
  }
  .chat:hover {
    background: var(--surface-2);
  }
  .chat.active {
    background: color-mix(in srgb, var(--accent) 22%, var(--surface));
  }
  .chat .grow {
    display: grid;
  }
  .name {
    font-weight: 700;
    font-size: var(--fs-sm);
  }
  .sub {
    font-size: var(--fs-xs);
    color: var(--text-muted);
  }
  .when {
    font-size: 0.68rem;
    color: var(--text-faint);
    align-self: flex-start;
    margin-top: 0.2rem;
    white-space: nowrap;
  }
  .empty {
    padding: 0.5rem 0.75rem;
  }
  .bottom {
    border-top: 1px solid var(--border);
    padding-top: 0.4rem;
  }
  .weaving {
    display: inline-grid;
    place-items: center;
    width: 1.2rem;
  }
  .dot {
    width: 0.55rem;
    height: 0.55rem;
    border-radius: 50%;
    background: var(--lavender);
    animation: pulse 1.6s ease-in-out infinite;
  }
</style>
