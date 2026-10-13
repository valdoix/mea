<script lang="ts">
  import Segmented from "../Segmented.svelte";
  import { device, setDevice } from "../../lib/device.svelte";
  import { app, saveSetting } from "../../lib/state.svelte";
  import type { Settings } from "../../lib/types";

  // Lantern: how the chat looks on this device: box width, text size, portraits, room inside boxes.
  let open = $state(false);
  let root = $state<HTMLDivElement | null>(null);

  const widths = [
    { value: "38", label: "Narrow" },
    { value: "0", label: "Comfortable" },
    { value: "60", label: "Wide" },
    { value: "100", label: "Full" },
  ];
  const width = $derived(String(device.chatWidth ?? 0));
  const scale = $derived(app.settings?.["appearance.fontScale"] ?? 1);
  const style = $derived(app.settings?.["appearance.chatStyle"] ?? "cards");

  function outside(e: MouseEvent) {
    if (open && root && !root.contains(e.target as Node)) open = false;
  }
</script>

<svelte:window onclick={outside} onkeydown={(e) => e.key === "Escape" && (open = false)} />

<div class="wrap" bind:this={root}>
  <button class="btn ghost icon aa" class:on={open} onclick={() => (open = !open)} aria-label="Display: chat style, box size, text and portraits" aria-expanded={open} title="Display">Aa</button>
  {#if open}
    <div class="pop" role="dialog" aria-label="Display">
      <div class="eyebrow-l">Display</div>
      <div class="field">
        <span class="label">Chat style</span>
        <Segmented
          value={style}
          options={[
            { value: "cards", label: "Cards" },
            { value: "book", label: "Book" },
            { value: "bubbles", label: "Bubbles" },
          ]}
          onchange={(v) => saveSetting("appearance.chatStyle", v as Settings["appearance.chatStyle"])}
        />
      </div>
      <div class="field">
        <span class="label">Chat box width</span>
        <Segmented value={width} options={widths} onchange={(v) => setDevice("chatWidth", Number(v))} />
      </div>
      <label class="field">
        <span class="label">Text size <span class="faint">{Math.round(scale * 100)}%</span></span>
        <input type="range" min="0.85" max="1.3" step="0.05" value={scale} onchange={(e) => saveSetting("appearance.fontScale", Number(e.currentTarget.value))} />
      </label>
      <label class="switch"><input type="checkbox" checked={device.plates} onchange={(e) => setDevice("plates", e.currentTarget.checked)} /> Scene plates <span class="tiny muted">a drawn header at each new scene</span></label>
      <div class="field">
        <span class="label">Portraits</span>
        <Segmented
          value={device.portrait}
          options={[
            { value: "small", label: "Small" },
            { value: "large", label: "Large" },
            { value: "grand", label: "Grand" },
          ]}
          onchange={(v) => setDevice("portrait", v)}
        />
      </div>
      <div class="field">
        <span class="label">Room inside each box</span>
        <Segmented
          value={device.boxPadding}
          options={[
            { value: "snug", label: "Snug" },
            { value: "cozy", label: "Cozy" },
            { value: "airy", label: "Airy" },
          ]}
          onchange={(v) => setDevice("boxPadding", v)}
        />
      </div>
      <a class="tiny more" href="/settings/appearance" onclick={() => (open = false)}>More in Settings → Appearance</a>
    </div>
  {/if}
</div>

<style>
  .wrap {
    position: relative;
  }
  .aa {
    font: 400 1.15rem/1 var(--font-display);
  }
  .aa.on {
    background: var(--fill-2, var(--surface-2));
  }
  .pop {
    position: absolute;
    right: 0;
    top: calc(100% + 10px);
    z-index: 40;
    width: 330px;
    display: grid;
    gap: 0.9rem;
    padding: 1.1rem 1.15rem 1rem;
    border-radius: 22px;
    background: var(--surface);
    border: 1px solid var(--border);
    box-shadow: var(--shadow-2);
    animation: pop 0.3s var(--spring);
  }
  :global([data-shell="lantern"]) .pop {
    background: var(--pop);
    border-color: color-mix(in srgb, var(--hi) 10%, transparent);
    backdrop-filter: blur(20px);
  }
  @keyframes pop {
    from {
      opacity: 0;
      transform: translateY(-6px) scale(0.97);
    }
  }
  .pop :global(.seg) {
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: 1fr;
    width: 100%;
  }
  .pop :global(.seg button) {
    padding-inline: 0.3rem;
  }
  .more {
    justify-self: start;
  }
  @media (max-width: 760px) {
    .pop {
      position: fixed;
      left: 10px;
      right: 10px;
      top: calc(64px + var(--safe-top));
      width: auto;
    }
  }
</style>
