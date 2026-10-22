<script lang="ts">
  import { get, post } from "../../lib/api";
  import { onEvent } from "../../lib/events";
  import { Music, Pause, SkipForward, ThumbsDown, ThumbsUp, X } from "../../lib/icons";
  import { errorToast } from "../../lib/state.svelte";

  /**
   * J3: the now-playing chip in the chat header (YouTube Music): what the scene is playing, with
   * play/pause, skip, 👍 / 👎 (it learns for this story) and Not for this scene. Only shown once
   * the soundtrack is connected in Settings › Music. A song picked for its words shows the line
   * being sung while its passage plays (docs/18, 4.3); Words hides it.
   */
  interface View {
    available: boolean;
    on: boolean;
    /** words: the song was picked for its words (docs/18, Part 3). */
    now: { videoId: string; title: string; artist: string; why: string; words?: { passage: number; situations: string[] } } | null;
    vote: number;
    /** docs/18, 2.3: what was happening at the last beat. */
    moment: { situations: string[]; gist: string } | null;
  }
  let { chatId }: { chatId: string } = $props();
  let v = $state<View | null>(null);
  let open = $state(false);
  // The card hangs left from the chip; on a narrow screen it's moved back right to stay on screen.
  let card = $state<HTMLElement | null>(null);
  $effect(() => {
    void v;
    if (!open || !card) return;
    const el = card;
    el.style.translate = "";
    const left = el.getBoundingClientRect().left;
    if (left < 8) el.style.translate = `${8 - left}px 0`;
  });

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
  // The line being sung, looked up every second while the card is open on a song picked for its words.
  const WORDS_KEY = "mea.music.showWords";
  let showWords = $state(readShowWords());
  function readShowWords() {
    try {
      return localStorage.getItem(WORDS_KEY) !== "0";
    } catch {
      return true;
    }
  }
  function toggleWords() {
    showWords = !showWords;
    try {
      localStorage.setItem(WORDS_KEY, showWords ? "1" : "0");
    } catch {
      // Not remembered; it still hides.
    }
  }
  let line = $state<{ current: string; next: string } | null>(null);
  $effect(() => {
    if (!open || !showWords || !v?.now?.words) return void (line = null);
    let stop = false;
    const look = async () => {
      try {
        const r = await get<{ line: { current: string; next: string } | null }>(`/api/chats/${chatId}/music/line`);
        if (!stop) line = r.line;
      } catch {
        if (!stop) line = null;
      }
    };
    void look();
    const t = setInterval(look, 1000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  });
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
      <button class="chip np-chip" onclick={() => (open = !open)} aria-expanded={open} title={`${v.now ? `${v.now.title}${v.now.artist ? ` · ${v.now.artist}` : ""} — ${v.now.why}` : "Waiting for the next beat"}${v.moment?.situations.length ? `\nThe scene: ${v.moment.situations.join(", ")}${v.moment.gist ? ` (${v.moment.gist})` : ""}` : ""}`}>
        <Music size={13} /><span class="t">{v.now?.title ?? "Soundtrack on"}</span>
      </button>
      {#if open}
        <span class="ctl card" role="group" aria-label="Soundtrack" bind:this={card}>
          <span class="btns">
          <button class="btn ghost icon small" onclick={() => act("playPause")} aria-label="Play or pause"><Pause size={14} /></button>
          <button class="btn ghost icon small" onclick={() => act("skip")} aria-label="Skip"><SkipForward size={14} /></button>
          <button class="btn ghost icon small" class:on={v.vote > 0} onclick={() => act("up")} aria-label="More like this" disabled={!v.now}><ThumbsUp size={14} /></button>
          <button class="btn ghost icon small" class:on={v.vote < 0} onclick={() => act("down")} aria-label="Less like this" disabled={!v.now}><ThumbsDown size={14} /></button>
          <button class="btn ghost small" onclick={() => act("notForScene")} disabled={!v.now}>Not for this scene</button>
          {#if v.now?.words}<button class="btn ghost small" onclick={() => act("wrongWords")} title="Keep the song, but these words don't fit what's happening">Wrong words</button><button class="btn ghost small" class:on={showWords} onclick={toggleWords} aria-pressed={showWords} title="Show the line being sung">Words</button>{/if}
          <button class="btn ghost icon small" onclick={() => ((open = false), act("off"))} aria-label="Turn the soundtrack off" title="Off for this chat"><X size={14} /></button>
          </span>
          {#if line?.current}
            <span class="strip" aria-live="polite"><span class="cur">{line.current}</span>{#if line.next}<span class="nxt">{line.next}</span>{/if}</span>
          {/if}
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
    display: grid;
    gap: 0.3rem;
    padding: 0.3rem;
    /* As wide as the row of buttons (an absolute box would otherwise shrink to the chip's width and squeeze them). */
    width: max-content;
    max-width: calc(100vw - 2rem);
  }
  .btns {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.2rem;
    white-space: nowrap;
  }
  .btns > :global(*) {
    flex: none;
  }
  .strip {
    display: grid;
    gap: 0.1rem;
    padding: 0.2rem 0.45rem 0.3rem;
    /* The lyric strip wraps inside the buttons' width instead of widening the card. */
    width: 0;
    min-width: 100%;
    font-size: 0.85em;
    line-height: 1.35;
  }
  .strip .nxt {
    opacity: 0.55;
  }
</style>
