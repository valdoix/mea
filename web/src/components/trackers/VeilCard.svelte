<script lang="ts">
  import { readClock } from "../../lib/storytime";
  import type { TrackerCharacter } from "../../lib/types";

  /**
   * The Veil: one character's inner life. The mask is lifted by hand to see what they feel under
   * what they show; their latest thought stays blurred until held; their drives point like a
   * compass; their journal is a diary to page through.
   */
  let { char, color, calendar = "gregorian" }: { char: TrackerCharacter; color: string; calendar?: "gregorian" | "westeros" } = $props();

  let lift = $state(0);
  let held = $state(0);
  let open = $state(false);
  let page = $state(0);
  let raf = 0;

  const drives = $derived(char.drives ?? {});
  const hasDrives = $derived(Boolean(drives.want || drives.fear || drives.need || drives.tactic));
  const journal = $derived([...(char.journal ?? [])].reverse());

  function hold() {
    if (open) {
      open = false;
      held = 0;
      return;
    }
    const t0 = performance.now();
    cancelAnimationFrame(raf);
    const step = (now: number) => {
      held = Math.min(1, (now - t0) / 900);
      if (held >= 1) open = true;
      else raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  }
  function release() {
    cancelAnimationFrame(raf);
    if (!open) held = 0;
  }
</script>

<article class="veil" style:--vc={color}>
  <header class="who">
    <span class="orb" aria-hidden="true">{char.name.slice(0, 1)}</span>
    <div><b>{char.name}</b>{#if char.mood}<span>{char.mood.name}</span>{/if}</div>
  </header>

  {#if char.mask?.felt || char.mask?.shown}
    <div class="mask" style:--lift={lift}>
      <div class="layer felt"><small>Feels</small><div class="big">{char.mask.felt ?? "—"}</div>{#if char.mask.tell}<div class="tell">Tell · {char.mask.tell}</div>{/if}</div>
      <div class="layer shown"><small>Shows</small><div class="big">{char.mask.shown ?? "Nothing you can read"}</div><div class="tell">What anyone in the room can see.</div></div>
      <div class="seam" aria-hidden="true"></div>
      <input type="range" min="0" max="100" bind:value={lift} aria-label="Lift {char.name}'s mask" />
    </div>
  {/if}

  {#if char.thoughts}
    <button
      class="mind"
      class:open
      style:--p={open ? 1 : held}
      onpointerdown={hold}
      onpointerup={release}
      onpointerleave={release}
      onkeydown={(e) => (e.key === " " || e.key === "Enter") && !e.repeat && (e.preventDefault(), hold())}
      onkeyup={release}
      aria-label={open ? `${char.name} thinks: ${char.thoughts.text}` : `Hold to read ${char.name}'s thoughts`}
    >
      <span class="txt">“{char.thoughts.text}”</span>
      {#if !open}
        <span class="lbl">Hold to read {char.name.split(" ")[0]}'s mind</span>
        <svg class="ring" viewBox="0 0 44 44" aria-hidden="true"><circle cx="22" cy="22" r="18" class="track" /><circle cx="22" cy="22" r="18" class="fill" stroke-dasharray="113" stroke-dashoffset={113 * (1 - held)} transform="rotate(-90 22 22)" /></svg>
      {/if}
    </button>
  {/if}

  {#if hasDrives}
    <div class="compass">
      <svg viewBox="0 0 200 200" aria-hidden="true"><g><circle cx="100" cy="100" r="62" /><circle cx="100" cy="100" r="76" class="dots" /><path d="M100 18 L108 100 L100 182 L92 100Z M18 100 L100 92 L182 100 L100 108Z" /></g></svg>
      <span class="c-orb" aria-hidden="true">{char.name.slice(0, 1)}</span>
      {#if drives.want}<div class="pt n"><small>Wants</small>{drives.want}</div>{/if}
      {#if drives.tactic}<div class="pt e"><small>Copes by</small>{drives.tactic}</div>{/if}
      {#if drives.need}<div class="pt s"><small>Needs</small>{drives.need}</div>{/if}
      {#if drives.fear}<div class="pt w"><small>Fears</small>{drives.fear}</div>{/if}
    </div>
  {/if}

  {#if journal.length}
    <div class="diary">
      {#each journal.slice(page, page + 2) as e, i (e.seq + ":" + i)}
        <div class="pg">{#if e.at}<div class="dt">{readClock(e.at, calendar)}</div>{/if}{e.text}</div>
      {/each}
      {#if journal.slice(page, page + 2).length === 1}<div class="pg"></div>{/if}
    </div>
    <div class="dnav">
      <button class="btn ghost small" onclick={() => (page = Math.min(journal.length - 1, page + 2))} disabled={page + 2 >= journal.length}>← Earlier</button>
      <span class="tiny muted">{journal.length} {journal.length === 1 ? "entry" : "entries"}</span>
      <button class="btn ghost small" onclick={() => (page = Math.max(0, page - 2))} disabled={page === 0}>Later →</button>
    </div>
  {/if}
</article>

<style>
  .veil {
    display: grid;
    gap: 0.9rem;
    padding: 1rem;
    border-radius: var(--r-lg, 22px);
    background: color-mix(in srgb, var(--surface) 70%, transparent);
    border: 1px solid var(--border);
  }
  .who {
    display: flex;
    align-items: center;
    gap: 0.6rem;
  }
  .who b {
    display: block;
    font: 400 1.3rem/1.1 "Instrument Serif", Georgia, serif;
  }
  .who span {
    font: italic 0.85rem var(--font-story);
    color: var(--text-muted);
  }
  .orb,
  .c-orb {
    width: 2.2rem;
    height: 2.2rem;
    border-radius: 50%;
    display: grid;
    place-items: center;
    flex: none;
    font: 400 1.1rem "Instrument Serif", Georgia, serif;
    color: #0e0a18;
    background: radial-gradient(circle at 30% 26%, #fffa, transparent 34%), radial-gradient(circle at 72% 82%, color-mix(in oklab, var(--vc), #000 50%), transparent 72%), var(--vc);
    box-shadow: 0 6px 18px -6px var(--vc);
  }
  .mask {
    position: relative;
    border-radius: 18px;
    overflow: hidden;
    min-height: 10.5rem;
    user-select: none;
  }
  .layer {
    position: absolute;
    inset: 0;
    padding: 1rem 1.1rem 2rem;
    display: grid;
    align-content: center;
    gap: 0.35rem;
  }
  .felt {
    background: radial-gradient(120% 120% at 100% 100%, #b8406f88, transparent 60%), linear-gradient(140deg, #2a0f2a, #120a1e);
    color: #ffd2e4;
  }
  .shown {
    background: radial-gradient(120% 120% at 0% 0%, #ffffff22, transparent 60%), linear-gradient(140deg, #d9d2e4, #a99fbc);
    color: #1a1426;
    clip-path: inset(0 0 0 calc(var(--lift) * 1%));
  }
  .seam {
    position: absolute;
    top: 0;
    bottom: 0;
    left: calc(var(--lift) * 1%);
    width: 2px;
    background: #fff;
    box-shadow: 0 0 18px 4px var(--vc);
    opacity: calc(min(var(--lift), 1) * (100 - var(--lift)) / 50);
    pointer-events: none;
  }
  .layer small {
    font: 800 0.6rem var(--font-ui);
    letter-spacing: 0.22em;
    text-transform: uppercase;
    opacity: 0.65;
  }
  .big {
    font: 400 1.5rem/1.1 "Instrument Serif", Georgia, serif;
  }
  .felt .big {
    font-style: italic;
  }
  .tell {
    font: italic 0.85rem/1.4 var(--font-story);
    opacity: 0.8;
  }
  .mask input {
    position: absolute;
    left: 0.8rem;
    right: 0.8rem;
    bottom: 0.4rem;
    z-index: 2;
    accent-color: var(--vc);
  }
  .mind {
    position: relative;
    text-align: left;
    border-radius: 18px;
    padding: 1.1rem 1.1rem 2.2rem;
    min-height: 7.5rem;
    border: 1px solid var(--border);
    background: radial-gradient(circle at 20% 0%, color-mix(in srgb, var(--vc) 18%, transparent), transparent 55%), color-mix(in srgb, var(--surface-2) 60%, transparent);
    color: var(--text);
    cursor: pointer;
    touch-action: none;
    user-select: none;
    font: inherit;
  }
  .txt {
    display: block;
    font: italic 1.1rem/1.5 var(--font-story);
    filter: blur(calc((1 - var(--p)) * 8px));
    opacity: calc(0.35 + var(--p) * 0.65);
  }
  .lbl {
    position: absolute;
    left: 1.1rem;
    bottom: 0.75rem;
    font: 800 0.6rem var(--font-ui);
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--text-muted);
  }
  .ring {
    position: absolute;
    right: 0.8rem;
    bottom: 0.6rem;
    width: 2.2rem;
    height: 2.2rem;
  }
  .ring circle {
    fill: none;
    stroke-width: 3;
  }
  .ring .track {
    stroke: var(--border);
  }
  .ring .fill {
    stroke: var(--vc);
    stroke-linecap: round;
  }
  .compass {
    position: relative;
    aspect-ratio: 1;
    width: min(100%, 19rem);
    margin: 0.4rem auto;
  }
  .compass svg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    animation: spin 120s linear infinite;
  }
  .compass g {
    fill: none;
    stroke: var(--vc);
    stroke-opacity: 0.4;
  }
  .compass path {
    fill: var(--vc);
    fill-opacity: 0.08;
  }
  .compass .dots {
    stroke-dasharray: 1 5;
  }
  @keyframes spin {
    to {
      rotate: 360deg;
    }
  }
  .c-orb {
    position: absolute;
    left: 50%;
    top: 50%;
    translate: -50% -50%;
    width: 3rem;
    height: 3rem;
    font-size: 1.5rem;
  }
  .pt {
    position: absolute;
    width: 44%;
    text-align: center;
    font: italic 0.8rem/1.3 var(--font-story);
  }
  .pt small {
    display: block;
    font: 800 0.55rem var(--font-ui);
    letter-spacing: 0.2em;
    text-transform: uppercase;
    color: color-mix(in srgb, var(--vc) 70%, var(--text));
  }
  .n {
    top: 0;
    left: 28%;
  }
  .s {
    bottom: 0;
    left: 28%;
  }
  .e {
    right: -4%;
    top: 38%;
    width: 32%;
    text-align: left;
  }
  .w {
    left: -4%;
    top: 38%;
    width: 32%;
    text-align: right;
  }
  .diary {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 2px;
    padding: 6px;
    border-radius: 6px 12px 12px 6px;
    background: #2a1a2e;
    box-shadow: 0 20px 40px -22px #000;
    min-height: 9rem;
  }
  .pg {
    padding: 0.8rem 0.9rem;
    color: #33264a;
    font: 500 1.05rem/1.3 "Caveat", cursive;
    background: repeating-linear-gradient(180deg, transparent 0 22px, #6a8ac022 22px 23px), linear-gradient(90deg, #e4d6bd, #f3ead8 14%);
    animation: turn 0.6s cubic-bezier(0.22, 1, 0.36, 1);
    transform-origin: left center;
    overflow-wrap: anywhere;
  }
  .pg:first-child {
    background: repeating-linear-gradient(180deg, transparent 0 22px, #6a8ac022 22px 23px), linear-gradient(270deg, #e4d6bd, #f3ead8 14%);
  }
  .dt {
    font: italic 0.72rem "IM Fell English", Georgia, serif;
    color: #7a5a6a;
    margin-bottom: 0.3rem;
  }
  @keyframes turn {
    from {
      transform: perspective(900px) rotateY(-80deg);
      opacity: 0;
    }
  }
  .dnav {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  @media (prefers-reduced-motion: reduce) {
    .compass svg,
    .pg {
      animation: none;
    }
  }
</style>
