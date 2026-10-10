<script lang="ts">
  import { get } from "../lib/api";
  import { onEvent } from "../lib/events";
  import { BookOpen, House, Inbox, Menu, Users, WandSparkles } from "../lib/icons";
  import { route } from "../lib/router.svelte";
  import { app } from "../lib/state.svelte";

  // Lantern on the phone: a floating dock at the bottom. "More" opens the full menu.
  let inbox = $state(0);
  async function count() {
    try {
      inbox = (await get<{ count: number }>("/api/inbox/count")).count;
    } catch {
      // best-effort
    }
  }
  $effect(() => {
    void app.libraryVersion;
    void count();
  });
  $effect(() =>
    onEvent((e) => {
      if (e.type === "inbox.changed" || e.type === "reconnected") void count();
    }),
  );

  const nav = [
    { href: "/", label: "Home", icon: House, match: ["home", "character"] },
    { href: "/personas", label: "Personas", icon: Users, match: ["personas"] },
    { href: "/creator", label: "Studio", icon: WandSparkles, match: ["creator", "studio"] },
    { href: "/lorebooks", label: "Lore", icon: BookOpen, match: ["lorebooks", "lorebook"] },
    { href: "/inbox", label: "Inbox", icon: Inbox, match: ["inbox"] },
  ];
</script>

<nav class="bottom" aria-label="Main">
  {#each nav as item (item.href)}
    <a href={item.href} class="nav" class:on={item.match.includes(route.name)} aria-label={item.label}>
      <item.icon size={21} />
      {#if item.href === "/inbox" && inbox > 0}<span class="badge">{inbox > 99 ? "99+" : inbox}</span>{/if}
    </a>
  {/each}
  <button class="nav" onclick={() => (app.drawerOpen = true)} aria-label="More"><Menu size={21} /></button>
</nav>

<style>
  .bottom {
    position: fixed;
    left: 50%;
    bottom: calc(10px + var(--safe-bottom));
    translate: -50% 0;
    z-index: 30;
    display: flex;
    gap: 2px;
    padding: 6px;
    border-radius: 22px;
    background: color-mix(in srgb, var(--pop) 82%, transparent);
    border: 1px solid color-mix(in srgb, var(--hi) 10%, transparent);
    backdrop-filter: blur(20px) saturate(150%);
    -webkit-backdrop-filter: blur(20px) saturate(150%);
    box-shadow: 0 20px 50px -10px color-mix(in srgb, var(--lo) 70%, transparent);
  }
  .nav {
    position: relative;
    width: 50px;
    height: 48px;
    border-radius: 16px;
    display: grid;
    place-items: center;
    border: 0;
    background: none;
    color: var(--text-faint) !important;
    text-decoration: none !important;
    cursor: pointer;
  }
  .nav.on {
    color: var(--text) !important;
    background: color-mix(in srgb, var(--hi) 11%, transparent);
  }
  .nav.on::after {
    content: "";
    position: absolute;
    left: 15px;
    right: 15px;
    bottom: 4px;
    height: 3px;
    border-radius: 3px;
    background: var(--grad);
    box-shadow: 0 0 10px var(--accent);
  }
  .badge {
    position: absolute;
    top: 5px;
    right: 6px;
    min-width: 17px;
    height: 17px;
    padding: 0 4px;
    border-radius: 99px;
    background: var(--accent);
    color: var(--on-accent);
    font: 800 10px/17px var(--font-ui);
    text-align: center;
  }
</style>
