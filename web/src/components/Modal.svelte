<script lang="ts">
  import type { Snippet } from "svelte";
  import { fade, fly } from "svelte/transition";
  import { X } from "../lib/icons";
  import { portal } from "../lib/gestures";
  import { app } from "../lib/state.svelte";

  let {
    open = $bindable(false),
    title = "",
    size = "md",
    side = "center",
    onclose,
    children,
    footer,
    actions,
  }: {
    open?: boolean;
    title?: string;
    size?: "sm" | "md" | "lg" | "xl";
    side?: "center" | "left" | "right" | "bottom";
    onclose?: () => void;
    children?: Snippet;
    footer?: Snippet;
    actions?: Snippet;
  } = $props();

  const mode = $derived(side === "center" && app.isMobile ? "bottom" : side);
  let panel = $state<HTMLDivElement | null>(null);
  let dragY = $state(0);
  let startY = -1;

  function close() {
    open = false;
    onclose?.();
  }

  const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

  function onkey(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.stopPropagation();
      close();
    } else if (e.key === "Tab" && panel) {
      // M41: Tab cycles inside the dialog.
      const f = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.getClientRects().length);
      const first = f[0];
      const last = f.at(-1);
      if (!first || !last) return void e.preventDefault();
      if (e.shiftKey && (document.activeElement === first || document.activeElement === panel)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  $effect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // M41: the rest of the app is inert while the dialog is open, and focus goes back where it was after.
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const muted: HTMLElement[] = [];
    queueMicrotask(() => {
      const own = panel?.closest<HTMLElement>(".portal");
      for (const el of document.body.children) {
        if (!(el instanceof HTMLElement) || el === own || el.inert || el.hasAttribute("data-live-layer") || el.tagName === "SCRIPT") continue;
        el.inert = true;
        muted.push(el);
      }
      const target = panel?.querySelector<HTMLElement>("[autofocus], input:not([type=hidden]), textarea, select") ?? panel;
      target?.focus({ preventScroll: true });
    });
    return () => {
      document.body.style.overflow = prev;
      for (const el of muted) el.inert = false;
      if (opener?.isConnected && !opener.closest("[inert]")) opener.focus({ preventScroll: true });
    };
  });

  const flyParams = $derived(
    mode === "bottom" ? { y: 400, duration: 260 } : mode === "left" ? { x: -360, duration: 240 } : mode === "right" ? { x: 360, duration: 240 } : { y: 14, duration: 200 },
  );

  // Drag the sheet down to dismiss (MOB-04).
  function dragStart(e: TouchEvent) {
    if (mode !== "bottom") return;
    startY = e.touches[0]!.clientY;
  }
  function dragMove(e: TouchEvent) {
    if (startY < 0) return;
    dragY = Math.max(0, e.touches[0]!.clientY - startY);
  }
  function dragEnd() {
    if (startY < 0) return;
    if (dragY > 110) close();
    dragY = 0;
    startY = -1;
  }
</script>

{#if open}
  <div class="portal" use:portal>
  <div class="scrim" transition:fade={{ duration: 180 }} onclick={close} role="presentation"></div>
  <div
    bind:this={panel}
    class="modal {mode} {size}"
    role="dialog"
    aria-modal="true"
    aria-label={title || "Dialog"}
    tabindex="-1"
    onkeydown={onkey}
    transition:fly={flyParams}
    style:transform={dragY ? `translateY(${dragY}px)` : undefined}
  >
    {#if mode === "bottom"}
      <div class="handle" ontouchstart={dragStart} ontouchmove={dragMove} ontouchend={dragEnd} role="presentation"><span></span></div>
    {/if}
    {#if title || actions}
      <header role="presentation" ontouchstart={dragStart} ontouchmove={dragMove} ontouchend={dragEnd}>
        <h2 class="title">{title}</h2>
        <div class="row">
          {@render actions?.()}
          <button class="btn ghost icon small" onclick={close} aria-label="Close"><X size={18} /></button>
        </div>
      </header>
    {/if}
    <div class="body">
      {@render children?.()}
    </div>
    {#if footer}
      <footer>{@render footer()}</footer>
    {/if}
  </div>
  </div>
{/if}

<style>
  .scrim {
    position: fixed;
    inset: 0;
    background: var(--scrim);
    z-index: 80;
    backdrop-filter: blur(2px);
  }
  .modal {
    position: fixed;
    z-index: 81;
    background: var(--surface);
    color: var(--text);
    display: flex;
    flex-direction: column;
    box-shadow: var(--shadow-2);
    outline: none;
    max-height: calc(100dvh - 2rem);
  }
  .modal.center {
    left: 50%;
    top: 8vh;
    translate: -50% 0;
    width: min(92vw, 34rem);
    border-radius: var(--r-lg);
    border: 1px solid var(--border);
    max-height: 84vh;
  }
  .modal.center.sm {
    width: min(92vw, 26rem);
  }
  .modal.center.lg {
    width: min(94vw, 48rem);
  }
  .modal.center.xl {
    width: min(96vw, 64rem);
    top: 4vh;
    max-height: 92vh;
  }
  .modal.bottom {
    left: 0;
    right: 0;
    bottom: 0;
    border-radius: var(--r-lg) var(--r-lg) 0 0;
    max-height: 90dvh;
    padding-bottom: var(--safe-bottom);
    transition: transform 0.12s;
  }
  .modal.left,
  .modal.right {
    top: 0;
    bottom: 0;
    width: min(88vw, 22rem);
    max-height: none;
  }
  .modal.left {
    left: 0;
    border-radius: 0 var(--r-lg) var(--r-lg) 0;
  }
  .modal.right {
    right: 0;
    border-radius: var(--r-lg) 0 0 var(--r-lg);
  }
  .handle {
    display: flex;
    justify-content: center;
    padding: 0.55rem 0 0.15rem;
  }
  .handle span {
    width: 2.6rem;
    height: 0.3rem;
    border-radius: var(--r-pill);
    background: var(--border-strong);
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0.9rem 1rem 0.5rem 1.25rem;
  }
  .title {
    font-size: var(--fs-lg);
  }
  .body {
    padding: 0.5rem 1.25rem 1.25rem;
    overflow-y: auto;
    overscroll-behavior: contain;
    flex: 1;
  }
  footer {
    display: flex;
    justify-content: flex-end;
    flex-wrap: wrap;
    gap: 0.5rem;
    padding: 0.85rem 1.25rem 1rem;
    border-top: 1px solid var(--border);
  }
</style>
