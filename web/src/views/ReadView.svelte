<script lang="ts">
  import { onMount } from "svelte";
  import { get } from "../lib/api";
  import { device, setDevice, type DevicePrefs } from "../lib/device.svelte";
  import { ArrowLeft, Minus, Plus } from "../lib/icons";
  import { applyRegex } from "../lib/regex.svelte";
  import { renderMessage } from "../lib/render";
  import { route } from "../lib/router.svelte";
  import { app } from "../lib/state.svelte";
  import type { Boundary, ChatDetail, Message } from "../lib/types";

  /**
   * UI-15: reading mode. All chrome hidden, the story as a book: chapter titles, scene breaks,
   * your messages set apart, out-of-character notes left out. Size, width and paper are yours.
   */
  let { id }: { id: string } = $props();

  let detail = $state<ChatDetail | null>(null);
  let messages = $state<Message[]>([]);
  let chapters = $state<Boundary[]>([]);
  let hasMore = $state(true);
  let loading = $state(false);
  let error = $state("");
  let sentinel = $state<HTMLElement | null>(null);
  let chromeShown = $state(true);
  let hideTimer: ReturnType<typeof setTimeout>;

  async function more() {
    if (loading || !hasMore) return;
    loading = true;
    try {
      const after = messages.at(-1)?.seq ?? 0;
      const page = await get<{ messages: Message[]; hasMore: boolean }>(`/api/chats/${id}/messages?after=${after}&limit=120`);
      messages = [...messages, ...page.messages];
      hasMore = page.hasMore;
    } catch (e) {
      error = (e as Error).message;
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    void (async () => {
      try {
        const [d, b] = await Promise.all([get<ChatDetail>(`/api/chats/${id}`), get<{ boundaries: Boundary[] }>(`/api/chats/${id}/boundaries`)]);
        detail = d;
        chapters = b.boundaries;
        await more();
      } catch (e) {
        error = (e as Error).message;
      }
    })();
    nudge();
    return () => clearTimeout(hideTimer);
  });

  // Load the next pages as you near the end.
  $effect(() => {
    if (!sentinel) return;
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && void more(), { rootMargin: "1200px" });
    io.observe(sentinel);
    return () => io.disconnect();
  });

  /** The controls fade away while you read and come back when you move. */
  function nudge() {
    chromeShown = true;
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => (chromeShown = false), 2600);
  }

  const shown = $derived(messages.filter((m) => !m.hidden && m.role !== "system" && m.content.trim() && !m.meta?.director));
  /** A chapter that starts here already marks the break; a scene break on the same message would repeat it. */
  const breaksAt = (seq: number) => {
    const here = chapters.filter((b) => b.startSeq === seq);
    return here.some((b) => b.level === "chapter") ? here.filter((b) => b.level === "chapter") : here.slice(0, 1);
  };
  const charName = $derived(detail?.character?.name ?? "");

  /** Out-of-character asides don't belong in the book. */
  const clean = (t: string) => t.replace(/\(\s*OOC:[^)]*\)/gi, "").replace(/\[\s*OOC:[^\]]*\]/gi, "").trim();
  const html = (m: Message) => renderMessage(clean(m.role === "user" ? m.content : applyRegex(m.content, app.settings?.["regex.scripts"], { role: "ai", mode: "display", characterId: detail?.chat.characterId })), `r-${m.id.slice(0, 8)}`);

  function size(d: number) {
    setDevice("readSize", Math.min(1.8, Math.max(0.85, Math.round((device.readSize + d) * 100) / 100)));
  }
  function back() {
    if (history.length > 1) history.back();
    else location.href = `/chat/${id}`;
  }
  const papers: { value: DevicePrefs["readTheme"]; label: string }[] = [
    { value: "app", label: "Theme" },
    { value: "paper", label: "Paper" },
    { value: "night", label: "Night" },
  ];
</script>

<svelte:window onmousemove={nudge} onkeydown={(e) => (e.key === "Escape" ? back() : nudge())} onscroll={nudge} />

