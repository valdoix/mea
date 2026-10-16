<script lang="ts">
  import { get } from "../lib/api";
  import { onEvent } from "../lib/events";
  import { BookOpen, House, Inbox, Menu, NotebookPen, PanelLeft, Search, Settings, SlidersHorizontal, Users, WandSparkles } from "../lib/icons";
  import { toggleRail } from "../lib/layout.svelte";
  import { palette } from "../lib/palette.svelte";
  import { route } from "../lib/router.svelte";
  import { app } from "../lib/state.svelte";
  import type { ChatListItem } from "../lib/types";
  import Avatar from "./Avatar.svelte";
  import QuotaRing from "./QuotaRing.svelte";
  import { BLOOM } from "../lib/ornaments";

  // Lantern: the slim navigation rail. Recent stories sit in it as portraits.
  let chats = $state<ChatListItem[]>([]);
  async function load() {
    try {
      chats = (await get<{ chats: ChatListItem[] }>("/api/chats?limit=5")).chats;
    } catch {
      // best-effort
    }
  }
  $effect(() => {
    void app.libraryVersion;
    void load();
  });

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
  $effect(() =>
    onEvent((e) => {
      if (e.type === "chat.changed" || e.type === "gen.end" || e.type === "reconnected") void load();
      if (e.type === "inbox.changed" || e.type === "memory.changed" || e.type === "reconnected") countSoon();
    }),
  );

  const nav = [
    { href: "/", label: "Home", icon: House, match: ["home", "character"] },
    { href: "/personas", label: "Personas", icon: Users, match: ["personas"] },
    { href: "/creator", label: "Studio", icon: WandSparkles, match: ["creator", "studio"] },
    { href: "/lorebooks", label: "Lorebooks", icon: BookOpen, match: ["lorebooks", "lorebook", "universes"] },
    { href: "/presets", label: "Presets", icon: SlidersHorizontal, match: ["presets", "preset"] },
    { href: "/notebook", label: "Notebook", icon: NotebookPen, match: ["notebook"] },
    { href: "/inbox", label: "Review inbox", icon: Inbox, match: ["inbox"] },
  ];
</script>

