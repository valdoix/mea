<script lang="ts">
  import { onMount } from "svelte";
  import Dialogs from "./components/Dialogs.svelte";
  import Modal from "./components/Modal.svelte";
  import Sidebar from "./components/Sidebar.svelte";
  import Toasts from "./components/Toasts.svelte";
  import { get, setUnpairedHandler } from "./lib/api";
  import { connectEvents } from "./lib/events";
  import { onEdgeSwipe } from "./lib/gestures";
  import { Menu, WifiOff } from "./lib/icons";
  import { navigate, route } from "./lib/router.svelte";
  import { app, loadSettings, toast } from "./lib/state.svelte";
  import CharacterEditor from "./views/CharacterEditor.svelte";
  import ChatView from "./views/ChatView.svelte";
  import MemoryInspector from "./views/MemoryInspector.svelte";
  import StoryView from "./views/StoryView.svelte";
  import WorldView from "./views/WorldView.svelte";
  import CodexView from "./views/CodexView.svelte";
  import SearchView from "./views/SearchView.svelte";
  import Home from "./views/Home.svelte";
  import LorebookEditor from "./views/LorebookEditor.svelte";
  import Lorebooks from "./views/Lorebooks.svelte";
  import Pair from "./views/Pair.svelte";
  import Personas from "./views/Personas.svelte";
  import PresetEditor from "./views/PresetEditor.svelte";
  import Presets from "./views/Presets.svelte";
  import SettingsView from "./views/Settings.svelte";
  import Trash from "./views/Trash.svelte";
  import Welcome from "./views/Welcome.svelte";

  let ready = $state(false);
  let unreachable = $state(false);

  setUnpairedHandler(() => {
    app.authorized = false;
    if (route.name !== "pair") navigate("/pair", { replace: true });
  });

  onMount(() => {
    void boot();
    return onEdgeSwipe(() => {
      if (app.isMobile && route.name !== "chat") app.drawerOpen = true;
    });
  });

  async function boot() {
    try {
      const who = await get<{ local: boolean; authorized: boolean }>("/api/whoami");
      app.local = who.local;
      app.authorized = who.authorized;
      if (!who.authorized) {
        if (route.name !== "pair") navigate("/pair", { replace: true });
        ready = true;
        return;
      }
      await loadSettings();
      connectEvents();
      const conns = await get<{ connections: unknown[]; devMode: boolean }>("/api/connections");
      app.devMode = conns.devMode;
      if (!app.settings?.["onboarding.done"] && conns.connections.length === 0 && route.name === "home") navigate("/welcome", { replace: true });
      if (route.query.imported) {
        const n = Number(route.query.imported);
        const failed = Number(route.query.failed || 0);
        toast(n ? `Imported ${n} file${n === 1 ? "" : "s"} ✿` : "Nothing was imported", { kind: n && !failed ? "ok" : failed ? "error" : "info" });
        navigate("/", { replace: true });
      }
      ready = true;
    } catch {
      unreachable = true;
      ready = true;
      setTimeout(() => {
        unreachable = false;
        void boot();
      }, 5000);
    }
  }

  $effect(() => {
    void route.path;
    app.drawerOpen = false;
  });

  const bare = $derived(route.name === "pair" || route.name === "welcome");
  const fullBleed = $derived(route.name === "chat");
</script>

