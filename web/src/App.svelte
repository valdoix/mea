<script lang="ts">
  import { onMount, untrack } from "svelte";
  import Dialogs from "./components/Dialogs.svelte";
  import Modal from "./components/Modal.svelte";
  import Sidebar from "./components/Sidebar.svelte";
  import Rail from "./components/Rail.svelte";
  import BottomNav from "./components/BottomNav.svelte";
  import Sky from "./components/Sky.svelte";
  import Ambience from "./components/Ambience.svelte";
  import { isRoom } from "./lib/themes";
  import { layout, railShown, setFocus, toggleRail } from "./lib/layout.svelte";
  import Toasts from "./components/Toasts.svelte";
  import { get, setSourceHandler, setUnpairedHandler } from "./lib/api";
  import { flushOutbox, outbox } from "./lib/outbox.svelte";
  import { connectEvents } from "./lib/events";
  import { onEdgeSwipe } from "./lib/gestures";
  import { Menu, WifiOff } from "./lib/icons";
  import { navigate, route } from "./lib/router.svelte";
  import { app, loadSettings, toast } from "./lib/state.svelte";
  import type { Component } from "svelte";
  import ChatView from "./views/ChatView.svelte";
  import Home from "./views/Home.svelte";
  import Pair from "./views/Pair.svelte";
  import Unlock from "./views/Unlock.svelte";
  import AppLock from "./components/AppLock.svelte";
  import CommandPalette from "./components/CommandPalette.svelte";
  import { lock, watchLock } from "./lib/applock.svelte";
  import { device, meteredConnection, onConnectionChange } from "./lib/device.svelte";
  import Welcome from "./views/Welcome.svelte";

  // PERF-09: Home and the chat are in the first load; every other screen loads on first visit.
  type Loader = () => Promise<{ default: Component<any> }>;
  const views: Partial<Record<string, Loader>> = {
    memory: () => import("./views/MemoryInspector.svelte"),
    story: () => import("./views/StoryView.svelte"),
    world: () => import("./views/WorldView.svelte"),
    codex: () => import("./views/CodexView.svelte"),
    search: () => import("./views/SearchView.svelte"),
    character: () => import("./views/CharacterEditor.svelte"),
    personas: () => import("./views/Personas.svelte"),
    lorebooks: () => import("./views/Lorebooks.svelte"),
    lorebook: () => import("./views/LorebookEditor.svelte"),
    studio: () => import("./views/LoreStudio.svelte"),
    creator: () => import("./views/Creator.svelte"),
    presets: () => import("./views/Presets.svelte"),
    preset: () => import("./views/PresetEditor.svelte"),
    settings: () => import("./views/Settings.svelte"),
    trash: () => import("./views/Trash.svelte"),
    inbox: () => import("./views/InboxView.svelte"),
    notebook: () => import("./views/NotebookView.svelte"),
  };

  let ready = $state(false);
  let unreachable = $state(false);
  let vaultLocked = $state(false);

  // ARCH-11: reading from this device's saved copy, and sending what waited once Mea is back.
  setSourceHandler((fromCache) => (app.offlineCopy = fromCache));
  // H8: only the connection and the queue's length start a flush; what the flush itself changes doesn't.
  let wasConnected = false;
  $effect(() => {
    const back = app.connected && !wasConnected;
    wasConnected = app.connected;
    if (app.connected && outbox.items.length) untrack(() => void flushOutbox({ now: back }));
  });
  onMount(() => {
    const online = () => void flushOutbox({ now: true });
    window.addEventListener("online", online);
    return () => window.removeEventListener("online", online);
  });

  setUnpairedHandler(() => {
    app.authorized = false;
    if (route.name !== "pair") navigate("/pair", { replace: true });
  });

  onMount(() => {
    void boot();
    const stopLock = watchLock();
    const stopSwipe = onEdgeSwipe(() => {
      if (app.isMobile && route.name !== "chat") app.drawerOpen = true;
    });
    return () => {
      stopLock();
      stopSwipe();
    };
  });

  // MOB-12: data-light mode, by hand or following the connection.
  let metered = $state(meteredConnection());
  onMount(() => onConnectionChange(() => (metered = meteredConnection())));
  $effect(() => {
    app.dataLight = device.dataLight === "on" || (device.dataLight === "auto" && metered);
  });

  // UI-20: discreet mode blurs avatars and previews here, and hides notification text; ARCH-11: offline copies
  // on or off. The service worker reads both, so it's told now and whenever it takes over the page.
  function syncWorker() {
    navigator.serviceWorker?.controller?.postMessage({ type: "prefs", discreet: device.discreet, offline: device.offline });
  }
  $effect(() => {
    document.documentElement.toggleAttribute("data-discreet", device.discreet);
    void device.offline;
    syncWorker();
  });
  onMount(() => {
    navigator.serviceWorker?.addEventListener("controllerchange", syncWorker);
    return () => navigator.serviceWorker?.removeEventListener("controllerchange", syncWorker);
  });

  async function boot() {
    try {
      const who = await get<{ local: boolean; authorized: boolean; locked?: boolean }>("/api/whoami");
      if (who.locked) {
        vaultLocked = true;
        ready = true;
        return;
      }
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

  const bare = $derived(route.name === "pair" || route.name === "welcome" || route.name === "read");
  const fullBleed = $derived(route.name === "chat");

  // The Lantern shell (a slim rail, a living backdrop, a bottom dock on the phone), worn by Lantern
  // and the four rooms.
  const lantern = $derived(app.shell === "lantern");
  const showRail = $derived(railShown(route.name === "chat"));
  $effect(() => {
    if (route.name !== "chat") setFocus(false);
  });
  // Lantern display choices for this device: chat box width, portraits, room inside each box.
  $effect(() => {
    const root = document.documentElement.style;
    const w = device.chatWidth;
    if (w >= 100) root.setProperty("--chat-w", "100%");
    else if (w > 0) root.setProperty("--chat-w", `${w}rem`);
    else root.removeProperty("--chat-w");
    root.setProperty("--portrait-w", `${{ small: 56, large: 76, grand: 104 }[device.portrait] ?? 76}px`);
    const pad = { snug: ["0.75rem", "1rem"], cozy: ["1.1rem", "1.45rem"], airy: ["1.6rem", "2.1rem"] }[device.boxPadding] ?? ["1.1rem", "1.45rem"];
    root.setProperty("--pad-y", pad[0]!);
    root.setProperty("--pad-x", pad[1]!);
  });
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
{:else if vaultLocked}
  <Unlock />
{:else if bare}
  {#if route.name === "pair"}<Pair />
  {:else if route.name === "read"}
    {#await import("./views/ReadView.svelte") then v}<v.default id={route.params.id!} />{/await}
  {:else}<Welcome />{/if}
{:else}
  {#if app.theme === "lantern"}<Sky />{:else if isRoom(app.theme)}<Ambience theme={app.theme} />{/if}
  <div class="shell" class:full={fullBleed} class:lantern class:no-rail={lantern && !showRail} class:focus={lantern && layout.focus} class:with-bottom={lantern && app.isMobile && !fullBleed}>
    {#if !app.isMobile}
      {#if lantern}
        <aside class="rail-wrap"><Rail /></aside>
      {:else}
        <aside class="side"><Sidebar /></aside>
      {/if}
    {/if}
    <main class="main">
      {#if app.isMobile && !fullBleed && !lantern}
        <header class="mtop">
          <button class="btn ghost icon" onclick={() => (app.drawerOpen = true)} aria-label="Open menu"><Menu size={20} /></button>
          <a href="/" class="brand">Mea<span>✿</span></a>
          <span style="width:2.5rem"></span>
        </header>
      {/if}
      {#if app.offlineCopy}
        <div class="offline tiny" role="status"><WifiOff size={13} /> Offline: reading saved copies{outbox.items.length ? ` · ${outbox.items.length} waiting to send` : ""}</div>
      {:else if !app.connected && app.authorized}
        <div class="offline tiny" role="status"><WifiOff size={13} /> Reconnecting to Mea…</div>
      {/if}
      {#key route.name + (route.params.id ?? "")}
        {#if route.name === "home"}<Home />
        {:else if route.name === "chat"}<ChatView id={route.params.id!} />
        {:else if views[route.name]}
          {#await views[route.name]!() then view}
            <view.default id={route.params.id} selectedId={route.params.id} tab={route.params.tab} />
          {:catch}
            <div class="boot"><div class="stack" style="text-align:center"><h2>Couldn't load this screen</h2><p class="muted small">Mea may have been updated. Reload the page.</p><button class="btn" onclick={() => location.reload()}>Reload</button></div></div>
          {/await}
        {:else}
          <div class="boot"><div class="stack" style="text-align:center"><h2>Lost in the stacks</h2><a href="/">Back home</a></div></div>
        {/if}
      {/key}
    </main>
  </div>
  {#if lantern && !app.isMobile && !showRail && !layout.focus}
    <button class="reveal" onclick={() => toggleRail(route.name === "chat")} aria-label="Show navigation" title="Show navigation">✿</button>
  {/if}
  {#if lantern && app.isMobile && !fullBleed}<BottomNav />{/if}
  {#if app.isMobile || lantern}
    <Modal bind:open={app.drawerOpen} side="left">
      <Sidebar />
    </Modal>
  {/if}
{/if}

<Toasts />
<Dialogs />
{#if ready && !unreachable && !vaultLocked && !bare && app.authorized && !lock.locked}<CommandPalette />{/if}
{#if lock.locked}<AppLock />{/if}

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

  /* ---------- Lantern shell ---------- */
  .shell.lantern {
    display: flex;
    gap: 14px;
    padding: 14px;
    position: relative;
    z-index: 1;
    transition:
      padding 0.6s var(--ease),
      gap 0.6s var(--ease);
  }
  .shell.lantern .main {
    flex: 1;
    min-width: 0;
  }
  .shell.lantern.full .main {
    height: calc(100dvh - 28px);
  }
  .rail-wrap {
    flex: none;
    position: sticky;
    top: 14px;
    height: calc(100dvh - 28px);
    z-index: 20;
    transition:
      margin 0.55s var(--ease),
      opacity 0.45s var(--ease),
      transform 0.55s var(--ease);
  }
  .shell.no-rail {
    padding-left: 30px;
  }
  .shell.no-rail .rail-wrap {
    margin-left: -104px;
    opacity: 0;
    transform: translateX(-20px);
    pointer-events: none;
  }
  .shell.focus {
    padding: 0;
    gap: 0;
  }
  .shell.focus.full .main {
    height: 100dvh;
  }
  .reveal {
    position: fixed;
    top: 50%;
    left: 0;
    translate: 0 -50%;
    z-index: 30;
    width: 22px;
    height: 76px;
    border: 0;
    border-radius: 0 14px 14px 0;
    display: grid;
    place-items: center;
    background: var(--reveal-bg, rgb(36 26 60 / 80%));
    box-shadow:
      inset -1px 0 0 color-mix(in srgb, var(--hi) 10%, transparent),
      0 10px 30px color-mix(in srgb, var(--lo) 40%, transparent);
    color: var(--lamp);
    font-size: 12px;
    cursor: pointer;
    backdrop-filter: blur(16px);
    animation: reveal-in 0.5s var(--spring);
    transition: width 0.3s var(--spring);
  }
  .reveal:hover {
    width: 30px;
    text-shadow: 0 0 10px var(--lamp);
  }
  @keyframes reveal-in {
    from {
      translate: -24px -50%;
      opacity: 0;
    }
  }
  @media (max-width: 760px) {
    .shell.lantern {
      padding: 0;
      gap: 0;
    }
    .shell.lantern.full .main {
      height: 100dvh;
    }
    .shell.with-bottom .main {
      padding-bottom: calc(84px + var(--safe-bottom));
    }
  }
</style>
