<script lang="ts">
  import { get, post } from "../../lib/api";
  import { onEvent } from "../../lib/events";
  import { Music, Pause, SkipForward, ThumbsDown, ThumbsUp, X } from "../../lib/icons";
  import { errorToast } from "../../lib/state.svelte";

  /**
   * J3: the now-playing chip in the chat header (YouTube Music): what the scene is playing, with
   * play/pause, skip, 👍 / 👎 (it learns for this story) and Not for this scene. Only shown once
   * the soundtrack is connected in Settings › Music.
   */
  interface View {
    available: boolean;
    on: boolean;
    now: { videoId: string; title: string; artist: string; why: string } | null;
    vote: number;
  }
  let { chatId }: { chatId: string } = $props();
  let v = $state<View | null>(null);
  let open = $state(false);

  async function load() {
    try {
      v = await get<View>(`/api/chats/${chatId}/music`);
    } catch {
      v = null;
    }
  }
  $effect(() => {
    void chatId;
    void load();
  });
  let t: ReturnType<typeof setTimeout>;
  $effect(() =>
    onEvent((e) => {
      if ((e.type === "trackers.changed" || e.type === "chat.changed") && e.chatId === chatId) {
        clearTimeout(t);
        t = setTimeout(load, 1500);
      }
    }),
  );
  async function act(action: string) {
    try {
      v = await post<View>(`/api/chats/${chatId}/music`, { action });
    } catch (e) {
      errorToast(e);
    }
  }
</script>

{#if v?.available}
  {#if !v.on}
    <button class="btn ghost icon" onclick={() => act("on")} aria-label="Turn the soundtrack on" title="Soundtrack (YouTube Music): off"><Music size={17} /></button>
  {:else}
    <span class="np">
      <button class="chip np-chip" onclick={() => (open = !open)} aria-expanded={open} title={v.now ? `${v.now.title}${v.now.artist ? ` · ${v.now.artist}` : ""} — ${v.now.why}` : "Waiting for the next beat"}>
        <Music size={13} /><span class="t">{v.now?.title ?? "Soundtrack on"}</span>
      </button>
      {#if open}
        <span class="ctl card" role="group" aria-label="Soundtrack">
          <button class="btn ghost icon small" onclick={() => act("playPause")} aria-label="Play or pause"><Pause size={14} /></button>
          <button class="btn ghost icon small" onclick={() => act("skip")} aria-label="Skip"><SkipForward size={14} /></button>
          <button class="btn ghost icon small" class:on={v.vote > 0} onclick={() => act("up")} aria-label="More like this" disabled={!v.now}><ThumbsUp size={14} /></button>
          <button class="btn ghost icon small" class:on={v.vote < 0} onclick={() => act("down")} aria-label="Less like this" disabled={!v.now}><ThumbsDown size={14} /></button>
          <button class="btn ghost small" onclick={() => act("notForScene")} disabled={!v.now}>Not for this scene</button>
          <button class="btn ghost icon small" onclick={() => ((open = false), act("off"))} aria-label="Turn the soundtrack off" title="Off for this chat"><X size={14} /></button>
        </span>
      {/if}
    </span>
  {/if}
{/if}

<style>
  .np {
    position: relative;
    display: inline-flex;
  }
  .np-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    max-width: 11rem;
    cursor: pointer;
  }
  .t {
    overflow-wrap: anywhere;
  }
  .ctl {
    position: absolute;
    top: calc(100% + 6px);
    right: 0;
    z-index: 30;
    display: flex;
    align-items: center;
    gap: 0.2rem;
    padding: 0.3rem;
    white-space: nowrap;
  }
</style>