{#if !ready}
  <div class="boot"><span class="heart">✿</span></div>
{:else if unreachable}
  <div class="boot">
    <div class="stack" style="text-align:center;justify-items:center">
      <WifiOff size={36} />
      <h2>Mea is unreachable</h2>
      <p class="muted small">The server isn't answering. Trying again…</p>
    </div>
  </div>
{:else if bare}
  {#if route.name === "pair"}<Pair />{:else}<Welcome />{/if}
{:else}
  <div class="shell" class:full={fullBleed}>
    {#if !app.isMobile}
      <aside class="side"><Sidebar /></aside>
    {/if}
    <main class="main">
      {#if app.isMobile && !fullBleed}
        <header class="mtop">
          <button class="btn ghost icon" onclick={() => (app.drawerOpen = true)} aria-label="Open menu"><Menu size={20} /></button>
          <a href="/" class="brand">Mea<span>✿</span></a>
          <span style="width:2.5rem"></span>
        </header>
      {/if}
      {#if !app.connected && app.authorized}
        <div class="offline tiny"><WifiOff size={13} /> Reconnecting to Mea…</div>
      {/if}
      {#key route.name + (route.params.id ?? "")}
        {#if route.name === "home"}<Home />
        {:else if route.name === "chat"}<ChatView id={route.params.id!} />
        {:else if route.name === "memory"}<MemoryInspector id={route.params.id!} />
        {:else if route.name === "story"}<StoryView id={route.params.id!} />
        {:else if route.name === "world"}<WorldView id={route.params.id!} />
        {:else if route.name === "codex"}<CodexView id={route.params.id!} />
        {:else if route.name === "search"}<SearchView />
        {:else if route.name === "character"}<CharacterEditor id={route.params.id!} />
        {:else if route.name === "personas"}<Personas selectedId={route.params.id} />
        {:else if route.name === "lorebooks"}<Lorebooks />
        {:else if route.name === "lorebook"}<LorebookEditor id={route.params.id!} />
        {:else if route.name === "presets"}<Presets />
        {:else if route.name === "preset"}<PresetEditor id={route.params.id!} />
        {:else if route.name === "settings"}<SettingsView tab={route.params.tab} />
        {:else if route.name === "trash"}<Trash />
        {:else}
          <div class="boot"><div class="stack" style="text-align:center"><h2>Lost in the stacks</h2><a href="/">Back home</a></div></div>
        {/if}
      {/key}
    </main>
  </div>
  {#if app.isMobile}
    <Modal bind:open={app.drawerOpen} side="left">
      <Sidebar />
    </Modal>
  {/if}
{/if}

<Toasts />
<Dialogs />

<style>
  .boot {
    min-height: 100dvh;
    display: grid;
    place-items: center;
    padding: 2rem;
  }
  .heart {
    font-size: 2.4rem;
    color: var(--accent-strong);
    animation: pulse 1.4s ease-in-out infinite;
  }
  .shell {
    display: grid;
    grid-template-columns: var(--sidebar-w) 1fr;
    min-height: 100dvh;
  }
  .side {
    position: sticky;
    top: 0;
    height: 100dvh;
    border-right: 1px solid var(--border);
    background: color-mix(in srgb, var(--surface-2) 55%, var(--bg));
  }
  .main {
    min-width: 0;
    position: relative;
  }
  .shell.full .main {
    height: 100dvh;
  }
  .mtop {
    position: sticky;
    top: 0;
    z-index: 20;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: calc(0.4rem + var(--safe-top)) 0.5rem 0.4rem;
    background: var(--glass);
    backdrop-filter: blur(12px);
    border-bottom: 1px solid var(--border);
  }
  .brand {
    font-family: var(--font-display);
    font-variation-settings: "SOFT" 100;
    font-size: 1.35rem;
    font-weight: 600;
    color: var(--text);
    text-decoration: none !important;
  }
  .brand span {
    color: var(--accent-strong);
    font-size: 0.8em;
    margin-left: 0.15em;
  }
  .offline {
    position: fixed;
    top: calc(0.5rem + var(--safe-top));
    left: 50%;
    translate: -50% 0;
    z-index: 60;
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.35rem 0.8rem;
    border-radius: var(--r-pill);
    background: var(--warn-bg);
    color: var(--warn);
    font-weight: 700;
    box-shadow: var(--shadow-1);
  }
  @media (max-width: 760px) {
    .shell {
      grid-template-columns: 1fr;
    }
  }
</style>
