<script lang="ts" module>
  import type { Component } from "svelte";
  export interface MenuItem {
    label: string;
    icon?: Component<any>;
    onclick: () => void;
    danger?: boolean;
    disabled?: boolean;
    hint?: string;
  }
</script>

<script lang="ts">
  import { fade, scale } from "svelte/transition";
  import { portal } from "../lib/gestures";
  import { app } from "../lib/state.svelte";
  import Modal from "./Modal.svelte";

  let {
    open = $bindable(false),
    items,
    anchor = null,
    point = null,
    title = "",
  }: { open?: boolean; items: MenuItem[]; anchor?: HTMLElement | null; point?: { x: number; y: number } | null; title?: string } = $props();

  let pos = $state({ top: 0, left: 0 });
  let menu = $state<HTMLDivElement | null>(null);

  $effect(() => {
    if (!open || app.isMobile) return;
    const r = anchor?.getBoundingClientRect();
    const x = point?.x ?? (r ? r.right : 0);
    const y = point?.y ?? (r ? r.bottom + 4 : 0);
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const itemsEl = () => [...(menu?.querySelectorAll<HTMLButtonElement>("button.item:not(:disabled)") ?? [])];
    queueMicrotask(() => {
      const w = menu?.offsetWidth ?? 220;
      const h = menu?.offsetHeight ?? 200;
      pos = { left: Math.max(8, Math.min(x - (point ? 0 : w), innerWidth - w - 8)), top: Math.min(y, innerHeight - h - 8) };
      // M41: the menu takes focus as it opens, so arrow keys work right away.
      itemsEl()[0]?.focus({ preventScroll: true });
    });
    const onDown = (e: PointerEvent) => {
      if (menu && !menu.contains(e.target as Node) && !anchor?.contains(e.target as Node)) open = false;
    };
    let byKey = false;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        byKey = true;
        open = false;
        return;
      }
      if (e.key === "Tab") return void (open = false);
      const list = itemsEl();
      if (!list.length || !["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
      e.preventDefault();
      const i = list.indexOf(document.activeElement as HTMLButtonElement);
      const next = e.key === "Home" ? 0 : e.key === "End" ? list.length - 1 : e.key === "ArrowDown" ? (i + 1) % list.length : (i - 1 + list.length) % list.length;
      list[next]!.focus();
    };
    setTimeout(() => window.addEventListener("pointerdown", onDown), 0);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
      // Closed from the keyboard, focus goes back to the button that opened it.
      if (byKey && opener?.isConnected) opener.focus({ preventScroll: true });
    };
  });

  function pick(item: MenuItem) {
    if (item.disabled) return;
    open = false;
    item.onclick();
  }
</script>

{#if app.isMobile}
  <Modal bind:open side="bottom" {title}>
    <div class="sheet-items">
      {#each items as item (item.label)}
        <button class="item" class:danger={item.danger} disabled={item.disabled} onclick={() => pick(item)}>
          {#if item.icon}<item.icon size={20} />{/if}
          <span class="grow">{item.label}</span>
          {#if item.hint}<span class="faint tiny">{item.hint}</span>{/if}
        </button>
      {/each}
    </div>
  </Modal>
{:else if open}
  <div class="menu card" use:portal bind:this={menu} aria-label={title || undefined} style:top="{pos.top}px" style:left="{pos.left}px" role="menu" in:scale={{ start: 0.96, duration: 140 }} out:fade={{ duration: 100 }}>
    {#each items as item (item.label)}
      <button class="item" class:danger={item.danger} disabled={item.disabled} onclick={() => pick(item)} role="menuitem" tabindex="-1">
        {#if item.icon}<item.icon size={16} />{/if}
        <span class="grow">{item.label}</span>
        {#if item.hint}<kbd>{item.hint}</kbd>{/if}
      </button>
    {/each}
  </div>
{/if}

<style>
  .menu {
    position: fixed;
    z-index: 90;
    min-width: 13rem;
    padding: 0.35rem;
    display: grid;
    box-shadow: var(--shadow-2);
    transform-origin: top right;
  }
  .item {
    display: flex;
    align-items: center;
    gap: 0.65rem;
    width: 100%;
    padding: 0.55rem 0.7rem;
    border: 0;
    background: none;
    color: var(--text);
    font: 600 var(--fs-sm) / 1.2 var(--font-ui);
    border-radius: var(--r-sm);
    cursor: pointer;
    text-align: left;
  }
  .item:hover:not(:disabled) {
    background: var(--surface-2);
  }
  .item:disabled {
    opacity: 0.45;
    cursor: default;
  }
  .item.danger {
    color: var(--danger);
  }
  .sheet-items {
    display: grid;
    gap: 0.15rem;
  }
  .sheet-items .item {
    padding: 0.85rem 0.6rem;
    font-size: var(--fs-md);
  }
</style>
