<script lang="ts">
  import { post } from "../../lib/api";
  import { errorToast, toast } from "../../lib/state.svelte";
  import { refreshTrackers, trk } from "../../lib/trackers.svelte";

  /**
   * docs/31 1.1: "Willow wasn't there" on a knowledge chip. It takes that one person off the tracker's
   * line, so everyone who was there keeps what they learned.
   */
  let { change: c }: { change: { kind: string; subject?: string; source?: string; lineId?: string } } = $props();
  let busy = $state(false);
  const short = (name: string) => name.split(/\s+/)[0]!;
  const shown = $derived(c.kind === "knowledge" && Boolean(c.lineId && c.subject) && (c.source === "model" || c.source === "inline"));

  async function go() {
    const chatId = trk.chatId;
    if (!chatId || !c.lineId || !c.subject || busy) return;
    busy = true;
    try {
      await post(`/api/chats/${chatId}/trackers/events/${c.lineId}/not-there`, { who: c.subject });
      toast(`${c.subject} didn't hear it; the others still did`, { kind: "ok" });
      refreshTrackers(chatId);
    } catch (e) {
      errorToast(e);
    } finally {
      busy = false;
    }
  }
</script>

{#if shown}
  <button class="nt" disabled={busy} onclick={go} title="Take {c.subject} off this line: they weren't in the scene">{short(c.subject!)} wasn't there</button>
{/if}

<style>
  .nt {
    margin-left: 0.4em;
    padding: 0;
    border: 0;
    background: none;
    font: inherit;
    font-size: 0.82em;
    color: var(--text-faint);
    cursor: pointer;
    text-decoration: underline;
    text-decoration-color: color-mix(in srgb, var(--text-faint) 40%, transparent);
    text-underline-offset: 2px;
    white-space: nowrap;
  }
  .nt:hover,
  .nt:focus-visible {
    color: var(--accent);
  }
  .nt:disabled {
    opacity: 0.5;
    cursor: default;
  }
</style>
