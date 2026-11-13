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
    now: { videoId: string; title: string; artist: string; why: string; words?: { passage: number; situations: string[] }; runners?: { title: string; artist: string }[] } | null;
    vote: number;
    /** docs/18, 2.3: what was happening at the last beat. */
    moment: { situations: string[]; gist: string } | null;
    /** docs/34 Part 3: the scene brief in one line ("family · happy in it · no heat · energy 2 — dinner chores"). */
    scene: string;
    /** docs/34 5.3: the kind of scene a 👍 counts for ("family · happy in it · quiet"). */
    kind?: string;
  }
  let { chatId }: { chatId: string } = $props();
  let v = $state<View | null>(null);
  let open = $state(false);
  // The card hangs left from the chip; on a narrow screen it's moved back right to stay on screen.
  let card = $state<HTMLElement | null>(null);
  // docs/34 5.2: "Not for this scene" asks why, in one tap.
  let asking = $state(false);
  $effect(() => {
    void v;
    void asking;
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
  // docs/34 1.2: what played in this story, and how each song ended.
  interface Play {
    id: string;
    title: string;
    artist: string;
    how: string;
    why: string;
    ending: string | null;
    heard: number | null;
    marks: string[];
  }
  let showPlays = $state(false);
  let plays = $state<Play[] | null>(null);
  async function loadPlays() {
    try {
      plays = (await get<{ plays: Play[] }>(`/api/chats/${chatId}/music/plays`)).plays;
    } catch {
      plays = [];
    }
  }
  $effect(() => {
    void v?.now?.videoId;
    if (open && showPlays) void loadPlays();
  });
  const HOW: Record<string, string> = { start: "first song", big: "big moment", next: "next song", skip: "after a skip", notFor: "after Not for this scene", down: "after a 👎" };
  const mins = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  function ended(p: Play) {
    if (!p.ending) return "playing";
    const at = p.heard != null ? ` at ${mins(p.heard)}` : "";
    return { played: "played out", skipped: `skipped${at}`, notFor: `not for the scene${at}`, down: `👎${at}`, cut: `cut${at}`, off: `turned off${at}`, replaced: `replaced${at}` }[p.ending] ?? p.ending;
  }

  const WHYS: [string, string, string][] = [
    ["words", "Wrong words", "The words don't fit what's happening"],
    ["sound", "Wrong sound", "It sounds wrong here (too loud, too quiet, the wrong feel)"],
    ["much", "Too much", "Too heated or too intense for this"],
    ["now", "Just not now", "Nothing wrong with it, just not here"],
  ];
  async function act(action: string, why?: string) {
    asking = false;
    try {
      v = await post<View>(`/api/chats/${chatId}/music`, why ? { action, why } : { action });
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
      <button class="chip np-chip" onclick={() => (open = !open)} aria-expanded={open} title={`${v.now ? `${v.now.title}${v.now.artist ? ` · ${v.now.artist}` : ""} — ${v.now.why}` : "Waiting for the next beat"}${v.scene ? `\nThe scene: ${v.scene}` : ""}`}>
        <Music size={13} /><span class="t">{v.now?.title ?? "Soundtrack on"}</span>
      </button>
      {#if open}
        <span class="ctl card" role="group" aria-label="Soundtrack" bind:this={card}>
          <span class="btns">
          <button class="btn ghost icon small" onclick={() => act("playPause")} aria-label="Play or pause"><Pause size={14} /></button>
          <button class="btn ghost icon small" onclick={() => act("skip")} aria-label="Skip"><SkipForward size={14} /></button>
          <button class="btn ghost icon small" class:on={v.vote > 0} onclick={() => act("up")} aria-label="More like this" title={v.kind ? `More like this in ${v.kind} scenes` : "More like this"} disabled={!v.now}><ThumbsUp size={14} /></button>
          <button class="btn ghost icon small" class:on={v.vote < 0} onclick={() => act("down")} aria-label="Less like this" title="Less like this (twice: never again in this story)" disabled={!v.now}><ThumbsDown size={14} /></button>
          <button class="btn ghost small" class:on={asking} onclick={() => (asking = !asking)} aria-expanded={asking} disabled={!v.now}>Not for this scene</button>
          {#if v.now?.words}<button class="btn ghost small" onclick={() => act("wrongWords")} title="Keep the song, but these words don't fit what's happening">Wrong words</button><button class="btn ghost small" class:on={showWords} onclick={toggleWords} aria-pressed={showWords} title="Show the line being sung">Words</button>{/if}
          <button class="btn ghost small" class:on={showPlays} onclick={() => (showPlays = !showPlays)} aria-pressed={showPlays} title="What played in this story">Played</button>
          <button class="btn ghost icon small" onclick={() => ((open = false), act("off"))} aria-label="Turn the soundtrack off" title="Off for this chat"><X size={14} /></button>
          </span>
          {#if asking}
            <span class="whys" role="group" aria-label="Why not for this scene?"><span class="muted small-why">Why?</span>{#each WHYS as [why, label, hint] (why)}<button class="btn ghost small" onclick={() => act("notForScene", why)} title={hint}>{label}</button>{/each}</span>
          {/if}
          {#if v.now}<span class="strip"><span>{v.now.why}</span>{#if v.now.runners?.length}<span class="nxt">Also close: {v.now.runners.map((r) => r.title).join(" · ")}</span>{/if}</span>{/if}
          {#if v.scene}<span class="strip"><span class="nxt">The scene: {v.scene}</span></span>{/if}
          {#if line?.current}
            <span class="strip" aria-live="polite"><span class="cur">{line.current}</span>{#if line.next}<span class="nxt">{line.next}</span>{/if}</span>
          {/if}
          {#if showPlays}
            <span class="plays" role="list" aria-label="Played in this story">
              {#if plays && !plays.length}<span class="muted">Nothing logged yet. Songs are logged from now on.</span>{/if}
              {#each plays ?? [] as p (p.id)}
                <span class="play" role="listitem">
                  <span class="pt">{p.title}{#if p.artist}<span class="muted">{` · ${p.artist}`}</span>{/if}</span>
                  <span class="muted">{[HOW[p.how] ?? p.how, ended(p), ...(p.marks.includes("up") ? ["👍"] : []), ...(p.marks.includes("wrongWords") ? ["wrong words"] : []), ...(p.marks.includes("wrongSound") ? ["wrong sound"] : []), ...(p.marks.includes("tooMuch") ? ["too much"] : []), ...(p.marks.includes("notNow") ? ["not now"] : [])].join(" · ")}</span>
                  {#if p.why}<span class="pw">{p.why}</span>{/if}
                </span>
              {/each}
            </span>
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
  .plays {
    display: grid;
    gap: 0.45rem;
    /* Wraps inside the buttons' width, and scrolls instead of running off the screen. */
    width: 0;
    min-width: 100%;
    max-height: 18rem;
    overflow-y: auto;
    padding: 0.2rem 0.45rem 0.3rem;
    font-size: 0.85em;
    line-height: 1.35;
  }
  .play {
    display: grid;
    gap: 0.05rem;
  }
  .pt {
    font-weight: 600;
  }
  .pw {
    opacity: 0.8;
  }
  /* The answers wrap inside the buttons' width instead of widening the card. */
  .whys {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.2rem;
    width: 0;
    min-width: 100%;
  }
  .small-why {
    font-size: 0.85em;
    padding-inline: 0.3rem;
  }
  .strip .nxt {
    opacity: 0.55;
  }
</style>