<div class="reader paper-{device.readTheme}" style:--read-size="{device.readSize}rem" style:--read-width="{device.readWidth}rem">
  <header class="controls" class:hidden={!chromeShown}>
    <button class="btn ghost icon" onclick={back} aria-label="Back to the chat"><ArrowLeft size={19} /></button>
    <span class="grow"></span>
    <div class="row group" role="group" aria-label="Text size">
      <button class="btn ghost icon small" onclick={() => size(-0.05)} aria-label="Smaller text"><Minus size={15} /></button>
      <button class="btn ghost icon small" onclick={() => size(0.05)} aria-label="Larger text"><Plus size={15} /></button>
    </div>
    <label class="row width">
      <span class="tiny">Width</span>
      <input type="range" min="26" max="60" step="1" value={device.readWidth} oninput={(e) => setDevice("readWidth", Number(e.currentTarget.value))} aria-label="Line width" />
    </label>
    <div class="row group" role="radiogroup" aria-label="Paper">
      {#each papers as p (p.value)}<button class="btn ghost small" class:on={device.readTheme === p.value} role="radio" aria-checked={device.readTheme === p.value} onclick={() => setDevice("readTheme", p.value)}>{p.label}</button>{/each}
    </div>
  </header>

  <article class="book">
    {#if error}
      <p class="muted">{error}</p>
    {:else if detail}
      <header class="titlepage">
        <h1>{detail.chat.title}</h1>
        {#if charName}<p class="byline">{charName}{detail.persona ? ` & ${detail.persona.name}` : ""}</p>{/if}
        <span class="orn">✿</span>
      </header>
      {#each shown as m (m.id)}
        {#each breaksAt(m.seq) as b (b.id)}
          {#if b.level === "chapter"}
            <h2 class="chapter">{b.title || "A new chapter"}{#if b.storyTime}<small>{b.storyTime}</small>{/if}</h2>
          {:else}
            <div class="scene" aria-hidden="true">⁂</div>
          {/if}
        {/each}
        <section class="prose para" class:you={m.role === "user"}>{@html html(m)}</section>
      {/each}
      <div bind:this={sentinel} class="end">
        {#if loading}<span class="tiny muted">Turning pages…</span>{:else if !hasMore}<span class="orn">✿</span>{/if}
      </div>
    {/if}
  </article>
</div>

<style>
  /* M5: a message's own HTML stays inside its paragraph block. */
  section.prose {
    contain: layout paint;
    overflow-clip-margin: 1rem;
  }
  .reader {
    --page-bg: var(--bg);
    --page-text: var(--text);
    min-height: 100dvh;
    background: var(--page-bg);
    color: var(--page-text);
  }
  .paper-paper {
    --page-bg: #f6efe3;
    --page-text: #3b3128;
    --dialogue: #7a3a2c;
    --action: #5d5148;
  }
  .paper-night {
    --page-bg: #15121a;
    --page-text: #d9d1d6;
    --dialogue: #e6a9bd;
    --action: #a99fb0;
  }
  .controls {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    z-index: 5;
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: calc(0.5rem + var(--safe-top)) 0.8rem 0.5rem;
    background: color-mix(in srgb, var(--page-bg) 88%, transparent);
    backdrop-filter: blur(8px);
    transition: opacity var(--t) var(--ease), translate var(--t) var(--ease);
  }
  .controls.hidden {
    opacity: 0;
    translate: 0 -100%;
    pointer-events: none;
  }
  .controls :global(.btn) {
    color: var(--page-text);
  }
  .group .on {
    background: color-mix(in srgb, var(--accent) 22%, transparent);
  }
  .width input {
    width: 6rem;
  }
  .book {
    max-width: var(--read-width);
    margin: 0 auto;
    padding: 5rem 1.4rem 6rem;
  }
  .book :global(.prose) {
    font-size: var(--read-size);
    color: var(--page-text);
  }
  .titlepage {
    text-align: center;
    padding: 3rem 0 2.5rem;
  }
  .titlepage h1 {
    font-family: var(--font-display);
    font-size: calc(var(--read-size) * 2);
    margin: 0;
  }
  .byline {
    font-style: italic;
    opacity: 0.75;
  }
  .orn {
    display: block;
    text-align: center;
    color: var(--accent-strong);
  }
  .chapter {
    font-family: var(--font-display);
    font-size: calc(var(--read-size) * 1.45);
    text-align: center;
    margin: 3.5rem 0 1.8rem;
  }
  .chapter small {
    display: block;
    font-family: var(--font-ui);
    font-size: 0.5em;
    font-weight: 500;
    opacity: 0.6;
    margin-top: 0.4rem;
  }
  .scene {
    text-align: center;
    margin: 1.6rem 0;
    opacity: 0.55;
    letter-spacing: 0.4em;
  }
  .para {
    margin: 0 0 var(--para-gap, 0.75em);
  }
  .para.you {
    font-style: italic;
    opacity: 0.85;
    padding-left: 1.2em;
    border-left: 2px solid color-mix(in srgb, var(--accent) 35%, transparent);
  }
  .end {
    padding: 3rem 0;
    text-align: center;
  }
  @media (max-width: 640px) {
    .width {
      display: none;
    }
  }
</style>
