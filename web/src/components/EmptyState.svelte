<script lang="ts">
  import type { Snippet } from "svelte";

  let { title, text = "", icon = "✿", children }: { title: string; text?: string; icon?: string; children?: Snippet } = $props();
</script>

<div class="empty">
  <div class="blob" aria-hidden="true">{icon}</div>
  <h2>{title}</h2>
  {#if text}<p class="muted">{text}</p>{/if}
  {#if children}<div class="row wrap actions">{@render children()}</div>{/if}
</div>

<style>
  .empty {
    display: grid;
    justify-items: center;
    text-align: center;
    gap: 0.6rem;
    padding: 3rem 1.5rem;
    max-width: 30rem;
    margin: 0 auto;
  }
  .blob {
    width: 5rem;
    height: 5rem;
    display: grid;
    place-items: center;
    font-size: 2rem;
    color: var(--accent-ink);
    background: radial-gradient(circle at 30% 30%, var(--peach), transparent 60%), radial-gradient(circle at 70% 60%, var(--lavender), transparent 60%), var(--surface-2);
    border-radius: 42% 58% 55% 45% / 50% 45% 55% 50%;
    margin-bottom: 0.4rem;
    animation: wobble 8s ease-in-out infinite;
  }
  @keyframes wobble {
    50% {
      border-radius: 55% 45% 42% 58% / 45% 55% 45% 55%;
    }
  }
  .actions {
    justify-content: center;
    margin-top: 0.6rem;
  }
</style>
