<script lang="ts">
  import { fly } from "svelte/transition";
  import { flip } from "svelte/animate";
  import { app, dismissToast } from "../lib/state.svelte";
  import { Check, CircleAlert, X } from "../lib/icons";
</script>

<div class="toasts" aria-live="polite">
  {#each app.toasts as t (t.id)}
    <div class="toast {t.kind}" in:fly={{ y: 16, duration: 220 }} out:fly={{ y: 8, duration: 160 }} animate:flip={{ duration: 200 }}>
      {#if t.kind === "ok"}<Check size={16} />{:else if t.kind === "error"}<CircleAlert size={16} />{/if}
      <span class="msg">{t.message}</span>
      {#if t.action}
        <button
          class="act"
          onclick={() => {
            t.action?.run();
            dismissToast(t.id);
          }}>{t.action.label}</button
        >
      {/if}
      <button class="close" onclick={() => dismissToast(t.id)} aria-label="Dismiss"><X size={14} /></button>
    </div>
  {/each}
</div>

<style>
  .toasts {
    position: fixed;
    left: 50%;
    bottom: calc(1.25rem + var(--safe-bottom));
    translate: -50% 0;
    display: grid;
    gap: 0.5rem;
    z-index: 120;
    width: min(92vw, 26rem);
    pointer-events: none;
  }
  @media (max-width: 760px) {
    .toasts {
      bottom: calc(6.5rem + var(--safe-bottom));
    }
  }
  .toast {
    pointer-events: auto;
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.65rem 0.75rem 0.65rem 1rem;
    border-radius: var(--r);
    background: var(--text);
    color: var(--bg);
    box-shadow: var(--shadow-2);
    font-size: var(--fs-sm);
    font-weight: 600;
  }
  .toast.error {
    background: var(--danger);
    color: #fff;
  }
  :global([data-theme="dark"]) .toast.error {
    color: #2a1f2c;
  }
  .msg {
    flex: 1;
  }
  .act {
    background: none;
    border: 0;
    color: inherit;
    font: inherit;
    font-weight: 800;
    text-decoration: underline;
    cursor: pointer;
    padding: 0.2rem 0.3rem;
  }
  .close {
    background: none;
    border: 0;
    color: inherit;
    opacity: 0.7;
    cursor: pointer;
    display: grid;
    place-items: center;
    padding: 0.2rem;
  }
</style>