<nav class="rail" aria-label="Main">
  <a href="/" class="logo" title="Mea">
    {#if app.theme === "wildflower"}{@html BLOOM}{:else if app.theme === "overprint"}<span>M</span>{:else if app.theme === "citadel"}M{:else if app.theme === "marquee"}Mea{:else if app.theme === "sugarrush"}mea{:else if app.theme === "arcade"}<span>MEA</span>{:else if app.theme === "noir"}<span>M</span>{:else if app.theme === "rosewater"}Mea{:else}✿{/if}
  </a>
  {#each nav as item (item.href)}
    <a href={item.href} class="nav" class:on={item.match.includes(route.name)} aria-label={item.label}>
      <item.icon size={20} />
      {#if item.href === "/inbox" && inbox > 0}<span class="badge">{inbox > 99 ? "99+" : inbox}</span>{/if}
      <span class="tip">{item.label}{item.href === "/inbox" && inbox > 0 ? ` · ${inbox} waiting` : ""}</span>
    </a>
  {/each}

  {#if chats.length}
    <hr />
    <div class="stories">
      {#each chats as c (c.id)}
        <a href="/chat/{c.id}" class="story" class:on={route.name === "chat" && route.params.id === c.id} aria-label={c.characterName ?? c.title}>
          <Avatar id={c.avatarId} name={c.characterName ?? "?"} size={40} />
          <span class="tip">{c.characterName ?? "Unknown"} · <span class="faint">{c.title}</span></span>
        </a>
      {/each}
    </div>
  {/if}

  <span class="grow"></span>
  {#if app.activity.running > 0}<span class="weaving" title="Working in the background"></span>{/if}
  <span class="quota"><QuotaRing /></span>
  <button class="nav" onclick={() => (palette.open = true)} aria-label="Jump to anything"><Search size={19} /><span class="tip">Jump to anything</span></button>
  <button class="nav" onclick={() => (app.drawerOpen = true)} aria-label="Every story and more"><Menu size={19} /><span class="tip">Every story, trash and more</span></button>
  <a href="/settings" class="nav" class:on={route.name === "settings"} aria-label="Settings"><Settings size={19} /><span class="tip">Settings</span></a>
  <button class="nav hide" onclick={() => toggleRail(route.name === "chat")} aria-label="Hide navigation"><PanelLeft size={18} /><span class="tip">Hide navigation</span></button>
</nav>

<style>
  .rail {
    width: 76px;
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    padding: 14px 0 12px;
    border-radius: 26px;
    background: linear-gradient(160deg, color-mix(in srgb, var(--hi) 8.5%, transparent), color-mix(in srgb, var(--hi) 2.5%, transparent));
    border: 1px solid color-mix(in srgb, var(--hi) 9%, transparent);
    backdrop-filter: blur(24px) saturate(150%);
    -webkit-backdrop-filter: blur(24px) saturate(150%);
    box-shadow:
      inset 0 1px 0 color-mix(in srgb, var(--hi) 7%, transparent),
      0 24px 60px -24px color-mix(in srgb, var(--lo) 65%, transparent);
  }
  .logo {
    flex: none;
    width: 48px;
    height: 48px;
    border-radius: 17px;
    display: grid;
    place-items: center;
    margin-bottom: 10px;
    background: var(--grad);
    color: var(--on-accent) !important;
    font-size: 22px;
    text-decoration: none !important;
    box-shadow: 0 0 26px color-mix(in srgb, var(--accent) 45%, transparent);
    animation: breathe 5s ease-in-out infinite;
    transition: transform 0.6s var(--spring);
  }
  .logo:hover {
    transform: rotate(72deg) scale(1.06);
  }
  @keyframes breathe {
    50% {
      box-shadow: 0 0 42px color-mix(in srgb, var(--lavender) 70%, transparent);
    }
  }
  .nav {
    flex: none;
    position: relative;
    width: 48px;
    height: 44px;
    border-radius: 15px;
    display: grid;
    place-items: center;
    border: 0;
    background: none;
    color: var(--text-faint) !important;
    cursor: pointer;
    text-decoration: none !important;
    transition:
      background 0.2s,
      color 0.2s,
      transform 0.3s var(--spring);
  }
  .nav:hover {
    background: color-mix(in srgb, var(--hi) 10%, transparent);
    color: var(--text) !important;
    transform: translateY(-1px);
  }
  .nav.on {
    color: var(--text) !important;
    background: color-mix(in srgb, var(--hi) 11%, transparent);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--hi) 10%, transparent);
  }
  .nav.on::before {
    content: "";
    position: absolute;
    left: -14px;
    top: 12px;
    bottom: 12px;
    width: 3px;
    border-radius: 3px;
    background: var(--grad);
    box-shadow: 0 0 12px var(--accent);
  }
  .badge {
    position: absolute;
    top: 5px;
    right: 5px;
    min-width: 17px;
    height: 17px;
    padding: 0 4px;
    border-radius: 99px;
    background: var(--accent);
    color: var(--on-accent);
    font: 800 10px/17px var(--font-ui);
    text-align: center;
    box-shadow: 0 0 12px var(--accent);
  }
  .tip {
    position: absolute;
    left: 60px;
    top: 50%;
    translate: 0 -50%;
    white-space: nowrap;
    padding: 6px 10px;
    border-radius: 10px;
    background: var(--pop);
    box-shadow:
      inset 0 0 0 1px color-mix(in srgb, var(--hi) 10%, transparent),
      0 10px 30px color-mix(in srgb, var(--lo) 40%, transparent);
    font: 500 12.5px var(--font-ui);
    color: var(--text);
    opacity: 0;
    transform: translateX(-6px);
    pointer-events: none;
    transition: 0.2s var(--ease);
    z-index: 50;
  }
  .nav:hover .tip,
  .story:hover .tip,
  .nav:focus-visible .tip {
    opacity: 1;
    transform: none;
  }
  hr {
    width: 30px;
    border: 0;
    height: 1px;
    background: color-mix(in srgb, var(--hi) 10%, transparent);
    margin: 8px 0;
    flex: none;
  }
  .stories {
    display: flex;
    flex-direction: column;
    gap: 10px;
    align-items: center;
    flex: none;
  }
  .story {
    position: relative;
    border-radius: 50%;
    display: grid;
    transition: transform 0.3s var(--spring);
    text-decoration: none !important;
    color: var(--text) !important;
  }
  .story:hover {
    transform: scale(1.08);
  }
  .story :global(.avatar) {
    border-radius: 50% !important;
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--hi) 14%, transparent);
  }
  .story.on :global(.avatar) {
    box-shadow:
      0 0 0 2px var(--bg),
      0 0 0 3.5px var(--lamp),
      0 0 16px color-mix(in srgb, var(--lamp) 50%, transparent);
  }
  .story .tip {
    left: 54px;
    /* A long story name wraps in a readable box instead of running across the page. */
    white-space: normal;
    width: max-content;
    max-width: min(22rem, calc(100vw - 80px));
  }
  .grow {
    flex: 1;
    min-height: 8px;
  }
  .weaving {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--sea);
    box-shadow: 0 0 10px var(--sea);
    animation: lantern-glow 1.2s ease-in-out infinite alternate;
    margin-bottom: 6px;
  }
  .quota {
    margin-bottom: 4px;
    display: grid;
  }
  .hide {
    color: var(--text-faint) !important;
    opacity: 0.7;
  }
  @media (max-height: 720px) {
    .stories,
    hr {
      display: none;
    }
    .nav {
      height: 40px;
    }
  }
</style>
