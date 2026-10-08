<script lang="ts">
  import { post } from "../../lib/api";
  import { Loader, WandSparkles } from "../../lib/icons";
  import { errorToast } from "../../lib/state.svelte";

  /** "Extend my answer" (CHAR-10): pushes your draft further, keeping your words. */
  let { text, question = "", idea = "", onresult }: { text: string; question?: string; idea?: string; onresult: (text: string) => void } = $props();
  let working = $state(false);

  async function extend() {
    working = true;
    try {
      onresult((await post<{ text: string }>("/api/creator/extend", { text, question, idea: idea.slice(0, 20_000) })).text);
    } catch (e) {
      errorToast(e);
    } finally {
      working = false;
    }
  }
</script>

<button class="btn ghost small" onclick={extend} disabled={working || !text.trim()} title="Keep my words and push them further">
  {#if working}<span class="spin"><Loader size={13} /></span> Extending…{:else}<WandSparkles size={13} /> Extend my answer{/if}
</button>

<style>
  .spin {
    display: inline-grid;
    animation: spin 1s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
