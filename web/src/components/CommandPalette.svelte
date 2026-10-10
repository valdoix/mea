<script lang="ts">
  import { THEMES, isRoom, themeInfo } from "../lib/themes";
  import { fade, fly } from "svelte/transition";
  import type { Component } from "svelte";
  import { get, post } from "../lib/api";
  import { device, setDevice } from "../lib/device.svelte";
  import { BookOpen, Eye, House, Inbox, MessageHeart, Moon, NotebookPen, Plus, Search, Settings, SlidersHorizontal, Trash, UserPen, Users, WandSparkles } from "../lib/icons";
  import { navigate, route } from "../lib/router.svelte";
  import { palette } from "../lib/palette.svelte";
  import { app, errorToast, saveSetting } from "../lib/state.svelte";

  /** UI-12: Ctrl/Cmd+K jumps to any chat, character, screen, setting or action. */
  let q = $state("");
  let at = $state(0);
  let field = $state<HTMLInputElement | null>(null);

  interface Item {
    id: string;
    label: string;
    hint?: string;
    group: "Chats" | "Characters" | "Go to" | "Settings" | "Actions";
    icon: Component<any>;
    run: () => void | Promise<void>;
    keywords?: string;
  }
  let chats = $state<Item[]>([]);
  let characters = $state<Item[]>([]);

  async function load() {
    try {
      const [c, ch] = await Promise.all([
        get<{ chats: { id: string; title: string; characterName: string | null }[] }>("/api/chats?limit=200"),
        get<{ characters: { id: string; name: string; tags: string[] }[] }>("/api/characters?sort=recent"),
      ]);
      chats = c.chats.map((x) => ({ id: `chat:${x.id}`, label: x.title, hint: x.characterName ?? "", group: "Chats", icon: MessageHeart, run: () => navigate(`/chat/${x.id}`) }));
      characters = ch.characters.map((x) => ({
        id: `char:${x.id}`,
        label: x.name,
        hint: "character",
        group: "Characters",
        icon: UserPen,
        keywords: x.tags.join(" "),
        run: async () => {
          try {
            const r = await post<{ id: string }>("/api/chats", { characterId: x.id });
            navigate(`/chat/${r.id}`);
          } catch (e) {
            errorToast(e);
          }
        },
      }));
    } catch {
      // the static items still work
    }
  }

  const screens: Item[] = [
    { id: "go:home", label: "Home", group: "Go to", icon: House, run: () => navigate("/") },
    { id: "go:personas", label: "Personas", group: "Go to", icon: Users, run: () => navigate("/personas") },
    { id: "go:studio", label: "Studio", hint: "create characters and lorebooks", group: "Go to", icon: WandSparkles, run: () => navigate("/creator") },
    { id: "go:lore", label: "Lorebooks", group: "Go to", icon: BookOpen, run: () => navigate("/lorebooks") },
    { id: "go:presets", label: "Presets", group: "Go to", icon: SlidersHorizontal, run: () => navigate("/presets") },
    { id: "go:notebook", label: "Notebook", hint: "notes and best moments", group: "Go to", icon: NotebookPen, run: () => navigate("/notebook") },
    { id: "go:inbox", label: "Review inbox", group: "Go to", icon: Inbox, run: () => navigate("/inbox") },
    { id: "go:search", label: "Search all stories", group: "Go to", icon: Search, run: () => navigate("/search") },
    { id: "go:trash", label: "Trash", group: "Go to", icon: Trash, run: () => navigate("/trash") },
  ];
  const settingsTabs: [string, string, string?][] = [
    ["models", "Models", "connections api key"],
    ["memory", "Memory", "summaries compression"],
    ["trackers", "Trackers"],
    ["guards", "Guards", "pov puppeting names drift"],
    ["writing", "Writing", "advisor editor recap"],
    ["prompts", "Helper prompts"],
    ["regex", "Regex"],
    ["appearance", "Appearance", "font typography theme lock spell"],
    ["devices", "Devices", "pair phone"],
    ["notifications", "Notifications", "push"],
    ["data", "Backups & data", "export import"],
    ["storage", "Storage & privacy", "vacuum encryption log"],
    ["usage", "Usage", "cost tokens"],
    ["status", "Status", "jobs"],
  ];
  const settingItems: Item[] = settingsTabs.map(([tab, label, kw]) => ({ id: `set:${tab}`, label: `Settings: ${label}`, group: "Settings", icon: Settings, keywords: kw, run: () => navigate(`/settings/${tab}`) }));
  const actions = $derived<Item[]>([
    { id: "act:new", label: "New character", group: "Actions", icon: Plus, run: () => navigate("/creator") },
    ...(isRoom(app.theme)
      ? [{ id: "act:mode", label: `${app.night ? themeInfo(app.theme)?.day : themeInfo(app.theme)?.night} (${app.night ? "day" : "night"})`, group: "Actions" as const, icon: Moon, keywords: "night day dark light mode", run: () => saveSetting("appearance.themeMode", app.night ? "day" : "night") }]
      : []),
    ...THEMES.filter((t) => t.id !== app.theme).map((t) => ({ id: `act:theme:${t.id}`, label: `${t.name} theme`, hint: t.motto, group: "Actions" as const, icon: Moon, keywords: "theme look colours", run: () => saveSetting("appearance.theme", t.id) })),
    ...(app.shell === "lantern" ? [{ id: "act:theme:cozy", label: "Mea Cozy theme", group: "Actions" as const, icon: Moon, keywords: "theme light cozy", run: () => saveSetting("appearance.theme", "light") }] : []),
    { id: "act:discreet", label: device.discreet ? "Leave discreet mode" : "Discreet mode", group: "Actions", icon: Eye, keywords: "privacy blur", run: () => setDevice("discreet", !device.discreet) },
    ...(route.name === "chat" && route.params.id
      ? [
          { id: "act:read", label: "Read this story", hint: "reading mode", group: "Actions" as const, icon: BookOpen, run: () => navigate(`/chat/${route.params.id}/read`) },
          { id: "act:memory", label: "This chat's memory", group: "Actions" as const, icon: NotebookPen, run: () => navigate(`/chat/${route.params.id}/memory`) },
        ]
      : []),
  ]);

  /** Every word you type must appear somewhere; earlier and whole-word hits rank higher. */
  function score(i: Item, words: string[]) {
    const hay = `${i.label} ${i.hint ?? ""} ${i.keywords ?? ""}`.toLowerCase();
    let s = 0;
    for (const w of words) {
      const k = hay.indexOf(w);
      if (k < 0) return -1;
      s += k === 0 ? 30 : /\s/.test(hay[k - 1] ?? "") ? 15 : 5;
    }
    return s;
  }
  const results = $derived.by(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const all = [...actions, ...chats, ...characters, ...screens, ...settingItems];
    if (!words.length) return [...actions, ...chats.slice(0, 5), ...screens].slice(0, 14);
    return all
      .map((i) => ({ i, s: score(i, words) }))
      .filter((x) => x.s >= 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 14)
      .map((x) => x.i);
  });
  $effect(() => {
    void q;
    at = 0;
  });

  function show() {
    palette.open = true;
  }
  function choose(i: Item | undefined) {
    if (!i) return;
    palette.open = false;
    void i.run();
  }

  function onkey(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      if (palette.open) palette.open = false;
      else show();
      return;
    }
    if (!palette.open) return;
    if (e.key === "Escape") {
      e.preventDefault();
      palette.open = false;
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      at = Math.min(results.length - 1, at + 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      at = Math.max(0, at - 1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(results[at]);
    }
  }
  // Opened from elsewhere (the sidebar's search button): load and focus.
  let wasOpen = false;
  $effect(() => {
    if (palette.open && !wasOpen) {
      q = "";
      void load();
      requestAnimationFrame(() => field?.focus());
    }
    wasOpen = palette.open;
  });
</script>

<svelte:window onkeydown={onkey} />

{#if palette.open}
  <button class="scrim" transition:fade={{ duration: 120 }} onclick={() => (palette.open = false)} aria-label="Close"></button>
  <div class="pal card" role="dialog" aria-modal="true" aria-label="Command palette" transition:fly={{ y: -8, duration: 160 }}>
    <label class="search">
      <Search size={17} />
      <input bind:this={field} bind:value={q} placeholder="Jump to a chat, character, screen or setting…" aria-label="Search commands" role="combobox" aria-expanded="true" aria-controls="cmdk-list" aria-activedescendant={results[at] ? `cmdk-${at}` : undefined} />
      <kbd>Esc</kbd>
    </label>
    <div class="list" id="cmdk-list" role="listbox">
      {#each results as r, i (r.id)}
        {#if i === 0 || results[i - 1]!.group !== r.group}<div class="grp tiny faint">{r.group}</div>{/if}
        <button id="cmdk-{i}" class="item" class:on={i === at} role="option" aria-selected={i === at} onmousemove={() => (at = i)} onclick={() => choose(r)}>
          <r.icon size={16} />
          <span class="grow truncate">{r.label}</span>
          {#if r.hint}<span class="tiny muted truncate hint">{r.hint}</span>{/if}
        </button>
      {:else}
        <p class="tiny muted empty">Nothing matches “{q}”.</p>
      {/each}
    </div>
  </div>
{/if}

<style>
  .scrim {
    position: fixed;
    inset: 0;
    z-index: 90;
    border: 0;
    background: rgb(30 22 30 / 30%);
  }
  .pal {
    position: fixed;
    z-index: 91;
    top: min(14vh, 7rem);
    left: 50%;
    translate: -50% 0;
    width: min(92vw, 34rem);
    padding: 0;
    overflow: hidden;
    box-shadow: 0 20px 60px rgb(0 0 0 / 22%);
  }
  .search {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    padding: 0.75rem 0.9rem;
    border-bottom: 1px solid var(--border);
    color: var(--text-muted);
  }
  .search input {
    flex: 1;
    border: 0;
    background: none;
    font: inherit;
    font-size: var(--fs-md);
    color: var(--text);
    outline: none;
  }
  kbd {
    font: 600 0.7rem var(--font-mono);
    border: 1px solid var(--border);
    border-radius: 5px;
    padding: 0.1rem 0.35rem;
  }
  .list {
    max-height: min(60vh, 26rem);
    overflow-y: auto;
    padding: 0.35rem;
  }
  .grp {
    padding: 0.45rem 0.6rem 0.2rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .item {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    width: 100%;
    border: 0;
    background: none;
    color: inherit;
    font: inherit;
    text-align: left;
    padding: 0.5rem 0.6rem;
    border-radius: var(--r-sm);
    cursor: pointer;
  }
  .item.on {
    background: color-mix(in srgb, var(--accent) 16%, transparent);
  }
  .hint {
    max-width: 40%;
  }
  .empty {
    padding: 0.8rem;
  }
</style>
